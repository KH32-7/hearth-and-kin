/**
 * 지형 자동 타일 (비주얼 개편 docs/07, README 영상 4 "Tiled 오토타일 기법"):
 * - Tiled wangset 모서리 방식. 칸을 칠하면 그 칸의 네 모서리가 그 재질 (꼭짓점 = 둘레 네 칸 중 하나라도 그 재질)
 * - 재질마다 투명 전이 레이어를 아래 → 위로 겹쳐 쌓음 (terrain.json order)
 * - 물: 물 칸은 바닥을 비우고(셰이더 물이 아래에서 보임), 물가 칸은 강둑 타일
 * - 높이: 높이 L 이상 칸 = 윗단. 윗단 남쪽 가장자리 아래 3칸에 절벽면 (Tiled 자동 규칙과 같게 아래 두 줄 덧붙임)
 * DOM 없음 (브라우저 청크 그리기와 node 미리보기 도구가 같이 씀)
 */

export interface TerrainData {
  tile: number;
  image: string;
  cols: number;
  base: [number, number][];
  materials: Record<string, Record<string, [number, number][]>>;
  cliff: Record<string, [number, number, number[]][]>;
  /** 바위 절벽 (Ancient Ruins wall-1). 칸 cliffStyle 1 */
  cliffRock?: Record<string, [number, number, number[]][]>;
  /** 성벽 (Highlands 요새, 사암). 칸 cliffStyle 2 */
  cliffFort?: Record<string, [number, number, number[]][]>;
  order: string[];
  alias: Record<string, string | null>;
  ramp?: { left: number[][]; mid: number[][]; right: number[][] };
}

export interface TerrainLot {
  w: number;
  h: number;
  ground: (string | null)[];
  elev?: number[];
  ramps?: { x: number; y: number; w: number }[];
  /** 윗단 칸의 절벽 그림: 0 흙 절벽, 1 바위 절벽 */
  cliffStyle?: number[];
}

/** 그리기 명령: 아틀라스 칸 atlas 를 칸 (x, y) 에. cut = 이 모양으로 아래 그림을 도려냄 (물) */
export interface TerrainOp {
  atlas: number;
  x: number;
  y: number;
  cut?: boolean;
  /** 물 칸 전체를 비움 */
  clear?: boolean;
}

