/**
 * 해안 성곽 도시 배치 v4 (사용자 지정 레퍼런스 "해안 성곽 도시" 구도를 칸으로 옮김):
 * - 북쪽 끝: 성벽 밖 밭, 북쪽 성벽(돌 절벽 둑) 가로질러, 오른쪽으로 꺾여 내려옴
 * - 위쪽 절반: 빽빽한 마을. 위 가운데 교회, 가운데-왼쪽 장터 광장, 오른쪽 위 원형 광장
 * - 오른쪽 아래: 바위 절벽 위 성 (해자 호수가 둘러쌈), 바다로 튀어나온 곶
 * - 왼쪽 아래: 해안을 따라가는 둑길(돌 둑) + 성문, 왼쪽 끝 부두
 * - 남쪽: 바다
 *   npx tsx tools/world/town-layout.ts  → artifacts/qa/visual/layout-a.json (미리보기: preview-lot.ts)
 */
import fs from 'node:fs';
import { Rng } from '../../src/sim/core/rng';
import { H, Terrain, W, type P } from './town-terrain';

const t = new Terrain(new Rng(20260929));
const rng = new Rng(4242);
const rnd = () => rng.next();
const style = new Array(W * H).fill(0);
const I = (x: number, y: number) => y * W + x;
/** 성벽을 y 12 → 26 으로 당김 (성벽 밖 북쪽 = 교외 농가/밭). y 76 이하 마을 좌표를 눌러 옮김 */
const WALL_Y = 26;
const Y = (y: number) => (y > 76 ? y : Math.round((WALL_Y + ((y - 12) * (76 - WALL_Y)) / 64) * 10) / 10);
const YP = (pts: P[]): P[] => pts.map(([x, y]) => [x, Y(y)]);

// ============ 1. 땅/바다 윤곽: 해안선 (남쪽 바다), 성 곶
const coast = (x: number) => 105 + 4 * Math.sin(x / 26) + 1.5 * Math.sin(x / 11 + 1);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const cy = coast(x);
  const cape = Math.hypot((x - 158) / 30, (y - 112) / 22) < 1 + 0.08 * Math.sin(Math.atan2(y - 112, x - 158) * 5);
  if (y > cy && !cape) {
    t.ground[I(x, y)] = 'water';
    t.use[I(x, y)] = 2;
  }
}
// ============ 2. 높이: 마을 대지 1 (해안 바위 절벽), 성 언덕 2
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (t.ground[I(x, y)] !== 'water') {
  t.elev[I(x, y)] = 1;
  style[I(x, y)] = 1;
}
// 성 곶은 마을과 같은 높이 1 (성벽만 2)
// 해자: 성 언덕 북쪽을 두르는 물 (바다와 이어짐)
const moat: P[] = [[112, 106], [116, 92], [124, 82], [138, 76], [156, 74], [174, 76], [186, 84], [194, 96]];
t.stroke(moat, 5, 'water', { force: true, use: 2, wobble: 0.8, seed: 3 });
for (let i = 0; i < W * H; i++) if (t.ground[i] === 'water') t.elev[i] = 0;
t.smoothElev(6);
t.smoothWater();

// ============ 3. 성벽 (돌 둑, 마을보다 한 단 높음)
const wall = (pts: P[], w: number) => {
  const cells = t.stroke(pts, w, 'dirt2', { use: 3 });
  for (const i of cells) if (t.ground[i] !== 'water') {
    t.elev[i] = 2;
    style[i] = 2;
  }
};
wall(YP([[-2, 12], [40, 11], [80, 12], [120, 11], [160, 12], [191, 13]]), 3);
wall(YP([[191, 13], [191, 40], [190, 62], [191, 80]]), 3);
const gate = (x0: number, y0: number, x1: number, y1: number) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    t.elev[I(x, y)] = 1;
    t.ground[I(x, y)] = 'dirt';
    t.use[I(x, y)] = 1;
  }
};
gate(95, WALL_Y - 4, 99, WALL_Y + 3);
gate(187, Math.round(Y(43)), 195, Math.round(Y(47)));

