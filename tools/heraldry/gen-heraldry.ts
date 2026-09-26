/**
 * 문장 요소 생성 (GDD 16-1 "방패 모양 6, 분할 12, 문양 40, 색 8", 30-1 heraldry.json). 픽셀 편집 스크립트, 생성형 AI 안 씀.
 *
 * - 방패 6: 32×32 칸 안 도형 마스크 (외곽선 1px 은 합성기가 그림)
 * - 분할 12: 32×32 칸 마스크 ('#' = 둘째 색)
 * - 문양 40: 16×16 단색 실루엣 (tools/heraldry/charges.ts 손으로 찍은 것 + 해/별/초승달/수레바퀴 도형), 가운데 맞춤
 * - 색 8: 금속 2(금, 은) + 색 6(빨강, 파랑, 초록, 검정, 자주, 주황). 각 3단(어두움/기본/밝음), 전부 Epic RPG World 팔레트에 있는 색
 *
 * 출력:
 *   src/data/heraldry.json                       (마스크 문자열 + 시트 좌표 + 색 + 방패별 문양 중심) → src/render/heraldry.ts 가 씀
 *   assets/generated/heraldry/heraldry.png       (같은 마스크를 그림으로: 흰색 = 채움, 외곽선 색 = 안쪽 선. 색 견본 줄)
 * 사용: npx tsx tools/heraldry/gen-heraldry.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { newImg, writePng } from '../lpc/png';
import { CHARGES, CHARGE_ORDER, PROCEDURAL } from './charges';

const S = 32; // 방패 칸
const C = 16; // 문양 칸

// ---------------------------------------------------------------- 색 (Epic RPG World 팔레트 색만)
const OUTLINE = '#281e22';
const TINCTURES: Array<{ id: string; kind: 'metal' | 'colour'; ramp: [string, string, string] }> = [
  { id: 'or', kind: 'metal', ramp: ['#ab701b', '#d5b046', '#f0cf64'] },
  { id: 'argent', kind: 'metal', ramp: ['#a1a1a1', '#dfddd5', '#ffffff'] },
  { id: 'gules', kind: 'colour', ramp: ['#6e2430', '#ba1c2d', '#ed5a47'] },
  { id: 'azure', kind: 'colour', ramp: ['#283a6b', '#305391', '#5f94cc'] },
  { id: 'vert', kind: 'colour', ramp: ['#2a4d2e', '#2f8136', '#72a852'] },
  { id: 'sable', kind: 'colour', ramp: ['#1c171d', '#2f2930', '#554e55'] },
  { id: 'purpure', kind: 'colour', ramp: ['#432a59', '#5d3a78', '#9570b1'] },
  { id: 'tenne', kind: 'colour', ramp: ['#8f5030', '#ca742e', '#ee9e4a'] },
];

// ---------------------------------------------------------------- 방패
type Inside = (x: number, y: number) => boolean;
const SHIELDS: Array<{ id: string; inside: Inside; charge: [number, number] }> = [
  {
    id: 'heater',
    charge: [16, 14],
    inside: (x, y) => {
      if (y < 1.5 || y > 31) return false;
      const hw = y <= 13 ? 13.5 : 13.5 * (1 - Math.pow((y - 13) / 18, 1.8));
      return Math.abs(x - 16) <= hw;
    },
  },
  {
    id: 'french',
    charge: [16, 15],
    inside: (x, y) => {
      const dx = Math.abs(x - 16);
      if (y < 1.5 || dx > 13.5) return false;
      const b = 26 + 4.6 * Math.pow(Math.max(0, 1 - dx / 13.5), 2.2);
      // 아래 두 모서리 둥글게 (반지름 3)
      if (y > 23 && dx > 10.5 && Math.hypot(dx - 10.5, y - 23) > 3) return false;
      return y <= b;
    },
  },
  {
    id: 'iberian',
    charge: [16, 15],
    inside: (x, y) => {
      const dx = Math.abs(x - 16);
      if (y < 1.5 || dx > 13.5) return false;
      return y <= 17.5 || Math.hypot(dx, y - 17.5) <= 13.5;
    },
  },
  {
    id: 'kite',
    charge: [16, 14],
    inside: (x, y) => {
      const dx = Math.abs(x - 16);
      if (y < 1 || y > 31.2) return false;
      const hw = y < 9 ? 13 * Math.sqrt(Math.max(0, 1 - ((9 - y) / 8) ** 2)) : 13 * Math.pow(Math.max(0, (31.2 - y) / 22.2), 0.55);
      return dx <= hw;
    },
  },
  { id: 'round', charge: [16, 16], inside: (x, y) => Math.hypot(x - 16, y - 16) <= 14.6 },
  { id: 'oval', charge: [16, 16], inside: (x, y) => ((x - 16) / 12.6) ** 2 + ((y - 16) / 15.2) ** 2 <= 1 },
];

// ---------------------------------------------------------------- 분할 ('#' = 둘째 색). x, y = 픽셀 중심
const DIVISIONS: Array<{ id: string; second: boolean; f: (x: number, y: number) => boolean }> = [
  { id: 'plain', second: false, f: () => false },
  { id: 'per_pale', second: true, f: (x) => x > 16 },
  { id: 'per_fess', second: true, f: (_x, y) => y > 15 },
  { id: 'per_bend', second: true, f: (x, y) => y > x },
  { id: 'per_bend_sinister', second: true, f: (x, y) => y > 32 - x },
  { id: 'quarterly', second: true, f: (x, y) => (x > 16) !== (y > 15) },
  { id: 'per_saltire', second: true, f: (x, y) => Math.abs(x - 16) < Math.abs(y - 15.5) },
  { id: 'per_chevron', second: true, f: (x, y) => y > 11 + Math.abs(x - 16) * 0.95 },
  { id: 'chief', second: true, f: (_x, y) => y < 10 },
  { id: 'fess', second: true, f: (_x, y) => y > 11 && y < 19 },
  { id: 'cross', second: true, f: (x, y) => Math.abs(x - 16) < 3 || Math.abs(y - 15) < 3 },
  { id: 'chequy', second: true, f: (x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) & 1) === 1 },
];

// ---------------------------------------------------------------- 도형 문양
function procedural(id: string): string[] {
  const g: string[][] = Array.from({ length: C }, () => Array(C).fill('.'));
  const set = (x: number, y: number, v = '#') => { if (x >= 0 && y >= 0 && x < C && y < C) g[y][x] = v; };
  const cx = 7.5, cy = 7.5;
  for (let y = 0; y < C; y++)
    for (let x = 0; x < C; x++) {
      const px = x + 0.5 - 8, py = y + 0.5 - 8;
      const r = Math.hypot(px, py);
      const a = Math.atan2(py, px);
      if (id === 'star') {
        // 오각 별 (꼭짓점 위): 극좌표 반지름이 각도에 따라 7.8 ↔ 3.4
        const k = ((a + Math.PI / 2) / ((2 * Math.PI) / 5)) % 1;
        const t = Math.abs(((k + 1) % 1) - 0.5) * 2; // 0 = 꼭짓점 사이, 1 = 꼭짓점
        const rr = 3.3 + (7.9 - 3.3) * Math.pow(t, 1.6);
        if (r <= rr) set(x, y);
      } else if (id === 'sun') {
        if (r <= 4.6) set(x, y);
        else {
          const k = ((a / ((2 * Math.PI) / 12)) % 1 + 1) % 1;
          const t = Math.abs(k - 0.5) * 2;
          if (r <= 4.6 + 3.4 * Math.pow(t, 3) && r <= 7.9) set(x, y);
        }
      } else if (id === 'crescent') {
        // 뿔이 위로
        if (r <= 7.2 && Math.hypot(px, py + 3.2) > 5.8) set(x, y);
      } else if (id === 'wheel') {
        const ring = r <= 7.6 && r >= 5.4;
        const hub = r <= 1.9;
        const spoke = r < 5.6 && [0, 1, 2, 3].some((i) => {
          const ang = (i * Math.PI) / 4;
          return Math.abs(px * Math.sin(ang) - py * Math.cos(ang)) < 0.75;
        });
        if (ring || hub || spoke) set(x, y);
      }
    }
  void cx; void cy;
  // 얼굴 무늬: 해 가운데 눈 두 점
  if (id === 'sun') { set(6, 7, 'o'); set(9, 7, 'o'); }
  return g.map((r) => r.join(''));
}

/** 문양을 칸 가운데로 (경계 상자 기준) */
function center(rows: string[]): string[] {
  let x0 = C, y0 = C, x1 = -1, y1 = -1;
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
  const dx = Math.floor((C - (x1 - x0 + 1)) / 2) - x0;
  const dy = Math.floor((C - (y1 - y0 + 1)) / 2) - y0;
  const out = Array.from({ length: C }, () => Array(C).fill('.'));
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') out[y + dy][x + dx] = ch; }));
  return out.map((r) => r.join(''));
}

