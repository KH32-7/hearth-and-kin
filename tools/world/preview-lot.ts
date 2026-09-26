/**
 * 부지/마을 미리보기 PNG (게임 렌더러와 같은 규칙: 지형 자동 타일 terrainTiles.ts, 외관 shells.json, 물건 epic.json).
 * 물은 06 팔레트 단색 띠(셰이더 대신), 후처리 색 보정 없음.
 *   npx tsx tools/world/preview-lot.ts <lot.json 또는 town.json> <out.png> [x0 y0 x1 y1 (칸)] [--scale 0.5] [--grid]
 */
import fs from 'node:fs';
import { blit, create, load, save, text, type Img } from './png';
import { TerrainTiler, type TerrainData } from '../../src/render/terrainTiles';
import type { LotDef } from '../../src/sim/core/types';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['grid'].includes(args[i - 1].slice(2))));
const [inFile, outFile] = pos;
const raw = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const lot: LotDef = raw.lot ?? raw;
const T = 32;
const W = lot.w;
const H = lot.h;
const [x0, y0, x1, y1] = pos.length >= 6 ? pos.slice(2, 6).map(Number) : [0, 0, W, H];
const K = Number(opt('scale', '1'));

const td = JSON.parse(fs.readFileSync('src/data/artpacks/terrain.json', 'utf8')) as TerrainData;
const atlas = load(td.image);
const tiler = new TerrainTiler(td);
const img = create((x1 - x0) * T, (y1 - y0) * T, [30, 30, 40, 255]);

// 물 (06 팔레트 깊이 띠)
const isWater = (x: number, y: number) => tiler.material(lot.ground[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))]) === 'water';
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
  let near = false;
  let d = 9;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    if (isWater(x + dx, y + dy)) near = true;
    else d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy)));
  }
  if (!near) continue;
  const c: [number, number, number, number] = !isWater(x, y) || d <= 1 ? [97, 171, 164, 255] : d <= 2 ? [60, 133, 142, 255] : [46, 107, 123, 255];
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) img.data.set(c, (((y - y0) * T + j) * img.w + (x - x0) * T + i) * 4);
}

// 지형
const cols = td.cols;
const tileImg = (a: number): [number, number] => [(a % cols) * T, Math.floor(a / cols) * T];
const layer = create(img.w, img.h);
for (const o of tiler.ops({ w: W, h: H, ground: lot.ground, elev: lot.elev, ramps: lot.ramps, cliffStyle: lot.cliffStyle }, x0, y0, x1, y1)) {
  const dx = (o.x - x0) * T;
  const dy = (o.y - y0) * T;
  if (o.clear) {
    for (let j = 0; j < T; j++) layer.data.fill(0, ((dy + j) * layer.w + dx) * 4, ((dy + j) * layer.w + dx + T) * 4);
    continue;
  }
  const [sx, sy] = tileImg(o.atlas);
  if (o.cut) {
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
      const a = atlas.data[((sy + j) * atlas.w + sx + i) * 4 + 3];
      if (a > 0) layer.data[((dy + j) * layer.w + dx + i) * 4 + 3] = Math.round(layer.data[((dy + j) * layer.w + dx + i) * 4 + 3] * (1 - a / 255));
    }
    continue;
  }
  blit(layer, atlas, sx, sy, T, T, dx, dy);
}
blit(img, layer, 0, 0, layer.w, layer.h, 0, 0);

// 바닥 재질 (건물 안): 단색 근사
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
  const f = lot.floor[y * W + x];
  if (!f) continue;
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) img.data.set([150, 118, 84, 255], (((y - y0) * T + j) * img.w + (x - x0) * T + i) * 4);
}

// 외관 + 물건: 아래 끝 순서로
interface Draw { bottom: number; fn: () => void }
const draws: Draw[] = [];
const sh = JSON.parse(fs.readFileSync('src/data/artpacks/shells.json', 'utf8')) as { image: string; shells: Record<string, { x: number; y: number; w: number; h: number; foot: [number, number] }> };
const shellImg = load(sh.image);
for (const s of lot.shells ?? []) {
  const d = sh.shells[s.id];
  if (!d) continue;
  const bottom = (s.y + d.foot[1]) * T;
  draws.push({ bottom, fn: () => blit(img, shellImg, d.x, d.y, d.w, d.h, s.x * T - x0 * T, bottom - d.h - y0 * T) });
}
const pack = JSON.parse(fs.readFileSync('src/data/artpacks/epic.json', 'utf8'));
const objDefs = { ...JSON.parse(fs.readFileSync('src/data/objects.json', 'utf8')), ...JSON.parse(fs.readFileSync('src/data/objects_town.json', 'utf8')), ...(JSON.parse(fs.readFileSync('src/data/catalog.json', 'utf8')) as Record<string, unknown>) } as Record<string, { footprint?: { w: number; h: number } }>;
const imgs = new Map<string, Img>();
for (const o of lot.objects) {
  if (o.y >= H) continue;
  const e = pack.objects[o.variant ? `${o.id}__${o.variant}` : o.id] ?? pack.objects[o.id];
  const sid = e?.rot?.[String(o.rot ?? 0)] ?? e?.default;
  const r = sid && pack.sprites[sid];
  if (!r) continue;
  const fp = objDefs[o.id]?.footprint ?? { w: 1, h: 1 };
  const fh = (o.rot ?? 0) % 2 ? fp.w : fp.h;
  const bottom = (o.y + fh) * T;
  if (bottom < y0 * T || o.y > y1 + 4 || o.x > x1 + 4 || o.x + 8 < x0) continue;
  draws.push({
    bottom,
    fn: () => {
      const path = pack.images[r.image];
      if (!imgs.has(path)) imgs.set(path, load(path));
      blit(img, imgs.get(path)!, r.x, r.y, r.w, r.h, o.x * T - r.anchorX - x0 * T, bottom - r.anchorY - y0 * T);
    },
  });
}
draws.sort((a, b) => a.bottom - b.bottom);
for (const d of draws) d.fn();

if (flag('grid')) {
  for (let x = x0; x < x1; x += 10) for (let y = 0; y < img.h; y++) img.data.set([255, 255, 255, 90], (y * img.w + (x - x0) * T) * 4);
  for (let y = y0; y < y1; y += 10) for (let x = 0; x < img.w; x++) img.data.set([255, 255, 255, 90], (((y - y0) * T) * img.w + x) * 4);
  for (let x = x0; x < x1; x += 10) for (let y = y0; y < y1; y += 10) text(img, (x - x0) * T + 3, (y - y0) * T + 3, `${x},${y}`, [255, 255, 0, 255], 2);
}

let out = img;
if (K !== 1) {
  const s = Math.round(1 / K);
  out = create(Math.floor(img.w / s), Math.floor(img.h / s));
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const k = (((y * s + j) * img.w) + x * s + i) * 4;
      r += img.data[k]; g += img.data[k + 1]; b += img.data[k + 2];
    }
    const n = s * s;
    out.data.set([r / n, g / n, b / n, 255], (y * out.w + x) * 4);
  }
}
save(out, outFile);
console.log(outFile, out.w, out.h);
