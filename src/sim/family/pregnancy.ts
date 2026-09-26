/**
 * 임신과 출산 (GDD 15-1, 15-2, 20-7, 29-1, 29-2).
 * - 수태: 동침 1회당 확률 × 나이·건강·계절·소원·원함 (조작 가문은 인구 피드백 없음)
 * - 임신 3단계 (단계당 1일, lifespan): 단계 효과는 질의 함수로 내보냄 (needDecayMult, moveMult, canWork, bellyStage, energyCap)
 * - 위험 판정: 배경 위험 (단계마다) + 위험 사건 (굶주림, 병, 충격, 낙상, 과로) → 합병증 / 조산 / 유산·사산. 사망 설정 출산 칸이 꺼지면 합병증까지만
 * - 진통 → 선택 대기 (산파 / 가족 / 혼자, 의도 laborChoice, 시간 초과 자동) → 결과 (순산 / 난산 / 위험: 산모·아기 사망 가능)
 * - 교차 표 7행 (15-1): 산모 사망 시 기적의 출산, 농노 부역일, 역병 격리 중 진통, 배우자 여정 중 진통, 가정 상한 초과, 장면 중 진통, 난산 회복 2일
 * 상태는 Person.pregnancy (넓힌 모양 PregnancyState) 와 이 모듈의 회복 표. 무작위는 host.rng 만. 렌더러/DOM 없음
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import type { NeedId } from '../core/types';
import type { StoryData } from '../data/simData';
import { interactionSchema, socialSchema } from '../data/schema';
import type { Person } from '../people/person';
import { allOnRules, type DeathRulesView } from '../health/deathRules';

// ------------------------------------------------------------------ 데이터

const dur = z.object({ value: z.number(), scale: z.enum(['absolute', 'season', 'lifespan', 'per_life']) });
const riskOdds = z.object({ complication: z.number(), premature: z.number(), loss: z.number() });
const stageSchema = z.object({
  belly: z.number().int().min(0).max(2),
  needDecay: z.record(z.string(), z.number()),
  moveMult: z.number(),
  canWork: z.boolean(),
  enterMoodlets: z.array(z.string()),
  dailyMoodlets: z.array(z.string()).optional(),
  wake: z.object({ chance: z.number(), needs: z.record(z.string(), z.number()), moodlet: z.string() }).optional(),
  craving: z.object({ chance: z.number(), moodlet: z.string(), wishes: z.array(z.string()) }).optional(),
  knownOnEnter: z.boolean(),
}).loose();
const gateSchema = z.object({
  who: z.enum(['self', 'target', 'household']),
  stages: z.array(z.number().int()),
  known: z.boolean().optional(),
  announced: z.boolean().optional(),
  targetRoles: z.array(z.string()).optional(),
});

export const pregnancySchema = z.object({
  conception: z.object({
    perCoitus: z.number(),
    coitusPerDay: z.record(z.string(), z.number()),
    actualCountWantsMult: z.record(z.string(), z.number()),
    fertileAge: z.tuple([z.number(), z.number()]),
    declineFromAge: z.number(),
    declineYears: z.number(),
    declineFloor: z.number(),
    birthCooldown: dur,
    seasonMult: z.record(z.string(), z.number()),
    healthTraitKey: z.string(),
    healthMultRange: z.tuple([z.number(), z.number()]),
    weakenedMult: z.number(),
    wishes: z.array(z.string()),
    wishMult: z.number(),
  }).loose(),
  stage: dur,
  stages: z.array(stageSchema).length(3),
  twins: z.object({ base: z.number(), traitKey: z.string() }),
  risk: z.object({
    background: z.array(z.number()).length(3),
    ageFrom: z.number(),
    ageMult: z.number(),
    noRiskBelowAge: z.number(),
    presetLossMult: z.record(z.string(), z.number()),
    events: z.object({ hunger: riskOdds, illness: riskOdds, shock: riskOdds, fall: riskOdds, overwork: riskOdds }),
    hungerBelow: z.number(),
    complicationMoodlet: z.string(),
    prematureMoodlet: z.string(),
    prematureFrailChance: z.number(),
    prematureFrailTrait: z.string(),
  }).loose(),
  loss: z.object({
    moodlet: z.string(),
    memory: z.object({ kind: z.string(), importance: z.number(), valence: z.number() }),
    traumaChance: z.number(),
    news: z.object({ early: z.string(), late: z.string() }),
  }),
  labor: z.object({
    timeout: dur,
    moodlet: z.string(),
    card: z.string(),
    cardOptions: z.array(z.enum(['midwife', 'family', 'alone'])),
    spouseCard: z.string(),
    letter: z.string(),
    quarantineFeeMult: z.number(),
    familyMinAge: z.number(),
  }),
  delivery: z.object({
    danger: z.object({ midwife: z.number(), family: z.number(), alone: z.number() }),
    difficult: z.object({ midwife: z.number(), family: z.number(), alone: z.number() }),
    skill: z.string(),
    skillPerLevel: z.number(),
    skillFloor: z.number(),
    prepMult: z.record(z.string(), z.number()),
    mult: z.object({ weakened: z.number(), hungry: z.number(), complication: z.number(), premature: z.number(), age: z.number(), twins: z.number() }),
    healthTraitKey: z.string(),
    maternalDeath: z.number(),
    infantDeath: z.number(),
    recovery: dur,
    recoveryEnergyCap: z.number(),
    memory: z.object({ kind: z.string(), importance: z.number(), valence: z.number() }),
    moodlets: z.object({
      mother: z.string(),
      father: z.string(),
      difficult: z.string(),
      twins: z.string(),
      grandparent: z.string(),
      widower: z.string(),
      healthy: z.string(),
      cramped: z.string(),
    }),
  }).loose(),
  motherDeath: z.object({ miracleWithHealer: z.number(), miracleAlone: z.number() }),
  corvee: z.object({ lordFavorDelta: z.number() }),
  chronicle: z.object({
    birth: z.string(),
    miscarriage: z.string(),
    stillbirth: z.string(),
    infantDeath: z.string(),
    motherDeath: z.string(),
    miracle: z.string(),
  }),
  prep: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  cradleObject: z.string(),
  midwifeRoles: z.array(z.string()),
  gates: z.record(z.string(), z.union([gateSchema, z.string()])),
  interactions: z.record(z.string(), interactionSchema),
  social: z.record(z.string(), socialSchema),
}).loose();
export type PregnancyData = z.infer<typeof pregnancySchema>;
export type PregnancyGate = z.infer<typeof gateSchema>;

/** SimData.family.pregnancy (원본) → 검증된 데이터. 없으면 null (기능 꺼짐 → story.json 대체 수치) */
export function parsePregnancy(raw: unknown): PregnancyData | null {
  if (!raw) return null;
  return pregnancySchema.parse(raw);
}

