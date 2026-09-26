/**
 * 화재 (GDD 23-5): 화로 방치, 촛불 넘어짐, 초가지붕 + 번개 → 불은 칸에서 칸으로 번지고, 물통/흙으로 끔.
 * 이웃이 도우러 오고, 래빗홀(일터)에 간 가족은 일찍 돌아옴. 가구는 타 없어지고 가보는 "손상".
 * 불은 칸마다 가상 물건 'house_fire' (막는 물건: 길찾기가 피함, 끄기 상호작용의 대상). 렌더러/DOM 없음.
 */
import type { ObjectInstance } from '../core/types';
import { Rng } from '../core/rng';
import type { BuildData, SimData } from '../data/simData';
import { FIRE_OBJECT_ID } from '../data/simData';
import type { Person } from '../people/person';
import type { World } from '../world/world';

export interface FireHost {
  readonly world: World;
  readonly data: SimData;
  readonly persons: Person[];
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
  moodlet(p: Person, id: string): void;
  /** 가보 물건이 불에 닿음 (16-5: 손상, 없어지지 않음). 가보면 true */
  heirloomFire?(uid: number): boolean;
  /** 끄러 달려감 (자율 행동을 끊고 맨 앞) */
  rush(p: Person, fireUid: number): void;
  /** 이웃 하나가 도우러 옴 */
  callNeighbor(): boolean;
  /** 부지 밖(일터/장터)에 나간 가족을 불러들임 */
  callHome(p: Person): void;
  /** 타 버린 물건을 쓰던 사람의 행동을 끊음 */
  abortUsingHook?(uid: number): void;
}

interface Burning {
  uid: number;
  cell: number;
  since: number;
  /** 이 칸의 물건을 태우기 시작한 분 */
  objectSince: number;
}

export class Fire {
  private rng: Rng;
  readonly burning = new Map<number, Burning>();
  /** 불 붙은 화로/촛불이 마지막으로 누가 곁에 있던 분 */
  private attended = new Map<number, number>();
  private startedAt = -1;
  private neighborCalled = false;
  private homeCalled = false;
  /** 오늘 번개가 칠 분 (-1 없음) */
  private lightningAt = -1;
  /** 다 타 버린 칸 (다시 타지 않음, 리뷰 M5-3) */
  readonly burnt = new Set<number>();
  /** 탄 바닥을 바꿈 → 틱 끝에 격자를 다시 */
  private lotDirty = false;
  /** 통계 (헤드리스/테스트) */
  stats = { ignitions: 0, extinguished: 0, burnedObjects: 0, spread: 0 };

  constructor(private host: FireHost, seed: number) {
    this.rng = new Rng((seed * 131 + 17) >>> 0);
  }

  private get b(): BuildData['fire'] {
    return this.host.data.build!.fire;
  }

  get active(): boolean {
    return this.burning.size > 0;
  }

  /** 새 날: 초가/나무 널 지붕에 번개 칠 시각 (19장 날씨가 생기면 폭풍 날에만) */
  newDay(): void {
    const b = this.host.data.build!;
    const style = this.host.world.lot.roof?.style ?? b.defaultRoof;
    const p = b.roofs[style]?.lightningPerDay ?? 0;
    this.lightningAt = p > 0 && this.rng.next() < p ? this.host.world.minute + Math.floor(this.rng.next() * 1440) : -1;
  }

  tick(): void {
    const w = this.host.world;
    const m = w.minute;
    this.ignitionChecks(m);
    if (m === this.lightningAt) this.lightning();
    if (!this.burning.size) return;
    if ((m - this.startedAt) % this.b.spreadMinutes === 0) this.spread();
    this.burnDown(m);
    this.respond(m);
    if (this.lotDirty) {
      this.lotDirty = false;
      for (const uid of this.host.world.rebuild()) this.host.abortUsingHook?.(uid);
    }
  }

  // ------------------------------------------------------------------ 불이 나는 까닭

