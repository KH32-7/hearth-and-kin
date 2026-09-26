/**
 * M2 통과 조건: 스트레스 한계 사건 재현 + 내면 엔진 동작 (무드렛, 특성, 덕/죄, 소원, 속마음, 기억)
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/sim';
import { EMOTION_IDS, EMOTION_INDEX } from '../../src/sim/inner/emotion';
import { NEED_IDS } from '../../src/sim/core/types';
import type { MoodletDef } from '../../src/sim/data/innerData';
import { likeReach, needReachable, wishReachable } from '../../src/sim/data/innerData';
import type { Person } from '../../src/sim/people/person';
import { cottageData, runMinutes } from './helpers';

const data = cottageData();
function sim(traits: string[] = [], seed = 1) {
  const s = new Simulation(data, seed);
  s.addPerson('가', undefined, undefined, { traits });
  s.addPerson('나', undefined, undefined, { traits: [] });
  return s;
}

describe('스트레스와 무너짐 (11-4)', () => {
  it('스트레스 100 → 무너짐 선택 대기 → 선택하면 스트레스 −50, 무드렛, 알림', () => {
    const s = sim();
    const p = s.persons[0];
    s.apply({ kind: 'setStress', personId: 1, value: 100 });
    expect(p.pendingChoice?.id).toBe('breakdown');
    expect(s.notices.some((n) => n.kind === 'breakdown')).toBe(true);
    expect(s.apply({ kind: 'choose', personId: 1, option: 'pray_cry' })).toBe(true);
    expect(p.pendingChoice).toBeNull();
    expect(p.stress).toBe(50);
    expect(p.moodlets.some((m) => m.id === 'cried_it_out')).toBe(true);
  });

  it('선택하지 않으면 한 시간 뒤 인물이 스스로 고름 (특성 가중)', () => {
    const s = sim(['drinker']);
    s.apply({ kind: 'setStress', personId: 1, value: 100 });
    runMinutes(s, 61);
    const p = s.persons[0];
    expect(p.pendingChoice).toBeNull();
    expect(p.stress).toBeLessThanOrEqual(55);
    expect(p.moodlets.some((m) => ['drunk_binge', 'cried_it_out', 'ran_off', 'smashed_things'].includes(m.id))).toBe(true);
  });

  it('40/70 단계 무드렛 (마음이 무겁다 / 한계)', () => {
    const s = sim();
    s.apply({ kind: 'setStress', personId: 1, value: 45 });
    runMinutes(s, 11);
    expect(s.persons[0].moodlets.some((m) => m.id === 'stress_heavy')).toBe(true);
    s.apply({ kind: 'setStress', personId: 1, value: 75 });
    runMinutes(s, 11);
    expect(s.persons[0].moodlets.some((m) => m.id === 'stress_limit')).toBe(true);
  });

  it('성격에 맞지 않는 행동은 스트레스 (다정함이 놀리기 +12), 상대는 놀림 무드렛', () => {
    const s = sim(['kind']);
    s.apply({ kind: 'setAutonomy', enabled: false });
    s.apply({ kind: 'queue', personId: 1, interactionId: 'social.tease', targetUid: 2 });
    runMinutes(s, 40);
    expect(s.persons[0].stress).toBeGreaterThan(8);
    // M3: 성공 판정이 붙음. 성공이면 상대가 놀림 무드렛, 실패면 실패 결과의 무드렛
    const res = s.notices.find((n) => n.kind === 'social_result');
    expect(res).toBeDefined();
    const def = data.social['social.tease'];
    const out = res!.args!.ok ? def.success : def.failure;
    for (const m of out.targetMoodlets) expect(s.persons[1].moodlets.some((x) => x.id === m.id)).toBe(true);
    if (res!.args!.ok) expect(s.persons[1].moodlets.some((m) => m.id === 'teased')).toBe(true);
  });
});

describe('무드렛과 감정', () => {
  it('욕구가 낮아지면 욕구 무드렛이 붙고 채워지면 떨어짐 (굶주림은 슬픔 + 긴장)', () => {
    const s = sim();
    const p = s.persons[0];
    p.setNeed('hunger', 5);
    runMinutes(s, 1);
    expect(p.moodlets.some((m) => m.id === 'need_hunger_crit')).toBe(true);
    expect(p.moodlets.some((m) => m.id.startsWith('need_hunger_crit~'))).toBe(true);
    p.setNeed('hunger', 90);
    runMinutes(s, 1);
    expect(p.moodlets.some((m) => m.id.startsWith('need_hunger_crit'))).toBe(false);
    expect(p.moodlets.some((m) => m.id === 'need_hunger_high')).toBe(true);
  });

  it('쾌활함은 행복 무드렛이 더 오래 감', () => {
    const a = sim(['cheerful']);
    const b = sim([]);
    for (const s of [a, b]) s.apply({ kind: 'addMoodlet', personId: 1, moodlet: 'fresh_bread' });
    const ea = a.persons[0].moodlets.find((m) => m.id === 'fresh_bread')!.expiresAt;
    const eb = b.persons[0].moodlets.find((m) => m.id === 'fresh_bread')!.expiresAt;
    expect(ea - a.world.minute).toBeGreaterThan(eb - b.world.minute);
  });

  it('장례의 슬픔은 세기 3이 행복을 억제하고, 시간이 지나며 약해짐', () => {
    const s = sim();
    const p = s.persons[0];
    s.apply({ kind: 'setAutonomy', enabled: false });
    s.apply({ kind: 'addMoodlet', personId: 1, moodlet: 'funeral_grief' });
    s.apply({ kind: 'addMoodlet', personId: 1, moodlet: 'fresh_bread' });
    runMinutes(s, 6);
    expect(p.emotion).toBe(EMOTION_INDEX.sad);
    const start = p.moodlets.find((m) => m.id === 'funeral_grief')!.strength;
    runMinutes(s, 1500);
    const later = p.moodlets.find((m) => m.id === 'funeral_grief')?.strength ?? 0;
    expect(later).toBeLessThan(start);
  });
});

describe('소원·속마음·기억', () => {
  it('인물은 소원과 걱정을 가지고, 속마음을 말함', () => {
    const s = sim();
    runMinutes(s, 720);
    const p = s.persons[0];
    expect(p.wishes.filter((w) => w.kind === 'wish').length).toBeGreaterThan(0);
    expect(s.notices.some((n) => n.kind === 'thought')).toBe(true);
  });

  it('같은 속마음 문장은 같은 날 두 번 나오지 않음', () => {
    const s = sim(['sociable', 'gossip', 'cheerful']);
    runMinutes(s, 1440);
    const said = s.notices.filter((n) => n.kind === 'thought' && n.personId === 1).map((n) => `${Math.floor(n.minute / 1440)}:${n.args?.key}`);
    expect(new Set(said).size).toBe(said.length);
  });

  it('세기 2 이상 사건 무드렛은 기억이 됨', () => {
    const s = sim();
    s.apply({ kind: 'addMoodlet', personId: 1, moodlet: 'funeral_grief' });
    expect(s.persons[0].memories.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- M2 리뷰 결함 수정 회귀 테스트

/** 자율 끄고 욕구 50, 무드렛 없음 (감정 계산을 따로 보기 위해) */
function quiet(traits: string[] = [], d = data, seed = 1) {
  const s = new Simulation(d, seed);
  s.addPerson('가', undefined, undefined, { traits });
  s.apply({ kind: 'setAutonomy', enabled: false });
  const p = s.persons[0];
  for (const n of NEED_IDS) p.setNeed(n, 50);
  p.moodlets.length = 0;
  p.wishes = [];
  p.moodDirty = true;
  return { s, p, inner: s.inner! };
}

