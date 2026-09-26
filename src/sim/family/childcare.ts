/**
 * 아기·유아·아동·청소년 돌봄과 교육, 입양·후견, 가정 인원 (GDD 15-3 ~ 15-8). 수치는 childcare.json.
 * - 아기: 스스로 움직이지 않음. 요람/품/바닥 중 한 자리. 욕구 5 (배고픔·기력·위생·교류·온기), 30 아래면 울음 → 식구 시끄러움/잠 깸.
 *   욕구 0 이 이어지면 방치: 친척/교회 개입(대안 결과) 또는 사망 설정 '아이' 칸에 따라 병·쇠약
 * - 유아: 기술 5 × 5레벨 (걷기 전엔 기어다님, 말하기 3부터 부르는 말풍선, 배변 훈련 전엔 기저귀). 화로·우물·계단 가까이 혼자면 사고
 * - 아동: 교육 경로 5 (집안일/교구 학교/수도원 학교/가정교사/시동), 과제 → 성적 A~F, 아동 스킬 4 → 청년 때 성인 스킬 보너스
 * - 청소년: 도제 계약, 반항(몰래 나가기, 가출), 가문에 대한 애정
 * - 돌봄 행동은 사회 상호작용(category care): 자율 점수는 돌보는 사람의 욕구가 아니라 아이의 욕구 긴급도 (careCandidates)
 * 렌더러/DOM 없음. 무작위는 host.rng 만
 */
import type { Rng } from '../core/rng';
import type { Person } from '../people/person';
import { NEED_INDEX } from '../people/person';
import type { NeedId } from '../core/types';

export interface ChildcareData {
  baby: {
    decayPerHour: Partial<Record<NeedId, number>>;
    sleepEnergyPerHour: number;
    sleepBelowEnergy: number;
    wakeAboveEnergy: number;
    cryBelow: number;
    cryRadiusTiles: number;
    cryWakeChancePerHour: number;
    neglect: { startMinutes: { value: number }; interveneMinutes: { value: number }; deathChancePerHour: number; parentMemoryImportance: number; fameLoss: number; churchLoss: number };
    cradleObjects: string[];
    wetNurse: { estates: string[]; pricePerDay: number; hungerFloor: number };
    starveMinutes?: { value: number };
    swaddleWarmth: { cradle: number; floor: number };
  };
  toddler: {
    skills: string[];
    xpBase: number;
    xpExp: number;
    crawlSpeedMult: number;
    walkSpeedMult: number;
    walkFromLevel: number;
    talkBubbleFromLevel: number;
    pottyDoneLevel: number;
    selfPlayXpPerMinute: number;
    decayPerHour: Partial<Record<NeedId, number>>;
    cryBelow: number;
    hazardObjects: string[];
    hazardRadiusTiles: number;
    guardRadiusTiles: number;
    hazardChancePerHour: number;
    tantrumChancePerHour: number;
    tantrumFunBelow: number;
    clothingWarmth: number;
  };
  child: {
    skills: string[];
    xpBase: number;
    xpExp: number;
    education: Record<string, EducationDef>;
    defaultEducation: Record<string, string>;
    homework: { minutes: number; gradeScale: [string, number][]; proudGrades: string[]; ashamedGrades: string[] };
    conversion: Record<string, Record<string, number>>;
  };
  teen: {
    apprentice: { duration: { value: number }; xpMult: number; careers: string[]; moodlet: string };
    rebellion: { stressAbove: number; parentBondBelow: number; sneakChancePerNight: number; runawayChancePerDay: number; runawayDays: { value: number }; moodlet: string; sneakMoodlet: string };
  };
  adoption: { orphanageStages: string[]; fame: number; church: number; moodlet: string; orphanMoodlet: string; godparentMoodlet: string };
  household: { cap: number; controllableCap: number; crampedMoodlet: string };
  social: Record<string, unknown>;
  interactions: Record<string, unknown>;
  stages: { toddlerTags: string[]; toddlerInteractions: string[]; adultOnlyTags: string[]; adultOnlyInteractions: string[] };
}

export interface EducationDef {
  estates: string[];
  kind: 'home' | 'rabbithole' | 'boarding' | 'tutor';
  hours?: [number, number];
  days?: number[];
  awayDays?: number[];
  skills: Record<string, number>;
  childSkills: Record<string, number>;
  cost: number;
  costOnce?: boolean;
  church?: number;
  literate: boolean;
  homesickMoodlet?: string;
}

/** 아기 자리 (15-3) */
export type BabyPlace = { kind: 'cradle'; uid: number } | { kind: 'held'; by: number } | { kind: 'floor' };

