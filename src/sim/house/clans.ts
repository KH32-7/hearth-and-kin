/**
 * 가문 (GDD 16-1, 16-6): 가문 레지스트리, 가문 명성과 단계, 가문 보상, 가훈, 문장, 가장, 가계도, 가문 간 관계.
 * - 가문 = 성씨 단위. 가문 하나가 가정(가구) 여러 개를 가짐 (15-8). 농노 가문은 이름 없음(null) → 신분 상승 때 가문명을 얻는 연출
 * - Simulation.fame(가구별 임시 누적, M7)을 대신함: fameOfHousehold / Honor.addFameHousehold (honor.ts)
 * - 하인은 가정 식구지만 가문 사람이 아님 (memberFilter)
 * 수치는 src/data/clans.json (SimData.family.houses). 렌더러/DOM 없음. 무작위는 host.rng 만
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import type { LifeStage, Person } from '../people/person';

// ------------------------------------------------------------------ 데이터

const scale = z.enum(['absolute', 'season', 'lifespan', 'per_life']);
export const durSchema = z.object({ value: z.number(), scale });
export type Dur = z.infer<typeof durSchema>;

export const LAWS = ['primogeniture', 'equal', 'will'] as const;
export type InheritanceLaw = (typeof LAWS)[number];
export const TIERS = ['dishonored', 'suspect', 'ordinary', 'respected', 'renowned', 'legendary'] as const;
export type FameTier = (typeof TIERS)[number];
export const REL_LEVELS = ['ally', 'friendly', 'neutral', 'rival', 'enemy'] as const;
export type RelLevel = (typeof REL_LEVELS)[number];
export const SERVANT_ROLES = ['maid', 'cook', 'nurse', 'groom', 'steward', 'guard'] as const;
export type ServantRole = (typeof SERVANT_ROLES)[number];

const heraldrySchema = z.object({
  shield: z.string(),
  division: z.string(),
  tinctures: z.tuple([z.string(), z.string()]),
  charge: z.string().nullable(),
  chargeTincture: z.string(),
});
export type HeraldrySpec = z.infer<typeof heraldrySchema>;

const repSchema = z.object({ fame: z.number().optional(), church: z.number().optional(), karma: z.number().optional(), morale: z.number().optional(), tags: z.array(z.string()).optional() });

export const clansSchema = z.object({
  fame: z.object({
    min: z.number(),
    max: z.number(),
    tiers: z.array(z.object({ id: z.enum(TIERS), min: z.number() })).length(6),
    start: z.object({ ruined: z.number(), normal: z.number(), wealthy: z.number() }),
    wealthStart: z.record(z.string(), z.number()),
    tierUpMoodlet: z.string(),
    dishonoredMoodlet: z.string(),
  }),
  honor: z.object({
    min: z.number(),
    max: z.number(),
    modifiers: z.array(z.object({
      id: z.string(),
      kind: z.enum(['trait', 'reward']),
      tags: z.array(z.string()).optional(),
      lossMult: z.number().optional(),
      fameLossMult: z.number().optional(),
      gainMult: z.number().optional(),
    })),
    titles: z.array(z.object({ min: z.number(), key: z.string().nullable() })),
  }),
  church: z.object({ min: z.number(), max: z.number(), decayPerDay: durSchema }),
  karma: z.object({ min: z.number(), max: z.number() }),
  morale: z.object({ min: z.number(), max: z.number(), start: z.number(), toward: z.number(), perDay: durSchema }),
  events: z.record(z.string(), z.union([repSchema, z.string()])),
  rewards: z.object({
    list: z.array(z.object({
      id: z.string(),
      minTier: z.enum(TIERS).optional(),
      maxTier: z.enum(TIERS).optional(),
      memberSkill: z.object({ skill: z.string(), level: z.number() }).optional(),
      skillXp: z.object({ category: z.string().optional(), skills: z.array(z.string()).optional(), mult: z.number() }).optional(),
      loanRateMult: z.number().optional(),
      matchQuality: z.number().optional(),
      churchGainMult: z.number().optional(),
      fameLossMult: z.number().optional(),
    })),
  }).loose(),
  motto: z.object({
    maxLength: z.number(),
    maxTags: z.number(),
    wishChancePerDay: z.number(),
    inspiredMoodlet: z.string(),
    minStages: z.array(z.string()),
    tags: z.record(z.string(), z.array(z.string())),
  }).loose(),
  names: z.object({ noNameEstates: z.array(z.string()), gotNameMoodlet: z.string() }).loose(),
  tree: z.object({ generations: z.number().int().min(1) }),
  relations: z.object({
    levels: z.array(z.object({ id: z.enum(REL_LEVELS), min: z.number() })).length(5),
    levelScore: z.record(z.enum(REL_LEVELS), z.number()),
    marriage: z.number(),
    grudge: z.number(),
    scandal: z.number(),
    allyMoodlet: z.string(),
    enemyMoodlet: z.string(),
    enemy: z.object({
      actionChancePerDay: z.number(),
      actions: z.record(z.enum(['gossip', 'refuse_trade', 'block_match', 'accuse']), z.number()),
      gossipRumor: z.string(),
      gossipStrength: z.number(),
      tradeBanDays: durSchema,
      blockMatchDays: durSchema,
    }),
    ally: z.object({
      matchBonus: z.number(),
      friendlyMatchBonus: z.number(),
      rivalMatchPenalty: z.number(),
      enemyMatchPenalty: z.number(),
      guaranteeMaxS: z.number(),
      helpChancePerDay: z.number(),
      helpMoneyS: z.number(),
      helpCooldown: durSchema,
    }),
    nonClanHouseholds: z.array(z.string()),
    major: z.array(z.object({
      key: z.string(),
      fame: z.number().nullable(),
      law: z.enum(LAWS),
      heraldry: heraldrySchema.nullable(),
      motto: z.string().nullable(),
      mottoTags: z.array(z.string()),
    }).loose()),
    pairs: z.array(z.object({ a: z.string(), b: z.string(), level: z.enum(REL_LEVELS) })),
  }).loose(),
  inheritance: z.object({
    laws: z.array(z.enum(LAWS)),
    defaultLaw: z.enum(LAWS),
    estateLaw: z.record(z.string(), z.enum(LAWS)),
    defaults: z.object({ bastardsLast: z.boolean(), clergyLast: z.boolean(), marriedDaughtersLast: z.boolean(), malePreference: z.boolean() }),
    othersShare: z.number(),
    othersCap: z.number(),
    minHeadStage: z.string(),
    adultStages: z.array(z.string()),
    splitAdultsOnPrimogeniture: z.boolean(),
    will: z.object({ readingLevel: z.number(), priestFee: z.number(), fallback: z.enum(['primogeniture', 'equal']), writtenMoodlet: z.string().nullable() }),
    dispute: z.object({
      friendshipBelow: z.number(),
      shareGapAbove: z.number(),
      affectionBelow: z.number(),
      chance: z.number(),
      card: z.string(),
      flags: z.array(z.string()),
      flagDays: durSchema,
      disownOption: z.number().int(),
    }),
    moodlets: z.object({ newHead: z.string(), received: z.string(), slighted: z.string() }),
    recentDays: durSchema,
  }).loose(),
  heirlooms: z.object({
    max: z.number().int(),
    useMoodlet: z.string(),
    useXpBonus: z.number(),
    damagedEffectMult: z.number(),
    useMemoryImportance: z.number(),
    designateMemoryImportance: z.number(),
    sellFame: z.number(),
    sellMoodlet: z.string(),
    sellRumor: z.string(),
    undesignateFame: z.number(),
    undesignateMoodlet: z.string(),
    damagedMoodlet: z.string(),
    lostMoodlet: z.string(),
    recoveredMoodlet: z.string(),
    lostRumor: z.string(),
    skills: z.record(z.string(), z.string()),
    materials: z.record(z.string(), z.string()),
    defaultMaterial: z.string(),
    repairSkills: z.record(z.string(), z.string()),
    repairLevel: z.number(),
    damageKinds: z.object({ fire: z.string(), wear: z.string(), card: z.string() }),
    recovery: z.object({
      stolen: z.array(z.string()),
      seized: z.array(z.string()),
      confiscated: z.array(z.string()),
      chancePerDay: z.number(),
      firstAfter: durSchema,
    }),
    seizeCount: z.number().int(),
    splitApproveFriendship: z.number(),
  }).loose(),
  servants: z.object({
    hireEstates: z.array(z.string()),
    householdCap: z.number().int(),
    roles: z.record(z.enum(SERVANT_ROLES), z.object({ duties: z.array(z.string()), wagePerDay: z.number(), careBaby: z.boolean().optional(), careHorse: z.boolean().optional() })),
    payEvery: durSchema,
    dutyAdMult: z.number(),
    minStages: z.array(z.string()),
    loyalty: z.object({
      start: z.number(),
      paid: z.number(),
      unpaid: z.number(),
      treatmentMult: z.number(),
      towardFriendshipPerDay: z.number(),
      theftBelow: z.number(),
      theftChancePerDay: z.number(),
      heirloomShare: z.number(),
      moneyStealS: z.number(),
      caughtChance: z.number(),
      leakBelow: z.number(),
      leakChancePerDay: z.number(),
      leakRumors: z.array(z.string()),
      leakStrength: z.number(),
      quitBelow: z.number(),
    }),
    wellServedMoodlet: z.string(),
    wellServedLoyalty: z.number(),
    theftMoodlet: z.string(),
    theftRumor: z.string(),
    caughtCard: z.string(),
    stolenCard: z.string(),
    romanceCard: z.string(),
    romanceFlag: z.string(),
    romanceAbove: z.number(),
    romanceFame: z.number(),
    dismissFlag: z.string(),
  }).loose(),
}).loose();
export type ClansData = z.infer<typeof clansSchema>;

/** "$comment" 설명 칸을 뺀 사본 */
function stripComments(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripComments);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!k.startsWith('$')) out[k] = stripComments(x);
    return out;
  }
  return v;
}

