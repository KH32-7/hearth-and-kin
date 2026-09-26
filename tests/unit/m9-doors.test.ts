/**
 * 집 출입 (18-1, 사용자 요청 2026-09-27): 사람이 사는 집은 식구·초대받은 사람·아주 친한 사이만.
 * 공공 장소·일터는 늘 열림. 문 두드리기 → NPC 집은 사람이 있으면 들여보냄, 조작 가문 집은 "들어오라고 하기"
 */
import { describe, expect, it } from 'vitest';
import { loadSimData } from '../../tools/data-node';
import { Simulation } from '../../src/sim/sim';
import type { Person } from '../../src/sim/people/person';

const data = loadSimData({ town: 'ashford' });
const town = (seed = 1) => new Simulation(data, seed);

function residentialDoor(sim: Simulation, hh: number): number {
  const g = sim.world.grid;
  for (let i = 0; i < g.door.length; i++) if (g.door[i] && sim.town!.doorHousehold(i) === hh) return i;
  return -1;
}

describe('집 출입', () => {
  it('식구는 들어가고, 남은 못 들어감. 공공 장소 문은 늘 열림', () => {
    const sim = town();
    const npcHh = [...sim.town!.lotHousehold.values()].find((h) => h >= 100 && residentialDoor(sim, h) >= 0)!;
    const me = sim.persons.find((p) => p.household === 1)!;
    const owner = sim.persons.find((p) => p.household === npcHh)!;
    expect(sim.mayEnter(owner, npcHh)).toBe(true);
    expect(sim.mayEnter(me, npcHh)).toBe(false);
    // 공공 장소(여관·교회 등) 문: 주인 없음
    const g = sim.world.grid;
    let publicDoors = 0;
    for (let i = 0; i < g.door.length; i++) if (g.door[i] && sim.town!.placeOf(i % g.w, Math.floor(i / g.w)) && sim.town!.doorHousehold(i) === 0) publicDoors++;
    expect(publicDoors).toBeGreaterThan(0);
  });

  it('아주 친한 사이(우정 70)는 그냥 들어감', () => {
    const sim = town(2);
    const npcHh = [...sim.town!.lotHousehold.values()].find((h) => h >= 100 && residentialDoor(sim, h) >= 0)!;
    const me = sim.persons.find((p) => p.household === 1)!;
    const owner = sim.persons.find((p) => p.household === npcHh)!;
    sim.rel.ensure(me.id, owner.id).friendship = 75;
    expect(sim.mayEnter(me, npcHh)).toBe(true);
  });

  it('WASD 로 남의 문에 부딪히면 두드림 → 집에 사람이 있으면 들여보냄 (4시간)', () => {
    const sim = town(3);
    const me = sim.persons.find((p) => p.household === 1)!;
    const npcHh = [...sim.town!.lotHousehold.values()].find((h) => h >= 100 && residentialDoor(sim, h) >= 0)!;
    const door = residentialDoor(sim, npcHh);
    const host = sim.persons.find((p) => p.household === npcHh && !p.infant)!;
    // 집주인을 집 안에 깨어 있게
    const cell = sim.town!.targetCell(host, 'home');
    const g = sim.world.grid;
    host.x = (cell % g.w) + 0.5;
    host.y = Math.floor(cell / g.w) + 0.5;
    host.sleeping = false;
    sim.shiftTime(12 * 60 - sim.world.minuteOfDay());
    const ok = (sim as unknown as { directWalkable(p: Person, x: number, y: number): boolean }).directWalkable(me, (door % g.w) + 0.5, Math.floor(door / g.w) + 0.5);
    expect(ok).toBe(false);
    expect(sim.mayEnter(me, npcHh)).toBe(true);
    expect(me.knocking).toBe(null);
  });

  it('조작 가문 집: 두드리면 식구에게 알림, "들어오라고 하기" 게이트', () => {
    const sim = town(4);
    const me = sim.persons.find((p) => p.household === 1)!;
    const other = sim.persons.find((p) => p.household >= 100 && p.lifeStage === 'adult')!;
    const door = residentialDoor(sim, 1);
    expect(door).toBeGreaterThanOrEqual(0);
    const cell = sim.town!.targetCell(me, 'home');
    const g = sim.world.grid;
    me.x = (cell % g.w) + 0.5;
    me.y = Math.floor(cell / g.w) + 0.5;
    me.sleeping = false;
    sim.knock(other, door);
    expect(other.knocking?.household).toBe(1);
    expect(sim.gateOk('knocking_here', me, other)).toBe(true);
    sim.letIn(1, other, me);
    expect(sim.mayEnter(other, 1)).toBe(true);
  });
});
