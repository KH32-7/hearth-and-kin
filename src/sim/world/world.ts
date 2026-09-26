/**
 * 월드 상태: 물건, 가정 재고, 격자, 슬롯 예약, 방 기온, 시계.
 * 사람(Person)은 Simulation이 따로 가짐.
 */
import type { LotDef, ObjectDef, ObjectInstance, Season, SlotDef } from '../core/types';
import { EXIT_OBJECT_ID, FIRE_OBJECT_ID, SITE_OBJECT_ID, WINDOW_OBJECT_ID, type SimData } from '../data/simData';
import { Grid } from './grid';
import { LEVELS, cloneLot, slabStride } from './lot';
import { outsideTemp, roomTargetTemp } from './temperature';

export class World {
  readonly grid: Grid;
  /**
   * 단계 물건 고르기 거르개 (마을): 그 사람이 들어갈 수 없는 남의 집 물건은 고르지 않음.
   * 주점 식탁에서 먹으려다 가장 가까운 화덕이 남의 집 안이라 길을 못 찾던 것 (resolveStep 의 같은 종류 물건 찾기)
   */
  stepAllow: ((personId: number, o: ObjectInstance) => boolean) | null = null;
  readonly objects: ObjectInstance[] = [];
  readonly byUid = new Map<number, ObjectInstance>();
  /** 저장고 (조작 가문). 마을 모드에서 NPC 가 행동하는 동안은 sim 이 NPC 공용 창고로 잠시 바꿔 끼움 */
  stock: Record<string, number>;
  /** uid → (slotId → personId). 조회할 때 문자열을 새로 만들지 않도록 두 단계 Map */
  readonly reservations = new Map<number, Map<string, number>>();
  roomTemps: number[] = [];
  /** 방별 더러움 0~100 (사람이 머물면 늘고 청소로 줄어듦) */
  roomDirt: number[] = [];
  outsideC = 10;
  minute: number;
  season: Season = 'spring';
  /** 품목 평균 품질 0~4 (제작 결과, 17-1) */
  readonly quality: Record<string, number> = {};
  /** 조작 가정의 돈 (경제가 있으면 Simulation 이 연결). 상호작용 조건 money 확인용 */
  money: ((forBuy?: boolean) => number) | null = null;
  /** 저장고 묶음 (품목 → [수량, 들어온 날]). 부패 판정용. world.stock 이 기준이고 하루 한 번 맞춤 */
  readonly batches = new Map<string, { qty: number; day: number }[]>();
  private nextUid = 1;
  /** 지금 부지 (건축으로 바뀜). data.lot 은 처음 모습 */
  readonly lot: LotDef;
  /** 부지 모양이 바뀔 때마다 +1 (렌더러가 벽/바닥을 다시 그림) */
  lotVersion = 1;
  /**
   * 공간 색인 (M6 마을): 판 안 좌표 16×16 칸 버킷 (층은 같은 자리로 합침). 물건이 늘고 줄고 옮겨질 때 판을 올리고
   * 다음 조회 때 한 번에 다시 만듦. 자율/자리 찾기가 지도 전체 물건 대신 주변만 봄
   */
  private bucketVersion = -1;
  objectsVersion = 0;
  private buckets = new Map<number, ObjectInstance[]>();
  /** 항상 후보인 물건 (부지 출구: 장보기/출근 래빗홀) */
  readonly always: ObjectInstance[] = [];

  private bucketKey(x: number, y: number): number {
    const ly = y % (this.grid.slabH + 1);
    return (Math.floor(x / 16) << 12) | Math.floor(ly / 16);
  }

  private reindex(): void {
    this.buckets.clear();
    this.always.length = 0;
    for (const o of this.objects) {
      if (o.defId === EXIT_OBJECT_ID) {
        this.always.push(o);
        continue;
      }
      const k = this.bucketKey(o.x, o.y);
      let b = this.buckets.get(k);
      if (!b) {
        b = [];
        this.buckets.set(k, b);
      }
      b.push(o);
    }
    this.bucketVersion = this.objectsVersion;
  }

