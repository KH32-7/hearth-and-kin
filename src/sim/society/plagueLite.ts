/**
 * 간이 역병 전파 (GDD 29-1 역병 곡선, 18-4 역병 대응 정책). M11 전체 질병 체계(20-2)가 들어오면 이 모듈을 대체함.
 * - SEIR: 잠복(E) → 앓음(I, 전파) → 회복(R) 또는 사망. 사망은 host.kill(p, 'illness') (사망 설정 행렬 20-7 존중, 꺼져 있으면 중환 뒤 회복)
 * - 전파는 소문(town/rumors.ts)과 같은 방식: 일과표 장소별 하루 접촉. 장소 v 에 그날 들른 N명 중 앓는 사람이 k명이면
 *   걸릴 수 있는 사람 각자 P = 1 − (1 − β × 장소 배수)^(그 사람 하루 접촉 수 × k / N). 집은 식구끼리 P = 1 − (1 − β집)^(앓는 식구 수)
 * - 정책 (역병 대응): 격리 = 앓는 집 식구 모두 집에 묶고 공공 장소에 덜 나감, 봉쇄 = 더 적게 나가고 외부에서 새 유행이 덜 들어옴.
 *   유행 중에만 효과 (평소에는 명령만 있음). 장터 거래량도 여기서 셈 (장터에 머문 사람-시간 × 거래 배수)
 * - 목표 (정책 "없음"): 발병률 20~40%, 첫 환자부터 정점 3~6일, 유행 7~14일, 치명률 15~35%
 * 무작위는 생성자 rng 만 (사람마다 하루 두 번은 정책과 무관하게 뽑음). 렌더러/DOM 없음
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import type { Person } from '../people/person';
import type { DeathRulesView } from '../health/deathRules';
import { durDays, durSchema, perLifeDaily, stripDollar, type PolicyEffects } from './policy';

export const plagueSchema = z.object({
  outbreak: durSchema,
  lockdownImportMult: z.number(),
  /** 유행이 끝난 뒤에도 격리/봉쇄 명령이 남는 기간 (40일 격리의 간이판) */
  orderTail: durSchema,
  seedCases: z.number().int().min(1),
  hours: z.tuple([z.number().int(), z.number().int()]),
  contactsPerHour: z.number(),
  maxContactsPerDay: z.number(),
  beta: z.number(),
  homeBeta: z.number(),
  placeMult: z.record(z.string(), z.number()),
  resistShare: z.number(),
  latent: durSchema,
  sickMin: durSchema,
  sickMax: durSchema,
  sickStayHome: z.number(),
  cfr: z.number(),
  cfrStage: z.record(z.string(), z.number()),
  cfrTraits: z.record(z.string(), z.number()),
  fallbackDays: durSchema,
  marketKinds: z.array(z.string()),
  moodlets: z.object({ sick: z.string(), fear: z.string(), confined: z.string(), recovered: z.string().nullable() }),
}).loose();
export type PlagueData = z.infer<typeof plagueSchema>;

/** SimData.family.policy (policy.json 원본) 의 plague 칸 */
export function parsePlague(raw: unknown): PlagueData | null {
  const r = (raw as { plague?: unknown } | null | undefined)?.plague;
  return r ? plagueSchema.parse(stripDollar(r)) : null;
}

export interface PlagueHost {
  readonly persons: readonly Person[];
  day(): number;
  lifespan(): number;
  seasonDays(): number;
  controlled(household: number): boolean;
  /** 일과표상 장소 (Town.schedulePlace): "home:<가구>", 공공 장소 id, 또는 null (길·부지 밖) */
  placeAt(p: Person, minute: number): string | null;
  /** 공공 장소 종류 (market, inn …). 모르면 null */
  placeKind(placeId: string): string | null;
  /** 정책 효과 (LordPolicy). 없으면 정책 없음 */
  policy(): PolicyEffects | null;
  deathRules(): DeathRulesView | null;
  /** 죽음 (사망 설정은 호출 전에 이 모듈이 봄). 원인 'illness', 세부 'plague' */
  kill(p: Person, cause: 'illness', sub: string): void;
  /** 사망이 꺼진 칸의 대체 (20-7): 중환(무력 days 일) 뒤 회복 + "죽을 고비" 기억 */
  incapacitate(p: Person, days: number): void;
  memory(p: Person, kind: string, importance: number, valence: number): void;
  moodlet(p: Person, id: string): void;
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
  news(kind: string, args: Record<string, string | number>, subjects: Person[]): void;
  chronicle(trigger: string, subjects: Person[], args?: Record<string, string | number>): void;
  /** 소식에 쓸 장소 이름 키 */
  placeName?(placeId: string): string;
}

