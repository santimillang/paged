import { insertBefore, isCacheLike, resolveNode, uniqueId, type RuntimeNode } from './graph';
import { getNode, rebuildTopology, type SimState } from './state';
import type { ActionCategory, ActionId, ActionParams, ActionRequest, ApplyResult, NodeKind } from './types';

export interface ActionDef {
  id: ActionId;
  category: ActionCategory;
  label: string;
  description: string;
  targetKinds: NodeKind[];
  delaySec: number;
  validate?: (s: SimState, target: RuntimeNode, params: ActionParams) => string | null;
  effect: (s: SimState, target: RuntimeNode, params: ActionParams) => void;
}

const num = (p: ActionParams, k: string, d: number): number => (typeof p[k] === 'number' ? (p[k] as number) : d);
const bool = (p: ActionParams, k: string, d: boolean): boolean => (typeof p[k] === 'boolean' ? (p[k] as boolean) : d);
const str = (p: ActionParams, k: string, d: string): string => (typeof p[k] === 'string' ? (p[k] as string) : d);

const isEntry = (s: SimState, id: string): boolean => s.routes.some((r) => r.path[0] === id);
const hasCacheInFront = (s: SimState, id: string): boolean =>
  s.edges.some((e) => e.to === id && isCacheLike(getNode(s, e.from)));

export const ACTIONS: Record<ActionId, ActionDef> = {
  scale: {
    id: 'scale', category: 'mitigate', label: 'Scale',
    description: 'Add or remove instances. New instances take 30s to boot.',
    targetKinds: ['lb', 'service', 'cache', 'worker'], delaySec: 30,
    validate: (_s, n, p) => {
      const d = num(p, 'delta', 1);
      if (!Number.isInteger(d) || d === 0) return 'delta must be a non-zero whole number';
      if (n.instances + d < 1) return 'cannot scale below 1 instance';
      return null;
    },
    effect: (_s, n, p) => {
      n.instances = Math.max(1, n.instances + num(p, 'delta', 1));
    },
  },
  'shed-load': {
    id: 'shed-load', category: 'mitigate', label: 'Shed load',
    description: 'Reject a share of incoming requests immediately to protect the rest. 0 turns it off.',
    targetKinds: ['lb', 'service'], delaySec: 2,
    validate: (_s, _n, p) => {
      const v = num(p, 'percent', 20);
      return v < 0 || v > 90 ? 'percent must be between 0 and 90' : null;
    },
    effect: (_s, n, p) => {
      n.shedFraction = num(p, 'percent', 20) / 100;
    },
  },
  'rate-limit': {
    id: 'rate-limit', category: 'mitigate', label: 'Rate limit',
    description: 'Cap requests per second; the excess is rejected fast. 0 removes the limit.',
    targetKinds: ['lb', 'service'], delaySec: 5,
    validate: (_s, _n, p) => (num(p, 'rps', 0) < 0 ? 'rps must be 0 or more' : null),
    effect: (_s, n, p) => {
      const rps = num(p, 'rps', 0);
      n.rateLimitRps = rps > 0 ? rps : null;
    },
  },
  rollback: {
    id: 'rollback', category: 'mitigate', label: 'Roll back',
    description: 'Revert to the previous version. Takes 20s.',
    targetKinds: ['service', 'worker'], delaySec: 20,
    effect: (_s, n) => {
      n.deployErrorRate = 0;
    },
  },
  'enable-autoscaling': {
    id: 'enable-autoscaling', category: 'design', label: 'Autoscaling',
    description: 'Add instances automatically when utilization goes above a target.',
    targetKinds: ['service', 'worker'], delaySec: 10,
    validate: (_s, _n, p) => {
      const v = num(p, 'targetUtilization', 0.6);
      return v < 0.3 || v > 0.9 ? 'targetUtilization must be between 0.3 and 0.9' : null;
    },
    effect: (s, n, p) => {
      n.autoscaleTarget = num(p, 'targetUtilization', 0.6);
      n.lastAutoscaleCheck = s.t;
    },
  },
  'add-cache': {
    id: 'add-cache', category: 'design', label: 'Add cache',
    description: 'Put a cache in front of this component. It starts cold and warms up.',
    targetKinds: ['db', 'service', 'external'], delaySec: 20,
    validate: (s, n) => (hasCacheInFront(s, n.id) ? `${n.id} already has a cache in front of it` : null),
    effect: (s, n, p) => {
      const c = resolveNode({
        id: uniqueId(s.nodes, `${n.id}-cache`), kind: 'cache', label: `${n.label} cache`,
        instances: 2, capacityPerInstance: 20_000, baseLatencyMs: 1, costPerInstanceHour: 15,
        hitRatio: num(p, 'hitRatio', 0.9), warmRatePerSec: 0.02,
      });
      c.hitRatio = 0;
      insertBefore(s, n.id, c);
      rebuildTopology(s);
    },
  },
  'add-read-replica': {
    id: 'add-read-replica', category: 'design', label: 'Add read replica',
    description: 'A copy of the database that serves reads. Writes still go to the primary.',
    targetKinds: ['db'], delaySec: 30,
    effect: (_s, n) => {
      n.readReplicas += 1;
    },
  },
  'add-cdn': {
    id: 'add-cdn', category: 'design', label: 'Add CDN',
    description: 'Serve cacheable reads from the edge, before traffic reaches you.',
    targetKinds: ['lb', 'service'], delaySec: 30,
    validate: (s, n) => {
      if (!isEntry(s, n.id)) return 'a CDN goes in front of an entry point (the first hop of a route)';
      if (hasCacheInFront(s, n.id)) return `${n.id} already has a cache in front of it`;
      return null;
    },
    effect: (s, n, p) => {
      const c = resolveNode({
        id: uniqueId(s.nodes, 'cdn'), kind: 'cdn', label: 'CDN',
        instances: 1, capacityPerInstance: 1_000_000, baseLatencyMs: 2, costPerInstanceHour: 50,
        hitRatio: num(p, 'hitRatio', 0.95), warmRatePerSec: 0.05,
      });
      c.hitRatio = 0;
      insertBefore(s, n.id, c);
      rebuildTopology(s);
    },
  },
  'set-retry-policy': {
    id: 'set-retry-policy', category: 'design', label: 'Retry policy',
    description: 'Change how this component retries failed calls.',
    targetKinds: ['lb', 'service', 'worker'], delaySec: 5,
    validate: (_s, _n, p) => {
      const m = num(p, 'maxRetries', 2);
      if (!Number.isInteger(m) || m < 0 || m > 5) return 'maxRetries must be a whole number from 0 to 5';
      const b = str(p, 'backoff', 'exponential');
      return b === 'none' || b === 'exponential' ? null : 'backoff must be "none" or "exponential"';
    },
    effect: (_s, n, p) => {
      n.retryPolicy = {
        maxRetries: num(p, 'maxRetries', 2),
        backoff: str(p, 'backoff', 'exponential') as 'none' | 'exponential',
        jitter: bool(p, 'jitter', true),
      };
    },
  },
  'request-coalescing': {
    id: 'request-coalescing', category: 'design', label: 'Request coalescing',
    description: 'Collapse concurrent misses for the same key into one backend fetch.',
    targetKinds: ['cache', 'cdn'], delaySec: 10,
    effect: (_s, n) => {
      n.coalescing = true;
    },
  },
  'cache-warming': {
    id: 'cache-warming', category: 'design', label: 'Cache warming',
    description: 'Pre-load hot keys so the cache recovers quickly after a restart.',
    targetKinds: ['cache', 'cdn'], delaySec: 10,
    effect: (_s, n) => {
      n.warmRatePerSec = Math.max(n.warmRatePerSec, 0.2);
    },
  },
};

