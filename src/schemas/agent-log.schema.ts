export const agentLogSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://cdd-kit/schemas/agent-log.schema.json",
  title: "Agent Log",
  type: "object",
  additionalProperties: false,
  required: ["change-id", "timestamp", "agent", "status", "artifacts", "next-action"],
  properties: {
    "change-id": { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" },
    timestamp: { type: "string", format: "date-time" },
    agent: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["complete", "needs-review", "blocked"] },
    "files-read": { type: "array", items: { type: "string", minLength: 1 } },
    artifacts: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "pointer"],
        properties: {
          type: { type: "string", minLength: 1 },
          pointer: { type: "string", minLength: 1 }
        }
      }
    },
    "next-action": { type: "string", minLength: 1 },
    notes: { type: "string" }
  }
} as const;
