/**
 * M3 "사람들" 사회 콘텐츠 검사 (계약 artifacts/contracts-m3.md 1, 2, 4절 / GDD 14-3).
 * - 형식(zod, strict): src/data/social.json 의 모든 필드 타입 (계약 문법 + 엔진이 받는 requires 확장 relNone, romanceLte, targetTraitsAny, targetMoodletAny, actorVirtueAny/actorSinAny/actorEstateAny/adult + targetEstateAny)
 * - 분류별 개수 표와 목표(기본 10, 친근 18, 로맨스 14, 짓궂음 14, 신분 10, 거래 6, 특수 10 이상, 합계 80 이상), 기존 12개 id 유지
 * - 무드렛/특성/태그/아이콘/관계 이름/감정/신분/재고 품목/주제 id 가 존재
 * - base 5~95, 성공·실패 결과 모두 채움(무드렛 1개 이상, 실패는 손해가 있어야), 로맨스 분류는 romance 태그, 짓궂음은 mean 태그
 * - 자율 광고(ads) 개수 30~40, 큰 결정(청혼, 동침 제안, 결투 신청, 뇌물 …)과 관계 표식을 바꾸는 상호작용은 ads 없음
 * - i18n 누락 0 (src/i18n/ko/*.json 합본), src/i18n/ko/social.json 문구에 숫자/영문 없음, 새 무드렛 이름 2~8자
 * - 수위 금지어 (17세: 노골적 성행위, 자살/자해, 고문, 화형, 실존 종교 인물)
 * - 이웃 src/data/neighbors.json: 12명, 신분 분포, 성인/노년, 특성 3개와 충돌 규칙, 덕/죄
 * 사용: npx tsx tools/check-social.ts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { z } from 'zod';

const errors: string[] = [];
const warns: string[] = [];
const json = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

// ── 계약 목록 ─────────────────────────────────────────────
const CATEGORIES = ['basic', 'friendly', 'romance', 'mean', 'status', 'trade', 'special'] as const;
const TARGETS: Record<(typeof CATEGORIES)[number], number> = { basic: 10, friendly: 18, romance: 14, mean: 14, status: 10, trade: 6, special: 10 };
const TOTAL_MIN = 80;
const ADS_RANGE: [number, number] = [30, 40];
const EXISTING = ['social.chat', 'social.deep_talk', 'social.joke', 'social.comfort', 'social.hug', 'social.tease', 'social.gossip', 'social.argue', 'social.flirt', 'social.brag', 'social.apologize', 'social.trick'];
/** 플레이어 전용이어야 하는 큰 결정 (ads 금지) */
const NO_ADS = ['social.confess', 'social.propose', 'social.propose_bed', 'social.challenge_duel', 'social.bribe', 'social.break_up', 'social.slap', 'social.punch', 'social.curse', 'social.spread_rumor', 'social.scheme', 'social.seduce', 'social.command', 'social.petition', 'social.ask_loan', 'social.take_apprentice'];
const EMOTIONS = ['happy', 'energized', 'focused', 'excited', 'inspired', 'pious', 'sad', 'angry', 'tense', 'ashamed', 'neutral'] as const;
const NEEDS = ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social', 'warmth', 'comfort'] as const;
const REL_NAMES = ['stranger', 'acquaintance', 'friend', 'best_friend', 'rival', 'enemy', 'lover', 'engaged', 'spouse', 'ex_spouse'] as const;
const REL_FLAGS = ['lover', 'engaged', 'spouse', 'ex_spouse'];
const TOPICS = ['weather', 'food', 'love', 'work', 'faith', 'gossip', 'family', 'war', 'plague'] as const;
const ESTATES = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'] as const;
const M2_TAGS = [
  'clean', 'labor', 'rest', 'read', 'music', 'creative', 'nature', 'cook', 'eat_good', 'drink', 'exercise', 'repair', 'pray',
  'social', 'family', 'kind', 'mean', 'gossip', 'flirt', 'romance', 'brag', 'humble', 'lie', 'charity', 'feast', 'fast',
  'night_out', 'craft', 'study', 'solitary',
];
const NEIGHBOR_ESTATES: Record<string, number> = { serf: 4, freeman: 3, artisan: 2, merchant: 1, clergy: 1, knight: 1 };
/** 수위 금지어 (00_개요 "수위와 톤", 17세) */
const BANNED_KO = ['자살', '자해', '목을 매', '고문', '화형', '강간', '겁탈', '성기', '나체', '알몸', '성행위', '성교', '섹스', '정사를', '신음', '애무', '젖가슴', '예수', '그리스도', '성모', '마리아', '알라', '부처', '석가', '무함마드', '여호와', '야훼', '노예'];
const BANNED_EN = /suicide|self_harm|torture|burn_at|stake|rape|sex|nude|naked|slave|jesus|christ|allah|buddha/;

