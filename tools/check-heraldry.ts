/**
 * 문장 요소 검사 (GDD 16-1 "방패 6, 분할 12, 문양 40, 색 8", 30-1 heraldry.json).
 *  - 개수 6/12/40/8, id 겹침 없음, 한국어 이름 키가 src/i18n/ko/heraldry.json 에 있음
 *  - 마스크 크기 (방패/분할 32×32, 문양 16×16), 문양은 비어 있지 않음, 하이판타지 문양 없음
 *  - 모든 방패 × 모든 문양: 문양 픽셀 + 외곽선 1px 이 방패 안쪽(외곽선 제외)에 들어감 (안전 영역)
 *  - 분할(plain 제외)은 모든 방패에서 두 색이 다 보임
 *  - 색: 금속 2 + 색 6, 문장학 규칙 함수가 금속 위 금속을 경고함
 *  - 시트 그림이 heraldry.json 좌표와 맞음, 팔레트 (Epic RPG World 색, check-palette 가 따로 봄)
 * 결과: artifacts/heraldry/elements.png (4배: 방패 / 분할 / 문양(은 바탕에 빨강) / 색 견본), sample-grid.png
 * 사용: npx tsx tools/check-heraldry.ts
 */
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { HERALDRY, composeCoatOfArmsPixels, tinctureWarnings } from '../src/render/heraldry';
import { newImg, fill, writePng, scaleNearest, readPng, blit } from './lpc/png';
import { coatImg, randomCoat } from './heraldry-node';
import { mulberry32 } from './lpc/compose-node';

const errors: string[] = [];
const H = HERALDRY;
const ko: Record<string, string> = JSON.parse(readFileSync('src/i18n/ko/heraldry.json', 'utf8'));
mkdirSync('artifacts/heraldry', { recursive: true });

const want = { shields: 6, divisions: 12, charges: 40, tinctures: 8 } as const;
for (const [k, n] of Object.entries(want)) {
  const list = (H as unknown as Record<string, Array<{ id: string; nameKey: string }>>)[k];
  if (list.length !== n) errors.push(`${k}: ${list.length}개 (요구 ${n})`);
  const ids = new Set(list.map((e) => e.id));
  if (ids.size !== list.length) errors.push(`${k}: id 겹침`);
  for (const e of list) if (!ko[e.nameKey]) errors.push(`한국어 이름 없음: ${e.nameKey}`);
}
const metals = H.tinctures.filter((t) => t.kind === 'metal').length;
if (metals !== 2) errors.push(`금속색 ${metals}개 (요구 2)`);
const BANNED = ['dragon', 'griffin', 'gryphon', 'wyvern', 'unicorn', 'phoenix'];
for (const c of H.charges) if (BANNED.some((b) => c.id.includes(b))) errors.push(`하이판타지 문양 금지: ${c.id}`);

const S = H.shieldSize, C = H.chargeSize;
for (const s of H.shields) if (s.mask.length !== S || s.mask.some((r) => r.length !== S)) errors.push(`방패 ${s.id} 마스크 크기`);
for (const d of H.divisions) if (d.mask.length !== S || d.mask.some((r) => r.length !== S)) errors.push(`분할 ${d.id} 마스크 크기`);
const chargeStats: Array<{ id: string; px: number; w: number; h: number }> = [];
for (const c of H.charges) {
  if (c.mask.length !== C || c.mask.some((r) => r.length !== C)) errors.push(`문양 ${c.id} 마스크 크기`);
  let n = 0, x0 = C, x1 = -1, y0 = C, y1 = -1;
  c.mask.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
  if (n < 20) errors.push(`문양 ${c.id} 거의 빔 (${n}px)`);
  chargeStats.push({ id: c.id, px: n, w: x1 - x0 + 1, h: y1 - y0 + 1 });
}

// 안전 영역: 방패 안쪽 (외곽선 1px 안쪽 테두리 제외) 에 문양 + 문양 외곽선이 다 들어감
const unsafe: string[] = [];
for (const s of H.shields) {
  const inS = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S && s.mask[y][x] === '#';
  const ox = s.charge.x - C / 2, oy = s.charge.y - C / 2;
  for (const c of H.charges) {
    const filled = (x: number, y: number) => { const cx = x - ox, cy = y - oy; return cx >= 0 && cy >= 0 && cx < C && cy < C && c.mask[cy][cx] !== '.'; };
    let bad = 0;
    for (let y = -1; y <= S; y++)
      for (let x = -1; x <= S; x++) {
        const need = filled(x, y) || filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1);
        if (need && !inS(x, y)) bad++;
      }
    if (bad) unsafe.push(`${s.id}×${c.id}: ${bad}px 밖`);
  }
}
if (unsafe.length) errors.push(`안전 영역 밖 ${unsafe.length}건: ${unsafe.slice(0, 8).join(', ')}`);

for (const s of H.shields)
  for (const d of H.divisions) {
    if (!d.second) continue;
    let a = 0, b = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (s.mask[y][x] === '#') { if (d.mask[y][x] === '#') b++; else a++; }
    if (a < 20 || b < 20) errors.push(`분할 ${d.id} 가 방패 ${s.id} 에서 한 색만 보임 (${a}/${b})`);
  }

// 규칙 함수
if (!tinctureWarnings({ shield: 'heater', division: 'plain', tinctures: ['or', 'or'], charge: 'lion', chargeTincture: 'argent' }).length) errors.push('금속 위 금속 경고가 안 나옴');
if (tinctureWarnings({ shield: 'heater', division: 'plain', tinctures: ['gules', 'gules'], charge: 'lion', chargeTincture: 'or' }).length) errors.push('빨강 위 금에 경고가 나옴');

