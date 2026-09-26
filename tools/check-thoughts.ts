/**
 * 속마음 데이터 검사 (GDD 11-5, 계약 artifacts/contracts-m2.md 3절).
 * - 스키마 (zod): speech 7신분, thoughts 항목 필드와 형식
 * - 트리거 문법, 특성/신분/감정/단계/상호작용/태그/무드렛 id 가 계약 목록 안인지
 * - i18n: speech.* 와 thought.* 키 누락 0, 쓰지 않는 키 0
 * - 문장: 35자 이하, 금지어(숫자, 게임 용어, 현대 은어, 실존 종교/인물, 금지 소재) 0, 중복 문장 0
 * - 분포: idle 은 traits 필수, 특성마다 idle 3개 이상, 욕구 low 는 7신분 모두
 * - 트리거별/신분별 개수 표 출력
 * 사용: npx tsx tools/check-thoughts.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';

const MAX_LEN = 35;
const MIN_TOTAL = 320;
const MIN_IDLE_PER_TRAIT = 3;

// ── 계약 목록 (contracts-m2.md) ──
const ESTATES = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'] as const;
const STAGES = ['child', 'teen', 'adult', 'elder'] as const;
const EMOTIONS = ['happy', 'energized', 'focused', 'excited', 'inspired', 'pious', 'sad', 'angry', 'tense', 'ashamed', 'neutral'];
const NEEDS = ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social', 'warmth', 'comfort'];
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const TRAITS = [
  'cheerful', 'melancholic', 'hot_tempered', 'calm', 'coward', 'brave', 'romantic', 'cynical',
  'neat', 'lazy', 'diligent', 'gourmet', 'drinker', 'active', 'bookworm', 'handy', 'nature_lover', 'creative',
  'sociable', 'introvert', 'kind', 'mean', 'ambitious', 'humble', 'gossip', 'suspicious', 'family_oriented', 'flirt', 'just', 'cunning',
];
const TAGS = [
  'clean', 'labor', 'rest', 'read', 'music', 'creative', 'nature', 'cook', 'eat_good', 'drink', 'exercise', 'repair', 'pray',
  'social', 'family', 'kind', 'mean', 'gossip', 'flirt', 'romance', 'brag', 'humble', 'lie', 'charity', 'feast', 'fast',
  'night_out', 'craft', 'study', 'solitary',
];
const INTERACTIONS = [
  // M1
  'hearth.light_fire', 'hearth.cook_stew', 'hearth.warm_up', 'hearth.extinguish', 'table.eat_stew', 'cupboard.snack_bread',
  'counter.bake_bread', 'barrel.wash_hands', 'washbasin.wash_face', 'washtub.bathe', 'chamber_pot.use', 'chamber_pot.empty',
  'outhouse.use', 'bed.sleep', 'bed.nap', 'seat.sit', 'clothes.change', 'bookshelf.read', 'lute.play', 'tapestry.admire',
  'plant.tend', 'wheel.spin', 'block.chop_wood', 'well.draw_water', 'candle.light', 'candle.snuff', 'window.chat',
  'window.gaze', 'rug.stretch', 'woodpile.tidy', 'lot_exit.market',
  // M2 (리드 추가)
  'floor.sweep', 'table.wipe', 'cupboard.drink_ale', 'bed.lounge', 'yard.walk', 'yard.pick_herbs', 'chair.mend',
  'table.whittle', 'bench.pray', 'bookshelf.study', 'stock.count',
  // 사회
  'social.chat', 'social.deep_talk', 'social.joke', 'social.comfort', 'social.hug', 'social.tease', 'social.gossip',
  'social.argue', 'social.flirt', 'social.brag', 'social.apologize',
];
const NEED_MOODLETS = NEEDS.flatMap((n) => ['low', 'crit', ...(n === 'bladder' ? [] : ['high'])].map((l) => `need_${n}_${l}`));
const MOODLETS = [
  ...NEED_MOODLETS,
  'cozy_hearth', 'smoky_room', 'dirty_room_neat', 'fresh_bread', 'good_meal', 'ate_alone', 'slept_well', 'slept_badly',
  'slept_on_floor', 'pleasant_chat', 'heartfelt_talk', 'teased', 'was_comforted', 'hug', 'argued', 'heard_gossip',
  'lonely_heart', 'stress_heavy', 'stress_limit', 'after_breakdown', 'wish_fulfilled', 'fear_realized', 'bored_repeat',
  'liked_activity', 'disliked_activity', 'lazy_bliss', 'restless_idle', 'no_exercise', 'bad_food_gourmet', 'ale_merry',
  'alone_in_dark', 'crowded_introvert', 'family_near', 'prayer_calm', 'humble_chat', 'pride_boast', 'schemed', 'did_good',
];
const BARE_TRIGGERS = ['wish_new', 'fear_new', 'wish_done', 'fear_real', 'see_person', 'memory', 'idle', 'stress:40', 'stress:70', 'breakdown', 'wake', 'bedtime', 'rain'];

// 물건 id (see_object 트리거용): 있으면 objects.json 키
const objectIds: string[] = existsSync('src/data/objects.json')
  ? Object.keys(JSON.parse(readFileSync('src/data/objects.json', 'utf8')) as Record<string, unknown>).filter((k) => !k.startsWith('$'))
  : [];

// ── 금지어 ──
const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: '숫자', re: /[0-9０-９]/ },
  { label: '로마자', re: /[A-Za-zＡ-Ｚａ-ｚ]/ },
  { label: '자모 은어', re: /[ㄱ-ㅎㅏ-ㅣ]/ },
  ...[
    // 게임 용어
    '레벨', '스탯', '게이지', '포인트', '경험치', '버프', '디버프', '퀘스트', '아이템', '무드렛', '욕구', '스킬', '게임',
    '세이브', '저장', '로그', '능력치', '스트레스', '에너지', '확률', '퍼센트', '보너스', '업그레이드',
    // 현대 은어/외래어
    '대박', '헐', '짱', '레알', '꿀잼', '노잼', '존맛', '멘붕', '극혐', '킹받', '인싸', '아싸', '갑분싸', '개꿀', '쩐다', '쩔어',
    '오케이', '파이팅', '화이팅', '스펙', '썸', '불금', '치킨', '커피', '초콜릿', '담배', '감자', '토마토', '옥수수', '고추',
    '데이트', '파티', '샤워', '스트레칭', '소스', '쿠션', '허브', '팩트', '멘탈', '텐션', '케미', '인정각', '노답', '쌉',
    // 실존 종교/인물
    '예수', '그리스도', '마리아', '성모', '기독', '가톨릭', '천주', '하나님', '하느님', '교황', '알라', '부처', '불교',
    '이슬람', '유대', '개신교',
    // 금지 소재 (00_개요 수위와 톤)
    '자살', '자해', '고문', '화형', '노예', '죽고 싶',
  ].map((w) => ({ label: w, re: new RegExp(w) })),
];

// ── 스키마 ──
const Id = z.string().regex(/^[a-z][a-z0-9_]*$/);
const ThoughtSchema = z
  .object({
    id: Id,
    trigger: z.string().min(1),
    estates: z.array(z.string()).min(1).optional(),
    traits: z.array(z.string()).min(1).optional(),
    emotions: z.array(z.string()).min(1).optional(),
    stages: z.array(z.string()).min(1).optional(),
    weight: z.number().positive().optional(),
    textKey: z.string().min(1),
  })
  .strict();
const FileSchema = z.object({
  $comment: z.string().optional(),
  speech: z.object(Object.fromEntries(ESTATES.map((e) => [e, z.object({ descKey: z.string() }).strict()]))).strict(),
  thoughts: z.array(ThoughtSchema),
});
type Thought = z.infer<typeof ThoughtSchema>;

const errors: string[] = [];
const warns: string[] = [];

const raw = JSON.parse(readFileSync('src/data/thoughts.json', 'utf8'));
const ko = JSON.parse(readFileSync('src/i18n/ko/thoughts.json', 'utf8')) as Record<string, string>;

const parsed = FileSchema.safeParse(raw);
if (!parsed.success) {
  for (const iss of parsed.error.issues.slice(0, 30)) errors.push(`스키마: ${iss.path.join('.')} ${iss.message}`);
  report();
}
const data = parsed.data!;
const thoughts: Thought[] = data.thoughts;

// ── 트리거 문법 ──
function triggerError(t: string): string | null {
  if (BARE_TRIGGERS.includes(t)) return null;
  const m = /^([a-z_]+):(.+)$/.exec(t);
  if (!m) return '알 수 없는 트리거';
  const [, kind, arg] = m;
  switch (kind) {
    case 'need_low':
    case 'need_crit':
      return NEEDS.includes(arg) ? null : `욕구 id 아님: ${arg}`;
    case 'need_high':
      if (arg === 'bladder') return '방광은 high 없음 (계약 2절)';
      return NEEDS.includes(arg) ? null : `욕구 id 아님: ${arg}`;
    case 'moodlet':
      return MOODLETS.includes(arg) ? null : `엔진 무드렛 id 아님: ${arg}`;
    case 'emotion':
      return EMOTIONS.includes(arg) ? null : `감정 id 아님: ${arg}`;
    case 'action_start':
    case 'action_done':
      return INTERACTIONS.includes(arg) ? null : `상호작용 id 아님: ${arg}`;
    case 'tag_done':
      return TAGS.includes(arg) ? null : `태그 아님: ${arg}`;
    case 'see_object':
      return objectIds.includes(arg) ? null : `물건 id 아님: ${arg}`;
    case 'season':
      return SEASONS.includes(arg) ? null : `계절 아님: ${arg}`;
    default:
      return `알 수 없는 트리거 종류: ${kind}`;
  }
}

// ── 항목별 검사 ──
const ids = new Set<string>();
const texts = new Map<string, string>();
const usedKeys = new Set<string>();
let totalLen = 0;
let maxLen = 0;

for (const e of ESTATES) {
  const k = data.speech[e].descKey;
  usedKeys.add(k);
  if (k !== `speech.${e}`) errors.push(`speech.${e}: descKey 는 speech.${e} 여야 함 (${k})`);
  if (!ko[k]?.trim()) errors.push(`i18n 누락: ${k}`);
}

for (const t of thoughts) {
  const at = `${t.id}`;
  if (ids.has(t.id)) errors.push(`${at}: id 중복`);
  ids.add(t.id);
  if (!t.id.startsWith('th_')) errors.push(`${at}: id 는 th_ 로 시작`);
  const te = triggerError(t.trigger);
  if (te) errors.push(`${at}: 트리거 "${t.trigger}" ${te}`);
  for (const es of t.estates ?? []) if (!(ESTATES as readonly string[]).includes(es)) errors.push(`${at}: 신분 id 아님 ${es}`);
  for (const st of t.stages ?? []) if (!(STAGES as readonly string[]).includes(st)) errors.push(`${at}: 생애 단계 아님 ${st}`);
  for (const tr of t.traits ?? []) if (!TRAITS.includes(tr)) errors.push(`${at}: 특성 id 아님 ${tr}`);
  for (const em of t.emotions ?? []) if (!EMOTIONS.includes(em)) errors.push(`${at}: 감정 id 아님 ${em}`);
  if (t.trigger === 'idle' && !t.traits) errors.push(`${at}: idle 은 traits 필수`);
  if (t.stages?.includes('child') && t.estates) warns.push(`${at}: 아동 문장에 신분 조건 (아동 말투는 신분 무관)`);
  if (t.textKey !== `thought.${t.id}`) errors.push(`${at}: textKey 는 thought.${t.id} 여야 함`);
  usedKeys.add(t.textKey);

  const text = ko[t.textKey];
  if (text === undefined || !text.trim()) {
    errors.push(`i18n 누락: ${t.textKey}`);
    continue;
  }
  const len = [...text].length;
  totalLen += len;
  maxLen = Math.max(maxLen, len);
  if (len > MAX_LEN) errors.push(`${at}: ${len}자 (최대 ${MAX_LEN}) "${text}"`);
  for (const f of FORBIDDEN) if (f.re.test(text)) errors.push(`${at}: 금지어 [${f.label}] "${text}"`);
  const prev = texts.get(text);
  if (prev) errors.push(`${at}: 문장 중복 (${prev}) "${text}"`);
  texts.set(text, t.id);
}

for (const k of Object.keys(ko)) if (!usedKeys.has(k)) errors.push(`i18n 에만 있는 키: ${k}`);

// ── 분포 검사 ──
if (thoughts.length < MIN_TOTAL) errors.push(`문장 ${thoughts.length}개 (최소 ${MIN_TOTAL})`);
for (const tr of TRAITS) {
  const n = thoughts.filter((t) => t.trigger === 'idle' && t.traits?.includes(tr)).length;
  if (n < MIN_IDLE_PER_TRAIT) errors.push(`특성 ${tr}: idle ${n}개 (최소 ${MIN_IDLE_PER_TRAIT})`);
}
for (const n of NEEDS) {
  for (const e of ESTATES) {
    // 어른 말투 기준: 아동 전용 문장은 신분 말투로 치지 않음
    const has = thoughts.some(
      (t) => t.trigger === `need_low:${n}` && !t.stages?.includes('child') && (!t.estates || t.estates.includes(e)),
    );
    if (!has) errors.push(`need_low:${n}: ${e} 말투 문장 없음`);
  }
  if (!thoughts.some((t) => t.trigger === `need_crit:${n}`)) errors.push(`need_crit:${n}: 문장 없음`);
  if (n !== 'bladder' && !thoughts.some((t) => t.trigger === `need_high:${n}`)) errors.push(`need_high:${n}: 문장 없음`);
}
for (const em of EMOTIONS.filter((e) => e !== 'neutral')) {
  if (!thoughts.some((t) => t.trigger === `emotion:${em}`)) errors.push(`emotion:${em}: 문장 없음`);
}

// ── 표 ──
const group = (trig: string): string => {
  if (trig.startsWith('need_')) return trig.split(':')[0];
  if (trig.startsWith('action_') || trig.startsWith('tag_done')) return 'action/tag';
  const k = trig.split(':')[0];
  return ['moodlet', 'emotion', 'season', 'see_object'].includes(k) ? k : trig;
};
const byGroup = new Map<string, number>();
for (const t of thoughts) byGroup.set(group(t.trigger), (byGroup.get(group(t.trigger)) ?? 0) + 1);

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);

console.log(`\n속마음 ${thoughts.length}개, 트리거 ${new Set(thoughts.map((t) => t.trigger)).size}종, 평균 ${(totalLen / Math.max(1, thoughts.length)).toFixed(1)}자, 최장 ${maxLen}자\n`);
console.log('트리거 묶음별 개수');
for (const [g, n] of [...byGroup.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${pad(g, 14)} ${padL(n, 4)}`);

console.log('\n신분별 개수 (전용 = estates 에 그 신분만 / 포함 = estates 에 있음 / 공용 = estates 없음, 아동 전용 제외)');
const common = thoughts.filter((t) => !t.estates && !t.stages?.includes('child')).length;
for (const e of ESTATES) {
  const only = thoughts.filter((t) => t.estates?.length === 1 && t.estates[0] === e).length;
  const incl = thoughts.filter((t) => t.estates?.includes(e)).length;
  console.log(`  ${pad(e, 10)} 전용 ${padL(only, 4)}  포함 ${padL(incl, 4)}  +공용 ${common}`);
}
const child = thoughts.filter((t) => t.stages?.includes('child')).length;
const elder = thoughts.filter((t) => t.stages?.includes('elder')).length;
console.log(`  ${pad('아동(child)', 10)} ${padL(child, 4)}   노년(elder) ${elder}`);

console.log('\n트리거별 개수');
const byTrig = new Map<string, number>();
for (const t of thoughts) byTrig.set(t.trigger, (byTrig.get(t.trigger) ?? 0) + 1);
const rows = [...byTrig.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const colW = 36;
for (let i = 0; i < rows.length; i += 3) {
  console.log('  ' + rows.slice(i, i + 3).map(([k, n]) => pad(`${k} ${n}`, colW)).join(''));
}

console.log('\n특성별 idle 개수');
const traitRows = TRAITS.map((tr) => `${tr} ${thoughts.filter((t) => t.trigger === 'idle' && t.traits?.includes(tr)).length}`);
for (let i = 0; i < traitRows.length; i += 5) console.log('  ' + traitRows.slice(i, i + 5).map((s) => pad(s, 22)).join(''));

report();

function report(): never {
  for (const w of warns) console.warn(`경고: ${w}`);
  if (errors.length) {
    console.error(`\n실패 ${errors.length}건`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('\ncheck-thoughts: 통과');
  process.exit(0);
}
