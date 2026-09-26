// 부지 걷기 지도 출력: # 벽, D 문, W 창, o 막는 물건, . 걸을 수 있음, S 스폰
import { readFileSync } from 'node:fs';
import { validateSimData } from '../../src/sim/data/simData';
import { Simulation } from '../../src/sim/sim';
const j = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const data = validateSimData({ needs: j('src/data/needs.json'), balance: j('src/data/balance.json'), interactions: j('src/data/interactions.json'), objects: j('src/data/objects.json'), lot: j(process.argv[2] ?? 'src/data/lots/cottage.json') } as never);
const sim = new Simulation(data, 1);
const g = sim.world.grid;
const lot = data.lot;
const win = new Set(lot.openings.filter((o) => o.kind === 'window').map((o) => o.y * lot.w + o.x));
console.log('   ' + Array.from({ length: lot.w }, (_, x) => x % 10).join(''));
for (let y = 0; y < lot.h; y++) {
  let row = String(y).padStart(2) + ' ';
  for (let x = 0; x < lot.w; x++) {
    const i = g.idx(x, y);
    row += x === lot.spawn.x && y === lot.spawn.y ? 'S' : win.has(i) ? 'W' : g.door[i] ? 'D' : g.wall[i] ? '#' : g.objAt[i] ? 'o' : g.walkable(i) ? '.' : '?';
  }
  console.log(row);
}
