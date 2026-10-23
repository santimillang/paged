# Paged Foundation (Plan 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pnpm monorepo with a tested, deterministic simulation engine, a scenario package (schema, loader, headless verifier, CLI), and the 3-incident URL Shortener tutorial world proven solvable by CI.

**Architecture:** `packages/engine` is a pure-TypeScript flow simulation: traffic moves as rates through a DAG of components every 100 ms tick, and queueing math produces latency, overload errors, timeouts, pool exhaustion and retries. `packages/scenarios` turns YAML files into engine input, validates cross-references, and runs each scenario headless three ways (no actions / mitigation only / full solution) to prove it teaches its lesson. There is no UI in this plan.

**Tech Stack:** TypeScript 5 (strict), pnpm 10 workspaces, Vitest, Zod 3, `yaml`, `tsx`, GitHub Actions. Node ≥ 22.

**Spec:** `docs/superpowers/specs/2026-10-23-paged-design.md`

**Plan series:** Plan 1 (this one) is the foundation. Plan 2 is the web app (React UI, debrief, scoring UI, deploy, README GIF). Plan 3 is content: Twitter, Netflix, Discord and Ticketmaster, plus the engine actions/faults they need (circuit breaker, bulkhead, failover/regions, queues/workers, waiting room, idempotency, fan-out, jittered reconnect).

## Global Constraints

- Engine has **zero** runtime dependencies and no DOM/UI imports.
- Same seed + same action log ⇒ identical run (all randomness via the seeded PRNG in `rng.ts`).
- Tick = 100 ms simulated time (`DT = 0.1`).
- Scenario content is data only: one YAML per incident at `packages/scenarios/content/scenarios/<world>/<id>.yaml`.
- Every scenario must pass the headless checks: none ⇒ `lost`; mitigation-only ⇒ < 2★; full solution ⇒ `won` with ≥ 2★.
- Real company names are used descriptively. Every `debrief.sources` URL must be fetched and confirmed live before commit. No invented facts about real companies.
- TypeScript `strict: true`. Packages are consumed as source (`exports` → `./src/index.ts`), with no build step.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Deviations from the spec (intentional, small):**
- Scenario times are plain numbers in seconds (`at: 20`), not `"20s"` strings.
- The design action `enable-autoscaling` is added (needed by the tutorial's horizontal-scaling lesson).
- The viral-link incident teaches `edge-caching` (CDN) instead of `local-caching`.
- Shed-load and rate-limit rejections count as errors. The error budget burns in proportion to the error rate above the SLO allowance, plus a flat 0.25/s while p99 breaches the SLO. So mitigation slows the burn but can't produce a win.

## Review Focus

1. **Zero-traffic and zero-instance nodes** (e.g. all instances crashed, or a route with `rps: 0`). Expected: no `NaN`/`Infinity` in stats. A node with 0 instances rejects everything it receives. Pinned in Task 4 (`instance-crash to zero`).
2. **Actions on nodes created by earlier actions** (e.g. `request-coalescing` on `db-cache` after `add-cache`). Expected: the new node is targetable once the creating action is effective, and is rejected with a clear reason before that. Pinned in Task 5.
3. **Two topology-changing actions in a row** (add-cache, then add-cdn). Expected: route paths stay valid edge chains and the topo order stays acyclic. Pinned in Task 5.
4. **Scenario typo in a reference** (unknown node in a route, unknown concept, design action listed under mitigate). Expected: the loader fails with a message naming the file and the field, never a crash inside the engine. Pinned in Task 8.
5. **Simulation keeps ticking after the outcome is decided.** Expected: `tick()` is a no-op once `won`/`lost`, and `apply()` returns `{ ok: false }`. Pinned in Task 6.

---

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore, .gitattributes, LICENSE, ROADMAP.md
.github/workflows/ci.yml
docs/engine-model.md, docs/writing-scenarios.md
packages/engine/
  package.json, tsconfig.json
  src/types.ts        public types (specs, actions, outputs)
  src/rng.ts          seeded PRNG
  src/queueing.ts     pure math: utilization, latency, overload, timeouts, pools, retries
  src/traffic.ts      traffic pattern multipliers
  src/graph.ts        RuntimeNode, defaults, validation, topo order, insertBefore
  src/state.ts        SimState, RuntimeRoute, createState, rebuildTopology
  src/faults.ts       fault start/expiry and per-tick fault modifiers
  src/step.ts         one tick: flows, latency/success, retries, caches, stats
  src/actions.ts      action registry, requestAction, applyDueActions
  src/autoscale.ts    autoscaler
  src/logbook.ts      LogBook, History (bounded buffers)
  src/outputs.ts      threshold logs, traces, metrics history recording, snapshots
  src/scoring.ts      stars
  src/simulation.ts   public createSimulation API
  src/index.ts        public exports
  test/fixtures.ts, test/*.test.ts
packages/scenarios/
  package.json, tsconfig.json
  src/schema.ts       Zod schemas
  src/types.ts        Scenario, Concept, World, Catalog
  src/parse.ts        parseCatalog, parseScenario, ScenarioError
  src/headless.ts     runHeadless, checkScenario
  src/node-loader.ts  disk loading (Node only)
  src/cli.ts          `pnpm validate` report
  src/index.ts        browser-safe exports
  content/concepts.yaml, content/worlds.yaml
  content/scenarios/url-shortener/{launch-day,read-heavy,viral-link}.yaml
  test/*.test.ts
```

---

### Task 1: Monorepo scaffold + seeded PRNG

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.gitattributes`, `LICENSE`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/src/rng.ts`
- Test: `packages/engine/test/rng.test.ts`

**Interfaces:**
- Produces: `type Rng = () => number`, `createRng(seed: number): Rng` (values in `[0, 1)`).

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "paged",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.30.3",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "validate": "pnpm --filter @paged/scenarios validate"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
  - apps/*
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  }
}
```

`.gitignore`:
```
node_modules/
dist/
coverage/
*.log
.DS_Store
```

`.gitattributes`:
```
* text=auto eol=lf
```

`LICENSE`: the standard MIT license text, `Copyright (c) 2026 santimillang`.

- [ ] **Step 2: Engine package**

`packages/engine/package.json`:
```json
{
  "name": "@paged/engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

`packages/engine/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run: `cd D:/repos/paged && pnpm --filter @paged/engine add -D typescript vitest @types/node`
Expected: installs, creates `pnpm-lock.yaml`.

- [ ] **Step 3: Write the failing test** — `packages/engine/test/rng.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { createRng } from '../src/rng';

describe('createRng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(42), b = createRng(42);
    const xs = Array.from({ length: 5 }, () => a());
    const ys = Array.from({ length: 5 }, () => b());
    expect(xs).toEqual(ys);
  });

  it('differs across seeds', () => {
    expect(createRng(1)()).not.toEqual(createRng(2)());
  });

  it('returns values in [0, 1)', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `pnpm --filter @paged/engine test`
Expected: FAIL, cannot resolve `../src/rng`.

- [ ] **Step 5: Implement** — `packages/engine/src/rng.ts`

```ts
export type Rng = () => number;

/** mulberry32: small, fast, good enough for simulation sampling. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @paged/engine test && pnpm --filter @paged/engine typecheck`
Expected: 3 passed; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo and engine PRNG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Queueing math and traffic patterns

**Files:**
- Create: `packages/engine/src/queueing.ts`, `packages/engine/src/traffic.ts`, `packages/engine/src/types.ts`
- Test: `packages/engine/test/queueing.test.ts`, `packages/engine/test/traffic.test.ts`

**Interfaces:**
- Produces (`queueing.ts`): `MAX_RHO = 0.99`, `utilization(load, capacity): number`, `queueLatency(baseMs, rho): number`, `overloadAcceptFraction(rho): number`, `p99FromMean(meanMs, rho): number`, `timeoutFraction(meanDownstreamMs, timeoutMs): number`, `concurrency(rps, latencyMs): number`, `poolAcceptFraction(needed, pool): number`, `expectedRetries(failRate, maxRetries): number`.
- Produces (`traffic.ts`): `patternMultiplier(pattern: TrafficPattern | undefined, t: number): number`.
- Produces (`types.ts`): every public engine type, used by all later tasks.

- [ ] **Step 1: Write `packages/engine/src/types.ts`** (types only, nothing to test on its own)

```ts
export type NodeKind =
  | 'client' | 'cdn' | 'lb' | 'service' | 'cache' | 'db' | 'queue' | 'worker' | 'external';

export interface RetryPolicy {
  maxRetries: number;
  backoff: 'none' | 'exponential';
  jitter: boolean;
}

export interface NodeSpec {
  id: string;
  kind: NodeKind;
  label?: string;
  instances?: number;
  /** Requests per second one instance can serve (reads, for db). */
  capacityPerInstance?: number;
  /** db only: writes per second per instance. Defaults to capacityPerInstance. */
  writeCapacityPerInstance?: number;
  baseLatencyMs?: number;
  /** Timeout this node applies to calls it makes downstream. */
  timeoutMs?: number;
  /** Max concurrent outbound calls per instance. */
  poolSize?: number;
  retryPolicy?: RetryPolicy;
  costPerInstanceHour?: number;
  /** cache/cdn: starting and target hit ratio. */
  hitRatio?: number;
  /** cache/cdn: hit ratio recovered per second. */
  warmRatePerSec?: number;
  /** cache/db: each instance owns a key range (hot keys hurt). */
  partitioned?: boolean;
}

export interface EdgeSpec {
  from: string;
  to: string;
}

export type TrafficPattern =
  | { type: 'flat' }
  | { type: 'ramp'; from: number; to: number; startAt: number; endAt: number }
  | { type: 'daily'; periodSec: number; amplitude: number };

export interface RouteSpec {
  id: string;
  path: string[];
  rps: number;
  /** Fraction of requests that are reads (cacheable). Default 1. */
  readRatio?: number;
  pattern?: TrafficPattern;
}

export type FaultSpec =
  | { at: number; type: 'traffic-spike'; route?: string; multiplier: number; durationSec?: number }
  | { at: number; type: 'latency-injection'; target: string; addMs: number; durationSec?: number }
  | { at: number; type: 'bad-deploy'; target: string; errorRate: number }
  | { at: number; type: 'instance-crash'; target: string; count: number }
  | { at: number; type: 'cache-flush'; target: string }
  | { at: number; type: 'hot-key'; target: string; share: number };

export type FaultType = FaultSpec['type'];

export interface SloSpec {
  /** Percent, e.g. 99.9 */
  availability: number;
  p99Ms: number;
}

export interface SimScenario {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  routes: RouteSpec[];
  faults: FaultSpec[];
  slo: SloSpec;
  errorBudgetSeconds: number;
  win: { sloHealthyForSeconds: number };
  /** Lose when reached. Default 600. */
  timeLimitSeconds?: number;
  /** Default 1_000_000. */
  baseUsers?: number;
}

export const ACTION_IDS = [
  'scale', 'shed-load', 'rate-limit', 'rollback',
  'enable-autoscaling', 'add-cache', 'add-read-replica', 'add-cdn',
  'set-retry-policy', 'request-coalescing', 'cache-warming',
] as const;
export type ActionId = (typeof ACTION_IDS)[number];
export type ActionCategory = 'mitigate' | 'design';

export type ActionParams = Record<string, number | boolean | string>;

export interface ActionRequest {
  action: ActionId;
  target: string;
  params?: ActionParams;
}

export type ApplyResult = { ok: true; effectiveAt: number } | { ok: false; reason: string };

export type Outcome = 'running' | 'won' | 'lost';
export type Health = 'ok' | 'warn' | 'crit';

export interface NodeMetrics {
  rps: number;
  p50Ms: number;
  p99Ms: number;
  errorRate: number;
  utilization: number;
  hitRatio?: number;
  poolInUse?: number;
}
export type MetricName = keyof NodeMetrics;

export interface GlobalStats {
  t: number;
  availability: number;
  worstP99Ms: number;
  sloHealthy: boolean;
  errorBudgetRemaining: number;
  errorBudgetFraction: number;
  usersOnline: number;
  costPerHour: number;
}

export interface LogEntry {
  t: number;
  level: 'info' | 'warn' | 'error';
  nodeId?: string;
  message: string;
}

export interface Span {
  nodeId: string;
  startMs: number;
  durationMs: number;
  error: boolean;
}

export interface Trace {
  id: string;
  t: number;
  routeId: string;
  durationMs: number;
  error: boolean;
  spans: Span[];
}

export interface PendingAction {
  request: ActionRequest;
  effectiveAt: number;
}

export interface ActionLogEntry {
  t: number;
  request: ActionRequest;
  status: 'scheduled' | 'effective';
}

export interface NodeSnapshot {
  id: string;
  kind: NodeKind;
  label: string;
  instances: number;
  health: Health;
  metrics: NodeMetrics;
}

export interface RouteSnapshot {
  id: string;
  path: string[];
  offeredRps: number;
  availability: number;
  meanMs: number;
  p99Ms: number;
}

export interface SimSnapshot {
  t: number;
  outcome: Outcome;
  nodes: NodeSnapshot[];
  edges: EdgeSpec[];
  routes: RouteSnapshot[];
  stats: GlobalStats;
  pending: PendingAction[];
}

export interface Series {
  t: number[];
  v: number[];
}
```

- [ ] **Step 2: Write the failing tests**

`packages/engine/test/queueing.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  concurrency, expectedRetries, overloadAcceptFraction, p99FromMean,
  poolAcceptFraction, queueLatency, timeoutFraction, utilization,
} from '../src/queueing';

describe('queueing math', () => {
  it('utilization is load over capacity, infinite with no capacity', () => {
    expect(utilization(50, 100)).toBe(0.5);
    expect(utilization(0, 0)).toBe(0);
    expect(utilization(10, 0)).toBe(Infinity);
  });

  it('latency follows the hockey stick and is capped at rho 0.99', () => {
    expect(queueLatency(10, 0)).toBe(10);
    expect(queueLatency(10, 0.5)).toBeCloseTo(20);
    expect(queueLatency(10, 0.9)).toBeCloseTo(100);
    expect(queueLatency(10, 5)).toBeCloseTo(1000);
  });

  it('overload rejects the excess', () => {
    expect(overloadAcceptFraction(0.8)).toBe(1);
    expect(overloadAcceptFraction(2)).toBe(0.5);
    expect(overloadAcceptFraction(Infinity)).toBe(0);
  });

  it('p99 spreads further from the mean as utilization rises', () => {
    expect(p99FromMean(100, 0)).toBe(200);
    expect(p99FromMean(100, 1)).toBe(500);
    expect(p99FromMean(100, 3)).toBe(500);
  });

  it('timeout fraction assumes exponential latency', () => {
    expect(timeoutFraction(0, 1000)).toBe(0);
    expect(timeoutFraction(1000, 1000)).toBeCloseTo(Math.exp(-1));
    expect(timeoutFraction(10, 1000)).toBeLessThan(1e-40);
  });

  it("Little's law concurrency and pool acceptance", () => {
    expect(concurrency(1000, 50)).toBe(50);
    expect(poolAcceptFraction(50, 100)).toBe(1);
    expect(poolAcceptFraction(400, 100)).toBe(0.25);
  });

  it('expected retries per failed request', () => {
    expect(expectedRetries(0, 3)).toBe(1);
    expect(expectedRetries(1, 3)).toBe(3);
    expect(expectedRetries(0.5, 3)).toBeCloseTo(1.75);
    expect(expectedRetries(0.5, 0)).toBe(0);
  });
});
```

`packages/engine/test/traffic.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { patternMultiplier } from '../src/traffic';