// ------------------------------------------------------------------ 상태와 호스트

export type LaborOption = 'midwife' | 'family' | 'alone';
export type RiskKind = 'hunger' | 'illness' | 'shock' | 'fall' | 'overwork';
export type RiskOutcome = 'none' | 'complication' | 'premature' | 'loss';
export type BirthOutcome = 'easy' | 'difficult' | 'dangerous';
export type PregStat = 'pregnancy' | 'birth' | 'loss' | 'maternal_death' | 'infant_death' | 'miracle';

/** 진통 상태 (선택 대기 포함) */
export interface LaborState {
  /** 시작한 분 (절대), 시작한 날 */
  since: number;
  day: number;
  /** 선택을 기다리는 중 (조작 가문) / 시간 초과 분 */
  pending: boolean;
  deadline: number;
  /** 진통 때 배우자(아이 아버지)가 여정/전쟁 중이었음 (귀가 카드를 냄) */
  spouseAway: boolean;
  /** 역병 격리/봉쇄 중이었음 (산파 비용 2배 + 감염 판정) */
  quarantine: boolean;
  /** 끊은 장면이 있었음 (장면 스택: 출산 장면이 먼저) */
  interruptedScene: boolean;
}

/** Person.pregnancy 를 넓힌 모양 (since, stage, father 는 Person 타입 그대로) */
export interface PregnancyState {
  since: number;
  stage: number;
  father: number;
  known?: boolean;
  announced?: boolean;
  complication?: boolean;
  premature?: boolean;
  /** 준비물/상태: clothes, cradle, cloth, water, midwifeBooked, midwifeVisited */
  prep?: string[];
  labor?: LaborState | null;
}

export interface MidwifeOffer {
  /** 오는 산파 (NPC). 없으면 null (추상 산파) */
  person: Person | null;
  /** 의술 스킬 레벨 (0~10) */
  skill: number;
  /** 산파 삯 (파딩, 격리 배수 전) */
  fee: number;
}

/**
 * 리드가 sim.ts 에 구현하는 창구. 판정기(lifeJudge)는 JudgeHost 에서 기본값 창구를 만들어 씀 (judgePregnancy).
 */
export interface PregnancyHost {
  readonly persons: readonly Person[];
  readonly rng: Rng;
  day(): number;
  /** 절대 게임 분 (진통 시간 초과) */
  minute(): number;
  /** 수명 배수 (lifespan 스케일) */
  lifespan(): number;
  /** 표시 나이 */
  age(p: Person): number;
  /** 'spring' | 'summer' | 'autumn' | 'winter' */
  season(): string;
  /** traits.json 의 effects (twinsBonus, health …) */
  traitEffects(traitId: string): Record<string, unknown> | undefined;
  /** 조작 가문 식구 (인구 피드백 없음) */
  controlled(p: Person): boolean;
  /** 진통 선택을 플레이어가 고름 (카드/UI). false 면 바로 자동 선택 */
  chooses(p: Person): boolean;
  /** 오늘 실제 동침(social.propose_bed 성공) 횟수. 전체 세밀도가 아니면 null (기대 횟수를 씀) */
  coitusToday(w: Person, h: Person): number | null;
  hasWish(p: Person, wishId: string): boolean;
  addWish(p: Person, wishId: string): void;
  moodlet(p: Person, id: string): void;
  memory(p: Person, kind: string, importance: number, valence: number): void;
  news(kind: string, args: Record<string, string | number>, subjects: Person[]): void;
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
  /** 연대기 삽화 트리거 (24장) */
  chronicle(triggerId: string, subjects: Person[]): void;
  /** "상처 입은 영혼" 판정 (11-6) */
  trauma(p: Person, source: string): void;
  kill(p: Person, cause: string): void;
  /** 아기 하나 (유전·이름은 리드/G) */
  birth(mother: Person, father: Person | null): Person | null;
  /** 세례 예약 플래그 (21장 M10) */
  baptismDue(baby: Person): void;
  householdSize(household: number): number;
  householdCap(household: number): number;
  /** 가구 돈 (파딩) */
  money(p: Person): number;
  spend(p: Person, amount: number, reason: string): boolean;
  isOnJourney(p: Person): boolean;
  isInScene(p: Person): boolean;
  /** 장면 스택: 지금 장면을 끊고 출산 장면을 먼저 (27-7) */
  interruptScene(p: Person, reason: string): void;
  /** 사건 카드 내기. 카드 엔진이 없으면 false */
  offerCard(personId: number, cardId: string, vars: Record<string, string | number>): boolean;
  letter(to: Person, kind: string, args: Record<string, string | number>): void;
  deathRules(): DeathRulesView;
  /** 오늘 이 사람이 부역일인가 (농노) */
  isCorveeDay(p: Person): boolean;
  /** 후기 임신 부역 면제 + 영주 호의 변화 */
  corveeExempt(p: Person, lordFavorDelta: number): void;
  /** 역병 격리/도시 봉쇄 중인가 */
  isQuarantined(p: Person): boolean;
  /** 감염 판정 훅 (M11): 산파 → 산모, 산모 → 산파 */
  infectionRoll(carrier: Person | null, p: Person, source: string): void;
  /** 올 수 있는 산파. 격리로 못 오거나 없으면 null */
  midwife(p: Person): MidwifeOffer | null;
  /** 치유사/산파가 곁에 있음 (기적의 출산 50%) */
  healerPresent(p: Person): boolean;
  /** 통계 (판정기 외 지표) */
  record(kind: PregStat, p: Person, n?: number): void;
}

/** 판정기 통계 묶음 (lifeJudge 의 stats/lastBirth/stageDeaths 를 그대로 넘김) */
export interface JudgeBinding {
  stats: { births: number; deaths: number; deathsByCause: Record<string, number>; deathsUnder18: number; pregnancies: number; losses: number };
  lastBirth: Map<number, number>;
  stageDeaths: Record<string, number>;
  age(p: Person): number;
}

export interface RiskResult {
  outcome: RiskOutcome;
  /** 사망 설정 때문에 합병증으로 낮춰짐 */
  capped: boolean;
}

