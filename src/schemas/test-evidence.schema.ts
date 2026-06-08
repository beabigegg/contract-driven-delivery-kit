// Structured test evidence for a tracked implementation change (ADR 0005 §6).
// `cdd-kit test run` generates this artifact under
// `specs/changes/<id>/test-evidence.yml`; the gate validates the evidence, not
// assistant claims (gate enforcement lands in a later ADR 0005 phase).
//
// ADR 0005 §7 — no known-failure waivers. The schema must REJECT these fields:
// known-failures, pre-existing-failures, allowed-failures, waived-failures,
// ignored-failures. `additionalProperties: false` already blocks any unlisted
// key, so those fields cannot appear. The explicit `not` below names them so the
// prohibition is intentional and traceable to the ADR, and so it survives even
// if `additionalProperties` is ever relaxed.
//
// This array is the single source of truth for the prohibited fields. The schema
// builds its `not.anyOf` from it, and the gate (src/commands/gate.ts) imports it
// to name the offending field in its error and to skip the duplicate
// `additionalProperties` echo — so the two can never drift out of sync.
export const PROHIBITED_WAIVER_FIELDS = [
  "known-failures",
  "pre-existing-failures",
  "allowed-failures",
  "waived-failures",
  "ignored-failures",
];

// The always-required phases of the test ladder (ADR 0005 §6 / test-plan.md):
// collect, targeted, and changed-area are marked "yes" for every implementation
// change. This is the single source of truth for that floor: `cdd-kit test run`
// uses it as the default `required-phases`, and the gate merges it into a
// present evidence file's own list so a hand-weakened `required-phases` cannot
// drop the mandatory phases. (`contract`/`quality`/`full` are conditional and
// stay opt-in per change.)
export const DEFAULT_REQUIRED_PHASES = ["collect", "targeted", "changed-area"];

const PHASES = ["collect", "targeted", "changed-area", "contract", "quality", "full"] as const;

export const testEvidenceSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://cdd-kit/schemas/test-evidence.schema.json",
  title: "Test Evidence",
  type: "object",
  additionalProperties: false,
  required: ["change-id", "schema-version", "required-phases", "runs", "final-status"],
  not: {
    anyOf: PROHIBITED_WAIVER_FIELDS.map((field) => ({ required: [field] })),
  },
  properties: {
    "change-id": { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" },
    "schema-version": { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
    "generated-by": { type: "string", minLength: 1 },
    "required-phases": {
      type: "array",
      minItems: 1,
      items: { type: "string", enum: PHASES },
    },
    runs: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["phase", "status", "command", "summary"],
        properties: {
          phase: { type: "string", enum: PHASES },
          status: { type: "string", enum: ["passed", "failed"] },
          command: { type: "string", minLength: 1 },
          summary: { type: "string", minLength: 1 },
          junit: { type: "string", minLength: 1 },
        },
      },
    },
    "final-status": { type: "string", enum: ["passed", "failed"] },
  },
  // Static integrity guard: a `passed` evidence file must contain at least one
  // run (see runs.minItems) and none of its recorded runs may be failed -- you
  // cannot claim a green final result while a recorded run failed. Full required-
  // phase coverage (every entry in `required-phases` has a passing run) is a
  // cross-field constraint that static JSON Schema cannot express; the gate
  // enforces that procedurally in a later ADR 0005 phase.
  if: { required: ["final-status"], properties: { "final-status": { const: "passed" } } },
  then: { properties: { runs: { type: "array", items: { type: "object", properties: { status: { const: "passed" } } } } } },
} as const;
