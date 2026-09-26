/**
 * 신분 7단계 (GDD 16-2, 16-3, 17-4 큰 비용 역산표).
 * - 신분 순위, 가능한 것/제약 조회 (이사·직업·길드·가게·원거리 교역·대출·성사·혼인 불가·군역·마상시합·궁정·재판/세금·정책권)
 * - 두 층 규칙 (16-2 표 11행): 개인 신분과 가정 대표 신분(= 가장의 개인 신분, 성직자는 개인만 바뀜).
 *   plan*() 은 세계를 바꾸지 않는 순수 판정 (EstatePlan), apply() 가 Host 창구로 실행
 * - 상승 경로 (해방금·도시 도망·영주 은혜·길드·상인·기사 서임·작위 매입·성직·한 단계 위 혼인 지참금)와
 *   하락 경로 (파산·중죄·길드 제명·기사 자격 박탈): can*() 조건 검사 + 실행 함수
 * 돈은 파딩 정수. 큰 비용은 S(economy.json 한 인생 저축 목표) 배수 × 수명 배수 (lifespan). 무작위는 host.rng 만. 렌더러/DOM 없음
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import type { LifeStage } from '../people/person';
import { ESTATE_IDS, type EstateId } from '../econ/economy';

export { ESTATE_IDS, type EstateId };

// ------------------------------------------------------------------ 데이터

const scale = z.enum(['absolute', 'season', 'lifespan', 'per_life']);
const dur = z.object({ value: z.number(), scale });
const estateId = z.enum(ESTATE_IDS as [EstateId, ...EstateId[]]);
/** S 배수 비용: of 신분의 S × mult (lifespan) */
const sCost = z.object({ of: z.union([estateId, z.literal('bride')]), mult: z.number(), scale: z.literal('lifespan') });

const estateDef = z.object({
  rank: z.number().int(),
  familyName: z.boolean(),
  personalOnly: z.boolean().optional(),
  inherit: z.array(estateId).optional(),
  can: z.array(z.string()),
  limits: z.array(z.string()),
  corveeDaysPerWeek: dur.optional(),
  houseKind: z.string(),
});

export const estatesSchema = z.object({
  order: z.array(estateId).length(7),
  estates: z.record(estateId, estateDef),
  minorAge: z.number(),
  marriage: z.object({ penaltyFromGap: z.number(), acceptMod: z.number(), lordPermissionFavorMin: z.number(), upDowryMult: z.number() }),
  costs: z.object({
    emancipation: sCost,
    spouseEmancipation: sCost,
    guildFee: sCost,
    merchantCapital: sCost,
    titlePurchase: sCost,
    dowryBase: sCost,
  }),
  paths: z.object({
    flight: z.object({ calendarYear: dur, plusDays: dur, cap: dur, detectPerDay: z.number(), caughtLordFavor: z.number(), from: z.array(estateId) }),
    grace: z.object({ lordFavorGain: z.number() }),
    guild: z.object({ from: z.array(estateId), apprenticeDays: dur, journeymanMinDays: dur, masterpieceMinQuality: z.number(), masterpieceFame: z.number() }),
    merchant: z.object({ from: z.array(estateId), joinFee: sCost }),
    knighting: z.object({ skill: z.string(), minLevel: z.number(), minLordFavor: z.number(), fame: z.number() }),
    title: z.object({ from: z.array(estateId), minFameTier: z.string(), nobleRespect: z.number() }),
    vows: z.object({ minStages: z.array(z.string()), bishopFame: z.number() }),
    marryUp: z.object({ rankStep: z.number() }),
  }),
  falls: z.object({
    stepDown: z.record(estateId, estateId),
    guildExpulsion: z.object({ from: estateId, to: estateId }),
    felony: z.object({ to: estateId, keepIf: z.array(estateId).optional() }),
    knightRevoke: z.object({ from: estateId, to: estateId }),
    fame: z.object({ bankruptcy: z.number(), felony: z.number(), guildExpulsion: z.number(), knightRevoke: z.number() }),
  }),
  fameTiers: z.array(z.string()),
  effects: z.object({
    riseMoodlet: z.string(),
    fallMoodlet: z.string(),
    freedMoodlet: z.string(),
    knightedMoodlet: z.string(),
    ennobledMoodlet: z.string(),
    chronicleUp: z.string(),
    chronicleDown: z.string(),
    newsUp: z.string(),
    newsDown: z.string(),
    familyNameCard: z.string(),
    knightingCard: z.string(),
  }),
  fief: z.unknown(),
}).loose();
export type EstatesData = z.infer<typeof estatesSchema>;

/** "$" 로 시작하는 설명 키를 걷어냄 (데이터 파일 주석) */
export function stripMeta<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => stripMeta(x)) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!k.startsWith('$')) out[k] = stripMeta(x);
    return out as T;
  }
  return v;
}

/** SimData.family.estates (원본) → 검증된 데이터. 없으면 null (기능 꺼짐) */
export function parseEstates(raw: unknown): EstatesData | null {
  if (!raw) return null;
  return estatesSchema.parse(stripMeta(raw));
}

/** 기간 필드 → 게임일 (29-0) */
export function durDays(d: { value: number; scale: string }, lifespan: number, seasonDays: number): number {
  if (d.scale === 'lifespan') return d.value * lifespan;
  if (d.scale === 'season') return d.value * (seasonDays / 7);
  return d.value;
}

// ------------------------------------------------------------------ 인물과 Host

/** 신분 규칙이 읽는 인물 모양 (Person 이 그대로 맞음) */
export interface EstatePerson {
  readonly id: number;
  name?: string;
  estate: string;
  household: number;
  spouse: number;
  mother: number;
  father: number;
  sex: 'male' | 'female';
  lifeStage: LifeStage;
}

