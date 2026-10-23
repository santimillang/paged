import { describe, expect, it } from 'vitest';
import { createState } from '../src/state';
import { step } from '../src/step';
import { node, run, threeTier, withCache } from './fixtures';

describe('faults', () => {
  it('traffic-spike multiplies offered load, and expires', () => {
    const s = createState(threeTier({ faults: [{ at: 1, type: 'traffic-spike', multiplier: 3, durationSec: 5 }] }), 1);
    run(s, 2);
    expect(s.routes[0]!.offered).toBeCloseTo(1500);
    run(s, 5);
    expect(s.routes[0]!.offered).toBeCloseTo(500);
  });

  it('traffic-spike can target one route', () => {
    const sc = threeTier({ faults: [{ at: 0, type: 'traffic-spike', route: 'other', multiplier: 4 }] });
    sc.routes.push({ id: 'other', path: ['lb', 'api'], rps: 100 });
    const s = createState(sc, 1);
    step(s);
    expect(s.routes[0]!.offered).toBeCloseTo(500);
    expect(s.routes[1]!.offered).toBeCloseTo(400);
  });

  it('bad-deploy adds an error rate', () => {
    const s = createState(threeTier({ faults: [{ at: 0, type: 'bad-deploy', target: 'api', errorRate: 0.3 }] }), 1);
    step(s);
    expect(s.stats.availability).toBeCloseTo(0.7, 2);
  });

  it('instance-crash removes capacity', () => {
    const s = createState(threeTier({ rps: 800, faults: [{ at: 1, type: 'instance-crash', target: 'api', count: 1 }] }), 1);
    run(s, 2);
    expect(node(s, 'api').instances).toBe(1);
    expect(node(s, 'api').accept).toBeCloseTo(0.625);
  });

  it('cache-flush sends misses to the db, then the cache warms back up', () => {
    const s = createState(withCache({ faults: [{ at: 1, type: 'cache-flush', target: 'cache' }] }), 1);
    run(s, 0.9);
    expect(node(s, 'db').readIn).toBeCloseTo(50);
    run(s, 0.2);
    expect(node(s, 'db').readIn).toBeGreaterThan(450);
    run(s, 30);
    expect(node(s, 'db').readIn).toBeLessThan(250);
  });

  it('hot-key overloads one partition even when average utilization is low', () => {
    const s = createState(
      withCache({
        cache: { instances: 4, capacityPerInstance: 300, partitioned: true, hitRatio: 0.9 },
        faults: [{ at: 0, type: 'hot-key', target: 'cache', share: 0.8 }],
      }),
      1,
    );
    step(s);
    const cache = node(s, 'cache');
    expect(cache.utilization).toBeGreaterThan(1);
    expect(cache.accept).toBeLessThan(0.8);
  });

  it('logs when a fault starts', () => {
    const s = createState(threeTier({ faults: [{ at: 0, type: 'instance-crash', target: 'api', count: 1 }] }), 1);
    step(s);
    expect(s.logs.since(0).map((l) => l.message)).toContain('api: 1 instance(s) terminated unexpectedly');
  });
});
