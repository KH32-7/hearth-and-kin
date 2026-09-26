/**
 * 가문 만들기 화면의 sim 쪽 모델 (GDD 10-1).
 * - FamilySpec: 가정 하나 (조작 가능 최대 8명, 하인 포함 12명), 관계 (부모/자녀/형제/배우자/조부모/사촌/하인)
 * - 검사: 인원 상한, 나이·관계 모순, 4촌 이내 혼인 금지, 성직자 혼인 불가(16-2), 농노 가문명 없음(10-4), 옷 염료(16-2 사치 금지법)
 * - 무작위: 부위별, 전체, "이 가족 닮게" (가족 유전자로)
 * - 걸음걸이 → 걷기 속도/애니 속도 배수, 목소리 (높낮이 3 × 웅얼거림 3)
 * - 인물/가문 JSON 내보내기/불러오기 (format + v)
 * 순수 함수. 한국어 문장은 i18n (genetics.json 의 creation.err.* 키 = 이슈 code)
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import type { LifeStage } from '../people/person';
import type { OutfitKind } from '../people/outfits';
import { OUTFIT_KINDS } from '../people/outfits';
import {
  express, genomeProblems, genomeSchema, inherit, randomGenome,
  type Appearance, type GeneticsData, type Genome, type LookChoice, type Sex,
} from './genetics';
import { pickName, type NamesData } from './names';

export const LIFE_STAGES: readonly LifeStage[] = ['baby', 'toddler', 'child', 'teen', 'young', 'adult', 'elder'];
export const CREATION_VERSION = 1;
export const PERSON_FORMAT = 'hearth-kin/person';
export const FAMILY_FORMAT = 'hearth-kin/family';

/** 관계: parent/grandparent 는 a 가 b 의 부모/조부모. 자녀 = 부모 관계의 반대쪽. 하인은 MemberSpec.servant */
export type RelKind = 'parent' | 'spouse' | 'sibling' | 'grandparent' | 'cousin';
export interface RelSpec {
  a: string;
  b: string;
  kind: RelKind;
}

export interface OutfitDyes {
  main: string;
  accent: string;
  trim: string;
}

export interface VoiceSpec {
  /** low | mid | high */
  pitch: string;
  /** soft | nasal | gruff */
  mumble: string;
}

export interface MemberSpec {
  /** 사양 안 식별자 (관계가 가리킴) */
  key: string;
  name: string;
  sex: Sex;
  stage: LifeStage;
  /** 표시 나이 (없으면 단계 범위 아무 나이) */
  age?: number;
  /** 개인 신분 (16-2) */
  estate: string;
  servant: boolean;
  genome: Genome;
  look: LookChoice;
  /** 복장 6벌의 옷 색 */
  outfits: Record<OutfitKind, OutfitDyes>;
  /** easy(느긋) | proud(당당) | quick(종종) | sneak(살금) */
  gait: string;
  voice: VoiceSpec;
  /** 성격 특성 (내면 12장, 검사는 내면 쪽) */
  traits: string[];
}

export interface FamilySpec {
  v: number;
  /** 가문명 (농노 가정은 null) */
  clan: string | null;
  /** 가정 대표 신분 */
  estate: string;
  members: MemberSpec[];
  relations: RelSpec[];
}

export type IssueCode =
  | 'empty'
  | 'too_many_members'
  | 'household_full'
  | 'no_adult'
  | 'duplicate_key'
  | 'unknown_member'
  | 'self_relation'
  | 'bad_value'
  | 'unknown_estate'
  | 'dye_not_allowed'
  | 'age_stage_mismatch'
  | 'parents_conflict'
  | 'ancestor_cycle'
  | 'parent_age'
  | 'grandparent_age'
  | 'spouse_twice'
  | 'spouse_too_young'
  | 'spouse_kin'
  | 'clergy_spouse'
  | 'servant_too_young'
  | 'serf_has_clan';

export interface CreationIssue {
  code: IssueCode;
  /** 관련 인물 key */
  members: string[];
  /** 개발용 세부 (화면에는 code 의 i18n 문장) */
  detail?: string;
}

// ------------------------------------------------------------------ 옷 염료 (16-2)

