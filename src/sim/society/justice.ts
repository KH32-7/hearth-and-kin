/**
 * 범죄와 재판 (GDD 18-6).
 * - 범죄 9종: 절도, 밀렵, 폭행, 사기, 사치 금지법 위반, 이단, 불법 도박, 방화 + 뇌물 (justice.json crimes)
 * - 발생: NPC 하루 1회 확률 = 기본 × 일과 장소 × 특성 × 형편(가난) × 신분 × 치안 정책(crimeMult) × 사냥 정책(밀렵).
 *   조작 가문은 스스로 죄를 짓지 않음 (카드·플레이어 선택으로만: onCardFlag)
 * - 발각: 경비 순찰(치안 detectMult), 같은 장소 목격자(신고하거나 소문만 냄), 피해자 고발, 원한 고발(feud → accuse)
 * - 체포 → 재판 (영주 대전). NPC끼리는 즉시 계산, 조작 가문이 피고면 재판 장면 상태(Trial)로 대기 → 의도로 진행
 *   (trialPlea, trialCallWitness, kinPetition, kinBribe, kinPersuade, trialAdvance). 재판 전 가족은 사회 상호작용으로도 탄원/뇌물/증인 설득
 * - 판결: 증거 세기 − 변론(화술·셈) − 신분 차 − 명예 + 증인 ± 가족 → 유죄 확률. 처벌 사다리 (벌금 → 칼 → 태형 → 감옥 → 추방 → 몰수 → 처형)
 *   처형은 사망 설정 행렬 "execution" 이 꺼져 있으면 추방으로 대체. 고문과 화형은 다루지 않음
 * - 결과: 소문(convicted/acquitted/fair_judgment), 무드렛, 소식 news.verdict_*, 가문 명성, 연대기
 * 벌금은 host.fine (리드: econ 지출 + sim.house.finesToday 에 더함 → 영지 정산이 fief.finesTo 대로 금고/영주 가문에 넣음).
 * 무작위는 host.rng 만. 렌더러/DOM 없음 (워커)
 */
import { z } from 'zod';
import type { Rng } from '../core/rng';
import type { Person } from '../people/person';
import type { DeathRulesView } from '../health/deathRules';
import { atLeastTeen, clamp, durDays, durSchema, grownUp, stripDollar, type PolicyEffects } from './policy';

export const CRIMES = ['theft', 'poaching', 'assault', 'fraud', 'sumptuary', 'heresy', 'illegal_gambling', 'arson', 'bribery'] as const;
export type CrimeId = (typeof CRIMES)[number];
export const PUNISHMENTS = ['fine', 'pillory', 'flogging', 'jail', 'exile', 'confiscation', 'execution'] as const;
export type Punishment = (typeof PUNISHMENTS)[number];
export const PLEAS = ['mercy', 'argue', 'witness', 'bribe', 'silent'] as const;
export type Plea = (typeof PLEAS)[number];
export type TrialStage = 'pending' | 'opening' | 'plea' | 'witness' | 'kin' | 'verdict' | 'done';

const num = z.number();
const rec = z.record(z.string(), num);
const crimeSchema = z.object({
  base: num,
  hour: z.number().int().min(0).max(23),
  grudgeMult: num.optional(),
  places: rec,
  traits: rec,
  poor: num,
  estates: rec,
  patrol: num,
  witnessPer: num,
  severity: z.number().int().min(0),
  punish: z.array(z.enum(PUNISHMENTS)).min(1),
  fine: num,
  fame: num,
  karma: num,
  rumor: z.string(),
  victim: z.boolean().optional(),
});
export type CrimeDef = z.infer<typeof crimeSchema>;

export const justiceSchema = z.object({
  crimes: z.object(Object.fromEntries(CRIMES.map((c) => [c, crimeSchema])) as Record<CrimeId, typeof crimeSchema>),
  estateFineMult: rec,
  estateRank: rec,
  minStage: z.string(),
  poorBelow: num,
  reportChance: z.object({ base: num, traits: rec, friendBelow: num, friendMult: num }),
  victimAccuse: num,
  evidence: z.object({ patrol: num, witness: num, extraWitness: num, victim: num, accuseTrue: num, accuseFalse: num, card: num }),
  recentCrimes: durSchema,
  accuseCooldown: durSchema,
  trial: z.object({
    delay: durSchema,
    hour: num,
    autoMinutes: num,
    maxWitnesses: z.number().int(),
    callWitnessMin: num,
    witnessFor: num,
    witnessAgainst: num,
    estateGap: num,
    estateGapMax: num,
    honorDiv: num,
    fameTier: rec,
    argue: z.object({ perStory: num, perReckoning: num, max: num, guiltyMult: num }),
    mercy: z.object({ evidence: num, steps: z.number().int() }),
    silent: num,
    bribe: z.object({ shareS: num, base: num, traits: rec, evidence: num, failEvidence: num }),
    kinPetition: z.object({ base: num, perStory: num, perLordFavor: num, steps: z.number().int() }),
    kinPersuade: z.object({ base: num, perStory: num, perFriendship: num }),
    npcKinPetition: num,
    highEvidenceStep: num,
    stepChance: num,
    fairRumorChance: num,
    falseAccuserFame: num,
  }),
  punish: z.object({
    pillory: durSchema,
    pilloryPlace: z.string(),
    jailMin: durSchema,
    jailMax: durSchema,
    longJail: durSchema,
    executionFallback: z.enum(['exile', 'jail']),
    executionPlace: z.string(),
    stepFame: num,
    stepFine: num,
  }),
  moodlets: z.record(z.string(), z.string()),
}).loose();
export type JusticeData = z.infer<typeof justiceSchema>;

/** SimData.family.justice (justice.json 원본) 의 justice 칸 */
export function parseJustice(raw: unknown): JusticeData | null {
  const r = (raw as { justice?: unknown } | null | undefined)?.justice;
  return r ? justiceSchema.parse(stripDollar(r)) : null;
}

