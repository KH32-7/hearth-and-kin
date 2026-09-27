/**
 * 첫 하루 튜토리얼 판정 (GDD 27-4, src/ui/tutorialFlow.ts): 단계 완료 · 건너뛰기, 요리 고르기, 신분별 첫 과제, 하루 정산, 처음 마주침, 저장 상태
 */
import { describe, expect, it } from 'vitest';
import type { PersonSnap, Snapshot } from '../../src/sim/protocol';
import {
  ActTracker, beginGoal, beginOnce, beginStep, daySummary, goalDone, onceHits, parseState, pickCook, pickGoal, skipStep, stepDone,
  type DefOf, type Env, type UiView,
} from '../../src/ui/tutorialFlow';

const DEFS: Record<string, { kind?: string; tags?: string[] }> = {
  hearth: { tags: ['hearth', 'cook'] },
  prep_counter: { tags: ['kitchen'] },
  oven: { tags: ['oven', 'bake'] },
  field_plot: { tags: ['field', 'outdoor'] },
  bed_straw: {},
  dining_table: {},
};
const defOf: DefOf = (d) => DEFS[d];

function person(id: number, o: Partial<PersonSnap> = {}): PersonSnap {
  return {
    id, name: `p${id}`, x: 5, y: 5, trail: [], facing: 'down', pose: 'stand', anim: 'idle', outfit: 'everyday', carry: null, hidden: false, underBlanket: false, sleeping: false,
    needs: {}, queue: [], action: null, feltC: 15, collapsed: false, appearance: {}, talkingWith: -1, topic: null, chatWith: -1, household: 1, visitor: null, lastSocial: null,
    inner: null, career: null, careerEvent: null, skills: null, lastWork: null, lastCraft: null, lastSkillUp: null, lastHarvest: null, lifeStage: 'adult', ...o,
  } as PersonSnap;
}

function snap(o: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: 0, minute: 480, day: 0, minuteOfDay: 480, season: 'spring', outsideC: 12, roomTemps: [], stock: {}, speed: 1, autoAccel: false,
    persons: [person(1)], objects: [], notices: [], relations: [], pendingVisits: [], econ: null, away: [], tickMs: 0, lotVersion: 0, build: null, ...o,
  } as Snapshot;
}

const ui = (o: Partial<UiView> = {}): UiView => ({ selectedId: 1, pieOpen: false, popup: null, bookOpen: false, buildMode: 'live', dialogOpen: false, cancels: 0, ...o });
const obj = (uid: number, defId: string, x = 3, y = 3, state: Record<string, number | boolean> = {}) => ({ uid, defId, x, y, state });
const env = (s: Snapshot, home: Env['home'] = null): Env => ({ home, defOf, cook: pickCook(s, home, defOf) });

