/**
 * 구애와 혼인 (GDD 14-4): 연애혼(로맨스 → 고백 → 청혼 → 양가 가장 승낙 → 약혼 → 교회 혼례),
 * 중매혼(혼처 찾기 → 후보 목록 → 협상(지참금·거주지·성씨) → 약혼 → 혼례), 사랑의 도피, 지참금/신부값(빚·땅·가보),
 * 혼례(예식 → 잔치 → 가문 명성·좋은 소문), 거주(신랑 집 기본, 데릴사위 성 변경, 인원 상한이면 분가),
 * 혼인 이후(불륜·발각·배신 기억, 사생아 판정, 혼인 무효 청원, 별거, 사별·애도·재혼 소문, 유령 질투 훅).
 * 생애 판정기(18-3)가 쓰는 NPC 점수·혼인 규칙도 여기서 제공.
 *
 * 렌더러/DOM/window 없음 (워커). 무작위는 host.rng 만. 수치는 src/data/courtship.json. 돈은 파딩.
 * 세계를 바꾸는 일은 모두 CourtshipHost 를 거침 (리드가 sim.ts 에 구현). 상태는 직렬화 가능한 state 하나.
 */
import type { Rng } from '../core/rng';
import type { Person } from '../people/person';
import type { Relations } from '../social/relations';

// ------------------------------------------------------------------ 데이터

/** 기간 필드 (29-0) */
export interface Dur {
  value: number;
  scale: string;
}

export type CardAction = string | { ok?: string; fail?: string };

export interface CourtshipData {
  rules: {
    minAge: number;
    kinDegreeMax: number;
    ageGapYears: number;
    allowSameSex: boolean;
    betrothal: Dur;
    weddingDayMax: Dur;
    recentWed: Dur;
    mourning: Dur;
    priestPostponeMax: number;
    decidedMemory: Dur;
  };
  consent: {
    base: number;
    estateStep: number;
    gapFrom: number;
    gapPenalty: number;
    dowryShort: number;
    fameMid: number;
    fameDiv: number;
    friendship: number;
    respect: number;
    blessing: number;
    matchBlocked: number;
    min: number;
    max: number;
    traits: Record<string, number>;
    ambitiousOnlyIfLower: boolean;
    controlledHeadAuto: boolean;
    jiltedRumorChance: number;
    jiltedStrength: number;
  };
  match: {
    candidates: number;
    qualityExtra: number;
    goodExtra: number;
    traitsShown: number;
    offerDays: Dur;
    estateWeight: number;
    fameWeight: number;
    dowryWeight: number;
    clanWeight: number;
    ageWeight: number;
    npcProposalChance: number;
    matchmakerCardChance: number;
    matchmakerCooldown: Dur;
  };
  negotiate: {
    base: number;
    dowryRatioWeight: number;
    dowryRatioMax: number;
    uxorilocal: number;
    uxorilocalNoSon: number;
    newHouse: number;
    surnameChange: number;
    retry: Dur;
    uneasyRomanceBelow: number;
    discussBonus: number;
    dowryTalkDiscount: number;
  };
  dowry: { baseMult: number; upMult: number; rankStep: number; shortFame: number; shortFriendship: number; estateRank: string[] };
  wedding: {
    guestFriendship: number;
    maxGuests: number;
    fameBase: number;
    famePerGuest: number;
    generousScore: number;
    generousStrength: number;
    loveMatchRomance: number;
    loveMatchStrength: number;
    spouseFriendship: number;
    spouseRomance: number;
    tiers: Record<FeastTier, { moneyS: number; fame: number; score: number }>;
    npcGrandMoneyS: number;
    npcModestMoneyS: number;
  };
  residence: { default: Residence; controlledStays: boolean };
  elopement: { fame: number; church: number; familyFriendship: number; rumorStrength: number };
  affair: {
    exposeChance: number;
    publicMult: number;
    betrayFriendship: number;
    betrayRomance: number;
    fame: number;
    church: number;
    confessFactor: number;
    rumorStrength: number;
    guiltSkipTraits: string[];
    temptationChance: number;
    temptationRomance: number;
    proposalRomance: number;
  };
  bastard: { betrothedLegit: boolean; rumorStrength: number };
  annulment: {
    feeS: number;
    churchMin: number;
    chanceBase: number;
    churchPer: number;
    failChurch: number;
    rumorStrength: number;
    reasons: {
      consanguinity: { kinDegreeMax: number };
      childless: { marriedDays: Dur };
      coerced: { romanceBelow: number; within: Dur };
      abandonment: { separated: Dur };
    };
  };
  separation: { friendship: number; rumorStrength: number; reconcileFriendship: number };
  widow: { rumorStrength: number; church: number; proposalChance: number; proposalFriendship: number };
  npc: {
    baseDaily: number;
    estateGapFrom: number;
    estateGapMult: number;
    friendshipBonus: number;
    friendshipFloor: number;
    romanceBonus: number;
    blockedMult: number;
    engagedRomance: number;
    engagedFriendship: number;
  };
  cards: Record<string, Record<string, CardAction>>;
}

/** `$` 로 시작하는 설명 키를 모두 뺌 */
export function stripMeta<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripMeta) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!k.startsWith('$')) out[k] = stripMeta(x);
    return out as T;
  }
  return v;
}

const SECTIONS = ['rules', 'consent', 'match', 'negotiate', 'dowry', 'wedding', 'residence', 'elopement', 'affair', 'bastard', 'annulment', 'separation', 'widow', 'npc', 'cards'] as const;

/** courtship.json → 수치 (social/interactions/dialogue/letters 묶음은 무시). 빠진 절이 있으면 throw */
export function parseCourtship(raw: unknown): CourtshipData {
  const d = stripMeta(raw) as Record<string, unknown>;
  for (const s of SECTIONS) if (!d || typeof d[s] !== 'object') throw new Error(`courtship.json: ${s} 없음`);
  return d as unknown as CourtshipData;
}

/** 기간 → 게임일 (29-0). season 은 한 계절 7일 기준 */
export function durDays(d: Dur, lifespan: number, seasonDays = 7): number {
  if (d.scale === 'lifespan') return d.value * lifespan;
  if (d.scale === 'season') return d.value * (seasonDays / 7);
  return d.value;
}

// ------------------------------------------------------------------ 근친 (촌수)

/**
 * 촌수 (4촌 이내 혼인 금지, 14-4): 공통 조상까지 두 사람의 세대 수 합의 최솟값.
 * 부모-자식 1, 형제 2, 조부모 2, 삼촌 3, 사촌 4. max 안에 공통 조상이 없으면 Infinity.
 * parentsOf 는 죽은 사람까지 (가계도)
 */
export function kinDegree(a: number, b: number, parentsOf: (id: number) => readonly [number, number] | null, max = 8): number {
  if (a === b) return 0;
  const up = (id: number): Map<number, number> => {
    const m = new Map<number, number>([[id, 0]]);
    let frontier = [id];
    for (let d = 1; d <= max && frontier.length; d++) {
      const next: number[] = [];
      for (const x of frontier) {
        const ps = parentsOf(x);
        if (!ps) continue;
        for (const q of ps) {
          if (!q || m.has(q)) continue;
          m.set(q, d);
          next.push(q);
        }
      }
      frontier = next;
    }
    return m;
  };
  const A = up(a);
  const B = up(b);
  let best = Infinity;
  for (const [id, da] of A) {
    const db = B.get(id);
    if (db !== undefined && da + db < best) best = da + db;
  }
  return best <= max ? best : Infinity;
}

// ------------------------------------------------------------------ Host

export type Residence = 'groom' | 'bride' | 'new';
export type FeastTier = 'grand' | 'modest' | 'church';
export type Path = 'love' | 'arranged' | 'npc' | 'eloped';

/** 신분 체계 판정 결과 모양 (estates.ts EstatePlan 의 일부) */
export interface MarriagePlanLike {
  ok: boolean;
  reason?: string;
  warning?: string;
}

/** 구애·혼인이 세계에 닿는 창구. 리드가 sim.ts 에 구현. 선택(?) 메서드는 없으면 기본 동작 */
export interface CourtshipHost {
  readonly persons: readonly Person[];
  readonly rng: Rng;
  readonly rel: Relations;
  day(): number;
  /** 수명 배수 (29-0) */
  lifespan(): number;
  /** 표시 나이 (29-2, 년) */
  age(p: Person): number;
  /** 조작 가문의 가구인가 */
  controlled(household: number): boolean;
  /** 가정의 가장 (살아 있는 사람) */
  headOf(household: number): Person | undefined;
  /** 가정 대표 신분 (16-2) */
  householdEstate(household: number): string;
  /** 가정 인원 상한 (15-8: 12, 조작 가문 8) */
  householdCap(household: number): number;
  /** 부모 id [어머니, 아버지] — 죽은 사람도 (가계도). 모르면 null */
  parentsOf(id: number): readonly [number, number] | null;
  /** 가구 돈 (파딩) */
  money(household: number): number;
  /** 돈 내기. 모자라면 false (아무것도 빼지 않음) */
  spend(household: number, amount: number, reason: string): boolean;
  addMoney(household: number, amount: number, reason: string): void;
  /** 한 인생 저축 목표 S (17-4, 수명 배수 반영, 파딩) */
  savingsS(estate: string): number;
  /** 가문 명성 변화 (by = 개인 명예 쌓일 사람) */
  fame(household: number, delta: number, reason: string, by?: Person): void;
  /** 가문 명성 (0~1000) */
  fameOf(household: number): number;
  /** 교회 평판 변화 (16-4, −100~100) */
  church(p: Person, delta: number): void;
  moodlet(p: Person, id: string): void;
  memory(p: Person, kind: string, importance: number, valence: number, withPerson: number): void;
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
  news(kind: string, args: Record<string, string | number>, subjects: Person[]): void;
  chronicle(trigger: string, subjects: Person[], args?: Record<string, string | number>): void;
  /** 소문 (14-6): subjects 가 주인공, knownBy 가 처음 아는 사람 (없으면 주인공) */
  rumor(subjects: Person[], kind: string, strength: number, knownBy?: Person[]): void;
  /** 사건 카드 (sim.offerCard: 조건 무시하고 냄) */
  offerCard(p: Person, cardId: string, vars?: Record<string, string | number>, other?: Person | null): void;
  /** 이사 (가구와 집 부지) */
  moveTo(p: Person, household: number): void;
  /** 분가: 새 가정 번호 */
  splitHousehold(ps: Person[], reason: string): number;

  // 선택: 다른 모듈 연결
  /** 속마음·소원 사건 (inner.event: engaged, wedding …) */
  event?(p: Person, id: string): void;
  /** 사회 상호작용 분류 (social.json category). 없으면 알려진 로맨스 id 목록 */
  socialCategory?(id: string): string | undefined;
  /** estates.canMarry (성직자 독신) */
  canMarryEstate?(p: Person): boolean;
  /** estates.marriageAcceptMod (두 단계 이상 차이 보정) */
  marriageAcceptMod?(a: string, b: string): number;
  /** estates.dowry(내는 쪽 신분, 받는 쪽 신분) (파딩) */
  dowry?(payerEstate: string, receiverEstate: string): number;
  /** estates.planMarriage 사전 경고 */
  planMarriage?(partner: Person, incoming: Person, opts: { uxorilocal?: boolean }): MarriagePlanLike;
  /** estates.marry 실행 (영주 허락·해방금·신분·데릴사위 성 변경) */
  estatesMarry?(partner: Person, incoming: Person, opts: { uxorilocal?: boolean }): MarriagePlanLike;
  /** 데릴사위 성 변경 (estatesMarry 가 없을 때만 부름) */
  changeSurname?(p: Person, toHousehold: number): void;
  /** clans.matchModifier / matchBlocked / matchQuality / onMarriage / onScandal */
  matchModifier?(hhA: number, hhB: number): number;
  matchBlocked?(household: number): boolean;
  matchQuality?(household: number): number;
  onMarriage?(a: Person, b: Person): void;
  onScandal?(a: Person, b: Person): void;
  /** 지참금 대신 가보 (heirlooms.dowry): 넘긴 가보 값 (파딩), 없으면 0 */
  heirloomDowry?(fromHousehold: number, toHousehold: number, by: Person | null): number;
  /** 지참금 대신 땅 (밭 구획·영지): 넘긴 값 (파딩) */
  landDowry?(fromHousehold: number, toHousehold: number, amount: number): number;
  /** 빚 (17장 대출): 성공하면 가구에 돈이 들어옴 */
  borrow?(household: number, amount: number, reason: string): boolean;
  /** 혼례 집전할 사제가 있는가 */
  priestAvailable?(): boolean;
  /** 유령인가 (M11), 유령 질투 사건 훅 (20-6) */
  isGhost?(id: number): boolean;
  ghostJealousy?(ghostId: number, widow: Person, newSpouse: Person): void;
  /** 편지 보내기 (letters.ts sendFree) */
  letter?(from: Person, to: Person, kind: string, about?: Person): void;
}

