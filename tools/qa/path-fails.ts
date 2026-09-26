/**
 * 애쉬포드 마을 시작 몇 시간 동안 길 못 찾음 기록 (조작 가족 먼저): 어떤 상호작용 · 물건에서 막히는지
 *   npx tsx tools/qa/path-fails.ts [분=240]
 */
import { simRaw } from '../data-node';
import { validateSimData } from '../../src/sim/data/simData';
import { Simulation } from '../../src/sim/sim';

const MIN = Number(process.argv[2] ?? 240);
const data = validateSimData(simRaw({ town: 'ashford' }) as never);
const sim = new Simulation(data, 1);
sim.apply({ kind: 'forceLod', lod: 'full' } as never);
sim.pathFailLog = [];
for (let m = 0; m < MIN; m++) sim.tick();
const by = new Map<string, number>();
for (const f of sim.pathFailLog) {
  const p = sim.persons.find((q) => q.id === f.person);
  const social = !!sim.data.social[f.ia];
  const o = social ? null : sim.world.byUid.get(f.target);
  const tp = social ? sim.persons.find((q) => q.id === f.target) : null;
  const where = tp ? `사람${tp.id}(가구${tp.household}) @${Math.floor(tp.x)},${Math.floor(tp.y)} 집주인${(sim as any).town?.ownerOf(tp.x, tp.y)} 숨음${tp.hidden}` : '';
  const k = `${p?.household === 1 ? '우리' : 'npc'} ${f.ia} ${o ? `${o.defId}@${o.x},${o.y}` : where || f.target}${f.autonomous ? '' : ' (시킴)'}`;
  by.set(k, (by.get(k) ?? 0) + 1);
}
console.log('total', sim.pathFailLog.length, 'persons', sim.persons.length);
for (const [k, n] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(n).padStart(4), k);