describe('첫 하루 단계 판정', () => {
  it('원형 메뉴: 플레이어가 새로 넣은 할 일이 생기면 완료 (자율 행동은 아님)', () => {
    const s0 = snap({ persons: [person(1, { queue: [{ id: 4, interactionId: 'bed.nap', targetUid: 1, autonomous: false }] })] });
    const base = beginStep(s0, ui());
    const acts = new ActTracker();
    const auto = snap({ persons: [person(1, { queue: [{ id: 9, interactionId: 'seat.sit', targetUid: 2, autonomous: true }] })] });
    expect(stepDone('pie', auto, ui(), base, acts, env(auto), 0)).toBe(false);
    const mine = snap({ persons: [person(1, { queue: [{ id: 10, interactionId: 'seat.sit', targetUid: 2, autonomous: false }] })] });
    expect(stepDone('pie', mine, ui(), base, acts, env(mine), 0)).toBe(true);
  });

  it('대기열: 두 개 이상 넣은 뒤 하나를 눌러 취소해야 완료', () => {
    const s0 = snap();
    const base = beginStep(s0, ui({ cancels: 2 }));
    const acts = new ActTracker();
    const q2 = snap({ persons: [person(1, { queue: [1, 2].map((id) => ({ id, interactionId: 'seat.sit', targetUid: 2, autonomous: false })) })] });
    expect(stepDone('queue', q2, ui({ cancels: 2 }), base, acts, env(q2), 0)).toBe(false);
    const q1 = snap({ persons: [person(1, { queue: [{ id: 2, interactionId: 'seat.sit', targetUid: 2, autonomous: false }] })] });
    expect(stepDone('queue', q1, ui({ cancels: 3 }), base, acts, env(q1), 0)).toBe(true);
    // 하나만 넣고 취소하면 아직
    const b2 = beginStep(s0, ui());
    expect(stepDone('queue', q1, ui({ cancels: 1 }), b2, acts, env(q1), 0)).toBe(false);
  });

  it('욕구 창 · 기상(▼) · 잠', () => {
    const s = snap();
    const base = beginStep(s, ui());
    const acts = new ActTracker();
    expect(stepDone('needs', s, ui({ popup: 'needs' }), base, acts, env(s), 0)).toBe(true);
    expect(stepDone('wake', s, ui(), base, acts, env(s), 0)).toBe(false);
    base.confirmed = true;
    expect(stepDone('wake', s, ui(), base, acts, env(s), 0)).toBe(true);
    const asleep = snap({ persons: [person(1, { sleeping: true })] });
    expect(stepDone('sleep', asleep, ui(), base, acts, env(asleep), 0)).toBe(true);
    // 자정을 넘기면 잠 단계도 넘어감
    expect(stepDone('sleep', snap({ day: 1 }), ui(), base, acts, env(s), 0)).toBe(true);
  });

  it('요리: 수행 단계까지 간 요리가 끝나야 완료, 먹기는 수행이 시작되면', () => {
    const acts = new ActTracker();
    const act = (ia: string, phase: string) => snap({ persons: [person(1, { action: { interactionId: ia, targetUid: 1, stepObj: 1, phase, remaining: 5 } })] });
    const s0 = snap();
    const base = beginStep(s0, ui());
    acts.update(act('hearth.cook_stew', 'walk'));
    acts.update(snap());
    expect(stepDone('cook', snap(), ui(), base, acts, env(s0), 0)).toBe(false);
    acts.update(act('hearth.cook_stew', 'perform'));
    acts.update(snap());
    expect(stepDone('cook', snap(), ui(), base, acts, env(s0), 0)).toBe(true);
    acts.reset();
    acts.update(act('table.eat_stew', 'perform'));
    expect(stepDone('eat', snap(), ui(), base, acts, env(s0), 0)).toBe(true);
    // 요리 레시피 (화로 죽)도 요리로 침
    acts.reset();
    acts.update(act('recipe.cook_oat_porridge', 'perform'));
    acts.update(snap());
    expect(stepDone('cook', snap(), ui(), base, acts, env(s0), 0)).toBe(true);
  });

  it('이웃과 대화: 다른 집 사람에게 사회 상호작용', () => {
    const s0 = snap({ persons: [person(1), person(7, { household: 3 })] });
    const base = beginStep(s0, ui());
    const acts = new ActTracker();
    const talking = snap({ persons: [person(1, { action: { interactionId: 'social.chat', targetUid: 7, stepObj: -1, phase: 'walk', remaining: 5 } }), person(7, { household: 3 })] });
    expect(stepDone('talk', talking, ui(), base, acts, env(s0), 0)).toBe(true);
    // 식구끼리는 아님
    const fam = snap({ persons: [person(1, { action: { interactionId: 'social.chat', targetUid: 2, stepObj: -1, phase: 'walk', remaining: 5 } }), person(2), person(7, { household: 3 })] });
    expect(stepDone('talk', fam, ui(), base, acts, env(s0), 0)).toBe(false);
    // 마을 사람이 없으면 건너뜀
    expect(skipStep('talk', snap(), env(snap()))).toBe(true);
    expect(skipStep('talk', s0, env(s0))).toBe(false);
  });
});

