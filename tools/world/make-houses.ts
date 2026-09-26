/**
 * 미리 만든 집 (GDD 23-6): 집 등급 6단계(오두막 < 농가/작은 집 < 장인 공방 겸 집 < 상인 저택 < 기사 장원 < 영주 성 거주동) × 3~4채.
 * 손으로 그리지 않고 실제 건축 엔진(Builder)에 편집 의도를 넣어 지음 → 모든 집이 방 인식, 받침, 길 막힘 경고 0, 신분 제한, 값 계산을 통과.
 *   npx tsx tools/world/make-houses.ts
 * 결과: src/data/lots/houses/<id>.json (부지), src/data/houses.json (목록: 등급, 신분, 값, 크기, 방 수), artifacts/qa/m5/houses.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { simRaw } from '../data-node';
import { validateSimData, type SimData } from '../../src/sim/data/simData';
import { Simulation } from '../../src/sim/sim';
import type { BuildOp, BuildResult } from '../../src/sim/build/builder';
import { Rng } from '../../src/sim/core/rng';
import type { LotDef } from '../../src/sim/core/types';
import { rowOf } from '../../src/sim/world/lot';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
process.chdir(ROOT);

type RoomKind = 'hut' | 'kitchen' | 'bedroom' | 'workshop' | 'hall' | 'pantry' | 'study' | 'chapel' | 'shop';
interface Tier {
  tier: number;
  id: string;
  estate: string;
  lot: [number, number];
  size: [number, number];
  floors: number;
  cellar: boolean;
  walls: string[];
  wallsUp: string[];
  floorsMat: string[];
  roofs: string[];
  doors: string[];
  windows: string[];
  ground: RoomKind[];
  upper: RoomKind[];
  /** 가구 값 상한 (파딩) */
  budget: number;
  yard: string[];
}

const TIERS: Tier[] = [
  { tier: 0, id: 'hut', estate: 'serf', lot: [12, 10], size: [7, 5], floors: 1, cellar: false, walls: ['wall_daub', 'wall_plank'], wallsUp: [], floorsMat: ['floor_dirt', 'floor_straw'], roofs: ['roof_thatch'], doors: ['door_plank'], windows: ['win_shutter'], ground: ['hut'], upper: [], budget: 100, yard: ['woodpile'] },
  { tier: 1, id: 'farmhouse', estate: 'freeman', lot: [20, 16], size: [10, 6], floors: 1, cellar: false, walls: ['wall_timber', 'wall_daub_white', 'wall_plank'], wallsUp: [], floorsMat: ['floor_plank_rough', 'floor_wood'], roofs: ['roof_thatch', 'roof_shingle'], doors: ['door_plank', 'door_ledged', 'door_half'], windows: ['win_shutter', 'win_lattice'], ground: ['kitchen', 'bedroom'], upper: [], budget: 150, yard: ['woodpile', 'garden_plot', 'chopping_block'] },
  { tier: 2, id: 'workshop_house', estate: 'artisan', lot: [20, 16], size: [10, 6], floors: 2, cellar: false, walls: ['wall_timber', 'wall_stone', 'wall_timber_rose'], wallsUp: ['wall_timber', 'wall_timber_rose', 'wall_daub_white'], floorsMat: ['floor_wood', 'floor_flagstone'], roofs: ['roof_shingle', 'roof_tile'], doors: ['door_ledged', 'door_studded'], windows: ['win_lattice'], ground: ['workshop', 'kitchen'], upper: ['bedroom', 'bedroom'], budget: 250, yard: ['woodpile', 'well'] },
  { tier: 3, id: 'merchant_house', estate: 'merchant', lot: [28, 22], size: [15, 8], floors: 2, cellar: true, walls: ['wall_brick', 'wall_ashlar', 'wall_stone_white'], wallsUp: ['wall_timber_rose', 'wall_brick', 'wall_stone_white'], floorsMat: ['floor_tile_red', 'floor_wood_dark'], roofs: ['roof_tile', 'roof_slate'], doors: ['door_arch', 'door_studded'], windows: ['win_glass', 'win_lattice'], ground: ['shop', 'kitchen', 'pantry'], upper: ['bedroom', 'bedroom', 'study'], budget: 800, yard: ['well'] },
  { tier: 4, id: 'manor', estate: 'knight', lot: [28, 22], size: [17, 9], floors: 2, cellar: true, walls: ['wall_ashlar', 'wall_stone'], wallsUp: ['wall_ashlar', 'wall_stone_white'], floorsMat: ['floor_flagstone', 'floor_tile_check'], roofs: ['roof_slate'], doors: ['door_studded', 'door_arch'], windows: ['win_glass', 'win_lattice'], ground: ['hall', 'kitchen', 'chapel'], upper: ['bedroom', 'bedroom', 'study'], budget: 5200, yard: ['well'] },
  { tier: 5, id: 'castle_hall', estate: 'noble', lot: [40, 30], size: [21, 11], floors: 2, cellar: true, walls: ['wall_ashlar'], wallsUp: ['wall_ashlar', 'wall_stone_white'], floorsMat: ['floor_tile_check', 'floor_flagstone'], roofs: ['roof_slate'], doors: ['door_arch'], windows: ['win_glass', 'win_stained'], ground: ['hall', 'kitchen', 'chapel', 'pantry'], upper: ['bedroom', 'bedroom', 'bedroom', 'study'], budget: 12000, yard: ['well'] },
];
/** 등급마다 몇 채 (합 21) */
const COUNT = [4, 4, 4, 3, 3, 3];

