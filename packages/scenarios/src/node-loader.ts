import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCatalog, parseScenario } from './parse';
import type { Catalog, Scenario } from './types';

export const CONTENT_ROOT = fileURLToPath(new URL('../content', import.meta.url));

export function loadCatalogFromDisk(root = CONTENT_ROOT): Catalog {
  return parseCatalog(readFileSync(join(root, 'concepts.yaml'), 'utf8'), readFileSync(join(root, 'worlds.yaml'), 'utf8'));
}

export function loadAllScenariosFromDisk(root = CONTENT_ROOT): Scenario[] {
  const catalog = loadCatalogFromDisk(root);
  const dir = join(root, 'scenarios');
  const scenarios: Scenario[] = [];
  for (const world of readdirSync(dir, { withFileTypes: true })) {
    if (!world.isDirectory()) continue;
    for (const file of readdirSync(join(dir, world.name))) {
      if (!file.endsWith('.yaml')) continue;
      const path = join(dir, world.name, file);
      const sc = parseScenario(readFileSync(path, 'utf8'), catalog, `scenarios/${world.name}/${file}`);
      if (sc.world !== world.name) throw new Error(`scenarios/${world.name}/${file}: world "${sc.world}" does not match its folder`);
      scenarios.push(sc);
    }
  }
  const ids = new Set<string>();
  const slots = new Set<string>();
  for (const sc of scenarios) {
    if (ids.has(sc.id)) throw new Error(`duplicate scenario id "${sc.id}"`);
    ids.add(sc.id);
    const slot = `${sc.world}#${sc.order}`;
    if (slots.has(slot)) throw new Error(`two scenarios in "${sc.world}" have order ${sc.order}`);
    slots.add(slot);
  }
  const worldIndex = new Map(catalog.worlds.map((w, i) => [w.id, i]));
  return scenarios.sort((a, b) => (worldIndex.get(a.world)! - worldIndex.get(b.world)!) || a.order - b.order);
}
