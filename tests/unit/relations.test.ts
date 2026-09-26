/**
 * M3 통과 조건: 성공 판정 분포 테스트 + 관계 3축/이름/감소/첫인상 (GDD 14-1~14-3)
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/core/rng';
import { firstImpression, Relations, successChance, type RelationRules } from '../../src/sim/social/relations';

const rules: RelationRules = {
  decayPerDay: { friendship: 1, romance: 1.5 },
  familyFriendshipDecayMult: 0.5,
  romanticDecayMult: 0.5,
  names: { enemy: -60, rival: -30, friend: 30, bestFriend: 70, bestFriendMemories: 5, loverRomance: 50 },
  firstImpression: {
    friendship: [-20, 20], respect: [-30, 30], estateRespectPerStep: 6, hygienePenaltyBelow: 30, hygienePenalty: 6,
    traitPairs: [{ a: 'kind', b: 'mean', friendship: -8 }, { a: 'sociable', b: 'sociable', friendship: 6 }],
  },
};
const base = { base: 50, friendship: 0, romance: 0, respectTargetToActor: 0, romanceCategory: false, storytelling: 0, emotionMod: 0, traitMod: 0, estateMod: 0, moodMod: 0 };

describe('성공 판정 (14-3)', () => {
  it('공식: 기본 + 우정×0.3 + 로맨스×0.4(로맨스 분류) + 존중×0.2 + 화술×3 + 보정들', () => {
    expect(successChance({ ...base })).toBe(50);
    expect(successChance({ ...base, friendship: 50 })).toBe(65);
    expect(successChance({ ...base, romance: 50, romanceCategory: false })).toBe(50);
    expect(successChance({ ...base, romance: 50, romanceCategory: true })).toBe(70);
    expect(successChance({ ...base, respectTargetToActor: -50 })).toBe(40);
    expect(successChance({ ...base, storytelling: 5 })).toBe(65);
  });

  it('5% ~ 95% 로 제한', () => {
    expect(successChance({ ...base, base: 10, friendship: -100 })).toBe(5);
    expect(successChance({ ...base, friendship: 100, storytelling: 10 })).toBe(95);
  });

  it('분포: 시드 RNG 로 굴린 성공 비율이 확률과 맞음 (1만 번, ±2%p)', () => {
    const rng = new Rng(7);
    for (const p of [5, 20, 50, 80, 95]) {
      let ok = 0;
      for (let i = 0; i < 10000; i++) if (rng.next() * 100 < p) ok++;
      expect(Math.abs(ok / 100 - p)).toBeLessThan(2);
    }
  });
});

describe('관계 3축 (14-1)', () => {
  it('우정 −100~100, 로맨스 0~100, 존중 방향별', () => {
    const r = new Relations(rules);
    r.change(1, 2, { friendship: 150, romance: -20 }, 0);
    expect(r.friendship(1, 2)).toBe(100);
    expect(r.romance(2, 1)).toBe(0);
    r.addRespect(1, 2, 20);
    expect(r.respect(1, 2)).toBe(20);
    expect(r.respect(2, 1)).toBe(0);
  });

  it('관계 이름: 원수/앙숙/아는 사이/친구/절친/연인', () => {
    const r = new Relations(rules);
    expect(r.name(1, 2)).toBe('stranger');
    const x = r.ensure(1, 2);
    x.met = true;
    expect(r.name(1, 2)).toBe('acquaintance');
    x.friendship = 35;
    expect(r.name(1, 2)).toBe('friend');
    x.friendship = 75;
    expect(r.name(1, 2)).toBe('friend');
    x.sharedMemories = 5;
    expect(r.name(1, 2)).toBe('best_friend');
    x.friendship = -35;
    expect(r.name(1, 2)).toBe('rival');
    x.friendship = -65;
    expect(r.name(1, 2)).toBe('enemy');
    x.flags.add('lover');
    expect(r.name(1, 2)).toBe('lover');
  });

  it('자연 감소: 우정 하루 1(가족 중심은 가족에게 0.5), 로맨스 1.5 (낭만적은 연인에게 0.75)', () => {
    const r = new Relations(rules);
    const x = r.ensure(1, 2);
    x.met = true;
    x.friendship = 10;
    x.romance = 10;
    r.decayDaily(() => false, () => false);
    expect(x.friendship).toBe(9);
    expect(x.romance).toBe(8.5);
    x.flags.add('lover');
    r.decayDaily(() => true, (id, t) => (t === 'family_oriented' || t === 'romantic') && id === 1);
    expect(x.friendship).toBe(8.5);
    expect(x.romance).toBe(7.75);
    x.friendship = -3;
    r.decayDaily(() => false, () => false);
    expect(x.friendship).toBe(-2);
  });
});

describe('첫인상 (14-2)', () => {
  it('범위: 우정 −20~20, 존중 −30~30, 신분이 높은 상대를 우러러봄', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 500; i++) {
      const fi = firstImpression(rules, {
        estateA: 'serf', estateB: 'noble', hygieneA: 10, hygieneB: 90, traitsA: ['kind'], traitsB: ['mean'],
        dressOkA: true, dressOkB: true, looksA: 0, looksB: 0, reputationA: 0, reputationB: 0,
      }, rng.next(), rng.next());
      expect(fi.friendship).toBeGreaterThanOrEqual(-20);
      expect(fi.friendship).toBeLessThanOrEqual(20);
      expect(fi.respectAB).toBeGreaterThan(fi.respectBA);
      expect(Math.abs(fi.respectAB)).toBeLessThanOrEqual(30);
    }
  });
});
