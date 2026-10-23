import { describe, expect, it } from 'vitest';
import { createSimulation } from '../src/simulation';
import { threeTier } from './fixtures';

describe('createSimulation', () => {
  it('throws with all validation errors', () => {
    const sc = threeTier();
    sc.routes[0]!.path = ['lb', 'db'];
    expect(() => createSimulation(sc, { seed: 1 })).toThrow('route "GET /" uses missing edge lb->db');
  });

  it('snapshots nodes with health', () => {
    const sim = createSimulation(threeTier({ rps: 2000 }), { seed: 1 });
    sim.tick();
    const snap = sim.snapshot();
    const api = snap.nodes.find((n) => n.id === 'api')!;
    expect(api.health).toBe('crit');
    expect(api.metrics.errorRate).toBeCloseTo(0.5);
    expect(snap.nodes.find((n) => n.id === 'db')!.health).toBe('ok');
    expect(snap.routes[0]!.offeredRps).toBeCloseTo(2000);
    expect(snap.outcome).toBe('running');
  });

  it('records history once per simulated second', () => {
    const sim = createSimulation(threeTier(), { seed: 1 });
    sim.tick(50);
    expect(sim.history('api:rps').t).toEqual([1, 2, 3, 4, 5]);
    expect(sim.history('global:availability').v.every((v) => v > 0.999)).toBe(true);
    expect(sim.history('nope:rps')).toEqual({ t: [], v: [] });
  });

  it('logs threshold crossings without spamming', () => {
    const sim = createSimulation(
      threeTier({ api: { poolSize: 10 }, faults: [{ at: 0, type: 'latency-injection', target: 'db', addMs: 2000 }] }),
      { seed: 1 },
    );
    sim.tick(30);
    const pool = sim.logs().filter((l) => l.message.includes('connection pool exhausted'));
    expect(pool).toHaveLength(1);
    expect(pool[0]!.nodeId).toBe('api');
    expect(sim.logs().some((l) => l.message === 'api: upstream timeout after 1000ms calling db')).toBe(true);
    sim.tick(30);
    expect(sim.logs().filter((l) => l.message.includes('connection pool exhausted'))).toHaveLength(2);
  });

  it('samples one nested trace per route per second', () => {
    const sim = createSimulation(threeTier(), { seed: 3 });
    sim.tick(20);
    const traces = sim.traces();
    expect(traces).toHaveLength(2);
    const [t] = traces;
    expect(t!.spans.map((sp) => sp.nodeId)).toEqual(['lb', 'api', 'db']);
    expect(t!.spans[0]!.durationMs).toBeGreaterThanOrEqual(t!.spans[1]!.durationMs);
    expect(t!.spans[1]!.startMs).toBeGreaterThanOrEqual(t!.spans[0]!.startMs);
    expect(t!.durationMs).toBeCloseTo(t!.spans[0]!.durationMs);
  });

  it('applies actions through the API and stops once decided', () => {
    const sim = createSimulation(threeTier(), { seed: 1 });
    expect(sim.apply({ action: 'scale', target: 'api' })).toEqual({ ok: true, effectiveAt: 30 });
    expect(sim.snapshot().pending).toHaveLength(1);
    sim.tick(10_000);
    expect(sim.outcome()).toBe('won');
    const t = sim.time();
    sim.tick(100);
    expect(sim.time()).toBe(t);
    expect(sim.apply({ action: 'rollback', target: 'api' }).ok).toBe(false);
    // scheduled + effective (the scale lands on the same tick the win is declared)
    expect(sim.actionLog().map((a) => a.status)).toEqual(['scheduled', 'effective']);
  });

  it('identical seeds and actions give identical runs, including traces', () => {
    const go = () => {
      const sim = createSimulation(threeTier({ rps: 1500 }), { seed: 5 });
      sim.tick(30);
      sim.apply({ action: 'scale', target: 'api', params: { delta: 2 } });
      sim.tick(400);
      return JSON.stringify([sim.snapshot(), sim.traces(), sim.logs()]);
    };
    expect(go()).toBe(go());
  });
});
