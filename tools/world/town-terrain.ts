/**
 * 애쉬포드 지형 설계 (비주얼 개편 docs/07, 레퍼런스: 사용자 참고 성곽 마을 / 언덕 마을 / Village 목업).
 * 칸 단위 순수 함수: 높이(언덕 단차), 굽은 강·호수, 길(곡선), 밭 조각보, 숲 바닥. 건물/물건은 make-town.ts 가 올림.
 * 무작위는 시드 RNG 만
 */
import { Rng } from '../../src/sim/core/rng';

export const W = 200;
export const H = 150;
export type P = [number, number];

export class Noise {
  private perm: number[];
  constructor(rng: Rng) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = p.concat(p);
  }
  private h(x: number, y: number): number {
    return this.perm[(this.perm[x & 255] + y) & 255] / 255;
  }
  value(x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = this.h(xi, yi), b = this.h(xi + 1, yi), c = this.h(xi, yi + 1), d = this.h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  fbm(x: number, y: number, oct = 3): number {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) {
      s += this.value(x * f, y * f) * a;
      n += a;
      a *= 0.5;
      f *= 2.03;
    }
    return s / n;
  }
}

/** 캣멀롬 곡선을 촘촘한 점으로 */
export function spline(pts: P[], step = 0.25): P[] {
  const out: P[] = [];
  const p = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export class Terrain {
  readonly ground: string[] = new Array(W * H).fill('grass');
  readonly elev: number[] = new Array(W * H).fill(0);
  readonly ramps: { x: number; y: number; w: number }[] = [];
  /** 칸 용도: 0 빈 땅, 1 길, 2 물, 3 건물/장소, 4 밭, 5 숲 */
  readonly use = new Uint8Array(W * H);
  readonly noise: Noise;
  constructor(readonly rng: Rng) {
    this.noise = new Noise(rng);
  }
  I(x: number, y: number): number {
    return y * W + x;
  }
  inb(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < W && y < H;
  }
  g(x: number, y: number): string {
    return this.inb(x, y) ? this.ground[this.I(x, y)] : 'grass';
  }
  e(x: number, y: number): number {
    return this.inb(x, y) ? this.elev[this.I(x, y)] : 0;
  }
  set(x: number, y: number, id: string, force = false): void {
    if (!this.inb(x, y)) return;
    const i = this.I(x, y);
    if (!force && this.ground[i] === 'water') return;
    this.ground[i] = id;
  }

  /** 울퉁불퉁한 타원 언덕 (가장자리 잡음), 높이 lv 이상으로 */
  hill(cx: number, cy: number, rx: number, ry: number, lv: number, wobble = 0.12, seed = 0): void {
    for (let y = Math.floor(cy - ry - 3); y <= cy + ry + 3; y++) {
      for (let x = Math.floor(cx - rx - 3); x <= cx + rx + 3; x++) {
        if (!this.inb(x, y)) continue;
        const a = Math.atan2(y - cy, x - cx);
        const r = 1 + wobble * (this.noise.fbm(Math.cos(a) * 2.2 + seed, Math.sin(a) * 2.2 + seed, 2) - 0.5) * 2;
        if (Math.hypot((x - cx) / rx, (y - cy) / ry) <= r) this.elev[this.I(x, y)] = Math.max(this.elev[this.I(x, y)], lv);
      }
    }
  }

  /**
   * 절벽 가장자리 다듬기: 한 칸짜리 돌출/틈과 한 칸 계단을 없앰 (절벽 3칸 그림이 이어지게).
   * 남쪽 가장자리는 가로로 최소 3칸 같은 줄, 폭 3칸 미만인 윗단은 깎음
   */
  smoothElev(minRun = 3): void {
    for (let pass = 0; pass < 4; pass++) {
      for (let lv = 3; lv >= 1; lv--) {
        const up = (x: number, y: number) => this.e(x, y) >= lv;
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const i = this.I(x, y);
          const n = +up(x - 1, y) + +up(x + 1, y) + +up(x, y - 1) + +up(x, y + 1);
          if (up(x, y) && n <= 1) this.elev[i] = lv - 1;
          else if (!up(x, y) && n >= 3) this.elev[i] = lv;
          // 가로 폭 2칸 이하 윗단 / 세로 2칸 이하 윗단 제거
          if (up(x, y) && ((!up(x - 1, y) && !up(x + 2, y)) || (!up(x - 1, y) && !up(x + 1, y)))) this.elev[i] = lv - 1;
          if (up(x, y) && !up(x, y - 1) && !up(x, y + 1)) this.elev[i] = lv - 1;
          if (up(x, y) && !up(x, y - 1) && !up(x, y + 2)) this.elev[i] = lv - 1;
        }
        // 남쪽 가장자리 계단: 가장자리 줄이 1~2칸만 튀어나오면 메움/깎음
        for (let y = 1; y < H - 1; y++) {
          let run = 0;
          for (let x = 1; x <= W - 1; x++) {
            const edge = x < W - 1 && up(x, y) && !up(x, y + 1);
            if (edge) run++;
            else {
              if (run > 0 && run < minRun) for (let k = x - run; k < x; k++) this.elev[this.I(k, y)] = up(k, y + 1) ? lv : lv - 1;
              run = 0;
            }
          }
        }
      }
    }
  }

  /** 곡선을 따라 폭 w 로 칠함 (길/강). 반환: 지나간 칸 */
  stroke(pts: P[], w: number, id: string, opts: { force?: boolean; use?: number; wobble?: number; seed?: number; keep?: number[] } = {}): Set<number> {
    const cells = new Set<number>();
    const sp = spline(pts);
    for (let k = 0; k < sp.length; k++) {
      const [px, py] = sp[k];
      const ww = w + (opts.wobble ? (this.noise.value(k * 0.05 + (opts.seed ?? 0), 3.7) - 0.5) * 2 * opts.wobble : 0);
      const r = ww / 2;
      for (let y = Math.floor(py - r - 1); y <= py + r + 1; y++) for (let x = Math.floor(px - r - 1); x <= px + r + 1; x++) {
        if (!this.inb(x, y)) continue;
        if (Math.hypot(x + 0.5 - px, y + 0.5 - py) <= r) cells.add(this.I(x, y));
      }
    }
    for (const i of cells) {
      if (!opts.force && this.ground[i] === 'water') continue;
      if (opts.keep?.includes(this.use[i])) continue;
      this.ground[i] = id;
      if (opts.use !== undefined) this.use[i] = opts.use;
    }
    return cells;
  }

  /** 잡음 경계 덩어리 (호수, 광장, 숲 바닥) */
  blob(cx: number, cy: number, rx: number, ry: number, id: string, wobble = 0.2, use?: number, force = false): void {
    for (let y = Math.floor(cy - ry - 3); y <= cy + ry + 3; y++) for (let x = Math.floor(cx - rx - 3); x <= cx + rx + 3; x++) {
      if (!this.inb(x, y)) continue;
      const a = Math.atan2(y - cy, x - cx);
      const r = 1 + wobble * (this.noise.fbm(Math.cos(a) * 1.8 + cx * 0.1, Math.sin(a) * 1.8 + cy * 0.1, 2) - 0.5) * 2;
      // 칸 단위 잡음: 가장자리가 긴 직선으로 끊기지 않게
      const rr = r + wobble * (this.noise.value(x * 0.9 + 31, y * 0.9 + 17) - 0.5) * 1.6;
      if (Math.hypot((x - cx) / rx, (y - cy) / ry) <= rr) {
        const i = this.I(x, y);
        if (!force && this.ground[i] === 'water') continue;
        this.ground[i] = id;
        if (use !== undefined) this.use[i] = use;
      }
    }
  }

  /** 물 칸 다듬기: 한 칸 돌기/구멍 없앰 (물가 타일이 끊기지 않게) */
  smoothWater(): void {
    for (let pass = 0; pass < 2; pass++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const w = (a: number, b: number) => this.g(a, b) === 'water';
      const n = +w(x - 1, y) + +w(x + 1, y) + +w(x, y - 1) + +w(x, y + 1);
      const i = this.I(x, y);
      if (w(x, y) && n <= 1) this.ground[i] = 'grass';
      else if (!w(x, y) && n >= 3 && this.use[i] !== 1) {
        this.ground[i] = 'water';
        this.use[i] = 2;
      }
    }
  }
}
