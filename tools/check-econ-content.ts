/**
 * M4 살림 콘텐츠 검사 (계약 artifacts/contracts-m4.md 1, 2, 3, 6, 7절 / GDD 17-1, 17-4, 17-5, 31-3).
 * - 형식(zod, strict): src/data/items.json, recipes.json, skills.json
 * - 개수: 품목(식료품 30종 이상), 레시피 분류별 목표(요리 20, 제빵 10, 양조 8, 보존 10, 바느질 10, 대장일 12, 목공 6, 약초 4 = 80), 스킬 25 (17-1 id 그대로)
 * - 참조: 레시피 입력/출력/연료 품목, 스테이션 태그 목록, 스킬 id, 태그(기존 게임 태그 + 새 태그 목록), 아이콘(아틀라스 키 또는 raven:a번호)
 * - 기존 재고 키 9개, 작물 수확물 id 16개, 직업 주문 품목 id 유지 (crops.json / careers.json 이 있으면 교차 확인)
 * - 생산 사슬: 모든 레시피가 원료(source)에서 도달 가능, 밀 → 빵, 보리 → 에일, 양모 → 옷, 철 → 편자 경로
 * - 가격: 17-4 물가표 ±30%, 장부 품목(economy.json goods) 기준가 × ration 과 ±30% (1파딩 반올림 허용), 부패 기간 17-5 표
 * - 스킬마다 레벨 0 레시피 2개 이상, 레벨 효과 필드
 * - i18n: 모든 키가 ko 합본에 있음, econ.json 문구에 숫자/영문 없음, 수위 금지어
 * 사용: npx tsx tools/check-econ-content.ts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { z } from 'zod';

const errors: string[] = [];
const warns: string[] = [];
const json = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

// ── 계약 목록 ─────────────────────────────────────────────
const ITEM_CATEGORIES = ['grain', 'vegetable', 'fruit', 'dairy', 'meat', 'fish', 'drink', 'baked', 'prepared', 'preserved', 'herb', 'seed', 'fuel', 'material', 'metal', 'cloth', 'tool', 'goods'] as const;
const FOOD_CATEGORIES = new Set(['grain', 'vegetable', 'fruit', 'dairy', 'meat', 'fish', 'drink', 'baked', 'prepared', 'preserved', 'herb']);
const STORAGE = ['cupboard', 'grain_bin', 'cellar', 'woodpile', 'chest'] as const;
const SOURCES = ['crop', 'animal', 'forage', 'hunt', 'well', 'market'] as const;
const STATIONS = ['hearth', 'oven', 'prep_counter', 'brew_vat', 'spinning_wheel', 'loom', 'workbench', 'forge', 'anvil', 'churn', 'smokehouse', 'salting_tub', 'mill', 'press'] as const;
const GROUP_TARGETS: Record<string, number> = { cooking: 20, baking: 10, brewing: 8, preserving: 10, needlework: 10, smithing: 12, carpentry: 6, herbalism: 4 };
const RECIPE_TOTAL = 80;
const SCALES = ['absolute', 'season', 'lifespan'] as const;
/** 17-1 표 그대로 (분류 → id) */
const SKILL_TABLE: Record<string, string[]> = {
  household: ['cooking', 'baking', 'brewing', 'needlework', 'farming', 'animal_care'],
  craft: ['smithing', 'carpentry', 'masonry', 'leatherwork'],
  learning: ['reading', 'reckoning', 'latin', 'herbalism', 'medicine'],
  art: ['music', 'singing', 'dance', 'storytelling'],
  body: ['fitness', 'martial', 'archery', 'riding'],
  faith: ['faith', 'arcana'],
};
const BUNDLES: Record<string, string[]> = {
  labor: ['fitness', 'farming', 'animal_care', 'smithing', 'masonry'],
  scholarly: ['reading', 'reckoning', 'latin', 'herbalism', 'medicine'],
  creative: ['music', 'singing', 'dance', 'storytelling', 'needlework', 'carpentry'],
};
const EXISTING_STOCK = ['firewood', 'water', 'ingredients', 'flour', 'bread', 'ale', 'preserves', 'herbs', 'yarn'];
const CROP_ITEMS = ['wheat', 'barley', 'oats', 'rye', 'beans', 'flax', 'turnip', 'cabbage', 'onion', 'leek', 'herbs', 'medicinal_herbs', 'moonwort', 'grapes', 'apples', 'pears'];
/** 리드가 작업자 B(직업 주문)에게 준 결과 품목 id — recipes 결과에 있어야 함 */
const ORDER_ITEMS = ['horseshoes', 'nails', 'sickle', 'hoe', 'knife', 'hinge', 'pot', 'plowshare', 'bread', 'dark_bread', 'honey_cake', 'meat_pie', 'ale', 'beer', 'cider', 'mead', 'cloth', 'tunic', 'cloak', 'stool', 'chest', 'bench_wood', 'cart_wheel', 'salve', 'tonic'];
const ORDER_RECIPES = ['mend_clothes'];
/** 게임 태그 (contracts-m2) — 이 밖은 새 태그로 보고 */
const M2_TAGS = ['clean', 'labor', 'rest', 'read', 'music', 'creative', 'nature', 'cook', 'eat_good', 'eat_plain', 'drink', 'exercise', 'repair', 'pray', 'social', 'family', 'kind', 'mean', 'gossip', 'flirt', 'romance', 'brag', 'humble', 'lie', 'charity', 'feast', 'fast', 'night_out', 'craft', 'study', 'solitary', 'outdoor', 'duty', 'guard', 'argue'];
/** M4 에서 새로 쓰는 태그 (레시피/스킬). 리드가 기존 상호작용에 붙여야 경험치가 들어옴 */
const NEW_TAGS = ['bake', 'brew', 'sew', 'smith', 'woodwork', 'herbal', 'farm', 'animal', 'stonework', 'leather', 'reckon', 'latin', 'heal', 'sing', 'dance', 'story', 'martial', 'archery', 'ride', 'arcane'];
/** 17-4 물가표 (파딩) */
const PRICE_TABLE: Record<string, number> = { bread: 3, ale: 3, porridge: 2, eggs: 1, firewood: 2, chicken: 12, tunic: 144, straw_bed: 96, feather_bed: 576 };
const BUNDLE_TABLE: Record<string, { n: number; price: number }> = { bread: { n: 4, price: 12 }, ale: { n: 4, price: 12 }, eggs: { n: 4, price: 4 } };
/** 17-5 부패 기간 표 */
const SPOIL_TABLE: Record<string, { value: number; scale: string }> = {
  fish: { value: 1, scale: 'absolute' }, milk: { value: 1, scale: 'absolute' },
  meat: { value: 2, scale: 'absolute' }, chicken: { value: 2, scale: 'absolute' },
  bread: { value: 3, scale: 'absolute' },
  turnip: { value: 4, scale: 'season' }, cabbage: { value: 4, scale: 'season' }, onion: { value: 4, scale: 'season' }, leek: { value: 4, scale: 'season' },
  cheese: { value: 21, scale: 'season' },
  wheat: { value: 42, scale: 'season' }, barley: { value: 42, scale: 'season' }, oats: { value: 42, scale: 'season' }, rye: { value: 42, scale: 'season' }, flour: { value: 42, scale: 'season' }, rye_flour: { value: 42, scale: 'season' },
  salt_meat: { value: 14, scale: 'season' }, smoked_meat: { value: 14, scale: 'season' }, salt_fish: { value: 14, scale: 'season' }, smoked_fish: { value: 14, scale: 'season' }, preserves: { value: 14, scale: 'season' },
  dried_fruit: { value: 21, scale: 'season' },
};
/** 생산 사슬 (17-5) 시작 품목 → 도착 품목 */
const CHAINS: [string, string][] = [['wheat', 'bread'], ['barley', 'ale'], ['wool', 'tunic'], ['iron', 'horseshoes'], ['rye', 'dark_bread'], ['flax', 'linen_shirt'], ['milk', 'cheese'], ['iron', 'plowshare']];
const RAVEN_MAX = 516 * 16; // 16x16 전체 시트 (256 × 8256)
const BANNED_KO = ['자살', '자해', '목을 매', '고문', '화형', '강간', '겁탈', '성기', '나체', '알몸', '성행위', '성교', '섹스', '예수', '그리스도', '성모', '마리아', '알라', '부처', '석가', '무함마드', '여호와', '야훼', '노예'];

