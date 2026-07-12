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
    expect(skill).toMatch(/implementation-plan\.md/);
    expect(skill).toMatch(/implementation-planner/);
    expect(skill).toMatch(/Never start implementation[\s\S]*implementation-plan\.md/);
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
    expect(classifier).toMatch(/implementation-planner/);
    expect(classifier).toMatch(/implementation-plan\.md/);
  });

  it('implementation-planner owns the execution packet before implementation agents run', () => {
    const planner = readFileSync(join(repoRoot, '.claude', 'agents', 'implementation-planner.md'), 'utf8');
    const backend = readFileSync(join(repoRoot, '.claude', 'agents', 'backend-engineer.md'), 'utf8');
    const frontend = readFileSync(join(repoRoot, '.claude', 'agents', 'frontend-engineer.md'), 'utf8');
    const tasks = readFileSync(join(repoRoot, 'specs', 'templates', 'tasks.yml'), 'utf8');

    expect(planner).toMatch(/implementation-plan\.md/);
    expect(planner).toMatch(/execution packet/i);
    expect(planner).toMatch(/not infer/i);
    expect(planner).toMatch(/Edit tool/);
    expect(planner).toMatch(/Do not create or repair\s+`design\.md`/);
    expect(planner).toMatch(/### Suggested artifacts for this agent/);
    expect(backend).toMatch(/implementation-plan\.md/);
    expect(backend).toMatch(/report `blocked` instead of inferring requirements/i);
    expect(frontend).toMatch(/implementation-plan\.md/);
    expect(frontend).toMatch(/report `blocked` instead of inferring requirements/i);
    expect(tasks).toContain('Confirm design decisions if required');
    expect(tasks).toContain('Confirm implementation plan');
  });

  it('design.md is owned by spec-architect before implementation planning', () => {
    const cddNew = readFileSync(join(repoRoot, '.claude', 'skills', 'cdd-new', 'SKILL.md'), 'utf8');
    const classifier = readFileSync(join(repoRoot, '.claude', 'agents', 'change-classifier.md'), 'utf8');
    const architect = readFileSync(join(repoRoot, '.claude', 'agents', 'spec-architect.md'), 'utf8');
    const planner = readFileSync(join(repoRoot, '.claude', 'agents', 'implementation-planner.md'), 'utf8');
    const resume = readFileSync(join(repoRoot, '.claude', 'skills', 'cdd-resume', 'SKILL.md'), 'utf8');

    expect(cddNew).toMatch(/`design\.md` is owned by `spec-architect`, not `implementation-planner`/);
    expect(cddNew).toMatch(/marks `design\.md` as `yes`[\s\S]*lists `spec-architect`/);
    expect(classifier).toMatch(/If `design\.md` is `yes`[\s\S]*`spec-architect` must be listed/);
    expect(architect).toMatch(/owner for `specs\/changes\/<change-id>\/design\.md`/);
    expect(planner).toMatch(/route back to `spec-architect`/);
    expect(resume).toMatch(/resume from `spec-architect` before invoking `implementation-planner`/);
  });

  it('keeps optional markdown reports minimized and avoids duplicate artifact content', () => {
    const cddNew = readFileSync(join(repoRoot, '.claude', 'skills', 'cdd-new', 'SKILL.md'), 'utf8');
    const workflow = readFileSync(join(repoRoot, '.claude', 'skills', 'contract-driven-delivery', 'SKILL.md'), 'utf8');
    const classifier = readFileSync(join(repoRoot, '.claude', 'agents', 'change-classifier.md'), 'utf8');
    const planner = readFileSync(join(repoRoot, '.claude', 'agents', 'implementation-planner.md'), 'utf8');
    const template = readFileSync(join(repoRoot, 'specs', 'templates', 'implementation-plan.md'), 'utf8');
    const qa = readFileSync(join(repoRoot, '.claude', 'agents', 'qa-reviewer.md'), 'utf8');
    const visual = readFileSync(join(repoRoot, '.claude', 'agents', 'visual-reviewer.md'), 'utf8');

    for (const content of [cddNew, workflow, classifier]) {
      expect(content).toMatch(/agent-log\/\*\.yml/);
      expect(content).toMatch(/blocking findings/i);
      expect(content).toMatch(/approved-with-risk/i);
    }

    expect(classifier).toMatch(/visual-review-report\.md/);
    expect(classifier).toMatch(/monkey-test-report\.md/);
    expect(classifier).toMatch(/stress-soak-report\.md/);
    expect(planner).toMatch(/Do not copy their full\s+prose/i);
    expect(template).toMatch(/Source Artifact Pointers/);
    expect(template).toMatch(/Do not re-copy full design/);
    expect(qa).toMatch(/Do not ask main Claude to create `qa-report\.md` for a\s+routine approved change/i);
    expect(visual).toMatch(/Do not ask main Claude to create\s+`visual-review-report\.md`/i);
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

  it('agent prompts keep write-capable vs read-only responsibilities consistent', () => {
    const cddNew = readFileSync(join(repoRoot, '.claude', 'skills', 'cdd-new', 'SKILL.md'), 'utf8');
    const codex = readFileSync(join(repoRoot, 'CODEX.template.md'), 'utf8');
    const contractReviewer = readFileSync(join(repoRoot, '.claude', 'agents', 'contract-reviewer.md'), 'utf8');
    const qaReviewer = readFileSync(join(repoRoot, '.claude', 'agents', 'qa-reviewer.md'), 'utf8');
    const backend = readFileSync(join(repoRoot, '.claude', 'agents', 'backend-engineer.md'), 'utf8');
    const frontend = readFileSync(join(repoRoot, '.claude', 'agents', 'frontend-engineer.md'), 'utf8');
    const planner = readFileSync(join(repoRoot, '.claude', 'agents', 'implementation-planner.md'), 'utf8');

    expect(cddNew).toMatch(/optional handoff notes/i);
    expect(cddNew).toMatch(/only when useful/i);
    expect(codex).toMatch(/runtime evidence/i);
    expect(codex).toMatch(/digest-bound/i);
    expect(codex).not.toMatch(/agent-log\/\*\.yml/);
    expect(contractReviewer).toMatch(/optional `Agent Log` YAML block[\s\S]*for main Claude to write to/);
    expect(qaReviewer).toMatch(/optional `Agent Log` YAML block[\s\S]*for main Claude to write to/);
    // backend/frontend now require their own agent-log when listed in
    // ## Required Agents (ADR 0008); they still write their own log (write-capable).
    expect(backend).toMatch(/Write a handoff note to[\s\S]*ADR 0008/);
    expect(frontend).toMatch(/Write a handoff note to[\s\S]*ADR 0008/);
    expect(planner).toMatch(/If a short handoff note is useful, write or append to/);
  });

  it('provider guidance recommends MCP graph/code-map tools', () => {
    const codex = readFileSync(join(repoRoot, 'CODEX.template.md'), 'utf8');
    const claude = readFileSync(join(repoRoot, 'CLAUDE.template.md'), 'utf8');

    for (const content of [codex, claude]) {
      expect(content).toMatch(/Recommended MCP Tools/);
      expect(content).toMatch(/cdd_graph_context/);
      expect(content).toMatch(/cdd_graph_impact/);
      expect(content).toMatch(/cdd_index_query/);
      expect(content).toMatch(/cdd-kit graph/);
    }
    expect(claude).toMatch(/claude mcp add --scope user cdd-kit -- cdd-kit mcp/);
    expect(claude).toMatch(/~\/\.claude\.json/);
    expect(claude).toMatch(/~\/\.claude\/settings\.json/);
    expect(codex).toMatch(/codex mcp add cdd-kit -- cdd-kit mcp/);
    expect(codex).toMatch(/~\/\.codex\/config\.toml/);
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
