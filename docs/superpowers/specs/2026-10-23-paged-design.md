# Paged — Design Spec

**Date:** 2026-10-23
**Status:** Draft, awaiting review
**One-liner:** A browser game where you get paged, fight a live production incident, fix it with real system design, and walk away with an answer you can give in a system design interview.

---

## 1. Goals

1. **Learning tool first.** Every incident teaches one or more system design concepts and ends with an interview-ready takeaway.
2. **Fun.** Gamified as much as possible: live pressure, visible consequences, stars, progression, a world map.
3. **Portfolio flagship.** Public from day one, playable from a link, impressive to recruiters and credible to engineers.
4. **Scales in content.** Adding a scenario is one YAML file, no code. Built for "as many scenarios as possible" and for community PRs.

### Non-goals (v1)

- Build mode (designing from an empty canvas). The architecture must allow it, but it doesn't ship in v1.
- A terminal or query languages (kubectl, PromQL). The UI is click-driven only.
- Accounts, backend, leaderboards. Progress lives in localStorage.
- Vanity badges or rank titles. Rewards only reflect learning (see §5.4).

## 2. Audience

- **Primary:** engineers preparing for system design and SRE interviews, the author included.
- **Secondary:** recruiters and hiring managers who click the link. A non-engineer must be able to play the first (tutorial) world.

## 3. Architecture overview

A pnpm monorepo, fully client-side, deployed as a static site.

```
packages/
  engine/      Pure TypeScript simulation. No UI or DOM dependencies. Deterministic.
  scenarios/   YAML scenarios, worlds.yaml, concepts.yaml, Zod schema, loader, headless test harness.
apps/
  web/         React + Vite UI.
docs/
  writing-scenarios.md   Contributor guide + template.
  engine-model.md        The math behind the simulation.
ROADMAP.md
```

**Stack:** TypeScript (strict), React, Vite, React Flow (architecture map), uPlot (live charts), Zustand (UI state), Zod + `yaml` (scenario validation), Vitest (tests), GitHub Actions (CI), Vercel or GitHub Pages (hosting).

**Dependency rule:** `apps/web` depends on `engine` and `scenarios`. `scenarios` depends on `engine` (types and the headless runner). `engine` depends on nothing in the repo.

## 4. Simulation engine (`packages/engine`)

### 4.1 Model

A flow-based simulation driven by queueing math. Traffic moves as **rates** (RPS), not individual requests.

- **Graph:** nodes (components) and directed edges (calls).
- **Node kinds:** `client`, `cdn`, `lb`, `service`, `cache`, `db`, `queue`, `worker`, `external`.
- **Common node params:** `instances`, `capacityPerInstance` (RPS), `baseLatencyMs`, `timeoutMs` (for calls it makes), `poolSize` (concurrent outbound calls), `retryPolicy` (`{ maxRetries, backoff: none|exponential, jitter: bool }`), `costPerInstanceHour`.
- **Kind-specific state:**
  - `cache`: `hitRatio` (current), `targetHitRatio`, `warmRate` (how fast hit ratio recovers), `writeThrough` flag.
  - `db`: `readCapacity`, `writeCapacity`, `replicas`, `partitions` with a per-partition load distribution (for hot keys and partitions).
  - `queue`: `depth`, `maxDepth`; consumed by `worker` nodes.
  - `external`: has a fixed latency/error profile and can't be scaled.
- **Routes:** named traffic flows (`GET /home`) with a path through the graph, a read/write mix, and a traffic pattern (`flat`, `daily`, `evening-peak`, `spike`, `ramp`, or explicit points).

### 4.2 Tick loop

Fixed step of 100 ms simulated time. Each tick:

