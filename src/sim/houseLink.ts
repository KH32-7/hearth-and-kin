/**
 * M8 가문과 신분 연결 (리드): 작업자 E(신분·사치 금지법·프리셋·영지)와 H(가문·명예·상속·가보·하인) 모듈의 Host 를
 * Simulation 위에 구현하고, 출생·사망·혼인·자정·매시·파산·세금 훅과 의도를 한곳에서 다룸.
 * 돈 단위: H 모듈은 동화, E 모듈은 파딩 (econ 계정은 파딩). 여기서 바꿔 줌.
 * sim.ts 는 이 파일의 HouseLink 만 알고, 내부 구현은 좁은 Internals 창구로 봄
 */
import { Rng } from './core/rng';
import type { Person } from './people/person';
import type { Simulation } from './sim';
import type { LifeStage } from './people/person';
import { clansFrom, createHouse, heraldryCatalog, type House, type HouseAllHost, type HeraldrySpec, type InheritanceLaw, type ServantRole } from './house/clans';
import type { HeirloomRef, Heirloom } from './house/heirlooms';
import { Estates, parseEstates, type EstatesHost, type EstateId } from './house/estates';
import { FiefSystem, parseFief, type FiefHost } from './house/fief';
import { Sumptuary, parseSumptuary, tierIndex, estateTier, type SumptuaryHost, type WornItem } from './house/sumptuary';
import { applyPreset, parsePresets, presetIds, resolvePreset, type PresetHost, type PresetResult, type PresetsData, type PresetPersonSpec } from './house/presets';
import { randomMember, type FamilySpec, type RelSpec } from './family/creation';

/** Simulation 의 내부 창구 (private 포함). 구조 캐스팅으로만 씀 */
interface Internals {
  readonly persons: Person[];
  readonly data: Simulation['data'];
  readonly world: Simulation['world'];
  readonly settings: Simulation['settings'];
  readonly econ: Simulation['econ'];
  readonly rel: Simulation['rel'];
  readonly inner: Simulation['inner'];
  readonly skills: Simulation['skills'];
  readonly lifecycle: Simulation['lifecycle'];
  readonly judge: Simulation['judge'];
  readonly town: Simulation['town'];
  readonly rumors: Simulation['rumors'];
  readonly builder: Simulation['builder'];
  readonly genetics: Simulation['genetics'];
  readonly names: Simulation['names'];
  readonly lordFavor: Map<number, number>;
  readonly chronicleLog: { day: number; trigger: string; subjects: number[] }[];
  readonly fame: Map<number, number>;
  readonly seed: number;
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
  townNews(kind: string, args: Record<string, string | number>, subjects: Person[]): void;
  offerCard(p: Person, cardId: string, vars?: Record<string, string | number>, other?: Person | null): void;
  killPerson(p: Person, cause: string): void;
  moveHousehold(p: Person, household: number, lot: string | null): void;
  newHouseholdId(): number;
  freeLot(size: string): string | null;
  setCareer(p: Person, careerId: string | null, start?: boolean): { ok: boolean; reason?: string };
  addPerson(name: string, x?: number, y?: number, opts?: Record<string, unknown>): Person;
  createFamily(spec: FamilySpec): { ok: boolean; issues?: string[]; ids?: number[] };
  createChild(stage: LifeStage, estate: string, household: number): Person | null;
  coarseStage(p: Person): void;
}

const RESIDENCE: Record<string, string> = { rectory: 'church', monastery_cell: 'monastery' };
const LOT_SIZE: Record<string, string[]> = {
  hut: ['small'],
  farmhouse: ['small', 'medium'],
  workshop_house: ['medium', 'small'],
  merchant_house: ['large', 'medium', 'small'],
  manor: ['large', 'medium'],
  castle_hall: ['large'],
};
const HOUSE_TIER: Record<string, number> = { small: 1, medium: 2, large: 3 };

export class HouseLink {
  readonly house: House;
  readonly estates: Estates<Person>;
  readonly fief: FiefSystem | null;
  readonly sumptuary: Sumptuary<Person> | null;
  readonly presets: PresetsData | null;
  /** 가정 대표 신분 (16-2: 가장 신분을 따로 저장) */
  readonly hhEstate = new Map<number, EstateId>();
  /** 인물별 차림 (옷감·염료: 사치 금지법 판정). 없으면 개인 신분 기본 차림 */
  readonly dress = new Map<number, { cloth: string; dye: string }>();
  /** 마지막 잔치 날 (귀족 사치 요구), 전공/우승 (기사 서임) */
  readonly lastFeast = new Map<number, number>();
  readonly feats = new Set<number>();
  /** 도시 도망 중 (마을 밖) */
  readonly awayFlight = new Set<number>();
  /** 오늘 재판 벌금, 사용료 (파딩: M9 재판·정책이 채움) */
  finesToday = 0;
  feesToday = 0;
  lastPreset: PresetResult | null = null;
  private readonly rng: Rng;
  private personsCache: { minute: number; n: number; list: Person[] } = { minute: -1, n: -1, list: [] };

  static create(sim: Simulation): HouseLink | null {
    const f = sim.data.family;
    const cd = clansFrom(f);
    const ed = parseEstates(f?.estates);
    if (!cd || !ed) return null;
    return new HouseLink(sim, cd, ed);
  }

  private get s(): Internals {
    return this.sim as unknown as Internals;
  }

  private constructor(private sim: Simulation, cd: NonNullable<ReturnType<typeof clansFrom>>, ed: NonNullable<ReturnType<typeof parseEstates>>) {
    const s = this.s;
    this.rng = new Rng((s.seed * 6151 + 29) >>> 0);
    this.house = createHouse(this.houseHost(), cd);
    this.estates = new Estates<Person>(this.estatesHost(), ed);
    const fd = parseFief(sim.data.family?.estates);
    this.fief = fd ? new FiefSystem(this.fiefHost(), fd) : null;
    const sd = parseSumptuary(sim.data.family?.sumptuary);
    this.sumptuary = sd ? new Sumptuary<Person>(this.sumptuaryHost(), sd) : null;
    this.presets = parsePresets(sim.data.family?.startPresets);
    // 가정 대표 신분: 가구 첫 성인(가장)의 신분
    for (const p of s.persons) if (!this.hhEstate.has(p.household) && !p.visitor) this.hhEstate.set(p.household, p.estate as EstateId);
    // 마을 가문 등록 (people.json 가정 목록)
    const t = s.town;
    const people = sim.data.town?.people?.households ?? [];
    if (t && people.length) {
      const list = people
        .map((h) => ({ household: t.householdByKey.get(h.id) ?? -1, key: h.id, nameKey: h.nameKey ?? null, estate: h.estate, wealth: (h as { wealth?: string }).wealth }))
        .filter((h) => h.household >= 0);
      for (const h of list) this.hhEstate.set(h.household, (h.estate as EstateId) ?? this.hhEstate.get(h.household) ?? 'freeman');
      this.house.clans.fromTown(list);
      // NPC 영주 가문 (금고 주인): 귀족 가정에 영지
      if (this.fief) for (const h of list) if (h.estate === 'noble') this.fief.grant(h.household, { lord: true, policy: true });
    } else if (s.persons.some((p) => p.household === 1)) {
      this.house.clans.register({ households: [1], name: null, estate: this.hhEstate.get(1) ?? 'freeman' });
    }
  }

