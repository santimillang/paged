import {
  createSimulation, scoreRun, type ActionRequest, type ApplyResult, type SimSnapshot, type Simulation, type Stars,
} from '@paged/engine';
import type { Scenario } from '@paged/scenarios';
import { useCallback, useEffect, useRef, useState } from 'react';

export type Speed = 0 | 1 | 2 | 4;

export interface RunSummary {
  scenarioId: string;
  outcome: 'won' | 'lost';
  stars: Stars;
  sim: Simulation;
  cluesUsed: number;
}

const TICK_MS = 100;

/** Owns one simulation run: ticks it in real time at the chosen speed and reports the result once. */
export function useIncident(scenario: Scenario, onDone: (r: RunSummary) => void) {
  const [sim] = useState(() => createSimulation(scenario.sim, { seed: scenario.seed }));
  const [snap, setSnap] = useState<SimSnapshot>(() => sim.snapshot());
  const [speed, setSpeed] = useState<Speed>(0);
  const [cluesUsed, setCluesUsed] = useState(0);
  const cluesRef = useRef(0);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (speed === 0) return;
    const id = window.setInterval(() => {
      sim.tick(speed);
      const s = sim.snapshot();
      setSnap(s);
      if (s.outcome === 'running' || doneRef.current) return;
      doneRef.current = true;
      window.clearInterval(id);
      const stars = scoreRun(
        {
          outcome: s.outcome,
          effectiveActions: sim.effectiveActions(),
          budgetFraction: s.stats.errorBudgetFraction,
          costPerHour: s.stats.costPerHour,
          cluesUsed: cluesRef.current,
        },
        scenario,
      );
      onDoneRef.current({ scenarioId: scenario.id, outcome: s.outcome, stars, sim, cluesUsed: cluesRef.current });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [speed, sim, scenario]);

  const apply = useCallback(
    (req: ActionRequest): ApplyResult => {
      const r = sim.apply(req);
      setSnap(sim.snapshot());
      return r;
    },
    [sim],
  );

  const revealClue = useCallback(() => {
    cluesRef.current = Math.min(scenario.clues.length, cluesRef.current + 1);
    setCluesUsed(cluesRef.current);
  }, [scenario]);

  return { sim, snap, speed, setSpeed, apply, cluesUsed, revealClue };
}
