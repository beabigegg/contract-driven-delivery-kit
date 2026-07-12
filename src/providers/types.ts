import type { Provider } from '../utils/provider.js';

export interface ProviderAdapter {
  id: Exclude<Provider, 'both'>;
  displayName: string;
  projectGuidance: string[];
  userSkillHome: string;
  supportsUserAgents: boolean;
  supportsAgentHooks: boolean;
  mcpCommand: string;
  mcpArgs: string[];
}
