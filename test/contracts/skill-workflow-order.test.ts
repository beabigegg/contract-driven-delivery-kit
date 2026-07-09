/**
 * AC-1 (interaction-design-loop, ADR 0012 §3): `interaction-designer` sits
 * between `contract-reviewer` and `implementation-planner` in BOTH the
 * Tier 2-3 and the Tier 0-1 agent orders inside
 * `.claude/skills/cdd-new/SKILL.md`, the back-edge to `contract-reviewer` is
 * documented, and `.claude/skills/cdd-resume/SKILL.md` reflects the same
 * insertion.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = process.cwd();

function read(relPath: string): string {
  return readFileSync(join(repoRoot, ...relPath.split('/')), 'utf8');
}

describe('cdd-new/SKILL.md — interaction-designer node placement (AC-1)', () => {
  const content = read('.claude/skills/cdd-new/SKILL.md');

  function tierBlock(heading: RegExp, nextHeading: RegExp): string {
    const startMatch = content.match(heading);
    expect(startMatch, `missing heading matching ${heading}`).toBeTruthy();
    const start = startMatch!.index!;
    const rest = content.slice(start);
    const endMatch = rest.match(nextHeading);
    return endMatch ? rest.slice(0, endMatch.index) : rest;
  }

  it('sits between contract-reviewer and implementation-planner in the Tier 2-3 block', () => {
    const block = tierBlock(/### Tier 2–3[^\n]*\n/, /### Tier 0–1/);
    const reviewerIdx = block.indexOf('`contract-reviewer`');
    const designerIdx = block.indexOf('`interaction-designer`');
    const plannerIdx = block.indexOf('`implementation-planner`');
    expect(reviewerIdx).toBeGreaterThan(-1);
    expect(designerIdx).toBeGreaterThan(-1);
    expect(plannerIdx).toBeGreaterThan(-1);
    expect(reviewerIdx).toBeLessThan(designerIdx);
    expect(designerIdx).toBeLessThan(plannerIdx);
  });

  it('same ordering holds in the Tier 0-1 block (unambiguous, not just inherited by silence)', () => {
    const block = tierBlock(/### Tier 0–1[^\n]*\n/, /## Step 4/);
    // The Tier 0-1 block explicitly names interaction-designer's position
    // relative to contract-reviewer / implementation-planner rather than
    // leaving it to be inferred from "all agents from Tier 2-3".
    expect(block).toMatch(/interaction-designer/);
    expect(block).toMatch(/contract-reviewer/);
    expect(block).toMatch(/implementation-planner/);
  });

  it('documents the back-edge to contract-reviewer as a convergence loop, not a straight line', () => {
    const block = tierBlock(/### Tier 2–3[^\n]*\n/, /### Tier 0–1/);
    expect(block).toMatch(/back-edge/i);
    expect(block).toMatch(/back to `contract-reviewer`|back to contract-reviewer/i);
    expect(block).toMatch(/converge/i);
  });

  it('documents the propose -> human dialogue -> confirm choreography, citing the two existing precedents', () => {
    const block = tierBlock(/### Tier 2–3[^\n]*\n/, /### Tier 0–1/);
    expect(block).toMatch(/Step 0: Request quality check/);
    expect(block).toMatch(/Atomic Split Proposal/);
    expect(block).toMatch(/## Confirmed/);
    expect(block).toMatch(/design confirm/);
  });

  it('records the ADR 0011 skip path (applicability: not-applicable + required reason)', () => {
    const block = tierBlock(/### Tier 2–3[^\n]*\n/, /### Tier 0–1/);
    expect(block).toMatch(/applicability: not-applicable/);
    expect(block).toMatch(/applicability-reason/i);
  });

  it('adds the Decision-stage badge row for interaction-designer', () => {
    expect(content).toMatch(/\|\s*Decision\s*\|\s*`interaction-designer`\s*\|\s*🟣\s*`\[design\]`\s*\|/);
  });

  it('adds interaction-designer to the Write Responsibilities table as a read-only agent', () => {
    const match = content.match(/\|\s*Read-only agents[^\n]*\n/);
    expect(match, 'missing Write Responsibilities read-only agents row').toBeTruthy();
    expect(match![0]).toMatch(/`interaction-designer`/);
  });

  it('adds interaction-design.md to the scaffold table and artifact-ownership table', () => {
    expect(content).toMatch(/\|\s*`interaction-design\.md`\s*\|\s*`specs\/templates\/interaction-design\.md`\s*\|/);
    expect(content).toMatch(/screen information, user intents, control.{0,3}intent mapping, states \+ discriminators, human confirmation/);
  });
});

describe('cdd-resume/SKILL.md — reflects the interaction-design node (AC-1)', () => {
  const content = read('.claude/skills/cdd-resume/SKILL.md');

  it('reads interaction-design.md as part of resume state', () => {
    expect(content).toMatch(/interaction-design\.md/);
  });

  it('never resumes implementation-planner or implementation agents before the design is confirmed', () => {
    expect(content).toMatch(/Never resume `implementation-planner`.*interaction-design\.md|interaction-design\.md.*confirmed/i);
  });

  it('routes resume to interaction-designer between contract-reviewer and implementation-planner', () => {
    expect(content).toMatch(/interaction-designer/);
    const idx = content.indexOf('interaction-designer');
    const nearby = content.slice(Math.max(0, idx - 300), idx + 300);
    expect(nearby).toMatch(/contract-reviewer/);
  });
});
