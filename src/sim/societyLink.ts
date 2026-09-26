/**
 * M9 사회 구조 연결 (리드): 작업자 C(구애·혼인·불륜·혼인 무효·편지)와 J(범죄·재판·원한·결투·영주 정책·간이 역병) 모듈의
 * Host 를 Simulation 위에 구현하고 훅(자정·사회 결과·물건 결과·카드·출생·사망·소문)과 의도를 한곳에서 다룸.
 * 돈 단위는 파딩 (econ 계정과 같음)
 */
import { Rng } from './core/rng';
import type { Person } from './people/person';
import type { Simulation } from './sim';
import { Courtship, parseCourtship, type CourtshipHost } from './society/courtship';
import { Letters, parseLetterRules, parseLetterTemplates, type LettersHost } from './society/letters';
import { Justice, parseJustice, type JusticeHost, type TrialIntent } from './society/justice';
import { Feuds, parseFeud, type FeudHost } from './society/feud';
import { LordPolicy, parsePolicy, type PolicyHost, type SetPolicyIntent } from './society/policy';
import { PlagueLite, parsePlague, type PlagueHost } from './society/plagueLite';
import { EMOTION_IDS } from './inner/emotion';

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
  readonly house: Simulation['house'];
  readonly chronicleLog: { day: number; trigger: string; subjects: number[] }[];
  readonly gone: Simulation['gone'];
  readonly seed: number;
  readonly deathRules: Simulation['deathRules'];
  readonly pendingDeaths: { p: Person; cause: string }[];
  readonly lordFavor: Map<number, number>;
  killPerson(p: Person, cause: string): void;
  leaveForSchool(p: Person): void;
  backFromSchool(p: Person): void;
  deathAllowed(cause: string, p: Person): boolean;
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
  townNews(kind: string, args: Record<string, string | number>, subjects: Person[]): void;
  offerCard(p: Person, cardId: string, vars?: Record<string, string | number>, other?: Person | null): void;
  moveHousehold(p: Person, household: number, lot: string | null): void;
  newHouseholdId(): number;
  freeLot(size: string): string | null;
}

export class SocietyLink {
  readonly courtship: Courtship | null;
  readonly letters: Letters | null;
  readonly justice: Justice | null;
  readonly feuds: Feuds | null;
  readonly policy: LordPolicy | null;
  readonly plague: PlagueLite | null;
  /** 붙잡힘·감옥·칼 씌우기 (강제 래빗홀): 인물 → 풀려나는 분 */
  readonly confined = new Map<number, number>();
  private readonly rng: Rng;
  /** 죽은 사람 부모 기록 (근친 판정은 죽은 조상까지) */
  private readonly parents = new Map<number, readonly [number, number]>();

  static create(sim: Simulation): SocietyLink {
    return new SocietyLink(sim);
  }

  private get s(): Internals {
    return this.sim as unknown as Internals;
  }

  private constructor(private sim: Simulation) {
    const s = this.s;
    this.rng = new Rng((s.seed * 7717 + 13) >>> 0);
    const f = sim.data.family;
    let court: Courtship | null = null;
    let letters: Letters | null = null;
    try {
      if (f?.courtship) court = new Courtship(this.courtHost(), parseCourtship(f.courtship));
    } catch {
      court = null;
    }
    try {
      if (f?.courtship && f?.letters) letters = new Letters(this.lettersHost(), parseLetterRules(f.courtship), parseLetterTemplates(f.letters));
    } catch {
      letters = null;
    }
    this.courtship = court;
    this.letters = letters;
    // 영주 정책·민심·금고, 간이 역병, 범죄·재판, 원한·결투 (18-4, 18-6, 14-5)
    const pd = f?.policy ? parsePolicy(f.policy) : null;
    this.policy = pd ? new LordPolicy(this.policyHost(), pd) : null;
    const pl = f?.policy ? parsePlague(f.policy) : null;
    this.plague = pl && s.town ? new PlagueLite(this.plagueHost(), new Rng((s.seed * 3571 + 7) >>> 0), pl) : null;
    const jd = f?.justice ? parseJustice(f.justice) : null;
    this.justice = jd && s.town ? new Justice(this.justiceHost(), jd) : null;
    const fd = f?.justice ? parseFeud(f.justice) : null;
    this.feuds = fd && s.town ? new Feuds(this.feudHost(), fd) : null;
    this.policy?.init();
    if (s.econ && this.policy) {
      s.econ.policy = this.policy;
      const pg = this.plague;
      s.econ.plagueTrade = () => ({ mult: (this.policy?.marketTradeMult(!!pg?.active) ?? 1) * (pg?.tradeMult() ?? 1), blocked: !!pg?.orderActive() });
    }
    for (const p of s.persons) this.parents.set(p.id, [p.mother, p.father]);
  }