/** 두 층 규칙이 읽는 세계 (순수 판정용) */
export interface EstateWorld<P extends EstatePerson = EstatePerson> {
  /** 살아 있는 인물 (마을 밖 여정·도망 중 포함) */
  persons(): readonly P[];
  /** 가정의 가장 (살아 있는 인물만, 16-1) */
  headOf(household: number): P | undefined;
  /** 가정 대표 신분 (가장 신분을 따로 저장: 성직자 가장이면 바뀌지 않음) */
  householdEstate(household: number): EstateId;
  /** 표시 나이 (미성년 18세 판정) */
  age(p: P): number;
}

/** 신분 체계가 세계에 닿는 창구. 리드가 sim.ts 에 구현 */
export interface EstatesHost<P extends EstatePerson = EstatePerson> extends EstateWorld<P> {
  readonly rng: Rng;
  day(): number;
  /** 수명 배수 (29-0) */
  lifespan(): number;
  /** 계절 일수 (기본 7) */
  seasonDays(): number;
  /** 한 인생 저축 목표 S (동화, 보통 수명 기준 = economy.json target.net × savingsDays) */
  savings(estate: EstateId): number;
  /** 가정 돈 (파딩) */
  money(household: number): number;
  /** 돈 내기 (파딩). 모자라면 false (아무것도 빼지 않음) */
  spend(household: number, amount: number, reason: string): boolean;
  setPersonEstate(p: P, estate: EstateId): void;
  setHouseholdEstate(household: number, estate: EstateId): void;
  /** 가문 명성 변화 (H: 가문 명성 + 개인 명예). by = 이 변화를 만든 인물 */
  fame(household: number, delta: number, reason: string, by?: P): void;
  /** 가문 명성 단계 id (fameTiers: disgrace suspect plain respected renowned legend) */
  fameTier(household: number): string;
  lordFavor(household: number): number;
  addLordFavor(household: number, delta: number): void;
  skill(p: P, id: string): number;
  /** 종자인가 (종자 NPC 역할 / 직업) */
  isSquire(p: P): boolean;
  /** 마상시합 우승 또는 전공이 있는가 (M13 전투가 채움) */
  hasFeat(p: P): boolean;
  moodlet(p: P, id: string): void;
  chronicle(trigger: string, subjects: P[], args?: Record<string, string | number>): void;
  news(kind: string, args: Record<string, string | number>, subjects: P[]): void;
  notice(p: P, kind: string, args?: Record<string, string | number>): void;
  offerCard(p: P, cardId: string, vars?: Record<string, string | number>): void;
  /** 개인 신분이 바뀐 뒤 (옷 사양·이름 풀·말투·인사 상호작용 다시 읽기) */
  onEstateChanged(p: P, from: EstateId, to: EstateId, reason: string): void;
  /** 가정 대표 신분이 바뀐 뒤 (세금·부역·가계 목표·집 종류, econ 계정 estate) */
  onHouseholdEstateChanged(household: number, from: EstateId, to: EstateId, reason: string): void;
  /** 농노 가정이 가문명을 얻을 때 (H clans: 가문명 얻는 연출) */
  needsFamilyName(household: number): void;
  /** 데릴사위 성 변경 */
  changeSurname(p: P, toHousehold: number): void;
  /** 재산 압류/몰수 (파산·중죄) */
  confiscate(household: number, reason: string): void;
  /** 처벌 훅 (도망 들킴 → 18-6 재판) */
  punish(p: P, kind: string): void;
  /** 마을을 떠남 / 돌아옴 (도시 도망 = 다일 래빗홀) */
  leaveVillage(p: P, reason: string): void;
  returnToVillage(p: P, reason: string): void;
  /** 귀족들의 존중 변화 (작위 매입 멸시) */
  respectFrom(p: P, estate: EstateId, delta: number): void;
}

// ------------------------------------------------------------------ 판정 결과

export type EstateRule =
  | 'marriage'
  | 'uxorilocal'
  | 'birth'
  | 'illegitimate'
  | 'clergy_child'
  | 'knighting'
  | 'ennoble'
  | 'emancipation'
  | 'city_flight'
  | 'bankruptcy'
  | 'guild_expulsion'
  | 'felony'
  | 'branch'
  | 'guild_join'
  | 'merchant'
  | 'vows'
  | 'knight_revoke'
  | 'lord_grace'
  | 'succession';

export interface EstateChange {
  personId: number;
  from: EstateId;
  to: EstateId;
}

/** 두 층 규칙 판정 결과 (세계를 바꾸기 전) */
export interface EstatePlan {
  rule: EstateRule;
  ok: boolean;
  /** 막힌 이유 (i18n reason.estate.*) */
  reason?: string;
  /** 개인 신분 변경 */
  changes: EstateChange[];
  /** 가정 대표 신분 변경 */
  household?: { id: number; from: EstateId; to: EstateId };
  /** 새 가정 (분가) */
  newHousehold?: { id: number; estate: EstateId };
  /** 같은 가정의 성인 자녀: 다음 가장 계승 때 반영 */
  deferred: { personId: number; household: number; to: EstateId }[];
  /** 드는 돈 (파딩) */
  fee?: { household: number; amount: number; reason: string };
  /** 영주 허락이 필요함 (농노 혼인·농노 배우자 해방) */
  lordPermission?: { household: number };
  /** 경고 (i18n warn.*): 연애혼에서 농노가 됨 */
  warning?: string;
  /** 데릴사위 성 변경 */
  surname?: { personId: number; toHousehold: number };
  /** 가정 재산 몰수/압류 */
  confiscate?: { household: number; reason: string };
  /** 성직자 자녀 추문 */
  scandal?: boolean;
}

function emptyPlan(rule: EstateRule): EstatePlan {
  return { rule, ok: true, changes: [], deferred: [] };
}
function blocked(rule: EstateRule, reason: string): EstatePlan {
  return { rule, ok: false, reason: `reason.estate.${reason}`, changes: [], deferred: [] };
}

