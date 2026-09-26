/**
 * 사건 카드 엔진 (GDD 24-1, 최소판: M8 가보·상속, M9 소문·재판 카드가 씀. 하루 무작위 카드 빈도와 연대기는 M14).
 * - 카드 = 조건(cond) + 대상 가용 조건 + 부재 시 처리 + 재등장 대기 + 인생당 상한 + 선택지(조건·판정·성공/실패 결과)
 * - 제안(offer) → 조작 가문이면 선택 대기 (의도 cardChoice), 아니면(또는 시간 초과) 무작위 봇처럼 가능한 선택지 중 균등 무작위 (29-4)
 * - 결과: 무드렛(self/spouse/family/other), 돈(moneyS = 신분 한 인생 저축 S 배수), 평판 4종(fame/church/karma/morale)·개인 명예,
 *   관계, 기억, 소문, 연쇄 카드, 연대기, 가보(damage/lose/recover), 가문 플래그, 월드 행동(행동 계약: 지금은 늘 "시작 불가 시" 대체 결과)
 * 렌더러/DOM 없음. 무작위는 host.rng 만
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import type { Person } from '../people/person';

const dur = z.object({ value: z.number(), scale: z.enum(['absolute', 'season', 'lifespan', 'per_life']) });
const condSchema = z.object({
  stage: z.array(z.string()).optional(),
  estate: z.array(z.string()).optional(),
  sex: z.enum(['male', 'female']).optional(),
  traitsAny: z.array(z.string()).optional(),
  traitsNone: z.array(z.string()).optional(),
  married: z.boolean().optional(),
  hasChild: z.boolean().optional(),
  hasBaby: z.boolean().optional(),
  pregnant: z.boolean().optional(),
  minMoneyS: z.number().optional(),
  maxMoneyS: z.number().optional(),
  minFame: z.number().optional(),
  maxFame: z.number().optional(),
  season: z.array(z.string()).optional(),
  flags: z.array(z.string()).optional(),
  notFlags: z.array(z.string()).optional(),
  after: z.array(z.string()).optional(),
}).loose();
export type CardCond = z.infer<typeof condSchema>;

const outcomeBase = z.object({
  /** 월드 행동의 대체 결과 안쪽 결과는 바깥 textKey 를 씀 */
  textKey: z.string().optional(),
  moodlets: z.array(z.object({ who: z.enum(['self', 'spouse', 'family', 'other']), id: z.string() })).optional(),
  moneyS: z.number().optional(),
  fame: z.number().optional(),
  church: z.number().optional(),
  karma: z.number().optional(),
  morale: z.number().optional(),
  honor: z.number().optional(),
  relation: z.object({ with: z.enum(['spouse', 'other', 'family']), friendship: z.number().optional(), romance: z.number().optional(), respect: z.number().optional() }).optional(),
  memory: z.object({ kind: z.string(), importance: z.number(), valence: z.number() }).optional(),
  rumor: z.object({ kind: z.string(), good: z.boolean(), strength: z.number() }).optional(),
  chain: z.string().optional(),
  chronicle: z.string().optional(),
  heirloom: z.enum(['damage', 'lose', 'recover']).optional(),
  flag: z.string().optional(),
}).loose();
type OutcomeBase = z.infer<typeof outcomeBase>;
export interface CardOutcome extends OutcomeBase {
  action?: { participants: unknown[]; start: Record<string, unknown>; maxMinutes: number; onCannotStart: { textKey: string; outcome: CardOutcome }; onTimeout: { textKey: string; outcome: CardOutcome } };
}
const outcomeSchema: z.ZodType<CardOutcome> = outcomeBase.extend({
  action: z.object({
    participants: z.array(z.unknown()),
    start: z.record(z.string(), z.unknown()),
    maxMinutes: z.number(),
    onCannotStart: z.object({ textKey: z.string(), outcome: z.lazy(() => outcomeSchema) }),
    onTimeout: z.object({ textKey: z.string(), outcome: z.lazy(() => outcomeSchema) }),
  }).optional(),
}) as never;

