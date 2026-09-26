/**
 * 마을 (GDD 18): 부지/공공 장소, 마을 사람 채우기, 일과표, 세밀도 3단계 (13-6).
 * - 전체: 조작 가문, 화면 안(+1청크), 조작 가문 부지 안, 조작 인물과 어울리는 중 → 기존 sim 이 매 틱 돌림
 * - 간이: 화면 밖 집 밖 활동 → 일과표 목적지까지 미리 구한 길을 걷는 속도로 따라감 (승급 순간 위치가 이어짐), 욕구는 기대 곡선
 * - 요약: 화면 밖 자기 부지 안/잠 → 제자리, 욕구 기대 곡선. 하루 정산과 생애 판정기 입력만
 * 승급은 즉시, 강등은 조건이 풀린 뒤 30분(전체→간이) / 60분(간이→요약) 지속 (히스테리시스).
 * 렌더러/DOM 없음.
 */
import type { NeedId } from '../core/types';
import { NEED_IDS } from '../core/types';
import type { Rng } from '../core/rng';
import type { SimData } from '../data/simData';
import type { LifeStage, Lod, Person } from '../people/person';
import type { World } from '../world/world';

export interface PlaceDef {
  id: string;
  kind: string;
  nameKey: string;
  rect: [number, number, number, number];
  anchor: [number, number];
  spread?: number;
  hours?: [number, number];
  estateMin?: string | null;
}

const DX4 = [1, -1, 0, 0];
const DY4 = [0, 0, 1, -1];

export interface TownLotDef {
  id: string;
  kind: 'residential' | 'empty';
  size: string;
  rect: [number, number, number, number];
  entrance: [number, number];
  house: string | null;
  price: number;
  start?: boolean;
}

export interface ZoneDef {
  id: string;
  kind: string;
  rect: [number, number, number, number];
  nameKey?: string;
}

export interface TownDef {
  id: string;
  lot: unknown;
  places: PlaceDef[];
  lots: TownLotDef[];
  zones: ZoneDef[];
}

export interface ScheduleBlock {
  from: number;
  to: number;
  at: string;
  do?: string;
}

export interface ScheduleTemplate {
  /** 일터 (장소/구역 id, "employer" = 고용주 가문 집, "home") */
  workAt?: string;
  blocks: ScheduleBlock[];
  weekday?: Record<string, ScheduleBlock[]>;
  /** 이 요일은 weekday 목록이 하루 전체 (쉬는 날) */
  weekdayFull?: string[];
}

export interface ScheduleMod {
  trait?: string;
  virtue?: string;
  sin?: string;
  block: ScheduleBlock;
  chance: number;
  days?: string[];
  estates?: string[];
}

export interface SchedulesData {
  templates: Record<string, ScheduleTemplate>;
  bells?: number[];
  traitMods?: ScheduleMod[];
  virtueMods?: ScheduleMod[];
  sinMods?: ScheduleMod[];
  rainMods?: Record<string, number>;
  plagueMods?: { closed?: string[]; [k: string]: unknown };
}

/** 일/학교 블록은 성향 변형이 덮지 않음 (schedules.json 주석) */
const FIXED_DO = new Set(['work', 'school', 'lessons', 'lead_mass']);

export interface PeopleMember {
  id: string;
  name: string;
  sex: 'male' | 'female';
  stage: LifeStage;
  ageDays: number;
  traits?: string[];
  career?: string | null;
  role?: string | null;
  virtue?: string | null;
  sin?: string | null;
  schedule?: string | null;
  seed?: number;
  topics?: string[];
  temperament?: string;
  lodger?: boolean;
  subrole?: string;
  employer?: string;
  /** 개인 신분이 가문과 다를 때 */
  estate?: string;
}

export interface PeopleHousehold {
  id: string;
  nameKey?: string;
  estate: string;
  wealth?: string;
  lotSize?: string;
  lot?: string | null;
  hookKey?: string | null;
  player?: boolean;
  /** 성/여관/방앗간/교회/수도원에 사는 가문: 그 장소가 집 */
  residence?: string | null;
  members: PeopleMember[];
  relations?: { a: string; b: string; kind: string; friendship?: number; romance?: number }[];
}

