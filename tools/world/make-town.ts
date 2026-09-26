/**
 * M6 마을 지도 애쉬포드 (GDD 18-1, artifacts/contracts-m6.md 1~2절).
 *   npx tsx tools/world/make-town.ts
 * 1) 200×150 지형: 서쪽 숲, 동서로 흐르는 강(다리 2), 흙길 + 광장/공방 거리 돌길, 영주 밭(밭 구획), 목초지, 북동 언덕
 * 2) 주거 부지 30 (미리 만든 집 src/data/lots/houses/*.json 복사) + 빈 부지 10, 시작 부지 1 (자유민 농가)
 * 3) 공공 장소 12: 실제 건축 엔진(Builder)에 편집 의도를 넣어 지음 (방 인식, 길 막힘 경고 0) + 카탈로그/마을 기능 물건
 * 4) src/data/town/ashford.json (lot + places + lots + zones), 검수 시트 artifacts/qa/m6/map-*.png
 * 무작위는 시드 RNG 만 (같은 입력 → 같은 지도)
 */
import fs from 'node:fs';
import path from 'node:path';
import { simRaw } from '../data-node';
import { validateSimData, mergeObjectDefs, type BuildData } from '../../src/sim/data/simData';
import { Simulation } from '../../src/sim/sim';
import type { BuildOp, BuildResult } from '../../src/sim/build/builder';
import { Rng } from '../../src/sim/core/rng';
import type { LotDef, ObjectDef } from '../../src/sim/core/types';
import { normalizeLot, slabStride, totalRows } from '../../src/sim/world/lot';
import { Img, load, create, blit, save, text, fillRect } from './png';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
process.chdir(ROOT);

const W = 200;
const H = 150;
const ROWS = totalRows(H);
const N = W * ROWS;
const rng = new Rng(20260926);
const rnd = () => rng.next();
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];

// ---------------------------------------------------------------- data (마을 물건/상호작용은 리드가 로더에서 합치기 전까지 여기서 합침)
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
const fpOf = (id: string, rot = 0) => { const f = DEFS[id].footprint; return rot % 2 ? { w: f.h, h: f.w } : f; };

// ---------------------------------------------------------------- lot arrays
const lot: LotDef = {
  id: 'ashford', w: W, h: H,
  ground: new Array(N).fill(null), floor: new Array(N).fill(null), walls: new Array(N).fill(null),
  openings: [], objects: [], spawn: { x: 22, y: 84 },
  exits: [{ x: 0, y: 40 }, { x: 199, y: 40 }, { x: 110, y: 149 }, { x: 199, y: 100 }],
  roof: { style: 'roof_shingle' },
};
const I = (x: number, y: number) => y * W + x;
const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
const G = (x: number, y: number) => lot.ground[I(x, y)];
const setG = (x: number, y: number, id: string) => { if (inb(x, y)) lot.ground[I(x, y)] = id; };
const fillG = (x0: number, y0: number, x1: number, y1: number, id: string, pred: (x: number, y: number) => boolean = () => true) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inb(x, y) && pred(x, y)) setG(x, y, id);
};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) setG(x, y, 'grass');

/** 칸 예약: 0 빈 풀밭, 1 부지, 2 건물/장소 중심, 3 길/물 (장식 나무를 두지 않음) */
const res = new Uint8Array(W * H);
const reserve = (x0: number, y0: number, x1: number, y1: number, v: number) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inb(x, y)) res[I(x, y)] = Math.max(res[I(x, y)], v); };
/** 미리 놓은 물건 점유 (1층 판) */
const occ = new Uint8Array(W * H);
function canPut(id: string, x: number, y: number, rot = 0, allowRes = false): boolean {
  const f = fpOf(id, rot);
  for (let dy = 0; dy < f.h; dy++) for (let dx = 0; dx < f.w; dx++) {
    const cx = x + dx, cy = y + dy;
    if (!inb(cx, cy) || occ[I(cx, cy)] || lot.walls[I(cx, cy)] || G(cx, cy) === 'water' || G(cx, cy) === 'bridge') return false;
    if (!allowRes && res[I(cx, cy)]) return false;
    if ((lot.exits ?? []).some((e) => e.x === cx && e.y === cy)) return false;
  }
  return true;
}
function addObj(id: string, x: number, y: number, rot = 0, variant?: string, allowRes = false): boolean {
  if (!DEFS[id]) throw new Error(`물건 없음 ${id}`);
  if (!canPut(id, x, y, rot, allowRes)) return false;
  const f = fpOf(id, rot);
  for (let dy = 0; dy < f.h; dy++) for (let dx = 0; dx < f.w; dx++) occ[I(x + dx, y + dy)] = 1;
  const e: LotDef['objects'][number] = { id, x, y };
  if (rot) e.rot = rot;
  if (variant) e.variant = variant;
  lot.objects.push(e);
  return true;
}

// ================================================================= 1. 지형
// 서쪽 숲: 가장자리가 들쭉날쭉한 낙엽 바닥
const forestEdge = (y: number) => 9 + Math.round(1.5 * Math.sin(y / 7) + Math.sin(y / 3.1));
for (let y = 0; y < H; y++) for (let x = 0; x <= forestEdge(y); x++) setG(x, y, 'forest_floor');
// 숲 속 낙엽 덩어리 몇 개 (언덕 아래, 교회 뒤, 동남쪽)
const blobG = (cx: number, cy: number, r: number, id: string) => fillG(cx - r, cy - r, cx + r, cy + r, id, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1);

// 강: 서→동, 북쪽 둑 top(x), 남쪽 둑 bottom(x). 다리/방앗간 자리는 곧게
const top = (x: number) => 91 + ((x >= 24 && x <= 46) || (x >= 124 && x <= 138) || (x >= 170 && x <= 186) ? 1 : 0);
const bottom = (x: number) => 96 + ((x >= 30 && x <= 52) || (x >= 160 && x <= 178) ? 1 : 0);
for (let x = 0; x < W; x++) { fillG(x, top(x), x, bottom(x), 'water'); reserve(x, top(x), x, bottom(x), 3); }
// 모래 강가 (남쪽 둑 두 줄, 북쪽 둑 서쪽 한 곳)
for (const [a, b] of [[13, 24], [55, 70], [120, 132], [182, 194]]) for (let x = a; x <= b; x++) fillG(x, bottom(x) + 1, x, 98, 'sand');
for (let x = 14; x <= 22; x++) fillG(x, top(x) - 2, x, top(x) - 1, 'sand');

// 길 (흙길). R1 동서 큰길, R4 강 남쪽 길, 주거 줄 길 R0 R2 R3 R5 R6 R7, 큰길(남북) x 109..111, 동쪽 길 x 147..149
const road = (x0: number, y0: number, x1: number, y1: number, id = 'dirt') => { fillG(x0, y0, x1, y1, id, (x, y) => G(x, y) !== 'water' && G(x, y) !== 'bridge'); reserve(x0, y0, x1, y1, 3); };
road(0, 39, 199, 41);
road(0, 99, 199, 101);
road(10, 16, 87, 17);            // R0 (북서 주거)
road(86, 16, 87, 41);            // R0 → R1 샛길
road(10, 65, 95, 66);            // R2
road(10, 83, 79, 84);            // R3
road(80, 118, 199, 119);         // R5
road(80, 136, 199, 137);         // R6
road(80, 148, 199, 149);         // R7
road(109, 37, 111, 149);         // 큰길 (성문 → 광장 → 다리 → 남쪽 출구)
road(147, 42, 149, 101);         // 동쪽 길 (교회/목욕탕 → 다리 → R4)
road(112, 89, 199, 90);          // 북쪽 둑길 (공방 거리 상인 집, 목욕탕, 수도원)
// 돌길: 광장, 공방 거리 골목, 성 앞 큰길, 광장 앞 R1
road(95, 42, 125, 64, 'road_stone');
road(95, 77, 117, 78, 'road_stone');
road(109, 37, 111, 90, 'road_stone');
road(88, 39, 150, 41, 'road_stone');
// 다리: 물 칸 + 양쪽 끝 한 칸
for (const bx of [109, 147]) for (let x = bx; x <= bx + 2; x++) { for (let y = top(x) - 1; y <= bottom(x) + 1; y++) setG(x, y, 'bridge'); reserve(x, top(x) - 1, x, bottom(x) + 1, 3); }

