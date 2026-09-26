/**
 * 애쉬포드 v2 (비주얼 개편 docs/07): tools/world/town-layout.ts 배치(지형/높이/강/성벽/외관/나무) → 게임 지도 src/data/town/ashford.json
 *   npx tsx tools/world/town-layout.ts && npx tsx tools/world/make-town2.ts
 * - 외관(shell) 발자국마다 건축 엔진으로 실내: 벽/바닥/문, 방 나누기, 가구 (역할별 프로그램)
 * - 공공 장소 12 + 기능 물건 (장터 노점, 교회 제단/긴 의자, 여관 술청, 성 왕좌 …), 구역, 주거 부지, 빈 부지, 출구
 * 무작위는 시드 RNG 만
 */
import fs from 'node:fs';
import path from 'node:path';
import { simRaw } from '../data-node';
import { validateSimData, mergeObjectDefs, type BuildData } from '../../src/sim/data/simData';
import { Simulation } from '../../src/sim/sim';
import type { BuildOp, BuildResult } from '../../src/sim/build/builder';
import { Rng } from '../../src/sim/core/rng';
import type { LotDef, ObjectDef } from '../../src/sim/core/types';
import { normalizeLot } from '../../src/sim/world/lot';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
process.chdir(ROOT);
const rng = new Rng(20261001);
const rnd = () => rng.next();

interface Layout {
  w: number; h: number; ground: string[]; elev: number[]; ramps: { x: number; y: number; w: number }[]; cliffStyle: number[];
  shells: { id: string; x: number; y: number; tag?: string }[];
  objects: { id: string; x: number; y: number; rot?: number }[];
  layout: { exits: [number, number][]; castle: { x0: number; y0: number; x1: number; y1: number }; market: [number, number]; wellSquare: [number, number]; shoreProps?: { id: string; x: number; y: number }[]; fences: { x0: number; y0: number; x1: number; y1: number; style: string }[]; farmObjs: { id: string; x: number; y: number; rot?: number }[] };
}
const L = JSON.parse(fs.readFileSync('artifacts/qa/visual/layout-a.json', 'utf8')) as Layout;
const W = L.w, H = L.h;
const SH = (JSON.parse(fs.readFileSync('src/data/artpacks/shells.json', 'utf8')) as { shells: Record<string, { role: string; size: string; foot: [number, number]; door: number }> }).shells;

// ---------------------------------------------------------------- data
const townObjects = JSON.parse(fs.readFileSync('src/data/objects_town.json', 'utf8')) as Record<string, ObjectDef>;
const townIas = (JSON.parse(fs.readFileSync('src/data/interactions_town.json', 'utf8')) as { interactions: Record<string, unknown> }).interactions;
function mergedRaw(lot: LotDef) {
  const raw = simRaw({}) as Record<string, unknown> & { objects: Record<string, unknown>; interactions: { interactions: Record<string, unknown> } };
  raw.objects = { ...raw.objects, ...townObjects };
  raw.interactions = { interactions: { ...raw.interactions.interactions, ...townIas } };
  return { ...raw, lot };
}
const raw0 = simRaw({}) as { objects: Record<string, ObjectDef>; build: BuildData; catalog: unknown };
const DEFS = mergeObjectDefs({ ...raw0.objects, ...townObjects }, raw0.build, raw0.catalog).objects;

// ---------------------------------------------------------------- 부지 배열
const lot0: LotDef = {
  id: 'ashford', w: W, h: H,
  ground: L.ground.slice(), floor: new Array(W * H).fill(null), walls: new Array(W * H).fill(null),
  openings: [], objects: [], spawn: { x: 60, y: 70 },
  exits: L.layout.exits.map(([x, y]) => ({ x, y })),
  roof: { style: 'roof_shingle' },
  elev: L.elev, ramps: L.ramps, cliffStyle: L.cliffStyle, shells: L.shells,
};
// 나무/덤불은 미리 (엔진 밖), 소품은 엔진으로
const NATURE = /^(tree_|bush|rock|stump|log_|wildflower|mushroom)/;
// 마지막 거름: 나무/덤불 발자국과 둘레 한 칸이 전부 풀이어야 함 (길/광장/물 위 나무 금지)
const grassy = (x: number, y: number) => x < 0 || y < 0 || x >= W || y >= H || /^(grass|tallgrass)/.test(L.ground[y * W + x]);
let dropped = 0;
for (const o of L.objects) {
  if (!NATURE.test(o.id) || !DEFS[o.id]) continue;
  const f = DEFS[o.id].footprint;
  let ok = true;
  for (let y = o.y - 1; y <= o.y + f.h && ok; y++) for (let x = o.x - 1; x <= o.x + f.w && ok; x++) if (!grassy(x, y)) ok = false;
  if (!ok) { dropped++; continue; }
  lot0.objects.push({ id: o.id, x: o.x, y: o.y });
}
console.log('길가라 뺀 나무', dropped);
const lot = normalizeLot(lot0);

