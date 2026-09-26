/**
 * 집마다 기본 살림 확인 (자율 욕구 관리): 요강, 식탁, 찬장, 씻을 곳. 없으면 그 집 방 안 벽가 빈 칸에 하나 넣음.
 * 공공 건물(여관·교회·길드 회관·목욕탕 …)에는 요강. 지도를 다시 만들지 않고 ashford.json 에 물건만 덧붙임 (실내 배치 보존).
 * 놓을 수 있는지와 길 막힘은 건축 엔진(buy)이 판정하고, 경고가 나면 되돌림.
 *   npx tsx tools/world/ensure-home-basics.ts
 */
import fs from 'node:fs';
import { loadSimData } from '../data-node';
import { Simulation } from '../../src/sim/sim';

const FILE = 'src/data/town/ashford.json';
const PUBLIC_POTS: Record<string, number> = { inn: 2, castle: 3, church: 1, guild_hall: 1, bathhouse: 1, monastery: 2, mill: 1, craft_street: 1, market: 1 };
/** [이 상호작용이 되는 물건이 있어야 함, 방 안에 살 물건 후보, 방에 자리가 없으면 마당에 놓을 물건] (식탁이 없으면 화덕 옆에서 먹음) */
const BASICS: [string[], string[], string[]][] = [
  [['chamber_pot.use', 'outhouse.use'], ['chamber_pot'], ['outhouse', 'chamber_pot']],
  [['table.eat_stew'], ['table_round', 'table_trestle', 'dining_table'], []],
  [['cupboard.snack_bread'], ['cupboard', 'shelf_open'], []],
  [['barrel.wash_hands', 'washbasin.wash_face', 'washtub.bathe'], ['barrel_water', 'washbasin'], ['barrel_water']],
];
const sim = new Simulation(loadSimData({ town: 'ashford' }), 1);
const b = sim.builder!;
const w = sim.world;
const g = w.grid;
const H1 = w.lot.h + 1;
b.area = [0, 0, g.w - 1, g.h - 1];
sim.apply({ kind: 'grant', amount: 1e7, reason: 'tool' });
const town = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { lot: { objects: { id: string; x: number; y: number; rot?: number }[] }; places: { id: string; kind: string; rect: [number, number, number, number] }[]; lots: { id: string; kind: string; house: string | null; rect: [number, number, number, number] }[] };
const added: string[] = [];

function inRect(o: { x: number; y: number }, r: [number, number, number, number]): boolean {
  const ly = o.y % H1;
  return o.x >= r[0] && o.x <= r[2] && ly >= r[1] && ly <= r[3];
}
function has(r: [number, number, number, number], ias: string[]): boolean {
  return w.objects.some((o) => inRect(o, r) && (sim.data.compiled.byDef.get(o.defId) ?? []).some((c) => ias.includes(c.id)));
}
/** 영역 안 방들 (1층 먼저, 큰 방부터) */
function roomsIn(r: [number, number, number, number]): Map<number, number[]> {
  const rooms = new Map<number, number[]>();
  for (let slab = 0; slab < Math.floor(g.h / H1) + 1; slab++) for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) {
    const i = g.idx(x, y + slab * H1);
    if (i < 0 || g.room[i] < 0) continue;
    (rooms.get(g.room[i]) ?? rooms.set(g.room[i], []).get(g.room[i])!).push(i);
  }
  return rooms;
}
/** 놓은 물건의 쓰는 자리에 장터에서 걸어서 닿는가 (실내는 방 안에서 판정되므로 바깥 물건만 봄) */
const pf = (sim as unknown as { path: { find(a: number, b: number, bl: boolean): number[] | null } }).path;
const market = town.places.find((p) => p.kind === 'market')!;
const marketCell = g.idx((market as unknown as { anchor: [number, number] }).anchor[0], (market as unknown as { anchor: [number, number] }).anchor[1]);
function slotReachable(uid: number): boolean {
  const o = w.byUid.get(uid);
  if (!o) return false;
  // 서서 쓰는 자리(문 앞)는 모두 닿아야 함: 뒤에서 건물을 뚫고 들어가 앉는 배치 금지
  const slots = sim.world.def(o.defId).slots;
  const stand = slots.filter((sl) => sl.pose === 'stand');
  const need = stand.length ? stand : slots;
  return need.every((sl) => { const c = w.slotCell(o, sl); return c >= 0 && !!pf.find(marketCell, c, sl.pose !== 'stand'); });
}

