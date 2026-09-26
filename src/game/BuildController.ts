/**
 * 건축/구매 모드 조작 (GDD 23-2 ~ 23-4): 마우스 칸 → 미리보기 → 편집 의도 (Simulation 'build' intent).
 * - 벽/울타리: 끌어서 곧은 줄, 방: 사각형, 바닥/지형/지하 파기/벽 지우기: 사각형 (Shift+클릭 바닥 = 방 채우기)
 * - 문/창: 벽 칸 클릭, 지붕: 재질 고르면 바로
 * - 구매/계단: 물건 유령이 커서를 따라다니고 (놓을 수 없으면 붉게), Q/E 회전, 클릭 놓기, Esc 그만
 * - 손: 물건 집어 옮기기, Delete 팔기. 실행 취소 Ctrl+Z / 다시 Ctrl+Y
 * - 길 막힘 경고 칸은 붉게 깜빡임, 건축 모드에서 방 이름표
 */
import * as THREE from 'three';
import type { BuildOp, BuildResult, BuildWarning } from '../sim/build/builder';
import type { RoomInfo } from '../sim/build/rooms';
import type { BuildData } from '../sim/data/simData';
import type { LotDef, ObjectDef } from '../sim/core/types';
import type { Snapshot } from '../sim/protocol';
import { ESTATE_RANK } from '../sim/social/relations';
import { LEVELS, slabStride } from '../sim/world/lot';
import { placeRect, type GameRenderer } from '../render/GameRenderer';
import { makeSpriteMaterial, setUvRect } from '../render/SpriteMaterial';
import type { WorldView } from '../render/WorldView';
import { BUY_CATEGORIES, BuildPanel, TOOL_PARTS, type BuildTool, type CatalogItem, type GameMode, type PartEntry, formatPrice } from '../ui/BuildPanel';
import { t } from '../i18n';
import type { SimClient } from './SimClient';

const quad = new THREE.PlaneGeometry(1, 1);
const GHOST_ORDER = 9.5e6;
const LINE_TOOLS = new Set<BuildTool>(['wall', 'fence']);
const RECT_TOOLS = new Set<BuildTool>(['room', 'floor', 'terrain', 'cellar', 'erase']);

interface Deps {
  world: WorldView;
  renderer: GameRenderer;
  client: SimClient;
  defs: Record<string, ObjectDef>;
  build: BuildData;
  app: HTMLElement;
  setViewLevel(level: number): void;
  stepViewLevel(dir: number): void;
  setCutaway(mode: 'up' | 'cut' | 'down'): void;
  setRoofMode(mode: 'auto' | 'on' | 'off'): void;
  setSpeed(s: number): void;
}

