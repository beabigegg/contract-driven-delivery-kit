/**
 * Unit tests for the pure gate-failure explainer (P0-6).
 *
 * These exercise the message → {why, sayToClaude} mapping directly, with no
 * CLI spawn, so the full table of failure families stays cheap to cover and
 * the wording is pinned. CLI wiring (the --explain flag, the trailing hint
 * line, the duplicate-warning fix) is covered in test/cli/gate.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { explainGateError } from '../../src/utils/gate-explain.js';

describe('explainGateError — every explanation is non-engineer-friendly and actionable', () => {
  const realErrors: Array<[string, string]> = [
    ['tier floor', 'tier floor violation: Authentication surface detected (matched: auth) requires tier 0 or stricter, but classification declared tier 3. Re-classify to tier 0 (or stricter), or record `tier-floor-override: "<reason>"` in tasks.yml frontmatter to bypass with an audit trail. Disable entirely in .cdd/tier-policy.json.'],
    ['missing tier marker', 'change-classification.md: missing tier marker. Set `tier: <0-5>` in tasks.yml frontmatter (preferred) or include `## Tier\\n- N` in change-classification.md.'],
    ['missing tier/risk marker', 'change-classification.md: missing tier/risk marker (set tier in tasks.yml frontmatter, or include Tier 0-5 / low|medium|high|critical in change-classification.md)'],
    ['tier mismatch', 'tier mismatch: tasks.yml frontmatter says 3, change-classification.md says 1 (frontmatter wins; reconcile classification).'],
    ['missing artifact', 'missing required artifact: tasks.yml'],
    ['stub', 'change-request.md: appears to be a stub (< 100 meaningful chars)'],
    ['placeholder', 'change-request.md: still contains unfilled template placeholder(s) <change-id>, TODO — replace them with the change\'s real values before the gate can pass'],
    ['pending tasks', '3 task(s) still pending (mark archive items in archive-tasks frontmatter; mark N/A items as status: skipped). Run gate without --strict during development.'],
    ['test evidence missing', 'missing test-evidence.yml (legacy change; run `cdd-kit test run` to record bounded test evidence)'],
    ['dep cycle', 'depends-on cycle detected: feat-a -> feat-b -> feat-a'],
    ['dep not ready', 'dependency feat-x: upstream change is not completed (status: in-progress)'],
    ['dep missing', 'dependency feat-x: missing tasks.yml'],
    ['invalid yaml', 'tasks.yml: invalid YAML: bad indentation'],
    ['empty yaml', 'test-evidence.yml: file is empty or not a YAML mapping'],
  ];

  it.each(realErrors)('explains the %s failure with a why + a Claude sentence', (_label, error) => {
    const ex = explainGateError(error);
    expect(ex, `no explanation for: ${error}`).not.toBeNull();
    // "Why" is a real sentence, not an echo of the raw error.
    expect(ex!.why.length).toBeGreaterThan(20);
    // The Claude prompt reads like an instruction the user can paste verbatim.
    expect(ex!.sayToClaude.length).toBeGreaterThan(20);
    expect(ex!.sayToClaude).toMatch(/please/i);
  });

  it('the tier-floor explanation avoids the word "frontmatter" and names the risk concept', () => {
    const ex = explainGateError('tier floor violation: Authentication surface detected (matched: auth) requires tier 0 or stricter, but classification declared tier 3.');
    expect(ex).not.toBeNull();
    expect(ex!.why.toLowerCase()).not.toContain('frontmatter');
    expect(ex!.why.toLowerCase()).toMatch(/risk|sensitive/);
    expect(ex!.sayToClaude.toLowerCase()).toMatch(/re-?class/);
  });

  it('a missing-artifact explanation names the specific file in the Claude sentence', () => {
    const ex = explainGateError('missing required artifact: test-plan.md');
    expect(ex).not.toBeNull();
    expect(ex!.sayToClaude).toContain('test-plan.md');
  });

  it('returns null for an unrecognized error so the caller can fall back', () => {
    expect(explainGateError('some entirely novel failure mode 42')).toBeNull();
  });
});