  // ================================================================== 공통 도움

  /** 인물이 들어오거나 나감 (캐시 무효화: 같은 분에 죽음과 출생이 겹쳐도 새 목록) */
  touch(): void {
    this.personsCache.minute = -1;
  }

  private persons(): Person[] {
    const s = this.s;
    const c = this.personsCache;
    if (c.minute !== s.world.minute || c.n !== s.persons.length) {
      c.list = s.persons.filter((q) => !q.visitor);
      c.minute = s.world.minute;
      c.n = s.persons.length;
    }
    return c.list;
  }

  private day(): number {
    return this.s.world.day();
  }

  private seasonDays(): number {
    return (this.s.data.economy as { calendar?: { seasonDays: number } } | null)?.calendar?.seasonDays ?? 7;
  }

  private members(hh: number): Person[] {
    return this.persons().filter((q) => q.household === hh);
  }

  private age(p: Person): number {
    const s = this.s;
    return s.lifecycle ? s.lifecycle.displayAge(p) : s.judge?.age(p) ?? 30;
  }

  headOf(hh: number): Person | undefined {
    const cl = this.house.clans.clanOfHousehold(hh);
    const h = cl ? this.house.clans.head(cl.id) : null;
    if (h && h.household === hh) return h;
    let best: Person | undefined;
    for (const q of this.members(hh)) {
      if (q.lifeStage === 'baby' || q.lifeStage === 'toddler' || q.lifeStage === 'child') continue;
      if (!best || this.age(q) > this.age(best)) best = q;
    }
    return best;
  }

  householdEstate(hh: number): EstateId {
    return this.hhEstate.get(hh) ?? ((this.headOf(hh)?.estate as EstateId) || 'freeman');
  }

  /** 가구 돈 (파딩). NPC 가정은 계정이 없으면 신분 S 의 0.3 으로 봄 */
  private farthings(hh: number): number {
    const a = this.s.econ?.account(hh);
    if (a) return a.money;
    return Math.round((this.s.econ?.S(this.householdEstate(hh)) ?? 0) * 0.3 * 4);
  }

  private spendF(hh: number, amount: number, reason: string, allowDebt = false): boolean {
    const e = this.s.econ;
    const a = e?.account(hh);
    if (!e || !a) return !!e && hh >= 100; // NPC 가정: 요약 경제 (돈 흐름은 기록하지 않음)
    if (!allowDebt && a.money < amount) return false;
    e.spend(a, amount, reason);
    return true;
  }

  private earnF(hh: number, amount: number, reason: string, tithed = false): void {
    const e = this.s.econ;
    const a = e?.account(hh);
    if (e && a && amount > 0) e.earn(a, amount, reason, tithed);
  }

  private moodlet(p: Person, id: string): void {
    if (p.lifeStage === 'baby' || p.hidden) return;
    this.s.inner?.addMoodlet(p, id, {});
  }

  private chronicle(trigger: string, subjects: Person[]): void {
    this.s.chronicleLog.push({ day: this.day(), trigger, subjects: subjects.map((q) => q.id) });
  }

  /** 가문 소문: 나쁜 소문은 목격자 한 명(다른 가구 어른)이 퍼뜨리기 시작 (14-6) */
  private rumor(subject: Person, kind: string, good: boolean, strength: number): void {
    const R = this.s.rumors;
    if (!R) return;
    const fam = this.members(subject.household);
    const others = this.persons().filter((q) => q.household !== subject.household && !q.infant && (q.lifeStage === 'young' || q.lifeStage === 'adult' || q.lifeStage === 'elder'));
    const wit = others.length ? [others[Math.floor(this.rng.next() * others.length)]] : [];
    R.add(kind, [subject], { a: subject.name }, this.day(), strength, [...fam, ...wit], { good });
  }

  private savingsS(estate: string): number {
    return this.s.econ?.S(estate as EstateId) ?? 0;
  }

  // ================================================================== H 창구 (동화)