// ------------------------------------------------------------------ 상태

export interface Betrothal {
  id: number;
  /** 신랑 쪽, 신부 쪽 (같은 성별이면 a 가 신랑 자리) */
  a: number;
  b: number;
  since: number;
  weddingDay: number;
  path: Path;
  /** 지참금 (파딩): 들어가는 사람 가정이 받는 가정에 냄 */
  dowry: number;
  residence: Residence;
  /** 거주지를 협상으로 정함 (조작 가문 집 우선 규칙을 쓰지 않음) */
  residenceSet: boolean;
  surname: 'groom' | 'bride';
  feast: FeastTier | null;
  feastByCard: boolean;
  dowryCover: 'debt' | 'heirloom' | 'heirloom_card' | 'land' | 'waive' | null;
  postponed: number;
  hastyDone: boolean;
  nerves: boolean;
}

export interface MatchOffer {
  id: number;
  /** 혼처를 찾는 가정, 그 당사자 */
  hh: number;
  personId: number;
  candidateId: number;
  day: number;
  expires: number;
  /** 기준 지참금 (파딩, 들어가는 쪽이 냄) */
  dowry: number;
  status: 'open' | 'agreed' | 'refused';
  /** 상대 가정이 먼저 청한 혼담 (조작 가문이 받음: 수락/거절) */
  incoming: boolean;
  lastTry: number;
  /** 승낙 판정 보정 (혼처 의논·지참금 협상) */
  bonus: number;
}

export interface Affair {
  a: number;
  b: number;
  since: number;
  exposed: boolean;
}

export interface CourtshipStats {
  engagements: number;
  marriages: number;
  loveMatches: number;
  arranged: number;
  elopements: number;
  refusals: number;
  affairs: number;
  exposed: number;
  annulments: number;
  separations: number;
  bastards: number;
  hasty: number;
  splits: number;
  dowryDebt: number;
}

export interface CourtshipState {
  nextId: number;
  betrothals: Betrothal[];
  offers: MatchOffer[];
  /** 가장이 거절한 연인 (사랑의 도피 가능) */
  refusals: { a: number; b: number; day: number }[];
  /** 축복 청하기에 성공: suitor → 상대 가장 */
  blessings: { suitor: number; head: number; day: number }[];
  mourning: { personId: number; spouseId: number; since: number; until: number }[];
  affairs: Affair[];
  separations: { a: number; b: number; leaver: number; since: number }[];
  /** 혼례 기록 (혼인 무효 때 들어온 사람을 돌려보냄) */
  weddings: { a: number; b: number; day: number; incoming: number; fromHh: number; path: Path }[];
  /** 사별·무효로 끝난 배우자 (유령 질투) */
  formerSpouses: Record<number, number[]>;
  /** 조작 가문의 명시적 행동이 있었던 날 (생애 판정기가 같은 날 다시 굴리지 않음) */
  decided: Record<number, number>;
  /** 카드 재등장 대기: "가구:카드" → 날 */
  cardDay: Record<string, number>;
  stats: CourtshipStats;
}

export function emptyCourtshipState(): CourtshipState {
  return {
    nextId: 1,
    betrothals: [],
    offers: [],
    refusals: [],
    blessings: [],
    mourning: [],
    affairs: [],
    separations: [],
    weddings: [],
    formerSpouses: {},
    decided: {},
    cardDay: {},
    stats: { engagements: 0, marriages: 0, loveMatches: 0, arranged: 0, elopements: 0, refusals: 0, affairs: 0, exposed: 0, annulments: 0, separations: 0, bastards: 0, hasty: 0, splits: 0, dowryDebt: 0 },
  };
}

export interface Res {
  ok: boolean;
  /** i18n 키 (reason.court.*) */
  reason?: string;
}

export interface MatchCandidate {
  matchId: number;
  personId: number;
  name: string;
  sex: 'male' | 'female';
  estate: string;
  age: number;
  household: number;
  /** 기준 지참금 (파딩), 누가 내는가 (true = 우리 가정) */
  dowry: number;
  wePay: boolean;
  fame: number;
  /** 보이는 특성 일부 */
  traits: string[];
  /** 가문 관계 보정 (−, 0, +) */
  clan: number;
  score: number;
}

export type AnnulReason = 'consanguinity' | 'childless' | 'coerced' | 'abandonment';
const ANNUL_REASONS: AnnulReason[] = ['consanguinity', 'childless', 'coerced', 'abandonment'];

/** social.json 에 있는 로맨스 상호작용 (host.socialCategory 가 없을 때) */
const ROMANCE_IDS = new Set(['social.glance', 'social.flirt', 'social.give_flowers', 'social.hold_hands', 'social.confess', 'social.kiss', 'social.serenade', 'social.love_letter', 'social.propose', 'social.propose_bed', 'social.whisper_sweet', 'social.cuddle', 'social.ask_walk', 'social.affair_proposal']);

const MARRIAGE_STAGES = new Set(['teen', 'young', 'adult', 'elder']);

const no = (reason: string): Res => ({ ok: false, reason: `reason.court.${reason}` });
const yes: Res = { ok: true };

// ------------------------------------------------------------------ 모듈

export class Courtship {
  state: CourtshipState = emptyCourtshipState();

  constructor(private host: CourtshipHost, readonly d: CourtshipData) {}

  // ---------------------------------------------------------------- 조회

  private person(id: number): Person | undefined {
    return id ? this.host.persons.find((q) => q.id === id) : undefined;
  }

  private days(x: Dur): number {
    return Math.max(0, Math.round(durDays(x, this.host.lifespan())));
  }

  private rank(estate: string): number {
    const i = this.d.dowry.estateRank.indexOf(estate);
    return i < 0 ? 1 : i;
  }

  private ctl(p: Person): boolean {
    return this.host.controlled(p.household);
  }

  /** 촌수 (가계도) */
  kin(a: Person, b: Person, max = 8): number {
    return kinDegree(a.id, b.id, (id) => this.host.parentsOf(id), max);
  }

  betrothalOf(p: Person): Betrothal | undefined {
    return this.state.betrothals.find((b) => b.a === p.id || b.b === p.id);
  }

  affairOf(p: Person, other?: Person): Affair | undefined {
    return this.state.affairs.find((f) => (f.a === p.id || f.b === p.id) && (!other || f.a === other.id || f.b === other.id));
  }

  separationOf(p: Person): CourtshipState['separations'][number] | undefined {
    return this.state.separations.find((s) => s.a === p.id || s.b === p.id);
  }

  mourningOf(p: Person): CourtshipState['mourning'][number] | undefined {
    const day = this.host.day();
    return this.state.mourning.find((m) => m.personId === p.id && m.until > day);
  }

  /** 혼인할 수 있는 나이·단계·신분 (상대 없이) */
  eligible(p: Person): Res {
    if (p.infant || !MARRIAGE_STAGES.has(p.lifeStage)) return no('too_young');
    if (this.host.age(p) < this.d.rules.minAge) return no('too_young');
    if (p.status === 'ghost') return no('ghost');
    const celibate = this.host.canMarryEstate ? !this.host.canMarryEstate(p) : p.estate === 'clergy';
    if (celibate) return no('celibate');
    return yes;
  }

  /** 두 사람이 혼인(약혼)할 수 있는가: 16세, 근친 4촌, 이미 혼인/약혼, 성직자 독신, 성별 */
  canMarry(a: Person, b: Person): Res {
    if (a === b) return no('self');
    for (const p of [a, b]) {
      const e = this.eligible(p);
      if (!e.ok) return e;
    }
    if (a.spouse || b.spouse) return no('married');
    const ba = this.betrothalOf(a);
    const bb = this.betrothalOf(b);
    if ((ba && ba !== bb) || (bb && ba !== bb)) return no('betrothed');
    if (!this.d.rules.allowSameSex && a.sex === b.sex) return no('same_sex');
    if (this.kin(a, b, this.d.rules.kinDegreeMax) <= this.d.rules.kinDegreeMax) return no('kin');
    return yes;
  }

  /** 혼인 적령 독신 (중매 후보, 혼처 찾기) */
  single(p: Person): boolean {
    return this.eligible(p).ok && !p.spouse && !this.betrothalOf(p) && !p.betrothed;
  }

  decidedToday(p: Person): boolean {
    const d = this.state.decided[p.id];
    return d !== undefined && this.host.day() - d < Math.max(1, this.days(this.d.rules.decidedMemory));
  }

  private markDecided(...ps: Person[]): void {
    for (const p of ps) this.state.decided[p.id] = this.host.day();
  }

  // ---------------------------------------------------------------- 지참금 (14-4, 17-4)

  /** 기준 지참금: 내는 쪽 신분 S × 1/4, 한 단계 위 가문으로 들어가면 받는 쪽 기준 × 1.5 (estates.dowry 가 있으면 그것) */
  dowryFor(payerEstate: string, receiverEstate: string): number {
    if (this.host.dowry) return this.host.dowry(payerEstate, receiverEstate);
    const D = this.d.dowry;
    const base = (e: string) => this.host.savingsS(e) * D.baseMult;
    if (this.rank(receiverEstate) - this.rank(payerEstate) >= D.rankStep) return Math.round(base(receiverEstate) * D.upMult);
    return Math.round(base(payerEstate));
  }

  /** 누가 들어가나 (거주지): [남는 사람, 들어가는 사람], 새 집이면 [신랑, 신부] */
  private roles(groom: Person, bride: Person, residence: Residence): { stay: Person; incoming: Person } {
    return residence === 'bride' ? { stay: bride, incoming: groom } : { stay: groom, incoming: bride };
  }

  /** 신랑 쪽 / 신부 쪽 (같은 성이면 a 가 신랑 자리) */
  private groomBride(a: Person, b: Person): [Person, Person] {
    if (a.sex === 'female' && b.sex === 'male') return [b, a];
    return [a, b];
  }

  private standardDowry(groom: Person, bride: Person, residence: Residence): { amount: number; payerHh: number; receiverHh: number } {
    const { stay, incoming } = this.roles(groom, bride, residence);
    const payerHh = incoming.household;
    const receiverHh = stay.household;
    return { amount: this.dowryFor(this.host.householdEstate(payerHh), this.host.householdEstate(receiverHh)), payerHh, receiverHh };
  }

  // ---------------------------------------------------------------- 승낙 판정 (14-4)

