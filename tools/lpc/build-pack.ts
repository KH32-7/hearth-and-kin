/**
 * Builds src/data/artpacks/lpc.json: our sheet layout (tools/lpc/layout.ts) + the catalogue of every
 * LPC layer referenced by src/data/outfits.json (paths per body type, verified animation files,
 * palettes, credits) + body geometry measured from the base bodies.
 *
 * Usage: npx tsx tools/lpc/build-pack.ts
 * Run after editing outfits (gen-outfits.ts) or regenerating child garments (gen-child-garments.ts).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { inspectLayer, faceKeyForHead, buildPalette, SPRITE_ROOT, SRC_ANIMS } from './generator';
import { readPng, type Img } from './png';
import { ANIMS, ANCHOR_X, ANCHOR_Y, COLS, DIRS, FRAME, ROWS, SOURCE_ANIMS } from './layout';
import type { BodyType, BodyTypeInfo, CreditInfo, Facing, LayerDef, LpcPack, OutfitsData, SrcRef } from '../../src/render/lpc/types';

const OUT = 'src/data/artpacks/lpc.json';
const GEN_LAYERS = 'assets/generated/lpc/layers.json';

const outfits: OutfitsData = JSON.parse(readFileSync('src/data/outfits.json', 'utf8'));

// ---------------------------------------------------------------- collect layer ids
const ids = new Set<string>(['body']);
for (const look of Object.values(outfits.looks)) for (const s of look) for (const p of s.pick) ids.add(p);
for (const sex of Object.values(outfits.heads)) for (const list of Object.values(sex)) for (const h of list) ids.add(h);
for (const list of Object.values(outfits.stageExtras)) for (const x of list) ids.add(x);
for (const sex of Object.values(outfits.hair.styles)) for (const list of Object.values(sex)) for (const st of list) ids.add(`hair_${st}`);
for (const b of outfits.hair.beards) ids.add(b);

const credits: CreditInfo[] = [];
const layers: Record<string, LayerDef> = {};
const missing: string[] = [];

// generated layers (child garments etc.)
interface GenLayers { layers: Record<string, LayerDef & { creditEntries: CreditInfo[] }> }
const gen: GenLayers = existsSync(GEN_LAYERS) ? JSON.parse(readFileSync(GEN_LAYERS, 'utf8')) : { layers: {} };

const faceKeys = new Set<string>();
for (const id of [...ids].sort()) {
  const g = gen.layers[id];
  if (g) {
    const { creditEntries, ...def } = g;
    def.credits = creditEntries.map((c) => {
      let i = credits.findIndex((x) => x.file === c.file);
      if (i < 0) {
        credits.push(c);
        i = credits.length - 1;
      }
      return i;
    });
    layers[id] = def;
    continue;
  }
  if (id.startsWith('child_')) {
    missing.push(`${id} (run tools/lpc/gen-child-garments.ts)`);
    continue;
  }
  try {
    const def = inspectLayer(id, credits);
    if (def.type === 'head') {
      const fk = faceKeyForHead(id);
      if (fk) {
        def.face = fk;
        faceKeys.add(fk);
      }
    }
    layers[id] = def;
  } catch (e) {
    missing.push(`${id}: ${(e as Error).message}`);
  }
}
// closed-eye expression per head family (sleep)
for (const fk of faceKeys) layers[`face_closed@${fk}`] = inspectLayer('face_closed', credits, fk);
// 감정 표정 (M2: 감정이 얼굴에 보이게). 생성기 head/faces 정의 그대로
for (const expr of ['happy', 'happy2', 'sad', 'sad2', 'angry', 'angry2', 'shame', 'blush', 'shock', 'eyeroll']) {
  for (const fk of faceKeys) {
    try {
      layers[`face_${expr}@${fk}`] = inspectLayer(`face_${expr}`, credits, fk);
    } catch (e) {
      missing.push(`face_${expr}@${fk}: ${(e as Error).message}`);
    }
  }
}
if (gen.layers.child_face_closed && !layers.child_face_closed) {
  const { creditEntries, ...def } = gen.layers.child_face_closed;
  def.credits = creditEntries.map((c) => {
    credits.push(c);
    return credits.length - 1;
  });
  layers.child_face_closed = def;
}

// ---------------------------------------------------------------- palettes
const skins = outfits.skins;
const palettes: LpcPack['palettes'] = {
  body: buildPalette('body', skins),
  hair: buildPalette('hair', [...outfits.hair.colors, ...outfits.hair.elderColors]),
  cloth: buildPalette('cloth', ['brown', 'leather', 'walnut', 'yellow', 'tan', 'orange', 'rose', 'maroon', 'red', 'pink', 'lavender', 'purple', 'blue', 'navy', 'teal', 'bluegray', 'forest', 'green', 'white', 'sky', 'slate', 'gray', 'black', 'charcoal']),
  metal: buildPalette('metal', ['ceramic', 'brass', 'copper', 'bronze', 'iron', 'steel', 'silver', 'gold']),
  eye: buildPalette('eye', outfits.eyes),
};
// keep skin keys exactly as written in outfits (e.g. "lpcr.ivory")
palettes.body.colors = Object.fromEntries(skins.map((k) => [k, buildPalette('body', [k]).colors[k.replace(/^(ulpc|lpcr)\./, '')]]));

// ---------------------------------------------------------------- body geometry
function top(img: Img, fx: number, fy: number): number {
  for (let y = 0; y < FRAME; y++)
    for (let x = 0; x < FRAME; x++) if (img.data[((fy + y) * img.width + fx + x) * 4 + 3] > 0) return y;
  return FRAME;
}
function bodyImg(bt: BodyType, anim: string): Img | null {
  const p = `${SPRITE_ROOT}body/bodies/${bt}/${anim}.png`;
  return existsSync(p) ? readPng(p) : null;
}

const bodyDefaults: Record<BodyType, Pick<BodyTypeInfo, 'eatUpper' | 'carryUpper' | 'workSrc' | 'clothingFallback'> & { sleepBelow: number; eatBelow: number; carryBelow: number }> = {
  male: { eatUpper: { anim: 'spellcast', frames: [1, 2, 2] }, carryUpper: { anim: 'spellcast', frame: 2 }, workSrc: { anim: 'thrust', frames: [3, 4, 5, 6, 5, 4] }, clothingFallback: [], sleepBelow: 7, eatBelow: 14, carryBelow: 16 },
  female: { eatUpper: { anim: 'spellcast', frames: [1, 2, 2] }, carryUpper: { anim: 'spellcast', frame: 2 }, workSrc: { anim: 'thrust', frames: [3, 4, 5, 6, 5, 4] }, clothingFallback: [], sleepBelow: 7, eatBelow: 13, carryBelow: 15 },
  teen: { eatUpper: { anim: 'spellcast', frames: [1, 2, 2] }, carryUpper: { anim: 'spellcast', frame: 2 }, workSrc: { anim: 'thrust', frames: [3, 4, 5, 6, 5, 4] }, clothingFallback: ['female', 'male'], sleepBelow: 7, eatBelow: 13, carryBelow: 15 },
  pregnant: { eatUpper: { anim: 'spellcast', frames: [1, 2, 2] }, carryUpper: { anim: 'spellcast', frame: 2 }, workSrc: { anim: 'thrust', frames: [3, 4, 5, 6, 5, 4] }, clothingFallback: ['female'], sleepBelow: 7, eatBelow: 13, carryBelow: 15 },
  muscular: { eatUpper: { anim: 'spellcast', frames: [1, 2, 2] }, carryUpper: { anim: 'spellcast', frame: 2 }, workSrc: { anim: 'thrust', frames: [3, 4, 5, 6, 5, 4] }, clothingFallback: ['male'], sleepBelow: 7, eatBelow: 14, carryBelow: 16 },
  child: { eatUpper: { anim: 'slash', frames: [0, 1, 2] }, carryUpper: { anim: 'slash', frame: 2 }, workSrc: { anim: 'slash', frames: [0, 1, 2, 3, 4, 5] }, clothingFallback: [], sleepBelow: 6, eatBelow: 11, carryBelow: 12 },
};

/** x span of opaque pixels in the lowest `rows` rows of a frame (legs/feet), +-1 px margin */
function legSpan(img: Img, fx: number, fy: number, rows = 8): [number, number] {
  let bottom = -1;
  for (let y = FRAME - 1; y >= 0 && bottom < 0; y--)
    for (let x = 0; x < FRAME; x++) if (img.data[((fy + y) * img.width + fx + x) * 4 + 3] > 0) { bottom = y; break; }
  let x0 = FRAME, x1 = 0;
  for (let y = Math.max(0, bottom - rows + 1); y <= bottom; y++)
    for (let x = 0; x < FRAME; x++)
      if (img.data[((fy + y) * img.width + fx + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); }
  return [Math.max(0, x0 - 1), Math.min(FRAME, x1 + 1)];
}

const bodyTypes: LpcPack['bodyTypes'] = {};
for (const bt of Object.keys(bodyDefaults) as BodyType[]) {
  const d = bodyDefaults[bt];
  const anims = SRC_ANIMS.filter((a) => bodyImg(bt, a));
  const idle = bodyImg(bt, 'idle')!;
  const walk = bodyImg(bt, 'walk')!;
  const sit = bodyImg(bt, 'sit')!;
  const cu = bodyImg(bt, d.carryUpper.anim)!;
  const eu = bodyImg(bt, d.eatUpper.anim)!;
  const down = DIRS.indexOf('down');
  const shoulder = top(idle, 0, down * FRAME);
  const walkBob = {} as Record<Facing, number[]>;
  DIRS.forEach((dir, di) => {
    const upperTop = top(cu, d.carryUpper.frame * FRAME, di * FRAME);
    walkBob[dir] = Array.from({ length: SOURCE_ANIMS.walk.frames }, (_, f) => top(walk, f * FRAME, di * FRAME) - upperTop);
  });
  const span = (img: Img, frames: number) => Object.fromEntries(DIRS.map((dir, di) => [dir, Array.from({ length: frames }, (_, f) => legSpan(img, f * FRAME, di * FRAME))])) as Record<Facing, Array<[number, number]>>;
  const legSpans = { walk: span(walk, SOURCE_ANIMS.walk.frames), sit: span(sit, SOURCE_ANIMS.sit.frames) };
  const sitTop = top(sit, 2 * FRAME, down * FRAME);
  const eatTop = top(eu, d.eatUpper.frames[0] * FRAME, down * FRAME);
  bodyTypes[bt] = {
    sleepCropY: shoulder + d.sleepBelow,
    cutEat: sitTop + d.eatBelow,
    eatDy: sitTop - eatTop,
    cutCarry: top(walk, 0, down * FRAME) + d.carryBelow,
    walkBob,
    legSpan: legSpans,
    eatUpper: d.eatUpper as SrcRef,
    carryUpper: d.carryUpper,
    workSrc: d.workSrc as SrcRef,
    anims,
    clothingFallback: d.clothingFallback,
  };
}

// ---------------------------------------------------------------- write
const pack: LpcPack & { _comment: string } = {
  _comment: 'Generated by tools/lpc/build-pack.ts (layout: tools/lpc/layout.ts). Frame rows per anim: row = first direction row (up,left,down,right), +1 per direction. anchor = feet contact point inside a 64x64 frame.',
  id: 'lpc',
  roots: { lpc: SPRITE_ROOT, gen: 'assets/generated/lpc/' },
  frameW: FRAME,
  frameH: FRAME,
  anchorX: ANCHOR_X,
  anchorY: ANCHOR_Y,
  cols: COLS,
  rows: ROWS,
  dirs: DIRS,
  sourceAnims: SOURCE_ANIMS,
  anims: ANIMS,
  bodyTypes,
  palettes,
  layers,
  credits,
};
writeFileSync(OUT, JSON.stringify(pack) + '\n');
const size = readFileSync(OUT).length;
console.log(`wrote ${OUT}: ${Object.keys(layers).length} layers, ${credits.length} credit entries, ${(size / 1024).toFixed(0)} KB`);
if (missing.length) console.log('missing:\n  ' + missing.join('\n  '));
for (const bt of Object.keys(bodyTypes) as BodyType[]) {
  const b = bodyTypes[bt]!;
  console.log(`${bt}: sleepCropY=${b.sleepCropY} cutEat=${b.cutEat} eatDy=${b.eatDy} cutCarry=${b.cutCarry} bobDown=${b.walkBob.down.join(',')} anims=${b.anims.join(',')}`);
}