export interface CheckResult {
  ok: boolean;
  reason?: string;
  /** 드는 돈 (파딩) */
  cost?: number;
}
const no = (reason: string, cost?: number): CheckResult => ({ ok: false, reason: `reason.estate.${reason}`, cost });

// ------------------------------------------------------------------ 저장 상태

export type GuildStage = 'apprentice' | 'journeyman' | 'masterpiece' | 'master';

export interface EstatesState {
  /** 성인 자녀 신분: 다음 가장 계승 때 반영 */
  deferred: { personId: number; household: number; to: EstateId }[];
  /** 신분 하락 기록 (사치 금지법 1계절 유예) */
  falls: Record<number, { day: number; from: EstateId }>;
  /** 도시 도망 중 */
  flights: { personId: number; household: number; since: number; until: number }[];
  /** 길드 경로 (도제 → 직인 → 걸작 → 장인) */
  guild: Record<number, { craft: string; stage: GuildStage; since: number }>;
  /** 상인 조합 회원 */
  merchantGuild: number[];
}

export function emptyEstatesState(): EstatesState {
  return { deferred: [], falls: {}, flights: [], guild: {}, merchantGuild: [] };
}

// ------------------------------------------------------------------ 신분 체계

export class Estates<P extends EstatePerson = EstatePerson> {
  state: EstatesState = emptyEstatesState();

  constructor(private host: EstatesHost<P>, readonly d: EstatesData) {}

  // ---------------------------------------------------------------- 조회

  rank(e: string): number {
    return this.d.estates[e as EstateId]?.rank ?? 0;
  }

  isEstate(e: string): e is EstateId {
    return (ESTATE_IDS as string[]).includes(e);
  }

  /** 성직자처럼 개인 신분만 바뀌는 신분 */
  personalOnly(e: string): boolean {
    return !!this.d.estates[e as EstateId]?.personalOnly;
  }

  /** 가능한 것 전부 (이어받은 것 포함) */
  abilities(e: EstateId): string[] {
    const out = new Set<string>();
    const walk = (x: EstateId, seen: Set<EstateId>): void => {
      if (seen.has(x)) return;
      seen.add(x);
      const def = this.d.estates[x];
      for (const i of def.inherit ?? []) walk(i, seen);
      for (const c of def.can) out.add(c);
    };
    walk(e, new Set());
    // 제약(limits)은 이어받지 않음: 자유민은 농노의 일을 할 수 있지만 영주 허락 제약은 없음
    return [...out];
  }

  can(e: string, what: string): boolean {
    if (!this.isEstate(e)) return false;
    return this.abilities(e).includes(what);
  }

  limits(e: string): string[] {
    return this.isEstate(e) ? [...this.d.estates[e].limits] : [];
  }

  hasLimit(e: string, what: string): boolean {
    return this.limits(e).includes(what);
  }

  /** 주당 부역일 (농노 1, absolute) */
  corveeDays(e: string): number {
    return this.isEstate(e) ? (this.d.estates[e].corveeDaysPerWeek?.value ?? 0) : 0;
  }

  hasFamilyName(e: string): boolean {
    return this.isEstate(e) ? this.d.estates[e].familyName : true;
  }

  houseKind(e: string): string {
    return this.isEstate(e) ? this.d.estates[e].houseKind : 'farmhouse';
  }

  /** 혼인 가능한가 (성직자 불가, 수도회 규칙) */
  canMarry(p: P): boolean {
    return !this.hasLimit(p.estate, 'celibate');
  }

  /** 혼인 승낙 판정 보정 (16-2: 두 단계 이상 차이면 크게 불리) */
  marriageAcceptMod(a: string, b: string): number {
    return Math.abs(this.rank(a) - this.rank(b)) >= this.d.marriage.penaltyFromGap ? this.d.marriage.acceptMod : 0;
  }

  /** 명성 단계 순번 */
  fameTierIndex(tier: string): number {
    return this.d.fameTiers.indexOf(tier);
  }

  // ---------------------------------------------------------------- 돈 (17-4 역산)

  /** S 배수 비용 (파딩) = round(S(of) × mult × 수명 배수) 동화 × 4 */
  costOf(ref: { of: string; mult: number }, bride?: EstateId): number {
    const of = (ref.of === 'bride' ? bride ?? 'freeman' : ref.of) as EstateId;
    return Math.round(this.host.savings(of) * ref.mult * this.host.lifespan()) * 4;
  }

  emancipationFee(): number {
    return this.costOf(this.d.costs.emancipation);
  }
  spouseEmancipationFee(): number {
    return this.costOf(this.d.costs.spouseEmancipation);
  }
  guildFee(): number {
    return this.costOf(this.d.costs.guildFee);
  }
  merchantCapital(): number {
    return this.costOf(this.d.costs.merchantCapital);
  }
  titleFee(): number {
    return this.costOf(this.d.costs.titlePurchase);
  }
  /** 지참금 기준 = 신부 가문 신분 S × 1/4 */
  dowryBase(brideEstate: EstateId): number {
    return this.costOf(this.d.costs.dowryBase, brideEstate);
  }
  /** 지참금 (신부 쪽이 냄): 신랑 가문이 위면 상대 신분 기준 × 1.5 (16-3 혼인 경로) */
  dowry(brideEstate: EstateId, groomEstate: EstateId): number {
    if (this.rank(groomEstate) - this.rank(brideEstate) >= this.d.paths.marryUp.rankStep) return Math.round((this.dowryBase(groomEstate) / 4) * this.d.marriage.upDowryMult) * 4;
    return this.dowryBase(brideEstate);
  }

  // ---------------------------------------------------------------- 두 층 규칙 (16-2 표, 순수 판정)