/** 테스트용 무드렛을 따로 불러온 데이터에 넣음 (공유 데이터를 건드리지 않음) */
function withMoodlets(defs: Array<Partial<MoodletDef> & { id: string; emotion: number; strength: number }>) {
  const d = cottageData();
  for (const x of defs) {
    const def: MoodletDef = {
      durationMin: 600, whileCond: null, permanent: false, stack: 'refresh', max: 3, needSource: false, source: 'event', group: null,
      fade: [], nameKey: 'x', descKey: 'x', icon: null, extra: [], ...x,
    };
    d.inner!.moodlets.set(def.id, def);
    for (const e of def.extra) d.inner!.companions.set(`${def.id}~${EMOTION_IDS[e.emotion]}`, { parent: def, emotion: e.emotion, strength: e.strength });
  }
  return d;
}

describe('동반 무드렛 (리뷰 3, 11)', () => {
  it('굶주림만 있으면 욕구 상한 2 를 슬픔이 먼저 차지 → 울적함 (슬픔 2, 긴장 1)', () => {
    const { s, p } = quiet();
    p.setNeed('hunger', 5);
    runMinutes(s, 1);
    expect(p.moodlets.some((m) => m.id === 'need_hunger_crit')).toBe(true);
    expect(p.emotion).toBe(EMOTION_INDEX.sad);
    expect(p.emotionStage).toBeGreaterThanOrEqual(1);
  });

  it('다시 붙여도(refresh) 동반 무드렛이 남고, 본 무드렛이 더 최근 순서 + 동반의 수명/시각도 갱신', () => {
    const { s, p, inner } = quiet();
    p.setNeed('hunger', 5);
    runMinutes(s, 31);
    inner.addMoodlet(p, 'need_hunger_crit');
    const main = p.moodlets.filter((m) => m.id === 'need_hunger_crit');
    const comp = p.moodlets.filter((m) => m.id.startsWith('need_hunger_crit~'));
    expect(main.length).toBe(1);
    expect(comp.length).toBe(1);
    expect(main[0].seq).toBeGreaterThan(comp[0].seq);
    expect(comp[0].addedAt).toBe(main[0].addedAt);
    expect(comp[0].expiresAt).toBe(main[0].expiresAt);
    inner.recompute(p);
    expect(p.emotion).toBe(EMOTION_INDEX.sad);
  });

  it('fade 는 특성 세기 보정을 유지하고(다혈질 분노 +1), 동반 무드렛도 약해짐', () => {
    const d = withMoodlets([
      { id: 'test_fade_angry', emotion: EMOTION_INDEX.angry, strength: 2, fade: [[60, 1]] },
      { id: 'test_fade_pair', emotion: EMOTION_INDEX.sad, strength: 3, fade: [[60, 2], [120, 1]], extra: [{ emotion: EMOTION_INDEX.tense, strength: 2 }] },
    ]);
    const { s, p, inner } = quiet(['hot_tempered'], d);
    inner.addMoodlet(p, 'test_fade_angry');
    inner.addMoodlet(p, 'test_fade_pair');
    expect(p.moodlets.find((m) => m.id === 'test_fade_angry')!.strength).toBe(3);
    runMinutes(s, 61);
    expect(p.moodlets.find((m) => m.id === 'test_fade_angry')!.strength).toBe(2);
    expect(p.moodlets.find((m) => m.id === 'test_fade_pair')!.strength).toBe(2);
    expect(p.moodlets.find((m) => m.id === 'test_fade_pair~tense')!.strength).toBe(1);
  });
});

