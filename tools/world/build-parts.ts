// M5 건축 부품 아트 (contracts-m5.md 1절). build-world.ts 끝에서 부름
// 벽 재질 9 + 울타리 4, 문 8 / 창 4, 바닥 10, 지형 5, 지붕 4, 굴뚝, 층 경계, 계단/들창, 검수 시트 (artifacts/qa/m5/parts-*.png)
// 원본은 전부 Epic RPG World (Village, Village interiors, Grassland 2.0). 생성형 AI 없음. 절차적으로 그린 부분은 원본 팔레트만 씀
import fs from 'node:fs';
import type { ArtKit } from './build-world';
import { Img, create, crop, blit, save, scale, text, fillRect } from './png';
import { RGBA, paste, bboxOf, px, setPx, clone, mapPixels, hsv, hex, rampRecolor, keep, lum, removeCols, heighten, widen, rotate90cw } from './imgops';

const QA = 'artifacts/qa/m5';
const T = 32;
const H = 80;   // full wall face height
const HC = 20;  // cut wall face height
const HORIZ = 2 | 8;
const CLEAR: RGBA = [0, 0, 0, 0];

let K: ArtKit;
const L = (f: string) => K.L(f);

// ---------------------------------------------------------------- sources
let SRC: Record<string, string>;
function initSources() {
  const { INT, VIL, GL, GT, GS1 } = K.paths;
  const B = `${VIL}/buildings`;
  SRC = {
    walls1: `${B}/walls1.png`, walls2: `${B}/walls2.png`, wf: `${B}/walls-floor1.png`,
    roofs1: `${B}/roofs1.png`, roofs2: `${B}/roofs2.png`, roofTile: `${B}/Update 1.2 - recolored roof.png`,
    deco: `${B}/Decorations_sprites`, int: `${INT}/Interiors_tilesets.png`, intWin: `${INT}/windows_and_doors_sprites`,
    fence: GS1, halfWall: `${GT}/half sized wall.png`, baseGrass: `${GT}/base grass.png`,
    dirt1t: `${GT}/dirt1 to grass - transparency.png`, dirt2t: `${GT}/dirt2 to grass - transparency.png`,
    gravelt: `${GT}/gravel to grass - transparency.png`, flowers: `${GL}/Props/Static props/items-flowers-mushrooms-sprites`,
    bush: `${GL}/Props/Static props/sheet1-sprites`, hay: `${VIL}/tilesets and props/props-sprites`,
    tower: `${GL}/Props/Static props/sheet2-sprites`,
  };
}

// ---------------------------------------------------------------- small helpers
const EPIC_WOOD: RGBA[] = ['#3b2630', '#513c47', '#6e4a42', '#8a5a44', '#a0693f', '#b57b4b', '#c98f5a', '#dcae78'].map((h) => hex(h));
const OUT = hex('#513c47');
const IRON: RGBA[] = ['#2e2a33', '#45414d', '#5f5b68', '#7d7a86', '#a3a1ab'].map((h) => hex(h));
const ramp = (...hs: string[]) => hs.map((h) => hex(h));

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash2 = (x: number, y: number, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

function hsv2rgb(h: number, s: number, v: number, a = 255): RGBA {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); v = Math.max(0, Math.min(1, v));
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), a];
}
function tint(src: Img, pred: (c: RGBA, x: number, y: number) => boolean, f: (h: number, s: number, v: number) => [number, number, number]): Img {
  return mapPixels(src, (c, x, y) => { if (!pred(c, x, y)) return null; const [h, s, v] = hsv(c); const [h2, s2, v2] = f(h, s, v); return hsv2rgb(h2, s2, v2, c[3]); });
}
function rampOf(img: Img, pred: (c: RGBA) => boolean = () => true): RGBA[] {
  const m = new Map<string, RGBA>();
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) { const c = px(img, x, y); if (c[3] === 255 && pred(c)) m.set(c.slice(0, 3).join(','), c); }
  return [...m.values()].sort((a, b) => lum(a) - lum(b));
}
const trim = (img: Img): Img => { const b = bboxOf(img); return crop(img, b.x, b.y, b.w, b.h); };
const opaqueOnly = (img: Img) => keep(img, (c) => c[3] > 0);
function flipX(src: Img): Img { const o = create(src.w, src.h); paste(o, src, 0, 0, true); return o; }
function hcat(...imgs: Img[]): Img { const o = create(imgs.reduce((s, i) => s + i.w, 0), Math.max(...imgs.map((i) => i.h))); let x = 0; for (const i of imgs) { blit(o, i, 0, 0, i.w, i.h, x, 0, false); x += i.w; } return o; }
function vcat(...imgs: Img[]): Img { const o = create(Math.max(...imgs.map((i) => i.w)), imgs.reduce((s, i) => s + i.h, 0)); let y = 0; for (const i of imgs) { blit(o, i, 0, 0, i.w, i.h, 0, y, false); y += i.h; } return o; }
function rect(o: Img, x: number, y: number, w: number, h: number, c: RGBA) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) setPx(o, i, j, c); }
function clearRect(o: Img, x: number, y: number, w: number, h: number) { rect(o, x, y, w, h, CLEAR); }
const shade = (c: RGBA, k: number): RGBA => [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k), c[3]];
const mix = (a: RGBA, b: RGBA, t: number): RGBA => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t), 255];
/** Overwrite src pixels onto dst (keeps alpha of src, including partial). */
function over(dst: Img, src: Img, dx = 0, dy = 0) { paste(dst, src, dx, dy); }

/** A shaded beam/post with the Epic outline (vertical: shading across x, else across y). */
function beam(o: Img, x: number, y: number, w: number, h: number, vertical: boolean, wood: RGBA[] = [EPIC_WOOD[3], EPIC_WOOD[5], EPIC_WOOD[6]], outline = OUT) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
    const t = vertical ? (i - 1) / Math.max(1, w - 3) : 1 - (j - 1) / Math.max(1, h - 3);
    setPx(o, x + i, y + j, edge ? outline : wood[t < 0.34 ? 0 : t < 0.67 ? 1 : 2]);
  }
}

/**
 * Horizontal quilting: a P-wide strip of rows [y0, y0+h) that tiles with period P.
 * The first `ov` columns come from x0+P.. up to a minimum-error vertical cut, so the wrap seam
 * lands where the source already matches itself one period later (mortar lines, plank edges).
 */
function quiltH(src: Img, x0: number, y0: number, P: number, h: number, ov = 16): Img {
  const err = (x: number, y: number) => { const a = px(src, x0 + x, y0 + y), b = px(src, x0 + x + P, y0 + y); return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]) * 2; };
  const cost: number[][] = [], from: number[][] = [];
  for (let y = 0; y < h; y++) {
    cost.push([]); from.push([]);
    for (let x = 1; x < ov; x++) {
      const e = err(x, y);
      if (y === 0) { cost[y][x] = e; from[y][x] = x; continue; }
      let best = Infinity, bx = x;
      for (const dx of [-1, 0, 1]) { const px2 = x + dx; if (px2 < 1 || px2 >= ov) continue; if (cost[y - 1][px2] < best) { best = cost[y - 1][px2]; bx = px2; } }
      cost[y][x] = e + best; from[y][x] = bx;
    }
  }
  let cx = 1; for (let x = 1; x < ov; x++) if (cost[h - 1][x] < cost[h - 1][cx]) cx = x;
  const cut: number[] = new Array(h);
  for (let y = h - 1; y >= 0; y--) { cut[y] = cx; cx = from[y][cx]; }
  const o = create(P, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < P; x++) setPx(o, x, y, x < cut[y] ? px(src, x0 + x + P, y0 + y) : px(src, x0 + x, y0 + y));
  return o;
}
/** Vertical quilting (same idea, rows). */
function transpose(src: Img): Img { const o = create(src.h, src.w); for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) setPx(o, y, x, px(src, x, y)); return o; }
function quiltV(src: Img, x0: number, y0: number, w: number, P: number, ov = 12): Img {
  return transpose(quiltH(transpose(crop(src, x0, y0, w, P + ov)), 0, 0, P, w, ov));
}

// ---------------------------------------------------------------- emission (+ local copy for QA sheets)
const drawn = new Map<string, { img: Img; ax: number; ay: number }>();
function put(id: string, img: Img, ax: number, ay: number, trimIt = false) {
  K.emit(id, [img], ax, ay, { trim: trimIt });
  drawn.set(id, { img, ax, ay });
  return id;
}
function alias(id: string, of: string, anchorY: number) {
  const s = K.art.sprites[of];
  K.art.sprites[id] = { ...s, anchorY: s.anchorY - (drawn.get(of)!.ay - anchorY) };
  const d = drawn.get(of)!;
  drawn.set(id, { img: d.img, ax: d.ax, ay: anchorY });
  return id;
}
// tiles: every generated 32x32 tile goes into one sheet (parts_tiles.png), registered at the end
const tileQueue: Array<{ id: string; img: Img }> = [];
const tileImgs = new Map<string, Img>();
function addTile(id: string, img: Img) { tileQueue.push({ id, img }); tileImgs.set(id, img); return id; }
function tileImg(id: string): Img {
  const hit = tileImgs.get(id); if (hit) return hit;
  const t = K.art.tiles[id]; return crop(L(K.art.images[t.image]), t.x, t.y, T, T);
}
const artAny = () => K.art as unknown as Record<string, unknown>;
function flushTilesAs(name: string) {
  if (tileQueue.length) {
    const cols = 16, rows = Math.ceil(tileQueue.length / cols);
    const sheet = create(cols * T, rows * T);
    tileQueue.forEach(({ img }, i) => blit(sheet, img, 0, 0, T, T, (i % cols) * T, Math.floor(i / cols) * T, false));
    const file = `${K.GEN}/${name}`;
    save(sheet, file);
    tileQueue.forEach(({ id }, i) => K.tile(id, file, (i % cols) * T, Math.floor(i / cols) * T));
  }
  tileQueue.length = 0;
}

// ================================================================= walls
interface Mat {
  id: string; A: Img; B: Img; cap: (mask: number) => Img; outline: RGBA; jamb: 'wood' | 'stone';
  stone?: RGBA[]; // jamb stone ramp dark→light
}
const woodCap = (m: number) => K.capTile(m);

/** Cap with a tileable top texture; exposed edges get the Epic outline + bevel (like capTile). */
function capTex(tex: Img, pal: { o: RGBA; l: RGBA; d: RGBA }) {
  return (mask: number): Img => {
    const o = clone(tex);
    for (let k = 0; k < T; k++) {
      if (!(mask & 1)) { setPx(o, k, 0, pal.o); setPx(o, k, 1, pal.l); }
      if (!(mask & 4)) { setPx(o, k, T - 1, pal.o); setPx(o, k, T - 2, pal.d); }
      if (!(mask & 8)) { setPx(o, 0, k, pal.o); setPx(o, 1, k, pal.l); }
      if (!(mask & 2)) { setPx(o, T - 1, k, pal.o); setPx(o, T - 2, k, pal.d); }
    }
    for (const [cx, cy] of [[0, 0], [T - 1, 0], [0, T - 1], [T - 1, T - 1]] as const) {
      const nOrS = cy === 0 ? 1 : 4, wOrE = cx === 0 ? 8 : 2;
      if (!(mask & nOrS) || !(mask & wOrE)) setPx(o, cx, cy, pal.o);
    }
    return o;
  };
}

function cell(face: Img, fh: number, cap: Img, outline: RGBA): Img {
  const o = create(T, T + fh);
  paste(o, cap, 0, 0);
  blit(o, face, 0, face.h - fh, T, fh, 0, T, false);
  for (let x = 0; x < T; x++) setPx(o, x, T, outline);
  return o;
}

/** Face rows from the Village walls sheets (same row recipe as build-world's faceColumn, any sheet/column). */
const WALL_ROWS: Array<[number, number]> = [[1600, 1607], [1607, 1627], [1666, 1690], [1690, 1698], [1698, 1712], [1712, 1718]];
function timberColumn(file: string, x0: number): Img {
  const src = L(file); const out = create(T, H); let y = 0;
  for (const [a, b] of WALL_ROWS) { blit(out, src, x0, a, T, b - a, 0, y, false); y += b - a; }
  while (y < H) { blit(out, src, x0, 1717, T, 1, 0, y, false); y++; }
  return out;
}

const DOOR_X = 4, DOOR_W = 24, DOOR_Y = 18, DOOR_H = H - DOOR_Y; // opening in face coords (24 x 62)

function drawJambs(face: Img, m: Mat) {
  if (m.jamb === 'wood') {
    beam(face, 0, DOOR_Y - 5, T, 6, false);
    beam(face, 0, DOOR_Y, DOOR_X, DOOR_H, true);
    beam(face, T - DOOR_X, DOOR_Y, DOOR_X, DOOR_H, true);
    return;
  }
  const r = m.stone!;
  const block = (x: number, y: number, w: number, h: number, k: number) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
      setPx(face, x + i, y + j, edge ? m.outline : j === 1 ? r[Math.min(r.length - 1, 3 + k)] : r[Math.min(r.length - 1, 2 + k)]);
    }
  };
  block(0, DOOR_Y - 6, T, 7, 1); // lintel slab
  for (let y = DOOR_Y, i = 0; y < H; i++) { const h = Math.min(i % 2 ? 9 : 11, H - y); block(0, y, DOOR_X + (i % 2 ? 0 : 1), h, i % 2); block(T - DOOR_X - (i % 2 ? 0 : 1), y, DOOR_X + (i % 2 ? 0 : 1), h, (i + 1) % 2); y += h; }
}

