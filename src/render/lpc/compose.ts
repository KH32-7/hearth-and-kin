/**
 * LPC character compositor (browser).
 *
 * README
 * ------
 * Builds ONE sprite sheet per character from Universal LPC Spritesheet Generator layers
 * (assets/vendor/lpc/lpc-generator/spritesheets) plus our generated child garments
 * (assets/generated/lpc). Pipeline:
 *
 *   CharacterSpec --resolveLayers--> layers + colours  (src/data/outfits.json: estate x sex x stage x outfit)
 *                 --planCharacter--> Plan { sources[], ops[] }   (plan.ts, pure, shared with Node)
 *                 --composeCharacter--> canvas                    (this file: load, palette-swap, drawImage)
 *
 * tools/lpc/compose-node.ts executes the same Plan with pngjs, so browser and tools produce the same pixels.
 *
 * Standard layout (src/data/artpacks/lpc.json, written by tools/lpc/build-pack.ts from tools/lpc/layout.ts):
 *   frame 64x64, 8 columns x 46 rows (512 x 2944 px), no scaling, integer positions only.
 *   anchor (32, 62) = feet contact point (pixel rows < 62 stand above the ground line); same in every anim.
 *   each anim: `row` = first direction row; directions in order up, left, down, right (+1 row each).
 *
 *   anim       row  frames fps loop  dirs    source
 *   idle         0    2     2   yes   4      LPC idle (fallback: walk frame 0 when a worn layer lacks idle)
 *   walk         4    8    10   yes   4      LPC walk 1-8
 *   sit          8    3     0   no    4      poses: 0 ground knees-up, 1 cross-legged, 2 chair
 *   emote       12    3     4   no    4      LPC emote (fallback idle)
 *   slash       16    6    12   no    4
 *   thrust      20    8    12   no    4      (children: slash)
 *   shoot       24    8    10   no    4      LPC 13 frames subsampled (children: slash)
 *   spellcast   28    7    10   no    4      (children: slash)
 *   hurt        32    6    10   no    down   last frame = lying
 *   sleep       33    2     1   yes   down   head + shoulders crop, eyes closed; draw over a bed blanket
 *   eat         34    3     3   yes   4      seated (chair); down: food to mouth, others: chewing head bob
 *   carry       38    8    10   yes   4      walk legs + arms held forward (renderer draws the item)
 *   work        42    6     8   yes   4      hammer/knead loop (thrust frames; children: slash)
 *
 * Fallbacks (recorded in ComposedSheet.fallbacks): per animation the planner picks the first source
 * every worn layer has, so layers never misalign (e.g. a tabard without idle -> static idle from walk
 * frame 0; pregnant sit -> female body). Layers missing a body type borrow teen->female/male,
 * pregnant->female paths. `optional` layers (capes) are just skipped where they lack an animation.
 * Children use synthesized garments (LPC child clothes exist only for walk).
 *
 * Colours: recolourable layers are palette-swapped from the generator's base ramp (±1 per channel,
 * like the generator's CPU path); pre-coloured layers load `<anim>/<colour>.png`.
 * Credits: ComposedSheet.credits lists authors/licenses of every generator folder used.
 */
import packJson from '../../data/artpacks/lpc.json';
import outfitsJson from '../../data/outfits.json';
import { planCharacter, randomSpecWith, type RandomOpts } from './plan';
import { parseHex, recolorPixels } from './recolor';
import type { AnimInfo, AnimName, CharacterSpec, LpcPack, OutfitsData, Plan } from './types';

export type { AnimName, CharacterSpec, Facing } from './types';

export const LPC_PACK = packJson as unknown as LpcPack;
export const OUTFITS = outfitsJson as unknown as OutfitsData;

export interface ComposedSheet {
  image: HTMLCanvasElement | OffscreenCanvas;
  frameW: number;
  frameH: number;
  anchorX: number;
  anchorY: number;
  /** anims.sit.poses = { ground, crossLegged, chair } -> frame index */
  anims: Record<AnimName, AnimInfo>;
  credits: Array<{ file: string; authors: string[]; licenses: string[] }>;
  /** sleep frames: rows [0, sleepCropY) hold head + shoulders (place over the pillow / under the blanket edge) */
  sleepCropY?: number;
  /** notes about fallbacks / skipped layers (for debugging and QA) */
  fallbacks: string[];
}

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement | OffscreenCanvas): Canvas2D {
  const ctx = c.getContext('2d', { willReadFrequently: true }) as Canvas2D | null;
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function sizeOf(img: CanvasImageSource): { w: number; h: number } {
  const any = img as { width?: number | { baseVal: { value: number } }; height?: number | { baseVal: { value: number } }; displayWidth?: number; displayHeight?: number; naturalWidth?: number; naturalHeight?: number };
  const num = (v: unknown) => (typeof v === 'number' ? v : (v as { baseVal?: { value: number } })?.baseVal?.value ?? 0);
  return {
    w: any.naturalWidth || any.displayWidth || num(any.width),
    h: any.naturalHeight || any.displayHeight || num(any.height),
  };
}

/** Palette-swapped copy of an image (CPU, same rule as recolor.ts / the Node tools). */
function recolored(img: CanvasImageSource, from: string[], to: string[]): HTMLCanvasElement | OffscreenCanvas {
  const { w, h } = sizeOf(img);
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  recolorPixels(data.data, parseHex(from), parseHex(to));
  ctx.putImageData(data, 0, 0);
  return c;
}

/** Execute a plan onto a new canvas. */
export async function renderPlan(plan: Plan, load: (path: string) => Promise<CanvasImageSource>): Promise<HTMLCanvasElement | OffscreenCanvas> {
  const images = await Promise.all(
    plan.sources.map(async (s) => {
      const img = await load(s.path);
      return s.recolor ? recolored(img, s.recolor.from, s.recolor.to) : img;
    }),
  );
  const sheet = makeCanvas(plan.width, plan.height);
  const ctx = ctx2d(sheet);
  ctx.globalCompositeOperation = 'source-over';
  for (const op of plan.ops) {
    ctx.drawImage(images[op.s], op.sx, op.sy, op.w, op.h, op.dx, op.dy, op.w, op.h);
  }
  return sheet;
}

/** Plan only (no loading): useful for tests, previews and preloading `plan.sources`. */
export function planFor(spec: CharacterSpec, pack: LpcPack = LPC_PACK, outfits: OutfitsData = OUTFITS): Plan {
  return planCharacter(spec, pack, outfits);
}

export async function composeCharacter(
  spec: CharacterSpec,
  load: (path: string) => Promise<CanvasImageSource>,
): Promise<ComposedSheet> {
  const pack = LPC_PACK;
  const plan = planCharacter(spec, pack, OUTFITS);
  const image = await renderPlan(plan, load);
  return {
    image,
    frameW: pack.frameW,
    frameH: pack.frameH,
    anchorX: pack.anchorX,
    anchorY: pack.anchorY,
    anims: plan.anims,
    credits: plan.credits,
    sleepCropY: plan.sleepCropY,
    fallbacks: plan.fallbacks,
  };
}

/** Random character using only `rng` (seeded by the caller). outfit defaults to everyday. */
export function randomSpec(
  rng: () => number,
  opts?: Partial<Pick<CharacterSpec, 'sex' | 'stage' | 'estate'>>,
): CharacterSpec {
  return randomSpecWith(OUTFITS, rng, opts as RandomOpts);
}
