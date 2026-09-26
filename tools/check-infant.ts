/**
 * 아기/유아 스프라이트 검사 (BRIEF M7 "동작별 프레임 수/방향 수/팔레트 검사 + 확대 캡처 체크리스트 자동 생성").
 *
 * 동작마다
 *  - 프레임 수/방향 수가 요구(아래 NEED)를 채우는지, lpc.json infant 와 시트 크기가 맞는지
 *  - 빈 프레임(불투명 픽셀 0)이 없는지, 멈춘 동작(모든 프레임이 같음)이 아닌지
 *  - 기준점: 서 있는/기는/앉는 유아와 요람/바닥 아기는 가장 아래 칠한 줄이 anchorY-1 ± 2
 *            품 안 아기는 안는 자세 팔 띠(34~46줄)와 겹침, 잠은 머리만(sleepCropY 위)
 *  - 팔레트: 여러 외형(피부/머리/옷 색, 옷 3종, 머리 모양 전부)으로 합성한 불투명 픽셀의 LPC 팔레트 최근접 ΔE2000 p95 ≤ 12
 * 결과: artifacts/infant/checklist.md, baby.png / toddler.png (4배), toddler-looks.png, scale-compare.png
 * 사용: npx tsx tools/check-infant.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { planCharacter, randomSpecWith } from '../src/render/lpc/plan';
import { planInfant, infantFrameRect, type InfantLook, type InfantKind } from '../src/render/lpc/infant';
import type { AnimName, CharacterSpec, LpcPack, OutfitsData } from '../src/render/lpc/types';
import { PaletteIndex } from '../src/render/color';
import { blit, newImg, scaleNearest, writePng, fill, readPng, type Img } from './lpc/png';
import { mulberry32, renderPlan } from './lpc/compose-node';

const lpc: LpcPack = JSON.parse(readFileSync('src/data/artpacks/lpc.json', 'utf8'));
const outfits: OutfitsData = JSON.parse(readFileSync('src/data/outfits.json', 'utf8'));
const inf = lpc.infant;
if (!inf) {
  console.error('lpc.json 에 infant 가 없음: npx tsx tools/lpc/gen-infant.ts && npx tsx tools/lpc/build-pack.ts');
  process.exit(1);
}
const F = inf.frameW;
const OUT = 'artifacts/infant';
mkdirSync(OUT, { recursive: true });

/** 요구 (docs/04 4절, 작업 지시): 최소 프레임, 방향 수 */
const NEED: Record<InfantKind, Record<string, { minFrames: number; maxFrames?: number; dirs: number; moving: boolean; foot: 'ground' | 'held' | 'head' }>> = {
  baby: {
    cradle: { minFrames: 2, dirs: 1, moving: true, foot: 'ground' },
    cradle_cry: { minFrames: 2, dirs: 1, moving: true, foot: 'ground' },
    floor: { minFrames: 2, dirs: 1, moving: true, foot: 'ground' },
    floor_cry: { minFrames: 2, dirs: 1, moving: true, foot: 'ground' },
    held: { minFrames: 2, dirs: 4, moving: true, foot: 'held' },
    held_cry: { minFrames: 2, dirs: 4, moving: true, foot: 'held' },
  },
  toddler: {
    idle: { minFrames: 1, dirs: 4, moving: true, foot: 'ground' },
    walk: { minFrames: 6, dirs: 4, moving: true, foot: 'ground' },
    crawl: { minFrames: 6, dirs: 4, moving: true, foot: 'ground' },
    sit: { minFrames: 1, maxFrames: 2, dirs: 4, moving: false, foot: 'ground' },
    fall: { minFrames: 3, dirs: 4, moving: true, foot: 'ground' },
    sleep: { minFrames: 1, dirs: 1, moving: false, foot: 'head' },
  },
};

// LPC 팔레트 (check-supplement 와 같은 기준: 모든 램프 색)
const palColors = new Set<number>();
for (const m of Object.values(lpc.palettes)) for (const ramp of [m.source, ...Object.values(m.colors)]) for (const hex of ramp) palColors.add(parseInt(hex.replace('#', ''), 16));
const palette = new PaletteIndex([...palColors]);

