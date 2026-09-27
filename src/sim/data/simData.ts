/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 시뮬레이션에 주입되는 데이터 묶음. 게임(main)과 테스트/도구가 각자 만들어 넘김.
 * 검증은 여기서 한 번에 함: zod 스키마 + 교차 참조(물건, 슬롯 id, 조건식, 부지 범위/겹침).
 */
import { z } from 'zod';
import type { LotDef, ObjectDef, SlotDef } from '../core/types';
import { compile, type Compiled } from './compiled';
import { compileInner, type InnerData, type InnerRaw } from './innerData';
import type { StressData } from '../inner/inner';
import {
  interactionsSchema,
  lotSchema,
  needsSchema,
  objectsSchema,
  socialsSchema,
  normalizeSocial,
  relationsSchema,
  neighborsSchema,
  type RelationsData,
  type NeighborDef,
  type SocialDef,
  type InteractionDef,
  type NeedsData,
} from './schema';

const num = z.number();
const numRec = z.record(z.string(), z.number());

export const balanceSchema = z.object({
  time: z.object({
    minutesPerTick: num,
    speeds: numRec,
    autoAccelMinutesPerSecond: num,
    startMinuteOfDay: num,
    dayMinutes: num,
  }),
  movement: z.object({
    walkTilesPerMinute: num.positive(),
    stuckMinutes: num.positive(),
    pathFailExcludeMinutes: num,
    pathFailLimit: num.int().positive(),
  }),
  autonomy: z.object({
    topK: num.int().positive(),
    distanceRefTiles: num.positive(),
    repeatPenalty: num,
    repeatWindow: num.int(),
    minScore: num,
    idleWanderMinutes: num,
    /** 욕구 해결 가능 여부 다시 계산하는 간격(분) */
    solvableRecheckMinutes: num.int().positive(),
    /** 잠에서 깨게 한 욕구를 못 풀어 다시 누운 경우 등, 같은 침대 제외 시간 */
    wakeExcludeMinutes: num.int().nonnegative(),
    searchRadiusTiles: num.optional(),
    socialRadiusTiles: num.optional(),
    /** 스스로 챙기는 욕구 기준 (심즈식): 다음 행동을 고를 때 이 값 아래면 그 욕구부터 풂. 반경 안에 풀 곳이 없으면 집으로 */
    selfCare: numRec.optional(),
    /** 욕구를 채우는 광고는 그 욕구가 이 값 아래일 때만 (심즈식) */
    adBelow: numRec.optional(),
    /** 집으로 돌아가 욕구를 풀러 가는 시도 사이 간격 (분) */
    goHomeCooldownMinutes: num.optional(),
  }),
  queue: z.object({ maxLength: num.int().positive(), waitMinutes: num.default(20), waitAutonomousMinutes: num.default(8) }).loose(),
  temperature: z.object({
    scale: z.string(),
    seasons: z.record(z.string(), z.object({ dayC: num, nightC: num })),
    coldestHour: num,
    warmestHour: num,
    wallInsulationC: numRec,
    hearthHeatC: num,
    hearthRefRoomTiles: num,
    openDoorVentC: num,
    roomUpdateMinutes: num.int().positive(),
    roomApproachRate: num,
  }),
  startStock: numRec,
  sleep: z.object({
    decayMultiplier: numRec,
    bedEnergyPerHour: numRec.refine((r) => 'floor' in r, 'floor 필요'),
    wakeIf: numRec,
    /** 밤잠: from~to 시 사이면 기운이 다 차도 이어 잠 */
    stayAsleep: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(23) }).optional(),
  }),
  interrupt: numRec,
  collapse: z.object({ bladderAccidentHygiene: num }),
  roomDirt: z.object({ perPersonMinute: num, dirtyAt: num }).loose().default({ perPersonMinute: 0.022, dirtyAt: 60 }),
}).loose();

export type Balance = z.infer<typeof balanceSchema>;

export interface SimData {
  needs: NeedsData;
  balance: Balance;
  interactions: Record<string, InteractionDef>;
  objects: Record<string, ObjectDef>;
  lot: LotDef;
  /** 사람 대상 사회 상호작용 (M2 12종, M3 80종) */
  social: Record<string, SocialDef>;
  /** 관계 규칙 (M3). 없으면 기본값 */
  relations: RelationsData | null;
  /** 이웃 (M3, 초대하면 방문) */
  neighbors: NeighborDef[];
  /** 경제 (M4, economy.json). 없으면 경제 꺼짐 (M1 테스트 부지) */
  economy: Record<string, unknown> | null;
  /** 저장고 품목 (M4, items.json) */
  items: Record<string, ItemDef>;
  /** 스킬 (M4, skills.json). 없으면 스킬 꺼짐 */
  skills: SkillsData | null;
  /** 직업 (M4, careers.json). 없으면 직업 꺼짐 */
  careers: Record<string, CareerDef> | null;
  /** 레시피 (M4, recipes.json) */
  recipes: Record<string, RecipeDef>;
  /** careers.json rules (근무 중 욕구 배수, 성과 규칙) */
  careerRules: { rabbitholeNeeds?: Record<string, number> } | null;
  /** 작물과 농사 작업 (M4, crops.json). 없으면 농사 꺼짐 */
  crops: Record<string, any> | null;
  /** 건축 수치 (M5, build.json). 없으면 건축 모드 꺼짐 */
  build: BuildData | null;
  /** 울타리 벽 id (방을 만들지 않음) */
  fenceIds: ReadonlySet<string>;
  /** 못 걷는 지형 id (물, M6) */
  blockedTerrain: ReadonlySet<string>;
  /** 마을 (M6): 지도/장소/부지, 사람, 일과표. 없으면 한 부지 모드 */
  town: { def: import('../town/town').TownDef; people: import('../town/town').PeopleData | null; schedules: import('../town/town').SchedulesData | null } | null;
  /** 스토리 진행/생애 판정기 수치 (story.json) */
  story: StoryData | null;
  compiled: Compiled;
  /** 내면 데이터 (M2). 없으면 내면 시스템 꺼짐 (M1 테스트 부지 등) */
  inner: InnerData | null;
  stress: StressData | null;
  /**
   * 생애와 가족 (M7~M9) 원본 데이터 묶음: 파일마다 그 모듈이 자기 zod 스키마로 검증 (src/sim/family/*, house/*, society/*).
   * 없으면 그 시스템 꺼짐 (M1~M6 테스트 부지)
   */
  family: FamilyRaw;
}

