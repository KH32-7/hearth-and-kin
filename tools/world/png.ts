// Minimal RGBA image helpers for world-art tooling (Node only, pngjs).
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

export interface Img { w: number; h: number; data: Buffer }

const cache = new Map<string, Img>();

export function load(file: string): Img {
  const hit = cache.get(file);
  if (hit) return hit;
  const png = PNG.sync.read(fs.readFileSync(file));
  const img = { w: png.width, h: png.height, data: png.data as Buffer };
  cache.set(file, img);
  return img;
}

export function create(w: number, h: number, rgba: [number, number, number, number] = [0, 0, 0, 0]): Img {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { w, h, data };
}

export function save(img: Img, file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const png = new PNG({ width: img.w, height: img.h });
  img.data.copy(png.data);
  fs.writeFileSync(file, PNG.sync.write(png));
}

export function crop(src: Img, x: number, y: number, w: number, h: number): Img {
  const out = create(w, h);
  blit(out, src, x, y, w, h, 0, 0, false);
  return out;
}

/** Copy a rect of src onto dst. alpha=true: source-over blend, else overwrite. */
export function blit(dst: Img, src: Img, sx: number, sy: number, w: number, h: number, dx: number, dy: number, alpha = true, flipX = false): void {
  for (let j = 0; j < h; j++) {
    const syy = sy + j, dyy = dy + j;
    if (syy < 0 || syy >= src.h || dyy < 0 || dyy >= dst.h) continue;
    for (let i = 0; i < w; i++) {
      const sxx = flipX ? sx + w - 1 - i : sx + i, dxx = dx + i;
      if (sxx < 0 || sxx >= src.w || dxx < 0 || dxx >= dst.w) continue;
      const si = (syy * src.w + sxx) * 4, di = (dyy * dst.w + dxx) * 4;
      const a = src.data[si + 3];
      if (!alpha) { src.data.copy(dst.data, di, si, si + 4); continue; }
      if (a === 0) continue;
      if (a === 255) { src.data.copy(dst.data, di, si, si + 4); continue; }
      const fa = a / 255, da = dst.data[di + 3] / 255, oa = fa + da * (1 - fa);
      for (let c = 0; c < 3; c++) dst.data[di + c] = Math.round((src.data[si + c] * fa + dst.data[di + c] * da * (1 - fa)) / oa);
      dst.data[di + 3] = Math.round(oa * 255);
    }
  }
}

export function scale(src: Img, k: number): Img {
  const out = create(src.w * k, src.h * k);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const si = (Math.floor(y / k) * src.w + Math.floor(x / k)) * 4;
    src.data.copy(out.data, (y * out.w + x) * 4, si, si + 4);
  }
  return out;
}

export function fillRect(img: Img, x: number, y: number, w: number, h: number, rgba: [number, number, number, number]): void {
  for (let j = Math.max(0, y); j < Math.min(img.h, y + h); j++) for (let i = Math.max(0, x); i < Math.min(img.w, x + w); i++) {
    const di = (j * img.w + i) * 4;
    if (rgba[3] === 255) { img.data.set(rgba, di); continue; }
    const fa = rgba[3] / 255;
    for (let c = 0; c < 3; c++) img.data[di + c] = Math.round(rgba[c] * fa + img.data[di + c] * (1 - fa));
    img.data[di + 3] = Math.max(img.data[di + 3], rgba[3]);
  }
}

export function strokeRect(img: Img, x: number, y: number, w: number, h: number, rgba: [number, number, number, number]): void {
  fillRect(img, x, y, w, 1, rgba); fillRect(img, x, y + h - 1, w, 1, rgba);
  fillRect(img, x, y, 1, h, rgba); fillRect(img, x + w - 1, y, 1, h, rgba);
}

// 3x5 pixel font for labels (digits, upper-case letters, a few symbols)
const FONT: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001001010010', '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', '_': '000000000000111', '-': '000000111000000', 'x': '000101010101000', ' ': '000000000000000',
  '.': '000000000000010', ':': '000010000010000', '/': '001001010100100', '(': '010100100100010', ')': '010001001001010', ',': '000000000010100',
};

export function text(img: Img, x: number, y: number, s: string, rgba: [number, number, number, number] = [255, 255, 255, 255], k = 1): void {
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT[ch.toUpperCase()] ?? FONT[' '];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r * 3 + c] === '1') fillRect(img, cx + c * k, y + r * k, k, k, rgba);
    cx += 4 * k;
  }
}
