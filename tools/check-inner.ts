/**
 * M2 "내면" 콘텐츠 검사 (계약 artifacts/contracts-m2.md 2, 4, 5절 / GDD 11, 12, 30).
 * - 스키마(zod): moodlets / wishes / aspirations / rewards / likes
 * - 엔진이 참조하는 무드렛 id 전부 존재 (계약 5절 + 욕구 무드렛 + 리드 추가 요청분 + traits.json 참조)
 * - 욕구 무드렛이 11-1 표의 감정/세기와 같음
 * - 기간 필드는 { value, scale } (scale 필수, 29-0)
 * - i18n 누락 0 (src/i18n/ko/inner.json), 한국어 문구에 숫자/영문 없음, 무드렛 이름 2~8자(공백 제외)
 * - 감정/특성/덕·죄/상호작용/태그/while 조건 id 가 계약 목록 안
 * - 아이콘 키가 src/data/ui/atlas.json 에 있음
 * - 개수 표 출력
 * - 도달 가능성 (M2~M3 에서 실제로 생기는 사건/무드렛): 뽑힐 수 있는 소원/걱정 개수 (0 이면 실패), 인생 목표 1단계 도달 가능, 호불호 항목
 * 무드렛은 moodlets.json + moodlets_m3.json 합본, i18n 키는 src/i18n/ko/*.json 합본 기준 (게임과 같음).
 * 문구 검사(숫자/영문, 안 쓰는 키)는 이 검사 소관인 inner.json, inner_fix.json 만
 * 사용: npx tsx tools/check-inner.ts
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { z } from 'zod';
import { loadSimData } from './data-node';
import { computeReach, likeReach, needReachable, reachSourcesOf, wishReachable, type NeedCond, type WishDef } from '../src/sim/data/innerData';

const errors: string[] = [];
const warns: string[] = [];
const json = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

// ── 계약 목록 ─────────────────────────────────────────────
const EMOTIONS = ['happy', 'energized', 'focused', 'excited', 'inspired', 'pious', 'sad', 'angry', 'tense', 'ashamed'] as const;
const EMOTIONS_ALL = [...EMOTIONS, 'neutral'];
const NEEDS = ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social', 'warmth', 'comfort'] as const;
const SOURCES = ['need', 'env', 'social', 'event', 'memory', 'trait', 'weather', 'faith', 'health', 'season'] as const;
const WHILE_IDS = [
  'near_lit_hearth_sitting', 'room_dirty', 'room_smoky', 'alone_long', 'raining', 'single', 'crowded', 'dark_night',
  'outdoor', 'indoor_cozy', 'stress_40', 'stress_70',
  'dark_night_outdoor', 'family_near', // 리드 추가
];
const TRAITS = [
  'cheerful', 'melancholic', 'hot_tempered', 'calm', 'coward', 'brave', 'romantic', 'cynical',
  'neat', 'lazy', 'diligent', 'gourmet', 'drinker', 'active', 'bookworm', 'handy', 'nature_lover', 'creative',
  'sociable', 'introvert', 'kind', 'mean', 'ambitious', 'humble', 'gossip', 'suspicious', 'family_oriented', 'flirt', 'just', 'cunning',
];
const VIRTUES = ['chastity', 'temperance', 'charity', 'diligence', 'patience', 'kindness', 'humility', 'lust', 'gluttony', 'greed', 'sloth', 'wrath', 'envy', 'pride'];
const TAGS = [
  'clean', 'labor', 'rest', 'read', 'music', 'creative', 'nature', 'cook', 'eat_good', 'drink', 'exercise', 'repair', 'pray',
  'social', 'family', 'kind', 'mean', 'gossip', 'flirt', 'romance', 'brag', 'humble', 'lie', 'charity', 'feast', 'fast',
  'night_out', 'craft', 'study', 'solitary',
];
const MOODLET_EXTRA_TAGS = ['food', 'shame']; // 계약 2절 예시, shame = 리드 M3 망신(embarrassed)
const ESTATES = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'];
const STAGES = ['child', 'teen', 'adult', 'elder'];
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const SCALES = ['absolute', 'season', 'lifespan', 'per_life'] as const;
const M2_INTERACTIONS = [
  'floor.sweep', 'table.wipe', 'cupboard.drink_ale', 'bed.lounge', 'yard.walk', 'yard.pick_herbs', 'chair.mend',
  'table.whittle', 'bench.pray', 'bookshelf.study', 'stock.count',
];
const SOCIAL = [
  'social.chat', 'social.deep_talk', 'social.joke', 'social.comfort', 'social.hug', 'social.tease', 'social.gossip',
  'social.argue', 'social.flirt', 'social.brag', 'social.apologize',
];
const ENGINE_MOODLETS = [
  'cozy_hearth', 'smoky_room', 'dirty_room_neat', 'fresh_bread', 'good_meal', 'ate_alone', 'slept_well', 'slept_badly',
  'slept_on_floor', 'pleasant_chat', 'heartfelt_talk', 'teased', 'was_comforted', 'hug', 'argued', 'heard_gossip',
  'lonely_heart', 'stress_heavy', 'stress_limit', 'after_breakdown', 'wish_fulfilled', 'fear_realized', 'bored_repeat',
  'liked_activity', 'disliked_activity', 'lazy_bliss', 'restless_idle', 'no_exercise', 'bad_food_gourmet', 'ale_merry',
  'alone_in_dark', 'crowded_introvert', 'family_near', 'prayer_calm', 'humble_chat', 'pride_boast', 'schemed', 'did_good',
  // 리드 추가 요청 1 (traits.json 효과)
  'melancholy_mood', 'satisfied_tidy', 'fresh_air', 'struck_inspiration',
  // 리드 추가 요청 2 (stress.json 무너짐 / 보완 규칙)
  'drunk_binge', 'cried_it_out', 'ran_off', 'smashed_things', 'craving_ale',
];
/** 리드 추가 요청에서 while 이 정해진 것 */
const ENGINE_WHILE: Record<string, string> = { alone_in_dark: 'dark_night_outdoor', family_near: 'family_near', dirty_room_neat: 'room_dirty' };
/** 11-1 표: [감정, 세기, (두 번째 감정, 세기)] */
const NEED_TABLE: Record<string, [string, number, string?, number?]> = {
  need_hunger_low: ['sad', 1], need_hunger_crit: ['sad', 2, 'tense', 1], need_hunger_high: ['happy', 1],
  need_energy_low: ['tense', 1], need_energy_crit: ['tense', 2], need_energy_high: ['energized', 1],
  need_hygiene_low: ['angry', 1], need_hygiene_crit: ['ashamed', 2], need_hygiene_high: ['energized', 1],
  need_bladder_low: ['tense', 1], need_bladder_crit: ['tense', 3],
  need_fun_low: ['sad', 1], need_fun_crit: ['sad', 2], need_fun_high: ['excited', 1],
  need_social_low: ['sad', 1], need_social_crit: ['sad', 2], need_social_high: ['happy', 1],
  need_warmth_low: ['tense', 1], need_warmth_crit: ['tense', 2], need_warmth_high: ['happy', 1],
  need_comfort_low: ['angry', 1], need_comfort_crit: ['angry', 2], need_comfort_high: ['focused', 1],
};

