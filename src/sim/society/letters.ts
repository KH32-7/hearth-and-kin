/**
 * 편지 (GDD 14-7): 문해력(읽기 스킬 1 이상)이 있으면 직접 쓰고 읽음, 없으면 사제·서기에게 돈을 주고 대필·대독.
 * 용도: 먼 친척과 교류, 초대장, 연서, 중매, 청원서, 협박장 (+ 출생 소식, 부고, 해방 증서, 혼담 거절).
 * 전령이 하루 뒤 전달, 편지함(받은 편지, 읽음 표시). 본문은 letters.json 문장 틀 조합 (열기 1 + 본문 1~2 + 맺음 1,
 * 쓴 사람과 받는 사람의 신분 서열로 말투 register). AI 본문은 M15 (25장).
 * 효과: 관계, 무드렛 (letter_joy, love_letter_flutter, threat_letter_fear …), 중매 편지 → 구애 모듈, 청원서 → host.petition.
 *
 * 렌더러/DOM/window 없음. 무작위는 host.rng 만. 수치는 courtship.json letters, 문장 틀은 letters.json. 돈은 파딩.
 */
import type { Rng } from '../core/rng';
import type { Person } from '../people/person';
import { durDays, stripMeta, type Dur } from './courtship';

// ------------------------------------------------------------------ 데이터

export interface LetterEffect {
  moodlet?: string;
  friendship?: number;
  romance?: number;
  /** match → host.onMatchLetter, petition → host.petition, threat → host.onThreat */
  hook?: 'match' | 'petition' | 'threat';
}

export interface LettersRules {
  skill: string;
  minReading: number;
  scribeFee: number;
  readerFee: number;
  messengerFee: number;
  delivery: Dur;
  farReplyDays: [number, number];
  keepPerPerson: number;
  minStage: string[];
  bodyParts: [number, number];
  effects: Record<string, LetterEffect>;
  writeKinds: string[];
}

/** letters.json (문장 틀): kinds.<kind>.registers.<up|equal|down|any>.{open, body, close} */
export interface LetterTemplates {
  /** 신분 서열 (letters.json: 신분 → 순위, 상인과 장인은 같은 순위) */
  estateRank: Record<string, number>;
  kinds: Record<string, { nameKey: string; registers: Record<string, { open: string[]; body: string[]; close: string[] }> }>;
}

export function parseLetterRules(courtshipRaw: unknown): LettersRules {
  const d = stripMeta((courtshipRaw as { letters?: unknown } | undefined)?.letters) as LettersRules | undefined;
  if (!d || typeof d !== 'object' || !d.effects) throw new Error('courtship.json: letters 없음');
  return d;
}

export function parseLetterTemplates(raw: unknown): LetterTemplates {
  const d = stripMeta(raw) as LetterTemplates;
  if (!d?.kinds || !d.estateRank || typeof d.estateRank !== 'object') throw new Error('letters.json: kinds/estateRank 없음');
  return d;
}

// ------------------------------------------------------------------ Host

export interface LettersHost {
  readonly persons: readonly Person[];
  readonly rng: Rng;
  day(): number;
  lifespan(): number;
  skillLevel(p: Person, skill: string): number;
  /** 가구 돈 (파딩) */
  money(household: number): number;
  spend(household: number, amount: number, reason: string): boolean;
  moodlet(p: Person, id: string): void;
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
  /** 관계 변화 (from → to) */
  relation(a: Person, b: Person, d: { friendship?: number; romance?: number }): void;
  /** 가문명 (편지 {house}) */
  houseName(household: number): string;
  /** 조작 가문인가 (편지함 알림, NPC 는 받자마자 읽음) */
  controlled(household: number): boolean;
  /** 사제·서기가 있는가 (대필·대독). 없으면 true 로 봄 */
  scribeAvailable?(): boolean;
  /** 속마음 사건 (event:letter) */
  event?(p: Person, id: string): void;
  /** 중매 편지를 읽음 → courtship.matchByLetter(writer, reader, about) */
  onMatchLetter?(letter: Letter, writer: Person | null, reader: Person): void;
  /** 청원서 (영주·교회에 닿음, 18-4 / M9 정책) */
  petition?(writer: Person | null, reader: Person, letter: Letter): void;
  /** 협박장을 받음 (원한·재판 연결) */
  onThreat?(writer: Person | null, reader: Person, letter: Letter): void;
  /** 읽기 경험 (스킬 xp) */
  skillXp?(p: Person, skill: string, xp: number): void;
}

