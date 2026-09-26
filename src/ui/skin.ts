/**
 * UI 스킨: 구매 에셋에서 뽑은 아틀라스(assets/generated/ui/ui-atlas.png + src/data/ui/atlas.json).
 * 아이콘은 원본 16px을 정수 배율(2배)로, 패널은 9-slice 조각을 잘라 CSS border-image 로 씀.
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
const missingIcons = new Set<string>();

export async function loadSkin(assets: Assets): Promise<void> {
  if (!atlas) return;
  atlasUrl = assets.url(atlas.image);
  const img = await assets.image(atlas.image);
  atlasW = img.width;
  atlasH = img.height;
  const root = document.documentElement;
  for (const [key, s] of Object.entries(atlas.sprites)) {
    // 9-slice 조각과 초상 판(통째 배경)만 CSS 변수로
    if (!s.slice && !key.startsWith('portrait.')) continue;
    const c = document.createElement('canvas');
    c.width = s.w;
    c.height = s.h;
    const g = c.getContext('2d')!;
    g.drawImage(img, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
    const name = key.replace(/[^a-z0-9]+/gi, '-');
    root.style.setProperty(`--skin-${name}`, `url(${c.toDataURL()})`);
    if (!s.slice) continue;
    const [t, r, b, l] = s.slice;
    root.style.setProperty(`--skin-${name}-slice`, `${t} ${r} ${b} ${l}`);
    root.style.setProperty(`--skin-${name}-width`, `${t * 2}px ${r * 2}px ${b * 2}px ${l * 2}px`);
  }
  root.classList.add('skin-ready');
}

export function hasIcon(key: string): boolean {
  return !!atlas?.sprites[key];
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