describe('먹을 것 만들기: 그 집에서 되는 요리', () => {
  it('오븐 + 재료 → 빵 굽기, 없으면 조리대 빵, 화로 스튜, 화로 레시피, 아무것도 없으면 null', () => {
    const oven = snap({ objects: [obj(1, 'oven'), obj(2, 'hearth')], stock: { flour: 2, water: 1, yeast: 1, firewood: 1 } });
    expect(pickCook(oven, null, defOf)?.ia).toBe('recipe.bake_bread');
    const counter = snap({ objects: [obj(1, 'prep_counter'), obj(2, 'hearth', 3, 3, { lit: true })], stock: { flour: 2 } });
    expect(pickCook(counter, null, defOf)).toMatchObject({ ia: 'counter.bake_bread', kind: 'bread', needFire: false });
    const stew = snap({ objects: [obj(2, 'hearth')], stock: { ingredients: 3, firewood: 2 } });
    expect(pickCook(stew, null, defOf)).toMatchObject({ ia: 'hearth.cook_stew', kind: 'stew', needFire: true });
    const porridge = snap({ objects: [obj(2, 'hearth')], stock: { oats: 1, water: 1 } });
    expect(pickCook(porridge, null, defOf)).toMatchObject({ ia: 'recipe.cook_oat_porridge', kind: 'dish', nameKey: 'item.porridge' });
    expect(pickCook(snap({ objects: [obj(2, 'hearth')] }), null, defOf)).toBeNull();
    // 집 밖 물건은 안 셈
    expect(pickCook(stew, [10, 10, 20, 20], defOf)).toBeNull();
  });

  it('불 피우기는 불이 꺼진 화로로 요리할 때만, 요리할 게 없으면 요리 단계를 건너뜀', () => {
    const cold = snap({ objects: [obj(2, 'hearth')], stock: { ingredients: 3, firewood: 2 } });
    expect(skipStep('fire', cold, env(cold))).toBe(false);
    const lit = snap({ objects: [obj(2, 'hearth', 3, 3, { lit: true })], stock: { ingredients: 3 } });
    expect(skipStep('fire', lit, env(lit))).toBe(true);
    const none = snap({ objects: [obj(9, 'bed_straw')] });
    expect(skipStep('cook', none, env(none))).toBe(true);
    expect(skipStep('eat', none, env(none))).toBe(true);
    expect(stepDone('fire', lit, ui(), beginStep(lit, ui()), new ActTracker(), env(cold), 0)).toBe(true);
  });

  it('요리할 곳이 없으면 화로 놓기 (살 돈이 있을 때만), 놓으면 완료', () => {
    const econ = (money: number) => ({ money, shop: { open: false, priceMult: 1, reputation: 30, sales: 0 } }) as Snapshot['econ'];
    const bare = snap({ objects: [obj(9, 'bed_straw')], stock: { ingredients: 3, firewood: 2 }, econ: econ(5000) });
    expect(skipStep('kitchen', bare, env(bare))).toBe(false);
    expect(skipStep('kitchen', snap({ objects: [obj(9, 'bed_straw')], econ: econ(10) }), env(bare))).toBe(true);
    const placed = snap({ objects: [obj(9, 'bed_straw'), obj(2, 'hearth')], stock: { ingredients: 3, firewood: 2 }, econ: econ(4760) });
    expect(skipStep('kitchen', placed, env(placed))).toBe(true);
    expect(stepDone('kitchen', placed, ui(), beginStep(bare, ui()), new ActTracker(), env(placed), 0)).toBe(true);
    // 화로를 놓은 뒤에는 불 피우기 → 스튜
    expect(env(placed).cook).toMatchObject({ ia: 'hearth.cook_stew', needFire: true });
  });
});

