/**
 * 헤드리스 하루 시뮬레이터 (BRIEF M1 봇 기준).
 *   npx tsx tools/sim-day.ts [--days 3] [--seeds 10] [--lot fixture|cottage] [--persons 2] [--check] [--out artifacts/bot/sim-day.json]
 * --check: 통과 조건(방치 120분 이하, stuck 0, 관통 0) 위반 시 종료 코드 1
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadSimData } from './data-node';
import { Simulation } from '../src/sim/sim';
import { NEED_IDS } from '../src/sim/core/types';
import { readFileSync as readStart } from 'node:fs';
const START_REL = (JSON.parse(readStart('src/data/start.json', 'utf8')) as { relations?: { a: number; b: number; friendship?: number; romance?: number; respect?: number; flags?: string[] }[] }).relations ?? [];

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}

const days = Number(arg('days', '3'));
const seeds = Number(arg('seeds', '10'));
const lotName = arg('lot', existsSync('src/data/lots/cottage.json') && existsSync('src/data/objects.json') ? 'cottage' : 'fixture');
const out = arg('out', 'artifacts/bot/sim-day.json');
const check = process.argv.includes('--check');
const personCount = Number(arg('persons', '2'));

const lotPath = lotName === 'fixture' ? 'tests/fixtures/lot.json' : `src/data/lots/${lotName}.json`;
const objPath = lotName === 'fixture' ? 'tests/fixtures/objects.json' : 'src/data/objects.json';
const data = loadSimData({ lot: lotPath, objects: objPath, inner: !process.argv.includes('--no-inner') && lotName !== 'fixture' });

interface Run {
  seed: number;
  ms: number;
  msPerTick: number;
  stats: Simulation['stats'];
  minNeeds: Record<string, number>;
  avgNeeds: Record<string, number>;
  hourly: Array<{ hour: number; action: string; needs: Record<string, number> }>;
  notices: Record<string, number>;
  stock: Record<string, number>;
}

const runs: Run[] = [];
for (let s = 1; s <= seeds; s++) {
  const sim = new Simulation(data, s);
  const people = Array.from({ length: personCount }, (_, i) => sim.addPerson(`봇${i + 1}`));
  // 게임 시작과 같게 첫 두 사람은 부부 (start.json relations)
  if (personCount >= 2) for (const r of START_REL) sim.apply({ kind: 'setRelation', met: true, ...r });
  const p = people[0];
  const minNeeds: Record<string, number> = {};
  const sumNeeds: Record<string, number> = {};
  for (const n of NEED_IDS) {
    minNeeds[n] = 100;
    sumNeeds[n] = 0;
  }
  const hourly: Run['hourly'] = [];
  const t0 = performance.now();
  const total = days * 1440;
  for (let m = 0; m < total; m++) {
    sim.tick();
    for (const q of people) {
      for (const n of NEED_IDS) {
        const v = q.need(n);
        if (v < minNeeds[n]) minNeeds[n] = v;
        sumNeeds[n] += v / people.length;
      }
    }
    if (s === 1 && sim.world.minute % 60 === 0) {
      hourly.push({
        hour: sim.world.minute / 60,
        action: p.action ? `${p.action.item.interactionId}(${p.action.phase})` : p.collapse ? 'collapse' : 'idle',
        needs: Object.fromEntries(NEED_IDS.map((n) => [n, Math.round(p.need(n))])),
      });
    }
  }
  const ms = performance.now() - t0;
  const notices: Record<string, number> = {};
  for (const n of sim.notices) notices[n.kind] = (notices[n.kind] ?? 0) + 1;
  runs.push({
    seed: s, ms, msPerTick: ms / total, stats: sim.stats, minNeeds,
    avgNeeds: Object.fromEntries(NEED_IDS.map((n) => [n, Math.round(sumNeeds[n] / total)])),
    hourly, notices, stock: { ...sim.world.stock },
  });
}

const worstNeglect = Math.max(...runs.flatMap((r) => Object.values(r.stats.maxNeglect)));
const stuck = runs.reduce((a, r) => a + r.stats.stuckEvents, 0);
const clip = runs.reduce((a, r) => a + r.stats.clipViolations, 0);
const shortEnds = runs.reduce((a, r) => a + r.stats.shortEnds, 0);
const shortPerPersonDay = shortEnds / (runs.length * days * personCount);
const collapses = runs.reduce((a, r) => a + r.stats.collapses, 0);
const shortBy: Record<string, number> = {};
for (const r of runs) for (const [k, v] of Object.entries(r.stats.shortEndsBy)) shortBy[k] = (shortBy[k] ?? 0) + v;
const summary = {
  lot: lotName, days, seeds, persons: personCount,
  // BRIEF M1: 방치/stuck/관통 0 + (리뷰 반영) 헛돎 1인·1일 2회 이하, 쓰러짐 0
  pass: worstNeglect <= 120 && stuck === 0 && clip === 0 && shortPerPersonDay <= 2 && collapses === 0,
  shortEndsPerPersonDay: +shortPerPersonDay.toFixed(3),
  shortEndsBy: shortBy,
  worstNeglectMinutes: worstNeglect,
  stuckEvents: stuck,
  clipViolations: clip,
  collapses,
  accidents: runs.reduce((a, r) => a + r.stats.accidents, 0),
  pathFails: runs.reduce((a, r) => a + r.stats.pathFails, 0),
  avgMsPerTick: runs.reduce((a, r) => a + r.msPerTick, 0) / runs.length,
  minNeedsAcrossSeeds: Object.fromEntries(NEED_IDS.map((n) => [n, Math.round(Math.min(...runs.map((r) => r.minNeeds[n])))])),
  avgNeedsAcrossSeeds: Object.fromEntries(NEED_IDS.map((n) => [n, Math.round(runs.reduce((a, r) => a + r.avgNeeds[n], 0) / runs.length)])),
  completed: runs[0].stats.completed,
  aborted: runs[0].stats.aborted,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ summary, runs }, null, 1));
console.log(JSON.stringify(summary, null, 1));
if (check && !summary.pass) {
  console.error('봇 기준 실패');
  process.exit(1);
}
