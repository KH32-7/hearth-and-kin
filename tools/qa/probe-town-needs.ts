/** 마을 사람 욕구 관리 진단: 전원 전체 세밀도로 N일 돌려 방치/실수/쓰러짐을 사람별로 셈 */
import { loadSimData } from '../data-node';
import { Simulation } from '../../src/sim/sim';
const days = Number(process.argv[2] ?? 1);
const lod = (process.argv[3] ?? 'full') as 'full' | 'simple' | 'summary' | 'auto';
const sim = new Simulation(loadSimData({ town: 'ashford' }), 1);
if (lod !== 'auto') sim.apply({ kind: 'forceLod', lod });
const low: Record<string, number> = {};
const zeroMin: Record<string, number> = {};
const t0 = performance.now();
for (let t = 0; t < days * 1440; t++) {
  sim.tick();
  if (t % 10 === 0) for (const p of sim.persons) {
    if (p.lod !== 'full' || p.infant) continue;
    for (const n of ['hunger', 'bladder', 'energy', 'hygiene'] as const) {
      const v = p.need(n);
      if (v < 20) low[n] = (low[n] ?? 0) + 10;
      if (v <= 0) zeroMin[n] = (zeroMin[n] ?? 0) + 10;
    }
  }
}
const s = sim.stats;
console.log(`인원 ${sim.persons.length}, ${((performance.now() - t0) / 1000).toFixed(0)}초`);
console.log('욕구<20 인·분', low, '욕구 0 인·분', zeroMin);
console.log('용변 실수', s.accidents, '쓰러짐', s.collapses, 'stuck', s.stuckEvents, '경로 실패', s.pathFails, '최장 방치', s.maxNeglect);
const ab = Object.entries(s.aborted).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('중단 많은 행동', ab);
const done = Object.entries(s.completed).sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log('끝낸 행동', done);