export const actionCategory = (id: ActionId): ActionCategory => ACTIONS[id].category;

export function requestAction(s: SimState, req: ActionRequest): ApplyResult {
  if (s.outcome !== 'running') return { ok: false, reason: 'the incident is over' };
  const def = ACTIONS[req.action];
  if (!def) return { ok: false, reason: `unknown action "${String(req.action)}"` };
  const n = s.nodes.get(req.target);
  if (!n) return { ok: false, reason: `unknown component "${req.target}"` };
  if (!def.targetKinds.includes(n.kind)) return { ok: false, reason: `${def.label} can't target a ${n.kind}` };
  if (s.pending.some((p) => p.request.action === req.action && p.request.target === req.target)) {
    return { ok: false, reason: `${def.label} is already in progress on ${n.id}` };
  }
  const params = req.params ?? {};
  const err = def.validate?.(s, n, params) ?? null;
  if (err) return { ok: false, reason: err };
  const effectiveAt = Math.round((s.t + def.delaySec) * 1000) / 1000;
  s.pending.push({ request: req, effectiveAt });
  s.actionLog.push({ t: s.t, request: req, status: 'scheduled' });
  s.logs.add(s.t, { level: 'info', nodeId: n.id, message: `${def.label} requested on ${n.label} (ready in ${def.delaySec}s)` });
  return { ok: true, effectiveAt };
}

export function applyDueActions(s: SimState): void {
  const due = s.pending.filter((p) => p.effectiveAt <= s.t + 1e-9);
  if (due.length === 0) return;
  s.pending = s.pending.filter((p) => p.effectiveAt > s.t + 1e-9);
  for (const p of due) {
    const n = s.nodes.get(p.request.target);
    if (!n) continue;
    const def = ACTIONS[p.request.action];
    def.effect(s, n, p.request.params ?? {});
    s.actionLog.push({ t: s.t, request: p.request, status: 'effective' });
    s.effectiveActions.push(p.request.action);
    s.logs.add(s.t, { level: 'info', nodeId: n.id, message: `${def.label} applied to ${n.label}` });
  }
}
