// First-class bug-fix evidence block for the bug-fix lane (ADR 0006 §2).
//
// In the bug-fix lane, `bug-fix-engineer` records a concise, machine-readable
// repair record under `specs/changes/<id>/agent-log/bug-fix-engineer.yml`.
// ADR 0006 PR 1 carried that evidence as typed agent-log `artifacts:`; this
// schema (ADR 0006 PR 2) promotes it to a first-class `bug-fix:` block that nests
// inside the standard agent-log envelope (see src/schemas/agent-log.schema.ts,
// which references `bugFixEvidenceBlock` as an optional `bug-fix` property). The
// gate enforces the block for `lane: bug-fix` changes in the gate phase (ADR 0006
// PR 3); this PR only lands and validates the shape.
//
// The block is nested under the agent-log `bug-fix` key (not a bare top-level
// document), so the log keeps its required envelope -- `change-id`, `timestamp`,
// `agent`, `status`, `artifacts`, `next-action` -- and `/cdd-resume` can still
// read `status:` to skip a completed bug-fix engineer.

// Allowed reproduction statuses (ADR 0006 §3). Single source of truth: the block
// schema builds its `reproduction.status` enum from this, and the gate (ADR 0006
// PR 3) imports it to classify can-proceed vs diagnostic-only statuses without
// re-listing them.
export const REPRODUCTION_STATUSES = [
  "reproduced",
  "test-reproduced",
  "visual-reproduced",
  "intermittent",
  "environment-blocked",
  "not-reproduced",
] as const;

// The reproduction statuses that justify a behavior-changing fix (ADR 0006 §3).
// The remaining three (`intermittent` / `environment-blocked` / `not-reproduced`)
// support only a diagnostic-only change. The block's non-diagnostic branch
// constrains `reproduction.status` to this list (ADR 0006 §3, §7); the gate phase
// (ADR 0006 PR 3) imports it for the same check on the `lane: bug-fix` evidence.
export const BEHAVIOR_FIX_REPRODUCTION_STATUSES = [
  "reproduced",
  "test-reproduced",
  "visual-reproduced",
] as const;

// Result of checking a hypothesis (ADR 0006 §2 / bug-fix-engineer.md).
export const HYPOTHESIS_RESULTS = ["confirmed", "rejected", "unconfirmed"] as const;

// The `bug-fix:` block body, WITHOUT $id/$schema so it can be embedded inside
// agent-log.schema.ts without opening a second Ajv schema scope or registering a
// duplicate $id when both are compiled on one Ajv instance. `bugFixEvidenceSchema`
// below wraps this same body with $id/$schema for standalone compilation/tests.
//
// Field casing mirrors ADR 0006 §2 verbatim: domain fields are snake_case
// (`expected_behavior`, `root_cause`, ...); the version key stays kebab-case
// `schema-version` to match the kit-wide convention (test-evidence.schema.ts).
export const bugFixEvidenceBlock = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema-version",
    "symptom",
    "expected_behavior",
    "actual_behavior",
    "reproduction",
    "hypotheses",
  ],
  properties: {
    "schema-version": { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
    // Mirrors the classifier's `## Diagnostic Only`. When true, this record is a
    // diagnostic-only change (instrumentation, not a behavior fix) and is exempt
    // from the root-cause + regression proof below (ADR 0006 §10). Absent or
    // false means a behavior-changing fix, which must carry both.
    diagnostic_only: { type: "boolean" },
    symptom: { type: "string", minLength: 1 },
    expected_behavior: { type: "string", minLength: 1 },
    actual_behavior: { type: "string", minLength: 1 },
    observed_surface: { type: "string", minLength: 1 },
    reproduction: {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: {
        status: { type: "string", enum: REPRODUCTION_STATUSES },
        command: { type: "string", minLength: 1 },
        failing_before_fix: { type: "boolean" },
        summary: { type: "string", minLength: 1 },
      },
    },
    hypotheses: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "candidate", "result"],
        properties: {
          id: { type: "string", minLength: 1 },
          candidate: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 },
          result: { type: "string", enum: HYPOTHESIS_RESULTS },
        },
      },
    },
    root_cause: {
      type: "object",
      additionalProperties: false,
      required: ["pointer"],
      properties: {
        pointer: { type: "string", minLength: 1 },
        summary: { type: "string", minLength: 1 },
      },
    },
    fix: {
      type: "object",
      additionalProperties: false,
      required: ["files_changed"],
      properties: {
        files_changed: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        summary: { type: "string", minLength: 1 },
      },
    },
    regression: {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: {
        status: { type: "string", enum: ["passed", "failed"] },
        command: { type: "string", minLength: 1 },
        summary: { type: "string", minLength: 1 },
      },
    },
    residual_risk: { type: "string", minLength: 1 },
  },
  // A behavior-changing fix (diagnostic_only absent or false) must carry the full
  // repair shape (ADR 0006 §2): observed surface, root cause, a files-changed fix,
  // a PASSING regression, and a residual-risk statement -- and its reproduction
  // must be a behavior-fix status (`reproduced` / `test-reproduced` /
  // `visual-reproduced`), never a diagnostic-only state (ADR 0006 §3, §7). A
  // diagnostic-only record is exempt -- it intentionally does not fix the symptom
  // yet (§10). The remaining cross-field rules ("reproduction succeeded => a
  // confirmed hypothesis exists" and referenced-summary existence) are procedural
  // and land with the gate (ADR 0006 PR 3), mirroring how test-evidence.schema
  // defers required-phase coverage.
  if: {
    not: {
      required: ["diagnostic_only"],
      properties: { diagnostic_only: { const: true } },
    },
  },
  then: {
    required: ["observed_surface", "root_cause", "fix", "regression", "residual_risk"],
    properties: {
      reproduction: {
        type: "object",
        properties: { status: { enum: BEHAVIOR_FIX_REPRODUCTION_STATUSES } },
      },
      regression: {
        type: "object",
        properties: { status: { const: "passed" } },
      },
    },
  },
} as const;

export const bugFixEvidenceSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://cdd-kit/schemas/bug-fix-evidence.schema.json",
  title: "Bug-fix Evidence",
  ...bugFixEvidenceBlock,
} as const;
