/**
 * 내면 데이터 (M2): 감정, 무드렛, 특성, 덕/죄, 호불호, 속마음, 소원/걱정, 인생 목표, 보상 특성.
 * 불러올 때 zod 로 검사하고 런타임 구조로 컴파일 (틱 안에서 문자열 파싱 없음).
 * 형식: artifacts/contracts-m2.md
 */
import { z } from 'zod';
import type { NeedId } from '../core/types';
import { NEED_IDS } from '../core/types';
import { EMOTION_IDS, EMOTION_INDEX, type EmotionConfig, type EmotionId } from '../inner/emotion';

const duration = z.object({ value: z.number(), scale: z.enum(['absolute', 'season', 'lifespan', 'per_life']) });
const emotionId = z.enum(EMOTION_IDS);

export const emotionsSchema = z.object({
  stages: z.object({ basic: z.number(), strong: z.number(), extreme: z.number() }),
  needSourceCap: z.number(),
  suppress: z.object({ negativeStrength: z.number(), positiveFactor: z.number(), positiveMaxStage: z.enum(['basic', 'strong', 'extreme']) }),
  /** 극단 감정 위험 (11-3): 부정 감정 극단이 hours 넘게 이어지면 판정. enabled 는 새 게임 설정 기본값 */
  extremeRisk: z.object({
    hours: duration,
    enabled: z.boolean().default(true),
    emotions: z.array(emotionId).default(['sad', 'angry', 'tense', 'ashamed']),
    stress: z.number().default(0),
  }).loose(),
  /** 행복 포인트 (12-5): 이 감정 상태가 이어지는 동안 시간당 포인트 (단계 0~3 순서) */
  happinessPoints: z.object({ emotions: z.array(emotionId), perHourByStage: z.array(z.number()).length(4) }).loose().optional(),
  recomputeMinutes: z.number().int().positive(),
  emotions: z.record(emotionId, z.object({ positive: z.boolean(), nameKeys: z.array(z.string()).length(3), icon: z.string(), color: z.string(), walkMult: z.number(), idleAnim: z.string() }).loose()),
}).loose();

export const moodletSchema = z.object({
  nameKey: z.string(),
  descKey: z.string(),
  icon: z.string().optional(),
  emotion: emotionId,
  strength: z.number().int().min(1).max(3),
  duration: duration.optional(),
  while: z.string().optional(),
  permanent: z.boolean().optional(),
  stack: z.enum(['replace', 'refresh', 'stack']).default('refresh'),
  max: z.number().int().optional(),
  source: z.string(),
  group: z.string().optional(),
  fade: z.array(z.tuple([z.number(), z.number()])).optional(),
  tags: z.array(z.string()).optional(),
  /** 두 번째 감정 (굶주림 = 슬픔 2 + 긴장 1, 11-1) */
  extra: z.array(z.object({ emotion: emotionId, strength: z.number().int().min(1).max(3) })).optional(),
}).loose();
export const moodletsSchema = z.object({ moodlets: z.record(z.string(), moodletSchema) }).loose();

const traitEffects = z.object({
  needDecay: z.record(z.string(), z.number()).optional(),
  adTag: z.record(z.string(), z.number()).optional(),
  moodletDuration: z.record(z.string(), z.number()).optional(),
  moodletStrength: z.record(z.string(), z.number()).optional(),
  moodletOnTag: z.array(z.object({ tag: z.string(), moodlet: z.string() })).optional(),
  moodletOnWhile: z.array(z.object({ while: z.string(), moodlet: z.string() })).optional(),
  stressOnTag: z.array(z.object({ tag: z.string(), delta: z.number() })).optional(),
  idleMoodlet: z.object({ moodlet: z.string(), chancePerHour: z.number() }).optional(),
  dailyTagMoodlet: z.object({ tag: z.string(), moodlet: z.string() }).optional(),
}).loose();
export type TraitEffectsDef = z.infer<typeof traitEffects>;

