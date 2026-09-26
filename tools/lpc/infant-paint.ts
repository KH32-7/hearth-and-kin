/**
 * 아기/유아 스프라이트용 작은 픽셀 페인터 (tools/lpc/gen-infant.ts 가 씀).
 *
 * 도형(타원, 캡슐, 다각형, 낱 픽셀)을 앞뒤 순서(z)대로 한 칸 버퍼에 찍고, 빛 방향으로 LPC 6단 램프
 * (0 = 외곽선, 1 = 가장 어두움 ... 5 = 가장 밝음) 번호를 매긴 뒤, 바깥 외곽선(4방향)과 부위 사이 윤곽선을 넣는다.
 * 결과는 재질(skin/cloth/hair/mat/tear)별 레이어로 뽑아 각 재질의 원본 램프 색으로 칠한다 → 게임에서
 * 다른 LPC 레이어와 같은 방식(원본 램프 → 목표 램프 팔레트 교체)으로 색을 바꿀 수 있음.
 * 무작위 없음. 좌표는 64×64 칸 안 픽셀(실수 → 픽셀 중심 표본).
 */
import { newImg, type Img } from './png';

export type Mat = 'skin' | 'cloth' | 'hair' | 'mat' | 'tear';

export interface PrimBase {
  z: number;
  /** 같은 그룹끼리는 윤곽선을 넣지 않음 (팔 윗부분과 아랫부분 등) */
  group: number;
  mat: Mat;
  /** 고정 램프 번호 (빛 계산 안 함) */
  shade?: number;
  /** 밝기 보정 (램프 번호 더하기, 실수) */
  bias?: number;
  /** 윤곽선을 받지 않음 (얼굴 무늬 등) */
  noEdge?: boolean;
  /** 이 도형이 뒤 도형 위에 남기는 윤곽선 램프 번호 (기본 0) */
  edgeShade?: number;
}
export type Prim = PrimBase & (
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'capsule'; ax: number; ay: number; bx: number; by: number; ra: number; rb: number }
  | { kind: 'poly'; pts: Array<[number, number]> }
  | { kind: 'px'; pts: Array<[number, number]> }
);

/** 빛: 왼쪽 위 앞 (LPC 음영 방향) */
const L = (() => {
  const v = [-0.5, -0.62, 0.6];
  const n = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / n);
})();

export function shadeOf(nx: number, ny: number, nz: number, bias = 0): number {
  const i = nx * L[0] + ny * L[1] + nz * L[2] + bias * 0.15;
  if (i > 0.86) return 5;
  if (i > 0.55) return 4;
  if (i > 0.22) return 3;
  if (i > -0.12) return 2;
  return 1;
}

export interface Buffer {
  w: number;
  h: number;
  /** 픽셀마다 도형 번호 (-1 빈칸) */
  id: Int32Array;
  shade: Int8Array;
  prims: Prim[];
  /** 외곽선 픽셀: 재질 (-1 없음) */
  edgeMat: Int8Array;
}

export const MATS: Mat[] = ['skin', 'cloth', 'hair', 'mat', 'tear'];

function insidePoly(pts: Array<[number, number]>, x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 도형을 z 순서대로 찍기 (같은 z는 넣은 순서) */
export function rasterize(prims: Prim[], w = 64, h = 64): Buffer {
  const buf: Buffer = { w, h, id: new Int32Array(w * h).fill(-1), shade: new Int8Array(w * h), prims, edgeMat: new Int8Array(w * h).fill(-1) };
  const order = prims.map((p, i) => ({ p, i })).sort((a, b) => a.p.z - b.p.z || a.i - b.i);
  for (const { p, i } of order) {
    if (p.kind === 'px') {
      for (const [x, y] of p.pts) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        buf.id[y * w + x] = i;
        buf.shade[y * w + x] = p.shade ?? 3;
      }
      continue;
    }
    // 경계 상자
    let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    if (p.kind === 'ellipse') { x0 = Math.floor(p.cx - p.rx); x1 = Math.ceil(p.cx + p.rx); y0 = Math.floor(p.cy - p.ry); y1 = Math.ceil(p.cy + p.ry); }
    else if (p.kind === 'capsule') { const r = Math.max(p.ra, p.rb); x0 = Math.floor(Math.min(p.ax, p.bx) - r); x1 = Math.ceil(Math.max(p.ax, p.bx) + r); y0 = Math.floor(Math.min(p.ay, p.by) - r); y1 = Math.ceil(Math.max(p.ay, p.by) + r); }
    else { x0 = Math.floor(Math.min(...p.pts.map((q) => q[0]))); x1 = Math.ceil(Math.max(...p.pts.map((q) => q[0]))); y0 = Math.floor(Math.min(...p.pts.map((q) => q[1]))); y1 = Math.ceil(Math.max(...p.pts.map((q) => q[1]))); }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w - 1, x1); y1 = Math.min(h - 1, y1);
    // 다각형 음영: 줄마다 좌우 폭으로 원통 법선
    const rowSpan = new Map<number, [number, number]>();
    if (p.kind === 'poly') {
      for (let y = y0; y <= y1; y++) {
        let a = Infinity, b = -Infinity;
        for (let x = x0; x <= x1; x++) if (insidePoly(p.pts, x + 0.5, y + 0.5)) { a = Math.min(a, x); b = Math.max(b, x); }
        if (a <= b) rowSpan.set(y, [a, b]);
      }
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        let nx = 0, ny = 0, nz = 1, hit = false;
        if (p.kind === 'ellipse') {
          const u = (px - p.cx) / p.rx, v = (py - p.cy) / p.ry;
          const d = u * u + v * v;
          if (d <= 1) { hit = true; nx = u; ny = v; nz = Math.sqrt(Math.max(0, 1 - d)); }
        } else if (p.kind === 'capsule') {
          const dx = p.bx - p.ax, dy = p.by - p.ay;
          const len2 = dx * dx + dy * dy || 1e-6;
          let t = ((px - p.ax) * dx + (py - p.ay) * dy) / len2;
          t = Math.max(0, Math.min(1, t));
          const qx = p.ax + dx * t, qy = p.ay + dy * t;
          const r = p.ra + (p.rb - p.ra) * t;
          const ex = px - qx, ey = py - qy;
          const d = Math.hypot(ex, ey);
          if (d <= r) { hit = true; nx = ex / r; ny = ey / r; nz = Math.sqrt(Math.max(0, 1 - (d * d) / (r * r))); }
        } else if (insidePoly(p.pts, px, py)) {
          hit = true;
          const span = rowSpan.get(y);
          if (span) {
            const c = (span[0] + span[1] + 1) / 2;
            const hw = Math.max(1, (span[1] - span[0] + 1) / 2);
            nx = Math.max(-1, Math.min(1, (px - c) / hw));
            ny = 0.15;
            nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          }
        }
        if (!hit) continue;
        buf.id[y * w + x] = i;
        buf.shade[y * w + x] = p.shade ?? shadeOf(nx, ny, nz, p.bias);
      }
  }
  return buf;
}

