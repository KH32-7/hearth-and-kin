/**
 * Node compositor: executes the same plan as src/render/lpc/compose.ts with pngjs, and generates
 * sample sheets + a contact sheet in artifacts/lpc-samples/.
 *
 * Usage:
 *   npx tsx tools/lpc/compose-node.ts                 # 14 fixed samples + contact sheet
 *   npx tsx tools/lpc/compose-node.ts --seed 7 --n 20 # random samples
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { planCharacter, randomSpecWith } from '../../src/render/lpc/plan';
import { parseHex, recolorPixels } from '../../src/render/lpc/recolor';
import type { CharacterSpec, LpcPack, OutfitsData, Plan } from '../../src/render/lpc/types';
import { readPng, writePng, newImg, blit, scaleNearest, fill, type Img } from './png';

export function loadData(): { pack: LpcPack; outfits: OutfitsData } {
  return {
    pack: JSON.parse(readFileSync('src/data/artpacks/lpc.json', 'utf8')),
    outfits: JSON.parse(readFileSync('src/data/outfits.json', 'utf8')),
  };
}

/** Execute a plan: load (and recolor) every source, then copy the rects in order. */
export function renderPlan(plan: Plan): Img {
  const sheet = newImg(plan.width, plan.height);
  const imgs: Img[] = plan.sources.map((s) => {
    if (!existsSync(s.path)) throw new Error(`missing sprite ${s.path}`);
    const src = readPng(s.path);
    if (!s.recolor) return src;
    const copy: Img = { width: src.width, height: src.height, data: new Uint8Array(src.data) };
    recolorPixels(copy.data, parseHex(s.recolor.from), parseHex(s.recolor.to));
    return copy;
  });
  for (const op of plan.ops) blit(sheet, imgs[op.s], op.sx, op.sy, op.w, op.h, op.dx, op.dy);
  return sheet;
}

/** mulberry32 seeded rng (tools only) */
export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- samples

function sampleSpecs(outfits: OutfitsData, seed: number): Array<{ name: string; spec: CharacterSpec }> {
  const rng = mulberry32(seed);
  const plan: Array<[string, Partial<CharacterSpec>]> = [
    ['serf_m_adult', { estate: 'serf', sex: 'male', stage: 'adult' }],
    ['serf_f_elder', { estate: 'serf', sex: 'female', stage: 'elder' }],
    ['freeman_m_teen', { estate: 'freeman', sex: 'male', stage: 'teen' }],
    ['freeman_f_adult_pregnant', { estate: 'freeman', sex: 'female', stage: 'adult', pregnant: 2 }],
    ['artisan_m_elder', { estate: 'artisan', sex: 'male', stage: 'elder' }],
    ['artisan_f_child', { estate: 'artisan', sex: 'female', stage: 'child' }],
    ['merchant_f_teen', { estate: 'merchant', sex: 'female', stage: 'teen' }],
    ['merchant_m_child', { estate: 'merchant', sex: 'male', stage: 'child' }],
    ['clergy_m_adult', { estate: 'clergy', sex: 'male', stage: 'adult' }],
    ['clergy_f_adult', { estate: 'clergy', sex: 'female', stage: 'adult' }],
    ['knight_m_adult_work', { estate: 'knight', sex: 'male', stage: 'adult', outfit: 'work' }],
    ['knight_f_teen', { estate: 'knight', sex: 'female', stage: 'teen', outfit: 'formal' }],
    ['noble_f_adult_formal', { estate: 'noble', sex: 'female', stage: 'adult', outfit: 'formal' }],
    ['noble_m_elder', { estate: 'noble', sex: 'male', stage: 'elder', outfit: 'winter' }],
    ['serf_m_child_sleep', { estate: 'serf', sex: 'male', stage: 'child', outfit: 'sleep' }],
    ['noble_m_adult_formal', { estate: 'noble', sex: 'male', stage: 'adult', outfit: 'formal' }],
  ];
  return plan.map(([name, p]) => {
    const spec = randomSpecWith(outfits, rng, { sex: p.sex, stage: p.stage, estate: p.estate });
    return { name, spec: { ...spec, ...p } as CharacterSpec };
  });
}

