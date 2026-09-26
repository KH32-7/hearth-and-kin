/**
 * 이름 (GDD 10-4): 신분·성별 이름 풀 (names.json, 개인 신분을 읽음 16-2), 가문명 (clan_names.json),
 * 농노 표시 이름 ("애쉬포드의 톰"), 사건 별명 (bynames).
 * 문장 틀은 i18n (src/i18n/ko/genetics.json 의 name.* 키) 이 가짐. sim 은 {키, 인자} 만 돌려줌.
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import type { FamilyRaw } from '../data/simData';
import type { Sex } from './genetics';

const namePool = z.object({ male: z.array(z.string().min(1)).min(1), female: z.array(z.string().min(1)).min(1) });

export const namesSchema = z.object({
  estates: z.record(z.string(), namePool),
  bynames: z.array(z.object({ pattern: z.string().min(1), when: z.string().min(1) })),
}).loose();
export type NamesData = z.infer<typeof namesSchema>;

export const clanNamesSchema = z.object({
  placeOrigin: z.string(),
  householdPattern: z.string(),
  clans: z.array(z.object({ name: z.string().min(1), estateHint: z.enum(['low', 'mid', 'high']) })).min(1),
}).loose();
export type ClanNamesData = z.infer<typeof clanNamesSchema>;

export function parseNames(raw: unknown): NamesData {
  return namesSchema.parse(raw);
}

export function parseClanNames(raw: unknown): ClanNamesData {
  return clanNamesSchema.parse(raw);
}

export function namesFrom(family: FamilyRaw | undefined): NamesData | null {
  return family?.names === undefined ? null : parseNames(family.names);
}

export function clanNamesFrom(family: FamilyRaw | undefined): ClanNamesData | null {
  return family?.clanNames === undefined ? null : parseClanNames(family.clanNames);
}

/** 신분 → 가문명 풀 등급. 농노는 가문명 없음 (null) */
export const CLAN_HINT: Record<string, 'low' | 'mid' | 'high' | null> = {
  serf: null,
  freeman: 'low',
  artisan: 'mid',
  merchant: 'mid',
  clergy: 'mid',
  knight: 'high',
  noble: 'high',
};

/**
 * 이름 뽑기: 개인 신분·성별 풀에서, taken (가족·가정 안 이미 쓰는 이름) 과 겹치지 않게.
 * 풀이 다 차면 겹치는 이름이라도 돌려줌 (아주 큰 가족)
 */
export function pickName(data: NamesData, rng: Rng, estate: string, sex: Sex, taken: Iterable<string> = []): string {
  const pool = (data.estates[estate] ?? data.estates.freeman ?? Object.values(data.estates)[0])[sex];
  const used = new Set(taken);
  const free = pool.filter((n) => !used.has(n));
  const list = free.length ? free : pool;
  return list[Math.min(list.length - 1, rng.int(list.length))];
}

/** 가문명 뽑기 (신분 등급 풀에서, 이미 있는 가문과 겹치지 않게). 농노 = null */
export function pickClanName(data: ClanNamesData, rng: Rng, estate: string, taken: Iterable<string> = []): string | null {
  const hint = estate in CLAN_HINT ? CLAN_HINT[estate] : 'low';
  if (hint === null) return null;
  const used = new Set(taken);
  const tier = data.clans.filter((c) => c.estateHint === hint).map((c) => c.name);
  const free = tier.filter((n) => !used.has(n));
  const any = data.clans.map((c) => c.name).filter((n) => !used.has(n));
  const list = free.length ? free : any.length ? any : tier;
  return list[Math.min(list.length - 1, rng.int(list.length))];
}

export interface NameSubject {
  name: string;
  /** 가문명 (농노는 null) */
  clan?: string | null;
  estate: string;
  /** 출신지 (농노 표시 이름에 씀) */
  origin?: string | null;
  /** 붙은 별명 (완성된 문장, 예: "대장장이 톰") */
  byname?: string | null;
}

/** i18n 키와 인자. UI/연대기가 ko 틀로 채움 (formatName) */
export interface NameParts {
  key: 'name.full' | 'name.serf' | 'name.single' | 'name.byname';
  args: Record<string, string>;
}

/**
 * 표시 이름 (10-4): 별명이 있으면 별명, 가문명이 있으면 "이름 가문명",
 * 농노(가문명 없음)는 출신지가 있으면 "출신지의 이름", 없으면 이름만
 */
export function nameParts(p: NameSubject): NameParts {
  if (p.byname) return { key: 'name.byname', args: { byname: p.byname } };
  if (p.clan) return { key: 'name.full', args: { name: p.name, clan: p.clan } };
  if (p.origin) return { key: 'name.serf', args: { name: p.name, place: p.origin } };
  return { key: 'name.single', args: { name: p.name } };
}

/** 틀의 {이름} 자리를 채움. 없는 인자는 그대로 둠 */
export function formatName(template: string, args: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in args ? args[k] : m));
}

/** 이 조건(when, 예: "career:smith", "trait:brave", "event:freed")에 붙을 수 있는 별명 틀 */
export function bynamePatterns(data: NamesData, when: string): string[] {
  return data.bynames.filter((b) => b.when === when).map((b) => b.pattern);
}

/**
 * 별명 붙이기 (10-4): 사건/직업/특성 → bynames 틀 하나를 골라 채움. 맞는 틀이 없으면 null.
 * vars 에 name 은 꼭, place/father/mother 는 틀이 쓰면
 */
export function giveByname(data: NamesData, rng: Rng, when: string, vars: Record<string, string>): string | null {
  const list = bynamePatterns(data, when);
  if (!list.length) return null;
  const pattern = list[Math.min(list.length - 1, rng.int(list.length))];
  const text = formatName(pattern, vars);
  return /\{\w+\}/.test(text) ? null : text;
}
