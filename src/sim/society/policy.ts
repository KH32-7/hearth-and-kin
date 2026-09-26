/**
 * 영주 정책 (GDD 18-4), 민심 (16-4), 영주 금고 (18-4), 영주 곡물 배급 (17-9), 탄원, NPC 영주 AI.
 * - 정책 6개: 세율 low/normal/high, 장터 free/guild, 사냥 ban/license/free, 치안 lax/normal/strict,
 *   역병 none/quarantine/lockdown, 축제 none/normal/grand. 효과 수치는 policy.json effects
 * - 민심 0~100: 값은 가문 모듈(Honor.morale)에 있음. 여기서는 정책별 목표 민심(50 + 정책 보정)으로 하루 pushPerDay 씩 밂.
 *   Honor.daily 가 50 쪽으로 하루 1 당기므로 push 가 그보다 커야 정책 효과가 남음 (평형 = 목표 ± 1)
 * - 낮으면 폭동/반란 (사건 카드 riot_brewing, 금고 손실, 영주 가문 명성 −), 높으면 영주 가문 명성 +
 * - 영주 금고: FiefSystem.treasury (house/fief.ts). 수입(세금·사용료·벌금)은 fief 가 받고, 지출(경비병 급여, 축제 지원, 곡물 배급, 전쟁)은 여기서
 * - 사적 유용: fief.embezzle (민심 −10, 가문 명성 −30, 발각 시 소문 embezzlement) 을 부르고 기록
 * - 정책 효과는 effects() 로 다른 모듈과 경제가 읽음 (세율, 물가 배수, 장인 수입, 범죄/발각/처벌, 역병 접촉, 장터 거래량, 축제 규모)
 * 무작위는 host.rng 만. 렌더러/DOM 없음 (워커)
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import type { Person } from '../people/person';

// ------------------------------------------------------------------ 공용 (justice/feud/plagueLite 도 씀)

export const scaleSchema = z.enum(['absolute', 'season', 'lifespan', 'per_life']);
export const durSchema = z.object({ value: z.number(), scale: scaleSchema });
export type Dur = z.infer<typeof durSchema>;

/**
 * 기간 → 게임일 (GDD 29-0): absolute 그대로, season = 값 × (계절 일수 / 7), lifespan = 값 × 수명 배수,
 * per_life = 한 인생 기대 횟수 (기간이 아님: perLifeDaily 로 하루 확률을 구함)
 */
export function durDays(d: Dur, lifespan: number, seasonDays = 7): number {
  if (d.scale === 'lifespan') return d.value * lifespan;
  if (d.scale === 'season') return d.value * (seasonDays / 7);
  return d.value;
}

/** per_life 기대 횟수 → 하루 확률 (29-0: 횟수 / (104 × 수명 배수)) */
export function perLifeDaily(d: Dur, lifespan: number): number {
  if (d.scale !== 'per_life') return d.value;
  return d.value / (104 * Math.max(0.1, lifespan));
}

/** 속도 필드 (/일): lifespan 이면 ÷ 수명 배수 */
export function perDay(d: Dur, lifespan: number): number {
  return d.scale === 'lifespan' ? d.value / Math.max(0.1, lifespan) : d.value;
}

/** "$" 로 시작하는 설명 칸을 뺀 사본 */
export function stripDollar<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripDollar) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!k.startsWith('$')) out[k] = stripDollar(x);
    return out as T;
  }
  return v;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 어른 판정 (청소년 이상은 범죄·탄원 대상) */
export function atLeastTeen(p: Person): boolean {
  return p.lifeStage === 'teen' || p.lifeStage === 'young' || p.lifeStage === 'adult' || p.lifeStage === 'elder';
}
export function grownUp(p: Person): boolean {
  return p.lifeStage === 'young' || p.lifeStage === 'adult' || p.lifeStage === 'elder';
}

// ------------------------------------------------------------------ 데이터

export const POLICIES = ['tax', 'market', 'hunting', 'watch', 'plague', 'festival'] as const;
export type PolicyId = (typeof POLICIES)[number];
export const POLICY_LEVELS: Record<PolicyId, readonly string[]> = {
  tax: ['low', 'normal', 'high'],
  market: ['free', 'guild'],
  hunting: ['ban', 'license', 'free'],
  watch: ['lax', 'normal', 'strict'],
  plague: ['none', 'quarantine', 'lockdown'],
  festival: ['none', 'normal', 'grand'],
};

