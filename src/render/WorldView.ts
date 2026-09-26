/**
 * 부지 그리기 (M5 여러 층): 층 판(슬랩)마다 바닥 한 장 + 벽(이웃 보고 자동 선택 + 잘라내기) + 물건, 그 위 자동 지붕.
 * - 좌표: sim 은 층 판을 세로로 쌓은 전체 행 좌표(world/lot.ts). 화면은 판 안 y 에 층 높이(STORY px)만큼 위로 올려 그림
 * - 앞뒤 정렬: renderOrder = 판 안 발 위치 px × ORDER_SCALE + 층 기준값 (위층은 아래층 전부보다 나중)
 * - 보기 층 (23-2): 현재 층만 선명, 아래층은 흐리게, 위층은 숨김. 지하를 보면 1층 이상은 숨김
 * - 지붕: 실외(멀리 본 카메라, 인물이 밖)일 때 보이고, 가까이 보거나 인물이 집에 들어가면 서서히 투명
 */
import * as THREE from 'three';
import type { LotDef, ObjectDef } from '../sim/core/types';
import type { ObjectSnap } from '../sim/protocol';
import { Grid } from '../sim/world/grid';
import { LEVELS, SLABS, isGapRow, slabOfRow, slabStride } from '../sim/world/lot';
import type { Assets } from './Assets';
import type { SpriteRef, TileRef, WorldPack } from './artpack';
import { placeRect } from './GameRenderer';
import { makeSpriteMaterial, pixelTexture, setUvRect } from './SpriteMaterial';

export type CutawayMode = 'up' | 'cut' | 'down';

interface SpriteNode {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  spriteId: string;
  ref: SpriteRef;
  left: number;
  bottom: number;
  /** 좌우 반전 (placeRect 뒤에 scale.x 음수) */
  flipX?: boolean;
}

interface WallNode {
  main: SpriteNode | null;
  cap: SpriteNode | null;
  /** 문/창 겹그림 (M5 종류별 문짝, 창) */
  over: SpriteNode | null;
  x: number;
  /** 전체 행 */
  y: number;
  slab: number;
  style: string;
  opening: 'door' | 'window' | null;
  variant: string | null;
}

interface ObjNode {
  uid: number;
  defId: string;
  node: SpriteNode;
  light: THREE.Mesh | null;
  lit: boolean;
  /** 화면 아랫변 (층 높이 반영) */
  bottom: number;
  /** 판 안 아랫변 (정렬용) */
  localBottom: number;
  footprint: { w: number; h: number };
  x: number;
  y: number;
  rot: number;
  variant: string;
  slab: number;
  /** 회전/변형 반영 기본 스프라이트 */
  base: string;
  /** 밭 작물 덧그림 (칸마다 하나), 잡초 */
  crops?: SpriteNode[];
  cropKey?: string;
}

interface Layer {
  slab: number;
  level: number;
  group: THREE.Group;
  ground: THREE.Mesh | null;
  /** 흐림 배수 (1 선명, 0.5 아래층) */
  tint: number;
}

interface TerrainSet {
  center: string[];
  n?: string; s?: string; e?: string; w?: string; nw?: string; ne?: string; sw?: string; se?: string;
  inw?: string; ine?: string; isw?: string; ise?: string;
}

interface RoofSet { fill: string; fillN: string; ridge: string; eave: string; vergeW: string; vergeE: string }

export const ORDER_SCALE = 4;
/** 층 사이 정렬 간격 (한 층의 모든 renderOrder 보다 큼) */
const LEVEL_ORDER = 1_000_000;
const quad = new THREE.PlaneGeometry(1, 1);

const hash2 = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663)) >>> 0);

export class WorldView {
  readonly group = new THREE.Group();
  readonly tile: number;
  private textures = new Map<string, THREE.Texture>();
  private imageEls = new Map<string, HTMLImageElement>();
  private walls: WallNode[] = [];
  private objs = new Map<number, ObjNode>();
  private layers: Layer[] = [];
  private roofGroup = new THREE.Group();
  private roofMats: THREE.ShaderMaterial[] = [];
  cutaway: CutawayMode = 'cut';
  private glowTex: THREE.Texture;
  /** 층 높이 (벽 면 높이 px) */
  readonly story: number;
  /** 보는 층 (0 = 1층, 1 = 2층, -1 = 지하) */
  viewLevel = 0;
  /** 지붕 불투명도 (0 ~ 1, 목표로 서서히) */
  roofAlpha = 0;
  roofTarget = 0;
  /** 실외 보기: 지붕이 보이면 벽을 다 올리고 모든 층을 그림 */
  private exterior = false;
  private fenceIds: Set<string>;
  /** 계단 칸 (판 안 좌표 → 계단 맨 아래 행, 높이) */
  private stairCells = new Map<number, { y0: number; h: number }>();
  private grid: Grid | null = null;

  constructor(
    private pack: WorldPack,
    private assets: Assets,
    private lot: LotDef,
    private defs: Record<string, ObjectDef>,
  ) {
    this.tile = pack.tilePx;
    this.glowTex = makeGlowTexture();
    let h = 0;
    for (const w of Object.values(pack.walls)) h = Math.max(h, Number((w as { height?: number; fence?: boolean }).fence ? 0 : (w as { height?: number }).height ?? 0));
    this.story = h || 80;
    this.fenceIds = new Set(Object.entries(pack.walls).filter(([, w]) => (w as { fence?: boolean }).fence).map(([k]) => k));
    for (let s = 0; s < SLABS; s++) {
      const g = new THREE.Group();
      this.group.add(g);
      this.layers.push({ slab: s, level: LEVELS[s], group: g, ground: null, tint: 1 });
    }
    this.group.add(this.roofGroup);
  }

  async load(): Promise<void> {
    await Promise.all(
      Object.entries(this.pack.images).map(async ([id, path]) => {
        const img = await this.assets.image(path);
        this.imageEls.set(id, img);
        this.textures.set(id, pixelTexture(img));
      }),
    );
    this.rebuildLot();
  }

  // ------------------------------------------------------------------ 좌표

  private get H(): number {
    return this.lot.h;
  }

  slabOfRow(y: number): number {
    return slabOfRow(Math.floor(y), this.H);
  }

  levelOfRow(y: number): number {
    return LEVELS[this.slabOfRow(y)];
  }

  /** 층 판이 화면에서 위로 올라가는 px */
  yOff(slab: number): number {
    return Math.max(0, LEVELS[slab]) * this.story;
  }

  orderBase(slab: number): number {
    return Math.max(0, LEVELS[slab]) * LEVEL_ORDER;
  }

  /** 판 안 행 */
  localRow(y: number): number {
    return y - this.slabOfRow(y) * slabStride(this.H);
  }

  /** sim 좌표 (칸, 전체 행) → 화면 px (계단 위에서는 오르는 높이만큼 올림) */
  project(x: number, y: number): { x: number; y: number; slab: number; order: number } {
    const T = this.tile;
    const slab = this.slabOfRow(y);
    const ly = y - slab * slabStride(this.H);
    let lift = 0;
    const st = this.stairCells.get(Math.floor(x) + Math.floor(y) * this.lot.w);
    if (st) lift = this.story * Math.max(0, Math.min(1, (st.y0 + st.h - y) / st.h));
    return { x: x * T, y: ly * T - this.yOff(slab) - lift, slab, order: this.orderBase(slab) + ly * T * ORDER_SCALE };
  }

  /** 화면 px → 보는 층의 칸 (전체 행). 부지 밖이면 null */
  screenToCell(wx: number, wy: number): { x: number; y: number } | null {
    const T = this.tile;
    const slab = LEVELS.indexOf(this.viewLevel);
    const x = Math.floor(wx / T);
    const ly = Math.floor((wy + this.yOff(slab)) / T);
    if (x < 0 || ly < 0 || x >= this.lot.w || ly >= this.H) return null;
    return { x, y: slab * slabStride(this.H) + ly };
  }

