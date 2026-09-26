/**
 * M9 영주 정책 (GDD 18-4, 29-4 방향), 민심 (16-4), 영주 금고·사적 유용·곡물 배급 (17-9), 탄원·NPC 영주 AI,
 * 간이 역병 곡선 (29-1, src/sim/society/plagueLite.ts) — 애쉬포드 일과표 접촉으로 몬테카를로, 결정론
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/core/rng';
import { simRaw } from '../../tools/data-node';
import { validateSimData } from '../../src/sim/data/simData';
import { Simulation } from '../../src/sim/sim';
import type { Person } from '../../src/sim/people/person';
import { PlagueLite, parsePlague } from '../../src/sim/society/plagueLite';
import { LordPolicy, parsePolicy, POLICIES, POLICY_LEVELS, type PolicyHost, type PolicyId } from '../../src/sim/society/policy';
import { policyRaw, societyWorld } from './m9-society-fake';

function lordTown(seed = 1) {
  const w = societyWorld(seed);
  w.estateOf.set(900, 'noble');
  const lord = w.add('영주', 900, { estate: 'noble' });
  w.fief.grant(900, { lord: true, manors: 0, tenants: 0, policy: true });
  w.policy.init();
  return { w, lord };
}

/** Honor.daily 처럼 50 쪽으로 하루 1 당긴 뒤 정책 하루 */
function days(w: ReturnType<typeof societyWorld>, n: number) {
  for (let i = 0; i < n; i++) {
    const d = w.dayN;
    if (w.morale > 50) w.morale = Math.max(50, w.morale - 1);
    else if (w.morale < 50) w.morale = Math.min(50, w.morale + 1);
    w.policy.daily(d);
    w.dayN++;
  }
}