const num = z.number();
const effectSchema = z.object({
  /** 목표 민심 보정 (50 + 합) */
  morale: num.default(0),
  /** 바꾼 날 한 번 민심 변화 */
  moraleShock: num.default(0),
  /** 세율 (economy.json tax.rates 와 같은 값) */
  taxRate: num.optional(),
  /** 품목 가격 배수 (장부 품목 id 또는 "manufactured" = 공산품 묶음) */
  price: z.record(z.string(), num).optional(),
  artisanIncomeMult: num.optional(),
  marketTradeMult: num.optional(),
  /** 치안 */
  crimeMult: num.optional(),
  detectMult: num.optional(),
  punishStep: num.optional(),
  guardWagePerDay: num.optional(),
  /** 사냥: 밀렵 발생 배수 (자유면 0 = 밀렵이라는 죄가 없음) */
  poachingMult: num.optional(),
  /** 역병: 공공 장소 접촉 배수, 아픈 사람/그 식구를 집에 묶음, 외부 교역 차단 */
  publicContactMult: num.optional(),
  confineSick: z.boolean().optional(),
  /** 격리 명령을 지키는 비율 (사람마다 하루) */
  compliance: num.optional(),
  confineHousehold: z.boolean().optional(),
  tradeBlocked: z.boolean().optional(),
  /** 축제: 축제일 금고 지원(파딩), 축제일 민심, 규모 배수 */
  festivalSupport: num.optional(),
  festivalMorale: num.optional(),
  festivalScale: num.optional(),
  festivalMoodlet: z.string().nullable().optional(),
  /** 조작 가문 식구에게 정책이 켜질 때 붙는 무드렛 */
  moodlet: z.string().nullable().optional(),
});
export type PolicyEffect = z.infer<typeof effectSchema>;

export const policySchema = z.object({
  defaults: z.object({ tax: z.string(), market: z.string(), hunting: z.string(), watch: z.string(), plague: z.string(), festival: z.string() }),
  effects: z.object({
    tax: z.record(z.string(), effectSchema),
    market: z.record(z.string(), effectSchema),
    hunting: z.record(z.string(), effectSchema),
    watch: z.record(z.string(), effectSchema),
    plague: z.record(z.string(), effectSchema),
    festival: z.record(z.string(), effectSchema),
  }),
  manufactured: z.array(z.string()),
  morale: z.object({
    base: num,
    pushPerDay: durSchema,
    lowFlagBelow: num,
    riotBelow: num,
    riotChancePerDay: num,
    riotCooldown: durSchema,
    riot: z.object({ treasuryShare: num, lordFame: num, moraleAfter: num, moodlet: z.string(), card: z.string() }),
    rebellionBelow: num,
    rebellionDays: durSchema,
    rebellion: z.object({ lordFame: num, treasuryShare: num }),
    highAbove: num,
    highLordFamePerDay: num,
    highMoodlet: z.string().nullable(),
  }),
  treasury: z.object({ start: num, unpaidGuardDetectMult: num, unpaidGuardMorale: num }),
  festival: z.object({ dayInSeason: z.number().int().min(0) }),
  grain: z.object({
    moraleBelow: num,
    rationPerPersonDay: num,
    maxDays: durSchema,
    lordFavor: num,
    serfCorveeDays: num,
    notice: z.string(),
  }),
  petition: z.object({
    base: num,
    perStorytelling: num,
    perLordFavor: num,
    lowMoraleBonus: num,
    cooldown: durSchema,
    okMorale: num,
    okFame: num,
    okMoodlet: z.string(),
    failMoodlet: z.string(),
    failLordFavor: num,
    pressureToChange: num,
    grainOnOk: z.boolean(),
  }),
  ai: z.object({
    every: durSchema,
    changeChance: num,
    treasuryLowDays: num,
    moraleLow: num,
    moraleHigh: num,
    crimePerDayHigh: num,
    greedyTraits: z.array(z.string()),
    kindTraits: z.array(z.string()),
    embezzleTraits: z.array(z.string()),
    embezzleChance: num,
    embezzleShare: num,
  }),
  war: z.object({ costPerDay: num }),
}).loose();
export type PolicyData = z.infer<typeof policySchema>;

/** SimData.family.policy (policy.json 원본) → 검증된 데이터. "policy" 칸 (social/interactions 는 simData 가 합침) */
export function parsePolicy(raw: unknown): PolicyData | null {
  const r = (raw as { policy?: unknown } | null | undefined)?.policy;
  if (!r) return null;
  const d = policySchema.parse(stripDollar(r));
  const problems: string[] = [];
  for (const id of POLICIES) {
    for (const lv of POLICY_LEVELS[id]) if (!d.effects[id][lv]) problems.push(`effects.${id}.${lv} 없음`);
    if (!POLICY_LEVELS[id].includes(d.defaults[id])) problems.push(`defaults.${id} = ${d.defaults[id]} 는 없는 단계`);
  }
  if (problems.length) throw new Error(`policy.json: ${problems.join('; ')}`);
  return d;
}

// ------------------------------------------------------------------ 효과 창구 (다른 모듈이 읽음)