export const cardSchema = z.object({
  id: z.string(),
  titleKey: z.string(),
  bodyKey: z.string(),
  target: z.enum(['person', 'couple', 'family', 'clan']),
  source: z.string(),
  category: z.string(),
  rating: z.enum(['all', '15', '17']),
  cond: condSchema.optional(),
  availability: z.array(z.enum(['available', 'rabbithole', 'journey', 'asleep'])),
  absent: z.object({ kind: z.enum(['substitute', 'hold', 'drop']), days: z.number().optional() }),
  weight: z.number(),
  once: z.boolean(),
  cooldown: dur,
  perLife: z.number(),
  options: z.array(z.object({
    textKey: z.string(),
    cond: condSchema.optional(),
    check: z.object({ skill: z.string().optional(), trait: z.string().optional(), base: z.number(), perLevel: z.number().optional() }).optional(),
    success: outcomeSchema,
    failure: outcomeSchema.optional(),
  }).loose()).min(1),
}).loose();
export type CardDef = z.infer<typeof cardSchema>;
export const cardsSchema = z.object({ cards: z.array(cardSchema) }).loose();

export interface PendingCard {
  seq: number;
  cardId: string;
  personId: number;
  otherId: number;
  vars: Record<string, string | number>;
  since: number;
  /** 고를 수 있는 선택지 번호 */
  options: number[];
}

export interface CardResult {
  cardId: string;
  option: number;
  ok: boolean;
  textKey: string | undefined;
  personId: number;
}

export interface CardsHost {
  readonly persons: readonly Person[];
  readonly rng: Rng;
  minute(): number;
  day(): number;
  season(): string;
  /** 조작 가문(플레이어가 고름) */
  controlled(p: Person): boolean;
  /** 가족 상태 플래그 (Simulation.familyFlags + 가문 플래그) */
  flags(p: Person): ReadonlySet<string>;
  /** 가문 명성 (0~1000) */
  fame(p: Person): number;
  /** 가구 돈 (파딩), 신분 한 인생 저축 S (파딩) */
  money(p: Person): number;
  savingsS(p: Person): number;
  skillLevel(p: Person, skill: string): number;
  /** 결과 적용 창구 */
  moodlet(p: Person, id: string): void;
  addMoney(p: Person, amount: number, reason: string): void;
  reputation(p: Person, d: { fame?: number; church?: number; karma?: number; morale?: number; honor?: number }, reason: string): void;
  relation(a: Person, b: Person, d: { friendship?: number; romance?: number; respect?: number }): void;
  memory(p: Person, kind: string, importance: number, valence: number, withPerson: number): void;
  rumor(subject: Person, kind: string, good: boolean, strength: number): void;
  chronicle(trigger: string, subjects: Person[]): void;
  heirloom(p: Person, what: 'damage' | 'lose' | 'recover'): void;
  setFlag(p: Person, flag: string): void;
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
}

/** 조작 가문이 고르지 않으면 이만큼 뒤에 자동 선택 (게임 분) */
const AUTO_PICK_MINUTES = 180;

export class Cards {
  readonly defs = new Map<string, CardDef>();
  readonly pending: PendingCard[] = [];
  readonly log: CardResult[] = [];
  /** 인물별 카드 본 횟수, 마지막으로 본 분 (인생당 상한·재등장 대기) */
  private seen = new Map<string, { n: number; at: number }>();
  private seq = 0;

  /** 스키마를 통과하지 못한 카드 (check:data 가 보고) */
  readonly problems: string[] = [];

  constructor(private host: CardsHost, raw: unknown) {
    // 카드마다 따로 검증: 한 장이 틀려도 나머지는 실림
    for (const c of (raw as { cards?: unknown[] } | undefined)?.cards ?? []) {
      const r = cardSchema.safeParse(c);
      if (r.success) this.defs.set(r.data.id, r.data);
      else this.problems.push(`${(c as { id?: string }).id ?? '?'}: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`);
    }
  }

  private key(p: Person, cardId: string): string {
    return `${p.id}:${cardId}`;
  }

