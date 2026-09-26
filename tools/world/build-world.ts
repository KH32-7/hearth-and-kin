// Builds the Epic RPG World art pack for the world: generated sprites (assets/generated/world/*.png)
// and src/data/artpacks/epic.json. Footprints come from src/data/objects.json.
// Run: npx tsx tools/world/build-world.ts
import fs from 'node:fs';
import path from 'node:path';
import { Img, load, save, create, crop, blit, scale, text } from './png';
import {
  RGBA, paste, bboxOf, widen, heighten, removeCols, rotate90ccw, mapPixels, hsv, hex, rampRecolor, keep, hstack, px, setPx, clone, lum,
} from './imgops';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
process.chdir(ROOT);

// ---------------------------------------------------------------- sources
const INT = 'assets/vendor/epic-rpg-world-free-interiors/Epic RPG World - Village(interiors) V1.3/assets';
const FPS = `${INT}/furniture_and_props_sprites`;
const WIN = `${INT}/windows_and_doors_sprites`;
const ANI = `${INT}/animations`;
const INT_TILES = `${INT}/Interiors_tilesets.png`;
const ERW = 'assets/vendor/epic-rpg-world/RafaelMatos';
const VIL = `${ERW}/ERW - The Village`;
const VPROPS = `${VIL}/tilesets and props/props-sprites`;
const VDECO = `${VIL}/buildings/Decorations_sprites`;
const VWALLS = `${VIL}/buildings/walls1.png`;
const GL = `${ERW}/ERW-Grassland 2.0`;
const GS1 = `${GL}/Props/Static props/sheet1-sprites`;
const GS2 = `${GL}/Props/Static props/sheet2-sprites`;
const GT = `${GL}/Tilesets`;
const SZ_FIRE = 'assets/vendor/szadi-fantasy-lands-houses/_PNG/Interriors/Anim/FL_Houses_fireplaceA.png';
const LPC_WHEEL = 'assets/vendor/lpc/lpc-revised/Objects/Furniture/Sewing & Weaving/Spinning Wheel.png';
const LPC_LUTE = 'assets/vendor/lpc/oga/lpc-tavern/lpc-tavern/lute.png';
// M4 (살림, 일, 농사)
const GLOLD = `${ERW}/ERW-Grass Land/Props/Atlas-Props-individual sprites`; // old Grass Land: blacksmith forge/anvil
const GS4 = `${GL}/Props/Static props/sheet4-sprites`;                     // Grassland 2.0 crops update
const GANI = `${GL}/Props/Animated props`;
const PLOWED = `${GT}/plowed soil and watered.png`;
const DIRT1 = `${GT}/dirt1 to grass.png`;
const LREV = 'assets/vendor/lpc/lpc-revised/Objects';
const LPC_FRUIT = 'assets/vendor/lpc/oga/lpc-fruit-trees/lpc-fruit-trees/fruit-trees.png';
const QA_M4 = 'artifacts/qa/m4';

const GEN = 'assets/generated/world';
const T = 32;
export const WALL_H = 80;   // full wall face height (px)
export const WALL_HC = 20;  // cut (lowered) wall face height (px)

const objects: Record<string, { footprint: { w: number; h: number }; wallMounted?: boolean }> =
  JSON.parse(fs.readFileSync('src/data/objects.json', 'utf8'));

// ---------------------------------------------------------------- artpack model
interface Sprite { image: string; x: number; y: number; w: number; h: number; anchorX: number; anchorY: number; frames?: number; frameDx?: number; fps?: number }
const art = {
  id: 'epic',
  tilePx: T,
  images: {} as Record<string, string>,
  tiles: {} as Record<string, { image: string; x: number; y: number }>,
  sprites: {} as Record<string, Sprite>,
  walls: {} as Record<string, Record<string, unknown>>,
  objects: {} as Record<string, Record<string, unknown>>,
};
const imageIds = new Map<string, string>();
function imageId(file: string): string {
  const hit = imageIds.get(file);
  if (hit) return hit;
  let base = path.basename(file, '.png').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (file.startsWith(GEN)) base = 'gen_' + base;
  let id = base, n = 2;
  while (art.images[id]) id = `${base}_${n++}`;
  art.images[id] = file;
  imageIds.set(file, id);
  return id;
}

const L = (f: string) => load(f);

/** Anchor in canvas coordinates: sprite centred on the footprint, opaque bottom `lift` px above the footprint's bottom edge. */
function anchorFor(base: Img, fw: number, lift = 2, center?: number): { ax: number; ay: number } {
  const b = bboxOf(base);
  const cx = center ?? b.x + b.w / 2;
  return { ax: Math.round(cx - (fw * T) / 2), ay: b.y + b.h + lift };
}

