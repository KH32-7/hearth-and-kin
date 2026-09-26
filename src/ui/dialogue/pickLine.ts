/**
 * 대사창 규칙 문장 고르기 (GDD 27-13, 14-3, 11-5 말투).
 * AI 가 꺼져 있을 때 src/data/dialogue.json 에서 지문(act) + 대사(say) + 대답(reply) 키를 고름.
 * 표시 전용: 게임 판정에 쓰지 않음. 무작위 대신 seed 해시로 고르므로 같은 입력이면 같은 문장.
 *
 * 고르는 순서
 * 1) 상호작용 풀(ok/fail)에서 when 조건이 모두 맞는 항목만 남김
 * 2) 맞은 조건 수(점수)가 가장 높은 항목들 중에서 seed 해시로 하나 (조건 없는 항목 = 0점, 일반 문장)
 * 3) 남은 항목이 없으면 같은 분류(category)의 공용 풀에서 같은 방식으로
 */

export type Tier = 'stranger' | 'acquaintance' | 'friend' | 'bestFriend' | 'lover' | 'spouse' | 'family' | 'rival' | 'enemy';
/** 신분 말투: low = 농노·자유민, mid = 장인·상인, high = 기사·귀족 (성직자도 high 에 맞음), clergy = 성직자만 */
export type Register = 'low' | 'mid' | 'high' | 'clergy';

export const TIERS: readonly Tier[] = ['stranger', 'acquaintance', 'friend', 'bestFriend', 'lover', 'spouse', 'family', 'rival', 'enemy'];
export const REGISTERS: readonly Register[] = ['low', 'mid', 'high', 'clergy'];
export const TOPICS = ['weather', 'food', 'love', 'work', 'faith', 'gossip', 'family', 'war', 'plague'] as const;
export const STAGES = ['child', 'teen', 'adult', 'elder'] as const;

export interface DialogueWhen {
  speakerTraits?: string[];
  listenerTraits?: string[];
  tier?: Tier[];
  register?: Register[];
  listenerRegister?: Register[];
  emotion?: string[];
  topic?: string[];
  /** 한마디(oneliner)용: 말하는 사람 생애 단계 */
  stage?: string[];
}

export interface DialogueEntry {
  act: string;
  say: string;
  reply?: string;
  when?: DialogueWhen;
}

export interface DialoguePools {
  ok?: DialogueEntry[];
  fail?: DialogueEntry[];
}

export interface DialogueScene {
  titleKey: string;
  lines: DialogueEntry[];
  choices: { id: string; icon: string; textKey: string }[];
}

export interface DialogueData {
  interactions: Record<string, DialoguePools & { category: string }>;
  categories: Record<string, DialoguePools>;
  oneliners: Record<string, DialogueEntry[]>;
  scenes: Record<string, DialogueScene>;
}

export interface SpeakerCtx {
  traits: readonly string[];
  estate: string;
  emotion?: string;
  stage?: string;
}

export interface ListenerCtx {
  traits: readonly string[];
  estate: string;
}

export interface PickCtx {
  ia: string;
  ok: boolean;
  speaker: SpeakerCtx;
  listener: ListenerCtx;
  tier: Tier;
  topic?: string | null;
}

export interface PickedLine {
  act: string;
  say: string;
  reply?: string;
}

/** 신분 → 말투 목록 (성직자는 clergy 이면서 high) */
export function registersOf(estate: string): Register[] {
  switch (estate) {
    case 'serf':
    case 'freeman':
      return ['low'];
    case 'artisan':
    case 'merchant':
      return ['mid'];
    case 'clergy':
      return ['clergy', 'high'];
    case 'knight':
    case 'noble':
      return ['high'];
    default:
      return ['low'];
  }
}

/** 관계 → 대사 단계. rel 은 RelationSnap 모양 (name: stranger|acquaintance|friend|best_friend|rival|enemy|lover|engaged|spouse|ex_spouse) */
export function relationTier(rel: { name?: string; flags?: readonly string[] } | null | undefined, isFamily: boolean, isSpouse: boolean): Tier {
  const flags = rel?.flags ?? [];
  const name = rel?.name ?? '';
  if (isSpouse || flags.includes('spouse') || name === 'spouse') return 'spouse';
  if (flags.includes('lover') || flags.includes('engaged') || name === 'lover' || name === 'engaged') return 'lover';
  if (name === 'enemy') return 'enemy';
  if (name === 'rival') return 'rival';
  if (isFamily) return 'family';
  if (name === 'best_friend' || name === 'bestFriend') return 'bestFriend';
  if (name === 'friend') return 'friend';
  if (!rel || name === 'stranger') return 'stranger';
  return 'acquaintance';
}