  private houseHost(): HouseAllHost {
    const L = this;
    const s = this.s;
    return {
      get persons() {
        return L.persons();
      },
      rng: this.rng,
      day: () => this.day(),
      lifespan: () => s.settings.lifespan,
      controlled: (hh) => hh === 1,
      householdEstate: (hh) => this.householdEstate(hh),
      moodlet: (p, id) => this.moodlet(p, id),
      memory: (p, kind, importance, valence, withPerson) => {
        p.memories.push({ kind, minute: s.world.minute, valence, importance, withPerson, objectUid: 0 });
      },
      notice: (p, kind, args) => s.notice(p, kind, args),
      news: (kind, args, subjects) => s.townNews(kind, args, subjects),
      chronicle: (trigger, subjects) => this.chronicle(trigger, subjects),
      rumor: (subject, kind, good, strength) => this.rumor(subject, kind, good, strength),
      offerCard: (p, cardId, vars, other) => s.offerCard(p, cardId, vars ?? {}, other ?? null),
      friendship: (a, b) => s.rel.get(a.id, b.id)?.friendship ?? 0,
      skillLevel: (p, sk) => s.skills?.level(p, sk) ?? 0,
      money: (hh) => Math.floor(this.farthings(hh) / 4),
      savingsS: (hh) => this.savingsS(this.householdEstate(hh)),
      addWish: (p, wishId) => s.inner?.giveWish(p, wishId) ?? false,
      transferMoney: (from, to, amount, reason) => {
        const e = s.econ;
        const a = e?.account(from);
        if (!e) return false;
        if (a) {
          if (a.money < amount * 4) return false;
          e.spend(a, amount * 4, reason);
        } else if (from < 100) return false;
        this.earnF(to, amount * 4, reason);
        return true;
      },
      accuse: (from, target) => (s as unknown as { society: { accuse(a: Person, b: Person): void } | null }).society?.accuse(from, target),
      title: (p) => (p.estate === 'knight' ? 'title.sir' : p.estate === 'noble' && this.headOf(p.household) === p ? 'title.lord' : null),
      skillCategory: (sk) => ((s.data.skills as { skills?: Record<string, { category?: string }> } | null)?.skills?.[sk]?.category ?? null),
      houseValue: (hh) => {
        if (this.householdEstate(hh) === 'serf' || this.householdEstate(hh) === 'clergy') return 0;
        const t = s.town;
        if (!t) return 0;
        for (const [lot, h] of t.lotHousehold) if (h === hh) return Math.floor((t.lot(lot)?.price ?? 0) / 4);
        return 0;
      },
      spend: (hh, amount, reason) => this.spendF(hh, amount * 4, reason),
      priestAvailable: () => this.persons().some((q) => q.role === 'priest' || q.career?.id === 'priest'),
      scene: (kind, args, subjects) => {
        const p = subjects.find((q) => q.household === 1);
        if (p) s.notice(p, `scene_${kind}`, args);
      },
      chooseControlled: (_clanId, candidates) => {
        const p = candidates[0];
        if (p) s.notice(p, 'choose_controlled', { n: candidates.length });
      },
      splitHousehold: (list, reason) => {
        if (!list.length) return -1;
        const hh = s.newHouseholdId();
        const lot = s.town ? s.freeLot('small') : null;
        const est = this.householdEstate(list[0].household);
        for (const p of list) s.moveHousehold(p, hh, lot);
        this.hhEstate.set(hh, est);
        this.estates.branch(list[0], hh, list);
        s.townNews('new_house', { a: list[0].name, b: list[1]?.name ?? list[0].name }, list);
        void reason;
        return hh;
      },
      // 가보 (16-5)
      defIdOf: (ref) => (ref.kind === 'object' ? s.world.byUid.get(ref.uid)?.defId ?? null : ref.itemId),
      valueOf: (ref) => this.valueOf(ref),
      detach: (ref) => {
        if (ref.kind === 'object') s.world.removeObject(ref.uid);
        else if (ref.household === 1) s.world.stock[ref.itemId] = Math.max(0, (s.world.stock[ref.itemId] ?? 0) - 1);
      },
      attach: (h, hh) => this.attachHeirloom(h, hh),
      setDamaged: (ref, dmg) => {
        if (ref.kind !== 'object') return;
        const o = s.world.byUid.get(ref.uid);
        if (o) (o.state as Record<string, unknown>).damaged = dmg ? 1 : 0;
      },
      addMoney: (hh, amount, reason) => this.earnF(hh, amount * 4, reason),
      // 하인 (16-7)
      householdSize: (hh) => this.members(hh).length,
      createServant: (role, hh) => this.createServant(role, hh),
      removeServant: (p) => s.killPerson(p, 'moved_away'),
    };
  }

  private valueOf(ref: HeirloomRef): number {
    const s = this.s;
    const defId = ref.kind === 'object' ? s.world.byUid.get(ref.uid)?.defId : ref.itemId;
    if (!defId) return 0;
    const price = s.data.objects[defId] ? (s.world.def(defId) as { price?: number }).price : undefined;
    if (price) return Math.floor(price / 4);
    const it = (s.data.items as { items?: Record<string, { base?: number }> } | null)?.items?.[defId];
    return it?.base ? Math.floor(it.base / 4) : 10;
  }

  private attachHeirloom(h: Heirloom, hh: number): HeirloomRef | null {
    const s = this.s;
    const defId = h.defId;
    // 같은 가구에 월드 물건이 그대로 있으면 그 참조
    if (h.ref.kind === 'object' && s.world.byUid.has(h.ref.uid) && hh === 1) return h.ref;
    if (!defId) return null;
    if (hh === 1) s.world.stock[defId] = (s.world.stock[defId] ?? 0) + 1;
    return { kind: 'item', itemId: defId, household: hh, seq: h.id };
  }

  /** 하인 NPC (17-2 역할 직업): 이 가구에 사는 어른 */
  private createServant(role: ServantRole, hh: number): Person | null {
    const s = this.s;
    const host = this.members(hh)[0];
    const sex: 'male' | 'female' = role === 'maid' || role === 'nurse' ? 'female' : role === 'guard' || role === 'groom' ? 'male' : this.rng.next() < 0.5 ? 'male' : 'female';
    const g = s.genetics;
    const name = g ? randomMember(g, s.names, this.rng, { key: 'sv', estate: 'freeman', sex, stage: 'adult', servant: true }).name : `${role}`;
    const p = s.addPerson(name || role, host?.x, host?.y, { estate: 'freeman', sex, stage: 'adult', household: hh });
    p.lifeStage = 'adult';
    p.ageDays = 0;
    p.homeLot = host?.homeLot ?? null;
    p.role = role;
    p.appearance = { town: `servant_${p.id}`, seed: (p.id * 2654435761) >>> 0, sex, stage: 'adult', estate: 'freeman', servant: role };
    if (hh !== 1) p.lod = 'summary';
    for (const q of this.members(hh)) if (q !== p) s.rel.ensure(p.id, q.id).met = true;
    return p;
  }

  // ================================================================== E 창구 (파딩)