/** Save frames (same canvas size) trimmed to their union bbox as a horizontal strip; register sprite. */
function emit(id: string, frames: Img[], ax: number, ay: number, opts: { fps?: number; trim?: boolean; rect?: { x: number; y: number; w: number; h: number } } = {}): Sprite {
  let bx = 0, by = 0, bw = frames[0].w, bh = frames[0].h;
  if (opts.rect) ({ x: bx, y: by, w: bw, h: bh } = opts.rect);
  else if (opts.trim !== false) {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (const f of frames) { const b = bboxOf(f); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    bx = x0; by = y0; bw = x1 - x0; bh = y1 - y0;
  }
  const strip = hstack(frames.map((f) => crop(f, bx, by, bw, bh)));
  const file = `${GEN}/${id}.png`;
  save(strip, file);
  const s: Sprite = { image: imageId(file), x: 0, y: 0, w: bw, h: bh, anchorX: ax - bx, anchorY: ay - by };
  if (frames.length > 1) { s.frames = frames.length; s.frameDx = bw; s.fps = opts.fps ?? 8; }
  art.sprites[id] = s;
  return s;
}

/** Register a sprite that points straight into a vendor file (trimmed to opaque bbox of rect). */
function emitVendor(id: string, file: string, fw: number, lift = 2, rect?: { x: number; y: number; w: number; h: number }): Sprite {
  const src = L(file);
  const r = rect ?? { x: 0, y: 0, w: src.w, h: src.h };
  const c = crop(src, r.x, r.y, r.w, r.h);
  const b = bboxOf(c);
  const a = anchorFor(c, fw, lift);
  const s: Sprite = { image: imageId(file), x: r.x + b.x, y: r.y + b.y, w: b.w, h: b.h, anchorX: a.ax - b.x, anchorY: a.ay - b.y };
  art.sprites[id] = s;
  return s;
}

function flipY(src: Img): Img { const o = create(src.w, src.h); for (let y = 0; y < src.h; y++) blit(o, src, 0, y, src.w, 1, 0, src.h - 1 - y, false); return o; }
const fp = (id: string) => objects[id].footprint;

// Epic wood ramp (dark→light), sampled from interiors furniture, used to pull LPC items toward Epic tones.
const EPIC_WOOD: RGBA[] = ['#3b2630', '#513c47', '#6e4a42', '#8a5a44', '#a0693f', '#b57b4b', '#c98f5a', '#dcae78'].map((h) => hex(h));
const isWoodish = (c: RGBA) => { const [h, s, v] = hsv(c); return (h < 50 || h > 340) && s > 0.2 && v > 0.12; };

// ================================================================= tiles
function tile(id: string, file: string, x: number, y: number) { art.tiles[id] = { image: imageId(file), x, y }; }
function buildTiles() {
  const grass = `${GT}/base grass.png`;
  // 5x5 variant block at (192..352, 0..160)
  const gv: Array<[number, number]> = [[192, 0], [224, 32], [256, 64], [288, 96], [224, 96], [320, 32], [256, 0], [192, 128]];
  gv.forEach(([x, y], i) => tile(`grass_${i + 1}`, grass, x, y));
  const dirt = `${GT}/dirt1 to grass.png`;
  tile('dirt_c', dirt, 64, 64); tile('dirt_n', dirt, 64, 32); tile('dirt_s', dirt, 64, 96);
  tile('dirt_w', dirt, 32, 64); tile('dirt_e', dirt, 96, 64);
  tile('dirt_nw', dirt, 32, 32); tile('dirt_ne', dirt, 96, 32); tile('dirt_sw', dirt, 32, 96); tile('dirt_se', dirt, 96, 96);
  tile('grass_dirty_1', dirt, 128, 128); tile('grass_dirty_2', dirt, 0, 128);
  // interior floors
  const pl: Array<[number, number]> = [[1152, 32], [1184, 64], [1216, 96], [1248, 32], [1280, 64], [1312, 96]];
  pl.forEach(([x, y], i) => tile(`floor_wood_${i + 1}`, INT_TILES, x, y));
  art.tiles.floor_wood = art.tiles.floor_wood_1;
  const st: Array<[number, number]> = [[1152, 1024], [1184, 1056], [1216, 1024], [1248, 1056]];
  st.forEach(([x, y], i) => tile(`floor_stone_${i + 1}`, INT_TILES, x, y));
  art.tiles.floor_stone = art.tiles.floor_stone_1;
}

// ================================================================= walls
// Half-timber face from The Village walls1 "wall design 6" (tileable 64px piece at x 224..288, y 1600..1718).
const WALL_ROWS: Array<[number, number]> = [[1600, 1607], [1607, 1627], [1666, 1690], [1690, 1698], [1698, 1712], [1712, 1718]]; // → 7+20+24+8+14+6 = 79 (+1 pad row)
const C = {
  outline: hex('#513c47'), beamD: hex('#7d6a56'), beam: hex('#8e7756'), beamL: hex('#a38a63'), post: hex('#b07e52'), postD: hex('#785b5b'),
  plaster: hex('#beb57e'), plasterD: hex('#a89d6c'), capD: hex('#5e4640'), cap: hex('#6f5448'), capL: hex('#8a6a55'),
};

function faceColumn(x0: number): Img {
  const src = L(VWALLS);
  const out = create(T, WALL_H);
  let y = 0;
  for (const [a, b] of WALL_ROWS) { blit(out, src, x0, a, T, b - a, 0, y, false); y += b - a; }
  while (y < WALL_H) { blit(out, src, x0, 1717, T, 1, 0, y, false); y++; }
  return out;
}

/** Wall top (cross-section) seen from above. mask bits: N=1 E=2 S=4 W=8 (neighbour is a wall). */
function capTile(mask: number): Img {
  const o = create(T, T, C.cap);
  const vertical = (mask & 5) !== 0 && (mask & 10) === 0;
  // grain
  for (let i = 0; i < T; i++) for (let j = 0; j < T; j++) {
    const g = vertical ? (i % 8 === 3 ? 1 : 0) : (j % 8 === 3 ? 1 : 0);
    if (g) setPx(o, i, j, C.capD);
  }
  // plank joints every 32 along the run direction are implicit at tile edges; exposed edges get outline + bevel
  const edge = (side: 'N' | 'E' | 'S' | 'W') => {
    for (let k = 0; k < T; k++) {
      if (side === 'N') { setPx(o, k, 0, C.outline); setPx(o, k, 1, C.capL); }
      if (side === 'S') { setPx(o, k, T - 1, C.outline); setPx(o, k, T - 2, C.capD); }
      if (side === 'W') { setPx(o, 0, k, C.outline); setPx(o, 1, k, C.capL); }
      if (side === 'E') { setPx(o, T - 1, k, C.outline); setPx(o, T - 2, k, C.capD); }
    }
  };
  if (!(mask & 1)) edge('N');
  if (!(mask & 4)) edge('S');
  if (!(mask & 8)) edge('W');
  if (!(mask & 2)) edge('E');
  // re-apply corner pixels so outlines win over bevels
  for (const [cx, cy, m] of [[0, 0, 9], [T - 1, 0, 3], [0, T - 1, 12], [T - 1, T - 1, 6]] as const) if ((mask & m) === 0 || true) {
    const nOrS = cy === 0 ? 1 : 4, wOrE = cx === 0 ? 8 : 2;
    if (!(mask & nOrS) || !(mask & wOrE)) setPx(o, cx, cy, C.outline);
  }
  return o;
}

/** A full wall cell sprite: cap on top of a face of height fh. */
function wallCell(face: Img, fh: number, capMask: number): Img {
  const o = create(T, T + fh);
  paste(o, capTile(capMask), 0, 0);
  blit(o, face, 0, face.h - fh, T, fh, 0, T, false);
  // dark line where the cap meets the face
  for (let x = 0; x < T; x++) setPx(o, x, T, C.outline);
  return o;
}

function buildWalls() {
  const faceA = faceColumn(224), faceB = faceColumn(256);
  const H = WALL_H, HC = WALL_HC;
  const ay = T + H, ayc = T + HC;
  const HORIZ = 2 | 8; // E+W neighbours: horizontal run look
  const put = (id: string, img: Img, a: number) => emit(id, [img], 0, a, { trim: false });

  put('wall_timber_face', wallCell(faceA, H, HORIZ), ay);
  put('wall_timber_face_b', wallCell(faceB, H, HORIZ), ay);
  put('wall_timber_face_cut', wallCell(faceA, HC, HORIZ), ayc);
  put('wall_timber_face_cut_b', wallCell(faceB, HC, HORIZ), ayc);
  put('wall_timber_top', capTile(1 | 4), ay);
  put('wall_timber_top_cut', capTile(1 | 4), ayc);
  for (let m = 0; m < 16; m++) {
    put(`wall_timber_cap_${m}`, capTile(m), ay);
    art.sprites[`wall_timber_cap_cut_${m}`] = { ...art.sprites[`wall_timber_cap_${m}`], anchorY: ayc };
  }

  // ---- door: narrow plank door cut from interiors doors1-_0 (60x70 incl. lintel) to 26px
  const dsrc = crop(L(`${WIN}/no_sunlight/doors1-_0.png`), 0, 26, 64, 70);
  const leaf = create(28, 70);
  blit(leaf, dsrc, 2, 0, 14, 70, 0, 0, false);
  blit(leaf, dsrc, 48, 0, 14, 70, 14, 0, false);
  const doorFace = clone(faceA);
  const dx = Math.floor((T - leaf.w) / 2);
  // clear the opening area and paste door (bottom aligned)
  paste(doorFace, leaf, dx, H - leaf.h);
  put('wall_timber_door', wallCell(doorFace, H, HORIZ), ay);
  // open door: frame + transparent opening (see-through), leaf swung inward drawn as a thin dark strip
  const openFace = clone(doorFace);
  const ox0 = dx + 4, ox1 = dx + leaf.w - 4, oy0 = H - leaf.h + 11;
  for (let y = oy0; y < H; y++) for (let x = ox0; x < ox1; x++) setPx(openFace, x, y, [0, 0, 0, 0]);
  for (let y = oy0; y < H; y++) { setPx(openFace, ox0, y, C.outline); setPx(openFace, ox0 + 1, y, hex('#8a4a3e')); setPx(openFace, ox0 + 2, y, hex('#6e3a34')); }
  put('wall_timber_door_open', wallCell(openFace, H, HORIZ), ay);
  // cut door: low jambs only, opening transparent
  const cutDoor = wallCell(faceA, HC, HORIZ);
  for (let y = 0; y < cutDoor.h; y++) for (let x = ox0 - 2; x < ox1 + 2; x++) setPx(cutDoor, x, y, [0, 0, 0, 0]);
  put('wall_timber_door_cut', cutDoor, ayc);

  // ---- window: small leaded window windows2-_3 (27x31) centred high in the face
  const wsrc = L(`${WIN}/no_sunlight/windows2-_3.png`);
  const wb = bboxOf(wsrc);
  const win = crop(wsrc, wb.x, wb.y, wb.w, wb.h);
  const winFace = clone(faceA);
  paste(winFace, win, Math.floor((T - win.w) / 2), 14);
  put('wall_timber_window', wallCell(winFace, H, HORIZ), ay);
  const winFaceB = clone(faceB);
  paste(winFaceB, win, Math.floor((T - win.w) / 2), 14);
  put('wall_timber_window_b', wallCell(winFaceB, H, HORIZ), ay);
  // cut window: low wall with a sill hint (window is above the cut height)
  const wcut = wallCell(faceA, HC, HORIZ);
  put('wall_timber_window_cut', wcut, ayc);
  // side (east/west wall) variants: cap seen from above with the opening marked
  const winSide = capTile(1 | 4);
  for (let y = 6; y < 26; y++) for (let x = 11; x < 21; x++) setPx(winSide, x, y, x === 11 || x === 20 ? C.outline : hex(y % 5 === 0 ? '#5b7fa8' : '#7ea3c8'));
  put('wall_timber_window_side', winSide, ay);
  art.sprites.wall_timber_window_side_cut = { ...art.sprites.wall_timber_window_side, anchorY: ayc };
  // doorway in an east/west wall seen from above: the cap is interrupted and the threshold planks show
  const doorSide = capTile(1 | 4);
  const flr = L(INT_TILES);
  for (let y = 3; y < 29; y++) for (let x = 0; x < T; x++) {
    const c = px(flr, 1152 + x, 32 + y);
    setPx(doorSide, x, y, y === 3 || y === 28 ? C.outline : [Math.round(c[0] * 0.7), Math.round(c[1] * 0.7), Math.round(c[2] * 0.7), 255]);
  }
  put('wall_timber_door_side', doorSide, ay);
  art.sprites.wall_timber_door_side_cut = { ...art.sprites.wall_timber_door_side, anchorY: ayc };
  // sunlight patch cast on the floor inside a window (optional overlay, drawn on the floor cell inside)
  const sun = L(`${WIN}/sunlight/windows2-_3_sunlight.png`);
  const sb = bboxOf(sun);
  emit('window_sunlight', [crop(sun, sb.x, sb.y, sb.w, sb.h)], -Math.floor((T - sb.w) / 2), sb.h + 6);

  art.walls.wall_timber = {
    face: 'wall_timber_face', faceCut: 'wall_timber_face_cut', top: 'wall_timber_top',
    door: 'wall_timber_door', doorOpen: 'wall_timber_door_open', window: 'wall_timber_window',
    doorCut: 'wall_timber_door_cut', windowCut: 'wall_timber_window_cut',
    // ---- extensions (optional; see artifacts/world-samples/README in report)
    height: H, heightCut: HC,
    faceAlt: 'wall_timber_face_b', faceCutAlt: 'wall_timber_face_cut_b', windowAlt: 'wall_timber_window_b',
    topCut: 'wall_timber_top_cut',
    caps: Array.from({ length: 16 }, (_, m) => `wall_timber_cap_${m}`),
    capsCut: Array.from({ length: 16 }, (_, m) => `wall_timber_cap_cut_${m}`),
    windowSide: 'wall_timber_window_side', windowSideCut: 'wall_timber_window_side_cut',
    doorSide: 'wall_timber_door_side', doorSideCut: 'wall_timber_door_side_cut',
    windowLight: 'window_sunlight',
  };
}

// ================================================================= objects
function obj(id: string, entry: Record<string, unknown>) { art.objects[id] = entry; }

function buildBeds() {
  // single straw bed: interiors bed_4 (straw mattress); blanket = rough wool blanket rows of bed_5 (same frame)
  const straw = L(`${FPS}/bed_4.png`);
  const wool = L(`${FPS}/bed_5.png`);
  const a = anchorFor(straw, fp('bed_straw').w, 1);
  emit('bed_straw', [straw], a.ax, a.ay);
  const BT = 40; // first blanket row in bed_5
  const blanket = create(straw.w, straw.h);
  blit(blanket, wool, 0, BT, wool.w, wool.h - BT, 0, BT);
  // keep only the mattress area (inside the posts), footboard of bed_4 stays visible
  const mb = keep(blanket, (_c, x, y) => x >= 14 && x < 50 && y < 76);
  const bs = emit('bed_straw_blanket', [mb], a.ax, a.ay, { rect: bboxOf(straw) });
  void bs;
  obj('bed_straw', { default: 'bed_straw', blanket: 'bed_straw_blanket', lieHeads: { lie: headRelCanvas(a, 2, 32, 28) } });

  // double bed: bed_7 widened by 16 px (columns 24..31 repeated), pillow becomes a bolster
  const d = widen(L(`${FPS}/bed_7.png`), 32, 24, 32, 16);
  const ad = anchorFor(d, fp('bed_double').w, 1);
  emit('bed_double', [d], ad.ax, ad.ay);
  const DBT = 44;
  const db = keep(d, (_c, x, y) => y >= DBT && y < 80 && x >= 10 && x < d.w - 10);
  emit('bed_double_blanket', [db], ad.ax, ad.ay, { rect: bboxOf(d) });
  obj('bed_double', { default: 'bed_double', blanket: 'bed_double_blanket', lieHeads: { lie: headRelCanvas(ad, 2, 22, 32), lie2: headRelCanvas(ad, 2, d.w - 22, 32) } });
}
function headRelCanvas(a: { ax: number; ay: number }, fh: number, hx: number, hy: number): [number, number] {
  return [hx - a.ax, hy - (a.ay - fh * T)];
}

function buildHearth() {
  const base = L(`${FPS}/fireplace_1.png`); // 128x128
  const OX0 = 43, OX1 = 86, OY0 = 80, OY1 = 108; // firebox opening search rect
  const warm = (c: RGBA) => { const [h, s, v] = hsv(c); return (h < 55 || h > 345) && s > 0.45 && v > 0.35; };
  const inBox = (x: number, y: number) => x >= OX0 && x < OX1 && y >= OY0 && y < OY1;
  // opening mask: dark or ember pixels inside the rect
  const mask = new Set<number>();
  for (let y = OY0; y < OY1; y++) for (let x = OX0; x < OX1; x++) { const c = px(base, x, y); if (c[3] > 0 && (lum(c) < 75 || warm(c))) mask.add(y * 1000 + x); }
  // unlit: embers → charred logs / ash
  const ash: RGBA[] = ['#2b2426', '#3d3336', '#524548', '#6b5d5c', '#857672'].map((h) => hex(h));
  const unlit = rampRecolor(base, ash, (c) => warm(c));
  const unlitOnly = mapPixels(unlit, (c, x, y) => (inBox(x, y) ? c : px(base, x, y)));
  // cook pot hanging in the opening
  const pot = L(`${GS2}/cauldron1.png`);
  const pb = bboxOf(pot);
  const potImg = crop(pot, pb.x, pb.y, pb.w, pb.h);
  const potX = 64 - Math.floor(potImg.w / 2) + 1, potY = 106 - potImg.h;
  const withPot = (img: Img) => { const o = clone(img); paste(o, potImg, potX, potY); return o; };
  // lit: Szadi fire frames (flame pixels only) clipped to the opening
  const sz = L(SZ_FIRE);
  const flames: Img[] = [];
  for (let i = 0; i < 8; i++) {
    const fx = (i % 4) * 64, fy = Math.floor(i / 4) * 96;
    const fr = crop(sz, fx, fy, 64, 96);
    flames.push(keep(fr, (c) => { const [h, s, v] = hsv(c); return h >= 15 && h < 60 && s > 0.45 && v > 0.7; }));
  }
  const litFrames = (pot: boolean) => flames.map((f, i) => {
    const o = clone(base);
    // brighten embers a little using fireplace_0's glow colours
    const fb = bboxOf(f);
    const ox = 64 - Math.round(fb.x + fb.w / 2), oy = 104 - (fb.y + fb.h);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const c = px(f, x, y); if (c[3] === 0) continue;
      const tx = x + ox, ty = y + oy;
      if (mask.has(ty * 1000 + tx)) setPx(o, tx, ty, c);
    }
    // second, offset tongue for width (frame i+3), clipped
    const g = flames[(i + 3) % 8]; const gb = bboxOf(g);
    const gx = 64 - Math.round(gb.x + gb.w / 2) + (i % 2 ? 9 : -9), gy = 105 - (gb.y + gb.h);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const c = px(g, x, y); if (c[3] === 0 || y + gy < 90) continue;
      const tx = x + gx, ty = y + gy;
      if (mask.has(ty * 1000 + tx)) setPx(o, tx, ty, c);
    }
    return pot ? withPot(o) : o;
  });
  const a = anchorFor(base, fp('hearth').w, 1);
  emit('hearth_unlit', [unlitOnly], a.ax, a.ay);
  emit('hearth_unlit_pot', [withPot(unlitOnly)], a.ax, a.ay);
  emit('hearth_lit', litFrames(false), a.ax, a.ay, { fps: 8 });
  emit('hearth_lit_pot', litFrames(true), a.ax, a.ay, { fps: 8 });
  const potOverlay = create(base.w, base.h); paste(potOverlay, potImg, potX, potY);
  emit('hearth_pot_overlay', [potOverlay], a.ax, a.ay);
  obj('hearth', { default: 'hearth_unlit', states: { servings: 'hearth_unlit_pot', lit: 'hearth_lit_pot' }, extra: { litNoPot: 'hearth_lit', potOverlay: 'hearth_pot_overlay' } });
}