// ---------------------------------------------------------------- 엔진
const data = validateSimData(mergedRaw(lot) as never);
const sim = new Simulation(data, 7);
const E = L.layout.exits[0];
sim.addPerson('목수', E[0] + 0.5, E[1] + 1.5, { estate: 'noble' });
sim.econ!.account(1)!.money = 1_000_000_000;
const builder = sim.builder!;
builder.area = null;
const fails: string[] = [];
let ops = 0;
function B(op: BuildOp, must = true): BuildResult {
  const r = sim.apply({ kind: 'build', op }) as BuildResult;
  ops++;
  if (!r.ok && must) fails.push(`${op.op} ${JSON.stringify(op).slice(0, 120)}: ${r.reason}`);
  return r;
}
/** 물건 사서 놓기: 후보 칸을 차례로 (길 막힘 경고가 새로 생기면 되팔고 다음) */
/** 비워 둘 칸 (문 앞, 안문 양옆, 계단 발치/층계참): 가구가 못 들어감 */
const reserved = new Set<number>();
const cellKey = (x: number, y: number) => y * W + x;
function fpCells(defId: string, x: number, y: number, rot: number): [number, number][] {
  const f = DEFS[defId]?.footprint ?? { w: 1, h: 1 };
  const [fw, fh] = rot % 2 ? [f.h, f.w] : [f.w, f.h];
  const out: [number, number][] = [];
  for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) out.push([x + dx, y + dy]);
  return out;
}
/** 바깥 소품 간격 (사용자: 근본 없이 겹침): 둘레 한 칸과 위 두 줄(키 큰 그림이 덮는 곳)에 다른 막는 물건이 있으면 안 놓음 */
let spacing = false;
function crowded(defId: string, x: number, y: number, rot: number): boolean {
  const g = sim.world.grid;
  const cells = fpCells(defId, x, y, rot);
  const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, y0 = Math.min(...ys) - 2, y1 = Math.max(...ys) + 1;
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    if (!g.inBounds(xx, yy)) continue;
    if (g.objAt[g.idx(xx, yy)] !== 0) return true;
  }
  return false;
}
function buy(defId: string, cands: [number, number][], rots: number[] = [0], variant?: string): [number, number, number] | null {
  if (!sim.data.objects[defId]) throw new Error(`물건 없음 ${defId}`);
  const base = builder.lastWarnings.length;
  const floorLayer = !DEFS[defId]?.blocks;
  for (const [x, y] of cands) for (const rot of rots) {
    if (!floorLayer && !DEFS[defId]?.wallMounted && fpCells(defId, x, y, rot).some(([cx, cy]) => reserved.has(cellKey(cx, cy)))) continue;
    if (spacing && !floorLayer && !DEFS[defId]?.wallMounted && crowded(defId, x, y, rot)) continue;
    if (builder.canPlace(defId, x, y, rot)) continue;
    const r = B({ op: 'buy', defId, x, y, rot, variant }, false);
    if (!r.ok) continue;
    if (builder.lastWarnings.length <= base) return [x, y, rot];
    if (process.env.DBGW === defId) { const g = sim.world.grid; console.log('경고', defId, x, y, builder.lastWarnings.slice(base).map((w) => `${w.kind}@${w.x},${w.y}`).join(' '), 'base', base, 'all', builder.lastWarnings.length, [x - 1, x, x + 1, x + 2, x + 3].map((xx) => `${xx},${y + 2}:${g.walkable(g.idx(xx, y + 2))}`).join(' ')); }
    B({ op: 'sell', uid: r.uid! }, false);
  }
  return null;
}
function area(x0: number, y0: number, x1: number, y1: number, near: [number, number] = [x0, y0]): [number, number][] {
  const out: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out.sort((a, b) => Math.hypot(a[0] - near[0], a[1] - near[1]) - Math.hypot(b[0] - near[0], b[1] - near[1]));
}
const shuffle = <T>(a: T[]): T[] => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ---------------------------------------------------------------- 실내 (외관 발자국 = 집 크기 그대로, 규칙 배치)
// 방 = 외관 발자국 사각형 (바깥벽 포함). 1층 앞벽에 현관, 뒷벽(북)에 창과 벽 장식, 2층집은 계단 + 2층 침실
// 가구 배치 규칙:
//  - 벽에 붙는 것(침대 머리, 화덕, 찬장, 옷장, 선반)은 북벽 줄. 침대 옆 협탁, 발치 궤짝
//  - 식탁은 방 가운데, 양 끝 걸상 + 아래 긴 의자, 밑에 러그
//  - 현관 안쪽 두 칸, 안문 양옆, 계단 발치/층계참은 비움 (reserved)
//  - 구석(남쪽 줄 양끝, 북쪽 구석)은 통/자루/바구니/화분 같은 생활 소품
//  - 북벽 칸: 창(3칸마다) 사이사이 벽걸이(허브·마늘·그림·태피스트리·옷), 방마다 벽 등불 하나
interface Room { x0: number; y0: number; x1: number; y1: number; kind: string; ix0: number; iy0: number; ix1: number; iy1: number }
const mkRoom = (x0: number, y0: number, x1: number, y1: number, kind: string): Room => ({ x0, y0, x1, y1, kind, ix0: x0 + 1, iy0: y0 + 1, ix1: x1 - 1, iy1: y1 - 1 });
const WALL_BY_ROLE: Record<string, string> = { barn: 'wall_plank', shed: 'wall_plank', church: 'wall_stone_white', castle: 'wall_ashlar', castle_tower: 'wall_ashlar', chapel: 'wall_stone', inn: 'wall_timber', guild_hall: 'wall_timber', bathhouse: 'wall_stone', hall: 'wall_timber', workshop: 'wall_plank' };
const FLOOR_BY_ROLE: Record<string, string> = { barn: 'floor_plank_rough', shed: 'floor_plank_rough', church: 'floor_flagstone', castle: 'floor_tile_check', castle_tower: 'floor_flagstone', chapel: 'floor_flagstone', inn: 'floor_wood', guild_hall: 'floor_wood_dark', bathhouse: 'floor_flagstone' };
// 집 벽: 나무 윗면 (돌 윗면은 두꺼운 자갈처럼 보여 집에는 안 씀)
const HOUSE_WALLS = ['wall_timber', 'wall_daub_white', 'wall_plank', 'wall_timber_rose', 'wall_daub'];
const HOUSE_FLOORS = ['floor_wood', 'floor_wood', 'floor_wood_dark', 'floor_wood'];
// 2층 외관 (창이 두 줄이거나 지붕창 층이 있는 것)
const STORY2 = new Set(['s1', 's4', 's5', 's6', 's7', 's8', 's12', 's13', 's14', 's15', 's17', 's19', 's20', 's21', 's22', 's24', 's26', 's28', 's29', 's31', 's39', 's41']);
const UP = H + 1; // 2층 판 = 행 + (h + 1)
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const rotsOf = (id: string) => (DEFS[id]?.rotations?.length ? (DEFS[id].rotations as number[]) : [0]);
const has = (id: string) => !!DEFS[id];

