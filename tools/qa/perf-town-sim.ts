/**
 * M6 측정 (S5): 200×150 마을에 인물 N명을 모두 전체 세밀도로 두고 틱 비용과 길찾기 비용을 잼.
 *   npx tsx tools/qa/perf-town-sim.ts [인원=120] [분=240]
 */
import { loadSimData } from '../data-node';
import { Simulation } from '../../src/sim/sim';
import { Rng } from '../../src/sim/core/rng';

const N = Number(process.argv[2] ?? 120);
const MIN = Number(process.argv[3] ?? 240);
const t0 = performance.now();
const data = loadSimData({ lot: 'src/data/lots/perf_town.json' });
const tLoad = performance.now() - t0;
const t1 = performance.now();
const sim = new Simulation(data, 11);
const tWorld = performance.now() - t1;
const g = sim.world.grid;
const rng = new Rng(5);
// 사람을 방 안 칸에 흩어 놓음 (집마다 3~4명 = 가정)
const roomCells: number[] = [];
for (let i = 0; i < g.room.length; i++) if (g.room[i] >= 0 && g.walkable(i) && g.levelOf(i) === 0) roomCells.push(i);
for (let k = 0; k < N; k++) {
  const c = roomCells[Math.floor(rng.next() * roomCells.length)];
  sim.addPerson(`인물${k}`, (c % g.w) + 0.5, Math.floor(c / g.w) + 0.5, { estate: 'freeman', household: k < 4 ? 1 : 100 + Math.floor(k / 4) });
}
let expanded = 0;
const pf = (sim as unknown as { path: { find: (...a: unknown[]) => unknown; lastExpanded: number } }).path;
const orig = pf.find.bind(pf);
let calls = 0;
pf.find = (...a: unknown[]) => {
  const r = orig(...a);
  calls++;
  expanded += pf.lastExpanded;
  return r;
};
const times: number[] = [];
for (let m = 0; m < MIN; m++) {
  const s = performance.now();
  sim.tick();
  times.push(performance.now() - s);
}
times.sort((a, b) => a - b);
const q = (p: number) => times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(2);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`격자 ${g.w}×${g.h} = ${g.w * g.h}칸, 물건 ${sim.world.objects.length}, 방 ${g.roomSizes.length}`);
console.log(`데이터 ${tLoad.toFixed(0)}ms, 월드 생성 ${tWorld.toFixed(0)}ms`);
console.log(`인물 ${N} 전체 세밀도: 틱 평균 ${mean.toFixed(2)}ms, p50 ${q(0.5)}, p95 ${q(0.95)}, p99 ${q(0.99)}, 최대 ${times[times.length - 1].toFixed(1)}`);
console.log(`길찾기 ${calls}회, 평균 확장 ${(expanded / Math.max(1, calls)).toFixed(0)}칸, 분당 ${(calls / MIN).toFixed(1)}회`);
console.log(`stuck ${sim.stats.stuckEvents}, 길 실패 ${sim.stats.pathFails}`);