function buildKitchen() {
  // prep counter: plain desk with drawers + bread, board and a bowl on top
  const desk = L(`${FPS}/office_desk_6.png`); // 64x64, top surface ~ y 17..30
  const o = create(64, 64); paste(o, desk, 0, 0);
  const put = (f: string, x: number, bottom: number) => { const im = L(f); const b = bboxOf(im); paste(o, crop(im, b.x, b.y, b.w, b.h), x, bottom - b.h); };
  put(`${FPS}/kitchen_props2_29.png`, 5, 29);   // bread loaves
  put(`${FPS}/kitchen_props_22.png`, 30, 28);   // bowl
  put(`${FPS}/kitchen_props2_12.png`, 44, 28);  // sausage
  const a = anchorFor(desk, 2, 1);
  emit('prep_counter', [o], a.ax, a.ay);
  obj('prep_counter', { default: 'prep_counter' });

  // cupboard: shelves with preserves jars (food storage)
  emitVendor('cupboard', `${FPS}/cabinet_17.png`, fp('cupboard').w, 1);
  obj('cupboard', { default: 'cupboard' });

  emitVendor('barrel_water', `${VPROPS}/barrels_2.png`, 1, 3);
  obj('barrel_water', { default: 'barrel_water' });
}

function buildDining() {
  // table with a few things on it
  const t = L(`${FPS}/table_rect_0.png`); // 128x32, table 88 wide
  const o = create(128, 40);
  paste(o, t, 0, 8);
  const put = (f: string, x: number, bottom: number) => { const im = L(f); const b = bboxOf(im); paste(o, crop(im, b.x, b.y, b.w, b.h), x, bottom - b.h); };
  put(`${FPS}/kitchen_props_22.png`, 34, 22);  // bowl
  put(`${FPS}/kitchen_props_24.png`, 52, 21);  // mug
  put(`${FPS}/kitchen_props2_14.png`, 66, 22); // bread
  put(`${FPS}/candlesticks_20.png`, 84, 21);   // small candle holder
  const a = anchorFor(o, 3, 1);
  emit('dining_table', [o], a.ax, a.ay);
  obj('dining_table', { default: 'dining_table' });

  // chairs by facing: rot0 down, rot1 left, rot2 up, rot3 right
  emitVendor('chair_down', `${FPS}/table_chairs_2.png`, 1, 3);
  emitVendor('chair_left', `${FPS}/table_chairs_0.png`, 1, 3);
  emitVendor('chair_up', `${FPS}/table_chairs_1.png`, 1, 3);
  emitVendor('chair_right', `${FPS}/table_chairs_3.png`, 1, 3);
  obj('chair', { default: 'chair_down', rot: { '0': 'chair_down', '1': 'chair_left', '2': 'chair_up', '3': 'chair_right' } });

  emitVendor('bench', `${FPS}/table_bench_8.png`, 3, 6);
  obj('bench', { default: 'bench', rot: { '0': 'bench', '2': 'bench' } });
  emitVendor('stool', `${FPS}/table_bench_1.png`, 1, 7);
  obj('stool', { default: 'stool', rot: { '0': 'stool', '1': 'stool', '2': 'stool', '3': 'stool' } });
}