/** Contact sheet: per character one cell with idle-down, walk-down f1, sit chair, eat f2, carry f2, sleep; 2x nearest. */
export function contactSheet(pack: LpcPack, sheets: Array<{ name: string; img: Img }>): Img {
  const F = pack.frameW;
  const picks: Array<[keyof LpcPack['anims'], number]> = [['idle', 0], ['walk', 1], ['sit', 2], ['eat', 2], ['carry', 2], ['work', 2], ['sleep', 0]];
  const cellW = picks.length * F + 8;
  const cellH = F + 8;
  const cols = 2;
  const rows = Math.ceil(sheets.length / cols);
  const out = newImg(cols * cellW, rows * cellH);
  fill(out, 118, 128, 110);
  sheets.forEach(({ img }, i) => {
    const cx = (i % cols) * cellW + 4;
    const cy = Math.floor(i / cols) * cellH + 4;
    picks.forEach(([anim, f], k) => {
      const a = pack.anims[anim];
      const dirRow = a.dirs.indexOf('down');
      const x = cx + k * F;
      // alternate background tiles + feet anchor marker
      for (let y = 0; y < F; y++)
        for (let xx = 0; xx < F; xx++) {
          const di = ((cy + y) * out.width + x + xx) * 4;
          const shade = k % 2 ? 132 : 142;
          out.data[di] = shade; out.data[di + 1] = shade + 6; out.data[di + 2] = shade - 8; out.data[di + 3] = 255;
          if (y === pack.anchorY && (xx === pack.anchorX - 3 || xx === pack.anchorX + 2)) { out.data[di] = 200; out.data[di + 1] = 40; out.data[di + 2] = 40; }
        }
      blit(out, img, f * F, (a.row + dirRow) * F, F, F, x, cy);
    });
  });
  return scaleNearest(out, 2);
}

function main() {
  const args = process.argv.slice(2);
  const { pack, outfits } = loadData();
  const outDir = 'artifacts/lpc-samples';
  mkdirSync(outDir, { recursive: true });
  let samples: Array<{ name: string; spec: CharacterSpec }>;
  const seedArg = args.indexOf('--seed');
  if (seedArg >= 0) {
    const rng = mulberry32(Number(args[seedArg + 1]));
    const n = Number(args[args.indexOf('--n') + 1] || 12);
    samples = Array.from({ length: n }, (_, i) => ({ name: `random_${i}`, spec: randomSpecWith(outfits, rng) }));
  } else {
    samples = sampleSpecs(outfits, 20260926);
  }
  const sheets: Array<{ name: string; img: Img }> = [];
  const report: string[] = [];
  for (const { name, spec } of samples) {
    const plan = planCharacter(spec, pack, outfits);
    const img = renderPlan(plan);
    writePng(`${outDir}/${name}.png`, img);
    sheets.push({ name, img });
    report.push(`## ${name} (${plan.bodyType})`, `spec: ${JSON.stringify(spec)}`,
      `layers: ${plan.layers.map((l) => `${l.slot}=${l.id}:${l.colors.join('+')}`).join(', ')}`,
      `ops: ${plan.ops.length}, sources: ${plan.sources.length}, credits: ${plan.credits.length}`,
      ...plan.fallbacks.map((f) => `- ${f}`), '');
  }
  writePng(`${outDir}/contact-sheet.png`, contactSheet(pack, sheets));
  writeFileSync(`${outDir}/samples.md`, `# LPC samples\n\nContact sheet columns: idle, walk f1, sit (chair), eat f2, carry f2, work f2, sleep — all facing down. Red ticks = feet anchor row.\nOrder: row-major, 2 per row.\n\n${report.join('\n')}`);
  console.log(`wrote ${samples.length} sheets + contact sheet to ${outDir}`);
}

if (process.argv[1] && /compose-node/.test(process.argv[1])) main();