export function estateRank(g: GeneticsData, estate: string): number {
  return g.dyes.rank[estate] ?? -1;
}

/** 이 신분이 공공 장소에서 입을 수 있는 옷 색 (등급 이하 염료 + 신분 추가 색). rankOverride 는 하인 제복 예외용 */
export function allowedDyeColors(g: GeneticsData, estate: string, rankOverride?: number): string[] {
  const r = rankOverride ?? estateRank(g, estate);
  const out: string[] = [];
  for (const d of g.dyes.list) {
    if ((g.dyes.rank[d.tier] ?? Infinity) <= r) for (const c of d.colors) if (!out.includes(c)) out.push(c);
  }
  for (const c of g.dyes.extra[estate] ?? []) if (!out.includes(c)) out.push(c);
  return out;
}

/** 옷 색 → 염료 id (16-2 표의 염료 칸). 없으면 null */
export function dyeOfColor(g: GeneticsData, color: string): string | null {
  return g.dyes.list.find((d) => d.colors.includes(color))?.id ?? null;
}

/** 인물이 만들기 화면에서 고를 수 있는 색: 하인 제복은 주인(가정) 신분 −1 등급까지 (16-8) */
function memberDyeColors(g: GeneticsData, m: MemberSpec, householdEstate: string): string[] {
  const own = estateRank(g, m.estate);
  const r = m.servant ? Math.max(own, estateRank(g, householdEstate) - 1) : own;
  return allowedDyeColors(g, m.estate, r);
}

function pickFrom<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.min(list.length - 1, rng.int(list.length))];
}

/** 복장 6벌 옷 색 무작위 (허용 염료 안에서) */
export function randomDyes(rng: Rng, colors: readonly string[]): Record<OutfitKind, OutfitDyes> {
  const out = {} as Record<OutfitKind, OutfitDyes>;
  for (const k of OUTFIT_KINDS) out[k] = { main: pickFrom(rng, colors), accent: pickFrom(rng, colors), trim: pickFrom(rng, colors) };
  return out;
}

// ------------------------------------------------------------------ 걸음걸이, 목소리

export function gaitParams(g: GeneticsData, gait: string): { walk: number; anim: number } {
  return g.gaits[gait] ?? { walk: 1, anim: 1 };
}

export function voiceParams(g: GeneticsData, voice: VoiceSpec): { pitch: number; sampleSet: string } {
  return { pitch: g.voice.pitch[voice.pitch] ?? 1, sampleSet: g.voice.mumble[voice.mumble] ?? Object.values(g.voice.mumble)[0] };
}

// ------------------------------------------------------------------ 무작위

export interface RandomMemberOpts {
  key: string;
  estate: string;
  sex?: Sex;
  stage?: LifeStage;
  servant?: boolean;
  /** 가정 대표 신분 (하인 제복 색) */
  householdEstate?: string;
  /** 유전자를 정해 줌 ("이 가족 닮게") */
  genome?: Genome;
  /** 이미 쓰는 이름 (가족 안 겹치지 않게) */
  takenNames?: Iterable<string>;
}

function randomLook(g: GeneticsData, rng: Rng): LookChoice {
  const marks: string[] = [];
  for (const id of g.marks.ids) if (rng.next() < (g.marks.chance[id] ?? 0)) marks.push(id);
  return { marks };
}

function randomVoice(g: GeneticsData, rng: Rng): VoiceSpec {
  return { pitch: pickFrom(rng, Object.keys(g.voice.pitch)), mumble: pickFrom(rng, Object.keys(g.voice.mumble)) };
}

/** 전체 무작위 인물 */
export function randomMember(g: GeneticsData, names: NamesData | null, rng: Rng, opts: RandomMemberOpts): MemberSpec {
  const sex: Sex = opts.sex ?? (rng.next() < 0.5 ? 'male' : 'female');
  const stage = opts.stage ?? pickFrom(rng, ['young', 'adult'] as LifeStage[]);
  const genome = opts.genome ?? randomGenome(g, rng);
  const name = names ? pickName(names, rng, opts.estate, sex, opts.takenNames ?? []) : '';
  const m: MemberSpec = {
    key: opts.key,
    name,
    sex,
    stage,
    estate: opts.estate,
    servant: !!opts.servant,
    genome,
    look: randomLook(g, rng),
    outfits: {} as Record<OutfitKind, OutfitDyes>,
    gait: pickFrom(rng, Object.keys(g.gaits)),
    voice: randomVoice(g, rng),
    traits: [],
  };
  m.outfits = randomDyes(rng, memberDyeColors(g, m, opts.householdEstate ?? opts.estate));
  return m;
}