export const traitsSchema = z.object({
  slots: z.record(z.string(), z.number()),
  conflicts: z.array(z.tuple([z.string(), z.string()])),
  crossConflicts: z.array(z.tuple([z.string(), z.string()])).optional(),
  traits: z.record(z.string(), z.object({
    category: z.string(),
    nameKey: z.string(),
    descKey: z.string(),
    icon: z.string(),
    effects: traitEffects,
    metric: z.object({
      kind: z.enum(['tagMinutes', 'emotionMinutes', 'moodletMinutes', 'outdoorNight']),
      tags: z.array(z.string()).optional(),
      emotions: z.array(emotionId).optional(),
      direction: z.enum(['up', 'down']),
      minMult: z.number(),
      versus: z.object({ trait: z.string(), minMult: z.number() }).optional(),
    }).optional(),
  }).loose()),
}).loose();

export const virtuesSchema = z.object({
  noneChance: z.number(),
  reliefStressAt: z.number(),
  reliefAdMult: z.number(),
  virtues: z.record(z.string(), z.object({ nameKey: z.string(), descKey: z.string(), sin: z.string(), keep: z.array(z.string()), break: z.array(z.string()), keepKarma: z.number(), keepStress: z.number(), breakStress: z.number() })),
  sins: z.record(z.string(), z.object({ nameKey: z.string(), descKey: z.string(), virtue: z.string(), follow: z.array(z.string()), followKarma: z.number(), followStress: z.number() })),
}).loose();

export const thoughtsSchema = z.object({
  speech: z.record(z.string(), z.object({ descKey: z.string() }).loose()),
  thoughts: z.array(z.object({
    id: z.string(),
    trigger: z.string(),
    estates: z.array(z.string()).optional(),
    traits: z.array(z.string()).optional(),
    emotions: z.array(z.string()).optional(),
    stages: z.array(z.string()).optional(),
    weight: z.number().optional(),
    textKey: z.string(),
  }).loose()),
}).loose();

const cond = z.object({
  traitsAny: z.array(z.string()).optional(),
  estates: z.array(z.string()).optional(),
  stages: z.array(z.string()).optional(),
  emotionsAny: z.array(z.string()).optional(),
  minHour: z.number().optional(),
  maxHour: z.number().optional(),
}).loose();

export const wishesSchema = z.object({
  wishes: z.array(z.object({
    id: z.string(),
    kind: z.enum(['wish', 'fear']),
    textKey: z.string(),
    icon: z.string().optional(),
    weight: z.number().optional(),
    when: cond.optional(),
    fulfill: z.object({ event: z.string() }).optional(),
    realize: z.object({ event: z.string() }).optional(),
    resolve: z.object({ event: z.string() }).optional(),
    moodlet: z.string().optional(),
    points: z.number().optional(),
    expire: duration.optional(),
  }).loose()),
}).loose();

/** 단계 조건: 카운터 ≥ 값 (값은 수 또는 기간 {value, scale}) / any: 그중 하나 */
export type NeedCond = { counter: string; gte: number | { value: number; scale: string } } | { any: NeedCond[] };
const needCond: z.ZodType<NeedCond> = z.lazy(() =>
  z.union([
    z.object({ counter: z.string(), gte: z.union([z.number(), duration]) }).loose(),
    z.object({ any: z.array(needCond) }).loose(),
  ]),
) as z.ZodType<NeedCond>;
const aspirationDef = z.object({
  id: z.string().optional(),
  nameKey: z.string(),
  group: z.string().optional(),
  stages: z.array(z.object({ textKey: z.string().optional(), need: z.array(needCond) }).loose()),
  rewardTrait: z.string().optional(),
}).loose();
/** 객체(id → 정의) 또는 배열([{id, …}]) 둘 다 받아 객체로 맞춤 */
export const aspirationsSchema = z.object({
  aspirations: z.union([
    z.record(z.string(), aspirationDef),
    z.array(aspirationDef).transform((arr) => Object.fromEntries(arr.map((a) => [a.id ?? a.nameKey, a]))),
  ]),
}).loose();

export const likesSchema = z.object({}).loose();