function buildBedroom() {
  emitVendor('chest_clothes', `${FPS}/chests_0.png`, 1, 3);
  obj('chest_clothes', { default: 'chest_clothes' });
  emitVendor('wardrobe', `${FPS}/cabinet_11.png`, fp('wardrobe').w, 1);
  obj('wardrobe', { default: 'wardrobe' });
  emitVendor('bookshelf', `${FPS}/cabinet_20.png`, fp('bookshelf').w, 1);
  obj('bookshelf', { default: 'bookshelf' });

  // chamber pot: brown clay pot; dirty = dark contents in the mouth
  const cp = L(`${FPS}/kitchen_props2_0.png`);
  const a = anchorFor(cp, 1, 8);
  emit('chamber_pot', [cp], a.ax, a.ay);
  const dirty = mapPixels(cp, (c, _x, y) => (y < 18 && lum(c) < 70 ? hex(y < 16 ? '#5a4a22' : '#4a3a1c') : null));
  emit('chamber_pot_dirty', [dirty], a.ax, a.ay);
  obj('chamber_pot', { default: 'chamber_pot', states: { dirty: 'chamber_pot_dirty' } });
}

function buildWash() {
  // washbasin: Village wash tub on a small side table
  const tbl = L(`${FPS}/headboard_4.png`); // 32x32 small table
  const basin = L(`${VPROPS}/washbasin1.png`);
  const bb = bboxOf(basin);
  const o = create(32, 48);
  paste(o, tbl, 0, 16);
  paste(o, crop(basin, bb.x, bb.y, bb.w, bb.h), Math.floor((32 - bb.w) / 2), 16 + 12 - bb.h + 6);
  const a = anchorFor(o, 1, 3);
  emit('washbasin', [o], a.ax, a.ay);
  obj('washbasin', { default: 'washbasin' });

  // washtub: the same wooden tub widened and deepened into a bathing tub
  let tub = crop(basin, bb.x, bb.y, bb.w, bb.h);
  tub = widen(tub, Math.floor(tub.w / 2), Math.floor(tub.w / 2) - 4, Math.floor(tub.w / 2) + 4, 14);
  tub = heighten(tub, tub.h - 9, tub.h - 12, tub.h - 9, 6);
  const at = anchorFor(tub, 1, 3);
  emit('washtub', [tub], at.ax, at.ay);
  obj('washtub', { default: 'washtub' });
}

function buildDecor() {
  // rug: frayed brown rug from the interiors tileset, rotated and extended to 3x2
  // woven beige rug with green fringe (interiors tileset, marked tileable), extended to ~3x2
  const r0 = crop(L(INT_TILES), 1232, 1268, 72, 62);
  const rb = bboxOf(r0);
  let rug = crop(r0, rb.x, rb.y, rb.w, rb.h);
  rug = widen(rug, Math.floor(rug.w / 2), Math.floor(rug.w / 2) - 8, Math.floor(rug.w / 2), 88 - rug.w);
  rug = heighten(rug, Math.floor(rug.h / 2), Math.floor(rug.h / 2) - 8, Math.floor(rug.h / 2), Math.max(0, 56 - rug.h));
  const ra = anchorFor(rug, 3, Math.round((64 - rug.h) / 2));
  emit('rug', [rug], ra.ax, ra.ay);
  obj('rug', { default: 'rug' });

  // candlestick: iron floor candelabra; lit = animated flames on its three candles
  const cs = L(`${FPS}/candlesticks_10.png`); // 32x64
  const PAD = 10;
  const baseC = create(32, 64 + PAD); paste(baseC, cs, 0, PAD);
  // unlit: drop the white flame tips (brightest pixels above the candle bodies)
  const unlit = mapPixels(baseC, (c, _x, y) => (y < PAD + 10 && lum(c) > 225 ? [0, 0, 0, 0] : null));
  const fl = L(`${ANI}/candle_and_torch-candle_burning.png`); // 8 frames of 64x64
  const flame = (i: number) => { const f = crop(fl, i * 64 + 26, 20, 12, 20); return f; };
  const tips: Array<[number, number, number]> = [[5, PAD + 10, 0], [15, PAD + 7, 3], [25, PAD + 10, 5]];
  const frames: Img[] = [];
  for (let i = 0; i < 8; i++) {
    const o = clone(unlit);
    for (const [tx, ty, off] of tips) { const f = flame((i + off) % 8); const b = bboxOf(f); paste(o, crop(f, b.x, b.y, b.w, b.h), tx - Math.floor(b.w / 2) + 1, ty - b.h + 2); }
    frames.push(o);
  }
  const ca = anchorFor(baseC, 1, 4);
  emit('candlestick', [unlit], ca.ax, ca.ay);
  emit('candlestick_lit', frames, ca.ax, ca.ay, { fps: 10 });
  obj('candlestick', { default: 'candlestick', states: { lit: 'candlestick_lit' } });

  // tapestry: woven wall hanging (interiors banner), wall-mounted: hangs on the face of its wall cell
  const tp = L(`${FPS}/banner_1.png`);
  const ta = anchorFor(tp, 1, 12);
  emit('tapestry', [tp], ta.ax, ta.ay);
  obj('tapestry', { default: 'tapestry' });

  emitVendor('plant_pot', `${VPROPS}/potted-flower_13.png`, 1, 5);
  obj('plant_pot', { default: 'plant_pot' });

  // lute (LPC tavern, OGA-BY/CC-BY-SA): frame 6 of the held-lute sheet, rotated upright, recoloured to Epic wood, hung on a peg
  const lsrc = crop(L(LPC_LUTE), 384, 896, 64, 64);
  const lb = bboxOf(lsrc);
  let lute = rotate90ccw(crop(lsrc, lb.x, lb.y, lb.w, lb.h));
  lute = rampRecolor(lute, EPIC_WOOD, isWoodish);
  const lo = create(lute.w + 4, lute.h + 4);
  paste(lo, lute, 2, 4);
  for (const [x, y] of [[Math.floor(lo.w / 2), 0], [Math.floor(lo.w / 2), 1], [Math.floor(lo.w / 2) - 1, 1], [Math.floor(lo.w / 2) + 1, 1]] as const) setPx(lo, x, y, C.outline);
  const la = anchorFor(lo, 1, 16);
  emit('lute', [lo], la.ax, la.ay);
  obj('lute', { default: 'lute' });
}

function buildSpinningWheel() {
  // LPC revised spinning wheel (BlueCarrot16 / Eliza Wyatt, OGA-BY 3.0): base cell + 4 animated wheel cells (64x64)
  const src = L(LPC_WHEEL);
  const base = crop(src, 0, 0, 64, 64);
  const frames: Img[] = [];
  const stool = L(`${FPS}/table_bench_1.png`);
  const sb = bboxOf(stool);
  // canvas = the 2x1 footprint (+ headroom): stool centred in the left cell, wheel centred in the right cell
  for (let i = 1; i <= 4; i++) {
    const o = create(64, 80);
    paste(o, crop(stool, sb.x, sb.y, sb.w, sb.h), 16 - Math.ceil(sb.w / 2), 80 - sb.h - 8);
    const w = clone(base); paste(w, crop(src, i * 64, 0, 64, 64), 0, 0);
    const wr = rampRecolor(w, EPIC_WOOD, isWoodish);
    const wb = bboxOf(wr);
    paste(o, crop(wr, wb.x, wb.y, wb.w, wb.h), 48 - Math.round(wb.w / 2), 80 - 4 - wb.h);
    frames.push(o);
  }
  const a = { ax: 0, ay: 80 };
  emit('spinning_wheel', [frames[0]], a.ax, a.ay);
  emit('spinning_wheel_active', frames, a.ax, a.ay, { fps: 8 });
  obj('spinning_wheel', { default: 'spinning_wheel', states: { active: 'spinning_wheel_active' } });
}

function buildOutdoor() {
  // outhouse: Village shed doorway narrowed to 64 px (centre 16 columns removed, ridge re-added)
  const shed = L(`${VDECO}/doors-0_19.png`); // 128x128, bbox 24..104
  const cut = removeCols(shed, 56, 72);
  const ridge = crop(shed, 60, 0, 8, 128);
  const o = clone(cut);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 8; x++) { const c = px(ridge, x, y); if (c[3] > 0 && y < 40) setPx(o, 52 + x, y, c); }
  const a = anchorFor(o, 2, 2);
  emit('outhouse', [o], a.ax, a.ay);
  obj('outhouse', { default: 'outhouse' });

  emitVendor('woodpile', `${GS1}/wood log 21.png`, 2, 3);
  obj('woodpile', { default: 'woodpile' });

  // chopping block: stump with a hatchet buried in it
  const stump = L(`${GS1}/trunk 4.png`);
  const axe = L(`${FPS}/decors_weapon2_6.png`);
  const ab = bboxOf(axe);
  const ob = create(32, 48);
  paste(ob, stump, 0, 16);
  const axeImg = crop(axe, ab.x, ab.y, ab.w, ab.h);
  const ax2 = crop(axeImg, 0, 0, axeImg.w, 26); // head + upper handle, handle pointing down into the stump
  paste(ob, flipY(ax2), 12, 2);
  paste(ob, stump, 0, 16); // stump over the buried head
  const headOnly = crop(flipY(ax2), 0, 0, ax2.w, 18);
  paste(ob, headOnly, 12, 2);
  const ca = anchorFor(ob, 1, 4);
  emit('chopping_block', [ob], ca.ax, ca.ay);
  obj('chopping_block', { default: 'chopping_block' });

  // well: Grassland 2.0 stone well with rope and crank; centred on the stone ring, not the crank
  const well = L(`${GS1}/waterwell - rope - no grass.png`);
  const wb = bboxOf(well);
  const wa = { ax: Math.round(wb.x + wb.w - 38 - T), ay: wb.y + wb.h + 2 };
  emit('well', [well], wa.ax, wa.ay);
  obj('well', { default: 'well' });
}

