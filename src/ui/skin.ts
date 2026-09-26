/**
 * UI 스킨: 구매 에셋에서 뽑은 아틀라스(assets/generated/ui/ui-atlas.png + src/data/ui/atlas.json).
 * 아이콘은 원본 16px 을 정수 배율로, 판은 9-slice 조각을 CSS border-image 로 씀 (GDD 27-3).
 * 모든 UI 그림은 image-rendering: pixelated (늘릴 때 테두리가 뭉개지지 않게).
 *
 * 개편(Cute Fantasy UI) 추가:
 * - 모든 9-slice 조각을 --skin-<키> / -slice / -w2 / -w3 (2배·3배 테두리 폭) CSS 변수로
 * - pieceUrl(): 통짜 조각(책, 탭, 버튼, 리본 …)의 data URL
 * - 신분별 수첩 표지·탭 색 (팔레트 교체, 27-11), 판 색에 맞춘 넘김 ▼ (27-13)
 * - stitchCard(): 바느질 칸을 목표 크기 그대로 원본 해상도에서 찍음 (늘리면 무늬가 깨짐)
 * - emoteFrame(): Elthen 감정 효과 칸과 그림 영역 (머리 바로 위 맞춤, 27-12)
 */
import { Assets } from '../render/Assets';

interface AtlasSprite {
  x: number;
  y: number;
  w: number;
  h: number;
  slice?: [number, number, number, number];
}
interface AtlasFile {
  image: string;
  sprites: Record<string, AtlasSprite>;
}

const found = import.meta.glob<{ default: AtlasFile }>('../data/ui/atlas.json', { eager: true });
const atlas: AtlasFile | null = Object.values(found)[0]?.default ?? null;

let atlasUrl = '';
let atlasImg: HTMLImageElement | null = null;
const missingIcons = new Set<string>();
const urlCache = new Map<string, string>();

export async function loadSkin(assets: Assets): Promise<void> {
  if (!atlas) return;
  atlasUrl = assets.url(atlas.image);
  const img = await assets.image(atlas.image);
  atlasImg = img;
  atlasW = img.width;
  atlasH = img.height;
  const root = document.documentElement;
  for (const [key, s] of Object.entries(atlas.sprites)) {
    // 9-slice 조각, 초상 판, CSS 배경으로 쓰는 버튼·아이콘 몇 개
    if (!s.slice && !key.startsWith('portrait.') && !key.startsWith('cbtn.') && key !== 'cute.no') continue;
    const name = key.replace(/[^a-z0-9]+/gi, '-');
    root.style.setProperty(`--skin-${name}`, `url(${pieceUrl(key)})`);
    if (!s.slice) continue;
    const [t, r, b, l] = s.slice;
    root.style.setProperty(`--skin-${name}-slice`, `${t} ${r} ${b} ${l}`);
    root.style.setProperty(`--skin-${name}-width`, `${t * 2}px ${r * 2}px ${b * 2}px ${l * 2}px`);
    root.style.setProperty(`--skin-${name}-w3`, `${t * 3}px ${r * 3}px ${b * 3}px ${l * 3}px`);
  }
  // 넘김 ▼: 반투명 판은 금색, 양피지 판은 잉크 갈색
  root.style.setProperty('--skin-next-gold', `url(${recolor('cute.next', { light: [255, 211, 106], mid: [201, 146, 46] })})`);
  root.style.setProperty('--skin-next-ink', `url(${recolor('cute.next', { light: [168, 84, 46], mid: [110, 50, 24] })})`);
  root.classList.add('skin-ready');
}

export function hasIcon(key: string): boolean {
  return !!atlas?.sprites[key];
}

export function spriteSize(key: string): { w: number; h: number } | null {
  const s = atlas?.sprites[key];
  return s ? { w: s.w, h: s.h } : null;
}

/** 아이콘 요소 (정수 배율, 픽셀 그대로) */
export function iconEl(key: string, scale = 2, extraClass = ''): HTMLElement {
  const el = document.createElement('span');
  el.className = `icon ${extraClass}`.trim();
  el.dataset.icon = key;
  setIcon(el, key, scale);
  return el;
}

export function setIcon(el: HTMLElement, key: string, scale = 2): void {
  const s = atlas?.sprites[key];
  if (!s || !atlasUrl) {
    missingIcons.add(key);
    el.style.width = `${16 * scale}px`;
    el.style.height = `${16 * scale}px`;
    el.style.backgroundImage = '';
    return;
  }
  el.style.width = `${s.w * scale}px`;
  el.style.height = `${s.h * scale}px`;
  el.style.backgroundImage = `url(${atlasUrl})`;
  el.style.backgroundPosition = `${-s.x * scale}px ${-s.y * scale}px`;
  el.style.backgroundSize = `${atlasW * scale}px ${atlasH * scale}px`;
}

