/**
 * CLI tests for `cdd-kit mcp`.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { copyFileSync } from 'fs';
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
});
