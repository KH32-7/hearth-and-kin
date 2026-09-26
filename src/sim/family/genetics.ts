/**
 * 유전 (GDD 10-3): 유전자 레코드(Genome)와 표현형(렌더러 appearance) 분리.
 * - 피부: 부모 두 값 사이 무작위 + ±1단계 변이 (12단계)
 * - 머리색/눈색: 부모 각각 대립 유전자 2개, 자식은 부모 각각에서 하나씩. 우성 순서는 genetics.json (짙은 색 우성, 갈>초>파>회)
 * - 눈 모양/눈썹/체형/키: 부위마다 한쪽 부모 것을 50:50, 10% 변이
 * - 선천 특성: 부모에게 있으면 25%
 * 순수 함수. 무작위는 넘겨받은 Rng 만 씀. 렌더러를 import 하지 않고 CharacterSpec 과 같은 키 이름만 씀.
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import type { FamilyRaw } from '../data/simData';
import type { LifeStage } from '../people/person';

export type Sex = 'male' | 'female';
/** 렌더러 단계 (CharacterSpec.stage) */
export type CoarseStage = 'child' | 'teen' | 'adult' | 'elder';

// ------------------------------------------------------------------ 데이터

const idList = z.array(z.string().min(1)).min(1);
const stageStyles = z.object({ child: idList, teen: idList, adult: idList, elder: idList });

export const geneticsSchema = z.object({
  version: z.number().int(),
  skin: z.object({ steps: idList, drift: z.number().int().min(0), randomWeights: z.array(z.number().min(0)) }),
  hair: z.object({
    natural: idList,
    dominance: idList,
    freq: z.record(z.string(), z.number().min(0)),
    elder: idList,
    elderChance: z.number().min(0).max(1),
  }),
  eyes: z.object({ colors: idList, dominance: idList, freq: z.record(z.string(), z.number().min(0)) }),
  parts: z.object({ eyeShape: idList, brows: idList, build: idList, height: idList }),
  mutation: z.number().min(0).max(1),
  congenital: z.object({
    ids: idList,
    inherit: z.number().min(0).max(1),
    randomChance: z.number().min(0).max(1),
    conflicts: z.array(z.tuple([z.string(), z.string()])),
  }),
  art: z.object({
    hairStyles: z.object({ male: stageStyles, female: stageStyles }),
    beards: idList,
    beardChance: z.object({ child: z.number(), teen: z.number(), adult: z.number(), elder: z.number() }),
    heads: z.record(z.string(), z.record(z.string(), z.string())),
  }),
  marks: z.object({ ids: idList, chance: z.record(z.string(), z.number().min(0).max(1)) }),
  gaits: z.record(z.string(), z.object({ walk: z.number().positive(), anim: z.number().positive() })),
  voice: z.object({ pitch: z.record(z.string(), z.number().positive()), mumble: z.record(z.string(), z.string()) }),
  dyes: z.object({
    rank: z.record(z.string(), z.number().int().min(0)),
    list: z.array(z.object({ id: z.string(), tier: z.string(), colors: idList })),
    extra: z.record(z.string(), z.array(z.string())).default({}),
  }),
  creation: z.object({
    maxMembers: z.number().int().positive(),
    maxHousehold: z.number().int().positive(),
    stageAges: z.record(z.string(), z.tuple([z.number(), z.number()])),
    parentGapMin: z.number(),
    motherGapMax: z.number(),
    grandparentGapMin: z.number(),
    spouseMinAge: z.number(),
    kinBanDegree: z.number().int().min(0),
    servantMinStage: z.string(),
    outfitKinds: idList,
  }),
  outfits: z.object({ winterAtOrBelow: z.number() }),
}).loose();

export type GeneticsData = z.infer<typeof geneticsSchema>;

