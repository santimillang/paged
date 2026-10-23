# Paged

Get paged. Fight a live production incident. Fix it with real system design, and walk away with an answer you can give in an interview.

Paged is a browser game for learning system design. Each incident drops you into a running architecture as it breaks: a traffic spike, a cold cache, a hot key. You investigate with live metrics, logs and traces, buy time with mitigations, and fix the root cause with a design change. Every incident ends with a debrief: what happened, the lesson, how real companies handle it, and an **Interview Moment** with a model answer.

> Work in progress: the URL Shortener world is playable; Twitter, Netflix, Discord and Ticketmaster are next. See [ROADMAP.md](ROADMAP.md).

## Run it

```bash
pnpm install
pnpm dev        # open the printed URL
```

## How it's built

- `packages/engine`: a deterministic flow simulation. Queueing math makes cascading timeouts, retry storms, cache stampedes and hot partitions emerge on their own instead of being scripted. ([How it works](docs/engine-model.md))
- `packages/scenarios`: every incident is one YAML file, and CI plays each one headless to prove it's solvable and teaches its lesson. ([Write one](docs/writing-scenarios.md))
- `apps/web`: React + React Flow + uPlot, fully client-side.

```bash
pnpm test       # unit tests (engine, scenarios, web)
pnpm validate   # play every scenario headless: do nothing loses, mitigation alone < 2★, the real fix wins
pnpm --filter @paged/web e2e   # a real browser plays the first incident to a win
```

MIT licensed.
