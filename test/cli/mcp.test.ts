/**
 * CLI tests for `cdd-kit mcp`.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { copyFileSync, mkdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CLI_PATH, makeTempDir, cleanupDir } from '../helpers.js';

const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', 'fixtures', 'code-map'
);

interface JsonRpcResponse {
  id: number;
  result?: any;
  error?: { message: string };
}

function copyFixture(tmpRepo: string, name: string): void {
  copyFileSync(join(FIXTURE_ROOT, name), join(tmpRepo, name));
}

function runMcp(messages: unknown[], cwd: string, home: string): JsonRpcResponse[] {
  const input = messages.map(message => JSON.stringify(message)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [CLI_PATH, 'mcp'], {
    cwd,
    input,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
    },
  });

  expect(result.status, result.stderr?.toString('utf8')).toBe(0);
  return (result.stdout?.toString('utf8') ?? '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line) as JsonRpcResponse);
}

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('mcp-repo-');
  tmpHome = makeTempDir('mcp-home-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('cdd-kit mcp', () => {
  it('lists graph/code-map tools over MCP stdio', () => {
    const responses = runMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ], tmpRepo, tmpHome);

    expect(responses).toHaveLength(2);
    expect(responses[0].result.serverInfo.name).toBe('cdd-kit');
    const toolNames = responses[1].result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toContain('cdd_graph_query');
    expect(toolNames).toContain('cdd_graph_impact');
    expect(toolNames).toContain('cdd_index_query');
    expect(toolNames).toContain('cdd_test_impact');
    expect(toolNames).toContain('cdd_contract_locate');
    expect(toolNames).toContain('cdd_graph_unresolved');
    expect(toolNames).toContain('cdd_boundary_check');
    expect(toolNames).toContain('cdd_runtime_plan');
    expect(toolNames).toContain('cdd_runtime_status');
    expect(toolNames).toContain('cdd_runtime_verify');
    expect(toolNames).toContain('cdd_runtime_agent_prompt');
    expect(toolNames).toContain('cdd_runtime_check_run');
    expect(toolNames).toContain('cdd_runtime_review');
  });

  it('calls graph query and returns JSON content', () => {
    copyFixture(tmpRepo, 'sample.ts');

    const responses = runMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'cdd_graph_query',
          arguments: { query: 'Service', limit: 3 },
        },
      },
    ], tmpRepo, tmpHome);

    expect(responses).toHaveLength(2);
    const toolResult = responses[1].result;
    expect(toolResult.isError).toBeUndefined();
    const payload = JSON.parse(toolResult.content[0].text) as {
      engine: string;
      results: Array<{ node: { kind: string; name: string } }>;
    };
    expect(payload.engine).toBe('native');
    expect(payload.results.some(result => result.node.kind === 'class' && result.node.name === 'Service')).toBe(true);
  });

  it('passes the index-query truncation fields through to MCP clients (P1-7)', () => {
    copyFixture(tmpRepo, 'sample.ts');

    const responses = runMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'cdd_index_query',
          arguments: { query: 'User', limit: 10 },
        },
      },
    ], tmpRepo, tmpHome);

    const toolResult = responses[1].result;
    expect(toolResult.isError).toBeUndefined();
    const payload = JSON.parse(toolResult.content[0].text) as {
      total_matches: number;
      returned: number;
      truncated: boolean;
      results: unknown[];
    };
    // The truncation contract must reach MCP clients, not just the CLI.
    expect(typeof payload.total_matches).toBe('number');
    expect(typeof payload.truncated).toBe('boolean');
    expect(payload.returned).toBe(payload.results.length);
  });

  it('calls test impact and returns the affected-tests payload (P2-3)', () => {
    copyFixture(tmpRepo, 'sample.ts');

    const responses = runMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'cdd_test_impact',
          arguments: { file: 'sample.ts' },
        },
      },
    ], tmpRepo, tmpHome);

    const toolResult = responses[1].result;
    expect(toolResult.isError).toBeUndefined();
    const payload = JSON.parse(toolResult.content[0].text) as {
      target: string;
      affected_tests: unknown[];
      impacted_sources: unknown[];
      truncated: boolean;
    };
    expect(payload.target).toBe('sample.ts');
    expect(Array.isArray(payload.affected_tests)).toBe(true);
    expect(Array.isArray(payload.impacted_sources)).toBe(true);
    expect(typeof payload.truncated).toBe('boolean');
  });

  it('calls contract locate and returns the related slices (P2-3)', () => {
    mkdirSync(join(tmpRepo, 'contracts', 'api'), { recursive: true });
    writeFileSync(
      join(tmpRepo, 'contracts', 'api', 'api-contract.md'),
      [
        '---', 'contract: api', '---', '',
        '# API Contract', '',
        '## Endpoint Requirements',
        '| method | path | auth | request schema | response schema | errors | tests |',
        '|---|---|---|---|---|---|---|',
        '| POST | /api/orders | admin | CreateOrder | Order | 400 | yes |', '',
        '## Schemas', '',
        '### CreateOrder',
        '| field | type | required | format | notes |',
        '|---|---|---|---|---|',
        '| email | string | yes | email | buyer |', '',
      ].join('\n'),
      'utf8',
    );

    const responses = runMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'cdd_contract_locate',
          arguments: { symbol: 'CreateOrder', refresh: false },
        },
      },
    ], tmpRepo, tmpHome);

    const toolResult = responses[1].result;
    expect(toolResult.isError).toBeUndefined();
    const payload = JSON.parse(toolResult.content[0].text) as {
      symbol: string;
      schemas: { name: string }[];
    };
    expect(payload.symbol).toBe('CreateOrder');
    expect(payload.schemas.some(s => s.name === 'CreateOrder')).toBe(true);
  });

  it('calls graph unresolved and returns the external/dynamic references (P2-4)', () => {
    writeFileSync(join(tmpRepo, 'a.ts'), 'export function handler() { return externalThing(); }\n', 'utf8');

    const responses = runMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'cdd_graph_unresolved',
          arguments: { kind: 'calls' },
        },
      },
    ], tmpRepo, tmpHome);

    const toolResult = responses[1].result;
    expect(toolResult.isError).toBeUndefined();
    const payload = JSON.parse(toolResult.content[0].text) as {
      engine: string;
      unresolved: { name: string; kind: string }[];
    };
    expect(payload.engine).toBe('native');
    expect(payload.unresolved.some(u => u.name === 'externalThing' && u.kind === 'calls')).toBe(true);
  });
});
