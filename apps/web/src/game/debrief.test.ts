import { describe, expect, it } from 'vitest';
import { classifyActions } from './debrief';

const series = (f: (t: number) => number) => {
  const t = Array.from({ length: 120 }, (_, i) => i + 1);
  return { t, v: t.map(f) };
};
const at = (t: number) => ({ t, request: { action: 'add-cache' as const, target: 'db' }, status: 'effective' as const });

describe('classifyActions', () => {
  it('helped when burn drops', () => {
    const budget = series((t) => (t < 40 ? 120 - t : 80));
    expect(classifyActions([at(40)], budget, () => 'Add cache')[0]).toMatchObject({ verdict: 'helped', label: 'Add cache', target: 'db' });
  });

  it('hurt when burn rises', () => {
    const budget = series((t) => (t < 40 ? 120 - 0.1 * t : 116 - (t - 40)));
    expect(classifyActions([at(40)], budget, () => 'x')[0]!.verdict).toBe('hurt');
  });

  it('neutral when nothing changes or data is missing, and ignores scheduled entries', () => {
    const budget = series(() => 120);
    expect(classifyActions([at(40)], budget, () => 'x')[0]!.verdict).toBe('neutral');
    expect(classifyActions([at(500)], budget, () => 'x')[0]!.verdict).toBe('neutral');
    expect(classifyActions([{ ...at(40), status: 'scheduled' }], budget, () => 'x')).toEqual([]);
  });
});
