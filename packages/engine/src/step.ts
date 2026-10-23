import { injectedLatency, startDueFaults, trafficMultiplier } from './faults';
import { isCacheLike, type RuntimeNode } from './graph';
import {
  concurrency, expectedRetries, overloadAcceptFraction, p99FromMean,
  poolAcceptFraction, queueLatency, timeoutFraction, utilization,
} from './queueing';
import { DT, getNode, type RuntimeRoute, type SimState } from './state';
import { patternMultiplier } from './traffic';

/** Share of cache misses that still hit the backend when coalescing is on. */
export const COALESCE_FACTOR = 0.2;
/** Error-budget seconds burned per second while p99 breaches the SLO. */
export const LATENCY_BURN = 0.25;
/** Retries with exponential backoff and no jitter all land this many ticks later. */
export const SYNC_RETRY_DELAY_TICKS = 10;
/** Jittered retries spread evenly over this many ticks. */
export const JITTER_SPREAD_TICKS = 20;

export function step(s: SimState): void {
  s.tick += 1;
  s.t = Math.round(s.tick * DT * 1000) / 1000;
  startDueFaults(s);
  computeFlows(s);
  computeLatencyAndSuccess(s);
  scheduleRetries(s);
  warmCaches(s);
  updateStats(s);
}

function computeFlows(s: SimState): void {
  for (const n of s.nodes.values()) {
    n.readIn = 0;
    n.writeIn = 0;
  }
  for (const r of s.routes) {
    const len = r.path.length;
    r.hopRead = new Array<number>(len).fill(0);
    r.hopWrite = new Array<number>(len).fill(0);
    r.hopAccept = new Array<number>(len).fill(1);
    r.hopCont = new Array<number>(len).fill(1);
    r.hopTimeout = new Array<number>(len).fill(0);
    r.hopCallFail = new Array<number>(len).fill(0);
    for (let i = 0; i < len; i++) {
      const carry = r.retryCarry[i] as number[];
      const retry = carry.shift() ?? 0;
      carry.push(0);
      r.hopRead[i] += retry * r.readRatio;
      r.hopWrite[i] += retry * (1 - r.readRatio);
    }
    const fresh = r.rps * patternMultiplier(r.pattern, s.t) * trafficMultiplier(s, r.id);
    r.offered = fresh;
    r.hopRead[0] += fresh * r.readRatio;
    r.hopWrite[0] += fresh * (1 - r.readRatio);
  }

  const visits = new Map<string, Array<[RuntimeRoute, number]>>();
  for (const r of s.routes) {
    r.path.forEach((id, i) => {
      const v = visits.get(id) ?? [];
      v.push([r, i]);
      visits.set(id, v);
    });
  }

  for (const id of s.order) {
    const n = getNode(s, id);
    const v = visits.get(id) ?? [];
    for (const [r, i] of v) {
      n.readIn += r.hopRead[i] as number;
      n.writeIn += r.hopWrite[i] as number;
    }
    const accept = computeAcceptance(n);
    for (const [r, i] of v) {
      r.hopAccept[i] = accept;
      if (i === r.path.length - 1) {
        r.hopCont[i] = 0;
        continue;
      }
      const read = (r.hopRead[i] as number) * accept;
      const write = (r.hopWrite[i] as number) * accept;
      const cache = isCacheLike(n);
      const missRead = cache ? read * (1 - n.hitRatio) : read;
      const total = read + write;
      r.hopCont[i] = total > 0
        ? (missRead + write) / total
        : cache ? r.readRatio * (1 - n.hitRatio) + (1 - r.readRatio) : 1;
      const loadFactor = cache && n.coalescing ? COALESCE_FACTOR : 1;
      r.hopRead[i + 1] = (r.hopRead[i + 1] as number) + missRead * loadFactor;
      r.hopWrite[i + 1] = (r.hopWrite[i + 1] as number) + write;
    }
  }
}

/** Sets n.utilization, n.accept, n.acceptNoPool from this tick's inflow. */
export function computeAcceptance(n: RuntimeNode): number {
  const inflow = n.readIn + n.writeIn;
  const inst = n.instances;
  if (inflow <= 0) {
    n.utilization = 0;
    n.acceptNoPool = inst > 0 ? 1 - n.deployErrorRate : 0;
    n.accept = n.acceptNoPool;
    return n.accept;
  }
  const shed = 1 - n.shedFraction;
  const limit = n.rateLimitRps !== null && inflow * shed > 0 ? Math.min(1, n.rateLimitRps / (inflow * shed)) : 1;
  const pass = shed * limit;
  const readCap = inst * n.capacityPerInstance * (1 + n.readReplicas);
  const writeCap = inst * n.writeCapacityPerInstance;
  const rho = utilization(n.readIn * pass, readCap) + utilization(n.writeIn * pass, writeCap);

  let overloadAccept: number;
  let reportedRho: number;
  if (n.partitioned && n.hotKeyShare > 0 && inst > 1 && Number.isFinite(rho)) {
    const hot = n.hotKeyShare + (1 - n.hotKeyShare) / inst;
    const rhoHot = rho * hot * inst;
    const rhoRest = (rho * (1 - hot) * inst) / (inst - 1);
    overloadAccept = hot * overloadAcceptFraction(rhoHot) + (1 - hot) * overloadAcceptFraction(rhoRest);
    reportedRho = Math.max(rhoHot, rhoRest);
  } else {
    overloadAccept = overloadAcceptFraction(rho);
    reportedRho = rho;
  }
  n.utilization = reportedRho;
  n.acceptNoPool = pass * overloadAccept * (1 - n.deployErrorRate);
  n.accept = n.acceptNoPool * poolAcceptFraction(n.poolNeeded, inst * n.poolSize);
  return n.accept;
}