export interface ChildcareHost {
  readonly persons: readonly Person[];
  readonly rng: Rng;
  minute(): number;
  hour(): number;
  day(): number;
  /** 요일 0 월 ~ 6 일 */
  weekday(): number;
  moodlet(p: Person, id: string): void;
  memory(p: Person, kind: string, importance: number, valence: number, withPerson: number): void;
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
  news(kind: string, args: Record<string, string | number>, subjects: Person[]): void;
  kill(p: Person, cause: string): void;
  /** 사망 설정 행렬 (20-7): 이 원인이 이 나이 그룹에서 켜져 있는가 */
  deathAllowed(cause: string, p: Person): boolean;
  /** 체감 기온 (℃) */
  feltTemp(p: Person): number;
  /** 이 사람 둘레 반경 안(같은 층)의 물건 defId 와 칸 */
  objectsNear(p: Person, radius: number): { uid: number; defId: string; x: number; y: number; lit: boolean }[];
  /** 요람: 빈 요람 uid (집 안), 요람 자리 좌표 */
  freeCradle(p: Person): number;
  cradleSpot(uid: number): { x: number; y: number } | null;
  /** 성인 스킬 경험치 (skills.ts). mult = 도제 배수 등 */
  skillXp(p: Person, skill: string, xp: number): void;
  /** 가계 돈 쓰기 (동화 단위), 가진 돈 */
  spend(household: number, amount: number, kind: string): boolean;
  /** 가문 명성/교회 평판 변화 (M8 명예 체계로 연결, 그 전에는 가문 카운터) */
  fame(household: number, delta: number, reason: string): void;
  church(p: Person, delta: number): void;
  /** 친척/교회 개입: 아이를 다른 가구로 (조부모/수녀원) */
  moveChild(child: Person, household: number, reason: string): void;
  /** 수도원(교회) 가구 번호 (없으면 -1) */
  churchHousehold(): number;
  /** 사람을 깨움 (잠 행동 중단) */
  wake(p: Person, moodlet: string): void;
  /** 직업을 도제로 시작 */
  setCareer(p: Person, careerId: string | null): boolean;
  /** 부모와의 우정 평균 (0~100, 부모가 없으면 50) */
  parentBond(p: Person): number;
  /** 새 아이 만들기 (입양): 단계, 신분, 가구 */
  createChild(stage: string, estate: string, household: number): Person | null;
  /** 가구 인원 (하인 포함) */
  householdSize(household: number): number;
  /** 사카드: 카드 제안 (카드 엔진 전에는 알림) */
  offerCard(p: Person, cardId: string, vars?: Record<string, string | number>): void;
}

const DEPENDENT = new Set(['baby', 'toddler']);

export class Childcare {
  /** 방치 분 (아기/유아 id → 욕구 0 연속 분) */
  private neglect = new Map<number, number>();
  /** 울음 무드렛을 마지막으로 준 분 (사람 id) */
  private noiseAt = new Map<number, number>();

  constructor(private host: ChildcareHost, readonly d: ChildcareData) {}

  static isDependent(p: Person): boolean {
    return DEPENDENT.has(p.lifeStage);
  }

  // ------------------------------------------------------------------ 기술 (유아 5, 아동 4)

  /** 레벨 n → n+1 필요 경험치 */
  needXp(kind: 'toddler' | 'child', level: number): number {
    const c = kind === 'toddler' ? this.d.toddler : this.d.child;
    return c.xpBase * Math.pow(Math.max(1, level), c.xpExp);
  }

  skillLevel(p: Person, skill: string): number {
    return p.childSkills[skill] ?? 0;
  }

  /** 유아/아동 스킬 경험치 (레벨 5 상한). 오르면 연출 알림, 걸음마·첫 말 무드렛 */
  teach(p: Person, skill: string, xp: number): void {
    const toddler = this.d.toddler.skills.includes(skill);
    const child = this.d.child.skills.includes(skill);
    if (!toddler && !child) {
      this.host.skillXp(p, skill, xp);
      return;
    }
    if (toddler && p.lifeStage !== 'toddler') return;
    if (child && p.lifeStage !== 'child' && p.lifeStage !== 'toddler') return;
    const lv = this.skillLevel(p, skill);
    if (lv >= 5) return;
    const k = `${skill}`;
    p.childSkillXp[k] = (p.childSkillXp[k] ?? 0) + xp;
    const need = this.needXp(toddler ? 'toddler' : 'child', lv + 1);
    if (p.childSkillXp[k] >= need) {
      p.childSkillXp[k] -= need;
      p.childSkills[skill] = lv + 1;
      this.host.notice(p, 'child_skill_up', { name: p.name, skill: `${toddler ? 'tskill' : 'cskill'}.${skill}`, level: lv + 1 });
      // 걸음마 (걷기 2 = 걷기 시작), 첫 말 (말하기 1): 부모 무드렛
      const parents = this.host.persons.filter((q) => q.id === p.mother || q.id === p.father);
      if (skill === 'walking' && lv + 1 === this.d.toddler.walkFromLevel) for (const q of parents) this.host.moodlet(q, 'first_steps_pride');
      if (skill === 'talking' && lv + 1 === 1) for (const q of parents) this.host.moodlet(q, 'first_word_joy');
      if (skill === 'potty' && lv + 1 === this.d.toddler.pottyDoneLevel) for (const q of parents) this.host.moodlet(q, 'potty_trained_relief');
    }
  }