// ── 파일 ──────────────────────────────────────────────────
const P = {
  moodlets: 'src/data/moodlets.json',
  moodletsM3: 'src/data/moodlets_m3.json',
  wishes: 'src/data/wishes.json',
  aspirations: 'src/data/aspirations.json',
  rewards: 'src/data/rewards.json',
  likes: 'src/data/likes.json',
  ko: 'src/i18n/ko/inner.json',
};
/** 문구 검사 대상 (이 검사 소관) */
const OWN_KO = ['src/i18n/ko/inner.json', 'src/i18n/ko/inner_fix.json'];
for (const p of Object.values(P)) if (!existsSync(p)) errors.push(`파일 없음: ${p}`);
if (errors.length) finish();

const atlas = json<{ sprites: Record<string, unknown> }>('src/data/ui/atlas.json');
const ICONS = new Set(Object.keys(atlas.sprites));
const interactionsJson = json<{ interactions: Record<string, unknown> }>('src/data/interactions.json');
const socialJson = json<{ interactions: Record<string, { tags?: string[] }> }>('src/data/social.json');
const SOCIAL_IDS = Object.keys(socialJson.interactions);
const INTERACTIONS = new Set([...Object.keys(interactionsJson.interactions), ...M2_INTERACTIONS, ...SOCIAL_IDS]);
// 태그: 계약 목록 + 실제 상호작용/사회 상호작용 태그 (M3 에서 늘어남)
for (const v of [...Object.values(interactionsJson.interactions as Record<string, { tags?: string[] }>), ...Object.values(socialJson.interactions)]) for (const t of v.tags ?? []) if (!TAGS.includes(t)) TAGS.push(t);
const OBJECTS = new Set(Object.keys(json<Record<string, unknown>>('src/data/objects.json')));
const outfits = json<{ dyes: Record<string, Record<string, string[]>> }>('src/data/outfits.json');
const DYES = new Set(Object.values(outfits.dyes).flatMap((r) => Object.values(r).flat()));
// 재고 품목: interactions.json 의 stock 키 전부
const STOCK = new Set<string>();
(function walk(v: unknown, parentKey?: string) {
  if (v && typeof v === 'object') {
    for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
      if (parentKey === 'stock' || k.startsWith('stock:')) STOCK.add(k.replace(/^stock:/, '').replace(/[<>=].*$/, ''));
      walk(c, k);
    }
  } else if (typeof v === 'string' && v.startsWith('stock:')) STOCK.add(v.slice(6).replace(/[<>=].*$/, ''));
})(interactionsJson);