describe('인생 목표와 행복 포인트 (리뷰 2, GDD 12-4, 12-5)', () => {
  it('아동은 아동 목표, 귀족은 성인+귀족 목표 후보, 평민은 귀족 목표 없음', () => {
    const s = new Simulation(data, 1);
    const kid = s.addPerson('아이', undefined, undefined, { stage: 'child' });
    expect(data.inner!.aspirations[kid.aspiration!.id].group).toBe('child');
    const nobleAsp = new Set<string>();
    const freeAsp = new Set<string>();
    for (let i = 1; i <= 120; i++) {
      nobleAsp.add(s.addPerson('귀', undefined, undefined, { estate: 'noble', innerSeed: i }).aspiration!.id);
      freeAsp.add(s.addPerson('평', undefined, undefined, { estate: 'freeman', innerSeed: i }).aspiration!.id);
    }
    const groups = (ids: Set<string>) => new Set([...ids].map((id) => data.inner!.aspirations[id].group ?? 'adult'));
    expect(groups(nobleAsp)).toEqual(new Set(['adult', 'noble']));
    expect(groups(freeAsp)).toEqual(new Set(['adult']));
  });

  it('성인 목표 1단계는 M2~M3 카운터로 도달 (음유시인: 음악 행동), 완료하면 보상 특성 효과가 바로 반영', () => {
    const { p, inner } = quiet();
    p.aspiration = { id: 'bard', stage: 0 };
    const idx = EMOTION_INDEX.inspired;
    expect(inner.fx(p).durationByEmotion[idx]).toBe(1);
    const hp0 = p.happiness;
    inner.count(p, 'tag:music', 4);
    expect(p.aspiration.stage).toBe(1);
    expect(p.happiness).toBeGreaterThan(hp0);
    inner.count(p, 'event:inn_performance', 20);
    inner.event(p, 'castle_performance');
    inner.event(p, 'song_became_legend');
    expect(p.aspiration.stage).toBe(4);
    expect(p.counters.get('reward:peoples_song')).toBe(1);
    expect(inner.fx(p).durationByEmotion[idx]).toBe(1.5);
  });

  it('모든 인생 목표의 1단계가 지금 생기는 카운터로 도달 가능', () => {
    const inner = new Simulation(data, 1).inner!;
    for (const a of Object.values(data.inner!.aspirations)) expect(a.stages[0].need.every((n) => needReachable(inner.reach, n))).toBe(true);
  });

  it('보상 구매는 상점 보상만 (인생 목표 완료 보상은 행복 0 으로도, 많아도 못 삼)', () => {
    const { p, inner } = quiet();
    p.happiness = 0;
    expect(inner.buyReward(p, 'peoples_song')).toBe(false);
    p.happiness = 10000;
    expect(inner.buyReward(p, 'peoples_song')).toBe(false);
    expect(inner.buyReward(p, 'strong_bladder')).toBe(true);
    expect(p.happiness).toBe(10000 - (data.inner!.rewards.strong_bladder.cost as number));
  });

  it('행복(강함 이상) 상태가 이어지면 행복 포인트가 쌓임', () => {
    const d = withMoodlets([{ id: 'test_joy', emotion: EMOTION_INDEX.happy, strength: 3, permanent: true, durationMin: 0 }]);
    const { s, p, inner } = quiet([], d);
    inner.addMoodlet(p, 'test_joy');
    const hp0 = p.happiness;
    runMinutes(s, 181);
    expect(p.emotion).toBe(EMOTION_INDEX.happy);
    expect(p.happiness - hp0).toBeGreaterThanOrEqual(2);
  });
});

