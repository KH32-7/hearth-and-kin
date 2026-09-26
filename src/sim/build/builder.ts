/**
 * 건축 모드와 구매 모드 (GDD 23-2 ~ 23-4). 모든 편집은 의도(intent)로 들어와 입력 로그에 남음 → 재생 결정론.
 * 좌표는 전체 행 좌표 (world/lot.ts: 층 판을 세로로 쌓은 격자). 렌더러/DOM 없음.
 */
import type { LotDef, ObjectDef, ObjectInstance } from '../core/types';
import type { BuildData, SimData } from '../data/simData';
import { EXIT_OBJECT_ID, FIRE_OBJECT_ID, SITE_OBJECT_ID, WINDOW_OBJECT_ID } from '../data/simData';
import type { Account, Economy } from '../econ/economy';
import type { Person } from '../people/person';
import { ESTATE_RANK } from '../social/relations';
import { LEVELS, cloneLot, isGapRow, slabOfRow, slabStride } from '../world/lot';
import type { World } from '../world/world';

export type BuildOp =
  | { op: 'wall'; x0: number; y0: number; x1: number; y1: number; style: string }
  | { op: 'room'; x0: number; y0: number; x1: number; y1: number; style: string; floor?: string }
  | { op: 'eraseWall'; x0: number; y0: number; x1: number; y1: number }
  | { op: 'floor'; x0: number; y0: number; x1: number; y1: number; style: string | null }
  | { op: 'fillFloor'; x: number; y: number; style: string }
  | { op: 'terrain'; x0: number; y0: number; x1: number; y1: number; style: string }
  | { op: 'opening'; x: number; y: number; kind: 'door' | 'window'; variant?: string }
  | { op: 'removeOpening'; x: number; y: number }
  | { op: 'lock'; x: number; y: number; lock: 'family' | 'all' | 'estate' }
  | { op: 'roof'; style: string }
  | { op: 'buy'; defId: string; x: number; y: number; rot?: number; variant?: string }
  | { op: 'move'; uid: number; x: number; y: number; rot?: number }
  | { op: 'sell'; uid: number }
  | { op: 'digCellar'; x0: number; y0: number; x1: number; y1: number }
  | { op: 'nameRoom'; x: number; y: number; name: string }
  /** 직접 만든 가구 놓기 (저장고 품목 하나를 씀, 값 없음) */
  | { op: 'placeCrafted'; item: string; x: number; y: number; rot?: number };

export interface BuildResult {
  ok: boolean;
  /** 실패 이유 i18n 꼬리 (build.err.<reason>) */
  reason?: string;
  /** 쓴 돈 (음수 = 받은 돈) */
  cost: number;
  /** 새로 놓은 물건 uid (buy) */
  uid?: number;
  /** 공사 예정 번호 (공사 시간 옵션) */
  pending?: number;
  /** 바뀐 칸 수 */
  cells?: number;
  warnings: BuildWarning[];
}

/** 길 막힘 경고 (BRIEF M5 통과 조건): 출구에서 닿지 못하는 문/물건 자리/사람 */
export interface BuildWarning {
  kind: 'door' | 'object' | 'person' | 'stairs_no_landing' | 'hatch_no_cellar' | 'room_no_door' | 'room_unreachable';
  x: number;
  y: number;
  uid?: number;
  personId?: number;
}

export interface BuildHost {
  readonly world: World;
  readonly data: SimData;
  readonly persons: Person[];
  readonly econ: Economy | null;
  /** 조작 가정 계좌 (없으면 돈 검사 안 함) */
  account(): Account | null;
  /** 조작 가정 신분 */
  estate(): string;
  /** 물건을 쓰는/향하는 사람의 행동을 끊음 */
  abortUsing(uid: number): void;
  /** 설 수 없는 칸에 선 사람을 옮김 */
  unstickAll(): void;
  /** 공사가 끝남/못 지음 (알림) */
  onConstruction?(p: PendingWork, ok: boolean): void;
}

interface Snapshot {
  lot: LotDef;
  objects: ObjectInstance[];
  cost: number;
  /** 직접 만든 가구를 놓은 편집: 되돌리면 저장고/만든 사람도 */
  stock?: { item: string; maker: number | null };
  /** 공사 예정으로 들어간 편집 (실행 취소하면 예정에서 뺌) */
  pendingId?: number;
}

/** 공사 예정 (23-3 공사 시간 옵션): 값은 미리 내고, 목수/석공 NPC 또는 가족이 일해서 다 되면 실제로 지어짐 */
export interface PendingWork {
  id: number;
  op: BuildOp;
  cost: number;
  work: number;
  done: number;
  familyDone: number;
  /** 공사 자리 가상 물건 (가족이 '짓기' 하러 감) */
  siteUid: number;
}

/** 공사 시간이 걸리는 편집 (물건 사고팔기, 이름, 잠금, 지형 칠하기는 바로) */
const TIMED = new Set(['wall', 'room', 'floor', 'fillFloor', 'opening', 'roof', 'digCellar', 'eraseWall']);

const HOLE_TAG = 'stairs';
/** 건축 편집 대상이 아닌 가상 물건 */
const VIRTUAL = new Set([WINDOW_OBJECT_ID, EXIT_OBJECT_ID, FIRE_OBJECT_ID, SITE_OBJECT_ID]);

export class Builder {
  private undoStack: Snapshot[] = [];
  private redoStack: { op: BuildOp; uid?: number }[] = [];
  /** redo 로 다시 사는 물건은 처음 uid 그대로 (뒤따르는 move/sell redo 가 맞게) */
  private forceUid: number | null = null;
  lastWarnings: BuildWarning[] = [];
  private lastCrafted: { item: string; maker: number | null } | null = null;
  /** 공사 시간 옵션 (기본 꺼짐 = 심즈처럼 바로 완성) */
  construction = false;
  readonly pending: PendingWork[] = [];
  private nextPending = 1;

