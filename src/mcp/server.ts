import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

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
    description: 'Search native graph symbols/files and return candidate nodes with line ranges.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol, file path, file stem, class, function, component, or route term.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
        map: { type: 'string', description: 'Code-map YAML path.', default: DEFAULT_MAP },
        engine: { type: 'string', enum: ['auto', 'native', 'codegraph', 'codemap'], default: 'auto' },
        refresh: { type: 'boolean', default: true },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'cdd_graph_context',
    description: 'Build graph-first task context from a task, symptom, or known feature term.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task, bug symptom, feature name, screen name, or domain term.' },
        maxNodes: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        map: { type: 'string', description: 'Code-map YAML path.', default: DEFAULT_MAP },
        engine: { type: 'string', enum: ['auto', 'native', 'codegraph', 'codemap'], default: 'auto' },
        refresh: { type: 'boolean', default: true },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
  {
    name: 'cdd_graph_impact',
    description: 'Analyze callers, callees, imports, references, and dependents for a file or symbol before editing.',
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
    name: 'cdd_index_query',
    description: 'Fallback code-map query for files, symbols, imports, and line ranges.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol, file path, import module, enum member, or substring.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
        map: { type: 'string', description: 'Code-map YAML path.', default: DEFAULT_MAP },
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
    case 'cdd_index_query':
      return runCddJson([
        'index',
        'query', requireString(args, 'query'),
        '--map', optionalString(args.map, DEFAULT_MAP),
        '--limit', String(optionalInt(args.limit, 10)),
        '--json',
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

function writeResult(id: JsonRpcId, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function writeError(id: JsonRpcId, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}