  // ================================================================== 공통

  private cache: { minute: number; n: number; list: Person[] } = { minute: -1, n: -1, list: [] };
  /** 방문객 뺀 인물 (같은 분·같은 인원이면 재사용, 들고 나면 touch) */
  livePersons(): Person[] {
    const s = this.s;
    const c = this.cache;
    if (c.minute !== s.world.minute || c.n !== s.persons.length) {
      c.list = s.persons.filter((q) => !q.visitor);
      c.minute = s.world.minute;
      c.n = s.persons.length;
    }
    return c.list;
  }

  touch(): void {
    this.cache.minute = -1;
  }

  private day(): number {
    return this.s.world.day();
  }

  private age(p: Person): number {
    const s = this.s;
    return s.lifecycle ? s.lifecycle.displayAge(p) : s.judge?.age(p) ?? 30;
  }

  private money(hh: number): number {
    const a = this.s.econ?.account(hh);
    if (a) return a.money;
    return Math.round((this.s.econ?.S(this.estateOf(hh) as never) ?? 0) * 0.3 * 4);
  }

  private spend(hh: number, n: number, reason: string): boolean {
    const e = this.s.econ;
    const a = e?.account(hh);
    if (!e) return false;
    if (!a) return hh >= 100;
    if (a.money < n) return false;
    e.spend(a, n, reason);
    return true;
  }

  private addMoney(hh: number, n: number, reason: string): void {
    const e = this.s.econ;
    const a = e?.account(hh);
    if (e && a && n > 0) e.earn(a, n, reason, false);
  }

  private estateOf(hh: number): string {
    return this.s.house?.householdEstate(hh) ?? this.s.persons.find((q) => q.household === hh)?.estate ?? 'freeman';
  }

  private moodlet(p: Person, id: string): void {
    if (p.lifeStage === 'baby' || p.hidden) return;
    this.s.inner?.addMoodlet(p, id, {});
  }

  // ================================================================== 구애 창구 (14-4)

