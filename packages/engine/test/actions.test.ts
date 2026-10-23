import { describe, expect, it } from 'vitest';
import { requestAction } from '../src/actions';
import { createState } from '../src/state';
import { node, run, threeTier, withCache } from './fixtures';

describe('requestAction validation', () => {
  it('schedules with a delay and applies later', () => {
    const s = createState(threeTier(), 1);
    const res = requestAction(s, { action: 'scale', target: 'api', params: { delta: 1 } });
    expect(res).toEqual({ ok: true, effectiveAt: 30 });
    run(s, 29.9);
    expect(node(s, 'api').instances).toBe(2);
    run(s, 0.2);
    expect(node(s, 'api').instances).toBe(3);
    expect(s.effectiveActions).toEqual(['scale']);
    expect(s.actionLog.map((a) => a.status)).toEqual(['scheduled', 'effective']);
  });

  it('rejects wrong target kinds, unknown targets and duplicates', () => {
    const s = createState(threeTier(), 1);
    expect(requestAction(s, { action: 'scale', target: 'db' })).toEqual({ ok: false, reason: "Scale can't target a db" });
    expect(requestAction(s, { action: 'scale', target: 'nope' })).toEqual({ ok: false, reason: 'unknown component "nope"' });
    expect(requestAction(s, { action: 'rollback', target: 'api' }).ok).toBe(true);
    expect(requestAction(s, { action: 'rollback', target: 'api' })).toEqual({ ok: false, reason: 'Roll back is already in progress on api' });
  });

  it('rejects bad params', () => {
    const s = createState(threeTier(), 1);
    expect(requestAction(s, { action: 'scale', target: 'api', params: { delta: -5 } })).toEqual({ ok: false, reason: 'cannot scale below 1 instance' });
    expect(requestAction(s, { action: 'shed-load', target: 'api', params: { percent: 95 } })).toEqual({ ok: false, reason: 'percent must be between 0 and 90' });
  });

  it('rejects once the incident is over', () => {
    const s = createState(threeTier(), 1);
    run(s, 100);
    expect(s.outcome).toBe('won');
    expect(requestAction(s, { action: 'rollback', target: 'api' })).toEqual({ ok: false, reason: 'the incident is over' });
  });
});

describe('review fixes: actions', () => {
  it('rejects a hitRatio outside (0, 1] for add-cache and add-cdn', () => {
    const s = createState(threeTier(), 1);
    expect(requestAction(s, { action: 'add-cache', target: 'db', params: { hitRatio: 5 } })).toEqual({ ok: false, reason: 'hitRatio must be greater than 0 and at most 1' });
    expect(requestAction(s, { action: 'add-cdn', target: 'lb', params: { hitRatio: -1 } })).toEqual({ ok: false, reason: 'hitRatio must be greater than 0 and at most 1' });
  });

  it('re-validates topology actions when they take effect, so caches do not stack', () => {
    const sc = threeTier();
    sc.routes[0]!.path = ['api', 'db'];
    const s = createState(sc, 1);
    expect(requestAction(s, { action: 'add-cache', target: 'api' }).ok).toBe(true);
    expect(requestAction(s, { action: 'add-cdn', target: 'api' }).ok).toBe(true);
    run(s, 31);
    expect(s.routes[0]!.path).toEqual(['api-cache', 'api', 'db']);
    expect(s.effectiveActions).toEqual(['add-cache']);
    expect(s.logs.since(0).some((l) => l.message.startsWith('Add CDN on api could not be applied'))).toBe(true);
  });
});

describe('mitigations', () => {
  it('shed-load reduces utilization', () => {
    const s = createState(threeTier({ rps: 2000 }), 1);
    requestAction(s, { action: 'shed-load', target: 'api', params: { percent: 50 } });
    run(s, 3);
    expect(node(s, 'api').utilization).toBeCloseTo(1);
  });

  it('rate-limit caps throughput and rps 0 removes it', () => {
    const s = createState(threeTier({ rps: 2000 }), 1);
    requestAction(s, { action: 'rate-limit', target: 'lb', params: { rps: 300 } });
    run(s, 6);
    expect(node(s, 'api').readIn).toBeCloseTo(300);
    requestAction(s, { action: 'rate-limit', target: 'lb', params: { rps: 0 } });
    run(s, 6);
    expect(node(s, 'lb').rateLimitRps).toBeNull();
  });

  it('rollback clears a bad deploy', () => {
    const s = createState(threeTier({ faults: [{ at: 0, type: 'bad-deploy', target: 'api', errorRate: 0.5 }] }), 1);
    run(s, 1);
    requestAction(s, { action: 'rollback', target: 'api' });
    run(s, 21);
    expect(s.stats.availability).toBeCloseTo(1, 6);
  });
});