let atlasW = 0;
let atlasH = 0;

export function missingIconKeys(): string[] {
  return [...missingIcons];
}

function crop(key: string): HTMLCanvasElement | null {
  const s = atlas?.sprites[key];
  if (!s || !atlasImg) return null;
  const c = document.createElement('canvas');
  c.width = s.w;
  c.height = s.h;
  c.getContext('2d')!.drawImage(atlasImg, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
  return c;
}

/** 통짜 조각의 data URL (원본 크기. 쓰는 쪽이 정수 배율로 키움) */
export function pieceUrl(key: string): string {
  const hit = urlCache.get(key);
  if (hit) return hit;
  const c = crop(key);
  if (!c) {
    missingIcons.add(key);
    return '';
  }
  const u = c.toDataURL();
  urlCache.set(key, u);
  return u;
}

/** 조각을 <img> 로 (정수 배율) */
export function pieceImg(key: string, scale = 3, cls = ''): HTMLImageElement {
  const img = document.createElement('img');
  img.className = `px ${cls}`.trim();
  img.draggable = false;
  img.alt = '';
  img.src = pieceUrl(key);
  const s = atlas?.sprites[key];
  if (s) {
    img.width = s.w * scale;
    img.height = s.h * scale;
  }
  return img;
}

/** 흰/회색 조각을 밝기 두 단계로 다시 칠함 (▼ 넘김 표시) */
function recolor(key: string, pal: { light: number[]; mid: number[] }): string {
  const c = crop(key);
  if (!c) return '';
  const g = c.getContext('2d')!;
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    if (!d.data[i + 3]) continue;
    const lum = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 765;
    const col = lum > 0.8 ? pal.light : lum > 0.45 ? pal.mid : null;
    if (col) [d.data[i], d.data[i + 1], d.data[i + 2]] = col;
  }
  g.putImageData(d, 0, 0);
  return c.toDataURL();
}

// ---------------------------------------------------------------- 신분별 수첩 (GDD 27-11)

/** 표지 두 단계 색 (책 원본의 짙은 갈색 (93,44,40) / 갈색 (138,72,54) 을 바꿈). 자유민은 원본 */
const COVER: Record<string, [number[], number[]] | null> = {
  serf: [[58, 46, 36], [88, 68, 48]],
  freeman: null,
  artisan: [[112, 36, 34], [162, 58, 46]],
  merchant: [[36, 50, 96], [58, 82, 142]],
  clergy: [[78, 78, 92], [128, 128, 142]],
  knight: [[56, 66, 78], [98, 112, 126]],
  noble: [[150, 100, 24], [214, 166, 48]],
};
/** 위쪽 탭에 입히는 색 */
const TAB_TINT: Record<string, number[] | null> = {
  serf: [120, 96, 72],
  freeman: null,
  artisan: [200, 80, 64],
  merchant: [80, 110, 180],
  clergy: [170, 170, 180],
  knight: [120, 140, 156],
  noble: [230, 180, 60],
};

export const ESTATES = Object.keys(COVER);

/** 신분별 표지 (없는 신분은 원본) */
export function bookUrl(estate: string): string {
  const k = `book.base@${estate}`;
  const hit = urlCache.get(k);
  if (hit) return hit;
  const pal = COVER[estate];
  if (!pal) return pieceUrl('book.base');
  const c = crop('book.base');
  if (!c) return '';
  const g = c.getContext('2d')!;
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i];
    const gg = d.data[i + 1];
    const b = d.data[i + 2];
    if (r === 93 && gg === 44 && b === 40) [d.data[i], d.data[i + 1], d.data[i + 2]] = pal[0];
    else if (r === 138 && gg === 72 && b === 54) [d.data[i], d.data[i + 1], d.data[i + 2]] = pal[1];
  }
  g.putImageData(d, 0, 0);
  const u = c.toDataURL();
  urlCache.set(k, u);
  return u;
}

/** 신분별 위쪽 탭 (밝은 면에만 색을 입힘) */
export function tabUrl(estate: string, on: boolean): string {
  const base = on ? 'book.tab_on' : 'book.tab';
  const tint = TAB_TINT[estate];
  if (!tint) return pieceUrl(base);
  const k = `${base}@${estate}`;
  const hit = urlCache.get(k);
  if (hit) return hit;
  const c = crop(base);
  if (!c) return '';
  const g = c.getContext('2d')!;
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    if (!d.data[i + 3]) continue;
    const lum = (d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11) / 255;
    if (lum < 0.3) continue;
    for (let ch = 0; ch < 3; ch++) {
      const want = Math.min(255, tint[ch] * lum * 1.25);
      d.data[i + ch] = Math.min(255, Math.round(d.data[i + ch] * 0.35 + want * 0.65));
    }
  }
  g.putImageData(d, 0, 0);
  const u = c.toDataURL();
  urlCache.set(k, u);
  return u;
}