  toddlerSkillAvg(p: Person): number {
    const s = this.d.toddler.skills;
    return s.reduce((a, k) => a + this.skillLevel(p, k), 0) / s.length;
  }

  pottyTrained(p: Person): boolean {
    if (p.lifeStage === 'baby') return false;
    if (p.lifeStage !== 'toddler') return true;
    return this.skillLevel(p, 'potty') >= this.d.toddler.pottyDoneLevel;
  }

  /** 유아 걷기 속도 배수 (기어다님 / 걸음마), 그 밖 1 */
  speedMult(p: Person): number {
    if (p.lifeStage !== 'toddler') return 1;
    return this.skillLevel(p, 'walking') >= this.d.toddler.walkFromLevel ? this.d.toddler.walkSpeedMult : this.d.toddler.crawlSpeedMult;
  }

  /** 유아가 걸을 때 동작 (렌더러): 기기 / 걷기 */
  moveAnim(p: Person): 'crawl' | 'walk' {
    return this.skillLevel(p, 'walking') >= this.d.toddler.walkFromLevel ? 'walk' : 'crawl';
  }

  // ------------------------------------------------------------------ 아기 (15-3)

  /** 갓난아기 자리: 집의 빈 요람, 없으면 엄마 품, 엄마가 없으면 바닥 */
  placeNewborn(baby: Person, mother: Person | null): void {
    const c = this.host.freeCradle(mother ?? baby);
    if (c >= 0) this.putInCradle(baby, c);
    else if (mother && this.host.persons.includes(mother)) this.hold(baby, mother);
    else baby.babyPlace = { kind: 'floor' };
  }

  putInCradle(baby: Person, uid: number): boolean {
    const spot = this.host.cradleSpot(uid);
    if (!spot) return false;
    this.release(baby);
    baby.babyPlace = { kind: 'cradle', uid };
    baby.x = spot.x;
    baby.y = spot.y;
    return true;
  }

  hold(baby: Person, by: Person): void {
    this.release(baby);
    baby.babyPlace = { kind: 'held', by: by.id };
    by.carry = 'baby';
    by.holding = baby.id;
    baby.x = by.x;
    baby.y = by.y;
  }

  /** 품에서 내려놓기: 빈 요람이 있으면 요람, 없으면 발치 바닥 */
  putDown(baby: Person): void {
    const place = baby.babyPlace;
    if (!place || place.kind !== 'held') return;
    const holder = this.host.persons.find((q) => q.id === place.by);
    this.release(baby);
    const c = this.host.freeCradle(holder ?? baby);
    if (c >= 0 && this.putInCradle(baby, c)) return;
    baby.babyPlace = { kind: 'floor' };
    if (holder) {
      baby.x = holder.x;
      baby.y = holder.y;
    }
  }

  private release(baby: Person): void {
    const place = baby.babyPlace;
    if (place?.kind === 'held') {
      const h = this.host.persons.find((q) => q.id === place.by);
      if (h && h.holding === baby.id) {
        h.holding = 0;
        if (h.carry === 'baby') h.carry = null;
      }
    }
    baby.babyPlace = null;
  }

  /** 아기의 한 분 (sim.tick 이 전체 세밀도 아기마다 부름): 욕구, 잠, 울음, 자리 따라가기, 방치 */
  babyTick(p: Person): void {
    const B = this.d.baby;
    const place = p.babyPlace;
    if (place?.kind === 'held') {
      const h = this.host.persons.find((q) => q.id === place.by);
      if (!h || h.holding !== p.id) this.putDown(p);
      else {
        p.x = h.x;
        p.y = h.y;
      }
    } else if (place?.kind === 'cradle') {
      const spot = this.host.cradleSpot(place.uid);
      if (!spot) p.babyPlace = { kind: 'floor' };
    } else if (!place) p.babyPlace = { kind: 'floor' };
    // 욕구: 5개만 줄고 나머지는 100
    for (const n of ['bladder', 'fun', 'comfort'] as NeedId[]) p.needs[NEED_INDEX[n]] = 100;
    for (const [n, v] of Object.entries(B.decayPerHour)) {
      const i = NEED_INDEX[n as NeedId];
      if (n === 'energy' && p.sleeping) continue;
      p.needs[i] = Math.max(0, p.needs[i] - (v as number) / 60);
    }
    // 유모 (귀족·기사·상인): 배고픔 하한
    if (p.wetNurse) p.needs[NEED_INDEX.hunger] = Math.max(p.needs[NEED_INDEX.hunger], B.wetNurse.hungerFloor);
    // 온기: 체감 기온 (안긴 아기는 사람 체온)
    const felt = place?.kind === 'held' ? 20 : this.host.feltTemp(p);
    const wi = NEED_INDEX.warmth;
    // 강보에 싸임: 추위를 덜 탐 (요람은 이불까지)
    const wrap = place?.kind === 'cradle' ? B.swaddleWarmth.cradle : B.swaddleWarmth.floor;
    if (felt < 15) p.needs[wi] = Math.max(0, p.needs[wi] - ((15 - felt) * 0.8 * wrap) / 60);
    else if (felt > 18) p.needs[wi] = Math.min(100, p.needs[wi] + (felt - 18) / 60);
    // 잠: 기력이 낮으면 자고 (울 일이 없을 때), 차면 깸
    const ei = NEED_INDEX.energy;
    const cryAt = B.cryBelow * this.cryMult(p);
    const hungry = p.needs[NEED_INDEX.hunger] < cryAt || p.needs[NEED_INDEX.hygiene] < cryAt || p.needs[wi] < cryAt;
    if (p.sleeping) {
      p.needs[ei] = Math.min(100, p.needs[ei] + B.sleepEnergyPerHour / 60);
      if (p.needs[ei] >= B.wakeAboveEnergy || hungry) p.sleeping = false;
    } else if (p.needs[ei] < B.sleepBelowEnergy && !hungry && place?.kind !== 'held') p.sleeping = true;
    p.pose = 'lie';
    // 울음: 욕구 하나라도 기준 아래 (잠든 아기는 배고플 때만 깸 → 위에서 처리)
    p.crying = !p.sleeping && this.lowNeed(p, cryAt);
    if (p.crying) this.cryNoise(p);
    this.neglectTick(p);
    this.starve(p, this.d.baby.starveMinutes?.value ?? 2880);
  }