/** 원본 JSON 검사 (틀리면 throw) */
export function parseClans(raw: unknown): ClansData {
  const d = clansSchema.parse(stripComments(raw));
  const problems: string[] = [];
  const t = d.fame.tiers;
  for (let i = 0; i < t.length; i++) {
    if (t[i].id !== TIERS[i]) problems.push(`fame.tiers[${i}] 는 ${TIERS[i]} 이어야 함`);
    if (i > 0 && t[i].min <= t[i - 1].min) problems.push('fame.tiers min 이 오름차순이 아님');
  }
  const lv = d.relations.levels;
  for (let i = 0; i < lv.length; i++) if (lv[i].id !== REL_LEVELS[i]) problems.push(`relations.levels[${i}] 는 ${REL_LEVELS[i]} 이어야 함`);
  const keys = new Set(d.relations.major.map((m) => m.key));
  for (const p of d.relations.pairs) if (!keys.has(p.a) || !keys.has(p.b)) problems.push(`relations.pairs ${p.a}/${p.b} 가 major 에 없음`);
  for (const m of d.relations.major) for (const tg of m.mottoTags) if (!(tg in d.motto.tags)) problems.push(`${m.key}: 가훈 태그 ${tg} 없음`);
  for (const r of SERVANT_ROLES) if (!d.servants.roles[r]) problems.push(`servants.roles.${r} 없음`);
  if (problems.length) throw new Error(`clans.json: ${problems.join('; ')}`);
  return d;
}

/** SimData.family.houses (clans.json) → 검증된 데이터. 없으면 null (가문 체계 꺼짐) */
export function clansFrom(family: Record<string, unknown> | undefined): ClansData | null {
  const raw = family?.houses;
  return raw === undefined ? null : parseClans(raw);
}

/** 기간 → 게임 날 (lifespan 은 수명 배수를 곱함) */
export function durDays(d: Dur, lifespan: number, seasonDays = 7): number {
  if (d.scale === 'lifespan') return d.value * lifespan;
  if (d.scale === 'season') return d.value * seasonDays;
  if (d.scale === 'per_life') return d.value;
  return d.value;
}

export const LIFE_ORDER: readonly LifeStage[] = ['baby', 'toddler', 'child', 'teen', 'young', 'adult', 'elder'];
/** 나이 비교: 단계가 높을수록, 같은 단계면 그 단계 경과 일이 많을수록 나이가 많음 (단계가 바뀌면 ageDays 가 0 이 되므로) */
export function olderFirst(a: Person, b: Person): number {
  const d = LIFE_ORDER.indexOf(b.lifeStage) - LIFE_ORDER.indexOf(a.lifeStage);
  if (d) return d;
  if (b.ageDays !== a.ageDays) return b.ageDays - a.ageDays;
  return a.id - b.id;
}
export function stageAtLeast(p: Person, stage: string): boolean {
  return LIFE_ORDER.indexOf(p.lifeStage) >= LIFE_ORDER.indexOf(stage as LifeStage);
}

/** 특성 또는 보상 특성 (보상은 counters 'reward:<id>', inner.ts) */
export function hasTraitOrReward(p: Person, id: string, kind: 'trait' | 'reward' | 'any' = 'any'): boolean {
  if (kind !== 'reward' && p.traits.includes(id)) return true;
  if (kind !== 'trait' && (p.counters.get(`reward:${id}`) ?? 0) > 0) return true;
  return false;
}

// ------------------------------------------------------------------ 호스트

/**
 * 가문 모듈 공통 창구 (리드가 sim.ts 에서 하나의 객체로 구현).
 * inheritance/heirlooms/servants 의 Host 가 이것을 넓힘
 */
