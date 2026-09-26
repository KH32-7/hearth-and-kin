/**
 * M8 상속 (GDD 16-5): 상속법 3 (장자 / 균분 / 지명 유언장), 계승 순위 (사생아·성직자·출가한 딸 뒤로, 설정),
 * 가장 사망 흐름 (장례 → 유언 공개 → 새 가장 → 조작 인물 선택), 상속 분쟁 사건 재현 (BRIEF M8 통과 조건)
 */
import { describe, expect, it } from 'vitest';
import { family, fakeWorld } from './m8-house-fake';

function kids3() {
  const w = fakeWorld(5);
  const f = family(w, 1, [
    { name: '첫째', sex: 'male', ageDays: 20 },
    { name: '둘째', sex: 'female', ageDays: 10 },
    { name: '셋째', sex: 'male', ageDays: 2 },
  ]);
  w.host.moneyOf.set(1, 1000);
  w.host.houses.set(1, 600);
  return { w, f, a: f.children[0], b: f.children[1], c: f.children[2] };
}

describe('M8 상속법 3 (16-5)', () => {
  it('장자상속: 첫째가 집과 재산 대부분, 나머지는 소액(10%) + 같은 집 성인이면 분가', () => {
    const { w, f, a, b, c } = kids3();
    const r = w.house.inheritance.onDeath(f.dad, 'old_age')!;
    w.host.kill(f.dad);
    expect(r.law).toBe('primogeniture');
    expect(r.heir).toBe(a.id);
    const byId = Object.fromEntries(r.shares.map((s) => [s.personId, s]));
    expect(byId[a.id]).toMatchObject({ house: true, money: 800, value: 1400 });
    expect(byId[b.id]).toMatchObject({ house: false, money: 100 });
    expect(byId[c.id]).toMatchObject({ house: false, money: 100 });
    expect(r.splits.sort()).toEqual([b.id, c.id].sort());
    expect(w.host.log.splits.length).toBe(2);
    expect(b.household).not.toBe(1);
    expect(w.house.clans.clanOf(b)?.id).toBe(f.clan.id); // 분가해도 같은 가문
    expect(w.host.moneyOf.get(b.household)).toBe(100);
    expect(w.host.moneyOf.get(1)).toBe(800);
    expect(w.house.clans.head(f.clan.id)?.id).toBe(a.id);
    expect(w.host.moodletsOf(a)).toContain('new_head_of_house');
    expect(w.host.moodletsOf(a)).toContain('inheritance_received');
    expect(w.host.moodletsOf(b)).toContain('inheritance_slighted');
  });

  it('균분상속: 돈 + 집을 똑같이 나눔. 집은 한 명(첫째), 나머지는 돈', () => {
    const { w, f, a, b, c } = kids3();
    w.house.clans.setLaw(f.clan.id, 'equal');
    w.host.houses.set(1, 300);
    const r = w.house.inheritance.settle(f.clan.id, f.dad);
    expect(r.law).toBe('equal');
    const byId = Object.fromEntries(r.shares.map((s) => [s.personId, s]));
    expect(byId[a.id]).toMatchObject({ house: true, money: 133 });
    expect(byId[a.id].value).toBeCloseTo(433, -1);
    expect(byId[b.id].value).toBeCloseTo(433, -1);
    expect(byId[c.id].value).toBeCloseTo(433, -1);
    expect(r.splits).toEqual([]);
    // 돈이 모자라면 비율로 줄임 (집이 비쌈)
    w.host.moneyOf.set(1, 100);
    w.host.houses.set(1, 3000);
    const r2 = w.house.inheritance.settle(f.clan.id, f.dad);
    expect(r2.shares.reduce((s, x) => s + x.money, 0)).toBeLessThanOrEqual(100);
    expect(r2.shares.find((s) => s.personId === a.id)!.money).toBe(0);
  });

  it('지명상속: 유언장 (문해력 또는 사제 + 수수료). 유언장대로 계승자·몫·가보, 없으면 장자상속으로', () => {
    const { w, f, a, b, c } = kids3();
    w.house.clans.setLaw(f.clan.id, 'will');
    // 글을 모르고 사제도 없음
    w.host.priest = false;
    expect(w.house.inheritance.canWriteWill(f.dad).reason).toBe('illiterate');
    expect(w.house.inheritance.writeWill(f.dad, { heir: c.id }).ok).toBe(false);
    // 사제가 받아 적음: 수수료
    w.host.priest = true;
    expect(w.house.inheritance.canWriteWill(f.dad)).toMatchObject({ ok: true, via: 'priest' });
    expect(w.house.inheritance.writeWill(f.dad, { heir: c.id, shares: { [a.id]: 0.3 } }).ok).toBe(true);
    expect(w.host.moneyOf.get(1)).toBe(976);
    expect(w.house.inheritance.flags(f.dad).has('will_written')).toBe(true);
    // 문해력이 있으면 수수료 없음, 몫 합이 1 넘으면 안 됨
    f.dad.skills.reading = 2;
    expect(w.house.inheritance.canWriteWill(f.dad).via).toBe('self');
    expect(w.house.inheritance.writeWill(f.dad, { heir: c.id, shares: { [a.id]: 0.7, [b.id]: 0.5 } }).reason).toBe('shares_over');
    expect(w.house.inheritance.writeWill(f.dad, { heir: c.id, shares: { [a.id]: 0.3 } }).ok).toBe(true);
    expect(w.host.moneyOf.get(1)).toBe(976);
    const r = w.house.inheritance.onDeath(f.dad, 'illness')!;
    expect(r.law).toBe('will');
    expect(r.heir).toBe(c.id);
    expect(r.newHead).toBe(c.id);
    const byId = Object.fromEntries(r.shares.map((s) => [s.personId, s]));
    expect(byId[a.id].money).toBe(292);
    expect(byId[c.id]).toMatchObject({ house: true, money: 976 - 292 });
    expect(byId[b.id].money).toBe(0);
    // 유언장이 없으면 대체 법
    const x = kids3();
    x.w.house.clans.setLaw(x.f.clan.id, 'will');
    const r2 = x.w.house.inheritance.settle(x.f.clan.id, x.f.dad);
    expect(r2.fallback).toBe(true);
    expect(r2.law).toBe('primogeniture');
    expect(r2.heir).toBe(x.a.id);
  });
});