  private ignitionChecks(m: number): void {
    const w = this.host.world;
    const g = w.grid;
    const b = this.b;
    for (const o of w.objects) {
      if (!o.state.lit) continue;
      const kind = w.kindOf(o.defId);
      if (kind !== 'hearth' && kind !== 'candlestick') continue;
      // 곁에 깨어 있는 사람이 있으면 지켜보는 중
      const room = g.roomOf(w.centerX(o), w.centerY(o) + (kind === 'hearth' ? 1 : 0));
      const watched = this.host.persons.some((p) => !p.hidden && !p.sleeping && (room >= 0 ? g.roomOf(p.x, p.y) === room : Math.abs(p.x - w.centerX(o)) + Math.abs(p.y - w.centerY(o)) < 5));
      if (watched || !this.attended.has(o.uid)) {
        this.attended.set(o.uid, m);
        continue;
      }
      if (m - this.attended.get(o.uid)! < b.unattendedAfterMinutes) continue;
      const perDay = kind === 'hearth' ? b.hearthUnattendedPerDay : b.candleUnattendedPerDay;
      if (this.rng.next() < perDay / 1440) {
        // 불똥이 튄 칸: 화로 앞, 촛대는 옆 칸
        const cands = w.slots(o).map((s) => w.slotCell(o, s)).filter((c) => this.flammable(c) > 0);
        const cell = cands.length ? cands[Math.floor(this.rng.next() * cands.length)] : -1;
        if (cell >= 0) this.ignite(cell, kind === 'hearth' ? 'hearth' : 'candle');
      }
    }
  }

