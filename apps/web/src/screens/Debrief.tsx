import { ACTIONS } from '@paged/engine';
import type { Scenario } from '@paged/scenarios';
import { useState } from 'react';
import { LineChart } from '../components/LineChart';
import { Stars } from '../components/Stars';
import { content } from '../content';
import { clock, fmtPct } from '../format';
import { classifyActions, timelineMarkers } from '../game/debrief';
import type { RunSummary } from '../game/useIncident';
import { href } from '../router';

interface Props {
  run: RunSummary;
  scenario: Scenario;
  nextId: string | null;
  onRetry: () => void;
}

const VERDICT_TAG = { helped: '✅ helped', neutral: '➖ neutral', hurt: '❌ hurt' } as const;

export function Debrief({ run, scenario, nextId, onRetry }: Props) {
  const [showAnswer, setShowAnswer] = useState(false);
  const { sim } = run;
  const log = sim.actionLog();
  const markers = timelineMarkers(scenario.sim.faults, log);
  const verdicts = classifyActions(log, sim.history('global:errorBudgetRemaining'), (a) => ACTIONS[a].label);
  const won = run.outcome === 'won';
  const conceptTitle = (id: string) => content.catalog.concepts.find((c) => c.id === id)?.title ?? id;
  const d = scenario.debrief;

  return (
    <main className={`debrief ${won ? 'won' : 'lost'}`}>
      <header className="debrief-head">
        <div>
          <span className="muted">{scenario.title}</span>
          <h1>{won ? 'Incident resolved' : 'Incident lost'}</h1>
          <span className="muted">
            {won ? `SLO held at ${clock(sim.time())}.` : 'The error budget ran out.'} {run.cluesUsed > 0 && `${run.cluesUsed} clue(s) used.`}
          </span>
        </div>
        <Stars n={run.stars} />
      </header>

      <p className="muted small legend">
        <span className="legend-fault">┊</span> trouble starts · <span className="legend-action">┊</span> your actions take effect
      </p>
      <section className="panel timeline" aria-label="Timeline">
        <LineChart title="Availability" series={sim.history('global:availability')} format={(v) => fmtPct(v, 1)} color="#3ddc97" yMax={1} markers={markers} />
        <LineChart title="Error budget (s)" series={sim.history('global:errorBudgetRemaining')} color="#ff7a45" markers={markers} />
      </section>

      <section className="panel">
        <h2>Your actions</h2>
        {verdicts.length === 0 ? (
          <p className="muted">You didn't change anything. The system did what the model says it does.</p>
        ) : (
          <ul className="verdicts">
            {verdicts.map((v, i) => (
              <li key={i} className={`verdict verdict-${v.verdict}`}>
                <time>{clock(v.t)}</time>
                <span className="tag">{VERDICT_TAG[v.verdict]}</span>
                <span>
                  <strong>{v.label}</strong> on {v.target}: {v.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
        {won && run.stars === 1 && (
          <p className="muted">One star: you got the service back, but only by treating the symptom. Which design change fixes the cause?</p>
        )}
      </section>

      <section className="panel">
        <h2>What happened</h2>
        <p>{d.whatHappened}</p>
      </section>
      <section className="panel">
        <h2>The lesson</h2>
        <p>{d.lesson}</p>
        <div>
          {scenario.concepts.map((c) => (
            <span key={c} className="chip">
              {conceptTitle(c)}
            </span>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>In the real world</h2>
        <p>{d.realWorld}</p>
        {d.sources.length > 0 && (
          <ul>
            {d.sources.map((s) => (
              <li key={s}>
                <a href={s} target="_blank" rel="noreferrer">
                  {s}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel interview">
        <h2>Interview Moment</h2>
        <p className="question">{d.interviewMoment.question}</p>
        <p className="muted">Say your answer out loud first. Then compare.</p>
        <button className="btn" onClick={() => setShowAnswer((s) => !s)} aria-expanded={showAnswer}>
          {showAnswer ? 'Hide model answer' : 'Show model answer'}
        </button>
        {showAnswer && <p>{d.interviewMoment.modelAnswer}</p>}
      </section>

      <nav className="debrief-actions">
        <button className="btn" onClick={onRetry}>
          ↻ Retry
        </button>
        {nextId && (
          <a className="btn btn-primary" href={href({ name: 'incident', id: nextId })}>
            Next incident →
          </a>
        )}
        <a className="btn" href={href({ name: 'map' })}>
          World map
        </a>
      </nav>
    </main>
  );
}