  /** 기질별 울음 기준 배수 (traits.json effects.cryThreshold) */
  cryMult(p: Person): number {
    const tp = p.traits;
    if (tp.includes('temper_fussy')) return 1.3;
    if (tp.includes('temper_easy')) return 0.8;
    if (tp.includes('temper_timid')) return 1.1;
    return 1;
  }

  private lowNeed(p: Person, below: number): boolean {
    for (const n of ['hunger', 'energy', 'hygiene', 'social', 'warmth'] as NeedId[]) if (p.needs[NEED_INDEX[n]] < below) return true;
    return false;
  }

  /** 울음 → 같은 집(반경 안) 깬 식구는 시끄러움, 자는 식구는 깸 확률 (10분마다) */
  private cryNoise(p: Person): void {
    const m = this.host.minute();
    if (m % 10 !== 0) return;
    const B = this.d.baby;
    const H1 = 151;
    for (const q of this.host.persons) {
      if (q === p || q.household !== p.household || DEPENDENT.has(q.lifeStage)) continue;
      if (Math.floor(q.y / H1) !== Math.floor(p.y / H1) || Math.abs(q.x - p.x) > B.cryRadiusTiles || Math.abs(q.y - p.y) > B.cryRadiusTiles) continue;
      if (q.sleeping) {
        if (this.host.rng.next() < B.cryWakeChancePerHour / 6) this.host.wake(q, 'sleep_broken_by_baby');
        continue;
      }
      if ((this.noiseAt.get(q.id) ?? -1e9) + 60 <= m) {
        this.noiseAt.set(q.id, m);
        this.host.moodlet(q, 'baby_crying_noise');
      }
    }
  }

  /** 아기 굶주림 (사용자: 이틀 굶으면 죽음): 배고픔 0 이 이어진 분 */
  private starve(p: Person, deathMinutes: number): void {
    if (p.needs[NEED_INDEX.hunger] > 0) {
      p.hungerZeroMinutes = 0;
      return;
    }
    p.hungerZeroMinutes++;
    if (p.hungerZeroMinutes >= deathMinutes && this.host.deathAllowed('starvation', p)) {
      this.parentsGrieve(p, 'neglect');
      this.host.kill(p, 'starvation');
    }
  }

  /** 방치: 욕구 0 이 이어지면 개입 사건(친척/수녀원) 또는 사망 설정에 따른 위험 (15-3) */
  private neglectTick(p: Person): void {
    const N = this.d.baby.neglect;
    const zero = p.needs[NEED_INDEX.hunger] <= 0 || p.needs[NEED_INDEX.warmth] <= 0 || p.needs[NEED_INDEX.hygiene] <= 0;
    const cur = zero ? (this.neglect.get(p.id) ?? 0) + 1 : Math.max(0, (this.neglect.get(p.id) ?? 0) - 2);
    this.neglect.set(p.id, cur);
    if (cur < N.startMinutes.value) return;
    if (cur >= N.interveneMinutes.value && !p.neglectHandled) {
      p.neglectHandled = true;
      this.intervene(p);
      return;
    }
    // 개입 전 위험: 한 시간에 한 번 (사망 설정 '아이' 칸이 켜져 있을 때만)
    if (this.host.minute() % 60 === 0 && this.host.deathAllowed('illness', p) && this.host.rng.next() < N.deathChancePerHour) {
      this.parentsGrieve(p, 'neglect');
      this.host.kill(p, 'illness');
    }
  }

