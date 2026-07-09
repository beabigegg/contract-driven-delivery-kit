/**
 * AC-2 (interaction-design-loop, ADR 0012 §1): the shipped
 * specs/templates/interaction-design.md scaffold must (a) carry every section
 * the ADR 0012 §1 derivation chain names, in the exact heading/table shape
 * src/commands/gate-design.ts and src/utils/design-provenance.ts actually
 * parse (this is the load-bearing agreement the batch task calls out: if the
 * template and the parser disagree, the template is wrong, not the gate), and
 * (b) fail `enforceInteractionDesign` as shipped -- a brand-new change that
 * scaffolds it and changes nothing must not silently pass, exactly as the
 * acceptance.yml scaffold fails enforceAcceptanceOracle (ADR 0010).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { stripFrontmatter } from '../../src/contracts/parser.js';
import { sectionBody } from '../../src/utils/markdown-section.js';
import { meaningfulChars, findPlaceholders } from '../../src/commands/gate-artifacts.js';
import { parseTable } from '../../src/utils/design-provenance.js';
import { runCli, makeTempDir, cleanupDir, hasPython } from '../helpers.js';

const TEMPLATE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'specs', 'templates', 'interaction-design.md',
);

function loadTemplate(): { raw: string; body: string } {
  const raw = readFileSync(TEMPLATE_PATH, 'utf8');
  const { body } = stripFrontmatter(raw);
  return { raw, body };
}

describe('specs/templates/interaction-design.md — derivation-chain section shape (AC-2)', () => {
  it('carries all seven ADR 0012 §1 derivation-chain sections', () => {
    const { body } = loadTemplate();
    // 1. presented information + rationale
    expect(body).toMatch(/## Presented Information/);
    // 2. user intents ordered by frequency + path
    expect(body).toMatch(/## User Intents/);
    // 3. control <-> intent mapping incl. deleted controls + reason
    expect(body).toMatch(/## Controls/);
    expect(body).toMatch(/### Deleted Controls/);
    // 4. reversibility
    expect(body).toMatch(/## Reversibility/);
    // 5. meaning<->form consistency bijection
    expect(body).toMatch(/## Consistency Commitments/);
    // 6. Open Decisions
    expect(body).toMatch(/## Open Decisions/);
    // 7. Confirmed
    expect(body).toMatch(/## Confirmed/);
  });

  it('also carries ## Screens and ## States (parsed by gate-design.ts, additional to the seven)', () => {
    const { body } = loadTemplate();
    expect(body).toMatch(/## Screens/);
    expect(body).toMatch(/## States/);
  });

  it('## Presented Information table has the exact | item | rationale | provenance | header gate-design.ts parses', () => {
    const { body } = loadTemplate();
    const table = parseTable(sectionBody(body, 'Presented Information'));
    expect(table.header).toEqual(expect.arrayContaining(['item', 'rationale', 'provenance']));
  });

  it('## User Intents table has the exact | id | intent | frequency | path | header gate-design.ts parses', () => {
    const { body } = loadTemplate();
    const table = parseTable(sectionBody(body, 'User Intents'));
    expect(table.header).toEqual(expect.arrayContaining(['id', 'intent', 'frequency', 'path']));
  });

  it('## Controls table has an | id | control | intent | header, and ### Deleted Controls nests INSIDE the Controls section (not a sibling ##)', () => {
    const { body } = loadTemplate();
    const controlsSection = sectionBody(body, 'Controls');
    expect(controlsSection).toMatch(/###\s+Deleted Controls/i);

    const mainTable = parseTable(controlsSection.split(/###\s+Deleted Controls/i)[0]);
    expect(mainTable.header).toEqual(expect.arrayContaining(['id', 'control', 'intent']));

    const deletedTable = parseTable(controlsSection.split(/###\s+Deleted Controls/i)[1]);
    expect(deletedTable.header).toEqual(expect.arrayContaining(['control', 'reason']));
  });

  it('## States table has the exact | id | meaning | discriminator | header gate-design.ts parses', () => {
    const { body } = loadTemplate();
    const table = parseTable(sectionBody(body, 'States'));
    expect(table.header).toEqual(expect.arrayContaining(['id', 'meaning', 'discriminator']));
  });

  it('## Open Decisions ships an unresolved "- [ ] ..." item in the exact list grammar gate-design.ts parses', () => {
    const { body } = loadTemplate();
    const section = sectionBody(body, 'Open Decisions');
    const lines = section.split('\n').map(l => l.trim()).filter(l => /^-\s*\[[ xX]\]/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some(l => /^-\s*\[ \]/.test(l))).toBe(true);
  });

  it('## Confirmed is agent-forbidden by its own header comment and names the design-confirm lock step', () => {
    // sectionBody() strips HTML comments as part of extraction (by design --
    // gate-design.ts reads the STRIPPED body to decide hasConfirmed), so the
    // human-forbidden guidance itself must be asserted against the RAW body,
    // not the sectionBody()-processed text.
    const { body } = loadTemplate();
    const confirmedHeadingIdx = body.indexOf('## Confirmed');
    expect(confirmedHeadingIdx).toBeGreaterThan(-1);
    const rawConfirmedRegion = body.slice(confirmedHeadingIdx);
    expect(rawConfirmedRegion).toMatch(/AGENT-FORBIDDEN/);
    expect(rawConfirmedRegion).toMatch(/design confirm/);
  });

  it('## Confirmed has zero meaningful chars as shipped -- a fresh scaffold must not look human-confirmed', () => {
    // This is the exact signal gate-design.ts's hasConfirmed check reads:
    // meaningfulChars(sectionBody(body, 'Confirmed')) > 0. sectionBody()
    // strips HTML comments before returning, so an all-comment guidance
    // section (any style: one block or many single-line comments) correctly
    // yields zero here -- a human has not yet written anything real.
    const { body } = loadTemplate();
    const section = sectionBody(body, 'Confirmed');
    expect(meaningfulChars(section)).toBe(0);
  });

  it('carries the ADR 0011 applicability / applicability-reason frontmatter escape, commented out by default', () => {
    const raw = readFileSync(TEMPLATE_PATH, 'utf8');
    const frontmatterBlock = raw.slice(0, raw.indexOf('\n---', 3));
    expect(frontmatterBlock).toMatch(/applicability: not-applicable/);
    expect(frontmatterBlock).toMatch(/applicability-reason:/);

    const { frontmatter } = stripFrontmatter(raw);
    expect(frontmatter.applicability).toBeUndefined();
  });
});

describe('specs/templates/interaction-design.md — fail-closed placeholder (AC-2)', () => {
  it('is still a stub/placeholder per the shared findPlaceholders detection gate-design.ts reuses', () => {
    const { raw } = loadTemplate();
    expect(findPlaceholders(raw).length).toBeGreaterThan(0);
  });

  it.skipIf(!hasPython())('a brand-new `cdd-kit new` scaffold fails `cdd-kit gate` on this artifact', () => {
    const tmpRepo = makeTempDir('cdd-design-template-repo-');
    const tmpHome = makeTempDir('cdd-design-template-home-');
    try {
      const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
      expect(init.status, `init stderr: ${init.stderr}`).toBe(0);

      const created = runCli(['new', 'design-scaffold-only'], { cwd: tmpRepo, home: tmpHome });
      expect(created.status, `new stderr: ${created.stderr}`).toBe(0);

      const r = runCli(['gate', 'design-scaffold-only'], { cwd: tmpRepo, home: tmpHome });
      expect(r.status).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/interaction-design\.md/i);
    } finally {
      cleanupDir(tmpRepo);
      cleanupDir(tmpHome);
    }
  });
});