  private headFollows(plan: EstatePlan, p: P, to: EstateId): void {
    const hh = p.household;
    const head = this.host.headOf(hh);
    if (!head || head.id !== p.id) return;
    const cur = this.host.householdEstate(hh);
    if (this.personalOnly(to) || this.personalOnly(p.estate) || cur === to) return;
    plan.household = { id: hh, from: cur, to };
  }

  private change(plan: EstatePlan, p: P, to: EstateId): void {
    const from = p.estate as EstateId;
    if (from === to || plan.changes.some((c) => c.personId === p.id)) return;
    plan.changes.push({ personId: p.id, from, to });
  }

  /** 미성년 자녀 (본인 자식, 18세 미만), 같은 가정의 성인 자녀 */
  private children(p: P): { minors: P[]; adultsHome: P[] } {
    const minors: P[] = [];
    const adultsHome: P[] = [];
    for (const c of this.host.persons()) {
      if (c.mother !== p.id && c.father !== p.id) continue;
      if (this.host.age(c) < this.d.minorAge) minors.push(c);
      else if (c.household === p.household) adultsHome.push(c);
    }
    return { minors, adultsHome };
  }

  /**
   * 1행 혼인 / 2행 데릴사위: 배우자는 혼인 시 가장의 신분을 따름.
   * - 농노 배우자가 자유민 이상 가정으로: 해방금 절반 + 영주 허락
   * - 자유민 이상이 농노 가정으로: 농노가 됨 (경고)
   * - 데릴사위: 신부 가장의 신분 + 성 변경
   * @param partner 가정 안에 있는 쪽, incoming 들어오는 쪽
   */
  planMarriage(partner: P, incoming: P, opts: { uxorilocal?: boolean } = {}): EstatePlan {
    const rule: EstateRule = opts.uxorilocal ? 'uxorilocal' : 'marriage';
    if (!this.canMarry(partner) || !this.canMarry(incoming)) return blocked(rule, 'celibate');
    const hh = partner.household;
    const head = this.host.headOf(hh);
    // 가장이 성직자(개인 신분)면 가정 쪽 배우자 신분을 따름
    const target = (head && !this.personalOnly(head.estate) ? head.estate : this.personalOnly(partner.estate) ? this.host.householdEstate(hh) : partner.estate) as EstateId;
    const plan = emptyPlan(rule);
    if (incoming.estate === 'serf' && target !== 'serf') {
      plan.fee = { household: hh, amount: this.spouseEmancipationFee(), reason: 'spouse_emancipation' };
      plan.lordPermission = { household: incoming.household };
    }
    if (incoming.estate !== 'serf' && target === 'serf') plan.warning = 'warn.marry_into_serfdom';
    this.change(plan, incoming, target);
    if (opts.uxorilocal) plan.surname = { personId: incoming.id, toHousehold: hh };
    return plan;
  }

  /**
   * 3행 자녀: 출생 시 가정 대표 신분. 4행 사생아: 어머니 개인 신분. 5행 성직자의 자녀: 어머니 개인 신분 + 추문.
   * 가정 대표가 성직자(개인 신분)인 가정의 아이는 어머니(성직자면 아버지) 개인 신분
   */
  birthEstate(mother: P, father: P | null, household: number, opts: { illegitimate?: boolean } = {}): { estate: EstateId; rule: EstateRule; scandal: boolean } {
    const clergyParent = (father && this.personalOnly(father.estate)) || this.personalOnly(mother.estate);
    const motherOwn = (): EstateId => {
      if (!this.personalOnly(mother.estate)) return mother.estate as EstateId;
      const hm = this.host.householdEstate(mother.household);
      return this.personalOnly(hm) ? 'freeman' : hm;
    };
    if (clergyParent) return { estate: motherOwn(), rule: 'clergy_child', scandal: true };
    if (opts.illegitimate) return { estate: motherOwn(), rule: 'illegitimate', scandal: false };
    const he = this.host.householdEstate(household);
    if (this.personalOnly(he)) {
      const alt = !this.personalOnly(mother.estate) ? mother.estate : father && !this.personalOnly(father.estate) ? father.estate : 'freeman';
      return { estate: alt as EstateId, rule: 'birth', scandal: false };
    }
    return { estate: he, rule: 'birth', scandal: false };
  }

  /** 6행 기사 서임·작위: 본인 + 배우자 + 미성년 자녀. 같은 가정의 성인 자녀는 다음 가장 계승 때 */
  planElevation(p: P, to: EstateId, rule: 'knighting' | 'ennoble' = to === 'noble' ? 'ennoble' : 'knighting'): EstatePlan {
    const plan = emptyPlan(rule);
    if (this.personalOnly(p.estate)) return blocked(rule, 'clergy');
    const subjects: P[] = [p];
    const sp = p.spouse ? this.host.persons().find((q) => q.id === p.spouse) : undefined;
    if (sp && !this.personalOnly(sp.estate)) subjects.push(sp);
    const { minors, adultsHome } = this.children(p);
    for (const c of minors) if (!this.personalOnly(c.estate)) subjects.push(c);
    for (const s of subjects) if (this.rank(s.estate) < this.rank(to)) this.change(plan, s, to);
    this.headFollows(plan, p, to);
    for (const c of adultsHome) if (!this.personalOnly(c.estate) && this.rank(c.estate) < this.rank(to)) plan.deferred.push({ personId: c.id, household: c.household, to });
    return plan;
  }

