/**
 * Tiled(.tmj) ↔ 부지(LotDef) 변환 (BRIEF 1장 지도: Tiled 형식, 건축 결과도 같은 내부 형식).
 * 순수 함수 (sim/도구/테스트 공용).
 *
 * .tmj 규약
 * - 타일 레이어 "ground", "floor", "walls": 칸마다 gid. 타일셋 타일의 사용자 속성 `id`(string)가 우리 타일/벽 스타일 id
 * - 객체 레이어 "objects": 객체 `type`(Tiled 1.9+ 는 `class`) = 물건 id, 위치 = 발자국 왼쪽 위 (픽셀, 칸 배수), 속성 `rot`(int)
 * - 객체 레이어 "markers": `type` = door | window | spawn | exit, 위치 = 칸 왼쪽 위
 * - gid 가 있는 타일 오브젝트는 Tiled 규약대로 원점이 왼쪽 아래 → 높이만큼 올려서 읽음
 */
import type { LotDef } from '../core/types';

interface TiledProperty {
  name: string;
  type: string;
  value: string | number | boolean;
}
interface TiledTile {
  id: number;
  properties?: TiledProperty[];
}
interface TiledTileset {
  firstgid: number;
  name: string;
  tilecount: number;
  tilewidth: number;
  tileheight: number;
  columns: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tiles?: TiledTile[];
}
interface TiledObject {
  id: number;
  gid?: number;
  name: string;
  type?: string;
  class?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: TiledProperty[];
}
interface TiledLayer {
  id: number;
  name: string;
  type: 'tilelayer' | 'objectgroup';
  width?: number;
  height?: number;
  data?: number[];
  objects?: TiledObject[];
  visible: boolean;
  opacity: number;
  x: number;
  y: number;
}
export interface TiledMap {
  type: 'map';
  version: string;
  orientation: 'orthogonal';
  renderorder: 'right-down';
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  infinite: false;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
  nextlayerid: number;
  nextobjectid: number;
  properties?: TiledProperty[];
}

const FLIP_MASK = 0x1fffffff;

function prop(props: TiledProperty[] | undefined, name: string): TiledProperty['value'] | undefined {
  return props?.find((p) => p.name === name)?.value;
}

export function lotFromTiled(map: TiledMap): LotDef {
  if (map.orientation !== 'orthogonal') throw new Error('Tiled: orthogonal 지도만 지원');
  if (map.infinite) throw new Error('Tiled: 무한 지도는 지원하지 않음');
  const gidToId = new Map<number, string>();
  for (const ts of map.tilesets) {
    for (const t of ts.tiles ?? []) {
      const id = prop(t.properties, 'id');
      if (typeof id === 'string') gidToId.set(ts.firstgid + t.id, id);
    }
  }
  const w = map.width;
  const h = map.height;
  const T = map.tilewidth;
  const layer = (name: string): (string | null)[] => {
    const l = map.layers.find((x) => x.name === name && x.type === 'tilelayer');
    if (!l || !l.data) return new Array<string | null>(w * h).fill(null);
    if (l.data.length !== w * h) throw new Error(`Tiled: 레이어 ${name} 크기 불일치`);
    return l.data.map((gid) => {
      const g = gid & FLIP_MASK;
      if (!g) return null;
      const id = gidToId.get(g);
      if (!id) throw new Error(`Tiled: 레이어 ${name}의 gid ${g}에 id 속성이 없음`);
      return id;
    });
  };
  const objects: LotDef['objects'] = [];
  const openings: LotDef['openings'] = [];
  let spawn: LotDef['spawn'] | null = null;
  const exits: { x: number; y: number }[] = [];
  for (const l of map.layers) {
    if (l.type !== 'objectgroup') continue;
    for (const o of l.objects ?? []) {
      const kind = o.type ?? o.class ?? '';
      const cx = Math.round(o.x / T);
      const cy = Math.round((o.gid ? o.y - o.height : o.y) / T);
      if (l.name === 'objects') {
        const rot = prop(o.properties, 'rot');
        objects.push(typeof rot === 'number' && rot !== 0 ? { id: kind, x: cx, y: cy, rot } : { id: kind, x: cx, y: cy });
      } else if (l.name === 'markers') {
        if (kind === 'door' || kind === 'window') openings.push({ x: cx, y: cy, kind });
        else if (kind === 'spawn') spawn = { x: cx, y: cy };
        else if (kind === 'exit') exits.push({ x: cx, y: cy });
      }
    }
  }
  const id = prop(map.properties, 'lotId');
  return {
    id: typeof id === 'string' ? id : 'lot',
    w,
    h,
    ground: layer('ground'),
    floor: layer('floor'),
    walls: layer('walls'),
    openings,
    objects,
    spawn: spawn ?? { x: Math.floor(w / 2), y: Math.floor(h / 2) },
    ...(exits.length ? { exits } : {}),
  };
}

