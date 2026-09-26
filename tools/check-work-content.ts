/**
 * M4 "일과 농사" 콘텐츠 검사 (계약 artifacts/contracts-m4.md 4, 5, 6, 7절 / GDD 17-2, 17-7, 31장).
 * - 형식(zod, strict): src/data/careers.json, src/data/crops.json
 * - 직업 16 (id, 유형, 신분, 핵심 스킬이 17-2 표와 같음) + NPC 역할 10 (npc_role: true)
 * - 래빗홀 등급 일당 = economy.income.wageBase × 4파딩 × 1.5^(등급-1) (17-7). 다른 일당 사다리도 × 1.5
 * - 장인 경로 4등급, 도제 10일 / 직인 8일 (lifespan). 여정 등급 보정이 economy 의 rankBonus 와 같음
 * - 일터 사건 카드 직업마다 2개 이상 (대장장이 4개 이상), 선택지 효과 필드와 범위, 무드렛/스킬/관계 대상 존재,
 *   선택지 문구가 결과를 미리 말하지 않음, 판정(check) 이 있으면 실패 효과도 있음
 * - 현장형 주문 품목이 약속한 레시피 결과 품목 id 안. recipes.json 이 있으면 결과 품목과 교차 확인 (없으면 경고)
 * - 새 무드렛(newMoodlets)이 moodlets.json 형식이고 기존 id 와 겹치지 않음
 * - 작물 15 (31-3 표의 파종/수확 계절), 계절 진행률 성장 모의로 익는 계절 확인, 한 해 수확 횟수,
 *   달력 1년 수확량이 economy.json plotYearYield 의 ±10% (곡물 180, 채소 36), 작업 8종 (31-2 시간), 재해 8종 (31-5)
 * - i18n 누락 0 (src/i18n/ko/*.json 합본), ko/work.json 문구에 숫자/영문 없음, 수위/실존 종교 금지어
 * 사용: npx tsx tools/check-work-content.ts           (검사)
 *       npx tsx tools/check-work-content.ts --selftest (일부러 망가뜨린 데이터를 잡는지 음성 테스트)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { z } from 'zod';

const json = <T = any>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

// ── 계약 목록 ─────────────────────────────────────────────
const CAREERS: Record<string, { type: 'rabbithole' | 'onsite' | 'journey'; estates: string[]; exactEstates?: boolean; skills: string[]; ranks: number; guild?: boolean }> = {
  field_hand: { type: 'rabbithole', estates: ['serf', 'freeman'], exactEstates: true, skills: ['fitness', 'farming'], ranks: 3 },
  mill_hand: { type: 'rabbithole', estates: ['freeman'], skills: ['fitness', 'reckoning'], ranks: 2 },
  guard: { type: 'rabbithole', estates: ['freeman'], skills: ['martial', 'fitness'], ranks: 3 },
  clerk: { type: 'rabbithole', estates: ['freeman'], skills: ['reading', 'reckoning', 'latin'], ranks: 3 },
  trader: { type: 'journey', estates: ['merchant'], skills: ['reckoning', 'storytelling'], ranks: 3 },
  monk: { type: 'rabbithole', estates: ['clergy'], exactEstates: true, skills: ['faith', 'latin'], ranks: 3 },
  blacksmith: { type: 'onsite', estates: ['freeman', 'artisan'], skills: ['smithing', 'fitness'], ranks: 4, guild: true },
  baker: { type: 'onsite', estates: ['freeman', 'artisan'], skills: ['baking'], ranks: 4, guild: true },
  brewer: { type: 'onsite', estates: ['freeman', 'artisan'], skills: ['brewing'], ranks: 4, guild: true },
  tailor: { type: 'onsite', estates: ['freeman', 'artisan'], skills: ['needlework'], ranks: 4, guild: true },
  carpenter: { type: 'onsite', estates: ['freeman', 'artisan'], skills: ['carpentry'], ranks: 4, guild: true },
  healer: { type: 'onsite', estates: ['freeman'], skills: ['herbalism', 'medicine'], ranks: 3 },
  minstrel: { type: 'onsite', estates: ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'], exactEstates: true, skills: ['music', 'singing', 'storytelling'], ranks: 3 },
  innkeeper: { type: 'onsite', estates: ['freeman'], skills: ['cooking', 'brewing', 'storytelling'], ranks: 2 },
  priest: { type: 'onsite', estates: ['clergy'], exactEstates: true, skills: ['faith', 'latin'], ranks: 4 },
  knight: { type: 'onsite', estates: ['knight'], skills: ['martial', 'riding'], ranks: 3 },
};
/** 자유민+ (17-2): 농노는 안 됨 */
const NO_SERF = ['mill_hand', 'guard', 'clerk', 'healer', 'innkeeper', 'blacksmith', 'baker', 'brewer', 'tailor', 'carpenter'];
const NPC_ROLES = ['servant', 'bailiff', 'messenger', 'matchmaker', 'moneylender', 'midwife', 'herbalist', 'tutor', 'mason', 'leatherworker'];
const SKILLS = [
  'cooking', 'baking', 'brewing', 'needlework', 'farming', 'animal_care', 'smithing', 'carpentry', 'masonry', 'leatherwork',
  'reading', 'reckoning', 'latin', 'herbalism', 'medicine', 'music', 'singing', 'dance', 'storytelling',
  'fitness', 'martial', 'archery', 'riding', 'faith', 'arcana',
];
const ESTATES = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'] as const;
const SCALES = ['absolute', 'season', 'lifespan', 'per_life'] as const;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
const WEATHER = ['clear', 'cloudy', 'rain', 'heavy_rain', 'thunderstorm', 'fog', 'snow', 'blizzard'] as const;
const EMOTIONS = ['happy', 'energized', 'focused', 'excited', 'inspired', 'pious', 'sad', 'angry', 'tense', 'ashamed'] as const;
const MOOD_SOURCES = ['need', 'env', 'social', 'event', 'memory', 'trait', 'weather', 'faith', 'health', 'season'] as const;
const NEEDS = ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social', 'warmth', 'comfort'] as const;
const PLACES = ['lord_fields', 'mill', 'castle', 'monastery', 'road', 'workshop_row', 'clinic', 'inn', 'church', 'market', 'village', 'well', 'home', 'employer_home', 'forest', 'construction_site'] as const;
/** recipes.json 작업대 태그 (계약 2절) */
const STATION_TAGS = ['hearth', 'oven', 'prep_counter', 'brew_vat', 'spinning_wheel', 'loom', 'workbench', 'forge', 'anvil', 'churn', 'smokehouse', 'salting_tub', 'mill', 'press'];
/** 아직 objects.json 에 없는 일터 태그 (리드가 물건에 태그를 붙여야 함) */
const NEW_WORKPLACE_TAGS = ['stage', 'altar', 'training_post'];
/** 리드가 작업자 A/B 에게 준 현장형 주문 품목 id (recipes.json 결과 품목) */
const ORDER_ITEMS: Record<string, string[]> = {
  blacksmith: ['horseshoes', 'nails', 'sickle', 'hoe', 'knife', 'hinge', 'pot', 'plowshare'],
  baker: ['bread', 'dark_bread', 'honey_cake', 'meat_pie'],
  brewer: ['ale', 'beer', 'cider', 'mead'],
  tailor: ['cloth', 'tunic', 'cloak', 'mend_clothes'],
  carpenter: ['stool', 'chest', 'bench_wood', 'cart_wheel'],
  healer: ['salve', 'tonic'],
  innkeeper: ['ale', 'beer', 'cider', 'mead', 'bread', 'dark_bread', 'meat_pie', 'honey_cake'],
};
const ALL_ORDER_ITEMS = [...new Set(Object.values(ORDER_ITEMS).flat())];
/** 약속한 수확물 품목 id (items.json, 작업자 A) */
const HARVEST_ITEMS = ['wheat', 'barley', 'oats', 'rye', 'beans', 'flax', 'turnip', 'cabbage', 'onion', 'leek', 'herbs', 'medicinal_herbs', 'moonwort', 'grapes', 'apples', 'pears'];
/** 게임이 이미 쓰는 재고 키 (계약 1절) */
const EXISTING_STOCK = ['firewood', 'water', 'ingredients', 'flour', 'bread', 'ale', 'preserves', 'herbs', 'yarn'];
/** 31-3 작물 표 (id → 파종 계절, 수확 계절, 분류) */
const CROPS: Record<string, { sow: string[]; harvest: string[]; kinds: string[] }> = {
  wheat: { sow: ['autumn'], harvest: ['summer'], kinds: ['grain'] },
  barley: { sow: ['spring'], harvest: ['summer'], kinds: ['grain'] },
  oats: { sow: ['spring'], harvest: ['summer'], kinds: ['grain'] },
  rye: { sow: ['autumn'], harvest: ['summer'], kinds: ['grain'] },
  beans: { sow: ['spring'], harvest: ['summer'], kinds: ['legume'] },
  flax: { sow: ['spring'], harvest: ['summer'], kinds: ['fiber'] },
  turnip: { sow: ['spring', 'summer'], harvest: ['summer', 'autumn'], kinds: ['vegetable'] },
  cabbage: { sow: ['spring', 'summer'], harvest: ['summer', 'autumn'], kinds: ['vegetable'] },
  onion: { sow: ['spring', 'summer'], harvest: ['summer', 'autumn'], kinds: ['vegetable'] },
  leek: { sow: ['spring', 'summer'], harvest: ['summer', 'autumn'], kinds: ['vegetable'] },
  herbs: { sow: ['spring'], harvest: ['summer'], kinds: ['herb'] },
  medicinal_herbs: { sow: ['spring'], harvest: ['summer', 'autumn'], kinds: ['medicinal'] },
  moonwort: { sow: ['summer'], harvest: ['autumn'], kinds: ['special'] },
  grapes: { sow: [], harvest: ['autumn'], kinds: ['orchard'] },
  apples: { sow: [], harvest: ['autumn'], kinds: ['orchard'] },
  pears: { sow: [], harvest: ['autumn'], kinds: ['orchard'] },
};
const CROP_COUNT = 15; // 31-3 표 15종 (사과/배는 한 줄이지만 나무가 달라 따로 셈: 16 항목 → 계약은 15종 이상)
/** 31-2 작업 시간 (중 구획, 분) */
const TASKS: Record<string, number> = { till: 180, sow: 60, weed: 60, water: 60, fertilize: 60, scarecrow: 30, harvest: 180, glean: 60 };
const DISASTERS = ['crows', 'voles', 'pests', 'mildew', 'drought', 'hail', 'flood', 'goblins'];
/** 선택지 문구에 쓰면 결과를 미리 말하는 것으로 보는 말 */
const REVEAL_WORDS = ['성과', '파딩', '동화', '은화', '금화', '호감', '관계가', '경험치', '확률', '성공하면', '실패하면', '평판', '업보', '+', '%'];
const BANNED_KO = ['자살', '자해', '목을 매', '고문', '화형', '강간', '겁탈', '성기', '나체', '알몸', '성행위', '성교', '섹스', '신음', '애무', '예수', '그리스도', '성모', '마리아', '알라', '부처', '석가', '무함마드', '여호와', '야훼', '노예', '성경', '교황'];
const PLACEHOLDERS = /\{(name|crop)\}/g;

