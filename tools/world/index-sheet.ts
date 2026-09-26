// Dev helper: labelled contact sheet of every PNG in a folder (filter by regex).
// npx tsx tools/world/index-sheet.ts <dir> <outPrefix> [regex] [scale=2] [pageW=1400] [pageH=1100]
import fs from 'node:fs';
import path from 'node:path';
import { load, create, blit, fillRect, text, save, scale } from './png';

const [dir, outPrefix, re = '.', ks = '2', pws = '1400', phs = '1100'] = process.argv.slice(2);
const k = +ks, PW = +pws, PH = +phs;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png') && new RegExp(re).test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
let page = 0, cx = 4, cy = 4, rowH = 0;
let canvas = create(PW, PH, [40, 40, 48, 255]);
const flush = () => { save(canvas, `${outPrefix}_${page}.png`); page++; canvas = create(PW, PH, [40, 40, 48, 255]); cx = 4; cy = 4; rowH = 0; };
for (const f of files) {
  const img = scale(load(path.join(dir, f)), k);
  const label = f.replace(/\.png$/, '') + ` ${img.w / k}x${img.h / k}`;
  const cellW = Math.max(img.w, label.length * 4) + 6, cellH = img.h + 10;
  if (cx + cellW > PW) { cx = 4; cy += rowH + 4; rowH = 0; }
  if (cy + cellH > PH) flush();
  for (let j = 0; j < img.h; j += 8) for (let i = 0; i < img.w; i += 8) fillRect(canvas, cx + i, cy + 8 + j, Math.min(8, img.w - i), Math.min(8, img.h - j), ((i + j) / 8) % 2 ? [70, 70, 84, 255] : [58, 58, 70, 255]);
  blit(canvas, img, 0, 0, img.w, img.h, cx, cy + 8);
  text(canvas, cx, cy + 1, label, [255, 230, 90, 255]);
  cx += cellW; rowH = Math.max(rowH, cellH);
}
flush();
console.log(`${files.length} files -> ${page} pages`);
