import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  bugFixEvidenceSchema,
  REPRODUCTION_STATUSES,
  HYPOTHESIS_RESULTS,
} from '../../src/schemas/bug-fix-evidence.schema.js';
import { agentLogSchema } from '../../src/schemas/agent-log.schema.js';

// Validate under the same Ajv configuration the gate uses (src/commands/gate.ts)
// so this unit test exercises the bug-fix evidence under the rules ADR 0006 PR 3
// gate enforcement will apply. Compiling here also proves both schemas are
// Ajv-strict clean before a later phase wires the block into the gate -- and that
// embedding the block in agent-log.schema.ts does not register a duplicate $id.
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validateBlock = ajv.compile(bugFixEvidenceSchema);
const validateLog = ajv.compile(agentLogSchema);

// A complete behavior-changing (non-diagnostic) repair record (ADR 0006 §2).
function validBlock(): Record<string, unknown> {
  return {
    'schema-version': '0.1.0',
    symptom: 'Orders page filter options are empty',
    expected_behavior: 'Status filter shows available statuses',
    actual_behavior: 'Filter dropdown renders no options',
    observed_surface: 'Orders page filter panel',
    reproduction: {
      status: 'test-reproduced',
      command: 'cdd-kit test run add-order-filter --phase targeted --json',
      failing_before_fix: true,
      summary: 'specs/changes/add-order-filter/test-runs/1/summary.json',
    },
    hypotheses: [
      {
        id: 'H1',
        candidate: 'src/pages/Orders.tsx::buildFilterOptions',
        reason: 'Graph query matched Orders page and filter symbol',
        result: 'confirmed',
      },
      {
        id: 'H2',
        candidate: 'src/api/orders.ts::fetchOrders',
        reason: 'API client may omit status field',
        result: 'rejected',
      },
    ],
    root_cause: {
      pointer: 'src/pages/Orders.tsx:42-68',
      summary: 'UI mapped status_label instead of canonical status',
    },
    fix: {
      files_changed: ['src/pages/Orders.tsx', 'tests/orders/test_filter.py'],
      summary: 'Use canonical status field and add regression test',
    },
    regression: {
      status: 'passed',
      command: 'cdd-kit test run add-order-filter --phase targeted --json',
      summary: 'specs/changes/add-order-filter/test-runs/2/summary.json',
    },
    residual_risk: 'none',
  };
}

// A diagnostic-only record (ADR 0006 §10): instrumentation, not a behavior fix,
// so it is exempt from root_cause + regression proof.
function diagnosticBlock(): Record<string, unknown> {
  return {
    'schema-version': '0.1.0',
    diagnostic_only: true,
    symptom: 'Export intermittently fails in CI only',
    expected_behavior: 'Export completes in CI as it does locally',
    actual_behavior: 'Export fails ~1 in 10 CI runs with no error detail',
    reproduction: {
      status: 'environment-blocked',
      summary: 'specs/changes/diag-export/test-runs/1/summary.json',
    },
    hypotheses: [
      {
        id: 'H1',
        candidate: 'src/export/worker.ts::run',
        reason: 'Only path that touches the CI-only temp dir',
        result: 'unconfirmed',
      },
    ],
  };
}

// A valid agent-log envelope (src/schemas/agent-log.schema.ts) for back-compat
// and nesting tests.
function validAgentLog(): Record<string, unknown> {
  return {
    'change-id': 'add-order-filter',
    timestamp: '2026-06-09T12:00:00Z',
    agent: 'bug-fix-engineer',
    status: 'complete',
    artifacts: [{ type: 'root-cause', pointer: 'src/pages/Orders.tsx:42-68' }],
    'next-action': 'qa-reviewer release-readiness review',
  };
}