// ── 파일 ──────────────────────────────────────────────────
const P = {
  items: 'src/data/items.json',
  recipes: 'src/data/recipes.json',
  skills: 'src/data/skills.json',
  economy: 'src/data/economy.json',
  atlas: 'src/data/ui/atlas.json',
  interactions: 'src/data/interactions.json',
  social: 'src/data/social.json',
  koEcon: 'src/i18n/ko/econ.json',
};
for (const p of Object.values(P)) if (!existsSync(p)) errors.push(`파일 없음: ${p}`);
if (errors.length) finish();

// ── 스키마 ────────────────────────────────────────────────
const Dur = z.object({ value: z.number().positive(), scale: z.enum(SCALES) }).strict();
const Count = z.record(z.string(), z.number().int().positive());
const Item = z
  .object({
    nameKey: z.string().regex(/^item\.[a-z0-9_]+$/),
    icon: z.string().min(1),
    category: z.enum(ITEM_CATEGORIES),
    ledger: z.string().nullable(),
    ration: z.number().positive().nullable(),
    base: z.number().int().nonnegative(),
    bundle: z.object({ n: z.number().int().min(2), price: z.number().int().positive() }).strict().optional(),
    spoil: Dur.optional(),
    food: z.object({ hunger: z.number().min(0).max(100), quality: z.number().int().min(0).max(3) }).strict().optional(),
    storage: z.enum(STORAGE),
    source: z.array(z.enum(SOURCES)).min(1).optional(),
  })
  .strict();