  private courtHost(): CourtshipHost {
    const L = this;
    const s = this.s;
    const H = () => s.house;
    return {
      get persons() {
        return L.livePersons();
      },
      rng: this.rng,
      get rel() {
        return s.rel;
      },
      day: () => this.day(),
      lifespan: () => s.settings.lifespan,
      age: (p) => this.age(p),
      controlled: (hh) => hh === 1,
      headOf: (hh) => H()?.headOf(hh) ?? s.persons.find((q) => q.household === hh),
      householdEstate: (hh) => this.estateOf(hh),
      householdCap: (hh) => {
        const hc = s.data.story?.household;
        return hh === 1 ? hc?.controllableCap ?? 8 : hc?.cap ?? 12;
      },
      parentsOf: (id) => {
        const p = s.persons.find((q) => q.id === id);
        return p ? [p.mother, p.father] : L.parents.get(id) ?? null;
      },
      money: (hh) => this.money(hh),
      spend: (hh, n, reason) => this.spend(hh, n, reason),
      addMoney: (hh, n, reason) => this.addMoney(hh, n, reason),
      savingsS: (estate) => Math.round((s.econ?.S(estate as never) ?? 0) * s.settings.lifespan * 4),
      fame: (hh, d, reason, by) => {
        if (reason === 'wedding') H()?.lastFeast.set(hh, this.day());
        H()?.fame(hh, d, reason, by ?? null);
      },
      fameOf: (hh) => H()?.fameOf(hh) ?? 300,
      church: (p, d) => {
        p.churchRep = Math.max(-100, Math.min(100, p.churchRep + d));
      },
      moodlet: (p, id) => this.moodlet(p, id),
      memory: (p, kind, importance, valence, withPerson) => {
        p.memories.push({ kind, minute: s.world.minute, valence, importance, withPerson, objectUid: 0 });
      },
      notice: (p, kind, args) => s.notice(p, kind, args),
      news: (kind, args, subjects) => s.townNews(kind, args, subjects),
      chronicle: (trigger, subjects) => {
        s.chronicleLog.push({ day: this.day(), trigger, subjects: subjects.map((q) => q.id) });
      },
      rumor: (subjects, kind, strength, knownBy) => {
        if (!s.rumors || !subjects.length) return;
        const known = knownBy ?? subjects;
        // 나쁜 소문은 주인공 가문 밖 목격자가 있어야 퍼짐 (14-6): 알려 준 사람이 없으면 가까운 다른 가구 어른 한 명
        const hasOutsider = known.some((q) => !subjects.some((x) => x.household === q.household));
        const out = hasOutsider ? known : [...known, ...this.witness(subjects[0])];
        s.rumors.add(kind, subjects, { a: subjects[0].name, b: subjects[1]?.name ?? '' }, this.day(), strength, out);
      },
      offerCard: (p, cardId, vars, other) => s.offerCard(p, cardId, vars ?? {}, other ?? null),
      moveTo: (p, hh) => {
        const lot = s.persons.find((q) => q.household === hh && q !== p)?.homeLot ?? null;
        s.moveHousehold(p, hh, lot);
      },
      splitHousehold: (ps, reason) => {
        const from = ps[0].household;
        const hh = s.newHouseholdId();
        const lot = s.town ? s.freeLot('small') : null;
        for (const p of ps) s.moveHousehold(p, hh, lot);
        H()?.onSplit(from, hh);
        void reason;
        return hh;
      },
      event: (p, id) => s.inner?.event(p, id),
      socialCategory: (id) => s.data.social[id]?.category,
      canMarryEstate: (p) => H()?.estates.canMarry(p) ?? true,
      marriageAcceptMod: (a, b) => H()?.estates.marriageAcceptMod(a, b) ?? 0,
      dowry: (payer, receiver) => H()?.estates.dowry(receiver as never, payer as never) ?? 0,
      planMarriage: (partner, incoming, opts) => H()?.estates.planMarriage(partner, incoming, opts) ?? { ok: true },
      estatesMarry: (partner, incoming, opts) => H()?.estates.marry(partner, incoming, opts) ?? { ok: true },
      matchModifier: (a, b) => H()?.house.clans.matchModifier(a, b) ?? 0,
      matchBlocked: (hh) => H()?.house.clans.matchBlocked(hh) ?? false,
      matchQuality: (hh) => H()?.house.clans.matchQuality(hh) ?? 0,
      onMarriage: (a, b) => H()?.house.clans.onMarriage(a, b),
      onScandal: (a, b) => H()?.house.clans.onScandal(a, b),
      heirloomDowry: (from, to, by) => {
        const house = H();
        if (!house) return 0;
        const cl = house.house.clans.clanIdOfHousehold(from);
        const toClan = house.house.clans.clanIdOfHousehold(to);
        const h = house.house.heirlooms.held(cl)[0];
        if (!h) return 0;
        const v = house.heirloomValue(h);
        return house.house.heirlooms.dowry(h.id, toClan, to, by) ? v * 4 : 0;
      },
      borrow: (hh, n, reason) => {
        const e = s.econ;
        const a = e?.account(hh);
        if (!e || !a || e.debt(a) + n > e.loanLimit(a)) return false;
        e.borrow(a, n, reason, (e.d as { loans: { termDays: number[] } }).loans.termDays.at(-1) ?? 28, this.day());
        return true;
      },
      priestAvailable: () => s.persons.some((q) => q.role === 'priest' || q.career?.id === 'priest'),
      letter: (from, to, kind, about) => {
        this.letters?.sendFree(from, to, kind, about);
      },
    };
  }

  private witness(subject: Person): Person[] {
    const others = this.s.persons.filter((q) => q.household !== subject.household && !q.infant && (q.lifeStage === 'young' || q.lifeStage === 'adult' || q.lifeStage === 'elder'));
    return others.length ? [others[Math.floor(this.rng.next() * others.length)]] : [];
  }

  // ================================================================== 편지 창구 (14-7)