function place(label: string, rooms: Map<number, number[]>, defIds: string[], edgeFirst = true): boolean {
  for (const [room, cells] of [...rooms.entries()].sort((a, c) => c[1].length - a[1].length || a[0] - c[0])) {
    const edge = cells.filter((i) => {
      const x = i % g.w, y = Math.floor(i / g.w);
      return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.room[g.idx(x + dx, y + dy)] !== room);
    });
    const order = edgeFirst ? [...edge, ...cells.filter((i) => !edge.includes(i))] : cells;
    for (const defId of defIds) for (const i of order) {
      const x = i % g.w, y = Math.floor(i / g.w);
      for (const rot of [0, 1, 2, 3]) {
        const r = b.apply({ op: 'buy', defId, x, y, rot });
        if (!r.ok) continue;
        if (r.warnings.length || (label.endsWith('일터') || label.endsWith('마당')) && r.uid !== undefined && !slotReachable(r.uid)) {
          if (r.uid !== undefined) b.apply({ op: 'sell', uid: r.uid });
          continue;
        }
        town.lot.objects.push({ id: defId, x, y, ...(rot ? { rot } : {}) });
        added.push(`${label} ${defId} @${x},${y}`);
        return true;
      }
    }
  }
  return false;
}

/** 방 안 장식 소품(상호작용이 수리뿐인 1칸 물건) 하나를 치우고 그 자리에 넣음. 길이 막히면 되돌림 */
/** 바꾸면 안 되는 물건 (살림의 핵심) */
const ESSENTIAL = ['bed.sleep', 'chamber_pot.use', 'hearth.cook_stew', 'cupboard.snack_bread', 'table.eat_stew', 'altar.pray', 'barrel.wash_hands'];
function swapDecor(label: string, rooms: Map<number, number[]>, defId: string, anyNonEssential = false): boolean {
  const roomSet = new Set(rooms.keys());
  for (const o of [...w.objects]) {
    const i = g.idx(o.x, o.y);
    if (!roomSet.has(g.room[i])) continue;
    const def = sim.data.objects[o.defId];
    if (!def || def.wallMounted || def.surface) continue;
    const ias = (sim.data.compiled.byDef.get(o.defId) ?? []).map((c) => c.id).filter((id) => id !== 'obj.repair');
    if (anyNonEssential) {
      if (def.footprint.w * def.footprint.h > 2 || ias.some((i) => ESSENTIAL.includes(i)) || o.defId.includes('altar')) continue;
    } else if (def.footprint.w !== 1 || def.footprint.h !== 1 || ias.length) continue;
    const x = o.x, y = o.y, rot = o.rot ?? 0, old = o.defId;
    const sold = b.apply({ op: 'sell', uid: o.uid });
    if (!sold.ok) continue;
    for (const r2 of [0, 1, 2, 3]) {
      const r = b.apply({ op: 'buy', defId, x, y, rot: r2 });
      if (r.ok && !r.warnings.length) {
        const k = town.lot.objects.findIndex((q) => q.id === old && q.x === x && q.y === y);
        if (k >= 0) town.lot.objects.splice(k, 1);
        town.lot.objects.push({ id: defId, x, y, ...(r2 ? { rot: r2 } : {}) });
        added.push(`${label} ${old} → ${defId} @${x},${y}`);
        return true;
      }
      if (r.ok && r.uid !== undefined) b.apply({ op: 'sell', uid: r.uid });
    }
    b.apply({ op: 'buy', defId: old, x, y, rot });
  }
  return false;
}

/** 부지 안 바깥 칸 (1층, 방 밖, 걸을 수 있는 땅): 집 벽에 붙은 칸 먼저. place() 가 방 하나처럼 다룸 */
function yardCells(r: [number, number, number, number]): Map<number, number[]> {
  const cells: number[] = [];
  for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) {
    const i = g.idx(x, y);
    if (i >= 0 && g.room[i] < 0 && !w.lot.walls[i]) cells.push(i);
  }
  return new Map([[-1, cells]]);
}