  /** 조건 (24-1): 카드 조건과 선택지 조건에 같은 식 */
  condOk(p: Person, c: CardCond | undefined): boolean {
    if (!c) return true;
    const H = this.host;
    if (c.stage && !c.stage.includes(p.lifeStage)) return false;
    if (c.estate && !c.estate.includes(p.estate)) return false;
    if (c.sex && p.sex !== c.sex) return false;
    if (c.traitsAny && !c.traitsAny.some((t) => p.traits.includes(t))) return false;
    if (c.traitsNone && c.traitsNone.some((t) => p.traits.includes(t))) return false;
    if (c.married !== undefined && !!p.spouse !== c.married) return false;
    if (c.pregnant !== undefined && !!p.pregnancy !== c.pregnant) return false;
    const fl = H.flags(p);
    if (c.hasChild !== undefined && fl.has('has_child') !== c.hasChild) return false;
    if (c.hasBaby !== undefined && fl.has('has_baby') !== c.hasBaby) return false;
    if (c.flags && !c.flags.every((f) => fl.has(f))) return false;
    if (c.notFlags && c.notFlags.some((f) => fl.has(f))) return false;
    const S = H.savingsS(p) || 1;
    if (c.minMoneyS !== undefined && H.money(p) < c.minMoneyS * S) return false;
    if (c.maxMoneyS !== undefined && H.money(p) > c.maxMoneyS * S) return false;
    const fame = H.fame(p);
    if (c.minFame !== undefined && fame < c.minFame) return false;
    if (c.maxFame !== undefined && fame > c.maxFame) return false;
    if (c.season && !c.season.includes(H.season())) return false;
    if (c.after && !c.after.every((id) => (this.seen.get(this.key(p, id))?.n ?? 0) > 0)) return false;
    return true;
  }

  /** 인물 상태 → 카드 가용 조건 (13-8): 가용 / 래빗홀 / 여정 / 잠 */
  private availableFor(p: Person, def: CardDef): boolean {
    const st = p.sleeping ? 'asleep' : p.status === 'journey' ? 'journey' : p.status === 'rabbithole' || p.schoolAway ? 'rabbithole' : 'available';
    return def.availability.includes(st as never);
  }

  /** 이 인물에게 이 카드를 낼 수 있는가 (조건, 인생당 상한, 재등장 대기, 1회성) */
  eligible(p: Person, cardId: string): boolean {
    const def = this.defs.get(cardId);
    if (!def) return false;
    const s = this.seen.get(this.key(p, cardId));
    if (s && (def.once || s.n >= def.perLife)) return false;
    if (s && this.host.minute() - s.at < def.cooldown.value * 1440) return false;
    if (this.pending.some((x) => x.personId === p.id && x.cardId === cardId)) return false;
    return this.condOk(p, def.cond);
  }

  /**
   * 카드 내기: 대상이 없으면(부재 시 처리) 같은 가정의 가용 어른으로 바꾸거나(substitute) 버림(drop, hold 는 다음 기회).
   * 조작 가문이면 선택 대기, 아니면 바로 자동 선택. 낸 카드 또는 null
   */
  offer(p: Person, cardId: string, vars: Record<string, string | number> = {}, other: Person | null = null, force = false): PendingCard | null {
    const def = this.defs.get(cardId);
    if (!def) return null;
    let who: Person | null = p;
    if (!this.availableFor(p, def)) {
      who = def.absent.kind === 'substitute'
        ? this.host.persons.find((q) => q.household === p.household && q !== p && (q.lifeStage === 'young' || q.lifeStage === 'adult' || q.lifeStage === 'elder') && this.availableFor(q, def)) ?? null
        : null;
    }
    if (!who) return null;
    if (!force && !this.eligible(who, cardId)) return null;
    const options = def.options.map((o, i) => (this.condOk(who!, o.cond) ? i : -1)).filter((i) => i >= 0);
    if (!options.length) return null;
    const k = this.key(who, cardId);
    const s = this.seen.get(k);
    this.seen.set(k, { n: (s?.n ?? 0) + 1, at: this.host.minute() });
    const pc: PendingCard = { seq: ++this.seq, cardId, personId: who.id, otherId: other?.id ?? 0, vars, since: this.host.minute(), options };
    if (this.host.controlled(who)) {
      this.pending.push(pc);
      this.host.notice(who, 'card', { card: cardId, ...vars });
    } else this.resolve(pc, options[this.host.rng.int(options.length)]);
    return pc;
  }