// 영주 밭: 밭흙 + 밭 구획 (3×2) 9×9
fillG(12, 119, 51, 148, 'field_soil');
reserve(12, 119, 51, 148, 2);
const fieldPlots: [number, number][] = [];
for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) fieldPlots.push([13 + i * 4, 120 + j * 3]);

// 언덕 (북동): 자갈 덩어리 + 바위/소나무
for (const [cx, cy, r] of [[184, 6, 4], [192, 14, 5], [181, 19, 3], [196, 3, 3]]) blobG(cx, cy, r, 'gravel');
blobG(188, 10, 2, 'dirt');
// 숲 낙엽 덩어리 (동남 작은 숲, 방앗간 뒤 풀숲)
blobG(197, 128, 3, 'forest_floor');
blobG(197, 142, 3, 'forest_floor');

// ================================================================= 2. 부지
interface TownLot { id: string; kind: 'residential' | 'empty'; size: string; rect: [number, number, number, number]; entrance: [number, number]; house: string | null; price: number; start?: boolean }
const lots: TownLot[] = [];
const housesList = (JSON.parse(fs.readFileSync('src/data/houses.json', 'utf8')) as { houses: { id: string; price: number }[] }).houses;
const housePrice = new Map(housesList.map((h) => [h.id, h.price]));
const sizeOf = (w: number) => (w <= 12 ? 'small' : w <= 20 ? 'medium' : w <= 28 ? 'large' : 'manor');
const EMPTY_PRICE: Record<string, number> = { small: 240, medium: 480, large: 960, manor: 3840 };
const EMPTY_WH: Record<string, [number, number]> = { small: [12, 10], medium: [20, 16], large: [28, 22], manor: [40, 30] };

/** 집 부지 복사: 층 판마다 옮김 (1층 흙길/자갈만 덮어씀, 풀은 마을 풀) */
function placeHouse(houseId: string, px: number, bottomY: number, start = false): TownLot {
  const src = normalizeLot(JSON.parse(fs.readFileSync(`src/data/lots/houses/${houseId}.json`, 'utf8')) as LotDef);
  const py = bottomY - src.h + 1;
  const ss = slabStride(src.h), ds = slabStride(H);
  for (let s = 0; s < 4; s++) for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const si = (s * ss + y) * src.w + x;
    const di = (s * ds + py + y) * W + px + x;
    if (s === 0 && src.ground[si] && src.ground[si] !== 'grass') lot.ground[di] = src.ground[si];
    if (src.floor[si]) lot.floor[di] = src.floor[si];
    if (src.walls[si]) lot.walls[di] = src.walls[si];
  }
  const mapY = (y: number) => Math.floor(y / ss) * ds + py + (y % ss);
  for (const o of src.openings) lot.openings.push({ ...o, x: o.x + px, y: mapY(o.y) });
  for (const o of src.objects) {
    const e = { ...o, x: o.x + px, y: mapY(o.y) };
    lot.objects.push(e);
    if (e.y < H) { const f = fpOf(e.id, e.rot ?? 0); for (let dy = 0; dy < f.h; dy++) for (let dx = 0; dx < f.w; dx++) if (inb(e.x + dx, e.y + dy)) occ[I(e.x + dx, e.y + dy)] = 1; }
  }
  reserve(px, py, px + src.w - 1, py + src.h - 1, 1);
  const ex = px + (src.exits?.[0]?.x ?? Math.floor(src.w / 2));
  const l: TownLot = { id: '', kind: 'residential', size: sizeOf(src.w), rect: [px, py, px + src.w - 1, py + src.h - 1], entrance: [ex, py + src.h - 1], house: houseId, price: housePrice.get(houseId) ?? 0 };
  if (start) l.start = true;
  lots.push(l);
  return l;
}
function placeEmpty(size: string, px: number, py: number, entrance: 'top' | 'bottom'): TownLot {
  const [w, h] = EMPTY_WH[size];
  const ex = px + Math.floor(w / 2);
  const l: TownLot = { id: '', kind: 'empty', size, rect: [px, py, px + w - 1, py + h - 1], entrance: [ex, entrance === 'top' ? py : py + h - 1], house: null, price: EMPTY_PRICE[size] };
  reserve(px, py, px + w - 1, py + h - 1, 1);
  // 빈 부지 표시: 모서리 말뚝 대신 이정표 하나 (길 쪽 모서리)
  lots.push(l);
  return l;
}
// 북서 주거 (R0 위 / R1 위)
placeHouse('farmhouse_1', 12, 15); placeHouse('workshop_house_1', 32, 15); placeHouse('farmhouse_2', 52, 15); placeHouse('hut_1', 72, 15);
placeHouse('workshop_house_2', 12, 38); placeHouse('farmhouse_3', 32, 38); placeHouse('workshop_house_3', 52, 38); placeHouse('hut_2', 72, 38);
placeEmpty('small', 72, 18, 'top');
// 서쪽 주거 (R2 위 큰 집 둘, R3 위 농가 셋 = 시작 부지 포함)
placeHouse('manor_1', 12, 64); placeHouse('merchant_house_1', 40, 64);
placeHouse('farmhouse_4', 12, 82, true); placeHouse('farmhouse_1', 32, 82); placeHouse('workshop_house_4', 52, 82);
// 공방 거리 상인 집 (1층 가게), 영주 가문 성 거주동, 언덕 오두막, 수도원 아래 오두막
placeHouse('merchant_house_2', 118, 88);
placeHouse('castle_hall_1', 136, 31);
placeHouse('hut_3', 184, 36);
placeHouse('hut_4', 182, 87);
// 남쪽 가운데 (우물가 아래)
placeHouse('farmhouse_2', 80, 135); placeHouse('hut_1', 80, 147); placeHouse('hut_2', 92, 147);
// 남동 주거 두 줄
for (const [bot, ids] of [[117, ['farmhouse_3', 'workshop_house_1', 'farmhouse_4', 'hut_3', 'hut_4']], [135, ['farmhouse_1', 'workshop_house_2', 'farmhouse_2', 'hut_1', 'hut_2']]] as [number, string[]][]) {
  [112, 132, 152, 172, 184].forEach((x, k) => placeHouse(ids[k], x, bot));
}
// 빈 부지: 남서 R4 아래 중간 둘, 남동 R6 아래 작은 것 일곱
placeEmpty('medium', 12, 102, 'top'); placeEmpty('medium', 32, 102, 'top');
for (let k = 0; k < 7; k++) placeEmpty('small', 112 + k * 12, 138, 'top');
lots.forEach((l, i) => { l.id = `lot_${String(i + 1).padStart(2, '0')}`; });
// 부지 입구 → 길 잇기 (입구에서 바깥쪽으로 길을 만날 때까지)
for (const l of lots) {
  const [ex, ey] = l.entrance;
  const dir = ey === l.rect[1] && l.kind === 'empty' ? -1 : 1;
  for (let y = ey + dir; inb(ex, y) && y !== ey + dir * 12; y += dir) {
    const g = G(ex, y);
    if (g === 'dirt' || g === 'road_stone' || g === 'gravel' || g === 'bridge' || g === 'water') break;
    setG(ex, y, 'dirt');
    reserve(ex, y, ex, y, 3);
  }
}

