import { describe, expect, it } from 'vitest';
import { insertBefore, resolveNode, topoOrder, uniqueId, validateSimScenario } from '../src/graph';
import type { SimScenario } from '../src/types';

const base = (): SimScenario => ({
  nodes: [
    { id: 'lb', kind: 'lb' },
    { id: 'api', kind: 'service' },
    { id: 'db', kind: 'db' },
  ],
  edges: [{ from: 'lb', to: 'api' }, { from: 'api', to: 'db' }],
  routes: [{ id: 'r', path: ['lb', 'api', 'db'], rps: 10 }],
  faults: [],
  slo: { availability: 99.9, p99Ms: 500 },
  errorBudgetSeconds: 60,
  win: { sloHealthyForSeconds: 30 },
});

describe('resolveNode', () => {
  it('fills kind-specific defaults', () => {
    const lb = resolveNode({ id: 'lb', kind: 'lb' });
    expect(lb.capacityPerInstance).toBe(100_000);
    expect(lb.poolSize).toBe(10_000);
    const c = resolveNode({ id: 'c', kind: 'cache', hitRatio: 0.8 });
    expect(c.hitRatio).toBe(0.8);
    expect(c.targetHitRatio).toBe(0.8);
    expect(resolveNode({ id: 's', kind: 'service' }).hitRatio).toBe(0);
  });
});

describe('validateSimScenario', () => {
  it('accepts a valid scenario', () => {
    expect(validateSimScenario(base())).toEqual([]);
  });

  it('reports unknown nodes, missing edges, bad fault targets', () => {
    const s = base();
    s.routes[0]!.path = ['lb', 'db'];
    s.faults = [{ at: 1, type: 'cache-flush', target: 'nope' }];
    s.edges.push({ from: 'api', to: 'ghost' });
    const errors = validateSimScenario(s);
    expect(errors).toContain('route "r" uses missing edge lb->db');
    expect(errors).toContain('fault cache-flush@1s targets unknown node "nope"');
    expect(errors).toContain('edge api->ghost references unknown node "ghost"');
  });

  it('reports duplicate ids, bad read ratios and unknown spike routes', () => {
    const s = base();
    s.nodes.push({ id: 'api', kind: 'service' });
    s.routes[0]!.readRatio = 2;
    s.faults = [{ at: 0, type: 'traffic-spike', route: 'missing', multiplier: 2 }];
    const errors = validateSimScenario(s);
    expect(errors).toContain('duplicate node id "api"');
    expect(errors).toContain('route "r" readRatio must be between 0 and 1');
    expect(errors).toContain('fault traffic-spike@0s targets unknown route "missing"');
  });

  it('reports cycles', () => {
    const s = base();
    s.edges.push({ from: 'db', to: 'lb' });
    expect(validateSimScenario(s)).toContain('graph has a cycle');
  });
});

describe('topoOrder', () => {
  it('orders callers before callees', () => {
    expect(topoOrder(['db', 'api', 'lb'], base().edges)).toEqual(['lb', 'api', 'db']);
  });
});

describe('insertBefore', () => {
  it('rewires edges and route paths', () => {
    const s = base();
    const nodes = new Map(s.nodes.map((n) => [n.id, resolveNode(n)]));
    const g = { nodes, edges: s.edges.map((e) => ({ ...e })), routes: [{ path: [...s.routes[0]!.path] }] };
    insertBefore(g, 'db', resolveNode({ id: 'db-cache', kind: 'cache' }));
    expect(g.edges).toEqual([
      { from: 'lb', to: 'api' },
      { from: 'api', to: 'db-cache' },
      { from: 'db-cache', to: 'db' },
    ]);
    expect(g.routes[0]!.path).toEqual(['lb', 'api', 'db-cache', 'db']);
    expect(g.nodes.has('db-cache')).toBe(true);
  });

  it('inserts at the route entry', () => {
    const s = base();
    const nodes = new Map(s.nodes.map((n) => [n.id, resolveNode(n)]));
    const g = { nodes, edges: s.edges.map((e) => ({ ...e })), routes: [{ path: [...s.routes[0]!.path] }] };
    insertBefore(g, 'lb', resolveNode({ id: 'cdn', kind: 'cdn' }));
    expect(g.routes[0]!.path).toEqual(['cdn', 'lb', 'api', 'db']);
    expect(g.edges).toContainEqual({ from: 'cdn', to: 'lb' });
  });
});

describe('uniqueId', () => {
  it('suffixes when taken', () => {
    const m = new Map([['db-cache', 1]]);
    expect(uniqueId(m, 'db-cache')).toBe('db-cache-2');
    expect(uniqueId(m, 'other')).toBe('other');
  });
});