// ── 파일 ──────────────────────────────────────────────────
const P = {
  social: 'src/data/social.json',
  neighbors: 'src/data/neighbors.json',
  moodlets: 'src/data/moodlets.json',
  moodletsM3: 'src/data/moodlets_m3.json',
  traits: 'src/data/traits.json',
  virtues: 'src/data/virtues.json',
  atlas: 'src/data/ui/atlas.json',
  interactions: 'src/data/interactions.json',
  koSocial: 'src/i18n/ko/social.json',
};
for (const p of Object.values(P)) if (!existsSync(p)) errors.push(`파일 없음: ${p}`);
if (errors.length) finish();

const ICONS = new Set(Object.keys(json<{ sprites: Record<string, unknown> }>(P.atlas).sprites));
type M = Record<string, { nameKey: string; descKey: string }>;
const moodletsM2 = json<{ moodlets: M }>(P.moodlets).moodlets;
const moodletsM3 = json<{ moodlets: M }>(P.moodletsM3).moodlets;
for (const id of Object.keys(moodletsM3)) if (moodletsM2[id]) errors.push(`무드렛 ${id} 가 moodlets.json 과 moodlets_m3.json 에 모두 있음`);
/** 게임과 같게 합침 (tools/data-node.ts) */
const moodlets: M = { ...moodletsM2, ...moodletsM3 };
const traitsJson = json<{ conflicts: [string, string][]; crossConflicts: [string, string][]; traits: Record<string, { effects: { adTag?: Record<string, number> } }> }>(P.traits);
const TRAITS = new Set(Object.keys(traitsJson.traits));
const virtuesJson = json<{ virtues: Record<string, { sin: string; keep: string[]; break: string[] }>; sins: Record<string, { virtue: string; follow: string[] }> }>(P.virtues);
const VIRTUES = new Set(Object.keys(virtuesJson.virtues));
const SINS = new Set(Object.keys(virtuesJson.sins));
// 태그: M2 목록 + 특성 adTag / 덕·죄 keep·break·follow 가 쓰는 태그 (argue, duty, guard …)
const TAGS = new Set(M2_TAGS);
// M4: 스킬 경험치 태그 (skills.json 의 tags) 도 허용
if (existsSync('src/data/skills.json')) {
  const sk = JSON.parse(readFileSync('src/data/skills.json', 'utf8')) as { skills: Record<string, { tags?: string[] }> };
  for (const s of Object.values(sk.skills)) for (const t of s.tags ?? []) TAGS.add(t);
}
for (const t of Object.values(traitsJson.traits)) for (const k of Object.keys(t.effects.adTag ?? {})) TAGS.add(k);
for (const v of Object.values(virtuesJson.virtues)) [...v.keep, ...v.break].forEach((k) => TAGS.add(k));
for (const s of Object.values(virtuesJson.sins)) s.follow.forEach((k) => TAGS.add(k));
// 재고 품목: interactions.json 의 stock 키 (check-inner 와 같은 방식)
const STOCK = new Set<string>();
(function walk(v: unknown, parentKey?: string) {
  if (v && typeof v === 'object') {
    for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
      if (parentKey === 'stock' || k.startsWith('stock:')) STOCK.add(k.replace(/^stock:/, '').replace(/[<>=].*$/, ''));
      walk(c, k);
    }
  } else if (typeof v === 'string' && v.startsWith('stock:')) STOCK.add(v.slice(6).replace(/[<>=].*$/, ''));
})(json<unknown>(P.interactions));
// i18n: 게임은 ko/*.json 을 전부 합쳐 씀 (src/i18n/index.ts)
const koAll: Record<string, string> = {};
for (const f of readdirSync('src/i18n/ko')) if (f.endsWith('.json')) Object.assign(koAll, json<Record<string, string>>(`src/i18n/ko/${f}`));
const koSocial = json<Record<string, string>>(P.koSocial);

