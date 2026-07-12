import { build } from 'esbuild';
import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 0. Drift guard: scripts/ at repo root is forbidden ───────────────────────
// The skill scripts at .claude/skills/contract-driven-delivery/scripts/ are
// the single source of truth. A duplicate at ./scripts/ silently drifts and
// is precisely the failure mode this kit is meant to prevent.
const rootScripts = join(__dirname, 'scripts');
if (existsSync(rootScripts)) {
  console.error(
    'Build aborted: ./scripts/ exists at repo root.\n' +
    '  Skill scripts at .claude/skills/contract-driven-delivery/scripts/ are the single source of truth.\n' +
    '  Remove ./scripts/ (or move new helpers into the skill scripts directory) and rebuild.'
  );
  process.exit(1);
}

// ── 1. Bundle TypeScript CLI ──────────────────────────────────────────────────
// commander is CJS; bundling into ESM produces a dynamic-require shim that
// crashes at runtime. Keep it external — it is listed in dependencies and npm
// will install it alongside this package automatically.
const distDir = join(__dirname, 'dist');
if (existsSync(distDir)) { rmSync(distDir, { recursive: true, force: true }); console.log('Cleaned dist/'); }

await build({
  entryPoints: [join(__dirname, 'src/cli/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(__dirname, 'dist/cli/index.js'),
  external: ['commander', '@babel/parser', '@vue/compiler-sfc', 'js-yaml', 'picomatch'],
  sourcemap: false,
  minify: false,
});
console.log('Built dist/cli/index.js');

// ── 2. Copy kit assets → assets/ ─────────────────────────────────────────────
// Assets are cleaned and rebuilt only after a successful esbuild step,
// so a failed compile never leaves an empty assets/ directory.
const assetsDir = join(__dirname, 'assets');
if (existsSync(assetsDir)) { rmSync(assetsDir, { recursive: true, force: true }); console.log('Cleaned assets/'); }
const shouldCopyAsset = (srcPath) => {
  const normalized = srcPath.replace(/\\/g, '/');
  return !(
    normalized.includes('/__pycache__/') ||
    normalized.endsWith('.pyc') ||
    normalized.includes('/.pytest_cache/') ||
    normalized.includes('/.mypy_cache/') ||
    normalized.includes('/.ruff_cache/')
  );
};

const copy = (src, dest) => {
  const srcPath = join(__dirname, src);
  const destPath = join(__dirname, dest);
  if (!existsSync(srcPath)) {
    console.warn(`Warning: source not found, skipping: ${src}`);
    return;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  cpSync(srcPath, destPath, { recursive: true, filter: shouldCopyAsset });
  console.log(`Copied ${src} → ${dest}`);
};

copy('.claude/agents',  'assets/agents');
copy('.claude/skills', 'assets/skills');
copy('.agents/skills', 'assets/codex-skills');
copy('doctrine', 'assets/doctrine');
copy('contracts',      'assets/contracts');

// contracts/ is dual-purpose: it is BOTH this repo's own dogfooded contracts
// (what `cdd-kit validate`/`gate` enforce when run from the kit's own repo
// root) AND the master template `cdd-kit init` copies into every new project
// (src/commands/init.ts copies ASSET.contracts verbatim into <project>/contracts/).
// ADR 0011 marks the kit's own contracts/{api,css,business,data} as
// `applicability: not-applicable` because a CLI genuinely has none of those
// surfaces — but that reason does not hold for an arbitrary new project a
// user is about to build (most have an API/CSS/business-logic surface). The
// asset copy strips the marker so a fresh `cdd-kit init` still ships neutral,
// unmarked stub contracts that fail validate/gate until the adopter actually
// fills them in (or makes their own informed not-applicable decision) — the
// safety net `test/cli/validate.test.ts` / `test/cli/gate.test.ts` pin.
const APPLICABILITY_MARKED_TEMPLATES = [
  'assets/contracts/api/api-contract.md',
  'assets/contracts/css/css-contract.md',
  'assets/contracts/business/business-rules.md',
  'assets/contracts/data/data-shape-contract.md',
];
for (const rel of APPLICABILITY_MARKED_TEMPLATES) {
  const abs = join(__dirname, rel);
  if (!existsSync(abs)) continue;
  const before = readFileSync(abs, 'utf8');
  const after = before
    .replace(/^applicability:.*\n/m, '')
    .replace(/^applicability-reason:.*\n/m, '');
  if (after !== before) {
    writeFileSync(abs, after, 'utf8');
    console.log(`Stripped applicability marker from shipped template: ${rel}`);
  }
}
copy('specs/templates',                         'assets/specs-templates');
copy('tests/templates',                         'assets/tests-templates');
copy('contract-harness',                        'assets/contract-harness');
copy('ci',                                      'assets/ci');
copy('github-workflows',                        'assets/github-workflows');
copy('ci-templates',                             'assets/ci-templates');
copy('hooks',                                   'assets/hooks');
copy('CLAUDE.template.md',                      'assets/CLAUDE.template.md');
copy('CODEX.template.md',                       'assets/CODEX.template.md');
copy('AGENTS.template.md',                      'assets/AGENTS.template.md');
// `cdd-kit init` scaffolds a new project's `.cdd/` from `assets/cdd/`, so ANYTHING
// left here is planted in every adopter's repository. This is an ALLOWLIST, not a
// denylist, and that distinction is the whole fix.
//
// It was a denylist. It excluded the code-map artifacts and missed two: this
// machine's `asset-manifest.json` (so a fresh `init` inherited cdd-kit's own install
// stamps and `doctor` immediately reported drift), and `acceptance-lock.json` —
// cdd-kit's own ADR 0010 hash-locked acceptance baselines, a human-owned answer key,
// shipped into strangers' repositories and keyed by change-id.
//
// A denylist is a promise to remember every future runtime artifact. `.cdd/runtime/`,
// `.cdd/code-map.<surface>.yml`, a backup directory, tomorrow's sidecar — each would
// have shipped. Only these four static policy/config files belong in the package.
const SHIPPED_CDD_FILES = [
  'conformance.json',
  'context-policy.json',
  'model-policy.json',
  'tier-policy.json',
  'policy.yml',
  'approval-policy.yml',
];
// Wipe first: `assets/` is not cleaned between builds, so anything a previous
// denylist build left behind would survive the switch to an allowlist.
rmSync(join(__dirname, 'assets/cdd'), { recursive: true, force: true });
mkdirSync(join(__dirname, 'assets/cdd'), { recursive: true });
for (const name of SHIPPED_CDD_FILES) {
  const src = join(__dirname, '.cdd', name);
  if (existsSync(src)) copy(join('.cdd', name), join('assets/cdd', name));
  else console.log(`WARNING: .cdd/${name} is missing; adopters will not receive it`);
}
copy('src/code-map/python',                     'assets/code-map');

console.log('Build complete.');