  /** 친척(조부모)이 데려가거나, 없으면 수녀원이 맡음. 부모 명예·교회 평판 크게 하락, 중요도 5 부정 기억 */
  intervene(p: Person): void {
    const N = this.d.baby.neglect;
    const parents = this.host.persons.filter((q) => q.id === p.mother || q.id === p.father);
    const grand = this.host.persons.find((q) => q.household !== p.household && parents.some((par) => q.id === par.mother || q.id === par.father) && !DEPENDENT.has(q.lifeStage));
    const to = grand ? grand.household : this.host.churchHousehold();
    for (const q of parents) {
      this.host.memory(q, grand ? 'child_taken_relatives' : 'child_taken_convent', N.parentMemoryImportance, -1, p.id);
      this.host.moodlet(q, 'taken_by_relatives_shame');
      this.host.church(q, -N.churchLoss);
    }
    this.host.fame(p.household, -N.fameLoss, 'baby_neglect');
    this.host.offerCard(parents[0] ?? p, grand ? 'baby_neglect_relatives_take' : 'baby_neglect_convent', { child: p.name });
    this.neglect.delete(p.id);
    if (to >= 0) {
      this.release(p);
      this.host.moveChild(p, to, grand ? 'relatives' : 'convent');
    }
  }

  private parentsGrieve(p: Person, kind: string): void {
    for (const q of this.host.persons) {
      if (q.id !== p.mother && q.id !== p.father) continue;
      this.host.memory(q, `child_death_${kind}`, this.d.baby.neglect.parentMemoryImportance, -1, p.id);
      this.host.moodlet(q, 'lost_child_grief');
      if (kind === 'neglect') this.host.moodlet(q, 'neglected_child_guilt');
    }
  }

  /** 유모 고용 (15-3, 귀족·기사·상인): 하루 값, 아기 배고픔 하한 */
  hireWetNurse(baby: Person, payer: Person): boolean {
    const W = this.d.baby.wetNurse;
    if (baby.lifeStage !== 'baby' || !W.estates.includes(payer.estate)) return false;
    if (!this.host.spend(payer.household, W.pricePerDay, 'servants')) return false;
    baby.wetNurse = true;
    return true;
  }

  // ------------------------------------------------------------------ 유아 (15-4)

  /** 유아 기저귀: 배변 훈련 전에는 방광 0 → 기저귀가 젖음 (실수 알림 없음), 위생 0 */
  diaper(p: Person): boolean {
    if (p.lifeStage !== 'toddler' || this.pottyTrained(p)) return false;
    if (p.needs[NEED_INDEX.bladder] > 0) return false;
    p.needs[NEED_INDEX.bladder] = 100;
    p.needs[NEED_INDEX.hygiene] = Math.min(p.needs[NEED_INDEX.hygiene], 5);
    return true;
  }

  /** 유아 한 분: 욕구가 기준 아래면 울음 (기저귀·배고픔·졸림·외로움), 채워지면 그침 */
  toddlerMinute(p: Person): void {
    if (p.lifeStage !== 'toddler') return;
    const below = this.d.toddler.cryBelow * this.cryMult(p);
    let low = false;
    for (const n of ['hunger', 'energy', 'hygiene', 'social', 'warmth'] as NeedId[]) if (p.needs[NEED_INDEX[n]] < below) low = true;
    p.crying = low && !p.sleeping;
  }

  /** 유아 한 시간: 위험(어른 없이 화로·우물·계단 가까이), 떼쓰기, 스스로 놀며 크는 기술 */
  toddlerHour(p: Person): void {
    const T = this.d.toddler;
    const near = this.host.objectsNear(p, T.hazardRadiusTiles).filter((o) => T.hazardObjects.includes(o.defId) && (o.defId !== 'hearth' || o.lit));
    if (near.length) {
      const guard = this.host.persons.some((q) => q !== p && q.household === p.household && !DEPENDENT.has(q.lifeStage) && q.lifeStage !== 'child' && Math.abs(q.x - p.x) <= T.guardRadiusTiles && Math.abs(q.y - p.y) <= T.guardRadiusTiles && !q.sleeping);
      if (!guard && this.host.rng.next() < T.hazardChancePerHour) {
        const parents = this.host.persons.filter((q) => q.id === p.mother || q.id === p.father);
        if (this.host.deathAllowed('accident', p)) {
          this.parentsGrieve(p, 'accident');
          this.host.news('death_child_accident', { a: p.name }, [p]);
          this.host.kill(p, 'accident');
          return;
        }
        // 사고 칸이 꺼져 있으면 부상 (M11 부상 체계 전에는 겁먹음 + 부모 놀람)
        this.host.moodlet(p, 'child_near_hearth_scare');
        for (const q of parents) this.host.moodlet(q, 'child_near_hearth_scare');
      }
    }
    if (p.needs[NEED_INDEX.fun] < T.tantrumFunBelow && this.host.rng.next() < T.tantrumChancePerHour) {
      p.tantrumUntil = this.host.minute() + 20;
      for (const q of this.host.persons) if (q.household === p.household && q !== p && Math.abs(q.x - p.x) < 8 && Math.abs(q.y - p.y) < 8) this.host.moodlet(q, 'tantrum_annoyed');
    }
    // 스스로 놀며 조금씩 (15-4 "스스로 놀기로 오름")
    for (const s of ['walking', 'thinking']) this.teach(p, s, T.selfPlayXpPerMinute * 60 * 0.3);
  }

