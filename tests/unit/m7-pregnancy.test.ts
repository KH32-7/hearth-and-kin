/**
 * M7 임신과 출산 (GDD 15-1, 15-2, 20-7, 29-1): 사망 설정 행렬, 수태, 단계 효과, 위험 판정, 진통 선택 대기와 의도,
 * 출산 결과, 교차 표 7행 재현, 유산/사산 비율 (현실적 6~12%, 보통 3~6%, 관대 0%), 판정기 기본 시스템
 */
import { describe, expect, it, vi } from 'vitest';
import pregJson from '../../src/data/pregnancy.json';
import deathJson from '../../src/data/death_rules.json';
import traitsJson from '../../src/data/traits.json';
import storyJson from '../../src/data/story.json';
import { Rng } from '../../src/sim/core/rng';
import { Person } from '../../src/sim/people/person';
import { DeathRules, parseDeathRules, type DeathPreset } from '../../src/sim/health/deathRules';
import {
  PregnancySystem,
  judgePregnancy,
  parsePregnancy,
  stateOf,
  type MidwifeOffer,
  type PregnancyHost,
  type PregStat,
} from '../../src/sim/family/pregnancy';
import type { StoryData } from '../../src/sim/data/simData';

const PD = parsePregnancy(pregJson)!;
const DD = parseDeathRules(deathJson)!;
const TRAITS = (traitsJson as { traits: Record<string, { effects?: Record<string, unknown> }> }).traits;

/** 앞에서부터 정해 둔 값을 먼저 내는 난수 (그다음은 시드 난수) */
class ScriptRng extends Rng {
  queue: number[] = [];
  next(): number {
    return this.queue.length ? this.queue.shift()! : super.next();
  }
}

class FakeHost implements PregnancyHost {
  persons: Person[] = [];
  rng: ScriptRng;
  today = 10;
  now = 10 * 1440;
  life = 1;
  ages = new Map<number, number>();
  rules: DeathRules;
  journey = new Set<number>();
  scene = new Set<number>();
  corvee = new Set<number>();
  quarantined = false;
  offer: MidwifeOffer | null = { person: null, skill: 5, fee: 24 };
  healer = false;
  cap = 8;
  purse = 1000;
  choosers = new Set<number>();
  log: string[] = [];
  moods = new Map<number, string[]>();
  stats: Record<string, number> = {};
  nextId = 1000;

  constructor(seed = 1, preset: DeathPreset = 'realistic') {
    this.rng = new ScriptRng(seed);
    this.rules = new DeathRules(DD, preset);
  }

  add(name: string, sex: 'male' | 'female', age: number, household = 5): Person {
    const p = new Person(this.nextId++, name, 0, 0);
    p.sex = sex;
    p.household = household;
    p.lifeStage = age < 18 ? 'teen' : 'adult';
    for (let i = 0; i < 8; i++) p.needs[i] = 80;
    p.skills = { medicine: 2 };
    this.ages.set(p.id, age);
    this.persons.push(p);
    return p;
  }

  couple(age = 25, household = 5): [Person, Person] {
    const w = this.add('앨리스', 'female', age, household);
    const h = this.add('톰', 'male', age + 2, household);
    w.spouse = h.id;
    h.spouse = w.id;
    return [w, h];
  }

  moodsOf(p: Person): string[] {
    return this.moods.get(p.id) ?? [];
  }

  day = () => this.today;
  minute = () => this.now;
  lifespan = () => this.life;
  age = (p: Person) => this.ages.get(p.id) ?? 0;
  season = () => 'summer';
  traitEffects = (t: string) => TRAITS[t]?.effects;
  controlled = (p: Person) => p.household === 1;
  chooses = (p: Person) => this.choosers.has(p.id);
  coitusToday = () => null;
  hasWish = () => false;
  addWish = (p: Person, id: string) => void this.log.push(`wish ${p.id} ${id}`);
  moodlet = (p: Person, id: string) => {
    this.moods.set(p.id, [...this.moodsOf(p), id]);
  };
  memory = (p: Person, kind: string, imp: number) => void this.log.push(`memory ${p.id} ${kind} ${imp}`);
  news = (kind: string) => void this.log.push(`news ${kind}`);
  notice = (p: Person, kind: string) => void this.log.push(`notice ${p.id} ${kind}`);
  chronicle = (id: string) => void this.log.push(`chronicle ${id}`);
  trauma = (p: Person) => void this.log.push(`trauma ${p.id}`);
  kill = (p: Person, cause: string) => {
    this.log.push(`kill ${p.id} ${cause}`);
    const i = this.persons.indexOf(p);
    if (i >= 0) this.persons.splice(i, 1);
  };
  birth = (m: Person, f: Person | null) => {
    const b = new Person(this.nextId++, `아기${this.nextId}`, 0, 0);
    b.lifeStage = 'baby';
    b.infant = true;
    b.household = m.household;
    b.mother = m.id;
    b.father = f?.id ?? 0;
    this.ages.set(b.id, 0);
    this.persons.push(b);
    this.log.push(`birth ${b.id}`);
    return b;
  };
  baptismDue = (b: Person) => void this.log.push(`baptism ${b.id}`);
  householdSize = (hh: number) => this.persons.filter((q) => q.household === hh).length;
  householdCap = () => this.cap;
  money = () => this.purse;
  spend = (_p: Person, n: number, why: string) => {
    if (this.purse < n) return false;
    this.purse -= n;
    this.log.push(`spend ${n} ${why}`);
    return true;
  };
  isOnJourney = (p: Person) => this.journey.has(p.id);
  isInScene = (p: Person) => this.scene.has(p.id);
  interruptScene = (p: Person, why: string) => {
    this.scene.delete(p.id);
    this.log.push(`interrupt ${p.id} ${why}`);
  };
  offerCard = (id: number, card: string) => {
    this.log.push(`card ${id} ${card}`);
    return true;
  };
  letter = (to: Person, kind: string) => void this.log.push(`letter ${to.id} ${kind}`);
  deathRules = () => this.rules;
  isCorveeDay = (p: Person) => this.corvee.has(p.id);
  corveeExempt = (p: Person, d: number) => void this.log.push(`exempt ${p.id} ${d}`);
  isQuarantined = () => this.quarantined;
  infectionRoll = (a: Person | null, b: Person, src: string) => void this.log.push(`infect ${a?.id ?? 0}->${b.id} ${src}`);
  midwife = () => (this.quarantined && !this.offer ? null : this.offer);
  healerPresent = () => this.healer;
  record = (k: PregStat, _p: Person, n = 1) => {
    this.stats[k] = (this.stats[k] ?? 0) + n;
  };
}

