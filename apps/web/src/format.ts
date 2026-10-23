export const fmtRps = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k rps` : `${Math.round(n)} rps`);

export const fmtMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);

export const fmtPct = (x: number, digits = 0): string => `${(x * 100).toFixed(digits)}%`;

export function clock(t: number): string {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const fmtUsers = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
