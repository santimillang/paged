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
