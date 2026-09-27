/**
 * 저장 결정론 검사: 프리셋 가문으로 마을을 돌리다 여러 시점에 저장 → 불러온 쪽과 원본을 이어 돌려 그래프·해시 비교
 * npx tsx tools/save/check-save.ts [--days 6] [--presets serf_poor,noble_rich] [--seed 3]
 */
import { loadSimData } from '../data-node';
import { Simulation } from '../../src/sim/sim';
import { loadSimInto, saveSim } from '../../src/sim/save/save';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const days = Number(arg('days', '6'));
const presets = arg('presets', 'serf_poor,artisan_normal,noble_rich').split(',');
const seed = Number(arg('seed', '3'));
const data = loadSimData({ town: 'ashford' });
let bad = 0;
function diff(ga: string, gb: string): string {
  const out: string[] = [];
  const cmp = (x: any, y: any, p: string) => {
    if (out.length > 8) return;
    if (typeof x !== typeof y || (x === null) !== (y === null) || Array.isArray(x) !== Array.isArray(y)) { out.push(`${p}: ${JSON.stringify(x)?.slice(0, 100)} vs ${JSON.stringify(y)?.slice(0, 100)}`); return; }
    if (!x || typeof x !== 'object') { if (x !== y) out.push(`${p}: ${JSON.stringify(x)?.slice(0, 80)} vs ${JSON.stringify(y)?.slice(0, 80)}`); return; }
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) cmp(x[k], y[k], `${p}.${k}`);
  };
  cmp(JSON.parse(ga), JSON.parse(gb), 'sim');
  return out.join('\n').replace(/\.v\./g, '.');
}
for (const preset of presets) {
  const a = new Simulation(data, seed);
  const r = a.apply({ kind: 'house', op: 'applyPreset', args: { preset } } as never);
  if (!r) { console.log(preset, '프리셋 실패'); bad++; continue; }
  let maxSave = 0, maxLoad = 0, maxMB = 0;
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < 1440; i++) a.tick();
    let t = performance.now();
    const s = saveSim(a, seed);
    maxSave = Math.max(maxSave, performance.now() - t);
    maxMB = Math.max(maxMB, s.graph.length / 1e6);
    t = performance.now();
    const b = new Simulation(data, seed);
    loadSimInto(b, s);
    maxLoad = Math.max(maxLoad, performance.now() - t);
    // 반나절 이어 돌려 비교
    const c = new Simulation(data, seed);
    loadSimInto(c, s);
    for (let i = 0; i < 720; i++) { b.tick(); }
    const probe = saveSim(b, seed).graph;
    // 원본은 복사본(c 의 쌍둥이)로 비교: 원본 a 를 앞으로 돌리면 다음 날 저장 시점이 달라지므로 c 로 한 번 더
    for (let i = 0; i < 720; i++) c.tick();
    const same = probe === saveSim(c, seed).graph && b.worldHash() === c.worldHash();
    // 원본 a 자체와도: a 복제 없이 a 를 720틱 돌리고 되돌릴 수 없으니, 불러오기 직후 그래프가 원본과 같은지로
    const fresh = new Simulation(data, seed);
    loadSimInto(fresh, s);
    const same0 = saveSim(fresh, seed).graph === s.graph;
    if (!same || !same0) { bad++; console.log(preset, `${d + 1}일`, '다름', { same, same0 }); if (!same0) console.log(diff(s.graph, saveSim(fresh, seed).graph)); }
  }
  // 마지막: 원본을 이어 돌린 것과 불러온 것을 이어 돌린 것
  const s = saveSim(a, seed);
  const b = new Simulation(data, seed);
  loadSimInto(b, s);
  for (let i = 0; i < 1440; i++) { a.tick(); b.tick(); }
  const tail = saveSim(a, seed).graph === saveSim(b, seed).graph && a.worldHash() === b.worldHash();
  if (!tail) bad++;
  console.log(`${preset}: ${days}일, 저장 최대 ${maxSave.toFixed(0)}ms, 불러오기 최대 ${maxLoad.toFixed(0)}ms, 최대 ${maxMB.toFixed(2)}MB, 원본과 하루 이어 돌리기 ${tail ? '같음' : '다름'}`);
}
console.log(bad ? `실패 ${bad}` : '통과');
process.exit(bad ? 1 : 0);