export interface HouseHost {
  /** 살아 있는 인물 (방문객 제외) */
  readonly persons: readonly Person[];
  readonly rng: Rng;
  day(): number;
  /** 수명 배수 (29-0) */
  lifespan(): number;
  /** 조작 가문의 가구인가 (보통 가구 1) */
  controlled(household: number): boolean;
  /** 가정 대표 신분 (= 가장의 개인 신분, 16-2. E 의 estates.ts) */
  householdEstate(household: number): string;
  moodlet(p: Person, id: string): void;
  memory(p: Person, kind: string, importance: number, valence: number, withPerson: number): void;
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
  news(kind: string, args: Record<string, string | number>, subjects: Person[]): void;
  /** 연대기 삽화 (24-2) */
  chronicle(trigger: string, subjects: Person[], args?: Record<string, string | number>): void;
  rumor(subject: Person, kind: string, good: boolean, strength: number): void;
  /** 사건 카드 제안 (Simulation.offerCard) */
  offerCard(p: Person, cardId: string, vars?: Record<string, string | number>, other?: Person | null): void;
  /** 두 사람 우정 (−100~100, 관계 없으면 0) */
  friendship(a: Person, b: Person): number;
  skillLevel(p: Person, skill: string): number;
  /** 가구 돈 (동화), 한 인생 저축 S (17-4, 가정 대표 신분 기준, 동화) */
  money(household: number): number;
  savingsS(household: number): number;
}

export interface ClansHost extends HouseHost {
  /** 소원 주기 (가훈 16-1). 이미 있거나 못 주면 false */
  addWish(p: Person, wishId: string): boolean;
  /** 가구 사이 돈 옮기기 (동맹 도움). 못 옮기면 false */
  transferMoney(fromHousehold: number, toHousehold: number, amount: number, reason: string): boolean;
  /** 칭호 (가계도: 기사 경, 영주 등). 없으면 null */
  title?(p: Person): string | null;
  /** 원수 가문의 고발 (M9 재판 연결). 험담·거래 거부·혼사 방해는 이 모듈이 처리 */
  accuse?(from: Person, target: Person): void;
  /** 스킬 분류 (skills.json category) */
  skillCategory?(skill: string): string | null;
}

// ------------------------------------------------------------------ 가문

export interface LawOptions {
  bastardsLast: boolean;
  clergyLast: boolean;
  marriedDaughtersLast: boolean;
  malePreference: boolean;
}

export interface Clan {
  id: number;
  /** people.json 가문 키 (h_ashford …) 또는 null */
  key: string | null;
  /** 가문명: i18n 키(house.*) 또는 플레이어가 적은 이름. null = 가문명 없음 (농노) */
  name: string | null;
  households: number[];
  /** 가장 (살아 있는 인물 id, 0 없음) */
  headId: number;
  fame: number;
  heraldry: HeraldrySpec | null;
  /** 가훈: i18n 키(clan.motto.*) 또는 적은 글 (20자) */
  motto: string | null;
  mottoTags: string[];
  law: InheritanceLaw;
  lawOpts: LawOptions;
  founded: number;
  /** 갈라져 나온 가문 (의절, 16-5 상속 분쟁) */
  parent: number;
  extinct: boolean;
}

/** 가계도 기록 (16-1): 죽은 사람은 여기만 남음 */
export interface TreeRecord {
  id: number;
  name: string;
  sex: 'male' | 'female';
  clanId: number;
  birthClan: number;
  mother: number;
  father: number;
  spouse: number;
  estate: string;
  birthDay: number;
  deathDay: number;
  cause: string | null;
  title: string | null;
  honor: number;
  bastard: boolean;
  disowned: boolean;
}

export interface TreeNode extends TreeRecord {
  alive: boolean;
  /** 초점 인물 기준 세대 (0 = 가장 위) */
  generation: number;
  /** 이 윗대가 더 있음 (펼쳐 보기) */
  hasOlder: boolean;
}

export interface RewardEffects {
  ids: string[];
  loanRateMult: number;
  matchQuality: number;
  churchGainMult: number;
  fameLossMult: number;
}

export interface EnemyAction {
  kind: 'gossip' | 'refuse_trade' | 'block_match' | 'accuse';
  from: number;
  to: number;
}

const pairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

export class Clans {
  readonly clans = new Map<number, Clan>();
  private byHousehold = new Map<number, number>();
  private seq = 0;
  /** 가문 쌍 관계 점수 (−100~100) */
  private rel = new Map<string, number>();
  /** 가계도 기록 (살아 있는 사람은 태어날 때/등록할 때 시작, 죽으면 확정) */
  readonly records = new Map<number, TreeRecord>();
  readonly bastards = new Set<number>();
  /** 거래 거부 (가문 쌍 → 끝나는 날), 혼사 방해 (가문 → 끝나는 날), 동맹 도움 마지막 날 */
  private tradeBan = new Map<string, number>();
  private matchBlock = new Map<number, number>();
  private helpAt = new Map<number, number>();
  /** 가훈 소원 (인물 id → 준 소원 id 들) */
  private mottoWishes = new Map<number, Set<string>>();
  /** 하인 등 가문 사람이 아닌 식구 (servants.ts 가 채움) */
  memberFilter: (p: Person) => boolean = () => true;

  constructor(private host: ClansHost, readonly d: ClansData) {}

  // ---------------------------------------------------------------- 등록

  register(opts: {
    households: number[];
    name: string | null;
    key?: string | null;
    estate?: string;
    fame?: number;
    heraldry?: HeraldrySpec | null;
    motto?: string | null;
    mottoTags?: string[];
    law?: InheritanceLaw;
    headId?: number;
    parent?: number;
  }): Clan {
    const estate = opts.estate ?? (opts.households.length ? this.host.householdEstate(opts.households[0]) : 'freeman');
    const c: Clan = {
      id: ++this.seq,
      key: opts.key ?? null,
      name: this.d.names.noNameEstates.includes(estate) ? null : opts.name,
      households: [],
      headId: 0,
      fame: this.clampFame(opts.fame ?? this.d.fame.start.normal),
      heraldry: opts.heraldry ?? null,
      motto: opts.motto ?? null,
      mottoTags: [...(opts.mottoTags ?? [])],
      law: this.d.inheritance.estateLaw[estate] ?? opts.law ?? this.d.inheritance.defaultLaw,
      lawOpts: { ...this.d.inheritance.defaults },
      founded: this.host.day(),
      parent: opts.parent ?? 0,
      extinct: false,
    };
    this.clans.set(c.id, c);
    for (const hh of opts.households) this.addHousehold(c.id, hh);
    const head = opts.headId ? this.host.persons.find((p) => p.id === opts.headId) : null;
    if (head) c.headId = head.id;
    else this.pickDefaultHead(c);
    for (const p of this.members(c.id)) this.touchRecord(p);
    return c;
  }