function setup(seed = 1, preset: DeathPreset = 'realistic') {
  const host = new FakeHost(seed, preset);
  const sys = new PregnancySystem(host, PD);
  return { host, sys };
}

/** 하루씩 넘기며 판정 */
function nextDay(host: FakeHost, sys: PregnancySystem): void {
  host.today++;
  host.now = host.today * 1440;
  sys.daily(host.today);
}

/** 임신을 후기(3단계) 끝 직전까지: 배경 위험을 끄고 진행 */
function toLate(host: FakeHost, sys: PregnancySystem, w: Person, h: Person | null): void {
  sys.begin(w, h, host.today);
  const g = stateOf(w)!;
  g.stage = 3;
  g.since = host.today - 2;
}

// ------------------------------------------------------------------ 사망 설정 행렬

describe('사망 설정 행렬 (20-7)', () => {
  it('프리셋 3개: 현실적 전부 켬, 보통은 출산 유산/사산만, 관대는 노환(노년)만', () => {
    const r = new DeathRules(DD);
    expect(r.preset).toBe('realistic');
    for (const c of ['illness', 'hunger', 'cold', 'accident', 'childbirth', 'combat', 'execution']) for (const g of ['child', 'adult', 'elder'] as const) expect(r.allows(c, g)).toBe(true);
    expect(r.allows('old_age', 'adult')).toBe(false);
    expect(r.allows('old_age', 'elder')).toBe(true);
    expect(r.subChance('combat', 'brawl')).toBeCloseTo(0.2);

    const n = new DeathRules(DD, 'normal');
    expect(n.allows('childbirth', 'adult', 'loss')).toBe(true);
    expect(n.allows('childbirth', 'adult', 'maternal')).toBe(false);
    expect(n.allows('childbirth', 'child', 'infant')).toBe(false);
    expect(n.allows('hunger', 'adult')).toBe(false);
    expect(n.allows('hunger', 'elder')).toBe(true);
    expect(n.allows('accident', 'child')).toBe(false);
    expect(n.allows('accident', 'adult')).toBe(true);
    expect(n.allows('combat', 'adult', 'duel')).toBe(true);
    expect(n.allows('combat', 'adult', 'bandit')).toBe(false);
    expect(n.allows('execution', 'adult')).toBe(false);

    const l = new DeathRules(DD, 'lenient');
    for (const c of ['illness', 'hunger', 'cold', 'accident', 'childbirth', 'combat', 'execution']) for (const g of ['child', 'adult', 'elder'] as const) expect(l.allows(c, g)).toBe(false);
    expect(l.allows('old_age', 'elder')).toBe(true);
  });

  it('원인 별칭, 나이 그룹, 꺼진 칸 대체 결과, 설정 의도 (프리셋 / 칸 → custom)', () => {
    const r = new DeathRules(DD);
    expect(r.cause('cold_hunger')).toBe('hunger');
    expect(r.cause('duel')).toBe('combat');
    expect(r.group('teen')).toBe('child');
    expect(r.group('young', 17)).toBe('child');
    expect(r.group('adult')).toBe('adult');
    expect(r.group('elder')).toBe('elder');
    expect(r.fallback('childbirth', 'adult')?.kind).toBe('difficult_birth');
    expect(r.fallback('childbirth', 'adult')?.recoveryMult).toBe(2);
    expect(r.fallback('accident', 'child')?.kind).toBe('injury');
    expect(r.fallback('execution', 'adult')?.kind).toBe('exile_or_prison');
    expect(r.fallback('illness', 'adult')?.kind).toBe('critical_then_recover');
    r.apply({ kind: 'setDeathRules', cells: { childbirth: [false, true, true] } });
    expect(r.preset).toBe('custom');
    expect(r.allows('childbirth', 'child')).toBe(false);
    r.apply({ kind: 'setDeathRules', preset: 'lenient' });
    expect(r.preset).toBe('lenient');
    r.apply({ kind: 'setDeathRules', preset: 'realistic' });
    r.apply({ kind: 'setDeathRules', subs: { combat: { brawl: 0.2 } } });
    expect(r.preset).toBe('realistic');
    const saved = r.save();
    const r2 = new DeathRules(DD, 'lenient');
    r2.load(saved);
    expect(r2.preset).toBe('realistic');
  });
});

// ------------------------------------------------------------------ 수태