/** 북벽 줄 후보 (tx 에서 가까운 순) */
function northRow(r: Room, tx: number, dy = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let x = r.ix0; x <= r.ix1; x++) out.push([x, r.iy0 + dy]);
  return out.sort((a, b) => Math.abs(a[0] - tx) - Math.abs(b[0] - tx));
}
/** 방 가운데에서 가까운 순 (w × h 물건의 왼쪽 위), 북벽 줄은 뺌 */
function middle(r: Room, w: number, h: number, dyBias = 0.5): [number, number][] {
  const cx = (r.ix0 + r.ix1 + 1 - w) / 2, cy = r.iy0 + (r.iy1 - r.iy0 + 1 - h) * dyBias;
  const out: [number, number][] = [];
  for (let y = r.iy0 + 1; y <= r.iy1 - h + 1; y++) for (let x = r.ix0; x <= r.ix1 - w + 1; x++) out.push([x, y]);
  return out.sort((a, b) => Math.hypot(a[0] - cx, (a[1] - cy) * 1.4) - Math.hypot(b[0] - cx, (b[1] - cy) * 1.4));
}
/** 구석 (북서, 북동, 남서, 남동, 그 옆) */
function corners(r: Room): [number, number][] {
  return [[r.ix0, r.iy0], [r.ix1, r.iy0], [r.ix0, r.iy1], [r.ix1, r.iy1], [r.ix0, r.iy0 + 1], [r.ix1, r.iy0 + 1], [r.ix0, r.iy1 - 1], [r.ix1, r.iy1 - 1]];
}
/** 벽 따라 (옆벽, 남벽 안쪽 줄) */
function edges(r: Room): [number, number][] {
  const out: [number, number][] = [];
  for (let y = r.iy0; y <= r.iy1; y++) out.push([r.ix0, y], [r.ix1, y]);
  for (let x = r.ix0 + 1; x < r.ix1; x++) out.push([x, r.iy1]);
  return shuffle(out);
}
/** 지금 꾸미는 방: 물건 발자국이 방 안(벽걸이는 북벽 줄)을 벗어나는 후보는 버림 */
let ROOM: Room | null = null;
function inRoom(id: string, x: number, y: number, rot: number): boolean {
  const r = ROOM;
  if (!r) return true;
  if (DEFS[id]?.wallMounted) return y === r.y0 && x >= r.ix0 && x <= r.ix1;
  return fpCells(id, x, y, rot).every(([cx, cy]) => cx >= r.ix0 && cx <= r.ix1 && cy >= r.iy0 && cy <= r.iy1);
}
function put(id: string, cands: [number, number][], rots?: number[]): [number, number, number] | null {
  if (!has(id)) return null;
  const rs = rots ?? [0];
  return buy(id, cands.filter(([x, y]) => rs.some((rt) => inRoom(id, x, y, rt))), rs);
}
/** 북벽 칸 (벽 줄 y0): 창 / 벽걸이 / 등불. skip = 그 x 는 비움 (화덕 굴뚝, 칸막이) */
/** 문 칸에도 바닥 (문간에 풀/흙이 비치지 않게) */
function doorAt(x: number, y: number, variant: string, floor: string): void {
  B({ op: 'opening', x, y, kind: 'door', variant }, false);
  B({ op: 'floor', x0: x, y0: y, x1: x, y1: y, style: floor }, false);
}
function dressNorthWall(r: Room, skip: Set<number>, hang: string[], window: string): void {
  ROOM = r;
  const y = r.y0;
  let lastWin = -9;
  const xs: number[] = [];
  for (let x = r.ix0; x <= r.ix1; x++) if (!skip.has(x)) xs.push(x);
  // 창: 3칸 간격, 양 끝 한 칸은 띄움
  for (const x of xs) {
    if (x - r.ix0 < 1 || r.ix1 - x < 1) continue;
    if (x - lastWin >= 3 && B({ op: 'opening', x, y, kind: 'window', variant: window }, false).ok) lastWin = x;
  }
  // 벽걸이: 창 아닌 칸에 (두 번째는 벽 등불)
  const free = xs.filter((x) => !sim.world.lot.openings.some((o) => o.x === x && o.y === y));
  let k = 0;
  for (const x of free) {
    const id = k === 1 && has('lantern_wall') ? 'lantern_wall' : hang[k % hang.length];
    if (put(id, [[x, y]])) k++;
    if (k >= 4) break;
  }
}
/** 부엌/거실: 화덕(북벽 가운데) + 찬장/선반 + 물통, 식탁 세트, 러그, 구석 소품 */
function kitchen(r: Room, poor: boolean): Set<number> {
  ROOM = r;
  const skip = new Set<number>();
  const cx = Math.round((r.ix0 + r.ix1) / 2) - 1;
  const h = put('hearth', northRow(r, cx));
  if (h) for (let x = h[0] - 1; x <= h[0] + 3; x++) skip.add(x);
  put('cupboard', northRow(r, h ? h[0] + 4 : r.ix1));
  put(pick(['shelf_open', 'shelf_doors', 'shelf_drawer', 'drying_rack_pots']), northRow(r, h ? h[0] - 2 : r.ix0));
  put('barrel_water', corners(r).slice(0, 2).concat(edges(r)));
  const tableId = poor ? 'table_trestle' : pick(['dining_table', 'table_large', 'dining_table']);
  const tw = DEFS[tableId]?.footprint.w ?? 3, th = DEFS[tableId]?.footprint.h ?? 1;
  const t = put(tableId, middle(r, tw, th, 0.6));
  if (t) {
    put('rug', [[t[0], t[1]], [t[0], t[1] - 1]]);
    put('stool', [[t[0] - 1, t[1]], [t[0] + tw, t[1]]]);
    put(poor ? 'stool' : 'chair', [[t[0] + tw, t[1]], [t[0] - 1, t[1]]]);
    put('bench', [[t[0], t[1] + th], [t[0], t[1] - 1]]);
    // 식탁 위 촛대 (밤에 켜짐)
    put(poor ? 'candle_single_iron' : pick(['candle_pair_iron', 'candle_triple_iron', 'candelabra_iron']), [[t[0] + tw - 1, t[1]], [t[0], t[1]]]);
  }
  for (const id of [pick(['sacks_heap', 'sack_single', 'sack_open']), pick(['basket_roots', 'basket_apples', 'basket_mixed']), pick(['barrel_flour', 'barrel_grain', 'crate_flour'])]) put(id, corners(r).slice(2).concat(edges(r)));
  put('candlestick', corners(r).concat(edges(r)));
  return skip;
}
/** 침실: 침대(머리 북벽) + 협탁, 발치 궤짝, 러그, 옷장, 요강, 아이 침대 */
function bedroom(r: Room, beds: number, poor: boolean): Set<number> {
  ROOM = r;
  const skip = new Set<number>();
  const cx = Math.round((r.ix0 + r.ix1) / 2);
  const bedId = poor ? 'bed_double_wool' : pick(['bed_double', 'bed_double_wool', 'bed_double_linen']);
  const b = put(bedId, northRow(r, cx - 1)) ?? put('bed_double', northRow(r, cx - 1));
  if (b) {
    const ns = put(pick(['nightstand', 'bedside_table', 'bedside_small']), [[b[0] - 1, r.iy0], [b[0] + 2, r.iy0]]);
    if (ns) put(pick(['candle_single_iron', 'candle_single_copper', 'lantern_standing']), [[ns[0], ns[1]]]);
    put(pick(['chest_blanket', 'chest_long', 'bench_bedfoot']), [[b[0], b[1] + 2], [b[0] - 1, b[1] + 2]]);
    put(pick(['rug_rag', 'bearskin', 'fur_brown']), [[b[0] + 2, b[1] + 1], [b[0] - 2, b[1] + 1], [b[0], b[1] + 3]]);
  }
  for (let k = 1; k < beds; k++) put(pick(['bed_straw', 'bed_wool', 'bed_grass', 'bed_cabin']), northRow(r, b ? (k % 2 ? b[0] + 4 : b[0] - 3) : r.ix0));
  put(poor ? 'chest_clothes' : pick(['wardrobe', 'dresser_tall', 'chest_banded']), northRow(r, r.ix1).concat(edges(r)));
  put('chamber_pot', corners(r).slice(2).concat(edges(r)));
  put(pick(['candlestick', 'plant_pot', 'potted_shrub']), corners(r).concat(edges(r)));
  return skip;
}
/** 한 칸짜리 오두막: 한쪽 뒤 구석 침대, 반대쪽 화덕, 앞쪽 식탁 */
function cottage(r: Room): Set<number> {
  ROOM = r;
  const skip = new Set<number>();
  const b = put('bed_double_wool', [[r.ix0, r.iy0], [r.ix1 - 1, r.iy0]]) ?? put('bed_straw', [[r.ix0, r.iy0], [r.ix1, r.iy0]]);
  const hx = b && b[0] === r.ix0 ? r.ix1 - 2 : r.ix0;
  const h = put('hearth', northRow(r, hx + 1));
  if (h) for (let x = h[0] - 1; x <= h[0] + 3; x++) skip.add(x);
  put('cupboard', northRow(r, Math.round((r.ix0 + r.ix1) / 2)));
  const t = put('table_trestle', middle(r, 3, 1, 0.9)) ?? put('table_round', middle(r, 1, 1, 0.9));
  if (t) {
    put('stool', [[t[0] - 1, t[1]], [t[0] + 3, t[1]], [t[0] + 1, t[1] + 1]]);
    put('candle_single_iron', [[t[0], t[1]], [t[0] + 1, t[1]]]);
  }
  put('chest_clothes', corners(r).slice(2).concat(edges(r)));
  put('barrel_water', corners(r).concat(edges(r)));
  put('chamber_pot', corners(r).slice(2).concat(edges(r)));
  put(pick(['sack_single', 'basket_roots', 'sacks_heap']), edges(r));
  put('candlestick', corners(r).concat(edges(r)));
  return skip;
}
/** 공공 건물 격자: 가운데부터 (w+1) 간격 줄 */
function grid(r: Room, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = r.iy0 + 2; y <= r.iy1 - h; y += h + 1) for (let x = r.ix0 + 1; x <= r.ix1 - w; x += w + 1) out.push([x, y]);
  const cx = (r.ix0 + r.ix1) / 2;
  return out.sort((a, b) => a[1] - b[1] || Math.abs(a[0] + w / 2 - cx) - Math.abs(b[0] + w / 2 - cx));
}
const PROGRAM: Record<string, [string, 'north' | 'grid' | 'edge', number][]> = {
  church: [['church_altar', 'north', 1], ['church_pew', 'grid', 8], ['candlestick', 'north', 2], ['statue_maiden', 'north', 1], ['plant_pot', 'edge', 2]],
  castle: [['lord_throne', 'north', 1], ['table_feast', 'grid', 2], ['bench', 'grid', 3], ['armor_rack', 'north', 1], ['candlestick', 'edge', 3], ['rug_red_gold', 'grid', 1], ['bed_canopy', 'north', 1], ['bed_double', 'north', 1], ['chest_gilded', 'edge', 2], ['hearth', 'north', 1], ['cupboard', 'north', 1], ['helmet_stand', 'edge', 1]],
  castle_tower: [['bed_double', 'north', 1], ['bed_straw', 'north', 2], ['weapon_rack', 'edge', 1], ['chest_clothes', 'edge', 1], ['writing_desk', 'grid', 1], ['hearth', 'north', 1]],
  chapel: [['church_altar', 'north', 1], ['church_pew', 'grid', 2], ['bookshelf', 'north', 2], ['scribe_desk', 'grid', 1], ['bed_straw', 'edge', 3], ['hearth', 'north', 1], ['cupboard', 'north', 1]],
  inn: [['inn_counter', 'north', 1], ['hearth', 'north', 1], ['keg_tap', 'north', 1], ['cupboard', 'north', 1], ['dining_table', 'grid', 3], ['bench', 'grid', 4], ['barrel_group', 'edge', 1], ['bed_straw', 'edge', 2], ['candlestick', 'edge', 2], ['rug_runner', 'grid', 1]],
  guild_hall: [['guild_table', 'grid', 1], ['chair', 'grid', 4], ['bookshelf', 'north', 2], ['writing_desk', 'grid', 1], ['chest_strongbox', 'edge', 1], ['hearth', 'north', 1], ['rug_diamond', 'grid', 1]],
  hall: [['hearth', 'north', 1], ['table_large', 'grid', 2], ['bench', 'grid', 3], ['bookshelf', 'north', 1], ['cupboard', 'north', 1], ['bed_double', 'north', 1], ['chest_banded', 'edge', 2], ['rug_diamond', 'grid', 1]],
  workshop: [['workbench', 'north', 2], ['loom', 'north', 1], ['spinning_wheel', 'grid', 1], ['crate_stack', 'edge', 1], ['barrel_pair', 'edge', 1], ['bed_straw', 'edge', 1], ['hearth', 'north', 1], ['table_trestle', 'grid', 1]],
  barn: [['hay_bales', 'edge', 3], ['trough_hay', 'north', 1], ['workbench', 'north', 1], ['barrel_water', 'edge', 1], ['woodpile', 'edge', 1], ['sacks_pile', 'edge', 1], ['grain_barrels', 'edge', 1]],
  shed: [['woodpile', 'edge', 1], ['barrel_water', 'edge', 1], ['crate_plain', 'edge', 1]],
  tent: [['bed_straw', 'north', 1], ['chest_clothes', 'edge', 1], ['barrel_water', 'edge', 1]],
  bathhouse: [['bath_tub_public', 'grid', 2], ['bench', 'edge', 1], ['barrel_water', 'edge', 2], ['washbasin', 'north', 1], ['hearth', 'north', 1]],
};
function furnishPublic(r: Room, kind: string): void {
  ROOM = r;
  let altar: [number, number, number] | null = null;
  for (const [id, where, count] of PROGRAM[kind] ?? []) for (let k = 0; k < count; k++) {
    if (!has(id)) continue;
    // 긴 의자: 제단 가운데 통로를 두고 좌우 두 줄, 제단 앞 한 줄 띄우고 두 칸 간격
    if (id === 'church_pew') {
      if (k > 0) continue;
      const ax = altar ? altar[0] + 1 : Math.round((r.ix0 + r.ix1) / 2);
      for (let y = (altar ? altar[1] + 4 : r.iy0 + 3); y <= r.iy1 - 1; y += 2) {
        let n = 0;
        for (const x of [ax - 4, ax + 2]) if (put(id, [[x, y], [x + (x < ax ? 1 : -1), y]])) n++;
        if (n + (count - 2 * Math.floor(count / 2)) <= 0) break;
      }
      continue;
    }
    const f = DEFS[id].footprint;
    const tx = Math.round((r.ix0 + r.ix1) / 2) - (f.w >> 1) + (k % 2 ? 3 * k : -3 * k);
    const c = where === 'north' ? northRow(r, tx).concat(northRow(r, tx, 1)) : where === 'grid' ? grid(r, f.w, f.h).concat(middle(r, f.w, f.h)) : edges(r);
    // 정면(0)부터, 안 되면 다른 방향 (쓰는 자리가 벽에 막히는 물건)
    const rs = rotsOf(id).includes(0) ? [0, ...rotsOf(id).filter((x) => x !== 0)] : rotsOf(id);
    const got = put(id, c, where === 'grid' ? rs.slice(0, 1) : rs);
    if (id === 'church_altar' && got) altar = got;
    if (!got && process.env.DBG === kind) console.log('실패', kind, id, c.slice(0, 4).map(([x, y]) => `${x},${y}:${builder.canPlace(id, x, y, 0) ?? 'ok?'}:${inRoom(id, x, y, 0)}`).join(' '));
  }
}