// 공공 건물: 방마다 요강 (큰 방부터 정한 수까지)
for (const pl of town.places) {
  const want = PUBLIC_POTS[pl.kind];
  if (!want) continue;
  const rooms = roomsIn(pl.rect);
  let n = 0;
  for (const [room, cells] of [...rooms.entries()].sort((a, c) => c[1].length - a[1].length || a[0] - c[0])) {
    if (n >= want) break;
    if (w.objects.some((o) => o.defId.startsWith('chamber_pot') && g.room[g.idx(o.x, o.y)] === room)) { n++; continue; }
    if (place(`${pl.id}`, new Map([[room, cells]]), ['chamber_pot'])) n++;
  }
}
// 사는 장소(성·교회·수도원·여관 …): 집과 같은 기본 살림 + 잠자리 (people.json residence)
const missing: string[] = [];
const people = JSON.parse(fs.readFileSync('src/data/town/people.json', 'utf8')) as { households: { residence?: string; members: unknown[] }[] };
const residents = new Map<string, number>();
for (const h of people.households) if (h.residence) residents.set(h.residence, (residents.get(h.residence) ?? 0) + h.members.length);
for (const pl of town.places) {
  const n = residents.get(pl.id);
  if (!n) continue;
  // 장소와 겹치는 주거 부지가 있으면 그 가문은 그 부지가 집 (town.populate) → 부지 쪽에서 챙김
  const r0 = pl.rect;
  if (town.lots.some((l) => l.house && l.rect[0] <= r0[2] && l.rect[2] >= r0[0] && l.rect[1] <= r0[3] && l.rect[3] >= r0[1])) continue;
  const rooms = roomsIn(pl.rect);
  for (const [ias, buy] of BASICS) {
    if (has(pl.rect, ias)) continue;
    if (!rooms.size) continue;
    if (!place(pl.id, rooms, buy) && !buy.some((d) => swapDecor(pl.id, rooms, d)) && !buy.some((d) => swapDecor(pl.id, rooms, d, true))) missing.push(`${pl.id}: ${buy[0]}`);
  }
  // 잠자리: 사는 사람 둘에 침대 하나는 있게 (2인 침대 기준)
  if (!rooms.size) continue;
  const beds = w.objects.filter((o) => inRect(o, pl.rect) && (sim.data.compiled.byDef.get(o.defId) ?? []).some((c) => c.id === 'bed.sleep')).length;
  for (let k = beds; k < Math.ceil(n / 2); k++) if (!place(pl.id, rooms, ['bed_straw'])) { missing.push(`${pl.id}: bed_straw`); break; }
}
// 집: 기본 살림
for (const lot of town.lots) {
  if (!lot.house) continue;
  const rooms = roomsIn(lot.rect);
  if (!rooms.size) continue;
  for (const [ias, buy, yard] of BASICS) {
    if (has(lot.rect, ias)) continue;
    if (place(lot.id, rooms, buy)) continue;
    if (yard.length && place(`${lot.id} 마당`, yardCells(lot.rect), yard.filter((d) => d !== 'chamber_pot'))) continue;
    if (buy.some((d) => swapDecor(lot.id, rooms, d))) continue;
    if (yard.length) missing.push(`${lot.id}: ${buy[0]}`);
  }
}
// 바깥 일터(장터, 공방 거리, 방앗간, 우물가, 숲·강가, 마상시합장, 영주 밭): 바깥 변소. 가장자리 쪽 빈 땅
const WORK_OUTHOUSE: Record<string, number> = { market: 1, craft_street: 1, mill: 1, well_square: 1, forest_river: 2, tourney_ground: 1, lord_fields: 2, pasture: 1 };
const areas = [...town.places.map((p) => ({ id: p.id, rect: p.rect })), ...((town as unknown as { zones: { id: string; rect: [number, number, number, number] }[] }).zones ?? [])];
for (const a of areas) {
  const want = WORK_OUTHOUSE[a.id];
  if (!want) continue;
  const have = w.objects.filter((o) => o.defId === 'outhouse' && inRect(o, a.rect)).length;
  const [x0, y0, x1, y1] = a.rect;
  const cells: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = g.idx(x, y);
    if (i >= 0 && g.room[i] < 0 && !w.lot.walls[i]) cells.push(i);
  }
  // 넓은 곳(밭)은 좌우로 나눠 하나씩: 가운데에서 먼 칸부터가 아니라 구역별 가장자리
  const parts = want;
  for (let k = have; k < want; k++) {
    const lo = x0 + ((x1 - x0 + 1) * k) / parts, hi = x0 + ((x1 - x0 + 1) * (k + 1)) / parts;
    const mine = cells.filter((i) => { const x = i % g.w; return x >= lo && x < hi; })
      .sort((a2, b2) => {
        const e = (i: number) => { const x = i % g.w, y = Math.floor(i / g.w); return Math.min(x - x0, x1 - x, y - y0, y1 - y); };
        return e(a2) - e(b2) || Math.abs((a2 % g.w) - (lo + hi) / 2) - Math.abs((b2 % g.w) - (lo + hi) / 2) || a2 - b2;
      });
    if (!place(`${a.id} 일터`, new Map([[-1, mine]]), ['outhouse'], false)) missing.push(`${a.id}: outhouse`);
  }
}
fs.writeFileSync(FILE, JSON.stringify(town));
console.log(`넣은 물건 ${added.length}개\n${added.join('\n')}`);
if (missing.length) console.log(`못 넣음 ${missing.length}: ${missing.join(', ')}`);