/** 부위별 무작위 버튼 */
export type RandomPart =
  | 'skin' | 'hairColor' | 'eyeColor' | 'eyeShape' | 'brows' | 'build' | 'height'
  | 'hairStyle' | 'beard' | 'marks' | 'dyes' | 'gait' | 'voice' | 'name';

export const RANDOM_PARTS: readonly RandomPart[] = [
  'skin', 'hairColor', 'eyeColor', 'eyeShape', 'brows', 'build', 'height', 'hairStyle', 'beard', 'marks', 'dyes', 'gait', 'voice', 'name',
];

/** 한 부위만 무작위로 바꾼 새 인물 (원본은 그대로). 대립 유전자를 바꾸면 출처 기록은 지움 */
export function randomizePart(
  g: GeneticsData, m: MemberSpec, part: RandomPart, rng: Rng,
  ctx: { names?: NamesData | null; householdEstate?: string; takenNames?: Iterable<string> } = {},
): MemberSpec {
  const genome: Genome = { ...m.genome, hair: [...m.genome.hair], eyes: [...m.genome.eyes], congenital: [...m.genome.congenital], mutated: [...m.genome.mutated] };
  const next: MemberSpec = { ...m, genome, look: { ...m.look, marks: [...(m.look.marks ?? [])] }, voice: { ...m.voice }, outfits: { ...m.outfits } };
  const fresh = randomGenome(g, rng);
  switch (part) {
    case 'skin':
      genome.skin = fresh.skin;
      break;
    case 'hairColor':
      genome.hair = fresh.hair;
      genome.origin = null;
      break;
    case 'eyeColor':
      genome.eyes = fresh.eyes;
      genome.origin = null;
      break;
    case 'eyeShape':
    case 'brows':
    case 'build':
    case 'height':
      genome[part] = fresh[part];
      break;
    case 'hairStyle': {
      const styles = g.art.hairStyles[m.sex][coarse(m.stage)];
      next.look.hairStyle = pickFrom(rng, styles);
      break;
    }
    case 'beard':
      next.look.beard = rng.next() < 0.3 ? 'none' : pickFrom(rng, g.art.beards);
      break;
    case 'marks':
      next.look.marks = randomLook(g, rng).marks;
      break;
    case 'dyes':
      next.outfits = randomDyes(rng, memberDyeColors(g, m, ctx.householdEstate ?? m.estate));
      break;
    case 'gait':
      next.gait = pickFrom(rng, Object.keys(g.gaits));
      break;
    case 'voice':
      next.voice = randomVoice(g, rng);
      break;
    case 'name':
      if (ctx.names) next.name = pickName(ctx.names, rng, m.estate, m.sex, [...(ctx.takenNames ?? []), m.name]);
      break;
  }
  return next;
}

function coarse(stage: LifeStage): 'child' | 'teen' | 'adult' | 'elder' {
  return stage === 'baby' || stage === 'toddler' || stage === 'child' ? 'child' : stage === 'teen' ? 'teen' : stage === 'elder' ? 'elder' : 'adult';
}

/**
 * "이 가족 닮게" (10-1): 가족 유전자 중 둘을 가상의 부모로 삼아 inherit.
 * 하나뿐이면 그 사람 + 비슷한 피부의 무작위 유전자
 */
export function resembleFamily(g: GeneticsData, family: readonly Genome[], rng: Rng): Genome {
  if (!family.length) return randomGenome(g, rng);
  if (family.length === 1) {
    const other = randomGenome(g, rng, { skinNear: family[0].skin, noCongenital: true });
    return inherit(g, family[0], other, rng);
  }
  const i = rng.int(family.length);
  let j = rng.int(family.length - 1);
  if (j >= i) j++;
  return inherit(g, family[i], family[j], rng);
}

