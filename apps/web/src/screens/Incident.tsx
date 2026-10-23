import { ACTIONS, type ActionId, type ActionParams } from '@paged/engine';
import type { Scenario } from '@paged/scenarios';
import { useEffect, useState } from 'react';
import { ArchitectureMap } from '../components/ArchitectureMap';
import { Inspector } from '../components/Inspector';
import { DEFAULT_PARAMS, Toolbox, type Toast } from '../components/Toolbox';
import { TopBar } from '../components/TopBar';
import { beep, pageText } from '../game/pager';
import { useIncident, type RunSummary } from '../game/useIncident';
import { href } from '../router';

interface Props {
  scenario: Scenario;
  sound: boolean;
  onDone: (r: RunSummary) => void;
}

export function Incident({ scenario, sound, onDone }: Props) {
  const { sim, snap, speed, setSpeed, apply, cluesUsed, revealClue } = useIncident(scenario, onDone);
  const [started, setStarted] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [action, setAction] = useState<ActionId | null>(null);
  const [params, setParams] = useState<ActionParams>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const [page, setPage] = useState<string | null>(null);

  // The first time the SLO breaks, the pager goes off.
  useEffect(() => {
    if (page || !started || snap.t === 0 || snap.stats.sloHealthy) return;
    setPage(pageText(snap, scenario.sim.slo));
    if (sound) beep();
  }, [snap, page, started, sound, scenario]);

  const selectAction = (a: ActionId | null) => {
    setAction(a);
    setParams(a ? { ...(DEFAULT_PARAMS[a] ?? {}) } : {});
  };

  const onNodeClick = (id: string) => {
    setSelectedNode(id);
    if (!action) return;
    const def = ACTIONS[action];
    const label = snap.nodes.find((n) => n.id === id)?.label ?? id;
    const r = apply({ action, target: id, params });
    if (r.ok) {
      setToast({ kind: 'ok', text: `${def.label} scheduled on ${label} · ready in ${def.delaySec}s` });
      selectAction(null);
    } else {
      setToast({ kind: 'err', text: `${def.label} on ${label}: ${r.reason}` });
    }
  };

  return (
    <div className="incident">
      <TopBar snap={snap} scenario={scenario} page={page} speed={speed} setSpeed={setSpeed} />
      <div className="incident-body">
        <ArchitectureMap
          snap={snap}
          selected={selectedNode}
          pendingTargets={new Set(snap.pending.map((p) => p.request.target))}
          targetKinds={action ? ACTIONS[action].targetKinds : null}
          onNodeClick={onNodeClick}
        />
        <Inspector sim={sim} snap={snap} nodeId={selectedNode} />
      </div>
      <Toolbox
        scenario={scenario}
        selected={action}
        onSelect={selectAction}
        params={params}
        setParams={setParams}
        cluesUsed={cluesUsed}
        onClue={revealClue}
        toast={toast}
      />

      {!started && (
        <div className="overlay" role="dialog" aria-modal aria-labelledby="briefing-title">
          <div className="briefing">
            <div className="stage">
              {scenario.world} · {scenario.stage}
            </div>
            <h1 id="briefing-title">{scenario.title}</h1>
            <p>{scenario.briefing}</p>
            <p className="slo">
              SLO: {scenario.sim.slo.availability}% availability · p99 &lt; {scenario.sim.slo.p99Ms}ms · error budget{' '}
              {scenario.sim.errorBudgetSeconds}s
            </p>
            <div className="row">
              <a href={href({ name: 'map' })}>← Back</a>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setStarted(true);
                  setSpeed(1);
                }}
              >
                Start shift
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
