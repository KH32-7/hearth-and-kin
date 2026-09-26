/**
 * M8 신분 (GDD 16-2 두 층 규칙 표 11행, 16-3 상승/하락 경로, 17-4 큰 비용 역산, 17-7 영지 수입, 18-4 영주 금고).
 * 가짜 Host 로 순수 판정(plan*)과 실행(apply)을 확인. BRIEF M8 통과 조건: "신분 두 층 규칙 표(16-2) 각 행 유닛 테스트"
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/core/rng';
import { Estates, parseEstates, type EstateId, type EstatePerson, type EstatesHost } from '../../src/sim/house/estates';
import { FiefSystem, parseFief, type FiefHost } from '../../src/sim/house/fief';
import { FAMILY_FILES } from '../../src/sim/data/familyFiles';
import type { LifeStage } from '../../src/sim/people/person';

const raw = JSON.parse(readFileSync('src/data/estates.json', 'utf8'));
const econ = JSON.parse(readFileSync('src/data/economy.json', 'utf8'));
const D = parseEstates(raw)!;
/** S (동화) = 일 순수입 목표 × 48 */
const S = (e: EstateId): number => econ.estates[e].target.net * econ.presets.savingsDays;

interface FP extends EstatePerson {
  name: string;
  age: number;
}

class World {
  persons: FP[] = [];
  hhEstate = new Map<number, EstateId>();
  heads = new Map<number, number>();
  money = new Map<number, number>();
  favor = new Map<number, number>();
  fameTier = new Map<number, string>();
  fame = new Map<number, number>();
  skills = new Map<number, number>();
  squires = new Set<number>();
  feats = new Set<number>();
  log: string[] = [];
  moodlets: [number, string][] = [];
  cards: [number, string][] = [];
  chronicle: string[] = [];
  confiscated: [number, string][] = [];
  surnames: [number, number][] = [];
  away = new Set<number>();
  punished: number[] = [];
  respect: [number, string, number][] = [];
  lifespan = 1;
  day = 0;
  rng = new Rng(7);
  private next = 1;

  add(o: Partial<FP> & { estate: EstateId; household: number }, head = false): FP {
    const p = { id: this.next++, name: `p${this.next}`, spouse: 0, mother: 0, father: 0, sex: 'male', lifeStage: 'young', age: 25 } as FP;
    Object.assign(p, o);
    this.persons.push(p);
    if (head) this.heads.set(p.household, p.id);
    if (!this.hhEstate.has(p.household)) this.hhEstate.set(p.household, o.estate);
    return p;
  }
  marry(a: FP, b: FP): void {
    a.spouse = b.id;
    b.spouse = a.id;
  }
  child(mom: FP, dad: FP, age: number, household = mom.household, estate: EstateId = mom.estate as EstateId): FP {
    const stage: LifeStage = age < 13 ? 'child' : age < 18 ? 'teen' : 'young';
    return this.add({ estate, household, mother: mom.id, father: dad.id, age, lifeStage: stage });
  }
  host(): EstatesHost<FP> {
    const w = this;
    return {
      rng: w.rng,
      persons: () => w.persons,
      headOf: (hh) => w.persons.find((p) => p.id === w.heads.get(hh)),
      householdEstate: (hh) => w.hhEstate.get(hh) ?? 'freeman',
      age: (p) => p.age,
      day: () => w.day,
      lifespan: () => w.lifespan,
      seasonDays: () => 7,
      savings: S,
      money: (hh) => w.money.get(hh) ?? 0,
      spend: (hh, n, reason) => {
        if ((w.money.get(hh) ?? 0) < n) return false;
        w.money.set(hh, (w.money.get(hh) ?? 0) - n);
        w.log.push(`spend:${hh}:${n}:${reason}`);
        return true;
      },
      setPersonEstate: (p, e) => {
        p.estate = e;
      },
      setHouseholdEstate: (hh, e) => {
        w.hhEstate.set(hh, e);
      },
      fame: (hh, d) => {
        w.fame.set(hh, (w.fame.get(hh) ?? 0) + d);
      },
      fameTier: (hh) => w.fameTier.get(hh) ?? 'ordinary',
      lordFavor: (hh) => w.favor.get(hh) ?? 0,
      addLordFavor: (hh, d) => {
        w.favor.set(hh, (w.favor.get(hh) ?? 0) + d);
      },
      skill: (p) => w.skills.get(p.id) ?? 0,
      isSquire: (p) => w.squires.has(p.id),
      hasFeat: (p) => w.feats.has(p.id),
      moodlet: (p, id) => {
        w.moodlets.push([p.id, id]);
      },
      chronicle: (t) => {
        w.chronicle.push(t);
      },
      news: () => {},
      notice: (p, k) => {
        w.log.push(`notice:${p.id}:${k}`);
      },
      offerCard: (p, id) => {
        w.cards.push([p.id, id]);
      },
      onEstateChanged: () => {},
      onHouseholdEstateChanged: (hh, f, t) => {
        w.log.push(`hh:${hh}:${f}->${t}`);
      },
      needsFamilyName: (hh) => {
        w.log.push(`family_name:${hh}`);
      },
      changeSurname: (p, hh) => {
        w.surnames.push([p.id, hh]);
      },
      confiscate: (hh, r) => {
        w.confiscated.push([hh, r]);
      },
      punish: (p) => {
        w.punished.push(p.id);
      },
      leaveVillage: (p) => {
        w.away.add(p.id);
      },
      returnToVillage: (p) => {
        w.away.delete(p.id);
      },
      respectFrom: (p, e, d) => {
        w.respect.push([p.id, e, d]);
      },
    };
  }
}