// ================================================================= 3. 장소 자리 (지형/예약만, 건물은 엔진으로)
interface Place { id: string; kind: string; nameKey: string; rect: [number, number, number, number]; anchor: [number, number]; spread: number; hours?: [number, number]; estateMin: string | null; setup?: { id: string; x: number; y: number; rot?: number }[] }
const P = (id: string, rect: [number, number, number, number], anchor: [number, number], spread: number, hours?: [number, number], estateMin: string | null = null): Place =>
  ({ id, kind: id, nameKey: `place.${id}`, rect, anchor, spread, ...(hours ? { hours } : {}), estateMin });
const places: Place[] = [
  P('market', [95, 42, 125, 64], [110, 57], 1.5, [6, 18]),
  P('church', [150, 42, 176, 63], [163, 52], 0.8),
  P('inn', [79, 43, 94, 64], [84, 50], 1.5, [10, 24]),
  P('castle', [88, 0, 176, 38], [107, 10], 0.6, [8, 18], 'knight'),
  P('guild_hall', [127, 42, 146, 64], [136, 51], 1.2, [8, 20]),
  P('mill', [77, 67, 94, 90], [85, 85], 1, [6, 18]),
  P('craft_street', [95, 66, 146, 90], [112, 78], 1.2, [7, 19]),
  P('bathhouse', [150, 78, 176, 89], [160, 85], 2, [7, 21]),
  P('well_square', [80, 102, 107, 117], [94, 111], 2),
  P('monastery', [178, 42, 199, 76], [188, 59], 0.6, [6, 20]),
  P('forest_river', [0, 84, 60, 98], [30, 88], 0.5),
  P('tourney_ground', [53, 102, 78, 124], [65, 110], 1.5),
];
const zones = [
  { id: 'forest_west', kind: 'forest', rect: [0, 0, 11, 149], nameKey: 'zone.forest_west' },
  { id: 'river', kind: 'river', rect: [0, 89, 199, 98], nameKey: 'zone.river' },
  { id: 'lord_fields', kind: 'fields', rect: [12, 119, 51, 148], nameKey: 'zone.lord_fields' },
  { id: 'pasture', kind: 'pasture', rect: [53, 126, 78, 148], nameKey: 'zone.pasture' },
  { id: 'hills', kind: 'hills', rect: [177, 0, 199, 24], nameKey: 'zone.hills' },
  { id: 'graveyard', kind: 'graveyard', rect: [150, 64, 176, 77], nameKey: 'zone.graveyard' },
];
// 장소 바닥
fillG(106, 17, 114, 36, 'gravel');               // 성 안뜰: 성문 → 본성 자갈길
fillG(92, 17, 131, 19, 'gravel');                // 본성 앞마당
fillG(118, 21, 131, 34, 'dirt');                 // 훈련장
fillG(82, 103, 105, 116, 'gravel');              // 우물가
fillG(69, 44, 77, 62, 'flowers', (x, y) => (x - 73) ** 2 / 12 + (y - 51) ** 2 / 36 < 1); // 작은 쉼터 꽃밭
fillG(56, 111, 76, 114, 'dirt');                 // 마상시합 달리는 길
fillG(162, 59, 164, 66, 'gravel');               // 교회 문 → 묘지 문
fillG(180, 56, 197, 57, 'gravel');               // 수도원 앞
fillG(180, 59, 191, 65, 'field_soil');           // 수도원 약초원 밭흙
fillG(186, 58, 186, 74, 'gravel');               // 약초원 가운데 길
fillG(78, 81, 79, 88, 'dirt');                   // 방앗간 문 앞
// 장소 중심 예약 (장식 나무가 들어오지 않게)
for (const p of places) if (!['forest_river', 'tourney_ground'].includes(p.id)) reserve(p.rect[0], p.rect[1], p.rect[2], p.rect[3], 2);
reserve(53, 102, 78, 124, 2);
reserve(53, 126, 78, 148, 2);
reserve(66, 43, 78, 63, 2);
for (const z of zones) if (!['forest', 'river', 'hills'].includes(z.kind)) reserve(z.rect[0], z.rect[1], z.rect[2], z.rect[3], 2);

// ================================================================= 4. 미리 놓는 장식/자연 (엔진 밖, 겹침만 확인)
// 밭 구획
for (const [x, y] of fieldPlots) if (!addObj('field_plot', x, y, 0, undefined, true)) throw new Error(`밭 ${x},${y}`);
addObj('scarecrow', 30, 132, 0, undefined, true) || addObj('scarecrow', 30, 131, 0, undefined, true);
// 낚시터 (막지 않음): 북쪽 둑 rot 2 (물이 남쪽), 남쪽 둑 rot 0
const fishing: [number, number, number][] = [[16, top(16) - 1, 2], [28, top(28) - 1, 2], [44, top(44) - 1, 2], [18, bottom(18) + 1, 0], [58, bottom(58) + 1, 0], [66, bottom(66) + 1, 0], [126, bottom(126) + 1, 0], [188, bottom(188) + 1, 0]];
for (const [x, y, r] of fishing) { if (!addObj('fishing_spot', x, y, r, undefined, true)) throw new Error(`낚시터 ${x},${y}`); reserve(x - 1, y - 1, x + 1, y + 1, 2); }
// 들풀 약초 (숲)
const herbs: [number, number][] = [[3, 86], [7, 80], [2, 24], [5, 57], [3, 72], [4, 112], [6, 128], [2, 141]];
for (const [x, y] of herbs) { if (!addObj('herb_patch_wild', x, y, 0, undefined, true)) throw new Error(`약초 ${x},${y}`); reserve(x - 1, y - 1, x + 2, y + 2, 2); }
// 숲: 지터 격자에 나무 (소나무/전나무/참나무/피나무), 쓰러진 통나무, 버섯
const TREES_FOREST = ['tree_pine', 'tree_fir', 'tree_oak', 'tree_pine_young', 'tree_linden', 'tree_oak_tall', 'tree_elm', 'tree_maple'];
for (let gy = 0; gy < H; gy += 3) for (let gx = 0; gx < 12; gx += 3) {
  const x = gx + Math.floor(rnd() * 2), y = gy + Math.floor(rnd() * 2);
  if (x > forestEdge(y) - 1 || rnd() < 0.18) continue;
  if (!addObj(pick(TREES_FOREST), x, y)) addObj(pick(['bush', 'mushrooms', 'stump', 'rock_small']), x, y);
}
for (const [x, y] of [[4, 34], [7, 104], [2, 120], [8, 60]]) addObj('log_fallen', x, y);
// 언덕: 바위, 소나무, 그루터기
for (let k = 0; k < 60; k++) {
  const x = 177 + Math.floor(rnd() * 22), y = Math.floor(rnd() * 25);
  addObj(pick(['rock_big', 'rock_small', 'rock_small', 'tree_pine', 'tree_fir', 'stump', 'bush']), x, y);
}
// 들판/길가 나무 (빈 풀밭만): 참나무, 느릅나무, 사과 장식 나무, 덤불, 들꽃
const TREES_OPEN = ['tree_oak', 'tree_elm', 'tree_linden', 'tree_maple', 'tree_young', 'tree_apple_deco', 'bush', 'bush_round', 'wildflowers', 'wildflowers_white', 'bush_berry'];
for (let k = 0; k < 900; k++) {
  const x = 12 + Math.floor(rnd() * 188), y = Math.floor(rnd() * H);
  const g = G(x, y);
  if (g !== 'grass' && g !== 'flowers') continue;
  // 길/부지 바로 옆은 비움 (한 칸 여유)
  let near = false;
  for (let dy = -1; dy <= 2 && !near; dy++) for (let dx = -1; dx <= 2 && !near; dx++) if (inb(x + dx, y + dy) && res[I(x + dx, y + dy)]) near = true;
  if (near) continue;
  addObj(pick(TREES_OPEN), x, y);
}
// 동남 작은 숲
for (let k = 0; k < 16; k++) addObj(pick(['tree_pine', 'tree_oak', 'tree_fir', 'bush']), 194 + Math.floor(rnd() * 5), 122 + Math.floor(rnd() * 24));

