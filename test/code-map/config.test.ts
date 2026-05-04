/**
 * Unit tests for code-map config loader.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  BUILTIN_INCLUDE,
  BUILTIN_EXCLUDE,
  loadCodeMapConfig,
  CONFIG_REL_PATH,
} from '../../src/code-map/config.js';
import { makeTempDir, cleanupDir } from '../helpers.js';

let tmp: string;

beforeEach(() => {
  tmp = makeTempDir('code-map-config-');
});

afterEach(() => {
  cleanupDir(tmp);
});

function writeConfig(text: string): void {
  mkdirSync(join(tmp, '.cdd'), { recursive: true });
  writeFileSync(join(tmp, CONFIG_REL_PATH), text, 'utf8');
}

describe('loadCodeMapConfig', () => {
  it('returns built-in defaults when no config file exists', () => {
    const cfg = loadCodeMapConfig(tmp);
    expect(cfg.source).toBe('builtin');
    expect(cfg.include).toEqual(BUILTIN_INCLUDE);
    expect(cfg.exclude).toEqual(BUILTIN_EXCLUDE);
  });

  it('returns built-in defaults when config file is empty', () => {
    writeConfig('');
    const cfg = loadCodeMapConfig(tmp);
    expect(cfg.source).toBe('user-file');
    expect(cfg.include).toEqual(BUILTIN_INCLUDE);
    expect(cfg.exclude).toEqual(BUILTIN_EXCLUDE);
  });

  it('replaces include when user config sets only include', () => {
    writeConfig('include:\n  - "src/**/*.py"\n');
    const cfg = loadCodeMapConfig(tmp);
    expect(cfg.include).toEqual(['src/**/*.py']);
    expect(cfg.exclude).toEqual(BUILTIN_EXCLUDE);
  });

  it('replaces exclude when user config sets only exclude', () => {
    writeConfig('exclude:\n  - "**/legacy/**"\n');
    const cfg = loadCodeMapConfig(tmp);
    expect(cfg.include).toEqual(BUILTIN_INCLUDE);
    expect(cfg.exclude).toEqual(['**/legacy/**']);
  });

  it('replaces both lists when both are set', () => {
    writeConfig(
      'include:\n  - "lib/**/*.ts"\n' +
      'exclude:\n  - "lib/legacy/**"\n  - "lib/vendor/**"\n',
    );
    const cfg = loadCodeMapConfig(tmp);
    expect(cfg.include).toEqual(['lib/**/*.ts']);
    expect(cfg.exclude).toEqual(['lib/legacy/**', 'lib/vendor/**']);
  });

  it('throws when include is not an array', () => {
    writeConfig('include: "src/**/*.ts"\n');
    expect(() => loadCodeMapConfig(tmp)).toThrowError(/include.*list/);
  });

  it('throws when an include entry is not a string', () => {
    writeConfig('include:\n  - 42\n');
    expect(() => loadCodeMapConfig(tmp)).toThrowError(/include\[0\].*string/);
  });

  it('throws when exclude is not an array', () => {
    writeConfig('exclude: { not: array }\n');
    expect(() => loadCodeMapConfig(tmp)).toThrowError(/exclude.*list/);
  });

  it('throws when top-level is a list', () => {
    writeConfig('- a\n- b\n');
    expect(() => loadCodeMapConfig(tmp)).toThrowError(/mapping/);
  });

  it('built-in defaults include all six source families', () => {
    expect(BUILTIN_INCLUDE).toEqual(
      expect.arrayContaining(['**/*.py', '**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx', '**/*.vue']),
    );
  });
});
