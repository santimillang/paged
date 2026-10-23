import { ACTIONS, type ActionId, type ActionParams } from '@paged/engine';
import type { Scenario } from '@paged/scenarios';

export interface Toast {
  kind: 'ok' | 'err';
  text: string;
}

export const DEFAULT_PARAMS: Partial<Record<ActionId, ActionParams>> = {
  scale: { delta: 2 },
  'shed-load': { percent: 30 },
  'rate-limit': { rps: 1000 },
  'enable-autoscaling': { targetUtilization: 0.6 },
  'set-retry-policy': { maxRetries: 2, backoff: 'exponential', jitter: true },
};

interface Props {
  scenario: Scenario;
  selected: ActionId | null;
  onSelect: (a: ActionId | null) => void;
  params: ActionParams;
  setParams: (p: ActionParams) => void;
  cluesUsed: number;
  onClue: () => void;
  toast: Toast | null;
}

function NumberField({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function ParamEditor({ action, params, setParams }: { action: ActionId; params: ActionParams; setParams: (p: ActionParams) => void }) {
  const set = (k: string, v: number | boolean | string) => setParams({ ...params, [k]: v });
  const n = (k: string) => Number(params[k] ?? 0);
  switch (action) {
    case 'scale':
      return <NumberField label="Instances to add (negative removes)" value={n('delta')} min={-20} max={20} step={1} onChange={(v) => set('delta', v)} />;
    case 'shed-load':
      return <NumberField label="Percent of requests to reject (0 turns it off)" value={n('percent')} min={0} max={90} step={5} onChange={(v) => set('percent', v)} />;
    case 'rate-limit':
      return <NumberField label="Max requests/s (0 removes the limit)" value={n('rps')} min={0} max={1_000_000} step={100} onChange={(v) => set('rps', v)} />;
    case 'enable-autoscaling':
      return <NumberField label="Target utilization" value={n('targetUtilization')} min={0.3} max={0.9} step={0.05} onChange={(v) => set('targetUtilization', v)} />;
    case 'set-retry-policy':
      return (
        <>
          <NumberField label="Max retries" value={n('maxRetries')} min={0} max={5} step={1} onChange={(v) => set('maxRetries', v)} />
          <label className="field">
            <span>Backoff</span>
            <select value={String(params.backoff)} onChange={(e) => set('backoff', e.target.value)}>
              <option value="none">none</option>
              <option value="exponential">exponential</option>
            </select>
          </label>
          <label className="field field-inline">
            <input type="checkbox" checked={params.jitter === true} onChange={(e) => set('jitter', e.target.checked)} />
            <span>Jitter</span>
          </label>
        </>
      );
    default:
      return null;
  }
}

function Group({ title, ids, selected, onSelect }: { title: string; ids: ActionId[]; selected: ActionId | null; onSelect: (a: ActionId | null) => void }) {
  return (
    <div className="group">
      <h3>{title}</h3>
      <div className="cards">
        {ids.map((id) => {
          const def = ACTIONS[id];
          return (
            <button key={id} className="card" aria-pressed={selected === id} title={def.description} onClick={() => onSelect(selected === id ? null : id)}>
              <span className="card-label">{def.label}</span>
              <span className="card-delay">{def.delaySec}s</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Toolbox({ scenario, selected, onSelect, params, setParams, cluesUsed, onClue, toast }: Props) {
  const def = selected ? ACTIONS[selected] : null;
  return (
    <section className="toolbox" aria-label="Actions">
      <Group title="🚒 Mitigate" ids={scenario.toolbox.mitigate} selected={selected} onSelect={onSelect} />
      <Group title="🏗️ Fix the design" ids={scenario.toolbox.design} selected={selected} onSelect={onSelect} />
      <div className="group selected-action">
        {def ? (
          <>
            <h3>{def.label}</h3>
            <p className="muted">{def.description}</p>
            <ParamEditor action={def.id} params={params} setParams={setParams} />
            <p className="hint">👉 Now click a component on the map ({def.targetKinds.join(', ')})</p>
          </>
        ) : (
          <p className="muted">Pick an action, then click the component it applies to.</p>
        )}
        {toast && <p className={`toast toast-${toast.kind}`} role="status">{toast.text}</p>}
      </div>
      <div className="group clues">
        <button className="clue-btn" onClick={onClue} disabled={cluesUsed >= scenario.clues.length}>
          💡 Clue ({cluesUsed}/{scenario.clues.length})
        </button>
        <p className="muted small">Each clue costs the third star.</p>
        <ol>
          {scenario.clues.slice(0, cluesUsed).map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}
