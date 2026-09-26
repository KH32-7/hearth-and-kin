/**
 * 생애 단계와 생일 (GDD 10-2, 12-1 특성 칸, 29-0 수명 배수, 29-2 노환 위험).
 * - 자정에 나이를 먹고, 단계 끝에 닿으면 "생일 대기". 생일은 그날 아침(birthday.hour)에 단계를 바꿈 (가족이 축하/잔치)
 * - 수명 설정: 단계 일수 × 배수, 표시 나이·노환 위험 ÷ 배수
 * - 단계 전환: 기질(출생) → 아동 특성 1 (기질이 이어질 확률 + 유아기 돌봄 질) → 청소년 +1 (30% 부모 특성) → 청년 +1 → 노년 특성 (확률), 은퇴
 * - 노화 끄기: 가구 전체 또는 인물별
 * 렌더러/DOM 없음. 무작위는 host.rng 만
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import type { LifeStage, Person } from '../people/person';

export const LIFE_ORDER: readonly LifeStage[] = ['baby', 'toddler', 'child', 'teen', 'young', 'adult', 'elder'];

const dur = z.object({ value: z.number(), scale: z.enum(['absolute', 'season', 'lifespan', 'per_life']) });
export const lifecycleSchema = z.object({
  lifespan: z.object({ presets: z.record(z.string(), z.number()), default: z.string() }),
  birthday: z.object({
    hour: z.number(),
    delayMax: dur,
    celebrateFriendship: z.number(),
    feastFriendship: z.number(),
    feastGuestsMin: z.number(),
    grewUpMoodlet: z.string(),
    celebratedMoodlet: z.string(),
    feastMoodlet: z.string(),
  }),
  traits: z.object({
    temperaments: z.array(z.string()),
    slots: z.record(z.string(), z.number()),
    temperamentLeads: z.record(z.string(), z.array(z.string())),
    leadChance: z.number(),
    goodTraits: z.array(z.string()),
    badTraits: z.array(z.string()),
    goodWeight: z.number(),
    badWeight: z.number(),
    parentTraitChance: z.number(),
    elderTraits: z.array(z.string()),
    elderTraitChance: z.number(),
  }),
  elder: z.object({ walkMult: z.number(), energyDecayMult: z.number(), retire: z.boolean(), retiredMoodlet: z.string() }),
  comingOfAgeNews: z.string(),
}).loose();
export type LifecycleData = z.infer<typeof lifecycleSchema>;

export interface LifecycleHost {
  readonly persons: readonly Person[];
  readonly rng: Rng;
  /** story.json 기준 단계 일수 (보통 수명) */
  baseStageDays(stage: LifeStage): number;
  /** story.json 표시 나이 [시작 나이, 하루 증가] (보통 수명) */
  baseDisplayAge(stage: LifeStage): [number, number];
  /** 수명 설정 배수 */
  lifespan(): number;
  /** 가구 전체 노화 정지 */
  agingOffHousehold(household: number): boolean;
  day(): number;
  moodlet(p: Person, id: string): void;
  news(kind: string, args: Record<string, string | number>, subjects: Person[]): void;
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
  /** 네 묶음 단계(stage)·아기/유아 표시 등 파생 값 갱신, 내면 캐시 무효화 */
  coarse(p: Person): void;
  /** 성격 특성 목록 (무작위 칸에 쓰는 것) 과 충돌 검사 */
  personalityTraits(): readonly string[];
  traitConflicts(t: string, have: readonly string[]): boolean;
  /** 부모와의 우정 (0~100 평균, 부모가 없으면 50) */
  parentBond(p: Person): number;
  /** 유아 기술 평균 (0~5, childcare) */
  toddlerSkillAvg(p: Person): number;
  /** 은퇴: 직업을 내려놓음 */
  retire(p: Person): void;
  /** 단계가 바뀐 뒤 (판정기 통계, 인생 목표 다시 고르기, 교육 경로 등) */
  onStageChanged(p: Person, from: LifeStage, to: LifeStage): void;
}

export class Lifecycle {
  constructor(private host: LifecycleHost, readonly d: LifecycleData) {}

  /** 이 단계의 길이 (일, 수명 배수 반영) */
  stageDays(stage: LifeStage): number {
    return this.host.baseStageDays(stage) * this.host.lifespan();
  }

  /** 표시 나이 (10-2): 단계 시작 나이 + 경과 × 하루 증가 ÷ 수명 배수. 노년은 끝이 없음 */
  displayAge(p: Person): number {
    const [a0, per] = this.host.baseDisplayAge(p.lifeStage);
    return a0 + (p.ageDays * per) / this.host.lifespan();
  }

  /** 노년 경과 일을 보통 수명 기준으로 (29-2 노환 위험 h(n) 의 n) */
  elderDaysNormalized(p: Person): number {
    return p.ageDays / this.host.lifespan();
  }

  agingOff(p: Person): boolean {
    return p.agingOff || this.host.agingOffHousehold(p.household);
  }

  /** 자정: 나이 먹기. 단계 끝이면 생일 대기 (노년은 끝이 없음) */
  dailyAge(p: Person): void {
    if (this.agingOff(p)) return;
    p.ageDays++;
    if (p.lifeStage === 'elder') return;
    if (p.ageDays >= this.stageDays(p.lifeStage) && p.birthdayDay < 0) p.birthdayDay = this.host.day();
  }