// ── 스키마 ────────────────────────────────────────────────
const snake = z.string().regex(/^[a-z][a-z0-9_]*$/, 'snake_case');
const dur = (scales: readonly string[] = SCALES) => z.object({ value: z.number().positive(), scale: z.enum(scales as [string, ...string[]]) }).strict();
const range = (int = true) => z.tuple([int ? z.number().int() : z.number(), int ? z.number().int() : z.number()]).refine(([a, b]) => a <= b, '범위 [작은 값, 큰 값]');
const rel = z.object({ target: snake, friendship: z.number().int().min(-30).max(30) }).strict();
const effects = z.object({
  performance: z.number().int().min(-10).max(10).optional(),
  money: z.number().int().min(-60).max(60).optional(),
  moodlets: z.array(snake).optional(),
  relationship: rel.optional(),
  skillXp: z.record(z.string(), z.number().int().positive().max(60)).optional(),
  items: z.record(z.string(), z.number().int().min(-10).max(10)).optional(),
  karma: z.number().int().min(-5).max(5).optional(),
  church: z.number().int().min(-5).max(5).optional(),
  fame: z.number().int().min(-5).max(5).optional(),
  tradeMult: z.number().min(0.5).max(1.5).optional(),
  ordersLate: z.number().int().min(1).max(3).optional(),
  cropLoss: z.number().min(0).max(1).optional(),
}).strict();
const option = z.object({
  id: snake, textKey: z.string(), effects,
  check: z.object({ skill: z.string(), level: z.number().int().min(0).max(10) }).strict().optional(),
  failEffects: effects.optional(),
}).strict();
const event = z.object({
  id: snake, textKey: z.string(), options: z.array(option).min(2).max(4),
  rating: z.enum(['all', '15', '17']).optional(), cooldown: dur(['absolute']).optional(), perLife: z.number().int().min(1).optional(),
}).strict();
const rankS = z.object({
  nameKey: z.string(), nameKeyF: z.string().optional(),
  wage: z.number().int().min(0).optional(), share: z.number().min(0).max(1).optional(), feeMult: z.number().positive().optional(),
  rankBonus: z.number().min(0).max(0.5).optional(), board: z.boolean().optional(), xpBonus: z.number().min(0).max(1).optional(),
  advance: z.enum(['performance', 'time', 'masterpiece', 'election', 'appointment']).optional(), minDays: dur(['lifespan']).optional(),
  guildDuesShare: z.number().min(0).max(1).optional(), rabbithole: z.boolean().optional(),
}).strict();
const hours = z.tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)]);
const days = z.array(z.number().int().min(0).max(6)).min(1);
const orderPool = z.object({ item: snake, qty: range(), weight: z.number().positive(), minRank: z.number().int().min(0).optional() }).strict();
const service = z.object({
  id: snake, recipe: snake.optional(), nameKey: z.string(), skill: z.string(), minutes: z.number().int().positive(), fee: range(),
  places: z.array(z.enum(PLACES)).min(1), minRank: z.number().int().min(0).optional(),
}).strict();
const careerS = z.object({
  nameKey: z.string(), nameKeyF: z.string().optional(), descKey: z.string(), icon: z.string(),
  type: z.enum(['rabbithole', 'onsite', 'journey']),
  estates: z.array(z.enum(ESTATES)).min(1), literacy: z.boolean(), skills: z.array(z.string()).min(1),
  workplace: z.string(), stations: z.array(z.string()).optional(), place: z.enum(PLACES),
  hours, days, ranks: z.array(rankS).min(2), promoteAt: z.number().positive(),
  patrol: z.boolean().optional(),
  rabbitholeNeeds: z.partialRecord(z.enum(NEEDS), z.number().min(0).max(3)).optional(),
  orders: z.object({ perDay: range(), feeMult: range(false), pool: z.array(orderPool).min(1) }).strict().optional(),
  services: z.object({ perDay: range(), pool: z.array(service).min(1) }).strict().optional(),
  journey: z.object({
    days: range(), daysScale: z.literal('absolute'), prepDays: dur(['absolute']), minInvest: z.number().int().positive(),
    formula: z.literal('economy.income.trade'), perfPerTrip: z.object({ profit: z.number().int(), loss: z.number().int() }).strict(),
  }).strict().optional(),
  campaign: z.object({ days: range(), daysScale: z.literal('absolute'), source: snake }).strict().optional(),
  dailyTask: z.object({ skill: z.string(), key: z.string() }).strict().optional(),
  events: z.array(event),
}).strict();
const roleS = z.object({
  nameKey: z.string(), npc_role: z.literal(true), uses: z.array(z.string().regex(/^\d+-\d+$/)).min(1),
  type: z.enum(['schedule', 'rabbithole']), estates: z.array(z.enum(ESTATES)).min(1), skills: z.array(z.string()).min(1),
  subroles: z.record(snake, z.object({ nameKey: z.string(), skill: z.string() }).strict()).optional(),
  schedule: z.object({ hours, days, place: z.enum(PLACES), onCall: z.boolean().optional() }).strict(),
  pay: z.object({
    wage: z.number().int().positive().optional(), board: z.boolean().optional(), payEvery: dur(['absolute']).optional(),
    perTask: z.number().int().positive().optional(), dowryShare: z.number().min(0).max(0.5).optional(),
    interest: z.string().optional(), sells: z.array(snake).optional(), paidBy: snake,
  }).strict(),
  suspicion: z.boolean().optional(), ledgerProducer: z.boolean().optional(),
}).strict();
const moodletS = z.object({
  nameKey: z.string(), descKey: z.string(), icon: z.string(), emotion: z.enum(EMOTIONS), strength: z.number().int().min(1).max(3),
  duration: dur().optional(), while: z.string().optional(), permanent: z.literal(true).optional(),
  stack: z.enum(['replace', 'refresh', 'stack']), max: z.number().int().min(2).max(5).optional(),
  source: z.enum(MOOD_SOURCES), group: snake.optional(),
  fade: z.array(z.tuple([z.number().positive(), z.number().int().min(1).max(2)])).optional(),
  extra: z.array(z.object({ emotion: z.enum(EMOTIONS), strength: z.number().int().min(1).max(3) }).strict()).optional(),
  tags: z.array(z.string()).optional(),
}).strict();
const careersFile = z.object({
  $comment: z.string().optional(),
  rules: z.object({
    $comment: z.string().optional(),
    attitudes: z.record(z.enum(['hard', 'normal', 'slack']), z.object({ nameKey: z.string(), performance: z.number().int(), xpMult: z.number().positive(), needMult: z.partialRecord(z.enum(NEEDS), z.number().min(0)) }).strict()),
    performance: z.object({
      skillPerLevel: z.number(), dailyTaskDone: z.number(), mood: z.partialRecord(z.enum(EMOTIONS), z.number()),
      promoteScale: z.literal('lifespan'), nextRankMult: z.number().positive(), warnAt: z.number(), fireAt: z.number(), wageMod: z.string(),
    }).strict(),
    rabbitholeNeeds: z.record(z.enum(NEEDS), z.number().min(0).max(3)),
    onsite: z.object({
      $comment: z.string().optional(), deadline: dur(['absolute']), qualityStep: z.number(),
      performance: z.record(z.string(), z.number().int()),
    }).strict(),
    guildPath: z.object({
      $comment: z.string().optional(),
      apprentice: z.object({ days: dur(['lifespan']), wage: z.literal(0), xpBonus: z.number() }).strict(),
      journeyman: z.object({ minDays: dur(['lifespan']) }).strict(),
      master: z.object({ masterpiece: z.literal(true), guildFee: dur(['lifespan']), estate: z.literal('artisan') }).strict(),
    }).strict(),
    events: z.object({
      chancePerShift: z.number().min(0).max(1), cooldown: dur(['absolute']), perLife: z.number().int().min(1), rating: z.enum(['all', '15', '17']),
      check: z.object({ base: z.number(), perLevel: z.number(), min: z.number(), max: z.number() }).strict(),
      relationshipTargets: z.array(snake).min(1),
    }).strict(),
  }).strict(),
  careers: z.record(snake, careerS),
  npcRoles: z.record(snake, roleS),
  newMoodlets: z.record(snake, moodletS).optional(),
}).strict();