function setup(): { w: World; es: Estates<FP> } {
  const w = new World();
  return { w, es: new Estates(w.host(), D) };
}

describe('M8 신분 데이터와 조회 (16-2)', () => {
  it('데이터 파일이 SimData.family 로 들어오고 스키마를 통과', () => {
    expect(FAMILY_FILES.estates).toBe('estates.json');
    const fromFile = JSON.parse(readFileSync(`src/data/${FAMILY_FILES.estates}`, 'utf8'));
    expect(parseEstates(fromFile)).toBeTruthy();
    expect(parseFief(fromFile)).toBeTruthy();
    expect(D.order).toEqual(['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble']);
  });

  it('가능한 것 / 제약: 농노 이사 불가·부역 주 1일, 성직자 혼인 불가, 귀족 정책권·사치 요구, 상인 이상 하인', () => {
    const { es } = setup();
    expect(es.can('serf', 'move')).toBe(false);
    expect(es.hasLimit('serf', 'move_needs_permission')).toBe(true);
    expect(es.corveeDays('serf')).toBe(1);
    expect(es.corveeDays('freeman')).toBe(0);
    expect(es.hasFamilyName('serf')).toBe(false);
    expect(es.can('freeman', 'move')).toBe(true);
    expect(es.can('artisan', 'run_shop')).toBe(true);
    expect(es.can('freeman', 'run_shop')).toBe(false);
    expect(es.can('merchant', 'long_trade')).toBe(true);
    expect(es.can('merchant', 'lend')).toBe(true);
    expect(es.can('clergy', 'sacraments')).toBe(true);
    expect(es.hasLimit('clergy', 'celibate')).toBe(true);
    expect(es.can('knight', 'tournament')).toBe(true);
    expect(es.can('knight', 'court_access')).toBe(true);
    expect(es.hasLimit('knight', 'military_service')).toBe(true);
    for (const x of ['judge', 'levy_tax', 'town_policy', 'fief_income', 'tournament']) expect(es.can('noble', x)).toBe(true);
    expect(es.hasLimit('noble', 'luxury_demand')).toBe(true);
    expect(['merchant', 'knight', 'noble'].every((e) => es.can(e, 'hire_servants'))).toBe(true);
    expect(es.can('artisan', 'hire_servants')).toBe(false);
    // 결혼 범위: 두 단계 이상 차이면 크게 불리
    expect(es.marriageAcceptMod('freeman', 'artisan')).toBe(0);
    expect(es.marriageAcceptMod('serf', 'artisan')).toBeLessThan(0);
  });

  it('큰 비용 역산 (17-4): 해방금 8은화, 배우자 4은화, 길드 6은화, 상인 자본 3금화, 작위 20금화, 지참금 × 1.5', () => {
    const { w, es } = setup();
    expect(es.emancipationFee()).toBe(96 * 4);
    expect(es.spouseEmancipationFee()).toBe(48 * 4);
    expect(es.guildFee()).toBe(72 * 4);
    expect(es.merchantCapital()).toBe(720 * 4);
    expect(es.titleFee()).toBe(4800 * 4);
    expect(es.dowryBase('serf')).toBe(36 * 4);
    expect(es.dowryBase('noble')).toBe(1920 * 4);
    // 자유민 신부 → 장인 신랑: 216 × 1.5 = 324동화
    expect(es.dowry('freeman', 'artisan')).toBe(324 * 4);
    expect(es.dowry('artisan', 'freeman')).toBe(216 * 4);
    // lifespan: 수명 배수를 따름
    w.lifespan = 2;
    expect(es.emancipationFee()).toBe(192 * 4);
  });
});