interface WallOut { frame: Img; frameCut: Img }
function emitWall(m: Mat, door: { closed: Img; open: Img }, win: Img, keepExisting = false): WallOut {
  const ay = T + H, ayc = T + HC, id = m.id;
  const P = (s: string, img: Img, a: number) => put(`${id}_${s}`, img, 0, a);
  const hcap = m.cap(HORIZ);
  // door frame: jambs + lintel, opening transparent (door leaves are drawn over it)
  const ff = clone(m.A); drawJambs(ff, m); clearRect(ff, DOOR_X, DOOR_Y, DOOR_W, DOOR_H);
  const frame = cell(ff, H, hcap, m.outline);
  P('door_frame', frame, ay);
  const fc = cell(ff, HC, hcap, m.outline);
  clearRect(fc, DOOR_X, 0, DOOR_W, fc.h);
  for (let y = 0; y < T; y++) { setPx(fc, DOOR_X - 1, y, m.outline); setPx(fc, DOOR_X + DOOR_W, y, m.outline); }
  P('door_frame_cut', fc, ayc);
  const entry = K.art.walls[id] ?? {};
  entry.doorFrame = `${id}_door_frame`; entry.doorFrameCut = `${id}_door_frame_cut`;
  if (keepExisting) { K.art.walls[id] = entry; return { frame, frameCut: fc }; }

  P('face', cell(m.A, H, hcap, m.outline), ay);
  P('face_b', cell(m.B, H, hcap, m.outline), ay);
  P('face_cut', cell(m.A, HC, hcap, m.outline), ayc);
  P('face_cut_b', cell(m.B, HC, hcap, m.outline), ayc);
  P('top', m.cap(1 | 4), ay);
  alias(`${id}_top_cut`, `${id}_top`, ayc);
  for (let k = 0; k < 16; k++) { P(`cap_${k}`, m.cap(k), ay); alias(`${id}_cap_cut_${k}`, `${id}_cap_${k}`, ayc); }
  const withDoor = (leaf: Img) => { const o = clone(frame); paste(o, leaf, 0, T); return o; };
  P('door', withDoor(door.closed), ay);
  P('door_open', withDoor(door.open), ay);
  const withWin = (face: Img) => { const f = clone(face); paste(f, win, 0, 0); return cell(f, H, hcap, m.outline); };
  P('window', withWin(m.A), ay);
  P('window_b', withWin(m.B), ay);
  // side (east/west wall) openings seen from above
  const ws = m.cap(1 | 4);
  for (let y = 6; y < 26; y++) for (let x = 11; x < 21; x++) setPx(ws, x, y, x === 11 || x === 20 ? m.outline : hex(y % 5 === 0 ? '#5b7fa8' : '#7ea3c8'));
  P('window_side', ws, ay); alias(`${id}_window_side_cut`, `${id}_window_side`, ayc);
  const ds = m.cap(1 | 4);
  const flr = tileImg('floor_wood_1');
  for (let y = 3; y < 29; y++) for (let x = 0; x < T; x++) { const c = px(flr, x, y); setPx(ds, x, y, y === 3 || y === 28 ? m.outline : shade(c, 0.7)); }
  P('door_side', ds, ay); alias(`${id}_door_side_cut`, `${id}_door_side`, ayc);
  Object.assign(entry, {
    face: `${id}_face`, faceAlt: `${id}_face_b`, faceCut: `${id}_face_cut`, faceCutAlt: `${id}_face_cut_b`,
    top: `${id}_top`, topCut: `${id}_top_cut`,
    caps: Array.from({ length: 16 }, (_, k) => `${id}_cap_${k}`), capsCut: Array.from({ length: 16 }, (_, k) => `${id}_cap_cut_${k}`),
    door: `${id}_door`, doorOpen: `${id}_door_open`, doorCut: `${id}_door_frame_cut`, doorSide: `${id}_door_side`, doorSideCut: `${id}_door_side_cut`,
    window: `${id}_window`, windowAlt: `${id}_window_b`, windowCut: `${id}_face_cut`, windowSide: `${id}_window_side`, windowSideCut: `${id}_window_side_cut`,
    windowLight: 'window_sunlight', height: H, heightCut: HC,
  });
  K.art.walls[id] = entry;
  return { frame, frameCut: fc };
}

/** Two 32x80 faces (A, B) from a 64-periodic quilt of a Village wall panel (rows y0..y0+80). */
function panelFaces(file: string, x0: number, y0: number, ov = 20): [Img, Img] {
  const q = quiltH(L(file), x0, y0, 64, H, ov);
  return [crop(q, 0, 0, T, H), crop(q, T, 0, T, H)];
}

function materials(): Mat[] {
  const { walls1, walls2, wf, int } = SRC;
  const mats: Mat[] = [];
  // --- half-timber, rose plaster: walls1 design 6, pink half of the sheet (same rows as wall_timber)
  mats.push({ id: 'wall_timber_rose', A: timberColumn(walls1, 224 + 1024), B: timberColumn(walls1, 256 + 1024), cap: woodCap, outline: OUT, jamb: 'wood' });
  // --- daub: plain yellow bay of design 6 (no posts), plaster → rough earthen clay; B = mirror so A|B|A tiles
  // the bay's left edge carries half of the design-6 post: overwrite columns 0..8 (post + its shadow) with plain plaster columns (plaster + the horizontal beams)
  const plain = timberColumn(walls1, 256);
  for (let y = 0; y < H; y++) { for (let x = 0; x < 9; x++) setPx(plain, x, y, px(plain, 14 + (x % 3), y)); for (let x = 0; x < 4; x++) setPx(plain, T - 1 - x, y, px(plain, 20, y)); }
  const PLASTER = new Map([['beb57e', 2], ['a89d6c', 1], ['c8c08d', 3], ['8a7f6b', 0], ['c8a050', 4], ['a48a4c', 5], ['786742', 6]]);
  const key = (c: RGBA) => c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
  const daub = (pal: RGBA[], straw: RGBA[], seed: number, rough: number) => {
    const o = mapPixels(plain, (c, x, y) => {
      const k = PLASTER.get(key(c)); if (k === undefined) return null;
      if (k >= 4) return straw[k - 4];
      const r = hash2(x >> 1, (y + (x >> 1)) >> 1, seed); // 2x2 clumps read as lumpy clay rather than grain
      let i = k === 0 ? 0 : k === 1 ? 1 : k === 2 ? 2 : 3;
      if (i === 2 && r < rough) i = 1; else if (i === 2 && r > 1 - rough * 0.6) i = 3;
      return pal[i];
    });
    // short straw flecks in the daub
    const R = rng(seed);
    for (let n = 0; n < 7; n++) {
      const x = Math.floor(R() * 30), y = 8 + Math.floor(R() * 68); const len = 2 + Math.floor(R() * 3);
      for (let i = 0; i < len; i++) { const c = px(o, x + i, y); if (c[3] && lum(c) > lum(pal[1]) - 4 && PLASTER.has(key(px(plain, x + i, y)))) setPx(o, x + i, y, straw[i % 2]); }
    }
    return o;
  };
  const daubPal = ramp('#6b5842', '#836b4d', '#977e59', '#a8906a');
  const daubStraw = ramp('#b89a5a', '#9c8048', '#6e5a3a');
  const dA = daub(daubPal, daubStraw, 11, 0.05);
  mats.push({ id: 'wall_daub', A: dA, B: flipX(dA), cap: woodCap, outline: OUT, jamb: 'wood' });
  const whitePal = ramp('#9a948a', '#bdb8ad', '#d9d5ca', '#e8e5dc');
  const wA = daub(whitePal, ramp('#c9bf9c', '#b3a888', '#8f8672'), 12, 0.03);
  mats.push({ id: 'wall_daub_white', A: wA, B: flipX(wA), cap: woodCap, outline: OUT, jamb: 'wood' });
  // --- plank: walls-floor1 red clapboard panel (736..864, 1120..1200)
  const [pA, pB] = panelFaces(wf, 736, 1120);
  mats.push({ id: 'wall_plank', A: pA, B: pB, cap: woodCap, outline: OUT, jamb: 'wood' });
  // --- stone (rubble): walls-floor1 light rubble panel under its wall plate (160..288, 512..592)
  const [sA, sB] = panelFaces(wf, 160, 512, 28);
  const RUB = ramp('#463d3a', '#6a5b48', '#8b7e71', '#93897b', '#a19386', '#aca99c', '#cac5af');
  const cobble = tileImg('floor_stone_1');
  const stoneTop = rampRecolor(cobble, RUB.slice(0, 6), () => true);
  mats.push({ id: 'wall_stone', A: sA, B: sB, cap: capTex(stoneTop, { o: hex('#463d3a'), l: RUB[5], d: RUB[1] }), outline: hex('#463d3a'), jamb: 'stone', stone: RUB });
  // --- whitewashed rubble: stones → lime white, mortar stays grey
  const WASH = ramp('#7b7671', '#a8a49c', '#c9c6bd', '#d6d3ca', '#dfddd5', '#e9e7e0', '#f3f1ea');
  const washed = (img: Img) => rampRecolor(img, WASH, (c) => { const [h, s] = hsv(c); return s < 0.36 && (h < 60 || h > 300); });
  mats.push({ id: 'wall_stone_white', A: washed(sA), B: washed(sB), cap: capTex(washed(stoneTop), { o: hex('#5f5a55'), l: WASH[6], d: WASH[1] }), outline: hex('#5f5a55'), jamb: 'stone', stone: WASH });
  // --- ashlar: walls2 dressed-stone infill (no timbers) with a stone string course top and plinth
  const ASH = ramp('#6d6866', '#868180', '#a4a298', '#b0ac98', '#bdb9a5', '#cfcab4', '#dbd6c2');
  const ashTex = quiltH(L(walls2), 100, 1608, 64, 80, 20);
  // rows 1608..1688 hold ~82 px of stone; stretch to 80 with a cornice (6) + plinth (6)
  const ashFace = create(64, H);
  blit(ashFace, ashTex, 0, 0, 64, H - 12, 0, 6, false);
  for (let x = 0; x < 64; x++) {
    setPx(ashFace, x, 0, hex('#4a4446')); for (let y = 1; y < 5; y++) setPx(ashFace, x, y, y === 1 ? ASH[6] : y === 4 ? ASH[2] : ASH[5]); setPx(ashFace, x, 5, hex('#4a4446'));
    setPx(ashFace, x, H - 7, hex('#4a4446')); for (let y = H - 6; y < H; y++) setPx(ashFace, x, y, y === H - 6 ? ASH[3] : ASH[1]);
    if (x % 16 === 0) for (let y = H - 6; y < H; y++) setPx(ashFace, x, y, hex('#4a4446'));
  }
  const ashTop = rampRecolor(tileImg('floor_stone_1'), ASH.slice(1), () => true);
  const flag = crop(L(int), 1152, 480, T, T);
  const ashCapTex = rampRecolor(flag, ASH.slice(1, 7), () => true);
  void ashTop;
  mats.push({ id: 'wall_ashlar', A: crop(ashFace, 0, 0, T, H), B: crop(ashFace, T, 0, T, H), cap: capTex(ashCapTex, { o: hex('#4a4446'), l: ASH[6], d: ASH[1] }), outline: hex('#4a4446'), jamb: 'stone', stone: ASH });
  // --- brick: walls-floor1 brick panel (160..288, 193..273) under its stone coping
  const [bA, bB] = panelFaces(wf, 160, 193, 24);
  const BR = rampOf(crop(L(wf), 170, 205, 100, 60), (c) => { const [h, sat] = hsv(c); return !(h > 30 && h < 170 && sat > 0.2); });
  const brickTop = rampRecolor(crop(L(int), 1152, 192, T, T), BR, () => true);
  mats.push({ id: 'wall_brick', A: bA, B: bB, cap: capTex(brickTop, { o: hex('#4a4148'), l: BR[BR.length - 1], d: BR[1] }), outline: hex('#4a4148'), jamb: 'stone', stone: ramp('#5d5555', '#7f7777', '#9e9696', '#b3abab', '#c7bfbf', '#d6cfcf') });
  return mats;
}

// ================================================================= doors (32x80 overlays, opening at 4..28 x 18..80)
const DOORS = ['door_plank', 'door_ledged', 'door_studded', 'door_dark', 'door_half', 'door_arch', 'door_barn', 'gate_wood'] as const;
const WINDOWS = ['win_shutter', 'win_lattice', 'win_glass', 'win_stained'] as const;

function fitLeaf(src: Img, cutFrom: number, cutTo: number, growAt: number, growFrom: number, growTo: number): Img {
  let l = removeCols(src, cutFrom, cutTo);
  if (l.h < DOOR_H) l = heighten(l, growAt, growFrom, growTo, DOOR_H - l.h);
  if (l.h > DOOR_H) l = crop(l, 0, l.h - DOOR_H, l.w, DOOR_H);
  return l;
}
function overlay(leaf: Img, dx = DOOR_X, dy = DOOR_Y): Img { const o = create(T, H); paste(o, leaf, dx, dy); return o; }
/** Open: the leaf swung inward, seen edge-on against the left jamb; the opening stays see-through. */
function openOverlay(leaf: Img): Img {
  const o = create(T, H);
  const r = rampOf(leaf, (c) => isWood(c));
  const d = r[Math.floor(r.length * 0.25)] ?? EPIC_WOOD[2], m = r[Math.floor(r.length * 0.6)] ?? EPIC_WOOD[4];
  for (let y = DOOR_Y; y < H; y++) { setPx(o, DOOR_X, y, OUT); setPx(o, DOOR_X + 1, y, m); setPx(o, DOOR_X + 2, y, d); setPx(o, DOOR_X + 3, y, OUT); }
  for (let x = DOOR_X; x < DOOR_X + 4; x++) setPx(o, x, DOOR_Y, OUT);
  // shadow line under the lintel inside the opening
  for (let x = DOOR_X + 4; x < DOOR_X + DOOR_W; x++) setPx(o, x, DOOR_Y, [30, 22, 28, 120]);
  return o;
}
const isWood = (c: RGBA) => { const [h, s, v] = hsv(c); return (h < 50 || h > 330) && s > 0.2 && v > 0.12; };
const DARK_OAK = ramp('#1f1519', '#2c1e22', '#3a272a', '#4a3232', '#5a3e3a', '#6c4c44', '#7d5b4e', '#8e6a58');

