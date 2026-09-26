/**
 * 데이터 스키마 (zod). 게임과 도구(check-data)가 같은 스키마로 검증함.
 * BRIEF 0장 4: 수치와 콘텐츠는 JSON + 스키마.
 */
import { z } from 'zod';

const needId = z.enum(['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social', 'warmth', 'comfort']);
const facing = z.enum(['up', 'down', 'left', 'right']);
const pose = z.enum(['stand', 'sit', 'lie']);
const numRecord = z.record(z.string(), z.number());
const needRecord = z.partialRecord(needId, z.number());

export const needsSchema = z.object({
  order: z.array(needId).length(8),
  needs: z.record(
    needId,
    z.object({
      decayPerHour: z.number(),
      scale: z.enum(['absolute', 'season', 'lifespan', 'none']),
      start: z.number().min(0).max(100),
      curve: z.object({ weight: z.number(), exponent: z.number() }),
      icon: z.string(),
    }).loose(),
  ),
  thresholds: z.object({ low: z.number(), critical: z.number(), high: z.number() }),
  collapse: z.object({
    energyFloorSleepMinutes: z.number(),
    hungerZeroWeakenMinutes: z.number(),
  }),
  warmth: z.object({
    comfortableFeltC: z.number(),
    decayPerDegreePerHour: z.number(),
    recoverAboveC: z.number(),
    recoverPerDegreePerHour: z.number(),
    clothing: numRecord,
    nearHearthTiles: z.number(),
    nearHearthBonusC: z.number(),
  }),
}).loose();

export const slotSchema = z.object({
  id: z.string(),
  dx: z.number().int(),
  dy: z.number().int(),
  facing,
  pose,
});

export const objectDefSchema = z.object({
  nameKey: z.string(),
  footprint: z.object({ w: z.number().int().min(1), h: z.number().int().min(1) }),
  blocks: z.boolean(),
  wallMounted: z.boolean().optional(),
  slots: z.array(slotSchema),
  tags: z.array(z.string()),
  price: z.number().optional(),
  roomScore: z.number().optional(),
  light: z.number().optional(),
}).loose();

export const objectsSchema = z.record(z.string(), objectDefSchema);

const stateRecord = z.record(z.string(), z.union([z.number(), z.boolean()]));

const objectQuery = z.object({
  object: z.string(),
  min: numRecord.optional(),
  max: numRecord.optional(),
  state: stateRecord.optional(),
});

const stepAt = z.union([
  z.literal('target'),
  objectQuery,
  z.object({ seatAt: z.literal('target') }),
  z.object({ seatNear: z.literal('target') }),
]);

const stepSchema = z.object({
  at: stepAt,
  slot: z.union([z.string(), z.object({ pose })]).optional(),
  anim: z.string(),
  minutes: z.number().positive(),
  until: z.object({ need: needId, gte: z.number() }).optional(),
  needs: needRecord.optional(),
  effects: z.object({ atAdd: numRecord.optional(), atSet: numRecord.optional(), roomClean: z.number().optional() }).optional(),
  carry: z.string().optional(),
  sleep: z.boolean().optional(),
  blanket: z.boolean().optional(),
  outfit: z.string().optional(),
  hidden: z.boolean().optional(),
});

export const requiresSchema = z.object({
  targetState: stateRecord.optional(),
  targetMin: numRecord.optional(),
  targetMax: numRecord.optional(),
  stock: numRecord.optional(),
  exists: objectQuery.optional(),
  /** 가진 돈이 이 값(파딩) 이상 (M4) */
  money: z.number().optional(),
}).strict();