describe('수태 (15-1, 29-2)', () => {
  const rate = (opts: { age?: number; wants?: 'yes' | 'any' | 'no'; feedback?: number; household?: number; weakened?: boolean }) => {
    const { host, sys } = setup(7);
    const N = 3000;
    const ws: Person[] = [];
    for (let i = 0; i < N; i++) {
      const [w] = host.couple(opts.age ?? 25, opts.household ?? 100 + i);
      w.wantsKids = opts.wants ?? 'yes';
      w.weakened = !!opts.weakened;
      ws.push(w);
    }
    sys.conceive(host.today, opts.feedback ?? 1);
    return ws.filter((w) => w.pregnancy).length / N;
  };

  it('원함 = 동침 1회 18%, 상관없음 < 원함, 원치 않음은 크게 감소', () => {
    expect(rate({ wants: 'yes' })).toBeGreaterThan(0.15);
    expect(rate({ wants: 'yes' })).toBeLessThan(0.21);
    expect(rate({ wants: 'any' })).toBeLessThan(rate({ wants: 'yes' }));
    expect(rate({ wants: 'no' })).toBeLessThan(0.03);
  });

  it('40세부터 감소, 45세 넘으면 없음, 16세 미만 없음, 쇠약하면 감소', () => {
    expect(rate({ age: 44 })).toBeLessThan(rate({ age: 30 }) * 0.7);
    expect(rate({ age: 47 })).toBe(0);
    expect(rate({ age: 15 })).toBe(0);
    expect(rate({ weakened: true })).toBeLessThan(rate({}) * 0.7);
  });

  it('인구 피드백: 마을 가구에만, 조작 가문(가구 1)은 무시', () => {
    expect(rate({ feedback: 0.2 })).toBeLessThan(0.06);
    expect(rate({ feedback: 0.2, household: 1 })).toBeGreaterThan(0.15);
  });

  it('출산 뒤 쉬는 날(birthCooldown), 배우자가 다른 가구면 없음', () => {
    const { host, sys } = setup(3);
    const [w, h] = host.couple();
    host.rng.queue = [0, 0.99, 0.99];
    toLate(host, sys, w, h);
    sys.startLabor(w);
    expect(w.pregnancy).toBeNull();
    host.rng.queue = [0];
    sys.conceive(host.today + 1, 1);
    expect(w.pregnancy).toBeNull();
    h.household = 99;
    host.rng.queue = [0];
    sys.conceive(host.today + 10, 1);
    expect(w.pregnancy).toBeNull();
  });
});

// ------------------------------------------------------------------ 단계 효과

describe('임신 3단계 효과 (15-1)', () => {
  it('초기 입덧 → 중기 배 1, 에너지 1.2배, 음식 당김 → 후기 배 2, 이동 -30%, 노동 불가, 편안 2배 → 진통', () => {
    const { host, sys } = setup(11);
    const [w, h] = host.couple();
    sys.begin(w, h, host.today);
    expect(sys.bellyStage(w)).toBe(0);
    expect(sys.needDecayMult(w, 'energy')).toBe(1);
    expect(sys.canWork(w)).toBe(true);
    // 아침 입덧: 방광/배고픔 급변 + 속 울렁임, 증상으로 알게 됨
    host.rng.queue = [0];
    expect(sys.onWake(w)).toBe(true);
    expect(w.need('bladder')).toBe(55);
    expect(w.need('hunger')).toBe(60);
    expect(host.moodsOf(w)).toContain('morning_sickness');
    expect(stateOf(w)!.known).toBe(true);

    host.rng.queue = [0.99, 0];
    nextDay(host, sys);
    expect(stateOf(w)!.stage).toBe(2);
    expect(sys.bellyStage(w)).toBe(1);
    expect(sys.needDecayMult(w, 'energy')).toBeCloseTo(1.2);
    expect(sys.needDecayMult(w, 'comfort')).toBe(1);
    expect(host.moodsOf(w)).toContain('pregnancy_glow');
    expect(host.moodsOf(w)).toContain('pregnancy_craving');
    expect(host.log.some((l) => l.startsWith(`wish ${w.id} wish_`))).toBe(true);

    host.rng.queue = [0.99];
    nextDay(host, sys);
    expect(stateOf(w)!.stage).toBe(3);
    expect(sys.bellyStage(w)).toBe(2);
    expect(sys.moveMult(w)).toBeCloseTo(0.7);
    expect(sys.canWork(w)).toBe(false);
    expect(sys.needDecayMult(w, 'comfort')).toBe(2);
    expect(host.moodsOf(w)).toContain('heavy_belly');

    // 진통 → (NPC) 바로 출산
    host.rng.queue = [0.99, 0.99, 0.99];
    nextDay(host, sys);
    expect(w.pregnancy).toBeNull();
    expect(host.stats.birth).toBe(1);
    expect(host.moodsOf(w)).toContain('labor_pains');
    expect(host.moodsOf(w)).toContain('newborn_joy');
    expect(host.moodsOf(h)).toContain('newborn_joy');
    expect(host.log).toContain('chronicle birth');
    expect(host.log.some((l) => l.startsWith('baptism '))).toBe(true);
  });

  it('수명 배수 2 → 단계 길이 2일', () => {
    const { host, sys } = setup(12);
    host.life = 2;
    const [w, h] = host.couple();
    sys.begin(w, h, host.today);
    host.rng.queue = [0.99];
    nextDay(host, sys);
    expect(stateOf(w)!.stage).toBe(1);
    host.rng.queue = [0.99];
    nextDay(host, sys);
    expect(stateOf(w)!.stage).toBe(2);
  });

  it('쌍둥이 3% + 쌍둥이 체질 +10% (traits.json twinsBonus)', () => {
    const count = (trait: boolean) => {
      const { host, sys } = setup(21);
      const N = 2000;
      let twins = 0;
      for (let i = 0; i < N; i++) {
        const [w, h] = host.couple(25, 200 + i);
        if (trait) w.traits.push('twin_blood');
        toLate(host, sys, w, h);
        const before = host.stats.birth ?? 0;
        sys.startLabor(w);
        if ((host.stats.birth ?? 0) - before === 2) twins++;
      }
      return twins / N;
    };
    const base = count(false);
    const blood = count(true);
    expect(base).toBeGreaterThan(0.015);
    expect(base).toBeLessThan(0.05);
    expect(blood).toBeGreaterThan(0.1);
    expect(blood).toBeLessThan(0.17);
  });
});

