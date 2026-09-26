/**
 * 직접 조작 (WASD, 2026-09-26 사용자 요청): 대기열을 쓰지 않고 바로 움직임, 벽에서 멈춤,
 * 조작 중 자율이 끼어들지 않음, 입력 로그 재생 결정론 (steer + directPos)
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/sim';
import { loadSimData } from '../../tools/data-node';

const data = loadSimData({});

function family(seed = 1): Simulation {
  const s = new Simulation(data, seed);
  s.addPerson('가');
  s.addPerson('나');
  return s;
}

describe('직접 조작', () => {
  it('누르는 동안 대기열 없이 움직이고, 벽을 뚫지 않고, 떼면 섬', () => {
    const s = family();
    const p = s.persons[0];
    s.apply({ kind: 'steer', personId: p.id, dx: 1, dy: 0 });
    const x0 = p.x;
    for (let i = 0; i < 5; i++) s.directStep(p, 0.1);
    expect(p.x).toBeGreaterThan(x0);
    expect(p.queue.length).toBe(0);
    expect(p.action).toBeNull();
    // 한참 밀어도 걸을 수 없는 칸에 들어가지 않음
    for (let i = 0; i < 400; i++) s.directStep(p, 0.5);
    expect(s.world.grid.walkable(s.world.grid.idx(p.cellX(), p.cellY()))).toBe(true);
    // 조작 중에는 틱이 지나도 자율이 행동을 넣지 않음
    for (let i = 0; i < 30; i++) s.tick();
    expect(p.action).toBeNull();
    s.apply({ kind: 'steer', personId: p.id, dx: 0, dy: 0 });
    expect(p.direct).toBeNull();
  });

  it('입력 로그 재생 = 같은 결과 (틱 직전 directPos)', () => {
    const run = (): { hash: string; log: Simulation['inputLog'] } => {
      const s = family(3);
      const p = s.persons[0];
      for (let t = 0; t < 120; t++) {
        if (t === 10) s.apply({ kind: 'steer', personId: p.id, dx: 0, dy: 1 });
        if (t === 40) s.apply({ kind: 'steer', personId: p.id, dx: -1, dy: 0 });
        if (t === 70) s.apply({ kind: 'steer', personId: p.id, dx: 0, dy: 0 });
        if (p.direct) s.directStep(p, 0.37);
        if (p.directMoved) s.apply({ kind: 'directPos', personId: p.id, x: p.x, y: p.y, facing: p.facing });
        s.tick();
      }
      return { hash: s.worldHash(), log: s.inputLog };
    };
    const live = run();
    const r = family(3);
    let k = 0;
    for (let t = 0; t < 120; t++) {
      while (k < live.log.length && live.log[k].tick === r.stats.ticks) r.apply(live.log[k++].intent);
      r.tick();
    }
    expect(r.worldHash()).toBe(live.hash);
  });
});
