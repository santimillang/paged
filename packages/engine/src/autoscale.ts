import type { SimState } from './state';

export const AUTOSCALE_INTERVAL = 5;
export const AUTOSCALE_BOOT = 15;
export const AUTOSCALE_MAX_INSTANCES = 100;

export function runAutoscalers(s: SimState): void {
  for (const n of s.nodes.values()) {
    if (n.autoscaleTarget === null || s.t - n.lastAutoscaleCheck < AUTOSCALE_INTERVAL - 1e-6) continue;
    n.lastAutoscaleCheck = s.t;
    const raw = Math.ceil((n.instances * n.utilization) / n.autoscaleTarget);
    const desired = Math.min(AUTOSCALE_MAX_INSTANCES, Number.isFinite(raw) && n.instances > 0 ? raw : n.instances + 1);
    const add = desired - (n.instances + n.pendingAutoscale);
    if (add <= 0) continue;
    n.pendingAutoscale += add;
    s.autoscaleQueue.push({ nodeId: n.id, count: add, readyAt: Math.round((s.t + AUTOSCALE_BOOT) * 1000) / 1000 });
    s.logs.add(s.t, { level: 'info', nodeId: n.id, message: `${n.label}: autoscaler launching ${add} instance(s)` });
  }
  const ready = s.autoscaleQueue.filter((q) => q.readyAt <= s.t + 1e-9);
  if (ready.length === 0) return;
  s.autoscaleQueue = s.autoscaleQueue.filter((q) => q.readyAt > s.t + 1e-9);
  for (const q of ready) {
    const n = s.nodes.get(q.nodeId);
    if (!n) continue;
    n.instances += q.count;
    n.pendingAutoscale -= q.count;
  }
}
