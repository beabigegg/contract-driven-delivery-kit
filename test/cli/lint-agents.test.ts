import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: scaffold a minimal .claude/agents/ directory in a temp cwd
// ─────────────────────────────────────────────────────────────────────────────

function makeAgentsDir(tmpDir: string): string {
  const dir = join(tmpDir, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A well-formed agent file that should pass all rules. */
function passingAgentContent(): string {
  return `---
name: test-agent
description: A test agent.
tools: Read
model: claude-sonnet-4-6
---

## Read scope

Source of truth: \`specs/changes/<change-id>/context-manifest.md\` → \`## Allowed Paths\`.
Read it first (your prompt header has \`CURRENT_CHANGE_ID\`).

## Machine-Verifiable Evidence

After completing your task, write to the agent log.
See \`references/agent-log-protocol.md\` for the full schema.

### Required artifacts for this agent

\`artifacts\` is a YAML array of \`{type, pointer}\` items in your agent log
(see \`references/agent-log-protocol.md\` for the full schema and self-validation
checklist).

Minimum required \`type\` values:

- \`files-changed\`: source files modified

\`\`\`yaml
artifacts:
  - { type: files-changed, pointer: "src/api/users.ts:10-45" }
\`\`\`

If a required \`type\` does not apply, emit \`pointer: "n/a (<reason>)"\`.
`;
}

/** A file with OLD flat-list style (no artifacts: fence). */
function flatListAgentContent(): string {
  return `---
name: bad-agent
description: Bad artifacts section.
tools: Read
model: claude-sonnet-4-6
---

## Read scope

Source of truth: \`specs/changes/<change-id>/context-manifest.md\` → \`## Allowed Paths\`.

## Machine-Verifiable Evidence

See \`references/agent-log-protocol.md\`.

### Required artifacts for this agent
- \`files-changed\`: list of file paths
- \`tests-added\`: list of test names
`;
}

/** A file with two ## Read scope headings. */
function duplicateScopeAgentContent(): string {
  return `---
name: dup-scope-agent
description: Duplicate read scope.
tools: Read
model: claude-sonnet-4-6
---

## Read scope

Source of truth: \`specs/changes/<change-id>/context-manifest.md\` → \`## Allowed Paths\`.

## Read scope

- Allowed: \`contracts/\`, \`tests/\`

## Machine-Verifiable Evidence

See \`references/agent-log-protocol.md\`.

### Required artifacts for this agent

\`\`\`yaml
artifacts:
  - { type: files-changed, pointer: "src/x.ts:1-10" }
\`\`\`
`;
}

/** A file whose Required-artifacts YAML has a stray top-level key alongside `artifacts:`. */
function strayTopLevelKeyContent(): string {
  return `---
name: stray-top-key-agent
description: Stray sibling key alongside artifacts.
tools: Read
model: claude-sonnet-4-6
---

## Read scope

Source of truth: \`specs/changes/<change-id>/context-manifest.md\` → \`## Allowed Paths\`.

## Machine-Verifiable Evidence

See \`references/agent-log-protocol.md\`.

### Required artifacts for this agent

\`\`\`yaml
artifacts:
  - { type: files-changed, pointer: "src/x.ts:1-10" }
pointer: "this-should-not-be-here"
\`\`\`
`;
}

/** A file with ## Read scope but no reference to context-manifest.md. */
function missingContextManifestContent(): string {
  return `---
name: no-manifest-agent
description: Missing context manifest ref.
tools: Read
model: claude-sonnet-4-6
---

## Read scope

- Allowed: \`contracts/\`, \`tests/\`, \`src/\`
- Forbidden: \`specs/archive/\`

## Machine-Verifiable Evidence

See \`references/agent-log-protocol.md\`.

### Required artifacts for this agent

\`\`\`yaml
artifacts:
  - { type: files-changed, pointer: "src/x.ts:1-10" }
\`\`\`
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('cdd-kit lint-agents', () => {
  let tmpDir: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpDir = makeTempDir('cdd-lint-agents-');
    tmpHome = makeTempDir('cdd-lint-home-');
  });

  afterEach(() => {
    cleanupDir(tmpDir);
    cleanupDir(tmpHome);
  });

  it('1 — passing: correct shape exits 0 with no errors', () => {
    const agentsDir = makeAgentsDir(tmpDir);
    writeFileSync(join(agentsDir, 'passes.md'), passingAgentContent(), 'utf8');

    const r = runCli(['lint-agents'], { cwd: tmpDir, home: tmpHome });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/0 error\(s\)/);
  });

  it('2 — fail A: flat-list style triggers Rule A error', () => {
    const agentsDir = makeAgentsDir(tmpDir);
    writeFileSync(join(agentsDir, 'flat-list.md'), flatListAgentContent(), 'utf8');

    const r = runCli(['lint-agents'], { cwd: tmpDir, home: tmpHome });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/bad Required-artifacts format/i);
  });

  it('3 — fail B: duplicate ## Read scope triggers Rule B error', () => {
    const agentsDir = makeAgentsDir(tmpDir);
    writeFileSync(join(agentsDir, 'dup-scope.md'), duplicateScopeAgentContent(), 'utf8');

    const r = runCli(['lint-agents'], { cwd: tmpDir, home: tmpHome });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/duplicate.*Read scope|duplicate ## Read scope/i);
  });

  it('4 — fail C: ## Read scope without context-manifest.md reference triggers Rule C error', () => {
    const agentsDir = makeAgentsDir(tmpDir);
    writeFileSync(join(agentsDir, 'no-manifest.md'), missingContextManifestContent(), 'utf8');

    const r = runCli(['lint-agents'], { cwd: tmpDir, home: tmpHome });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/context-manifest\.md/i);
  });

  it('5 — fail A (strengthened): stray top-level key alongside artifacts: is rejected', () => {
    const agentsDir = makeAgentsDir(tmpDir);
    writeFileSync(join(agentsDir, 'stray-top-key.md'), strayTopLevelKeyContent(), 'utf8');

    const r = runCli(['lint-agents'], { cwd: tmpDir, home: tmpHome });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/stray top-level key/i);
    expect(r.stderr).toMatch(/pointer/);
  });
});
