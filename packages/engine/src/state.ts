import { resolveNode, topoOrder, type RuntimeNode } from './graph';
import { History, LogBook } from './logbook';
import { createRng, type Rng } from './rng';
import type {
  ActionId, ActionLogEntry, EdgeSpec, FaultSpec, GlobalStats, Outcome,
  PendingAction, SimScenario, TrafficPattern, Trace,
} from './types';

export const DT = 0.1;
export const RETRY_HORIZON_TICKS = 40;

export interface RuntimeRoute {
  id: string;
  path: string[];
  rps: number;
  readRatio: number;
  pattern?: TrafficPattern;
  /** retryCarry[hop][k] = extra RPS arriving at hop, k ticks from now. */
  retryCarry: number[][];
  hopRead: number[];
  hopWrite: number[];
  hopAccept: number[];
  /** Fraction of accepted requests at a hop that continue downstream. */
  hopCont: number[];
  /** Fraction of calls from hop i to hop i+1 that time out. */
  hopTimeout: number[];
  /** Probability a single call from hop i to hop i+1 fails. */
  hopCallFail: number[];
  offered: number;
  availability: number;
  meanMs: number;
  p99Ms: number;
}

export interface ActiveFault {
  spec: FaultSpec;
  endsAt: number;
}

export interface AutoscaleLaunch {
  nodeId: string;
  count: number;
  readyAt: number;
}

export interface SimState {
  scenario: SimScenario;
  tick: number;
  t: number;
  nodes: Map<string, RuntimeNode>;
  edges: EdgeSpec[];
  routes: RuntimeRoute[];
  order: string[];
  rng: Rng;
  faultsStarted: boolean[];
  activeFaults: ActiveFault[];
  pending: PendingAction[];
  actionLog: ActionLogEntry[];
  effectiveActions: ActionId[];
  autoscaleQueue: AutoscaleLaunch[];
  budgetRemaining: number;
  userFactor: number;
  healthyStreak: number;
  outcome: Outcome;
  stats: GlobalStats;
  logs: LogBook;
  history: History;
  traces: Trace[];
}

export function newRetryCarry(pathLen: number): number[][] {
  return Array.from({ length: pathLen }, () => new Array<number>(RETRY_HORIZON_TICKS).fill(0));
}

export function createState(scenario: SimScenario, seed: number): SimState {
  const nodes = new Map(scenario.nodes.map((n) => [n.id, resolveNode(n)]));
  const edges = scenario.edges.map((e) => ({ ...e }));
  const routes: RuntimeRoute[] = scenario.routes.map((r) => ({
    id: r.id,
    path: [...r.path],
    rps: r.rps,
    readRatio: r.readRatio ?? 1,
    pattern: r.pattern,
    retryCarry: newRetryCarry(r.path.length),
    hopRead: [], hopWrite: [], hopAccept: [], hopCont: [], hopTimeout: [], hopCallFail: [],
    offered: 0, availability: 1, meanMs: 0, p99Ms: 0,
  }));
  return {
    scenario,
    tick: 0,
    t: 0,
    nodes,
    edges,
    routes,
    order: topoOrder([...nodes.keys()], edges),
    rng: createRng(seed),
    faultsStarted: scenario.faults.map(() => false),
    activeFaults: [],
    pending: [],
    actionLog: [],
    effectiveActions: [],
    autoscaleQueue: [],
    budgetRemaining: scenario.errorBudgetSeconds,
    userFactor: 1,
    healthyStreak: 0,
    outcome: 'running',
    stats: {
      t: 0, availability: 1, worstP99Ms: 0, sloHealthy: true,
      errorBudgetRemaining: scenario.errorBudgetSeconds, errorBudgetFraction: 1,
      usersOnline: scenario.baseUsers ?? 1_000_000, costPerHour: 0,
      healthyForSeconds: 0, holdTargetSeconds: scenario.win.sloHealthyForSeconds,
    },
    logs: new LogBook(),
    history: new History(),
    traces: [],
  };
}

/** Call after any change to nodes/edges/route paths. Resets in-flight retries. */
export function rebuildTopology(s: SimState): void {
  s.order = topoOrder([...s.nodes.keys()], s.edges);
  for (const r of s.routes) r.retryCarry = newRetryCarry(r.path.length);
}

export function getNode(s: SimState, id: string): RuntimeNode {
  const n = s.nodes.get(id);
  if (!n) throw new Error(`unknown node "${id}"`);
  return n;
}
