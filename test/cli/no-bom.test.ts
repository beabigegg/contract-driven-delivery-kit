import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const roots = [
  '.claude',
  'assets',
  'src',
  'test',
  'README.md',
  'CHANGELOG.md',
  'CLAUDE.template.md',
  'CODEX.template.md',
  'AGENTS.template.md',
];

function walk(path: string): string[] {
  if (!existsSync(path)) return [];

  const stat = statSync(path);
  if (stat.isFile()) return [path];

  return readdirSync(path).flatMap((entry) => {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') {
      return [];
    }
    return walk(join(path, entry));
  });
}

function hasUtf8Bom(path: string): boolean {
  const bytes = readFileSync(path);
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

describe('packaged text assets', () => {
  it('do not start with UTF-8 BOM', () => {
    const filesWithBom = roots
      .flatMap((root) => walk(join(repoRoot, root)))
      .filter(hasUtf8Bom)
      .map((path) => relative(repoRoot, path).replace(/\\/g, '/'));

    expect(filesWithBom).toEqual([]);
  });
});