interface DoorArt { closed: Img; open: Img; side: Img; leaf: Img }
function buildDoors(): Record<string, DoorArt> {
  const D = SRC.deco;
  const out: Record<string, DoorArt> = {};
  const studs = (leaf: Img, ys: number[]) => {
    for (const y of ys) for (let x = 2; x < leaf.w - 2; x += 5) { setPx(leaf, x, y, IRON[0]); setPx(leaf, x + 1, y, IRON[1]); setPx(leaf, x, y - 1, IRON[4]); setPx(leaf, x + 1, y - 1, IRON[2]); }
  };
  const strap = (leaf: Img, y: number) => { for (let x = 0; x < leaf.w; x++) { setPx(leaf, x, y, IRON[0]); setPx(leaf, x, y + 1, IRON[2]); setPx(leaf, x, y + 2, IRON[1]); } };

  // plank: Village doors-0_0 (rustic planks, ring handle), leaf 38x60 → 24x62
  const plank = fitLeaf(crop(L(`${D}/doors-0_0.png`), 12, 26, 38, 60), 12, 26, 30, 26, 30);
  // ledged: Village doors-0_16 (planks on two nailed ledges), leaf 40x44 → 24x62
  const ledged = fitLeaf(crop(L(`${D}/doors-0_16.png`), 12, 42, 40, 44), 14, 30, 20, 16, 28);
  // studded: doors-0_14 planks + iron straps and rows of studs
  const studded = fitLeaf(crop(L(`${D}/doors-0_14.png`), 12, 42, 40, 44), 14, 30, 20, 16, 28);
  strap(studded, 8); strap(studded, 50); studs(studded, [20, 30, 40]);
  // dark oak: plank door in dark oak
  const dark = rampRecolor(plank, DARK_OAK, isWood);
  // half (stable) door: light planks of doors-0_15 split in two leaves with a ledge shelf
  const half = fitLeaf(crop(L(`${D}/doors-0_15.png`), 12, 42, 40, 44), 14, 30, 20, 16, 28);
  for (let x = 0; x < half.w; x++) { setPx(half, x, 27, OUT); }
  beam(half, -1, 28, half.w + 2, 4, false);
  // barn: planks of doors-0_15 darkened a little, framed with ledges and a Z brace
  const barn = mapPixels(fitLeaf(crop(L(`${D}/doors-0_1.png`), 12, 26, 38, 60), 12, 26, 30, 26, 30), (c) => (isWood(c) ? shade(c, 0.95) : null));
  beam(barn, 0, 2, DOOR_W, 5, false); beam(barn, 0, 30, DOOR_W, 5, false); beam(barn, 0, DOOR_H - 7, DOOR_W, 5, false);
  const brace = (y0: number, y1: number) => { for (let y = y0; y < y1; y++) { const t = (y - y0) / (y1 - y0 - 1); const x = Math.round(2 + (DOOR_W - 8) * (1 - t)); beam(barn, x, y, 5, 1, true); } for (let y = y0; y < y1; y++) { const t = (y - y0) / (y1 - y0 - 1); const x = Math.round(2 + (DOOR_W - 8) * (1 - t)); setPx(barn, x, y, OUT); setPx(barn, x + 4, y, OUT); } };
  brace(7, 30); brace(35, DOOR_H - 7);
  // arch: doors-0_9 (red stone round arch, knocker); arch halves joined → a slightly pointed arch over a 24 px leaf
  const a9 = L(`${D}/doors-0_9.png`);
  // each half keeps its voussoirs (3 thin columns of the outer ring dropped) → 16 + 16 px, the halves meet in a low point
  const archFull = hcat(removeCols(crop(a9, 0, 12, 19, 76), 1, 4), removeCols(crop(a9, 45, 12, 19, 76), 15, 18));
  const arch = create(T, H);
  paste(arch, archFull, 0, H - 76);
  const ringCols = new Set<string>();
  const ringSrc = crop(a9, 0, 40, 10, 40);
  for (let y = 0; y < ringSrc.h; y++) for (let x = 0; x < ringSrc.w; x++) { const c = px(ringSrc, x, y); if (c[3] === 255) ringCols.add(c.slice(0, 3).join()); }
  const isRing = (c: RGBA) => c[3] === 255 && ringCols.has(c.slice(0, 3).join());
  // open: hollow out the leaf between the voussoirs, row by row from the middle outward
  const archOpen = clone(arch);
  for (let y = 0; y < H; y++) {
    if (y < 22 || !px(arch, 15, y)[3]) continue; // above y 22 the two halves' voussoirs meet (the point of the arch)
    // the voussoirs are ~6 px deep inside the silhouette; the leaf shares their colours, so cut by geometry
    let xl = 0; while (xl < T && !px(arch, xl, y)[3]) xl++;
    let xr = T - 1; while (xr > 0 && !px(arch, xr, y)[3]) xr--;
    for (let x = xl + 6; x <= xr - 6; x++) setPx(archOpen, x, y, CLEAR);
    setPx(archOpen, xl + 5, y, OUT); setPx(archOpen, xr - 5, y, OUT);
  }
  const archLeaf = crop(arch, DOOR_X, DOOR_Y, DOOR_W, DOOR_H);

  const make = (id: string, leaf: Img, closed?: Img, open?: Img) => {
    const c = closed ?? overlay(leaf);
    const o = open ?? openOverlay(leaf);
    out[id] = { closed: c, open: o, side: doorSide(leaf), leaf };
  };
  make('door_plank', plank); make('door_ledged', ledged); make('door_studded', studded); make('door_dark', dark);
  make('door_half', half); make('door_barn', barn);
  // open: leaf swung against the left voussoirs (thin edge-on board just inside the ring)
  const aOpen = clone(archOpen);
  const ar = rampOf(archLeaf, (c) => isWood(c) && !isRing(c));
  for (let y = 24; y < H; y++) {
    let x = 0; while (x < 16 && !px(arch, x, y)[3]) x++;
    x += 6; if (x >= 16) continue;
    setPx(aOpen, x, y, OUT); setPx(aOpen, x + 1, y, ar[Math.floor(ar.length * 0.6)]); setPx(aOpen, x + 2, y, ar[Math.floor(ar.length * 0.3)]); setPx(aOpen, x + 3, y, OUT);
  }
  make('door_arch', archLeaf, arch, aOpen);
  // gate: Grassland fence gate (two leaves meeting in the middle), bottom aligned; open = both leaves swung back
  const g = removeGrass(L(`${SRC.fence}/fence - gateway - closed - middle.png`));
  const gc = create(T, H); paste(gc, g, 0, H - T);
  const go = create(T, H);
  const gr = rampOf(g, isWood);
  for (const x0 of [0, T - 3]) for (let y = H - 26; y < H - 3; y++) { setPx(go, x0, y, OUT); setPx(go, x0 + 1, y, gr[Math.floor(gr.length * 0.7)]); setPx(go, x0 + 2, y, OUT); }
  out.gate_wood = { closed: gc, open: go, side: doorSide(crop(g, 0, 0, T, T)), leaf: g };
  return out;
}
/** Door seen from above in an east/west wall: the leaf as a thin board across the threshold. */
function doorSide(leaf: Img): Img {
  const o = create(T, T);
  const r = rampOf(leaf, isWood);
  const m = r[Math.floor(r.length * 0.55)] ?? EPIC_WOOD[4], l = r[Math.floor(r.length * 0.85)] ?? EPIC_WOOD[6];
  for (let y = 3; y < 29; y++) { setPx(o, 13, y, OUT); setPx(o, 14, y, l); setPx(o, 15, y, m); setPx(o, 16, y, m); setPx(o, 17, y, OUT); }
  for (let x = 13; x < 18; x++) { setPx(o, x, 3, OUT); setPx(o, x, 28, OUT); }
  return o;
}

// ================================================================= windows (32x80 overlays, top at y≈14)
interface WinArt { front: Img; side: Img; light: Img; lightAnchor: [number, number] }
function buildWindows(): Record<string, WinArt> {
  const D = SRC.deco;
  const at = (img: Img, y = 14) => { const o = create(T, H); const t = trim(img); paste(o, t, Math.floor((T - t.w) / 2), y); return o; };
  const out: Record<string, WinArt> = {};
  // shutter: Village windows-0_14 (louvred shutters closed), 40 → 30 px (middle columns out)
  const sh = removeCols(trim(L(`${D}/windows-0_14.png`)), 15, 25);
  // lattice: Village windows-2_1 (leaded diamond lattice), 44 → 30 px
  const la = removeCols(trim(L(`${D}/windows-2_1.png`)), 15, 29);
  // glass: Village windows-2_6 (small-paned glazed window, 30 px)
  const gl = trim(L(`${D}/windows-2_6.png`));
  // stained: Village windows-1_5 (arched, small panes) with the panes re-leaded in red / blue / gold / green
  const st0 = trim(L(`${D}/windows-1_5.png`));
  const glassy = (c: RGBA) => { const [h, s, v] = hsv(c); return h > 170 && h < 250 && s > 0.2 && v > 0.45; };
  const COL: RGBA[][] = [ramp('#7a2331', '#b23a3f', '#e0605a'), ramp('#27407a', '#3d64b0', '#6f9be0'), ramp('#8a6a1c', '#c99a2e', '#f0cf64'), ramp('#2d5a36', '#3f8a4c', '#74c07a')];
  const st = mapPixels(st0, (c, x, y) => {
    if (!glassy(c)) return null;
    const pane = (Math.floor(x / 6) + Math.floor(y / 7) * 3) % 4;
    const [, , v] = hsv(c); const r = COL[pane];
    return v > 0.9 ? r[2] : v > 0.7 ? r[1] : r[0];
  });
  const sun = (() => { const s = K.art.sprites.window_sunlight; return { img: crop(L(K.art.images[s.image]), s.x, s.y, s.w, s.h), ax: s.anchorX, ay: s.anchorY }; })();
  const side = (fill: (x: number, y: number) => RGBA) => { const o = create(T, T); for (let y = 6; y < 26; y++) for (let x = 11; x < 21; x++) setPx(o, x, y, x === 11 || x === 20 || y === 6 || y === 25 ? OUT : fill(x, y)); return o; };
  const lightOf = (mod: (c: RGBA, x: number, y: number) => RGBA | null) => mapPixels(sun.img, mod);
  out.win_shutter = {
    front: at(sh), side: side((_x, y) => (y % 3 === 0 ? EPIC_WOOD[3] : EPIC_WOOD[5])),
    light: lightOf((c, _x, y) => (y % 4 < 2 ? [c[0], c[1], c[2], Math.round(c[3] * 0.25)] : [c[0], c[1], c[2], Math.round(c[3] * 0.55)])), lightAnchor: [sun.ax, sun.ay],
  };
  out.win_lattice = {
    front: at(la), side: side((x, y) => ((x + y) % 4 === 0 || (x - y + 40) % 4 === 0 ? IRON[1] : hex('#8fa8b8'))),
    light: lightOf((c, x, y) => ((x + y) % 5 === 0 || (x - y + 50) % 5 === 0 ? [c[0], c[1], c[2], Math.round(c[3] * 0.3)] : null)), lightAnchor: [sun.ax, sun.ay],
  };
  out.win_glass = { front: at(gl), side: side((_x, y) => hex(y % 5 === 0 ? '#5b7fa8' : '#9cc3e6')), light: sun.img, lightAnchor: [sun.ax, sun.ay] };
  out.win_stained = {
    front: at(st), side: side((x, y) => COL[(Math.floor(x / 3) + Math.floor(y / 4)) % 4][1]),
    light: lightOf((c, x, y) => { const r = COL[(Math.floor(x / 5) + Math.floor(y / 4) * 2) % 4][2]; return [Math.round((c[0] + r[0]) / 2), Math.round((c[1] + r[1]) / 2), Math.round((c[2] + r[2]) / 2), c[3]]; }), lightAnchor: [sun.ax, sun.ay],
  };
  return out;
}

// ================================================================= fences
/** Epic props sit on painted grass tufts: drop the green and continue the wood/shadow downward. */
function removeGrass(src: Img): Img {
  const g = (c: RGBA) => { const [h, s] = hsv(c); return c[3] > 0 && h > 70 && h < 170 && s > 0.3; };
  const o = clone(src);
  for (let x = 0; x < src.w; x++) for (let y = 0; y < src.h; y++) {
    if (!g(px(src, x, y))) continue;
    let k = y - 1; while (k >= 0 && g(px(src, x, k))) k--;
    const above = k >= 0 ? px(src, x, k) : CLEAR;
    // continue a post (opaque wood above within 6 px of the bottom half), otherwise transparent
    setPx(o, x, y, above[3] === 255 && isWood(above) && y - k < 12 ? above : CLEAR);
  }
  return o;
}
function unionOf(parts: Img[]): Img { const o = create(parts[0].w, parts[0].h); for (const p of parts) paste(o, p, 0, 0); return o; }