  private lettersHost(): LettersHost {
    const s = this.s;
    return {
      get persons() {
        return s.persons.filter((q) => !q.visitor);
      },
      rng: this.rng,
      day: () => this.day(),
      lifespan: () => s.settings.lifespan,
      skillLevel: (p, sk) => s.skills?.level(p, sk) ?? 0,
      money: (hh) => this.money(hh),
      spend: (hh, n, reason) => this.spend(hh, n, reason),
      moodlet: (p, id) => this.moodlet(p, id),
      notice: (p, kind, args) => s.notice(p, kind, args),
      relation: (a, b, d) => {
        s.rel.change(a.id, b.id, { friendship: d.friendship ?? 0, romance: d.romance ?? 0 }, this.day());
      },
      houseName: (hh) => s.town?.householdName.get(hh) ?? 'house.newcomers',
      controlled: (hh) => hh === 1,
      scribeAvailable: () => s.persons.some((q) => q.role === 'priest' || q.role === 'clerk' || q.career?.id === 'priest' || q.career?.id === 'clerk'),
      event: (p, id) => s.inner?.event(p, id),
      onMatchLetter: (letter, writer, reader) => {
        if (writer && this.courtship) this.courtship.matchByLetter(writer, reader, letter.about);
      },
      petition: (writer, reader) => {
        if (writer && reader) s.inner?.event(writer, 'petition_sent');
      },
      onThreat: (_w, reader) => this.moodlet(reader, 'threat_letter_fear'),
    };
  }

  // ================================================================== 재판·원한·정책·역병 창구

  private base() {
    const s = this.s;
    return {
      get persons() {
        return s.persons.filter((q) => !q.visitor);
      },
      rng: this.rng,
      day: () => this.day(),
      minute: () => s.world.minute,
      lifespan: () => s.settings.lifespan,
      seasonDays: () => (s.data.economy as { calendar?: { seasonDays: number } } | null)?.calendar?.seasonDays ?? 7,
      controlled: (hh: number) => hh === 1,
      placeAt: (p: Person, minute: number) => s.town?.schedulePlace(p, minute) ?? null,
      placeKind: (id: string) => s.town?.place(id)?.kind ?? null,
      policy: () => this.policy,
      deathRules: () => s.deathRules,
      friendship: (a: Person, b: Person) => s.rel.get(a.id, b.id)?.friendship ?? 0,
      skillLevel: (p: Person, sk: string) => s.skills?.level(p, sk) ?? 0,
      fame: (hh: number, d: number, reason: string, by?: Person | null) => s.house?.fame(hh, d, reason, by ?? null),
      karma: (p: Person, d: number) => {
        p.karma = Math.max(-100, Math.min(100, p.karma + d));
      },
      moodlet: (p: Person, id: string) => this.moodlet(p, id),
      memory: (p: Person, kind: string, importance: number, valence: number, withPerson = 0) => {
        p.memories.push({ kind, minute: s.world.minute, valence, importance, withPerson, objectUid: 0 });
      },
      notice: (p: Person, kind: string, args?: Record<string, string | number>) => s.notice(p, kind, args),
      news: (kind: string, args: Record<string, string | number>, subjects: Person[]) => s.townNews(kind, args, subjects),
      chronicle: (trigger: string, subjects: Person[]) => {
        s.chronicleLog.push({ day: this.day(), trigger, subjects: subjects.map((q) => q.id) });
      },
      rumor: (subject: Person, kind: string, good: boolean, strength: number, knownBy?: Person[]) => {
        if (!s.rumors) return;
        const known = knownBy ?? [subject];
        const out = good || known.some((q) => q.household !== subject.household) ? known : [...known, ...this.witness(subject)];
        s.rumors.add(kind, [subject], { a: subject.name }, this.day(), strength, out, { good });
      },
      offerCard: (p: Person, cardId: string, vars?: Record<string, string | number>, other?: Person | null) => s.offerCard(p, cardId, vars ?? {}, other ?? null),
    };
  }

  /** 강제 래빗홀 (붙잡힘·감옥·칼 씌우기): 하던 일을 멈추고 숨음, 풀려날 때 집으로 */
  confine(p: Person, minutes: number): void {
    const s = this.s;
    const until = s.world.minute + Math.max(60, Math.round(minutes));
    if (!p.schoolAway) s.leaveForSchool(p);
    p.sneakUntil = until;
    this.confined.set(p.id, until);
  }