export const interactionSchema = z.object({
  nameKey: z.string(),
  icon: z.string(),
  /** 행동 태그 (특성 선호, 덕/죄, 호불호, 지표): artifacts/contracts-m2.md 5절 */
  tags: z.array(z.string()).optional(),
  /** 끝냈을 때 붙는 무드렛 (행위자) / 사회 상호작용 상대 */
  moodlets: z.array(z.object({ id: z.string(), chance: z.number().optional() })).optional(),
  targetMoodlets: z.array(z.object({ id: z.string(), chance: z.number().optional() })).optional(),
  objects: z.array(z.string()).min(1),
  autonomous: z.boolean().optional(),
  requires: requiresSchema,
  hours: z.tuple([z.number(), z.number()]).optional(),
  /** 자율 점수 시간대 배수: [시작 시, 끝 시(미포함), 배수] */
  hoursWeight: z.array(z.tuple([z.number(), z.number(), z.number()])).optional(),
  steps: z.array(stepSchema).min(1),
  effects: z.object({
    targetState: stateRecord.optional(),
    targetSet: numRecord.optional(),
    targetAdd: numRecord.optional(),
    stock: numRecord.optional(),
    /** 장부에서 사기/팔기 (M4, 품목 → 개수). 돈이 모자라면 살 수 있는 만큼만 */
    buy: numRecord.optional(),
    sell: numRecord.optional(),
    /** 파는 품목을 "가진 만큼 다" (sell 값 -1) */
  }).strict().optional(),
  ads: needRecord.optional(),
  supportAds: needRecord.optional(),
  supportWhen: z.array(z.string()).optional(),
  adPenaltyWhen: z.object({ targetMin: numRecord, factor: z.number() }).optional(),
  adBonusWhen: z.object({ targetMin: numRecord, ads: needRecord }).optional(),
});

export const interactionsSchema = z.object({ interactions: z.record(z.string(), interactionSchema) }).loose();

