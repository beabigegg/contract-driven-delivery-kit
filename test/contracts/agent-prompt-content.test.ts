/**
 * AC-9 / AC-10 (interaction-design-loop, ADR 0012): content assertions for the
 * new `interaction-designer` agent prompt and the three edited downstream
 * prompts (`frontend-engineer`, `implementation-planner`, `ui-ux-reviewer`).
 * Generic prompt SHAPE (Read scope / Suggested artifacts / model frontmatter /
 * agent-log-protocol reference) is the existing shared lint in
 * `test/cli/agent-prompts-shape.test.ts` (extended to include
 * `interaction-designer` in this change); this file asserts CONTENT specific
 * to ADR 0012.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = process.cwd();

function readAgent(name: string): string {
  return readFileSync(join(repoRoot, '.claude', 'agents', `${name}.md`), 'utf8');
}

describe('interaction-designer.md — read-only proposer (AC-9/AC-10)', () => {
  const content = readAgent('interaction-designer');

  it('declares read-only tools: Read, Grep, Glob ONLY (structurally incapable of writing)', () => {
    const match = content.match(/^tools:\s*(.+)$/m);
    expect(match, 'missing tools: frontmatter line').toBeTruthy();
    const tools = match![1].split(',').map(t => t.trim());
    expect(tools.sort()).toEqual(['Glob', 'Grep', 'Read'].sort());
  });

  it('runs on model: opus (Decision-stage agent)', () => {
    expect(content).toMatch(/^model:\s*opus\s*$/m);
  });

  it('is documented as never authoring ## Confirmed', () => {
    expect(content).toMatch(/never\s+.*(author|write).*## ?Confirmed|## ?Confirmed[\s\S]{0,40}never/i);
  });

  it('never discusses color, typography, spacing, or aesthetics', () => {
    const rules = content.toLowerCase();
    expect(rules).toMatch(/business language only/);
    expect(rules).toMatch(/never gated/);
  });

  it('teaches control-as-conclusion-not-premise discipline', () => {
    expect(content).toMatch(/conclusion/i);
    expect(content).toMatch(/premise/i);
  });

  it('teaches perceptibility/reversibility as substitutes, not additive', () => {
    expect(content).toMatch(/substitute/i);
  });

  it('teaches the meaning<->form consistency bijection', () => {
    expect(content).toMatch(/bijection/i);
  });

  it('orders intents by real frequency, not feature importance', () => {
    expect(content).toMatch(/real user frequency|real frequency/i);
  });

  it('requires a provenance citation per item/state and forbids inventing one when the contract cannot supply it', () => {
    expect(content).toMatch(/provenance/i);
    expect(content).toMatch(/do not invent|not invent/i);
    expect(content).toMatch(/contract-reviewer/);
  });
});

describe('frontend-engineer.md — blocked on unconfirmed design (AC-9)', () => {
  const content = readAgent('frontend-engineer');

  it('reports blocked when interaction-design.md is missing or unconfirmed', () => {
    expect(content).toMatch(/interaction-design\.md/);
    expect(content).toMatch(/blocked/);
  });

  it('no longer carries the states "when applicable" escape hatch', () => {
    expect(content).not.toMatch(/when applicable/i);
  });

  it('states now come from the confirmed design, not the agent\'s own judgment', () => {
    expect(content).toMatch(/## States/);
  });
});

describe('implementation-planner.md — references the confirmed design (AC-9)', () => {
  const content = readAgent('implementation-planner');

  it('references interaction-design.md by path/section', () => {
    expect(content).toMatch(/interaction-design\.md/);
  });

  it('reports blocked when the design is missing or unconfirmed', () => {
    const idx = content.indexOf('interaction-design.md');
    expect(idx).toBeGreaterThan(-1);
    const nearby = content.slice(Math.max(0, idx - 400), idx + 600);
    expect(nearby).toMatch(/blocked/);
  });
});

describe('ui-ux-reviewer.md — reviews against the confirmed design (AC-9)', () => {
  const content = readAgent('ui-ux-reviewer');

  it('no longer references the broken contracts/ui/ pointer', () => {
    expect(content).not.toMatch(/contracts\/ui\//);
  });

  it('points to contracts/css/ instead', () => {
    expect(content).toMatch(/contracts\/css\//);
  });

  it('reviews against the confirmed interaction-design.md as the primary lens', () => {
    expect(content).toMatch(/interaction-design\.md/);
  });

  it('demotes Nielsen-style heuristics to a secondary lens', () => {
    expect(content).toMatch(/secondary,?\s+\w*\s*lens/i);
  });

  it('never files a finding about aesthetics, motion, or layout taste (Never Gated)', () => {
    expect(content).toMatch(/never file a finding/i);
    expect(content).toMatch(/aesthetics/i);
    expect(content).toMatch(/motion/i);
    expect(content).toMatch(/layout taste/i);
  });
});