export interface DeliveryResult {
  outcome: BirthOutcome;
  attendant: LaborOption;
  babies: Person[];
  /** 태어났지만 숨진 아기 */
  babyDeaths: Person[];
  motherDied: boolean;
  twins: boolean;
  /** 사망 설정 대체 결과 (20-7 출산: 난산 + 합병증 + 회복 2배) */
  fallback: boolean;
  /** 남긴 연대기 트리거 */
  chronicle: string[];
  letterSent: boolean;
  overCap: boolean;
}

export interface MotherDeathResult {
  kind: 'miracle' | 'fetus_died';
  babies: Person[];
}

/** 무엇이 기간 필드인지: 수명 배수를 곱할 값 (29-0) */
function days(d: { value: number; scale: string }, lifespan: number): number {
  return d.scale === 'lifespan' ? d.value * lifespan : d.value;
}

export function stateOf(p: Person): PregnancyState | null {
  return (p.pregnancy as PregnancyState | null) ?? null;
}

// ------------------------------------------------------------------ 시스템

export class PregnancySystem {
  /** 난산 회복: 사람 id → 끝나는 날 (lifespan), 에너지 상한 */
  readonly recovery = new Map<number, { until: number; cap: number }>();
  /** 판정기 통계 연결 (judgePregnancy 가 매번 묶음) */
  judge: JudgeBinding | null = null;
  private ownLastBirth = new Map<number, number>();

  constructor(readonly host: PregnancyHost, readonly d: PregnancyData) {}

  private get lastBirth(): Map<number, number> {
    return this.judge?.lastBirth ?? this.ownLastBirth;
  }

  private age(p: Person): number {
    return this.host.age(p);
  }

  private stat(kind: PregStat, p: Person, n = 1): void {
    this.host.record(kind, p, n);
    const j = this.judge;
    if (!j) return;
    const s = j.stats;
    if (kind === 'pregnancy') s.pregnancies += n;
    else if (kind === 'birth' || kind === 'miracle') s.births += n;
    else if (kind === 'loss') s.losses += n;
    else if (kind === 'maternal_death' || kind === 'infant_death') {
      s.deaths += n;
      s.deathsByCause.childbirth = (s.deathsByCause.childbirth ?? 0) + n;
      if (kind === 'infant_death') {
        s.deathsUnder18 += n;
        j.stageDeaths[p.lifeStage] = (j.stageDeaths[p.lifeStage] ?? 0) + n;
      }
    }
  }

  private person(id: number): Person | null {
    if (!id) return null;
    return this.host.persons.find((q) => q.id === id) ?? null;
  }

  private rules(): DeathRulesView {
    return this.host.deathRules();
  }

  /** 산모 출산 칸의 세부 (maternal/infant/loss) 가 켜져 있는가 + 배수 */
  private childbirthChance(p: Person, sub: 'maternal' | 'infant' | 'loss'): number {
    const r = this.rules();
    const g = r.group(p.lifeStage, this.age(p));
    if (!r.allows('childbirth', g, sub)) return 0;
    return r.subChance('childbirth', sub);
  }

  private stageLen(): number {
    return Math.max(1e-6, days(this.d.stage, this.host.lifespan()));
  }

  private traitSum(p: Person, key: string): number {
    let s = 0;
    for (const t of p.traits) {
      const v = this.host.traitEffects(t)?.[key];
      if (typeof v === 'number') s += v;
    }
    return s;
  }

  private traitProduct(p: Person, key: string): number {
    let m = 1;
    for (const t of p.traits) {
      const v = this.host.traitEffects(t)?.[key];
      if (typeof v === 'number') m *= v;
    }
    return m;
  }

  // ---------------------------------------------------------------- 수태

  /** 하루 한 번 (18-3 생애 판정기). feedback = 인구 피드백 배수 (조작 가문은 무시) */
  conceive(day: number, feedback: number): void {
    const C = this.d.conception;
    const cooldown = days(C.birthCooldown, this.host.lifespan());
    for (const w of this.host.persons) {
      if (w.sex !== 'female' || !w.spouse || w.pregnancy || w.infant) continue;
      const age = this.age(w);
      if (age < C.fertileAge[0] || age > C.fertileAge[1]) continue;
      if (day - (this.lastBirth.get(w.id) ?? -1e9) < cooldown) continue;
      const h = this.person(w.spouse);
      if (!h || h.household !== w.household) continue;
      const actual = this.host.coitusToday(w, h);
      let pr: number;
      if (actual === null) {
        const times = C.coitusPerDay[w.wantsKids] ?? C.coitusPerDay.any ?? 0;
        pr = 1 - Math.pow(1 - C.perCoitus, times);
      } else {
        pr = (1 - Math.pow(1 - C.perCoitus, actual)) * (C.actualCountWantsMult[w.wantsKids] ?? 1);
      }
      if (age >= C.declineFromAge) pr *= Math.max(C.declineFloor, 1 - (age - C.declineFromAge) / C.declineYears);
      pr *= C.seasonMult[this.host.season()] ?? 1;
      const health = this.traitProduct(w, C.healthTraitKey);
      pr *= Math.max(C.healthMultRange[0], Math.min(C.healthMultRange[1], health));
      if (w.weakened) pr *= C.weakenedMult;
      if (C.wishes.some((id) => this.host.hasWish(w, id) || this.host.hasWish(h, id))) pr *= C.wishMult;
      // 조작 가문은 피드백 없음 (플레이어 선택 존중)
      if (!this.host.controlled(w)) pr *= feedback;
      if (this.host.rng.next() < pr) this.begin(w, h, day);
    }
  }

  /** 임신 시작 (테스트/사건 카드도 씀) */
  begin(w: Person, father: Person | null, day = this.host.day()): PregnancyState {
    const g: PregnancyState = { since: day, stage: 1, father: father?.id ?? 0, known: false, announced: false, prep: [], labor: null };
    w.pregnancy = g;
    this.stat('pregnancy', w);
    for (const m of this.d.stages[0].enterMoodlets) this.host.moodlet(w, m);
    return g;
  }

  // ---------------------------------------------------------------- 하루 판정

