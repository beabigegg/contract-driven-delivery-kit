export const tasksSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://cdd-kit/schemas/tasks.schema.json",
  title: "Tasks",
  type: "object",
  additionalProperties: false,
  required: ["change-id", "status", "tasks"],
  properties: {
    "change-id": { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" },
    status: {
      type: "string",
      enum: ["in-progress", "completed", "complete", "done", "gate-blocked", "abandoned", "needs-review"]
    },
    tier: { anyOf: [{ type: "integer", minimum: 0, maximum: 5 }, { type: "null" }] },
    "context-governance": { type: "string", enum: ["v1", "v2"] },
    // v2 only. The seven fields `change-classification.md` used 99 lines of
    // template to carry. `tier` stays a top-level key (it always was one, and
    // `resolveTier` already reads it first) rather than moving in here -- that
    // duplication with the old `## Tier` heading is precisely what
    // `enforceTierConsistency` existed to referee, and there is now one copy.
    classification: {
      type: "object",
      additionalProperties: false,
      required: ["types", "risk", "impact"],
      properties: {
        types: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        risk: { type: "string", enum: ["low", "medium", "high", "critical"] },
        impact: { type: "string", enum: ["isolated", "module-level", "cross-module", "system-wide"] },
        "architecture-review": { type: "boolean" },
        // Required by `enforceClassificationSubstance` whenever
        // `architecture-review` is true -- a bare yes with no reason is the
        // same unjustified-skip shape ADR 0011 already refuses for
        // `applicability: not-applicable`.
        "architecture-review-reason": { type: "string", minLength: 10 },
      },
    },
    "archive-tasks": {
      type: "array",
      items: { type: "string", pattern: "^[0-9]+(\\.[0-9]+)*$" },
      default: ["7.1", "7.2"]
    },
    "depends-on": {
      type: "array",
      items: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" },
      default: []
    },
    "tier-floor-override": { type: "string", minLength: 1 },
    "test-evidence-not-applicable": { type: "string", minLength: 1 },
    "token-budget": { type: ["string", "number"] },
    created: { type: "string" },
    completed: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "status"],
        properties: {
          id: { type: "string", pattern: "^[0-9]+(\\.[0-9]+)*$" },
          title: { type: "string", minLength: 1 },
          status: { type: "string", enum: ["pending", "done", "skipped"] },
          section: { type: "string" },
          note: { type: "string" }
        }
      }
    }
  }
} as const;