  /** (x, 전체 행 y) 반경 r 칸 안 버킷의 물건 (모든 층) + 항상 후보. out 을 비우고 채움 */
  objectsNear(x: number, y: number, r: number, out: ObjectInstance[]): ObjectInstance[] {
    if (this.bucketVersion !== this.objectsVersion) this.reindex();
    out.length = 0;
    // 작은 부지는 전부 (옛 동작과 같음)
    if (this.objects.length < 400) {
      for (const o of this.objects) out.push(o);
      return out;
    }
    const ly = y % (this.grid.slabH + 1);
    const bx0 = Math.floor((x - r) / 16);
    const bx1 = Math.floor((x + r) / 16);
    const by0 = Math.floor(Math.max(0, ly - r) / 16);
    const by1 = Math.floor(Math.min(this.grid.slabH - 1, ly + r) / 16);
    for (let bx = Math.max(0, bx0); bx <= bx1; bx++) {
      for (let by = by0; by <= by1; by++) {
        const b = this.buckets.get((bx << 12) | by);
        if (b) for (const o of b) out.push(o);
      }
    }
    for (const o of this.always) out.push(o);
    return out;
  }

  /** 직접 만든 가구: 저장고 품목 → 만든 사람 id (만든 순서, 놓을 때 앞에서 꺼냄) */
  readonly makers: Record<string, number[]> = {};

  constructor(readonly data: SimData) {
    const lot = cloneLot(data.lot);
    this.lot = lot;
    this.grid = new Grid(lot, data.fenceIds, data.blockedTerrain);
    this.stock = { ...data.balance.startStock };
    this.minute = data.balance.time.startMinuteOfDay;
    for (const o of lot.objects) this.addObject(o.id, o.x, o.y, o.rot ?? 0, o.variant);
    this.addWindows();
    this.addExits();
    this.linkPortals();
    this.grid.detectRooms();
    this.outsideC = outsideTemp(data.balance, this.season, this.minuteOfDay());
    this.roomTemps = this.grid.roomSizes.map(() => this.outsideC + 4);
    this.roomDirt = this.grid.roomSizes.map(() => 20);
    this.updateRoomTemps(true);
  }

  addObject(defId: string, x: number, y: number, rot = 0, variant?: string, uid?: number): ObjectInstance {
    if (uid !== undefined && this.byUid.has(uid)) uid = undefined;
    const obj: ObjectInstance = { uid: uid ?? this.nextUid++, defId, x, y, state: {} };
    if (obj.uid >= this.nextUid) this.nextUid = obj.uid + 1;
    if (rot % 4) obj.rot = ((rot % 4) + 4) % 4;
    if (variant) obj.variant = variant;
    const kind = this.kindOf(defId);
    if (kind === 'hearth' || kind === 'candlestick') obj.state.lit = false;
    if (kind === 'hearth') {
      obj.state.fuelMin = 0;
      obj.state.servings = 0;
    }
    if (kind === 'chamber_pot') obj.state.dirty = 0;
    this.objects.push(obj);
    this.byUid.set(obj.uid, obj);
    this.grid.placeObject(obj, this.def(defId), this.footprint(obj));
    this.objectsVersion++;
    return obj;
  }

  /** 불 한 칸 (23-5). 가상 물건이지만 칸을 막음 */
  addFire(x: number, y: number): ObjectInstance {
    const obj: ObjectInstance = { uid: this.nextUid++, defId: FIRE_OBJECT_ID, x, y, state: { lit: true } };
    this.objectsVersion++;
    this.objects.push(obj);
    this.byUid.set(obj.uid, obj);
    this.grid.placeObject(obj, this.def(FIRE_OBJECT_ID));
    return obj;
  }