const Recipe = z
  .object({
    nameKey: z.string().regex(/^recipe\.[a-z0-9_]+$/),
    icon: z.string().min(1),
    group: z.enum(Object.keys(GROUP_TARGETS) as [string, ...string[]]),
    station: z.enum(STATIONS),
    skill: z.string(),
    level: z.number().int().min(0).max(10),
    inputs: Count,
    outputs: Count,
    minutes: z.number().int().positive().max(24 * 60),
    xp: z.number().positive().max(3),
    tags: z.array(z.string()).min(1),
    quality: z.boolean(),
    fuel: Count.optional(),
    wait: Dur.optional(),
    service: z.literal(true).optional(),
  })
  .strict();
const LevelFx = z
  .object({
    unlockKey: z.string().regex(/^skill\.[a-z_]+\.l\d+$/).optional(),
    quality: z.number().int().min(1).max(3).optional(),
    speed: z.number().min(0.5).max(1).optional(),
    success: z.number().min(1).max(50).optional(),
    masterwork: z.literal(true).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, '빈 레벨 효과');
const Skill = z
  .object({
    nameKey: z.string().regex(/^skill\.[a-z_]+$/),
    icon: z.string().min(1),
    category: z.enum(Object.keys(SKILL_TABLE) as [string, ...string[]]),
    tags: z.array(z.string()).min(1),
    levels: z.record(z.string().regex(/^(10|[1-9])$/), LevelFx),
  })
  .strict();
const Skills = z
  .object({
    $comment: z.string().optional(),
    xpBase: Dur,
    curve: z.object({ a: z.number().positive(), p: z.number().positive() }).strict(),
    maxLevel: z.number().int(),
    bundles: z.record(z.string(), z.array(z.string())),
    skills: z.record(z.string(), Skill),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, data: unknown, where: string): T | null {
  const r = schema.safeParse(data);
  if (!r.success) {
    for (const i of r.error.issues.slice(0, 20)) errors.push(`${where}: 형식 ${i.path.join('.')} ${i.message}`);
    return null;
  }
  return r.data;
}

type ItemT = z.infer<typeof Item>;
type RecipeT = z.infer<typeof Recipe>;
const rawItems = json<{ items: Record<string, unknown> }>(P.items).items ?? {};
const rawRecipes = json<{ recipes: Record<string, unknown> }>(P.recipes).recipes ?? {};
const items: Record<string, ItemT> = {};
const recipes: Record<string, RecipeT> = {};
for (const [id, v] of Object.entries(rawItems)) {
  if (!/^[a-z][a-z0-9_]*$/.test(id)) errors.push(`품목 id 형식: ${id}`);
  const p = parse(Item, v, `품목 ${id}`);
  if (p) items[id] = p;
}
for (const [id, v] of Object.entries(rawRecipes)) {
  if (!/^[a-z][a-z0-9_]*$/.test(id)) errors.push(`레시피 id 형식: ${id}`);
  const p = parse(Recipe, v, `레시피 ${id}`);
  if (p) recipes[id] = p;
}
const skillsJson = parse(Skills, json(P.skills), 'skills.json');
const skills = skillsJson?.skills ?? {};

// ── 참조 자료 ──────────────────────────────────────────────
const economy = json<{ goods: Record<string, { base: number } | string> }>(P.economy);
const GOODS: Record<string, { base: number }> = {};
for (const [k, v] of Object.entries(economy.goods)) if (typeof v === 'object') GOODS[k] = v;
const ATLAS = new Set(Object.keys(json<{ sprites: Record<string, unknown> }>(P.atlas).sprites));
const GAME_TAGS = new Set(M2_TAGS);
for (const f of [P.interactions, P.social])
  (function walk(v: unknown) {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object')
      for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'tags' && Array.isArray(c)) c.forEach((t) => typeof t === 'string' && GAME_TAGS.add(t));
        else walk(c);
      }
  })(json(f));