// ── 스키마 ────────────────────────────────────────────────
const snakeId = z.string().regex(/^social\.[a-z][a-z0-9_]*$/, 'social.<snake_case>');
const needRec = z.partialRecord(z.enum(NEEDS), z.number().positive());
const mods = z.record(z.string(), z.number().int().min(-50).max(50));
const outcome = z.object({
  friendship: z.number().int().min(-60).max(60),
  romance: z.number().int().min(-60).max(60),
  respect: z.number().int().min(-30).max(30),
  moodlets: z.array(z.string()),
  targetMoodlets: z.array(z.string()),
  flagsAdd: z.array(z.string()),
  flagsRemove: z.array(z.string()).optional(),
  events: z.array(z.string().regex(/^event:[a-z][a-z0-9_]*$/, 'event:<snake_case>')),
}).strict();
const requires = z.object({
  met: z.boolean().optional(),
  relAny: z.array(z.enum(REL_NAMES)).min(1).optional(),
  friendshipGte: z.number().int().min(-100).max(100).optional(),
  friendshipLte: z.number().int().min(-100).max(100).optional(),
  romanceGte: z.number().int().min(0).max(100).optional(),
  respectGte: z.number().int().min(-100).max(100).optional(),
  actorEmotionAny: z.array(z.enum(EMOTIONS)).min(1).optional(),
  targetEmotionAny: z.array(z.enum(EMOTIONS)).min(1).optional(),
  actorTraitsAny: z.array(z.string()).min(1).optional(),
  actorMoodletAny: z.array(z.string()).min(1).optional(),
  actorEstateAbove: z.literal(true).optional(),
  actorEstateBelow: z.literal(true).optional(),
  household: z.boolean().optional(),
  stock: z.record(z.string(), z.number().int().positive()).optional(),
  // 엔진(src/sim/data/schema.ts socialRequires)이 받는 확장
  relNone: z.array(z.enum(REL_NAMES)).min(1).optional(),
  romanceLte: z.number().int().min(0).max(100).optional(),
  targetTraitsAny: z.array(z.string()).min(1).optional(),
  targetMoodletAny: z.array(z.string()).min(1).optional(),
  actorVirtueAny: z.array(z.string()).min(1).optional(),
  actorSinAny: z.array(z.string()).min(1).optional(),
  actorEstateAny: z.array(z.enum(ESTATES)).min(1).optional(),
  adult: z.literal(true).optional(),
  // 엔진 지원 요청 중 (리드 확인 필요): 상대 신분
  targetEstateAny: z.array(z.enum(ESTATES)).min(1).optional(),
}).strict();
const interaction = z.object({
  nameKey: z.string(),
  icon: z.string(),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string()).min(1),
  minutes: z.number().positive().max(120),
  needs: needRec,
  targetNeeds: needRec,
  ads: needRec.optional(),
  adsWhenActorEmotion: z.partialRecord(z.enum(EMOTIONS), needRec).optional(),
  base: z.number().int(),
  requires: requires.optional(),
  traitMods: mods.optional(),
  targetTraitMods: mods.optional(),
  topics: z.array(z.enum(TOPICS)).min(1).optional(),
  estateRule: z.enum(['rude', 'deference']).optional(),
  success: outcome,
  failure: outcome,
  removeMoodlets: z.array(z.string()).optional(),
  targetRemoveMoodlets: z.array(z.string()).optional(),
}).strict();
type Interaction = z.infer<typeof interaction>;
const socialFile = z.object({ $comment: z.string().optional(), interactions: z.record(snakeId, interaction) }).strict();