// ------------------------------------------------------------------ Host

export interface JusticeHost {
  readonly persons: readonly Person[];
  readonly rng: Rng;
  day(): number;
  /** 절대 게임 분 */
  minute(): number;
  lifespan(): number;
  seasonDays(): number;
  controlled(household: number): boolean;
  /** 일과표상 장소 (Town.schedulePlace): "home:<가구>", 공공 장소 id, 또는 null */
  placeAt(p: Person, minute: number): string | null;
  /** 공공 장소 종류 */
  placeKind(placeId: string): string | null;
  policy(): PolicyEffects | null;
  deathRules(): DeathRulesView | null;
  friendship(a: Person, b: Person): number;
  skillLevel(p: Person, skill: string): number;
  /** 가구 돈 ÷ 한 인생 저축 S (형편, 가난 판정) */
  wealthRatio(household: number): number;
  /** 한 인생 저축 S (파딩, 뇌물 크기) */
  savingsS(household: number): number;
  money(household: number): number;
  /** 가문 명성 단계 id (Clans TIERS: dishonored … legendary) */
  fameTier(household: number): string;
  lordFavor(household: number): number;
  /** 재판관: 영주 (없으면 집행관). 없으면 null (그래도 재판은 함) */
  judge(): Person | null;
  /** 원한 상대 (Feuds.grudgesOf): 방화 배수, 고발 */
  grudgeTargets(p: Person): readonly Person[];
  /** 벌금: econ 지출(모자라면 외상) + sim.house.finesToday += amount */
  fine(household: number, amount: number, reason: string): void;
  /** 가구 사이 돈 (뇌물). 모자라면 false */
  pay(fromHousehold: number, toHousehold: number, amount: number, reason: string): boolean;
  /** 가문 명성 (HouseLink.fame: by = 개인 명예) */
  fame(household: number, delta: number, reason: string, by?: Person | null): void;
  karma(p: Person, delta: number): void;
  moodlet(p: Person, id: string): void;
  memory(p: Person, kind: string, importance: number, valence: number, withPerson: number): void;
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
  news(kind: string, args: Record<string, string | number>, subjects: Person[]): void;
  chronicle(trigger: string, subjects: Person[], args?: Record<string, string | number>): void;
  /** 소문 (Rumors.add). knownBy = 처음부터 아는 사람 */
  rumor(subject: Person, kind: string, good: boolean, strength: number, knownBy?: Person[]): void;
  /** 체포: 재판까지 성 감옥에 붙잡아 둠 (강제 래빗홀, untilMinute 까지) / 풀어 줌 */
  detain(p: Person, untilMinute: number): void;
  release(p: Person): void;
  /** 처벌 실행 */
  pillory(p: Person, minutes: number, place: string): void;
  /** 태형: 부상 훅 (20-4 원인 "태형") */
  flog(p: Person): void;
  /** 감옥: 강제 래빗홀 days 일 (absolute) */
  jail(p: Person, days: number): void;
  /** 추방: 마을을 떠남 (이주와 같음, 돌아오지 않음) */
  exile(p: Person): void;
  /** 재산 몰수: heirlooms.onConfiscation + 재산 압류 (EstatesHost.confiscate 와 같은 것) */
  confiscate(household: number): void;
  /** 중죄 신분 박탈 (estates.felony). 기사면 revokeKnighthood 도 */
  felony(p: Person): void;
  kill(p: Person, cause: 'execution'): void;
  /** 재판 장면 (27-7 차단 장면) 열기/닫기 */
  startTrialScene(t: Trial): void;
  endTrialScene(t: Trial): void;
}

// ------------------------------------------------------------------ 상태

export interface CrimeRecord {
  id: number;
  crime: CrimeId;
  offender: number;
  victim: number;
  day: number;
  minute: number;
  place: string | null;
  detected: boolean;
  /** 본 사람 (신고 안 해도 고발할 수 있음) */
  witnesses: number[];
}

export interface TrialWitness {
  id: number;
  side: 'for' | 'against';
  persuaded: boolean;
}

export interface Verdict {
  guilty: boolean;
  punish: Punishment | null;
  /** 처형이 꺼져 대체된 처벌 */
  replaced: Punishment | null;
  prob: number;
  amount: number;
  days: number;
}

/** 재판 장면 상태 (27-7 차단 장면이 그대로 그림) */
export interface Trial {
  id: number;
  crime: CrimeId;
  extra: CrimeId[];
  accused: number;
  /** 고발인 (0 = 경비) */
  accuser: number;
  victim: number;
  judge: number;
  witnesses: TrialWitness[];
  evidence: number;
  truth: boolean;
  stage: TrialStage;
  /** 재판 시각 (절대 분), 이 단계에 들어온 분 */
  at: number;
  stageAt: number;
  plea: Plea | null;
  /** 판결 사다리 보정 (자비·탄원) */
  mercySteps: number;
  kin: { kind: 'petition' | 'bribe' | 'persuade'; by: number; ok: boolean }[];
  /** 대사창 줄 (i18n 키 + 인자) */
  lines: { key: string; args: Record<string, string | number> }[];
  verdict: Verdict | null;
  controlled: boolean;
  /** 사건 카드가 판결을 정함 (trial_verdict_plea) */
  viaCard: boolean;
}

export type TrialIntent =
  | { kind: 'trialPlea'; trial?: number; option: Plea }
  | { kind: 'trialCallWitness'; trial?: number; id: number }
  | { kind: 'kinPetition'; trial?: number; by: number }
  | { kind: 'kinBribe'; trial?: number; by: number; amount?: number }
  | { kind: 'kinPersuade'; trial?: number; by: number; witness: number }
  | { kind: 'trialAdvance'; trial?: number };

