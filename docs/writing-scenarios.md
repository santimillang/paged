# Writing a scenario

Every incident in Paged is one YAML file. No code. If you can describe an outage and what fixes it, you can add it to the game.

## Where files go

```
packages/scenarios/content/
  concepts.yaml                      # the concept list (mastery panel)
  worlds.yaml                        # worlds, their order and stages
  scenarios/<world>/<id>.yaml        # one incident
```

The folder name must match the scenario's `world`. `id`s are unique, and `order` is unique within a world.

## How a scenario is judged

`pnpm validate` plays every scenario headless, three times:

1. **Do nothing:** must **lose**.
2. **Mitigation only** (your `solution` with design actions removed): must get **fewer than 2 stars**.
3. **Full `solution`:** must **win with at least 2 stars**.

This proves the incident is solvable and actually teaches its design lesson. CI runs it on every PR.

**Tuning rule:** if validation fails, change the scenario's numbers (capacities, rps, budget, targets, solution timings), never the engine. Write the expected arithmetic in a comment at the top of the file, like the tutorial scenarios do, so reviewers can check it.

## Annotated example

See [`launch-day.yaml`](../packages/scenarios/content/scenarios/url-shortener/launch-day.yaml) for a complete file. Field by field:

| Field | Meaning |
|---|---|
| `id` | lowercase-dashes, unique |
| `world`, `stage`, `order` | where it sits on the world map; `stage` must be one of the world's stages |
| `title`, `briefing` | what the player reads before the pager goes off |
| `difficulty` | 1–5 |
| `concepts` | ids from `concepts.yaml`; they drive the mastery panel |
| `slo` | `availability` (percent) and `p99Ms` |
| `errorBudgetSeconds` | seconds of total outage the player can afford (partial outages burn proportionally) |
| `seed` | integer; makes traces reproducible |
| `timeLimitSeconds` | optional, default 600 |
| `architecture.nodes` | components (see node fields below) |
| `architecture.edges` | `[from, to]` pairs; must be acyclic |
| `traffic` | routes: `id`, `path` (must follow edges), `rps`, `readRatio` (0–1, default 1), optional `pattern` |
| `faults` | what goes wrong and when (see below) |
| `toolbox.mitigate` / `toolbox.design` | the actions the player gets |
| `win.sloHealthyForSeconds` | how long the SLO must hold after the last fault starts |
| `requiredDesignFixes` | any one of these, applied, unlocks 2 stars |
| `budgetTarget`, `costTarget` | 3-star efficiency thresholds (fraction of budget left, $/h at the end) |
| `solution` | the intended fix, as timed actions; used by `pnpm validate` |
| `clues` | nudges, from vague to specific; using one costs the third star |
| `debrief` | `whatHappened`, `lesson`, `realWorld`, `interviewMoment.{question, modelAnswer}`, `sources` |

### Node fields

`id`, `kind`, `label`, `instances`, `capacityPerInstance`, `writeCapacityPerInstance` (db), `baseLatencyMs`, `timeoutMs`, `poolSize`, `retryPolicy` (`{maxRetries, backoff: none|exponential, jitter}`), `costPerInstanceHour`, `hitRatio` and `warmRatePerSec` (cache/cdn), `partitioned` (cache/db).

### Faults

| Type | Params |
|---|---|
| `traffic-spike` | `multiplier`, optional `route`, optional `durationSec` |
| `latency-injection` | `target`, `addMs`, optional `durationSec` |
| `bad-deploy` | `target`, `errorRate` (fixed by `rollback`) |
| `instance-crash` | `target`, `count` |
| `cache-flush` | `target` |
| `hot-key` | `target` (a `partitioned` node), `share` |

Every fault has `at` (seconds).

### Actions

| Action | Category | Targets | Delay | Params |
|---|---|---|---|---|
| `scale` | mitigate | lb, service, cache, worker | 30s | `delta` (default 1) |
| `shed-load` | mitigate | lb, service | 2s | `percent` 0–90 |
| `rate-limit` | mitigate | lb, service | 5s | `rps` (0 removes) |
| `rollback` | mitigate | service, worker | 20s | none |
| `enable-autoscaling` | design | service, worker | 10s | `targetUtilization` 0.3–0.9 |
| `add-cache` | design | db, service, external | 20s | `hitRatio` (default 0.9) |
| `add-read-replica` | design | db | 30s | none |
| `add-cdn` | design | the first hop of a route | 30s | `hitRatio` (default 0.95) |
| `set-retry-policy` | design | lb, service, worker | 5s | `maxRetries`, `backoff`, `jitter` |
| `request-coalescing` | design | cache, cdn | 10s | none |
| `cache-warming` | design | cache, cdn | 10s | none |

Actions can target nodes created by earlier actions (`add-cache` on `db` creates `db-cache`) once those exist.

## Accuracy policy

Real company names are used descriptively, without logos. Every claim in `realWorld` must be backed by a public source in `sources`: an engineering blog, a conference talk or a public postmortem. **Open every URL before you commit** and confirm it says what you claim. If you can't find a source, frame the incident as a classic pattern and don't claim it happened at a specific company.
