/**
 * 원한과 결투, 주먹다짐 (GDD 14-5, 32-2 간이 전투, 32-6 결과).
 * - 원한: 우정 grudgeAt(−60) 이하 (releaseAt 위로 오르면 풀림). 생기면 가문 단위로 번짐 (host.onGrudge = clans.onGrudge,
 *   식구에게 우정 하락), 원한 무드렛
 * - 원한의 자율 행동 (NPC 쪽만, 하루 한 번 확률): 험담(소문 slander), 모욕, 밤에 기물 파손(조작 가문이면 사건 카드 feud_vandalism),
 *   고발(Justice.accuse), 결투 신청(기사/귀족/용감함), 주먹다짐(평민)
 * - 결투: 신청 → 수락/거절 (거절 = 개인 명예·가문 명성 하락, 소문 duel_refused, 무드렛). NPC끼리는 32-2 간이 전투로 즉시 계산.
 *   조작 가문 인물이면 host.requestCombatScene (M13 교전 장면). 없으면 간이 전투로 계산하고 알림 카드로.
 *   패배: 부상 / 영구 부상 / 사망 (사망 설정 행렬 combat·duel, 꺼지면 기절 + 중상 + 흉터 또는 영구 부상). 결투당 사망 약 10% (29-1: 5~15%)
 * - 주먹다짐: 저녁 여관, 사이 나쁜 평민 (술꾼·다혈질). 부상, 경비에게 걸리면 둘 다 벌금
 * 무작위는 host.rng 만. 렌더러/DOM 없음 (워커)
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import type { Person } from '../people/person';
import type { DeathRulesView } from '../health/deathRules';
import type { CrimeId, Justice } from './justice';
import { atLeastTeen, clamp, durDays, durSchema, grownUp, stripDollar, type PolicyEffects } from './policy';

const num = z.number();
const rec = z.record(z.string(), num);
const outcomeSchema = z.object({ death: num, permanent: num, injury: num, winnerInjury: num });
export const combatSchema = z.object({
  stanceEdge: num,
  perMartial: num,
  perEquip: num,
  noise: num,
  gauge: num,
  maxRounds: z.number().int().min(1),
  traits: rec,
  angry: num,
  injured: num,
  outcomes: z.object({ duel: outcomeSchema, brawl: outcomeSchema }),
  permanentKinds: z.array(z.string()).min(1),
  injuryKinds: z.object({ duel: z.string(), brawl: z.string() }),
  fallbackPermanent: num,
});
export type CombatData = z.infer<typeof combatSchema>;

export const feudSchema = z.object({
  grudgeAt: num,
  releaseAt: num,
  spreadToFamily: num,
  spreadFriendship: num,
  actionChancePerDay: num,
  actionTraits: rec,
  actions: z.object({ gossip: num, insult: num, vandalism: num, accuse: num, challenge: num, brawl: num }),
  gossipRumor: z.string(),
  gossipStrength: num,
  insultFriendship: num,
  insultRespect: num,
  vandalismCard: z.string(),
  duel: z.object({
    estates: z.array(z.string()),
    traits: z.array(z.string()),
    minStage: z.string(),
    cooldown: durSchema,
    accept: z.object({ base: num, traits: rec, estates: rec, perHonor: num, perSkillGap: num }),
    refuseFame: num,
    refuseRespect: num,
    refuseRumorStrength: num,
    winFame: num,
    loseFame: num,
    killKarma: num,
    card: z.string(),
  }),
  brawl: z.object({
    place: z.string(),
    hours: z.tuple([num, num]),
    chance: num,
    friendshipBelow: num,
    traits: rec,
    estates: z.array(z.string()),
    fineShare: num,
    maxPerDay: z.number().int(),
  }),
  combat: combatSchema,
  moodlets: z.record(z.string(), z.string()),
}).loose();
export type FeudData = z.infer<typeof feudSchema>;

/** SimData.family.justice (justice.json 원본) 의 feud 칸 */
export function parseFeud(raw: unknown): FeudData | null {
  const r = (raw as { feud?: unknown } | null | undefined)?.feud;
  return r ? feudSchema.parse(stripDollar(r)) : null;
}

