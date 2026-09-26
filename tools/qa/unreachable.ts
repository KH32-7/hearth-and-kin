/**
 * 애쉬포드: 상호작용 물건 중 거리에서 걸어가 쓸 수 없는 것 (슬롯 칸까지 길 없음). 마을 지도 배치 점검
 *   npx tsx tools/qa/unreachable.ts
 */
import { loadSimData } from '../data-node';
import { Simulation } from '../../src/sim/sim';
import { resolveStep } from '../../src/sim/action/interactions';

const sim = new Simulation(loadSimData({ town: 'ashford' }), 1);
const w = sim.world;
const g = w.grid;
const S = sim as unknown as { path: { find(a: number, b: number, allowBlocked: boolean): number[] | null; who: unknown } };
// 출발점: 마을 광장 근처 걸을 수 있는 칸 (조작 가족 시작 인물 자리)
const p0 = sim.persons.find((p) => p.household === 1)!;
const start = g.idx(Math.floor(p0.x), Math.floor(p0.y));
const bad = new Map<string, string[]>();
for (const o of w.objects) {
  const list = sim.data.compiled.byDef.get(o.defId);
  if (!list?.length || o.defId === 'lot_exit') continue;
  let ok = false;
  const why: string[] = [];
  for (const c of list) {
    if (c.id === 'obj.repair' || o.defId === 'window_opening') continue;
    const step = c.def.steps[0];
    if (!step || step.at !== 'target') continue;
    const r = resolveStep(w, p0.id, p0.x, p0.y, step, o);
    if (!r) { why.push(`${c.id}:no_slot`); continue; }
    const goal = w.slotCell(r.obj, r.slot);
    const path = S.path.find(start, goal, r.slot.pose !== 'stand');
    if (path) { ok = true; break; }
    why.push(`${c.id}:no_path`);
  }
  if (!ok && why.length) bad.set(`${o.defId}@${o.x},${o.y}#${o.uid}`, why);
}
console.log('unreachable', bad.size);
for (const [k, v] of bad) console.log(k, v.slice(0, 3).join(' '));
