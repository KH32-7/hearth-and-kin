/**
 * 타일 격자 A* (GDD 13-5). 8방향, 대각선은 양옆 두 칸이 모두 걸을 수 있을 때만 (벽 모서리 끼임 금지).
 * 목표 칸이 가구 발자국 안(앉기/눕기 슬롯)이면 마지막 한 칸만 예외로 허용.
 * 탐색 버퍼는 재사용해서 요청마다 큰 배열을 만들지 않음.
 */
import type { Grid } from '../world/grid';

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

export class PathFinder {
  private g: Float32Array;
  private came: Int32Array;
  private closed: Uint8Array;
  private stamp: Uint32Array;
  private gen = 0;
  private heap: Int32Array;
  private heapF: Float32Array;
  private heapSize = 0;
  lastExpanded = 0;

  constructor(private grid: Grid) {
    const n = grid.w * grid.h;
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.stamp = new Uint32Array(n);
    this.heap = new Int32Array(n * 8);
    this.heapF = new Float32Array(n * 8);
  }

  private h(i: number, goal: number): number {
    const w = this.grid.w;
    const dx = Math.abs((i % w) - (goal % w));
    // 다른 층이면 세로 거리는 계단 위치에 달림 → 가로 거리만 (과대 추정하지 않게)
    if (this.grid.slabOf(i) !== this.grid.slabOf(goal)) return dx;
    const dy = Math.abs(Math.floor(i / w) - Math.floor(goal / w));
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  }

  private push(i: number, f: number): void {
    let k = this.heapSize++;
    this.heap[k] = i;
    this.heapF[k] = f;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.heapF[p] <= this.heapF[k]) break;
      const ti = this.heap[p];
      const tf = this.heapF[p];
      this.heap[p] = this.heap[k];
      this.heapF[p] = this.heapF[k];
      this.heap[k] = ti;
      this.heapF[k] = tf;
      k = p;
    }
  }

  private pop(): number {
    const top = this.heap[0];
    this.heapSize--;
    if (this.heapSize > 0) {
      this.heap[0] = this.heap[this.heapSize];
      this.heapF[0] = this.heapF[this.heapSize];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < this.heapSize && this.heapF[l] < this.heapF[m]) m = l;
        if (r < this.heapSize && this.heapF[r] < this.heapF[m]) m = r;
        if (m === k) break;
        const ti = this.heap[m];
        const tf = this.heapF[m];
        this.heap[m] = this.heap[k];
        this.heapF[m] = this.heapF[k];
        this.heap[k] = ti;
        this.heapF[k] = tf;
        k = m;
      }
    }
    return top;
  }

  /** 잠긴 문 (23-2): 지나가는 사람. 가족이면 모든 문, 아니면 잠금 0 문만 (신분 이상 잠금은 rankOk) */
  who: { family: boolean; rankOk: boolean } | null = null;

  /** start/goal은 칸 인덱스. 경로(시작 제외, 목표 포함) 또는 null */
  find(start: number, goal: number, allowGoalBlocked: boolean): number[] | null {
    const grid = this.grid;
    const w = grid.w;
    if (start === goal) return [];
    if (!allowGoalBlocked && !grid.walkable(goal)) return null;
    if (allowGoalBlocked && !grid.walkable(goal, true)) return null;
    this.gen++;
    if (this.gen === 0xffffffff) {
      this.stamp.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    // 막힌 목표(침대 베개 칸 등)는 그 물건 자신의 발자국을 밟고 들어갈 수 있음 (침대 발치로 올라가 눕기)
    const through = allowGoalBlocked ? grid.objAt[goal] : 0;
    const pass = (i: number) => grid.walkable(i) || (through !== 0 && grid.objAt[i] === through && !grid.wall[i]);
    this.heapSize = 0;
    this.stamp[start] = gen;
    this.g[start] = 0;
    this.closed[start] = 0;
    this.came[start] = -1;
    this.push(start, this.h(start, goal));
    let expanded = 0;
    while (this.heapSize > 0) {
      const cur = this.pop();
      if (this.closed[cur] && this.stamp[cur] === gen) continue;
      this.closed[cur] = 1;
      expanded++;
      if (cur === goal) break;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const portal = grid.portal[cur];
      for (let d = 0; d < 9; d++) {
        let ni: number;
        if (d === 8) {
          // 계단/들창: 다른 층의 이어진 칸
          if (portal < 0) break;
          ni = portal;
        } else {
          const nx = cx + DX[d];
          const ny = cy + DY[d];
          if (!grid.inBounds(nx, ny)) continue;
          ni = ny * w + nx;
        }
        const nx = ni % w;
        const ny = (ni - nx) / w;
        const isGoal = ni === goal;
        if (!(isGoal && allowGoalBlocked ? grid.walkable(ni, true) : pass(ni))) continue;
        // 잠긴 문: 가족만 → 식구가 아니면, 신분 이상 → 신분이 모자라면 못 지나감
        const lk = grid.lock[ni];
        if (lk && this.who && !this.who.family && (lk === 1 || !this.who.rankOk)) continue;
        // 가구 안쪽 자리(막힌 목표)에는 걸을 수 있는 칸이나 같은 물건 칸에서만 들어감 (다른 가구로 건너가 갇히지 않게)
        if (isGoal && !grid.walkable(ni) && !pass(cur)) continue;
        if (d >= 4 && d < 8) {
          // 대각선: 양옆 칸 모두 통과 가능해야 함
          if (!pass(cy * w + nx) || !pass(ny * w + cx)) continue;
          // 문을 대각선으로 드나들지 않음
          if (grid.door[ni] || grid.door[cur]) continue;
        }
        const ng = this.g[cur] + (d >= 4 && d < 8 ? SQRT2 : 1);
        if (this.stamp[ni] !== gen) {
          this.stamp[ni] = gen;
          this.closed[ni] = 0;
          this.g[ni] = Infinity;
        }
        if (this.closed[ni]) continue;
        if (ng < this.g[ni]) {
          this.g[ni] = ng;
          this.came[ni] = cur;
          this.push(ni, ng + this.h(ni, goal));
        }
      }
    }
    this.lastExpanded = expanded;
    if (this.stamp[goal] !== gen || !this.closed[goal]) return null;
    const path: number[] = [];
    let c = goal;
    while (c !== start && c !== -1) {
      path.push(c);
      c = this.came[c];
    }
    path.reverse();
    return path;
  }
}