describe('M9 정책 6개: 훅 방향 (29-4)', () => {
  it('데이터: 정책 6개 × 단계가 모두 있고 기본값이 유효', () => {
    const d = parsePolicy(policyRaw())!;
    for (const id of POLICIES) for (const lv of POLICY_LEVELS[id]) expect(d.effects[id][lv], `${id}.${lv}`).toBeTruthy();
  });

  it('세율: 높음 > 보통 > 낮음 (economy.json tax.rates 와 같은 값), 보통 대비 배수', () => {
    const { w } = lordTown();
    const rates = { low: 0.03, normal: 0.05, high: 0.08 };
    expect(w.policy.taxRate(rates)).toBe(0.05);
    w.policy.set('tax', 'high', 'setup');
    expect(w.policy.taxRate(rates)).toBe(0.08);
    expect(w.policy.taxRateMult()).toBeCloseTo(1.6);
    w.policy.set('tax', 'low', 'setup');
    expect(w.policy.taxRateMult()).toBeLessThan(1);
  });

  it('장터: 길드 독점 = 공산품 +10%, 장인 수입 +10%, 식량은 그대로', () => {
    const { w } = lordTown();
    expect(w.policy.priceMult('tools')).toBe(1);
    w.policy.set('market', 'guild', 'setup');
    for (const g of ['cloth', 'iron', 'tools', 'horseshoes']) expect(w.policy.priceMult(g)).toBeCloseTo(1.1);
    expect(w.policy.priceMult('grain')).toBe(1);
    expect(w.policy.artisanIncomeMult()).toBeCloseTo(1.1);
  });

  it('사냥: 금지 → 자유 = 고기 값 −10% 이상, 밀렵 배수 0', () => {
    const { w } = lordTown();
    w.policy.set('hunting', 'ban', 'setup');
    const ban = w.policy.priceMult('meat');
    expect(w.policy.poachingMult()).toBe(1);
    expect(w.policy.flags(w.persons[0]).has('hunting_banned')).toBe(true);
    w.policy.set('hunting', 'free', 'setup');
    expect(w.policy.priceMult('meat') / ban - 1).toBeLessThan(-0.1);
    expect(w.policy.poachingMult()).toBe(0);
  });

  it('치안: 엄격 = 범죄 배수 < 1, 발각 배수 > 1, 처벌 한 칸 무겁게, 경비병 급여 더 큼', () => {
    const { w } = lordTown();
    w.policy.set('watch', 'strict', 'setup');
    expect(w.policy.crimeMult()).toBeLessThanOrEqual(0.7);
    expect(w.policy.detectMult()).toBeGreaterThan(1);
    expect(w.policy.punishStep()).toBe(1);
    w.dayN = 1;
    const t0 = w.fief.treasury.money;
    days(w, 1);
    expect(t0 - w.fief.treasury.money).toBe(64);
  });

  it('역병: 격리 = 공공 장소 접촉 < 1, 앓는 집 격리, 장터 거래 배수는 유행 중에만', () => {
    const { w } = lordTown();
    w.policy.set('plague', 'quarantine', 'setup');
    expect(w.policy.plagueContactMult('market')).toBeLessThan(1);
    expect(w.policy.plagueContactMult('home')).toBe(1);
    expect(w.policy.confineHousehold()).toBe(true);
    expect(w.policy.marketTradeMult(false)).toBe(1);
    expect(w.policy.marketTradeMult(true)).toBeLessThan(1);
    w.policy.set('plague', 'lockdown', 'setup');
    expect(w.policy.tradeBlocked()).toBe(true);
  });

  it('축제: 성대 = 규모 2배, 축제일 금고 지출이 보통보다 큼', () => {
    const spend = (lv: string) => {
      const { w } = lordTown();
      w.policy.set('festival', lv, 'setup');
      w.dayN = 0;
      days(w, 28);
      return w.policy.stats.festivalSpent;
    };
    expect(spend('grand')).toBeGreaterThan(spend('normal'));
    expect(spend('none')).toBe(0);
    const { w } = lordTown();
    w.policy.set('festival', 'grand', 'setup');
    expect(w.policy.festivalScale()).toBe(2);
  });

  it('28일 민심 방향: 세율 높음 −10 이상, 치안 엄격 −5 이상, 축제 성대 +5 이상 (Honor 의 50 당김과 함께)', () => {
    const endMorale = (id: PolicyId, lv: string) => {
      const { w } = lordTown();
      w.policy.aiEnabled = false;
      w.policy.set(id, lv, 'setup');
      w.dayN = 0;
      days(w, 28);
      return w.morale;
    };
    expect(endMorale('tax', 'high') - endMorale('tax', 'normal')).toBeLessThanOrEqual(-10);
    expect(endMorale('watch', 'strict') - endMorale('watch', 'normal')).toBeLessThanOrEqual(-5);
    expect(endMorale('festival', 'grand') - endMorale('festival', 'normal')).toBeGreaterThanOrEqual(5);
  });

  it('정책 바꾸기: 소식 news.policy_*, 조작 가문 무드렛, 조작 가문이 영주가 아니면 의도 거절', () => {
    const { w } = lordTown();
    w.add('우리', 1);
    expect(w.policy.applyIntent({ kind: 'setPolicy', policy: 'tax', value: 'high' }).reason).toBe('not_lord');
    w.controlledHh = 900;
    expect(w.policy.applyIntent({ kind: 'setPolicy', policy: 'tax', value: 'high' }).ok).toBe(true);
    expect(w.log.news.some((n) => n.kind === 'policy_tax_high')).toBe(true);
    expect(w.policy.applyIntent({ kind: 'setPolicy', policy: 'tax', value: 'huge' }).ok).toBe(false);
    expect(w.policy.flags(w.persons[0]).has('is_lord')).toBe(true);
    expect(w.policy.flags(w.persons[0]).has('policy_tax_high')).toBe(true);
  });
});