1. **Inflow.** Compute each route's current RPS, add retry traffic carried over from the previous tick, and propagate through the graph. Caches split flow into hits (stop) and misses (continue). LBs split evenly across healthy targets.
2. **Utilization.** `ρ = inflow / effectiveCapacity`, where effective capacity accounts for healthy instances and fault modifiers.
3. **Latency.** `latency = baseLatency / (1 − min(ρ, 0.99))`, plus downstream latency on the path, capped at a large value. p50 and p99 are derived from that with a fixed spread model, documented in `engine-model.md`.
4. **Errors.** Load beyond capacity is rejected (`ρ > 1` → error fraction `1 − 1/ρ`). Fault error rates are added on top.
5. **Timeouts and pool exhaustion.** If downstream latency exceeds the caller's `timeoutMs`, those calls error. Caller concurrency is `inflow × latency` (Little's Law). If it exceeds `poolSize`, the caller rejects the excess. This makes cascading failure emergent.
6. **Retries.** Errored calls are retried per the caller's policy and added to the next tick's inflow. Without jitter, retries synchronize, which shows up as a load multiplier spike. With jitter, they spread.
7. **State updates.** Caches move toward their target hit ratio at `warmRate`. Queue depth changes by `inflow − consumption`. Pending actions whose delay has elapsed take effect.
8. **Outputs.** Emit metrics, logs and sampled traces (§4.4) and global stats.

All randomness comes from a seeded PRNG. Same seed plus the same action log gives an identical run.

### 4.3 Faults and actions

**Faults** are timed events from the scenario: `instance-crash`, `latency-injection`, `bad-deploy` (error-rate up, rollback-able), `traffic-spike`, `cache-flush`, `hot-key` (skews partition distribution), `dependency-down`, `region-down`, `disk-full`, `connection-leak`.

**Actions** are what the player does. Each has a target type, a `delay` before it takes effect and a `cost` (one-off and/or $/h). Actions are grouped as:

- **Mitigate** (fast, buys time, rarely fixes the root cause): `scale`, `rollback`, `shed-load`, `rate-limit`, `failover`, `restart`, `drain-node`.
- **Fix design** (slower, addresses the root cause): `add-cache`, `add-read-replica`, `add-queue`, `add-circuit-breaker`, `add-bulkhead`, `set-retry-policy`, `request-coalescing`, `cache-warming`, `add-cdn`, `shard-key-change`, `add-waiting-room`, `idempotency-keys`, `fan-out-hybrid`, `jittered-reconnect`.

Each action declares placement rules (`add-read-replica` targets a `db`). The engine validates placement and returns a clear reason when it rejects one.

Some patterns (`fan-out-hybrid`, `idempotency-keys`) are modelled as **node modifiers**: they change a node's parameters or behaviour, such as write amplification or duplicate-write rate, rather than adding nodes.

### 4.4 Outputs