describe('극단 감정 위험 (리뷰 9, GDD 11-3)', () => {
  it('부정 감정 극단이 4시간 넘게 이어지면 판정 (사건 + 스트레스), 설정으로 끌 수 있음', () => {
    const d = withMoodlets([
      { id: 'test_despair_a', emotion: EMOTION_INDEX.sad, strength: 3, permanent: true, durationMin: 0 },
      { id: 'test_despair_b', emotion: EMOTION_INDEX.sad, strength: 3, permanent: true, durationMin: 0 },
    ]);
    for (const on of [true, false]) {
      const { s, p, inner } = quiet([], d);
      inner.extremeRiskEnabled = on;
      inner.addMoodlet(p, 'test_despair_a');
      inner.addMoodlet(p, 'test_despair_b');
      runMinutes(s, 5);
      expect(p.emotionStage).toBe(3);
      const st0 = p.stress;
      runMinutes(s, 230);
      expect(p.counters.get('event:extreme_risk') ?? 0).toBe(0);
      runMinutes(s, 20);
      expect(p.counters.get('event:extreme_risk') ?? 0).toBe(on ? 1 : 0);
      expect(p.counters.get('event:extreme_risk_sad') ?? 0).toBe(on ? 1 : 0);
      if (on) expect(p.stress).toBeGreaterThan(st0);
    }
  });
});