// ------------------------------------------------------------------ 상태

export interface Letter {
  id: number;
  kind: string;
  /** 쓴 사람 (0 = 먼 곳 사람), 이름 */
  from: number;
  fromName: string;
  fromHousehold: number;
  /** 받는 사람 (0 = 먼 곳 사람), 먼 곳 사람 이름 */
  to: number;
  toFar: string | null;
  /** 편지가 다루는 인물 (아기, 고인, 혼처 당사자 …) */
  about: number;
  sentDay: number;
  arriveDay: number;
  delivered: boolean;
  read: boolean;
  /** 서기가 대신 씀 */
  scribe: boolean;
  register: string;
  /** 문장 키 (열기, 본문 1~2, 맺음) */
  parts: string[];
  /** 문장 변수 {reader} {writer} {house} {name} */
  vars: Record<string, string>;
}

export interface LettersState {
  nextId: number;
  letters: Letter[];
  /** 가정별 먼 친척 이름 (분가·이주로 마을을 떠난 식구, 시작 설정) */
  farKin: Record<number, string[]>;
  /** 먼 곳에서 올 답장: 받을 사람, 이름, 도착 날 */
  replies: { to: number; name: string; day: number; kind: string }[];
  stats: { sent: number; delivered: number; read: number; scribe: number; reader: number };
}

export function emptyLettersState(): LettersState {
  return { nextId: 1, letters: [], farKin: {}, replies: [], stats: { sent: 0, delivered: 0, read: 0, scribe: 0, reader: 0 } };
}

export interface SendResult {
  ok: boolean;
  reason?: string;
  letterId?: number;
  /** 낸 돈 (파딩): 대필 + 전령 */
  cost?: number;
}

const no = (reason: string, cost?: number): SendResult => ({ ok: false, reason: `reason.letter.${reason}`, cost });

// ------------------------------------------------------------------ 모듈

export class Letters {
  state: LettersState = emptyLettersState();

  constructor(private host: LettersHost, readonly r: LettersRules, readonly t: LetterTemplates) {}

  private person(id: number): Person | undefined {
    return id ? this.host.persons.find((q) => q.id === id) : undefined;
  }

  /** 읽기 스킬 1 이상 */
  literate(p: Person): boolean {
    return this.host.skillLevel(p, this.r.skill) >= this.r.minReading;
  }

  private rank(estate: string): number {
    return this.t.estateRank[estate] ?? 1;
  }

  /** 말투: 쓴 쪽이 낮으면 up, 같으면 equal, 높으면 down. 그 register 가 없으면 가까운 것 */
  register(kind: string, writerEstate: string | null, readerEstate: string | null): string {
    const regs = this.t.kinds[kind]?.registers ?? {};
    if (regs.any) return 'any';
    let want = 'equal';
    if (writerEstate && readerEstate) {
      const w = this.rank(writerEstate);
      const r = this.rank(readerEstate);
      want = w < r ? 'up' : w > r ? 'down' : 'equal';
    }
    const order = want === 'down' ? ['down', 'equal', 'up'] : want === 'up' ? ['up', 'equal', 'down'] : ['equal', 'up', 'down'];
    return order.find((x) => regs[x]) ?? Object.keys(regs)[0] ?? 'equal';
  }

