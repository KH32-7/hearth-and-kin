// Reference renderer for lots + the Epic art pack (Node, pngjs). Mirrors what the game renderer must do.
// npx tsx tools/world/render-lot.ts [lotId=cottage]
// Outputs artifacts/world-samples/<lot>.png, <lot>@2x.png, <lot>-cut.png, <lot>-cut@2x.png, objects-sheet.png
import fs from 'node:fs';
import path from 'node:path';
import { Img, load, create, blit, save, scale, fillRect, strokeRect, text } from './png';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
process.chdir(ROOT);
const lotId = process.argv[2] ?? 'cottage';
const OUT = 'artifacts/world-samples';

type Sprite = { image: string; x: number; y: number; w: number; h: number; anchorX: number; anchorY: number; frames?: number; frameDx?: number };
const art = JSON.parse(fs.readFileSync('src/data/artpacks/epic.json', 'utf8'));
const defs = JSON.parse(fs.readFileSync('src/data/objects.json', 'utf8'));
const lot = JSON.parse(fs.readFileSync(`src/data/lots/${lotId}.json`, 'utf8'));
const T: number = art.tilePx;

const img = (id: string): Img => load(art.images[id]);

function drawSprite(dst: Img, spriteId: string, footLeftX: number, footBottomY: number, frame = 0): void {
  const s: Sprite = art.sprites[spriteId];
  if (!s) throw new Error('missing sprite ' + spriteId);
  const sx = s.x + frame * (s.frameDx ?? s.w);
  blit(dst, img(s.image), sx, s.y, s.w, s.h, footLeftX - s.anchorX, footBottomY - s.anchorY);
}
function drawTile(dst: Img, tileId: string, x: number, y: number): void {
  const t = art.tiles[tileId];
  if (!t) throw new Error('missing tile ' + tileId);
  blit(dst, img(t.image), t.x, t.y, T, T, x, y, false);
}

// ----------------------------------------------------------------- lot rendering
interface Opts { cut: boolean; lit: boolean; doorsOpen?: boolean; people?: boolean }

