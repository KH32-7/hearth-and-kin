import { describe, expect, it } from 'vitest';
import { Grid } from '../../src/sim/world/grid';
import { PathFinder } from '../../src/sim/action/path';
import { urgency } from '../../src/sim/action/autonomy';
import { fixtureData, makeSim, runMinutes } from './helpers';

describe('격자와 길찾기', () => {
  const data = fixtureData();

  it('벽으로 둘러싼 오두막 안을 방 하나로 인식', () => {
    const g = new Grid(data.lot);
    g.detectRooms();
    expect(g.roomSizes.length).toBe(1);
    expect(g.roomOf(5.5, 5.5)).toBe(0);
    expect(g.roomOf(14.5, 5.5)).toBe(-1);
  });

  it('A*는 벽을 통과하지 않고 문으로 드나듦', () => {
    const g = new Grid(data.lot);
    const pf = new PathFinder(g);
    const path = pf.find(g.idx(7, 6), g.idx(7, 11), false)!;
    expect(path).not.toBeNull();
    const cells = path.map((i) => [i % g.w, Math.floor(i / g.w)]);
    expect(cells.some(([x, y]) => x === 6 && y === 9)).toBe(true); // 문
    for (const [x, y] of cells) expect(g.wall[g.idx(x, y)] && !g.door[g.idx(x, y)]).toBeFalsy();
  });

  it('대각선으로 벽 모서리를 깎지 않음', () => {
    const g = new Grid(data.lot);
    const pf = new PathFinder(g);
    const path = pf.find(g.idx(10, 3), g.idx(10, 6), false)!;
    let prev = g.idx(10, 3);
    for (const c of path) {
      const px = prev % g.w;
      const py = Math.floor(prev / g.w);
      const cx = c % g.w;
      const cy = Math.floor(c / g.w);
      if (px !== cx && py !== cy) {
        expect(g.walkable(g.idx(cx, py))).toBe(true);
        expect(g.walkable(g.idx(px, cy))).toBe(true);
      }
      prev = c;
    }
  });
});

describe('욕구', () => {
  it('깨어 있으면 1시간에 배고픔이 needs.json decayPerHour 만큼 감소 (한 끼로 하루 버팀: 4)', () => {
    const sim = makeSim();
    sim.autonomyEnabled = false;
    const p = sim.persons[0];
    const before = p.need('hunger');
    runMinutes(sim, 60);
    const rate = sim.data.needs.needs.hunger.decayPerHour;
    expect(rate).toBeLessThanOrEqual(4);
    expect(before - p.need('hunger')).toBeCloseTo(rate, 3);
  });

  it('긴급도는 욕구가 낮을수록 큼', () => {
    const data = fixtureData();
    expect(urgency(data, 'bladder', 10)).toBeGreaterThan(urgency(data, 'bladder', 60));
  });

  it('화로에 불이 붙으면 방 기온이 오름', () => {
    const sim = makeSim();
    sim.autonomyEnabled = false;
    const before = sim.world.roomTemps[0];
    const hearth = sim.world.objects.find((o) => o.defId === 'hearth')!;
    hearth.state.lit = true;
    hearth.state.fuelMin = 600;
    runMinutes(sim, 120);
    expect(sim.world.roomTemps[0]).toBeGreaterThan(before + 3);
  });
});