// ------------------------------------------------------------------ 위험 판정

describe('위험 판정 (15-1)', () => {
  it('결과 분포가 데이터 확률을 따름 (낙상: 유산 8% / 조산 10% / 합병증 20%)', () => {
    const { host, sys } = setup(31);
    const out: Record<string, number> = { none: 0, complication: 0, premature: 0, loss: 0 };
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const [w, h] = host.couple(25, 300 + i);
      sys.begin(w, h, host.today);
      stateOf(w)!.stage = 2;
      out[sys.riskEvent(w, 'fall').outcome]++;
    }
    const f = PD.risk.events.fall;
    expect(out.loss / N).toBeCloseTo(f.loss, 1);
    expect(out.premature / N).toBeCloseTo(f.premature, 1);
    expect(out.complication / N).toBeCloseTo(f.complication, 1);
  });

  it('합병증 → 불안한 태동 + 난산 확률 증가, 조산 → 바로 진통 + 조산 걱정, 유산 → 부모 모두 기억(중요도 5)·슬픔·연대기', () => {
    const { host, sys } = setup(32);
    const [w, h] = host.couple();
    sys.begin(w, h, host.today);
    stateOf(w)!.stage = 2;
    const f = PD.risk.events.fall;
    host.rng.queue = [f.loss + f.premature + 0.001];
    const before = sys.deliveryOdds(w, 'family', 0, false);
    expect(sys.riskEvent(w, 'fall').outcome).toBe('complication');
    expect(host.moodsOf(w)).toContain('uneasy_kicks');
    expect(sys.deliveryOdds(w, 'family', 0, false).danger).toBeGreaterThan(before.danger);

    // 조산 (중기): 남은 단계를 건너뛰고 진통 → 출산
    host.rng.queue = [f.loss + 0.001, 0.99, 0.99, 0.99, 0.0];
    expect(sys.riskEvent(w, 'fall').outcome).toBe('premature');
    expect(host.moodsOf(w)).toContain('premature_worry');
    expect(w.pregnancy).toBeNull();
    expect(host.stats.birth).toBe(1);

    // 유산
    const [w2, h2] = host.couple(25, 6);
    sys.begin(w2, h2, host.today);
    host.rng.queue = [0, 0.99, 0.99, 0.99];
    expect(sys.riskEvent(w2, 'illness').outcome).toBe('loss');
    expect(w2.pregnancy).toBeNull();
    expect(host.moodsOf(w2)).toContain('lost_child_grief');
    expect(host.moodsOf(h2)).toContain('lost_child_grief');
    expect(host.log).toContain(`memory ${w2.id} lost_child 5`);
    expect(host.log).toContain(`memory ${h2.id} lost_child 5`);
    expect(host.log).toContain('chronicle miscarriage');
    expect(host.log).toContain('news miscarriage');

    // 후기 유산 = 사산
    const [w3, h3] = host.couple(25, 7);
    toLate(host, sys, w3, h3);
    host.rng.queue = [0, 0.99, 0.99, 0.99];
    expect(sys.riskEvent(w3, 'shock').outcome).toBe('loss');
    expect(host.log).toContain('chronicle stillbirth');
    expect(host.log).toContain('news stillbirth');
  });

  it('사망 설정 "출산" 칸 끔 (관대) → 위험 판정은 합병증까지만', () => {
    const { host, sys } = setup(33, 'lenient');
    let loss = 0;
    let capped = 0;
    for (let i = 0; i < 2000; i++) {
      const [w, h] = host.couple(25, 400 + i);
      sys.begin(w, h, host.today);
      stateOf(w)!.stage = 2;
      const r = sys.riskEvent(w, 'fall');
      if (r.outcome === 'loss' || r.outcome === 'premature') loss++;
      if (r.capped) capped++;
    }
    expect(loss).toBe(0);
    expect(capped).toBeGreaterThan(0);
  });

  it('16세 미만 위험 없음, 35세 이상 가중', () => {
    const { host, sys } = setup(34);
    const [w, h] = host.couple(15);
    sys.begin(w, h, host.today);
    expect(sys.riskEvent(w, 'fall').outcome).toBe('none');
    const [a, ha] = host.couple(25, 8);
    const [b, hb] = host.couple(38, 9);
    sys.begin(a, ha, host.today);
    sys.begin(b, hb, host.today);
    expect(sys.lossChanceToday(b, stateOf(b)!)).toBeCloseTo(sys.lossChanceToday(a, stateOf(a)!) * PD.risk.ageMult, 5);
  });

  it('굶주림 (배고픔 10 미만 또는 쇠약) → 하루 판정에서 위험 사건', () => {
    const { host, sys } = setup(35);
    const [w, h] = host.couple();
    sys.begin(w, h, host.today);
    w.setNeed('hunger', 5);
    const spy = vi.spyOn(sys, 'riskEvent');
    nextDay(host, sys);
    expect(spy).toHaveBeenCalledWith(w, 'hunger');
  });
});

// ------------------------------------------------------------------ 진통 선택과 출산 결과

