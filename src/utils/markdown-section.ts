/**
 * Shared markdown-section helpers. The context-manifest manager
 * (src/commands/context.ts), the gate's artifact checks
 * (src/commands/gate-artifacts.ts), the design-hash projection
 * (src/utils/design-hash.ts), the provenance resolver
 * (src/utils/design-provenance.ts) and bug-suspects all read named sections out
 * of an artifact body; before this module each kept its own near-identical
 * regex, which is exactly the kind of drift P1-15 set out to remove.
 * Centralizing the extractor means the writer and the gate read sections the
 * same way.
 *
 * That claim was aspirational until `enforce-human-confirmation`: bug-suspects
 * still held a verbatim copy of the pre-fix regex and did not move when this
 * function was corrected. If you are about to hand-roll a section regex, you are
 * about to reintroduce that drift. Call this instead, and if it cannot express
 * what you need, change it here.
 */

const RE_META = /[.*+?^${}()|[\]\\]/g;

/** Strip HTML comments so commented-out content never counts as section body. */
export function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Return the body of a `#{1,6} <heading>` section — everything between that
 * heading line and the next heading of the SAME-OR-SHALLOWER level (or end of
 * document). HTML comments are stripped first. Returns '' when the heading is
 * absent.
 *
 * Two properties this centralized extractor guarantees so no call site has to
 * re-derive them (both were defects in the prior single-`##`, unanchored regex):
 *
 *  - Level-aware termination. A level-`n` heading's body ends at the next
 *    heading of level ≤ `n`. So a `##` body still spans its `###` children
 *    (unchanged), but a `###` body now stops at its next `###` sibling instead
 *    of swallowing it up to the following `##`. Anchors into a `###` section are
 *    therefore stable when a sibling subsection is inserted.
 *  - Line-anchored opening. `<heading>` is matched only as a full heading line
 *    (`^#{1,6} <heading>\s*$`), so a lookup of `## X` can no longer match inside
 *    `### X`, and the matched heading's own level drives termination.
 *
 * `<heading>` is still matched literally and must be the entire heading text
 * after the `#`s (a trailing parenthetical is part of the heading, not ignored
 * here — callers that want parenthetical tolerance resolve the bare name to a
 * full heading line first; see design-provenance.ts).
 */
export function sectionBody(content: string, heading: string): string {
  const escaped = heading.replace(RE_META, '\\$&');
  const stripped = stripHtmlComments(content);
  // Line-anchored opening: find the real heading line and capture its level.
  const open = new RegExp(`^(#{1,6}) ${escaped}\\s*$`, 'm').exec(stripped);
  if (!open) return '';
  const level = open[1].length;
  // Re-match from the heading line start with a level-aware terminator. The
  // body ends at the next heading of level ≤ `level` (lookahead keeps the
  // preceding newline out of the body), or at end of document.
  const fromHeading = stripped.slice(open.index);
  const bodyRe = new RegExp(
    `^#{${level}} ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n#{1,${level}} |$)`,
  );
  return bodyRe.exec(fromHeading)?.[1] ?? '';
}
