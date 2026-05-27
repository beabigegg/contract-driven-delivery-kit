import { readFileSync } from 'fs';
import { parse } from '@vue/compiler-sfc';
import type { Scanner, FileEntry, FunctionEntry, ClassEntry, ImportEntry, ConstantEntry, ScannerWarning, CallEntry, ExportEntry } from '../types.js';
import { canonicalRelPath, isBinary } from './common.js';
import { parseJsSource } from './javascript.js';

class VueScanner implements Scanner {
  readonly extensions = ['.vue'] as const;

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

    const relPath = canonicalRelPath(absolutePath, repoRoot);

    // Total lines for the whole .vue file
    const total_lines = source.split(/\r?\n/).length - (source.endsWith('\n') || source.endsWith('\r\n') ? 1 : 0);

    const { descriptor } = parse(source, { filename: absolutePath });

    const allImports: ImportEntry[] = [];
    const allConstants: ConstantEntry[] = [];
    const allFunctions: FunctionEntry[] = [];
    const allClasses: ClassEntry[] = [];
    const allCalls: CallEntry[] = [];
    const allExports: ExportEntry[] = [];
    const warnings: ScannerWarning[] = [];

    const scriptBlocks = [descriptor.script, descriptor.scriptSetup].filter(Boolean);

    if (scriptBlocks.length === 0) {
      // No script blocks — return empty entry
      return {
        path: relPath,
        total_lines,
        imports: [],
        constants: [],
        classes: [],
        functions: [],
      };
    }

    for (const block of scriptBlocks) {
      if (!block) continue;

      // Skip TypeScript blocks
      if (block.lang === 'ts' || block.lang === 'tsx') {
        warnings.push({
          path: relPath,
          message: `skipping <script lang=${block.lang}> block (TypeScript not supported in v1)`,
        });
        continue;
      }

      const blockContent = block.content;
      // block.loc.start.line is 1-based, file-relative
      // The content starts at block.loc.start.line
      // We need to add (block.loc.start.line - 1) to remap from script-relative to file-relative
      const lineOffset = block.loc.start.line;  // content starts at this line in the file

      // Parse the script block content as JS
      // Use a temp rel path for parsing, we'll fix up line numbers
      const scriptEntry = parseJsSource(blockContent, relPath);
      if (!scriptEntry) {
        // parse error in script block — skip with warning
        warnings.push({ path: relPath, message: 'parse error in script block' });
        continue;
      }

      // Remap line numbers: script-relative → file-relative
      // block.loc.start.line is the line in the file where the content begins
      const offset = lineOffset - 1;  // script line 1 → file line (lineOffset)

      for (const imp of scriptEntry.imports) {
        allImports.push({ ...imp, line: imp.line + offset });
      }
      for (const c of scriptEntry.constants) {
        allConstants.push({ ...c, line: c.line + offset });
      }
      for (const fn of scriptEntry.functions) {
        allFunctions.push({
          ...fn,
          lines: [fn.lines[0] + offset, fn.lines[1] + offset],
        });
      }
      for (const cls of scriptEntry.classes) {
        allClasses.push({
          ...cls,
          lines: [cls.lines[0] + offset, cls.lines[1] + offset],
          methods: cls.methods.map(m => ({
            ...m,
            lines: [m.lines[0] + offset, m.lines[1] + offset] as [number, number],
          })),
        });
      }
      for (const call of scriptEntry.calls ?? []) {
        allCalls.push({ ...call, line: call.line + offset });
      }
      for (const exp of scriptEntry.exports ?? []) {
        allExports.push({ ...exp, line: exp.line + offset });
      }
    }

    return {
      path: relPath,
      total_lines,
      imports: allImports,
      constants: allConstants,
      classes: allClasses,
      functions: allFunctions,
      calls: allCalls,
      exports: allExports,
    };
  }
}

export const vueScanner = new VueScanner();