// 외형 여러 개 (시드 고정)
const rng = mulberry32(20260926);
const pickR = <T,>(l: T[]) => l[Math.floor(rng() * l.length) % l.length];
const hairIds = Object.keys(inf.toddler.hair).map((h) => h.replace(/^hair_/, ''));
const garments = Object.keys(inf.toddler.garments);
function look(i: number): InfantLook {
  const est = (['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'] as const)[i % 7];
  return {
    skin: pickR(outfits.skins),
    eyes: pickR(outfits.eyes),
    hairStyle: hairIds[i % hairIds.length],
    hairColor: pickR(outfits.hair.colors),
    main: pickR(outfits.dyes[est].main),
    accent: pickR(outfits.dyes[est].accent),
    garment: garments[i % garments.length],
  };
}
const REF: InfantLook = { skin: 'light', eyes: 'blue', hairStyle: 'parted_side_bangs', hairColor: 'chestnut', main: 'white', accent: 'red', garment: 'smock', swaddle: 'tan' };

interface Row { kind: string; anim: string; frames: number; dirs: number; empty: number; frozen: boolean; foot: string; footOk: boolean; p95: number; pass: boolean; note: string }
const rows: Row[] = [];

function cellStats(img: Img, x: number, y: number) {
  let opaque = 0, top = F, bottom = -1;
  const sig: number[] = [];
  const ds: number[] = [];
  for (let yy = 0; yy < F; yy++) for (let xx = 0; xx < F; xx++) {
    const i = ((y + yy) * img.width + x + xx) * 4;
    if (img.data[i + 3] < 128) continue;
    opaque++;
    top = Math.min(top, yy);
    bottom = Math.max(bottom, yy);
    sig.push(yy * F + xx, img.data[i], img.data[i + 1], img.data[i + 2]);
    ds.push(palette.nearest((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]).d);
  }
  return { opaque, top, bottom, key: sig.join(','), ds };
}

function checkKind(kind: InfantKind): Img {
  const looks = [REF, ...Array.from({ length: kind === 'toddler' ? 9 : 5 }, (_, i) => look(i))];
  const sheets = looks.map((l) => renderPlan(planInfant(kind, l, lpc)));
  const ref = sheets[0];
  const part = kind === 'baby' ? inf!.baby : inf!.toddler;
  const sizeOk = ref.width === part.cols * F && ref.height === part.rows * F;
  for (const [anim, need] of Object.entries(NEED[kind])) {
    const a = (part.anims as Record<string, { row: number; col: number; frames: number; dirs: string[] }>)[anim];
    if (!a) {
      rows.push({ kind, anim, frames: 0, dirs: 0, empty: 0, frozen: false, foot: '-', footOk: false, p95: 0, pass: false, note: 'lpc.json 에 없음' });
      continue;
    }
    let empty = 0, frozen = false, footOk = true;
    const ds: number[] = [];
    const notes: string[] = [];
    a.dirs.forEach((d) => {
      const keys = new Set<string>();
      for (let f = 0; f < a.frames; f++) {
        const r = infantFrameRect({ anims: part.anims as never, frameW: F, frameH: F }, anim, d, f)!;
        const st = cellStats(ref, r.x, r.y);
        if (st.opaque === 0) empty++;
        keys.add(st.key);
        if (need.foot === 'ground' && Math.abs(st.bottom - (inf!.anchorY - 1)) > 2) { footOk = false; notes.push(`${d}#${f} 바닥 ${st.bottom}`); }
        if (need.foot === 'held' && (st.bottom < 34 || st.top > 46)) { footOk = false; notes.push(`${d}#${f} 팔 띠 밖 ${st.top}~${st.bottom}`); }
        if (need.foot === 'head' && st.bottom >= inf!.toddler.sleepCropY) { footOk = false; notes.push(`${d}#${f} 머리 아래 ${st.bottom}`); }
        // 팔레트: 모든 외형
        for (const s of sheets) ds.push(...cellStats(s, r.x, r.y).ds);
      }
      if (need.moving && a.frames > 1 && keys.size === 1) frozen = true;
    });
    ds.sort((x, y) => x - y);
    const p95 = ds[Math.floor(ds.length * 0.95)] ?? 0;
    const framesOk = a.frames >= need.minFrames && (need.maxFrames === undefined || a.frames <= need.maxFrames);
    const pass = sizeOk && framesOk && a.dirs.length === need.dirs && empty === 0 && !frozen && footOk && p95 <= 12;
    rows.push({ kind, anim, frames: a.frames, dirs: a.dirs.length, empty, frozen, foot: need.foot, footOk, p95: +p95.toFixed(2), pass, note: [!sizeOk ? '시트 크기 다름' : '', !framesOk ? `프레임 ${need.minFrames}+ 필요` : '', ...notes.slice(0, 3)].filter(Boolean).join('; ') });
  }
  return ref;
}

