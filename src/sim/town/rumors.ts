/**
 * 소문 네트워크 (GDD 14-6, 18-1 장소별 전파 배수).
 * 소문 = {대상 인물/가문, 내용 종류, 진실 여부, 좋음/나쁨, 세기, 퍼진 사람 목록}.
 * 전파: LOD 와 상관없이 장소별 하루 접촉 수 기반 확률 전파를 하루 1회 계산.
 *   장소 v 에 그날 들른 N명 중 아는 사람이 k명(수다쟁이는 2명 몫)이면, 모르는 사람 각자
 *   P = 1 − (1 − p)^(그 사람의 하루 접촉 수 × k / N), p = 기본 × 장소 배수 × 소문 세기.
 *   집은 저녁 시간의 식구끼리만. 전체 LOD 인물의 실제 대화는 추가 전파 (talk).
 * 목표 (29-1): 큰 추문이 인구 절반에 3~7일.
 * 효과는 호스트가 처리 (듣는 사람의 대상에 대한 존중/우정, 가문 명예). 자기 가문 소문은 누군가 전해 줘야 앎 (aware).
 */
import type { Rng } from '../core/rng';
import type { Person } from '../people/person';
import type { Town } from './town';

export interface RumorKindDef {
  /** 좋은 소문 (선행, 걸작, 기적) / 나쁜 소문 (불륜, 도둑질, 망신) */
  good: boolean;
  /** 평판 무게: 0 이면 소식일 뿐 (혼인, 출생, 죽음). 존중·명예 변화 배수 */
  rep: number;
  /** 기본 세기 (전파 확률 배수) */
  strength: number;
}

export interface RumorData {
  base: number;
  /** 집 저녁 식구끼리 장소 배수 */
  householdEvening: number;
  eveningHours?: [number, number];
  /** 한 장소에 머문 한 시간당 접촉 수, 장소 하루 접촉 상한 */
  contactsPerHour: number;
  maxContactsPerDay: number;
  /** 수다쟁이 전하는 쪽 배수 (2) */
  gossipMult: number;
  gossipTraits: string[];
  /** 세기 하루 감쇠, 더 큰 소문에 덮이면 추가 감쇠, 이 세기 밑이면 잊힘 */
  decayPerDay: number;
  coverDecay: number;
  forgetStrength: number;
  forgetDays: number;
  /** 대화 한 번의 추가 전파 확률 (험담 상호작용, 그 밖의 대화) */
  talkGossip: number;
  talkOther: number;
  /** 퍼진 비율 문턱: 넘을 때마다 가문 명예 변화 */
  reachSteps: number[];
  kinds: Record<string, RumorKindDef>;
  /** 들은 사람의 대상에 대한 존중/우정 변화, 퍼짐 문턱마다 가문 명성, 나쁜 소문 교회 평판 */
  hear?: { respect: number; friendship: number; fameStep: number; churchBad: number };
  /** 옛 형식 호환 (쓰지 않음) */
  maxPairsPerPlace?: number;
}

export interface Rumor {
  id: number;
  kind: string;
  /** 소문의 주인공 (인물 id) */
  subjects: number[];
  /** 주인공 가문 */
  household: number;
  args: Record<string, string | number>;
  day: number;
  /** 진실 여부 (거짓 소문은 교활/심술 인물이 퍼뜨림) */
  truth: boolean;
  good: boolean;
  /** 평판 무게 (0 이면 소식) */
  rep: number;
  /** 세기: 전파 확률 배수. 날마다 약해짐 */
  strength: number;
  /** 처음 퍼뜨린 사람 (따지기 대상, 0 = 목격/소식) */
  origin: number;
  knownBy: Set<number>;
  /** 주인공 가문 식구 중 누군가에게 전해 들어 이 소문을 아는 사람 */
  aware: Set<number>;
  /** 넘은 퍼짐 문턱 수 */
  reached: number;
  /** 처음부터 알던 주인공 가문 식구 (나중에 분가·출가해도 나쁜 소문을 퍼뜨리지 않음) */
  insiders: Set<number>;
  /** 인구 절반이 안 날 (측정) */
  halfDay: number | null;
}

export interface RumorHost {
  /** 소문을 새로 들음 (sign = -1 이면 해명으로 되돌림) */
  onHear?(r: Rumor, listener: Person, sign: 1 | -1): void;
  /** 퍼짐 문턱을 넘음 (가문 명예) */
  onReach?(r: Rumor, frac: number): void;
  /** 주인공 가문 식구가 자기 가문 소문을 전해 들음 */
  onAware?(r: Rumor, p: Person): void;
}

const EMPTY: RumorKindDef = { good: false, rep: 0, strength: 1 };

export class Rumors {
  readonly list: Rumor[] = [];
  private nextId = 1;
  /** 오늘 장소별 머문 시간 (장소 → 인물 → 시간) */
  private visits = new Map<string, Map<Person, number>>();
  private d: RumorData;