  /**
   * 가장 head 가 자기 식구 child 와 suitor 의 혼인을 승낙할 확률 (0~1).
   * 신분 차이, 지참금, 가문 관계, 상대 명성, 부모 특성, 가장→상대 관계, 축복 청하기
   */
  consentChance(head: Person, child: Person, suitor: Person, bonus = 0): number {
    const C = this.d.consent;
    const H = this.host;
    let p = C.base + bonus;
    const eh = H.householdEstate(child.household);
    const es = H.householdEstate(suitor.household);
    const gap = Math.abs(this.rank(eh) - this.rank(es));
    p += gap * C.estateStep;
    if (gap >= C.gapFrom) p += H.marriageAcceptMod ? H.marriageAcceptMod(eh, es) : C.gapPenalty;
    // 지참금: 상대 가정이 내야 하는데 돈이 모자라면 불리
    const [groom, bride] = this.groomBride(child, suitor);
    const dw = this.standardDowry(groom, bride, this.d.residence.default);
    if (dw.payerHh === suitor.household && H.money(dw.payerHh) < dw.amount) p += C.dowryShort;
    p += H.matchModifier?.(child.household, suitor.household) ?? 0;
    if (H.matchBlocked?.(child.household) || H.matchBlocked?.(suitor.household)) p += C.matchBlocked;
    p += (H.fameOf(suitor.household) - C.fameMid) / C.fameDiv;
    p += H.rel.friendship(head.id, suitor.id) * C.friendship + H.rel.respect(head.id, suitor.id) * C.respect;
    for (const t of head.traits) {
      const v = C.traits[t];
      if (v === undefined) continue;
      if (t === 'ambitious' && C.ambitiousOnlyIfLower && this.rank(es) >= this.rank(eh)) continue;
      p += v;
    }
    if (this.state.blessings.some((b) => b.suitor === suitor.id && b.head === head.id)) p += C.blessing;
    return Math.max(C.min, Math.min(C.max, p));
  }

  /** 양가 가장 승낙 판정. 조작 가문 가장은 플레이어이므로 자동 승낙 (controlledHeadAuto) */
  private bothConsent(a: Person, b: Person, bonus = 0): { ok: boolean; refuser: Person | null } {
    for (const [child, suitor] of [[a, b], [b, a]] as const) {
      const head = this.host.headOf(child.household);
      if (!head || head === child || head === suitor) continue;
      if (this.d.consent.controlledHeadAuto && this.ctl(head)) continue;
      if (this.host.rng.next() >= this.consentChance(head, child, suitor, bonus)) return { ok: false, refuser: head };
    }
    return { ok: true, refuser: null };
  }

  // ---------------------------------------------------------------- 약혼

  private relFlag(a: Person, b: Person, add: string[], remove: string[]): void {
    const r = this.host.rel.ensure(a.id, b.id);
    r.met = true;
    for (const f of remove) r.flags.delete(f);
    for (const f of add) r.flags.add(f);
  }

  /**
   * 약혼 (연애혼·중매혼·NPC). 혼례 날 = 오늘 + betrothal. 조작 가문이면 잔치 예산 카드, 지참금이 모자라면 지참금 카드
   */
  betroth(a: Person, b: Person, path: Path, terms: { dowry?: number; residence?: Residence; surname?: 'groom' | 'bride'; fromCard?: boolean } = {}): Res {
    const can = this.canMarry(a, b);
    if (!can.ok) return can;
    const H = this.host;
    const day = H.day();
    const [groom, bride] = this.groomBride(a, b);
    const residence = terms.residence ?? this.d.residence.default;
    const std = this.standardDowry(groom, bride, residence);
    const bt: Betrothal = {
      id: this.state.nextId++,
      a: groom.id,
      b: bride.id,
      since: day,
      weddingDay: day + Math.max(1, this.days(this.d.rules.betrothal)),
      path,
      dowry: Math.max(0, Math.round(terms.dowry ?? std.amount)),
      residence,
      residenceSet: terms.residence !== undefined,
      surname: terms.surname ?? (residence === 'bride' ? 'bride' : 'groom'),
      feast: null,
      feastByCard: false,
      dowryCover: null,
      postponed: 0,
      hastyDone: !!terms.fromCard && path === 'love' && (!!this.mourningOf(a) || !!this.mourningOf(b)),
      nerves: false,
    };
    this.state.betrothals.push(bt);
    for (const [p, q] of [[groom, bride], [bride, groom]] as const) {
      p.betrothed = q.id;
      p.betrothedDay = day;
    }
    this.relFlag(groom, bride, ['engaged'], ['lover']);
    const r = H.rel.ensure(groom.id, bride.id);
    if (path === 'npc') {
      r.romance = Math.max(r.romance, this.d.npc.engagedRomance);
      r.friendship = Math.max(r.friendship, this.d.npc.engagedFriendship);
    }
    this.state.refusals = this.state.refusals.filter((x) => !this.pairIs(x, groom, bride));
    this.state.offers = this.state.offers.filter((o) => !(o.personId === groom.id || o.personId === bride.id || o.candidateId === groom.id || o.candidateId === bride.id) || o.status === 'agreed');
    for (const p of [groom, bride]) {
      H.moodlet(p, 'engaged');
      H.event?.(p, 'engaged');
    }
    if (path === 'arranged' && r.romance < this.d.negotiate.uneasyRomanceBelow) for (const p of [groom, bride]) H.moodlet(p, 'arranged_match_uneasy');
    H.news('engaged', { a: groom.name, b: bride.name }, [groom, bride]);
    this.state.stats.engagements++;
    if (path === 'arranged') this.state.stats.arranged++;
    this.markDecided(groom, bride);
    // 신분 사전 경고 (16-2: 농노 가정으로 들어가면 농노가 됨)
    const { stay, incoming } = this.roles(groom, bride, residence);
    const plan = H.planMarriage?.(stay, incoming, { uxorilocal: this.uxorilocal(bt) });
    for (const p of [groom, bride]) {
      if (!this.ctl(p)) continue;
      H.notice(p, 'betrothed', { a: groom.name, b: bride.name, day: bt.weddingDay });
      if (plan?.warning) H.notice(p, 'marriage_warning', { warn: plan.warning, a: incoming.name });
      if (plan && !plan.ok && plan.reason) H.notice(p, 'marriage_blocked_warning', { reason: plan.reason });
    }
    // 조작 가문: 잔치 예산 카드 (카드 조건 flags engaged), 지참금이 모자라면 지참금 카드
    const ctlSide = [groom, bride].find((p) => this.ctl(p));
    if (ctlSide) {
      const other = ctlSide === groom ? bride : groom;
      const head = H.headOf(ctlSide.household) ?? ctlSide;
      H.offerCard(head, 'wedding_feast_budget', { name: ctlSide.name }, other);
      const payer = this.payerOf(bt);
      if (payer && this.ctl(payer) && bt.dowry > 0 && H.money(payer.household) < bt.dowry) H.offerCard(H.headOf(payer.household) ?? payer, 'dowry_short', { name: payer.name, money: bt.dowry }, payer === groom ? bride : groom);
    }
    return yes;
  }

  private uxorilocal(b: Betrothal): boolean {
    return b.residence === 'bride' && b.surname === 'bride';
  }

  private payerOf(b: Betrothal): Person | undefined {
    const g = this.person(b.a);
    const w = this.person(b.b);
    if (!g || !w) return undefined;
    return this.roles(g, w, b.residence).incoming;
  }

  private pairIs(x: { a: number; b: number }, p: Person, q: Person): boolean {
    return (x.a === p.id && x.b === q.id) || (x.a === q.id && x.b === p.id);
  }

  /** 파혼 (헤어지기, 사망): 약혼 표시를 지움 */
  cancelBetrothal(b: Betrothal, reason: string): void {
    this.state.betrothals = this.state.betrothals.filter((x) => x !== b);
    const g = this.person(b.a);
    const w = this.person(b.b);
    for (const p of [g, w]) {
      if (!p) continue;
      p.betrothed = 0;
      p.betrothedDay = -1;
    }
    if (g && w) {
      this.relFlag(g, w, [], ['engaged']);
      if (reason === 'broken') {
        this.host.news('engagement_broken', { a: g.name, b: w.name }, [g, w]);
        this.host.onScandal?.(g, w);
      }
    }
  }

  // ---------------------------------------------------------------- 연애혼: 청혼 → 승낙 → 약혼

  /**
   * 청혼이 받아들여졌을 때 (social.propose 성공: social.json 이 engaged 표시를 이미 붙임).
   * 양가 가장 승낙 판정 → 약혼. 거절이면 연인으로 되돌리고 도피 카드
   */
  proposalAccepted(p: Person, t: Person): Res {
    const can = this.canMarry(p, t);
    if (!can.ok) {
      this.relFlag(p, t, ['lover'], ['engaged']);
      for (const x of [p, t]) if (this.ctl(x)) this.host.notice(x, 'proposal_blocked', { reason: can.reason ?? '' });
      return can;
    }
    const c = this.bothConsent(p, t);
    if (!c.ok) {
      this.relFlag(p, t, ['lover'], ['engaged']);
      this.state.refusals.push({ a: p.id, b: t.id, day: this.host.day() });
      this.state.stats.refusals++;
      for (const x of [p, t]) {
        this.host.moodlet(x, 'parents_refused_match');
        if (this.ctl(x)) this.host.notice(x, 'match_refused', { head: c.refuser?.name ?? '', a: p.name, b: t.name });
      }
      const ctlSide = [p, t].find((x) => this.ctl(x));
      if (ctlSide) this.host.offerCard(ctlSide, 'elopement_offer', { name: ctlSide.name }, ctlSide === p ? t : p);
      // 가장이 조작 가문 쪽에 거절 편지를 보냄
      if (c.refuser && ctlSide && c.refuser.household !== ctlSide.household) this.host.letter?.(c.refuser, ctlSide, 'match_refusal', ctlSide === p ? t : p);
      this.markDecided(p, t);
      return no('parents_refused');
    }
    return this.betroth(p, t, 'love');
  }

  /** 청혼 거절 (social.propose 실패) */
  private proposalRejected(p: Person, t: Person): void {
    this.host.moodlet(p, 'proposal_rejected');
    if (this.host.rng.next() < this.d.consent.jiltedRumorChance) this.host.rumor([p], 'jilted', this.d.consent.jiltedStrength, [p, t]);
    this.markDecided(p, t);
  }

  // ---------------------------------------------------------------- 사랑의 도피

  refusalBetween(a: Person, b: Person): boolean {
    return this.state.refusals.some((x) => this.pairIs(x, a, b));
  }

  /**
   * 사랑의 도피 (14-4): 가장이 거절한 연인 (또는 연인 사이)이 집을 나가 이웃 고을에서 혼인.
   * 명예 크게 하락, 교회 평판, 식구와 우정, 소문 elopement, 연대기. fromCard 면 카드가 이미 넣은 명성·소문·무드렛은 뺌
   */
  elope(a: Person, b: Person, opts: { fromCard?: boolean } = {}): Res {
    const r = this.host.rel.get(a.id, b.id);
    if (!this.refusalBetween(a, b) && !r?.flags.has('lover') && !r?.flags.has('engaged')) return no('not_lovers');
    const bt = this.betrothalOf(a);
    if (bt && this.pairIs(bt, a, b)) this.state.betrothals = this.state.betrothals.filter((x) => x !== bt);
    else if (bt || this.betrothalOf(b)) return no('betrothed');
    const can = this.canMarry(a, b);
    if (!can.ok) return can;
    const H = this.host;
    const E = this.d.elopement;
    const [groom, bride] = this.groomBride(a, b);
    const families = H.persons.filter((q) => (q.household === a.household || q.household === b.household) && q !== a && q !== b && !q.infant);
    const oldHh = [...new Set([a.household, b.household])];
    const brideFrom = bride.household;
    H.splitHousehold([groom, bride], 'elopement');
    this.state.stats.splits++;
    this.joinSpouses(groom, bride, 'eloped', { incoming: bride, fromHh: brideFrom }, false);
    for (const q of families) for (const x of [a, b]) H.rel.change(q.id, x.id, { friendship: E.familyFriendship }, H.day());
    if (!opts.fromCard) {
      for (const h of oldHh) H.fame(h, E.fame, 'elopement', h === oldHh[0] ? a : b);
      for (const x of [a, b]) {
        H.church(x, E.church);
        H.moodlet(x, 'eloped_thrill');
      }
      for (const q of families) H.moodlet(q, 'dishonored_shame');
      H.rumor([groom, bride], 'elopement', E.rumorStrength, [groom, bride]);
      H.chronicle('elopement', [groom, bride]);
    } else {
      // 카드는 고른 사람에게만 넣음: 상대에게도 설렘
      H.moodlet(a.id === groom.id ? bride : groom, 'eloped_thrill');
    }
    H.news('elopement', { a: groom.name, b: bride.name }, [groom, bride]);
    this.state.refusals = this.state.refusals.filter((x) => !this.pairIs(x, a, b));
    this.state.stats.elopements++;
    this.markDecided(a, b);
    return yes;
  }