interface TownLot { id: string; kind: 'residential' | 'empty'; size: string; rect: [number, number, number, number]; entrance: [number, number]; house: string | null; price: number; start?: boolean }
const lots: TownLot[] = [];
const tagRect: Record<string, [number, number, number, number]> = {};
let houseN = 0, upN = 0;
const HANG_KITCHEN = ['herbs_hanging', 'garlic_string', 'sausage_hook', 'meat_hook', 'towel'];
const HANG_BED = ['tapestry', 'painting_hills', 'clothes_hung', 'curtain', 'painting_map', 'cloth_hanging'];
for (const s of L.shells) {
  const d = SH[s.id];
  if (!d || ['tower', 'gate', 'stairs'].includes(d.role)) continue;
  const [fw, fd] = d.foot;
  const x0 = s.x, y0 = s.y, x1 = s.x + fw - 1, y1 = s.y + fd - 1;
  if (fw < 3 || fd < 3) continue;
  const role = s.tag === 'farmhouse' ? 'house' : s.tag ?? (d.role === 'townhouse' ? 'house' : d.role);
  const hi = houseN++;
  const wall = WALL_BY_ROLE[role] ?? HOUSE_WALLS[hi % HOUSE_WALLS.length];
  const floor = FLOOR_BY_ROLE[role] ?? HOUSE_FLOORS[(hi * 7) % HOUSE_FLOORS.length];
  const r = B({ op: 'room', x0, y0, x1, y1, style: wall, floor }, false);
  if (!r.ok) {
    fails.push(`room ${s.id}@${x0},${y0}: ${r.reason}`);
    continue;
  }
  const dx = Math.min(x1 - 1, Math.max(x0 + 1, x0 + d.door));
  doorAt(dx, y1, role === 'castle' || role === 'church' || role === 'chapel' ? 'door_arch' : role === 'barn' ? 'door_barn' : 'door_ledged', floor);
  // 현관 안쪽 두 칸 비움
  reserved.add(cellKey(dx, y1 - 1));
  if (fd >= 6) reserved.add(cellKey(dx, y1 - 2));
  const whole = mkRoom(x0, y0, x1, y1, role);
  const win = role === 'church' || role === 'chapel' ? 'win_stained' : hi % 3 === 0 ? 'win_shutter' : 'win_lattice';
  if (role !== 'house') {
    furnishPublic(whole, role);
    if (!['barn', 'shed', 'tent'].includes(role)) dressNorthWall(whole, new Set(), role === 'inn' ? ['sign_ale', 'herbs_hanging', 'antlers', 'shield_round'] : role === 'castle' ? ['banner_crest', 'heraldic_banner', 'shield_swords', 'portrait_king'] : ['tapestry', 'banner_eye', 'painting_map'], win);
  } else {
    const poor = d.size === 'small' || d.size === 'tiny';
    const two = STORY2.has(s.id) && fd >= 6 && fw >= 5;
    const iw = fw - 2;
    if (two) {
      // 1층 = 부엌·거실 한 칸, 계단은 현관 반대쪽 옆벽. 2층 = 침실 (넓으면 둘로)
      const sx = dx - x0 < fw / 2 ? x1 - 1 : x0 + 1;
      const sy = y0 + 2; // 층계참 = 2층 (sx, y0+1)
      for (let k = -1; k <= 3; k++) reserved.add(cellKey(sx, sy + k));
      reserved.add(cellKey(sx, sy - 1 + UP));
      reserved.add(cellKey(sx + (sx === x0 + 1 ? 1 : -1), sy - 1 + UP));
      ROOM = null;
      const st = buy('stairs_wood', [[sx, sy]]);
      const skip = kitchen(whole, poor);
      dressNorthWall(whole, skip, HANG_KITCHEN, win);
      const u = B({ op: 'room', x0, y0: y0 + UP, x1, y1: y1 + UP, style: wall, floor: 'floor_wood' }, false);
      if (!u.ok || !st) fails.push(`2층 ${s.id}: ${u.reason ?? ''} ${st ? '' : '계단'}`);
      else {
        upN++;
        const ur = mkRoom(x0, y0 + UP, x1, y1 + UP, 'bedroom');
        if (iw >= 9) {
          const xm = sx < x0 + fw / 2 ? x0 + Math.floor(fw / 2) + 1 : x0 + Math.floor(fw / 2) - 1;
          B({ op: 'wall', x0: xm, y0: y0 + UP, x1: xm, y1: y1 + UP, style: wall }, false);
          doorAt(xm, y1 - 1 + UP, 'door_plank', 'floor_wood');
          reserved.add(cellKey(xm - 1, y1 - 1 + UP));
          reserved.add(cellKey(xm + 1, y1 - 1 + UP));
          const a = mkRoom(x0, y0 + UP, xm, y1 + UP, 'bedroom'), b = mkRoom(xm, y0 + UP, x1, y1 + UP, 'bedroom');
          const sa = bedroom(a, 1, poor), sb = bedroom(b, 2, poor);
          sa.add(xm); sb.add(xm);
          dressNorthWall(a, sa, HANG_BED, win);
          dressNorthWall(b, sb, HANG_BED, win);
        } else {
          const sk = bedroom(ur, iw >= 6 ? 2 : 1, poor);
          dressNorthWall(ur, sk, HANG_BED, win);
        }
      }
    } else if (iw >= 8 && fd >= 5) {
      // 부엌 | 침실 (칸막이 + 안문, 안문은 앞쪽 줄)
      const xm = x0 + Math.floor(fw / 2) + (dx < x0 + fw / 2 ? 1 : -1);
      B({ op: 'wall', x0: xm, y0, x1: xm, y1, style: wall }, false);
      doorAt(xm, y1 - 1, 'door_plank', floor);
      reserved.add(cellKey(xm - 1, y1 - 1));
      reserved.add(cellKey(xm + 1, y1 - 1));
      const kitchenLeft = dx < xm;
      const k = kitchenLeft ? mkRoom(x0, y0, xm, y1, 'kitchen') : mkRoom(xm, y0, x1, y1, 'kitchen');
      const b = kitchenLeft ? mkRoom(xm, y0, x1, y1, 'bedroom') : mkRoom(x0, y0, xm, y1, 'bedroom');
      const sk = kitchen(k, poor), sb = bedroom(b, 2, poor);
      sk.add(xm); sb.add(xm);
      dressNorthWall(k, sk, HANG_KITCHEN, win);
      dressNorthWall(b, sb, HANG_BED, win);
    } else {
      const sk = cottage(whole);
      dressNorthWall(whole, sk, HANG_KITCHEN.slice(0, 2).concat(HANG_BED.slice(0, 2)), win);
    }
  }
  if (s.tag) tagRect[s.tag] = [x0, y0, x1, y1 + 2];
  if (role === 'house') {
    const size = fw * fd <= 50 ? 'small' : fw * fd <= 90 ? 'medium' : fw * fd <= 150 ? 'large' : 'manor';
    lots.push({ id: `lot_${String(lots.length + 1).padStart(2, '0')}`, kind: 'residential', size, rect: [x0, y0, x1, y1 + 1], entrance: [dx, y1 + 1], house: s.id, price: fw * fd * 18 });
  }
}
ROOM = null;
console.log('실내', houseN, '채, 2층', upN, ', 부지', lots.length);
spacing = true;