/** 정책 효과 (justice/feud/plagueLite/경제가 읽음). LordPolicy 가 구현, 테스트는 가짜로 */
export interface PolicyEffects {
  level(id: PolicyId): string;
  /** 세율 (economy.json tax.rates 의 값을 그대로 돌려줌) */
  taxRate(rates: Record<string, number>): number;
  /** 보통 세율 대비 배수 */
  taxRateMult(): number;
  /** 품목 가격 배수 (고기: 사냥, 공산품: 장터 규칙) */
  priceMult(good: string): number;
  artisanIncomeMult(): number;
  /** 장터 거래량 배수. 역병 대응 정책은 유행 중(plagueActive)에만 들어감 */
  marketTradeMult(plagueActive?: boolean): number;
  crimeMult(): number;
  detectMult(): number;
  punishStep(): number;
  poachingMult(): number;
  /** 역병 접촉 배수 (공공 장소), 아픈 사람/식구 격리, 외부 교역 차단 */
  plagueContactMult(placeKind: string): number;
  confineSick(): boolean;
  confineHousehold(): boolean;
  /** 격리 명령을 지키는 비율 */
  confineCompliance(): number;
  tradeBlocked(): boolean;
  festivalScale(): number;
}

// ------------------------------------------------------------------ Host

export interface PolicyHost {
  readonly persons: readonly Person[];
  readonly rng: Rng;
  day(): number;
  lifespan(): number;
  seasonDays(): number;
  controlled(household: number): boolean;
  /** 마을 민심 (Honor.morale) 읽기/바꾸기 */
  morale(): number;
  addMorale(delta: number, reason: string): void;
  /** 영주 금고 (FiefSystem.treasury) */
  treasury(): number;
  treasuryIn(amount: number, kind: string): void;
  treasurySpend(amount: number, kind: string): boolean;
  /** 영주 가문 가구 (없으면 null) */
  lordHousehold(): number | null;
  /** 영주 본인 (가장) */
  lord(): Person | null;
  /** 사적 유용 (FiefSystem.embezzle) */
  embezzle(household: number, amount: number): { ok: boolean; moved: number; discovered: boolean };
  /** 가문 명성 (by = 개인 명예까지) */
  fame(household: number, delta: number, reason: string, by?: Person | null): void;
  lordFavor(household: number): number;
  addLordFavor(household: number, delta: number): void;
  skillLevel(p: Person, skill: string): number;
  moodlet(p: Person, id: string): void;
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
  news(kind: string, args: Record<string, string | number>, subjects: Person[]): void;
  chronicle(trigger: string, subjects: Person[], args?: Record<string, string | number>): void;
  offerCard(p: Person, cardId: string, vars?: Record<string, string | number>, other?: Person | null): void;
  /** 오늘 축제 (19-4). 없으면 null. 구현이 없으면 policy.json festival.dayInSeason 으로 계절마다 하루 */
  festivalToday?(): string | null;
  /** 흉년인가 (Economy.yearMultNow < 1) */
  badYear(): boolean;
  /** 식량이 떨어진 가구 (구휼 대상, 17-9) */
  hungryHouseholds(): number[];
  /** 곡물 1 ration 가격 (파딩) */
  grainPrice(): number;
  /** 가구에 곡물 주기 (저장고 또는 NPC 곳간). 가구 인원 수를 돌려줌 */
  giveGrain(household: number, rations: number): void;
  householdSize(household: number): number;
  householdEstate(household: number): string;
  /** 농노 부역 +일 (17-9 대가, 없으면 무시) */
  addCorvee?(household: number, days: number): void;
  /** 최근 하루 범죄 수 (Justice.stats 에서): AI 가 치안을 올릴지 */
  crimesPerDay?(): number;
  /** 역병이 도는 중인가 (PlagueLite.active) */
  plagueActive?(): boolean;
}

export interface PolicyState {
  levels: Record<PolicyId, string>;
  /** 정책을 바꾼 날 (정책별) */
  changedDay: Record<string, number>;
  /** 탄원 압력: "정책:단계" → 쌓인 수 */
  pressure: Record<string, number>;
  /** 사람별 마지막 탄원한 날 */
  petitionedDay: Record<number, number>;
  /** 곡물 배급 중인 가구 → 끝나는 날 */
  grain: Record<number, number>;
  /** 배급이 끝난 가구 → 다시 받을 수 있는 날 (최대 14일 연속, 17-9) */
  grainRest: Record<number, number>;
  lastRiotDay: number;
  lowMoraleDays: number;
  guardsUnpaid: boolean;
  /** 전쟁 중 (M13 이 켬): 하루 비용 */
  war: boolean;
  aiEnabled: boolean;
}

export interface PolicyStats {
  moraleByDay: number[];
  treasuryByDay: number[];
  riots: number;
  rebellions: number;
  embezzled: number;
  embezzleFound: number;
  petitions: { ok: number; fail: number };
  grainRations: number;
  grainSpent: number;
  festivalSpent: number;
  guardsSpent: number;
  changes: { day: number; policy: PolicyId; value: string; by: string }[];
}

/** 정책 의도 (리드가 sim.apply 에 연결): {kind:'setPolicy', policy, value} */
export interface SetPolicyIntent {
  kind: 'setPolicy';
  policy: PolicyId;
  value: string;
}