export type SeirState = 'E' | 'I' | 'R';

export interface Infection {
  s: SeirState;
  /** 이 상태가 된 날 */
  since: number;
  /** 앓는 기간 (일) */
  sickDays: number;
}

export interface Outbreak {
  startDay: number;
  pop: number;
  infected: number;
  deaths: number;
  /** 날별 새 환자 (앓기 시작, 증상) */
  daily: number[];
  firstSickDay: number | null;
  /** 새 환자가 가장 많았던 날과 그 수 */
  peakDay: number | null;
  peakN: number;
  endDay: number | null;
  where: string | null;
}

export interface PlagueStats {
  outbreaks: Outbreak[];
  /** 날별 장터 거래량 (장터 머문 사람-시간 × 거래 배수) */
  marketByDay: number[];
  /** 날별 앓는 사람 수 */
  sickByDay: number[];
}

export class PlagueLite {
  readonly inf = new Map<number, Infection>();
  /** 이번 유행에서 걸리지 않는 사람 (면역·체질) */
  readonly resist = new Set<number>();
  active: Outbreak | null = null;
  /** 마지막 유행이 끝난 날 (격리 명령 꼬리) */
  lastEnd = -1e9;
  readonly stats: PlagueStats = { outbreaks: [], marketByDay: [], sickByDay: [] };

  constructor(private host: PlagueHost, private rng: Rng, readonly d: PlagueData) {}

  /** 걸림/앓음 */
  state(p: Person): SeirState | 'S' {
    return this.inf.get(p.id)?.s ?? 'S';
  }

  isSick(p: Person): boolean {
    return this.inf.get(p.id)?.s === 'I';
  }

  /** 역병 대응 명령이 효력 중인가: 유행 중이거나 끝난 뒤 orderTail 안 */
  orderActive(day = this.host.day()): boolean {
    if (this.active) return true;
    return day - this.lastEnd <= durDays(this.d.orderTail, this.host.lifespan(), this.host.seasonDays());
  }

  /** 장터 거래량 배수 (경제 훅: 가게·교역 판매에 곱함). 명령이 없으면 역병 정책을 뺀 배수 */
  tradeMult(): number {
    return this.host.policy()?.marketTradeMult(this.orderActive()) ?? 1;
  }

  /** 유행 시작 (도구·테스트·사건이 부름). 아무나 n 명이 잠복기로 */
  seed(n = this.d.seedCases, where: string | null = null): Outbreak {
    const H = this.host;
    const day = H.day();
    if (!this.active) {
      this.active = { startDay: day, pop: H.persons.length, infected: 0, deaths: 0, daily: [], firstSickDay: null, peakDay: null, peakN: 0, endDay: null, where };
      this.stats.outbreaks.push(this.active);
      this.resist.clear();
      for (const p of H.persons) if (this.rng.next() < this.d.resistShare) this.resist.add(p.id);
      for (const p of H.persons) if (p.lifeStage !== 'baby' && p.lifeStage !== 'toddler' && H.controlled(p.household)) H.moodlet(p, this.d.moodlets.fear);
      H.news('plague_start', { place: where && H.placeName ? H.placeName(where) : 'place.market' }, []);
    }
    const pool = H.persons.filter((p) => !this.inf.has(p.id) && !this.resist.has(p.id));
    for (let i = 0; i < n && pool.length; i++) {
      const j = Math.floor(this.rng.next() * pool.length);
      this.infect(pool[j], day);
      pool.splice(j, 1);
    }
    return this.active;
  }

  private infect(p: Person, day: number): void {
    this.inf.set(p.id, { s: 'E', since: day, sickDays: 0 });
    if (this.active) this.active.infected++;
  }

