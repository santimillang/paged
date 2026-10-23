import { content } from '../content';
import { conceptMastery, isIncidentUnlocked, type Progress } from '../progress';
import { href } from '../router';

export function Concepts({ progress }: { progress: Progress }) {
  const mastery = conceptMastery(content, progress);
  return (
    <main className="home">
      <header className="hero">
        <div>
          <h1>Concepts</h1>
          <p>
            Each dot is an incident you resolved with the right design fix (2★ or better). Fill in the ones you want to
            talk about confidently in an interview.
          </p>
        </div>
        <div className="hero-actions">
          <a className="btn" href={href({ name: 'map' })}>
            ← World map
          </a>
        </div>
      </header>
      <section className="concepts">
        {content.catalog.concepts.map((c) => {
          const m = mastery.get(c.id) ?? 0;
          const training = content.scenarios.filter((s) => s.concepts.includes(c.id));
          return (
            <article key={c.id} className="concept">
              <div className="concept-head">
                <h2>{c.title}</h2>
                <span className="dots" aria-label={`mastery ${m} of 4`}>
                  {'●'.repeat(m)}
                  {'○'.repeat(4 - m)}
                </span>
              </div>
              <p>{c.explainer}</p>
              {training.length === 0 ? (
                <span className="muted small">Incidents for this concept are coming soon.</span>
              ) : (
                training.map((s) =>
                  isIncidentUnlocked(content, progress, s.id) ? (
                    <a key={s.id} className="chip" href={href({ name: 'incident', id: s.id })}>
                      {s.title}
                    </a>
                  ) : (
                    <span key={s.id} className="chip">
                      🔒 {s.title}
                    </span>
                  ),
                )
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
