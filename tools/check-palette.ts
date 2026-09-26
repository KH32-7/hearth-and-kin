/**
 * 팔레트/화풍 검사 (BRIEF M0, GDD 28-1, 28-5).
 *
 * 1) 화풍 비교: 색 보정(src/data/grading.json) 후 LPC 인물 픽셀과 Epic RPG World 배경 픽셀
 *    - HSV 채도 평균 차 ≤ 0.08, 명도 평균 차 ≤ 0.10
 *    - 인물 픽셀 색의 Epic 팔레트 최근접 ΔE2000 상위 5%(p95) ≤ 12
 *    배경 = epic.json 이 참조하는 타일/스프라이트 사각형의 불투명 픽셀 (오두막 부지가 쓰는 것 가중)
 *    인물 = 시드 고정 무작위 인물 10명 + 가구원, 평상복, idle/walk/sit/eat/carry/work 프레임
 * 2) 직접 만든 그림(assets/generated/**): 세계 물건은 Epic 팔레트, 사람(assets/generated/lpc)은 LPC 팔레트 기준
 *    불투명 픽셀 색의 최근접 ΔE2000 p95 ≤ 12 (AI 유래 포함)
 *
 * 사용: npx tsx tools/check-palette.ts [--out artifacts/palette/report.json] [--tune]
 *   --tune: grading 수치를 격자 탐색해 통과하는 가장 약한 보정을 출력 (파일은 바꾸지 않음)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import fg from 'fast-glob';
import { planCharacter, randomSpecWith } from '../src/render/lpc/plan';
import type { CharacterSpec, LpcPack, OutfitsData } from '../src/render/lpc/types';
import { applyGrade, PaletteIndex, rgbToHsv, type Grade } from '../src/render/color';
import { readPng, type Img } from './lpc/png';
import { renderPlan, mulberry32 } from './lpc/compose-node';

const args = process.argv.slice(2);
const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'artifacts/palette/report.json';
const tune = args.includes('--tune');

const LIMITS = { satDiff: 0.08, valDiff: 0.1, deltaEP95: 12 };

interface WorldPackLite {
  images: Record<string, string>;
  tiles: Record<string, { image: string; x: number; y: number; w?: number; h?: number }>;
  sprites: Record<string, { image: string; x: number; y: number; w: number; h: number }>;
  objects: Record<string, { default: string; states?: Record<string, string> }>;
  walls: Record<string, Record<string, string | undefined>>;
  tilePx: number;
}

const pack: WorldPackLite = JSON.parse(readFileSync('src/data/artpacks/epic.json', 'utf8'));
const lpc: LpcPack = JSON.parse(readFileSync('src/data/artpacks/lpc.json', 'utf8'));
const outfits: OutfitsData = JSON.parse(readFileSync('src/data/outfits.json', 'utf8'));
const grading: { character: Grade } = JSON.parse(readFileSync('src/data/grading.json', 'utf8'));
const lot = JSON.parse(readFileSync('src/data/lots/cottage.json', 'utf8')) as {
  w: number; h: number; ground: (string | null)[]; floor: (string | null)[]; walls: (string | null)[]; objects: { id: string }[];
};

const imgCache = new Map<string, Img>();
function image(id: string): Img {
  let im = imgCache.get(id);
  if (!im) {
    im = readPng(pack.images[id]);
    imgCache.set(id, im);
  }
  return im;
}

// ---------------------------------------------------------------- 배경 픽셀 (부지가 실제로 쓰는 만큼 가중)

interface Stats {
  n: number;
  sat: number;
  val: number;
  colors: Map<number, number>;
}
function newStats(): Stats {
  return { n: 0, sat: 0, val: 0, colors: new Map() };
}
function addRect(st: Stats, im: Img, x: number, y: number, w: number, h: number, weight = 1): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * im.width + xx) * 4;
      if (im.data[i + 3] < 128) continue;
      const r = im.data[i];
      const g = im.data[i + 1];
      const b = im.data[i + 2];
      const [, s, v] = rgbToHsv(r, g, b);
      st.n += weight;
      st.sat += s * weight;
      st.val += v * weight;
      const key = (r << 16) | (g << 8) | b;
      st.colors.set(key, (st.colors.get(key) ?? 0) + weight);
    }
  }
}

const bg = newStats();
const T = pack.tilePx;
for (const layer of [lot.ground, lot.floor]) {
  for (const id of layer) {
    if (!id) continue;
    const t = pack.tiles[id];
    if (t) addRect(bg, image(t.image), t.x, t.y, t.w ?? T, t.h ?? T);
  }
}
const spriteUse = new Map<string, number>();
for (const w of lot.walls) {
  if (!w) continue;
  const ws = pack.walls[w];
  if (ws?.face) spriteUse.set(ws.face, (spriteUse.get(ws.face) ?? 0) + 1);
}
for (const o of lot.objects) {
  const e = pack.objects[o.id];
  if (e) spriteUse.set(e.default, (spriteUse.get(e.default) ?? 0) + 1);
}
for (const [id, n] of spriteUse) {
  const s = pack.sprites[id];
  if (s) addRect(bg, image(s.image), s.x, s.y, s.w, s.h, n);
}
// 세계 팔레트 = 팩이 참조하는 모든 사각형의 색 (가중 없음)
const worldColors = new Set<number>();
{
  const all = newStats();
  for (const t of Object.values(pack.tiles)) addRect(all, image(t.image), t.x, t.y, t.w ?? T, t.h ?? T);
  for (const s of Object.values(pack.sprites)) addRect(all, image(s.image), s.x, s.y, s.w, s.h);
  for (const k of all.colors.keys()) worldColors.add(k);
}
const worldPalette = new PaletteIndex([...worldColors]);
const worldOutline: [number, number, number] = (() => {
  let best = 0;
  let bn = -1;
  for (const [c, n] of bg.colors) {
    const [, , v] = rgbToHsv((c >> 16) & 255, (c >> 8) & 255, c & 255);
    if (v <= 0.3 && n > bn) {
      bn = n;
      best = c;
    }
  }
  return [(best >> 16) & 255, (best >> 8) & 255, best & 255];
})();

// ---------------------------------------------------------------- 인물

const specs: CharacterSpec[] = [];
{
  const rng = mulberry32(20260926);
  const estates = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'] as const;
  for (let i = 0; i < 10; i++) specs.push(randomSpecWith(outfits, rng, { estate: estates[i % estates.length] }));
}
const sheets = specs.map((s) => renderPlan(planCharacter(s, lpc, outfits)));
const FRAMES: Array<[string, number]> = [['idle', 0], ['walk', 1], ['walk', 5], ['sit', 2], ['eat', 1], ['carry', 2], ['work', 2]];

function charStats(g: Grade | null): { st: Stats; dE: number[] } {
  const st = newStats();
  const dE: number[] = [];
  for (const sheet of sheets) {
    const copy: Img = { width: sheet.width, height: sheet.height, data: new Uint8Array(sheet.data) };
    if (g) applyGrade(copy.data, g, g.paletteSnap > 0 ? worldPalette : undefined);
    for (const [anim, f] of FRAMES) {
      const a = lpc.anims[anim as keyof LpcPack['anims']];
      for (let d = 0; d < a.dirs.length; d++) {
        addRect(st, copy, f * lpc.frameW, (a.row + d) * lpc.frameH, lpc.frameW, lpc.frameH);
      }
    }
  }
  for (const [c, n] of st.colors) {
    const d = worldPalette.nearest(c).d;
    for (let k = 0; k < n; k++) dE.push(d);
  }
  dE.sort((a, b) => a - b);
  return { st, dE };
}

function evaluate(g: Grade | null) {
  const { st, dE } = charStats(g);
  const sat = st.sat / st.n;
  const val = st.val / st.n;
  const bs = bg.sat / bg.n;
  const bv = bg.val / bg.n;
  const p95 = dE[Math.floor(dE.length * 0.95)] ?? 0;
  return {
    character: { satMean: +sat.toFixed(4), valMean: +val.toFixed(4), pixels: st.n, colors: st.colors.size },
    background: { satMean: +bs.toFixed(4), valMean: +bv.toFixed(4), pixels: bg.n, colors: bg.colors.size, paletteColors: worldPalette.size },
    satDiff: +Math.abs(sat - bs).toFixed(4),
    valDiff: +Math.abs(val - bv).toFixed(4),
    deltaEP95: +p95.toFixed(3),
    deltaEP50: +(dE[Math.floor(dE.length * 0.5)] ?? 0).toFixed(3),
    pass: Math.abs(sat - bs) <= LIMITS.satDiff && Math.abs(val - bv) <= LIMITS.valDiff && p95 <= LIMITS.deltaEP95,
  };
}

// ---------------------------------------------------------------- 직접 만든 그림

function lpcPaletteColors(): Set<number> {
  const set = new Set<number>();
  for (const m of Object.values(lpc.palettes)) {
    for (const ramp of [m.source, ...Object.values(m.colors)]) {
      for (const hex of ramp) set.add(parseInt(hex.replace('#', ''), 16));
    }
  }
  // 생성기 원본 시트의 색도 포함 (미리 칠해진 레이어)
  for (const s of sheets) for (let i = 0; i < s.data.length; i += 4) if (s.data[i + 3] >= 128) set.add((s.data[i] << 16) | (s.data[i + 1] << 8) | s.data[i + 2]);
  return set;
}

function checkGenerated() {
  const lpcPal = new PaletteIndex([...lpcPaletteColors()]);
  const files = fg.sync('assets/generated/**/*.png').filter((f) => !f.includes('/ui/') && !f.includes('preview'));
  const results: { file: string; palette: string; p95: number; pass: boolean }[] = [];
  for (const f of files) {
    const im = readPng(f);
    const isPerson = f.startsWith('assets/generated/lpc/');
    const pal = isPerson ? lpcPal : worldPalette;
    const ds: number[] = [];
    const seen = new Map<number, number>();
    for (let i = 0; i < im.data.length; i += 4) {
      if (im.data[i + 3] < 128) continue;
      const c = (im.data[i] << 16) | (im.data[i + 1] << 8) | im.data[i + 2];
      let d = seen.get(c);
      if (d === undefined) {
        d = pal.nearest(c).d;
        seen.set(c, d);
      }
      ds.push(d);
    }
    ds.sort((a, b) => a - b);
    const p95 = ds[Math.floor(ds.length * 0.95)] ?? 0;
    results.push({ file: f, palette: isPerson ? 'lpc' : 'epic', p95: +p95.toFixed(2), pass: p95 <= LIMITS.deltaEP95 });
  }
  return results;
}