// ------------------------------------------------------------------ 간이 전투 (32-2)

export type Stance = 'attack' | 'defend' | 'technique';
const STANCES: Stance[] = ['attack', 'defend', 'technique'];
/** 상성: 공격 > 기술 > 방어 > 공격 */
const BEATS: Record<Stance, Stance> = { attack: 'technique', technique: 'defend', defend: 'attack' };

export interface Fighter {
  martial: number;
  /** 무기·갑옷 품질 단계 (0 = 맨손) */
  equip: number;
  traits: readonly string[];
  angry: boolean;
  injured: boolean;
}

export interface CombatResult {
  /** 0 = a 승, 1 = b 승 */
  winner: 0 | 1;
  rounds: number;
  gauge: number;
}

function pickStance(f: Fighter, rng: Rng): Stance {
  const w = [1, 1, 0.6];
  if (f.traits.includes('hot_tempered')) w[0] += 0.5;
  if (f.angry) w[0] += 0.5;
  if (f.traits.includes('brave')) w[0] += 0.3;
  if (f.traits.includes('calm')) w[1] += 0.5;
  if (f.traits.includes('coward')) w[1] += 0.5;
  w[2] += f.martial / 10;
  return STANCES[Math.max(0, rng.weighted(w))];
}

function edge(f: Fighter, d: CombatData): number {
  let e = 0;
  for (const t of f.traits) e += d.traits[t] ?? 0;
  if (f.angry) e += d.angry;
  if (f.injured) e += d.injured;
  return e;
}

/**
 * 간이 전투 (화면 밖 교전, NPC 결투, 여관 주먹다짐): 라운드 묶음을 즉시 계산.
 * 라운드 점수(a 기준) = 상성 × stanceEdge + 무예 차 × perMartial + 장비 차 × perEquip + 특성·분노·부상 + 잡음
 */
export function quickCombat(a: Fighter, b: Fighter, d: CombatData, rng: Rng): CombatResult {
  let g = 0;
  let r = 0;
  const base = (a.martial - b.martial) * d.perMartial + (a.equip - b.equip) * d.perEquip + edge(a, d) - edge(b, d);
  while (r < d.maxRounds && Math.abs(g) < d.gauge) {
    r++;
    const sa = pickStance(a, rng);
    const sb = pickStance(b, rng);
    const st = BEATS[sa] === sb ? 1 : BEATS[sb] === sa ? -1 : 0;
    // 잡음: 균등 셋의 합 (평균 0, 표준편차 noise)
    const n = (rng.next() + rng.next() + rng.next() - 1.5) * 2 * d.noise;
    g += st * d.stanceEdge + base + n;
  }
  const winner: 0 | 1 = g > 0 ? 0 : g < 0 ? 1 : rng.next() < 0.5 ? 0 : 1;
  return { winner, rounds: r, gauge: g };
}

export type CombatKind = 'duel' | 'brawl';
export type LoserFate = 'death' | 'permanent' | 'injury' | 'knockout';

/** 진 쪽의 결과 (사망 설정 행렬: 꺼지면 기절 + 중상 + 흉터/영구 부상) */
export function loserFate(kind: CombatKind, d: CombatData, rng: Rng, deathAllowed: number): LoserFate {
  const o = d.outcomes[kind];
  const u = rng.next();
  if (u < o.death * deathAllowed) return 'death';
  if (u < o.death) return rng.next() < d.fallbackPermanent ? 'permanent' : 'injury';
  if (u < o.death + o.permanent) return 'permanent';
  if (u < o.death + o.permanent + o.injury) return 'injury';
  return 'knockout';
}

// ------------------------------------------------------------------ Host

/** Feuds 가 쓰는 Justice 창구 */
export type FeudJustice = Pick<Justice, 'accuse' | 'summaryFine' | 'noteCommitted'> & { d: { crimes: Record<CrimeId, { patrol: number }> } };