describe('bug-fix-evidence.schema', () => {
  it('accepts a complete behavior-changing repair record', () => {
    expect(validateBlock(validBlock()), JSON.stringify(validateBlock.errors)).toBe(true);
  });

  it('accepts a diagnostic-only record without root_cause or regression', () => {
    expect(validateBlock(diagnosticBlock()), JSON.stringify(validateBlock.errors)).toBe(true);
  });

  it('requires symptom, expected_behavior, actual_behavior, reproduction, hypotheses, schema-version', () => {
    for (const key of [
      'schema-version',
      'symptom',
      'expected_behavior',
      'actual_behavior',
      'reproduction',
      'hypotheses',
    ]) {
      const doc = validBlock();
      delete doc[key];
      expect(validateBlock(doc), `missing ${key} should fail`).toBe(false);
    }
  });

  it('requires root_cause for a behavior-changing (non-diagnostic) fix', () => {
    const doc = validBlock();
    delete doc.root_cause;
    expect(validateBlock(doc)).toBe(false);
  });

  it('requires regression for a behavior-changing (non-diagnostic) fix', () => {
    const doc = validBlock();
    delete doc.regression;
    expect(validateBlock(doc)).toBe(false);
  });

  it('requires observed_surface for a behavior-changing (non-diagnostic) fix', () => {
    const doc = validBlock();
    delete doc.observed_surface;
    expect(validateBlock(doc)).toBe(false);
  });

  it('requires a files-changed fix for a behavior-changing (non-diagnostic) fix', () => {
    const doc = validBlock();
    delete doc.fix;
    expect(validateBlock(doc)).toBe(false);
  });

  it('requires residual_risk for a behavior-changing (non-diagnostic) fix', () => {
    const doc = validBlock();
    delete doc.residual_risk;
    expect(validateBlock(doc)).toBe(false);
  });

  it.each(['not-reproduced', 'environment-blocked', 'intermittent'])(
    'rejects a behavior-changing fix whose reproduction is a diagnostic-only status: %s',
    (status) => {
      const doc = validBlock();
      (doc.reproduction as Record<string, unknown>).status = status;
      expect(validateBlock(doc), `non-diagnostic must not accept ${status}`).toBe(false);
    },
  );

  it('rejects a behavior-changing fix whose regression status is failed', () => {
    const doc = validBlock();
    (doc.regression as Record<string, unknown>).status = 'failed';
    expect(validateBlock(doc)).toBe(false);
  });

  it('accepts a diagnostic-only record with any non-passing reproduction status', () => {
    // Negative control: the statuses rejected for a real fix above are valid when
    // the record is diagnostic-only (the then-branch does not apply).
    for (const status of ['not-reproduced', 'environment-blocked', 'intermittent']) {
      const doc = diagnosticBlock();
      (doc.reproduction as Record<string, unknown>).status = status;
      expect(validateBlock(doc), JSON.stringify(validateBlock.errors)).toBe(true);
    }
  });

  it('still requires root_cause + regression when diagnostic_only is explicitly false', () => {
    const doc = validBlock();
    doc.diagnostic_only = false;
    delete doc.root_cause;
    expect(validateBlock(doc), 'diagnostic_only:false is a real fix, not an exemption').toBe(false);
  });

  it('exempts a diagnostic-only record from root_cause + regression', () => {
    const doc = diagnosticBlock();
    expect(doc.root_cause).toBeUndefined();
    expect(doc.regression).toBeUndefined();
    expect(validateBlock(doc), JSON.stringify(validateBlock.errors)).toBe(true);
  });

  it.each([...REPRODUCTION_STATUSES])('accepts allowed reproduction status: %s', (status) => {
    const doc = status === 'reproduced' || status === 'test-reproduced' || status === 'visual-reproduced'
      ? validBlock()
      : { ...diagnosticBlock(), diagnostic_only: true };
    (doc.reproduction as Record<string, unknown>).status = status;
    expect(validateBlock(doc), JSON.stringify(validateBlock.errors)).toBe(true);
  });

  it('rejects an unknown reproduction status', () => {
    const doc = validBlock();
    (doc.reproduction as Record<string, unknown>).status = 'sort-of-reproduced';
    expect(validateBlock(doc)).toBe(false);
  });

  it.each([...HYPOTHESIS_RESULTS])('accepts allowed hypothesis result: %s', (result) => {
    const doc = validBlock();
    (doc.hypotheses as Record<string, unknown>[])[0].result = result;
    expect(validateBlock(doc), JSON.stringify(validateBlock.errors)).toBe(true);
  });

  it('rejects an unknown hypothesis result', () => {
    const doc = validBlock();
    (doc.hypotheses as Record<string, unknown>[])[0].result = 'maybe';
    expect(validateBlock(doc)).toBe(false);
  });

  it('rejects an empty hypotheses array (minItems)', () => {
    const doc = validBlock();
    doc.hypotheses = [];
    expect(validateBlock(doc)).toBe(false);
  });

  it('rejects a hypothesis missing its candidate', () => {
    const doc = validBlock();
    delete (doc.hypotheses as Record<string, unknown>[])[0].candidate;
    expect(validateBlock(doc)).toBe(false);
  });

  it('rejects a malformed schema-version', () => {
    const doc = validBlock();
    doc['schema-version'] = '0.1';
    expect(validateBlock(doc)).toBe(false);
  });

  it('rejects a root_cause missing its pointer', () => {
    const doc = validBlock();
    delete (doc.root_cause as Record<string, unknown>).pointer;
    expect(validateBlock(doc)).toBe(false);
  });

  it('rejects an unknown field (additionalProperties: false)', () => {
    const doc = validBlock();
    doc['totally-unknown'] = true;
    expect(validateBlock(doc)).toBe(false);
  });

  // ── typed evidence pointers (ADR 0006 §6, PR 5) ──────────────────────────────

  it('accepts a visual_evidence block with a before pointer', () => {
    const doc = validBlock();
    doc.visual_evidence = {
      before: 'specs/changes/x/evidence/before.png',
      after: 'specs/changes/x/evidence/after.png',
      summary: 'overlap gone',
    };
    expect(validateBlock(doc), JSON.stringify(validateBlock.errors)).toBe(true);
  });

  it('rejects visual_evidence missing its required before pointer', () => {
    const doc = validBlock();
    doc.visual_evidence = { after: 'specs/changes/x/evidence/after.png' };
    expect(validateBlock(doc)).toBe(false);
  });

  it('rejects an unknown visual_evidence subkey (additionalProperties: false)', () => {
    const doc = validBlock();
    doc.visual_evidence = { before: 'a.png', screenshot: 'b.png' };
    expect(validateBlock(doc)).toBe(false);
  });

  it('accepts a data_evidence block and rejects an unknown kind', () => {
    const doc = validBlock();
    doc.data_evidence = { kind: 'request-response', pointer: 'specs/changes/x/evidence/resp.json', summary: 'status was 500' };
    expect(validateBlock(doc), JSON.stringify(validateBlock.errors)).toBe(true);
    (doc.data_evidence as Record<string, unknown>).kind = 'telepathy';
    expect(validateBlock(doc)).toBe(false);
  });

  it('rejects data_evidence missing its pointer', () => {
    const doc = validBlock();
    doc.data_evidence = { kind: 'contract' };
    expect(validateBlock(doc)).toBe(false);
  });

  it('accepts a performance_evidence block with bounded timing', () => {
    const doc = validBlock();
    doc.performance_evidence = { pointer: 'specs/changes/x/test-runs/1/summary.json', baseline_ms: 4200, after_ms: 180, bounded: true };
    expect(validateBlock(doc), JSON.stringify(validateBlock.errors)).toBe(true);
  });

  it('rejects performance_evidence missing its pointer', () => {
    const doc = validBlock();
    doc.performance_evidence = { baseline_ms: 4200 };
    expect(validateBlock(doc)).toBe(false);
  });
});