function buildCarry() {
  const small = (id: string, file: string) => { const im = L(file); const b = bboxOf(im); const c = crop(im, b.x, b.y, b.w, b.h); emit(id, [c], Math.floor(c.w / 2), c.h); };
  small('carry_bowl', `${FPS}/kitchen_props_22.png`);
  small('carry_book', `${FPS}/decors_books_6.png`);
  small('carry_bucket', `${VPROPS}/bucket1.png`);
  small('carry_logs', `${VPROPS}/logs_10.png`);
  small('carry_pot', `${FPS}/kitchen_props2_0.png`);
}

// ================================================================= M4: workstations, fields, crops, orchard
const trim = (img: Img): Img => { const b = bboxOf(img); return crop(img, b.x, b.y, b.w, b.h); };
function hsv2rgb(h: number, s: number, v: number, a = 255): RGBA {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); v = Math.max(0, Math.min(1, v));
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), a];
}
/** HSV adjust of the pixels accepted by pred. */
function tint(src: Img, pred: (c: RGBA, x: number, y: number) => boolean, f: (h: number, s: number, v: number) => [number, number, number]): Img {
  return mapPixels(src, (c, x, y) => { if (!pred(c, x, y)) return null; const [h, s, v] = hsv(c); const [h2, s2, v2] = f(h, s, v); return hsv2rgb(h2, s2, v2, c[3]); });
}
/** Unique opaque colours (optionally filtered), dark→light. */
function rampOf(img: Img, pred: (c: RGBA) => boolean = () => true): RGBA[] {
  const m = new Map<string, RGBA>();
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) { const c = px(img, x, y); if (c[3] === 255 && pred(c)) m.set(c.slice(0, 3).join(','), c); }
  return [...m.values()].sort((a, b) => lum(a) - lum(b));
}
/** rampRecolor with a position-aware predicate (luminance rank among accepted colours → ramp). */
function rampMap(src: Img, ramp: RGBA[], pred: (c: RGBA, x: number, y: number) => boolean): Img {
  const acc: RGBA[] = [];
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const c = px(src, x, y); if (c[3] > 0 && pred(c, x, y)) acc.push(c); }
  if (!acc.length) return clone(src);
  const lo = Math.min(...acc.map(lum)), hi = Math.max(...acc.map(lum));
  return mapPixels(src, (c, x, y) => {
    if (!pred(c, x, y)) return null;
    const t = hi > lo ? (lum(c) - lo) / (hi - lo) : 0.5;
    const r = ramp[Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1)))];
    return [r[0], r[1], r[2], c[3]];
  });
}
const hueIn = (c: RGBA, h0: number, h1: number, sMin = 0, vMin = 0) => {
  const [h, s, v] = hsv(c);
  return (h0 <= h1 ? h >= h0 && h < h1 : h >= h0 || h < h1) && s >= sMin && v >= vMin;
};
function removeRows(src: Img, r0: number, r1: number): Img {
  const out = create(src.w, src.h - (r1 - r0));
  blit(out, src, 0, 0, src.w, r0, 0, 0, false);
  blit(out, src, 0, r1, src.w, src.h - r1, 0, r0, false);
  return out;
}
/** A shaded wooden beam/post with the Epic outline (vertical: shading across x, else across y). */
function beam(o: Img, x: number, y: number, w: number, h: number, vertical: boolean) {
  const W3 = [EPIC_WOOD[3], EPIC_WOOD[5], EPIC_WOOD[6]];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
    const t = vertical ? (i - 1) / Math.max(1, w - 3) : 1 - (j - 1) / Math.max(1, h - 3);
    setPx(o, x + i, y + j, edge ? C.outline : W3[t < 0.34 ? 0 : t < 0.67 ? 1 : 2]);
  }
}
const isWoodDark = (c: RGBA) => isWoodish(c) && hsv(c)[1] > 0.35;
const opaque = (img: Img) => keep(img, (c) => c[3] === 255);
const ironRamp = () => rampOf(L(`${GLOLD}/blacksmith props_18.png`), (c) => hsv(c)[1] < 0.3);

function buildOven() {
  // stone bread oven: interiors fireplace_0 (low stone oven under a wooden mantel, 89x46), against the north wall
  const base = L(`${FPS}/fireplace_0.png`); // 128x64
  const inBox = (x: number, y: number) => x >= 40 && x < 90 && y >= 14 && y < 48;
  const warm = (c: RGBA) => { const [h, s, v] = hsv(c); return (h < 75 || h > 345) && s > 0.45 && v > 0.3; };
  const ash: RGBA[] = ['#2b2426', '#3d3336', '#524548', '#6b5d5c', '#857672'].map((h) => hex(h));
  const unlit = mapPixels(rampRecolor(base, ash, warm), (_c, x, y) => (inBox(x, y) ? null : px(base, x, y)));
  // working: embers flicker (each ember pixel steps ±1 along the oven's own ember ramp)
  const emb = rampOf(crop(base, 40, 14, 50, 34), warm);
  const key = (c: RGBA) => c.slice(0, 3).join(',');
  const idx = new Map(emb.map((c, i) => [key(c), i]));
  const frames = [0, 1, 2, 3].map((f) => mapPixels(base, (c, x, y) => {
    if (!inBox(x, y) || !warm(c)) return null;
    const i = idx.get(key(c)); if (i === undefined) return null;
    const d = [0, 1, 0, -1][(f + x * 3 + y * 5) % 4];
    return emb[Math.max(0, Math.min(emb.length - 1, i + d))];
  }));
  const a = anchorFor(base, fp('oven').w, 1);
  emit('oven', [unlit], a.ax, a.ay);
  emit('oven_active', frames, a.ax, a.ay, { fps: 6 });
  obj('oven', { default: 'oven', states: { active: 'oven_active' } });
}

function buildForge() {
  // Grass Land blacksmith forge: cold = blacksmith props_40, working = forge1-anim1 (8 fire frames) + chimney smoke1 (16 frames)
  const PAD = 64;
  const on = (img: Img) => { const o = create(64, 96 + PAD); paste(o, img, 0, PAD); return o; };
  const cold = on(L(`${GLOLD}/blacksmith props_40.png`));
  const a = anchorFor(cold, fp('forge').w, 2);
  emit('forge', [cold], a.ax, a.ay);
  const frames: Img[] = [];
  for (let i = 0; i < 16; i++) {
    const o = on(L(`${GLOLD}/forge1-anim1_frame${(i % 8) + 1}.png`));
    paste(o, L(`${GLOLD}/forge chimney-smoke1_frame${i + 1}.png`), 1, PAD - 78);
    frames.push(o);
  }
  emit('forge_active', frames, a.ax, a.ay, { fps: 10 });
  obj('forge', { default: 'forge', states: { active: 'forge_active' } });
}

function buildAnvil() {
  // LPC revised small anvil (OGA-BY 3.0), soft shadow dropped, iron recoloured to the Epic anvil ramp
  const an = trim(rampRecolor(opaque(crop(L(`${LREV}/Furniture/Smithing/Anvils.png`), 0, 0, 36, 32)), ironRamp(), () => true));
  const o = create(32, an.h + 2);
  paste(o, an, Math.floor((32 - an.w) / 2), 0);
  const a = anchorFor(o, 1, 5);
  emit('anvil', [o], a.ax, a.ay);
  obj('anvil', { default: 'anvil' });
}

function buildLoom() {
  // LPC revised loom (OGA-BY 3.0): wood → Epic ramp; the loom's own linen overlays show the cloth growing while working
  const src = L(`${LREV}/Furniture/Sewing & Weaving/Loom.png`);
  const loom = rampRecolor(opaque(crop(src, 0, 0, 64, 64)), EPIC_WOOD, isWoodDark);
  const cloth = (cx: number) => { const o = clone(loom); paste(o, crop(src, cx, 256, 64, 64), 0, 0); return o; };
  const a = anchorFor(loom, fp('loom').w, 3);
  emit('loom', [cloth(320)], a.ax, a.ay);
  emit('loom_active', [256, 320, 384, 448].map(cloth), a.ax, a.ay, { fps: 2 });
  obj('loom', { default: 'loom', states: { active: 'loom_active' } });
}

function buildWorkbench() {
  // LPC revised carpentry bench (OGA-BY 3.0), front view; plank run shortened to fit 2 cells, wood → Epic ramp
  let wb = opaque(crop(L(`${LREV}/Furniture/Workbench, Carpentry.png`), 0, 0, 128, 64));
  wb = removeCols(wb, 42, 62);
  wb = rampRecolor(wb, EPIC_WOOD, isWoodish);
  const a = anchorFor(wb, fp('workbench').w, 3);
  emit('workbench', [wb], a.ax, a.ay);
  obj('workbench', { default: 'workbench' });
}