  /** 7행 해방: 해방금을 낸 가정 전체 (도시 도망 해방은 본인만) */
  planEmancipation(household: number, how: 'fee' | 'grace' = 'fee'): EstatePlan {
    const rule: EstateRule = how === 'fee' ? 'emancipation' : 'lord_grace';
    if (this.host.householdEstate(household) !== 'serf') return blocked(rule, 'not_serf');
    const plan = emptyPlan(rule);
    for (const q of this.host.persons()) if (q.household === household && q.estate === 'serf') this.change(plan, q, 'freeman');
    plan.household = { id: household, from: 'serf', to: 'freeman' };
    if (how === 'fee') plan.fee = { household, amount: this.emancipationFee(), reason: 'emancipation' };
    return plan;
  }

  planCityFlight(p: P): EstatePlan {
    if (p.estate !== 'serf') return blocked('city_flight', 'not_serf');
    const plan = emptyPlan('city_flight');
    this.change(plan, p, 'freeman');
    return plan;
  }

  /** 8행 파산 하락: 가정 전체 한 단계 (분가한 다른 가정은 그대로), 재산 압류 */
  planBankruptcy(household: number): EstatePlan {
    const plan = emptyPlan('bankruptcy');
    const S = this.d.falls.stepDown;
    for (const q of this.host.persons()) {
      if (q.household !== household || this.personalOnly(q.estate) || !this.isEstate(q.estate)) continue;
      this.change(plan, q, S[q.estate]);
    }
    const cur = this.host.householdEstate(household);
    const to = S[cur];
    if (to !== cur) plan.household = { id: household, from: cur, to };
    plan.confiscate = { household, reason: 'bankruptcy' };
    return plan;
  }

  /** 9행 길드 제명: 본인만 장인 → 자유민. 가장이면 가정 대표 신분도 */
  planGuildExpulsion(p: P): EstatePlan {
    const G = this.d.falls.guildExpulsion;
    if (p.estate !== G.from) return blocked('guild_expulsion', 'not_artisan');
    const plan = emptyPlan('guild_expulsion');
    this.change(plan, p, G.to);
    this.headFollows(plan, p, G.to);
    return plan;
  }

  /** 10행 중죄 신분 박탈: 본인만 (가장이면 가정 대표 신분은 가장을 따름), 재산 몰수는 가정 전체 */
  planFelony(p: P): EstatePlan {
    const F = this.d.falls.felony;
    const plan = emptyPlan('felony');
    if (!(F.keepIf ?? []).includes(p.estate as EstateId) && this.rank(p.estate) > this.rank(F.to)) {
      this.change(plan, p, F.to);
      this.headFollows(plan, p, F.to);
    }
    plan.confiscate = { household: p.household, reason: 'felony' };
    return plan;
  }

  /** 11행 분가: 분가 시점 신분 유지. 새 가정 대표 = 새 가장의 개인 신분 */
  planBranch(newHead: P, newHousehold: number, members: readonly P[] = []): EstatePlan {
    const plan = emptyPlan('branch');
    const own = this.personalOnly(newHead.estate) ? this.host.householdEstate(newHead.household) : (newHead.estate as EstateId);
    plan.newHousehold = { id: newHousehold, estate: own };
    void members;
    return plan;
  }

  /** 기사 자격 박탈 (16-3): 본인 + 배우자 + 미성년 자녀 */
  planKnightRevoke(p: P): EstatePlan {
    const K = this.d.falls.knightRevoke;
    if (p.estate !== K.from) return blocked('knight_revoke', 'not_knight');
    const plan = emptyPlan('knight_revoke');
    const subjects: P[] = [p];
    const sp = p.spouse ? this.host.persons().find((q) => q.id === p.spouse) : undefined;
    if (sp && sp.estate === K.from) subjects.push(sp);
    for (const c of this.children(p).minors) if (c.estate === K.from) subjects.push(c);
    for (const s of subjects) this.change(plan, s, K.to);
    this.headFollows(plan, p, K.to);
    return plan;
  }

  /** 개인 신분 이동 (길드 가입·상인·성직): 본인만, 가장이면 가정 대표 신분도 (성직자는 개인만) */
  planPersonal(p: P, to: EstateId, rule: EstateRule): EstatePlan {
    const plan = emptyPlan(rule);
    this.change(plan, p, to);
    this.headFollows(plan, p, to);
    return plan;
  }

  // ---------------------------------------------------------------- 실행

  /**
   * 판정 결과 실행: 돈 → 개인 신분 → 가정 대표 신분 → 미룬 성인 자녀 → 성 변경 → 몰수 → 무드렛·연대기·소식·알림.
   * 돈이 모자라면 아무것도 바꾸지 않고 {ok:false}
   */
  apply(plan: EstatePlan): EstatePlan {
    if (!plan.ok) return plan;
    const H = this.host;
    const E = this.d.effects;
    if (plan.fee && plan.fee.amount > 0) {
      if (!H.spend(plan.fee.household, plan.fee.amount, plan.fee.reason)) return { ...plan, ok: false, reason: 'reason.estate.money' };
    }
    const byId = new Map(H.persons().map((q) => [q.id, q]));
    const changed: P[] = [];
    let up = 0;
    let down = 0;
    for (const c of plan.changes) {
      const p = byId.get(c.personId);
      if (!p) continue;
      H.setPersonEstate(p, c.to);
      changed.push(p);
      const r = this.rank(c.to) - this.rank(c.from);
      if (r > 0) up++;
      else if (r < 0) {
        down++;
        this.state.falls[p.id] = { day: H.day(), from: c.from };
      }
      H.onEstateChanged(p, c.from, c.to, plan.rule);
    }
    if (plan.household) {
      const { id, from, to } = plan.household;
      H.setHouseholdEstate(id, to);
      H.onHouseholdEstateChanged(id, from, to, plan.rule);
      if (!this.hasFamilyName(from) && this.hasFamilyName(to)) {
        H.needsFamilyName(id);
        const head = H.headOf(id);
        if (head) H.offerCard(head, E.familyNameCard, {});
      }
    }
    if (plan.newHousehold) H.setHouseholdEstate(plan.newHousehold.id, plan.newHousehold.estate);
    for (const x of plan.deferred) {
      this.state.deferred = this.state.deferred.filter((y) => y.personId !== x.personId);
      this.state.deferred.push(x);
    }
    if (plan.surname) {
      const p = byId.get(plan.surname.personId);
      if (p) H.changeSurname(p, plan.surname.toHousehold);
    }
    if (plan.confiscate) H.confiscate(plan.confiscate.household, plan.confiscate.reason);
    // 연출
    const special: Partial<Record<EstateRule, string>> = {
      emancipation: E.freedMoodlet,
      lord_grace: E.freedMoodlet,
      city_flight: E.freedMoodlet,
      knighting: E.knightedMoodlet,
      ennoble: E.ennobledMoodlet,
    };
    for (const p of changed) {
      const c = plan.changes.find((x) => x.personId === p.id)!;
      const r = this.rank(c.to) - this.rank(c.from);
      H.moodlet(p, special[plan.rule] ?? (r >= 0 ? E.riseMoodlet : E.fallMoodlet));
      H.notice(p, r >= 0 ? 'estate_up' : 'estate_down', { name: p.name ?? '', estate: `estate.${c.to}`, rule: `estate.rule.${plan.rule}` });
    }
    if (changed.length && (up || down)) {
      const trig = up >= down ? E.chronicleUp : E.chronicleDown;
      const to = plan.changes[0].to;
      H.chronicle(trig, changed, { rule: plan.rule, estate: to });
      H.news(up >= down ? E.newsUp : E.newsDown, { a: changed[0].name ?? '', estate: `estate.${to}`, rule: `estate.rule.${plan.rule}` }, changed);
    }
    return plan;
  }