const likesEffects = z.object({
  likedMoodlet: z.string().default('liked_activity'),
  dislikedMoodlet: z.string().default('disliked_activity'),
  funRecoveryMult: z.number().default(1.5),
  /** 좋아하는/싫어하는 계절에 바깥에 나가면 (하루 한 번). 없는 무드렛이면 liked/disliked 로 대신 */
  seasonLikedMoodlet: z.string().optional(),
  seasonDislikedMoodlet: z.string().optional(),
}).loose();
const likesFileSchema = z.object({
  perPerson: z.object({ likes: z.object({ min: z.number(), max: z.number() }), dislikes: z.object({ min: z.number(), max: z.number() }) }).optional(),
  effects: likesEffects.optional(),
  /** 뽑기 가중치: active = 지금 걸리는 항목, future = 나중 시스템(M3 이후 사건)에서만 걸리는 항목. 염료(dyes)만 있는 항목은 0 (옷 색 M8) */
  pickWeights: z.object({ active: z.number(), future: z.number() }).optional(),
  categories: z.record(z.string(), z.object({
    items: z.record(z.string(), z.object({
      tags: z.array(z.string()).optional(),
      interactions: z.array(z.string()).optional(),
      events: z.array(z.string()).optional(),
      seasons: z.array(z.string()).optional(),
      dyes: z.array(z.string()).optional(),
      objects: z.array(z.string()).optional(),
    }).loose()).optional(),
  }).loose()).optional(),
}).loose();

// ---------------------------------------------------------------- 엔진이 코드로 붙이는 것 (도달 가능성 계산용)

/** 엔진(inner.ts / sim.ts)이 데이터 참조 없이 id 로 붙이는 무드렛 (데이터에 없으면 건너뜀) */
export const ENGINE_MOODLETS: readonly string[] = [
  // inner.ts
  'cozy_hearth', 'stress_heavy', 'stress_limit', 'wish_fulfilled', 'fear_realized', 'bored_repeat', 'liked_activity', 'disliked_activity',
  'fond_memory', 'painful_memory',
  // sim.ts (리드: 수면/식사/방광 실수/연기/식탁 대화)
  'slept_on_floor', 'slept_badly', 'embarrassed', 'ate_alone', 'smoky_room', 'table_talk',
];
/** 엔진이 이름으로 부르는 사건 (inner.event(p, 이름) → event:<이름>) */
export const ENGINE_EVENTS: readonly string[] = ['rude_to_superior', 'arrogance', 'extreme_risk'];
/** whileHolds 가 아직 늘 거짓인 조건 (날씨 M5, 외로움 지속 M3 이후) — 이 조건으로만 붙는 무드렛은 도달 불가 */
export const WHILE_UNSUPPORTED: ReadonlySet<string> = new Set(['room_smoky', 'raining', 'alone_long']);
/** 엔진이 inner.count 로 세는 카운터 접두어 (event() 는 이 밖의 사건을 셈) */
export const COUNTED_ELSEWHERE: ReadonlySet<string> = new Set(['done', 'tag', 'social', 'social_recv', 'moodlet']);

// ---------------------------------------------------------------- 컴파일

export interface MoodletDef {
  id: string;
  emotion: number;
  strength: number;
  durationMin: number;
  whileCond: string | null;
  permanent: boolean;
  stack: 'replace' | 'refresh' | 'stack';
  max: number;
  needSource: boolean;
  source: string;
  group: string | null;
  fade: Array<[number, number]>;
  nameKey: string;
  descKey: string;
  icon: string | null;
  extra: Array<{ emotion: number; strength: number }>;
}

export interface TraitFx {
  needDecay: Float64Array;
  adTag: Map<string, number>;
  durationByEmotion: Float64Array;
  strengthByEmotion: Float64Array;
  moodletOnTag: Array<{ tag: string; moodlet: string }>;
  moodletOnWhile: Array<{ while: string; moodlet: string }>;
  stressOnTag: Map<string, number>;
  idleMoodlets: Array<{ moodlet: string; chancePerHour: number }>;
  dailyTagMoodlets: Array<{ tag: string; moodlet: string }>;
}