export interface PeopleData {
  households: PeopleHousehold[];
  ties?: { a: string; b: string; friendship?: number; romance?: number; flags?: string[] }[];
}

export interface TownHost {
  readonly world: World;
  readonly data: SimData;
  readonly persons: Person[];
  readonly rng: Rng;
  addTownPerson(m: PeopleMember, household: number, estate: string, x: number, y: number): Person;
  relate(a: Person, b: Person, kind: string, friendship: number, romance: number): void;
  findPath(p: Person, from: number, to: number): number[] | null;
  /** 전체로 올린 인물이 일과 목적지로 걸어가게 (자율 항목) */
  goTo(p: Person, cell: number): void;
  abortAll(p: Person): void;
  walkSpeed(): number;
  /** 말 타기 배수 (남은 길 칸 수, 다음 칸): 타면 p.riding 을 켬 */
  rideMult(p: Person, remaining: number, nextCell: number): number;
  /** 조작 가정 인물이 누구와 어울리는 중인지 */
  engagedWithControlled(p: Person): boolean;
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
/** 직업/역할 → 일터 장소 (없으면 집) */
const WORKPLACE: Record<string, string> = {
  innkeeper: 'inn', priest: 'church', miller: 'mill', baker: 'craft_street', smith: 'craft_street', blacksmith: 'craft_street',
  merchant: 'market', trader: 'market', guard: 'castle', lord: 'castle', knight: 'castle', steward: 'castle', reeve: 'castle',
  farmer: 'lord_fields', farmhand: 'lord_fields', laborer: 'lord_fields', shepherd: 'pasture', herbalist: 'forest_river', woodcutter: 'forest_river',
  monk: 'monastery', nun: 'monastery', healer: 'monastery', midwife: 'monastery', bathkeeper: 'bathhouse', minstrel: 'inn', bard: 'inn',
  guildmaster: 'guild_hall', weaver: 'craft_street', tailor: 'craft_street', carpenter: 'craft_street', mason: 'craft_street', brewer: 'inn',
};

export class Town {
  readonly places: PlaceDef[];
  readonly lots: TownLotDef[];
  readonly zones: ZoneDef[];
  private readonly placeById = new Map<string, PlaceDef>();
  private readonly lotById = new Map<string, TownLotDef>();
  /** 1층 판 칸 → 부지 번호+1 / 장소 번호+1 (0 없음) */
  private readonly lotAt: Int16Array;
  private readonly placeAt: Int16Array;
  /** 부지 → 사는 가구 */
  readonly lotHousehold = new Map<string, number>();
  /** 가구 → 가문 이름 키 */
  readonly householdName = new Map<number, string>();
  /** people.json 가문 id → 가구 번호, 가구 → 사는 장소 (residence) */
  readonly householdByKey = new Map<string, number>();
  readonly householdResidence = new Map<number, string>();
  /** 화면 범위 (칸, 1층 판 좌표). null = 헤드리스 (조작 가문만 전체) */
  view: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** 세밀도 강제 (13-6 회귀 테스트: 전 인물 전체 / 전 인물 요약) */
  forceLod: Lod | null = null;
  readonly personById = new Map<string, Person>();
  private readonly W: number;
  private readonly H: number;
  /** 세밀도 전환 기록 (M6 통과 조건: 승급 순간 위치 불연속, 승급 직후 행동) */
  readonly lodLog: { minute: number; id: number; from: Lod; to: Lod; x: number; y: number; at: string }[] = [];

  constructor(private host: TownHost, def: TownDef, readonly schedules: SchedulesData | null) {
    this.places = def.places;
    this.lots = def.lots;
    this.zones = def.zones ?? [];
    const w = host.world;
    this.W = w.lot.w;
    this.H = w.lot.h;
    this.lotAt = new Int16Array(this.W * this.H);
    this.placeAt = new Int16Array(this.W * this.H);
    this.lots.forEach((l, i) => {
      this.lotById.set(l.id, l);
      this.fill(this.lotAt, l.rect, i + 1);
    });
    this.places.forEach((p, i) => {
      this.placeById.set(p.id, p);
      this.fill(this.placeAt, p.rect, i + 1);
    });
    this.findSealedLots();
  }