  /** 가장 계승 (H inheritance 가 새 가장을 정한 뒤): 미룬 성인 자녀 신분 반영 → 가정 대표 = 새 가장 개인 신분 */
  onSuccession(household: number, newHead: P): EstatePlan {
    const plan = emptyPlan('succession');
    const byId = new Map(this.host.persons().map((q) => [q.id, q]));
    for (const x of this.state.deferred.filter((y) => y.household === household)) {
      const p = byId.get(x.personId);
      if (p && p.household === household && this.rank(p.estate) < this.rank(x.to)) this.change(plan, p, x.to);
    }
    this.state.deferred = this.state.deferred.filter((y) => y.household !== household);
    const headTo = (plan.changes.find((c) => c.personId === newHead.id)?.to ?? newHead.estate) as EstateId;
    const cur = this.host.householdEstate(household);
    if (!this.personalOnly(headTo) && headTo !== cur) plan.household = { id: household, from: cur, to: headTo };
    if (!plan.changes.length && !plan.household) return plan;
    return this.apply(plan);
  }

  /** 분가 실행: 새 가정 대표 신분을 정하고, 떠나는 사람의 미룬 신분은 버림 (분가 시점 유지) */
  branch(newHead: P, newHousehold: number, members: readonly P[] = [newHead]): EstatePlan {
    const plan = this.planBranch(newHead, newHousehold, members);
    const ids = new Set(members.map((m) => m.id));
    ids.add(newHead.id);
    this.state.deferred = this.state.deferred.filter((y) => !ids.has(y.personId));
    return this.apply(plan);
  }

  /** 혼인 실행 (14-4 혼례 뒤 리드가 부름): 영주 허락 → 해방금 절반 → 신분 */
  marry(partner: P, incoming: P, opts: { uxorilocal?: boolean } = {}): EstatePlan {
    const plan = this.planMarriage(partner, incoming, opts);
    if (plan.ok && plan.lordPermission && !this.lordPermits(plan.lordPermission.household)) return { ...plan, ok: false, reason: 'reason.estate.lord_permission' };
    return this.apply(plan);
  }

  /** 영주 허락 (농노 혼인·이사): 영주 호의가 기준 이상 */
  lordPermits(household: number): boolean {
    return this.host.lordFavor(household) >= this.d.marriage.lordPermissionFavorMin;
  }

  /** 출생 때 리드가 부름: 아기 신분 설정 (+ 성직자 자녀 추문 여부) */
  born(baby: P, mother: P, father: P | null, opts: { illegitimate?: boolean } = {}): { estate: EstateId; rule: EstateRule; scandal: boolean } {
    const r = this.birthEstate(mother, father, baby.household, opts);
    if (baby.estate !== r.estate) this.host.setPersonEstate(baby, r.estate);
    return r;
  }

  // ---------------------------------------------------------------- 상승 경로 (16-3)

  canPayEmancipation(household: number): CheckResult {
    const cost = this.emancipationFee();
    if (this.host.householdEstate(household) !== 'serf') return no('not_serf', cost);
    if (this.host.money(household) < cost) return no('money', cost);
    return { ok: true, cost };
  }

  /** 해방금 (8은화, lifespan): 가정 전체 → 자유민 */
  payEmancipation(household: number): EstatePlan {
    const c = this.canPayEmancipation(household);
    if (!c.ok) return blocked('emancipation', c.reason!.slice('reason.estate.'.length));
    return this.apply(this.planEmancipation(household, 'fee'));
  }

  /** 영주 은혜 사건: 해방금 없이 가정 전체 해방 */
  lordGrace(household: number): EstatePlan {
    const plan = this.apply(this.planEmancipation(household, 'grace'));
    if (plan.ok) this.host.addLordFavor(household, this.d.paths.grace.lordFavorGain);
    return plan;
  }

  /** 도시 도망 기간 (일) = min(달력 1년 + 1일, 29일 × 수명 배수) */
  flightDays(): number {
    const F = this.d.paths.flight;
    const L = this.host.lifespan();
    const SD = this.host.seasonDays();
    return Math.min(durDays(F.calendarYear, L, SD) + durDays(F.plusDays, L, SD), durDays(F.cap, L, SD));
  }