// ============ 3b. 성벽: 곧은 네모 (x 132~184, y 90~118), 두께 2, 높이 3. 북쪽 가운데 성문
const castleRing: number[] = [];
const CR = { x0: 132, y0: 90, x1: 184, y1: 118 };
for (let y = CR.y0; y <= CR.y1; y++) for (let x = CR.x0; x <= CR.x1; x++) {
  const edge = x - CR.x0 < 2 || CR.x1 - x < 2 || y - CR.y0 < 2 || CR.y1 - y < 2;
  if (!edge || t.e(x, y) < 1 || t.g(x, y) === 'water') continue;
  if (y - CR.y0 < 2 && x >= 155 && x <= 159) continue; // 북문
  const i = I(x, y);
  castleRing.push(i);
  t.elev[i] = 2;
  style[i] = 2;
  t.ground[i] = 'dirt2';
  t.use[i] = 3;
}
// 성 안마당 + 북문 앞 길 → 다리
for (let y = CR.y0 + 2; y <= CR.y1 - 5; y++) for (let x = CR.x0 + 2; x <= CR.x1 - 2; x++) if (t.e(x, y) === 1) { t.ground[I(x, y)] = (x - CR.x0 < 4 || CR.x1 - x < 4 || y - CR.y0 < 4) ? 'dirt' : 'dirt'; t.use[I(x, y)] = 1; }
// ============ 4. 해안 둑길
const cw = t.stroke([[0, 105], [20, 106], [44, 104], [70, 102], [96, 101], [112, 101]], 1.6, 'dirt', { force: true, use: 1 });
for (const i of cw) {
  t.elev[i] = 1;
  style[i] = 1;
}

