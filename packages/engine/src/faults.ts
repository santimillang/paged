import { getNode, type SimState } from './state';
import type { FaultSpec, LogEntry } from './types';

export function startDueFaults(s: SimState): void {
  s.scenario.faults.forEach((f, i) => {
    if (s.faultsStarted[i] || s.t < f.at - 1e-9) return;
    s.faultsStarted[i] = true;
    const duration = 'durationSec' in f && f.durationSec !== undefined ? f.durationSec : Infinity;
    s.activeFaults.push({ spec: f, endsAt: f.at + duration });
    applyFaultStart(s, f);
    s.logs.add(s.t, faultLog(f));
  });
  s.activeFaults = s.activeFaults.filter((a) => a.endsAt > s.t + 1e-9);
}

function applyFaultStart(s: SimState, f: FaultSpec): void {
  switch (f.type) {
    case 'bad-deploy':
      getNode(s, f.target).deployErrorRate = f.errorRate;
      break;
    case 'instance-crash': {
      const n = getNode(s, f.target);
      n.instances = Math.max(0, n.instances - f.count);
      break;
    }
    case 'cache-flush':
      getNode(s, f.target).hitRatio = 0;
      break;
    case 'hot-key':
      getNode(s, f.target).hotKeyShare = f.share;
      break;
    case 'traffic-spike':
    case 'latency-injection':
      break; // applied every tick from activeFaults
  }
}

export function trafficMultiplier(s: SimState, routeId: string): number {
  let m = 1;
  for (const a of s.activeFaults) {
    if (a.spec.type === 'traffic-spike' && (a.spec.route === undefined || a.spec.route === routeId)) {
      m *= a.spec.multiplier;
    }
  }
  return m;
}

export function injectedLatency(s: SimState, nodeId: string): number {
  let ms = 0;
  for (const a of s.activeFaults) {
    if (a.spec.type === 'latency-injection' && a.spec.target === nodeId) ms += a.spec.addMs;
  }
  return ms;
}

function faultLog(f: FaultSpec): Omit<LogEntry, 't'> {
  switch (f.type) {
    case 'traffic-spike':
      return { level: 'warn', message: `Traffic surge: ${f.multiplier}x normal load${f.route ? ` on ${f.route}` : ''}` };
    case 'latency-injection':
      return { level: 'warn', nodeId: f.target, message: `${f.target}: responses slowing down` };
    case 'bad-deploy':
      return { level: 'info', nodeId: f.target, message: `${f.target}: new version deployed` };
    case 'instance-crash':
      return { level: 'error', nodeId: f.target, message: `${f.target}: ${f.count} instance(s) terminated unexpectedly` };
    case 'cache-flush':
      return { level: 'warn', nodeId: f.target, message: `${f.target}: restarted, all keys evicted` };
    case 'hot-key':
      return { level: 'warn', nodeId: f.target, message: `${f.target}: uneven key access detected` };
  }
}
