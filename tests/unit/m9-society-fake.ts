/**
 * M9 사회 모듈 테스트용 가짜 세계 (src/sim/society: justice, feud, policy, plagueLite). 리드의 sim.ts 연결 없이
 * 모든 Host 를 한 객체로 구현하고 부수 효과를 기록 배열에 남김. 영주 금고는 진짜 FiefSystem (house/fief.ts), 사망 설정은 진짜 DeathRules
 */
import { readFileSync } from 'node:fs';
import { Rng } from '../../src/sim/core/rng';
import { Person, type LifeStage } from '../../src/sim/people/person';
import { DeathRules, parseDeathRules } from '../../src/sim/health/deathRules';
import { FiefSystem, parseFief, type FiefHost } from '../../src/sim/house/fief';
import { Justice, parseJustice, type JusticeHost, type Trial } from '../../src/sim/society/justice';
import { Feuds, parseFeud, type FeudHost } from '../../src/sim/society/feud';
import { LordPolicy, parsePolicy, type PolicyHost } from '../../src/sim/society/policy';
import { PlagueLite, parsePlague, type PlagueHost } from '../../src/sim/society/plagueLite';

const json = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
export const justiceRaw = (): unknown => json('src/data/justice.json');
export const policyRaw = (): unknown => json('src/data/policy.json');

export interface Log {
  moodlets: { p: number; id: string }[];
  notices: { p: number; kind: string; args?: Record<string, string | number> }[];
  news: { kind: string; args: Record<string, string | number> }[];
  rumors: { p: number; kind: string; good: boolean }[];
  cards: { p: number; card: string; other: number }[];
  fines: { hh: number; amount: number }[];
  fame: { hh: number; delta: number; reason: string; by: number }[];
  kills: { p: number; cause: string; sub?: string }[];
  jails: { p: number; days: number }[];
  exiles: number[];
  pillory: { p: number; minutes: number }[];
  flogs: number[];
  confiscations: number[];
  felonies: number[];
  detains: { p: number; until: number }[];
  scenes: { kind: 'start' | 'end'; trial: number }[];
  injuries: { p: number; kind: string }[];
  permanent: { p: number; kind: string }[];
  knockouts: number[];
  relations: { a: number; b: number; friendship?: number; respect?: number }[];
  grudges: { a: number; b: number }[];
  vandal: number[];
  grain: { hh: number; n: number }[];
  chronicle: { trigger: string }[];
  pays: { from: number; to: number; amount: number }[];
}

