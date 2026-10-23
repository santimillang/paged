import { describe, expect, it } from 'vitest';
import { scoreRun } from '../src/scoring';

const criteria = { requiredDesignFixes: ['add-cache' as const], budgetTarget: 0.5, costTarget: 200 };
const won = { outcome: 'won' as const, effectiveActions: [], budgetFraction: 0.9, costPerHour: 100, cluesUsed: 0 };

describe('scoreRun', () => {
  it('0 stars when not won', () => {
    expect(scoreRun({ ...won, outcome: 'lost' }, criteria)).toBe(0);
    expect(scoreRun({ ...won, outcome: 'running' }, criteria)).toBe(0);
  });
  it('1 star for a mitigation-only win', () => {
    expect(scoreRun({ ...won, effectiveActions: ['scale'] }, criteria)).toBe(1);
  });
  it('2 stars with a required design fix but missing efficiency', () => {
    expect(scoreRun({ ...won, effectiveActions: ['add-cache'], cluesUsed: 1 }, criteria)).toBe(2);
    expect(scoreRun({ ...won, effectiveActions: ['add-cache'], budgetFraction: 0.4 }, criteria)).toBe(2);
    expect(scoreRun({ ...won, effectiveActions: ['add-cache'], costPerHour: 201 }, criteria)).toBe(2);
  });
  it('3 stars when efficient', () => {
    expect(scoreRun({ ...won, effectiveActions: ['scale', 'add-cache'] }, criteria)).toBe(3);
  });
});