export type Thought = z.infer<typeof thoughtsSchema>['thoughts'][number];
export type WishDef = z.infer<typeof wishesSchema>['wishes'][number];

export interface InnerData {
  emotionCfg: EmotionConfig;
  emotions: z.infer<typeof emotionsSchema>;
  recomputeMinutes: number;
  moodlets: Map<string, MoodletDef>;
  traits: z.infer<typeof traitsSchema>;
  virtues: z.infer<typeof virtuesSchema>;
  /** 트리거 → 문장들 */
  thoughts: Map<string, Thought[]>;
  thoughtCount: number;
  wishes: WishDef[];
  aspirations: z.infer<typeof aspirationsSchema>['aspirations'];
  rewards: Record<string, { cost: number; effects?: TraitEffectsDef } & Record<string, unknown>>;
  likes: Record<string, unknown>;
  /** 호불호 항목 → 연결 태그/상호작용 id */
  likeLinks: Map<string, string[]>;
  /** 호불호 역색인 (틱 안에서 문자열 조립 없이 찾음): 상호작용 id / 태그 / 사건(event:x 등) / 계절 → 항목들 */
  likeIndex: {
    byInteraction: Map<string, string[]>;
    byTag: Map<string, string[]>;
    byEvent: Map<string, string[]>;
    bySeason: Map<string, string[]>;
    /** 항목 → 연결 종류 (도달 가능성 판정용) */
    items: Map<string, { tags: string[]; interactions: string[]; events: string[]; seasons: string[]; dyes: string[] }>;
  };
  likeEffects: z.infer<typeof likesEffects>;
  likePickWeights: { active: number; future: number };
  likePerPerson: { likes: { min: number; max: number }; dislikes: { min: number; max: number } };
  /** 동반 무드렛 id(원래id~감정) → 원래 정의와 두 번째 감정 */
  companions: Map<string, { parent: MoodletDef; emotion: number; strength: number }>;
  /** 극단 감정 위험 (11-3) */
  extremeRisk: { enabled: boolean; minutes: number; emotions: Uint8Array; stress: number };
  /** 행복 포인트 (12-5): 감정별 여부, 단계별 시간당 */
  happinessPoints: { emotions: Uint8Array; perHourByStage: number[] };
  /** 조회에 쓰는 누락 무드렛 id (검사용) */
  missingMoodlets: Set<string>;
}

export interface InnerRaw {
  emotions: unknown;
  traits: unknown;
  virtues: unknown;
  moodlets?: unknown;
  thoughts?: unknown;
  wishes?: unknown;
  aspirations?: unknown;
  rewards?: unknown;
  likes?: unknown;
}

const NEED_IDX: Record<NeedId, number> = { hunger: 0, energy: 1, hygiene: 2, bladder: 3, fun: 4, social: 5, warmth: 6, comfort: 7 };

export function compileTraitFx(effectsList: TraitEffectsDef[]): TraitFx {
  const fx: TraitFx = {
    needDecay: new Float64Array(8).fill(1),
    adTag: new Map(),
    durationByEmotion: new Float64Array(11).fill(1),
    strengthByEmotion: new Float64Array(11),
    moodletOnTag: [],
    moodletOnWhile: [],
    stressOnTag: new Map(),
    idleMoodlets: [],
    dailyTagMoodlets: [],
  };
  for (const e of effectsList) {
    for (const [k, v] of Object.entries(e.needDecay ?? {})) if (k in NEED_IDX) fx.needDecay[NEED_IDX[k as NeedId]] *= v;
    for (const [k, v] of Object.entries(e.adTag ?? {})) fx.adTag.set(k, (fx.adTag.get(k) ?? 1) * v);
    for (const [k, v] of Object.entries(e.moodletDuration ?? {})) if (k in EMOTION_INDEX) fx.durationByEmotion[EMOTION_INDEX[k as EmotionId]] *= v;
    for (const [k, v] of Object.entries(e.moodletStrength ?? {})) if (k in EMOTION_INDEX) fx.strengthByEmotion[EMOTION_INDEX[k as EmotionId]] += v;
    fx.moodletOnTag.push(...(e.moodletOnTag ?? []));
    fx.moodletOnWhile.push(...(e.moodletOnWhile ?? []));
    for (const s of e.stressOnTag ?? []) fx.stressOnTag.set(s.tag, (fx.stressOnTag.get(s.tag) ?? 0) + s.delta);
    if (e.idleMoodlet) fx.idleMoodlets.push(e.idleMoodlet);
    if (e.dailyTagMoodlet) fx.dailyTagMoodlets.push(e.dailyTagMoodlet);
  }
  return fx;
}