  /** 문장 틀 조합: 열기 1 + 본문 1~2 (겹치지 않게) + 맺음 1 */
  compose(kind: string, register: string): string[] {
    const reg = this.t.kinds[kind]?.registers[register];
    if (!reg) return [];
    const rng = this.host.rng;
    const pick = (arr: string[]) => arr[rng.int(arr.length)];
    const [lo, hi] = this.r.bodyParts;
    const n = Math.min(reg.body.length, lo + rng.int(hi - lo + 1));
    const body = [...reg.body];
    const chosen: string[] = [];
    for (let i = 0; i < n; i++) chosen.push(body.splice(rng.int(body.length), 1)[0]);
    return [pick(reg.open), ...chosen, pick(reg.close)];
  }

  /** 대필 비용 (쓰는 사람이 글을 모르면), 전령 비용 */
  sendCost(from: Person): number {
    return (this.literate(from) ? 0 : this.r.scribeFee) + this.r.messengerFee;
  }

  private stageOk(p: Person): boolean {
    return this.r.minStage.includes(p.lifeStage) && !p.infant;
  }

  /**
   * 편지 보내기 (의도 sendLetter): 글을 모르면 서기에게 대필비, 전령비. 하루 뒤 도착.
   * toId 0 + far 이름 = 먼 친척에게 (답장이 며칠 뒤 옴)
   */
  send(fromId: number, toId: number, kind: string, opts: { about?: number; far?: string; free?: boolean } = {}): SendResult {
    const from = this.person(fromId);
    if (!from) return no('gone');
    if (!this.t.kinds[kind] || !this.r.writeKinds.includes(kind)) return no('unknown_kind');
    if (!this.stageOk(from)) return no('too_young');
    const to = this.person(toId);
    if (!to && !opts.far) return no('no_recipient');
    if (to === from) return no('self');
    const H = this.host;
    let cost = 0;
    const scribe = !this.literate(from);
    if (!opts.free) {
      if (scribe && H.scribeAvailable && !H.scribeAvailable()) return no('no_scribe');
      cost = this.sendCost(from);
      if (H.money(from.household) < cost) return no('money', cost);
      if (cost > 0 && !H.spend(from.household, cost, scribe ? 'letter_scribe' : 'letter_post')) return no('money', cost);
      if (scribe) this.state.stats.scribe++;
    }
    const day = H.day();
    const register = this.register(kind, from.estate, to?.estate ?? null);
    const about = opts.about ? this.person(opts.about) : undefined;
    const L: Letter = {
      id: this.state.nextId++,
      kind,
      from: from.id,
      fromName: from.name,
      fromHousehold: from.household,
      to: to?.id ?? 0,
      toFar: to ? null : opts.far ?? null,
      about: about?.id ?? 0,
      sentDay: day,
      arriveDay: day + Math.max(1, Math.round(durDays(this.r.delivery, H.lifespan()))),
      delivered: false,
      read: false,
      scribe,
      register,
      parts: this.compose(kind, register),
      vars: { reader: to?.name ?? opts.far ?? '', writer: from.name, house: H.houseName(from.household), name: about?.name ?? '' },
    };
    this.state.letters.push(L);
    this.state.stats.sent++;
    if (!opts.free && H.controlled(from.household)) H.notice(from, 'letter_sent', { a: L.vars.reader, kind: `letter.kind.${kind}` });
    this.skillXp(from, 'write');
    return { ok: true, letterId: L.id, cost };
  }

  /** NPC·시스템 편지 (구애 모듈의 혼담 거절, 출생 소식 …): 돈 없이 */
  sendFree(from: Person, to: Person, kind: string, about?: Person): SendResult {
    return this.send(from.id, to.id, kind, { about: about?.id, free: true });
  }

