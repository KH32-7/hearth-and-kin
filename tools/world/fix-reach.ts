/**
 * 애쉬포드 지도: 거리에서 걸어가 쓸 수 없는 물건(슬롯 칸이 벽 · 가구에 막힘, 길 없음)을 같은 건물 · 부지 안 가까운 빈 자리로 옮김.
 * 놓을 수 있는지는 건축 엔진(move)이 판정하고, 옮긴 뒤 그 물건을 쓸 수 있고 그 건물 안 다른 물건이 새로 막히지 않을 때만 받아들임.
 * 지도를 다시 만들지 않고 ashford.json 의 물건 자리만 고침 (실내 배치 보존). 막힌 집(길 없는 부지)은 건드리지 않음 (town.sealed, 집 고르기에서 빠짐)
 *   npx tsx tools/world/fix-reach.ts          (고칠 것만 보여 줌)
 *   npx tsx tools/world/fix-reach.ts --write  (ashford.json 에 씀)
 */
import fs from 'node:fs';
import { loadSimData } from '../data-node';
import { Simulation } from '../../src/sim/sim';
import { resolveStep } from '../../src/sim/action/interactions';
import type { ObjectInstance } from '../../src/sim/core/types';

const FILE = 'src/data/town/ashford.json';
const WRITE = process.argv.includes('--write');
const sim = new Simulation(loadSimData({ town: 'ashford' }), 1);
const w = sim.world;
const g = w.grid;
const b = sim.builder!;
b.area = [0, 0, g.w - 1, g.h - 1];
sim.apply({ kind: 'grant', amount: 1e8, reason: 'tool' });
const H1 = w.lot.h + 1;
const town = (sim as unknown as { town: { sealed: Set<string>; lots: { id: string; rect: [number, number, number, number] }[]; placeOf(x: number, y: number): { id: string; rect: [number, number, number, number] } | null } }).town;
const S = sim as unknown as { path: { find(a: number, b: number, allowBlocked: boolean): number[] | null } };
const p0 = sim.persons.find((p) => p.household === 1)!;
const start = g.idx(Math.floor(p0.x), Math.floor(p0.y));

/** 이 물건의 상호작용 중 하나라도 거리에서 가서 쓸 수 있나 (수리 · 창 제외) */
function usable(o: ObjectInstance): boolean | null {
  const list = (sim.data.compiled.byDef.get(o.defId) ?? []).filter((c) => c.id !== 'obj.repair');
  if (!list.length || o.defId === 'window_opening' || o.defId === 'lot_exit') return null;
  // 첫(대표) 상호작용이 물건 자리에서 하는 것이면 그게 되어야 함: 요강 '앉기' 칸이 벽에 박혀 비우기('앞' 칸)만 되던 것도 못 쓰는 것으로 봄
  const first = list[0].def.steps[0];
  if (first?.at === 'target') {
    const r = resolveStep(w, p0.id, p0.x, p0.y, first, o);
    return !!r && !!S.path.find(start, w.slotCell(r.obj, r.slot), r.slot.pose !== 'stand');
  }
  // 아니면 (식탁: 화덕에서 떠 오기부터) 하나라도 물건 자리에 닿으면
  for (const c of list) {
    const step = c.def.steps[0];
    if (!step || step.at !== 'target') continue;
    const r = resolveStep(w, p0.id, p0.x, p0.y, step, o);
    if (r && S.path.find(start, w.slotCell(r.obj, r.slot), r.slot.pose !== 'stand')) return true;
  }
  return null;
}

function regionOf(o: ObjectInstance): { id: string; rect: [number, number, number, number] } | null {
  const ly = o.y % H1;
  const pl = town.placeOf(o.x, ly);
  if (pl) return pl;
  const l = town.lots.find((q) => o.x >= q.rect[0] && o.x <= q.rect[2] && ly >= q.rect[1] && ly <= q.rect[3]);
  if (!l || town.sealed.has(l.id)) return null;
  return l;
}

/** 건축 엔진 길 검사 (막힌 물건 경고) 수: 옮긴 뒤 늘면 안 됨 */
const objWarn = () => b.checkPaths().filter((q) => q.kind !== 'person').length;
const warn0 = objWarn();
const moved: Array<{ defId: string; from: [number, number, number]; to: [number, number, number] }> = [];
const failed: string[] = [];

/** 물건이 든 방 (벽 줄에 박힌 물건은 이웃 칸의 방) */
function roomOf(o: ObjectInstance): number {
  const fp = w.footprint(o);
  const count = new Map<number, number>();
  for (let dy = -1; dy <= fp.h; dy++) for (let dx = -1; dx <= fp.w; dx++) {
    const rm = g.room[g.idx(o.x + dx, o.y + dy)] ?? -1;
    if (rm >= 0) count.set(rm, (count.get(rm) ?? 0) + (dx >= 0 && dy >= 0 && dx < fp.w && dy < fp.h ? 10 : 1));
  }
  return [...count].sort((a, c) => c[1] - a[1])[0]?.[0] ?? -1;
}