function buildFences(): Record<string, Img[]> {
  const F = SRC.fence;
  const f = (n: string) => removeGrass(L(`${F}/fence - ${n}.png`));
  const res: Record<string, Img[]> = {};
  // ---- wood: Grassland 2.0 fence autotile parts (post, rails W/E, post extension N/S)
  {
    const post = removeGrass(L(`${F}/fence.png`));
    const pb = bboxOf(post);
    const railW = keep(f('left'), (_c, x) => x < pb.x);
    const railE = keep(f('right'), (_c, x) => x >= pb.x + pb.w);
    const up = keep(f('up'), (_c, _x, y) => y < pb.y + 4);
    // post continued to the cell's south edge (the source puts grass there): repeat a mid row of the post
    const down = create(T, T);
    const midY = pb.y + Math.floor(pb.h / 2);
    for (let y = pb.y + pb.h - 8; y < T; y++) for (let x = pb.x; x < pb.x + pb.w; x++) setPx(down, x, y, px(post, x, midY));
    res.fence_wood = Array.from({ length: 16 }, (_, m) => {
      const parts: Img[] = [];
      if (m & 8) parts.push(railW); if (m & 2) parts.push(railE); if (m & 1) parts.push(up); if (m & 4) parts.push(down);
      parts.push(post);
      return unionOf(parts);
    });
  }
  // ---- stone: Grassland 2.0 half-height wall (no grass version): face run, rounded ends, vertical top strip
  {
    const hw = L(SRC.halfWall);
    const run = crop(hw, 64, 0, T, T), endL = crop(hw, 0, 32, T, T), endR = crop(hw, 224, 32, T, T);
    const vMid = crop(hw, 64, 96, T, T), vTop = crop(hw, 32, 64, T, T), vBot = crop(hw, 32, 128, T, T);
    const half = (img: Img, right: boolean) => keep(img, (_c, x) => (right ? x >= 16 : x < 16));
    res.fence_stone = Array.from({ length: 16 }, (_, m) => {
      const o = create(T, T);
      const hz = (m & 10) !== 0, n = (m & 1) !== 0, s = (m & 4) !== 0;
      if (hz) {
        if (n) paste(o, keep(vMid, (_c, _x, y) => y < 8), 0, 0);
        // a corner joins the vertical strip square-on (strip is x 8..24), a free end gets the rounded end stone
        const vert = n || s;
        paste(o, (m & 8) ? half(run, false) : vert ? keep(run, (_c, x) => x >= 8 && x < 16) : half(endL, false), 0, 0);
        paste(o, (m & 2) ? half(run, true) : vert ? keep(run, (_c, x) => x >= 16 && x < 24) : half(endR, true), 0, 0);
        if (vert) for (let y = 0; y < T; y++) for (const x of [(m & 8) ? -1 : 8, (m & 2) ? -1 : 23]) if (x >= 0 && px(o, x, y)[3]) setPx(o, x, y, hex('#3d4a3a'));
      } else if (n && s) paste(o, vMid, 0, 0);
      else if (n) paste(o, vBot, 0, 0);
      else if (s) paste(o, vTop, 0, 0);
      else { paste(o, half(endL, false), 0, 0); paste(o, half(endR, true), 0, 0); }
      return o;
    });
  }
  // ---- wattle: woven hazel hurdles between stakes (drawn with the Epic wood ramp)
  {
    const WT = ramp('#4f3b35', '#6e5642', '#8a6d4f', '#a4865e', '#bb9d6e');
    const hurdleH = (o: Img, x0: number, x1: number) => {
      const top = 9, bot = 29;
      for (let y = top; y < bot; y++) for (let x = x0; x < x1; x++) {
        const band = Math.floor((y - top) / 3), phase = (Math.floor(x / 4) + band) % 2;
        const inBand = (y - top) % 3;
        const c = inBand === 0 ? WT[phase ? 1 : 0] : inBand === 1 ? WT[phase ? 4 : 3] : WT[phase ? 3 : 2];
        setPx(o, x, y, c);
      }
      for (let x = x0; x < x1; x++) { setPx(o, x, top - 1, OUT); setPx(o, x, bot, OUT); setPx(o, x, bot + 1, [40, 30, 34, 90]); }
      for (let x = x0 + ((8 - x0 % 8) % 8) + 3; x < x1; x += 8) for (let y = top - 3; y < bot; y++) { setPx(o, x, y, y === top - 3 ? OUT : WT[1]); setPx(o, x + 1, y, y === top - 3 ? OUT : WT[3]); }
    };
    const hurdleV = (o: Img, y0: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = 13; x < 19; x++) {
        const c = x === 13 || x === 18 ? OUT : ((Math.floor(y / 3) + x) % 2 ? WT[4] : WT[2]);
        setPx(o, x, y, c);
      }
    };
    const stake = (o: Img) => { for (let y = 4; y < 30; y++) { setPx(o, 14, y, OUT); setPx(o, 15, y, WT[3]); setPx(o, 16, y, WT[4]); setPx(o, 17, y, OUT); } for (let x = 14; x < 18; x++) setPx(o, x, 4, OUT); setPx(o, 15, 5, WT[4]); };
    res.fence_wattle = Array.from({ length: 16 }, (_, m) => {
      const o = create(T, T);
      if (m & 1) hurdleV(o, 0, 12);
      if (m & 4) hurdleV(o, 20, 32);
      if (m & 8) hurdleH(o, 0, 16);
      if (m & 2) hurdleH(o, 16, 32);
      stake(o);
      return o;
    });
  }
  // ---- hedge: clipped box hedge; foliage stamped from Grassland bush leaves (wrap-around, so it tiles)
  {
    const bush = L(`${SRC.bush}/bush 8.png`);
    const bb = bboxOf(bush);
    const tex = create(T, T, hex('#3f8a3a'));
    const R = rng(77);
    for (let n = 0; n < 70; n++) {
      const sx = bb.x + 10 + Math.floor(R() * (bb.w - 28)), sy = bb.y + 8 + Math.floor(R() * (bb.h - 24));
      const dx = Math.floor(R() * T), dy = Math.floor(R() * T);
      for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) { const c = px(bush, sx + i, sy + j); if (c[3] === 255 && (i - 3) ** 2 + (j - 3) ** 2 < 11) setPx(tex, (dx + i) % T, (dy + j) % T, c); }
    }
    const G = rampOf(tex);
    const dark = G[0], light = G[G.length - 1];
    const hedge = (m: number) => {
      const o = create(T, T);
      const inH = (x: number, y: number) => (m & 10) !== 0 && y >= 4 && y < 30 && x >= ((m & 8) ? 0 : 3) && x < ((m & 2) ? T : T - 3);
      const inV = (x: number, y: number) => x >= 4 && x < 28 && y >= ((m & 1) ? 0 : 4) && y < ((m & 4) ? T : 30);
      const inside = (x: number, y: number) => {
        if (x < 0 || x >= T || y < 0 || y >= T) return false;
        const b = inH(x, y) || inV(x, y) || ((m & 15) === 0 && x >= 5 && x < 27 && y >= 5 && y < 30);
        if (!b) return false;
        // lumpy silhouette on free edges
        const bump = hash2(x, y >> 2, 5) < 0.3;
        return !(bump && ((y < 6 && !(m & 1)) || (x < 5 && !(m & 8)) || (x > 26 && !(m & 2))));
      };
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        if (!inside(x, y)) continue;
        let c = px(tex, x, y);
        const topRows = (m & 1) ? 0 : 9; // clipped top surface is lighter
        if (y < topRows + 4 && !(m & 1)) c = mix(c, light, 0.25);
        if (y > 24) c = mix(c, dark, (y - 24) / 10);
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 && (m & 8)) return false; if (nx >= T && (m & 2)) return false; if (ny < 0 && (m & 1)) return false; if (ny >= T && (m & 4)) return false;
          return !inside(nx, ny);
        });
        setPx(o, x, y, edge ? hex('#23422a') : c);
      }
      // ground shadow
      for (let x = 0; x < T; x++) if (px(o, x, 29)[3] && !px(o, x, 30)[3]) setPx(o, x, 30, [20, 40, 20, 90]);
      return o;
    };
    res.fence_hedge = Array.from({ length: 16 }, (_, m) => hedge(m));
  }
  return res;
}

function emitFences(fences: Record<string, Img[]>) {
  const heights: Record<string, number> = { fence_wood: 28, fence_wattle: 26, fence_stone: 30, fence_hedge: 28 };
  for (const [id, caps] of Object.entries(fences)) {
    // main sprite = soft contact shadow only; the connected fence piece is the cap overlay (drawn for every cell)
    const sh = create(T, T);
    for (let x = 3; x < 29; x++) setPx(sh, x, 30, [20, 26, 20, 50]);
    put(`${id}_base`, sh, 0, T);
    caps.forEach((img, m) => put(`${id}_cap_${m}`, img, 0, T));
    const capIds = caps.map((_, m) => `${id}_cap_${m}`);
    K.art.walls[id] = {
      fence: true, height: heights[id], heightCut: heights[id],
      face: `${id}_base`, faceAlt: `${id}_base`, faceCut: `${id}_base`, faceCutAlt: `${id}_base`, top: `${id}_base`, topCut: `${id}_base`,
      caps: capIds, capsCut: capIds, doorFrame: `${id}_base`, doorFrameCut: `${id}_base`,
    };
  }
}

// ================================================================= floors
function buildFloors() {
  const I = L(SRC.int);
  const t = (x: number, y: number) => crop(I, x, y, T, T);
  const floors: Record<string, string[]> = {};
  const reg = (id: string, imgs: Img[]) => { floors[id] = imgs.map((img, i) => addTile(`${id}_${i + 1}`, img)); };
  // dirt: interiors packed clay (cracked), 6 cells
  // dirt: Grassland dirt2 centre (packed earth with cracks; the interiors clay tiles carry a border line), mirrored variants
  const earth = tint(crop(L(SRC.dirt2t), 64, 64, T, T), () => true, (h, sat, v) => [h - 2, sat * 0.8, v * 0.82]);
  const mirrors = (c: Img) => [c, flipX(c), rotate90cw(rotate90cw(c)), flipX(rotate90cw(rotate90cw(c)))];
  reg('floor_dirt', mirrors(earth));
  // straw: clay floor strewn with straw (Village hay colours), stalks wrap at the edges so every variant tiles
  const hay = rampOf(L(`${SRC.hay}/hay_0.png`), (c) => { const [h, s] = hsv(c); return h > 25 && h < 60 && s > 0.3; });
  const strawOn = (base: Img, seed: number) => {
    const o = clone(base); const R = rng(seed);
    for (let n = 0; n < 13; n++) {
      let x = Math.floor(R() * T), y = Math.floor(R() * T); const len = 3 + Math.floor(R() * 5); const dx = R() < 0.5 ? 1 : -1, dy = R() < 0.35 ? 1 : 0;
      const c = hay[Math.floor(hay.length * (0.35 + R() * 0.6))] ?? hex('#c8a050');
      for (let i = 0; i < len; i++) { setPx(o, ((x % T) + T) % T, ((y % T) + T) % T, i === 0 ? shade(c, 0.8) : c); x += dx; if (i % 2) y += dy; }
      setPx(o, ((x % T) + T) % T, ((y + 1) % T + T) % T, [70, 52, 40, 110]);
    }
    return o;
  };
  reg('floor_straw', [0, 1, 2, 3].map((i) => strawOn(mirrors(earth)[i], 300 + i)));
  // wood: existing interiors planks
  floors.floor_wood = [1, 2, 3, 4, 5, 6].map((i) => `floor_wood_${i}`);
  // dark wood: same planks in dark oak
  const planks = [1, 2, 3, 4, 5, 6].map((i) => tileImg(`floor_wood_${i}`));
  reg('floor_wood_dark', planks.map((p) => tint(p, () => true, (h, sat, v) => [h - 6, sat * 0.75, v * 0.62])));
  // rough planks: the planks turned crosswise, weathered grey-brown with knots and gaps
  const ROUGH = ramp('#3e3334', '#56463f', '#6b5949', '#7e6a55', '#917b62', '#a18b6f');
  reg('floor_plank_rough', planks.slice(0, 4).map((p, i) => {
    const r = tint(rotate90cw(p), () => true, (h, sat, v) => [h + 14, sat * 0.45, Math.min(1, v * 1.02)]);
    const R = rng(900 + i);
    for (let n = 0; n < 3; n++) { const x = Math.floor(R() * 30), y = Math.floor(R() * 30); setPx(r, x, y, ROUGH[0]); setPx(r, x + 1, y, ROUGH[1]); }
    return r;
  }));
  // stone: existing cobbled flags
  floors.floor_stone = [1, 2, 3, 4].map((i) => `floor_stone_${i}`);
  // flagstone: interiors big grey slabs
  reg('floor_flagstone', [1152, 1184, 1216, 1248, 1280, 1312].map((x) => t(x, 512)));
  // red tile: interiors red brick-bond tiles
  reg('floor_tile_red', [[1152, 224], [1184, 256], [1216, 224], [1248, 256], [1280, 224]].map(([x, y]) => t(x, y)));
  // check: interiors brown checker tiles
  reg('floor_tile_check', [1152, 1216, 1280].map((x) => t(x, 576)));
  // cellar: tamped earth (Grassland dirt2 centre, darker and cooler)
  const d2 = L(SRC.dirt2t);
  const CEL = ramp('#2f2624', '#43352e', '#554337', '#634f40', '#6f5a48', '#7b6552');
  // only the centre cell of dirt2 is grass-free: centre + mirrored/rotated copies (all tile with each other)
  const c0 = tint(crop(d2, 64, 64, T, T), () => true, (h, sat, v) => [h - 4, sat * 0.7, v * 0.5]); void CEL;
  reg('floor_cellar', [c0, flipX(c0), rotate90cw(rotate90cw(c0)), flipX(rotate90cw(rotate90cw(c0)))]);
  artAny().floors = floors;
  return floors;
}

// ================================================================= terrain
function buildTerrain() {
  const grass = tileImg('grass_1');
  const onGrass = (img: Img) => { const o = clone(grass); paste(o, img, 0, 0); return o; };
  // Grassland 2.0 terrain sheets (160 wide) hold a rounded 5x5 blob: the edges sit on the middle of the outer ring, the
  // corners of the inner 3x3 are the inner corners and the outer corners are the quarter pieces of the ring (checked by alpha)
  const POS: Record<string, [number, number]> = { center: [64, 64], n: [64, 0], s: [64, 128], w: [0, 64], e: [128, 64], nw: [0, 32], ne: [128, 32], sw: [0, 96], se: [128, 96], inw: [32, 32], ine: [96, 32], isw: [32, 96], ise: [96, 96] };
  const terrain: Record<string, Record<string, string | string[]>> = {};
  const fromSheet = (id: string, sheet: Img, recolor?: (img: Img) => Img, centers: Array<[number, number]> = [[64, 64]]) => {
    const get = (x: number, y: number) => { const c = crop(sheet, x, y, T, T); return recolor ? recolor(c) : c; };
    const raw: Record<string, Img> = {};
    for (const [k, [x, y]] of Object.entries(POS)) raw[k] = get(x, y);
    const e: Record<string, string | string[]> = {};
    e.center = centers.map(([x, y], i) => addTile(`terrain_${id}_c${i + 1}`, onGrass(get(x, y))));
    for (const k of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) e[k] = addTile(`terrain_${id}_${k}`, onGrass(raw[k]));
    for (const k of ['inw', 'ine', 'isw', 'ise']) e[k] = addTile(`terrain_${id}_${k}`, onGrass(raw[k]));
    terrain[id] = e;
    return raw;
  };
  // grass: existing variants; edges are grass too (grass meets grass)
  const g: Record<string, string | string[]> = { center: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `grass_${i}`) };
  for (const k of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se', 'inw', 'ine', 'isw', 'ise']) g[k] = 'grass_1';
  terrain.grass = g;
  // dirt: rebuilt from the transparent dirt1 sheet (the M4 dirt_n/s/e/w ids point at interior cells of the blob, so they have no edge)
  const d1raw = fromSheet('dirt', L(SRC.dirt1t), undefined, [[64, 64], [64, 32], [32, 64], [96, 64]]);
  // gravel: Grassland gravel to grass (transparent)
  fromSheet('gravel', L(SRC.gravelt), undefined, [[64, 64], [64, 32], [32, 64], [96, 64], [64, 96]]);
  // mud: Grassland dirt2 recoloured dark and wet, a few puddle glints
  const MUD = ramp('#2b211e', '#3b2c25', '#4d3a2e', '#5e4736', '#6d543f', '#7c614a');
  const wet = (img: Img) => {
    // fixed HSV shift (not a per-tile ramp) so every tile of the set gets the same colours
    const o = tint(img, (c) => { const [h, s] = hsv(c); return !(h > 70 && h < 170 && s > 0.3); }, (h, sat, v) => [h - 6, sat * 0.8, v * 0.5]); void MUD;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (hash2(x >> 1, y, 21) < 0.018 && px(o, x, y)[3] === 255 && lum(px(o, x, y)) < 90) { setPx(o, x, y, hex('#8a7a70')); setPx(o, x + 1, y, hex('#6d625c')); }
    return o;
  };
  fromSheet('mud', L(SRC.dirt2t), wet, [[64, 64], [64, 32], [96, 64]]);
  // flowers: grass with Grassland flower sprites; the edge tiles use the dirt edge alpha as the planting mask
  // clumps: Grassland daisies / pink campions / red tulips (items-flowers4..6), stamped on a 2x2 grid per cell with jitter;
  // stamps wrap around the cell so every variant tiles; edge cells keep only the clumps whose root is on the terrain side
  const clumps = ['items-flowers4_3', 'items-flowers4_4', 'items-flowers5_3', 'items-flowers5_4', 'items-flowers6_4', 'items-flowers6_5', 'items-flowers4_5', 'items-flowers5_5']
    .map((f) => trim(L(`${SRC.flowers}/${f}.png`)));
  const plant = (maskImg: Img | null, seed: number) => {
    const o = clone(grass); const R = rng(seed);
    for (const [gx, gy] of [[0, 0], [11, 5], [22, 10], [0, 16], [11, 21], [22, 26]]) {
      const b = clumps[Math.floor(R() * clumps.length)];
      const rx = gx + Math.floor(R() * 5), ry = gy + Math.floor(R() * 5); // root (bottom centre)
      if (maskImg && px(maskImg, rx % T, ry % T)[3] < 160) continue;
      const x0 = rx - (b.w >> 1), y0 = ry - b.h + 1;
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const c = px(b, x, y); if (c[3] > 128) setPx(o, (((x0 + x) % T) + T) % T, (((y0 + y) % T) + T) % T, c); }
    }
    return o;
  };
  const fe: Record<string, string | string[]> = { center: [0, 1, 2, 3].map((i) => addTile(`terrain_flowers_c${i + 1}`, plant(null, 500 + i))) };
  for (const k of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se', 'inw', 'ine', 'isw', 'ise']) fe[k] = addTile(`terrain_flowers_${k}`, plant(d1raw[k], 600 + k.length * 7 + k.charCodeAt(0) * 3));
  terrain.flowers = fe;
  artAny().terrain = terrain;
}

