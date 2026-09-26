/**
 * 기사·귀족 영지 (GDD 17-7 영지 수입, 18-4 영주 금고, 16-2 귀족 사치 요구).
 * - 영지 수입: 소작 가구 수 × 1.5동화/일 (매일 쌓아 계절 마지막 날 정산, 가을은 일부 곡물 현물) + 장원 × 25동화/일 (추상 수입, 매일)
 *   + 녹봉 (기사) + 방앗간/장터 사용료의 50% 와 재판 벌금 (영주 가문만)
 * - 영주 금고: 가문 재산과 분리된 계정. 수입 = 세금, 사용료 나머지 50% (벌금은 finesTo 설정). 지출 = 경비병·축제·배급·전쟁 (M9)
 *   금고 → 가문 재산 = 사적 유용: 민심 −10, 가문 명성 −30, 발각되면 소문
 * - 귀족 사치 요구: 신분에 맞는 저택/옷/연회를 안 하면 명예 하락 (주기 판정)
 * 돈은 파딩 정수 (소수 이월). 수치는 estates.json fief. 무작위는 host.rng 만. 렌더러/DOM 없음
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import { durDays, stripMeta } from './estates';

const scale = z.enum(['absolute', 'season', 'lifespan', 'per_life']);
const dur = z.object({ value: z.number(), scale });
const fiefSpec = z.object({ manors: z.number().int().min(0), tenants: z.number().int().min(0), lord: z.boolean(), policy: z.boolean() });

export const fiefSchema = z.object({
  tenantPerDay: z.number(),
  manorPerDay: z.number(),
  stipend: z.record(z.string(), z.number()),
  feeShare: z.number(),
  finesTo: z.enum(['family', 'treasury']),
  autumnInKind: z.number(),
  inKindItem: z.string(),
  inKindPrice: z.number(),
  defaults: z.record(z.string(), fiefSpec),
  embezzle: z.object({ morale: z.number(), fame: z.number(), discoverChance: z.number(), rumor: z.string() }),
  luxury: z.object({
    estates: z.array(z.string()),
    checkEvery: dur,
    houseTierMin: z.number(),
    feastWithin: dur,
    outfitTierMin: z.string(),
    fame: z.object({ house: z.number(), outfit: z.number(), feast: z.number() }),
    moodlet: z.string(),
  }),
}).loose();
export type FiefData = z.infer<typeof fiefSchema>;
export type FiefSpec = z.infer<typeof fiefSpec>;

/** SimData.family.estates (원본) 의 fief 칸 → 검증된 데이터 */
export function parseFief(estatesRaw: unknown): FiefData | null {
  const f = (estatesRaw as { fief?: unknown } | null | undefined)?.fief;
  if (!f) return null;
  return fiefSchema.parse(stripMeta(f));
}

export interface FiefHost {
  readonly rng: Rng;
  seasonDays(): number;
  lifespan(): number;
  /** 이 날이 속한 계절 id (spring summer autumn winter) */
  season(day: number): string;
  householdEstate(household: number): string;
  /** 가정 수입 (파딩, 분류: fief_tenants fief_manors stipend fief_fees fief_fines embezzle). 십일조 대상 */
  earn(household: number, amount: number, kind: string): void;
  /** 저장고에 현물 (가을 소작 곡물) */
  addStock(household: number, item: string, n: number): void;
  /** 오늘 마을 방앗간/장터 사용료 합 (파딩) */
  feesToday(): number;
  /** 오늘 재판 벌금 합 (파딩) */
  finesToday(): number;
  fame(household: number, delta: number, reason: string): void;
  /** 민심 변화 (M9 마을 수치) */
  morale(delta: number, reason: string): void;
  rumor(household: number, kind: string): void;
  notice(household: number, kind: string, args?: Record<string, string | number>): void;
  // 사치 요구 판정
  /** 집 등급 (houses.json tier 0 오두막 ~ 5 영주 성 거주동) */
  houseTier(household: number): number;
  /** 마지막으로 연회/잔치를 연 날 (없으면 -Infinity) */
  lastFeastDay(household: number): number;
  /** 가정 성인들이 입는 옷(옷감·염료) 가장 높은 사치 금지법 등급 순번 (sumptuary tiers) */
  bestOutfitTier(household: number): number;
  /** 사치 금지법 등급 이름 → 순번 */
  tierIndex(tier: string): number;
  moodletHousehold(household: number, id: string): void;
}

