import { describe, expect, it } from 'vitest';
import { href, parseHash, redirect } from './router';

describe('router', () => {
  it('parses and builds hash routes', () => {
    expect(parseHash('')).toEqual({ name: 'map' });
    expect(parseHash('#/concepts')).toEqual({ name: 'concepts' });
    expect(parseHash('#/incident/launch-day')).toEqual({ name: 'incident', id: 'launch-day' });
    expect(parseHash('#/debrief/read-heavy')).toEqual({ name: 'debrief', id: 'read-heavy' });
    expect(parseHash('#/nonsense/x')).toEqual({ name: 'map' });
    expect(href({ name: 'incident', id: 'launch-day' })).toBe('#/incident/launch-day');
    expect(parseHash(href({ name: 'debrief', id: 'a b' }))).toEqual({ name: 'debrief', id: 'a b' });
  });

  it('falls back to the map on malformed escapes instead of throwing', () => {
    expect(parseHash('#/incident/%')).toEqual({ name: 'map' });
    expect(parseHash('#/debrief/%E0')).toEqual({ name: 'map' });
  });

  it('redirects without adding a history entry', () => {
    const calls: string[] = [];
    redirect({ name: 'map' }, { replace: (u: string) => void calls.push(u) });
    expect(calls).toEqual(['#/']);
  });
});