function computeLatencyAndSuccess(s: SimState): void {
  for (const n of s.nodes.values()) {
    n.addedLatencyMs = injectedLatency(s, n.id);
    n.latencyMs = queueLatency(n.baseLatencyMs, n.utilization) + n.addedLatencyMs;
    n.poolNeeded = 0;
  }
  for (const r of s.routes) {
    const len = r.path.length;
    const down = new Array<number>(len).fill(0);
    const succ = new Array<number>(len).fill(0);
    let maxRho = 0;
    for (let i = len - 1; i >= 0; i--) {
      const n = getNode(s, r.path[i] as string);
      maxRho = Math.max(maxRho, Math.min(1, n.utilization));
      const accept = r.hopAccept[i] as number;
      if (i === len - 1) {
        down[i] = n.latencyMs;
        succ[i] = accept;
        continue;
      }
      const cont = r.hopCont[i] as number;
      const calleeMs = down[i + 1] as number;
      const tf = timeoutFraction(calleeMs, n.timeoutMs);
      const callFail = 1 - (succ[i + 1] as number) * (1 - tf);
      const failAfterRetries = Math.pow(callFail, 1 + n.retryPolicy.maxRetries);
      const waitMs = Math.min(calleeMs, n.timeoutMs);
      r.hopTimeout[i] = tf;
      r.hopCallFail[i] = callFail;
      down[i] = n.latencyMs + cont * waitMs;
      succ[i] = accept * (1 - cont + cont * (1 - failAfterRetries));
      const demandOut = ((r.hopRead[i] as number) + (r.hopWrite[i] as number)) * n.acceptNoPool * cont;
      n.poolNeeded += concurrency(demandOut, waitMs);
    }
    r.availability = succ[0] as number;
    r.meanMs = down[0] as number;
    r.p99Ms = p99FromMean(r.meanMs, maxRho);
  }
}

function scheduleRetries(s: SimState): void {
  for (const r of s.routes) {
    for (let i = 0; i < r.path.length - 1; i++) {
      const n = getNode(s, r.path[i] as string);
      const policy = n.retryPolicy;
      if (policy.maxRetries === 0) continue;
      const out = ((r.hopRead[i] as number) + (r.hopWrite[i] as number)) * (r.hopAccept[i] as number) * (r.hopCont[i] as number);
      const f = r.hopCallFail[i] as number;
      const retryRps = out * f * expectedRetries(f, policy.maxRetries);
      if (retryRps <= 0) continue;
      const carry = r.retryCarry[i + 1] as number[];
      if (policy.backoff === 'none') {
        carry[0] = (carry[0] as number) + retryRps;
      } else if (!policy.jitter) {
        carry[SYNC_RETRY_DELAY_TICKS] = (carry[SYNC_RETRY_DELAY_TICKS] as number) + retryRps;
      } else {
        for (let k = 0; k < JITTER_SPREAD_TICKS; k++) carry[k] = (carry[k] as number) + retryRps / JITTER_SPREAD_TICKS;
      }
    }
  }
}

function warmCaches(s: SimState): void {
  for (const n of s.nodes.values()) {
    if (isCacheLike(n)) n.hitRatio = Math.min(n.targetHitRatio, n.hitRatio + n.warmRatePerSec * DT);
  }
}

export function costPerHour(s: SimState): number {
  let c = 0;
  for (const n of s.nodes.values()) c += n.instances * n.costPerInstanceHour * (1 + n.readReplicas);
  return c;
}

function updateStats(s: SimState): void {
  const slo = s.scenario.slo;
  let offered = 0;
  let good = 0;
  let worst = 0;
  for (const r of s.routes) {
    offered += r.offered;
    good += r.offered * r.availability;
    worst = Math.max(worst, r.p99Ms);
  }
  const availability = offered > 0 ? good / offered : 1;
  const allowed = 1 - slo.availability / 100;
  const errorRate = 1 - availability;
  const latencyBad = worst > slo.p99Ms;
  const healthy = errorRate <= allowed + 1e-12 && !latencyBad;
  const burn = Math.max(0, errorRate - allowed) + (latencyBad ? LATENCY_BURN : 0);
  s.budgetRemaining = Math.max(0, s.budgetRemaining - burn * DT);
  s.userFactor = healthy ? Math.min(1, s.userFactor + 0.001 * DT) : Math.max(0.2, s.userFactor - 0.003 * DT);
  const allFaultsStarted = s.faultsStarted.every(Boolean);
  s.healthyStreak = healthy && allFaultsStarted ? s.healthyStreak + DT : 0;
  s.stats = {
    t: s.t,
    availability,
    worstP99Ms: worst,
    sloHealthy: healthy,
    errorBudgetRemaining: s.budgetRemaining,
    errorBudgetFraction: s.budgetRemaining / s.scenario.errorBudgetSeconds,
    usersOnline: Math.round((s.scenario.baseUsers ?? 1_000_000) * s.userFactor),
    costPerHour: costPerHour(s),
  };
  if (s.budgetRemaining <= 0 || s.t >= (s.scenario.timeLimitSeconds ?? 600) - 1e-9) {
    s.outcome = 'lost';
  } else if (allFaultsStarted && s.healthyStreak >= s.scenario.win.sloHealthyForSeconds - 1e-9) {
    s.outcome = 'won';
  }
}