describe('M9 민심 사건, 금고, 탄원', () => {
  it('민심 폭동 문턱: 25 미만이면 폭동 (금고 손실, 영주 명성 −, 카드 riot_brewing), 30 이면 없음', () => {
    const riots = (m: number) => {
      const { w } = lordTown(3);
      w.add('우리 어른', 1);
      w.policy.aiEnabled = false;
      let n = 0;
      for (let d = 0; d < 200; d++) {
        w.morale = m;
        w.policy.set('tax', 'normal', 'setup');
        const before = w.policy.stats.riots;
        w.dayN = d;
        w.policy.daily(d);
        if (w.policy.stats.riots > before) n++;
      }
      return { n, w };
    };
    const low = riots(20);
    expect(low.n).toBeGreaterThan(3);
    expect(low.w.log.cards.some((c) => c.card === 'riot_brewing')).toBe(true);
    expect(low.w.log.fame.some((f) => f.hh === 900 && f.reason === 'riot')).toBe(true);
    expect(low.w.policy.flags(low.w.persons[0]).has('morale_low')).toBe(true);
    expect(riots(30).n).toBe(0);
  });

  it('높은 민심은 영주 가문 명성 +', () => {
    const { w } = lordTown(4);
    w.morale = 90;
    w.policy.daily(1);
    expect(w.log.fame.some((f) => f.hh === 900 && f.reason === 'good_rule' && f.delta > 0)).toBe(true);
  });

  it('사적 유용: 금고 → 영주 가문, 민심 −10, 가문 명성 −30', () => {
    const { w } = lordTown(5);
    const t0 = w.fief.treasury.money;
    const m0 = w.morale;
    const r = w.policy.embezzle(900, 1000);
    expect(r.ok).toBe(true);
    expect(w.fief.treasury.money).toBe(t0 - 1000);
    expect(w.morale).toBe(m0 - 10);
    expect(w.log.fame.some((f) => f.hh === 900 && f.delta === -30)).toBe(true);
    expect(w.policy.stats.embezzled).toBe(1000);
    expect(w.policy.embezzle(123, 10).ok).toBe(false);
  });

  it('곡물 배급 (17-9): 흉년이면 굶는 가구에 금고로 곡물, 최대 14일, 영주 호의 소폭 하락', () => {
    const { w } = lordTown(6);
    w.add('농노1', 50, { estate: 'serf' });
    w.add('농노2', 50, { estate: 'serf' });
    w.hungry = [50];
    const t0 = w.fief.treasury.money;
    days(w, 3);
    expect(w.log.grain.length).toBe(0);
    w.badYear = true;
    days(w, 20);
    expect(w.log.grain.length).toBe(14);
    expect(w.log.grain[0]).toEqual({ hh: 50, n: 2 });
    expect(w.fief.treasury.expense.grain).toBe(14 * 2 * 2);
    expect(w.fief.treasury.money).toBeLessThan(t0);
    expect(w.favor.get(50)).toBeLessThan(0);
  });

  it('탄원: 화술이 높을수록 잘 먹힘, 압력이 쌓이면 NPC 영주가 정책을 바꿈', () => {
    const { w } = lordTown(7);
    w.policy.set('tax', 'high', 'setup');
    let ok = 0;
    for (let i = 0; i < 40; i++) {
      const p = w.add(`청원인${i}`, 100 + i, { skills: { storytelling: 10 } });
      expect(w.policy.canPetition(p)).toBe(true);
      if (w.policy.petition(p).ok) ok++;
      expect(w.policy.canPetition(p)).toBe(false);
    }
    expect(ok).toBeGreaterThan(20);
    expect(w.policy.state.pressure['tax:normal']).toBeGreaterThanOrEqual(2);
    w.dayN = 6;
    for (let i = 0; i < 5 && w.policy.level('tax') === 'high'; i++) {
      w.policy.daily(w.dayN);
      w.dayN += 7;
    }
    expect(w.policy.level('tax')).toBe('normal');
    expect(w.policy.stats.changes.some((c) => c.by === 'ai')).toBe(true);
  });

  it('조작 가문이 영주면 탄원은 알림으로 들어옴 (영주가 직접 정함)', () => {
    const { w, lord } = lordTown(8);
    w.controlledHh = 900;
    const p = w.add('청원인', 100);
    w.policy.petition(p, { policy: 'hunting', value: 'free' });
    expect(w.log.notices.some((n) => n.p === lord.id && n.kind === 'petition_received')).toBe(true);
    expect(w.policy.gates().lord_petition(p, lord)).toBe(false);
  });

  it('결정론: 같은 시드 같은 결과', () => {
    const run = () => {
      const { w } = lordTown(9);
      for (let i = 0; i < 10; i++) w.add(`주민${i}`, 100 + i);
      w.hungry = [100, 101];
      w.badYear = true;
      w.morale = 22;
      days(w, 60);
      return JSON.stringify([w.policy.stats, w.policy.state, w.morale]);
    };
    expect(run()).toBe(run());
  });
});

