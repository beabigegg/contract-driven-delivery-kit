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
    "context-governance": { type: "string", enum: ["v1"] },
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
          section: { type: "string" }
        }
      }
    }
  }
} as const;