/** 생애와 가족 원본 (파일 → 키): genetics, pregnancy, deathRules, lifecycle, childcare, names, clanNames, heraldry, events, letters … */
export type FamilyRaw = Record<string, unknown>;

import type { SkillsData } from '../people/skills';
import { normalizeLot } from '../world/lot';

/** 스토리 진행 수치 (story.json, GDD 18-3, 29-2) */
export interface StoryData {
  stageDays: Record<string, number>;
  displayAge: Record<string, [number, number]>;
  elderHazard: { base: number; k: number; healthGood: number; healthPoor: number };
  backgroundDeath: Record<string, number>;
  backgroundCauses: Record<string, number>;
  marriage: { minStage: string; minAge: number; baseDaily: number; estateGapPenalty: number; friendshipBonus: number; ageGapYears: number; betrothalDays: number; spouseMovesTo: string; clergyMult: number; romanceBonus: number; dailyCap: number; poolDivisor: number; engagedRomance: number; engagedFriendship: number; estateRank: string[] };
  pregnancy: { perCoitus: number; coitusPerDay: Record<string, number>; fertileAge: [number, number]; declineFromAge: number; stageDays: number; twins: number; lossChance: number; maternalDeath: number; birthCooldownDays: number; declineYears: number; declineFloor: number };
  population: { target: number; feedbackMin: number; feedbackMax: number; immigrateBelow: number; emigrateAbove: number; migrationCheckDays: number; immigrantFamily: [number, number]; immigrantFreemanChance: number };
  household: { cap: number; controllableCap: number; splitChance: number };
  rumor: import('../town/rumors').RumorData;
  news: { keep: number };
  town?: { residentOnly: string[]; publicPlaces?: Record<string, string[]>; playerRoamHours?: [number, number]; playerRoamTiles?: number; sellBackRate?: number };
  npcPantry?: { refillMinutes: number };
  newborn?: { familyFriendship: number };
  travel?: { horseSpeedMult: number; rideMinTiles: number; horseEstates: string[]; horseWealth: string[]; horseMinStage: string };
  lod: { viewMarginTiles: number; demoteFullMinutes: number; demoteSimpleMinutes: number; checkMinutes: number; simpleNeedsMinutes: number };
}

/** 카탈로그 항목 (catalog.json, contracts-m5 2절) */
export interface CatalogEntry {
  nameKey: string;
  category: string;
  as?: string | null;
  footprint: { w: number; h: number };
  blocks?: boolean;
  wallMounted?: boolean;
  surface?: boolean;
  underRug?: boolean;
  rotations?: number[];
  flip?: boolean;
  price: number;
  quality?: number;
  roomScore?: number;
  estate?: string | null;
  roomType?: string;
  durable?: boolean;
  tags?: string[];
  light?: number;
  slots?: SlotDef[];
  variants?: Record<string, string[]>;
}

interface PartDef { nameKey: string; price: number; estate?: string | null; fire?: number; insulationC?: number; roomScore?: number; warmthC?: number; fenceOnly?: boolean; cellarOnly?: boolean; lightningPerDay?: number }
/** 건축 수치 (build.json) */
export interface BuildData {
  walls: Record<string, PartDef>;
  fences: Record<string, PartDef>;
  doors: Record<string, PartDef>;
  windows: Record<string, PartDef>;
  floors: Record<string, PartDef>;
  terrain: Record<string, PartDef>;
  roofs: Record<string, PartDef>;
  defaultRoof: string;
  upperFloorPrice: number;
  cellarDigPrice: number;
  basePrices?: Record<string, number>;
  baseCategories?: Record<string, string>;
  roomTypeTags: Record<string, string>;
  rooms: {
    sizeRef: number; qualityBonus: number[]; windowScore: number; lightScore: number; dirtPenalty: number; brokenPenalty: number; emptyPenalty: number;
    tiers: { min: number; id: string; moodlet: string | null }[]; estateShift: Record<string, number>; checkMinutes: number;
  };
  wear: { perUse: number; perUseByKind: Record<string, number>; brokenUsable: Record<string, string>; repairMinutes: number; repairSkill: string; repairXp: number };
  fire: {
    hearthUnattendedPerDay: number; candleUnattendedPerDay: number; unattendedAfterMinutes: number; spreadMinutes: number; spreadChance: number;
    burnMinutes: number; extinguishMinutes: number; extinguishWater: number; neighborHelpAfterMinutes: number; neighborHelpChance: number; maxFires: number; burnObjectAfterMinutes: number;
  };
  undoDepth: number;
  resellRatio: number;
  /** 놓인 가구 색 바꾸기 값 (물건 값 배수) */
  recolorRatio?: number;
  craftedFurniture?: Record<string, string>;
  emptyLotFund?: number;
  construction: { defaultOn: boolean; workPerFarthing: number; npcWorkPerHour: number; npcHours: [number, number]; familyWorkPerHour: number; familySkill: string; laborShare: number };
}
import type { CareerDef } from '../people/careers';

