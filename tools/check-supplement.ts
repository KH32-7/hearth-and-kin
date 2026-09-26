/**
 * 보완 스프라이트 검사 (BRIEF M1 "잠/먹기/들기 보완 스프라이트", 5장 "확대 캡처 + 체크리스트 자동 생성").
 * 체형 × 보완 동작(sleep, eat, carry, work)마다
 *  - 프레임 수/방향 수가 lpc.json 과 같은지, 빈 프레임(불투명 픽셀 0)이 없는지
 *  - 인접 프레임이 전부 같지는 않은지 (움직이는 동작: eat, carry, work)
 *  - 팔레트: 불투명 픽셀 색이 LPC 팔레트(생성기 원본 색 + 색 램프) 최근접 ΔE2000 p95 ≤ 12
 *  - 발 앵커: 서 있는 동작은 프레임 바닥줄(anchorY±2)에 발 픽셀이 있음 (sleep, eat 제외)
 * 결과: artifacts/supplement/<체형>.png (4배 확대, 동작×방향×프레임), artifacts/supplement/checklist.md
 * 사용: npx tsx tools/check-supplement.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { planCharacter, randomSpecWith } from '../src/render/lpc/plan';
import type { AnimName, BodyType, CharacterSpec, LpcPack, OutfitsData } from '../src/render/lpc/types';
import { PaletteIndex } from '../src/render/color';
import { blit, newImg, scaleNearest, writePng, fill } from './lpc/png';
import { mulberry32, renderPlan } from './lpc/compose-node';

const lpc: LpcPack = JSON.parse(readFileSync('src/data/artpacks/lpc.json', 'utf8'));
const outfits: OutfitsData = JSON.parse(readFileSync('src/data/outfits.json', 'utf8'));
const SUPP: AnimName[] = ['sleep', 'eat', 'carry', 'work'];
const MOVING = new Set<AnimName>(['eat', 'carry', 'work']);
const F = lpc.frameW;

const bodies: Array<{ body: BodyType; spec: Partial<CharacterSpec> }> = [
  { body: 'male', spec: { sex: 'male', stage: 'adult' } },
  { body: 'female', spec: { sex: 'female', stage: 'adult' } },
  { body: 'teen', spec: { sex: 'female', stage: 'teen' } },
  { body: 'child', spec: { sex: 'male', stage: 'child' } },
  { body: 'pregnant', spec: { sex: 'female', stage: 'adult', pregnant: 2 } },
  { body: 'male', spec: { sex: 'male', stage: 'elder' } },
];

// LPC 팔레트: 모든 램프 색
const palColors = new Set<number>();
for (const m of Object.values(lpc.palettes)) for (const ramp of [m.source, ...Object.values(m.colors)]) for (const hex of ramp) palColors.add(parseInt(hex.replace('#', ''), 16));

interface Row {
  body: string;
  anim: string;
  frames: number;
  dirs: number;
  emptyFrames: number;
  staticAnim: boolean;
  footOk: boolean;
  deltaEP95: number;
  pass: boolean;
}
const rows: Row[] = [];
mkdirSync('artifacts/supplement', { recursive: true });

const rng = mulberry32(99);
for (const { body, spec } of bodies) {
  const full = { ...randomSpecWith(outfits, rng, { sex: spec.sex, stage: spec.stage, estate: 'freeman' }), ...spec } as CharacterSpec;
  const plan = planCharacter(full, lpc, outfits);
  const sheet = renderPlan(plan);
  // 이 인물이 실제로 쓰는 색 + 램프 색으로 팔레트
  const pal = new Set(palColors);
  for (const a of ['idle', 'walk'] as AnimName[]) {
    const info = plan.anims[a];
    for (let d = 0; d < info.dirs.length; d++) for (let f = 0; f < info.frames; f++) {
      for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) {
        const i = (((info.row + d) * F + y) * sheet.width + f * F + x) * 4;
        if (sheet.data[i + 3] >= 128) pal.add((sheet.data[i] << 16) | (sheet.data[i + 1] << 8) | sheet.data[i + 2]);
      }
    }
  }
  const palette = new PaletteIndex([...pal]);
  const maxFrames = Math.max(...SUPP.map((a) => plan.anims[a].frames));
  const cellsW = maxFrames * F;
  const cellsH = SUPP.reduce((n, a) => n + plan.anims[a].dirs.length, 0) * F;
  const sheetOut = newImg(cellsW + 8, cellsH + 8);
  fill(sheetOut, 58, 50, 44, 255);
  let oy = 4;
  for (const anim of SUPP) {
    const info = plan.anims[anim];
    const def = lpc.anims[anim];
    let empty = 0;
    let allSame = true;
    let footOk = true;
    const ds: number[] = [];
    for (let d = 0; d < info.dirs.length; d++) {
      let prev: string | null = null;
      for (let f = 0; f < info.frames; f++) {
        const sx = f * F;
        const sy = (info.row + d) * F;
        let opaque = 0;
        let footRow = false;
        const sig: number[] = [];
        for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) {
          const i = ((sy + y) * sheet.width + sx + x) * 4;
          if (sheet.data[i + 3] < 128) continue;
          opaque++;
          sig.push(y * F + x, sheet.data[i], sheet.data[i + 1], sheet.data[i + 2]);
          if (Math.abs(y - lpc.anchorY) <= 2) footRow = true;
          const c = (sheet.data[i] << 16) | (sheet.data[i + 1] << 8) | sheet.data[i + 2];
          ds.push(palette.nearest(c).d);
        }
        if (opaque === 0) empty++;
        // 잠(머리만)과 먹기(앉은 자세)는 발이 바닥 줄에 없음
        if (anim !== 'sleep' && anim !== 'eat' && !footRow) footOk = false;
        const key = sig.join(',');
        if (prev !== null && key !== prev) allSame = false;
        prev = key;
        blit(sheetOut, sheet, sx, sy, F, F, 4 + f * F, oy);
      }
      oy += F;
    }
    ds.sort((a, b) => a - b);
    const p95 = ds[Math.floor(ds.length * 0.95)] ?? 0;
    const staticAnim = MOVING.has(anim) && info.frames > 1 && allSame;
    const ok = info.frames === def.frames && info.dirs.length === def.dirs.length && empty === 0 && !staticAnim && footOk && p95 <= 12;
    rows.push({ body: `${body}${spec.stage === 'elder' ? '(노년)' : ''}`, anim, frames: info.frames, dirs: info.dirs.length, emptyFrames: empty, staticAnim, footOk, deltaEP95: +p95.toFixed(2), pass: ok });
  }
  writePng(`artifacts/supplement/${body}${spec.stage === 'elder' ? '-elder' : ''}.png`, scaleNearest(sheetOut, 4));
}

const md = [
  '# 보완 스프라이트 검수 체크리스트 (자동 생성: tools/check-supplement.ts)',
  '',
  '스크립트 판정(프레임 수, 방향 수, 빈 프레임, 멈춘 동작, 발 앵커, 팔레트 ΔE p95 ≤ 12) + 사람 눈 확인 칸',
  '',
  '| 체형 | 동작 | 프레임 | 방향 | 빈 프레임 | 멈춤 | 발 앵커 | ΔE p95 | 자동 | 눈 확인 (확대 캡처) |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.body} | ${r.anim} | ${r.frames} | ${r.dirs} | ${r.emptyFrames} | ${r.staticAnim ? '예' : '아니오'} | ${r.footOk ? 'OK' : '없음'} | ${r.deltaEP95} | ${r.pass ? '통과' : '실패'} | [ ] |`),
  '',
  '눈 확인 항목: 머리/몸 이음매 어긋남 없음 · 팔이 몸을 뚫지 않음 · 들고 있는 물건 위치가 손과 맞음 · 잠 프레임은 머리+어깨만 · 옷 레이어가 빠지지 않음',
  '',
  '확대 캡처: `artifacts/supplement/<체형>.png` (4배, 위에서부터 sleep / eat 4방향 / carry 4방향 / work 4방향)',
];
writeFileSync('artifacts/supplement/checklist.md', md.join('\n'));
const fails = rows.filter((r) => !r.pass);
console.log(`보완 스프라이트 ${rows.length - fails.length}/${rows.length} 통과`);
for (const f of fails) console.log('실패', JSON.stringify(f));
process.exit(fails.length ? 1 : 0);