  private estatesHost(): EstatesHost<Person> {
    const s = this.s;
    return {
      persons: () => this.persons(),
      headOf: (hh) => this.headOf(hh),
      householdEstate: (hh) => this.householdEstate(hh),
      age: (p) => this.age(p),
      rng: this.rng,
      day: () => this.day(),
      lifespan: () => s.settings.lifespan,
      seasonDays: () => this.seasonDays(),
      savings: (e) => this.savingsS(e),
      money: (hh) => this.farthings(hh),
      spend: (hh, amount, reason) => this.spendF(hh, amount, reason),
      setPersonEstate: (p, e) => {
        p.estate = e;
      },
      setHouseholdEstate: (hh, e) => {
        this.hhEstate.set(hh, e);
        const a = s.econ?.account(hh);
        if (a) a.estate = e;
      },
      fame: (hh, delta, reason, by) => this.fame(hh, delta, reason, by ?? null),
      fameTier: (hh) => this.fameTier(hh),
      lordFavor: (hh) => s.lordFavor.get(hh) ?? 0,
      addLordFavor: (hh, d) => s.lordFavor.set(hh, (s.lordFavor.get(hh) ?? 0) + d),
      skill: (p, id) => s.skills?.level(p, id) ?? 0,
      isSquire: (p) => p.role === 'squire',
      hasFeat: (p) => this.feats.has(p.id),
      moodlet: (p, id) => this.moodlet(p, id),
      chronicle: (trigger, subjects) => this.chronicle(trigger, subjects),
      news: (kind, args, subjects) => s.townNews(kind, args, subjects),
      notice: (p, kind, args) => s.notice(p, kind, args),
      offerCard: (p, cardId, vars) => s.offerCard(p, cardId, vars ?? {}),
      onEstateChanged: (p, from, to, reason) => {
        // 차림은 새 신분 기본으로 (올라간 경우). 내려간 경우 옛 차림이 남아 1계절 유예 뒤 사치 금지법에 걸릴 수 있음
        if (this.estates.rank(to) > this.estates.rank(from)) this.dress.delete(p.id);
        (p.appearance as Record<string, unknown>).estate = to;
        s.inner?.invalidate(p);
        if (p.household === 1) s.notice(p, 'estate_changed', { from: `estate.${from}`, to: `estate.${to}`, reason: `estate.rule.${reason}` });
        this.moodlet(p, this.estates.rank(to) > this.estates.rank(from) ? 'estate_risen' : 'estate_fallen');
      },
      onHouseholdEstateChanged: (hh, _from, to) => {
        const a = s.econ?.account(hh);
        if (a) a.estate = to;
      },
      needsFamilyName: (hh) => {
        const cl = this.house.clans.clanOfHousehold(hh);
        const head = this.headOf(hh);
        if (hh === 1 && head) s.offerCard(head, 'family_name_choice');
        else if (cl) {
          const pool = (s.data.family?.clanNames as { names?: string[] } | undefined)?.names ?? [];
          const name = pool.length ? pool[Math.floor(this.rng.next() * pool.length)] : `house.h${hh}`;
          this.house.clans.grantFamilyName(cl.id, name);
        }
      },
      changeSurname: (p, toHh) => {
        const cl = this.house.clans.clanOfHousehold(toHh);
        if (cl) this.house.clans.touchRecord(p);
      },
      confiscate: (hh) => {
        this.house.heirlooms.onConfiscation(hh);
        const a = s.econ?.account(hh);
        if (a && a.money > 0) s.econ!.spend(a, Math.floor(a.money / 2), 'confiscation');
      },
      punish: (p, kind) => {
        this.fame(p.household, -20, kind, p);
        if (p.household === 1) s.notice(p, 'punished', { kind: `punish.${kind}` });
      },
      leaveVillage: (p) => {
        this.awayFlight.add(p.id);
        p.hidden = true;
        p.lod = 'summary';
      },
      returnToVillage: (p) => {
        this.awayFlight.delete(p.id);
        p.hidden = false;
      },
      respectFrom: (p, estate, delta) => {
        for (const q of this.persons()) if (q.estate === estate && q !== p) s.rel.addRespect(q.id, p.id, delta);
      },
    };
  }

  private fiefHost(): FiefHost {
    const s = this.s;
    return {
      rng: this.rng,
      seasonDays: () => this.seasonDays(),
      lifespan: () => s.settings.lifespan,
      season: (day) => {
        const cal = (s.data.economy as { calendar?: { seasonDays: number; seasons: string[] } } | null)?.calendar;
        return cal ? cal.seasons[Math.floor(day / cal.seasonDays) % cal.seasons.length] : 'spring';
      },
      householdEstate: (hh) => this.householdEstate(hh),
      earn: (hh, amount, kind) => this.earnF(hh, amount, kind, true),
      addStock: (hh, item, n) => {
        if (hh === 1) s.world.stock[item] = (s.world.stock[item] ?? 0) + n;
      },
      feesToday: () => this.feesToday,
      finesToday: () => this.finesToday,
      fame: (hh, delta, reason) => this.fame(hh, delta, reason, null),
      morale: (delta) => {
        this.house.honor.addMorale(delta);
      },
      rumor: (hh, kind) => {
        const h = this.headOf(hh);
        if (h) this.rumor(h, kind, false, 1);
      },
      notice: (hh, kind, args) => {
        const h = this.headOf(hh);
        if (h) s.notice(h, kind, args);
      },
      houseTier: (hh) => {
        const t = s.town;
        if (!t) return 1;
        if (t.householdResidence.get(hh) === 'castle') return 5;
        for (const [lot, h] of t.lotHousehold) if (h === hh) return HOUSE_TIER[t.lot(lot)?.size ?? 'small'] ?? 1;
        return 0;
      },
      lastFeastDay: (hh) => this.lastFeast.get(hh) ?? -Infinity,
      bestOutfitTier: (hh) => {
        let best = 0;
        for (const p of this.members(hh)) {
          if (!this.sumptuary) break;
          for (const w of this.worn(p)) if (w.category === 'cloth' || w.category === 'dye') best = Math.max(best, tierIndex(this.sumptuary.d, (this.sumptuary.d.items[w.category] as Record<string, string>)[w.id] ?? 'serf'));
        }
        return best;
      },
      tierIndex: (tier) => (this.sumptuary ? tierIndex(this.sumptuary.d, tier) : 0),
      moodletHousehold: (hh, id) => {
        for (const p of this.members(hh)) this.moodlet(p, id);
      },
    };
  }

  /** 지금 차림: 기록이 없으면 개인 신분 등급의 기본 옷감·염료 */
  worn(p: Person): WornItem[] {
    const d = this.sumptuary?.d;
    if (!d) return [];
    let dr = this.dress.get(p.id);
    if (!dr) {
      const tier = d.tiers[estateTier(d, p.estate)] ?? 'serf';
      const pick = (cat: 'cloth' | 'dye') => Object.entries(d.items[cat] as Record<string, string>).find(([k, v]) => !k.startsWith('$') && v === tier)?.[0] ?? '';
      dr = { cloth: pick('cloth'), dye: pick('dye') };
    }
    const out: WornItem[] = [];
    if (dr.cloth) out.push({ category: 'cloth', id: dr.cloth });
    if (dr.dye) out.push({ category: 'dye', id: dr.dye });
    const livery = this.house.servants.livery(p);
    if (livery) for (const w of out) w.livery = livery.masterEstate;
    return out;
  }

  private sumptuaryHost(): SumptuaryHost<Person> {
    const s = this.s;
    return {
      rng: this.rng,
      day: () => this.day(),
      minute: () => s.world.minute,
      seasonDays: () => this.seasonDays(),
      lifespan: () => s.settings.lifespan,
      rulesOff: () => !!(s.settings as { estateRulesOff?: boolean }).estateRulesOff,
      isCarnival: () => false,
      candidates: () => this.persons().filter((q) => !q.hidden && !q.infant && (q.household === 1 || q.lod !== 'summary')),
      inPublic: (p) => !!s.town && !s.town.atHome(p),
      worn: (p) => this.worn(p),
      weddingToday: (p) => p.marriedDay === this.day(),
      lastFall: (p) => this.estates.lastFall(p),
      watched: (p, roles) => this.persons().some((q) => q !== p && q.role !== null && roles.includes(q.role) && !q.hidden && Math.hypot(q.x - p.x, q.y - p.y) < 8),
      fameTier: (hh) => this.fameTier(hh),
      fine: (hh, amount, reason) => {
        this.spendF(hh, amount, reason, true);
        this.finesToday += amount;
      },
      fame: (hh, delta, reason, by) => this.fame(hh, delta, reason, by ?? null),
      moodlet: (p, id) => this.moodlet(p, id),
      confiscate: (p, item) => {
        // 몰수: 그 차림을 신분 기본으로 되돌림
        const dr = this.dress.get(p.id);
        if (dr && (item.category === 'cloth' || item.category === 'dye')) {
          this.dress.set(p.id, { ...dr, [item.category]: '' });
          if (!this.dress.get(p.id)!.cloth && !this.dress.get(p.id)!.dye) this.dress.delete(p.id);
        }
      },
      notice: (p, kind, args) => s.notice(p, kind, args),
      rumor: (p, kind) => this.rumor(p, kind, false, 1),
    };
  }