export interface JusticeState {
  records: CrimeRecord[];
  trials: Trial[];
  /** 사람별 유죄 횟수 (처벌 사다리) */
  offenses: Record<number, number>;
  /** "고발인:대상" → 마지막 고발한 날 */
  accused: Record<string, number>;
  nextId: number;
}

export interface JusticeStats {
  committed: Record<string, number>;
  detected: Record<string, number>;
  trials: number;
  convictions: number;
  acquittals: number;
  punish: Record<string, number>;
  fines: number;
  falseAccusations: number;
  /** 날별 발생 수 */
  byDay: number[];
}

const CARD_CRIME: Record<string, CrimeId> = { poaching_temptation: 'poaching', riot_brewing: 'assault', tavern_brawl: 'assault', high_tax_proclamation: 'fraud' };
const CARD_VERDICT: Record<string, Punishment | 'acquit' | 'law'> = {
  verdict_fine: 'fine',
  sentenced_pillory: 'pillory',
  verdict_acquitted: 'acquit',
  sentenced_jail: 'jail',
  verdict_by_law: 'law',
};

export class Justice {
  state: JusticeState = { records: [], trials: [], offenses: {}, accused: {}, nextId: 1 };
  readonly stats: JusticeStats = { committed: {}, detected: {}, trials: 0, convictions: 0, acquittals: 0, punish: {}, fines: 0, falseAccusations: 0, byDay: [] };
  private todayCount = 0;

  constructor(private host: JusticeHost, readonly d: JusticeData) {}

  private byId(id: number): Person | undefined {
    return this.host.persons.find((p) => p.id === id);
  }

  private days(d: { value: number; scale: 'absolute' | 'season' | 'lifespan' | 'per_life' }): number {
    return durDays(d, this.host.lifespan(), this.host.seasonDays());
  }

  // ---------------------------------------------------------------- 발생 (자정)

  /** 이 사람의 이 죄 하루 확률 (특성·형편·신분·장소·정책) */
  rate(p: Person, crime: CrimeId, day: number): number {
    const H = this.host;
    const c = this.d.crimes[crime];
    if (c.base <= 0) return 0;
    let r = c.base;
    const em = c.estates[p.estate];
    if (em !== undefined) r *= em;
    if (r <= 0) return 0;
    for (const t of p.traits) r *= c.traits[t] ?? 1;
    if (H.wealthRatio(p.household) < this.d.poorBelow) r *= c.poor;
    const pl = H.placeAt(p, day * 1440 + c.hour * 60);
    const kind = pl === null ? 'none' : pl.startsWith('home:') ? 'home' : H.placeKind(pl) ?? pl;
    r *= c.places[kind] ?? c.places.none ?? 1;
    if (p.lifeStage === 'teen') r *= 0.6;
    if (p.lifeStage === 'elder') r *= 0.5;
    const pol = H.policy();
    if (pol) {
      r *= pol.crimeMult();
      if (crime === 'poaching') r *= pol.poachingMult();
    }
    if (c.grudgeMult && H.grudgeTargets(p).length) r *= c.grudgeMult;
    return r;
  }

  /**
   * 자정 한 번 (방금 끝난 날 day): NPC 범죄 발생 → 발각 → NPC 재판 즉시. 사람마다 난수 한 번 (+ 죄가 나면 더)
   */
  daily(day: number): void {
    const H = this.host;
    this.todayCount = 0;
    const cands = H.persons.filter((p) => !H.controlled(p.household) && atLeastTeen(p) && !this.inJail(p));
    for (const p of cands) {
      const u = H.rng.next();
      let total = 0;
      const rates: number[] = [];
      for (const c of CRIMES) {
        const r = this.rate(p, c, day);
        rates.push(r);
        total += r;
      }
      if (u >= total) continue;
      const i = Math.max(0, H.rng.weighted(rates));
      this.commit(p, CRIMES[i], day);
    }
    // 오래된 기록 정리
    const keep = this.days(this.d.recentCrimes);
    this.state.records = this.state.records.filter((r) => day - r.day <= keep);
    this.stats.byDay.push(this.todayCount);
  }

  private inJail(p: Person): boolean {
    return this.state.trials.some((t) => t.accused === p.id && t.stage !== 'done');
  }

  /** 죄를 저지름 (NPC 자율, 카드, 원한 행동). 발각 판정까지. 기록을 돌려줌 */
  commit(p: Person, crime: CrimeId, day = this.host.day(), victim: Person | null = null): CrimeRecord {
    const H = this.host;
    const c = this.d.crimes[crime];
    const minute = day * 1440 + c.hour * 60;
    const place = H.placeAt(p, minute);
    // 피해자: 같은 장소에 있던 사람 (방화는 원한 상대)
    let v = victim;
    const here = place ? H.persons.filter((q) => q !== p && !q.infant && H.placeAt(q, minute) === place) : [];
    if (!v && c.victim) {
      if (crime === 'arson') v = H.grudgeTargets(p)[0] ?? null;
      else if (here.length) v = here[Math.floor(H.rng.next() * here.length)];
    }
    const rec: CrimeRecord = { id: this.state.nextId++, crime, offender: p.id, victim: v?.id ?? 0, day, minute, place, detected: false, witnesses: [] };
    this.state.records.push(rec);
    this.stats.committed[crime] = (this.stats.committed[crime] ?? 0) + 1;
    this.todayCount++;
    if (c.karma) H.karma(p, c.karma);
    // 발각: 순찰 → 목격 → 피해자
    const pol = H.policy();
    const patrol = c.patrol * (pol?.detectMult() ?? 1);
    const others = here.filter((q) => q !== v && atLeastTeen(q));
    const pw = others.length ? 1 - Math.pow(1 - c.witnessPer, others.length) : 0;
    if (H.rng.next() < patrol) {
      this.detect(rec, p, 0, this.d.evidence.patrol, true);
      return rec;
    }
    if (H.rng.next() < pw) {
      const w = others[Math.floor(H.rng.next() * others.length)];
      rec.witnesses.push(w.id);
      if (H.rng.next() < this.reportChance(w, p)) {
        const extra = Math.min(2, others.length - 1);
        this.detect(rec, p, w.id, this.d.evidence.witness + extra * this.d.evidence.extraWitness, true, [w]);
        return rec;
      }
      // 신고하지 않은 목격자는 소문을 냄
      H.rumor(p, c.rumor, false, 0.5, [w]);
    }
    if (v && atLeastTeen(v) && H.rng.next() < this.d.victimAccuse) this.detect(rec, p, v.id, this.d.evidence.victim, true);
    return rec;
  }