// 리드 파일이 있으면 교차 확인
if (existsSync('src/data/emotions.json')) {
  const e = json<{ emotions: Record<string, unknown> }>('src/data/emotions.json');
  for (const id of EMOTIONS_ALL) if (!e.emotions[id]) warns.push(`emotions.json 에 계약 감정 ${id} 없음`);
}
let traitMoodletRefs: string[] = [];
if (existsSync('src/data/traits.json')) {
  const t = readFileSync('src/data/traits.json', 'utf8');
  traitMoodletRefs = [...new Set([...t.matchAll(/"moodlet"\s*:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]))];
}
let stressMoodletRefs: string[] = [];
if (existsSync('src/data/stress.json')) {
  const t = readFileSync('src/data/stress.json', 'utf8');
  stressMoodletRefs = [...new Set([...t.matchAll(/"moodlets?"\s*:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]))];
}

// ── 스키마 ────────────────────────────────────────────────
const snake = z.string().regex(/^[a-z][a-z0-9_]*$/, 'snake_case');
const duration = z.object({ value: z.number().positive(), scale: z.enum(SCALES) }).strict();
const emotion = z.enum(EMOTIONS);
const moodletSchema = z.object({
  nameKey: z.string(), descKey: z.string(), icon: z.string(), emotion, strength: z.number().int().min(1).max(3),
  duration: duration.optional(), while: z.string().optional(), permanent: z.literal(true).optional(),
  stack: z.enum(['replace', 'refresh', 'stack']), max: z.number().int().min(2).max(5).optional(),
  source: z.enum(SOURCES), group: snake.optional(),
  fade: z.array(z.tuple([z.number().positive(), z.number().int().min(1).max(2)])).optional(),
  extra: z.array(z.object({ emotion, strength: z.number().int().min(1).max(3) }).strict()).optional(),
  tags: z.array(z.string()).optional(),
}).strict();
const moodletsFile = z.object({ $comment: z.string().optional(), moodlets: z.record(snake, moodletSchema) }).strict();

const when = z.object({
  traitsAny: z.array(z.string()).optional(), estates: z.array(z.string()).optional(), stages: z.array(z.string()).optional(),
  emotionsAny: z.array(z.string()).optional(), minHour: z.number().min(0).max(23).optional(),
  // 확장
  maxHour: z.number().min(0).max(24).optional(), seasons: z.array(z.string()).optional(),
  virtuesAny: z.array(z.string()).optional(), likesAny: z.array(z.string()).optional(), aspirationsAny: z.array(z.string()).optional(),
}).strict();
const ev = z.object({ event: z.string() }).strict();
const wishSchema = z.discriminatedUnion('kind', [
  z.object({ id: snake, kind: z.literal('wish'), textKey: z.string(), icon: z.string(), weight: z.number().positive().optional(), when, fulfill: ev, points: z.number().int().positive(), expire: duration }).strict(),
  z.object({ id: snake, kind: z.literal('fear'), textKey: z.string(), icon: z.string(), weight: z.number().positive().optional(), when, realize: ev, resolve: ev, moodlet: snake, points: z.number().int().positive(), expire: duration.optional() }).strict(),
]);
const wishesFile = z.object({ $comment: z.string().optional(), wishes: z.array(wishSchema) }).strict();

type Need = { counter: string; gte: number | { value: number; scale: string } } | { any: Need[] };
const needSchema: z.ZodType<Need> = z.lazy(() => z.union([
  z.object({ counter: z.string(), gte: z.union([z.number().int().positive(), duration]) }).strict(),
  z.object({ any: z.array(needSchema).min(2) }).strict(),
]));
const aspirationSchema = z.object({
  id: snake, group: z.enum(['adult', 'noble', 'child']), nameKey: z.string(), descKey: z.string(), icon: z.string(),
  stages: z.array(z.object({ textKey: z.string(), need: z.array(needSchema).min(1) }).strict()).length(4),
  rewardTrait: snake.optional(), rewardTraitChoices: z.array(z.string()).min(1).optional(),
}).strict();
const aspirationsFile = z.object({ $comment: z.string().optional(), aspirations: z.array(aspirationSchema) }).strict();

const effects = z.object({
  needDecay: z.partialRecord(z.enum(NEEDS), z.number().positive()).optional(),
  adTag: z.record(z.string(), z.number().positive()).optional(),
  moodletDuration: z.partialRecord(emotion, z.number().positive()).optional(),
  moodletStrength: z.partialRecord(emotion, z.number().int()).optional(),
  moodletOnTag: z.array(z.object({ tag: z.string(), moodlet: snake }).strict()).optional(),
  stressOnTag: z.array(z.object({ tag: z.string(), delta: z.number() }).strict()).optional(),
}).strict();
const rewardSchema = z.object({
  id: snake, kind: z.enum(['shop', 'aspiration']), nameKey: z.string(), descKey: z.string(), icon: z.string(),
  cost: z.number().int().min(0), heritable: z.boolean(), effects, futureEffects: z.record(z.string(), z.number()).optional(),
}).strict();
const rewardsFile = z.object({ $comment: z.string().optional(), rewards: z.array(rewardSchema) }).strict();