const matIndex = (m: Mat) => MATS.indexOf(m);

/**
 * 외곽선: 빈칸의 4방향 이웃에 칠한 칸이 있으면 외곽선 (앞쪽(z 큰) 이웃의 재질).
 * 윤곽선: 다른 그룹의 앞쪽 도형과 맞닿은 뒤쪽 칸 → 0번 색. 옷과 맨살이 같은 그룹에서 맞닿으면 옷 쪽을 1번(단 끝).
 */
export function outline(buf: Buffer, opts: { contour?: boolean } = {}): void {
  const { w, h, id, prims } = buf;
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const orig = new Int32Array(id);
  const newShade = new Int8Array(buf.shade);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = orig[i];
      if (a < 0) {
        let best = -1;
        for (const [dx, dy] of nb) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const b = orig[yy * w + xx];
          if (b < 0 || prims[b].kind === 'px') continue;
          if (best < 0 || prims[b].z > prims[best].z) best = b;
        }
        if (best >= 0) buf.edgeMat[i] = matIndex(prims[best].mat);
        continue;
      }
      if (opts.contour === false) continue;
      const pa = prims[a];
      if (pa.noEdge || pa.kind === 'px') continue;
      for (const [dx, dy] of nb) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const b = orig[yy * w + xx];
        if (b < 0 || b === a) continue;
        const pb = prims[b];
        if (pb.kind === 'px' || pb.noEdge) continue;
        if (pb.group !== pa.group && pb.z > pa.z) {
          newShade[i] = Math.min(newShade[i], pb.edgeShade ?? 0);
          if ((pb.edgeShade ?? 0) === 0) break;
          continue;
        }
        if (pb.group === pa.group && pa.mat === 'cloth' && pb.mat === 'skin') newShade[i] = Math.min(newShade[i], 1) as number;
      }
    }
  buf.shade.set(newShade);
}

/** 재질 하나의 레이어 (원본 램프 색). ramp[0] = 외곽선 색 */
export function layerImage(buf: Buffer, mat: Mat, ramp: string[], into?: Img, ox = 0, oy = 0): Img {
  const out = into ?? newImg(buf.w, buf.h);
  const rgb = ramp.map((h) => parseInt(h.replace('#', ''), 16));
  const mi = matIndex(mat);
  for (let y = 0; y < buf.h; y++)
    for (let x = 0; x < buf.w; x++) {
      const i = y * buf.w + x;
      let c = -1;
      const a = buf.id[i];
      if (a >= 0) {
        if (buf.prims[a].mat === mat) c = rgb[Math.max(0, Math.min(rgb.length - 1, buf.shade[i]))];
      } else if (buf.edgeMat[i] === mi) c = rgb[0];
      if (c < 0) continue;
      const di = ((oy + y) * out.width + ox + x) * 4;
      out.data[di] = (c >> 16) & 255;
      out.data[di + 1] = (c >> 8) & 255;
      out.data[di + 2] = c & 255;
      out.data[di + 3] = 255;
    }
  return out;
}

/** 칠한 칸 (외곽선 포함) 마스크 */
export function coverage(buf: Buffer): Uint8Array {
  const m = new Uint8Array(buf.w * buf.h);
  for (let i = 0; i < m.length; i++) if (buf.id[i] >= 0 || buf.edgeMat[i] >= 0) m[i] = 1;
  return m;
}