  /** 층이 보이는가, 흐림 배수 */
  levelVisibility(level: number): { visible: boolean; tint: number } {
    if (this.exterior) return { visible: level >= 0, tint: 1 };
    const v = this.viewLevel;
    if (v < 0) return { visible: level === v, tint: 1 };
    if (level < 0) return { visible: false, tint: 1 };
    if (level > v) return { visible: false, tint: 1 };
    return { visible: true, tint: level === v ? 1 : 0.5 };
  }

  // ------------------------------------------------------------------ 부지 다시 그리기

  /** 건축으로 바뀐 부지 (스냅샷 lot) */
  setLot(lot: LotDef): void {
    this.lot = lot;
    this.rebuildLot();
    // 물건 층/칸 정보가 바뀌었을 수 있음: 다음 스냅샷에서 다시 만듦
    for (const n of this.objs.values()) this.disposeObj(n);
    this.objs.clear();
  }

  private rebuildLot(): void {
    this.chimneyKeyLot++;
    this.chimneys = [];
    this.grid = new Grid(this.lot, this.fenceIds);
    this.computeStairs();
    // 위층 계단 구멍 (sim World.linkPortals 와 같은 규칙): 지붕/방 계산용
    const stride = slabStride(this.H);
    for (const o of this.lot.objects) {
      if (!this.defs[o.id]?.tags.includes('stairs')) continue;
      const s = this.slabOfRow(o.y);
      const up = LEVELS.indexOf(LEVELS[s] + 1);
      if (up < 0) continue;
      for (let dy = 0; dy < this.defs[o.id].footprint.h; dy++) {
        const hy = o.y + dy + (up - s) * stride;
        if (hy >= 0 && hy < this.grid.h) this.grid.hole[this.grid.idx(o.x, hy)] = 1;
      }
    }
    this.grid.detectRooms();
    for (const w of this.walls) for (const n of [w.main, w.cap, w.over]) if (n) this.disposeNode(n);
    this.walls = [];
    this.buildGround();
    this.buildUpper();
    this.buildWalls();
    this.buildRoof();
    this.applyVisibility();
  }

  private computeStairs(): void {
    this.stairCells.clear();
    for (const o of this.lot.objects) {
      if (!this.defs[o.id]?.tags.includes('stairs')) continue;
      this.markStairs(o.x, o.y, this.defs[o.id].footprint.h);
    }
  }

  private markStairs(x: number, y: number, h: number): void {
    for (let dy = 0; dy < h; dy++) this.stairCells.set(x + (y + dy) * this.lot.w, { y0: y, h });
  }

