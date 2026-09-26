/**
 * 생애 판정기 (GDD 18-3): 하루 한 번 자정 정산 뒤 모든 인물(조작 가문 포함, 세밀도와 무관)에게 같은 식.
 * 나이 먹기(29-2 단계 일수), 사망(노환 위험 곡선 + M11 전 기본 사망), 약혼/혼인, 임신 3단계/유산/출산(15-1),
 * 인구 피드백(18-3), 이주, 분가(15-8 가정 상한), 원한. 수치는 story.json. 렌더러/DOM 없음.
 */
import type { Rng } from '../core/rng';
import type { StoryData } from '../data/simData';
import type { LifeStage, Person } from '../people/person';
import type { Relations } from '../social/relations';
import type { Town } from './town';

const ORDER: LifeStage[] = ['baby', 'toddler', 'child', 'teen', 'young', 'adult', 'elder'];

export interface JudgeHost {
  readonly persons: Person[];
  readonly rng: Rng;
  readonly rel: Relations;
  readonly town: Town | null;
  day(): number;
  news(kind: string, args: Record<string, string | number>, subjects: Person[]): void;
  moodlet(p: Person, id: string): void;
  kill(p: Person, cause: string): void;
  birth(mother: Person, father: Person | null): Person | null;
  /** 가구 이사 (혼인한 배우자, 분가, 이주) */
  moveTo(p: Person, household: number, lot: string | null): void;
  newHousehold(): number;
  emptyLot(size: string): string | null;
  immigrate(n: number): Person[];
  emigrate(household: number): void;
  coarse(p: Person): void;
}

export class LifeJudge {
  /** 통계 (헤드리스 29-1): 출생, 사망(원인별), 혼인, 이주 */
  readonly stats = { births: 0, deaths: 0, deathsByCause: {} as Record<string, number>, deathsUnder18: 0, marriages: 0, engagements: 0, pregnancies: 0, losses: 0, immigrants: 0, emigrants: 0, splits: 0, grudges: 0, youngEnded: 0, youngEndedMarried: 0 };
  /** 단계별 노출 일수와 사망 (누적 위험 추정: 18세 전 사망률 29-1) */
  readonly exposure: Record<string, number> = {};
  readonly stageDeaths: Record<string, number> = {};
  /** 사람별 마지막 출산 날 */
  private lastBirth = new Map<number, number>();

  constructor(private host: JudgeHost, private s: StoryData) {}

  /** 표시 나이 (29-2) */
  age(p: Person): number {
    const [a0, per] = this.s.displayAge[p.lifeStage] ?? [30, 1];
    return a0 + p.ageDays * per;
  }

  /** 18세 전 사망 누적 확률 추정: 단계별 하루 사망률 × 단계 일수 (아기~청소년 + 청년 초반) */
  childMortality(): number {
    let surv = 1;
    for (const st of ['baby', 'toddler', 'child', 'teen'] as LifeStage[]) {
      const e = this.exposure[st] ?? 0;
      if (!e) continue;
      const h = (this.stageDeaths[st] ?? 0) / e;
      surv *= Math.pow(1 - h, this.s.stageDays[st] ?? 1);
    }
    return 1 - surv;
  }

  /** 인구 피드백 배수 (18-3) */
  feedback(): number {
    const P = this.s.population;
    const n = this.host.persons.length;
    return Math.max(P.feedbackMin, Math.min(P.feedbackMax, 1 + (2 * (P.target - n)) / P.target));
  }

  daily(): void {
    const day = this.host.day();
    this.aging();
    this.deaths(day);
    this.pregnancies(day);
    this.marriages(day);
    this.conceive(day);
    if (day % this.s.population.migrationCheckDays === 0) this.migration();
    this.grudges();
  }

  // ------------------------------------------------------------------ 나이

