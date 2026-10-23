import { requestAction } from './actions';
import { validateSimScenario } from './graph';
import { snapshotOf } from './outputs';
import { createState } from './state';
import { step } from './step';
import type {
  ActionId, ActionLogEntry, ActionRequest, ApplyResult, GlobalStats, LogEntry,
  Outcome, Series, SimScenario, SimSnapshot, Trace,
} from './types';

export interface Simulation {
  tick(n?: number): void;
  time(): number;
  outcome(): Outcome;
  stats(): GlobalStats;
  apply(req: ActionRequest): ApplyResult;
  snapshot(): SimSnapshot;
  history(key: string): Series;
  logs(sinceT?: number): LogEntry[];
  traces(): Trace[];
  actionLog(): ActionLogEntry[];
  effectiveActions(): ActionId[];
}

export function createSimulation(scenario: SimScenario, opts: { seed: number }): Simulation {
  const errors = validateSimScenario(scenario);
  if (errors.length > 0) throw new Error(`invalid scenario:\n- ${errors.join('\n- ')}`);
  const s = createState(scenario, opts.seed);
  return {
    tick(n = 1) {
      for (let i = 0; i < n && s.outcome === 'running'; i++) step(s);
    },
    time: () => s.t,
    outcome: () => s.outcome,
    stats: () => ({ ...s.stats }),
    apply: (req) => requestAction(s, req),
    snapshot: () => snapshotOf(s),
    history: (key) => s.history.get(key),
    logs: (sinceT = 0) => s.logs.since(sinceT),
    traces: () => s.traces.map((t) => ({ ...t, spans: t.spans.map((sp) => ({ ...sp })) })),
    actionLog: () => s.actionLog.map((a) => ({ ...a, request: { ...a.request } })),
    effectiveActions: () => [...s.effectiveActions],
  };
}