// ------------------------------------------------------------------ 본체

export class LordPolicy implements PolicyEffects {
  state: PolicyState;
  readonly stats: PolicyStats = {
    moraleByDay: [],
    treasuryByDay: [],
    riots: 0,
    rebellions: 0,
    embezzled: 0,
    embezzleFound: 0,
    petitions: { ok: 0, fail: 0 },
    grainRations: 0,
    grainSpent: 0,
    festivalSpent: 0,
    guardsSpent: 0,
    changes: [],
  };

  constructor(private host: PolicyHost, readonly d: PolicyData) {
    this.state = {
      levels: { ...d.defaults } as Record<PolicyId, string>,
      changedDay: {},
      pressure: {},
      petitionedDay: {},
      grain: {},
      grainRest: {},
      lastRiotDay: -1e9,
      lowMoraleDays: 0,
      guardsUnpaid: false,
      war: false,
      aiEnabled: true,
    };
  }

  /** 새 게임 시작 때 한 번: 금고가 비었으면 시작 금액 */
  init(): void {
    if (this.host.treasury() <= 0 && this.d.treasury.start > 0) this.host.treasuryIn(this.d.treasury.start, 'start');
  }

  get aiEnabled(): boolean {
    return this.state.aiEnabled;
  }
  set aiEnabled(v: boolean) {
    this.state.aiEnabled = v;
  }

  // ---------------------------------------------------------------- 효과 (PolicyEffects)

  level(id: PolicyId): string {
    return this.state.levels[id];
  }

  private eff(id: PolicyId): PolicyEffect {
    return this.d.effects[id][this.state.levels[id]] ?? {};
  }

  taxRate(rates: Record<string, number>): number {
    return this.eff('tax').taxRate ?? rates[this.state.levels.tax] ?? rates.normal ?? 0;
  }

  taxRateMult(): number {
    const normal = this.d.effects.tax.normal?.taxRate ?? 0;
    const now = this.eff('tax').taxRate ?? normal;
    return normal > 0 ? now / normal : 1;
  }

  priceMult(good: string): number {
    let m = 1;
    const manu = this.d.manufactured.includes(good);
    for (const id of POLICIES) {
      const pr = this.eff(id).price;
      if (!pr) continue;
      if (pr[good] !== undefined) m *= pr[good];
      else if (manu && pr.manufactured !== undefined) m *= pr.manufactured;
    }
    return m;
  }

  artisanIncomeMult(): number {
    let m = 1;
    for (const id of POLICIES) m *= this.eff(id).artisanIncomeMult ?? 1;
    return m;
  }

  marketTradeMult(plagueActive = false): number {
    let m = 1;
    for (const id of POLICIES) if (id !== 'plague' || plagueActive) m *= this.eff(id).marketTradeMult ?? 1;
    return m;
  }

  crimeMult(): number {
    return this.eff('watch').crimeMult ?? 1;
  }

  detectMult(): number {
    return (this.eff('watch').detectMult ?? 1) * (this.state.guardsUnpaid ? this.d.treasury.unpaidGuardDetectMult : 1);
  }

  punishStep(): number {
    return this.eff('watch').punishStep ?? 0;
  }

  poachingMult(): number {
    return this.eff('hunting').poachingMult ?? 1;
  }

  plagueContactMult(placeKind: string): number {
    if (placeKind === 'home') return 1;
    return this.eff('plague').publicContactMult ?? 1;
  }

  confineSick(): boolean {
    return !!this.eff('plague').confineSick;
  }

  confineHousehold(): boolean {
    return !!this.eff('plague').confineHousehold;
  }

  confineCompliance(): number {
    return this.eff('plague').compliance ?? 1;
  }

  tradeBlocked(): boolean {
    return !!this.eff('plague').tradeBlocked;
  }

  festivalScale(): number {
    return this.eff('festival').festivalScale ?? 1;
  }

  /** 정책이 정한 목표 민심 (Honor 의 toward 대신 쓸 수 있음) */
  moraleTarget(): number {
    let t = this.d.morale.base;
    for (const id of POLICIES) t += this.eff(id).morale ?? 0;
    return clamp(t, 0, 100);
  }

  // ---------------------------------------------------------------- 바꾸기

  /**
   * 정책 바꾸기. by = 바꾼 사람 (조작 영주, NPC 영주 AI 면 null). 같은 값이면 false.
   * 소식 news.policy_<정책>_<단계>, 바꾼 날 민심 충격, 조작 가문 식구 무드렛
   */
  set(policy: PolicyId, value: string, by: 'player' | 'ai' | 'petition' | 'setup' = 'player'): boolean {
    if (!POLICY_LEVELS[policy]?.includes(value)) return false;
    if (this.state.levels[policy] === value) return false;
    this.state.levels[policy] = value;
    const H = this.host;
    this.state.changedDay[policy] = H.day();
    this.stats.changes.push({ day: H.day(), policy, value, by });
    if (by === 'setup') return true;
    const e = this.eff(policy);
    if (e.moraleShock) H.addMorale(e.moraleShock, `policy_${policy}`);
    const lord = H.lord();
    H.news(`policy_${policy}_${value}`, { a: lord?.name ?? '' }, lord ? [lord] : []);
    if (e.moodlet) for (const p of H.persons) if (H.controlled(p.household) && atLeastTeen(p)) H.moodlet(p, e.moodlet);
    // 쌓인 탄원 압력은 이 방향으로 풀림
    delete this.state.pressure[`${policy}:${value}`];
    return true;
  }