// ============ 4b. 랜드마크 자리 예약 (거리보다 먼저): [외관, x, 아래 줄, 높이]
const SH0 = JSON.parse(fs.readFileSync('src/data/artpacks/shells.json', 'utf8')).shells as Record<string, { w: number; h: number; foot: [number, number]; door: number }>;
const LAND: [string, number, number, number][] = [
  ['s27', 82, Math.round(Y(23)), 1], // 교회 (북문 옆 윗동네)
  ['s40', 145, 110, 1], // 성 본관
  ['s17', 170, 104, 1], // 성 탑 건물
  ['s30', 150, Math.round(Y(26)), 1], // 원형 광장 옆 예배당
  ['s31', 30, Math.round(Y(57)), 1], // 여관
  ['s24', 70, Math.round(Y(48)), 1], // 공방
  ['s28', 6, 99, 1], // 부두 창고 (목욕탕)
];
for (const [id, x, b] of LAND) {
  const s0 = SH0[id];
  for (let y = b - s0.foot[1] + 1; y <= b + 1; y++) for (let xx = x - 1; xx <= x + Math.ceil(s0.w / 32); xx++) if (t.inb(xx, y)) t.use[I(xx, y)] = 3;
  // 문 앞 길
  for (let y = b + 1; y <= b + 3; y++) if (t.inb(x + s0.door, y)) { t.ground[I(x + s0.door, y)] = 'dirt'; t.use[I(x + s0.door, y)] = 5; }
}
const KEEP = [3, 5];
// ============ 4c. 마을을 가로지르는 강 (동쪽 성벽 밑으로 들어와 장터 남쪽을 돌아 남서 바다로). 마을과 같은 높이 → 낮은 강둑
const riverCells = t.stroke(YP([[201, 50], [186, 53], [172, 49], [158, 44], [142, 50], [126, 56], [110, 57], [96, 62], [86, 68], [78, 78], [68, 86], [58, 92], [48, 100], [42, 110]]), 7, 'water', { force: true, use: 2, wobble: 1.5, seed: 9, keep: KEEP });
for (const i of riverCells) if (t.ground[i] === 'water' && style[i] === 2) style[i] = 1;
t.smoothWater();
// ============ 5. 거리 (붉은 자갈), 광장
const street = (pts: P[], w: number, id = w >= 3 ? 'dirt' : 'dirt') => {
  const cells = t.stroke(YP(pts), w >= 3 ? 1.8 : 1.1, id, { use: 1, keep: KEEP });
  // 큰길이 강을 건너는 칸 = 돌다리
  for (const i of cells) if (t.ground[i] === 'water' && w >= 3) { t.ground[i] = 'dirt'; t.use[i] = 1; }
  return cells;
};
// 동서로 굽은 골목 (집이 줄지어 서게, 11줄 간격)
for (let ly = 36; ly <= 96; ly += 10) {
  const pts: P[] = [];
  for (let x = 2; x <= 188; x += 9) pts.push([x, ly + Math.sin(x / 15 + ly) * 1.6 + (rnd() - 0.5) * 1.2]);
  t.stroke(pts, 0.85, 'dirt', { use: 1, keep: KEEP });
}
street([[97, 14], [96, 22], [92, 32], [84, 42], [70, 52], [62, 60], [58, 72], [60, 86], [66, 96], [80, 100]], 3);
street([[62, 58], [80, 56], [100, 50], [118, 42], [136, 34], [156, 30], [174, 36], [190, 45]], 3);
street([[70, 60], [86, 66], [104, 70], [124, 70], [144, 68], [157, 70]], 3);
street([[62, 58], [46, 50], [30, 42], [14, 36], [2, 34]], 2);
street([[58, 72], [40, 74], [22, 80], [6, 84]], 2);
street([[60, 86], [44, 92], [28, 96]], 2);
street([[96, 22], [112, 24], [130, 22], [150, 20], [172, 22]], 2);
street([[118, 42], [120, 30], [118, 24]], 2);
street([[146, 32], [150, 44], [146, 56], [138, 66]], 2);
street([[100, 50], [104, 60], [100, 70]], 2);
street([[84, 42], [72, 34], [60, 26], [44, 20], [24, 18]], 2);
street([[30, 42], [32, 56], [40, 74]], 2);
t.blob(60, Y(62), 9, 6, 'slab', 0.24, 1);
t.blob(160, Y(30), 8, 5, 'slab', 0.26, 1);
t.blob(94, Y(20), 8, 3, 'dirt', 0.1, 1);
// 성 다리 (해자 건너)
for (let y = 70; y <= 90; y++) for (let x = 155; x <= 159; x++) {
  t.ground[I(x, y)] = 'dirt';
  t.use[I(x, y)] = 1;
  t.elev[I(x, y)] = 1;
}


// 지도 가장자리 출구 길: 북문 → 위, 동문 → 오른쪽
for (let y = 0; y <= WALL_Y - 4; y++) for (let x = 96; x <= 98; x++) { t.ground[I(x, y)] = 'dirt'; t.use[I(x, y)] = 1; }
for (let x = 192; x < W; x++) for (let y = Math.round(Y(43)); y <= Math.round(Y(47)); y++) { t.ground[I(x, y)] = 'dirt'; t.use[I(x, y)] = 1; t.elev[I(x, y)] = 1; }
// ============ 6. 비탈
// eslint-disable-next-line
export function southEdge(x: number, lv: number, from: number): number {
  for (let y = from; y < H - 1; y++) if (t.e(x, y) >= lv && t.e(x, y + 1) < lv) return y + 1;
  return -1;
}