  /**
   * 마을 가문 등록 (시작 시 1회): people.json 가정 목록 → 가문. clans.json major 에 있으면 그 명성·문장·가훈·상속법,
   * 없으면 형편(wealth)별 시작 명성. nonClanHouseholds(교회)는 가문이 아님. 주요 가문 쌍 관계도 넣음
   */
  fromTown(list: { household: number; key: string | null; nameKey: string | null; estate: string; wealth?: string }[]): void {
    const R = this.d.relations;
    const keyToClan = new Map<string, number>();
    for (const h of list) {
      if (h.key && R.nonClanHouseholds.includes(h.key)) continue;
      if (this.byHousehold.has(h.household)) continue;
      const m = h.key ? R.major.find((x) => x.key === h.key) : undefined;
      const fame = m?.fame ?? this.d.fame.wealthStart[h.wealth ?? 'normal'] ?? this.d.fame.start.normal;
      const c = this.register({
        households: [h.household],
        name: h.nameKey,
        key: h.key,
        estate: h.estate,
        fame,
        heraldry: m?.heraldry ?? null,
        motto: m?.motto ?? null,
        mottoTags: m?.mottoTags ?? [],
        law: m?.law,
      });
      if (h.key) keyToClan.set(h.key, c.id);
    }
    for (const p of R.pairs) {
      const a = keyToClan.get(p.a);
      const b = keyToClan.get(p.b);
      if (a && b) this.rel.set(pairKey(a, b), R.levelScore[p.level]);
    }
  }

  clan(id: number): Clan | null {
    return this.clans.get(id) ?? null;
  }
  clanIdOfHousehold(hh: number): number {
    return this.byHousehold.get(hh) ?? 0;
  }
  clanOfHousehold(hh: number): Clan | null {
    return this.clan(this.clanIdOfHousehold(hh));
  }
  clanOf(p: Person): Clan | null {
    return this.memberFilter(p) ? this.clanOfHousehold(p.household) : null;
  }
  byKey(key: string): Clan | null {
    for (const c of this.clans.values()) if (c.key === key) return c;
    return null;
  }

  /** 가문 사람 (살아 있는, 하인 제외) */
  members(clanId: number): Person[] {
    const c = this.clan(clanId);
    if (!c) return [];
    return this.host.persons.filter((p) => c.households.includes(p.household) && this.memberFilter(p));
  }

  addHousehold(clanId: number, hh: number): void {
    const old = this.byHousehold.get(hh);
    if (old === clanId) return;
    if (old) {
      const oc = this.clan(old);
      if (oc) oc.households = oc.households.filter((x) => x !== hh);
    }
    const c = this.clan(clanId);
    if (!c) return;
    c.households.push(hh);
    this.byHousehold.set(hh, clanId);
  }

  /** 분가 (15-8, 16-2): 새 가정은 같은 가문, 분가 시점 신분 유지 (신분은 E 의 estates.ts) */
  onHouseholdSplit(fromHh: number, newHh: number): void {
    const cid = this.clanIdOfHousehold(fromHh);
    if (cid) this.addHousehold(cid, newHh);
  }

  /** 가정이 비었음 (이사 나감/모두 죽음): 가문에서 빼고, 가정이 하나도 없으면 가문 끝 */
  onHouseholdGone(hh: number): void {
    const c = this.clanOfHousehold(hh);
    this.byHousehold.delete(hh);
    if (!c) return;
    c.households = c.households.filter((x) => x !== hh);
    if (!c.households.length || !this.members(c.id).length) c.extinct = true;
  }

  // ---------------------------------------------------------------- 가장

  head(clanId: number): Person | null {
    const c = this.clan(clanId);
    if (!c || !c.headId) return null;
    return this.host.persons.find((p) => p.id === c.headId) ?? null;
  }

  isHead(p: Person): boolean {
    const c = this.clanOf(p);
    return !!c && c.headId === p.id;
  }

  /** 가장 바꾸기: 살아 있는 가문 사람만 (유령 불가, 20-6) */
  setHead(clanId: number, p: Person | null): boolean {
    const c = this.clan(clanId);
    if (!c) return false;
    if (!p) {
      c.headId = 0;
      return true;
    }
    if (!this.host.persons.includes(p) || p.status === 'ghost' || this.clanOf(p)?.id !== clanId) return false;
    c.headId = p.id;
    return true;
  }

  private pickDefaultHead(c: Clan): void {
    const adults = this.members(c.id).filter((p) => stageAtLeast(p, this.d.inheritance.minHeadStage)).sort(olderFirst);
    // 가장 나이 많은 사람 중 노년은 한 칸 뒤로 (은퇴): 성인이 있으면 성인 먼저
    const pick = adults.find((p) => p.lifeStage !== 'elder') ?? adults[0] ?? this.members(c.id).sort(olderFirst)[0];
    c.headId = pick?.id ?? 0;
  }

  // ---------------------------------------------------------------- 명성

  clampFame(v: number): number {
    return Math.max(this.d.fame.min, Math.min(this.d.fame.max, v));
  }

  fame(clanId: number): number {
    return this.clan(clanId)?.fame ?? this.d.fame.start.normal;
  }

  /** 가구의 가문 명성 (가문이 없으면 보통 시작 값). Simulation.fame 대신 */
  fameOfHousehold(hh: number): number {
    return this.clanOfHousehold(hh)?.fame ?? this.d.fame.start.normal;
  }

  tierOf(fame: number): FameTier {
    let t: FameTier = 'dishonored';
    for (const x of this.d.fame.tiers) if (fame >= x.min) t = x.id;
    return t;
  }

  tier(clanId: number): FameTier {
    return this.tierOf(this.fame(clanId));
  }

  /** 명성 직접 설정 (시작 프리셋: 몰락 200 / 보통 300 / 부유 400, 미리 만든 가문) */
  setFame(clanId: number, v: number): void {
    const c = this.clan(clanId);
    if (c) c.fame = this.clampFame(v);
  }

  /** 명성 변화 원시 적용 (배수·개인 명예는 honor.ts). 바뀐 양 */
  addFameRaw(clanId: number, delta: number): number {
    const c = this.clan(clanId);
    if (!c) return 0;
    const before = c.fame;
    c.fame = this.clampFame(c.fame + delta);
    return c.fame - before;
  }

  // ---------------------------------------------------------------- 가문 보상

  private tierIndex(t: FameTier): number {
    return TIERS.indexOf(t);
  }

  /** 지금 켜진 가문 보상 (명성 단계 + 가문 사람 스킬 조건) */
  activeRewards(clanId: number): string[] {
    const c = this.clan(clanId);
    if (!c) return [];
    const ti = this.tierIndex(this.tierOf(c.fame));
    const mem = this.members(clanId);
    const out: string[] = [];
    for (const r of this.d.rewards.list) {
      if (r.minTier && ti < this.tierIndex(r.minTier)) continue;
      if (r.maxTier && ti > this.tierIndex(r.maxTier)) continue;
      if (r.memberSkill && !mem.some((p) => this.host.skillLevel(p, r.memberSkill!.skill) >= r.memberSkill!.level)) continue;
      out.push(r.id);
    }
    return out;
  }