  // ---------------------------------------------------------------- 중매혼: 혼처 찾기 → 후보 → 협상

  /** 후보 점수 (높을수록 좋은 혼처): 신분 가까움, 가문 명성, 지참금, 가문 관계, 나이 */
  private candidateScore(p: Person, c: Person): number {
    const M = this.d.match;
    const H = this.host;
    const ep = H.householdEstate(p.household);
    const ec = H.householdEstate(c.household);
    const up = this.rank(ec) - this.rank(ep);
    let s = M.estateWeight * (1 - 0.5 * Math.abs(up) + (up === 1 ? 0.5 : 0));
    s += M.fameWeight * ((H.fameOf(c.household) - 300) / 300);
    const [groom, bride] = this.groomBride(p, c);
    const dw = this.standardDowry(groom, bride, this.d.residence.default);
    const S = Math.max(1, H.savingsS(ep));
    s += M.dowryWeight * (dw.payerHh === c.household ? dw.amount / S : -dw.amount / S);
    s += M.clanWeight * (H.matchModifier?.(p.household, c.household) ?? 0);
    s -= M.ageWeight * Math.abs(H.age(p) - H.age(c));
    return s;
  }

  private offerFor(p: Person, c: Person, incoming: boolean, bonus = 0): MatchOffer {
    const [groom, bride] = this.groomBride(p, c);
    const dw = this.standardDowry(groom, bride, this.d.residence.default);
    const day = this.host.day();
    const ex = this.state.offers.find((o) => o.personId === p.id && o.candidateId === c.id && o.status === 'open');
    if (ex) {
      ex.expires = day + Math.max(1, this.days(this.d.match.offerDays));
      ex.bonus = Math.max(ex.bonus, bonus);
      return ex;
    }
    const o: MatchOffer = { id: this.state.nextId++, hh: p.household, personId: p.id, candidateId: c.id, day, expires: day + Math.max(1, this.days(this.d.match.offerDays)), dowry: dw.amount, status: 'open', incoming, lastTry: -1, bonus };
    this.state.offers.push(o);
    return o;
  }

  private candidateView(o: MatchOffer): MatchCandidate | null {
    const p = this.person(o.personId);
    const c = this.person(o.candidateId);
    if (!p || !c) return null;
    const H = this.host;
    const [groom, bride] = this.groomBride(p, c);
    const dw = this.standardDowry(groom, bride, this.d.residence.default);
    // 특성 일부: 사람마다 고정 (id 로 순서를 섞음, 무작위 아님)
    const shown = [...c.traits].sort((x, y) => ((x.length * 31 + c.id) % 7) - ((y.length * 31 + c.id) % 7) || x.localeCompare(y)).slice(0, this.d.match.traitsShown);
    return {
      matchId: o.id,
      personId: c.id,
      name: c.name,
      sex: c.sex,
      estate: H.householdEstate(c.household),
      age: Math.floor(H.age(c)),
      household: c.household,
      dowry: o.dowry,
      wePay: dw.payerHh === p.household,
      fame: H.fameOf(c.household),
      traits: shown,
      clan: H.matchModifier?.(p.household, c.household) ?? 0,
      score: Math.round(this.candidateScore(p, c) * 100) / 100,
    };
  }

  /**
   * 혼처 찾기 (의도 findMatch): 가장이 식구 personId 의 후보 목록을 받음 (중매인 NPC·편지·카드).
   * 혼사 방해 중이면 목록이 빔. onlyHousehold 면 그 가정의 사람만 (혼처 의논·중매 편지)
   */
  findMatch(hh: number, personId: number, opts: { good?: boolean; onlyHousehold?: number; bonus?: number } = {}): Res & { candidates: MatchCandidate[] } {
    const p = this.person(personId);
    if (!p || p.household !== hh) return { ...no('not_member'), candidates: [] };
    if (!this.single(p)) return { ...(p.spouse ? no('married') : this.betrothalOf(p) ? no('betrothed') : this.eligible(p)), candidates: [] };
    if (this.host.matchBlocked?.(hh)) return { ...no('match_blocked'), candidates: [] };
    const M = this.d.match;
    const n = M.candidates + (this.host.matchQuality?.(hh) ? M.qualityExtra : 0) + (opts.good ? M.goodExtra : 0);
    const pool = this.host.persons.filter(
      (c) =>
        c.household !== hh &&
        (opts.onlyHousehold === undefined || c.household === opts.onlyHousehold) &&
        this.single(c) &&
        this.canMarry(p, c).ok &&
        Math.abs(this.host.age(p) - this.host.age(c)) <= this.d.rules.ageGapYears &&
        !this.host.matchBlocked?.(c.household),
    );
    const scored = pool.map((c) => ({ c, s: this.candidateScore(p, c) })).sort((x, y) => y.s - x.s || x.c.id - y.c.id);
    const out: MatchCandidate[] = [];
    for (const { c } of scored.slice(0, n)) {
      const v = this.candidateView(this.offerFor(p, c, false, opts.bonus ?? 0));
      if (v) out.push(v);
    }
    this.markDecided(p);
    if (this.ctl(p)) this.host.notice(p, out.length ? 'match_candidates' : 'match_none', { a: p.name, n: out.length });
    return { ok: true, candidates: out };
  }

  /** 열린 혼담 (UI: 후보 목록, 들어온 혼담) */
  offers(hh: number): MatchCandidate[] {
    const out: MatchCandidate[] = [];
    for (const o of this.state.offers) if (o.hh === hh && o.status === 'open') {
      const v = this.candidateView(o);
      if (v) out.push(v);
    }
    return out;
  }

  incomingOffers(hh: number): MatchOffer[] {
    return this.state.offers.filter((o) => o.hh === hh && o.status === 'open' && o.incoming);
  }

  /** 상대 가장이 이 조건을 받아들일 확률 */
  negotiateChance(o: MatchOffer, terms: { dowry?: number; residence?: Residence; surname?: 'groom' | 'bride' }): number {
    const p = this.person(o.personId)!;
    const c = this.person(o.candidateId)!;
    const N = this.d.negotiate;
    const H = this.host;
    const head = H.headOf(c.household);
    let chance = (head && head !== p ? this.consentChance(head, c, p) : this.d.consent.base) + N.base + o.bonus;
    const [groom, bride] = this.groomBride(p, c);
    const residence = terms.residence ?? this.d.residence.default;
    const dw = this.standardDowry(groom, bride, residence);
    const ratio = Math.min(N.dowryRatioMax, (terms.dowry ?? dw.amount) / Math.max(1, dw.amount));
    chance += (dw.payerHh === p.household ? 1 : -1) * (ratio - 1) * N.dowryRatioWeight;
    if (residence === 'bride') {
      // 데릴사위: 신부 가정에 아들이 없으면 반김, 신랑 가정은 싫어함
      const brideHasSon = H.persons.some((q) => q.household === bride.household && q.sex === 'male' && q !== bride && (q.mother === H.headOf(bride.household)?.id || q.father === H.headOf(bride.household)?.id));
      const theirs = c === bride;
      chance += theirs ? (brideHasSon ? 0 : N.uxorilocalNoSon) : N.uxorilocal;
    }
    if (residence === 'new') chance += N.newHouse;
    if ((terms.surname ?? (residence === 'bride' ? 'bride' : 'groom')) === 'bride' && c === groom) chance += N.surnameChange;
    return Math.max(this.d.consent.min, Math.min(this.d.consent.max, chance));
  }

  /** 협상 (의도 negotiate): 지참금, 거주지, 성씨. 상대 가장이 받아들이면 약혼 */
  negotiate(matchId: number, terms: { dowry?: number; residence?: Residence; surname?: 'groom' | 'bride' } = {}): Res & { chance?: number } {
    const o = this.state.offers.find((x) => x.id === matchId);
    if (!o || o.status !== 'open') return no('no_offer');
    const p = this.person(o.personId);
    const c = this.person(o.candidateId);
    if (!p || !c) return no('no_offer');
    const can = this.canMarry(p, c);
    if (!can.ok) return can;
    const day = this.host.day();
    if (o.lastTry >= 0 && day - o.lastTry < Math.max(1, this.days(this.d.negotiate.retry))) return no('wait');
    o.lastTry = day;
    const chance = o.incoming ? 1 : this.negotiateChance(o, terms);
    if (this.host.rng.next() >= chance) {
      if (this.ctl(p)) this.host.notice(p, 'match_negotiation_failed', { a: c.name });
      this.markDecided(p);
      return { ...no('refused'), chance };
    }
    o.status = 'agreed';
    const res = this.betroth(p, c, 'arranged', { dowry: terms.dowry ?? o.dowry, residence: terms.residence, surname: terms.surname });
    return { ...res, chance };
  }

  /** 들어온 혼담 수락 (의도 acceptProposal) */
  acceptProposal(matchId: number): Res {
    const o = this.state.offers.find((x) => x.id === matchId);
    if (!o || o.status !== 'open' || !o.incoming) return no('no_offer');
    return this.negotiate(matchId);
  }

  /** 혼담 거절 (의도 refuse): 상대 가정 서운함, 당사자 무드렛, 소문 jilted (약하게) */
  refuse(matchId: number): Res {
    const o = this.state.offers.find((x) => x.id === matchId);
    if (!o || o.status !== 'open') return no('no_offer');
    o.status = 'refused';
    const p = this.person(o.personId);
    const c = this.person(o.candidateId);
    if (p && c) {
      const hc = this.host.headOf(c.household);
      const hp = this.host.headOf(p.household);
      if (hc && hp) this.host.rel.change(hp.id, hc.id, { friendship: -5 }, this.host.day());
      if (o.incoming) {
        this.host.moodlet(c, 'proposal_rejected');
        this.host.rumor([c], 'jilted', this.d.consent.jiltedStrength, [c, p]);
      }
      this.markDecided(p);
    }
    return yes;
  }

  /** 중매 편지 (letters.ts → host.onMatchLetter): 쓴 사람 가정의 당사자와 받는 사람 가정의 독신 사이 혼담 */
  matchByLetter(writer: Person, reader: Person, subjectId: number): Res & { n: number } {
    const subject = this.person(subjectId) ?? writer;
    if (subject.household !== writer.household || !this.single(subject)) return { ...no('no_subject'), n: 0 };
    if (this.ctl(reader) && !this.ctl(writer)) {
      // NPC 가정이 조작 가문에 청혼 편지: 들어온 혼담
      let n = 0;
      for (const c of this.host.persons) {
        if (c.household !== reader.household || !this.single(c) || !this.canMarry(subject, c).ok) continue;
        const o = this.offerFor(c, subject, true);
        o.incoming = true;
        n++;
        this.host.notice(c, 'match_proposed', { a: subject.name, b: c.name });
      }
      return { ok: n > 0, n };
    }
    const r = this.findMatch(writer.household, subject.id, { onlyHousehold: reader.household, bonus: this.d.negotiate.discussBonus });
    return { ok: r.candidates.length > 0, reason: r.reason, n: r.candidates.length };
  }

