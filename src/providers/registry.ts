import type { Provider, ProviderOption } from '../utils/provider.js';
import type { ProviderAdapter } from './types.js';

export function providerAdapters(provider: Provider): ProviderAdapter[] {
  const adapters: ProviderAdapter[] = [];
  if (provider === 'claude' || provider === 'both') {
    adapters.push({
      id: 'claude',
      displayName: 'Claude Code',
      supportsAgentHooks: true,
      mcpCommand: 'claude',
      mcpArgs: ['mcp', 'add', '--scope', 'user', 'cdd-kit', '--', 'cdd-kit', 'mcp'],
    });
  }
  if (provider === 'codex' || provider === 'both') {
    adapters.push({
      id: 'codex',
      displayName: 'Codex',
      supportsAgentHooks: false,
      mcpCommand: 'codex',
      mcpArgs: ['mcp', 'add', 'cdd-kit', '--', 'cdd-kit', 'mcp'],
    });
  }
  return adapters;
}

export function isProviderOption(value: string): value is ProviderOption {
  return value === 'auto' || value === 'claude' || value === 'codex' || value === 'both';
}
