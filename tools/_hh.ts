import { loadSimData } from './data-node';
import { Simulation } from '../src/sim/sim';
const sim = new Simulation(loadSimData({ town: 'ashford' }), 1);
const hh = sim.persons.filter((p) => p.household === 1);
const acts: Record<string, number> = {};
for (let t = 0; t < 2 * 1440; t++) {
  sim.tick();
  for (const p of hh) { const k = p.name + ':' + (p.action?.item.interactionId ?? '-'); acts[k] = (acts[k] ?? 0) + 1; }
  if (t % 240 === 0) console.log(sim.world.day(), sim.world.hour(), hh.map((p) => `${p.name} hunger ${p.needs[0].toFixed(0)} energy ${p.needs[1]?.toFixed(0)} ${p.action?.item.interactionId ?? '-'} @${p.cellX()},${p.cellY()}`).join(' | '));
}
console.log(Object.entries(acts).sort((a, b) => b[1] - a[1]).slice(0, 25));
console.log(sim.notices.filter((n) => n.personId <= 2).slice(-15).map((n) => n.kind + JSON.stringify(n.args ?? {})).join('\n'));