  /** 하루 한 번: 진통 시간 초과, 부역일, 굶주림 위험, 배경 위험, 단계 진행, 진통 시작, 회복 끝 */
  daily(day: number): void {
    for (const [id, r] of [...this.recovery]) if (day >= r.until) this.recovery.delete(id);
    const len = this.stageLen();
    const R = this.d.risk;
    for (const p of [...this.host.persons]) {
      const g = stateOf(p);
      if (!g) continue;
      if (g.labor) {
        // 어제 시작해 아직 고르지 않은 진통: 시간 초과면 자동
        if (g.labor.pending && this.host.minute() >= g.labor.deadline) this.chooseLabor(p, this.autoOption(p), true);
        continue;
      }
      // 농노 부역일 (교차 표 2행): 후기 면제 + 영주 호의 소폭 하락, 초기/중기는 부역하되 과로 판정
      if (this.host.isCorveeDay(p)) {
        if (g.stage >= 3) {
          this.host.corveeExempt(p, this.d.corvee.lordFavorDelta);
        } else this.riskEvent(p, 'overwork');
      }
      if (!p.pregnancy || stateOf(p)?.labor) continue;
      // 굶주림 (배고픔 10 미만 또는 쇠약)
      if (p.weakened || p.need('hunger') < R.hungerBelow) {
        this.riskEvent(p, 'hunger');
        if (!p.pregnancy || stateOf(p)?.labor) continue;
      }
      // 배경 위험 (단계마다 한 번 → 하루씩 나눔)
      const lossP = this.lossChanceToday(p, g, len);
      if (this.host.rng.next() < lossP) {
        this.lose(p, g);
        continue;
      }
      for (const m of this.d.stages[g.stage - 1]?.dailyMoodlets ?? []) this.host.moodlet(p, m);
      if (day - g.since < len * g.stage) continue;
      if (g.stage < 3) this.enterStage(p, g, g.stage + 1);
      else this.startLabor(p);
    }
  }

  /** 오늘 배경 유산/사산 확률 (나이 가중, 프리셋 배수, 사망 설정) */
  lossChanceToday(p: Person, g: PregnancyState, len = this.stageLen()): number {
    const R = this.d.risk;
    const age = this.age(p);
    if (age < R.noRiskBelowAge) return 0;
    const allow = this.childbirthChance(p, 'loss');
    if (allow <= 0) return 0;
    let per = R.background[Math.min(2, Math.max(0, g.stage - 1))] ?? 0;
    if (age >= R.ageFrom) per *= R.ageMult;
    per *= R.presetLossMult[this.rules().preset] ?? 1;
    per *= allow;
    // 단계 길이가 여러 날이면 하루 확률로 나눔 (단계 전체 확률은 그대로)
    return 1 - Math.pow(1 - Math.min(1, per), 1 / Math.max(1, len));
  }

  private enterStage(p: Person, g: PregnancyState, stage: number): void {
    g.stage = stage;
    const S = this.d.stages[stage - 1];
    if (S.knownOnEnter) g.known = true;
    for (const m of S.enterMoodlets) this.host.moodlet(p, m);
    if (S.craving && this.host.rng.next() < S.craving.chance) {
      this.host.moodlet(p, S.craving.moodlet);
      const w = S.craving.wishes;
      if (w.length) this.host.addWish(p, w[this.host.rng.int(w.length)]);
    }
  }

  /** 아침 입덧 (초기): 리드가 기상 때 부름. 방광/배고픔 급변 + 속 울렁임 */
  onWake(p: Person): boolean {
    const g = stateOf(p);
    if (!g || g.labor) return false;
    const W = this.d.stages[g.stage - 1]?.wake;
    if (!W || this.host.rng.next() >= W.chance) return false;
    for (const [n, v] of Object.entries(W.needs)) p.addNeed(n as NeedId, v);
    this.host.moodlet(p, W.moodlet);
    // 증상으로 알게 됨 (15-1)
    g.known = true;
    return true;
  }

  // ---------------------------------------------------------------- 위험 판정

  /**
   * 위험 요인이 생길 때 (15-1): 굶주림, 병 (M11 훅), 큰 충격, 낙상, 과로. 결과는 합병증 / 조산 / 유산·사산.
   * 사망 설정 출산 칸(loss)이 꺼져 있으면 합병증까지만. 16세 미만 없음, 35세 이상 가중
   */
  riskEvent(p: Person, kind: RiskKind): RiskResult {
    const g = stateOf(p);
    if (!g || g.labor) return { outcome: 'none', capped: false };
    const R = this.d.risk;
    const age = this.age(p);
    if (age < R.noRiskBelowAge) return { outcome: 'none', capped: false };
    const odds = R.events[kind];
    const am = age >= R.ageFrom ? R.ageMult : 1;
    const lossAllow = this.childbirthChance(p, 'loss') * (R.presetLossMult[this.rules().preset] ?? 1);
    const r = this.host.rng.next();
    const pLoss = Math.min(1, odds.loss * am);
    const pPre = Math.min(1, odds.premature * am);
    const pComp = Math.min(1, odds.complication * am);
    let out: RiskOutcome = 'none';
    if (r < pLoss) out = 'loss';
    else if (r < pLoss + pPre) out = 'premature';
    else if (r < pLoss + pPre + pComp) out = 'complication';
    let capped = false;
    if (out === 'loss' || out === 'premature') {
      const allowed = this.childbirthChance(p, 'loss') > 0;
      if (!allowed) {
        out = 'complication';
        capped = true;
      } else if (out === 'loss' && lossAllow < 1 && this.host.rng.next() >= lossAllow) {
        // 보통 프리셋 (유산 배수 < 1): 나머지는 합병증
        out = 'complication';
      }
    }
    // 초기 조산은 없음 → 합병증
    if (out === 'premature' && g.stage < 2) out = 'complication';
    if (out === 'loss') this.lose(p, g);
    else if (out === 'premature') {
      g.premature = true;
      g.complication = true;
      this.host.moodlet(p, R.prematureMoodlet);
      this.startLabor(p);
    } else if (out === 'complication') {
      g.complication = true;
      this.host.moodlet(p, R.complicationMoodlet);
    }
    return { outcome: out, capped };
  }

  /** 유산 (초기/중기) / 사산 (후기): 임신 끝, 부모 모두 기억과 슬픔, 연대기, 트라우마 판정 */
  private lose(p: Person, g: PregnancyState): void {
    const L = this.d.loss;
    p.pregnancy = null;
    this.stat('loss', p);
    const late = g.stage >= 3;
    const father = this.person(g.father);
    const parents = father ? [p, father] : [p];
    for (const q of parents) {
      this.host.moodlet(q, L.moodlet);
      this.host.memory(q, L.memory.kind, L.memory.importance, L.memory.valence);
      if (this.host.rng.next() < L.traumaChance) this.host.trauma(q, 'lost_child');
    }
    this.host.news(late ? L.news.late : L.news.early, { a: p.name }, [p]);
    this.host.chronicle(late ? this.d.chronicle.stillbirth : this.d.chronicle.miscarriage, parents);
  }

