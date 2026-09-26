// 표정 비교 시트: 같은 인물 3명(남/여/노년) × 표정 12, idle 정면 4배
import { readFileSync } from 'node:fs';
import { planCharacter, randomSpecWith } from '../../src/render/lpc/plan';
import { renderPlan, mulberry32 } from '../lpc/compose-node';
import { blit, newImg, fill, scaleNearest, writePng } from '../lpc/png';
const lpc = JSON.parse(readFileSync('src/data/artpacks/lpc.json', 'utf8'));
const outfits = JSON.parse(readFileSync('src/data/outfits.json', 'utf8'));
const rng = mulberry32(3);
const people = [randomSpecWith(outfits, rng, { sex: 'male', stage: 'adult', estate: 'freeman' }), randomSpecWith(outfits, rng, { sex: 'female', stage: 'adult', estate: 'merchant' }), randomSpecWith(outfits, rng, { sex: 'female', stage: 'elder', estate: 'serf' })];
const exprs = ['', 'happy', 'happy2', 'sad', 'sad2', 'angry', 'angry2', 'shame', 'blush', 'shock', 'eyeroll'];
const F = 64;
const out = newImg(exprs.length * 40 + 8, people.length * 48 + 8);
fill(out, 120, 96, 78, 255);
people.forEach((sp, pi) => exprs.forEach((e, ei) => {
  const spec = { ...sp, layers: { ...(sp.layers ?? {}), ...(e ? { $expr: e } : {}) } };
  const sheet = renderPlan(planCharacter(spec as never, lpc, outfits));
  const row = lpc.anims.idle.row + 2;
  blit(out, sheet, 12, row * F + 8, 40, 40, 4 + ei * 40, 4 + pi * 48);
}));
writePng('artifacts/lpc-samples/expressions.png', scaleNearest(out, 4));
console.log(exprs.join(' | '));
