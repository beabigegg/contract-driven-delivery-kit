import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { acceptanceSchema } from '../../src/schemas/acceptance.schema.js';
import { acceptanceChatBindsHead, commentConfirmsAcceptance } from '../../src/utils/acceptance-confirmation.js';
import { cleanupDir, makeTempDir } from '../helpers.js';

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

  it('trusts only OWNER by default -- MEMBER and COLLABORATOR are not accepted without explicit policy', () => {
    expect(commentConfirmsAcceptance({ body, author_association: 'MEMBER' }, changeId, acceptanceHash, head)).toBe(false);
    expect(commentConfirmsAcceptance({ body, author_association: 'COLLABORATOR' }, changeId, acceptanceHash, head)).toBe(false);
  });

  it('accepts a policy-allowlisted login regardless of association, and rejects other logins', () => {
    const authorization = { logins: ['maintainer'], associations: ['OWNER'] };
    expect(commentConfirmsAcceptance({ body, author_association: 'NONE', user: { login: 'maintainer' } }, changeId, acceptanceHash, head, authorization)).toBe(true);
    expect(commentConfirmsAcceptance({ body, author_association: 'OWNER', user: { login: 'stranger' } }, changeId, acceptanceHash, head, authorization)).toBe(false);
  });

  it('can re-broaden trust to MEMBER via an explicit association allowlist', () => {
    const authorization = { logins: [], associations: ['OWNER', 'MEMBER'] };
    expect(commentConfirmsAcceptance({ body, author_association: 'MEMBER' }, changeId, acceptanceHash, head, authorization)).toBe(true);
  });

  it('rejects stale criteria or stale HEAD', () => {
    expect(commentConfirmsAcceptance({ body, author_association: 'OWNER' }, changeId, 'c'.repeat(64), head)).toBe(false);
    expect(commentConfirmsAcceptance({ body, author_association: 'OWNER' }, changeId, acceptanceHash, 'd'.repeat(40))).toBe(false);
  });

  describe('chat_binds_head: false (criteria-only binding)', () => {
    const auth = { logins: [], associations: ['OWNER'] };
    const criteriaOnlyBody = [
      'CDD-ACCEPTANCE-CONFIRMATION v1',
      `change-id: ${changeId}`,
      `acceptance-hash: ${acceptanceHash}`,
      'decision: approved',
    ].join('\n');

    it('confirms a criteria-only comment (no head-commit line) when head is not bound', () => {
      expect(commentConfirmsAcceptance({ body: criteriaOnlyBody, author_association: 'OWNER' }, changeId, acceptanceHash, head, auth, false)).toBe(true);
    });

    it('ignores a stale head-commit line when head is not bound (survives new pushes)', () => {
      const staleHeadBody = [
        'CDD-ACCEPTANCE-CONFIRMATION v1',
        `change-id: ${changeId}`,
        `acceptance-hash: ${acceptanceHash}`,
        `head-commit: ${'d'.repeat(40)}`,
        'decision: approved',
      ].join('\n');
      expect(commentConfirmsAcceptance({ body: staleHeadBody, author_association: 'OWNER' }, changeId, acceptanceHash, head, auth, false)).toBe(true);
    });

    it('still binds the criteria hash — stale criteria are rejected even without head binding', () => {
      expect(commentConfirmsAcceptance({ body: criteriaOnlyBody, author_association: 'OWNER' }, changeId, 'c'.repeat(64), head, auth, false)).toBe(false);
    });

    it('still enforces authorization — an unauthorized author is rejected without head binding', () => {
      expect(commentConfirmsAcceptance({ body: criteriaOnlyBody, author_association: 'NONE' }, changeId, acceptanceHash, head, auth, false)).toBe(false);
    });

    it('by default (head bound) a criteria-only comment is NOT enough', () => {
      expect(commentConfirmsAcceptance({ body: criteriaOnlyBody, author_association: 'OWNER' }, changeId, acceptanceHash, head)).toBe(false);
    });
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

describe('acceptanceChatBindsHead policy reader', () => {
  let repo: string;
  beforeEach(() => { repo = makeTempDir('cdd-binds-'); });
  afterEach(() => { cleanupDir(repo); });

  function writePolicy(acceptance: string): void {
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    writeFileSync(join(repo, '.cdd', 'policy.yml'), `version: 1\nacceptance:\n${acceptance}`, 'utf8');
  }

  it('defaults to true when there is no policy file', () => {
    expect(acceptanceChatBindsHead(repo)).toBe(true);
  });

  it('defaults to true when acceptance omits chat_binds_head', () => {
    writePolicy('  authorized_associations: [OWNER]\n');
    expect(acceptanceChatBindsHead(repo)).toBe(true);
  });

  it('returns false only for an explicit chat_binds_head: false', () => {
    writePolicy('  chat_binds_head: false\n');
    expect(acceptanceChatBindsHead(repo)).toBe(false);
  });

  it('returns true for an explicit chat_binds_head: true', () => {
    writePolicy('  chat_binds_head: true\n');
    expect(acceptanceChatBindsHead(repo)).toBe(true);
  });
});
