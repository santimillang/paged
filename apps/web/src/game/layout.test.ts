import { describe, expect, it } from 'vitest';
import { COL_W, layoutGraph, ROW_H } from './layout';

describe('layoutGraph', () => {
  it('places callers left of callees and centres siblings', () => {
    const pos = layoutGraph(['db', 'lb', 'api', 'cache'], [
      { from: 'lb', to: 'api' }, { from: 'api', to: 'db' }, { from: 'api', to: 'cache' }, { from: 'cache', to: 'db' },
    ]);
    expect(pos.get('lb')).toEqual({ x: 0, y: 0 });
    expect(pos.get('api')).toEqual({ x: COL_W, y: 0 });
    expect(pos.get('cache')).toEqual({ x: 2 * COL_W, y: 0 });
    expect(pos.get('db')).toEqual({ x: 3 * COL_W, y: 0 });
  });

  it('stacks nodes in the same column', () => {
    const pos = layoutGraph(['a', 'b', 'c'], [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }]);
    expect(pos.get('b')).toEqual({ x: COL_W, y: -ROW_H / 2 });
    expect(pos.get('c')).toEqual({ x: COL_W, y: ROW_H / 2 });
  });
});