  constructor(private host: BuildHost) {}

  private get b(): BuildData {
    return this.host.data.build!;
  }

  private get lot(): LotDef {
    return this.host.world.lot;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ---------------------------------------------------------------- 칸 도우미

  private idx(x: number, y: number): number {
    return y * this.lot.w + x;
  }

  private rows(): number {
    return this.lot.rows ?? this.lot.h;
  }

  private inLot(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.lot.w && y < this.rows() && !isGapRow(y, this.lot.h);
  }

  private slab(y: number): number {
    return slabOfRow(y, this.lot.h);
  }

  private level(y: number): number {
    return LEVELS[this.slab(y)];
  }

  /** 다른 슬랩의 같은 자리 행 */
  private rowIn(y: number, slab: number): number {
    return slab * slabStride(this.lot.h) + (y % slabStride(this.lot.h));
  }

  /** 층 번호가 하나 아래인 판의 같은 칸 (없으면 -1) */
  private below(x: number, y: number): number {
    const lv = this.level(y);
    if (lv <= 0) return -1;
    const s = LEVELS.indexOf(lv - 1);
    return this.idx(x, this.rowIn(y, s));
  }

  private isFence(style: string | null): boolean {
    return !!style && !!this.b.fences[style];
  }

  /** 위층 칸을 받쳐 주는가: 아래층 같은 칸이 (울타리 아닌) 벽이거나 바닥 */
  private supported(x: number, y: number): boolean {
    const lv = this.level(y);
    if (lv <= 0) return true;
    const bi = this.below(x, y);
    const w = this.lot.walls[bi];
    return (!!w && !this.isFence(w)) || !!this.lot.floor[bi];
  }

  /** 계단 위 구멍 칸 (위층에 바닥을 깔 수 없음) */
  private holeCells(): Set<number> {
    const out = new Set<number>();
    const w = this.host.world;
    for (const o of w.objects) {
      const d = this.host.data.objects[o.defId];
      if (!d?.tags.includes(HOLE_TAG)) continue;
      const lv = this.level(o.y);
      const up = LEVELS.indexOf(lv + 1);
      if (up < 0) continue;
      const fp = w.footprint(o);
      for (let dy = 0; dy < fp.h; dy++) for (let dx = 0; dx < fp.w; dx++) out.add(this.idx(o.x + dx, this.rowIn(o.y + dy, up)));
    }
    return out;
  }

  private rect(x0: number, y0: number, x1: number, y1: number): { xa: number; ya: number; xb: number; yb: number } | null {
    const xa = Math.min(x0, x1);
    const xb = Math.max(x0, x1);
    const ya = Math.min(y0, y1);
    const yb = Math.max(y0, y1);
    if (!this.inLot(xa, ya) || !this.inLot(xb, yb)) return null;
    if (this.slab(ya) !== this.slab(yb)) return null;
    return { xa, ya, xb, yb };
  }

  private estateOk(req: string | null | undefined): boolean {
    if (!req) return true;
    const have = ESTATE_RANK[this.host.estate()] ?? 1;
    return have >= (ESTATE_RANK[req] ?? 0);
  }

  private money(): number {
    const a = this.host.account();
    return a ? a.money : Infinity;
  }

  private pay(cost: number): void {
    const a = this.host.account();
    if (!a || !this.host.econ || cost === 0) return;
    if (cost > 0) this.host.econ.spend(a, cost, 'build');
    else this.host.econ.earn(a, -cost, 'resale', false);
  }

  /** 물건이 차지하는 칸 */
  private cellsOf(o: { x: number; y: number }, fp: { w: number; h: number }): number[] {
    const out: number[] = [];
    for (let dy = 0; dy < fp.h; dy++) for (let dx = 0; dx < fp.w; dx++) out.push(this.idx(o.x + dx, o.y + dy));
    return out;
  }

  private blockingAt(i: number, except = -1): ObjectInstance | null {
    const g = this.host.world.grid;
    const v = g.objAt[i];
    if (v !== 0 && v - 1 !== except) return this.host.world.byUid.get(v - 1) ?? null;
    return null;
  }

  // ---------------------------------------------------------------- 실행

  /** 편집 하나를 적용. 실패하면 아무것도 바꾸지 않음 */
  apply(op: BuildOp, fromRedo = false): BuildResult {
    if (!this.host.data.build) return { ok: false, reason: 'disabled', cost: 0, warnings: [] };
    const before: Snapshot = { lot: cloneLot(this.lot), objects: this.cloneObjects(), cost: 0 };
    const r = this.run(op);
    if (!r.ok) {
      // 여러 칸 편집이 중간에 실패해도 아무것도 바뀌지 않게 (리뷰 M5-2)
      this.restore(before);
      return r;
    }
    if (r.cost > this.money() && r.cost > 0) {
      this.restore(before);
      return { ok: false, reason: 'no_money', cost: r.cost, warnings: [] };
    }
    if (this.construction && TIMED.has(op.op) && r.cost > 0) {
      // 공사 예정: 되는지만 보고 되돌린 뒤 값을 미리 냄
      this.restore(before);
      this.pay(r.cost);
      const id = this.nextPending++;
      const c = this.b.construction;
      const at = this.siteCell(op);
      const site = this.host.world.addSite(at.x, at.y);
      this.pending.push({ id, op, cost: r.cost, work: Math.max(30, r.cost * c.workPerFarthing), done: 0, familyDone: 0, siteUid: site.uid });
      this.undoStack.push({ ...before, cost: r.cost, pendingId: id });
      if (this.undoStack.length > this.b.undoDepth) this.undoStack.shift();
      if (!fromRedo) this.redoStack.length = 0;
      (this.undoStack[this.undoStack.length - 1] as Snapshot & { op?: BuildOp }).op = op;
      this.host.world.lotVersion++;
      return { ok: true, cost: r.cost, cells: r.cells, warnings: this.lastWarnings, pending: id };
    }
    this.pay(r.cost);
    before.cost = r.cost;
    if (op.op === 'placeCrafted' && this.lastCrafted) before.stock = this.lastCrafted;
    if (r.uid !== undefined) (before as Snapshot & { uid?: number }).uid = r.uid;
    this.undoStack.push(before);
    if (this.undoStack.length > this.b.undoDepth) this.undoStack.shift();
    if (!fromRedo) this.redoStack.length = 0;
    (before as Snapshot & { op?: BuildOp }).op = op;
    this.afterChange();
    r.warnings = this.lastWarnings;
    return r;
  }

  undo(): BuildResult {
    const s = this.undoStack.pop();
    if (!s) return { ok: false, reason: 'nothing_to_undo', cost: 0, warnings: [] };
    const op = (s as Snapshot & { op?: BuildOp }).op;
    if (s.pendingId !== undefined) {
      // 아직 안 지은 공사: 예정에서 빼고 돌려줌
      const k = this.pending.findIndex((p) => p.id === s.pendingId);
      if (k >= 0) {
        const p = this.pending[k];
        const paidBack = Math.round((p.cost * this.b.construction.laborShare * p.familyDone) / p.work);
        this.host.abortUsing(p.siteUid);
        this.host.world.removeObject(p.siteUid);
        this.pending.splice(k, 1);
        this.pay(-(s.cost - paidBack));
        if (op) this.redoStack.push({ op });
        this.host.world.lotVersion++;
        return { ok: true, cost: -(s.cost - paidBack), warnings: this.lastWarnings };
      }
      return { ok: false, reason: 'already_built', cost: 0, warnings: [] };
    }
    this.restore(s);
    this.pay(-s.cost);
    if (s.stock) {
      const w = this.host.world;
      w.stock[s.stock.item] = (w.stock[s.stock.item] ?? 0) + 1;
      if (s.stock.maker !== null) (w.makers[s.stock.item] ??= []).unshift(s.stock.maker);
    }
    if (op) this.redoStack.push({ op, uid: (s as Snapshot & { uid?: number }).uid });
    this.afterChange();
    return { ok: true, cost: -s.cost, warnings: this.lastWarnings };
  }

  redo(): BuildResult {
    const r = this.redoStack.pop();
    if (!r) return { ok: false, reason: 'nothing_to_redo', cost: 0, warnings: [] };
    this.forceUid = r.uid ?? null;
    try {
      return this.apply(r.op, true);
    } finally {
      this.forceUid = null;
    }
  }

  /** 건축 모드를 나가면 실행 취소 기록을 비움 (심즈처럼 모드 안에서만) */
  clearHistory(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  private afterChange(): void {
    const w = this.host.world;
    for (const uid of w.rebuild()) this.host.abortUsing(uid);
    this.host.unstickAll();
    this.lastWarnings = this.checkPaths();
  }

  private cloneObjects(): ObjectInstance[] {
    return this.host.world.objects
      .filter((o) => o.defId !== WINDOW_OBJECT_ID && o.defId !== EXIT_OBJECT_ID && o.defId !== FIRE_OBJECT_ID && o.defId !== SITE_OBJECT_ID)
      .map((o) => ({ ...o, state: { ...o.state } }));
  }

  private restore(s: Snapshot): void {
    const w = this.host.world;
    const lot = this.lot;
    lot.ground.splice(0, lot.ground.length, ...s.lot.ground);
    lot.floor.splice(0, lot.floor.length, ...s.lot.floor);
    lot.walls.splice(0, lot.walls.length, ...s.lot.walls);
    lot.openings.splice(0, lot.openings.length, ...s.lot.openings);
    lot.roof = s.lot.roof;
    lot.roomNames = s.lot.roomNames;
    const keep = new Map(s.objects.map((o) => [o.uid, o]));
    for (const o of [...w.objects]) {
      if (o.defId === WINDOW_OBJECT_ID || o.defId === EXIT_OBJECT_ID || o.defId === FIRE_OBJECT_ID || o.defId === SITE_OBJECT_ID) continue;
      const k = keep.get(o.uid);
      if (!k) {
        this.host.abortUsing(o.uid);
        w.removeObject(o.uid);
      } else if (k.x !== o.x || k.y !== o.y || (k.rot ?? 0) !== (o.rot ?? 0)) {
        this.host.abortUsing(o.uid);
        w.grid.clearObject(o, w.footprint(o));
        o.x = k.x;
        o.y = k.y;
        if (k.rot) o.rot = k.rot;
        else delete o.rot;
      }
    }
    for (const o of s.objects) if (!w.byUid.has(o.uid)) w.restoreObject({ ...o, state: { ...o.state } });
  }

  // ---------------------------------------------------------------- 편집 종류별

  private run(op: BuildOp): BuildResult {
    const fail = (reason: string): BuildResult => ({ ok: false, reason, cost: 0, warnings: [] });
    switch (op.op) {
      case 'wall':
        return this.walls(op.x0, op.y0, op.x1, op.y1, op.style, false, fail);
      case 'room': {
        const r = this.rect(op.x0, op.y0, op.x1, op.y1);
        if (!r || r.xb - r.xa < 2 || r.yb - r.ya < 2) return fail('room_small');
        let cost = 0;
        let cells = 0;
        for (const [a, b, c, d] of [[r.xa, r.ya, r.xb, r.ya], [r.xa, r.yb, r.xb, r.yb], [r.xa, r.ya, r.xa, r.yb], [r.xb, r.ya, r.xb, r.yb]]) {
          const w = this.walls(a, b, c, d, op.style, true, fail);
          if (!w.ok) return w;
          cost += w.cost;
          cells += w.cells ?? 0;
        }
        if (op.floor) {
          // 안쪽이 이미 같은 바닥이면 그대로 (먼저 바닥을 깔고 방을 두른 경우)
          const f = this.floors(r.xa + 1, r.ya + 1, r.xb - 1, r.yb - 1, op.floor, fail);
          if (!f.ok && f.reason !== 'same') return f;
          if (f.ok) cost += f.cost;
        }
        return { ok: true, cost, cells, warnings: [] };
      }
      case 'eraseWall':
        return this.eraseWalls(op, fail);
      case 'floor':
        return this.floors(op.x0, op.y0, op.x1, op.y1, op.style, fail);
      case 'fillFloor': {
        const g = this.host.world.grid;
        if (!this.inLot(op.x, op.y)) return fail('out_of_lot');
        const room = g.room[this.idx(op.x, op.y)];
        if (room < 0) return fail('not_room');
        const part = this.b.floors[op.style];
        if (!part) return fail('unknown');
        if (!this.estateOk(part.estate)) return fail('estate');
        if (part.cellarOnly && this.level(op.y) !== -1) return fail('cellar_only');
        let cost = 0;
        let cells = 0;
        for (let i = 0; i < g.room.length; i++) {
          if (g.room[i] !== room || this.lot.floor[i] === op.style) continue;
          this.lot.floor[i] = op.style;
          cost += part.price;
          cells++;
        }
        return { ok: true, cost, cells, warnings: [] };
      }
      case 'terrain': {
        const r = this.rect(op.x0, op.y0, op.x1, op.y1);
        if (!r || this.level(r.ya) !== 0) return fail('out_of_lot');
        const part = this.b.terrain[op.style];
        if (!part) return fail('unknown');
        let cost = 0;
        let cells = 0;
        for (let y = r.ya; y <= r.yb; y++) {
          for (let x = r.xa; x <= r.xb; x++) {
            const i = this.idx(x, y);
            if (this.lot.ground[i] === op.style) continue;
            this.lot.ground[i] = op.style;
            cost += part.price;
            cells++;
          }
        }
        return { ok: true, cost, cells, warnings: [] };
      }
      case 'opening':
        return this.opening(op, fail);
      case 'removeOpening': {
        const k = this.lot.openings.findIndex((o) => o.x === op.x && o.y === op.y);
        if (k < 0) return fail('no_opening');
        const o = this.lot.openings[k];
        const part = o.variant ? (o.kind === 'door' ? this.b.doors[o.variant] : this.b.windows[o.variant]) : null;
        this.lot.openings.splice(k, 1);
        return { ok: true, cost: -Math.round((part?.price ?? 24) * this.b.resellRatio), warnings: [] };
      }
      case 'lock': {
        const o = this.lot.openings.find((q) => q.x === op.x && q.y === op.y && q.kind === 'door');
        if (!o) return fail('no_opening');
        o.lock = op.lock;
        return { ok: true, cost: 0, warnings: [] };
      }
      case 'roof': {
        const part = this.b.roofs[op.style];
        if (!part) return fail('unknown');
        if (!this.estateOk(part.estate)) return fail('estate');
        const cur = this.lot.roof?.style ?? this.b.defaultRoof;
        if (cur === op.style) return fail('same');
        this.lot.roof = { style: op.style };
        return { ok: true, cost: part.price * this.roofCellCount(), warnings: [] };
      }
      case 'buy':
        return this.buy(op, fail);
      case 'move':
        return this.move(op, fail);
      case 'sell': {
        const w = this.host.world;
        const o = w.byUid.get(op.uid);
        if (!o || VIRTUAL.has(o.defId)) return fail('no_object');
        const price = this.host.data.objects[o.defId]?.price ?? 0;
        const cond = 1 - Math.min(100, Number(o.state.wear ?? 0)) / 200;
        this.host.abortUsing(o.uid);
        w.removeObject(o.uid);
        return { ok: true, cost: -Math.round(price * this.b.resellRatio * cond), warnings: [] };
      }
      case 'digCellar': {
        const r = this.rect(op.x0, op.y0, op.x1, op.y1);
        if (!r || this.level(r.ya) !== -1) return fail('out_of_lot');
        const part = this.b.floors.floor_cellar;
        let cost = 0;
        let cells = 0;
        const s0 = LEVELS.indexOf(0);
        for (let y = r.ya; y <= r.yb; y++) {
          for (let x = r.xa; x <= r.xb; x++) {
            const i = this.idx(x, y);
            if (this.lot.floor[i]) continue;
            // 지하는 집 밑에만 (1층이 바닥이나 벽인 칸)
            const up = this.idx(x, this.rowIn(y, s0));
            if (!this.lot.floor[up] && !this.lot.walls[up]) return fail('cellar_outside');
            this.lot.floor[i] = 'floor_cellar';
            cost += this.b.cellarDigPrice + (part?.price ?? 0);
            cells++;
          }
        }
        if (!cells) return fail('same');
        return { ok: true, cost, cells, warnings: [] };
      }
      case 'placeCrafted': {
        const w = this.host.world;
        const defId = this.b.craftedFurniture?.[op.item];
        if (!defId) return fail('unknown');
        if ((w.stock[op.item] ?? 0) < 1) return fail('no_stock');
        const rot = ((op.rot ?? 0) % 4 + 4) % 4;
        const why = this.canPlace(defId, op.x, op.y, rot);
        if (why) return fail(why);
        const o = w.addObject(defId, op.x, op.y, rot, undefined, this.forceUid ?? undefined);
        w.stock[op.item]--;
        const maker = w.makers[op.item]?.shift() ?? null;
        if (maker !== null) o.state.maker = maker;
        o.state.q = Math.round(w.quality[op.item] ?? 1);
        this.lastCrafted = { item: op.item, maker };
        return { ok: true, cost: 0, uid: o.uid, warnings: [] };
      }
      case 'nameRoom': {
        const g = this.host.world.grid;
        if (!this.inLot(op.x, op.y)) return fail('out_of_lot');
        const room = g.room[this.idx(op.x, op.y)];
        if (room < 0) return fail('not_room');
        const list = (this.lot.roomNames ??= []);
        const rep = g.roomCells[room];
        const rx = rep % this.lot.w;
        const ry = Math.floor(rep / this.lot.w);
        const k = list.findIndex((n) => g.room[this.idx(n.x, n.y)] === room);
        if (k >= 0) list.splice(k, 1);
        list.push({ x: rx, y: ry, name: op.name.slice(0, 24) });
        return { ok: true, cost: 0, warnings: [] };
      }
    }
  }

  private walls(x0: number, y0: number, x1: number, y1: number, style: string, inRoom: boolean, fail: (r: string) => BuildResult): BuildResult {
    const part = this.b.walls[style] ?? this.b.fences[style];
    if (!part) return fail('unknown');
    if (!this.estateOk(part.estate)) return fail('estate');
    if (x0 !== x1 && y0 !== y1) return fail('diagonal');
    const r = this.rect(x0, y0, x1, y1);
    if (!r) return fail('out_of_lot');
    const fence = this.isFence(style);
    if (fence && this.level(r.ya) !== 0) return fail('fence_ground_only');
    const exits = new Set((this.lot.exits ?? []).map((e) => this.idx(e.x, e.y)));
    const holes = this.holeCells();
    let cost = 0;
    let cells = 0;
    const todo: number[] = [];
    for (let y = r.ya; y <= r.yb; y++) {
      for (let x = r.xa; x <= r.xb; x++) {
        const i = this.idx(x, y);
        if (this.lot.walls[i] === style) continue;
        if (exits.has(i)) return fail('exit');
        if (holes.has(i) || this.host.world.grid.portal[i] >= 0) return fail('stairs');
        // 막지 않는 깔개도 벽 밑에 깔리지 않게 (리뷰 M5-16)
        if (this.objectCovering(i) || this.stairsAt(i)) return fail('occupied');
        if (!fence && !this.supported(x, y)) return fail('unsupported');
        todo.push(i);
      }
    }
    for (const i of todo) {
      this.lot.walls[i] = style;
      cost += part.price + (this.level(Math.floor(i / this.lot.w)) > 0 ? this.b.upperFloorPrice : 0);
      cells++;
    }
    void inRoom;
    return { ok: true, cost, cells, warnings: [] };
  }

  /** 칸을 덮는 물건 (막지 않는 깔개 포함, 가상 물건 제외) */
  private objectCovering(i: number): ObjectInstance | null {
    const w = this.host.world;
    const x = i % this.lot.w;
    const y = Math.floor(i / this.lot.w);
    for (const o of w.objects) {
      if (VIRTUAL.has(o.defId)) continue;
      const d = this.host.data.objects[o.defId];
      if (d?.wallMounted) continue;
      const fp = w.footprint(o);
      if (x >= o.x && x < o.x + fp.w && y >= o.y && y < o.y + fp.h) return o;
    }
    return null;
  }

  private personAt(x: number, y: number): boolean {
    return this.host.persons.some((p) => !p.hidden && p.cellX() === x && p.cellY() === y);
  }

  private stairsAt(i: number): boolean {
    const w = this.host.world;
    const x = i % this.lot.w;
    const y = Math.floor(i / this.lot.w);
    for (const o of w.objects) {
      const d = this.host.data.objects[o.defId];
      if (!d?.tags.includes(HOLE_TAG) && !d?.tags.includes('cellar_hatch')) continue;
      const fp = w.footprint(o);
      if (x >= o.x && x < o.x + fp.w && y >= o.y && y < o.y + fp.h) return true;
    }
    return false;
  }

  private eraseWalls(op: { x0: number; y0: number; x1: number; y1: number }, fail: (r: string) => BuildResult): BuildResult {
    const r = this.rect(op.x0, op.y0, op.x1, op.y1);
    if (!r) return fail('out_of_lot');
    const w = this.host.world;
    let refund = 0;
    let cells = 0;
    const up = LEVELS.indexOf(this.level(r.ya) + 1);
    for (let y = r.ya; y <= r.yb; y++) {
      for (let x = r.xa; x <= r.xb; x++) {
        const i = this.idx(x, y);
        const style = this.lot.walls[i];
        if (!style) continue;
        // 위층 벽/바닥을 받치는 벽은 못 헐음 (그 칸 위층이 벽이고 아래층 바닥도 없으면)
        if (up >= 0) {
          const ui = this.idx(x, this.rowIn(y, up));
          if ((this.lot.walls[ui] && !this.isFence(this.lot.walls[ui])) || this.lot.floor[ui]) {
            if (!this.lot.floor[i]) return fail('supports_upper');
          }
        }
        const part = this.b.walls[style] ?? this.b.fences[style];
        refund += Math.round((part?.price ?? 0) * 0.5);
        this.lot.walls[i] = null;
        cells++;
        const k = this.lot.openings.findIndex((o) => o.x === x && o.y === y);
        if (k >= 0) this.lot.openings.splice(k, 1);
        // 벽에 걸린 물건은 떼어 팜
        for (const o of [...w.objects]) {
          const d = this.host.data.objects[o.defId];
          if (!d?.wallMounted || o.defId === WINDOW_OBJECT_ID) continue;
          const fp = w.footprint(o);
          if (x >= o.x && x < o.x + fp.w && y >= o.y && y < o.y + fp.h) {
            refund += Math.round((d.price ?? 0) * this.b.resellRatio);
            this.host.abortUsing(o.uid);
            w.removeObject(o.uid);
          }
        }
      }
    }
    if (!cells) return fail('no_wall');
    return { ok: true, cost: -refund, cells, warnings: [] };
  }

  private floors(x0: number, y0: number, x1: number, y1: number, style: string | null, fail: (r: string) => BuildResult): BuildResult {
    const r = this.rect(x0, y0, x1, y1);
    if (!r) return fail('out_of_lot');
    const lv = this.level(r.ya);
    const part = style ? this.b.floors[style] : null;
    if (style && !part) return fail('unknown');
    if (part && !this.estateOk(part.estate)) return fail('estate');
    if (part?.cellarOnly && lv !== -1) return fail('cellar_only');
    if (lv === -1 && style && style !== 'floor_cellar' && !this.anyFloor(r, 'floor_cellar')) {
      // 지하 바닥 칠하기: 이미 판 곳만
    }
    const holes = this.holeCells();
    let cost = 0;
    let cells = 0;
    let unsupported = 0;
    for (let y = r.ya; y <= r.yb; y++) {
      for (let x = r.xa; x <= r.xb; x++) {
        const i = this.idx(x, y);
        if (this.lot.floor[i] === style) continue;
        if (!style) {
          if (lv !== 0 && (this.objectCovering(i) || this.stairsAt(i) || this.personAt(x, y))) return fail('occupied');
          // 위층 벽/바닥을 받치는 바닥은 못 걷음 (리뷰 M5-13)
          const up = LEVELS.indexOf(lv + 1);
          if (up >= 0 && !this.lot.walls[i]) {
            const ui = this.idx(x, this.rowIn(y, up));
            if ((this.lot.walls[ui] && !this.isFence(this.lot.walls[ui])) || this.lot.floor[ui]) return fail('supports_upper');
          }
          this.lot.floor[i] = null;
          cells++;
          continue;
        }
        if (holes.has(i)) continue;
        if (lv > 0 && !this.supported(x, y)) {
          unsupported++;
          continue;
        }
        if (lv === -1 && !this.lot.floor[i]) continue;
        if (this.lot.walls[i] && !this.isFence(this.lot.walls[i]) && lv > 0) {
          // 위층 벽 칸에도 바닥 (벽 밑 받침)
        }
        const fresh = !this.lot.floor[i];
        this.lot.floor[i] = style;
        cost += part!.price + (lv > 0 && fresh ? this.b.upperFloorPrice : 0);
        cells++;
      }
    }
    if (!cells) return fail(unsupported ? 'unsupported' : 'same');
    return { ok: true, cost, cells, warnings: [] };
  }

  private anyFloor(r: { xa: number; ya: number; xb: number; yb: number }, style: string): boolean {
    for (let y = r.ya; y <= r.yb; y++) for (let x = r.xa; x <= r.xb; x++) if (this.lot.floor[this.idx(x, y)] === style) return true;
    return false;
  }

  private opening(op: { x: number; y: number; kind: 'door' | 'window'; variant?: string }, fail: (r: string) => BuildResult): BuildResult {
    if (!this.inLot(op.x, op.y)) return fail('out_of_lot');
    const i = this.idx(op.x, op.y);
    const style = this.lot.walls[i];
    if (!style) return fail('no_wall');
    const fence = this.isFence(style);
    const part = op.variant ? (op.kind === 'door' ? this.b.doors[op.variant] : this.b.windows[op.variant]) : null;
    if (op.variant && !part) return fail('unknown');
    if (part && !this.estateOk(part.estate)) return fail('estate');
    if (fence && op.kind === 'window') return fail('fence_window');
    if (fence && op.kind === 'door' && op.variant && !part?.fenceOnly) return fail('fence_door');
    if (!fence && part?.fenceOnly) return fail('gate_fence_only');
    if (this.lot.openings.some((o) => o.x === op.x && o.y === op.y)) return fail('has_opening');
    // 곧은 벽 가운데만 (모서리/끝 X): 동서 또는 남북 양쪽이 벽
    const wall = (x: number, y: number) => this.inLot(x, y) && !!this.lot.walls[this.idx(x, y)];
    const ew = wall(op.x - 1, op.y) && wall(op.x + 1, op.y);
    const ns = wall(op.x, op.y - 1) && wall(op.x, op.y + 1);
    if (!ew && !ns) return fail('corner');
    // 이웃한 개구부와 붙이지 않음 (문짝 그림이 겹침)
    if (this.lot.openings.some((o) => Math.abs(o.x - op.x) + Math.abs(o.y - op.y) === 1)) return fail('adjacent_opening');
    const o: LotDef['openings'][number] = { x: op.x, y: op.y, kind: op.kind };
    if (op.variant) o.variant = op.variant;
    this.lot.openings.push(o);
    return { ok: true, cost: part?.price ?? (op.kind === 'door' ? 48 : 24), warnings: [] };
  }

  /** 물건을 놓을 수 있는가 (buy/move 공통). 이유 또는 null */
  canPlace(defId: string, x: number, y: number, rot: number, except = -1): string | null {
    const data = this.host.data;
    const d: ObjectDef | undefined = data.objects[defId];
    if (!d || VIRTUAL.has(defId)) return 'unknown';
    if (d.rotations && !d.rotations.includes(rot) && !(d.rotations.length === 1 && rot === 0) && !(d.flip && rot === 2)) return 'rotation';
    const fp = rot % 2 ? { w: d.footprint.h, h: d.footprint.w } : d.footprint;
    const w = this.host.world;
    const holes = this.holeCells();
    const isStairs = d.tags.includes(HOLE_TAG);
    const lv = this.inLot(x, y) ? this.level(y) : 0;
    for (let dy = 0; dy < fp.h; dy++) {
      for (let dx = 0; dx < fp.w; dx++) {
        const cx = x + dx;
        const cy = y + dy;
        if (!this.inLot(cx, cy) || this.slab(cy) !== this.slab(y)) return 'out_of_lot';
        const i = this.idx(cx, cy);
        const wallHere = !!this.lot.walls[i];
        if (d.wallMounted) {
          if (!wallHere || this.isFence(this.lot.walls[i])) return 'needs_wall';
          if (this.lot.openings.some((o) => o.x === cx && o.y === cy)) return 'has_opening';
          continue;
        }
        if (wallHere) return 'wall';
        if (lv !== 0 && !this.lot.floor[i]) return 'no_floor';
        if (holes.has(i)) return 'stairs';
        if (d.blocks && w.grid.portal[i] >= 0 && !this.sameObjectCell(i, except)) return 'stairs';
        if ((this.lot.exits ?? []).some((e) => e.x === cx && e.y === cy)) return 'exit';
        if (d.blocks && this.blockingAt(i, except)) {
          if (!d.surface) return 'occupied';
        } else if (d.surface) {
          const under = this.blockingAt(i, except);
          if (!under || !data.objects[under.defId]?.tags.includes('surface')) return 'needs_surface';
        }
        if ((d.blocks || isStairs) && this.stairsAt(i) && !this.sameObjectCell(i, except)) return 'stairs';
      }
    }
    if (d.tags.includes('needs_wall_north')) {
      for (let dx = 0; dx < fp.w; dx++) {
        const ny = y - 1;
        const ws = this.inLot(x + dx, ny) ? this.lot.walls[this.idx(x + dx, ny)] : null;
        if (!ws || this.isFence(ws)) return 'needs_wall_north';
      }
    }
    if (isStairs) {
      if (rot !== 0) return 'rotation';
      const up = LEVELS.indexOf(lv + 1);
      if (up < 0) return 'top_level';
      for (let dy = 0; dy < fp.h; dy++) {
        const ui = this.idx(x, this.rowIn(y + dy, up));
        if (this.lot.walls[ui] || w.grid.objAt[ui]) return 'stairs_blocked';
      }
    }
    if (d.tags.includes('cellar_hatch') && lv !== 0) return 'ground_only';
    return null;
  }

  private sameObjectCell(i: number, uid: number): boolean {
    if (uid < 0) return false;
    const o = this.host.world.byUid.get(uid);
    if (!o) return false;
    return this.cellsOf(o, this.host.world.footprint(o)).includes(i);
  }

  private buy(op: { defId: string; x: number; y: number; rot?: number; variant?: string }, fail: (r: string) => BuildResult): BuildResult {
    const d = this.host.data.objects[op.defId];
    if (!d) return fail('unknown');
    if (!this.estateOk(d.estate)) return fail('estate');
    const rot = ((op.rot ?? 0) % 4 + 4) % 4;
    const why = this.canPlace(op.defId, op.x, op.y, rot);
    if (why) return fail(why);
    if (op.variant && !(d.variants ?? []).includes(op.variant)) return fail('variant');
    const w = this.host.world;
    const o = w.addObject(op.defId, op.x, op.y, rot, op.variant, this.forceUid ?? undefined);
    if (d.tags.includes(HOLE_TAG)) this.cutHole(o);
    return { ok: true, cost: d.price ?? 0, uid: o.uid, warnings: [] };
  }

  /** 계단 위층 구멍: 바닥을 걷어냄 */
  private cutHole(o: ObjectInstance): void {
    const up = LEVELS.indexOf(this.level(o.y) + 1);
    if (up < 0) return;
    const fp = this.host.world.footprint(o);
    for (let dy = 0; dy < fp.h; dy++) this.lot.floor[this.idx(o.x, this.rowIn(o.y + dy, up))] = null;
  }

  private move(op: { uid: number; x: number; y: number; rot?: number }, fail: (r: string) => BuildResult): BuildResult {
    const w = this.host.world;
    const o = w.byUid.get(op.uid);
    if (!o || VIRTUAL.has(o.defId)) return fail('no_object');
    const rot = ((op.rot ?? o.rot ?? 0) % 4 + 4) % 4;
    if (o.x === op.x && o.y === op.y && rot === (o.rot ?? 0)) return fail('same');
    const why = this.canPlace(o.defId, op.x, op.y, rot, o.uid);
    if (why) return fail(why);
    this.host.abortUsing(o.uid);
    w.grid.clearObject(o, w.footprint(o));
    o.x = op.x;
    o.y = op.y;
    if (rot) o.rot = rot;
    else delete o.rot;
    if (this.host.data.objects[o.defId]?.tags.includes(HOLE_TAG)) this.cutHole(o);
    return { ok: true, cost: 0, warnings: [] };
  }

  // ---------------------------------------------------------------- 공사 (23-3)

  private siteCell(op: BuildOp): { x: number; y: number } {
    const o = op as { x?: number; y?: number; x0?: number; y0?: number; x1?: number; y1?: number };
    if (o.x !== undefined && o.y !== undefined) return { x: o.x, y: o.y };
    if (o.x0 !== undefined && o.y0 !== undefined) return { x: Math.round(((o.x0 ?? 0) + (o.x1 ?? o.x0)) / 2), y: Math.round(((o.y0 ?? 0) + (o.y1 ?? o.y0)) / 2) };
    // 지붕: 부지 가운데
    return { x: Math.floor(this.lot.w / 2), y: Math.floor(this.lot.h / 2) };
  }

  /** 일한 만큼 공사를 진척. 가족이 일하면 품삯(laborShare)을 돌려받음. 다 되면 실제로 지음 */
  addWork(siteUid: number | null, amount: number, family: boolean): PendingWork | null {
    const p = siteUid === null ? this.pending[0] : this.pending.find((q) => q.siteUid === siteUid);
    if (!p) return null;
    const add = Math.min(amount, p.work - p.done);
    p.done += add;
    if (family) {
      p.familyDone += add;
      const refund = Math.round((p.cost * this.b.construction.laborShare * add) / p.work);
      if (refund > 0) this.pay(-refund);
    }
    if (p.done >= p.work - 1e-6) this.finish(p);
    return p;
  }

  private finish(p: PendingWork): void {
    const k = this.pending.indexOf(p);
    if (k >= 0) this.pending.splice(k, 1);
    this.host.abortUsing(p.siteUid);
    this.host.world.removeObject(p.siteUid);
    // 그새 자리가 막혔으면 못 짓고 돌려줌 (가족 품삯으로 이미 받은 몫은 빼고)
    const before: Snapshot = { lot: cloneLot(this.lot), objects: this.cloneObjects(), cost: 0 };
    const r = this.run(p.op);
    if (!r.ok) {
      this.restore(before);
      const paidBack = Math.round((p.cost * this.b.construction.laborShare * p.familyDone) / p.work);
      this.pay(-(p.cost - paidBack));
      this.host.onConstruction?.(p, false);
      this.afterChange();
      return;
    }
    // 다 지은 공사는 되돌리지 않음: 그 전 스냅샷들이 완공 결과를 모르므로 기록을 비움 (리뷰 M5-5)
    this.clearHistory();
    this.host.onConstruction?.(p, true);
    this.afterChange();
  }

  /** NPC 목수/석공: 일하는 시간에 첫 공사를 조금씩 (분마다) */
  tickConstruction(minuteOfDay: number): void {
    if (!this.pending.length) return;
    const c = this.b.construction;
    const h = minuteOfDay / 60;
    if (h < c.npcHours[0] || h >= c.npcHours[1]) return;
    this.addWork(null, c.npcWorkPerHour / 60, false);
  }

  // ---------------------------------------------------------------- 지붕, 경고

  /** 지붕 덮이는 칸 수 (맨 위 층 기준) */
  roofCellCount(): number {
    const top = this.host.world.grid.roofMap();
    let n = 0;
    for (const v of top) if (v >= 0) n++;
    return n;
  }

  /**
   * 길 막힘 경고: 출구(없으면 첫 사람 자리)에서 계단까지 타고 닿는 칸을 칠한 뒤
   * 닿지 않는 문, 물건 자리(슬롯 전부), 사람을 알려 줌. 계단/들창 연결 없는 것도
   */
  checkPaths(): BuildWarning[] {
    const w = this.host.world;
    const g = w.grid;
    const n = g.w * g.h;
    const seen = new Uint8Array(n);
    const q = new Int32Array(n);
    let head = 0;
    let tail = 0;
    const starts = (this.lot.exits ?? []).map((e) => g.idx(e.x, e.y));
    if (!starts.length) {
      const p = this.host.persons.find((x) => !x.hidden);
      if (p) starts.push(g.idx(p.cellX(), p.cellY()));
    }
    for (const s of starts) {
      if (!seen[s]) {
        seen[s] = 1;
        q[tail++] = s;
      }
    }
    while (head < tail) {
      const c = q[head++];
      const cx = c % g.w;
      const cy = (c - cx) / g.w;
      for (let d = 0; d < 5; d++) {
        let ni: number;
        if (d === 4) {
          ni = g.portal[c];
          if (ni < 0) continue;
        } else {
          const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
          const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (!g.inBounds(nx, ny)) continue;
          ni = ny * g.w + nx;
        }
        if (seen[ni] || !g.walkable(ni)) continue;
        seen[ni] = 1;
        q[tail++] = ni;
      }
    }
    const out: BuildWarning[] = [];
    for (const o of this.lot.openings) {
      if (o.kind !== 'door') continue;
      if (!seen[g.idx(o.x, o.y)]) out.push({ kind: 'door', x: o.x, y: o.y });
    }
    for (const o of w.objects) {
      if (o.defId === WINDOW_OBJECT_ID || o.defId === EXIT_OBJECT_ID) continue;
      const slots = w.slots(o);
      if (!slots.length) continue;
      let ok = false;
      for (const s of slots) {
        const c = w.slotCell(o, s);
        if (c < 0 || c >= n || (g.wall[c] && !g.door[c])) continue;
        if (seen[c]) {
          ok = true;
          break;
        }
        if (s.pose === 'stand') continue;
        // 앉기/눕기 자리는 가구 안: 이웃한 칸이 닿으면 됨
        const sx = c % g.w;
        const sy = (c - sx) / g.w;
        for (let d = 0; d < 4 && !ok; d++) {
          const nx = sx + (d === 0 ? 1 : d === 1 ? -1 : 0);
          const ny = sy + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (g.inBounds(nx, ny) && seen[g.idx(nx, ny)]) ok = true;
        }
        if (ok) break;
      }
      if (!ok) out.push({ kind: 'object', x: o.x, y: o.y, uid: o.uid });
      const tags = this.host.data.objects[o.defId]?.tags ?? [];
      if (tags.includes(HOLE_TAG) && g.portal[g.idx(o.x, o.y)] < 0) out.push({ kind: 'stairs_no_landing', x: o.x, y: o.y, uid: o.uid });
      if (tags.includes('cellar_hatch') && g.portal[g.idx(o.x, o.y)] < 0) out.push({ kind: 'hatch_no_cellar', x: o.x, y: o.y, uid: o.uid });
    }
    // 방 전체에 못 들어감 (문 안쪽을 가구가 막음 등): 걸을 수 있는 칸이 있는데 하나도 닿지 않는 방
    const roomSeen = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const r = g.room[i];
      if (r < 0 || !g.walkable(i)) continue;
      if (seen[i]) roomSeen.set(r, -1);
      else if (!roomSeen.has(r)) roomSeen.set(r, i);
    }
    for (const c of roomSeen.values()) if (c >= 0) out.push({ kind: 'room_unreachable', x: c % g.w, y: Math.floor(c / g.w) });
    for (const p of this.host.persons) {
      if (p.hidden) continue;
      const c = g.idx(p.cellX(), p.cellY());
      if (c >= 0 && c < n && !seen[c]) out.push({ kind: 'person', x: p.cellX(), y: p.cellY(), personId: p.id });
    }
    return out;
  }
}
