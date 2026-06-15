import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Wire contract→code codegen chokepoints into the consumer's package.json.
 *
 * Per docs/adr/0001-contract-to-openapi-export.md and 0007-data-shape-conformance.md,
 * the kit owns the generic contract→OpenAPI projection; the stack-specific
 * client/model codegen stays in the consumer repo. The risk is leaving that
 * consumer half as prose (a doc the agent ignores). This materializes it as
 * editable npm scripts the human can edit:
 *
 *   contract:client        regenerate the OpenAPI artifact + the typed FE client
 *   contract:client:check  fail if the artifact drifted from the contract (CI gate)
 *   contract:models        regenerate the OpenAPI artifact + backend Pydantic models
 *                          (FastAPI only — wiring those as `response_model` makes the
 *                          framework enforce the contracted response shape at runtime)
 *
 * It is deliberately conservative: it only acts when a package.json exists (the
 * script registry to wire into), never overwrites pre-existing scripts, and picks
 * conventional generators (`openapi-typescript`, `datamodel-codegen`) only as
 * editable defaults, logging what to install and which path to adjust. The
 * tool/version/output-path are the consumer's preference, so detection fills a
 * default, it does not decide. The backend half is wired only when FastAPI is
 * detected — the stack where generated models yield automatic runtime
 * enforcement; other Python stacks rely on the response-shape validator (ADR 0007).
 */

export interface CodegenSuggestion {
  /** Script names actually written into package.json. */
  added: string[];
  /** Why nothing was written (mutually exclusive with a non-empty `added`). */
  skipped?: string;
  /** Follow-up note for the user when scripts were added. */
  note?: string;
}

const ARTIFACT_PATH = 'contracts/api/openapi.json';
const CLIENT_OUT = 'src/api/types.ts';
const MODELS_OUT = 'src/api/contract_models.py';

const SCRIPT_GENERATE = 'contract:client';
const SCRIPT_CHECK = 'contract:client:check';
const SCRIPT_MODELS = 'contract:models';

const GENERATE_CMD =
  `cdd-kit openapi export --out ${ARTIFACT_PATH} && ` +
  `npx --yes openapi-typescript ${ARTIFACT_PATH} -o ${CLIENT_OUT}`;
const CHECK_CMD = `cdd-kit openapi export --check --out ${ARTIFACT_PATH}`;
const MODELS_CMD =
  `cdd-kit openapi export --out ${ARTIFACT_PATH} && ` +
  `datamodel-codegen --input ${ARTIFACT_PATH} --input-file-type openapi --output ${MODELS_OUT}`;

/** True when a Python manifest in cwd declares a FastAPI dependency. */
function detectsFastApi(cwd: string): boolean {
  for (const f of ['requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'environment.yml', 'Pipfile']) {
    const p = join(cwd, f);
    if (!existsSync(p)) continue;
    try {
      if (/\bfastapi\b/i.test(readFileSync(p, 'utf8'))) return true;
    } catch { /* unreadable manifest — treat as not-detected */ }
  }
  return false;
}

export function suggestCodegenScript(cwd: string): CodegenSuggestion {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    // No JS/TS side detected. Client codegen is consumer-specific; we cannot
    // pick a conventional tool for an arbitrary backend language, so we stay
    // out of the way rather than guess. The backend recipe (datamodel-codegen)
    // is documented in the tests/contract scaffold for pure-Python projects.
    return { added: [], skipped: 'no package.json (client codegen is consumer-specific; see docs/openapi-export.md)' };
  }

  let pkg: Record<string, unknown>;
  let raw: string;
  try {
    raw = readFileSync(pkgPath, 'utf8');
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { added: [], skipped: 'package.json is not valid JSON; left untouched' };
  }
  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) {
    return { added: [], skipped: 'package.json is not a JSON object; left untouched' };
  }

  const scripts = (typeof pkg.scripts === 'object' && pkg.scripts !== null && !Array.isArray(pkg.scripts))
    ? (pkg.scripts as Record<string, unknown>)
    : {};

  const added: string[] = [];
  const notes: string[] = [];

  // ── Frontend half: contract:client (+ :check) ──────────────────────────────
  // Idempotent: if EITHER FE script already exists, leave that wiring to the
  // user (their artifact path / generator choice may differ from ours). We do
  // not backfill the missing counterpart.
  const hasGenerate = SCRIPT_GENERATE in scripts;
  const hasCheck = SCRIPT_CHECK in scripts;
  if (!hasGenerate && !hasCheck) {
    scripts[SCRIPT_GENERATE] = GENERATE_CMD;
    scripts[SCRIPT_CHECK] = CHECK_CMD;
    added.push(SCRIPT_GENERATE, SCRIPT_CHECK);
    notes.push(`${SCRIPT_GENERATE} requires openapi-typescript (\`npm i -D openapi-typescript\`); edit the output path (${CLIENT_OUT}) to fit your project, then wire \`npm run ${SCRIPT_CHECK}\` into CI`);
  }

  // ── Backend half: contract:models (FastAPI only) ───────────────────────────
  // Generated Pydantic models declared as a route's response_model make FastAPI
  // enforce the contracted response shape at runtime (ADR 0007). Wired only for
  // FastAPI — the stack where this yields automatic enforcement.
  const hasModels = SCRIPT_MODELS in scripts;
  if (!hasModels && detectsFastApi(cwd)) {
    scripts[SCRIPT_MODELS] = MODELS_CMD;
    added.push(SCRIPT_MODELS);
    notes.push(`${SCRIPT_MODELS} requires datamodel-code-generator (\`pip install datamodel-code-generator\`); edit the output path (${MODELS_OUT}), then declare the generated models as each route's response_model so FastAPI enforces the contracted shape`);
  }

  if (added.length === 0) {
    const present = [
      hasGenerate ? SCRIPT_GENERATE : '',
      hasCheck ? SCRIPT_CHECK : '',
      hasModels ? SCRIPT_MODELS : '',
    ].filter(Boolean).join(' + ');
    return {
      added: [],
      skipped: present
        ? `${present} already present in package.json; leaving codegen wiring to you`
        : 'no codegen wiring applicable (no FE scripts to add; FastAPI not detected)',
    };
  }

  pkg.scripts = scripts;
  // Preserve the file's trailing-newline convention.
  const trailing = raw.endsWith('\n') ? '\n' : '';
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + trailing, 'utf8');

  return { added, note: notes.join('; ') };
}