// 시트 그림 ↔ 좌표
const sheetPath = H.sheet;
if (!existsSync(sheetPath)) errors.push(`시트 없음: ${sheetPath}`);
else {
  const sheet = readPng(sheetPath);
  for (const e of [...H.shields, ...H.divisions, ...H.charges]) {
    let mism = 0;
    e.mask.forEach((r, y) => [...r].forEach((ch, x) => {
      const a = sheet.data[((e.sprite.y + y) * sheet.width + e.sprite.x + x) * 4 + 3];
      if ((ch !== '.') !== (a > 0)) mism++;
    }));
    if (mism) errors.push(`시트와 마스크가 다름: ${e.id} (${mism}px)`);
  }
}

// ---------------------------------------------------------------- 확대 시트
{
  const pad = 4;
  const cellS = S + pad;
  const W = Math.max(12 * cellS, 20 * (C + 6 + pad)) + pad;
  const rowsH = [cellS, cellS, 2 * (C + 6 + pad), cellS, cellS];
  const out = newImg(W, rowsH.reduce((a, b) => a + b, 0) + pad * 2);
  fill(out, 214, 196, 160);
  const place = (img: { width: number; height: number; data: Uint8Array }, ox: number, oy: number) => blit(out, img as never, 0, 0, img.width, img.height, ox, oy);
  let oy = pad;
  // 방패 (은 바탕, 문양 없음)
  H.shields.forEach((s, i) => place(coatImg({ shield: s.id, division: 'plain', tinctures: ['argent', 'argent'], charge: null, chargeTincture: 'gules' }, 1), pad + i * cellS, oy));
  oy += cellS;
  // 분할 (heater, 파랑/금)
  H.divisions.forEach((d, i) => place(coatImg({ shield: 'heater', division: d.id, tinctures: ['azure', 'or'], charge: null, chargeTincture: 'gules' }, 1), pad + i * cellS, oy));
  oy += cellS;
  // 문양 (은 바탕 위 빨강, 22×22 칸)
  H.charges.forEach((c, i) => {
    const bx = pad + (i % 20) * (C + 6 + pad);
    const by = oy + Math.floor(i / 20) * (C + 6 + pad);
    for (let y = 0; y < C + 6; y++) for (let x = 0; x < C + 6; x++) out.data.set([223, 221, 213, 255], ((by + y) * out.width + bx + x) * 4);
    const px = composeCoatOfArmsPixels({ shield: 'french', division: 'plain', tinctures: ['argent', 'argent'], charge: c.id, chargeTincture: 'gules' }, 1);
    // 방패 가운데 22×22 만 잘라 붙임
    const fr = H.shields.find((s) => s.id === 'french')!.charge;
    const sx = fr.x - 11, sy = fr.y - 11;
    for (let y = 0; y < C + 6; y++) for (let x = 0; x < C + 6; x++) {
      const si = ((sy + y) * px.width + sx + x) * 4;
      if (px.data[si + 3]) out.data.set(px.data.subarray(si, si + 4), ((by + y) * out.width + bx + x) * 4);
    }
  });
  oy += 2 * (C + 6 + pad);
  // 색 8 (둥근 방패) + 같은 문양 다른 방패
  H.tinctures.forEach((t, i) => place(coatImg({ shield: 'round', division: 'plain', tinctures: [t.id, t.id], charge: null, chargeTincture: t.id }, 1), pad + i * cellS, oy));
  oy += cellS;
  H.shields.forEach((s, i) => place(coatImg({ shield: s.id, division: 'per_pale', tinctures: ['gules', 'or'], charge: 'lion', chargeTincture: 'sable' }, 1), pad + i * cellS, oy));
  H.shields.forEach((s, i) => place(coatImg({ shield: s.id, division: 'plain', tinctures: ['vert', 'vert'], charge: 'wheel', chargeTincture: 'argent' }, 1), pad + (6 + i) * cellS, oy));
  writePng('artifacts/heraldry/elements.png', scaleNearest(out, 4));
}
// 무작위 24개
{
  const rng = mulberry32(20260926);
  const scale = 3, Ssc = S * scale, pad = 12, cols = 8;
  const out = newImg(cols * (Ssc + pad) + pad, 3 * (Ssc + pad) + pad);
  fill(out, 214, 196, 160);
  for (let i = 0; i < 24; i++) {
    const img = coatImg(randomCoat(rng), scale);
    blit(out, img as never, 0, 0, img.width, img.height, pad + (i % cols) * (Ssc + pad), pad + Math.floor(i / cols) * (Ssc + pad));
  }
  writePng('artifacts/heraldry/sample-grid.png', out);
}

console.log(`문장 요소: 방패 ${H.shields.length}, 분할 ${H.divisions.length}, 문양 ${H.charges.length}, 색 ${H.tinctures.length} (금속 ${metals})`);
console.log(`안전 영역: 방패 ${H.shields.length} × 문양 ${H.charges.length} = ${H.shields.length * H.charges.length} 조합 중 밖 ${unsafe.length}`);
console.log(`문양 픽셀 수 최소 ${Math.min(...chargeStats.map((c) => c.px))} (${chargeStats.sort((a, b) => a.px - b.px)[0].id}), 최대 폭 ${Math.max(...chargeStats.map((c) => c.w))}, 최대 높이 ${Math.max(...chargeStats.map((c) => c.h))}`);
if (errors.length) {
  console.log('실패:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('통과. 확대 시트: artifacts/heraldry/elements.png, 무작위: artifacts/heraldry/sample-grid.png');