  // ------------------------------------------------------------------ 돌봄 자율 후보

  /**
   * 돌봄 후보 (13-4 효용 AI 확장): 같은 가구의 아기/유아(와 과제 있는 아동, 생일인 식구)마다 가능한 돌봄 행동 점수.
   * 점수 = Σ 아이 욕구 긴급도 × careAds × 부모 배수 × 성향 ÷ (1 + 거리/기준). 가장 높은 돌봄 하나를 그 아이 후보로
   */
  careCandidates(
    p: Person,
    push: (interactionId: string, targetId: number, score: number) => void,
    defs: readonly [string, { careAds?: Record<string, number>; requires?: unknown }][],
    available: (p: Person, t: Person, id: string) => boolean,
    urgency: (need: NeedId, value: number) => number,
    distRef: number,
  ): void {
    if (DEPENDENT.has(p.lifeStage)) return;
    for (const t of this.host.persons) {
      if (t === p || t.household !== p.household) continue;
      const dep = DEPENDENT.has(t.lifeStage);
      if (!dep && !t.homework && t.lastBirthdayDay !== this.host.day()) continue;
      const dist = Math.hypot(t.x - p.x, (t.y % 151) - (p.y % 151));
      if (dist > 48) continue;
      let best = 0;
      let bestId = '';
      for (const [id, def] of defs) {
        const ads = def.careAds;
        if (!ads) continue;
        let s = 0;
        for (const [k, w] of Object.entries(ads)) {
          if (k === 'teach') s += dep && t.lifeStage === 'toddler' ? w * 0.4 : 0;
          else if (k === 'homework') s += t.homework ? w : 0;
          else if (k === 'birthday') s += t.lastBirthdayDay === this.host.day() && !t.celebratedBy.includes(p.id) ? w : 0;
          else if (k in NEED_INDEX) s += w * urgency(k as NeedId, t.needs[NEED_INDEX[k as NeedId]]);
        }
        if (s <= 0.02) continue;
        if (!available(p, t, id)) continue;
        if (s > best) {
          best = s;
          bestId = id;
        }
      }
      if (!bestId) continue;
      // 우는 아이: 모든 돌봄이 급해짐 (무엇 때문에 우는지는 욕구 광고가 가림)
      let mult = t.crying ? 1.6 : 1;
      if (p.id === t.mother || p.id === t.father) mult *= 1.6;
      if (p.traits.includes('family_oriented')) mult *= 1.3;
      if (p.traits.includes('lazy')) mult *= 0.7;
      if (p.lifeStage === 'child') mult *= 0.5;
      push(bestId, t.id, (best * mult) / (1 + dist / distRef));
    }
  }

  // ------------------------------------------------------------------ 아동 교육 (15-5)

  /** 교육 경로 정하기 (가장). 신분이 안 맞으면 거부 */
  setEducation(child: Person, path: string, head: Person | null): { ok: boolean; reason?: string } {
    const e = this.d.child.education[path];
    if (!e) return { ok: false, reason: 'unknown' };
    const estate = head?.estate ?? child.estate;
    if (!e.estates.includes(estate)) return { ok: false, reason: 'estate' };
    if (child.lifeStage !== 'child') return { ok: false, reason: 'stage' };
    if (e.costOnce && e.cost > 0 && !this.host.spend(child.household, e.cost, 'education')) return { ok: false, reason: 'no_money' };
    child.education = path;
    return { ok: true };
  }

  /** 아동이 되면 기본 경로 (가장 신분) */
  defaultEducation(child: Person, headEstate: string): void {
    child.education = this.d.child.defaultEducation[headEstate] ?? 'home_help';
  }

  /** 지금 학교/기숙/시동으로 집에 없어야 하는가 (시간표) */
  awayForSchool(p: Person): boolean {
    if (p.lifeStage !== 'child' || !p.education) return false;
    const e = this.d.child.education[p.education];
    if (!e) return false;
    const wd = this.host.weekday();
    if (e.kind === 'boarding') return (e.awayDays ?? []).includes(wd);
    if (e.kind === 'rabbithole') {
      const h = this.host.hour();
      return (e.days ?? []).includes(wd) && h >= (e.hours?.[0] ?? 8) && h < (e.hours?.[1] ?? 12);
    }
    return false;
  }