  /**
   * 자정 한 번 (방금 끝난 날 day): 어제 일과표 장소 접촉으로 전파 → 상태 진행 → 유행 시작/끝 판정 → 기록.
   * 새 유행 판정은 per_life (보통 한 인생 0.4회)
   */
  daily(day: number): void {
    const H = this.host;
    const D = this.d;
    const pol = H.policy();
    // 정책 효과는 명령이 효력 중일 때 (유행 중 + 꼬리)
    const active = this.orderActive(day);
    const [h0, h1] = D.hours;
    const persons = H.persons;
    const sickHome = new Set<number>();
    for (const p of persons) if (this.isSick(p)) sickHome.add(p.household);
    // 1) 장소 방문 (공공 장소만. 집은 식구끼리 따로)
    const visits = new Map<string, Map<Person, number>>();
    let market = 0;
    const tradeM = pol ? pol.marketTradeMult(active) : 1;
    for (const p of persons) {
      const uOut = this.rng.next();
      const uStay = this.rng.next();
      const uObey = this.rng.next();
      const sick = this.isSick(p);
      const obey = !!pol && uObey < pol.confineCompliance();
      let confined = false;
      if (sick && (uStay < D.sickStayHome || (active && obey && pol?.confineSick()))) confined = true;
      if (active && obey && pol?.confineHousehold() && sickHome.has(p.household)) confined = true;
      if (confined) continue;
      for (let h = h0; h < h1; h++) {
        const pl = H.placeAt(p, day * 1440 + h * 60);
        if (!pl || pl.startsWith('home:')) continue;
        const kind = H.placeKind(pl) ?? pl;
        // 유행 중 공공 장소를 피함 (정책 배수 = 그래도 나가는 비율)
        if (active && pol && uOut >= pol.plagueContactMult(kind)) continue;
        let m = visits.get(pl);
        if (!m) visits.set(pl, (m = new Map()));
        m.set(p, (m.get(p) ?? 0) + 1);
        if (D.marketKinds.includes(kind)) market += 1;
      }
    }
    this.stats.marketByDay.push(+(market * tradeM).toFixed(2));
    const fresh: Person[] = [];
    if (this.inf.size) {
      // 2) 공공 장소 전파
      for (const [pl, m] of visits) {
        const N = m.size;
        if (N < 2) continue;
        let k = 0;
        for (const p of m.keys()) if (this.isSick(p)) k++;
        const kind = H.placeKind(pl) ?? pl;
        const pr = Math.min(0.9, D.beta * (D.placeMult[kind] ?? 1));
        for (const [p, hours] of m) {
          if (this.state(p) !== 'S' || this.resist.has(p.id)) continue;
          const u = this.rng.next();
          if (!k) continue;
          const c = Math.min(D.maxContactsPerDay, hours * D.contactsPerHour);
          const P = 1 - Math.pow(1 - pr, (c * k) / N);
          if (u < P) fresh.push(p);
        }
      }
      // 3) 집 (식구끼리)
      const sickIn = new Map<number, number>();
      for (const p of persons) if (this.isSick(p)) sickIn.set(p.household, (sickIn.get(p.household) ?? 0) + 1);
      for (const p of persons) {
        if (this.state(p) !== 'S' || this.resist.has(p.id)) continue;
        const n = sickIn.get(p.household) ?? 0;
        if (!n) continue;
        if (this.rng.next() < 1 - Math.pow(1 - D.homeBeta, n)) fresh.push(p);
      }
    }
    // 4) 진행: 잠복 → 앓음, 앓음 → 회복/사망
    const L = H.lifespan();
    const SD = H.seasonDays();
    const latent = Math.max(1, Math.round(durDays(D.latent, L, SD)));
    const byId = new Map(persons.map((p) => [p.id, p]));
    let newSick = 0;
    for (const [id, f] of [...this.inf]) {
      const p = byId.get(id);
      if (!p) {
        this.inf.delete(id);
        continue;
      }
      if (f.s === 'E' && day - f.since + 1 >= latent) {
        const lo = durDays(D.sickMin, L, SD);
        const hi = durDays(D.sickMax, L, SD);
        f.s = 'I';
        f.since = day;
        f.sickDays = Math.max(1, Math.round(lo + (hi - lo) * this.rng.next()));
        newSick++;
        H.moodlet(p, D.moodlets.sick);
        if (H.controlled(p.household)) H.notice(p, 'plague_sick', { a: p.name });
      } else if (f.s === 'I' && day - f.since >= f.sickDays) {
        const u = this.rng.next();
        if (u < this.deathChance(p)) this.die(p);
        else {
          f.s = 'R';
          f.since = day;
          if (D.moodlets.recovered) H.moodlet(p, D.moodlets.recovered);
        }
      }
    }
    for (const p of fresh) if (!this.inf.has(p.id)) this.infect(p, day);
    // 5) 유행 기록/끝
    if (this.active) {
      const o = this.active;
      o.daily.push(newSick);
      if (newSick > 0 && o.firstSickDay === null) o.firstSickDay = day;
      if (newSick > o.peakN) {
        o.peakN = newSick;
        o.peakDay = day;
      }
      const any = [...this.inf.values()].some((f) => f.s === 'E' || f.s === 'I');
      if (!any) {
        o.endDay = day;
        this.active = null;
        this.lastEnd = day;
        H.news('plague_end', {}, []);
        // 회복한 사람의 면역은 다음 유행까지 (R 은 지움: M11 전체 질병 체계 전까지 간이)
        this.inf.clear();
      }
    } else {
      // 새 유행 (per_life). 봉쇄 중이면 외부에서 덜 들어옴
      let pr = perLifeDaily(D.outbreak, L);
      if (pol?.tradeBlocked()) pr *= D.lockdownImportMult;
      if (this.rng.next() < pr) this.seed();
    }
    let sickNow = 0;
    for (const f of this.inf.values()) if (f.s === 'I') sickNow++;
    this.stats.sickByDay.push(sickNow);
    // 격리 무드렛 (조작 가문, 유행 중 격리/봉쇄)
    if (active && pol && (pol.confineHousehold() || pol.tradeBlocked())) {
      for (const p of persons) if (H.controlled(p.household) && p.lifeStage !== 'baby' && (sickHome.has(p.household) || pol.tradeBlocked())) H.moodlet(p, D.moodlets.confined);
    }
  }