// ---------------------------------------------------------------- 교외: 울타리, 밭 구획, 농가 마당 소품
for (const f of L.layout.fences ?? []) B({ op: 'wall', x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1, style: f.style }, false);
for (const o of L.layout.farmObjs ?? []) if (DEFS[o.id]) buy(o.id, [[o.x, o.y], [o.x + 1, o.y], [o.x, o.y + 1], [o.x - 1, o.y]], [o.rot ?? 0]);
let shoreN = 0;
for (const o of L.layout.shoreProps ?? []) if (DEFS[o.id] && buy(o.id, [[o.x, o.y]])) shoreN++;
console.log('물가 소품', shoreN);
// ---------------------------------------------------------------- 장소 (야외)
const [mx, my] = L.layout.market;
const [wx, wy] = L.layout.wellSquare;
const CR = L.layout.castle;
for (const [id, dx, dy, rot] of [['market_stall_food', -7, -4, 0], ['market_stall_cloth', -2, -5, 0], ['market_stall_tools', 3, -5, 0], ['market_stall_livestock', -8, 1, 0], ['market_stall', 5, 1, 0], ['market_stall_food', -3, 3, 0], ['notice_board_town', 7, -2, 0]] as [string, number, number, number][]) buy(id, area(mx + dx - 2, my + dy - 2, mx + dx + 2, my + dy + 2, [mx + dx, my + dy]), [rot]);
buy('fountain', area(mx - 2, my - 2, mx + 2, my + 2, [mx, my]));
for (const id of ['bench_garden', 'bench_garden', 'lamp_post', 'lamp_post', 'barrel_group', 'crate_stack', 'wagon', 'hay_cart', 'barrel_pair', 'sacks_pile', 'crate_banded', 'basket_apples', 'barrel_open', 'potted_tree', 'potted_tree', 'flower_bed', 'flower_bed', 'handcart']) if (DEFS[id]) buy(id, shuffle(area(mx - 9, my - 6, mx + 9, my + 6)));
buy('well', area(wx - 2, wy - 2, wx + 2, wy + 2, [wx, wy]));
for (const id of ['bench_garden', 'bench_garden', 'trough_water', 'lamp_post', 'lamp_post', 'flower_bed']) buy(id, shuffle(area(wx - 6, wy - 4, wx + 6, wy + 4)));
// 공방 거리 (야외 대장간/빵 화덕): 원형 광장 서쪽 큰길가
const cs: [number, number] = [132, 36];
for (const id of ['forge', 'anvil', 'workbench', 'grindstone', 'woodpile', 'chopping_block', 'barrel_water']) buy(id, area(cs[0] - 7, cs[1] - 5, cs[0] + 7, cs[1] + 5, cs));
// 성 안마당: 마상시합장 울짱, 훈련장, 우물
for (const id of ['tourney_lists', 'tourney_lists', 'weapon_rack', 'armor_rack', 'well', 'hay_bales']) buy(id, shuffle(area(CR.x0 + 3, CR.y0 + 3, CR.x1 - 3, CR.y1 - 3)));
// 방앗간: 해자 북쪽 둑에 물레방아 (물이 남쪽 → 물 칸 바로 위 줄)
const isWater = (x: number, y: number) => L.ground[y * W + x] === 'water';
const millCands: [number, number][] = [];
for (let y = 60; y < 90; y++) for (let x = 120; x < 190; x++) if (!isWater(x, y) && isWater(x, y + 1) && isWater(x + 3, y + 1)) millCands.push([x, y]);
buy('mill_wheel', millCands);
const mw = sim.world.objects.find((o) => o.defId === 'mill_wheel');
const millC: [number, number] = mw ? [mw.x + 2, mw.y - 2] : [140, 72];
for (const id of ['grain_barrels', 'sacks_pile', 'crate_flour', 'hay_cart']) buy(id, area(millC[0] - 5, millC[1] - 4, millC[0] + 5, millC[1]), [0]);
// 낚시터: 강/바다 북쪽 둑 (물이 남쪽 → rot 2)
let fish = 0;
for (let y = 40; y < 112 && fish < 10; y += 1) for (let x = 2; x < 196 && fish < 10; x += 7) {
  if (!isWater(x, y) && isWater(x, y + 1) && L.elev[y * W + x] === L.elev[(y + 1) * W + x] && buy('fishing_spot', [[x, y]], [2])) fish++;
}
// 묘지: 교회 옆
const ch = tagRect.church ?? [80, 16, 92, 24];
for (let k = 0; k < 8; k++) buy('grave', shuffle(area(ch[2] + 2, ch[1], ch[2] + 9, ch[3])), [0], ['a', 'b', 'c', 'd'][k % 4]);
// 들풀 약초 (성벽 밖 북쪽 밭 가장자리)
for (let k = 0; k < 4; k++) buy('herb_patch_wild', shuffle(area(2, 1, 60, 8)));
// 생활 소품 (블라인드 비평 1: 문 앞/벽 밑/길가가 비었음): 외관마다 앞벽 밑 줄과 옆벽 쪽에 3~5개
const FRONT = ['barrel_rain', 'pot_sunflower', 'potted_bush', 'flower_bed', 'crate_plain', 'woodpile_logs', 'bench_garden', 'barrel_closed', 'potted_tree', 'sacks_pile', 'bush_red_flowers', 'bush_white_flowers', 'wildflowers', 'barrel_pair', 'pot_sunflower_tall', 'crate_banded'];
let props = 0;
for (const s of L.shells) {
  const d = SH[s.id];
  if (!d || ['tower', 'gate', 'stairs'].includes(d.role)) continue;
  const [fw, fd] = d.foot;
  const fy = s.y + fd; // 앞벽 바로 아래 줄
  const door = s.x + d.door;
  const want = 3 + Math.floor(rnd() * 3);
  const cands: [number, number][] = [];
  for (let x = s.x; x < s.x + fw; x++) if (Math.abs(x - door) > 1) cands.push([x, fy]);
  cands.push([s.x - 1, fy - 1], [s.x + fw, fy - 1], [s.x - 1, fy], [s.x + fw, fy]);
  let k = 0;
  for (const c of shuffle(cands)) {
    if (k >= want) break;
    const id = FRONT[Math.floor(rnd() * FRONT.length)];
    if (!DEFS[id]) continue;
    if (buy(id, [c])) { k++; props++; }
  }
}
// 밤 불빛 (사용자: 불빛 물건 더 많이): 길가 가로등, 집 문 옆 등, 광장 화로, 물가·농가 모닥불
const LAMPS = ['lamp_post', 'lamp_post_wood', 'lamp_post_old', 'lamp_post_bent'];
const lampAt: [number, number][] = [];
const farFromLamps = (x: number, y: number, d: number) => lampAt.every(([lx, ly]) => Math.max(Math.abs(lx - x), Math.abs(ly - y)) >= d);
let lampN = 0;
// 집 문 옆 (두 집에 한 번 꼴)
for (const s of L.shells) {
  const d = SH[s.id];
  if (!d || ['tower', 'gate', 'stairs'].includes(d.role) || rnd() < 0.45) continue;
  const dx = s.x + d.door, fy = s.y + d.foot[1];
  const got = buy(pick(['lamp_post_wood', 'lamp_post']), [[dx + 2, fy], [dx - 2, fy], [dx + 3, fy], [dx - 3, fy]]);
  if (got) { lampAt.push([got[0], got[1]]); lampN++; }
}
// 길가: 흙길 칸 옆 풀밭, 9칸 간격
for (let y = 14; y < H - 4; y += 2) for (let x = 2; x < W - 2; x += 2) {
  if (L.ground[y * W + x] !== 'dirt' || !farFromLamps(x, y, 9)) continue;
  for (const [ax, ay] of [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]] as [number, number][]) {
    if (!/^grass/.test(L.ground[ay * W + ax] ?? '')) continue;
    const got = buy(LAMPS[(x + y) % LAMPS.length], [[ax, ay]]);
    if (got) { lampAt.push([ax, ay]); lampN++; break; }
  }
}
// 광장 화로 네 귀퉁이, 우물 광장 둘
for (const [dx, dy] of [[-10, -7], [10, -7], [-10, 6], [10, 6]] as [number, number][]) if (buy('brazier', area(mx + dx - 1, my + dy - 1, mx + dx + 1, my + dy + 1, [mx + dx, my + dy]))) lampN++;
for (const [dx, dy] of [[-7, -3], [7, 3]] as [number, number][]) if (buy('brazier', area(wx + dx - 1, wy + dy - 1, wx + dx + 1, wy + dy + 1, [wx + dx, wy + dy]))) lampN++;
// 모닥불: 물가 모래밭 몇 곳, 성 안마당
let fires = 0;
for (let y = 40; y < H - 3 && fires < 4; y += 5) for (let x = 5; x < W - 5 && fires < 4; x += 11) {
  if (L.ground[y * W + x] === 'sand' && buy('campfire', [[x, y]])) fires++;
}
if (buy('campfire', area(CR.x0 + 6, CR.y0 + 6, CR.x1 - 6, CR.y1 - 6, [Math.round((CR.x0 + CR.x1) / 2), CR.y0 + 10]))) fires++;
console.log('불빛', lampN, '모닥불', fires);
// 광장 가장자리: 벤치, 꽃밭, 화분 나무, 통 무더기
for (let k = 0; k < 14; k++) {
  const a = rnd() * Math.PI * 2;
  const r = 9 + rnd() * 3;
  const id = ['bench_garden', 'flower_bed', 'potted_tree', 'barrel_group', 'crate_stack', 'bush_round', 'lamp_post'][k % 7];
  if (buy(id, [[Math.round(mx + Math.cos(a) * r * 1.3), Math.round(my + Math.sin(a) * r * 0.8)]])) props++;
}
for (const [id, dx, dy] of [['bench_garden', -3, 2], ['bench_garden', 2, 2], ['bench_garden', -1, -2], ['flower_bed', -5, 0], ['flower_bed', 4, 0], ['potted_tree', -6, -3], ['potted_tree', 6, -3], ['potted_tree', -6, 4], ['potted_tree', 6, 4], ['well_small', 8, 3]] as [string, number, number][]) if (DEFS[id] && buy(id, area(mx + dx - 1, my + dy - 1, mx + dx + 1, my + dy + 1, [mx + dx, my + dy]))) props++;
console.log('생활 소품', props);