describe('M9 간이 역병 (29-1 곡선, 18-4 격리)', () => {
  const data = validateSimData(simRaw({ town: 'ashford' }) as never);
  const base = new Simulation(data, 1);
  const town = base.town!;
  const pd = parsePlague(policyRaw())!;
  const pold = parsePolicy(policyRaw())!;
  const run = (level: string, seeds: number) => {
    const out: { attack: number; peak: number | null; dur: number | null; cfr: number; market: number }[] = [];
    for (let s = 1; s <= seeds; s++) {
      const persons: Person[] = [...base.persons];
      let day = 0;
      const pol = new LordPolicy({ persons, rng: new Rng(s), day: () => day, lifespan: () => 1, seasonDays: () => 7, controlled: () => false } as unknown as PolicyHost, pold);
      pol.set('plague', level, 'setup');
      const pl = new PlagueLite({
        persons, day: () => day, lifespan: () => 1, seasonDays: () => 7, controlled: () => false,
        placeAt: (p, m) => town.schedulePlace(p, m), placeKind: (id) => town.place(id)?.kind ?? null,
        policy: () => pol, deathRules: () => null,
        kill: (p) => void persons.splice(persons.indexOf(p), 1),
        incapacitate() {}, memory() {}, moodlet() {}, notice() {}, news() {}, chronicle() {},
      }, new Rng(s * 7 + 1), pd);
      let market = 0;
      for (day = 0; day < 40; day++) {
        if (day === 2) pl.seed();
        pl.daily(day);
        if (day < 28) market += pl.stats.marketByDay[day];
      }
      const sm = PlagueLite.summary(pl.stats.outbreaks[0]);
      out.push({ attack: sm.attack, peak: sm.peakAfter, dur: sm.duration, cfr: sm.cfr, market });
    }
    return out;
  };
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.reduce((a, b) => a + b, 0) / v.length;
  };

  it('정책 "없음" 40시드: 발병률 20~40%, 정점 3~6일, 유행 7~14일, 치명률 15~35%', () => {
    const r = run('none', 40);
    const attack = mean(r.map((x) => x.attack));
    const peak = mean(r.map((x) => x.peak));
    const dur = mean(r.map((x) => x.dur));
    const deaths = r.reduce((a, x) => a + x.cfr * x.attack, 0);
    const cfr = deaths / r.reduce((a, x) => a + x.attack, 0);
    expect(attack).toBeGreaterThan(0.2);
    expect(attack).toBeLessThan(0.4);
    expect(peak).toBeGreaterThanOrEqual(3);
    expect(peak).toBeLessThanOrEqual(6);
    expect(dur).toBeGreaterThanOrEqual(7);
    expect(dur).toBeLessThanOrEqual(14);
    expect(cfr).toBeGreaterThan(0.15);
    expect(cfr).toBeLessThan(0.35);
  }, 60000);

  it('격리: 발병률 −25% 이상, 28일 장터 거래량 −15% 이상', () => {
    const none = run('none', 25);
    const q = run('quarantine', 25);
    expect(mean(q.map((x) => x.attack)) / mean(none.map((x) => x.attack)) - 1).toBeLessThan(-0.25);
    expect(mean(q.map((x) => x.market)) / mean(none.map((x) => x.market)) - 1).toBeLessThan(-0.15);
  }, 60000);

  it('사망 설정에서 질병이 꺼지면 죽지 않고 중환 뒤 회복', () => {
    const w = societyWorld(30, { deathPreset: 'lenient' });
    for (let i = 0; i < 40; i++) w.add(`주민${i}`, 100 + (i % 8), { at: 'market', lifeStage: 'adult' });
    w.dayN = 0;
    w.plague.seed(10);
    for (let d = 0; d < 30; d++) {
      w.dayN = d;
      w.plague.daily(d);
    }
    expect(w.plague.stats.outbreaks[0].infected).toBeGreaterThan(10);
    expect(w.log.kills.length).toBe(0);
    expect(w.plague.flags(w.persons[0]).has('plague_active')).toBe(false);
  });
});
