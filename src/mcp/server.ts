import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { DEFAULT_CONTRACT_PATH, DEFAULT_INVENTORY_PATH } from '../contracts/parser.js';

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

interface RunMcpServerOptions {
  version: string;
}

const DEFAULT_MAP = '.cdd/code-map.yml';

const tools: ToolDef[] = [
  {
    name: 'cdd_graph_status',
    description: 'Show the active cdd-kit graph engine and code-map/code-graph freshness for the current workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        map: { type: 'string', description: 'Code-map YAML path.', default: DEFAULT_MAP },
        engine: { type: 'string', enum: ['auto', 'native', 'codegraph', 'codemap'], default: 'auto' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'cdd_graph_query',
    description: 'Search native graph symbols/files and return candidate nodes with line ranges. Set withSource:true to also return the source slices inline so no separate file read is needed.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol, file path, file stem, class, function, component, or route term.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
        map: { type: 'string', description: 'Code-map YAML path.', default: DEFAULT_MAP },
        engine: { type: 'string', enum: ['auto', 'native', 'codegraph', 'codemap'], default: 'auto' },
        withSource: { type: 'boolean', description: 'Include matched source slices inline (replaces a follow-up read).', default: false },
        sourceBudget: { type: 'integer', minimum: 1, maximum: 5000, default: 400, description: 'Max total source lines to return when withSource is true.' },
        refresh: { type: 'boolean', default: true },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'cdd_graph_context',
    description: 'Build graph-first task context from a multi-word task, symptom, or feature description (e.g. "filter options are empty", "order export timeout"). Multi-word queries are tokenized and ranked by coverage, so a natural-language phrase resolves in one call. Set withSource:true to also return the entry points\' source slices inline so no separate file read is needed.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task, bug symptom, feature name, screen name, or domain term.' },
        maxNodes: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        map: { type: 'string', description: 'Code-map YAML path.', default: DEFAULT_MAP },
        engine: { type: 'string', enum: ['auto', 'native', 'codegraph', 'codemap'], default: 'auto' },
        withSource: { type: 'boolean', description: 'Include the entry points\' source slices inline (replaces a follow-up read). Native engine.', default: false },
        sourceBudget: { type: 'integer', minimum: 1, maximum: 5000, default: 400, description: 'Max total source lines to return when withSource is true.' },
        refresh: { type: 'boolean', default: true },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
  {
    name: 'cdd_graph_impact',
    description: 'Analyze callers, callees, imports, references, and dependents for a file or symbol before editing. The result also lists the unresolved references (external/dynamic/DI calls) originating from the impact set, so the blast radius is not silently undercounted.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Candidate file path, symbol, graph node id, or qualified name.' },
        depth: { type: 'integer', minimum: 1, maximum: 10, default: 2 },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
        map: { type: 'string', description: 'Code-map YAML path.', default: DEFAULT_MAP },
        engine: { type: 'string', enum: ['auto', 'native', 'codegraph', 'codemap'], default: 'auto' },
        refresh: { type: 'boolean', default: true },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'cdd_graph_unresolved',
    description: 'List references the native graph could NOT resolve to a target node — external/dynamic/DI calls, cross-boundary service calls, and ambiguous names. These are exactly the blast radius that cdd_graph_impact would otherwise omit. Optionally scope to a file or symbol. Each item carries same-name candidate nodes (present = ambiguous; absent = truly external).',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Optional file path or symbol to scope to; omit for the whole repository.' },
        kind: { type: 'string', enum: ['calls', 'extends', 'implements', 'references', 'imports'], description: 'Filter by reference kind.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
        map: { type: 'string', description: 'Code-map YAML path.', default: DEFAULT_MAP },
        refresh: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'cdd_index_query',
    description: 'Fallback code-map query for files, symbols, imports, and line ranges. Set withSource:true to also return the source slices inline so no separate file read is needed.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol, file path, import module, enum member, or substring.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
        map: { type: 'string', description: 'Code-map YAML path.', default: DEFAULT_MAP },
        withSource: { type: 'boolean', description: 'Include matched source slices inline (replaces a follow-up read).', default: false },
        sourceBudget: { type: 'integer', minimum: 1, maximum: 5000, default: 400, description: 'Max total source lines to return when withSource is true.' },
        refresh: { type: 'boolean', default: true },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'cdd_index_impact',
    description: 'Fallback code-map impact query for local imports and direct dependents.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'File path or unique symbol.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
        map: { type: 'string', description: 'Code-map YAML path.', default: DEFAULT_MAP },
        refresh: { type: 'boolean', default: true },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'cdd_test_impact',
    description: 'List the tests affected by changing a file: transitive importers that are test files (from the code-map import graph), plus mirror-path test files (src/foo.ts ↔ tests/foo.test.ts, foo_test.py). Each result carries a reason. Replaces a manual grep for "which tests cover this".',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Source file path (or a unique symbol) you are about to change.' },
        depth: { type: 'integer', minimum: 1, maximum: 10, default: 2, description: 'How many import hops to follow when finding dependent tests.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        map: { type: 'string', description: 'Code-map YAML path.', default: DEFAULT_MAP },
        refresh: { type: 'boolean', default: true },
      },
      required: ['file'],
      additionalProperties: false,
    },
  },
  {
    name: 'cdd_contract_query',
    description: 'Query the API contract by key (endpoint, schema, path prefix/glob, or column filter) and get back only the matching slice — the contract analog of cdd_index_query (ask, don\'t read the whole contract). Parse-on-demand and read-only. Provide one selector: endpoint, schema, path, a column filter (auth/category/owner), or a free-text term.',
    inputSchema: {
      type: 'object',
      properties: {
        endpoint: { type: 'string', description: 'Exact endpoint "METHOD /path", e.g. "POST /api/orders" — returns the row plus the schemas it references and the shared prose sections.' },
        path: { type: 'string', description: 'Path prefix, or a glob where * matches within one path segment; lists matching endpoints across the contract and inventory.' },
        schema: { type: 'string', description: 'Schema name; returns its definition plus the endpoints that reference it.' },
        auth: { type: 'string', description: 'Filter endpoints by the auth column.' },
        category: { type: 'string', description: 'Filter inventory endpoints by category.' },
        owner: { type: 'string', description: 'Filter inventory endpoints by owner.' },
        term: { type: 'string', description: 'Free-text fuzzy match across endpoint rows and schema names.' },
        contract: { type: 'string', description: 'API contract markdown path.', default: DEFAULT_CONTRACT_PATH },
        inventory: { type: 'string', description: 'API inventory markdown path.', default: DEFAULT_INVENTORY_PATH },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'cdd_contract_locate',
    description: 'Given a code symbol or file, return the API-contract slices (schemas + endpoints) related to it by name overlap — the contract analog of cdd_test_impact. Saves the graph-query → read-file → guess-schema-name → contract-query round-trip. Resolves the symbol in the code-map to harvest its declared type/class names as extra search terms; still works with no code-map (the symbol may itself be a schema name).',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'A code symbol (class/interface/type/function) or file path.' },
        contract: { type: 'string', description: 'API contract markdown path.', default: DEFAULT_CONTRACT_PATH },
        inventory: { type: 'string', description: 'API inventory markdown path.', default: DEFAULT_INVENTORY_PATH },
        map: { type: 'string', description: 'Code-map YAML path.', default: DEFAULT_MAP },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
        refresh: { type: 'boolean', default: true },
      },
      required: ['symbol'],
      additionalProperties: false,
    },
  },
  {
    name: 'cdd_boundary_check',
    description: 'Run fail-closed changed-operation Boundary Guard checks for typed requests/responses, variants, real captures, consumers, and non-vacuous coverage.',
    inputSchema: {
      type: 'object',
      properties: {
        base: { type: 'string', description: 'Optional Git base revision.' },
        all: { type: 'boolean', default: false },
        operations: { type: 'array', items: { type: 'string' }, description: 'Explicit operations such as GET /health.' },
        contract: { type: 'string', default: DEFAULT_CONTRACT_PATH },
        policy: { type: 'string', default: '.cdd/policy.yml' },
        manifest: { type: 'string', default: '.cdd/boundary-manifest.yml' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'cdd_runtime_plan',
    description: 'Create a deterministic risk profile, execution capsule, and resumable runtime plan. Mutates only .cdd/runtime.',
    inputSchema: {
      type: 'object',
      properties: {
        changeId: { type: 'string' }, objective: { type: 'string' },
        provider: { type: 'string', enum: ['claude', 'codex', 'both'] },
        profile: { type: 'string', enum: ['lightweight', 'balanced', 'controlled', 'strict'] },
        requireAcceptance: { type: 'boolean', description: 'Require a human-authored acceptance oracle in runtime evidence.' },
        base: { type: 'string' },
      },
      required: ['changeId', 'objective'], additionalProperties: false,
    },
  },
  {
    name: 'cdd_runtime_status',
    description: 'Read the current or specified agent-native runtime state.',
    inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'cdd_runtime_verify',
    description: 'Run Boundary Guard and evidence checks for a runtime run and append immutable runtime evidence.',
    inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'cdd_runtime_agent_prompt',
    description: 'Build the provider-neutral implementer or independent-reviewer prompt using only Doctrine selected by the runtime capsule.',
    inputSchema: {
      type: 'object', properties: { runId: { type: 'string' }, role: { type: 'string', enum: ['implementer', 'reviewer'], default: 'implementer' } },
      additionalProperties: false,
    },
  },
  {
    name: 'cdd_runtime_check_run',
    description: 'Execute every runtime-native test and quality check selected by the capsule and capture digest-bound evidence.',
    inputSchema: { type: 'object', properties: { runId: { type: 'string' }, timeout: { type: 'integer', minimum: 1 } }, additionalProperties: false },
  },
  {
    name: 'cdd_runtime_review',
    description: 'Record a digest-bound independent reviewer verdict for a Controlled runtime.',
    inputSchema: {
      type: 'object', properties: {
        runId: { type: 'string' }, verdict: { type: 'string', enum: ['passed', 'failed'] }, actor: { type: 'string' }, summary: { type: 'string' },
      }, required: ['verdict', 'actor', 'summary'], additionalProperties: false,
    },
  },
  {
    name: 'cdd_report_problem',
    description: 'Report a problem about the CDD kit itself as a GitHub issue on the kit upstream repo. DRAFTS by default; pass confirm:true ONLY after the maintainer has approved the drafted issue, since posting publishes to GitHub. Call with confirm:false first to show the maintainer the draft.',
    inputSchema: {
      type: 'object', properties: {
        title: { type: 'string', description: 'Short issue title (>= 8 chars).' },
        body: { type: 'string', description: 'What went wrong / how to reproduce (>= 15 chars).' },
        category: { type: 'string', enum: ['bug', 'gate-false-positive', 'crash', 'docs', 'other'], default: 'bug' },
        repo: { type: 'string', description: 'Optional owner/name target; defaults to the kit upstream repo or $CDD_REPORT_REPO.' },
        changeId: { type: 'string' }, runId: { type: 'string' },
        confirm: { type: 'boolean', default: false, description: 'Set true only after maintainer approval to actually file the issue.' },
      }, required: ['title', 'body'], additionalProperties: false,
    },
  },
];

export async function runMcpServer(opts: RunMcpServerOptions): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch (err) {
      writeError(null, -32700, `Parse error: ${(err as Error).message}`);
      continue;
    }

    if (!request.method) {
      if ('id' in request) writeError(request.id ?? null, -32600, 'Invalid Request: missing method');
      continue;
    }

    try {
      const result = await handleRequest(request, opts);
      if ('id' in request) writeResult(request.id ?? null, result);
    } catch (err) {
      if ('id' in request) writeError(request.id ?? null, -32000, (err as Error).message);
    }
  }
}

