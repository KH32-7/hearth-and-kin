/**
 * 사치 금지법 (GDD 16-2).
 * - 등급 표: 옷감·염료·무기·갑옷 × 공공 착용/휴대 최소 신분 6단 (sumptuary.json)
 * - 소유는 합법. 판정은 공공 장소 착용/휴대에만 (집·자기 부지 안은 판정 없음). 개인 신분을 읽음
 * - 발견: 집행관 또는 사제 시야 안에서만. 확률 = 20% × 등급 격차 × 명성 보정(명망/전설 0.5, 불명예 1.5), 게임 1시간마다
 * - 벌금 = 격차 × 2은화 + 가문 명성 하락, 반복이면 몰수
 * - 예외: 사육제 기간 / 혼례 당일 본인 예복 +1 등급 / 하인 제복 주인 신분 −1 등급까지 / 신분 하락 후 달력 1계절 유예 / 직무 장비
 * - 귀족 초라한 차림 = 체면 손상. 선물·상속으로 받을 때 "입으면 위험" 표시. 샌드박스에서 끄면 아무도 판정하지 않음
 * judge() 는 순수 판정, Sumptuary.hourly() 가 Host 로 실행. 무작위는 host.rng 만. 렌더러/DOM 없음
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import { durDays, stripMeta, type EstatePerson } from './estates';

// ------------------------------------------------------------------ 데이터

const scale = z.enum(['absolute', 'season', 'lifespan', 'per_life']);
const dur = z.object({ value: z.number(), scale });
export const SUMPTUARY_CATEGORIES = ['cloth', 'dye', 'weapon', 'armor'] as const;
export type SumptuaryCategory = (typeof SUMPTUARY_CATEGORIES)[number];

export const sumptuarySchema = z.object({
  tiers: z.array(z.string()).length(6),
  estateTier: z.record(z.string(), z.number().int()),
  items: z.object({
    cloth: z.record(z.string(), z.string()),
    dye: z.record(z.string(), z.string()),
    weapon: z.record(z.string(), z.string()),
    armor: z.record(z.string(), z.string()),
  }),
  lpcDyes: z.record(z.string(), z.string()),
  detection: z.object({ every: dur, base: z.number(), watcherRoles: z.array(z.string()), fameMult: z.record(z.string(), z.number()) }),
  penalty: z.object({ finePerGap: z.number(), famePerGap: z.number(), repeatAfter: z.number().int(), moodlet: z.string(), flag: z.string(), card: z.string(), rumor: z.string() }),
  exceptions: z.object({ weddingBonus: z.number().int(), liveryBelowMaster: z.number().int(), fallGrace: dur, dutyCategories: z.array(z.enum(SUMPTUARY_CATEGORIES)) }),
  shabby: z.object({ estates: z.array(z.string()), minTier: z.string(), fame: z.number(), moodlet: z.string(), cooldown: dur }),
}).loose();
export type SumptuaryData = z.infer<typeof sumptuarySchema>;

export function parseSumptuary(raw: unknown): SumptuaryData | null {
  if (!raw) return null;
  const d = sumptuarySchema.parse(stripMeta(raw));
  // 표의 등급 이름이 tiers 안에 있어야 함
  for (const c of SUMPTUARY_CATEGORIES) for (const [id, t] of Object.entries(d.items[c])) if (!d.tiers.includes(t)) throw new Error(`sumptuary ${c}.${id}: 모르는 등급 ${t}`);
  for (const [lpc, dye] of Object.entries(d.lpcDyes)) if (!(dye in d.items.dye)) throw new Error(`sumptuary lpcDyes.${lpc}: 모르는 염료 ${dye}`);
  return d;
}

// ------------------------------------------------------------------ 순수 판정

/** 착용/휴대 중인 물건 하나 */
export interface WornItem {
  category: SumptuaryCategory;
  /** sumptuary.json items 의 id (옷감·염료·무기·갑옷) */
  id: string;
  /** 혼례 예복 (본인 혼례 당일이면 +1 등급) */
  wedding?: boolean;
  /** 하인 제복: 주인 신분 (주인 −1 등급까지 허용) */
  livery?: string;
  /** 직업이 지급한 무기와 갑옷 (경비병, 종자 …) */
  duty?: boolean;
  /** 물건 uid (몰수 대상), 없으면 0 */
  uid?: number;
}

export interface WearContext {
  /** 개인 신분 */
  estate: string;
  /** 공공 장소인가 (집·자기 부지면 false) */
  public: boolean;
  /** 사육제 기간 (19-4 뒤집힌 세상) */
  carnival: boolean;
  /** 오늘이 본인 혼례 날 */
  weddingToday: boolean;
  /** 신분 하락 뒤 유예: 전 신분과 하락한 날 */
  fall?: { day: number; from: string } | null;
  day: number;
  /** 계절 일수 (유예 기간 = 1계절, season) */
  seasonDays: number;
  lifespan?: number;
  /** 샌드박스: 신분 규칙 끄기 */
  rulesOff: boolean;
}