function buildKitchenWork() {
  // brew vat: Village open banded barrel (barrels_3) with its water recoloured to ale; highlights stay as froth
  const vat = rampRecolor(L(`${VPROPS}/barrels_3.png`), EPIC_WOOD.slice(1, 7), (c) => hueIn(c, 170, 250, 0.35, 0.35));
  const va = anchorFor(vat, 1, 3);
  emit('brew_vat', [vat], va.ax, va.ay);
  obj('brew_vat', { default: 'brew_vat' });

  // salting tub: Village grain crate filled with coarse salt (as-is)
  emitVendor('salting_tub', `${VPROPS}/grain-crate_2.png`, 1, 3);
  obj('salting_tub', { default: 'salting_tub' });

  // churn: Village banded barrel narrowed and heightened, lid + dasher handle
  let ch = removeCols(L(`${VPROPS}/barrels_1.png`), 11, 21);
  ch = heighten(ch, 50, 44, 50, 6);
  const cx = Math.floor(ch.w / 2);
  ch = mapPixels(ch, (c, x, y) => (y >= 26 && y < 34 && lum(c) < 95 && x > 2 && x < ch.w - 3 ? (y === 26 || y === 33 ? C.outline : EPIC_WOOD[y < 29 ? 5 : 4]) : null));
  for (let y = 10; y < 29; y++) { setPx(ch, cx - 2, y, C.outline); setPx(ch, cx - 1, y, EPIC_WOOD[6]); setPx(ch, cx, y, EPIC_WOOD[4]); setPx(ch, cx + 1, y, C.outline); }
  beam(ch, cx - 5, 7, 10, 4, false);
  const ca = anchorFor(ch, 1, 3);
  emit('churn', [ch], ca.ax, ca.ay);
  obj('churn', { default: 'churn' });

  // cider/wine press: low vat of apple mash (Village barrels_0 cut down) under a timber frame with an iron screw
  const W = 64, H = 58;
  const o = create(W, H);
  let tub = crop(L(`${VPROPS}/barrels_0.png`), 0, 25, 32, 37);
  tub = removeRows(tub, 14, 26);
  const mash = rampOf(L(`${GS4}/crops-radish_5.png`), (c) => hueIn(c, 330, 25, 0.4)).concat(rampOf(L(`${GS4}/crops-wheat_5.png`), (c) => hueIn(c, 30, 60, 0.5)));
  mash.sort((p, q) => lum(p) - lum(q));
  tub = rampMap(tub, mash, (c, _x, y) => y < 9 && lum(c) < 100);
  const tx = Math.floor((W - 32) / 2), ty = H - tub.h - 1;
  beam(o, 9, 6, 5, H - 8, true);
  beam(o, W - 14, 6, 5, H - 8, true);
  beam(o, 6, 5, W - 12, 6, false);
  const iron = ironRamp();
  for (let y = 11; y < ty + 4; y++) { setPx(o, 30, y, C.outline); setPx(o, 31, y, iron[Math.floor(iron.length * 0.7)]); setPx(o, 32, y, iron[(y % 3 === 0) ? 1 : Math.floor(iron.length * 0.45)]); setPx(o, 33, y, C.outline); }
  paste(o, tub, tx, ty);
  beam(o, tx + 5, ty + 1, 22, 4, false); // pressing board resting on the mash
  const pa = anchorFor(o, fp('press').w, 2);
  emit('press', [o], pa.ax, pa.ay);
  obj('press', { default: 'press' });
}

function buildSmokehouse() {
  // outdoor smoking rack: interiors meat rack (kitchen_props6_3) with its iron recoloured to wood, a fire pit below;
  // working = embers (Grassland campfire 3) + rising smoke (Grassland campfire smoke, 16 frames)
  const rack = rampRecolor(L(`${FPS}/kitchen_props6_3.png`), EPIC_WOOD.slice(0, 6), (c) => { const [h, s] = hsv(c); return h > 170 && h < 270 && s < 0.55; });
  const H = 52;
  const fire = (f: string) => trim(L(`${GS1}/${f}`));
  const on = (pit: Img) => { const o = create(96, H); paste(o, rack, 0, 0); paste(o, pit, 48 - Math.floor(pit.w / 2), H - 2 - pit.h); return o; };
  const cold = on(fire('campfire 5.png'));
  const a = anchorFor(cold, fp('smokehouse').w, 2);
  emit('smokehouse', [cold], a.ax, a.ay);
  const smoke = L(`${GANI}/campfire smoke.png`); // 16 frames of 64x64
  const frames: Img[] = [];
  for (let i = 0; i < 16; i++) {
    const o = on(fire('campfire 6.png'));
    const s1 = crop(smoke, i * 64, 0, 64, 64), s2 = crop(smoke, ((i + 7) % 16) * 64, 0, 64, 64);
    paste(o, s1, 48 - 32 - 5, H - 64 - 14);
    paste(o, s2, 48 - 32 + 7, H - 64 - 10);
    frames.push(o);
  }
  emit('smokehouse_active', frames, a.ax, a.ay, { fps: 10 });
  obj('smokehouse', { default: 'smokehouse', states: { active: 'smokehouse_active' } });
}

// ---- fields: soil plots (flat, floor layer). The renderer draws crop_<id>_<stage> on every cell
const soilCentre = () => crop(L(PLOWED), 48, 48, 64, 64); // furrowed, tileable centre of the plowed bed
function buildFields() {
  // untilled: bare packed dirt with soft grassy edges (dirt1 to grass - transparency, 3x2 autotile pieces)
  const dt = L(`${GT}/dirt1 to grass - transparency.png`);
  const un = create(96, 64);
  const d = (sx: number, sy: number, dx: number, dy: number) => blit(un, dt, sx, sy, T, T, dx, dy, false);
  d(32, 32, 0, 0); d(64, 32, 32, 0); d(96, 32, 64, 0);
  d(32, 96, 0, 32); d(64, 96, 32, 32); d(96, 96, 64, 32);
  emit('field_plot_untilled', [un], 0, 64, { trim: false });
  // tilled: plowed bed with its cobbled rim, 9-slice (16 px convex corners) of plowed soil and watered.png
  const pl = L(PLOWED);
  const t = create(96, 64);
  const b = (sx: number, sy: number, w: number, h: number, dx: number, dy: number) => blit(t, pl, sx, sy, w, h, dx, dy, false);
  b(48, 48, 64, 32, 16, 16);
  b(32, 0, 16, 16, 0, 0); b(48, 0, 64, 16, 16, 0); b(112, 0, 16, 16, 80, 0);
  b(0, 48, 16, 32, 0, 16); b(144, 48, 16, 32, 80, 16);
  b(32, 144, 16, 16, 0, 48); b(48, 144, 64, 16, 16, 48); b(112, 144, 16, 16, 80, 48);
  emit('field_plot_tilled', [t], 0, 64, { trim: false });
  obj('field_plot', { default: 'field_plot_untilled', states: { tilled: 'field_plot_tilled' } });

  // garden box (2x1): low plank frame, packed dirt inside / furrowed soil inside
  const box = (fill: Img) => {
    const o = create(64, 32);
    blit(o, fill, 0, 0, 64, 32, 0, 0, false);
    beam(o, 0, 0, 64, 4, false); beam(o, 0, 27, 64, 5, false);
    beam(o, 0, 3, 4, 25, true); beam(o, 60, 3, 4, 25, true);
    return o;
  };
  const packed = create(64, 32);
  for (let i = 0; i < 2; i++) blit(packed, L(DIRT1), 64, 64, T, T, i * T, 0, false);
  emit('garden_plot_empty', [box(packed)], 0, 32, { trim: false });
  emit('garden_plot_tilled', [box(soilCentre())], 0, 32, { trim: false });
  obj('garden_plot', { default: 'garden_plot_empty', states: { tilled: 'garden_plot_tilled' } });
}

