import type { EdgeSpec } from '@paged/engine';

export interface Pos {
  x: number;
  y: number;
}

export const COL_W = 240;
export const ROW_H = 130;

/** Left-to-right layered layout: column = longest path from a source, rows centred on y = 0. */
export function layoutGraph(ids: string[], edges: EdgeSpec[]): Map<string, Pos> {
  const depth = new Map(ids.map((id) => [id, 0]));
  // The graph is a DAG, so ids.length relaxation passes are enough.
  for (let pass = 0; pass < ids.length; pass++) {
    for (const e of edges) {
      const d = (depth.get(e.from) ?? 0) + 1;
      if (d > (depth.get(e.to) ?? 0)) depth.set(e.to, d);
    }
  }
  const cols = new Map<number, string[]>();
  for (const id of ids) {
    const d = depth.get(id) ?? 0;
    cols.set(d, [...(cols.get(d) ?? []), id]);
  }
  const pos = new Map<string, Pos>();
  for (const [d, list] of cols) {
    list.forEach((id, i) => pos.set(id, { x: d * COL_W, y: (i - (list.length - 1) / 2) * ROW_H }));
  }
  return pos;
}