// ---------------------------------------------------------------- 장소/구역 정의
interface Place { id: string; kind: string; nameKey: string; rect: [number, number, number, number]; anchor: [number, number]; spread: number; hours?: [number, number]; estateMin: string | null }
const P = (id: string, rect: [number, number, number, number], anchor: [number, number], spread: number, hours?: [number, number], estateMin: string | null = null): Place =>
  ({ id, kind: id, nameKey: `place.${id}`, rect, anchor, spread, ...(hours ? { hours } : {}), estateMin });
const mid = (r: [number, number, number, number]): [number, number] => [Math.round((r[0] + r[2]) / 2), Math.round((r[1] + r[3]) / 2)];
const R = (t: string, fb: [number, number, number, number]) => tagRect[t] ?? fb;
const places: Place[] = [
  P('market', [mx - 12, my - 8, mx + 12, my + 7], [mx, my + 2], 1.5, [6, 18]),
  P('church', R('church', [78, 14, 94, 26]), mid(R('church', [78, 14, 94, 26])), 0.8),
  P('inn', R('inn', [28, 50, 44, 60]), mid(R('inn', [28, 50, 44, 60])), 1.5, [10, 24]),
  P('castle', [CR.x0, CR.y0, CR.x1, CR.y1 - 8], [157, CR.y0 + 8], 0.6, [8, 18], 'knight'),
  P('guild_hall', R('guild_hall', [66, 40, 80, 50]), mid(R('guild_hall', [66, 40, 80, 50])), 1.2, [8, 20]),
  P('mill', [millC[0] - 6, millC[1] - 5, millC[0] + 6, millC[1] + 2], millC, 1, [6, 18]),
  P('craft_street', [cs[0] - 8, cs[1] - 6, cs[0] + 8, cs[1] + 6], cs, 1.2, [7, 19]),
  P('bathhouse', R('bathhouse', [4, 92, 16, 102]), mid(R('bathhouse', [4, 92, 16, 102])), 2, [7, 21]),
  P('well_square', [wx - 8, wy - 6, wx + 8, wy + 6], [wx, wy], 2),
  P('monastery', R('chapel', [146, 18, 156, 28]), mid(R('chapel', [146, 18, 156, 28])), 0.6, [6, 20]),
  P('forest_river', [0, 98, 60, 110], [24, 104], 0.5),
  P('tourney_ground', [CR.x0 + 2, CR.y1 - 8, CR.x1 - 2, CR.y1 - 2], [157, CR.y1 - 5], 1.5),
];
const zones = [
  { id: 'lord_fields', kind: 'fields', rect: [0, 0, 199, 9], nameKey: 'zone.lord_fields' },
  { id: 'pasture', kind: 'pasture', rect: [120, 0, 199, 9], nameKey: 'zone.pasture' },
  { id: 'graveyard', kind: 'graveyard', rect: [ch[2] + 1, ch[1], ch[2] + 10, ch[3]], nameKey: 'zone.graveyard' },
  { id: 'river', kind: 'river', rect: [40, 40, 199, 112], nameKey: 'zone.river' },
];

