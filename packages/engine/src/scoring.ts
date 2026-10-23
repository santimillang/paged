import type { ActionId, Outcome } from './types';

export type Stars = 0 | 1 | 2 | 3;

export interface StarCriteria {
  requiredDesignFixes: ActionId[];
  budgetTarget: number;
  costTarget: number;
}

export interface RunResult {
  outcome: Outcome;
  effectiveActions: ActionId[];
  budgetFraction: number;
  costPerHour: number;
  cluesUsed: number;
}

export function scoreRun(r: RunResult, c: StarCriteria): Stars {
  if (r.outcome !== 'won') return 0;
  if (!r.effectiveActions.some((a) => c.requiredDesignFixes.includes(a))) return 1;
  const efficient = r.budgetFraction >= c.budgetTarget && r.costPerHour <= c.costTarget && r.cluesUsed === 0;
  return efficient ? 3 : 2;
}