  /** 목격자가 신고할 확률 (특성, 범인과 친하면 덜) */
  reportChance(w: Person, offender: Person): number {
    const R = this.d.reportChance;
    let c = R.base;
    for (const t of w.traits) c *= R.traits[t] ?? 1;
    if (this.host.friendship(w, offender) >= R.friendBelow) c *= R.friendMult;
    return clamp(c, 0, 0.98);
  }

  /** 발각 → 체포 → 재판 (NPC 즉시, 조작 가문 장면 대기) */
  private detect(rec: CrimeRecord, p: Person, accuser: number, evidence: number, truth: boolean, against: Person[] = []): Trial {
    rec.detected = true;
    this.stats.detected[rec.crime] = (this.stats.detected[rec.crime] ?? 0) + 1;
    return this.arrest(p, rec.crime, accuser, rec.victim, evidence, truth, against);
  }

  /** 체포와 재판 준비. 조작 가문이면 재판 장면 대기, NPC 끼리면 즉시 판결 */
  arrest(p: Person, crime: CrimeId, accuser: number, victim: number, evidence: number, truth: boolean, against: Person[] = [], viaCard = false): Trial {
    const H = this.host;
    const M = this.d.moodlets;
    const judge = H.judge();
    const now = H.minute();
    const T = this.d.trial;
    const controlled = H.controlled(p.household);
    const dayAt = Math.floor(now / 1440) + Math.max(0, Math.round(this.days(T.delay)));
    const t: Trial = {
      id: this.state.nextId++,
      crime,
      extra: [],
      accused: p.id,
      accuser,
      victim,
      judge: judge?.id ?? 0,
      witnesses: against.map((w) => ({ id: w.id, side: 'against' as const, persuaded: false })),
      evidence: clamp(evidence, 0, 1),
      truth,
      stage: 'pending',
      at: dayAt * 1440 + T.hour * 60,
      stageAt: now,
      plea: null,
      mercySteps: 0,
      kin: [],
      lines: [],
      verdict: null,
      controlled,
      viaCard,
    };
    this.state.trials.push(t);
    this.stats.trials++;
    H.moodlet(p, M.arrested);
    for (const q of H.persons) if (q !== p && q.household === p.household && atLeastTeen(q)) H.moodlet(q, M.kin);
    if (controlled) {
      if (!viaCard) {
        H.detain(p, t.at);
        H.moodlet(p, M.trial);
        H.notice(p, 'arrested', { a: p.name, crime: `crime.${crime}` });
      }
      return t;
    }
    // NPC: 즉시
    this.autoPlea(t);
    this.resolve(t);
    return t;
  }

  // ---------------------------------------------------------------- 고발 (원한, 피해자, 상호작용)

  /** 이 사람이 target 을 고발할 거리가 있는가 (본 죄 또는 원한) */
  canAccuse(p: Person, target: Person): boolean {
    if (p.household === target.household || !grownUp(p)) return false;
    if (this.state.trials.some((t) => t.accused === target.id && t.stage !== 'done')) return false;
    const last = this.state.accused[`${p.id}:${target.id}`];
    if (last !== undefined && this.host.day() - last < this.days(this.d.accuseCooldown)) return false;
    if (this.state.records.some((r) => r.offender === target.id && !r.detected && (r.witnesses.includes(p.id) || r.victim === p.id))) return true;
    return this.host.grudgeTargets(p).includes(target);
  }

  /**
   * 고발 (ClansHost.accuse, 원한 자율 행동, social.accuse). 대상에게 드러나지 않은 최근 죄가 있으면 진짜 고발,
   * 없으면 거짓 고발 (증거 약함). 재판을 돌려줌
   */
  accuse(from: Person, target: Person, crime: CrimeId | null = null): Trial | null {
    const H = this.host;
    if (this.state.trials.some((t) => t.accused === target.id && t.stage !== 'done')) return null;
    this.state.accused[`${from.id}:${target.id}`] = H.day();
    const rec = this.state.records
      .filter((r) => r.offender === target.id && !r.detected && (!crime || r.crime === crime))
      .sort((a, b) => b.day - a.day)[0];
    if (rec) {
      const knows = rec.witnesses.includes(from.id) || rec.victim === from.id;
      return this.detect(rec, target, from.id, knows ? this.d.evidence.witness : this.d.evidence.accuseTrue, true, knows ? [from] : []);
    }
    this.stats.falseAccusations++;
    return this.arrest(target, crime ?? 'theft', from.id, 0, this.d.evidence.accuseFalse, false, [from]);
  }

  // ---------------------------------------------------------------- 재판 진행 (조작 가문 장면)