  // ---------------------------------------------------------------- 혼례 날

  /** 혼례 날 잡기 (의도 setWeddingDay): 내일부터 weddingDayMax 안 */
  setWeddingDay(personId: number, day: number): Res {
    const p = this.person(personId);
    const b = p && this.betrothalOf(p);
    if (!p || !b) return no('not_betrothed');
    const today = this.host.day();
    if (day < today || day > b.since + Math.max(1, this.days(this.d.rules.weddingDayMax))) return no('day_range');
    b.weddingDay = day;
    b.nerves = false;
    for (const id of [b.a, b.b]) {
      const q = this.person(id);
      if (q && this.ctl(q)) this.host.notice(q, 'wedding_day_set', { day });
    }
    return yes;
  }

  // ---------------------------------------------------------------- 혼례 (예식 → 잔치)

  private joinSpouses(groom: Person, bride: Person, path: Path, move: { incoming: Person; fromHh: number }, hastyDone: boolean): void {
    const H = this.host;
    const day = H.day();
    const W = this.d.wedding;
    this.relFlag(groom, bride, ['spouse'], ['engaged', 'lover', 'ex_spouse']);
    const r = H.rel.ensure(groom.id, bride.id);
    if (path === 'npc') {
      r.friendship = Math.max(r.friendship, W.spouseFriendship);
      r.romance = Math.max(r.romance, W.spouseRomance);
    }
    for (const [p, q] of [[groom, bride], [bride, groom]] as const) {
      p.spouse = q.id;
      p.betrothed = 0;
      p.betrothedDay = -1;
      if (p.marriedDay < 0) p.marriedDay = day;
      H.moodlet(p, 'wedding_day');
      H.event?.(p, 'wedding');
      H.memory(p, 'wedding', 5, 1, q.id);
    }
    // 애도 기간 안의 재혼 (14-4): 소문
    for (const p of [groom, bride]) {
      const m = this.mourningOf(p);
      if (!m) continue;
      if (!hastyDone) {
        H.rumor([p], 'hasty_remarriage', this.d.widow.rumorStrength, [groom, bride]);
        H.moodlet(p, 'remarried_gossip');
        H.church(p, this.d.widow.church);
      }
      this.state.stats.hasty++;
      this.state.mourning = this.state.mourning.filter((x) => x !== m);
    }
    // 유령 질투 (20-6, M11): 죽은 배우자가 유령이면 훅만
    for (const [p, q] of [[groom, bride], [bride, groom]] as const) for (const g of this.state.formerSpouses[p.id] ?? []) if (H.isGhost?.(g)) H.ghostJealousy?.(g, p, q);
    H.onMarriage?.(groom, bride);
    this.state.weddings.push({ a: groom.id, b: bride.id, day, incoming: move.incoming.id, fromHh: move.fromHh, path });
    if (this.state.weddings.length > 400) this.state.weddings.shift();
    this.state.stats.marriages++;
    if (path === 'love' || path === 'eloped') this.state.stats.loveMatches++;
  }

  /**
   * 혼례: 신분(estates.marry) → 지참금 → 잔치(하객·명성·좋은 소문) → 거주(이사/분가/데릴사위) → 부부.
   * 사제가 없으면 미룸 (priestPostponeMax 번까지). 신분 규칙이 막으면 파혼
   */
  wed(b: Betrothal): Res {
    const H = this.host;
    const groom = this.person(b.a);
    const bride = this.person(b.b);
    if (!groom || !bride) {
      this.cancelBetrothal(b, 'gone');
      return no('gone');
    }
    if (H.priestAvailable && !H.priestAvailable() && b.postponed < this.d.rules.priestPostponeMax) {
      b.postponed++;
      b.weddingDay = H.day() + 1;
      for (const p of [groom, bride]) if (this.ctl(p)) H.notice(p, 'wedding_postponed', { day: b.weddingDay });
      return no('no_priest');
    }
    // 거주지: 기본 신부 → 신랑 집. 조작 가문 식구가 들어가게 되면(협상으로 정하지 않았으면) 조작 가문 집으로
    let residence = b.residence;
    let { stay, incoming } = this.roles(groom, bride, residence);
    if (!b.residenceSet && this.d.residence.controlledStays && this.ctl(incoming) && !this.ctl(stay)) {
      residence = residence === 'bride' ? 'groom' : 'bride';
      ({ stay, incoming } = this.roles(groom, bride, residence));
    }
    const ux = residence === 'bride' && b.surname === 'bride';
    const fromHh = incoming.household;
    // 들어가는 가정이 인원 상한이면 분가 (15-8)
    const size = H.persons.filter((q) => q.household === stay.household).length;
    const split = residence === 'new' || size + 1 > H.householdCap(stay.household);
    // 신분 (16-2)
    if (H.estatesMarry) {
      const plan = H.estatesMarry(stay, incoming, { uxorilocal: ux });
      if (!plan.ok) {
        for (const p of [groom, bride]) if (this.ctl(p)) H.notice(p, 'wedding_blocked', { reason: plan.reason ?? '' });
        this.cancelBetrothal(b, 'blocked');
        return { ok: false, reason: plan.reason ?? 'reason.court.blocked' };
      }
    } else if (ux) H.changeSurname?.(incoming, stay.household);
    // 잔치 (가정 돈을 쓰는 곳 = 받는 가정)
    const feastHh = stay.household;
    const S = Math.max(1, H.savingsS(H.householdEstate(feastHh)));
    let tier: FeastTier = b.feast ?? 'modest';
    const W = this.d.wedding;
    if (!b.feast) {
      const m = H.money(feastHh);
      tier = this.ctl(stay) ? (m >= W.tiers.modest.moneyS * S ? 'modest' : 'church') : m >= W.npcGrandMoneyS * S ? 'grand' : m >= W.npcModestMoneyS * S ? 'modest' : 'church';
    }
    const T = this.d.wedding.tiers[tier];
    if (!b.feastByCard && T.moneyS > 0 && !H.spend(feastHh, Math.round(T.moneyS * S), 'wedding_feast')) tier = 'church';
    // 지참금
    const receiverHh = split ? -1 : stay.household;
    const dowryPaid = this.settleDowry(b, incoming, fromHh, receiverHh, stay);
    // 거주 (이사 / 분가)
    let hh = stay.household;
    if (split) {
      hh = H.splitHousehold([groom, bride], residence === 'new' ? 'new_house' : 'marriage_cap');
      this.state.stats.splits++;
      if (dowryPaid > 0) H.addMoney(hh, dowryPaid, 'dowry');
      for (const p of [groom, bride]) if (this.ctl(p)) H.notice(p, residence === 'new' ? 'new_house' : 'split_after_wedding', { a: groom.name, b: bride.name });
      H.news('newlyweds_new_house', { a: groom.name, b: bride.name }, [groom, bride]);
    } else H.moveTo(incoming, hh);
    if (ux && this.ctl(incoming)) H.notice(incoming, 'surname_changed', { a: incoming.name });
    this.state.betrothals = this.state.betrothals.filter((x) => x !== b);
    this.joinSpouses(groom, bride, b.path, { incoming, fromHh }, b.hastyDone);
    // 하객과 잔치 점수 → 가문 명성, 좋은 소문
    const guests = this.guests(groom, bride);
    for (const g of guests) H.moodlet(g, 'wedding_guest_merry');
    const fame = Math.round(W.fameBase + guests.length * W.famePerGuest + (b.feastByCard ? 0 : this.d.wedding.tiers[tier].fame));
    if (fame) H.fame(hh, fame, 'wedding', stay);
    if (fame && fromHh !== hh && !split) H.fame(fromHh, Math.round(fame / 2), 'wedding', incoming);
    const score = guests.length * this.d.wedding.tiers[tier].score;
    if (score >= W.generousScore) H.rumor([groom, bride], 'generous_feast', W.generousStrength, [groom, bride, ...guests]);
    const romance = H.rel.romance(groom.id, bride.id);
    if ((b.path === 'love' || b.path === 'npc') && romance >= W.loveMatchRomance) H.rumor([groom, bride], 'love_match', W.loveMatchStrength, [groom, bride]);
    const remarried = (this.state.formerSpouses[groom.id]?.length ?? 0) + (this.state.formerSpouses[bride.id]?.length ?? 0) > 0;
    H.news(remarried ? 'remarried' : 'married', { a: groom.name, b: bride.name }, [groom, bride]);
    H.chronicle('wedding', [groom, bride], { guests: guests.length, tier });
    for (const p of [groom, bride]) if (this.ctl(p)) H.notice(p, 'wedding_done', { a: groom.name, b: bride.name, n: guests.length });
    this.markDecided(groom, bride);
    return yes;
  }

  /** 하객: 두 가정 식구 + 두 사람과 우정 guestFriendship 이상 (많은 순, maxGuests) */
  guests(a: Person, b: Person): Person[] {
    const W = this.d.wedding;
    const H = this.host;
    const list: { q: Person; f: number }[] = [];
    for (const q of H.persons) {
      if (q === a || q === b || q.infant || q.status === 'ghost') continue;
      const f = Math.max(H.rel.friendship(q.id, a.id), H.rel.friendship(q.id, b.id));
      const family = q.household === a.household || q.household === b.household;
      if (family || f >= W.guestFriendship) list.push({ q, f: family ? 200 + f : f });
    }
    return list.sort((x, y) => y.f - x.f || x.q.id - y.q.id).slice(0, W.maxGuests).map((x) => x.q);
  }

  /**
   * 지참금 (14-4): 들어가는 사람 가정(fromHh)이 받는 가정에 냄 (분가면 새 가정으로: 반환값을 리드가 넣음 → 여기서 넣음).
   * 모자라면 가보 → 땅 → 빚 (카드 선택이 있으면 그대로), 못 채우면 명성 하락 + 두 가장 우정 하락. 실제로 넘어간 돈(파딩)
   */
  settleDowry(b: Betrothal, payerP: Person, fromHh: number, receiverHh: number, receiverP: Person | null): number {
    const H = this.host;
    const D = this.d.dowry;
    const amount = b.dowry;
    if (amount <= 0) return 0;
    const head = H.headOf(fromHh) ?? payerP;
    const pay = Math.min(amount, Math.max(0, H.money(fromHh)));
    let moved = 0;
    if (pay > 0 && H.spend(fromHh, pay, 'dowry')) moved = pay;
    let short = amount - moved;
    const cover = b.dowryCover ?? (this.host.controlled(fromHh) ? 'debt' : 'heirloom');
    if (short > 0 && cover === 'heirloom_card') short = 0;
    if (short > 0 && cover === 'heirloom' && H.heirloomDowry) {
      const v = H.heirloomDowry(fromHh, receiverHh >= 0 ? receiverHh : receiverP?.household ?? fromHh, head);
      if (v > 0) {
        short = Math.max(0, short - v);
        if (H.controlled(fromHh)) H.notice(head, 'dowry_heirloom', { a: payerP.name });
      }
    }
    if (short > 0 && (cover === 'land' || cover === 'heirloom') && H.landDowry) {
      const v = H.landDowry(fromHh, receiverHh >= 0 ? receiverHh : receiverP?.household ?? fromHh, short);
      short = Math.max(0, short - v);
    }
    if (short > 0 && cover !== 'waive' && H.borrow?.(fromHh, short, 'dowry')) {
      if (H.spend(fromHh, short, 'dowry')) {
        moved += short;
        short = 0;
        this.state.stats.dowryDebt++;
        if (H.controlled(fromHh)) H.notice(head, 'dowry_debt', { a: payerP.name });
      }
    }
    if (moved > 0 && receiverHh >= 0) H.addMoney(receiverHh, moved, 'dowry');
    if (short > 0) {
      // 못 채움: 받는 가정이 서운해 하고 가문 명성이 깎임
      H.fame(fromHh, D.shortFame, 'dowry_short', head);
      H.moodlet(head, 'dowry_burden');
      const rh = receiverP ? H.headOf(receiverP.household) ?? receiverP : null;
      if (rh && rh !== head) H.rel.change(head.id, rh.id, { friendship: D.shortFriendship }, H.day());
      if (H.controlled(fromHh)) H.notice(head, 'dowry_short', { money: short });
    } else {
      H.moodlet(head, 'dowry_settled');
      if (H.controlled(fromHh)) H.notice(head, 'dowry_paid', { money: amount });
    }
    return moved;
  }

