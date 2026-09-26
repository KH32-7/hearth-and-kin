/**
 * 시작 프리셋 7 신분 × 3 형편 = 21 (GDD 16-2 시작 신분 선택, 17-4 시작 자금, 29-1).
 * - 현금 = 그 신분 S × 형편 배수 (lifespan): 몰락 −0.5S(빚, 상환 28일) / 보통 0.3S / 부유 1.5S. 명성 200 / 300 / 400
 * - 필수 자산 (모든 형편 공통, 16-2 표): 집 종류와 소유 형태, 밭 구획, 가축, 직업, 도구, 길드 자격, 도제·종자, 하인, 교역 자본, 영지
 * - 기본 가족: 청년 부부 + 아동 1~2. 성직자는 본인 + 같은 가문 형제 부부 + 아동 1
 * applyPreset(host, data, id) 가 Host 창구로 조작 가문을 꾸림. resolvePreset 는 순수 (테스트·UI 미리보기)
 * 무작위(성별·아동 나이)는 host.rng 만. 렌더러/DOM 없음
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import type { LifeStage } from '../people/person';
import { ESTATE_IDS, stripMeta, type EstateId } from './estates';

const estateId = z.enum(ESTATE_IDS as [EstateId, ...EstateId[]]);
const scale = z.enum(['absolute', 'season', 'lifespan', 'per_life']);
const stage = z.enum(['baby', 'toddler', 'child', 'teen', 'young', 'adult', 'elder']);
const member = z.object({
  role: z.enum(['head', 'spouse', 'child', 'sibling', 'sibling_spouse']),
  sex: z.enum(['male', 'female', 'any', 'opposite']),
  stage,
  displayAge: z.union([z.number(), z.tuple([z.number(), z.number()])]),
  estate: estateId.optional(),
});
const house = z.object({ kind: z.string(), tenure: z.enum(['owned', 'lord', 'church']) });
const fief = z.object({ manors: z.number().int(), tenants: z.number().int(), lord: z.boolean(), policy: z.boolean() });
const assets = z.object({
  family: z.string(),
  house,
  plots: z.number().int().min(0).optional(),
  animals: z.record(z.string(), z.number().int()).optional(),
  items: z.record(z.string(), z.number().int()).optional(),
  careers: z.record(z.string(), z.string()).optional(),
  tools: z.boolean().optional(),
  guild: z.boolean().optional(),
  apprentice: z.number().int().optional(),
  squire: z.number().int().optional(),
  servants: z.array(z.string()).optional(),
  capital: z.object({ of: estateId, mult: z.number(), scale: z.literal('lifespan') }).optional(),
  fief: fief.optional(),
});
const wealth = z.object({ cashS: z.number(), scale: z.literal('lifespan'), loanTerm: z.object({ value: z.number(), scale }).optional(), lender: z.string().optional(), fame: z.number() });

export const presetsSchema = z.object({
  wealth: z.object({ poor: wealth, normal: wealth, rich: wealth }),
  families: z.object({ couple: z.array(member), clergy: z.array(member), child: member }).catchall(z.union([z.array(member), member])),
  estates: z.record(estateId, assets),
  presets: z.array(z.object({ id: z.string(), estate: estateId, wealth: z.enum(['poor', 'normal', 'rich']), children: z.number().int().min(0), override: assets.partial().optional() })),
}).loose();
export type PresetsData = z.infer<typeof presetsSchema>;
export type PresetAssets = z.infer<typeof assets>;
export type PresetMember = z.infer<typeof member>;
export type Wealth = 'poor' | 'normal' | 'rich';

export function parsePresets(raw: unknown): PresetsData | null {
  if (!raw) return null;
  const d = presetsSchema.parse(stripMeta(raw));
  for (const p of d.presets) {
    const a = d.estates[p.estate];
    if (!a) throw new Error(`start_presets ${p.id}: 신분 ${p.estate} 자산 없음`);
    if (!Array.isArray((d.families as Record<string, unknown>)[p.override?.family ?? a.family])) throw new Error(`start_presets ${p.id}: 가족 구성 ${a.family} 없음`);
  }
  return d;
}

/** 프리셋 하나를 풀어 놓은 모양 (순수) */
export interface ResolvedPreset {
  id: string;
  estate: EstateId;
  wealth: Wealth;
  cashS: number;
  fame: number;
  loanTermDays: number;
  lender: string;
  assets: PresetAssets;
  /** 가족 구성 (아동 수만큼 child 를 붙임) */
  members: PresetMember[];
}