const FARM_ICON: Record<string, string> = { till: 'raven:a4477', sow: 'plant', weed: 'item.herbs', water: 'water', fertilize: 'raven:a1275', scarecrow: 'eye', harvest: 'raven:a4460', glean: 'raven:a3323' };

/** 레시피 (recipes.json, contracts-m4 2절) */
export interface RecipeDef {
  nameKey: string;
  icon: string;
  group: string;
  station: string;
  skill: string;
  level: number;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  minutes: number;
  xp: number;
  tags: string[];
  quality: boolean;
  fuel?: Record<string, number>;
  wait?: { value: number; scale: string };
  service?: boolean;
}

/** 저장고 품목 (items.json, contracts-m4 1절) */
export interface ItemDef {
  nameKey: string;
  icon: string;
  category?: string;
  ledger?: string | null;
  ration?: number | null;
  /** 레시피 밖에서 들어오는 길: crop animal forage hunt well market */
  source?: string[];
  base: number;
  bundle?: { n: number; price: number };
  spoil?: { value: number; scale: string };
  food?: { hunger: number; quality: number };
  storage?: string;
}

/** items.json 이 없을 때 기존 재고 키의 기본 정의 (M1~M3 부지 호환) */
export const FALLBACK_ITEMS: Record<string, ItemDef> = {
  bread: { nameKey: 'item.bread', icon: 'item.bread', ledger: 'bread', ration: 1, base: 3, bundle: { n: 4, price: 12 }, spoil: { value: 3, scale: 'absolute' } },
  ale: { nameKey: 'item.ale', icon: 'item.ale', ledger: 'ale', ration: 1, base: 3, bundle: { n: 4, price: 12 }, spoil: { value: 14, scale: 'season' } },
  flour: { nameKey: 'item.flour', icon: 'item.flour', ledger: 'flour', ration: 1, base: 3, spoil: { value: 42, scale: 'season' } },
  firewood: { nameKey: 'item.firewood', icon: 'item.firewood', ledger: 'firewood', ration: 1, base: 2 },
  preserves: { nameKey: 'item.preserves', icon: 'item.preserves', ledger: 'preserves', ration: 1, base: 5, spoil: { value: 14, scale: 'season' } },
  ingredients: { nameKey: 'item.ingredients', icon: 'item.ingredients', ledger: 'vegetables', ration: 1.5, base: 2, spoil: { value: 4, scale: 'season' } },
  herbs: { nameKey: 'item.herbs', icon: 'item.herbs', ledger: null, base: 2, spoil: { value: 7, scale: 'season' } },
  yarn: { nameKey: 'item.yarn', icon: 'item.yarn', ledger: null, base: 6 },
  water: { nameKey: 'item.water', icon: 'item.water', ledger: null, base: 0 },
};

/** 창문 가상 물건 (GDD 13: 창가 수다/구경). 슬롯은 인스턴스마다 계산 */
export const WINDOW_OBJECT_ID = 'window_opening';
export const WINDOW_DEF: ObjectDef = {
  nameKey: 'object.window_opening',
  footprint: { w: 1, h: 1 },
  blocks: false,
  wallMounted: true,
  slots: [] as SlotDef[],
  tags: ['window'],
};

/** 불 (23-5 화재): 불타는 칸마다 하나. 막는 물건(길찾기가 피함), 끄기 상호작용의 대상 */
export const FIRE_OBJECT_ID = 'house_fire';
export const FIRE_DEF: ObjectDef = {
  nameKey: 'object.house_fire',
  footprint: { w: 1, h: 1 },
  blocks: true,
  slots: [
    { id: 's', dx: 0, dy: 1, facing: 'up', pose: 'stand' },
    { id: 'n', dx: 0, dy: -1, facing: 'down', pose: 'stand' },
    { id: 'e', dx: 1, dy: 0, facing: 'left', pose: 'stand' },
    { id: 'w', dx: -1, dy: 0, facing: 'right', pose: 'stand' },
  ],
  tags: ['fire_hazard'],
};

