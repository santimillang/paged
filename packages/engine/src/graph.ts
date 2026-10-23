import type { EdgeSpec, NodeKind, NodeSpec, RetryPolicy, SimScenario } from './types';

export interface RuntimeNode {
  id: string;
  kind: NodeKind;
  label: string;
  instances: number;
  capacityPerInstance: number;
  writeCapacityPerInstance: number;
  baseLatencyMs: number;
  timeoutMs: number;
  poolSize: number;
  retryPolicy: RetryPolicy;
  costPerInstanceHour: number;
  hitRatio: number;
  targetHitRatio: number;
  warmRatePerSec: number;
  partitioned: boolean;
  readReplicas: number;
  // modifiers set by faults and actions
  addedLatencyMs: number;
  deployErrorRate: number;
  hotKeyShare: number;
  shedFraction: number;
  rateLimitRps: number | null;
  coalescing: boolean;
  autoscaleTarget: number | null;
  pendingAutoscale: number;
  lastAutoscaleCheck: number;
  // recomputed every tick
  readIn: number;
  writeIn: number;
  utilization: number;
  accept: number;
  acceptNoPool: number;
  latencyMs: number;
  poolNeeded: number;
}

const NO_RETRY: RetryPolicy = { maxRetries: 0, backoff: 'none', jitter: false };

const DEFAULT_CAPACITY: Record<NodeKind, number> = {
  client: 1e9, cdn: 1e6, lb: 1e5, service: 500, cache: 20_000,
  db: 2_000, queue: 1e5, worker: 200, external: 1_000,
};

const DEFAULT_POOL: Partial<Record<NodeKind, number>> = { lb: 10_000, cdn: 1e6, client: 1e9 };

export const isCacheLike = (n: { kind: NodeKind }): boolean => n.kind === 'cache' || n.kind === 'cdn';

export function resolveNode(spec: NodeSpec): RuntimeNode {
  const cap = spec.capacityPerInstance ?? DEFAULT_CAPACITY[spec.kind];
  const hit = isCacheLike(spec) ? spec.hitRatio ?? 0.9 : 0;
  const base = spec.baseLatencyMs ?? 5;
  return {
    id: spec.id,
    kind: spec.kind,
    label: spec.label ?? spec.id,
    instances: spec.instances ?? 1,
    capacityPerInstance: cap,
    writeCapacityPerInstance: spec.writeCapacityPerInstance ?? cap,
    baseLatencyMs: base,
    timeoutMs: spec.timeoutMs ?? 1000,
    poolSize: spec.poolSize ?? DEFAULT_POOL[spec.kind] ?? 200,
    retryPolicy: spec.retryPolicy ?? NO_RETRY,
    costPerInstanceHour: spec.costPerInstanceHour ?? 0,
    hitRatio: hit,
    targetHitRatio: hit,
    warmRatePerSec: spec.warmRatePerSec ?? 0.02,
    partitioned: spec.partitioned ?? false,
    readReplicas: 0,
    addedLatencyMs: 0,
    deployErrorRate: 0,
    hotKeyShare: 0,
    shedFraction: 0,
    rateLimitRps: null,
    coalescing: false,
    autoscaleTarget: null,
    pendingAutoscale: 0,
    lastAutoscaleCheck: 0,
    readIn: 0,
    writeIn: 0,
    utilization: 0,
    accept: 1,
    acceptNoPool: 1,
    latencyMs: base,
    poolNeeded: 0,
  };
}

export function topoOrder(ids: string[], edges: EdgeSpec[]): string[] {
  const indeg = new Map(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    out.get(e.from)?.push(e.to);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const next of out.get(id) ?? []) {
      const d = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (order.length !== ids.length) throw new Error('graph has a cycle');
  return order;
}

export function validateSimScenario(s: SimScenario): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const n of s.nodes) {
    if (ids.has(n.id)) errors.push(`duplicate node id "${n.id}"`);
    ids.add(n.id);
  }
  const edgeKeys = new Set<string>();
  for (const e of s.edges) {
    for (const end of [e.from, e.to]) {
      if (!ids.has(end)) errors.push(`edge ${e.from}->${e.to} references unknown node "${end}"`);
    }
    edgeKeys.add(`${e.from}->${e.to}`);
  }
  const routeIds = new Set<string>();
  for (const r of s.routes) {
    routeIds.add(r.id);
    if (r.path.length === 0) errors.push(`route "${r.id}" has an empty path`);
    r.path.forEach((id, i) => {
      if (!ids.has(id)) errors.push(`route "${r.id}" references unknown node "${id}"`);
      const prev = r.path[i - 1];
      if (prev !== undefined && !edgeKeys.has(`${prev}->${id}`)) {
        errors.push(`route "${r.id}" uses missing edge ${prev}->${id}`);
      }
    });
    const ratio = r.readRatio ?? 1;
    if (ratio < 0 || ratio > 1) errors.push(`route "${r.id}" readRatio must be between 0 and 1`);
  }
  for (const f of s.faults) {
    if ('target' in f && !ids.has(f.target)) {
      errors.push(`fault ${f.type}@${f.at}s targets unknown node "${f.target}"`);
    }
    if (f.type === 'traffic-spike' && f.route !== undefined && !routeIds.has(f.route)) {
      errors.push(`fault traffic-spike@${f.at}s targets unknown route "${f.route}"`);
    }
  }
  if (errors.length === 0) {
    try {
      topoOrder([...ids], s.edges);
    } catch {
      errors.push('graph has a cycle');
    }
  }
  return errors;
}

export function uniqueId(nodes: Map<string, unknown>, base: string): string {
  let id = base;
  let n = 2;
  while (nodes.has(id)) id = `${base}-${n++}`;
  return id;
}

/** Put `node` in front of `targetId`: callers of target now call node, node calls target. */
export function insertBefore(
  g: { nodes: Map<string, RuntimeNode>; edges: EdgeSpec[]; routes: { path: string[] }[] },
  targetId: string,
  node: RuntimeNode,
): void {
  g.nodes.set(node.id, node);
  for (const e of g.edges) if (e.to === targetId) e.to = node.id;
  g.edges.push({ from: node.id, to: targetId });
  for (const r of g.routes) {
    const i = r.path.indexOf(targetId);
    if (i >= 0) r.path.splice(i, 0, node.id);
  }
}