const disasterS = z.object({
  $comment: z.string().optional(), nameKey: z.string(), noteKey: z.string(),
  chance: z.object({ value: z.number().positive(), scale: z.enum(SCALES), per: z.string() }).strict(),
  magicSetting: z.object({ off: z.number(), rare: z.number(), common: z.number() }).strict().optional(),
  loss: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
  lossPerDay: z.number().min(0).max(1).optional(), lossMax: z.number().min(0).max(1).optional(),
  stages: z.array(z.number().int().min(0).max(4)).optional(), seasons: z.array(z.enum(SEASONS)).optional(), hours: hours.optional(),
  village: z.boolean().optional(),
  condition: z.object({ wetStreak: dur(['absolute']).optional(), dryStreak: dur(['absolute']).optional(), weather: z.array(z.enum(WEATHER)).optional(), plot: z.enum(['riverside']).optional() }).strict().optional(),
  duration: dur(['absolute']).optional(), endOnRain: z.number().min(0).max(1).optional(),
  preventedBy: z.object({ task: snake, chanceMult: z.number().min(0).max(1) }).strict().optional(),
  mitigatedBy: z.object({ task: snake.optional(), object: snake.optional(), animal: snake.optional(), chanceMult: z.number().min(0).max(1) }).strict().optional(),
  fertility: z.number().int().optional(), moodlets: z.array(snake).optional(),
  caughtChance: z.number().min(0).max(1).optional(), caughtEvent: snake.optional(),
}).strict();
const cropS = z.object({
  nameKey: z.string(), descKey: z.string(), icon: z.string(),
  kind: z.enum(['grain', 'legume', 'vegetable', 'herb', 'medicinal', 'fiber', 'orchard', 'special']),
  sow: z.array(z.enum(SEASONS)), growSeasons: dur(['season']), harvestSeasons: z.array(z.enum(SEASONS)).min(1),
  yield: z.object({ item: snake, perMediumPlot: z.number().positive(), scale: z.literal('season') }).strict(),
  cropsPerYear: z.number().int().min(1).max(3),
  garden: z.boolean(), field: z.boolean(), fertilityCost: z.number().int().min(-30).max(30),
  seed: z.object({ item: snake, perPlot: z.number().int().positive() }).strict().nullable(),
  skillLevel: z.number().int().min(0).max(10), sprite: snake, disasters: z.array(snake),
  skill: z.string().optional(),
  sowWindow: z.object({ festival: snake, hours }).strict().optional(),
  magic: z.object({ off: z.literal('unavailable'), suspicion: z.boolean() }).strict().optional(),
  seedSource: z.array(snake).optional(),
  perennial: z.object({ cycleStart: z.enum(SEASONS), matureSeasons: dur(['season']), saplingPrice: z.number().int().positive() }).strict().optional(),
  estates: z.array(z.enum(ESTATES)).optional(),
}).strict();
const taskS = z.object({
  nameKey: z.string(), descKey: z.string(), minutes: dur(['absolute']), skill: z.literal('farming'), tags: z.array(z.string()),
  when: z.string(), effect: z.record(z.string(), z.unknown()),
  withPlow: dur(['absolute']).optional(), seasons: z.string().optional(), requires: z.object({ stock: z.union([z.string(), z.record(z.string(), z.number().int().positive())]) }).strict().optional(),
  maxPerCrop: z.number().int().positive().optional(), once: z.boolean().optional(),
  helpers: z.object({ max: z.number().int().min(1), speedPerHelper: z.number().positive() }).strict().optional(),
  window: dur(['absolute']).optional(), right: z.string().optional(), kinds: z.array(z.string()).optional(),
}).strict();
const cropsFile = z.object({
  $comment: z.string().optional(),
  plotSizes: z.record(z.enum(['small', 'medium', 'large', 'garden']), z.object({ work: z.number().positive(), yield: z.number().positive(), $comment: z.string().optional() }).strict()),
  growth: z.object({
    stages: z.literal(5), stageKeys: z.array(z.string()).length(5), winterMult: z.number().min(0).max(1),
    weatherMult: z.record(z.enum(WEATHER), z.number().min(0)), sowRule: z.literal('ripen_in_harvest_seasons'), $sowRule: z.string().optional(),
    weeds: z.object({ chancePerDay: dur(['absolute']), carePerDay: z.number(), careMin: z.number() }).strict(),
    ripeHold: dur(['absolute']), overripeLossPerDay: z.number().min(0).max(1),
  }).strict(),
  care: z.object({ $comment: z.string().optional(), min: z.number(), max: z.number() }).strict(),
  skill: z.object({ yieldBase: z.number(), yieldPerLevel: z.number(), speedPerLevel: z.number(), speedMin: z.number(), forecastLevel: z.number().int(), qualityLevels: z.array(z.number().int()).length(4) }).strict(),
  fertility: z.object({
    $comment: z.string().optional(), min: z.literal(0), max: z.literal(100), start: z.number().min(0).max(100),
    repeatPenalty: z.number().int().min(0), fallowPerSeason: z.number().positive(),
    yieldCurve: z.array(z.tuple([z.number().min(0).max(100), z.number().positive()])).min(2),
    rotation: z.object({ cycle: z.array(z.string()).min(2), commonFields: z.boolean(), breachEvent: snake }).strict(),
  }).strict(),
  crops: z.record(snake, cropS),
  tasks: z.record(snake, taskS),
  disasters: z.record(snake, disasterS),
  events: z.array(event),
}).strict();

// ── 입력 ──────────────────────────────────────────────────
interface Input {
  careers: any; crops: any; economy: any;
  moodlets: Record<string, unknown>; objectTags: Set<string>; icons: Set<string>;
  ko: Record<string, string>; koWork: Record<string, string>;
  items: Record<string, { base?: number; icon?: string }> | null; recipeOutputs: Set<string> | null; serviceRecipes: Set<string> | null; skills: Set<string> | null;
}

