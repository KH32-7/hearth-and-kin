/**
 * 부지 격자: 벽/문/바닥/물건 점유/방 인식 (GDD 13-5, 23-2 방 인식, 11-1 실내 기온).
 * 좌표는 칸 단위. index = y * w + x. 여러 층은 슬랩을 세로로 쌓은 한 장 (world/lot.ts)
 */
import { cliffBlocked } from './elevation';
import type { LotDef, ObjectDef, ObjectInstance } from '../core/types';
import { LEVELS, SLABS, isGapRow, slabOfRow, totalRows } from './lot';

export class Grid {
  readonly w: number;
  /** 전체 행 수 (슬랩 전부) */
  readonly h: number;
  /** 한 층 판의 행 수 */
  readonly slabH: number;
  readonly wall: Uint8Array;
  /** 울타리 칸 (길은 막지만 방은 만들지 않음) */
  readonly fence: Uint8Array;
  readonly door: Uint8Array;
  readonly floor: Uint8Array;
  /** 디딜 수 있는 칸: 1층 땅 전부 + 위층/지하의 바닥 칸 */
  readonly solid: Uint8Array;
  /** 계단/들창 연결: 칸 → 다른 층의 칸 (-1 = 없음) */
  readonly portal: Int32Array;
  /** 위층 계단 구멍 칸 (World.linkPortals 가 표시) */
  readonly hole: Uint8Array;
  /** 문 잠금 (23-2): 0 모두, 1 가족만, 2 신분 이상 */
  readonly lock: Uint8Array;
  readonly wallStyle: (string | null)[];
  /** 막는 물건 uid + 1 (0 = 없음) */
  readonly objAt: Int32Array;
  /** 방 id (-1 = 바깥/방 아님) */
  readonly room: Int32Array;
  roomSizes: number[] = [];
  roomWallStyles: string[][] = [];
  /** 방마다 대표 칸 (가장 작은 index) — 방 이름 기억용 */
  roomCells: number[] = [];
  /** 방마다 층 번호 */
  roomLevels: number[] = [];
  /** 방마다 벽 칸 목록 (창문 세기, 방 점수) */
  roomWalls: number[][] = [];

  constructor(lot: LotDef, private fenceIds: ReadonlySet<string> = new Set(), private blockedTerrain: ReadonlySet<string> = new Set()) {
    this.w = lot.w;
    this.slabH = lot.h;
    this.h = lot.rows ?? totalRows(lot.h);
    const n = this.w * this.h;
    this.wall = new Uint8Array(n);
    this.fence = new Uint8Array(n);
    this.door = new Uint8Array(n);
    this.floor = new Uint8Array(n);
    this.solid = new Uint8Array(n);
    this.portal = new Int32Array(n).fill(-1);
    this.hole = new Uint8Array(n);
    this.lock = new Uint8Array(n);
    this.objAt = new Int32Array(n);
    this.room = new Int32Array(n).fill(-1);
    this.wallStyle = new Array<string | null>(n).fill(null);
    this.load(lot);
  }

