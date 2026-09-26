/**
 * 사망 설정 행렬 (GDD 20-7): 원인 8 × 나이 그룹 3 켬/끔, 프리셋 3 (관대/보통/현실적) + 칸별 편집, 꺼진 칸의 대체 결과.
 * 다른 장의 "죽을 수 있다" 판정은 모두 여기 allows() 를 거침. 데이터는 death_rules.json. 렌더러/DOM 없음
 */
import { z } from 'zod';
import type { LifeStage } from '../people/person';

export const DEATH_CAUSES = ['old_age', 'illness', 'hunger', 'cold', 'accident', 'childbirth', 'combat', 'execution'] as const;
export type DeathCause = (typeof DEATH_CAUSES)[number];
export const AGE_GROUPS = ['child', 'adult', 'elder'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];
export type DeathPreset = 'lenient' | 'normal' | 'realistic';

const cellRow = z.tuple([z.boolean(), z.boolean(), z.boolean()]);
const presetSchema = z.object({
  nameKey: z.string(),
  cells: z.record(z.enum(DEATH_CAUSES), cellRow),
  subs: z.record(z.string(), z.record(z.string(), z.number().min(0).max(1))),
});
const dur = z.object({ value: z.number(), scale: z.enum(['absolute', 'season', 'lifespan', 'per_life']) });
const fallbackSchema = z.object({ kind: z.string(), textKey: z.string(), recoveryMult: z.number().optional(), incapacitatedMin: dur.optional(), incapacitatedMax: dur.optional() }).loose();

export const deathRulesSchema = z.object({
  causes: z.array(z.enum(DEATH_CAUSES)).length(8),
  ageGroups: z.array(z.enum(AGE_GROUPS)).length(3),
  stageGroup: z.record(z.string(), z.enum(AGE_GROUPS)),
  childBelowAge: z.number(),
  causeAliases: z.record(z.string(), z.enum(DEATH_CAUSES)),
  defaultPreset: z.enum(['lenient', 'normal', 'realistic']),
  presets: z.object({ lenient: presetSchema, normal: presetSchema, realistic: presetSchema }),
  fallback: z.record(z.enum(DEATH_CAUSES), fallbackSchema),
}).loose();
export type DeathRulesData = z.infer<typeof deathRulesSchema>;
export type DeathFallback = z.infer<typeof fallbackSchema>;

/** 지금 설정 (저장/입력 로그 대상): 프리셋 이름 (칸을 고치면 'custom'), 칸, 세부 배수 */
export interface DeathRulesState {
  preset: DeathPreset | 'custom';
  cells: Record<DeathCause, [boolean, boolean, boolean]>;
  subs: Record<string, Record<string, number>>;
}

/** 설정 의도 (sim.apply 에 리드가 연결): 프리셋 고르기 또는 칸/세부 바꾸기 */
export type SetDeathRulesIntent =
  | { kind: 'setDeathRules'; preset: DeathPreset }
  | { kind: 'setDeathRules'; cells?: Partial<Record<DeathCause, [boolean, boolean, boolean]>>; subs?: Record<string, Record<string, number>> };

