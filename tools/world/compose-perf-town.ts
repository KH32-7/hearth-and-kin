/**
 * M6 성능 측정용 마을 (S5: "PERF.md 에 청크/LOD 측정 먼저"): 미리 만든 집 부지들을 200×150 지도에 격자로 깔고 흙길로 잇기.
 *   npx tsx tools/world/compose-perf-town.ts → src/data/lots/perf_town.json
 */
import fs from 'node:fs';
import path from 'node:path';
import type { LotDef } from '../../src/sim/core/types';
import { normalizeLot, slabStride, totalRows } from '../../src/sim/world/lot';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
process.chdir(ROOT);
const NL = String.fromCharCode(10);
const W = 200;
const H = 150;
const houses = (JSON.parse(fs.readFileSync('src/data/houses.json', 'utf8')) as { houses: { id: string }[] }).houses;
const rows = totalRows(H);
const n = W * rows;
const town: LotDef = {
  id: 'perf_town', w: W, h: H, ground: new Array(n).fill(null), floor: new Array(n).fill(null), walls: new Array(n).fill(null),
  openings: [], objects: [], spawn: { x: 100, y: 146 }, exits: [{ x: 100, y: 149 }], roof: { style: 'roof_thatch' },
};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) town.ground[y * W + x] = 'grass';
// 길: 가로 3줄, 세로 5줄
const road = (x0: number, y0: number, x1: number, y1: number) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < W && y < H) town.ground[y * W + x] = 'dirt';
};
for (const ry of [30, 75, 120]) road(0, ry, W - 1, ry + 1);
for (const rx of [20, 60, 100, 140, 180]) road(rx, 0, rx + 1, H - 1);
// 집 부지를 칸에 깔기
let px = 2;
let py = 2;
let rowH = 0;
let placed = 0;
const lotsOut: { id: string; kind: 'residential'; size: string; rect: [number, number, number, number]; entrance: [number, number]; house: string; price: number; start?: boolean }[] = [];
const order = [...houses, ...houses].slice(0, 36);
for (const h of order) {
  const lot = normalizeLot(JSON.parse(fs.readFileSync(`src/data/lots/houses/${h.id}.json`, 'utf8')) as LotDef);
  if (px + lot.w >= W - 2) {
    px = 2;
    py += rowH + 2;
    rowH = 0;
  }
  if (py + lot.h >= H - 4) break;
  const srcStride = slabStride(lot.h);
  const dstStride = slabStride(H);
  for (let s = 0; s < 4; s++) {
    for (let y = 0; y < lot.h; y++) {
      for (let x = 0; x < lot.w; x++) {
        const si = (s * srcStride + y) * lot.w + x;
        const di = (s * dstStride + py + y) * W + px + x;
        if (s === 0 && lot.ground[si] && lot.ground[si] !== 'grass') town.ground[di] = lot.ground[si];
        if (lot.floor[si]) town.floor[di] = lot.floor[si];
        if (lot.walls[si]) town.walls[di] = lot.walls[si];
      }
    }
  }
  const mapY = (y: number) => {
    const s = Math.floor(y / srcStride);
    return s * dstStride + py + (y % srcStride);
  };
  for (const o of lot.openings) town.openings.push({ ...o, x: o.x + px, y: mapY(o.y) });
  for (const o of lot.objects) town.objects.push({ ...o, x: o.x + px, y: mapY(o.y) });
  // 집 부지 출구 → 마을 길 (부지 아래 가운데에서 가장 가까운 가로 길까지)
  const ex = px + (lot.exits?.[0]?.x ?? Math.floor(lot.w / 2));
  const ey = py + lot.h - 1;
  const nearest = [30, 75, 120].find((ry) => ry > ey) ?? 120;
  road(ex, ey, ex, Math.min(H - 1, nearest));
  lotsOut.push({ id: `lot_${placed + 1}`, kind: 'residential', size: lot.w <= 12 ? 'small' : lot.w <= 20 ? 'medium' : lot.w <= 28 ? 'large' : 'manor', rect: [px, py, px + lot.w - 1, py + lot.h - 1], entrance: [ex, ey], house: h.id, price: 960, ...(placed === 1 ? { start: true } : {}) });
  px += lot.w + 2;
  rowH = Math.max(rowH, lot.h);
  placed++;
}
fs.writeFileSync('src/data/lots/perf_town.json', JSON.stringify(town) + '\n');
// 시험용 마을 정의 (M6 엔진 테스트): 부지 = 깐 집 자리, 장소 = 길가 네모 몇 개, 사람 = 집마다 3~4명
fs.mkdirSync('tests/fixtures', { recursive: true });
fs.writeFileSync('tests/fixtures/perf_town_def.json', JSON.stringify({
  id: 'perf', lot: town,
  places: [
    { id: 'market', kind: 'market', nameKey: 'place.market', rect: [95, 70, 110, 80], anchor: [100, 76], spread: 1.5 },
    { id: 'church', kind: 'church', nameKey: 'place.church', rect: [55, 70, 66, 80], anchor: [60, 76], spread: 0.8 },
    { id: 'inn', kind: 'inn', nameKey: 'place.inn', rect: [135, 70, 146, 80], anchor: [140, 76], spread: 1.5 },
    { id: 'well_square', kind: 'well_square', nameKey: 'place.well_square', rect: [15, 118, 26, 124], anchor: [20, 121], spread: 2 },
  ],
  lots: lotsOut,
  zones: [{ id: 'lord_fields', kind: 'fields', rect: [150, 125, 199, 149] }],
}) + NL);
const people = { households: lotsOut.map((l, i) => ({
  id: `h${i}`, estate: i === 0 ? 'freeman' : ['serf', 'freeman', 'artisan'][i % 3], player: i === 0, lot: l.id,
  members: [
    { id: `p${i}a`, name: `남자${i}`, sex: 'male', stage: 'adult', ageDays: (i * 5) % 20, role: ['farmer', 'smith', 'innkeeper', 'merchant', null][i % 5] },
    { id: `p${i}b`, name: `여자${i}`, sex: 'female', stage: 'young', ageDays: (i * 7) % 20, role: null },
    { id: `p${i}c`, name: `아이${i}`, sex: i % 2 ? 'male' : 'female', stage: 'child', ageDays: i % 10 },
    ...(i % 3 === 0 ? [{ id: `p${i}d`, name: `노인${i}`, sex: 'female', stage: 'elder', ageDays: i % 12 }] : []),
  ],
  relations: [{ a: `p${i}a`, b: `p${i}b`, kind: 'spouse', friendship: 50, romance: 50 }, { a: `p${i}a`, b: `p${i}c`, kind: 'parent' }, { a: `p${i}b`, b: `p${i}c`, kind: 'parent' }],
})) };
fs.writeFileSync('tests/fixtures/perf_people.json', JSON.stringify(people) + NL);
fs.writeFileSync('tests/fixtures/perf_schedules.json', JSON.stringify({ templates: {
  default: { blocks: [{ from: 6, to: 8, at: 'home', do: 'meal' }, { from: 8, to: 12, at: 'market', do: 'shop' }, { from: 12, to: 18, at: 'work' }, { from: 18, to: 21, at: 'home', do: 'meal' }, { from: 21, to: 6, at: 'home', do: 'sleep' }], weekday: { sun: [{ from: 9, to: 11, at: 'church', do: 'mass' }] } },
  child: { blocks: [{ from: 7, to: 20, at: 'well_square' }, { from: 20, to: 7, at: 'home', do: 'sleep' }] },
  elder: { blocks: [{ from: 9, to: 16, at: 'church' }, { from: 16, to: 9, at: 'home', do: 'sleep' }] },
  innkeeper: { blocks: [{ from: 10, to: 23, at: 'inn' }, { from: 23, to: 10, at: 'home', do: 'sleep' }] },
} }) + NL);
console.log(`perf_town: 집 ${placed}채, 물건 ${town.objects.length}, 벽 ${town.walls.filter(Boolean).length}칸, 개구부 ${town.openings.length}`);