const KNOWN_TAGS = new Set([...GAME_TAGS, ...NEW_TAGS]);
const koFiles = readdirSync('src/i18n/ko').filter((f) => f.endsWith('.json'));
const koByFile: Record<string, Record<string, string>> = Object.fromEntries(koFiles.map((f) => [f, json<Record<string, string>>(`src/i18n/ko/${f}`)]));
const ko: Record<string, string> = Object.assign({}, ...Object.values(koByFile));
const koEcon = koByFile['econ.json'] ?? {};

function checkIcon(icon: string, where: string) {
  const m = /^raven:a(\d+)$/.exec(icon);
  if (m) {
    const n = Number(m[1]);
    if (n < 1 || n > RAVEN_MAX) errors.push(`${where}: raven 번호 범위 밖 ${icon}`);
  } else if (!ATLAS.has(icon)) errors.push(`${where}: 아이콘 ${icon} 이 아틀라스에 없음 (raven:a번호 형식도 아님)`);
}
const near = (v: number, target: number, tol = 0.3) => Math.abs(v - target) <= Math.max(1, target * tol);

// ── 1. 품목 ────────────────────────────────────────────────
const itemIds = Object.keys(items);
const foodCount = itemIds.filter((id) => FOOD_CATEGORIES.has(items[id].category)).length;
if (foodCount < 30) errors.push(`식료품 ${foodCount}종 < 30 (17-5)`);
if (itemIds.length < 40) errors.push(`품목 ${itemIds.length}개 < 40 (계약: 합계 50 안팎)`);
for (const id of [...EXISTING_STOCK, ...CROP_ITEMS]) if (!items[id]) errors.push(`필수 품목 없음: ${id}`);
const ledgerUsed = new Set<string>();
const ravenUse: Record<string, string[]> = {};
for (const [id, it] of Object.entries(items)) {
  if (it.nameKey !== `item.${id}`) errors.push(`품목 ${id}: nameKey 는 item.${id}`);
  checkIcon(it.icon, `품목 ${id}`);
  if (it.icon.startsWith('raven:')) (ravenUse[it.icon] ??= []).push(id);
  if (it.ledger !== null) {
    const g = GOODS[it.ledger];
    if (!g) errors.push(`품목 ${id}: ledger ${it.ledger} 가 economy.json goods 에 없음`);
    else if (it.ration === null) errors.push(`품목 ${id}: ledger 가 있으면 ration 필요`);
    else {
      ledgerUsed.add(it.ledger);
      const expect = g.base * it.ration;
      if (!near(it.base, expect)) errors.push(`품목 ${id}: 기준가 ${it.base} 가 장부 ${it.ledger} ${g.base} × ${it.ration} = ${expect.toFixed(1)} 와 30% 넘게 다름`);
    }
  } else if (it.ration !== null) errors.push(`품목 ${id}: ledger 가 null 이면 ration 도 null`);
  if (it.bundle && !near(it.bundle.price, it.bundle.n * it.base, 0.35)) errors.push(`품목 ${id}: 묶음 가격 ${it.bundle.price} 가 ${it.bundle.n} × ${it.base} 와 너무 다름`);
  if (PRICE_TABLE[id] !== undefined && !near(it.base, PRICE_TABLE[id])) errors.push(`품목 ${id}: 기준가 ${it.base} 가 17-4 물가표 ${PRICE_TABLE[id]} 의 ±30% 밖`);
  const bt = BUNDLE_TABLE[id];
  if (bt && (!it.bundle || it.bundle.n !== bt.n || !near(it.bundle.price, bt.price))) errors.push(`품목 ${id}: 묶음 가격이 17-4 (${bt.n}개 ${bt.price}파딩) 와 다름`);
  const sp = SPOIL_TABLE[id];
  if (sp && (!it.spoil || it.spoil.scale !== sp.scale || !near(it.spoil.value, sp.value, 0.2))) errors.push(`품목 ${id}: 부패 기간이 17-5 표 (${sp.value} ${sp.scale}) 와 다름`);
  if (it.food && !FOOD_CATEGORIES.has(it.category) && it.category !== 'goods') warns.push(`품목 ${id}: ${it.category} 인데 food 가 있음`);
}
for (const g of Object.keys(GOODS)) if (!ledgerUsed.has(g)) errors.push(`장부 품목 ${g} 에 연결된 품목이 없음`);
for (const [icon, ids] of Object.entries(ravenUse)) if (ids.length > 1) warns.push(`같은 raven 아이콘 ${icon}: ${ids.join(', ')}`);
// 아틀라스에 이미 있는 raven 칸을 raven:a 로 또 쓰지 않음 (아틀라스 키를 쓰라)
{
  const atlasRaven = new Map<number, string>();
  for (const [k, v] of Object.entries(json<{ sprites: Record<string, { src?: string }> }>(P.atlas).sprites)) {
    const m = /Full Spritesheet\/16x16\.png#(\d+),(\d+)/.exec(v.src ?? '');
    if (m) atlasRaven.set((Number(m[2]) / 16) * 16 + Number(m[1]) / 16 + 1, k);
  }
  for (const icon of Object.keys(ravenUse)) {
    const k = atlasRaven.get(Number(icon.slice(7)));
    if (k) warns.push(`${icon} 는 아틀라스 키 ${k} 와 같은 칸 (${ravenUse[icon].join(', ')})`);
  }
}