export function compileInner(raw: InnerRaw): InnerData {
  const emotions = emotionsSchema.parse(raw.emotions);
  const traits = traitsSchema.parse(raw.traits);
  const virtues = virtuesSchema.parse(raw.virtues);
  const mraw = raw.moodlets ? moodletsSchema.parse(raw.moodlets).moodlets : {};
  const moodlets = new Map<string, MoodletDef>();
  for (const [id, m] of Object.entries(mraw)) {
    moodlets.set(id, {
      id,
      emotion: EMOTION_INDEX[m.emotion],
      strength: m.strength,
      durationMin: m.duration ? m.duration.value : 0,
      whileCond: m.while ?? null,
      permanent: !!m.permanent,
      stack: m.stack,
      max: m.max ?? 3,
      needSource: m.source === 'need',
      source: m.source,
      group: m.group ?? null,
      fade: (m.fade ?? []) as Array<[number, number]>,
      nameKey: m.nameKey,
      descKey: m.descKey,
      icon: m.icon ?? null,
      extra: (m.extra ?? []).map((e) => ({ emotion: EMOTION_INDEX[e.emotion], strength: e.strength })),
    });
  }
  // 욕구 무드렛은 욕구 값에 묶어서 엔진이 붙이고 뗌 (파일의 지속시간은 무시)
  for (const [id, def] of moodlets) {
    const m = /^need_(\w+)_(low|crit|high)$/.exec(id);
    if (!m) continue;
    def.whileCond = `need_${m[2]}:${m[1]}`;
    def.needSource = true;
    def.group = `need_${m[1]}`;
    def.durationMin = 0;
  }
  const thoughts = new Map<string, Thought[]>();
  let thoughtCount = 0;
  if (raw.thoughts) {
    for (const t of thoughtsSchema.parse(raw.thoughts).thoughts) {
      if (!thoughts.has(t.trigger)) thoughts.set(t.trigger, []);
      thoughts.get(t.trigger)!.push(t);
      thoughtCount++;
    }
  }
  const wishes = raw.wishes ? wishesSchema.parse(raw.wishes).wishes : [];
  const aspirations = raw.aspirations ? aspirationsSchema.parse(raw.aspirations).aspirations : {};
  // 보상 특성: { rewards: [...] } 배열 또는 { rewards: { id: … } } 둘 다 받음
  const rr = (raw.rewards as { rewards?: unknown } | undefined)?.rewards ?? raw.rewards ?? {};
  const rewardsRaw = (Array.isArray(rr) ? Object.fromEntries((rr as Array<{ id: string }>).map((x) => [x.id, x])) : rr) as InnerData['rewards'];
  const likes = (raw.likes as Record<string, unknown>) ?? {};
  const lf = likesFileSchema.parse(likes);
  const likeLinks = new Map<string, string[]>();
  const likeIndex: InnerData['likeIndex'] = { byInteraction: new Map(), byTag: new Map(), byEvent: new Map(), bySeason: new Map(), items: new Map() };
  const push = (m: Map<string, string[]>, k: string, item: string) => {
    const a = m.get(k);
    if (a) a.push(item);
    else m.set(k, [item]);
  };
  // likes.json: { categories: { food: { items: { food_stew: { tags?, interactions?, events?, seasons?, dyes? } } } } }
  // 항목 id 는 분류 접두어를 포함해 고유 (food_stew, music_lute …). 연결: 태그, 상호작용, 사건, 계절 (염료는 M8 옷 색)
  for (const c of Object.values(lf.categories ?? {})) {
    for (const [item, v] of Object.entries(c.items ?? {})) {
      const tags = v.tags ?? [];
      const interactions = v.interactions ?? [];
      const events = (v.events ?? []).map(normalizeEvent);
      const seasons = v.seasons ?? [];
      likeLinks.set(item, [...tags.map((t) => `tag:${t}`), ...interactions.map((i) => `done:${i}`), ...events]);
      likeIndex.items.set(item, { tags, interactions, events, seasons, dyes: v.dyes ?? [] });
      for (const t of tags) push(likeIndex.byTag, t, item);
      for (const i of interactions) push(likeIndex.byInteraction, i, item);
      for (const e of events) push(likeIndex.byEvent, e, item);
      for (const s of seasons) push(likeIndex.bySeason, s, item);
    }
  }
  const stageNum = { basic: 1, strong: 2, extreme: 3 } as const;
  const cfg: EmotionConfig = {
    basic: emotions.stages.basic,
    strong: emotions.stages.strong,
    extreme: emotions.stages.extreme,
    needSourceCap: emotions.needSourceCap,
    suppressNegativeStrength: emotions.suppress.negativeStrength,
    suppressPositiveFactor: emotions.suppress.positiveFactor,
    suppressPositiveMaxStage: stageNum[emotions.suppress.positiveMaxStage],
  };
  const er = emotions.extremeRisk;
  const extremeRisk: InnerData['extremeRisk'] = { enabled: er.enabled, minutes: er.hours.value, emotions: new Uint8Array(11), stress: er.stress };
  for (const e of er.emotions) extremeRisk.emotions[EMOTION_INDEX[e]] = 1;
  const happinessPoints: InnerData['happinessPoints'] = { emotions: new Uint8Array(11), perHourByStage: emotions.happinessPoints?.perHourByStage ?? [0, 0, 0, 0] };
  for (const e of emotions.happinessPoints?.emotions ?? []) happinessPoints.emotions[EMOTION_INDEX[e]] = 1;
  // 욕구 무드렛이 파일에 없으면 기본으로 만들어 둠 (11-1 표) → 엔진이 항상 동작
  const needTable: Record<string, { low: [EmotionId, number]; crit: [EmotionId, number]; high: [EmotionId, number] | null }> = {
    hunger: { low: ['sad', 1], crit: ['tense', 2], high: ['happy', 1] },
    energy: { low: ['tense', 1], crit: ['tense', 2], high: ['energized', 1] },
    hygiene: { low: ['angry', 1], crit: ['ashamed', 2], high: ['energized', 1] },
    bladder: { low: ['tense', 1], crit: ['tense', 3], high: null },
    fun: { low: ['sad', 1], crit: ['sad', 2], high: ['excited', 1] },
    social: { low: ['sad', 1], crit: ['sad', 2], high: ['happy', 1] },
    warmth: { low: ['tense', 1], crit: ['tense', 2], high: ['happy', 1] },
    comfort: { low: ['angry', 1], crit: ['angry', 2], high: ['focused', 1] },
  };
  for (const n of NEED_IDS) {
    const t = needTable[n];
    for (const lvl of ['low', 'crit', 'high'] as const) {
      const v = t[lvl];
      const id = `need_${n}_${lvl}`;
      if (!v || moodlets.has(id)) continue;
      moodlets.set(id, {
        id, emotion: EMOTION_INDEX[v[0]], strength: v[1], durationMin: 0, whileCond: `need_${lvl}:${n}`, permanent: false, stack: 'replace', max: 3,
        needSource: true, source: 'need', group: `need_${n}`, fade: [], nameKey: `moodlet.${id}`, descKey: `moodlet.${id}.desc`, icon: `need.${n}`, extra: [],
      });
    }
  }
  const companions: InnerData['companions'] = new Map();
  for (const def of moodlets.values()) for (const e of def.extra) companions.set(companionId(def.id, e.emotion), { parent: def, emotion: e.emotion, strength: e.strength });
  return {
    emotionCfg: cfg, emotions, recomputeMinutes: emotions.recomputeMinutes, moodlets, traits, virtues, thoughts, thoughtCount,
    wishes, aspirations, rewards: rewardsRaw, likes, likeLinks, likeIndex,
    likeEffects: likesEffects.parse(lf.effects ?? {}),
    likePickWeights: lf.pickWeights ?? { active: 1, future: 0 },
    likePerPerson: lf.perPerson ?? { likes: { min: 3, max: 5 }, dislikes: { min: 2, max: 3 } },
    companions, extremeRisk, happinessPoints, missingMoodlets: new Set(),
  };
}

