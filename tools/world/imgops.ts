// Pixel-art safe image operations (no resampling): crop, widen by column repeat, recolour, masks.
import { Img, create, blit, crop } from './png';

export type RGBA = [number, number, number, number];

export function clone(src: Img): Img {
  return { w: src.w, h: src.h, data: Buffer.from(src.data) };
}

export function px(img: Img, x: number, y: number): RGBA {
  const i = (y * img.w + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

export function setPx(img: Img, x: number, y: number, c: RGBA): void {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  img.data.set(c, (y * img.w + x) * 4);
}

export function paste(dst: Img, src: Img, dx: number, dy: number, flipX = false): void {
  blit(dst, src, 0, 0, src.w, src.h, dx, dy, true, flipX);
}

export function bboxOf(img: Img, alphaMin = 8): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.data[(y * img.w + x) * 4 + 3] > alphaMin) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  if (x1 < 0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Insert `add` columns at x = at, copied cyclically from columns [s0, s1). */
export function widen(src: Img, at: number, s0: number, s1: number, add: number): Img {
  const out = create(src.w + add, src.h);
  blit(out, src, 0, 0, at, src.h, 0, 0, false);
  for (let i = 0; i < add; i++) {
    const sx = s0 + (i % (s1 - s0));
    blit(out, src, sx, 0, 1, src.h, at + i, 0, false);
  }
  blit(out, src, at, 0, src.w - at, src.h, at + add, 0, false);
  return out;
}

/** Insert `add` rows at y = at, copied cyclically from rows [s0, s1). */
export function heighten(src: Img, at: number, s0: number, s1: number, add: number): Img {
  const out = create(src.w, src.h + add);
  blit(out, src, 0, 0, src.w, at, 0, 0, false);
  for (let i = 0; i < add; i++) {
    const sy = s0 + (i % (s1 - s0));
    blit(out, src, 0, sy, src.w, 1, 0, at + i, false);
  }
  blit(out, src, 0, at, src.w, src.h - at, 0, at + add, false);
  return out;
}

/** Remove columns [c0, c1). */
export function removeCols(src: Img, c0: number, c1: number): Img {
  const out = create(src.w - (c1 - c0), src.h);
  blit(out, src, 0, 0, c0, src.h, 0, 0, false);
  blit(out, src, c1, 0, src.w - c1, src.h, c0, 0, false);
  return out;
}

export function rotate90cw(src: Img): Img {
  const out = create(src.h, src.w);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) setPx(out, src.h - 1 - y, x, px(src, x, y));
  return out;
}

export function rotate90ccw(src: Img): Img {
  const out = create(src.h, src.w);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) setPx(out, y, src.w - 1 - x, px(src, x, y));
  return out;
}

export function mapPixels(src: Img, fn: (c: RGBA, x: number, y: number) => RGBA | null): Img {
  const out = clone(src);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const c = px(src, x, y);
    if (c[3] === 0) continue;
    const r = fn(c, x, y);
    if (r) setPx(out, x, y, r);
  }
  return out;
}

export const lum = (c: RGBA) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

export function hsv(c: RGBA): [number, number, number] {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}

export function hex(s: string, a = 255): RGBA {
  const n = parseInt(s.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

/**
 * Palette transfer: pixels accepted by `pred` are mapped to `ramp` (sorted dark→light)
 * by their luminance rank among the accepted source colours. Keeps alpha.
 */
export function rampRecolor(src: Img, ramp: RGBA[], pred: (c: RGBA) => boolean): Img {
  const cols = new Map<string, RGBA>();
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const c = px(src, x, y);
    if (c[3] > 0 && pred(c)) cols.set(c.slice(0, 3).join(','), c);
  }
  const list = [...cols.values()].sort((a, b) => lum(a) - lum(b));
  const lo = lum(list[0] ?? [0, 0, 0, 0]), hi = lum(list[list.length - 1] ?? [255, 255, 255, 0]);
  const map = new Map<string, RGBA>();
  for (const c of list) {
    const t = hi > lo ? (lum(c) - lo) / (hi - lo) : 0.5;
    const r = ramp[Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1)))];
    map.set(c.slice(0, 3).join(','), [r[0], r[1], r[2], c[3]]);
  }
  return mapPixels(src, (c) => (pred(c) ? map.get(c.slice(0, 3).join(',')) ?? null : null));
}

/** Keep only pixels matching pred (others transparent). */
export function keep(src: Img, pred: (c: RGBA, x: number, y: number) => boolean): Img {
  const out = create(src.w, src.h);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const c = px(src, x, y);
    if (c[3] > 0 && pred(c, x, y)) setPx(out, x, y, c);
  }
  return out;
}

/** Stack images horizontally (same height expected; pads to max height, bottom aligned). */
export function hstack(frames: Img[]): Img {
  const h = Math.max(...frames.map((f) => f.h));
  const out = create(frames.reduce((s, f) => s + f.w, 0), h);
  let x = 0;
  for (const f of frames) { blit(out, f, 0, 0, f.w, f.h, x, h - f.h, false); x += f.w; }
  return out;
}

export { crop, create, blit };