export function parseDeathRules(raw: unknown): DeathRulesData | null {
  if (!raw) return null;
  return deathRulesSchema.parse(raw);
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export class DeathRules implements DeathRulesView {
  state: DeathRulesState;

  constructor(readonly d: DeathRulesData, preset: DeathPreset = d.defaultPreset) {
    this.state = DeathRules.presetState(d, preset);
  }

  static presetState(d: DeathRulesData, preset: DeathPreset): DeathRulesState {
    const p = d.presets[preset];
    return { preset, cells: clone(p.cells) as DeathRulesState['cells'], subs: clone(p.subs) };
  }

  get preset(): DeathPreset | 'custom' {
    return this.state.preset;
  }

  /** 원인 이름 정규화 ('cold_hunger' → hunger, 'duel' → combat …). 모르는 원인은 null */
  cause(c: string): DeathCause | null {
    if ((DEATH_CAUSES as readonly string[]).includes(c)) return c as DeathCause;
    return this.d.causeAliases[c] ?? null;
  }

  /** 나이 그룹: 생애 단계로 (아기~청소년 = 아이). 표시 나이를 주면 18세 미만은 아이 */
  group(stage: LifeStage, displayAge?: number): AgeGroup {
    if (displayAge !== undefined && displayAge < this.d.childBelowAge) return 'child';
    return this.d.stageGroup[stage] ?? 'adult';
  }

  /**
   * 이 원인으로 이 나이 그룹이 죽을 수 있는가. sub 는 세부 (출산: maternal/infant/loss, 전투: duel/war/bandit/monster/brawl).
   * 세부 배수가 0 이면 끔. 0 < 배수 < 1 이면 "드물게" (subChance 로 확률을 곱함)
   */
  allows(cause: DeathCause | string, group: AgeGroup, sub?: string): boolean {
    const c = this.cause(cause);
    if (!c) return true;
    const row = this.state.cells[c];
    if (!row || !row[AGE_GROUPS.indexOf(group)]) return false;
    if (sub) return this.subChance(c, sub) > 0;
    return true;
  }

  /** 세부 발생 배수 (없으면 1) */
  subChance(cause: DeathCause | string, sub: string): number {
    const c = this.cause(cause);
    if (!c) return 1;
    return this.state.subs[c]?.[sub] ?? 1;
  }

  /** 꺼진 칸의 대체 결과 (20-7 표). 나이 그룹은 지금 표가 원인만 보지만 호출 쪽 모양을 맞춰 둠 */
  fallback(cause: DeathCause | string, group: AgeGroup): DeathFallback | null {
    void group;
    const c = this.cause(cause);
    return c ? this.d.fallback[c] ?? null : null;
  }

  /** 설정 의도 적용. 프리셋이면 통째로, 칸/세부면 그 칸만 바꾸고 'custom' */
  apply(intent: SetDeathRulesIntent): void {
    if ('preset' in intent && intent.preset) {
      this.state = DeathRules.presetState(this.d, intent.preset);
      return;
    }
    const i = intent as { cells?: Partial<Record<DeathCause, [boolean, boolean, boolean]>>; subs?: Record<string, Record<string, number>> };
    let changed = false;
    for (const [c, row] of Object.entries(i.cells ?? {})) {
      const cause = this.cause(c);
      if (!cause || !row) continue;
      this.state.cells[cause] = [!!row[0], !!row[1], !!row[2]];
      changed = true;
    }
    for (const [c, subs] of Object.entries(i.subs ?? {})) {
      const cause = this.cause(c);
      if (!cause) continue;
      this.state.subs[cause] ??= {};
      for (const [k, v] of Object.entries(subs)) this.state.subs[cause][k] = Math.max(0, Math.min(1, v));
      changed = true;
    }
    if (changed) this.state.preset = this.matchPreset() ?? 'custom';
  }

  /** 지금 칸이 어떤 프리셋과 똑같으면 그 이름 */
  private matchPreset(): DeathPreset | null {
    const now = JSON.stringify({ c: this.state.cells, s: this.state.subs });
    for (const k of ['realistic', 'normal', 'lenient'] as const) {
      const p = this.d.presets[k];
      if (JSON.stringify({ c: p.cells, s: p.subs }) === now) return k;
    }
    return null;
  }

  /** 저장/복원 */
  save(): DeathRulesState {
    return clone(this.state);
  }

  load(s: DeathRulesState): void {
    this.state = clone(s);
  }
}

/** 다른 모듈이 보는 모양 (DeathRules 가 만족함) */
export interface DeathRulesView {
  readonly preset: DeathPreset | 'custom';
  allows(cause: DeathCause | string, group: AgeGroup, sub?: string): boolean;
  subChance(cause: DeathCause | string, sub: string): number;
  fallback(cause: DeathCause | string, group: AgeGroup): DeathFallback | null;
  group(stage: LifeStage, displayAge?: number): AgeGroup;
}

/** 데이터 없이도 돌아가게: 모든 칸 켬 (현실적과 같은 효과, M1~M6 테스트 부지) */
export function allOnRules(): DeathRulesView {
  return {
    allows: () => true,
    subChance: () => 1,
    fallback: () => null,
    group: (stage: LifeStage, displayAge?: number) => (displayAge !== undefined && displayAge < 18) || ['baby', 'toddler', 'child', 'teen'].includes(stage) ? 'child' : stage === 'elder' ? 'elder' : 'adult',
    preset: 'realistic' as const,
  };
}