function onBg(img: Img, shade = [150, 160, 150]): Img {
  const out = newImg(img.width, img.height);
  fill(out, shade[0], shade[1], shade[2]);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    if (x % F === 0 || y % F === 0 || y % F === inf!.anchorY) {
      const i = (y * out.width + x) * 4;
      out.data[i] = 128; out.data[i + 1] = 138; out.data[i + 2] = 130;
    }
  }
  blit(out, img, 0, 0, img.width, img.height, 0, 0);
  return out;
}

const babySheet = checkKind('baby');
const toddlerSheet = checkKind('toddler');
writePng(`${OUT}/baby.png`, scaleNearest(onBg(babySheet), 4));
writePng(`${OUT}/toddler.png`, scaleNearest(onBg(toddlerSheet), 4));

// 외형 모음: 옷 3종 × 머리 모양 전부, idle 아래 / walk 옆 / crawl 옆 / sit 아래
{
  const combos: InfantLook[] = [];
  for (const g of garments) for (const h of hairIds) combos.push({ ...look(combos.length), garment: g, hairStyle: h });
  const picks: Array<[string, string, number]> = [['idle', 'down', 0], ['walk', 'left', 2], ['crawl', 'right', 1], ['sit', 'down', 1]];
  const cw = 40, ch = 44;
  const out = newImg(combos.length * cw, picks.length * ch);
  fill(out, 150, 160, 150);
  combos.forEach((l, ci) => {
    const plan = planInfant('toddler', l, lpc);
    const sheet = renderPlan(plan);
    picks.forEach(([anim, dir, f], pi) => {
      const r = infantFrameRect(plan, anim, dir, f)!;
      blit(out, sheet, r.x + 12, r.y + 20, cw, ch, ci * cw, pi * ch);
    });
  });
  writePng(`${OUT}/toddler-looks.png`, scaleNearest(out, 4));
}