describe('진통 선택 대기와 출산 결과 (15-2)', () => {
  it('조작 가문: 선택 대기 + 진통 카드 → 의도 laborChoice(산파) → 산파 삯, 출산', () => {
    const { host, sys } = setup(41);
    const [w, h] = host.couple(25, 1);
    host.choosers.add(w.id);
    toLate(host, sys, w, h);
    host.rng.queue = [0.99];
    nextDay(host, sys);
    expect(sys.laborPending(w)).not.toBeNull();
    expect(host.log).toContain(`card ${w.id} labor_starts`);
    expect(sys.bellyStage(w)).toBe(2);
    expect(sys.canWork(w)).toBe(false);
    host.rng.queue = [0.99, 0.99, 0.99];
    const r = sys.chooseLabor(w, 'midwife')!;
    expect(r.attendant).toBe('midwife');
    expect(r.outcome).toBe('easy');
    expect(host.log).toContain('spend 24 midwife');
    expect(w.pregnancy).toBeNull();
    // 이미 끝난 진통에 또 선택하면 무시
    expect(sys.chooseLabor(w, 'alone')).toBeNull();
  });

  it('시간 초과 → 자동 선택 (돈 있으면 산파, 없으면 가족, 식구도 없으면 혼자)', () => {
    const { host, sys } = setup(42);
    const [w, h] = host.couple(25, 1);
    host.choosers.add(w.id);
    toLate(host, sys, w, h);
    host.rng.queue = [0.99];
    nextDay(host, sys);
    host.now += 60;
    sys.tick();
    expect(sys.laborPending(w)).not.toBeNull();
    host.now += 61;
    host.rng.queue = [0.99, 0.99, 0.99];
    sys.tick();
    expect(w.pregnancy).toBeNull();
    expect(host.log).toContain('spend 24 midwife');

    host.purse = 0;
    const [w2, h2] = host.couple(25, 2);
    toLate(host, sys, w2, h2);
    expect(sys.autoOption(w2)).toBe('family');
    h2.household = 3;
    expect(sys.autoOption(w2)).toBe('alone');
  });

  it('받는 사람 의술·준비물(깨끗한 천, 끓인 물)·산모 건강이 위험을 줄임', () => {
    const { host, sys } = setup(43);
    const [w, h] = host.couple();
    sys.begin(w, h, host.today);
    const alone = sys.deliveryOdds(w, 'alone', 0, false).danger;
    const fam = sys.deliveryOdds(w, 'family', 0, false).danger;
    const mid = sys.deliveryOdds(w, 'midwife', 6, false).danger;
    expect(mid).toBeLessThan(fam);
    expect(fam).toBeLessThan(alone);
    sys.onInteractionDone(w, 'preg.prepare_birth');
    expect(stateOf(w)!.prep).toEqual(expect.arrayContaining(['cloth', 'water']));
    expect(sys.deliveryOdds(w, 'family', 0, false).danger).toBeLessThan(fam);
    w.weakened = true;
    expect(sys.deliveryOdds(w, 'family', 0, false).danger).toBeGreaterThan(fam);
  });

  it('위험 결과: 아기가 먼저 나온 뒤 산모 사망 (현실적), 보통 프리셋에서는 산모 사망 대신 난산', () => {
    const { host, sys } = setup(44);
    const [w, h] = host.couple();
    toLate(host, sys, w, h);
    // 쌍둥이 아님, 위험, 산모 사망, 아기 생존
    host.rng.queue = [0.99, 0, 0, 0.99];
    sys.startLabor(w);
    expect(host.log.filter((l) => l.startsWith('birth ')).length).toBe(1);
    expect(host.log).toContain(`kill ${w.id} childbirth`);
    expect(host.log.indexOf(`kill ${w.id} childbirth`)).toBeGreaterThan(host.log.findIndex((l) => l.startsWith('birth ')));
    expect(host.moodsOf(h)).toContain('lost_in_childbirth');
    expect(host.log).toContain('chronicle death_childbirth');
    expect(host.stats.maternal_death).toBe(1);

    const n = setup(44, 'normal');
    const [w2, h2] = n.host.couple();
    toLate(n.host, n.sys, w2, h2);
    n.host.rng.queue = [0.99, 0];
    n.sys.startLabor(w2);
    expect(n.host.log.some((l) => l.startsWith(`kill ${w2.id}`))).toBe(false);
    expect(n.host.moodsOf(w2)).toContain('difficult_birth_recovery');
    expect(n.host.moodsOf(w2)).toContain('uneasy_kicks');
    // 대체 결과: 회복 기간 2배 (2일 × 2)
    expect(n.sys.recovery.get(w2.id)?.until).toBe(n.host.today + 4);
  });

  it('위험 결과의 아기 사망 (현실적) → 부모 슬픔, 연대기 child_death', () => {
    const { host, sys } = setup(45);
    const [w, h] = host.couple();
    toLate(host, sys, w, h);
    host.rng.queue = [0.99, 0, 0.99, 0];
    const births = () => host.log.filter((l) => l.startsWith('birth ')).length;
    sys.startLabor(w);
    expect(births()).toBe(1);
    expect(host.stats.infant_death).toBe(1);
    expect(host.log).toContain('chronicle child_death');
    expect(host.moodsOf(h)).toContain('lost_child_grief');
  });
});

// ------------------------------------------------------------------ 교차 표 7행 (15-1, BRIEF M7 통과 조건)