function load(): Input {
  const P = {
    careers: 'src/data/careers.json', crops: 'src/data/crops.json', economy: 'src/data/economy.json',
    moodlets: 'src/data/moodlets.json', moodletsM3: 'src/data/moodlets_m3.json', objects: 'src/data/objects.json',
    atlas: 'src/data/ui/atlas.json', koWork: 'src/i18n/ko/work.json',
  };
  for (const p of Object.values(P)) if (!existsSync(p)) { console.error('오류: 파일 없음', p); process.exit(1); }
  const objectTags = new Set<string>();
  const objs = json(P.objects);
  for (const o of Object.values<any>(objs.objects ?? objs)) if (o && Array.isArray(o.tags)) o.tags.forEach((t: string) => objectTags.add(t));
  const ko: Record<string, string> = {};
  for (const f of readdirSync('src/i18n/ko')) if (f.endsWith('.json')) Object.assign(ko, json(`src/i18n/ko/${f}`));
  const items = existsSync('src/data/items.json') ? json('src/data/items.json').items : null;
  let recipeOutputs: Set<string> | null = null;
  let serviceRecipes: Set<string> | null = null;
  if (existsSync('src/data/recipes.json')) {
    recipeOutputs = new Set();
    serviceRecipes = new Set();
    for (const [id, r] of Object.entries<any>(json('src/data/recipes.json').recipes)) {
      Object.keys(r.outputs ?? {}).forEach((k) => recipeOutputs!.add(k));
      if (r.service) serviceRecipes.add(id);
    }
  }
  const skills = existsSync('src/data/skills.json') ? new Set(Object.keys(json('src/data/skills.json').skills)) : null;
  return {
    careers: json(P.careers), crops: json(P.crops), economy: json(P.economy),
    moodlets: { ...json(P.moodlets).moodlets, ...json(P.moodletsM3).moodlets },
    objectTags, icons: new Set(Object.keys(json(P.atlas).sprites)), ko, koWork: json(P.koWork),
    items, recipeOutputs, serviceRecipes, skills,
  };
}

// ── 성장 모의 (31-4: 계절 진행률, 겨울 winterMult) ─────────
const SEASON_IDX: Record<string, number> = { spring: 0, summer: 1, autumn: 2, winter: 3 };
/** 계절 si 의 진행률 frac(0~1) 에 심어 need 계절어치 자라면 익는 시점 (누적 계절 수, 시작 기준 절대 위치) */
function ripenAt(si: number, frac: number, need: number, winterMult: number): number {
  let pos = si + frac;
  let left = need;
  for (let guard = 0; guard < 40; guard++) {
    const s = Math.floor(pos + 1e-9) % 4;
    const rate = s === 3 ? winterMult : 1;
    const room = Math.floor(pos + 1e-9) + 1 - pos;
    if (rate * room >= left - 1e-9) return pos + left / rate;
    left -= rate * room;
    pos += room;
  }
  return Infinity;
}
const seasonOf = (pos: number) => SEASONS[Math.floor(pos + 1e-9) % 4];
/** 달력 1년(첫 파종 계절 시작부터 4계절) 안에 몇 번 거둘 수 있는지: 익으면 바로 다음 파종 (파종 창 안, 익는 계절이 harvestSeasons 안일 때만) */
function cropsPerYear(crop: any, winterMult: number): number {
  if (!crop.sow.length) return 1;
  const first = Math.min(...crop.sow.map((s: string) => SEASON_IDX[s]));
  let pos = first;
  let n = 0;
  const end = first + 4;
  for (let guard = 0; guard < 8 && pos < end; guard++) {
    const s = seasonOf(pos);
    if (!crop.sow.includes(s)) {
      // 다음 파종 창으로
      let next = Math.floor(pos) + 1;
      while (!crop.sow.includes(SEASONS[next % 4]) && next < end) next++;
      pos = next;
      if (pos >= end) break;
      continue;
    }
    const r = ripenAt(Math.floor(pos) % 4, pos - Math.floor(pos), crop.growSeasons.value, winterMult) + Math.floor(pos) - (Math.floor(pos) % 4);
    if (!crop.harvestSeasons.includes(seasonOf(r))) break; // sowRule: 익는 계절이 밖이면 못 심음
    if (r > end + 1) break;
    n++;
    pos = r;
  }
  return n;
}