describe('agent-log.schema gains an optional bug-fix block (ADR 0006 PR 2)', () => {
  it('still accepts an agent log without a bug-fix block (backward compatible)', () => {
    expect(validateLog(validAgentLog()), JSON.stringify(validateLog.errors)).toBe(true);
  });

  it('accepts an agent log that nests a valid bug-fix block in the envelope', () => {
    const log = { ...validAgentLog(), 'bug-fix': validBlock() };
    expect(validateLog(log), JSON.stringify(validateLog.errors)).toBe(true);
  });

  it('accepts an agent log nesting a diagnostic-only bug-fix block', () => {
    const log = { ...validAgentLog(), 'bug-fix': diagnosticBlock() };
    expect(validateLog(log), JSON.stringify(validateLog.errors)).toBe(true);
  });

  it('rejects an agent log whose nested bug-fix block is invalid', () => {
    const block = validBlock();
    delete block.symptom;
    const log = { ...validAgentLog(), 'bug-fix': block };
    expect(validateLog(log)).toBe(false);
  });

  it('rejects a bare top-level bug-fix document with no agent-log envelope', () => {
    // ADR 0006 PR 1's warning made concrete: the block must nest inside the
    // envelope, never replace it -- the envelope keeps status: visible to
    // /cdd-resume.
    const bare = { 'schema-version': '0.1.0', agent: 'bug-fix-engineer', 'bug-fix': validBlock() };
    expect(validateLog(bare)).toBe(false);
  });
});
