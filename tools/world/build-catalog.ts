// M5 구매 카탈로그 (contracts-m5.md 2절). build-world.ts 끝에서 부름.
// 물건 표(ITEMS) 한 곳에서 그림(art.objects + 아틀라스 PNG)과 데이터(src/data/catalog.json, src/i18n/ko/catalog.json)를 함께 만듦.
// 원본은 assets/vendor 의 Epic RPG World(보유) + LPC 보충. 그리지 않고 자르기/이어붙이기/팔레트 교체만 씀.
// CC-BY-SA 원본(LPC 중세 마을 장식, 선술집, 도시 실내, 집 실내)에서 나온 그림은 따로 모은 아틀라스(catalog_atlas_sa_*.png)에 넣음 (assets/SHARE_ALIKE.md)
import fs from 'node:fs';
import type { ArtKit } from './build-world';
import { Img, create, crop, blit, scale, text, fillRect, save } from './png';
import { RGBA, paste, bboxOf, widen, removeCols, mapPixels, hsv, hex, keep, px, clone, lum, rampRecolor } from './imgops';

type Cat = 'bedroom' | 'kitchen' | 'dining' | 'living' | 'hygiene' | 'work' | 'decor' | 'light' | 'kids' | 'animal' | 'outdoor' | 'religion';
type Estate = 'serf' | 'freeman' | 'artisan' | 'merchant' | 'clergy' | 'knight' | 'noble';
type Src = string | [string, number, number, number, number] | (() => Img);
type Rect = [number, number, number, number]; // x0, y0, x1, y1 (canvas, end exclusive)
interface Bed { x0: number; x1: number; y0: number; y1: number; heads: Array<[number, number]> }
interface Lit {
  /** 초 끝 (캔버스 좌표): 불꽃 애니메이션을 얹음 */
  tips?: Array<[number, number]>;
  /** 원본에 있는 켠 그림 (한 장 또는 애니메이션 프레임) */
  on?: Src[];
  /** 등불: 원본(유리가 노랗게 빛남) = 켠 그림, 끈 그림은 빛나는 유리를 어둡게 */
  glow?: boolean;
  /** 가로등: 원본 = 끈 그림, 켠 그림은 등 유리(옅은 색, 위쪽 60%)를 따뜻한 빛으로 */
  warm?: boolean;
  fps?: number;
}
interface Item {
  id: string; cat: Cat; ko: string; w: number; h: number; price: number; q: number; rs: number; src: Src;
  as?: string; est?: Estate; var?: 'wood' | 'cloth'; wall?: boolean; surface?: boolean; rug?: boolean; blocks?: boolean;
  tags?: string[]; light?: number; room?: string; dur?: boolean;
  // ---- 그림
  lift?: number; cx?: number; blob?: boolean | 'strict'; epic?: boolean; tf?: (i: Img) => Img;
  bed?: Bed; lit?: Lit; anim?: Src[]; fps?: number;
  nat?: Partial<Record<string, Src>>; cloth?: [number, number, number?]; clothRect?: Rect; woodSkip?: Rect;
  rot?: Record<string, Src>; natRot?: Partial<Record<string, Record<string, Src>>>;
  sprite?: string;
}

const T = 32;
const WOOD: Record<string, RGBA[]> = {
  oak: ['#3b2630', '#513c47', '#6e4a42', '#8a5a44', '#a0693f', '#b57b4b', '#c98f5a', '#dcae78'].map((h) => hex(h)),
  walnut: ['#221519', '#33211f', '#472e27', '#5b3a2e', '#6d4834', '#80573e', '#93684a', '#a87d5c'].map((h) => hex(h)),
  pine: ['#4a3226', '#6b4a30', '#8d6538', '#ab8042', '#c49a52', '#d8b066', '#e6c47e', '#f0d89e'].map((h) => hex(h)),
  ebony: ['#141015', '#1c171d', '#252027', '#2f2930', '#3a323a', '#463c44', '#54494f', '#65585c'].map((h) => hex(h)),
};
const CLOTH: Record<string, RGBA[]> = {
  red: ['#4a1a22', '#6e2430', '#93303a', '#b8453f', '#d6674f', '#eb9170'].map((h) => hex(h)),
  blue: ['#1e2447', '#283a6b', '#33508f', '#4270b0', '#5f94cc', '#8db8e0'].map((h) => hex(h)),
  green: ['#1d3524', '#2a4d2e', '#3a6a36', '#528a40', '#72a852', '#9cc670'].map((h) => hex(h)),
  yellow: ['#5a4217', '#806020', '#a8842a', '#caa63a', '#e2c455', '#f2de86'].map((h) => hex(h)),
  purple: ['#2e1c3d', '#432a59', '#5d3a78', '#7a5096', '#9a70b4', '#bf9ad0'].map((h) => hex(h)),
  brown: ['#3a261e', '#54372a', '#6e4a36', '#8a6044', '#a67a56', '#c49a72'].map((h) => hex(h)),
  grey: ['#2a2a30', '#3e3e46', '#56565e', '#707078', '#8e8e96', '#b0b0b6'].map((h) => hex(h)),
  white: ['#6a6460', '#8a847e', '#aba59c', '#c9c3b8', '#e0dbd0', '#f4f0e8'].map((h) => hex(h)),
};
const WOODS = Object.keys(WOOD);
const CLOTHS = Object.keys(CLOTH);
const KO_VARIANT: Record<string, string> = {
  oak: '참나무', walnut: '호두나무', pine: '소나무', ebony: '흑단',
  red: '빨강', blue: '파랑', green: '초록', yellow: '노랑', purple: '보라', brown: '갈색', grey: '회색', white: '흰색',
};
const KO_CAT: Record<Cat, string> = {
  bedroom: '침실', kitchen: '부엌과 살림', dining: '식당', living: '거실', hygiene: '씻기와 뒷일', work: '작업장',
  decor: '장식', light: '조명', kids: '아이', animal: '가축과 짐승', outdoor: '바깥', religion: '신앙',
};
const ROOM: Partial<Record<Cat, string>> = {
  bedroom: 'bedroom', kitchen: 'kitchen', dining: 'dining', living: 'living', hygiene: 'hygiene', work: 'workshop', kids: 'nursery', animal: 'stable', religion: 'chapel',
};
const CAT_TAGS: Partial<Record<Cat, string[]>> = { kids: ['kids'], animal: ['animal'], religion: ['religion'], outdoor: ['outdoor'], decor: ['decor'], light: ['light'] };
const SA_PACKS = ['lpc-medieval-village-decorations', 'lpc-tavern', 'lpc-city-inside', 'lpc-house-interior-and-decorations'];

const EPIC_WOOD = WOOD.oak;
const isWoodish = (c: RGBA) => { const [h, s, v] = hsv(c); return (h < 50 || h > 340) && s > 0.2 && v > 0.12 && !(s > 0.6 && v > 0.9); };
const hueIn = (c: RGBA, h0: number, h1: number, sMin = 0) => { const [h, s] = hsv(c); return (h0 <= h1 ? h >= h0 && h < h1 : h >= h0 || h < h1) && s >= sMin; };
const inRect = (r: Rect | undefined, x: number, y: number) => !!r && x >= r[0] && x < r[2] && y >= r[1] && y < r[3];
const key = (c: RGBA) => `${c[0]},${c[1]},${c[2]}`;

/** Colour map by luminance rank over every accepted colour of all images (so every frame/state recolours the same way). */
function rankMap(imgs: Img[], ramp: RGBA[], pred: (c: RGBA, x: number, y: number) => boolean): Map<string, RGBA> {
  const cols = new Map<string, RGBA>();
  for (const im of imgs) for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) { const c = px(im, x, y); if (c[3] > 0 && pred(c, x, y)) cols.set(key(c), c); }
  const list = [...cols.values()].sort((a, b) => lum(a) - lum(b));
  const map = new Map<string, RGBA>();
  if (!list.length) return map;
  const lo = lum(list[0]), hi = lum(list[list.length - 1]);
  for (const c of list) {
    const t = hi > lo ? (lum(c) - lo) / (hi - lo) : 0.5;
    map.set(key(c), ramp[Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1)))]);
  }
  return map;
}
function applyMap(img: Img, map: Map<string, RGBA>, pred: (c: RGBA, x: number, y: number) => boolean): Img {
  return mapPixels(img, (c, x, y) => { if (!pred(c, x, y)) return null; const r = map.get(key(c)); return r ? [r[0], r[1], r[2], c[3]] : null; });
}

/** Keep the largest opaque blob and the blobs that touch its (grown) bbox: removes neighbours cut into a sheet rect. */
function isolate(img: Img, strict = false): Img {
  const W = img.w, H = img.h, lab = new Int32Array(W * H).fill(-1);
  const comps: Array<{ n: number; x0: number; y0: number; x1: number; y1: number }> = [];
  for (let i = 0; i < W * H; i++) {
    if (lab[i] >= 0 || img.data[i * 4 + 3] <= 8) continue;
    const id = comps.length; const cc = { n: 0, x0: W, y0: H, x1: -1, y1: -1 }; comps.push(cc);
    const st = [i]; lab[i] = id;
    while (st.length) {
      const p = st.pop()!; const x = p % W, y = (p - x) / W; cc.n++;
      cc.x0 = Math.min(cc.x0, x); cc.y0 = Math.min(cc.y0, y); cc.x1 = Math.max(cc.x1, x); cc.y1 = Math.max(cc.y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx; if (lab[q] < 0 && img.data[q * 4 + 3] > 8) { lab[q] = id; st.push(q); }
      }
    }
  }
  if (comps.length <= 1) return img;
  const big = comps.reduce((a, b) => (b.n > a.n ? b : a));
  const g = 3;
  const keepIds = new Set(comps.map((c, i) => ({ c, i })).filter(({ c }) => c.x1 >= big.x0 - g && c.x0 <= big.x1 + g && c.y1 >= big.y0 - g && c.y0 <= big.y1 + g).map(({ i }) => i));
  if (strict) { keepIds.clear(); keepIds.add(comps.indexOf(big)); }
  const out = create(W, H);
  for (let i = 0; i < W * H; i++) if (lab[i] >= 0 && keepIds.has(lab[i])) img.data.copy(out.data, i * 4, i * 4, i * 4 + 4);
  return out;
}