const likeItem = z.object({
  nameKey: z.string(), interactions: z.array(z.string()).optional(), tags: z.array(z.string()).optional(),
  objects: z.array(z.string()).optional(), dyes: z.array(z.string()).optional(), seasons: z.array(z.string()).optional(),
  events: z.array(z.string()).optional(),
}).strict();
const likesFile = z.object({
  $comment: z.string().optional(),
  pickWeights: z.object({ $comment: z.string().optional(), active: z.number().min(0), future: z.number().min(0) }).strict().optional(),
  perPerson: z.object({ likes: z.object({ min: z.number().int(), max: z.number().int() }), dislikes: z.object({ min: z.number().int(), max: z.number().int() }) }),
  effects: z.object({ likedMoodlet: snake, dislikedMoodlet: snake, funRecoveryMult: z.number().positive(), seasonLikedMoodlet: snake.optional(), seasonDislikedMoodlet: snake.optional() }).strict(),
  categories: z.record(z.enum(['food', 'music', 'activity', 'color', 'season', 'animal']), z.object({ nameKey: z.string(), items: z.record(snake, likeItem) }).strict()),
}).strict();

function parse<T>(name: string, schema: z.ZodType<T>, path: string): T | undefined {
  const r = schema.safeParse(json<unknown>(path));
  if (!r.success) {
    for (const i of r.error.issues.slice(0, 30)) errors.push(`${name} 스키마: ${i.path.join('.')} ${i.message}`);
    return undefined;
  }
  return r.data;
}
const md = parse('moodlets', moodletsFile, P.moodlets);
const md3 = parse('moodlets_m3', moodletsFile, P.moodletsM3);
const wf = parse('wishes', wishesFile, P.wishes);
const af = parse('aspirations', aspirationsFile, P.aspirations);
const rf = parse('rewards', rewardsFile, P.rewards);
const lf = parse('likes', likesFile, P.likes);
// i18n: 게임처럼 ko/*.json 전부 합침. 문구 검사는 소관 파일만
const ko: Record<string, string> = {};
for (const f of readdirSync('src/i18n/ko')) if (f.endsWith('.json')) Object.assign(ko, json<Record<string, string>>(`src/i18n/ko/${f}`));
const ownKo: Record<string, string> = {};
for (const f of OWN_KO) if (existsSync(f)) Object.assign(ownKo, json<Record<string, string>>(f));
if (!md || !md3 || !wf || !af || !rf || !lf) finish();

for (const id of Object.keys(md3!.moodlets)) if (md!.moodlets[id]) errors.push(`무드렛 ${id} 가 moodlets.json 과 moodlets_m3.json 에 모두 있음`);
const moodlets = { ...md!.moodlets, ...md3!.moodlets };
const wishes = wf!.wishes;
const aspirations = af!.aspirations;
const rewards = rf!.rewards;
const likes = lf!;
const LIKE_IDS = new Set(Object.values(likes.categories).flatMap((c) => Object.keys(c.items)));
const ASP_IDS = new Set(aspirations.map((a) => a.id));

const usedKeys = new Set<string>();
const key = (where: string, k: string) => {
  usedKeys.add(k);
  if (!(k in ko)) errors.push(`${where}: i18n 키 없음 ${k}`);
};
const icon = (where: string, i: string) => { if (!ICONS.has(i)) errors.push(`${where}: 아이콘 ${i} 가 atlas 에 없음`); };
const inList = (where: string, what: string, v: string, list: Iterable<string>) => {
  if (![...list].includes(v)) errors.push(`${where}: ${what} ${v} 는 계약 목록에 없음`);
};