/** 공사 자리 (23-3 공사 시간 옵션): 가족이 가서 짓는 대상. 막지 않음 */
export const SITE_OBJECT_ID = 'construction_site';
export const SITE_DEF: ObjectDef = {
  nameKey: 'object.construction_site',
  footprint: { w: 1, h: 1 },
  blocks: false,
  slots: [
    { id: 'c', dx: 0, dy: 0, facing: 'down', pose: 'stand' },
    { id: 's', dx: 0, dy: 1, facing: 'up', pose: 'stand' },
    { id: 'n', dx: 0, dy: -1, facing: 'down', pose: 'stand' },
    { id: 'e', dx: 1, dy: 0, facing: 'left', pose: 'stand' },
    { id: 'w', dx: -1, dy: 0, facing: 'right', pose: 'stand' },
  ],
  tags: ['construction'],
};

/** 부지 출구 가상 물건 (래빗홀: 장터 다녀오기 등, GDD 13-8). 부지 가장자리 길 끝 */
export const EXIT_OBJECT_ID = 'lot_exit';
export const EXIT_DEF: ObjectDef = {
  nameKey: 'object.lot_exit',
  footprint: { w: 1, h: 1 },
  blocks: false,
  // 래빗홀(일터, 장터, 방앗간 …)은 여럿이 동시에 나감: 같은 칸 서기 자리 8개
  slots: Array.from({ length: 8 }, (_, i) => ({ id: i ? `out${i}` : 'out', dx: 0, dy: 0, facing: 'down' as const, pose: 'stand' as const })),
  tags: ['exit'],
};

/**
 * 물건 정의 합치기: objects.json + build.json 구매가/분류 + catalog.json (기능 기반 as 의 슬롯/태그 상속).
 * 워커(sim)와 화면(렌더러, 구매 목록)이 같은 정의를 씀
 */
export function mergeObjectDefs(userObjects: Record<string, ObjectDef>, build: BuildData | null, catalogRaw: unknown): {
  objects: Record<string, ObjectDef>;
  kindMembers: Map<string, string[]>;
  problems: string[];
} {
  const objects: Record<string, ObjectDef> = { ...userObjects, [WINDOW_OBJECT_ID]: WINDOW_DEF, [EXIT_OBJECT_ID]: EXIT_DEF, [FIRE_OBJECT_ID]: FIRE_DEF, [SITE_OBJECT_ID]: SITE_DEF };
  // 건축 수치 (build.json): 기본 물건 구매가/분류를 파딩으로 덮어씀
  if (build) {
    for (const [id, o] of Object.entries(userObjects)) {
      const bp = build.basePrices?.[id];
      const cat = o.category ?? build.baseCategories?.[id];
      const durable = o.durable ?? (!!cat && !['outdoor', 'build', 'decor'].includes(cat));
      objects[id] = { ...o, price: bp ?? o.price, category: cat, durable };
    }
  }
  // 구매 카탈로그 (catalog.json, contracts-m5 2절): 기능 기반(as)의 슬롯/태그를 물려받은 새 물건
  const catalog = ((catalogRaw as { catalog?: Record<string, CatalogEntry> } | undefined)?.catalog) ?? {};
  const kindMembers = new Map<string, string[]>();
  const problemsCat: string[] = [];
  for (const [id, c] of Object.entries(catalog)) {
    if (id.startsWith('$')) continue;
    if (objects[id]) {
      problemsCat.push(`카탈로그 ${id}: 기본 물건과 id 가 겹침`);
      continue;
    }
    const base = c.as ? userObjects[c.as] : null;
    if (c.as && !base) {
      problemsCat.push(`카탈로그 ${id}: 기반 ${c.as} 없음`);
      continue;
    }
    const kind = base ? (base.kind ?? c.as!) : undefined;
    const tags = [...new Set([...(base?.tags ?? []), ...(c.tags ?? []), 'catalog'])];
    const variants = c.variants ? Object.values(c.variants).flat() : undefined;
    objects[id] = {
      nameKey: c.nameKey, footprint: c.footprint, blocks: c.blocks ?? base?.blocks ?? true, wallMounted: c.wallMounted ?? base?.wallMounted ?? false,
      slots: c.slots ?? base?.slots ?? [], tags, price: c.price, roomScore: c.roomScore ?? 0, light: c.light ?? base?.light,
      kind, category: c.category, quality: c.quality ?? 1, estate: c.estate ?? null, roomType: c.roomType, durable: c.durable ?? !!base,
      rotations: c.rotations ?? [0], surface: c.surface, underRug: c.underRug, variants, flip: c.flip && !(c.slots ?? base?.slots ?? []).length,
    };
    if (kind) {
      if (base && (base.footprint.w !== c.footprint.w || base.footprint.h !== c.footprint.h) && !c.slots) problemsCat.push(`카탈로그 ${id}: 발자국이 기반 ${c.as} 와 다른데 slots 가 없음`);
      const list = kindMembers.get(c.as!) ?? [];
      list.push(id);
      kindMembers.set(c.as!, list);
    }
  }
  return { objects, kindMembers, problems: problemsCat };
}

