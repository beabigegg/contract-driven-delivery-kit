/**
 * Plain-language explanations for `cdd-kit gate` failures (P0-6).
 *
 * The gate speaks engineer: "tier floor violation", "frontmatter", "stub",
 * "depends-on cycle". A non-engineer running `cdd-kit gate <id> --explain`
 * needs two things the raw error never gives them: *why* the check fired in
 * words they already understand, and the exact sentence to paste back to
 * Claude so the next step is unambiguous.
 *
 * `explainGateError` is a pure, side-effect-free classifier: it matches a raw
 * gate error string against known failure families (most specific first) and
 * returns a `{ why, sayToClaude }` pair, or `null` when nothing matches so the
 * caller can fall back to a generic hint. Keeping it pure makes the whole
 * mapping unit-testable without spawning the CLI, and keeps `gate.ts`'s
 * error-collection logic — and its ~820 existing tests — untouched.
 */

export interface GateExplanation {
  /** Why this check exists / fired, in non-engineer language. */
  why: string;
  /** A ready-to-paste sentence the user can say to Claude to fix it. */
  sayToClaude: string;
}

/** Pull a quoted/leading artifact filename out of an error like `tasks.yml: ...`. */
function leadingArtifact(error: string): string | null {
  const m = error.match(/^([A-Za-z0-9_./-]+\.(?:md|yml|yaml|json)):/);
  return m ? m[1] : null;
}

/**
 * Map a raw gate error string to a plain-language explanation + a sentence to
 * say to Claude. Returns null when the error has no tailored explanation (the
 * caller then shows the raw message with a generic next step).
 *
 * Order matters: earlier branches are more specific. The explanations are
 * intentionally tool-agnostic about *how* Claude fixes it — they tell the user
 * what to ask for, not how the agent should implement it.
 */
export function explainGateError(error: string): GateExplanation | null {
  const e = error;

  // ── Risk tier: the most jargon-dense, most surprising failure ──────────────
  if (/^tier floor violation:/.test(e)) {
    return {
      why:
        'This change touches a sensitive area (for example login, payments, or ' +
        'security), so the system requires a stricter review level than the one ' +
        'it was filed under. "Tier" is just the risk level — a lower tier number ' +
        'means stricter checks.',
      sayToClaude:
        'This change was flagged as higher risk than its current tier. Please ' +
        're-classify it to the required stricter tier and bring the tests and ' +
        'evidence up to that level.',
    };
  }
  if (/missing tier marker|missing tier\/risk marker/.test(e)) {
    return {
      why:
        'The change has not declared how risky it is yet. Every change needs a ' +
        'risk level (its "tier") so the gate knows how strict to be.',
      sayToClaude:
        'Please classify the risk tier for this change and record it in the ' +
        "change's tasks.yml so the gate can read it.",
    };
  }
  if (/^tier mismatch:|tier marker is bold-text only/.test(e)) {
    return {
      why:
        'The risk level is recorded in two places and they disagree (or it is in ' +
        'an old format the gate cannot read reliably).',
      sayToClaude:
        'Please make the risk tier consistent across the change files and record ' +
        'it in the machine-readable place (tasks.yml).',
    };
  }

  // ── Missing / stub / placeholder artifacts ────────────────────────────────
  if (/^missing required artifact:/.test(e)) {
    const file = e.replace(/^missing required artifact:\s*/, '').trim();
    return {
      why:
        `This change is missing a document the process requires (${file}). ` +
        'The gate will not pass until every required document exists.',
      sayToClaude:
        `Please create the ${file} for this change and fill it in for what we are doing.`,
    };
  }
  if (/appears to be a stub/.test(e)) {
    const file = leadingArtifact(e) ?? 'one of the change documents';
    return {
      why:
        `A required document (${file}) is almost empty. The gate treats a nearly ` +
        'blank file as "not done yet".',
      sayToClaude:
        `Please flesh out ${file} with the real details of this change instead of ` +
        'leaving it as a template.',
    };
  }
  if (/unfilled template placeholder/.test(e)) {
    const file = leadingArtifact(e) ?? 'a change document';
    return {
      why:
        `${file} still has template fill-in-the-blank text that was never replaced ` +
        '(things like TODO or <change-id>). The gate cannot tell a placeholder ' +
        'from a real answer, so it blocks.',
      sayToClaude:
        `Please replace the leftover template placeholders in ${file} with this ` +
        "change's real values.",
    };
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────
  if (/task\(s\) still pending/.test(e)) {
    return {
      why:
        'Some of the planned tasks for this change are still marked "not done". ' +
        'A strict gate run requires every task to be finished, skipped, or ' +
        'explicitly archived.',
      sayToClaude:
        'Please finish the remaining tasks, or mark the ones that no longer apply ' +
        'as skipped/archived, then run the gate again.',
    };
  }

  // ── Test evidence ──────────────────────────────────────────────────────────
  if (/test-evidence\.yml|test evidence|tests? (?:failed|did not pass)/i.test(e)) {
    return {
      why:
        'The gate needs proof the tests actually ran and passed for this change. ' +
        'That proof is either missing, incomplete, or shows failing tests.',
      sayToClaude:
        'Please run the tests for this change and record the passing results as ' +
        'test evidence, then run the gate again.',
    };
  }

  // ── Dependencies between changes ──────────────────────────────────────────
  if (/depends-on cycle|cannot depend on itself/.test(e)) {
    return {
      why:
        'The changes are set up to wait on each other in a loop, so none of them ' +
        'can ever go first. That circular dependency has to be broken.',
      sayToClaude:
        'There is a circular dependency between these changes. Please untangle it ' +
        'so they form a clear order.',
    };
  }
  if (/^dependency .+: (?:missing tasks\.yml|upstream change)/.test(e)) {
    return {
      why:
        'This change is waiting on another change that is either not finished or ' +
        'cannot be found. The gate will not pass a change whose prerequisites are ' +
        'not ready.',
      sayToClaude:
        'A change this one depends on is not ready. Please either finish that ' +
        'upstream change first or remove the dependency if it is no longer needed.',
    };
  }

  // ── Contracts ──────────────────────────────────────────────────────────────
  if (/contract|endpoint table|tests column/i.test(e)) {
    return {
      why:
        'The API contract for this change is incomplete — for example an endpoint ' +
        'is listed without saying what tests cover it. Contracts are the agreed ' +
        '"shape" of the work and must be filled in.',
      sayToClaude:
        'Please complete the API contract for this change, including the test ' +
        'coverage column for every endpoint.',
    };
  }

  // ── Malformed data files ──────────────────────────────────────────────────
  if (/invalid YAML|file is empty or not a YAML mapping/.test(e)) {
    const file = leadingArtifact(e) ?? 'a data file';
    return {
      why:
        `${file} is not in a valid format the gate can read — it is likely empty ` +
        'or has a typo in its structure.',
      sayToClaude:
        `Please fix the formatting of ${file} so it is valid and complete.`,
    };
  }

  return null;
}