/** 같은 방(방이 없으면 같은 부지) 안 가까운 자리로, 돌리지 않고 옮겨 봄. check = 받아들일 조건 */
function tryMove(o: ObjectInstance, reg: { rect: [number, number, number, number] }, check: () => boolean): [number, number, number] | null {
  const slab = Math.floor(o.y / H1) * H1;
  const r = reg.rect;
  const room = roomOf(o);
  const from: [number, number, number] = [o.x, o.y, o.rot ?? 0];
  const cands: Array<[number, number]> = [];
  for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) {
    if (room >= 0 && g.room[g.idx(x, y + slab)] !== room) continue;
    cands.push([x, y + slab]);
  }
  cands.sort((a, c) => Math.abs(a[0] - from[0]) + Math.abs(a[1] - from[1]) - (Math.abs(c[0] - from[0]) + Math.abs(c[1] - from[1])));
  for (const [x, y] of cands) {
    if (x === from[0] && y === from[1]) continue;
    const res = b.apply({ op: 'move', uid: o.uid, x, y, rot: from[2] });
    if (!res.ok) continue;
    if (check() && objWarn() <= warn0) return [x, y, from[2]];
    b.apply({ op: 'move', uid: o.uid, x: from[0], y: from[1], rot: from[2] });
  }
  return null;
}

for (const o of [...w.objects]) {
  if (usable(o) !== false) continue;
  const reg = regionOf(o);
  if (!reg) {
    failed.push(`${o.defId}@${o.x},${o.y} (막힌 부지 · 장소 밖)`);
    continue;
  }
  const slab = Math.floor(o.y / H1) * H1;
  const r = reg.rect;
  // 그 건물 안 다른 물건 (옮긴 뒤 새로 못 쓰게 되면 안 됨)
  const others = w.objects.filter((q) => q !== o && q.x >= r[0] && q.x <= r[2] && q.y - slab >= r[1] && q.y - slab <= r[3] && usable(q) === true);
  const from: [number, number, number] = [o.x, o.y, o.rot ?? 0];
  // 1) 슬롯 칸을 막은 물건을 먼저 옮겨 봄 (주점 계산대 앞 긴 의자 …)
  const slotCells = new Set(w.slots(o).map((sl) => w.slotCell(o, sl)));
  const blockers = w.objects.filter((q) => {
    if (q === o || q.defId === 'window_opening') return false;
    const fp = w.footprint(q);
    for (let dy = 0; dy < fp.h; dy++) for (let dx = 0; dx < fp.w; dx++) if (slotCells.has(g.idx(q.x + dx, q.y + dy))) return true;
    return false;
  });
  let done = false;
  for (const q of blockers) {
    const qFrom: [number, number, number] = [q.x, q.y, q.rot ?? 0];
    const qUsable = usable(q);
    const to = tryMove(q, reg, () => !!usable(o) && (qUsable !== true || !!usable(q)) && others.every((z) => z === q || usable(z)));
    if (to) {
      moved.push({ defId: q.defId, from: qFrom, to });
      done = true;
      break;
    }
  }
  if (done) continue;
  // 2) 물건 자체를 같은 방 안 가까운 곳으로
  const to = tryMove(o, reg, () => !!usable(o) && others.every((q) => usable(q)));
  if (to) moved.push({ defId: o.defId, from, to });
  else failed.push(`${o.defId}@${from[0]},${from[1]} (${reg.id}: 자리 없음)`);
}

console.log('옮김', moved.length);
for (const m of moved) console.log(`  ${m.defId} ${m.from.join(',')} → ${m.to.join(',')}`);
console.log('못 고침', failed.length);
for (const f of failed) console.log('  ' + f);

if (WRITE && moved.length) {
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { lot: { objects: Array<{ id: string; x: number; y: number; rot?: number }> } };
  for (const m of moved) {
    const e = raw.lot.objects.find((q) => q.id === m.defId && q.x === m.from[0] && q.y === m.from[1] && (q.rot ?? 0) === m.from[2]);
    if (!e) {
      console.log('  원본에 없음', m.defId, m.from.join(','));
      continue;
    }
    e.x = m.to[0];
    e.y = m.to[1];
    if (m.to[2]) e.rot = m.to[2];
    else delete e.rot;
  }
  fs.writeFileSync(FILE, JSON.stringify(raw));
  console.log('썼음', FILE);
}
