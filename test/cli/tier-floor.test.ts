import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { makeTempDir, cleanupDir } from '../helpers.js';
import {
  computeTierFloor,
  loadTierPolicy,
  DEFAULT_TIER_POLICY,
} from '../../src/utils/tier-floor.js';
import { createDebouncedRunner } from '../../src/commands/code-map-watch.js';

describe('computeTierFloor', () => {
  it('returns null when no sensitive surface is mentioned', () => {
    const r = computeTierFloor('Update the README and fix a typo in the footer copy.');
    expect(r.floorTier).toBeNull();
    expect(r.matched).toEqual([]);
  });

  it('floors critical surfaces (auth/payments/migration) at tier 0', () => {
    expect(computeTierFloor('Add JWT authentication to the login flow').floorTier).toBe(0);
    expect(computeTierFloor('Wire up Stripe payment checkout').floorTier).toBe(0);
    expect(computeTierFloor('Run a database migration to alter table users').floorTier).toBe(0);
    expect(computeTierFloor('Rotate the API key and encrypt secrets at rest').floorTier).toBe(0);
  });

  it('floors behavioral surfaces (api/queue/cache) at tier 2', () => {
    const r = computeTierFloor('Add pagination to the list endpoint and a redis cache');
    expect(r.floorTier).toBe(2);
    expect(r.matched.length).toBeGreaterThan(0);
  });

  it('takes the strictest matching rule when both fire', () => {
    // mentions both a tier-2 surface (endpoint) and a tier-0 surface (auth)
    const r = computeTierFloor('Add an endpoint that issues a JWT auth token');
    expect(r.floorTier).toBe(0);
  });

  it('does not match sensitive words embedded in larger words', () => {
    // "author" must not match "auth"; "tokenizer" must not match "token"
    const r = computeTierFloor('The author wrote a tokenizer for markdown rendering.');
    expect(r.floorTier).toBeNull();
  });

  it('matches the canonical full auth words, not just the "auth" abbreviation', () => {
    expect(computeTierFloor('add authentication middleware').floorTier).toBe(0);
    expect(computeTierFloor('update the authorization rules').floorTier).toBe(0);
    expect(computeTierFloor('authenticate the request before routing').floorTier).toBe(0);
    // still no false positive on "author"
    expect(computeTierFloor('credit the author in the footer').floorTier).toBeNull();
  });

  it('reports the matched fragments for the gate message', () => {
    const r = computeTierFloor('Add OAuth login and refund handling');
    expect(r.matched).toContain('oauth');
    expect(r.matched).toContain('login');
    // The label is the (regex-stripped) pattern; the noun patterns are pluralized.
    expect(r.matched).toContain('refunds');
  });

  it('floors plural critical-surface directories from touched paths', () => {
    // The alphanumeric lookahead means singular patterns would miss the
    // trailing "s"; the pluralized patterns must still catch these dirs.
    expect(computeTierFloor('generic cleanup', DEFAULT_TIER_POLICY, {
      paths: ['src/payments/checkout.ts'],
    }).floorTier).toBe(0);
    expect(computeTierFloor('generic cleanup', DEFAULT_TIER_POLICY, {
      paths: ['db/migrations/001_init.sql'],
    }).floorTier).toBe(0);
    // Singular directory forms still match too.
    expect(computeTierFloor('generic cleanup', DEFAULT_TIER_POLICY, {
      paths: ['src/payment/charge.ts'],
    }).floorTier).toBe(0);
  });

  it('treats SECURITY tokens as tier 0 but not design/CSS tokens', () => {
    // Qualified token contexts trip the floor…
    expect(computeTierFloor('rotate the access token nightly').floorTier).toBe(0);
    expect(computeTierFloor('refresh the bearer token on 401').floorTier).toBe(0);
    expect(computeTierFloor('cleanup', DEFAULT_TIER_POLICY, {
      paths: ['src/services/access-token.ts'],
    }).floorTier).toBe(0);
    // …but plain design-system "tokens" must NOT, in prose or paths.
    expect(computeTierFloor('update the design tokens for the new theme').floorTier).toBeNull();
    expect(computeTierFloor('restyle the button', DEFAULT_TIER_POLICY, {
      paths: ['src/theme/tokens.ts'],
    }).floorTier).toBeNull();
  });

  it('respects a disabled policy', () => {
    const r = computeTierFloor('Add JWT auth', { enabled: false, rules: [] });
    expect(r.floorTier).toBeNull();
  });

  it('floors at tier 0 from a touched path even when the request is generic', () => {
    const r = computeTierFloor('refactor the middleware layer', DEFAULT_TIER_POLICY, {
      paths: ['src/auth/middleware.ts', 'README.md'],
    });
    expect(r.floorTier).toBe(0);
  });

  it('does NOT apply noisy tier-2 rules to paths (no filename false positives)', () => {
    const r = computeTierFloor('update the docs', DEFAULT_TIER_POLICY, {
      paths: ['src/components/index.ts', 'src/router/routes.ts', 'src/api/query.ts'],
    });
    expect(r.floorTier).toBeNull();
  });
});