// ================================================================= roofs
interface RoofSrc { file: string; x0: number; ridgeY: number; ridgeH: number; fillY: number; eaveY: number; eaveH: number; recolor?: (img: Img) => Img }
function buildRoofs() {
  const roofs: Record<string, Record<string, string>> = {};
  const specs: Record<string, RoofSrc> = {
    roof_thatch: { file: SRC.roofs2, x0: 256, ridgeY: 368, ridgeH: 16, fillY: 400, eaveY: 485, eaveH: 14 },
    roof_shingle: { file: SRC.roofs2, x0: 232, ridgeY: 530, ridgeH: 16, fillY: 560, eaveY: 645, eaveH: 14 },
    roof_slate: { file: SRC.roofs2, x0: 256, ridgeY: 46, ridgeH: 16, fillY: 96, eaveY: 162, eaveH: 14 },
    roof_tile: { file: SRC.roofTile, x0: 280, ridgeY: 48, ridgeH: 16, fillY: 96, eaveY: 162, eaveH: 14 },
  };
  // thatch: the grass roof re-coloured to old straw
  const STRAW = ramp('#4a3a2a', '#6b5436', '#8c6e40', '#a8864c', '#c09b5a', '#d4b270', '#e3c686');
  specs.roof_thatch.recolor = (img) => rampRecolor(img, STRAW, (c) => { const [h, s] = hsv(c); return h > 50 && h < 175 && s > 0.12; });
  for (const [id, s] of Object.entries(specs)) {
    const src = s.recolor ? s.recolor(crop(L(s.file), 0, 0, 1024, 1024)) : L(s.file);
    const fill = quiltV(quiltH(src, s.x0, s.fillY, T, 64, 12), 0, 0, T, T, 12);
    const fillN = mapPixels(fill, (c) => { const [h, sat, v] = hsv(c); return hsv2rgb(h, sat * 0.9, Math.min(1, v * 1.16), c[3]); });
    const fillS = mapPixels(fill, (c) => shade(c, 0.92));
    const ridge = quiltH(src, s.x0, s.ridgeY, T, s.ridgeH, 12);
    const eave = quiltH(src, s.x0, s.eaveY, T, s.eaveH, 12);
    const P = (k: string, img: Img) => put(`${id}_${k}`, img, 0, img.h);
    const verge = (east: boolean) => {
      const o = create(7, T);
      beam(o, 0, -1, 7, T + 2, true);
      for (let y = 0; y < T; y++) { setPx(o, east ? 0 : 6, y, OUT); if (y % 16 === 8) { setPx(o, 3, y, EPIC_WOOD[2]); } }
      return o;
    };
    roofs[id] = {
      fill: P('fill', fillS), fillN: P('fill_n', fillN), ridge: P('ridge', ridge), eave: P('eave', eave),
      vergeW: P('verge_w', verge(false)), vergeE: P('verge_e', verge(true)),
    };
  }
  artAny().roofs = roofs;
}

// ================================================================= chimneys, slab edges
function buildChimneys() {
  const D = SRC.deco;
  const top = (f: string, h: number, w: number) => {
    const src = trim(L(`${D}/${f}`));
    let c = crop(src, 0, 0, src.w, h);
    if (c.w > w) c = removeCols(c, Math.floor((c.w - (c.w - w)) / 2), Math.floor((c.w - (c.w - w)) / 2) + (c.w - w));
    // flat bottom edge (sits on the roof): outline row
    for (let x = 0; x < c.w; x++) if (px(c, x, c.h - 1)[3]) setPx(c, x, c.h - 1, OUT);
    return c;
  };
  const st = top('chimney-v_4.png', 48, 26), br = top('chimney-h_10.png', 48, 26);
  put('chimney_stone', st, Math.floor(st.w / 2), st.h);
  put('chimney_brick', br, Math.floor(br.w / 2), br.h);
}
function buildSlabEdges() {
  const I = L(SRC.int);
  // wood: interiors mezzanine edge beam (1856.., 1165..1177), 32-periodic quilt
  const w = quiltH(I, 1990, 1164, T, 12, 10);
  put('slab_edge_wood', w, 0, 0);
  // stone: walls-floor1 grey footing strip (160.., 300..)
  const s = quiltH(L(SRC.wf), 160, 312, T, 12, 10);
  put('slab_edge_stone', s, 0, 0);
}

// ================================================================= fire on a burning cell, chimney smoke (animated)
function unionCrop(frames: Img[]): Img[] {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const f of frames) { const b = bboxOf(f); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return frames.map((f) => crop(f, x0, y0, x1 - x0, y1 - y0));
}
/** Nearest-neighbour shrink (only for the small fire; flames are noisy enough that it reads fine). */
function shrink(src: Img, k: number): Img {
  const o = create(Math.max(1, Math.round(src.w * k)), Math.max(1, Math.round(src.h * k)));
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) setPx(o, x, y, px(src, Math.min(src.w - 1, Math.floor(x / k)), Math.min(src.h - 1, Math.floor(y / k))));
  return o;
}
function buildFireSmoke() {
  const A = `${K.paths.GL}/Props/Animated props`;
  // Grassland campfire1 flames (8 frames of 160x160, flames only) re-coloured from the sheet's lime to a house-fire orange
  const FIRE = ramp('#7a2014', '#b5321a', '#df561e', '#f28a2a', '#f9bf48', '#fde68c', '#fff8dc');
  const src = L(`${A}/campfire1 - fire.png`);
  let fr = unionCrop(Array.from({ length: 8 }, (_, i) => rampRecolor(crop(src, i * 160, 0, 160, 160), FIRE, () => true)));
  if (fr[0].h > 44) fr = fr.map((f) => crop(f, 0, f.h - 44, f.w, 44));           // drop the highest sparks
  if (fr[0].w > T) fr = fr.map((f) => crop(f, Math.floor((f.w - T) / 2), 0, T, f.h));
  const put2 = (id: string, frames: Img[], fps: number) => {
    const w = frames[0].w, h = frames[0].h;
    K.emit(id, frames, Math.floor(w / 2), h, { trim: false, fps });
    drawn.set(id, { img: frames[0], ax: Math.floor(w / 2), ay: h });
  };
  put2('house_fire', fr, 10);
  put2('house_fire_small', unionCrop(fr.map((f) => shrink(f, 0.6))), 10);
  // chimney smoke: Grassland chimney 1 white smoke (16 frames of 96x64), puffs rising from the bottom centre
  const sm = L(`${A}/chimney smoke-chiminey 1 - white smoke.png`);
  put2('chimney_smoke', unionCrop(Array.from({ length: 16 }, (_, i) => crop(sm, i * 96, 0, 96, 64))), 8);
}

// ================================================================= stairs + cellar hatch
function buildStairs() {
  // treads: boards laid across the flight (rotated floor planks), lighter than any floor so the steps read
  const planks = tint(rotate90cw(tileImg('floor_wood_2')), () => true, (h, sat, v) => [h + 8, sat * 0.8, Math.min(1, v * 1.28)]);
  const flag = tint(tileImg('floor_flagstone_1'), () => true, (h, sat, v) => [h, sat * 0.6, Math.min(1, v * 1.2)]);
  const N = 8, RISE = 10, RUN = 12;
  const stair = (tread: Img, riser: RGBA[], rail: 'wood' | 'stone') => {
    const Hh = 3 * T + H; // 176
    const o = create(T, Hh);
    for (let i = 0; i < N; i++) {
      // step i: riser (front) at the bottom, tread (top) above it; screen y measured from the canvas bottom
      const riserBot = Hh - i * (RISE + RUN), riserTop = riserBot - RISE, treadTop = riserTop - RUN;
      for (let y = riserTop; y < riserBot; y++) for (let x = 2; x < T - 2; x++) {
        const k = y - riserTop;
        setPx(o, x, y, k === 0 ? riser[4] : k === RISE - 1 ? OUT : riser[k < 3 ? 3 : (x + i * 3) % 11 === 0 ? 1 : 2]);
      }
      for (let y = treadTop; y < riserTop; y++) for (let x = 2; x < T - 2; x++) {
        const c = px(tread, x, (y - treadTop + i * 5) % T);
        setPx(o, x, y, y === treadTop ? shade(c, 0.8) : c);
      }
    }
    // stringers (side boards / side walls)
    for (let y = 0; y < Hh; y++) {
      for (const [x0, dark] of [[0, true], [T - 2, false]] as const) { setPx(o, x0, y, OUT); setPx(o, x0 + 1, y, dark ? riser[1] : riser[2]); }
    }
    if (rail === 'wood') {
      // handrail on the east side: seen from above it runs straight up the screen, newel post at the bottom
      for (let y = 4; y < Hh - 20; y++) { setPx(o, T - 5, y, OUT); setPx(o, T - 4, y, EPIC_WOOD[6]); setPx(o, T - 3, y, EPIC_WOOD[4]); setPx(o, T - 2, y, OUT); }
      beam(o, T - 7, Hh - 30, 7, 28, true);
      for (let x = T - 7; x < T; x++) setPx(o, x, Hh - 31, OUT);
      for (let i = 1; i < N; i++) { const y = Hh - i * (RISE + RUN) - 6; beam(o, T - 6, y, 4, 8, true); }
    } else {
      // low parapet on the east side
      for (let y = 2; y < Hh - 2; y++) { setPx(o, T - 7, y, OUT); for (let x = T - 6; x < T - 1; x++) setPx(o, x, y, (y >> 3) % 2 ? riser[3] : riser[4]); setPx(o, T - 1, y, OUT); }
      for (let x = T - 7; x < T; x++) { setPx(o, x, 1, OUT); setPx(o, x, Hh - 1, OUT); }
      for (let y = 10; y < Hh; y += 16) for (let x = T - 6; x < T - 1; x++) setPx(o, x, y, riser[1]);
    }
    return o;
  };
  const woodRiser = [EPIC_WOOD[1], EPIC_WOOD[2], EPIC_WOOD[3], EPIC_WOOD[4], EPIC_WOOD[5]];
  const stoneRiser = ramp('#4a4446', '#6d6866', '#868180', '#a4a298', '#bdb9a5');
  const sw = stair(planks, woodRiser, 'wood');
  const ss = stair(flag, stoneRiser, 'stone');
  put('stairs_wood', sw, 0, sw.h);
  put('stairs_stone', ss, 0, ss.h);
  K.art.objects.stairs_wood = { default: 'stairs_wood' };
  K.art.objects.stairs_stone = { default: 'stairs_stone' };
  // upper-floor hole (1x3): dark shaft with the slab edge at the far side and a railing along the east edge
  const hole = (edge: string, rail: 'wood' | 'stone') => {
    const Hh = 3 * T + 16;
    const o = create(T, Hh);
    for (let y = 16; y < Hh; y++) for (let x = 0; x < T; x++) {
      const t = (y - 16) / (3 * T);
      setPx(o, x, y, x === 0 || x === T - 1 || y === Hh - 1 ? OUT : mix(hex('#140e12'), hex('#2e2226'), t));
    }
    paste(o, drawn.get(edge)!.img, 0, 16);
    for (let x = 0; x < T; x++) setPx(o, x, 16, OUT);
    if (rail === 'wood') {
      for (let y = 4; y < Hh - 4; y++) { setPx(o, T - 5, y, OUT); setPx(o, T - 4, y, EPIC_WOOD[6]); setPx(o, T - 3, y, EPIC_WOOD[4]); setPx(o, T - 2, y, OUT); }
      for (const y of [4, 40, 76]) beam(o, T - 6, y, 5, 16, true);
    } else {
      for (let y = 4; y < Hh - 4; y++) { setPx(o, T - 7, y, OUT); for (let x = T - 6; x < T - 1; x++) setPx(o, x, y, (y >> 3) % 2 ? stoneRiser[3] : stoneRiser[4]); setPx(o, T - 1, y, OUT); }
    }
    return o;
  };
  const hw = hole('slab_edge_wood', 'wood'), hs = hole('slab_edge_stone', 'stone');
  put('stair_hole_wood', hw, 0, hw.h);
  put('stair_hole_stone', hs, 0, hs.h);
  // cellar hatch: iron-bound plank trapdoor; open = dark shaft with the ladder top, lid thrown back (standing, seen edge-up)
  const lid = create(T, T);
  const pl = rotate90cw(tileImg('floor_wood_3'));
  for (let y = 2; y < 30; y++) for (let x = 2; x < 30; x++) setPx(lid, x, y, shade(px(pl, x, y), 0.9));
  for (let k = 1; k < 31; k++) { setPx(lid, k, 1, OUT); setPx(lid, k, 30, OUT); setPx(lid, 1, k, OUT); setPx(lid, 30, k, OUT); }
  for (const y of [7, 23]) for (let x = 3; x < 29; x++) { setPx(lid, x, y, IRON[1]); setPx(lid, x, y + 1, IRON[3]); }
  for (const [x, y] of [[15, 13], [16, 13], [14, 14], [17, 14], [14, 15], [17, 15], [15, 16], [16, 16]] as const) setPx(lid, x, y, IRON[4]);
  put('cellar_hatch', lid, 0, T);
  const open = create(T, T + 30);
  for (let y = 30; y < T + 30; y++) for (let x = 1; x < T - 1; x++) setPx(open, x, y, x === 1 || x === T - 2 || y === 30 || y === T + 29 ? OUT : mix(hex('#100b0e'), hex('#2a1f22'), (y - 30) / T));
  const ladder = trim(L(`${SRC.tower}/watchtower - stairs - size 3 - front.png`));
  paste(open, crop(ladder, 0, 0, ladder.w, Math.min(ladder.h, 26)), Math.floor((T - ladder.w) / 2), 34);
  // lid standing open at the north edge: edge-on board (seen from the south) rising above the hole
  for (let y = 0; y < 32; y++) for (let x = 2; x < 30; x++) setPx(open, x, y, x === 2 || x === 29 || y === 0 ? OUT : px(pl, x, y % T));
  for (const y of [8, 22]) for (let x = 3; x < 29; x++) { setPx(open, x, y, IRON[1]); setPx(open, x, y + 1, IRON[3]); }
  put('cellar_hatch_open', open, 0, open.h);
  K.art.objects.cellar_hatch = { default: 'cellar_hatch', states: { open: 'cellar_hatch_open' } };
}