  release(p: Person): void {
    if (!this.confined.delete(p.id)) return;
    if (p.schoolAway) this.s.backFromSchool(p);
  }

  private kill(p: Person, cause: string): void {
    const s = this.s;
    if (!s.pendingDeaths.some((d) => d.p === p)) s.pendingDeaths.push({ p, cause });
  }

  private justiceHost(): JusticeHost {
    const s = this.s;
    const b = this.base();
    return {
      ...b,
      get persons() {
        return b.persons;
      },
      wealthRatio: (hh) => this.money(hh) / Math.max(1, (s.econ?.S(this.estateOf(hh) as never) ?? 1) * 4),
      savingsS: (hh) => Math.round((s.econ?.S(this.estateOf(hh) as never) ?? 0) * s.settings.lifespan * 4),
      money: (hh) => this.money(hh),
      fameTier: (hh) => s.house?.fameTier(hh) ?? 'ordinary',
      lordFavor: (hh) => s.lordFavor.get(hh) ?? 0,
      judge: () => {
        const lh = s.house?.fief?.lordHousehold();
        return (lh !== null && lh !== undefined ? s.house?.headOf(lh) : undefined) ?? s.persons.find((q) => q.role === 'bailiff') ?? null;
      },
      grudgeTargets: (p) => this.feuds?.grudgesOf(p) ?? [],
      fine: (hh, amount, reason) => {
        const e = s.econ;
        const a = e?.account(hh);
        if (e && a) e.spend(a, amount, reason);
        if (s.house) s.house.finesToday += amount;
      },
      pay: (from, to, amount, reason) => {
        const e = s.econ;
        const a = e?.account(from);
        if (a) {
          if (a.money < amount) return false;
          e!.spend(a, amount, reason);
        } else if (from < 100) return false;
        this.addMoney(to, amount, reason);
        return true;
      },
      detain: (p, until) => this.confine(p, until - s.world.minute),
      release: (p) => this.release(p),
      pillory: (p, minutes) => {
        this.confine(p, minutes);
        this.moodlet(p, 'pilloried_shame');
      },
      flog: (p) => {
        this.moodlet(p, 'flogged_pain');
        p.memories.push({ kind: 'flogged', minute: s.world.minute, valence: -1, importance: 3, withPerson: 0, objectUid: 0 });
      },
      jail: (p, days) => {
        this.confine(p, days * 1440);
        this.moodlet(p, 'jailed_misery');
      },
      exile: (p) => {
        this.moodlet(p, 'exiled_grief');
        s.townNews('verdict_exile', { a: p.name }, [p]);
        this.kill(p, 'moved_away');
      },
      confiscate: (hh) => {
        s.house?.house.heirlooms.onConfiscation(hh);
        const a = s.econ?.account(hh);
        if (a && a.money > 0) s.econ!.spend(a, Math.floor(a.money / 2), 'confiscation');
      },
      felony: (p) => {
        const E = s.house?.estates;
        if (!E) return;
        if (p.estate === 'knight') E.revokeKnighthood(p);
        E.felony(p);
      },
      kill: (p, cause) => this.kill(p, cause),
      startTrialScene: (t) => {
        const p = s.persons.find((q) => q.id === t.accused);
        if (p) s.notice(p, 'trial_open', { a: p.name });
      },
      endTrialScene: () => undefined,
    };
  }