describe('M8 두 층 규칙 (16-2 표 11행)', () => {
  it('1 혼인: 배우자는 가장 신분을 따름. 농노 배우자는 해방금 절반 + 영주 허락, 자유민이 농노 가정으로 가면 농노 + 경고', () => {
    const { w, es } = setup();
    const head = w.add({ estate: 'freeman', household: 1, sex: 'male' }, true);
    const bride = w.add({ estate: 'serf', household: 2, sex: 'female' }, true);
    const plan = es.planMarriage(head, bride);
    expect(plan.changes).toEqual([{ personId: bride.id, from: 'serf', to: 'freeman' }]);
    expect(plan.fee).toEqual({ household: 1, amount: 48 * 4, reason: 'spouse_emancipation' });
    expect(plan.lordPermission).toEqual({ household: 2 });
    // 영주 호의가 모자라면 막힘, 돈이 모자라도 막힘
    w.favor.set(2, -5);
    expect(es.marry(head, bride).ok).toBe(false);
    w.favor.set(2, 0);
    expect(es.marry(head, bride).reason).toBe('reason.estate.money');
    expect(bride.estate).toBe('serf');
    w.money.set(1, 1000);
    expect(es.marry(head, bride).ok).toBe(true);
    expect(bride.estate).toBe('freeman');
    expect(w.money.get(1)).toBe(1000 - 192);
    // 자유민 이상 → 농노 가정: 농노가 됨 + 경고
    const serfHead = w.add({ estate: 'serf', household: 3, sex: 'male' }, true);
    const girl = w.add({ estate: 'artisan', household: 4, sex: 'female' }, true);
    const p2 = es.planMarriage(serfHead, girl);
    expect(p2.warning).toBe('warn.marry_into_serfdom');
    expect(p2.changes[0].to).toBe('serf');
    expect(p2.fee).toBeUndefined();
    // 가정 안 가장이 아닌 사람과 혼인해도 가장 신분을 따름 (장인 가정의 아들 → 배우자는 장인)
    const art = w.add({ estate: 'artisan', household: 5 }, true);
    const son = w.add({ estate: 'artisan', household: 5 });
    const fm = w.add({ estate: 'freeman', household: 6, sex: 'female' }, true);
    void art;
    expect(es.planMarriage(son, fm).changes[0].to).toBe('artisan');
    // 성직자는 혼인 불가
    const priest = w.add({ estate: 'clergy', household: 7 }, true);
    expect(es.planMarriage(priest, fm).ok).toBe(false);
  });

  it('2 데릴사위: 신부 가장 신분을 따르고 성을 바꿈', () => {
    const { w, es } = setup();
    const father = w.add({ estate: 'merchant', household: 1 }, true);
    const bride = w.add({ estate: 'merchant', household: 1, sex: 'female', father: father.id });
    const groom = w.add({ estate: 'freeman', household: 2 }, true);
    const plan = es.marry(bride, groom, { uxorilocal: true });
    expect(plan.ok).toBe(true);
    expect(plan.rule).toBe('uxorilocal');
    expect(groom.estate).toBe('merchant');
    expect(w.surnames).toEqual([[groom.id, 1]]);
  });

  it('3 자녀: 출생 시 가정 대표 신분 (성직자 대표 가정은 부모 개인 신분)', () => {
    const { w, es } = setup();
    const dad = w.add({ estate: 'knight', household: 1 }, true);
    const mom = w.add({ estate: 'knight', household: 1, sex: 'female' });
    w.marry(dad, mom);
    const baby = w.add({ estate: 'freeman', household: 1, mother: mom.id, father: dad.id, age: 0, lifeStage: 'baby' });
    expect(es.born(baby, mom, dad)).toMatchObject({ estate: 'knight', rule: 'birth', scandal: false });
    expect(baby.estate).toBe('knight');
    // 가정 대표 신분을 읽음 (어머니 개인 신분이 달라도)
    w.hhEstate.set(1, 'merchant');
    expect(es.birthEstate(mom, dad, 1).estate).toBe('merchant');
    // 성직자 프리셋 가정 (대표 = 성직자): 형제 부부의 아이는 어머니 개인 신분
    const priest = w.add({ estate: 'clergy', household: 2 }, true);
    w.hhEstate.set(2, 'clergy');
    const sib = w.add({ estate: 'freeman', household: 2, father: 0 });
    const sibWife = w.add({ estate: 'freeman', household: 2, sex: 'female' });
    void priest;
    expect(es.birthEstate(sibWife, sib, 2).estate).toBe('freeman');
  });

  it('4 사생아: 어머니 개인 신분', () => {
    const { w, es } = setup();
    const lord = w.add({ estate: 'noble', household: 1 }, true);
    const maid = w.add({ estate: 'serf', household: 2, sex: 'female' }, true);
    const r = es.birthEstate(maid, lord, 1, { illegitimate: true });
    expect(r).toMatchObject({ estate: 'serf', rule: 'illegitimate', scandal: false });
  });

  it('5 성직자의 자녀: 어머니 개인 신분 + 추문 (사생아와 같은 처리)', () => {
    const { w, es } = setup();
    const priest = w.add({ estate: 'clergy', household: 1 }, true);
    const widow = w.add({ estate: 'artisan', household: 2, sex: 'female' }, true);
    const r = es.birthEstate(widow, priest, 1);
    expect(r).toMatchObject({ estate: 'artisan', rule: 'clergy_child', scandal: true });
  });

  it('6 기사 서임·작위: 본인 + 배우자 + 미성년 자녀, 같은 가정 성인 자녀는 다음 가장 계승 때', () => {
    const { w, es } = setup();
    const sq = w.add({ estate: 'freeman', household: 1 }, true);
    const wife = w.add({ estate: 'freeman', household: 1, sex: 'female' });
    w.marry(sq, wife);
    const minor = w.child(wife, sq, 10);
    const teen = w.child(wife, sq, 17);
    const adultHome = w.child(wife, sq, 20);
    const adultAway = w.child(wife, sq, 22, 9);
    w.hhEstate.set(9, 'freeman');
    // 조건: 종자 + 무예 5 + 영주 호의 20 + 전공
    expect(es.canKnight(sq).reason).toBe('reason.estate.not_squire');
    w.squires.add(sq.id);
    expect(es.canKnight(sq).reason).toBe('reason.estate.skill');
    w.skills.set(sq.id, 5);
    expect(es.canKnight(sq).reason).toBe('reason.estate.lord_favor');
    w.favor.set(1, 20);
    expect(es.canKnight(sq).reason).toBe('reason.estate.no_feat');
    w.feats.add(sq.id);
    const plan = es.knight(sq);
    expect(plan.ok).toBe(true);
    for (const p of [sq, wife, minor, teen]) expect(p.estate).toBe('knight');
    expect(adultHome.estate).toBe('freeman');
    expect(adultAway.estate).toBe('freeman');
    expect(w.hhEstate.get(1)).toBe('knight');
    expect(es.state.deferred).toEqual([{ personId: adultHome.id, household: 1, to: 'knight' }]);
    expect(w.moodlets).toContainEqual([sq.id, 'knighted_pride']);
    expect(w.chronicle).toContain('estate_up');
    // 가장이 죽고 성인 자녀가 가장이 되면 그때 반영
    w.persons = w.persons.filter((p) => p.id !== sq.id);
    w.heads.set(1, adultHome.id);
    es.onSuccession(1, adultHome);
    expect(adultHome.estate).toBe('knight');
    expect(es.state.deferred).toEqual([]);
    expect(w.hhEstate.get(1)).toBe('knight');
    // 작위 (귀족): 같은 규칙
    const m = w.add({ estate: 'merchant', household: 3 }, true);
    const mw = w.add({ estate: 'merchant', household: 3, sex: 'female' });
    w.marry(m, mw);
    const mk = w.child(mw, m, 5);
    const ep = es.planElevation(m, 'noble');
    expect(ep.rule).toBe('ennoble');
    expect(ep.changes.map((c) => c.personId).sort()).toEqual([m.id, mw.id, mk.id].sort());
    expect(ep.household).toEqual({ id: 3, from: 'merchant', to: 'noble' });
  });

  it('7 해방: 해방금을 낸 가정 전체, 도시 도망 해방은 본인만', () => {
    const { w, es } = setup();
    const dad = w.add({ estate: 'serf', household: 1 }, true);
    const mom = w.add({ estate: 'serf', household: 1, sex: 'female' });
    const kid = w.child(mom, dad, 8);
    const neighbor = w.add({ estate: 'serf', household: 2 }, true);
    expect(es.canPayEmancipation(1)).toMatchObject({ ok: false, reason: 'reason.estate.money', cost: 384 });
    w.money.set(1, 400);
    const plan = es.payEmancipation(1);
    expect(plan.ok).toBe(true);
    for (const p of [dad, mom, kid]) expect(p.estate).toBe('freeman');
    expect(neighbor.estate).toBe('serf');
    expect(w.hhEstate.get(1)).toBe('freeman');
    expect(w.money.get(1)).toBe(16);
    // 농노 → 가문명 얻는 연출 (H) + 카드
    expect(w.log).toContain('family_name:1');
    expect(w.cards).toContainEqual([dad.id, 'family_name_choice']);
    expect(w.moodlets).toContainEqual([kid.id, 'freed_from_serfdom']);

    // 도시 도망: 본인만, 기간 = min(달력 1년 + 1일, 29 × 수명 배수)
    const d2 = w.add({ estate: 'serf', household: 3 }, true);
    const m2 = w.add({ estate: 'serf', household: 3, sex: 'female' });
    expect(es.flightDays()).toBe(29);
    w.rng = new Rng(1);
    const es2 = new Estates(w.host(), { ...D, paths: { ...D.paths, flight: { ...D.paths.flight, detectPerDay: 0 } } });
    expect(es2.startFlight(d2).ok).toBe(true);
    expect(w.away.has(d2.id)).toBe(true);
    for (w.day = 1; w.day <= 29; w.day++) es2.daily();
    expect(d2.estate).toBe('freeman');
    expect(m2.estate).toBe('serf');
    expect(w.hhEstate.get(3)).toBe('serf');
    expect(w.away.has(d2.id)).toBe(false);
    // 들키면 처벌 + 영주 호의 하락
    const d3 = w.add({ estate: 'serf', household: 4 }, true);
    const es3 = new Estates(w.host(), { ...D, paths: { ...D.paths, flight: { ...D.paths.flight, detectPerDay: 1 } } });
    es3.startFlight(d3);
    w.day++;
    es3.daily();
    expect(w.punished).toContain(d3.id);
    expect(d3.estate).toBe('serf');
    expect(w.favor.get(4)).toBe(D.paths.flight.caughtLordFavor);
    // 짧은 수명: 29 × 0.5 가 달력 1년 + 1일 보다 짧음
    w.lifespan = 0.5;
    expect(es.flightDays()).toBe(14.5);
  });

  it('8 파산 하락: 가정 전체 한 단계 (분가한 다른 가정은 그대로), 재산 압류', () => {
    const { w, es } = setup();
    const head = w.add({ estate: 'knight', household: 1 }, true);
    const wife = w.add({ estate: 'knight', household: 1, sex: 'female' });
    const kid = w.child(wife, head, 6);
    const monk = w.child(wife, head, 20, 1, 'clergy');
    const branchSon = w.child(wife, head, 24, 2, 'knight');
    w.heads.set(2, branchSon.id);
    w.hhEstate.set(2, 'knight');
    const plan = es.bankruptcyFall(1);
    expect(plan.ok).toBe(true);
    for (const p of [head, wife, kid]) expect(p.estate).toBe('merchant');
    expect(monk.estate).toBe('clergy');
    expect(branchSon.estate).toBe('knight');
    expect(w.hhEstate.get(1)).toBe('merchant');
    expect(w.hhEstate.get(2)).toBe('knight');
    expect(w.confiscated).toEqual([[1, 'bankruptcy']]);
    expect(w.fame.get(1)).toBe(D.falls.fame.bankruptcy);
    expect(es.lastFall(head)).toEqual({ day: 0, from: 'knight' });
    expect(w.moodlets).toContainEqual([head.id, 'estate_fallen']);
  });

  it('9 길드 제명: 본인만 장인 → 자유민, 본인이 가장이면 가정 대표 신분도', () => {
    const { w, es } = setup();
    const head = w.add({ estate: 'artisan', household: 1 }, true);
    const bro = w.add({ estate: 'artisan', household: 1 });
    es.guildExpel(bro);
    expect(bro.estate).toBe('freeman');
    expect(head.estate).toBe('artisan');
    expect(w.hhEstate.get(1)).toBe('artisan');
    es.guildExpel(head);
    expect(head.estate).toBe('freeman');
    expect(w.hhEstate.get(1)).toBe('freeman');
    expect(es.planGuildExpulsion(head).ok).toBe(false);
  });

  it('10 중죄 신분 박탈: 본인만, 재산 몰수는 가정 전체', () => {
    const { w, es } = setup();
    const head = w.add({ estate: 'merchant', household: 1 }, true);
    const son = w.add({ estate: 'merchant', household: 1 });
    const plan = es.felony(son);
    expect(plan.changes).toEqual([{ personId: son.id, from: 'merchant', to: D.falls.felony.to }]);
    expect(son.estate).toBe(D.falls.felony.to);
    expect(head.estate).toBe('merchant');
    expect(w.hhEstate.get(1)).toBe('merchant');
    expect(w.confiscated).toEqual([[1, 'felony']]);
  });

  it('11 분가: 분가 시점 신분 유지 (미룬 기사 신분은 따라가지 않음)', () => {
    const { w, es } = setup();
    const sq = w.add({ estate: 'freeman', household: 1 }, true);
    const wife = w.add({ estate: 'freeman', household: 1, sex: 'female' });
    w.marry(sq, wife);
    const adult = w.child(wife, sq, 21);
    const kid = w.child(wife, sq, 9);
    w.squires.add(sq.id);
    w.skills.set(sq.id, 9);
    w.favor.set(1, 99);
    w.feats.add(sq.id);
    es.knight(sq);
    expect(es.state.deferred.length).toBe(1);
    adult.household = 5;
    w.heads.set(5, adult.id);
    const plan = es.branch(adult, 5);
    expect(plan.newHousehold).toEqual({ id: 5, estate: 'freeman' });
    expect(w.hhEstate.get(5)).toBe('freeman');
    expect(adult.estate).toBe('freeman');
    expect(es.state.deferred).toEqual([]);
    // 기사 집안에서 분가한 미성년 때 기사가 된 자녀: 기사 가정
    kid.age = 20;
    kid.household = 6;
    w.heads.set(6, kid.id);
    es.branch(kid, 6);
    expect(w.hhEstate.get(6)).toBe('knight');
  });
});

