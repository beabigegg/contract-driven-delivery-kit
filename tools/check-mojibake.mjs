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
 *   1. a literal `??` (the signature of a UTF-8 -> ASCII round-trip),
 *   2. a private-use (U+E000-U+F8FF), C1-control (U+0080-U+009F), or
 *      lone-surrogate code point, or
 *   3. a literalized escape glued mid-text (word + backtick + n/t/r + word),
 *      the signature of a PowerShell-style `n / `t / `r that was meant to be a
 *      real newline/tab. A genuine inline code span is preceded by whitespace
 *      or punctuation, so this adjacency does not match legitimate `code`.
 *
 * Markdown only: TypeScript/JavaScript `??` is the nullish-coalescing operator
 * and is intentionally not scanned.
 *
 * Scope: the shipped, English, LLM-facing surface (agent prompts, skills, ADRs,
 * the README, and user-facing templates). Per-change working docs under
 * `specs/` are intentionally excluded -- they may be authored in any language
 * (the kit's own `specs/changes/.../plan.md` is Traditional Chinese), so a
 * lone-CJK heuristic does not apply there.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// assets/ is gitignored build output (a copy of the sources scanned below).
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'assets']);

// Explicit shipped-prompt/doc roots (files or directories), relative to ROOT.
const SCAN_TARGETS = [
  '.claude/agents',
  '.claude/skills',
  'docs',
  'contracts',
  'specs/templates', // scaffolds copied into every `cdd-kit new` change
  'tests/templates',
  'README.md',
  'AGENTS.template.md',
  'CLAUDE.template.md',
  'CODEX.template.md',
];

/** Recursively collect `.md` files under a directory, skipping build/vendor dirs. */
function collectDir(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collectDir(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Resolve SCAN_TARGETS (files + directories) into a flat `.md` file list. */
function collectTargets() {
  const out = [];
  for (const target of SCAN_TARGETS) {
    const full = join(ROOT, target);
    if (!existsSync(full)) continue;
    const st = statSync(full);
    if (st.isDirectory()) collectDir(full, out);
    else if (full.endsWith('.md')) out.push(full);
  }
  return out;
}

// word + backtick + n/t/r + word: a literalized `n / `t / `r escape, never a
// real inline code span (those are preceded by whitespace or punctuation).
const ESCAPE_RE = /[A-Za-z0-9]`[ntr][A-Za-z0-9]/;

// UTF-8-decoded-as-Windows-1252 mojibake: printable code points that no garbage
// range covers. `â€` (U+00E2 U+20AC) precedes corrupted smart quotes/dashes;
// `Ã`/`Â` + a Latin-1 continuation byte is the classic two-byte mis-decode.
// None of these occur in legitimate English prompt text.
const CP1252_RE = /\u00e2\u20ac|\u00c3[\u0080-\u00bf]|\u00c2[\u00a0-\u00bf]/;

// CJK / fullwidth ranges. Used only to flag a *lone* CJK char (mojibake), so a
// real Chinese run is not penalized.
const isCJK = (cp) =>
  cp !== undefined &&
  ((cp >= 0x3000 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xffef));

const findings = [];
for (const file of collectTargets()) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const ln = i + 1;
    if (line.includes('??')) {
      findings.push(`${rel}:${ln}: literal '??' (mojibake) -> ${line.trim().slice(0, 100)}`);
    }
    if (ESCAPE_RE.test(line)) {
      findings.push(`${rel}:${ln}: literalized escape (\`n/\`t/\`r) in text -> ${line.trim().slice(0, 100)}`);
    }
    if (CP1252_RE.test(line)) {
      findings.push(`${rel}:${ln}: Windows-1252 mojibake sequence -> ${line.trim().slice(0, 100)}`);
    }
    const cps = [...line].map((c) => c.codePointAt(0));
    for (let j = 0; j < cps.length; j++) {
      const cp = cps[j];
      const garbage =
        cp === 0xfffd || // UTF-8 replacement char (malformed-byte decode / `replace`)
        (cp >= 0x80 && cp <= 0x9f) || // C1 controls
        (cp >= 0xe000 && cp <= 0xf8ff) || // private use
        (cp >= 0xd800 && cp <= 0xdfff); // surrogates
      // A lone CJK code point wedged into otherwise-Latin text is mojibake
      // (e.g. `?圳`, `禮`). A genuine CJK run (future i18n) is left alone.
      const loneCJK = isCJK(cp) && !isCJK(cps[j - 1]) && !isCJK(cps[j + 1]);
      if (garbage || loneCJK) {
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