  private aging(): void {
    for (const p of this.host.persons) {
      this.exposure[p.lifeStage] = (this.exposure[p.lifeStage] ?? 0) + 1;
      p.ageDays++;
      const len = this.s.stageDays[p.lifeStage] ?? 24;
      if (p.lifeStage !== 'elder' && p.ageDays >= len) {
        // 29-1 혼인률: 청년 단계를 마칠 때 한 번이라도 혼인했는가
        // 성직자(독신 서원)는 혼인률 모집단에서 뺌
        if (p.lifeStage === 'young' && p.estate !== 'clergy') {
          this.stats.youngEnded++;
          if (p.marriedDay >= 0) this.stats.youngEndedMarried++;
        }
        const i = ORDER.indexOf(p.lifeStage);
        p.lifeStage = ORDER[Math.min(ORDER.length - 1, i + 1)];
        p.ageDays = 0;
        this.host.coarse(p);
        if (p.lifeStage === 'young') this.host.news('coming_of_age', { a: p.name }, [p]);
      }
    }
  }

  // ------------------------------------------------------------------ 사망

  private deaths(day: number): void {
    const H = this.s.elderHazard;
    for (const p of [...this.host.persons]) {
      let pd = this.s.backgroundDeath[p.lifeStage] ?? 0;
      let cause = '';
      if (pd > 0) {
        const r = this.host.rng.next();
        if (r < pd) {
          // 원인 (M11 전 기본): 병 / 사고 / 추위와 굶주림
          const c = this.host.rng.next();
          let acc = 0;
          for (const [k, v] of Object.entries(this.s.backgroundCauses)) {
            acc += v;
            if (c < acc) {
              cause = k;
              break;
            }
          }
          cause ||= 'illness';
        }
      }
      if (!cause && p.lifeStage === 'elder') {
        pd = H.base * Math.exp(H.k * p.ageDays) * (p.weakened ? H.healthPoor : 1);
        if (this.host.rng.next() < pd) cause = 'old_age';
      }
      if (!cause) continue;
      if (this.age(p) < 18) this.stats.deathsUnder18++;
      this.stageDeaths[p.lifeStage] = (this.stageDeaths[p.lifeStage] ?? 0) + 1;
      this.stats.deaths++;
      this.stats.deathsByCause[cause] = (this.stats.deathsByCause[cause] ?? 0) + 1;
      const kind = cause === 'old_age' ? 'death_old' : this.age(p) < 18 ? 'death_child' : cause === 'illness' ? 'death_ill' : cause === 'cold_hunger' ? 'death_cold' : 'death_accident';
      this.host.news(kind, { a: p.name }, [p]);
      this.host.kill(p, cause);
      void day;
    }
  }

  // ------------------------------------------------------------------ 임신과 출산 (15-1)

  private pregnancies(day: number): void {
    const P = this.s.pregnancy;
    for (const p of [...this.host.persons]) {
      const g = p.pregnancy;
      if (!g) continue;
      // 단계당 유산/사산 위험 (29-1: 현실적 기본 임신의 6~12%)
      if (this.host.rng.next() < P.lossChance / 3) {
        p.pregnancy = null;
        this.stats.losses++;
        const father = this.host.persons.find((q) => q.id === g.father);
        const mood = g.stage >= 3 ? 'stillbirth_grief' : 'miscarriage_grief';
        this.host.moodlet(p, mood);
        if (father) this.host.moodlet(father, mood);
        this.host.news(g.stage >= 3 ? 'stillbirth' : 'miscarriage', { a: p.name }, [p]);
        continue;
      }
      if (day - g.since < P.stageDays * g.stage) continue;
      if (g.stage < 3) {
        g.stage++;
        continue;
      }
      // 출산
      p.pregnancy = null;
      this.lastBirth.set(p.id, day);
      const father = this.host.persons.find((q) => q.id === g.father) ?? null;
      const n = this.host.rng.next() < P.twins ? 2 : 1;
      const babies: Person[] = [];
      for (let k = 0; k < n; k++) {
        const baby = this.host.birth(p, father);
        if (baby) {
          this.stats.births++;
          babies.push(baby);
        }
      }
      this.host.moodlet(p, 'newborn_joy');
      if (father) this.host.moodlet(father, 'newborn_joy');
      this.host.news(n > 1 ? 'twins' : 'birth', { a: n > 1 && father ? father.name : p.name, b: babies[0]?.name ?? '' }, [p]);
      if (this.host.rng.next() < P.maternalDeath) {
        this.stats.deaths++;
        this.stats.deathsByCause.childbirth = (this.stats.deathsByCause.childbirth ?? 0) + 1;
        if (father) this.host.moodlet(father, 'lost_in_childbirth');
        this.host.news('death_childbirth', { a: p.name, b: father?.name ?? p.name }, [p]);
        this.host.kill(p, 'childbirth');
      }
    }
  }

