import { loadSimData } from '../data-node';
import { Simulation } from '../../src/sim/sim';
const sim = new Simulation(loadSimData({ town: 'ashford' }), 1);
sim.apply({ kind: 'forceLod', lod: 'full' });
const acc = new Map<number, number>();
const hungry = new Map<number, number>();
const fails = new Map<number, number>();
let prevAcc = 0;
const prevFail = new Map<number, number>();
for (let t = 0; t < 1440; t++) {
  const before = new Map(sim.persons.map((p) => [p.id, p.collapse ? 1 : 0]));
  const pf = sim.stats.pathFails;
  sim.tick();
  void before; void pf;
  if (sim.stats.accidents > prevAcc) {
    // 이번 틱에 방광 0 → 실수한 사람: 방광이 막 채워진 사람 (hygiene 0)
    for (const p of sim.persons) if (p.need('bladder') > 95 && p.need('hygiene') <= 1) acc.set(p.id, (acc.get(p.id) ?? 0) + 1);
    prevAcc = sim.stats.accidents;
  }
  for (const p of sim.persons) {
    if (p.need('hunger') <= 0) hungry.set(p.id, (hungry.get(p.id) ?? 0) + 1);
    let n = 0;
    for (const v of p.pathFails.values()) n += v;
    if (n > (prevFail.get(p.id) ?? 0)) fails.set(p.id, (fails.get(p.id) ?? 0) + n - (prevFail.get(p.id) ?? 0));
    prevFail.set(p.id, n);
  }
}
const nm = (id: number) => { const p = sim.persons.find((q) => q.id === id); return p ? `${p.name}(${p.household},${p.schedule},${p.homeLot ?? sim.town!.householdResidence.get(p.household) ?? '-'})` : String(id); };
const top = (m: Map<number, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, v]) => `${nm(id)}:${v}`).join('  ');
console.log('실수', sim.stats.accidents, top(acc));
console.log('배고픔0 분', top(hungry));
console.log('경로실패', sim.stats.pathFails, top(fails));
