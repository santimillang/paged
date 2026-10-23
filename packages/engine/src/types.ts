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
  /** Seconds the SLO has held continuously since every fault started; the win needs holdTargetSeconds. */
  healthyForSeconds: number;
  holdTargetSeconds: number;
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
