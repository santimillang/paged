export const MAX_RHO = 0.99;

export function utilization(load: number, capacity: number): number {
  if (capacity <= 0) return load > 0 ? Infinity : 0;
  return load / capacity;
}

/** M/M/1-style mean latency: explodes as utilization approaches 1. */
export function queueLatency(baseMs: number, rho: number): number {
  return baseMs / (1 - Math.min(rho, MAX_RHO));
}

/** Fraction of requests served when offered load exceeds capacity. */
export function overloadAcceptFraction(rho: number): number {
  return rho <= 1 ? 1 : 1 / rho;
}

/** Tail spread grows with utilization: 2x mean when idle, 5x when saturated. */
export function p99FromMean(meanMs: number, rho: number): number {
  return meanMs * (2 + 3 * Math.min(Math.max(rho, 0), 1));
}

/** P(latency > timeout) for an exponential distribution with the given mean. */
export function timeoutFraction(meanDownstreamMs: number, timeoutMs: number): number {
  if (meanDownstreamMs <= 0) return 0;
  return Math.exp(-timeoutMs / meanDownstreamMs);
}

/** Little's law: in-flight requests = arrival rate x time in system. */
export function concurrency(rps: number, latencyMs: number): number {
  return rps * (latencyMs / 1000);
}

export function poolAcceptFraction(needed: number, pool: number): number {
  return needed <= pool ? 1 : pool / needed;
}

/** Expected retry attempts per originally failed request (each retry fails with failRate). */
export function expectedRetries(failRate: number, maxRetries: number): number {
  let total = 0;
  let p = 1;
  for (let i = 0; i < maxRetries; i++) {
    total += p;
    p *= failRate;
  }
  return total;
}