describe('신분별 첫 과제', () => {
  const house = (estate: string, extra: Record<string, unknown> = {}) => ({ estate, cards: [], rumors: [], letters: [], trial: null, domain: null, ...extra }) as unknown as Snapshot['house'];
  const career = (id: string, orders: { item: string; qty: number; pay: number; done: boolean }[] = []) => ({ id, rank: 0, perf: 0, attitude: 'normal', orders });

  it('신분마다 과제 종류', () => {
    const field = [obj(1, 'field_plot', 3, 3, { tilled: 0, crop: 0 })];
    expect(pickGoal(snap({ house: house('serf'), objects: field }), null, defOf).kind).toBe('till');
    expect(pickGoal(snap({ house: house('freeman'), persons: [person(1, { career: career('field_hand') })] }), null, defOf).kind).toBe('daywork');
    expect(pickGoal(snap({ house: house('artisan'), persons: [person(1, { career: career('blacksmith') })] }), null, defOf).kind).toBe('order');
    expect(pickGoal(snap({ house: house('merchant'), econ: { shop: { open: false, priceMult: 1, reputation: 30, sales: 0 } } as Snapshot['econ'] }), null, defOf).kind).toBe('shop');
    expect(pickGoal(snap({ house: house('clergy'), persons: [person(1, { career: career('priest') })] }), null, defOf).kind).toBe('mass');
    expect(pickGoal(snap({ house: house('knight'), persons: [person(1, { career: career('knight') })] }), null, defOf).kind).toBe('drill');
    expect(pickGoal(snap({ house: house('noble', { domain: { levels: { tax: 'normal' }, lord: true } }) }), null, defOf).kind).toBe('petition');
    // 그 신분의 일이 없으면 가장 가까운 일: 사제 일이 없는 성직자는 미사 참석, 영주가 아닌 귀족은 영주에게 탄원
    expect(pickGoal(snap({ house: house('knight') }), null, defOf).kind).toBe('work');
    expect(pickGoal(snap({ house: house('clergy') }), null, defOf).kind).toBe('attend');
    expect(pickGoal(snap({ house: house('noble', { domain: { levels: {}, lord: false } }) }), null, defOf).kind).toBe('plead');
  });

  it('완료 감지: 밭 갈기 · 주문 · 가게 · 미사 · 정책', () => {
    const g = (s: Snapshot) => pickGoal(s, null, defOf);
    const f0 = snap({ house: house('serf'), objects: [obj(1, 'field_plot', 3, 3, { tilled: 0, crop: 0 })] });
    const b0 = beginGoal(f0, null, defOf);
    const acts = new ActTracker();
    expect(goalDone(g(f0), f0, b0, acts, null, defOf)).toBe(false);
    const f1 = snap({ house: house('serf'), objects: [obj(1, 'field_plot', 3, 3, { tilled: 1, crop: 0 })] });
    expect(goalDone(g(f0), f1, b0, acts, null, defOf)).toBe(true);

    const a0 = snap({ house: house('artisan'), persons: [person(1, { career: career('blacksmith', [{ item: 'nails', qty: 12, pay: 5, done: false }]) })] });
    const ab = beginGoal(a0, null, defOf);
    expect(goalDone(g(a0), a0, ab, acts, null, defOf)).toBe(false);
    const a1 = snap({ house: house('artisan'), persons: [person(1, { career: career('blacksmith', [{ item: 'nails', qty: 12, pay: 5, done: true }]) })] });
    expect(goalDone(g(a0), a1, ab, acts, null, defOf)).toBe(true);
    // 하루 끝에 주문이 비워져도 한 번 본 것은 남음
    expect(goalDone(g(a0), a0, ab, acts, null, defOf)).toBe(true);

    const shop = (open: boolean) => snap({ house: house('merchant'), econ: { shop: { open, priceMult: 1, reputation: 30, sales: 0 } } as Snapshot['econ'] });
    const sb = beginGoal(shop(false), null, defOf);
    expect(goalDone(g(shop(false)), shop(false), sb, acts, null, defOf)).toBe(false);
    expect(goalDone(g(shop(false)), shop(true), sb, acts, null, defOf)).toBe(true);

    const pr = snap({ house: house('clergy'), persons: [person(1, { career: career('priest') })] });
    const pb = beginGoal(pr, null, defOf);
    const m = new ActTracker();
    m.update(snap({ persons: [person(1, { action: { interactionId: 'service.priest.say_mass', targetUid: 1, stepObj: 1, phase: 'perform', remaining: 50 } })] }));
    expect(goalDone(g(pr), pr, pb, m, null, defOf)).toBe(false);
    m.update(snap());
    expect(goalDone(g(pr), pr, pb, m, null, defOf)).toBe(true);

    // 영주가 아닌 귀족: 성에서 탄원을 올리고 끝나면
    const pl = snap({ house: house('noble', { domain: { levels: {}, lord: false } }) });
    const plb = beginGoal(pl, null, defOf);
    const pa = new ActTracker();
    pa.update(snap({ persons: [person(1, { action: { interactionId: 'throne.petition', targetUid: 5, stepObj: 5, phase: 'perform', remaining: 20 } })] }));
    expect(goalDone(g(pl), pl, plb, pa, null, defOf)).toBe(false);
    pa.update(snap());
    expect(goalDone(g(pl), pl, plb, pa, null, defOf)).toBe(true);

    const nb = (tax: string) => snap({ house: house('noble', { domain: { levels: { tax }, lord: true } }) });
    const nbb = beginGoal(nb('normal'), null, defOf);
    expect(goalDone(g(nb('normal')), nb('normal'), nbb, acts, null, defOf)).toBe(false);
    expect(goalDone(g(nb('normal')), nb('low'), nbb, acts, null, defOf)).toBe(true);
  });
});

