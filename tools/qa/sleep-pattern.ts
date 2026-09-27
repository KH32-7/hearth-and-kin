/**
 * 애쉬포드 조작 가족 잠 패턴 (자율, 3일): 잠든 시각 · 깬 시각 · 밤(22~6시) 잠 비율
 *   npx tsx tools/qa/sleep-pattern.ts [일=3]
 */
import { simRaw } from '../data-node';
import { validateSimData } from '../../src/sim/data/simData';
import { Simulation } from '../../src/sim/sim';

const DAYS = Number(process.argv[2] ?? 3);
const sim = new Simulation(validateSimData(simRaw({ town: 'ashford' }) as never), 1);
const fam = sim.persons.filter((p) => p.household === 1);
const was = new Map<number, boolean>();
const ev: string[] = [];
let night = 0, nightSleep = 0;
for (let m = 0; m < DAYS * 1440; m++) {
  sim.tick();
  const h = sim.world.hour();
  for (const p of fam) {
    if (h >= 22 || h < 6) { night++; if (p.sleeping) nightSleep++; }
    if (!!p.sleeping !== !!was.get(p.id)) {
      const t = sim.world.minuteOfDay();
      ev.push(`${Math.floor(sim.world.minute / 1440) + 1}일 ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')} ${p.name} ${p.sleeping ? '잠듦' : '깸'} (기운 ${Math.round(p.needs[1])}${p.sleeping ? '' : `, 배고픔 ${Math.round(p.needs[0])}`})`);
      was.set(p.id, !!p.sleeping);
    }
  }
}
console.log(ev.join('\n'));
console.log('밤(22~6시) 잠 비율', (nightSleep / night).toFixed(2));