/** 동반 무드렛 id: 원래id~감정 (감정 계산에만 쓰임) */
export function companionId(id: string, emotion: number): string {
  return `${id}~${EMOTION_IDS[emotion]}`;
}

/** 사건 이름 정규화: 접두어가 없으면 event:<이름> (사회 결과 events 는 'event:' 를 떼고 들어옴) */
export function normalizeEvent(ev: string): string {
  return ev.includes(':') ? ev : `event:${ev}`;
}

// ---------------------------------------------------------------- 도달 가능성 (M2~M3 에서 실제로 생기는 사건/무드렛)

/** 데이터에서 계산하는 원천 (SimData 의 부분 구조) */
export interface ReachSources {
  interactions: Record<string, { tags?: readonly string[]; moodlets?: ReadonlyArray<{ id: string }> }>;
  social: Record<string, {
    tags?: readonly string[];
    success?: { moodlets?: ReadonlyArray<{ id: string }>; targetMoodlets?: ReadonlyArray<{ id: string }>; events?: readonly string[] };
    failure?: { moodlets?: ReadonlyArray<{ id: string }>; targetMoodlets?: ReadonlyArray<{ id: string }>; events?: readonly string[] };
  }>;
  /** 재고 품목 (balance.startStock 키) */
  stockKeys: readonly string[];
  /** 그 밖에 데이터가 이름을 정해 엔진이 붙이는 무드렛 (relations.familyMeal.moodlet 등) */
  extraMoodlets?: readonly string[];
  /** stress.json (무너짐 선택 무드렛, 얻는 특성 효과) */
  stress?: { options?: Record<string, { moodlet?: string }>; acquiredTraits?: Record<string, { effects?: unknown }> } | null;
}