// ── 검사 본체 ─────────────────────────────────────────────
export function check(d: Input): { errors: string[]; warns: string[]; info: string[] } {
  const errors: string[] = [];
  const warns: string[] = [];
  const info: string[] = [];
  const usedKeys = new Set<string>();
  const key = (where: string, k: string) => { usedKeys.add(k); if (!(k in d.ko)) errors.push(`${where}: i18n 키 없음 ${k}`); };
  const skill = (where: string, s: string) => {
    if (!SKILLS.includes(s)) errors.push(`${where}: 스킬 ${s} 는 17-1 의 25개가 아님`);
    else if (d.skills && !d.skills.has(s)) errors.push(`${where}: 스킬 ${s} 가 skills.json 에 없음`);
  };
  const icon = (where: string, i: string) => { if (!d.icons.has(i) && !/^raven:a\d+$/.test(i)) warns.push(`${where}: 아이콘 ${i} 가 atlas 에 없음 (리드가 아틀라스에 추가)`); };

  // 스키마
  const cr = careersFile.safeParse(d.careers);
  if (!cr.success) for (const i of cr.error.issues.slice(0, 40)) errors.push(`careers 스키마: ${i.path.join('.')} ${i.message}`);
  const cp = cropsFile.safeParse(d.crops);
  if (!cp.success) for (const i of cp.error.issues.slice(0, 40)) errors.push(`crops 스키마: ${i.path.join('.')} ${i.message}`);
  if (!cr.success || !cp.success) return { errors, warns, info };
  const C = cr.data;
  const F = cp.data;

  // 새 무드렛
  const moodlets: Record<string, unknown> = { ...d.moodlets };
  for (const [id, m] of Object.entries(C.newMoodlets ?? {})) {
    if (d.moodlets[id]) errors.push(`newMoodlets.${id}: moodlets.json 에 이미 있는 id`);
    moodlets[id] = m;
    key(`newMoodlets.${id}`, m.nameKey); key(`newMoodlets.${id}`, m.descKey); icon(`newMoodlets.${id}`, m.icon);
    const n = (d.ko[m.nameKey] ?? '').replace(/\s/g, '');
    if (n && (n.length < 2 || n.length > 8)) errors.push(`newMoodlets.${id}: 이름 "${d.ko[m.nameKey]}" 은 2~8자`);
    if (!m.duration && !m.while && !m.permanent) errors.push(`newMoodlets.${id}: duration/while/permanent 중 하나 필요`);
  }

  // 사건 카드 공통
  const eventIds = new Set<string>();
  const relTargets = new Set([...C.rules.events.relationshipTargets, 'neighbor']);
  const knownStock = new Set([...EXISTING_STOCK, ...HARVEST_ITEMS, ...ALL_ORDER_ITEMS]);
  function checkEffects(where: string, e: z.infer<typeof effects>, ctx: { journey: boolean; orders: boolean; farm: boolean }) {
    for (const m of e.moodlets ?? []) if (!moodlets[m]) errors.push(`${where}: 무드렛 ${m} 가 moodlets.json/moodlets_m3.json/newMoodlets 에 없음`);
    if (e.relationship && !relTargets.has(e.relationship.target)) errors.push(`${where}: 관계 대상 ${e.relationship.target} 가 rules.events.relationshipTargets 에 없음`);
    for (const s of Object.keys(e.skillXp ?? {})) skill(where, s);
    for (const it of Object.keys(e.items ?? {})) {
      if (d.items) { if (!d.items[it]) errors.push(`${where}: 재고 품목 ${it} 가 items.json 에 없음`); }
      else if (!knownStock.has(it)) errors.push(`${where}: 재고 품목 ${it} 가 약속한 품목 id 목록에 없음`);
    }
    if (e.tradeMult !== undefined && !ctx.journey) errors.push(`${where}: tradeMult 는 여정형만`);
    if (e.ordersLate !== undefined && !ctx.orders) errors.push(`${where}: ordersLate 는 주문이 있는 현장형만`);
    if (e.cropLoss !== undefined && !ctx.farm) errors.push(`${where}: cropLoss 는 농사 사건만`);
  }
  function checkEvent(where: string, ev: z.infer<typeof event>, ctx: { journey: boolean; orders: boolean; farm: boolean }) {
    if (eventIds.has(ev.id)) errors.push(`${where}: 사건 id ${ev.id} 중복`);
    eventIds.add(ev.id);
    key(where, ev.textKey);
    const oids = new Set<string>();
    const sigs = new Set<string>();
    let anyEffect = false;
    for (const o of ev.options) {
      const w = `${where}.${o.id}`;
      if (oids.has(o.id)) errors.push(`${w}: 선택지 id 중복`);
      oids.add(o.id);
      key(w, o.textKey);
      const txt = d.ko[o.textKey] ?? '';
      for (const r of REVEAL_WORDS) if (txt.includes(r)) errors.push(`${w}: 선택지 문구가 결과를 미리 말함 ("${r}"): ${txt}`);
      checkEffects(w, o.effects, ctx);
      if (Object.keys(o.effects).length) anyEffect = true;
      if (o.check) {
        skill(`${w}.check`, o.check.skill);
        if (!o.failEffects) errors.push(`${w}: check 가 있으면 failEffects 필요`);
        else checkEffects(`${w}.failEffects`, o.failEffects, ctx);
      } else if (o.failEffects) errors.push(`${w}: check 없이 failEffects`);
      sigs.add(JSON.stringify([o.effects, o.check, o.failEffects]));
    }
    if (!anyEffect) errors.push(`${where}: 모든 선택지의 효과가 비어 있음`);
    if (sigs.size < ev.options.length) errors.push(`${where}: 효과가 똑같은 선택지가 있음`);
  }

  // ── 직업 ──
  const ids = Object.keys(C.careers);
  const want = Object.keys(CAREERS);
  for (const id of want) if (!C.careers[id]) errors.push(`직업 ${id} 없음 (17-2 16개)`);
  for (const id of ids) if (!CAREERS[id]) errors.push(`직업 ${id} 는 17-2 표에 없음`);
  if (ids.length !== 16) errors.push(`직업 16개여야 함 (지금 ${ids.length})`);
  const wageBase: Record<string, number> = d.economy.income.wageBase;
  const mult: number = d.economy.income.wageRankMult;
  const fpp: number = d.economy.currency.farthingsPerPenny;
  const tradeBonus: number = d.economy.estates.merchant.incomes.trade.rankBonus;
  const rows: string[] = [];
  for (const [id, c] of Object.entries(C.careers)) {
    const w = `careers.${id}`;
    const spec = CAREERS[id];
    key(w, c.nameKey); key(w, c.descKey); if (c.nameKeyF) key(w, c.nameKeyF); icon(w, c.icon);
    if (!spec) continue;
    if (c.type !== spec.type) errors.push(`${w}: 유형 ${c.type} ≠ 17-2 ${spec.type}`);
    for (const e of spec.estates) if (!(c.estates as string[]).includes(e)) errors.push(`${w}: 신분 ${e} 가 빠짐 (17-2)`);
    if (spec.exactEstates && c.estates.length !== spec.estates.length) errors.push(`${w}: 신분은 ${spec.estates.join(',')} 만 (17-2)`);
    if (NO_SERF.includes(id) && (c.estates as string[]).includes('serf')) errors.push(`${w}: 농노는 이 직업을 못 가짐 (17-2 자유민+/장인 경로)`);
    if (id === 'clerk' && !c.literacy) errors.push(`${w}: 서기는 문해 필요`);
    if ([...spec.skills].sort().join() !== [...c.skills].sort().join()) errors.push(`${w}: 핵심 스킬 ${c.skills.join(',')} ≠ 17-2 ${spec.skills.join(',')}`);
    c.skills.forEach((s) => skill(w, s));
    if (c.hours[0] >= c.hours[1]) errors.push(`${w}: 출근 시각 [시작, 끝] 순서`);
    if (new Set(c.days).size !== c.days.length) errors.push(`${w}: 요일 중복`);
    if (c.type !== 'onsite' && c.workplace !== 'lot_exit') errors.push(`${w}: 래빗홀/여정형 workplace 는 lot_exit`);
    if (c.type === 'onsite') {
      if (NEW_WORKPLACE_TAGS.includes(c.workplace)) warns.push(`${w}: 일터 태그 ${c.workplace} 가 아직 없음 (리드가 물건 태그 추가)`);
      else if (!STATION_TAGS.includes(c.workplace) && !d.objectTags.has(c.workplace)) errors.push(`${w}: 일터 태그 ${c.workplace} 가 작업대/물건 태그에 없음`);
      for (const s of c.stations ?? []) if (!STATION_TAGS.includes(s) && !d.objectTags.has(s)) errors.push(`${w}: 작업대 ${s} 가 계약 태그 목록에 없음`);
      if (!c.orders && !c.services) errors.push(`${w}: 현장형은 orders 나 services 가 있어야 함`);
    }
    if (c.type === 'rabbithole' && !c.dailyTask) errors.push(`${w}: 래빗홀형은 dailyTask 필요 (17-2 일일 과제)`);
    if (c.dailyTask) { skill(`${w}.dailyTask`, c.dailyTask.skill); key(`${w}.dailyTask`, c.dailyTask.key); }
    if (c.type === 'journey' && !c.journey) errors.push(`${w}: 여정형은 journey 필요`);
    if (c.journey && (c.journey.days[0] < 3 || c.journey.days[1] > 5)) errors.push(`${w}: 여정 3~5일 (17-7)`);

    // 등급
    if (c.ranks.length < spec.ranks) errors.push(`${w}: 등급 ${c.ranks.length}개 < 17-2 ${spec.ranks}개`);
    if (c.ranks.length < 3) warns.push(`${w}: 등급 ${c.ranks.length}개 (30장 목표 3~5)`);
    c.ranks.forEach((r, i) => { key(`${w}.r${i + 1}`, r.nameKey); if (r.nameKeyF) key(`${w}.r${i + 1}`, r.nameKeyF); });
    if (wageBase[id] !== undefined) {
      c.ranks.forEach((r, i) => {
        const exp = Math.round(wageBase[id] * fpp * mult ** i);
        if (r.wage !== exp) errors.push(`${w}.r${i + 1}: 일당 ${r.wage} ≠ 17-7 식 ${exp}파딩 (기본 ${wageBase[id]}동화 × ${mult}^${i})`);
      });
    } else if (spec.type === 'rabbithole') errors.push(`${w}: economy.income.wageBase 에 기본 일당 없음`);
    for (let i = 1; i < c.ranks.length; i++) {
      const a = c.ranks[i - 1].wage, b = c.ranks[i].wage;
      if (a && b && Math.abs(b - a * mult) > 1) errors.push(`${w}.r${i + 1}: 일당 ${b} 가 앞 등급 ${a} × ${mult} 가 아님`);
      const fa = c.ranks[i - 1].feeMult, fb = c.ranks[i].feeMult;
      if (fa && fb && Math.abs(fb - fa * mult) > 0.01) errors.push(`${w}.r${i + 1}: feeMult ${fb} 가 앞 등급 × ${mult} 가 아님`);
    }
    if (spec.type === 'journey') c.ranks.forEach((r, i) => { if (Math.abs((r.rankBonus ?? -1) - i * tradeBonus) > 1e-9) errors.push(`${w}.r${i + 1}: rankBonus ${r.rankBonus} ≠ ${i * tradeBonus} (economy 교역 등급 보정)`); });
    if (spec.guild) {
      const [ap, jm, ms] = c.ranks;
      if (c.ranks.length !== 4) errors.push(`${w}: 장인 경로는 도제 → 직인 → 장인 → 길드장 4등급`);
      if (ap?.share !== 0 || ap?.minDays?.value !== 10 || ap?.advance !== 'time') errors.push(`${w}.r1: 도제는 몫 0, 10일(lifespan), advance time`);
      if (jm?.minDays?.value !== 8 || jm?.advance !== 'masterpiece') errors.push(`${w}.r2: 직인은 최소 8일(lifespan), advance masterpiece`);
      if (ms?.share !== 1) errors.push(`${w}.r3: 장인 몫 1`);
    }

    // 주문과 용역
    if (c.orders) {
      const o = c.orders;
      if (o.perDay[0] < 0 || o.perDay[1] > 6) errors.push(`${w}.orders.perDay: 하루 주문은 6건 이하`);
      if (spec.guild && (o.perDay[0] !== 3 || o.perDay[1] !== 6)) errors.push(`${w}.orders.perDay: 장인 현장형은 [3, 6] (17-2)`);
      if (o.feeMult[0] < 1.1 - 1e-9 || o.feeMult[1] > 1.4 + 1e-9) errors.push(`${w}.orders.feeMult: 1.1~1.4 범위 안이어야 함`);
      const allowed = ORDER_ITEMS[id] ?? ALL_ORDER_ITEMS;
      const seen = new Set<string>();
      for (const p of o.pool) {
        if (seen.has(p.item)) errors.push(`${w}.orders: 주문 품목 ${p.item} 중복`);
        seen.add(p.item);
        // recipes.json 이 있으면 그 결과 품목이 기준, 없으면 리드가 약속한 id 목록
        if (d.recipeOutputs) { if (!d.recipeOutputs.has(p.item)) errors.push(`${w}.orders: 주문 품목 ${p.item} 가 recipes.json 결과 품목에 없음`); }
        else if (!allowed.includes(p.item)) warns.push(`${w}.orders: 주문 품목 ${p.item} 가 약속한 레시피 결과 id(${allowed.join(' ')})에 없음 (recipes.json 이 생기면 교차 확인)`);
        if (p.qty[0] < 1) errors.push(`${w}.orders.${p.item}: 수량은 1 이상`);
        if (p.minRank !== undefined && p.minRank >= c.ranks.length) errors.push(`${w}.orders.${p.item}: minRank 가 등급 수 이상`);
      }
      if (id === 'blacksmith' && o.pool.length < 6) errors.push(`${w}.orders: 대장장이 주문 품목 6종 이상 (계약 4절)`);
      if (d.items) {
        let wsum = 0, vsum = 0, missing = false;
        for (const p of o.pool) {
          const base = d.items[p.item]?.base;
          if (base === undefined) { missing = true; continue; }
          wsum += p.weight; vsum += p.weight * ((p.qty[0] + p.qty[1]) / 2) * base * ((o.feeMult[0] + o.feeMult[1]) / 2);
        }
        if (missing) warns.push(`${w}.orders: items.json 에 기준가 없는 주문 품목이 있어 매출 추정을 건너뜀`);
        else if (wsum) {
          const perOrder = vsum / wsum;
          const daily = perOrder * ((o.perDay[0] + o.perDay[1]) / 2);
          info.push(`  ${id.padEnd(11)} 주문 한 건 평균 ${perOrder.toFixed(0)}파딩, 하루 매출 추정 ${daily.toFixed(0)}파딩`);
          if (spec.guild) {
            const target = d.economy.estates.artisan.incomes.shop.salesPerDay * fpp;
            if (daily < target * 0.5 || daily > target * 1.5) warns.push(`${w}.orders: 하루 매출 추정 ${daily.toFixed(0)}파딩이 장인 가게 매출 ${target}파딩의 ±50% 밖 (qty 조정 필요)`);
          }
        }
      }
    }
    if (!d.recipeOutputs && c.orders) warns.push(`${w}.orders: recipes.json 이 아직 없어 약속한 id 목록으로만 확인함`);
    if (c.services) {
      if (c.services.perDay[0] < 0 || c.services.perDay[1] > 6) errors.push(`${w}.services.perDay: 0~6`);
      const sids = new Set<string>();
      for (const s of c.services.pool) {
        if (sids.has(s.id)) errors.push(`${w}.services: ${s.id} 중복`);
        sids.add(s.id);
        key(`${w}.services.${s.id}`, s.nameKey); skill(`${w}.services.${s.id}`, s.skill);
        if (s.fee[0] < 0) errors.push(`${w}.services.${s.id}: 사례금은 0 이상`);
        if (s.recipe && d.serviceRecipes && !d.serviceRecipes.has(s.recipe)) errors.push(`${w}.services.${s.id}: recipes.json 에 용역 레시피(service: true) ${s.recipe} 없음`);
        if (s.minRank !== undefined && s.minRank >= c.ranks.length) errors.push(`${w}.services.${s.id}: minRank 가 등급 수 이상`);
      }
    }

    // 사건
    const minEv = id === 'blacksmith' ? 4 : 2;
    if (c.events.length < minEv) errors.push(`${w}: 일터 사건 카드 ${c.events.length}개 < ${minEv}개`);
    for (const ev of c.events) checkEvent(`${w}.events.${ev.id}`, ev, { journey: c.type === 'journey', orders: !!c.orders, farm: false });

    const pay = c.ranks.map((r) => r.wage !== undefined ? String(r.wage) : r.share !== undefined ? `몫${r.share}` : r.feeMult !== undefined ? `×${r.feeMult}` : r.rankBonus !== undefined ? `+${r.rankBonus}` : '-').join('/');
    rows.push(`  ${id.padEnd(11)} ${c.type.padEnd(10)} 등급 ${c.ranks.length} ${pay.padEnd(24)} 사건 ${c.events.length}${c.orders ? ` 주문 ${c.orders.pool.length}종` : ''}${c.services ? ` 용역 ${c.services.pool.length}` : ''}`);
  }
  for (const [a, v] of Object.entries(C.rules.attitudes)) key(`rules.attitudes.${a}`, v.nameKey);

  // NPC 역할
  const rids = Object.keys(C.npcRoles);
  for (const r of NPC_ROLES) if (!C.npcRoles[r]) errors.push(`NPC 역할 ${r} 없음 (17-2 10종)`);
  for (const r of rids) if (!NPC_ROLES.includes(r)) errors.push(`NPC 역할 ${r} 는 17-2 표에 없음`);
  if (rids.length !== 10) errors.push(`NPC 역할 10개여야 함 (지금 ${rids.length})`);
  for (const [id, r] of Object.entries(C.npcRoles)) {
    const w = `npcRoles.${id}`;
    key(w, r.nameKey);
    r.skills.forEach((s) => skill(w, s));
    for (const [sk, sr] of Object.entries(r.subroles ?? {})) { key(`${w}.${sk}`, sr.nameKey); skill(`${w}.${sk}`, sr.skill); }
    if (r.schedule.hours[0] >= r.schedule.hours[1]) errors.push(`${w}: 일과 시각 순서`);
    if (ids.includes(id)) errors.push(`${w}: 직업 id 와 겹침`);
    for (const it of r.pay.sells ?? []) if (d.items && !d.items[it]) warns.push(`${w}: 파는 품목 ${it} 가 items.json 에 없음`);
  }
  if (C.npcRoles.servant && Object.keys(C.npcRoles.servant.subroles ?? {}).length < 6) errors.push('npcRoles.servant: 하녀, 요리사, 유모, 마부, 집사, 경비 6갈래 (16-7)');

  // ── 작물 ──
  const winterMult = F.growth.winterMult;
  const cids = Object.keys(F.crops);
  for (const id of Object.keys(CROPS)) if (!F.crops[id]) errors.push(`작물 ${id} 없음 (31-3 표)`);
  for (const id of cids) if (!CROPS[id]) errors.push(`작물 ${id} 는 31-3 표에 없음`);
  if (cids.length < CROP_COUNT) errors.push(`작물 15종 이상이어야 함 (지금 ${cids.length})`);
  const econ = d.economy.farming.plotYearYield;
  const cropRows: string[] = [];
  for (const [id, c] of Object.entries(F.crops)) {
    const w = `crops.${id}`;
    const spec = CROPS[id];
    key(w, c.nameKey); key(w, c.descKey);
    const itemIcon = (d.items?.[c.yield.item] as { icon?: string } | undefined)?.icon;
    if (itemIcon) { if (c.icon !== itemIcon) warns.push(`${w}: 아이콘 ${c.icon} 가 items.json ${c.yield.item} 아이콘 ${itemIcon} 와 다름`); }
    else icon(w, c.icon);
    if (!spec) continue;
    if (!spec.kinds.includes(c.kind)) errors.push(`${w}: 분류 ${c.kind} ≠ ${spec.kinds.join('/')}`);
    if ([...c.sow].sort().join() !== [...spec.sow].sort().join()) errors.push(`${w}: 파종 계절 ${c.sow.join(',')} ≠ 31-3 ${spec.sow.join(',') || '(나무)'}`);
    if ([...c.harvestSeasons].sort().join() !== [...spec.harvest].sort().join()) errors.push(`${w}: 수확 계절 ${c.harvestSeasons.join(',')} ≠ 31-3 ${spec.harvest.join(',')}`);
    if (c.sprite !== id) errors.push(`${w}: sprite 키는 작물 id 와 같아야 함`);
    if (!HARVEST_ITEMS.includes(c.yield.item)) errors.push(`${w}: 수확물 ${c.yield.item} 가 약속한 품목 id 에 없음`);
    if (d.items && !d.items[c.yield.item]) errors.push(`${w}: 수확물 ${c.yield.item} 가 items.json 에 없음`);
    if (!d.items) warns.push(`${w}: items.json 이 아직 없어 수확물 id 를 약속 목록으로만 확인함`);
    if (c.kind === 'orchard') {
      if (!c.perennial) errors.push(`${w}: 과수는 perennial (나무) 필요`);
      if (c.seed !== null) errors.push(`${w}: 과수는 씨앗 대신 묘목 (seed null)`);
    } else {
      if (!c.seed) errors.push(`${w}: 씨앗 필요`);
      else if (c.seed.item !== c.yield.item) errors.push(`${w}: 씨앗 품목은 수확물과 같아야 함 (수확물에서 남김, 31-6)`);
    }
    if (c.seed && ['grain', 'legume'].includes(c.kind)) {
      const want = c.yield.perMediumPlot * d.economy.farming.seedShare;
      if (Math.abs(c.seed.perPlot - want) > Math.max(2, want * 0.15)) errors.push(`${w}: 씨앗 ${c.seed.perPlot} 이 수확량 × economy.farming.seedShare (${want.toFixed(0)}) 와 어긋남`);
    }
    if (c.kind === 'legume' && c.fertilityCost >= 0) errors.push(`${w}: 콩은 지력을 회복 (fertilityCost 음수)`);
    if (c.kind === 'grain' && c.fertilityCost <= 0) errors.push(`${w}: 곡물은 지력을 소모`);
    if (c.kind === 'grain' && (c.garden || !c.field)) errors.push(`${w}: 곡물은 밭 구획 전용`);
    if (['vegetable', 'herb', 'medicinal'].includes(c.kind) && !c.garden) errors.push(`${w}: 채소/허브/약초는 텃밭 가능 (31-1)`);
    for (const x of c.disasters) if (!F.disasters[x]) errors.push(`${w}: 재해 ${x} 없음`);
    if (c.skill) skill(w, c.skill);
    if (id === 'moonwort') {
      if (!c.sowWindow || c.sowWindow.festival !== 'midsummer') errors.push(`${w}: 월광초는 하지 밤에만 파종 (sowWindow.festival midsummer)`);
      if (!c.magic) errors.push(`${w}: 월광초는 마법 설정 끔이면 없음 (magic.off)`);
      if (c.yield.perMediumPlot > 6) errors.push(`${w}: 월광초는 드묾 (33-0) — 수확량 6 이하`);
    }
    // 익는 계절 모의: 파종 계절 시작 (월광초는 하지 = 여름 중간, 나무는 cycleStart 시작)
    const starts: [number, number][] = c.perennial ? [[SEASON_IDX[c.perennial.cycleStart], 0]]
      : c.sowWindow ? c.sow.map((s) => [SEASON_IDX[s], 0.5] as [number, number])
      : c.sow.map((s) => [SEASON_IDX[s], 0] as [number, number]);
    const ripe: string[] = [];
    for (const [si, fr] of starts) {
      const r = ripenAt(si, fr, c.growSeasons.value, winterMult);
      const s = seasonOf(r);
      ripe.push(`${SEASONS[si]}→${s}`);
      if (!c.harvestSeasons.includes(s)) errors.push(`${w}: ${SEASONS[si]} 에 심으면 ${s} 에 익음 — 익는 계절이 수확 계절(${c.harvestSeasons.join(',')}) 밖 (growSeasons ${c.growSeasons.value})`);
    }
    const cpy = cropsPerYear(c, winterMult);
    if (cpy !== c.cropsPerYear) errors.push(`${w}: cropsPerYear ${c.cropsPerYear} ≠ 모의 결과 ${cpy} (달력 1년에 거둘 수 있는 횟수)`);
    const annual = c.yield.perMediumPlot * c.cropsPerYear;
    const ref = c.kind === 'grain' ? econ.grain : c.kind === 'vegetable' ? econ.vegetables : undefined;
    if (ref !== undefined && Math.abs(annual - ref) > ref * 0.1) errors.push(`${w}: 달력 1년 수확량 ${annual} (= ${c.yield.perMediumPlot} × ${c.cropsPerYear}) 이 economy.json plotYearYield ${ref} 의 ±10% 밖`);
    cropRows.push(`  ${id.padEnd(16)} ${c.kind.padEnd(10)} ${(c.sow.join('/') || '나무').padEnd(14)} ${String(c.growSeasons.value).padStart(4)}계절  ${ripe.join(' ').padEnd(30)} ${String(c.yield.perMediumPlot).padStart(4)} × ${c.cropsPerYear}  지력 ${c.fertilityCost}`);
  }
  // 텃밭 수확량이 economy.farming.garden 과 비슷한지 (채소 두 번)
  const garden = F.plotSizes.garden;
  if (garden) {
    const target = d.economy.farming.garden.vegetablesPerDay * d.economy.farming.garden.seasons.length * d.economy.calendar.seasonDays;
    const got = 36 * garden.yield;
    if (Math.abs(got - target) > target * 0.15) warns.push(`plotSizes.garden: 채소 달력 1년 ${got.toFixed(1)} 이 economy.farming.garden ${target.toFixed(1)} 의 ±15% 밖`);
  }
  const ps = F.plotSizes;
  if (ps.medium.work !== 1 || ps.medium.yield !== 1) errors.push('plotSizes.medium 은 work 1, yield 1 (기준)');
  if (!(ps.small.yield < ps.medium.yield && ps.medium.yield < ps.large.yield)) errors.push('plotSizes: 소 < 중 < 대 수확량');
  const curve = F.fertility.yieldCurve;
  for (let i = 1; i < curve.length; i++) if (curve[i][0] <= curve[i - 1][0] || curve[i][1] < curve[i - 1][1]) errors.push('fertility.yieldCurve: 지력이 오르면 수확 배수도 오름 (단조)');
  F.growth.stageKeys.forEach((k, i) => key(`growth.stageKeys.${i}`, k));

  // 작업
  for (const [t, m] of Object.entries(TASKS)) {
    const task = F.tasks[t];
    if (!task) { errors.push(`작업 ${t} 없음 (31-2 8종)`); continue; }
    if (task.minutes.value !== m) errors.push(`tasks.${t}: ${task.minutes.value}분 ≠ 31-2 ${m}분 (중 구획)`);
    key(`tasks.${t}`, task.nameKey); key(`tasks.${t}`, task.descKey);
  }
  for (const t of Object.keys(F.tasks)) if (!(t in TASKS)) errors.push(`작업 ${t} 는 31-2 표에 없음`);
  for (const [t, task] of Object.entries(F.tasks)) {
    const st = task.requires?.stock;
    if (st && typeof st === 'object') for (const it of Object.keys(st)) {
      if (d.items && !d.items[it]) warns.push(`tasks.${t}: 재고 품목 ${it} 가 items.json 에 없음 (작업자 A/리드가 추가해야 작업 가능)`);
    }
  }
  if (F.tasks.water && F.tasks.water.when !== 'drought') errors.push('tasks.water: 물 대기는 가뭄 사건 때만 (when drought, 매일 물 주기 없음)');
  if (F.tasks.till && F.tasks.till.withPlow?.value !== 60) errors.push('tasks.till: 소/말 쟁기 1시간 (withPlow 60)');

  // 재해
  for (const x of DISASTERS) if (!F.disasters[x]) errors.push(`재해 ${x} 없음 (31-5)`);
  for (const [x, v] of Object.entries(F.disasters)) {
    const w = `disasters.${x}`;
    if (!DISASTERS.includes(x)) errors.push(`${w}: 31-5 에 없는 재해`);
    key(w, v.nameKey); key(w, v.noteKey);
    if (v.loss && v.loss[0] > v.loss[1]) errors.push(`${w}: loss [작은 값, 큰 값]`);
    if (!v.loss && v.lossPerDay === undefined) errors.push(`${w}: loss 또는 lossPerDay 필요`);
    if (v.preventedBy && !F.tasks[v.preventedBy.task]) errors.push(`${w}: 막는 작업 ${v.preventedBy.task} 없음`);
    if (v.mitigatedBy?.task && !F.tasks[v.mitigatedBy.task]) errors.push(`${w}: 줄이는 작업 ${v.mitigatedBy.task} 없음`);
    for (const m of v.moodlets ?? []) if (!moodlets[m]) errors.push(`${w}: 무드렛 ${m} 없음`);
    if (v.caughtEvent && !F.events.some((e) => e.id === v.caughtEvent)) errors.push(`${w}: 연결 사건 ${v.caughtEvent} 없음`);
  }
  const gob = F.disasters.goblins;
  if (gob) {
    if (gob.chance.scale !== 'per_life') errors.push('disasters.goblins: 고블린 빈도는 per_life (33-0, 29-1)');
    if (!gob.magicSetting || gob.magicSetting.off !== 0) errors.push('disasters.goblins: 고블린은 마법/괴물 설정 끔이면 0');
    if (gob.chance.value * (gob.magicSetting?.rare ?? 1) > 1.5) errors.push('disasters.goblins: 고블린은 드묾 (드묾 설정 한 인생 1.5회 이하)');
    if (!gob.loss || gob.loss[1] > 0.15) errors.push('disasters.goblins: 고블린 피해는 작음 (최대 15% 이하, 33-0)');
  }
  if (F.disasters.crows?.preventedBy?.task !== 'scarecrow') errors.push('disasters.crows: 허수아비가 까마귀를 막음');
  if (F.disasters.drought?.preventedBy?.task !== 'water') errors.push('disasters.drought: 물 대기가 가뭄을 막음');
  if (F.disasters.flood?.condition?.plot !== 'riverside') errors.push('disasters.flood: 홍수는 강가 구획만');
  if (F.fertility.rotation.breachEvent && !F.events.some((e) => e.id === F.fertility.rotation.breachEvent)) errors.push('fertility.rotation.breachEvent 사건 없음');
  for (const ev of F.events) checkEvent(`crops.events.${ev.id}`, ev, { journey: false, orders: false, farm: true });

  // ── i18n (work.json 문구) ──
  for (const [k, v] of Object.entries(d.koWork)) {
    const plain = v.replace(PLACEHOLDERS, '');
    if (/[0-9A-Za-z]/.test(plain)) errors.push(`ko/work.json ${k}: 숫자/영문 노출 "${v}"`);
    for (const b of BANNED_KO) if (v.includes(b)) errors.push(`ko/work.json ${k}: 금지어 "${b}"`);
    const ph = v.match(/\{[^}]*\}/g) ?? [];
    for (const p of ph) if (!/^\{(name|crop)\}$/.test(p)) errors.push(`ko/work.json ${k}: 알 수 없는 치환 ${p}`);
    if (!usedKeys.has(k) && !k.startsWith('farm.') && !k.startsWith('career.attitude')) warns.push(`ko/work.json ${k}: 데이터에서 안 쓰는 키`);
  }

  info.unshift(...rows, '', ...cropRows);
  return { errors, warns, info };
}