export function societyWorld(seed = 1, opts: { deathPreset?: 'lenient' | 'normal' | 'realistic' } = {}) {
  let pid = 0;
  const persons: Person[] = [];
  const log: Log = {
    moodlets: [], notices: [], news: [], rumors: [], cards: [], fines: [], fame: [], kills: [], jails: [], exiles: [], pillory: [], flogs: [],
    confiscations: [], felonies: [], detains: [], scenes: [], injuries: [], permanent: [], knockouts: [], relations: [], grudges: [], vandal: [], grain: [], chronicle: [], pays: [],
  };
  const friend = new Map<string, number>();
  const money = new Map<number, number>();
  const estateOf = new Map<number, string>();
  /** 사람 → 일과 장소 (모든 시각 같음). 없으면 null */
  const place = new Map<number, string | null>();
  const placeKinds: Record<string, string> = { market: 'market', inn: 'inn', castle: 'castle', forest_river: 'forest_river', church: 'church', well_square: 'well_square', craft_street: 'craft_street' };
  const favor = new Map<number, number>();
  const w = {
    persons,
    log,
    rng: new Rng(seed),
    dayN: 10,
    minuteN: 10 * 1440 + 9 * 60,
    lifespanN: 1,
    controlledHh: 1,
    lordHh: 900 as number | null,
    judgeId: 0,
    wealth: 1,
    hungry: [] as number[],
    badYear: false,
    angry: new Set<number>(),
    friend,
    money,
    place,
    deathRules: new DeathRules(parseDeathRules(json('src/data/death_rules.json'))!, opts.deathPreset ?? 'realistic'),
    morale: 50,
    add(name: string, household: number, o: Partial<Pick<Person, 'sex' | 'lifeStage' | 'estate' | 'traits' | 'honor' | 'skills'>> & { at?: string | null } = {}): Person {
      const p = new Person(++pid, name, 0, 0);
      p.household = household;
      p.lifeStage = (o.lifeStage ?? 'adult') as LifeStage;
      p.estate = o.estate ?? estateOf.get(household) ?? 'freeman';
      if (o.traits) p.traits = [...o.traits];
      if (o.honor !== undefined) p.honor = o.honor;
      if (o.skills) p.skills = { ...o.skills };
      if (o.sex) p.sex = o.sex;
      if (o.at !== undefined) place.set(p.id, o.at);
      persons.push(p);
      if (!money.has(household)) money.set(household, 5000);
      return p;
    },
    setFriend(a: Person, b: Person, v: number, both = true): void {
      friend.set(`${a.id}:${b.id}`, v);
      if (both) friend.set(`${b.id}:${a.id}`, v);
    },
    remove(p: Person): void {
      const i = persons.indexOf(p);
      if (i >= 0) persons.splice(i, 1);
    },
    moodletsOf(p: Person): string[] {
      return log.moodlets.filter((m) => m.p === p.id).map((m) => m.id);
    },
  };
  const fr = (a: Person, b: Person) => friend.get(`${a.id}:${b.id}`) ?? 0;

  // ------------------------------------------------ 영주 금고 (진짜 FiefSystem)
  const fiefHost: FiefHost = {
    rng: w.rng,
    seasonDays: () => 7,
    lifespan: () => w.lifespanN,
    season: () => 'spring',
    householdEstate: (hh) => estateOf.get(hh) ?? 'freeman',
    earn: (hh, amount) => void money.set(hh, (money.get(hh) ?? 0) + amount),
    addStock: () => {},
    feesToday: () => 0,
    finesToday: () => fines.today,
    fame: (hh, delta, reason) => void log.fame.push({ hh, delta, reason, by: 0 }),
    morale: (delta) => {
      w.morale = Math.max(0, Math.min(100, w.morale + delta));
    },
    rumor: (hh, kind) => void log.rumors.push({ p: -hh, kind, good: false }),
    notice: (hh, kind, args) => void log.notices.push({ p: -hh, kind, args }),
    houseTier: () => 5,
    lastFeastDay: () => 0,
    bestOutfitTier: () => 9,
    tierIndex: () => 0,
    moodletHousehold: () => {},
  };
  const fines = { today: 0 };
  const fief = new FiefSystem(fiefHost, parseFief(json('src/data/estates.json'))!);

  // ------------------------------------------------ 공통 창구
  const common = {
    get persons() {
      return persons;
    },
    rng: w.rng,
    day: () => w.dayN,
    minute: () => w.minuteN,
    lifespan: () => w.lifespanN,
    seasonDays: () => 7,
    controlled: (hh: number) => hh === w.controlledHh,
    placeAt: (p: Person) => place.get(p.id) ?? null,
    placeKind: (id: string) => placeKinds[id] ?? null,
    friendship: fr,
    skillLevel: (p: Person, sk: string) => p.skills[sk] ?? 0,
    deathRules: () => w.deathRules,
    moodlet: (p: Person, id: string) => void log.moodlets.push({ p: p.id, id }),
    memory: () => {},
    notice: (p: Person, kind: string, args?: Record<string, string | number>) => void log.notices.push({ p: p.id, kind, args }),
    news: (kind: string, args: Record<string, string | number>) => void log.news.push({ kind, args }),
    chronicle: (trigger: string) => void log.chronicle.push({ trigger }),
    rumor: (p: Person, kind: string, good: boolean) => void log.rumors.push({ p: p.id, kind, good }),
    offerCard: (p: Person, card: string, _v?: Record<string, string | number>, other?: Person | null) => void log.cards.push({ p: p.id, card, other: other?.id ?? 0 }),
    fame: (hh: number, delta: number, reason: string, by?: Person | null) => void log.fame.push({ hh, delta, reason, by: by?.id ?? 0 }),
    karma: (p: Person, d: number) => {
      p.karma += d;
    },
    lordFavor: (hh: number) => favor.get(hh) ?? 0,
    addLordFavor: (hh: number, d: number) => void favor.set(hh, (favor.get(hh) ?? 0) + d),
  };

  // ------------------------------------------------ 정책
  const policyHost: PolicyHost = {
    ...common,
    morale: () => w.morale,
    addMorale: (d) => {
      w.morale = Math.max(0, Math.min(100, w.morale + d));
    },
    treasury: () => fief.treasury.money,
    treasuryIn: (a, k) => fief.treasuryIn(a, k),
    treasurySpend: (a, k) => fief.treasurySpend(a, k),
    lordHousehold: () => w.lordHh,
    lord: () => persons.find((p) => p.household === w.lordHh) ?? null,
    embezzle: (hh, amount) => fief.embezzle(hh, amount),
    badYear: () => w.badYear,
    hungryHouseholds: () => w.hungry,
    grainPrice: () => 2,
    giveGrain: (hh, n) => void log.grain.push({ hh, n }),
    householdSize: (hh) => persons.filter((p) => p.household === hh).length,
    householdEstate: (hh) => estateOf.get(hh) ?? 'freeman',
  };
  const policy = new LordPolicy(policyHost, parsePolicy(policyRaw())!);

  // ------------------------------------------------ 재판
  let feuds: Feuds | null = null;
  const justiceHost: JusticeHost = {
    ...common,
    policy: () => policy,
    wealthRatio: () => w.wealth,
    savingsS: () => 2000,
    money: (hh) => money.get(hh) ?? 0,
    fameTier: () => 'ordinary',
    judge: () => persons.find((p) => p.id === w.judgeId) ?? null,
    grudgeTargets: (p) => feuds?.grudgesOf(p) ?? [],
    fine: (hh, amount) => {
      money.set(hh, (money.get(hh) ?? 0) - amount);
      fines.today += amount;
      log.fines.push({ hh, amount });
    },
    pay: (from, to, amount) => {
      if ((money.get(from) ?? 0) < amount) return false;
      money.set(from, (money.get(from) ?? 0) - amount);
      money.set(to, (money.get(to) ?? 0) + amount);
      log.pays.push({ from, to, amount });
      return true;
    },
    detain: (p, until) => void log.detains.push({ p: p.id, until }),
    release: () => {},
    pillory: (p, minutes) => void log.pillory.push({ p: p.id, minutes }),
    flog: (p) => void log.flogs.push(p.id),
    jail: (p, days) => void log.jails.push({ p: p.id, days }),
    exile: (p) => {
      log.exiles.push(p.id);
      w.remove(p);
    },
    confiscate: (hh) => void log.confiscations.push(hh),
    felony: (p) => void log.felonies.push(p.id),
    kill: (p, cause) => {
      log.kills.push({ p: p.id, cause });
      w.remove(p);
    },
    startTrialScene: (t: Trial) => void log.scenes.push({ kind: 'start', trial: t.id }),
    endTrialScene: (t: Trial) => void log.scenes.push({ kind: 'end', trial: t.id }),
  };
  const justice = new Justice(justiceHost, parseJustice(justiceRaw())!);

  // ------------------------------------------------ 원한
  const feudHost: FeudHost = {
    ...common,
    relationsBelow: (v) => {
      const out: [Person, Person][] = [];
      for (const [k, f] of friend) {
        if (f > v) continue;
        const [a, b] = k.split(':').map(Number);
        const pa = persons.find((p) => p.id === a);
        const pb = persons.find((p) => p.id === b);
        if (pa && pb) out.push([pa, pb]);
      }
      return out;
    },
    relation: (a, b, d) => {
      log.relations.push({ a: a.id, b: b.id, ...d });
      if (d.friendship) friend.set(`${a.id}:${b.id}`, fr(a, b) + d.friendship);
    },
    onGrudge: (a, b) => void log.grudges.push({ a: a.id, b: b.id }),
    equipTier: () => 0,
    injured: () => false,
    angry: (p) => w.angry.has(p.id),
    policy: () => policy,
    justice: () => justice,
    vandalize: (hh) => void log.vandal.push(hh),
    injure: (p, kind) => void log.injuries.push({ p: p.id, kind }),
    permanentInjury: (p, kind) => void log.permanent.push({ p: p.id, kind }),
    knockOut: (p) => void log.knockouts.push(p.id),
    kill: (p, cause, sub) => {
      log.kills.push({ p: p.id, cause, sub });
      w.remove(p);
    },
  };
  feuds = new Feuds(feudHost, parseFeud(justiceRaw())!);

  // ------------------------------------------------ 역병
  const plagueHost: PlagueHost = {
    ...common,
    policy: () => policy,
    kill: (p, cause, sub) => {
      log.kills.push({ p: p.id, cause, sub });
      w.remove(p);
    },
    incapacitate: () => {},
    memory: () => {},
  };
  const plague = new PlagueLite(plagueHost, new Rng(seed * 7 + 3), parsePlague(policyRaw())!);

  return Object.assign(w, {
    fief,
    fines,
    policy,
    justice,
    feuds: feuds as Feuds,
    plague,
    estateOf,
    favor,
    fr,
    hosts: { policyHost, justiceHost, feudHost, plagueHost },
  });
}

export type SocietyWorld = ReturnType<typeof societyWorld>;