  private lightning(): void {
    const w = this.host.world;
    const g = w.grid;
    const top = g.roofMap();
    const cells: number[] = [];
    for (let i = 0; i < top.length; i++) {
      if (top[i] < 0) continue;
      const x = i % g.w;
      const ly = Math.floor(i / g.w);
      cells.push(g.idx(x, top[i] * (g.slabH + 1) + ly));
    }
    if (!cells.length) return;
    const c = cells[Math.floor(this.rng.next() * cells.length)];
    // 벽 칸이면 이웃한 방 칸으로
    const x = c % g.w;
    const y = Math.floor(c / g.w);
    const near: number[] = [c];
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) if (g.inBounds(x + dx, y + dy)) near.push(g.idx(x + dx, y + dy));
    const target = near.find((i) => g.room[i] >= 0);
    if (target !== undefined) this.ignite(target, 'lightning');
  }

  /** 칸의 탈 것 배수 (0 = 안 탐) */
  flammable(cell: number): number {
    const w = this.host.world;
    const g = w.grid;
    const b = this.host.data.build!;
    if (cell < 0 || cell >= g.room.length || !g.solid[cell] || this.burning.has(cell) || this.burnt.has(cell)) return 0;
    if (g.wall[cell] && !g.door[cell]) return 0;
    let f = 0;
    const floor = w.lot.floor[cell];
    if (floor) f = Math.max(f, b.floors[floor]?.fire ?? 1);
    else if (g.room[cell] < 0) f = Math.max(f, 0.15); // 풀밭: 조금
    const oid = g.objAt[cell];
    if (oid) {
      const o = w.byUid.get(oid - 1);
      if (o && o.defId !== FIRE_OBJECT_ID) f = Math.max(f, 1.2);
    }
    // 벽 재질: 나무판/반목조 방은 더 잘 번짐
    const room = g.room[cell];
    if (room >= 0) {
      const styles = g.roomWallStyles[room];
      let wf = 0;
      for (const s of styles) wf += b.walls[s]?.fire ?? 0;
      if (styles.length) f += (wf / styles.length) * 0.4;
      // 맨 위 층이면 지붕 재질
      const roof = b.roofs[w.lot.roof?.style ?? b.defaultRoof];
      f += (roof?.fire ?? 0) * 0.15;
    }
    return f;
  }

  /** 칸에 불을 붙임 (다른 모듈/테스트도 씀). 불 가상 물건 uid 또는 -1 */
  ignite(cell: number, cause: string): number {
    const w = this.host.world;
    if (this.burning.has(cell) || this.burning.size >= this.b.maxFires) return -1;
    const x = cell % w.grid.w;
    const y = Math.floor(cell / w.grid.w);
    const o = w.addFire(x, y);
    this.burning.set(cell, { uid: o.uid, cell, since: w.minute, objectSince: -1 });
    if (this.startedAt < 0) {
      this.startedAt = w.minute;
      this.neighborCalled = false;
      this.homeCalled = false;
      this.stats.ignitions++;
      const first = this.host.persons.find((p) => p.household === 1);
      if (first) this.host.notice(first, 'fire_started', { cause: `fire.cause.${cause}` });
    }
    return o.uid;
  }

  private spread(): void {
    const w = this.host.world;
    const g = w.grid;
    const b = this.b;
    const now = [...this.burning.values()];
    for (const f of now) {
      const x = f.cell % g.w;
      const y = Math.floor(f.cell / g.w);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!g.inBounds(nx, ny)) continue;
        const c = g.idx(nx, ny);
        if (g.slabOf(c) !== g.slabOf(f.cell)) continue;
        const fl = this.flammable(c);
        if (fl > 0 && this.rng.next() < b.spreadChance * fl) {
          if (this.ignite(c, 'spread') >= 0) this.stats.spread++;
        }
      }
      // 나무 바닥이면 위층으로 (천장을 타고)
      const s = g.slabOf(f.cell);
      const up = s + 1 < 3 ? s + 1 : -1;
      if (up > 0 && (w.lot.floor[f.cell] ? (this.host.data.build!.floors[w.lot.floor[f.cell]!]?.fire ?? 0) > 0 : false)) {
        const c = f.cell + (g.slabH + 1) * g.w;
        if (c < g.room.length && this.flammable(c) > 0 && this.rng.next() < b.spreadChance * 0.3) this.ignite(c, 'spread');
      }
    }
  }

  /** 다 탄 칸은 꺼지고, 칸 위 물건은 오래 타면 없어짐 (가보는 손상) */
  private burnDown(m: number): void {
    const w = this.host.world;
    const g = w.grid;
    const b = this.b;
    for (const f of [...this.burning.values()]) {
      // 칸 옆 물건 (불 가상 물건이 칸을 차지하므로 발자국이 닿는 물건을 찾음)
      const x = f.cell % g.w;
      const y = Math.floor(f.cell / g.w);
      const victim = this.objectNear(x, y);
      if (victim) {
        if (f.objectSince < 0) f.objectSince = m;
        else if (m - f.objectSince >= b.burnObjectAfterMinutes) {
          this.burnObject(victim);
          f.objectSince = -1;
        }
      }
      // 칸에 선 사람은 데임
      for (const p of this.host.persons) {
        if (p.hidden || Math.floor(p.x) !== x || Math.floor(p.y) !== y) continue;
        this.host.moodlet(p, 'burned');
      }
      if (m - f.since >= b.burnMinutes) {
        // 나무 바닥은 그을려 흙바닥 (1층) / 위층은 구멍이 나지 않게 거친 널로
        const fl = w.lot.floor[f.cell];
        if (fl && (this.host.data.build!.floors[fl]?.fire ?? 0) > 0.5) {
          w.lot.floor[f.cell] = g.slabOf(f.cell) === 0 ? 'floor_dirt' : 'floor_plank_rough';
          this.lotDirty = true;
        }
        this.burnt.add(f.cell);
        this.remove(f.cell, false);
      }
    }
  }

  private objectNear(x: number, y: number): ObjectInstance | null {
    const w = this.host.world;
    for (const o of w.objects) {
      if (o.defId === FIRE_OBJECT_ID || o.defId === 'lot_exit' || o.defId === 'window_opening') continue;
      const d = this.host.data.objects[o.defId];
      if (!d || d.tags.includes('stairs')) continue;
      const fp = w.footprint(o);
      if (x >= o.x - 0 && x < o.x + fp.w && y >= o.y && y < o.y + fp.h) return o;
      // 불 칸과 맞닿은 가구
      if (x >= o.x - 1 && x <= o.x + fp.w && y >= o.y - 1 && y <= o.y + fp.h && d.blocks && (x === o.x - 1 || x === o.x + fp.w || y === o.y - 1 || y === o.y + fp.h)) {
        if ((x === o.x - 1 || x === o.x + fp.w) && (y === o.y - 1 || y === o.y + fp.h)) continue;
        return o;
      }
    }
    return null;
  }

  private burnObject(o: ObjectInstance): void {
    const w = this.host.world;
    const d = this.host.data.objects[o.defId];
    const fam = this.host.persons.find((p) => p.household === 1);
    if (this.host.heirloomFire?.(o.uid) || d?.tags.includes('heirloom')) {
      // 가보는 타 없어지지 않고 손상 (16-5)
      o.state.damaged = true;
      if (fam) this.host.notice(fam, 'heirloom_damaged', { object: d.nameKey });
      return;
    }
    this.host.abortUsingHook?.(o.uid);
    w.removeObject(o.uid);
    this.stats.burnedObjects++;
    if (fam) this.host.notice(fam, 'object_burned', { object: d?.nameKey ?? o.defId });
    for (const p of this.host.persons) if (p.household === 1) this.host.moodlet(p, 'house_fire');
  }

  /** 불 끄기 (끄기 상호작용 성공, 다 탐) */
  remove(cell: number, putOut: boolean): void {
    const f = this.burning.get(cell);
    if (!f) return;
    this.burning.delete(cell);
    // 끈 불이든 다 탄 불이든, 그 불을 끄러 가던 다른 사람은 멈춤 (리뷰 M5-1B)
    this.host.abortUsingHook?.(f.uid);
    this.host.world.removeObject(f.uid);
    if (putOut) this.stats.extinguished++;
    if (!this.burning.size) {
      this.startedAt = -1;
      const fam = this.host.persons.find((p) => p.household === 1);
      if (fam) this.host.notice(fam, 'fire_out');
    }
  }

  removeByUid(uid: number, putOut: boolean): void {
    for (const f of this.burning.values()) {
      if (f.uid === uid) {
        this.remove(f.cell, putOut);
        return;
      }
    }
  }

  // ------------------------------------------------------------------ 사람들

  /** 가족과 손님 어른은 불을 끄러 달려가고, 이웃이 도우러 오고, 일터의 가족은 돌아옴 */
  private respond(m: number): void {
    const w = this.host.world;
    const g = w.grid;
    const fires = [...this.burning.values()];
    for (const p of this.host.persons) {
      if (p.hidden || p.collapse || p.stage === 'child') continue;
      if (p.action?.item.interactionId === 'fire.extinguish') continue;
      if (p.queue.some((q) => q.interactionId === 'fire.extinguish')) continue;
      // 잠든 사람도 연기 냄새에 깸: 같은 층이면 모두
      let best: Burning | null = null;
      let bd = Infinity;
      const ps = g.slabOf(g.idx(p.cellX(), p.cellY()));
      for (const f of fires) {
        // 다른 층 불도 (잠든 2층 가족이 깸) — 같은 층을 먼저
        const fx = f.cell % g.w;
        const fy = (Math.floor(f.cell / g.w) % (g.slabH + 1));
        const d = Math.abs(fx - p.x) + Math.abs(fy - (p.y % (g.slabH + 1))) + (g.slabOf(f.cell) !== ps ? 30 : 0);
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
      if (best) this.host.rush(p, best.uid);
    }
    if (!this.neighborCalled && m - this.startedAt >= this.b.neighborHelpAfterMinutes) {
      this.neighborCalled = true;
      if (this.rng.next() < this.b.neighborHelpChance) this.host.callNeighbor();
    }
    // 부지 밖(일터, 장터, 앞마당 채집)에 나간 가족은 연기를 보고/소식을 듣고 돌아옴. 불이 꺼질 때까지 다시 나가지 않음
    for (const p of this.host.persons) {
      if (!p.hidden || p.household !== 1 || !p.action) continue;
      this.host.callHome(p);
      if (!p.hidden && fires.length) this.host.rush(p, fires[0].uid);
    }
    void this.homeCalled;
  }
}