  /** 부지 둘레에 까는 주변 땅 (칸). 위쪽은 벽 높이만큼 더 */
  readonly pad = 22;
  /** 바닥 그림이 덮는 세계 범위 (px) */
  bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };

  private drawTile(g: CanvasRenderingContext2D, t: TileRef | undefined, x: number, y: number): void {
    if (!t) return;
    const img = this.imageEls.get(t.image);
    const T = this.tile;
    if (img) g.drawImage(img, t.x, t.y, t.w ?? T, t.h ?? T, x, y, T, T);
  }

  private floors(): Record<string, string[]> {
    return (this.pack.floors as Record<string, string[]> | undefined) ?? {};
  }

  private terrain(): Record<string, TerrainSet> {
    return (this.pack.terrain as Record<string, TerrainSet> | undefined) ?? {};
  }

  /** 바닥 값 → 타일 (재질 id 는 칸 해시로 변형 고름, 옛 타일 id 는 그대로) */
  private floorTile(id: string, x: number, y: number): TileRef | undefined {
    const t = this.pack.tiles[id];
    if (t) return t;
    const list = this.floors()[id];
    if (list?.length) return this.pack.tiles[list[hash2(x, y) % list.length]];
    // 아트가 아직 없는 재질: 비슷한 기존 타일
    const fb = id.includes('stone') || id.includes('flag') || id.includes('tile') ? 'floor_stone' : 'floor_wood';
    return this.pack.tiles[`${fb}_${(hash2(x, y) % 4) + 1}`] ?? this.pack.tiles[fb];
  }

  /** 땅 값 → 타일 (지형 id 는 이웃을 보고 전이 타일, 옛 타일 id 는 그대로) */
  private groundTile(x: number, y: number): TileRef | undefined {
    const W = this.lot.w;
    const cx = Math.min(W - 1, Math.max(0, x));
    const cy = Math.min(this.H - 1, Math.max(0, y));
    const id = this.lot.ground[cy * W + cx] ?? 'grass';
    if (this.pack.tiles[id]) return this.pack.tiles[id];
    const tset = this.terrain()[id] ?? this.fallbackTerrain(id);
    if (!tset) return undefined;
    const same = (dx: number, dy: number) => {
      const nx = Math.min(W - 1, Math.max(0, cx + dx));
      const ny = Math.min(this.H - 1, Math.max(0, cy + dy));
      return (this.lot.ground[ny * W + nx] ?? 'grass') === id;
    };
    const pick = (k: keyof TerrainSet) => {
      const v = tset[k];
      return typeof v === 'string' ? this.pack.tiles[v] : undefined;
    };
    if (id !== 'grass') {
      const n = !same(0, -1), s = !same(0, 1), e = !same(1, 0), w = !same(-1, 0);
      const t = n && w ? pick('nw') : n && e ? pick('ne') : s && w ? pick('sw') : s && e ? pick('se')
        : n ? pick('n') : s ? pick('s') : e ? pick('e') : w ? pick('w')
        : !same(-1, -1) ? pick('inw') : !same(1, -1) ? pick('ine') : !same(-1, 1) ? pick('isw') : !same(1, 1) ? pick('ise') : undefined;
      if (t) return t;
    }
    const c = tset.center;
    return this.pack.tiles[c[hash2(x, y) % c.length]];
  }

  private fallbackTerrain(id: string): TerrainSet | null {
    if (id === 'grass') return { center: Object.keys(this.pack.tiles).filter((k) => /^grass_\d+$/.test(k)) };
    if (id === 'dirt' && this.pack.tiles.dirt_c) {
      return { center: ['dirt_c'], n: 'dirt_n', s: 'dirt_s', e: 'dirt_e', w: 'dirt_w', nw: 'dirt_nw', ne: 'dirt_ne', sw: 'dirt_sw', se: 'dirt_se' };
    }
    return this.terrain().grass ?? this.fallbackTerrain('grass');
  }

  // ------------------------------------------------------------------ 바닥 청크 (M6: 16×16 칸 캔버스, 화면 근처만)

  private static readonly CHUNK = 16;
  /** 슬랩 → 청크 키 → 메시 */
  private chunks = new Map<string, { mesh: THREE.Mesh; slab: number; used: number }>();
  private frameNo = 0;
  /** 주변 땅: 부지에서 가장 흔한 지형 (M0 규칙) */
  private commonGround: string[] = ['grass'];
  private commonSet = new Set<string>(['grass']);
  private padTop = 0;
  /** 마지막 화면 범위 (px) */
  private view = { x0: 0, y0: 0, x1: 0, y1: 0 };

  /** 1층 판 주변 땅/범위 계산 + 모든 청크 버림 (다음 updateChunks 에서 다시 만듦) */
  private buildGround(): void {
    const T = this.tile;
    const W = this.lot.w;
    const H = this.H;
    this.padTop = Math.max(this.pad, Math.ceil(this.story / T) * 2 + 2);
    const freq = new Map<string, number>();
    for (let i = 0; i < W * H; i++) {
      const id = this.lot.ground[i];
      if (id) freq.set(id, (freq.get(id) ?? 0) + 1);
    }
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    this.commonGround = sorted.length ? sorted.filter(([, n]) => n >= sorted[0][1] * 0.3).map(([id]) => id) : ['grass'];
    this.commonSet = new Set(this.commonGround);
    for (const c of this.chunks.values()) this.disposeChunk(c.mesh);
    this.chunks.clear();
    this.bounds = { x0: -this.pad * T, y0: -this.padTop * T, x1: (W + this.pad) * T, y1: (H + this.pad) * T };
    // 작은 부지는 한 번에 전부
    if (W * H <= 64 * 64) this.updateChunks(this.bounds.x0, this.bounds.y0, this.bounds.x1, this.bounds.y1, true);
    else this.updateChunks(this.view.x0, this.view.y0, this.view.x1, this.view.y1, true);
  }

  private buildUpper(): void {
    // 위층/지하 바닥도 청크 (updateChunks 가 만듦)
  }

  private disposeChunk(m: THREE.Mesh): void {
    m.parent?.remove(m);
    // 빈 청크 자리표시 메시는 재질이 기본값 (텍스처 없음)
    const mat = m.material as THREE.ShaderMaterial;
    mat.uniforms?.map?.value?.dispose();
    mat.dispose();
  }

  /**
   * 화면 범위(px) + 한 청크 여유 안의 바닥 청크를 만들고, 오래 안 보인 청크는 버림 (최대 개수 유지).
   * 1층 판은 주변 땅 포함, 위층/지하는 부지 안만 (바닥 없는 청크는 만들지 않음)
   */
  updateChunks(x0: number, y0: number, x1: number, y1: number, force = false): void {
    this.view = { x0, y0, x1, y1 };
    if (!this.imageEls.size) return;
    this.frameNo++;
    const T = this.tile;
    const C = WorldView.CHUNK;
    const CP = C * T;
    const margin = CP;
    // 1층 판 청크 좌표는 (-pad, -padTop) 기준
    const ox = -this.pad * T;
    const oy = -this.padTop * T;
    const cx0 = Math.max(0, Math.floor((x0 - margin - ox) / CP));
    const cx1 = Math.floor((x1 + margin - ox) / CP);
    const maxCx = Math.ceil((this.bounds.x1 - ox) / CP) - 1;
    const maxCy = Math.ceil((this.bounds.y1 - oy) / CP) - 1;
    let made = 0;
    for (let s = 0; s < SLABS; s++) {
      if (!this.layers[s].group.visible && !force && s !== 0) continue;
      const yo = this.yOff(s);
      const cy0 = Math.max(0, Math.floor((y0 - margin + yo - oy) / CP));
      const cy1 = Math.min(maxCy, Math.floor((y1 + margin + yo - oy) / CP));
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= Math.min(maxCx, cx1); cx++) {
          const key = `${s}:${cx}:${cy}`;
          const hit = this.chunks.get(key);
          if (hit) {
            hit.used = this.frameNo;
            continue;
          }
          // 한 프레임에 너무 많이 만들지 않음 (끊김 방지): 강제가 아니면 4개까지
          if (!force && made >= 4) continue;
          const mesh = this.drawChunk(s, cx, cy);
          made++;
          this.chunks.set(key, { mesh: mesh ?? new THREE.Mesh(), slab: s, used: this.frameNo });
        }
      }
    }
    // 오래 안 쓴 청크 버림 (최대 160개)
    if (this.chunks.size > 160) {
      const old = [...this.chunks.entries()].filter(([, c]) => c.used < this.frameNo).sort((a, b) => a[1].used - b[1].used);
      for (const [k, c] of old.slice(0, this.chunks.size - 160)) {
        if (c.mesh.parent) this.disposeChunk(c.mesh);
        this.chunks.delete(k);
      }
    }
  }

  /** 청크 한 장 그리기 (없으면 null: 위층에 바닥이 하나도 없음) */
  private drawChunk(slab: number, cx: number, cy: number): THREE.Mesh | null {
    const T = this.tile;
    const C = WorldView.CHUNK;
    const W = this.lot.w;
    const H = this.H;
    const tx0 = cx * C - this.pad;
    const ty0 = cy * C - this.padTop;
    const c = document.createElement('canvas');
    c.width = C * T;
    c.height = C * T + (slab > 0 ? 16 : 0);
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    const level = LEVELS[slab];
    const base = slab * slabStride(H);
    let any = false;
    if (level === 0) {
      any = true;
      for (let y = ty0; y < ty0 + C; y++) {
        for (let x = tx0; x < tx0 + C; x++) {
          const inside = x >= 0 && y >= 0 && x < W && y < H;
          let t: TileRef | undefined;
          if (inside) t = this.groundTile(x, y);
          else {
            const ex = Math.min(W - 1, Math.max(0, x));
            const ey = Math.min(H - 1, Math.max(0, y));
            const edge = this.lot.ground[ey * W + ex];
            const straight = edge && !this.commonSet.has(edge) && (ex === x || ey === y);
            if (straight) t = this.groundTile(ex, ey);
            else {
              const id = this.commonGround[hash2(x, y) % this.commonGround.length];
              t = this.pack.tiles[id];
              if (!t) {
                const set = this.terrain()[id] ?? this.fallbackTerrain(id);
                t = set ? this.pack.tiles[set.center[hash2(x, y) % set.center.length]] : undefined;
              }
            }
          }
          this.drawTile(g, t, (x - tx0) * T, (y - ty0) * T);
          if (inside) {
            const f = this.lot.floor[y * W + x];
            if (f) this.drawTile(g, this.floorTile(f, x, y), (x - tx0) * T, (y - ty0) * T);
          }
        }
      }
    } else if (level < 0) {
      // 지하: 다진 흙 바탕 + 판 곳
      g.fillStyle = '#2b2220';
      g.fillRect(0, 0, c.width, c.height);
      for (let y = ty0; y < ty0 + C; y++) {
        for (let x = tx0; x < tx0 + C; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          any = true;
          if ((hash2(x, y) & 7) === 0) {
            g.fillStyle = '#342a26';
            g.fillRect((x - tx0) * T + (hash2(y, x) % 20), (y - ty0) * T + (hash2(x + 3, y) % 20), 6, 3);
          }
          const f = this.lot.floor[(base + y) * W + x];
          if (f) this.drawTile(g, this.floorTile(f, x, y), (x - tx0) * T, (y - ty0) * T);
        }
      }
    } else {
      // 위층: 바닥 칸만 + 남쪽 끝 들보
      const edge = this.pack.sprites.slab_edge_wood;
      for (let y = ty0; y < ty0 + C; y++) {
        for (let x = tx0; x < tx0 + C; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const f = this.lot.floor[(base + y) * W + x];
          if (!f) continue;
          any = true;
          this.drawTile(g, this.floorTile(f, x, y), (x - tx0) * T, (y - ty0) * T);
          const below = y + 1 < H ? this.lot.floor[(base + y + 1) * W + x] : null;
          const wallBelow = y + 1 < H ? this.lot.walls[(base + y + 1) * W + x] : null;
          if (!below && !wallBelow) {
            if (edge) {
              const img = this.imageEls.get(edge.image);
              if (img) g.drawImage(img, edge.x, edge.y, Math.min(edge.w, T), edge.h, (x - tx0) * T, (y - ty0 + 1) * T, T, edge.h);
            } else {
              g.fillStyle = '#5e4640';
              g.fillRect((x - tx0) * T, (y - ty0 + 1) * T, T, 8);
            }
          }
        }
      }
    }
    if (!any) return null;
    const mesh = this.canvasMesh(c, tx0 * T, ty0 * T - this.yOff(slab));
    mesh.renderOrder = level > 0 ? this.orderBase(slab) - 10 : -1e6 + 1;
    const l = this.layers[slab];
    if (l.tint !== 1) (mesh.material as THREE.ShaderMaterial).uniforms.uTint.value.setRGB(l.tint, l.tint, l.tint * 1.05);
    l.group.add(mesh);
    return mesh;
  }

  private canvasMesh(c: HTMLCanvasElement, left: number, top: number): THREE.Mesh {
    const tex = pixelTexture(c);
    const mat = makeSpriteMaterial(tex);
    const mesh = new THREE.Mesh(quad, mat);
    placeRect(mesh, left, top, c.width, c.height);
    return mesh;
  }

  private spriteNode(spriteId: string, left: number, bottom: number, parent: THREE.Group = this.layers[0].group): SpriteNode | null {
    const ref = this.pack.sprites[spriteId];
    if (!ref) return null;
    const tex = this.textures.get(ref.image);
    if (!tex) return null;
    const mat = makeSpriteMaterial(tex);
    const img = this.imageEls.get(ref.image)!;
    setUvRect(mat, img.width, img.height, ref.x, ref.y, ref.w, ref.h);
    if (ref.emissive) mat.uniforms.uEmissive.value = ref.emissive;
    const mesh = new THREE.Mesh(quad, mat);
    placeRect(mesh, left - ref.anchorX, bottom - ref.anchorY, ref.w, ref.h);
    mesh.renderOrder = bottom * ORDER_SCALE;
    parent.add(mesh);
    return { mesh, mat, spriteId, ref, left, bottom };
  }

  private disposeNode(n: SpriteNode): void {
    n.mesh.parent?.remove(n.mesh);
    n.mat.dispose();
  }

  private setSprite(n: SpriteNode, spriteId: string): void {
    if (n.spriteId === spriteId) {
      if (n.flipX && n.mesh.scale.x > 0) n.mesh.scale.x = -n.mesh.scale.x;
      return;
    }
    const ref = this.pack.sprites[spriteId];
    if (!ref) return;
    const tex = this.textures.get(ref.image)!;
    const img = this.imageEls.get(ref.image)!;
    n.mat.uniforms.map.value = tex;
    setUvRect(n.mat, img.width, img.height, ref.x, ref.y, ref.w, ref.h);
    n.mat.uniforms.uEmissive.value = ref.emissive ?? 0;
    placeRect(n.mesh, n.left - ref.anchorX, n.bottom - ref.anchorY, ref.w, ref.h);
    if (n.flipX) n.mesh.scale.x = -n.mesh.scale.x;
    n.spriteId = spriteId;
    n.ref = ref;
  }

  // ------------------------------------------------------------------ 벽

  /** 같은 판 안의 벽 (판 밖/틈 줄은 없음) */
  private wallAt(x: number, y: number, slab: number): string | null {
    if (x < 0 || x >= this.lot.w) return null;
    const ly = y - slab * slabStride(this.H);
    if (ly < 0 || ly >= this.H) return null;
    return this.lot.walls[y * this.lot.w + x];
  }

  private hasFloor(x: number, y: number, slab: number): boolean {
    if (x < 0 || x >= this.lot.w) return false;
    const ly = y - slab * slabStride(this.H);
    if (ly < 0 || ly >= this.H) return false;
    return !!this.lot.floor[y * this.lot.w + x];
  }

  private openings = new Map<string, { kind: 'door' | 'window'; variant: string | null }>();
  /** 잘라내기 규칙에서 높이 유지하는 벽 칸 */
  private fullWalls = new Set<number>();
  private openDoors = new Set<number>();

  private buildWalls(): void {
    this.openings = new Map(this.lot.openings.map((o) => [`${o.x},${o.y}`, { kind: o.kind, variant: o.variant ?? null }]));
    const rows = this.lot.rows ?? this.H;
    for (let y = 0; y < rows; y++) {
      if (isGapRow(y, this.H)) continue;
      const slab = this.slabOfRow(y);
      for (let x = 0; x < this.lot.w; x++) {
        const style = this.lot.walls[y * this.lot.w + x];
        if (!style || !this.pack.walls[style]) continue;
        const op = this.openings.get(`${x},${y}`);
        this.walls.push({ main: null, cap: null, over: null, x, y, slab, style, opening: op?.kind ?? null, variant: op?.variant ?? null });
      }
    }
    this.computeFull();
    this.refreshWalls();
  }

  /**
   * 잘라내기(tools/world/render-lot.ts 와 같은 규칙, 판마다):
   * 남쪽이 방 바닥인 벽(방의 뒷벽)과 그 벽에 동서로 이어진 벽만 높이 유지, 나머지는 낮춤.
   * up = 전부 높이, down = 전부 낮춤. 실외 보기(지붕)면 전부 높이
   */
  private computeFull(): void {
    this.fullWalls.clear();
    const W = this.lot.w;
    if (this.effectiveCutaway() !== 'cut') return;
    const queue: number[] = [];
    for (const w of this.walls) {
      if (this.hasFloor(w.x, w.y + 1, w.slab) && !this.wallAt(w.x, w.y + 1, w.slab)) {
        const k = w.y * W + w.x;
        this.fullWalls.add(k);
        queue.push(k);
      }
    }
    while (queue.length) {
      const k = queue.pop()!;
      const x = k % W;
      const y = Math.floor(k / W);
      const slab = this.slabOfRow(y);
      for (const nx of [x - 1, x + 1]) {
        const nk = y * W + nx;
        if (this.wallAt(nx, y, slab) && !this.fullWalls.has(nk)) {
          this.fullWalls.add(nk);
          queue.push(nk);
        }
      }
    }
  }

  private effectiveCutaway(): CutawayMode {
    return this.exterior ? 'up' : this.cutaway;
  }

  private isFenceStyle(style: string): boolean {
    return !!(this.pack.walls[style] as { fence?: boolean } | undefined)?.fence;
  }

  private isCut(x: number, y: number): boolean {
    const style = this.lot.walls[y * this.lot.w + x];
    if (style && this.isFenceStyle(style)) return false;
    const mode = this.effectiveCutaway();
    if (mode === 'up') return false;
    if (mode === 'down') return true;
    return !this.fullWalls.has(y * this.lot.w + x);
  }

  /** -1 벽 없음, 0 낮음, 1 높음 */
  private hClass(x: number, y: number, slab: number): number {
    if (!this.wallAt(x, y, slab)) return -1;
    return this.isCut(x, y) ? 0 : 1;
  }

  private refreshWalls(): void {
    const T = this.tile;
    for (const w of this.walls) {
      const wd = this.pack.walls[w.style] as Record<string, unknown> & WorldPack['walls'][string];
      const cut = this.isCut(w.x, w.y);
      const my = this.hClass(w.x, w.y, w.slab);
      const south = this.hClass(w.x, w.y + 1, w.slab);
      const southCovers = south >= my && south >= 0;
      const op = w.opening;
      const alt = w.x % 2 === 1;
      const open = this.openDoors.has(w.y * this.lot.w + w.x);
      const doorArt = op === 'door' && w.variant ? (this.pack.doors as Record<string, { closed: string; open: string; side: string }> | undefined)?.[w.variant] : undefined;
      const winArt = op === 'window' && w.variant ? (this.pack.windows as Record<string, { front: string; side: string }> | undefined)?.[w.variant] : undefined;
      let sid: string | undefined;
      let over: string | null = null;
      if (southCovers) {
        sid = op === 'window' ? (cut ? wd.windowSideCut : wd.windowSide) : op === 'door' ? (cut ? wd.doorSideCut : wd.doorSide) : cut ? wd.topCut : wd.top;
        if (doorArt) {
          sid = cut ? wd.topCut ?? wd.top : wd.top;
          over = doorArt.side;
        } else if (winArt) {
          sid = cut ? wd.topCut ?? wd.top : wd.top;
          over = winArt.side;
        }
        sid ??= cut ? wd.topCut ?? wd.top : wd.top;
      } else if (op === 'door') {
        if (doorArt && wd.doorFrame) {
          sid = cut ? wd.doorFrameCut ?? wd.doorCut : wd.doorFrame;
          if (!cut) over = open ? doorArt.open : doorArt.closed;
        } else sid = cut ? wd.doorCut : open ? wd.doorOpen ?? wd.door : wd.door;
      } else if (op === 'window') {
        if (winArt) {
          sid = cut ? (alt && wd.faceCutAlt ? wd.faceCutAlt : wd.faceCut) : alt && wd.faceAlt ? wd.faceAlt : wd.face;
          if (!cut) over = winArt.front;
        } else sid = cut ? wd.windowCut : alt && wd.windowAlt ? wd.windowAlt : wd.window;
      } else sid = cut ? (alt && wd.faceCutAlt ? wd.faceCutAlt : wd.faceCut) : alt && wd.faceAlt ? wd.faceAlt : wd.face;
      const same = (nx: number, ny: number) => this.hClass(nx, ny, w.slab) === my;
      const mask = (same(w.x, w.y - 1) ? 1 : 0) | (same(w.x + 1, w.y) ? 2 : 0) | (same(w.x, w.y + 1) ? 4 : 0) | (same(w.x - 1, w.y) ? 8 : 0);
      const doorGap = op === 'door' && (cut || southCovers);
      const caps = (cut ? wd.capsCut : wd.caps) as unknown as string[] | undefined;
      const capId = doorGap || (op === 'window' && southCovers) ? null : caps?.[mask] ?? null;
      const ly = this.localRow(w.y);
      const bottom = (ly + 1) * T - this.yOff(w.slab);
      // 같은 아랫변이면 벽이 물건보다 먼저 (render-lot 규칙)
      const order = this.orderBase(w.slab) + (ly + 1) * T * ORDER_SCALE - 3;
      const parent = this.layers[w.slab].group;
      w.main = this.placeWallSprite(w.main, sid ?? null, w.x * T, bottom, order, parent);
      w.cap = this.placeWallSprite(w.cap, capId, w.x * T, bottom, order + 1, parent);
      w.over = this.placeWallSprite(w.over, over, w.x * T, bottom, order + 2, parent);
    }
  }

  private placeWallSprite(n: SpriteNode | null, id: string | null, left: number, bottom: number, order: number, parent: THREE.Group): SpriteNode | null {
    if (!id || (!this.pack.sprites[id] && !this.pack.tiles[id])) {
      if (n) n.mesh.visible = false;
      return n;
    }
    const sid = this.pack.sprites[id] ? id : this.tileSpriteId(id);
    if (!n) n = this.spriteNode(sid, left, bottom, parent);
    else this.setSprite(n, sid);
    if (n) {
      n.mesh.visible = true;
      n.mesh.renderOrder = order;
    }
    return n;
  }

  private tileSpriteId(tileId: string): string {
    const t = this.pack.tiles[tileId];
    const T = this.tile;
    const synthetic = `__tile_${tileId}`;
    if (!this.pack.sprites[synthetic]) {
      this.pack.sprites[synthetic] = { image: t.image, x: t.x, y: t.y, w: t.w ?? T, h: t.h ?? T, anchorX: 0, anchorY: t.h ?? T };
    }
    return synthetic;
  }

  setCutaway(mode: CutawayMode): void {
    this.cutaway = mode;
    this.computeFull();
    this.refreshWalls();
  }

  setViewLevel(level: number): void {
    if (!LEVELS.includes(level)) return;
    this.viewLevel = level;
    this.applyVisibility();
    this.updateChunks(this.view.x0, this.view.y0, this.view.x1, this.view.y1, true);
  }

  /** 층 보이기/흐리게 (벽, 바닥, 물건). 사람은 CharacterView 가 levelVisibility 로 */
  private applyVisibility(): void {
    for (const l of this.layers) {
      const v = this.levelVisibility(l.level);
      l.group.visible = v.visible;
      if (l.tint !== v.tint) {
        l.tint = v.tint;
        l.group.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
          if (m?.uniforms?.uTint) m.uniforms.uTint.value.setRGB(v.tint, v.tint, v.tint * 1.05);
        });
      }
    }
  }

  /** 사람이 문 칸이나 바로 앞뒤에 있으면 문을 열어 둠 */
  syncDoors(people: { x: number; y: number }[]): void {
    const W = this.lot.w;
    const next = new Set<number>();
    for (const w of this.walls) {
      if (w.opening !== 'door') continue;
      for (const p of people) {
        if (Math.abs(p.x - (w.x + 0.5)) < 1.2 && Math.abs(p.y - (w.y + 0.5)) < 1.6) next.add(w.y * W + w.x);
      }
    }
    let changed = next.size !== this.openDoors.size;
    for (const k of next) if (!this.openDoors.has(k)) changed = true;
    if (!changed) return;
    this.openDoors = next;
    this.refreshWalls();
  }

  // ------------------------------------------------------------------ 지붕

  private roofStyle(): string {
    return this.lot.roof?.style ?? 'roof_thatch';
  }

  /** 자동 지붕 (23-2): 맨 위 층 벽/방 칸을 이은 덩어리마다 박공지붕 한 장 (캔버스 합성) */
  private buildRoof(): void {
    for (const c of [...this.roofGroup.children]) {
      this.roofGroup.remove(c);
      const m = (c as THREE.Mesh).material as THREE.ShaderMaterial;
      m.uniforms.map.value.dispose();
      m.dispose();
    }
    this.roofMats = [];
    if (!this.grid) return;
    const T = this.tile;
    const W = this.lot.w;
    const H = this.H;
    const top = this.grid.roofMap();
    const set = (this.pack.roofs as Record<string, RoofSet> | undefined)?.[this.roofStyle()];
    const seen = new Uint8Array(W * H);
    for (let start = 0; start < W * H; start++) {
      if (top[start] < 0 || seen[start]) continue;
      const slab = top[start];
      // 같은 높이 지붕 덩어리
      const cells: number[] = [];
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        cells.push(c);
        const x = c % W;
        const y = (c - x) / W;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (!seen[j] && top[j] === slab) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
      this.drawRoofPiece(cells, slab, set ?? null);
    }
    this.applyRoofAlpha();
    void T;
  }

  private drawRoofPiece(cells: number[], slab: number, set: RoofSet | null): void {
    const T = this.tile;
    const W = this.lot.w;
    let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
    const colTop = new Map<number, number>();
    const colBot = new Map<number, number>();
    for (const c of cells) {
      const x = c % W;
      const y = (c - x) / W;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      colTop.set(x, Math.min(colTop.get(x) ?? Infinity, y));
      colBot.set(x, Math.max(colBot.get(x) ?? -1, y));
    }
    const depth = y1 - y0 + 1;
    const rise = Math.min(56, Math.round(depth * T * 0.38));
    const eave = 8;
    const cw = (x1 - x0 + 1) * T + 8;
    const ch = depth * T + rise + eave + 8;
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    const spr = (id: string | undefined) => (id ? this.pack.sprites[id] : undefined);
    const drawSpr = (id: string | undefined, dx: number, dy: number, w?: number, h?: number) => {
      const s = spr(id);
      if (!s) return false;
      const img = this.imageEls.get(s.image);
      if (!img) return false;
      g.drawImage(img, s.x, s.y, Math.min(s.w, w ?? s.w), Math.min(s.h, h ?? s.h), dx, dy, Math.min(s.w, w ?? s.w), Math.min(s.h, h ?? s.h));
      return true;
    };
    const ox = 4;
    for (let x = x0; x <= x1; x++) {
      const ta = colTop.get(x);
      const tb = colBot.get(x);
      if (ta === undefined || tb === undefined) continue;
      const px = (x - x0) * T + ox;
      // 기둥 한 줄: 위(북) 가장자리 = ta 행 - rise, 아래(남) 가장자리 = tb+1 행 + 처마
      const yTop = (ta - y0) * T;
      const yBot = (tb - y0 + 1) * T + rise + eave;
      const ridge = Math.round(yTop + (yBot - yTop) * 0.36);
      for (let y = yTop; y < yBot; y += T) {
        const h = Math.min(T, yBot - y);
        const north = y + h <= ridge;
        if (!drawSpr(north ? set?.fillN : set?.fill, px, y, T, h)) {
          g.fillStyle = north ? '#b09055' : '#8d6c3c';
          g.fillRect(px, y, T, h);
          g.fillStyle = north ? '#c4a466' : '#7a5b31';
          for (let k = y + ((x * 7) % 6); k < y + h; k += 6) g.fillRect(px, k, T, 1);
        }
      }
      // 남쪽 면 위쪽을 북쪽 면으로 (용마루 경계에서 자름)
      if (set?.fillN) {
        for (let y = yTop; y < ridge; y += T) drawSpr(set.fillN, px, y, T, Math.min(T, ridge - y));
      }
      if (!drawSpr(set?.ridge, px, ridge - Math.floor((spr(set?.ridge)?.h ?? 8) / 2))) {
        g.fillStyle = '#5e4640';
        g.fillRect(px, ridge - 2, T, 4);
        g.fillStyle = '#c4a466';
        g.fillRect(px, ridge - 3, T, 1);
      }
      if (!drawSpr(set?.eave, px, yBot - (spr(set?.eave)?.h ?? 6))) {
        g.fillStyle = '#513c47';
        g.fillRect(px, yBot - 3, T, 3);
      }
    }
    // 박공 끝 테두리
    for (const [side, x] of [['W', x0], ['E', x1]] as const) {
      const ta = colTop.get(x)!;
      const tb = colBot.get(x)!;
      const yTop = (ta - y0) * T;
      const yBot = (tb - y0 + 1) * T + rise + eave;
      const id = side === 'W' ? set?.vergeW : set?.vergeE;
      const s = spr(id);
      const px = side === 'W' ? (x - x0) * T + ox - 2 : (x - x0 + 1) * T + ox - (s?.w ?? 4) + 2;
      if (s) for (let y = yTop; y < yBot; y += s.h) drawSpr(id, px, y, s.w, Math.min(s.h, yBot - y));
      else {
        g.fillStyle = '#513c47';
        g.fillRect(px, yTop, 3, yBot - yTop);
      }
    }
    // 화면 자리: 지붕 밑면 = 맨 위 층 벽 윗면 (판 안 y × T − (층+1) × STORY), 용마루만큼 위로
    const level = Math.max(0, LEVELS[slab]);
    const left = x0 * T - ox;
    const topPx = y0 * T - (level + 1) * this.story - rise;
    const mesh = this.canvasMesh(c, left, topPx);
    mesh.renderOrder = 9e6;
    const mat = mesh.material as THREE.ShaderMaterial;
    this.roofMats.push(mat);
    this.roofGroup.add(mesh);
    // 굴뚝: 벽에 붙은 화로 뒤
    void level;
  }

  private applyRoofAlpha(): void {
    for (const m of this.roofMats) m.uniforms.uOpacity.value = this.roofAlpha;
    this.roofGroup.visible = this.roofAlpha > 0.01;
  }

  /** 매 프레임: 지붕 서서히 (목표 roofTarget). 반쯤 넘으면 실외 보기로 벽/층 전환 */
  updateRoof(dtMs: number): void {
    const k = Math.min(1, dtMs / 350);
    const prev = this.roofAlpha;
    this.roofAlpha += (this.roofTarget - this.roofAlpha) * k;
    if (Math.abs(this.roofAlpha - this.roofTarget) < 0.01) this.roofAlpha = this.roofTarget;
    if (prev !== this.roofAlpha) this.applyRoofAlpha();
    const ext = this.roofAlpha > 0.5;
    if (ext !== this.exterior) {
      this.exterior = ext;
      this.computeFull();
      this.refreshWalls();
      this.applyVisibility();
    }
  }

  get isExterior(): boolean {
    return this.exterior;
  }

  // ------------------------------------------------------------------ 물건

  /** 작물 id 목록 (crops.json 순서, 밭 상태 crop = 번호 + 1) */
  cropIds: string[] = [];

  /** 밭/텃밭/과수: 흙 상태 스프라이트 + 칸마다 작물 성장 단계 덧그림 (31-4 "스프라이트로 구획 모습이 바뀜") */
  private syncField(n: ObjNode, o: ObjectSnap, tags: string[]): string | null {
    const T = this.tile;
    const s = o.state;
    const cropIdx = Number(s.crop ?? 0) - 1;
    const crop = cropIdx >= 0 ? this.cropIds[cropIdx] : null;
    const stage = Math.max(0, Math.min(4, Number(s.stage ?? 0)));
    if (tags.includes('orchard')) {
      if (!crop) return null;
      const k = `orchard_${crop}_${stage >= 4 ? 2 : stage >= 2 ? 1 : 0}`;
      return this.pack.sprites[k] ? k : null;
    }
    const tilled = Number(s.tilled ?? 0) > 0 || !!crop;
    const soil = `${o.defId}_${tilled ? 'tilled' : o.defId === 'garden_plot' ? 'empty' : 'untilled'}`;
    const key = `${crop ?? '-'}:${stage}:${Number(s.weeds ?? 0)}`;
    if (key !== n.cropKey) {
      n.cropKey = key;
      for (const c of n.crops ?? []) this.disposeNode(c);
      n.crops = [];
      if (crop) {
        const cropSprite = this.pack.sprites[`crop_${crop}_${stage}`] ? `crop_${crop}_${stage}` : null;
        const yo = this.yOff(n.slab);
        const ly = this.localRow(n.y);
        for (let j = 0; j < n.footprint.h; j++) {
          for (let i = 0; i < n.footprint.w; i++) {
            const left = (n.x + i) * T + T / 2;
            const bottom = (ly + j + 1) * T - yo;
            const weedy = Number(s.weeds ?? 0) > 0 && (i + j) % 2 === 0 && this.pack.sprites.crop_weeds;
            const sid = weedy ? 'crop_weeds' : cropSprite;
            if (!sid) continue;
            const c = this.spriteNode(sid, left, bottom - 2, this.layers[n.slab].group);
            if (!c) continue;
            // 밭 흙(바닥 높이) 위, 같은 줄 사람과는 발 기준 정렬
            c.mesh.renderOrder = this.orderBase(n.slab) + ((ly + j + 1) * T - 2) * ORDER_SCALE;
            n.crops.push(c);
          }
        }
      }
    }
    return this.pack.sprites[soil] ? soil : null;
  }

  private disposeObj(n: ObjNode): void {
    this.disposeNode(n.node);
    for (const c of n.crops ?? []) this.disposeNode(c);
    if (n.light) {
      n.light.parent?.remove(n.light);
      (n.light.material as THREE.Material).dispose();
    }
  }

  /** 물건 스냅샷 반영: 새 물건 생성, 옮김/팔림 반영, 상태별 스프라이트, 광원. busy = 지금 누가 일하고 있는 물건 */
  syncObjects(objects: ObjectSnap[], busy?: Set<number>): void {
    const T = this.tile;
    const alive = new Set<number>();
    for (const o of objects) {
      alive.add(o.uid);
      let n = this.objs.get(o.uid);
      const variantId = o.variant ? `${o.defId}__${o.variant}` : o.defId;
      let entry = (this.pack.objects[variantId] ?? this.pack.objects[o.defId]) as WorldPack['objects'][string] & {
        rot?: Record<string, string>;
        extra?: Record<string, string>;
      };
      // 불 (23-5): 칸마다 불꽃 (아트 팩 house_fire, 없으면 모닥불)
      if (!entry && o.defId === 'house_fire') entry = { default: this.pack.sprites.house_fire ? 'house_fire' : 'campfire_lit' };
      if (!entry) continue;
      const def = this.defs[o.defId];
      if (!def) continue;
      const rot = o.rot ?? 0;
      if (n && (n.x !== o.x || n.y !== o.y || n.rot !== rot || n.variant !== (o.variant ?? ''))) {
        this.disposeObj(n);
        this.objs.delete(o.uid);
        n = undefined;
      }
      if (!n) {
        const fp = rot % 2 ? { w: def.footprint.h, h: def.footprint.w } : def.footprint;
        const slab = this.slabOfRow(o.y);
        const ly = this.localRow(o.y);
        const localBottom = (ly + fp.h) * T;
        const bottom = localBottom - this.yOff(slab);
        const base = entry.rot?.[String(rot)] ?? entry.default;
        const node = this.spriteNode(base, o.x * T, bottom, this.layers[slab].group);
        if (!node) continue;
        // 방향 없는 물건의 좌우 반전 (rot 2, 방향 그림이 없을 때)
        if (rot === 2 && def.flip && !entry.rot?.['2']) node.flipX = true;
        node.mesh.renderOrder = this.orderBase(slab) + localBottom * ORDER_SCALE;
        // 밟고 지나가는 물건(깔개, 계단)은 바닥 바로 위 (사람/가구 아래)
        if (!def.blocks && !def.wallMounted) node.mesh.renderOrder = this.orderBase(slab) - 1e5 + localBottom;
        // 계단은 올라가는 사람보다 먼저 (사람이 계단 위에 그려짐)
        if (def.tags.includes('stairs')) {
          node.mesh.renderOrder = this.orderBase(slab) + (ly * T) * ORDER_SCALE;
          if (!this.stairCells.has(o.x + o.y * this.lot.w)) this.markStairs(o.x, o.y, fp.h);
        }
        const l = this.layers[slab];
        if (l.tint !== 1) node.mat.uniforms.uTint.value.setRGB(l.tint, l.tint, l.tint * 1.05);
        n = { uid: o.uid, defId: o.defId, node, light: null, lit: false, bottom, localBottom, footprint: fp, x: o.x, y: o.y, rot, variant: o.variant ?? '', slab, base };
        this.objs.set(o.uid, n);
      }
      let want = n.base;
      if (entry.states) {
        for (const [k, sid] of Object.entries(entry.states)) {
          const v = o.state[k];
          if (v === true || (typeof v === 'number' && v > 0)) want = sid;
        }
      }
      if (busy?.has(o.uid) && entry.states?.active) want = entry.states.active;
      const tags = def.tags ?? [];
      if (tags.includes('field') || tags.includes('orchard')) want = this.syncField(n, o, tags) ?? want;
      // 불은 붙었는데 냄비가 없으면 냄비 없는 불 (epic.json hearth.extra)
      const servings = o.state.servings;
      if (o.state.lit === true && typeof servings === 'number' && servings <= 0 && entry.extra?.litNoPot) want = entry.extra.litNoPot;
      this.setSprite(n.node, want);
      const lit = o.state.lit === true;
      const radius = n.node.ref.light ?? (lit ? this.glowRadius(o.defId) : 0);
      if (lit && radius > 0) {
        if (!n.light) {
          const mat = new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, color: 0xffb060 });
          n.light = new THREE.Mesh(quad, mat);
          n.light.renderOrder = 1e7;
          this.layers[n.slab].group.add(n.light);
        }
        const cx = (o.x + n.footprint.w / 2) * T;
        const cy = n.bottom - (n.footprint.h / 2) * T - T / 2;
        const size = radius * 2 * T;
        placeRect(n.light, cx - size / 2, cy - size / 2, size, size);
        n.lit = true;
      } else {
        n.lit = false;
        if (n.light) n.light.visible = false;
      }
    }
    for (const [uid, n] of this.objs) {
      if (alive.has(uid)) continue;
      this.disposeObj(n);
      this.objs.delete(uid);
    }
    this.syncChimneys(objects);
  }

  private chimneys: { key: string; nodes: SpriteNode[]; smoke: SpriteNode | null }[] = [];
  private chimneyKey = '';

  /** 굴뚝 (23-2): 벽 붙이기 화로 뒤 벽 위 지붕에 굴뚝, 불 피우면 연기. 지붕과 함께 보였다 사라짐 */
  private syncChimneys(objects: ObjectSnap[]): void {
    const g = this.grid;
    if (!g) return;
    const T = this.tile;
    const list: { x: number; wy: number; lit: boolean; slab: number }[] = [];
    for (const o of objects) {
      const kind = this.defs[o.defId]?.kind ?? o.defId;
      if (kind !== 'hearth') continue;
      const fp = this.defs[o.defId].footprint;
      const w = (o.rot ?? 0) % 2 ? fp.h : fp.w;
      const wy = o.y - 1;
      if (wy < 0 || !this.lot.walls[wy * this.lot.w + o.x]) continue;
      list.push({ x: o.x + w / 2, wy, lit: o.state.lit === true, slab: this.slabOfRow(o.y) });
    }
    const key = JSON.stringify(list) + this.lot.roof?.style + this.chimneyKeyLot;
    if (key === this.chimneyKey) return;
    this.chimneyKey = key;
    for (const c of this.chimneys) {
      for (const n of c.nodes) this.disposeNode(n);
      if (c.smoke) this.disposeNode(c.smoke);
    }
    this.chimneys = [];
    const top = g.roofMap();
    const style = this.lot.roof?.style ?? 'roof_thatch';
    const sid = this.pack.sprites[style === 'roof_slate' || style === 'roof_tile' ? 'chimney_brick' : 'chimney_stone'] ? (style === 'roof_slate' || style === 'roof_tile' ? 'chimney_brick' : 'chimney_stone') : this.pack.sprites.chimney_stone ? 'chimney_stone' : null;
    for (const c of list) {
      const ly = this.localRow(c.wy);
      const cellX = Math.floor(c.x);
      const topSlab = top[ly * this.lot.w + cellX];
      if (topSlab < 0) continue;
      const level = Math.max(0, LEVELS[topSlab]);
      const cx = c.x * T;
      const base = ly * T - (level + 1) * this.story - 10;
      const nodes: SpriteNode[] = [];
      if (sid) {
        const n = this.spriteNode(sid, cx, base, this.roofGroup);
        if (n) {
          n.mesh.renderOrder = 9e6 + 5;
          this.roofMats.push(n.mat);
          nodes.push(n);
        }
      }
      let smoke: SpriteNode | null = null;
      if (c.lit && this.pack.sprites.chimney_smoke) {
        const h = sid ? this.pack.sprites[sid].h : 30;
        smoke = this.spriteNode('chimney_smoke', cx, base - h + 6, this.roofGroup);
        if (smoke) {
          smoke.mesh.renderOrder = 9e6 + 6;
          this.roofMats.push(smoke.mat);
        }
      }
      this.chimneys.push({ key: `${c.x},${c.wy}`, nodes, smoke });
    }
    this.applyRoofAlpha();
  }

  /** 부지가 바뀌면 굴뚝도 다시 */
  private chimneyKeyLot = 0;

  glowRadii: Record<string, number> = {};
  private glowRadius(defId: string): number {
    return this.glowRadii[defId] ?? this.glowRadii.default ?? 0;
  }

  /** 침대의 베개 위 머리 중심 (화면 px). 사람 위치에 가장 가까운 자리 */
  lieHead(uid: number, px: number, py: number): { x: number; y: number } | null {
    const n = this.objs.get(uid);
    if (!n) return null;
    const entry = this.pack.objects[n.variant ? `${n.defId}__${n.variant}` : n.defId] ?? this.pack.objects[n.defId];
    const heads = (entry as { lieHeads?: Record<string, [number, number]> }).lieHeads;
    if (!heads) return null;
    const T = this.tile;
    const top = n.bottom - n.footprint.h * T;
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (const [hx, hy] of Object.values(heads)) {
      const x = n.x * T + hx;
      const y = top + hy;
      const d = Math.abs(x - px) + Math.abs(y - py);
      if (d < bd) {
        bd = d;
        best = { x, y };
      }
    }
    return best;
  }

  /** 애니메이션 프레임과 광원 세기 (어두울수록 강함) */
  animate(timeMs: number, darkness: number): void {
    for (const c of this.chimneys) {
      const r = c.smoke?.ref;
      if (c.smoke && r?.frames && r.frames > 1) {
        const f = Math.floor((timeMs / 1000) * (r.fps ?? 8)) % r.frames;
        const img = this.imageEls.get(r.image)!;
        setUvRect(c.smoke.mat, img.width, img.height, r.x + f * (r.frameDx ?? r.w), r.y, r.w, r.h);
      }
    }
    for (const n of this.objs.values()) {
      const r = n.node.ref;
      if (r.frames && r.frames > 1) {
        const f = Math.floor((timeMs / 1000) * (r.fps ?? 8)) % r.frames;
        const img = this.imageEls.get(r.image)!;
        setUvRect(n.node.mat, img.width, img.height, r.x + f * (r.frameDx ?? r.w), r.y, r.w, r.h);
      }
      if (n.light && n.lit) {
        const flicker = 0.85 + 0.15 * Math.sin(timeMs / 90 + n.uid) * Math.sin(timeMs / 230 + n.uid * 3);
        // 낮에는 빛 번짐 없음 (픽셀 흐림 검사 대상 화면을 깨끗하게), 어두울수록 강해짐
        const op = 0.6 * darkness * flicker;
        (n.light.material as THREE.MeshBasicMaterial).opacity = op;
        n.light.visible = op > 0.01 && this.layers[n.slab].group.visible;
      }
    }
  }

  /** 세계 픽셀 좌표에 있는 물건 (위에 그려진 것 우선, 보이는 층만). 투명 픽셀은 통과 */
  pick(wx: number, wy: number): number | null {
    let best: ObjNode | null = null;
    for (const n of this.objs.values()) {
      if (!this.layers[n.slab].group.visible) continue;
      if (this.exterior && this.roofAlpha > 0.5 && !this.defs[n.defId]?.tags.includes('outdoor')) {
        // 지붕이 덮은 집 안 물건은 못 누름
        const g = this.grid;
        if (g && g.roomOf(n.x, n.y) >= 0) continue;
      }
      const r = n.node.ref;
      const left = n.node.left - r.anchorX;
      const top = n.node.bottom - r.anchorY;
      if (wx < left || wx >= left + r.w || wy < top || wy >= top + r.h) continue;
      if (!this.opaqueAt(r, wx - left, wy - top)) continue;
      if (!best || n.node.mesh.renderOrder > best.node.mesh.renderOrder) best = n;
    }
    return best ? best.uid : null;
  }

  private alphaCache = new Map<string, Uint8ClampedArray>();
  private opaqueAt(r: SpriteRef, px: number, py: number): boolean {
    const img = this.imageEls.get(r.image);
    if (!img) return true;
    let data = this.alphaCache.get(r.image);
    if (!data) {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      data = g.getImageData(0, 0, img.width, img.height).data;
      this.alphaCache.set(r.image, data);
    }
    const x = Math.floor(r.x + px);
    const y = Math.floor(r.y + py);
    return data[(y * img.width + x) * 4 + 3] > 20;
  }

  /** 앉기/눕기 정렬용: 물건 발자국 아래 가장자리의 renderOrder 기준 (층 기준값 포함, ORDER_SCALE 곱하기 전 px 로 환산) */
  objectBottom(uid: number): number | null {
    const n = this.objs.get(uid);
    return n ? n.localBottom + this.orderBase(n.slab) / ORDER_SCALE : null;
  }

  objectTags(uid: number): string[] {
    const n = this.objs.get(uid);
    return n ? this.defs[n.defId]?.tags ?? [] : [];
  }

  /** 물건 사각형 (칸, 화면 y 는 screenTop 에) */
  objectRect(uid: number): { x: number; y: number; w: number; h: number; screenBottom: number } | null {
    const n = this.objs.get(uid);
    if (!n) return null;
    return { x: n.x, y: n.y, w: n.footprint.w, h: n.footprint.h, screenBottom: n.bottom };
  }

  blanketSprite(uid: number): string | null {
    const n = this.objs.get(uid);
    if (!n) return null;
    const entry = this.pack.objects[n.variant ? `${n.defId}__${n.variant}` : n.defId] ?? this.pack.objects[n.defId];
    const id = (entry as { blanket?: string }).blanket ?? `${n.defId}_blanket`;
    return this.pack.sprites[id] ? id : null;
  }

  /** 팩이 참조하는 모든 사각형의 색 (인물 색 보정의 팔레트 스냅용) */
  paletteColors(): number[] {
    const set = new Set<number>();
    const T = this.tile;
    const add = (image: string, x: number, y: number, w: number, h: number) => {
      const img = this.imageEls.get(image);
      if (!img) return;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, x, y, w, h, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    };
    for (const t of Object.values(this.pack.tiles)) add(t.image, t.x, t.y, t.w ?? T, t.h ?? T);
    for (const s of Object.values(this.pack.sprites)) add(s.image, s.x, s.y, s.w, s.h);
    return [...set];
  }

  /** y정렬 감사: 화면에 보이는 물건 사각형과 발 위치(판 안 + 층 기준), 순서 */
  sortItems(): { uid: number; left: number; top: number; right: number; bottom: number; foot: number; order: number; flat: boolean }[] {
    const out = [];
    for (const n of this.objs.values()) {
      if (!n.node.mesh.visible || !this.layers[n.slab].group.visible) continue;
      const r = n.node.ref;
      const left = n.node.left - r.anchorX;
      const top = n.node.bottom - r.anchorY;
      const def = this.defs[n.defId];
      out.push({
        uid: n.uid, left, top, right: left + r.w, bottom: top + r.h, foot: n.localBottom + this.orderBase(n.slab) / ORDER_SCALE, order: n.node.mesh.renderOrder,
        flat: (!def.blocks && !def.wallMounted) || !!def.wallMounted || def.tags.includes('stairs'),
      });
    }
    return out;
  }

  /** 성능 측정용 장식: 주변 풀밭에 물건 그림 n개 (sim 과 무관, 그리기 부하만) */
  addDecor(n: number, seed: number): void {
    const ids = Object.values(this.pack.objects).map((o) => o.default).filter((id) => this.pack.sprites[id]);
    const T = this.tile;
    let h = seed >>> 0;
    const next = () => {
      h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
      return h / 4294967296;
    };
    const { x0, y0, x1, y1 } = this.bounds;
    for (let i = 0; i < n; i++) {
      const id = ids[Math.floor(next() * ids.length)];
      let x = 0;
      let y = 0;
      for (let k = 0; k < 20; k++) {
        x = Math.floor((x0 + next() * (x1 - x0)) / T) * T;
        y = Math.floor((y0 + next() * (y1 - y0)) / T) * T;
        const cx = x / T;
        const cy = y / T;
        if (cx < 0 || cy < 0 || cx >= this.lot.w || cy >= this.H) break;
      }
      this.spriteNode(id, x, y + T);
    }
  }

  spriteRef(id: string): SpriteRef | undefined {
    return this.pack.sprites[id];
  }

  textureFor(imageId: string): { tex: THREE.Texture; w: number; h: number } | null {
    const tex = this.textures.get(imageId);
    const img = this.imageEls.get(imageId);
    return tex && img ? { tex, w: img.width, h: img.height } : null;
  }

  addOverlay(spriteId: string, left: number, bottom: number, order: number): SpriteNode | null {
    const n = this.spriteNode(spriteId, left, bottom);
    if (n) n.mesh.renderOrder = order;
    return n;
  }

  /** 건축 모드 미리보기용: 지금 부지와 팩 */
  get currentLot(): LotDef {
    return this.lot;
  }

  get artPack(): WorldPack {
    return this.pack;
  }

  image(id: string): HTMLImageElement | undefined {
    return this.imageEls.get(id);
  }

  texture(id: string): THREE.Texture | undefined {
    return this.textures.get(id);
  }

  /** 층 판 그룹 (건축 미리보기 그림을 같은 층에 붙임) */
  layerGroup(slab: number): THREE.Group {
    return this.layers[slab].group;
  }

  /** 방 격자 (렌더러 쪽 계산, 지붕/방 표시) */
  get lotGrid(): Grid | null {
    return this.grid;
  }
}

function makeGlowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,220,160,1)');
  grad.addColorStop(0.4, 'rgba(255,170,90,0.45)');
  grad.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