function hash(x: number, y: number, k: number): number {
  let h = (x * 374761393 + y * 668265263 + k * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function pick<T extends [number, number, ...unknown[]]>(list: T[], x: number, y: number, k: number): T {
  if (list.length === 1) return list[0];
  let total = 0;
  for (const t of list) total += t[1];
  if (total <= 0) return list[0];
  let r = ((hash(x, y, k) % 10000) / 10000) * total;
  for (const t of list) {
    r -= t[1];
    if (r < 0) return t;
  }
  return list[list.length - 1];
}

export class TerrainTiler {
  private matOf = new Map<string, string | null>();

  constructor(readonly d: TerrainData) {
    for (const m of Object.keys(d.materials)) this.matOf.set(m, m);
    for (const [k, v] of Object.entries(d.alias)) this.matOf.set(k, v);
  }

  /** 게임 바닥 id → 지형 재질 (없으면 기본 풀) */
  material(ground: string | null | undefined): string | null {
    if (!ground || ground === 'grass') return null;
    if (ground === 'water' || ground === 'water_deep') return 'water';
    const m = this.matOf.get(ground);
    return m === undefined ? null : m;
  }

  /**
   * 칸 범위 [x0, x1) × [y0, y1) 의 그리기 명령. 부지 밖은 가장자리 칸 값을 늘려 씀.
   * 순서: 기본 풀 → 재질 레이어들 → (물가: 물 모양 도려내기 → 강둑) → 절벽(높이 1, 2, 3)
   */
  ops(lot: TerrainLot, x0: number, y0: number, x1: number, y1: number): TerrainOp[] {
    const W = lot.w;
    const H = lot.h;
    const cx = (x: number) => (x < 0 ? 0 : x >= W ? W - 1 : x);
    const cy = (y: number) => (y < 0 ? 0 : y >= H ? H - 1 : y);
    const mat = (x: number, y: number) => this.material(lot.ground[cy(y) * W + cx(x)]);
    const elev = (x: number, y: number) => (lot.elev ? lot.elev[cy(y) * W + cx(x)] ?? 0 : 0);
    // 꼭짓점 (vx, vy) = 칸 (vx-1..vx, vy-1..vy) 중 하나라도 조건
    const vert = (vx: number, vy: number, f: (x: number, y: number) => boolean) =>
      f(vx - 1, vy - 1) || f(vx, vy - 1) || f(vx - 1, vy) || f(vx, vy);
    const code = (x: number, y: number, f: (x: number, y: number) => boolean) =>
      (vert(x, y, f) ? '1' : '0') + (vert(x + 1, y, f) ? '1' : '0') + (vert(x + 1, y + 1, f) ? '1' : '0') + (vert(x, y + 1, f) ? '1' : '0');
    const out: TerrainOp[] = [];
    const d = this.d;
    // 1) 기본 풀
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push({ atlas: pick(d.base, x, y, 1)[0], x, y });
    // 2) 재질 레이어
    let k = 10;
    for (const m of d.order) {
      k++;
      const table = d.materials[m];
      if (!table) continue;
      const f = (x: number, y: number) => mat(x, y) === m;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const c = code(x, y, f);
          if (c === '0000') continue;
          const list = table[c] ?? (c === '1111' ? null : table['1111']);
          if (!list) continue;
          out.push({ atlas: pick(list, x, y, k)[0], x, y });
        }
      }
    }
    // 3) 물: 뭍 꼭짓점 = 둘레 칸 중 하나라도 물이 아님. 물 칸(0000)은 통째로 비우고, 물가는 물 모양으로 도려낸 뒤 강둑
    const land = (x: number, y: number) => mat(x, y) !== 'water';
    const bank = d.materials.bank;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const c = code(x, y, land);
        if (c === '1111') continue;
        if (c === '0000') {
          out.push({ atlas: -1, x, y, clear: true });
          continue;
        }
        const list = bank?.[c] as unknown as [number, number, number][] | undefined;
        if (!list) continue;
        const t = pick(list, x, y, 8);
        // 이 강둑 타일의 물 모양으로 아래 바닥을 도려낸 뒤 강둑
        if (t[2] !== undefined) out.push({ atlas: t[2], x, y, cut: true });
        out.push({ atlas: t[0], x, y });
      }
    }
    // 4) 절벽: 높이별. 앞면 윗줄 타일 아래로 두 줄 (아래1, 아래2)
    let maxE = 0;
    if (lot.elev) for (const e of lot.elev) if (e > maxE) maxE = e;
    const inRamp = (x: number, y: number) => !!lot.ramps?.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + 3);
    for (let L = 1; L <= maxE; L++) {
      const f = (x: number, y: number) => elev(x, y) >= L;
      // 앞면이 아래 두 칸으로 내려오므로 위 두 줄 더 봄
      for (let y = y0 - 2; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const c = code(x, y, f);
          if (c === '0000' || c === '1111') continue;
          // 둘레 윗단 칸 중 바위 절벽이 있으면 바위
          let st = 0;
          if (lot.cliffStyle) for (const [ax, ay] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]) if (f(ax, ay)) st = Math.max(st, lot.cliffStyle[cy(ay) * W + cx(ax)] ?? 0);
          const set = st === 2 && d.cliffFort ? d.cliffFort : st >= 1 && d.cliffRock ? d.cliffRock : d.cliff;
          const list = set[c];
          if (!list) continue;
          const t = pick(list, x, y, 20 + L);
          if (!inRamp(x, y) && y >= y0) out.push({ atlas: t[0], x, y });
          const below = t[2] ?? [];
          for (let i = 0; i < below.length; i++) {
            const by = y + 1 + i;
            if (below[i] < 0 || by < y0 || by >= y1 || inRamp(x, by)) continue;
            out.push({ atlas: below[i], x, y: by });
          }
        }
      }
      // 비탈 (절벽면 대신 풀 비탈)
      if (d.ramp) {
        for (const r of lot.ramps ?? []) {
          for (let i = 0; i < r.w; i++) {
            const col = i === 0 ? d.ramp.left : i === r.w - 1 ? d.ramp.right : d.ramp.mid;
            for (let j = 0; j < 3; j++) {
              const x = r.x + i;
              const y = r.y + j;
              if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
              const a = col[j]?.[hash(x, y, 30) % Math.max(1, col[j]?.length ?? 1)];
              if (a !== undefined) out.push({ atlas: a, x, y });
            }
          }
        }
      }
    }
    return out;
  }
}