// ------------------------------------------------------------------ 표현형 연결

/** 이 인물의 렌더러 appearance (복장 하나) */
export function memberAppearance(g: GeneticsData, m: MemberSpec, outfit: OutfitKind = 'everyday', pregnant: 0 | 1 | 2 = 0): Appearance {
  return express(g, m.genome, m.sex, m.stage, undefined, { estate: m.estate, outfit, pregnant, dyes: m.outfits[outfit], look: m.look });
}

/** 게임에 넣을 때 필요한 값 묶음 (리드가 Person 에 옮김) */
export function memberRuntime(g: GeneticsData, m: MemberSpec): {
  appearance: Appearance; gait: { walk: number; anim: number }; voice: { pitch: number; sampleSet: string }; congenital: string[];
} {
  return { appearance: memberAppearance(g, m), gait: gaitParams(g, m.gait), voice: voiceParams(g, m.voice), congenital: [...m.genome.congenital] };
}

// ------------------------------------------------------------------ 검사

function ageRange(g: GeneticsData, m: MemberSpec): [number, number] {
  if (m.age !== undefined) return [m.age, m.age];
  return (g.creation.stageAges[m.stage] as [number, number] | undefined) ?? [0, 200];
}

/** 두 나이 구간에서 (부모 - 자식) 차이가 [lo, hi] 안에 들 수 있는가 */
function gapPossible(p: [number, number], c: [number, number], lo: number, hi: number): boolean {
  const minGap = p[0] - c[1];
  const maxGap = p[1] - c[0];
  return maxGap >= lo && minGap <= hi;
}

/**
 * 혈연 촌수: 두 사람의 공통 조상까지 올라간 세대 수의 합 (부모-자식 1촌, 형제 2촌, 사촌 4촌).
 * 위로만 올라가는 길을 씀 (같은 자식을 둔 부부나 사돈은 혈연이 아님).
 * 형제 무리는 가상의 공통 부모 하나 (형제의 형제도 형제), 그 가상 부모는 무리 누군가의 실제 부모와 같은 사람으로 봄.
 * 사촌 한 쌍은 두 세대 위 가상의 공통 조부모. 이어지지 않으면 Infinity
 */
export function kinDegree(spec: Pick<FamilySpec, 'relations'>, a: string, b: string): number {
  if (a === b) return 0;
  // 형제 무리 (union-find)
  const root = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (root.has(r) && root.get(r) !== r) r = root.get(r)!;
    return r;
  };
  for (const r of spec.relations) {
    if (r.kind !== 'sibling') continue;
    for (const x of [r.a, r.b]) if (!root.has(x)) root.set(x, x);
    root.set(find(r.a), find(r.b));
  }
  const up = new Map<string, Array<[string, number]>>();
  const add = (x: string, y: string, w: number) => {
    if (!up.has(x)) up.set(x, []);
    up.get(x)!.push([y, w]);
  };
  let cousinN = 0;
  for (const r of spec.relations) {
    if (r.kind === 'parent') add(r.b, r.a, 1);
    else if (r.kind === 'grandparent') add(r.b, r.a, 2);
    else if (r.kind === 'cousin') {
      const v = `#cousin${cousinN++}`;
      add(r.a, v, 2);
      add(r.b, v, 2);
    }
  }
  for (const x of root.keys()) {
    const v = `#sib:${find(x)}`;
    add(x, v, 1);
    // 가상 부모 = 무리 안 누군가의 실제 부모/조부모 (한 세대 위에서 같은 자리)
    for (const [p, w] of up.get(x) ?? []) if (!p.startsWith('#')) add(v, p, w - 1);
  }
  const ups = (start: string): Map<string, number> => {
    const dist = new Map<string, number>([[start, 0]]);
    const open = [start];
    while (open.length) {
      open.sort((p, q) => dist.get(q)! - dist.get(p)!);
      const cur = open.pop()!;
      const d = dist.get(cur)!;
      for (const [n, w] of up.get(cur) ?? []) {
        if (d + w < (dist.get(n) ?? Infinity)) {
          dist.set(n, d + w);
          open.push(n);
        }
      }
    }
    return dist;
  };
  const da = ups(a);
  const db = ups(b);
  let best = Infinity;
  for (const [n, d] of da) {
    const e = db.get(n);
    if (e !== undefined && d + e < best) best = d + e;
  }
  return best;
}

