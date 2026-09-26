/**
 * Dev helper: upscale a PNG (or a region of it) onto a grey background so it can be inspected.
 * Usage: npx tsx tools/lpc/peek.ts <in.png> <out.png> [scale=3] [x y w h]
 */
import { readPng, writePng, newImg, fill, blit, scaleNearest, crop } from './png';

const [inp, out, s = '3', x, y, w, h] = process.argv.slice(2);
let img = readPng(inp);
if (x !== undefined) img = crop(img, +x, +y, +w, +h);
const bg = newImg(img.width, img.height);
fill(bg, 150, 160, 150);
// frame grid lines every 64px
for (let yy = 0; yy < bg.height; yy++)
  for (let xx = 0; xx < bg.width; xx++)
    if (xx % 64 === 0 || yy % 64 === 0) {
      const i = (yy * bg.width + xx) * 4;
      bg.data[i] = 120; bg.data[i + 1] = 120; bg.data[i + 2] = 130;
    }
blit(bg, img, 0, 0, img.width, img.height, 0, 0);
writePng(out, scaleNearest(bg, +s));
console.log(`${inp} ${img.width}x${img.height} -> ${out}`);
