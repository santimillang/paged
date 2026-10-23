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

function readYaml(text: string, source: string): unknown {
  try {
    return parseYaml(text);
  } catch (e) {
    throw new ScenarioError(source, [`invalid YAML: ${(e as Error).message}`]);
  }
}

export function parseCatalog(conceptsYaml: string, worldsYaml: string): Catalog {
  const c = conceptsSchema.safeParse(readYaml(conceptsYaml, 'concepts.yaml'));
  if (!c.success) throw new ScenarioError('concepts.yaml', zodIssues(c.error));
  const w = worldsSchema.safeParse(readYaml(worldsYaml, 'worlds.yaml'));
  if (!w.success) throw new ScenarioError('worlds.yaml', zodIssues(w.error));
  uniqueIds(c.data, 'concept');
  uniqueIds(w.data, 'world');
  return { concepts: c.data, worlds: w.data };
}

export function parseScenario(yamlText: string, catalog: Catalog, source = 'scenario'): Scenario {
  const parsed = scenarioSchema.safeParse(readYaml(yamlText, source));
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
