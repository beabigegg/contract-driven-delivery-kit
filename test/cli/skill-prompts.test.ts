import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = process.cwd();

describe('CDD skill prompt integration', () => {
  it('cdd-new runs context-scan before classification and writes context manifest from classifier draft', () => {
    const skill = readFileSync(join(repoRoot, '.claude', 'skills', 'cdd-new', 'SKILL.md'), 'utf8');

    expect(skill).toMatch(/cdd-kit new <change-id>/);
    expect(skill).toMatch(/cdd-kit context-scan/);
    expect(skill).toMatch(/specs\/context\/project-map\.md/);
    expect(skill).toMatch(/specs\/context\/contracts-index\.md/);
    expect(skill).toMatch(/Do not authorize the classifier to read `contracts\/`, `src\/`, `tests\/`/);
    expect(skill).toMatch(/Context Manifest Draft/);
    expect(skill).toMatch(/YOU update.*context-manifest\.md/s);
  });

  it('change-classifier is constrained to deterministic context indexes', () => {
    const classifier = readFileSync(join(repoRoot, '.claude', 'agents', 'change-classifier.md'), 'utf8');

    expect(classifier).toMatch(/## Context boundaries/);
    expect(classifier).toMatch(/specs\/changes\/<change-id>\/change-request\.md/);
    expect(classifier).toMatch(/specs\/changes\/<change-id>\/context-manifest\.md/);
    expect(classifier).toMatch(/specs\/context\/project-map\.md/);
    expect(classifier).toMatch(/specs\/context\/contracts-index\.md/);
    expect(classifier).toMatch(/Do not read `contracts\/`, `src\/`, `tests\/`/);
    expect(classifier).toMatch(/Do not invent paths/);
    expect(classifier).toMatch(/## Context Manifest Draft/);
  });

  it('cdd-resume resumes from manifest and logs without broad repository scans', () => {
    const resume = readFileSync(join(repoRoot, '.claude', 'skills', 'cdd-resume', 'SKILL.md'), 'utf8');

    expect(resume).toMatch(/context-manifest\.md/);
    expect(resume).toMatch(/agent-log\/\*\.md/);
    expect(resume).toMatch(/Do not run broad repository search during resume/);
    expect(resume).toMatch(/If any request has `status: pending`, stop before invoking agents/);
    expect(resume).toMatch(/Pending context expansions/);
    expect(resume).toMatch(/Read only paths allowed by the context manifest and approved expansions/);
    expect(resume).toMatch(/Context Expansion Request instead of reading outside the manifest/);
  });
});