  /** 부지 배열에서 벽/바닥/문/디딤 칸을 다시 채움 (건축 후). 물건 점유와 연결은 World 가 다시 놓음 */
  load(lot: LotDef): void {
    const n = this.w * this.h;
    if (lot.walls.length !== n) throw new Error(`격자 크기 ${n} != 부지 배열 ${lot.walls.length}`);
    this.door.fill(0);
    this.objAt.fill(0);
    this.portal.fill(-1);
    this.hole.fill(0);
    this.lock.fill(0);
    for (let i = 0; i < n; i++) {
      const y = (i / this.w) | 0;
      const style = lot.walls[i];
      const gap = isGapRow(y, this.slabH);
      const isFence = !!style && this.fenceIds.has(style);
      this.wall[i] = gap || style ? 1 : 0;
      this.fence[i] = isFence ? 1 : 0;
      this.wallStyle[i] = style;
      this.floor[i] = lot.floor[i] ? 1 : 0;
      const slab = slabOfRow(y, this.slabH);
      // 1층 땅은 어디든 디딤 (물 같은 못 걷는 지형은 바닥을 깔거나 다리를 놓지 않으면 아님)
      this.solid[i] = gap ? 0 : slab === 0 ? (lot.floor[i] || !this.blockedTerrain.has(lot.ground[i] ?? '') ? 1 : 0) : lot.floor[i] || style ? 1 : 0;
    }
    // 지형 높이: 절벽면/옆면 칸은 못 걸음 (1층 판, 바닥을 깐 칸은 예외 없음)
    if (lot.elev && lot.elev.length === lot.w * lot.h) {
      const blocked = cliffBlocked(lot.w, lot.h, lot.elev, lot.ramps ?? []);
      for (let i = 0; i < blocked.length; i++) if (blocked[i]) this.solid[i] = 0;
    }
    for (const o of lot.openings) {
      const i = this.idx(o.x, o.y);
      if (o.kind === 'door') this.door[i] = 1;
      if (o.kind === 'door' && o.lock) this.lock[i] = o.lock === 'family' ? 1 : o.lock === 'estate' ? 2 : 0;
    }
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  slabOf(i: number): number {
    return slabOfRow((i / this.w) | 0, this.slabH);
  }

  levelOf(i: number): number {
    return LEVELS[this.slabOf(i)];
  }

  /** 걸을 수 있는 칸인지 (물건 점유 제외 여부 선택) */
  walkable(i: number, ignoreObjects = false): boolean {
    if (!this.solid[i]) return false;
    if (this.wall[i] && !this.door[i]) return false;
    if (!ignoreObjects && this.objAt[i] !== 0) return false;
    return true;
  }

  link(a: number, b: number): void {
    this.portal[a] = b;
    this.portal[b] = a;
  }

  placeObject(obj: ObjectInstance, def: ObjectDef, fp: { w: number; h: number } = def.footprint): void {
    if (!def.blocks || def.wallMounted) return;
    for (let dy = 0; dy < fp.h; dy++) {
      for (let dx = 0; dx < fp.w; dx++) {
        const x = obj.x + dx;
        const y = obj.y + dy;
        if (this.inBounds(x, y)) this.objAt[this.idx(x, y)] = obj.uid + 1;
      }
    }
  }

  clearObject(obj: ObjectInstance, fp: { w: number; h: number }): void {
    for (let dy = 0; dy < fp.h; dy++) {
      for (let dx = 0; dx < fp.w; dx++) {
        const x = obj.x + dx;
        const y = obj.y + dy;
        if (this.inBounds(x, y) && this.objAt[this.idx(x, y)] === obj.uid + 1) this.objAt[this.idx(x, y)] = 0;
      }
    }
  }

  /**
   * 벽/문으로 닫힌 바닥 영역을 방으로 인식 (문은 방에 속하지 않음).
   * 1층/위층: 바닥 없는 칸에 닿으면 새는 것(바깥). 지하: 바닥 없는 칸은 흙벽. 울타리는 벽이 아님
   */
  detectRooms(): void {
    this.room.fill(-1);
    this.roomSizes = [];
    this.roomWallStyles = [];
    this.roomCells = [];
    this.roomLevels = [];
    this.roomWalls = [];
    const stack: number[] = [];
    let id = 0;
    for (let start = 0; start < this.room.length; start++) {
      if (!this.floor[start] || (this.wall[start] && !this.fence[start]) || this.room[start] !== -1) continue;
      const slab = this.slabOf(start);
      const cellar = LEVELS[slab] < 0;
      let size = 0;
      let leaks = false;
      const styles: string[] = [];
      const walls: number[] = [];
      stack.length = 0;
      stack.push(start);
      this.room[start] = id;
      while (stack.length) {
        const i = stack.pop()!;
        size++;
        const x = i % this.w;
        const y = (i - x) / this.w;
        for (let d = 0; d < 4; d++) {
          const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
          const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (!this.inBounds(nx, ny) || slabOfRow(ny, this.slabH) !== slab || isGapRow(ny, this.slabH)) {
            if (!cellar) leaks = true;
            continue;
          }
          const j = this.idx(nx, ny);
          if (this.wall[j] && !this.fence[j]) {
            const s = this.wallStyle[j];
            if (s) {
              styles.push(s);
              walls.push(j);
            }
            continue;
          }
          if (!this.floor[j]) {
            // 위층의 계단 구멍: 아래층 바닥 위로 뚫린 칸은 바깥이 아님
            // 위층 계단 구멍만 예외 (벽 없는 발판은 방이 아님)
            if (!cellar && !this.hole[j]) leaks = true;
            continue;
          }
          if (this.room[j] === -1) {
            this.room[j] = id;
            stack.push(j);
          }
        }
      }
      if (leaks) {
        // 벽으로 닫히지 않은 바닥은 방이 아님 (바깥 취급)
        for (let i = 0; i < this.room.length; i++) if (this.room[i] === id) this.room[i] = -2;
        continue;
      }
      this.roomSizes.push(size);
      this.roomWallStyles.push(styles);
      this.roomCells.push(start);
      this.roomLevels.push(LEVELS[slab]);
      this.roomWalls.push(walls);
      id++;
    }
    for (let i = 0; i < this.room.length; i++) if (this.room[i] === -2) this.room[i] = -1;
  }

  /**
   * 자동 지붕 (23-2): 한 층 판 칸 (x, y) 마다 지붕이 얹히는 맨 위 슬랩 (-1 = 지붕 없음).
   * 덮는 칸 = (울타리 아닌) 벽 또는 방 바닥. 지하는 제외. 길이 w × slabH
   */
  roofMap(): Int8Array {
    const out = new Int8Array(this.w * this.slabH).fill(-1);
    const stride = this.slabH + 1;
    for (let ly = 0; ly < this.slabH; ly++) {
      for (let x = 0; x < this.w; x++) {
        for (let s = SLABS - 1; s >= 0; s--) {
          if (LEVELS[s] < 0) continue;
          const i = (s * stride + ly) * this.w + x;
          if ((this.wall[i] && !this.fence[i] && this.wallStyle[i]) || this.room[i] >= 0 || this.stairHole(i, s)) {
            out[ly * this.w + x] = s;
            break;
          }
        }
      }
    }
    return out;
  }

  /** 위층 계단 구멍 칸: 바닥은 없지만 아래층 방 위이고 같은 층 방/벽과 맞닿음 (지붕이 덮음) */
  private stairHole(i: number, slab: number): boolean {
    if (LEVELS[slab] <= 0 || !this.hole[i]) return false;
    const x = i % this.w;
    for (const j of [i - 1, i + 1, i - this.w, i + this.w]) {
      if (j < 0 || j >= this.room.length || (Math.abs((j % this.w) - x) > 1)) continue;
      if (this.room[j] >= 0) return true;
    }
    return false;
  }

  roomOf(x: number, y: number): number {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (!this.inBounds(cx, cy)) return -1;
    return this.room[this.idx(cx, cy)];
  }
}

export { SLABS };