describe('design fixes', () => {
  it('add-cache inserts a cold cache that warms and offloads the db', () => {
    const s = createState(threeTier({ rps: 900 }), 1);
    requestAction(s, { action: 'add-cache', target: 'db' });
    run(s, 20.1);
    expect(s.routes[0]!.path).toEqual(['lb', 'api', 'db-cache', 'db']);
    expect(s.edges).toContainEqual({ from: 'api', to: 'db-cache' });
    expect(node(s, 'db').readIn).toBeGreaterThan(890);
    run(s, 45);
    expect(node(s, 'db').readIn).toBeLessThan(150);
  });

  it('add-cache is rejected when a cache is already in front', () => {
    const s = createState(withCache(), 1);
    expect(requestAction(s, { action: 'add-cache', target: 'db' })).toEqual({ ok: false, reason: 'db already has a cache in front of it' });
  });

  it('a node created by an action is targetable only once it exists', () => {
    const s = createState(threeTier(), 1);
    requestAction(s, { action: 'add-cache', target: 'db' });
    expect(requestAction(s, { action: 'request-coalescing', target: 'db-cache' })).toEqual({ ok: false, reason: 'unknown component "db-cache"' });
    run(s, 20.1);
    expect(requestAction(s, { action: 'request-coalescing', target: 'db-cache' }).ok).toBe(true);
  });

  it('add-read-replica adds read capacity', () => {
    const s = createState(threeTier({ rps: 3000, api: { instances: 10 }, db: { capacityPerInstance: 2000 } }), 1);
    run(s, 1);
    expect(node(s, 'db').accept).toBeLessThan(1);
    requestAction(s, { action: 'add-read-replica', target: 'db' });
    run(s, 31);
    expect(node(s, 'db').accept).toBe(1);
    expect(s.stats.costPerHour).toBe(5 + 10 * 10 + 40 * 2);
  });

  it('add-cdn only goes in front of an entry point and stays valid after add-cache', () => {
    const s = createState(threeTier(), 1);
    expect(requestAction(s, { action: 'add-cdn', target: 'api' })).toEqual({
      ok: false,
      reason: 'a CDN goes in front of an entry point (the first hop of a route)',
    });
    requestAction(s, { action: 'add-cache', target: 'db' });
    requestAction(s, { action: 'add-cdn', target: 'lb' });
    run(s, 31);
    expect(s.routes[0]!.path).toEqual(['cdn', 'lb', 'api', 'db-cache', 'db']);
    expect(s.order.indexOf('cdn')).toBeLessThan(s.order.indexOf('lb'));
  });

  it('set-retry-policy, request-coalescing and cache-warming change node behaviour', () => {
    const s = createState(withCache({ faults: [{ at: 0, type: 'cache-flush', target: 'cache' }] }), 1);
    requestAction(s, { action: 'set-retry-policy', target: 'api', params: { maxRetries: 2, backoff: 'exponential', jitter: true } });
    requestAction(s, { action: 'request-coalescing', target: 'cache' });
    requestAction(s, { action: 'cache-warming', target: 'cache' });
    run(s, 10.1);
    expect(node(s, 'api').retryPolicy).toEqual({ maxRetries: 2, backoff: 'exponential', jitter: true });
    expect(node(s, 'cache').coalescing).toBe(true);
    expect(node(s, 'cache').warmRatePerSec).toBe(0.2);
  });

  it('autoscaling launches instances after the boot delay and resolves overload', () => {
    const s = createState(threeTier({ rps: 2600 }), 1);
    requestAction(s, { action: 'enable-autoscaling', target: 'api', params: { targetUtilization: 0.6 } });
    run(s, 29.9);
    expect(node(s, 'api').instances).toBe(2);
    run(s, 0.2);
    expect(node(s, 'api').instances).toBe(9);
    run(s, 1);
    expect(node(s, 'api').accept).toBe(1);
  });
});
