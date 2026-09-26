/**
 * 직접 플레이 개선 (2026-09-27): 플레이어 명령 우선 — 걷는 NPC 에게 말 걸기, 명령 즉시 시작
 */
import { describe, expect, it } from 'vitest';
import { loadSimData } from '../../tools/data-node';
import { Simulation } from '../../src/sim/sim';

const data = loadSimData({ town: 'ashford' });

describe('플레이어 명령 우선', () => {
  it('일과로 걸어가는 NPC 에게 말을 걸면 멈춰서 대화함', () => {
    const sim = new Simulation(data, 3);
    sim.apply({ kind: 'forceLod', lod: 'full' });
    sim.shiftTime(10 * 60 - sim.world.minuteOfDay());
    for (let i = 0; i < 20; i++) sim.tick();
    const me = sim.persons.find((p) => p.household === 1 && p.lifeStage !== 'baby')!;
    const npc = sim.persons.find((p) => p.household !== 1 && p.lod === 'full' && !p.infant && (p.lifeStage === 'adult' || p.lifeStage === 'young') && !p.hidden && !p.sleeping)!;
    expect(npc).toBeTruthy();
    // NPC 를 멀리 걷게 함 (자율이 아닌 명령 = 일과 걸음과 같음)
    const g = sim.world.grid;
    let far = -1;
    for (let d = 20; d < 60 && far < 0; d++) {
      const x = Math.floor(npc.x) + d;
      if (g.inBounds(x, Math.floor(npc.y)) && g.walkable(g.idx(x, Math.floor(npc.y)))) far = g.idx(x, Math.floor(npc.y));
    }
    if (far >= 0) sim.queueInteraction(npc.id, '__goto', far);
    sim.tick();
    sim.rel.ensure(me.id, npc.id).met = true;
    const r = sim.queueInteraction(me.id, 'social.chat', npc.id);
    expect(r.ok).toBe(true);
    let ok = false;
    for (let i = 0; i < 180 && !ok; i++) {
      sim.tick();
      if (me.lastSocial?.target === npc.id) ok = true;
    }
    if (!ok) console.log(JSON.stringify(sim.notices.filter((n) => n.personId === me.id).slice(-5)), JSON.stringify(me.action), me.x, me.y, npc.x, npc.y, npc.status, npc.hidden, npc.sleeping);
    expect(ok).toBe(true);
  }, 60000);

  it('플레이어 이동 명령은 다음 틱을 기다리지 않고 바로 길을 잡음', () => {
    const sim = new Simulation(data, 4);
    const me = sim.persons.find((p) => p.household === 1 && p.lifeStage !== 'baby')!;
    const g = sim.world.grid;
    let goal = -1;
    for (let d = 3; d < 20 && goal < 0; d++) {
      const x = Math.floor(me.x) + d;
      if (g.walkable(g.idx(x, Math.floor(me.y)))) goal = g.idx(x, Math.floor(me.y));
    }
    sim.queueGoto(me.id, goal % g.w, Math.floor(goal / g.w));
    expect(me.action).toBeTruthy();
    expect(sim.predictWalk(me, 0.5)).toBeTruthy();
  });
  it('상대가 다른 사람과 대화 중이어도 플레이어가 말을 걸면 그 대화를 끊고 응함', () => {
    const sim = new Simulation(data, 5);
    sim.apply({ kind: 'forceLod', lod: 'full' });
    sim.shiftTime(10 * 60 - sim.world.minuteOfDay());
    const me = sim.persons.find((p) => p.household === 1 && p.lifeStage !== 'baby')!;
    const adults = sim.persons.filter((p) => p.household !== 1 && !p.infant && !p.hidden && (p.lifeStage === 'adult' || p.lifeStage === 'young'));
    const [a, b] = [adults[0], adults.find((q) => q.household !== adults[0].household)!];
    b.x = a.x + 1;
    b.y = a.y;
    sim.rel.ensure(a.id, b.id).met = true;
    sim.queueInteraction(a.id, 'social.chat', b.id);
    for (let i = 0; i < 3; i++) sim.tick();
    sim.rel.ensure(me.id, b.id).met = true;
    expect(sim.queueInteraction(me.id, 'social.chat', b.id).ok).toBe(true);
    let ok = false;
    for (let i = 0; i < 200 && !ok; i++) {
      sim.tick();
      if (me.lastSocial?.target === b.id) ok = true;
    }
    expect(ok).toBe(true);
  }, 60000);
});