  constructor(private rng: Rng, s: Partial<RumorData> & { base: number }, private town: Town, private host: RumorHost = {}) {
    this.d = {
      householdEvening: 2,
      contactsPerHour: 2,
      maxContactsPerDay: 12,
      gossipMult: 2,
      gossipTraits: ['gossip'],
      decayPerDay: 0.92,
      coverDecay: 0.75,
      forgetStrength: 0.12,
      forgetDays: 21,
      talkGossip: 0.6,
      talkOther: 0.08,
      reachSteps: [0.25, 0.5],
      kinds: {},
      ...s,
    } as RumorData;
  }

  kind(kind: string): RumorKindDef {
    return this.d.kinds[kind] ?? EMPTY;
  }

  /**
   * 새 소문. juicy = 세기 배수 (종류 기본 세기에 곱함). knownBy = 처음부터 아는 사람 (주인공, 목격자, 퍼뜨린 사람).
   * 주인공 가문 식구가 처음부터 아는 것은 "소문이 났다"는 걸 아는 게 아님 (aware 는 전해 들어야)
   */
  add(
    kind: string,
    subjects: Person[],
    args: Record<string, string | number>,
    day: number,
    juicy = 1,
    knownBy: Person[] = subjects,
    opt: { truth?: boolean; good?: boolean; origin?: number; household?: number } = {},
  ): Rumor {
    const k = this.kind(kind);
    const household = opt.household ?? subjects[0]?.household ?? 0;
    const r: Rumor = {
      id: this.nextId++,
      kind,
      subjects: subjects.map((p) => p.id),
      household,
      args,
      day,
      truth: opt.truth ?? true,
      good: opt.good ?? k.good,
      rep: k.rep,
      strength: k.strength * juicy,
      origin: opt.origin ?? 0,
      knownBy: new Set(knownBy.map((p) => p.id)),
      aware: new Set(),
      reached: 0,
      insiders: new Set(knownBy.filter((p) => p.household === household || subjects.includes(p)).map((p) => p.id)),
      halfDay: null,
    };
    // 더 큰 소문이 덮음 (14-6 소멸): 같은 가문의 약한 소문은 빨리 잊힘
    for (const o of this.list) if (o.household === household && o.strength < r.strength) o.strength *= this.d.coverDecay;
    this.list.push(r);
    if (this.list.length > 160) this.list.shift();
    return r;
  }

  /** 한 시간마다: 누가 어느 장소에 있었는지 기록 (집은 저녁 식구끼리만) */
  hourly(persons: Person[], hour: number, day: number): void {
    if (!this.list.length) return;
    const [e0, e1] = this.d.eveningHours ?? [19, 21];
    const evening = hour >= e0 && hour < e1;
    for (const p of persons) {
      if (p.infant || p.lifeStage === 'baby' || p.lifeStage === 'toddler') continue;
      // 세밀도와 무관: 모든 인물을 일과표상 장소로 셈 (전체 LOD 인물의 실제 대화는 talk 로 추가 전파)
      const place = p.household > 0 ? this.town.schedulePlace(p, day * 1440 + hour * 60) : p.place;
      if (!place) continue;
      if (place.startsWith('home:') && !evening) continue;
      let m = this.visits.get(place);
      if (!m) {
        m = new Map();
        this.visits.set(place, m);
      }
      m.set(p, (m.get(p) ?? 0) + 1);
    }
  }

  /** 전할 수 있는 사람: 아는 사람. 단 나쁜 평판 소문은 주인공 가문 식구가 퍼뜨리지 않음 */
  private canTell(r: Rumor, p: Person): boolean {
    return r.knownBy.has(p.id) && (r.good || !r.rep || (p.household !== r.household && !r.insiders.has(p.id)));
  }

  /** 새로 들을 수 있는 사람: 모르는 사람, 또는 아직 전해 듣지 못한 주인공 가문 식구 */
  private canHear(r: Rumor, p: Person): boolean {
    return p.household === r.household ? !r.aware.has(p.id) : !r.knownBy.has(p.id);
  }

  private teller(p: Person): number {
    return p.traits.some((t) => this.d.gossipTraits.includes(t)) ? this.d.gossipMult : 1;
  }