const neighbor = z.object({
  id: z.string().regex(/^nb_[a-z][a-z0-9_]*$/, 'nb_<snake_case>'),
  name: z.string().min(1),
  sex: z.enum(['female', 'male']),
  stage: z.enum(['adult', 'elder']),
  estate: z.enum(ESTATES),
  traits: z.array(z.string()).length(3),
  virtue: z.string().nullable(),
  sin: z.string().nullable(),
  seed: z.number().int().nonnegative(),
  topics: z.array(z.enum(TOPICS)).min(1).max(3).optional(),
}).strict();
const neighborsFile = z.object({ $comment: z.string().optional(), neighbors: z.array(neighbor) }).strict();

function parse<T>(name: string, schema: z.ZodType<T>, path: string): T | undefined {
  const r = schema.safeParse(json<unknown>(path));
  if (!r.success) {
    for (const i of r.error.issues.slice(0, 40)) errors.push(`${name} 스키마: ${i.path.join('.')} ${i.message}`);
    return undefined;
  }
  return r.data;
}
const sf = parse('social', socialFile, P.social);
const nf = parse('neighbors', neighborsFile, P.neighbors);
if (!sf || !nf) finish();
const social = sf!.interactions;

// ── 도우미 ────────────────────────────────────────────────
const usedKeys = new Set<string>();
const key = (where: string, k: string) => {
  usedKeys.add(k);
  if (!(k in koAll)) errors.push(`${where}: i18n 키 없음 ${k}`);
};
const moodlet = (where: string, id: string) => {
  const m = moodlets[id];
  if (!m) return errors.push(`${where}: 무드렛 ${id} 가 moodlets.json 에 없음`);
  key(`${where} 무드렛 ${id}`, m.nameKey);
  key(`${where} 무드렛 ${id}`, m.descKey);
};
const trait = (where: string, t: string) => { if (!TRAITS.has(t)) errors.push(`${where}: 특성 ${t} 없음`); };