  rewardEffects(clanId: number): RewardEffects {
    const ids = this.activeRewards(clanId);
    const e: RewardEffects = { ids, loanRateMult: 1, matchQuality: 0, churchGainMult: 1, fameLossMult: 1 };
    for (const id of ids) {
      const r = this.d.rewards.list.find((x) => x.id === id)!;
      if (r.loanRateMult) e.loanRateMult *= r.loanRateMult;
      if (r.matchQuality) e.matchQuality += r.matchQuality;
      if (r.churchGainMult) e.churchGainMult *= r.churchGainMult;
      if (r.fameLossMult) e.fameLossMult *= r.fameLossMult;
    }
    return e;
  }

  /** 스킬 경험치 배수 (가문 보상, 예: 대장장이 명가 → 공예 분류 +10%). skills.ts 가 경험치에 곱함 */
  skillXpMult(p: Person, skill: string): number {
    const c = this.clanOf(p);
    if (!c) return 1;
    const cat = this.host.skillCategory?.(skill) ?? null;
    let m = 1;
    const seen = new Set<string>();
    for (const id of this.activeRewards(c.id)) {
      const r = this.d.rewards.list.find((x) => x.id === id)!;
      const sx = r.skillXp;
      if (!sx) continue;
      const hit = (sx.skills && sx.skills.includes(skill)) || (sx.category && sx.category === cat);
      // 같은 분류 보상이 둘(대장장이·목수 명가)이어도 한 번만
      const k = `${sx.category ?? ''}|${(sx.skills ?? []).join(',')}`;
      if (hit && !seen.has(k)) {
        seen.add(k);
        m *= sx.mult;
      }
    }
    return m;
  }

  /** 대출 이율 배수 (17-6) */
  loanRateMult(hh: number): number {
    const c = this.clanOfHousehold(hh);
    return c ? this.rewardEffects(c.id).loanRateMult : 1;
  }

  /** 혼사 후보 질 보정 (14-4 중매혼) */
  matchQuality(hh: number): number {
    const c = this.clanOfHousehold(hh);
    return c ? this.rewardEffects(c.id).matchQuality : 0;
  }

  // ---------------------------------------------------------------- 가문명, 문장, 가훈, 상속법

  /** 가문명 얻기 (농노 → 자유민, family_name_choice 카드): 가족 전원 무드렛, 소식, 연대기 */
  grantFamilyName(clanId: number, name: string): boolean {
    const c = this.clan(clanId);
    if (!c || !name.trim()) return false;
    const first = c.name === null;
    c.name = name.trim();
    const mem = this.members(clanId);
    if (first) {
      for (const p of mem) this.host.moodlet(p, this.d.names.gotNameMoodlet);
      this.host.chronicle('family_name', mem, { name: c.name });
      this.host.news('clan_named', { name: c.name }, mem.slice(0, 1));
    }
    return true;
  }

  /** 가문명 없는 신분으로 떨어짐 (자유민 → 농노 하락은 이름을 지우지 않음: 한 번 얻은 성은 남음) */
  hasName(clanId: number): boolean {
    return !!this.clan(clanId)?.name;
  }

  /** 문장 (16-1 문장 편집기). ids 는 heraldry.json 요소. 금속 위 금속·색 위 색은 경고만 */
  setHeraldry(clanId: number, spec: HeraldrySpec, catalog?: HeraldryCatalog): { ok: boolean; reason?: string; warnings: string[] } {
    const c = this.clan(clanId);
    if (!c) return { ok: false, reason: 'no_clan', warnings: [] };
    if (catalog) {
      const bad = heraldryUnknown(spec, catalog);
      if (bad) return { ok: false, reason: `unknown_${bad}`, warnings: [] };
    }
    c.heraldry = { ...spec, tinctures: [spec.tinctures[0], spec.tinctures[1]] };
    return { ok: true, warnings: catalog ? heraldryWarnings(spec, catalog) : [] };
  }

  /** 가훈 (최대 20자, 키워드 태그 최대 maxTags) */
  setMotto(clanId: number, text: string | null, tags: string[] = []): { ok: boolean; reason?: string } {
    const c = this.clan(clanId);
    if (!c) return { ok: false, reason: 'no_clan' };
    const t = text?.trim() ?? '';
    if ([...t].length > this.d.motto.maxLength) return { ok: false, reason: 'too_long' };
    const uniq = [...new Set(tags)];
    if (uniq.length > this.d.motto.maxTags) return { ok: false, reason: 'too_many_tags' };
    for (const tg of uniq) if (!(tg in this.d.motto.tags)) return { ok: false, reason: 'unknown_tag' };
    c.motto = t || null;
    c.mottoTags = t ? uniq : [];
    return { ok: true };
  }

  /** 하루: 가훈 태그의 소원이 가족에게 가끔 (16-1) */
  dailyMotto(): number {
    let n = 0;
    const M = this.d.motto;
    for (const c of this.clans.values()) {
      if (c.extinct || !c.motto || !c.mottoTags.length) continue;
      for (const p of this.members(c.id)) {
        if (!M.minStages.includes(p.lifeStage)) continue;
        if (this.host.rng.next() >= M.wishChancePerDay) continue;
        const tag = c.mottoTags[this.host.rng.int(c.mottoTags.length)];
        const pool = M.tags[tag] ?? [];
        if (!pool.length) continue;
        const w = pool[this.host.rng.int(pool.length)];
        if (this.host.addWish(p, w)) {
          const s = this.mottoWishes.get(p.id) ?? new Set<string>();
          s.add(w);
          this.mottoWishes.set(p.id, s);
          n++;
        }
      }
    }
    return n;
  }

  /** 소원을 이룸 (inner.ts): 가훈에서 온 소원이면 "가훈대로" 무드렛 */
  onWishDone(p: Person, wishId: string): boolean {
    const s = this.mottoWishes.get(p.id);
    if (!s?.has(wishId)) return false;
    s.delete(wishId);
    this.host.moodlet(p, this.d.motto.inspiredMoodlet);
    return true;
  }

  /** 상속법 (가문 만들 때 선택, 귀족·기사는 영지 법 → 바꿀 수 없음) */
  setLaw(clanId: number, law: InheritanceLaw, opts: Partial<LawOptions> = {}): { ok: boolean; reason?: string } {
    const c = this.clan(clanId);
    if (!c) return { ok: false, reason: 'no_clan' };
    const est = c.households.length ? this.host.householdEstate(c.households[0]) : '';
    const fixed = this.d.inheritance.estateLaw[est];
    if (fixed && fixed !== law) return { ok: false, reason: 'estate_law' };
    c.law = law;
    c.lawOpts = { ...c.lawOpts, ...opts };
    return { ok: true };
  }

  // ---------------------------------------------------------------- 가계도