  private feudHost(): FeudHost {
    const s = this.s;
    const b = this.base();
    return {
      ...b,
      get persons() {
        return b.persons;
      },
      relationsBelow: (v) => {
        const byId = new Map(s.persons.map((q) => [q.id, q]));
        const out: [Person, Person][] = [];
        for (const r of s.rel.all()) {
          if (r.friendship > v) continue;
          const a = byId.get(r.a);
          const c = byId.get(r.b);
          if (a && c) out.push([a, c]);
        }
        return out;
      },
      relation: (a, c, d) => {
        s.rel.change(a.id, c.id, { friendship: d.friendship ?? 0 }, this.day());
        if (d.respect) s.rel.addRespect(c.id, a.id, d.respect);
      },
      onGrudge: (a, c) => s.house?.house.clans.onGrudge(a, c),
      equipTier: (p) => (p.estate === 'knight' || p.estate === 'noble' ? 2 : p.role === 'guard' ? 1 : 0),
      injured: (p) => p.moodlets.some((m) => m.id === 'fistfight_bruised' || m.id === 'flogged_pain'),
      angry: (p) => p.emotionStage >= 1 && EMOTION_IDS[p.emotion] === 'angry',
      justice: () => this.justice,
      vandalize: (hh) => {
        const t = s.town;
        const lot = t ? [...t.lotHousehold].find(([, h]) => h === hh)?.[0] : null;
        const rect = lot && t ? t.lot(lot)?.rect : null;
        if (!rect) return;
        const o = s.world.objects.find((x) => x.x >= rect[0] && x.x <= rect[2] && x.y >= rect[1] && x.y <= rect[3] && s.data.objects[x.defId]?.durable);
        if (o) o.state.wear = Math.min(100, Number(o.state.wear ?? 0) + 50);
      },
      injure: (p) => this.moodlet(p, 'fistfight_bruised'),
      permanentInjury: (p, kind) => {
        p.memories.push({ kind: `injury_${kind}`, minute: s.world.minute, valence: -1, importance: 4, withPerson: 0, objectUid: 0 });
        this.moodlet(p, 'fistfight_bruised');
      },
      knockOut: (p) => {
        p.setNeed('energy', Math.min(p.need('energy'), 10));
        this.moodlet(p, 'fistfight_bruised');
      },
      kill: (p, cause) => this.kill(p, cause),
    };
  }

  private policyHost(): PolicyHost {
    const s = this.s;
    const b = this.base();
    const H = () => s.house;
    return {
      ...b,
      get persons() {
        return b.persons;
      },
      morale: () => H()?.house.honor.morale ?? 50,
      addMorale: (d) => {
        H()?.house.honor.addMorale(d);
      },
      treasury: () => H()?.fief?.treasury.money ?? 0,
      treasuryIn: (n, kind) => H()?.fief?.treasuryIn(n, kind),
      treasurySpend: (n, kind) => H()?.fief?.treasurySpend(n, kind) ?? false,
      lordHousehold: () => H()?.fief?.lordHousehold() ?? null,
      lord: () => {
        const lh = H()?.fief?.lordHousehold();
        return lh !== null && lh !== undefined ? H()?.headOf(lh) ?? null : null;
      },
      embezzle: (hh, n) => H()?.fief?.embezzle(hh, n) ?? { ok: false, moved: 0, discovered: false },
      lordFavor: (hh) => s.lordFavor.get(hh) ?? 0,
      addLordFavor: (hh, d) => s.lordFavor.set(hh, (s.lordFavor.get(hh) ?? 0) + d),
      badYear: () => (s.econ?.yearMultNow ?? 1) < 1,
      hungryHouseholds: () => {
        const out = new Set<number>();
        for (const q of s.persons) if (!q.visitor && !q.infant && (q.need('hunger') < 10 || q.hungerZeroMinutes > 0)) out.add(q.household);
        return [...out];
      },
      grainPrice: () => s.econ?.goodPrice('grain') ?? 4,
      giveGrain: (hh, n) => {
        if (hh === 1) s.world.stock.bread = (s.world.stock.bread ?? 0) + n;
        else for (const q of s.persons) if (q.household === hh) q.setNeed('hunger', Math.max(q.need('hunger'), 50));
      },
      householdSize: (hh) => s.persons.filter((q) => q.household === hh).length,
      householdEstate: (hh) => this.estateOf(hh),
      crimesPerDay: () => this.justice?.crimesPerDay() ?? 0,
      plagueActive: () => !!this.plague?.active,
    };
  }

  private plagueHost(): PlagueHost {
    const s = this.s;
    const b = this.base();
    return {
      ...b,
      get persons() {
        return b.persons;
      },
      kill: (p, cause) => this.kill(p, cause),
      incapacitate: (p, days) => {
        p.setNeed('energy', Math.min(p.need('energy'), 15));
        p.memories.push({ kind: 'near_death', minute: s.world.minute, valence: -1, importance: 4, withPerson: 0, objectUid: 0 });
        void days;
      },
      memory: (p, kind, importance, valence) => {
        p.memories.push({ kind, minute: s.world.minute, valence, importance, withPerson: 0, objectUid: 0 });
      },
      placeName: (id) => s.town?.place(id)?.nameKey ?? id,
    };
  }