export interface FeudHost {
  readonly persons: readonly Person[];
  readonly rng: Rng;
  day(): number;
  minute(): number;
  lifespan(): number;
  seasonDays(): number;
  controlled(household: number): boolean;
  friendship(a: Person, b: Person): number;
  /** a→b 우정이 v 이하인 쌍 (관계 3축에서). 같은 가구 쌍도 넘겨도 됨 (여기서 거름) */
  relationsBelow(v: number): [Person, Person][];
  relation(a: Person, b: Person, d: { friendship?: number; respect?: number }): void;
  /** 가문 단위 원한 (house.clans.onGrudge) */
  onGrudge(a: Person, b: Person): void;
  placeAt(p: Person, minute: number): string | null;
  placeKind(placeId: string): string | null;
  skillLevel(p: Person, skill: string): number;
  /** 무기·갑옷 품질 단계 (0 = 맨손, 32-3). 모르면 0 */
  equipTier(p: Person): number;
  /** 부상 상태인가 (20-4) */
  injured(p: Person): boolean;
  /** 지금 화났나 (감정) */
  angry(p: Person): boolean;
  policy(): PolicyEffects | null;
  deathRules(): DeathRulesView | null;
  justice(): FeudJustice | null;
  fame(household: number, delta: number, reason: string, by?: Person | null): void;
  karma(p: Person, delta: number): void;
  moodlet(p: Person, id: string): void;
  memory(p: Person, kind: string, importance: number, valence: number, withPerson: number): void;
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
  news(kind: string, args: Record<string, string | number>, subjects: Person[]): void;
  chronicle(trigger: string, subjects: Person[], args?: Record<string, string | number>): void;
  rumor(subject: Person, kind: string, good: boolean, strength: number, knownBy?: Person[]): void;
  offerCard(p: Person, cardId: string, vars?: Record<string, string | number>, other?: Person | null): void;
  /** 밤에 몰래 기물 파손 (그 집 물건 하나 손상) */
  vandalize(household: number, by: Person): void;
  /** 부상 (20-4: cut 베임, bruise 타박상) */
  injure(p: Person, kind: string): void;
  /** 영구 부상 (big_scar lame one_eye one_hand) */
  permanentInjury(p: Person, kind: string): void;
  /** 기절 (전투 사망이 꺼진 칸의 대체, 쓰러짐) */
  knockOut(p: Person): void;
  kill(p: Person, cause: 'combat', sub: CombatKind): void;
  /** 조작 가문 교전 장면 (M13). 장면을 열었으면 true → 끝나면 리드가 finishCombat 을 부름 */
  requestCombatScene?(a: Person, b: Person, kind: CombatKind): boolean;
}

export interface FeudState {
  /** "a:b" (a 가 b 에게 품은 원한) → 생긴 날 */
  grudges: Record<string, number>;
  /** "a:b" 정렬 쌍 → 마지막 결투 날 */
  lastDuel: Record<string, number>;
  /** 조작 가문 인물이 받은 결투 신청: 받은 사람 → {신청자, 날} */
  pending: Record<number, { from: number; day: number }>;
}

export interface FeudStats {
  grudges: number;
  actions: Record<string, number>;
  duels: number;
  duelDeaths: number;
  refusals: number;
  brawls: number;
  brawlDeaths: number;
  brawlFines: number;
}

const pair = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

export class Feuds {
  state: FeudState = { grudges: {}, lastDuel: {}, pending: {} };
  readonly stats: FeudStats = { grudges: 0, actions: {}, duels: 0, duelDeaths: 0, refusals: 0, brawls: 0, brawlDeaths: 0, brawlFines: 0 };

  constructor(private host: FeudHost, readonly d: FeudData) {}

  private byId(id: number): Person | undefined {
    return this.host.persons.find((p) => p.id === id);
  }

  /** 이 사람이 원한을 품은 상대 (Justice.grudgeTargets) */
  grudgesOf(p: Person): Person[] {
    const out: Person[] = [];
    for (const k of Object.keys(this.state.grudges)) {
      const [a, b] = k.split(':').map(Number);
      if (a !== p.id) continue;
      const q = this.byId(b);
      if (q) out.push(q);
    }
    return out;
  }

  hasGrudge(a: Person, b: Person): boolean {
    return this.state.grudges[`${a.id}:${b.id}`] !== undefined;
  }

  // ---------------------------------------------------------------- 하루 (자정)