  /** 기록 갱신 (살아 있는 사람: 이름·배우자·신분·명예가 바뀌면 여기에 따라감) */
  touchRecord(p: Person): TreeRecord {
    const old = this.records.get(p.id);
    const clanId = this.clanOf(p)?.id ?? old?.clanId ?? 0;
    const r: TreeRecord = {
      id: p.id,
      name: p.name,
      sex: p.sex,
      clanId,
      birthClan: old?.birthClan ?? clanId,
      mother: p.mother,
      father: p.father,
      spouse: p.spouse || old?.spouse || 0,
      estate: p.estate,
      birthDay: old?.birthDay ?? -1,
      deathDay: old?.deathDay ?? -1,
      cause: old?.cause ?? null,
      title: this.host.title?.(p) ?? old?.title ?? null,
      honor: p.honor,
      bastard: this.bastards.has(p.id),
      disowned: old?.disowned ?? false,
    };
    this.records.set(p.id, r);
    return r;
  }

  /** 출생 (15-2): 태어난 날·태어난 가문 기록. 사생아(어머니 배우자가 아버지가 아님, 성직자의 자녀)는 bastard */
  onBirth(baby: Person, bastard = false): void {
    if (bastard) this.bastards.add(baby.id);
    const r = this.touchRecord(baby);
    r.birthDay = this.host.day();
    r.birthClan = r.clanId;
  }

  markBastard(p: Person, on = true): void {
    if (on) this.bastards.add(p.id);
    else this.bastards.delete(p.id);
    const r = this.records.get(p.id);
    if (r) r.bastard = on;
  }

  /** 사망 기록 (사인, 칭호, 명예는 기록으로 남음). 목록에서 빼기 전에 부름 */
  recordDeath(p: Person, cause: string): TreeRecord {
    const r = this.touchRecord(p);
    r.deathDay = this.host.day();
    r.cause = cause;
    return r;
  }

  /** 태어난 가문 (출가한 딸 판정) */
  birthClanOf(p: Person): number {
    return this.records.get(p.id)?.birthClan ?? this.clanOf(p)?.id ?? 0;
  }

  private nodeInfo(id: number): (TreeRecord & { alive: boolean }) | null {
    const live = this.host.persons.find((p) => p.id === id);
    if (live) return { ...this.touchRecord(live), alive: true };
    const r = this.records.get(id);
    return r ? { ...r, alive: false } : null;
  }

  private childrenOf(id: number): number[] {
    const ids = new Set<number>();
    for (const r of this.records.values()) if (r.mother === id || r.father === id) ids.add(r.id);
    for (const p of this.host.persons) if (p.mother === id || p.father === id) ids.add(p.id);
    return [...ids];
  }

  /**
   * 가계도 (16-1): 초점 인물에서 위로 (generations − 1)대 조상까지, 그 조상들의 자손을 generations 대까지.
   * 배우자도 같은 세대로. 맨 위 조상에게 부모 기록이 더 있으면 hasOlder (펼쳐 보기)
   */
  familyTree(focusId: number, generations = this.d.tree.generations): TreeNode[] {
    const focus = this.nodeInfo(focusId);
    if (!focus) return [];
    // 위로
    let level: number[] = [focusId];
    let up = 0;
    while (up < generations - 1) {
      const parents = new Set<number>();
      for (const id of level) {
        const r = this.nodeInfo(id);
        if (r?.mother && this.nodeInfo(r.mother)) parents.add(r.mother);
        if (r?.father && this.nodeInfo(r.father)) parents.add(r.father);
      }
      if (!parents.size) break;
      level = [...parents];
      up++;
    }
    const out = new Map<number, TreeNode>();
    const add = (id: number, gen: number): boolean => {
      if (out.has(id)) return false;
      const r = this.nodeInfo(id);
      if (!r) return false;
      const hasOlder = gen === 0 && ((!!r.mother && !!this.nodeInfo(r.mother)) || (!!r.father && !!this.nodeInfo(r.father)));
      out.set(id, { ...r, generation: gen, hasOlder });
      return true;
    };
    let frontier = level;
    for (let g = 0; g < generations && frontier.length; g++) {
      const next = new Set<number>();
      for (const id of frontier) {
        add(id, g);
        const r = out.get(id);
        if (r?.spouse) add(r.spouse, g);
        for (const k of [id, r?.spouse ?? 0]) if (k) for (const ch of this.childrenOf(k)) next.add(ch);
      }
      frontier = [...next].filter((x) => !out.has(x));
    }
    return [...out.values()].sort((a, b) => a.generation - b.generation || a.id - b.id);
  }

  // ---------------------------------------------------------------- 가문 간 관계 (16-6)

  relationScore(a: number, b: number): number {
    if (a === b) return 100;
    return this.rel.get(pairKey(a, b)) ?? 0;
  }

  levelOf(score: number): RelLevel {
    for (const l of this.d.relations.levels) if (score >= l.min) return l.id;
    return 'enemy';
  }

  relationLevel(a: number, b: number): RelLevel {
    return this.levelOf(this.relationScore(a, b));
  }

  /** 관계 바꾸기. 단계가 바뀌면 조작 가문 식구에게 무드렛 (동맹 기쁨 / 원수 분노) */
  changeRelation(a: number, b: number, delta: number, reason: string): RelLevel {
    if (!a || !b || a === b) return 'neutral';
    const before = this.relationLevel(a, b);
    const s = Math.max(-100, Math.min(100, this.relationScore(a, b) + delta));
    this.rel.set(pairKey(a, b), s);
    const after = this.levelOf(s);
    if (after !== before) this.onLevelChanged(a, b, after, reason);
    return after;
  }

  setRelationLevel(a: number, b: number, level: RelLevel, reason = 'set'): void {
    const before = this.relationLevel(a, b);
    this.rel.set(pairKey(a, b), this.d.relations.levelScore[level]);
    if (before !== level) this.onLevelChanged(a, b, level, reason);
  }

  private onLevelChanged(a: number, b: number, level: RelLevel, reason: string): void {
    const R = this.d.relations;
    const mood = level === 'ally' ? R.allyMoodlet : level === 'enemy' ? R.enemyMoodlet : null;
    for (const cid of [a, b]) {
      const mem = this.members(cid);
      if (mood) for (const p of mem) if (stageAtLeast(p, 'teen')) this.host.moodlet(p, mood);
      const other = this.clan(cid === a ? b : a);
      const lead = mem.find((p) => this.host.controlled(p.household));
      if (lead) this.host.notice(lead, 'clan_relation', { level: `clan.rel.${level}`, clan: other?.name ?? 'clan.unnamed', reason: `clan.rel.reason.${reason}` });
    }
    if (level === 'ally' || level === 'enemy') {
      const subjects = [this.head(a), this.head(b)].filter((x): x is Person => !!x);
      this.host.chronicle(level === 'ally' ? 'clan_alliance' : 'clan_feud', subjects);
    }
  }