// ── 2. 레시피 ──────────────────────────────────────────────
const recipeIds = Object.keys(recipes);
if (recipeIds.length !== RECIPE_TOTAL) errors.push(`레시피 ${recipeIds.length}개 ≠ ${RECIPE_TOTAL}`);
const groupCount: Record<string, number> = {};
const produced = new Map<string, string[]>();
const levelZero: Record<string, number> = {};
const newTagUse = new Set<string>();
for (const [id, r] of Object.entries(recipes)) {
  groupCount[r.group] = (groupCount[r.group] ?? 0) + 1;
  if (r.nameKey !== `recipe.${id}`) errors.push(`레시피 ${id}: nameKey 는 recipe.${id}`);
  checkIcon(r.icon, `레시피 ${id}`);
  if (!skills[r.skill]) errors.push(`레시피 ${id}: 스킬 ${r.skill} 없음`);
  if (r.level === 0) levelZero[r.skill] = (levelZero[r.skill] ?? 0) + 1;
  for (const [k, where] of [
    ...Object.keys(r.inputs).map((k) => [k, '입력'] as const),
    ...Object.keys(r.outputs).map((k) => [k, '출력'] as const),
    ...Object.keys(r.fuel ?? {}).map((k) => [k, '연료'] as const),
  ])
    if (!items[k]) errors.push(`레시피 ${id}: ${where} 품목 ${k} 가 items.json 에 없음`);
  for (const k of Object.keys(r.fuel ?? {})) if (items[k] && items[k].category !== 'fuel') errors.push(`레시피 ${id}: 연료 ${k} 가 fuel 분류가 아님`);
  if (Object.keys(r.outputs).length === 0 && !r.service) errors.push(`레시피 ${id}: 출력 없음 (수선이면 service: true)`);
  if (r.service && Object.keys(r.outputs).length > 0) errors.push(`레시피 ${id}: service 인데 출력이 있음`);
  if (Object.keys(r.inputs).length === 0 && !r.service) errors.push(`레시피 ${id}: 입력 없음`);
  for (const k of Object.keys(r.outputs)) {
    if (r.inputs[k]) errors.push(`레시피 ${id}: ${k} 가 입력이자 출력`);
    produced.set(k, [...(produced.get(k) ?? []), id]);
  }
  for (const t of r.tags) {
    if (!KNOWN_TAGS.has(t)) errors.push(`레시피 ${id}: 모르는 태그 ${t}`);
    if (!GAME_TAGS.has(t)) newTagUse.add(t);
  }
  if (r.station === 'mill' && r.group !== 'baking') warns.push(`레시피 ${id}: 방앗간 레시피가 제빵 분류 밖`);
  // 값 점검: 결과 기준가 합이 원료 + 연료보다 작으면 손해 레시피
  if (!r.service) {
    const cost = [...Object.entries(r.inputs), ...Object.entries(r.fuel ?? {})].reduce((s, [k, n]) => s + (items[k]?.base ?? 0) * n, 0);
    const value = Object.entries(r.outputs).reduce((s, [k, n]) => s + (items[k]?.base ?? 0) * n, 0);
    if (value < cost) warns.push(`레시피 ${id}: 결과 값 ${value} < 원료 값 ${cost} (파딩)`);
  }
}
for (const [g, n] of Object.entries(GROUP_TARGETS)) if ((groupCount[g] ?? 0) !== n) errors.push(`레시피 분류 ${g}: ${groupCount[g] ?? 0}개 ≠ 목표 ${n}`);
const recipeSkills = new Set(Object.values(recipes).map((r) => r.skill));
for (const s of recipeSkills) if ((levelZero[s] ?? 0) < 2) errors.push(`스킬 ${s}: 레벨 0 레시피 ${levelZero[s] ?? 0}개 < 2`);
for (const id of ORDER_ITEMS) if (!produced.has(id)) errors.push(`주문 품목 ${id} 를 만드는 레시피가 없음`);
for (const id of ORDER_RECIPES) if (!recipes[id]) errors.push(`주문 레시피 ${id} 없음`);
// 모든 품목은 원료(source)이거나 어떤 레시피의 결과
for (const [id, it] of Object.entries(items)) if (!it.source && !produced.has(id)) errors.push(`품목 ${id}: source 도 없고 만드는 레시피도 없음 (사슬 끊김)`);
for (const id of CROP_ITEMS) if (items[id] && !items[id].source?.includes('crop')) errors.push(`작물 수확물 ${id}: source 에 crop 이 없음`);