// ── 상호작용 ──────────────────────────────────────────────
const byCat: Record<string, string[]> = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
const adsIds: string[] = [];
for (const [id, ia] of Object.entries(social) as [string, Interaction][]) {
  const w = id;
  byCat[ia.category].push(id);
  if (ia.nameKey !== `ia.${id.replace('.', '_')}`) errors.push(`${w}: nameKey 는 ia.${id.replace('.', '_')}`);
  key(w, ia.nameKey);
  if (!ICONS.has(ia.icon)) errors.push(`${w}: 아이콘 ${ia.icon} 가 atlas 에 없음`);
  for (const t of ia.tags) if (!TAGS.has(t)) errors.push(`${w}: 태그 ${t} 는 계약/특성/덕·죄 태그 목록에 없음`);
  if (new Set(ia.tags).size !== ia.tags.length) errors.push(`${w}: 태그 중복`);
  if (ia.category === 'romance' && !ia.tags.includes('romance')) errors.push(`${w}: 로맨스 분류는 romance 태그 필요`);
  if (ia.category === 'mean' && !ia.tags.includes('mean')) errors.push(`${w}: 짓궂음 분류는 mean 태그 필요`);
  if (ia.base < 5 || ia.base > 95) errors.push(`${w}: base ${ia.base} 는 5~95 밖`);
  for (const t of Object.keys(ia.traitMods ?? {})) trait(`${w} traitMods`, t);
  for (const t of Object.keys(ia.targetTraitMods ?? {})) trait(`${w} targetTraitMods`, t);
  for (const t of ia.topics ?? []) key(`${w} 주제`, `topic.${t}`);
  key(w, `social.cat.${ia.category}`);

  const r = ia.requires ?? {};
  for (const n of [...(r.relAny ?? []), ...(r.relNone ?? [])]) key(`${w} 관계`, `rel.${n}`);
  for (const t of r.targetTraitsAny ?? []) trait(`${w} targetTraitsAny`, t);
  for (const m of r.targetMoodletAny ?? []) moodlet(`${w} targetMoodletAny`, m);
  for (const v of r.actorVirtueAny ?? []) if (!VIRTUES.has(v)) errors.push(`${w}: 덕 ${v} 없음`);
  for (const v of r.actorSinAny ?? []) if (!SINS.has(v)) errors.push(`${w}: 죄 ${v} 없음`);
  if (r.relAny && r.relNone && r.relAny.some((x) => r.relNone!.includes(x))) errors.push(`${w}: relAny 와 relNone 이 겹침`);
  for (const t of r.actorTraitsAny ?? []) trait(`${w} actorTraitsAny`, t);
  for (const m of r.actorMoodletAny ?? []) moodlet(`${w} actorMoodletAny`, m);
  for (const s of Object.keys(r.stock ?? {})) if (!STOCK.has(s)) errors.push(`${w}: 재고 품목 ${s} 없음 (interactions.json stock)`);
  if (r.actorEstateAbove && r.actorEstateBelow) errors.push(`${w}: actorEstateAbove 와 actorEstateBelow 를 함께 쓸 수 없음`);
  if (r.friendshipGte !== undefined && r.friendshipLte !== undefined && r.friendshipGte > r.friendshipLte) errors.push(`${w}: friendshipGte > friendshipLte`);
  if (r.met === false && (r.relAny || r.friendshipGte !== undefined || r.romanceGte !== undefined)) errors.push(`${w}: 처음 만난 사이 전용인데 관계 조건이 있음`);
  // 17세: 로맨스 분류는 엔진이 성인끼리만 허용. 분류 밖에서 로맨스를 올리는 것은 adult 조건 필요
  const romanceGain = Math.max(ia.success.romance, ia.failure.romance) > 0;
  if ((romanceGain || ia.tags.includes('flirt')) && ia.category !== 'romance' && !r.adult) errors.push(`${w}: 로맨스 분류가 아닌데 로맨스/유혹 → requires.adult 필요`);
  if (ia.estateRule === 'rude' && !ia.tags.includes('mean')) warns.push(`${w}: rude 인데 mean 태그 없음`);

  for (const [name, o] of [['success', ia.success], ['failure', ia.failure]] as const) {
    const ow = `${w} ${name}`;
    for (const m of o.moodlets) moodlet(ow, m);
    for (const m of o.targetMoodlets) moodlet(ow, m);
    if (o.moodlets.length + o.targetMoodlets.length === 0) errors.push(`${ow}: 무드렛이 하나도 없음 (결과를 채울 것)`);
    for (const f of [...o.flagsAdd, ...(o.flagsRemove ?? [])]) if (!REL_FLAGS.includes(f)) errors.push(`${ow}: 관계 표식 ${f} 는 ${REL_FLAGS.join('/')} 중 하나`);
  }
  const f = ia.failure;
  if (!(f.friendship < 0 || f.romance < 0 || f.respect < 0)) errors.push(`${w} failure: 손해가 없음 (실패가 의미 있게)`);
  if (JSON.stringify(ia.success) === JSON.stringify(ia.failure)) errors.push(`${w}: 성공과 실패 결과가 같음`);
  if (ia.category === 'romance' && ia.success.romance === 0) errors.push(`${w}: 로맨스 성공인데 로맨스 변화 0`);
  for (const m of [...(ia.removeMoodlets ?? []), ...(ia.targetRemoveMoodlets ?? [])]) moodlet(`${w} remove`, m);

  if (ia.ads || ia.adsWhenActorEmotion) {
    if (ia.ads) adsIds.push(id);
    else errors.push(`${w}: adsWhenActorEmotion 만 있고 ads 가 없음 (자율 여부 불명확)`);
    if (NO_ADS.includes(id)) errors.push(`${w}: 큰 결정은 ads 없음 (플레이어 전용)`);
    if (ia.success.flagsAdd.length || ia.success.flagsRemove?.length) errors.push(`${w}: 관계 표식을 바꾸는 상호작용은 ads 없음`);
    if (r.stock) errors.push(`${w}: 살림을 소모하는 상호작용은 ads 없음`);
  }
  if (BANNED_EN.test(id)) errors.push(`${w}: id 에 수위 금지어`);
}
for (const id of EXISTING) if (!social[id]) errors.push(`기존 상호작용 ${id} 가 없음 (id 유지)`);
for (const id of NO_ADS) if (!social[id]) warns.push(`NO_ADS 목록의 ${id} 가 social.json 에 없음`);
const total = Object.keys(social).length;
if (total < TOTAL_MIN) errors.push(`합계 ${total} < ${TOTAL_MIN}`);
for (const c of CATEGORIES) if (byCat[c].length < TARGETS[c]) errors.push(`분류 ${c}: ${byCat[c].length} < 목표 ${TARGETS[c]}`);
if (adsIds.length < ADS_RANGE[0] || adsIds.length > ADS_RANGE[1]) errors.push(`자율(ads) ${adsIds.length} 개는 ${ADS_RANGE[0]}~${ADS_RANGE[1]} 밖`);
// 리드 M3 무드렛(moodlets_m3.json)도 i18n 확인 (사회 무드렛)
for (const [id, m] of Object.entries(moodletsM3)) { key(`moodlets_m3 ${id}`, m.nameKey); key(`moodlets_m3 ${id}`, m.descKey); }
// 관계 이름 전부 i18n
for (const n of REL_NAMES) key('관계 이름', `rel.${n}`);
for (const c of CATEGORIES) key('분류 이름', `social.cat.${c}`);
for (const t of TOPICS) key('주제 이름', `topic.${t}`);

