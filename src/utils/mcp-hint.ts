import { log } from './logger.js';

export function logRecommendedMcpSetup(): void {
  log.info('Recommended for AI agents: enable the cdd-kit MCP server.');
  log.dim('  MCP server command: cdd-kit');
  log.dim('  MCP server args: ["mcp"]');
  log.dim('  Tools exposed: cdd_graph_context, cdd_graph_query, cdd_graph_impact, cdd_index_query, cdd_index_impact');
  log.dim('  Use MCP graph tools before source reads; CLI fallback: cdd-kit graph/index.');
}
