import type { GlobalStats, SimSnapshot, SloSpec } from '@paged/engine';

/** Shown once the system is healthy again: how close the player is to closing the incident. */
export function holdText(st: GlobalStats): string {
  return `Stabilizing: holding SLO ${Math.floor(st.healthyForSeconds)}s / ${st.holdTargetSeconds}s`;
}

/** The one-line page a real on-call would get: errors take priority over latency. */
export function pageText(snap: SimSnapshot, slo: SloSpec): string {
  const errorPct = (1 - snap.stats.availability) * 100;
  const allowedPct = 100 - slo.availability;
  if (errorPct > allowedPct + 1e-9) {
    return `Error rate ${Math.round(errorPct)}% (SLO allows ${+allowedPct.toFixed(3)}%)`;
  }
  return `p99 latency ${Math.round(snap.stats.worstP99Ms)}ms > ${slo.p99Ms}ms SLO`;
}

/** Two short square-wave beeps. Never throws (audio may be blocked or unavailable). */
export function beep(): void {
  try {
    const ctx = new AudioContext();
    for (const offset of [0, 0.22]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.value = 0.04;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.14);
    }
    window.setTimeout(() => void ctx.close(), 800);
  } catch {
    // no audio, no problem
  }
}