  /** 매 게임 시간: 재판 시각이 된 조작 가문 재판을 장면으로 열고, 오래 멈춘 장면은 자동 진행 */
  hourly(): void {
    const H = this.host;
    const now = H.minute();
    for (const t of this.state.trials) {
      if (!t.controlled || t.viaCard || t.stage === 'done') continue;
      if (t.stage === 'pending') {
        if (now < t.at) continue;
        const p = this.byId(t.accused);
        if (!p) {
          t.stage = 'done';
          continue;
        }
        H.release(p);
        this.setStage(t, 'opening');
        const judge = this.byId(t.judge);
        const accuser = this.byId(t.accuser);
        t.lines.push({ key: 'trial.opening', args: { judge: judge?.name ?? 'trial.judge', accuser: accuser?.name ?? 'trial.watch', a: p.name, crime: `crime.${t.crime}` } });
        H.startTrialScene(t);
        continue;
      }
      if (now - t.stageAt >= this.d.trial.autoMinutes) this.autoStep(t);
    }
  }

  private setStage(t: Trial, s: TrialStage): void {
    t.stage = s;
    t.stageAt = this.host.minute();
  }

  /** 멈춘 장면 한 단계 자동 진행 (헤드리스·자리 비움) */
  private autoStep(t: Trial): void {
    if (t.stage === 'opening') this.setStage(t, 'plea');
    else if (t.stage === 'plea') {
      this.autoPlea(t);
      this.setStage(t, 'witness');
    } else if (t.stage === 'witness') this.setStage(t, 'kin');
    else if (t.stage === 'kin' || t.stage === 'verdict') this.resolve(t);
  }

  /** 끝나지 않은 조작 가문 재판을 모두 끝까지 (헤드리스 도구) */
  autoResolveAll(): void {
    for (const t of this.state.trials) {
      if (t.stage === 'done' || t.viaCard) continue;
      if (t.stage === 'pending') {
        const p = this.byId(t.accused);
        if (p) this.host.release(p);
      }
      if (!t.plea) this.autoPlea(t);
      this.resolve(t);
    }
  }

  /** 지금 열려 있는 (장면 중인) 조작 가문 재판 */
  openTrial(id?: number): Trial | null {
    return this.state.trials.find((t) => t.controlled && !t.viaCard && t.stage !== 'done' && (id === undefined || t.id === id)) ?? null;
  }

  /** 재판 의도 (리드가 sim.apply 에 연결) */
  applyIntent(i: TrialIntent): { ok: boolean; reason?: string } {
    const t = this.openTrial(i.trial);
    if (!t) return { ok: false, reason: 'no_trial' };
    switch (i.kind) {
      case 'trialPlea': {
        if (!PLEAS.includes(i.option)) return { ok: false, reason: 'bad_option' };
        if (t.stage !== 'opening' && t.stage !== 'plea') return { ok: false, reason: 'stage' };
        this.plead(t, i.option);
        this.setStage(t, 'witness');
        return { ok: true };
      }
      case 'trialCallWitness': {
        if (t.stage !== 'witness') return { ok: false, reason: 'stage' };
        const w = this.byId(i.id);
        const p = this.byId(t.accused);
        if (!w || !p || !this.witnessCandidates(t).includes(w)) return { ok: false, reason: 'not_witness' };
        if (t.witnesses.filter((x) => x.side === 'for').length >= this.d.trial.maxWitnesses) return { ok: false, reason: 'too_many' };
        t.witnesses.push({ id: w.id, side: 'for', persuaded: false });
        t.lines.push({ key: 'trial.witness.for', args: { a: p.name, b: w.name } });
        return { ok: true };
      }
      case 'kinPetition':
      case 'kinBribe':
      case 'kinPersuade': {
        if (t.stage !== 'kin' && t.stage !== 'pending' && t.stage !== 'witness') return { ok: false, reason: 'stage' };
        const by = this.byId(i.by);
        const p = this.byId(t.accused);
        if (!by || !p || by.household !== p.household || by === p) return { ok: false, reason: 'not_kin' };
        if (i.kind === 'kinPetition') return { ok: this.kinPetition(t, by) };
        if (i.kind === 'kinBribe') return { ok: this.kinBribe(t, by, i.amount) };
        const w = this.byId(i.witness);
        if (!w) return { ok: false, reason: 'not_witness' };
        return { ok: this.kinPersuade(t, by, w) };
      }
      case 'trialAdvance': {
        if (t.stage === 'pending') return { ok: false, reason: 'not_yet' };
        if (t.stage === 'opening') this.setStage(t, 'plea');
        else if (t.stage === 'plea') {
          this.plead(t, 'silent');
          this.setStage(t, 'witness');
        } else if (t.stage === 'witness') this.setStage(t, 'kin');
        else this.resolve(t);
        return { ok: true };
      }
    }
    return { ok: false, reason: 'unknown' };
  }

  /** 변호 증인 후보: 피고와 우정 callWitnessMin 이상인 어른 (식구 제외, 이미 부른 사람 제외) */
  witnessCandidates(t: Trial): Person[] {
    const p = this.byId(t.accused);
    if (!p) return [];
    return this.host.persons.filter((q) => q !== p && q.household !== p.household && grownUp(q) && !t.witnesses.some((w) => w.id === q.id) && this.host.friendship(q, p) >= this.d.trial.callWitnessMin);
  }

  /** 피고 변론 */
  plead(t: Trial, option: Plea): void {
    const H = this.host;
    const T = this.d.trial;
    const p = this.byId(t.accused);
    if (!p || t.plea) return;
    t.plea = option;
    t.lines.push({ key: `trial.plea.${option}`, args: { a: p.name } });
    if (option === 'mercy') {
      t.mercySteps += T.mercy.steps;
      t.evidence = clamp(t.evidence + T.mercy.evidence, 0, 1);
    } else if (option === 'argue') {
      const d = Math.min(T.argue.max, T.argue.perStory * H.skillLevel(p, 'storytelling') + T.argue.perReckoning * H.skillLevel(p, 'reckoning'));
      t.evidence = clamp(t.evidence - d * (t.truth ? T.argue.guiltyMult : 1), 0, 1);
    } else if (option === 'witness') {
      const cands = this.witnessCandidates(t).sort((a, b) => H.friendship(b, p) - H.friendship(a, p) || a.id - b.id);
      for (const w of cands.slice(0, T.maxWitnesses)) {
        t.witnesses.push({ id: w.id, side: 'for', persuaded: false });
        t.lines.push({ key: 'trial.witness.for', args: { a: p.name, b: w.name } });
      }
    } else if (option === 'bribe') this.bribe(t, p, null, true);
    else if (option === 'silent') t.evidence = clamp(t.evidence + T.silent, 0, 1);
  }