describe('하루 정산 · 처음 마주침 · 저장', () => {
  it('그날 가계부 줄에서 번 돈 · 쓴 돈 (시작 자금 · 빚 · 집값 빼고), 식구 기분', () => {
    const s = snap({
      day: 1,
      econ: { book: [{ day: 0, income: { wage: 10, shop: 5, start: 900, loan: 50 }, expense: { food: 4, house: 700 }, money: 100 }], today: { income: {}, expense: {} }, shop: { open: false, priceMult: 1, reputation: 30, sales: 0 } } as unknown as Snapshot['econ'],
      persons: [person(1, { inner: { emotion: 'happy', stage: 1 } as PersonSnap['inner'] }), person(2), person(9, { household: 3 })],
    });
    const d = daySummary(s, 0, null, 4);
    expect(d).toMatchObject({ income: 15, expense: 4, achieved: 4 });
    expect(d.moods.map((m) => m.emotion)).toEqual(['happy', 'neutral']);
    // 가계부 줄이 없으면 자정 전에 잡아 둔 today
    expect(daySummary(snap(), 0, { income: { wage: 3 }, expense: { food: 1 } }, 0)).toMatchObject({ income: 3, expense: 1 });
  });

  it('처음 마주침: 건축 모드, 사건 카드, 임신, 재판, 새 소문, 새 편지', () => {
    const h0 = { estate: 'freeman', cards: [], rumors: [{ id: 3 }], letters: [{ id: 5 }], trial: null } as unknown as Snapshot['house'];
    const base = beginOnce(snap({ house: h0 }));
    expect(onceHits(snap({ house: h0 }), ui(), base)).toEqual([]);
    const h1 = { estate: 'freeman', cards: [{ seq: 1 }], rumors: [{ id: 3 }, { id: 4 }], letters: [{ id: 5 }, { id: 6 }], trial: { stage: 'plea' } } as unknown as Snapshot['house'];
    const hits = onceHits(snap({ house: h1, persons: [person(1, { bellyStage: 0 })] }), ui({ buildMode: 'buy' }), base);
    expect(hits).toEqual(['build', 'card', 'pregnancy', 'trial', 'rumor', 'letter']);
  });

  it('저장 상태: 올바른 것만 되살림', () => {
    expect(parseState({ v: 2, step: 'cook', startDay: 3, goal: 'mass', done: ['pie', 'nope'] })).toEqual({ v: 2, step: 'cook', startDay: 3, goal: 'mass', done: ['pie'] });
    expect(parseState({ v: 1, step: 'cook' })).toBeNull();
    expect(parseState({ v: 2, step: 'zzz', goal: 'x' })).toMatchObject({ step: null, goal: null });
    expect(parseState(null)).toBeNull();
  });
});