// ================================================================= QA sheets
const BG: RGBA = [40, 40, 48, 255];
const YEL: RGBA = [255, 230, 90, 255];
function sprite(id: string): { img: Img; ax: number; ay: number } {
  const d = drawn.get(id); if (d) return d;
  const s = K.art.sprites[id];
  return { img: crop(L(K.art.images[s.image]), s.x, s.y, s.w, s.h), ax: s.anchorX, ay: s.anchorY };
}
function drawSprite(o: Img, id: string, x: number, bottom: number) { const s = sprite(id); paste(o, s.img, x - s.ax, bottom - s.ay); }

function qaWalls(mats: string[], doors: Record<string, DoorArt>, wins: Record<string, WinArt>) {
  // per material: a run A B A B (full), window, door closed/open, a 3x3 closed room ring in cut mode (caps), then cut run
  const rowH = T + H + 24, W = 30 * T;
  const o = create(W, 40 + mats.length * rowH + 2 * (T + H + 30) + 40, BG);
  text(o, 8, 8, 'M5 WALLS: RUN A/B (FULL) + WINDOW + DOOR CLOSED/OPEN/FRAME | CUT RUN + CUT DOOR | CAP RING (16 MASKS)', YEL, 2);
  const floor = tileImg('floor_wood_1');
  mats.forEach((id, j) => {
    const wd = K.art.walls[id] as Record<string, string | string[]>;
    const y0 = 40 + j * rowH, bottom = y0 + T + H;
    text(o, 8, y0 + 4, id.toUpperCase(), YEL, 1);
    for (let i = 0; i < 12; i++) for (const fy of [bottom, bottom + T - 8]) blit(o, floor, 0, 0, T, 8, 8 + i * T, fy, false);
    const seq = [wd.face, wd.faceAlt, wd.face, wd.faceAlt, wd.window, wd.windowAlt, wd.face, wd.door, wd.faceAlt, wd.doorOpen, wd.face, wd.doorFrame] as string[];
    seq.forEach((sid, i) => drawSprite(o, sid, 8 + i * T, bottom));
    const cx = 8 + 13 * T;
    const cut = [wd.faceCut, wd.faceCutAlt, wd.faceCut, wd.doorCut, wd.faceCutAlt, wd.faceCut] as string[];
    cut.forEach((sid, i) => drawSprite(o, sid, cx + i * T, bottom));
    // cap ring: a 4x3 loop of caps (cut) showing corners/runs
    const rx = 8 + 20 * T, ry = y0 + 16;
    const ring: Array<[number, number, number]> = [[0, 0, 2 | 4], [1, 0, 2 | 8], [2, 0, 2 | 8 | 4], [3, 0, 8 | 4], [0, 1, 1 | 4], [2, 1, 1 | 4], [3, 1, 1 | 4], [0, 2, 1 | 2], [1, 2, 2 | 8], [2, 2, 1 | 2 | 8], [3, 2, 1 | 8]];
    for (const [cx2, cy2, m] of ring) drawSprite(o, (wd.capsCut as string[])[m], rx + cx2 * T, ry + (cy2 + 1) * T + HC);
    // door frame cut next to ring
    drawSprite(o, wd.doorSide as string, rx + 5 * T, ry + T + T + H);
    drawSprite(o, wd.windowSide as string, rx + 6 * T, ry + T + T + H);
  });
  // doors & windows over the timber frame
  const y1 = 40 + mats.length * rowH + 10;
  text(o, 8, y1, 'DOORS (CLOSED / OPEN / SIDE) ON WALL_TIMBER AND WALL_STONE FRAMES, WINDOWS (FRONT / SIDE / LIGHT)', YEL, 1);
  let x = 8;
  for (const id of DOORS) {
    const frame = id === 'gate_wood' ? null : K.art.walls.wall_timber.doorFrame as string;
    for (const st of ['closed', 'open'] as const) {
      if (frame) drawSprite(o, frame, x, y1 + 12 + T + H);
      drawSprite(o, `${id}_${st}`, x, y1 + 12 + T + H);
      x += T + 2;
    }
    drawSprite(o, `${id}_side`, x, y1 + 12 + T + H); x += T + 6;
    text(o, x - 3 * T - 10, y1 + 16 + T + H, id.replace('door_', '').toUpperCase(), YEL, 1);
  }
  const y2 = y1 + T + H + 40;
  x = 8;
  for (const id of WINDOWS) {
    drawSprite(o, 'wall_stone_face', x, y2 + T + H); drawSprite(o, `${id}_front`, x, y2 + H);
    drawSprite(o, 'wall_timber_face_b', x + T, y2 + T + H); drawSprite(o, `${id}_front`, x + T, y2 + H);
    drawSprite(o, `${id}_side`, x + 2 * T + 4, y2 + T);
    const l = create(3 * T, 3 * T); for (let i = 0; i < 9; i++) blit(l, floor, 0, 0, T, T, (i % 3) * T, Math.floor(i / 3) * T, false);
    const lt = sprite(`${id}_light`); paste(l, lt.img, T - lt.ax, T + 0 - lt.ay + T);
    blit(o, l, 0, 0, l.w, l.h, x + 3 * T + 8, y2 + 10, false);
    text(o, x, y2 + T + H + 4, id.toUpperCase(), YEL, 1);
    x += 6 * T + 20;
  }
  void doors; void wins;
  save(scale(o, 2), `${QA}/parts-walls.png`);
}

function qaFences() {
  const o = create(4 * (7 * T + 20) + 20, 7 * T + 40, BG);
  text(o, 8, 6, 'M5 FENCES: LOOP + CROSS + GATE (CAPS BY MASK)', YEL, 1);
  const grass = tileImg('grass_1');
  const ids = ['fence_wood', 'fence_wattle', 'fence_stone', 'fence_hedge'];
  // layout: 6x5 grid of cells with a fence loop and a cross; '#' fence, 'G' gate
  const L6 = ['##G###', '#..#.#', '#..#.#', '####.#', '...###'];
  ids.forEach((id, k) => {
    const ox = 10 + k * (7 * T + 20), oy = 20;
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) blit(o, grass, 0, 0, T, T, ox + x * T, oy + y * T, false);
    const at = (x: number, y: number) => y >= 0 && y < L6.length && x >= 0 && x < 6 && L6[y][x] !== '.';
    for (let y = 0; y < L6.length; y++) for (let x = 0; x < 6; x++) {
      if (!at(x, y)) continue;
      const m = (at(x, y - 1) ? 1 : 0) | (at(x + 1, y) ? 2 : 0) | (at(x, y + 1) ? 4 : 0) | (at(x - 1, y) ? 8 : 0);
      if (L6[y][x] === 'G') drawSprite(o, 'gate_wood_closed', ox + x * T, oy + (y + 1) * T);
      else drawSprite(o, `${id}_cap_${m}`, ox + x * T, oy + (y + 1) * T);
    }
    text(o, ox, oy + 6 * T + 4, id.toUpperCase(), YEL, 1);
  });
  return o;
}

function qaFloors(floors: Record<string, string[]>) {
  const ids = Object.keys(floors);
  const cw = 4 * T + 16;
  const o = create(5 * cw + 16, 20 + 2 * (3 * T + 20), BG);
  ids.forEach((id, i) => {
    const x0 = 8 + (i % 5) * cw, y0 = 16 + Math.floor(i / 5) * (3 * T + 20);
    const vs = floors[id];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) blit(o, tileImg(vs[Math.floor(hash2(x, y, i) * vs.length)]), 0, 0, T, T, x0 + x * T, y0 + y * T, false);
    text(o, x0, y0 - 8, `${id.replace('floor_', '').toUpperCase()} (${vs.length})`, YEL, 1);
  });
  save(scale(o, 2), `${QA}/parts-floors.png`);
}

function qaTerrain() {
  const terrain = (K.art as unknown as { terrain: Record<string, Record<string, string | string[]>> }).terrain;
  const ids = ['dirt', 'gravel', 'mud', 'flowers', 'grass'];
  // island shape (6x5 inside an 8x7 grass field): rectangle with a notch → outer and inner corners
  const S = ['........', '.####...', '.######.', '.######.', '.##..##.', '.######.', '........'];
  const o = create(ids.length * (8 * T + 12) + 12, 7 * T + 30, BG);
  const isT = (x: number, y: number) => y >= 0 && y < S.length && x >= 0 && x < 8 && S[y][x] === '#';
  ids.forEach((id, k) => {
    const e = terrain[id]; const ox = 8 + k * (8 * T + 12), oy = 16;
    text(o, ox, 4, id.toUpperCase(), YEL, 1);
    for (let y = 0; y < 7; y++) for (let x = 0; x < 8; x++) {
      let tid: string;
      const pick = (v: string | string[]) => (Array.isArray(v) ? v[Math.floor(hash2(x, y, 3) * v.length)] : v);
      if (!isT(x, y)) tid = pick(terrain.grass.center);
      else {
        const n = isT(x, y - 1), s = isT(x, y + 1), w = isT(x - 1, y), ea = isT(x + 1, y);
        const nw = isT(x - 1, y - 1), ne = isT(x + 1, y - 1), sw = isT(x - 1, y + 1), se = isT(x + 1, y + 1);
        if (!n && !w) tid = pick(e.nw); else if (!n && !ea) tid = pick(e.ne); else if (!s && !w) tid = pick(e.sw); else if (!s && !ea) tid = pick(e.se);
        else if (!n) tid = pick(e.n); else if (!s) tid = pick(e.s); else if (!w) tid = pick(e.w); else if (!ea) tid = pick(e.e);
        else if (!nw) tid = pick(e.inw); else if (!ne) tid = pick(e.ine); else if (!sw) tid = pick(e.isw); else if (!se) tid = pick(e.ise);
        else tid = pick(e.center);
      }
      blit(o, tileImg(tid), 0, 0, T, T, ox + x * T, oy + y * T, false);
    }
  });
  save(scale(o, 2), `${QA}/parts-terrain.png`);
}

function qaRoofs() {
  const roofs = (K.art as unknown as { roofs: Record<string, Record<string, string>> }).roofs;
  const ids = Object.keys(roofs);
  const cw = 8 * T + 40;
  const o = create(ids.length * cw + 16, 5 * T + 80 + 150, BG);
  ids.forEach((id, k) => {
    const r = roofs[id]; const ox = 16 + k * cw; let y = 30;
    text(o, ox, 6, id.toUpperCase(), YEL, 1);
    // north slope 2 rows, ridge on the line, south slope 3 rows, eave; verges on the gable ends
    for (let row = 0; row < 2; row++) for (let i = 0; i < 8; i++) drawSprite(o, r.fillN, ox + i * T, y + (row + 1) * T);
    const ridgeLine = y + 2 * T;
    for (let row = 0; row < 3; row++) for (let i = 0; i < 8; i++) drawSprite(o, r.fill, ox + i * T, ridgeLine + (row + 1) * T);
    const rs = sprite(r.ridge);
    for (let i = 0; i < 8; i++) drawSprite(o, r.ridge, ox + i * T, ridgeLine + Math.floor(rs.img.h / 2));
    const eaveTop = ridgeLine + 3 * T;
    const es = sprite(r.eave);
    for (let i = 0; i < 8; i++) drawSprite(o, r.eave, ox + i * T, eaveTop + es.img.h - 2);
    for (let row = 0; row < 5; row++) { drawSprite(o, r.vergeW, ox - sprite(r.vergeW).img.w, y + (row + 1) * T); drawSprite(o, r.vergeE, ox + 8 * T, y + (row + 1) * T); }
    y = eaveTop + 20;
  });
  // chimneys + slab edges
  const y2 = 5 * T + 80;
  drawSprite(o, 'chimney_stone', 40, y2 + 96); drawSprite(o, 'chimney_brick', 90, y2 + 96);
  drawSprite(o, 'chimney_smoke', 40, y2 + 96 - sprite('chimney_stone').img.h + 4);
  // fire + smoke animation frames
  const anim = (id: string, x: number, bottom: number) => { const s2 = K.art.sprites[id]; const strip = L(K.art.images[s2.image]); for (let f = 0; f < (s2.frames ?? 1); f++) paste(o, crop(strip, s2.x + f * (s2.frameDx ?? s2.w), s2.y, s2.w, s2.h), x + f * (s2.w + 4), bottom - s2.h); return x + (s2.frames ?? 1) * (s2.w + 4); };
  const tf = tileImg('floor_wood_1');
  for (let i = 0; i < 8; i++) blit(o, tf, 0, 0, T, T, 400 + i * 36, y2 + 64, false);
  let ax2 = anim('house_fire', 400, y2 + 96); ax2 = anim('house_fire_small', ax2 + 20, y2 + 96); anim('chimney_smoke', 400, y2 + 150);
  text(o, 400, y2 + 104, 'HOUSE_FIRE / HOUSE_FIRE_SMALL FRAMES, CHIMNEY_SMOKE FRAMES', YEL, 1);
  for (let i = 0; i < 6; i++) { drawSprite(o, 'slab_edge_wood', 140 + i * T, y2 + 10); drawSprite(o, 'slab_edge_stone', 140 + i * T, y2 + 40); }
  text(o, 140, y2, 'SLAB EDGE WOOD / STONE, CHIMNEY STONE / BRICK + SMOKE', YEL, 1);
  save(scale(o, 2), `${QA}/parts-roofs.png`);
}

