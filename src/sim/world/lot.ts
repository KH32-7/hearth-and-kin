/**
 * 여러 층 부지 (GDD 23-2 층, 기초와 지하).
 * 층마다 w × h 판(슬랩)을 세로로 쌓고, 판 사이에 막힌 줄 하나를 둠 → 격자 한 장으로 A* 경로, 방 인식, 기온이 그대로 돌고
 * 층을 건너는 길은 계단/들창의 연결(portal)로만 이어짐.
 *   슬랩 s 의 칸 (x, y) = 전체 행 s * (h + 1) + y
 * 파일로 저장된 옛 부지(한 층, w × h)는 normalizeLot 이 나머지 판을 빈칸으로 채움.
 */
import type { LotDef } from '../core/types';

/** 슬랩 순서 → 층 번호. 0 = 1층(땅), 1 = 2층, 2 = 3층(저택/성), -1 = 지하 */
export const LEVELS: readonly number[] = [0, 1, 2, -1];
export const SLABS = LEVELS.length;

export function slabStride(h: number): number {
  return h + 1;
}

export function totalRows(h: number): number {
  return SLABS * (h + 1) - 1;
}

/** 전체 행 → 슬랩 번호 (틈 줄은 위 슬랩) */
export function slabOfRow(y: number, h: number): number {
  return Math.min(SLABS - 1, Math.floor(y / (h + 1)));
}

export function levelOfRow(y: number, h: number): number {
  return LEVELS[slabOfRow(y, h)];
}

export function slabOfLevel(level: number): number {
  const s = LEVELS.indexOf(level);
  if (s < 0) throw new Error(`층 없음: ${level}`);
  return s;
}

/** (층, 판 안 y) → 전체 행 */
export function rowOf(level: number, localY: number, h: number): number {
  return slabOfLevel(level) * (h + 1) + localY;
}

export function isGapRow(y: number, h: number): boolean {
  return y % (h + 1) === h;
}

/** 옛 한 층 부지를 전체 슬랩 배열로 (이미 펼쳐져 있으면 그대로). 새 객체를 돌려줌 */
export function normalizeLot(lot: LotDef): LotDef {
  const rows = totalRows(lot.h);
  const n = lot.w * rows;
  const pad = (arr: (string | null)[]) => {
    if (arr.length === n) return arr.slice();
    if (arr.length !== lot.w * lot.h) throw new Error(`부지 ${lot.id}: 배열 길이 ${arr.length} (w*h ${lot.w * lot.h} 또는 w*rows ${n})`);
    const out = new Array<string | null>(n).fill(null);
    for (let i = 0; i < arr.length; i++) out[i] = arr[i];
    return out;
  };
  return {
    ...lot,
    ground: pad(lot.ground),
    floor: pad(lot.floor),
    walls: pad(lot.walls),
    openings: lot.openings.map((o) => ({ ...o })),
    objects: lot.objects.map((o) => ({ ...o })),
    exits: lot.exits?.map((e) => ({ ...e })),
    rows,
    levels: [...LEVELS],
  };
}

/** 깊은 복사 (실행 취소 스냅샷, 저장) */
export function cloneLot(lot: LotDef): LotDef {
  return JSON.parse(JSON.stringify(lot)) as LotDef;
}
