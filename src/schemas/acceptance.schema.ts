// Human-owned acceptance oracle for a change (ADR 0010 §1). `acceptance.yml`
// pairs the human's narrative (`given/when/then`) with the concrete answer key
// the author owns (`input`/`expect`), plus optional cross-cutting invariants
// (`rules`). The gate (src/commands/gate-acceptance.ts) validates a change's
// `acceptance.yml` against this schema before running the AC-1/AC-2 checks
// (existence/placeholder detection, hash-lock reconcile) — an already-valid
// shape is a precondition for those checks to trust the parsed structure.
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