export class BuildController {
  readonly panel: BuildPanel;
  mode: GameMode = 'live';
  private tool: BuildTool = 'wall';
  private group = new THREE.Group();
  private cellMeshes: THREE.Mesh[] = [];
  private ghost: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; defId: string; variant?: string } | null = null;
  private held: { defId: string; variant?: string; rot: number; moveUid: number | null; crafted?: string } | null = null;
  private hover: { x: number; y: number } | null = null;
  private dragFrom: { x: number; y: number } | null = null;
  private placeOk: string | null = null;
  private queryAt = '';
  private warnings: BuildWarning[] = [];
  private warnMeshes: THREE.Mesh[] = [];
  private roomLabels: HTMLElement;
  private rooms: RoomInfo[] = [];
  private spent = 0;
  private speedBefore = 1;
  private cellMat: THREE.MeshBasicMaterial;
  private badMat: THREE.MeshBasicMaterial;
  private warnMat: THREE.MeshBasicMaterial;
  private wallGhostMats: THREE.ShaderMaterial[] = [];

  constructor(private d: Deps) {
    this.group.renderOrder = GHOST_ORDER;
    d.renderer.scene.add(this.group);
    this.cellMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false });
    this.badMat = new THREE.MeshBasicMaterial({ color: 0xd04030, transparent: true, opacity: 0.38, depthTest: false, depthWrite: false });
    this.warnMat = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false });
    this.roomLabels = document.createElement('div');
    this.roomLabels.className = 'room-labels';
    d.app.appendChild(this.roomLabels);
    this.panel = new BuildPanel(d.app, {
      setMode: (m) => this.setMode(m),
      setTool: (tool) => this.setTool(tool),
      pickPart: (tool, id) => this.pickPart(tool, id),
      pickObject: (defId, variant) => this.pickObject(defId, variant),
      undo: () => void this.undo(),
      setConstruction: (on) => void d.client.intent({ kind: 'setConstruction', on }),
      redo: () => void this.redo(),
      stepLevel: (dir) => d.stepViewLevel(dir),
      setCutaway: (m) => d.setCutaway(m),
      setRoofMode: (m) => d.setRoofMode(m),
      thumb: (kind, id, variant) => this.thumb(kind, id, variant),
      parts: (tool) => this.parts(tool),
      catalog: () => this.catalog(),
    });
  }

  get active(): boolean {
    return this.mode !== 'live';
  }

  // ------------------------------------------------------------------ 모드, 도구

  setMode(m: GameMode): void {
    if (m === this.mode) return;
    const was = this.mode;
    this.mode = m;
    this.panel.setMode(m);
    this.d.app.classList.toggle('game-build', m !== 'live');
    this.cancelHeld();
    this.clearCells();
    // 심즈처럼 건축/구매 중에는 시간이 멈춤, 나오면 전 속도로
    const snap = this.d.client.snap;
    if (was === 'live' && m !== 'live') {
      this.speedBefore = snap?.speed || 1;
      this.d.setSpeed(0);
      void this.d.client.intent({ kind: 'buildMode', on: true });
      this.spent = 0;
    } else if (m === 'live') {
      this.d.setSpeed(this.speedBefore);
      void this.d.client.intent({ kind: 'buildMode', on: false });
      this.roomLabels.innerHTML = '';
      if (this.d.world.viewLevel < 0) this.d.setViewLevel(0);
    }
    if (m === 'build') this.setTool(this.tool);
    this.renderWarnings();
  }

  setTool(tool: BuildTool): void {
    this.tool = tool;
    this.panel.setTool(tool);
    this.cancelHeld();
    this.clearCells();
    if (tool === 'cellar') this.d.setViewLevel(-1);
    else if (tool === 'terrain' || tool === 'fence') this.d.setViewLevel(0);
    else if (this.d.world.viewLevel < 0 && tool !== 'stairs') this.d.setViewLevel(0);
    if (tool === 'stairs') {
      const id = this.panel.partOf('stairs');
      if (id) this.hold(id);
    }
    this.panel.flash(t(`build.hint.${tool}`));
  }

  private pickPart(tool: BuildTool, id: string): void {
    if (tool === 'roof') void this.send({ op: 'roof', style: id });
    if (tool === 'stairs') {
      this.hold(id);
      if (id === 'cellar_hatch') this.d.setViewLevel(0);
    }
  }

  private pickObject(defId: string, variant?: string): void {
    // 손수 만든 것 탭: id 가 craft:<품목>
    if (defId.startsWith('craft:')) {
      const item = defId.slice(6);
      const obj = this.d.build.craftedFurniture?.[item];
      if (!obj) return;
      this.hold(obj);
      if (this.held) this.held.crafted = item;
      return;
    }
    this.hold(defId, variant);
  }

  private hold(defId: string, variant?: string, moveUid: number | null = null, rot = 0): void {
    this.held = { defId, variant, rot, moveUid };
    this.makeGhost(defId, variant, rot);
    this.queryAt = '';
  }

  private cancelHeld(): void {
    this.held = null;
    if (this.ghost) {
      this.group.remove(this.ghost.mesh);
      this.ghost.mat.dispose();
      this.ghost = null;
    }
    this.panel.clearObject();
  }

  // ------------------------------------------------------------------ 목록 (build.json + 물건 정의)

  private estateRank(): number {
    const e = this.d.client.snap?.econ?.estate ?? this.d.client.snap?.persons.find((p) => p.household === 1)?.inner?.estate ?? 'freeman';
    return ESTATE_RANK[e] ?? 1;
  }

  private locked(estate?: string | null): boolean {
    return !!estate && this.estateRank() < (ESTATE_RANK[estate] ?? 0);
  }

  private parts(tool: BuildTool): PartEntry[] {
    const kind = TOOL_PARTS[tool];
    if (!kind) return [];
    if (kind === 'stairs') {
      return ['stairs_wood', 'stairs_stone', 'cellar_hatch'].filter((id) => this.d.defs[id]).map((id) => ({
        id, nameKey: this.d.defs[id].nameKey, price: this.d.defs[id].price ?? 0, locked: this.locked(this.d.defs[id].estate), estate: this.d.defs[id].estate,
      }));
    }
    const table = this.d.build[kind] as Record<string, { nameKey: string; price: number; estate?: string | null; fenceOnly?: boolean; cellarOnly?: boolean }>;
    return Object.entries(table)
      .filter(([, p]) => !(tool === 'door' && p.fenceOnly) && !p.cellarOnly)
      .map(([id, p]) => ({ id, nameKey: p.nameKey, price: p.price, locked: this.locked(p.estate), estate: p.estate }));
  }

  private catalogCache: CatalogItem[] | null = null;
  private catalog(): CatalogItem[] {
    if (!this.catalogCache) {
      const cats = new Set<string>(BUY_CATEGORIES);
      this.catalogCache = Object.entries(this.d.defs)
        .filter(([, o]) => o.category && cats.has(o.category) && (o.price ?? 0) > 0)
        .map(([id, o]) => ({ id, nameKey: o.nameKey, category: o.category!, price: o.price ?? 0, locked: false, estate: o.estate, roomScore: o.roomScore ?? 0, variants: o.variants ?? [] }));
    }
    for (const c of this.catalogCache) c.locked = this.locked(c.estate);
    // 손수 만든 가구 (23-4): 저장고에 있는 것만
    const stock = this.d.client.snap?.stock ?? {};
    const crafted: CatalogItem[] = Object.entries(this.d.build.craftedFurniture ?? {})
      .filter(([item]) => (stock[item] ?? 0) > 0)
      .map(([item, obj]) => ({ id: `craft:${item}`, nameKey: this.d.defs[obj]?.nameKey ?? obj, category: 'crafted', price: 0, locked: false, roomScore: this.d.defs[obj]?.roomScore ?? 0, variants: [], crafted: { item, n: stock[item] } }));
    return [...this.catalogCache, ...crafted];
  }

  // ------------------------------------------------------------------ 썸네일

  private thumbCache = new Map<string, HTMLCanvasElement>();
  private thumb(kind: string, id: string, variant?: string): HTMLCanvasElement | null {
    const key = `${kind}:${id}:${variant ?? ''}`;
    const hit = this.thumbCache.get(key);
    if (hit) return hit.cloneNode(true) instanceof HTMLCanvasElement ? copy(hit) : hit;
    const w = this.d.world;
    const pack = w.artPack as unknown as Record<string, Record<string, unknown>> & { sprites: Record<string, { image: string; x: number; y: number; w: number; h: number }>; tiles: Record<string, { image: string; x: number; y: number; w?: number; h?: number }> };
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 48;
    c.className = 'thumb';
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    const sprite = (sid: string | undefined): boolean => {
      const s = sid ? pack.sprites[sid] : undefined;
      if (!s) return false;
      const img = w.image(s.image);
      if (!img) return false;
      const k = Math.min(1, 44 / Math.max(s.w, s.h));
      const dw = Math.max(1, Math.round(s.w * k));
      const dh = Math.max(1, Math.round(s.h * k));
      g.drawImage(img, s.x, s.y, s.w, s.h, Math.round((48 - dw) / 2), Math.round((48 - dh) / 2), dw, dh);
      return true;
    };
    const tile = (tid: string | undefined, dx = 8, dy = 8, size = 32): boolean => {
      const tt = tid ? pack.tiles[tid] : undefined;
      if (!tt) return false;
      const img = w.image(tt.image);
      if (!img) return false;
      g.drawImage(img, tt.x, tt.y, tt.w ?? 32, tt.h ?? 32, dx, dy, size, size);
      return true;
    };
    const tiles2 = (list: string[] | undefined) => {
      if (!list?.length) return false;
      for (let i = 0; i < 4; i++) tile(list[i % list.length], (i % 2) * 24, Math.floor(i / 2) * 24, 24);
      return true;
    };
    let ok = false;
    const walls = pack.walls as Record<string, Record<string, string>>;
    if (kind === 'walls') ok = sprite(walls[id]?.face);
    else if (kind === 'fences') ok = sprite((walls[id] as unknown as { caps?: string[] })?.caps?.[10]) || sprite(walls[id]?.face);
    else if (kind === 'floors') ok = tiles2((pack.floors as Record<string, string[]> | undefined)?.[id]) || tile(id);
    else if (kind === 'terrain') ok = tiles2((pack.terrain as Record<string, { center: string[] }> | undefined)?.[id]?.center) || (id === 'grass' && tile('grass_1'));
    else if (kind === 'doors') ok = sprite((pack.doors as Record<string, { closed: string }> | undefined)?.[id]?.closed);
    else if (kind === 'windows') ok = sprite((pack.windows as Record<string, { front: string }> | undefined)?.[id]?.front);
    else if (kind === 'roofs') ok = sprite((pack.roofs as Record<string, { fill: string }> | undefined)?.[id]?.fill);
    else if (kind === 'object' || kind === 'stairs') {
      const objs = pack.objects as Record<string, { default: string }>;
      ok = sprite((objs[variant ? `${id}__${variant}` : id] ?? objs[id])?.default);
    } else if (kind === 'tool') {
      const TOOL_ART: Record<string, () => boolean> = {
        wall: () => sprite(walls.wall_timber?.face), room: () => sprite(walls.wall_stone?.face ?? walls.wall_timber?.face),
        erase: () => sprite(walls.wall_timber?.faceCut), door: () => sprite(walls.wall_timber?.door), window: () => sprite(walls.wall_timber?.window),
        floor: () => tiles2(['floor_wood_1', 'floor_wood_2', 'floor_wood_3', 'floor_wood_4']), terrain: () => tiles2(['grass_1', 'grass_2', 'dirt_c', 'grass_3']),
        fence: () => sprite((walls.fence_wood as unknown as { caps?: string[] })?.caps?.[10]), stairs: () => sprite((pack.objects as Record<string, { default: string }>).stairs_wood?.default),
        roof: () => sprite((pack.roofs as Record<string, { fill: string }> | undefined)?.roof_thatch?.fill), cellar: () => tile('floor_stone_1'),
        name: () => sprite((pack.objects as Record<string, { default: string }>).bed_straw?.default), hand: () => sprite((pack.objects as Record<string, { default: string }>).chair?.default),
      };
      ok = TOOL_ART[id]?.() ?? false;
    }
    if (!ok) {
      g.fillStyle = '#5b321b';
      g.fillRect(6, 6, 36, 36);
    }
    this.thumbCache.set(key, c);
    return copy(c);
  }

  // ------------------------------------------------------------------ 입력

  /** 캔버스 누름 (왼쪽 버튼, 건축/구매 중) */
  pointerDown(wx: number, wy: number, shift: boolean): void {
    void shift;
    const cell = this.d.world.screenToCell(wx, wy);
    if (!cell) return;
    if (this.held) return;
    if (LINE_TOOLS.has(this.tool) || RECT_TOOLS.has(this.tool)) {
      if (this.mode === 'build') this.dragFrom = cell;
    }
  }

  pointerMove(wx: number, wy: number): void {
    const cell = this.d.world.screenToCell(wx, wy);
    this.hover = cell;
    this.refreshPreview();
  }

  pointerUp(wx: number, wy: number, shift: boolean): void {
    const cell = this.d.world.screenToCell(wx, wy) ?? this.hover;
    const from = this.dragFrom;
    this.dragFrom = null;
    if (!cell) return;
    if (this.held) {
      void this.placeHeld(cell);
      return;
    }
    if (this.mode === 'buy' || this.tool === 'hand') {
      this.pickUpAt(wx, wy);
      return;
    }
    const a = from ?? cell;
    switch (this.tool) {
      case 'wall':
      case 'fence': {
        const [x1, y1] = this.snapLine(a, cell);
        const style = this.panel.partOf(this.tool);
        if (style) void this.send({ op: 'wall', x0: a.x, y0: a.y, x1, y1, style });
        break;
      }
      case 'room': {
        const style = this.panel.partOf('wall');
        const floor = this.panel.partOf('floor') ?? 'floor_wood';
        if (style) void this.send({ op: 'room', x0: a.x, y0: a.y, x1: cell.x, y1: cell.y, style, floor });
        break;
      }
      case 'erase': {
        const lot = this.d.world.currentLot;
        if (a.x === cell.x && a.y === cell.y && lot.openings.some((o) => o.x === cell.x && o.y === cell.y)) void this.send({ op: 'removeOpening', x: cell.x, y: cell.y });
        else void this.send({ op: 'eraseWall', x0: a.x, y0: a.y, x1: cell.x, y1: cell.y });
        break;
      }
      case 'floor': {
        const style = this.panel.partOf('floor');
        if (!style) break;
        if (shift && a.x === cell.x && a.y === cell.y) void this.send({ op: 'fillFloor', x: cell.x, y: cell.y, style });
        else void this.send({ op: 'floor', x0: a.x, y0: a.y, x1: cell.x, y1: cell.y, style });
        break;
      }
      case 'terrain': {
        const style = this.panel.partOf('terrain');
        if (style) void this.send({ op: 'terrain', x0: a.x, y0: a.y, x1: cell.x, y1: cell.y, style });
        break;
      }
      case 'cellar':
        void this.send({ op: 'digCellar', x0: a.x, y0: a.y, x1: cell.x, y1: cell.y });
        break;
      case 'door':
      case 'window': {
        // 이미 있는 문을 누르면 잠금 바꾸기 (모두 → 가족만 → 신분 이상)
        const lot = this.d.world.currentLot;
        const existing = lot.openings.find((o) => o.x === cell.x && o.y === cell.y);
        if (existing && existing.kind === 'door' && this.tool === 'door') {
          const order = ['all', 'family', 'estate'] as const;
          const next = order[(order.indexOf((existing.lock ?? 'all') as (typeof order)[number]) + 1) % order.length];
          void this.send({ op: 'lock', x: cell.x, y: cell.y, lock: next }).then((r) => r?.ok && this.panel.flash(t(`build.lock.${next}`)));
          break;
        }
        const variant = this.panel.partOf(this.tool) ?? undefined;
        const fence = this.isFence(cell.x, cell.y);
        void this.send({ op: 'opening', x: cell.x, y: cell.y, kind: this.tool, variant: fence && this.tool === 'door' ? 'gate_wood' : variant });
        break;
      }
      case 'name':
        this.nameRoom(cell);
        break;
      default:
        break;
    }
    this.clearCells();
  }

  /** 키 (건축/구매 중이면 true = 처리함) */
  key(e: KeyboardEvent): boolean {
    if (!this.active) {
      if (e.key === 'F2' || (e.key === 'b' && !e.ctrlKey)) {
        this.setMode('build');
        return true;
      }
      return false;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      void (e.shiftKey ? this.redo() : this.undo());
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      void this.redo();
      return true;
    }
    if (e.key === 'Escape') {
      if (this.held) this.cancelHeld();
      else this.setMode('live');
      return true;
    }
    if (this.held && (e.key === 'q' || e.key === 'Q' || e.key === ',' || e.key === 'e' || e.key === 'E' || e.key === '.')) {
      const dir = e.key === 'q' || e.key === 'Q' || e.key === ',' ? 3 : 1;
      this.rotateHeld(dir);
      return true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.held?.moveUid) {
        const uid = this.held.moveUid;
        this.cancelHeld();
        void this.send({ op: 'sell', uid });
      } else if (this.hover) {
        const uid = this.objectAtHover();
        if (uid !== null) void this.send({ op: 'sell', uid });
      }
      return true;
    }
    return false;
  }

  private rotateHeld(dir: number): void {
    const h = this.held;
    if (!h) return;
    const def = this.d.defs[h.defId];
    const allowed = def?.rotations ?? [0];
    const all = def?.flip && allowed.length <= 1 ? [0, 2] : allowed.length > 1 ? allowed : [0, 1, 2, 3];
    if (allowed.length <= 1 && !this.hasRotArt(h.defId) && !def?.flip) return;
    let r = h.rot;
    for (let k = 0; k < 4; k++) {
      r = (r + dir) % 4;
      if (all.includes(r)) break;
    }
    h.rot = r;
    this.makeGhost(h.defId, h.variant, r);
    this.queryAt = '';
    this.refreshPreview();
  }

  private hasRotArt(defId: string): boolean {
    const o = (this.d.world.artPack.objects as Record<string, { rot?: Record<string, string> }>)[defId];
    return !!o?.rot && Object.keys(o.rot).length > 0;
  }

  // ------------------------------------------------------------------ 보내기

  private async send(op: BuildOp): Promise<BuildResult | null> {
    const r = await this.d.client.intent<BuildResult>({ kind: 'build', op });
    this.afterResult(r);
    return r;
  }

  private async undo(): Promise<void> {
    const r = await this.d.client.intent<BuildResult | null>({ kind: 'buildUndo' });
    if (r?.ok) {
      this.spent += r.cost;
      this.panel.flash(t('build.undone'));
    }
  }

  private async redo(): Promise<void> {
    const r = await this.d.client.intent<BuildResult | null>({ kind: 'buildRedo' });
    if (r?.ok) this.spent += r.cost;
  }

  private afterResult(r: BuildResult | null): void {
    if (!r) return;
    if (!r.ok) {
      this.panel.flash(t(`build.err.${r.reason ?? 'unknown'}`, { money: formatPrice(r.cost) }), true);
      return;
    }
    this.spent += r.cost;
    if (r.cost > 0) this.panel.flash(t('build.paid', { money: formatPrice(r.cost) }));
    else if (r.cost < 0) this.panel.flash(t('build.refund', { money: formatPrice(-r.cost) }));
    if (r.warnings?.length) this.panel.flash(t('build.warn.path', { n: r.warnings.length }), true);
  }

  private async placeHeld(cell: { x: number; y: number }): Promise<void> {
    const h = this.held;
    if (!h) return;
    const fp = this.footprint(h.defId, h.rot);
    const x = cell.x - Math.floor((fp.w - 1) / 2);
    const y = cell.y - Math.floor((fp.h - 1) / 2);
    if (h.moveUid !== null) {
      const r = await this.send({ op: 'move', uid: h.moveUid, x, y, rot: h.rot });
      if (r?.ok) this.cancelHeld();
      return;
    }
    if (h.crafted) {
      const r = await this.send({ op: 'placeCrafted', item: h.crafted, x, y, rot: h.rot });
      if (r?.ok && (this.d.client.snap?.stock[h.crafted] ?? 0) <= 0) this.cancelHeld();
      this.panel.setCategory('crafted');
      return;
    }
    await this.send({ op: 'buy', defId: h.defId, x, y, rot: h.rot, variant: h.variant });
    this.queryAt = '';
    this.refreshPreview();
  }

  private objectAtHover(): number | null {
    const h = this.hover;
    const snap = this.d.client.snap;
    if (!h || !snap) return null;
    for (const o of snap.objects) {
      const def = this.d.defs[o.defId];
      if (!def || o.defId === 'lot_exit' || o.defId === 'window_opening') continue;
      const fp = this.footprint(o.defId, o.rot ?? 0);
      if (h.x >= o.x && h.x < o.x + fp.w && h.y >= o.y && h.y < o.y + fp.h) return o.uid;
    }
    return null;
  }

  /** 구매 모드/손: 누른 물건을 집음 */
  private pickUpAt(wx: number, wy: number): void {
    const uid = this.d.world.pick(wx, wy) ?? this.objectAtHover();
    if (uid === null) return;
    const o = this.d.client.snap?.objects.find((q) => q.uid === uid);
    if (!o || o.defId === 'lot_exit' || o.defId === 'window_opening') return;
    this.hold(o.defId, o.variant, uid, o.rot ?? 0);
    this.panel.flash(t('build.picked', { name: t(this.d.defs[o.defId]?.nameKey ?? o.defId) }));
  }

  private nameRoom(cell: { x: number; y: number }): void {
    const g = this.d.world.lotGrid;
    if (!g || g.roomOf(cell.x, cell.y) < 0) {
      this.panel.flash(t('build.err.not_room'), true);
      return;
    }
    const box = document.createElement('div');
    box.className = 'name-box panel-cream';
    const input = document.createElement('input');
    input.maxLength = 16;
    input.placeholder = t('build.name.placeholder');
    box.appendChild(input);
    this.d.app.appendChild(box);
    input.focus();
    const done = (ok: boolean) => {
      if (ok && input.value.trim()) void this.send({ op: 'nameRoom', x: cell.x, y: cell.y, name: input.value.trim() });
      box.remove();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true));
  }

  // ------------------------------------------------------------------ 미리보기

  private footprint(defId: string, rot: number): { w: number; h: number } {
    const f = this.d.defs[defId]?.footprint ?? { w: 1, h: 1 };
    return rot % 2 ? { w: f.h, h: f.w } : f;
  }

  private isFence(x: number, y: number): boolean {
    const s = this.d.world.currentLot.walls[y * this.d.world.currentLot.w + x];
    return !!s && !!this.d.build.fences[s];
  }

  private snapLine(a: { x: number; y: number }, b: { x: number; y: number }): [number, number] {
    return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? [b.x, a.y] : [a.x, b.y];
  }

  private clearCells(): void {
    for (const m of this.cellMeshes) this.group.remove(m);
    this.cellMeshes = [];
    for (const m of this.wallGhostMats) m.dispose();
    this.wallGhostMats = [];
  }

  /** 칸 강조 (보는 층 높이에 맞춤). tall = 벽 높이만큼 (벽 미리보기) */
  private markCell(x: number, y: number, bad: boolean, tall = false): void {
    const w = this.d.world;
    const p = w.project(x, y);
    const T = w.tile;
    const m = new THREE.Mesh(quad, bad ? this.badMat : this.cellMat);
    const h = tall ? T + w.story : T;
    placeRect(m, p.x, p.y + T - h, T, h);
    m.renderOrder = GHOST_ORDER;
    this.group.add(m);
    this.cellMeshes.push(m);
  }

  /** 벽 재질 그대로 반투명 미리보기 */
  private ghostWall(x: number, y: number, style: string): boolean {
    const w = this.d.world;
    const pack = w.artPack;
    const wd = (pack.walls as Record<string, Record<string, string>>)[style];
    const s = wd ? pack.sprites[wd.face] : undefined;
    const tex = s ? w.texture(s.image) : undefined;
    const img = s ? w.image(s.image) : undefined;
    if (!s || !tex || !img) return false;
    const mat = makeSpriteMaterial(tex);
    setUvRect(mat, img.width, img.height, s.x, s.y, s.w, s.h);
    mat.uniforms.uOpacity.value = 0.7;
    const m = new THREE.Mesh(quad, mat);
    const p = w.project(x, y);
    const T = w.tile;
    placeRect(m, p.x - s.anchorX, p.y + T - s.anchorY, s.w, s.h);
    m.renderOrder = GHOST_ORDER + y;
    this.group.add(m);
    this.cellMeshes.push(m);
    this.wallGhostMats.push(mat);
    return true;
  }

  private makeGhost(defId: string, variant: string | undefined, rot: number): void {
    if (this.ghost) {
      this.group.remove(this.ghost.mesh);
      this.ghost.mat.dispose();
      this.ghost = null;
    }
    const w = this.d.world;
    const pack = w.artPack;
    const entry = ((pack.objects as Record<string, { default: string; rot?: Record<string, string> }>)[variant ? `${defId}__${variant}` : defId]
      ?? (pack.objects as Record<string, { default: string; rot?: Record<string, string> }>)[defId]);
    const sid = entry?.rot?.[String(rot)] ?? entry?.default;
    const s = sid ? pack.sprites[sid] : undefined;
    const tex = s ? w.texture(s.image) : undefined;
    const img = s ? w.image(s.image) : undefined;
    if (!s || !tex || !img) return;
    const mat = makeSpriteMaterial(tex);
    setUvRect(mat, img.width, img.height, s.x, s.y, s.w, s.h);
    mat.uniforms.uOpacity.value = 0.78;
    const mesh = new THREE.Mesh(quad, mat);
    mesh.renderOrder = GHOST_ORDER + 100;
    mesh.visible = false;
    this.group.add(mesh);
    this.ghost = { mesh, mat, defId, variant };
  }

  private refreshPreview(): void {
    this.clearCells();
    const h = this.hover;
    if (!h || !this.active) {
      if (this.ghost) this.ghost.mesh.visible = false;
      this.panel.hint(null);
      return;
    }
    if (this.held) {
      this.previewHeld(h);
      return;
    }
    if (this.mode !== 'build') {
      const uid = this.objectAtHover();
      if (uid !== null) {
        const o = this.d.client.snap?.objects.find((q) => q.uid === uid);
        if (o) {
          const fp = this.footprint(o.defId, o.rot ?? 0);
          for (let dy = 0; dy < fp.h; dy++) for (let dx = 0; dx < fp.w; dx++) this.markCell(o.x + dx, o.y + dy, false);
        }
      }
      return;
    }
    const a = this.dragFrom ?? h;
    const b = this.build();
    if (LINE_TOOLS.has(this.tool)) {
      const [x1, y1] = this.snapLine(a, h);
      const style = this.panel.partOf(this.tool) ?? '';
      let n = 0;
      for (let y = Math.min(a.y, y1); y <= Math.max(a.y, y1); y++) {
        for (let x = Math.min(a.x, x1); x <= Math.max(a.x, x1); x++) {
          if (!this.ghostWall(x, y, style)) this.markCell(x, y, false, true);
          n++;
        }
      }
      const part = b.walls[style] ?? b.fences[style];
      this.panel.hint(t('build.preview.wall', { n, money: formatPrice(n * (part?.price ?? 0)) }));
      return;
    }
    if (RECT_TOOLS.has(this.tool)) {
      const xa = Math.min(a.x, h.x), xb = Math.max(a.x, h.x), ya = Math.min(a.y, h.y), yb = Math.max(a.y, h.y);
      let n = 0;
      if (this.tool === 'room') {
        const style = this.panel.partOf('wall') ?? '';
        for (let y = ya; y <= yb; y++) {
          for (let x = xa; x <= xb; x++) {
            const edge = x === xa || x === xb || y === ya || y === yb;
            if (edge) {
              if (!this.ghostWall(x, y, style)) this.markCell(x, y, false, true);
              n++;
            } else this.markCell(x, y, false);
          }
        }
        const wp = b.walls[style]?.price ?? 0;
        const fp = b.floors[this.panel.partOf('floor') ?? 'floor_wood']?.price ?? 0;
        this.panel.hint(t('build.preview.room', { w: xb - xa - 1, h: yb - ya - 1, money: formatPrice(n * wp + Math.max(0, (xb - xa - 1) * (yb - ya - 1)) * fp) }));
        return;
      }
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        this.markCell(x, y, this.tool === 'erase');
        n++;
      }
      const price = this.tool === 'floor' ? b.floors[this.panel.partOf('floor') ?? '']?.price ?? 0
        : this.tool === 'terrain' ? b.terrain[this.panel.partOf('terrain') ?? '']?.price ?? 0
        : this.tool === 'cellar' ? b.cellarDigPrice + (b.floors.floor_cellar?.price ?? 0) : 0;
      this.panel.hint(t(`build.preview.${this.tool}`, { n, money: formatPrice(n * price) }));
      return;
    }
    if (this.tool === 'door' || this.tool === 'window') {
      const lot = this.d.world.currentLot;
      const wall = !!lot.walls[h.y * lot.w + h.x];
      this.markCell(h.x, h.y, !wall, true);
      return;
    }
    if (this.tool === 'name' || this.tool === 'hand') this.markCell(h.x, h.y, false);
  }

  private previewHeld(h: { x: number; y: number }): void {
    const held = this.held!;
    const fp = this.footprint(held.defId, held.rot);
    const x = h.x - Math.floor((fp.w - 1) / 2);
    const y = h.y - Math.floor((fp.h - 1) / 2);
    const key = `${held.defId}:${x}:${y}:${held.rot}:${held.moveUid}`;
    if (key !== this.queryAt) {
      this.queryAt = key;
      void this.d.client
        .request<string | null>((reqId) => ({ type: 'buildQuery', defId: held.defId, x, y, rot: held.rot, except: held.moveUid ?? undefined, reqId }))
        .then((r) => {
          if (this.queryAt !== key) return;
          this.placeOk = r;
          this.refreshPreview();
        });
    }
    const bad = this.placeOk !== null;
    for (let dy = 0; dy < fp.h; dy++) for (let dx = 0; dx < fp.w; dx++) this.markCell(x + dx, y + dy, bad);
    const g = this.ghost;
    if (g) {
      const w = this.d.world;
      const s = w.artPack.sprites[this.ghostSprite(held)];
      if (s) {
        const p = w.project(x, y);
        const T = w.tile;
        placeRect(g.mesh, p.x - s.anchorX, p.y + fp.h * T - s.anchorY, s.w, s.h);
        g.mesh.visible = true;
        g.mat.uniforms.uTint.value.setRGB(bad ? 1.4 : 1, bad ? 0.55 : 1, bad ? 0.5 : 1);
      }
    }
    const def = this.d.defs[held.defId];
    this.panel.hint(bad ? t(`build.err.${this.placeOk}`) : `${t(def?.nameKey ?? held.defId)} · ${held.moveUid !== null ? t('build.moving') : formatPrice(def?.price ?? 0)}`);
  }

  private ghostSprite(held: { defId: string; variant?: string; rot: number }): string {
    const objs = this.d.world.artPack.objects as Record<string, { default: string; rot?: Record<string, string> }>;
    const e = objs[held.variant ? `${held.defId}__${held.variant}` : held.defId] ?? objs[held.defId];
    return e?.rot?.[String(held.rot)] ?? e?.default ?? '';
  }

  private build(): BuildData {
    return this.d.build;
  }

  // ------------------------------------------------------------------ 스냅샷, 프레임

  update(s: Snapshot): void {
    if (s.rooms) this.rooms = s.rooms;
    const b = s.build;
    if (b) {
      if (JSON.stringify(b.warnings) !== JSON.stringify(this.warnings)) {
        this.warnings = b.warnings;
        this.renderWarnings();
      }
      this.panel.update({ canUndo: b.canUndo, canRedo: b.canRedo, warnings: b.warnings.length, spent: this.spent, construction: b.construction });
      const sig = JSON.stringify(b.pending);
      if (sig !== this.pendingSig) {
        this.pendingSig = sig;
        this.renderPending(b.pending);
      }
    }
    if (s.lot) {
      this.queryAt = '';
      this.refreshPreview();
      this.renderWarnings();
    }
  }

  private pendingSig = '';
  private pendingNodes: THREE.Mesh[] = [];
  private pendingMats: THREE.ShaderMaterial[] = [];

  /** 공사 예정 (23-3): 비계처럼 흐린 벽 + 진척 */
  private renderPending(list: { id: number; op: BuildOp; progress: number }[]): void {
    for (const m of this.pendingNodes) this.group.remove(m);
    for (const m of this.pendingMats) m.dispose();
    this.pendingNodes = [];
    this.pendingMats = [];
    const before = this.cellMeshes.length;
    for (const p of list) {
      const o = p.op as { op: string; x0?: number; y0?: number; x1?: number; y1?: number; style?: string; x?: number; y?: number };
      if (o.x0 === undefined || o.y0 === undefined) continue;
      const xa = Math.min(o.x0, o.x1 ?? o.x0), xb = Math.max(o.x0, o.x1 ?? o.x0), ya = Math.min(o.y0, o.y1 ?? o.y0), yb = Math.max(o.y0, o.y1 ?? o.y0);
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const edge = x === xa || x === xb || y === ya || y === yb;
        if ((o.op === 'wall' || (o.op === 'room' && edge)) && o.style) this.ghostWall(x, y, o.style);
        else this.markCell(x, y, false);
      }
    }
    // ghostWall/markCell 이 cellMeshes 에 넣은 것을 공사 표시로 옮김 (미리보기 지우기와 따로)
    const added = this.cellMeshes.splice(before);
    const mats = this.wallGhostMats.splice(this.wallGhostMats.length - added.filter((m) => m.material instanceof THREE.ShaderMaterial).length);
    for (const m of added) {
      const mat = m.material as THREE.ShaderMaterial;
      if (mat.uniforms?.uOpacity) mat.uniforms.uOpacity.value = 0.35;
    }
    this.pendingNodes = added;
    this.pendingMats = mats;
  }

  private renderWarnings(): void {
    for (const m of this.warnMeshes) this.group.remove(m);
    this.warnMeshes = [];
    if (!this.active) return;
    const w = this.d.world;
    const T = w.tile;
    for (const wn of this.warnings) {
      const p = w.project(wn.x, wn.y);
      const m = new THREE.Mesh(quad, this.warnMat);
      placeRect(m, p.x, p.y, T, T);
      m.renderOrder = GHOST_ORDER - 1;
      this.group.add(m);
      this.warnMeshes.push(m);
    }
  }

  /** 매 프레임: 경고 깜빡임, 방 이름표 */
  frame(now: number): void {
    this.warnMat.opacity = 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(now / 180));
    if (!this.active) return;
    const w = this.d.world;
    const g = w.lotGrid;
    const lot: LotDef = w.currentLot;
    const want: string[] = [];
    const labels = [...this.roomLabels.children] as HTMLElement[];
    let k = 0;
    if (g) {
      for (const r of this.rooms) {
        if (r.level !== w.viewLevel) continue;
        // 방 가운데 (대표 칸이 아닌 칸들의 평균)
        let sx = 0, sy = 0, n = 0;
        for (let i = 0; i < g.room.length; i++) {
          if (g.room[i] !== r.id) continue;
          sx += i % lot.w;
          sy += Math.floor(i / lot.w);
          n++;
        }
        if (!n) continue;
        const p = w.project(sx / n + 0.5, sy / n + 0.5);
        const sp = this.d.renderer.worldToScreen(p.x, p.y);
        let lab = labels[k];
        if (!lab) {
          lab = document.createElement('div');
          lab.className = 'room-label';
          this.roomLabels.appendChild(lab);
        }
        k++;
        const name = r.name ?? t(`room.type.${r.type}`);
        const text = `${name} · ${t(`room.tier.${r.tier}`)}`;
        if (lab.textContent !== text) lab.textContent = text;
        lab.dataset.tier = r.tier;
        lab.style.transform = `translate(${Math.round(sp.x)}px, ${Math.round(sp.y)}px) translate(-50%, -50%)`;
        want.push(text);
      }
    }
    for (let i = labels.length - 1; i >= k; i--) labels[i].remove();
    void LEVELS;
    void slabStride;
  }
}

function copy(c: HTMLCanvasElement): HTMLCanvasElement {
  const o = document.createElement('canvas');
  o.width = c.width;
  o.height = c.height;
  o.className = c.className;
  o.getContext('2d')!.drawImage(c, 0, 0);
  return o;
}