- **Metrics** per node per tick: `rps`, `p50`, `p99`, `errorRate`, `utilization`, plus kind-specific ones (`hitRatio`, `queueDepth`, `poolInUse`, `replicationLag`). Ring buffer of the last 10 minutes.
- **Logs:** templated lines emitted on threshold crossings and events ("connection pool exhausted (200/200)", "upstream timeout after 1000ms calling db", "cache miss rate 87%"). Rate-limited so they stay readable.
- **Traces:** each second, a few sampled requests per route, built from the current per-node latencies and error probabilities, as span trees.
- **Global stats:** SLO health (availability and latency against the scenario's SLO), error budget remaining, users online (churns when the SLO is breached), cost per hour, simulated clock.

### 4.5 Public API (sketch)

```ts
const sim = createSimulation(scenario, { seed });
sim.tick(n?);                       // advance n ticks
sim.apply(action): Result<void, PlacementError>;
sim.snapshot(): SimSnapshot;        // graph + current metrics + stats
sim.history(nodeId, metric): Series;
sim.logs(sinceTick), sim.traces(sinceTick);
sim.outcome(): 'running' | 'won' | 'lost';
sim.actionLog(): ActionLogEntry[];  // for replay/share later
```

## 5. Game design

### 5.1 Structure

- **World map:** worlds are either classic interview problems or real companies. Each world is a path of stages that grow in scale (1k → 100M users), with one or more incidents per stage. Worlds unlock in order (the URL Shortener tutorial unlocks everything else). Incidents within a world unlock sequentially.
- **Concept panel:** one entry per concept in `concepts.yaml`, with mastery dots (0–4) and an explainer paragraph. Lists the incidents tagged with that concept so players can drill weak areas.
- **Mastery rule:** each concept's mastery is the number of distinct incidents tagged with it that were completed with ≥2★, capped at 4.

### 5.2 Incident loop

1. Briefing card: world, stage, a short story, the SLO.
2. Sim starts calm. The fault fires at its scheduled time and a **page** appears (sound + toast).
3. **Investigate:** click nodes to see Metrics, Logs and Traces in the inspector.
4. **Mitigate:** buy time.
5. **Fix the design:** pick a card, click a target node, wait out its delay.
6. **Win** when the scenario's win condition holds (e.g. SLO healthy for 60 simulated seconds, after the fault). **Lose** when the error budget hits zero.
7. **Debrief** (§5.5).

Speed controls: pause, 1×, 2×, 4×. Pausing is always allowed. Scores use simulated time, so pausing is fair.

### 5.3 Incident screen layout

- **Top bar:** page message, sim clock, speed controls, SLO health bar, error budget, users online (trending), cost per hour.
- **Centre:** live architecture map (React Flow). Edge thickness shows traffic and colour shows health. Nodes show status effects: 🔥 overloaded, ❄️ cold cache, ⏳ pending action.
- **Right:** inspector for the selected node, with Metrics / Logs / Traces tabs.
- **Bottom:** two toolboxes, 🚒 Mitigate and 🏗️ Fix design, limited to the scenario's `toolbox`. Plus a 💡 Clue button.

### 5.4 Scoring

- ★ Resolved (won).
- ★★ Resolved **and** at least one of the scenario's `requiredDesignFixes` was applied. A win from mitigation alone caps at 1★.
- ★★★ The above plus: finished with ≥ the scenario's `budgetTarget` of error budget left, under the `costTarget`, and no clues used.

Wrong fixes behave as the model dictates (a cache on a write-heavy path doesn't help; retries without jitter make things worse). The debrief calls out which of the player's actions helped, did nothing or hurt.

Best stars per incident are saved in localStorage.

### 5.5 Debrief

- **Timeline:** key graphs for the incident with the fault and the player's actions overlaid.
- **What happened:** the causal chain in plain language.
- **Your actions:** each one tagged as helped / neutral / hurt, with a one-line reason.
- **The lesson:** the design concept(s).
- **Real world:** how the named company (or the industry) handled it.
- **Interview Moment:** an interview-style question. The player can reveal the model answer.
- **Sources:** links.

## 6. Scenarios (`packages/scenarios`)

### 6.1 Format

One YAML file per incident at `scenarios/<world>/<id>.yaml`. Fields:

```yaml
id: netflix-cache-stampede
world: netflix
stage: "10M users"
order: 2
title: "Friday night, the cache went cold"
difficulty: 2                 # 1–5
concepts: [caching, thundering-herd, request-coalescing]
briefing: "..."
slo: { availability: 99.9, p99Ms: 500 }
errorBudgetSeconds: 300
seed: 42

architecture:
  nodes: [...]
  edges: [...]
traffic: [...]
faults: [...]

toolbox:
  mitigate: [scale, shed-load, rate-limit]
  design: [request-coalescing, cache-warming, add-read-replica]

win: { sloHealthyForSeconds: 60 }
requiredDesignFixes: [request-coalescing, cache-warming]   # any one counts for ★★
budgetTarget: 0.5             # fraction of budget left for ★★★
costTarget: 600               # $/h at win time for ★★★

solution:                     # used by headless CI
  - { at: 25s, action: shed-load, target: api, params: { percent: 20 } }
  - { at: 30s, action: request-coalescing, target: cache }

clues: ["..."]
debrief:
  whatHappened: "..."
  lesson: "..."
  realWorld: "..."
  interviewMoment: { question: "...", modelAnswer: "..." }
  sources: ["https://..."]
```

`worlds.yaml` lists worlds in order with title, description, emoji and stage names. `concepts.yaml` lists concept ids, titles and explainers. The Zod schema checks that every `concepts`, `world`, `action` and node reference resolves.

### 6.2 Headless verification (CI)

For every scenario, the harness runs the engine with no UI three times and asserts:

1. **No actions:** the outcome is `lost`.
2. **Mitigation-only** (the `solution` with design actions removed): the run does not reach ★★.
3. **Full `solution`:** the outcome is `won` with ≥2★.

Failures report the scenario id and the final stats. This keeps every scenario solvable and meaningful while the engine gets tuned.

### 6.3 Accuracy policy

Real company names are used as-is, descriptively, without logos. Every `realWorld` claim must be backed by a public source in `sources` (engineering blog, conference talk, or public postmortem), checked when the scenario is written. If no source can be found, the scenario is framed as a classic pattern and doesn't claim to be the company's actual event.

### 6.4 v1 content: 5 worlds, 13 incidents

| World | Incident | Concepts |
|---|---|---|
| 🔗 URL Shortener (tutorial) | Launch day traffic spike | horizontal-scaling, load-balancing |
| | DB drowning in reads | caching, read-heavy |
| | One link goes viral | hot-keys, local-caching |
| 🐦 Twitter | A celebrity tweets to 100M followers | fan-out, hybrid-feeds |
| | Timeline cache restart | thundering-herd, cache-warming |
| 🎬 Netflix | A slow dependency takes down the API | circuit-breakers, bulkheads |
| | A whole AWS region goes dark | multi-region, failover |
| | Retry storm | retries, backoff, jitter |
| 💬 Discord | A hot partition in a huge server | partitioning, request-coalescing |
| | Millions reconnect after a blip | thundering-herd, jitter |
| | Message fan-out lag | queues, backpressure |
| 🎟️ Ticketmaster | Eras Tour presale | rate-limiting, waiting-rooms |
| | Overselling seats | consistency, idempotency, locking |

## 7. Persistence

localStorage under a versioned key (`paged:v1`): stars per incident, clues used, settings (sound, speed). All reads and writes are wrapped in try/catch, and the game works with storage unavailable (progress just isn't kept).

## 8. Testing

- **Engine unit tests (Vitest):** utilization and latency curves, overload error fraction, Little's Law pool exhaustion, timeout propagation, retry amplification with and without jitter, cache warm-up, queue depth, action delays and placement validation, determinism (same seed gives identical snapshots).
- **Scenario schema tests:** every YAML file parses and resolves.
- **Headless scenario tests:** §6.2.
- **Web:** component tests for scoring and the debrief action classification. A Playwright smoke test that loads the tutorial incident, applies its solution through the UI and sees the debrief.

## 9. CI/CD and repo

- GitHub Actions: typecheck, lint, unit tests, schema and headless scenario tests, web build. Required on PRs.
- Every push to `main` deploys. PRs get preview deploys.
- README: hero GIF, "Play now" link, what you'll learn, concept list, "Write a scenario" link, how the engine works.
- `ROADMAP.md`: more worlds (Spotify, Uber, WhatsApp, Stripe, YouTube), famous outages (GitHub 2018 split-brain, Cloudflare 2019 regex CPU, Facebook 2021 BGP, Slack January 2021), build mode, replay/share via URL, 3D city renderer.
- License: MIT.

## 10. Future features and how they plug in

- **Build mode:** a new web route using the same engine and the same design-action palette, starting from an empty graph with requirements (RPS, p99, cost). No engine changes needed beyond requirement checks.
- **Replay/share:** seed + action log encoded in the URL.
- **Alternative renderers** (e.g. 3D city): consume `snapshot()` only.

## 11. Open risks

- **Engine feel.** Tuning will take iteration. Mitigated by the headless tests, which pin intended behaviour per scenario.
- **Scenario authoring time.** The debrief and its sources are the slow part. The template and the accuracy policy keep the quality consistent.
- **Modelling fidelity for some patterns** (fan-out, consistency/overselling) needs node modifiers rather than pure flow math. These are scoped per action in §4.3 and verified by their scenarios' headless tests.
