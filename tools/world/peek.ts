// Dev helper: crop a region of a sheet, overlay a grid with pixel coordinates, scale up.
// npx tsx tools/world/peek.ts <png> <x> <y> <w> <h> <out.png> [scale=2] [grid=32]
import { load, crop, scale, create, blit, fillRect, text, save } from './png';

const [file, xs, ys, ws, hs, out, ks = '2', gs = '32'] = process.argv.slice(2);
const x = +xs, y = +ys, w = +ws, h = +hs, k = +ks, g = +gs;
const src = load(file);
const c = crop(src, x, y, Math.min(w, src.w - x), Math.min(h, src.h - y));
// checker background so transparency is visible
const bg = create(c.w, c.h, [60, 60, 70, 255]);
for (let j = 0; j < c.h; j += 8) for (let i = 0; i < c.w; i += 8) if (((i + j) / 8) % 2) fillRect(bg, i, j, 8, 8, [75, 75, 88, 255]);
blit(bg, c, 0, 0, c.w, c.h, 0, 0);
const big = scale(bg, k);
const pad = 20;
const canvas = create(big.w + pad, big.h + pad, [20, 20, 20, 255]);
blit(canvas, big, 0, 0, big.w, big.h, pad, pad, false);
for (let gx = Math.ceil(x / g) * g; gx < x + c.w; gx += g) {
  fillRect(canvas, pad + (gx - x) * k, pad, 1, big.h, [255, 0, 255, 140]);
  text(canvas, pad + (gx - x) * k + 1, 2, String(gx), [255, 255, 0, 255]);
}
for (let gy = Math.ceil(y / g) * g; gy < y + c.h; gy += g) {
  fillRect(canvas, pad, pad + (gy - y) * k, big.w, 1, [255, 0, 255, 140]);
  text(canvas, 0, pad + (gy - y) * k + 2, String(gy), [255, 255, 0, 255]);
}
save(canvas, out);
console.log(`src ${src.w}x${src.h} -> ${out} ${canvas.w}x${canvas.h}`);