export async function buildCatalog(kit: ArtKit): Promise<void> {
  const { art, L, paths } = kit;
  const { FPS, VPROPS, VDECO, GS1, GS2, GLOLD, LREV, ERW, GL, ANI } = paths;
  const objects: Record<string, { footprint: { w: number; h: number }; slots: Array<Record<string, unknown>>; wallMounted?: boolean }> =
    JSON.parse(fs.readFileSync('src/data/objects.json', 'utf8'));

  // ---------------------------------------------------------------- sources
  const OGA = 'assets/vendor/lpc/oga';
  const DM = `${OGA}/lpc-medieval-village-decorations/decoration_medieval/decorations-medieval.png`;
  const TD = `${OGA}/lpc-tavern/lpc-tavern/tavern-deco.png`;
  const CA = `${OGA}/lpc-interior-castle-tiles/castle.png`;
  const CI = `${OGA}/lpc-city-inside/LPC_city_inside/city_inside.png`;
  const HI = `${OGA}/lpc-house-interior-and-decorations/LPC_house_interior/interior.png`;
  const FARM = `${OGA}/lpc-farm/lpc-farm/barn.png`;
  const GI = `${GL}/Props/Static props/items-flowers-mushrooms-sprites`;
  const SEA = `${ERW}/ERW-Sea Adventures-GL2 Expansion/props/atlas-props-sprites`;
  const WATER = `${GL}/Tilesets/Platform-grass to water`;
  const F = (n: string) => `${FPS}/${n}.png`;
  const V = (n: string) => `${VPROPS}/${n}.png`;
  const D = (n: string) => `${VDECO}/${n}.png`;
  const G1 = (n: string) => `${GS1}/${n}.png`;
  const G2 = (n: string) => `${GS2}/${n}.png`;
  const GO = (n: string) => `${GLOLD}/${n}.png`;
  const LR = (p: string, x: number, y: number, w: number, h: number): Src => [`${LREV}/${p}.png`, x, y, w, h];
  const R = (f: string, x: number, y: number, w: number, h: number): Src => [f, x, y, w, h];

  const load = (s: Src): Img => {
    if (typeof s === 'function') return s();
    if (typeof s === 'string') return clone(L(s));
    const [f, x, y, w, h] = s;
    return crop(L(f), x, y, w, h);
  };
  const srcFile = (s: Src) => (typeof s === 'string' ? s : Array.isArray(s) ? s[0] : '');
  const trim = (img: Img) => { const b = bboxOf(img); return crop(img, b.x, b.y, b.w, b.h); };
  const narrowBed = (i: Img) => removeCols(i, 27, 37);
  const wideBed = (i: Img) => widen(i, 32, 24, 32, 16);
  /** paste trimmed layers bottom-aligned (x = left of trimmed image) on a new canvas */
  const compose = (w: number, h: number, layers: Array<[Src, number, number]>) => () => {
    const o = create(w, h);
    for (const [s, x, bottom] of layers) { const t = trim(load(s)); paste(o, t, x, bottom - t.h); }
    return o;
  };
  const frames = (f: string, xs: number[], y: number, w: number, h: number): Src[] => xs.map((x) => R(f, x, y, w, h));
  /** LPC revised dining chair sheet: 7 columns (front, side-right, back legs L/R, side-left, back, back frame), one row per cushion colour */
  const CHAIR_A = `${LREV}/Furniture/Seating/Chair, Dining A.png`;
  const chairA = (row: number): Record<string, Src> => {
    const c = (col: number) => crop(L(CHAIR_A), col * 32, row * 32, 32, 32);
    return {
      '0': () => c(0),
      '1': () => c(4),
      '2': () => { const o = c(5); paste(o, c(6), 0, 0); return o; },
      '3': () => c(1),
    };
  };
  // flower bed: Grass Land ground flowers on a 2x1 patch
  const flowerBed = compose(64, 32, [[GO('flowers_8'), 2, 20], [GO('flowers_12'), 14, 28], [GO('flowers_10'), 26, 18], [GO('flowers_14'), 36, 30], [GO('flowers_16'), 46, 20], [GO('flowers_6'), 52, 30]]);
  const wellRoofed = () => {
    const o = clone(L(G1('waterwell - rope - to place the roof - no grass')));
    const roof = trim(L(G1('waterwell - roof')));
    paste(o, roof, Math.floor((o.w - roof.w) / 2), 0);
    return o;
  };
  const basinPewter = compose(32, 48, [[F('headboard_4'), 2, 46], [F('kitchen_props4_10'), 3, 24]]);
  const woodenSword = () => rampRecolor(load(F('decors_weapon2_1')), WOOD.pine, (c) => hsv(c)[1] < 0.35 || isWoodish(c));

  // ---------------------------------------------------------------- the table
  const ITEMS: Item[] = [];
  const it = (cat: Cat, id: string, ko: string, w: number, h: number, price: number, q: number, rs: number, src: Src, o: Partial<Item> = {}) =>
    ITEMS.push({ id, cat, ko, w, h, price, q, rs, src, ...o });

  // ===== 침실
  const B1 = { x0: 14, x1: 50, y0: 40, y1: 76, heads: [[32, 28]] as Array<[number, number]> };
  const BN = { x0: 11, x1: 43, y0: 42, y1: 74, heads: [[27, 32]] as Array<[number, number]> };
  const BN8 = { x0: 11, x1: 43, y0: 40, y1: 72, heads: [[27, 31]] as Array<[number, number]> };
  const BW = (y0: number, hy: number) => ({ x0: 10, x1: 70, y0, y1: 74, heads: [[22, hy], [58, hy]] as Array<[number, number]> });
  it('bedroom', 'bed_wool', '양털 담요 침대', 1, 2, 144, 1, 1, F('bed_5'), { as: 'bed_straw', var: 'wood', woodSkip: [14, 16, 50, 76], bed: B1 });
  it('bedroom', 'bed_grass', '풀 요 침대', 1, 2, 108, 0, 1, F('bed_3'), { as: 'bed_straw', var: 'wood', bed: B1 });
  it('bedroom', 'bed_plaid', '격자 이불 침대', 1, 2, 240, 1, 2, F('bed_7'), { as: 'bed_straw', est: 'freeman', tf: narrowBed, var: 'cloth', cloth: [0, 45, 0.25], clothRect: [11, 40, 43, 74], bed: BN });
  it('bedroom', 'bed_linen', '아마포 침대', 1, 2, 336, 2, 2, F('bed_9'), { as: 'bed_straw', est: 'artisan', tf: narrowBed, var: 'cloth', cloth: [170, 250, 0.15], clothRect: [11, 38, 43, 74], bed: BN8 });
  it('bedroom', 'bed_carved', '조각 침대', 1, 2, 480, 2, 3, F('bed_8'), { as: 'bed_straw', est: 'artisan', tf: narrowBed, var: 'wood', bed: BN8 });
  it('bedroom', 'bed_feather', '깃털 침대', 1, 2, 576, 3, 3, F('bed_10'), { as: 'bed_straw', est: 'merchant', tf: narrowBed, var: 'wood', woodSkip: [11, 18, 43, 70], bed: BN8 });
  it('bedroom', 'bed_rose', '장미빛 누비 침대', 1, 2, 864, 3, 4, F('bed_6'), { as: 'bed_straw', est: 'merchant', tf: narrowBed, var: 'wood', woodSkip: [11, 18, 43, 74], bed: { ...BN, y0: 48 } });
  it('bedroom', 'bed_cabin', '통나무 침대', 1, 2, 192, 1, 1, G2('cabin interior - bed - pillow'), { as: 'bed_straw', est: 'freeman', var: 'wood', woodSkip: [14, 18, 54, 90], bed: { x0: 14, x1: 54, y0: 36, y1: 84, heads: [[33, 22]] } });
  it('bedroom', 'bed_double_wool', '양털 담요 부부 침대', 2, 2, 288, 1, 1, F('bed_5'), { as: 'bed_double', tf: wideBed, var: 'wood', woodSkip: [14, 16, 66, 76], bed: { x0: 14, x1: 66, y0: 40, y1: 76, heads: [[24, 28], [56, 28]] } });
  it('bedroom', 'bed_double_linen', '아마포 부부 침대', 2, 2, 576, 2, 3, F('bed_9'), { as: 'bed_double', est: 'artisan', tf: wideBed, var: 'cloth', cloth: [170, 250, 0.15], clothRect: [10, 38, 70, 74], bed: BW(40, 31) });
  it('bedroom', 'bed_double_carved', '조각 부부 침대', 2, 2, 864, 2, 3, F('bed_8'), { as: 'bed_double', est: 'artisan', tf: wideBed, var: 'wood', bed: BW(40, 31) });
  it('bedroom', 'bed_double_feather', '깃털 부부 침대', 2, 2, 1152, 3, 4, F('bed_10'), { as: 'bed_double', est: 'merchant', tf: wideBed, var: 'wood', woodSkip: [10, 18, 70, 70], bed: BW(40, 31) });
  it('bedroom', 'bed_double_rose', '장미빛 누비 부부 침대', 2, 2, 1728, 3, 5, F('bed_6'), { as: 'bed_double', est: 'merchant', tf: wideBed, var: 'wood', woodSkip: [10, 18, 70, 74], bed: BW(48, 32) });
  it('bedroom', 'bed_canopy', '휘장 침대', 2, 2, 3840, 4, 6, R(CA, 96, 224, 64, 112), { as: 'bed_double', est: 'noble', blob: true, bed: { x0: 4, x1: 60, y0: 58, y1: 100, heads: [[20, 50], [44, 50]] } });
  it('bedroom', 'chest_banded', '쇠띠 궤', 1, 1, 144, 1, 1, F('chests_1'), { as: 'chest_clothes', var: 'wood' });
  it('bedroom', 'chest_gilded', '금테 궤', 1, 1, 960, 3, 2, F('chests_2'), { as: 'chest_clothes', est: 'merchant' });
  it('bedroom', 'chest_strongbox', '큰 쇠궤', 2, 1, 480, 2, 1, F('chests_6'), { as: 'chest_clothes', est: 'artisan', var: 'wood' });
  it('bedroom', 'chest_blanket', '이불 덮은 궤', 2, 1, 216, 1, 2, G2('cabin interior - wooden chest 1 - tissue'), { as: 'chest_clothes', var: 'cloth', cloth: [60, 190, 0.2] });
  it('bedroom', 'chest_long', '긴 나무 궤', 2, 1, 168, 1, 1, G2('cabin interior - wooden chest 2'), { as: 'chest_clothes', var: 'wood' });
  it('bedroom', 'dresser_low', '낮은 서랍장', 2, 1, 384, 2, 2, F('cabinet_8'), { as: 'wardrobe', est: 'artisan', var: 'wood' });
  it('bedroom', 'dresser_wide', '넓은 서랍장', 3, 1, 576, 2, 2, F('cabinet_9'), { as: 'wardrobe', est: 'artisan', var: 'wood' });
  it('bedroom', 'dresser_tall', '키 큰 서랍장', 1, 1, 312, 2, 2, F('cabinet_14'), { as: 'chest_clothes', var: 'wood' });
  it('bedroom', 'dresser_tower', '높은 서랍장', 1, 1, 456, 2, 2, F('cabinet_15'), { as: 'chest_clothes', est: 'artisan', var: 'wood' });
  it('bedroom', 'wardrobe_painted', '문짝 그림 옷장', 2, 1, 720, 3, 3, F('cabinet_10'), { as: 'wardrobe', est: 'merchant', var: 'wood' });
  it('bedroom', 'nightstand', '침대 머리장', 1, 1, 96, 1, 1, F('cabinet_13'), { tags: ['surface', 'table', 'storage'], var: 'wood' });
  it('bedroom', 'nightstand_drawers', '작은 서랍 탁자', 1, 1, 120, 1, 1, F('Slice 45'), { tags: ['surface', 'table', 'storage'], var: 'wood' });
  it('bedroom', 'bedside_table', '서랍 달린 곁탁자', 1, 1, 72, 1, 1, F('headboard_1'), { tags: ['surface', 'table'], var: 'wood' });
  it('bedroom', 'bedside_cloth', '보 덮은 곁탁자', 1, 1, 108, 1, 1, F('headboard_2'), { tags: ['surface', 'table'], var: 'cloth', cloth: [170, 250, 0.2] });
  it('bedroom', 'bedside_small', '작은 보 탁자', 1, 1, 84, 1, 1, F('headboard_6'), { tags: ['surface', 'table'], var: 'cloth', cloth: [170, 250, 0.2] });
  it('bedroom', 'bedside_linen', '흰 보 곁탁자', 1, 1, 96, 1, 1, F('headboard_3'), { tags: ['surface', 'table'] });
  it('bedroom', 'mirror_standing', '체경', 1, 1, 1920, 3, 3, LR('Furniture/Mirror, Standing', 0, 0, 64, 64), { est: 'merchant', epic: true, blob: true, tags: ['mirror', 'glass'] });
  it('bedroom', 'clothes_hung', '걸어 둔 웃옷', 1, 1, 36, 1, 1, V('cloths_0'), { wall: true, var: 'cloth', cloth: [150, 210, 0.15], nat: { blue: V('cloths_0'), green: V('cloths_1'), purple: V('cloths_2'), grey: V('cloths_3') }, tags: ['clothes'] });
  it('bedroom', 'trousers_hung', '걸어 둔 바지', 1, 1, 24, 1, 0, V('cloths_6'), { wall: true, var: 'cloth', cloth: [150, 210, 0.15], nat: { blue: V('cloths_6'), purple: V('cloths_5'), green: V('cloths_7'), brown: V('cloths_4') }, tags: ['clothes'] });
  it('bedroom', 'bench_bedfoot', '침대 발치 걸상', 1, 1, 24, 0, 0, G2('cabin interior - bench'), { as: 'stool', var: 'wood' });
  it('bedroom', 'pillow_spare', '여분 베개', 1, 1, 18, 1, 0, G2('cabin interior - pilow'), { surface: true, tags: ['comfort'] });

  // ===== 부엌과 살림
  it('kitchen', 'hutch_crockery', '살림 찬장', 3, 1, 576, 2, 2, F('cabinet_3'), { as: 'cupboard', est: 'artisan', var: 'wood' });
  it('kitchen', 'hutch_wide', '넓은 찬장', 3, 1, 432, 2, 2, F('cabinet_4'), { as: 'cupboard', var: 'wood' });
  it('kitchen', 'hutch_narrow', '좁은 찬장', 1, 1, 216, 1, 1, F('cabinet_7'), { as: 'cupboard', var: 'wood' });
  it('kitchen', 'shelf_drawer', '서랍 선반장', 1, 1, 192, 1, 1, F('cabinet_18'), { as: 'cupboard', var: 'wood' });
  it('kitchen', 'shelf_open', '나무 선반장', 1, 1, 144, 1, 1, F('cabinet_30'), { as: 'cupboard', var: 'wood' });
  it('kitchen', 'shelf_doors', '문 달린 선반장', 1, 1, 240, 1, 1, F('cabinet_29'), { as: 'cupboard', var: 'wood' });
  it('kitchen', 'rack_sacks', '자루 시렁', 2, 1, 168, 1, 1, F('storage_countertop_0'), { as: 'cupboard' });
  it('kitchen', 'rack_bottles', '병 시렁', 2, 1, 240, 1, 1, F('storage_countertop_1'), { as: 'cupboard' });
  it('kitchen', 'rack_mixed', '살림 시렁', 2, 1, 216, 1, 1, F('storage_countertop_2'), { as: 'cupboard' });
  it('kitchen', 'rack_jars', '단지 시렁', 2, 1, 228, 1, 1, F('storage_countertop_3'), { as: 'cupboard' });
  it('kitchen', 'rack_empty', '빈 시렁', 2, 1, 96, 0, 0, F('storage_countertop_4'), { as: 'cupboard', var: 'wood' });
  it('kitchen', 'wine_rack', '술통 시렁', 3, 2, 1152, 2, 2, F('storage_countertop2_1'), { est: 'merchant', tags: ['storage', 'ale'] });
  it('kitchen', 'wine_rack_large', '큰 술통 시렁', 4, 2, 1728, 2, 2, F('storage_countertop2_0'), { est: 'merchant', tags: ['storage', 'ale'] });
  it('kitchen', 'keg_tap', '꼭지 달린 술통', 1, 1, 144, 1, 0, F('barrels2_0'), { tags: ['storage', 'ale'] });
  it('kitchen', 'keg_small', '작은 술통', 1, 1, 72, 1, 0, F('barrels2_1'), { surface: true, tags: ['ale'] });
  it('kitchen', 'barrel_open', '빈 나무통', 1, 1, 48, 0, 0, F('barrels_0'), { tags: ['storage'], var: 'wood' });
  it('kitchen', 'barrel_closed', '뉘어 둔 통', 1, 1, 56, 0, 0, F('barrels_3'), { tags: ['storage'] });
  it('kitchen', 'barrel_flour', '밀가루 통', 1, 1, 72, 1, 0, F('barrels3_5'), { tags: ['storage', 'food'] });
  it('kitchen', 'barrel_grain', '곡식 통', 1, 1, 64, 1, 0, F('barrels3_6'), { tags: ['storage', 'food'] });
  it('kitchen', 'barrel_salt', '소금 통', 1, 1, 80, 1, 0, F('barrels3_7'), { tags: ['storage', 'food'] });
  it('kitchen', 'barrel_group', '통 무더기', 3, 2, 144, 0, 0, F('barrels_7'), { tags: ['storage'] });
  it('kitchen', 'barrel_pair', '나란한 통', 2, 1, 96, 0, 0, F('barrels_8'), { tags: ['storage'] });
  it('kitchen', 'grain_barrels', '곡식 통 무더기', 2, 2, 240, 1, 0, F('barrels3_0'), { tags: ['storage', 'food'] });
  it('kitchen', 'crate_plain', '나무 상자', 1, 1, 24, 0, 0, F('crates_3'), { tags: ['storage'], var: 'wood' });
  it('kitchen', 'crate_banded', '쇠띠 상자', 1, 1, 36, 0, 0, F('crates_6'), { tags: ['storage'] });
  it('kitchen', 'crate_stack', '상자 더미', 2, 2, 72, 0, 0, F('crates_2'), { tags: ['storage'] });
  it('kitchen', 'crate_flour', '밀가루 상자', 1, 1, 48, 0, 0, F('crates_supply_17'), { tags: ['storage', 'food'] });
  it('kitchen', 'bin_tall', '곡식 뒤주', 1, 1, 60, 1, 0, F('crates_supply_11'), { tags: ['storage', 'food'] });
  it('kitchen', 'grain_bin', '곡식 궤짝', 2, 1, 96, 1, 0, V('grain-crate_0'), { tags: ['storage', 'food'] });
  it('kitchen', 'sack_single', '곡식 자루', 1, 1, 24, 0, 0, F('supply_bags_22'), { tags: ['storage', 'food'] });
  it('kitchen', 'sacks_pile', '자루 더미', 3, 1, 60, 0, 0, F('supply_bags_1'), { tags: ['storage', 'food'] });
  it('kitchen', 'sacks_heap', '쌓은 자루', 2, 1, 48, 0, 0, F('supply_bags_6'), { tags: ['storage', 'food'] });
  it('kitchen', 'sack_open', '열린 곡식 자루', 1, 1, 30, 0, 0, V('grain-sacks_0'), { tags: ['storage', 'food'] });
  it('kitchen', 'sacks_open_group', '열린 자루 무더기', 2, 2, 72, 0, 0, V('grain-sacks-pack_0'), { tags: ['storage', 'food'] });
  it('kitchen', 'stew_pot', '국솥', 1, 1, 60, 1, 0, F('kitchen_props2_4'), { tags: ['cookware'] });
  it('kitchen', 'pot_lidded', '뚜껑 솥', 1, 1, 72, 1, 0, F('kitchen_props2_7'), { tags: ['cookware'] });
  it('kitchen', 'cauldron_legs', '세발 가마솥', 1, 1, 96, 1, 0, G2('cauldron1'), { tags: ['cookware'] });
  it('kitchen', 'meat_hook', '고기 걸이', 1, 1, 120, 1, 1, F('kitchen_props5_1'), { wall: true, tags: ['food'] });
  it('kitchen', 'sausage_hook', '순대 걸이', 1, 1, 96, 1, 1, F('kitchen_props5_3'), { wall: true, tags: ['food'] });
  it('kitchen', 'drying_rack', '빈 말림 시렁', 3, 1, 96, 0, 0, F('kitchen_props6_1'), { tags: ['storage'] });
  it('kitchen', 'drying_rack_pots', '냄비 건 시렁', 3, 1, 144, 1, 1, F('kitchen_props6_2'), { tags: ['storage', 'cookware'] });
  it('kitchen', 'drying_rack_meat', '고기 건 시렁', 3, 1, 216, 1, 1, F('kitchen_props6_4'), { tags: ['storage', 'food'] });
  it('kitchen', 'basket_apples', '사과 바구니', 1, 1, 24, 1, 1, F('kitchen_props4_3'), { tags: ['food'] });
  it('kitchen', 'basket_roots', '뿌리채소 바구니', 1, 1, 18, 1, 1, F('kitchen_props4_1'), { tags: ['food'] });
  it('kitchen', 'basket_empty', '빈 바구니', 1, 1, 10, 0, 0, F('kitchen_props4_4'), { tags: ['storage'] });
  it('kitchen', 'basket_mixed', '채소 바구니', 1, 1, 20, 1, 1, F('kitchen_props4_9'), { tags: ['food'] });
  it('kitchen', 'bread_basket', '빵 바구니', 1, 1, 18, 1, 1, F('kitchen_props2_10'), { surface: true, tags: ['food'] });
  it('kitchen', 'cheese_wheel', '치즈 덩이', 1, 1, 48, 1, 1, F('kitchen_props2_9'), { surface: true, tags: ['food'] });
  it('kitchen', 'herbs_hanging', '말린 약초 다발', 1, 1, 24, 1, 1, R(TD, 0, 896, 32, 64), { wall: true, blob: true, tags: ['herbs'] });
  it('kitchen', 'garlic_string', '마늘 타래', 1, 1, 18, 1, 1, R(TD, 256, 896, 32, 64), { wall: true, blob: true, tags: ['food'] });
  it('kitchen', 'counter_block', '조리대 한 칸', 1, 1, 144, 1, 1, F('stand-1_part1'), { as: 'prep_counter', var: 'wood' });
  it('kitchen', 'counter_greens', '채소 올린 조리대', 1, 1, 168, 1, 1, F('stand-1_part5'), { as: 'prep_counter' });
  it('kitchen', 'butter_churn', '나무 교반기', 1, 1, 72, 1, 0, R(FARM, 96, 1256, 32, 72), { as: 'churn', blob: true, epic: true });

  // ===== 식당
  it('dining', 'table_cloth_large', '보 덮은 큰 식탁', 3, 2, 720, 2, 3, F('big_rect_table_1'), { as: 'dining_table', est: 'artisan', var: 'cloth', cloth: [60, 180, 0.2], nat: { green: F('big_rect_table_1'), yellow: F('big_rect_table_2'), blue: F('big_rect_table_3'), red: F('big_rect_table_5') } });
  it('dining', 'table_large', '큰 널 식탁', 3, 2, 432, 2, 2, F('big_rect_table_0'), { as: 'dining_table', var: 'wood' });
  it('dining', 'table_round_cloth', '보 덮은 둥근 식탁', 2, 2, 480, 2, 2, F('big_round_table_0'), { as: 'dining_table', var: 'cloth', cloth: [60, 180, 0.2], nat: { green: F('big_round_table_0'), blue: F('big_round_table_2') } });
  it('dining', 'table_round', '둥근 탁자', 1, 1, 144, 1, 1, F('round_table_0'), { as: 'dining_table', var: 'wood' });
  it('dining', 'table_round_small_cloth', '보 덮은 작은 원탁', 1, 1, 192, 1, 1, F('round_table_1'), { as: 'dining_table', var: 'cloth', cloth: [60, 180, 0.2], nat: { green: F('round_table_1'), blue: F('round_table_2') } });
  it('dining', 'table_trestle', '가대 식탁', 3, 1, 216, 1, 1, F('table_rect_0'), { as: 'dining_table', var: 'wood' });
  it('dining', 'table_feast', '음식 차린 긴 식탁', 3, 2, 360, 1, 2, F('tables_1'), { as: 'dining_table' });
  it('dining', 'table_narrow', '좁고 긴 식탁', 1, 3, 216, 1, 1, F('table_round_0'), { as: 'dining_table', var: 'wood' });
  it('dining', 'table_small', '작은 네모 탁자', 1, 1, 96, 1, 1, F('table_round_1'), { as: 'dining_table', var: 'wood' });
  it('dining', 'table_cloth_long', '보 덮은 긴 탁자', 3, 1, 360, 1, 2, V('table--4'), { as: 'dining_table', var: 'cloth', cloth: [230, 320, 0.15], nat: { purple: V('table--4'), brown: V('table--3') } });
  it('dining', 'table_cloth_square', '보 덮은 네모 식탁', 3, 2, 420, 1, 2, V('table--2'), { as: 'dining_table', var: 'cloth', cloth: [230, 320, 0.15], nat: { purple: V('table--2'), brown: V('table--1') } });
  it('dining', 'table_carved', '무늬 새긴 식탁', 3, 2, 540, 2, 2, V('table4'), { as: 'dining_table', est: 'artisan', var: 'wood' });
  it('dining', 'table_banquet', '흰 보 연회 식탁', 2, 3, 1920, 4, 4, LR('Furniture/Table, Ornate Wood', 104, 16, 72, 108), { as: 'dining_table', est: 'knight', blob: true });
  it('dining', 'chair_cushion', '방석 의자', 1, 1, 144, 2, 2, F('big_round_table_chairs_2'), { as: 'chair', est: 'artisan', rot: { '0': F('big_round_table_chairs_2'), '1': F('big_round_table_chairs_3'), '2': F('big_round_table_chairs_0'), '3': F('big_round_table_chairs_1') } });
  it('dining', 'chair_padded', '천 댄 의자', 1, 1, 120, 1, 1, chairA(4)['0'], { as: 'chair', epic: true, rot: chairA(4), var: 'cloth', natRot: { yellow: chairA(0), red: chairA(1), blue: chairA(2), green: chairA(3), brown: chairA(4), grey: chairA(6), white: chairA(7) } });
  it('dining', 'stool_cushion', '방석 걸상', 1, 1, 36, 1, 1, F('table_bench_0'), { as: 'stool' });
  it('dining', 'stool_log', '통나무 걸상', 1, 1, 12, 0, 0, V('table-bench1'), { as: 'stool' });
  it('dining', 'stool_plank', '널 걸상', 1, 1, 14, 0, 0, V('table-bench2'), { as: 'stool' });
  it('dining', 'bench_backed', '등받이 의자', 2, 1, 96, 1, 1, F('bench_0'), { as: 'bench', var: 'wood' });
  it('dining', 'bench_backed_long', '등받이 긴 의자', 3, 1, 144, 1, 2, F('bench_2'), { as: 'bench', var: 'wood' });
  it('dining', 'bench_low', '낮은 의자', 2, 1, 72, 1, 1, F('bench_1'), { as: 'bench', var: 'wood' });
  it('dining', 'bench_low_long', '낮은 긴 의자', 3, 1, 108, 1, 1, F('bench_3'), { as: 'bench', var: 'wood' });
  it('dining', 'bench_short', '짧은 널 의자', 2, 1, 48, 0, 0, F('table_bench_7'), { as: 'bench', var: 'wood' });
  it('dining', 'bench_side', '세로로 놓는 긴 의자', 1, 3, 60, 0, 0, F('table_bench_13'), { as: 'bench', var: 'wood' });
  it('dining', 'plate_pewter', '주석 접시', 1, 1, 24, 2, 1, F('kitchen_props4_12'), { surface: true, tags: ['tableware'] });
  it('dining', 'platter_wood', '나무 쟁반', 1, 1, 12, 1, 0, F('kitchen_props4_13'), { surface: true, tags: ['tableware'] });
  it('dining', 'platter_clay', '질그릇 쟁반', 1, 1, 10, 1, 0, F('kitchen_props4_14'), { surface: true, tags: ['tableware'] });
  it('dining', 'mug_pewter', '주석 잔', 1, 1, 12, 2, 0, F('kitchen_props3_0'), { surface: true, tags: ['tableware'] });
  it('dining', 'mug_clay', '질그릇 잔', 1, 1, 4, 0, 0, F('kitchen_props_24'), { surface: true, tags: ['tableware'] });
  it('dining', 'bowl_clay', '질그릇 사발', 1, 1, 4, 0, 0, F('kitchen_props_22'), { surface: true, tags: ['tableware'] });
  it('dining', 'bowl_porridge', '죽 사발', 1, 1, 6, 0, 0, F('kitchen_props_21'), { surface: true, tags: ['tableware', 'food'] });
  it('dining', 'wineskin', '가죽 술부대', 1, 1, 8, 1, 0, F('kitchen_props_36'), { surface: true, tags: ['tableware'] });
  it('dining', 'bottle_wine', '포도주 병', 1, 1, 36, 1, 0, F('kitchen_props_7'), { surface: true, tags: ['tableware'], var: 'cloth', nat: { red: F('kitchen_props_7'), green: F('kitchen_props_0'), blue: F('kitchen_props_1'), brown: F('kitchen_props_2') } });
  it('dining', 'roast_fowl', '통닭구이', 1, 1, 36, 1, 1, F('kitchen_props2_22'), { surface: true, tags: ['food'] });
  it('dining', 'bread_loaves', '빵 덩이', 1, 1, 9, 0, 0, F('kitchen_props2_29'), { surface: true, tags: ['food'] });

  // ===== 거실
  it('living', 'bookcase_double', '두 칸 책장', 2, 1, 720, 2, 3, F('cabinet_21'), { as: 'bookshelf', est: 'artisan', var: 'wood' });
  it('living', 'shelf_double_empty', '두 칸 빈 장', 2, 1, 288, 1, 1, F('cabinet_22'), { tags: ['storage', 'shelf'], var: 'wood' });
  it('living', 'shelf_arched', '아치 빈 장', 1, 1, 144, 1, 1, F('cabinet_16'), { tags: ['storage', 'shelf'], var: 'wood' });
  it('living', 'bookcase_doors', '문 달린 책장', 1, 1, 480, 2, 2, F('cabinet_24'), { as: 'bookshelf', est: 'artisan', var: 'wood' });
  it('living', 'bookcase_open', '열린 책장', 1, 1, 432, 2, 2, F('cabinet_25'), { as: 'bookshelf', var: 'wood' });
  it('living', 'bookcase_wide', '넓은 책장', 2, 1, 864, 3, 3, F('cabinet_27'), { as: 'bookshelf', est: 'merchant', var: 'wood' });
  it('living', 'cabinet_books', '책과 약병 장', 1, 1, 360, 2, 2, F('cabinet_00'), { as: 'bookshelf', var: 'wood' });
  it('living', 'cabinet_keepsakes', '기념품 장', 1, 1, 336, 2, 2, F('cabinet_1'), { as: 'bookshelf', var: 'wood' });
  it('living', 'display_hutch', '진열장', 3, 1, 960, 2, 3, F('drinks_shelf_0'), { tags: ['storage', 'display'], var: 'wood' });
  it('living', 'curio_glass', '유리병 진열장', 3, 1, 720, 2, 2, F('cabinet_2'), { est: 'merchant', tags: ['storage', 'display', 'glass'] });
  it('living', 'shelf_low', '낮은 선반', 1, 1, 96, 1, 1, F('cabinet_23'), { tags: ['storage', 'surface'], var: 'wood' });
  it('living', 'writing_desk', '글 쓰는 책상', 2, 1, 360, 2, 2, F('office_desk_5'), { tags: ['desk', 'study', 'surface'], var: 'wood' });
  it('living', 'desk_plain', '서랍 책상', 2, 1, 288, 1, 1, F('office_desk_6'), { tags: ['desk', 'study', 'surface'], var: 'wood' });
  it('living', 'desk_papers', '문서 책상', 2, 1, 336, 2, 2, F('cabinet_0'), { tags: ['desk', 'study', 'surface'], var: 'wood' });
  it('living', 'settee_gold', '금빛 긴 의자', 2, 1, 2880, 4, 5, R(CA, 160, 416, 64, 48), { as: 'bench', est: 'noble', blob: true });
  it('living', 'throne', '높은 등받이 의자', 1, 1, 4800, 4, 6, LR('Furniture/Seating/Thrones', 0, 0, 32, 64), { as: 'chair', est: 'noble', var: 'cloth', nat: { yellow: LR('Furniture/Seating/Thrones', 0, 0, 32, 64), red: LR('Furniture/Seating/Thrones', 64, 0, 32, 64), purple: LR('Furniture/Seating/Thrones', 128, 0, 32, 64), blue: LR('Furniture/Seating/Thrones', 192, 0, 32, 64), white: LR('Furniture/Seating/Thrones', 256, 0, 32, 64) } });
  it('living', 'chair_high', '금빛 높은 의자', 1, 1, 1920, 4, 4, R(CA, 224, 416, 32, 64), { as: 'chair', est: 'knight', blob: true });
  it('living', 'footstool_gold', '금빛 발받침', 1, 1, 720, 3, 2, R(CA, 160, 480, 48, 32), { as: 'stool', est: 'knight', blob: true });
  it('living', 'side_table_ornate', '무늬 곁탁자', 1, 1, 432, 3, 2, LR('Furniture/Table, Ornate Wood', 0, 0, 34, 32), { est: 'merchant', blob: true, epic: true, tags: ['surface', 'table'] });
  it('living', 'table_oval', '타원 곁탁자', 2, 1, 576, 3, 2, R(CA, 0, 560, 48, 48), { est: 'merchant', blob: true, tags: ['surface', 'table'] });
  it('living', 'globe', '지구의', 1, 1, 1440, 3, 2, F('decors_globe'), { est: 'clergy', tags: ['study', 'glass'] });
  it('living', 'chess_board', '서양 장기판', 1, 1, 144, 2, 1, R(TD, 320, 64, 32, 32), { surface: true, blob: true, tags: ['game', 'fun'] });
  it('living', 'dice_set', '주사위', 1, 1, 8, 0, 0, LR('Small Items/Games', 0, 0, 32, 32), { surface: true, tags: ['game', 'fun'] });
  it('living', 'fire_irons', '부지깽이 걸이', 1, 1, 96, 1, 1, R(CA, 96, 480, 32, 64), { blob: true, tags: ['hearth_tool'] });
  it('living', 'drum', '큰북', 1, 1, 180, 1, 1, R(TD, 384, 32, 32, 64), { as: 'lute', wall: false, blob: true });
  it('living', 'lute_small', '작은 류트', 1, 1, 288, 2, 1, R(TD, 416, 0, 32, 32), { as: 'lute', wall: true, blob: true });
  it('living', 'armor_display', '갑옷 진열대', 3, 1, 1440, 3, 3, F('decors_armor_9'), { est: 'knight', tags: ['display'] });
  it('living', 'armor_rack', '가슴 갑옷 걸이', 3, 1, 960, 2, 2, F('decors_armor_8'), { est: 'knight', tags: ['display'] });

  // ===== 씻기와 뒷일
  it('hygiene', 'tub_water', '물 담은 함지', 1, 1, 60, 1, 0, V('washbasin1'), { as: 'washtub' });
  it('hygiene', 'tub_small', '작은 물 함지', 1, 1, 36, 1, 0, V('washbasin2'), { as: 'washbasin' });
  it('hygiene', 'tub_round', '둥근 물 함지', 1, 1, 48, 1, 0, V('washbasin3'), { as: 'washbasin' });
  it('hygiene', 'tub_empty', '빈 함지', 1, 1, 40, 0, 0, V('washbasin4'), { as: 'washtub' });
  it('hygiene', 'bucket_water', '물 양동이', 1, 1, 12, 0, 0, V('bucket1'), { as: 'washbasin' });
  it('hygiene', 'bucket_wood', '나무 양동이', 1, 1, 8, 0, 0, V('bucket3'), { tags: ['bucket'] });
  it('hygiene', 'bucket_rope', '손잡이 양동이', 1, 1, 10, 0, 0, G1('bucket 2 - no grass'), { tags: ['bucket'] });
  it('hygiene', 'bucket_well', '두레박', 1, 1, 14, 0, 0, G1('bucket 1 - no grass'), { as: 'washbasin' });
  it('hygiene', 'towel', '수건 걸이', 1, 1, 24, 1, 1, V('towel_0'), { wall: true, var: 'cloth', cloth: [20, 70, 0.02], nat: { white: V('towel_0'), red: V('towel_1'), green: V('towel_2'), purple: V('towel_3'), blue: V('towel_7') }, tags: ['towel'] });
  it('hygiene', 'towel_embroidered', '수놓은 수건', 1, 1, 48, 2, 1, V('towel_6'), { wall: true, var: 'cloth', nat: { blue: V('towel_6'), red: V('towel_4') }, tags: ['towel'] });
  it('hygiene', 'mirror_wall', '벽거울', 1, 1, 960, 3, 2, LR('Wall Items/Mirrors', 0, 0, 32, 64), { wall: true, est: 'merchant', blob: true, epic: true, tags: ['mirror', 'glass'] });
  it('hygiene', 'basin_pewter', '주석 세숫대야', 1, 1, 240, 2, 1, basinPewter, { as: 'washbasin', est: 'artisan' });
  it('hygiene', 'stone_basin', '돌 물확', 1, 1, 180, 1, 1, R(DM, 128, 160, 32, 32), { as: 'washbasin', blob: true });

  // ===== 작업장
  it('work', 'smith_bench', '대장장이 작업대', 2, 1, 480, 2, 1, LR('Furniture/Smithing/Workbench, Smith', 0, 0, 64, 64), { est: 'artisan', epic: true, blob: true, tags: ['smith', 'work', 'surface'] });
  it('work', 'grindstone', '숫돌 바퀴', 2, 1, 240, 1, 1, GO('sword sharpener_frame1'), { tags: ['smith', 'work'] });
  it('work', 'grindstone_foot', '발 숫돌', 1, 1, 192, 1, 0, LR('Furniture/Smithing/Grindstone', 0, 0, 32, 64), { epic: true, blob: true, tags: ['smith', 'work'] });
  it('work', 'bellows', '풀무', 1, 1, 96, 1, 0, LR('Furniture/Smithing/Bellows', 0, 32, 64, 32), { epic: true, blob: true, tags: ['smith', 'work'] });
  it('work', 'coal_pile', '숯 무더기', 2, 1, 24, 0, 0, LR('Furniture/Smithing/Coal Piles', 200, 64, 64, 56), { blob: true, tags: ['smith', 'fuel'] });
  it('work', 'kiln_tall', '질그릇 가마', 2, 1, 720, 2, 0, GO('blacksmith props_38'), { est: 'artisan', tags: ['kiln', 'work'] });
  it('work', 'kiln_small', '작은 가마', 1, 1, 360, 1, 0, GO('blacksmith props_37'), { tags: ['kiln', 'work'] });
  it('work', 'anvil_stump', '그루터기 모루', 1, 1, 180, 1, 0, R(DM, 416, 736, 32, 32), { as: 'anvil', blob: true, epic: true });
  it('work', 'anvil_large', '큰 모루', 2, 1, 420, 2, 0, R(DM, 448, 768, 64, 32), { as: 'anvil', blob: true });
  it('work', 'weapon_rack', '무기 걸이대', 2, 1, 360, 2, 2, F('decors_weapon2_8'), { est: 'knight', tags: ['weapons', 'display'] });
  it('work', 'weapon_rack_empty', '빈 무기 걸이대', 2, 1, 120, 1, 1, F('decors_weapon2_7'), { tags: ['weapons'] });
  it('work', 'barrel_swords', '칼 꽂은 통', 1, 1, 144, 1, 0, F('decors_weapon_5'), { tags: ['weapons'] });
  it('work', 'barrel_axes', '도끼 꽂은 통', 1, 1, 120, 1, 0, F('decors_weapon_3'), { tags: ['weapons'] });
  it('work', 'sewing_table', '바느질 탁자', 2, 1, 240, 1, 1, LR('Furniture/Sewing & Weaving/Workbench, Sewing', 0, 0, 64, 64), { epic: true, blob: true, tags: ['sew', 'craft', 'work', 'surface'] });
  it('work', 'dress_form', '옷 틀', 1, 1, 144, 1, 1, LR('Furniture/Sewing & Weaving/Dress Form', 0, 0, 32, 32), { blob: true, tags: ['sew', 'work'] });
  it('work', 'sawhorse', '톱질 모탕', 1, 1, 48, 0, 0, LR('Furniture/Sawhorse', 0, 0, 32, 48), { epic: true, blob: true, tags: ['woodwork', 'work'] });
  it('work', 'shavehorse', '깎기 의자', 2, 1, 96, 1, 0, LR('Furniture/Shavehorse', 0, 0, 64, 64), { epic: true, blob: true, tags: ['woodwork', 'work'] });
  it('work', 'workshop_table', '공방 탁자', 3, 1, 192, 1, 1, LR('Furniture/Table, Workshop', 32, 0, 96, 64), { epic: true, blob: true, tags: ['work', 'surface'] });
  it('work', 'carpentry_tools', '목수 연장 걸이', 2, 1, 72, 1, 0, LR('Small Items/Tools, Carpentry', 0, 0, 64, 64), { wall: true, blob: true, tags: ['woodwork'] });
  it('work', 'farm_tools', '농기구 세움', 3, 1, 96, 1, 0, R(DM, 288, 576, 96, 64), { tags: ['farm_tools'] });
  it('work', 'smith_tools', '대장 연장', 2, 1, 120, 1, 0, R(DM, 352, 512, 64, 32), { tags: ['smith'] });
  it('work', 'scribe_desk', '필사대', 1, 2, 288, 2, 2, F('office_desk_3'), { tags: ['desk', 'study', 'work'] });
  it('work', 'alchemy_table', '증류대', 2, 1, 720, 2, 1, R(HI, 0, 344, 64, 72), { est: 'artisan', blob: 'strict', tags: ['work', 'brew', 'herbal'] });
  it('work', 'apothecary_cabinet', '약재 찬장', 3, 1, 720, 2, 2, F('cabinet_5'), { est: 'artisan', tags: ['storage', 'herbal'] });
  it('work', 'fabric_rack', '천 두루마리 걸이', 2, 1, 240, 1, 1, LR('Small Items/Fabric/Fabril Rolls, Mounted', 0, 0, 64, 64), { blob: true, tags: ['sew', 'storage'] });
  it('work', 'fabric_bolts', '천 필 더미', 1, 1, 120, 1, 0, LR('Small Items/Fabric/Fabric Rolls, Groups', 0, 0, 64, 64), { blob: true, tags: ['sew', 'storage'] });
  it('work', 'chopping_stump', '도끼 박힌 그루터기', 1, 1, 24, 0, 0, R(DM, 448, 704, 32, 32), { as: 'chopping_block', blob: true, epic: true });
  it('work', 'woodpile_stack', '쌓은 장작', 2, 1, 36, 0, 0, V('logs_6'), { as: 'woodpile' });
  it('work', 'woodpile_logs', '통나무 더미', 2, 1, 30, 0, 0, V('logs_5'), { as: 'woodpile' });
  it('work', 'woodpile_split', '장작 무더기', 2, 1, 40, 0, 0, R(DM, 352, 640, 64, 64), { as: 'woodpile', blob: true, epic: true });
  it('work', 'logs_upright', '세워 둔 통나무', 1, 1, 12, 0, 0, V('logs_3'), { tags: ['wood_source'] });

  // ===== 장식
  const natIdx = (fn: (i: number) => Src, m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, i]) => [k, fn(i)]));
  const POT6 = (base: number) => natIdx((i) => F(`pots_${base + i}`), { brown: 0, green: 1, blue: 2, red: 3, purple: 4, yellow: 5 });
  it('decor', 'banner_eye', '눈 문양 기', 1, 1, 72, 1, 1, F('banner_0'), { wall: true, var: 'cloth', cloth: [60, 190, 0.2], nat: { green: F('banner_0'), purple: F('banner_4'), brown: F('banner_6') } });
  it('decor', 'banner_crest', '문장 기', 1, 1, 96, 1, 2, F('banner_1'), { wall: true, var: 'cloth', cloth: [60, 190, 0.2], nat: { green: F('banner_1'), red: F('banner_3'), purple: F('banner_5'), brown: F('banner_7') } });
  it('decor', 'banner_sword', '칼 문양 기', 1, 1, 96, 1, 2, F('banner_2'), { wall: true, var: 'cloth', cloth: [320, 20, 0.3] });
  it('decor', 'shield_plain', '민 방패', 1, 1, 96, 1, 1, F('decor_animals_0'), { wall: true, var: 'cloth', nat: { blue: F('decor_animals_0'), brown: F('decor_animals_1') } });
  it('decor', 'trophy_boar', '멧돼지 머리 박제', 1, 1, 288, 2, 2, F('decor_animals_2'), { wall: true, est: 'knight', var: 'cloth', nat: { blue: F('decor_animals_2'), brown: F('decor_animals_3') } });
  it('decor', 'trophy_boar_old', '늙은 멧돼지 박제', 1, 1, 336, 2, 2, F('decor_animals_4'), { wall: true, est: 'knight', var: 'cloth', nat: { blue: F('decor_animals_4'), brown: F('decor_animals_5') } });
  it('decor', 'shield_swords', '칼 걸린 방패', 2, 1, 360, 2, 2, F('decor_shields_0'), { wall: true, est: 'knight' });
  it('decor', 'shield_round_swords', '칼 걸린 둥근 방패', 2, 1, 360, 2, 2, F('decor_shields_1'), { wall: true, est: 'knight' });
  it('decor', 'shield_plank', '널 방패', 1, 1, 144, 1, 1, F('decor_shields_2'), { wall: true });
  it('decor', 'shield_round', '둥근 방패', 1, 1, 168, 1, 1, F('decor_shields_3'), { wall: true });
  it('decor', 'shield_axes', '도끼 걸린 방패', 2, 1, 360, 2, 2, F('decor_shields_4'), { wall: true, est: 'knight' });
  it('decor', 'shield_round_axes', '도끼 걸린 둥근 방패', 2, 1, 360, 2, 2, F('decor_shields_5'), { wall: true, est: 'knight' });
  it('decor', 'swords_crossed', '엇건 칼', 1, 1, 240, 2, 1, F('decor_shields_6'), { wall: true, est: 'knight' });
  it('decor', 'antlers', '사슴뿔', 3, 1, 240, 2, 2, F('decor_shields_7'), { wall: true });
  it('decor', 'helmet_stand', '투구 받침', 1, 1, 480, 2, 1, F('decors_armor_0'), { est: 'knight', tags: ['display'] });
  it('decor', 'helmet_visored', '면갑 투구 받침', 1, 1, 540, 2, 1, F('decors_armor_6'), { est: 'knight', tags: ['display'] });
  it('decor', 'sword_wall', '벽에 건 장검', 1, 1, 288, 2, 1, F('decors_weapon2_0'), { wall: true, est: 'knight' });
  it('decor', 'axe_wall', '벽에 건 도끼', 1, 1, 144, 1, 1, F('decors_weapon2_6'), { wall: true });
  it('decor', 'weapons_wall', '무기 벽걸이', 1, 1, 240, 2, 1, F('decors_weapon_12'), { wall: true });
  it('decor', 'painting_portrait', '귀부인 초상', 1, 1, 720, 3, 3, F('decors_paintings_0'), { wall: true, est: 'merchant', tags: ['painting'] });
  it('decor', 'painting_man', '사내 초상', 1, 1, 480, 2, 2, F('decors_paintings_2'), { wall: true, tags: ['painting'] });
  it('decor', 'painting_hills', '언덕 그림', 1, 1, 480, 2, 2, F('decors_paintings_3'), { wall: true, tags: ['painting'] });
  it('decor', 'painting_map', '지도 액자', 1, 1, 360, 2, 2, F('decors_paintings_4'), { wall: true, tags: ['painting'] });
  it('decor', 'painting_mountains', '산맥 그림', 2, 1, 960, 3, 3, F('decors_paintings_6'), { wall: true, est: 'merchant', tags: ['painting'] });
  it('decor', 'painting_valley', '골짜기 그림', 2, 1, 960, 3, 3, F('decors_paintings_7'), { wall: true, est: 'merchant', tags: ['painting'] });
  it('decor', 'portrait_king', '임금 초상', 1, 1, 2880, 4, 4, R(CA, 208, 488, 32, 48), { wall: true, est: 'noble', blob: true, tags: ['painting'] });
  it('decor', 'portrait_small', '작은 초상', 1, 1, 720, 3, 2, R(CA, 192, 384, 32, 32), { wall: true, est: 'merchant', blob: true, tags: ['painting'] });
  it('decor', 'vase_roses', '장미 꽂은 병', 1, 1, 480, 3, 2, R(CA, 200, 560, 24, 48), { surface: true, est: 'merchant', blob: true, tags: ['flowers', 'glass'] });
  it('decor', 'potted_tree_glass', '유리 화분 나무', 1, 1, 960, 3, 2, R(CA, 224, 560, 32, 48), { as: 'plant_pot', est: 'merchant', blob: true });
  it('decor', 'books_stack', '쌓은 책', 1, 1, 36, 1, 1, F('decors_books_0'), { surface: true, tags: ['books'] });
  it('decor', 'books_row', '나란한 책', 1, 1, 60, 1, 1, F('decors_books_5'), { surface: true, tags: ['books'] });
  it('decor', 'book_open', '펼친 책', 1, 1, 48, 1, 1, F('decors_books_8'), { surface: true, tags: ['books'] });
  it('decor', 'scroll_rolled', '두루마리', 1, 1, 12, 1, 0, F('decors_books_7'), { surface: true, tags: ['books'] });
  it('decor', 'books_colored', '빛깔 책 묶음', 1, 1, 60, 1, 1, F('decors_books_9'), { surface: true, tags: ['books'] });
  it('decor', 'jar_small', '작은 단지', 1, 1, 16, 1, 0, F('pots_0'), { surface: true, var: 'cloth', nat: POT6(0) });
  it('decor', 'jar_round', '둥근 단지', 1, 1, 20, 1, 0, F('pots_6'), { surface: true, var: 'cloth', nat: POT6(6) });
  it('decor', 'vase_tall', '큰 항아리', 1, 1, 36, 1, 1, F('pots_12'), { var: 'cloth', nat: POT6(12) });
  it('decor', 'vase_slim', '목 긴 병', 1, 1, 30, 1, 1, F('pots_18'), { surface: true, var: 'cloth', nat: POT6(18) });
  it('decor', 'vase_urn', '배불뚝 항아리', 1, 1, 42, 1, 1, F('pots_24'), { var: 'cloth', nat: POT6(24) });
  it('decor', 'amphora', '손잡이 항아리', 1, 1, 48, 1, 1, F('pots_30'), { var: 'cloth', nat: POT6(30) });
  it('decor', 'pots_group', '항아리 무리', 2, 1, 96, 1, 1, F('pots_pack_1'), {});
  it('decor', 'vase_painted', '채색 항아리', 1, 1, 144, 2, 1, G2('vendor - vase - 2'), { surface: true, est: 'artisan', var: 'cloth', nat: { red: G2('vendor - vase - 2'), purple: G2('vendor - vase - 1'), blue: G2('vendor - vase - 4'), green: G2('vendor - vase - 5') } });
  it('decor', 'potted_tree', '화분 나무', 1, 1, 60, 1, 1, F('plants_1'), { as: 'plant_pot', var: 'cloth', nat: { green: F('plants_1'), yellow: F('plants_3') } });
  it('decor', 'potted_tree_tall', '큰 화분 나무', 1, 1, 84, 1, 2, F('plants_9'), { as: 'plant_pot', var: 'cloth', nat: { green: F('plants_9'), yellow: F('plants_11') } });
  it('decor', 'potted_shrub', '상자 화분', 1, 1, 72, 1, 1, F('plants_13'), { as: 'plant_pot', var: 'cloth', nat: { green: F('plants_13'), yellow: F('plants_15') } });
  it('decor', 'potted_sapling', '어린 나무 화분', 1, 1, 60, 1, 1, F('plants_17'), { as: 'plant_pot', var: 'cloth', nat: { green: F('plants_17'), yellow: F('plants_19') } });
  it('decor', 'potted_cone', '뾰족 화분', 1, 1, 48, 1, 1, F('plants_5'), { as: 'plant_pot', var: 'cloth', nat: { green: F('plants_5'), yellow: F('plants_7') } });
  it('decor', 'pot_sunflower', '해바라기 화분', 1, 1, 30, 1, 1, V('potted-flower_11'), { as: 'plant_pot' });
  it('decor', 'pot_daisy', '들국화 화분', 1, 1, 24, 1, 1, V('potted-flower_9'), { as: 'plant_pot' });
  it('decor', 'pot_sunflower_tall', '큰 해바라기 화분', 1, 1, 36, 1, 1, V('potted-flower_12'), { as: 'plant_pot' });
  it('decor', 'pot_marigold', '금잔화 화분', 1, 1, 24, 1, 1, V('potted-flower_10'), { as: 'plant_pot' });
  it('decor', 'potted_bush', '덤불 화분', 1, 1, 42, 1, 1, V('potted-plant_2'), { as: 'plant_pot' });
  it('decor', 'potted_bush_box', '네모 덤불 화분', 1, 1, 48, 1, 1, V('potted-plant_3'), { as: 'plant_pot' });
  it('decor', 'window_box_pink', '분홍 꽃 창가 상자', 2, 1, 48, 1, 1, D('flowers_plants_1'), { wall: true, tags: ['plant'] });
  it('decor', 'window_box_green', '푸른 잎 창가 상자', 2, 1, 36, 1, 1, D('flowers_plants_0'), { wall: true, tags: ['plant'] });
  it('decor', 'rug_runner', '긴 깔개', 4, 1, 144, 1, 1, D('porch-stairs-carpet'), { rug: true, var: 'cloth', cloth: [150, 260, 0.15] });
  it('decor', 'rug_rag', '헝겊 깔개', 1, 2, 48, 0, 1, G2('cabin interior - carpet'), { rug: true });
  it('decor', 'bearskin', '곰 가죽', 2, 2, 480, 2, 2, G2('cabin interior - bear carpet'), { rug: true });
  it('decor', 'fur_black', '검은 곰 가죽', 3, 2, 720, 3, 3, R(TD, 320, 1088, 96, 64), { rug: true, est: 'knight', blob: true });
  it('decor', 'fur_white', '흰 곰 가죽', 3, 2, 960, 3, 3, R(TD, 320, 1152, 96, 64), { rug: true, est: 'noble', blob: true });
  it('decor', 'fur_brown', '갈색 곰 가죽', 3, 2, 480, 2, 2, R(TD, 416, 1088, 96, 64), { rug: true, blob: true });
  it('decor', 'rug_red_gold', '금테 붉은 양탄자', 3, 3, 2880, 4, 5, R(CA, 0, 128, 96, 96), { rug: true, est: 'noble' });
  it('decor', 'rug_red_border', '테두리 붉은 양탄자', 3, 3, 1920, 3, 4, R(CI, 40, 0, 96, 100), { rug: true, est: 'knight', blob: 'strict' });
  it('decor', 'rug_diamond', '마름모 깔개', 3, 3, 360, 2, 2, LR('Furniture/Rugs/Diamond Rug, tiling', 0, 0, 96, 96), { rug: true, var: 'cloth', cloth: [0, 360, 0.25], nat: { blue: LR('Furniture/Rugs/Diamond Rug, tiling', 0, 0, 96, 96), green: LR('Furniture/Rugs/Diamond Rug, tiling', 96, 0, 96, 96), yellow: LR('Furniture/Rugs/Diamond Rug, tiling', 192, 0, 96, 96), purple: LR('Furniture/Rugs/Diamond Rug, tiling', 0, 96, 96, 96), grey: LR('Furniture/Rugs/Diamond Rug, tiling', 192, 96, 96, 96), white: LR('Furniture/Rugs/Diamond Rug, tiling', 288, 96, 96, 96) } });
  it('decor', 'rug_vine', '덩굴 무늬 깔개', 5, 2, 480, 2, 3, LR('Furniture/Rugs/Swirling Vine Rug', 0, 0, 160, 64), { rug: true, est: 'artisan', var: 'cloth', nat: { blue: LR('Furniture/Rugs/Swirling Vine Rug', 0, 0, 160, 64), red: LR('Furniture/Rugs/Swirling Vine Rug', 0, 64, 160, 64) } });
  it('decor', 'curtain', '휘장', 1, 1, 96, 1, 1, R(TD, 0, 1472, 32, 96), { wall: true, blob: true, var: 'cloth', cloth: [0, 360, 0], nat: { white: R(TD, 0, 1472, 32, 96), blue: R(TD, 96, 1472, 32, 96), green: R(TD, 192, 1472, 32, 96), red: R(TD, 288, 1472, 32, 96), yellow: R(TD, 384, 1472, 32, 96) } });
  it('decor', 'cloth_hanging', '걸어 둔 천', 1, 1, 60, 1, 1, R(DM, 0, 1216, 32, 64), { wall: true, blob: true, var: 'cloth', nat: { white: R(DM, 0, 1216, 32, 64), blue: R(DM, 32, 1216, 32, 64), green: R(DM, 64, 1216, 32, 64), red: R(DM, 96, 1216, 32, 64), yellow: R(DM, 128, 1216, 32, 64) } });
  it('decor', 'heraldic_banner', '가문 문장 기', 1, 1, 720, 3, 3, R(TD, 352, 1312, 32, 64), { wall: true, est: 'knight', blob: true });
  it('decor', 'sign_ale', '술집 간판', 1, 1, 60, 1, 0, R(DM, 224, 32, 32, 32), { wall: true, blob: true, epic: true, tags: ['sign'] });
  it('decor', 'sign_bread', '빵집 간판', 1, 1, 60, 1, 0, R(DM, 288, 0, 32, 32), { wall: true, blob: true, epic: true, tags: ['sign'] });
  it('decor', 'sign_sword', '대장간 간판', 1, 1, 60, 1, 0, R(DM, 224, 0, 32, 32), { wall: true, blob: true, epic: true, tags: ['sign'] });
  it('decor', 'sign_sack', '가게 간판', 1, 1, 60, 1, 0, R(DM, 256, 0, 32, 32), { wall: true, blob: true, epic: true, tags: ['sign'] });
  it('decor', 'bunting', '축제 깃발 줄', 5, 1, 60, 1, 1, V('pennant-bunting_1'), { wall: true, tags: ['festive'] });
  it('decor', 'trophy_stag', '사슴 머리 박제', 1, 1, 480, 2, 2, R(TD, 128, 1088, 32, 32), { wall: true, est: 'knight', blob: true });
  it('decor', 'trophy_bear', '곰 머리 박제', 1, 1, 600, 3, 2, R(TD, 32, 1088, 32, 32), { wall: true, est: 'knight', blob: true });
  it('decor', 'trophy_fish', '큰 물고기 박제', 1, 1, 144, 1, 1, R(TD, 96, 1088, 32, 32), { wall: true, blob: true });
  it('decor', 'statue_wolf', '늑대 석상', 1, 1, 720, 2, 2, R(DM, 64, 288, 32, 64), { blob: true, tags: ['statue'] });

  // ===== 조명 (기능: 촛대. 켜면 lit 상태, light = 빛 반경 칸)
  it('light', 'candelabra_iron', '쇠 세 가지 촛대', 1, 1, 144, 2, 1, F('candlesticks_7'), { as: 'candlestick', surface: true, light: 3, lit: { tips: [] } });
  it('light', 'candelabra_brass', '놋쇠 세 가지 촛대', 1, 1, 720, 3, 2, F('candlesticks_9'), { as: 'candlestick', surface: true, est: 'merchant', light: 3, lit: { tips: [] } });
  it('light', 'candle_pair_iron', '쇠 쌍촛대', 1, 1, 60, 1, 1, F('candlesticks_22'), { as: 'candlestick', surface: true, light: 2, lit: { tips: [] } });
  it('light', 'candle_pair_copper', '구리 쌍촛대', 1, 1, 84, 1, 1, F('candlesticks_23'), { as: 'candlestick', surface: true, light: 2, lit: { tips: [] } });
  it('light', 'candle_triple_iron', '쇠 세 촛대', 1, 1, 90, 1, 1, F('candlesticks_24'), { as: 'candlestick', surface: true, light: 3, lit: { tips: [] } });
  it('light', 'candle_triple_copper', '구리 세 촛대', 1, 1, 120, 2, 1, F('candlesticks_25'), { as: 'candlestick', surface: true, light: 3, lit: { tips: [] } });
  it('light', 'candle_single_iron', '쇠 외촛대', 1, 1, 24, 1, 0, F('candlesticks_26'), { as: 'candlestick', surface: true, light: 2, lit: { tips: [] } });
  it('light', 'candle_single_copper', '구리 외촛대', 1, 1, 36, 1, 0, F('candlesticks_27'), { as: 'candlestick', surface: true, light: 2, lit: { tips: [] } });
  it('light', 'candle_tall', '긴 양초', 1, 1, 18, 1, 0, F('candlestickss_4'), { as: 'candlestick', surface: true, light: 2, lit: { tips: [] } });
  it('light', 'chandelier', '둥근 샹들리에', 1, 1, 2400, 3, 3, F('chandelier'), { as: 'candlestick', blocks: false, est: 'knight', light: 6, lift: 40, lit: { tips: [] } });
  it('light', 'candle_silver', '은 외촛대', 1, 1, 480, 3, 1, R(CA, 168, 544, 24, 32), { as: 'candlestick', surface: true, est: 'merchant', blob: true, light: 2, lit: { tips: [] } });
  it('light', 'lantern_wall', '쇠 벽등', 1, 1, 96, 1, 1, F('candlesticks_12'), { as: 'candlestick', wall: true, light: 4, lit: { glow: true } });
  it('light', 'lantern_wall_brass', '놋쇠 벽등', 1, 1, 144, 2, 1, F('candlesticks_13'), { as: 'candlestick', wall: true, light: 4, lit: { glow: true } });
  it('light', 'lantern_hanging', '매단 등', 1, 1, 108, 1, 1, F('candlesticks_14'), { as: 'candlestick', wall: true, light: 4, lit: { glow: true } });
  it('light', 'lamp_post', '쇠 가로등', 1, 1, 360, 2, 0, V('lamp-post1'), { as: 'candlestick', light: 5, lit: { warm: true }, tags: ['outdoor'] });
  it('light', 'lamp_post_wood', '나무 등대', 1, 1, 180, 1, 0, G1('lamp post 1 - lamp - no grass'), { as: 'candlestick', light: 5, lit: { warm: true }, tags: ['outdoor'] });
  it('light', 'lamp_post_bent', '굽은 나무 등대', 1, 1, 180, 1, 0, G1('lamp post 3 - lamp - no grass'), { as: 'candlestick', light: 5, lit: { warm: true }, tags: ['outdoor'] });
  it('light', 'lamp_post_old', '낡은 등대', 1, 1, 150, 1, 0, GO('lamp post - with lamp_0'), { as: 'candlestick', light: 5, lit: { warm: true }, tags: ['outdoor'] });
  it('light', 'wall_lamp', '작은 벽등', 1, 1, 72, 1, 1, D('lamp_0'), { as: 'candlestick', wall: true, light: 3, lit: { on: [D('lamp_2')] } });
  it('light', 'wall_lamp_bracket', '쇠받침 벽등', 1, 1, 84, 1, 1, D('lamp_1'), { as: 'candlestick', wall: true, light: 3, lit: { on: [D('lamp_3')] } });
  it('light', 'hanging_lamp', '처마 등', 1, 1, 96, 1, 1, D('lamp_4'), { as: 'candlestick', wall: true, light: 4, lit: { on: [D('lamp_6')] } });
  it('light', 'hanging_lamp_bracket', '쇠받침 처마 등', 1, 1, 108, 1, 1, D('lamp_5'), { as: 'candlestick', wall: true, light: 4, lit: { on: [D('lamp_7')] } });
  it('light', 'candelabra_floor', '큰 쇠 촛대', 1, 1, 1440, 3, 2, R(CA, 64, 448, 32, 96), { as: 'candlestick', est: 'knight', blob: true, light: 4, lit: { tips: [] } });
  it('light', 'chandelier_iron', '쇠고리 샹들리에', 1, 1, 720, 2, 2, R(TD, 0, 288, 64, 64), { as: 'candlestick', blocks: false, blob: true, light: 5, lift: 40, lit: { tips: [] } });
  it('light', 'lantern_standing', '세운 등불', 1, 1, 84, 1, 1, R(DM, 384, 64, 32, 32), { as: 'candlestick', surface: true, blob: true, light: 3, lit: { on: [R(DM, 416, 64, 32, 32)] } });
  it('light', 'lantern_bracket', '걸이 등불', 1, 1, 96, 1, 1, R(DM, 384, 96, 32, 32), { as: 'candlestick', wall: true, blob: true, light: 3, lit: { on: [R(DM, 416, 96, 32, 32)] } });
  it('light', 'torch_wall', '벽 횃불', 1, 1, 24, 0, 0, R(DM, 384, 192, 32, 32), { as: 'candlestick', wall: true, blob: true, light: 4, lit: { on: frames(DM, [416, 448, 480], 160, 32, 32), fps: 8 } });
  it('light', 'brazier', '쇠 화로', 1, 1, 360, 2, 1, R(CI, 448, 0, 32, 32), { as: 'candlestick', blob: true, light: 4, lit: { on: frames(CI, [512, 544, 576], 0, 32, 32), fps: 8 } });

  // ===== 아이
  it('kids', 'bed_child', '아이 침대', 1, 2, 144, 1, 1, R(HI, 448, 0, 32, 96), { as: 'bed_straw', blob: true, tags: ['child_bed'], bed: { x0: 2, x1: 30, y0: 40, y1: 92, heads: [[16, 26]] } });
  it('kids', 'bed_child_quilt', '누비 아이 침대', 1, 2, 216, 2, 2, R(CI, 192, 0, 32, 96), { as: 'bed_straw', blob: true, tags: ['child_bed'], var: 'cloth', cloth: [180, 290, 0.15], nat: { blue: R(CI, 192, 0, 32, 96), purple: R(CI, 160, 0, 32, 96) }, bed: { x0: 2, x1: 30, y0: 36, y1: 92, heads: [[16, 24]] } });
  it('kids', 'baby_basket', '아기 바구니', 1, 1, 60, 1, 1, LR('Small Items/Baskets A', 64, 32, 32, 32), { blob: true, epic: true, tags: ['crib', 'baby'] });
  it('kids', 'toy_chest', '장난감 궤', 1, 1, 96, 1, 1, F('chests_4'), { tags: ['toy', 'storage'] });
  it('kids', 'wooden_sword', '나무칼', 1, 1, 12, 1, 1, woodenSword, { tags: ['toy'] });
  it('kids', 'toy_shield', '나무 방패 장난감', 1, 1, 18, 1, 1, F('decor_animals_1'), { tags: ['toy'] });
  it('kids', 'child_table', '아이 탁자', 1, 1, 48, 1, 1, F('headboard_5'), { tags: ['surface', 'table'] });
  it('kids', 'archery_target', '과녁', 1, 1, 60, 1, 1, R(DM, 160, 1568, 32, 32), { blob: true, tags: ['toy', 'fun'] });
  it('kids', 'game_board', '말판 놀이', 1, 1, 60, 1, 1, R(TD, 288, 64, 32, 32), { surface: true, blob: true, tags: ['toy', 'game', 'fun'] });
  it('kids', 'toy_drum', '작은 북', 1, 1, 72, 1, 1, R(TD, 352, 0, 32, 32), { as: 'lute', wall: false, blob: true, tags: ['toy'] });
  it('kids', 'rug_nursery', '알록달록 줄무늬 깔개', 3, 2, 144, 1, 2, LR('Furniture/Rugs/Rainbow Rug', 0, 0, 96, 72), { rug: true, blob: true });

  // ===== 가축과 짐승 (M12 에서 기능 연결, 지금은 장식 + 태그)
  it('animal', 'trough_water', '물구유', 2, 1, 96, 1, 0, GO('water deposit_frame1'), { anim: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => GO(`water deposit_frame${i}`)), fps: 6, tags: ['trough', 'water'] });
  it('animal', 'trough_hay', '건초 구유', 3, 1, 72, 1, 0, R(DM, 416, 544, 96, 32), { blob: true, epic: true, tags: ['trough', 'feed'] });
  it('animal', 'trough_long', '긴 물구유', 3, 1, 72, 1, 0, R(DM, 416, 576, 96, 32), { blob: true, epic: true, tags: ['trough', 'water'] });
  it('animal', 'trough_small', '작은 여물통', 2, 1, 60, 1, 0, LR('Furniture/Trough', 64, 192, 64, 32), { blob: true, epic: true, tags: ['trough', 'feed'] });
  it('animal', 'hay_bale_round', '둥근 건초 더미', 2, 2, 48, 0, 0, R(DM, 0, 640, 64, 96), { blob: true, tags: ['hay', 'feed'] });
  it('animal', 'hay_bales', '네모 건초 더미', 3, 2, 36, 0, 0, R(DM, 128, 704, 96, 64), { blob: true, tags: ['hay', 'feed'] });
  it('animal', 'straw_bedding', '짚 깔개', 2, 2, 12, 0, 0, LR('Small Items/Hay & Straw', 64, 0, 64, 96), { rug: true, blob: true, tags: ['hay', 'bedding'] });
  it('animal', 'dog_kennel', '개집', 2, 2, 144, 1, 0, R(DM, 352, 352, 64, 96), { blob: true, epic: true, tags: ['dog', 'pet_bed'] });
  it('animal', 'pet_bed', '개 방석', 1, 1, 36, 1, 1, G2('pet bed1'), { blocks: false, var: 'cloth', cloth: [170, 260, 0.2], tags: ['pet_bed'] });
  it('animal', 'beehive_skep', '짚 벌통', 1, 1, 72, 1, 0, R(FARM, 256, 1004, 32, 56), { blob: true, tags: ['beehive'] });
  it('animal', 'bee_tower', '나무 벌집', 1, 1, 144, 1, 0, R(FARM, 160, 996, 32, 64), { blob: true, tags: ['beehive'] });
  it('animal', 'skep_shelf', '벌통 선반', 3, 2, 216, 1, 0, R(FARM, 256, 1076, 128, 80), { blob: true, tags: ['beehive'] });
  it('animal', 'hitching_post', '말뚝', 1, 1, 24, 0, 0, R(FARM, 96, 1016, 32, 56), { blob: true, tags: ['horse'] });
  it('animal', 'hay_shelter', '나무 차양 헛간', 2, 2, 360, 1, 0, R(DM, 288, 640, 64, 128), { blob: true, epic: true, tags: ['hay', 'shelter'] });

  // ===== 바깥
  it('outdoor', 'tree_oak', '참나무', 2, 2, 120, 1, 0, G1('tree - color scheme 1 - 1'), { lift: 6, tags: ['tree'] });
  it('outdoor', 'tree_oak_tall', '키 큰 참나무', 1, 1, 96, 1, 0, G1('tree - color scheme 1 - 2'), { lift: 6, tags: ['tree'] });
  it('outdoor', 'tree_linden', '보리수', 2, 2, 120, 1, 0, G1('tree - color scheme 2 - 1'), { lift: 6, tags: ['tree'] });
  it('outdoor', 'tree_linden_tall', '키 큰 보리수', 1, 1, 96, 1, 0, G1('tree - color scheme 2 - 3'), { lift: 6, tags: ['tree'] });
  it('outdoor', 'tree_elm', '느릅나무', 1, 1, 96, 1, 0, G1('tree - color scheme 3 - 2'), { lift: 6, tags: ['tree'] });
  it('outdoor', 'tree_maple', '단풍나무', 2, 2, 180, 2, 0, G1('tree - color scheme 5 - 1'), { lift: 6, tags: ['tree'] });
  it('outdoor', 'tree_maple_tall', '키 큰 단풍나무', 1, 1, 144, 2, 0, G1('tree - color scheme 5 - 3'), { lift: 6, tags: ['tree'] });
  it('outdoor', 'tree_pine', '소나무', 2, 2, 96, 1, 0, V('pine-tree_3'), { lift: 4, tags: ['tree'] });
  it('outdoor', 'tree_fir', '전나무', 1, 1, 84, 1, 0, V('pine-tree_6'), { lift: 4, tags: ['tree'] });
  it('outdoor', 'tree_pine_young', '어린 소나무', 1, 1, 48, 1, 0, V('pine-tree_9'), { lift: 4, tags: ['tree'] });
  it('outdoor', 'tree_dead', '마른 나무', 2, 2, 24, 0, 0, G1('tree - naked 2'), { lift: 4, tags: ['tree'] });
  it('outdoor', 'tree_young', '어린 나무', 1, 1, 36, 1, 0, G1('tree - naked - small - no shadow and grass 1'), { lift: 4, tags: ['tree'] });
  it('outdoor', 'tree_apple_deco', '사과나무 (장식)', 2, 2, 144, 1, 0, '', { sprite: 'orchard_apples_2', tags: ['tree'] });
  it('outdoor', 'tree_pear_deco', '배나무 (장식)', 2, 2, 144, 1, 0, '', { sprite: 'orchard_pears_2', tags: ['tree'] });
  it('outdoor', 'bush', '덤불', 2, 1, 18, 0, 0, G1('bush 2'), { tags: ['bush'] });
  it('outdoor', 'bush_round', '작은 꽃덤불', 1, 1, 12, 0, 0, G1('bush 24'), { tags: ['bush'] });
  it('outdoor', 'bush_red_flowers', '붉은 꽃덤불', 2, 1, 30, 1, 0, G1('bush 14'), { tags: ['bush', 'flowers'] });
  it('outdoor', 'bush_blue_flowers', '푸른 꽃덤불', 2, 1, 30, 1, 0, G1('bush 15'), { tags: ['bush', 'flowers'] });
  it('outdoor', 'bush_white_flowers', '흰 꽃덤불', 2, 1, 30, 1, 0, G1('bush 19'), { tags: ['bush', 'flowers'] });
  it('outdoor', 'shrub_yellow', '노란 꽃나무', 1, 1, 24, 1, 0, G1('vegetation 2'), { tags: ['bush', 'flowers'] });
  it('outdoor', 'shrub_rose', '찔레 덤불', 1, 1, 24, 1, 0, G1('vegetation 3'), { tags: ['bush', 'flowers'] });
  it('outdoor', 'bush_berry', '열매 덤불', 2, 1, 24, 1, 0, GO('bushes_4'), { tags: ['bush'] });
  it('outdoor', 'wildflowers', '해바라기 한 포기', 1, 1, 4, 0, 0, `${GI}/items-flowers1_0.png`, { blocks: false, tags: ['flowers'] });
  it('outdoor', 'wildflowers_white', '흰 들꽃', 1, 1, 4, 0, 0, `${GI}/items-flowers3_0.png`, { blocks: false, tags: ['flowers'] });
  it('outdoor', 'flower_bed', '꽃 화단', 2, 1, 24, 1, 0, flowerBed, { blocks: false, tags: ['flowers'] });
  it('outdoor', 'mushrooms', '버섯 무리', 1, 1, 2, 0, 0, `${GI}/items-mushrooms1_0.png`, { blocks: false, tags: ['plant'] });
  it('outdoor', 'rock_small', '작은 바위', 1, 1, 4, 0, 0, G1('rocks - color scheme 1 - 20'), { tags: ['rock'] });
  it('outdoor', 'rock_big', '큰 바위', 2, 2, 12, 0, 0, G1('rocks - color scheme 1 - 5'), { tags: ['rock'] });
  it('outdoor', 'stump', '그루터기', 1, 1, 6, 0, 0, G1('trunk 1'), { tags: ['stump'] });
  it('outdoor', 'log_fallen', '쓰러진 통나무', 2, 2, 12, 0, 0, GO('trunks2__6'), { tags: ['wood_source'] });
  it('outdoor', 'handcart', '손수레', 2, 2, 144, 1, 0, R(DM, 224, 640, 64, 64), { blob: true, epic: true, tags: ['cart'] });
  it('outdoor', 'wheelbarrow', '외바퀴 수레', 3, 2, 120, 1, 0, R(DM, 192, 512, 96, 64), { blob: true, epic: true, tags: ['cart'] });
  it('outdoor', 'wagon', '짐마차', 2, 2, 480, 1, 0, GO('medieval wooden wagon_1'), { tags: ['cart'] });
  it('outdoor', 'hay_cart', '건초 수레', 2, 2, 180, 1, 0, R(DM, 160, 736, 64, 64), { blob: true, epic: true, tags: ['cart', 'hay'] });
  it('outdoor', 'scarecrow', '허수아비', 1, 1, 24, 1, 0, R(DM, 320, 128, 32, 64), { blob: true, tags: ['farm'] });
  it('outdoor', 'well_small', '작은 두레 우물', 2, 2, 480, 1, 0, G1('waterwell 2 - rope - no grass'), { as: 'well' });
  it('outdoor', 'well_roofed', '지붕 덮은 우물', 2, 2, 1440, 2, 0, wellRoofed, { as: 'well', est: 'freeman' });
  it('outdoor', 'well_stone', '돌 두레 우물', 2, 2, 960, 2, 0, R(DM, 448, 416, 64, 96), { as: 'well', blob: true, epic: true });
  it('outdoor', 'bench_garden', '뜰 긴 의자', 2, 1, 72, 1, 0, R(DM, 0, 928, 64, 32), { as: 'bench', blob: true, epic: true });
  it('outdoor', 'table_garden', '뜰 탁자', 3, 1, 180, 1, 0, G2('wooden table - rustic - on grass'), { as: 'dining_table' });
  it('outdoor', 'campfire', '모닥불', 1, 1, 36, 1, 0, R(DM, 320, 1568, 32, 32), { as: 'candlestick', blob: true, light: 5, lit: { on: frames(DM, [256, 288, 320, 352, 384], 1536, 32, 32), fps: 10 } });
  it('outdoor', 'notice_board', '알림판', 2, 1, 96, 1, 0, V('questboard_1'), { tags: ['sign'] });
  it('outdoor', 'signpost', '이정표', 2, 1, 36, 1, 0, G1('sign post'), { tags: ['sign'] });
  it('outdoor', 'sign_board', '나무 팻말', 1, 1, 12, 0, 0, G1('sign 1'), { tags: ['sign'] });
  it('outdoor', 'clothesline', '빨랫줄', 3, 1, 36, 0, 0, V('clothes-line_14'), { tags: ['laundry'] });
  it('outdoor', 'clothesline_linen', '천 널린 빨랫줄', 3, 1, 60, 1, 0, V('clothes-line_16'), { tags: ['laundry'] });
  it('outdoor', 'clothesline_tunics', '옷 널린 빨랫줄', 3, 1, 72, 1, 0, V('clothes-line_0'), { tags: ['laundry'] });
  it('outdoor', 'fountain', '돌 분수', 2, 2, 4800, 4, 0, R(DM, 0, 512, 64, 64), { est: 'noble', blob: true, anim: frames(DM, [0, 64, 128], 512, 64, 64), fps: 6, tags: ['water'] });
  it('outdoor', 'market_stall', '천막 좌판', 4, 2, 720, 1, 0, `${SEA}/little stalls_3.png`, { est: 'merchant', tags: ['stall', 'surface'] });
  it('outdoor', 'pond', '연못', 4, 4, 240, 1, 0, R(`${WATER}/water to grass(transparency) - river orientation-spritesheet.png`, 8, 40, 148, 156), { blob: 'strict', tags: ['water', 'pond'] });
  it('outdoor', 'sundial', '해시계', 1, 1, 720, 3, 0, R(DM, 32, 256, 32, 32), { blob: true, tags: ['stone'] });
  it('outdoor', 'barrel_rain', '빗물통', 1, 1, 36, 0, 0, G1('barrel 1 - no grass'), { tags: ['water'] });

  // ===== 신앙
  it('religion', 'offering_bowl', '봉헌 그릇 받침', 1, 1, 480, 2, 2, G2('shrine 1'), { tags: ['shrine', 'pray'] });
  it('religion', 'offering_bowl_tall', '높은 봉헌 그릇', 1, 1, 600, 2, 2, G2('shrine 1 - support 3'), { tags: ['shrine', 'pray'] });
  it('religion', 'offering_stand', '낮은 봉헌대', 1, 1, 360, 2, 1, G2('shrine 1 - support 4'), { tags: ['shrine', 'pray'] });
  it('religion', 'stone_pillar', '성인 기념 석주', 2, 2, 960, 3, 2, G2('shrine 2 - smaller pilar'), { tags: ['shrine', 'monument'] });
  it('religion', 'headstone_round', '둥근 묘비', 1, 1, 72, 1, 0, R(DM, 128, 96, 32, 32), { blob: true, tags: ['grave'] });
  it('religion', 'headstone_slab', '낮은 묘비', 1, 1, 60, 1, 0, R(DM, 0, 96, 32, 32), { blob: true, tags: ['grave'] });
  it('religion', 'headstone_double', '부부 묘비', 2, 1, 216, 2, 0, R(DM, 32, 16, 64, 48), { blob: true, tags: ['grave'] });
  it('religion', 'statue_maiden', '성녀상', 1, 1, 1440, 3, 3, R(DM, 32, 288, 32, 64), { blob: true, tags: ['shrine', 'pray', 'statue'] });
  it('religion', 'statue_hooded', '두건 쓴 성인상', 1, 1, 1440, 3, 3, R(DM, 96, 288, 32, 64), { blob: true, tags: ['shrine', 'pray', 'statue'] });
  it('religion', 'font_stone', '성수반', 1, 1, 720, 2, 2, R(DM, 128, 224, 32, 64), { blob: true, tags: ['shrine', 'holy_water'] });
  it('religion', 'lectern', '독서대', 1, 1, 480, 2, 2, R(CI, 448, 64, 32, 64), { blob: true, tags: ['pray', 'study'] });
  it('religion', 'bust_stone', '성인 흉상', 1, 1, 720, 3, 2, R(CI, 480, 64, 32, 32), { blob: true, surface: true, tags: ['shrine', 'statue'] });
  it('religion', 'monument_statue', '단 위의 성인상', 3, 3, 4800, 4, 3, R(DM, 160, 320, 96, 96), { est: 'clergy', blob: true, tags: ['shrine', 'pray', 'statue'] });
  it('religion', 'altar_candles', '제단 촛대', 1, 1, 480, 3, 2, R(TD, 256, 416, 32, 48), { as: 'candlestick', surface: true, blob: true, light: 3, lit: { tips: [] }, tags: ['shrine'] });

  // ---------------------------------------------------------------- build sprites
  interface Job { sid: string; group: string; frames: Img[]; ax: number; ay: number; fps?: number; light?: number }
  const jobs: Job[] = [];
  const put = (sid: string, group: string, frs: Img[], ax: number, ay: number, extra: { fps?: number; light?: number } = {}) => jobs.push({ sid, group, frames: frs, ax, ay, ...extra });
  const flameSheet = L(`${ANI}/candle_and_torch-candle_burning.png`); // 8 frames of 64x64
  const flame = (i: number) => { const f = crop(flameSheet, i * 64 + 26, 20, 12, 20); const b = bboxOf(f); return crop(f, b.x, b.y, b.w, b.h); };
  const isFlame = (c: RGBA) => { const [h, s, v] = hsv(c); return lum(c) > 205 || (h >= 15 && h < 65 && s > 0.45 && v > 0.8); };
  /** candle tips: top pixel of every near-white candle column cluster */
  const findTips = (img: Img): Array<[number, number]> => {
    const cand = (c: RGBA) => c[3] > 0 && hsv(c)[1] < 0.3 && lum(c) > 170;
    const W = img.w, seen = new Uint8Array(img.w * img.h), tips: Array<[number, number]> = [];
    for (let y = 0; y < img.h; y++) for (let x = 0; x < W; x++) {
      if (seen[y * W + x] || !cand(px(img, x, y))) continue;
      // component of candle-coloured pixels (4-neighbour); its top-most row centre = tip
      const st = [[x, y]]; seen[y * W + x] = 1; let top = y, xs: number[] = [], n = 0;
      while (st.length) {
        const [cx, cy] = st.pop()!; n++;
        if (cy < top) { top = cy; xs = [cx]; } else if (cy === top) xs.push(cx);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= img.h || seen[ny * W + nx] || !cand(px(img, nx, ny))) continue;
          seen[ny * W + nx] = 1; st.push([nx, ny]);
        }
      }
      if (n >= 3) tips.push([Math.round(xs.reduce((p, q) => p + q, 0) / xs.length), top]);
    }
    return tips;
  };
  const glowPred = (c: RGBA) => { const [h, s, v] = hsv(c); return h >= 35 && h < 70 && s > 0.35 && v > 0.7; };
  const WARM: RGBA[] = ['#b8742e', '#d99a3c', '#f0c056', '#fbe08a', '#fff4c4'].map((h) => hex(h));
  const DARK_GLASS: RGBA[] = ['#26303d', '#34404f', '#465466', '#5b6b7d'].map((h) => hex(h));

  const missingSrc: string[] = [];
  const reports: string[] = [];
  const catalog: Record<string, Record<string, unknown>> = {};
  const ko: Record<string, string> = {};

  const prep = (s: Src, item: Item): Img => {
    let im = load(s);
    if (item.blob) im = isolate(im, item.blob === 'strict');
    if (item.tf) im = item.tf(im);
    if (item.epic) im = rampRecolor(im, EPIC_WOOD, isWoodish);
    return im;
  };

  // every source must load (collect all failures first so one run shows them all)
  const bad: string[] = [];
  const ids = new Set<string>();
  for (const item of ITEMS) {
    if (ids.has(item.id)) bad.push(`${item.id}: id 중복`);
    ids.add(item.id);
    if (objects[item.id]) bad.push(`${item.id}: 기본 물건 id 와 겹침`);
    const srcs: Src[] = [...(item.sprite ? [] : [item.src]), ...Object.values(item.nat ?? {}), ...(item.anim ?? []), ...(item.lit?.on ?? []), ...Object.values(item.rot ?? {}),
      ...Object.values(item.natRot ?? {}).flatMap((r) => Object.values(r ?? {}))] as Src[];
    for (const s of srcs) { try { load(s); } catch (e) { bad.push(`${item.id}: ${(e as Error).message.split('\n')[0]}`); } }
  }
  if (bad.length) throw new Error('catalog sources:\n  ' + bad.join('\n  '));

  for (const item of ITEMS) {
    const fw = item.w, fh = item.h;
    const group = SA_PACKS.some((p) => [item.src, ...Object.values(item.nat ?? {}), ...(item.anim ?? []), ...(item.lit?.on ?? [])].some((s) => s && srcFile(s as Src).includes(p))) ? 'sa' : 'main';
    const objEntry: Record<string, unknown> = {};
    const variants: string[] = item.var === 'wood' ? WOODS : item.var === 'cloth' ? (item.cloth ? CLOTHS : Object.keys(item.nat ?? item.natRot ?? {})) : [];
    if (item.var === 'cloth' && item.natRot) for (const v of Object.keys(item.natRot)) if (!variants.includes(v)) variants.push(v);
    if (item.sprite) {
      if (!art.sprites[item.sprite]) throw new Error(`catalog ${item.id}: sprite ${item.sprite} 없음`);
      art.objects[item.id] = { default: item.sprite };
    } else {
      // ---- base image + anchor
      let base = prep(item.src, item);
      const PAD = item.lit?.tips ? 14 : 0;
      if (PAD) { const o = create(base.w, base.h + PAD); paste(o, base, 0, PAD); base = o; }
      const bb = bboxOf(base);
      const lift = item.lift ?? (item.wall ? Math.max(8, 44 - Math.round(bb.h / 2)) : item.surface ? 12 : item.rug ? Math.max(0, Math.round((fh * T - bb.h) / 2)) : 2);
      const a = kit.anchorFor(base, fw, lift, item.cx);
      // ---- states (same canvas as base)
      const states: Record<string, Img[]> = {};
      const stateFps: Record<string, number> = {};
      let defaultFrames: Img[] = [base];
      if (item.anim) { defaultFrames = item.anim.map((s) => { const im = prep(s, item); return im.w === base.w && im.h === base.h ? im : base; }); }
      let blanket: Img | null = null;
      if (item.as === 'bed_straw' || item.as === 'bed_double') {
        if (!item.bed) throw new Error(`catalog ${item.id}: 침대 기반인데 bed 정보 없음`);
        const bd = item.bed;
        blanket = keep(base, (_c, x, y) => x >= bd.x0 && x < bd.x1 && y >= bd.y0 && y < bd.y1);
        const heads: Record<string, [number, number]> = {};
        bd.heads.forEach(([hx, hy], i) => { heads[i ? `lie${i + 1}` : 'lie'] = [hx - a.ax, hy - (a.ay - fh * T)]; });
        objEntry.lieHeads = heads;
      }
      if (item.as === 'candlestick') {
        const lt = item.lit;
        if (!lt) throw new Error(`catalog ${item.id}: 촛대 기반인데 lit 정보 없음`);
        if (lt.tips) {
          const tips = lt.tips.length ? lt.tips.map(([x, y]) => [x, y + PAD] as [number, number]) : findTips(base);
          if (!tips.length) reports.push(`${item.id}: 초 끝을 못 찾음`);
          // unlit: clear the flame pixels just above each tip
          const unlit = mapPixels(base, (c, x, y) => (tips.some(([tx, ty]) => Math.abs(x - tx) <= 3 && y >= ty - 8 && y <= ty + 1) && isFlame(c) && lum(c) > 215 ? [0, 0, 0, 0] : null));
          const tipsAfter = tips.map(([tx, ty]) => { let y = ty; while (y < unlit.h - 1 && px(unlit, tx, y)[3] === 0) y++; return [tx, y] as [number, number]; });
          const litFrames: Img[] = [];
          for (let i = 0; i < 8; i++) {
            const o = clone(unlit);
            tipsAfter.forEach(([tx, ty], k) => { const f = flame((i + k * 3) % 8); paste(o, f, tx - Math.floor(f.w / 2), ty - f.h + 2); });
            litFrames.push(o);
          }
          defaultFrames = [unlit];
          states.lit = litFrames; stateFps.lit = lt.fps ?? 10;
        } else if (lt.warm) {
          const top = bb.y + bb.h * 0.6;
          const pale = (c: RGBA, _x: number, y: number) => y < top && hsv(c)[1] < 0.45 && hsv(c)[2] > 0.6 && !isWoodish(c);
          const m = rankMap([base], WARM, pale);
          if (!m.size) reports.push(`${item.id}: 등 유리를 못 찾음`);
          states.lit = [applyMap(base, m, pale)];
        } else if (lt.glow) {
          const glowMap = rankMap([base], DARK_GLASS, glowPred);
          const unlit = applyMap(base, glowMap, glowPred);
          if (!glowMap.size) reports.push(`${item.id}: 빛나는 유리를 못 찾음`);
          defaultFrames = [unlit];
          states.lit = [base];
        } else if (lt.on) {
          states.lit = lt.on.map((s) => {
            const im = prep(s, item);
            if (im.w === base.w && im.h === base.h) return im;
            const o = create(base.w, base.h); const t = im; paste(o, t, Math.floor((base.w - t.w) / 2), base.h - t.h); return o;
          });
          stateFps.lit = lt.fps ?? 8;
        }
      }
      // ---- rotations
      const rotImgs: Record<string, Img> = {};
      if (item.rot) for (const [r, s] of Object.entries(item.rot)) rotImgs[r] = prep(s, item);

      // ---- emit one look (base or a variant)
      const emitLook = (oid: string, tf: (im: Img) => Img, rotOverride?: Record<string, Img>) => {
        const entry: Record<string, unknown> = { ...objEntry };
        const dsid = oid;
        put(dsid, group, defaultFrames.map(tf), a.ax, a.ay, defaultFrames.length > 1 ? { fps: item.fps ?? 8 } : {});
        entry.default = dsid;
        const stSids: Record<string, string> = {};
        for (const [k, frs] of Object.entries(states)) {
          const sid = `${oid}_${k}`;
          put(sid, group, frs.map(tf), a.ax, a.ay, { fps: frs.length > 1 ? stateFps[k] ?? 8 : undefined, light: k === 'lit' ? item.light : undefined });
          stSids[k] = sid;
        }
        if (Object.keys(stSids).length) entry.states = stSids;
        if (blanket) { put(`${oid}_blanket`, group, [tf(blanket)], a.ax, a.ay); entry.blanket = `${oid}_blanket`; }
        const rimgs = rotOverride ?? rotImgs;
        if (Object.keys(rimgs).length) {
          const rot: Record<string, string> = {};
          for (const [r, im] of Object.entries(rimgs)) {
            const rw = +r % 2 ? fh : fw;
            const ra = kit.anchorFor(im, rw, lift);
            const sid = `${oid}_r${r}`;
            put(sid, group, [rotOverride ? im : tf(im)], ra.ax, ra.ay);
            rot[r] = sid;
          }
          entry.rot = rot;
          entry.default = rot['0'] ?? entry.default;
        }
        art.objects[oid] = entry;
      };
      emitLook(item.id, (im) => im);
      // ---- variants
      const allImgs = [...defaultFrames, ...Object.values(states).flat(), ...(blanket ? [blanket] : []), ...Object.values(rotImgs)];
      for (const v of variants) {
        const vid = `${item.id}__${v}`;
        if (item.natRot?.[v]) {
          const rimgs = Object.fromEntries(Object.entries(item.natRot[v]!).map(([r, s]) => [r, prep(s, item)]));
          emitLook(vid, (im) => im, rimgs);
          continue;
        }
        if (item.nat?.[v]) {
          const nv = prep(item.nat[v]!, item);
          const na = kit.anchorFor(nv, fw, lift, item.cx);
          put(vid, group, [nv], na.ax, na.ay);
          const ve: Record<string, unknown> = { ...objEntry, default: vid };
          if (item.bed) {
            const bd = item.bed;
            put(`${vid}_blanket`, group, [keep(nv, (_c, x, y) => x >= bd.x0 && x < bd.x1 && y >= bd.y0 && y < bd.y1)], na.ax, na.ay);
            ve.blanket = `${vid}_blanket`;
            ve.lieHeads = Object.fromEntries(bd.heads.map(([hx, hy], i) => [i ? `lie${i + 1}` : 'lie', [hx - na.ax, hy - (na.ay - fh * T)]]));
          }
          if (Object.keys(states).length) reports.push(`${item.id}: 원본 변형 ${v} 에 상태 그림 없음`);
          art.objects[vid] = ve;
          continue;
        }
        let pred: (c: RGBA, x: number, y: number) => boolean;
        let ramp: RGBA[];
        if (item.var === 'wood') {
          ramp = WOOD[v];
          pred = (c, x, y) => isWoodish(c) && !inRect(item.woodSkip, x, y) && !isFlame(c);
        } else {
          if (!item.cloth) { reports.push(`${item.id}: ${v} 변형 그림 없음`); continue; }
          const [h0, h1, sMin = 0.2] = item.cloth;
          ramp = CLOTH[v];
          pred = (c, x, y) => hueIn(c, h0, h1, sMin) && (!item.clothRect || inRect(item.clothRect, x, y));
        }
        const map = rankMap(allImgs, ramp, pred);
        if (!map.size) reports.push(`${item.id}: ${v} 변형에서 바꿀 색이 없음`);
        emitLook(vid, (im) => applyMap(im, map, pred), item.rot ? Object.fromEntries(Object.entries(rotImgs).map(([r, im]) => [r, applyMap(im, map, pred)])) : undefined);
      }
    }
    // ---- data
    const base = item.as ? objects[item.as] : null;
    if (item.as && !base) throw new Error(`catalog ${item.id}: 기반 ${item.as} 없음`);
    const rotations = item.rot || item.natRot ? Object.keys(item.rot ?? {}).map(Number) : [0];
    const entry: Record<string, unknown> = {
      nameKey: `object.${item.id}`,
      category: item.cat,
      as: item.as ?? null,
      footprint: { w: fw, h: fh },
      blocks: item.blocks ?? !(item.wall || item.surface || item.rug),
      wallMounted: !!item.wall,
      surface: !!item.surface,
      underRug: !!item.rug,
      rotations,
      flip: rotations.length <= 1,
      price: item.price,
      quality: item.q,
      roomScore: item.rs,
      estate: item.est ?? null,
    };
    const room = item.room ?? ROOM[item.cat];
    if (room) entry.roomType = room;
    entry.durable = item.dur ?? (!!item.as || !['decor', 'outdoor', 'religion', 'animal'].includes(item.cat));
    const tags = [...new Set([...(CAT_TAGS[item.cat] ?? []), ...(item.tags ?? []), ...(item.wall ? ['wall_decor'] : []), ...(item.rug ? ['rug', 'floor_layer'] : []), ...(item.surface ? ['tabletop'] : [])])];
    entry.tags = tags;
    entry.light = item.light ?? 0;
    if (base && (base.footprint.w !== fw || base.footprint.h !== fh)) entry.slots = autoSlots(item.as!, fw, fh);
    if (variants.length) entry.variants = { [item.var!]: variants };
    catalog[item.id] = entry;
    ko[`object.${item.id}`] = item.ko;
  }
  void missingSrc;

  // ---------------------------------------------------------------- atlas pages
  const PAGE_W = 1024, PAGE_H = 2048;
  const byGroup = new Map<string, Job[]>();
  for (const j of jobs) { const l = byGroup.get(j.group) ?? []; l.push(j); byGroup.set(j.group, l); }
  let pages = 0;
  for (const [group, list] of byGroup) {
    const strips = list.map((j) => {
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      for (const f of j.frames) { const b = bboxOf(f); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
      const bw = x1 - x0, bh = y1 - y0;
      const strip = create(bw * j.frames.length, bh);
      j.frames.forEach((f, i) => blit(strip, f, x0, y0, bw, bh, i * bw, 0, false));
      return { j, strip, bx: x0, by: y0, bw, bh };
    }).sort((p, q) => q.bh - p.bh || q.strip.w - p.strip.w);
    let page = 0, cx = 0, cy = 0, rowH = 0;
    let placed: Array<{ s: (typeof strips)[number]; x: number; y: number }> = [];
    const flush = () => {
      if (!placed.length) return;
      const h = Math.max(...placed.map((p) => p.y + p.s.strip.h));
      const w = Math.max(...placed.map((p) => p.x + p.s.strip.w));
      const img = create(w, h);
      for (const p of placed) blit(img, p.s.strip, 0, 0, p.s.strip.w, p.s.strip.h, p.x, p.y, false);
      const file = `${kit.GEN}/catalog_atlas_${group}_${page}.png`;
      save(img, file);
      const imgId = kit.imageId(file);
      for (const p of placed) {
        const { j, bx, by, bw, bh } = p.s;
        const s: Record<string, unknown> = { image: imgId, x: p.x, y: p.y, w: bw, h: bh, anchorX: j.ax - bx, anchorY: j.ay - by };
        if (j.frames.length > 1) { s.frames = j.frames.length; s.frameDx = bw; s.fps = j.fps ?? 8; }
        if (j.light) s.light = j.light;
        (art.sprites as Record<string, unknown>)[j.sid] = s;
      }
      placed = []; page++; pages++; cx = 0; cy = 0; rowH = 0;
    };
    for (const s of strips) {
      const w = s.strip.w + 1, h = s.strip.h + 1;
      if (cx + w > Math.max(PAGE_W, w)) { cx = 0; cy += rowH; rowH = 0; }
      if (cy + h > PAGE_H) flush();
      placed.push({ s, x: cx, y: cy });
      cx += w; rowH = Math.max(rowH, h);
    }
    flush();
  }

  // ---------------------------------------------------------------- data files
  const out = { $note: 'tools/world/build-catalog.ts 의 ITEMS 표에서 만든 파일 (build-world 실행 때 다시 씀). 값은 그 표에서 고칠 것', catalog };
  fs.writeFileSync('src/data/catalog.json', JSON.stringify(out, null, 1) + '\n');
  for (const v of [...WOODS, ...CLOTHS]) ko[`variant.${v}`] = KO_VARIANT[v];
  for (const c of Object.keys(KO_CAT) as Cat[]) ko[`catalog.cat.${c}`] = KO_CAT[c];
  fs.writeFileSync('src/i18n/ko/catalog.json', JSON.stringify(ko, null, 2) + '\n');

  // ---------------------------------------------------------------- QA sheets (artifacts/qa/m5/catalog-<category>.png)
  const QA = 'artifacts/qa/m5';
  fs.mkdirSync(QA, { recursive: true });
  const spriteImg = (sid: string): { img: Img; ax: number; ay: number } => {
    const s = art.sprites[sid] as unknown as { image: string; x: number; y: number; w: number; h: number; anchorX: number; anchorY: number };
    return { img: crop(L(art.images[s.image]), s.x, s.y, s.w, s.h), ax: s.anchorX, ay: s.anchorY };
  };
  const K = 2, PW = 1800;
  for (const cat of Object.keys(KO_CAT) as Cat[]) {
    const items = ITEMS.filter((i) => i.cat === cat);
    const cells: Array<{ label: string; img: Img; ax: number; ay: number; fw: number; fh: number; newRow: boolean }> = [];
    for (const i of items) {
      const looks = [i.id, ...((catalog[i.id].variants ? Object.values(catalog[i.id].variants as Record<string, string[]>).flat() : []) as string[]).map((v) => `${i.id}__${v}`)];
      looks.forEach((oid, k) => {
        const e = art.objects[oid] as { default: string; states?: Record<string, string>; blanket?: string };
        if (!e) return;
        const ids = [e.default, ...(k === 0 && e.states ? Object.values(e.states) : []), ...(k === 0 && e.blanket ? [e.blanket] : [])];
        ids.forEach((sid, n) => {
          const { img, ax, ay } = spriteImg(sid);
          const f0 = crop(img, 0, 0, (art.sprites[sid] as unknown as { frameDx?: number }).frameDx ?? img.w, img.h);
          cells.push({ label: k === 0 && n === 0 ? i.id : sid === e.default ? oid.split('__')[1] : sid.replace(`${i.id}_`, ''), img: f0, ax, ay, fw: i.w, fh: i.h, newRow: k === 0 && n === 0 });
        });
      });
    }
    // layout
    const laid: Array<{ c: (typeof cells)[number]; x: number; y: number; w: number; h: number; ox: number; oy: number }> = [];
    let x = 8, y = 24, rowH = 0;
    const dims = cells.map((c) => {
      const left = Math.min(0, -c.ax), top = Math.min(-c.fh * T, -c.ay);
      const right = Math.max(c.fw * T, c.img.w - c.ax), bottom = Math.max(0, c.img.h - c.ay);
      const w = (right - left) * K, h = (bottom - top) * K + 12;
      return { w, h, left, top, cw: Math.max(w, c.label.length * 4 + 4) + 10 };
    });
    cells.forEach((c, i) => {
      const d = dims[i];
      if (c.newRow) {
        let gw = 0;
        for (let j = i; j < cells.length && (j === i || !cells[j].newRow); j++) gw += dims[j].cw;
        if (x > 8) x += 14;
        if (x + Math.min(gw, PW - 16) > PW) { x = 8; y += rowH + 10; rowH = 0; }
      } else if (x + d.cw > PW) { x = 8; y += rowH + 4; rowH = 0; }
      laid.push({ c, x, y, w: d.w, h: d.h, ox: -d.left, oy: -d.top });
      x += d.cw; rowH = Math.max(rowH, d.h);
    });
    const sheet = create(PW, y + rowH + 12, [40, 40, 48, 255]);
    text(sheet, 8, 6, `CATALOG ${cat.toUpperCase()}: ${items.length} ITEMS`, [255, 230, 90, 255], 2);
    for (const l of laid) {
      const { c } = l;
      const cw = (l.ox + Math.max(c.fw * T, c.img.w - c.ax)) , ch = l.h / K - 6;
      const loc = create(Math.ceil(cw), Math.ceil(ch), [52, 52, 62, 255]);
      // footprint grid
      for (let gy = 0; gy < c.fh; gy++) for (let gx = 0; gx < c.fw; gx++) {
        const fx = l.ox + gx * T, fy = l.oy - (c.fh - gy) * T;
        fillRect(loc, fx, fy, T, T, (gx + gy) % 2 ? [74, 92, 74, 255] : [84, 104, 84, 255]);
      }
      blit(loc, c.img, 0, 0, c.img.w, c.img.h, l.ox - c.ax, l.oy - c.ay);
      const big = scale(loc, K);
      blit(sheet, big, 0, 0, big.w, big.h, l.x, l.y + 10);
      text(sheet, l.x, l.y + 2, c.label.toUpperCase(), c.newRow ? [255, 230, 90, 255] : [180, 200, 255, 255]);
    }
    save(sheet, `${QA}/catalog-${cat}.png`);
  }

  const nVar = Object.values(catalog).reduce((s, e) => s + (e.variants ? Object.values(e.variants as Record<string, string[]>).flat().length : 0), 0);
  console.log(`catalog: ${ITEMS.length} items, ${nVar} variants, ${jobs.length} sprites, ${pages} atlas pages`);
  for (const r of reports) console.log('  catalog note:', r);

  function autoSlots(as: string, w: number, h: number): Array<Record<string, unknown>> {
    const S = (id: string, dx: number, dy: number, facing: string, pose = 'stand') => ({ id, dx, dy, facing, pose });
    const fronts = (n: number) => Array.from({ length: n }, (_, i) => S(i ? `front${i + 1}` : 'front', i, h, 'up'));
    switch (as) {
      case 'dining_table': return h > w ? [S('front', w, Math.floor(h / 2), 'left')] : [S('front', Math.floor(w / 2), h, 'up')];
      case 'bench': return w >= h ? Array.from({ length: w }, (_, i) => S(`sit${i + 1}`, i, 0, 'down', 'sit')) : Array.from({ length: h }, (_, i) => S(`sit${i + 1}`, 0, i, 'right', 'sit'));
      case 'cupboard': case 'prep_counter': return fronts(w);
      case 'bed_straw': return [S('lie', 0, 0, 'down', 'lie'), S('front', w, h - 1, 'left'), S('front_l', -1, h - 1, 'right')];
      default: return fronts(1);
    }
  }
}