  canFlee(p: P): CheckResult {
    if (!this.d.paths.flight.from.includes(p.estate as EstateId)) return no('not_serf');
    if (this.state.flights.some((f) => f.personId === p.id)) return no('already');
    if (this.host.age(p) < this.d.minorAge) return no('stage');
    return { ok: true };
  }

  /** 도시로 도망 (본인만): 마을을 떠나 기간이 차면 자유민 */
  startFlight(p: P): CheckResult {
    const c = this.canFlee(p);
    if (!c.ok) return c;
    const day = this.host.day();
    this.state.flights.push({ personId: p.id, household: p.household, since: day, until: day + Math.ceil(this.flightDays()) });
    this.host.leaveVillage(p, 'city_flight');
    this.host.notice(p, 'flight_started', { name: p.name ?? '', days: Math.ceil(this.flightDays()) });
    return { ok: true };
  }

  // ---------------------------------------------------------------- 길드 (자유민 → 장인)

  guildStage(p: P): GuildStage | null {
    return this.state.guild[p.id]?.stage ?? null;
  }

  isGuildMember(p: P): boolean {
    return this.state.guild[p.id]?.stage === 'master';
  }

  canApprentice(p: P): CheckResult {
    if (!this.d.paths.guild.from.includes(p.estate as EstateId)) return no('from');
    if (this.state.guild[p.id]) return no('already');
    return { ok: true };
  }

  startApprenticeship(p: P, craft: string): CheckResult {
    const c = this.canApprentice(p);
    if (!c.ok) return c;
    this.state.guild[p.id] = { craft, stage: 'apprentice', since: this.host.day() };
    this.host.notice(p, 'apprentice_started', { name: p.name ?? '', craft: `career.${craft}` });
    return { ok: true };
  }

  /** 걸작 제출: 직인 최소 기간 + 품질 → 걸작 인정 (가입비를 내면 장인) */
  submitMasterpiece(p: P, quality: number): CheckResult {
    const g = this.state.guild[p.id];
    const G = this.d.paths.guild;
    if (!g || g.stage !== 'journeyman') return no('guild_stage');
    if (this.host.day() - g.since < durDays(G.journeymanMinDays, this.host.lifespan(), this.host.seasonDays())) return no('days');
    if (quality < G.masterpieceMinQuality) {
      this.host.notice(p, 'masterpiece_fail', { name: p.name ?? '' });
      return no('quality');
    }
    g.stage = 'masterpiece';
    g.since = this.host.day();
    this.host.fame(p.household, G.masterpieceFame, 'masterpiece', p);
    this.host.notice(p, 'masterpiece_ok', { name: p.name ?? '' });
    return { ok: true };
  }

  canJoinGuild(p: P): CheckResult {
    const cost = this.guildFee();
    if (this.guildStage(p) !== 'masterpiece') return no('guild_stage', cost);
    if (!this.d.paths.guild.from.includes(p.estate as EstateId)) return no('from', cost);
    if (this.host.money(p.household) < cost) return no('money', cost);
    return { ok: true, cost };
  }

  /** 길드 가입 (가입비 6은화) → 장인 */
  joinGuild(p: P): EstatePlan {
    const c = this.canJoinGuild(p);
    if (!c.ok) return blocked('guild_join', c.reason!.slice('reason.estate.'.length));
    const plan = this.planPersonal(p, 'artisan', 'guild_join');
    plan.fee = { household: p.household, amount: c.cost!, reason: 'guild_fee' };
    const out = this.apply(plan);
    if (out.ok) this.state.guild[p.id].stage = 'master';
    return out;
  }

  /** 프리셋·이주민 장인: 길드 회원 자격을 바로 줌 */
  grantGuild(p: P, craft: string): void {
    this.state.guild[p.id] = { craft, stage: 'master', since: this.host.day() };
  }

  // ---------------------------------------------------------------- 상인

  canBecomeMerchant(p: P): CheckResult {
    const cost = this.merchantCapital();
    if (!this.d.paths.merchant.from.includes(p.estate as EstateId)) return no('from', cost);
    if (this.host.money(p.household) < cost) return no('capital', cost);
    return { ok: true, cost };
  }

  /** 자본 3금화 이상 + 상인 조합 가입 → 상인 (자본은 쓰지 않음, 가입비만) */
  becomeMerchant(p: P): EstatePlan {
    const c = this.canBecomeMerchant(p);
    if (!c.ok) return blocked('merchant', c.reason!.slice('reason.estate.'.length));
    const plan = this.planPersonal(p, 'merchant', 'merchant');
    const fee = this.costOf(this.d.paths.merchant.joinFee);
    if (fee > 0) plan.fee = { household: p.household, amount: fee, reason: 'merchant_guild_fee' };
    const out = this.apply(plan);
    if (out.ok && !this.state.merchantGuild.includes(p.id)) this.state.merchantGuild.push(p.id);
    return out;
  }

  // ---------------------------------------------------------------- 기사 서임

  canKnight(p: P): CheckResult {
    const K = this.d.paths.knighting;
    if (this.rank(p.estate) >= this.rank('knight') || this.personalOnly(p.estate)) return no('from');
    if (!this.host.isSquire(p)) return no('not_squire');
    if (this.host.skill(p, K.skill) < K.minLevel) return no('skill');
    if (this.host.lordFavor(p.household) < K.minLordFavor) return no('lord_favor');
    if (!this.host.hasFeat(p)) return no('no_feat');
    return { ok: true };
  }

  /** 기사 서임 (무예 + 영주 추천 + 마상시합 우승 또는 전공) */
  knight(p: P): EstatePlan {
    const c = this.canKnight(p);
    if (!c.ok) return blocked('knighting', c.reason!.slice('reason.estate.'.length));
    const out = this.apply(this.planElevation(p, 'knight', 'knighting'));
    if (out.ok) this.host.fame(p.household, this.d.paths.knighting.fame, 'knighted', p);
    return out;
  }