// 도달 가능성: 원료에서 시작해 레시피를 반복 적용
{
  const have = new Set(itemIds.filter((id) => items[id].source));
  let grew = true;
  const done = new Set<string>();
  while (grew) {
    grew = false;
    for (const [id, r] of Object.entries(recipes)) {
      if (done.has(id)) continue;
      if ([...Object.keys(r.inputs), ...Object.keys(r.fuel ?? {})].every((k) => have.has(k))) {
        done.add(id);
        grew = true;
        Object.keys(r.outputs).forEach((k) => have.add(k));
      }
    }
  }
  for (const id of recipeIds) if (!done.has(id)) errors.push(`레시피 ${id}: 원료에서 도달할 수 없음`);
  // 사슬 경로: 시작 품목을 입력으로 쓰는 레시피를 따라감
  for (const [from, to] of CHAINS) {
    const seen = new Set([from]);
    const q = [from];
    while (q.length) {
      const cur = q.shift()!;
      for (const r of Object.values(recipes))
        if (r.inputs[cur] || r.fuel?.[cur])
          for (const o of Object.keys(r.outputs))
            if (!seen.has(o)) {
              seen.add(o);
              q.push(o);
            }
    }
    if (!seen.has(to)) errors.push(`생산 사슬 끊김: ${from} → ${to}`);
  }
}
// 쓰이지 않는 품목 (입력/연료도 아니고 먹지도 못하고 주문 품목도 아님) — 참고
{
  const used = new Set<string>();
  for (const r of Object.values(recipes)) [...Object.keys(r.inputs), ...Object.keys(r.fuel ?? {})].forEach((k) => used.add(k));
  const idle = itemIds.filter((id) => !used.has(id) && !items[id].food && !ORDER_ITEMS.includes(id) && !EXISTING_STOCK.includes(id));
  if (idle.length) warns.push(`레시피 입력으로 안 쓰이는 비식품 (팔거나 쓰는 물건): ${idle.join(', ')}`);
}