  /** 혼인 → 동맹 (16-6): 두 사람의 가문 점수를 동맹 이상으로 */
  onMarriage(a: Person, b: Person): void {
    const ca = this.clanOf(a)?.id ?? this.clanIdOfHousehold(a.household);
    const cb = this.clanOf(b)?.id ?? this.clanIdOfHousehold(b.household);
    if (!ca || !cb || ca === cb) return;
    const s = this.relationScore(ca, cb);
    if (s < this.d.relations.marriage) this.changeRelation(ca, cb, this.d.relations.marriage - s, 'marriage');
  }

  /** 원한(14-5) → 원수 쪽 */
  onGrudge(a: Person, b: Person): void {
    const ca = this.clanOf(a)?.id;
    const cb = this.clanOf(b)?.id;
    if (ca && cb && ca !== cb) this.changeRelation(ca, cb, this.d.relations.grudge, 'grudge');
  }

  /** 추문 (한 가문 사람이 다른 가문 사람과 불륜·파혼 등) → 원수 쪽 */
  onScandal(a: Person, b: Person): void {
    const ca = this.clanOf(a)?.id;
    const cb = this.clanOf(b)?.id;
    if (ca && cb && ca !== cb) this.changeRelation(ca, cb, this.d.relations.scandal, 'scandal');
  }

  allies(clanId: number): number[] {
    return [...this.clans.keys()].filter((x) => x !== clanId && !this.clans.get(x)!.extinct && this.relationLevel(clanId, x) === 'ally');
  }
  enemies(clanId: number): number[] {
    return [...this.clans.keys()].filter((x) => x !== clanId && !this.clans.get(x)!.extinct && this.relationLevel(clanId, x) === 'enemy');
  }

  /** 원수 가문의 거래 거부 중인가 (가게·장터 거래, 17장) */
  refusesTrade(hhA: number, hhB: number): boolean {
    const a = this.clanIdOfHousehold(hhA);
    const b = this.clanIdOfHousehold(hhB);
    if (!a || !b || a === b) return false;
    return (this.tradeBan.get(pairKey(a, b)) ?? -1) >= this.host.day();
  }

  /** 혼사 방해 중인가 (중매 후보 목록이 비고 승낙이 크게 불리) */
  matchBlocked(hh: number): boolean {
    const c = this.clanIdOfHousehold(hh);
    return !!c && (this.matchBlock.get(c) ?? -1) >= this.host.day();
  }

  /** 혼인 승낙 판정 보정 (14-4 가문 관계): 동맹 +, 우호 +, 경쟁 −, 원수 −− */
  matchModifier(hhA: number, hhB: number): number {
    const a = this.clanIdOfHousehold(hhA);
    const b = this.clanIdOfHousehold(hhB);
    if (!a || !b || a === b) return 0;
    const A = this.d.relations.ally;
    switch (this.relationLevel(a, b)) {
      case 'ally':
        return A.matchBonus;
      case 'friendly':
        return A.friendlyMatchBonus;
      case 'rival':
        return -A.rivalMatchPenalty;
      case 'enemy':
        return -A.enemyMatchPenalty;
      default:
        return 0;
    }
  }

  /** 빚 보증 (17-6): 이 금액을 보증해 줄 동맹 가문 (돈이 가장 많은 쪽). 없으면 0 */
  guarantor(clanId: number, amount: number): number {
    let best = 0;
    let bestMoney = -1;
    for (const a of this.allies(clanId)) {
      const c = this.clan(a)!;
      const hh = c.households[0];
      if (hh === undefined) continue;
      const cap = this.d.relations.ally.guaranteeMaxS * this.host.savingsS(hh);
      const m = this.host.money(hh);
      if (amount <= cap && m >= amount && m > bestMoney) {
        best = a;
        bestMoney = m;
      }
    }
    return best;
  }

  /** 잔치 참석 (19장): 동맹·우호 가문의 가장 (없으면 어른 한 명) */
  feastGuests(clanId: number): Person[] {
    const out: Person[] = [];
    for (const c of this.clans.values()) {
      if (c.id === clanId || c.extinct) continue;
      const lv = this.relationLevel(clanId, c.id);
      if (lv !== 'ally' && lv !== 'friendly') continue;
      const g = this.head(c.id) ?? this.members(c.id).find((p) => stageAtLeast(p, 'young'));
      if (g) out.push(g);
    }
    return out;
  }