  // ---------------------------------------------------------------- 작위 매입

  canBuyTitle(household: number): CheckResult {
    const T = this.d.paths.title;
    const cost = this.titleFee();
    const head = this.host.headOf(household);
    if (!head || !T.from.includes(head.estate as EstateId)) return no('from', cost);
    if (this.fameTierIndex(this.host.fameTier(household)) < this.fameTierIndex(T.minFameTier)) return no('fame_tier', cost);
    if (this.host.money(household) < cost) return no('money', cost);
    return { ok: true, cost };
  }

  /** 작위 매입 (20금화 + 명성 명망 이상): 가장 + 배우자 + 미성년 자녀 → 귀족, 귀족들의 멸시 */
  buyTitle(household: number): EstatePlan {
    const c = this.canBuyTitle(household);
    if (!c.ok) return blocked('ennoble', c.reason!.slice('reason.estate.'.length));
    const head = this.host.headOf(household)!;
    const plan = this.planElevation(head, 'noble', 'ennoble');
    plan.fee = { household, amount: c.cost!, reason: 'title_purchase' };
    const out = this.apply(plan);
    if (out.ok) {
      const byId = new Map(this.host.persons().map((q) => [q.id, q]));
      for (const ch of out.changes) {
        const p = byId.get(ch.personId);
        if (p) this.host.respectFrom(p, 'noble', this.d.paths.title.nobleRespect);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- 성직

  canTakeVows(p: P): CheckResult {
    if (this.personalOnly(p.estate)) return no('already');
    if (p.spouse) return no('married');
    if (!this.d.paths.vows.minStages.includes(p.lifeStage)) return no('stage');
    return { ok: true };
  }

  /** 누구나 → 개인 성직자 (가정 대표 신분은 그대로) */
  takeVows(p: P): EstatePlan {
    const c = this.canTakeVows(p);
    if (!c.ok) return blocked('vows', c.reason!.slice('reason.estate.'.length));
    return this.apply(this.planPersonal(p, 'clergy', 'vows'));
  }

  /** 주교가 됨: 가문 명성 크게 상승 */
  becameBishop(p: P): void {
    this.host.fame(p.household, this.d.paths.vows.bishopFame, 'bishop', p);
    this.host.notice(p, 'bishop', { name: p.name ?? '' });
  }

  // ---------------------------------------------------------------- 하락 (16-3)

  /** 파산 (17-6 압류 뒤 빚이 남음): 가정 전체 한 단계 하락 + 압류 */
  bankruptcyFall(household: number): EstatePlan {
    const out = this.apply(this.planBankruptcy(household));
    const head = this.host.headOf(household);
    this.host.fame(household, this.d.falls.fame.bankruptcy, 'bankruptcy', head);
    return out;
  }

  guildExpel(p: P): EstatePlan {
    const out = this.apply(this.planGuildExpulsion(p));
    if (out.ok) {
      delete this.state.guild[p.id];
      this.host.fame(p.household, this.d.falls.fame.guildExpulsion, 'guild_expulsion', p);
    }
    return out;
  }

  felony(p: P): EstatePlan {
    const out = this.apply(this.planFelony(p));
    this.host.fame(p.household, this.d.falls.fame.felony, 'felony', p);
    return out;
  }

  revokeKnighthood(p: P): EstatePlan {
    const out = this.apply(this.planKnightRevoke(p));
    if (out.ok) this.host.fame(p.household, this.d.falls.fame.knightRevoke, 'knight_revoke', p);
    return out;
  }

  /** 사치 금지법 유예용: 마지막 신분 하락 */
  lastFall(p: P): { day: number; from: EstateId } | null {
    return this.state.falls[p.id] ?? null;
  }

  // ---------------------------------------------------------------- 하루 (자정)

  /** 자정: 도시 도망 (들킴 / 해방), 도제 → 직인 */
  daily(): void {
    const H = this.host;
    const day = H.day();
    const byId = new Map(H.persons().map((q) => [q.id, q]));
    const F = this.d.paths.flight;
    for (const f of [...this.state.flights]) {
      const p = byId.get(f.personId);
      if (!p) {
        this.state.flights.splice(this.state.flights.indexOf(f), 1);
        continue;
      }
      if (day >= f.until) {
        this.state.flights.splice(this.state.flights.indexOf(f), 1);
        this.apply(this.planCityFlight(p));
        H.notice(p, 'flight_free', { name: p.name ?? '' });
        H.returnToVillage(p, 'flight_free');
        continue;
      }
      if (H.rng.next() < F.detectPerDay) {
        this.state.flights.splice(this.state.flights.indexOf(f), 1);
        H.addLordFavor(f.household, F.caughtLordFavor);
        H.notice(p, 'flight_caught', { name: p.name ?? '' });
        H.returnToVillage(p, 'flight_caught');
        H.punish(p, 'flight_caught');
      }
    }
    const G = this.d.paths.guild;
    const appDays = durDays(G.apprenticeDays, H.lifespan(), H.seasonDays());
    for (const [id, g] of Object.entries(this.state.guild)) {
      if (g.stage !== 'apprentice' || day - g.since < appDays) continue;
      g.stage = 'journeyman';
      g.since = day;
      const p = byId.get(Number(id));
      if (p) H.notice(p, 'journeyman', { name: p.name ?? '', craft: `career.${g.craft}` });
    }
  }

  fleeing(p: P): boolean {
    return this.state.flights.some((f) => f.personId === p.id);
  }

  /** 결정론 해시용 */
  hashParts(out: (string | number)[]): void {
    out.push(JSON.stringify(this.state));
  }
}