/** 원본 JSON 검사 (틀리면 throw) */
export function parseGenetics(raw: unknown): GeneticsData {
  const g = geneticsSchema.parse(stripComments(raw));
  const problems: string[] = [];
  if (g.skin.randomWeights.length !== g.skin.steps.length) problems.push('skin.randomWeights 길이가 steps 와 다름');
  for (const c of g.hair.natural) if (!g.hair.dominance.includes(c)) problems.push(`hair.dominance 에 ${c} 없음`);
  for (const c of g.eyes.colors) if (!g.eyes.dominance.includes(c)) problems.push(`eyes.dominance 에 ${c} 없음`);
  for (const [a, b] of g.congenital.conflicts) {
    if (!g.congenital.ids.includes(a) || !g.congenital.ids.includes(b)) problems.push(`congenital.conflicts ${a}/${b} 가 ids 에 없음`);
  }
  for (const d of g.dyes.list) if (!(d.tier in g.dyes.rank)) problems.push(`dyes ${d.id}: tier ${d.tier} 등급 없음`);
  if (!(g.creation.servantMinStage in g.creation.stageAges)) problems.push('creation.servantMinStage 가 stageAges 에 없음');
  if (problems.length) throw new Error(`genetics.json: ${problems.join('; ')}`);
  return g;
}

/** "$comment" 설명 칸을 뺀 사본 (기록형 칸에도 설명을 달 수 있게) */
function stripComments(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripComments);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== '$comment') out[k] = stripComments(x);
    return out;
  }
  return v;
}

/** SimData.family 에서 유전 데이터 (파일 없으면 null → 유전 기능 꺼짐) */
export function geneticsFrom(family: FamilyRaw | undefined): GeneticsData | null {
  const raw = family?.genetics;
  return raw === undefined ? null : parseGenetics(raw);
}

// ------------------------------------------------------------------ 유전자 레코드

/** 대립 유전자를 누구에게서 받았는지: [어머니의 몇 번째, 아버지의 몇 번째] (0/1). 무작위 인물은 null */
export interface AlleleOrigin {
  hair: [number, number];
  eyes: [number, number];
}

export interface Genome {
  v: 1;
  /** 피부 단계 0..11 (밝음 → 어두움) */
  skin: number;
  /** 머리색 대립 유전자 [어머니에게서, 아버지에게서] */
  hair: [string, string];
  /** 눈색 대립 유전자 [어머니에게서, 아버지에게서] */
  eyes: [string, string];
  eyeShape: string;
  brows: string;
  build: string;
  height: string;
  /** 선천 특성 id (traits.json category congenital) */
  congenital: string[];
  /** 유전하지 않는 외형(머리 모양, 수염, 옷 선택)을 정하는 개인 씨앗 */
  seed: number;
  /** 대립 유전자 출처 기록 (격세유전 설명용) */
  origin: AlleleOrigin | null;
  /** 이번 세대에 변이한 부위 (eyeShape/brows/build/height/skin) */
  mutated: string[];
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.min(list.length - 1, rng.int(list.length))];
}

function pickWeighted(rng: Rng, list: readonly string[], freq: Record<string, number>): string {
  const i = rng.weighted(list.map((c) => freq[c] ?? 1));
  return list[i < 0 ? 0 : i];
}

export interface RandomGenomeOpts {
  /** 이 피부 단계 근처 (±2) 로 */
  skinNear?: number;
  /** 고정할 대립 유전자 */
  hair?: [string, string];
  eyes?: [string, string];
  /** 선천 특성 없이 */
  noCongenital?: boolean;
}

/** 무작위 유전자 (마을 사람, 만들기 "전체 무작위"). 대립 유전자는 freq 가중치로 따로 뽑음 */
export function randomGenome(g: GeneticsData, rng: Rng, opts: RandomGenomeOpts = {}): Genome {
  const steps = g.skin.steps.length;
  let skin: number;
  if (opts.skinNear !== undefined) skin = clamp(Math.round(opts.skinNear) + rng.int(5) - 2, 0, steps - 1);
  else {
    const i = rng.weighted(g.skin.randomWeights);
    skin = i < 0 ? 0 : i;
  }
  const hair: [string, string] = opts.hair ?? [pickWeighted(rng, g.hair.natural, g.hair.freq), pickWeighted(rng, g.hair.natural, g.hair.freq)];
  const eyes: [string, string] = opts.eyes ?? [pickWeighted(rng, g.eyes.colors, g.eyes.freq), pickWeighted(rng, g.eyes.colors, g.eyes.freq)];
  const eyeShape = pick(rng, g.parts.eyeShape);
  const brows = pick(rng, g.parts.brows);
  const build = pick(rng, g.parts.build);
  const height = pick(rng, g.parts.height);
  const congenital: string[] = [];
  for (const id of g.congenital.ids) {
    if (rng.next() < g.congenital.randomChance && !opts.noCongenital) addCongenital(g, congenital, id);
  }
  const seed = Math.floor(rng.next() * 0x100000000) >>> 0;
  return { v: 1, skin, hair: [hair[0], hair[1]], eyes: [eyes[0], eyes[1]], eyeShape, brows, build, height, congenital, seed, origin: null, mutated: [] };
}

