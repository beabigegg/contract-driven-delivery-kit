import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';

export interface LintAgentsOptions {
  strict?: boolean;
}

interface Violation {
  file: string;
  rule: string;
  message: string;
  level: 'error' | 'warning';
}

/**
 * Extract the content of the `### Required artifacts for this agent` section.
 * The section ends at the next `##` or `###` heading, or EOF.
 */
function extractRequiredArtifactsSection(content: string): string | null {
  const match = content.match(
    /### Required artifacts for this agent\s*\n([\s\S]*?)(?=\n#{2,3} |\n---|\s*$)/,
  );
  return match ? match[0] : null;
}

/**
 * Extract the content of the first `## Read scope` section.
 * The section ends at the next `##` heading, or EOF.
 */
function extractFirstReadScopeSection(content: string): string | null {
  const match = content.match(/## Read scope\s*\n([\s\S]*?)(?=\n## |\s*$)/);
  return match ? match[0] : null;
}

/**
 * Extract the content of the YAML block inside the Required artifacts section.
 * That is the part between ```yaml and ``` (the first such fenced block).
 */
function extractYamlBlock(section: string): string | null {
  const match = section.match(/```ya?ml\s*\n([\s\S]*?)```/);
  return match ? match[0] : null;
}

/**
 * Check whether content outside the YAML fence contains flat backtick-keyed lines
 * like `- \`files-changed\`: …` that look like the OLD artifacts format.
 *
 * Only flags when there is NO yaml fence with `artifacts:` — the description
 * bullets in the new format (`- \`type\`: description`) are intentionally present
 * alongside the YAML block and must not be flagged.
 */
function hasFlatBacktickKeysWithoutFence(section: string): boolean {
  // If the section already has the proper yaml fence with artifacts:, the
  // description bullet lines are part of the new valid format — not a problem.
  if (/```ya?ml\s*\nartifacts:/.test(section)) return false;
  // Without a fence, any backtick-keyed list item is the old flat-key format.
  const withoutFence = section.replace(/```ya?ml[\s\S]*?```/g, '');
  return /^- `[a-z][a-z0-9-]+`:/m.test(withoutFence);
}

export async function lintAgents(opts: LintAgentsOptions): Promise<number> {
  const cwd = process.cwd();
  const agentsDir = join(cwd, '.claude', 'agents');

  let files: string[];
  try {
    files = readdirSync(agentsDir)
      .filter(f => f.endsWith('.md'))
      .sort();
  } catch {
    log.error(`lint-agents: cannot read ${agentsDir} — is this a cdd-kit project?`);
    return 1;
  }

  const violations: Violation[] = [];

  for (const filename of files) {
    const filePath = join(agentsDir, filename);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      violations.push({
        file: filename,
        rule: 'A',
        message: 'cannot read file',
        level: 'error',
      });
      continue;
    }

    // ── Rule A: Required artifacts section must have a YAML fence with artifacts:
    //            and at least one { type, pointer } line; must NOT have flat keys
    const artifactsSection = extractRequiredArtifactsSection(content);
    if (!artifactsSection) {
      violations.push({
        file: filename,
        rule: 'A',
        message: 'missing ### Required artifacts for this agent section',
        level: 'error',
      });
    } else {
      const yamlBlock = extractYamlBlock(artifactsSection);
      if (!yamlBlock || !/```ya?ml\s*\nartifacts:/.test(yamlBlock)) {
        violations.push({
          file: filename,
          rule: 'A',
          message: 'bad Required-artifacts format: missing fenced yaml block starting with "artifacts:"',
          level: 'error',
        });
      } else if (!yamlBlock.includes('{ type:') && !/- \{/.test(yamlBlock)) {
        violations.push({
          file: filename,
          rule: 'A',
          message: 'bad Required-artifacts format: YAML block has no { type: ..., pointer: ... } items',
          level: 'error',
        });
      }

      if (hasFlatBacktickKeysWithoutFence(artifactsSection)) {
        violations.push({
          file: filename,
          rule: 'A',
          message: 'bad Required-artifacts format: flat backtick-keyed lines found outside YAML fence (remove old `key: value` bullet style)',
          level: 'error',
        });
      }
    }

    // ── Rule B: At most one ## Read scope heading
    const readScopeCount = (content.match(/^## Read scope\s*$/gm) ?? []).length;
    if (readScopeCount > 1) {
      violations.push({
        file: filename,
        rule: 'B',
        message: `duplicate ## Read scope headings found (${readScopeCount} occurrences — remove all but the first)`,
        level: 'error',
      });
    }

    // ── Rule C: When ## Read scope is present, it must reference context-manifest.md
    if (readScopeCount >= 1) {
      const readScopeSection = extractFirstReadScopeSection(content);
      if (readScopeSection && !readScopeSection.includes('context-manifest.md')) {
        violations.push({
          file: filename,
          rule: 'C',
          message: '## Read scope section does not reference context-manifest.md',
          level: 'error',
        });
      }
    }

    // ── Rule D: File must reference references/agent-log-protocol.md
    if (!content.includes('references/agent-log-protocol.md')) {
      violations.push({
        file: filename,
        rule: 'D',
        message: 'missing reference to references/agent-log-protocol.md',
        level: opts.strict ? 'error' : 'warning',
      });
    }
  }

  // ── Output violations to stderr
  for (const v of violations) {
    const prefix = v.level === 'error' ? 'error' : 'warning';
    process.stderr.write(`${v.file}: [Rule ${v.rule}] ${prefix} — ${v.message}\n`);
  }

  const errorCount = violations.filter(v => v.level === 'error').length;
  const warnCount = violations.filter(v => v.level === 'warning').length;

  console.log(`lint-agents: ${errorCount} error(s), ${warnCount} warning(s)`);

  if (errorCount > 0) return 1;
  if (opts.strict && warnCount > 0) return 1;
  return 0;
}
