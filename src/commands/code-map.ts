import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { createHash } from 'crypto';
import { log } from '../utils/logger.js';
import { renderYaml } from '../code-map/yaml-writer.js';
import { walkRepo, bucketByExtension, scanInProcess } from '../code-map/orchestrator.js';
import { loadCodeMapConfig } from '../code-map/config.js';
import { sidecarPathFor, loadCodeMapEntries } from '../code-map/index-reader.js';
import { canonicalRelPath } from '../code-map/scanners/common.js';
import { buildCodeGraph } from '../code-graph/builder.js';
import { loadPathAliases } from '../code-graph/tsconfig-paths.js';
import { graphPathFor } from '../code-graph/reader.js';
import { sha256OfFileNormalized } from '../utils/digest.js';
import { ensureGitignoreEntry } from '../utils/gitignore.js';
import type { Scanner, ScannerResult, FileEntry } from '../code-map/types.js';

/**
 * Compute a stable digest of the source files included in a code-map run.
 * Each entry is rendered as `<repo-relative-path>:<sha256-of-content>`,
 * sorted, joined with newlines, then sha256-hashed.
 *
 * Used by `cdd-kit gate` and `cdd-kit doctor` to verify map freshness
 * without relying on mtime (which is unreliable after git clone).
 */
export function computeSourcesDigest(absolutePaths: string[], cwd: string): string {
  // Use sha256OfFileNormalized so the digest is stable across CRLF/LF line
  // endings — without normalization, a file checked out with autocrlf=true
  // (Windows default) produces a different digest than the same file on
  // Linux/Mac, even though both are bit-identical post-conversion.
  const lines = absolutePaths.slice().sort()
    .map(p => {
      const rel = relative(cwd, p).replace(/\\/g, '/');
      const contentHash = sha256OfFileNormalized(p) || 'missing';
      return `${rel}:${contentHash}`;
    });
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

// Read package version at runtime
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { join } from 'path';

const _require = createRequire(import.meta.url);
const _pkgPath = join(fileURLToPath(import.meta.url), '..', '..', '..', 'package.json');
const _pkg = JSON.parse(readFileSync(_pkgPath, 'utf8')) as { version: string };

export interface CodeMapOptions {
  path: string;
  out?: string;
  /**
   * Monorepo sugar: scope the scan to this subtree and, unless `out` is set
   * explicitly, name the map `.cdd/code-map.<slug>.yml`. Query it later with
   * `cdd-kit index query <term> --map .cdd/code-map.<slug>.yml`.
   */
  surface?: string;
  /**
   * Parallelize JS/TS/Vue scanning across this many child processes. 0/1 = the
   * default single-process path. Opt-in via `cdd-kit code-map --workers`.
   */
  workers?: number;
  include: string[];
  exclude: string[];
  check: boolean;
  maxLines: number;
  silent?: boolean;
}

/** `packages/web` -> `packages-web`; used for the per-surface map filename. */
export function slugifySurface(surface: string): string {
  return surface.replace(/^[./]+/, '').replace(/\/+$/, '').replace(/[\\/]+/g, '-') || 'root';
}

export async function codeMap(opts: CodeMapOptions): Promise<number> {
  const start = Date.now();

  if (opts.surface) {
    const resolvedSurface = resolve(process.cwd(), opts.surface);
    if (!existsSync(resolvedSurface)) {
      log.error(`code-map --surface path not found: ${opts.surface}`);
      return 1;
    }
  }

  const scanPath = opts.surface ?? opts.path;
  const root = resolve(process.cwd(), scanPath);
  // Repo-relative surface root, recorded in the map header so --with-source can
  // resolve surface-relative entry paths back to real files.
  const surfaceRoot = opts.surface
    ? (relative(process.cwd(), root).replace(/\\/g, '/') || '.')
    : undefined;
  const out = opts.out
    ?? (opts.surface ? `.cdd/code-map.${slugifySurface(opts.surface)}.yml` : '.cdd/code-map.yml');

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

  // Optional parallelism for the in-process (Babel) scanners. Default off; the
  // child worker re-runs this same CLI, so it only works when invoked through
  // it (process.argv[1] resolvable) — otherwise we transparently use one process.
  const cliEntry = process.argv[1];
  const workers = opts.workers ?? 0;
  const useWorkers = workers > 1 && typeof cliEntry === 'string' && cliEntry.length > 0;
  const dispatch = async (scanner: Scanner, lang: string, langFiles: string[]): Promise<ScannerResult> => {
    if (!useWorkers) return scanInProcess(scanner, langFiles, root);
    const { scanLangWithWorkers } = await import('../code-map/worker-dispatch.js');
    return scanLangWithWorkers(scanner, lang, langFiles, root, workers, cliEntry);
  };

  // Dynamically import scanners (batch 2–4 will provide them)
  const tasks: Promise<ScannerResult>[] = [];

  // Python scanner (batch path) — already runs in its own subprocess.
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
    tasks.push(dispatch(jsScanner, 'js', jsFiles));
  }

  // TypeScript scanner — handles .ts / .tsx
  const tsFiles = [
    ...(buckets['.ts'] ?? []),
    ...(buckets['.tsx'] ?? []),
  ];
  if (tsFiles.length) {
    const { tsScanner } = await import('../code-map/scanners/typescript.js');
    tasks.push(dispatch(tsScanner, 'ts', tsFiles));
  }

  // Vue scanner
  if (buckets['.vue']?.length) {
    const { vueScanner } = await import('../code-map/scanners/vue.js');
    tasks.push(dispatch(vueScanner, 'vue', buckets['.vue']));
  }

  for (const r of await Promise.all(tasks)) {
    result.entries.push(...r.entries);
    result.warnings.push(...r.warnings);
  }

  // Last-good retention: a file that failed to parse this run is absent from
  // `entries`, which would make it VANISH from the index — exactly the trap
  // when an agent re-queries while a file is mid-edit and momentarily broken.
  // Carry over its previous entry (marked stale) so its symbols stay
  // queryable until the syntax is valid again. Only files that HAD a prior
  // entry are retained; genuinely new unparseable files still drop.
  if (existsSync(out)) {
    const presentPaths = new Set(result.entries.map(e => e.path));
    const missing = files
      .map(abs => canonicalRelPath(abs, root))
      .filter(rel => !presentPaths.has(rel));
    if (missing.length > 0) {
      let previous: FileEntry[] = [];
      try { previous = loadCodeMapEntries(out); } catch { previous = []; }
      const prevByPath = new Map(previous.map(e => [e.path, e]));
      for (const rel of missing) {
        const prev = prevByPath.get(rel);
        if (prev) {
          result.entries.push({ ...prev, stale: true });
          if (!opts.silent) log.warn(`${rel}: parse failed — retained last-good map entry (stale)`);
        }
      }
    }
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

  // Compute digest from EVERY file the orchestrator considered (including
  // those that produced parse-warning entries) — sources-digest tracks "what
  // bytes did we look at", independent of parse success.
  const sourcesDigest = computeSourcesDigest(files, root);
  const yamlBody = renderYaml(result.entries, {
    generator: `cdd-kit ${_pkg.version}`,
    sourcesDigest,
    surfaceRoot,
  });
  const totalSrc = result.entries.reduce((s, e) => s + e.total_lines, 0);
  const mapLines = yamlBody.split('\n').length;
  const compression = totalSrc === 0 ? 0 : totalSrc / mapLines;
  const summaryLine = `scanned ${result.entries.length} files, ${totalSrc} src lines -> ${out} (${mapLines} lines, compression ${compression.toFixed(1)}x)`;

  for (const w of result.warnings) {
    if (!opts.silent) log.warn(`${w.path}: ${w.message}`);
  }

  if (opts.check) {
    const existing = existsSync(out) ? readFileSync(out, 'utf8') : '';
    // Normalize before comparing:
    //  1. Strip the generator-timestamp line (always differs run-to-run)
    //  2. Convert CRLF/CR → LF — handles the case where git autocrlf=true
    //     stored CRLF on disk while we always emit LF. Without this, every
    //     commit on Windows triggers a spurious "would regenerate" even
    //     when content is bit-identical (post-normalization).
    const normalize = (s: string): string =>
      s
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/^# generated: [^\n]+\n/m, '# generated: <normalized>\n');
    if (normalize(existing) !== normalize(yamlBody)) {
      if (!opts.silent) log.error(`code-map out of date: ${out} would change. Run \`cdd-kit code-map\` to regenerate.`);
      return 1;
    }
    if (!opts.silent) log.ok(`code-map up to date: ${out}`);
    return 0;
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, yamlBody, 'utf8');

  // Write a parsed JSON sidecar next to the map. `index query` / `index impact`
  // read it in preference to re-running yaml.load (much slower on large maps),
  // validated against this run's sources-digest. It is a derived local cache —
  // gitignored, regenerated on every map run, and safe to delete.
  try {
    const sidecarPath = sidecarPathFor(out);
    writeFileSync(sidecarPath, JSON.stringify({ sourcesDigest, entries: result.entries }), 'utf8');
    const rel = relative(process.cwd(), sidecarPath).replace(/\\/g, '/');
    if (!rel.startsWith('..')) {
      ensureGitignoreEntry(process.cwd(), rel, 'cdd-kit local cache (do not commit)');
    }
    const graphPath = graphPathFor(out);
    const aliasResolver = loadPathAliases(root);
    const graph = buildCodeGraph(result.entries, {
      generator: `cdd-kit ${_pkg.version}`,
      sourcesDigest,
      ...(aliasResolver ? { aliasResolver } : {}),
    });
    writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf8');
    const graphRel = relative(process.cwd(), graphPath).replace(/\\/g, '/');
    if (!graphRel.startsWith('..')) {
      ensureGitignoreEntry(process.cwd(), graphRel, 'cdd-kit local cache (do not commit)');
    }
  } catch {
    // The sidecar is an optimization only — never fail the map write for it.
  }

  if (!opts.silent) log.ok(`${summaryLine} (${Date.now() - start}ms)`);
  return 0;
}