// ---------------------------------------------------------------- 실행

const raw = evaluate(null);
const graded = evaluate(grading.character);
const generated = checkGenerated();
const report = {
  limits: LIMITS,
  grading: grading.character,
  raw,
  graded,
  generated,
  pass: graded.pass && generated.every((g) => g.pass),
};

if (tune) {
  // 통과하는 보정 중 원본에서 가장 덜 바뀐 것 (비용 = 수치 변화량 합)
  const cands: { g: Grade; r: ReturnType<typeof evaluate>; cost: number }[] = [];
  for (const outlineV of [0, 0.18, 0.25, 0.32]) {
    for (const saturation of [0.9, 1.0]) {
      for (const value of [1.0, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4]) {
        for (const paletteSnap of [0, 0.35]) {
          const g: Grade = { ...grading.character, saturation, value, contrast: 1, paletteSnap, outline: outlineV ? { maxV: outlineV, rgb: worldOutline } : undefined };
          const r = evaluate(g);
          const cost = Math.abs(1 - saturation) + Math.abs(1 - value) * 2 + paletteSnap * 0.5 + outlineV * 0.5;
          if (r.pass) cands.push({ g, r, cost });
        }
      }
    }
  }
  console.log('world outline', worldOutline);
  cands.sort((a, b) => a.cost - b.cost);
  console.log(JSON.stringify(cands.slice(0, 6).map((c) => ({ s: c.g.saturation, v: c.g.value, outline: c.g.outline?.maxV ?? 0, snap: c.g.paletteSnap, satDiff: c.r.satDiff, valDiff: c.r.valDiff, p95: c.r.deltaEP95 }))));
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ raw: { satDiff: raw.satDiff, valDiff: raw.valDiff, p95: raw.deltaEP95 }, graded: { satDiff: graded.satDiff, valDiff: graded.valDiff, p95: graded.deltaEP95, pass: graded.pass }, generated: `${generated.filter((g) => g.pass).length}/${generated.length}`, pass: report.pass }, null, 2));
if (existsSync(outPath)) console.log(`report: ${outPath}`);
process.exit(report.pass ? 0 : 1);
