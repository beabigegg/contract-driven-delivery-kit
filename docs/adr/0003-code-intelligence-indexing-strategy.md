# ADR 0003: Code-intelligence indexing strategy (trigger vs background, AST vs LSP)

- Status: Accepted
- Date: 2026-06-02
- Deciders: maintainer + AI delivery agent
- Relates to: `cdd-kit code-map`, `cdd-kit graph`, `cdd-kit index`, `cdd-kit mcp`

## Context

The kit's token-efficiency moat is its deterministic, low-token code
intelligence: `cdd-kit code-map` parses source into a structural index, the
native code-graph adds files/symbols/imports/calls, and agents query symbols and
line ranges (`--with-source`) instead of `Read`-ing whole files. Two design
questions were never written down and are now load-bearing as the kit positions
itself for a fully automated, no-human-reviewer workflow:

1. **What parser tier?** Today the kit uses its own AST scanners (Babel for
   JS/TS/Vue, a Python subprocess) producing a YAML map + JSON sidecar + native
   graph. Should it adopt a **Language Server Protocol (LSP)** backend like
   [Serena](https://github.com/oraios/serena), which gives IDE-grade
   "go-to-definition" precision across 20+ languages?

2. **What refresh model?** Today indexing is **trigger-based**: the map is
   regenerated when a command needs it (`gate`, `index query --refresh`,
   `doctor --fix`, the pre-commit code-map hook). Should it instead run as a
   **background daemon** that watches the filesystem and keeps the index live,
   as Serena, [CocoIndex](https://cocoindex.io/cocoindex-code/), and most
   tree-sitter-based indexers do?

### What the field does (2026)

- **Serena** pairs LLMs with LSP for deterministic symbol resolution. It relies
  on lazy per-language server startup, **incremental indexing** (only modified
  files re-index), symbol-table caching, and a serialized background task queue.
- **CocoIndex / tree-sitter indexers** use a **background file watcher** with
  debounced (~500 ms) incremental re-parse; only changed AST nodes are
  re-processed, and unchanged chunks reuse cached work. Content-hash (XXH3)
  comparison gives ~4× speedup over full re-index, and full-repo rebuilds are
  explicitly avoided because on large repos they "cost real money and take real
  hours, and the context is stale on arrival."
- A recurring independent finding: **LSP, built for interactive human IDE
  sessions, does not translate cleanly to autonomous agents** — symbol-resolution
  failures, empty reference searches, and coordinate-precision requirements bite
  in headless runs. Several agent indexers therefore use *LSP-inspired*
  tree-sitter + graph (e.g. PageRank over the dependency graph) and report
  symbol-level awareness at only 8.5–13k tokens, without a live LSP.

## Decision

### 1. Stay on native AST scanners; do not adopt an LSP daemon

The kit keeps its own AST/graph scanners as the default engine. Rationale:

- **Determinism over precision-at-any-cost.** The kit's value is a *stable,
  diffable, byte-identical* index that the gate and `--with-source` can rely on.
  An LSP server's answers vary with workspace state, plugin versions, and
  warm-up; that is the wrong trade for a mechanical chokepoint.
- **Autonomous-agent fit.** The published failure modes of LSP-in-agents are
  exactly our usage pattern (headless, ephemeral containers, no editor).
- **Zero heavy runtime.** No per-language server processes to install, warm, or
  babysit inside short-lived CI/agent containers.
- **External LSP/CodeGraph stays opt-in.** `--engine codegraph` already exists
  for users who want a heavier external graph; LSP can join later as another
  opt-in adapter, never the default.

### 2. Keep trigger-based refresh as the default; add opt-in background watch

Trigger-based stays the default because it is correct for the dominant
execution context — **ephemeral containers and one-shot agent runs**, where a
daemon would build an index that is discarded minutes later. But the trigger
model has a real gap for **long-lived co-editing sessions** (a human and an agent
editing the same repo over hours): between triggers the map is stale, and
re-deriving the whole map on every query is wasteful.

We close that gap with an **opt-in background mode**, `cdd-kit code-map --watch`:

- A debounced (default 500 ms, matching field practice) recursive `fs.watch`
  rebuilds the map after change bursts settle.
- Self-triggering is avoided by ignoring writes under `.cdd/`.
- Where recursive `fs.watch` is unavailable (older Linux Node), it falls back to
  freshness polling using the existing `checkCodeMapFreshness` digest check.
- It is **never armed automatically** — daemons are a poor default for CI.

### 3. Make detection cheaper and more honest now; make rebuild incremental next

Two follow-ups, sequenced:

- **(shipped here)** Background watch + the existing content-hash freshness check
  (`# sources-digest` header, verified against `computeSourcesDigest`) already
  prevent false "stale" verdicts after `git clone` and let watch/poll skip
  no-op rebuilds.
- **(next PR)** **Incremental rebuild.** Today `--watch` still rebuilds the whole
  map per debounce window because the scanners are whole-repo. The high-value
  follow-up is per-file incremental: keep prior map entries for files whose
  content hash is unchanged, re-scan only the changed set, and merge. This is
  the ~4× win the field reports and is the prerequisite for watch to be cheap on
  large repos. The content-hash sidecar already gives us the per-file digests to
  build on.

## Consequences

- **Positive:** default behaviour unchanged for CI/agents; a real option for
  live sessions; explicit rationale for *not* chasing LSP; a clear, scoped
  incremental-rebuild roadmap.
- **Negative / accepted:** `--watch` on a large repo is currently O(full scan)
  per change burst until incremental lands — documented, and gated behind an
  explicit flag so no one pays for it unawares.
- **Revisit when:** an LSP/tree-sitter adapter shows a *deterministic*,
  container-friendly mode, or incremental rebuild lands and changes the
  watch cost profile.