describe('임신 상태 교차 표 (15-1)', () => {
  it('1행: 산모가 임신 중 사망 → 후기 기적의 출산 (치유사 50% / 없음 20%), 초기·중기는 태아도 사망, 출산 칸 끄면 항상 기적', () => {
    // 후기 + 치유사: 0.4 < 0.5 → 아기 생존
    let t = setup(51);
    let [w, h] = t.host.couple();
    toLate(t.host, t.sys, w, h);
    t.host.healer = true;
    t.host.rng.queue = [0.4];
    expect(t.sys.onMotherDeath(w, 'illness')?.kind).toBe('miracle');
    expect(t.host.log).toContain('chronicle miracle_birth');
    expect(w.pregnancy).toBeNull();
    // 후기 + 치유사 없음: 0.4 ≥ 0.2 → 함께 사망
    t = setup(52);
    [w, h] = t.host.couple();
    toLate(t.host, t.sys, w, h);
    t.host.rng.queue = [0.4];
    expect(t.sys.onMotherDeath(w, 'accident')?.kind).toBe('fetus_died');
    expect(t.host.stats.loss).toBe(1);
    // 치유사 없음이라도 0.1 < 0.2 → 기적
    t = setup(53);
    [w, h] = t.host.couple();
    toLate(t.host, t.sys, w, h);
    t.host.rng.queue = [0.1];
    expect(t.sys.onMotherDeath(w, 'accident')?.kind).toBe('miracle');
    // 초기: 태아도 사망 (판정 없음)
    t = setup(54);
    [w, h] = t.host.couple();
    t.sys.begin(w, h, t.host.today);
    t.host.healer = true;
    t.host.rng.queue = [0];
    expect(t.sys.onMotherDeath(w, 'illness')?.kind).toBe('fetus_died');
    // 출산 칸 끔: 초기라도 항상 기적의 출산
    t = setup(55, 'lenient');
    [w, h] = t.host.couple();
    t.sys.begin(w, h, t.host.today);
    t.host.rng.queue = [0.99];
    expect(t.sys.onMotherDeath(w, 'old_age')?.kind).toBe('miracle');
  });

  it('2행: 농노 부역일 → 후기 면제 (영주 호의 소폭 하락), 초기·중기는 부역하되 과로 판정', () => {
    const { host, sys } = setup(56);
    const [late, h1] = host.couple(25, 10);
    const [early, h2] = host.couple(25, 11);
    toLate(host, sys, late, h1);
    stateOf(late)!.since = host.today; // 오늘 진통이 오지 않게
    sys.begin(early, h2, host.today);
    host.corvee.add(late.id);
    host.corvee.add(early.id);
    const spy = vi.spyOn(sys, 'riskEvent');
    nextDay(host, sys);
    expect(host.log).toContain(`exempt ${late.id} ${PD.corvee.lordFavorDelta}`);
    expect(PD.corvee.lordFavorDelta).toBeLessThan(0);
    expect(spy).toHaveBeenCalledWith(early, 'overwork');
    expect(spy).not.toHaveBeenCalledWith(late, 'overwork');
    expect(host.log).not.toContain(`exempt ${early.id} ${PD.corvee.lordFavorDelta}`);
  });

  it('3행: 역병 격리 중 진통 → 산파 삯 2배 + 산파·산모 감염 판정, 산파가 못 오면 가족이 받음', () => {
    const { host, sys } = setup(57);
    host.quarantined = true;
    const mw = host.add('산파 마사', 'female', 50, 70);
    host.offer = { person: mw, skill: 6, fee: 24 };
    const [w, h] = host.couple(25, 1);
    host.choosers.add(w.id);
    toLate(host, sys, w, h);
    sys.startLabor(w);
    expect(sys.laborPending(w)!.quarantine).toBe(true);
    host.rng.queue = [0.99, 0.99, 0.99];
    const r = sys.chooseLabor(w, 'midwife')!;
    expect(r.attendant).toBe('midwife');
    expect(host.log).toContain('spend 48 midwife');
    expect(host.log).toContain(`infect ${mw.id}->${w.id} labor`);
    expect(host.log).toContain(`infect ${w.id}->${mw.id} labor`);

    // 산파가 오지 않음 → 가족이 받기
    const [w2, h2] = host.couple(25, 2);
    host.choosers.add(w2.id);
    host.offer = null;
    toLate(host, sys, w2, h2);
    sys.startLabor(w2);
    host.rng.queue = [0.99, 0.99, 0.99];
    const r2 = sys.chooseLabor(w2, 'midwife')!;
    expect(r2.attendant).toBe('family');
    expect(host.log).toContain(`notice ${w2.id} midwife_not_coming`);
  });

  it('4행: 배우자 여정/전쟁 중 진통 → 조기 귀가 카드, 못 돌아오면 "출산 소식" 편지 (돌아오면 편지 없음)', () => {
    const { host, sys } = setup(58);
    const [w, h] = host.couple(25, 1);
    host.choosers.add(w.id);
    host.journey.add(h.id);
    toLate(host, sys, w, h);
    sys.startLabor(w);
    expect(host.log).toContain(`card ${h.id} labor_call_spouse_home`);
    host.rng.queue = [0.99, 0.99, 0.99];
    const r = sys.chooseLabor(w, 'family')!;
    expect(r.letterSent).toBe(true);
    expect(host.log).toContain(`letter ${h.id} birth_news`);

    // 귀가 카드로 돌아옴 → 편지 없음
    const [w2, h2] = host.couple(25, 2);
    host.choosers.add(w2.id);
    host.journey.add(h2.id);
    toLate(host, sys, w2, h2);
    sys.startLabor(w2);
    host.journey.delete(h2.id);
    host.rng.queue = [0.99, 0.99, 0.99];
    expect(sys.chooseLabor(w2, 'family')!.letterSent).toBe(false);
    expect(host.log).not.toContain(`letter ${h2.id} birth_news`);
  });

  it('5행: 출생으로 가정 인원 상한 초과 → 출생·쌍둥이 항상 허용 + 비좁음 무드렛 + 분가/해고 알림', () => {
    const { host, sys } = setup(59);
    host.cap = 8;
    const [w, h] = host.couple(25, 20);
    for (let i = 0; i < 6; i++) host.add(`식구${i}`, 'male', 20, 20);
    expect(host.householdSize(20)).toBe(8);
    toLate(host, sys, w, h);
    // 쌍둥이 (0 < 3%), 순산
    host.rng.queue = [0, 0.99, 0.99, 0.99];
    sys.startLabor(w);
    expect(host.householdSize(20)).toBe(10);
    expect(host.stats.birth).toBe(2);
    expect(host.moodsOf(h)).toContain('cramped_house');
    expect(host.moodsOf(w)).toContain('twins_overwhelmed');
    expect(host.log).toContain(`notice ${w.id} household_over_cap`);
  });

  it('6행: 산모가 이미 장면 중(재판 등) → 그 장면을 끊고 출산 장면이 먼저', () => {
    const { host, sys } = setup(60);
    const [w, h] = host.couple(25, 1);
    host.choosers.add(w.id);
    host.scene.add(w.id);
    toLate(host, sys, w, h);
    host.rng.queue = [0.99];
    nextDay(host, sys);
    expect(host.log).toContain(`interrupt ${w.id} labor`);
    expect(host.log.indexOf(`interrupt ${w.id} labor`)).toBeLessThan(host.log.indexOf(`card ${w.id} labor_starts`));
    expect(sys.laborPending(w)!.interruptedScene).toBe(true);
    expect(host.isInScene(w)).toBe(false);
  });

  it('7행: 난산 회복 2일 (lifespan) < 아기 단계 3일, 회복 중 에너지 제한', () => {
    const { host, sys } = setup(61);
    const [w, h] = host.couple();
    host.choosers.add(w.id);
    toLate(host, sys, w, h);
    sys.startLabor(w);
    const day0 = host.today;
    // 쌍둥이 아님, 난산 (위험 < r < 위험+난산)
    const o = sys.deliveryOdds(w, 'family', 2, false);
    host.rng.queue = [0.99, o.danger + 0.01, 0.99];
    const r = sys.chooseLabor(w, 'family')!;
    expect(r.outcome).toBe('difficult');
    expect(host.moodsOf(w)).toContain('difficult_birth_recovery');
    const rec = sys.recovery.get(w.id)!;
    const babyDays = (storyJson as unknown as StoryData).stageDays.baby;
    expect(rec.until - day0).toBe(2);
    expect(rec.until - day0).toBeLessThan(babyDays);
    expect(sys.energyCap(w)).toBe(PD.delivery.recoveryEnergyCap);
    host.today = day0 + 1;
    sys.daily(host.today);
    expect(sys.recovering(w)).toBe(true);
    host.today = day0 + 2;
    sys.daily(host.today);
    expect(sys.recovering(w)).toBe(false);
    expect(sys.energyCap(w)).toBe(100);
    // 수명 배수 2: 회복 4일 < 아기 6일
    const t = setup(62);
    t.host.life = 2;
    const [w2, h2] = t.host.couple();
    t.host.choosers.add(w2.id);
    toLate(t.host, t.sys, w2, h2);
    t.sys.startLabor(w2);
    const o2 = t.sys.deliveryOdds(w2, 'family', 2, false);
    t.host.rng.queue = [0.99, o2.danger + 0.01, 0.99];
    expect(t.sys.chooseLabor(w2, 'family')!.outcome).toBe('difficult');
    expect(t.sys.recovery.get(w2.id)!.until - t.host.today).toBe(4);
    expect(4).toBeLessThan(babyDays * 2);
  });
});

