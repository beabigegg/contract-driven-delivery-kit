/**
 * Schema for `.cdd/reservations.yml` — the contract-lane reservation ledger for
 * parallel changes (see docs/adr/0009-parallel-change-integration.md).
 *
 * PROBLEM. When N changes are developed concurrently in separate git worktrees,
 * they collide at merge time on shared, append-mostly governance surfaces:
 * the single `schema-version` line in each contract's frontmatter, the shared
 * `contracts/CHANGELOG.md`, and the regenerated `.cdd/*` indexes. Two branches
 * that both bump `api` 1.2.0 → 1.3.0 produce a textual conflict on that line
 * and a semantic one the version validator rejects as a skip/downgrade.
 *
 * SOLUTION. Before fanning out, a coordinator reserves a distinct version lane
 * per (change, contract) up front, on the base commit every worktree branches
 * from. This ledger is that pre-allocation. `cdd-kit reserve` writes it,
 * `cdd-kit integrate` reads it to compute a contention matrix and a
 * deterministic, monotonic merge order.
 *
 * This file is authored by `cdd-kit reserve` and may be hand-edited; the schema
 * exists so both the writer and the reader validate it before acting.
 */
export const reservationsSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://cdd-kit/schemas/reservations.schema.json",
  title: "Contract-Lane Reservations",
  type: "object",
  additionalProperties: false,
  required: ["version", "reservations"],
  properties: {
    version: { type: "integer", enum: [1] },
    reservations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["change-id", "contracts"],
        properties: {
          "change-id": { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" },
          branch: { type: "string", minLength: 1 },
          // key is a contract surface: api|css|env|data|business|ci
          contracts: {
            type: "object",
            additionalProperties: false,
            properties: {
              api: { $ref: "#/$defs/lane" },
              css: { $ref: "#/$defs/lane" },
              env: { $ref: "#/$defs/lane" },
              data: { $ref: "#/$defs/lane" },
              business: { $ref: "#/$defs/lane" },
              ci: { $ref: "#/$defs/lane" },
            },
          },
          "changelog-fragment": { type: "string", minLength: 1 },
        },
      },
    },
  },
  $defs: {
    lane: {
      type: "object",
      additionalProperties: false,
      required: ["from", "to"],
      properties: {
        // current on-base version this reservation branched from
        from: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
        // reserved target version this change is allowed to bump to
        to: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
        // named sub-surfaces this change edits (e.g. "endpoints/export").
        // Two changes sharing a surface on the same contract are real semantic
        // contention that a human must resolve; disjoint surfaces are safe.
        surfaces: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

export const CONTRACT_KEYS = ["api", "css", "env", "data", "business", "ci"] as const;
export type ContractKey = (typeof CONTRACT_KEYS)[number];

/** Canonical on-disk location of each contract's versioned markdown file. */
export const CONTRACT_PATHS: Record<ContractKey, string> = {
  api: "contracts/api/api-contract.md",
  css: "contracts/css/css-contract.md",
  env: "contracts/env/env-contract.md",
  data: "contracts/data/data-shape-contract.md",
  business: "contracts/business/business-rules.md",
  ci: "contracts/ci/ci-gate-contract.md",
};