export interface Reach {
  /** 발생 가능한 사건/카운터 이름 (done:x, tag:x, social:x, social_ok:x, social_recv:x, need_high:x, moodlet:x, emotion:x, stock_low:x, event:x) */
  events: Set<string>;
  moodlets: Set<string>;
}

export function computeReach(d: InnerData, src: ReachSources): Reach {
  const ev = new Set<string>();
  const tags = new Set<string>();
  const ml = new Set<string>();
  const addM = (id: string | undefined) => {
    if (id && d.moodlets.has(id)) ml.add(id);
  };
  for (const [id, ia] of Object.entries(src.interactions)) {
    ev.add(`done:${id}`);
    for (const t of ia.tags ?? []) tags.add(t);
    for (const m of ia.moodlets ?? []) addM(m.id);
  }
  for (const [id, s] of Object.entries(src.social)) {
    for (const k of ['done', 'social', 'social_ok', 'social_recv']) ev.add(`${k}:${id}`);
    for (const t of s.tags ?? []) tags.add(t);
    for (const o of [s.success, s.failure]) {
      if (!o) continue;
      for (const m of [...(o.moodlets ?? []), ...(o.targetMoodlets ?? [])]) addM(m.id);
      for (const e of o.events ?? []) ev.add(normalizeEvent(e.replace(/^event:/, '')));
    }
  }
  for (const t of tags) ev.add(`tag:${t}`);
  for (const n of NEED_IDS) if (n !== 'bladder') ev.add(`need_high:${n}`);
  for (const k of src.stockKeys) ev.add(`stock_low:${k}`);
  for (const e of ENGINE_EVENTS) ev.add(`event:${e}`);
  for (let e = 0; e < 11; e++) if (d.extremeRisk.emotions[e]) ev.add(`event:extreme_risk_${EMOTION_IDS[e]}`);
  // 무드렛: 욕구, 엔진, 데이터 참조, 특성/보상/얻는 특성 효과, 무너짐 선택
  for (const id of d.moodlets.keys()) if (id.startsWith('need_')) ml.add(id);
  for (const id of ENGINE_MOODLETS) addM(id);
  for (const id of src.extraMoodlets ?? []) addM(id);
  addM(d.likeEffects.likedMoodlet);
  addM(d.likeEffects.dislikedMoodlet);
  addM(d.likeEffects.seasonLikedMoodlet);
  addM(d.likeEffects.seasonDislikedMoodlet);
  for (const o of Object.values(src.stress?.options ?? {})) addM(o.moodlet);
  const effs: TraitEffectsDef[] = [
    ...Object.values(d.traits.traits).map((t) => t.effects),
    ...Object.values(d.rewards).map((r) => (r.effects ?? {}) as TraitEffectsDef),
    ...Object.values(src.stress?.acquiredTraits ?? {}).map((t) => (t.effects ?? {}) as TraitEffectsDef),
  ];
  for (const e of effs) {
    for (const r of e.moodletOnTag ?? []) if (tags.has(r.tag)) addM(r.moodlet);
    for (const r of e.moodletOnWhile ?? []) if (!WHILE_UNSUPPORTED.has(r.while)) addM(r.moodlet);
    addM(e.idleMoodlet?.moodlet);
    addM(e.dailyTagMoodlet?.moodlet);
  }
  const emo = new Set<number>();
  for (const id of ml) {
    ev.add(`moodlet:${id}`);
    const def = d.moodlets.get(id)!;
    emo.add(def.emotion);
    for (const x of def.extra) emo.add(x.emotion);
  }
  for (const e of emo) ev.add(`emotion:${EMOTION_IDS[e]}`);
  return { events: ev, moodlets: ml };
}

