import { Simulation } from '../../src/sim/sim';
import { loadSimData } from '../data-node';
const data = loadSimData();
const agg: Record<string, number> = {};
const tags: Record<string, number> = {};
for (let seed = 1; seed <= 10; seed++) {
  const s = new Simulation(data, seed);
  s.addPerson('a', undefined, undefined, { traits: [] });
  s.addPerson('b', undefined, undefined, { traits: [] });
  for (let t = 0; t < 2 * 1440; t++) s.tick();
  for (const [k, v] of Object.entries(s.stats.completed)) agg[k] = (agg[k] ?? 0) + v;
  for (const [k, v] of Object.entries(s.persons[0].tagMinutes)) tags[k] = (tags[k] ?? 0) + v;
}
console.log(Object.entries(agg).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
console.log(Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
