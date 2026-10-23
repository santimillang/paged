import type { TrafficPattern } from './types';

export function patternMultiplier(p: TrafficPattern | undefined, t: number): number {
  if (!p || p.type === 'flat') return 1;
  if (p.type === 'ramp') {
    if (t <= p.startAt) return p.from;
    if (t >= p.endAt) return p.to;
    return p.from + (p.to - p.from) * ((t - p.startAt) / (p.endAt - p.startAt));
  }
  return 1 + p.amplitude * Math.sin((2 * Math.PI * t) / p.periodSec);
}