  // ================================================================== 훅

  /** 조건 게이트 등록 (requires.gate) */
  gates(): Record<string, (p: Person, t: Person | null) => boolean> {
    const out: Record<string, (p: Person, t: Person | null) => boolean> = {};
    if (this.courtship) Object.assign(out, this.courtship.gates());
    if (this.letters) Object.assign(out, this.letters.gates((p, q) => this.sim.isPartner(p.id, q.id)));
    for (const m of [this.justice, this.feuds, this.policy]) if (m) Object.assign(out, m.gates());
    return out;
  }

  /** 자정 (판정기 뒤) */
  daily(): void {
    this.courtship?.daily();
    this.letters?.daily();
    const d = this.day() - 1;
    this.policy?.daily(d);
    this.justice?.daily(d);
    this.feuds?.daily(d);
    this.plague?.daily(d);
  }

  /** 매 게임 1시간: 재판 장면 진행, 풀려날 사람 */
  hourly(): void {
    this.justice?.hourly();
    const now = this.s.world.minute;
    for (const [id, until] of [...this.confined]) {
      if (now < until) continue;
      const p = this.s.persons.find((q) => q.id === id);
      if (p) this.release(p);
      else this.confined.delete(id);
    }
  }

  /** 카드 결과 flag (재판·결투 사건): 처리했으면 true (가구 플래그로 남기지 않음) */
  onCardFlag(p: Person, flag: string, cardId: string | null): boolean {
    return !!(this.justice?.onCardFlag(p, flag, cardId) || this.feuds?.onCardFlag(p, flag));
  }

  accuse(from: Person, target: Person): void {
    this.justice?.accuse(from, target);
  }

  onSocial(p: Person, t: Person, id: string, ok: boolean): void {
    this.courtship?.onSocial(p, t, id, ok);
    if (this.justice?.onSocial(p, t, id, ok)) return;
    if (this.feuds?.onSocial(p, t, id, ok)) return;
    this.policy?.onSocial(p, t, id, ok);
  }

  onInteraction(p: Person, iaId: string, targetUid: number): void {
    this.courtship?.onInteraction(p, iaId, targetUid);
    this.policy?.onInteraction(p, iaId);
    if (this.letters && iaId.startsWith('table.') && (iaId.includes('letter') || iaId.includes('read'))) {
      const lover = this.s.persons.find((q) => q !== p && this.sim.isPartner(p.id, q.id) && q.household !== p.household) ?? null;
      this.letters.onInteraction(p, iaId, lover);
    }
  }

  onCard(p: Person, cardId: string, option: number, ok: boolean, other: Person | null): void {
    this.courtship?.onCard(p, cardId, option, ok, other);
  }

  /** 출생: 사생아 판정 (약혼자 사이, 미혼모, 성직자의 아이 포함) */
  onBirth(baby: Person, mother: Person, father: Person | null): boolean {
    this.parents.set(baby.id, [baby.mother, baby.father]);
    return this.courtship?.onBirth(baby, mother, father).bastard ?? false;
  }

  /** 사망 (배우자 표시를 지우기 전) */
  onDeath(p: Person): void {
    this.parents.set(p.id, [p.mother, p.father]);
    this.courtship?.onDeath(p);
  }

  /** 목록에서 빠짐 (죽음·떠남) */
  forget(id: number): void {
    this.justice?.forget(id);
    this.feuds?.forget(id);
    this.plague?.forget(id);
    this.confined.delete(id);
  }

  onRumorHeard(kind: string, subjects: readonly number[], listener: Person): void {
    this.courtship?.onRumorHeard(kind, subjects, listener);
  }

  flags(p: Person): string[] {
    const out = [...(this.courtship?.flags(p) ?? []), ...(this.letters?.flags(p) ?? [])];
    for (const m of [this.justice, this.feuds, this.policy, this.plague]) if (m) out.push(...m.flags(p));
    return out;
  }

  /** 판정기용 (18-3): 구애 규칙으로 NPC 혼인 */
  judgeCourtship(): import('./town/lifeJudge').JudgeCourtship | undefined {
    const c = this.courtship;
    if (!c) return undefined;
    return {
      managed: (p) => c.managed(p),
      decidedToday: (p) => c.decidedToday(p),
      npcMatchScore: (a, b) => c.npcMatchScore(a, b),
      arrangeNpcWedding: (a, b) => c.arrangeNpcWedding(a, b).ok,
    };
  }