// ---- crops: crop_<id>_<0..4> (32x32 cell, anchor = cell bottom centre 2 px up, as WorldView.syncField places them)
type CropArt = { src: string; frames?: number[]; fx?: (img: Img, stage: number) => Img; how: string };
const CROP_ORDER = ['wheat', 'barley', 'oats', 'rye', 'beans', 'flax', 'turnip', 'cabbage', 'onion', 'leek', 'herbs', 'medicinal_herbs', 'moonwort'];
function cropArt(): Record<string, CropArt> {
  const g = (f: string) => L(`${GS4}/${f}`);
  const leaf = rampOf(g('crops-green bean_5.png'), (c) => hueIn(c, 70, 170, 0.3));
  const shift = (ramp: RGBA[], dh: number, sm = 1, vm = 1) => ramp.map((c) => { const [h, s, v] = hsv(c); return hsv2rgb(h + dh, s * sm, v * vm); });
  const gold = (c: RGBA) => hueIn(c, 20, 70, 0.3);
  // grain: green blades → heading (yellow-green) → ripe colour
  const grain = (ripe: (img: Img) => Img, blade = leaf) => (img: Img, s: number) =>
    s <= 2 ? rampRecolor(img, blade, gold) : s === 3 ? rampRecolor(img, shift(blade, -38, 0.9, 1.08), gold) : ripe(img);
  const whole = () => true;
  const redRoot = (c: RGBA) => hueIn(c, 320, 20, 0.35);
  const purple = rampOf(g('crops-red cabagge_5.png'), (c) => hueIn(c, 260, 330, 0.35));
  const cream = rampOf(g('crops-parsnip_5.png'), (c) => hueIn(c, 30, 70, 0.1, 0.5) && hsv(c)[1] < 0.45);
  const pale = rampOf(g('crops-bok chok_5.png'));
  const tuber = rampOf(g('crops-potato_6.png'), (c) => hueIn(c, 25, 65, 0.25));
  const curd = rampOf(g('crops-cauliflower_5.png'), (c) => hsv(c)[1] < 0.25 && hsv(c)[2] > 0.55);
  const blue = rampOf(g('crops-blueberry_5.png'), (c) => hueIn(c, 190, 260, 0.35));
  const bulb = (c: RGBA) => hsv(c)[1] < 0.2 && hsv(c)[2] > 0.45;
  return {
    wheat: { src: 'crops-wheat', fx: grain((i) => i), how: 'Epic wheat 1-5; 싹~성장(0-2)은 잎 초록, 이삭(3)은 연두로 색 바꿈, 익음(4)은 원본 금색' },
    barley: { src: 'crops-wheat', fx: grain((i) => tint(i, gold, (h, s, v) => [h + 6, s * 0.55, Math.min(1, v * 1.08)])), how: 'Epic wheat 색 바꿈: 익음은 옅은 짚색' },
    oats: { src: 'crops-wheat', fx: grain((i) => tint(i, gold, (_h, s, v) => [42, s * 0.3, Math.min(1, v * 1.1)])), how: 'Epic wheat 색 바꿈: 익음은 흰빛 도는 베이지' },
    rye: { src: 'crops-wheat', fx: grain((i) => tint(i, gold, (_h, s, v) => [32, s * 0.45, v * 0.82]), shift(leaf, 22, 0.8, 0.95)), how: 'Epic wheat 색 바꿈: 잎은 청록빛, 익음은 회갈색' },
    beans: { src: 'crops-green bean', how: 'Epic green bean 1-5 그대로 (지지대 콩)' },
    flax: {
      src: 'crops-wheat',
      fx: (img, s) => {
        const b = bboxOf(img);
        if (s <= 2) return rampRecolor(img, shift(leaf, 8), gold);
        if (s === 3) return rampMap(rampRecolor(img, shift(leaf, 8), (c) => gold(c)), blue, (c, _x, y) => y < b.y + b.h * 0.42 && hueIn(c, 70, 170));
        return tint(img, gold, (_h, s2, v) => [34, s2 * 0.5, v * 0.78]);
      },
      how: 'Epic wheat 색 바꿈: 줄기 초록, 이삭(3) 윗부분을 파란 아마꽃으로, 익음은 갈색 꼬투리',
    },
    turnip: {
      src: 'crops-radish',
      fx: (img) => {
        const b = bboxOf(keep(img, redRoot)), cut = b.y + b.h * 0.45;
        const lower = rampMap(img, cream, (c, _x, y) => redRoot(c) && y >= cut);
        return rampMap(lower, purple, (c, _x, y) => redRoot(c) && y < cut);
      },
      how: 'Epic radish 색 바꿈: 붉은 뿌리 → 위 보라 / 아래 흰색',
    },
    cabbage: { src: 'crops-red cabagge', fx: (img) => rampRecolor(img, pale, (c) => lum(c) > 45), how: 'Epic red cabbage 색 바꿈: 보라/회보라 → bok choy 의 연두 팔레트' },
    onion: { src: 'crops-garlic', fx: (img) => rampRecolor(img, tuber, bulb), how: 'Epic garlic 색 바꿈: 흰 알뿌리 → 황갈색' },
    leek: { src: 'crops-garlic', fx: (img) => tint(img, (c) => hueIn(c, 70, 170, 0.2), (h, s, v) => [h + 28, s * 0.75, v * 0.9]), how: 'Epic garlic 색 바꿈: 잎을 청록으로 (흰 줄기 유지)' },
    herbs: { src: 'crops-tomato', fx: (img) => rampRecolor(img, shift(purple, 0, 0.5, 1.35), (c) => hueIn(c, 330, 30, 0.45)), how: 'Epic tomato 색 바꿈: 붉은 열매 → 연보라 꽃 (타임/세이지 꽃)' },
    medicinal_herbs: {
      src: 'crops-blueberry',
      fx: (img) => tint(rampRecolor(img, curd, (c) => hueIn(c, 190, 260, 0.35)), (c) => hueIn(c, 70, 170, 0.2), (h, s, v) => [h - 6, s * 0.6, v * 0.95]),
      how: 'Epic blueberry 색 바꿈: 열매 → 흰 꽃(캐모마일풍), 잎은 회녹색',
    },
    moonwort: {
      src: 'crops-artichoke',
      fx: (img) => tint(img, whole, (h, s, v) => (h >= 30 && h < 70 && s < 0.6 ? [212, s * 0.35, Math.min(1, v * 1.12)] : [178, s * 0.42, Math.min(1, v * 1.02)])),
      how: 'Epic artichoke 색 바꿈: 은청록 잎, 꽃봉오리는 달빛 푸른 흰색',
    },
  };
}

function buildCrops(): { id: string; art: CropArt }[] {
  const arts = cropArt();
  const cols = 5, rows = CROP_ORDER.length + 1;
  const sheet = create(cols * T, rows * T);
  const file = `${GEN}/crops.png`;
  const reg = (id: string, i: number, j: number) => { art.sprites[id] = { image: '', x: i * T, y: j * T, w: T, h: T, anchorX: T / 2, anchorY: T - 2 }; };
  CROP_ORDER.forEach((id, j) => {
    const a = arts[id];
    for (let s = 0; s < 5; s++) {
      const srcImg = L(`${GS4}/${a.src}_${(a.frames ?? [1, 2, 3, 4, 5])[s]}.png`);
      const img = a.fx ? a.fx(srcImg, s) : srcImg;
      blit(sheet, img, 0, 0, T, T, s * T, j * T, false);
      reg(`crop_${id}_${s}`, s, j);
    }
  });
  // weeds: three Grassland grass tufts scattered in a cell
  const w = create(T, T);
  for (const [f, x, y] of [['grass tufts 3.png', 1, 12], ['grass tufts 7.png', 15, 4], ['grass tufts 12.png', 10, 17]] as const) {
    const tf = trim(L(`${GS2}/${f}`));
    paste(w, tf, Math.min(T - tf.w, x), Math.min(T - tf.h, y));
  }
  blit(sheet, w, 0, 0, T, T, 0, CROP_ORDER.length * T, false);
  reg('crop_weeds', 0, CROP_ORDER.length);
  save(sheet, file);
  const img = imageId(file);
  for (const id of [...CROP_ORDER.flatMap((c) => [0, 1, 2, 3, 4].map((s) => `crop_${c}_${s}`)), 'crop_weeds']) art.sprites[id].image = img;
  return CROP_ORDER.map((id) => ({ id, art: arts[id] }));
}

// ---- orchard: orchard_<apples|pears|grapes>_<0 leaves|1 blossom|2 fruit> (2x2 footprint)
function buildOrchard() {
  const src = L(LPC_FRUIT);
  const green = rampOf(L(`${GS1}/tree - color scheme 2 - 2.png`), (c) => hueIn(c, 60, 170, 0.25));
  const epicTree = (img: Img) => rampRecolor(rampRecolor(img, green, (c) => hueIn(c, 55, 175, 0.2) && c[3] === 255), EPIC_WOOD, (c) => hueIn(c, 0, 45, 0.25) && hsv(c)[2] < 0.6 && c[3] === 255);
  const blossom: RGBA[] = ['#c9a3aa', '#e6c6cb', '#f5e3e5', '#fffafa'].map((h) => hex(h));
  const tree = (leafAt: [number, number], fruitAt: [number, number], id: string) => {
    const leaves = crop(src, leafAt[0], leafAt[1], 96, 128), fruit = crop(src, fruitAt[0], fruitAt[1], 96, 128);
    const isFruit = (c: RGBA, x: number, y: number) => px(leaves, x, y).join() !== c.join() && !hueIn(c, 60, 175);
    const bloom = rampMap(fruit, blossom, isFruit);
    const a = anchorFor(leaves, 2, 8);
    emit(`orchard_${id}_0`, [epicTree(leaves)], a.ax, a.ay);
    emit(`orchard_${id}_1`, [epicTree(bloom)], a.ax, a.ay);
    emit(`orchard_${id}_2`, [epicTree(fruit)], a.ax, a.ay);
  };
  tree([0, 0], [0, 2048], 'apples');   // LPC fruit trees: round apple tree / red apples
  tree([384, 0], [288, 2432], 'pears'); // conical pear tree / yellow pears
  // grapes: Epic grape vine on trellis, 2 rows x 2 posts; flowering = young clusters recoloured pale green
  const g = (i: number) => L(`${GS4}/crops-grape_${i}.png`);
  const flower = rampOf(L(`${GS4}/crops-green bean_5.png`), (c) => hueIn(c, 55, 110, 0.3, 0.6));
  const vine = (cell: Img) => { const o = create(64, 64); for (const [x, y] of [[0, 0], [32, 0], [0, 32], [32, 32]]) paste(o, cell, x, y); return o; };
  const va = { ax: 0, ay: 64 };
  emit('orchard_grapes_0', [vine(g(3))], va.ax, va.ay);
  emit('orchard_grapes_1', [vine(rampRecolor(g(4), flower, (c) => hueIn(c, 190, 300, 0.25)))], va.ax, va.ay);
  emit('orchard_grapes_2', [vine(g(5))], va.ax, va.ay);
  obj('orchard_tree', { default: 'orchard_apples_0' });
}

