import { Stars } from '../components/Stars';
import { content } from '../content';
import { isIncidentUnlocked, isWorldUnlocked, type Progress } from '../progress';
import { href } from '../router';

const firstWorld = content.catalog.worlds[0];

export function WorldMap({ progress, onToggleSound }: { progress: Progress; onToggleSound: () => void }) {
  return (
    <main className="home">
      <header className="hero">
        <div>
          <h1>
            Paged<span>.</span>
          </h1>
          <p>
            Get paged. Fight a live production incident. Fix it with real system design, and walk away with an answer
            you can give in an interview.
          </p>
        </div>
        <div className="hero-actions">
          <a className="btn" href={href({ name: 'concepts' })}>
            🧠 Concepts
          </a>
          <button className="btn" onClick={onToggleSound} aria-pressed={progress.sound}>
            {progress.sound ? '🔊 Sound on' : '🔇 Sound off'}
          </button>
        </div>
      </header>

      <section className="worlds" aria-label="Worlds">
        {content.catalog.worlds.map((w) => {
          const incidents = content.byWorld.get(w.id) ?? [];
          const open = isWorldUnlocked(content, progress, w.id);
          return (
            <article key={w.id} className={`world${open ? '' : ' locked'}`}>
              <div className="world-head">
                <span className="world-emoji" aria-hidden>{w.emoji}</span>
                <h2>{w.title}</h2>
                {!open && <span className="muted">🔒</span>}
              </div>
              <p>{w.description}</p>
              {incidents.length === 0 ? (
                <p className="coming-soon">Coming soon.</p>
              ) : (
                <>
                  {!open && firstWorld && <p className="muted small">Finish every {firstWorld.title} incident to unlock.</p>}
                  <ul className="incidents">
                    {incidents.map((s) => {
                      const unlocked = isIncidentUnlocked(content, progress, s.id);
                      const body = (
                        <>
                          <span>
                            {unlocked ? '' : '🔒 '}
                            {s.title}
                          </span>
                          <span className="incident-meta">
                            <span>
                              {s.stage} · {'●'.repeat(s.difficulty)}
                              {'○'.repeat(5 - s.difficulty)}
                            </span>
                            <Stars n={progress.stars[s.id] ?? 0} />
                          </span>
                        </>
                      );
                      return (
                        <li key={s.id}>
                          {unlocked ? (
                            <a className="incident-link" href={href({ name: 'incident', id: s.id })}>
                              {body}
                            </a>
                          ) : (
                            <div className="incident-link locked" aria-disabled>
                              {body}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
