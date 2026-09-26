/**
 * 문장 합성 Node 판 (src/render/heraldry.ts 의 순수 함수 + pngjs).
 * 사용: npx tsx tools/heraldry-node.ts [--seed 7] [--n 24] [--scale 3]
 *   → artifacts/heraldry/sample-grid.png (시드 고정 무작위 문장, 문장학 규칙 경고가 있으면 빨간 점)
 */
import { composeCoatOfArmsPixels, tinctureWarnings, HERALDRY, type CoatOfArmsSpec } from '../src/render/heraldry';
import { newImg, fill, writePng, type Img } from './lpc/png';
import { mulberry32 } from './lpc/compose-node';

export function coatImg(spec: CoatOfArmsSpec, scale: number): Img {
  const p = composeCoatOfArmsPixels(spec, scale);
  return { width: p.width, height: p.height, data: new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.length) };
}

/** 시드 고정 무작위 문장 (문양은 거의 항상, 분할은 가끔 없음) */
export function randomCoat(rng: () => number): CoatOfArmsSpec {
  const pick = <T,>(l: T[]) => l[Math.floor(rng() * l.length) % l.length];
  const t = HERALDRY.tinctures.map((x) => x.id);
  const a = pick(t);
  let b = pick(t);
  while (b === a) b = pick(t);
  return {
    shield: pick(HERALDRY.shields.map((s) => s.id)),
    division: rng() < 0.25 ? 'plain' : pick(HERALDRY.divisions.map((d) => d.id)),
    tinctures: [a, b],
    charge: rng() < 0.92 ? pick(HERALDRY.charges.map((c) => c.id)) : null,
    chargeTincture: pick(t),
  };
}

function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: number) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
  const seed = arg('--seed', 20260926);
  const n = arg('--n', 24);
  const scale = arg('--scale', 3);
  const rng = mulberry32(seed);
  const S = HERALDRY.shieldSize * scale;
  const cols = 8;
  const pad = 4 * scale;
  const out = newImg(cols * (S + pad) + pad, Math.ceil(n / cols) * (S + pad) + pad);
  fill(out, 214, 196, 160);
  for (let i = 0; i < n; i++) {
    const spec = randomCoat(rng);
    const img = coatImg(spec, scale);
    const ox = pad + (i % cols) * (S + pad);
    const oy = pad + Math.floor(i / cols) * (S + pad);
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const si = (y * img.width + x) * 4;
        if (!img.data[si + 3]) continue;
        const di = ((oy + y) * out.width + ox + x) * 4;
        out.data.set(img.data.subarray(si, si + 4), di);
      }
    if (tinctureWarnings(spec).length) for (let y = 0; y < scale * 2; y++) for (let x = 0; x < scale * 2; x++) out.data.set([200, 30, 30, 255], ((oy + y) * out.width + ox + S - scale * 2 + x) * 4);
  }
  writePng('artifacts/heraldry/sample-grid.png', out);
  console.log(`artifacts/heraldry/sample-grid.png: ${n} coats (seed ${seed}, x${scale})`);
}

if (process.argv[1] && /heraldry-node/.test(process.argv[1])) main();