  /** 의도 {kind:'setPolicy'}: 조작 가문이 영주일 때만 (영주가 아니면 탄원) */
  applyIntent(intent: SetPolicyIntent, byControlled = true): { ok: boolean; reason?: string } {
    if (!POLICIES.includes(intent.policy)) return { ok: false, reason: 'unknown_policy' };
    if (!POLICY_LEVELS[intent.policy].includes(intent.value)) return { ok: false, reason: 'unknown_level' };
    if (byControlled) {
      const lh = this.host.lordHousehold();
      if (lh === null || !this.host.controlled(lh)) return { ok: false, reason: 'not_lord' };
    }
    return this.set(intent.policy, intent.value, 'player') ? { ok: true } : { ok: false, reason: 'same' };
  }

  // ---------------------------------------------------------------- 하루 (자정)

  /** 오늘이 축제일인가 (host 달력이 없으면 계절마다 dayInSeason 째 날) */
  festivalDay(day: number): boolean {
    if (this.host.festivalToday) return !!this.host.festivalToday();
    const SD = Math.max(1, this.host.seasonDays());
    return day % SD === Math.min(SD - 1, this.d.festival.dayInSeason);
  }

  /**
   * 자정 한 번 (방금 끝난 날 day). 순서: 민심 목표 쪽으로 → 축제 → 경비병 급여 → 곡물 배급 → 전쟁 비용 →
   * 폭동/반란/높은 민심 → NPC 영주 AI → 기록. Honor.daily (50 쪽 당김) 뒤에 부르면 됨
   */
  daily(day: number): void {
    const H = this.host;
    const L = H.lifespan();
    const M = this.d.morale;
    // 민심: 정책 목표 쪽으로
    const target = this.moraleTarget();
    const m = H.morale();
    const push = perDay(M.pushPerDay, L);
    if (Math.abs(target - m) > 1e-9) H.addMorale(clamp(target - m, -push, push), 'policy');
    // 축제
    if (this.festivalDay(day)) this.festival();
    // 경비병 급여
    const wage = Math.round(this.eff('watch').guardWagePerDay ?? 0);
    if (wage > 0) {
      const paid = H.treasurySpend(wage, 'guards');
      if (paid) this.stats.guardsSpent += wage;
      if (!paid && !this.state.guardsUnpaid) H.addMorale(this.d.treasury.unpaidGuardMorale, 'guards_unpaid');
      this.state.guardsUnpaid = !paid;
    }
    // 곡물 배급 (17-9)
    this.grainDaily(day);
    // 전쟁 (M13 이 켬)
    if (this.state.war) H.treasurySpend(Math.round(this.d.war.costPerDay), 'war');
    // 민심 사건
    this.moraleEvents(day);
    // NPC 영주 AI
    if (this.state.aiEnabled) this.aiTick(day);
    this.stats.moraleByDay.push(+H.morale().toFixed(2));
    this.stats.treasuryByDay.push(H.treasury());
  }

  private festival(): void {
    const H = this.host;
    const e = this.eff('festival');
    const cost = Math.round(e.festivalSupport ?? 0);
    let funded = cost <= 0;
    if (cost > 0) {
      funded = H.treasurySpend(cost, 'festival');
      if (funded) this.stats.festivalSpent += cost;
    }
    if (!funded) return;
    if (e.festivalMorale) H.addMorale(e.festivalMorale, 'festival');
    if (e.festivalMoodlet) for (const p of H.persons) if (atLeastTeen(p) && H.controlled(p.household)) H.moodlet(p, e.festivalMoodlet);
  }

  private grainDaily(day: number): void {
    const H = this.host;
    const G = this.d.grain;
    const eligible = H.badYear() || H.morale() < G.moraleBelow;
    const hungry = new Set(H.hungryHouseholds());
    // 새로 배급 시작 (흉년/민심 낮음): 굶는 가구
    if (eligible) for (const hh of hungry) if (this.canGrain(hh, day)) this.startGrain(hh, day, 'need');
    // 배급
    const price = Math.max(1, H.grainPrice());
    for (const [k, until] of Object.entries(this.state.grain)) {
      const hh = Number(k);
      if (day > until) {
        this.endGrain(hh, day);
        continue;
      }
      if (!hungry.has(hh)) continue;
      const n = Math.max(1, Math.round(H.householdSize(hh) * G.rationPerPersonDay));
      const cost = n * price;
      if (!H.treasurySpend(cost, 'grain')) {
        this.endGrain(hh, day);
        continue;
      }
      H.giveGrain(hh, n);
      this.stats.grainRations += n;
      this.stats.grainSpent += cost;
    }
  }

