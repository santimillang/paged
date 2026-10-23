import type { ActionId, ActionParams, SimScenario } from '@paged/engine';

export interface Concept {
  id: string;
  title: string;
  explainer: string;
}

export interface World {
  id: string;
  title: string;
  emoji: string;
  description: string;
  stages: string[];
}

export interface Catalog {
  concepts: Concept[];
  worlds: World[];
}

export interface SolutionStep {
  at: number;
  action: ActionId;
  target: string;
  params?: ActionParams;
}

export interface Debrief {
  whatHappened: string;
  lesson: string;
  realWorld: string;
  interviewMoment: { question: string; modelAnswer: string };
  sources: string[];
}

export interface Scenario {
  id: string;
  world: string;
  stage: string;
  order: number;
  title: string;
  difficulty: number;
  concepts: string[];
  briefing: string;
  seed: number;
  sim: SimScenario;
  toolbox: { mitigate: ActionId[]; design: ActionId[] };
  requiredDesignFixes: ActionId[];
  budgetTarget: number;
  costTarget: number;
  solution: SolutionStep[];
  clues: string[];
  debrief: Debrief;
}
