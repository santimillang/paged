import type { Stars } from '@paged/engine';
import type { Content } from './content';

export interface Progress {
  stars: Record<string, Stars>;
  sound: boolean;
}

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

export const STORAGE_KEY = 'paged:v1';

export const emptyProgress = (): Progress => ({ stars: {}, sound: true });

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadProgress(storage: ReadStorage | null = browserStorage()): Progress {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    const p = JSON.parse(raw) as Partial<Progress>;
    return { stars: p.stars ?? {}, sound: p.sound ?? true };
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(p: Progress, storage: WriteStorage | null = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable (private mode, blocked): progress just isn't kept.
  }
}

export function recordStars(p: Progress, id: string, stars: Stars): Progress {
  const best = Math.max(p.stars[id] ?? 0, stars) as Stars;
  return { ...p, stars: { ...p.stars, [id]: best } };
}

const starsOf = (p: Progress, id: string): number => p.stars[id] ?? 0;

/** The first world is always open; it unlocks every other world once each of its incidents has a star. */
export function isWorldUnlocked(c: Content, p: Progress, worldId: string): boolean {
  const first = c.catalog.worlds[0];
  if (!first || worldId === first.id) return true;
  const tutorial = c.byWorld.get(first.id) ?? [];
  return tutorial.length > 0 && tutorial.every((s) => starsOf(p, s.id) >= 1);
}

export function isIncidentUnlocked(c: Content, p: Progress, scenarioId: string): boolean {
  const s = c.byId.get(scenarioId);
  if (!s || !isWorldUnlocked(c, p, s.world)) return false;
  const list = c.byWorld.get(s.world) ?? [];
  const i = list.findIndex((x) => x.id === s.id);
  const prev = list[i - 1];
  return !prev || starsOf(p, prev.id) >= 1;
}

/** Per concept: distinct incidents tagged with it and won with 2+ stars, capped at 4. */
export function conceptMastery(c: Content, p: Progress): Map<string, number> {
  const m = new Map(c.catalog.concepts.map((k) => [k.id, 0]));
  for (const s of c.scenarios) {
    if (starsOf(p, s.id) < 2) continue;
    for (const k of s.concepts) m.set(k, Math.min(4, (m.get(k) ?? 0) + 1));
  }
  return m;
}