  /** 조작 가문의 선택 (의도 cardChoice) */
  choose(seq: number, option: number): CardResult | null {
    const i = this.pending.findIndex((x) => x.seq === seq);
    if (i < 0) return null;
    const pc = this.pending[i];
    if (!pc.options.includes(option)) return null;
    this.pending.splice(i, 1);
    return this.resolve(pc, option);
  }

  /** 매시: 오래 안 고른 카드는 자동 선택 (차단 장면이 닫히지 않는 소프트락 방지) */
  hourly(): void {
    const now = this.host.minute();
    for (const pc of [...this.pending]) {
      if (now - pc.since < AUTO_PICK_MINUTES) continue;
      this.pending.splice(this.pending.indexOf(pc), 1);
      this.resolve(pc, pc.options[this.host.rng.int(pc.options.length)]);
    }
  }

  private resolve(pc: PendingCard, option: number): CardResult {
    const def = this.defs.get(pc.cardId)!;
    const o = def.options[option];
    const p = this.host.persons.find((q) => q.id === pc.personId);
    const other = pc.otherId ? this.host.persons.find((q) => q.id === pc.otherId) ?? null : null;
    let ok = true;
    if (o.check && p) {
      let chance = o.check.base;
      if (o.check.skill) chance += (o.check.perLevel ?? 0.05) * this.host.skillLevel(p, o.check.skill);
      if (o.check.trait && p.traits.includes(o.check.trait)) chance += 0.2;
      ok = this.host.rng.next() < Math.max(0.05, Math.min(0.95, chance));
    }
    const out = ok ? o.success : o.failure ?? o.success;
    const res: CardResult = { cardId: pc.cardId, option, ok, textKey: out.textKey, personId: pc.personId };
    if (p) this.apply(p, other, out, 0);
    this.log.push(res);
    if (this.log.length > 300) this.log.shift();
    return res;
  }

  /** 결과 적용 (월드 행동은 지금 늘 "시작 불가 시" 대체 결과 → 카드가 열린 채 멈추지 않음) */
  apply(p: Person, other: Person | null, out: CardOutcome, depth: number): void {
    const H = this.host;
    if (out.action && depth < 3) {
      this.apply(p, other, out.action.onCannotStart.outcome, depth + 1);
      return;
    }
    const spouse = p.spouse ? H.persons.find((q) => q.id === p.spouse) ?? null : null;
    const family = H.persons.filter((q) => q.household === p.household && q !== p && q.lifeStage !== 'baby');
    for (const m of out.moodlets ?? []) {
      const targets = m.who === 'self' ? [p] : m.who === 'spouse' ? (spouse ? [spouse] : []) : m.who === 'family' ? family : other ? [other] : [];
      for (const t of targets) H.moodlet(t, m.id);
    }
    if (out.moneyS) H.addMoney(p, Math.round(out.moneyS * H.savingsS(p)), 'card');
    if (out.fame || out.church || out.karma || out.morale || out.honor) H.reputation(p, { fame: out.fame, church: out.church, karma: out.karma, morale: out.morale, honor: out.honor }, 'card');
    if (out.relation) {
      const w = out.relation.with === 'spouse' ? spouse : out.relation.with === 'other' ? other : null;
      const targets = out.relation.with === 'family' ? family : w ? [w] : [];
      for (const t of targets) H.relation(p, t, out.relation);
    }
    if (out.memory) H.memory(p, out.memory.kind, out.memory.importance, out.memory.valence, other?.id ?? 0);
    if (out.rumor) H.rumor(p, out.rumor.kind, out.rumor.good, out.rumor.strength);
    if (out.chronicle) H.chronicle(out.chronicle, other ? [p, other] : [p]);
    if (out.heirloom) H.heirloom(p, out.heirloom);
    if (out.flag) H.setFlag(p, out.flag);
    if (out.chain && depth < 3) this.offer(p, out.chain, {}, other, true);
  }
}
