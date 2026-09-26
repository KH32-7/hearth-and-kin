/**
 * M1 독립 코드 리뷰(2026-09-26)에서 재현된 결함의 회귀 테스트. 실제 오두막 데이터 사용
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/sim';
import { cottageData, runMinutes } from './helpers';

function sim(n = 1, seed = 1): Simulation {
  const s = new Simulation(cottageData(), seed);
  for (let i = 0; i < n; i++) s.addPerson(`p${i + 1}`);
  return s;
}
const obj = (s: Simulation, defId: string, nth = 0) => s.world.objects.filter((o) => o.defId === defId)[nth];

describe('리뷰 회귀', () => {
  it('1. 배고픔이 급해도 스튜를 먹으러 가는 행동은 끊기지 않음', () => {
    const s = sim();
    const h = obj(s, 'hearth');
    Object.assign(h.state, { lit: true, fuelMin: 300, servings: 4 });
    s.world.stock.bread = 0;
    s.persons[0].setNeed('hunger', 5);
    runMinutes(s, 240);
    expect(s.persons[0].need('hunger')).toBeGreaterThan(50);
    expect(s.stats.shortEnds).toBe(0);
  });

  it('1b. 배고파도 불 피우기(스튜로 이어짐)는 끊기지 않음', () => {
    const s = sim();
    s.world.stock.bread = 0;
    s.persons[0].setNeed('hunger', 7);
    runMinutes(s, 480);
    expect(s.persons[0].need('hunger')).toBeGreaterThan(30);
    expect(s.stats.aborted['hearth.light_fire'] ?? 0).toBeLessThanOrEqual(1);
  });

  it('2. 먹을 것이 전혀 없으면 배고파도 잠에서 1분마다 깨지 않음', () => {
    const s = sim();
    s.world.stock.bread = 0;
    s.world.stock.ingredients = 0;
    s.world.stock.flour = 0;
    s.apply({ kind: 'setTime', minuteOfDay: 22 * 60 });
    s.persons[0].setNeed('hunger', 3);
    s.persons[0].setNeed('energy', 15);
    runMinutes(s, 600);
    expect(s.stats.completed['bed.sleep'] ?? 0).toBeLessThanOrEqual(2);
    expect(s.stats.shortEnds).toBe(0);
  });

  it('3. 식재료가 떨어지면 장터에 다녀와 채움 (10일 봇도 확인)', () => {
    const s = sim(2);
    s.world.stock.ingredients = 0;
    s.world.stock.bread = 0;
    for (const p of s.persons) p.setNeed('hunger', 40);
    runMinutes(s, 1440);
    expect(s.stats.completed['lot_exit.market'] ?? 0).toBeGreaterThanOrEqual(1);
    expect(s.stats.collapses).toBe(0);
  });

  it('4. 앉았던 사람은 행동이 끝나면 일어남 → 두 사람이 한 의자에 앉지 않음', () => {
    const s = sim(2);
    s.apply({ kind: 'setAutonomy', enabled: false });
    const chair = obj(s, 'chair');
    s.apply({ kind: 'queue', personId: 1, interactionId: 'seat.sit', targetUid: chair.uid });
    runMinutes(s, 120);
    expect(s.persons[0].action).toBeNull();
    expect(s.persons[0].pose).toBe('stand');
    s.apply({ kind: 'queue', personId: 2, interactionId: 'seat.sit', targetUid: chair.uid });
    for (let i = 0; i < 60 && s.persons[1].pose !== 'sit'; i++) s.tick();
    const a = s.persons[0];
    const b = s.persons[1];
    expect(b.pose).toBe('sit');
    // 의자 칸에 앉은 사람은 b 한 명
    expect(a.cellX() === b.cellX() && a.cellY() === b.cellY()).toBe(false);
  });

  it('5. 책 읽기는 요강/욕조가 아니라 의자·걸상·긴 의자에 앉음', () => {
    const s = sim();
    s.apply({ kind: 'setAutonomy', enabled: false });
    const shelf = obj(s, 'bookshelf');
    s.apply({ kind: 'queue', personId: 1, interactionId: 'bookshelf.read', targetUid: shelf.uid });
    for (let i = 0; i < 60 && !(s.persons[0].action?.phase === 'perform' && s.persons[0].action.stepIndex > 0); i++) s.tick();
    const a = s.persons[0].action;
    if (a && a.stepIndex > 0) {
      const seat = s.world.byUid.get(a.stepObj)!;
      expect(s.world.def(seat.defId).tags).toContain('seat');
    }
  });

  it('6. 2인 침대: 한 사람이 자고 있어도 두 번째 자리에 누울 수 있음', () => {
    const s = sim(2);
    s.apply({ kind: 'setAutonomy', enabled: false });
    const bed = obj(s, 'bed_double');
    s.persons[0].setNeed('energy', 10);
    s.persons[1].setNeed('energy', 10);
    s.apply({ kind: 'setTime', minuteOfDay: 22 * 60 });
    s.apply({ kind: 'queue', personId: 1, interactionId: 'bed.sleep', targetUid: bed.uid });
    runMinutes(s, 30);
    expect(s.persons[0].sleeping).toBe(true);
    const menu = s.menuFor(2, bed.uid).find((m) => m.interactionId === 'bed.sleep')!;
    expect(menu.available).toBe(true);
    s.apply({ kind: 'queue', personId: 2, interactionId: 'bed.sleep', targetUid: bed.uid });
    runMinutes(s, 30);
    expect(s.persons[1].sleeping).toBe(true);
  });

  it('7. 불이 꺼지면 불 쬐기가 끝남, 벽 너머 화로는 데워 주지 않음', () => {
    const s = sim();
    s.apply({ kind: 'setAutonomy', enabled: false });
    const h = obj(s, 'hearth');
    Object.assign(h.state, { lit: true, fuelMin: 300 });
    s.apply({ kind: 'queue', personId: 1, interactionId: 'hearth.warm_up', targetUid: h.uid });
    runMinutes(s, 20);
    expect(s.persons[0].action?.item.interactionId).toBe('hearth.warm_up');
    h.state.lit = false;
    runMinutes(s, 2);
    expect(s.persons[0].action).toBeNull();
    // 집 밖 북쪽(화로 반대편 벽 너머)
    h.state.lit = true;
    expect(s.world.nearLitHearth(h.x + 1.5, h.y - 1.5, 2)).toBe(false);
  });

  it('8. 스키마: 없는 슬롯 이름, 잘못된 조건식, 벽 위 가구를 불러올 때 거부', async () => {
    const { validateSimData } = await import('../../src/sim/data/simData');
    const base = cottageData();
    const raw = () => JSON.parse(JSON.stringify({ needs: base.needs, balance: base.balance, interactions: { interactions: base.interactions }, objects: Object.fromEntries(Object.entries(base.objects).filter(([k]) => k !== 'window_opening' && k !== 'lot_exit')), lot: base.lot }));
    const r1 = raw();
    r1.interactions.interactions['bed.nap'].steps[0].slot = 'lye';
    expect(() => validateSimData(r1)).toThrow(/슬롯/);
    const r2 = raw();
    r2.interactions.interactions['hearth.light_fire'].supportWhen = ['foo:bar'];
    expect(() => validateSimData(r2)).toThrow(/조건식/);
    const r3 = raw();
    const wall = r3.lot.walls.findIndex((w: string | null) => w);
    r3.lot.objects.push({ id: 'stool', x: wall % r3.lot.w, y: Math.floor(wall / r3.lot.w) });
    expect(() => validateSimData(r3)).toThrow(/벽 위/);
    const r4 = raw();
    delete r4.balance.movement.walkTilesPerMinute;
    expect(() => validateSimData(r4)).toThrow();
  });
});