// 같은 배율 비교: 어른(남) / 어른(여)+품 안 아기 / 청소년 / 아동 / 유아 / 요람 아기 / 바닥 아기  (아래 보기)
// 둘째 줄: 품 안 아기 4방향 (여, 남)
{
  const specOf = (p: Partial<CharacterSpec>) => ({ ...randomSpecWith(outfits, mulberry32(7), { sex: p.sex, stage: p.stage, estate: 'freeman' }), skin: 'light', ...p }) as CharacterSpec;
  const sheetOf = (p: Partial<CharacterSpec>) => {
    const plan = planCharacter(specOf(p), lpc, outfits);
    return { plan, img: renderPlan(plan) };
  };
  const male = sheetOf({ sex: 'male', stage: 'adult' });
  const female = sheetOf({ sex: 'female', stage: 'adult' });
  const teen = sheetOf({ sex: 'male', stage: 'teen' });
  const child = sheetOf({ sex: 'female', stage: 'child' });
  const baby = renderPlan(planInfant('baby', REF, lpc));
  const out = newImg(8 * F, 3 * F);
  fill(out, 150, 160, 150);
  for (let x = 0; x < out.width; x++) for (const yy of [inf.anchorY, F + inf.anchorY, 2 * F + inf.anchorY]) { const i = (yy * out.width + x) * 4; out.data[i] = 120; out.data[i + 1] = 128; out.data[i + 2] = 124; }
  const cell = (src: Img, anim: AnimName, info: { anims: Record<string, { row: number; dirs: string[] }> }, dir: string, f: number, col: number, row: number) => {
    const a = info.anims[anim];
    blit(out, src, f * F, (a.row + Math.max(0, a.dirs.indexOf(dir))) * F, F, F, col * F, row * F);
  };
  const held = (holder: { plan: ReturnType<typeof planCharacter>; img: Img }, dir: string, col: number, row: number, cry = false) => {
    const front = inf.baby.place.held.front[dir as 'down'];
    const bt = holder.plan.bodyType;
    const src = lpc.anims.carry.src[0].frames[0];
    const bob = lpc.bodyTypes[bt]!.walkBob[dir as 'down'][src] ?? 0;
    const r = infantFrameRect({ anims: inf.baby.anims as never, frameW: F, frameH: F }, cry ? 'held_cry' : 'held', dir, 0)!;
    const dy = (inf.baby.place.held.dy[bt] ?? 0) + bob;
    if (!front) blit(out, baby, r.x, r.y, F, F, col * F, row * F + dy);
    cell(holder.img, 'carry', holder.plan, dir, 0, col, row);
    if (front) blit(out, baby, r.x, r.y, F, F, col * F, row * F + dy);
  };
  cell(male.img, 'idle', male.plan, 'down', 0, 0, 0);
  held(female, 'down', 1, 0);
  cell(teen.img, 'idle', teen.plan, 'down', 0, 2, 0);
  cell(child.img, 'idle', child.plan, 'down', 0, 3, 0);
  const tod = renderPlan(planInfant('toddler', REF, lpc));
  const tr = infantFrameRect({ anims: inf.toddler.anims as never, frameW: F, frameH: F }, 'idle', 'down', 0)!;
  blit(out, tod, tr.x, tr.y, F, F, 4 * F, 0);
  const cr = infantFrameRect({ anims: inf.toddler.anims as never, frameW: F, frameH: F }, 'crawl', 'left', 0)!;
  blit(out, tod, cr.x, cr.y, F, F, 5 * F, 0);
  const br = infantFrameRect({ anims: inf.baby.anims as never, frameW: F, frameH: F }, 'cradle', 'down', 0)!;
  blit(out, baby, br.x, br.y, F, F, 6 * F, 0);
  const fr = infantFrameRect({ anims: inf.baby.anims as never, frameW: F, frameH: F }, 'floor', 'down', 0)!;
  blit(out, baby, fr.x, fr.y, F, F, 7 * F, 0);
  (['up', 'left', 'down', 'right'] as const).forEach((d, i) => { held(female, d, i, 1); held(male, d, 4 + i, 1); });
  (['up', 'left', 'down', 'right'] as const).forEach((d, i) => { held(teen, d, i, 2, true); });
  const ttr = infantFrameRect({ anims: inf.toddler.anims as never, frameW: F, frameH: F }, 'walk', 'right', 2)!;
  blit(out, tod, ttr.x, ttr.y, F, F, 4 * F, 2 * F);
  const tsr = infantFrameRect({ anims: inf.toddler.anims as never, frameW: F, frameH: F }, 'sit', 'down', 1)!;
  blit(out, tod, tsr.x, tsr.y, F, F, 5 * F, 2 * F);
  const tfr = infantFrameRect({ anims: inf.toddler.anims as never, frameW: F, frameH: F }, 'fall', 'down', 2)!;
  blit(out, tod, tfr.x, tfr.y, F, F, 6 * F, 2 * F);
  cell(child.img, 'walk', child.plan, 'right', 2, 7, 2);
  writePng(`${OUT}/scale-compare.png`, scaleNearest(out, 4));
  // 게임 배율 그대로 (1배, 2배): 작은 크기에서도 사람 아기로 읽히는지 보는 용도
  writePng(`${OUT}/scale-compare-1x.png`, out);
  writePng(`${OUT}/scale-compare-2x.png`, scaleNearest(out, 2));
}