function addCongenital(g: GeneticsData, list: string[], id: string): void {
  if (list.includes(id)) return;
  for (const [a, b] of g.congenital.conflicts) {
    if ((a === id && list.includes(b)) || (b === id && list.includes(a))) return;
  }
  list.push(id);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 자식 유전자 (10-3 표). Rng 호출 순서가 고정이라 같은 시드 = 같은 아이.
 * 결과 hair/eyes 의 [0] 은 어머니에게서, [1] 은 아버지에게서 받은 대립 유전자. origin 에 부모 쪽 몇 번째였는지 기록
 */
export function inherit(g: GeneticsData, mother: Genome, father: Genome, rng: Rng): Genome {
  const mutated: string[] = [];
  // 피부: 부모 사이 무작위 + ±drift
  const lo = Math.min(mother.skin, father.skin);
  const hi = Math.max(mother.skin, father.skin);
  let skin = lo + rng.int(hi - lo + 1);
  if (g.skin.drift > 0) {
    const d = rng.int(g.skin.drift * 2 + 1) - g.skin.drift;
    if (d !== 0) mutated.push('skin');
    skin = clamp(skin + d, 0, g.skin.steps.length - 1);
  }
  // 머리/눈: 부모 각각에서 하나씩
  const mh = rng.int(2);
  const fh = rng.int(2);
  const me = rng.int(2);
  const fe = rng.int(2);
  const hair: [string, string] = [mother.hair[mh], father.hair[fh]];
  const eyes: [string, string] = [mother.eyes[me], father.eyes[fe]];
  // 부위: 50:50 + 변이
  const part = (key: 'eyeShape' | 'brows' | 'build' | 'height'): string => {
    let v = rng.next() < 0.5 ? mother[key] : father[key];
    if (rng.next() < g.mutation) {
      v = pick(rng, g.parts[key]);
      mutated.push(key);
    }
    return v;
  };
  const eyeShape = part('eyeShape');
  const brows = part('brows');
  const build = part('build');
  const height = part('height');
  // 선천: 부모 한 사람마다 25% (id 순서 고정)
  const congenital: string[] = [];
  for (const id of g.congenital.ids) {
    for (const parent of [mother, father]) {
      if (!parent.congenital.includes(id)) continue;
      if (rng.next() < g.congenital.inherit) addCongenital(g, congenital, id);
    }
  }
  const seed = Math.floor(rng.next() * 0x100000000) >>> 0;
  return { v: 1, skin, hair, eyes, eyeShape, brows, build, height, congenital, seed, origin: { hair: [mh, fh], eyes: [me, fe] }, mutated };
}

/** 대립 유전자 둘 중 우성 (dominance 앞쪽). 목록에 없는 값은 가장 약함 */
export function dominant(order: readonly string[], a: string, b: string): string {
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  const ra = ia < 0 ? order.length : ia;
  const rb = ib < 0 ? order.length : ib;
  return ra <= rb ? a : b;
}

/** 표현되는 머리색 (노년 흰머리 전) */
export function hairColorOf(g: GeneticsData, genome: Genome): string {
  return dominant(g.hair.dominance, genome.hair[0], genome.hair[1]);
}

export function eyeColorOf(g: GeneticsData, genome: Genome): string {
  return dominant(g.eyes.dominance, genome.eyes[0], genome.eyes[1]);
}

/** 이 대립 유전자가 열성으로 숨어 있음 (가지고 있지만 표현 안 됨) */
export function carriesHidden(g: GeneticsData, genome: Genome, kind: 'hair' | 'eyes', allele: string): boolean {
  const alleles = genome[kind];
  const shown = kind === 'hair' ? hairColorOf(g, genome) : eyeColorOf(g, genome);
  return alleles.includes(allele) && shown !== allele;
}

export function coarseStage(stage: LifeStage | CoarseStage): CoarseStage {
  switch (stage) {
    case 'baby':
    case 'toddler':
    case 'child':
      return 'child';
    case 'teen':
      return 'teen';
    case 'young':
    case 'adult':
      return 'adult';
    default:
      return 'elder';
  }
}

/** 개인 씨앗 + 이름으로 0..1 (유전하지 않는 외형이 단계마다 같게) */
export function seeded(seed: number, key: string): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

function seededPick<T>(seed: number, key: string, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(seeded(seed, key) * list.length))];
}