  /** 자정 한 번 (방금 끝난 날 day): 원한 갱신 → 원한 자율 행동 → 여관 주먹다짐 → 오래된 결투 신청 정리 */
  daily(day: number): void {
    this.updateGrudges(day);
    this.grudgeActions(day);
    this.innBrawls(day);
    for (const [k, v] of Object.entries(this.state.pending)) if (day - v.day > 3) delete this.state.pending[Number(k)];
  }

  /** 원한 생김/풀림 (우정 −60 문턱, −40 풀림) */
  updateGrudges(day: number): void {
    const H = this.host;
    const F = this.d;
    for (const [a, b] of H.relationsBelow(F.grudgeAt)) {
      if (a === b || a.household === b.household || !atLeastTeen(a) || !atLeastTeen(b)) continue;
      const k = `${a.id}:${b.id}`;
      if (this.state.grudges[k] !== undefined) continue;
      this.state.grudges[k] = day;
      this.stats.grudges++;
      H.moodlet(a, F.moodlets.grudge);
      H.onGrudge(a, b);
      H.memory(a, 'grudge', 3, -1, b.id);
      // 가문 단위로 번짐: 식구들도 상대를 덜 좋아함
      for (const q of H.persons) if (q !== a && q.household === a.household && atLeastTeen(q) && H.rng.next() < F.spreadToFamily) H.relation(q, b, { friendship: F.spreadFriendship });
      if (H.controlled(a.household)) H.notice(a, 'grudge_new', { a: a.name, b: b.name });
      if (H.controlled(b.household)) {
        H.notice(b, 'grudge_against', { a: a.name, b: b.name });
        H.moodlet(b, F.moodlets.watchful);
      }
    }
    for (const k of Object.keys(this.state.grudges)) {
      const [ai, bi] = k.split(':').map(Number);
      const a = this.byId(ai);
      const b = this.byId(bi);
      if (!a || !b || H.friendship(a, b) > F.releaseAt) delete this.state.grudges[k];
    }
  }

  private grudgeActions(day: number): void {
    const H = this.host;
    const F = this.d;
    const keys = Object.keys(this.state.grudges).sort();
    const kinds = Object.keys(F.actions) as (keyof FeudData['actions'])[];
    for (const k of keys) {
      const [ai, bi] = k.split(':').map(Number);
      const a = this.byId(ai);
      const b = this.byId(bi);
      if (!a || !b) continue;
      const u = H.rng.next();
      // 조작 가문은 스스로 하지 않음 (플레이어가 고름)
      if (H.controlled(a.household) || !grownUp(a)) continue;
      let c = F.actionChancePerDay;
      for (const t of a.traits) c *= F.actionTraits[t] ?? 1;
      if (u >= c) continue;
      const w = kinds.map((kind) => {
        if (kind === 'challenge' && !this.canChallenge(a, b, day)) return 0;
        if (kind === 'brawl' && !this.brawlEligible(a, b)) return 0;
        return F.actions[kind];
      });
      const kind = kinds[Math.max(0, H.rng.weighted(w))];
      this.stats.actions[kind] = (this.stats.actions[kind] ?? 0) + 1;
      this.act(kind, a, b, day);
    }
  }

  /** 원한 행동 하나 */
  act(kind: keyof FeudData['actions'], a: Person, b: Person, day = this.host.day()): void {
    const H = this.host;
    const F = this.d;
    switch (kind) {
      case 'gossip':
        H.rumor(b, F.gossipRumor, false, F.gossipStrength, [a]);
        break;
      case 'insult':
        H.relation(b, a, { friendship: F.insultFriendship, respect: F.insultRespect });
        H.moodlet(b, F.moodlets.insulted);
        if (H.controlled(b.household)) H.notice(b, 'feud_insult', { a: a.name, b: b.name });
        break;
      case 'vandalism': {
        H.vandalize(b.household, a);
        if (H.controlled(b.household)) H.offerCard(b, F.vandalismCard, { a: a.name }, a);
        break;
      }
      case 'accuse':
        H.justice()?.accuse(a, b);
        break;
      case 'challenge':
        this.challenge(a, b, day);
        break;
      case 'brawl':
        this.brawl(a, b);
        break;
    }
  }