/** QA preview: crops 13 x 5 stages on tilled soil + weeds, soils, orchard stages (artifacts/qa/m4/crops-sheet.png). */
function cropPreview(list: { id: string }[]) {
  const K = 3, LW = 120;
  const soil = soilCentre();
  const sprite = (id: string) => { const s = art.sprites[id]; return crop(L(art.images[s.image]), s.x, s.y, s.w, s.h); };
  const rowsH = (list.length + 1) * (T + 6);
  const orch = ['apples', 'pears', 'grapes'];
  const W = LW + 5 * (T + 6) * K + 20, H = 30 + rowsH * K + 900;
  const o = create(W, H, [40, 40, 48, 255]);
  text(o, 8, 8, 'M4 CROPS: STAGE 0 SPROUT / 1 YOUNG / 2 GROWING / 3 HEAD-FRUIT / 4 RIPE', [255, 230, 90, 255], 2);
  const cell = (img: Img, x: number, y: number, bg = true) => {
    const c = create(T, T);
    if (bg) blit(c, soil, 0, 0, T, T, 0, 0, false);
    paste(c, img, 0, 0);
    const big = scale(c, K);
    blit(o, big, 0, 0, big.w, big.h, x, y);
  };
  list.forEach(({ id }, j) => {
    const y = 30 + j * (T + 6) * K;
    text(o, 8, y + 40, id.toUpperCase(), [230, 230, 230, 255], 2);
    for (let s = 0; s < 5; s++) cell(sprite(`crop_${id}_${s}`), LW + s * (T + 6) * K, y);
  });
  const yw = 30 + list.length * (T + 6) * K;
  text(o, 8, yw + 40, 'WEEDS', [230, 230, 230, 255], 2);
  cell(sprite('crop_weeds'), LW, yw);
  // soils + orchard
  let x = 8, y2 = yw + (T + 12) * K;
  for (const id of ['field_plot_untilled', 'field_plot_tilled', 'garden_plot_empty', 'garden_plot_tilled']) {
    const big = scale(sprite(id), 2);
    blit(o, big, 0, 0, big.w, big.h, x, y2 + 12); text(o, x, y2, id.toUpperCase(), [255, 230, 90, 255], 1); x += big.w + 12;
  }
  x = 8; let y3 = y2 + 150;
  for (const f of orch) {
    for (let s = 0; s < 3; s++) {
      const big = scale(sprite(`orchard_${f}_${s}`), 2);
      blit(o, big, 0, 0, big.w, big.h, x, y3 + 12); text(o, x, y3, `${f}_${s}`.toUpperCase(), [255, 230, 90, 255], 1); x += big.w + 8;
    }
    if (f !== 'grapes') { x = 8; y3 += 280; }
  }
  fs.mkdirSync(QA_M4, { recursive: true });
  save(crop(o, 0, 0, W, Math.min(H, y3 + 12 + 150)), `${QA_M4}/crops-sheet.png`);
  // workstations (first frame of default and active)
  const ids = ['oven', 'oven_active', 'forge', 'forge_active', 'anvil', 'loom', 'loom_active', 'workbench', 'brew_vat', 'salting_tub', 'churn', 'press', 'smokehouse', 'smokehouse_active'];
  const st = create(1400, 940, [40, 40, 48, 255]);
  let sx = 8, sy = 8;
  for (const id of ids) {
    const big = scale(sprite(id), 3);
    if (sx + big.w > 1400) { sx = 8; sy += 470; }
    blit(st, big, 0, 0, big.w, big.h, sx, sy + 10); text(st, sx, sy, id.toUpperCase(), [255, 230, 90, 255], 1); sx += big.w + 14;
  }
  save(st, `${QA_M4}/stations-sheet.png`);
}

// ================================================================= atlas
/**
 * 생성 스프라이트 PNG(수백 장)를 2048 아틀라스 몇 장으로 묶음 (게임 시작 시 요청 수를 줄임).
 * 이미지 통째로 선반 방식으로 놓고, 그 이미지를 가리키는 스프라이트/타일 좌표를 옮김 (애니메이션 프레임 간격은 그대로).
 * 이미 아틀라스인 이미지(카탈로그 페이지)는 그대로. 원본 개별 PNG 는 지우지 않음 (QA 도구용)
 */
/** CC-BY-SA 로 가공한 생성 그림 (assets/SHARE_ALIKE.md 와 맞출 것): Epic 그림과 한 아틀라스에 섞지 않음 */
const SHARE_ALIKE_GEN = [/^lute\.png$/, /^orchard_(apples|pears)_\d\.png$/];

function packGenerated(): void {
  const PAGE = 2048;
  const PAD = 1;
  const genIds = Object.entries(art.images).filter(([, f]) => f.startsWith(GEN + '/') && !path.basename(f).includes('atlas'));
  const all = genIds.map(([id, f]) => ({ id, f, img: L(f) })).filter((e) => e.img.w <= 1024 && e.img.h <= 1024);
  const isSA = (f: string) => SHARE_ALIKE_GEN.some((r) => r.test(path.basename(f)));
  let total = 0;
  for (const [group, list] of [['atlas', all.filter((e) => !isSA(e.f))], ['atlas_sa_gen', all.filter((e) => isSA(e.f))]] as const) {
    const imgs = [...list].sort((x, y) => y.img.h - x.img.h || y.img.w - x.img.w);
    const pages: { img: Img; x: number; y: number; rowH: number }[] = [];
    const place = new Map<string, { page: number; x: number; y: number }>();
    for (const e of imgs) {
      let pg = pages[pages.length - 1];
      if (pg && pg.x + e.img.w > PAGE) {
        pg.x = 0;
        pg.y += pg.rowH + PAD;
        pg.rowH = 0;
      }
      if (!pg || pg.y + e.img.h > PAGE) {
        pg = { img: create(PAGE, PAGE), x: 0, y: 0, rowH: 0 };
        pages.push(pg);
      }
      blit(pg.img, e.img, 0, 0, e.img.w, e.img.h, pg.x, pg.y, false);
      place.set(e.id, { page: pages.length - 1, x: pg.x, y: pg.y });
      pg.x += e.img.w + PAD;
      pg.rowH = Math.max(pg.rowH, e.img.h);
    }
    const pageIds: string[] = [];
    pages.forEach((pg, i) => {
      const used = Math.min(PAGE, pg.y + pg.rowH + 1);
      const file = `${GEN}/${group}_${i}.png`;
      save(crop(pg.img, 0, 0, PAGE, used), file);
      const id = `gen_${group}_${i}`;
      art.images[id] = file;
      pageIds.push(id);
    });
    for (const s of Object.values(art.sprites)) {
      const p = place.get(s.image);
      if (!p) continue;
      s.image = pageIds[p.page];
      s.x += p.x;
      s.y += p.y;
    }
    for (const t of Object.values(art.tiles)) {
      const p = place.get(t.image);
      if (!p) continue;
      t.image = pageIds[p.page];
      t.x += p.x;
      t.y += p.y;
    }
    for (const id of place.keys()) delete art.images[id];
    total += pages.length;
  }
  console.log(`atlas: ${all.length} generated images → ${total} pages (share-alike 따로)`);
}

// ================================================================= main
fs.mkdirSync(GEN, { recursive: true });
for (const f of fs.readdirSync(GEN)) if (f.endsWith('.png')) fs.unlinkSync(path.join(GEN, f));
buildTiles();
buildWalls();
buildBeds();
buildHearth();
buildKitchen();
buildDining();
buildBedroom();
buildWash();
buildDecor();
buildSpinningWheel();
buildOutdoor();
buildCarry();
buildOven();
buildForge();
buildAnvil();
buildLoom();
buildWorkbench();
buildKitchenWork();
buildSmokehouse();
buildFields();
const cropList = buildCrops();
buildOrchard();
cropPreview(cropList);
// M5: 건축 부품(벽 재질, 문/창, 바닥, 지형, 지붕, 계단, 울타리)과 구매 카탈로그 (artifacts/contracts-m5.md)
const kit = {
  art, T, GEN, WALL_H, WALL_HC, L, emit, emitVendor, imageId, anchorFor, capTile, wallCell, faceColumn, tile,
  paths: { INT, FPS, WIN, ANI, INT_TILES, ERW, VIL, VPROPS, VDECO, VWALLS, GL, GS1, GS2, GS4, GT, GANI, LREV, GLOLD },
};
export type ArtKit = typeof kit;
await (await import('./build-parts')).buildParts(kit);
await (await import('./build-catalog')).buildCatalog(kit);
const missing = Object.keys(objects).filter((k) => !art.objects[k]);
if (missing.length) throw new Error('objects without art: ' + missing.join(', '));
fs.mkdirSync('src/data/artpacks', { recursive: true });
packGenerated();
fs.writeFileSync('src/data/artpacks/epic.json', JSON.stringify(art, null, 1) + '\n');
console.log(`epic.json: ${Object.keys(art.images).length} images, ${Object.keys(art.tiles).length} tiles, ${Object.keys(art.sprites).length} sprites, ${Object.keys(art.objects).length} objects`);
