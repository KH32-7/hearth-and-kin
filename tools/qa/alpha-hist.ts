import { readFileSync } from 'node:fs';
import { planCharacter, randomSpecWith } from '../../src/render/lpc/plan';
import { renderPlan, mulberry32 } from '../lpc/compose-node';
const lpc = JSON.parse(readFileSync('src/data/artpacks/lpc.json', 'utf8'));
const outfits = JSON.parse(readFileSync('src/data/outfits.json', 'utf8'));
const rng = mulberry32(7);
const sh = renderPlan(planCharacter(randomSpecWith(outfits, rng, { estate: 'freeman' }), lpc, outfits));
const h: Record<number, number> = {};
const F = 64; const row = lpc.anims.idle.row + 2;
const colors: Record<string, number> = {};
for (let y = row * F; y < row * F + F; y++) for (let x = 0; x < F; x++) {
  const i = (y * sh.width + x) * 4; const a = sh.data[i + 3];
  const b = a === 0 ? 0 : a === 255 ? 255 : 128; h[b] = (h[b] ?? 0) + 1;
  if (a > 0 && a < 255) { const k = `${sh.data[i]},${sh.data[i+1]},${sh.data[i+2]},${a}`; colors[k] = (colors[k] ?? 0) + 1; }
}
console.log(h, Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 5));