// ── 이웃 ──────────────────────────────────────────────────
const nbs = nf!.neighbors;
if (nbs.length !== 12) errors.push(`이웃 ${nbs.length}명 (12명이어야)`);
const nbEstates: Record<string, number> = {};
const conflicts = traitsJson.conflicts;
const cross = traitsJson.crossConflicts;
const ids = new Set<string>();
const seeds = new Set<number>();
for (const n of nbs) {
  const w = `이웃 ${n.id}`;
  if (ids.has(n.id)) errors.push(`${w}: id 중복`);
  if (seeds.has(n.seed)) errors.push(`${w}: seed 중복`);
  ids.add(n.id); seeds.add(n.seed);
  nbEstates[n.estate] = (nbEstates[n.estate] ?? 0) + 1;
  if (!/^[가-힣]+$/.test(n.name)) errors.push(`${w}: 이름은 한글 "${n.name}"`);
  if (new Set(n.traits).size !== 3) errors.push(`${w}: 특성 중복`);
  n.traits.forEach((t) => trait(w, t));
  for (const [a, b] of conflicts) if (n.traits.includes(a) && n.traits.includes(b)) errors.push(`${w}: 충돌 특성 ${a}/${b}`);
  for (const [a, b] of cross) {
    const has = (x: string) => n.traits.includes(x) || n.virtue === x || n.sin === x;
    if (has(a) && has(b)) errors.push(`${w}: 교차 충돌 ${a}/${b}`);
  }
  if (n.virtue !== null && !VIRTUES.has(n.virtue)) errors.push(`${w}: 덕 ${n.virtue} 없음`);
  if (n.sin !== null && !SINS.has(n.sin)) errors.push(`${w}: 죄 ${n.sin} 없음`);
  if (n.virtue && n.sin && virtuesJson.virtues[n.virtue]?.sin === n.sin) errors.push(`${w}: 덕 ${n.virtue} 와 짝 죄 ${n.sin} 를 함께 가질 수 없음`);
  if (n.estate === 'clergy' && n.traits.includes('flirt')) warns.push(`${w}: 성직자인데 바람기`);
  for (const b of BANNED_KO) if (n.name.includes(b)) errors.push(`${w}: 이름에 금지어 ${b}`);
}
for (const [e, want] of Object.entries(NEIGHBOR_ESTATES)) if ((nbEstates[e] ?? 0) !== want) errors.push(`이웃 신분 ${e}: ${nbEstates[e] ?? 0}명 (${want}명이어야)`);
const sexes = nbs.reduce<Record<string, number>>((a, n) => ((a[n.sex] = (a[n.sex] ?? 0) + 1), a), {});
if ((sexes.female ?? 0) < 4 || (sexes.male ?? 0) < 4) errors.push(`이웃 성별 치우침 ${JSON.stringify(sexes)}`);
const elders = nbs.filter((n) => n.stage === 'elder').length;
if (elders < 2 || elders > 6) errors.push(`이웃 노년 ${elders}명 (2~6명)`);