  /** 생일 미루기 (조작 가문, 10-2): 하루씩, 합쳐 최대 delayMax 일 */
  delay(p: Person): boolean {
    if (p.birthdayDay < 0) return false;
    if (p.birthdayDelayed >= this.d.birthday.delayMax.value) return false;
    p.birthdayDelayed++;
    return true;
  }

  /** 아침(birthday.hour): 생일 대기 중이고 미룬 날이 지난 인물의 단계를 바꿈 */
  morning(): Person[] {
    const out: Person[] = [];
    const day = this.host.day();
    for (const p of this.host.persons) {
      if (p.birthdayDay < 0) continue;
      if (day < p.birthdayDay + p.birthdayDelayed) continue;
      this.transition(p);
      out.push(p);
    }
    return out;
  }

  /** 단계 전환 (생일). from → 다음 단계, 특성 칸 채우기, 노년 규칙 */
  transition(p: Person): { from: LifeStage; to: LifeStage } {
    const from = p.lifeStage;
    const i = LIFE_ORDER.indexOf(from);
    const to = LIFE_ORDER[Math.min(LIFE_ORDER.length - 1, i + 1)];
    p.lifeStage = to;
    p.ageDays = 0;
    p.birthdayDay = -1;
    p.birthdayDelayed = 0;
    p.lastBirthdayDay = this.host.day();
    p.celebratedBy = [];
    this.assignTraits(p, from, to);
    if (to === 'elder') {
      if (this.d.elder.retire && p.career) {
        this.host.retire(p);
        this.host.moodlet(p, this.d.elder.retiredMoodlet);
      }
    }
    this.host.coarse(p);
    this.host.moodlet(p, this.d.birthday.grewUpMoodlet);
    if (to === 'young') this.host.news(this.d.comingOfAgeNews, { a: p.name }, [p]);
    this.host.notice(p, 'birthday', { name: p.name, stage: `life.${to}` });
    this.host.onStageChanged(p, from, to);
    return { from, to };
  }

  /** 출생: 기질 하나 (12-1) */
  newborn(p: Person): void {
    const T = this.d.traits.temperaments;
    // 아기는 기질만 (성격 특성은 아동부터, 선천 특성은 유전으로 이미 붙음)
    const personality = new Set(this.host.personalityTraits());
    p.traits = p.traits.filter((t) => !T.includes(t) && !personality.has(t));
    p.traits.push(T[this.host.rng.int(T.length)]);
  }

  private personalityCount(p: Person): number {
    const set = new Set(this.host.personalityTraits());
    return p.traits.filter((t) => set.has(t)).length;
  }

  private pickWeighted(p: Person, cands: readonly string[], weight: (t: string) => number): string | null {
    const ok = cands.filter((t) => !p.traits.includes(t) && !this.host.traitConflicts(t, p.traits));
    if (!ok.length) return null;
    const w = ok.map(weight);
    const k = this.host.rng.weighted(w);
    return ok[k < 0 ? 0 : k];
  }

  private assignTraits(p: Person, from: LifeStage, to: LifeStage): void {
    const T = this.d.traits;
    const rng = this.host.rng;
    const all = this.host.personalityTraits();
    if (to === 'child') {
      // 기질 → 아동 특성 1 (이어질 확률), 유아기 돌봄 질이 좋은/나쁜 특성 가중
      const temper = p.traits.find((t) => T.temperaments.includes(t));
      p.traits = p.traits.filter((t) => !T.temperaments.includes(t));
      if (this.personalityCount(p) < (T.slots.child ?? 1)) {
        let t: string | null = null;
        if (temper && rng.next() < T.leadChance) t = this.pickWeighted(p, T.temperamentLeads[temper] ?? [], () => 1);
        if (!t) {
          const q = Math.max(0, Math.min(1, (this.host.toddlerSkillAvg(p) / 5 + this.host.parentBond(p) / 100) / 2));
          t = this.pickWeighted(p, all, (x) => (T.goodTraits.includes(x) ? 1 + T.goodWeight * q : T.badTraits.includes(x) ? 1 + T.badWeight * (1 - q) : 1));
        }
        if (t) p.traits.push(t);
      }
      return;
    }
    const want = T.slots[to] ?? 3;
    while (this.personalityCount(p) < want) {
      let t: string | null = null;
      // 청소년: 한 칸은 30% 확률로 부모 특성 (10-3)
      if (to === 'teen' && rng.next() < T.parentTraitChance) {
        const parentTraits = this.host.persons.filter((q) => q.id === p.mother || q.id === p.father).flatMap((q) => q.traits).filter((x) => all.includes(x));
        t = this.pickWeighted(p, parentTraits, () => 1);
      }
      t ??= this.pickWeighted(p, all, () => 1);
      if (!t) break;
      p.traits.push(t);
    }
    if (to === 'elder' && rng.next() < T.elderTraitChance && !p.traits.some((x) => T.elderTraits.includes(x))) {
      const t = this.pickWeighted(p, T.elderTraits, () => 1);
      if (t) p.traits.push(t);
    }
    void from;
  }
}