export function presetIds(d: PresetsData): string[] {
  return d.presets.map((p) => p.id);
}

export function resolvePreset(d: PresetsData, id: string): ResolvedPreset | null {
  const p = d.presets.find((x) => x.id === id);
  if (!p) return null;
  const base = d.estates[p.estate];
  const o = p.override ?? {};
  const assets: PresetAssets = { ...base, ...o, house: o.house ?? base.house };
  const fam = (d.families as Record<string, PresetMember[] | PresetMember>)[assets.family] as PresetMember[];
  const members: PresetMember[] = [...fam];
  for (let i = 0; i < p.children; i++) members.push(d.families.child);
  const W = d.wealth[p.wealth];
  return { id: p.id, estate: p.estate, wealth: p.wealth, cashS: W.cashS, fame: W.fame, loanTermDays: W.loanTerm?.value ?? 28, lender: W.lender ?? 'moneylender', assets, members };
}

/** 시작 현금 (파딩) = round(S × 배수 × 수명 배수) 동화 × 4. 음수 = 빚 */
export function presetCash(savingsPennies: number, cashS: number, lifespan: number): number {
  return Math.round(savingsPennies * cashS * lifespan) * 4;
}

// ------------------------------------------------------------------ Host

/** 만들 인물 사양 (리드가 genetics createFamily 사양으로 바꿈) */
export interface PresetPersonSpec {
  role: PresetMember['role'];
  sex: 'male' | 'female';
  stage: LifeStage;
  displayAge: number;
  /** 개인 신분 */
  estate: EstateId;
}

export interface PresetHost {
  readonly rng: Rng;
  lifespan(): number;
  /** 한 인생 저축 목표 S (동화, 보통 수명 기준) */
  savings(estate: EstateId): number;
  /**
   * 조작 가문 가정 만들기 (기존 조작 가문 정리 포함). 사양 순서대로 만든 인물 id 를 돌려줌.
   * 가족 관계: head–spouse 부부, child 는 head·spouse 의 자녀, sibling 은 head 의 형제, sibling_spouse 는 sibling 의 배우자.
   * 가정 계정은 돈 0 으로 엶 (economy.openAccount 의 형편 시작 자금을 쓰지 않음: 현금은 grant/borrow 로 줌)
   */
  createHousehold(estate: EstateId, members: PresetPersonSpec[]): { household: number; ids: number[] };
  setHouseholdEstate(household: number, estate: EstateId): void;
  /** 돈 주기 (파딩) */
  grant(household: number, amount: number, reason: string): void;
  /** 빚 (파딩, 상환일 termDays 뒤, absolute) */
  borrow(household: number, amount: number, termDays: number, lender: string): void;
  /** 가문 명성 시작값 (H 가문 명성) */
  setFame(household: number, value: number): void;
  /** 집 배정: 종류(hut farmhouse workshop_house merchant_house rectory monastery_cell manor castle_hall), 소유 형태 */
  assignHouse(household: number, kind: string, tenure: 'owned' | 'lord' | 'church'): boolean;
  setCareer(personId: number, careerId: string): boolean;
  addPlots(household: number, n: number): void;
  addAnimals(household: number, kind: string, n: number): void;
  addItems(household: number, item: string, n: number): void;
  /** 직업 도구 (장인) */
  grantTools(household: number, careerId: string): void;
  /** 길드 회원 자격 (Estates.grantGuild) */
  grantGuild(personId: number, craft: string): void;
  /** 도제 (NPC 아이/청소년, 가정 상한에 포함) */
  addApprentice(household: number, careerId: string): void;
  /** 종자 (NPC) */
  addSquire(household: number): void;
  /** 하인 고용 (H servants.ts: maid cook nurse groom steward guard) */
  hireServant(household: number, role: string): boolean;
  /** 영지 (FiefSystem.grant) */
  grantFief(household: number, fief: { manors: number; tenants: number; lord: boolean; policy: boolean }): void;
}

export interface PresetResult {
  ok: boolean;
  reason?: string;
  id: string;
  household: number;
  estate: EstateId;
  wealth: Wealth;
  /** 현금 (파딩, 몰락이면 0) */
  cash: number;
  /** 빚 (파딩) */
  debt: number;
  /** 교역 자본 (파딩, 현금과 따로) */
  capital: number;
  fame: number;
  ids: number[];
  specs: PresetPersonSpec[];
  house: { kind: string; tenure: string; ok: boolean; lot?: string | null; price?: number };
  careers: Record<number, string>;
  servants: string[];
  fief: { manors: number; tenants: number; lord: boolean; policy: boolean } | null;
}

