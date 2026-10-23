import { describe, expect, it } from 'vitest';
import { parseCatalog, parseScenario, ScenarioError } from '../src/parse';
import { CONCEPTS, MINIMAL, WORLDS } from './minimal';

const catalog = parseCatalog(CONCEPTS, WORLDS);
const issuesOf = (yaml: string): string[] => {
  try {
    parseScenario(yaml, catalog, 'test.yaml');
  } catch (e) {
    if (e instanceof ScenarioError) return e.issues;
    throw e;
  }
  return [];
};

describe('parseScenario', () => {
  it('parses a valid scenario into engine input', () => {
    const s = parseScenario(MINIMAL, catalog, 'test.yaml');
    expect(s.id).toBe('tiny');
    expect(s.sim.edges).toEqual([{ from: 'lb', to: 'api' }, { from: 'api', to: 'db' }]);
    expect(s.sim.routes[0]!.path).toEqual(['lb', 'api', 'db']);
    expect(s.sim.slo.p99Ms).toBe(800);
    expect(s.solution[0]!.action).toBe('add-cache');
  });

  it('reports schema errors with field paths and the file name', () => {
    expect(() => parseScenario(MINIMAL.replace('difficulty: 1', 'difficulty: 9'), catalog, 'test.yaml')).toThrow(/test\.yaml/);
    expect(issuesOf(MINIMAL.replace('difficulty: 1', 'difficulty: 9'))[0]).toMatch(/^difficulty: /);
    expect(issuesOf(MINIMAL.replace('kind: db', 'kind: database'))[0]).toMatch(/^architecture\.nodes\.2\.kind: /);
  });

  it('reports engine graph errors', () => {
    expect(issuesOf(MINIMAL.replace('path: [lb, api, db]', 'path: [lb, db]'))).toContain('route "GET /" uses missing edge lb->db');
  });

  it('reports catalog and toolbox cross-reference errors', () => {
    expect(issuesOf(MINIMAL.replace('concepts: [caching]', 'concepts: [cachin]'))).toContain('unknown concept "cachin"');
    expect(issuesOf(MINIMAL.replace('world: url-shortener', 'world: nowhere'))).toContain('unknown world "nowhere"');
    expect(issuesOf(MINIMAL.replace('stage: "1k users"', 'stage: "1M users"'))).toContain('stage "1M users" is not a stage of world "url-shortener"');
    expect(issuesOf(MINIMAL.replace('mitigate: [scale]', 'mitigate: [scale, add-cache]'))).toContain('toolbox.mitigate: "add-cache" is a design action');
    expect(issuesOf(MINIMAL.replace('design: [add-cache]', 'design: [add-cache, scale]'))).toContain('toolbox.design: "scale" is a mitigation');
    expect(issuesOf(MINIMAL.replace('requiredDesignFixes: [add-cache]', 'requiredDesignFixes: [add-read-replica]'))).toContain(
      'requiredDesignFixes: "add-read-replica" is not in toolbox.design',
    );
    expect(issuesOf(MINIMAL.replace('action: add-cache, target: db', 'action: rollback, target: api'))).toEqual(
      expect.arrayContaining(['solution: "rollback" is not in the toolbox', 'solution never applies a required design fix']),
    );
  });
});

describe('parseCatalog', () => {
  it('rejects duplicate ids', () => {
    expect(() => parseCatalog(CONCEPTS + CONCEPTS, WORLDS)).toThrow('duplicate concept id "caching"');
  });
});