  // ---------------------------------------------------------------- 진통

  /** 진통 시작: 장면 중이면 끊고 (6행), 배우자 여정 중이면 귀가 카드 (4행), 조작 가문은 선택 대기, 아니면 바로 자동 선택 */
  startLabor(p: Person): LaborState | null {
    const g = stateOf(p);
    if (!g) return null;
    if (g.labor) return g.labor;
    const Lb = this.d.labor;
    const minute = this.host.minute();
    const father = this.person(g.father);
    const spouseAway = !!father && this.host.isOnJourney(father);
    const labor: LaborState = {
      since: minute,
      day: this.host.day(),
      pending: false,
      deadline: minute + days(Lb.timeout, this.host.lifespan()),
      spouseAway,
      quarantine: this.host.isQuarantined(p),
      interruptedScene: false,
    };
    g.labor = labor;
    g.stage = 3;
    this.host.moodlet(p, Lb.moodlet);
    // 교차 표 6행: 이미 장면 중이면 그 장면을 끊고 출산 장면이 먼저 (27-7)
    if (this.host.isInScene(p)) {
      this.host.interruptScene(p, 'labor');
      labor.interruptedScene = true;
    }
    // 교차 표 4행: 배우자가 여정/전쟁 중이면 조기 귀가 카드
    if (spouseAway && father) this.host.offerCard(father.id, Lb.spouseCard, { mother: p.id, motherName: p.name });
    if (this.host.chooses(p)) {
      labor.pending = true;
      this.host.offerCard(p.id, Lb.card, { name: p.name, quarantine: labor.quarantine ? 1 : 0 });
      this.host.notice(p, 'labor_started', { name: p.name });
      return labor;
    }
    this.chooseLabor(p, this.autoOption(p), true);
    return labor;
  }

  /** 시간 초과/NPC 자동 선택: 예약했거나 돈이 있으면 산파, 식구가 있으면 가족, 아니면 혼자 */
  autoOption(p: Person): LaborOption {
    const g = stateOf(p);
    const mw = this.host.midwife(p);
    if (mw) {
      const fee = this.fee(p, mw);
      if (g?.prep?.includes('midwifeBooked') || this.host.money(p) >= fee) return 'midwife';
    }
    return this.familyHelper(p) ? 'family' : 'alone';
  }

  private fee(p: Person, mw: MidwifeOffer): number {
    const q = stateOf(p)?.labor?.quarantine ?? this.host.isQuarantined(p);
    return Math.round(mw.fee * (q ? this.d.labor.quarantineFeeMult : 1));
  }

  /** 받아 줄 식구: 같은 가구, 곁에 있음 (여정 아님), 나이 조건. 의술이 가장 높은 사람 */
  private familyHelper(p: Person): Person | null {
    let best: Person | null = null;
    let bestSkill = -1;
    for (const q of this.host.persons) {
      if (q === p || q.household !== p.household || q.infant) continue;
      if (this.age(q) < this.d.labor.familyMinAge || this.host.isOnJourney(q)) continue;
      const s = q.skills[this.d.delivery.skill] ?? 0;
      if (s > bestSkill) {
        bestSkill = s;
        best = q;
      }
    }
    return best;
  }

  /** 진통 중 선택 대기 (UI/스냅샷) */
  laborPending(p: Person): LaborState | null {
    const l = stateOf(p)?.labor;
    return l && l.pending ? l : null;
  }

  /**
   * 의도 laborChoice (조작 가문) 또는 자동. 산파가 오지 않으면 가족이 받음 (3행).
   * 격리 중이면 산파 비용 2배 + 감염 판정. 돈이 모자라면 가족
   */
  chooseLabor(p: Person, option: LaborOption, auto = false): DeliveryResult | null {
    const g = stateOf(p);
    if (!g?.labor) return null;
    if (!auto && !g.labor.pending) return null;
    g.labor.pending = false;
    let opt = option;
    let skill = 0;
    if (opt === 'midwife') {
      const mw = this.host.midwife(p);
      if (!mw) {
        this.host.notice(p, 'midwife_not_coming', { name: p.name });
        opt = 'family';
      } else {
        const fee = this.fee(p, mw);
        if (fee > 0 && !this.host.spend(p, fee, 'midwife')) {
          this.host.notice(p, 'midwife_unaffordable', { name: p.name });
          opt = 'family';
        } else {
          skill = mw.skill;
          if (g.labor.quarantine) {
            this.host.infectionRoll(mw.person, p, 'labor');
            if (mw.person) this.host.infectionRoll(p, mw.person, 'labor');
          }
        }
      }
    }
    if (opt === 'family') {
      const helper = this.familyHelper(p);
      if (!helper) opt = 'alone';
      else skill = helper.skills[this.d.delivery.skill] ?? 0;
    }
    if (opt === 'alone') skill = 0;
    return this.deliver(p, opt, skill);
  }

  /** 틱마다 (또는 시간마다): 진통 선택 시간 초과 → 자동 */
  tick(): void {
    const m = this.host.minute();
    for (const p of [...this.host.persons]) {
      const l = stateOf(p)?.labor;
      if (l?.pending && m >= l.deadline) this.chooseLabor(p, this.autoOption(p), true);
    }
  }

  // ---------------------------------------------------------------- 출산 결과

  /** 이 받는 사람/조건으로 위험·난산 확률 (15-2) */
  deliveryOdds(p: Person, option: LaborOption, skill: number, twins: boolean): { danger: number; difficult: number } {
    const D = this.d.delivery;
    const g = stateOf(p);
    let m = Math.max(D.skillFloor, 1 - skill * D.skillPerLevel);
    for (const k of g?.prep ?? []) m *= D.prepMult[k] ?? 1;
    if (p.weakened) m *= D.mult.weakened;
    if (p.need('hunger') < this.d.risk.hungerBelow) m *= D.mult.hungry;
    if (g?.complication) m *= D.mult.complication;
    if (g?.premature) m *= D.mult.premature;
    if (this.age(p) >= this.d.risk.ageFrom) m *= D.mult.age;
    if (twins) m *= D.mult.twins;
    const health = this.traitProduct(p, D.healthTraitKey);
    if (health > 0) m /= health;
    return { danger: Math.min(0.9, D.danger[option] * m), difficult: Math.min(0.9, D.difficult[option] * m) };
  }