// ============ 7. 성벽 밖 교외 (05 농장과 헛간, 03 Grass Land): 농가 마당 + 헛간 + 울타리 두른 밭 + 흙길 + 연못
export const fences: { x0: number; y0: number; x1: number; y1: number; style: string }[] = [];
export const farmObjs: { id: string; x: number; y: number; rot?: number }[] = [];
const farmShells: { id: string; x: number; y: number; tag: string }[] = [];
const FY = WALL_Y - 3; // 교외 끝 줄 (성벽 바로 위)
// 교외 흙길: 북문 길에서 동서로 굽이
t.stroke([[-1, 14], [30, 12], [60, 15], [96, 13], [130, 15], [165, 12], [201, 14]], 1.8, 'dirt', { use: 1, wobble: 0.6, seed: 21 });
// 밭 (울타리 안 흙 + 밭 구획), 농가 마당
const fields: [number, number, number, number][] = [[4, 2, 22, 10], [110, 2, 126, 10], [170, 17, 190, FY], [40, 17, 58, FY]];
for (const [x0, y0, x1, y1] of fields) {
  // 밭흙은 울타리 안에서 가장자리를 잡음으로 들쭉날쭉하게 (네모로 끊기지 않게), 바깥 둘레는 키 큰 풀
  for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
    const edge = Math.min(x - x0, x1 - x, y - y0, y1 - y);
    const n = t.noise.value(x * 0.7, y * 0.9);
    if (edge >= 1 || (edge === 0 && n > 0.35)) { t.ground[I(x, y)] = 'soil'; t.use[I(x, y)] = 4; }
    else if (edge < 0 && n > 0.45) t.use[I(x, y)] = 4;
  }
  fences.push({ x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y0 - 1, style: 'fence_wood' }, { x0: x0 - 1, y0: y1 + 1, x1: x1 + 1, y1: y1 + 1, style: 'fence_wood' });
  fences.push({ x0: x0 - 1, y0, x1: x0 - 1, y1, style: 'fence_wood' }, { x0: x1 + 1, y0, x1: x1 + 1, y1: y1 - 2, style: 'fence_wood' });
  for (let y = y0; y + 1 <= y1; y += 3) for (let x = x0; x + 2 <= x1; x += 4) farmObjs.push({ id: 'field_plot', x, y });
  farmObjs.push({ id: 'scarecrow', x: Math.round((x0 + x1) / 2), y: y1 });
}
// 농가: [헛간/집 외관, x, 아래 줄]
const farmsteads: [string, number, number, string][] = [
  ['s8', 26, 11, 'barn'], ['s23', 62, 11, 'farmhouse'], ['s36', 70, 11, 'shed'], ['s16', 132, 11, 'barn'], ['s10', 150, 11, 'farmhouse'], ['s35', 158, 11, 'shed'], ['s34', 64, FY - 3, 'barn'], ['s37', 160, FY - 1, 'shed'],
];
for (const [id, x, b, tag] of farmsteads) {
  const s0 = SH0[id];
  if (!s0) continue;
  farmShells.push({ id, x, y: b - s0.foot[1] + 1, tag });
  for (let y = b - s0.foot[1] + 1; y <= b; y++) for (let xx = x; xx < x + s0.foot[0]; xx++) t.use[I(xx, y)] = 3;
  // 마당 (흙) + 건초/통/장작/물통
  for (let y = b + 1; y <= b + 2; y++) for (let xx = x - 1; xx <= x + s0.foot[0]; xx++) if (t.use[I(xx, y)] !== 1) { t.ground[I(xx, y)] = 'dirt2'; t.use[I(xx, y)] = 6; }
  const yard = ['hay_bales', 'trough_hay', 'woodpile_logs', 'barrel_rain', 'hay_bale_round', 'crate_stack', 'chopping_block', 'beehive_skep'];
  // 마당 소품은 건물 앞 마당 줄 (벽 위에 떠 보이지 않게)
  farmObjs.push({ id: yard[(x + b) % yard.length], x: x + s0.foot[0] - 3, y: b + 1 }, { id: yard[(x * 3 + b) % yard.length], x: x, y: b + 1 }, { id: yard[(x * 5 + b) % yard.length], x: x + 2, y: b + 2 });
}
// 연못과 과수 몇 그루
t.blob(88, 6, 5, 3, 'water', 0.3, 2, true);
for (const [x, y] of [[80, 18], [84, 19], [118, 18], [122, 19], [184, 5], [190, 7]] as P[]) farmObjs.push({ id: 'orchard_tree', x, y });
// 나머지 교외 풀: 밀밭 느낌 키 큰 풀 덩어리
for (let y = 0; y < FY; y++) for (let x = 0; x < W; x++) {
  const i = I(x, y);
  if (t.use[i] || t.ground[i] !== 'grass') continue;
  if (t.noise.fbm(x / 8 + 7, y / 6, 2) > 0.6) t.ground[i] = 'grass_mid';
}
// ============ 7b. 물가 완충 띠: 물에 닿은 빈 땅 1~2칸은 모래/키 큰 풀 (돌 테두리 한 줄만 반복되지 않게)
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const i = I(x, y);
  if (t.ground[i] === 'water' || t.use[i] === 1 || t.use[i] === 3 || t.use[i] === 5) continue;
  let d = 9;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (t.g(x + dx, y + dy) === 'water' && t.e(x + dx, y + dy) >= t.e(x, y) - 0) d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy)));
  if (d > 2) continue;
  // 절벽 위(높이 차)는 제외: 같은 높이 물가만
  const n = t.noise.value(x * 0.45, y * 0.45);
  if (d === 1 && n > 0.25) t.ground[i] = 'sand';
  else if (d === 2 && n > 0.55) t.ground[i] = n > 0.75 ? 'sand' : 'grass_light';
}
// 물가 소품 (통, 상자, 그물 말뚝 대신 장작/통나무, 바위, 낚시터): make-town2 가 놓음
export const shoreProps: { id: string; x: number; y: number }[] = [];
for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
  if (t.g(x, y) !== 'sand' || t.use[I(x, y)]) continue;
  const r = t.noise.value(x * 3.1, y * 2.7);
  if (r > 0.86) shoreProps.push({ id: ['barrel_closed', 'crate_plain', 'rock_small', 'log_fallen', 'barrel_pair', 'crate_stack', 'rock_big', 'sacks_pile'][Math.floor(r * 997) % 8], x, y });
}
// ============ 8. 풀 명암
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = I(x, y);
  if (t.ground[i] !== 'grass' || t.use[i]) continue;
  const n = t.noise.fbm(x / 12, y / 12, 3);
  if (n > 0.66) t.ground[i] = 'grass_mid';
  else if (n < 0.34) t.ground[i] = 'grass_light';
}