/** 유전하지 않는 외형 선택 (만들기 화면에서 고른 값). 비우면 씨앗으로 정함 */
export interface LookChoice {
  hairStyle?: string;
  /** 수염 레이어 id 또는 "none" (성인 남성만 의미 있음) */
  beard?: string;
  /** 얼굴 표시: freckles/scar/mole/blush */
  marks?: string[];
  /** 흰머리 여부를 직접 정함 (노년) */
  elderHair?: string;
}

export interface ExpressOpts {
  estate?: string;
  outfit?: string;
  pregnant?: 0 | 1 | 2;
  /** 옷 색 (LPC 옷 팔레트 이름) */
  dyes?: { main?: string; accent?: string; trim?: string };
  look?: LookChoice;
}

/**
 * 렌더러가 읽는 appearance (src/render/lpc/types.ts CharacterSpec 과 같은 키).
 * 유전 정보 추가 키: layers.$build, $height, $eyeShape, $brows, $marks (렌더러가 아직 모르는 키는 무시함)
 */
export interface Appearance {
  sex: Sex;
  stage: CoarseStage;
  pregnant: 0 | 1 | 2;
  skin: string;
  hair: { style: string; color: string };
  estate: string;
  outfit: string;
  layers: Record<string, string>;
  [k: string]: unknown;
}

/**
 * 표현형: 유전자 → appearance. rng 를 주면 머리 모양/수염을 그걸로 뽑고 (단계 전환 때 새 머리),
 * 없으면 개인 씨앗으로 정함 (같은 유전자 + 단계 = 같은 모습)
 */
export function express(g: GeneticsData, genome: Genome, sex: Sex, stage: LifeStage | CoarseStage, rng?: Rng, opts: ExpressOpts = {}): Appearance {
  const cs = coarseStage(stage);
  const r = (key: string): number => (rng ? rng.next() : seeded(genome.seed, `${key}:${cs}`));
  const choose = <T>(key: string, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(r(key) * list.length))];
  const skin = g.skin.steps[clamp(genome.skin, 0, g.skin.steps.length - 1)];
  let color = hairColorOf(g, genome);
  if (cs === 'elder') {
    if (opts.look?.elderHair) color = opts.look.elderHair;
    // 흰머리 여부는 평생 한 번 정해짐 (씨앗)
    else if (seeded(genome.seed, 'elderHair') < g.hair.elderChance) color = seededPick(genome.seed, 'elderColor', g.hair.elder);
  }
  const styles = g.art.hairStyles[sex][cs];
  const style = opts.look?.hairStyle && styles.includes(opts.look.hairStyle) ? opts.look.hairStyle : choose('hairStyle', styles);
  const layers: Record<string, string> = {
    $seed: String(genome.seed & 0x7fffffff),
    $eyes: eyeColorOf(g, genome),
    $build: genome.build,
    $height: genome.height,
    $eyeShape: genome.eyeShape,
    $brows: genome.brows,
  };
  const head = g.art.heads[genome.build]?.[`${sex}.${cs}`];
  if (head) layers.$head = head;
  if (sex === 'male') {
    const chance = g.art.beardChance[cs] ?? 0;
    if (opts.look?.beard !== undefined) layers.$beard = chance > 0 ? opts.look.beard : 'none';
    else layers.$beard = chance > 0 && r('beard') < chance ? choose('beardStyle', g.art.beards) : 'none';
  }
  const marks = opts.look?.marks ?? [];
  if (marks.length) layers.$marks = [...marks].sort().join('+');
  if (opts.dyes?.main) layers.$main = opts.dyes.main;
  if (opts.dyes?.accent) layers.$accent = opts.dyes.accent;
  if (opts.dyes?.trim) layers.$trim = opts.dyes.trim;
  return {
    sex,
    stage: cs,
    pregnant: opts.pregnant ?? 0,
    skin,
    hair: { style, color },
    estate: opts.estate ?? 'freeman',
    outfit: opts.outfit ?? 'everyday',
    layers,
  };
}