  private grainDays(): number {
    return Math.max(1, Math.round(durDays(this.d.grain.maxDays, this.host.lifespan(), this.host.seasonDays())));
  }

  /** 배급을 새로 받을 수 있나 (받는 중이 아니고, 끝난 뒤 최대 일수만큼 쉼) */
  canGrain(household: number, day: number): boolean {
    return this.state.grain[household] === undefined && day >= (this.state.grainRest[household] ?? -1e9);
  }

  private endGrain(household: number, day: number): void {
    delete this.state.grain[household];
    this.state.grainRest[household] = day + this.grainDays();
  }

  /** 곡물 배급 시작 (흉년·민심·탄원). 영주 호의 소폭 하락, 농노 부역 +일 */
  startGrain(household: number, day: number, why: 'need' | 'petition'): void {
    const H = this.host;
    const G = this.d.grain;
    this.state.grain[household] = day + this.grainDays() - 1;
    H.addLordFavor(household, G.lordFavor);
    if (H.householdEstate(household) === 'serf' && G.serfCorveeDays > 0) H.addCorvee?.(household, G.serfCorveeDays);
    const head = H.persons.find((p) => p.household === household && H.controlled(household));
    if (head) H.notice(head, G.notice, { why: `grain.why.${why}` });
  }

  private moraleEvents(day: number): void {
    const H = this.host;
    const M = this.d.morale;
    const L = H.lifespan();
    const m = H.morale();
    const lordHh = H.lordHousehold();
    const lord = H.lord();
    // 폭동 (riotBelow 밑에서 하루 확률, 대기 기간)
    if (m < M.riotBelow && day - this.state.lastRiotDay >= durDays(M.riotCooldown, L, H.seasonDays()) && H.rng.next() < M.riotChancePerDay) {
      this.state.lastRiotDay = day;
      this.stats.riots++;
      const lost = Math.floor(H.treasury() * M.riot.treasuryShare);
      if (lost > 0) H.treasurySpend(lost, 'riot');
      if (lordHh !== null) H.fame(lordHh, M.riot.lordFame, 'riot', null);
      H.addMorale(M.riot.moraleAfter, 'riot');
      for (const p of H.persons) if (atLeastTeen(p) && H.controlled(p.household)) H.moodlet(p, M.riot.moodlet);
      H.news('riot', { a: lord?.name ?? '' }, lord ? [lord] : []);
      if (lord) H.chronicle('riot', [lord]);
      const lead = H.persons.find((p) => H.controlled(p.household) && grownUp(p) && p.household !== lordHh);
      if (lead) H.offerCard(lead, M.riot.card, {}, lord);
    }
    // 반란 (rebellionBelow 밑이 rebellionDays 이어짐)
    if (m < M.rebellionBelow) this.state.lowMoraleDays++;
    else this.state.lowMoraleDays = 0;
    if (this.state.lowMoraleDays >= durDays(M.rebellionDays, L, H.seasonDays())) {
      this.state.lowMoraleDays = 0;
      this.stats.rebellions++;
      const lost = Math.floor(H.treasury() * M.rebellion.treasuryShare);
      if (lost > 0) H.treasurySpend(lost, 'rebellion');
      if (lordHh !== null) H.fame(lordHh, M.rebellion.lordFame, 'rebellion', null);
      H.news('rebellion', { a: lord?.name ?? '' }, lord ? [lord] : []);
      if (lord) H.chronicle('rebellion', [lord]);
    }
    // 높은 민심: 영주 가문 명성 +
    if (m >= M.highAbove && lordHh !== null) {
      H.fame(lordHh, M.highLordFamePerDay, 'good_rule', null);
      if (M.highMoodlet) for (const p of H.persons) if (p.household === lordHh && H.controlled(lordHh) && atLeastTeen(p)) H.moodlet(p, M.highMoodlet);
    }
  }

  // ---------------------------------------------------------------- NPC 영주 AI

