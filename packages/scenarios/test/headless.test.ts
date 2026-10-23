import { describe, expect, it } from 'vitest';
import { checkScenario, runHeadless } from '../src/headless';
import { parseCatalog, parseScenario } from '../src/parse';
import { CONCEPTS, MINIMAL, WORLDS } from './minimal';

const catalog = parseCatalog(CONCEPTS, WORLDS);

describe('runHeadless', () => {
  it('none loses, full wins with the design fix', () => {
    const sc = parseScenario(
      MINIMAL.replace('{ id: db, kind: db, capacityPerInstance: 1000 }', '{ id: db, kind: db, capacityPerInstance: 600 }')
        .replace('{ id: api, kind: service, instances: 2, capacityPerInstance: 500 }', '{ id: api, kind: service, instances: 8, capacityPerInstance: 500 }')
        .replace('costTarget: 100', 'costTarget: 1000')
        .replace('errorBudgetSeconds: 60', 'errorBudgetSeconds: 200'),
      catalog,
    );
    expect(runHeadless(sc, 'none').outcome).toBe('lost');
    const full = runHeadless(sc, 'full');
    expect(full.outcome).toBe('won');
    expect(full.stars).toBeGreaterThanOrEqual(2);
  });

  it('throws a clear error when a solution step is rejected', () => {
    const sc = parseScenario(MINIMAL.replace('action: add-cache, target: db', 'action: add-cache, target: lb'), catalog);
    expect(() => runHeadless(sc, 'full')).toThrow('tiny: solution step add-cache@6s on "lb" was rejected: Add cache can\'t target a lb');
  });
});

describe('checkScenario', () => {
  it('reports which expectation failed', () => {
    // The spike overloads the API (1500 rps vs 1000 capacity); caching the db can't fix that, so full must fail.
    const sc = parseScenario(MINIMAL, catalog);
    const check = checkScenario(sc);
    expect(check.failures.some((f) => f.startsWith('full: expected won'))).toBe(true);
  });
});
