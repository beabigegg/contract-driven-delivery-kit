/**
 * Unit tests for the TypeScript scanner (.ts and .tsx).
 */
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'path';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { tsScanner } from '../../src/code-map/scanners/typescript.js';

const FIXTURE_ROOT = join(
  import.meta.dirname ?? dirname(new URL(import.meta.url).pathname),
  '..',
  'fixtures',
  'code-map',
);

function fixturePath(name: string): string {
  return join(FIXTURE_ROOT, name);
}

function writeTempTs(content: string, ext: '.ts' | '.tsx' = '.ts'): string {
  const dir = mkdtempSync(join(tmpdir(), 'cdd-test-ts-'));
  const p = join(dir, `test${ext}`);
  writeFileSync(p, content, 'utf8');
  return p;
}

describe('typescript scanner — sample.ts', () => {
  it('extracts imports / classes / functions', async () => {
    const e = await tsScanner.scan(fixturePath('sample.ts'), FIXTURE_ROOT);
    expect(e).not.toBeNull();
    expect(e!.path).toBe('sample.ts');
    expect(e!.imports.find(i => i.module === './utils')?.items.sort()).toEqual(['bar', 'foo']);
    expect(e!.imports.find(i => i.module === 'some-module')?.items[0]).toMatch(/^default:/);
    expect(e!.constants.map(c => c.name)).toEqual(expect.arrayContaining(['MAX_RETRIES', 'API_BASE']));
    expect(e!.classes.find(c => c.name === 'Service')).toBeTruthy();
    expect(e!.classes[0].methods.find(m => m.name === 'fetch')?.async).toBe(true);
    expect(e!.functions.find(f => f.name === 'declared')).toBeTruthy();
    expect(e!.functions.find(f => f.name === 'handler')?.async).toBe(true);
    expect(e!.functions.find(f => f.name === 'genericFn')).toBeTruthy();
  });

  it('extracts interfaces, types, and enums with exported flag', async () => {
    const e = await tsScanner.scan(fixturePath('sample.ts'), FIXTURE_ROOT);
    expect(e).not.toBeNull();

    const userIf = e!.interfaces!.find(i => i.name === 'User');
    expect(userIf?.exported).toBe(true);
    const internalIf = e!.interfaces!.find(i => i.name === 'InternalState');
    expect(internalIf?.exported).toBe(false);

    const userIdType = e!.types!.find(t => t.name === 'UserId');
    expect(userIdType?.exported).toBe(true);
    const localAlias = e!.types!.find(t => t.name === 'LocalAlias');
    expect(localAlias?.exported).toBe(false);

    const status = e!.enums!.find(en => en.name === 'Status');
    expect(status?.exported).toBe(true);
    expect(status?.members.sort()).toEqual(['Active', 'Done', 'Pending']);
    const localEnum = e!.enums!.find(en => en.name === 'LocalEnum');
    expect(localEnum?.exported).toBe(false);
    expect(localEnum?.members).toEqual(['A', 'B', 'C']);
  });
});

describe('typescript scanner — sample.tsx (forwardRef + memo + JSX)', () => {
  it('parses TSX with JSX and captures interfaces + components', async () => {
    const e = await tsScanner.scan(fixturePath('sample.tsx'), FIXTURE_ROOT);
    expect(e).not.toBeNull();
    expect(e!.path).toBe('sample.tsx');

    expect(e!.interfaces!.find(i => i.name === 'ButtonProps')?.exported).toBe(true);
    expect(e!.interfaces!.find(i => i.name === 'CardProps')?.exported).toBe(true);
    expect(e!.types!.find(t => t.name === 'Variant')?.exported).toBe(true);

    // forwardRef + memo wrapped components — captured via the uppercase-CallExpression heuristic
    expect(e!.functions.find(f => f.name === 'Button')).toBeTruthy();
    expect(e!.functions.find(f => f.name === 'Card')).toBeTruthy();
    // Plain function component
    expect(e!.functions.find(f => f.name === 'PlainComponent')).toBeTruthy();
    // async arrow
    expect(e!.functions.find(f => f.name === 'handler')?.async).toBe(true);
  });
});

describe('typescript scanner — types-only.ts', () => {
  it('produces a file entry with only interfaces / types / enums', async () => {
    const e = await tsScanner.scan(fixturePath('types-only.ts'), FIXTURE_ROOT);
    expect(e).not.toBeNull();
    expect(e!.functions).toHaveLength(0);
    expect(e!.classes).toHaveLength(0);
    expect(e!.interfaces!.map(i => i.name).sort()).toEqual(['Owner', 'Repo']);
    expect(e!.types!.map(t => t.name).sort()).toEqual(['Predicate', 'Sortable']);
    expect(e!.enums!.map(en => en.name)).toEqual(['Severity']);
    expect(e!.enums![0].members).toEqual(['Low', 'Medium', 'High', 'Critical']);
  });
});

describe('typescript scanner — generics in .ts vs .tsx', () => {
  it('parses bare generic syntax in .ts files', async () => {
    const tmp = writeTempTs(
      `export function identity<T>(x: T): T { return x; }\nexport const f = <T>(x: T): T => x;\n`,
      '.ts',
    );
    const e = await tsScanner.scan(tmp, dirname(tmp));
    expect(e).not.toBeNull();
    expect(e!.functions.find(f => f.name === 'identity')).toBeTruthy();
    expect(e!.functions.find(f => f.name === 'f')).toBeTruthy();
  });

  it('parses TSX with both JSX and generic-call expressions', async () => {
    const tmp = writeTempTs(
      `import { forwardRef } from 'react';\n` +
      `export const X = forwardRef<HTMLDivElement, { id: string }>(function X({ id }, ref) {\n` +
      `  return <div ref={ref}>{id}</div>;\n` +
      `});\n`,
      '.tsx',
    );
    const e = await tsScanner.scan(tmp, dirname(tmp));
    expect(e).not.toBeNull();
    expect(e!.functions.find(f => f.name === 'X')).toBeTruthy();
  });
});

describe('typescript scanner — error handling', () => {
  it('returns null for catastrophic syntax with no recoverable AST', async () => {
    // Babel errorRecovery is permissive — even random characters often produce
    // empty AST. Either null or empty entry is acceptable; never throws.
    const tmp = writeTempTs('!!!@@##$$', '.ts');
    const e = await tsScanner.scan(tmp, dirname(tmp));
    expect(e === null || (e.functions.length === 0 && e.classes.length === 0 && (e.interfaces ?? []).length === 0)).toBe(true);
  });
});
