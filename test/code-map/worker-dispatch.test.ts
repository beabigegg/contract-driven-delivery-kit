import { describe, it, expect } from 'vitest';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { scanLangWithWorkers } from '../../src/code-map/worker-dispatch.js';
import { jsScanner } from '../../src/code-map/scanners/javascript.js';

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'code-map');

describe('scanLangWithWorkers', () => {
  it('falls back to in-process scanning when the worker CLI cannot be spawned', async () => {
    // A bogus CLI entry makes every child process fail (ENOENT). The dispatcher
    // must recover by scanning in-process rather than losing the files, so
    // enabling --workers can never make a run worse than the default.
    const result = await scanLangWithWorkers(
      jsScanner,
      'js',
      [join(FIXTURE_ROOT, 'sample.js')],
      FIXTURE_ROOT,
      4,
      '/nonexistent/cdd-cli-entry.js',
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].path).toBe('sample.js');
    expect(result.entries[0].functions.length).toBeGreaterThan(0);
  });

  it('returns an empty result for an empty file list without spawning anything', async () => {
    const result = await scanLangWithWorkers(jsScanner, 'js', [], FIXTURE_ROOT, 4, '/nonexistent/cli.js');
    expect(result.entries).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