describe('loadTierPolicy', () => {
  it('falls back to built-in defaults when the file is absent', () => {
    const dir = makeTempDir('cdd-tierpol-');
    try {
      const p = loadTierPolicy(dir);
      expect(p.enabled).toBe(true);
      expect(p.rules.length).toBe(DEFAULT_TIER_POLICY.rules.length);
    } finally {
      cleanupDir(dir);
    }
  });

  it('honours enabled:false on disk', () => {
    const dir = makeTempDir('cdd-tierpol-');
    try {
      mkdirSync(join(dir, '.cdd'), { recursive: true });
      writeFileSync(join(dir, '.cdd', 'tier-policy.json'), JSON.stringify({ enabled: false }), 'utf8');
      expect(loadTierPolicy(dir).enabled).toBe(false);
    } finally {
      cleanupDir(dir);
    }
  });

  it('falls back to defaults on malformed JSON rather than throwing', () => {
    const dir = makeTempDir('cdd-tierpol-');
    try {
      mkdirSync(join(dir, '.cdd'), { recursive: true });
      writeFileSync(join(dir, '.cdd', 'tier-policy.json'), '{ not valid json', 'utf8');
      const p = loadTierPolicy(dir);
      expect(p.enabled).toBe(true);
      expect(p.rules.length).toBeGreaterThan(0);
    } finally {
      cleanupDir(dir);
    }
  });

  it('accepts a custom rule set', () => {
    const dir = makeTempDir('cdd-tierpol-');
    try {
      mkdirSync(join(dir, '.cdd'), { recursive: true });
      writeFileSync(join(dir, '.cdd', 'tier-policy.json'), JSON.stringify({
        enabled: true,
        rules: [{ maxTier: 0, label: 'custom', patterns: ['frobnicate'] }],
      }), 'utf8');
      const p = loadTierPolicy(dir);
      expect(computeTierFloor('please frobnicate the widget', p).floorTier).toBe(0);
      // a default pattern is no longer present
      expect(computeTierFloor('add jwt auth', p).floorTier).toBeNull();
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('createDebouncedRunner', () => {
  it('coalesces a burst of triggers into a single run', async () => {
    let runs = 0;
    const { trigger, dispose } = createDebouncedRunner(async () => { runs += 1; }, 20);
    trigger(); trigger(); trigger();
    await new Promise(r => setTimeout(r, 60));
    dispose();
    expect(runs).toBe(1);
  });

  it('queues a follow-up run when triggered during an in-flight run', async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let firstStarted = false;
    const { trigger, dispose } = createDebouncedRunner(async () => {
      runs += 1;
      if (!firstStarted) { firstStarted = true; await gate; }
    }, 10);

    trigger();
    await new Promise(r => setTimeout(r, 30)); // first run starts and is parked on gate
    trigger();                                 // arrives while first run is in-flight
    await new Promise(r => setTimeout(r, 30)); // debounce elapses; should queue, not overlap
    release();                                 // let first run finish -> queued run fires
    await new Promise(r => setTimeout(r, 30));
    dispose();
    expect(runs).toBe(2);
  });
});
