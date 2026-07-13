import type { Provider } from '../utils/provider.js';

export interface ProviderAdapter {
  id: Exclude<Provider, 'both'>;
  displayName: string;
  // Whether this provider has an agent-hook harness cdd-kit can arm (Claude
  // Code does; Codex does not). Consumed by `setup` to gate hook installation.
  supportsAgentHooks: boolean;
  mcpCommand: string;
  mcpArgs: string[];
}
