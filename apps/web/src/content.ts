import { parseCatalog, parseScenario, type Catalog, type Scenario } from '@paged/scenarios';
import conceptsYaml from '@paged/scenarios/content/concepts.yaml?raw';
import worldsYaml from '@paged/scenarios/content/worlds.yaml?raw';

// Bundled at build time; every file is validated when the app loads.
const files = import.meta.glob('../../../packages/scenarios/content/scenarios/*/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface Content {
  catalog: Catalog;
  scenarios: Scenario[];
  byId: Map<string, Scenario>;
  byWorld: Map<string, Scenario[]>;
}

export function buildContent(conceptsText: string, worldsText: string, scenarioFiles: Record<string, string>): Content {
  const catalog = parseCatalog(conceptsText, worldsText);
  const scenarios = Object.entries(scenarioFiles).map(([path, text]) =>
    parseScenario(text, catalog, path.split('/content/')[1] ?? path),
  );
  const byWorld = new Map<string, Scenario[]>(catalog.worlds.map((w) => [w.id, []]));
  for (const s of scenarios) byWorld.get(s.world)?.push(s);
  for (const list of byWorld.values()) list.sort((a, b) => a.order - b.order);
  return { catalog, scenarios, byId: new Map(scenarios.map((s) => [s.id, s])), byWorld };
}

export const content = buildContent(conceptsYaml, worldsYaml, files);