describe('소원·걱정 풀과 사건 (리뷰 4, 10)', () => {
  it('뽑히는 소원/걱정은 모두 지금 생길 수 있는 사건으로 이뤄짐', () => {
    const s = sim();
    const inner = s.inner!;
    expect(inner.wishPool.wish.length).toBeGreaterThan(0);
    expect(inner.wishPool.fear.length).toBeGreaterThan(0);
    for (const w of [...inner.wishPool.wish, ...inner.wishPool.fear]) expect(wishReachable(inner.reach, w)).toBe(true);
    runMinutes(s, 1440);
    const defs = new Map(data.inner!.wishes.map((w) => [w.id, w]));
    for (const p of s.persons) for (const w of p.wishes) expect(wishReachable(inner.reach, defs.get(w.id)!)).toBe(true);
  });

  it('접두어 없는 사건 이름은 event:<이름> 으로 셈 (사회 결과 events), social_ok 도 셈', () => {
    const { p, inner } = quiet();
    inner.event(p, 'first_kiss');
    inner.event(p, 'event:first_kiss');
    expect(p.counters.get('event:first_kiss')).toBe(2);
    inner.event(p, 'social_ok:social.chat');
    expect(p.counters.get('social_ok:social.chat')).toBe(1);
  });
});

describe('호불호 (리뷰 5, GDD 12-3)', () => {
  it('염료만 있는 항목은 뽑지 않고, 대부분 지금 걸리는 항목을 가짐', () => {
    const s = new Simulation(data, 3);
    const ps: Person[] = [];
    for (let i = 1; i <= 100; i++) ps.push(s.addPerson('사람', undefined, undefined, { innerSeed: i }));
    const inner = s.inner!;
    let active = 0;
    let total = 0;
    for (const p of ps) {
      for (const l of [...p.likes, ...p.dislikes]) {
        expect(l.startsWith('color_')).toBe(false);
        total++;
        if (likeReach(inner.reach, data.inner!, l) === 'active') active++;
      }
    }
    expect(active / total).toBeGreaterThan(0.5);
  });

  it('좋아하는 활동은 즐거움 회복 배수 (funMult), 아니면 1', () => {
    const { p, inner } = quiet();
    p.likes = ['music_lute'];
    p.dislikes = [];
    expect(inner.funMult(p, 'lute.play', ['music'])).toBe(data.inner!.likeEffects.funRecoveryMult);
    expect(inner.funMult(p, 'bookshelf.read', ['read'])).toBe(1);
  });

  it('좋아하는 계절에 바깥에 나가면 하루 한 번 좋은 무드렛', () => {
    const { s, p } = quiet();
    p.likes = ['season_spring'];
    p.dislikes = [];
    s.world.season = 'spring';
    const g = s.world.grid;
    let cell = -1;
    for (let i = 0; i < g.w * g.h && cell < 0; i++) if (g.walkable(i) && g.roomOf(i % g.w, Math.floor(i / g.w)) < 0) cell = i;
    expect(cell).toBeGreaterThanOrEqual(0);
    p.x = (cell % g.w) + 0.5;
    p.y = Math.floor(cell / g.w) + 0.5;
    runMinutes(s, 10);
    const ids = [data.inner!.likeEffects.seasonLikedMoodlet, data.inner!.likeEffects.likedMoodlet];
    expect(p.moodlets.some((m) => ids.includes(m.id))).toBe(true);
  });
});

describe('시각 옮기기 (리뷰 12)', () => {
  it('shiftTime 은 무드렛/소원/속마음/무너짐 대기 시각을 같이 옮김', () => {
    const { s, p, inner } = quiet();
    inner.addMoodlet(p, 'fresh_bread');
    inner.refreshWishes(p);
    s.apply({ kind: 'setStress', personId: 1, value: 100 });
    const m = p.moodlets.find((x) => x.id === 'fresh_bread')!;
    const e0 = m.expiresAt;
    const a0 = m.addedAt;
    const w0 = p.wishes.map((w) => w.expiresAt);
    const c0 = p.pendingChoice!.since;
    const t0 = p.lastThoughtAt;
    inner.shiftTime(p, -100);
    expect(m.expiresAt).toBe(e0 - 100);
    expect(m.addedAt).toBe(a0 - 100);
    expect(p.wishes.map((w) => w.expiresAt)).toEqual(w0.map((x) => x - 100));
    expect(p.pendingChoice!.since).toBe(c0 - 100);
    expect(p.lastThoughtAt).toBe(t0 - 100);
    inner.forget(p);
    expect(() => inner.fx(p)).not.toThrow();
  });
});