describe('M8 상승/하락 경로 (16-3)', () => {
  it('길드: 도제 10일 → 직인 → 걸작(직인 8일 이상) → 가입비 6은화 → 장인', () => {
    const { w, es } = setup();
    const p = w.add({ estate: 'freeman', household: 1 }, true);
    expect(es.startApprenticeship(p, 'blacksmith').ok).toBe(true);
    expect(es.guildStage(p)).toBe('apprentice');
    for (w.day = 1; w.day <= 10; w.day++) es.daily();
    expect(es.guildStage(p)).toBe('journeyman');
    expect(es.submitMasterpiece(p, 5).reason).toBe('reason.estate.days');
    w.day += 8;
    expect(es.submitMasterpiece(p, 1).reason).toBe('reason.estate.quality');
    expect(es.submitMasterpiece(p, 4).ok).toBe(true);
    expect(es.canJoinGuild(p).reason).toBe('reason.estate.money');
    w.money.set(1, 72 * 4);
    expect(es.joinGuild(p).ok).toBe(true);
    expect(p.estate).toBe('artisan');
    expect(w.hhEstate.get(1)).toBe('artisan');
    expect(es.isGuildMember(p)).toBe(true);
    expect(w.money.get(1)).toBe(0);
  });

  it('상인: 자유민/장인 + 자본 3금화 (쓰지 않음) + 상인 조합', () => {
    const { w, es } = setup();
    const p = w.add({ estate: 'artisan', household: 1 }, true);
    w.money.set(1, 700 * 4);
    expect(es.canBecomeMerchant(p).reason).toBe('reason.estate.capital');
    w.money.set(1, 720 * 4);
    expect(es.becomeMerchant(p).ok).toBe(true);
    expect(p.estate).toBe('merchant');
    expect(w.money.get(1)).toBe(720 * 4);
    const serf = w.add({ estate: 'serf', household: 2 }, true);
    expect(es.canBecomeMerchant(serf).ok).toBe(false);
  });

  it('작위 매입: 상인 + 20금화 + 명성 명망 이상 → 귀족, 귀족들의 멸시', () => {
    const { w, es } = setup();
    const m = w.add({ estate: 'merchant', household: 1 }, true);
    const wife = w.add({ estate: 'merchant', household: 1, sex: 'female' });
    w.marry(m, wife);
    w.money.set(1, 4800 * 4);
    expect(es.canBuyTitle(1).reason).toBe('reason.estate.fame_tier');
    w.fameTier.set(1, 'renowned');
    const plan = es.buyTitle(1);
    expect(plan.ok).toBe(true);
    expect(m.estate).toBe('noble');
    expect(wife.estate).toBe('noble');
    expect(w.hhEstate.get(1)).toBe('noble');
    expect(w.money.get(1)).toBe(0);
    expect(w.respect).toContainEqual([m.id, 'noble', D.paths.title.nobleRespect]);
    expect(w.moodlets).toContainEqual([m.id, 'ennobled_pride']);
  });

  it('성직: 누구나 개인 성직자, 가장이어도 가정 대표 신분은 그대로. 기혼은 불가', () => {
    const { w, es } = setup();
    const head = w.add({ estate: 'artisan', household: 1 }, true);
    const sis = w.add({ estate: 'artisan', household: 1, sex: 'female', lifeStage: 'teen', age: 15 });
    expect(es.takeVows(sis).ok).toBe(true);
    expect(sis.estate).toBe('clergy');
    expect(es.takeVows(head).ok).toBe(true);
    expect(head.estate).toBe('clergy');
    expect(w.hhEstate.get(1)).toBe('artisan');
    const wed = w.add({ estate: 'freeman', household: 2 }, true);
    wed.spouse = 99;
    expect(es.canTakeVows(wed).reason).toBe('reason.estate.married');
  });

  it('영주 은혜: 해방금 없이 가정 전체 해방', () => {
    const { w, es } = setup();
    const a = w.add({ estate: 'serf', household: 1 }, true);
    const b = w.add({ estate: 'serf', household: 1, sex: 'female' });
    expect(es.lordGrace(1).ok).toBe(true);
    expect([a.estate, b.estate]).toEqual(['freeman', 'freeman']);
    expect(w.log.some((l) => l.startsWith('spend'))).toBe(false);
  });

  it('기사 자격 박탈: 본인 + 배우자 + 미성년 자녀', () => {
    const { w, es } = setup();
    const k = w.add({ estate: 'knight', household: 1 }, true);
    const wife = w.add({ estate: 'knight', household: 1, sex: 'female' });
    w.marry(k, wife);
    const kid = w.child(wife, k, 10);
    const grown = w.child(wife, k, 25, 1, 'knight');
    es.revokeKnighthood(k);
    expect([k.estate, wife.estate, kid.estate]).toEqual(['freeman', 'freeman', 'freeman']);
    expect(grown.estate).toBe('knight');
    expect(w.hhEstate.get(1)).toBe('freeman');
  });
});

