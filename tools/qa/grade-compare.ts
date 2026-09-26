// 색 보정 후보 비교 시트: 오두막 그림 위에 같은 인물을 보정별로 세움
import { readFileSync } from 'node:fs';
import { planCharacter, randomSpecWith } from '../../src/render/lpc/plan';
import type { LpcPack, OutfitsData } from '../../src/render/lpc/types';
import { applyGrade, type Grade } from '../../src/render/color';
import { readPng, writePng, blit, scaleNearest, type Img } from '../lpc/png';
import { renderPlan, mulberry32 } from '../lpc/compose-node';

const lpc: LpcPack = JSON.parse(readFileSync('src/data/artpacks/lpc.json', 'utf8'));
const outfits: OutfitsData = JSON.parse(readFileSync('src/data/outfits.json', 'utf8'));
const base: Grade = { saturation: 1, value: 1, contrast: 1, tint: [1, 1, 1], paletteSnap: 0, snapMaxDeltaE: 14 };
const cur = JSON.parse(readFileSync('src/data/grading.json', 'utf8')).character as Grade;
const variants: Array<[string, Grade]> = [
  ['raw', base],
  ['현재 D', cur],
  ['G', { ...cur, darkTint: { hue: 20, sat: 0.3, maxV: 0.45 }, brightSatCompress: 0.35 }],
  ['H', { ...cur, darkTint: { hue: 18, sat: 0.4, maxV: 0.5 }, brightSatCompress: 0.5, valueFloor: 0.22 }],
];
const bg = readPng('artifacts/world-samples/cottage-cut.png');
const rng = mulberry32(7);
const estates = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'] as const;
const specs = [...estates.map((e) => randomSpecWith(outfits, rng, { estate: e })), ...estates.map((e) => randomSpecWith(outfits, rng, { estate: e, stage: 'child' }))];
const sheets = specs.slice(7).map((sp) => renderPlan(planCharacter(sp, lpc, outfits)));
const F = lpc.frameW;
const rowH = 90;
const out: Img = { width: 7 * 60 + 20, height: variants.length * rowH, data: new Uint8Array((7 * 60 + 20) * variants.length * rowH * 4) };
variants.forEach(([, g], vi) => {
  // 배경: 오두막 바닥+벽 일부
  blit(out, bg, 60, 150, out.width, rowH, 0, vi * rowH);
  sheets.forEach((sh, i) => {
    const copy: Img = { width: sh.width, height: sh.height, data: new Uint8Array(sh.data) };
    applyGrade(copy.data, g);
    const row = lpc.anims.idle.row + 2;
    blit(out, copy, 0, row * F, F, F, 10 + i * 60 - 2, vi * rowH + 20);
  });
});
writePng('artifacts/palette/grade-compare.png', scaleNearest(out, 3));
console.log(variants.map((v) => v[0]).join(' / '));
