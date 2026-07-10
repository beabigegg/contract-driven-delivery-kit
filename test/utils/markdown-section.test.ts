import { describe, it, expect } from 'vitest';
import { sectionBody, stripHtmlComments } from '../../src/utils/markdown-section.js';

/**
 * IP-1 regression suite (enforce-human-confirmation).
 *
 * `sectionBody` is the single shared section extractor. Two defects were fixed:
 * a terminator that only ever stopped at the next `## `, and an opening match
 * that was not anchored to a full heading line.
 *
 * These tests exist because neither defect is isolable through
 * `design-provenance.ts`: any fixture that exercises the line anchor also trips
 * the resolver's own heading-ambiguity check, so the resolver can never observe
 * the mutation. Each test below names the mutation that must turn it red.
 */
describe('sectionBody — IP-1 regressions', () => {
  it('regression 1: a sibling ### no longer bleeds into the preceding ### body', () => {
    // MUTATION: revert the terminator to `(?=\n## |$)` → `enforceA` swallows
    // the `### enforceB` heading and its body, and this test goes red.
    const doc = [
      '## Required Check Policy',
      '',
      '### enforceA',
      'alpha body',
      '',
      '### enforceB',
      'beta body',
      '',
      '## Next Top Level',
      'unrelated',
      '',
    ].join('\n');

    const a = sectionBody(doc, 'enforceA');

    expect(a).toContain('alpha body');
    expect(a).not.toContain('beta body');
    expect(a).not.toContain('### enforceB');
  });

  it('regression 2: a ## body still spans its ### children', () => {
    // MUTATION: make the terminator stop at ANY deeper heading
    // (`(?=\n#{1,6} |$)`) → the `###` children fall out and this goes red.
    // This is the property that must NOT change: a `##` section owns its
    // subsections. `design-hash.ts` depends on it for `## Confirmed`.
    const doc = [
      '## Required Check Policy',
      'preamble',
      '',
      '### enforceA',
      'alpha body',
      '',
      '### enforceB',
      'beta body',
      '',
      '## Next Top Level',
      'unrelated',
      '',
    ].join('\n');

    const policy = sectionBody(doc, 'Required Check Policy');

    expect(policy).toContain('preamble');
    expect(policy).toContain('### enforceA');
    expect(policy).toContain('alpha body');
    expect(policy).toContain('### enforceB');
    expect(policy).toContain('beta body');
    expect(policy).not.toContain('unrelated');
  });

  it('regression 3a: an indented look-alike heading (e.g. inside a code block) is not the heading', () => {
    // MUTATION: drop the `^` anchor from the opening match. Without it, the
    // indented `## Config` inside the fenced block matches first, and because
    // the slice starts at the `#` the body regex happily validates — returning
    // the code sample instead of the real section. Red.
    //
    // This is what the line anchor actually buys. The earlier version of this
    // test asserted level selection instead, which the body regex re-validates
    // anyway; the mutation left it green, so it proved nothing. Kept as a
    // reminder that a test is only worth its mutation.
    const doc = [
      '# Doc',
      '',
      'Example of what NOT to write:',
      '',
      '```md',
      '    ## Config',
      '    fake body',
      '```',
      '',
      '## Config',
      'real body',
      '',
    ].join('\n');

    const body = sectionBody(doc, 'Config');
    expect(body).toContain('real body');
    expect(body).not.toContain('fake body');
  });

  it('regression 3b: a longer heading with the same prefix does not shadow the real one', () => {
    // MUTATION: drop the `$` anchor. `## Config Options` then matches the
    // lookup of `Config`, the body regex fails on the trailing " Options",
    // and sectionBody returns '' for a heading that plainly exists. Red.
    const doc = [
      '## Config Options',
      'options body',
      '',
      '## Config',
      'real body',
      '',
    ].join('\n');

    expect(sectionBody(doc, 'Config')).toContain('real body');
    expect(sectionBody(doc, 'Config Options')).toContain('options body');
  });

  it('regression 3c: a bare name resolves against a ### heading, with the ### terminator', () => {
    // The fixed extractor DOES resolve a bare name at any level — that is what
    // lets `ci-gate: enforceInteractionDesign :: …` find a `###` section. What
    // it must not do is take the level-2 body.
    const doc = [
      '## Deploy Config',
      'top-level body',
      '',
      '### Nested',
      'nested body',
      '',
      '### Sibling',
      'sibling body',
      '',
    ].join('\n');

    const nested = sectionBody(doc, 'Nested');
    expect(nested).toContain('nested body');
    expect(nested).not.toContain('sibling body');
    expect(sectionBody(doc, 'Deploy Config')).toContain('top-level body');
  });

  it('an absent heading returns the empty string, not a partial match', () => {
    // MUTATION: `if (!open) return ''` → `return stripped` and this goes red.
    expect(sectionBody('## A\nbody\n', 'B')).toBe('');
  });

  it('a heading carrying a trailing parenthetical is not reachable by its bare name', () => {
    // Deliberate, and depended upon: parenthetical tolerance lives in
    // design-provenance.ts's heading resolver, not here. If this ever starts
    // passing, that resolver has silently become dead code.
    const doc = '## Provenance Reconciliation Policy (ADR 0012 §2)\nbody\n';
    expect(sectionBody(doc, 'Provenance Reconciliation Policy')).toBe('');
    expect(sectionBody(doc, 'Provenance Reconciliation Policy (ADR 0012 §2)')).toContain('body');
  });

  it('regex metacharacters in the heading are escaped, not interpreted', () => {
    // MUTATION: drop `.replace(RE_META, '\\$&')` → `C++ (v2)` is parsed as a
    // regex and either throws or matches the wrong thing.
    const doc = '## C++ (v2)\nbody\n\n## Other\nx\n';
    expect(sectionBody(doc, 'C++ (v2)')).toContain('body');
  });

  it('HTML comments are stripped before the body is read', () => {
    // MUTATION: skip stripHtmlComments → the commented line reappears.
    const doc = '## A\nreal\n<!-- hidden -->\n\n## B\nx\n';
    expect(sectionBody(doc, 'A')).toContain('real');
    expect(sectionBody(doc, 'A')).not.toContain('hidden');
  });

  it('an UNCLOSED HTML comment still leaks — documented, not fixed', () => {
    // Recorded as a known limit, deliberately out of scope for this change
    // (change-request.md defect 6, "what survives, narrowly"). If someone
    // hardens stripHtmlComments, this test tells them a decision was made
    // here rather than an oversight.
    expect(stripHtmlComments('a <!-- b')).toBe('a <!-- b');
  });
});

/**
 * The doc comment on markdown-section.ts claims it was centralized so no call
 * site keeps its own near-identical regex. That claim was false until IP-1:
 * `bug-suspects.ts` held a verbatim copy of the OLD regex. This pins the claim.
 */
describe('sectionBody — the centralization claim is true', () => {
  it('a ### heading with a ### sibling does not leak the sibling into the body', () => {
    // This is the shape that diverged: the old hand-copied regex ran a `###`
    // body to the next `## `, absorbing the sibling's list items. A list-parsing
    // caller (bug-suspects) then treated them as entries of the first section.
    const manifest = [
      '## Agent Work Packets',
      '',
      '### Allowed Paths',
      '- src/safe.ts',
      '',
      '### Forbidden Notes',
      '- src/credentials.ts',
      '',
      '## Required Contracts',
      '- contracts/api/api-contract.md',
      '',
    ].join('\n');

    const body = sectionBody(manifest, 'Allowed Paths');
    expect(body).toContain('src/safe.ts');
    expect(body).not.toContain('src/credentials.ts');
    expect(body).not.toContain('Forbidden Notes');
  });
});
