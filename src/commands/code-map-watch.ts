import { watch, type FSWatcher } from 'fs';
import { resolve } from 'path';
import { log } from '../utils/logger.js';
import { codeMap, type CodeMapOptions } from './code-map.js';
import { checkCodeMapFreshness } from '../code-map/freshness.js';

/**
 * Background auto-indexing for `cdd-kit code-map --watch`.
 *
 * The default index is trigger-based: it regenerates when a command asks for it
 * (gate, index query --refresh, doctor --fix). That is the right default for
 * ephemeral CI containers and one-shot agent runs. But for a long-lived editing
 * session — a human and an agent co-editing a repo — re-deriving the whole map
 * on every query is wasteful, and a stale map between triggers misleads the
 * agent. `--watch` closes that window: it keeps the map fresh in the background,
 * debounced, so queries are always cheap and current.
 *
 * Industry practice (Serena, CocoIndex, tree-sitter-based indexers) converges on
 * a debounced file watcher with incremental re-parse. cdd-kit's scanners are not
 * yet incremental, so this rebuilds the whole map per debounce window; the
 * debounce keeps a burst of saves to a single rebuild. See
 * docs/adr/0003-code-intelligence-indexing-strategy.md for the rationale and the
 * incremental-rebuild follow-up.
 */

export interface CodeMapWatchOptions extends Omit<CodeMapOptions, 'check'> {
  /** Coalesce file-change events within this window into one rebuild. */
  debounceMs?: number;
  /** Polling-fallback interval when recursive fs.watch is unavailable. */
  pollMs?: number;
}

/**
 * A debounced runner that also guarantees a follow-up run when events arrive
 * while a rebuild is in flight (so the final state is never missed). Extracted
 * for unit testing — the fs.watch wiring around it stays thin.
 */
export function createDebouncedRunner(run: () => Promise<void>, debounceMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let queued = false;

  async function fire(): Promise<void> {
    if (running) { queued = true; return; }
    running = true;
    try {
      await run();
    } finally {
      running = false;
      if (queued) { queued = false; void fire(); }
    }
  }

  function trigger(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void fire(); }, debounceMs);
  }

  function dispose(): void {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  return { trigger, dispose };
}

export async function codeMapWatch(opts: CodeMapWatchOptions): Promise<number> {
  const debounceMs = opts.debounceMs ?? 500;
  const pollMs = opts.pollMs ?? 2000;
  const scanPath = opts.surface ?? opts.path;
  const root = resolve(process.cwd(), scanPath);

  const rebuild = async (): Promise<void> => {
    const exit = await codeMap({ ...opts, check: false, silent: true });
    if (exit === 0) {
      log.ok(`code-map refreshed (${new Date().toLocaleTimeString()})`);
    } else {
      log.warn('code-map refresh reported a problem; map left unchanged where possible.');
    }
  };

  // Initial build so the watcher starts from a known-fresh map.
  log.info(`code-map --watch: building initial map for ${scanPath}…`);
  await rebuild();

  const { trigger, dispose } = createDebouncedRunner(rebuild, debounceMs);

  let watcher: FSWatcher | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  try {
    // Recursive fs.watch is supported on macOS/Windows always and on Linux from
    // Node 20+. If it throws (older Linux), fall back to freshness polling.
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      // Ignore churn inside the index output dir to avoid self-triggering.
      if (filename && /(^|[\\/])\.cdd([\\/]|$)/.test(filename)) return;
      trigger();
    });
    log.ok(`watching ${scanPath} (recursive, debounce ${debounceMs}ms). Ctrl-C to stop.`);
  } catch {
    log.warn('recursive fs.watch unavailable on this platform; falling back to freshness polling.');
    pollTimer = setInterval(() => {
      const fresh = checkCodeMapFreshness(process.cwd(), opts.out ?? '.cdd/code-map.yml');
      if (fresh.status === 'stale' || fresh.status === 'missing-with-sources') trigger();
    }, pollMs);
    log.ok(`polling ${scanPath} every ${pollMs}ms. Ctrl-C to stop.`);
  }

  return await new Promise<number>((resolvePromise) => {
    const stop = (): void => {
      dispose();
      if (watcher) watcher.close();
      if (pollTimer) clearInterval(pollTimer);
      log.info('code-map --watch stopped.');
      resolvePromise(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
