/**
 * M9 원한과 결투 (GDD 14-5, 32-2 간이 전투, 29-1 결투 사망 5~15%, src/sim/society/feud.ts):
 * 원한 −60 문턱과 풀림, 가문 번짐, 원한 자율 행동, 결투 거절의 명예 하락, 조작 가문 결투 카드, 승률, 사망률, 사망 설정, 주먹다짐, 결정론
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/core/rng';
import { loserFate, parseFeud, quickCombat, type Fighter } from '../../src/sim/society/feud';
import { societyWorld } from './m9-society-fake';

const F = parseFeud(JSON.parse(readFileSync('src/data/justice.json', 'utf8')))!;
const fighter = (m: number, e = 0, traits: string[] = []): Fighter => ({ martial: m, equip: e, traits, angry: false, injured: false });

describe('M9 원한 (14-5)', () => {
  it('우정 −60 이하에서 원한, −59 는 아님, −40 위로 오르면 풀림', () => {
    const w = societyWorld(1);
    const a = w.add('갑', 10);
    const b = w.add('을', 20);
    const c = w.add('병', 30);
    w.setFriend(a, b, -60, false);
    w.setFriend(a, c, -59, false);
    w.feuds.updateGrudges(1);
    expect(w.feuds.hasGrudge(a, b)).toBe(true);
    expect(w.feuds.hasGrudge(a, c)).toBe(false);
    expect(w.feuds.hasGrudge(b, a)).toBe(false);
    expect(w.moodletsOf(a)).toContain('grudge_anger');
    expect(w.log.grudges).toEqual([{ a: a.id, b: b.id }]);
    expect(w.feuds.grudgesOf(a)).toEqual([b]);
    w.setFriend(a, b, -45, false);
    w.feuds.updateGrudges(2);
    expect(w.feuds.hasGrudge(a, b)).toBe(true);
    w.setFriend(a, b, -39, false);
    w.feuds.updateGrudges(3);
    expect(w.feuds.hasGrudge(a, b)).toBe(false);
  });

  it('원한은 가문으로 번짐: clans.onGrudge 훅 + 식구들의 상대 우정 하락, 조작 가문 카드 플래그 has_feud', () => {
    const w = societyWorld(2);
    const a = w.add('갑', 1);
    const kin = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => w.add(`갑네${i}`, 1));
    const b = w.add('을', 20);
    w.setFriend(a, b, -70, false);
    w.feuds.updateGrudges(1);
    expect(w.log.grudges.length).toBe(1);
    const spread = w.log.relations.filter((r) => r.b === b.id && r.friendship === F.spreadFriendship);
    expect(spread.length).toBeGreaterThan(0);
    expect(spread.length).toBeLessThan(kin.length + 1);
    expect(w.feuds.flags(kin[0]).has('has_feud')).toBe(true);
    expect(w.feuds.flags(b).has('has_feud')).toBe(true);
    expect(w.log.notices.some((n) => n.kind === 'grudge_new')).toBe(true);
  });

  it('원한 자율 행동: 험담·모욕·기물 파손·고발·결투·주먹다짐이 모두 나옴 (조작 가문은 스스로 안 함)', () => {
    const w = societyWorld(3);
    w.estateOf.set(900, 'noble');
    w.judgeId = w.add('영주', 900, { estate: 'noble' }).id;
    const pairs = [];
    for (let i = 0; i < 40; i++) {
      const a = w.add(`원수${i}`, 100 + i, { traits: ['mean', 'hot_tempered', 'brave'], estate: i % 2 ? 'freeman' : 'knight' });
      const b = w.add(`상대${i}`, 200 + i, { estate: 'freeman' });
      w.setFriend(a, b, -80, false);
      pairs.push([a, b]);
    }
    const me = w.add('우리', 1, { traits: ['mean'] });
    const foe = w.add('남', 300);
    w.setFriend(me, foe, -90, false);
    for (let d = 0; d < 20; d++) w.feuds.daily(d);
    const acts = w.feuds.stats.actions;
    for (const k of ['gossip', 'insult', 'vandalism', 'accuse', 'challenge', 'brawl']) expect(acts[k] ?? 0, k).toBeGreaterThan(0);
    expect(w.log.rumors.some((r) => r.kind === 'slander')).toBe(true);
    expect(w.log.vandal.length).toBeGreaterThan(0);
    expect(w.justice.stats.trials).toBeGreaterThan(0);
    expect(w.log.vandal).not.toContain(300);
  });
});

describe('M9 결투 (14-5, 32-2)', () => {
  it('결투 거절: 개인 명예와 가문 명성 하락, 소문 duel_refused, 무드렛', () => {
    const w = societyWorld(4);
    const knight = w.add('기사', 10, { estate: 'knight' });
    let refused = null;
    for (let i = 0; i < 30 && !refused; i++) {
      const coward = w.add(`겁쟁이${i}`, 100 + i, { traits: ['coward'] });
      if (w.feuds.challenge(knight, coward, i * 100) === 'refused') refused = coward;
    }
    expect(refused).not.toBeNull();
    const f = w.log.fame.find((x) => x.reason === 'duel_refused')!;
    expect(f.delta).toBe(F.duel.refuseFame);
    expect(f.by).toBe(refused!.id);
    expect(f.hh).toBe(refused!.household);
    expect(w.log.rumors.some((r) => r.kind === 'duel_refused' && r.p === refused!.id)).toBe(true);
    expect(w.moodletsOf(refused!)).toContain('duel_refused_shame');
    expect(w.feuds.stats.refusals).toBeGreaterThan(0);
  });

  it('결투 신청은 기사/귀족/용감함만, 대기 기간', () => {
    const w = societyWorld(5);
    const serf = w.add('농노', 10, { estate: 'serf' });
    const brave = w.add('용감이', 11, { estate: 'serf', traits: ['brave'] });
    const knight = w.add('기사', 12, { estate: 'knight' });
    const t = w.add('상대', 13);
    expect(w.feuds.canChallenge(serf, t)).toBe(false);
    expect(w.feuds.canChallenge(brave, t)).toBe(true);
    expect(w.feuds.canChallenge(knight, t)).toBe(true);
    expect(w.feuds.gates().can_duel(knight, t)).toBe(true);
    w.feuds.challenge(knight, t, 10);
    expect(w.feuds.canChallenge(knight, t, 12)).toBe(false);
    expect(w.feuds.canChallenge(knight, t, 10 + 14)).toBe(true);
  });

  it('조작 가문이 신청을 받으면 사건 카드, 수락 flag 로 결투 (M13 전: 간이 전투 + 알림)', () => {
    const w = societyWorld(6);
    const knight = w.add('기사', 10, { estate: 'knight' });
    const me = w.add('우리 기사', 1, { estate: 'knight' });
    expect(w.feuds.challenge(knight, me)).toBe('pending');
    expect(w.log.cards).toEqual([{ p: me.id, card: 'duel_challenge_received', other: knight.id }]);
    expect(w.feuds.flags(me).has('duel_challenged')).toBe(true);
    expect(w.feuds.onCardFlag(me, 'duel_accepted')).toBe(true);
    expect(w.feuds.stats.duels).toBe(1);
    expect(w.log.notices.some((n) => n.kind === 'duel_result')).toBe(true);
    expect(w.feuds.onCardFlag(me, 'duel_accepted')).toBe(false);
  });

  it('사회 상호작용 social.challenge_duel: 성공 = 결투, 실패 = 거절', () => {
    const w = societyWorld(7);
    const a = w.add('갑', 1, { estate: 'knight' });
    const b = w.add('을', 20, { estate: 'knight' });
    expect(w.feuds.onSocial(a, b, 'social.challenge_duel', true)).toBe(true);
    expect(w.feuds.stats.duels).toBe(1);
    const c = w.add('병', 30);
    w.feuds.onSocial(a, c, 'social.challenge_duel', false);
    expect(w.feuds.stats.refusals).toBe(1);
  });

  it('간이 전투 1만 판: 같은 무예 45~55%, 무예 5 차이 약 80%, 장비 한 단계 ≈ 무예 1.5', () => {
    const rng = new Rng(11);
    const rate = (a: Fighter, b: Fighter) => {
      let w = 0;
      for (let i = 0; i < 10000; i++) if (quickCombat(a, b, F.combat, rng).winner === 0) w++;
      return w / 10000;
    };
    const eq = rate(fighter(4), fighter(4));
    expect(eq).toBeGreaterThan(0.45);
    expect(eq).toBeLessThan(0.55);
    const five = rate(fighter(7), fighter(2));
    expect(five).toBeGreaterThan(0.74);
    expect(five).toBeLessThan(0.86);
    const equip = rate(fighter(3, 1), fighter(3, 0));
    const lvl = rate(fighter(4.5), fighter(3));
    expect(Math.abs(equip - lvl)).toBeLessThan(0.03);
  });

  it('결투 1만 판 사망률 5~15% (현실적), 전투 사망이 꺼지면 0 (기절 + 중상/영구 부상으로 대체)', () => {
    const rng = new Rng(12);
    let dead = 0;
    for (let i = 0; i < 10000; i++) {
      quickCombat(fighter(4), fighter(4), F.combat, rng);
      if (loserFate('duel', F.combat, rng, 1) === 'death') dead++;
    }
    expect(dead / 10000).toBeGreaterThan(0.05);
    expect(dead / 10000).toBeLessThan(0.15);
    // 모듈 전체 경로: 결투 1000 번
    const w = societyWorld(13);
    for (let i = 0; i < 1000; i++) {
      const a = w.add(`가${i}`, 100 + i, { estate: 'knight' });
      const b = w.add(`나${i}`, 2000 + i, { estate: 'knight' });
      w.feuds.duel(a, b);
    }
    const rate = w.feuds.stats.duelDeaths / w.feuds.stats.duels;
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.15);
    expect(w.log.kills.every((k) => k.cause === 'combat' && k.sub === 'duel')).toBe(true);
    const off = societyWorld(14, { deathPreset: 'lenient' });
    for (let i = 0; i < 500; i++) off.feuds.duel(off.add(`가${i}`, 100 + i, { estate: 'knight' }), off.add(`나${i}`, 2000 + i, { estate: 'knight' }));
    expect(off.feuds.stats.duelDeaths).toBe(0);
    expect(off.log.kills.length).toBe(0);
    expect(off.log.permanent.length).toBeGreaterThan(0);
  });

  it('결투 결과: 이긴 쪽 명성 +, 소문 duel_won, 무드렛', () => {
    const w = societyWorld(15);
    const a = w.add('갑', 10, { estate: 'knight', skills: { martial: 10 } });
    const b = w.add('을', 20, { estate: 'knight' });
    w.feuds.finishCombat(a, b, 'duel', a.id);
    expect(w.log.fame.find((f) => f.reason === 'duel_won')?.hh).toBe(10);
    expect(w.log.rumors.some((r) => r.kind === 'duel_won' && r.good)).toBe(true);
    expect(w.moodletsOf(a)).toContain('duel_won');
  });
});

describe('M9 주먹다짐 (14-5)', () => {
  it('저녁 여관의 사이 나쁜 평민: 주먹다짐, 부상, 경비에게 걸리면 벌금. 치안이 엄격하면 덜 일어남', () => {
    const run = (watch: string) => {
      const w = societyWorld(16);
      w.policy.set('watch', watch, 'setup');
      const people = [];
      for (let i = 0; i < 4; i++) people.push(w.add(`술꾼${i}`, 100 + i, { at: 'inn', traits: i % 2 ? ['drinker', 'hot_tempered'] : ['drinker'] }));
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j) w.setFriend(people[i], people[j], -30, false);
      for (let d = 0; d < 40; d++) w.feuds.daily(d);
      return w;
    };
    const normal = run('normal');
    const strict = run('strict');
    expect(normal.feuds.stats.brawls).toBeGreaterThan(10);
    expect(strict.feuds.stats.brawls).toBeLessThan(normal.feuds.stats.brawls);
    expect(normal.log.moodlets.some((m) => m.id === 'fistfight_bruised')).toBe(true);
    expect(normal.log.fines.length).toBeGreaterThan(0);
    expect(normal.justice.stats.committed.assault).toBeGreaterThanOrEqual(normal.feuds.stats.brawls);
  });

  it('결정론: 같은 시드 같은 결과', () => {
    const run = () => {
      const w = societyWorld(17);
      for (let i = 0; i < 30; i++) {
        const a = w.add(`가${i}`, 100 + i, { traits: ['mean', 'brave'], at: i % 2 ? 'inn' : 'market' });
        const b = w.add(`나${i}`, 200 + i, { at: 'inn' });
        w.setFriend(a, b, -75);
      }
      for (let d = 0; d < 15; d++) w.feuds.daily(d);
      return JSON.stringify([w.feuds.stats, w.feuds.state, w.log.kills]);
    };
    expect(run()).toBe(run());
  });
});
