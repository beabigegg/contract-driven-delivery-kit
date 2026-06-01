import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Wire a contract→client codegen chokepoint into the consumer's package.json.
 *
 * Per docs/adr/0001-contract-to-openapi-export.md, the kit owns the generic
 * contract→OpenAPI projection; the stack-specific client codegen stays in the
 * consumer repo. The risk is leaving that consumer half as prose (a doc the
 * agent ignores). This materializes it as two npm scripts the human can edit:
 *
 *   contract:client        regenerate the OpenAPI artifact + the typed client
 *   contract:client:check  fail if the artifact drifted from the contract (CI gate)
 *
 * It is deliberately conservative: it only acts when a package.json exists (the
 * signal that there is a JS/TS side to consume a typed client), it never
 * overwrites pre-existing scripts, and it picks `openapi-typescript` — the
 * conventional TS generator — only as an editable default, logging what to
 * install and which path to adjust. The tool/version/output-path are the
 * consumer's preference, so detection fills a default, it does not decide.
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

const SCRIPT_GENERATE = 'contract:client';
const SCRIPT_CHECK = 'contract:client:check';

const GENERATE_CMD =
  `cdd-kit openapi export --out ${ARTIFACT_PATH} && ` +
  `npx --yes openapi-typescript ${ARTIFACT_PATH} -o ${CLIENT_OUT}`;
const CHECK_CMD = `cdd-kit openapi export --check --out ${ARTIFACT_PATH}`;

export function suggestCodegenScript(cwd: string): CodegenSuggestion {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    // No JS/TS side detected. Client codegen is consumer-specific; we cannot
    // pick a conventional tool for an arbitrary backend language, so we stay
    // out of the way rather than guess.
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

  // Idempotent: if EITHER script already exists, leave the wiring entirely to
  // the user. We deliberately do not backfill the missing counterpart — once a
  // user owns one half, our hardcoded artifact path (or generator choice) may
  // not match theirs, so injecting the other half could be wrong. We just report
  // accurately which half we found.
  const hasGenerate = SCRIPT_GENERATE in scripts;
  const hasCheck = SCRIPT_CHECK in scripts;
  if (hasGenerate || hasCheck) {
    const present = [hasGenerate ? SCRIPT_GENERATE : '', hasCheck ? SCRIPT_CHECK : ''].filter(Boolean).join(' + ');
    return { added: [], skipped: `${present} already present in package.json; leaving codegen wiring to you` };
  }

  scripts[SCRIPT_GENERATE] = GENERATE_CMD;
  scripts[SCRIPT_CHECK] = CHECK_CMD;
  pkg.scripts = scripts;

  // Preserve the file's trailing-newline convention.
  const trailing = raw.endsWith('\n') ? '\n' : '';
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + trailing, 'utf8');

  return {
    added: [SCRIPT_GENERATE, SCRIPT_CHECK],
    note:
      `requires openapi-typescript (\`npm i -D openapi-typescript\`); ` +
      `edit the output path (${CLIENT_OUT}) to fit your project, then wire \`npm run ${SCRIPT_CHECK}\` into CI`,
  };
}