  /** 먼 곳 사람이 보낸 편지 (먼 친척 답장, 부고) */
  fromFar(toId: number, name: string, kind: string, about = 0): Letter | null {
    const to = this.person(toId);
    if (!to || !this.t.kinds[kind]) return null;
    const day = this.host.day();
    const register = this.register(kind, null, null);
    const L: Letter = {
      id: this.state.nextId++,
      kind,
      from: 0,
      fromName: name,
      fromHousehold: 0,
      to: to.id,
      toFar: null,
      about,
      sentDay: day,
      arriveDay: day,
      delivered: false,
      read: false,
      scribe: false,
      register,
      parts: this.compose(kind, register),
      vars: { reader: to.name, writer: name, house: name, name: this.person(about)?.name ?? '' },
    };
    this.state.letters.push(L);
    return L;
  }

  /** 먼 친척 등록 (분가·이주로 떠난 식구) */
  addFarKin(household: number, name: string): void {
    const list = (this.state.farKin[household] ??= []);
    if (!list.includes(name)) list.push(name);
  }

  farKin(household: number): string[] {
    return this.state.farKin[household] ?? [];
  }

  /** 매일 (자정): 전령이 도착한 편지를 전함, 먼 곳 답장 */
  daily(): void {
    const H = this.host;
    const day = H.day();
    for (const rp of [...this.state.replies]) {
      if (rp.day > day) continue;
      this.state.replies.splice(this.state.replies.indexOf(rp), 1);
      this.fromFar(rp.to, rp.name, rp.kind);
    }
    for (const L of this.state.letters) {
      if (L.delivered || L.arriveDay > day) continue;
      L.delivered = true;
      this.state.stats.delivered++;
      if (L.toFar) {
        // 먼 친척에게 간 편지: 며칠 뒤 답장
        const [lo, hi] = this.r.farReplyDays;
        const writer = this.person(L.from);
        if (writer && L.kind !== 'threat') this.state.replies.push({ to: writer.id, name: L.toFar, day: day + lo + H.rng.int(hi - lo + 1), kind: 'kin_greeting' });
        continue;
      }
      const reader = this.person(L.to);
      if (!reader) continue;
      H.event?.(reader, 'letter');
      if (H.controlled(reader.household)) H.notice(reader, 'letter_arrived', { a: L.fromName, kind: `letter.kind.${L.kind}` });
      else this.applyRead(L, reader);
    }
    this.trim();
  }

  private trim(): void {
    const byTo = new Map<number, Letter[]>();
    for (const L of this.state.letters) {
      const k = L.to || -L.from;
      const arr = byTo.get(k) ?? [];
      arr.push(L);
      byTo.set(k, arr);
    }
    const drop = new Set<Letter>();
    for (const arr of byTo.values()) {
      const done = arr.filter((L) => L.delivered && (L.read || !L.to));
      while (done.length > this.r.keepPerPerson) drop.add(done.shift()!);
    }
    if (drop.size) this.state.letters = this.state.letters.filter((L) => !drop.has(L));
  }

  /** 편지함 (받은 편지, 새 편지 먼저) */
  inbox(personId: number): Letter[] {
    return this.state.letters.filter((L) => L.to === personId && L.delivered).sort((a, b) => Number(a.read) - Number(b.read) || b.arriveDay - a.arriveDay || b.id - a.id);
  }

  /** 가정 편지함 */
  householdInbox(household: number): Letter[] {
    const ids = new Set(this.host.persons.filter((p) => p.household === household).map((p) => p.id));
    return this.state.letters.filter((L) => ids.has(L.to) && L.delivered).sort((a, b) => Number(a.read) - Number(b.read) || b.arriveDay - a.arriveDay || b.id - a.id);
  }

  unread(personId: number): number {
    return this.state.letters.filter((L) => L.to === personId && L.delivered && !L.read).length;
  }