  // ================================================================== 명성 (16-4)

  fame(hh: number, delta: number, reason: string, by: Person | null = null): void {
    if (!delta) return;
    this.house.honor.addFameHousehold(hh, delta, reason, by);
    const s = this.s;
    s.fame.set(hh, (s.fame.get(hh) ?? 0) + delta);
  }

  fameOf(hh: number): number {
    return this.house.clans.fameOfHousehold(hh);
  }

  fameTier(hh: number): string {
    return this.house.clans.tierOf(this.fameOf(hh));
  }

  // ================================================================== 훅

  /** 자정 (새 날, day = 방금 시작한 날) */
  daily(day: number): void {
    // NPC 귀족·기사 가문은 연회를 스스로 엶 (16-2 사치 요구, 조작 가문은 혼례·잔치 상호작용·의도로)
    const every = 7;
    for (const [hh, est] of this.hhEstate) if (hh !== 1 && (est === 'noble' || est === 'knight') && day - (this.lastFeast.get(hh) ?? -99) >= every) this.lastFeast.set(hh, day);
    this.estates.daily();
    if (this.fief) this.fief.daily(day - 1);
    this.finesToday = 0;
    this.feesToday = 0;
    const s = this.s;
    this.house.daily((clanId) => this.house.clans.members(clanId).some((p) => (s.econ?.account(p.household)?.money ?? 1) < 0));
    // 하인 이벤트 결과 (주급 못 냄 → 그만둠 등)는 모듈이 처리. 조작 가문 가장이 없으면 가문 가장을 다시 고름
  }

  /** 매 게임 1시간 */
  hourly(): void {
    this.sumptuary?.hourly();
  }

  /** 출생 (15-2 + 16-2 자녀 신분): 가정 대표 신분, 사생아 */
  onBirth(baby: Person, mother: Person, father: Person | null, bastard?: boolean): void {
    const illegitimate = bastard ?? (!!father && mother.spouse !== father.id);
    const r = this.estates.born(baby, mother, father, { illegitimate });
    baby.estate = r.estate;
    (baby.appearance as Record<string, unknown>).estate = r.estate;
    this.house.clans.onBirth(baby, illegitimate || r.scandal);
    if (r.scandal) this.rumor(mother, 'bastard', false, 1);
  }

  /** 사망 (목록에서 빼기 전): 가계도, 하인, 가장이면 상속 전체 */
  onDeath(p: Person, cause: string): void {
    if (this.house.servants.isServant(p)) this.house.servants.forget(p);
    if (cause === 'moved_away') {
      // 추방·이주로 떠난 가장: 승계 순서의 다음 사람이 가장 (장례·유언은 없음)
      const cl = this.house.clans.clanOf(p);
      if (cl && cl.headId === p.id) {
        const next = this.house.inheritance.successionOrder(cl.id, p).find((q) => q !== p && this.s.persons.includes(q));
        this.house.clans.setHead(cl.id, next ?? null);
      }
      return;
    }
    this.house.inheritance.onDeath(p, cause);
  }

  /** 판정기 분가 (인원 상한 신혼부부): 새 가구도 같은 가문, 신분 유지 */
  onSplit(fromHh: number, newHh: number): void {
    this.hhEstate.set(newHh, this.householdEstate(fromHh));
    this.house.clans.onHouseholdSplit(fromHh, newHh);
  }

  /** 카드 선택 뒤 (상속 분쟁의 의절, 가문명 고르기) */
  onCard(p: Person, cardId: string, option: number, _ok: boolean, other: Person | null): void {
    if (cardId === 'inheritance_dispute' && other) {
      const cl = this.house.clans.clanOf(p);
      const heir = (cl && this.house.clans.head(cl.id)) ?? p;
      this.house.inheritance.onDisputeResolved(option, heir, other === heir ? p : other);
    } else if (cardId === 'family_name_choice') {
      const cl = this.house.clans.clanOfHousehold(p.household);
      const pool = (this.s.data.family?.clanNames as { names?: string[] } | undefined)?.names ?? [];
      if (cl && !cl.name && pool.length) this.house.clans.grantFamilyName(cl.id, pool[(option * 7 + p.id * 13 + this.day()) % pool.length]);
    }
  }

  /** 가보 값 (동화) */
  heirloomValue(h: Heirloom): number {
    return this.valueOf(h.ref);
  }

  /** 혼인 (판정기·혼례): 신분 두 층 규칙, 가문 동맹 */
  onMarried(partner: Person, incoming: Person): void {
    this.estates.marry(partner, incoming, {});
    this.house.clans.onMarriage(partner, incoming);
  }

  /** 파산 알림 → 한 단계 하락 (16-3), 가보 압류 */
  onBankrupt(hh: number): void {
    this.estates.bankruptcyFall(hh);
    this.house.heirlooms.onSeizure(hh);
  }

  /** 가을 세금 → 영주 금고 (18-4) */
  onTaxPaid(amount: number): void {
    this.fief?.depositTax(amount);
  }

  /** 스킬 경험치 배수 (가문 보상 + 가보 사용) */
  skillXpMult(p: Person, skill: string): number {
    return this.house.clans.skillXpMult(p, skill);
  }

  flags(p: Person): Set<string> {
    const f = this.house.flags(p);
    if (this.house.clans.clanOf(p)) f.add(`fame_${this.fameTier(p.household)}`);
    f.add(`estate_${p.estate}`);
    return f;
  }

  // ================================================================== 프리셋 (16-2, 29-1)

  presetList(): string[] {
    return this.presets ? presetIds(this.presets) : [];
  }