// ------------------------------------------------------------------ 상호작용

describe('임신 상호작용 (15-1)', () => {
  it('보일 조건: 알리기는 본인·알게 된 뒤·아직 안 알렸을 때, 배 쓰다듬기는 중기부터, 출산 준비는 후기 식구, 산파는 역할', () => {
    const { host, sys } = setup(71);
    const [w, h] = host.couple();
    const mw = host.add('산파', 'female', 50, 70);
    mw.role = 'midwife';
    sys.begin(w, h, host.today);
    expect(sys.interactionAllowed(w, 'social.tell_pregnancy', h)).toBe(false);
    sys.onInteractionDone(w, 'social.visit_midwife', mw);
    expect(stateOf(w)!.known).toBe(true);
    expect(sys.interactionAllowed(w, 'social.visit_midwife', mw)).toBe(true);
    expect(sys.interactionAllowed(w, 'social.visit_midwife', h)).toBe(false);
    expect(sys.interactionAllowed(w, 'social.tell_pregnancy', h)).toBe(true);
    sys.onInteractionDone(w, 'social.tell_pregnancy', h);
    expect(sys.interactionAllowed(w, 'social.tell_pregnancy', h)).toBe(false);
    expect(sys.interactionAllowed(h, 'social.rub_belly', w)).toBe(false);
    stateOf(w)!.stage = 2;
    expect(sys.interactionAllowed(h, 'social.rub_belly', w)).toBe(true);
    expect(sys.interactionAllowed(h, 'preg.make_cradle')).toBe(true);
    expect(sys.interactionAllowed(h, 'preg.prepare_birth')).toBe(false);
    stateOf(w)!.stage = 3;
    expect(sys.interactionAllowed(h, 'preg.prepare_birth')).toBe(true);
    sys.onInteractionDone(h, 'preg.make_cradle');
    sys.onInteractionDone(h, 'social.book_midwife', mw);
    expect(stateOf(w)!.prep).toEqual(expect.arrayContaining(['cradle', 'midwifeBooked']));
    // 다른 집 사람은 안 됨
    const other = host.add('남', 'male', 30, 99);
    expect(sys.interactionAllowed(other, 'preg.make_cradle')).toBe(false);
    // 모르는 상호작용은 막지 않음
    expect(sys.interactionAllowed(other, 'hearth.cook_stew')).toBe(true);
  });

  it('상호작용 데이터: 기존 스키마, 물건 id 가 카탈로그/물건에 있음, 무드렛 id 가 있음', async () => {
    const { loadSimData } = await import('../../tools/data-node');
    const data = loadSimData({});
    for (const [id, ia] of Object.entries(PD.interactions)) {
      expect(data.interactions[id], id).toBeTruthy();
      for (const o of ia.objects) expect(data.objects[o], `${id} ${o}`).toBeTruthy();
    }
    for (const id of Object.keys(PD.social)) expect((data.social as Record<string, unknown>)[id], id).toBeTruthy();
    expect(data.objects[PD.cradleObject]).toBeTruthy();
    const moods = data.inner!.moodlets;
    const ids = [
      PD.risk.complicationMoodlet,
      PD.risk.prematureMoodlet,
      PD.loss.moodlet,
      PD.labor.moodlet,
      ...Object.values(PD.delivery.moodlets),
      ...PD.stages.flatMap((s) => [...s.enterMoodlets, ...(s.dailyMoodlets ?? []), s.wake?.moodlet ?? '', s.craving?.moodlet ?? '']).filter(Boolean),
    ];
    for (const m of ids) expect(moods.has(m), m).toBe(true);
  }, 60000);
});