async function handleRequest(request: JsonRpcRequest, opts: RunMcpServerOptions): Promise<unknown> {
  switch (request.method) {
    case 'initialize': {
      const params = asObject(request.params);
      return {
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05',
        capabilities: {
          tools: { listChanged: false },
          resources: {},
          prompts: {},
        },
        serverInfo: {
          name: 'cdd-kit',
          version: opts.version,
        },
      };
    }
    case 'ping':
      return {};
    case 'tools/list':
      return { tools };
    case 'tools/call': {
      const params = asObject(request.params);
      const name = requireString(params, 'name');
      const args = asObject(params.arguments);
      return callTool(name, args);
    }
    case 'resources/list':
      return { resources: [] };
    case 'prompts/list':
      return { prompts: [] };
    case 'notifications/initialized':
      return {};
    default:
      throw new Error(`Method not found: ${request.method}`);
  }
}

function callTool(name: string, args: Record<string, unknown>): ToolResult {
  switch (name) {
    case 'cdd_graph_status':
      return runCddJson([
        'graph',
        'status',
        '--engine', optionalString(args.engine, 'auto'),
        '--map', optionalString(args.map, DEFAULT_MAP),
        '--json',
      ]);
    case 'cdd_graph_query':
      return runCddJson([
        'graph',
        'query', requireString(args, 'query'),
        '--engine', optionalString(args.engine, 'auto'),
        '--map', optionalString(args.map, DEFAULT_MAP),
        '--limit', String(optionalInt(args.limit, 10)),
        '--json',
        ...sourceArgs(args),
        ...refreshArgs(args),
      ]);
    case 'cdd_graph_context':
      return runCddJson([
        'graph',
        'context', requireString(args, 'task'),
        '--engine', optionalString(args.engine, 'auto'),
        '--map', optionalString(args.map, DEFAULT_MAP),
        '--max-nodes', String(optionalInt(args.maxNodes, 20)),
        '--json',
        ...sourceArgs(args),
        ...refreshArgs(args),
      ]);
    case 'cdd_graph_impact':
      return runCddJson([
        'graph',
        'impact', requireString(args, 'target'),
        '--engine', optionalString(args.engine, 'auto'),
        '--map', optionalString(args.map, DEFAULT_MAP),
        '--limit', String(optionalInt(args.limit, 20)),
        '--depth', String(optionalInt(args.depth, 2)),
        '--json',
        ...refreshArgs(args),
      ]);
    case 'cdd_graph_unresolved': {
      const cmd = ['graph', 'unresolved'];
      const target = optionalString(args.target, '');
      if (target) cmd.push(target);
      cmd.push('--map', optionalString(args.map, DEFAULT_MAP), '--limit', String(optionalInt(args.limit, 50)));
      const kind = optionalString(args.kind, '');
      if (kind) cmd.push('--kind', kind);
      cmd.push('--json', ...refreshArgs(args));
      return runCddJson(cmd);
    }
    case 'cdd_index_query':
      return runCddJson([
        'index',
        'query', requireString(args, 'query'),
        '--map', optionalString(args.map, DEFAULT_MAP),
        '--limit', String(optionalInt(args.limit, 10)),
        '--json',
        ...sourceArgs(args),
        ...refreshArgs(args),
      ]);
    case 'cdd_index_impact':
      return runCddJson([
        'index',
        'impact', requireString(args, 'target'),
        '--map', optionalString(args.map, DEFAULT_MAP),
        '--limit', String(optionalInt(args.limit, 20)),
        '--json',
        ...refreshArgs(args),
      ]);
    case 'cdd_test_impact':
      return runCddJson([
        'test',
        'impact', requireString(args, 'file'),
        '--map', optionalString(args.map, DEFAULT_MAP),
        '--depth', String(optionalInt(args.depth, 2)),
        '--limit', String(optionalInt(args.limit, 50)),
        '--json',
        ...refreshArgs(args),
      ]);
    case 'cdd_contract_query': {
      const cmd = ['contract', 'query'];
      const term = optionalString(args.term, '');
      if (term) cmd.push(term);
      const flags: Array<[string, string]> = [
        ['--endpoint', 'endpoint'],
        ['--path', 'path'],
        ['--schema', 'schema'],
        ['--auth', 'auth'],
        ['--category', 'category'],
        ['--owner', 'owner'],
        ['--contract', 'contract'],
        ['--inventory', 'inventory'],
      ];
      for (const [flag, key] of flags) {
        const value = args[key];
        if (typeof value === 'string' && value.trim()) cmd.push(flag, value);
      }
      cmd.push('--limit', String(optionalInt(args.limit, 20)), '--json');
      return runCddJson(cmd);
    }
    case 'cdd_contract_locate':
      return runCddJson([
        'contract',
        'locate', requireString(args, 'symbol'),
        '--contract', optionalString(args.contract, DEFAULT_CONTRACT_PATH),
        '--inventory', optionalString(args.inventory, DEFAULT_INVENTORY_PATH),
        '--map', optionalString(args.map, DEFAULT_MAP),
        '--limit', String(optionalInt(args.limit, 20)),
        '--json',
        ...refreshArgs(args),
      ]);
    case 'cdd_boundary_check': {
      const cmd = [
        'boundary', 'check',
        '--contract', optionalString(args.contract, DEFAULT_CONTRACT_PATH),
        '--policy', optionalString(args.policy, '.cdd/policy.yml'),
        '--manifest', optionalString(args.manifest, '.cdd/boundary-manifest.yml'),
      ];
      const base = optionalString(args.base, '');
      if (base) cmd.push('--base', base);
      if (args.all === true) cmd.push('--all');
      const operations = optionalStringArray(args.operations);
      if (operations.length) cmd.push('--operation', ...operations);
      cmd.push('--json');
      return runCddJson(cmd);
    }
    case 'cdd_runtime_plan': {
      const cmd = ['work', requireString(args, 'changeId'), requireString(args, 'objective')];
      const provider = optionalString(args.provider, ''); if (provider) cmd.push('--provider', provider);
      const profile = optionalString(args.profile, ''); if (profile) cmd.push('--profile', profile);
      if (args.requireAcceptance === true) cmd.push('--require-acceptance');
      const base = optionalString(args.base, ''); if (base) cmd.push('--base', base);
      cmd.push('--json');
      return runCddJson(cmd);
    }
    case 'cdd_runtime_status': {
      const cmd = ['runtime', 'status'];
      const runId = optionalString(args.runId, ''); if (runId) cmd.push(runId);
      cmd.push('--json'); return runCddJson(cmd);
    }
    case 'cdd_runtime_verify': {
      const cmd = ['runtime', 'verify'];
      const runId = optionalString(args.runId, ''); if (runId) cmd.push(runId);
      cmd.push('--json'); return runCddJson(cmd);
    }
    case 'cdd_runtime_agent_prompt': {
      const cmd = ['runtime', 'agent', 'prompt'];
      const runId = optionalString(args.runId, ''); if (runId) cmd.push(runId);
      cmd.push('--role', optionalString(args.role, 'implementer'), '--json'); return runCddJson(cmd);
    }
    case 'cdd_runtime_check_run': {
      const cmd = ['runtime', 'check', 'run'];
      const runId = optionalString(args.runId, ''); if (runId) cmd.push(runId);
      cmd.push('--all', '--timeout', String(optionalInt(args.timeout, 300000)), '--json'); return runCddJson(cmd);
    }
    case 'cdd_runtime_review': {
      const cmd = ['runtime', 'review'];
      const runId = optionalString(args.runId, ''); if (runId) cmd.push(runId);
      cmd.push('--verdict', requireString(args, 'verdict'), '--actor', requireString(args, 'actor'), '--summary', requireString(args, 'summary'), '--json');
      return runCddJson(cmd);
    }
    case 'cdd_report_problem': {
      const cmd = ['report', '--title', requireString(args, 'title'), '--body', requireString(args, 'body')];
      const category = optionalString(args.category, ''); if (category) cmd.push('--category', category);
      const repo = optionalString(args.repo, ''); if (repo) cmd.push('--repo', repo);
      const changeId = optionalString(args.changeId, ''); if (changeId) cmd.push('--change-id', changeId);
      const runId = optionalString(args.runId, ''); if (runId) cmd.push('--run-id', runId);
      if (args.confirm === true) cmd.push('--confirm');
      cmd.push('--json');
      return runCddJson(cmd);
    }
    default:
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      };
  }
}

function runCddJson(args: string[]): ToolResult {
  const cliPath = process.argv[1] || fileURLToPath(import.meta.url);
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });

  const stdout = result.stdout?.trim() ?? '';
  const stderr = result.stderr?.trim() ?? '';
  const isError = !!result.error || (result.status ?? 1) !== 0;

  if (stdout) {
    return {
      isError: isError || undefined,
      content: [{ type: 'text', text: stdout }],
    };
  }

  return {
    isError: true,
    content: [{ type: 'text', text: result.error?.message || stderr || `cdd-kit exited with status ${result.status}` }],
  };
}

function refreshArgs(args: Record<string, unknown>): string[] {
  return args.refresh === false ? ['--no-refresh'] : [];
}

function sourceArgs(args: Record<string, unknown>): string[] {
  if (args.withSource !== true) return [];
  return ['--with-source', '--source-budget', String(optionalInt(args.sourceBudget, 400))];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required string argument: ${key}`);
  }
  return value;
}

function optionalString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function optionalInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function optionalStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
}

function writeResult(id: JsonRpcId, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function writeError(id: JsonRpcId, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}
