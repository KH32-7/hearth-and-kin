/**
 * Minimal RGBA image helpers for the Node-side LPC tools (pngjs based).
 * The browser compositor never imports this file.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';

export interface Img {
  width: number;
  height: number;
  data: Uint8Array; // RGBA, row-major
}

export function newImg(width: number, height: number): Img {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

const cache = new Map<string, Img>();

export function readPng(path: string): Img {
  const hit = cache.get(path);
  if (hit) return hit;
  const png = PNG.sync.read(readFileSync(path));
  const img: Img = { width: png.width, height: png.height, data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length) };
  cache.set(path, img);
  return img;
}

export function tryReadPng(path: string): Img | null {
  return existsSync(path) ? readPng(path) : null;
}

export function writePng(path: string, img: Img): void {
  mkdirSync(dirname(path), { recursive: true });
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  writeFileSync(path, PNG.sync.write(png));
}

/** Source-over alpha blend of a rect of src onto dst (integer positions only). */
export function blit(dst: Img, src: Img, sx: number, sy: number, w: number, h: number, dx: number, dy: number): void {
  for (let y = 0; y < h; y++) {
    const syy = sy + y;
    const dyy = dy + y;
    if (syy < 0 || syy >= src.height || dyy < 0 || dyy >= dst.height) continue;
    for (let x = 0; x < w; x++) {
      const sxx = sx + x;
      const dxx = dx + x;
      if (sxx < 0 || sxx >= src.width || dxx < 0 || dxx >= dst.width) continue;
      const si = (syy * src.width + sxx) * 4;
      const sa = src.data[si + 3];
      if (sa === 0) continue;
      const di = (dyy * dst.width + dxx) * 4;
      if (sa === 255) {
        dst.data[di] = src.data[si];
        dst.data[di + 1] = src.data[si + 1];
        dst.data[di + 2] = src.data[si + 2];
        dst.data[di + 3] = 255;
        continue;
      }
      const da = dst.data[di + 3];
      if (da === 255) {
        // opaque destination: same 8-bit premultiplied rounding as the browser canvas (Skia)
        for (let c = 0; c < 3; c++) dst.data[di + c] = div255(src.data[si + c] * sa) + div255(dst.data[di + c] * (255 - sa));
        continue;
      }
      const a = sa / 255;
      const outA = a + (da / 255) * (1 - a);
      for (let c = 0; c < 3; c++) {
        const sc = src.data[si + c];
        const dc = dst.data[di + c];
        dst.data[di + c] = Math.round((sc * a + dc * (da / 255) * (1 - a)) / (outA || 1));
      }
      dst.data[di + 3] = Math.round(outA * 255);
    }
  }
}

export function scaleNearest(src: Img, k: number): Img {
  const out = newImg(src.width * k, src.height * k);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const si = (((y / k) | 0) * src.width + ((x / k) | 0)) * 4;
      const di = (y * out.width + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

export function fill(img: Img, r: number, g: number, b: number, a = 255): void {
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = a;
  }
}

export function crop(src: Img, x: number, y: number, w: number, h: number): Img {
  const out = newImg(w, h);
  blit(out, src, x, y, w, h, 0, 0);
  return out;
}

/** x / 255 rounded, exact for 0..65025 */
function div255(x: number): number {
  return (x + 128 + ((x + 128) >> 8)) >> 8;
}