  /** 재판관에게 뇌물 (피고 본인 또는 식구). 들키면 뇌물 죄가 붙음 */
  private bribe(t: Trial, by: Person, amount: number | null | undefined, self: boolean): boolean {
    const H = this.host;
    const B = this.d.trial.bribe;
    const judge = this.byId(t.judge);
    const amt = Math.max(1, Math.round(amount ?? H.savingsS(by.household) * B.shareS));
    const toHh = judge?.household ?? 0;
    if (!H.pay(by.household, toHh, amt, 'bribe')) return false;
    let c = B.base;
    for (const tr of judge?.traits ?? []) c += B.traits[tr] ?? 0;
    const ok = H.rng.next() < clamp(c, 0.02, 0.95);
    if (ok) t.evidence = clamp(t.evidence + B.evidence, 0, 1);
    else {
      t.evidence = clamp(t.evidence + B.failEvidence, 0, 1);
      if (!t.extra.includes('bribery')) t.extra.push('bribery');
      this.stats.committed.bribery = (this.stats.committed.bribery ?? 0) + 1;
      this.stats.detected.bribery = (this.stats.detected.bribery ?? 0) + 1;
      H.rumor(by, this.d.crimes.bribery.rumor, false, 0.7);
    }
    if (!self) t.kin.push({ kind: 'bribe', by: by.id, ok });
    return ok;
  }

  kinPetition(t: Trial, by: Person): boolean {
    const H = this.host;
    const K = this.d.trial.kinPetition;
    const c = K.base + K.perStory * H.skillLevel(by, 'storytelling') + K.perLordFavor * (H.lordFavor(by.household) / 100);
    const ok = H.rng.next() < clamp(c, 0.02, 0.95);
    if (ok) t.mercySteps += K.steps;
    t.kin.push({ kind: 'petition', by: by.id, ok });
    t.lines.push({ key: ok ? 'trial.kin.petition_ok' : 'trial.kin.petition_fail', args: { b: by.name } });
    return ok;
  }

  kinBribe(t: Trial, by: Person, amount?: number): boolean {
    const ok = this.bribe(t, by, amount, false);
    t.lines.push({ key: ok ? 'trial.kin.bribe_ok' : 'trial.kin.bribe_fail', args: { b: by.name } });
    return ok;
  }

  kinPersuade(t: Trial, by: Person, witness: Person): boolean {
    const H = this.host;
    const w = t.witnesses.find((x) => x.id === witness.id && x.side === 'against' && !x.persuaded);
    if (!w) return false;
    const K = this.d.trial.kinPersuade;
    const c = K.base + K.perStory * H.skillLevel(by, 'storytelling') + K.perFriendship * H.friendship(witness, by);
    const ok = H.rng.next() < clamp(c, 0.02, 0.95);
    if (ok) w.persuaded = true;
    t.kin.push({ kind: 'persuade', by: by.id, ok });
    t.lines.push({ key: ok ? 'trial.kin.persuade_ok' : 'trial.kin.persuade_fail', args: { b: by.name, c: witness.name } });
    return ok;
  }

  /** NPC 피고 (또는 자리 비운 조작 가문) 의 변론 선택 */
  private autoPlea(t: Trial): void {
    const H = this.host;
    const p = this.byId(t.accused);
    if (!p || t.plea) return;
    const story = H.skillLevel(p, 'storytelling') + H.skillLevel(p, 'reckoning');
    let opt: Plea = 'mercy';
    if (p.traits.includes('cunning') && H.wealthRatio(p.household) > 0.5) opt = 'bribe';
    else if (story >= 6 || !t.truth) opt = 'argue';
    else if (this.witnessCandidates(t).length >= 2) opt = 'witness';
    this.plead(t, opt);
    // NPC 식구 탄원
    if (!t.controlled) {
      const kin = H.persons.find((q) => q !== p && q.household === p.household && grownUp(q));
      if (kin && H.rng.next() < this.d.trial.npcKinPetition) this.kinPetition(t, kin);
    }
  }

  // ---------------------------------------------------------------- 판결

  /** 유죄 확률 (증거 − 변론 − 신분 − 명예 + 증인) */
  guiltProb(t: Trial): number {
    const H = this.host;
    const T = this.d.trial;
    const p = this.byId(t.accused);
    let e = t.evidence;
    for (const w of t.witnesses) {
      if (w.side === 'for') e -= T.witnessFor;
      else if (!w.persuaded) e += T.witnessAgainst;
    }
    if (p) {
      const accuser = this.byId(t.accuser);
      const rk = this.d.estateRank;
      const gap = (rk[p.estate] ?? 1) - (accuser ? rk[accuser.estate] ?? 1 : rk.freeman ?? 1);
      e -= clamp(gap * T.estateGap, -T.estateGapMax, T.estateGapMax);
      e -= clamp(p.honor / T.honorDiv, -0.25, 0.25);
      e += T.fameTier[H.fameTier(p.household)] ?? 0;
    }
    if (t.extra.length) e += 0.05 * t.extra.length;
    return clamp(e, 0.02, 0.98);
  }

  /** 처벌 사다리 칸 */
  sentence(t: Trial, prob: number): Punishment {
    const H = this.host;
    const c = this.d.crimes[t.crime];
    const T = this.d.trial;
    let i = c.severity + (this.state.offenses[t.accused] ?? 0) + (H.policy()?.punishStep() ?? 0) - t.mercySteps;
    if (prob >= T.highEvidenceStep) i++;
    if (H.rng.next() < T.stepChance) i++;
    if (t.extra.length) i += t.extra.length;
    return c.punish[clamp(i, 0, c.punish.length - 1)];
  }