export const lotSchema = z.object({
  id: z.string(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  ground: z.array(z.string().nullable()),
  floor: z.array(z.string().nullable()),
  walls: z.array(z.string().nullable()),
  openings: z.array(z.object({
    x: z.number().int(), y: z.number().int(), kind: z.enum(['door', 'window']),
    variant: z.string().optional(), lock: z.enum(['family', 'all', 'estate']).optional(),
  })),
  objects: z.array(z.object({ id: z.string(), x: z.number().int(), y: z.number().int(), rot: z.number().int().optional(), variant: z.string().optional() })),
  spawn: z.object({ x: z.number(), y: z.number() }),
  exits: z.array(z.object({ x: z.number().int(), y: z.number().int() })).optional(),
  roof: z.object({ style: z.string() }).optional(),
  roomNames: z.array(z.object({ x: z.number().int(), y: z.number().int(), name: z.string() })).optional(),
}).loose().superRefine((lot, ctx) => {
  // 한 층(w×h) 또는 슬랩 전체(w×rows, world/lot.ts)
  const n = lot.w * lot.h;
  const full = lot.w * (4 * (lot.h + 1) - 1);
  for (const key of ['ground', 'floor', 'walls'] as const) {
    if (lot[key].length !== n && lot[key].length !== full) ctx.addIssue({ code: 'custom', message: `${key} 길이 ${lot[key].length} != w*h ${n} (또는 전체 ${full})` });
  }
});

/** 사람 대상 사회 상호작용 (GDD 14). 둘이 마주 보고 minutes 동안 */
/** 무드렛 참조: "id" 또는 {id, chance} */
const moodletRef = z.union([z.string(), z.object({ id: z.string(), chance: z.number().optional() })]);
const socialOutcome = z.object({
  friendship: z.number().optional(),
  romance: z.number().optional(),
  respect: z.number().optional(),
  moodlets: z.array(moodletRef).optional(),
  targetMoodlets: z.array(moodletRef).optional(),
  flagsAdd: z.array(z.string()).optional(),
  flagsRemove: z.array(z.string()).optional(),
  events: z.array(z.string()).optional(),
}).loose();
export const SOCIAL_CATEGORIES = ['basic', 'friendly', 'romance', 'mean', 'status', 'trade', 'special'] as const;
const socialRequires = z.object({
  met: z.boolean().optional(),
  relAny: z.array(z.string()).optional(),
  relNone: z.array(z.string()).optional(),
  friendshipGte: z.number().optional(),
  friendshipLte: z.number().optional(),
  romanceGte: z.number().optional(),
  romanceLte: z.number().optional(),
  respectGte: z.number().optional(),
  actorEmotionAny: z.array(z.string()).optional(),
  targetEmotionAny: z.array(z.string()).optional(),
  actorTraitsAny: z.array(z.string()).optional(),
  targetTraitsAny: z.array(z.string()).optional(),
  actorMoodletAny: z.array(z.string()).optional(),
  targetMoodletAny: z.array(z.string()).optional(),
  actorVirtueAny: z.array(z.string()).optional(),
  actorSinAny: z.array(z.string()).optional(),
  actorEstateAny: z.array(z.string()).optional(),
  targetEstateAny: z.array(z.string()).optional(),
  actorEstateAbove: z.boolean().optional(),
  actorEstateBelow: z.boolean().optional(),
  household: z.boolean().optional(),
  adult: z.boolean().optional(),
  stock: numRecord.optional(),
}).loose();
/**
 * 사회 상호작용 (M3 계약 artifacts/contracts-m3.md). M2 형식(friendship, requiresTarget, requiresActor, moodlets[{id}])도 받음 → normalizeSocial 로 통일
 */
export const socialSchema = z.object({
  nameKey: z.string(),
  icon: z.string(),
  category: z.enum(SOCIAL_CATEGORIES).optional(),
  tags: z.array(z.string()),
  minutes: z.number().positive(),
  needs: needRecord.optional(),
  targetNeeds: needRecord.optional(),
  ads: needRecord.optional(),
  adsWhenActorEmotion: z.record(z.string(), needRecord).optional(),
  base: z.number().optional(),
  requires: socialRequires.optional(),
  traitMods: numRecord.optional(),
  targetTraitMods: numRecord.optional(),
  topics: z.array(z.string()).optional(),
  estateRule: z.enum(['rude', 'deference']).optional(),
  success: socialOutcome.optional(),
  failure: socialOutcome.optional(),
  removeMoodlets: z.array(z.string()).optional(),
  targetRemoveMoodlets: z.array(z.string()).optional(),
  // M2 형식
  friendship: z.number().optional(),
  requiresTarget: z.object({ emotionAny: z.array(z.string()).optional() }).optional(),
  requiresActor: z.object({ moodletAny: z.array(z.string()).optional() }).optional(),
  moodlets: z.array(moodletRef).optional(),
  targetMoodlets: z.array(moodletRef).optional(),
}).loose();
export const socialsSchema = z.object({ interactions: z.record(z.string(), socialSchema) }).loose();
type SocialRaw = z.infer<typeof socialSchema>;
type NeedIdT = z.infer<typeof needId>;

export interface MoodletRef {
  id: string;
  chance?: number;
}
export interface SocialOutcome {
  friendship: number;
  romance: number;
  respect: number;
  moodlets: MoodletRef[];
  targetMoodlets: MoodletRef[];
  flagsAdd: string[];
  flagsRemove: string[];
  events: string[];
}
export type SocialRequires = z.infer<typeof socialRequires>;
/** 통일된 사회 상호작용 정의 (sim 이 쓰는 형태) */
export interface SocialDef {
  nameKey: string;
  icon: string;
  category: (typeof SOCIAL_CATEGORIES)[number];
  tags: string[];
  minutes: number;
  needs?: Partial<Record<NeedIdT, number>>;
  targetNeeds?: Partial<Record<NeedIdT, number>>;
  ads?: Partial<Record<NeedIdT, number>>;
  adsWhenActorEmotion?: Record<string, Partial<Record<NeedIdT, number>>>;
  base: number;
  requires: SocialRequires;
  traitMods: Record<string, number>;
  targetTraitMods: Record<string, number>;
  topics: string[];
  estateRule?: 'rude' | 'deference';
  success: SocialOutcome;
  failure: SocialOutcome;
  removeMoodlets: string[];
  targetRemoveMoodlets: string[];
}

function refs(a: Array<string | { id: string; chance?: number }> | undefined): MoodletRef[] {
  return (a ?? []).map((m) => (typeof m === 'string' ? { id: m } : m));
}
function outcome(o: z.infer<typeof socialOutcome> | undefined): SocialOutcome {
  return {
    friendship: o?.friendship ?? 0, romance: o?.romance ?? 0, respect: o?.respect ?? 0,
    moodlets: refs(o?.moodlets), targetMoodlets: refs(o?.targetMoodlets),
    flagsAdd: o?.flagsAdd ?? [], flagsRemove: o?.flagsRemove ?? [], events: o?.events ?? [],
  };
}

export function normalizeSocial(r: SocialRaw): SocialDef {
  const req: SocialRequires = { ...(r.requires ?? {}) };
  if (r.requiresTarget?.emotionAny) req.targetEmotionAny = r.requiresTarget.emotionAny;
  if (r.requiresActor?.moodletAny) req.actorMoodletAny = r.requiresActor.moodletAny;
  const success = outcome(r.success);
  // M2 형식: friendship/moodlets 는 성공 결과
  if (!r.success) {
    success.friendship = r.friendship ?? 0;
    success.moodlets = refs(r.moodlets);
    success.targetMoodlets = refs(r.targetMoodlets);
  }
  const failure = r.failure ? outcome(r.failure) : outcome({ friendship: -Math.abs(r.friendship ?? 2) / 2 });
  const tags = r.tags;
  const category = r.category ?? (tags.includes('romance') ? 'romance' : tags.includes('mean') ? 'mean' : 'friendly');
  return {
    nameKey: r.nameKey, icon: r.icon, category, tags, minutes: r.minutes,
    needs: r.needs, targetNeeds: r.targetNeeds, ads: r.ads, adsWhenActorEmotion: r.adsWhenActorEmotion,
    base: r.base ?? 70, requires: req, traitMods: r.traitMods ?? {}, targetTraitMods: r.targetTraitMods ?? {},
    topics: r.topics ?? [], estateRule: r.estateRule, success, failure,
    removeMoodlets: r.removeMoodlets ?? [], targetRemoveMoodlets: r.targetRemoveMoodlets ?? [],
  };
}

/** 관계 규칙 (relations.json, GDD 14-1~14-3) */
export const relationsSchema = z.object({
  decayPerDay: z.object({ friendship: z.number(), romance: z.number(), scale: z.literal('lifespan') }),
  familyFriendshipDecayMult: z.number(),
  romanticDecayMult: z.number(),
  names: z.object({ enemy: z.number(), rival: z.number(), friend: z.number(), bestFriend: z.number(), bestFriendMemories: z.number(), loverRomance: z.number() }),
  firstImpression: z.object({
    friendship: z.tuple([z.number(), z.number()]),
    respect: z.tuple([z.number(), z.number()]),
    estateRespectPerStep: z.number(),
    hygienePenaltyBelow: z.number(),
    hygienePenalty: z.number(),
    traitPairs: z.array(z.object({ a: z.string(), b: z.string(), friendship: z.number() })),
  }),
  success: z.object({
    moodPositiveBonus: z.number(), moodNegativeMalus: z.number(), angryMeanBonus: z.number(), estateStepMod: z.number(),
    sharedTopicBonus: z.number().default(5), rudePunishChance: z.number().default(0.35),
  }).loose(),
  multitask: z.object({ radius: z.number(), socialPerMinute: z.number(), friendshipPerHour: z.number().default(2), chatMoodletChancePerHour: z.number(), tags: z.array(z.string()) }).loose(),
  familyMeal: z.object({ moodlet: z.string(), minPeople: z.number().int(), radius: z.number() }).loose(),
  /** 엔진이 붙이는 무드렛 기준 (GDD 11-1, contracts-m2 5절) */
  engine: z.object({
    sleptBadlyBelow: z.number(), floorBeds: z.array(z.string()), ateAloneChance: z.number(),
    stockLow: z.record(z.string(), z.number()), smokeRoomMaxCells: z.number(), smokeMinutes: z.number(),
  }).loose().default({ sleptBadlyBelow: 45, floorBeds: ['bedroll', 'straw_pallet'], ateAloneChance: 0.3, stockLow: { default: 1 }, smokeRoomMaxCells: 16, smokeMinutes: 120 }),
  visit: z.object({
    arriveAfterMinutes: z.tuple([z.number(), z.number()]),
    stayMinutes: z.tuple([z.number(), z.number()]),
    allowInteractions: z.array(z.string()),
    leaveIfNeedBelow: z.number(),
  }).loose().default({ arriveAfterMinutes: [20, 60], stayMinutes: [150, 240], allowInteractions: [], leaveIfNeedBelow: 15 }),
}).loose();
export type RelationsData = z.infer<typeof relationsSchema>;

export const neighborsSchema = z.object({
  neighbors: z.array(z.object({
    id: z.string(), name: z.string(), sex: z.enum(['male', 'female']), stage: z.enum(['child', 'teen', 'adult', 'elder']),
    estate: z.string(), traits: z.array(z.string()), virtue: z.string().nullable().optional(), sin: z.string().nullable().optional(),
    seed: z.number(), topics: z.array(z.string()).optional(),
  }).loose()),
}).loose();
export type NeighborDef = z.infer<typeof neighborsSchema>['neighbors'][number];

export type InteractionDef = z.infer<typeof interactionSchema>;
export type StepDef = z.infer<typeof stepSchema>;
export type ObjectQuery = z.infer<typeof objectQuery>;
export type NeedsData = z.infer<typeof needsSchema>;