describe('M8 계승 순위 (16-5: 사생아·성직자·출가한 딸 뒤로, 설정 가능)', () => {
  it('사생아·성직자·출가한 딸은 기본 순위에서 뒤로, 끄면 나이순', () => {
    const w = fakeWorld();
    const f = family(w, 1, [
      { name: '사생아', ageDays: 30 },
      { name: '사제', ageDays: 25 },
      { name: '출가딸', sex: 'female', ageDays: 20 },
      { name: '막내', ageDays: 1 },
    ]);
    const [bastard, priest, daughter, youngest] = f.children;
    w.house.clans.markBastard(bastard);
    priest.estate = 'clergy';
    for (const k of f.children) w.house.clans.onBirth(k, w.house.clans.bastards.has(k.id));
    // 딸이 다른 가문으로 시집감
    const inlaw = family(w, 2, [{ name: '사위' }], 'freeman', 'house.h_millbrook');
    daughter.household = 2;
    daughter.spouse = inlaw.children[0].id;
    const order = w.house.inheritance.successionOrder(f.clan.id, f.dad).map((p) => p.name);
    expect(order[0]).toBe('막내');
    expect(order.slice(1)).toEqual(['사생아', '사제', '출가딸']);
    expect(w.house.inheritance.demotion(daughter, f.clan.id, f.clan.lawOpts)).toBe('married_daughter');
    w.house.clans.setLaw(f.clan.id, 'primogeniture', { bastardsLast: false, clergyLast: false, marriedDaughtersLast: false });
    expect(w.house.inheritance.successionOrder(f.clan.id, f.dad).map((p) => p.name)).toEqual(['사생아', '사제', '출가딸', '막내']);
    w.house.clans.setLaw(f.clan.id, 'primogeniture', { clergyLast: true });
    expect(w.house.inheritance.successionOrder(f.clan.id, f.dad).map((p) => p.name)).toEqual(['사생아', '출가딸', '막내', '사제']);
    expect(youngest.id).toBeGreaterThan(0);
  });

  it('아들 먼저 설정, 어린 계승자면 배우자가 가장 (가보·집은 계승자)', () => {
    const w = fakeWorld();
    const f = family(w, 1, [
      { name: '딸', sex: 'female', stage: 'child', ageDays: 9 },
      { name: '아들', sex: 'male', stage: 'child', ageDays: 3 },
    ]);
    f.mom.lifeStage = 'adult';
    expect(w.house.inheritance.successionOrder(f.clan.id, f.dad)[0].name).toBe('딸');
    w.house.clans.setLaw(f.clan.id, 'primogeniture', { malePreference: true });
    expect(w.house.inheritance.successionOrder(f.clan.id, f.dad)[0].name).toBe('아들');
    const r = w.house.inheritance.onDeath(f.dad, 'accident')!;
    w.host.kill(f.dad);
    expect(r.heir).toBe(f.children[1].id);
    expect(r.newHead).toBe(f.mom.id);
    expect(r.heirloomsTo).toBe(f.children[1].id);
    expect(r.splits).toEqual([]); // 어린 자녀는 분가하지 않음
    expect(w.house.clans.head(f.clan.id)?.id).toBe(f.mom.id);
  });

  it('자녀가 없으면 배우자가 가장이고 재산은 가정에 그대로', () => {
    const w = fakeWorld();
    const f = family(w, 1, []);
    w.host.moneyOf.set(1, 500);
    const r = w.house.inheritance.onDeath(f.dad, 'old_age')!;
    expect(r.newHead).toBe(f.mom.id);
    expect(r.shares).toEqual([{ personId: f.mom.id, money: 500, house: true, value: 500 }]);
    expect(w.host.log.transfers).toEqual([]);
  });
});