  /** 읽기 (의도 readLetter): 글을 모르면 사제·서기에게 대독비. 효과는 처음 읽을 때 한 번 */
  read(personId: number, letterId: number): SendResult & { parts?: string[]; vars?: Record<string, string> } {
    const p = this.person(personId);
    const L = this.state.letters.find((x) => x.id === letterId);
    if (!p || !L || !L.delivered) return no('no_letter');
    if (L.to !== p.id) return no('not_recipient');
    let cost = 0;
    if (!L.read && !this.literate(p)) {
      const H = this.host;
      if (H.scribeAvailable && !H.scribeAvailable()) return no('no_scribe');
      cost = this.r.readerFee;
      if (!H.spend(p.household, cost, 'letter_reader')) return no('money', cost);
      this.state.stats.reader++;
    }
    if (!L.read) this.applyRead(L, p);
    return { ok: true, letterId: L.id, cost, parts: L.parts, vars: L.vars };
  }

  /** 편지 효과 (관계, 무드렛, 훅) */
  private applyRead(L: Letter, reader: Person): void {
    if (L.read) return;
    L.read = true;
    this.state.stats.read++;
    const H = this.host;
    const e = this.r.effects[L.kind] ?? {};
    const writer = this.person(L.from) ?? null;
    if (e.moodlet) H.moodlet(reader, e.moodlet);
    if (writer && (e.friendship || e.romance)) H.relation(reader, writer, { friendship: e.friendship, romance: e.romance });
    if (e.hook === 'match') H.onMatchLetter?.(L, writer, reader);
    if (e.hook === 'petition') H.petition?.(writer, reader, L);
    if (e.hook === 'threat') H.onThreat?.(writer, reader, L);
    this.skillXp(reader, 'read');
  }

  private skillXp(p: Person, what: 'read' | 'write'): void {
    if (this.literate(p)) this.host.skillXp?.(p, this.r.skill, what === 'write' ? 2 : 1);
  }

  /** 식탁에서 편지 쓰기 (table.write_letter): 연인·약혼자 → 연서, 먼 친척 → 안부, 다른 집 친구 → 초대장 */
  autoWriteTarget(p: Person): { to: Person | null; far: string | null; kind: string } | null {
    const H = this.host;
    const others = H.persons.filter((q) => q !== p && q.household !== p.household && !q.infant);
    const loverOf = (q: Person) => p.betrothed === q.id;
    const lover = others.find(loverOf);
    if (lover) return { to: lover, far: null, kind: 'love' };
    const far = this.farKin(p.household);
    if (far.length) return { to: null, far: far[H.rng.int(far.length)], kind: 'kin_greeting' };
    return null;
  }

  /**
   * 물건 상호작용이 끝났을 때 (리드: onInteraction). 연인은 host 가 관계로 판정해 넘길 수 있게 lover 인자
   */
  onInteraction(p: Person, iaId: string, lover: Person | null = null): SendResult | null {
    if (iaId === 'table.write_letter') {
      const t = lover && lover.household !== p.household ? { to: lover, far: null, kind: 'love' } : this.autoWriteTarget(p);
      if (!t) return null;
      return this.send(p.id, t.to?.id ?? 0, t.kind, { far: t.far ?? undefined });
    }
    if (iaId === 'table.read_letters') {
      const L = this.inbox(p.id).find((x) => !x.read);
      if (L) return this.read(p.id, L.id);
    }
    return null;
  }

  /** 조건 게이트: 편지 쓰기 (글을 알고 보낼 사람이 있음), 안 읽은 편지 */
  gates(isLover: (p: Person, q: Person) => boolean = () => false): Record<string, (p: Person, t: Person | null) => boolean> {
    return {
      can_write_letter: (p) =>
        this.stageOk(p) &&
        this.literate(p) &&
        (this.farKin(p.household).length > 0 || !!p.betrothed || this.host.persons.some((q) => q.household !== p.household && isLover(p, q))),
      has_unread_letter: (p) => this.unread(p.id) > 0,
    };
  }

  /** 카드 조건 flags: can_read, kin_far_away */
  flags(p: Person): string[] {
    const out: string[] = [];
    if (this.literate(p)) out.push('can_read');
    if (this.farKin(p.household).length) out.push('kin_far_away');
    return out;
  }

  hashParts(parts: (string | number)[]): void {
    parts.push('letters', JSON.stringify(this.state));
  }
}