  /** 자정: 어제 장소 접촉으로 전파, 퍼짐 문턱, 감쇠·잊힘 */
  daily(day: number, persons?: Person[]): void {
    if (persons && this.list.length) this.spread(persons, day);
    this.visits.clear();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      r.strength *= this.d.decayPerDay;
      if (r.strength < this.d.forgetStrength || day - r.day > this.d.forgetDays) this.list.splice(i, 1);
    }
  }

  private spread(persons: Person[], day: number): void {
    for (const [place, m] of this.visits) {
      const N = m.size;
      if (N < 2) continue;
      const mult = place.startsWith('home:') ? this.d.householdEvening : this.town.place(place)?.spread ?? 1;
      for (const r of this.list) {
        // 이 장소에 들른 아는 사람 (수다쟁이 2명 몫). 어제 시작 기준 (오늘 들은 사람은 내일부터 전함)
        let k = 0;
        for (const p of m.keys()) if (this.canTell(r, p)) k += this.teller(p);
        if (!k) continue;
        const pr = Math.min(0.9, this.d.base * mult * r.strength);
        const fresh: Person[] = [];
        for (const [p, hours] of m) {
          if (!this.canHear(r, p)) continue;
          const c = Math.min(this.d.maxContactsPerDay, hours * this.d.contactsPerHour);
          const kOthers = this.canTell(r, p) ? k - this.teller(p) : k;
          if (kOthers <= 0) continue;
          const P = 1 - Math.pow(1 - pr, (c * kOthers) / N);
          if (this.rng.next() < P) fresh.push(p);
        }
        for (const p of fresh) this.hear(r, p);
      }
    }
    this.measure(persons.length, day);
  }

  private hear(r: Rumor, p: Person): void {
    if (p.household === r.household) {
      if (!r.aware.has(p.id)) {
        r.aware.add(p.id);
        r.knownBy.add(p.id);
        this.host.onAware?.(r, p);
      }
      return;
    }
    if (r.knownBy.has(p.id)) return;
    r.knownBy.add(p.id);
    this.host.onHear?.(r, p, 1);
  }

  private measure(n: number, day: number): void {
    for (const r of this.list) {
      const frac = r.knownBy.size / Math.max(1, n);
      if (r.halfDay === null && frac >= 0.5) r.halfDay = day - r.day;
      while (r.reached < this.d.reachSteps.length && frac >= this.d.reachSteps[r.reached]) {
        r.reached++;
        if (r.rep) this.host.onReach?.(r, this.d.reachSteps[r.reached - 1]);
      }
    }
  }

  /** 실제 대화의 추가 전파 (전체 LOD): 험담이면 높은 확률, 그 밖의 대화는 낮게. 양쪽 방향 */
  talk(a: Person, b: Person, gossip: boolean): void {
    const base = gossip ? this.d.talkGossip : this.d.talkOther;
    for (const r of this.list) {
      for (const [x, y] of [[a, b], [b, a]] as const) {
        if (!this.canTell(r, x) || !this.canHear(r, y)) continue;
        if (this.rng.next() < Math.min(0.95, base * r.strength)) this.hear(r, y);
        break;
      }
    }
  }

  /** 해명하기 (14-6 대응): 듣는 사람이 소문을 믿지 않게 됨 (거짓 소문이면 더 잘 먹힘). 성공하면 효과를 되돌림 */
  explain(r: Rumor, listener: Person, chance: number): boolean {
    if (!r.knownBy.has(listener.id) || listener.household === r.household) return false;
    if (this.rng.next() >= Math.min(0.95, chance * (r.truth ? 0.6 : 1.4))) return false;
    r.knownBy.delete(listener.id);
    this.host.onHear?.(r, listener, -1);
    return true;
  }

  /** 소문 낸 사람 찾아가 따지기: 그 사람이 더 퍼뜨리지 않음 + 세기 반감 */
  confront(r: Rumor): void {
    r.strength *= 0.5;
  }

  /** 교회에서 공개 참회: 가문의 나쁜 소문이 크게 약해짐 */
  penance(household: number): Rumor[] {
    const hit: Rumor[] = [];
    for (const r of this.list) if (r.household === household && !r.good && r.rep > 0) {
      r.strength *= 0.3;
      hit.push(r);
    }
    return hit;
  }

  /** 이 사람이 아는 나쁜 소문 중 가장 센 것 (가문 대상) */
  strongestAbout(household: number, knower: Person | null = null, good = false): Rumor | null {
    let best: Rumor | null = null;
    for (const r of this.list) {
      if (r.household !== household || r.good !== good || !r.rep) continue;
      if (knower && !r.knownBy.has(knower.id)) continue;
      if (!best || r.strength > best.strength) best = r;
    }
    return best;
  }

  /** 우리 가문 관련 소문 중 식구가 전해 들은 것 (마을 소문 패널, 14-6) */
  knownToHousehold(household: number): Rumor[] {
    return this.list.filter((r) => r.household === household && r.aware.size > 0);
  }

  /** 사람이 떠나면 */
  forget(id: number): void {
    for (const r of this.list) {
      r.knownBy.delete(id);
      r.aware.delete(id);
    }
  }

  hashParts(parts: (string | number)[]): void {
    for (const r of this.list) parts.push(r.id, r.kind, r.knownBy.size, r.aware.size, r.strength.toFixed(3), r.reached);
  }
}