  /** 공사 자리 (23-3): 막지 않는 가상 물건 (가족이 '짓기' 하러 가는 대상) */
  addSite(x: number, y: number): ObjectInstance {
    const obj: ObjectInstance = { uid: this.nextUid++, defId: SITE_OBJECT_ID, x, y, state: {} };
    this.objectsVersion++;
    this.objects.push(obj);
    this.byUid.set(obj.uid, obj);
    return obj;
  }

  /** 실행 취소: 같은 uid 로 되살림 */
  restoreObject(obj: ObjectInstance): void {
    this.objects.push(obj);
    this.byUid.set(obj.uid, obj);
    if (obj.uid >= this.nextUid) this.nextUid = obj.uid + 1;
    this.grid.placeObject(obj, this.def(obj.defId), this.footprint(obj));
    this.objectsVersion++;
  }

  /** 지하 저장고가 있는가 (들창으로 이어진 지하 방): 음식 부패 절반 (17-5) */
  hasCellar(): boolean {
    const g = this.grid;
    for (let r = 0; r < g.roomLevels.length; r++) {
      if (g.roomLevels[r] >= 0 || g.roomSizes[r] < 2) continue;
      for (let i = 0; i < g.room.length; i++) if (g.room[i] === r && g.portal[i] >= 0) return true;
    }
    return false;
  }