  // ---------------------------------------------------------------- 결투

  /** 결투를 신청할 수 있는 사람 (기사/귀족/용감함, 청년 이상) */
  duelist(p: Person): boolean {
    const D = this.d.duel;
    if (!grownUp(p) || (D.minStage === 'adult' && p.lifeStage === 'young')) return false;
    return D.estates.includes(p.estate) || p.traits.some((t) => D.traits.includes(t));
  }

  canChallenge(a: Person, b: Person, day = this.host.day()): boolean {
    if (a === b || a.household === b.household || !this.duelist(a) || !grownUp(b)) return false;
    const last = this.state.lastDuel[pair(a.id, b.id)];
    return last === undefined || day - last >= durDays(this.d.duel.cooldown, this.host.lifespan(), this.host.seasonDays());
  }

  /** 받는 쪽의 수락 확률 (NPC) */
  acceptChance(b: Person, a: Person): number {
    const A = this.d.duel.accept;
    const H = this.host;
    let c = A.base + (A.estates[b.estate] ?? 0) + b.honor * A.perHonor;
    for (const t of b.traits) c += A.traits[t] ?? 0;
    c += (H.skillLevel(b, 'martial') - H.skillLevel(a, 'martial')) * A.perSkillGap;
    return clamp(c, 0.02, 0.98);
  }

  /**
   * 결투 신청 a → b. 조작 가문이 받으면 사건 카드 (duel_challenge_received: 수락하면 flag duel_accepted → onCardFlag),
   * NPC 가 받으면 바로 수락/거절. 결과: 'pending' | 'accepted' | 'refused'
   */
  challenge(a: Person, b: Person, day = this.host.day()): 'pending' | 'accepted' | 'refused' {
    const H = this.host;
    this.state.lastDuel[pair(a.id, b.id)] = day;
    if (H.controlled(b.household)) {
      this.state.pending[b.id] = { from: a.id, day };
      H.offerCard(b, this.d.duel.card, { a: a.name }, a);
      return 'pending';
    }
    if (H.rng.next() < this.acceptChance(b, a)) {
      this.duel(a, b);
      return 'accepted';
    }
    this.refuse(b, a);
    return 'refused';
  }

  /** 거절: 개인 명예와 가문 명성 하락, 소문, 무드렛, 신청자의 존중 하락 */
  refuse(b: Person, a: Person): void {
    const H = this.host;
    const D = this.d.duel;
    this.stats.refusals++;
    H.fame(b.household, D.refuseFame, 'duel_refused', b);
    H.relation(a, b, { respect: D.refuseRespect });
    H.rumor(b, 'duel_refused', false, D.refuseRumorStrength, [a, b]);
    H.moodlet(b, this.d.moodlets.refused);
    if (H.controlled(b.household) || H.controlled(a.household)) H.notice(H.controlled(b.household) ? b : a, 'duel_refused', { a: a.name, b: b.name });
  }

  private fighter(p: Person): Fighter {
    const H = this.host;
    return { martial: H.skillLevel(p, 'martial'), equip: H.equipTier(p), traits: p.traits, angry: H.angry(p), injured: H.injured(p) };
  }

  /** 결투 (수락됨). 조작 가문이 끼면 교전 장면 요청, 아니면 간이 전투 */
  duel(a: Person, b: Person): CombatResult | null {
    const H = this.host;
    if ((H.controlled(a.household) || H.controlled(b.household)) && H.requestCombatScene?.(a, b, 'duel')) return null;
    const r = quickCombat(this.fighter(a), this.fighter(b), this.d.combat, H.rng);
    this.finishCombat(a, b, 'duel', r.winner === 0 ? a.id : b.id);
    return r;
  }

