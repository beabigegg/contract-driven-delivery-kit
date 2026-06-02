import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Mechanical risk-tier floor — the safety net under the (AI) classifier.
 *
 * In a fully automated workflow no human reviews the classifier's tier call, so
 * a single mis-classification silently drops the agents and tests a high-risk
 * change requires. This module is the deterministic backstop: it scans the
 * change's stated intent for sensitive surfaces and computes the *least strict
 * tier still allowed*. `cdd-kit gate` fails when the declared tier is weaker
 * than that floor, unless the change records an explicit override.
 *
 * Tier semantics match the rest of the kit: 0 = critical, 5 = doc-only. A lower
 * number is stricter, so "floor" is a MAXIMUM allowed tier number.
 *
 * The policy is data-driven (.cdd/tier-policy.json) and fully overridable;
 * when the file is absent the built-in defaults below apply, so the net also
 * protects repos that predate this feature without a re-init.
 */

export interface TierRule {
  maxTier: number;
  label: string;
  patterns: string[];
}

export interface TierPolicy {
  enabled: boolean;
  rules: TierRule[];
}

export interface TierFloorMatch {
  /** The strictest (lowest) maxTier triggered. null when nothing matched. */
  floorTier: number | null;
  /** Human-readable label of the rule that set the floor. */
  label: string | null;
  /** Distinct matched text fragments (lower-cased), for the gate message. */
  matched: string[];
}

/**
 * Built-in defaults — kept in sync with the shipped .cdd/tier-policy.json asset
 * so behaviour is identical whether or not a repo has the file on disk.
 */
export const DEFAULT_TIER_POLICY: TierPolicy = {
  enabled: true,
  rules: [
    {
      maxTier: 0,
      label: 'critical surface (auth / payments / data migration / concurrency / secrets)',
      patterns: [
        'auth', 'authn', 'authz',
        'authentication', 'authorization', 'authenticate', 'authorize',
        'authenticated', 'authorized',
        'login', 'logout', 'sign-?in', 'sign-?up',
        'passwords?', 'passwd', 'credentials?', 'secrets?', 'api[- ]?keys?',
        // Qualified so security tokens trip the floor but design/CSS "tokens" do not.
        '(access|api|auth|session|bearer|refresh|csrf|id|reset)[- ]?tokens?',
        'jwt', 'oauth', 'oidc', 'saml', 'sessions?', 'cookies?',
        'payments?', 'billing', 'invoices?', 'charges?', 'refunds?', 'checkout', 'stripe', 'paypal',
        'migrations?', 'migrate', 'alter table', 'drop table', 'drop column', 'schema change',
        'concurrency', 'race condition', 'mutex', 'deadlock', 'transaction isolation',
        'encrypt', 'decrypt', 'crypto', 'hashing', 'rbac', 'permissions?', 'access control',
        'privileges?', 'pii', 'gdpr', 'hipaa', 'rate limit', 'csrf', 'xss', 'sql injection',
      ],
    },
    {
      maxTier: 2,
      label: 'behavioral surface (api / data shape / queue / cache / external integration)',
      patterns: [
        'endpoint', 'route', 'api contract', 'request schema', 'response schema',
        'pagination', 'queue', 'worker', 'cron', 'scheduler', 'webhook',
        'cache', 'redis', 'database', 'query', 'index', 'external service',
        'third[- ]?party', 'integration', 'data shape', 'nullable', 'breaking change',
      ],
    },
  ],
};

interface RawPolicy {
  enabled?: unknown;
  rules?: unknown;
}

/**
 * Load `.cdd/tier-policy.json` if present, else the built-in defaults.
 * Malformed files fall back to defaults rather than throwing — the safety net
 * should never be the thing that crashes the gate.
 */
