import { describe, expect, it } from 'vitest';
import { createState } from '../src/state';
import { step } from '../src/step';
import { node, run, threeTier } from './fixtures';

describe('step: steady state', () => {
  it('a healthy system has full availability and the expected latency', () => {
    const s = createState(threeTier(), 1);
    step(s);
    expect(s.stats.availability).toBeCloseTo(1, 6);
    expect(s.stats.sloHealthy).toBe(true);
    // lb 1/(1-0.005) + api 20/(1-0.5) + db 5/(1-0.1)
    expect(s.routes[0]!.meanMs).toBeCloseTo(1.005 + 40 + 5.556, 1);
    expect(node(s, 'api').utilization).toBeCloseTo(0.5);
  });

  it('wins after holding the SLO when there are no faults', () => {
    const s = createState(threeTier(), 1);
    run(s, 100);
    expect(s.outcome).toBe('won');
    expect(s.t).toBeCloseTo(30, 1);
  });

  it('time is derived from ticks without float drift', () => {
    const s = createState(threeTier(), 1);
    run(s, 12.3);
    expect(s.t).toBe(12.3);
  });

  it('computes cost per hour', () => {
    const s = createState(threeTier(), 1);
    step(s);
    expect(s.stats.costPerHour).toBe(5 + 2 * 10 + 40);
  });
});

describe('review fixes: idle routes', () => {
  it('a route with no traffic does not drive the SLO p99', () => {
    const sc = threeTier({ faults: [{ at: 0, type: 'latency-injection', target: 'db', addMs: 2000 }] });
    sc.routes[0]!.path = ['lb', 'api'];
    sc.routes.push({ id: 'idle', path: ['lb', 'api', 'db'], rps: 0 });
    const s = createState(sc, 1);
    step(s);
    expect(s.stats.sloHealthy).toBe(true);
    expect(s.stats.errorBudgetRemaining).toBe(60);
  });
});

describe('step: overload', () => {
  it('rejects excess load and burns the error budget until lost', () => {
    const s = createState(threeTier({ rps: 2000 }), 1);
    step(s);
    expect(node(s, 'api').accept).toBeCloseTo(0.5);
    expect(s.stats.availability).toBeGreaterThan(0.4);
    expect(s.stats.availability).toBeLessThan(0.55);
    expect(s.stats.sloHealthy).toBe(false);
    run(s, 200);
    expect(s.outcome).toBe('lost');
    expect(s.stats.errorBudgetRemaining).toBe(0);
  });

  it('a slow dependency causes timeouts upstream', () => {
    const s = createState(threeTier({ faults: [{ at: 0, type: 'latency-injection', target: 'db', addMs: 3000 }] }), 1);
    step(s);
    expect(s.stats.availability).toBeLessThan(0.4);
  });

  it('a slow dependency exhausts the caller pool on the next tick (cascade)', () => {
    const s = createState(
      threeTier({
        api: { poolSize: 10 },
        faults: [{ at: 0, type: 'latency-injection', target: 'db', addMs: 2000 }],
      }),
      1,
    );
    step(s);
    step(s);
    const api = node(s, 'api');
    expect(api.utilization).toBeLessThan(1);
    expect(api.accept).toBeLessThan(0.1);
  });

  it('retries amplify load on a struggling dependency', () => {
    const plain = createState(threeTier({ db: { capacityPerInstance: 300 } }), 1);
    const retrying = createState(
      threeTier({
        db: { capacityPerInstance: 300 },
        api: { retryPolicy: { maxRetries: 3, backoff: 'none', jitter: false } },
      }),
      1,
    );
    run(plain, 5);
    run(retrying, 5);
    expect(node(retrying, 'db').readIn).toBeGreaterThan(node(plain, 'db').readIn * 1.5);
  });

  it('a node with zero instances rejects everything without NaN', () => {
    const s = createState(threeTier({ faults: [{ at: 0, type: 'instance-crash', target: 'api', count: 5 }] }), 1);
    step(s);
    expect(node(s, 'api').instances).toBe(0);
    expect(node(s, 'api').accept).toBe(0);
    expect(Number.isFinite(s.stats.availability)).toBe(true);
    expect(s.stats.availability).toBe(0);
    expect(Number.isFinite(s.stats.worstP99Ms)).toBe(true);
  });

  it('is deterministic', () => {
    const a = createState(threeTier({ rps: 1500 }), 9);
    const b = createState(threeTier({ rps: 1500 }), 9);
    run(a, 50);
    run(b, 50);
    expect(JSON.stringify(a.stats)).toBe(JSON.stringify(b.stats));
    expect(JSON.stringify(a.routes)).toBe(JSON.stringify(b.routes));
  });
});