  /**
   * 하루: 원수 가문의 자율 행동 (험담·거래 거부·혼사 방해·고발).
   * 조작 가문이 관계된 쌍만 실제로 무언가 일어남 (다른 쌍은 점수만 남음). 일어난 행동 목록
   */
  enemyDaily(): EnemyAction[] {
    const E = this.d.relations.enemy;
    const out: EnemyAction[] = [];
    const ids = [...this.clans.values()].filter((c) => !c.extinct).map((c) => c.id);
    const kinds = Object.keys(E.actions) as EnemyAction['kind'][];
    const weights = kinds.map((k) => E.actions[k]);
    const L = this.host.lifespan();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (this.relationLevel(ids[i], ids[j]) !== 'enemy') continue;
        for (const [from, to] of [[ids[i], ids[j]], [ids[j], ids[i]]]) {
          if (this.host.rng.next() >= E.actionChancePerDay) continue;
          const k = kinds[Math.max(0, this.host.rng.weighted(weights))];
          const actor = this.head(from) ?? this.members(from)[0] ?? null;
          const tgtMembers = this.members(to).filter((p) => stageAtLeast(p, 'young'));
          const target = this.head(to) ?? tgtMembers[0] ?? null;
          if (!target) continue;
          const day = this.host.day();
          if (k === 'gossip') this.host.rumor(target, E.gossipRumor, false, E.gossipStrength);
          else if (k === 'refuse_trade') this.tradeBan.set(pairKey(from, to), day + durDays(E.tradeBanDays, L));
          else if (k === 'block_match') this.matchBlock.set(to, day + durDays(E.blockMatchDays, L));
          else if (k === 'accuse' && actor) this.host.accuse?.(actor, target);
          const lead = this.members(to).find((p) => this.host.controlled(p.household));
          if (lead) this.host.notice(lead, 'clan_enemy_action', { kind: `clan.enemy.${k}`, clan: this.clan(from)?.name ?? 'clan.unnamed' });
          out.push({ kind: k, from, to });
        }
      }
    }
    return out;
  }

  /**
   * 하루: 동맹의 도움 (17-9 친척 도움과 같은 방식). hardship(가문) 이 참이면 동맹 가문이 S × helpMoneyS 를 보냄.
   * 보낸 동맹 id 목록
   */
  allyHelpDaily(hardship: (clanId: number) => boolean): { from: number; to: number; amount: number }[] {
    const A = this.d.relations.ally;
    const out: { from: number; to: number; amount: number }[] = [];
    const day = this.host.day();
    const cd = durDays(A.helpCooldown, this.host.lifespan());
    for (const c of this.clans.values()) {
      if (c.extinct || !hardship(c.id)) continue;
      if (day - (this.helpAt.get(c.id) ?? -1e9) < cd) continue;
      if (this.host.rng.next() >= A.helpChancePerDay) continue;
      const to = c.households[0];
      if (to === undefined) continue;
      for (const a of this.allies(c.id)) {
        const from = this.clan(a)!.households[0];
        if (from === undefined) continue;
        const amount = Math.round(A.helpMoneyS * this.host.savingsS(to));
        if (amount <= 0 || this.host.money(from) < amount * 2) continue;
        if (!this.host.transferMoney(from, to, amount, 'ally_help')) continue;
        this.helpAt.set(c.id, day);
        const lead = this.members(c.id).find((p) => this.host.controlled(p.household)) ?? this.head(c.id);
        if (lead) this.host.notice(lead, 'clan_ally_help', { clan: this.clan(a)!.name ?? 'clan.unnamed', n: amount });
        out.push({ from: a, to: c.id, amount });
        break;
      }
    }
    return out;
  }

  /**
   * 의절 (상속 분쟁 "형제를 집안에서 내친다", 16-5): 그 사람의 가정이 따로 떨어져 나가 새 가문(같은 이름)이 되고 원수.
   * 같은 가정에 살면 host 가 분가시킨 새 가구 번호(newHousehold)를 넘김
   */
  disown(clanId: number, p: Person, newHousehold: number | null = null): Clan | null {
    const c = this.clan(clanId);
    if (!c) return null;
    const hh = newHousehold ?? p.household;
    const n = this.register({ households: [], name: c.name, estate: this.host.householdEstate(hh), fame: c.fame, law: c.law, parent: c.id });
    this.addHousehold(n.id, hh);
    this.setHead(n.id, p);
    const r = this.touchRecord(p);
    r.disowned = true;
    r.clanId = n.id;
    this.setRelationLevel(c.id, n.id, 'enemy', 'disowned');
    return n;
  }

  // ---------------------------------------------------------------- 카드 플래그

  /** 카드 조건 플래그 (가문 쪽): head_of_house, no_family_name, has_motto, has_ally, has_feud */
  flags(p: Person): Set<string> {
    const out = new Set<string>();
    const c = this.clanOf(p);
    if (!c) return out;
    if (c.headId === p.id) out.add('head_of_house');
    if (!c.name) out.add('no_family_name');
    if (c.motto) out.add('has_motto');
    if (this.allies(c.id).length) out.add('has_ally');
    if (this.enemies(c.id).length) out.add('has_feud');
    return out;
  }
}

// ------------------------------------------------------------------ 문장 (sim 은 render 를 모르므로 id 목록만)

export interface HeraldryCatalog {
  shields: string[];
  divisions: { id: string; second: boolean }[];
  charges: string[];
  tinctures: { id: string; kind: 'metal' | 'colour' }[];
}

/** SimData.family.heraldry (heraldry.json 원본) → id 목록 */
export function heraldryCatalog(raw: unknown): HeraldryCatalog | null {
  const h = raw as { shields?: { id: string }[]; divisions?: { id: string; second?: boolean }[]; charges?: { id: string }[]; tinctures?: { id: string; kind: string }[] } | undefined;
  if (!h?.shields || !h.divisions || !h.charges || !h.tinctures) return null;
  return {
    shields: h.shields.map((x) => x.id),
    divisions: h.divisions.map((x) => ({ id: x.id, second: !!x.second })),
    charges: h.charges.map((x) => x.id),
    tinctures: h.tinctures.map((x) => ({ id: x.id, kind: x.kind === 'metal' ? 'metal' : 'colour' })),
  };
}

function heraldryUnknown(s: HeraldrySpec, c: HeraldryCatalog): string | null {
  if (!c.shields.includes(s.shield)) return 'shield';
  if (!c.divisions.some((d) => d.id === s.division)) return 'division';
  if (s.charge && !c.charges.includes(s.charge)) return 'charge';
  for (const t of [...s.tinctures, s.chargeTincture]) if (!c.tinctures.some((x) => x.id === t)) return 'tincture';
  return null;
}

/** 문장학 색 규칙 경고 (src/render/heraldry.ts tinctureWarnings 와 같은 판정) */
export function heraldryWarnings(s: HeraldrySpec, c: HeraldryCatalog): string[] {
  if (!s.charge) return [];
  const kind = (id: string) => c.tinctures.find((t) => t.id === id)?.kind;
  const div = c.divisions.find((d) => d.id === s.division);
  const fields = div?.second ? [...new Set(s.tinctures)] : [s.tinctures[0]];
  const ck = kind(s.chargeTincture);
  if (!ck) return [];
  if (fields.length > 1 && fields.some((f) => kind(f) !== ck)) return [];
  return fields.filter((f) => kind(f) === ck).map(() => (ck === 'metal' ? 'metal_on_metal' : 'colour_on_colour'));
}

// ------------------------------------------------------------------ 묶음 (리드가 sim.ts 에서 한 번에 만들 때)

import { Honor } from './honor';
import { Heirlooms, type HeirloomHost } from './heirlooms';
import { Inheritance, type InheritanceHost } from './inheritance';
import { Servants, type ServantHost } from './servants';

/** 가문 모듈 전체 창구 (sim.ts 가 하나의 객체로 구현) */
export type HouseAllHost = ClansHost & InheritanceHost & HeirloomHost & ServantHost;

export interface House {
  clans: Clans;
  honor: Honor;
  heirlooms: Heirlooms;
  inheritance: Inheritance;
  servants: Servants;
  /** 카드 조건 플래그 (가문·가보·하인·상속): cardsHost.flags 에 합침 */
  flags(p: Person): Set<string>;
  /** 자정: 평판 감쇠, 가훈 소원, 원수 자율, 되찾기 카드, 하인, 동맹 도움 */
  daily(hardship?: (clanId: number) => boolean): void;
}

export function createHouse(host: HouseAllHost, d: ClansData): House {
  const clans = new Clans(host, d);
  const honor = new Honor(host, clans, d);
  const heirlooms = new Heirlooms(host, clans, honor, d);
  const inheritance = new Inheritance(host, clans, heirlooms, d);
  const servants = new Servants(host, clans, heirlooms, honor, d);
  return {
    clans,
    honor,
    heirlooms,
    inheritance,
    servants,
    flags(p) {
      const out = clans.flags(p);
      for (const s of [heirlooms.flags(p), servants.flags(p), inheritance.flags(p)]) for (const f of s) out.add(f);
      return out;
    },
    daily(hardship) {
      honor.daily();
      clans.dailyMotto();
      clans.enemyDaily();
      heirlooms.daily();
      servants.daily();
      if (hardship) clans.allyHelpDaily(hardship);
    },
  };
}
