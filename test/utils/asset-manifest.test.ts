import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { makeTempDir, cleanupDir } from '../helpers.js';
import { readAssetManifest, stampAssetManifest } from '../../src/utils/asset-manifest.js';

describe('asset-manifest (ADR 0010 SS6 / design.md Q3, AC-8)', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-asset-manifest-');
    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
  });

  it('readAssetManifest returns {} when the sidecar does not exist', () => {
    expect(readAssetManifest(tmpRepo)).toEqual({});
  });

  it('readAssetManifest returns {} for malformed JSON (does not throw)', () => {
    writeFileSync(join(tmpRepo, '.cdd', 'asset-manifest.json'), 'not json{', 'utf8');
    expect(readAssetManifest(tmpRepo)).toEqual({});
  });

  it('stampAssetManifest writes version + digest for an installed file', () => {
    mkdirSync(join(tmpRepo, 'specs', 'templates'), { recursive: true });
    writeFileSync(join(tmpRepo, 'specs', 'templates', 'acceptance.yml'), 'oracle-version: 0.1.0\n', 'utf8');

    stampAssetManifest(tmpRepo, '3.8.0', ['specs/templates/acceptance.yml']);

    expect(existsSync(join(tmpRepo, '.cdd', 'asset-manifest.json'))).toBe(true);
    const manifest = readAssetManifest(tmpRepo);
    expect(manifest['specs/templates/acceptance.yml']).toBeDefined();
    expect(manifest['specs/templates/acceptance.yml'].version).toBe('3.8.0');
    expect(manifest['specs/templates/acceptance.yml'].digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('stampAssetManifest merges into an existing manifest without clobbering other entries', () => {
    mkdirSync(join(tmpRepo, 'specs', 'templates'), { recursive: true });
    writeFileSync(join(tmpRepo, 'specs', 'templates', 'a.yml'), 'a\n', 'utf8');
    writeFileSync(join(tmpRepo, 'specs', 'templates', 'b.yml'), 'b\n', 'utf8');

    stampAssetManifest(tmpRepo, '3.8.0', ['specs/templates/a.yml']);
    stampAssetManifest(tmpRepo, '3.8.0', ['specs/templates/b.yml']);

    const manifest = readAssetManifest(tmpRepo);
    expect(manifest['specs/templates/a.yml']).toBeDefined();
    expect(manifest['specs/templates/b.yml']).toBeDefined();
  });

  it('stampAssetManifest skips a path that does not exist on disk', () => {
    stampAssetManifest(tmpRepo, '3.8.0', ['specs/templates/does-not-exist.yml']);
    const manifest = readAssetManifest(tmpRepo);
    expect(manifest['specs/templates/does-not-exist.yml']).toBeUndefined();
  });

  it('re-stamping the same unchanged file produces the same digest (idempotent)', () => {
    mkdirSync(join(tmpRepo, 'specs', 'templates'), { recursive: true });
    writeFileSync(join(tmpRepo, 'specs', 'templates', 'a.yml'), 'a\n', 'utf8');
    stampAssetManifest(tmpRepo, '3.8.0', ['specs/templates/a.yml']);
    const first = readAssetManifest(tmpRepo)['specs/templates/a.yml'].digest;
    stampAssetManifest(tmpRepo, '3.8.1', ['specs/templates/a.yml']);
    const second = readAssetManifest(tmpRepo)['specs/templates/a.yml'];
    expect(second.digest).toBe(first);
    expect(second.version).toBe('3.8.1');
  });

  it('re-stamping after a content change produces a different digest', () => {
    mkdirSync(join(tmpRepo, 'specs', 'templates'), { recursive: true });
    writeFileSync(join(tmpRepo, 'specs', 'templates', 'a.yml'), 'a\n', 'utf8');
    stampAssetManifest(tmpRepo, '3.8.0', ['specs/templates/a.yml']);
    const first = readAssetManifest(tmpRepo)['specs/templates/a.yml'].digest;

    writeFileSync(join(tmpRepo, 'specs', 'templates', 'a.yml'), 'a-changed\n', 'utf8');
    stampAssetManifest(tmpRepo, '3.8.0', ['specs/templates/a.yml']);
    const second = readAssetManifest(tmpRepo)['specs/templates/a.yml'].digest;
    expect(second).not.toBe(first);
  });
});
