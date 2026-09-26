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
    for (const p of s.persons) this.parents.set(p.id, [p.mother, p.father]);
  }

  // ================================================================== 공통

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
        return s.persons.filter((q) => !q.visitor);
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
      fame: (hh, d, reason, by) => H()?.fame(hh, d, reason, by ?? null),
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
        const hh = s.newHouseholdId();
        const lot = s.town ? s.freeLot('small') : null;
        const est = this.estateOf(ps[0].household);
        for (const p of ps) s.moveHousehold(p, hh, lot);
        const house = H();
        if (house) {
          house.hhEstate.set(hh, est as never);
          house.house.clans.onHouseholdSplit(ps[0].household === hh ? hh : ps[0].household, hh);
        }
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
        const v = h.defId ? 40 : 0;
        return house.house.heirlooms.dowry(h.id, toClan, to, by) ? v * 4 : 0;
      },
      borrow: (hh, n, reason) => {
        const e = s.econ;
        const a = e?.account(hh);
        if (!e || !a || e.debt(a) + n > e.loanLimit(a)) return false;
        e.borrow(a, n, reason, 28, this.day());
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

  // ================================================================== 훅

  /** 조건 게이트 등록 (requires.gate) */
  gates(): Record<string, (p: Person, t: Person | null) => boolean> {
    const out: Record<string, (p: Person, t: Person | null) => boolean> = {};
    if (this.courtship) Object.assign(out, this.courtship.gates());
    if (this.letters) Object.assign(out, this.letters.gates((p, q) => this.sim.isPartner(p.id, q.id)));
    return out;
  }

  /** 자정 (판정기 뒤) */
  daily(): void {
    this.courtship?.daily();
    this.letters?.daily();
  }

  onSocial(p: Person, t: Person, id: string, ok: boolean): void {
    this.courtship?.onSocial(p, t, id, ok);
  }

  onInteraction(p: Person, iaId: string, targetUid: number): void {
    this.courtship?.onInteraction(p, iaId, targetUid);
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

  onRumorHeard(kind: string, subjects: readonly number[], listener: Person): void {
    this.courtship?.onRumorHeard(kind, subjects, listener);
  }

  flags(p: Person): string[] {
    return [...(this.courtship?.flags(p) ?? []), ...(this.letters?.flags(p) ?? [])];
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
  }
}