// ---------------------------------------------------------------- 빈 부지 (집 지을 풀밭) + 시작 부지
function freeRect(w: number, h: number, near: [number, number]): [number, number, number, number] | null {
  const g = sim.world.grid;
  let best: [number, number, number, number] | null = null;
  let bd = 1e9;
  for (let y = 14; y < 100 - h; y++) for (let x = 2; x < 188 - w; x++) {
    let ok = true;
    for (let yy = y; yy < y + h && ok; yy++) for (let xx = x; xx < x + w && ok; xx++) {
      const i = g.idx(xx, yy);
      if (!g.walkable(i) || g.floor[i] || L.ground[yy * W + xx] === 'water' || L.shells.some((s) => xx >= s.x && yy >= s.y && xx < s.x + (SH[s.id]?.foot[0] ?? 0) && yy < s.y + (SH[s.id]?.foot[1] ?? 0))) ok = false;
      if (lots.some((l) => xx >= l.rect[0] - 1 && xx <= l.rect[2] + 1 && yy >= l.rect[1] - 1 && yy <= l.rect[3] + 1)) ok = false;
    }
    if (!ok) continue;
    const d = Math.hypot(x - near[0], y - near[1]);
    if (d < bd) { bd = d; best = [x, y, x + w - 1, y + h - 1]; }
  }
  return best;
}
for (const near of [[30, 30], [120, 30], [40, 80], [100, 90]] as [number, number][]) {
  const r = freeRect(8, 6, near);
  if (r) lots.push({ id: `lot_${String(lots.length + 1).padStart(2, '0')}`, kind: 'empty', size: 'small', rect: r, entrance: [r[0] + 4, r[3]], house: null, price: 240 });
}
// 시작: 장터에서 가까운 작은/보통 집
const start = lots.filter((l) => l.kind === 'residential' && l.size !== 'manor').sort((a, b) => Math.hypot(a.entrance[0] - mx, a.entrance[1] - my) - Math.hypot(b.entrance[0] - mx, b.entrance[1] - my))[0];
if (start) start.start = true;