/** SimData.family 의 콘텐츠를 기존 원본 묶음에 합침 (검증 전, 원본을 바꾸지 않고 새 객체로) */
function mergeFamilyContent(raw: { interactions: unknown; social?: unknown; inner?: unknown; family?: FamilyRaw }): void {
  const f = raw.family;
  if (!f) return;
  const cc = f.childcare as { social?: Record<string, unknown>; interactions?: Record<string, unknown> } | undefined;
  const preg = f.pregnancy as { social?: Record<string, unknown>; interactions?: Record<string, unknown> } | undefined;
  // M9 사회 구조 (소문 대응, 구애·혼례, 범죄·재판 …): social / interactions 묶음이 있는 파일
  const soc = [f.society, f.courtship, f.justice, f.policy] as ({ social?: Record<string, unknown>; interactions?: Record<string, unknown> } | undefined)[];
  const addTo = (base: unknown, extra: Record<string, unknown>[]): unknown => {
    const b = (base as { interactions?: Record<string, unknown> } | undefined) ?? { interactions: {} };
    const merged: Record<string, unknown> = { ...(b.interactions ?? {}) };
    for (const e of extra) for (const [k, v] of Object.entries(e)) if (!k.startsWith('$')) merged[k] = v;
    return { ...b, interactions: merged };
  };
  const ia = [cc?.interactions, preg?.interactions, ...soc.map((x) => x?.interactions)].filter((x): x is Record<string, unknown> => !!x);
  if (ia.length) raw.interactions = addTo(raw.interactions, ia);
  const so = [cc?.social, preg?.social, ...soc.map((x) => x?.social)].filter((x): x is Record<string, unknown> => !!x);
  if (so.length && raw.social) raw.social = addTo(raw.social, so);
  const inner = raw.inner as { moodlets?: { moodlets?: Record<string, unknown> }; thoughts?: { thoughts?: unknown[] }; wishes?: { wishes?: unknown[] } } | undefined;
  if (inner) {
    const m7 = [f.moodletsM7, f.moodletsM7b] as ({ moodlets?: Record<string, unknown> } | undefined)[];
    const moods: Record<string, unknown> = { ...(inner.moodlets?.moodlets ?? {}) };
    for (const m of m7) for (const [k, v] of Object.entries(m?.moodlets ?? {})) if (!k.startsWith('$') && !(k in moods)) moods[k] = v;
    const th = (f.thoughtsM7 as { thoughts?: unknown[] } | undefined)?.thoughts ?? [];
    const wi = (f.wishesM7 as { wishes?: unknown[] } | undefined)?.wishes ?? [];
    raw.inner = {
      ...inner,
      moodlets: { ...(inner.moodlets ?? {}), moodlets: moods },
      ...(inner.thoughts ? { thoughts: { ...inner.thoughts, thoughts: [...(inner.thoughts.thoughts ?? []), ...th] } } : {}),
      ...(inner.wishes ? { wishes: { ...inner.wishes, wishes: [...(inner.wishes.wishes ?? []), ...wi] } } : {}),
    };
  }
}