const STAGE_ORDER = (s: string) => LIFE_STAGES.indexOf(s as LifeStage);

/** 가족 사양 검사. 빈 배열 = 통과 */
export function validateFamily(g: GeneticsData, spec: FamilySpec): CreationIssue[] {
  const issues: CreationIssue[] = [];
  const c = g.creation;
  const members = spec.members;
  if (!members.length) return [{ code: 'empty', members: [] }];

  const byKey = new Map<string, MemberSpec>();
  for (const m of members) {
    if (byKey.has(m.key)) issues.push({ code: 'duplicate_key', members: [m.key] });
    byKey.set(m.key, m);
  }
  const family = members.filter((m) => !m.servant);
  if (family.length > c.maxMembers) issues.push({ code: 'too_many_members', members: family.map((m) => m.key), detail: `${family.length} > ${c.maxMembers}` });
  if (members.length > c.maxHousehold) issues.push({ code: 'household_full', members: members.map((m) => m.key), detail: `${members.length} > ${c.maxHousehold}` });
  if (!family.some((m) => m.stage === 'young' || m.stage === 'adult' || m.stage === 'elder')) issues.push({ code: 'no_adult', members: family.map((m) => m.key) });
  if (!(spec.estate in g.dyes.rank)) issues.push({ code: 'unknown_estate', members: [], detail: spec.estate });
  if (spec.estate === 'serf' && spec.clan) issues.push({ code: 'serf_has_clan', members: [], detail: spec.clan });

  // 인물 하나씩
  for (const m of members) {
    const bad: string[] = [...genomeProblems(g, m.genome)];
    if (!LIFE_STAGES.includes(m.stage)) bad.push(`stage ${m.stage}`);
    if (!(m.gait in g.gaits)) bad.push(`gait ${m.gait}`);
    if (!(m.voice.pitch in g.voice.pitch)) bad.push(`voice.pitch ${m.voice.pitch}`);
    if (!(m.voice.mumble in g.voice.mumble)) bad.push(`voice.mumble ${m.voice.mumble}`);
    for (const mk of m.look.marks ?? []) if (!g.marks.ids.includes(mk)) bad.push(`mark ${mk}`);
    if (m.look.hairStyle !== undefined && !g.art.hairStyles[m.sex]?.[coarse(m.stage)]?.includes(m.look.hairStyle)) bad.push(`hairStyle ${m.look.hairStyle}`);
    if (m.look.beard !== undefined && m.look.beard !== 'none' && !g.art.beards.includes(m.look.beard)) bad.push(`beard ${m.look.beard}`);
    if (bad.length) issues.push({ code: 'bad_value', members: [m.key], detail: bad.join(', ') });
    if (!(m.estate in g.dyes.rank)) {
      issues.push({ code: 'unknown_estate', members: [m.key], detail: m.estate });
      continue;
    }
    const allowed = memberDyeColors(g, m, spec.estate);
    const wrong: string[] = [];
    for (const k of OUTFIT_KINDS) {
      const d = m.outfits[k];
      if (!d) {
        wrong.push(`${k}: 없음`);
        continue;
      }
      for (const ch of ['main', 'accent', 'trim'] as const) if (!allowed.includes(d[ch])) wrong.push(`${k}.${ch}=${d[ch]}`);
    }
    if (wrong.length) issues.push({ code: 'dye_not_allowed', members: [m.key], detail: wrong.join(', ') });
    if (m.age !== undefined) {
      const r = c.stageAges[m.stage];
      if (r && (m.age < r[0] || m.age > r[1])) issues.push({ code: 'age_stage_mismatch', members: [m.key], detail: `${m.age} ∉ [${r[0]}, ${r[1]}]` });
    }
    if (m.servant && STAGE_ORDER(m.stage) < STAGE_ORDER(c.servantMinStage)) issues.push({ code: 'servant_too_young', members: [m.key] });
  }

  // 관계
  const mothers = new Map<string, string[]>();
  const fathers = new Map<string, string[]>();
  const spouses = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const r of spec.relations) {
    const a = byKey.get(r.a);
    const b = byKey.get(r.b);
    if (!a || !b) {
      issues.push({ code: 'unknown_member', members: [r.a, r.b].filter((k) => !byKey.has(k)) });
      continue;
    }
    if (r.a === r.b) {
      issues.push({ code: 'self_relation', members: [r.a] });
      continue;
    }
    const ra = ageRange(g, a);
    const rb = ageRange(g, b);
    if (r.kind === 'parent') {
      const map = a.sex === 'female' ? mothers : fathers;
      map.set(b.key, [...(map.get(b.key) ?? []), a.key]);
      childrenOf.set(a.key, [...(childrenOf.get(a.key) ?? []), b.key]);
      const hi = a.sex === 'female' ? c.motherGapMax : Infinity;
      if (!gapPossible(ra, rb, c.parentGapMin, hi)) issues.push({ code: 'parent_age', members: [a.key, b.key] });
    } else if (r.kind === 'grandparent') {
      childrenOf.set(a.key, [...(childrenOf.get(a.key) ?? []), b.key]);
      if (!gapPossible(ra, rb, c.grandparentGapMin, Infinity)) issues.push({ code: 'grandparent_age', members: [a.key, b.key] });
    } else if (r.kind === 'spouse') {
      spouses.set(a.key, [...(spouses.get(a.key) ?? []), b.key]);
      spouses.set(b.key, [...(spouses.get(b.key) ?? []), a.key]);
      for (const m of [a, b]) {
        if (ageRange(g, m)[1] < c.spouseMinAge) issues.push({ code: 'spouse_too_young', members: [m.key] });
        if (m.estate === 'clergy') issues.push({ code: 'clergy_spouse', members: [m.key] });
      }
      const deg = kinDegree(spec, a.key, b.key);
      if (deg <= c.kinBanDegree) issues.push({ code: 'spouse_kin', members: [a.key, b.key], detail: `${deg}촌` });
    }
  }
  for (const [child, list] of mothers) if (list.length > 1) issues.push({ code: 'parents_conflict', members: [child, ...list] });
  for (const [child, list] of fathers) if (list.length > 1) issues.push({ code: 'parents_conflict', members: [child, ...list] });
  for (const [k, list] of spouses) {
    const uniq = [...new Set(list)];
    if (uniq.length > 1) issues.push({ code: 'spouse_twice', members: [k, ...uniq] });
  }
  // 조상 순환 (부모/조부모 방향 그래프)
  const state = new Map<string, number>();
  const cyc = new Set<string>();
  const visit = (k: string, stack: string[]): void => {
    state.set(k, 1);
    for (const ch of childrenOf.get(k) ?? []) {
      const s = state.get(ch) ?? 0;
      if (s === 1) for (const x of stack.slice(stack.indexOf(ch))) cyc.add(x);
      else if (s === 0) visit(ch, [...stack, ch]);
    }
    state.set(k, 2);
  };
  for (const k of childrenOf.keys()) if (!state.get(k)) visit(k, [k]);
  if (cyc.size) issues.push({ code: 'ancestor_cycle', members: [...cyc] });
  return issues;
}

