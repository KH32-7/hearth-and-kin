/**
 * 마을 연결 검사: 장터에서 걸어서 닿는 칸을 칠하고, 문 앞 칸이 닿지 않는 집/장소를 찾음.
 * 막는 원인(물건/절벽/물/벽)을 끊긴 조각의 가장자리에서 셈. 사람이 집에 갇혀 굶거나 용변 실수하는 문제 진단용
 *   npx tsx tools/world/check-connectivity.ts
 */
import { loadSimData } from '../data-node';
import { Simulation } from '../../src/sim/sim';
const sim = new Simulation(loadSimData({ town: 'ashford' }), 1);
const g = sim.world.grid;
const w = g.w;
const H = sim.world.lot.h;
const seen = new Uint8Array(g.w * g.h);
const start = g.idx(60, 67);
const q = [start];
seen[start] = 1;
while (q.length) {
  const c = q.pop()!;
  const cx = c % w, cy = (c - cx) / w;
  const nbr = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => (g.inBounds(cx + dx, cy + dy) ? (cy + dy) * w + cx + dx : -1));
  if (g.portal[c] >= 0) nbr.push(g.portal[c]);
  for (const n of nbr) if (n >= 0 && !seen[n] && g.walkable(n)) { seen[n] = 1; q.push(n); }
}
const t = sim.town!;
const bad: string[] = [];
for (const o of sim.world.lot.openings) {
  if (o.kind !== 'door' || o.y >= H) continue;
  const i = g.idx(o.x, o.y);
  if (seen[i]) continue;
  const lot = t.lotOf(o.x, o.y);
  const pl = t.placeOf(o.x, o.y);
  bad.push(`${lot?.id ?? pl?.id ?? '?'} 문 @${o.x},${o.y}`);
}
// 사람 위치 기준
const stuck = sim.persons.filter((p) => !seen[g.idx(p.cellX(), p.cellY())]).map((p) => `${p.name}@${p.cellX()},${p.cellY()}(${p.homeLot ?? t.householdResidence.get(p.household)})`);
// 끊긴 칸 옆 막는 원인
const elev = sim.world.lot.elev ?? [];
const cause: Record<string, number> = {};
for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) {
  const i = y * w + x;
  if (seen[i] || !g.walkable(i)) continue;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = g.idx(x + dx, y + dy);
    if (n < 0 || g.walkable(n)) continue;
    const k = g.objAt[n] ? `물건:${sim.world.byUid.get(g.objAt[n])?.defId}` : g.wall[n] ? '벽' : g.solid[n] ? (elev[n] !== elev[i] ? '절벽/높이' : '막힌 땅(물·지형)') : '기타';
    cause[k] = (cause[k] ?? 0) + 1;
  }
}
// 생활 물건 (요강·변소·찬장·식탁·침대·화덕·물통): 쓰는 자리 중 하나라도 닿아야 함
const LIFE = /^(chamber_pot|outhouse|cupboard|shelf_open|table_|dining_table|bed_|hearth|barrel_water|washbasin)/;
const unreach: string[] = [];
for (const o of sim.world.objects) {
  if (!LIFE.test(o.defId)) continue;
  const def = sim.world.def(o.defId);
  if (!def.slots.length) continue;
  const ok = def.slots.some((sl) => { const c = sim.world.slotCell(o, sl); return c >= 0 && (seen[c] || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const cx = c % w, cy = (c - cx) / w; const n = g.idx(cx + dx, cy + dy); return n >= 0 && seen[n]; })); });
  if (!ok) unreach.push(`${o.defId}@${o.x},${o.y}(${t.lotOf(o.x, o.y)?.id ?? t.placeOf(o.x, o.y)?.id ?? '-'})`);
}
const sealedDoors = bad.filter((b) => t.sealed.has(b.split(' ')[0]));
const openBad = bad.filter((b) => !t.sealed.has(b.split(' ')[0]));
console.log(`장터에서 닿지 않는 문 ${bad.length} (길 없는 부지로 비워 둔 것 ${sealedDoors.length}: ${sealedDoors.join(', ')})`);
console.log(`닿지 않는 생활 물건 ${unreach.length}: ${unreach.slice(0, 30).join(', ')}`);
console.log(`갇힌 사람 ${stuck.length}: ${stuck.join(', ')}`);
console.log('끊긴 칸 가장자리 원인 (상위):', Object.entries(cause).sort((a, b) => b[1] - a[1]).slice(0, 12));
process.exit(openBad.length || stuck.length ? 1 : 0);