// ── 3. 스킬 ────────────────────────────────────────────────
if (skillsJson) {
  const want = Object.values(SKILL_TABLE).flat();
  const have = Object.keys(skills);
  if (have.length !== 25) errors.push(`스킬 ${have.length}개 ≠ 25`);
  for (const id of want) if (!skills[id]) errors.push(`17-1 스킬 없음: ${id}`);
  for (const id of have) if (!want.includes(id)) errors.push(`17-1 표에 없는 스킬: ${id}`);
  for (const [cat, ids] of Object.entries(SKILL_TABLE)) for (const id of ids) if (skills[id] && skills[id].category !== cat) errors.push(`스킬 ${id}: 분류 ${skills[id].category} ≠ ${cat}`);
  for (const [b, ids] of Object.entries(BUNDLES)) {
    const got = skillsJson.bundles[b] ?? [];
    if (got.length !== ids.length || ids.some((i) => !got.includes(i))) errors.push(`스킬 묶음 ${b} 가 17-1 과 다름`);
  }
  for (const b of Object.keys(skillsJson.bundles)) if (!BUNDLES[b]) errors.push(`모르는 스킬 묶음 ${b}`);
  if (skillsJson.xpBase.value !== 0.45 || skillsJson.xpBase.scale !== 'lifespan') errors.push('xpBase 는 0.45 lifespan (17-1)');
  if (skillsJson.curve.a !== 100 || skillsJson.curve.p !== 1.4 || skillsJson.maxLevel !== 10) errors.push('curve 는 100 × n^1.4, maxLevel 10 (17-1)');
  for (const [id, s] of Object.entries(skills)) {
    if (s.nameKey !== `skill.${id}`) errors.push(`스킬 ${id}: nameKey 는 skill.${id}`);
    checkIcon(s.icon, `스킬 ${id}`);
    for (const t of s.tags) {
      if (!KNOWN_TAGS.has(t)) errors.push(`스킬 ${id}: 모르는 태그 ${t}`);
      if (!GAME_TAGS.has(t)) newTagUse.add(t);
    }
    if (Object.keys(s.levels).length < 3) errors.push(`스킬 ${id}: 레벨 효과 ${Object.keys(s.levels).length}개 < 3`);
    for (const [n, fx] of Object.entries(s.levels)) if (fx.unlockKey && fx.unlockKey !== `skill.${id}.l${n}`) errors.push(`스킬 ${id} 레벨 ${n}: unlockKey 는 skill.${id}.l${n}`);
    // 레시피 해금 레벨에는 해금 설명이 있어야 함
    const lv = new Set(Object.values(recipes).filter((r) => r.skill === id && r.level > 0).map((r) => r.level));
    for (const n of lv) if (!s.levels[String(n)]?.unlockKey) errors.push(`스킬 ${id}: 레시피가 열리는 레벨 ${n} 에 unlockKey 없음`);
  }
  const craftSkills = ['cooking', 'baking', 'brewing', 'needlework', 'smithing', 'carpentry', 'masonry', 'leatherwork'];
  for (const id of craftSkills) if (skills[id] && !Object.entries(skills[id].levels).some(([n, fx]) => fx.masterwork && Number(n) >= 8)) errors.push(`스킬 ${id}: 걸작(8 이상) 효과 없음 (17-1)`);
}
// 스킬 태그로 경험치를 받는 길이 있는지 (기존 상호작용 태그 또는 레시피)
for (const [id, s] of Object.entries(skills)) {
  const reach = s.tags.some((t) => GAME_TAGS.has(t)) || recipeSkills.has(id);
  if (!reach) warns.push(`스킬 ${id}: 아직 경험치 받을 상호작용 없음 (새 태그 ${s.tags.join(', ')} 를 리드가 붙여야 함)`);
}

