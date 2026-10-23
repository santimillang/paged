import type { LogEntry, SimSnapshot, Simulation, Trace } from '@paged/engine';
import { useState } from 'react';
import { clock, fmtMs, fmtPct, fmtRps } from '../format';
import { LineChart } from './LineChart';

type Tab = 'metrics' | 'logs' | 'traces';

function LogList({ logs }: { logs: LogEntry[] }) {
  if (logs.length === 0) return <p className="muted">Nothing logged yet.</p>;
  return (
    <ol className="logs">
      {logs.map((l, i) => (
        <li key={`${l.t}-${i}`} className={`log log-${l.level}`}>
          <time>{clock(l.t)}</time> {l.message}
        </li>
      ))}
    </ol>
  );
}

function Waterfall({ traces, focus }: { traces: Trace[]; focus: string }) {
  if (traces.length === 0) return <p className="muted">No sampled requests have reached this component yet.</p>;
  const scale = Math.max(...traces.map((t) => t.durationMs), 1);
  return (
    <div className="traces">
      {traces.map((t) => (
        <div key={t.id} className={`trace${t.error ? ' trace-error' : ''}`}>
          <div className="trace-head">
            <span>{t.routeId}</span>
            <span>{fmtMs(t.durationMs)}{t.error ? ' · failed' : ''}</span>
          </div>
          {t.spans.map((sp) => (
            <div key={sp.nodeId} className={`span${sp.nodeId === focus ? ' span-focus' : ''}`}>
              <span className="span-name">{sp.nodeId}</span>
              <span className="span-track">
                <span
                  className={`span-bar${sp.error ? ' span-error' : ''}`}
                  style={{ left: `${(sp.startMs / scale) * 100}%`, width: `${Math.max(0.5, (sp.durationMs / scale) * 100)}%` }}
                  title={fmtMs(sp.durationMs)}
                />
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const recentLogs = (sim: Simulation, keep: (l: LogEntry) => boolean) => sim.logs().filter(keep).slice(-60).reverse();

export function Inspector({ sim, snap, nodeId }: { sim: Simulation; snap: SimSnapshot; nodeId: string | null }) {
  const [tab, setTab] = useState<Tab>('metrics');
  const node = snap.nodes.find((n) => n.id === nodeId);

  if (!node) {
    return (
      <aside className="inspector">
        <h2>Inspector</h2>
        <p className="muted">Click a component on the map to see its metrics, logs and traces.</p>
        <h3>Recent events</h3>
        <LogList logs={recentLogs(sim, () => true).slice(0, 12)} />
      </aside>
    );
  }

  const h = (metric: string) => sim.history(`${node.id}:${metric}`);
  const isCache = node.metrics.hitRatio !== undefined;
  const pct = (v: number) => fmtPct(v);

  return (
    <aside className="inspector">
      <h2>
        {node.label} <span className="muted">· {node.kind} · ×{node.instances}</span>
      </h2>
      <div className="tabs" role="tablist">
        {(['metrics', 'logs', 'traces'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'metrics' && (
        <div className="charts">
          <LineChart title="Requests / s" series={h('rps')} format={fmtRps} color="#4fb3ff" />
          <LineChart title="p99 latency" series={h('p99Ms')} format={fmtMs} color="#ffb547" />
          <LineChart title="Error rate" series={h('errorRate')} format={pct} color="#ff5d5d" yMax={1} />
          <LineChart title="Utilization" series={h('utilization')} format={pct} color="#b48cff" />
          {isCache && <LineChart title="Cache hit ratio" series={h('hitRatio')} format={pct} color="#3ddc97" yMax={1} />}
        </div>
      )}
      {tab === 'logs' && <LogList logs={recentLogs(sim, (l) => !l.nodeId || l.nodeId === node.id)} />}
      {tab === 'traces' && (
        <Waterfall traces={sim.traces().filter((t) => t.spans.some((s) => s.nodeId === node.id)).slice(-8).reverse()} focus={node.id} />
      )}
    </aside>
  );
}
