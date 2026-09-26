import { loadSimData } from '../data-node';
import { Simulation } from '../../src/sim/sim';
const sim = new Simulation(loadSimData({ town: 'ashford' }), 1);
sim.apply({ kind: 'forceLod', lod: 'full' });
const t = sim.town!;
for (let i = 0; i < 1440 * 0.6; i++) sim.tick();
let n = 0;
const byReason: Record<string, number> = {};
for (const p of sim.persons) {
  if (p.infant || (p.need('hunger') > 15 && p.need('bladder') > 15)) continue;
  const lot = p.homeLot ? t.lots.find((l) => l.id === p.homeLot) : null;
  const d = lot ? Math.hypot((lot.rect[0] + lot.rect[2]) / 2 - p.x, (lot.rect[1] + lot.rect[3]) / 2 - p.y) : -1;
  const home = sim.world.objects.filter((o) => lot && o.x >= lot.rect[0] && o.x <= lot.rect[2] && o.y >= lot.rect[1] && o.y <= lot.rect[3]);
  const food = home.filter((o) => /cupboard|hearth|table|pantry|barrel/.test(o.defId)).map((o) => o.defId);
  const pot = home.filter((o) => /chamber|privy|outhouse|latrine/.test(o.defId)).map((o) => o.defId);
  const key = `${d < 0 ? '집없음' : d > 32 ? '집멀리' : '집근처'}|음식${food.length ? 'O' : 'X'}|요강${pot.length ? 'O' : 'X'}`;
  byReason[key] = (byReason[key] ?? 0) + 1;
  if (n++ < 14) console.log(p.name, p.household, 'H', p.need('hunger').toFixed(0), 'B', p.need('bladder').toFixed(0), '집거리', d.toFixed(0), p.schedule, '행동', p.action?.item.interactionId ?? '-', p.action?.phase ?? '', '해결가능H', sim.solvable(p, 0), 'B', sim.solvable(p, 3), [...new Set(food)].join(','), pot.join(','));
}
console.log(byReason);
