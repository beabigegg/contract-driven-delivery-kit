import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type Provider = 'claude' | 'codex' | 'both';
export type ProviderOption = Provider | 'auto';

export function validateProviderOption(provider: string): provider is ProviderOption {
  return provider === 'auto' || provider === 'claude' || provider === 'codex' || provider === 'both';
}

export function inferProvider(cwd: string, requested: ProviderOption = 'auto'): Provider {
  if (requested !== 'auto') return requested;

  const modelPolicyPath = join(cwd, '.cdd', 'model-policy.json');
  if (existsSync(modelPolicyPath)) {
    try {
      const policy = JSON.parse(readFileSync(modelPolicyPath, 'utf8')) as { provider?: string };
      if (policy.provider === 'claude' || policy.provider === 'codex' || policy.provider === 'both') {
        return policy.provider;
      }
    } catch {
      // Fall through to guidance-file inference.
    }
  }

  const hasClaude = existsSync(join(cwd, 'CLAUDE.md')) || existsSync(join(cwd, 'AGENTS.md'));
  const hasCodex = existsSync(join(cwd, 'CODEX.md'));
  if (hasClaude && hasCodex) return 'both';
  if (hasCodex) return 'codex';
  return 'claude';
}