  /** 판결과 처벌 적용 */
  resolve(t: Trial, forced: Punishment | 'acquit' | null = null): Verdict {
    const H = this.host;
    const prob = this.guiltProb(t);
    const u = H.rng.next();
    const guilty = forced ? forced !== 'acquit' : u < prob;
    const v: Verdict = { guilty, punish: null, replaced: null, prob, amount: 0, days: 0 };
    t.verdict = v;
    t.stage = 'done';
    const p = this.byId(t.accused);
    const judge = this.byId(t.judge);
    const accuser = this.byId(t.accuser);
    if (p) {
      if (guilty) {
        v.punish = forced && forced !== 'acquit' ? forced : this.sentence(t, prob);
        this.stats.convictions++;
        this.state.offenses[p.id] = (this.state.offenses[p.id] ?? 0) + 1;
        this.punish(t, p, v);
        t.lines.push({ key: 'trial.verdict.line_guilty', args: { judge: judge?.name ?? 'trial.judge', a: p.name, punish: `punish.${v.punish}.sentence` } });
      } else {
        this.stats.acquittals++;
        this.acquit(t, p, accuser ?? null);
        t.lines.push({ key: 'trial.verdict.line_innocent', args: { judge: judge?.name ?? 'trial.judge', a: p.name, accuser: accuser?.name ?? 'trial.watch' } });
      }
      // 공정한 판결 (사실과 맞음) → 영주 좋은 소문
      if (judge && guilty === t.truth && H.rng.next() < this.d.trial.fairRumorChance) H.rumor(judge, 'fair_judgment', true, 0.5);
      if (t.controlled) H.chronicle('trial', [p], { crime: `crime.${t.crime}`, verdict: guilty ? `punish.${v.punish}` : 'trial.verdict.innocent' });
    }
    if (t.controlled && !t.viaCard) H.endTrialScene(t);
    return v;
  }

  private punish(t: Trial, p: Person, v: Verdict): void {
    const H = this.host;
    const c = this.d.crimes[t.crime];
    const P = this.d.punish;
    const M = this.d.moodlets;
    const step = H.policy()?.punishStep() ?? 0;
    let what = v.punish!;
    if (what === 'execution') {
      const dr = H.deathRules();
      const ok = !dr || dr.allows('execution', dr.group(p.lifeStage));
      if (!ok) {
        v.replaced = 'execution';
        what = P.executionFallback;
        v.punish = what;
      }
    }
    this.stats.punish[what] = (this.stats.punish[what] ?? 0) + 1;
    H.fame(p.household, Math.round(c.fame * (1 + P.stepFame * Math.max(0, step))), 'crime', p);
    H.memory(p, 'convicted', 4, -1, t.accuser);
    H.rumor(p, 'convicted', false, 0.8, [p, this.byId(t.judge), this.byId(t.accuser)].filter((x): x is Person => !!x));
    const newsArgs = { a: p.name, crime: `crime.${t.crime}` };
    switch (what) {
      case 'fine': {
        const amt = Math.max(1, Math.round(c.fine * (this.d.estateFineMult[p.estate] ?? 1) * (1 + P.stepFine * step)));
        v.amount = amt;
        this.stats.fines += amt;
        H.fine(p.household, amt, 'crime_fine');
        H.moodlet(p, M.fine);
        break;
      }
      case 'pillory': {
        H.pillory(p, Math.round(this.days(P.pillory)), P.pilloryPlace);
        H.moodlet(p, M.pillory);
        break;
      }
      case 'flogging':
        H.flog(p);
        H.moodlet(p, M.flogging);
        break;
      case 'jail': {
        const lo = this.days(P.jailMin);
        const hi = v.replaced ? this.days(P.longJail) : this.days(P.jailMax);
        const days = v.replaced ? Math.round(hi) : Math.round(lo + (hi - lo) * H.rng.next());
        v.days = days;
        H.jail(p, days);
        H.moodlet(p, M.jail);
        break;
      }
      case 'exile':
        for (const q of H.persons) if (q !== p && q.household === p.household && atLeastTeen(q)) H.moodlet(q, M.exile);
        H.moodlet(p, M.exile);
        H.exile(p);
        break;
      case 'confiscation':
        H.confiscate(p.household);
        H.felony(p);
        break;
      case 'execution': {
        for (const q of H.persons) if (q !== p && atLeastTeen(q) && H.controlled(q.household)) H.moodlet(q, M.execution);
        H.kill(p, 'execution');
        break;
      }
    }
    H.news(`verdict_${what}`, newsArgs, [p]);
    if (H.controlled(p.household)) H.notice(p, 'verdict_guilty', { a: p.name, crime: `crime.${t.crime}`, punish: `punish.${what}` });
  }

  private acquit(t: Trial, p: Person, accuser: Person | null): void {
    const H = this.host;
    const M = this.d.moodlets;
    H.moodlet(p, M.acquitted);
    for (const q of H.persons) if (q !== p && q.household === p.household && atLeastTeen(q) && H.controlled(q.household)) H.moodlet(q, M.acquitted);
    H.rumor(p, 'acquitted', true, 0.5);
    H.news('verdict_acquitted', { a: p.name }, [p]);
    if (accuser && !t.truth) H.fame(accuser.household, this.d.trial.falseAccuserFame, 'lie_exposed', accuser);
    if (H.controlled(p.household)) H.notice(p, 'verdict_innocent', { a: p.name });
  }

  // ---------------------------------------------------------------- 다른 모듈에서 오는 죄