describe('M8 가장 사망 흐름 (16-5)', () => {
  it('가장이 죽으면 장례 → 유언 공개(차단 장면) → 새 가장 → 조작 가문이면 조작 인물 선택 훅, 연대기·소식', () => {
    const { w, f, a } = kids3();
    const r = w.house.inheritance.onDeath(f.dad, 'old_age')!;
    expect(w.host.log.funerals).toEqual([f.dad.id]);
    expect(w.host.log.scenes.map((s) => s.kind)).toEqual(['will_reading']);
    expect(w.host.log.chooseControlled).toEqual([f.clan.id]);
    expect(w.host.log.chronicle.some((c) => c.trigger === 'head_passed')).toBe(true);
    expect(w.host.log.news.some((n) => n.kind === 'new_head')).toBe(true);
    expect(r.newHead).toBe(a.id);
    expect(w.house.clans.records.get(f.dad.id)).toMatchObject({ cause: 'old_age', deathDay: 10 });
    expect(w.house.inheritance.flags(a).has('recent_inheritance')).toBe(true);
    w.host.dayN += 8;
    expect(w.house.inheritance.flags(a).has('recent_inheritance')).toBe(false);
  });

  it('가장이 아닌 사람이 죽으면 기록만 (상속 없음), 조작 가문이 아니면 선택 훅 없음', () => {
    const { w, f, c } = kids3();
    expect(w.house.inheritance.onDeath(c, 'illness')).toBeNull();
    expect(w.house.clans.records.get(c.id)?.cause).toBe('illness');
    const w2 = fakeWorld();
    const g = family(w2, 5, [{ name: '아들' }]);
    w2.house.inheritance.onDeath(g.dad, 'old_age');
    expect(w2.host.log.chooseControlled).toEqual([]);
    expect(f.clan.id).toBeGreaterThan(0);
  });
});