describe('patternMultiplier', () => {
  it('defaults to flat', () => {
    expect(patternMultiplier(undefined, 123)).toBe(1);
    expect(patternMultiplier({ type: 'flat' }, 5)).toBe(1);
  });

  it('ramps linearly between startAt and endAt', () => {
    const p = { type: 'ramp' as const, from: 1, to: 3, startAt: 10, endAt: 20 };
    expect(patternMultiplier(p, 0)).toBe(1);
    expect(patternMultiplier(p, 15)).toBe(2);
    expect(patternMultiplier(p, 99)).toBe(3);
  });

  it('daily oscillates around 1', () => {
    const p = { type: 'daily' as const, periodSec: 100, amplitude: 0.5 };
    expect(patternMultiplier(p, 0)).toBeCloseTo(1);
    expect(patternMultiplier(p, 25)).toBeCloseTo(1.5);
    expect(patternMultiplier(p, 75)).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm --filter @paged/engine test`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`packages/engine/src/queueing.ts`:
```ts
export const MAX_RHO = 0.99;

export function utilization(load: number, capacity: number): number {
  if (capacity <= 0) return load > 0 ? Infinity : 0;
  return load / capacity;
}

/** M/M/1-style mean latency: explodes as utilization approaches 1. */
export function queueLatency(baseMs: number, rho: number): number {
  return baseMs / (1 - Math.min(rho, MAX_RHO));
}

/** Fraction of requests served when offered load exceeds capacity. */
export function overloadAcceptFraction(rho: number): number {
  return rho <= 1 ? 1 : 1 / rho;
}

/** Tail spread grows with utilization: 2x mean when idle, 5x when saturated. */
export function p99FromMean(meanMs: number, rho: number): number {
  return meanMs * (2 + 3 * Math.min(Math.max(rho, 0), 1));
}

/** P(latency > timeout) for an exponential distribution with the given mean. */
export function timeoutFraction(meanDownstreamMs: number, timeoutMs: number): number {
  if (meanDownstreamMs <= 0) return 0;
  return Math.exp(-timeoutMs / meanDownstreamMs);
}

/** Little's law: in-flight requests = arrival rate x time in system. */
export function concurrency(rps: number, latencyMs: number): number {
  return rps * (latencyMs / 1000);
}

export function poolAcceptFraction(needed: number, pool: number): number {
  return needed <= pool ? 1 : pool / needed;
}

/** Expected retry attempts per originally failed request (each retry fails with failRate). */
export function expectedRetries(failRate: number, maxRetries: number): number {
  let total = 0;
  let p = 1;
  for (let i = 0; i < maxRetries; i++) {
    total += p;
    p *= failRate;
  }
  return total;
}
```

`packages/engine/src/traffic.ts`:
```ts
import type { TrafficPattern } from './types';

export function patternMultiplier(p: TrafficPattern | undefined, t: number): number {
  if (!p || p.type === 'flat') return 1;
  if (p.type === 'ramp') {
    if (t <= p.startAt) return p.from;
    if (t >= p.endAt) return p.to;
    return p.from + (p.to - p.from) * ((t - p.startAt) / (p.endAt - p.startAt));
  }
  return 1 + p.amplitude * Math.sin((2 * Math.PI * t) / p.periodSec);
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @paged/engine test && pnpm --filter @paged/engine typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): queueing math, traffic patterns and public types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Graph runtime, validation and topology

**Files:**
- Create: `packages/engine/src/graph.ts`
- Test: `packages/engine/test/graph.test.ts`

**Interfaces:**
- Consumes: types from `types.ts`.
- Produces:
  - `interface RuntimeNode` (fields below).
  - `resolveNode(spec: NodeSpec): RuntimeNode`
  - `topoOrder(ids: string[], edges: EdgeSpec[]): string[]` (throws `Error('graph has a cycle')`)
  - `validateSimScenario(s: SimScenario): string[]` (empty array = valid)
  - `insertBefore(g: { nodes: Map<string, RuntimeNode>; edges: EdgeSpec[]; routes: { path: string[] }[] }, targetId: string, node: RuntimeNode): void`
  - `uniqueId(nodes: Map<string, unknown>, base: string): string`
  - `isCacheLike(n: { kind: NodeKind }): boolean`

- [ ] **Step 1: Write the failing test** — `packages/engine/test/graph.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { insertBefore, resolveNode, topoOrder, uniqueId, validateSimScenario } from '../src/graph';
import type { SimScenario } from '../src/types';

const base = (): SimScenario => ({
  nodes: [
    { id: 'lb', kind: 'lb' },
    { id: 'api', kind: 'service' },
    { id: 'db', kind: 'db' },
  ],
  edges: [{ from: 'lb', to: 'api' }, { from: 'api', to: 'db' }],
  routes: [{ id: 'r', path: ['lb', 'api', 'db'], rps: 10 }],
  faults: [],
  slo: { availability: 99.9, p99Ms: 500 },
  errorBudgetSeconds: 60,
  win: { sloHealthyForSeconds: 30 },
});

describe('resolveNode', () => {
  it('fills kind-specific defaults', () => {
    const lb = resolveNode({ id: 'lb', kind: 'lb' });
    expect(lb.capacityPerInstance).toBe(100_000);
    expect(lb.poolSize).toBe(10_000);
    const c = resolveNode({ id: 'c', kind: 'cache', hitRatio: 0.8 });
    expect(c.hitRatio).toBe(0.8);
    expect(c.targetHitRatio).toBe(0.8);
    expect(resolveNode({ id: 's', kind: 'service' }).hitRatio).toBe(0);
  });
});

describe('validateSimScenario', () => {
  it('accepts a valid scenario', () => {
    expect(validateSimScenario(base())).toEqual([]);
  });

  it('reports unknown nodes, missing edges, bad fault targets', () => {
    const s = base();
    s.routes[0]!.path = ['lb', 'db'];
    s.faults = [{ at: 1, type: 'cache-flush', target: 'nope' }];
    s.edges.push({ from: 'api', to: 'ghost' });
    const errors = validateSimScenario(s);
    expect(errors).toContain('route "r" uses missing edge lb->db');
    expect(errors).toContain('fault cache-flush@1s targets unknown node "nope"');
    expect(errors).toContain('edge api->ghost references unknown node "ghost"');
  });

  it('reports duplicate ids, bad read ratios and unknown spike routes', () => {
    const s = base();
    s.nodes.push({ id: 'api', kind: 'service' });
    s.routes[0]!.readRatio = 2;
    s.faults = [{ at: 0, type: 'traffic-spike', route: 'missing', multiplier: 2 }];
    const errors = validateSimScenario(s);
    expect(errors).toContain('duplicate node id "api"');
    expect(errors).toContain('route "r" readRatio must be between 0 and 1');
    expect(errors).toContain('fault traffic-spike@0s targets unknown route "missing"');
  });

  it('reports cycles', () => {
    const s = base();
    s.edges.push({ from: 'db', to: 'lb' });
    expect(validateSimScenario(s)).toContain('graph has a cycle');
  });
});

describe('topoOrder', () => {
  it('orders callers before callees', () => {
    expect(topoOrder(['db', 'api', 'lb'], base().edges)).toEqual(['lb', 'api', 'db']);
  });
});

describe('insertBefore', () => {
  it('rewires edges and route paths', () => {
    const s = base();
    const nodes = new Map(s.nodes.map((n) => [n.id, resolveNode(n)]));
    const g = { nodes, edges: s.edges.map((e) => ({ ...e })), routes: [{ path: [...s.routes[0]!.path] }] };
    insertBefore(g, 'db', resolveNode({ id: 'db-cache', kind: 'cache' }));
    expect(g.edges).toEqual([
      { from: 'lb', to: 'api' },
      { from: 'api', to: 'db-cache' },
      { from: 'db-cache', to: 'db' },
    ]);
    expect(g.routes[0]!.path).toEqual(['lb', 'api', 'db-cache', 'db']);
    expect(g.nodes.has('db-cache')).toBe(true);
  });

  it('inserts at the route entry', () => {
    const s = base();
    const nodes = new Map(s.nodes.map((n) => [n.id, resolveNode(n)]));
    const g = { nodes, edges: s.edges.map((e) => ({ ...e })), routes: [{ path: [...s.routes[0]!.path] }] };
    insertBefore(g, 'lb', resolveNode({ id: 'cdn', kind: 'cdn' }));
    expect(g.routes[0]!.path).toEqual(['cdn', 'lb', 'api', 'db']);
    expect(g.edges).toContainEqual({ from: 'cdn', to: 'lb' });
  });
});

describe('uniqueId', () => {
  it('suffixes when taken', () => {
    const m = new Map([['db-cache', 1]]);
    expect(uniqueId(m, 'db-cache')).toBe('db-cache-2');
    expect(uniqueId(m, 'other')).toBe('other');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @paged/engine test graph`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** — `packages/engine/src/graph.ts`

```ts
import type { EdgeSpec, NodeKind, NodeSpec, RetryPolicy, SimScenario } from './types';

export interface RuntimeNode {
  id: string;
  kind: NodeKind;
  label: string;
  instances: number;
  capacityPerInstance: number;
  writeCapacityPerInstance: number;
  baseLatencyMs: number;
  timeoutMs: number;
  poolSize: number;
  retryPolicy: RetryPolicy;
  costPerInstanceHour: number;
  hitRatio: number;
  targetHitRatio: number;
  warmRatePerSec: number;
  partitioned: boolean;
  readReplicas: number;
  // modifiers set by faults and actions
  addedLatencyMs: number;
  deployErrorRate: number;
  hotKeyShare: number;
  shedFraction: number;
  rateLimitRps: number | null;
  coalescing: boolean;
  autoscaleTarget: number | null;
  pendingAutoscale: number;
  lastAutoscaleCheck: number;
  // recomputed every tick
  readIn: number;
  writeIn: number;
  utilization: number;
  accept: number;
  acceptNoPool: number;
  latencyMs: number;
  poolNeeded: number;
}

const NO_RETRY: RetryPolicy = { maxRetries: 0, backoff: 'none', jitter: false };

const DEFAULT_CAPACITY: Record<NodeKind, number> = {
  client: 1e9, cdn: 1e6, lb: 1e5, service: 500, cache: 20_000,
  db: 2_000, queue: 1e5, worker: 200, external: 1_000,
};

const DEFAULT_POOL: Partial<Record<NodeKind, number>> = { lb: 10_000, cdn: 1e6, client: 1e9 };

export const isCacheLike = (n: { kind: NodeKind }): boolean => n.kind === 'cache' || n.kind === 'cdn';

export function resolveNode(spec: NodeSpec): RuntimeNode {
  const cap = spec.capacityPerInstance ?? DEFAULT_CAPACITY[spec.kind];
  const hit = isCacheLike(spec) ? spec.hitRatio ?? 0.9 : 0;
  const base = spec.baseLatencyMs ?? 5;
  return {
    id: spec.id,
    kind: spec.kind,
    label: spec.label ?? spec.id,
    instances: spec.instances ?? 1,
    capacityPerInstance: cap,
    writeCapacityPerInstance: spec.writeCapacityPerInstance ?? cap,
    baseLatencyMs: base,
    timeoutMs: spec.timeoutMs ?? 1000,
    poolSize: spec.poolSize ?? DEFAULT_POOL[spec.kind] ?? 200,
    retryPolicy: spec.retryPolicy ?? NO_RETRY,
    costPerInstanceHour: spec.costPerInstanceHour ?? 0,
    hitRatio: hit,
    targetHitRatio: hit,
    warmRatePerSec: spec.warmRatePerSec ?? 0.02,
    partitioned: spec.partitioned ?? false,
    readReplicas: 0,
    addedLatencyMs: 0,
    deployErrorRate: 0,
    hotKeyShare: 0,
    shedFraction: 0,
    rateLimitRps: null,
    coalescing: false,
    autoscaleTarget: null,
    pendingAutoscale: 0,
    lastAutoscaleCheck: 0,
    readIn: 0,
    writeIn: 0,
    utilization: 0,
    accept: 1,
    acceptNoPool: 1,
    latencyMs: base,
    poolNeeded: 0,
  };
}

export function topoOrder(ids: string[], edges: EdgeSpec[]): string[] {
  const indeg = new Map(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    out.get(e.from)?.push(e.to);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const next of out.get(id) ?? []) {
      const d = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (order.length !== ids.length) throw new Error('graph has a cycle');
  return order;
}

export function validateSimScenario(s: SimScenario): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const n of s.nodes) {
    if (ids.has(n.id)) errors.push(`duplicate node id "${n.id}"`);
    ids.add(n.id);
  }
  const edgeKeys = new Set<string>();
  for (const e of s.edges) {
    for (const end of [e.from, e.to]) {
      if (!ids.has(end)) errors.push(`edge ${e.from}->${e.to} references unknown node "${end}"`);
    }
    edgeKeys.add(`${e.from}->${e.to}`);
  }
  const routeIds = new Set<string>();
  for (const r of s.routes) {
    routeIds.add(r.id);
    if (r.path.length === 0) errors.push(`route "${r.id}" has an empty path`);
    r.path.forEach((id, i) => {
      if (!ids.has(id)) errors.push(`route "${r.id}" references unknown node "${id}"`);
      const prev = r.path[i - 1];
      if (prev !== undefined && !edgeKeys.has(`${prev}->${id}`)) {
        errors.push(`route "${r.id}" uses missing edge ${prev}->${id}`);
      }
    });
    const ratio = r.readRatio ?? 1;
    if (ratio < 0 || ratio > 1) errors.push(`route "${r.id}" readRatio must be between 0 and 1`);
  }
  for (const f of s.faults) {
    if ('target' in f && !ids.has(f.target)) {
      errors.push(`fault ${f.type}@${f.at}s targets unknown node "${f.target}"`);
    }
    if (f.type === 'traffic-spike' && f.route !== undefined && !routeIds.has(f.route)) {
      errors.push(`fault traffic-spike@${f.at}s targets unknown route "${f.route}"`);
    }
  }
  if (errors.length === 0) {
    try {
      topoOrder([...ids], s.edges);
    } catch {
      errors.push('graph has a cycle');
    }
  }
  return errors;
}

export function uniqueId(nodes: Map<string, unknown>, base: string): string {
  let id = base;
  let n = 2;
  while (nodes.has(id)) id = `${base}-${n++}`;
  return id;
}

/** Put `node` in front of `targetId`: callers of target now call node, node calls target. */
export function insertBefore(
  g: { nodes: Map<string, RuntimeNode>; edges: EdgeSpec[]; routes: { path: string[] }[] },
  targetId: string,
  node: RuntimeNode,
): void {
  g.nodes.set(node.id, node);
  for (const e of g.edges) if (e.to === targetId) e.to = node.id;
  g.edges.push({ from: node.id, to: targetId });
  for (const r of g.routes) {
    const i = r.path.indexOf(targetId);
    if (i >= 0) r.path.splice(i, 0, node.id);
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @paged/engine test && pnpm --filter @paged/engine typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): runtime graph, validation and topology helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Simulation state, faults and the tick

**Files:**
- Create: `packages/engine/src/state.ts`, `packages/engine/src/faults.ts`, `packages/engine/src/step.ts`, `packages/engine/src/logbook.ts`
- Create: `packages/engine/test/fixtures.ts`
- Test: `packages/engine/test/step.test.ts`, `packages/engine/test/faults.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `DT = 0.1`, `RETRY_HORIZON_TICKS = 40`
  - `interface RuntimeRoute { id; path: string[]; rps; readRatio; pattern?; retryCarry: number[][]; hopRead: number[]; hopWrite: number[]; hopAccept: number[]; hopCont: number[]; hopTimeout: number[]; hopCallFail: number[]; offered; availability; meanMs; p99Ms }`
  - `interface SimState` (fields in code below)
  - `createState(scenario: SimScenario, seed: number): SimState`
  - `rebuildTopology(s: SimState): void`
  - `getNode(s: SimState, id: string): RuntimeNode`
  - `step(s: SimState): void` (Task 5 adds calls to actions/autoscaler; Task 6 adds outputs)
  - `costPerHour(s: SimState): number` (in `step.ts`)
  - (in `logbook.ts`) `class LogBook { add(t, entry, key?, minGapSec?); since(t): LogEntry[] }`, `class History { record(key, t, v); get(key): Series }`
  - `startDueFaults(s)`, `trafficMultiplier(s, routeId)`, `injectedLatency(s, nodeId)`

- [ ] **Step 1: Test fixtures** — `packages/engine/test/fixtures.ts`

```ts
import type { FaultSpec, NodeSpec, SimScenario } from '../src/types';
import { createState, type SimState } from '../src/state';
import { step } from '../src/step';

interface Opts {
  rps?: number;
  readRatio?: number;
  faults?: FaultSpec[];
  api?: Partial<NodeSpec>;
  db?: Partial<NodeSpec>;
}

/** lb -> api -> db. Healthy at defaults (api rho 0.5, db rho 0.1). */
export function threeTier(o: Opts = {}): SimScenario {
  return {
    nodes: [
      { id: 'lb', kind: 'lb', baseLatencyMs: 1, timeoutMs: 5000, costPerInstanceHour: 5 },
      { id: 'api', kind: 'service', instances: 2, capacityPerInstance: 500, baseLatencyMs: 20, costPerInstanceHour: 10, ...o.api },
      { id: 'db', kind: 'db', capacityPerInstance: 5000, baseLatencyMs: 5, costPerInstanceHour: 40, ...o.db },
    ] as NodeSpec[],
    edges: [{ from: 'lb', to: 'api' }, { from: 'api', to: 'db' }],
    routes: [{ id: 'GET /', path: ['lb', 'api', 'db'], rps: o.rps ?? 500, readRatio: o.readRatio ?? 1 }],
    faults: o.faults ?? [],
    slo: { availability: 99.9, p99Ms: 800 },
    errorBudgetSeconds: 60,
    win: { sloHealthyForSeconds: 30 },
  };
}

/** lb -> api -> cache -> db. */
export function withCache(o: Opts & { cache?: Partial<NodeSpec> } = {}): SimScenario {
  return {
    nodes: [
      { id: 'lb', kind: 'lb', baseLatencyMs: 1, timeoutMs: 5000 },
      { id: 'api', kind: 'service', instances: 4, capacityPerInstance: 500, baseLatencyMs: 20, ...o.api },
      { id: 'cache', kind: 'cache', instances: 2, capacityPerInstance: 20000, baseLatencyMs: 1, hitRatio: 0.9, ...o.cache },
      { id: 'db', kind: 'db', capacityPerInstance: 5000, baseLatencyMs: 5, ...o.db },
    ] as NodeSpec[],
    edges: [{ from: 'lb', to: 'api' }, { from: 'api', to: 'cache' }, { from: 'cache', to: 'db' }],
    routes: [{ id: 'GET /', path: ['lb', 'api', 'cache', 'db'], rps: o.rps ?? 500, readRatio: o.readRatio ?? 1 }],
    faults: o.faults ?? [],
    slo: { availability: 99.9, p99Ms: 800 },
    errorBudgetSeconds: 60,
    win: { sloHealthyForSeconds: 30 },
  };
}

export function run(s: SimState, seconds: number): void {
  const ticks = Math.round(seconds * 10);
  for (let i = 0; i < ticks && s.outcome === 'running'; i++) step(s);
}

export const node = (s: SimState, id: string) => {
  const n = s.nodes.get(id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
};
```

- [ ] **Step 2: Write the failing tests**

`packages/engine/test/step.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createState } from '../src/state';
import { step } from '../src/step';
import { node, run, threeTier } from './fixtures';

describe('step: steady state', () => {
  it('a healthy system has full availability and the expected latency', () => {
    const s = createState(threeTier(), 1);
    step(s);
    expect(s.stats.availability).toBeCloseTo(1, 6);
    expect(s.stats.sloHealthy).toBe(true);
    // lb 1/(1-0.005) + api 20/(1-0.5) + db 5/(1-0.1)
    expect(s.routes[0]!.meanMs).toBeCloseTo(1.005 + 40 + 5.556, 1);
    expect(node(s, 'api').utilization).toBeCloseTo(0.5);
  });

  it('wins after holding the SLO when there are no faults', () => {
    const s = createState(threeTier(), 1);
    run(s, 100);
    expect(s.outcome).toBe('won');
    expect(s.t).toBeCloseTo(30, 1);
  });

  it('time is derived from ticks without float drift', () => {
    const s = createState(threeTier(), 1);
    run(s, 12.3);
    expect(s.t).toBe(12.3);
  });

  it('computes cost per hour', () => {
    const s = createState(threeTier(), 1);
    step(s);
    expect(s.stats.costPerHour).toBe(5 + 2 * 10 + 40);
  });
});

describe('step: overload', () => {
  it('rejects excess load and burns the error budget until lost', () => {
    const s = createState(threeTier({ rps: 2000 }), 1);
    step(s);
    expect(node(s, 'api').accept).toBeCloseTo(0.5);
    expect(s.stats.availability).toBeGreaterThan(0.4);
    expect(s.stats.availability).toBeLessThan(0.55);
    expect(s.stats.sloHealthy).toBe(false);
    run(s, 200);
    expect(s.outcome).toBe('lost');
    expect(s.stats.errorBudgetRemaining).toBe(0);
  });

  it('a slow dependency causes timeouts upstream', () => {
    const s = createState(threeTier({ faults: [{ at: 0, type: 'latency-injection', target: 'db', addMs: 3000 }] }), 1);
    step(s);
    expect(s.stats.availability).toBeLessThan(0.4);
  });

  it('a slow dependency exhausts the caller pool on the next tick (cascade)', () => {
    const s = createState(
      threeTier({
        api: { poolSize: 10 },
        faults: [{ at: 0, type: 'latency-injection', target: 'db', addMs: 2000 }],
      }),
      1,
    );
    step(s);
    step(s);
    const api = node(s, 'api');
    expect(api.utilization).toBeLessThan(1);
    expect(api.accept).toBeLessThan(0.1);
  });

  it('retries amplify load on a struggling dependency', () => {
    const plain = createState(threeTier({ db: { capacityPerInstance: 300 } }), 1);
    const retrying = createState(
      threeTier({
        db: { capacityPerInstance: 300 },
        api: { retryPolicy: { maxRetries: 3, backoff: 'none', jitter: false } },
      }),
      1,
    );
    run(plain, 5);
    run(retrying, 5);
    expect(node(retrying, 'db').readIn).toBeGreaterThan(node(plain, 'db').readIn * 1.5);
  });

  it('a node with zero instances rejects everything without NaN', () => {
    const s = createState(threeTier({ faults: [{ at: 0, type: 'instance-crash', target: 'api', count: 5 }] }), 1);
    step(s);
    expect(node(s, 'api').instances).toBe(0);
    expect(node(s, 'api').accept).toBe(0);
    expect(Number.isFinite(s.stats.availability)).toBe(true);
    expect(s.stats.availability).toBe(0);
    expect(Number.isFinite(s.stats.worstP99Ms)).toBe(true);
  });

  it('is deterministic', () => {
    const a = createState(threeTier({ rps: 1500 }), 9);
    const b = createState(threeTier({ rps: 1500 }), 9);
    run(a, 50);
    run(b, 50);
    expect(JSON.stringify(a.stats)).toBe(JSON.stringify(b.stats));
    expect(JSON.stringify(a.routes)).toBe(JSON.stringify(b.routes));
  });
});
```

`packages/engine/test/faults.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createState } from '../src/state';
import { step } from '../src/step';
import { node, run, threeTier, withCache } from './fixtures';

describe('faults', () => {
  it('traffic-spike multiplies offered load, and expires', () => {
    const s = createState(threeTier({ faults: [{ at: 1, type: 'traffic-spike', multiplier: 3, durationSec: 5 }] }), 1);
    run(s, 2);
    expect(s.routes[0]!.offered).toBeCloseTo(1500);
    run(s, 5);
    expect(s.routes[0]!.offered).toBeCloseTo(500);
  });

  it('traffic-spike can target one route', () => {
    const sc = threeTier({ faults: [{ at: 0, type: 'traffic-spike', route: 'other', multiplier: 4 }] });
    sc.routes.push({ id: 'other', path: ['lb', 'api'], rps: 100 });
    const s = createState(sc, 1);
    step(s);
    expect(s.routes[0]!.offered).toBeCloseTo(500);
    expect(s.routes[1]!.offered).toBeCloseTo(400);
  });

  it('bad-deploy adds an error rate', () => {
    const s = createState(threeTier({ faults: [{ at: 0, type: 'bad-deploy', target: 'api', errorRate: 0.3 }] }), 1);
    step(s);
    expect(s.stats.availability).toBeCloseTo(0.7, 2);
  });

  it('instance-crash removes capacity', () => {
    const s = createState(threeTier({ rps: 800, faults: [{ at: 1, type: 'instance-crash', target: 'api', count: 1 }] }), 1);
    run(s, 2);
    expect(node(s, 'api').instances).toBe(1);
    expect(node(s, 'api').accept).toBeCloseTo(0.625);
  });

  it('cache-flush sends misses to the db, then the cache warms back up', () => {
    const s = createState(withCache({ faults: [{ at: 1, type: 'cache-flush', target: 'cache' }] }), 1);
    run(s, 0.9);
    expect(node(s, 'db').readIn).toBeCloseTo(50);
    run(s, 0.2);
    expect(node(s, 'db').readIn).toBeGreaterThan(450);
    run(s, 30);
    expect(node(s, 'db').readIn).toBeLessThan(250);
  });

  it('hot-key overloads one partition even when average utilization is low', () => {
    const s = createState(
      withCache({
        cache: { instances: 4, capacityPerInstance: 300, partitioned: true, hitRatio: 0.9 },
        faults: [{ at: 0, type: 'hot-key', target: 'cache', share: 0.8 }],
      }),
      1,
    );
    step(s);
    const cache = node(s, 'cache');
    expect(cache.utilization).toBeGreaterThan(1);
    expect(cache.accept).toBeLessThan(0.8);
  });

  it('logs when a fault starts', () => {
    const s = createState(threeTier({ faults: [{ at: 0, type: 'instance-crash', target: 'api', count: 1 }] }), 1);
    step(s);
    expect(s.logs.since(0).map((l) => l.message)).toContain('api: 1 instance(s) terminated unexpectedly');
  });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm --filter @paged/engine test`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `packages/engine/src/logbook.ts`**

```ts
import type { LogEntry, Series } from './types';

export const HISTORY_POINTS = 600; // 10 minutes at 1 point/second
const MAX_LOGS = 500;

export class LogBook {
  private entries: LogEntry[] = [];
  private lastByKey = new Map<string, number>();

  /** Add an entry. With a key, identical keys are suppressed for minGapSec. */
  add(t: number, e: Omit<LogEntry, 't'>, key?: string, minGapSec = 5): void {
    if (key !== undefined) {
      const last = this.lastByKey.get(key);
      if (last !== undefined && t - last < minGapSec) return;
      this.lastByKey.set(key, t);
    }
    this.entries.push({ t, ...e });
    if (this.entries.length > MAX_LOGS) this.entries.shift();
  }

  since(t: number): LogEntry[] {
    return this.entries.filter((e) => e.t >= t);
  }
}

export class History {
  private series = new Map<string, Series>();

  record(key: string, t: number, v: number): void {
    let s = this.series.get(key);
    if (!s) {
      s = { t: [], v: [] };
      this.series.set(key, s);
    }
    s.t.push(t);
    s.v.push(v);
    if (s.t.length > HISTORY_POINTS) {
      s.t.shift();
      s.v.shift();
    }
  }

  get(key: string): Series {
    const s = this.series.get(key);
    return s ? { t: [...s.t], v: [...s.v] } : { t: [], v: [] };
  }
}
```

- [ ] **Step 5: Implement `packages/engine/src/state.ts`**

```ts
import { resolveNode, topoOrder, type RuntimeNode } from './graph';
import { History, LogBook } from './logbook';
import { createRng, type Rng } from './rng';
import type {
  ActionId, ActionLogEntry, EdgeSpec, FaultSpec, GlobalStats, Outcome,
  PendingAction, SimScenario, TrafficPattern, Trace,
} from './types';

export const DT = 0.1;
export const RETRY_HORIZON_TICKS = 40;

export interface RuntimeRoute {
  id: string;
  path: string[];
  rps: number;
  readRatio: number;
  pattern?: TrafficPattern;
  /** retryCarry[hop][k] = extra RPS arriving at hop, k ticks from now. */
  retryCarry: number[][];
  hopRead: number[];
  hopWrite: number[];
  hopAccept: number[];
  /** Fraction of accepted requests at a hop that continue downstream. */
  hopCont: number[];
  /** Fraction of calls from hop i to hop i+1 that time out. */
  hopTimeout: number[];
  /** Probability a single call from hop i to hop i+1 fails. */
  hopCallFail: number[];
  offered: number;
  availability: number;
  meanMs: number;
  p99Ms: number;
}

export interface ActiveFault {
  spec: FaultSpec;
  endsAt: number;
}

export interface AutoscaleLaunch {
  nodeId: string;
  count: number;
  readyAt: number;
}

export interface SimState {
  scenario: SimScenario;
  tick: number;
  t: number;
  nodes: Map<string, RuntimeNode>;
  edges: EdgeSpec[];
  routes: RuntimeRoute[];
  order: string[];
  rng: Rng;
  faultsStarted: boolean[];
  activeFaults: ActiveFault[];
  pending: PendingAction[];
  actionLog: ActionLogEntry[];
  effectiveActions: ActionId[];
  autoscaleQueue: AutoscaleLaunch[];
  budgetRemaining: number;
  userFactor: number;
  healthyStreak: number;
  outcome: Outcome;
  stats: GlobalStats;
  logs: LogBook;
  history: History;
  traces: Trace[];
}

export function newRetryCarry(pathLen: number): number[][] {
  return Array.from({ length: pathLen }, () => new Array<number>(RETRY_HORIZON_TICKS).fill(0));
}

export function createState(scenario: SimScenario, seed: number): SimState {
  const nodes = new Map(scenario.nodes.map((n) => [n.id, resolveNode(n)]));
  const edges = scenario.edges.map((e) => ({ ...e }));
  const routes: RuntimeRoute[] = scenario.routes.map((r) => ({
    id: r.id,
    path: [...r.path],
    rps: r.rps,
    readRatio: r.readRatio ?? 1,
    pattern: r.pattern,
    retryCarry: newRetryCarry(r.path.length),
    hopRead: [], hopWrite: [], hopAccept: [], hopCont: [], hopTimeout: [], hopCallFail: [],
    offered: 0, availability: 1, meanMs: 0, p99Ms: 0,
  }));
  const s: SimState = {
    scenario,
    tick: 0,
    t: 0,
    nodes,
    edges,
    routes,
    order: topoOrder([...nodes.keys()], edges),
    rng: createRng(seed),
    faultsStarted: scenario.faults.map(() => false),
    activeFaults: [],
    pending: [],
    actionLog: [],
    effectiveActions: [],
    autoscaleQueue: [],
    budgetRemaining: scenario.errorBudgetSeconds,
    userFactor: 1,
    healthyStreak: 0,
    outcome: 'running',
    stats: {
      t: 0, availability: 1, worstP99Ms: 0, sloHealthy: true,
      errorBudgetRemaining: scenario.errorBudgetSeconds, errorBudgetFraction: 1,
      usersOnline: scenario.baseUsers ?? 1_000_000, costPerHour: 0,
    },
    logs: new LogBook(),
    history: new History(),
    traces: [],
  };
  return s;
}

/** Call after any change to nodes/edges/route paths. Resets in-flight retries. */
export function rebuildTopology(s: SimState): void {
  s.order = topoOrder([...s.nodes.keys()], s.edges);
  for (const r of s.routes) r.retryCarry = newRetryCarry(r.path.length);
}

export function getNode(s: SimState, id: string): RuntimeNode {
  const n = s.nodes.get(id);
  if (!n) throw new Error(`unknown node "${id}"`);
  return n;
}
```

- [ ] **Step 6: Implement `packages/engine/src/faults.ts`**

```ts
import { getNode, type SimState } from './state';
import type { FaultSpec, LogEntry } from './types';

export function startDueFaults(s: SimState): void {
  s.scenario.faults.forEach((f, i) => {
    if (s.faultsStarted[i] || s.t < f.at - 1e-9) return;
    s.faultsStarted[i] = true;
    const duration = 'durationSec' in f && f.durationSec !== undefined ? f.durationSec : Infinity;
    s.activeFaults.push({ spec: f, endsAt: f.at + duration });
    applyFaultStart(s, f);
    s.logs.add(s.t, faultLog(f));
  });
  s.activeFaults = s.activeFaults.filter((a) => a.endsAt > s.t + 1e-9);
}

function applyFaultStart(s: SimState, f: FaultSpec): void {
  switch (f.type) {
    case 'bad-deploy':
      getNode(s, f.target).deployErrorRate = f.errorRate;
      break;
    case 'instance-crash': {
      const n = getNode(s, f.target);
      n.instances = Math.max(0, n.instances - f.count);
      break;
    }
    case 'cache-flush':
      getNode(s, f.target).hitRatio = 0;
      break;
    case 'hot-key':
      getNode(s, f.target).hotKeyShare = f.share;
      break;
    case 'traffic-spike':
    case 'latency-injection':
      break; // applied every tick from activeFaults
  }
}

export function trafficMultiplier(s: SimState, routeId: string): number {
  let m = 1;
  for (const a of s.activeFaults) {
    if (a.spec.type === 'traffic-spike' && (a.spec.route === undefined || a.spec.route === routeId)) {
      m *= a.spec.multiplier;
    }
  }
  return m;
}

export function injectedLatency(s: SimState, nodeId: string): number {
  let ms = 0;
  for (const a of s.activeFaults) {
    if (a.spec.type === 'latency-injection' && a.spec.target === nodeId) ms += a.spec.addMs;
  }
  return ms;
}

function faultLog(f: FaultSpec): Omit<LogEntry, 't'> {
  switch (f.type) {
    case 'traffic-spike':
      return { level: 'warn', message: `Traffic surge: ${f.multiplier}x normal load${f.route ? ` on ${f.route}` : ''}` };
    case 'latency-injection':
      return { level: 'warn', nodeId: f.target, message: `${f.target}: responses slowing down` };
    case 'bad-deploy':
      return { level: 'info', nodeId: f.target, message: `${f.target}: new version deployed` };
    case 'instance-crash':
      return { level: 'error', nodeId: f.target, message: `${f.target}: ${f.count} instance(s) terminated unexpectedly` };
    case 'cache-flush':
      return { level: 'warn', nodeId: f.target, message: `${f.target}: restarted, all keys evicted` };
    case 'hot-key':
      return { level: 'warn', nodeId: f.target, message: `${f.target}: uneven key access detected` };
  }
}
```

- [ ] **Step 7: Implement `packages/engine/src/step.ts`**

```ts
import { injectedLatency, startDueFaults, trafficMultiplier } from './faults';
import { isCacheLike, type RuntimeNode } from './graph';
import {
  concurrency, expectedRetries, overloadAcceptFraction, p99FromMean,
  poolAcceptFraction, queueLatency, timeoutFraction, utilization,
} from './queueing';
import { DT, getNode, type RuntimeRoute, type SimState } from './state';
import { patternMultiplier } from './traffic';

/** Share of cache misses that still hit the backend when coalescing is on. */
export const COALESCE_FACTOR = 0.2;
/** Error-budget seconds burned per second while p99 breaches the SLO. */
export const LATENCY_BURN = 0.25;
/** Retries with exponential backoff and no jitter all land this many ticks later. */
export const SYNC_RETRY_DELAY_TICKS = 10;
/** Jittered retries spread evenly over this many ticks. */
export const JITTER_SPREAD_TICKS = 20;

export function step(s: SimState): void {
  s.tick += 1;
  s.t = Math.round(s.tick * DT * 1000) / 1000;
  startDueFaults(s);
  computeFlows(s);
  computeLatencyAndSuccess(s);
  scheduleRetries(s);
  warmCaches(s);
  updateStats(s);
}

function computeFlows(s: SimState): void {
  for (const n of s.nodes.values()) {
    n.readIn = 0;
    n.writeIn = 0;
  }
  for (const r of s.routes) {
    const len = r.path.length;
    r.hopRead = new Array<number>(len).fill(0);
    r.hopWrite = new Array<number>(len).fill(0);
    r.hopAccept = new Array<number>(len).fill(1);
    r.hopCont = new Array<number>(len).fill(1);
    r.hopTimeout = new Array<number>(len).fill(0);
    r.hopCallFail = new Array<number>(len).fill(0);
    for (let i = 0; i < len; i++) {
      const carry = r.retryCarry[i] as number[];
      const retry = carry.shift() ?? 0;
      carry.push(0);
      r.hopRead[i] += retry * r.readRatio;
      r.hopWrite[i] += retry * (1 - r.readRatio);
    }
    const fresh = r.rps * patternMultiplier(r.pattern, s.t) * trafficMultiplier(s, r.id);
    r.offered = fresh;
    r.hopRead[0] += fresh * r.readRatio;
    r.hopWrite[0] += fresh * (1 - r.readRatio);
  }

  const visits = new Map<string, Array<[RuntimeRoute, number]>>();
  for (const r of s.routes) {
    r.path.forEach((id, i) => {
      const v = visits.get(id) ?? [];
      v.push([r, i]);
      visits.set(id, v);
    });
  }

  for (const id of s.order) {
    const n = getNode(s, id);
    const v = visits.get(id) ?? [];
    for (const [r, i] of v) {
      n.readIn += r.hopRead[i] as number;
      n.writeIn += r.hopWrite[i] as number;
    }
    const accept = computeAcceptance(n);
    for (const [r, i] of v) {
      r.hopAccept[i] = accept;
      if (i === r.path.length - 1) {
        r.hopCont[i] = 0;
        continue;
      }
      const read = (r.hopRead[i] as number) * accept;
      const write = (r.hopWrite[i] as number) * accept;
      const cache = isCacheLike(n);
      const missRead = cache ? read * (1 - n.hitRatio) : read;
      const total = read + write;
      r.hopCont[i] = total > 0
        ? (missRead + write) / total
        : cache ? r.readRatio * (1 - n.hitRatio) + (1 - r.readRatio) : 1;
      const loadFactor = cache && n.coalescing ? COALESCE_FACTOR : 1;
      r.hopRead[i + 1] = (r.hopRead[i + 1] as number) + missRead * loadFactor;
      r.hopWrite[i + 1] = (r.hopWrite[i + 1] as number) + write;
    }
  }
}

/** Sets n.utilization, n.accept, n.acceptNoPool from this tick's inflow. */
export function computeAcceptance(n: RuntimeNode): number {
  const inflow = n.readIn + n.writeIn;
  const inst = n.instances;
  if (inflow <= 0) {
    n.utilization = 0;
    n.acceptNoPool = inst > 0 ? 1 - n.deployErrorRate : 0;
    n.accept = n.acceptNoPool;
    return n.accept;
  }
  const shed = 1 - n.shedFraction;
  const limit = n.rateLimitRps !== null && inflow * shed > 0 ? Math.min(1, n.rateLimitRps / (inflow * shed)) : 1;
  const pass = shed * limit;
  const readCap = inst * n.capacityPerInstance * (1 + n.readReplicas);
  const writeCap = inst * n.writeCapacityPerInstance;
  const rho = utilization(n.readIn * pass, readCap) + utilization(n.writeIn * pass, writeCap);

  let overloadAccept: number;
  let reportedRho: number;
  if (n.partitioned && n.hotKeyShare > 0 && inst > 1 && Number.isFinite(rho)) {
    const hot = n.hotKeyShare + (1 - n.hotKeyShare) / inst;
    const rhoHot = rho * hot * inst;
    const rhoRest = (rho * (1 - hot) * inst) / (inst - 1);
    overloadAccept = hot * overloadAcceptFraction(rhoHot) + (1 - hot) * overloadAcceptFraction(rhoRest);
    reportedRho = Math.max(rhoHot, rhoRest);
  } else {
    overloadAccept = overloadAcceptFraction(rho);
    reportedRho = rho;
  }
  n.utilization = reportedRho;
  n.acceptNoPool = pass * overloadAccept * (1 - n.deployErrorRate);
  n.accept = n.acceptNoPool * poolAcceptFraction(n.poolNeeded, inst * n.poolSize);
  return n.accept;
}

function computeLatencyAndSuccess(s: SimState): void {
  for (const n of s.nodes.values()) {
    n.addedLatencyMs = injectedLatency(s, n.id);
    n.latencyMs = queueLatency(n.baseLatencyMs, n.utilization) + n.addedLatencyMs;
    n.poolNeeded = 0;
  }
  for (const r of s.routes) {
    const len = r.path.length;
    const down = new Array<number>(len).fill(0);
    const succ = new Array<number>(len).fill(0);
    let maxRho = 0;
    for (let i = len - 1; i >= 0; i--) {
      const n = getNode(s, r.path[i] as string);
      maxRho = Math.max(maxRho, Math.min(1, n.utilization));
      const accept = r.hopAccept[i] as number;
      if (i === len - 1) {
        down[i] = n.latencyMs;
        succ[i] = accept;
        continue;
      }
      const cont = r.hopCont[i] as number;
      const calleeMs = down[i + 1] as number;
      const tf = timeoutFraction(calleeMs, n.timeoutMs);
      const callFail = 1 - (succ[i + 1] as number) * (1 - tf);
      const failAfterRetries = Math.pow(callFail, 1 + n.retryPolicy.maxRetries);
      const waitMs = Math.min(calleeMs, n.timeoutMs);
      r.hopTimeout[i] = tf;
      r.hopCallFail[i] = callFail;
      down[i] = n.latencyMs + cont * waitMs;
      succ[i] = accept * (1 - cont + cont * (1 - failAfterRetries));
      const demandOut = ((r.hopRead[i] as number) + (r.hopWrite[i] as number)) * n.acceptNoPool * cont;
      n.poolNeeded += concurrency(demandOut, waitMs);
    }
    r.availability = succ[0] as number;
    r.meanMs = down[0] as number;
    r.p99Ms = p99FromMean(r.meanMs, maxRho);
  }
}

function scheduleRetries(s: SimState): void {
  for (const r of s.routes) {
    for (let i = 0; i < r.path.length - 1; i++) {
      const n = getNode(s, r.path[i] as string);
      const policy = n.retryPolicy;
      if (policy.maxRetries === 0) continue;
      const out = ((r.hopRead[i] as number) + (r.hopWrite[i] as number)) * (r.hopAccept[i] as number) * (r.hopCont[i] as number);
      const f = r.hopCallFail[i] as number;
      const retryRps = out * f * expectedRetries(f, policy.maxRetries);
      if (retryRps <= 0) continue;
      const carry = r.retryCarry[i + 1] as number[];
      if (policy.backoff === 'none') {
        carry[0] = (carry[0] as number) + retryRps;
      } else if (!policy.jitter) {
        carry[SYNC_RETRY_DELAY_TICKS] = (carry[SYNC_RETRY_DELAY_TICKS] as number) + retryRps;
      } else {
        for (let k = 0; k < JITTER_SPREAD_TICKS; k++) carry[k] = (carry[k] as number) + retryRps / JITTER_SPREAD_TICKS;
      }
    }
  }
}

function warmCaches(s: SimState): void {
  for (const n of s.nodes.values()) {
    if (isCacheLike(n)) n.hitRatio = Math.min(n.targetHitRatio, n.hitRatio + n.warmRatePerSec * DT);
  }
}

export function costPerHour(s: SimState): number {
  let c = 0;
  for (const n of s.nodes.values()) c += n.instances * n.costPerInstanceHour * (1 + n.readReplicas);
  return c;
}

function updateStats(s: SimState): void {
  const slo = s.scenario.slo;
  let offered = 0;
  let good = 0;
  let worst = 0;
  for (const r of s.routes) {
    offered += r.offered;
    good += r.offered * r.availability;
    worst = Math.max(worst, r.p99Ms);
  }
  const availability = offered > 0 ? good / offered : 1;
  const allowed = 1 - slo.availability / 100;
  const errorRate = 1 - availability;
  const latencyBad = worst > slo.p99Ms;
  const healthy = errorRate <= allowed + 1e-12 && !latencyBad;
  const burn = Math.max(0, errorRate - allowed) + (latencyBad ? LATENCY_BURN : 0);
  s.budgetRemaining = Math.max(0, s.budgetRemaining - burn * DT);
  s.userFactor = healthy ? Math.min(1, s.userFactor + 0.001 * DT) : Math.max(0.2, s.userFactor - 0.003 * DT);
  const allFaultsStarted = s.faultsStarted.every(Boolean);
  s.healthyStreak = healthy && allFaultsStarted ? s.healthyStreak + DT : 0;
  s.stats = {
    t: s.t,
    availability,
    worstP99Ms: worst,
    sloHealthy: healthy,
    errorBudgetRemaining: s.budgetRemaining,
    errorBudgetFraction: s.budgetRemaining / s.scenario.errorBudgetSeconds,
    usersOnline: Math.round((s.scenario.baseUsers ?? 1_000_000) * s.userFactor),
    costPerHour: costPerHour(s),
  };
  if (s.budgetRemaining <= 0 || s.t >= (s.scenario.timeLimitSeconds ?? 600) - 1e-9) {
    s.outcome = 'lost';
  } else if (allFaultsStarted && s.healthyStreak >= s.scenario.win.sloHealthyForSeconds - 1e-9) {
    s.outcome = 'won';
  }
}
```

- [ ] **Step 8: Run tests and typecheck**

Run: `pnpm --filter @paged/engine test && pnpm --filter @paged/engine typecheck`
Expected: all pass. If a numeric assertion is off, re-derive it by hand from the formulas in Step 7 before touching either side. The test comments show the arithmetic.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(engine): tick loop with emergent overload, timeouts, pools, retries and faults

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Actions and autoscaling

**Files:**
- Create: `packages/engine/src/actions.ts`, `packages/engine/src/autoscale.ts`
- Modify: `packages/engine/src/step.ts` (call `applyDueActions` and `runAutoscalers`)
- Test: `packages/engine/test/actions.test.ts`

**Interfaces:**
- Consumes: `SimState`, `getNode`, `rebuildTopology`, `insertBefore`, `resolveNode`, `uniqueId`, `isCacheLike`.
- Produces:
  - `interface ActionDef { id: ActionId; category: ActionCategory; label: string; description: string; targetKinds: NodeKind[]; delaySec: number; validate?; effect }`
  - `ACTIONS: Record<ActionId, ActionDef>`
  - `actionCategory(id: ActionId): ActionCategory`
  - `requestAction(s: SimState, req: ActionRequest): ApplyResult`
  - `applyDueActions(s: SimState): void`
  - `runAutoscalers(s: SimState): void`, `AUTOSCALE_INTERVAL = 5`, `AUTOSCALE_BOOT = 15`, `AUTOSCALE_MAX_INSTANCES = 100`

- [ ] **Step 1: Write the failing test** — `packages/engine/test/actions.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { requestAction } from '../src/actions';
import { createState } from '../src/state';
import { node, run, threeTier, withCache } from './fixtures';

describe('requestAction validation', () => {
  it('schedules with a delay and applies later', () => {
    const s = createState(threeTier(), 1);
    const res = requestAction(s, { action: 'scale', target: 'api', params: { delta: 1 } });
    expect(res).toEqual({ ok: true, effectiveAt: 30 });
    run(s, 29.9);
    expect(node(s, 'api').instances).toBe(2);
    run(s, 0.2);
    expect(node(s, 'api').instances).toBe(3);
    expect(s.effectiveActions).toEqual(['scale']);
    expect(s.actionLog.map((a) => a.status)).toEqual(['scheduled', 'effective']);
  });

  it('rejects wrong target kinds, unknown targets and duplicates', () => {
    const s = createState(threeTier(), 1);
    expect(requestAction(s, { action: 'scale', target: 'db' })).toEqual({ ok: false, reason: "Scale can't target a db" });
    expect(requestAction(s, { action: 'scale', target: 'nope' })).toEqual({ ok: false, reason: 'unknown component "nope"' });
    expect(requestAction(s, { action: 'rollback', target: 'api' }).ok).toBe(true);
    expect(requestAction(s, { action: 'rollback', target: 'api' })).toEqual({ ok: false, reason: 'Roll back is already in progress on api' });
  });

  it('rejects bad params', () => {
    const s = createState(threeTier(), 1);
    expect(requestAction(s, { action: 'scale', target: 'api', params: { delta: -5 } })).toEqual({ ok: false, reason: 'cannot scale below 1 instance' });
    expect(requestAction(s, { action: 'shed-load', target: 'api', params: { percent: 95 } })).toEqual({ ok: false, reason: 'percent must be between 0 and 90' });
  });

  it('rejects once the incident is over', () => {
    const s = createState(threeTier(), 1);
    run(s, 100);
    expect(s.outcome).toBe('won');
    expect(requestAction(s, { action: 'rollback', target: 'api' })).toEqual({ ok: false, reason: 'the incident is over' });
  });
});

describe('mitigations', () => {
  it('shed-load reduces utilization', () => {
    const s = createState(threeTier({ rps: 2000 }), 1);
    requestAction(s, { action: 'shed-load', target: 'api', params: { percent: 50 } });
    run(s, 3);
    expect(node(s, 'api').utilization).toBeCloseTo(1);
  });

  it('rate-limit caps throughput and rps 0 removes it', () => {
    const s = createState(threeTier({ rps: 2000 }), 1);
    requestAction(s, { action: 'rate-limit', target: 'lb', params: { rps: 300 } });
    run(s, 6);
    expect(node(s, 'api').readIn).toBeCloseTo(300);
    requestAction(s, { action: 'rate-limit', target: 'lb', params: { rps: 0 } });
    run(s, 6);
    expect(node(s, 'lb').rateLimitRps).toBeNull();
  });

  it('rollback clears a bad deploy', () => {
    const s = createState(threeTier({ faults: [{ at: 0, type: 'bad-deploy', target: 'api', errorRate: 0.5 }] }), 1);
    run(s, 1);
    requestAction(s, { action: 'rollback', target: 'api' });
    run(s, 21);
    expect(s.stats.availability).toBeCloseTo(1, 6);
  });
});

describe('design fixes', () => {
  it('add-cache inserts a cold cache that warms and offloads the db', () => {
    const s = createState(threeTier({ rps: 900 }), 1);
    requestAction(s, { action: 'add-cache', target: 'db' });
    run(s, 20.1);
    expect(s.routes[0]!.path).toEqual(['lb', 'api', 'db-cache', 'db']);
    expect(s.edges).toContainEqual({ from: 'api', to: 'db-cache' });
    expect(node(s, 'db').readIn).toBeGreaterThan(890);
    run(s, 45);
    expect(node(s, 'db').readIn).toBeLessThan(150);
  });

  it('add-cache is rejected when a cache is already in front', () => {
    const s = createState(withCache(), 1);
    expect(requestAction(s, { action: 'add-cache', target: 'db' })).toEqual({ ok: false, reason: 'db already has a cache in front of it' });
  });

  it('a node created by an action is targetable only once it exists', () => {
    const s = createState(threeTier(), 1);
    requestAction(s, { action: 'add-cache', target: 'db' });
    expect(requestAction(s, { action: 'request-coalescing', target: 'db-cache' })).toEqual({ ok: false, reason: 'unknown component "db-cache"' });
    run(s, 20.1);
    expect(requestAction(s, { action: 'request-coalescing', target: 'db-cache' }).ok).toBe(true);
  });

  it('add-read-replica adds read capacity', () => {
    const s = createState(threeTier({ rps: 3000, api: { instances: 10 }, db: { capacityPerInstance: 2000 } }), 1);
    run(s, 1);
    expect(node(s, 'db').accept).toBeLessThan(1);
    requestAction(s, { action: 'add-read-replica', target: 'db' });
    run(s, 31);
    expect(node(s, 'db').accept).toBe(1);
    expect(s.stats.costPerHour).toBe(5 + 10 * 10 + 40 * 2);
  });

  it('add-cdn only goes in front of an entry point and stays valid after add-cache', () => {
    const s = createState(threeTier(), 1);
    expect(requestAction(s, { action: 'add-cdn', target: 'api' })).toEqual({
      ok: false,
      reason: 'a CDN goes in front of an entry point (the first hop of a route)',
    });
    requestAction(s, { action: 'add-cache', target: 'db' });
    requestAction(s, { action: 'add-cdn', target: 'lb' });
    run(s, 31);
    expect(s.routes[0]!.path).toEqual(['cdn', 'lb', 'api', 'db-cache', 'db']);
    expect(s.order.indexOf('cdn')).toBeLessThan(s.order.indexOf('lb'));
  });

  it('set-retry-policy, request-coalescing and cache-warming change node behaviour', () => {
    const s = createState(withCache({ faults: [{ at: 0, type: 'cache-flush', target: 'cache' }] }), 1);
    requestAction(s, { action: 'set-retry-policy', target: 'api', params: { maxRetries: 2, backoff: 'exponential', jitter: true } });
    requestAction(s, { action: 'request-coalescing', target: 'cache' });
    requestAction(s, { action: 'cache-warming', target: 'cache' });
    run(s, 10.1);
    expect(node(s, 'api').retryPolicy).toEqual({ maxRetries: 2, backoff: 'exponential', jitter: true });
    expect(node(s, 'cache').coalescing).toBe(true);
    expect(node(s, 'cache').warmRatePerSec).toBe(0.2);
  });

  it('autoscaling launches instances after the boot delay and resolves overload', () => {
    const s = createState(threeTier({ rps: 2600 }), 1);
    requestAction(s, { action: 'enable-autoscaling', target: 'api', params: { targetUtilization: 0.6 } });
    run(s, 29.9);
    expect(node(s, 'api').instances).toBe(2);
    run(s, 0.2);
    expect(node(s, 'api').instances).toBe(9);
    run(s, 1);
    expect(node(s, 'api').accept).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @paged/engine test actions`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `packages/engine/src/actions.ts`**

```ts
import { insertBefore, isCacheLike, resolveNode, uniqueId, type RuntimeNode } from './graph';
import { getNode, rebuildTopology, type SimState } from './state';
import type { ActionCategory, ActionId, ActionParams, ActionRequest, ApplyResult, NodeKind } from './types';

export interface ActionDef {
  id: ActionId;
  category: ActionCategory;
  label: string;
  description: string;
  targetKinds: NodeKind[];
  delaySec: number;
  validate?: (s: SimState, target: RuntimeNode, params: ActionParams) => string | null;
  effect: (s: SimState, target: RuntimeNode, params: ActionParams) => void;
}

const num = (p: ActionParams, k: string, d: number): number => (typeof p[k] === 'number' ? (p[k] as number) : d);
const bool = (p: ActionParams, k: string, d: boolean): boolean => (typeof p[k] === 'boolean' ? (p[k] as boolean) : d);
const str = (p: ActionParams, k: string, d: string): string => (typeof p[k] === 'string' ? (p[k] as string) : d);

const isEntry = (s: SimState, id: string): boolean => s.routes.some((r) => r.path[0] === id);
const hasCacheInFront = (s: SimState, id: string): boolean =>
  s.edges.some((e) => e.to === id && isCacheLike(getNode(s, e.from)));

export const ACTIONS: Record<ActionId, ActionDef> = {
  scale: {
    id: 'scale', category: 'mitigate', label: 'Scale',
    description: 'Add or remove instances. New instances take 30s to boot.',
    targetKinds: ['lb', 'service', 'cache', 'worker'], delaySec: 30,
    validate: (_s, n, p) => {
      const d = num(p, 'delta', 1);
      if (!Number.isInteger(d) || d === 0) return 'delta must be a non-zero whole number';
      if (n.instances + d < 1) return 'cannot scale below 1 instance';
      return null;
    },
    effect: (_s, n, p) => {
      n.instances = Math.max(1, n.instances + num(p, 'delta', 1));
    },
  },
  'shed-load': {
    id: 'shed-load', category: 'mitigate', label: 'Shed load',
    description: 'Reject a share of incoming requests immediately to protect the rest. 0 turns it off.',
    targetKinds: ['lb', 'service'], delaySec: 2,
    validate: (_s, _n, p) => {
      const v = num(p, 'percent', 20);
      return v < 0 || v > 90 ? 'percent must be between 0 and 90' : null;
    },
    effect: (_s, n, p) => {
      n.shedFraction = num(p, 'percent', 20) / 100;
    },
  },
  'rate-limit': {
    id: 'rate-limit', category: 'mitigate', label: 'Rate limit',
    description: 'Cap requests per second; the excess is rejected fast. 0 removes the limit.',
    targetKinds: ['lb', 'service'], delaySec: 5,
    validate: (_s, _n, p) => (num(p, 'rps', 0) < 0 ? 'rps must be 0 or more' : null),
    effect: (_s, n, p) => {
      const rps = num(p, 'rps', 0);
      n.rateLimitRps = rps > 0 ? rps : null;
    },
  },
  rollback: {
    id: 'rollback', category: 'mitigate', label: 'Roll back',
    description: 'Revert to the previous version. Takes 20s.',
    targetKinds: ['service', 'worker'], delaySec: 20,
    effect: (_s, n) => {
      n.deployErrorRate = 0;
    },
  },
  'enable-autoscaling': {
    id: 'enable-autoscaling', category: 'design', label: 'Autoscaling',
    description: 'Add instances automatically when utilization goes above a target.',
    targetKinds: ['service', 'worker'], delaySec: 10,
    validate: (_s, _n, p) => {
      const v = num(p, 'targetUtilization', 0.6);
      return v < 0.3 || v > 0.9 ? 'targetUtilization must be between 0.3 and 0.9' : null;
    },
    effect: (s, n, p) => {
      n.autoscaleTarget = num(p, 'targetUtilization', 0.6);
      n.lastAutoscaleCheck = s.t;
    },
  },
  'add-cache': {
    id: 'add-cache', category: 'design', label: 'Add cache',
    description: 'Put a cache in front of this component. It starts cold and warms up.',
    targetKinds: ['db', 'service', 'external'], delaySec: 20,
    validate: (s, n) => (hasCacheInFront(s, n.id) ? `${n.id} already has a cache in front of it` : null),
    effect: (s, n, p) => {
      const c = resolveNode({
        id: uniqueId(s.nodes, `${n.id}-cache`), kind: 'cache', label: `${n.label} cache`,
        instances: 2, capacityPerInstance: 20_000, baseLatencyMs: 1, costPerInstanceHour: 15,
        hitRatio: num(p, 'hitRatio', 0.9), warmRatePerSec: 0.02,
      });
      c.hitRatio = 0;
      insertBefore(s, n.id, c);
      rebuildTopology(s);
    },
  },
  'add-read-replica': {
    id: 'add-read-replica', category: 'design', label: 'Add read replica',
    description: 'A copy of the database that serves reads. Writes still go to the primary.',
    targetKinds: ['db'], delaySec: 30,
    effect: (_s, n) => {
      n.readReplicas += 1;
    },
  },
  'add-cdn': {
    id: 'add-cdn', category: 'design', label: 'Add CDN',
    description: 'Serve cacheable reads from the edge, before traffic reaches you.',
    targetKinds: ['lb', 'service'], delaySec: 30,
    validate: (s, n) => {
      if (!isEntry(s, n.id)) return 'a CDN goes in front of an entry point (the first hop of a route)';
      if (hasCacheInFront(s, n.id)) return `${n.id} already has a cache in front of it`;
      return null;
    },
    effect: (s, n, p) => {
      const c = resolveNode({
        id: uniqueId(s.nodes, 'cdn'), kind: 'cdn', label: 'CDN',
        instances: 1, capacityPerInstance: 1_000_000, baseLatencyMs: 2, costPerInstanceHour: 50,
        hitRatio: num(p, 'hitRatio', 0.95), warmRatePerSec: 0.05,
      });
      c.hitRatio = 0;
      insertBefore(s, n.id, c);
      rebuildTopology(s);
    },
  },
  'set-retry-policy': {
    id: 'set-retry-policy', category: 'design', label: 'Retry policy',
    description: 'Change how this component retries failed calls.',
    targetKinds: ['lb', 'service', 'worker'], delaySec: 5,
    validate: (_s, _n, p) => {
      const m = num(p, 'maxRetries', 2);
      if (!Number.isInteger(m) || m < 0 || m > 5) return 'maxRetries must be a whole number from 0 to 5';
      const b = str(p, 'backoff', 'exponential');
      return b === 'none' || b === 'exponential' ? null : 'backoff must be "none" or "exponential"';
    },
    effect: (_s, n, p) => {
      n.retryPolicy = {
        maxRetries: num(p, 'maxRetries', 2),
        backoff: str(p, 'backoff', 'exponential') as 'none' | 'exponential',
        jitter: bool(p, 'jitter', true),
      };
    },
  },
  'request-coalescing': {
    id: 'request-coalescing', category: 'design', label: 'Request coalescing',
    description: 'Collapse concurrent misses for the same key into one backend fetch.',
    targetKinds: ['cache', 'cdn'], delaySec: 10,
    effect: (_s, n) => {
      n.coalescing = true;
    },
  },
  'cache-warming': {
    id: 'cache-warming', category: 'design', label: 'Cache warming',
    description: 'Pre-load hot keys so the cache recovers quickly after a restart.',
    targetKinds: ['cache', 'cdn'], delaySec: 10,
    effect: (_s, n) => {
      n.warmRatePerSec = Math.max(n.warmRatePerSec, 0.2);
    },
  },
};

export const actionCategory = (id: ActionId): ActionCategory => ACTIONS[id].category;

export function requestAction(s: SimState, req: ActionRequest): ApplyResult {
  if (s.outcome !== 'running') return { ok: false, reason: 'the incident is over' };
  const def = ACTIONS[req.action];
  if (!def) return { ok: false, reason: `unknown action "${String(req.action)}"` };
  const n = s.nodes.get(req.target);
  if (!n) return { ok: false, reason: `unknown component "${req.target}"` };
  if (!def.targetKinds.includes(n.kind)) return { ok: false, reason: `${def.label} can't target a ${n.kind}` };
  if (s.pending.some((p) => p.request.action === req.action && p.request.target === req.target)) {
    return { ok: false, reason: `${def.label} is already in progress on ${n.id}` };
  }
  const params = req.params ?? {};
  const err = def.validate?.(s, n, params) ?? null;
  if (err) return { ok: false, reason: err };
  const effectiveAt = Math.round((s.t + def.delaySec) * 1000) / 1000;
  s.pending.push({ request: req, effectiveAt });
  s.actionLog.push({ t: s.t, request: req, status: 'scheduled' });
  s.logs.add(s.t, { level: 'info', nodeId: n.id, message: `${def.label} requested on ${n.label} (ready in ${def.delaySec}s)` });
  return { ok: true, effectiveAt };
}

export function applyDueActions(s: SimState): void {
  const due = s.pending.filter((p) => p.effectiveAt <= s.t + 1e-9);
  if (due.length === 0) return;
  s.pending = s.pending.filter((p) => p.effectiveAt > s.t + 1e-9);
  for (const p of due) {
    const n = s.nodes.get(p.request.target);
    if (!n) continue;
    const def = ACTIONS[p.request.action];
    def.effect(s, n, p.request.params ?? {});
    s.actionLog.push({ t: s.t, request: p.request, status: 'effective' });
    s.effectiveActions.push(p.request.action);
    s.logs.add(s.t, { level: 'info', nodeId: n.id, message: `${def.label} applied to ${n.label}` });
  }
}
```

- [ ] **Step 4: Implement `packages/engine/src/autoscale.ts`**

```ts
import type { SimState } from './state';

export const AUTOSCALE_INTERVAL = 5;
export const AUTOSCALE_BOOT = 15;
export const AUTOSCALE_MAX_INSTANCES = 100;

export function runAutoscalers(s: SimState): void {
  for (const n of s.nodes.values()) {
    if (n.autoscaleTarget === null || s.t - n.lastAutoscaleCheck < AUTOSCALE_INTERVAL - 1e-6) continue;
    n.lastAutoscaleCheck = s.t;
    const raw = Math.ceil((n.instances * n.utilization) / n.autoscaleTarget);
    const desired = Math.min(AUTOSCALE_MAX_INSTANCES, Number.isFinite(raw) && n.instances > 0 ? raw : n.instances + 1);
    const add = desired - (n.instances + n.pendingAutoscale);
    if (add <= 0) continue;
    n.pendingAutoscale += add;
    s.autoscaleQueue.push({ nodeId: n.id, count: add, readyAt: Math.round((s.t + AUTOSCALE_BOOT) * 1000) / 1000 });
    s.logs.add(s.t, { level: 'info', nodeId: n.id, message: `${n.label}: autoscaler launching ${add} instance(s)` });
  }
  const ready = s.autoscaleQueue.filter((q) => q.readyAt <= s.t + 1e-9);
  if (ready.length === 0) return;
  s.autoscaleQueue = s.autoscaleQueue.filter((q) => q.readyAt > s.t + 1e-9);
  for (const q of ready) {
    const n = s.nodes.get(q.nodeId);
    if (!n) continue;
    n.instances += q.count;
    n.pendingAutoscale -= q.count;
  }
}
```

- [ ] **Step 5: Wire into `step.ts`**

Add the imports:
```ts
import { applyDueActions } from './actions';
import { runAutoscalers } from './autoscale';
```
Replace the body of `step` with:
```ts
export function step(s: SimState): void {
  s.tick += 1;
  s.t = Math.round(s.tick * DT * 1000) / 1000;
  startDueFaults(s);
  applyDueActions(s);
  runAutoscalers(s);
  computeFlows(s);
  computeLatencyAndSuccess(s);
  scheduleRetries(s);
  warmCaches(s);
  updateStats(s);
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @paged/engine test && pnpm --filter @paged/engine typecheck`
Expected: all pass. The autoscaling numbers: effective at 10s, first check at 15s computes `ceil(2 × 2.6 / 0.6) = 9`, so 7 instances launch and are ready at 30s.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(engine): action registry, design fixes and autoscaler

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Outputs and the public Simulation API

**Files:**
- Create: `packages/engine/src/outputs.ts` (history recording, threshold logs, traces, snapshots)
- Modify: `packages/engine/src/step.ts` (call `recordOutputs`)
- Create: `packages/engine/src/simulation.ts`
- Test: `packages/engine/test/simulation.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `nodeMetrics(n: RuntimeNode): NodeMetrics`, `healthOf(m: NodeMetrics): Health`
  - `recordOutputs(s: SimState): void`
  - `interface Simulation { tick(n?: number): void; time(): number; outcome(): Outcome; stats(): GlobalStats; apply(req: ActionRequest): ApplyResult; snapshot(): SimSnapshot; history(key: string): Series; logs(sinceT?: number): LogEntry[]; traces(): Trace[]; actionLog(): ActionLogEntry[]; effectiveActions(): ActionId[] }`
  - `createSimulation(scenario: SimScenario, opts: { seed: number }): Simulation` (throws `Error` listing validation errors)
  - History keys: `"<nodeId>:<metric>"` for every `MetricName`, plus `"global:availability"`, `"global:worstP99Ms"`, `"global:errorBudgetRemaining"`, `"global:costPerHour"`, `"global:usersOnline"`.

- [ ] **Step 1: Write the failing test** — `packages/engine/test/simulation.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../src/simulation';
import { threeTier } from './fixtures';

describe('createSimulation', () => {
  it('throws with all validation errors', () => {
    const sc = threeTier();
    sc.routes[0]!.path = ['lb', 'db'];
    expect(() => createSimulation(sc, { seed: 1 })).toThrow('route "GET /" uses missing edge lb->db');
  });

  it('snapshots nodes with health', () => {
    const sim = createSimulation(threeTier({ rps: 2000 }), { seed: 1 });
    sim.tick();
    const snap = sim.snapshot();
    const api = snap.nodes.find((n) => n.id === 'api')!;
    expect(api.health).toBe('crit');
    expect(api.metrics.errorRate).toBeCloseTo(0.5);
    expect(snap.nodes.find((n) => n.id === 'db')!.health).toBe('ok');
    expect(snap.routes[0]!.offeredRps).toBeCloseTo(2000);
    expect(snap.outcome).toBe('running');
  });

  it('records history once per simulated second', () => {
    const sim = createSimulation(threeTier(), { seed: 1 });
    sim.tick(50);
    expect(sim.history('api:rps').t).toEqual([1, 2, 3, 4, 5]);
    expect(sim.history('global:availability').v.every((v) => v > 0.999)).toBe(true);
    expect(sim.history('nope:rps')).toEqual({ t: [], v: [] });
  });

  it('logs threshold crossings without spamming', () => {
    const sim = createSimulation(
      threeTier({ api: { poolSize: 10 }, faults: [{ at: 0, type: 'latency-injection', target: 'db', addMs: 2000 }] }),
      { seed: 1 },
    );
    sim.tick(30);
    const pool = sim.logs().filter((l) => l.message.includes('connection pool exhausted'));
    expect(pool).toHaveLength(1);
    expect(pool[0]!.nodeId).toBe('api');
    expect(sim.logs().some((l) => l.message === 'api: upstream timeout after 1000ms calling db')).toBe(true);
    sim.tick(30);
    expect(sim.logs().filter((l) => l.message.includes('connection pool exhausted'))).toHaveLength(2);
  });

  it('samples one nested trace per route per second', () => {
    const sim = createSimulation(threeTier(), { seed: 3 });
    sim.tick(20);
    const traces = sim.traces();
    expect(traces).toHaveLength(2);
    const [t] = traces;
    expect(t!.spans.map((sp) => sp.nodeId)).toEqual(['lb', 'api', 'db']);
    expect(t!.spans[0]!.durationMs).toBeGreaterThanOrEqual(t!.spans[1]!.durationMs);
    expect(t!.spans[1]!.startMs).toBeGreaterThanOrEqual(t!.spans[0]!.startMs);
    expect(t!.durationMs).toBeCloseTo(t!.spans[0]!.durationMs);
  });

  it('applies actions through the API and stops once decided', () => {
    const sim = createSimulation(threeTier(), { seed: 1 });
    expect(sim.apply({ action: 'scale', target: 'api' })).toEqual({ ok: true, effectiveAt: 30 });
    expect(sim.snapshot().pending).toHaveLength(1);
    sim.tick(10_000);
    expect(sim.outcome()).toBe('won');
    const t = sim.time();
    sim.tick(100);
    expect(sim.time()).toBe(t);
    expect(sim.apply({ action: 'rollback', target: 'api' }).ok).toBe(false);
    // scheduled + effective (the scale lands on the same tick the win is declared)
    expect(sim.actionLog().map((a) => a.status)).toEqual(['scheduled', 'effective']);
  });

  it('identical seeds and actions give identical runs, including traces', () => {
    const go = () => {
      const sim = createSimulation(threeTier({ rps: 1500 }), { seed: 5 });
      sim.tick(30);
      sim.apply({ action: 'scale', target: 'api', params: { delta: 2 } });
      sim.tick(400);
      return JSON.stringify([sim.snapshot(), sim.traces(), sim.logs()]);
    };
    expect(go()).toBe(go());
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @paged/engine test simulation`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `packages/engine/src/outputs.ts`**

```ts
import { isCacheLike, type RuntimeNode } from './graph';
import { p99FromMean } from './queueing';
import { getNode, type RuntimeRoute, type SimState } from './state';
import type { Health, NodeMetrics, SimSnapshot, Span, Trace } from './types';

const TICKS_PER_SECOND = 10;
const MAX_TRACES = 50;

export function nodeMetrics(n: RuntimeNode): NodeMetrics {
  const poolCap = n.instances * n.poolSize;
  const m: NodeMetrics = {
    rps: n.readIn + n.writeIn,
    p50Ms: n.latencyMs,
    p99Ms: p99FromMean(n.latencyMs, n.utilization),
    errorRate: 1 - n.accept,
    utilization: Number.isFinite(n.utilization) ? n.utilization : 10,
    poolInUse: poolCap > 0 ? Math.min(1, n.poolNeeded / poolCap) : 0,
  };
  if (isCacheLike(n)) m.hitRatio = n.hitRatio;
  return m;
}

export function healthOf(m: NodeMetrics): Health {
  if (m.errorRate > 0.05 || m.utilization >= 1) return 'crit';
  if (m.errorRate > 0.001 || m.utilization > 0.8 || (m.hitRatio !== undefined && m.hitRatio < 0.5)) return 'warn';
  return 'ok';
}

export function recordOutputs(s: SimState): void {
  emitThresholdLogs(s);
  if (s.tick % TICKS_PER_SECOND !== 0) return;
  for (const n of s.nodes.values()) {
    const m = nodeMetrics(n);
    for (const [k, v] of Object.entries(m)) s.history.record(`${n.id}:${k}`, s.t, v as number);
  }
  const st = s.stats;
  s.history.record('global:availability', s.t, st.availability);
  s.history.record('global:worstP99Ms', s.t, st.worstP99Ms);
  s.history.record('global:errorBudgetRemaining', s.t, st.errorBudgetRemaining);
  s.history.record('global:costPerHour', s.t, st.costPerHour);
  s.history.record('global:usersOnline', s.t, st.usersOnline);
  for (const r of s.routes) s.traces.push(sampleTrace(s, r));
  while (s.traces.length > MAX_TRACES) s.traces.shift();
}

function emitThresholdLogs(s: SimState): void {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  for (const n of s.nodes.values()) {
    const m = nodeMetrics(n);
    if (m.utilization > 0.9) {
      s.logs.add(s.t, { level: 'warn', nodeId: n.id, message: `${n.label}: saturated (${pct(Math.min(m.utilization, 9.99))} utilization)` }, `${n.id}:util`);
    }
    if (m.errorRate > 0.05) {
      s.logs.add(s.t, { level: 'error', nodeId: n.id, message: `${n.label}: ${pct(m.errorRate)} of requests failing` }, `${n.id}:errors`);
    }
    const poolCap = n.instances * n.poolSize;
    if (poolCap > 0 && n.poolNeeded > poolCap) {
      s.logs.add(s.t, { level: 'error', nodeId: n.id, message: `${n.label}: connection pool exhausted (${poolCap}/${poolCap})` }, `${n.id}:pool`);
    }
    if (m.hitRatio !== undefined && m.hitRatio < 0.5) {
      s.logs.add(s.t, { level: 'warn', nodeId: n.id, message: `${n.label}: cache hit ratio ${pct(m.hitRatio)}` }, `${n.id}:hit`);
    }
  }
  for (const r of s.routes) {
    for (let i = 0; i < r.path.length - 1; i++) {
      if ((r.hopTimeout[i] ?? 0) > 0.05) {
        const n = getNode(s, r.path[i] as string);
        const next = r.path[i + 1] as string;
        s.logs.add(s.t, { level: 'error', nodeId: n.id, message: `${n.label}: upstream timeout after ${n.timeoutMs}ms calling ${next}` }, `${n.id}:timeout:${next}`);
      }
    }
  }
}

function sampleTrace(s: SimState, r: RuntimeRoute): Trace {
  const own: number[] = [];
  const failed: boolean[] = [];
  const isRead = s.rng() < r.readRatio;
  for (let i = 0; i < r.path.length; i++) {
    const n = getNode(s, r.path[i] as string);
    own.push(n.latencyMs * -Math.log(1 - s.rng() * 0.999));
    if (s.rng() > (r.hopAccept[i] ?? 1)) {
      failed.push(true);
      break;
    }
    if (i < r.path.length - 1 && s.rng() < (r.hopTimeout[i] ?? 0)) {
      failed.push(true);
      own[i] = (own[i] as number) + n.timeoutMs;
      break;
    }
    failed.push(false);
    if (isRead && isCacheLike(n) && s.rng() < n.hitRatio) break;
  }
  const spans: Span[] = [];
  let start = 0;
  for (let i = 0; i < own.length; i++) {
    const rest = own.slice(i).reduce((a, b) => a + b, 0);
    spans.push({ nodeId: r.path[i] as string, startMs: start, durationMs: rest, error: failed[i] as boolean });
    start += own[i] as number;
  }
  const total = own.reduce((a, b) => a + b, 0);
  return { id: `${r.id}#${s.tick}`, t: s.t, routeId: r.id, durationMs: total, error: failed.some(Boolean), spans };
}

export function snapshotOf(s: SimState): SimSnapshot {
  return {
    t: s.t,
    outcome: s.outcome,
    nodes: [...s.nodes.values()].map((n) => {
      const metrics = nodeMetrics(n);
      return { id: n.id, kind: n.kind, label: n.label, instances: n.instances, health: healthOf(metrics), metrics };
    }),
    edges: s.edges.map((e) => ({ ...e })),
    routes: s.routes.map((r) => ({
      id: r.id, path: [...r.path], offeredRps: r.offered, availability: r.availability, meanMs: r.meanMs, p99Ms: r.p99Ms,
    })),
    stats: { ...s.stats },
    pending: s.pending.map((p) => ({ request: { ...p.request }, effectiveAt: p.effectiveAt })),
  };
}
```

**Note on the trace test:** `threeTier()` has one route and the test ticks 20 times, so it records 2 seconds and gets 2 traces.

- [ ] **Step 4: Wire outputs into `step.ts`**

Add `import { recordOutputs } from './outputs';` and append `recordOutputs(s);` as the last line of `step`.

- [ ] **Step 5: Implement `packages/engine/src/simulation.ts`**

```ts
import { requestAction } from './actions';
import { validateSimScenario } from './graph';
import { snapshotOf } from './outputs';
import { createState } from './state';
import { step } from './step';
import type {
  ActionId, ActionLogEntry, ActionRequest, ApplyResult, GlobalStats, LogEntry,
  Outcome, Series, SimScenario, SimSnapshot, Trace,
} from './types';

export interface Simulation {
  tick(n?: number): void;
  time(): number;
  outcome(): Outcome;
  stats(): GlobalStats;
  apply(req: ActionRequest): ApplyResult;
  snapshot(): SimSnapshot;
  history(key: string): Series;
  logs(sinceT?: number): LogEntry[];
  traces(): Trace[];
  actionLog(): ActionLogEntry[];
  effectiveActions(): ActionId[];
}

export function createSimulation(scenario: SimScenario, opts: { seed: number }): Simulation {
  const errors = validateSimScenario(scenario);
  if (errors.length > 0) throw new Error(`invalid scenario:\n- ${errors.join('\n- ')}`);
  const s = createState(scenario, opts.seed);
  return {
    tick(n = 1) {
      for (let i = 0; i < n && s.outcome === 'running'; i++) step(s);
    },
    time: () => s.t,
    outcome: () => s.outcome,
    stats: () => ({ ...s.stats }),
    apply: (req) => requestAction(s, req),
    snapshot: () => snapshotOf(s),
    history: (key) => s.history.get(key),
    logs: (sinceT = 0) => s.logs.since(sinceT),
    traces: () => s.traces.map((t) => ({ ...t, spans: t.spans.map((sp) => ({ ...sp })) })),
    actionLog: () => s.actionLog.map((a) => ({ ...a, request: { ...a.request } })),
    effectiveActions: () => [...s.effectiveActions],
  };
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @paged/engine test && pnpm --filter @paged/engine typecheck`
Expected: all pass. The pool-log test: the api pool overflows from tick 1 and the 5 s rate limit gives 1 log in the first 3 s, then a 2nd once 5 s have passed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(engine): metrics history, logs, traces, snapshots and public API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Scoring and public exports

**Files:**
- Create: `packages/engine/src/scoring.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/test/scoring.test.ts`

**Interfaces:**
- Produces:
  - `type Stars = 0 | 1 | 2 | 3`
  - `interface StarCriteria { requiredDesignFixes: ActionId[]; budgetTarget: number; costTarget: number }`
  - `interface RunResult { outcome: Outcome; effectiveActions: ActionId[]; budgetFraction: number; costPerHour: number; cluesUsed: number }`
  - `scoreRun(r: RunResult, c: StarCriteria): Stars`
  - `index.ts` re-exports: all of `types.ts`, `createSimulation`, `Simulation`, `ACTIONS`, `ActionDef`, `actionCategory`, `scoreRun`, `Stars`, `StarCriteria`, `RunResult`, `validateSimScenario`, `healthOf`.

- [ ] **Step 1: Write the failing test** — `packages/engine/test/scoring.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { scoreRun } from '../src/scoring';

const criteria = { requiredDesignFixes: ['add-cache' as const], budgetTarget: 0.5, costTarget: 200 };
const won = { outcome: 'won' as const, effectiveActions: [], budgetFraction: 0.9, costPerHour: 100, cluesUsed: 0 };

describe('scoreRun', () => {
  it('0 stars when not won', () => {
    expect(scoreRun({ ...won, outcome: 'lost' }, criteria)).toBe(0);
    expect(scoreRun({ ...won, outcome: 'running' }, criteria)).toBe(0);
  });
  it('1 star for a mitigation-only win', () => {
    expect(scoreRun({ ...won, effectiveActions: ['scale'] }, criteria)).toBe(1);
  });
  it('2 stars with a required design fix but missing efficiency', () => {
    expect(scoreRun({ ...won, effectiveActions: ['add-cache'], cluesUsed: 1 }, criteria)).toBe(2);
    expect(scoreRun({ ...won, effectiveActions: ['add-cache'], budgetFraction: 0.4 }, criteria)).toBe(2);
    expect(scoreRun({ ...won, effectiveActions: ['add-cache'], costPerHour: 201 }, criteria)).toBe(2);
  });
  it('3 stars when efficient', () => {
    expect(scoreRun({ ...won, effectiveActions: ['scale', 'add-cache'] }, criteria)).toBe(3);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @paged/engine test scoring`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/engine/src/scoring.ts`:
```ts
import type { ActionId, Outcome } from './types';

export type Stars = 0 | 1 | 2 | 3;

export interface StarCriteria {
  requiredDesignFixes: ActionId[];
  budgetTarget: number;
  costTarget: number;
}

export interface RunResult {
  outcome: Outcome;
  effectiveActions: ActionId[];
  budgetFraction: number;
  costPerHour: number;
  cluesUsed: number;
}

export function scoreRun(r: RunResult, c: StarCriteria): Stars {
  if (r.outcome !== 'won') return 0;
  if (!r.effectiveActions.some((a) => c.requiredDesignFixes.includes(a))) return 1;
  const efficient = r.budgetFraction >= c.budgetTarget && r.costPerHour <= c.costTarget && r.cluesUsed === 0;
  return efficient ? 3 : 2;
}
```

`packages/engine/src/index.ts`:
```ts
export * from './types';
export { createSimulation, type Simulation } from './simulation';
export { ACTIONS, actionCategory, type ActionDef } from './actions';
export { scoreRun, type RunResult, type StarCriteria, type Stars } from './scoring';
export { validateSimScenario } from './graph';
export { healthOf } from './outputs';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @paged/engine test && pnpm --filter @paged/engine typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): star scoring and public exports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Scenario package: schema, catalog and parser

**Files:**
- Create: `packages/scenarios/package.json`, `packages/scenarios/tsconfig.json`
- Create: `packages/scenarios/src/schema.ts`, `src/types.ts`, `src/parse.ts`, `src/index.ts`
- Create: `packages/scenarios/content/concepts.yaml`, `packages/scenarios/content/worlds.yaml`
- Test: `packages/scenarios/test/parse.test.ts`, `packages/scenarios/test/minimal.ts`

**Interfaces:**
- Consumes: `@paged/engine` (`ACTION_IDS`, `ActionId`, `SimScenario`, `actionCategory`, `validateSimScenario`).
- Produces:
  - `interface Concept { id: string; title: string; explainer: string }`
  - `interface World { id: string; title: string; emoji: string; description: string; stages: string[] }`
  - `interface Catalog { concepts: Concept[]; worlds: World[] }`
  - `interface SolutionStep { at: number; action: ActionId; target: string; params?: ActionParams }`
  - `interface Debrief { whatHappened: string; lesson: string; realWorld: string; interviewMoment: { question: string; modelAnswer: string }; sources: string[] }`
  - `interface Scenario { id; world; stage; order; title; difficulty; concepts: string[]; briefing; seed; sim: SimScenario; toolbox: { mitigate: ActionId[]; design: ActionId[] }; requiredDesignFixes: ActionId[]; budgetTarget; costTarget; solution: SolutionStep[]; clues: string[]; debrief: Debrief }`
  - `class ScenarioError extends Error { source: string; issues: string[] }`
  - `parseCatalog(conceptsYaml: string, worldsYaml: string): Catalog`
  - `parseScenario(yamlText: string, catalog: Catalog, source?: string): Scenario`

- [ ] **Step 1: Package setup**

`packages/scenarios/package.json`:
```json
{
  "name": "@paged/scenarios",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./node": "./src/node-loader.ts",
    "./content/*": "./content/*"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json",
    "validate": "tsx src/cli.ts"
  }
}
```

`packages/scenarios/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run:
```bash
pnpm --filter @paged/scenarios add @paged/engine@workspace:* zod@^3.25.0 yaml
pnpm --filter @paged/scenarios add -D typescript vitest tsx @types/node
```

- [ ] **Step 2: Catalog content**

`packages/scenarios/content/concepts.yaml`:
```yaml
- id: horizontal-scaling
  title: Horizontal scaling
  explainer: Add more machines instead of bigger ones. Works when the service is stateless and a load balancer spreads traffic across instances.
- id: load-balancing
  title: Load balancing
  explainer: Spread requests across healthy instances so none is overloaded and failed instances stop receiving traffic.
- id: autoscaling
  title: Autoscaling
  explainer: Add capacity automatically when a metric such as CPU utilization crosses a target. New instances take time to boot, so scale before you are at 100%.
- id: caching
  title: Caching
  explainer: Keep hot data in fast memory close to the caller. Hit ratio is everything; a cold cache protects nothing.
- id: read-heavy
  title: Read-heavy workloads
  explainer: When reads dwarf writes, cache them, replicate them, or serve them from the edge, and keep the write path simple.
- id: read-replicas
  title: Read replicas
  explainer: Copies of the database that serve reads. They scale reads, not writes, and they lag the primary slightly.
- id: hot-keys
  title: Hot keys
  explainer: One key gets a huge share of traffic and overloads the single shard that owns it. Adding shards doesn't help; spreading or caching the key does.
- id: edge-caching
  title: Edge caching (CDN)
  explainer: Serve cacheable responses from servers near users so the traffic never reaches your origin.
- id: fan-out
  title: Fan-out
  explainer: One event must be delivered to many recipients. Doing it on write makes reads cheap; doing it on read makes writes cheap.
- id: hybrid-feeds
  title: Hybrid feeds
  explainer: Fan out on write for normal users, and merge celebrity posts at read time, so no single write explodes.
- id: thundering-herd
  title: Thundering herd
  explainer: Many clients do the same expensive thing at the same moment, such as a cache miss or a reconnect, and flatten the backend.
- id: cache-warming
  title: Cache warming
  explainer: Pre-load hot keys before (or right after) a cache starts, so it doesn't begin with a 0% hit ratio.
- id: request-coalescing
  title: Request coalescing
  explainer: When many requests miss the same key at once, let one fetch it and the rest wait for that result.
- id: circuit-breakers
  title: Circuit breakers
  explainer: Stop calling a dependency that is failing, fail fast instead, and probe it again later. This keeps threads free for healthy work.
- id: bulkheads
  title: Bulkheads
  explainer: Give each dependency its own pool of threads or connections so one slow dependency can't starve the others.
- id: multi-region
  title: Multi-region
  explainer: Run in more than one region so a regional outage takes away a slice of capacity, not the whole product.
- id: failover
  title: Failover
  explainer: Shift traffic from a failed component or region to a healthy one. The healthy side must have room to absorb it.
- id: retries
  title: Retries
  explainer: Retrying hides transient errors but multiplies load during real overload. Bound them with budgets.
- id: backoff
  title: Exponential backoff
  explainer: Wait longer between each retry so a struggling service gets room to recover.
- id: jitter
  title: Jitter
  explainer: Add randomness to retry and reconnect timing so clients don't all come back at the same instant.
- id: partitioning
  title: Partitioning (sharding)
  explainer: Split data across nodes by key. The partition key decides whether load spreads evenly or piles onto one node.
- id: queues
  title: Queues
  explainer: Put work in a buffer and let workers consume it at their own pace, decoupling producers from consumers.
- id: backpressure
  title: Backpressure
  explainer: When consumers fall behind, slow the producers down or reject work, instead of letting queues grow without bound.
- id: rate-limiting
  title: Rate limiting
  explainer: Cap how many requests a client or the whole system accepts per second, rejecting the excess fast and cheaply.
- id: waiting-rooms
  title: Virtual waiting rooms
  explainer: Admit users at a rate the system can handle and queue the rest with honest feedback, instead of letting everyone in and failing.
- id: consistency
  title: Consistency
  explainer: Decide which reads must see the latest write. Strong consistency costs latency and availability; eventual consistency costs correctness windows.
- id: idempotency
  title: Idempotency
  explainer: Make retried operations safe by giving each a unique key, so doing it twice has the same effect as doing it once.
- id: locking
  title: Locking and reservations
  explainer: Prevent two buyers from getting the same item, by holding a short reservation or using conditional writes.
```

`packages/scenarios/content/worlds.yaml`:
```yaml
- id: url-shortener
  title: URL Shortener
  emoji: "🔗"
  description: The interview classic. Learn the basics of scaling, caching and hot keys on a tiny service that suddenly matters.
  stages: ["1k users", "100k users", "10M users"]
- id: twitter
  title: Twitter
  emoji: "🐦"
  description: Timelines, celebrities and the fan-out problem at the scale of a global town square.
  stages: ["10M users", "100M users"]
- id: netflix
  title: Netflix
  emoji: "🎬"
  description: Resilience engineering at streaming scale. Dependencies fail, regions fail, and the show must go on.
  stages: ["50M users", "200M users"]
- id: discord
  title: Discord
  emoji: "💬"
  description: Real-time chat with huge servers, trillions of messages and millions of persistent connections.
  stages: ["10M users", "150M users"]
- id: ticketmaster
  title: Ticketmaster
  emoji: "🎟️"
  description: Flash sales where everyone shows up at the same second and every seat can be sold only once.
  stages: ["Presale", "On-sale"]
```

- [ ] **Step 3: Write the failing tests**

`packages/scenarios/test/minimal.ts`:
```ts
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
```

`packages/scenarios/test/parse.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseCatalog, parseScenario, ScenarioError } from '../src/parse';
import { CONCEPTS, MINIMAL, WORLDS } from './minimal';

const catalog = parseCatalog(CONCEPTS, WORLDS);
const issuesOf = (yaml: string): string[] => {
  try {
    parseScenario(yaml, catalog, 'test.yaml');
  } catch (e) {
    if (e instanceof ScenarioError) return e.issues;
    throw e;
  }
  return [];
};

describe('parseScenario', () => {
  it('parses a valid scenario into engine input', () => {
    const s = parseScenario(MINIMAL, catalog, 'test.yaml');
    expect(s.id).toBe('tiny');
    expect(s.sim.edges).toEqual([{ from: 'lb', to: 'api' }, { from: 'api', to: 'db' }]);
    expect(s.sim.routes[0]!.path).toEqual(['lb', 'api', 'db']);
    expect(s.sim.slo.p99Ms).toBe(800);
    expect(s.solution[0]!.action).toBe('add-cache');
  });

  it('reports schema errors with field paths and the file name', () => {
    expect(() => parseScenario(MINIMAL.replace('difficulty: 1', 'difficulty: 9'), catalog, 'test.yaml')).toThrow(/test\.yaml/);
    expect(issuesOf(MINIMAL.replace('difficulty: 1', 'difficulty: 9'))[0]).toMatch(/^difficulty: /);
    expect(issuesOf(MINIMAL.replace('kind: db', 'kind: database'))[0]).toMatch(/^architecture\.nodes\.2\.kind: /);
  });

  it('reports engine graph errors', () => {
    expect(issuesOf(MINIMAL.replace('path: [lb, api, db]', 'path: [lb, db]'))).toContain('route "GET /" uses missing edge lb->db');
  });

  it('reports catalog and toolbox cross-reference errors', () => {
    expect(issuesOf(MINIMAL.replace('concepts: [caching]', 'concepts: [cachin]'))).toContain('unknown concept "cachin"');
    expect(issuesOf(MINIMAL.replace('world: url-shortener', 'world: nowhere'))).toContain('unknown world "nowhere"');
    expect(issuesOf(MINIMAL.replace('stage: "1k users"', 'stage: "1M users"'))).toContain('stage "1M users" is not a stage of world "url-shortener"');
    expect(issuesOf(MINIMAL.replace('mitigate: [scale]', 'mitigate: [scale, add-cache]'))).toContain('toolbox.mitigate: "add-cache" is a design action');
    expect(issuesOf(MINIMAL.replace('design: [add-cache]', 'design: [add-cache, scale]'))).toContain('toolbox.design: "scale" is a mitigation');
    expect(issuesOf(MINIMAL.replace('requiredDesignFixes: [add-cache]', 'requiredDesignFixes: [add-read-replica]'))).toContain(
      'requiredDesignFixes: "add-read-replica" is not in toolbox.design',
    );
    expect(issuesOf(MINIMAL.replace('action: add-cache, target: db', 'action: rollback, target: api'))).toEqual(
      expect.arrayContaining(['solution: "rollback" is not in the toolbox', 'solution never applies a required design fix']),
    );
  });
});

describe('parseCatalog', () => {
  it('rejects duplicate ids', () => {
    expect(() => parseCatalog(CONCEPTS + CONCEPTS, WORLDS)).toThrow('duplicate concept id "caching"');
  });
});
```

- [ ] **Step 4: Run them to make sure they fail**

Run: `pnpm --filter @paged/scenarios test`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement**

`packages/scenarios/src/schema.ts`:
```ts
import { ACTION_IDS, type ActionId } from '@paged/engine';
import { z } from 'zod';

const slug = z.string().regex(/^[a-z0-9-]+$/, 'use lowercase letters, digits and dashes');
const actionId = z.enum(ACTION_IDS as unknown as [ActionId, ...ActionId[]]);

const retryPolicy = z.object({
  maxRetries: z.number().int().min(0).max(5),
  backoff: z.enum(['none', 'exponential']),
  jitter: z.boolean(),
}).strict();

const node = z.object({
  id: slug,
  kind: z.enum(['client', 'cdn', 'lb', 'service', 'cache', 'db', 'queue', 'worker', 'external']),
  label: z.string().optional(),
  instances: z.number().int().min(0).optional(),
  capacityPerInstance: z.number().positive().optional(),
  writeCapacityPerInstance: z.number().positive().optional(),
  baseLatencyMs: z.number().positive().optional(),
  timeoutMs: z.number().positive().optional(),
  poolSize: z.number().int().positive().optional(),
  retryPolicy: retryPolicy.optional(),
  costPerInstanceHour: z.number().min(0).optional(),
  hitRatio: z.number().min(0).max(1).optional(),
  warmRatePerSec: z.number().positive().optional(),
  partitioned: z.boolean().optional(),
}).strict();

const pattern = z.discriminatedUnion('type', [
  z.object({ type: z.literal('flat') }).strict(),
  z.object({ type: z.literal('ramp'), from: z.number().min(0), to: z.number().min(0), startAt: z.number().min(0), endAt: z.number().min(0) }).strict(),
  z.object({ type: z.literal('daily'), periodSec: z.number().positive(), amplitude: z.number().min(0).max(1) }).strict(),
]);

const route = z.object({
  id: z.string().min(1),
  path: z.array(z.string()).min(1),
  rps: z.number().min(0),
  readRatio: z.number().min(0).max(1).optional(),
  pattern: pattern.optional(),
}).strict();

const at = z.number().min(0);
const fault = z.discriminatedUnion('type', [
  z.object({ at, type: z.literal('traffic-spike'), route: z.string().optional(), multiplier: z.number().positive(), durationSec: z.number().positive().optional() }).strict(),
  z.object({ at, type: z.literal('latency-injection'), target: z.string(), addMs: z.number().positive(), durationSec: z.number().positive().optional() }).strict(),
  z.object({ at, type: z.literal('bad-deploy'), target: z.string(), errorRate: z.number().gt(0).max(1) }).strict(),
  z.object({ at, type: z.literal('instance-crash'), target: z.string(), count: z.number().int().min(1) }).strict(),
  z.object({ at, type: z.literal('cache-flush'), target: z.string() }).strict(),
  z.object({ at, type: z.literal('hot-key'), target: z.string(), share: z.number().gt(0).lt(1) }).strict(),
]);

const solutionStep = z.object({
  at,
  action: actionId,
  target: z.string(),
  params: z.record(z.union([z.number(), z.boolean(), z.string()])).optional(),
}).strict();

export const scenarioSchema = z.object({
  id: slug,
  world: z.string(),
  stage: z.string(),
  order: z.number().int().min(1),
  title: z.string().min(1),
  difficulty: z.number().int().min(1).max(5),
  concepts: z.array(z.string()).min(1),
  briefing: z.string().min(1),
  slo: z.object({ availability: z.number().gt(0).lt(100), p99Ms: z.number().positive() }).strict(),
  errorBudgetSeconds: z.number().positive(),
  seed: z.number().int(),
  timeLimitSeconds: z.number().positive().optional(),
  baseUsers: z.number().int().positive().optional(),
  architecture: z.object({ nodes: z.array(node).min(1), edges: z.array(z.tuple([z.string(), z.string()])) }).strict(),
  traffic: z.array(route).min(1),
  faults: z.array(fault).min(1),
  toolbox: z.object({ mitigate: z.array(actionId), design: z.array(actionId).min(1) }).strict(),
  win: z.object({ sloHealthyForSeconds: z.number().positive() }).strict(),
  requiredDesignFixes: z.array(actionId).min(1),
  budgetTarget: z.number().min(0).max(1),
  costTarget: z.number().positive(),
  solution: z.array(solutionStep).min(1),
  clues: z.array(z.string()),
  debrief: z.object({
    whatHappened: z.string().min(1),
    lesson: z.string().min(1),
    realWorld: z.string().min(1),
    interviewMoment: z.object({ question: z.string().min(1), modelAnswer: z.string().min(1) }).strict(),
    sources: z.array(z.string().url()),
  }).strict(),
}).strict();

export const conceptsSchema = z.array(z.object({ id: slug, title: z.string().min(1), explainer: z.string().min(1) }).strict());

export const worldsSchema = z.array(
  z.object({
    id: slug,
    title: z.string().min(1),
    emoji: z.string().min(1),
    description: z.string().min(1),
    stages: z.array(z.string()).min(1),
  }).strict(),
);

export type ScenarioFile = z.infer<typeof scenarioSchema>;
```

`packages/scenarios/src/types.ts`:
```ts
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
```

`packages/scenarios/src/parse.ts`:
```ts
import { actionCategory, validateSimScenario, type SimScenario } from '@paged/engine';
import { parse as parseYaml } from 'yaml';
import type { ZodError } from 'zod';
import { conceptsSchema, scenarioSchema, worldsSchema, type ScenarioFile } from './schema';
import type { Catalog, Scenario } from './types';

export class ScenarioError extends Error {
  constructor(public readonly source: string, public readonly issues: string[]) {
    super(`${source}:\n- ${issues.join('\n- ')}`);
    this.name = 'ScenarioError';
  }
}

const zodIssues = (e: ZodError): string[] =>
  e.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);

function uniqueIds(items: { id: string }[], what: string): void {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) throw new ScenarioError(`${what}s.yaml`, [`duplicate ${what} id "${it.id}"`]);
    seen.add(it.id);
  }
}

export function parseCatalog(conceptsYaml: string, worldsYaml: string): Catalog {
  const c = conceptsSchema.safeParse(parseYaml(conceptsYaml));
  if (!c.success) throw new ScenarioError('concepts.yaml', zodIssues(c.error));
  const w = worldsSchema.safeParse(parseYaml(worldsYaml));
  if (!w.success) throw new ScenarioError('worlds.yaml', zodIssues(w.error));
  uniqueIds(c.data, 'concept');
  uniqueIds(w.data, 'world');
  return { concepts: c.data, worlds: w.data };
}

export function parseScenario(yamlText: string, catalog: Catalog, source = 'scenario'): Scenario {
  const parsed = scenarioSchema.safeParse(parseYaml(yamlText));
  if (!parsed.success) throw new ScenarioError(source, zodIssues(parsed.error));
  const f = parsed.data;
  const sim: SimScenario = {
    nodes: f.architecture.nodes,
    edges: f.architecture.edges.map(([from, to]) => ({ from, to })),
    routes: f.traffic,
    faults: f.faults,
    slo: f.slo,
    errorBudgetSeconds: f.errorBudgetSeconds,
    win: f.win,
    timeLimitSeconds: f.timeLimitSeconds,
    baseUsers: f.baseUsers,
  };
  const issues = [...validateSimScenario(sim), ...crossRefIssues(f, catalog)];
  if (issues.length > 0) throw new ScenarioError(source, issues);
  return {
    id: f.id,
    world: f.world,
    stage: f.stage,
    order: f.order,
    title: f.title,
    difficulty: f.difficulty,
    concepts: f.concepts,
    briefing: f.briefing,
    seed: f.seed,
    sim,
    toolbox: f.toolbox,
    requiredDesignFixes: f.requiredDesignFixes,
    budgetTarget: f.budgetTarget,
    costTarget: f.costTarget,
    solution: f.solution,
    clues: f.clues,
    debrief: f.debrief,
  };
}

function crossRefIssues(f: ScenarioFile, catalog: Catalog): string[] {
  const issues: string[] = [];
  const conceptIds = new Set(catalog.concepts.map((c) => c.id));
  for (const c of f.concepts) if (!conceptIds.has(c)) issues.push(`unknown concept "${c}"`);
  const world = catalog.worlds.find((w) => w.id === f.world);
  if (!world) issues.push(`unknown world "${f.world}"`);
  else if (!world.stages.includes(f.stage)) issues.push(`stage "${f.stage}" is not a stage of world "${f.world}"`);
  for (const a of f.toolbox.mitigate) if (actionCategory(a) !== 'mitigate') issues.push(`toolbox.mitigate: "${a}" is a design action`);
  for (const a of f.toolbox.design) if (actionCategory(a) !== 'design') issues.push(`toolbox.design: "${a}" is a mitigation`);
  for (const a of f.requiredDesignFixes) {
    if (!f.toolbox.design.includes(a)) issues.push(`requiredDesignFixes: "${a}" is not in toolbox.design`);
  }
  const toolbox = new Set([...f.toolbox.mitigate, ...f.toolbox.design]);
  for (const st of f.solution) if (!toolbox.has(st.action)) issues.push(`solution: "${st.action}" is not in the toolbox`);
  if (!f.solution.some((st) => f.requiredDesignFixes.includes(st.action))) {
    issues.push('solution never applies a required design fix');
  }
  return issues;
}
```

`packages/scenarios/src/index.ts` (browser-safe, no `fs`; Task 9 adds the headless export):
```ts
export * from './types';
export { parseCatalog, parseScenario, ScenarioError } from './parse';
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @paged/scenarios test && pnpm --filter @paged/scenarios typecheck`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(scenarios): schema, catalog and cross-reference validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Headless verifier, disk loader and `pnpm validate`

**Files:**
- Create: `packages/scenarios/src/headless.ts`, `src/node-loader.ts`, `src/cli.ts`
- Modify: `packages/scenarios/src/index.ts` (add the headless export line)
- Test: `packages/scenarios/test/headless.test.ts`, `packages/scenarios/test/content.test.ts`

**Interfaces:**
- Consumes: `createSimulation`, `scoreRun`, `actionCategory` from the engine; `Scenario`, `Catalog`, `parseCatalog`, `parseScenario`.
- Produces:
  - `type HeadlessMode = 'none' | 'mitigate-only' | 'full'`
  - `interface HeadlessResult { mode: HeadlessMode; outcome: Outcome; stars: Stars; t: number; stats: GlobalStats }`
  - `runHeadless(sc: Scenario, mode: HeadlessMode): HeadlessResult` (throws if a solution step is rejected)
  - `interface ScenarioCheck { id: string; results: HeadlessResult[]; failures: string[] }`
  - `checkScenario(sc: Scenario): ScenarioCheck`
  - `CONTENT_ROOT: string`, `loadCatalogFromDisk(root?): Catalog`, `loadAllScenariosFromDisk(root?): Scenario[]` (sorted by world order then `order`; throws on duplicate ids or duplicate `(world, order)`)

- [ ] **Step 1: Write the failing tests**

`packages/scenarios/test/headless.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { checkScenario, runHeadless } from '../src/headless';
import { parseCatalog, parseScenario } from '../src/parse';
import { CONCEPTS, MINIMAL, WORLDS } from './minimal';

const catalog = parseCatalog(CONCEPTS, WORLDS);

describe('runHeadless', () => {
  it('none loses, full wins with the design fix', () => {
    const sc = parseScenario(
      MINIMAL.replace('{ id: db, kind: db, capacityPerInstance: 1000 }', '{ id: db, kind: db, capacityPerInstance: 600 }')
        .replace('{ id: api, kind: service, instances: 2, capacityPerInstance: 500 }', '{ id: api, kind: service, instances: 8, capacityPerInstance: 500 }')
        .replace('costTarget: 100', 'costTarget: 1000')
        .replace('errorBudgetSeconds: 60', 'errorBudgetSeconds: 200'),
      catalog,
    );
    expect(runHeadless(sc, 'none').outcome).toBe('lost');
    const full = runHeadless(sc, 'full');
    expect(full.outcome).toBe('won');
    expect(full.stars).toBeGreaterThanOrEqual(2);
  });

  it('throws a clear error when a solution step is rejected', () => {
    const sc = parseScenario(MINIMAL.replace('action: add-cache, target: db', 'action: add-cache, target: lb'), catalog);
    expect(() => runHeadless(sc, 'full')).toThrow('tiny: solution step add-cache@6s on "lb" was rejected: Add cache can\'t target a lb');
  });
});

describe('checkScenario', () => {
  it('reports which expectation failed', () => {
    // The spike overloads the API (1500 rps vs 1000 capacity); caching the db can't fix that, so full must fail.
    const sc = parseScenario(MINIMAL, catalog);
    const check = checkScenario(sc);
    expect(check.failures.some((f) => f.startsWith('full: expected won'))).toBe(true);
  });
});
```

`packages/scenarios/test/content.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { checkScenario } from '../src/headless';
import { loadAllScenariosFromDisk, loadCatalogFromDisk } from '../src/node-loader';

describe('shipped content', () => {
  const catalog = loadCatalogFromDisk();
  const scenarios = loadAllScenariosFromDisk();

  it('has the v1 worlds and concepts', () => {
    expect(catalog.worlds.map((w) => w.id)).toEqual(['url-shortener', 'twitter', 'netflix', 'discord', 'ticketmaster']);
    expect(catalog.concepts.length).toBeGreaterThanOrEqual(25);
  });

  it('every scenario teaches its lesson', () => {
    expect(scenarios.length).toBeGreaterThan(0);
    for (const sc of scenarios) {
      expect(checkScenario(sc).failures, sc.id).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @paged/scenarios test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`packages/scenarios/src/headless.ts`:
```ts
import { actionCategory, createSimulation, scoreRun, type GlobalStats, type Outcome, type Stars } from '@paged/engine';
import type { Scenario } from './types';

export type HeadlessMode = 'none' | 'mitigate-only' | 'full';

export interface HeadlessResult {
  mode: HeadlessMode;
  outcome: Outcome;
  stars: Stars;
  t: number;
  stats: GlobalStats;
}

export interface ScenarioCheck {
  id: string;
  results: HeadlessResult[];
  failures: string[];
}

export function runHeadless(sc: Scenario, mode: HeadlessMode): HeadlessResult {
  const sim = createSimulation(sc.sim, { seed: sc.seed });
  const queue = (mode === 'none' ? [] : sc.solution)
    .filter((st) => mode === 'full' || actionCategory(st.action) === 'mitigate')
    .slice()
    .sort((a, b) => a.at - b.at);
  while (sim.outcome() === 'running') {
    while (queue.length > 0 && (queue[0]?.at ?? Infinity) <= sim.time() + 1e-9) {
      const st = queue.shift()!;
      const res = sim.apply({ action: st.action, target: st.target, params: st.params });
      if (!res.ok) {
        throw new Error(`${sc.id}: solution step ${st.action}@${st.at}s on "${st.target}" was rejected: ${res.reason}`);
      }
    }
    sim.tick();
  }
  const stats = sim.stats();
  const stars = scoreRun(
    {
      outcome: sim.outcome(),
      effectiveActions: sim.effectiveActions(),
      budgetFraction: stats.errorBudgetFraction,
      costPerHour: stats.costPerHour,
      cluesUsed: 0,
    },
    sc,
  );
  return { mode, outcome: sim.outcome(), stars, t: sim.time(), stats };
}

export function checkScenario(sc: Scenario): ScenarioCheck {
  const failures: string[] = [];
  const results: HeadlessResult[] = [];
  const attempt = (mode: HeadlessMode): HeadlessResult | null => {
    try {
      const r = runHeadless(sc, mode);
      results.push(r);
      return r;
    } catch (e) {
      failures.push(`${mode}: ${(e as Error).message}`);
      return null;
    }
  };
  const none = attempt('none');
  if (none && none.outcome !== 'lost') failures.push(`none: expected lost, got ${none.outcome} at ${none.t}s`);
  const mit = attempt('mitigate-only');
  if (mit && mit.stars >= 2) failures.push(`mitigate-only: expected < 2 stars, got ${mit.stars}`);
  const full = attempt('full');
  if (full && (full.outcome !== 'won' || full.stars < 2)) {
    failures.push(
      `full: expected won with >= 2 stars, got ${full.outcome} with ${full.stars} at ${full.t}s ` +
        `(availability ${full.stats.availability.toFixed(4)}, p99 ${Math.round(full.stats.worstP99Ms)}ms, ` +
        `budget ${(full.stats.errorBudgetFraction * 100).toFixed(0)}%, cost $${full.stats.costPerHour}/h)`,
    );
  }
  return { id: sc.id, results, failures };
}
```


`packages/scenarios/src/node-loader.ts`:
```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCatalog, parseScenario } from './parse';
import type { Catalog, Scenario } from './types';

export const CONTENT_ROOT = fileURLToPath(new URL('../content', import.meta.url));

export function loadCatalogFromDisk(root = CONTENT_ROOT): Catalog {
  return parseCatalog(readFileSync(join(root, 'concepts.yaml'), 'utf8'), readFileSync(join(root, 'worlds.yaml'), 'utf8'));
}

export function loadAllScenariosFromDisk(root = CONTENT_ROOT): Scenario[] {
  const catalog = loadCatalogFromDisk(root);
  const dir = join(root, 'scenarios');
  const scenarios: Scenario[] = [];
  for (const world of readdirSync(dir, { withFileTypes: true })) {
    if (!world.isDirectory()) continue;
    for (const file of readdirSync(join(dir, world.name))) {
      if (!file.endsWith('.yaml')) continue;
      const path = join(dir, world.name, file);
      const sc = parseScenario(readFileSync(path, 'utf8'), catalog, `scenarios/${world.name}/${file}`);
      if (sc.world !== world.name) throw new Error(`scenarios/${world.name}/${file}: world "${sc.world}" does not match its folder`);
      scenarios.push(sc);
    }
  }
  const ids = new Set<string>();
  const slots = new Set<string>();
  for (const sc of scenarios) {
    if (ids.has(sc.id)) throw new Error(`duplicate scenario id "${sc.id}"`);
    ids.add(sc.id);
    const slot = `${sc.world}#${sc.order}`;
    if (slots.has(slot)) throw new Error(`two scenarios in "${sc.world}" have order ${sc.order}`);
    slots.add(slot);
  }
  const worldIndex = new Map(catalog.worlds.map((w, i) => [w.id, i]));
  return scenarios.sort((a, b) => (worldIndex.get(a.world)! - worldIndex.get(b.world)!) || a.order - b.order);
}
```

`packages/scenarios/src/cli.ts`:
```ts
import { checkScenario } from './headless';
import { loadAllScenariosFromDisk } from './node-loader';

const scenarios = loadAllScenariosFromDisk();
let failed = 0;
for (const sc of scenarios) {
  const check = checkScenario(sc);
  const summary = check.results.map((r) => `${r.mode}: ${r.outcome} ${'★'.repeat(r.stars) || '-'} @${r.t}s`).join(' | ');
  const ok = check.failures.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${sc.id.padEnd(28)} ${summary}`);
  for (const f of check.failures) console.log(`    ${f}`);
}
console.log(`\n${scenarios.length - failed}/${scenarios.length} scenarios OK`);
process.exit(failed > 0 ? 1 : 0);
```

Append to `src/index.ts`:
```ts
export { runHeadless, checkScenario, type HeadlessMode, type HeadlessResult, type ScenarioCheck } from './headless';
```

Create an empty directory with a placeholder so the loader has a folder: `packages/scenarios/content/scenarios/url-shortener/` (Task 10 fills it). The content test fails until then (`scenarios.length > 0`). That is expected; run only `headless.test.ts` in Step 4.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @paged/scenarios exec vitest run test/headless.test.ts test/parse.test.ts && pnpm --filter @paged/scenarios typecheck`
Expected: pass. If the `none loses, full wins` numbers don't hold, re-derive them by hand: api 8×500 = 4000 handles the spiked 1500 rps; db at 600 capacity is overloaded at 1500 until the cache warms past a 0.6 hit ratio (~30 s after it lands at 26 s). Adjust only the test YAML, never the engine.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scenarios): headless verifier, disk loader and validate CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: URL Shortener world (3 tutorial incidents)

**Files:**
- Create: `packages/scenarios/content/scenarios/url-shortener/launch-day.yaml`
- Create: `packages/scenarios/content/scenarios/url-shortener/read-heavy.yaml`
- Create: `packages/scenarios/content/scenarios/url-shortener/viral-link.yaml`
- Test: `packages/scenarios/test/content.test.ts` (from Task 9) plus `pnpm validate`

**Interfaces:**
- Consumes: the scenario format from Task 8.
- Produces: 3 verified scenarios for Plan 2's UI.

**Tuning rule:** if `pnpm validate` fails, change **scenario numbers only** (capacities, rps, budget, targets, solution timings), never engine code. Each YAML's comments record the expected arithmetic so a reviewer can check it.

- [ ] **Step 1: `launch-day.yaml`**

```yaml
# Expected dynamics:
#  before: api 650 rps / 1000 cap -> rho 0.65, healthy.
#  t=20 spike x4 -> 2600 rps, api rho 2.6 -> ~24% availability, burns ~1.0 budget/s -> do nothing loses ~t=139.
#  mitigate-only: scale +2 (lands t=51) -> rho 1.3, still ~48% availability -> loses.
#  full: autoscaling (on at t=32, launches 7 at t=37, ready t=52) + scale +2 -> 11 instances, rho 0.47 -> wins ~t=112.
id: launch-day
world: url-shortener
stage: "1k users"
order: 1
title: "Launch day: you hit the front page"
difficulty: 1
concepts: [horizontal-scaling, load-balancing, autoscaling]
briefing: >
  Your tiny URL shortener just hit the front page of a big tech news site. Two API servers behind a
  load balancer were plenty yesterday. Keep the service up.
slo: { availability: 99.9, p99Ms: 800 }
errorBudgetSeconds: 120
seed: 101
architecture:
  nodes:
    - { id: lb, kind: lb, label: Load balancer, baseLatencyMs: 1, timeoutMs: 2000, costPerInstanceHour: 5 }
    - { id: api, kind: service, label: API, instances: 2, capacityPerInstance: 500, baseLatencyMs: 20, costPerInstanceHour: 10 }
    - { id: db, kind: db, label: Postgres, capacityPerInstance: 5000, writeCapacityPerInstance: 2000, baseLatencyMs: 5, costPerInstanceHour: 40 }
  edges: [[lb, api], [api, db]]
traffic:
  - { id: "GET /:code", path: [lb, api, db], rps: 600, readRatio: 1 }
  - { id: "POST /shorten", path: [lb, api, db], rps: 50, readRatio: 0 }
faults:
  - { at: 20, type: traffic-spike, multiplier: 4 }
toolbox:
  mitigate: [scale, shed-load, rate-limit]
  design: [enable-autoscaling]
win: { sloHealthyForSeconds: 60 }
requiredDesignFixes: [enable-autoscaling]
budgetTarget: 0.5
costTarget: 200
solution:
  - { at: 21, action: scale, target: api, params: { delta: 2 } }
  - { at: 22, action: enable-autoscaling, target: api, params: { targetUtilization: 0.6 } }
clues:
  - "Which component turned red first? Click it and look at its utilization."
  - "The API is stateless. What happens if you run more copies of it?"
  - "Manual scaling works today. What happens tomorrow, when traffic doubles again while you're asleep?"
debrief:
  whatHappened: >
    Traffic jumped 4x. Two API instances can serve about 1,000 requests per second; they were offered 2,600.
    Past 100% utilization a server can't serve more, so the excess was rejected, and the requests it did accept
    queued until they hit the load balancer's timeout.
  lesson: >
    Stateless services scale horizontally: add instances behind a load balancer. Autoscaling does it for you based
    on utilization, but new instances take time to boot, so target ~60% utilization rather than 90% to leave
    headroom for the next spike.
  realWorld: >
    Every major cloud offers this exact loop. AWS Auto Scaling groups and the Kubernetes Horizontal Pod Autoscaler
    both add instances when a metric such as CPU crosses a target, and both document that new capacity takes time
    to become ready.
  interviewMoment:
    question: "Your service is getting 4x its normal traffic. Walk me through how you'd handle it, now and long term."
    modelAnswer: >
      Now: confirm the bottleneck (API CPU, not the database), scale the stateless tier horizontally, and shed or
      rate-limit if new capacity is still booting. Long term: autoscale on a utilization target with headroom
      (~60%), keep the service stateless so any instance can serve any request, load-test to know the per-instance
      capacity, and make sure the next bottleneck (usually the database) can absorb the extra load.
  sources:
    - https://docs.aws.amazon.com/autoscaling/ec2/userguide/what-is-amazon-ec2-auto-scaling.html
    - https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/
```

- [ ] **Step 2: `read-heavy.yaml`**

```yaml
# Expected dynamics:
#  before: db reads 1200/2000 + writes 100/1000 -> rho 0.7, healthy.
#  t=15 spike x2.5 on reads -> db rho 1.6 -> ~54% availability, db latency 500ms -> do nothing loses.
#  mitigate-only: rate-limit lb at 2000 -> still ~46% errors -> loses.
#  full: add-cache on db (lands t=37, warms 0.02/s); at t=65 hit ~0.56 -> db rho ~0.76; lift rate limit at t=65 -> wins ~t=125.
id: read-heavy
world: url-shortener
stage: "100k users"
order: 2
title: "The database is drowning in reads"
difficulty: 2
concepts: [caching, read-heavy, read-replicas]
briefing: >
  A popular newsletter just linked dozens of your short links. Redirects are pure reads, and every one of them
  goes to the database.
slo: { availability: 99.9, p99Ms: 800 }
errorBudgetSeconds: 120
seed: 202
architecture:
  nodes:
    - { id: lb, kind: lb, label: Load balancer, baseLatencyMs: 1, timeoutMs: 2000, costPerInstanceHour: 5 }
    - { id: api, kind: service, label: API, instances: 8, capacityPerInstance: 500, baseLatencyMs: 20, costPerInstanceHour: 10 }
    - { id: db, kind: db, label: Postgres, capacityPerInstance: 2000, writeCapacityPerInstance: 1000, baseLatencyMs: 5, costPerInstanceHour: 40 }
  edges: [[lb, api], [api, db]]
traffic:
  - { id: "GET /:code", path: [lb, api, db], rps: 1200, readRatio: 1 }
  - { id: "POST /shorten", path: [lb, api, db], rps: 100, readRatio: 0 }
faults:
  - { at: 15, type: traffic-spike, route: "GET /:code", multiplier: 2.5 }
toolbox:
  mitigate: [scale, rate-limit, shed-load]
  design: [add-cache, add-read-replica]
win: { sloHealthyForSeconds: 60 }
requiredDesignFixes: [add-cache, add-read-replica]
budgetTarget: 0.5
costTarget: 200
solution:
  - { at: 16, action: rate-limit, target: lb, params: { rps: 2000 } }
  - { at: 17, action: add-cache, target: db }
  - { at: 65, action: rate-limit, target: lb, params: { rps: 0 } }
clues:
  - "The API looks fine. What is it waiting on?"
  - "Almost every request is a read of a link that never changes. Does it need to hit the database every time?"
  - "Scaling the API adds more callers to the same database."
debrief:
  whatHappened: >
    Redirect traffic jumped 2.5x and every redirect read the same small set of rows from the primary database.
    The database saturated, its latency went from milliseconds to half a second, and API requests began timing out
    waiting for it. More API servers would only have added more callers.
  lesson: >
    Read-heavy workloads should rarely reach the database. Short links are immutable, which makes them perfect
    cache entries. A cache in front of the database absorbs repeat reads; read replicas are the alternative when
    data changes often or the working set is too big to cache. Remember that a new cache starts cold.
  realWorld: >
    Caching hot, rarely changing data in an in-memory store like Redis or Memcached is standard practice, and
    managed databases offer read replicas specifically to scale read traffic away from the primary.
  interviewMoment:
    question: "Your URL shortener does 100 reads per write. How do you design the read path?"
    modelAnswer: >
      Put a cache (Redis or Memcached) in front of the database keyed by short code, with a long TTL because
      mappings are immutable. Expect a 95%+ hit ratio. Use read replicas for cache misses if needed, and a CDN for
      the hottest links. Plan for a cold cache: warm it or protect the database while it fills. Writes go to the
      primary and can populate the cache.
  sources:
    - https://aws.amazon.com/caching/best-practices/
    - https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html
```

- [ ] **Step 3: `viral-link.yaml`**

```yaml
# Expected dynamics:
#  before: cache 2600/12000 -> rho 0.22, healthy.
#  t=20 hot-key share 0.5 + GET x3 -> cache hot partition rho ~1.58 -> ~77% availability -> do nothing loses.
#  mitigate-only: scale cache +4 -> hot share 0.5625, hot rho ~1.43 -> still overloaded -> loses.
#  full: add-cdn in front of lb (lands t=52, warms 0.05/s); hit >= ~0.37 by t=60 -> hot rho < 0.9 -> wins ~t=120.
id: viral-link
world: url-shortener
stage: "10M users"
order: 3
title: "One link goes viral"
difficulty: 3
concepts: [hot-keys, edge-caching, partitioning]
briefing: >
  A celebrity just posted one of your short links to a hundred million followers. Your cache cluster is big,
  and mostly idle. Somehow it's on fire anyway.
slo: { availability: 99.9, p99Ms: 800 }
errorBudgetSeconds: 120
seed: 303
architecture:
  nodes:
    - { id: lb, kind: lb, label: Load balancer, baseLatencyMs: 1, timeoutMs: 2000, costPerInstanceHour: 5 }
    - { id: api, kind: service, label: API, instances: 20, capacityPerInstance: 500, baseLatencyMs: 20, costPerInstanceHour: 10 }
    - { id: cache, kind: cache, label: Redis cluster, instances: 4, capacityPerInstance: 3000, baseLatencyMs: 1, hitRatio: 0.95, partitioned: true, costPerInstanceHour: 15 }
    - { id: db, kind: db, label: Postgres, capacityPerInstance: 3000, writeCapacityPerInstance: 1500, baseLatencyMs: 5, costPerInstanceHour: 40 }
  edges: [[lb, api], [api, cache], [cache, db]]
traffic:
  - { id: "GET /:code", path: [lb, api, cache, db], rps: 2500, readRatio: 1 }
  - { id: "POST /shorten", path: [lb, api, cache, db], rps: 100, readRatio: 0 }
faults:
  - { at: 20, type: hot-key, target: cache, share: 0.5 }
  - { at: 20, type: traffic-spike, route: "GET /:code", multiplier: 3 }
toolbox:
  mitigate: [scale, rate-limit, shed-load]
  design: [add-cdn, request-coalescing]
win: { sloHealthyForSeconds: 60 }
requiredDesignFixes: [add-cdn]
budgetTarget: 0.5
costTarget: 450
solution:
  - { at: 21, action: scale, target: cache, params: { delta: 4 } }
  - { at: 22, action: add-cdn, target: lb }
clues:
  - "The cache cluster's average load is low, but one node is saturated. Why would one node get more than its share?"
  - "Adding cache nodes re-spreads the other keys. Where does the hot key live afterwards?"
  - "This link's response is the same for everyone. Does it even need to reach your servers?"
debrief:
  whatHappened: >
    Half of all traffic was for a single short link. A key lives on exactly one cache shard, so one node took half
    the load while the other three idled. Adding nodes didn't help: the hot key still maps to one node.
  lesson: >
    Hot keys break the assumption that partitioning spreads load evenly. Fixes are to cache the hot item closer to
    users (CDN or in-process cache), replicate the hot key across shards, or split it. Redirects for a popular link
    are identical for everyone, so a CDN can serve them without your origin ever seeing the traffic.
  realWorld: >
    CDNs exist for exactly this: serving popular, cacheable responses from edge locations near users so the origin
    only sees cache misses.
  interviewMoment:
    question: "One key is getting 50% of your traffic and the shard that owns it is melting. What do you do?"
    modelAnswer: >
      Confirm it's a hot key (one shard saturated while the cluster average is low). Short term: serve it from a
      local or edge cache, or replicate the key to several shards and read from any. Longer term: put a CDN in
      front of cacheable responses, detect hot keys automatically, and choose partition keys that spread load. Note
      that adding shards doesn't help, because the key still hashes to one shard.
  sources:
    - https://www.cloudflare.com/learning/cdn/what-is-a-cdn/
```

- [ ] **Step 4: Verify sources are live**

For each URL in the three `sources` lists, fetch it (WebFetch or `curl -sIL -o /dev/null -w "%{http_code}" <url>`) and confirm a 200 and that the page matches the claim in `realWorld`. Replace any dead or mismatched URL with a live official page that supports the claim, or remove the claim.

- [ ] **Step 5: Run the validator and the content tests**

Run: `pnpm validate && pnpm --filter @paged/scenarios test`
Expected output shape:
```
✓ launch-day                   none: lost - @1xx.x s | mitigate-only: lost - @… | full: won ★★★ @…
✓ read-heavy                   …
✓ viral-link                   …

3/3 scenarios OK
```
If one fails, read the failure line (it prints availability, p99, budget and cost), adjust that YAML's numbers per its header comment, update the comment, and rerun.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "content: URL Shortener tutorial world (launch day, read-heavy, viral link)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: CI, docs and roadmap

**Files:**
- Create: `.github/workflows/ci.yml`, `docs/engine-model.md`, `docs/writing-scenarios.md`, `ROADMAP.md`, `README.md` (stub; Plan 2 writes the real one)

**Interfaces:** none (docs and CI).

- [ ] **Step 1: CI workflow** — `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm validate
```

- [ ] **Step 2: `docs/engine-model.md`**

Write these sections, copying the formulas exactly from `queueing.ts` and `step.ts`:
1. **Flow, not requests:** rates move through a DAG every 100 ms.
2. **Per tick, in order:** faults → due actions → autoscalers → flows (topological order) → latency and success (backwards along each route) → retries → cache warming → stats → outputs.
3. **Formulas:** utilization; `latency = base / (1 − min(ρ, 0.99))`; overload accept `1/ρ`; `p99 = mean × (2 + 3·min(ρ,1))`; timeout fraction `exp(−timeout/mean)`; Little's law pools (demand measured before pool rejection, applied the next tick); retries `failRate^(1+maxRetries)` for success and `out × f × Σf^k` extra load; hot partitions (`hot = share + (1−share)/n`); caches (only reads hit; misses × 0.2 with coalescing; linear warm-up); error budget burn `max(0, err − allowed) + 0.25 if p99 > SLO`.
4. **Known simplifications:** retries are modelled as expected values; synchronised retries are a single delayed lump; traces are sampled from the current state, not simulated requests.

- [ ] **Step 3: `docs/writing-scenarios.md`**

Cover: where files go; a full annotated copy of `launch-day.yaml`; the field reference (one line per field from `schema.ts`); the action list with category, valid targets, delay and params (from `ACTIONS`); the fault list with params; how `pnpm validate` judges a scenario (none loses / mitigation-only < 2★ / full wins ≥ 2★); the accuracy policy (spec §6.3) and the "verify every source URL" rule; the tuning rule (change numbers, not the engine; put the expected arithmetic in the header comment).

- [ ] **Step 4: `ROADMAP.md`**

```markdown
# Roadmap

## Plan 2: Web app
World map, concept mastery panel, incident screen (live map, inspector, toolboxes, clues), debrief with Interview Moment, localStorage progress, deploy, README with GIF.

## Plan 3: Content
- Twitter: celebrity fan-out, timeline cache restart
- Netflix: slow dependency (circuit breakers, bulkheads), region evacuation, retry storm
- Discord: hot partition, reconnect storm, fan-out lag
- Ticketmaster: presale waiting room, overselling seats
- Engine additions those need: circuit breaker, bulkhead, regions/failover, queues and workers, waiting room, idempotency keys, fan-out modes, jittered reconnect

## Later
- Worlds: Spotify, Uber, WhatsApp, Stripe, YouTube
- Famous outages: GitHub 2018 split-brain, Cloudflare 2019 regex CPU, Facebook 2021 BGP, Slack January 2021
- Build mode (design from an empty canvas against requirements)
- Replay and share a run via URL (seed + action log)
- 3D "city" renderer
```

- [ ] **Step 5: `README.md` stub**

```markdown
# Paged

Get paged. Fight a live production incident. Fix it with real system design, and walk away with an answer you can give in an interview.

> Work in progress: the engine and the first world are done; the playable web app is next. See [ROADMAP.md](ROADMAP.md).

- `packages/engine`: deterministic flow simulation ([how it works](docs/engine-model.md))
- `packages/scenarios`: incidents as YAML ([write one](docs/writing-scenarios.md))

```bash
pnpm install
pnpm test       # engine + scenario tests
pnpm validate   # play every scenario headless and check it teaches its lesson
```

MIT licensed.
```

- [ ] **Step 6: Full verification**

Run: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm validate`
Expected: all green, `3/3 scenarios OK`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "ci: add GitHub Actions; docs: engine model, scenario guide, roadmap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage (Plan 1 scope):** §3 monorepo/stack → Task 1. §4.1–4.2 model and tick → Tasks 2–4. §4.3 faults → Task 4. §4.3 actions (the subset the tutorial needs) → Task 5; the remaining actions are explicitly deferred to Plan 3. §4.4 outputs → Task 6. §4.5 API → Task 6. §5.4 scoring → Task 7. §6.1 format → Task 8. §6.2 headless CI → Task 9 and Task 11. §6.3 accuracy → Task 10 Step 4 and Task 11 Step 3. §6.4 content → Task 10 (URL Shortener only; the rest is Plan 3). §8 engine/schema/headless tests → Tasks 1–10. §9 CI → Task 11. §5.1–5.3, 5.5, 7 and the web parts of §8–9 → Plan 2.
- **Type consistency:** `RuntimeNode` fields are defined in Task 3 and used unchanged afterwards. `SimState` is defined in Task 4. `requestAction`, `applyDueActions` and `runAutoscalers` come from Task 5; `recordOutputs`, `snapshotOf` and `nodeMetrics` from Task 6; `Scenario` from Task 8; `checkScenario` and `runHeadless` from Task 9.
