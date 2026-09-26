/**
 * 관계 (GDD 14-1, 14-2): 인물 쌍마다 우정(-100~100), 로맨스(0~100), 존중(-100~100, 사람마다 방향이 있음).
 * 우정/로맨스는 양방향 공유, 존중은 "a 가 b 를 어떻게 보나"(방향 있음).
 * 관계 이름은 수치와 사건 표식으로 정해짐. 자연 감소는 하루 한 번.
 */

export interface RelationRules {
  decayPerDay: { friendship: number; romance: number };
  /** 가족 중심(우정)·낭만적(배우자/연인 로맨스) 감소 배수 */
  familyFriendshipDecayMult: number;
  romanticDecayMult: number;
  names: { enemy: number; rival: number; friend: number; bestFriend: number; bestFriendMemories: number; loverRomance: number };
  firstImpression: {
    friendship: [number, number];
    respect: [number, number];
    estateRespectPerStep: number;
    hygienePenaltyBelow: number;
    hygienePenalty: number;
    traitPairs: Array<{ a: string; b: string; friendship: number }>;
  };
}

export interface Relation {
  /** 작은 id 쪽이 a */
  a: number;
  b: number;
  friendship: number;
  romance: number;
  /** a→b, b→a 존중 */
  respectAB: number;
  respectBA: number;
  met: boolean;
  lastDay: number;
  sharedMemories: number;
  /** 사건 표식: lover, engaged, spouse, ex_spouse, mentor … */
  flags: Set<string>;
  /** 오늘 상호작용 횟수 (자율 반복 억제) */
  today: number;
}

export const ESTATE_RANK: Record<string, number> = { serf: 0, freeman: 1, artisan: 2, merchant: 3, clergy: 3, knight: 4, noble: 5 };

export class Relations {
  private map = new Map<number, Relation>();

  constructor(private rules: RelationRules) {}

  private key(a: number, b: number): number {
    // 2^21 (인물 id 200만까지 충돌 없음, 2^53 안)
    return a < b ? a * 2097152 + b : b * 2097152 + a;
  }

  get(a: number, b: number): Relation | undefined {
    return this.map.get(this.key(a, b));
  }

  /** 없으면 만듦 (만난 적 없음 상태) */
  ensure(a: number, b: number): Relation {
    const k = this.key(a, b);
    let r = this.map.get(k);
    if (!r) {
      r = { a: Math.min(a, b), b: Math.max(a, b), friendship: 0, romance: 0, respectAB: 0, respectBA: 0, met: false, lastDay: -1, sharedMemories: 0, flags: new Set(), today: 0 };
      this.map.set(k, r);
    }
    return r;
  }

  friendship(a: number, b: number): number {
    return this.get(a, b)?.friendship ?? 0;
  }

  romance(a: number, b: number): number {
    return this.get(a, b)?.romance ?? 0;
  }

  /** from 이 to 를 어떻게 보나 */
  respect(from: number, to: number): number {
    const r = this.get(from, to);
    if (!r) return 0;
    return from === r.a ? r.respectAB : r.respectBA;
  }

  addRespect(from: number, to: number, d: number): void {
    const r = this.ensure(from, to);
    if (from === r.a) r.respectAB = clamp(r.respectAB + d, -100, 100);
    else r.respectBA = clamp(r.respectBA + d, -100, 100);
  }

  change(a: number, b: number, d: { friendship?: number; romance?: number; respect?: number }, day: number): Relation {
    const r = this.ensure(a, b);
    if (d.friendship) r.friendship = clamp(r.friendship + d.friendship, -100, 100);
    if (d.romance) r.romance = clamp(r.romance + d.romance, 0, 100);
    if (d.respect) {
      // 상호작용의 존중 변화는 서로에게 (상대가 나를 어떻게 보나가 주로 바뀜) → 양쪽에 같게
      r.respectAB = clamp(r.respectAB + d.respect, -100, 100);
      r.respectBA = clamp(r.respectBA + d.respect, -100, 100);
    }
    r.lastDay = day;
    r.today++;
    return r;
  }

  /** 관계 이름 (14-1 표) */
  name(a: number, b: number): string {
    const r = this.get(a, b);
    if (!r || !r.met) return 'stranger';
    const n = this.rules.names;
    for (const f of ['spouse', 'engaged', 'ex_spouse', 'lover']) if (r.flags.has(f)) return f;
    if (r.friendship <= n.enemy) return 'enemy';
    if (r.friendship <= n.rival) return 'rival';
    if (r.friendship >= n.bestFriend && r.sharedMemories >= n.bestFriendMemories) return 'best_friend';
    if (r.friendship >= n.friend) return 'friend';
    return 'acquaintance';
  }

