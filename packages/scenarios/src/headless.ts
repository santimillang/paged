import { actionCategory, createSimulation, scoreRun, type GlobalStats, type Outcome, type Stars } from '@paged/engine';
import type { Scenario } from './types';

export type HeadlessMode = 'none' | 'mitigate-only' | 'full';

export interface HeadlessResult {
  mode: HeadlessMode;
  outcome: Outcome;
  stars: Stars;
  t: number;
  stats: GlobalStats;
}

export interface ScenarioCheck {
  id: string;
  results: HeadlessResult[];
  failures: string[];
}

export function runHeadless(sc: Scenario, mode: HeadlessMode): HeadlessResult {
  const sim = createSimulation(sc.sim, { seed: sc.seed });
  const queue = (mode === 'none' ? [] : sc.solution)
    .filter((st) => mode === 'full' || actionCategory(st.action) === 'mitigate')
    .slice()
    .sort((a, b) => a.at - b.at);
  while (sim.outcome() === 'running') {
    while (queue.length > 0 && (queue[0]?.at ?? Infinity) <= sim.time() + 1e-9) {
      const st = queue.shift()!;
      const res = sim.apply({ action: st.action, target: st.target, params: st.params });
      if (!res.ok) {
        throw new Error(`${sc.id}: solution step ${st.action}@${st.at}s on "${st.target}" was rejected: ${res.reason}`);
      }
    }
    sim.tick();
  }
  const stats = sim.stats();
  const stars = scoreRun(
    {
      outcome: sim.outcome(),
      effectiveActions: sim.effectiveActions(),
      budgetFraction: stats.errorBudgetFraction,
      costPerHour: stats.costPerHour,
      cluesUsed: 0,
    },
    sc,
  );
  return { mode, outcome: sim.outcome(), stars, t: sim.time(), stats };
}

export function checkScenario(sc: Scenario): ScenarioCheck {
  const failures: string[] = [];
  const results: HeadlessResult[] = [];
  const attempt = (mode: HeadlessMode): HeadlessResult | null => {
    try {
      const r = runHeadless(sc, mode);
      results.push(r);
      return r;
    } catch (e) {
      failures.push(`${mode}: ${(e as Error).message}`);
      return null;
    }
  };
  const none = attempt('none');
  if (none && none.outcome !== 'lost') failures.push(`none: expected lost, got ${none.outcome} at ${none.t}s`);
  const mit = attempt('mitigate-only');
  if (mit && mit.stars >= 2) failures.push(`mitigate-only: expected < 2 stars, got ${mit.stars}`);
  const full = attempt('full');
  if (full && (full.outcome !== 'won' || full.stars < 2)) {
    failures.push(
      `full: expected won with >= 2 stars, got ${full.outcome} with ${full.stars} at ${full.t}s ` +
        `(availability ${full.stats.availability.toFixed(4)}, p99 ${Math.round(full.stats.worstP99Ms)}ms, ` +
        `budget ${(full.stats.errorBudgetFraction * 100).toFixed(0)}%, cost $${full.stats.costPerHour}/h)`,
    );
  }
  return { id: sc.id, results, failures };
}
