import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { acceptanceSchema } from '../../src/schemas/acceptance.schema.js';
import { commentConfirmsAcceptance } from '../../src/utils/acceptance-confirmation.js';

describe('chat-confirmed acceptance', () => {
  const changeId = 'chat-native-flow';
  const acceptanceHash = 'a'.repeat(64);
  const head = 'b'.repeat(40);
  const body = [
    'CDD-ACCEPTANCE-CONFIRMATION v1',
    `change-id: ${changeId}`,
    `acceptance-hash: ${acceptanceHash}`,
    `head-commit: ${head}`,
    'decision: approved',
  ].join('\n');

  it('accepts an authorized repository comment bound to criteria and HEAD', () => {
    expect(commentConfirmsAcceptance({ body, author_association: 'OWNER' }, changeId, acceptanceHash, head)).toBe(true);
  });

  it('rejects an agent-like external comment even when the marker text matches', () => {
    expect(commentConfirmsAcceptance({ body, author_association: 'NONE' }, changeId, acceptanceHash, head)).toBe(false);
  });

  it('rejects stale criteria or stale HEAD', () => {
    expect(commentConfirmsAcceptance({ body, author_association: 'OWNER' }, changeId, 'c'.repeat(64), head)).toBe(false);
    expect(commentConfirmsAcceptance({ body, author_association: 'OWNER' }, changeId, acceptanceHash, 'd'.repeat(40))).toBe(false);
  });

  it('allows acceptance.yml to select chat-confirmed mode', () => {
    const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
    addFormats(ajv);
    const validate = ajv.compile(acceptanceSchema);
    expect(validate({
      'oracle-version': '1.0.0',
      'confirmation-mode': 'chat-confirmed',
      'authored-by': 'main-agent-draft',
      cases: [{
        id: 'plain-language-user-flow',
        given: 'the user describes a request to the main agent',
        when: 'the agent edits files and runs delivery checks',
        then: 'the user is interrupted only for a real high-risk decision',
        input: { interaction: 'chat' },
        expect: { user_runs_cli: false, agent_handles_delivery: true },
      }],
    }), JSON.stringify(validate.errors)).toBe(true);
  });
});