// ------------------------------------------------------------------ 내보내기 / 불러오기

const key = z.string().min(1).max(40);
const shortId = z.string().min(1).max(40);
const dyesSchema = z.object({ main: shortId, accent: shortId, trim: shortId }).strict();

export const memberSchema = z.object({
  key,
  name: z.string().max(40),
  sex: z.enum(['male', 'female']),
  stage: z.enum(['baby', 'toddler', 'child', 'teen', 'young', 'adult', 'elder']),
  age: z.number().int().min(0).max(200).optional(),
  estate: shortId,
  servant: z.boolean(),
  genome: genomeSchema,
  look: z.object({
    hairStyle: shortId.optional(),
    beard: shortId.optional(),
    marks: z.array(shortId).max(8).optional(),
    elderHair: shortId.optional(),
  }).strict(),
  outfits: z.object({ everyday: dyesSchema, work: dyesSchema, formal: dyesSchema, sleep: dyesSchema, winter: dyesSchema, bath: dyesSchema }).strict(),
  gait: shortId,
  voice: z.object({ pitch: shortId, mumble: shortId }).strict(),
  traits: z.array(shortId).max(16),
}).strict();

export const familySchema = z.object({
  v: z.number().int(),
  clan: z.string().max(40).nullable(),
  estate: shortId,
  members: z.array(memberSchema).max(64),
  relations: z.array(z.object({ a: key, b: key, kind: z.enum(['parent', 'spouse', 'sibling', 'grandparent', 'cousin']) }).strict()).max(256),
}).strict();

