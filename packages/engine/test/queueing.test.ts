import { describe, expect, it } from 'vitest';
import {
  concurrency, expectedRetries, overloadAcceptFraction, p99FromMean,
  poolAcceptFraction, queueLatency, timeoutFraction, utilization,
} from '../src/queueing';

describe('queueing math', () => {
  it('utilization is load over capacity, infinite with no capacity', () => {
    expect(utilization(50, 100)).toBe(0.5);
    expect(utilization(0, 0)).toBe(0);
    expect(utilization(10, 0)).toBe(Infinity);
  });

  it('latency follows the hockey stick and is capped at rho 0.99', () => {
    expect(queueLatency(10, 0)).toBe(10);
    expect(queueLatency(10, 0.5)).toBeCloseTo(20);
    expect(queueLatency(10, 0.9)).toBeCloseTo(100);
    expect(queueLatency(10, 5)).toBeCloseTo(1000);
  });

  it('overload rejects the excess', () => {
    expect(overloadAcceptFraction(0.8)).toBe(1);
    expect(overloadAcceptFraction(2)).toBe(0.5);
    expect(overloadAcceptFraction(Infinity)).toBe(0);
  });

  it('p99 spreads further from the mean as utilization rises', () => {
    expect(p99FromMean(100, 0)).toBe(200);
    expect(p99FromMean(100, 1)).toBe(500);
    expect(p99FromMean(100, 3)).toBe(500);
  });

  it('timeout fraction assumes exponential latency', () => {
    expect(timeoutFraction(0, 1000)).toBe(0);
    expect(timeoutFraction(1000, 1000)).toBeCloseTo(Math.exp(-1));
    expect(timeoutFraction(10, 1000)).toBeLessThan(1e-40);
  });

  it("Little's law concurrency and pool acceptance", () => {
    expect(concurrency(1000, 50)).toBe(50);
    expect(poolAcceptFraction(50, 100)).toBe(1);
    expect(poolAcceptFraction(400, 100)).toBe(0.25);
  });

  it('expected retries per failed request', () => {
    expect(expectedRetries(0, 3)).toBe(1);
    expect(expectedRetries(1, 3)).toBe(3);
    expect(expectedRetries(0.5, 3)).toBeCloseTo(1.75);
    expect(expectedRetries(0.5, 0)).toBe(0);
  });
});
