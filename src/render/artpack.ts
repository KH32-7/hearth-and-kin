/** 세계 아트 팩 타입 (artifacts/contracts.md). 그림 정보는 여기에만, sim은 모름 */
export interface TileRef {
  image: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export interface SpriteRef {
  image: string;
  x: number;
  y: number;
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
  frames?: number;
  frameDx?: number;
  fps?: number;
  /** 선택: 빛나는 물건(불)은 시간대 색 보정을 덜 받음 */
  emissive?: number;
  /** 선택: 광원 반지름(칸) */
  light?: number;
}

export interface WallStyle {
  face: string;
  faceCut: string;
  top: string;
  door?: string;
  doorOpen?: string;
  window?: string;
  doorCut?: string;
  windowCut?: string;
  [extra: string]: string | undefined;
}

export interface WorldPack {
  id: string;
  tilePx: number;
  images: Record<string, string>;
  tiles: Record<string, TileRef>;
  sprites: Record<string, SpriteRef>;
  walls: Record<string, WallStyle>;
  objects: Record<string, { default: string; states?: Record<string, string> }>;
  [extra: string]: unknown;
}
