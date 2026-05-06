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
    expect(resume).toMatch(/agent-log\/\*\.yml/);
    expect(resume).toMatch(/Do not run broad repository search during resume/);
    expect(resume).toMatch(/If any request has `status: pending`, stop before invoking agents/);
    expect(resume).toMatch(/Pending context expansions/);
    expect(resume).toMatch(/Read only paths allowed by the context manifest and approved expansions/);
    expect(resume).toMatch(/Context Expansion Request instead of reading outside the manifest/);
  });

  it('agent prompts keep write-capable vs read-only logging responsibilities consistent', () => {
    const cddNew = readFileSync(join(repoRoot, '.claude', 'skills', 'cdd-new', 'SKILL.md'), 'utf8');
    const codex = readFileSync(join(repoRoot, 'CODEX.template.md'), 'utf8');
    const contractReviewer = readFileSync(join(repoRoot, '.claude', 'agents', 'contract-reviewer.md'), 'utf8');
    const qaReviewer = readFileSync(join(repoRoot, '.claude', 'agents', 'qa-reviewer.md'), 'utf8');
    const backend = readFileSync(join(repoRoot, '.claude', 'agents', 'backend-engineer.md'), 'utf8');
    const frontend = readFileSync(join(repoRoot, '.claude', 'agents', 'frontend-engineer.md'), 'utf8');

    expect(cddNew).toMatch(/write-capable agents write their own/);
    expect(cddNew).toMatch(/YOU write it for read-only agents/);
    expect(codex).toMatch(/agent-log\/\*\.yml/);
    expect(codex).toMatch(/files-read:/);
    expect(contractReviewer).toMatch(/end your response with an `Agent Log` YAML block[\s\S]*for main Claude to write to/);
    expect(qaReviewer).toMatch(/end your response with an `Agent Log` YAML block[\s\S]*for main Claude to write to/);
    expect(backend).toMatch(/After completing your task, write or append to/);
    expect(frontend).toMatch(/After completing your task, write or append to/);
  });

  it('documents artifact pointer path-validation rules in cdd-new and agent-log protocol', () => {
    const cddNew = readFileSync(join(repoRoot, '.claude', 'skills', 'cdd-new', 'SKILL.md'), 'utf8');
    const protocol = readFileSync(
      join(repoRoot, '.claude', 'skills', 'contract-driven-delivery', 'references', 'agent-log-protocol.md'),
      'utf8',
    );

    for (const content of [cddNew, protocol]) {
      expect(content).toMatch(/before the first\s+`:` contains `\/`/);
      expect(content).toMatch(/repo-relative file path/);
      expect(content).toMatch(/one\s+file/i);
      expect(content).toMatch(/parenthetical notes?/i);
      expect(content).toMatch(/I\/O/);
      expect(content).toMatch(/WARNING\/OVERDUE/);
    }
  });

  it('cdd-close promotes only evidence-backed durable learnings to hot sources', () => {
    const close = readFileSync(join(repoRoot, '.claude', 'skills', 'cdd-close', 'SKILL.md'), 'utf8');
    const cddNew = readFileSync(join(repoRoot, '.claude', 'skills', 'cdd-new', 'SKILL.md'), 'utf8');
    const workflow = readFileSync(join(repoRoot, '.claude', 'skills', 'contract-driven-delivery', 'SKILL.md'), 'utf8');
    const tasks = readFileSync(
      join(repoRoot, '.claude', 'skills', 'contract-driven-delivery', 'templates', 'tasks.yml'),
      'utf8',
    );
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');

    expect(close).toMatch(/Hot \/ Warm \/ Cold Data Rules/);
    expect(close).toMatch(/Cold data is historical evidence, not current requirements/);
    expect(close).toMatch(/Do not read `specs\/archive\/` while closing a change/);
    expect(close).toMatch(/Archive prose alone is not enough to change hot data/);
    expect(close).toMatch(/promote-to-contract/);
    expect(close).toMatch(/promote-to-guidance/);
    expect(close).toMatch(/do-not-promote/);
    expect(close).toMatch(/NEVER promote a lesson without an evidence path from this change/);
    expect(close).toMatch(/cdd-kit context-scan/);
    expect(close).toMatch(/CLAUDE\.md\/CODEX\.md/);

    for (const content of [close, cddNew, workflow, readme]) {
      expect(content).toMatch(/record evidence and\s+findings/i);
      expect(content).toMatch(/durable\s+learning\s+promotion\s+happens[\s\S]*\/cdd-close[\s\S]*Step 3/i);
      expect(content).toMatch(/`contracts\/` or project\s+guidance \(`CLAUDE\.md`\/`CODEX\.md`\)/);
    }

    expect(tasks).toContain('Promote durable learnings to contracts or project guidance');
  });
});