  /** 교전 결과 적용 (간이 전투 또는 M13 장면이 끝난 뒤 리드가 부름) */
  finishCombat(a: Person, b: Person, kind: CombatKind, winnerId: number): LoserFate {
    const H = this.host;
    const F = this.d;
    const C = F.combat;
    const winner = winnerId === a.id ? a : b;
    const loser = winner === a ? b : a;
    const dr = H.deathRules();
    const allowed = !dr || dr.allows('combat', dr.group(loser.lifeStage), kind) ? (dr ? dr.subChance('combat', kind) : 1) : 0;
    const fate = loserFate(kind, C, H.rng, allowed);
    const inj = C.injuryKinds[kind];
    if (H.rng.next() < C.outcomes[kind].winnerInjury) H.injure(winner, inj);
    if (kind === 'duel') {
      this.stats.duels++;
      H.moodlet(winner, F.moodlets.won);
      H.fame(winner.household, F.duel.winFame, 'duel_won', winner);
      H.rumor(winner, 'duel_won', true, 0.6, [winner, loser]);
      H.memory(winner, 'duel_won', 4, 1, loser.id);
      if (fate !== 'death') {
        H.moodlet(loser, F.moodlets.lost);
        H.fame(loser.household, F.duel.loseFame, 'duel_lost', loser);
        H.memory(loser, 'duel_lost', 4, -1, winner.id);
      }
      // 결투로 매듭: 서로의 원한이 조금 풀림
      H.relation(a, b, { friendship: 15 });
      H.relation(b, a, { friendship: 15 });
    } else {
      this.stats.brawls++;
      H.moodlet(a, F.moodlets.bruised);
      H.moodlet(b, F.moodlets.bruised);
    }
    switch (fate) {
      case 'death':
        if (kind === 'duel') this.stats.duelDeaths++;
        else this.stats.brawlDeaths++;
        H.karma(winner, F.duel.killKarma);
        H.chronicle(kind === 'duel' ? 'duel_death' : 'brawl_death', [loser, winner]);
        H.news(kind === 'duel' ? 'duel_death' : 'brawl_death', { a: winner.name, b: loser.name }, [loser, winner]);
        H.kill(loser, 'combat', kind);
        break;
      case 'permanent': {
        H.knockOut(loser);
        H.injure(loser, inj);
        H.permanentInjury(loser, C.permanentKinds[Math.floor(H.rng.next() * C.permanentKinds.length)]);
        break;
      }
      case 'injury':
        H.injure(loser, inj);
        break;
      case 'knockout':
        H.knockOut(loser);
        break;
    }
    if (kind === 'duel') {
      if (fate !== 'death') H.chronicle('duel', [winner, loser]);
      for (const p of [a, b]) if (H.controlled(p.household)) H.notice(p, 'duel_result', { a: winner.name, b: loser.name, fate: `duel.fate.${fate}` });
    } else for (const p of [a, b]) if (H.controlled(p.household)) H.notice(p, 'brawl_result', { a: winner.name, b: loser.name, fate: `duel.fate.${fate}` });
    return fate;
  }

  // ---------------------------------------------------------------- 주먹다짐

  brawlEligible(a: Person, b: Person): boolean {
    const B = this.d.brawl;
    return grownUp(a) && grownUp(b) && B.estates.includes(a.estate) && B.estates.includes(b.estate);
  }

  /** 주먹다짐 (여관, 원한, social.punch). 경비에게 걸리면 둘 다 벌금 */
  brawl(a: Person, b: Person): LoserFate | null {
    const H = this.host;
    const B = this.d.brawl;
    const J = H.justice();
    J?.noteCommitted('assault');
    let fate: LoserFate | null = null;
    if ((H.controlled(a.household) || H.controlled(b.household)) && H.requestCombatScene?.(a, b, 'brawl')) fate = null;
    else {
      const r = quickCombat(this.fighter(a), this.fighter(b), this.d.combat, H.rng);
      fate = this.finishCombat(a, b, 'brawl', r.winner === 0 ? a.id : b.id);
    }
    H.rumor(a, 'brawl', false, 0.3, [a, b]);
    const patrol = (J?.d.crimes.assault.patrol ?? 0.15) * (H.policy()?.detectMult() ?? 1);
    if (J && H.rng.next() < patrol) {
      for (const p of [a, b]) if (H.persons.includes(p)) J.summaryFine(p, 'assault', B.fineShare);
      this.stats.brawlFines++;
    }
    return fate;
  }