  private deliver(p: Person, option: LaborOption, skill: number): DeliveryResult {
    const g = stateOf(p)!;
    const labor = g.labor!;
    const D = this.d.delivery;
    const day = this.host.day();
    const father = this.person(g.father);
    const rng = this.host.rng;
    const twins = rng.next() < this.d.twins.base + this.traitSum(p, this.d.twins.traitKey);
    const odds = this.deliveryOdds(p, option, skill, twins);
    const r = rng.next();
    let outcome: BirthOutcome = r < odds.danger ? 'dangerous' : r < odds.danger + odds.difficult ? 'difficult' : 'easy';
    let fallback = false;
    let motherDies = false;
    if (outcome === 'dangerous') {
      const mc = this.childbirthChance(p, 'maternal');
      if (mc > 0) motherDies = rng.next() < D.maternalDeath * mc;
      else {
        // 20-7: 출산 칸이 꺼진 사람 → 난산 + 합병증 무드렛 + 회복 기간 2배
        fallback = true;
        outcome = 'difficult';
      }
    }
    p.pregnancy = null;
    this.lastBirth.set(p.id, day);
    const chronicle: string[] = [];
    const babies: Person[] = [];
    const babyDeaths: Person[] = [];
    const n = twins ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const baby = this.host.birth(p, father);
      if (!baby) continue;
      babies.push(baby);
      this.stat('birth', p);
      if (g.premature && rng.next() < this.d.risk.prematureFrailChance && !baby.traits.includes(this.d.risk.prematureFrailTrait)) baby.traits.push(this.d.risk.prematureFrailTrait);
    }
    const parents = father ? [p, father] : [p];
    this.host.news(babies.length > 1 ? 'twins' : 'birth', { a: babies.length > 1 && father ? father.name : p.name, b: babies[0]?.name ?? '' }, [p]);
    if (babies.length) {
      chronicle.push(this.d.chronicle.birth);
      this.host.chronicle(this.d.chronicle.birth, [...parents, ...babies]);
    }
    // 아기 사망 (위험 결과, 사망 설정 출산 칸 infant)
    for (const b of babies) {
      if (outcome !== 'dangerous') break;
      const ic = this.childbirthChance(b, 'infant');
      if (ic > 0 && rng.next() < D.infantDeath * ic) babyDeaths.push(b);
    }
    // 부모 무드렛/기억
    if (babies.length > babyDeaths.length) {
      this.host.moodlet(p, D.moodlets.mother);
      if (father) this.host.moodlet(father, D.moodlets.father);
      for (const q of parents) this.host.memory(q, D.memory.kind, D.memory.importance, D.memory.valence);
      if (outcome === 'easy') for (const q of parents) this.host.moodlet(q, D.moodlets.healthy);
      if (babies.length > 1) for (const q of parents) this.host.moodlet(q, D.moodlets.twins);
      for (const gpId of new Set([p.mother, p.father, father?.mother ?? 0, father?.father ?? 0])) {
        const gp = this.person(gpId);
        if (gp) this.host.moodlet(gp, D.moodlets.grandparent);
      }
    }
    for (const b of babies) this.host.baptismDue(b);
    for (const b of babyDeaths) {
      for (const q of parents) {
        this.host.moodlet(q, this.d.loss.moodlet);
        this.host.memory(q, this.d.loss.memory.kind, this.d.loss.memory.importance, this.d.loss.memory.valence);
      }
      this.host.news('newborn_died', { a: p.name, b: b.name }, [p]);
      chronicle.push(this.d.chronicle.infantDeath);
      this.host.chronicle(this.d.chronicle.infantDeath, [...parents, b]);
      this.stat('infant_death', b);
      this.host.kill(b, 'childbirth');
    }
    // 난산 회복 (교차 표 7행): 2일 lifespan, 대체 결과면 2배. 에너지 제한
    if (outcome === 'difficult' || (outcome === 'dangerous' && !motherDies)) {
      const f = fallback ? (this.rules().fallback('childbirth', this.rules().group(p.lifeStage, this.age(p)))?.recoveryMult ?? 2) : 1;
      this.recovery.set(p.id, { until: day + days(D.recovery, this.host.lifespan()) * f, cap: D.recoveryEnergyCap });
      this.host.moodlet(p, D.moodlets.difficult);
      if (fallback) this.host.moodlet(p, this.d.risk.complicationMoodlet);
    }
    // 교차 표 5행: 출생과 쌍둥이는 항상 허용. 상한 초과면 비좁음 + 분가/해고 알림
    let overCap = false;
    const living = babies.filter((b) => !babyDeaths.includes(b));
    if (living.length && this.host.householdSize(p.household) > this.host.householdCap(p.household)) {
      overCap = true;
      for (const q of this.host.persons) if (q.household === p.household && !q.infant) this.host.moodlet(q, D.moodlets.cramped);
      this.host.notice(p, 'household_over_cap', { name: p.name, n: this.host.householdSize(p.household), cap: this.host.householdCap(p.household) });
    }
    // 교차 표 4행: 배우자가 아직 여정 중이면 "출산 소식" 편지
    let letterSent = false;
    if (labor.spouseAway && father && this.host.isOnJourney(father)) {
      this.host.letter(father, this.d.labor.letter, { mother: p.name, baby: living[0]?.name ?? babies[0]?.name ?? '', n: living.length });
      letterSent = true;
    }
    // 산모 사망 (아기가 먼저 나온 뒤)
    if (motherDies) {
      this.stat('maternal_death', p);
      if (father) this.host.moodlet(father, D.moodlets.widower);
      this.host.news('death_childbirth', { a: p.name, b: father?.name ?? p.name }, [p]);
      chronicle.push(this.d.chronicle.motherDeath);
      this.host.chronicle(this.d.chronicle.motherDeath, parents);
      this.host.kill(p, 'childbirth');
    }
    return { outcome, attendant: option, babies, babyDeaths, motherDied: motherDies, twins: babies.length > 1, fallback, chronicle, letterSent, overCap };
  }

  // ---------------------------------------------------------------- 교차 표 1행

  /**
   * 산모가 임신 중 (다른 원인으로) 죽기 직전에 리드가 부름 (kill 전에). 후기면 기적의 출산
   * (치유사/산파 곁 50%, 없으면 20%), 실패하면 함께 사망. 초기/중기는 태아도 사망. 출산 칸이 꺼져 있으면 항상 기적의 출산
   */
  onMotherDeath(p: Person, cause: string): MotherDeathResult | null {
    const g = stateOf(p);
    if (!g) return null;
    void cause;
    const rules = this.rules();
    const off = !rules.allows('childbirth', rules.group(p.lifeStage, this.age(p)));
    const father = this.person(g.father);
    const parents = father ? [p, father] : [p];
    let miracle = false;
    if (off) miracle = true;
    else if (g.stage >= 3) {
      const ch = this.host.healerPresent(p) ? this.d.motherDeath.miracleWithHealer : this.d.motherDeath.miracleAlone;
      miracle = this.host.rng.next() < ch;
    }
    p.pregnancy = null;
    if (miracle) {
      const babies: Person[] = [];
      const baby = this.host.birth(p, father);
      if (baby) {
        babies.push(baby);
        this.stat('miracle', p);
        this.host.baptismDue(baby);
        if (g.stage < 3 && !baby.traits.includes(this.d.risk.prematureFrailTrait)) baby.traits.push(this.d.risk.prematureFrailTrait);
        this.host.news('miracle_birth', { a: p.name, b: baby.name }, [p]);
        this.host.chronicle(this.d.chronicle.miracle, [...parents, baby]);
      }
      return { kind: 'miracle', babies };
    }
    this.stat('loss', p);
    if (father) {
      this.host.moodlet(father, this.d.loss.moodlet);
      this.host.memory(father, this.d.loss.memory.kind, this.d.loss.memory.importance, this.d.loss.memory.valence);
    }
    return { kind: 'fetus_died', babies: [] };
  }

  // ---------------------------------------------------------------- 상호작용

  /** 상호작용이 보일 조건 (pregnancy.json gates). 모르는 상호작용은 true */
  interactionAllowed(actor: Person, iaId: string, target?: Person | null): boolean {
    const gate = this.d.gates[iaId];
    if (!gate || typeof gate === 'string') return true;
    const pregnant: Person | null =
      gate.who === 'self' ? actor : gate.who === 'target' ? target ?? null : this.host.persons.find((q) => q.household === actor.household && q.pregnancy) ?? null;
    const g = pregnant ? stateOf(pregnant) : null;
    if (!g || g.labor) return false;
    if (!gate.stages.includes(g.stage)) return false;
    if (gate.known !== undefined && !!g.known !== gate.known) return false;
    if (gate.announced !== undefined && !!g.announced !== gate.announced) return false;
    if (gate.targetRoles && (!target || !target.role || !gate.targetRoles.includes(target.role))) return false;
    return true;
  }

  /** 상호작용을 끝냈을 때 리드가 부름: 준비물/상태 표시 (산파 찾아가기 → 알게 됨, 산파 예약, 출산 준비 …) */
  onInteractionDone(actor: Person, iaId: string, target?: Person | null): void {
    const marks = this.d.prep[iaId];
    if (!marks) return;
    const gate = this.d.gates[iaId];
    const who = gate && typeof gate !== 'string' ? gate.who : 'self';
    const pregnant = who === 'self' ? actor : who === 'target' ? target ?? null : this.host.persons.find((q) => q.household === actor.household && q.pregnancy) ?? null;
    const g = pregnant ? stateOf(pregnant) : null;
    if (!g) return;
    for (const k of Array.isArray(marks) ? marks : [marks]) {
      if (k === 'known') g.known = true;
      else if (k === 'announced') g.announced = true;
      else {
        g.prep ??= [];
        if (!g.prep.includes(k)) g.prep.push(k);
      }
    }
  }

  // ---------------------------------------------------------------- 단계 효과 질의 (리드가 적용)

  /** 배 레이어 0/1/2 (스냅샷 bellyStage, appearance.pregnant) */
  bellyStage(p: Person): 0 | 1 | 2 {
    const g = stateOf(p);
    if (!g) return 0;
    if (g.labor) return 2;
    return (this.d.stages[g.stage - 1]?.belly ?? 0) as 0 | 1 | 2;
  }

  /** 욕구 감소 배수 (중기 에너지 1.2, 후기 편안 2) */
  needDecayMult(p: Person, need: NeedId): number {
    const g = stateOf(p);
    if (!g) return 1;
    return this.d.stages[g.stage - 1]?.needDecay[need] ?? 1;
  }

  /** 이동 속도 배수 (후기 0.7) */
  moveMult(p: Person): number {
    const g = stateOf(p);
    if (!g) return 1;
    return this.d.stages[g.stage - 1]?.moveMult ?? 1;
  }

  /** 노동(직업, 부역, 노동 태그 상호작용) 가능 (후기/진통 불가). 후기에 억지로 일하면 riskEvent(p, 'overwork') */
  canWork(p: Person): boolean {
    const g = stateOf(p);
    if (!g) return true;
    if (g.labor) return false;
    return this.d.stages[g.stage - 1]?.canWork ?? true;
  }

  /** 난산 회복 중 에너지 상한 (없으면 100) */
  energyCap(p: Person): number {
    return this.recovery.get(p.id)?.cap ?? 100;
  }

  recovering(p: Person): boolean {
    return this.recovery.has(p.id);
  }

  /** 저장/복원 (회복 표) */
  save(): { recovery: [number, { until: number; cap: number }][]; lastBirth: [number, number][] } {
    return { recovery: [...this.recovery], lastBirth: [...this.ownLastBirth] };
  }

  load(s: { recovery: [number, { until: number; cap: number }][]; lastBirth: [number, number][] }): void {
    this.recovery.clear();
    for (const [k, v] of s.recovery) this.recovery.set(k, v);
    this.ownLastBirth = new Map(s.lastBirth);
  }
}