function qaStairs(fence: Img) {
  const o = create(Math.max(fence.w, 12 * T), 8 * T + fence.h + 20, BG);
  const floor = tileImg('floor_wood_1'), cel = tileImg('floor_stone_1');
  for (let y = 0; y < 7; y++) for (let x = 0; x < 11; x++) blit(o, x < 5 ? floor : cel, 0, 0, T, T, 8 + x * T, 8 + y * T, false);
  drawSprite(o, 'stairs_wood', 8 + T, 8 + 6 * T); drawSprite(o, 'stairs_stone', 8 + 3 * T, 8 + 6 * T);
  drawSprite(o, 'stair_hole_wood', 8 + 6 * T, 8 + 4 * T); drawSprite(o, 'stair_hole_stone', 8 + 7 * T, 8 + 4 * T);
  drawSprite(o, 'cellar_hatch', 8 + 9 * T, 8 + 2 * T); drawSprite(o, 'cellar_hatch_open', 8 + 9 * T, 8 + 5 * T);
  text(o, 8, 8 + 7 * T + 2, 'STAIRS WOOD / STONE, UPPER HOLES, CELLAR HATCH CLOSED / OPEN', YEL, 1);
  blit(o, fence, 0, 0, fence.w, fence.h, 0, 8 * T + 10, false);
  save(scale(o, 2), `${QA}/parts-stairs.png`);
}

// ================================================================= main
export async function buildParts(kit: ArtKit): Promise<void> {
  K = kit;
  initSources();
  fs.mkdirSync(QA, { recursive: true });

  const doors = buildDoors();
  for (const [id, d] of Object.entries(doors)) {
    put(`${id}_closed`, d.closed, 0, H); put(`${id}_open`, d.open, 0, H); put(`${id}_side`, d.side, 0, T + H);
  }
  artAny().doors = Object.fromEntries(DOORS.map((id) => [id, { closed: `${id}_closed`, open: `${id}_open`, side: `${id}_side` }]));
  const wins = buildWindows();
  for (const [id, w] of Object.entries(wins)) {
    put(`${id}_front`, w.front, 0, H); put(`${id}_side`, w.side, 0, T + H);
    put(`${id}_light`, w.light, w.lightAnchor[0], w.lightAnchor[1]);
  }
  artAny().windows = Object.fromEntries(WINDOWS.map((id) => [id, { front: `${id}_front`, side: `${id}_side`, light: `${id}_light` }]));

  // floors first (walls use the plank tiles for door thresholds)
  const floors = buildFloors();
  flushTilesAs('parts_floors.png');

  // walls: existing timber gets the door frame keys, the rest are new materials with the same keys and anchors
  const timber: Mat = { id: 'wall_timber', A: K.faceColumn(224), B: K.faceColumn(256), cap: woodCap, outline: OUT, jamb: 'wood' };
  emitWall(timber, doors.door_plank, wins.win_lattice.front, true);
  const mats = materials();
  const defWin: Record<string, string> = { wall_timber_rose: 'win_lattice', wall_daub: 'win_shutter', wall_daub_white: 'win_shutter', wall_plank: 'win_shutter', wall_stone: 'win_lattice', wall_stone_white: 'win_lattice', wall_ashlar: 'win_glass', wall_brick: 'win_glass' };
  for (const m of mats) emitWall(m, doors.door_plank, wins[defWin[m.id]].front);
  const fences = buildFences();
  emitFences(fences);

  buildTerrain();
  buildTownTerrain();
  flushTilesAs('parts_terrain.png');
  buildRoofs();
  buildChimneys();
  buildSlabEdges();
  buildFireSmoke();
  buildStairs();

  qaWalls(['wall_timber', ...mats.map((m) => m.id)], doors, wins);
  qaFloors(floors);
  qaTerrain();
  qaRoofs();
  qaStairs(qaFences());
  buildTownObjects();
  qaTown();
}

// ================================================================= M6 town (contracts-m6 1~2절): 지형 6종 + 공공 장소 물건
// 원본: Grassland 2.0 (물/모래/밭), Grass Land (돌길/낙엽), Sea Adventures (갑판 널판, 노점, 물고기 바구니), Village (알림판, 건초, 옷감),
// Village interiors (긴 의자, 탁자, 술청, 촛대), Cemetery (묘비), The Depths (높은 의자), Village 물레방아. 생성형 AI 없음
const QA6 = 'artifacts/qa/m6';
const TOWN_KEYS = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se', 'inw', 'ine', 'isw', 'ise'];
const BLOB: Record<string, [number, number]> = { center: [64, 64], n: [64, 0], s: [64, 128], w: [0, 64], e: [128, 64], nw: [0, 32], ne: [128, 32], sw: [0, 96], se: [128, 96], inw: [32, 32], ine: [96, 32], isw: [32, 96], ise: [96, 96] };

function buildTownTerrain() {
  const terrain = artAny().terrain as Record<string, Record<string, string | string[]>>;
  const ERW = K.paths.ERW;
  const grass = tileImg('grass_1');
  const onGrass = (img: Img) => { const o = clone(grass); paste(o, img, 0, 0); return o; };
  const blob = (sheet: Img, oy = 0): Record<string, Img> => {
    const r: Record<string, Img> = {};
    for (const [k, [x, y]] of Object.entries(BLOB)) r[k] = crop(sheet, x, y + oy, T, T);
    return r;
  };
  const reg = (id: string, centers: Img[], edges: Record<string, Img>) => {
    const e: Record<string, string | string[]> = { center: centers.map((c, i) => addTile(`terrain_${id}_c${i + 1}`, c)) };
    for (const k of TOWN_KEYS) e[k] = addTile(`terrain_${id}_${k}`, edges[k]);
    terrain[id] = e;
  };
  const fromBlob = (id: string, sheet: Img, centers: Array<[number, number]>, prep: (img: Img) => Img = (i) => i) => {
    const raw = blob(sheet);
    const edges: Record<string, Img> = {};
    for (const k of TOWN_KEYS) edges[k] = onGrass(prep(raw[k]));
    reg(id, centers.map(([x, y]) => onGrass(prep(crop(sheet, x, y, T, T)))), edges);
  };
  // dirt alpha = the soft grassy fringe every blob terrain uses as its edge mask
  const dirtRaw = blob(L(`${GT()}/dirt1 to grass - transparency.png`));
  const masked = (tex: Img, mask: Img, base: Img = grass) => {
    const o = clone(base);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const a = px(mask, x, y)[3] / 255;
      if (a <= 0) continue;
      const g = px(o, x, y), t = px(tex, x, y);
      setPx(o, x, y, [Math.round(g[0] + (t[0] - g[0]) * a), Math.round(g[1] + (t[1] - g[1]) * a), Math.round(g[2] + (t[2] - g[2]) * a), 255]);
    }
    return o;
  };

  // water: Grassland 2.0 river bank (grass platform to water). The blob sits one row lower than the dirt blob (y + 32).
  // East/west edges stay open water: the river runs west to east and the bridges cross it north-south, so a bridge
  // never shows a bank under its planks
  const WS = `${GT()}/Platform-grass to water`;
  const river = L(`${WS}/water to grass(transparency) - river orientation-spritesheet.png`);
  const wraw = blob(river, 32);
  const full = L(`${WS}/Animated water tiles (full tile).png`);
  const wcen = [crop(full, 0, 0, T, T)];
  // the transparent sheet gives the bank shape over our grass; its water is see-through, so water pixels come from the opaque sheet
  const riverOpaque = L(`${WS}/water to grass - river orientation-spritesheet.png`);
  const oraw = blob(riverOpaque, 32);
  const isWater = (c: RGBA) => { const [h, s, v] = hsv(c); return c[3] === 255 && h > 170 && h < 235 && s > 0.25 && v > 0.45; };
  const bank = (k: string) => { const o = onGrass(wraw[k]); for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const c = px(oraw[k], x, y); if (isWater(c)) setPx(o, x, y, c); } return o; };
  const wedge: Record<string, Img> = {};
  for (const k of TOWN_KEYS) wedge[k] = bank(k);
  wedge.e = wcen[0]; wedge.w = wcen[0];
  reg('water', wcen, wedge);

  // bridge: Sea Adventures deck planks laid across the crossing, a side beam with posts where it meets the water
  const deck = L(`${ERW}/ERW-Sea Adventures-GL2 Expansion/Tilesets/deck.png`);
  const planks = [0, 32, 64].map((x) => { const o = clone(wcen[0]); paste(o, crop(deck, x, 192, T, T), 0, 0); return o; });
  const rail = (side: 'w' | 'e', post: 'n' | 's' | null) => {
    const o = clone(planks[0]);
    const x = side === 'w' ? 0 : T - 6;
    beam(o, x, 0, 6, T, true);
    for (const py of post === 'n' ? [0] : post === 's' ? [T - 9] : [12]) beam(o, x - (side === 'w' ? 0 : 1), py, 7, 9, false, [EPIC_WOOD[2], EPIC_WOOD[4], EPIC_WOOD[5]]);
    return o;
  };
  const bedge: Record<string, Img> = {
    n: planks[1], s: planks[2], e: rail('e', null), w: rail('w', null), nw: rail('w', 'n'), ne: rail('e', 'n'), sw: rail('w', 's'), se: rail('e', 's'),
    inw: planks[0], ine: planks[1], isw: planks[2], ise: planks[0],
  };
  reg('bridge', planks, bedge);

  // road_stone: Grass Land cobbled ground (stone2, transparent) on grass
  fromBlob('road_stone', L(`${ERW}/ERW-Grass Land/Tilesets/stone2 ground-path to transp.png`), [[64, 64], [64, 32], [32, 64], [96, 64]]);
  // sand: Grassland 2.0 sand to grass (transparent)
  fromBlob('sand', L(`${GT()}/sand to grass - transparency.png`), [[64, 64], [64, 32], [32, 64], [96, 64]]);
  // field_soil: plowed furrows (plowed soil and watered, inner cells) with the dirt fringe as edge mask
  const plowed = L(`${GT()}/plowed soil and watered.png`);
  const soil = [crop(plowed, 64, 64, T, T), crop(plowed, 64, 96, T, T), crop(plowed, 96, 64, T, T)];
  const sedge: Record<string, Img> = {};
  for (const k of TOWN_KEYS) sedge[k] = masked(soil[0], dirtRaw[k]);
  reg('field_soil', soil.map((s) => masked(s, dirtRaw.center)), sedge);
  // forest_floor: shaded grass under Grass Land leaf litter recoloured to fallen-leaf browns (fixed HSV shift for every tile)
  const leaves = L(`${ERW}/ERW-Grass Land/Tilesets/leaves to transp.png`);
  const brown = (img: Img) => tint(img, (c) => c[3] > 0, (h, s, v) => [h - 62, Math.min(1, s * 0.7), v * 0.68]);
  const shadeG = tint(grass, () => true, (h, s, v) => [h + 6, s * 1.05, v * 0.8]);
  const fraw = blob(leaves);
  const floor = (mask: Img, lv: Img) => { const o = masked(shadeG, mask); paste(o, brown(lv), 0, 0); return o; };
  const fedge: Record<string, Img> = {};
  for (const k of TOWN_KEYS) fedge[k] = floor(dirtRaw[k], fraw[k]);
  reg('forest_floor', [[64, 64], [64, 32], [32, 64], [96, 64]].map(([x, y]) => floor(dirtRaw.center, crop(leaves, x, y, T, T))), fedge);
}
function GT() { return K.paths.GT; }

// ---- objects
const townObjects = (): Record<string, { footprint: { w: number; h: number } }> => JSON.parse(fs.readFileSync('src/data/objects_town.json', 'utf8'));
function townSprite(id: string, img: Img, fw: number, lift = 2, frames?: Img[], fps = 8): string {
  const a = K.anchorFor(img, fw, lift);
  if (frames) {
    K.emit(id, frames, a.ax, a.ay, { fps });
    drawn.set(id, { img: frames[0], ax: a.ax, ay: a.ay });
  } else put(id, img, a.ax, a.ay);
  return id;
}
/** fixed HSV shift on pixels matched by pred */
const recolor = (img: Img, pred: (c: RGBA, x: number, y: number) => boolean, dh: number, sm = 1, vm = 1) => tint(img, pred, (h, s, v) => [h + dh, s * sm, v * vm]);

