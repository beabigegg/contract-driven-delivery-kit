import { bugFixEvidenceBlock } from "./bug-fix-evidence.schema.js";

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
    status: { type: "string", enum: ["complete", "done", "approved", "needs-review", "blocked"] },
    "files-read": { type: "array", items: { type: "string", minLength: 1 } },
    "indexes-used": { type: "array", items: { type: "string", minLength: 1 } },
    "index-queries": { type: "array", items: { type: "string", minLength: 1 } },
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
    notes: { type: "string" },
    // Optional first-class bug-fix evidence block (ADR 0006 §2). Only bug-fix-lane
    // logs carry it; feature logs omit it, so this is backward-compatible. Defined
    // in bug-fix-evidence.schema.ts; the gate requires it for `lane: bug-fix`
    // changes (ADR 0006 PR 3, src/commands/gate.ts).
    "bug-fix": bugFixEvidenceBlock
  }
} as const;