// ------------------------------------------------------------------ 판정기 연결

/** 판정기(lifeJudge)의 창구 중 이 모듈이 쓰는 것 */
export interface JudgeHostLike {
  readonly persons: Person[];
  readonly rng: Rng;
  day(): number;
  news(kind: string, args: Record<string, string | number>, subjects: Person[]): void;
  moodlet(p: Person, id: string): void;
  kill(p: Person, cause: string): void;
  birth(mother: Person, father: Person | null): Person | null;
  /** 리드가 sim.ts 에서 넣는 완전한 시스템 (pregnancy.json + 전체 창구). 없으면 story.json 수치로 만든 기본 시스템 */
  pregnancy?: PregnancySystem | null;
}

/**
 * story.json "pregnancy" 수치를 새 데이터 모양으로 (pregnancy.json 이 없을 때 = 예전 판정과 같은 결과):
 * 단계당 유산 lossChance/3, 산모 사망 maternalDeath, 쌍둥이 twins, 난산/아기 사망/위험 사건 없음
 */
export function pregnancyFromStory(P: StoryData['pregnancy']): PregnancyData {
  const zero = { complication: 0, premature: 0, loss: 0 };
  const stage = (belly: number, extra: Record<string, unknown> = {}) => ({ belly, needDecay: {}, moveMult: 1, canWork: true, enterMoodlets: [], knownOnEnter: belly > 0, ...extra });
  return {
    conception: {
      perCoitus: P.perCoitus,
      coitusPerDay: P.coitusPerDay,
      actualCountWantsMult: {},
      fertileAge: P.fertileAge,
      declineFromAge: P.declineFromAge,
      declineYears: P.declineYears,
      declineFloor: P.declineFloor,
      birthCooldown: { value: P.birthCooldownDays, scale: 'absolute' },
      seasonMult: {},
      healthTraitKey: 'health',
      healthMultRange: [1, 1],
      weakenedMult: 1,
      wishes: [],
      wishMult: 1,
    },
    stage: { value: P.stageDays, scale: 'absolute' },
    stages: [stage(0), stage(1), stage(2)],
    twins: { base: P.twins, traitKey: 'twinsBonus' },
    risk: {
      background: [P.lossChance / 3, P.lossChance / 3, P.lossChance / 3],
      ageFrom: 1e9,
      ageMult: 1,
      noRiskBelowAge: 0,
      presetLossMult: {},
      events: { hunger: zero, illness: zero, shock: zero, fall: zero, overwork: zero },
      hungerBelow: -1,
      complicationMoodlet: 'uneasy_kicks',
      prematureMoodlet: 'premature_worry',
      prematureFrailChance: 0,
      prematureFrailTrait: 'frail',
    },
    loss: { moodlet: 'lost_child_grief', memory: { kind: 'lost_child', importance: 5, valence: -1 }, traumaChance: 0, news: { early: 'miscarriage', late: 'stillbirth' } },
    labor: { timeout: { value: 0, scale: 'absolute' }, moodlet: 'labor_pains', card: 'labor_starts', cardOptions: ['midwife', 'family', 'alone'], spouseCard: 'labor_call_spouse_home', letter: 'birth_news', quarantineFeeMult: 1, familyMinAge: 0 },
    delivery: {
      danger: { midwife: P.maternalDeath, family: P.maternalDeath, alone: P.maternalDeath },
      difficult: { midwife: 0, family: 0, alone: 0 },
      skill: 'medicine',
      skillPerLevel: 0,
      skillFloor: 1,
      prepMult: {},
      mult: { weakened: 1, hungry: 1, complication: 1, premature: 1, age: 1, twins: 1 },
      healthTraitKey: 'health',
      maternalDeath: 1,
      infantDeath: 0,
      recovery: { value: 0, scale: 'absolute' },
      recoveryEnergyCap: 100,
      memory: { kind: 'birth', importance: 5, valence: 1 },
      moodlets: { mother: 'newborn_joy', father: 'newborn_joy', difficult: 'difficult_birth_recovery', twins: 'twins_overwhelmed', grandparent: 'grandchild_born', widower: 'lost_in_childbirth', healthy: 'baby_healthy_relief', cramped: 'cramped_house' },
    },
    motherDeath: { miracleWithHealer: 0.5, miracleAlone: 0.2 },
    corvee: { lordFavorDelta: 0 },
    chronicle: { birth: 'birth', miscarriage: 'miscarriage', stillbirth: 'stillbirth', infantDeath: 'child_death', motherDeath: 'death_childbirth', miracle: 'miracle_birth' },
    prep: {},
    cradleObject: 'baby_basket',
    midwifeRoles: [],
    gates: {},
    interactions: {},
    social: {},
  } as PregnancyData;
}