  // ---------------------------------------------------------------- 생애 판정기용 (18-3)

  /**
   * NPC 짝 점수 (0 = 혼인 불가). 기존 판정기 식과 같은 크기의 배수: 1 = 같은 신분 초면.
   * 신분 두 단계 차 × 0.45, 가문 관계 (1 + matchModifier), 혼사 방해 × 0.3, 우정 보너스, + 로맨스.
   * 판정기는 pr = baseDaily × 인구 피드백 × 이 점수 로 쓰면 됨 (신분·우정·로맨스 식을 대신함)
   */
  npcMatchScore(a: Person, b: Person): number {
    if (a.household === b.household) return 0;
    if (!this.canMarry(a, b).ok) return 0;
    if (Math.abs(this.host.age(a) - this.host.age(b)) > this.d.rules.ageGapYears) return 0;
    const N = this.d.npc;
    const H = this.host;
    const gap = Math.abs(this.rank(a.estate) - this.rank(b.estate));
    let s = gap >= N.estateGapFrom ? N.estateGapMult : 1;
    s *= Math.max(0.05, 1 + (H.matchModifier?.(a.household, b.household) ?? 0));
    if (H.matchBlocked?.(a.household) || H.matchBlocked?.(b.household)) s *= N.blockedMult;
    s *= 1 + Math.max(N.friendshipFloor, H.rel.friendship(a.id, b.id) * N.friendshipBonus);
    s += (H.rel.romance(a.id, b.id) * N.romanceBonus) / N.baseDaily;
    return Math.max(0, s);
  }

  /**
   * 판정기가 고른 NPC 쌍의 약혼을 이 규칙으로 (지참금 기준, 거주지, 신분 사전 경고). 혼례는 daily 가 혼례 날에 처리.
   * 판정기는 managed(p) 인 사람의 약혼·혼례를 직접 처리하지 않음
   */
  arrangeNpcWedding(a: Person, b: Person): Res {
    if (this.decidedToday(a) || this.decidedToday(b)) return no('decided_today');
    return this.betroth(a, b, 'npc');
  }

  /** 이 사람의 약혼·혼례는 이 모듈이 맡음 */
  managed(p: Person): boolean {
    return !!this.betrothalOf(p);
  }

  // ---------------------------------------------------------------- 불륜 (14-4)

  private married(p: Person): Person | undefined {
    return p.spouse ? this.person(p.spouse) : undefined;
  }

  /** 불륜 시작: 한쪽 이상이 다른 사람과 혼인한 상태에서 연인 */
  startAffair(a: Person, b: Person): Res {
    if (a === b) return no('self');
    const sa = this.married(a);
    const sb = this.married(b);
    if ((!sa || sa === b) && (!sb || sb === a)) return no('not_married');
    if (this.affairOf(a, b)) return yes;
    this.state.affairs.push({ a: a.id, b: b.id, since: this.host.day(), exposed: false });
    this.relFlag(a, b, ['lover'], []);
    for (const p of [a, b]) {
      this.host.moodlet(p, 'affair_thrill');
      if (this.married(p) && !p.traits.some((t) => this.d.affair.guiltSkipTraits.includes(t))) this.host.moodlet(p, 'affair_guilt');
    }
    this.state.stats.affairs++;
    this.markDecided(a, b);
    return yes;
  }

  endAffair(a: Person, b: Person): void {
    this.state.affairs = this.state.affairs.filter((f) => !this.pairIs(f, a, b));
    this.relFlag(a, b, [], ['lover']);
  }

  /** 배신 기억 (우정 −60, 로맨스 −50) */
  private betray(spouse: Person, cheater: Person, factor = 1): void {
    const A = this.d.affair;
    this.host.rel.change(spouse.id, cheater.id, { friendship: Math.round(A.betrayFriendship * factor), romance: Math.round(A.betrayRomance * factor) }, this.host.day());
    this.host.memory(spouse, 'betrayed_by_spouse', 5, -1, cheater.id);
    this.host.moodlet(spouse, 'betrayed_by_spouse');
  }

  /**
   * 발각 (목격 또는 소문): 배우자 배신 기억, 가문 명예·교회 평판 하락, 소문 affair, 연대기.
   * 조작 가문의 기혼자는 affair_discovered 카드로 (카드가 결과를 넣음)
   */
  expose(f: Affair, witness: Person | null = null): void {
    if (f.exposed) return;
    const a = this.person(f.a);
    const b = this.person(f.b);
    if (!a || !b) return;
    f.exposed = true;
    this.state.stats.exposed++;
    const H = this.host;
    const A = this.d.affair;
    for (const [cheater, lover] of [[a, b], [b, a]] as const) {
      const spouse = this.married(cheater);
      if (!spouse || spouse === lover) continue;
      if (this.ctl(cheater)) {
        H.offerCard(cheater, 'affair_discovered', { name: cheater.name }, lover);
        continue;
      }
      this.betray(spouse, cheater);
      H.fame(cheater.household, A.fame, 'affair', cheater);
      H.church(cheater, A.church);
      H.moodlet(cheater, 'affair_exposed_shame');
      H.rumor([cheater], 'affair', A.rumorStrength, [cheater, lover, spouse, ...(witness ? [witness] : [])]);
      H.news('affair_exposed', { a: cheater.name, b: lover.name }, [cheater]);
      H.chronicle('affair_exposed', [cheater, lover]);
      H.onScandal?.(cheater, lover);
      if (this.ctl(spouse)) H.notice(spouse, 'affair_exposed', { a: cheater.name, b: lover.name });
    }
  }

  /** 누군가 불륜 현장을 봄 (리드가 장면 판정으로 부를 수 있음) */
  witnessed(a: Person, b: Person, witness: Person): void {
    const f = this.affairOf(a, b);
    if (f) this.expose(f, witness);
  }

  /** 소문을 전해 들음 (rumors onAware/onHear): 불륜 소문을 배우자가 들으면 배신 */
  onRumorHeard(kind: string, subjectIds: readonly number[], listener: Person): void {
    if (kind !== 'affair' && kind !== 'secret_lover') return;
    for (const id of subjectIds) {
      const s = this.person(id);
      if (!s || s.spouse !== listener.id) continue;
      const f = this.state.affairs.find((x) => x.a === s.id || x.b === s.id);
      if (f && !f.exposed) this.expose(f, null);
    }
  }

  /** 스스로 배우자에게 고백: 배신은 confessFactor 배, 소문 없음. 거절되면(실패) 온전한 배신 */
  private confessAffair(p: Person, spouse: Person, ok: boolean): void {
    const f = this.state.affairs.find((x) => (x.a === p.id || x.b === p.id) && !x.exposed);
    if (!f) return;
    f.exposed = true;
    this.betray(spouse, p, ok ? this.d.affair.confessFactor : 1);
  }

  // ---------------------------------------------------------------- 사생아 (14-4, 16장)

  /** 사생아 판정: 어머니가 혼인하지 않았거나 배우자가 아버지가 아님, 성직자의 자녀 */
  isBastard(baby: Person, mother: Person, father: Person | null): boolean {
    void baby;
    if (mother.estate === 'clergy' || father?.estate === 'clergy') return true;
    if (mother.spouse) return !father || mother.spouse !== father.id;
    if (father && this.d.bastard.betrothedLegit && (mother.betrothed === father.id || this.betrothalOf(mother)?.a === father.id)) return false;
    return true;
  }

  /**
   * 출생 때 리드가 부름 → {bastard} 를 clans.onBirth(baby, bastard) / estates.born(baby, mother, father, {illegitimate}) 에.
   * 불륜의 아이면 소문 bastard, 어머니 무드렛
   */
  onBirth(baby: Person, mother: Person, father: Person | null): { bastard: boolean } {
    const bastard = this.isBastard(baby, mother, father);
    if (!bastard) return { bastard };
    this.state.stats.bastards++;
    this.host.moodlet(mother, 'bastard_whispers');
    const subjects = [mother, ...(father && father.household !== mother.household ? [father] : [])];
    this.host.rumor(subjects, 'bastard', this.d.bastard.rumorStrength, [mother, ...(father ? [father] : [])]);
    // 남편이 아닌 사람의 아이: 남편이 알게 되면 배신
    const husband = this.married(mother);
    if (husband && father && husband !== father) {
      const f = this.affairOf(mother, father);
      if (f && !f.exposed) this.expose(f, null);
    }
    return { bastard };
  }

  // ---------------------------------------------------------------- 혼인 무효 / 별거 (14-4)

  /** 이 사람이 댈 수 있는 무효 사유 */
  annulReasons(p: Person): AnnulReason[] {
    const s = this.married(p);
    if (!s) return [];
    const R = this.d.annulment.reasons;
    const L = this.host.lifespan();
    const day = this.host.day();
    const out: AnnulReason[] = [];
    if (this.kin(p, s, R.consanguinity.kinDegreeMax) <= R.consanguinity.kinDegreeMax) out.push('consanguinity');
    const since = Math.max(p.marriedDay, s.marriedDay);
    const common = this.host.persons.some((c) => (c.mother === p.id && c.father === s.id) || (c.mother === s.id && c.father === p.id));
    if (since >= 0 && day - since >= durDays(R.childless.marriedDays, L) && !common) out.push('childless');
    const w = [...this.state.weddings].reverse().find((x) => this.pairIs(x, p, s));
    if (w && w.path === 'arranged' && day - w.day <= durDays(R.coerced.within, L) && this.host.rel.romance(p.id, s.id) < R.coerced.romanceBelow) out.push('coerced');
    const sep = this.separationOf(p);
    if (sep && day - sep.since >= durDays(R.abandonment.separated, L)) out.push('abandonment');
    return out;
  }

  annulmentFee(p: Person): number {
    return Math.round(this.d.annulment.feeS * this.host.savingsS(this.host.householdEstate(p.household)));
  }

  /** 청원할 수 있는가 (돈, 교회 평판, 사유) */
  canAnnul(p: Person, reason?: AnnulReason): Res {
    if (!this.married(p)) return no('not_married');
    const reasons = this.annulReasons(p);
    if (!reasons.length || (reason && !reasons.includes(reason))) return no('no_reason');
    if (p.churchRep < this.d.annulment.churchMin) return no('church_low');
    if (this.host.money(p.household) < this.annulmentFee(p)) return no('money');
    return yes;
  }