// ------------------------------------------------------------------ 가문 닮음 지표

export interface FamilyFace {
  /** 표현형 조합 키 "피부|머리|눈|눈모양" */
  key: string;
  skin: string;
  hair: string;
  eyes: string;
  eyeShape: string;
  count: number;
  /** 전체 중 비율 0..1 */
  share: number;
  /** 이 조합을 가진 첫 유전자 (표지 초상용) */
  sample: Genome;
}

/** "가문의 얼굴" (10-3): 가장 자주 나온 외형 조합. 동률이면 먼저 나온 것 */
export function familyFace(g: GeneticsData, genomes: readonly Genome[]): FamilyFace | null {
  if (!genomes.length) return null;
  const counts = new Map<string, { n: number; first: number }>();
  const keys = genomes.map((gn, i) => {
    const k = `${g.skin.steps[clamp(gn.skin, 0, g.skin.steps.length - 1)]}|${hairColorOf(g, gn)}|${eyeColorOf(g, gn)}|${gn.eyeShape}`;
    const c = counts.get(k);
    if (c) c.n++;
    else counts.set(k, { n: 1, first: i });
    return k;
  });
  let best = keys[0];
  for (const [k, c] of counts) {
    const b = counts.get(best)!;
    if (c.n > b.n || (c.n === b.n && c.first < b.first)) best = k;
  }
  const b = counts.get(best)!;
  const [skin, hair, eyes, eyeShape] = best.split('|');
  return { key: best, skin, hair, eyes, eyeShape, count: b.n, share: b.n / genomes.length, sample: genomes[b.first] };
}

// ------------------------------------------------------------------ 저장 (유전자 레코드 검사)

export const genomeSchema = z.object({
  v: z.literal(1),
  skin: z.number().int().min(0).max(63),
  hair: z.tuple([z.string().max(40), z.string().max(40)]),
  eyes: z.tuple([z.string().max(40), z.string().max(40)]),
  eyeShape: z.string().max(40),
  brows: z.string().max(40),
  build: z.string().max(40),
  height: z.string().max(40),
  congenital: z.array(z.string().max(40)).max(16),
  seed: z.number().int().min(0).max(0xffffffff),
  origin: z.object({
    hair: z.tuple([z.number().int().min(0).max(1), z.number().int().min(0).max(1)]),
    eyes: z.tuple([z.number().int().min(0).max(1), z.number().int().min(0).max(1)]),
  }).nullable(),
  mutated: z.array(z.string().max(20)).max(8),
}).strict();

/** 유전자 값이 데이터 목록 안에 있는지 (불러온 파일 검사). 문제 목록 반환 */
export function genomeProblems(g: GeneticsData, genome: Genome): string[] {
  const out: string[] = [];
  if (genome.skin < 0 || genome.skin >= g.skin.steps.length) out.push(`skin ${genome.skin}`);
  for (const c of genome.hair) if (!g.hair.natural.includes(c)) out.push(`hair ${c}`);
  for (const c of genome.eyes) if (!g.eyes.colors.includes(c)) out.push(`eyes ${c}`);
  for (const k of ['eyeShape', 'brows', 'build', 'height'] as const) if (!g.parts[k].includes(genome[k])) out.push(`${k} ${genome[k]}`);
  for (const c of genome.congenital) if (!g.congenital.ids.includes(c)) out.push(`congenital ${c}`);
  return out;
}