// ================================================================= 5. 엔진으로 공공 장소 짓기
fs.mkdirSync('artifacts/qa/m6', { recursive: true });
const t0 = Date.now();
const data = validateSimData(mergedRaw(lot) as never);
const sim = new Simulation(data, 7);
sim.addPerson('목수', lot.spawn.x + 0.5, lot.spawn.y + 0.5, { estate: 'noble' });
sim.econ!.account(1)!.money = 100_000_000;
const builder = sim.builder!;
const fails: string[] = [];
let ops = 0;
function B(op: BuildOp, must = true): BuildResult {
  const r = sim.apply({ kind: 'build', op }) as BuildResult;
  ops++;
  if (!r.ok && must) fails.push(`${op.op} ${JSON.stringify(op)}: ${r.reason}`);
  return r;
}
/** 물건 사서 놓기: 후보 칸을 차례로, 길 막힘 경고가 새로 생기면 되팔고 다음 칸 */
function buy(defId: string, cands: [number, number][], rot = 0, variant?: string, must = true): boolean {
  if (!sim.data.objects[defId]) throw new Error(`물건 없음 ${defId}`);
  const base = builder.lastWarnings.length;
  for (const [x, y] of cands) {
    if (builder.canPlace(defId, x, y, rot)) continue;
    const r = B({ op: 'buy', defId, x, y, rot, variant }, false);
    if (!r.ok) continue;
    if (builder.lastWarnings.length <= base) return true;
    B({ op: 'sell', uid: r.uid! }, false);
  }
  if (must) fails.push(`buy ${defId} @${JSON.stringify(cands.slice(0, 2))}`);
  return false;
}
/** 네모 안 칸들, 기준점에서 가까운 순 */
function area(x0: number, y0: number, x1: number, y1: number, near: [number, number] = [x0, y0]): [number, number][] {
  const out: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out.sort((a, b) => Math.abs(a[0] - near[0]) + Math.abs(a[1] - near[1]) * 1.01 - (Math.abs(b[0] - near[0]) + Math.abs(b[1] - near[1]) * 1.01));
}
const at = (x: number, y: number): [number, number][] => [[x, y]];

interface Bld { x0: number; y0: number; x1: number; y1: number; wall: string; floor: string; inner?: [number, number, number, number][]; innerDoors?: [number, number][]; doors: [number, number, string][]; win: string; noWin?: [number, number][] }
/** 건물마다 어울리는 지붕 (엔진은 부지당 지붕 재질 하나: 리드가 건물별 지붕을 지원하면 쓰도록 ashford.json roofHints 로 넘김) */
const roofHints: { rect: [number, number, number, number]; style: string }[] = [];
const ROOF_BY_WALL: Record<string, string> = { wall_ashlar: 'roof_slate', wall_stone_white: 'roof_slate', wall_stone: 'roof_tile', wall_timber: 'roof_shingle', wall_plank: 'roof_thatch' };
function building(b: Bld) {
  roofHints.push({ rect: [b.x0, b.y0, b.x1, b.y1], style: ROOF_BY_WALL[b.wall] ?? 'roof_shingle' });
  B({ op: 'room', x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, style: b.wall, floor: b.floor });
  for (const [a, c, d, e] of b.inner ?? []) B({ op: 'wall', x0: a, y0: c, x1: d, y1: e, style: b.wall });
  for (const [x, y] of b.innerDoors ?? []) B({ op: 'opening', x, y, kind: 'door', variant: 'door_ledged' });
  for (const [x, y, v] of b.doors) B({ op: 'opening', x, y, kind: 'door', variant: v });
  // 창: 남북 벽 3칸마다 (모서리, 문 옆, 칸막이 옆 피함)
  const bad = (x: number, y: number) =>
    b.doors.some(([dx, dy]) => Math.abs(dx - x) <= 1 && dy === y) ||
    (b.inner ?? []).some(([a, , d]) => a === d && Math.abs(a - x) <= 1) ||
    (b.noWin ?? []).some(([nx, ny]) => nx === x && ny === y);
  for (const wy of [b.y0, b.y1]) for (let x = b.x0 + 2; x <= b.x1 - 2; x += 3) if (!bad(x, wy)) B({ op: 'opening', x, y: wy, kind: 'window', variant: b.win }, false);
  for (const wx of [b.x0, b.x1]) for (let y = b.y0 + 3; y <= b.y1 - 3; y += 4) if (!b.doors.some(([dx, dy]) => dx === wx && Math.abs(dy - y) <= 1)) B({ op: 'opening', x: wx, y, kind: 'window', variant: b.win }, false);
  if (builder.lastWarnings.length) fails.push(`building ${b.x0},${b.y0}: ${JSON.stringify(builder.lastWarnings.slice(0, 3))}`);
}
const fence = (x0: number, y0: number, x1: number, y1: number, style: string) => B({ op: 'wall', x0, y0, x1, y1, style });

// ---- 영주의 성: 돌담(울짱 돌) + 본성(대전 + 경비실) + 안뜰
fence(89, 1, 133, 1, 'fence_stone');
fence(89, 1, 89, 37, 'fence_stone');
fence(133, 1, 133, 37, 'fence_stone');
fence(89, 37, 108, 37, 'fence_stone');
fence(112, 37, 133, 37, 'fence_stone');
building({ x0: 97, y0: 3, x1: 125, y1: 16, wall: 'wall_ashlar', floor: 'floor_tile_check', inner: [[117, 3, 117, 16]], innerDoors: [[117, 10]], doors: [[107, 16, 'door_arch'], [121, 16, 'door_studded']], win: 'win_glass' });
buy('lord_throne', at(106, 4));
buy('rug_red_gold', area(105, 7, 108, 12, [106, 8]), 0, undefined, false);
for (const x of [99, 111]) for (const y of [10, 13]) { buy('table_trestle', area(x, y, x + 2, y, [x, y])); buy('bench', area(x, y - 1, x + 2, y - 1, [x, y - 1])); }
for (const [x, y] of [[98, 4], [115, 4], [98, 14], [115, 14]]) buy(pick(['candelabra_floor', 'candelabra_iron']), area(x - 1, y - 1, x + 1, y + 1, [x, y]), 0, undefined, false);
for (const x of [100, 103, 110, 113]) buy('tapestry', at(x, 3), 0, undefined, false);
buy('heraldic_banner', area(98, 3, 116, 3, [104, 3]), 0, undefined, false);
buy('weapon_rack', area(118, 4, 124, 5, [119, 4])); buy('armor_rack', area(118, 4, 124, 5, [123, 4]), 0, undefined, false);
buy('bed_straw', area(118, 11, 124, 14, [118, 12])); buy('bed_straw', area(118, 11, 124, 14, [120, 12]));
buy('dining_table', area(119, 7, 123, 8, [120, 7])); buy('stool', area(119, 8, 123, 9, [120, 9]));
buy('chest_clothes', area(118, 12, 124, 15, [124, 15]));
// 안뜰: 마구간(널벽), 우물, 훈련장(과녁, 무기대, 짚단), 나무, 가로등
building({ x0: 91, y0: 25, x1: 102, y1: 33, wall: 'wall_plank', floor: 'floor_straw', doors: [[96, 25, 'door_barn']], win: 'win_shutter' });
buy('trough_hay', area(92, 30, 96, 32, [92, 32])); buy('trough_water', area(97, 30, 101, 32, [99, 32]));
buy('hay_bales', area(92, 26, 95, 28, [92, 26])); buy('straw_bedding', area(98, 26, 101, 28, [100, 26]), 0, undefined, false);
for (const x of [93, 95, 99, 101]) buy('hitching_post', area(x, 22, x, 23, [x, 23]), 0, undefined, false);
buy('well_stone', area(102, 20, 104, 22, [103, 21]));
for (const x of [120, 123, 126, 129]) buy('archery_target', area(x, 22, x + 1, 23, [x, 22]));
buy('weapon_rack', area(119, 31, 124, 33, [120, 32])); buy('barrel_swords', area(126, 31, 130, 33, [127, 32]), 0, undefined, false);
buy('hay_bale_round', area(126, 27, 130, 29, [128, 27]), 0, undefined, false);
buy('bench_garden', area(115, 25, 116, 28, [115, 26]), 0, undefined, false);
for (const [x, y] of [[92, 4], [92, 13], [128, 5], [128, 12], [104, 30], [96, 35], [124, 35]]) buy(pick(['tree_oak', 'tree_linden', 'tree_elm']), area(x, y, x + 2, y + 2, [x, y]), 0, undefined, false);
for (const [x, y] of [[105, 35], [115, 35], [105, 20], [115, 20]]) buy('lamp_post', area(x, y, x + 1, y + 1, [x, y]));
buy('heraldic_banner', area(119, 16, 124, 16, [123, 16]), 0, undefined, false);

