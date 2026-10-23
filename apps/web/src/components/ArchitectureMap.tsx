import type { NodeKind, NodeSnapshot, SimSnapshot } from '@paged/engine';
import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useMemo } from 'react';
import { fmtRps } from '../format';
import { layoutGraph } from '../game/layout';

const ICON: Record<NodeKind, string> = {
  client: '👤', cdn: '🌐', lb: '⚖️', service: '⚙️', cache: '⚡', db: '🗄️', queue: '📬', worker: '🛠️', external: '🔌',
};

const HEALTH_COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', crit: 'var(--crit)' } as const;

type CompData = { node: NodeSnapshot; selected: boolean; pending: boolean; targetable: boolean; onActivate: () => void };
type CompNode = Node<CompData, 'component'>;

const Component = memo(function Component({ data }: NodeProps<CompNode>) {
  const { node, selected, pending, targetable, onActivate } = data;
  const m = node.metrics;
  const fire = m.utilization >= 1 || m.errorRate > 0.05;
  const cold = m.hitRatio !== undefined && m.hitRatio < 0.5;
  const cls = ['comp', `health-${node.health}`, selected && 'selected', targetable && 'targetable'].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      data-testid={`node-${node.id}`}
      role="button"
      tabIndex={0}
      aria-label={`${node.label}, ${node.kind}, ${node.health}`}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        onActivate();
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="comp-head">
        <span className="comp-icon" aria-hidden>{ICON[node.kind]}</span>
        <span className="comp-label">{node.label}</span>
        <span className="comp-badges">
          {fire && <span title="Overloaded or failing">🔥</span>}
          {cold && <span title="Cache is cold">❄️</span>}
          {pending && <span title="Action in progress">⏳</span>}
        </span>
      </div>
      <div className="comp-meta">
        ×{node.instances} · {fmtRps(m.rps)}
        {m.hitRatio !== undefined && ` · hit ${Math.round(m.hitRatio * 100)}%`}
      </div>
      <div className="util" title={`utilization ${Math.round(m.utilization * 100)}%`}>
        <div className="util-fill" style={{ width: `${Math.min(1, m.utilization) * 100}%` }} />
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

const nodeTypes = { component: Component };

interface Props {
  snap: SimSnapshot;
  selected: string | null;
  pendingTargets: Set<string>;
  targetKinds: NodeKind[] | null;
  onNodeClick: (id: string) => void;
}

export function ArchitectureMap({ snap, selected, pendingTargets, targetKinds, onNodeClick }: Props) {
  const topologyKey = snap.edges.map((e) => `${e.from}>${e.to}`).join(',');
  const positions = useMemo(
    () => layoutGraph(snap.nodes.map((n) => n.id), snap.edges),
    // positions only change when the topology does
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topologyKey],
  );
  const byId = new Map(snap.nodes.map((n) => [n.id, n]));

  const nodes: CompNode[] = snap.nodes.map((n) => ({
    id: n.id,
    type: 'component',
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    data: {
      node: n,
      selected: n.id === selected,
      pending: pendingTargets.has(n.id),
      targetable: targetKinds !== null && targetKinds.includes(n.kind),
      onActivate: () => onNodeClick(n.id),
    },
  }));

  const edges: Edge[] = snap.edges.map((e) => {
    const to = byId.get(e.to);
    const rps = to?.metrics.rps ?? 0;
    return {
      id: `${e.from}>${e.to}`,
      source: e.from,
      target: e.to,
      animated: rps > 0,
      style: {
        stroke: HEALTH_COLOR[to?.health ?? 'ok'],
        strokeWidth: 1.5 + 4 * Math.min(1, Math.log10(1 + rps) / 4.5),
      },
    };
  });

  return (
    <div className="map">
      <ReactFlow
        key={topologyKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_, n) => onNodeClick(n.id)}
        minZoom={0.3}
        maxZoom={1.5}
      >
        <Background color="#2a3042" gap={24} />
      </ReactFlow>
    </div>
  );
}