export function validateSimData(raw: {
  needs: unknown;
  balance: unknown;
  interactions: unknown;
  objects: unknown;
  lot: unknown;
  inner?: InnerRaw & { stress: unknown };
  social?: unknown;
  relations?: unknown;
  neighbors?: unknown;
  economy?: unknown;
  items?: unknown;
  skills?: unknown;
  careers?: unknown;
  recipes?: unknown;
  crops?: unknown;
  build?: unknown;
  catalog?: unknown;
  town?: unknown;
  people?: unknown;
  schedules?: unknown;
  story?: unknown;
  family?: FamilyRaw;
}): SimData {
  const needs = needsSchema.parse(raw.needs);
  const balance = balanceSchema.parse(raw.balance);
  // 생애와 가족 (M7): 돌봄 사회 상호작용, 장난감·과제 물건 상호작용, M7 무드렛·속마음·소원을 기존 묶음에 합침
  mergeFamilyContent(raw);
  const interactions = interactionsSchema.parse(raw.interactions).interactions;
  // 직업 근무 = 래빗홀 상호작용으로 합성 (부지 출구로 나가 근무 시간 동안 사라짐, 13-8)
  const careersRaw = (raw.careers as { careers?: Record<string, CareerDef> } | undefined)?.careers ?? null;
  const careers: Record<string, CareerDef> | null = careersRaw ? Object.fromEntries(Object.entries(careersRaw).filter(([k]) => !k.startsWith('$'))) : null;
  if (careers) {
    for (const [cid, c] of Object.entries(careers)) {
      // 현장형 서비스 일감 (치유사 왕진, 음유시인 공연, 사제 미사 …): 부지 밖 장소로 나가 하는 일 = 래빗홀
      const svc = (c as { services?: { pool: Array<{ id: string; nameKey: string; skill: string; minutes: number }> } }).services;
      if (c.type === 'onsite' && svc && !c.npc_role) {
        for (const sv of svc.pool) {
          interactions[`service.${cid}.${sv.id}`] = {
            nameKey: sv.nameKey, icon: c.icon ?? 'ui.coin', objects: ['lot_exit'], requires: {}, tags: ['work'],
            steps: [{ at: 'target', slot: { pose: 'stand' }, anim: 'idle', minutes: sv.minutes, hidden: true, needs: { social: 0.1 } }],
            ...({ skill: sv.skill } as object),
          } as InteractionDef;
        }
      }
      if (c.type === 'onsite' || c.npc_role) continue;
      if (c.type === 'journey') {
        // 여정 (17-2 원거리 상인): 며칠 동안 부지를 떠나 있음. 실제 길이는 출발 때 정함 (sim), 욕구는 길에서 알아서 챙김
        const jd = (c as { journey?: { days: [number, number] } }).journey?.days ?? [3, 5];
        interactions[`work.${cid}`] = {
          nameKey: 'ia.journey', icon: c.icon ?? 'ui.coin', objects: ['lot_exit'], requires: {}, tags: ['work', 'outdoor'],
          steps: [{ at: 'target', slot: { pose: 'stand' }, anim: 'idle', minutes: jd[1] * 1440, hidden: true }],
        } as InteractionDef;
        continue;
      }
      const minutes = Math.max(60, (c.hours[1] - c.hours[0]) * 60);
      interactions[`work.${cid}`] = {
        nameKey: 'ia.go_work', icon: c.icon ?? 'axe', objects: ['lot_exit'], requires: {}, tags: ['labor', 'duty', 'work'],
        steps: [{ at: 'target', slot: { pose: 'stand' }, anim: 'idle', minutes, hidden: true }],
      } as InteractionDef;
    }
  }
  const userObjects = objectsSchema.parse(raw.objects) as Record<string, ObjectDef>;
  const build = raw.build ? (raw.build as BuildData) : null;
  const { objects, kindMembers, problems: problemsCat } = mergeObjectDefs(userObjects, build, raw.catalog);
  // 레시피 → 제작 상호작용 (작업대 태그 = recipes.json station). 방앗간(mill)은 부지 출구 래빗홀 (사용료는 레시피 산출에 반영)
  const recipes: Record<string, RecipeDef> = Object.fromEntries(Object.entries(((raw.recipes as { recipes?: Record<string, RecipeDef> } | undefined)?.recipes) ?? {}).filter(([k]) => !k.startsWith('$')));
  // 농사 작업 (31-2): 밭/텃밭(field 태그), 과수(orchard 태그) 물건 하나 = 상호작용 한 세트. 씨 뿌리기는 작물마다
  const cropsRaw = raw.crops as { crops?: Record<string, any>; tasks?: Record<string, any> } | undefined;
  if (cropsRaw?.crops && cropsRaw.tasks) {
    const fieldDefs = Object.entries(objects).filter(([, o]) => (o.tags ?? []).includes('field')).map(([id]) => id);
    const orchardDefs = Object.entries(objects).filter(([, o]) => (o.tags ?? []).includes('orchard')).map(([id]) => id);
    const T = cropsRaw.tasks;
    const mk = (id: string, task: string, objs: string[], requires: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
      if (!objs.length) return;
      const t = T[task];
      interactions[id] = {
        nameKey: t.nameKey, icon: FARM_ICON[task] ?? 'plant', objects: objs, requires, tags: [...(t.tags ?? ['labor']), 'farm'],
        steps: [{ at: 'target', slot: { pose: 'stand' }, anim: 'work', minutes: t.minutes.value, needs: { fun: 0.03 } }],
        ...({ skill: t.skill ?? 'farming', farmTask: task } as object), ...extra,
      } as InteractionDef;
    };
    mk('farm.till', 'till', fieldDefs, { targetMax: { tilled: 0, crop: 0 } });
    for (const [cid, c] of Object.entries(cropsRaw.crops)) {
      if (cid.startsWith('$') || c.perennial || !c.seed) continue;
      mk(`farm.sow.${cid}`, 'sow', fieldDefs, { targetMin: { tilled: 1 }, targetMax: { crop: 0 }, stock: { [c.seed.item]: Math.max(1, Math.round(c.seed.perPlot * 0.35)) } }, { nameKey: c.nameKey, icon: c.icon, group: 'sow', crop: cid });
    }
    for (const [cid, c] of Object.entries(cropsRaw.crops)) {
      if (cid.startsWith('$') || !c.perennial) continue;
      mk(`farm.plant.${cid}`, 'sow', orchardDefs, { targetMax: { crop: 0 }, money: Math.round((c.perennial.saplingPrice ?? 24) * 4) }, { nameKey: c.nameKey, icon: c.icon, group: 'sow', crop: cid });
    }
    mk('farm.weed', 'weed', fieldDefs, { targetMin: { weeds: 1 } }, { ads: { fun: 4 }, supportAds: { comfort: 0 } });
    mk('farm.water', 'water', fieldDefs, { targetMin: { drought: 1 } }, { ads: { fun: 2 } });
    mk('farm.fertilize', 'fertilize', fieldDefs, { targetMin: { tilled: 1 }, targetMax: { fertN: 0 }, stock: { manure: 2 } });
    mk('farm.scarecrow', 'scarecrow', fieldDefs, { targetMin: { crop: 1 }, targetMax: { scare: 0 } });
    mk('farm.harvest', 'harvest', [...fieldDefs, ...orchardDefs], { targetMin: { stage: 4 } }, { ads: { fun: 8, hunger: 6 } });
    mk('farm.glean', 'glean', fieldDefs, { targetMin: { glean: 1 } });
  }
  for (const [rid, r] of Object.entries(recipes)) {
    const stations = r.station === 'mill' ? [EXIT_OBJECT_ID] : Object.entries(objects).filter(([, o]) => (o.tags ?? []).includes(r.station)).map(([id]) => id);
    if (!stations.length) continue;
    const stock: Record<string, number> = {};
    for (const [k, n] of Object.entries(r.inputs)) stock[k] = (stock[k] ?? 0) + n;
    for (const [k, n] of Object.entries(r.fuel ?? {})) stock[k] = (stock[k] ?? 0) + n;
    const delta: Record<string, number> = {};
    for (const [k, n] of Object.entries(stock)) delta[k] = -n;
    // 기다리는 레시피(양조, 절임 …)는 산출이 나중 (sim.recipeDone 이 작업대 상태로 처리)
    if (!r.wait) for (const [k, n] of Object.entries(r.outputs)) delta[k] = (delta[k] ?? 0) + n;
    const mill = r.station === 'mill';
    interactions[`recipe.${rid}`] = {
      nameKey: r.nameKey, icon: r.icon, objects: stations, requires: r.wait ? { stock, targetMax: { brewing: 0 } } : { stock },
      tags: r.tags,
      steps: [mill
        ? { at: 'target', slot: { pose: 'stand' }, anim: 'idle', minutes: r.minutes, hidden: true }
        : { at: 'target', slot: { pose: 'stand' }, anim: 'work', minutes: r.minutes, needs: { fun: 0.05 } }],
      effects: { stock: delta },
      ...({ skill: r.skill, recipe: rid, group: r.group } as object),
    } as InteractionDef;
  }
  // 카탈로그 물건: 기반 물건을 대상으로 하는 상호작용에 끼워 넣음 (기능이 같음)
  for (const ia of Object.values(interactions)) {
    const extra: string[] = [];
    for (const o of ia.objects) for (const m of kindMembers.get(o) ?? []) if (!ia.objects.includes(m)) extra.push(m);
    if (extra.length) ia.objects = [...ia.objects, ...extra];
  }
  // 내구도 (23-4): 고장 난 물건은 못 씀 (고장 나도 쓰는 종류: 삐걱거리는 침대, 막힌 굴뚝 화로) + 고치기 상호작용
  if (build) {
    const usable = new Set(Object.keys(build.wear.brokenUsable));
    const kindOf = (id: string) => objects[id]?.kind ?? id;
    const durableIds = Object.keys(objects).filter((id) => objects[id].durable);
    for (const ia of Object.values(interactions)) {
      if (!ia.objects.some((o) => objects[o]?.durable && !usable.has(kindOf(o)))) continue;
      ia.requires = { ...ia.requires, targetMax: { ...(ia.requires.targetMax ?? {}), broken: 0 } };
    }
    // 공사 거들기 (23-3): 가족이 직접 지으면 품삯을 아끼고 목공 경험치
    interactions['construction.work'] = {
      nameKey: 'ia.construct', icon: 'raven:a4477', objects: [SITE_OBJECT_ID], tags: ['labor', 'craft', 'duty'],
      requires: {},
      steps: [{ at: 'target', anim: 'work', minutes: 60, needs: { fun: -0.02 } }],
      effects: {},
      ads: { fun: 4 },
      ...({ skill: build.construction.familySkill } as object),
    } as InteractionDef;
    // 불 끄기 (23-5): 물이 있으면 물통으로, 없으면 흙을 끼얹음 (조금 더 오래)
    interactions['fire.extinguish'] = {
      nameKey: 'ia.extinguish', icon: 'water', objects: [FIRE_OBJECT_ID], tags: ['duty', 'labor', 'brave'],
      requires: {},
      steps: [{ at: 'target', anim: 'work', minutes: build.fire.extinguishMinutes, needs: { fun: -0.2, energy: 0.2 } }],
      effects: {},
      autonomous: false,
      moodlets: [{ id: 'put_out_fire' }],
    } as InteractionDef;
    if (durableIds.length) {
      interactions['obj.repair'] = {
        nameKey: 'ia.repair', icon: 'raven:a4477', objects: durableIds, tags: ['labor', 'craft', 'duty'],
        requires: { targetMin: { wear: 30 } },
        steps: [{ at: 'target', anim: 'work', minutes: build.wear.repairMinutes, needs: { fun: 0.02 } }],
        effects: { targetSet: { wear: 0, broken: 0 } },
        moodlets: [{ id: 'fixed_it' }],
        ads: { fun: 2 },
        adBonusWhen: { targetMin: { broken: 1 }, ads: { comfort: 45 } },
        ...({ skill: build.wear.repairSkill } as object),
      } as InteractionDef;
    }
  }
  const lot = normalizeLot(lotSchema.parse(raw.town ? (raw.town as { lot: unknown }).lot : raw.lot) as LotDef);
  const problems: string[] = [...problemsCat];
  const fenceIds = new Set(Object.keys(build?.fences ?? {}));
  const blockedTerrain = new Set(Object.entries(build?.terrain ?? {}).filter(([, t]) => (t as { walkable?: boolean }).walkable === false).map(([k]) => k));

  // 상호작용 → 물건, 단계 대상, 슬롯 id
  for (const [id, ia] of Object.entries(interactions)) {
    for (const o of ia.objects) if (!objects[o]) problems.push(`${id}: 알 수 없는 물건 ${o}`);
    ia.steps.forEach((s, si) => {
      const stepObjs: string[] = s.at === 'target' ? ia.objects : typeof s.at === 'object' && 'object' in s.at ? [s.at.object] : [];
      if (typeof s.at === 'object' && 'object' in s.at && !objects[s.at.object]) problems.push(`${id}: 단계 ${si} 대상 ${s.at.object} 없음`);
      if (typeof s.slot === 'string') {
        for (const o of stepObjs) {
          const def = objects[o];
          if (def && def.slots.length && !def.slots.some((x) => x.id === s.slot)) problems.push(`${id}: 단계 ${si} 슬롯 "${s.slot}" 이 ${o} 에 없음`);
        }
      }
    });
  }

  // 부지: 범위, 겹침, 벽 위 배치, 회전 정수
  const rows = lot.rows ?? lot.h;
  const occ = new Int32Array(lot.w * rows).fill(-1);
  lot.objects.forEach((o, oi) => {
    const def = objects[o.id];
    if (!def) {
      problems.push(`부지 ${lot.id}: 물건 ${o.id} 정의 없음`);
      return;
    }
    if (o.rot !== undefined && !Number.isInteger(o.rot)) problems.push(`부지 ${lot.id}: ${o.id} (${o.x},${o.y}) 회전 ${o.rot} 은 정수여야 함`);
    const odd = (o.rot ?? 0) % 2 !== 0;
    const w = odd ? def.footprint.h : def.footprint.w;
    const h = odd ? def.footprint.w : def.footprint.h;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x = o.x + dx;
        const y = o.y + dy;
        if (x < 0 || y < 0 || x >= lot.w || y >= rows) {
          problems.push(`부지 ${lot.id}: ${o.id} (${o.x},${o.y}) 발자국이 부지 밖`);
          return;
        }
        const i = y * lot.w + x;
        if (def.wallMounted) continue;
        if (lot.walls[i] && def.blocks) problems.push(`부지 ${lot.id}: ${o.id} (${o.x},${o.y}) 가 벽 위에 놓임`);
        if (def.blocks) {
          if (occ[i] >= 0) problems.push(`부지 ${lot.id}: ${o.id} (${o.x},${o.y}) 가 ${lot.objects[occ[i]].id} 와 겹침`);
          occ[i] = oi;
        }
      }
    }
  });
  for (const op of lot.openings) {
    if (op.x < 0 || op.y < 0 || op.x >= lot.w || op.y >= rows) problems.push(`부지 ${lot.id}: 개구부 (${op.x},${op.y}) 가 부지 밖`);
    else if (!lot.walls[op.y * lot.w + op.x]) problems.push(`부지 ${lot.id}: 개구부 (${op.x},${op.y}) 자리에 벽이 없음`);
  }
  for (const ex of lot.exits ?? []) {
    if (ex.x < 0 || ex.y < 0 || ex.x >= lot.w || ex.y >= rows) problems.push(`부지 ${lot.id}: 출구 (${ex.x},${ex.y}) 가 부지 밖`);
  }

  let compiled: Compiled | null = null;
  try {
    compiled = compile(interactions, balance);
  } catch (e) {
    problems.push(String(e instanceof Error ? e.message : e));
  }
  let inner: InnerData | null = null;
  if (raw.inner) {
    try {
      inner = compileInner(raw.inner);
    } catch (e) {
      problems.push(`내면 데이터: ${String(e instanceof Error ? e.message : e)}`);
    }
  }
  if (problems.length || !compiled) throw new Error(`데이터 오류\n${problems.join('\n')}`);
  const social = Object.fromEntries(Object.entries(raw.social ? socialsSchema.parse(raw.social).interactions : {}).map(([id, s]) => [id, normalizeSocial(s)]));
  const relations = raw.relations ? relationsSchema.parse(raw.relations) : null;
  const neighbors = raw.neighbors ? neighborsSchema.parse(raw.neighbors).neighbors : [];
  if (inner) {
    for (const [id, s] of Object.entries(social)) {
      for (const o of [s.success, s.failure]) for (const m of [...o.moodlets, ...o.targetMoodlets]) if (!inner.moodlets.has(m.id)) problems.push(`사회 ${id}: 무드렛 ${m.id} 없음`);
    }
    if (relations && !inner.moodlets.has(relations.familyMeal.moodlet)) problems.push(`관계: 가족 식사 무드렛 ${relations.familyMeal.moodlet} 없음`);
    if (problems.length) throw new Error(`데이터 오류\n${problems.join('\n')}`);
  }
  const economy = raw.economy ? (raw.economy as Record<string, unknown>) : null;
  const items = { ...FALLBACK_ITEMS, ...(((raw.items as { items?: Record<string, ItemDef> } | undefined)?.items) ?? {}) };
  const skills = raw.skills ? (raw.skills as SkillsData) : null;
  const crops = raw.crops ? (raw.crops as Record<string, any>) : null;
  const careerRules = ((raw.careers as { rules?: { rabbitholeNeeds?: Record<string, number> } } | undefined)?.rules) ?? null;
  return { needs, balance, interactions, objects, lot, social, relations, neighbors, economy, items, skills, careers, recipes, crops, careerRules, build, fenceIds, blockedTerrain,
    town: raw.town ? { def: raw.town as import('../town/town').TownDef, people: (raw.people as import('../town/town').PeopleData) ?? null, schedules: (raw.schedules as import('../town/town').SchedulesData) ?? null } : null,
    story: (raw.story as StoryData) ?? null,
    family: raw.family ?? {},
    compiled, inner, stress: raw.inner ? (raw.inner.stress as StressData) : null };
}