describe('M8 영지 (17-7) 와 영주 금고 (18-4)', () => {
  const FD = parseFief(raw)!;
  function fiefWorld(estate: string) {
    const log: string[] = [];
    const money = new Map<number, number>();
    const stock = new Map<string, number>();
    const fame = new Map<number, number>();
    let morale = 50;
    let houseTier = 5;
    let lastFeast = 0;
    let outfit = 5;
    const host: FiefHost = {
      rng: new Rng(3),
      seasonDays: () => 7,
      lifespan: () => 1,
      season: (day) => ['spring', 'summer', 'autumn', 'winter'][Math.floor(day / 7) % 4],
      householdEstate: () => estate,
      earn: (hh, n, k) => {
        money.set(hh, (money.get(hh) ?? 0) + n);
        log.push(`${k}:${n}`);
      },
      addStock: (_hh, item, n) => {
        stock.set(item, (stock.get(item) ?? 0) + n);
      },
      feesToday: () => 40 * 4 * 2,
      finesToday: () => 8,
      fame: (hh, d) => {
        fame.set(hh, (fame.get(hh) ?? 0) + d);
      },
      morale: (d) => {
        morale += d;
      },
      rumor: (_hh, k) => {
        log.push(`rumor:${k}`);
      },
      notice: () => {},
      houseTier: () => houseTier,
      lastFeastDay: () => lastFeast,
      bestOutfitTier: () => outfit,
      tierIndex: (t) => ['serf', 'freeman', 'artisan', 'merchant', 'knight', 'noble'].indexOf(t),
      moodletHousehold: () => {},
    };
    return {
      host,
      money,
      stock,
      fame,
      log,
      get morale() {
        return morale;
      },
      set: (h: number, f: number, o: number) => {
        houseTier = h;
        lastFeast = f;
        outfit = o;
      },
    };
  }

  it('귀족 기본 영지: 소작 12 × 1.5 + 장원 12 × 25 + 사용료 50%·벌금 ≈ 17-7 예시, 소작은 계절 정산 (가을 일부 현물)', () => {
    const fw = fiefWorld('noble');
    const fs = new FiefSystem(fw.host, FD);
    const f = fs.grant(1);
    expect([f.manors, f.tenants, f.lord]).toEqual([12, 12, true]);
    // 봄 첫날: 장원 300동화 + 사용료 절반(40동화) + 벌금, 소작은 쌓임
    const r0 = fs.dailySettle(0)[0];
    expect(r0.manors).toBe(300 * 4);
    expect(r0.fees).toBe(40 * 4);
    expect(r0.fines).toBe(8);
    expect(r0.tenants).toBe(0);
    expect(fs.treasury.money).toBe(40 * 4);
    for (let d = 1; d < 7; d++) fs.dailySettle(d);
    // 계절 마지막 날: 7일 × 12 × 1.5 = 126동화
    expect(fw.log.filter((l) => l.startsWith('fief_tenants'))).toEqual([`fief_tenants:${126 * 4}`]);
    // 가을: 절반은 곡물 현물
    for (let d = 7; d < 21; d++) fs.dailySettle(d);
    expect(fw.stock.get('wheat')).toBe(Math.floor((126 * 0.5) / FD.inKindPrice));
  });

  it('기사 영지: 소작 4 + 장원 2 + 녹봉 40 (사용료·벌금은 영주 가문만)', () => {
    const fw = fiefWorld('knight');
    const fs = new FiefSystem(fw.host, FD);
    fs.grant(2);
    const r = fs.dailySettle(0)[0];
    expect(r.manors).toBe(50 * 4);
    expect(r.stipend).toBe(40 * 4);
    expect(r.fees).toBe(0);
    // 영주 가문이 없으면 사용료·벌금은 전부 금고
    expect(fs.treasury.money).toBe(40 * 4 * 2 + 8);
  });

  it('세금은 영주 금고로, 사적 유용 = 민심 −10·명성 −30·발각되면 소문', () => {
    const fw = fiefWorld('noble');
    const fs = new FiefSystem(fw.host, FD);
    fs.grant(1);
    fs.depositTax(1000);
    expect(fs.treasury.money).toBe(1000);
    expect(fw.money.get(1)).toBeUndefined();
    const r = fs.embezzle(1, 600);
    expect(r).toMatchObject({ ok: true, moved: 600 });
    expect(fs.treasury.money).toBe(400);
    expect(fw.money.get(1)).toBe(600);
    expect(fw.morale).toBe(40);
    expect(fw.fame.get(1)).toBe(-30);
    expect(fw.log.includes('rumor:embezzlement')).toBe(r.discovered);
    expect(fs.treasurySpend(500, 'guards')).toBe(false);
    expect(fs.treasurySpend(400, 'guards')).toBe(true);
  });

  it('귀족 사치 요구: 저택/옷/연회를 안 하면 명예 하락', () => {
    const fw = fiefWorld('noble');
    const fs = new FiefSystem(fw.host, FD);
    fs.grant(1);
    fw.set(5, 10, 5);
    expect(fs.luxuryCheck(14)[0].missed).toEqual([]);
    fw.set(3, -100, 1);
    const r = fs.luxuryCheck(14)[0];
    expect(r.missed).toEqual(['house', 'outfit', 'feast']);
    expect(fw.fame.get(1)).toBe(FD.luxury.fame.house + FD.luxury.fame.outfit + FD.luxury.fame.feast);
    expect(fs.luxuryDue(6)).toBe(true);
    expect(fs.luxuryDue(5)).toBe(false);
  });
});