// ── 무드렛 ────────────────────────────────────────────────
for (const [id, m] of Object.entries(moodlets)) {
  const w = `moodlet ${id}`;
  key(w, m.nameKey); key(w, m.descKey);
  if (m.nameKey !== `moodlet.${id}` || m.descKey !== `moodlet.${id}.desc`) errors.push(`${w}: 키 이름 규칙 moodlet.<id>(.desc) 아님`);
  icon(w, m.icon);
  const modes = [m.duration, m.while, m.permanent].filter((x) => x !== undefined).length;
  if (modes !== 1) errors.push(`${w}: duration / while / permanent 중 정확히 하나여야 함`);
  if (m.while !== undefined) inList(w, 'while 조건', m.while, WHILE_IDS);
  if ((m.stack === 'stack') !== (m.max !== undefined)) errors.push(`${w}: stack 일 때만 max`);
  if (m.max !== undefined && m.max < m.strength) errors.push(`${w}: max 가 세기보다 작음`);
  if (m.fade) {
    let prevT = 0; let prevS = m.strength;
    for (const [t, s] of m.fade) {
      if (t <= prevT || s >= prevS) errors.push(`${w}: fade 는 시간 증가, 세기 감소 순서여야 함`);
      prevT = t; prevS = s;
    }
    if (m.duration && m.duration.scale === 'absolute' && prevT >= m.duration.value) errors.push(`${w}: fade 마지막 시점이 지속시간보다 늦음`);
  }
  for (const t of m.tags ?? []) inList(w, '태그', t, [...TAGS, ...MOODLET_EXTRA_TAGS]);
  if (id.startsWith('need_')) {
    const exp = NEED_TABLE[id];
    if (!exp) errors.push(`${w}: 11-1 표에 없는 욕구 무드렛`);
    else {
      const need = id.split('_')[1];
      if (m.source !== 'need' || m.group !== `need_${need}`) errors.push(`${w}: source need, group need_${need} 여야 함`);
      if (m.emotion !== exp[0] || m.strength !== exp[1]) errors.push(`${w}: 11-1 표는 ${exp[0]} ${exp[1]}`);
      const ex = m.extra?.[0];
      if (exp[2] ? !(ex && ex.emotion === exp[2] && ex.strength === exp[3]) : m.extra) errors.push(`${w}: 11-1 표 두 번째 감정 불일치`);
    }
  }
}
const requiredMoodlets = [...Object.keys(NEED_TABLE), ...ENGINE_MOODLETS];
for (const id of requiredMoodlets) if (!moodlets[id]) errors.push(`엔진 필수 무드렛 없음: ${id}`);
for (const [id, cond] of Object.entries(ENGINE_WHILE)) if (moodlets[id] && moodlets[id].while !== cond) errors.push(`moodlet ${id}: while 은 ${cond} 여야 함 (리드 요청)`);
for (const id of traitMoodletRefs) if (!moodlets[id]) errors.push(`traits.json 이 참조하는 무드렛 없음: ${id}`);
for (const id of stressMoodletRefs) if (!moodlets[id]) errors.push(`stress.json 이 참조하는 무드렛 없음: ${id}`);

// ── 이벤트 문법 ───────────────────────────────────────────
function checkEvent(where: string, e: string) {
  const i = e.indexOf(':');
  const kind = e.slice(0, i); const arg = e.slice(i + 1);
  if (i < 1 || !arg) return errors.push(`${where}: 이벤트 형식 오류 "${e}"`);
  switch (kind) {
    case 'done': if (!INTERACTIONS.has(arg)) errors.push(`${where}: 상호작용 ${arg} 없음`); break;
    case 'tag': inList(where, '태그', arg, TAGS); break;
    case 'need_high': inList(where, '욕구', arg, NEEDS); break;
    case 'moodlet': if (!moodlets[arg]) errors.push(`${where}: 무드렛 ${arg} 없음`); break;
    case 'emotion': inList(where, '감정', arg, EMOTIONS); break;
    case 'social': case 'social_ok': case 'social_recv': inList(where, '사회 상호작용', arg, [...SOCIAL, ...SOCIAL_IDS]); break;
    case 'stock_low': if (!STOCK.has(arg)) errors.push(`${where}: 재고 품목 ${arg} 없음 (interactions.json stock)`); break;
    case 'event': if (!/^[a-z][a-z0-9_]*$/.test(arg)) errors.push(`${where}: 사건 id snake_case 아님 ${arg}`); break;
    default: errors.push(`${where}: 알 수 없는 이벤트 종류 ${kind}`);
  }
}
const nowReachable = (e: string) => /^(done|social):/.test(e);
const soonReachable = (e: string) => /^(done|social|tag|need_high|moodlet|emotion|stock_low):/.test(e);

// ── 소원 / 걱정 ───────────────────────────────────────────
const wishIds = new Set<string>();
for (const w of wishes) {
  const where = `${w.kind} ${w.id}`;
  if (wishIds.has(w.id)) errors.push(`${where}: id 중복`);
  wishIds.add(w.id);
  if (w.kind === 'wish' && !w.id.startsWith('wish_')) errors.push(`${where}: 소원 id 는 wish_ 로 시작`);
  if (w.kind === 'fear' && !w.id.startsWith('fear_')) errors.push(`${where}: 걱정 id 는 fear_ 로 시작`);
  if (w.textKey !== `wish.${w.id}`) errors.push(`${where}: textKey 는 wish.<id>`);
  key(where, w.textKey); icon(where, w.icon);
  const c = w.when;
  for (const t of c.traitsAny ?? []) inList(where, '특성', t, TRAITS);
  for (const t of c.estates ?? []) inList(where, '신분', t, ESTATES);
  for (const t of c.stages ?? []) inList(where, '생애 단계', t, STAGES);
  for (const t of c.emotionsAny ?? []) inList(where, '감정', t, EMOTIONS);
  for (const t of c.seasons ?? []) inList(where, '계절', t, SEASONS);
  for (const t of c.virtuesAny ?? []) inList(where, '덕/죄', t, VIRTUES);
  for (const t of c.likesAny ?? []) if (!LIKE_IDS.has(t)) errors.push(`${where}: 호불호 ${t} 가 likes.json 에 없음`);
  for (const t of c.aspirationsAny ?? []) if (!ASP_IDS.has(t)) errors.push(`${where}: 인생 목표 ${t} 없음`);
  if (c.minHour !== undefined && c.maxHour !== undefined && c.minHour >= c.maxHour) errors.push(`${where}: minHour >= maxHour`);
  if (w.kind === 'wish') checkEvent(where, w.fulfill.event);
  else {
    checkEvent(`${where} realize`, w.realize.event);
    checkEvent(`${where} resolve`, w.resolve.event);
    if (!moodlets[w.moodlet]) errors.push(`${where}: 무드렛 ${w.moodlet} 없음`);
    if (w.realize.event === w.resolve.event) errors.push(`${where}: realize 와 resolve 가 같음`);
  }
}

