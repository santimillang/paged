import { describe, expect, it } from 'vitest';
import { checkScenario } from '../src/headless';
import { loadAllScenariosFromDisk, loadCatalogFromDisk } from '../src/node-loader';

describe('shipped content', () => {
  const catalog = loadCatalogFromDisk();
  const scenarios = loadAllScenariosFromDisk();

  it('has the v1 worlds and concepts', () => {
    expect(catalog.worlds.map((w) => w.id)).toEqual(['url-shortener', 'twitter', 'netflix', 'discord', 'ticketmaster']);
    expect(catalog.concepts.length).toBeGreaterThanOrEqual(25);
  });

  it('every scenario teaches its lesson', () => {
    expect(scenarios.length).toBeGreaterThan(0);
    for (const sc of scenarios) {
      expect(checkScenario(sc).failures, sc.id).toEqual([]);
    }
  });
});
