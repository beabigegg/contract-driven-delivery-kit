// `.cdd/design-lock.json` shape (ADR 0012 §5, mirrors ADR 0010's
// `.cdd/acceptance-lock.json`). Unlike `acceptance.schema.ts` (which validates
// the human-authored `interaction-design.md` YAML answer key), this schema
// validates the regenerable SIDECAR that `cdd-kit design confirm` writes: a
// change-id-keyed map of `{ hash, locked-at }` baseline entries, one per
// change. `src/utils/design-hash.ts` (readDesignLock/writeDesignLock) is the
// only code that reads/writes this shape at runtime; this schema exists so
// `test/schemas/design-lock.schema.test.ts` can assert the shape directly,
// mirroring `acceptance.schema.test.ts`'s coverage of `acceptance.schema.ts`.
export const designLockEntrySchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://cdd-kit/schemas/design-lock-entry.schema.json",
  title: "Design Lock Entry",
  type: "object",
  additionalProperties: false,
  required: ["hash"],
  properties: {
    // sha256 hex digest of the canonical `## Confirmed` projection
    // (src/utils/design-hash.ts computeDesignHash).
    hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    // ISO timestamp set by `cdd-kit design confirm`; optional so a
    // hand-authored fixture need not supply it.
    "locked-at": { type: "string" },
  },
} as const;

export const designLockSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://cdd-kit/schemas/design-lock.schema.json",
  title: "Design Lock File",
  description: "Change-id keyed map of hash-lock baselines (.cdd/design-lock.json).",
  type: "object",
  additionalProperties: designLockEntrySchema,
} as const;