/** 불러오기 파일 크기 상한 (문자) */
export const MAX_IMPORT_CHARS = 256 * 1024;

export type ImportResult<T> =
  | { ok: true; value: T; issues: CreationIssue[] }
  | { ok: false; error: 'too_large' | 'not_json' | 'format' | 'version_newer' | 'schema' | 'bad_value'; detail?: string };

/** 스키마 순서로 키를 맞춘 사본 (같은 내용 = 같은 글자, 갤러리/해시용). 스키마에 안 맞으면 그대로 */
function canonical<T>(schema: z.ZodType<T>, v: T): T {
  const r = schema.safeParse(v);
  return r.success ? r.data : v;
}

export function exportPerson(m: MemberSpec): string {
  return JSON.stringify({ format: PERSON_FORMAT, v: CREATION_VERSION, member: canonical(memberSchema as z.ZodType<MemberSpec>, m) });
}

export function exportFamily(spec: FamilySpec): string {
  return JSON.stringify({ format: FAMILY_FORMAT, v: CREATION_VERSION, family: canonical(familySchema as z.ZodType<FamilySpec>, { ...spec, v: CREATION_VERSION }) });
}

function readEnvelope(text: string, format: string): { ok: true; body: Record<string, unknown> } | { ok: false; error: 'too_large' | 'not_json' | 'format' | 'version_newer'; detail?: string } {
  if (text.length > MAX_IMPORT_CHARS) return { ok: false, error: 'too_large' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'not_json', detail: String(e) };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'format' };
  const body = raw as Record<string, unknown>;
  if (body.format !== format || typeof body.v !== 'number') return { ok: false, error: 'format' };
  if (body.v > CREATION_VERSION) return { ok: false, error: 'version_newer', detail: String(body.v) };
  return { ok: true, body };
}

/** 인물 파일 불러오기: 형식/버전/스키마/값 검사. 통과하면 새 key 로 (가족에 넣을 때 겹치지 않게는 호출하는 쪽) */
export function importPerson(g: GeneticsData, text: string): ImportResult<MemberSpec> {
  const env = readEnvelope(text, PERSON_FORMAT);
  if (!env.ok) return env;
  const parsed = memberSchema.safeParse(env.body.member);
  if (!parsed.success) return { ok: false, error: 'schema', detail: parsed.error.message };
  const m = parsed.data as MemberSpec;
  const bad = genomeProblems(g, m.genome);
  if (bad.length) return { ok: false, error: 'bad_value', detail: bad.join(', ') };
  // 혼자 들어온 인물도 인물 단위 검사 (옷 색, 값)
  const issues = validateFamily(g, { v: CREATION_VERSION, clan: null, estate: m.estate, members: [m], relations: [] }).filter((i) => i.code !== 'no_adult');
  return { ok: true, value: m, issues };
}

/** 가문 파일 불러오기. 검사 이슈는 issues 로 (화면에서 고치게), 형식이 틀리면 ok:false */
export function importFamily(g: GeneticsData, text: string): ImportResult<FamilySpec> {
  const env = readEnvelope(text, FAMILY_FORMAT);
  if (!env.ok) return env;
  const parsed = familySchema.safeParse(env.body.family);
  if (!parsed.success) return { ok: false, error: 'schema', detail: parsed.error.message };
  const spec = parsed.data as FamilySpec;
  for (const m of spec.members) {
    const bad = genomeProblems(g, m.genome);
    if (bad.length) return { ok: false, error: 'bad_value', detail: `${m.key}: ${bad.join(', ')}` };
  }
  return { ok: true, value: spec, issues: validateFamily(g, spec) };
}