// ── i18n 문구 (social.json) ───────────────────────────────
for (const [k, v] of Object.entries(koSocial)) {
  if (!usedKeys.has(k)) warns.push(`ko/social.json: 쓰지 않는 키 ${k}`);
  if (!v || !v.trim()) errors.push(`ko/social.json: 빈 문구 ${k}`);
  if (/[0-9A-Za-z]/.test(v)) errors.push(`ko/social.json: 숫자/영문 포함 ${k} = ${v}`);
  for (const b of BANNED_KO) if (v.includes(b)) errors.push(`ko/social.json: 수위 금지어 "${b}" ${k} = ${v}`);
  if (k.startsWith('moodlet.') && !k.endsWith('.desc')) {
    const n = v.replace(/\s/g, '').length;
    if (n < 2 || n > 8) errors.push(`${k}: 무드렛 이름은 2~8자(공백 제외) "${v}"`);
  }
  if (k.startsWith('moodlet.') && k.endsWith('.desc') && !/[.!?]$/.test(v)) warns.push(`${k}: 원인 문구가 문장으로 끝나지 않음`);
  if (k.startsWith('ia.social_') && v.replace(/\s/g, '').length > 10) warns.push(`${k}: 원형 메뉴 이름이 김 "${v}"`);
}
// 사회 상호작용 이름 중복
const names = new Map<string, string>();
for (const [id, ia] of Object.entries(social)) {
  const n = koAll[ia.nameKey];
  if (n && names.has(n)) errors.push(`이름 중복 "${n}": ${names.get(n)} / ${id}`);
  if (n) names.set(n, id);
}

// ── 개수 표 ───────────────────────────────────────────────
const LABEL: Record<string, string> = { basic: '기본', friendly: '친근', romance: '로맨스', mean: '짓궂음', status: '신분', trade: '거래', special: '특수' };
console.log('\n  분류          개수  목표  자율(ads)');
for (const c of CATEGORIES) {
  const a = byCat[c].filter((id) => adsIds.includes(id)).length;
  console.log(`  ${(LABEL[c] + '(' + c + ')').padEnd(14)} ${String(byCat[c].length).padStart(4)}  ${String(TARGETS[c]).padStart(3)}${c === 'special' ? '+' : ' '} ${String(a).padStart(6)}`);
}
console.log(`  ${'합계'.padEnd(14)} ${String(total).padStart(4)}  ${String(TOTAL_MIN).padStart(3)}+ ${String(adsIds.length).padStart(6)}`);
const newMood = Object.keys(koSocial).filter((k) => k.startsWith('moodlet.') && !k.endsWith('.desc')).length;
const avgBase = (c: string) => Math.round(byCat[c].reduce((s, id) => s + social[id].base, 0) / Math.max(1, byCat[c].length));
console.log(`\n  평균 base: ${CATEGORIES.map((c) => `${LABEL[c]} ${avgBase(c)}`).join(', ')}`);
console.log(`  사건(events) 종류: ${new Set(Object.values(social).flatMap((i) => [...i.success.events, ...i.failure.events])).size}`);
console.log(`  이웃 ${nbs.length}명 ${JSON.stringify(nbEstates)} 성별 ${JSON.stringify(sexes)} 노년 ${elders}`);
console.log(`  ko/social.json 키 ${Object.keys(koSocial).length} (새 무드렛 ${newMood})\n`);
finish();

function finish(): never {
  for (const w of warns) console.warn('경고:', w);
  if (errors.length) {
    for (const e of errors) console.error('오류:', e);
    console.error(`\ncheck-social: 실패 (오류 ${errors.length}, 경고 ${warns.length})`);
    process.exit(1);
  }
  console.log(`check-social: 통과 (경고 ${warns.length})`);
  process.exit(0);
}
