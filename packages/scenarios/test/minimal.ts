export const CONCEPTS = `
- { id: caching, title: Caching, explainer: x }
- { id: read-heavy, title: Read heavy, explainer: x }
`;
export const WORLDS = `
- { id: url-shortener, title: URL Shortener, emoji: "🔗", description: x, stages: ["1k users"] }
`;
export const MINIMAL = `
id: tiny
world: url-shortener
stage: "1k users"
order: 1
title: Tiny
difficulty: 1
concepts: [caching]
briefing: A tiny incident.
slo: { availability: 99.9, p99Ms: 800 }
errorBudgetSeconds: 60
seed: 1
architecture:
  nodes:
    - { id: lb, kind: lb }
    - { id: api, kind: service, instances: 2, capacityPerInstance: 500 }
    - { id: db, kind: db, capacityPerInstance: 1000 }
  edges: [[lb, api], [api, db]]
traffic:
  - { id: "GET /", path: [lb, api, db], rps: 500 }
faults:
  - { at: 5, type: traffic-spike, multiplier: 3 }
toolbox:
  mitigate: [scale]
  design: [add-cache]
win: { sloHealthyForSeconds: 30 }
requiredDesignFixes: [add-cache]
budgetTarget: 0.5
costTarget: 100
solution:
  - { at: 6, action: add-cache, target: db }
clues: ["Look at the db."]
debrief:
  whatHappened: x
  lesson: x
  realWorld: x
  interviewMoment: { question: q, modelAnswer: a }
  sources: []
`;
