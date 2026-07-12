import { log } from './logger.js';

export function logRecommendedMcpSetup(): void {
  log.info('Recommended for AI agents: enable the cdd-kit MCP server.');
  log.dim('  Claude Code user-scope setup: claude mcp add --scope user cdd-kit -- cdd-kit mcp');
  log.dim('  Codex user-scope setup: codex mcp add cdd-kit -- cdd-kit mcp');
  log.dim('  Verify in Claude Code: /mcp or `claude mcp list`');
  log.dim('  Verify in Codex: /mcp or `codex mcp list`');
  log.dim('  Note: Claude Code CLI reads MCP servers from ~/.claude.json; ~/.claude/settings.json is not enough.');
  log.dim('  Note: Codex CLI reads MCP servers from ~/.codex/config.toml.');
  log.dim('  Tools exposed: cdd_graph_context, cdd_graph_query, cdd_graph_impact, cdd_index_query, cdd_index_impact');
  log.dim('  Use MCP graph tools before source reads; CLI fallback: cdd-kit graph/index.');
}