export function renderLot(o: Opts): Img {
  const W = lot.w, H = lot.h;
  const style = (x: number, y: number): string | null => (x < 0 || y < 0 || x >= W || y >= H ? null : lot.walls[y * W + x]);
  const hasFloor = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && lot.floor[y * W + x] != null;
  const opening = (x: number, y: number) => lot.openings.find((p: { x: number; y: number }) => p.x === x && p.y === y);
  const wallDef = (x: number, y: number) => art.walls[style(x, y)!];
  const topMargin = (wallDef(0, 0)?.height ?? 80) + T;
  const M = Math.max(topMargin, 120);
  const out = create(W * T, H * T + M, [20, 18, 22, 255]);

  // cut decision: a wall cell stays full height if its south neighbour is floor (a back wall of a room),
  // or it is chained east/west to such a cell. Everything else is lowered when cut mode is on.
  const full = new Set<number>();
  if (o.cut) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (style(x, y) && hasFloor(x, y + 1) && !style(x, y + 1)) full.add(y * W + x);
    const queue = [...full];
    while (queue.length) { const k = queue.pop()!; const x = k % W, y = Math.floor(k / W); for (const nx of [x - 1, x + 1]) { const nk = y * W + nx; if (style(nx, y) && !full.has(nk)) { full.add(nk); queue.push(nk); } } }
  }
  const isCut = (x: number, y: number) => o.cut && !full.has(y * W + x);
  const hClass = (x: number, y: number) => (!style(x, y) ? -1 : isCut(x, y) ? 0 : 1);

  // 0. margin above the lot: repeat row-0 ground so tall sprites have a backdrop
  for (let y = -Math.ceil(M / T); y < 0; y++) for (let x = 0; x < W; x++) drawTile(out, lot.ground[x], x * T, y * T + M);
  // 1. ground + floor
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    drawTile(out, lot.ground[y * W + x], x * T, y * T + M);
    const f = lot.floor[y * W + x];
    if (f) drawTile(out, f, x * T, y * T + M);
  }
  // 2. flat objects (blocks=false, not wall mounted): under everything else
  type D = { key: number; layer: number; x: number; draw: () => void };
  const list: D[] = [];
  for (const ob of lot.objects) {
    const def = defs[ob.id]; const a = art.objects[ob.id];
    let sid: string = a.rot?.[String(ob.rot ?? 0)] ?? a.default;
    if (o.lit && a.states?.lit) sid = a.states.lit;
    const fx = ob.x * T, fb = (ob.y + def.footprint.h) * T + M;
    if (!def.blocks && !def.wallMounted) { drawSprite(out, sid, fx, fb); continue; }
    list.push({ key: fb, layer: 1, x: fx, draw: () => {
      drawSprite(out, sid, fx, fb);
      // sleep demo: bed → head on the pillow → blanket
      if (o.people && a.blanket && a.lieHeads) {
        const top = fb - def.footprint.h * T;
        for (const [, [hx, hy]] of Object.entries(a.lieHeads as Record<string, [number, number]>)) drawHead(out, fx + hx, top + hy);
        drawSprite(out, a.blanket, fx, fb);
      }
    } });
  }
  // 3. walls
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const st = style(x, y); if (!st) continue;
    const wd = art.walls[st];
    const cut = isCut(x, y);
    const my = hClass(x, y);
    const southCovers = hClass(x, y + 1) >= my && hClass(x, y + 1) >= 0;
    const op = opening(x, y);
    const alt = x % 2 === 1;
    let sid: string;
    if (southCovers) {
      sid = op?.kind === 'window' ? (cut ? wd.windowSideCut : wd.windowSide) : op?.kind === 'door' ? (cut ? wd.doorSideCut : wd.doorSide) : cut ? wd.topCut : wd.top;
    } else if (op?.kind === 'door') sid = cut ? wd.doorCut : o.doorsOpen ? wd.doorOpen : wd.door;
    else if (op?.kind === 'window') sid = cut ? wd.windowCut : alt && wd.windowAlt ? wd.windowAlt : wd.window;
    else sid = cut ? (alt && wd.faceCutAlt ? wd.faceCutAlt : wd.faceCut) : alt && wd.faceAlt ? wd.faceAlt : wd.face;
    // cap overlay by same-height neighbour mask (N=1 E=2 S=4 W=8)
    const same = (nx: number, ny: number) => hClass(nx, ny) === my;
    const mask = (same(x, y - 1) ? 1 : 0) | (same(x + 1, y) ? 2 : 0) | (same(x, y + 1) ? 4 : 0) | (same(x - 1, y) ? 8 : 0);
    const isDoorGap = op?.kind === 'door' && (cut || southCovers);
    const capId = isDoorGap ? null : (cut ? wd.capsCut : wd.caps)?.[mask];
    const fx = x * T, fb = (y + 1) * T + M;
    list.push({ key: fb, layer: 0, x: fx, draw: () => { drawSprite(out, sid, fx, fb); if (capId && !(op?.kind === 'window' && southCovers)) drawSprite(out, capId, fx, fb); } });
  }
  // 4. scale figures (LPC body, for proportion checks only)
  if (o.people) {
    for (const p of [{ x: 5, y: 9 }, { x: 13, y: 6 }, { x: 18, y: 8 }]) {
      const fx = p.x * T + T / 2, fb = (p.y + 1) * T + M - 4;
      list.push({ key: fb, layer: 2, x: fx, draw: () => drawPerson(out, fx, fb) });
    }
  }
  list.sort((a, b) => a.key - b.key || a.layer - b.layer || a.x - b.x);
  for (const d of list) d.draw();
  return out;
}

const LPC = 'assets/vendor/lpc/lpc-generator/spritesheets';
function drawHead(dst: Img, cx: number, cy: number) {
  // head + hair only (rows 0..34 of the LPC down-facing frame), head centre ≈ (32, 24) in the frame
  for (const l of [`${LPC}/head/heads/human/male/walk.png`, `${LPC}/hair/bangs/adult/walk.png`]) if (fs.existsSync(l)) blit(dst, load(l), 0, 128, 64, 34, cx - 32, cy - 24);
}
function drawPerson(dst: Img, cx: number, feetY: number) {
  const layers = [`${LPC}/body/bodies/male/walk.png`, `${LPC}/legs/pants/male/walk.png`, `${LPC}/torso/clothes/longsleeve/longsleeve/male/walk.png`, `${LPC}/head/heads/human/male/walk.png`, `${LPC}/hair/bangs/adult/walk.png`];
  for (const l of layers) { if (!fs.existsSync(l)) continue; blit(dst, load(l), 0, 128, 64, 64, cx - 32, feetY - 62); }
}

