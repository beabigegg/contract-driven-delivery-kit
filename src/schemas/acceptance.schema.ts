// Human-owned acceptance oracle for a change (ADR 0010 §1). `acceptance.yml`
// pairs the human's narrative (`given/when/then`) with the concrete answer key
// the author owns (`input`/`expect`), plus optional cross-cutting invariants
// (`rules`). The gate (src/commands/gate-acceptance.ts) validates a change's
// `acceptance.yml` against this schema before running the AC-1/AC-2 checks
// (existence/placeholder detection, hash-lock reconcile) — an already-valid
// shape is a precondition for those checks to trust the parsed structure.
//
// `confirmation-mode: chat-confirmed` allows the main agent to translate a
// user's plain-language acceptance into this file while the actual approval is
// independently verified from a GitHub PR comment receipt. Omitting the field
// retains the original human-relock behavior.
//
// `input`/`expect` are intentionally left unconstrained (`{}` — any JSON
// value): the answer key can be a scalar, string, or nested object depending
// on what the case exercises (ADR 0010 §1 example uses objects). The locked
// hash (src/utils/acceptance-hash.ts) is computed over the parsed structure,
// not the schema, so this flexibility does not weaken tamper-evidence.
export const acceptanceSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://cdd-kit/schemas/acceptance.schema.json",
  title: "Acceptance Oracle",
  type: "object",
  additionalProperties: false,
  required: ["oracle-version", "authored-by", "cases"],
  properties: {
    "oracle-version": { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
    "confirmation-mode": { type: "string", enum: ["human-relock", "chat-confirmed"] },
    // Provenance marker (ADR 0010 §1/§3): who authored the oracle. Free text
    // rather than a closed enum so a named human author is not artificially
    // forced into a fixed vocabulary.
    "authored-by": { type: "string", minLength: 1 },
    cases: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "given", "when", "then", "input", "expect"],
        properties: {
          id: { type: "string", minLength: 1 },
          given: { type: "string", minLength: 1 },
          when: { type: "string", minLength: 1 },
          then: { type: "string", minLength: 1 },
          input: {},
          expect: {},
        },
      },
    },
    // Invariants that must ALWAYS hold (ADR 0010 §1), independent of any single
    // case. Optional at the top level -- not every change carries a
    // cross-cutting invariant -- but when present each entry must carry both
    // fields.
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "statement"],
        properties: {
          id: { type: "string", minLength: 1 },
          statement: { type: "string", minLength: 1 },
        },
      },
    },
  },
} as const;

// `.cdd/acceptance-lock.json` SIDECAR shape (ADR 0010 §3.1; mirrors
// `src/schemas/design-lock.schema.ts`). DISTINCT from `acceptanceSchema` above,
// which validates the human-authored `acceptance.yml` answer key: this validates
// the regenerable sidecar that `cdd-kit accept relock` writes -- a change-id-keyed
// map of hash-lock baselines. `src/utils/acceptance-hash.ts`
// (readAcceptanceLock/writeAcceptanceLock) is the only code that reads/writes this
// shape at runtime; this schema exists so `test/schemas/acceptance.schema.test.ts`
// can assert the shape directly, mirroring `design-lock.schema.test.ts`.
export const acceptanceLockEntrySchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://cdd-kit/schemas/acceptance-lock-entry.schema.json",
  title: "Acceptance Lock Entry",
  type: "object",
  additionalProperties: false,
  required: ["hash"],
  properties: {
    // sha256 hex digest of the canonical locked region
    // (src/utils/acceptance-hash.ts computeAcceptanceHash).
    hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    // ISO timestamp set by `cdd-kit accept relock`; optional so a hand-authored
    // fixture need not supply it.
    "locked-at": { type: "string" },
    // Tamper-evidence CLUES only (contracts/ci/ci-gate-contract.md "Tamper
    // evidence, not prevention" names BOTH lock sidecars). What the relocking
    // process claimed about itself; every one is trivially forgeable and NO gate
    // reads or verifies them -- "a clue, never a verdict." All optional: a lock
    // written by older code omits them, and their absence is absent evidence,
    // never failed evidence.
    "git-author": { type: "string" },
    tty: { type: "boolean" },
    timestamp: { type: "string" },
  },
} as const;

export const acceptanceLockSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://cdd-kit/schemas/acceptance-lock.schema.json",
  title: "Acceptance Lock File",
  description: "Change-id keyed map of hash-lock baselines (.cdd/acceptance-lock.json).",
  type: "object",
  additionalProperties: acceptanceLockEntrySchema,
} as const;