function pickAge(a: number | [number, number], rng: Rng): number {
  return Array.isArray(a) ? a[0] + rng.int(a[1] - a[0] + 1) : a;
}

/** 프리셋 가족 사양 (성별·아동 나이는 rng) */
export function presetMembers(r: ResolvedPreset, rng: Rng): PresetPersonSpec[] {
  let headSex: 'male' | 'female' = 'male';
  let sibSex: 'male' | 'female' = 'male';
  const out: PresetPersonSpec[] = [];
  for (const m of r.members) {
    let sex: 'male' | 'female';
    if (m.sex === 'male' || m.sex === 'female') sex = m.sex;
    else if (m.sex === 'opposite') sex = (m.role === 'sibling_spouse' ? sibSex : headSex) === 'male' ? 'female' : 'male';
    else sex = rng.next() < 0.5 ? 'male' : 'female';
    if (m.role === 'head') headSex = sex;
    if (m.role === 'sibling') sibSex = sex;
    out.push({ role: m.role, sex, stage: m.stage, displayAge: pickAge(m.displayAge, rng), estate: m.estate ?? r.estate });
  }
  return out;
}

/** 프리셋으로 조작 가문을 꾸림 */
export function applyPreset(host: PresetHost, d: PresetsData, id: string): PresetResult {
  const r = resolvePreset(d, id);
  const fail = (reason: string): PresetResult => ({ ok: false, reason, id, household: 0, estate: 'freeman', wealth: 'normal', cash: 0, debt: 0, capital: 0, fame: 0, ids: [], specs: [], house: { kind: '', tenure: '', ok: false }, careers: {}, servants: [], fief: null });
  if (!r) return fail('unknown_preset');
  const A = r.assets;
  const specs = presetMembers(r, host.rng);
  const { household, ids } = host.createHousehold(r.estate, specs);
  host.setHouseholdEstate(household, r.estate);
  // 돈: S × 형편 배수 (몰락 = 빚)
  const money = presetCash(host.savings(r.estate), r.cashS, host.lifespan());
  let cash = 0;
  let debt = 0;
  if (money >= 0) {
    cash = money;
    if (money > 0) host.grant(household, money, 'start');
  } else {
    debt = -money;
    host.borrow(household, debt, r.loanTermDays, r.lender);
  }
  const capital = A.capital ? Math.round(host.savings(A.capital.of) * A.capital.mult * host.lifespan()) * 4 : 0;
  if (capital > 0) host.grant(household, capital, 'trade_capital');
  host.setFame(household, r.fame);
  // 집
  const houseOk = host.assignHouse(household, A.house.kind, A.house.tenure);
  // 직업 (역할 → 직업)
  const careers: Record<number, string> = {};
  for (const [role, career] of Object.entries(A.careers ?? {})) {
    const i = specs.findIndex((s) => s.role === role);
    if (i < 0) continue;
    if (host.setCareer(ids[i], career)) careers[ids[i]] = career;
  }
  const headId = ids[specs.findIndex((s) => s.role === 'head')];
  const headCareer = careers[headId];
  if (A.plots) host.addPlots(household, A.plots);
  for (const [k, n] of Object.entries(A.animals ?? {})) if (n > 0) host.addAnimals(household, k, n);
  for (const [k, n] of Object.entries(A.items ?? {})) if (n > 0) host.addItems(household, k, n);
  if (A.tools && headCareer) host.grantTools(household, headCareer);
  if (A.guild && headCareer) host.grantGuild(headId, headCareer);
  for (let i = 0; i < (A.apprentice ?? 0); i++) host.addApprentice(household, headCareer ?? '');
  for (let i = 0; i < (A.squire ?? 0); i++) host.addSquire(household);
  const servants: string[] = [];
  for (const role of A.servants ?? []) if (host.hireServant(household, role)) servants.push(role);
  if (A.fief) host.grantFief(household, A.fief);
  return {
    ok: true,
    id,
    household,
    estate: r.estate,
    wealth: r.wealth,
    cash,
    debt,
    capital,
    fame: r.fame,
    ids,
    specs,
    house: { kind: A.house.kind, tenure: A.house.tenure, ok: houseOk },
    careers,
    servants,
    fief: A.fief ?? null,
  };
}