// ---- 장터 광장: 노점 넷, 알림판, 분수, 긴 의자, 가로등, 짐
buy('market_stall_food', area(97, 44, 100, 46, [97, 45]));
buy('market_stall_cloth', area(102, 44, 105, 46, [102, 45]));
buy('market_stall_tools', area(114, 44, 117, 46, [114, 45]));
buy('market_stall_livestock', area(119, 44, 122, 46, [119, 45]));
buy('notice_board_town', area(98, 57, 101, 59, [99, 58]));
buy('fountain', area(104, 52, 106, 54, [105, 53]));
buy('bench_garden', area(101, 55, 103, 55, [101, 55])); buy('bench_garden', area(116, 55, 118, 55, [116, 55]));
for (const [x, y] of [[96, 43], [124, 43], [96, 63], [124, 63], [108, 50], [112, 50]]) buy('lamp_post', area(x - 1, y - 1, x + 1, y + 1, [x, y]));
buy('crate_stack', area(96, 48, 99, 50, [97, 49]), 0, undefined, false); buy('barrel_group', area(121, 48, 124, 50, [122, 49]), 0, undefined, false);
buy('hay_cart', area(118, 58, 123, 61, [120, 59]), 0, undefined, false);
buy('sacks_pile', area(103, 48, 106, 49, [104, 48]), 0, undefined, false);
for (const [x, y] of [[96, 47], [101, 47], [113, 47], [123, 47], [118, 49]]) buy(pick(['basket_apples', 'basket_roots', 'basket_mixed', 'barrel_open', 'crate_banded', 'sack_open']), area(x, y, x + 1, y + 1, [x, y]), 0, undefined, false);
for (const [x, y] of [[97, 61], [122, 53]]) buy('tree_linden', area(x, y, x + 1, y + 1, [x, y]), 0, undefined, false);
buy('bench_garden', area(107, 55, 109, 56, [108, 56]), 0, undefined, false); buy('bench_garden', area(103, 50, 105, 51, [104, 51]), 0, undefined, false);
buy('stone_pillar', area(117, 60, 119, 62, [118, 61]), 0, undefined, false);
buy('wagon', area(112, 58, 117, 62, [113, 60]), 0, undefined, false);

// ---- 여관 (술청 + 부엌, 흙벽 나무틀)
building({ x0: 79, y0: 44, x1: 94, y1: 55, wall: 'wall_timber', floor: 'floor_wood', inner: [[89, 44, 89, 55]], innerDoors: [[89, 50]], doors: [[84, 55, 'door_ledged']], win: 'win_lattice' });
buy('inn_counter', area(81, 47, 84, 47, [82, 47]));
buy('hearth', area(85, 45, 86, 45, [86, 45]));
for (const x of [80, 81]) buy(pick(['keg_tap', 'barrel_closed', 'keg_small']), at(x, 45), 0, undefined, false);
for (const [tx, ty] of [[80, 51], [85, 51]]) {
  buy('dining_table', area(tx, ty, tx + 1, ty, [tx, ty]));
  buy('bench', area(tx, ty - 1, tx + 1, ty - 1, [tx, ty - 1]));
  buy('stool', area(tx, ty + 1, tx + 2, ty + 1, [tx, ty + 1])); buy('stool', area(tx, ty + 1, tx + 2, ty + 1, [tx + 2, ty + 1]));
}
buy('candlestick', area(80, 53, 88, 54, [88, 54]), 0, undefined, false);
buy('lute', area(80, 44, 88, 44, [81, 44]), 0, undefined, false);
buy('prep_counter', area(90, 45, 93, 45, [90, 45])); buy('cupboard', area(90, 45, 93, 46, [93, 45]));
buy('brew_vat', area(90, 48, 93, 51, [92, 48]), 0, undefined, false); buy('barrel_water', area(90, 52, 93, 54, [93, 54]));
buy('dining_table', area(90, 53, 92, 54, [90, 53]), 0, undefined, false);
buy('sign_ale', area(81, 55, 83, 55, [82, 55]), 0, undefined, false);
buy('bench_garden', area(80, 57, 83, 58, [80, 57])); buy('bench_garden', area(86, 57, 90, 58, [87, 57]));
buy('barrel_pair', area(91, 57, 93, 60, [92, 57]), 0, undefined, false);
// 쉼터 (여관 옆 꽃밭): 나무 한 그루, 긴 의자
buy('tree_linden', area(71, 46, 74, 48, [72, 46]), 0, undefined, false); buy('bench_garden', area(70, 56, 75, 58, [72, 57]), 0, undefined, false);

// ---- 길드 회관
building({ x0: 129, y0: 44, x1: 144, y1: 55, wall: 'wall_stone', floor: 'floor_flagstone', doors: [[136, 55, 'door_studded']], win: 'win_lattice' });
buy('guild_table', area(134, 48, 136, 49, [134, 48]));
for (const [x, y] of [[133, 48], [138, 48], [133, 49], [138, 49]]) buy('chair', at(x, y), 0, undefined, false);
buy('bench', area(134, 51, 136, 51, [134, 51]));
for (const x of [131, 134, 138, 141]) buy('tapestry', at(x, 44), 0, undefined, false);
buy('bookshelf', area(130, 45, 132, 45, [130, 45])); buy('chest_clothes', area(141, 45, 143, 45, [143, 45]));
buy('candlestick', area(140, 52, 143, 54, [143, 54]), 0, undefined, false);
buy('writing_desk', area(140, 47, 143, 50, [141, 48]), 0, undefined, false);
buy('banner_crest', area(130, 44, 143, 44, [137, 44]), 0, undefined, false);
buy('signpost', area(131, 57, 134, 58, [132, 57]), 0, undefined, false);

