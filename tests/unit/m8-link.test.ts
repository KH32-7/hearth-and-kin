/**
 * M8 연결 (houseLink.ts): 마을 가문 등록, 21 프리셋 적용 (신분·돈·명성·집·직업), 출생 신분, 가장 사망 → 상속, 명성 경로, 결정론
 */
import { describe, expect, it } from 'vitest';
import { loadSimData } from '../../tools/data-node';
import { Simulation } from '../../src/sim/sim';

const data = loadSimData({ town: 'ashford' });
const town = (seed = 1) => new Simulation(data, seed);
const fam = (sim: Simulation) => sim.persons.filter((p) => p.household === 1);

describe('M8 가문과 신분 연결', () => {
  it('마을 가문이 등록되고 조작 가문에도 가문과 가장이 있음', () => {
    const sim = town();
    const H = sim.house!;
    expect(H).toBeTruthy();
    const cl = H.house.clans.clanOfHousehold(1);
    expect(cl).toBeTruthy();
    expect(H.house.clans.head(cl!.id)?.household).toBe(1);
    const hhs = new Set(sim.persons.filter((p) => p.household >= 100).map((p) => p.household));
    const registered = [...hhs].filter((hh) => H.house.clans.clanOfHousehold(hh));
    expect(registered.length).toBeGreaterThan(hhs.size * 0.8);
    // 영주 가문 명성이 평범한 가문보다 높음
    expect(Math.max(...[...hhs].map((hh) => H.fameOf(hh)))).toBeGreaterThan(600);
  });

  it('21 프리셋 모두 적용: 신분·현금/빚·명성·가족 구성', () => {
    const H0 = town().house!;
    const ids = H0.presetList();
    expect(ids.length).toBe(21);
    for (const id of ids) {
      const sim = town(3);
      const r = sim.apply({ kind: 'house', op: 'applyPreset', args: { preset: id } }) as { ok: boolean; reason?: string; result: import('../../src/sim/house/presets').PresetResult };
      expect(r.ok, `${id}: ${r.reason}`).toBe(true);
      const res = r.result;
      const members = fam(sim);
      expect(members.length, id).toBeGreaterThanOrEqual(res.specs.length);
      expect(sim.house!.householdEstate(1), id).toBe(res.estate);
      const a = sim.econ!.account(1)!;
      expect(a.estate).toBe(res.estate);
      if (res.wealth === 'poor') {
        expect(sim.econ!.debt(a), id).toBeGreaterThan(0);
      } else expect(a.money, id).toBe(res.cash + res.capital);
      expect(sim.house!.fameOf(1), id).toBe(res.fame);
      // 필수 자산: 직업
      for (const [pid, career] of Object.entries(res.careers)) expect(sim.persons.find((q) => q.id === Number(pid))?.career?.id).toBe(career);
    }
  }, 120000);

  it('프리셋 뒤 하루가 문제없이 흐르고 같은 시드면 같은 해시', () => {
    const run = () => {
      const sim = town(5);
      sim.apply({ kind: 'house', op: 'applyPreset', args: { preset: 'artisan_normal' } });
      for (let i = 0; i < 1440; i++) sim.tick();
      return sim.worldHash();
    };
    expect(run()).toBe(run());
  }, 60000);

  it('출생: 아기 신분은 16-2 두 층 규칙 (가정 대표 신분), 가계도에 기록', () => {
    const sim = town(2);
    const mom = sim.persons.find((p) => p.household >= 100 && p.sex === 'female' && p.spouse && p.lifeStage !== 'elder')!;
    const dad = sim.persons.find((p) => p.id === mom.spouse)!;
    const baby = (sim as unknown as { bornTo(m: unknown, f: unknown): import('../../src/sim/people/person').Person }).bornTo(mom, dad);
    expect(baby.estate).toBe(sim.house!.householdEstate(mom.household));
    expect(sim.house!.house.clans.clanOf(baby)).toBe(sim.house!.house.clans.clanOf(mom));
  });

  it('가장이 죽으면 상속: 새 가장이 정해짐', () => {
    const sim = town(4);
    sim.apply({ kind: 'house', op: 'applyPreset', args: { preset: 'freeman_normal' } });
    const H = sim.house!;
    const cl = H.house.clans.clanOfHousehold(1)!;
    const head = H.house.clans.head(cl.id)!;
    (sim as unknown as { killPerson(p: unknown, c: string): void }).killPerson(head, 'illness');
    const nh = H.house.clans.head(cl.id);
    expect(nh).toBeTruthy();
    expect(nh!.id).not.toBe(head.id);
  });

  it('사건 카드 명성 변화는 가문 명성으로 (Simulation.fame 대체)', () => {
    const sim = town(6);
    const H = sim.house!;
    const f0 = H.fameOf(1);
    (sim as unknown as { addFame(hh: number, d: number, r: string): void }).addFame(1, -25, 'test');
    expect(H.fameOf(1)).toBe(f0 - 25);
  });

  it('파산 알림 → 가정 한 단계 하락 (장인 → 자유민)', () => {
    const sim = town(7);
    sim.apply({ kind: 'house', op: 'applyPreset', args: { preset: 'artisan_normal' } });
    sim.house!.onBankrupt(1);
    expect(sim.house!.householdEstate(1)).toBe('freeman');
  });

  it('의도: 가훈·문장·해방금', () => {
    const sim = town(8);
    sim.apply({ kind: 'house', op: 'applyPreset', args: { preset: 'serf_rich' } });
    const m = sim.apply({ kind: 'house', op: 'setMotto', args: { text: '땅은 거짓말을 하지 않는다', tags: [] } }) as { ok: boolean };
    expect(m.ok).toBe(true);
    const pay = sim.apply({ kind: 'house', op: 'payEmancipation', args: {} }) as { ok: boolean; reason?: string };
    expect(pay.ok, pay.reason).toBe(true);
    expect(sim.house!.householdEstate(1)).toBe('freeman');
    expect(fam(sim).every((p) => p.estate !== 'serf' || p.lifeStage === 'baby')).toBe(true);
  });

  it('빚 (17-6): 상환일 뒤 가진 만큼 갚고, 유예 끝에 살림 압류가 빚을 덮으면 파산이 아님 / 못 덮으면 파산 → 한 단계 하락', () => {
    for (const covered of [true, false]) {
      const sim = town(11);
      sim.apply({ kind: 'house', op: 'applyPreset', args: { preset: 'artisan_normal' } });
      const e = sim.econ!;
      const a = e.account(1)!;
      a.money = 0;
      a.loans = [];
      const loan = e.borrow(a, 400, 'moneylender', 1, 0);
      a.money = 150;
      for (const k of Object.keys(sim.world.stock)) if (!['bread', 'firewood'].includes(k)) sim.world.stock[k] = 0;
      if (covered) sim.world.stock.wool = 200;
      let bankrupt = 0;
      for (let day = 0; day < 12; day++) e.endOfDay(day, { notice: (_h, k) => { if (k === 'bankrupt') bankrupt++; }, seize: (acct, owe) => (sim as unknown as { seize(h: number, o: number): number }).seize(acct.household, owe) });
      // 원래 빚은 정리됨 (그 뒤 외상으로 새로 빌린 작은 빚은 따로)
      expect(a.loans.includes(loan)).toBe(false);
      expect(bankrupt, `압류로 덮음=${covered}`).toBe(covered ? 0 : 1);
    }
  });
});