  /** 혼인 무효 청원 (의도 petitionAnnulment): 돈 + 교회 평판 + 사유. 판정 성공이면 혼인 해소, 들어온 사람이 나감 */
  petitionAnnulment(personId: number, reason: string): Res {
    const p = this.person(personId);
    if (!p) return no('gone');
    if (!ANNUL_REASONS.includes(reason as AnnulReason)) return no('no_reason');
    const c = this.canAnnul(p, reason as AnnulReason);
    if (!c.ok) return c;
    const H = this.host;
    const A = this.d.annulment;
    const s = this.married(p)!;
    H.spend(p.household, this.annulmentFee(p), 'annulment');
    const chance = Math.max(0.05, Math.min(0.95, A.chanceBase + (p.churchRep - A.churchMin) * A.churchPer));
    this.markDecided(p);
    if (H.rng.next() >= chance) {
      H.church(p, A.failChurch);
      if (this.ctl(p)) H.notice(p, 'annulment_denied', { reason: `court.annul.${reason}` });
      return no('annulment_denied');
    }
    this.dissolve(p, s);
    H.moodlet(p, 'annulment_relief');
    H.rumor([p, s], 'annulment', A.rumorStrength, [p, s]);
    H.news('annulment', { a: p.name, b: s.name }, [p, s]);
    H.chronicle('annulment', [p, s], { reason });
    if (this.ctl(p) || this.ctl(s)) H.notice(this.ctl(p) ? p : s, 'annulment_granted', { a: p.name, b: s.name });
    this.state.stats.annulments++;
    return yes;
  }

  /** 혼인 해소: 전 배우자, 들어온 사람은 원래 가정(없으면 분가)으로 */
  private dissolve(p: Person, s: Person): void {
    const H = this.host;
    p.spouse = 0;
    s.spouse = 0;
    this.relFlag(p, s, ['ex_spouse'], ['spouse']);
    (this.state.formerSpouses[p.id] ??= []).push(s.id);
    (this.state.formerSpouses[s.id] ??= []).push(p.id);
    const sep = this.separationOf(p);
    this.state.separations = this.state.separations.filter((x) => x !== sep);
    if (sep || p.household !== s.household) return;
    const w = [...this.state.weddings].reverse().find((x) => this.pairIs(x, p, s));
    const leaver = w ? (w.incoming === p.id ? p : s) : s;
    const back = w && H.persons.some((q) => q.household === w.fromHh && q !== p && q !== s) ? w.fromHh : -1;
    if (back >= 0) H.moveTo(leaver, back);
    else H.splitHousehold([leaver], 'annulment');
  }

  /** 별거 (의도 separate): 이 사람이 집을 나감 (혼인은 그대로) */
  separate(personId: number): Res {
    const p = this.person(personId);
    if (!p) return no('gone');
    const s = this.married(p);
    if (!s) return no('not_married');
    if (this.separationOf(p)) return no('already_separated');
    const H = this.host;
    const S = this.d.separation;
    if (p.household === s.household) H.splitHousehold([p], 'separation');
    this.state.separations.push({ a: p.id, b: s.id, leaver: p.id, since: H.day() });
    H.rel.change(p.id, s.id, { friendship: S.friendship }, H.day());
    for (const x of [p, s]) H.moodlet(x, 'separated_lonely');
    H.rumor([p, s], 'separation', S.rumorStrength, [p, s]);
    H.news('separated', { a: p.name, b: s.name }, [p, s]);
    H.chronicle('separation', [p, s]);
    this.state.stats.separations++;
    this.markDecided(p, s);
    return yes;
  }

  /** 별거한 부부의 화해: 나간 사람이 돌아옴 */
  reconcile(a: Person, b: Person): Res {
    const sep = this.state.separations.find((x) => this.pairIs(x, a, b));
    if (!sep) return no('not_separated');
    const leaver = sep.leaver === a.id ? a : b;
    const stay = leaver === a ? b : a;
    this.state.separations = this.state.separations.filter((x) => x !== sep);
    this.host.moveTo(leaver, stay.household);
    this.host.rel.change(a.id, b.id, { friendship: this.d.separation.reconcileFriendship }, this.host.day());
    this.host.news('reconciled', { a: a.name, b: b.name }, [a, b]);
    return yes;
  }

  // ---------------------------------------------------------------- 사별 (14-4, 20-6)

  /**
   * 사망 때 리드가 부름 (배우자 표시를 지우기 전): 남은 배우자 애도(7일, lifespan), 약혼·불륜·혼담 정리
   */
  onDeath(p: Person): void {
    const H = this.host;
    const day = H.day();
    const s = this.married(p);
    if (s) {
      s.spouse = 0;
      this.relFlag(p, s, ['ex_spouse'], ['spouse']);
      (this.state.formerSpouses[s.id] ??= []).push(p.id);
      this.state.mourning = this.state.mourning.filter((m) => m.personId !== s.id);
      this.state.mourning.push({ personId: s.id, spouseId: p.id, since: day, until: day + Math.max(1, Math.round(durDays(this.d.rules.mourning, H.lifespan()))) });
      H.moodlet(s, 'widowed_mourning');
      H.memory(s, 'widowed', 5, -1, p.id);
      H.chronicle('widowed', [s, p]);
    }
    const b = this.betrothalOf(p);
    if (b) {
      const other = this.person(b.a === p.id ? b.b : b.a);
      this.cancelBetrothal(b, 'death');
      if (other) H.moodlet(other, 'heartbroken');
    }
    this.state.affairs = this.state.affairs.filter((f) => f.a !== p.id && f.b !== p.id);
    this.state.offers = this.state.offers.filter((o) => o.personId !== p.id && o.candidateId !== p.id);
    this.state.refusals = this.state.refusals.filter((x) => x.a !== p.id && x.b !== p.id);
    this.state.separations = this.state.separations.filter((x) => x.a !== p.id && x.b !== p.id);
    this.state.blessings = this.state.blessings.filter((x) => x.suitor !== p.id && x.head !== p.id);
    this.state.mourning = this.state.mourning.filter((m) => m.personId !== p.id);
    delete this.state.decided[p.id];
  }

  // ---------------------------------------------------------------- 매일 (자정)

  /** 자정 정산 뒤: 혼례 날이 된 쌍, 혼담 만료, 들어온 혼담, 카드 */
  daily(): void {
    const H = this.host;
    const day = H.day();
    this.state.offers = this.state.offers.filter((o) => o.status === 'open' && o.expires > day);
    this.state.refusals = this.state.refusals.filter((x) => day - x.day <= Math.max(1, this.days(this.d.match.offerDays)));
    this.state.blessings = this.state.blessings.filter((x) => day - x.day <= Math.max(1, this.days(this.d.match.offerDays)));
    this.state.mourning = this.state.mourning.filter((m) => m.until > day);
    for (const [id, d] of Object.entries(this.state.decided)) if (day - d > 1) delete this.state.decided[Number(id)];
    // 혼례: 조작 가문은 그날 제단에서 올리지 못하면 다음 자정에 조촐하게, NPC 는 혼례 날에
    for (const b of [...this.state.betrothals]) {
      const g = this.person(b.a);
      const w = this.person(b.b);
      if (!g || !w) {
        this.cancelBetrothal(b, 'gone');
        continue;
      }
      const ctl = this.ctl(g) || this.ctl(w);
      if (ctl && b.weddingDay === day + 1 && !b.nerves) {
        b.nerves = true;
        for (const p of [g, w]) H.moodlet(p, 'betrothal_nerves');
      }
      if (ctl ? b.weddingDay < day : b.weddingDay <= day) this.wed(b);
    }
    this.npcProposals(day);
    this.controlledCards(day);
  }

  /** NPC 가정이 조작 가문에 혼담을 넣음 (들어온 혼담: 수락/거절) */
  private npcProposals(day: number): void {
    const H = this.host;
    const M = this.d.match;
    const ours = H.persons.filter((p) => this.ctl(p) && this.single(p));
    for (const p of ours) {
      if (H.rng.next() >= M.npcProposalChance) continue;
      if (this.state.offers.some((o) => o.personId === p.id && o.incoming && o.status === 'open')) continue;
      const pool = H.persons.filter((c) => !this.ctl(c) && this.single(c) && this.canMarry(p, c).ok && Math.abs(H.age(p) - H.age(c)) <= this.d.rules.ageGapYears && !H.matchBlocked?.(c.household));
      if (!pool.length) continue;
      const c = pool[H.rng.int(pool.length)];
      this.offerFor(p, c, true);
      H.notice(p, 'match_proposed', { a: c.name, b: p.name });
      const head = H.headOf(c.household);
      if (head) H.letter?.(head, H.headOf(p.household) ?? p, 'matchmaking', c);
      void day;
    }
  }

  private cardReady(hh: number, card: string, cooldown: number): boolean {
    const k = `${hh}:${card}`;
    const last = this.state.cardDay[k];
    if (last !== undefined && this.host.day() - last < cooldown) return false;
    this.state.cardDay[k] = this.host.day();
    return true;
  }

  /** 조작 가문 카드: 중매인 방문, 불륜 유혹, 과부 재혼 제안 */
  private controlledCards(day: number): void {
    const H = this.host;
    const heads = new Map<number, Person>();
    for (const p of H.persons) if (this.ctl(p) && !heads.has(p.household)) heads.set(p.household, H.headOf(p.household) ?? p);
    for (const [hh, head] of heads) {
      const single = H.persons.find((p) => p.household === hh && this.single(p) && p !== head);
      if (single && !this.state.betrothals.some((b) => this.person(b.a)?.household === hh || this.person(b.b)?.household === hh) && H.rng.next() < this.d.match.matchmakerCardChance && this.cardReady(hh, 'matchmaker_visit', this.days(this.d.match.matchmakerCooldown))) {
        H.offerCard(head, 'matchmaker_visit', { name: single.name }, single);
      }
    }
    const A = this.d.affair;
    for (const p of H.persons) {
      if (!this.ctl(p)) continue;
      if (p.spouse && !this.affairOf(p) && (p.lifeStage === 'young' || p.lifeStage === 'adult') && H.rng.next() < A.temptationChance) {
        const other = H.persons.find((q) => q !== p && q.id !== p.spouse && !this.ctl(q) && this.eligible(q).ok && q.sex !== p.sex && H.rel.romance(p.id, q.id) >= A.temptationRomance);
        if (other && this.cardReady(p.household, `affair_temptation:${p.id}`, 20)) H.offerCard(p, 'affair_temptation', { name: p.name }, other);
      }
      const m = this.mourningOf(p);
      if (m && !p.spouse && H.rng.next() < this.d.widow.proposalChance) {
        const other = H.persons.find((q) => q !== p && !this.ctl(q) && this.single(q) && this.canMarry(p, q).ok && H.rel.friendship(p.id, q.id) >= this.d.widow.proposalFriendship);
        if (other && this.cardReady(p.household, `widow:${p.id}`, 10)) H.offerCard(p, 'widow_remarriage_proposal', { name: p.name }, other);
      }
    }
    void day;
  }

  // ---------------------------------------------------------------- 리드 훅: 사회 상호작용 / 물건 상호작용 / 카드

  private isRomance(id: string): boolean {
    const c = this.host.socialCategory?.(id);
    return c ? c === 'romance' : ROMANCE_IDS.has(id);
  }

