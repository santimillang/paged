import type { FaultSpec, NodeSpec, SimScenario } from '../src/types';
import { createState, type SimState } from '../src/state';
import { step } from '../src/step';

interface Opts {
  rps?: number;
  readRatio?: number;
  faults?: FaultSpec[];
  api?: Partial<NodeSpec>;
  db?: Partial<NodeSpec>;
}

/** lb -> api -> db. Healthy at defaults (api rho 0.5, db rho 0.1). */
export function threeTier(o: Opts = {}): SimScenario {
  return {
    nodes: [
      { id: 'lb', kind: 'lb', baseLatencyMs: 1, timeoutMs: 5000, costPerInstanceHour: 5 },
      { id: 'api', kind: 'service', instances: 2, capacityPerInstance: 500, baseLatencyMs: 20, costPerInstanceHour: 10, ...o.api },
      { id: 'db', kind: 'db', capacityPerInstance: 5000, baseLatencyMs: 5, costPerInstanceHour: 40, ...o.db },
    ] as NodeSpec[],
    edges: [{ from: 'lb', to: 'api' }, { from: 'api', to: 'db' }],
    routes: [{ id: 'GET /', path: ['lb', 'api', 'db'], rps: o.rps ?? 500, readRatio: o.readRatio ?? 1 }],
    faults: o.faults ?? [],
    slo: { availability: 99.9, p99Ms: 800 },
    errorBudgetSeconds: 60,
    win: { sloHealthyForSeconds: 30 },
  };
}

/** lb -> api -> cache -> db. */
export function withCache(o: Opts & { cache?: Partial<NodeSpec> } = {}): SimScenario {
  return {
    nodes: [
      { id: 'lb', kind: 'lb', baseLatencyMs: 1, timeoutMs: 5000 },
      { id: 'api', kind: 'service', instances: 4, capacityPerInstance: 500, baseLatencyMs: 20, ...o.api },
      { id: 'cache', kind: 'cache', instances: 2, capacityPerInstance: 20000, baseLatencyMs: 1, hitRatio: 0.9, ...o.cache },
      { id: 'db', kind: 'db', capacityPerInstance: 5000, baseLatencyMs: 5, ...o.db },
    ] as NodeSpec[],
    edges: [{ from: 'lb', to: 'api' }, { from: 'api', to: 'cache' }, { from: 'cache', to: 'db' }],
    routes: [{ id: 'GET /', path: ['lb', 'api', 'cache', 'db'], rps: o.rps ?? 500, readRatio: o.readRatio ?? 1 }],
    faults: o.faults ?? [],
    slo: { availability: 99.9, p99Ms: 800 },
    errorBudgetSeconds: 60,
    win: { sloHealthyForSeconds: 30 },
  };
}

export function run(s: SimState, seconds: number): void {
  const ticks = Math.round(seconds * 10);
  for (let i = 0; i < ticks && s.outcome === 'running'; i++) step(s);
}

export const node = (s: SimState, id: string) => {
  const n = s.nodes.get(id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
};