// ── 보상 특성 ─────────────────────────────────────────────
const rewardById = new Map(rewards.map((r) => [r.id, r]));
if (rewardById.size !== rewards.length) errors.push('rewards: id 중복');
for (const r of rewards) {
  const where = `reward ${r.id}`;
  key(where, r.nameKey); key(where, r.descKey); icon(where, r.icon);
  if (r.nameKey !== `reward.${r.id}` || r.descKey !== `reward.${r.id}.desc`) errors.push(`${where}: 키 이름 규칙 reward.<id>(.desc) 아님`);
  if (TRAITS.includes(r.id)) errors.push(`${where}: 성격 특성 id 와 겹침`);
  if (r.kind === 'shop' && r.cost <= 0) errors.push(`${where}: 상점 보상은 cost > 0`);
  if (r.kind === 'aspiration' && r.cost !== 0) errors.push(`${where}: 인생 목표 보상은 cost 0`);
  const e = r.effects;
  for (const t of Object.keys(e.adTag ?? {})) inList(where, '태그', t, TAGS);
  for (const x of e.moodletOnTag ?? []) { inList(where, '태그', x.tag, TAGS); if (!moodlets[x.moodlet]) errors.push(`${where}: 무드렛 ${x.moodlet} 없음`); }
  for (const x of e.stressOnTag ?? []) inList(where, '태그', x.tag, TAGS);
  if (Object.keys(e).length === 0 && !r.futureEffects) errors.push(`${where}: 효과 없음`);
}

// ── 인생 목표 ─────────────────────────────────────────────
const usedRewardTraits = new Set<string>();
function checkNeed(where: string, n: Need) {
  if ('any' in n) return n.any.forEach((x) => checkNeed(where, x));
  checkEvent(where, n.counter);
}
for (const a of aspirations) {
  const where = `aspiration ${a.id}`;
  key(where, a.nameKey); key(where, a.descKey); icon(where, a.icon);
  a.stages.forEach((s, i) => { key(`${where} ${i + 1}단계`, s.textKey); s.need.forEach((n) => checkNeed(`${where} ${i + 1}단계`, n)); });
  if (a.group === 'child') {
    if (a.rewardTrait || !a.rewardTraitChoices) errors.push(`${where}: 아동 목표는 rewardTraitChoices 만`);
    for (const t of a.rewardTraitChoices ?? []) inList(where, '특성', t, TRAITS);
  } else {
    if (!a.rewardTrait || a.rewardTraitChoices) errors.push(`${where}: 성인/귀족 목표는 rewardTrait 만`);
    else {
      const r = rewardById.get(a.rewardTrait);
      if (!r) errors.push(`${where}: 보상 특성 ${a.rewardTrait} 가 rewards.json 에 없음`);
      else if (r.kind !== 'aspiration') errors.push(`${where}: 보상 특성 ${a.rewardTrait} 는 kind aspiration 이어야 함`);
      if (usedRewardTraits.has(a.rewardTrait)) errors.push(`${where}: 보상 특성 중복 사용 ${a.rewardTrait}`);
      usedRewardTraits.add(a.rewardTrait);
    }
  }
}
for (const r of rewards) if (r.kind === 'aspiration' && !usedRewardTraits.has(r.id)) warns.push(`reward ${r.id}: 어느 인생 목표도 쓰지 않음`);

