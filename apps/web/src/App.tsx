import { useEffect, useState } from 'react';
import { content } from './content';
import type { RunSummary } from './game/useIncident';
import { isIncidentUnlocked, loadProgress, recordStars, saveProgress, type Progress } from './progress';
import { go, parseHash, redirect, type Route } from './router';
import { Concepts } from './screens/Concepts';
import { Debrief } from './screens/Debrief';
import { Incident } from './screens/Incident';
import { WorldMap } from './screens/WorldMap';

function ToMap() {
  useEffect(() => redirect({ name: 'map' }), []);
  return null;
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [run, setRun] = useState<RunSummary | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const updateProgress = (f: (p: Progress) => Progress) =>
    setProgress((p) => {
      const next = f(p);
      saveProgress(next);
      return next;
    });

  if (route.name === 'concepts') return <Concepts progress={progress} />;

  if (route.name === 'incident') {
    const scenario = content.byId.get(route.id);
    if (!scenario || !isIncidentUnlocked(content, progress, scenario.id)) return <ToMap />;
    return (
      <Incident
        key={`${scenario.id}#${attempt}`}
        scenario={scenario}
        sound={progress.sound}
        onDone={(r) => {
          setRun(r);
          updateProgress((p) => recordStars(p, r.scenarioId, r.stars));
          go({ name: 'debrief', id: r.scenarioId });
        }}
      />
    );
  }

  if (route.name === 'debrief') {
    const scenario = content.byId.get(route.id);
    if (!scenario || !run || run.scenarioId !== scenario.id) return <ToMap />;
    const list = content.byWorld.get(scenario.world) ?? [];
    const next = list[list.findIndex((s) => s.id === scenario.id) + 1];
    return (
      <Debrief
        run={run}
        scenario={scenario}
        nextId={next && isIncidentUnlocked(content, progress, next.id) ? next.id : null}
        onRetry={() => {
          setAttempt((a) => a + 1);
          go({ name: 'incident', id: scenario.id });
        }}
      />
    );
  }

  return <WorldMap progress={progress} onToggleSound={() => updateProgress((p) => ({ ...p, sound: !p.sound }))} />;
}