/** FNV-1a 32비트 (Math.random 을 쓰지 않음) */
export function hashSeed(seed: number, salt: string): number {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  h = Math.imul(h, 0x01000193) >>> 0;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // 마지막 섞기 (낮은 비트 치우침 줄임)
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

interface MatchCtx {
  speakerTraits: readonly string[];
  listenerTraits: readonly string[];
  tier?: Tier;
  registers: Register[];
  listenerRegisters: Register[];
  emotion?: string;
  topic?: string | null;
  stage?: string;
}

const anyOf = (want: readonly string[], have: readonly string[]) => want.some((w) => have.includes(w));

/** when 조건 점수. 하나라도 어긋나면 -1, 조건 없음 = 0 */
export function scoreWhen(when: DialogueWhen | undefined, m: MatchCtx): number {
  if (!when) return 0;
  let s = 0;
  const check = (want: readonly string[] | undefined, have: readonly string[]): boolean => {
    if (!want || !want.length) return true;
    if (!anyOf(want, have)) return false;
    s++;
    return true;
  };
  if (!check(when.speakerTraits, m.speakerTraits)) return -1;
  if (!check(when.listenerTraits, m.listenerTraits)) return -1;
  if (!check(when.tier, m.tier ? [m.tier] : [])) return -1;
  if (!check(when.register, m.registers)) return -1;
  if (!check(when.listenerRegister, m.listenerRegisters)) return -1;
  if (!check(when.emotion, m.emotion ? [m.emotion] : [])) return -1;
  if (!check(when.topic, m.topic ? [m.topic] : [])) return -1;
  if (!check(when.stage, m.stage ? [m.stage] : [])) return -1;
  return s;
}

/** 가장 구체적인(점수 높은) 항목들 중 하나를 seed 로 고름. 없으면 null */
export function pickFrom(entries: readonly DialogueEntry[] | undefined, m: MatchCtx, seed: number, salt: string): DialogueEntry | null {
  if (!entries || !entries.length) return null;
  let best = -1;
  let top: DialogueEntry[] = [];
  for (const e of entries) {
    const s = scoreWhen(e.when, m);
    if (s < 0) continue;
    if (s > best) {
      best = s;
      top = [e];
    } else if (s === best) top.push(e);
  }
  if (!top.length) return null;
  return top[hashSeed(seed, salt) % top.length];
}

const toLine = (e: DialogueEntry): PickedLine => (e.reply ? { act: e.act, say: e.say, reply: e.reply } : { act: e.act, say: e.say });

/** 사회 상호작용 대사 키 고르기. 상호작용 풀 → 분류 공용 풀 → basic 공용 풀 순서. 모두 없으면 null (지문도 없이 웅얼거림) */
export function pickLine(data: DialogueData, ctx: PickCtx, seed: number): PickedLine | null {
  const m: MatchCtx = {
    speakerTraits: ctx.speaker.traits,
    listenerTraits: ctx.listener.traits,
    tier: ctx.tier,
    registers: registersOf(ctx.speaker.estate),
    listenerRegisters: registersOf(ctx.listener.estate),
    emotion: ctx.speaker.emotion,
    topic: ctx.topic ?? null,
    stage: ctx.speaker.stage,
  };
  const outcome = ctx.ok ? 'ok' : 'fail';
  const salt = `${ctx.ia}|${outcome}`;
  const def = data.interactions[ctx.ia];
  const own = pickFrom(def?.[outcome], m, seed, salt);
  if (own) return toLine(own);
  const cat = def?.category ?? 'basic';
  const fromCat = pickFrom(data.categories[cat]?.[outcome], m, seed, `${salt}|cat`);
  if (fromCat) return toLine(fromCat);
  const fromBasic = cat === 'basic' ? null : pickFrom(data.categories.basic?.[outcome], m, seed, `${salt}|basic`);
  return fromBasic ? toLine(fromBasic) : null;
}

/** 식구 한마디 (27-13 한마디 창): situation = need.hunger, wake, child_news … */
export function pickOneliner(data: DialogueData, situation: string, speaker: SpeakerCtx, seed: number): PickedLine | null {
  const m: MatchCtx = {
    speakerTraits: speaker.traits,
    listenerTraits: [],
    registers: registersOf(speaker.estate),
    listenerRegisters: [],
    emotion: speaker.emotion,
    stage: speaker.stage,
  };
  const e = pickFrom(data.oneliners[situation], m, seed, `one|${situation}`);
  return e ? toLine(e) : null;
}

// ---------- 문장 검사 (tools/check-data.ts 와 tests/unit/dialogue.test.ts 가 같이 씀) ----------

/** 사극 말투 (사용자 지시: 사극체 금지. 귀족도 ~하게, ~시오 까지만) */
const ARCHAIC_END = /(하오|이오|구려|느니라|로다|리라|소서|나이다|이외다|옵니다|느냐|더냐|거라|게나|오리다|(?:었|았|였|겠|있|없|했|하|되|갔|왔|좋|같|많|싶|않|이)소|(?:주|가|보|두|오)오)(?=[.!?…]|$)/;
const ARCHAIC_WORD = /(그대(?!로)|소인|쇤네|나으리|나리[,.! ]|마님|여보시오|이보시오|사옵|하옵|하였|이옵)/;
/** 번역투, AI 투 (에 대해, 를 통해, 그녀 …) */
const TRANSLATIONESE = /(에 대해|에 대한|를 통해|을 통해|로 인해|으로 인해|에 있어서|[을를] 가지고 있|하는 중이|것은 사실|그녀|그들은|그것은)/;
const EMOJI = /\p{Extended_Pictographic}/u;
const JOSA_OK = ['이(가)', '을(를)', '은(는)', '과(와)', '아(야)', '으로(로)', '이나(나)', '가(이)', '를(을)', '는(은)', '와(과)', '야(아)', '로(으로)', '나(이나)'];

/**
 * 대사/지문 한 줄의 문제 목록 (빈 배열 = 통과).
 * kind: act = 지문(쉼표 1개까지), say = 대사(쉼표 2개까지). allowB = {b} 를 써도 되는지 (한마디는 듣는 사람 없음)
 */
export function dialogueTextProblems(text: string, kind: 'act' | 'say', allowB = true): string[] {
  const p: string[] = [];
  if (!text.trim()) p.push('빈 문장');
  if (/[0-9０-９]/.test(text)) p.push('숫자');
  if (EMOJI.test(text)) p.push('이모지');
  if (/[—–"“”]/.test(text)) p.push('대시/따옴표');
  const bare = text.replace(/\{[ab]\}/g, '');
  if (/[A-Za-z]/.test(bare)) p.push('영문(게임 용어/키 노출)');
  for (const m of text.matchAll(/\{([^}]*)\}/g)) {
    if (m[1] !== 'a' && m[1] !== 'b') p.push(`모르는 자리표시 {${m[1]}}`);
    if (m[1] === 'b' && !allowB) p.push('{b} 없는 자리에 {b}');
  }
  // 자리표시 바로 뒤 조사는 josa() 가 고치는 형태만 (에드릭이/베르타가)
  for (const m of text.matchAll(/\{[ab]\}([이가을를은는과와아야으로랑])/g)) {
    const rest = text.slice((m.index ?? 0) + 3);
    if (!JOSA_OK.some((j) => rest.startsWith(j))) p.push(`자리표시 뒤 조사 고정: ${text.slice(m.index ?? 0, (m.index ?? 0) + 6)}`);
  }
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    const s = sentence.trim();
    if (ARCHAIC_END.test(s.replace(/\.\.\.$/, '.'))) p.push(`사극 어미: ${s}`);
  }
  if (ARCHAIC_WORD.test(text)) p.push(`사극 어휘: ${text.match(ARCHAIC_WORD)?.[0]}`);
  if (TRANSLATIONESE.test(text)) p.push(`번역투: ${text.match(TRANSLATIONESE)?.[0]}`);
  const commas = (text.match(/,/g) ?? []).length;
  if (kind === 'act' && commas > 1) p.push('지문 쉼표 2개 이상');
  if (kind === 'say' && commas > 2) p.push('대사 쉼표 3개 이상');
  if (!/[.!?…]$/.test(text.trim())) p.push('문장부호로 끝나지 않음');
  if (kind === 'act' && !/다\.$/.test(text.trim())) p.push('지문은 현재형 평서문(~다.)으로 끝나야 함');
  return p;
}

/** 장면(청혼 등) 지문 + 대사 + 선택지 키. 말투에 맞는 첫 줄을 고름 */
export function pickScene(data: DialogueData, sceneId: string, speaker: SpeakerCtx, tier: Tier, seed: number): { titleKey: string; line: PickedLine; choices: DialogueScene['choices'] } | null {
  const sc = data.scenes[sceneId];
  if (!sc) return null;
  const m: MatchCtx = {
    speakerTraits: speaker.traits,
    listenerTraits: [],
    tier,
    registers: registersOf(speaker.estate),
    listenerRegisters: [],
    emotion: speaker.emotion,
    stage: speaker.stage,
  };
  const e = pickFrom(sc.lines, m, seed, `scene|${sceneId}`);
  if (!e) return null;
  return { titleKey: sc.titleKey, line: toLine(e), choices: sc.choices };
}
