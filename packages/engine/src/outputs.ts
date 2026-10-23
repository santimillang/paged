import { isCacheLike, type RuntimeNode } from './graph';
import { p99FromMean } from './queueing';
import { getNode, type RuntimeRoute, type SimState } from './state';
import type { Health, NodeMetrics, SimSnapshot, Span, Trace } from './types';

const TICKS_PER_SECOND = 10;
const MAX_TRACES = 50;

export function nodeMetrics(n: RuntimeNode): NodeMetrics {
  const poolCap = n.instances * n.poolSize;
  const m: NodeMetrics = {
    rps: n.readIn + n.writeIn,
    p50Ms: n.latencyMs,
    p99Ms: p99FromMean(n.latencyMs, n.utilization),
    errorRate: 1 - n.accept,
    utilization: Number.isFinite(n.utilization) ? n.utilization : 10,
    poolInUse: poolCap > 0 ? Math.min(1, n.poolNeeded / poolCap) : 0,
  };
  if (isCacheLike(n)) m.hitRatio = n.hitRatio;
  return m;
}

export function healthOf(m: NodeMetrics): Health {
  if (m.errorRate > 0.05 || m.utilization >= 1) return 'crit';
  if (m.errorRate > 0.001 || m.utilization > 0.8 || (m.hitRatio !== undefined && m.hitRatio < 0.5)) return 'warn';
  return 'ok';
}

export function recordOutputs(s: SimState): void {
  emitThresholdLogs(s);
  if (s.tick % TICKS_PER_SECOND !== 0) return;
  for (const n of s.nodes.values()) {
    const m = nodeMetrics(n);
    for (const [k, v] of Object.entries(m)) s.history.record(`${n.id}:${k}`, s.t, v as number);
  }
  const st = s.stats;
  s.history.record('global:availability', s.t, st.availability);
  s.history.record('global:worstP99Ms', s.t, st.worstP99Ms);
  s.history.record('global:errorBudgetRemaining', s.t, st.errorBudgetRemaining);
  s.history.record('global:costPerHour', s.t, st.costPerHour);
  s.history.record('global:usersOnline', s.t, st.usersOnline);
  for (const r of s.routes) s.traces.push(sampleTrace(s, r));
  while (s.traces.length > MAX_TRACES) s.traces.shift();
}

function emitThresholdLogs(s: SimState): void {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  for (const n of s.nodes.values()) {
    const m = nodeMetrics(n);
    if (m.utilization > 0.9) {
      s.logs.add(s.t, { level: 'warn', nodeId: n.id, message: `${n.label}: saturated (${pct(Math.min(m.utilization, 9.99))} utilization)` }, `${n.id}:util`);
    }
    if (m.errorRate > 0.05) {
      s.logs.add(s.t, { level: 'error', nodeId: n.id, message: `${n.label}: ${pct(m.errorRate)} of requests failing` }, `${n.id}:errors`);
    }
    const poolCap = n.instances * n.poolSize;
    if (poolCap > 0 && n.poolNeeded > poolCap) {
      s.logs.add(s.t, { level: 'error', nodeId: n.id, message: `${n.label}: connection pool exhausted (${poolCap}/${poolCap})` }, `${n.id}:pool`);
    }
    if (m.hitRatio !== undefined && m.hitRatio < 0.5) {
      s.logs.add(s.t, { level: 'warn', nodeId: n.id, message: `${n.label}: cache hit ratio ${pct(m.hitRatio)}` }, `${n.id}:hit`);
    }
  }
  for (const r of s.routes) {
    for (let i = 0; i < r.path.length - 1; i++) {
      if ((r.hopTimeout[i] ?? 0) > 0.05) {
        const n = getNode(s, r.path[i] as string);
        const next = r.path[i + 1] as string;
        s.logs.add(s.t, { level: 'error', nodeId: n.id, message: `${n.label}: upstream timeout after ${n.timeoutMs}ms calling ${next}` }, `${n.id}:timeout:${next}`);
      }
    }
  }
}

function sampleTrace(s: SimState, r: RuntimeRoute): Trace {
  const own: number[] = [];
  const failed: boolean[] = [];
  const isRead = s.rng() < r.readRatio;
  for (let i = 0; i < r.path.length; i++) {
    const n = getNode(s, r.path[i] as string);
    own.push(n.latencyMs * -Math.log(1 - s.rng() * 0.999));
    if (s.rng() > (r.hopAccept[i] ?? 1)) {
      failed.push(true);
      break;
    }
    if (i < r.path.length - 1 && s.rng() < (r.hopTimeout[i] ?? 0)) {
      failed.push(true);
      own[i] = (own[i] as number) + n.timeoutMs;
      break;
    }
    failed.push(false);
    if (isRead && isCacheLike(n) && s.rng() < n.hitRatio) break;
  }
  const spans: Span[] = [];
  let start = 0;
  for (let i = 0; i < own.length; i++) {
    const rest = own.slice(i).reduce((a, b) => a + b, 0);
    spans.push({ nodeId: r.path[i] as string, startMs: start, durationMs: rest, error: failed[i] as boolean });
    start += own[i] as number;
  }
  const total = own.reduce((a, b) => a + b, 0);
  return { id: `${r.id}#${s.tick}`, t: s.t, routeId: r.id, durationMs: total, error: failed.some(Boolean), spans };
}

export function snapshotOf(s: SimState): SimSnapshot {
  return {
    t: s.t,
    outcome: s.outcome,
    nodes: [...s.nodes.values()].map((n) => {
      const metrics = nodeMetrics(n);
      return { id: n.id, kind: n.kind, label: n.label, instances: n.instances, health: healthOf(metrics), metrics };
    }),
    edges: s.edges.map((e) => ({ ...e })),
    routes: s.routes.map((r) => ({
      id: r.id, path: [...r.path], offeredRps: r.offered, availability: r.availability, meanMs: r.meanMs, p99Ms: r.p99Ms,
    })),
    stats: { ...s.stats },
    pending: s.pending.map((p) => ({ request: { ...p.request }, effectiveAt: p.effectiveAt })),
  };
}