  /** 프리셋 적용. custom = 캐릭터 만들기 사양과 식구별 역할(head spouse child sibling sibling_spouse nephew …): 무작위 식구 대신 이 식구로 */
  applyPreset(id: string, custom: { family: FamilySpec; roles: string[] } | null = null, lot: string | null = null): PresetResult | null {
    if (!this.presets) return null;
    this.custom = custom;
    this.startLot = lot && this.startLotOk(id, lot) ? lot : null;
    const r = applyPreset(this.presetHost(), this.presets, id);
    this.custom = null;
    if (r.ok && this.startLot) {
      // 고른 집 (심즈식 집 구매): 소유면 집 예산을 받고 집값을 냄 (남으면 현금, 모자라면 빚). 영주·교회 집은 값 없음
      const t = this.s.town!;
      const l = t.lot(this.startLot)!;
      const price = r.house.tenure === 'owned' ? l.price : 0;
      if (price) {
        const budget = this.houseBudget(r.house.kind);
        if (budget) this.earnF(r.household, budget, 'start');
        this.spendF(r.household, price, 'house', true);
      }
      r.house.lot = l.id;
      r.house.price = price;
    }
    this.startLot = null;
    this.lastPreset = r;
    return r;
  }

  /** 새 게임에서 고른 집 (applyPreset 동안만) */
  private startLot: string | null = null;

  /** 시작 집 예산 (파딩, start_presets.json houseBudget): 집 종류별 */
  houseBudget(kind: string): number {
    return ((this.presets as { houseBudget?: Record<string, number> } | null)?.houseBudget ?? {})[kind] ?? 0;
  }

  /** 시작할 때 고를 수 있는 집 (빈 집, 길 있음, 사는 곳이 따로 없는 신분). 영주 땅 농노는 작은 집만 */
  startLotOk(presetId: string, lotId: string): boolean {
    const t = this.s.town;
    const r = this.presets ? resolvePreset(this.presets, presetId) : null;
    const l = t?.lot(lotId);
    const owner = t?.lotHousehold.get(lotId);
    if (!t || !r || !l || l.kind !== 'residential' || (owner !== undefined && owner !== 1) || t.sealed.has(lotId)) return false;
    if (RESIDENCE[r.assets.house.kind]) return false;
    if (r.assets.house.tenure === 'lord' && l.size !== 'small') return false;
    return true;
  }

  private presetHost(): PresetHost {
    const s = this.s;
    return {
      rng: this.rng,
      lifespan: () => s.settings.lifespan,
      savings: (e) => this.savingsS(e),
      createHousehold: (estate, specs) => this.createPresetFamily(estate, specs),
      setHouseholdEstate: (hh, e) => {
        this.hhEstate.set(hh, e);
        const a = s.econ?.account(hh);
        if (a) a.estate = e;
      },
      grant: (hh, amount, reason) => this.earnF(hh, amount, reason),
      borrow: (hh, amount, termDays, lender) => {
        const a = s.econ?.account(hh);
        if (a) s.econ!.borrow(a, amount, lender, termDays, this.day());
      },
      setFame: (hh, v) => {
        const cl = this.house.clans.clanOfHousehold(hh);
        if (cl) this.house.clans.setFame(cl.id, v);
      },
      assignHouse: (hh, kind, tenure) => this.assignHouse(hh, kind, tenure),
      setCareer: (id, career) => {
        const p = s.persons.find((q) => q.id === id);
        return !!p && s.setCareer(p, career, true).ok;
      },
      addPlots: (hh, n) => this.addPlots(hh, n),
      addAnimals: (hh, kind, n) => {
        // 가축 체계(22장, M12) 전: 말은 이동 수단으로 (Person.horse), 나머지는 살림 재고로 기록
        const adults = this.members(hh).filter((q) => q.lifeStage === 'young' || q.lifeStage === 'adult');
        if (kind === 'horse' || kind === 'warhorse') for (let i = 0; i < n && i < adults.length; i++) adults[i].horse = i;
        else if (hh === 1) s.world.stock[`animal_${kind}`] = (s.world.stock[`animal_${kind}`] ?? 0) + n;
      },
      addItems: (hh, item, n) => {
        if (hh === 1) s.world.stock[item] = (s.world.stock[item] ?? 0) + n;
      },
      grantTools: (hh, careerId) => {
        if (hh === 1) s.world.stock[`tools_${careerId}`] = (s.world.stock[`tools_${careerId}`] ?? 0) + 1;
      },
      grantGuild: (id, craft) => {
        const p = s.persons.find((q) => q.id === id);
        if (p) this.estates.grantGuild(p, craft);
      },
      addApprentice: (hh) => {
        const c = s.createChild('teen', 'freeman', hh);
        if (c) c.role = 'apprentice';
      },
      addSquire: (hh) => {
        const c = s.createChild('teen', 'freeman', hh);
        if (c) c.role = 'squire';
      },
      hireServant: (hh, role) => !!this.house.servants.hire(hh, role as ServantRole).ok,
      grantFief: (hh, spec) => {
        this.fief?.grant(hh, spec);
      },
    };
  }

  private custom: { family: FamilySpec; roles: string[] } | null = null;

  /** 캐릭터 만들기 사양으로 가족을 만들고, 프리셋 역할 순서에 맞춘 인물 id (직업·도제·말·하인을 그 식구에게) */
  private createCustomFamily(estate: EstateId, specs: PresetPersonSpec[], c: { family: FamilySpec; roles: string[] }): { household: number; ids: number[] } {
    const s = this.s;
    const r = s.createFamily({ ...c.family, estate });
    const made = r.ok ? r.ids ?? [] : [];
    if (!made.length) {
      // 사양이 검증에 걸리면 무작위 식구로 (시작이 막히지 않게)
      this.custom = null;
      return this.createPresetFamily(estate, specs);
    }
    const used = new Set<number>();
    const norm = (role: string) => (role === 'nephew' ? 'child' : role);
    const ids = specs.map((sp) => {
      let i = c.roles.findIndex((role, k) => !used.has(k) && norm(role) === sp.role && made[k] !== undefined);
      if (i < 0) i = c.roles.findIndex((role, k) => !used.has(k) && made[k] !== undefined && role !== 'servant');
      if (i < 0) return made[0] ?? 0;
      used.add(i);
      return made[i];
    });
    this.resetAccount(estate);
    const hi = specs.findIndex((x) => x.role === 'head');
    const cl = this.house.clans.clanOfHousehold(1);
    if (cl) this.house.clans.onHouseholdGone(1);
    this.house.clans.register({ households: [1], name: null, estate, headId: ids[hi >= 0 ? hi : 0] });
    return { household: 1, ids };
  }

  private resetAccount(estate: EstateId): void {
    const a = this.s.econ?.account(1);
    if (a) {
      a.money = 0;
      a.loans = [];
      a.estate = estate;
      a.reliefDays = 0;
    }
    this.hhEstate.set(1, estate);
  }

