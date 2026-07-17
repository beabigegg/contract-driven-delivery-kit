import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { sectionBody } from '../utils/markdown-section.js';
import { meaningfulChars } from './gate-artifacts.js';
import { loadYamlFile, type TasksFile } from './gate-shared.js';

/**
 * Required-agent evidence (ADR 0008) — ADVISORY (warning-only).
 *
 * The classifier records the agents a change needs in `change-classification.md`
 * `## Required Agents`. A required review can be ticked `done` in tasks.yml with
 * no `agent-log/<agent>.yml` — i.e. no trace it actually ran — which matters most
 * in a no-human-review workflow where nobody else would notice.
 *
 * But an agent-log is **post-hoc, self-reported** evidence: audit, not
 * prevention. Making it a hard gate would convert a prevention-first tool into
 * post-run paperwork, against the kit's design ("`cdd-kit gate` focuses on
 * delivery quality, not post-run read paperwork") — and the log is fakeable, so
 * a hard requirement buys little. The real prevention for mechanically-checkable
 * concerns already lives in the validators / API + data-shape conformance /
 * test-evidence layer, which does not care whether a reviewer agent "ran": a bad
 * contract fails the validators regardless. The genuine residual gap is the
 * judgment-only reviews (UI/UX, visual) that have no mechanical net.
 *
 * So this check is **warning-only** — it surfaces required agents that left no
 * (or only a stub / copied) log as a nudge, never an error, even under
 * `--strict` — mirroring the advisory chokepoint dashboard and conformance
 * recommendation. A change that declares no `## Required Agents` is untouched.
 */

/** Minimum meaningful chars for a required-agent log to read as real evidence (not a stub). */
const MIN_AGENT_LOG_CHARS = 60;

/**
 * Historical filename/author aliases for an agent's log. The canonical name is
 * the agent file stem under `.claude/agents/`; some older scaffolds wrote a
 * shorter variant, so accept both rather than flag a legitimately-named log.
 */
const LOG_ALIASES: Record<string, string[]> = {
  'ci-cd-gatekeeper': ['ci-cd-gatekeeper', 'ci-gatekeeper'],
};

/**
 * Parse the agent names from a `## Required Agents` list. Each item is a markdown
 * list line naming one agent, optionally backtick-wrapped (`- \`backend-engineer\``
 * or `- backend-engineer`). De-duplicated, lowercased, order-preserving.
 */
/**
 * The agents this change declared it needs (ADR 0008). `tasks.yml`'s
 * `classification.required-agents` first, then v1's `## Required Agents` list in
 * change-classification.md.
 *
 * The old code took the absence of change-classification.md as "a missing
 * classification is already a gate error elsewhere" and returned early. That was
 * true while the file was in REQUIRED_FILES; once v2 folded the classification
 * into tasks.yml, the file is legitimately absent and that early return silently
 * turned this whole check off for every new change.
 */
export function readRequiredAgents(changeDir: string): string[] {
  const tasksPath = join(changeDir, 'tasks.yml');
  if (existsSync(tasksPath)) {
    const { data } = loadYamlFile<TasksFile>(tasksPath);
    const declared = data?.classification?.['required-agents'];
    if (Array.isArray(declared)) {
      const seen = new Set<string>();
      for (const raw of declared) {
        if (typeof raw === 'string' && /^[a-z][a-z0-9-]*$/i.test(raw.trim())) seen.add(raw.trim().toLowerCase());
      }
      if (seen.size > 0) return [...seen];
    }
    // A v2 change that declares no agents means exactly that. Only fall through
    // to the v1 file when tasks.yml carries no classification at all.
    if (data?.classification) return [];
  }

  const classifPath = join(changeDir, 'change-classification.md');
  if (!existsSync(classifPath)) return [];
  return parseRequiredAgents(readFileSync(classifPath, 'utf8'));
}

export function parseRequiredAgents(classificationContent: string): string[] {
  const body = sectionBody(classificationContent, 'Required Agents');
  if (!body.trim()) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*-\s*`?([a-z][a-z0-9-]*)`?\s*$/i);
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** Resolve an agent's log path, honoring known filename aliases; null if none exists. */
function resolveAgentLog(agentLogDir: string, agent: string): string | null {
  for (const candidate of LOG_ALIASES[agent] ?? [agent]) {
    const p = join(agentLogDir, `${candidate}.yml`);
    if (existsSync(p)) return p;
  }
  return null;
}

/** True when `author` names the same agent (alias-tolerant). */
function authorMatches(agent: string, author: string): boolean {
  const a = author.toLowerCase();
  return a === agent || (LOG_ALIASES[agent]?.includes(a) ?? false);
}

/**
 * Surface (warn) required agents that left no verifiable trace. Always
 * warning-only — never pushes to errors — so it informs without turning the gate
 * into a post-hoc-paperwork blocker (ADR 0008).
 */
export function enforceRequiredAgentEvidence(changeDir: string, warnings: string[]): void {
  const required = readRequiredAgents(changeDir);
  if (required.length === 0) return; // nothing declared → nothing to surface

  const agentLogDir = join(changeDir, 'agent-log');

  for (const agent of required) {
    const logPath = resolveAgentLog(agentLogDir, agent);

    if (!logPath) {
      warnings.push(
        `required agent \`${agent}\` left no evidence: no agent-log/${agent}.yml (advisory, ADR 0008) — ` +
        `a ticked tasks.yml item is not a trace that it ran. Write a short log if you want its run to be verifiable.`,
      );
      continue;
    }

    const rel = `agent-log/${logPath.split(/[\\/]/).pop()}`;
    const raw = readFileSync(logPath, 'utf8');
    if (meaningfulChars(raw) < MIN_AGENT_LOG_CHARS) {
      warnings.push(`${rel}: required agent \`${agent}\` log looks like a stub (< ${MIN_AGENT_LOG_CHARS} meaningful chars) (advisory, ADR 0008).`);
      continue;
    }

    const { data, parseError } = loadYamlFile<Record<string, unknown>>(logPath);
    if (parseError) {
      warnings.push(`${rel}: invalid YAML: ${parseError} (advisory, ADR 0008)`);
      continue;
    }
    if (!data || typeof data !== 'object') {
      warnings.push(`${rel}: empty or not a YAML mapping (advisory, ADR 0008).`);
      continue;
    }

    const author = (data as { agent?: unknown }).agent;
    if (typeof author === 'string' && author.trim() !== '' && !authorMatches(agent, author)) {
      warnings.push(
        `${rel}: \`agent: ${author}\` does not match required agent \`${agent}\` — ` +
        `the log may be copied from another agent (advisory, ADR 0008).`,
      );
    }
  }
}
