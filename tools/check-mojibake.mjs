#!/usr/bin/env node
/**
 * Mojibake guard for shipped prompt/doc markdown.
 *
 * Agent prompts (`.claude/agents/*.md`), skills (`.claude/skills/**`), the
 * README, ADRs, and user-facing templates are loaded verbatim into an LLM
 * context. Encoding corruption there is not cosmetic: `A ?? B` destroys the
 * meaning of `A -> B`, and private-use / control bytes waste tokens for worse
 * instruction-following. This guard fails CI if any shipped markdown reintroduces:
 *
 *   1. a literal `??` (the signature of a UTF-8 -> ASCII round-trip), or
 *   2. a private-use (U+E000-U+F8FF), C1-control (U+0080-U+009F), or
 *      lone-surrogate code point.
 *
 * Markdown only: TypeScript/JavaScript `??` is the nullish-coalescing operator
 * and is intentionally not scanned.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

/** Recursively collect tracked-style `.md` files, skipping build/vendor dirs. */
function collect(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collect(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

const findings = [];
for (const file of collect(ROOT, [])) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const ln = i + 1;
    if (line.includes('??')) {
      findings.push(`${rel}:${ln}: literal '??' (mojibake) -> ${line.trim().slice(0, 100)}`);
    }
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      const garbage =
        (cp >= 0x80 && cp <= 0x9f) || // C1 controls
        (cp >= 0xe000 && cp <= 0xf8ff) || // private use
        (cp >= 0xd800 && cp <= 0xdfff); // surrogates
      if (garbage) {
        findings.push(`${rel}:${ln}: corrupt code point U+${cp.toString(16).toUpperCase()} -> ${line.trim().slice(0, 100)}`);
        break;
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`Mojibake guard failed: ${findings.length} issue(s) in shipped markdown.\n`);
  for (const f of findings) console.error('  ' + f);
  console.error('\nReplace corruption with the intended UTF-8 glyph (e.g. -> with the arrow, em/en dashes, >=, emoji).');
  process.exit(1);
}

console.log('Mojibake guard passed: no corruption in shipped markdown.');