describe('명령 흐름 (M1 E2E와 같은 경로)', () => {
  it('불 피우기 → 스튜 끓이기 → 식탁에서 먹기', () => {
    const sim = makeSim();
    sim.autonomyEnabled = false;
    const p = sim.persons[0];
    const hearth = sim.world.objects.find((o) => o.defId === 'hearth')!;
    const table = sim.world.objects.find((o) => o.defId === 'dining_table')!;
    expect(sim.queueInteraction(p.id, 'hearth.light_fire', hearth.uid).ok).toBe(true);
    expect(sim.queueInteraction(p.id, 'hearth.cook_stew', hearth.uid).ok).toBe(true);
    expect(sim.queueInteraction(p.id, 'table.eat_stew', table.uid).ok).toBe(true);
    const hungerStart = p.need('hunger');
    runMinutes(sim, 200);
    expect(sim.stats.completed['hearth.light_fire']).toBe(1);
    expect(sim.stats.completed['hearth.cook_stew']).toBe(1);
    expect(sim.stats.completed['table.eat_stew']).toBe(1);
    expect(hearth.state.servings).toBe(3);
    expect(p.need('hunger')).toBeGreaterThan(hungerStart);
  });

  it('조건이 안 맞으면 메뉴에 회색 + 이유', () => {
    const sim = makeSim();
    const hearth = sim.world.objects.find((o) => o.defId === 'hearth')!;
    const menu = sim.menuFor(1, hearth.uid);
    const cook = menu.find((m) => m.interactionId === 'hearth.cook_stew')!;
    expect(cook.available).toBe(false);
    expect(cook.reasonKey).toBe('reason.state.lit.true');
  });
});

describe('자율 3일 (봇 기준)', () => {
  it('방치/stuck/관통 0', () => {
    const sim = makeSim(7);
    runMinutes(sim, 3 * 1440);
    const s = sim.stats;
    for (const [need, m] of Object.entries(s.maxNeglect)) expect(m, need).toBeLessThanOrEqual(120);
    expect(s.stuckEvents).toBe(0);
    expect(s.clipViolations).toBe(0);
  });

  it('같은 시드 = 같은 해시', () => {
    const a = makeSim(42);
    const b = makeSim(42);
    runMinutes(a, 1440);
    runMinutes(b, 1440);
    expect(a.worldHash()).toBe(b.worldHash());
  });
});

describe('물건 회전', () => {
  it('시계 방향 회전: 칸과 방향이 함께 돔', async () => {
    const { rotateSlots } = await import('../../src/sim/world/world');
    const slots = [{ id: 'front', dx: 1, dy: 1, facing: 'up' as const, pose: 'stand' as const }];
    // 3x1 물건의 남쪽 앞자리 → 1x3 으로 돌면 서쪽 앞자리, 오른쪽을 봄
    expect(rotateSlots(slots, { w: 3, h: 1 }, 1)[0]).toMatchObject({ dx: -1, dy: 1, facing: 'right' });
    // 1x1 의자: 아래 → 왼쪽 → 위 → 오른쪽
    const chair = [{ id: 'sit', dx: 0, dy: 0, facing: 'down' as const, pose: 'sit' as const }];
    expect([1, 2, 3].map((r) => rotateSlots(chair, { w: 1, h: 1 }, r)[0].facing)).toEqual(['left', 'up', 'right']);
    expect(rotateSlots(chair, { w: 1, h: 1 }, 4)[0]).toMatchObject({ dx: 0, dy: 0, facing: 'down' });
  });
});

describe('입력 로그 재생 결정론 (BRIEF 0장 5)', () => {
  it('같은 시드 + 같은 입력 로그 = 같은 해시', async () => {
    const { Simulation } = await import('../../src/sim/sim');
    const data = fixtureData();
    const a = new Simulation(data, 42);
    a.addPerson('가');
    const hearth = a.world.objects.find((o) => o.defId === 'hearth')!;
    for (let t = 0; t < 600; t++) {
      if (t === 30) a.apply({ kind: 'queue', personId: 1, interactionId: 'hearth.light_fire', targetUid: hearth.uid });
      if (t === 200) a.apply({ kind: 'setNeed', personId: 1, need: 'hunger', value: 10 });
      if (t === 250) a.apply({ kind: 'setTime', minuteOfDay: 20 * 60 });
      if (t === 300) a.apply({ kind: 'goto', personId: 1, x: 3, y: 3 });
      a.tick();
    }
    const b = Simulation.replay(data, 42, ['가'], a.inputLog, 600);
    expect(b.worldHash()).toBe(a.worldHash());
    expect(a.inputLog.length).toBe(4);
  });
});
