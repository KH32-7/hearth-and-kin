import { loadSimData } from '../data-node';
import { Simulation } from '../../src/sim/sim';
const sim = new Simulation(loadSimData({ town: 'ashford' }), 1);
sim.apply({ kind: 'forceLod', lod: (process.argv[2] ?? 'full') as never });
sim.accidentLog = [];
for (let t = 0; t < 1440; t++) sim.tick();
const by: Record<string, number> = {};
for (const a of sim.accidentLog) { const k = `${a.action}/${a.phase} solv${a.solvable}`; by[k] = (by[k] ?? 0) + 1; }
console.log(sim.accidentLog.length, Object.entries(by).sort((a, b) => b[1] - a[1]));
const t = sim.town!;
const who: Record<string, number> = {};
for (const a of sim.accidentLog) { const p = sim.persons.find((q) => q.id === a.id); const k = p ? `${p.name}:${p.homeLot ?? t.householdResidence.get(p.household) ?? '-'}:${t.placeOf(a.x, a.y % 151)?.id ?? t.lotOf(a.x, a.y)?.id ?? '길'}` : String(a.id); who[k] = (who[k] ?? 0) + 1; }
console.log(Object.entries(who).sort((a, b) => b[1] - a[1]).slice(0, 25));