  intent(op: string, a: Record<string, unknown>): { ok: boolean; reason?: string; result?: unknown } {
    const c = this.courtship;
    const L = this.letters;
    const P = (k: string) => this.s.persons.find((q) => q.id === Number(a[k]));
    const wrap = (r: { ok: boolean; reason?: string } | null | undefined) => (r ? { ok: r.ok, reason: r.reason, result: r } : { ok: false, reason: 'no_module' });
    switch (op) {
      case 'findMatch':
        return wrap(c?.findMatch(Number(a.household ?? 1), Number(a.personId), { good: !!a.good }));
      case 'negotiate':
        return wrap(c?.negotiate(Number(a.matchId), (a.terms ?? {}) as never));
      case 'acceptProposal':
        return wrap(c?.acceptProposal(Number(a.matchId)));
      case 'refuseMatch':
        return wrap(c?.refuse(Number(a.matchId)));
      case 'elope': {
        const x = P('a');
        const y = P('b');
        return x && y ? wrap(c?.elope(x, y)) : { ok: false };
      }
      case 'setWeddingDay':
        return wrap(c?.setWeddingDay(Number(a.personId), Number(a.day)));
      case 'petitionAnnulment':
        return wrap(c?.petitionAnnulment(Number(a.personId), String(a.reason)));
      case 'separate':
        return wrap(c?.separate(Number(a.personId)));
      case 'sendLetter': {
        if (!L) return { ok: false, reason: 'no_module' };
        const r = L.send(Number(a.from), Number(a.to), String(a.kind), { about: a.about !== undefined ? Number(a.about) : undefined, far: a.far ? String(a.far) : undefined });
        return { ok: r.ok, reason: r.reason, result: r };
      }
      case 'readLetter': {
        if (!L) return { ok: false, reason: 'no_module' };
        const r = L.read(Number(a.personId), Number(a.letterId));
        return { ok: r.ok, reason: r.reason, result: r };
      }
      case 'setPolicy': {
        if (!this.policy) return { ok: false, reason: 'no_module' };
        const r = this.policy.applyIntent({ kind: 'setPolicy', policy: a.policy, value: a.value } as SetPolicyIntent, true);
        return { ok: r.ok, reason: r.reason };
      }
      case 'petitionLord': {
        const p = P('personId');
        if (!p || !this.policy) return { ok: false };
        if (!this.policy.canPetition(p)) return { ok: false, reason: 'reason.lord_petition' };
        const r = this.policy.petition(p);
        return { ok: r.ok, result: r };
      }
      case 'embezzle': {
        if (!this.policy) return { ok: false };
        const r = this.policy.embezzle(Number(a.household ?? 1), Number(a.amount ?? 0));
        return { ok: r.ok, result: r };
      }
      case 'trialPlea':
      case 'trialCallWitness':
      case 'kinPetition':
      case 'kinBribe':
      case 'kinPersuade':
      case 'trialAdvance': {
        if (!this.justice) return { ok: false, reason: 'no_module' };
        const r = this.justice.applyIntent({ ...a, kind: op } as TrialIntent);
        return { ok: r.ok, reason: r.reason };
      }
      case 'challengeDuel': {
        const x = P('a');
        const y = P('b');
        if (!x || !y || !this.feuds) return { ok: false };
        return { ok: true, result: this.feuds.challenge(x, y) };
      }
      case 'inbox':
        return { ok: !!L, result: L?.householdInbox(Number(a.household ?? 1)) ?? [] };
      case 'offers':
        return { ok: !!c, result: { offers: c?.offers(Number(a.household ?? 1)) ?? [], incoming: c?.incomingOffers(Number(a.household ?? 1)) ?? [] } };
      default:
        return { ok: false, reason: 'unknown' };
    }
  }

  hashParts(parts: (string | number)[]): void {
    this.courtship?.hashParts(parts);
    this.letters?.hashParts(parts);
    this.justice?.hashParts(parts);
    this.feuds?.hashParts(parts);
    this.policy?.hashParts(parts);
    this.plague?.hashParts(parts);
    for (const [id, u] of [...this.confined].sort((x, y) => x[0] - y[0])) parts.push(id, u);
  }
}
