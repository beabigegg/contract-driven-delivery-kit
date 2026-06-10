/**
 * Shared markdown-section helpers. Both the context-manifest manager
 * (src/commands/context.ts) and the gate's artifact checks
 * (src/commands/gate-artifacts.ts) read named `## Heading` sections out of an
 * artifact body; before this module each kept its own near-identical regex,
 * which is exactly the kind of drift P1-15 set out to remove. Centralizing the
 * extractor means the writer and the gate read sections the same way.
 */

const RE_META = /[.*+?^${}()|[\]\\]/g;

/** Strip HTML comments so commented-out content never counts as section body. */
export function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Return the body of a `## <heading>` section — everything between that heading
 * line and the next `## ` heading (or end of document). HTML comments are
 * stripped first. Returns '' when the heading is absent.
 */
export function sectionBody(content: string, heading: string): string {
  const escaped = heading.replace(RE_META, '\\$&');
  const match = stripHtmlComments(content).match(
    new RegExp(`## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`),
  );
  return match?.[1] ?? '';
}