// ============ 9. 건물
const SH = JSON.parse(fs.readFileSync('src/data/artpacks/shells.json', 'utf8')).shells as Record<string, { role: string; size: string; w: number; h: number; foot: [number, number]; door: number }>;
const shells: { id: string; x: number; y: number; tag?: string }[] = [];
const foot = new Uint8Array(W * H);
const cols = (id: string) => Math.ceil(SH[id].w / 32);
function fits(id: string, x: number, bottom: number, lv: number): boolean {
  const s = SH[id];
  for (let y = bottom - s.foot[1] + 1; y <= bottom; y++) for (let xx = x; xx < x + cols(id); xx++) {
    if (!t.inb(xx, y)) return false;
    const i = I(xx, y);
    if (foot[i] || t.use[i] === 1 || t.use[i] === 2 || t.use[i] === 3 || t.e(xx, y) !== lv) return false;
  }
  if (bottom - Math.ceil(s.h / 32) + 1 < 0) return false;
  // 옆집과 한 칸 띄움 (벽을 같이 쓰면 실내 벽이 이어져 끊겨 보임), 지붕 그림이 덮는 위쪽 줄에는 다른 집 발자국 없음
  const top = bottom - Math.ceil(s.h / 32) + 1;
  for (let y = top - 1; y <= bottom + 1; y++) for (let xx = x - 1; xx <= x + cols(id); xx++) {
    if (t.inb(xx, y) && foot[I(xx, y)]) return false;
  }
  if (bottom - s.foot[1] + 1 <= WALL_Y + 2) return false;
  // 해자와 성벽 사이 띠(문이 성벽을 향함)에는 집을 짓지 않음
  if (x + cols(id) > 112 && bottom >= 76 && bottom <= CR.y1 + 2) return false;
  return true;
}
function frontage(id: string, x: number, bottom: number): number {
  const dx = x + SH[id].door;
  for (let k = 1; k <= 3; k++) {
    if (!t.inb(dx, bottom + k)) return -1;
    const i = I(dx, bottom + k);
    if (t.use[i] === 1 || t.use[i] === 5) return k;
    if (t.use[i] === 2 || foot[i]) return -1;
  }
  return -1;
}
function place(id: string, x: number, bottom: number): void {
  const s = SH[id];
  // 발자국은 한 높이 (건물 안에 절벽이 끼면 실내 칸이 막힘): 문 앞 칸 높이로 고르고, 문 앞 길도 같은 높이
  const lv = t.e(x + s.door, bottom + 1);
  for (let y = bottom - s.foot[1] + 1; y <= bottom; y++) for (let xx = x; xx < x + cols(id); xx++) if (t.inb(xx, y)) t.elev[I(xx, y)] = lv;
  for (let y = bottom + 1; y <= bottom + 2; y++) if (t.inb(x + s.door, y)) t.elev[I(x + s.door, y)] = lv;
  for (let y = bottom - s.foot[1] + 1; y <= bottom; y++) for (let xx = x; xx < x + cols(id); xx++) { foot[I(xx, y)] = 1; t.use[I(xx, y)] = 3; }
  shells.push({ id, x, y: bottom - s.foot[1] + 1 });
  const dx = x + s.door;
  for (let y = bottom + 1; y < bottom + 4 && t.inb(dx, y) && t.use[I(dx, y)] !== 1; y++) { t.ground[I(dx, y)] = 'dirt'; t.use[I(dx, y)] = 1; }
}
const TAGS = ['church', 'castle', 'castle_tower', 'chapel', 'inn', 'guild_hall', 'bathhouse'];
LAND.forEach(([id, x, b], k) => {
  const s0 = SH[id];
  for (let y = b - s0.foot[1] + 1; y <= b; y++) for (let xx = x; xx < x + cols(id); xx++) t.use[I(xx, y)] = 0;
  place(id, x, b);
  shells[shells.length - 1].tag = TAGS[k];
});
// 도심: 풀지붕(s10 s23 s35~38)은 빼고 (들판 농가용)
const GRASSROOF = new Set(['s10', 's23', 's35', 's36', 's37', 's38', 's16', 's34']);
const houses = Object.keys(SH).filter((k) => ['house', 'townhouse'].includes(SH[k].role) && SH[k].size !== 'manor' && !GRASSROOF.has(k));
let n = 0;
for (let pass = 1; pass <= 3; pass++) for (let y = WALL_Y + 4; y < 100; y++) for (let x = 1; x < W - 2; x++) {
  const off = Math.floor(rnd() * houses.length);
  for (let k = 0; k < houses.length; k++) {
    const id = houses[(off + k) % houses.length];
    if (!fits(id, x, y, 1)) continue;
    const f = frontage(id, x, y);
    if (f < 0 || f > pass) continue;
    place(id, x, y);
    n++;
    break;
  }
}
console.log('집', n);

