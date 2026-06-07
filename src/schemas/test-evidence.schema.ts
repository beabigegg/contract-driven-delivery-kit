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
// if `additionalProperties` is ever relaxed. Keep both in sync with the ADR.
const PHASES = ["collect", "targeted", "changed-area", "contract", "quality", "full"] as const;

export const testEvidenceSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://cdd-kit/schemas/test-evidence.schema.json",
  title: "Test Evidence",
  type: "object",
  additionalProperties: false,
  required: ["change-id", "schema-version", "required-phases", "runs", "final-status"],
  not: {
    anyOf: [
      { required: ["known-failures"] },
      { required: ["pre-existing-failures"] },
      { required: ["allowed-failures"] },
      { required: ["waived-failures"] },
      { required: ["ignored-failures"] },
    ],
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
} as const;
