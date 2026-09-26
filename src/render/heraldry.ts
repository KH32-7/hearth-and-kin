/**
 * 문장 합성기 (GDD 16-1). 방패 모양 + 분할(두 색) + 문양(한 색) → 픽셀.
 *
 * 순수 함수 `composeCoatOfArmsPixels` (DOM 없음, Node 도구와 테스트가 씀) + 캔버스 포장 `composeCoatOfArms`.
 * 요소 마스크는 src/data/heraldry.json (tools/heraldry/gen-heraldry.ts) 에 문자열로 들어 있어 그림을 불러올 필요가 없음 → 동기.
 * 크기: 방패 32×32 × 정수 배율 (최근접, 흐림 없음).
 *
 * 그리는 순서: 바탕(분할 마스크로 색 a/b) → 방패 안쪽 테두리 밝음/어두움 1px → 문양(문양 색, 위쪽 가장자리 밝게,
 * 아래쪽 어둡게, 안쪽 선) → 문양 외곽선 → 방패 외곽선.
 */
import heraldryJson from '../data/heraldry.json';

export interface HeraldryElement {
  id: string;
  nameKey: string;
  sprite: { x: number; y: number; w: number; h: number };
  mask: string[];
}
export interface HeraldryData {
  shieldSize: number;
  chargeSize: number;
  outline: string;
  sheet: string;
  shields: Array<HeraldryElement & { charge: { x: number; y: number } }>;
  divisions: Array<HeraldryElement & { second: boolean }>;
  charges: HeraldryElement[];
  tinctures: Array<{ id: string; nameKey: string; kind: 'metal' | 'colour'; ramp: [string, string, string]; sprite: HeraldryElement['sprite'] }>;
}

export const HERALDRY = heraldryJson as unknown as HeraldryData;

export interface CoatOfArmsSpec {
  shield: string;
  division: string;
  /** [바탕 색, 분할 둘째 색] */
  tinctures: [string, string];
  /** 문양 없음 = null 또는 '' */
  charge: string | null;
  chargeTincture: string;
}

const hex = (h: string) => parseInt(h.replace('#', ''), 16);

/** 문장학 색 규칙 경고 (금속 위 금속, 색 위 색): 문양이 닿는 바탕 색 기준 */
export function tinctureWarnings(spec: CoatOfArmsSpec, data: HeraldryData = HERALDRY): Array<{ code: 'metal_on_metal' | 'colour_on_colour'; field: string; charge: string }> {
  const kind = (id: string) => data.tinctures.find((t) => t.id === id)?.kind;
  if (!spec.charge) return [];
  const div = data.divisions.find((d) => d.id === spec.division);
  const fields = div?.second ? [...new Set(spec.tinctures)] : [spec.tinctures[0]];
  const out: Array<{ code: 'metal_on_metal' | 'colour_on_colour'; field: string; charge: string }> = [];
  const ck = kind(spec.chargeTincture);
  for (const f of fields) {
    const fk = kind(f);
    if (!ck || !fk || ck !== fk) continue;
    // 분할 방패는 문양이 두 색에 걸침: 둘 다 같은 부류일 때만 경고 (한쪽만 같으면 문장학에서도 허용하는 경우가 많음)
    if (fields.length > 1 && fields.some((g) => kind(g) !== ck)) continue;
    out.push({ code: ck === 'metal' ? 'metal_on_metal' : 'colour_on_colour', field: f, charge: spec.chargeTincture });
  }
  return out;
}

/**
 * RGBA 픽셀 (size = shieldSize * scale). 알 수 없는 id 는 예외.
 */
export function composeCoatOfArmsPixels(spec: CoatOfArmsSpec, scale = 1, data: HeraldryData = HERALDRY): { width: number; height: number; data: Uint8ClampedArray } {
  const S = data.shieldSize;
  const C = data.chargeSize;
  const shield = data.shields.find((s) => s.id === spec.shield);
  const div = data.divisions.find((d) => d.id === spec.division);
  const tin = (id: string) => {
    const t = data.tinctures.find((x) => x.id === id);
    if (!t) throw new Error(`unknown tincture ${id}`);
    return t.ramp.map(hex) as [number, number, number];
  };
  if (!shield) throw new Error(`unknown shield ${spec.shield}`);
  if (!div) throw new Error(`unknown division ${spec.division}`);
  const charge = spec.charge ? data.charges.find((c) => c.id === spec.charge) : null;
  if (spec.charge && !charge) throw new Error(`unknown charge ${spec.charge}`);
  const ta = tin(spec.tinctures[0]);
  const tb = tin(spec.tinctures[1] ?? spec.tinctures[0]);
  const tc = tin(spec.chargeTincture);
  const outline = hex(data.outline);

  const inShield = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S && shield.mask[y][x] === '#';
  const px = new Int32Array(S * S).fill(-1);
  // 바탕 + 방패 안쪽 테두리 (왼/위 밝음, 오른/아래 어두움)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (!inShield(x, y)) continue;
      const ramp = div.second && div.mask[y][x] === '#' ? tb : ta;
      let c = ramp[1];
      if (!inShield(x - 1, y) || !inShield(x, y - 1)) c = ramp[2];
      else if (!inShield(x + 1, y) || !inShield(x, y + 1)) c = ramp[0];
      px[y * S + x] = c;
    }
  // 문양
  if (charge) {
    const ox = shield.charge.x - C / 2;
    const oy = shield.charge.y - C / 2;
    const at = (x: number, y: number) => {
      const cx = x - ox, cy = y - oy;
      return cx >= 0 && cy >= 0 && cx < C && cy < C ? charge.mask[cy][cx] : '.';
    };
    const filled = (x: number, y: number) => at(x, y) !== '.';
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const ch = at(x, y);
        if (ch === '.' || !inShield(x, y)) continue;
        if (ch === 'o') { px[y * S + x] = outline; continue; }
        let c = tc[1];
        if (!filled(x, y - 1)) c = tc[2];
        else if (!filled(x, y + 1)) c = tc[0];
        px[y * S + x] = c;
      }
    // 문양 외곽선 (4방향, 방패 안만)
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        if (filled(x, y) || !inShield(x, y)) continue;
        if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) px[y * S + x] = outline;
      }
  }
  // 방패 외곽선 (바깥 1px, 4방향)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (inShield(x, y)) continue;
      if (inShield(x - 1, y) || inShield(x + 1, y) || inShield(x, y - 1) || inShield(x, y + 1)) px[y * S + x] = outline;
    }
  const k = Math.max(1, Math.floor(scale));
  const W = S * k;
  const out = new Uint8ClampedArray(W * W * 4);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const c = px[Math.floor(y / k) * S + Math.floor(x / k)];
      if (c < 0) continue;
      const i = (y * W + x) * 4;
      out[i] = (c >> 16) & 255;
      out[i + 1] = (c >> 8) & 255;
      out[i + 2] = c & 255;
      out[i + 3] = 255;
    }
  return { width: W, height: W, data: out };
}

/** 캔버스로 (브라우저: OffscreenCanvas 우선). imageSmoothing 은 쓰는 쪽에서 끌 것 */
export function composeCoatOfArms(spec: CoatOfArmsSpec, scale = 1): HTMLCanvasElement | OffscreenCanvas {
  const px = composeCoatOfArmsPixels(spec, scale);
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(px.width, px.height);
  else {
    canvas = document.createElement('canvas');
    canvas.width = px.width;
    canvas.height = px.height;
  }
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D canvas unavailable');
  const img = ctx.createImageData(px.width, px.height);
  img.data.set(px.data);
  ctx.putImageData(img, 0, 0);
  return canvas;
}
