import { describe, expect, it } from 'vitest';
import { content } from './content';
import {
  conceptMastery, emptyProgress, isIncidentUnlocked, isWorldUnlocked, loadProgress, recordStars, saveProgress, STORAGE_KEY,
} from './progress';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('progress', () => {
  it('keeps the best stars', () => {
    let p = recordStars(emptyProgress(), 'launch-day', 2);
    p = recordStars(p, 'launch-day', 1);
    expect(p.stars['launch-day']).toBe(2);
  });

  it('unlocks incidents in order and other worlds after the tutorial', () => {
    let p = emptyProgress();
    expect(isIncidentUnlocked(content, p, 'launch-day')).toBe(true);
    expect(isIncidentUnlocked(content, p, 'read-heavy')).toBe(false);
    expect(isWorldUnlocked(content, p, 'twitter')).toBe(false);
    p = recordStars(p, 'launch-day', 1);
    expect(isIncidentUnlocked(content, p, 'read-heavy')).toBe(true);
    p = recordStars(recordStars(p, 'read-heavy', 1), 'viral-link', 1);
    expect(isWorldUnlocked(content, p, 'twitter')).toBe(true);
    expect(isIncidentUnlocked(content, p, 'nope')).toBe(false);
  });

  it('mastery counts incidents won with 2+ stars, capped at 4', () => {
    let p = recordStars(emptyProgress(), 'launch-day', 1);
    expect(conceptMastery(content, p).get('horizontal-scaling')).toBe(0);
    p = recordStars(p, 'launch-day', 2);
    const m = conceptMastery(content, p);
    expect(m.get('horizontal-scaling')).toBe(1);
    expect(m.get('caching')).toBe(0);
    expect(m.size).toBe(content.catalog.concepts.length);
  });

  it('round-trips through storage and survives bad storage', () => {
    const s = memory();
    saveProgress(recordStars(emptyProgress(), 'launch-day', 3), s);
    expect(loadProgress(s).stars['launch-day']).toBe(3);
    s.setItem(STORAGE_KEY, '{not json');
    expect(loadProgress(s)).toEqual(emptyProgress());
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadProgress(throwing)).toEqual(emptyProgress());
    expect(() => saveProgress(emptyProgress(), throwing)).not.toThrow();
    expect(loadProgress(null)).toEqual(emptyProgress());
  });
});
