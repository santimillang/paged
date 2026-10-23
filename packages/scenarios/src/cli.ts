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