// ---------------------------------------------------------------- 저장 + 검사
const w = sim.world;
const out: LotDef = JSON.parse(JSON.stringify(w.lot));
out.objects = w.objects
  .filter((o) => !['window_opening', 'lot_exit', 'house_fire', 'construction_site'].includes(o.defId))
  .map((o) => {
    const e: LotDef['objects'][number] = { id: o.defId, x: o.x, y: o.y };
    if (o.rot) e.rot = o.rot;
    if (o.variant) e.variant = o.variant;
    return e;
  });
delete out.rows;
delete out.levels;
if (start) out.spawn = { x: start.entrance[0], y: start.entrance[1] };
const town = { id: 'ashford', nameKey: 'town.ashford', lot: out, places, lots, zones };
fs.writeFileSync('src/data/town/ashford.json', JSON.stringify(town) + '\n');
const sim2 = new Simulation(validateSimData(mergedRaw(JSON.parse(fs.readFileSync('src/data/town/ashford.json', 'utf8')).lot) as never), 3);
const warn = sim2.builder!.checkPaths();
const kinds: Record<string, number> = {};
for (const x of warn) kinds[x.kind] = (kinds[x.kind] ?? 0) + 1;
console.log(`ashford v2: 부지 ${lots.length} (빈 ${lots.filter((l) => l.kind === 'empty').length}), 장소 ${places.length}, 물건 ${out.objects.length}, 방 ${sim2.rooms().length}, 엔진 편집 ${ops}, 실패 ${fails.length}, 길 경고 ${JSON.stringify(kinds)}`);
if (fails.length) console.log(fails.slice(0, 12).join('\n'));
if (warn.length) console.log(warn.slice(0, 12).map((x) => `${x.kind}@${x.x},${x.y}${x.uid ? ':' + sim2.world.byUid.get(x.uid)?.defId : ''}`).join(' '));
