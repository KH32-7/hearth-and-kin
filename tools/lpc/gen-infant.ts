/**
 * 아기(0~1세)와 유아(1~4세) 스프라이트 생성 (픽셀 편집 스크립트, 생성형 AI 안 씀).
 *
 * 아기: 강보(요람/바닥/품 안) 전부 도형으로 그림 (tools/lpc/infant-paint.ts).
 * 유아: 몸과 옷은 도형 뼈대(3차원 관절 → LPC 3/4 투영)로 그리고, 머리와 머리카락은 LPC 아동 머리/머리카락
 *       원본 프레임(idle 0)을 그대로 옮겨 붙임 → 아동 머리 레이어의 피부색/눈색/머리색 교체와 머리 모양이 그대로 통함.
 *       (docs/04 "아동 몸을 줄여 새로 찍음 (머리 비율 크게)": 머리는 아동 크기 그대로, 몸은 아동의 약 2/3)
 *
 * 출력 (모든 레이어 = 같은 칸 배치의 한 장, 원본 램프 색 → 게임에서 팔레트 교체):
 *   assets/generated/lpc/infant/baby/{body,swaddle,hair,mat,tears}.png      4열 × 6행 (64px 칸)
 *   assets/generated/lpc/infant/toddler/{body,head,smock,gown,tunic}.png     8열 × 21행
 *   assets/generated/lpc/infant/toddler/hair/<hair layer id>.png
 *   assets/generated/lpc/infant/infant.json   → build-pack.ts 가 lpc.json 의 "infant" 로 합침
 *
 * 사용: npx tsx tools/lpc/gen-infant.ts && npx tsx tools/lpc/build-pack.ts
 * 머리/머리카락 파생물은 CC-BY-SA 3.0 (LPC 아동 머리/머리카락), assets/SHARE_ALIKE.md 에 기록할 것.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { readPng, writePng, newImg, blit, type Img } from './png';
import { SPRITE_ROOT } from './generator';
import { rasterize, outline, layerImage, coverage, type Prim, type Mat } from './infant-paint';
import type { Facing, LpcPack } from '../../src/render/lpc/types';

const F = 64;
const OUT = 'assets/generated/lpc/infant/';
const pack: LpcPack = JSON.parse(readFileSync('src/data/artpacks/lpc.json', 'utf8'));
const RAMP: Record<Mat, string[]> = {
  skin: pack.palettes.body.source,
  cloth: pack.palettes.cloth.source,
  hair: pack.palettes.hair.source,
  mat: pack.palettes.cloth.source,
  // 눈물: 눈 램프(어두운 파랑 → 밝은 하늘색). 0 = 외곽선 자리에도 짙은 파랑
  tear: [pack.palettes.eye.source[0], pack.palettes.eye.source[1], pack.palettes.eye.source[1], pack.palettes.eye.source[2], pack.palettes.eye.source[2], pack.palettes.eye.source[2]],
};
const DIRS: Facing[] = ['up', 'left', 'down', 'right'];

// ====================================================================== 유아 뼈대

type V3 = [number, number, number]; // lat(아이의 오른쪽 +), up, fwd(앞 +)
interface Pose {
  torso: { c: V3; r: V3 };
  neck: V3;
  shoulder: [V3, V3];
  elbow: [V3, V3];
  hand: [V3, V3];
  hip: [V3, V3];
  knee: [V3, V3];
  ankle: [V3, V3];
  /** 발 방향: stand = 발끝 앞, sole = 발바닥이 뒤/위(기기), up = 발끝 위(앉기) */
  foot: 'stand' | 'sole' | 'up';
  /** 화면 정수 이동 (뒤뚱거림, 숨쉬기) */
  shift?: [number, number];
  /** 머리만 따로 더 이동 */
  headShift?: [number, number];
}
const K = 0.35; // 깊이 → 화면 아래로

function proj(v: V3, dir: Facing): { x: number; y: number; z: number } {
  const [lat, up, fwd] = v;
  let sx = 0, zc = 0;
  if (dir === 'down') { sx = -lat; zc = fwd; }
  else if (dir === 'up') { sx = lat; zc = -fwd; }
  else if (dir === 'left') { sx = -fwd; zc = -lat; }
  else { sx = fwd; zc = lat; }
  return { x: 32 + sx, y: 61 - up + zc * K, z: zc };
}

type Garment = 'none' | 'smock' | 'gown' | 'tunic';
const GARMENTS: Garment[] = ['smock', 'gown', 'tunic'];

