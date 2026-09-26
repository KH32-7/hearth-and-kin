/**
 * 방 인식 결과 해석 (GDD 23-2 방 인식 → 이름, 11-2 방 점수 무드렛).
 * 점수 = 물건 방 점수 합 + 품질 보너스 + 창문 + 조명 + 바닥/벽 재질 − 더러움 − 고장, 넓은 방은 조금 깎음
 */
import type { SimData } from '../data/simData';
import { EXIT_OBJECT_ID, WINDOW_OBJECT_ID } from '../data/simData';
import type { World } from '../world/world';

export interface RoomInfo {
  id: number;
  level: number;
  size: number;
  /** 대표 칸 (x, 전체 행 y) */
  x: number;
  y: number;
  /** 플레이어가 붙인 이름 (없으면 null → 종류 이름) */
  name: string | null;
  /** 추정 종류: bedroom kitchen dining living workshop hygiene storage chapel nursery stable room */
  type: string;
  score: number;
  /** 신분 보정 전 등급 */
  tier: string;
  windows: number;
  objects: number;
}

export function evaluateRooms(world: World, data: SimData): RoomInfo[] {
  const b = data.build;
  const g = world.grid;
  const out: RoomInfo[] = [];
  if (!b) return out;
  const R = b.rooms;
  const n = g.roomSizes.length;
  const raw = new Float64Array(n);
  const objCount = new Int32Array(n);
  const votes: Map<string, number>[] = Array.from({ length: n }, () => new Map());
  const vote = (r: number, t: string | undefined, k = 1) => {
    if (!t) return;
    votes[r].set(t, (votes[r].get(t) ?? 0) + k);
  };
  for (const o of world.objects) {
    if (o.defId === WINDOW_OBJECT_ID || o.defId === EXIT_OBJECT_ID) continue;
    const d = data.objects[o.defId];
    if (!d) continue;
    // 벽걸이는 벽 앞(남쪽) 칸의 방, 나머지는 발자국 첫 칸
    const fp = world.footprint(o);
    let r = -1;
    for (let dy = 0; dy < fp.h && r < 0; dy++) for (let dx = 0; dx < fp.w && r < 0; dx++) r = g.roomOf(o.x + dx, o.y + dy);
    if (r < 0 && d.wallMounted) r = g.roomOf(o.x, o.y + 1);
    if (r < 0) continue;
    objCount[r]++;
    raw[r] += (d.roomScore ?? 0) + (R.qualityBonus[d.quality ?? 1] ?? 0);
    if (o.state.broken) raw[r] -= R.brokenPenalty;
    if (d.light || d.tags.includes('light')) raw[r] += R.lightScore;
    if (d.roomType) vote(r, d.roomType, 3);
    for (const t of d.tags) vote(r, b.roomTypeTags[t]);
  }
  const winCount = new Int32Array(n);
  for (const op of world.lot.openings) {
    if (op.kind !== 'window') continue;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const r = g.roomOf(op.x + dx, op.y + dy);
      if (r < 0) continue;
      winCount[r]++;
      raw[r] += R.windowScore + (op.variant ? b.windows[op.variant]?.roomScore ?? 0 : 0);
      break;
    }
  }
  const floorSum = new Float64Array(n);
  for (let i = 0; i < g.room.length; i++) {
    const r = g.room[i];
    if (r < 0) continue;
    const f = world.lot.floor[i];
    floorSum[r] += f ? b.floors[f]?.roomScore ?? 0 : 0;
  }
  const names = world.lot.roomNames ?? [];
  for (let r = 0; r < n; r++) {
    const size = g.roomSizes[r];
    let wall = 0;
    for (const s of g.roomWallStyles[r]) wall += b.walls[s]?.roomScore ?? 0;
    const wallAvg = g.roomWallStyles[r].length ? wall / g.roomWallStyles[r].length : 0;
    let score = raw[r] + (floorSum[r] / size) * 3 + wallAvg * 2 - (world.roomDirt[r] ?? 0) * R.dirtPenalty;
    if (objCount[r] === 0) score += R.emptyPenalty;
    // 넓은 방은 같은 가구로 덜 아늑함
    score *= Math.min(1.2, Math.sqrt(R.sizeRef / Math.max(4, size)));
    let type = 'room';
    let best = 0;
    for (const [t, v] of votes[r]) {
      if (v > best) {
        best = v;
        type = t;
      }
    }
    if (g.roomLevels[r] < 0 && type === 'room') type = 'cellar';
    const rep = g.roomCells[r];
    const named = names.find((q) => g.room[q.y * g.w + q.x] === r);
    out.push({
      id: r, level: g.roomLevels[r], size, x: rep % g.w, y: Math.floor(rep / g.w), name: named?.name ?? null, type,
      score: Math.round(score * 10) / 10, tier: tierOf(data, score), windows: winCount[r], objects: objCount[r],
    });
  }
  return out;
}

export function tierOf(data: SimData, score: number): string {
  const tiers = data.build?.rooms.tiers ?? [];
  let id = 'plain';
  for (const t of tiers) if (score >= t.min) id = t.id;
  return id;
}

/** 신분 보정한 등급의 무드렛 (없으면 null) */
export function roomMoodlet(data: SimData, score: number, estate: string): string | null {
  const R = data.build?.rooms;
  if (!R) return null;
  const s = score + (R.estateShift[estate] ?? 0);
  let m: string | null = null;
  for (const t of R.tiers) if (s >= t.min) m = t.moodlet;
  return m;
}