  /** 사회 상호작용이 끝났을 때 (리드: onSocial(p, t, id, ok)) */
  onSocial(p: Person, t: Person, id: string, ok: boolean): void {
    const H = this.host;
    // 불륜 중인 두 사람의 로맨스 상호작용: 발각 확률 (공공 장소는 배)
    const f = this.affairOf(p, t);
    if (f && !f.exposed && this.isRomance(id) && id !== 'social.end_affair') {
      const A = this.d.affair;
      const chance = A.exposeChance * (p.place || t.place ? A.publicMult : 1);
      if (H.rng.next() < chance) this.expose(f, null);
    }
    switch (id) {
      case 'social.confess':
        if (!ok) break;
        if ((p.spouse && p.spouse !== t.id) || (t.spouse && t.spouse !== p.id)) this.startAffair(p, t);
        else H.moodlet(t, 'courted_flattered');
        this.markDecided(p, t);
        break;
      case 'social.propose':
        if (ok) {
          if ((p.spouse && p.spouse !== t.id) || (t.spouse && t.spouse !== p.id)) this.relFlag(p, t, ['lover'], ['engaged']);
          else this.proposalAccepted(p, t);
        } else this.proposalRejected(p, t);
        break;
      case 'social.break_up': {
        if (!ok) break;
        const b = this.betrothalOf(p);
        if (b && this.pairIs(b, p, t)) {
          this.cancelBetrothal(b, 'broken');
          H.rumor([t], 'jilted', this.d.consent.jiltedStrength, [p, t]);
        }
        if (this.affairOf(p, t)) this.endAffair(p, t);
        this.markDecided(p, t);
        break;
      }
      case 'social.affair_proposal':
        if (ok) this.startAffair(p, t);
        break;
      case 'social.end_affair':
        if (ok) this.endAffair(p, t);
        break;
      case 'social.confess_affair':
        this.confessAffair(p, t, ok);
        break;
      case 'social.ask_consent':
        if (ok) {
          this.state.blessings = this.state.blessings.filter((x) => !(x.suitor === p.id && x.head === t.id));
          this.state.blessings.push({ suitor: p.id, head: t.id, day: H.day() });
        }
        break;
      case 'social.discuss_match':
        if (ok) {
          const mine = H.persons.find((q) => q.household === p.household && this.single(q) && H.persons.some((c) => c.household === t.household && this.single(c) && this.canMarry(q, c).ok));
          if (mine) this.findMatch(p.household, mine.id, { onlyHousehold: t.household, bonus: this.d.negotiate.discussBonus });
        }
        break;
      case 'social.negotiate_dowry':
        if (ok) this.dowryTalk(p, t);
        break;
      case 'social.ask_reconcile':
        if (ok) this.reconcile(p, t);
        break;
      default:
        break;
    }
  }

  /** 지참금 협상 성공: 두 가정 사이 혼담 승낙 보정 + 우리가 내는 지참금 깎기 */
  private dowryTalk(p: Person, t: Person): void {
    const N = this.d.negotiate;
    for (const o of this.state.offers) {
      const a = this.person(o.personId);
      const c = this.person(o.candidateId);
      if (!a || !c || o.status !== 'open') continue;
      if (!((a.household === p.household && c.household === t.household) || (a.household === t.household && c.household === p.household))) continue;
      o.bonus += N.discussBonus;
      const [groom, bride] = this.groomBride(a, c);
      if (this.standardDowry(groom, bride, this.d.residence.default).payerHh === p.household) o.dowry = Math.round(o.dowry * (1 - N.dowryTalkDiscount));
    }
    for (const b of this.state.betrothals) {
      const payer = this.payerOf(b);
      const g = this.person(b.a);
      const w = this.person(b.b);
      if (!payer || !g || !w) continue;
      const other = payer === g ? w : g;
      if (payer.household === p.household && other.household === t.household) b.dowry = Math.round(b.dowry * (1 - N.dowryTalkDiscount));
    }
  }

  /** 물건 상호작용이 끝났을 때 (리드: onInteraction(p, iaId, targetUid)) */
  onInteraction(p: Person, iaId: string, targetUid = 0): void {
    void targetUid;
    switch (iaId) {
      case 'altar.wedding_rite': {
        const b = this.betrothalOf(p);
        if (b && b.weddingDay === this.host.day()) this.wed(b);
        break;
      }
      case 'altar.petition_annulment': {
        const r = this.annulReasons(p)[0];
        if (r) this.petitionAnnulment(p.id, r);
        break;
      }
      case 'inn_counter.ask_matchmaker': {
        const subject = this.single(p) ? p : this.host.persons.find((q) => q.household === p.household && this.single(q));
        if (subject) this.findMatch(p.household, subject.id);
        break;
      }
      default:
        break;
    }
  }

  private cardAction(cardId: string, option: number, ok: boolean): string | null {
    const a = this.d.cards[cardId]?.[String(option)];
    if (!a) return null;
    if (typeof a === 'string') return a;
    return (ok ? a.ok : a.fail) ?? null;
  }

  /** 카드 선택이 끝났을 때 (리드: Cards 결과 → onCard(p, cardId, option(0부터), ok, other)) */
  onCard(p: Person, cardId: string, option: number, ok: boolean, other: Person | null): void {
    const act = this.cardAction(cardId, option, ok);
    if (!act) return;
    const H = this.host;
    const ref = this.state.refusals.find((x) => x.a === p.id || x.b === p.id);
    const lover = other ?? (ref ? this.person(ref.a === p.id ? ref.b : ref.a) ?? null : null);
    const hhBetrothal = (): Betrothal | undefined => this.state.betrothals.find((b) => this.person(b.a)?.household === p.household || this.person(b.b)?.household === p.household);
    switch (act) {
      case 'elope':
        if (lover) this.elope(p, lover, { fromCard: true });
        break;
      case 'allow_match':
        if (lover) this.betroth(p, lover, 'love');
        break;
      case 'give_up':
        if (lover) {
          this.relFlag(p, lover, [], ['lover']);
          this.state.refusals = this.state.refusals.filter((x) => !this.pairIs(x, p, lover));
        }
        break;
      case 'find_match':
      case 'find_match_good': {
        const subject = other && other.household === p.household && this.single(other) ? other : H.persons.find((q) => q.household === p.household && this.single(q) && q !== p) ?? (this.single(p) ? p : undefined);
        if (subject) this.findMatch(p.household, subject.id, { good: act === 'find_match_good' });
        break;
      }
      case 'feast_grand':
      case 'feast_modest':
      case 'feast_church': {
        const b = hhBetrothal();
        if (b) {
          b.feast = act.slice(6) as FeastTier;
          b.feastByCard = true;
        }
        break;
      }
      case 'dowry_debt':
      case 'dowry_heirloom':
      case 'dowry_waive': {
        const b = this.state.betrothals.find((x) => this.payerOf(x)?.household === p.household);
        if (b) b.dowryCover = act === 'dowry_debt' ? 'debt' : act === 'dowry_heirloom' ? 'heirloom_card' : 'waive';
        break;
      }
      case 'affair_start':
        if (other) this.startAffair(p, other);
        break;
      case 'affair_end': {
        const f = this.affairOf(p, other ?? undefined);
        const o = f && this.person(f.a === p.id ? f.b : f.a);
        if (o) this.endAffair(p, o);
        break;
      }
      case 'affair_exposed': {
        const f = this.affairOf(p, other ?? undefined);
        if (f) f.exposed = true;
        const o = f && this.person(f.a === p.id ? f.b : f.a);
        if (o) {
          H.news('affair_exposed', { a: p.name, b: o.name }, [p]);
          H.onScandal?.(p, o);
        }
        break;
      }
      case 'betroth_other':
        if (other) {
          const r = this.betroth(p, other, 'love', { fromCard: true });
          if (r.ok) {
            const b = this.betrothalOf(p);
            if (b && cardId === 'widow_remarriage_proposal') b.hastyDone = true;
          }
        }
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- 조건 게이트 (requires.gate)

  /** 리드가 sim.gates 에 모두 등록. t 는 사회 상호작용 상대 (물건이면 null) */
  gates(): Record<string, (p: Person, t: Person | null) => boolean> {
    const H = this.host;
    const day = () => H.day();
    return {
      // 연인의 가장에게 축복 청하기
      ask_consent: (p, t) => {
        if (!t || t.household === p.household || H.headOf(t.household) !== t) return false;
        return H.persons.some((q) => q.household === t.household && q !== t && (H.rel.get(p.id, q.id)?.flags.has('lover') ?? false)) && this.eligible(p).ok;
      },
      // 두 가장이 혼처 의논: 우리 가정에 독신, 상대 가정에 맞는 독신
      match_talk: (p, t) => {
        if (!t || t.household === p.household || H.headOf(p.household) !== p || H.headOf(t.household) !== t) return false;
        return H.persons.some((q) => q.household === p.household && this.single(q) && H.persons.some((c) => c.household === t.household && this.single(c) && this.canMarry(q, c).ok));
      },
      // 지참금 협상: 두 가정 사이 열린 혼담이나 약혼
      dowry_talk: (p, t) => {
        if (!t || t.household === p.household) return false;
        const between = (x: number, y: number) => {
          const a = this.person(x);
          const b = this.person(y);
          return !!a && !!b && ((a.household === p.household && b.household === t.household) || (a.household === t.household && b.household === p.household));
        };
        return this.state.offers.some((o) => o.status === 'open' && between(o.personId, o.candidateId)) || this.state.betrothals.some((b) => b.dowry > 0 && between(b.a, b.b));
      },
      // 혼례 축하: 상대가 막 혼인했거나 약혼 중
      recently_wed: (p, t) => !!t && t !== p && ((t.marriedDay >= 0 && day() - t.marriedDay <= Math.max(1, this.days(this.d.rules.recentWed)) && !!t.spouse) || !!this.betrothalOf(t)),
      // 불륜 제안: 한쪽 이상 기혼(서로 배우자 아님), 로맨스 충분, 둘 다 혼인 나이, 근친 아님
      affair_possible: (p, t) => {
        if (!t || p.spouse === t.id) return false;
        if (!p.spouse && !t.spouse) return false;
        if (this.affairOf(p, t)) return false;
        if (!this.eligible(p).ok || !this.eligible(t).ok) return false;
        if (this.kin(p, t, this.d.rules.kinDegreeMax) <= this.d.rules.kinDegreeMax) return false;
        return H.rel.romance(p.id, t.id) >= this.d.affair.proposalRomance;
      },
      in_affair: (p, t) => !!t && !!this.affairOf(p, t),
      // 배우자에게 불륜 고백
      confess_affair: (p, t) => !!t && p.spouse === t.id && this.state.affairs.some((f) => (f.a === p.id || f.b === p.id) && !f.exposed),
      mourning_target: (p, t) => !!t && t !== p && !!this.mourningOf(t),
      separated_spouse: (p, t) => !!t && p.spouse === t.id && this.state.separations.some((x) => this.pairIs(x, p, t)),
      // 교회 제단: 오늘이 혼례 날
      wedding_today: (p) => {
        const b = this.betrothalOf(p);
        return !!b && b.weddingDay === day() && !!this.person(b.a) && !!this.person(b.b);
      },
      can_annul: (p) => this.canAnnul(p).ok,
      mourning: (p) => !!this.mourningOf(p),
      // 여관 중매인: 우리 가정에 독신이 있고 혼사 방해 중이 아님
      can_seek_match: (p) => !H.matchBlocked?.(p.household) && H.persons.some((q) => q.household === p.household && this.single(q)) && (H.headOf(p.household) === p || this.single(p)),
    };
  }

  /** 카드 조건 flags (sim.cardsHost.flags 에 합침) */
  flags(p: Person): string[] {
    const H = this.host;
    const out: string[] = [];
    const hh = p.household;
    const members = H.persons.filter((q) => q.household === hh);
    if (members.some((q) => this.betrothalOf(q))) out.push('engaged');
    if (this.state.refusals.some((x) => x.a === p.id || x.b === p.id)) out.push('match_refused');
    if (this.state.betrothals.some((b) => this.payerOf(b)?.household === hh && b.dowry > H.money(hh) && b.dowryCover === null)) out.push('dowry_due');
    if (this.mourningOf(p)) out.push('widowed_recent');
    if (this.affairOf(p)) out.push('affair');
    if (members.some((q) => this.single(q))) out.push('child_of_age');
    const s = this.married(p);
    if (s) {
      const ps = H.parentsOf(s.id);
      if (ps && H.persons.some((q) => (q.id === ps[0] || q.id === ps[1]) && q.household !== hh)) out.push('in_laws_near');
    }
    if (members.some((q) => q.lifeStage === 'teen' && H.persons.some((o) => o !== q && H.rel.romance(q.id, o.id) >= 30))) out.push('teen_in_love');
    return out;
  }

  // ---------------------------------------------------------------- 통계 / 해시

  /** 결정론 해시 (sim.hash) */
  hashParts(parts: (string | number)[]): void {
    parts.push('court', JSON.stringify(this.state));
  }
}