  private aiTick(day: number): void {
    const H = this.host;
    const A = this.d.ai;
    const lordHh = H.lordHousehold();
    if (lordHh === null || H.controlled(lordHh)) return;
    const every = Math.max(1, Math.round(durDays(A.every, H.lifespan(), H.seasonDays())));
    if (day % every !== every - 1) return;
    const lord = H.lord();
    const traits = lord?.traits ?? [];
    const greedy = traits.some((t) => A.greedyTraits.includes(t));
    const kind = traits.some((t) => A.kindTraits.includes(t));
    const m = H.morale();
    const wage = this.eff('watch').guardWagePerDay ?? 0;
    const lowCash = H.treasury() < Math.max(1, wage) * A.treasuryLowDays;
    const wants: { policy: PolicyId; value: string; w: number }[] = [];
    const step = (policy: PolicyId, dir: 1 | -1): string | null => {
      const lv = POLICY_LEVELS[policy];
      const i = lv.indexOf(this.state.levels[policy]) + dir;
      return i >= 0 && i < lv.length ? lv[i] : null;
    };
    const want = (policy: PolicyId, value: string | null, w: number) => {
      if (value && value !== this.state.levels[policy] && w > 0) wants.push({ policy, value, w });
    };
    // 돈이 모자라면 세금 ↑ (탐욕스러우면 더), 민심이 낮으면 세금 ↓·축제 ↑
    if (lowCash) want('tax', step('tax', 1), greedy ? 3 : 2);
    if (greedy && m > A.moraleLow) want('tax', step('tax', 1), 1);
    if (m < A.moraleLow) {
      want('tax', step('tax', -1), kind ? 3 : 2);
      if (!lowCash) want('festival', step('festival', 1), 1);
    }
    if (m > A.moraleHigh && kind) want('festival', step('festival', 1), 1);
    // 범죄가 많으면 치안 ↑, 민심이 낮고 범죄가 적으면 ↓
    const cpd = H.crimesPerDay?.() ?? 0;
    if (cpd > A.crimePerDayHigh) want('watch', step('watch', 1), 2);
    else if (m < A.moraleLow && this.state.levels.watch === 'strict') want('watch', 'normal', 1);
    // 역병
    const plague = H.plagueActive?.() ?? false;
    if (plague && this.state.levels.plague === 'none') want('plague', 'quarantine', 4);
    if (!plague && this.state.levels.plague !== 'none') want('plague', 'none', 3);
    // 탄원 압력
    for (const [k, n] of Object.entries(this.state.pressure)) {
      const [policy, value] = k.split(':') as [PolicyId, string];
      if (n >= this.d.petition.pressureToChange) want(policy, value, n);
    }
    if (wants.length && H.rng.next() < A.changeChance) {
      const i = Math.max(0, H.rng.weighted(wants.map((w) => w.w)));
      const w = wants[i];
      this.set(w.policy, w.value, 'ai');
    }
    // 사적 유용 (탐욕·교활한 영주)
    if (traits.some((t) => A.embezzleTraits.includes(t)) && H.rng.next() < A.embezzleChance) this.embezzle(lordHh, Math.floor(H.treasury() * A.embezzleShare));
  }

  // ---------------------------------------------------------------- 사적 유용, 탄원, 전쟁

  /** 영주 금고 → 영주 가문 재산 (fief.embezzle). 조작 영주 의도 또는 NPC AI */
  embezzle(household: number, amount: number): { ok: boolean; moved: number; discovered: boolean } {
    const r = this.host.embezzle(household, amount);
    if (r.ok) {
      this.stats.embezzled += r.moved;
      if (r.discovered) {
        this.stats.embezzleFound++;
        const lord = this.host.lord();
        if (lord) this.host.chronicle('embezzlement', [lord]);
      }
    }
    return r;
  }

  /** 탄원 가능 (영주 가문이 아니고 대기 기간이 지남). 게이트 lord_petition */
  canPetition(p: Person): boolean {
    const lh = this.host.lordHousehold();
    if (lh === null || p.household === lh || !grownUp(p)) return false;
    const last = this.state.petitionedDay[p.id];
    return last === undefined || this.host.day() - last >= durDays(this.d.petition.cooldown, this.host.lifespan(), this.host.seasonDays());
  }

  /** 탄원이 원하는 것 (지정이 없으면 이 사람이 가장 불만인 정책 쪽) */
  grievance(p: Person): { policy: PolicyId; value: string } | 'grain' | null {
    const H = this.host;
    if (H.hungryHouseholds().includes(p.household)) return 'grain';
    const lv = this.state.levels;
    if (lv.tax === 'high') return { policy: 'tax', value: 'normal' };
    if (lv.hunting === 'ban' && (p.estate === 'serf' || p.estate === 'freeman')) return { policy: 'hunting', value: 'license' };
    if (lv.market === 'guild' && p.estate !== 'artisan') return { policy: 'market', value: 'free' };
    if (lv.market === 'free' && p.estate === 'artisan') return { policy: 'market', value: 'guild' };
    if (lv.watch === 'strict') return { policy: 'watch', value: 'normal' };
    if (lv.tax === 'normal' && (p.estate === 'serf' || p.estate === 'freeman')) return { policy: 'tax', value: 'low' };
    if (lv.festival !== 'grand') return { policy: 'festival', value: lv.festival === 'none' ? 'normal' : 'grand' };
    return null;
  }

