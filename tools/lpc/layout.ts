/**
 * Our standard LPC sheet layout (source of truth for src/data/artpacks/lpc.json's layout part).
 * build-pack.ts writes this plus the generated catalogue (layers, palettes, credits, body geometry).
 *
 * Sheet: 8 columns x 46 rows of 64x64 frames (512 x 2944 px).
 * Direction rows: up, left, down, right (same order as the LPC generator).
 */
import type { AnimDef, AnimName, Facing, SrcAnimInfo } from '../../src/render/lpc/types';

export const DIRS: Facing[] = ['up', 'left', 'down', 'right'];
const ALL = DIRS;
const DOWN: Facing[] = ['down'];

export const FRAME = 64;
export const COLS = 8;
/** feet contact point inside a frame: x centre, y = first row below the feet */
export const ANCHOR_X = 32;
export const ANCHOR_Y = 62;

/** LPC generator animation files: frames per row, rows (4 = per direction). */
export const SOURCE_ANIMS: Record<string, SrcAnimInfo> = {
  idle: { file: 'idle', frames: 2, rows: 4 },
  walk: { file: 'walk', frames: 9, rows: 4 },
  sit: { file: 'sit', frames: 3, rows: 4 },
  emote: { file: 'emote', frames: 3, rows: 4 },
  slash: { file: 'slash', frames: 6, rows: 4 },
  thrust: { file: 'thrust', frames: 8, rows: 4 },
  shoot: { file: 'shoot', frames: 13, rows: 4 },
  spellcast: { file: 'spellcast', frames: 7, rows: 4 },
  hurt: { file: 'hurt', frames: 6, rows: 1 },
};

const r = (n: number) => Array.from({ length: n }, (_, i) => i);

export const ANIMS: Record<AnimName, AnimDef> = {
  idle: {
    row: 0, frames: 2, fps: 2, loop: true, dirs: ALL, recipe: 'direct',
    src: [{ anim: 'idle', frames: [0, 1] }, { anim: 'walk', frames: [0, 0] }],
    note: 'breathing idle; falls back to the standing walk frame when a worn layer has no idle sprites',
  },
  walk: {
    row: 4, frames: 8, fps: 10, loop: true, dirs: ALL, recipe: 'direct',
    src: [{ anim: 'walk', frames: [1, 2, 3, 4, 5, 6, 7, 8] }],
    note: 'LPC walk frames 1-8 (frame 0 = standing is the idle fallback)',
  },
  sit: {
    row: 8, frames: 3, fps: 0, loop: false, dirs: ALL, recipe: 'direct',
    src: [{ anim: 'sit', frames: [0, 1, 2] }],
    poses: { ground: 0, crossLegged: 1, chair: 2 },
    note: 'not an animation: 3 poses (ground knees-up, ground cross-legged, on a chair)',
  },
  emote: {
    row: 12, frames: 3, fps: 4, loop: false, dirs: ALL, recipe: 'direct',
    src: [{ anim: 'emote', frames: [0, 1, 2] }, { anim: 'idle', frames: [0, 1, 1] }, { anim: 'walk', frames: [0, 0, 0] }],
    note: 'hands on hips, hands on hips, arms raised (cheer)',
  },
  slash: {
    row: 16, frames: 6, fps: 12, loop: false, dirs: ALL, recipe: 'direct',
    src: [{ anim: 'slash', frames: r(6) }],
  },
  thrust: {
    row: 20, frames: 8, fps: 12, loop: false, dirs: ALL, recipe: 'direct',
    src: [{ anim: 'thrust', frames: r(8) }, { anim: 'slash', frames: [0, 1, 2, 3, 4, 5, 5, 5] }],
  },
  shoot: {
    row: 24, frames: 8, fps: 10, loop: false, dirs: ALL, recipe: 'direct',
    src: [{ anim: 'shoot', frames: [0, 1, 2, 3, 4, 8, 9, 12] }, { anim: 'slash', frames: [0, 1, 1, 2, 2, 3, 4, 5] }],
    note: 'LPC shoot has 13 frames; subsampled to 8 (draw, aim, release)',
  },
  spellcast: {
    row: 28, frames: 7, fps: 10, loop: false, dirs: ALL, recipe: 'direct',
    src: [{ anim: 'spellcast', frames: r(7) }, { anim: 'slash', frames: [0, 1, 2, 3, 3, 4, 5] }],
  },
  hurt: {
    row: 32, frames: 6, fps: 10, loop: false, dirs: DOWN, recipe: 'direct',
    src: [{ anim: 'hurt', frames: r(6), row: 0 }],
    note: 'LPC hurt only faces down; last frame = lying on the ground',
  },
  sleep: {
    row: 33, frames: 2, fps: 1, loop: true, dirs: DOWN, recipe: 'sleep',
    src: [{ anim: 'idle', frames: [0, 1] }, { anim: 'walk', frames: [0, 0] }],
    note: 'head + shoulders only (rows above bodyType.sleepCropY), eyes closed; drawn over a bed blanket',
  },
  eat: {
    row: 34, frames: 3, fps: 3, loop: true, dirs: ALL, recipe: 'eat',
    src: [{ anim: 'sit', frames: [2, 2, 2] }],
    headBob: [0, 1, 0],
    note: 'seated on a chair. down: arms lift food to the mouth (upper body from bodyType.eatUpper); other directions: chewing head bob',
  },
  carry: {
    row: 38, frames: 8, fps: 10, loop: true, dirs: ALL, recipe: 'carry',
    src: [{ anim: 'walk', frames: [1, 2, 3, 4, 5, 6, 7, 8] }],
    note: 'walk with both arms held forward at chest height (renderer draws the carried item)',
  },
  work: {
    row: 42, frames: 6, fps: 8, loop: true, dirs: ALL, recipe: 'work',
    src: [{ anim: 'slash', frames: r(6) }],
    note: 'hammer / knead motion reused from LPC thrust (adults) or slash (children); see bodyType.workSrc',
  },
};

export const ROWS = 46;