// ---- 빛의 교회 (흰 돌벽, 스테인드글라스) + 묘지
building({ x0: 152, y0: 43, x1: 174, y1: 58, wall: 'wall_stone_white', floor: 'floor_flagstone', doors: [[163, 58, 'door_arch']], win: 'win_stained' });
buy('church_altar', at(162, 44));
buy('rug_runner', area(163, 47, 163, 56, [163, 50]), 1, undefined, false);
buy('statue_maiden', area(157, 44, 158, 45, [158, 44])); buy('statue_hooded', area(167, 44, 168, 45, [167, 44]));
for (const x of [160, 166]) buy('candle_tall', area(x, 44, x, 46, [x, 45]), 0, undefined, false);
buy('lectern', area(165, 47, 167, 48, [166, 47]));
for (const y of [49, 51, 53, 55]) { buy('church_pew', area(156, y, 158, y, [157, y])); buy('church_pew', area(165, y, 167, y, [166, y])); }
buy('font_stone', area(161, 55, 161, 57, [161, 56]));
for (const [x, y] of [[153, 44], [173, 44]]) buy('offering_bowl_tall', area(x, y, x + 1, y + 1, [x, y]), 0, undefined, false);
// 묘지: 돌담, 북쪽 문(교회 문 앞), 무덤 세 줄
fence(151, 65, 161, 65, 'fence_stone'); fence(165, 65, 175, 65, 'fence_stone');
fence(151, 65, 151, 77, 'fence_stone'); fence(175, 65, 175, 77, 'fence_stone'); fence(151, 77, 175, 77, 'fence_stone');
const gvars = ['round', 'slab', 'tall', 'worn'];
let gk = 0;
for (const y of [67, 70, 73]) for (let x = 153; x <= 173; x += 2) { if (x >= 161 && x <= 165) continue; buy('grave', at(x, y), 0, gvars[(gk++ * 7 + y) % 4], false); }
buy('tree_elm', area(152, 74, 153, 75, [152, 74]), 0, undefined, false); buy('tree_elm', area(172, 74, 173, 75, [173, 74]), 0, undefined, false);
buy('bench_garden', area(162, 75, 164, 76, [162, 75]), 0, undefined, false);

// ---- 공중 증기탕
building({ x0: 152, y0: 79, x1: 170, y1: 88, wall: 'wall_stone', floor: 'floor_tile_red', doors: [[152, 84, 'door_ledged']], win: 'win_shutter' });
for (const x of [154, 159, 164]) buy('bath_tub_public', area(x, 80, x + 1, 81, [x, 80]));
buy('bench', area(155, 86, 158, 87, [155, 86])); buy('bench', area(161, 86, 164, 87, [161, 86]));
buy('barrel_water', area(166, 85, 169, 87, [169, 87])); buy('washbasin', area(166, 85, 169, 87, [168, 85]), 0, undefined, false);
buy('chest_clothes', area(153, 86, 154, 87, [153, 87])); buy('hearth', area(168, 80, 169, 81, [168, 80]), 0, undefined, false);

// ---- 공방 거리: 대장간, 빵집 (상인 집은 부지로 깔림)
building({ x0: 96, y0: 67, x1: 106, y1: 76, wall: 'wall_stone', floor: 'floor_flagstone', doors: [[106, 72, 'door_studded']], win: 'win_shutter' });
buy('forge', area(97, 68, 100, 70, [97, 68])); buy('anvil', area(98, 71, 102, 73, [99, 72]));
buy('workbench', area(102, 68, 105, 69, [103, 68])); buy('barrel_water', area(97, 73, 99, 75, [97, 75]));
buy('grindstone', area(101, 74, 104, 75, [102, 75]), 0, undefined, false); buy('weapon_rack_empty', area(97, 74, 100, 75, [98, 74]), 0, undefined, false);
buy('sign_sword', area(106, 69, 106, 71, [106, 70]), 0, undefined, false);
building({ x0: 96, y0: 79, x1: 106, y1: 88, wall: 'wall_timber', floor: 'floor_tile_red', doors: [[106, 84, 'door_half']], win: 'win_lattice' });
buy('oven', area(97, 80, 100, 81, [97, 80])); buy('prep_counter', area(101, 80, 104, 80, [102, 80]));
buy('cupboard', area(103, 80, 105, 81, [105, 80]));
buy('dining_table', area(102, 84, 104, 85, [102, 84])); buy('bread_basket', area(102, 84, 104, 84, [103, 84]), 0, undefined, false);
buy('barrel_flour', area(97, 86, 99, 87, [97, 87])); buy('sacks_pile', area(97, 84, 100, 85, [97, 84]), 0, undefined, false);
buy('sign_bread', area(106, 81, 106, 83, [106, 81]), 0, undefined, false);
for (const [x, y] of [[113, 67], [113, 88], [107, 77]]) buy('lamp_post', area(x, y, x + 2, y + 1, [x, y]), 0, undefined, false);
buy('crate_stack', area(112, 70, 116, 74, [113, 71]), 0, undefined, false); buy('handcart', area(112, 80, 116, 85, [113, 82]), 0, undefined, false);

// ---- 물레방앗간 (둑 위, 물레방아는 남쪽 벽 앞 물가)
building({ x0: 80, y0: 82, x1: 91, y1: 89, wall: 'wall_timber', floor: 'floor_plank_rough', doors: [[80, 86, 'door_barn']], win: 'win_shutter', noWin: [[83, 89], [86, 89]] });
buy('mill_wheel', at(84, 90));
buy('grindstone', area(84, 84, 87, 85, [85, 84])); buy('barrel_flour', area(81, 83, 83, 84, [81, 83])); buy('barrel_flour', area(81, 83, 83, 84, [82, 83]));
buy('sacks_pile', area(86, 87, 90, 88, [88, 88]), 0, undefined, false); buy('crate_flour', area(88, 83, 90, 84, [90, 83]), 0, undefined, false);
buy('grain_bin', area(89, 85, 90, 86, [90, 85]), 0, undefined, false);
buy('hay_cart', area(82, 70, 90, 78, [84, 74]), 0, undefined, false); buy('sacks_heap', area(82, 70, 90, 78, [88, 78]), 0, undefined, false);
buy('grain_barrels', area(88, 76, 92, 80, [90, 79]), 0, undefined, false); buy('woodpile_logs', area(80, 76, 84, 80, [81, 79]), 0, undefined, false);
buy('tree_oak', area(79, 68, 82, 70, [80, 68]), 0, undefined, false); buy('tree_elm', area(90, 68, 93, 70, [91, 68]), 0, undefined, false);

// ---- 새벽별 수도원: 경당 + 숙소/필사실, 약초원, 과수, 벌통
building({ x0: 180, y0: 43, x1: 197, y1: 55, wall: 'wall_stone', floor: 'floor_flagstone', inner: [[188, 43, 188, 55]], innerDoors: [[188, 49]], doors: [[184, 55, 'door_ledged'], [193, 55, 'door_plank']], win: 'win_lattice' });
buy('church_altar', at(183, 44));
buy('church_pew', area(182, 48, 183, 48, [182, 48])); buy('church_pew', area(182, 51, 183, 51, [182, 51]));
buy('candle_tall', area(181, 44, 181, 46, [181, 44]), 0, undefined, false); buy('statue_hooded', area(187, 44, 187, 45, [187, 44]), 0, undefined, false);
for (const x of [189, 191, 193, 195]) buy('bed_straw', area(x, 44, x, 46, [x, 44]));
buy('bookshelf', area(189, 52, 194, 54, [189, 54])); buy('lectern', area(194, 49, 196, 52, [195, 50]));
buy('scribe_desk', area(190, 49, 193, 50, [191, 49]), 0, undefined, false); buy('chest_clothes', area(195, 53, 196, 54, [196, 54]));
for (let k = 0; k < 6; k++) buy('garden_plot', area(181 + (k % 3) * 4, 60 + Math.floor(k / 3) * 3, 182 + (k % 3) * 4, 60 + Math.floor(k / 3) * 3, [181 + (k % 3) * 4, 60 + Math.floor(k / 3) * 3]));
buy('herb_patch_wild', area(181, 67, 184, 68, [181, 67])); buy('herb_patch_wild', area(186, 67, 189, 68, [186, 67]));
buy('orchard_tree', area(192, 60, 194, 62, [193, 60])); buy('orchard_tree', area(192, 65, 194, 67, [193, 65]));
buy('well', area(196, 59, 197, 62, [196, 60])); buy('beehive_skep', area(191, 70, 196, 72, [192, 71]), 0, undefined, false); buy('beehive_skep', area(191, 70, 196, 72, [195, 71]), 0, undefined, false);
buy('bench_garden', area(181, 72, 186, 74, [182, 72]), 0, undefined, false);
fence(179, 58, 179, 75, 'fence_hedge'); fence(198, 58, 198, 75, 'fence_hedge'); fence(179, 75, 185, 75, 'fence_hedge'); fence(187, 75, 198, 75, 'fence_hedge');