// ------------------------------------------------------------------ 유산/사산 비율 (29-1)

describe('유산/사산 비율 (29-1)', () => {
  /** 시드 여러 개 × 임신 여러 건을 하루 판정으로 끝까지 (나이 18~40 고르게, 배불리 먹음) */
  const lossRate = (preset: DeathPreset) => {
    const out = rateOf(preset);
    if (process.env.PREG_PRINT) console.log(preset, out);
    return out;
  };
  const rateOf = (preset: DeathPreset) => {
    let preg = 0;
    let loss = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const { host, sys } = setup(seed, preset);
      for (let i = 0; i < 60; i++) {
        const age = 18 + host.rng.int(23);
        const [w, h] = host.couple(age, 1000 + i);
        sys.begin(w, h, host.today);
      }
      for (let d = 0; d < 6; d++) nextDay(host, sys);
      preg += host.stats.pregnancy ?? 0;
      loss += host.stats.loss ?? 0;
      expect(host.persons.some((p) => p.pregnancy)).toBe(false);
    }
    return loss / preg;
  };

  it('현실적 6~12%, 보통 3~6%, 관대 0%', () => {
    const r = lossRate('realistic');
    expect(r).toBeGreaterThanOrEqual(0.06);
    expect(r).toBeLessThanOrEqual(0.12);
    const n = lossRate('normal');
    expect(n).toBeGreaterThanOrEqual(0.03);
    expect(n).toBeLessThanOrEqual(0.06);
    expect(lossRate('lenient')).toBe(0);
  });
});

// ------------------------------------------------------------------ 판정기 기본 시스템

describe('판정기 연결 (lifeJudge)', () => {
  it('host.pregnancy 가 없으면 story.json 수치로 예전과 같은 판정 (단계당 lossChance/3, 산모 사망 maternalDeath), 통계는 판정기로', () => {
    const story = storyJson as unknown as StoryData;
    const persons: Person[] = [];
    let next = 1;
    const log: string[] = [];
    const jh = {
      persons,
      rng: new Rng(5),
      day: () => 50,
      news: (k: string) => void log.push(k),
      moodlet: () => {},
      kill: (p: Person) => void persons.splice(persons.indexOf(p), 1),
      birth: (m: Person) => {
        const b = new Person(next++, 'b', 0, 0);
        b.household = m.household;
        b.infant = true;
        b.lifeStage = 'baby';
        persons.push(b);
        return b;
      },
    };
    const stats = { births: 0, deaths: 0, deathsByCause: {} as Record<string, number>, deathsUnder18: 0, pregnancies: 0, losses: 0 };
    const bind = { stats, lastBirth: new Map<number, number>(), stageDeaths: {}, age: () => 25 };
    const sys = judgePregnancy(jh, story, bind);
    expect(judgePregnancy(jh, story, bind)).toBe(sys);
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const w = new Person(next++, 'w', 0, 0);
      w.sex = 'female';
      w.household = 100 + i;
      for (let k = 0; k < 8; k++) w.needs[k] = 80;
      persons.push(w);
      sys.begin(w, null, 50);
    }
    for (let d = 51; d <= 54; d++) sys.daily(d);
    expect(stats.pregnancies).toBe(N);
    const lossRate = stats.losses / N;
    const expected = 1 - Math.pow(1 - story.pregnancy.lossChance / 3, 3);
    expect(lossRate).toBeGreaterThan(expected - 0.02);
    expect(lossRate).toBeLessThan(expected + 0.02);
    const births = N - stats.losses;
    expect(stats.births).toBeGreaterThanOrEqual(births);
    expect(stats.deathsByCause.childbirth / births).toBeGreaterThan(story.pregnancy.maternalDeath - 0.015);
    expect(stats.deathsByCause.childbirth / births).toBeLessThan(story.pregnancy.maternalDeath + 0.015);
    expect(bind.lastBirth.size).toBeGreaterThan(0);
  });
});
