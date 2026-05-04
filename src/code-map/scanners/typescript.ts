import { readFileSync } from 'fs';
import type { ParserPlugin } from '@babel/parser';
import type { Scanner, FileEntry } from '../types.js';
import { canonicalRelPath, isBinary } from './common.js';
import { COMMON_PLUGINS, parseAndExtract, countSourceLines } from './javascript.js';

/**
 * TypeScript scanner — handles `.ts` and `.tsx`.
 *
 * Plugin selection:
 *   .ts  → ['typescript', ...COMMON_PLUGINS]          (no jsx; <T> is a generic)
 *   .tsx → ['typescript', 'jsx', ...COMMON_PLUGINS]   (jsx allowed; <T,> needed for generics)
 *
 * Babel's `typescript` and `jsx` plugins overlap on `<X>` syntax, which is why
 * they cannot both be enabled on `.ts`. We pick per-extension.
 *
 * Extracts everything the JS scanner does, plus:
 *   - interface declarations         (TSInterfaceDeclaration)
 *   - type aliases                   (TSTypeAliasDeclaration)
 *   - enums (with members)           (TSEnumDeclaration)
 */
class TypeScriptScanner implements Scanner {
  readonly extensions = ['.ts', '.tsx'] as const;

  async scan(absolutePath: string, repoRoot: string): Promise<FileEntry | null> {
    let source: string;
    try {
      source = readFileSync(absolutePath, 'utf8');
    } catch (err) {
      throw err;
    }

    if (isBinary(source)) {
      return null;
    }

    const isTsx = absolutePath.toLowerCase().endsWith('.tsx');
    const plugins: ParserPlugin[] = isTsx
      ? ['typescript', 'jsx', ...COMMON_PLUGINS]
      : ['typescript', ...COMMON_PLUGINS];

    const r = parseAndExtract(source, { plugins, extractTsTypes: true });
    if (!r) return null;

    const relPath = canonicalRelPath(absolutePath, repoRoot);
    const total_lines = countSourceLines(source);

    return {
      path: relPath,
      total_lines,
      imports: r.imports,
      constants: r.constants,
      classes: r.classes,
      functions: r.functions,
      interfaces: r.interfaces,
      types: r.types,
      enums: r.enums,
    };
  }
}

export const tsScanner = new TypeScriptScanner();