/** 방 종류별 가구: [기능 기반 또는 태그, 몇 개]. 앞쪽이 먼저 (벽 붙이기 화로는 맨 앞) */
const PROGRAM: Record<RoomKind, [string, number][]> = {
  hut: [['hearth', 1], ['bed_straw', 2], ['stool', 1], ['chest_clothes', 1], ['barrel_water', 1], ['chamber_pot', 1]],
  kitchen: [['hearth', 1], ['dining_table', 1], ['bench', 1], ['stool', 1], ['cupboard', 1], ['prep_counter', 1], ['barrel_water', 1], ['candlestick', 1]],
  bedroom: [['bed_double', 1], ['bed_straw', 1], ['chest_clothes', 1], ['chamber_pot', 1], ['washbasin', 1], ['candlestick', 1], ['rug', 1]],
  workshop: [['workbench', 1], ['loom', 1], ['spinning_wheel', 1], ['stool', 1], ['chest_clothes', 1], ['candlestick', 1]],
  hall: [['dining_table', 2], ['chair', 2], ['bench', 2], ['tapestry', 2], ['candlestick', 2], ['rug', 1], ['lute', 1]],
  pantry: [['cupboard', 2], ['barrel_water', 1], ['churn', 1], ['salting_tub', 1]],
  study: [['bookshelf', 2], ['dining_table', 1], ['chair', 1], ['candlestick', 1], ['tapestry', 1]],
  chapel: [['shrine', 1], ['candlestick', 2], ['bench', 1]],
  shop: [['dining_table', 1], ['cupboard', 2], ['chest_clothes', 1], ['stool', 1], ['candlestick', 1]],
};


