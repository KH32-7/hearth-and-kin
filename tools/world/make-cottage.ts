// Generates src/data/lots/cottage.json (starter freeman cottage). Run: npx tsx tools/world/make-cottage.ts
import fs from 'node:fs';

const W = 20, H = 14;
const idx = (x: number, y: number) => y * W + x;
const hash = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ---- ground: grass variants (deterministic), dirt rectangles with edge tiles
const ground: string[] = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const r = hash(x, y);
  ground.push(r < 0 ? 'grass_dirty_1' : `grass_${1 + Math.floor(hash(y + 7, x + 3) * 8)}`);
}
/** Dirt rectangle; edges that touch the lot border stay open (path continues off-lot). */
function dirt(x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const n = y === y0 && y0 > 0, s = y === y1 && y1 < H - 1, w = x === x0 && x0 > 0, e = x === x1 && x1 < W - 1;
    let t = 'dirt_c';
    if (n && w) t = 'dirt_nw'; else if (n && e) t = 'dirt_ne'; else if (s && w) t = 'dirt_sw'; else if (s && e) t = 'dirt_se';
    else if (n) t = 'dirt_n'; else if (s) t = 'dirt_s'; else if (w) t = 'dirt_w'; else if (e) t = 'dirt_e';
    ground[idx(x, y)] = t;
  }
}
dirt(4, 11, 6, 13);    // path from the front door to the lane
dirt(17, 4, 19, 9);    // wood yard (woodpile + chopping block)

// ---- house: walls x 1..16, y 2..10; partition x = 10
const walls: (string | null)[] = new Array(W * H).fill(null);
const floor: (string | null)[] = new Array(W * H).fill(null);
const HX0 = 1, HX1 = 16, HY0 = 2, HY1 = 10, PX = 10;
for (let y = HY0; y <= HY1; y++) for (let x = HX0; x <= HX1; x++) {
  if (x === HX0 || x === HX1 || y === HY0 || y === HY1 || x === PX) walls[idx(x, y)] = 'wall_timber';
  else floor[idx(x, y)] = `floor_wood_${1 + Math.floor(hash(x * 3, y * 5) * 6)}`;
}
const openings = [
  { x: 5, y: 10, kind: 'door' },
  { x: 10, y: 5, kind: 'door' },
  { x: 3, y: 10, kind: 'window' },
  { x: 7, y: 10, kind: 'window' },
  { x: 13, y: 10, kind: 'window' },
  { x: 16, y: 6, kind: 'window' },
];
// door cells keep their wall style (the renderer swaps the sprite) and get a floor under them
for (const o of openings) if (o.kind === 'door') floor[idx(o.x, o.y)] = 'floor_wood_1';

// ---- furniture
const objects = [
  // main room: kitchen wall
  { id: 'cupboard', x: 2, y: 3, rot: 0 },
  { id: 'hearth', x: 4, y: 3, rot: 0 },
  { id: 'prep_counter', x: 7, y: 3, rot: 0 },
  { id: 'barrel_water', x: 8, y: 4, rot: 0 }, // 류트 앞(9,3)과 문 앞(9,5) 통로 확보
  { id: 'lute', x: 9, y: 2, rot: 0 },
  { id: 'rug', x: 4, y: 4, rot: 0 },
  { id: 'candlestick', x: 9, y: 9, rot: 2 }, // 남동 구석, 북쪽을 보고 둠
  { id: 'plant_pot', x: 9, y: 6, rot: 0 },
  { id: 'washbasin', x: 2, y: 5, rot: 0 },
  { id: 'washtub', x: 2, y: 7, rot: 0 },
  // dining
  { id: 'bench', x: 4, y: 6, rot: 0 },
  { id: 'dining_table', x: 4, y: 7, rot: 0 },
  { id: 'chair', x: 3, y: 7, rot: 3 },
  { id: 'chair', x: 7, y: 7, rot: 1 },
  { id: 'stool', x: 4, y: 8, rot: 2 },
  { id: 'spinning_wheel', x: 2, y: 8, rot: 0 }, // 서쪽 구석: 식탁 줄 동쪽 통로(8~9열)를 비움
  // bedroom
  { id: 'bed_double', x: 11, y: 3, rot: 0 },
  { id: 'tapestry', x: 13, y: 2, rot: 0 },
  { id: 'wardrobe', x: 14, y: 3, rot: 0 },
  { id: 'chest_clothes', x: 14, y: 7, rot: 0 }, // 방 사이 문(10,5) 앞 칸을 비움
  { id: 'bookshelf', x: 15, y: 5, rot: 0 },
  { id: 'bed_straw', x: 11, y: 7, rot: 0 },
  { id: 'chamber_pot', x: 13, y: 8, rot: 0 },
  { id: 'rug', x: 12, y: 5, rot: 0 },
  { id: 'candlestick', x: 15, y: 8, rot: 0 },
  // yard
  { id: 'outhouse', x: 18, y: 1, rot: 0 },
  { id: 'woodpile', x: 17, y: 5, rot: 0 },
  { id: 'chopping_block', x: 18, y: 7, rot: 0 },
  { id: 'well', x: 1, y: 11, rot: 0 },
  { id: 'plant_pot', x: 7, y: 11, rot: 0 },
];

// 출구: 남쪽 흙길 끝 (래빗홀: 장터 다녀오기 등이 여기로 나감)
const lot = { id: 'cottage', w: W, h: H, ground, floor, walls, openings, objects, spawn: { x: 5, y: 12 }, exits: [{ x: 5, y: 13 }] };
fs.mkdirSync('src/data/lots', { recursive: true });
// compact rows: one row of the grid per line
const grid = (a: (string | null)[]) => '[\n' + Array.from({ length: H }, (_, y) => '    ' + a.slice(y * W, (y + 1) * W).map((v) => JSON.stringify(v)).join(', ')).join(',\n') + '\n  ]';
const txt = `{
  "id": "cottage",
  "w": ${W}, "h": ${H},
  "ground": ${grid(ground)},
  "floor": ${grid(floor)},
  "walls": ${grid(walls)},
  "openings": [
${openings.map((o) => '    ' + JSON.stringify(o)).join(',\n')}
  ],
  "objects": [
${objects.map((o) => '    ' + JSON.stringify(o)).join(',\n')}
  ],
  "spawn": ${JSON.stringify(lot.spawn)},
  "exits": ${JSON.stringify(lot.exits)}
}
`;
JSON.parse(txt);
fs.writeFileSync('src/data/lots/cottage.json', txt);
console.log('cottage.json written', objects.length, 'objects');