// ── 음성 테스트: 일부러 망가뜨린 데이터를 잡는가 ─────────────
function selftest(base: Input): boolean {
  const clone = (): Input => ({ ...base, careers: structuredClone(base.careers), crops: structuredClone(base.crops), ko: { ...base.ko }, koWork: { ...base.koWork } });
  const cases: [string, string, (d: Input) => void][] = [
    ['래빗홀 일당이 17-7 식과 다름', '17-7 식', (d) => { d.careers.careers.field_hand.ranks[1].wage = 25; }],
    ['대장장이 사건 3개', '사건 카드 3개 < 4개', (d) => { d.careers.careers.blacksmith.events.length = 3; }],
    ['없는 무드렛', '무드렛 no_such_mood', (d) => { d.careers.careers.guard.events[0].options[0].effects.moodlets = ['no_such_mood']; }],
    ['레시피에 없는 주문 품목', '주문 품목 sword', (d) => { d.careers.careers.blacksmith.orders.pool[0].item = 'sword'; }],
    ['주문 사례금 배수 범위 밖', 'feeMult', (d) => { d.careers.careers.baker.orders.feeMult = [1.0, 1.6]; }],
    ['밀 수확량이 economy 와 어긋남', 'plotYearYield', (d) => { d.crops.crops.wheat.yield.perMediumPlot = 150; }],
    ['작물 하나 빠짐', '작물 pears 없음', (d) => { delete d.crops.crops.pears; }],
    ['기간 필드 scale 빠짐', 'crops 스키마', (d) => { delete d.crops.crops.oats.growSeasons.scale; }],
    ['순무 0.8계절이면 봄에 익음', '익는 계절이 수확 계절', (d) => { d.crops.crops.turnip.growSeasons.value = 0.8; }],
    ['선택지가 결과를 미리 말함', '결과를 미리 말함', (d) => { d.ko[d.careers.careers.baker.events[0].options[0].textKey] = '싸게 판다 (성과 +2)'; }],
    ['물 대기를 매일', '물 대기는 가뭄', (d) => { d.crops.tasks.water.when = 'daily'; }],
    ['고블린 피해가 큼', '고블린 피해는 작음', (d) => { d.crops.disasters.goblins.loss = [0.3, 0.5]; }],
    ['NPC 역할 빠짐', 'NPC 역할 tutor 없음', (d) => { delete d.careers.npcRoles.tutor; }],
    ['i18n 키 빠짐', 'i18n 키 없음', (d) => { delete d.ko['career.ev.gd_drunk_gate']; }],
    ['문구에 숫자', '숫자/영문', (d) => { d.koWork['crop.wheat'] = '밀 2호'; }],
    ['판정 있는데 실패 효과 없음', 'failEffects 필요', (d) => { delete d.careers.careers.guard.events[2].options[0].failEffects; }],
    ['농노 대장장이', '농노는 이 직업을', (d) => { d.careers.careers.blacksmith.estates.push('serf'); }],
    ['도제 기간 틀림', '도제는', (d) => { d.careers.careers.baker.ranks[0].minDays.value = 5; }],
    ['콩이 지력을 깎음', '콩은 지력을 회복', (d) => { d.crops.crops.beans.fertilityCost = 5; }],
    ['한 해 수확 횟수 거짓', 'cropsPerYear', (d) => { d.crops.crops.leek.cropsPerYear = 2; }],
  ];
  const b = check(base);
  let ok = b.errors.length === 0;
  console.log(`  기준 데이터: 오류 ${b.errors.length} ${ok ? '(정상)' : '— 기준 데이터가 먼저 통과해야 함'}`);
  // 작업자 A 의 items/recipes/skills 가 없을 때 (약속한 id 목록만으로 검사)
  const noA = (): Input => ({ ...clone(), items: null, recipeOutputs: null, serviceRecipes: null, skills: null });
  const b2 = check(noA());
  if (b2.errors.length) ok = false;
  console.log(`  A 파일 없이 기준 데이터: 오류 ${b2.errors.length}${b2.errors.length ? ' — ' + b2.errors.slice(0, 3).join(' | ') : ' (정상)'}`);
  const d2 = noA();
  d2.careers.careers.blacksmith.orders.pool[0].item = 'sword';
  const hit2 = check(d2).warns.some((e) => e.includes('주문 품목 sword'));
  if (!hit2) ok = false;
  console.log(`  ${hit2 ? '잡음' : '놓침'}  (A 파일 없음) 약속 밖 주문 품목은 경고`);
  for (const [name, expect, mutate] of cases) {
    const d = clone();
    mutate(d);
    const r = check(d);
    const hit = r.errors.some((e) => e.includes(expect));
    if (!hit) ok = false;
    console.log(`  ${hit ? '잡음' : '놓침'}  ${name}${hit ? '' : ` (기대 "${expect}", 실제 ${r.errors.slice(0, 2).join(' | ') || '오류 없음'})`}`);
  }
  return ok;
}

// ── 실행 ──────────────────────────────────────────────────
const input = load();
if (process.argv.includes('--selftest')) {
  console.log('check-work-content 음성 테스트');
  const ok = selftest(input);
  console.log(ok ? '\n음성 테스트: 통과' : '\n음성 테스트: 실패');
  process.exit(ok ? 0 : 1);
}
const { errors, warns, info } = check(input);
console.log('\n  직업        유형       등급 일당(파딩)/몫/배수        사건');
for (const l of info) console.log(l);
console.log(`\n  사건 카드: 직업 ${Object.values<any>(input.careers.careers).reduce((s, c) => s + c.events.length, 0)} + 농사 ${input.crops.events.length}, 새 무드렛 ${Object.keys(input.careers.newMoodlets ?? {}).length}, ko/work.json 키 ${Object.keys(input.koWork).length}\n`);
for (const w of warns) console.warn('경고:', w);
if (errors.length) {
  for (const e of errors) console.error('오류:', e);
  console.error(`\ncheck-work-content: 실패 (오류 ${errors.length}, 경고 ${warns.length})`);
  process.exit(1);
}
console.log(`check-work-content: 통과 (경고 ${warns.length})`);
