import { describe, expect, it } from 'vitest';
import { content } from './content';

describe('bundled content', () => {
  it('loads every world and the tutorial incidents in order', () => {
    expect(content.catalog.worlds.map((w) => w.id)).toEqual(['url-shortener', 'twitter', 'netflix', 'discord', 'ticketmaster']);
    expect(content.byWorld.get('url-shortener')!.map((s) => s.id)).toEqual(['launch-day', 'read-heavy', 'viral-link']);
    expect(content.byWorld.get('twitter')).toEqual([]);
    expect(content.byId.get('viral-link')!.title).toBe('One link goes viral');
  });
});