export interface Violation {
  item: WornItem;
  /** 물건 등급 순번 */
  tier: number;
  /** 허용 등급 순번 */
  allowed: number;
  gap: number;
}

export interface Judgement {
  /** 판정 대상이 아님 (집·사육제·규칙 끔) 의 이유 */
  exempt: 'private' | 'carnival' | 'rules_off' | null;
  violations: Violation[];
  /** 가장 큰 등급 격차 (0 = 문제없음) */
  gap: number;
}

export function tierIndex(d: SumptuaryData, tier: string): number {
  return d.tiers.indexOf(tier);
}

/** 물건의 등급 순번. 표에 없는 물건은 모두(0) */
export function itemTier(d: SumptuaryData, category: SumptuaryCategory, id: string): number {
  const t = d.items[category]?.[id];
  return t ? Math.max(0, tierIndex(d, t)) : 0;
}

/** 신분의 기본 허용 등급 순번 */
export function estateTier(d: SumptuaryData, estate: string): number {
  return d.estateTier[estate] ?? 0;
}

/** 이 물건에 대해 허용되는 등급 (예외 반영). Infinity = 판정 없음 */
export function allowedTier(d: SumptuaryData, ctx: WearContext, item: WornItem): number {
  const X = d.exceptions;
  if (item.duty && X.dutyCategories.includes(item.category)) return Infinity;
  let allowed = estateTier(d, ctx.estate);
  if (ctx.fall && ctx.day < ctx.fall.day + durDays(X.fallGrace, ctx.lifespan ?? 1, ctx.seasonDays)) allowed = Math.max(allowed, estateTier(d, ctx.fall.from));
  if (item.wedding && ctx.weddingToday) allowed = Math.max(allowed, estateTier(d, ctx.estate) + X.weddingBonus);
  if (item.livery) allowed = Math.max(allowed, estateTier(d, item.livery) - X.liveryBelowMaster);
  return allowed;
}

/** 공공 장소 착용/휴대 판정 (순수) */
export function judge(d: SumptuaryData, ctx: WearContext, items: readonly WornItem[]): Judgement {
  if (ctx.rulesOff) return { exempt: 'rules_off', violations: [], gap: 0 };
  if (!ctx.public) return { exempt: 'private', violations: [], gap: 0 };
  if (ctx.carnival) return { exempt: 'carnival', violations: [], gap: 0 };
  const violations: Violation[] = [];
  for (const item of items) {
    const tier = itemTier(d, item.category, item.id);
    const allowed = allowedTier(d, ctx, item);
    if (tier > allowed) violations.push({ item, tier, allowed, gap: tier - allowed });
  }
  return { exempt: null, violations, gap: violations.reduce((m, v) => Math.max(m, v.gap), 0) };
}

/** 한 시간 발견 확률 = base × 격차 × 명성 보정 (0~1) */
export function detectChance(d: SumptuaryData, gap: number, fameTier: string): number {
  if (gap <= 0) return 0;
  return Math.min(1, d.detection.base * gap * (d.detection.fameMult[fameTier] ?? 1));
}

/** 벌금 (파딩) = 격차 × 2은화 */
export function fineFor(d: SumptuaryData, gap: number): number {
  return Math.max(0, gap) * d.penalty.finePerGap * 4;
}

/**
 * 선물·상속으로 받을 때 "입으면 위험" 표시 (16-2): 이 신분이 공공 장소에서 쓰면 걸리는 등급 격차. 0 = 안전.
 * 규칙을 끈 샌드박스면 0
 */
export function riskyToWear(d: SumptuaryData, estate: string, item: WornItem, rulesOff = false): number {
  if (rulesOff) return 0;
  const ctx: WearContext = { estate, public: true, carnival: false, weddingToday: false, day: 0, seasonDays: 7, rulesOff: false };
  return Math.max(0, itemTier(d, item.category, item.id) - allowedTier(d, ctx, item));
}

/** 귀족 체면: 옷(옷감·염료) 최고 등급이 기준보다 낮은가 */
export function isShabby(d: SumptuaryData, estate: string, items: readonly WornItem[]): boolean {
  if (!d.shabby.estates.includes(estate)) return false;
  let best = -1;
  for (const it of items) if (it.category === 'cloth' || it.category === 'dye') best = Math.max(best, itemTier(d, it.category, it.id));
  return best < tierIndex(d, d.shabby.minTier);
}

/** LPC 옷 염료 이름 → 사치 금지법 염료 id (렌더러 옷 사양에서 착용 염료 뽑기) */
export function dyeFromLpc(d: SumptuaryData, lpc: string): string {
  return d.lpcDyes[lpc] ?? 'undyed';
}

// ------------------------------------------------------------------ Host 와 실행

