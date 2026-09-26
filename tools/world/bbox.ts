// Dev helper: print opaque bounding boxes of PNG files (or a rect in a sheet).
// npx tsx tools/world/bbox.ts <png> [<png> ...]
import { load } from './png';

export function bbox(file: string, rx = 0, ry = 0, rw?: number, rh?: number): { x: number; y: number; w: number; h: number } | null {
  const img = load(file);
  const W = rw ?? img.w, H = rh ?? img.h;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = ry; y < ry + H; y++) for (let x = rx; x < rx + W; x++) {
    if (img.data[(y * img.w + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

if (process.argv[1]?.endsWith('bbox.ts')) {
  for (const f of process.argv.slice(2)) {
    const img = load(f);
    console.log(`${f.split(/[\\/]/).pop()} ${img.w}x${img.h} bbox=${JSON.stringify(bbox(f))}`);
  }
}
