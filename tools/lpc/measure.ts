/**
 * Dev helper: measure LPC body sheets (bounding boxes per frame, idle-vs-walk equality).
 * Usage: npx tsx tools/lpc/measure.ts [bodyType...]
 */
import { tryReadPng, type Img } from './png';

const ROOT = 'assets/vendor/lpc/lpc-generator/spritesheets/';
const DIRS = ['up', 'left', 'down', 'right'];

export function bbox(img: Img, fx: number, fy: number, w = 64, h = 64) {
  let x0 = 99, y0 = 99, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((fy + y) * img.width + fx + x) * 4;
      if (img.data[i + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  return { x0, y0, x1, y1 };
}

function same(a: Img, ax: number, ay: number, b: Img, bx: number, by: number): number {
  let diff = 0;
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const i = ((ay + y) * a.width + ax + x) * 4;
      const j = ((by + y) * b.width + bx + x) * 4;
      if (a.data[i + 3] !== b.data[j + 3] || (a.data[i + 3] && (a.data[i] !== b.data[j] || a.data[i + 1] !== b.data[j + 1]))) diff++;
    }
  return diff;
}

const bts = process.argv.slice(2).length ? process.argv.slice(2) : ['male', 'female', 'teen', 'child', 'pregnant'];
for (const bt of bts) {
  console.log(`== ${bt}`);
  for (const anim of ['idle', 'walk', 'sit', 'spellcast', 'thrust', 'slash', 'emote', 'hurt']) {
    const img = tryReadPng(`${ROOT}body/bodies/${bt}/${anim}.png`);
    if (!img) continue;
    const rows = img.height / 64;
    const cols = img.width / 64;
    const parts: string[] = [];
    for (let r = 0; r < rows; r++) {
      const bb = [];
      for (let c = 0; c < cols; c++) {
        const b = bbox(img, c * 64, r * 64);
        bb.push(`${b.y0}-${b.y1}`);
      }
      parts.push(`${rows === 1 ? 'down' : DIRS[r]}:[${bb.join(' ')}]`);
    }
    console.log(`${anim}: ${parts.join(' ')}`);
  }
  const idle = tryReadPng(`${ROOT}body/bodies/${bt}/idle.png`);
  const walk = tryReadPng(`${ROOT}body/bodies/${bt}/walk.png`);
  if (idle && walk) {
    const d = DIRS.map((_, r) => `${same(idle, 0, r * 64, walk, 0, r * 64)}/${same(idle, 64, r * 64, walk, 0, r * 64)}`);
    console.log(`idle f0/f1 vs walk f0 diff px per dir: ${d.join(' ')}`);
  }
  const down = walk ? bbox(walk, 0, 128) : null;
  if (down) console.log(`walk down f0 bbox x ${down.x0}-${down.x1}, y ${down.y0}-${down.y1}`);
}
