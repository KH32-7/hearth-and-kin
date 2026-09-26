/**
 * M2 통과 조건 (GDD 29-1): 특성 30개 각각의 대표 지표가 특성 없는 기준 인물 대비 최소 배수 이상.
 * 시드 50, 95% 구간(부트스트랩 비율 구간의 하한이 최소 배수 이상이어야 통과). 깔끔함 대 게으름은 3배.
 * + 자율만으로 하루 평균 감정: 무난 이상 60% 이상, 행복 강함 이상 70% 이하.
 *
 * 한 판 = 2인 가구(오두막), 관찰 인물(1번)은 그 특성 하나만, 상대(2번)는 특성 없음. 기준 = 둘 다 특성 없음.
 * 사용: npx tsx tools/trait-metrics.ts [--seeds 50] [--days 2] [--only neat,lazy] [--out artifacts/traits/metrics.json]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Simulation } from '../src/sim/sim';
import type { Person } from '../src/sim/people/person';
import { Rng } from '../src/sim/core/rng';
import { EMOTION_INDEX, POSITIVE } from '../src/sim/inner/emotion';
import { loadSimData } from './data-node';
import { readFileSync as readStart } from 'node:fs';
const START_REL = (JSON.parse(readStart('src/data/start.json', 'utf8')) as { relations?: { a: number; b: number; friendship?: number; romance?: number; respect?: number; flags?: string[] }[] }).relations ?? [];

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const SEEDS = Number(arg('seeds', '50'));
const DAYS = Number(arg('days', '2'));
const ONLY = arg('only', '');
const OUT = arg('out', 'artifacts/traits/metrics.json');

const data = loadSimData();
const inner = data.inner!;
type Metric = NonNullable<(typeof inner.traits.traits)[string]['metric']>;

function run(seed: number, traits: string[]): Person {
  const sim = new Simulation(data, seed);
  sim.addPerson('관찰', undefined, undefined, { traits });
  sim.addPerson('상대', undefined, undefined, { traits: [] });
  // 게임 시작과 같게: 부부 (src/data/start.json relations). 식구끼리 로맨스는 배우자/연인일 때만 가능 (M3)
  for (const r of START_REL) sim.apply({ kind: 'setRelation', met: true, ...r });
  for (const p of sim.persons) {
    p.virtue = null;
    p.sin = null;
  }
  for (let t = 0; t < DAYS * 1440; t++) sim.tick();
  return sim.persons[0];
}

function value(p: Person, m: Metric): number {
  if (m.kind === 'tagMinutes') return (m.tags ?? []).reduce((a, t) => a + (p.tagMinutes[t] ?? 0), 0) / DAYS;
  if (m.kind === 'emotionMinutes') return (m.emotions ?? []).reduce((a, e) => a + p.emotionMinutes[EMOTION_INDEX[e]], 0) / DAYS;
  if (m.kind === 'moodletMinutes') return (m.emotions ?? []).reduce((a, e) => a + p.moodletEmotionMinutes[EMOTION_INDEX[e]], 0) / DAYS;
  return p.outdoorNightMinutes / DAYS;
}

/** 비율(특성/기준, down 이면 기준/특성)의 대응 부트스트랩 95% 구간. 0 나눗셈은 작은 바닥값으로 */
function ratioCI(trait: number[], base: number[], dir: 'up' | 'down'): { ratio: number; lo: number; hi: number } {
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const floor = 0.5; // 분/일: 0 이면 비율이 무한대가 되는 것을 막는 바닥
  const r = (t: number, b: number) => (dir === 'up' ? (t + floor) / (b + floor) : (b + floor) / (t + floor));
  const rng = new Rng(12345);
  const rs: number[] = [];
  // 대응 표본: 특성 인물과 기준 인물은 같은 시드(같은 날씨/같은 상대/같은 무작위 흐름)에서 돎 → 같은 시드끼리 짝지어 다시 뽑음
  for (let k = 0; k < 2000; k++) {
    let st = 0;
    let sb = 0;
    for (let i = 0; i < trait.length; i++) {
      const j = rng.int(trait.length);
      st += trait[j];
      sb += base[j];
    }
    rs.push(r(st / trait.length, sb / base.length));
  }
  rs.sort((a, b) => a - b);
  return { ratio: r(mean(trait), mean(base)), lo: rs[Math.floor(rs.length * 0.025)], hi: rs[Math.floor(rs.length * 0.975)] };
}

