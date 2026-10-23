import { describe, expect, it } from 'vitest';
import { patternMultiplier } from '../src/traffic';

describe('patternMultiplier', () => {
  it('defaults to flat', () => {
    expect(patternMultiplier(undefined, 123)).toBe(1);
    expect(patternMultiplier({ type: 'flat' }, 5)).toBe(1);
  });

  it('ramps linearly between startAt and endAt', () => {
    const p = { type: 'ramp' as const, from: 1, to: 3, startAt: 10, endAt: 20 };
    expect(patternMultiplier(p, 0)).toBe(1);
    expect(patternMultiplier(p, 15)).toBe(2);
    expect(patternMultiplier(p, 99)).toBe(3);
  });

  it('daily oscillates around 1', () => {
    const p = { type: 'daily' as const, periodSec: 100, amplitude: 0.5 };
    expect(patternMultiplier(p, 0)).toBeCloseTo(1);
    expect(patternMultiplier(p, 25)).toBeCloseTo(1.5);
    expect(patternMultiplier(p, 75)).toBeCloseTo(0.5);
  });
});
