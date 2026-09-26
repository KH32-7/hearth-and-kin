/**
 * M7 생애와 가족 (GDD 10-2, 15-3~15-8): 생애 단계와 생일, 특성 칸, 수명 설정, 아기 돌봄·울음, 유아 기저귀·기기,
 * 교육 경로·과제, 입양·가정 상한, 고아 후견, 아기 → 노년 전 과정 (짧은 수명)
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/sim';
import type { Person } from '../../src/sim/people/person';
import { loadSimData } from '../../tools/data-node';

const data = loadSimData({});

function family(seed = 1, lifespan = 'normal'): { s: Simulation; mom: Person; dad: Person; baby: Person } {
  const s = new Simulation(data, seed);
  s.apply({ kind: 'setLifespan', preset: lifespan });
  const mom = s.addPerson('엄마', undefined, undefined, { sex: 'female', estate: 'freeman' });
  const dad = s.addPerson('아빠', undefined, undefined, { sex: 'male', estate: 'freeman' });
  mom.lifeStage = 'young';
  dad.lifeStage = 'young';
  mom.spouse = dad.id;
  dad.spouse = mom.id;
  s.apply({ kind: 'setRelation', a: mom.id, b: dad.id, flags: ['spouse'], friendship: 60, romance: 60, met: true });
  s.apply({ kind: 'setCareer', personId: dad.id, careerId: 'field_hand' });
  s.apply({ kind: 'grant', amount: 2400, reason: 'start' });
  const baby = (s as unknown as { bornTo(m: Person, f: Person | null): Person }).bornTo(mom, dad);
  return { s, mom, dad, baby };
}

function run(s: Simulation, minutes: number): void {
  for (let i = 0; i < minutes; i++) s.tick();
}

describe('M7 생애 단계와 생일 (10-2)', () => {
  it('갓난아기: 기질 하나뿐(성격 특성 없음), 보이는 자리(요람/품/바닥), 유전자와 외형', () => {
    const { s, baby } = family();
    const temper = s.lifecycle!.d.traits.temperaments;
    expect(baby.traits.filter((t) => temper.includes(t)).length).toBe(1);
    const personality = s.lifecycle!.d.traits.goodTraits.concat(s.lifecycle!.d.traits.badTraits);
    expect(baby.traits.some((t) => personality.includes(t))).toBe(false);
    expect(baby.hidden).toBe(false);
    expect(['cradle', 'held', 'floor']).toContain(baby.babyPlace?.kind);
    expect(baby.genome).toBeTruthy();
    expect((baby.appearance as { sex?: string }).sex).toBe(baby.sex);
  });

  it('단계 끝에 닿으면 그날 아침 생일에 바뀜, 미루기는 하루씩 최대 3일', () => {
    const { s, baby } = family();
    const len = s.lifecycle!.stageDays('baby');
    baby.ageDays = len - 1;
    run(s, 1440 - s.world.minuteOfDay() + 60); // 자정 넘김 → 생일 대기
    expect(baby.birthdayDay).toBeGreaterThanOrEqual(0);
    expect(baby.lifeStage).toBe('baby');
    expect(s.apply({ kind: 'delayBirthday', personId: baby.id })).toMatchObject({ ok: true });
    run(s, 8 * 60); // 아침 7시가 지나도 미룬 날이라 그대로
    expect(baby.lifeStage).toBe('baby');
    run(s, 1440);
    expect(baby.lifeStage).toBe('toddler');
    expect(baby.birthdayDay).toBe(-1);
    for (let k = 0; k < 4; k++) baby.birthdayDelayed = k < 3 ? k : 3;
    baby.birthdayDay = 1;
    expect(s.lifecycle!.delay(baby)).toBe(false);
  });

  it('수명 설정 (29-0 lifespan): 길게 하면 단계 일수가 배로', () => {
    const { s } = family();
    const normal = s.lifecycle!.stageDays('young');
    s.apply({ kind: 'setLifespan', preset: 'long' });
    expect(s.lifecycle!.stageDays('young')).toBe(normal * 2);
  });

  it('특성 칸: 아동 1(기질 대신) → 청소년 2 → 청년 3, 노년 특성은 확률', () => {
    const { s, baby } = family(3);
    const lc = s.lifecycle!;
    baby.lifeStage = 'toddler';
    lc.transition(baby);
    expect(baby.lifeStage).toBe('child');
    expect(baby.traits.some((t) => lc.d.traits.temperaments.includes(t))).toBe(false);
    lc.transition(baby);
    lc.transition(baby);
    expect(baby.lifeStage).toBe('young');
    const personality = Object.entries(s.data.inner!.traits.traits).filter(([, t]) => t.category !== 'temperament' && t.category !== 'congenital' && t.category !== 'elder').map(([k]) => k);
    expect(baby.traits.filter((t) => personality.includes(t)).length).toBe(3);
  });

  it('노화 끄기: 나이를 먹지 않음', () => {
    const { s, baby } = family();
    s.apply({ kind: 'setAgingOff', personId: baby.id, off: true });
    const a0 = baby.ageDays;
    run(s, 3 * 1440);
    expect(baby.ageDays).toBe(a0);
    expect(baby.lifeStage).toBe('baby');
  });
});

describe('M7 아기·유아 돌봄 (15-3, 15-4)', () => {
  it('배고파 우는 아기를 식구가 자율로 먹임 (젖/죽): 하루 동안 배고픔 바닥 없음', () => {
    const { s, baby } = family(2);
    baby.setNeed('hunger', 20);
    let min = 100;
    let fed = 0;
    for (let i = 0; i < 1440; i++) {
      s.tick();
      min = Math.min(min, baby.need('hunger'));
      for (const q of s.persons) if (q.action?.item.interactionId === 'care.nurse' || q.action?.item.interactionId === 'care.porridge') fed++;
    }
    expect(fed).toBeGreaterThan(0);
    expect(min).toBeGreaterThan(0);
  });

  it('아기가 울면 같은 집 깬 식구에게 시끄러움 무드렛', () => {
    const { s, baby, mom } = family(4);
    s.autonomyEnabled = false;
    baby.setNeed('hunger', 5);
    run(s, 30);
    expect(baby.crying).toBe(true);
    expect(mom.moodlets.some((m) => m.id === 'baby_crying_noise')).toBe(true);
  });

  it('유아: 배변 훈련 전에는 방광 0 이 기저귀 (실수 아님), 걷기 전엔 기어다님', () => {
    const { s, baby } = family(5);
    baby.lifeStage = 'toddler';
    (s as unknown as { coarseStage(p: Person): void }).coarseStage(baby);
    const acc0 = s.stats.accidents;
    baby.setNeed('bladder', 0.01);
    run(s, 2);
    expect(s.stats.accidents).toBe(acc0);
    expect(baby.need('hygiene')).toBeLessThanOrEqual(5);
    expect(s.childcare!.moveAnim(baby)).toBe('crawl');
    baby.childSkills.walking = 2;
    expect(s.childcare!.moveAnim(baby)).toBe('walk');
    expect(s.childcare!.allowInteraction(baby, 'hearth.cook_stew', [])).toBe(false);
    expect(s.childcare!.allowInteraction(baby, 'toy_chest.play_blocks', ['toddler'])).toBe(true);
  });

  it('유아 기술: 가르치면 레벨이 오르고 걸음마 때 부모 무드렛', () => {
    const { s, baby, mom } = family(6);
    baby.lifeStage = 'toddler';
    const cc = s.childcare!;
    for (let i = 0; i < 400; i++) cc.teach(baby, 'walking', 1.5);
    expect(cc.skillLevel(baby, 'walking')).toBeGreaterThanOrEqual(2);
    expect(mom.moodlets.some((m) => m.id === 'first_steps_pride')).toBe(true);
  });

  it('사흘이 아니라 이틀 굶으면 아기가 죽음 (사용자 기준, 사망 설정 아이 칸 켬)', () => {
    const { s, baby } = family(7);
    s.autonomyEnabled = false;
    baby.setNeed('hunger', 0);
    (baby as { neglectHandled: boolean }).neglectHandled = true; // 개입 사건 대신 굶주림만 보려고
    s.data.family; // 사망 설정 기본 = 현실적
    run(s, 2 * 1440 + 30);
    expect(s.persons.includes(baby)).toBe(false);
  });
});

describe('M7 아동·청소년·가정 (15-5 ~ 15-8)', () => {
  it('교구 학교: 수업 시간엔 집에 없고(래빗홀), 끝나면 과제, 과제를 하면 성적', () => {
    const { s, baby } = family(8);
    baby.lifeStage = 'child';
    (s as unknown as { coarseStage(p: Person): void }).coarseStage(baby);
    expect(s.apply({ kind: 'setEducation', personId: baby.id, path: 'parish_school' })).toMatchObject({ ok: true });
    // 월요일 오전 9시
    s.apply({ kind: 'setTime', minuteOfDay: 8 * 60 + 59 });
    run(s, 2);
    expect(baby.schoolAway).toBe(true);
    expect(baby.hidden).toBe(true);
    run(s, 4 * 60);
    expect(baby.schoolAway).toBe(false);
    expect(baby.homework).toBeTruthy();
    s.childcare!.homeworkProgress(baby, 1);
    expect(baby.homework).toBeNull();
    expect(s.childcare!.grade(baby)).toBe('A');
    // 신분이 안 맞는 경로 거부 (시동은 기사/귀족)
    expect(s.apply({ kind: 'setEducation', personId: baby.id, path: 'page' })).toMatchObject({ ok: false });
  });

  it('입양: 가정 상한(12)이면 불가, 아니면 새 아이 + 명성', () => {
    const { s, mom } = family(9);
    const r = s.apply({ kind: 'adopt', personId: mom.id, stage: 'child' }) as { ok: boolean; childId?: number };
    expect(r.ok).toBe(true);
    expect(s.persons.find((q) => q.id === r.childId)?.household).toBe(mom.household);
    // 같은 순간에 둘을 들여도 유전자가 다름, 아기는 기질만·소원 없음
    const b1 = s.apply({ kind: 'adopt', personId: mom.id, stage: 'baby' }) as { childId: number };
    const b2 = s.apply({ kind: 'adopt', personId: mom.id, stage: 'baby' }) as { childId: number };
    const g1 = s.persons.find((q) => q.id === b1.childId)!;
    const g2 = s.persons.find((q) => q.id === b2.childId)!;
    expect(JSON.stringify(g1.genome)).not.toBe(JSON.stringify(g2.genome));
    expect(g1.wishes.length).toBe(0);
    expect(g1.traits.every((t) => s.data.inner!.traits.traits[t]?.category === 'temperament' || s.data.inner!.traits.traits[t]?.category === 'congenital')).toBe(true);
    expect(s.fame.get(mom.household) ?? 0).toBeGreaterThan(0);
    while (s.persons.filter((q) => q.household === mom.household).length < 12) s.addPerson('식구', undefined, undefined, { household: mom.household });
    expect((s.apply({ kind: 'adopt', personId: mom.id, stage: 'baby' }) as { ok: boolean; reason?: string }).reason).toBe('household_full');
  });

  it('부모를 모두 잃은 아이는 대부모 가구로 (후견, 15-7)', () => {
    const { s, mom, dad, baby } = family(10);
    const god = s.addPerson('대모', undefined, undefined, { household: 7, sex: 'female' });
    god.lifeStage = 'adult';
    expect(s.apply({ kind: 'setGodparent', childId: baby.id, godparentId: god.id })).toMatchObject({ ok: true });
    const kill = (p: Person) => (s as unknown as { killPerson(p: Person, c: string): void }).killPerson(p, 'illness');
    kill(mom);
    kill(dad);
    expect(baby.household).toBe(7);
  });

  it('출생으로 가정 상한을 넘기면 허용 + 비좁음 무드렛 (15-8)', () => {
    const { s, mom, dad } = family(11);
    while (s.persons.filter((q) => q.household === mom.household).length < 12) s.addPerson('식구', undefined, undefined, { household: mom.household });
    (s as unknown as { bornTo(m: Person, f: Person | null): Person }).bornTo(mom, dad);
    expect(s.persons.filter((q) => q.household === mom.household).length).toBe(13);
    expect(mom.moodlets.some((m) => m.id === 'cramped_house')).toBe(true);
  });
});

describe('M7 아기 → 노년 전 과정 (헤드리스, 짧은 수명)', () => {
  it('자율만으로 7단계를 모두 지나고 stuck 0', () => {
    let result: { stages: Set<string>; stuck: number } | null = null;
    for (const seed of [2, 4, 6]) {
      const { s, baby } = family(seed, 'short');
      const stages = new Set<string>();
      for (let t = 0; t < 80 * 1440; t++) {
        s.tick();
        if (!s.persons.includes(baby)) break;
        stages.add(baby.lifeStage);
        if (baby.lifeStage === 'elder') break;
      }
      result = { stages, stuck: s.stats.stuckEvents };
      if (stages.has('elder')) break;
    }
    expect([...result!.stages]).toEqual(['baby', 'toddler', 'child', 'teen', 'young', 'adult', 'elder']);
    expect(result!.stuck).toBe(0);
  }, 120000);
});
