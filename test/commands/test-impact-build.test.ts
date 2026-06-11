import { describe, it, expect } from 'vitest';
import { isTestFilePath } from '../../src/commands/test-impact.js';

/**
 * Pins the test-file path convention used by `cdd-kit test impact` to decide
 * which dependents count as tests. CLI behavior (transitive walk, mirror paths,
 * reasons) is covered in test/cli/test-impact.test.ts.
 */
describe('isTestFilePath', () => {
  it('recognizes pytest conventions', () => {
    expect(isTestFilePath('src/test_user.py')).toBe(true);
    expect(isTestFilePath('pkg/user_test.py')).toBe(true);
  });

  it('recognizes JS/TS test and spec conventions', () => {
    expect(isTestFilePath('src/user.test.ts')).toBe(true);
    expect(isTestFilePath('src/user.spec.tsx')).toBe(true);
    expect(isTestFilePath('src/user.test.js')).toBe(true);
    expect(isTestFilePath('src/user.spec.mjs')).toBe(true);
  });

  it('recognizes files under a tests/ or __tests__/ directory', () => {
    expect(isTestFilePath('tests/anything.ts')).toBe(true);
    expect(isTestFilePath('src/__tests__/widget.ts')).toBe(true);
    expect(isTestFilePath('test/legacy_case.py')).toBe(true);
  });

  it('does not flag ordinary source files', () => {
    expect(isTestFilePath('src/user.ts')).toBe(false);
    expect(isTestFilePath('src/services/user_service.py')).toBe(false);
    // "latest.ts" must not match the `test` directory-segment rule.
    expect(isTestFilePath('src/latest.ts')).toBe(false);
    // a `contest` segment is not a `test` segment.
    expect(isTestFilePath('src/contest/score.ts')).toBe(false);
  });
});