// ── 교차: 작업자 B 파일 (있으면) ─────────────────────────────
if (existsSync('src/data/crops.json')) {
  const crops = json<{ crops?: Record<string, { yield?: { item?: string }; seed?: { item?: string } }> }>('src/data/crops.json').crops ?? {};
  for (const [id, c] of Object.entries(crops)) {
    for (const k of [c.yield?.item, c.seed?.item]) if (k && !items[k]) errors.push(`crops.json ${id}: 품목 ${k} 가 items.json 에 없음`);
  }
} else warns.push('crops.json 아직 없음 (작업자 B) — 작물 교차 확인 건너뜀');
if (existsSync('src/data/careers.json')) {
  type Order = string | { item?: string };
  const careers = json<{ careers?: Record<string, { orders?: { pool?: Order[] }; workplace?: string; type?: string }> }>('src/data/careers.json').careers ?? {};
  for (const [id, c] of Object.entries(careers)) {
    for (const o of c.orders?.pool ?? []) {
      const k = typeof o === 'string' ? o : o.item;
      if (!k) errors.push(`careers.json ${id}: 주문 항목에 item 없음`);
      else if (!produced.has(k) && !recipes[k]) errors.push(`careers.json ${id}: 주문 ${k} 가 레시피 결과/레시피 id 에 없음`);
      else if (recipes[k] && !produced.has(k) && !recipes[k].service) warns.push(`careers.json ${id}: 주문 ${k} 는 레시피 id (결과 품목 아님)`);
    }
    if (c.orders && c.workplace && !STATIONS.includes(c.workplace as (typeof STATIONS)[number]) && !['church', 'inn', 'square', 'castle', 'clinic', 'tiltyard'].includes(c.workplace))
      warns.push(`careers.json ${id}: 일터 ${c.workplace} 가 레시피 스테이션 목록 밖`);
  }
} else warns.push('careers.json 아직 없음 (작업자 B) — 주문 교차 확인 건너뜀');

// ── 6. i18n ────────────────────────────────────────────────
const keys: [string, string][] = [
  ...Object.entries(items).map(([id, v]) => [v.nameKey, `품목 ${id}`] as [string, string]),
  ...Object.entries(recipes).map(([id, v]) => [v.nameKey, `레시피 ${id}`] as [string, string]),
  ...Object.entries(skills).flatMap(([id, s]) => [[s.nameKey, `스킬 ${id}`] as [string, string], ...Object.values(s.levels).filter((f) => f.unlockKey).map((f) => [f.unlockKey!, `스킬 ${id}`] as [string, string])]),
];
for (const [k, where] of keys) if (!(k in ko)) errors.push(`i18n 누락: ${k} (${where})`);
const used = new Set(keys.map(([k]) => k));
for (const [k, v] of Object.entries(koEcon)) {
  if (!/^(item|recipe|skill)\./.test(k)) errors.push(`econ.json: 작업자 A 범위 밖 키 ${k}`);
  else if (!used.has(k)) warns.push(`econ.json: 안 쓰는 키 ${k}`);
  if (/[0-9A-Za-z]/.test(v)) errors.push(`econ.json ${k}: 숫자/영문 노출 "${v}"`);
  for (const b of BANNED_KO) if (v.includes(b)) errors.push(`econ.json ${k}: 금지어 ${b}`);
  for (const [f, tbl] of Object.entries(koByFile)) if (f !== 'econ.json' && k in tbl && tbl[k] !== v) warns.push(`i18n 키 ${k} 가 ${f} 에도 있고 값이 다름 ("${tbl[k]}" / "${v}")`);
}

// ── 결과 ───────────────────────────────────────────────────
console.log(`품목 ${itemIds.length}개 (식료품 ${foodCount}) / 레시피 ${recipeIds.length}개 / 스킬 ${Object.keys(skills).length}개`);
console.log('레시피 분류: ' + Object.entries(GROUP_TARGETS).map(([g, n]) => `${g} ${groupCount[g] ?? 0}/${n}`).join(', '));
console.log(`새 태그 (리드가 상호작용에 붙일 것): ${[...newTagUse].sort().join(', ') || '없음'}`);
finish();

function finish(): never {
  for (const w of warns) console.log(`경고: ${w}`);
  for (const e of errors) console.log(`오류: ${e}`);
  console.log(errors.length ? `실패 (오류 ${errors.length}, 경고 ${warns.length})` : `통과 (경고 ${warns.length})`);
  process.exit(errors.length ? 1 : 0);
}