// ---- 우물가 (남쪽 가운데): 우물, 긴 의자, 나무, 물구유, 빨랫줄, 가로등
buy('well', area(92, 108, 94, 110, [93, 108]));
buy('well_small', area(84, 112, 86, 114, [85, 112]), 0, undefined, false);
buy('bench_garden', area(88, 106, 90, 107, [88, 106])); buy('bench_garden', area(97, 106, 99, 107, [97, 106])); buy('bench_garden', area(92, 114, 95, 115, [93, 114]));
buy('trough_water', area(100, 111, 103, 112, [101, 111]), 0, undefined, false);
buy('tree_linden', area(82, 103, 84, 104, [82, 103]), 0, undefined, false); buy('tree_oak', area(103, 103, 105, 104, [104, 103]), 0, undefined, false);
buy('clothesline', area(98, 114, 104, 115, [100, 115]), 0, undefined, false);
for (const [x, y] of [[88, 110], [99, 109]]) buy('lamp_post', area(x, y, x + 1, y + 1, [x, y]), 0, undefined, false);

// ---- 목초지: 나무 울타리 (북쪽 문), 물구유, 건초
fence(53, 126, 64, 126, 'fence_wood'); fence(67, 126, 78, 126, 'fence_wood');
fence(53, 126, 53, 148, 'fence_wood'); fence(78, 126, 78, 148, 'fence_wood'); fence(53, 148, 78, 148, 'fence_wood');
buy('trough_long', area(58, 130, 62, 131, [58, 130])); buy('trough_hay', area(68, 130, 72, 131, [69, 130]));
buy('hay_bale_round', area(56, 140, 60, 144, [57, 142]), 0, undefined, false); buy('hay_shelter', area(70, 140, 76, 146, [72, 142]), 0, undefined, false);
buy('tree_oak', area(64, 136, 66, 138, [65, 137]), 0, undefined, false);

// ---- 마상시합장: 평소 빈 들판 (축제 때 울짱 설치 자리만 setup 에 기록), 이정표
buy('signpost', area(54, 103, 56, 104, [55, 103]), 0, undefined, false);
places.find((p) => p.id === 'tourney_ground')!.setup = [57, 61, 65, 69].map((x) => ({ id: 'tourney_lists', x, y: 112 }));
// 숲과 강가: 쓰러진 통나무 모닥불 자리
buy('campfire', area(34, 86, 37, 88, [35, 87]), 0, undefined, false);
buy('log_fallen', area(38, 86, 41, 88, [39, 86]), 0, undefined, false);

// 지붕 (부지 하나에 지붕 재질 하나: 23-2 자동 지붕)
B({ op: 'roof', style: lot.roof!.style }, false);

const warnings = builder.checkPaths();
console.log(`엔진 편집 ${ops}회, ${((Date.now() - t0) / 1000).toFixed(1)}초, 실패 ${fails.length}, 경고 ${warnings.length}`);
if (fails.length) console.warn(fails.join('\n'));
if (warnings.length) throw new Error(`길 막힘 경고: ${JSON.stringify(warnings.slice(0, 10))}`);

// ================================================================= 6. 내보내기
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
const town = { id: 'ashford', nameKey: 'town.ashford', lot: out, places, lots, zones, roofHints };
fs.mkdirSync('src/data/town', { recursive: true });
fs.writeFileSync('src/data/town/ashford.json', JSON.stringify(town) + '\n');
// 다시 불러와 확인 (저장 → 검증 → 격자 길 확인)
const again = validateSimData(mergedRaw(JSON.parse(fs.readFileSync('src/data/town/ashford.json', 'utf8')).lot) as never);
const sim2 = new Simulation(again, 3);
const w2 = sim2.builder!.checkPaths();
if (w2.length) throw new Error(`다시 불러온 마을 경고 ${w2.length}`);
const counts = {
  residential: lots.filter((l) => l.kind === 'residential').length, empty: lots.filter((l) => l.kind === 'empty').length,
  places: places.length, zones: zones.length, objects: out.objects.length, walls: out.walls.filter(Boolean).length, openings: out.openings.length,
  rooms: sim2.rooms().length,
};
console.log(`ashford: ${JSON.stringify(counts)}`);