const t0 = performance.now();
const basePersons: Person[] = [];
for (let s = 1; s <= SEEDS; s++) basePersons.push(run(s, []));
// 감정 분포 (기준 인물)
let okMin = 0;
let happyStrong = 0;
let total = 0;
for (const p of basePersons) {
  for (let e = 0; e < 11; e++) {
    total += p.emotionMinutes[e];
    if (POSITIVE[e] || e === EMOTION_INDEX.neutral) okMin += p.emotionMinutes[e];
  }
}
// 행복 강함 이상 분은 별도 표본이 필요 → 기준 인물들의 행복 분 비율로 근사하지 않고 따로 셈
{
  for (let s = 1; s <= Math.min(SEEDS, 20); s++) {
    const sim = new Simulation(data, 1000 + s);
    sim.addPerson('a', undefined, undefined, { traits: [] });
    sim.addPerson('b', undefined, undefined, { traits: [] });
    for (const r of START_REL) sim.apply({ kind: 'setRelation', met: true, ...r });
    for (let t = 0; t < DAYS * 1440; t++) {
      sim.tick();
      for (const p of sim.persons) if (p.emotion === EMOTION_INDEX.happy && p.emotionStage >= 2) happyStrong++;
    }
  }
}
const happyStrongFrac = happyStrong / (Math.min(SEEDS, 20) * 2 * DAYS * 1440);
const emotionSummary = { okOrPositiveFrac: +(okMin / total).toFixed(3), happyStrongFrac: +happyStrongFrac.toFixed(3), pass: okMin / total >= 0.6 && happyStrongFrac <= 0.7 };

const results: Record<string, unknown> = {};
let passCount = 0;
let n = 0;
const traitIds = Object.keys(inner.traits.traits).filter((t) => !ONLY || ONLY.split(',').includes(t));
const cache = new Map<string, Person[]>();
const persons = (t: string) => {
  if (!cache.has(t)) {
    const arr: Person[] = [];
    for (let s = 1; s <= SEEDS; s++) arr.push(run(s, [t]));
    cache.set(t, arr);
  }
  return cache.get(t)!;
};
for (const t of traitIds) {
  const m = inner.traits.traits[t].metric;
  if (!m) continue;
  n++;
  const tv = persons(t).map((p) => value(p, m));
  const bv = basePersons.map((p) => value(p, m));
  const ci = ratioCI(tv, bv, m.direction);
  let pass = ci.lo >= m.minMult;
  const row: Record<string, unknown> = {
    kind: m.kind, tags: m.tags, emotions: m.emotions, direction: m.direction, minMult: m.minMult,
    traitMean: +(tv.reduce((a, b) => a + b, 0) / tv.length).toFixed(2),
    baseMean: +(bv.reduce((a, b) => a + b, 0) / bv.length).toFixed(2),
    ratio: +ci.ratio.toFixed(2), ci95: [+ci.lo.toFixed(2), +ci.hi.toFixed(2)],
  };
  if (m.versus) {
    const vv = persons(m.versus.trait).map((p) => value(p, m));
    const vci = ratioCI(tv, vv, m.direction);
    row.versus = { trait: m.versus.trait, ratio: +vci.ratio.toFixed(2), ci95: [+vci.lo.toFixed(2), +vci.hi.toFixed(2)], minMult: m.versus.minMult };
    pass = pass && vci.lo >= m.versus.minMult;
  }
  row.pass = pass;
  if (pass) passCount++;
  results[t] = row;
  console.log(`${pass ? '통과' : '실패'} ${t.padEnd(16)} 특성 ${String(row.traitMean).padStart(7)} / 기준 ${String(row.baseMean).padStart(7)}  비율 ${row.ratio} [${ci.lo.toFixed(2)}, ${ci.hi.toFixed(2)}] ≥ ${m.minMult}${m.versus ? ` / 대 ${m.versus.trait} ${(row.versus as { ratio: number }).ratio}` : ''}`);
}
const summary = { seeds: SEEDS, days: DAYS, traits: n, passed: passCount, emotion: emotionSummary, seconds: +((performance.now() - t0) / 1000).toFixed(1) };
console.log(JSON.stringify(summary));
mkdirSync('artifacts/traits', { recursive: true });
writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2));
process.exit(passCount === n && emotionSummary.pass ? 0 : 1);