  /**
   * 즉결 (사치 금지법 적발처럼 다른 모듈이 벌금까지 처리한 경우): 통계만. 벌금은 그 모듈의 host.fine 이 finesToday 에 넣음
   */
  noteSummary(p: Person, crime: CrimeId): void {
    this.stats.committed[crime] = (this.stats.committed[crime] ?? 0) + 1;
    this.stats.detected[crime] = (this.stats.detected[crime] ?? 0) + 1;
    this.todayCount++;
    void p;
  }

  /** 주먹다짐 등 가벼운 죄: 재판 없이 벌금 (Feuds 가 부름) */
  summaryFine(p: Person, crime: CrimeId, share = 1): number {
    const c = this.d.crimes[crime];
    const amt = Math.max(1, Math.round(c.fine * share * (this.d.estateFineMult[p.estate] ?? 1)));
    this.host.fine(p.household, amt, 'crime_fine');
    this.stats.fines += amt;
    this.host.moodlet(p, this.d.moodlets.fine);
    return amt;
  }

  /** 발생만 기록 (주먹다짐: 폭행 발생 수) */
  noteCommitted(crime: CrimeId, n = 1): void {
    this.stats.committed[crime] = (this.stats.committed[crime] ?? 0) + n;
    this.todayCount += n;
  }

  /**
   * 사건 카드 flag (리드: cardsHost.setFlag 에서 부름). 처리했으면 true (그 flag 는 가구 플래그에서 지워도 됨).
   * on_trial = 카드가 죄를 정함 (poaching_temptation → 밀렵 …), verdict_* / sentenced_* = 카드 판결 (trial_verdict_plea)
   */
  onCardFlag(p: Person, flag: string, cardId: string | null = null): boolean {
    if (flag === 'on_trial') {
      if (this.state.trials.some((t) => t.accused === p.id && t.stage !== 'done')) return true;
      const crime = (cardId && CARD_CRIME[cardId]) || 'theft';
      this.stats.committed[crime] = (this.stats.committed[crime] ?? 0) + 1;
      this.stats.detected[crime] = (this.stats.detected[crime] ?? 0) + 1;
      this.arrest(p, crime, 0, 0, this.d.evidence.card, true, [], true);
      return true;
    }
    const v = CARD_VERDICT[flag];
    if (!v) return false;
    const t = this.state.trials.find((x) => x.accused === p.id && x.stage !== 'done');
    if (!t) return false;
    if (v === 'law') {
      this.autoPlea(t);
      this.resolve(t);
    } else this.resolve(t, v);
    return true;
  }

  // ---------------------------------------------------------------- 사회 결과, 게이트, 플래그

  /** 사회 상호작용 결과 (리드 onSocial). 처리했으면 true */
  onSocial(p: Person, t: Person | null, id: string, ok: boolean): boolean {
    if (!t) return false;
    if (id === 'social.accuse') {
      if (ok) this.accuse(p, t);
      return true;
    }
    const trial = this.kinTrial(p);
    if (id === 'social.plead_for_kin') {
      if (trial && ok) this.kinPetition(trial, p);
      else if (trial) trial.kin.push({ kind: 'petition', by: p.id, ok: false });
      return true;
    }
    if (id === 'social.bribe_judge') {
      if (trial) {
        if (ok) this.kinBribe(trial, p);
        else {
          if (!trial.extra.includes('bribery')) trial.extra.push('bribery');
          this.host.rumor(p, 'bribery', false, 0.7);
          trial.kin.push({ kind: 'bribe', by: p.id, ok: false });
        }
      }
      return true;
    }
    if (id === 'social.persuade_witness') {
      if (trial && ok) {
        const w = trial.witnesses.find((x) => x.id === t.id && x.side === 'against');
        if (w) {
          w.persuaded = true;
          trial.kin.push({ kind: 'persuade', by: p.id, ok: true });
        }
      }
      return true;
    }
    return false;
  }

  /** 이 사람 식구(본인 제외)가 받는 끝나지 않은 재판 */
  kinTrial(p: Person): Trial | null {
    return this.state.trials.find((t) => t.stage !== 'done' && t.accused !== p.id && this.byId(t.accused)?.household === p.household) ?? null;
  }

  gates(): Record<string, (p: Person, t: Person | null) => boolean> {
    return {
      can_accuse: (p, t) => !!t && this.canAccuse(p, t),
      kin_trial_judge: (p, t) => !!t && !!this.kinTrial(p) && t.id === (this.kinTrial(p)?.judge ?? -1),
      trial_witness: (p, t) => !!t && !!this.kinTrial(p)?.witnesses.some((w) => w.id === t.id && w.side === 'against' && !w.persuaded),
    };
  }

  flags(p: Person): Set<string> {
    const out = new Set<string>();
    for (const t of this.state.trials) {
      if (t.stage === 'done') continue;
      if (t.accused === p.id) out.add('on_trial');
      else if (this.byId(t.accused)?.household === p.household) out.add('kin_on_trial');
    }
    if ((this.state.offenses[p.id] ?? 0) > 0) out.add('convicted_before');
    return out;
  }

  /** 최근 하루 평균 범죄 수 (NPC 영주 AI) */
  crimesPerDay(days = 7): number {
    const b = this.stats.byDay.slice(-days);
    return b.length ? b.reduce((a, x) => a + x, 0) / b.length : 0;
  }

  /** 사람이 죽거나 떠남 */
  forget(id: number): void {
    for (const t of this.state.trials) if (t.accused === id && t.stage !== 'done') t.stage = 'done';
    delete this.state.offenses[id];
  }

  hashParts(out: (string | number)[]): void {
    out.push(this.state.nextId, this.state.records.length, this.state.trials.length, JSON.stringify(this.state.offenses));
    for (const t of this.state.trials) if (t.stage !== 'done') out.push(t.id, t.accused, t.stage, t.evidence.toFixed(3));
  }
}