export interface FiefState extends FiefSpec {
  household: number;
  /** 쌓인 소작 지대 (동화, 계절 정산 전) */
  pendingTenant: number;
  /** 파딩 미만 이월 */
  carry: number;
}

/** 하루 영지 정산 결과 (파딩) */
export interface FiefDay {
  household: number;
  tenants: number;
  inKind: number;
  manors: number;
  stipend: number;
  fees: number;
  fines: number;
  treasury: number;
}

export interface Treasury {
  money: number;
  /** 수입/지출 누계 (분류별, 파딩) */
  income: Record<string, number>;
  expense: Record<string, number>;
}

export class FiefSystem {
  readonly fiefs = new Map<number, FiefState>();
  treasury: Treasury = { money: 0, income: {}, expense: {} };

  constructor(private host: FiefHost, readonly d: FiefData) {}

  /** 영지 주기 (프리셋·기사 서임 뒤 영지 하사). 빈 값은 신분 기본값 */
  grant(household: number, spec?: Partial<FiefSpec>): FiefState {
    const base = this.d.defaults[this.host.householdEstate(household)] ?? { manors: 0, tenants: 0, lord: false, policy: false };
    const f: FiefState = { household, ...base, ...spec, pendingTenant: 0, carry: 0 };
    this.fiefs.set(household, f);
    return f;
  }

  revoke(household: number): void {
    this.fiefs.delete(household);
  }

  get(household: number): FiefState | undefined {
    return this.fiefs.get(household);
  }

  /** 마을 영주 가문 (재판·세금·정책권) */
  lordHousehold(): number | null {
    for (const f of this.fiefs.values()) if (f.lord) return f.household;
    return null;
  }

  hasPolicy(household: number): boolean {
    return !!this.fiefs.get(household)?.policy;
  }

  private pay(f: FiefState, pennies: number, kind: string): number {
    const far = pennies * 4 + f.carry;
    const whole = Math.floor(far);
    f.carry = far - whole;
    if (whole > 0) this.host.earn(f.household, whole, kind);
    return whole;
  }

  /**
   * 영지 수입 하루 정산 (자정, 방금 끝난 날 day). econ.endOfDay 전에 부르면 오늘 수입이 오늘 십일조에 들어감.
   * 영주 가문이 없으면 사용료·벌금 전부 금고로
   */
  dailySettle(day: number): FiefDay[] {
    const H = this.host;
    const SD = H.seasonDays();
    const lastOfSeason = day % SD === SD - 1;
    const autumn = H.season(day) === 'autumn';
    const out: FiefDay[] = [];
    const fees = Math.max(0, H.feesToday());
    const fines = Math.max(0, H.finesToday());
    const lordHh = this.lordHousehold();
    let toTreasury = 0;
    for (const f of this.fiefs.values()) {
      const r: FiefDay = { household: f.household, tenants: 0, inKind: 0, manors: 0, stipend: 0, fees: 0, fines: 0, treasury: 0 };
      f.pendingTenant += f.tenants * this.d.tenantPerDay;
      if (lastOfSeason && f.pendingTenant > 0) {
        let cash = f.pendingTenant;
        if (autumn && this.d.autumnInKind > 0) {
          const kindPennies = cash * this.d.autumnInKind;
          const n = Math.floor(kindPennies / this.d.inKindPrice);
          if (n > 0) {
            H.addStock(f.household, this.d.inKindItem, n);
            r.inKind = n;
            cash -= n * this.d.inKindPrice;
          }
        }
        r.tenants = this.pay(f, cash, 'fief_tenants');
        f.pendingTenant = 0;
      }
      r.manors = this.pay(f, f.manors * this.d.manorPerDay, 'fief_manors');
      const st = this.d.stipend[H.householdEstate(f.household)] ?? 0;
      if (st > 0) r.stipend = this.pay(f, st, 'stipend');
      if (f.household === lordHh) {
        r.fees = Math.floor(fees * this.d.feeShare);
        if (r.fees > 0) H.earn(f.household, r.fees, 'fief_fees');
        if (this.d.finesTo === 'family' && fines > 0) {
          r.fines = fines;
          H.earn(f.household, fines, 'fief_fines');
        }
      }
      out.push(r);
    }
    toTreasury += fees - (lordHh !== null ? Math.floor(fees * this.d.feeShare) : 0);
    if (this.d.finesTo === 'treasury' || lordHh === null) toTreasury += fines;
    if (toTreasury > 0) this.treasuryIn(toTreasury, 'fees');
    for (const r of out) r.treasury = toTreasury;
    return out;
  }