  /** 치명률: 기본 × 생애 단계 × 특성 (허약/튼튼) */
  deathChance(p: Person): number {
    let c = this.d.cfr * (this.d.cfrStage[p.lifeStage] ?? 1);
    for (const t of p.traits) c *= this.d.cfrTraits[t] ?? 1;
    return Math.min(0.95, c);
  }

  private die(p: Person): void {
    const H = this.host;
    const f = this.inf.get(p.id);
    const dr = H.deathRules();
    const group = dr ? dr.group(p.lifeStage) : 'adult';
    const allowed = !dr || dr.allows('illness', group);
    if (allowed) {
      this.inf.delete(p.id);
      if (this.active) this.active.deaths++;
      H.kill(p, 'illness', 'plague');
      return;
    }
    // 꺼진 칸: 중환 뒤 회복 + "죽을 고비" 기억
    const days = Math.max(1, Math.round(durDays(this.d.fallbackDays, H.lifespan(), H.seasonDays())));
    H.incapacitate(p, days);
    H.memory(p, 'near_death', 4, -1);
    if (f) {
      f.s = 'R';
      f.since = H.day();
    }
  }

  /** 사람이 죽거나 떠남 (다른 원인) */
  forget(id: number): void {
    this.inf.delete(id);
    this.resist.delete(id);
  }

  /** 카드 조건 플래그 */
  flags(p: Person): Set<string> {
    const out = new Set<string>();
    if (this.active) out.add('plague_active');
    if (this.isSick(p)) out.add('plague_sick');
    return out;
  }

  /** 마지막 유행 요약 (도구·테스트): 발병률, 첫 환자→정점 일수, 유행 기간, 치명률 */
  static summary(o: Outbreak): { attack: number; peakAfter: number | null; duration: number | null; cfr: number } {
    const attack = o.pop ? o.infected / o.pop : 0;
    const peakAfter = o.peakDay !== null && o.firstSickDay !== null ? o.peakDay - o.firstSickDay : null;
    const duration = o.endDay !== null && o.firstSickDay !== null ? o.endDay - o.firstSickDay : null;
    return { attack, peakAfter, duration, cfr: o.infected ? o.deaths / o.infected : 0 };
  }

  hashParts(out: (string | number)[]): void {
    out.push(this.rng.state, this.inf.size, this.active?.infected ?? -1, this.lastEnd);
    for (const [id, f] of [...this.inf].sort((a, b) => a[0] - b[0])) out.push(id, f.s, f.since);
  }
}
