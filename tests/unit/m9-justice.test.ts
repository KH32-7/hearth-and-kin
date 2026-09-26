/**
 * M9 범죄와 재판 (GDD 18-6, src/sim/society/justice.ts): 범죄 종류별 발각·재판·처벌, 처형 꺼짐 → 추방, 감옥 2~5일,
 * 벌금 행선지 (finesToday → 영지 정산), 가족 탄원/뇌물/증인 설득, 재판 장면 의도, 카드 판결, 치안·사냥 정책 입력, 결정론
 */
import { describe, expect, it } from 'vitest';
import { CRIMES, PUNISHMENTS, type CrimeId, type Trial } from '../../src/sim/society/justice';
import { societyWorld } from './m9-society-fake';

function town(seed = 1, deathPreset?: 'lenient' | 'normal' | 'realistic') {
  const w = societyWorld(seed, { deathPreset });
  w.estateOf.set(900, 'noble');
  const lord = w.add('영주', 900, { estate: 'noble', traits: ['just'] });
  w.judgeId = lord.id;
  return { w, lord };
}

describe('M9 범죄와 재판 (18-6)', () => {
  it('범죄 9종 모두: 발각 → 재판 → 판결, 유죄면 그 죄의 처벌 사다리 안', () => {
    const { w } = town(3);
    for (const c of CRIMES) (w.justice.d.crimes[c] as { patrol: number }).patrol = 1;
    for (const c of CRIMES) {
      let convicted = 0;
      for (let i = 0; i < 20; i++) {
        const p = w.add(`범인${c}${i}`, 100 + i, { at: 'market' });
        const rec = w.justice.commit(p, c as CrimeId);
        expect(rec.detected, c).toBe(true);
        const t = w.justice.state.trials.find((x) => x.accused === p.id)!;
        expect(t.stage, c).toBe('done');
        expect(t.verdict).not.toBeNull();
        if (t.verdict!.guilty) {
          convicted++;
          expect(w.justice.d.crimes[c].punish, c).toContain(t.verdict!.punish);
          expect(w.log.news.some((n) => n.kind === `verdict_${t.verdict!.punish}`)).toBe(true);
        }
      }
      expect(convicted, c).toBeGreaterThan(5);
      expect(w.justice.stats.committed[c]).toBeGreaterThanOrEqual(20);
      expect(w.justice.stats.detected[c]).toBeGreaterThanOrEqual(20);
    }
    expect(w.log.rumors.some((r) => r.kind === 'convicted')).toBe(true);
  });

  it('처벌 7종 각각의 결과 훅', () => {
    const { w } = town(4);
    const got: Record<string, boolean> = {};
    for (const pun of PUNISHMENTS) {
      const p = w.add(`피고${pun}`, 200 + PUNISHMENTS.indexOf(pun));
      const t = w.justice.arrest(p, 'theft', 0, 0, 0.1, true);
      // NPC 는 즉시 판결이 나므로 새 재판으로 강제 판결
      const t2: Trial = { ...t, id: 999 + PUNISHMENTS.indexOf(pun), stage: 'kin', verdict: null };
      w.justice.state.trials.push(t2);
      const v = w.justice.resolve(t2, pun);
      got[pun] = v.guilty && v.punish === pun;
    }
    expect(Object.values(got).every(Boolean)).toBe(true);
    expect(w.log.fines.length).toBeGreaterThan(0);
    expect(w.log.pillory[0].minutes).toBe(360);
    expect(w.log.flogs.length).toBe(1);
    expect(w.log.jails.length).toBeGreaterThan(0);
    expect(w.log.exiles.length).toBe(1);
    expect(w.log.confiscations.length).toBe(1);
    expect(w.log.felonies.length).toBe(1);
    expect(w.log.kills.some((k) => k.cause === 'execution')).toBe(true);
    expect(w.moodletsOf(w.persons[1]).length).toBeGreaterThanOrEqual(0);
  });

  it('처형이 꺼져 있으면 (보통 프리셋) 추방으로 대체', () => {
    const { w } = town(5, 'normal');
    const p = w.add('방화범', 300);
    const t = w.justice.arrest(p, 'arson', 0, 0, 0.1, true);
    const t2: Trial = { ...t, id: 5000, stage: 'kin', verdict: null };
    w.justice.state.trials.push(t2);
    const v = w.justice.resolve(t2, 'execution');
    expect(v.punish).toBe('exile');
    expect(v.replaced).toBe('execution');
    expect(w.log.kills.length).toBe(0);
    expect(w.log.exiles).toContain(p.id);
  });

  it('감옥은 2~5일 (absolute)', () => {
    const { w } = town(6);
    const days = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const p = w.add(`죄수${i}`, 400 + i);
      const t: Trial = { ...w.justice.arrest(p, 'assault', 0, 0, 0.1, true), id: 10000 + i, stage: 'kin', verdict: null };
      w.justice.state.trials.push(t);
      days.add(w.justice.resolve(t, 'jail').days);
    }
    for (const d of days) {
      expect(d).toBeGreaterThanOrEqual(2);
      expect(d).toBeLessThanOrEqual(5);
    }
    expect(days.has(2) && days.has(5)).toBe(true);
    // 수명 배수를 바꿔도 감옥 일수는 그대로
    w.lifespanN = 3;
    const p = w.add('죄수x', 999);
    const t: Trial = { ...w.justice.arrest(p, 'assault', 0, 0, 0.1, true), id: 20000, stage: 'kin', verdict: null };
    w.justice.state.trials.push(t);
    expect(w.justice.resolve(t, 'jail').days).toBeLessThanOrEqual(5);
  });

  it('벌금 행선지: host.fine → finesToday → 영지 정산 (fief.finesTo: family 면 영주 가문, treasury 면 금고)', () => {
    const { w } = town(7);
    w.fief.grant(900, { lord: true, manors: 0, tenants: 0, policy: true });
    const p = w.add('벌금범', 500);
    const t: Trial = { ...w.justice.arrest(p, 'illegal_gambling', 0, 0, 0.1, true), id: 30000, stage: 'kin', verdict: null };
    w.justice.state.trials.push(t);
    const before = w.money.get(500)!;
    w.fines.today = 0;
    const v = w.justice.resolve(t, 'fine');
    expect(v.amount).toBeGreaterThan(0);
    expect(w.money.get(500)).toBe(before - v.amount);
    expect(w.fines.today).toBe(v.amount);
    const lordBefore = w.money.get(900) ?? 0;
    const tr0 = w.fief.treasury.money;
    (w.fief.d as { finesTo: string }).finesTo = 'family';
    w.fief.dailySettle(0);
    expect((w.money.get(900) ?? 0) - lordBefore).toBe(v.amount);
    (w.fief.d as { finesTo: string }).finesTo = 'treasury';
    w.fief.dailySettle(1);
    expect(w.fief.treasury.money - tr0).toBe(v.amount);
  });

  it('조작 가문 피고: 붙잡힘 → 재판 장면 → 변론·증인·가족 탄원 → 판결', () => {
    const { w, lord } = town(8);
    const son = w.add('아들', 1, { skills: { storytelling: 6, reckoning: 4 } });
    const mom = w.add('어머니', 1, { skills: { storytelling: 10 } });
    const friend = w.add('친구', 50);
    w.setFriend(friend, son, 60);
    const t = w.justice.arrest(son, 'theft', 0, 0, 0.7, true);
    expect(t.controlled).toBe(true);
    expect(t.stage).toBe('pending');
    expect(w.log.detains[0].p).toBe(son.id);
    expect(w.moodletsOf(mom)).toContain('kin_on_trial_worry');
    expect(w.justice.flags(son).has('on_trial')).toBe(true);
    expect(w.justice.flags(mom).has('kin_on_trial')).toBe(true);
    // 재판 전: 가족 상호작용 게이트
    const g = w.justice.gates();
    expect(g.kin_trial_judge(mom, lord)).toBe(true);
    expect(g.kin_trial_judge(son, lord)).toBe(false);
    // 재판 시각
    w.minuteN = t.at;
    w.justice.hourly();
    expect(t.stage).toBe('opening');
    expect(w.log.scenes[0]).toEqual({ kind: 'start', trial: t.id });
    expect(w.justice.applyIntent({ kind: 'trialPlea', option: 'argue' }).ok).toBe(true);
    expect(t.stage).toBe('witness');
    expect(t.evidence).toBeLessThan(0.7);
    expect(w.justice.applyIntent({ kind: 'trialCallWitness', id: friend.id }).ok).toBe(true);
    expect(w.justice.applyIntent({ kind: 'trialAdvance' }).ok).toBe(true);
    expect(t.stage).toBe('kin');
    w.justice.applyIntent({ kind: 'kinPetition', by: mom.id });
    expect(t.kin.length).toBe(1);
    expect(w.justice.applyIntent({ kind: 'trialAdvance' }).ok).toBe(true);
    expect(t.stage).toBe('done');
    expect(t.verdict).not.toBeNull();
    expect(w.log.scenes.at(-1)).toEqual({ kind: 'end', trial: t.id });
    expect(w.log.chronicle.some((c) => c.trigger === 'trial')).toBe(true);
  });

  it('장면이 멈추면 autoMinutes 뒤 자동 진행', () => {
    const { w } = town(9);
    const son = w.add('아들', 1);
    const t = w.justice.arrest(son, 'poaching', 0, 0, 0.6, true);
    w.minuteN = t.at;
    w.justice.hourly();
    for (let i = 0; i < 6 && t.stage !== 'done'; i++) {
      w.minuteN += w.justice.d.trial.autoMinutes;
      w.justice.hourly();
    }
    expect(t.stage).toBe('done');
    expect(t.plea).not.toBeNull();
  });

  it('가족 탄원: 화술이 높을수록 잘 먹힘, 성공하면 처벌 한 칸 가벼워짐', () => {
    const rate = (story: number) => {
      const { w } = town(10 + story);
      const mom = w.add('어머니', 1, { skills: { storytelling: story } });
      let ok = 0;
      for (let i = 0; i < 300; i++) {
        const son = w.add(`아들${i}`, 1);
        const t = w.justice.arrest(son, 'theft', 0, 0, 0.7, true);
        if (w.justice.kinPetition(t, mom)) {
          ok++;
          expect(t.mercySteps).toBe(1);
        }
        t.stage = 'done';
      }
      return ok / 300;
    };
    expect(rate(10)).toBeGreaterThan(rate(0) + 0.3);
  });

  it('가족 뇌물: 돈이 재판관 집으로, 탐욕스러운 재판관은 잘 받고 정의로운 재판관은 뇌물 죄를 붙임', () => {
    const run = (traits: string[]) => {
      const w = societyWorld(21);
      const judge = w.add('재판관', 900, { estate: 'noble', traits });
      w.judgeId = judge.id;
      const mom = w.add('어머니', 1);
      let ok = 0;
      let extra = 0;
      for (let i = 0; i < 200; i++) {
        w.money.set(1, 100000);
        const son = w.add(`아들${i}`, 1);
        const t = w.justice.arrest(son, 'theft', 0, 0, 0.7, true);
        const before = t.evidence;
        if (w.justice.kinBribe(t, mom)) {
          ok++;
          expect(t.evidence).toBeLessThan(before);
        } else if (t.extra.includes('bribery')) extra++;
        t.stage = 'done';
      }
      expect(w.log.pays.length).toBe(200);
      expect(w.log.pays[0].to).toBe(900);
      return { ok: ok / 200, extra };
    };
    const greedy = run(['greedy_old', 'cunning']);
    const just = run(['just']);
    expect(greedy.ok).toBeGreaterThan(0.7);
    expect(just.ok).toBeLessThan(0.2);
    expect(just.extra).toBeGreaterThan(100);
  });

  it('증인 설득: 불리한 증인이 말을 바꾸면 유죄 확률이 내려감 (게이트 trial_witness)', () => {
    const { w } = town(22);
    const son = w.add('아들', 1);
    const mom = w.add('어머니', 1, { skills: { storytelling: 10 } });
    const wit = w.add('목격자', 60);
    w.setFriend(wit, mom, 50);
    const t = w.justice.arrest(son, 'theft', wit.id, 0, 0.6, true, [wit]);
    expect(w.justice.gates().trial_witness(mom, wit)).toBe(true);
    const p0 = w.justice.guiltProb(t);
    let tries = 0;
    while (!t.witnesses[0].persuaded && tries++ < 20) w.justice.kinPersuade(t, mom, wit);
    expect(t.witnesses[0].persuaded).toBe(true);
    expect(w.justice.guiltProb(t)).toBeLessThan(p0);
    expect(w.justice.gates().trial_witness(mom, wit)).toBe(false);
  });

  it('고발: 본 죄가 있으면 진짜 고발, 없으면 거짓 고발 (증거 약함 → 대부분 무죄, 고발인 명성 −)', () => {
    const { w } = town(23);
    let acquitted = 0;
    for (let i = 0; i < 100; i++) {
      const a = w.add(`원수${i}`, 600 + i);
      const b = w.add(`대상${i}`, 700 + i);
      const t = w.justice.accuse(a, b)!;
      expect(t.truth).toBe(false);
      if (!t.verdict!.guilty) acquitted++;
    }
    expect(acquitted).toBeGreaterThan(60);
    expect(w.justice.stats.falseAccusations).toBe(100);
    expect(w.log.fame.some((f) => f.reason === 'lie_exposed' && f.delta < 0)).toBe(true);
    // 본 죄: 목격자가 신고하지 않은 절도 → 고발 가능 (can_accuse) → 진짜 고발
    const thief = w.add('도둑', 800, { at: 'market' });
    const seer = w.add('본사람', 801, { at: 'market', traits: ['cunning'] });
    (w.justice.d.crimes.theft as { patrol: number; witnessPer: number }).patrol = 0;
    (w.justice.d.crimes.theft as { witnessPer: number }).witnessPer = 1;
    (w.justice.d.reportChance as { base: number }).base = 0;
    (w.justice.d as { victimAccuse: number }).victimAccuse = 0;
    const rec = w.justice.commit(thief, 'theft', w.dayN, seer);
    rec.witnesses = [seer.id];
    rec.victim = seer.id;
    expect(rec.detected).toBe(false);
    expect(w.justice.canAccuse(seer, thief)).toBe(true);
    const t = w.justice.accuse(seer, thief)!;
    expect(t.truth).toBe(true);
    expect(rec.detected).toBe(true);
  });

  it('치안·사냥 정책이 범죄 확률을 바꿈 (엄격 = 절반, 사냥 자유 = 밀렵 0)', () => {
    const { w } = town(24);
    const p = w.add('농부', 900 + 50, { estate: 'serf', at: 'forest_river' });
    const theft0 = w.justice.rate(p, 'theft', 10);
    w.policy.set('watch', 'strict', 'setup');
    expect(w.justice.rate(p, 'theft', 10)).toBeCloseTo(theft0 * 0.5, 10);
    w.policy.set('hunting', 'ban', 'setup');
    const ban = w.justice.rate(p, 'poaching', 10);
    expect(ban).toBeGreaterThan(0);
    w.policy.set('hunting', 'license', 'setup');
    expect(w.justice.rate(p, 'poaching', 10)).toBeCloseTo(ban * 0.3, 10);
    w.policy.set('hunting', 'free', 'setup');
    expect(w.justice.rate(p, 'poaching', 10)).toBe(0);
    // 엄격한 치안: 처벌이 한 칸 무거워짐
    expect(w.policy.punishStep()).toBe(1);
  });

  it('사건 카드: on_trial (밀렵 카드) → 카드 판결 flag 로 처벌', () => {
    const { w } = town(25);
    const son = w.add('아들', 1);
    expect(w.justice.onCardFlag(son, 'on_trial', 'poaching_temptation')).toBe(true);
    const t = w.justice.state.trials.at(-1)!;
    expect(t.crime).toBe('poaching');
    expect(t.viaCard).toBe(true);
    expect(w.justice.onCardFlag(son, 'sentenced_jail')).toBe(true);
    expect(t.verdict?.punish).toBe('jail');
    expect(w.log.jails.at(-1)!.p).toBe(son.id);
    expect(w.justice.onCardFlag(son, 'verdict_fine')).toBe(false);
  });

  it('하루 발생: NPC 만, 결정론 (같은 시드 같은 결과)', () => {
    const run = (seed: number) => {
      const { w } = town(seed);
      const places = ['market', 'inn', 'forest_river', 'craft_street', null];
      for (let i = 0; i < 80; i++) w.add(`주민${i}`, 1000 + Math.floor(i / 3), { at: places[i % 5], traits: i % 7 === 0 ? ['cunning'] : i % 5 === 0 ? ['hot_tempered', 'drinker'] : [], estate: i % 4 === 0 ? 'serf' : 'freeman' });
      w.add('우리', 1, { at: 'market', traits: ['cunning'] });
      w.wealth = 0.1;
      for (let d = 0; d < 28; d++) {
        w.dayN = d;
        w.minuteN = d * 1440;
        w.justice.daily(d);
      }
      return w;
    };
    const a = run(31);
    const b = run(31);
    expect(JSON.stringify(a.justice.stats)).toBe(JSON.stringify(b.justice.stats));
    const total = Object.values(a.justice.stats.committed).reduce((x, y) => x + y, 0);
    expect(total).toBeGreaterThan(3);
    expect(a.justice.state.trials.every((t) => a.persons.find((p) => p.id === t.accused)?.household !== 1)).toBe(true);
  });
});
