import { build } from 'esbuild';
import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  external: ['commander'],
  sourcemap: false,
  minify: false,
});
console.log('Built dist/cli/index.js');

// ── 2. Copy kit assets → assets/ ─────────────────────────────────────────────
// Assets are cleaned and rebuilt only after a successful esbuild step,
// so a failed compile never leaves an empty assets/ directory.
const assetsDir = join(__dirname, 'assets');
if (existsSync(assetsDir)) { rmSync(assetsDir, { recursive: true, force: true }); console.log('Cleaned assets/'); }
const copy = (src, dest) => {
  const srcPath = join(__dirname, src);
  const destPath = join(__dirname, dest);
  if (!existsSync(srcPath)) {
    console.warn(`Warning: source not found, skipping: ${src}`);
    return;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  cpSync(srcPath, destPath, { recursive: true });
  console.log(`Copied ${src} → ${dest}`);
};

copy('.claude/agents',                          'assets/agents');
copy('.claude/skills/contract-driven-delivery', 'assets/skill');
copy('contracts',                               'assets/contracts');
copy('specs/templates',                         'assets/specs-templates');
copy('tests/templates',                         'assets/tests-templates');
copy('ci',                                      'assets/ci');
copy('CLAUDE.template.md',                      'assets/CLAUDE.template.md');
copy('AGENTS.template.md',                      'assets/AGENTS.template.md');

console.log('Build complete.');