  /** 프리셋 가족 → 캐릭터 만들기 사양 (무작위 외형) → Simulation.createFamily. 계정은 돈 0·빚 없이 */
  private createPresetFamily(estate: EstateId, specs: PresetPersonSpec[]): { household: number; ids: number[] } {
    const s = this.s;
    if (this.custom) return this.createCustomFamily(estate, specs, this.custom);
    const g = s.genetics;
    if (!g) return { household: 1, ids: [] };
    const taken: string[] = [];
    const members = specs.map((sp, i) => {
      const m = randomMember(g, s.names, this.rng, { key: `m${i}`, estate: sp.estate, sex: sp.sex, stage: sp.stage, householdEstate: estate, takenNames: taken });
      m.age = sp.displayAge;
      taken.push(m.name);
      return m;
    });
    const rel: RelSpec[] = [];
    const idx = (role: string) => specs.findIndex((x) => x.role === role);
    const head = idx('head');
    const spouse = idx('spouse');
    const sib = idx('sibling');
    const sibSp = idx('sibling_spouse');
    if (head >= 0 && spouse >= 0) rel.push({ a: `m${head}`, b: `m${spouse}`, kind: 'spouse' });
    if (sib >= 0 && sibSp >= 0) rel.push({ a: `m${sib}`, b: `m${sibSp}`, kind: 'spouse' });
    if (head >= 0 && sib >= 0) rel.push({ a: `m${head}`, b: `m${sib}`, kind: 'sibling' });
    specs.forEach((sp, i) => {
      if (sp.role !== 'child') return;
      // 성직자 가족: 아이는 형제 부부의 자녀
      const [pa, pb] = spouse >= 0 ? [head, spouse] : [sib, sibSp];
      if (pa >= 0) rel.push({ a: `m${pa}`, b: `m${i}`, kind: 'parent' });
      if (pb >= 0) rel.push({ a: `m${pb}`, b: `m${i}`, kind: 'parent' });
    });
    // 부모와 아이 나이 차 (만들기 검증 parentGapMin 16): 프리셋 아동 나이를 부모 나이에 맞춤
    for (const r of rel) if (r.kind === 'parent') {
      const pa = members.find((m) => m.key === r.a)!;
      const ch = members.find((m) => m.key === r.b)!;
      if ((pa.age ?? 30) - (ch.age ?? 0) < 16) ch.age = Math.max(4, (pa.age ?? 30) - 16);
    }
    const spec: FamilySpec = { v: 1, clan: null, estate, members, relations: rel };
    const r = s.createFamily(spec);
    const ids = r.ok ? r.ids ?? [] : [];
    // 계정: 새로 (돈 0, 빚 없음). 프리셋이 현금/빚을 줌
    const e = s.econ;
    const a = e?.account(1);
    if (a) {
      a.money = 0;
      a.loans = [];
      a.estate = estate;
      a.reliefDays = 0;
    }
    this.hhEstate.set(1, estate);
    // 가문: 조작 가문 가문을 새로 (옛 조작 가문과 이어지지 않음)
    const cl = this.house.clans.clanOfHousehold(1);
    if (cl) this.house.clans.onHouseholdGone(1);
    this.house.clans.register({ households: [1], name: null, estate, headId: ids[head >= 0 ? head : 0] });
    return { household: 1, ids };
  }

  /** 집 배정: 종류 → 부지 크기 (없으면 작은 부지), 사제관·수도원 방은 그 장소에 삶 */
  private assignHouse(hh: number, kind: string, tenure: string): boolean {
    const s = this.s;
    const t = s.town;
    if (!t) return true;
    const mem = this.members(hh);
    const res = RESIDENCE[kind];
    let lotId: string | null = null;
    if (!res && this.startLot) lotId = this.startLot;
    if (!res) {
      const cur = [...t.lotHousehold].find(([, h]) => h === hh)?.[0] ?? null;
      const want = LOT_SIZE[kind] ?? ['small'];
      if (!lotId && cur && want[0] === t.lot(cur)?.size) lotId = cur;
      for (const size of want) {
        if (lotId) break;
        lotId = [...t.lots].find((l) => l.size === size && !t.lotHousehold.has(l.id) && !t.sealed.has(l.id))?.id ?? null;
      }
      if (!lotId) lotId = cur;
      if (!lotId) return false;
      for (const [l, h] of [...t.lotHousehold]) if (h === hh && l !== lotId) t.lotHousehold.delete(l);
      t.lotHousehold.set(lotId, hh);
      t.householdResidence.delete(hh);
      if (hh === 1 && s.builder) s.builder.area = [...t.lot(lotId)!.rect];
    } else {
      for (const [l, h] of [...t.lotHousehold]) if (h === hh) t.lotHousehold.delete(l);
      t.householdResidence.set(hh, res);
    }
    const gw = s.world.grid.w;
    for (const p of mem) {
      p.homeLot = lotId;
      const c = t.targetCell(p, 'home');
      if (c >= 0) {
        p.x = (c % gw) + 0.5;
        p.y = Math.floor(c / gw) + 0.5;
      }
    }
    void tenure;
    return true;
  }

  /** 밭 구획 (field_plot 물건)을 부지 빈 땅에 놓음 (31-1: 밭 = 물건 1개) */
  private addPlots(hh: number, n: number): void {
    const s = this.s;
    const t = s.town;
    const b = s.builder;
    const lotId = t ? [...t.lotHousehold].find(([, h]) => h === hh)?.[0] : null;
    const rect = lotId && t ? t.lot(lotId)!.rect : b?.area ?? null;
    if (!rect || !b) return;
    let placed = 0;
    for (let y = rect[1]; y <= rect[3] - 2 && placed < n; y++) {
      for (let x = rect[0]; x <= rect[2] - 3 && placed < n; x++) {
        if (b.canPlace('field_plot', x, y, 0) !== null) continue;
        s.world.addObject('field_plot', x, y, 0);
        placed++;
        x += 3;
      }
    }
    if (placed < n && hh === 1) s.world.stock.rented_plots = (s.world.stock.rented_plots ?? 0) + (n - placed);
  }

  // ================================================================== 의도 (M8)

