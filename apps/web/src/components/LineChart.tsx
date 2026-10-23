import type { Series } from '@paged/engine';
import { useEffect, useRef } from 'react';
import type { Marker } from '../game/debrief';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface Props {
  series: Series;
  title: string;
  format?: (v: number) => string;
  /** Vertical lines: faults in red, the player's actions in blue. */
  markers?: Marker[];
  /** 6-digit hex; canvas can't read CSS variables. */
  color?: string;
  height?: number;
  yMax?: number;
}

const AXIS = '#8b93a7';
const GRID = '#232838';

export function LineChart({ series, title, format = (v) => v.toFixed(0), markers = [], color = '#ff7a45', height = 110, yMax }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const opts: uPlot.Options = {
      width: el.clientWidth || 300,
      height,
      legend: { show: false },
      cursor: { points: { show: false } },
      scales: {
        x: { time: false },
        y: yMax === undefined ? { range: (_u, min, max) => [Math.min(0, min), max > 0 ? max * 1.1 : 1] } : { range: [0, yMax] },
      },
      axes: [
        { stroke: AXIS, grid: { stroke: GRID }, ticks: { stroke: GRID }, values: (_u, vals) => vals.map((v) => `${v}s`) },
        { stroke: AXIS, grid: { stroke: GRID }, ticks: { stroke: GRID }, size: 60, values: (_u, vals) => vals.map((v) => formatRef.current(v)) },
      ],
      series: [{}, { stroke: color, width: 2, fill: `${color}22` }],
      hooks: {
        draw: [
          (u) => {
            const ctx = u.ctx;
            ctx.save();
            ctx.setLineDash([4, 4]);
            for (const { t, kind } of markersRef.current) {
              ctx.strokeStyle = kind === 'fault' ? '#ff5d5d' : '#7aa2ff';
              const x = u.valToPos(t, 'x', true);
              ctx.beginPath();
              ctx.moveTo(x, u.bbox.top);
              ctx.lineTo(x, u.bbox.top + u.bbox.height);
              ctx.stroke();
            }
            ctx.restore();
          },
        ],
      },
    };
    plot.current = new uPlot(opts, [series.t, series.v], el);
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
    // created once per shape; data flows in through the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, yMax, color]);

  useEffect(() => {
    plot.current?.setData([series.t, series.v]);
  }, [series]);

  const last = series.v[series.v.length - 1];
  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        <span className="chart-now">{last === undefined ? '–' : format(last)}</span>
      </figcaption>
      <div ref={box} />
    </figure>
  );
}