/**
 * 부지 → Tiled. 타일셋은 "ids" 한 개(이미지 없는 컬렉션)로, 타일마다 id 속성.
 * tileImage 를 주면 타일마다 미리보기 이미지를 붙여 Tiled 에서 보이게 함.
 */
export function lotToTiled(lot: LotDef, tilePx: number, tileImage?: (id: string) => { image: string; w: number; h: number } | null): TiledMap {
  const ids = new Set<string>();
  for (const arr of [lot.ground, lot.floor, lot.walls]) for (const v of arr) if (v) ids.add(v);
  const sorted = [...ids].sort();
  const gidOf = new Map(sorted.map((id, i) => [id, i + 1]));
  const tiles = sorted.map((id, i) => {
    const t: TiledTile & { image?: string; imagewidth?: number; imageheight?: number } = {
      id: i,
      properties: [{ name: 'id', type: 'string', value: id }],
    };
    const img = tileImage?.(id);
    if (img) {
      t.image = img.image;
      t.imagewidth = img.w;
      t.imageheight = img.h;
    }
    return t;
  });
  const tl = (name: string, arr: (string | null)[], lid: number): TiledLayer => ({
    id: lid, name, type: 'tilelayer', width: lot.w, height: lot.h, data: arr.map((v) => (v ? gidOf.get(v)! : 0)),
    visible: true, opacity: 1, x: 0, y: 0,
  });
  let oid = 1;
  const objLayer: TiledLayer = {
    id: 4, name: 'objects', type: 'objectgroup', visible: true, opacity: 1, x: 0, y: 0,
    objects: lot.objects.map((o) => ({
      id: oid++, name: o.id, type: o.id, x: o.x * tilePx, y: o.y * tilePx, width: tilePx, height: tilePx,
      ...(o.rot ? { properties: [{ name: 'rot', type: 'int', value: o.rot }] } : {}),
    })),
  };
  const markers: TiledLayer = {
    id: 5, name: 'markers', type: 'objectgroup', visible: true, opacity: 1, x: 0, y: 0,
    objects: [
      ...lot.openings.map((o) => ({ id: oid++, name: o.kind, type: o.kind, x: o.x * tilePx, y: o.y * tilePx, width: tilePx, height: tilePx })),
      { id: oid++, name: 'spawn', type: 'spawn', x: lot.spawn.x * tilePx, y: lot.spawn.y * tilePx, width: tilePx, height: tilePx },
      ...(lot.exits ?? []).map((e) => ({ id: oid++, name: 'exit', type: 'exit', x: e.x * tilePx, y: e.y * tilePx, width: tilePx, height: tilePx })),
    ],
  };
  return {
    type: 'map', version: '1.10', orientation: 'orthogonal', renderorder: 'right-down',
    width: lot.w, height: lot.h, tilewidth: tilePx, tileheight: tilePx, infinite: false,
    layers: [tl('ground', lot.ground, 1), tl('floor', lot.floor, 2), tl('walls', lot.walls, 3), objLayer, markers],
    tilesets: [{ firstgid: 1, name: 'ids', tilecount: sorted.length, tilewidth: tilePx, tileheight: tilePx, columns: 0, tiles }],
    nextlayerid: 6, nextobjectid: oid,
    properties: [{ name: 'lotId', type: 'string', value: lot.id }],
  };
}
