import { describe, expect, it } from 'vitest';
import { classifyParityVerdict } from '../../src/runtime/parity.js';

describe('classifyParityVerdict', () => {
  it('is inconclusive when there is no mutation corpus, even if both runs align', () => {
    // This is the M1 fix: the previous `mutationEquivalent ?? true` returned an
    // `equivalent` verdict from two green runs and no mutation evidence.
    expect(classifyParityVerdict(true, null)).toBe('inconclusive');
  });

  it('is equivalent only when the runs align AND the mutation corpus fully matches', () => {
    expect(classifyParityVerdict(true, true)).toBe('equivalent');
  });

  it('is divergent when a mutation diverges or the runs disagree', () => {
    expect(classifyParityVerdict(true, false)).toBe('divergent');
    expect(classifyParityVerdict(false, true)).toBe('divergent');
    expect(classifyParityVerdict(false, null)).toBe('divergent');
  });
});