  // ---------------------------------------------------------------- 영주 금고 (18-4)

  treasuryIn(amount: number, kind: string): void {
    if (amount <= 0) return;
    this.treasury.money += amount;
    this.treasury.income[kind] = (this.treasury.income[kind] ?? 0) + amount;
  }

  /** 세금은 가문 재산이 아니라 영주 금고로 (17-6 가을 세금을 리드가 여기로) */
  depositTax(amount: number): void {
    this.treasuryIn(amount, 'tax');
  }

  /** 금고 지출 (경비병 급여, 축제 지원, 곡물 배급, 전쟁). 모자라면 false */
  treasurySpend(amount: number, kind: string): boolean {
    if (amount <= 0) return true;
    if (this.treasury.money < amount) return false;
    this.treasury.money -= amount;
    this.treasury.expense[kind] = (this.treasury.expense[kind] ?? 0) + amount;
    return true;
  }

  /** 사적 유용: 금고 → 영주 가문 재산. 민심 −10, 가문 명성 −30, 발각되면 소문 */
  embezzle(household: number, amount: number): { ok: boolean; moved: number; discovered: boolean } {
    const f = this.fiefs.get(household);
    if (!f?.lord) return { ok: false, moved: 0, discovered: false };
    const moved = Math.min(Math.max(0, Math.floor(amount)), this.treasury.money);
    if (moved <= 0) return { ok: false, moved: 0, discovered: false };
    const E = this.d.embezzle;
    this.treasury.money -= moved;
    this.treasury.expense.embezzle = (this.treasury.expense.embezzle ?? 0) + moved;
    this.host.earn(household, moved, 'embezzle');
    this.host.morale(E.morale, 'embezzle');
    this.host.fame(household, E.fame, 'embezzle');
    const discovered = this.host.rng.next() < E.discoverChance;
    if (discovered) {
      this.host.rumor(household, E.rumor);
      this.host.notice(household, 'embezzle_found', { n: moved });
    } else this.host.notice(household, 'embezzle', { n: moved });
    return { ok: true, moved, discovered };
  }

  // ---------------------------------------------------------------- 귀족 사치 요구 (16-2)

  /** 사치 요구 판정일인가 (checkEvery 주기) */
  luxuryDue(day: number): boolean {
    const every = Math.max(1, Math.round(durDays(this.d.luxury.checkEvery, this.host.lifespan(), this.host.seasonDays())));
    return day % every === every - 1;
  }

  /** 신분에 맞는 저택/옷/연회를 하는가. 빠진 것마다 명성 하락 + 가족 무드렛 */
  luxuryCheck(day: number): { household: number; missed: string[] }[] {
    const H = this.host;
    const L = this.d.luxury;
    const out: { household: number; missed: string[] }[] = [];
    const feastDays = durDays(L.feastWithin, H.lifespan(), H.seasonDays());
    for (const f of this.fiefs.values()) {
      if (!L.estates.includes(H.householdEstate(f.household))) continue;
      const missed: string[] = [];
      if (H.houseTier(f.household) < L.houseTierMin) missed.push('house');
      if (H.bestOutfitTier(f.household) < H.tierIndex(L.outfitTierMin)) missed.push('outfit');
      if (day - H.lastFeastDay(f.household) > feastDays) missed.push('feast');
      for (const m of missed) {
        H.fame(f.household, L.fame[m as 'house' | 'outfit' | 'feast'], `luxury_${m}`);
        H.notice(f.household, `luxury_${m}`);
      }
      if (missed.length) H.moodletHousehold(f.household, L.moodlet);
      out.push({ household: f.household, missed });
    }
    return out;
  }

  /** 자정 한 번: 영지 정산 + (주기면) 사치 요구 */
  daily(day: number): FiefDay[] {
    const r = this.dailySettle(day);
    if (this.luxuryDue(day)) this.luxuryCheck(day);
    return r;
  }

  hashParts(out: (string | number)[]): void {
    out.push(this.treasury.money);
    for (const f of [...this.fiefs.values()].sort((a, b) => a.household - b.household)) out.push(f.household, f.manors, f.tenants, f.pendingTenant.toFixed(3), f.carry.toFixed(3));
  }
}
