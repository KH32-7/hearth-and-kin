/**
 * 마을 헤드리스 (BRIEF M6, GDD 29-1 마을 단위): 104일 × 시드 N. 인구, 사망 속도, 출생/사망 비, 이주, 혼인률, 소문 절반 도달, 파산.
 *   npx tsx tools/sim-town.ts [--town ashford | --fixture perf] [--days 104] [--seeds 50] [--lod full|simple|summary] [--out artifacts/town/headless.json]
 * 세밀도 강제(--lod)로 13-6 회귀 비교 (전 인물 전체 vs 전 인물 요약: 분포 차 10% 이내)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { simRaw } from './data-node';
import { validateSimData, type SimData } from '../src/sim/data/simData';
import { Simulation } from '../src/sim/sim';

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const DAYS = Number(arg('days', '104'));
const SEEDS = Number(arg('seeds', '5'));
const LOD = arg('lod', '') as '' | 'full' | 'simple' | 'summary';
const TOWN = arg('town', '');
const FIXTURE = arg('fixture', TOWN ? '' : 'perf');
const OUT = arg('out', `artifacts/town/headless${LOD ? '-' + LOD : ''}.json`);

function load(): SimData {
  if (TOWN) {
    const raw = simRaw({ town: TOWN });
    return validateSimData(raw as never);
  }
  const raw = simRaw({});
  const j = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
  // --people real: 시험 지도 + 실제 마을 사람/일과표 (마을 지도 없이 인구 동학 조정)
  const real = arg('people', '') === 'real';
  return validateSimData({
    ...raw, town: j(`tests/fixtures/${FIXTURE}_town_def.json`),
    people: real ? j('src/data/town/people.json') : j(`tests/fixtures/${FIXTURE}_people.json`),
    schedules: real ? j('src/data/schedules.json') : j(`tests/fixtures/${FIXTURE}_schedules.json`),
  } as never);
}

const t0 = Date.now();
const data = load();
interface Res {
  pop0: number; pop: number; minPop: number; maxPop: number;
  births: number; deaths: number; under18: number; causes: Record<string, number>;
  immigrants: number; emigrants: number; marriages: number; engagements: number;
  rumorHalf: number[]; msPerTick: number; lodAvg: { full: number; simple: number; summary: number };
  stuck: number; singlesAtStart: number; marriedOfSingles: number; childMortality: number; youngEnded: number; youngEndedMarried: number;
}
const results: Res[] = [];
for (let s = 1; s <= SEEDS; s++) {
  const sim = new Simulation(data, s);
  if (LOD) sim.apply({ kind: 'forceLod', lod: LOD });
  const pop0 = sim.persons.length;
  // 혼인률 코호트 (29-1): 시작 때 적령기 독신
  const singles = sim.persons.filter((p) => !p.spouse && !p.betrothed && (p.lifeStage === 'young' || p.lifeStage === 'teen'));
  let minPop = pop0;
  let maxPop = pop0;
  const lodSum = { full: 0, simple: 0, summary: 0 };
  let lodN = 0;
  const tStart = performance.now();
  const total = DAYS * 1440;
  // 큰 추문 하나를 3일째에 심어 전파 속도를 잼 (29-1: 절반까지 3~7일)
  let scandal: import('../src/sim/town/rumors').Rumor | null = null;
  for (let t = 0; t < total; t++) {
    sim.tick();
    if (t === 3 * 1440 && sim.rumors) {
      const subj = sim.persons.find((p) => p.household !== 1 && p.lifeStage === 'adult');
      if (subj) scandal = sim.rumors.add('scandal', [subj], { a: subj.name }, sim.world.day(), 1.6, [subj, ...sim.persons.filter((q) => q.household === subj.household)]);
    }
    if (t % 1440 === 0) {
      const n = sim.persons.length;
      minPop = Math.min(minPop, n);
      maxPop = Math.max(maxPop, n);
      for (const p of sim.persons) lodSum[p.lod]++;
      lodN++;
    }
  }
  const ms = (performance.now() - tStart) / total;
  const J = sim.judge!.stats;
  // 청년 끝까지 살아남았거나 그 전에 혼인한 사람 중 혼인한 비율 (죽은 미혼은 분모에서 뺌)
  const alive = new Set(sim.persons.map((p) => p.id));
  const cohort = singles.filter((p) => p.marriedDay >= 0 || alive.has(p.id));
  const married = cohort.filter((p) => p.marriedDay >= 0).length;
  results.push({
    pop0, pop: sim.persons.length, minPop, maxPop, births: J.births, deaths: J.deaths, under18: J.deathsUnder18, causes: { ...J.deathsByCause },
    immigrants: J.immigrants, emigrants: J.emigrants, marriages: J.marriages, engagements: J.engagements,
    rumorHalf: scandal ? [scandal.halfDay ?? -1] : [],
    msPerTick: +ms.toFixed(3), lodAvg: { full: +(lodSum.full / lodN).toFixed(1), simple: +(lodSum.simple / lodN).toFixed(1), summary: +(lodSum.summary / lodN).toFixed(1) },
    stuck: sim.stats.stuckEvents, singlesAtStart: cohort.length, marriedOfSingles: married, childMortality: sim.judge!.childMortality(), youngEnded: J.youngEnded, youngEndedMarried: J.youngEndedMarried,
  });
  process.stdout.write(`시드 ${s}/${SEEDS}: 인구 ${pop0}→${sim.persons.length}, 출생 ${J.births} 사망 ${J.deaths} 혼인 ${J.marriages} 이주 +${J.immigrants}/-${J.emigrants}, 틱 ${ms.toFixed(2)}ms (${((Date.now() - t0) / 1000).toFixed(0)}초)\n`);
}
const mean = (f: (r: Res) => number) => results.reduce((a, r) => a + f(r), 0) / results.length;
const checks: { name: string; ok: boolean; detail: string }[] = [];
const endRatio = mean((r) => r.pop / r.pop0);
checks.push({ name: '인구 80~200 유지', ok: results.every((r) => r.minPop >= 80 && r.maxPop <= 200), detail: `최소 ${Math.min(...results.map((r) => r.minPop))}, 최대 ${Math.max(...results.map((r) => r.maxPop))}` });
checks.push({ name: '끝 인구 시작의 90~115%', ok: endRatio >= 0.9 && endRatio <= 1.15, detail: `${(endRatio * 100).toFixed(0)}%` });
const deathsPerDay = mean((r) => r.deaths / DAYS);
const target = mean((r) => (r.pop0 + r.pop) / 2 / 92);
checks.push({ name: '하루 사망 ≈ 인구/92', ok: Math.abs(deathsPerDay - target) / target <= 0.3, detail: `${deathsPerDay.toFixed(2)}/일 (목표 ${target.toFixed(2)})` });
const bd = mean((r) => r.births / Math.max(1, r.deaths));
checks.push({ name: '출생/사망 90~110%', ok: bd >= 0.9 && bd <= 1.1, detail: `${(bd * 100).toFixed(0)}%` });
const mig = mean((r) => (r.immigrants - r.emigrants) / r.pop0);
checks.push({ name: '순이주 ≤ 시작 인구 10%', ok: mig <= 0.1, detail: `${(mig * 100).toFixed(1)}%` });
const yEnd = results.reduce((a, r) => a + r.youngEnded, 0);
const marriedRate = results.reduce((a, r) => a + r.youngEndedMarried, 0) / Math.max(1, yEnd);
checks.push({ name: '청년 끝까지 혼인 70~85%', ok: marriedRate >= 0.7 && marriedRate <= 0.85, detail: `${(marriedRate * 100).toFixed(0)}% (청년을 마친 ${yEnd}명)` });
const u18 = mean((r) => r.childMortality);
checks.push({ name: '18세 전 사망 출생의 5~12%', ok: u18 >= 0.05 && u18 <= 0.12, detail: `${(u18 * 100).toFixed(1)}%` });
const halves = results.flatMap((r) => r.rumorHalf).filter((h) => h >= 0);
const halfMean = halves.length ? halves.reduce((a, b) => a + b, 0) / halves.length : -1;
checks.push({ name: '큰 추문 절반까지 3~7일', ok: halfMean >= 3 && halfMean <= 7, detail: `${halfMean.toFixed(1)}일 (${halves.length}/${results.length} 시드 도달)` });
checks.push({ name: 'stuck 0', ok: results.every((r) => r.stuck === 0), detail: String(results.reduce((a, r) => a + r.stuck, 0)) });
const causes: Record<string, number> = {};
for (const r of results) for (const [k, v] of Object.entries(r.causes)) causes[k] = (causes[k] ?? 0) + v;
const pass = checks.every((c) => c.ok);
mkdirSync('artifacts/town', { recursive: true });
writeFileSync(OUT, JSON.stringify({ days: DAYS, seeds: SEEDS, lod: LOD || 'auto', town: TOWN || FIXTURE, checks, causes, results, pass }, null, 1));
for (const c of checks) console.log(`${c.ok ? '통과' : '✗'} ${c.name}: ${c.detail}`);
console.log(`사망 원인: ${JSON.stringify(causes)}`);
console.log(`세밀도 평균 (하루 자정): ${JSON.stringify(results[0]?.lodAvg)} / 틱 ${mean((r) => r.msPerTick).toFixed(3)}ms`);
console.log(pass ? '마을 헤드리스: 통과' : '마을 헤드리스: 실패');
console.log(`${((Date.now() - t0) / 1000).toFixed(0)}초`);
process.exit(pass ? 0 : 1);