// ---------------------------------------------------------------- 바느질 칸 (크기별로 찍음)

/**
 * 바느질 테두리 칸을 w×h(원본 픽셀) 그대로 찍음. 한 땀 = 5px (4px 선 + 1px 틈), 아래 1px 그늘.
 * 색은 원본 조각(book.stitch)에서 뽑음. 쓰는 쪽은 정수 배율로만 키움 (GDD 27-13).
 */
export function stitchCard(w: number, h: number, on = false): string {
  const k = `stitch@${w}x${h}${on ? '+' : ''}`;
  const hit = urlCache.get(k);
  if (hit) return hit;
  const src = crop('book.stitch');
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  let fill = [246, 202, 159, 255];
  let edge = [230, 156, 105, 255];
  let shade = [191, 111, 74, 255];
  if (src) {
    const sd = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
    const px = (x: number, y: number) => Array.from(sd.slice((y * src.width + x) * 4, (y * src.width + x) * 4 + 4));
    fill = px(10, 10);
    edge = px(1, 0);
    shade = px(0, 24);
  }
  if (on) edge = [88, 176, 90, 255];
  const d = g.createImageData(w, h);
  const set = (x: number, y: number, col: number[] | null) => {
    const i = (y * w + x) * 4;
    if (!col) {
      d.data[i + 3] = 0;
      return;
    }
    d.data.set(col, i);
  };
  const body = h - 1;
  for (let y = 1; y < body - 1; y++) for (let x = 1; x < w - 1; x++) set(x, y, fill);
  for (let x = 2; x < w - 2; x++) {
    const st = (x - 2) % 5 !== 4;
    set(x, 1, st ? edge : fill);
    set(x, 0, st ? null : edge);
    set(x, body - 2, st ? edge : fill);
    set(x, body - 1, st ? null : edge);
    set(x, body, st ? shade : null);
  }
  for (let y = 2; y < body - 2; y++) {
    const st = (y - 2) % 5 !== 4;
    set(1, y, st ? edge : fill);
    set(0, y, st ? null : edge);
    set(w - 2, y, st ? edge : fill);
    set(w - 1, y, st ? null : edge);
  }
  for (const [x, y] of [[1, 1], [w - 2, 1], [1, body - 2], [w - 2, body - 2]]) set(x, y, edge);
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, body - 1], [w - 1, body - 1], [0, 1], [1, 0], [w - 1, 1], [w - 2, 0], [0, body - 2], [1, body - 1], [w - 1, body - 2], [w - 2, body - 1], [1, body], [w - 2, body]]) set(x, y, null);
  g.putImageData(d, 0, 0);
  const u = c.toDataURL();
  urlCache.set(k, u);
  return u;
}

// ---------------------------------------------------------------- 감정 효과 (Elthen, 32px 8프레임)

/** Elthen 시트 줄 순서 */
export const EMOTE_ROWS = ['stun', 'sparkle', 'poison', 'sick', 'breath', 'cross', 'fire', 'ice', 'shock', 'sleep', 'spiral', 'question', 'heart', 'hearts', 'skull', 'qbubble', 'talk', 'heal', 'bleed', 'sweat', 'nofood'] as const;
const emoteBoxes = new Map<string, [number, number, number, number]>();

/** 감정 효과 한 칸의 아틀라스 좌표와 그림 영역 [x0,y0,x1,y1] (칸 안 좌표). 없으면 null */
export function emoteFrame(name: string, frame: number): { sx: number; sy: number; box: [number, number, number, number] } | null {
  const sheet = atlas?.sprites['emote.sheet'];
  const row = EMOTE_ROWS.indexOf(name as (typeof EMOTE_ROWS)[number]);
  if (!sheet || row < 0) return null;
  const f = ((frame % 8) + 8) % 8;
  const sx = sheet.x + f * 32;
  const sy = sheet.y + row * 32;
  const k = `${name}.${f}`;
  let box = emoteBoxes.get(k);
  if (!box && atlasImg) {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(atlasImg, sx, sy, 32, 32, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    let x0 = 32;
    let y0 = 32;
    let x1 = 0;
    let y1 = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      if (!d[(y * 32 + x) * 4 + 3]) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
    box = x1 > x0 ? [x0, y0, x1, y1] : [0, 0, 32, 32];
    emoteBoxes.set(k, box);
  }
  return { sx, sy, box: box ?? [0, 0, 32, 32] };
}

export function atlasSprite(key: string): AtlasSprite | null {
  return atlas?.sprites[key] ?? null;
}