  intent(op: string, a: Record<string, unknown>): { ok: boolean; reason?: string; result?: unknown } {
    const s = this.s;
    const P = (k = 'personId') => s.persons.find((q) => q.id === Number(a[k]));
    const hh = Number(a.household ?? 1);
    const E = this.estates;
    const H = this.house;
    const plan = (r: { ok: boolean; reason?: string }) => ({ ok: r.ok, reason: r.reason, result: r });
    const clanId = H.clans.clanIdOfHousehold(hh);
    switch (op) {
      case 'applyPreset': {
        const fam = a.family as FamilySpec | undefined;
        const r = this.applyPreset(String(a.preset), fam ? { family: fam, roles: (a.roles as string[]) ?? [] } : null, a.lot ? String(a.lot) : null);
        return r ? { ok: r.ok, reason: r.reason, result: r } : { ok: false, reason: 'no_presets' };
      }
      case 'payEmancipation':
        return plan(E.payEmancipation(hh));
      case 'startFlight': {
        const p = P();
        return p ? plan(E.startFlight(p)) : { ok: false };
      }
      case 'lordGrace':
        return plan(E.lordGrace(hh));
      case 'startApprenticeship': {
        const p = P();
        return p ? plan(E.startApprenticeship(p, String(a.craft))) : { ok: false };
      }
      case 'submitMasterpiece': {
        const p = P();
        return p ? plan(E.submitMasterpiece(p, Number(a.quality ?? 0))) : { ok: false };
      }
      case 'joinGuild': {
        const p = P();
        return p ? plan(E.joinGuild(p)) : { ok: false };
      }
      case 'becomeMerchant': {
        const p = P();
        return p ? plan(E.becomeMerchant(p)) : { ok: false };
      }
      case 'knight': {
        const p = P();
        return p ? plan(E.knight(p)) : { ok: false };
      }
      case 'buyTitle':
        return plan(E.buyTitle(hh));
      case 'takeVows': {
        const p = P();
        return p ? plan(E.takeVows(p)) : { ok: false };
      }
      case 'setDress': {
        const p = P();
        if (!p) return { ok: false };
        this.dress.set(p.id, { cloth: String(a.cloth ?? ''), dye: String(a.dye ?? '') });
        return { ok: true };
      }
      case 'designateHeirloom': {
        const ref: HeirloomRef = a.uid !== undefined ? { kind: 'object', uid: Number(a.uid) } : H.heirlooms.itemRef(String(a.itemId), hh);
        const r = H.heirlooms.designate(clanId, ref, P() ?? null, hh);
        return { ok: r.ok, reason: r.reason, result: r.heirloom?.id };
      }
      case 'undesignateHeirloom':
        return { ok: H.heirlooms.undesignate(Number(a.id), P() ?? null) };
      case 'renameHeirloom':
        return { ok: H.heirlooms.rename(Number(a.id), a.name === null ? null : String(a.name)) };
      case 'assignHeirloomHeir':
        return { ok: H.heirlooms.assignHeir(Number(a.id), P('heirId') ?? null) };
      case 'repairHeirloom':
        return H.heirlooms.repair(Number(a.id), P() ?? null);
      case 'sellHeirloom':
        return { ok: H.heirlooms.sell(Number(a.id), P() ?? null, Number(a.price ?? 0)) };
      case 'writeWill': {
        const p = P();
        if (!p) return { ok: false };
        const r = H.inheritance.writeWill(p, { heir: Number(a.heir), heirloomsTo: a.heirloomsTo !== undefined ? Number(a.heirloomsTo) : undefined });
        return { ok: r.ok, reason: r.reason };
      }
      case 'setInheritanceLaw':
        return H.clans.setLaw(clanId, String(a.law) as InheritanceLaw, (a.opts ?? {}) as Record<string, never>);
      case 'setHead':
        return { ok: H.clans.setHead(clanId, P() ?? null) };
      case 'setMotto':
        return H.clans.setMotto(clanId, a.text === null ? null : String(a.text), (a.tags as string[]) ?? []);
      case 'setHeraldry': {
        const cat = heraldryCatalog(s.data.family?.heraldry);
        return H.clans.setHeraldry(clanId, a.spec as HeraldrySpec, cat ?? undefined);
      }
      case 'hireServant': {
        const r = H.servants.hire(hh, String(a.role) as ServantRole);
        return { ok: r.ok, reason: r.reason };
      }
      case 'dismissServant':
        return { ok: H.servants.dismiss(Number(a.personId)) };
      case 'grantFamilyName':
        return { ok: H.clans.grantFamilyName(clanId, String(a.name)) };
      case 'setClanName': {
        // 새 게임 가문명: 무드렛·소식·연대기 없이 조용히 (농노는 가문명 없음 16-1)
        const cl = H.clans.clan(clanId);
        if (!cl || this.householdEstate(hh) === 'serf') return { ok: false, reason: 'reason.estate.serf_no_name' };
        cl.name = String(a.name).slice(0, 20);
        return { ok: true };
      }
      case 'holdFeast': {
        this.lastFeast.set(hh, this.day());
        return { ok: true };
      }
      default:
        return { ok: false, reason: 'unknown' };
    }
  }

  /** 수첩·화면용 요약 (가문 명성·단계·가장·가훈·문장·신분·영지·하인·가보) */
  summary(hh = 1): Record<string, unknown> {
    const H = this.house;
    const cl = H.clans.clanOfHousehold(hh);
    return {
      clan: cl ? { id: cl.id, name: cl.name, fame: cl.fame, tier: H.clans.tier(cl.id), motto: cl.motto, heraldry: cl.heraldry, law: cl.law, head: cl.headId } : null,
      estate: this.householdEstate(hh),
      fief: this.fief?.get(hh) ?? null,
      treasury: this.fief?.treasury.money ?? 0,
      servants: H.servants.of(hh).map((sv) => ({ id: sv.personId, role: sv.role, loyalty: sv.loyalty })),
      heirlooms: cl ? H.heirlooms.held(cl.id).map((h) => ({ id: h.id, defId: h.defId, name: h.customName, status: h.status, damaged: h.damaged })) : [],
      lostHeirlooms: cl ? H.heirlooms.lost(cl.id).map((h) => h.id) : [],
    };
  }

  hashParts(parts: (string | number)[]): void {
    const H = this.house;
    for (const hh of [...this.hhEstate.keys()].sort((a, b) => a - b)) {
      const cl = H.clans.clanOfHousehold(hh);
      if (cl) parts.push(hh, cl.id, cl.fame, cl.headId, cl.law, cl.motto ?? '-', cl.name ?? '-');
      if (cl) for (const h of H.heirlooms.held(cl.id)) parts.push(h.id, h.status, h.damaged ?? '-', h.household);
      for (const sv of H.servants.of(hh)) parts.push(sv.personId, sv.role, Math.round(sv.loyalty * 100));
    }
    parts.push(Math.round(H.honor.morale * 100));
    for (const [id, d] of [...this.dress].sort((a, b) => a[0] - b[0])) parts.push(id, d.cloth, d.dye);
    for (const [hh, d] of [...this.lastFeast].sort((a, b) => a[0] - b[0])) parts.push(hh, d);
    parts.push([...this.feats].sort((a, b) => a - b).join(','), [...this.awayFlight].sort((a, b) => a - b).join(','));
    this.estates.hashParts(parts);
    this.fief?.hashParts(parts);
    this.sumptuary?.hashParts(parts);
    for (const [hh, e] of [...this.hhEstate].sort((x, y) => x[0] - y[0])) parts.push(hh, e);
    for (const p of this.s.persons) parts.push(this.fameOf(p.household));
  }
}
