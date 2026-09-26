/**
 * 데이터 검사 (BRIEF 1장: CI 에서 전체 데이터 검증 + 도달 가능성 검사).
 * - zod 스키마 + 참조 검사 (validateSimData)
 * - 아트 팩: 물건/벽/타일 참조가 모두 있고 이미지 파일이 있음, 사각형이 이미지 안에 있음
 * - 부지: 모든 물건의 상호작용 슬롯에 스폰 지점에서 걸어서 닿음 (도달 가능성)
 * - i18n: 데이터가 쓰는 모든 키가 ko 에 있음 (영어/키 문자열 노출 0)
 * - UI 아이콘: 상호작용/욕구/살림 아이콘이 아틀라스에 있음
 * 사용: npx tsx tools/check-data.ts
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { validateSimData } from '../src/sim/data/simData';
import { Simulation } from '../src/sim/sim';
import { PathFinder } from '../src/sim/action/path';
import { lotFromTiled, type TiledMap } from '../src/sim/world/tiled';
import type { LotDef } from '../src/sim/core/types';

const errors: string[] = [];
const warn: string[] = [];
const json = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

const needs = json<Record<string, unknown>>('src/data/needs.json');
const balance = json<Record<string, unknown>>('src/data/balance.json');
const interactions = json<{ interactions: Record<string, { nameKey: string; icon: string }> }>('src/data/interactions.json');
const objects = json<Record<string, { nameKey: string }>>('src/data/objects.json');
const lotJson = json<LotDef>('src/data/lots/cottage.json');
// 게임(src/i18n/index.ts)처럼 ko/*.json 을 전부 합침
const ko: Record<string, string> = Object.assign({}, ...readdirSync('src/i18n/ko').filter((f) => f.endsWith('.json')).map((f) => json<Record<string, string>>(`src/i18n/ko/${f}`)));
const pack = json<{
  tilePx: number;
  images: Record<string, string>;
  tiles: Record<string, { image: string; x: number; y: number; w?: number; h?: number }>;
  sprites: Record<string, { image: string; x: number; y: number; w: number; h: number; frames?: number; frameDx?: number }>;
  walls: Record<string, Record<string, string | undefined>>;
  objects: Record<string, { default: string; states?: Record<string, string> }>;
}>('src/data/artpacks/epic.json');

// 1) 스키마 + 참조
let data;
try {
  data = validateSimData({ needs, balance, interactions, objects, lot: lotJson } as never);
} catch (e) {
  errors.push(`schema: ${String(e)}`);
}

// Tiled 파일이 있으면 json 과 같아야 함
if (existsSync('src/data/lots/cottage.tmj')) {
  const fromTmj = lotFromTiled(json<TiledMap>('src/data/lots/cottage.tmj'));
  const norm = (l: LotDef) => ({ ...l, objects: l.objects.map((o) => ({ id: o.id, x: o.x, y: o.y, rot: o.rot ?? 0 })) });
  const a = norm(fromTmj);
  const b = norm(lotJson);
  for (const k of ['w', 'h', 'ground', 'floor', 'walls', 'openings', 'objects', 'spawn'] as const) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) errors.push(`cottage.tmj 와 cottage.json 의 ${k} 가 다름 (tools/lot-to-tiled.ts 로 다시 내보내기)`);
  }
}

// 2) 아트 팩
const sizes = new Map<string, { w: number; h: number }>();
for (const [id, path] of Object.entries(pack.images)) {
  if (!existsSync(path)) {
    errors.push(`image ${id}: 파일 없음 ${path}`);
    continue;
  }
  const png = PNG.sync.read(readFileSync(path));
  sizes.set(id, { w: png.width, h: png.height });
}
const inImage = (what: string, image: string, x: number, y: number, w: number, h: number) => {
  const s = sizes.get(image);
  if (!s) return errors.push(`${what}: 이미지 ${image} 없음`);
  if (x < 0 || y < 0 || x + w > s.w || y + h > s.h) errors.push(`${what}: 사각형이 이미지 밖 (${x},${y},${w},${h}) / ${s.w}x${s.h}`);
};
for (const [id, t] of Object.entries(pack.tiles)) inImage(`tile ${id}`, t.image, t.x, t.y, t.w ?? pack.tilePx, t.h ?? pack.tilePx);
for (const [id, s] of Object.entries(pack.sprites)) {
  const frames = s.frames ?? 1;
  inImage(`sprite ${id}`, s.image, s.x, s.y, s.w + (frames - 1) * (s.frameDx ?? s.w), s.h);
}
for (const id of Object.keys(objects)) {
  const e = pack.objects[id];
  if (!e) {
    errors.push(`object ${id}: epic.json objects 에 그림 없음`);
    continue;
  }
  for (const sid of [e.default, ...Object.values(e.states ?? {})]) if (!pack.sprites[sid]) errors.push(`object ${id}: 스프라이트 ${sid} 없음`);
}
for (const [id, w] of Object.entries(pack.walls)) {
  for (const k of ['face', 'faceCut', 'top']) {
    const v = w[k];
    if (!v || (!pack.sprites[v] && !pack.tiles[v])) errors.push(`wall ${id}.${k}: ${v} 없음`);
  }
}
for (const arr of [lotJson.ground, lotJson.floor]) for (const v of arr) if (v && !pack.tiles[v]) errors.push(`lot tile ${v} 없음`);
for (const v of lotJson.walls) if (v && !pack.walls[v]) errors.push(`lot wall ${v} 없음`);
for (const item of ['book', 'bowl', 'bucket', 'logs', 'pot']) if (!pack.sprites[`carry_${item}`]) warn.push(`carry_${item} 스프라이트 없음 (들기 물건 안 보임)`);

// 3) 도달 가능성: 모든 물건의 슬롯 중 하나 이상이 스폰에서 닿음
if (data) {
  const sim = new Simulation(data, 1);
  const w = sim.world;
  const pf = new PathFinder(w.grid);
  const g = w.grid;
  const start = g.idx(lotJson.spawn.x, lotJson.spawn.y);
  if (!g.walkable(start)) errors.push('spawn 칸이 걸을 수 없는 칸');
  for (const o of w.objects) {
    const slots = w.slots(o);
    if (!slots.length) continue;
    const ok = slots.some((s) => {
      const cell = w.slotCell(o, s);
      return pf.find(start, cell, s.pose !== 'stand') !== null;
    });
    if (!ok) errors.push(`도달 불가: ${o.defId} (${o.x},${o.y}) 의 어느 슬롯에도 길이 없음`);
  }
}

// 4) i18n
const need = (k: string, where: string) => {
  if (!(k in ko)) errors.push(`i18n 누락: ${k} (${where})`);
};
for (const [id, ia] of Object.entries(interactions.interactions)) need(ia.nameKey, id);
for (const [id, o] of Object.entries(objects)) need(o.nameKey, id);
for (const n of Object.keys((needs as { needs: Record<string, unknown> }).needs)) need(`need.${n}`, 'needs');
for (const k of Object.keys((balance as { startStock: Record<string, number> }).startStock)) need(`item.${k}`, 'startStock');
const src = readFileSync('src/sim/action/interactions.ts', 'utf8') + readFileSync('src/sim/sim.ts', 'utf8');
for (const m of src.matchAll(/notice\(p, '([a-z_]+)'/g)) need(`notice.${m[1]}`, 'sim notice');
for (const [id, ia] of Object.entries(interactions.interactions)) {
  const r = (ia as unknown as { requires?: Record<string, Record<string, unknown>> }).requires ?? {};
  for (const [kind, v] of Object.entries(r)) {
    if (kind === 'targetState') for (const [k, val] of Object.entries(v)) need(`reason.state.${k}.${val}`, id);
    if (kind === 'targetMin') for (const k of Object.keys(v)) need(`reason.min.${k}`, id);
    if (kind === 'targetMax') for (const k of Object.keys(v)) need(`reason.max.${k}`, id);
    if (kind === 'stock') for (const k of Object.keys(v)) need(`item.${k}`, id);
    if (kind === 'exists') need(`reason.exists.${(v as { object: string }).object}`, id);
  }
}

// 5) UI 아이콘
if (existsSync('src/data/ui/atlas.json')) {
  const atlas = json<{ sprites: Record<string, unknown> }>('src/data/ui/atlas.json');
  const icons = new Set<string>();
  for (const ia of Object.values(interactions.interactions)) icons.add(ia.icon);
  for (const n of Object.keys((needs as { needs: Record<string, unknown> }).needs)) icons.add(`need.${n}`);
  // 재고 품목 아이콘: items.json 의 icon (없으면 item.<id>)
  const itemsDef = existsSync('src/data/items.json') ? json<{ items: Record<string, { icon: string }> }>('src/data/items.json').items : {};
  for (const k of Object.keys((balance as { startStock: Record<string, number> }).startStock)) icons.add(itemsDef[k]?.icon ?? `item.${k}`);
  for (const it of Object.values(itemsDef)) icons.add(it.icon);
  for (const k of icons) if (!atlas.sprites[k]) errors.push(`UI 아이콘 없음: ${k}`);
} else warn.push('src/data/ui/atlas.json 없음 (아이콘 미표시)');

for (const w of warn) console.warn(`경고: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`오류: ${e}`);
  console.error(`check:data 실패 ${errors.length}건`);
  process.exit(1);
}
console.log(`check:data 통과 (경고 ${warn.length})`);