/** 인생 목표 단계 조건이 지금 도달 가능한가 (any 는 하나라도) */
export function needReachable(r: Reach, n: NeedCond): boolean {
  if ('any' in n) return n.any.some((x) => needReachable(r, x));
  return r.events.has(normalizeEvent(n.counter));
}

/** 소원: 이룰 수 있음 / 걱정: 현실화와 해소 둘 다 생길 수 있음 */
export function wishReachable(r: Reach, w: WishDef): boolean {
  if (w.kind === 'wish') return !!w.fulfill && r.events.has(normalizeEvent(w.fulfill.event));
  return !!w.realize && !!w.resolve && r.events.has(normalizeEvent(w.realize.event)) && r.events.has(normalizeEvent(w.resolve.event));
}

/** 호불호 항목이 지금 걸리는가: active(지금 걸림) / future(나중 사건에서만) / never(염료뿐 등) */
export function likeReach(r: Reach, d: InnerData, item: string): 'active' | 'future' | 'never' {
  const it = d.likeIndex.items.get(item);
  if (!it) return 'never';
  if (it.seasons.length || it.interactions.some((i) => r.events.has(`done:${i}`)) || it.tags.some((t) => r.events.has(`tag:${t}`)) || it.events.some((e) => r.events.has(e))) return 'active';
  if (it.events.length) return 'future';
  return 'never';
}

/** SimData 비슷한 묶음에서 도달 가능성 원천을 뽑음 (Inner 와 check-inner 가 같이 씀) */
export function reachSourcesOf(data: {
  interactions: ReachSources['interactions'];
  social: ReachSources['social'];
  balance: { startStock: Record<string, number> };
  relations?: { familyMeal?: { moodlet: string } } | null;
  stress?: ReachSources['stress'];
}): ReachSources {
  return {
    interactions: data.interactions,
    social: data.social,
    stockKeys: Object.keys(data.balance.startStock),
    extraMoodlets: data.relations?.familyMeal ? [data.relations.familyMeal.moodlet] : [],
    stress: data.stress ?? null,
  };
}