// ----------------------------------------------------------------- object contact sheet
function objectSheet(): Img {
  const K = 2, CELL = 5 * T, COLS = 7;
  const entries: Array<{ id: string; sid: string; label: string }> = [];
  for (const id of Object.keys(defs)) {
    const a = art.objects[id];
    entries.push({ id, sid: a.default, label: id });
    for (const [k, v] of Object.entries(a.states ?? {})) entries.push({ id, sid: v as string, label: `${id}:${k}` });
    for (const [k, v] of Object.entries(a.rot ?? {})) if (v !== a.default && k !== '0') entries.push({ id, sid: v as string, label: `${id} rot${k}` });
    if (a.blanket) entries.push({ id, sid: a.blanket, label: `${id}:blanket` });
  }
  const rows = Math.ceil(entries.length / COLS);
  const sheet = create(COLS * CELL, rows * CELL, [46, 44, 52, 255]);
  entries.forEach((e, i) => {
    const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL;
    const def = defs[e.id];
    const fw = def.footprint.w, fh = def.footprint.h;
    // footprint placed so the whole sprite fits: bottom-left at (cx + (CELL - fw*T)/2, cy + CELL - 1.5T)
    const fx = cx + Math.floor((CELL - fw * T) / 2 / T) * T, fb = cy + CELL - T - 8;
    // floor checker under footprint + neighbours
    for (let yy = -fh - 1; yy <= 0; yy++) for (let xx = -1; xx <= fw; xx++) {
      const inside = xx >= 0 && xx < fw && yy < 0 && yy >= -fh;
      fillRect(sheet, fx + xx * T, fb + yy * T, T, T, inside ? [92, 84, 70, 255] : ((xx + yy) & 1 ? [60, 58, 66, 255] : [66, 64, 72, 255]));
    }
    if (def.wallMounted) fillRect(sheet, fx, fb - 80, fw * T, 80, [150, 140, 100, 255]); // wall face behind wall-mounted items
    drawSprite(sheet, e.sid, fx, fb);
    // footprint grid
    for (let j = 0; j < fh; j++) for (let k = 0; k < fw; k++) strokeRect(sheet, fx + k * T, fb - (fh - j) * T, T, T, [255, 0, 255, 200]);
    // slots
    for (const s of def.slots) {
      const sx = fx + s.dx * T + T / 2, sy = fb - fh * T + s.dy * T + T / 2;
      const col: [number, number, number, number] = s.pose === 'sit' ? [255, 220, 0, 255] : s.pose === 'lie' ? [60, 255, 90, 255] : [0, 230, 255, 255];
      fillRect(sheet, sx - 2, sy - 2, 5, 5, col);
      const [dx, dy] = ({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as Record<string, number[]>)[s.facing] ?? [0, 0];
      for (let t = 3; t < 9; t++) fillRect(sheet, sx + dx * t, sy + dy * t, 1, 1, col);
    }
    text(sheet, cx + 3, cy + 3, `${e.label} ${fw}x${fh}${def.blocks ? '' : ' noblock'}${def.wallMounted ? ' wall' : ''}`, [255, 240, 120, 255]);
  });
  return scale(sheet, K);
}

fs.mkdirSync(OUT, { recursive: true });
const full = renderLot({ cut: false, lit: true, people: true });
save(full, `${OUT}/${lotId}.png`);
save(scale(full, 2), `${OUT}/${lotId}@2x.png`);
const cutImg = renderLot({ cut: true, lit: true, doorsOpen: true, people: true });
save(cutImg, `${OUT}/${lotId}-cut.png`);
save(scale(cutImg, 2), `${OUT}/${lotId}-cut@2x.png`);
save(objectSheet(), `${OUT}/objects-sheet.png`);
console.log('rendered', lotId);