  /** 수업 한 시간 (학교/기숙/가정교사/집안일): 스킬, 아동 스킬, 과제 */
  lessonHour(p: Person): void {
    const e = p.education ? this.d.child.education[p.education] : null;
    if (!e) return;
    const wd = this.host.weekday();
    const h = this.host.hour();
    let inLesson = false;
    if (e.kind === 'boarding') inLesson = (e.awayDays ?? []).includes(wd) && h >= 8 && h < 16;
    else if (e.kind === 'home') inLesson = wd < 6 && h >= 9 && h < 12;
    else inLesson = (e.days ?? []).includes(wd) && h >= (e.hours?.[0] ?? 8) && h < (e.hours?.[1] ?? 12);
    if (!inLesson) return;
    for (const [s, per] of Object.entries(e.skills)) this.host.skillXp(p, s, per * 60);
    for (const [s, per] of Object.entries(e.childSkills)) this.teach(p, s, per * 60);
    // 학교 경로면 그날 과제 (저녁까지)
    if (e.literate && e.kind !== 'boarding' && !p.homework) p.homework = { day: this.host.day(), progress: 0 };
  }

  /** 과제 진척 (0~1). 채우면 끝 */
  homeworkProgress(p: Person, amount: number): void {
    if (!p.homework) return;
    p.homework.progress = Math.min(1, p.homework.progress + amount);
    if (p.homework.progress >= 1) this.finishHomework(p, 1);
  }

  private finishHomework(p: Person, done: number): void {
    const n = p.gradeDays;
    p.gradeScore = (p.gradeScore * n + done) / (n + 1);
    p.gradeDays = n + 1;
    p.homework = null;
    if (done >= 1) this.host.moodlet(p, 'homework_done');
  }

  /** 성적 A~F (15-5) */
  grade(p: Person): string {
    for (const [g, min] of this.d.child.homework.gradeScale) if (p.gradeScore >= min) return g;
    return 'F';
  }

  /** 하루 끝: 못 한 과제는 진척만큼, 한 주마다 성적 무드렛, 기숙은 향수, 아동 스킬 → 청년 전환은 lifecycle.onStageChanged 에서 */
  dayEnd(p: Person): void {
    if (p.homework) this.finishHomework(p, p.homework.progress);
    if (p.lifeStage === 'child' && p.gradeDays > 0 && p.gradeDays % 5 === 0 && p.gradeWeek !== p.gradeDays) {
      p.gradeWeek = p.gradeDays;
      const g = this.grade(p);
      if (this.d.child.homework.proudGrades.includes(g)) this.host.moodlet(p, 'school_proud');
      if (this.d.child.homework.ashamedGrades.includes(g)) this.host.moodlet(p, 'school_ashamed');
    }
    const e = p.education ? this.d.child.education[p.education] : null;
    if (e?.homesickMoodlet && this.awayForSchool(p)) this.host.moodlet(p, e.homesickMoodlet);
    if (e && !e.costOnce && e.cost > 0 && (e.days ?? e.awayDays ?? []).includes(this.host.weekday())) this.host.spend(p.household, e.cost, 'education');
  }

  /** 청년이 될 때: 아동 스킬 → 성인 스킬 보너스 레벨, 가문에 대한 애정 (15-6) */
  onAdulthood(p: Person): void {
    for (const [cs, map] of Object.entries(this.d.child.conversion)) {
      const lv = this.skillLevel(p, cs);
      if (!lv) continue;
      for (const [skill, per] of Object.entries(map)) this.host.skillXp(p, skill, lv * per * 100);
    }
    p.clanAffection = Math.round(this.host.parentBond(p));
  }

  // ------------------------------------------------------------------ 청소년 (15-6)

  /** 도제 계약: 장인 집에서 일을 배움 (급여 없음, 경험치 배수), 기간 lifespan */
  apprentice(teen: Person, careerId: string, lifespan: number): { ok: boolean; reason?: string } {
    const A = this.d.teen.apprentice;
    if (teen.lifeStage !== 'teen') return { ok: false, reason: 'stage' };
    if (!A.careers.includes(careerId)) return { ok: false, reason: 'career' };
    if (!this.host.setCareer(teen, careerId)) return { ok: false, reason: 'career' };
    teen.apprentice = { career: careerId, until: this.host.day() + A.duration.value * lifespan };
    this.host.moodlet(teen, A.moodlet);
    return { ok: true };
  }

  /** 도제 경험치 배수 */
  xpMult(p: Person): number {
    return p.apprentice && this.host.day() < p.apprentice.until ? this.d.teen.apprentice.xpMult : 1;
  }

  /** 밤(22시)마다: 반항 (몰래 나가기), 하루 한 번 가출 판정 → 결과 종류 */
  rebellionCheck(p: Person): 'none' | 'sneak' | 'runaway' {
    const R = this.d.teen.rebellion;
    if (p.lifeStage !== 'teen' || p.stress < R.stressAbove || this.host.parentBond(p) >= R.parentBondBelow) return 'none';
    this.host.moodlet(p, R.moodlet);
    if (this.host.rng.next() < R.runawayChancePerDay) return 'runaway';
    if (this.host.rng.next() < R.sneakChancePerNight) {
      this.host.moodlet(p, R.sneakMoodlet);
      return 'sneak';
    }
    return 'none';
  }