// ── 호불호 ────────────────────────────────────────────────
if (!moodlets[likes.effects.likedMoodlet]) errors.push(`likes: 무드렛 ${likes.effects.likedMoodlet} 없음`);
if (!moodlets[likes.effects.dislikedMoodlet]) errors.push(`likes: 무드렛 ${likes.effects.dislikedMoodlet} 없음`);
for (const [cat, c] of Object.entries(likes.categories)) {
  key(`like ${cat}`, c.nameKey);
  for (const [id, it] of Object.entries(c.items)) {
    const where = `like ${id}`;
    key(where, it.nameKey);
    if (!id.startsWith(`${cat}_`)) errors.push(`${where}: id 는 ${cat}_ 로 시작`);
    const links = (it.interactions?.length ?? 0) + (it.tags?.length ?? 0) + (it.objects?.length ?? 0) + (it.dyes?.length ?? 0) + (it.seasons?.length ?? 0) + (it.events?.length ?? 0);
    if (!links) errors.push(`${where}: 알아보는 연결이 없음`);
    for (const x of it.interactions ?? []) if (!INTERACTIONS.has(x)) errors.push(`${where}: 상호작용 ${x} 없음`);
    for (const x of it.tags ?? []) inList(where, '태그', x, TAGS);
    for (const x of it.objects ?? []) if (!OBJECTS.has(x)) errors.push(`${where}: 물건 ${x} 없음`);
    for (const x of it.dyes ?? []) if (!DYES.has(x)) errors.push(`${where}: 염료 ${x} 가 outfits.json 에 없음`);
    for (const x of it.seasons ?? []) inList(where, '계절', x, SEASONS);
    for (const x of it.events ?? []) checkEvent(where, x);
  }
}

// ── i18n 문구 ─────────────────────────────────────────────
for (const [k, v] of Object.entries(ownKo)) {
  if (!usedKeys.has(k)) warns.push(`inner.json: 쓰지 않는 키 ${k}`);
  if (!v || !v.trim()) errors.push(`inner.json: 빈 문구 ${k}`);
  if (/[0-9A-Za-z]/.test(v.replace(/{[a-z_]+}/g, ''))) errors.push(`inner.json: 숫자/영문 포함 (수치·게임 용어 금지) ${k} = ${v}`);
}
for (const [id, m] of Object.entries(moodlets)) {
  const name = ko[m.nameKey] ?? '';
  const n = name.replace(/\s/g, '').length;
  if (n < 2 || n > 8) (md!.moodlets[id] ? errors : warns).push(`moodlet ${id}: 이름은 2~8자(공백 제외) "${name}"`);
  const d = ko[m.descKey] ?? '';
  if (!/[.!?]$/.test(d)) warns.push(`moodlet ${id}: 원인 문구가 문장으로 끝나지 않음 "${d}"`);
}

// ── 도달 가능성 (엔진과 같은 계산: src/sim/data/innerData.ts computeReach) ──
let reachRows: [string, number | string, string][] = [];
try {
  const sd = loadSimData();
  if (!sd.inner) throw new Error('내면 데이터 없음');
  const reach = computeReach(sd.inner, reachSourcesOf({ interactions: sd.interactions, social: sd.social, balance: sd.balance, relations: sd.relations, stress: sd.stress }));
  const all = sd.inner.wishes as WishDef[];
  const wAll = all.filter((w) => w.kind === 'wish');
  const fAll = all.filter((w) => w.kind === 'fear');
  const wOk = wAll.filter((w) => wishReachable(reach, w));
  const fOk = fAll.filter((w) => wishReachable(reach, w));
  const pct = (a: number, b: number) => `${a} / ${b} (${b ? Math.round((a / b) * 100) : 0}%)`;
  if (!wOk.length) errors.push('도달 가능성: 뽑힐 수 있는 소원이 0개');
  if (!fOk.length) errors.push('도달 가능성: 뽑힐 수 있는 걱정이 0개');
  let s1 = 0;
  for (const [id, a] of Object.entries(sd.inner.aspirations)) {
    if (needReachableAll(a.stages[0]?.need ?? [])) s1++;
    else errors.push(`도달 가능성: 인생 목표 ${id} 1단계가 지금 생기는 카운터로 도달 불가`);
  }
  function needReachableAll(ns: NeedCond[]) { return ns.every((n) => needReachable(reach, n)); }
  const stagesOk = Object.values(sd.inner.aspirations).reduce((n, a) => n + a.stages.filter((st) => st.need.every((x) => needReachable(reach, x))).length, 0);
  const stagesAll = Object.values(sd.inner.aspirations).reduce((n, a) => n + a.stages.length, 0);
  const likeKinds = { active: 0, future: 0, never: 0 };
  for (const id of sd.inner.likeIndex.items.keys()) likeKinds[likeReach(reach, sd.inner, id)]++;
  reachRows = [
    ['뽑힐 수 있는 소원 (이룰 수 있음)', pct(wOk.length, wAll.length), '> 0'],
    ['뽑힐 수 있는 걱정 (현실화·해소 둘 다 생김)', pct(fOk.length, fAll.length), '> 0'],
    ['인생 목표 1단계 도달 가능', pct(s1, Object.keys(sd.inner.aspirations).length), '전부'],
    ['인생 목표 단계 전체 중 도달 가능', pct(stagesOk, stagesAll), '(나머지는 M4 이후 사건)'],
    ['호불호 지금 걸림 / 나중 사건만 / 안 뽑힘(염료)', `${likeKinds.active} / ${likeKinds.future} / ${likeKinds.never}`, ''],
    ['발생 가능 사건·카운터 / 무드렛', `${reach.events.size} / ${reach.moodlets.size}`, ''],
  ];
} catch (e) {
  errors.push(`도달 가능성 계산 실패 (데이터 로드): ${(e as Error).message}`);
}