function emptyLot(w: number, h: number, id: string): LotDef {
  const g: (string | null)[] = [];
  const cx = Math.floor(w / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g.push(Math.abs(x - cx) <= 1 && y >= h - 4 ? 'dirt' : 'grass');
  return { id, w, h, ground: g, floor: g.map(() => null), walls: g.map(() => null), openings: [], objects: [], spawn: { x: cx, y: h - 2 }, exits: [{ x: cx, y: h - 1 }] };
}

function loadData(lot: LotDef): SimData {
  const raw = simRaw({});
  return validateSimData({ ...raw, lot } as never);
}

interface Built {
  id: string;
  nameKey: string;
  tier: number;
  estate: string;
  lot: LotDef;
  price: number;
  /** 건물 값 (벽/바닥/지붕/문창/계단/지하). price - structure = 가구 */
  structure: number;
  rooms: number;
  floors: number;
  objects: number;
}

function build(t: Tier, idx: number): Built {
  const rng = new Rng(1000 + t.tier * 97 + idx * 13);
  const pick = <T>(a: T[]): T => a[Math.floor(rng.next() * a.length)];
  const [LW, LH] = t.lot;
  const id = `${t.id}_${idx + 1}`;
  const lot0 = emptyLot(LW, LH, id);
  const data = loadData(lot0);
  const sim = new Simulation(data, 7);
  sim.addPerson('목수', undefined, undefined, { estate: t.estate });
  sim.econ!.account(1)!.money = 10_000_000;
  const R = (lv: number, y: number) => rowOf(lv, y, LH);
  let spent = 0;
  const fails: string[] = [];
  const B = (op: BuildOp, must = true): BuildResult => {
    const r = sim.apply({ kind: 'build', op }) as BuildResult;
    if (r.ok) spent += r.cost;
    else if (must) fails.push(`${op.op}:${r.reason}`);
    return r;
  };
  // 크기: 등급 기본 ± 1
  const bw = t.size[0] + Math.floor(rng.next() * 3) - 1;
  const bd = t.size[1] + (rng.next() < 0.5 ? 0 : 1);
  const x0 = Math.floor((LW - bw) / 2);
  const y0 = Math.max(1, LH - bd - 5);
  const x1 = x0 + bw - 1;
  const y1 = y0 + bd - 1;
  const wall = pick(t.walls);
  const wallUp = t.wallsUp.length ? pick(t.wallsUp) : wall;
  const fl = pick(t.floorsMat);
  const door = pick(t.doors);
  const win = pick(t.windows);
  // 방 칸막이: 세로 벽으로 나눔 (가로 너비 비례)
  const splits = (n: number): number[] => {
    const out: number[] = [];
    for (let k = 1; k < n; k++) out.push(x0 + Math.round(((x1 - x0) * k) / n));
    return out;
  };
  const rooms: { level: number; kind: RoomKind; xa: number; xb: number; ya: number; yb: number }[] = [];
  const floorLevel = (lv: number, kinds: RoomKind[], wallStyle: string) => {
    if (lv > 0) B({ op: 'floor', x0, y0: R(lv, y0), x1, y1: R(lv, y1), style: fl });
    B({ op: 'room', x0, y0: R(lv, y0), x1, y1: R(lv, y1), style: wallStyle, floor: lv === 0 ? fl : undefined });
    const sp = splits(kinds.length);
    const xs = [x0, ...sp, x1];
    for (const sx of sp) B({ op: 'wall', x0: sx, y0: R(lv, y0), x1: sx, y1: R(lv, y1), style: wallStyle });
    // 칸막이 문 (가운데 줄에서 한 칸 위아래로 흔듦)
    const dy = Math.floor((y0 + y1) / 2);
    for (const sx of sp) B({ op: 'opening', x: sx, y: R(lv, dy), kind: 'door', variant: pick(t.doors) });
    for (let k = 0; k < kinds.length; k++) rooms.push({ level: lv, kind: kinds[k], xa: xs[k] + 1, xb: xs[k + 1] - 1, ya: y0 + 1, yb: y1 - 1 });
    return xs;
  };
  const xsG = floorLevel(0, t.ground, wall);
  // 바깥 문: 첫 방 남쪽 벽 가운데, 부지 길 쪽
  const cx = Math.floor(LW / 2);
  const firstRoom = rooms.findIndex((r) => r.xa <= cx && cx <= r.xb);
  const doorX = firstRoom >= 0 ? cx : Math.floor((xsG[0] + xsG[1]) / 2);
  B({ op: 'opening', x: doorX, y: R(0, y1), kind: 'door', variant: door });
  // 부지 길을 문까지 이음
  B({ op: 'terrain', x0: doorX, y0: y1 + 1, x1: doorX, y1: LH - 1, style: t.tier >= 3 ? 'gravel' : 'dirt' }, false);
  // 창: 남북 벽 3칸마다 (문 옆/칸막이 옆/모서리 피함)
  const windows = (lv: number, wallStyle: string) => {
    void wallStyle;
    for (const wy of [y0, y1]) {
      for (let x = x0 + 2; x <= x1 - 2; x += 3) {
        if (Math.abs(x - doorX) <= 1 && wy === y1 && lv === 0) continue;
        B({ op: 'opening', x, y: R(lv, wy), kind: 'window', variant: win }, false);
      }
    }
  };
  windows(0, wall);
  // 2층
  let stairsRoom = -1;
  if (t.floors >= 2) {
    const xsU = floorLevel(1, t.upper, wallUp);
    void xsU;
    windows(1, wallUp);
    // 계단: 1층 부엌/공방이 아닌 방 (없으면 마지막 방) 동쪽 벽 안, 위층 계단참이 방 안
    const cand = rooms.filter((r) => r.level === 0);
    const room = cand.find((r) => r.kind === 'hall' || r.kind === 'shop' || r.kind === 'pantry') ?? cand[cand.length - 1];
    stairsRoom = rooms.indexOf(room);
    let ok = false;
    for (let sx = room.xb; sx >= room.xa && !ok; sx--) {
      for (let sy = room.ya + 1; sy + 2 <= room.yb && !ok; sy++) {
        const r = B({ op: 'buy', defId: pick(['stairs_wood', t.tier >= 3 ? 'stairs_stone' : 'stairs_wood']), x: sx, y: R(0, sy), rot: 0 }, false);
        if (r.ok && !sim.builder!.lastWarnings.length) ok = true;
        else if (r.ok) sim.apply({ kind: 'buildUndo' });
      }
    }
    if (!ok) fails.push('stairs');
  }
  // 지하 저장고 + 들창
  if (t.cellar) {
    const pantry = rooms.find((r) => r.level === 0 && (r.kind === 'pantry' || r.kind === 'kitchen'))!;
    B({ op: 'digCellar', x0: pantry.xa, y0: R(-1, pantry.ya), x1: pantry.xb, y1: R(-1, pantry.yb) }, false);
    let ok = false;
    for (let y = pantry.yb; y >= pantry.ya && !ok; y--) {
      const r = B({ op: 'buy', defId: 'cellar_hatch', x: pantry.xb, y: R(0, y) }, false);
      if (r.ok && !sim.builder!.lastWarnings.length) ok = true;
      else if (r.ok) sim.apply({ kind: 'buildUndo' });
    }
  }
  B({ op: 'roof', style: pick(t.roofs) }, false);
  const structure = 10_000_000 - sim.econ!.account(1)!.money;
  // 가구
  const rank = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'];
  const myRank = rank.indexOf(t.estate);
  const estateOk = (e?: string | null) => !e || rank.indexOf(e) <= myRank;
  const objects = sim.data.objects;
  const variantsOf = (kind: string): string[] => {
    const out = Object.entries(objects)
      .filter(([oid, o]) => (oid === kind || o.kind === kind || (kind === 'shrine' && o.tags.includes('shrine'))) && (o.price ?? 0) > 0 && estateOk(o.estate) && (o.price ?? 0) <= t.budget)
      .map(([oid]) => oid);
    return out.length ? out : objects[kind] ? [kind] : [];
  };
  const place = (defId: string, r: (typeof rooms)[number]): boolean => {
    const d = objects[defId];
    const rots = d.rotations && d.rotations.length ? d.rotations : [0];
    const rows: number[] = [];
    for (let y = r.ya; y <= r.yb; y++) rows.push(y);
    if (d.wallMounted) {
      // 북쪽 벽에 걸기
      for (let x = r.xa; x <= r.xb; x++) {
        const res = B({ op: 'buy', defId, x, y: R(r.level, r.ya - 1) }, false);
        if (res.ok && !sim.builder!.lastWarnings.length) return true;
        if (res.ok) sim.apply({ kind: 'buildUndo' });
      }
      return false;
    }
    const cells: [number, number][] = [];
    for (const y of rows) for (let x = r.xa; x <= r.xb; x++) cells.push([x, y]);
    // 벽 붙이기 우선, 나머지는 섞어서
    if (!d.tags.includes('needs_wall_north')) for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    for (const [x, y] of cells) {
      for (const rot of rots) {
        const variant = d.variants?.length ? pick(d.variants) : undefined;
        const res = B({ op: 'buy', defId, x, y: R(r.level, y), rot, variant }, false);
        if (!res.ok) continue;
        if (!sim.builder!.lastWarnings.length) return true;
        sim.apply({ kind: 'buildUndo' });
      }
    }
    return false;
  };
  rooms.forEach((r, ri) => {
    for (const [kind, n] of PROGRAM[r.kind]) {
      for (let k = 0; k < n; k++) {
        const opts = variantsOf(kind);
        if (!opts.length) continue;
        // 비싼 것 쪽으로 (등급 예산 안에서): 위쪽 절반에서 고름
        opts.sort((a, b) => (objects[a].price ?? 0) - (objects[b].price ?? 0));
        // 낮은 등급 집은 싼 쪽 절반, 상인 이상은 비싼 쪽 절반 (17-4 역산표 집값에 맞춤)
        const top = t.tier <= 2 ? opts.slice(0, Math.max(1, Math.ceil(opts.length / 2))) : opts.slice(Math.floor(opts.length / 2));
        const choice = pick(top);
        if (!place(choice, r)) place(opts[0], r);
      }
    }
    // 장식 하나 둘 (방 점수)
    const deco = Object.entries(objects).filter(([, o]) => (o.category === 'decor' || o.category === 'light') && !o.wallMounted && (o.price ?? 0) > 0 && (o.price ?? 0) <= t.budget / 3 && estateOk(o.estate)).map(([oid]) => oid);
    for (let k = 0; k < 1 + (t.tier >= 3 ? 2 : 0); k++) if (deco.length) place(pick(deco), r);
    void ri;
  });
  void stairsRoom;
  // 마당
  const yardRoom = { level: 0, kind: 'hut' as RoomKind, xa: 1, xb: LW - 2, ya: 1, yb: LH - 3 };
  for (const y of t.yard) if (objects[y]) place(y, yardRoom);
  const trees = Object.entries(objects).filter(([oid, o]) => o.category === 'outdoor' && oid.startsWith('tree_') && !o.estate).map(([oid]) => oid);
  // 나무는 집에서 두 칸 넘게 떨어진 곳만 (우듬지가 벽/지붕을 가리지 않게)
  for (let k = 0; k < 2 + t.tier; k++) {
    if (!trees.length) break;
    const tid = pick(trees);
    const fp = objects[tid].footprint;
    for (let tries = 0; tries < 40; tries++) {
      const x = 1 + Math.floor(rng.next() * (LW - fp.w - 2));
      const y = 1 + Math.floor(rng.next() * (LH - fp.h - 4));
      const near = x + fp.w + 2 >= x0 && x - 2 <= x1 && y + fp.h + 3 >= y0 && y - 2 <= y1;
      if (near || Math.abs(x - doorX) < 3) continue;
      const res = B({ op: 'buy', defId: tid, x, y: R(0, y) }, false);
      if (res.ok && !sim.builder!.lastWarnings.length) break;
      if (res.ok) sim.apply({ kind: 'buildUndo' });
    }
  }
  const w = sim.world;
  const lot: LotDef = JSON.parse(JSON.stringify(w.lot));
  lot.objects = w.objects
    .filter((o) => !['window_opening', 'lot_exit', 'house_fire', 'construction_site'].includes(o.defId))
    .map((o) => {
      const e: LotDef['objects'][number] = { id: o.defId, x: o.x, y: o.y };
      if (o.rot) e.rot = o.rot;
      if (o.variant) e.variant = o.variant;
      return e;
    });
  delete lot.rows;
  delete lot.levels;
  lot.spawn = { x: doorX, y: y1 + 2 };
  const rs = sim.rooms();
  // 값 = 쓴 돈 (시도했다 되돌린 배치는 실행 취소가 돌려줌)
  spent = 10_000_000 - sim.econ!.account(1)!.money;
  if (fails.length) console.warn(`${id}: 실패 ${fails.join(', ')}`);
  if (sim.builder!.lastWarnings.length) throw new Error(`${id}: 길 막힘 ${JSON.stringify(sim.builder!.lastWarnings)}`);
  return { id, nameKey: `house.${id}`, tier: t.tier, estate: t.estate, lot, price: spent, structure, rooms: rs.length, floors: t.floors, objects: lot.objects.length };
}

const out: Built[] = [];
TIERS.forEach((t, ti) => {
  for (let i = 0; i < COUNT[ti]; i++) out.push(build(t, i));
});
fs.mkdirSync('src/data/lots/houses', { recursive: true });
for (const h of out) fs.writeFileSync(`src/data/lots/houses/${h.id}.json`, JSON.stringify(h.lot) + '\n');
fs.writeFileSync('src/data/houses.json', JSON.stringify({
  $comment: '미리 만든 집 (23-6). tools/world/make-houses.ts 가 건축 엔진으로 지음. price = 재료+가구 값 (파딩). tier: 집 등급 0 오두막 ~ 5 영주 성 거주동 (12-4 부의 축적 "한 등급 위의 집")',
  // 사고팔 때 집값 = 건물 값(17-4 역산표와 맞춤) + 가구 되팔기값(× 0.6)
  houses: out.map(({ lot, ...h }) => ({ ...h, furniture: h.price - h.structure, price: h.structure + Math.round((h.price - h.structure) * 0.6), w: lot.w, h: lot.h })),
}, null, 1) + '\n');
const lines = out.map((h) => `${h.id.padEnd(18)} 등급 ${h.tier} ${h.estate.padEnd(8)} ${h.lot.w}x${h.lot.h} 층 ${h.floors} 방 ${h.rooms} 물건 ${h.objects} 값 ${(h.price / 960).toFixed(2)}금화 = 건물 ${(h.structure / 960).toFixed(2)} + 가구 ${((h.price - h.structure) / 960).toFixed(2)}`);
fs.mkdirSync('artifacts/qa/m5', { recursive: true });
fs.writeFileSync('artifacts/qa/m5/houses.txt', lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`${out.length}채`);