/** JudgeHost 만 있을 때의 창구: 판정기 창구는 그대로, 나머지는 "없음" (카드/편지/장면/격리/산파 없음, 사망 설정 전부 켬) */
export function hostFromJudge(j: JudgeHostLike, age: (p: Person) => number): PregnancyHost {
  const rules = allOnRules();
  return {
    get persons() {
      return j.persons;
    },
    rng: j.rng,
    day: () => j.day(),
    minute: () => j.day() * 1440,
    lifespan: () => 1,
    age,
    season: () => '',
    traitEffects: () => undefined,
    controlled: (p) => p.household === 1,
    chooses: () => false,
    coitusToday: () => null,
    hasWish: () => false,
    addWish: () => {},
    moodlet: (p, id) => j.moodlet(p, id),
    memory: () => {},
    news: (k, a, s) => j.news(k, a, s),
    notice: () => {},
    chronicle: () => {},
    trauma: () => {},
    kill: (p, c) => j.kill(p, c),
    birth: (m, f) => j.birth(m, f),
    baptismDue: () => {},
    householdSize: (hh) => j.persons.filter((q) => q.household === hh).length,
    householdCap: () => Infinity,
    money: () => 0,
    spend: () => false,
    isOnJourney: () => false,
    isInScene: () => false,
    interruptScene: () => {},
    offerCard: () => false,
    letter: () => {},
    deathRules: () => rules,
    isCorveeDay: () => false,
    corveeExempt: () => {},
    isQuarantined: () => false,
    infectionRoll: () => {},
    midwife: () => null,
    healerPresent: () => false,
    record: () => {},
  };
}

const judgeSystems = new WeakMap<object, PregnancySystem>();

/**
 * 판정기에서 부르는 입구: host.pregnancy (리드가 넣은 시스템) 가 있으면 그것, 없으면 story.json 수치로 만든 기본 시스템 (창구마다 하나).
 * 판정기 통계(stats, lastBirth, stageDeaths)를 매번 묶음
 */
export function judgePregnancy(j: JudgeHostLike, story: StoryData, bind: JudgeBinding): PregnancySystem {
  let sys = j.pregnancy ?? judgeSystems.get(j);
  if (!sys) {
    sys = new PregnancySystem(hostFromJudge(j, bind.age), pregnancyFromStory(story.pregnancy));
    judgeSystems.set(j, sys);
  }
  sys.judge = bind;
  return sys;
}
