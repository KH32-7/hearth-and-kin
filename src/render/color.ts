/**
 * 색 계산 (순수 함수, 브라우저/Node 공용): HSV, CIELAB, ΔE2000, 인물 색 보정(grade).
 * 색 보정 수치는 src/data/grading.json. 같은 함수를 게임(합성 직후)과 tools/check-palette.ts가 씀 → 같은 픽셀.
 */

export interface Grade {
  /** 채도 배수 */
  saturation: number;
  /** 명도 배수 */
  value: number;
  /** 명도 대비: v' = 0.5 + (v-0.5)*contrast */
  contrast: number;
  /** 곱하는 색 (따뜻한 톤 맞춤) */
  tint: [number, number, number];
  /** 0~1: 보정 후 색을 세계 팔레트 최근접 색 쪽으로 당기는 비율 (0 = 끔) */
  paletteSnap: number;
  /** 스냅할 때 이 ΔE보다 먼 색은 건드리지 않음 (고유 색 보존) */
  snapMaxDeltaE: number;
  /**
   * 외곽선 맞춤: 명도가 maxV 이하인 아주 어두운 색(LPC 검정 외곽선)을 세계 쪽 외곽선 색으로 바꿈.
   * 원래 어두운 정도의 차이는 비율로 유지 (가장 어두운 색 = rgb)
   */
  outline?: { maxV: number; rgb: [number, number, number] };
  /** 명도 바닥: v' = floor + v × (1 − floor). 순흑 옷이 장면의 구멍처럼 보이지 않게 (외곽선 제외) */
  valueFloor?: number;
  /** 채도 압축: s' = s × (1 − k·s). 높은 채도일수록 더 낮춤 */
  satCompress?: number;
  /** 색상 난색 이동: 어두울수록(1−v) 목표 색상(도) 쪽으로 amount 만큼 */
  warmShift?: { hue: number; amount: number; window?: number };
  /** 무채색 어두운 색(회흑색 옷)에 난색 기운: 채도 < 0.15, 명도 < maxV 이면 색상 hue, 채도 sat 로 */
  darkTint?: { hue: number; sat: number; maxV: number };
  /** 밝을수록 채도를 더 누름: s' = s × (1 − k·s·v). 형광처럼 튀는 밝은 원색(금발 등) 억제 */
  brightSatCompress?: number;
  /** 특정 색상대만 채도 배수 (예: 노랑 52° ±25° × 0.7). 가운데서 가장 세고 가장자리로 갈수록 약해짐 */
  hueSat?: { hue: number; window: number; mult: number }[];
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  let x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  let y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  let z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  x = f(x);
  y = f(y);
  z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIEDE2000 */
export function deltaE2000(l1: [number, number, number], l2: [number, number, number]): number {
  const [L1, a1, b1] = l1;
  const [L2, a2, b2] = l2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const v = Math.atan2(b, a) / rad;
    return v < 0 ? v + 360 : v;
  };
  const h1p = h(a1p, b1);
  const h2p = h(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hbp = (h1p + h2p) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/** 팔레트 최근접 찾기 (Lab 목록). 작은 팔레트(수천 색) 전제의 단순 탐색 + 캐시 */
export class PaletteIndex {
  private labs: [number, number, number][] = [];
  private rgbs: number[] = [];
  private cache = new Map<number, { i: number; d: number }>();
  constructor(colors: number[]) {
    for (const c of colors) {
      this.rgbs.push(c);
      this.labs.push(rgbToLab((c >> 16) & 255, (c >> 8) & 255, c & 255));
    }
  }
  get size(): number {
    return this.rgbs.length;
  }
  nearest(rgb: number): { rgb: number; d: number } {
    const hit = this.cache.get(rgb);
    if (hit) return { rgb: this.rgbs[hit.i], d: hit.d };
    const lab = rgbToLab((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
    let best = 0;
    let bd = Infinity;
    // ΔE76로 후보를 좁힌 뒤 상위 몇 개만 ΔE2000
    const cand: { i: number; d: number }[] = [];
    for (let i = 0; i < this.labs.length; i++) {
      const l = this.labs[i];
      const d = (l[0] - lab[0]) ** 2 + (l[1] - lab[1]) ** 2 + (l[2] - lab[2]) ** 2;
      if (cand.length < 8) {
        cand.push({ i, d });
        cand.sort((a, b) => a.d - b.d);
      } else if (d < cand[7].d) {
        cand[7] = { i, d };
        cand.sort((a, b) => a.d - b.d);
      }
    }
    for (const c of cand) {
      const d = deltaE2000(lab, this.labs[c.i]);
      if (d < bd) {
        bd = d;
        best = c.i;
      }
    }
    this.cache.set(rgb, { i: best, d: bd });
    return { rgb: this.rgbs[best], d: bd };
  }
}

/**
 * RGBA 버퍼에 인물 색 보정 적용 (제자리). 투명 픽셀은 건너뜀.
 * 같은 색은 같은 결과 → 색 단위 캐시.
 */
export function applyGrade(data: Uint8Array | Uint8ClampedArray, g: Grade, palette?: PaletteIndex): void {
  const cache = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let out = cache.get(key);
    if (out === undefined) {
      out = gradeColor(key, g, palette);
      cache.set(key, out);
    }
    data[i] = (out >> 16) & 255;
    data[i + 1] = (out >> 8) & 255;
    data[i + 2] = out & 255;
  }
}

export function gradeColor(rgb: number, g: Grade, palette?: PaletteIndex): number {
  const [h, s, v] = rgbToHsv((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
  if (g.outline && v <= g.outline.maxV) {
    // 외곽선: 세계 외곽선 색으로 확실히 바꾸되, 원래 어두운 정도 차이는 ±10% 밝기로 남김
    const k = 0.9 + 0.2 * (v / g.outline.maxV);
    const [or, og, ob] = g.outline.rgb;
    return (Math.min(255, Math.round(or * k)) << 16) | (Math.min(255, Math.round(og * k)) << 8) | Math.min(255, Math.round(ob * k));
  }
  let hh = h;
  if (g.warmShift && s > 0.05) {
    // 가장 짧은 방향으로 목표 색상에 다가감
    let d = g.warmShift.hue - hh;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    // 목표에서 너무 먼 색(파랑/보라)은 돌리지 않음 → 파란 옷이 보라로 변하지 않게. 경계에서 부드럽게 줄어듦
    const win = g.warmShift.window ?? 180;
    const w = Math.max(0, 1 - Math.abs(d) / win);
    hh = (hh + d * g.warmShift.amount * (1 - v) * w + 360) % 360;
  }
  let s1 = s * g.saturation;
  if (g.satCompress) s1 = s1 * (1 - g.satCompress * s1);
  if (g.brightSatCompress) s1 = s1 * (1 - g.brightSatCompress * s1 * v);
  for (const hs of g.hueSat ?? []) {
    let d = Math.abs(h - hs.hue) % 360;
    if (d > 180) d = 360 - d;
    const w = Math.max(0, 1 - d / hs.window);
    s1 *= 1 - (1 - hs.mult) * w;
  }
  if (g.darkTint && s < 0.15 && v < g.darkTint.maxV) {
    hh = g.darkTint.hue;
    s1 = Math.max(s1, g.darkTint.sat * (1 - v / g.darkTint.maxV) + s1);
  }
  const s2 = Math.min(1, Math.max(0, s1));
  let v1 = v;
  if (g.valueFloor) v1 = g.valueFloor + v1 * (1 - g.valueFloor);
  const v2 = Math.min(1, Math.max(0, 0.5 + (v1 * g.value - 0.5) * g.contrast));
  let [r, gg, b] = hsvToRgb(hh, s2, v2);
  r = Math.min(255, Math.round(r * g.tint[0]));
  gg = Math.min(255, Math.round(gg * g.tint[1]));
  b = Math.min(255, Math.round(b * g.tint[2]));
  let out = (r << 16) | (gg << 8) | b;
  if (palette && g.paletteSnap > 0) {
    const n = palette.nearest(out);
    if (n.d <= g.snapMaxDeltaE) {
      const k = g.paletteSnap;
      const nr = (n.rgb >> 16) & 255;
      const ng = (n.rgb >> 8) & 255;
      const nb = n.rgb & 255;
      out = (Math.round(r + (nr - r) * k) << 16) | (Math.round(gg + (ng - gg) * k) << 8) | Math.round(b + (nb - b) * k);
    }
  }
  return out;
}