  /** 기능 기반 id (카탈로그 물건은 as 로 기반을 가리킴: 화로 변형도 화로) */
  private reachMap: Uint8Array | null = null;
  private reachKey = '';
  /** 부지 출구에서 걸어서 닿는 칸 (가구 사이 틈에 갇힌 칸 제외). 부지/물건이 바뀌면 다시 셈 */
  reachFromExits(): Uint8Array {
    const w = this;
    const key = `${w.lotVersion}:${w.objectsVersion}`;
    if (this.reachMap && this.reachKey === key) return this.reachMap;
    const g = w.grid;
    const n = g.w * g.h;
    const seen = new Uint8Array(n);
    const q = new Int32Array(n);
    let head = 0;
    let tail = 0;
    for (const e of w.lot.exits ?? []) {
      const s = g.idx(e.x, e.y);
      if (s >= 0 && s < n && !seen[s]) {
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
    // 출구가 없는 지도(시험용): 모두 닿는 것으로
    if (!tail) seen.fill(1);
    this.reachMap = seen;
    this.reachKey = key;
    return seen;
  }

  kindOf(defId: string): string {
    return this.data.objects[defId]?.kind ?? defId;
  }

  /** 물건 치우기 (건축/구매 모드 팔기, 화재). 예약도 풂 */
  removeObject(uid: number): ObjectInstance | null {
    const obj = this.byUid.get(uid);
    if (!obj) return null;
    if (obj.defId !== WINDOW_OBJECT_ID && obj.defId !== EXIT_OBJECT_ID) this.grid.clearObject(obj, this.footprint(obj));
    this.byUid.delete(uid);
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
    this.reservations.delete(uid);
    this.objectsVersion++;
    return obj;
  }

  /** 계단 맨 위 칸 ↔ 위층 (x, y-1), 들창 ↔ 지하 같은 칸 (world/lot.ts) */
  linkPortals(): void {
    const g = this.grid;
    const stride = slabStride(g.slabH);
    for (const o of this.objects) {
      const tags = this.data.objects[o.defId]?.tags;
      if (!tags) continue;
      const slab = g.slabOf(g.idx(o.x, o.y));
      const level = LEVELS[slab];
      if (tags.includes('stairs')) {
        const up = LEVELS.indexOf(level + 1);
        if (up < 0) continue;
        const fp = this.footprint(o);
        for (let dy = 0; dy < fp.h; dy++) {
          const hy = o.y + dy + (up - slab) * stride;
          if (g.inBounds(o.x, hy)) g.hole[g.idx(o.x, hy)] = 1;
        }
        const ty = o.y - 1 + (up - slab) * stride;
        if (ty < 0 || !g.inBounds(o.x, ty)) continue;
        const b = g.idx(o.x, ty);
        if (g.solid[b]) g.link(g.idx(o.x, o.y), b);
      } else if (tags.includes('cellar_hatch')) {
        const down = LEVELS.indexOf(level - 1);
        if (down < 0) continue;
        const ty = o.y + (down - slab) * stride;
        const b = g.idx(o.x, ty);
        if (g.inBounds(o.x, ty) && g.solid[b]) g.link(g.idx(o.x, o.y), b);
      }
    }
  }

  /** 건축 뒤: 격자/물건 점유/창문 가상 물건/연결/방을 다시 만들고, 방 기온과 더러움은 대표 칸으로 이어받음.
   *  창문 가상 물건은 같은 칸이면 uid 를 유지. 없어진 가상 물건 uid 목록을 돌려줌 (쓰던 사람 행동 중단용) */
  rebuild(): number[] {
    const g = this.grid;
    const oldTemps = new Map<number, number>();
    const oldDirt = new Map<number, number>();
    for (let i = 0; i < g.room.length; i++) {
      const r = g.room[i];
      if (r >= 0) {
        oldTemps.set(i, this.roomTemps[r]);
        oldDirt.set(i, this.roomDirt[r]);
      }
    }
    g.load(this.lot);
    const oldWindows = new Map<string, number>();
    for (const o of [...this.objects]) {
      if (o.defId === WINDOW_OBJECT_ID) {
        oldWindows.set(`${o.x},${o.y}`, o.uid);
        this.byUid.delete(o.uid);
        this.objects.splice(this.objects.indexOf(o), 1);
        continue;
      }
      if (o.defId !== EXIT_OBJECT_ID) g.placeObject(o, this.def(o.defId), this.footprint(o));
    }
    this.addWindows(oldWindows);
    const gone = [...oldWindows.values()].filter((uid) => !this.byUid.has(uid));
    this.linkPortals();
    g.detectRooms();
    this.roomTemps = g.roomSizes.map(() => this.outsideC + 4);
    this.roomDirt = g.roomSizes.map(() => 20);
    const seenT = new Set<number>();
    for (let i = 0; i < g.room.length; i++) {
      const r = g.room[i];
      if (r < 0 || seenT.has(r)) continue;
      const t = oldTemps.get(i);
      if (t !== undefined) {
        this.roomTemps[r] = t;
        this.roomDirt[r] = oldDirt.get(i) ?? 20;
        seenT.add(r);
      }
    }
    this.lotVersion++;
    this.objectsVersion++;
    return gone;
  }

  /** 창문 개구부마다 가상 물건 생성. 슬롯 = 창문 벽 칸에 붙은 실내 바닥 칸 */
  private addWindows(keep?: Map<string, number>): void {
    const g = this.grid;
    for (const op of this.lot.openings) {
      if (op.kind !== 'window') continue;
      const cands: Array<[number, number, SlotDef['facing']]> = [
        [0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right'],
      ];
      for (const [dx, dy, facing] of cands) {
        const x = op.x + dx;
        const y = op.y + dy;
        if (!g.inBounds(x, y)) continue;
        const i = g.idx(x, y);
        if (g.floor[i] && !g.wall[i]) {
          const old = keep?.get(`${op.x},${op.y}`);
          const obj: ObjectInstance = {
            uid: old ?? this.nextUid++, defId: WINDOW_OBJECT_ID, x: op.x, y: op.y, state: {},
            slotsOverride: [{ id: 'inside', dx, dy, facing, pose: 'stand' }],
          };
          this.objects.push(obj);
          this.byUid.set(obj.uid, obj);
          break;
        }
      }
    }
  }

  /** 부지 출구 칸 (방문객이 들어오고 나가는 길 끝) */
  get exits(): { x: number; y: number }[] {
    return this.lot.exits ?? [];
  }

  /** 부지 출구 가상 물건 (lot.exits) */
  private addExits(): void {
    for (const ex of this.lot.exits ?? []) {
      const obj: ObjectInstance = { uid: this.nextUid++, defId: EXIT_OBJECT_ID, x: ex.x, y: ex.y, state: {} };
      this.objects.push(obj);
      this.byUid.set(obj.uid, obj);
    }
  }

  def(defId: string): ObjectDef {
    const d = this.data.objects[defId];
    if (!d) throw new Error(`물건 정의 없음: ${defId}`);
    return d;
  }

  slots(obj: ObjectInstance): SlotDef[] {
    if (obj.slotsOverride) return obj.slotsOverride;
    const base = this.def(obj.defId).slots;
    if (!obj.rot) return base;
    const key = `${obj.defId}:${obj.rot}`;
    let s = this.rotatedSlots.get(key);
    if (!s) {
      s = rotateSlots(base, this.def(obj.defId).footprint, obj.rot);
      this.rotatedSlots.set(key, s);
    }
    return s;
  }

  private rotatedSlots = new Map<string, SlotDef[]>();

  /** 회전을 반영한 발자국 */
  footprint(obj: ObjectInstance): { w: number; h: number } {
    const f = this.def(obj.defId).footprint;
    return obj.rot && obj.rot % 2 ? { w: f.h, h: f.w } : f;
  }

  slotCell(obj: ObjectInstance, slot: SlotDef): number {
    return this.grid.idx(obj.x + slot.dx, obj.y + slot.dy);
  }

  minuteOfDay(): number {
    return this.minute % this.data.balance.time.dayMinutes;
  }

  day(): number {
    return Math.floor(this.minute / this.data.balance.time.dayMinutes);
  }

  hour(): number {
    return Math.floor(this.minuteOfDay() / 60);
  }

  /** 물건 중심 칸 (핫패스에서는 centerX/centerY 사용: 새 객체를 만들지 않음) */
  center(obj: ObjectInstance): { x: number; y: number } {
    return { x: this.centerX(obj), y: this.centerY(obj) };
  }

  centerX(obj: ObjectInstance): number {
    const f = this.def(obj.defId).footprint;
    return obj.x + (obj.rot && obj.rot % 2 ? f.h : f.w) / 2;
  }

  centerY(obj: ObjectInstance): number {
    const f = this.def(obj.defId).footprint;
    return obj.y + (obj.rot && obj.rot % 2 ? f.w : f.h) / 2;
  }

  /** 참이면 예약을 없는 것으로 봄 (자리가 "쓰는 중일 뿐"인지 판단할 때) */
  ignoreReservations = false;

  isReserved(uid: number, slotId: string, exceptPerson: number): boolean {
    if (this.ignoreReservations) return false;
    const p = this.reservations.get(uid)?.get(slotId);
    return p !== undefined && p !== exceptPerson;
  }

  reservedBy(uid: number, slotId: string): number | undefined {
    return this.reservations.get(uid)?.get(slotId);
  }

  reserve(uid: number, slotId: string, personId: number): void {
    let m = this.reservations.get(uid);
    if (!m) {
      m = new Map();
      this.reservations.set(uid, m);
    }
    m.set(slotId, personId);
  }

  release(personId: number): void {
    for (const m of this.reservations.values()) for (const [k, v] of m) if (v === personId) m.delete(k);
  }

  temperatureAt(x: number, y: number): number {
    const r = this.grid.roomOf(x, y);
    return r >= 0 ? this.roomTemps[r] : this.outsideC;
  }

  /** 방 기온: 30분마다 목표 쪽으로 차이의 절반씩 (force면 바로 목표) */
  updateRoomTemps(force = false): void {
    const b = this.data.balance;
    this.outsideC = outsideTemp(b, this.season, this.minuteOfDay());
    const g = this.grid;
    const lit = new Array(g.roomSizes.length).fill(0);
    for (const o of this.objects) {
      if (o.state.lit && this.kindOf(o.defId) === 'hearth') {
        const d = this.footprint(o);
        // 화로가 벽에 붙어 있어도 앞 칸(슬롯) 기준 방으로 셈
        const front = this.slots(o).find((s) => s.id === 'front');
        const rx = front ? o.x + front.dx : o.x + Math.floor(d.w / 2);
        const ry = front ? o.y + front.dy : o.y + d.h;
        const r = g.roomOf(rx, ry);
        if (r >= 0) lit[r]++;
      }
    }
    for (let r = 0; r < g.roomSizes.length; r++) {
      const target = roomTargetTemp(b, this.outsideC, g.roomWallStyles[r], g.roomSizes[r], lit[r], 0);
      const cur = this.roomTemps[r];
      this.roomTemps[r] = force ? target : cur + (target - cur) * b.temperature.roomApproachRate;
    }
  }

  /** 같은 방, 반경 안의 불 붙은 화로 (없으면 null) */
  litHearthNear(x: number, y: number, tiles: number): ObjectInstance | null {
    const room = this.grid.roomOf(Math.floor(x), Math.floor(y));
    if (room < 0) return null;
    for (const o of this.objects) {
      if (!o.state.lit || this.kindOf(o.defId) !== 'hearth') continue;
      if (Math.abs(this.centerX(o) - x) > tiles + 0.5 || Math.abs(this.centerY(o) - y) > tiles + 0.5) continue;
      const front = this.slots(o).find((s) => s.id === 'front');
      const hr = front ? this.grid.roomOf(o.x + front.dx, o.y + front.dy) : this.grid.roomOf(o.x, o.y);
      if (hr === room) return o;
    }
    return null;
  }

  /** 굴뚝 (23-2): 벽 붙이기 화로는 등 뒤(북쪽) 벽을 따라 굴뚝이 저절로 생김 */
  hasChimney(o: ObjectInstance): boolean {
    const g = this.grid;
    const fp = this.footprint(o);
    const y = o.y - 1;
    if (y < 0) return false;
    for (let dx = 0; dx < fp.w; dx++) {
      const i = g.idx(o.x + dx, y);
      if (!g.wall[i] || g.fence[i] || !g.wallStyle[i]) return false;
    }
    return true;
  }

  /** 불 붙은 화로가 반경 안에 있고 같은 방인지 (벽 너머 화로는 데워 주지 않음) */
  nearLitHearth(x: number, y: number, tiles: number): boolean {
    const room = this.grid.roomOf(Math.floor(x), Math.floor(y));
    if (room < 0) return false;
    for (const o of this.objects) {
      if (!o.state.lit || this.kindOf(o.defId) !== 'hearth') continue;
      if (Math.abs(this.centerX(o) - x) > tiles + 0.5 || Math.abs(this.centerY(o) - y) > tiles + 0.5) continue;
      const front = this.slots(o).find((s) => s.id === 'front');
      const hr = front ? this.grid.roomOf(o.x + front.dx, o.y + front.dy) : this.grid.roomOf(o.x, o.y);
      if (hr === room) return true;
    }
    return false;
  }
}

const CW: Record<SlotDef['facing'], SlotDef['facing']> = { down: 'left', left: 'up', up: 'right', right: 'down' };

/** 시계 방향 90° × rot. 칸 (dx,dy) → (h-1-dy, dx), 방향 down→left→up→right */
export function rotateSlots(slots: SlotDef[], fp: { w: number; h: number }, rot: number): SlotDef[] {
  let out = slots.map((s) => ({ ...s }));
  let w = fp.w;
  let h = fp.h;
  for (let k = 0; k < rot % 4; k++) {
    out = out.map((s) => ({ ...s, dx: h - 1 - s.dy, dy: s.dx, facing: CW[s.facing] }));
    [w, h] = [h, w];
  }
  return out;
}