// ============ 10. 탑: 성벽 모퉁이/일정 간격, 성 언덕 둘레
const towerAt = (x: number, y: number) => { shells.push({ id: 'tower', x: x - 1, y: y - 2 }); for (let yy = y - 2; yy <= y; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (t.inb(xx, yy)) foot[I(xx, yy)] = 1; };
for (const [x, y] of [[8, 12], [40, 12], [70, 12], [128, 12], [160, 13], [191, 14], [191, 36], [191, 64]] as P[]) towerAt(x, Math.round(Y(y)));
for (const [x, y] of [[CR.x0 + 1, CR.y0 + 2], [CR.x1 - 1, CR.y0 + 2], [CR.x0 + 1, CR.y1], [CR.x1 - 1, CR.y1], [153, CR.y0 + 2], [161, CR.y0 + 2], [CR.x0 + 1, 104], [CR.x1 - 1, 104]] as P[]) towerAt(x, y);
// ============ 11. 나무/소품: 빈 풀밭 (마을 안은 드문드문, 성벽 밖·해안은 모여서)
const objects: { id: string; x: number; y: number }[] = [];
const TREES = ['tree_oak', 'tree_linden', 'tree_maple', 'tree_pine', 'tree_fir', 'tree_young', 'tree_elm', 'tree_pine_young'];
const free = (x: number, y: number, w: number, h: number) => {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    if (!t.inb(xx, yy)) return false;
    const i = I(xx, yy);
    if (t.use[i] || foot[i] || t.g(xx, yy) === 'water') return false;
    if (t.e(xx, yy) !== t.e(x, y + h - 1)) return false;
  }
  // 둘레 한 칸도 길/물/건물/광장이 아닌 풀 (자동 타일이 옆 칸까지 흙을 번지게 그리므로), 수관이 덮는 위 두 줄도 건물 아님
  for (let yy = y - 1; yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) {
    if (!t.inb(xx, yy)) continue;
    const i = I(xx, yy);
    if (t.use[i] === 1 || t.use[i] === 2 || t.use[i] === 5 || foot[i]) return false;
    if (!/^grass|^tallgrass/.test(t.g(xx, yy))) return false;
  }
  for (let yy = y - 3; yy < y; yy++) for (let xx = x; xx < x + w; xx++) if (t.inb(xx, yy) && foot[I(xx, yy)]) return false;
  // 절벽면 칸(아래 세 줄에 낮은 땅)이면 안 됨
  for (let dy = 1; dy <= 3; dy++) if (t.e(x, y + h - 1 + dy) < t.e(x, y + h - 1) || t.e(x + w - 1, y + h - 1 + dy) < t.e(x, y + h - 1)) return false;
  return true;
};
for (let y = 2; y < H - 2; y++) for (let x = 1; x < W - 2; x++) {
  const n = t.noise.fbm(x / 9 + 50, y / 9, 2);
  const inTown = y > WALL_Y && y < 104;
  if (x >= CR.x0 && x <= CR.x1 && y >= CR.y0 && y <= CR.y1) continue; // 성 안은 나무 없음
  const p = inTown ? (n > 0.6 ? 0.18 : 0.03) : n > 0.55 ? 0.35 : 0.04;
  if (rnd() > p) continue;
  const id = TREES[Math.floor(rnd() * TREES.length)];
  const big = ['tree_oak', 'tree_linden', 'tree_maple', 'tree_pine'].includes(id);
  const w = big ? 2 : 1, h = big ? 2 : 1;
  if (!free(x, y, w, h)) continue;
  objects.push({ id, x, y });
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) foot[I(xx, yy)] = 1;
}
// 장터: 노점, 분수, 수레
for (const [id, x, y] of [['market_stall_food', 54, 58], ['market_stall_cloth', 60, 57], ['market_stall_tools', 66, 58], ['market_stall_livestock', 55, 64], ['fountain', 61, 61], ['wagon', 68, 63], ['hay_cart', 50, 62], ['barrel_group', 64, 65], ['crate_stack', 58, 66]] as [string, number, number][]) objects.push({ id, x, y });
console.log('나무/소품', objects.length);

const layout = { shoreProps, exits: [[97, 0], [199, Math.round(Y(45))], [0, 105]], castle: CR, market: [60, Math.round(Y(62))], wellSquare: [160, Math.round(Y(30))], fences, farmObjs };
const lot = { layout, objects, shells: [...shells, ...farmShells], id: 'ashford', w: W, h: H, ground: t.ground, floor: new Array(W * H).fill(null), walls: new Array(W * H).fill(null), openings: [], spawn: { x: 62, y: 66 }, elev: t.elev, ramps: t.ramps, cliffStyle: style };
fs.writeFileSync('artifacts/qa/visual/layout-a.json', JSON.stringify(lot));