  /** 하루 한 번: 0 쪽으로 자연 감소 (14-1). family(a,b) 이면 가족, romanticOf(id) 이면 낭만적 */
  decayDaily(family: (a: number, b: number) => boolean, hasTrait: (id: number, t: string) => boolean, lifespanMult = 1): void {
    const dr = this.rules.decayPerDay;
    for (const r of this.map.values()) {
      r.today = 0;
      if (!r.met) continue;
      let fd = dr.friendship / lifespanMult;
      if (family(r.a, r.b) && (hasTrait(r.a, 'family_oriented') || hasTrait(r.b, 'family_oriented'))) fd *= this.rules.familyFriendshipDecayMult;
      if (r.friendship > 0) r.friendship = Math.max(0, r.friendship - fd);
      else if (r.friendship < 0) r.friendship = Math.min(0, r.friendship + fd);
      let rd = dr.romance / lifespanMult;
      const partner = r.flags.has('spouse') || r.flags.has('lover') || r.flags.has('engaged');
      if (partner && (hasTrait(r.a, 'romantic') || hasTrait(r.b, 'romantic'))) rd *= this.rules.romanticDecayMult;
      r.romance = Math.max(0, r.romance - rd);
    }
  }

  all(): IterableIterator<Relation> {
    return this.map.values();
  }

  /** 결정론 해시용 */
  hashParts(out: (string | number)[]): void {
    const keys = [...this.map.keys()].sort((x, y) => x - y);
    for (const k of keys) {
      const r = this.map.get(k)!;
      out.push(k, r.friendship.toFixed(3), r.romance.toFixed(3), r.respectAB.toFixed(3), r.respectBA.toFixed(3), r.met ? 1 : 0, [...r.flags].sort().join(','));
    }
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export interface ImpressionInput {
  estateA: string;
  estateB: string;
  hygieneA: number;
  hygieneB: number;
  traitsA: string[];
  traitsB: string[];
  /** 옷차림이 신분에 맞는가 (M8 사치 금지법: 지금은 늘 맞음) */
  dressOkA: boolean;
  dressOkB: boolean;
  /** 선천 외모 (M7): 미남미녀 +, 추남추녀 − */
  looksA: number;
  looksB: number;
  /** 소문 평판 (M9): −1 ~ 1 */
  reputationA: number;
  reputationB: number;
}

/**
 * 첫인상 (14-2): 시작 우정 −20~20, 존중 −30~30 (a→b, b→a).
 * 난수 r 은 0~1 두 개 (결정론: 호출하는 쪽의 시드 RNG)
 */
export function firstImpression(rules: RelationRules, i: ImpressionInput, r1: number, r2: number): { friendship: number; respectAB: number; respectBA: number } {
  const fi = rules.firstImpression;
  let f = (r1 - 0.5) * 16;
  for (const p of fi.traitPairs) {
    const ab = i.traitsA.includes(p.a) && i.traitsB.includes(p.b);
    const ba = i.traitsA.includes(p.b) && i.traitsB.includes(p.a);
    if (ab || ba) f += p.friendship;
  }
  if (i.hygieneA < fi.hygienePenaltyBelow) f -= fi.hygienePenalty;
  if (i.hygieneB < fi.hygienePenaltyBelow) f -= fi.hygienePenalty;
  f += (i.looksA + i.looksB) * 3 + (i.reputationA + i.reputationB) * 5;
  const diff = (ESTATE_RANK[i.estateB] ?? 1) - (ESTATE_RANK[i.estateA] ?? 1);
  // a 는 신분이 높은 b 를 우러러봄 (+), 낮은 b 는 얕봄 (−). 옷차림이 맞지 않으면 깎임
  let rab = diff * fi.estateRespectPerStep + (r2 - 0.5) * 10 + (i.dressOkB ? 0 : -8) + i.reputationB * 8;
  let rba = -diff * fi.estateRespectPerStep + (r2 - 0.5) * 10 + (i.dressOkA ? 0 : -8) + i.reputationA * 8;
  rab = clamp(rab, fi.respect[0], fi.respect[1]);
  rba = clamp(rba, fi.respect[0], fi.respect[1]);
  return { friendship: clamp(f, fi.friendship[0], fi.friendship[1]), respectAB: rab, respectBA: rba };
}

export interface SuccessInput {
  base: number;
  friendship: number;
  romance: number;
  respectTargetToActor: number;
  romanceCategory: boolean;
  storytelling: number;
  emotionMod: number;
  traitMod: number;
  estateMod: number;
  moodMod: number;
}

/** 성공 확률 (14-3): 5% ~ 95% */
export function successChance(s: SuccessInput): number {
  const p = s.base + s.friendship * 0.3 + (s.romanceCategory ? s.romance * 0.4 : 0) + s.respectTargetToActor * 0.2 + s.storytelling * 3 + s.emotionMod + s.traitMod + s.estateMod + s.moodMod;
  return clamp(p, 5, 95);
}