  private conceive(day: number): void {
    const P = this.s.pregnancy;
    const fb = this.feedback();
    for (const w of this.host.persons) {
      if (w.sex !== 'female' || !w.spouse || w.pregnancy || w.infant) continue;
      const age = this.age(w);
      if (age < P.fertileAge[0] || age > P.fertileAge[1]) continue;
      if (day - (this.lastBirth.get(w.id) ?? -1e9) < P.birthCooldownDays) continue;
      const h = this.host.persons.find((q) => q.id === w.spouse);
      if (!h || h.household !== w.household) continue;
      const times = P.coitusPerDay[w.wantsKids] ?? P.coitusPerDay.any;
      let pr = 1 - Math.pow(1 - P.perCoitus, times);
      if (age >= P.declineFromAge) pr *= Math.max(P.declineFloor, 1 - (age - P.declineFromAge) / P.declineYears);
      // 조작 가문은 피드백 없음 (플레이어 선택 존중)
      if (w.household !== 1) pr *= fb;
      if (this.host.rng.next() < pr) {
        w.pregnancy = { since: day, stage: 1, father: h.id };
        this.stats.pregnancies++;
      }
    }
  }

  // ------------------------------------------------------------------ 약혼과 혼인 (14-4, 18-3)

  private eligible(p: Person): boolean {
    if (p.spouse || p.betrothed || p.infant) return false;
    if (p.lifeStage !== 'young' && p.lifeStage !== 'adult' && p.lifeStage !== 'teen') return false;
    return this.age(p) >= this.s.marriage.minAge;
  }

  private marriages(day: number): void {
    const M = this.s.marriage;
    // 약혼 기간이 지난 쌍은 혼인
    for (const p of [...this.host.persons]) {
      if (!p.betrothed || p.sex !== 'female' || day - p.betrothedDay < M.betrothalDays) continue;
      const h = this.host.persons.find((q) => q.id === p.betrothed);
      if (!h) {
        p.betrothed = 0;
        continue;
      }
      this.marry(p, h);
    }
    // 새 약혼
    const fb = Math.sqrt(this.feedback());
    const women = this.host.persons.filter((p) => p.sex === 'female' && this.eligible(p));
    const men = this.host.persons.filter((p) => p.sex === 'male' && this.eligible(p));
    for (const w of women) {
      if (w.betrothed) continue;
      let best: Person | null = null;
      let bestP = 0;
      for (const m of men) {
        if (m.betrothed || m.household === w.household) continue;
        if (this.related(w, m)) continue;
        const gap = Math.abs(this.age(w) - this.age(m));
        if (gap > M.ageGapYears) continue;
        let pr = M.baseDaily * fb;
        const rank = (e: string) => M.estateRank.indexOf(e);
        const eg = Math.abs(rank(w.estate) - rank(m.estate));
        if (eg >= 2) pr *= M.estateGapPenalty;
        if (w.estate === 'clergy' || m.estate === 'clergy') pr *= M.clergyMult;
        pr *= 1 + Math.max(-0.5, this.host.rel.friendship(w.id, m.id) * M.friendshipBonus);
        pr += this.host.rel.romance(w.id, m.id) * M.romanceBonus;
        if (pr > bestP) {
          bestP = pr;
          best = m;
        }
      }
      // 후보 중 가장 잘 맞는 한 사람과 하루 확률
      if (best && this.host.rng.next() < Math.min(M.dailyCap, bestP * Math.min(M.poolDivisor, men.length / M.poolDivisor))) {
        w.betrothed = best.id;
        best.betrothed = w.id;
        w.betrothedDay = day;
        best.betrothedDay = day;
        const r = this.host.rel.ensure(w.id, best.id);
        r.met = true;
        r.flags.add('engaged');
        r.romance = Math.max(r.romance, M.engagedRomance);
        r.friendship = Math.max(r.friendship, M.engagedFriendship);
        this.host.moodlet(w, 'engaged');
        this.host.moodlet(best, 'engaged');
        this.stats.engagements++;
        this.host.news('engaged', { a: best.name, b: w.name }, [best, w]);
        const i = men.indexOf(best);
        if (i >= 0) men.splice(i, 1);
      }
    }
  }

