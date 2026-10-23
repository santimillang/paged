import { describe, expect, it } from 'vitest';
import { pageText } from './pager';

const snap = (availability: number, worstP99Ms: number) => ({ stats: { availability, worstP99Ms } }) as never;

describe('pageText', () => {
  it('reports errors first, then latency', () => {
    expect(pageText(snap(0.58, 3000), { availability: 99.9, p99Ms: 800 })).toBe('Error rate 42% (SLO allows 0.1%)');
    expect(pageText(snap(1, 2345.6), { availability: 99.9, p99Ms: 800 })).toBe('p99 latency 2346ms > 800ms SLO');
  });
});
