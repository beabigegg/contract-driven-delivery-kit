import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { log } from '../utils/logger.js';
import { renderYaml } from '../code-map/yaml-writer.js';
import { walkRepo, bucketByExtension, scanInProcess } from '../code-map/orchestrator.js';
import { loadCodeMapConfig } from '../code-map/config.js';
import type { ScannerResult } from '../code-map/types.js';

// Read package version at runtime
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { join } from 'path';

const _require = createRequire(import.meta.url);
const _pkgPath = join(fileURLToPath(import.meta.url), '..', '..', '..', 'package.json');
const _pkg = JSON.parse(readFileSync(_pkgPath, 'utf8')) as { version: string };

export interface CodeMapOptions {
  path: string;
  out: string;
  include: string[];
  exclude: string[];
  check: boolean;
  maxLines: number;
}

export async function codeMap(opts: CodeMapOptions): Promise<number> {
  const root = resolve(process.cwd(), opts.path);
  const start = Date.now();

  // Resolve config: built-in defaults, optionally replaced by .cdd/code-map-config.yml.
  // CLI --include / --exclude are appended on top of whichever lists won.
  let cfg;
  try {
    cfg = loadCodeMapConfig(root);
  } catch (err) {
    log.error(`code-map: ${(err as Error).message}`);
    return 1;
  }
  const include = [...cfg.include, ...opts.include];
  const exclude = [...cfg.exclude, ...opts.exclude];

  const files = walkRepo(root, { include, exclude });
  const buckets = bucketByExtension(files);

  const result: ScannerResult = { entries: [], warnings: [] };

  // Dynamically import scanners (batch 2–4 will provide them)
  const tasks: Promise<ScannerResult>[] = [];

  // Python scanner (batch path)
  if (buckets['.py']?.length) {
    const { pythonScanner } = await import('../code-map/scanners/python.js');
    if (pythonScanner.scanBatch) {
      tasks.push(pythonScanner.scanBatch(buckets['.py'], root));
    }
  }

  // JS scanner — handles .js / .jsx / .mjs / .cjs
  const jsFiles = [
    ...(buckets['.js'] ?? []),
    ...(buckets['.jsx'] ?? []),
    ...(buckets['.mjs'] ?? []),
    ...(buckets['.cjs'] ?? []),
  ];
  if (jsFiles.length) {
    const { jsScanner } = await import('../code-map/scanners/javascript.js');
    tasks.push(scanInProcess(jsScanner, jsFiles, root));
  }

  // TypeScript scanner — handles .ts / .tsx
  const tsFiles = [
    ...(buckets['.ts'] ?? []),
    ...(buckets['.tsx'] ?? []),
  ];
  if (tsFiles.length) {
    const { tsScanner } = await import('../code-map/scanners/typescript.js');
    tasks.push(scanInProcess(tsScanner, tsFiles, root));
  }

  // Vue scanner
  if (buckets['.vue']?.length) {
    const { vueScanner } = await import('../code-map/scanners/vue.js');
    tasks.push(scanInProcess(vueScanner, buckets['.vue'], root));
  }

  for (const r of await Promise.all(tasks)) {
    result.entries.push(...r.entries);
    result.warnings.push(...r.warnings);
  }

  // Sort entries by canonical path (bytes-wise, locale-independent)
  result.entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // Max-lines warning
  for (const e of result.entries) {
    if (e.total_lines > opts.maxLines) {
      result.warnings.push({
        path: e.path,
        message: `file exceeds --max-lines (${e.total_lines} > ${opts.maxLines})`,
      });
    }
  }

  const yamlBody = renderYaml(result.entries, { generator: `cdd-kit ${_pkg.version}` });
  const totalSrc = result.entries.reduce((s, e) => s + e.total_lines, 0);
  const mapLines = yamlBody.split('\n').length;
  const compression = totalSrc === 0 ? 0 : totalSrc / mapLines;
  const summaryLine = `scanned ${result.entries.length} files, ${totalSrc} src lines -> ${opts.out} (${mapLines} lines, compression ${compression.toFixed(1)}x)`;

  for (const w of result.warnings) {
    log.warn(`${w.path}: ${w.message}`);
  }

  if (opts.check) {
    const existing = existsSync(opts.out) ? readFileSync(opts.out, 'utf8') : '';
    // Normalize the timestamp line before comparing — the generator date always differs
    const normalize = (s: string): string =>
      s.replace(/^# generated: [^\n]+\n/m, '# generated: <normalized>\n');
    if (normalize(existing) !== normalize(yamlBody)) {
      log.error(`code-map out of date: ${opts.out} would change. Run \`cdd-kit code-map\` to regenerate.`);
      return 1;
    }
    log.ok(`code-map up to date: ${opts.out}`);
    return 0;
  }

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, yamlBody, 'utf8');
  log.ok(`${summaryLine} (${Date.now() - start}ms)`);
  return 0;
}