  /**
   * 탄원하기 (18-4: 영주가 아니면 탄원으로 영향). 판정 = 기본 + 화술 × k + 영주 호의 + 민심이 낮으면 보너스.
   * 성공: 민심 +, 명성 +, 무드렛, 압력이 쌓이고 (NPC 영주는 다음 AI 때 반영), 굶는 집이면 곡물 배급.
   * 조작 영주에게 들어온 탄원은 알림으로 (영주가 직접 정함)
   */
  petition(p: Person, want: { policy: PolicyId; value: string } | 'grain' | null = null): { ok: boolean; want: { policy: PolicyId; value: string } | 'grain' | null } {
    const H = this.host;
    const P = this.d.petition;
    const w = want ?? this.grievance(p);
    this.state.petitionedDay[p.id] = H.day();
    const lordHh = H.lordHousehold();
    const lord = H.lord();
    // 조작 영주: 판정 없이 알림으로 받아 줌
    if (lordHh !== null && H.controlled(lordHh)) {
      if (lord) H.notice(lord, 'petition_received', { a: p.name, want: this.wantKey(w) });
      if (w && w !== 'grain') this.state.pressure[`${w.policy}:${w.value}`] = (this.state.pressure[`${w.policy}:${w.value}`] ?? 0) + 1;
      return { ok: true, want: w };
    }
    let chance = P.base + P.perStorytelling * H.skillLevel(p, 'storytelling') + P.perLordFavor * (H.lordFavor(p.household) / 100);
    if (H.morale() < this.d.ai.moraleLow) chance += P.lowMoraleBonus;
    const ok = H.rng.next() < clamp(chance, 0.02, 0.95);
    if (ok) {
      this.stats.petitions.ok++;
      H.addMorale(P.okMorale, 'petition');
      H.fame(p.household, P.okFame, 'petition', p);
      H.moodlet(p, P.okMoodlet);
      if (w === 'grain') {
        if (P.grainOnOk && this.canGrain(p.household, H.day())) this.startGrain(p.household, H.day(), 'petition');
      } else if (w) this.state.pressure[`${w.policy}:${w.value}`] = (this.state.pressure[`${w.policy}:${w.value}`] ?? 0) + 1;
    } else {
      this.stats.petitions.fail++;
      H.moodlet(p, P.failMoodlet);
      H.addLordFavor(p.household, P.failLordFavor);
    }
    if (H.controlled(p.household)) H.notice(p, ok ? 'petition_ok' : 'petition_fail', { want: this.wantKey(w) });
    return { ok, want: w };
  }

  private wantKey(w: { policy: PolicyId; value: string } | 'grain' | null): string {
    if (!w) return 'petition.want.none';
    if (w === 'grain') return 'petition.want.grain';
    return `policy.${w.policy}.${w.value}`;
  }

  /** 전쟁 시작/끝 (M13 이 부름): 금고에서 하루 비용 */
  setWar(on: boolean): void {
    this.state.war = on;
  }

  // ---------------------------------------------------------------- 사회 결과, 게이트, 플래그

  /** 사회 상호작용 결과 (리드가 onSocial 로 넘김). 처리했으면 true */
  onSocial(p: Person, t: Person | null, id: string, ok: boolean): boolean {
    if (id === 'social.petition_lord' || (id === 'social.petition' && t && t.household === this.host.lordHousehold())) {
      if (!ok) {
        this.state.petitionedDay[p.id] = this.host.day();
        this.stats.petitions.fail++;
        this.host.moodlet(p, this.d.petition.failMoodlet);
        return true;
      }
      this.petition(p);
      return true;
    }
    return false;
  }

  /** 물건 상호작용 결과 (영주 대전 옥좌 throne.petition) */
  onInteraction(p: Person, iaId: string): boolean {
    if (iaId !== 'throne.petition') return false;
    if (!this.canPetition(p)) return false;
    this.petition(p);
    return true;
  }

  gates(): Record<string, (p: Person, t: Person | null) => boolean> {
    return {
      lord_petition: (p, t) => this.canPetition(p) && (!t || t.household === this.host.lordHousehold()),
    };
  }

  /** 사건 카드 조건 플래그 (cardsHost.flags 에 합침) */
  flags(p: Person): Set<string> {
    const out = new Set<string>();
    const lv = this.state.levels;
    if (lv.tax === 'high') out.add('policy_tax_high');
    if (lv.tax === 'low') out.add('policy_tax_low');
    if (lv.hunting === 'ban') out.add('hunting_banned');
    if (lv.plague !== 'none') out.add('policy_quarantine');
    if (lv.watch === 'strict') out.add('policy_watch_strict');
    if (lv.market === 'guild') out.add('policy_guild');
    const m = this.host.morale();
    if (m < this.d.morale.lowFlagBelow) out.add('morale_low');
    if (m >= this.d.morale.highAbove) out.add('morale_high');
    if (p.household === this.host.lordHousehold()) out.add('is_lord');
    if (this.state.grain[p.household] !== undefined) out.add('lord_grain');
    return out;
  }

  hashParts(out: (string | number)[]): void {
    out.push(JSON.stringify(this.state.levels), JSON.stringify(this.state.pressure), JSON.stringify(this.state.grain), JSON.stringify(this.state.grainRest), this.state.lastRiotDay, this.state.lowMoraleDays);
  }
}