describe('M8 상속 분쟁 사건 재현 (16-5, inheritance_dispute 카드)', () => {
  function disputeSetup(opts: { friendship: number; affection: number; law?: 'primogeniture' | 'equal' }) {
    const { w, f, a, b, c } = kids3();
    if (opts.law) w.house.clans.setLaw(f.clan.id, opts.law);
    w.host.setFriend(a, b, opts.friendship);
    w.host.setFriend(a, c, 40);
    b.clanAffection = opts.affection;
    c.clanAffection = 80;
    const r = w.house.inheritance.onDeath(f.dad, 'old_age')!;
    w.host.kill(f.dad);
    return { w, f, a, b, c, r };
  }

  it('형제 관계 나쁨 + 재산 차 큼 + 가문 애정 낮음 → 계승자에게 분쟁 카드 (상대 = 서운한 형제), 플래그', () => {
    const { w, a, b, c, r } = disputeSetup({ friendship: -30, affection: 20 });
    expect(r.disputes.map((d) => [d.heir, d.other])).toEqual([[a.id, b.id]]);
    expect(r.disputes[0].gap).toBeGreaterThan(0.4);
    const card = w.host.log.cards.find((x) => x.card === 'inheritance_dispute')!;
    expect(card).toMatchObject({ p: a.id, other: b.id });
    expect(card.vars).toMatchObject({ other: b.name });
    const flags = w.house.flags(a);
    for (const fl of ['sibling_rivalry', 'recent_inheritance', 'head_of_house']) expect(flags.has(fl), fl).toBe(true);
    expect(w.house.flags(b).has('sibling_rivalry')).toBe(true);
    expect(w.house.flags(c).has('sibling_rivalry')).toBe(false);
  });

  it('셋 중 하나라도 빠지면 분쟁 없음: 사이가 좋음 / 가문 애정 높음 / 균분이라 재산 차가 작음', () => {
    for (const o of [{ friendship: 30, affection: 20 }, { friendship: -30, affection: 70 }, { friendship: -30, affection: 20, law: 'equal' as const }]) {
      const { w, r } = disputeSetup(o);
      expect(r.disputes, JSON.stringify(o)).toEqual([]);
      expect(w.host.log.cards.some((x) => x.card === 'inheritance_dispute')).toBe(false);
    }
  });

  it('유언장에서 빠진 자식도 분쟁을 일으킴 (지명상속)', () => {
    const { w, f, a, b, c } = kids3();
    w.house.clans.setLaw(f.clan.id, 'will');
    f.dad.skills.reading = 3;
    w.house.inheritance.writeWill(f.dad, { heir: c.id });
    w.host.setFriend(c, a, -50);
    a.clanAffection = 10;
    const r = w.house.inheritance.onDeath(f.dad, 'old_age')!;
    expect(r.disputes.map((d) => [d.heir, d.other])).toEqual([[c.id, a.id]]);
    expect(b.id).toBeGreaterThan(0);
  });

  it('분쟁 카드 "형제를 집안에서 내친다" → 가문 분열: 분가해 새 가문(같은 성), 두 가문은 원수, 가계도에 의절 표시', () => {
    const { w, f, a, b } = disputeSetup({ friendship: -30, affection: 20 });
    // 장자상속 분가로 이미 다른 가정 (같은 가문)
    expect(w.house.clans.clanOf(b)?.id).toBe(f.clan.id);
    const nid = w.house.inheritance.onDisputeResolved(2, a, b);
    expect(nid).toBeGreaterThan(0);
    const nc = w.house.clans.clan(nid)!;
    expect(nc.name).toBe(f.clan.name);
    expect(nc.parent).toBe(f.clan.id);
    expect(w.house.clans.clanOf(b)?.id).toBe(nid);
    expect(w.house.clans.relationLevel(f.clan.id, nid)).toBe('enemy');
    expect(w.house.clans.records.get(b.id)?.disowned).toBe(true);
    expect(w.house.clans.head(nid)?.id).toBe(b.id);
    expect(w.host.moodletsOf(a)).toContain('clan_enemy_anger');
    // 다른 선택지는 가문을 쪼개지 않음
    expect(w.house.inheritance.onDisputeResolved(0, a, b)).toBe(0);
  });

  it('같은 집에 사는 형제를 내치면 분가시킨 뒤 새 가문', () => {
    const { w, f, a, b } = kids3();
    w.house.clans.setLaw(f.clan.id, 'equal');
    w.house.inheritance.onDeath(f.dad, 'old_age');
    w.host.kill(f.dad);
    expect(b.household).toBe(1);
    const nid = w.house.inheritance.onDisputeResolved(2, a, b);
    expect(nid).toBeGreaterThan(0);
    expect(b.household).not.toBe(1);
    expect(w.host.log.splits.at(-1)).toMatchObject({ reason: 'disowned' });
  });

  it('유령의 "남겨진 비밀": 상속을 다시 하지 않고 분쟁 카드만 다시 (20-6)', () => {
    const { w, f, a } = disputeSetup({ friendship: 10, affection: 90 });
    expect(w.host.log.cards.length).toBe(0);
    const head = w.house.clans.head(f.clan.id);
    expect(w.house.inheritance.ghostSecret(f.clan.id)).toBe(true);
    expect(w.host.log.cards.at(-1)).toMatchObject({ card: 'inheritance_dispute', p: a.id });
    expect(w.house.clans.head(f.clan.id)).toBe(head);
  });
});
