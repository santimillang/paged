import type { LogEntry, Series } from './types';

export const HISTORY_POINTS = 600; // 10 minutes at 1 point/second
const MAX_LOGS = 500;

export class LogBook {
  private entries: LogEntry[] = [];
  private lastByKey = new Map<string, number>();

  /** Add an entry. With a key, identical keys are suppressed for minGapSec. */
  add(t: number, e: Omit<LogEntry, 't'>, key?: string, minGapSec = 5): void {
    if (key !== undefined) {
      const last = this.lastByKey.get(key);
      if (last !== undefined && t - last < minGapSec) return;
      this.lastByKey.set(key, t);
    }
    this.entries.push({ t, ...e });
    if (this.entries.length > MAX_LOGS) this.entries.shift();
  }

  since(t: number): LogEntry[] {
    return this.entries.filter((e) => e.t >= t);
  }
}

export class History {
  private series = new Map<string, Series>();

  record(key: string, t: number, v: number): void {
    let s = this.series.get(key);
    if (!s) {
      s = { t: [], v: [] };
      this.series.set(key, s);
    }
    s.t.push(t);
    s.v.push(v);
    if (s.t.length > HISTORY_POINTS) {
      s.t.shift();
      s.v.shift();
    }
  }

  get(key: string): Series {
    const s = this.series.get(key);
    return s ? { t: [...s.t], v: [...s.v] } : { t: [], v: [] };
  }
}