// 키 비교 (불투명 픽셀 세로 길이, 아래 보기 idle)
function heightOf(img: Img, x: number, y: number): number {
  let top = F, bottom = -1;
  for (let yy = 0; yy < F; yy++) for (let xx = 0; xx < F; xx++) if (img.data[((y + yy) * img.width + x + xx) * 4 + 3] >= 128) { top = Math.min(top, yy); bottom = Math.max(bottom, yy); }
  return bottom - top + 1;
}
const cmp = readPng(`${OUT}/scale-compare.png`);
void cmp;
const tr0 = infantFrameRect({ anims: inf.toddler.anims as never, frameW: F, frameH: F }, 'idle', 'down', 0)!;
const toddlerH = heightOf(toddlerSheet, tr0.x, tr0.y);

const md = [
  '# 아기/유아 스프라이트 검수 체크리스트 (자동 생성: tools/check-infant.ts)',
  '',
  '스크립트 판정(프레임 수, 방향 수, 빈 프레임, 멈춘 동작, 기준점, 팔레트 ΔE p95 ≤ 12 — 외형 여러 개 합성) + 사람 눈 확인 칸',
  '',
  '| 종류 | 동작 | 프레임 | 방향 | 빈 프레임 | 멈춤 | 기준점 | ΔE p95 | 자동 | 비고 | 눈 확인 (확대 캡처) |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.kind === 'baby' ? '아기' : '유아'} | ${r.anim} | ${r.frames} | ${r.dirs} | ${r.empty} | ${r.frozen ? '예' : '아니오'} | ${r.footOk ? 'OK' : '어긋남'} (${r.foot}) | ${r.p95} | ${r.pass ? '통과' : '실패'} | ${r.note} | [ ] |`),
  '',
  `유아 키(idle 아래, 머리카락 포함): ${toddlerH}px · 아동 약 40px · 어른 약 52px`,
  '',
  '눈 확인 항목: 머리/몸 이음매 어긋남 없음 · 팔이 몸을 뚫지 않음 · 프레임 사이 떨림 없음 · 품 안 아기가 어른 팔 위에 얹힘(위 보기는 어깨 너머) · 울음 프레임에 벌린 입과 눈물 · 옷 3종이 몸을 다 덮음',
  '',
  '확대 캡처 (4배): `artifacts/infant/baby.png` (0행 요람, 1행 바닥, 2~5행 품 안 위/왼/아래/오른; 0~1열 보통, 2~3열 울음)',
  '`artifacts/infant/toddler.png` (idle / walk / crawl / sit / fall 각 4방향 + 잠), `artifacts/infant/toddler-looks.png` (옷 3종 × 머리 모양)',
  '`artifacts/infant/scale-compare.png` (4배, 게임 배율 그대로는 `scale-compare-1x.png`/`-2x.png`; 같은 배율: 어른 남 / 어른 여+아기 / 청소년 / 아동 / 유아 / 기는 유아 / 요람 / 바닥; 2줄 품 안 4방향 여·남; 3줄 청소년+우는 아기, 유아 걷기/앉기/엉덩방아, 아동 걷기)',
];
writeFileSync(`${OUT}/checklist.md`, md.join('\n') + '\n');
const fails = rows.filter((r) => !r.pass);
console.log(`아기/유아 스프라이트 ${rows.length - fails.length}/${rows.length} 통과 (유아 키 ${toddlerH}px)`);
for (const r of rows) console.log(`${r.pass ? 'OK ' : 'NG '} ${r.kind}.${r.anim} frames=${r.frames} dirs=${r.dirs} empty=${r.empty} frozen=${r.frozen} foot=${r.footOk} p95=${r.p95} ${r.note}`);
process.exit(fails.length ? 1 : 0);