  /** 저녁 여관에서 사이 나쁜 평민끼리 (또는 술꾼·다혈질) */
  private innBrawls(day: number): void {
    const H = this.host;
    const B = this.d.brawl;
    const minute = day * 1440 + Math.round((B.hours[0] + B.hours[1]) / 2) * 60;
    const here = H.persons.filter((p) => {
      if (!grownUp(p) || !B.estates.includes(p.estate) || p.schoolAway) return false;
      const pl = H.placeAt(p, minute);
      return !!pl && (H.placeKind(pl) ?? pl) === B.place;
    });
    const mult = H.policy()?.crimeMult() ?? 1;
    let n = 0;
    for (let i = 0; i < here.length && n < B.maxPerDay; i++) {
      for (let j = i + 1; j < here.length && n < B.maxPerDay; j++) {
        const a = here[i];
        const b = here[j];
        if (a.household === b.household) continue;
        // 조작 가문 인물은 자율 주먹다짐에서 빠짐 (여관 카드 tavern_brawl 로)
        if (H.controlled(a.household) || H.controlled(b.household)) continue;
        const bad = H.friendship(a, b) <= B.friendshipBelow || H.friendship(b, a) <= B.friendshipBelow;
        let c = bad ? B.chance : B.chance * 0.1;
        for (const t of [...a.traits, ...b.traits]) c *= B.traits[t] ?? 1;
        c *= mult;
        if (H.rng.next() >= c) continue;
        n++;
        this.brawl(a, b);
        if (!H.persons.includes(a) || !H.persons.includes(b)) break;
      }
    }
  }

  // ---------------------------------------------------------------- 사회 결과, 카드, 게이트, 플래그

  /** 사회 상호작용 결과 (리드 onSocial). social.challenge_duel: 성공 = 수락 → 결투, 실패 = 거절. social.punch = 주먹다짐 */
  onSocial(p: Person, t: Person | null, id: string, ok: boolean): boolean {
    if (!t) return false;
    if (id === 'social.challenge_duel') {
      this.state.lastDuel[pair(p.id, t.id)] = this.host.day();
      if (ok) this.duel(p, t);
      else this.refuse(t, p);
      return true;
    }
    if (id === 'social.punch') {
      if (this.brawlEligible(p, t)) this.brawl(p, t);
      return true;
    }
    return false;
  }

  /** 사건 카드 flag: duel_accepted (결투 신청 카드 수락), crime_assault_risk (여관 주먹다짐 카드) */
  onCardFlag(p: Person, flag: string): boolean {
    const H = this.host;
    if (flag === 'duel_accepted') {
      const pend = this.state.pending[p.id];
      if (!pend) return false;
      delete this.state.pending[p.id];
      const a = this.byId(pend.from);
      if (a) this.duel(a, p);
      return true;
    }
    if (flag === 'crime_assault_risk') {
      const J = H.justice();
      J?.noteCommitted('assault');
      const patrol = (J?.d.crimes.assault.patrol ?? 0.15) * (H.policy()?.detectMult() ?? 1);
      if (J && H.rng.next() < patrol) J.summaryFine(p, 'assault', this.d.brawl.fineShare);
      return true;
    }
    return false;
  }

  gates(): Record<string, (p: Person, t: Person | null) => boolean> {
    return {
      can_duel: (p, t) => !!t && this.canChallenge(p, t),
      has_grudge_on: (p, t) => !!t && this.hasGrudge(p, t),
    };
  }

  flags(p: Person): Set<string> {
    const out = new Set<string>();
    for (const k of Object.keys(this.state.grudges)) {
      const [a, b] = k.split(':').map(Number);
      const qa = this.byId(a);
      const qb = this.byId(b);
      if (qa?.household === p.household || qb?.household === p.household) out.add('has_feud');
      if (a === p.id) out.add('holds_grudge');
    }
    if (this.state.pending[p.id]) out.add('duel_challenged');
    return out;
  }

  forget(id: number): void {
    for (const k of Object.keys(this.state.grudges)) {
      const [a, b] = k.split(':').map(Number);
      if (a === id || b === id) delete this.state.grudges[k];
    }
    delete this.state.pending[id];
  }

  hashParts(out: (string | number)[]): void {
    out.push(JSON.stringify(this.state.grudges), JSON.stringify(this.state.pending), this.stats.duels, this.stats.brawls);
  }
}
