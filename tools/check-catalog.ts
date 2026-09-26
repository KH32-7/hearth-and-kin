// 구매 카탈로그 검사 (contracts-m5.md 2-3). 실패하면 exit 1
// npx tsx tools/check-catalog.ts
import fs from 'node:fs';
import path from 'node:path';

const json = <T>(f: string): T => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
interface Entry {
  nameKey: string; category: string; as: string | null; footprint: { w: number; h: number }; blocks?: boolean; wallMounted?: boolean;
  surface?: boolean; underRug?: boolean; rotations?: number[]; flip?: boolean; price: number; quality?: number; roomScore?: number;
  estate?: string | null; roomType?: string; durable?: boolean; tags?: string[]; light?: number; slots?: unknown[]; variants?: Record<string, string[]>;
}
interface ArtObj { default: string; states?: Record<string, string>; extra?: Record<string, string>; rot?: Record<string, string>; blanket?: string; lieHeads?: Record<string, [number, number]> }

const catalog = json<{ catalog: Record<string, Entry> }>('src/data/catalog.json').catalog;
const objects = json<Record<string, { footprint: { w: number; h: number }; tags?: string[] }>>('src/data/objects.json');
const pack = json<{ images: Record<string, string>; sprites: Record<string, { image: string }>; objects: Record<string, ArtObj> }>('src/data/artpacks/epic.json');
const ko: Record<string, string> = {};
for (const f of fs.readdirSync('src/i18n/ko').filter((f) => f.endsWith('.json'))) Object.assign(ko, json<Record<string, string>>(path.join('src/i18n/ko', f)));

const MIN: Record<string, number> = { bedroom: 30, kitchen: 40, dining: 25, living: 25, hygiene: 12, work: 30, decor: 60, light: 20, kids: 10, animal: 10, outdoor: 30, religion: 10 };
const ESTATES = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'];
const VARIANTS: Record<string, string[]> = { wood: ['oak', 'walnut', 'pine', 'ebony'], cloth: ['red', 'blue', 'green', 'yellow', 'purple', 'brown', 'grey', 'white'] };
const NOT_BASE = new Set(['stairs_wood', 'stairs_stone', 'cellar_hatch']);

const errors: string[] = [];
const err = (m: string) => errors.push(m);
const sprite = (id: string, where: string) => {
  const s = pack.sprites[id];
  if (!s) return err(`${where}: 스프라이트 ${id} 없음`);
  const file = pack.images[s.image];
  if (!file) return err(`${where}: 스프라이트 ${id} 의 이미지 ${s.image} 없음`);
  if (!fs.existsSync(file)) err(`${where}: 이미지 파일 ${file} 없음 (build-world 를 먼저 실행)`);
};

const ids = Object.keys(catalog).filter((k) => !k.startsWith('$'));
const perCat: Record<string, number> = {};
let looks = 0;
for (const id of ids) {
  const c = catalog[id];
  perCat[c.category] = (perCat[c.category] ?? 0) + 1;
  if (!(c.category in MIN)) err(`${id}: 분류 ${c.category} 이상`);
  if (objects[id]) err(`${id}: objects.json 기본 물건 id 와 겹침`);
  if (!/^[a-z][a-z0-9_]*$/.test(id) || id.includes('__')) err(`${id}: id 형식 (영어 snake_case, __ 금지)`);
  if (!Number.isInteger(c.price) || c.price <= 0) err(`${id}: 가격 ${c.price}`);
  if (c.roomScore === undefined || c.roomScore < -3 || c.roomScore > 8) err(`${id}: roomScore ${c.roomScore}`);
  if (c.quality === undefined || c.quality < 0 || c.quality > 4) err(`${id}: quality ${c.quality}`);
  if (c.estate != null && !ESTATES.includes(c.estate)) err(`${id}: estate ${c.estate}`);
  if (!c.footprint || c.footprint.w < 1 || c.footprint.h < 1) err(`${id}: footprint`);
  if (c.nameKey !== `object.${id}` || !ko[c.nameKey]) err(`${id}: 이름 ${c.nameKey} 없음`);
  else if (/[A-Za-z0-9]/.test(ko[c.nameKey])) err(`${id}: 이름에 영어/숫자 "${ko[c.nameKey]}"`);
  // 기능 기반
  const base = c.as ? objects[c.as] : null;
  if (c.as) {
    if (!base) err(`${id}: 기반 ${c.as} 없음`);
    else if (NOT_BASE.has(c.as)) err(`${id}: ${c.as} 는 카탈로그 기반으로 쓰지 않음`);
    else if ((base.footprint.w !== c.footprint.w || base.footprint.h !== c.footprint.h) && !c.slots?.length) err(`${id}: 발자국이 기반 ${c.as} 와 다른데 slots 없음`);
  }
  // 변형 이름
  const vs: string[] = [];
  for (const [kind, list] of Object.entries(c.variants ?? {})) {
    if (!VARIANTS[kind]) { err(`${id}: 변형 종류 ${kind}`); continue; }
    for (const v of list) { if (!VARIANTS[kind].includes(v)) err(`${id}: 변형 ${v} 는 ${kind} 에 없음`); if (!ko[`variant.${v}`]) err(`variant.${v} 이름 없음`); vs.push(v); }
  }
  // 그림 (원본 + 변형)
  const baseArt = c.as ? pack.objects[c.as] : null;
  for (const oid of [id, ...vs.map((v) => `${id}__${v}`)]) {
    looks++;
    const a = pack.objects[oid];
    if (!a) { err(`${oid}: epic.json objects 에 그림 없음`); continue; }
    sprite(a.default, oid);
    for (const s of Object.values(a.states ?? {})) sprite(s, oid);
    for (const s of Object.values(a.extra ?? {})) sprite(s, oid);
    for (const s of Object.values(a.rot ?? {})) sprite(s, oid);
    if (a.blanket) sprite(a.blanket, oid);
    for (const r of c.rotations ?? [0]) if (r !== 0 && !a.rot?.[String(r)]) err(`${oid}: 회전 ${r} 그림 없음`);
    if (baseArt) {
      for (const k of Object.keys(baseArt.states ?? {})) if (!a.states?.[k]) err(`${oid}: 기반 ${c.as} 의 상태 ${k} 그림 없음`);
      for (const k of Object.keys(baseArt.extra ?? {})) if (!a.extra?.[k]) err(`${oid}: 기반 ${c.as} 의 extra ${k} 없음`);
      if (baseArt.blanket && !a.blanket) err(`${oid}: 침대 이불(blanket) 그림 없음`);
      for (const k of Object.keys(baseArt.lieHeads ?? {})) if (!a.lieHeads?.[k]) err(`${oid}: lieHeads.${k} 없음`);
    }
  }
}
for (const [cat, n] of Object.entries(MIN)) {
  if ((perCat[cat] ?? 0) < n) err(`분류 ${cat}: ${perCat[cat] ?? 0}종 < ${n}`);
  if (!ko[`catalog.cat.${cat}`]) err(`catalog.cat.${cat} 이름 없음`);
}
if (ids.length < 300) err(`총 ${ids.length}종 < 300`);
if (looks < 600) err(`변형 포함 ${looks} < 600`);

console.log(`catalog: ${ids.length}종, 변형 포함 ${looks} (${Object.entries(perCat).map(([k, v]) => `${k} ${v}`).join(', ')})`);
if (errors.length) {
  for (const e of errors.slice(0, 200)) console.error('  ✗ ' + e);
  console.error(`check-catalog: ${errors.length}개 실패`);
  process.exit(1);
}
console.log('check-catalog: 통과');
