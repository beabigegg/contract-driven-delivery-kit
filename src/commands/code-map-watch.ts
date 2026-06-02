import { watch, type FSWatcher } from 'fs';
import { resolve } from 'path';
import picomatch from 'picomatch';
import { log } from '../utils/logger.js';
import { codeMap, slugifySurface, type CodeMapOptions } from './code-map.js';
import { loadCodeMapConfig } from '../code-map/config.js';
import { sidecarPathFor } from '../code-map/index-reader.js';
import { graphPathFor } from '../code-graph/reader.js';

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
  /**
   * Abort to stop watching and resolve cleanly. The top-level CLI owns
   * process-signal wiring (SIGINT/SIGTERM) and passes the controller's signal
   * here, so this library function never installs process handlers of its own —
   * keeping it composable with other watchers and signal handling.
   */
  signal?: AbortSignal;
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

/**
 * Absolute paths of the three artifacts a single rebuild writes for `outRel`:
 * the map YAML, its JSON sidecar, and the code-graph index. The watcher ignores
 * exactly these (and nothing else under .cdd/) so its own writes never retrigger
 * it, while user config edits still do. Exported for testing.
 */
export function generatedArtifactSet(outRel: string, cwd: string = process.cwd()): Set<string> {
  return new Set<string>([
    resolve(cwd, outRel),
    resolve(cwd, sidecarPathFor(outRel)),
    resolve(cwd, graphPathFor(outRel)),
  ]);
}

export async function codeMapWatch(opts: CodeMapWatchOptions): Promise<number> {
  const debounceMs = opts.debounceMs ?? 500;
  const pollMs = opts.pollMs ?? 2000;
  const scanPath = opts.surface ?? opts.path;
  const root = resolve(process.cwd(), scanPath);

  // Resolve the map output path exactly as codeMap() derives it, so the watcher
  // can ignore the rebuild's own write (any --out, not just under .cdd/) and the
  // polling fallback checks the right file/scope.
  const outRel = opts.out
    ?? (opts.surface ? `.cdd/code-map.${slugifySurface(opts.surface)}.yml` : '.cdd/code-map.yml');
  // A rebuild writes exactly three generated artifacts (map YAML, JSON sidecar,
  // code-graph index). Ignore only THESE — by absolute path — so the watcher
  // does not retrigger on its own writes, while still rebuilding on edits to the
  // user's own `.cdd/code-map-config.yml`, `.cdd/tier-policy.json`, etc.
  const generatedAbs = generatedArtifactSet(outRel);

  // Resolve the same exclude scope codeMap()/walkRepo() use, so events under
  // ignored trees (node_modules, dist, .git, .next, coverage, …) never trigger
  // a rebuild: the map can't change from a write there, yet a dev server or git
  // operation churning those dirs would otherwise rescan the whole repo. Built
  // off filename paths relative to `root`, exactly as walkRepo matches them.
  let isExcluded: (rel: string) => boolean = () => false;
  try {
    const cfg = loadCodeMapConfig(root);
    const excludes = [...cfg.exclude, ...(opts.exclude ?? [])];
    if (excludes.length > 0) {
      const match = picomatch(excludes, { dot: true });
      // Match the file itself and the directory-glob form (`dir/**`), mirroring
      // walkRepo's dir fast-path so a directory event is skipped too.
      isExcluded = (rel: string) => match(rel) || match(`${rel}/**`);
    }
  } catch {
    // Config error surfaces on the actual rebuild; keep the watcher permissive.
  }

  const rebuild = async (): Promise<number> => {
    const exit = await codeMap({ ...opts, check: false, silent: true });
    if (exit === 0) {
      log.ok(`code-map refreshed (${new Date().toLocaleTimeString()})`);
    } else {
      log.warn('code-map refresh reported a problem; map left unchanged where possible.');
    }
    return exit;
  };

  // Initial build so the watcher starts from a known-fresh map. If it fails
  // (bad --surface, config error), exit nonzero like plain `code-map` instead of
  // watching a path whose map was never built.
  log.info(`code-map --watch: building initial map for ${scanPath}…`);
  const initialExit = await rebuild();
  if (initialExit !== 0) {
    log.error('code-map --watch: initial build failed; not starting the watcher.');
    return initialExit;
  }

  const { trigger, dispose } = createDebouncedRunner(() => rebuild().then(() => undefined), debounceMs);

  let watcher: FSWatcher | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Rebuild only if a --check confirms the map would actually change. Reuses
  // codeMap's own out-path + scope derivation (correct for --surface / custom
  // --out) and is the safe response when we cannot attribute an event to a
  // specific file. A running guard prevents pile-up.
  let driftChecking = false;
  const triggerIfDrift = (): void => {
    if (driftChecking) return;
    driftChecking = true;
    void codeMap({ ...opts, check: true, silent: true })
      .then(drift => { if (drift !== 0) trigger(); })
      .finally(() => { driftChecking = false; });
  };

  const startPolling = (reason?: string): void => {
    if (pollTimer) return;
    if (reason) log.warn(reason);
    pollTimer = setInterval(triggerIfDrift, pollMs);
    log.ok(`polling ${scanPath} every ${pollMs}ms. Ctrl-C to stop.`);
  };

  const isSelfWrite = (filename: string): boolean => {
    // True only for the rebuild's own generated artifacts (map + sidecar + graph
    // index), so a custom --out and its cache siblings are covered, but user
    // config edits under .cdd/ are NOT suppressed.
    return generatedAbs.has(resolve(root, filename));
  };

  try {
    // Recursive fs.watch is supported on macOS/Windows always and on Linux from
    // Node 20+. If it throws (older Linux), fall back to freshness polling.
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      // Node does not guarantee a filename on every event. With one, filter the
      // map's own writes and rebuild on any other change. Without one, we cannot
      // tell a self-write from a real change, so fall back to a drift check
      // rather than an unconditional rebuild (which would loop on our own write).
      if (filename) {
        const rel = filename.toString();
        if (isSelfWrite(rel)) return;
        // Normalize Windows separators before glob-matching the exclude scope.
        if (isExcluded(rel.replace(/\\/g, '/'))) return;
        trigger();
      } else {
        triggerIfDrift();
      }
    });
    // Runtime errors (ENOSPC, permission, watch-limit) surface via the 'error'
    // event, not the synchronous throw above. Without this listener they become
    // uncaught exceptions that kill the process; instead, close the watcher and
    // degrade to polling so --watch keeps working.
    watcher.on('error', (err: Error) => {
      log.warn(`watch error (${err.message}); closing watcher and falling back to polling.`);
      try { watcher?.close(); } catch { /* already closed */ }
      watcher = null;
      startPolling();
    });
    log.ok(`watching ${scanPath} (recursive, debounce ${debounceMs}ms). Ctrl-C to stop.`);
  } catch {
    startPolling('recursive fs.watch unavailable on this platform; falling back to freshness polling.');
  }

  return await new Promise<number>((resolvePromise) => {
    const stop = (): void => {
      dispose();
      if (watcher) watcher.close();
      if (pollTimer) clearInterval(pollTimer);
      log.info('code-map --watch stopped.');
      resolvePromise(0);
    };
    const signal = opts.signal;
    if (signal) {
      if (signal.aborted) { stop(); return; }
      signal.addEventListener('abort', stop, { once: true });
    }
    // No process.once here — the CLI owns process-signal wiring and aborts the
    // signal above. A caller that passes no signal keeps the watcher running
    // until the process is killed, which is the intended foreground behaviour.
  });
}
