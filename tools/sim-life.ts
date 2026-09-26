/**
 * 한 인생 헤드리스 (BRIEF M7 "아기 → 노년 전 과정"): 오두막 부지에 청년 부부 + 갓난아기. 자율만으로 실제 틱을 돌려
 * 아기가 7단계를 모두 지나 노년에 죽을 때까지 (또는 --days 까지) 기록. 단계 전환 날, 특성, 교육, 스킬, 돌봄, 방치/stuck.
 *   npx tsx tools/sim-life.ts [--seed 1] [--lifespan normal|short] [--days 140] [--out artifacts/lives/one-life.json]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadSimData } from './data-node';
import { Simulation } from '../src/sim/sim';
import type { Person } from '../src/sim/people/person';

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const SEED = Number(arg('seed', '1'));
const LIFESPAN = arg('lifespan', 'normal');
const MAX_DAYS = Number(arg('days', '160'));
const OUT = arg('out', 'artifacts/lives/one-life.json');

const t0 = Date.now();
const sim = new Simulation(loadSimData({}), SEED);
sim.apply({ kind: 'setLifespan', preset: LIFESPAN });
const mom = sim.addPerson('마르타', undefined, undefined, { sex: 'female', estate: 'freeman' });
const dad = sim.addPerson('에드릭', undefined, undefined, { sex: 'male', estate: 'freeman' });
mom.lifeStage = 'young';
dad.lifeStage = 'young';
sim.apply({ kind: 'setRelation', a: mom.id, b: dad.id, flags: ['spouse'], friendship: 60, romance: 60, met: true });
mom.spouse = dad.id;
dad.spouse = mom.id;
// 살림: 아빠는 품팔이 일, 시작 자금 (장보기, 17-4 자유민)
sim.apply({ kind: 'setCareer', personId: dad.id, careerId: 'field_hand' });
sim.apply({ kind: 'grant', amount: 2400, reason: 'start' });
const baby = (sim as unknown as { bornTo(m: Person, f: Person | null): Person }).bornTo(mom, dad);
const timeline: { day: number; stage: string; age: number; traits: string[]; education: string | null; place?: string }[] = [];
let lastStage = '';
const careMinutes: Record<string, number> = {};
let cryMinutes = 0;
let minBabyHunger = 100;
let died: { day: number; cause: string } | null = null;
let day = 0;
for (let t = 0; t < MAX_DAYS * 1440; t++) {
  sim.tick();
  const b = sim.persons.find((q) => q.id === baby.id);
  if (!b) {
    const g = sim.gone.find((x) => x.id === baby.id);
    died = { day: sim.world.day(), cause: g?.cause ?? '?' };
    break;
  }
  if (b.crying) cryMinutes++;
  if (b.lifeStage === 'baby') minBabyHunger = Math.min(minBabyHunger, b.need('hunger'));
  for (const q of sim.persons) {
    const id = q.action?.item.interactionId;
    if (id?.startsWith('care.') && q.action?.phase === 'perform') careMinutes[id] = (careMinutes[id] ?? 0) + 1;
  }
  if (b.lifeStage !== lastStage) {
    lastStage = b.lifeStage;
    timeline.push({ day: sim.world.day(), stage: b.lifeStage, age: +(sim.lifecycle?.displayAge(b) ?? 0).toFixed(1), traits: [...b.traits], education: b.education, place: b.babyPlace?.kind });
    process.stdout.write(`${sim.world.day()}일: ${b.lifeStage} (${timeline.at(-1)!.age}세) 특성 ${b.traits.join(',')} 교육 ${b.education ?? '-'} (${((Date.now() - t0) / 1000).toFixed(0)}초)\n`);
  }
  if (sim.world.minuteOfDay() === 0) {
    day++;
    // 부모가 늙어 죽으면 아이가 가족을 이음 (조작 가문이 비지 않게: 부모 없는 청년)
  }
}
const b = sim.persons.find((q) => q.id === baby.id);
const skills = b ? Object.fromEntries(Object.entries(b.skills).filter(([, v]) => v > 0)) : {};
const res = {
  seed: SEED, lifespan: LIFESPAN, days: sim.world.day(), timeline, died, finalStage: b?.lifeStage ?? died?.cause,
  childSkills: b?.childSkills ?? {}, skills, grade: b && sim.childcare ? sim.childcare.grade(b) : null, clanAffection: b?.clanAffection,
  careMinutes, cryMinutes, minBabyHunger: Math.round(minBabyHunger),
  stuck: sim.stats.stuckEvents, collapses: sim.stats.collapses, accidents: sim.stats.accidents, maxNeglect: sim.stats.maxNeglect,
  seconds: Math.round((Date.now() - t0) / 1000),
};
const stages = new Set(timeline.map((x) => x.stage));
const allStages = ['baby', 'toddler', 'child', 'teen', 'young', 'adult', 'elder'].every((s) => stages.has(s));
const pass = allStages && res.stuck === 0;
mkdirSync('artifacts/lives', { recursive: true });
writeFileSync(OUT, JSON.stringify({ ...res, pass }, null, 1));
console.log(JSON.stringify({ ...res, timeline: undefined }, null, 1));
console.log(`7단계 모두: ${allStages ? '예' : '아니오'} / 끝: ${res.finalStage}${died ? ` (${died.day}일 ${died.cause})` : ''} / ${pass ? '통과' : '실패'}`);
process.exit(pass ? 0 : 1);