/** 볼록 껍질 (화면 좌표) */
function hull(pts: Array<[number, number]>): Array<[number, number]> {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Array<[number, number]> = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up: Array<[number, number]> = [];
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function toddlerPrims(pose: Pose, dir: Facing, garment: Garment, oy: number): { prims: Prim[]; neck: { x: number; y: number } } {
  const [sx, sy] = pose.shift ?? [0, 0];
  const P = (v: V3) => { const p = proj(v, dir); return { x: p.x + sx, y: p.y + sy + oy, z: p.z }; };
  const prims: Prim[] = [];
  const side = dir === 'left' || dir === 'right';
  const cloth = (on: boolean): Mat => (on && garment !== 'none' ? 'cloth' : 'skin');
  // 몸통 (타원체 투영: 옆모습은 앞뒤 두께, 앞/뒷모습은 어깨 폭. 깊이만큼 세로로 조금 늘어남)
  const tc = P(pose.torso.c);
  const [rl, ru, rf] = pose.torso.r;
  const rx = side ? rf : rl;
  const ry = Math.sqrt(ru * ru + ((side ? rl : rf) * K) ** 2);
  prims.push({ kind: 'ellipse', cx: tc.x, cy: tc.y, rx, ry, z: tc.z, group: 1, mat: cloth(true) });
  // 팔다리
  let maxThighZ = -Infinity;
  for (let s = 0; s < 2; s++) {
    const sh = P(pose.shoulder[s]), el = P(pose.elbow[s]), ha = P(pose.hand[s]);
    const hp = P(pose.hip[s]), kn = P(pose.knee[s]), an = P(pose.ankle[s]);
    const far = (sh.z + ha.z) / 2 < -1.5;
    const bias = far ? -1.2 : 0;
    const gA = 10 + s, gL = 20 + s;
    const armZ = (sh.z + el.z + ha.z) / 3 + 0.5;
    prims.push({ kind: 'capsule', ax: sh.x, ay: sh.y, bx: el.x, by: el.y, ra: 1.8, rb: 1.6, z: armZ, group: gA, mat: cloth(true), bias });
    prims.push({ kind: 'capsule', ax: el.x, ay: el.y, bx: ha.x, by: ha.y, ra: 1.5, rb: 1.4, z: armZ + 0.01, group: gA, mat: cloth(garment === 'gown'), bias });
    prims.push({ kind: 'ellipse', cx: ha.x, cy: ha.y, rx: 1.75, ry: 1.65, z: armZ + 0.02, group: gA, mat: 'skin', bias });
    const legZ = (hp.z + kn.z + an.z) / 3;
    maxThighZ = Math.max(maxThighZ, (hp.z + kn.z) / 2);
    prims.push({ kind: 'capsule', ax: hp.x, ay: hp.y, bx: kn.x, by: kn.y, ra: 2.4, rb: 2.1, z: legZ, group: gL, mat: 'skin', bias });
    prims.push({ kind: 'capsule', ax: kn.x, ay: kn.y, bx: an.x, by: an.y, ra: 2.0, rb: 1.75, z: legZ + 0.01, group: gL, mat: 'skin', bias });
    // 발
    const a3 = pose.ankle[s];
    let fc: V3, frx: number, fry: number;
    if (pose.foot === 'stand') { fc = [a3[0], 1.25, a3[2] + 0.9]; frx = side ? 2.5 : 1.8; fry = 1.25; }
    else if (pose.foot === 'sole') { fc = [a3[0], a3[1] + 0.3, a3[2] - 1.0]; frx = side ? 1.4 : 1.7; fry = side ? 2.1 : 1.6; }
    else { fc = [a3[0], a3[1] + 1.0, a3[2] + 0.6]; frx = side ? 1.4 : 1.7; fry = 2.0; }
    const fp = P(fc);
    prims.push({ kind: 'ellipse', cx: fp.x, cy: fp.y, rx: frx, ry: fry, z: Math.max(legZ, fp.z) + 0.02, group: gL, mat: 'skin', bias });
  }
  // 치마 (옷만): 허리 둘레와 단(무릎/발목/허벅지 중간) 둘레의 볼록 껍질
  if (garment !== 'none') {
    const hemT = garment === 'gown' ? 1 : garment === 'smock' ? 0.55 : 0.2;
    const flare = garment === 'gown' ? 2.8 : garment === 'smock' ? 2.9 : 2.6;
    const pts: Array<[number, number]> = [];
    const waistUp = pose.torso.c[1] - ru * 0.35;
    for (const a of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const ang = (a / 8) * Math.PI * 2;
      const w: V3 = [pose.torso.c[0] + Math.cos(ang) * rl * 0.95, waistUp, pose.torso.c[2] + Math.sin(ang) * rf * 0.9];
      const q = P(w); pts.push([q.x, q.y]);
    }
    for (let s = 0; s < 2; s++) {
      // 다리 전체 길이 기준 단 위치 (엉덩이 → 무릎 → 발목)
      const t = hemT * 2;
      const hem = t <= 1 ? lerp3(pose.hip[s], pose.knee[s], t) : lerp3(pose.knee[s], pose.ankle[s], t - 1);
      for (const a of [0, 1, 2, 3, 4, 5, 6, 7]) {
        const ang = (a / 8) * Math.PI * 2;
        const q = P([hem[0] + Math.cos(ang) * flare, hem[1], hem[2] + Math.sin(ang) * flare]);
        pts.push([q.x, q.y]);
      }
    }
    prims.push({ kind: 'poly', pts: hull(pts), z: Math.max(tc.z, maxThighZ) + 0.2, group: 1, mat: 'cloth' });
  }
  const nk = P(pose.neck);
  const [hx, hy] = pose.headShift ?? [0, 0];
  return { prims, neck: { x: nk.x + hx, y: nk.y + hy } };
}

// ---------------------------------------------------------------------- 자세

const sym = (v: V3): [V3, V3] => [v, [-v[0], v[1], v[2]]];
function stand(): Pose {
  return {
    torso: { c: [0, 9.3, 0.5], r: [6.1, 4.6, 5.4] },
    neck: [0, 13.9, 0],
    shoulder: sym([4.9, 12.0, 0]),
    elbow: sym([6.2, 9.9, 0.3]),
    hand: sym([6.5, 7.9, 0.8]),
    hip: sym([2.6, 5.4, 0]),
    knee: sym([2.7, 3.1, 0.2]),
    ankle: sym([2.8, 1.4, 0]),
    foot: 'stand',
  };
}

function idleFrames(): Pose[] {
  const a = stand();
  const b = stand();
  // 숨: 윗몸 1px 내려앉음
  b.torso = { c: [0, 8.9, 0.5], r: [6.2, 4.4, 5.5] };
  b.neck = [0, 12.9, 0];
  b.shoulder = sym([4.9, 11.2, 0]);
  b.elbow = sym([6.2, 9.2, 0.3]);
  b.hand = sym([6.5, 7.3, 0.8]);
  return [a, b];
}

function walkFrames(): Pose[] {
  const out: Pose[] = [];
  for (let f = 0; f < 8; f++) {
    const ph = (f / 8) * Math.PI * 2;
    const p = stand();
    const s = Math.sin(ph), c = Math.cos(ph);
    const stride = 2.0;
    for (let k = 0; k < 2; k++) {
      const sg = k === 0 ? 1 : -1;
      const fw = stride * s * sg;
      // 앞으로 나가는 다리(속도 +)가 들림
      const lift = Math.max(0, c * sg) * 1.1;
      const lat = sg * 2.7;
      p.ankle[k] = [lat, 1.4 + lift, fw];
      p.knee[k] = [lat, 3.2 + lift * 0.6, fw * 0.55 + lift * 0.5];
      p.hip[k] = [sg * 2.6, 5.4, fw * 0.15];
      // 팔: 균형 잡느라 옆으로 벌리고 조금 올림, 다리 반대로 흔듦
      p.shoulder[k] = [sg * 4.9, 12.0, 0];
      p.elbow[k] = [sg * 7.0, 10.6, 0.4 - fw * 0.25];
      p.hand[k] = [sg * 8.0, 10.8 + 0.4 * Math.abs(s), 1.2 - fw * 0.45];
    }
    // 뒤뚱: 좌우 1px, 다리가 모일 때 1px 위
    const sway = Math.round(Math.sin(ph) * 1.0);
    const bob = Math.abs(Math.cos(ph)) > 0.7 ? -1 : 0;
    p.shift = [sway, bob];
    out.push(p);
  }
  return out;
}

function crawlFrames(): Pose[] {
  // 6프레임 대각선 걸음: 오른손+왼무릎 → 왼손+오른무릎. 앞으로 나가는 손/무릎은 들림, 팔다리가 들린 동안 몸이 1px 올라감
  const out: Pose[] = [];
  const N = 6;
  for (let f = 0; f < N; f++) {
    const ph = (f / N) * Math.PI * 2;
    const a = Math.cos(ph) * 1.9;
    const liftR = Math.max(0, -Math.sin(ph)) * 1.5;
    const liftL = Math.max(0, Math.sin(ph)) * 1.5;
    const bob = Math.abs(Math.sin(ph)) > 0.5 ? -1 : 0;
    const p: Pose = {
      torso: { c: [0, 6.9, 0], r: [5.3, 3.7, 6.3] },
      neck: [0, 8.8, 6.3],
      shoulder: sym([4.2, 7.2, 4.6]),
      elbow: [[6.0, 4.4 + liftR * 0.5, 5.8 + a / 2], [-6.0, 4.4 + liftL * 0.5, 5.8 - a / 2]],
      hand: [[6.6, 1.3 + liftR, 7.0 + a], [-6.6, 1.3 + liftL, 7.0 - a]],
      hip: sym([3.0, 6.6, -4.3]),
      // 대각선 걸음: 오른손과 왼무릎이 같이. 무릎은 벌리고 발은 안쪽으로 (뒤에서 봐도 네 발로 기는 모양)
      knee: [[4.3, 1.5 + liftL * 0.7, -3.4 - a], [-4.3, 1.5 + liftR * 0.7, -3.4 + a]],
      ankle: [[2.4, 1.6 + liftL * 0.4, -8.0 - a], [-2.4, 1.6 + liftR * 0.4, -8.0 + a]],
      foot: 'sole',
      shift: [0, bob],
    };
    out.push(p);
  }
  return out;
}

function sitPose(play: number): Pose {
  return {
    torso: { c: [0, 5.1, -0.3], r: [6.1, 4.5, 5.3] },
    neck: [0, 9.6, -0.6],
    shoulder: sym([4.9, 7.9, -0.5]),
    elbow: sym([5.9, 5.3 + play * 1.2, 1.6 + play * 0.4]),
    hand: [[3.4 - play * 1.4, 3.0 + play * 2.4, 4.3 + play * 0.4], [-3.4 + play * 1.4, 3.0 + play * 2.4, 4.3 + play * 0.4]],
    hip: sym([2.8, 1.9, 0.2]),
    knee: sym([3.6, 1.7, 3.6]),
    ankle: sym([4.0, 1.7, 6.3]),
    foot: 'up',
  };
}

function fallFrames(): Pose[] {
  // 0 비틀 (앞으로 기울고 팔 앞으로) → 1 주저앉는 중 (팔 번쩍) → 2 엉덩방아 (찌부) → 3 앉아서 멈춤
  const f0 = stand();
  f0.torso = { c: [0, 9.0, 1.5], r: [6.1, 4.6, 5.3] };
  f0.neck = [0, 13.3, 2.4];
  f0.shoulder = sym([4.9, 11.6, 1.4]);
  f0.elbow = sym([6.0, 11.0, 3.6]);
  f0.hand = sym([6.2, 11.2, 5.8]);
  f0.knee = [[2.7, 3.2, 1.2], [-2.7, 3.4, -1.0]];
  f0.ankle = [[2.8, 1.4, 1.4], [-2.8, 2.0, -2.2]];
  const f1: Pose = {
    torso: { c: [0, 7.2, 0.2], r: [6.1, 4.5, 5.3] },
    neck: [0, 11.7, 0.1],
    shoulder: sym([4.9, 9.9, 0]),
    elbow: sym([7.0, 11.3, 0.4]),
    hand: sym([7.6, 13.2, 1.0]),
    hip: sym([2.7, 3.6, 0.6]),
    knee: sym([3.3, 2.6, 3.0]),
    ankle: sym([3.4, 1.4, 3.2]),
    foot: 'stand',
  };
  const f2 = sitPose(0);
  f2.torso = { c: [0, 4.6, -0.3], r: [6.4, 4.0, 5.4] };
  f2.neck = [0, 8.6, -0.6];
  f2.shoulder = sym([5.0, 7.2, -0.5]);
  f2.elbow = sym([7.0, 8.2, 0.2]);
  f2.hand = sym([8.0, 9.8, 1.0]);
  const f3 = sitPose(0);
  f3.elbow = sym([6.3, 4.4, 0.4]);
  f3.hand = sym([7.0, 1.6, 1.2]);
  return [f0, f1, f2, f3];
}

// ====================================================================== 아동 머리 붙이기

/** LPC 아동 머리 idle 0 프레임의 목 아래 끝 (방향별): 가장 아랫줄과 그 줄 불투명 픽셀의 가운데 x */
function neckOf(img: Img, d: number): { x: number; y: number } {
  let bottom = -1;
  for (let y = F - 1; y >= 0 && bottom < 0; y--)
    for (let x = 0; x < F; x++) if (img.data[((d * F + y) * img.width + x) * 4 + 3] > 0) { bottom = y; break; }
  let sx = 0, n = 0;
  for (let y = bottom - 1; y <= bottom; y++)
    for (let x = 0; x < F; x++) if (img.data[((d * F + y) * img.width + x) * 4 + 3] > 0) { sx += x; n++; }
  return { x: sx / n, y: bottom };
}

const HEAD_PATH = `${SPRITE_ROOT}head/heads/human/child/idle.png`;
const headImg = readPng(HEAD_PATH);
const NECK = DIRS.map((_, d) => neckOf(headImg, d));

// ====================================================================== 유아 시트

const T_COLS = 8;
interface TAnim { name: string; row: number; frames: Pose[]; fps: number; loop: boolean; dirs: Facing[] }
const TODDLER: TAnim[] = [
  { name: 'idle', row: 0, frames: idleFrames(), fps: 2, loop: true, dirs: DIRS },
  { name: 'walk', row: 4, frames: walkFrames(), fps: 12, loop: true, dirs: DIRS },
  { name: 'crawl', row: 8, frames: crawlFrames(), fps: 9, loop: true, dirs: DIRS },
  { name: 'sit', row: 12, frames: [sitPose(0), sitPose(1)], fps: 2, loop: true, dirs: DIRS },
  { name: 'fall', row: 16, frames: fallFrames(), fps: 8, loop: false, dirs: DIRS },
];
const SLEEP_ROW = 20;
const T_ROWS = 21;

interface HeadPlace { col: number; row: number; srcDir: number; dx: number; dy: number; mask?: Uint8Array; srcAnim: string }

function genToddler(): { heads: HeadPlace[]; anims: Record<string, unknown> } {
  const W = T_COLS * F, H = T_ROWS * F;
  const layers: Record<string, Img> = { body: newImg(W, H) };
  for (const g of GARMENTS) layers[g] = newImg(W, H);
  const heads: HeadPlace[] = [];
  for (const a of TODDLER) {
    a.dirs.forEach((dir, di) => {
      // 동작+방향마다 바닥 맞춤: 모든 프레임의 가장 아래 칠한 줄이 60 (외곽선 61) 이 되게 한 번에 올림
      let maxY = 0;
      for (const pose of a.frames) {
        const b = rasterize(toddlerPrims(pose, dir, 'gown', 0).prims);
        for (let i = 0; i < b.id.length; i++) if (b.id[i] >= 0) maxY = Math.max(maxY, Math.floor(i / F));
      }
      const oy = 60 - maxY;
      a.frames.forEach((pose, fi) => {
        const col = fi, row = a.row + di;
        const union = new Uint8Array(F * F);
        for (const g of ['none', ...GARMENTS] as Garment[]) {
          const { prims } = toddlerPrims(pose, dir, g, oy);
          const buf = rasterize(prims);
          outline(buf);
          const cov = coverage(buf);
          for (let i = 0; i < cov.length; i++) union[i] |= cov[i];
          if (g === 'none') layerImage(buf, 'skin', RAMP.skin, layers.body, col * F, row * F);
          else layerImage(buf, 'cloth', RAMP.cloth, layers[g], col * F, row * F);
        }
        const { neck } = toddlerPrims(pose, dir, 'none', oy);
        const sd = DIRS.indexOf(dir);
        const nk = NECK[sd];
        // 머리 목 끝줄 = 목 관절 줄 + 1 (목이 몸통 윗줄과 1줄 겹침)
        const dx = Math.round(neck.x - nk.x - 0.5);
        const dy = Math.round(neck.y) + 1 - nk.y;
        // 기어 가기 뒷모습: 등(가까움)이 머리 아랫부분을 가림
        const mask = a.name === 'crawl' && dir === 'up' ? union : undefined;
        heads.push({ col, row, srcDir: sd, dx, dy, mask, srcAnim: 'idle' });
      });
    });
  }
  // 잠: 머리만 (아동 잠과 같은 자리, 눈 감은 얼굴)
  for (let f = 0; f < 2; f++) heads.push({ col: f, row: SLEEP_ROW, srcDir: 2, dx: 0, dy: f, srcAnim: 'idle' });

  mkdirSync(`${OUT}toddler/hair`, { recursive: true });
  writePng(`${OUT}toddler/body.png`, layers.body);
  for (const g of GARMENTS) writePng(`${OUT}toddler/${g}.png`, layers[g]);
  // 머리 (피부+눈), 잠 눈 감은 얼굴, 머리카락
  const bake = (srcPaths: string[], sleepOnly = false, awakeOnly = false): Img => {
    const out = newImg(W, H);
    for (const hp of heads) {
      const isSleep = hp.row === SLEEP_ROW;
      if ((sleepOnly && !isSleep) || (awakeOnly && isSleep)) continue;
      for (const p of srcPaths) {
        const src = readPng(p);
        const cell = newImg(F, F);
        blit(cell, src, 0, hp.srcDir * F, F, F, hp.dx, hp.dy);
        if (hp.mask) for (let i = 0; i < F * F; i++) if (hp.mask[i]) cell.data[i * 4 + 3] = 0;
        blit(out, cell, 0, 0, F, F, hp.col * F, hp.row * F);
      }
    }
    return out;
  };
  writePng(`${OUT}toddler/head.png`, bake([HEAD_PATH]));
  writePng(`${OUT}toddler/face_closed.png`, bake(['assets/generated/lpc/child/face_closed/idle.png'], true));
  const hairs: Record<string, string> = {};
  for (const [id, l] of Object.entries(pack.layers)) {
    if (!id.startsWith('hair_')) continue;
    const parts = l.parts.filter((p) => p.paths.child).sort((a, b) => a.z - b.z);
    if (!parts.length) continue;
    const paths = parts.map((p) => `${SPRITE_ROOT}${p.paths.child}idle.png`);
    writePng(`${OUT}toddler/hair/${id}.png`, bake(paths));
    hairs[id] = `infant/toddler/hair/${id}.png`;
  }
  const anims: Record<string, unknown> = {};
  for (const a of TODDLER) anims[a.name] = { row: a.row, col: 0, frames: a.frames.length, fps: a.fps, loop: a.loop, dirs: a.dirs };
  anims.sleep = { row: SLEEP_ROW, col: 0, frames: 2, fps: 1, loop: true, dirs: ['down'] };
  return { heads, anims: { ...anims, _hairs: hairs } };
}

// ====================================================================== 아기
//
// 사람 아기로 읽히게 (2차, 사용자 피드백: "양처럼 보임"):
//  - 두건은 이마에 붙는 둥근 테두리만 (위로 솟는 혹/귀 모양 없음), 얼굴을 크게 (강보 길이의 약 40~50%)
//  - 강보는 생성(표백 안 한 리넨) 색이 기본 (게임에서 cloth "tan" 램프), 접힌 선 2개 + 두르는 띠(깔개와 같은 accent 색)
//  - 바닥: 깔개 위에 앉아 팔을 흔듦 (엎드린 자세는 귀처럼 보여서 버림)

type BabyMood = 'awake' | 'sleep' | 'cry0' | 'cry1';

/** 얼굴 무늬 (px, 윤곽선 없음). cx, cy = 머리 중심 (화면), look = 고개 돌림 (-1 왼쪽 ~ 1 오른쪽, 0.5 정도면 3/4 얼굴) */
function babyFace(cx: number, cy: number, mood: BabyMood, z: number, look = 0): Prim[] {
  const x = Math.round(cx - 0.5), y = Math.round(cy - 0.5);
  const o = Math.round(look * 1.6);
  const prims: Prim[] = [];
  const P = (pts: Array<[number, number]>, shade: number, mat: Mat = 'skin'): Prim => ({ kind: 'px', pts, shade, z, group: 99, mat, noEdge: true });
  const eyes = [x - 2 + o, x + 2 + o];
  // 볼 (발그레, 2px), 고개 돌린 쪽 볼은 가려짐
  const cheeks: Array<[number, number]> = [];
  if (look > -0.3) cheeks.push([x + 3 + o, y + 2], [x + 4 + o, y + 2]);
  if (look < 0.3) cheeks.push([x - 4 + o, y + 2], [x - 3 + o, y + 2]);
  if (mood === 'awake') {
    for (const ex of eyes) prims.push(P([[ex, y], [ex, y + 1]], 0));
    prims.push(P([[x + o, y + 3]], 1));
    prims.push(P(cheeks, 2));
  } else if (mood === 'sleep') {
    prims.push(P([[eyes[0] - 1, y + 1], [eyes[0], y + 1], [eyes[1], y + 1], [eyes[1] + 1, y + 1]], 1));
    prims.push(P([[x + o, y + 3]], 2));
    prims.push(P(cheeks, 2));
  } else {
    // 울음: 꼭 감은 눈 (> <), 벌린 입, 눈물
    const wide = mood === 'cry1';
    prims.push(P([[eyes[0] - 1, y], [eyes[0], y + 1], [eyes[0] - 1, y + 1]], 0));
    prims.push(P([[eyes[1] + 1, y], [eyes[1], y + 1], [eyes[1] + 1, y + 1]], 0));
    const mouth: Array<[number, number]> = wide
      ? [[x - 1 + o, y + 3], [x + o, y + 3], [x + 1 + o, y + 3], [x - 1 + o, y + 4], [x + o, y + 4], [x + 1 + o, y + 4]]
      : [[x + o, y + 3], [x + 1 + o, y + 3], [x + o, y + 4], [x + 1 + o, y + 4]];
    prims.push(P(mouth, 0));
    prims.push(P([[x + o, y + 3]], 1));
    prims.push(P(cheeks, 2));
    const t = wide ? 1 : 0;
    const tears: Array<[number, number]> = [];
    if (look < 0.3) tears.push([eyes[0] - 2, y + 1 + t], [eyes[0] - 2, y + 2 + t]);
    if (look > -0.3) tears.push([eyes[1] + 2, y + 1 + t], [eyes[1] + 2, y + 2 + t]);
    prims.push(P(tears, 3, 'tear'));
  }
  return prims;
}

/** 두건 두른 머리: 두건(머리보다 조금 큰 타원, 뒤) + 얼굴 + 이마 머리카락 한 줌. 두건 위쪽은 둥근 테두리뿐 */
function hoodedHead(cx: number, cy: number, r: number, mood: BabyMood, look = 0): Prim[] {
  const x = Math.round(cx - 0.5), y = Math.round(cy - 0.5);
  const o = Math.round(look * 1.6);
  return [
    { kind: 'ellipse', cx: cx - look * 0.6, cy: cy - 0.7, rx: r + 1.5, ry: r + 1.4, z: 2, group: 1, mat: 'cloth', bias: -0.2 },
    { kind: 'ellipse', cx, cy, rx: r, ry: r * 0.96, z: 3, group: 2, mat: 'skin', bias: 0.5 },
    { kind: 'px', pts: [[x - 1 + o, y - 4], [x + o, y - 4], [x + o, y - 5], [x + 1 + o, y - 4]], shade: 3, z: 3.5, group: 2, mat: 'hair', noEdge: true },
    ...babyFace(cx, cy, mood, 10, look),
  ];
}

/** 강보 몸통: 타원 + 접힌 선 2개(천 어두운 단) + 두르는 띠 (accent 색, mat 레이어) */
function swaddle(cx: number, cy: number, rx: number, ry: number, bandX: number, z = 1): Prim[] {
  return [
    { kind: 'ellipse', cx, cy, rx, ry, z, group: 1, mat: 'cloth' },
    { kind: 'capsule', ax: cx - rx * 0.55, ay: cy - ry * 0.75, bx: cx - rx * 0.1, by: cy + ry * 0.8, ra: 0.5, rb: 0.5, z: z + 0.1, group: 1, mat: 'cloth', shade: 2, noEdge: true },
    { kind: 'capsule', ax: cx + rx * 0.45, ay: cy - ry * 0.7, bx: cx + rx * 0.8, by: cy + ry * 0.3, ra: 0.5, rb: 0.5, z: z + 0.1, group: 1, mat: 'cloth', shade: 2, noEdge: true },
    { kind: 'capsule', ax: bandX + 0.6, ay: cy - ry + 0.9, bx: bandX - 0.6, by: cy + ry - 0.9, ra: 1.25, rb: 1.25, z: z + 0.2, group: 3, mat: 'mat', edgeShade: 1 },
  ];
}

/** 누운 강보 (요람): 머리 왼쪽 */
function babyCradle(breath: number, mood: BabyMood): Prim[] {
  const up = mood === 'cry1' ? 1 : 0;
  const pr: Prim[] = [
    ...swaddle(35.2, 55.4 - breath * 0.4, 10, 5.1 + breath * 0.45, 38.5),
    ...hoodedHead(24.6, 53.8 - up, 5.4, mood),
  ];
  // 울 때 강보 밖으로 나온 주먹
  if (mood.startsWith('cry')) pr.push({ kind: 'ellipse', cx: 31.4, cy: 50.6 - up, rx: 1.7, ry: 1.6, z: 4, group: 4, mat: 'skin' });
  return pr;
}

/** 바닥 깔개 (6~12개월, 배내옷): 앉아서 팔 흔들고 발 까딱. 앞모습 */
function babyFloor(f: number, mood: BabyMood): Prim[] {
  const cry = mood.startsWith('cry');
  const up = mood === 'cry1' ? 1 : 0;
  const pr: Prim[] = [
    // 깔개 (누빈 천, accent 색)
    { kind: 'poly', pts: [[18, 54], [46, 54], [48, 61], [16, 61]], z: 0, group: 0, mat: 'mat', shade: 4 },
    { kind: 'poly', pts: [[16.2, 59.8], [47.8, 59.8], [48, 61], [16, 61]], z: 0.02, group: 0, mat: 'mat', shade: 3, noEdge: true },
    { kind: 'px', pts: [[19, 57], [20, 57], [22, 57], [23, 57], [41, 57], [42, 57], [44, 57], [45, 57]], z: 0.05, group: 0, mat: 'mat', shade: 3 },
    // 몸 (배내옷)
    { kind: 'ellipse', cx: 32, cy: 53.4, rx: 5.4, ry: 4.7, z: 2, group: 1, mat: 'cloth' },
    { kind: 'capsule', ax: 29.6, ay: 51.2, bx: 30.4, by: 57.2, ra: 0.5, rb: 0.5, z: 2.1, group: 1, mat: 'cloth', shade: 2, noEdge: true },
  ];
  // 다리: 앞으로 뻗고 발끝이 위 (한 발씩 까딱)
  for (let i = 0; i < 2; i++) {
    const sg = i === 0 ? -1 : 1;
    const kick = (f === i ? 1 : 0) * (cry ? 1.4 : 0.9);
    const hx = 32 + sg * 2.4, hy = 57;
    const fx = 32 + sg * 5.6, fy = 59.4 - kick;
    pr.push({ kind: 'capsule', ax: hx, ay: hy, bx: fx, by: fy, ra: 2.0, rb: 1.7, z: 2.5, group: 20 + i, mat: 'skin', bias: 0.2 });
    pr.push({ kind: 'ellipse', cx: fx + sg * 0.8, cy: fy - 0.8, rx: 1.5, ry: 1.8, z: 2.6, group: 20 + i, mat: 'skin', bias: 0.4 });
  }
  // 팔: 짧은 소매 → 손. 한 손씩 흔듦 (울 땐 둘 다 위로)
  for (let i = 0; i < 2; i++) {
    const sg = i === 0 ? -1 : 1;
    const wave = cry ? (f === i ? 1 : 0.6) : f === i ? 1 : 0;
    const sx = 32 + sg * 4.4, sy = 50.6;
    const hx = 32 + sg * (5.8 + wave * 0.4), hy = 55.4 - wave * 4.4;
    const mx = (sx + hx) / 2, my = (sy + hy) / 2;
    pr.push({ kind: 'capsule', ax: sx, ay: sy, bx: mx, by: my, ra: 1.7, rb: 1.5, z: 3, group: 10 + i, mat: 'cloth' });
    pr.push({ kind: 'capsule', ax: mx, ay: my, bx: hx, by: hy, ra: 1.4, rb: 1.3, z: 3.01, group: 10 + i, mat: 'skin' });
    pr.push({ kind: 'ellipse', cx: hx, cy: hy, rx: 1.6, ry: 1.5, z: 3.02, group: 10 + i, mat: 'skin' });
  }
  // 머리: 두건 없음, 정수리 머리카락 한 가닥
  const hx = 32, hy = 45.3 - up;
  const y = Math.round(hy - 0.5);
  pr.push({ kind: 'ellipse', cx: hx, cy: hy, rx: 5.8, ry: 5.5, z: 4, group: 2, mat: 'skin', bias: 0.5 });
  pr.push({ kind: 'px', pts: [[30, y - 4], [31, y - 4], [32, y - 4], [33, y - 4], [31, y - 5], [32, y - 5], [32, y - 6]], shade: 3, z: 4.5, group: 2, mat: 'hair', noEdge: true });
  pr.push(...babyFace(hx, hy + 0.4, mood, 10));
  return pr;
}

/** 품 안 (어른 칸 좌표, 안는 자세 팔 높이 38~45 에 맞춤) */
function babyHeld(dir: Facing, breath: number, mood: BabyMood): Prim[] {
  const b = breath;
  const up = mood === 'cry1' ? 1 : 0;
  const cry = mood.startsWith('cry');
  if (dir === 'down') {
    return [
      ...swaddle(35.2, 41.2 - b * 0.4, 9.4, 4.8 + b * 0.4, 38.8),
      ...hoodedHead(25.2, 39.8 - up, 5.2, mood),
      ...(cry ? [{ kind: 'ellipse', cx: 31.8, cy: 36.8 - up, rx: 1.6, ry: 1.5, z: 4, group: 4, mat: 'skin' } as Prim] : []),
    ];
  }
  if (dir === 'left' || dir === 'right') {
    const m = dir === 'left' ? 1 : -1;
    const X = (x: number) => (m > 0 ? x : 63 - x);
    return [
      ...swaddle(X(28.8), 41.6 - b * 0.4, 6.6, 4.5 + b * 0.4, X(30.8)),
      ...hoodedHead(X(22.0), 39.6 - up, 5.0, mood, m > 0 ? -0.45 : 0.45),
    ];
  }
  // up: 어깨 너머 뒤통수 (어른 뒤에 그림)
  return [
    { kind: 'ellipse', cx: 44.2, cy: 34.0 - b * 0.3, rx: 4.8, ry: 3.4, z: 1, group: 1, mat: 'cloth' },
    { kind: 'ellipse', cx: 44.4, cy: 28.2 - up, rx: 5.4, ry: 5.2, z: 2, group: 1, mat: 'cloth', bias: -0.2 },
    { kind: 'ellipse', cx: 44.4, cy: 29.0 - up, rx: 3.6, ry: 3.4, z: 3, group: 2, mat: 'hair', bias: 0.3 },
  ];
}

const B_COLS = 4, B_ROWS = 6;
function genBaby(): Record<string, unknown> {
  const W = B_COLS * F, H = B_ROWS * F;
  const L: Record<string, Img> = { body: newImg(W, H), swaddle: newImg(W, H), hair: newImg(W, H), mat: newImg(W, H), tears: newImg(W, H) };
  const draw = (prims: Prim[], col: number, row: number) => {
    const buf = rasterize(prims);
    outline(buf);
    layerImage(buf, 'skin', RAMP.skin, L.body, col * F, row * F);
    layerImage(buf, 'cloth', RAMP.cloth, L.swaddle, col * F, row * F);
    layerImage(buf, 'hair', RAMP.hair, L.hair, col * F, row * F);
    layerImage(buf, 'mat', RAMP.mat, L.mat, col * F, row * F);
    layerImage(buf, 'tear', RAMP.tear, L.tears, col * F, row * F);
  };
  for (let f = 0; f < 2; f++) {
    draw(babyCradle(f, 'sleep'), f, 0);
    draw(babyCradle(f, f ? 'cry1' : 'cry0'), 2 + f, 0);
    draw(babyFloor(f, 'awake'), f, 1);
    draw(babyFloor(f, f ? 'cry1' : 'cry0'), 2 + f, 1);
    DIRS.forEach((d, di) => {
      draw(babyHeld(d, f, 'awake'), f, 2 + di);
      draw(babyHeld(d, f, f ? 'cry1' : 'cry0'), 2 + f, 2 + di);
    });
  }
  mkdirSync(`${OUT}baby`, { recursive: true });
  for (const [k, img] of Object.entries(L)) writePng(`${OUT}baby/${k}.png`, img);
  return {
    cradle: { row: 0, col: 0, frames: 2, fps: 1, loop: true, dirs: ['down'] },
    cradle_cry: { row: 0, col: 2, frames: 2, fps: 4, loop: true, dirs: ['down'] },
    floor: { row: 1, col: 0, frames: 2, fps: 2, loop: true, dirs: ['down'] },
    floor_cry: { row: 1, col: 2, frames: 2, fps: 4, loop: true, dirs: ['down'] },
    held: { row: 2, col: 0, frames: 2, fps: 1, loop: true, dirs: DIRS },
    held_cry: { row: 2, col: 2, frames: 2, fps: 4, loop: true, dirs: DIRS },
  };
}

// ====================================================================== main

function main() {
  const babyAnims = genBaby();
  const t = genToddler();
  const { _hairs, ...toddlerAnims } = t.anims as Record<string, unknown> & { _hairs: Record<string, string> };
  const skin = pack.palettes.body.source;
  const cloth = pack.palettes.cloth.source;
  const section = {
    _comment: 'Generated by tools/lpc/gen-infant.ts. Every layer is one sheet in the same cell layout (64px cells, anchor = feet/bottom contact point). anims: row = first direction row (dirs order), col = first column. Recolour: palette swap from `source` to the person\'s ramp (lpc.palettes[material]).',
    frameW: F, frameH: F, anchorX: 32, anchorY: 62,
    baby: {
      cols: B_COLS, rows: B_ROWS,
      layers: [
        { id: 'baby_mat', path: 'infant/baby/mat.png', z: 35, recolor: [{ material: 'cloth', source: cloth, role: 'accent' }] },
        { id: 'baby_body', path: 'infant/baby/body.png', z: 10, recolor: [{ material: 'body', source: skin, role: 'skin' }] },
        { id: 'baby_swaddle', path: 'infant/baby/swaddle.png', z: 30, recolor: [{ material: 'cloth', source: cloth, role: 'swaddle' }] },
        { id: 'baby_hair', path: 'infant/baby/hair.png', z: 40, recolor: [{ material: 'hair', source: pack.palettes.hair.source, role: 'hair' }] },
        { id: 'baby_tears', path: 'infant/baby/tears.png', z: 50 },
      ],
      anims: babyAnims,
      place: {
        cradle: { lift: 9, note: 'draw the cradle frame lift px above the baby position (mattress height of a cradle object)' },
        floor: { lift: 0 },
        held: {
          note: 'frames are in the holder\'s 64px frame coordinates (carry pose arms at rows 38-45); draw at the holder sprite rect + holder carry bob',
          front: { up: false, left: true, down: true, right: true },
          dy: { male: 0, female: 0, teen: 0, pregnant: 0, muscular: 0 },
          seatedDy: 6,
        },
      },
    },
    toddler: {
      cols: T_COLS, rows: T_ROWS,
      layers: [
        { id: 'toddler_body', path: 'infant/toddler/body.png', z: 10, recolor: [{ material: 'body', source: skin, role: 'skin' }] },
        { id: 'toddler_head', path: 'infant/toddler/head.png', z: 100, recolor: [{ material: 'body', source: skin, role: 'skin' }, { material: 'eye', source: pack.palettes.eye.source, role: 'eye' }] },
        { id: 'toddler_face_closed', path: 'infant/toddler/face_closed.png', z: 101, recolor: [{ material: 'body', source: skin, role: 'skin' }] },
      ],
      garments: Object.fromEntries(GARMENTS.map((g) => [g, { path: `infant/toddler/${g}.png`, z: 35, recolor: [{ material: 'cloth', source: cloth, role: 'main' }] }])),
      /** 신분별 옷: 농노/자유민/성직자 = 배내 겉옷(smock), 장인 = 짧은 튜닉, 상인/기사/귀족 = 긴 옷(gown) */
      estateGarment: { serf: 'smock', freeman: 'smock', artisan: 'tunic', merchant: 'gown', clergy: 'smock', knight: 'gown', noble: 'gown' },
      hair: Object.fromEntries(Object.entries(_hairs).map(([id, path]) => [id, { path, z: 120, recolor: [{ material: 'hair', source: pack.palettes.hair.source, role: 'hair' }] }])),
      anims: toddlerAnims,
      sleepCropY: 44,
      heads: t.heads.map((h) => ({ col: h.col, row: h.row, dir: DIRS[h.srcDir], dx: h.dx, dy: h.dy, masked: !!h.mask })),
    },
    credits: [
      { file: 'infant/baby/', authors: ['Hearth & Kin (pixel-edit script tools/lpc/gen-infant.ts)'], licenses: ['CC-BY-SA 3.0'], note: 'drawn from scratch in LPC palette ramps' },
      { file: 'infant/toddler/', authors: ['Hearth & Kin (pixel-edit script tools/lpc/gen-infant.ts)', 'LPC child head/hair: see heads_human_child and hair_* credits'], licenses: ['CC-BY-SA 3.0'], note: 'body/garments drawn by script; head.png, face_closed.png, hair/*.png are re-positioned copies of LPC child head/hair frames (idle 0)' },
    ],
  };
  writeFileSync(`${OUT}infant.json`, JSON.stringify(section, null, 1) + '\n');
  console.log(`wrote baby (${B_COLS}x${B_ROWS}) + toddler (${T_COLS}x${T_ROWS}, ${Object.keys(_hairs).length} hair sheets) to ${OUT}`);
}

main();
