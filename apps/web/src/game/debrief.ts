import type { ActionId, ActionLogEntry, FaultSpec, Series } from '@paged/engine';

export interface Marker {
  t: number;
  kind: 'fault' | 'action';
}

/** Where the trouble started and when each of the player's actions landed, for the debrief timeline. */
export function timelineMarkers(faults: FaultSpec[], log: ActionLogEntry[]): Marker[] {
  const markers: Marker[] = [
    ...faults.map((f) => ({ t: f.at, kind: 'fault' as const })),
    ...log.filter((a) => a.status === 'effective').map((a) => ({ t: a.t, kind: 'action' as const })),
  ];
  return markers.sort((a, b) => a.t - b.t);
}

export type Verdict = 'helped' | 'neutral' | 'hurt';

export interface ActionVerdict {
  t: number;
  label: string;
  target: string;
  verdict: Verdict;
  reason: string;
}

const BEFORE_SEC = 15;
const AFTER_SEC = 30;

/** Error budget lost per second over [from, to], or null with fewer than two samples. */
function burnRate(s: Series, from: number, to: number): number | null {
  const idx = s.t.flatMap((t, i) => (t >= from && t <= to ? [i] : []));
  if (idx.length < 2) return null;
  const first = idx[0]!;
  const last = idx[idx.length - 1]!;
  return (s.v[first]! - s.v[last]!) / (s.t[last]! - s.t[first]!);
}

const fmt = (x: number) => `${x.toFixed(2)}/s`;

/** Judge each action by how the error-budget burn changed around the moment it took effect. */
export function classifyActions(log: ActionLogEntry[], budget: Series, labelOf: (a: ActionId) => string): ActionVerdict[] {
  return log
    .filter((a) => a.status === 'effective')
    .map((a) => {
      const base = { t: a.t, label: labelOf(a.request.action), target: a.request.target };
      const before = burnRate(budget, a.t - BEFORE_SEC, a.t);
      const after = burnRate(budget, a.t, a.t + AFTER_SEC);
      if (before === null || after === null) {
        return { ...base, verdict: 'neutral', reason: 'not enough data around this action to judge it' };
      }
      if (after < 0.7 * before - 0.01) {
        return { ...base, verdict: 'helped', reason: `error budget burn dropped from ${fmt(before)} to ${fmt(after)}` };
      }
      if (after > 1.3 * before + 0.01) {
        return { ...base, verdict: 'hurt', reason: `error budget burn rose from ${fmt(before)} to ${fmt(after)}` };
      }
      return { ...base, verdict: 'neutral', reason: 'no visible change in how fast the error budget was burning' };
    });
}
