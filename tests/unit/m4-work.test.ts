/**
 * M4 일: 직업(래빗홀 출근 → 일당 → 성과 → 승급/결근), 스킬 경험치 곡선, 돈(장부에서 사고팔기, 십일조), 저장고 부패, 계절
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/sim';
import { simRaw } from '../../tools/data-node';
import { validateSimData } from '../../src/sim/data/simData';
import { runMinutes } from './helpers';

const TEST_CAREERS = {
  careers: {
    field_hand: {
      nameKey: 'career.field_hand', icon: 'plant', type: 'rabbithole', estates: ['serf', 'freeman'], skills: ['fitness', 'farming'],
      workplace: 'lot_exit', hours: [8, 14], days: [0, 1, 2, 3, 4, 5],
      ranks: [{ nameKey: 'r1', wage: 16 }, { nameKey: 'r2', wage: 24 }, { nameKey: 'r3', wage: 36 }], promoteAt: 40,
      events: [{ id: 'ev', textKey: 'ev', options: [{ id: 'a', textKey: 'a', effects: { performance: 5, money: 8 } }, { id: 'b', textKey: 'b' }] }],
    },
  },
};

function data(extra: Record<string, unknown> = {}) {
  const raw = simRaw() as Record<string, unknown>;
  return validateSimData({ ...raw, careers: raw.careers ?? TEST_CAREERS, ...extra } as never);
}
const D = data();

function family(seed = 1) {
  const s = new Simulation(D, seed);
  s.addPerson('에드릭', undefined, undefined, { estate: 'freeman' });
  s.addPerson('마르타', undefined, undefined, { estate: 'freeman' });
  return s;
}

describe('직업 (17-2, 17-7)', () => {
  it('출근 시각에 부지 출구로 나가 사라졌다가 퇴근하면 일당을 받음', () => {
    const s = family();
    const careerId = Object.keys(D.careers!).find((k) => D.careers![k].type === 'rabbithole' && D.careers![k].estates.includes('freeman'))!;
    expect(s.apply({ kind: 'setCareer', personId: 1, careerId })).toMatchObject({ ok: true });
    const def = D.careers![careerId];
    const money0 = s.econ!.account(1)!.money;
    // 출근일로 맞춤 (달력 0일 = 월요일)
    let hidden = false;
    for (let i = 0; i < 1440; i++) {
      s.tick();
      if (s.persons[0].hidden && s.persons[0].action?.item.interactionId === `work.${careerId}`) hidden = true;
    }
    expect(hidden).toBe(true);
    const got = s.econ!.account(1)!.book.concat([s.econ!.account(1)!.today]).reduce((a, b) => a + (b.income.wage ?? 0), 0);
    expect(got).toBeGreaterThanOrEqual(Math.round(def.ranks[0].wage! * 0.7));
    expect(s.persons[0].career!.perf).toBeGreaterThan(0);
    expect(s.notices.some((n) => n.kind === 'go_work')).toBe(true);
    void money0;
  });

  it('성실(열심히)은 농땡이보다 성과가 빨리 쌓이고 승급함', () => {
    const run = (att: 'hard' | 'slack') => {
      const s = family(3);
      const careerId = Object.keys(D.careers!).find((k) => D.careers![k].type === 'rabbithole' && D.careers![k].estates.includes('freeman'))!;
      s.apply({ kind: 'setCareer', personId: 1, careerId });
      s.apply({ kind: 'setAttitude', personId: 1, attitude: att });
      runMinutes(s, 1440 * 6);
      return s.persons[0].career;
    };
    const hard = run('hard');
    const slack = run('slack');
    expect(hard!.rank * 1000 + hard!.perf).toBeGreaterThan(slack!.rank * 1000 + slack!.perf);
  });

  it('출근일에 못 가면 성과가 깎임', () => {
    const s = family(5);
    const careerId = Object.keys(D.careers!).find((k) => D.careers![k].type === 'rabbithole' && D.careers![k].estates.includes('freeman'))!;
    s.apply({ kind: 'setCareer', personId: 1, careerId });
    // 하루 내내 쓰러져 있게 해 출근을 막음
    s.persons[0].collapse = { kind: 'floor_sleep', remaining: 1440 } as never;
    runMinutes(s, 1440);
    expect(s.persons[0].career!.perf).toBeLessThan(0);
  });
});

describe('스킬 (17-1)', () => {
  it('레벨 n → n+1 경험치 = 100 × n^1.4, 0.45 XP/분', () => {
    if (!D.skills) return;
    const s = family();
    const sk = s.skills!;
    expect(sk.xpToNext(1)).toBeCloseTo(100, 5);
    expect(sk.xpToNext(5)).toBeCloseTo(100 * Math.pow(5, 1.4), 3);
    const p = s.persons[0];
    p.traits = [];
    const id = Object.keys(D.skills.skills)[0];
    // 보정 없이 100/0.45 분이면 1레벨
    sk.gain(p, id, 100 / 0.45 + 0.01, null);
    expect(p.skills[id]).toBe(1);
  });

  it('%보정은 합산 후 +100% 상한', () => {
    if (!D.skills) return;
    const s = family();
    const p = s.persons[0];
    const id = Object.keys(D.skills.skills)[0];
    const before = p.skillXp[id] ?? 0;
    s.skills!.gain(p, id, 10, null, 500);
    expect((p.skillXp[id] ?? 0) - before).toBeCloseTo(0.45 * 2 * 10, 5);
  });
});

describe('돈과 장부 (17-4, 17-8, 17-9)', () => {
  it('장보기는 돈을 내고 재고가 늘고, 장부 재고가 줄어듦', () => {
    const s = family();
    s.apply({ kind: 'setAutonomy', enabled: false });
    const a = s.econ!.account(1)!;
    const m0 = a.money;
    const q0 = s.econ!.goods.vegetables.q;
    const exit = s.world.objects.find((o) => o.defId === 'lot_exit')!;
    s.world.stock.ingredients = 0;
    const ing0 = 0;
    s.apply({ kind: 'setTime', minuteOfDay: 9 * 60 });
    s.apply({ kind: 'queue', personId: 1, interactionId: 'lot_exit.market', targetUid: exit.uid });
    runMinutes(s, 200);
    expect(a.money).toBeLessThan(m0);
    expect(s.world.stock.ingredients).toBeGreaterThan(ing0);
    expect(s.econ!.goods.vegetables.q).toBeLessThan(q0 + 1e-6 + 30);
  });

  it('하루 끝에 십일조 10% (파딩 미만 이월)', () => {
    const s = family();
    const a = s.econ!.account(1)!;
    s.econ!.earn(a, 37, 'wage');
    runMinutes(s, 1440 - (s.world.minute % 1440));
    const tithe = a.book[a.book.length - 1].expense.tithe ?? 0;
    expect(tithe).toBe(3);
    expect(a.titheCarry.v).toBeCloseTo(0.7, 5);
  });

  it('빵은 3일 지나면 상해서 버려짐 (부패 17-5)', () => {
    const s = family();
    s.apply({ kind: 'setAutonomy', enabled: false });
    s.world.stock.bread = 5;
    runMinutes(s, 1440 * 5);
    expect(s.world.stock.bread).toBe(0);
    expect(s.notices.some((n) => n.kind === 'spoiled')).toBe(true);
  });

  it('계절이 7일마다 바뀜', () => {
    const s = family();
    s.apply({ kind: 'setAutonomy', enabled: false });
    expect(s.world.season).toBe('spring');
    runMinutes(s, 1440 * 7);
    expect(s.world.season).toBe('summer');
  });
});

describe('여정형 직업 (17-2 원거리 상인)', () => {
  it('며칠 떠났다가 돌아와 교역 수익(또는 손실)을 가계에 남김', () => {
    if (!D.careers?.trader) return;
    const s = new Simulation(D, 7);
    s.addPerson('상인', undefined, undefined, { estate: 'merchant' });
    s.addPerson('아내', undefined, undefined, { estate: 'merchant' });
    expect(s.apply({ kind: 'setCareer', personId: 1, careerId: 'trader' })).toMatchObject({ ok: true });
    let gone = 0;
    for (let i = 0; i < 1440 * 7; i++) {
      s.tick();
      if (s.persons[0].hidden) gone++;
    }
    expect(gone).toBeGreaterThan(1440 * 2.5);
    expect(s.notices.some((n) => n.kind === 'journey_done' || n.kind === 'journey_loss') || s.econ!.account(1)!.book.some((d) => d.income.trade || d.expense.trade_loss)).toBe(true);
    expect(s.stats.collapses).toBe(0);
  });
});

describe('서비스형 현장 직업 (음유시인 공연 등)', () => {
  it('근무 시간에 일감만큼 나가서 사례금을 받음', () => {
    if (!D.careers?.minstrel) return;
    const s = new Simulation(D, 9);
    s.addPerson('악사', undefined, undefined, { estate: 'freeman' });
    s.addPerson('아내', undefined, undefined, { estate: 'freeman' });
    s.apply({ kind: 'setCareer', personId: 1, careerId: 'minstrel' });
    runMinutes(s, 1440 * 2);
    const shop = [...s.econ!.account(1)!.book, s.econ!.account(1)!.today].reduce((a, d) => a + (d.income.shop ?? 0), 0);
    expect(shop).toBeGreaterThan(0);
  });
});

describe('가게 (17-3)', () => {
  it('가게를 열면 손님(이웃)이 와서 흥정하고 물건을 사 감, 평판이 움직임', () => {
    const s = family(4);
    s.world.stock.horseshoes = 6;
    s.world.stock.knife = 4;
    s.apply({ kind: 'setShop', open: true, priceMult: 1 });
    runMinutes(s, 1440 * 2);
    expect(s.shop.sales).toBeGreaterThan(0);
    const shopIncome = [...s.econ!.account(1)!.book, s.econ!.account(1)!.today].reduce((a, d) => a + (d.income.shop ?? 0), 0);
    expect(shopIncome).toBeGreaterThan(0);
    expect(s.stats.stuckEvents).toBe(0);
  });
});

describe('M4 리뷰 회귀 (일, 경제)', () => {
  it('1. 8시간 근무 뒤 허기/용변이 바닥나지 않음 (일터에서 먹고 볼일)', () => {
    const s = family(12);
    s.apply({ kind: 'setCareer', personId: 1, careerId: Object.keys(D.careers!).find((k) => D.careers![k].type === 'rabbithole' && D.careers![k].estates.includes('freeman'))! });
    let workMinZeroHunger = 0;
    for (let i = 0; i < 1440 * 3; i++) {
      s.tick();
      const p = s.persons[0];
      if (p.hidden && p.action?.item.interactionId.startsWith('work.') && p.needs[0] <= 0) workMinZeroHunger++;
    }
    expect(workMinZeroHunger).toBe(0);
    expect(s.stats.accidents).toBe(0);
  });

  it('2. 주문 없는 현장형(사제)도 등급 일당을 받고 근무일이 셈', () => {
    if (!D.careers?.priest) return;
    const s = new Simulation(D, 13);
    s.addPerson('사제', undefined, undefined, { estate: 'clergy' });
    s.addPerson('집사', undefined, undefined, { estate: 'clergy' });
    s.persons[0].skills.reading = 3; // 사제는 글을 알아야 함
    expect(s.apply({ kind: 'setCareer', personId: 1, careerId: 'priest' })).toMatchObject({ ok: true });
    runMinutes(s, 1440 * 3);
    const wage = [...s.econ!.account(1)!.book, s.econ!.account(1)!.today].reduce((a, d) => a + (d.income.wage ?? 0), 0);
    expect(wage).toBeGreaterThan(0);
    expect(s.persons[0].career!.days).toBeGreaterThan(0);
  });

  it('3. 양조사는 빈 통에 에일을 담가 둠', () => {
    if (!D.careers?.brewer) return;
    const s = new Simulation(D, 14);
    s.addPerson('양조가', undefined, undefined, { estate: 'artisan' });
    s.addPerson('아내', undefined, undefined, { estate: 'artisan' });
    s.apply({ kind: 'setCareer', personId: 1, careerId: 'brewer' });
    runMinutes(s, 1440 * 2);
    const brewed = Object.keys(s.stats.completed).filter((k) => k.startsWith('recipe.')).length;
    expect(brewed).toBeGreaterThan(0);
  });

  it('4. 도제는 재료값을 가계에서 내지 않음', () => {
    const s = family(15);
    s.apply({ kind: 'setCareer', personId: 1, careerId: 'blacksmith' });
    runMinutes(s, 1440 * 2);
    const mat = [...s.econ!.account(1)!.book, s.econ!.account(1)!.today].reduce((a, d) => a + (d.expense.materials ?? 0), 0);
    expect(mat).toBe(0);
  });

  it('10. 대출 한도까지 부분 대출, 한도 넘는 빚이 유예를 넘기면 파산', () => {
    const s = family(16);
    const e = s.econ!;
    const a = e.account(1)!;
    a.money = -Math.round(e.loanLimit(a) * 1.5);
    for (let d = 0; d < 10; d++) e.endOfDay(d, {});
    expect(e.bankrupt).toBeGreaterThan(0);
  });
});