// ── 개수 표 ───────────────────────────────────────────────
const count = <T>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((a, x) => ((a[f(x)] = (a[f(x)] ?? 0) + 1), a), {});
const ml = Object.values(moodlets);
const ws = wishes.filter((w) => w.kind === 'wish');
const fs = wishes.filter((w) => w.kind === 'fear');
const wNow = ws.filter((w) => w.kind === 'wish' && nowReachable(w.fulfill.event)).length;
const wSoon = ws.filter((w) => w.kind === 'wish' && soonReachable(w.fulfill.event)).length;
const asp = count(aspirations, (a) => a.group);
const rw = count(rewards, (r) => r.kind);

const rows: [string, number | string, string][] = [
  ['무드렛', ml.length, '≥120 (최종 250)'],
  ['  엔진 필수 무드렛', `${requiredMoodlets.filter((id) => moodlets[id]).length}/${requiredMoodlets.length}`, '전부'],
  ['소원', ws.length, '≥70 (최종 200)'],
  ['  지금 이룰 수 있음(done:/social:)', `${wNow} (${Math.round((wNow / ws.length) * 100)}%)`, '≥50%'],
  ['  M2 시스템으로 이룰 수 있음(+tag/need/moodlet/emotion)', `${wSoon} (${Math.round((wSoon / ws.length) * 100)}%)`, ''],
  ['걱정', fs.length, '≥20 (최종 60)'],
  ['인생 목표 성인/귀족/아동', `${asp.adult ?? 0}/${asp.noble ?? 0}/${asp.child ?? 0}`, '12/2/4'],
  ['보상 특성 상점/목표 완료', `${rw.shop ?? 0}/${rw.aspiration ?? 0}`, '20/14'],
  ['  물려줄 수 있음', rewards.filter((r) => r.heritable).length, ''],
  ...Object.entries(likes.categories).map(([c, v]) => [`호불호 ${c}`, Object.keys(v.items).length, ({ food: '8', music: '4', activity: '6', color: '10', season: '4', animal: '몇 개' } as Record<string, string>)[c]] as [string, number, string]),
  ['i18n 키 (inner.json + inner_fix.json)', Object.keys(ownKo).length, ''],
];
if (ml.length < 120) errors.push(`무드렛 ${ml.length} < 120`);
if (ws.length < 70) errors.push(`소원 ${ws.length} < 70`);
if (fs.length < 20) errors.push(`걱정 ${fs.length} < 20`);
if (wNow * 2 < ws.length) errors.push(`지금 이룰 수 있는 소원 ${wNow}/${ws.length} 가 절반 미만`);
if ((asp.adult ?? 0) !== 12 || (asp.noble ?? 0) !== 2 || (asp.child ?? 0) !== 4) errors.push('인생 목표 개수는 성인 12 / 귀족 2 / 아동 4');
if ((rw.shop ?? 0) !== 20) errors.push(`상점 보상 특성 ${rw.shop ?? 0} != 20`);
const likeTarget: Record<string, number> = { food: 8, music: 4, activity: 6, color: 10, season: 4 };
for (const [c, n] of Object.entries(likeTarget)) if (Object.keys(likes.categories[c as 'food']?.items ?? {}).length !== n) errors.push(`호불호 ${c} 는 ${n}개`);

console.log('\n[내면 콘텐츠 개수]');
for (const [a, b, c] of rows) console.log(`  ${a.padEnd(44)} ${String(b).padStart(10)}   ${c}`);
console.log('\n[도달 가능성 — M2~M3 에서 실제로 생기는 사건/무드렛 기준]');
for (const [a, b, c] of reachRows) console.log(`  ${a.padEnd(44)} ${String(b).padStart(16)}   ${c}`);
console.log('\n  무드렛 출처별:', JSON.stringify(count(ml, (m) => m.source)));
console.log('  무드렛 감정별:', JSON.stringify(count(ml, (m) => m.emotion)));
console.log('  소원 이벤트 종류:', JSON.stringify(count(ws, (w) => (w.kind === 'wish' ? w.fulfill.event.split(':')[0] : ''))));
finish();

function finish(): never {
  for (const w of warns) console.warn(`경고: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`오류: ${e}`);
    console.error(`\ncheck-inner: 오류 ${errors.length}, 경고 ${warns.length}`);
    process.exit(1);
  }
  console.log(`\ncheck-inner: 통과 (경고 ${warns.length})`);
  process.exit(0);
}