  // ------------------------------------------------------------------ 입양, 후견 (15-7)

  /** 고아원(수도원)에서 입양: 가정 상한 안에서만. 명예·교회 평판 + */
  adopt(parent: Person, stage: string): { ok: boolean; reason?: string; child?: Person } {
    const A = this.d.adoption;
    if (!A.orphanageStages.includes(stage)) return { ok: false, reason: 'stage' };
    if (this.host.householdSize(parent.household) >= this.d.household.cap) return { ok: false, reason: 'household_full' };
    const child = this.host.createChild(stage, parent.estate, parent.household);
    if (!child) return { ok: false, reason: 'no_orphan' };
    child.mother = parent.sex === 'female' ? parent.id : parent.spouse;
    child.father = parent.sex === 'male' ? parent.id : parent.spouse;
    child.adopted = true;
    this.host.fame(parent.household, A.fame, 'adoption');
    for (const q of this.host.persons) if (q.household === parent.household && !DEPENDENT.has(q.lifeStage) && q !== child) {
      this.host.moodlet(q, A.moodlet);
      if (q.id === parent.id || q.id === parent.spouse) this.host.church(q, A.church);
    }
    return { ok: true, child };
  }

  /** 대부모 지정 (세례 때, 21장): 부모가 죽으면 후견인 */
  setGodparent(child: Person, god: Person): boolean {
    if (god === child || DEPENDENT.has(god.lifeStage) || god.lifeStage === 'child') return false;
    child.godparent = god.id;
    this.host.moodlet(god, this.d.adoption.godparentMoodlet);
    return true;
  }

  /**
   * 누군가 죽은 뒤: 부모를 모두 잃은 18세 전 아이는 대부모 → 조부모/친척 가구 → 교회(고아원) 순으로 맡겨짐.
   * 조작 가문 친척이 맡을 수 있으면 카드(orphan_relative)로 알림
   */
  onDeath(dead: Person, alive: (id: number) => Person | undefined, isMinor: (p: Person) => boolean): void {
    for (const c of this.host.persons) {
      if (c.mother !== dead.id && c.father !== dead.id) continue;
      if (!isMinor(c)) continue;
      const mom = c.mother ? alive(c.mother) : undefined;
      const dad = c.father ? alive(c.father) : undefined;
      if (mom || dad) continue;
      this.host.moodlet(c, this.d.adoption.orphanMoodlet);
      const god = c.godparent ? alive(c.godparent) : undefined;
      const kin = god ?? this.host.persons.find((q) => q.household !== c.household && !DEPENDENT.has(q.lifeStage) && q.lifeStage !== 'child' && (q.id === dead.mother || q.id === dead.father || (q.mother && q.mother === dead.mother) || (q.father && q.father === dead.father)));
      if (kin && this.host.householdSize(kin.household) < this.d.household.cap) {
        if (kin.household === 1) this.host.offerCard(kin, 'orphan_relative', { child: c.name });
        this.host.moveChild(c, kin.household, god ? 'godparent' : 'relatives');
      } else {
        const ch = this.host.churchHousehold();
        // 같은 가구 안에 어른 식구(형제 등)가 있으면 그대로 살게 둠
        const grownSibling = this.host.persons.some((q) => q.household === c.household && q !== c && !isMinor(q));
        if (!grownSibling && ch >= 0) this.host.moveChild(c, ch, 'convent');
      }
    }
  }

  // ------------------------------------------------------------------ 가정 인원 (15-8)

  /** 출생으로 상한을 넘으면 비좁음 무드렛 + 분가/해고 알림 (출생은 늘 허용) */
  afterBirth(household: number): void {
    const H = this.d.household;
    const size = this.host.householdSize(household);
    if (size <= H.cap) return;
    for (const q of this.host.persons) if (q.household === household && !DEPENDENT.has(q.lifeStage)) this.host.moodlet(q, H.crampedMoodlet);
    const head = this.host.persons.find((q) => q.household === household && !DEPENDENT.has(q.lifeStage));
    if (head) this.host.notice(head, 'household_full', { n: size, cap: H.cap });
  }

  /** 들어올 수 있는가 (혼인·입양·하인): 상한이면 불가 */
  canJoin(household: number, n = 1): boolean {
    return this.host.householdSize(household) + n <= this.d.household.cap;
  }

  /** 자율 허용: 아기 없음, 유아는 유아 태그·잠·먹기만, 아동은 어른 전용 빼고 */
  allowInteraction(p: Person, interactionId: string, tags: readonly string[]): boolean {
    const S = this.d.stages;
    if (p.lifeStage === 'baby') return false;
    if (p.lifeStage === 'toddler') return S.toddlerInteractions.includes(interactionId) || tags.some((t) => S.toddlerTags.includes(t));
    if (p.lifeStage === 'child') return !S.adultOnlyInteractions.includes(interactionId) && !tags.some((t) => S.adultOnlyTags.includes(t));
    return true;
  }
}