function gridOf(f: (x: number, y: number) => boolean, n: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let s = '';
    for (let x = 0; x < n; x++) s += f(x + 0.5, y + 0.5) ? '#' : '.';
    rows.push(s);
  }
  return rows;
}

function main() {
  const shields = SHIELDS.map((s, i) => ({ id: s.id, nameKey: `heraldry.shield.${s.id}`, sprite: { x: i * S, y: 0, w: S, h: S }, charge: { x: s.charge[0], y: s.charge[1] }, mask: gridOf(s.inside, S) }));
  const divisions = DIVISIONS.map((d, i) => ({ id: d.id, nameKey: `heraldry.division.${d.id}`, second: d.second, sprite: { x: i * S, y: S, w: S, h: S }, mask: gridOf(d.f, S) }));
  const charges = CHARGE_ORDER.map((id, i) => {
    const raw = PROCEDURAL.has(id) ? procedural(id) : CHARGES[id];
    if (!raw || raw.length !== C || raw.some((r) => r.length !== C)) throw new Error(`charge ${id}: 16×16 이 아님`);
    return { id, nameKey: `heraldry.charge.${id}`, sprite: { x: (i % 20) * C, y: 2 * S + Math.floor(i / 20) * C, w: C, h: C }, mask: center(raw) };
  });
  const tinctures = TINCTURES.map((t, i) => ({ id: t.id, nameKey: `heraldry.tincture.${t.id}`, kind: t.kind, ramp: t.ramp, sprite: { x: i * C, y: 2 * S + 2 * C, w: C, h: C } }));
  const data = {
    $comment: 'GDD 16-1 문장 편집기 요소 (tools/heraldry/gen-heraldry.ts 가 만듦, 손으로 고치지 말 것). mask: "#" 채움, "o" 안쪽 선(외곽선 색), "." 빈칸. 방패/분할 32×32, 문양 16×16 (방패 charge 점이 문양 칸 가운데). 합성: src/render/heraldry.ts',
    version: 1,
    sheet: 'assets/generated/heraldry/heraldry.png',
    shieldSize: S,
    chargeSize: C,
    outline: OUTLINE,
    rule: { note: '문장학 색 규칙: 금속 위에 금속, 색 위에 색을 올리면 경고 (문양 색 ↔ 바탕 색)' },
    shields,
    divisions,
    charges,
    tinctures,
  };
  writeFileSync('src/data/heraldry.json', JSON.stringify(data, null, 1) + '\n');

  // 시트 그림 (흰색 채움 / 외곽선 색 안쪽 선 / 색 견본)
  const W = 12 * S, H = 2 * S + 3 * C;
  const img = newImg(W, H);
  const put = (x: number, y: number, hex: string) => {
    const v = parseInt(hex.slice(1), 16);
    const i = (y * W + x) * 4;
    img.data[i] = (v >> 16) & 255; img.data[i + 1] = (v >> 8) & 255; img.data[i + 2] = v & 255; img.data[i + 3] = 255;
  };
  const drawMask = (mask: string[], ox: number, oy: number) => mask.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') put(ox + x, oy + y, '#ffffff'); else if (ch === 'o') put(ox + x, oy + y, OUTLINE); }));
  for (const s of shields) drawMask(s.mask, s.sprite.x, s.sprite.y);
  for (const d of divisions) drawMask(d.mask, d.sprite.x, d.sprite.y);
  for (const c of charges) drawMask(c.mask, c.sprite.x, c.sprite.y);
  for (const t of tinctures) for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) put(t.sprite.x + x, t.sprite.y + y, t.ramp[y < 5 ? 2 : y < 11 ? 1 : 0]);
  mkdirSync('assets/generated/heraldry', { recursive: true });
  writePng('assets/generated/heraldry/heraldry.png', img);
  console.log(`heraldry: shields ${shields.length}, divisions ${divisions.length}, charges ${charges.length}, tinctures ${tinctures.length}`);
}

main();