  private related(a: Person, b: Person): boolean {
    if (a.mother && (a.mother === b.mother || a.mother === b.id)) return true;
    if (a.father && (a.father === b.father || a.father === b.id)) return true;
    if (b.mother === a.id || b.father === a.id) return true;
    return !!this.host.rel.get(a.id, b.id)?.flags.has('family');
  }

  private marry(w: Person, h: Person): void {
    const r = this.host.rel.ensure(w.id, h.id);
    r.flags.delete('engaged');
    r.flags.add('spouse');
    w.betrothed = 0;
    h.betrothed = 0;
    w.spouse = h.id;
    h.spouse = w.id;
    if (w.marriedDay < 0) w.marriedDay = this.host.day();
    if (h.marriedDay < 0) h.marriedDay = this.host.day();
    this.stats.marriages++;
    this.host.moodlet(w, 'wedding_day');
    this.host.moodlet(h, 'wedding_day');
    this.host.news('married', { a: h.name, b: w.name }, [h, w]);
    // 사는 곳 (14-4 거주지): 기본은 남편 집. 조작 가문 식구와 혼인하면 조작 가문 집으로
    let to = this.s.marriage.spouseMovesTo === 'husband' ? h : w;
    let from = to === h ? w : h;
    if (from.household === 1) [to, from] = [from, to];
    const cap = this.s.household.cap;
    const size = this.host.persons.filter((q) => q.household === to.household).length;
    // 조작 가문 식구는 조작에서 빠지지 않게 늘 조작 가문 집으로 (인원 상한 처리는 M8 가계, DECISIONS)
    if (size + 1 > cap && to.household !== 1) {
      // 상한 초과: 둘이 분가 (빈 부지)
      const lot = this.host.emptyLot('small');
      const hh = this.host.newHousehold();
      this.host.moveTo(to, hh, lot);
      this.host.moveTo(from, hh, lot);
      this.stats.splits++;
      this.host.news('new_house', { a: h.name, b: w.name }, [h, w]);
    } else this.host.moveTo(from, to.household, to.homeLot);
  }

  // ------------------------------------------------------------------ 이주 (18-3 안전판)

  private migration(): void {
    const P = this.s.population;
    const n = this.host.persons.length;
    if (n < P.immigrateBelow) {
      const [lo, hi] = P.immigrantFamily;
      const came = this.host.immigrate(lo + Math.floor(this.host.rng.next() * (hi - lo + 1)));
      this.stats.immigrants += came.length;
      if (came.length) this.host.news('moved_in', { a: came[0].name }, came);
    } else if (n > P.emigrateAbove) {
      // 조작 가문이 아닌 가장 큰 가구 하나
      const sizes = new Map<number, number>();
      for (const p of this.host.persons) if (p.household !== 1) sizes.set(p.household, (sizes.get(p.household) ?? 0) + 1);
      const hh = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      if (hh) {
        const first = this.host.persons.find((p) => p.household === hh[0]);
        this.stats.emigrants += hh[1];
        if (first) this.host.news('moved_out', { a: first.name }, [first]);
        this.host.emigrate(hh[0]);
      }
    }
  }

  private grudges(): void {
    for (const p of this.host.persons) {
      for (const q of this.host.persons) {
        if (q.id <= p.id) continue;
        const r = this.host.rel.get(p.id, q.id);
        if (!r || r.flags.has('grudge') || r.friendship > -60) continue;
        r.flags.add('grudge');
        this.stats.grudges++;
      }
    }
  }
}