export interface SumptuaryHost<P extends EstatePerson = EstatePerson> {
  readonly rng: Rng;
  day(): number;
  minute(): number;
  seasonDays(): number;
  lifespan(): number;
  /** 샌드박스 신분 규칙 끄기 (NPC 포함 아무도 판정하지 않음) */
  rulesOff(): boolean;
  /** 사육제 기간 */
  isCarnival(): boolean;
  /** 이번 시간에 판정할 인물 (마을에 보이는 사람: 조작 가문 + 간이 세밀도 NPC) */
  candidates(): readonly P[];
  /** 공공 장소인가 (집·자기 부지 밖) */
  inPublic(p: P): boolean;
  /** 지금 착용/휴대 중인 물건 */
  worn(p: P): readonly WornItem[];
  weddingToday(p: P): boolean;
  /** 신분 하락 기록 (Estates.lastFall) */
  lastFall(p: P): { day: number; from: string } | null;
  /** 집행관 또는 사제(detection.watcherRoles)의 시야 안인가 */
  watched(p: P, roles: readonly string[]): boolean;
  fameTier(household: number): string;
  /** 벌금 (파딩). 모자라도 빼고 외상 → 빚 (econ.spend) */
  fine(household: number, amount: number, reason: string): void;
  fame(household: number, delta: number, reason: string, by?: P): void;
  moodlet(p: P, id: string): void;
  /** 몰수 (반복 위반): 그 물건을 가져감 */
  confiscate(p: P, item: WornItem): void;
  notice(p: P, kind: string, args?: Record<string, string | number>): void;
  /** 소문 (14-6) */
  rumor(p: P, kind: string): void;
}

export interface SumptuaryState {
  /** 인물별 걸린 횟수 */
  offenses: Record<number, number>;
  /** 체면 손상 마지막 분 */
  shabbyAt: Record<number, number>;
}

export interface Caught<P> {
  person: P;
  gap: number;
  fine: number;
  confiscated: WornItem[];
}

export class Sumptuary<P extends EstatePerson = EstatePerson> {
  state: SumptuaryState = { offenses: {}, shabbyAt: {} };

  constructor(private host: SumptuaryHost<P>, readonly d: SumptuaryData) {}

  context(p: P): WearContext {
    const H = this.host;
    return {
      estate: p.estate,
      public: H.inPublic(p),
      carnival: H.isCarnival(),
      weddingToday: H.weddingToday(p),
      fall: H.lastFall(p),
      day: H.day(),
      seasonDays: H.seasonDays(),
      lifespan: H.lifespan(),
      rulesOff: H.rulesOff(),
    };
  }

  judge(p: P): Judgement {
    return judge(this.d, this.context(p), this.host.worn(p));
  }

  /** "입으면 위험" 표시 (받을 때) */
  risky(p: P, item: WornItem): number {
    return riskyToWear(this.d, p.estate, item, this.host.rulesOff());
  }

  /** 게임 1시간마다 (detection.every): 시야 안 위반자 발견 판정 + 귀족 체면 */
  hourly(): Caught<P>[] {
    const H = this.host;
    if (H.rulesOff()) return [];
    const out: Caught<P>[] = [];
    for (const p of H.candidates()) {
      const ctx = this.context(p);
      const items = H.worn(p);
      const j = judge(this.d, ctx, items);
      if (j.gap > 0 && H.watched(p, this.d.detection.watcherRoles) && H.rng.next() < detectChance(this.d, j.gap, H.fameTier(p.household))) out.push(this.caught(p, j));
      if (ctx.public && !ctx.carnival) this.shabbyCheck(p, items);
    }
    return out;
  }

  /** 발견: 벌금(격차 × 2은화) + 가문 명성 하락, 반복이면 몰수 */
  caught(p: P, j: Judgement): Caught<P> {
    const H = this.host;
    const Pen = this.d.penalty;
    const n = (this.state.offenses[p.id] ?? 0) + 1;
    this.state.offenses[p.id] = n;
    const fine = fineFor(this.d, j.gap);
    H.fine(p.household, fine, 'sumptuary_fine');
    H.fame(p.household, Pen.famePerGap * j.gap, 'sumptuary', p);
    H.moodlet(p, Pen.moodlet);
    H.rumor(p, Pen.rumor);
    const confiscated: WornItem[] = [];
    if (n >= Pen.repeatAfter) {
      for (const v of j.violations) {
        H.confiscate(p, v.item);
        confiscated.push(v.item);
      }
      H.notice(p, 'sumptuary_confiscated', { name: p.name ?? '', n: fine });
    } else H.notice(p, 'sumptuary_fined', { name: p.name ?? '', n: fine });
    return { person: p, gap: j.gap, fine, confiscated };
  }

  private shabbyCheck(p: P, items: readonly WornItem[]): void {
    const S = this.d.shabby;
    if (!isShabby(this.d, p.estate, items)) return;
    const now = this.host.minute();
    const last = this.state.shabbyAt[p.id];
    if (last !== undefined && now - last < S.cooldown.value) return;
    this.state.shabbyAt[p.id] = now;
    this.host.fame(p.household, S.fame, 'shabby_noble', p);
    this.host.moodlet(p, S.moodlet);
    this.host.notice(p, 'shabby_noble', { name: p.name ?? '' });
  }

  hashParts(out: (string | number)[]): void {
    out.push(JSON.stringify(this.state));
  }
}
