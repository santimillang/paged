import type { SimSnapshot } from '@paged/engine';
import type { Scenario } from '@paged/scenarios';
import { clock, fmtPct, fmtUsers } from '../format';
import { holdText } from '../game/pager';
import type { Speed } from '../game/useIncident';

interface Props {
  snap: SimSnapshot;
  scenario: Scenario;
  page: string | null;
  speed: Speed;
  setSpeed: (s: Speed) => void;
}

const SPEEDS: Speed[] = [0, 1, 2, 4];

export function TopBar({ snap, scenario, page, speed, setSpeed }: Props) {
  const st = snap.stats;
  const sloOk = st.availability * 100 >= scenario.sim.slo.availability;
  const budget = Math.max(0, st.errorBudgetFraction);
  return (
    <header className="topbar">
      {page && st.sloHealthy && st.healthyForSeconds > 0 ? (
        <div className="page holding" role="status">
          <span>✅ {holdText(st)}</span>
          <span className="bar hold-bar">
            <span className="bar-fill ok" style={{ width: `${Math.min(1, st.healthyForSeconds / st.holdTargetSeconds) * 100}%` }} />
          </span>
        </div>
      ) : (
        <div className={`page${page ? ' paging' : ''}`} role="status">
          {page ? <>🔴 PAGE: {page}</> : <>🟢 All quiet</>}
        </div>
      )}
      <div className="clock" aria-label="Simulated time">⏱ {clock(snap.t)}</div>
      <div className="speed" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} aria-pressed={speed === s} aria-label={s === 0 ? 'Pause' : `${s}x`} onClick={() => setSpeed(s)}>
            {s === 0 ? '⏸' : `${s}x`}
          </button>
        ))}
      </div>
      <div className="meter" title={`SLO ${scenario.sim.slo.availability}% availability, p99 < ${scenario.sim.slo.p99Ms}ms`}>
        <span className="meter-label">Availability</span>
        <span className={sloOk ? 'ok-text' : 'crit-text'}>{fmtPct(st.availability, 2)}</span>
      </div>
      <div className="meter" title="Error budget left. When it hits zero, you lose.">
        <span className="meter-label">Error budget</span>
        <span className="bar">
          <span className={`bar-fill ${budget < 0.25 ? 'crit' : budget < 0.5 ? 'warn' : 'ok'}`} style={{ width: `${budget * 100}%` }} />
        </span>
        <span>{Math.round(st.errorBudgetRemaining)}s</span>
      </div>
      <div className="meter" title="Users online">👥 {fmtUsers(st.usersOnline)}</div>
      <div className="meter" title="Infrastructure cost">💸 ${Math.round(st.costPerHour)}/h</div>
    </header>
  );
}