// ================================================================= 7. 검수 시트
type Sprite = { image: string; x: number; y: number; w: number; h: number; anchorX: number; anchorY: number; frameDx?: number };
const art = JSON.parse(fs.readFileSync('src/data/artpacks/epic.json', 'utf8')) as {
  tilePx: number; images: Record<string, string>; tiles: Record<string, { image: string; x: number; y: number }>; sprites: Record<string, Sprite>;
  walls: Record<string, { caps?: string[]; capsCut?: string[]; faceCut?: string; doorFrameCut?: string; fence?: boolean }>; objects: Record<string, { default: string; rot?: Record<string, string> }>;
  terrain: Record<string, Record<string, string | string[]>>; floors: Record<string, string[]>; doors: Record<string, { side?: string; closed?: string }>;
};
const T = art.tilePx;
const imgCache = new Map<string, Img>();
const img = (id: string) => { let i = imgCache.get(id); if (!i) { i = load(art.images[id]); imgCache.set(id, i); } return i; };
const hash = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return (h ^ (h >>> 16)) >>> 0; };
function tileRef(id: string) { return art.tiles[id]; }
function groundTile(x: number, y: number) {
  const id = out.ground[I(x, y)] ?? 'grass';
  if (art.tiles[id]) return art.tiles[id];
  const set = art.terrain[id] ?? art.terrain.grass;
  const same = (dx: number, dy: number) => { const nx = Math.min(W - 1, Math.max(0, x + dx)), ny = Math.min(H - 1, Math.max(0, y + dy)); return (out.ground[I(nx, ny)] ?? 'grass') === id; };
  const pk = (k: string) => { const v = set[k]; return typeof v === 'string' ? tileRef(v) : undefined; };
  if (id !== 'grass') {
    const n = !same(0, -1), s = !same(0, 1), e = !same(1, 0), ww = !same(-1, 0);
    const t = n && ww ? pk('nw') : n && e ? pk('ne') : s && ww ? pk('sw') : s && e ? pk('se') : n ? pk('n') : s ? pk('s') : e ? pk('e') : ww ? pk('w')
      : !same(-1, -1) ? pk('inw') : !same(1, -1) ? pk('ine') : !same(-1, 1) ? pk('isw') : !same(1, 1) ? pk('ise') : undefined;
    if (t) return t;
  }
  const c = set.center as string[];
  return tileRef(c[hash(x, y) % c.length]);
}
function drawSpr(o: Img, sid: string | undefined, footX: number, footBottom: number) {
  if (!sid) return;
  const s = art.sprites[sid];
  if (!s) return;
  blit(o, img(s.image), s.x, s.y, s.w, s.h, footX - s.anchorX, footBottom - s.anchorY);
}
/** 1층 판을 1배로 그림 (벽은 낮춘 벽, 지붕 없음 = 안이 보이는 보기) */
function renderMap(): Img {
  const PAD = 3 * T;
  const o = create(W * T, H * T + PAD, [20, 18, 22, 255]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = groundTile(x, y);
    if (t) blit(o, img(t.image), t.x, t.y, T, T, x * T, y * T + PAD, false);
    const f = out.floor[I(x, y)];
    if (f) { const list = art.floors[f]; const ft = list ? art.tiles[list[hash(x, y) % list.length]] : art.tiles[f]; if (ft) blit(o, img(ft.image), ft.x, ft.y, T, T, x * T, y * T + PAD, false); }
  }
  const objsByRow = new Map<number, LotDef['objects']>();
  const flat: LotDef['objects'] = [];
  for (const ob of out.objects) {
    if (ob.y >= H) continue;
    const d = DEFS[ob.id];
    if (!d) continue;
    if (!d.blocks && !d.wallMounted) { flat.push(ob); continue; }
    const f = fpOf(ob.id, ob.rot ?? 0);
    const r = ob.y + f.h - 1;
    if (!objsByRow.has(r)) objsByRow.set(r, []);
    objsByRow.get(r)!.push(ob);
  }
  const drawObj = (ob: LotDef['objects'][number]) => {
    const e = art.objects[ob.variant ? `${ob.id}__${ob.variant}` : ob.id] ?? art.objects[ob.id];
    if (!e) return;
    const f = fpOf(ob.id, ob.rot ?? 0);
    drawSpr(o, e.rot?.[String(ob.rot ?? 0)] ?? e.default, ob.x * T, (ob.y + f.h) * T + PAD);
  };
  for (const ob of flat) drawObj(ob);
  const wallAt = (x: number, y: number) => (inb(x, y) ? out.walls[I(x, y)] : null);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const st = wallAt(x, y);
      if (!st) continue;
      const wd = art.walls[st];
      if (!wd) continue;
      const m = (wallAt(x, y - 1) ? 1 : 0) | (wallAt(x + 1, y) ? 2 : 0) | (wallAt(x, y + 1) ? 4 : 0) | (wallAt(x - 1, y) ? 8 : 0);
      const bottomPx = (y + 1) * T + PAD;
      const door = out.openings.find((p) => p.x === x && p.y === y && p.kind === 'door');
      if (!wallAt(x, y + 1)) drawSpr(o, door && wd.doorFrameCut ? wd.doorFrameCut : wd.faceCut, x * T, bottomPx);
      drawSpr(o, (wd.capsCut ?? wd.caps)?.[m], x * T, bottomPx);
    }
    for (const ob of (objsByRow.get(y) ?? []).sort((a, b) => a.x - b.x)) drawObj(ob);
  }
  return o;
}
const full = renderMap();
const PADPX = 3 * T;
/** 1/k 축소 (칸 평균) */
function shrink(src: Img, k: number, x0 = 0, y0 = 0, w = src.w, h = src.h): Img {
  const o = create(Math.floor(w / k), Math.floor(h / k), [0, 0, 0, 255]);
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = 0; j < k; j += 2) for (let i = 0; i < k; i += 2) { const p = ((y0 + y * k + j) * src.w + x0 + x * k + i) * 4; r += src.data[p]; g += src.data[p + 1]; b += src.data[p + 2]; n++; }
    const q = (y * o.w + x) * 4; o.data[q] = r / n; o.data[q + 1] = g / n; o.data[q + 2] = b / n; o.data[q + 3] = 255;
  }
  return o;
}
function outline(o: Img, x0: number, y0: number, x1: number, y1: number, c: [number, number, number, number], k: number) {
  const X0 = Math.round(x0 * k), Y0 = Math.round(y0 * k), X1 = Math.round((x1 + 1) * k) - 1, Y1 = Math.round((y1 + 1) * k) - 1;
  fillRect(o, X0, Y0, X1 - X0 + 1, 1, c); fillRect(o, X0, Y1, X1 - X0 + 1, 1, c); fillRect(o, X0, Y0, 1, Y1 - Y0 + 1, c); fillRect(o, X1, Y0, 1, Y1 - Y0 + 1, c);
}
function label(o: Img, x: number, y: number, s: string, c: [number, number, number, number]) {
  const w = s.length * 4 + 2;
  fillRect(o, x - 1, y - 1, w, 7, [0, 0, 0, 170]);
  text(o, x, y, s.toUpperCase(), c, 1);
}
// 전체 1/8 (한 칸 = 4px) + 이름표 → 두 배로 키워 읽기 쉽게
const K8 = 1 / 8 * T;
const ov0 = shrink(full, 8, 0, PADPX, W * T, H * T);
const ov = create(ov0.w * 2, ov0.h * 2);
for (let y = 0; y < ov.h; y++) for (let x = 0; x < ov.w; x++) { const s = ((y >> 1) * ov0.w + (x >> 1)) * 4, d = (y * ov.w + x) * 4; ov.data[d] = ov0.data[s]; ov.data[d + 1] = ov0.data[s + 1]; ov.data[d + 2] = ov0.data[s + 2]; ov.data[d + 3] = 255; }
const KS = K8 * 2;
for (const z of zones) outline(ov, z.rect[0], z.rect[1], z.rect[2], z.rect[3], [120, 200, 255, 255], KS);
for (const l of lots) {
  outline(ov, l.rect[0], l.rect[1], l.rect[2], l.rect[3], l.kind === 'empty' ? [255, 255, 255, 255] : l.start ? [255, 60, 60, 255] : [255, 200, 80, 255], KS);
  label(ov, Math.round(l.rect[0] * KS) + 2, Math.round(l.rect[1] * KS) + 2, `${l.id.slice(4)}${l.kind === 'empty' ? ' EMPTY ' + l.size[0] : ' ' + (l.house ?? '').replace('_house', '').replace(/_(\d)/, '$1')}${l.start ? ' START' : ''}`, l.kind === 'empty' ? [255, 255, 255, 255] : [255, 220, 120, 255]);
}
for (const p of places) {
  outline(ov, p.rect[0], p.rect[1], p.rect[2], p.rect[3], [255, 90, 255, 255], KS);
  label(ov, Math.round(p.rect[0] * KS) + 2, Math.round((p.rect[3] + 1) * KS) - 9, p.id, [255, 140, 255, 255]);
  fillRect(ov, Math.round(p.anchor[0] * KS) - 2, Math.round(p.anchor[1] * KS) - 2, 5, 5, [255, 40, 255, 255]);
}
for (const z of zones) label(ov, Math.round(z.rect[0] * KS) + 2, Math.round(z.rect[1] * KS) + 12, `zone ${z.id}`, [140, 210, 255, 255]);
for (const e of lot.exits ?? []) fillRect(ov, Math.round(e.x * KS) - 3, Math.round(e.y * KS) - 3, 7, 7, [60, 255, 60, 255]);
save(ov, 'artifacts/qa/m6/map-overview.png');
// 장소별 1배 캡처 (지붕 없는 보기)
const crops: Record<string, [number, number, number, number]> = {
  market: [93, 40, 127, 66], church: [148, 40, 178, 79], inn: [66, 40, 96, 66], castle: [86, 0, 136, 39], guild_hall: [125, 40, 148, 64],
  mill: [74, 64, 96, 98], craft_street: [93, 64, 148, 99], bathhouse: [146, 76, 178, 99], well_square: [78, 100, 110, 120],
  monastery: [176, 40, 199, 78], forest_river: [0, 80, 62, 102], tourney_ground: [50, 100, 80, 149], residential_nw: [8, 0, 90, 42], residential_se: [108, 100, 199, 149],
};
for (const [id, [x0, y0, x1, y1]] of Object.entries(crops)) {
  const cw = (x1 - x0 + 1) * T, ch = (y1 - y0 + 1) * T + PADPX;
  const c = create(cw, ch);
  blit(c, full, x0 * T, y0 * T, cw, ch, 0, 0, false);
  const sc = cw > 1600 ? shrink(c, 2) : c;
  save(sc, `artifacts/qa/m6/map-${id.replace(/_/g, '-')}.png`);
}
console.log('검수 시트: artifacts/qa/m6/map-overview.png, map-<장소>.png');
