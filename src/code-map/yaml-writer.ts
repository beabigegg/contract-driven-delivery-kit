import type { FileEntry, ClassEntry, FunctionEntry } from './types.js';

const YAML_RESERVED = /[:[\]{},&*!|>'"%@`#]/;

/**
 * Quote a YAML scalar value if it contains characters that need quoting.
 * Relative imports starting with '.' MUST be quoted.
 */
function quoteScalar(s: string): string {
  if (s.startsWith('.') || YAML_RESERVED.test(s) || s.includes(' ') || s === '' || s === 'null' || s === 'true' || s === 'false') {
    // Use single-quote quoting; escape internal single quotes as ''
    return `'${s.replace(/'/g, "''")}'`;
  }
  return s;
}

/**
 * Quote a YAML key (file path). Same rules as quoteScalar.
 */
function quotePath(p: string): string {
  if (YAML_RESERVED.test(p) || p.includes(' ')) {
    return `'${p.replace(/'/g, "''")}'`;
  }
  return p;
}

function renderItems(items: string[]): string {
  if (items.length === 0) return '[]';
  return `[${items.map(quoteScalar).join(', ')}]`;
}

function truncateDecorator(d: string, max = 80): string {
  // Replace newlines with spaces before truncating
  const cleaned = d.replace(/\r?\n/g, ' ');
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max) + '...';
}

function renderClass(c: ClassEntry): string[] {
  const lines: string[] = [];
  lines.push(`    - name: ${c.name}`);
  lines.push(`      lines: ${c.lines[0]}-${c.lines[1]}`);
  if (c.methods.length > 0) {
    lines.push('      methods:');
    for (const m of c.methods) {
      const asyncPrefix = m.async ? 'async ' : '';
      lines.push(`        - { name: ${asyncPrefix}${m.name}, lines: ${m.lines[0]}-${m.lines[1]} }`);
    }
  }
  return lines;
}

function renderFunction(f: FunctionEntry): string {
  const asyncPrefix = f.async ? 'async ' : '';
  let comment = '';
  if (f.decorators.length > 0) {
    const truncated = truncateDecorator(f.decorators[0]);
    comment = `  # @${truncated}`;
  }
  return `    - { name: ${asyncPrefix}${f.name}, lines: ${f.lines[0]}-${f.lines[1]} }${comment}`;
}

export interface RenderOptions {
  generator: string;  // e.g. "cdd-kit 2.0.5"
}

/**
 * Hand-rolled YAML renderer. NOT js-yaml.dump — uses inline flow style for
 * compactness matching the spike output.
 */
export function renderYaml(entries: FileEntry[], opts: RenderOptions): string {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const totalSrc = entries.reduce((s, e) => s + e.total_lines, 0);

  // Build body lines first to compute map-lines count
  const bodyLines: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i > 0) bodyLines.push('');  // blank line between files

    const pathKey = quotePath(e.path);
    bodyLines.push(`${pathKey}:  # ${e.total_lines} lines`);

    if (e.imports.length > 0) {
      bodyLines.push('  imports:');
      for (const imp of e.imports) {
        const mod = quoteScalar(imp.module);
        bodyLines.push(`    - { module: ${mod}, items: ${renderItems(imp.items)}, line: ${imp.line} }`);
      }
    }

    if (e.constants.length > 0) {
      bodyLines.push('  constants:');
      for (const c of e.constants) {
        bodyLines.push(`    - { name: ${c.name}, line: ${c.line} }`);
      }
    }

    if (e.classes.length > 0) {
      bodyLines.push('  classes:');
      for (const c of e.classes) {
        bodyLines.push(...renderClass(c));
      }
    }

    if (e.functions.length > 0) {
      bodyLines.push('  functions:');
      for (const f of e.functions) {
        bodyLines.push(renderFunction(f));
      }
    }
  }

  const mapLines = bodyLines.length + 2;  // +2 for header lines
  const compression = totalSrc === 0 ? 0 : totalSrc / mapLines;
  const fileCount = entries.length;

  const header = [
    `# generated: ${now} by ${opts.generator}`,
    `# files: ${fileCount}, src-lines: ${totalSrc}, map-lines: ${mapLines}, compression: ${compression.toFixed(1)}x`,
  ];

  return [...header, ...bodyLines].join('\n') + '\n';
}