  /**
   * 길로 이어지지 않은 부지 (절벽·성벽 너머 주머니): 장터에서 걸어서 입구에 닿지 않으면 집으로 쓰지 않음.
   * 그 집에 사람을 넣으면 갇혀 굶거나 용변을 못 봄 (사용자 보고 2026-09-26)
   */
  readonly sealed = new Set<string>();
  private findSealedLots(): void {
    const g = this.host.world.grid;
    const market = this.places.find((p) => p.kind === 'market') ?? this.places[0];
    if (!market) return;
    const start = g.idx(market.anchor[0], market.anchor[1]);
    if (start < 0) return;
    const seen = new Uint8Array(g.w * g.h);
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % g.w;
      const cy = (c - cx) / g.w;
      for (let d = 0; d < 5; d++) {
        const n = d === 4 ? g.portal[c] : g.inBounds(cx + DX4[d], cy + DY4[d]) ? g.idx(cx + DX4[d], cy + DY4[d]) : -1;
        if (n < 0 || seen[n] || !g.walkable(n)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    for (const l of this.lots) {
      const e = g.idx(l.entrance[0], l.entrance[1]);
      if (e >= 0 && !seen[e]) this.sealed.add(l.id);
    }
  }

  private fill(arr: Int16Array, r: [number, number, number, number], v: number): void {
    for (let y = Math.max(0, r[1]); y <= Math.min(this.H - 1, r[3]); y++) for (let x = Math.max(0, r[0]); x <= Math.min(this.W - 1, r[2]); x++) arr[y * this.W + x] = v;
  }

  /** 1층 판 좌표로 (여러 층은 같은 자리) */
  private local(x: number, y: number): number {
    const ly = Math.floor(y) % (this.H + 1);
    const lx = Math.floor(x);
    if (lx < 0 || ly < 0 || lx >= this.W || ly >= this.H) return -1;
    return ly * this.W + lx;
  }

  /**
   * 문 칸의 집 주인 가구: 사람이 사는 집만 (18-1 출입). 공공 장소(여관·교회·성·방앗간 …), 장소에 사는 가문,
   * 일터(누군가의 고용주 집), 빈 집이면 0 = 늘 열림
   */
  doorHousehold(cell: number): number {
    const g = this.host.world.grid;
    const x = cell % g.w;
    const y = Math.floor(cell / g.w);
    if (this.placeOf(x, y)) return 0;
    const lot = this.lotOf(x, y);
    const hh = lot ? this.lotHousehold.get(lot.id) ?? 0 : 0;
    if (!hh || this.householdResidence.has(hh)) return 0;
    if (this.workplaceHouseholds().has(hh)) return 0;
    return hh;
  }

  private workCache: { n: number; set: Set<number> } | null = null;
  /** 일터인 가구 (누군가 그 가구에 고용됨: 공방·가게) */
  private workplaceHouseholds(): Set<number> {
    const persons = this.host.persons;
    if (this.workCache && this.workCache.n === persons.length) return this.workCache.set;
    const set = new Set<number>();
    for (const p of persons) if (p.employer) {
      const hh = this.householdByKey.get(p.employer);
      if (hh) set.add(hh);
    }
    this.workCache = { n: persons.length, set };
    return set;
  }

  lotOf(x: number, y: number): TownLotDef | null {
    const i = this.local(x, y);
    const v = i >= 0 ? this.lotAt[i] : 0;
    return v ? this.lots[v - 1] : null;
  }

  placeOf(x: number, y: number): PlaceDef | null {
    const i = this.local(x, y);
    const v = i >= 0 ? this.placeAt[i] : 0;
    return v ? this.places[v - 1] : null;
  }

  /** 그 장소에 사는 가구들 (residence) */
  residentsOf(placeId: string): number[] {
    const out: number[] = [];
    for (const [hh, pl] of this.householdResidence) if (pl === placeId) out.push(hh);
    return out;
  }

  /** 가장 가까운 공공 장소 (소식 문구의 {place}) */
  nearestPlace(x: number, y: number): PlaceDef | null {
    let best: PlaceDef | null = null;
    let bd = Infinity;
    for (const p of this.places) {
      const d = Math.hypot(p.anchor[0] - x, p.anchor[1] - y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  place(id: string): PlaceDef | undefined {
    return this.placeById.get(id);
  }

  lot(id: string): TownLotDef | undefined {
    return this.lotById.get(id);
  }

  /** 조작 가문 집 부지 */
  playerLot(): TownLotDef | null {
    for (const [id, h] of this.lotHousehold) if (h === 1) return this.lotById.get(id) ?? null;
    return null;
  }

  /** 물건 주인: 부지 안이면 그 가구, 공공/바깥이면 0 (누구나), 아무도 안 사는 집 부지는 -1 (팔 집, 아무도 못 씀) */
  ownerOf(x: number, y: number): number {
    const l = this.lotOf(x, y);
    if (!l) return 0;
    return this.lotHousehold.get(l.id) ?? (l.house ? -1 : 0);
  }

  // ------------------------------------------------------------------ 사람 채우기

  /** people.json → 인물, 가구, 관계. 가구마다 크기에 맞는 부지 배정 (조작 가문은 start 부지) */
  populate(people: PeopleData): void {
    const free = this.lots.filter((l) => l.kind === 'residential' && l.house && !this.sealed.has(l.id));
    const taken = new Set<string>();
    const pickLot = (h: PeopleHousehold): TownLotDef | null => {
      if (h.lot && this.lotById.has(h.lot) && !taken.has(h.lot) && !this.sealed.has(h.lot)) return this.lotById.get(h.lot)!;
      if (h.player) {
        const s = this.lots.find((l) => l.start && !taken.has(l.id));
        if (s) return s;
      }
      // 장소에 사는 가문: 그 장소와 겹치는 부지가 있으면 그 부지, 없으면 부지 없이 장소가 집
      if (h.residence) {
        const pl = this.placeById.get(h.residence);
        if (!pl) return null;
        const r = pl.rect;
        return this.lots.find((l) => !taken.has(l.id) && l.rect[0] <= r[2] && l.rect[2] >= r[0] && l.rect[1] <= r[3] && l.rect[3] >= r[1]) ?? null;
      }
      const want = h.lotSize ?? 'medium';
      return free.find((l) => !taken.has(l.id) && !l.start && l.size === want) ?? free.find((l) => !taken.has(l.id) && !l.start) ?? null;
    };
    let nextHh = 100;
    for (const h of people.households) {
      const hid = h.player ? 1 : nextHh++;
      const lot = pickLot(h);
      if (lot) {
        taken.add(lot.id);
        this.lotHousehold.set(lot.id, hid);
      }
      if (h.nameKey) this.householdName.set(hid, h.nameKey);
      this.householdByKey.set(h.id, hid);
      if (h.residence && this.placeById.has(h.residence)) this.householdResidence.set(hid, h.residence);
      const cells = lot ? this.homeCells(lot) : h.residence && this.placeById.has(h.residence) ? this.placeCells(h.residence) : [];
      for (const m of h.members) {
        const c = cells.length ? cells[Math.floor(this.host.rng.next() * cells.length)] : this.host.world.grid.idx(Math.floor(this.W / 2), this.H - 2);
        const g = this.host.world.grid;
        const p = this.host.addTownPerson(m, hid, m.estate ?? h.estate, (c % g.w) + 0.5, Math.floor(c / g.w) + 0.5);
        p.townId = m.id;
        p.homeLot = lot?.id ?? null;
        p.role = m.role ?? m.career ?? null;
        p.schedule = m.schedule ?? null;
        // 말: 기사/귀족 가문, 부유한 가문 (털색은 가문마다 같게)
        const tr = this.host.data.story?.travel;
        if (tr && (tr.horseEstates.includes(h.estate) || tr.horseWealth.includes(h.wealth ?? ''))) p.horse = hid % 5;
        p.employer = m.employer ?? null;
        this.personById.set(m.id, p);
      }
      for (const r of h.relations ?? []) {
        const a = this.personById.get(r.a);
        const b = this.personById.get(r.b);
        if (a && b) this.host.relate(a, b, r.kind, r.friendship ?? 30, r.romance ?? 0);
      }
    }
    for (const t of people.ties ?? []) {
      const a = this.personById.get(t.a);
      const b = this.personById.get(t.b);
      if (a && b) this.host.relate(a, b, (t.flags ?? [])[0] ?? 'tie', t.friendship ?? 0, t.romance ?? 0);
    }
  }

  /** 장소 안 걸을 수 있는 칸 (장소에 사는 가문의 집) */
  placeCells(id: string): number[] {
    const pl = this.placeById.get(id);
    if (!pl) return [];
    const g = this.host.world.grid;
    const reach = this.reach();
    const out: number[] = [];
    const any: number[] = [];
    for (let y = pl.rect[1]; y <= pl.rect[3]; y++) {
      for (let x = pl.rect[0]; x <= pl.rect[2]; x++) {
        const i = g.idx(x, y);
        if (!g.walkable(i) || !reach[i]) continue;
        any.push(i);
        if (g.room[i] >= 0) out.push(i);
      }
    }
    return out.length ? out : any;
  }

  /** 집 부지 안 걸을 수 있는 방 칸 (없으면 부지 안 아무 칸) */
  homeCells(lot: TownLotDef): number[] {
    const g = this.host.world.grid;
    const reach = this.reach();
    const out: number[] = [];
    const any: number[] = [];
    for (let y = lot.rect[1]; y <= lot.rect[3]; y++) {
      for (let x = lot.rect[0]; x <= lot.rect[2]; x++) {
        const i = g.idx(x, y);
        if (!g.walkable(i) || !reach[i]) continue;
        any.push(i);
        if (g.room[i] >= 0) out.push(i);
      }
    }
    return out.length ? out : any;
  }

  // ------------------------------------------------------------------ 일과표

  private templateOf(p: Person): ScheduleTemplate | null {
    const t = this.schedules?.templates;
    if (!t) return null;
    // 아이/청소년은 단계 일과 (자라면 바뀜), 노인은 일이 있으면 그 일과, 어른은 people.json 일과 → 직업 → 기본
    const stage = p.lifeStage;
    const young = stage === 'baby' || stage === 'toddler' || stage === 'child' || stage === 'teen';
    const own = p.schedule && t[p.schedule] ? p.schedule : null;
    const ownIsStage = own === 'baby' || own === 'toddler' || own === 'child' || own === 'child_tutored' || own === 'teen' || own === 'elder';
    if (young || stage === 'elder') {
      if (own && ownIsStage && (own === stage || (own === 'child_tutored' && stage === 'child'))) return t[own];
      if (stage === 'elder' && own && !ownIsStage) return t[own];
      return t[stage] ?? (young ? t.child : null) ?? t.default ?? null;
    }
    if (own && !ownIsStage) return t[own];
    return (p.role && t[p.role]) || t.default || null;
  }

  /** 지금 일과 칸 (요일 덮어쓰기, 특성 변형은 사람-날짜 해시로 정함) */
  blockAt(p: Person, minute: number): ScheduleBlock {
    const tpl = this.templateOf(p);
    const hour = (minute % 1440) / 60;
    const day = Math.floor(minute / 1440);
    const wd = WEEKDAYS[day % 7];
    const inRange = (b: ScheduleBlock) => (b.from <= b.to ? hour >= b.from && hour < b.to : hour >= b.from || hour < b.to);
    // 특성 변형 (예: 잔치꾼은 저녁에 여관): 사람 × 날짜 해시로 그날 할지 정함
    let base: ScheduleBlock | null = null;
    for (const b of tpl?.weekday?.[wd] ?? []) if (inRange(b)) {
      base = b;
      break;
    }
    // weekdayFull 요일은 weekday 목록이 하루 전체 (빈틈이면 기본 블록으로 메움)
    if (!base) for (const b of tpl?.blocks ?? []) if (inRange(b)) {
      base = b;
      break;
    }
    // 성향 변형 (잔치꾼은 저녁에 여관 등): 일/학교 시각은 덮지 않음. 사람 × 날짜 × 변형 해시로 그날 할지 정함
    if (!base || !FIXED_DO.has(base.do ?? '')) {
      const S = this.schedules;
      const mods = S ? [S.traitMods, S.virtueMods, S.sinMods] : [];
      let k = 0;
      for (const list of mods) {
        for (const m of list ?? []) {
          k++;
          if (m.trait ? !p.traits.includes(m.trait) : m.virtue ? p.virtue !== m.virtue : m.sin ? p.sin !== m.sin : true) continue;
          if (!inRange(m.block)) continue;
          if (m.days && !m.days.includes(wd)) continue;
          if (m.estates && !m.estates.includes(p.estate)) continue;
          const h = (Math.imul(p.id, 2654435761) ^ Math.imul(day + 1, 40503) ^ Math.imul(k, 9973)) >>> 0;
          if ((h % 1000) / 1000 < m.chance) return m.block;
        }
      }
    }
    if (base) return base;
    return { from: 0, to: 24, at: 'home' };
  }

  /** 일과 목적지 장소 id (home/work 풀이) */
  resolveAt(p: Person, b: ScheduleBlock): string {
    if (b.at === 'work') {
      const wa = this.templateOf(p)?.workAt;
      if (wa === 'employer') return p.employer ? `employer:${p.employer}` : 'home';
      const wp = wa ?? (p.role && WORKPLACE[p.role]) ?? null;
      return wp && (this.placeById.has(wp) || this.zones.some((z) => z.id === wp)) ? wp : 'home';
    }
    if (b.at === 'home') {
      const res = this.householdResidence.get(p.household);
      if (res && !p.homeLot) return res;
    }
    return b.at;
  }

  /** 목적지 칸: 집이면 집 안 칸(자리면 침대 근처), 장소면 모임 칸 근처의 빈 칸 */
  targetCell(p: Person, at: string): number {
    const g = this.host.world.grid;
    if (at.startsWith('employer:')) {
      const hh = this.householdByKey.get(at.slice(9));
      let lotId: string | null = null;
      for (const [l, h] of this.lotHousehold) if (h === hh) lotId = l;
      const lot = lotId ? this.lotById.get(lotId) : null;
      if (lot) {
        const cells = this.homeCells(lot);
        if (cells.length) return cells[(p.id * 7919) % cells.length];
      }
      at = (hh && this.householdResidence.get(hh)) || 'home';
    }
    if (at === 'home') {
      const lot = p.homeLot ? this.lotById.get(p.homeLot) : null;
      if (!lot) return g.idx(Math.floor(p.x), Math.floor(p.y));
      const cells = this.homeCells(lot);
      return cells.length ? cells[(p.id * 7919) % cells.length] : this.nearestWalkable(lot.entrance[0], lot.entrance[1]);
    }
    const pl = this.placeById.get(at);
    const z = pl ? null : this.zones.find((q) => q.id === at);
    const r = pl?.rect ?? z?.rect;
    if (!r) return g.idx(Math.floor(p.x), Math.floor(p.y));
    const ax = pl ? pl.anchor[0] : Math.floor((r[0] + r[2]) / 2);
    const ay = pl ? pl.anchor[1] : Math.floor((r[1] + r[3]) / 2);
    // 사람마다 모임 칸 둘레의 다른 칸 (겹쳐 서지 않게)
    const k = p.id * 2654435761 >>> 0;
    const dx = (k % 7) - 3;
    const dy = ((k >>> 3) % 5) - 2;
    return this.nearestWalkable(Math.max(r[0], Math.min(r[2], ax + dx)), Math.max(r[1], Math.min(r[3], ay + dy)));
  }

  private repathTick = -1;
  private repaths = 0;
  static readonly REPATH_PER_TICK = 12;

  /** 마을 출구에서 걸어서 닿는 칸 (World 가 캐시) */
  reach(): Uint8Array {
    return this.host.world.reachFromExits();
  }

  private nearestWalkable(x: number, y: number): number {
    const g = this.host.world.grid;
    const reach = this.reach();
    for (let rr = 0; rr < 8; rr++) {
      for (let dy = -rr; dy <= rr; dy++) {
        for (let dx = -rr; dx <= rr; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue;
          const i = g.idx(nx, ny);
          if (g.walkable(i) && reach[i]) return i;
        }
      }
    }
    return g.idx(x, y);
  }

  // ------------------------------------------------------------------ 세밀도

  private inView(p: Person, margin: number): boolean {
    const v = this.view;
    if (!v) return false;
    const ly = p.y % (this.H + 1);
    return p.x >= v.x0 - margin && p.x <= v.x1 + margin && ly >= v.y0 - margin && ly <= v.y1 + margin;
  }

  private wantsFull(p: Person): boolean {
    if (this.forceLod) return this.forceLod === 'full';
    if (p.household === 1) return true;
    const L = this.host.data.story?.lod;
    if (this.inView(p, L?.viewMarginTiles ?? 16)) return true;
    const pl = this.playerLot();
    if (pl) {
      const lot = this.lotOf(p.x, p.y);
      if (lot && lot.id === pl.id) return true;
    }
    if (p.visitor) return true;
    return this.host.engagedWithControlled(p);
  }

  /** 10분마다: 승급은 즉시, 강등은 지속 시간 뒤 */
  updateLod(minute: number): void {
    const L = this.host.data.story?.lod;
    const dFull = L?.demoteFullMinutes ?? 30;
    const dSimple = L?.demoteSimpleMinutes ?? 60;
    for (const p of this.host.persons) {
      if (p.infant) continue;
      const full = this.wantsFull(p);
      if (full) {
        p.lodCalmSince = -1;
        if (p.lod !== 'full') this.setLod(p, 'full', minute);
        continue;
      }
      if (this.forceLod === 'summary') {
        if (p.lod !== 'summary') this.setLod(p, 'summary', minute);
        continue;
      }
      if (this.forceLod === 'simple') {
        if (p.lod !== 'simple') this.setLod(p, 'simple', minute);
        continue;
      }
      const b = this.blockAt(p, minute);
      const at = this.resolveAt(p, b);
      const homeNow = at === 'home' || b.do === 'sleep';
      if (p.lodCalmSince < 0) p.lodCalmSince = minute;
      const calm = minute - p.lodCalmSince;
      // 집에 있어야 요약으로 (귀갓길에 요약이 되면 길에 선 채 밤을 보냄)
      if (p.lod === 'full' && calm >= dFull) this.setLod(p, homeNow && this.atHome(p) ? 'summary' : 'simple', minute);
      else if (p.lod === 'simple' && homeNow && this.atHome(p) && calm >= dFull + dSimple) this.setLod(p, 'summary', minute);
      else if (p.lod === 'summary' && !homeNow) this.setLod(p, 'simple', minute);
    }
  }

  atHome(p: Person): boolean {
    const lot = this.lotOf(p.x, p.y);
    return !!lot && lot.id === p.homeLot;
  }

  /** 집 안에 있는가: 집 부지, 또는 사는 장소(성·여관·교회 …) 안 */
  insideHome(p: Person): boolean {
    if (p.homeLot) return this.atHome(p);
    const res = this.householdResidence.get(p.household);
    return !!res && this.placeOf(p.x, p.y)?.id === res;
  }

  setLod(p: Person, to: Lod, minute: number): void {
    const from = p.lod;
    if (from === to) return;
    const b = this.blockAt(p, minute);
    const at = this.resolveAt(p, b);
    this.lodLog.push({ minute, id: p.id, from, to, x: p.x, y: p.y, at });
    if (this.lodLog.length > 2000) this.lodLog.splice(0, 1000);
    if (from === 'full') {
      // 강등: 진행 중 행동을 끝내고(부분 결과는 sim 이 처리), 일과 목적지 길을 잡음
      this.host.abortAll(p);
    }
    p.lod = to;
    p.lodSince = minute;
    p.simplePath = [];
    p.simpleStep = 0;
    p.simpleGoal = -1;
    if (to === 'full') {
      // 승급: 지금 자리에서 그대로 (위치 연속), 일과 목적지가 멀면 걸어감
      p.hidden = false;
      const goal = this.targetCell(p, at);
      const g = this.host.world.grid;
      const here = g.idx(p.cellX(), p.cellY());
      if (goal !== here && p.household !== 1) this.host.goTo(p, goal);
    }
  }

  // ------------------------------------------------------------------ 간이/요약 틱

  /** 간이 인물: 매 분 길을 따라 걸음 (길은 목적지가 바뀔 때만 구함) */
  simpleTick(p: Person, minute: number): void {
    const b = this.blockAt(p, minute);
    const at = this.resolveAt(p, b);
    const goal = this.targetCell(p, at);
    const g = this.host.world.grid;
    // 일과가 바뀌는 순간 모두가 한꺼번에 길을 찾지 않게 틱마다 길찾기 수 상한 (13-6 프레임 예산)
    if (goal !== p.simpleGoal && this.repathTick === minute && this.repaths >= Town.REPATH_PER_TICK) return;
    if (goal !== p.simpleGoal) {
      if (this.repathTick !== minute) {
        this.repathTick = minute;
        this.repaths = 0;
      }
      this.repaths++;
      p.simpleGoal = goal;
      const here = g.idx(p.cellX(), p.cellY());
      p.simplePath = here === goal ? [] : this.host.findPath(p, here, goal) ?? [];
      p.simpleStep = 0;
      // 길이 없으면 (섬, 막힘) 목적지로 바로 (화면 밖이라 보이지 않음)
      if (here !== goal && !p.simplePath.length) {
        p.x = (goal % g.w) + 0.5;
        p.y = Math.floor(goal / g.w) + 0.5;
      }
    }
    let budget = this.host.walkSpeed() * this.host.rideMult(p, p.simplePath.length - p.simpleStep, p.simplePath[p.simpleStep] ?? -1);
    while (budget > 0 && p.simpleStep < p.simplePath.length) {
      const c = p.simplePath[p.simpleStep];
      const cx = (c % g.w) + 0.5;
      const cy = Math.floor(c / g.w) + 0.5;
      const dx = cx - p.x;
      const dy = cy - p.y;
      const d = Math.hypot(dx, dy);
      // 층 사이(계단/들창)는 한 걸음
      if (d > 2) {
        p.x = cx;
        p.y = cy;
        p.simpleStep++;
        budget -= 1;
        continue;
      }
      if (d <= budget) {
        p.x = cx;
        p.y = cy;
        budget -= d;
        p.simpleStep++;
      } else {
        p.x += (dx / d) * budget;
        p.y += (dy / d) * budget;
        budget = 0;
      }
    }
    p.place = this.placeOf(p.x, p.y)?.id ?? (this.atHome(p) ? `home:${p.household}` : null);
    if (minute % (this.host.data.story?.lod.simpleNeedsMinutes ?? 10) === 0) this.expectedNeeds(p, b, 10);
  }

  /**
   * 일과표상 장소 (소문 접촉 통계, 14-6): 세밀도와 무관하게 모든 인물을 같은 식으로 셈.
   * 집이면 home:<가구>, 공공 장소면 그 id, 그 밖(부지 밖 일터, 길)은 null
   */
  schedulePlace(p: Person, minute: number): string | null {
    const at = this.resolveAt(p, this.blockAt(p, minute));
    return at === 'home' ? `home:${p.household}` : this.placeById.has(at) ? at : null;
  }

  /** 요약 인물: 10분마다 욕구만 (집에 있음) */
  summaryTick(p: Person, minute: number): void {
    if (minute % 10 !== 0) return;
    const b = this.blockAt(p, minute);
    // 요약 인물도 일과표상 장소에 '있는 것으로' 셈 (소문/만남 통계가 세밀도와 무관하게, 13-6)
    p.place = this.schedulePlace(p, minute);
    this.expectedNeeds(p, b, 10);
  }

  /**
   * 욕구 기대 곡선 (13-6): 일과가 채우는 욕구는 오르고 나머지는 천천히 내려감.
   * 먹는 시간 → 허기, 잠 → 기력/편안, 미사/여관/장터 → 교류/재미, 집 → 위생/온기
   */
  expectedNeeds(p: Person, b: ScheduleBlock, minutes: number): void {
    const up = (id: NeedId, per10: number) => p.setNeed(id, p.need(id) + (per10 * minutes) / 10);
    for (let i = 0; i < 8; i++) {
      const id = NEED_IDS[i];
      const rate = this.host.data.needs.needs[id].decayPerHour ?? 5;
      p.setNeed(id, Math.max(25, p.needs[i] - (rate * minutes) / 60 * 0.6));
    }
    const d = b.do ?? '';
    if (d === 'sleep') {
      up('energy', 2.5);
      up('comfort', 1);
    }
    if (d === 'meal' || d === 'breakfast' || d === 'eat' || d === 'wake') up('hunger', 12);
    if (d === 'mass' || d === 'drink' || d === 'shop' || b.at === 'inn' || b.at === 'market' || b.at === 'well_square') {
      up('social', 4);
      up('fun', 2);
    }
    if (b.at === 'home') {
      up('hygiene', 1.2);
      up('warmth', 3);
      up('bladder', 6);
    } else up('bladder', 3);
  }
}
