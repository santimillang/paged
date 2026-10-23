import { describe, expect, it } from 'vitest';
import { clock, fmtMs, fmtPct, fmtRps, fmtUsers } from './format';

describe('format', () => {
  it('formats numbers for the HUD', () => {
    expect(fmtRps(950.4)).toBe('950 rps');
    expect(fmtRps(2600)).toBe('2.6k rps');
    expect(fmtMs(12.34)).toBe('12ms');
    expect(fmtMs(2345)).toBe('2.35s');
    expect(fmtPct(0.4231)).toBe('42%');
    expect(fmtPct(0.99912, 2)).toBe('99.91%');
    expect(clock(0)).toBe('00:00');
    expect(clock(125.3)).toBe('02:05');
    expect(fmtUsers(1_000_000)).toBe('1.00M');
    expect(fmtUsers(84_000)).toBe('84k');
  });
});
