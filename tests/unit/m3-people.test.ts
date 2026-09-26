/**
 * M3 사람들: 초대 → 방문 → 첫인상 → 대화 → 관계 변화 → 귀가 → 재방문(같은 인물), 요구조건(로맨스는 어른끼리, 식구는 제외),
 * 멀티태스킹/가족 식사, 하루 감소, 재생 결정론
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/sim';
import { cottageData, runMinutes } from './helpers';

const data = cottageData();

function family(seed = 3) {
  const s = new Simulation(data, seed);
  s.addPerson('에드릭', undefined, undefined, { sex: 'male' });
  s.addPerson('마르타', undefined, undefined, { sex: 'female' });
  s.apply({ kind: 'setRelation', a: 1, b: 2, friendship: 55, romance: 48, flags: ['spouse'], met: true });
  return s;
}

describe('이웃 초대와 방문 (M3)', () => {
  it('초대 → 길 끝에서 들어옴 → 첫인상 → 어울림 → 돌아감 → 다시 부르면 같은 사람', () => {
    const s = family();
    const nb = data.neighbors[0];
    expect(s.apply({ kind: 'invite', personId: 1, neighborId: nb.id })).toMatchObject({ ok: true });
    runMinutes(s, 70);
    const v = s.persons.find((p) => p.visitor?.neighborId === nb.id);
    expect(v).toBeDefined();
    expect(v!.household).not.toBe(1);
    // 도착하면 초대한 사람에게 인사하러 감 → 처음 만남(첫인상)
    runMinutes(s, 60);
    expect(s.rel.get(1, v!.id)?.met).toBe(true);
    expect(s.notices.some((n) => n.kind === 'first_meet' || n.kind === 'visitor_arrived')).toBe(true);
    const f0 = Math.abs(s.rel.friendship(1, v!.id));
    expect(f0).toBeLessThanOrEqual(25);
    // 머무를 시간이 지나면 돌아감
    runMinutes(s, 360);
    expect(s.persons.some((p) => p.id === v!.id)).toBe(false);
    expect(s.away.get(nb.id)?.id).toBe(v!.id);
    const before = s.rel.friendship(1, v!.id);
    // 다시 부르면 같은 id (관계가 이어짐)
    s.apply({ kind: 'invite', personId: 1, neighborId: nb.id });
    runMinutes(s, 70);
    const again = s.persons.find((p) => p.visitor?.neighborId === nb.id);
    expect(again?.id).toBe(v!.id);
    expect(s.rel.get(1, v!.id)?.met).toBe(true);
    expect(Math.abs(s.rel.friendship(1, v!.id) - before)).toBeLessThan(15);
  });

  it('방문객은 남의 집에서 자거나 목욕하거나 요리하지 않음', () => {
    const s = family(5);
    for (const nb of data.neighbors.slice(0, 3)) s.apply({ kind: 'invite', personId: 1, neighborId: nb.id });
    const used = new Set<string>();
    for (let i = 0; i < 400; i++) {
      s.tick();
      for (const p of s.persons) if (p.visitor && p.action) used.add(p.action.item.interactionId);
    }
    const allow = data.relations!.visit.allowInteractions;
    const bad = [...used].filter((id) => !id.startsWith('social.') && id !== '__goto' && !allow.includes(id));
    expect(allow.some((id) => /bathe|sleep|cook|nap/.test(id))).toBe(false);
    expect(bad).toEqual([]);
    expect(s.stats.stuckEvents).toBe(0);
  });
});

describe('요구조건 (14-3)', () => {
  it('식구끼리는 연인/배우자가 아니면 로맨스 메뉴가 없고, 배우자에게는 있음', () => {
    const s = new Simulation(data, 1);
    s.addPerson('아버지');
    s.addPerson('딸', undefined, undefined, { stage: 'teen', sex: 'female' });
    const menu = s.menuForPerson(1, 2);
    expect(menu.some((e) => e.category === 'romance')).toBe(false);
    const f = family();
    expect(f.menuForPerson(1, 2).some((e) => e.category === 'romance' && e.available)).toBe(true);
  });

  it('처음 만난 사이 전용(인사)과 아는 사이 전용이 나뉨', () => {
    const s = family();
    s.apply({ kind: 'invite', personId: 1, neighborId: data.neighbors[1].id });
    runMinutes(s, 65);
    const v = s.persons.find((p) => p.visitor)!;
    s.rel.get(1, v.id) && (s.rel.get(1, v.id)!.met = false);
    const strangers = s.menuForPerson(1, v.id).filter((e) => e.available).map((e) => e.interactionId);
    const needMet = Object.entries(data.social).filter(([, d]) => d.requires.met === true).map(([id]) => id);
    expect(strangers.some((id) => needMet.includes(id))).toBe(false);
  });

  it('메뉴 항목에 분류와 성공 확률(5~95)', () => {
    const s = family();
    const m = s.menuForPerson(1, 2).filter((e) => e.available);
    expect(m.length).toBeGreaterThan(10);
    for (const e of m) {
      expect(e.category).toBeDefined();
      expect(e.chance).toBeGreaterThanOrEqual(5);
      expect(e.chance).toBeLessThanOrEqual(95);
    }
  });
});

describe('관계 변화', () => {
  it('성공 판정: 성공/실패가 모두 나오고 우정이 결과대로 움직임', () => {
    const s = family(11);
    s.apply({ kind: 'setAutonomy', enabled: false });
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < 30; i++) {
      const f0 = s.rel.friendship(1, 2);
      s.apply({ kind: 'queue', personId: 1, interactionId: 'social.joke', targetUid: 2 });
      runMinutes(s, 25);
      const res = [...s.notices].reverse().find((n) => n.kind === 'social_result');
      if (!res) continue;
      const d = s.rel.friendship(1, 2) - f0;
      if (res.args!.ok) {
        ok++;
        expect(d).toBeGreaterThanOrEqual(0);
      } else {
        fail++;
        expect(d).toBeLessThanOrEqual(0.001);
      }
      s.notices.length = 0;
    }
    expect(ok).toBeGreaterThan(5);
    expect(ok + fail).toBeGreaterThan(20);
  });

  it('하루가 지나면 우정/로맨스가 0 쪽으로 줄어듦', () => {
    const s = family();
    s.apply({ kind: 'setAutonomy', enabled: false });
    const f0 = s.rel.friendship(1, 2);
    const r0 = s.rel.romance(1, 2);
    runMinutes(s, 1440);
    expect(s.rel.friendship(1, 2)).toBeLessThan(f0);
    expect(s.rel.romance(1, 2)).toBeLessThan(r0);
  });
});

describe('멀티태스킹과 가족 식사', () => {
  it('둘이 같이 앉아 먹으면 이야기하고(교류 +) 가족 식사 무드렛', () => {
    const s = family();
    s.apply({ kind: 'setAutonomy', enabled: false });
    const bread = 'table.eat_stew';
    const hearth = s.world.objects.find((o) => o.defId === 'hearth')!;
    s.apply({ kind: 'setObjectState', uid: hearth.uid, state: { servings: 4, lit: true, fuelMin: 300 } });
    const table = s.world.objects.find((o) => o.defId === 'dining_table')!;
    for (const p of s.persons) p.setNeed('social', 20);
    s.apply({ kind: 'queue', personId: 1, interactionId: bread, targetUid: table.uid });
    s.apply({ kind: 'queue', personId: 2, interactionId: bread, targetUid: table.uid });
    let chatted = false;
    for (let i = 0; i < 60; i++) {
      s.tick();
      if (s.persons[0].chatWith === 2 || s.persons[1].chatWith === 1) chatted = true;
    }
    expect(chatted).toBe(true);
    expect(s.persons.every((p) => p.moodlets.some((m) => m.id === 'family_meal'))).toBe(true);
  });
});

describe('재생 결정론 (M3 의도 포함)', () => {
  it('초대/관계 의도가 섞여도 같은 시드 + 같은 로그 = 같은 해시', () => {
    const s = family(21);
    s.apply({ kind: 'invite', personId: 1, neighborId: data.neighbors[2].id });
    runMinutes(s, 300);
    s.apply({ kind: 'queue', personId: 2, interactionId: 'social.chat', targetUid: 1 });
    runMinutes(s, 300);
    const r = Simulation.replay(data, 21, [{ name: '에드릭', sex: 'male' }, { name: '마르타', sex: 'female' }], s.inputLog, s.stats.ticks);
    expect(r.worldHash()).toBe(s.worldHash());
  });
});

describe('M3 리뷰 회귀', () => {
  it('1. 떠나는 손님은 출구에서 오래 서 있지 않음 (20분 안에 사라짐)', () => {
    let worst = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = family(seed);
      s.apply({ kind: 'invite', personId: 1, neighborId: data.neighbors[1].id });
      runMinutes(s, 70);
      const v = s.persons.find((p) => p.visitor);
      if (!v) continue;
      s.apply({ kind: 'sendHome', personId: v.id });
      const ex = s.world.exits[0];
      let atExitSince = -1;
      for (let i = 0; i < 180 && s.persons.includes(v); i++) {
        s.tick();
        const near = Math.abs(v.cellX() - ex.x) + Math.abs(v.cellY() - ex.y) <= 1;
        if (near && atExitSince < 0) atExitSince = s.world.minute;
        if (!near) atExitSince = -1;
      }
      expect(s.persons.includes(v)).toBe(false);
      if (atExitSince >= 0) worst = Math.max(worst, s.world.minute - atExitSince);
    }
    expect(worst).toBeLessThan(20);
  });

  it('2. 손님 인사가 조용히 사라지지 않음 (도착하면 식구와 만난 사이가 됨)', () => {
    let met = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const s = family(seed);
      s.apply({ kind: 'invite', personId: 1, neighborId: data.neighbors[2].id });
      runMinutes(s, 300); // 걷기 2칸/분 (심즈 템포): 길 끝에서 걸어 들어와 인사까지 (식구가 하던 일을 마치고 맞음)
      const v = s.persons.find((p) => p.visitor) ?? [...s.away.values()][0];
      if (v && (s.rel.get(1, v.id)?.met || s.rel.get(2, v.id)?.met)) met++;
    }
    expect(met).toBeGreaterThanOrEqual(9);
  });

  it('4/5. 살림을 쓰는 상호작용은 재고를 씀, 유혹하기 같은 로맨스성 상호작용은 식구에게 안 뜸', () => {
    const s = family();
    s.apply({ kind: 'setAutonomy', enabled: false });
    const share = Object.entries(data.social).find(([, d]) => d.requires.stock && Object.keys(d.requires.stock).includes('bread'));
    if (share) {
      s.world.stock.bread = 4;
      s.apply({ kind: 'queue', personId: 1, interactionId: share[0], targetUid: 2 });
      runMinutes(s, 40);
      expect(s.world.stock.bread).toBeLessThan(4);
    }
    const f = new Simulation(data, 2);
    for (const n of ['a', 'b', 'c']) f.addPerson(n);
    f.apply({ kind: 'setRelation', a: 1, b: 2, flags: ['spouse'], romance: 50, met: true });
    f.apply({ kind: 'setRelation', a: 1, b: 3, romance: 30, met: true });
    expect(f.menuForPerson(1, 3).some((e) => e.interactionId === 'social.seduce')).toBe(false);
  });

  it('13. 관계 키가 큰 id 에서도 겹치지 않음', () => {
    const s = family();
    s.rel.ensure(1, 4099).friendship = 50;
    expect(s.rel.friendship(2, 3)).toBe(0);
  });
});