function buildTownObjects() {
  const ERW = K.paths.ERW;
  const SEA = `${ERW}/ERW-Sea Adventures-GL2 Expansion/props/atlas-props-sprites`;
  const VP = K.paths.VPROPS;
  const FP = K.paths.FPS;
  const CEM = `${ERW}/ERW - Cemetery/Props/props by individual sprites`;
  const defs = townObjects();
  const fw = (id: string) => defs[id].footprint.w;
  const obj = (id: string, entry: Record<string, unknown>) => { K.art.objects[id] = entry; };

  // market stalls: Sea Adventures canvas stall (little stalls_3/4), awning recoloured per trade, goods set out in front
  const st3 = L(`${SEA}/little stalls_3.png`), st4 = L(`${SEA}/little stalls_4.png`);
  const canvasPx = (c: RGBA, _x: number, y: number) => { const [, s, v] = hsv(c); return y < 60 && s < 0.4 && v > 0.45; };
  const stall = (base: Img, goods: Array<[string, number, number]>) => {
    const o = create(base.w, base.h + 8);
    paste(o, base, 0, 0);
    for (const [f, x, bottom] of goods) { const g = trim(L(f)); paste(o, g, x, bottom - g.h); }
    return o;
  };
  const cloth = mapPixels(st3, (c, x, y) => { if (!canvasPx(c, x, y)) return null; const [, , v] = hsv(c); return hsv2rgb(((x - 16) / 14 | 0) % 2 ? 355 : 215, 0.55, Math.min(1, v * 0.85), c[3]); });
  const green = recolor(st3, canvasPx, 70, 1.6, 0.8);
  const fruit = (n: number) => `${SEA}/basket with fruits-${n}.png`;
  townSprite('town_stall_food', stall(st3, [[fruit(1), 4, 128], [fruit(3), 124, 128], [`${SEA}/crates with fruits_0.png`, 36, 132]]), fw('market_stall_food'));
  townSprite('town_stall_cloth', stall(cloth, [[`${VP}/cloths_1.png`, 6, 120], [`${VP}/cloths_4.png`, 128, 120]]), fw('market_stall_cloth'));
  townSprite('town_stall_tools', stall(st4, [[`${GS1()}/crate 3 - no grass.png`, 2, 130], [`${GS1()}/small woodplanks 1 - no grass.png`, 118, 130]]), fw('market_stall_tools'));
  townSprite('town_stall_livestock', stall(green, [[`${VP}/hay_0.png`, 0, 132], [`${SEA}/basket with fishes-1.png`, 122, 130]]), fw('market_stall_livestock'));
  obj('market_stall_food', { default: 'town_stall_food' });
  obj('market_stall_cloth', { default: 'town_stall_cloth' });
  obj('market_stall_tools', { default: 'town_stall_tools' });
  obj('market_stall_livestock', { default: 'town_stall_livestock' });

  // church: gold-clothed altar table narrowed to 3 cells, candles on top; pew = interiors long bench
  const altarT = removeCols(L(`${FP}/big_rect_table_2.png`), 48, 80);
  const altar = create(altarT.w, altarT.h + 24);
  paste(altar, altarT, 0, 24);
  const cndl = trim(L(`${FP}/candlestickss_2.png`));
  paste(altar, cndl, 26, 24 + 26 - cndl.h); paste(altar, cndl, altar.w - 26 - cndl.w, 24 + 26 - cndl.h);
  const bowl = trim(L(`${K.paths.GS2}/shrine 1.png`));
  paste(altar, bowl, (altar.w - bowl.w) >> 1, 24 + 22 - bowl.h);
  townSprite('town_altar', altar, fw('church_altar'), 1);
  obj('church_altar', { default: 'town_altar' });
  townSprite('town_pew', trim(L(`${FP}/bench_2.png`)), fw('church_pew'), 1);
  obj('church_pew', { default: 'town_pew' });

  // inn counter: interiors wooden L counter (stand-2) without its return, 3 cells long
  const s2 = L(`${FP}/stand-2.png`);
  const bb = bboxOf(s2);
  let bar = crop(s2, bb.x, bb.y + 26, bb.w, bb.h - 26);
  if (bar.w > 96) bar = removeCols(bar, 36, 36 + (bar.w - 96));
  const mugs = create(bar.w, bar.h + 10);
  paste(mugs, bar, 0, 10);
  const jug = trim(L(`${FP}/kitchen_props2_24_.png`));
  paste(mugs, jug, 60, 18 - jug.h + 4);
  townSprite('town_inn_counter', mugs, fw('inn_counter'), 1);
  obj('inn_counter', { default: 'town_inn_counter' });

  // public bath: a big stave tub (Epic wood ramp, iron hoops) holding the Grassland water tile, steam wisps
  const tub = create(96, 64);
  const water = crop(L(`${GT()}/Platform-grass to water/Animated water tiles (full tile).png`), 0, 0, T, T);
  const inEll = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) {
    const body = x >= 2 && x < 94 && y >= 20 && y < 60 && (y < 52 || inEll(x, y, 48, 52, 46, 8));
    const top = inEll(x, y, 48, 20, 46, 14);
    if (!body && !top) continue;
    if (top) {
      const inner = inEll(x, y, 48, 21, 40, 10);
      setPx(tub, x, y, inner ? px(water, x % T, y % T) : (inEll(x, y, 48, 20, 44, 12.5) ? EPIC_WOOD[6] : OUT));
      continue;
    }
    const stave = ((x - 2) / 8) | 0;
    const shadeK = 0.8 + 0.2 * Math.sin((x / 94) * Math.PI);
    const band = (y >= 29 && y < 32) || (y >= 46 && y < 49);
    const edge = (x - 2) % 8 === 0;
    const c = band ? IRON[x % 5 === 0 ? 3 : 2] : edge ? EPIC_WOOD[2] : EPIC_WOOD[4 + (stave % 2)];
    setPx(tub, x, y, band ? c : shade(c, shadeK));
  }
  for (let x = 2; x < 94; x++) setPx(tub, x, 59, OUT);
  townSprite('town_bath_tub', tub, fw('bath_tub_public'), 1);
  obj('bath_tub_public', { default: 'town_bath_tub' });

  // notice board: Village quest board with papers
  const board = clone(L(`${VP}/questboard_1.png`));
  const papers = L(`${VP}/questboard_papers_1.png`);
  if (papers.w === board.w && papers.h === board.h) paste(board, papers, 0, 0);
  else { const pp = trim(papers); const bb2 = bboxOf(board); paste(board, pp, bb2.x + ((bb2.w - pp.w) >> 1), bb2.y + 8); }
  townSprite('town_notice_board', trim(board), fw('notice_board_town'), 2);
  obj('notice_board_town', { default: 'town_notice_board' });

  // fishing spot: a staked rod with its line over the water and a basket of fish (flipped when the water is south)
  const fish = create(32, 48);
  const basket = trim(L(`${SEA}/basket with fishes-1.png`));
  const bk = basket.w > 22 ? crop(basket, 0, 0, 22, basket.h) : basket;
  paste(fish, bk, 0, 48 - bk.h);
  for (let i = 0; i < 26; i++) { const x = 18 + (i >> 2), y = 44 - i; setPx(fish, x, y, EPIC_WOOD[i % 3 === 0 ? 3 : 5]); setPx(fish, x + 1, y, OUT); }
  for (let y = 18; y < 30; y++) setPx(fish, 25 + ((y - 18) >> 3), y, [230, 230, 220, 200]);
  townSprite('town_fishing', fish, 1, 1);
  const fishUp = create(32, 48);
  paste(fishUp, fish, 0, 0, true);
  townSprite('town_fishing_s', fishUp, 1, 1);
  obj('fishing_spot', { default: 'town_fishing', rot: { 2: 'town_fishing_s' } });

  // wild herbs: Grassland vegetation clumps with wildflowers
  const herb = create(64, 40);
  const vg = (n: number) => trim(L(`${GS1()}/vegetation ${n}.png`));
  const fl = (f: string) => trim(L(`${K.paths.GL}/Props/Static props/items-flowers-mushrooms-sprites/${f}.png`));
  const bu = (n: number) => trim(L(`${GS1()}/bush ${n}.png`));
  const hv = [bu(3), bu(7), fl('items-flowers3_1'), fl('items-flowers1_2'), fl('items-flowers2_1')];
  void vg;
  paste(herb, hv[0], 2, 38 - hv[0].h); paste(herb, hv[1], 30, 38 - hv[1].h); paste(herb, hv[2], 20, 39 - hv[2].h); paste(herb, hv[3], 46, 39 - hv[3].h); paste(herb, hv[4], 8, 39 - hv[4].h);
  townSprite('town_herbs', herb, fw('herb_patch_wild'), 1);
  obj('herb_patch_wild', { default: 'town_herbs' });

  // guild table: green-clothed long table
  townSprite('town_guild_table', trim(L(`${FP}/big_rect_table_1.png`)), fw('guild_table'), 1);
  obj('guild_table', { default: 'town_guild_table' });

  // lord's seat: The Depths high-backed throne (plain version)
  townSprite('town_throne', trim(L(`${ERW}/ERW - The Depths/Props/Static/Props-individual sprites/boss-throne2.png`)), fw('lord_throne'), 1);
  obj('lord_throne', { default: 'town_throne' });

  // mill wheel: Village watermill wheel, 7 frames (3 per row of 192x224 cells), lower rim dips below its row into the race
  const mill = L(`${K.paths.VIL}/buildings/Animated stuff/watermill_with-fx_simpler.png`);
  const mframes = [0, 1, 2, 3, 4, 5, 6].map((i) => crop(mill, (i % 3) * 192, Math.floor(i / 3) * 224, 192, 224));
  const mb = bboxOf(mframes[0]);
  const ma = K.anchorFor(mframes[0], fw('mill_wheel'), -22);
  K.emit('town_mill_wheel', mframes, ma.ax, ma.ay, { fps: 7 });
  drawn.set('town_mill_wheel', { img: mframes[0], ax: ma.ax, ay: ma.ay });
  void mb;
  obj('mill_wheel', { default: 'town_mill_wheel' });

  // tourney lists: Grassland wooden fence run with festival pennants
  const fence = (f: string) => trim(L(`${GS1()}/${f}.png`));
  const fl0 = fence('fence - left - end'), fm = fence('fence - left - right - 1'), fr = fence('fence - right - end');
  const lists = create(128, 64);
  let lx = 0;
  const fy = 60;
  paste(lists, fl0, lx, fy - fl0.h); lx += fl0.w;
  while (lx + fm.w + fr.w <= 128) { paste(lists, fm, lx, fy - fm.h); lx += fm.w; }
  paste(lists, fr, lx, fy - fr.h);
  const pen = trim(L(`${VP}/pennant-bunting_0.png`));
  for (let x = 4; x + pen.w <= 124; x += pen.w) paste(lists, pen, x, fy - fm.h - 6);
  townSprite('town_lists', lists, fw('tourney_lists'), 2);
  obj('tourney_lists', { default: 'town_lists' });

  // graves: Cemetery tombstones in daylight grey (desaturated), and an earth mound
  const grey = (f: string) => recolor(trim(L(`${CEM}/${f}.png`)), (c) => c[3] > 0, 0, 0.18, 1.35);
  const gv: Record<string, Img> = { round: grey('tombstone - 1'), slab: grey('tombstone - 5'), tall: grey('tombstone - tall - 1'), worn: grey('tombstone - 3') };
  for (const [v, img] of Object.entries(gv)) townSprite(`town_grave_${v}`, img, 1, 1);
  obj('grave', { default: 'town_grave_round' });
  for (const v of Object.keys(gv)) obj(`grave__${v}`, { default: `town_grave_${v}` });
}
function GS1() { return K.paths.GS1; }

function qaTown() {
  fs.mkdirSync(QA6, { recursive: true });
  const terrain = artAny().terrain as Record<string, Record<string, string | string[]>>;
  const ids = ['water', 'bridge', 'road_stone', 'field_soil', 'sand', 'forest_floor'];
  const S = ['........', '.####...', '.######.', '.######.', '.##..##.', '.######.', '........'];
  const cw = 8 * T + 12;
  const o = create(3 * cw + 12, 2 * (7 * T + 24) + 560, BG);
  const isT = (x: number, y: number) => y >= 0 && y < S.length && x >= 0 && x < 8 && S[y][x] === '#';
  ids.forEach((id, k) => {
    const e = terrain[id]; const ox = 8 + (k % 3) * cw, oy = 16 + Math.floor(k / 3) * (7 * T + 24);
    text(o, ox, oy - 12, id.toUpperCase(), YEL, 1);
    for (let y = 0; y < 7; y++) for (let x = 0; x < 8; x++) {
      const pick = (v: string | string[]) => (Array.isArray(v) ? v[Math.floor(hash2(x, y, 3) * v.length)] : v);
      let tid: string;
      if (!isT(x, y)) tid = pick(id === 'bridge' ? terrain.water.center : terrain.grass.center);
      else {
        const n = isT(x, y - 1), s = isT(x, y + 1), w = isT(x - 1, y), ea = isT(x + 1, y);
        const nw = isT(x - 1, y - 1), ne = isT(x + 1, y - 1), sw = isT(x - 1, y + 1), se = isT(x + 1, y + 1);
        if (!n && !w) tid = pick(e.nw); else if (!n && !ea) tid = pick(e.ne); else if (!s && !w) tid = pick(e.sw); else if (!s && !ea) tid = pick(e.se);
        else if (!n) tid = pick(e.n); else if (!s) tid = pick(e.s); else if (!w) tid = pick(e.w); else if (!ea) tid = pick(e.e);
        else if (!nw) tid = pick(e.inw); else if (!ne) tid = pick(e.ine); else if (!sw) tid = pick(e.isw); else if (!se) tid = pick(e.ise);
        else tid = pick(e.center);
      }
      blit(o, tileImg(tid), 0, 0, T, T, ox + x * T, oy + y * T, false);
    }
  });
  // objects on a grass strip, footprint outlined
  const y0 = 2 * (7 * T + 24) + 20;
  const gt = tileImg('grass_1');
  for (let y = y0; y < o.h - 4; y += T) for (let x = 8; x < o.w - T; x += T) blit(o, gt, 0, 0, T, T, x, y, false);
  const list: Array<[string, string]> = Object.entries(K.art.objects).filter(([id]) => id in townObjects() || id.startsWith('grave__')).map(([id, e]) => [id, (e as { default: string }).default]);
  list.push(['fishing_spot@2', 'town_fishing_s']);
  const defs = townObjects();
  let x = 16, row = 0;
  for (const [id, sid] of list) {
    const d = defs[id.replace(/__.*|@.*/, '')];
    const w = d.footprint.w * T;
    if (x + w > o.w - 16) { x = 16; row++; }
    const bottom = y0 + 150 + row * 170;
    for (let i = 0; i < w; i++) { setPx(o, x + i, bottom, [255, 0, 255, 255]); setPx(o, x + i, bottom - d.footprint.h * T, [255, 0, 255, 255]); }
    drawSprite(o, sid, x, bottom);
    text(o, x, bottom + 4, id.toUpperCase().slice(0, 22), YEL, 1);
    x += Math.max(w, 90) + 16;
  }
  save(scale(o, 2), `${QA6}/map-parts.png`);
}

void widen; void fillRect; void opaqueOnly; void vcat; void over;