export function loadTierPolicy(cwd: string): TierPolicy {
  const path = join(cwd, '.cdd', 'tier-policy.json');
  if (!existsSync(path)) return DEFAULT_TIER_POLICY;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as RawPolicy;
    if (typeof raw.enabled === 'boolean' && raw.enabled === false) {
      return { enabled: false, rules: [] };
    }
    if (!Array.isArray(raw.rules)) return DEFAULT_TIER_POLICY;
    const rules: TierRule[] = [];
    for (const r of raw.rules) {
      if (
        r && typeof r === 'object' &&
        typeof (r as TierRule).maxTier === 'number' &&
        Array.isArray((r as TierRule).patterns)
      ) {
        const rule = r as TierRule;
        rules.push({
          maxTier: rule.maxTier,
          label: typeof rule.label === 'string' ? rule.label : `tier ${rule.maxTier} surface`,
          patterns: rule.patterns.filter(p => typeof p === 'string'),
        });
      }
    }
    if (rules.length === 0) return DEFAULT_TIER_POLICY;
    return { enabled: raw.enabled !== false, rules };
  } catch {
    return DEFAULT_TIER_POLICY;
  }
}

/**
 * Escape a user-supplied pattern that is meant to be matched as a phrase.
 * Returns a NON-global, case-insensitive regex — callers rely on this being
 * stateless, using a single `.test()` / `.exec()` per pattern (no `g` flag, so
 * there is no `lastIndex` to carry between calls).
 */
function patternToRegExp(pattern: string): RegExp | null {
  try {
    // Patterns may contain intentional regex fragments (e.g. `sign-?in`,
    // `api[- ]?key`). Wrap with word-ish boundaries so `auth` does not match
    // inside `author`, while still allowing multi-word phrases. We use
    // lookarounds on alphanumerics rather than \b so phrases with spaces and
    // hyphens behave intuitively.
    return new RegExp(`(?<![a-z0-9])(?:${pattern})(?![a-z0-9])`, 'i');
  } catch {
    return null;
  }
}

/**
 * Compute the tier floor for a block of intent text (typically the body of
 * change-request.md, optionally concatenated with touched file paths).
 * Returns the strictest (lowest) maxTier whose rule matched.
 *
 * `opts.paths` (the change's touched file paths) are scanned too, but only
 * against the strictest (tier-0) rules: a path hit on a critical word
 * (`auth/`, `payments/`, `migrations/`) is almost always a genuine critical
 * surface, whereas applying tier-2 words like `index`/`route`/`query` to paths
 * would false-positive on common filenames (`index.ts`, `routes.ts`).
 */
export function computeTierFloor(
  text: string,
  policy: TierPolicy = DEFAULT_TIER_POLICY,
  opts: { paths?: string[] } = {},
): TierFloorMatch {
  if (!policy.enabled) {
    return { floorTier: null, label: null, matched: [] };
  }

  let floorTier: number | null = null;
  let label: string | null = null;
  const matched = new Set<string>();

  const scan = (rules: TierRule[], haystack: string): void => {
    if (!haystack) return;
    for (const rule of rules) {
      let ruleHit = false;
      for (const pattern of rule.patterns) {
        const re = patternToRegExp(pattern);
        const hit = re ? re.exec(haystack) : null;
        if (hit) {
          ruleHit = true;
          // Report the ACTUAL matched text (e.g. "session token", "auth",
          // "api key"), not the raw regex pattern. Qualified alternations like
          // `(access|api|…)[- ]?tokens?` would otherwise print as unreadable
          // noise in the gate / classify-check "matched:" line. One
          // representative match per pattern is intentional — `matched` is the
          // set of sensitive concepts hit, not every occurrence of each.
          matched.add(hit[0].toLowerCase().replace(/\s+/g, ' ').trim());
        }
      }
      if (ruleHit && (floorTier === null || rule.maxTier < floorTier)) {
        floorTier = rule.maxTier;
        label = rule.label;
      }
    }
  };

  // Prose intent (change-request.md): all rules.
  scan(policy.rules, text);

  // Touched file paths: only the strictest (tier-0) rules — see the note above.
  const paths = opts.paths ?? [];
  if (paths.length > 0) {
    scan(policy.rules.filter(r => r.maxTier === 0), paths.join('\n'));
  }

  return { floorTier, label, matched: [...matched].sort() };
}
