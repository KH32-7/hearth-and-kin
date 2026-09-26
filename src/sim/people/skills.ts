/**
 * 스킬 (GDD 17-1): 1~10 레벨, 레벨 n → n+1 필요 경험치 = a × max(1, n)^p (기본 100 × n^1.4).
 * 스킬 활동(태그가 스킬 tags 에 걸리는 상호작용, 레시피/직업이 지정한 스킬) 1분마다 기본 0.45 XP.
 * %보정(감정, 특성, 스승 등)은 합산 후 상한 +100%, 하한 −50%. 멀티태스킹 0.7 과 수명 배수 역수는 밖에서 곱함.
 * 수치는 skills.json (없으면 스킬 시스템이 조용히 꺼짐)
 */
import type { Person } from './person';

export interface SkillDef {
  nameKey: string;
  icon: string;
  category: string;
  tags?: string[];
  levels?: Record<string, { quality?: number; speed?: number; success?: number; unlockKey?: string; masterwork?: boolean }>;
}

export interface SkillsData {
  xpBase: { value: number; scale: string };
  curve: { a: number; p: number };
  maxLevel: number;
  bundles: Record<string, string[]>;
  skills: Record<string, SkillDef>;
  /** 경험치 %보정: 감정 → [{ bundle|skill, pct }], 특성 → … (선택) */
  mods?: {
    emotions?: Record<string, Array<{ bundle?: string; skill?: string; pct: number }>>;
    traits?: Record<string, Array<{ bundle?: string; skill?: string; pct: number }>>;
    cap?: [number, number];
  };
}

const DEFAULT_EMOTION_MODS: NonNullable<SkillsData['mods']>['emotions'] = {
  focused: [{ bundle: 'scholarly', pct: 50 }, { bundle: 'labor', pct: 25 }],
  inspired: [{ bundle: 'creative', pct: 50 }],
  energized: [{ bundle: 'labor', pct: 25 }],
  sad: [{ bundle: 'labor', pct: -20 }, { bundle: 'creative', pct: -20 }],
  angry: [{ bundle: 'scholarly', pct: -30 }],
  tense: [{ bundle: 'scholarly', pct: -20 }, { bundle: 'creative', pct: -20 }],
};
const DEFAULT_TRAIT_MODS: NonNullable<SkillsData['mods']>['traits'] = {
  bookworm: [{ bundle: 'scholarly', pct: 25 }],
  creative: [{ bundle: 'creative', pct: 25 }],
  diligent: [{ bundle: 'labor', pct: 20 }],
  lazy: [{ bundle: 'labor', pct: -20 }],
  handy: [{ skill: 'carpentry', pct: 25 }, { skill: 'smithing', pct: 25 }],
  active: [{ skill: 'fitness', pct: 25 }],
};

export class Skills {
  /** 태그 → 스킬 id 목록 */
  private byTag = new Map<string, string[]>();
  /** 스킬 id → 묶음 목록 */
  private bundlesOf = new Map<string, string[]>();
  private need: number[] = [];

  constructor(readonly d: SkillsData, private lifespanMult = 1) {
    for (const [id, s] of Object.entries(d.skills)) {
      for (const t of s.tags ?? []) {
        if (!this.byTag.has(t)) this.byTag.set(t, []);
        this.byTag.get(t)!.push(id);
      }
    }
    for (const [b, ids] of Object.entries(d.bundles ?? {})) for (const id of ids) {
      if (!this.bundlesOf.has(id)) this.bundlesOf.set(id, []);
      this.bundlesOf.get(id)!.push(b);
    }
    for (let n = 0; n <= d.maxLevel; n++) this.need.push(d.curve.a * Math.pow(Math.max(1, n), d.curve.p));
  }

  /** 레벨 n → n+1 필요 경험치 */
  xpToNext(level: number): number {
    return this.need[Math.min(level, this.need.length - 1)];
  }

  level(p: Person, id: string): number {
    return p.skills[id] ?? 0;
  }

  /** 이 태그들로 경험치를 받는 스킬 */
  skillsForTags(tags: readonly string[], out: string[]): string[] {
    out.length = 0;
    for (const t of tags) {
      const l = this.byTag.get(t);
      if (l) for (const id of l) if (!out.includes(id)) out.push(id);
    }
    return out;
  }

  /** %보정 합 (상한/하한 적용 전), 감정/특성 */
  modPct(p: Person, id: string, emotion: string | null): number {
    const bundles = this.bundlesOf.get(id) ?? [];
    const hit = (m: { bundle?: string; skill?: string }) => (m.skill ? m.skill === id : !!m.bundle && bundles.includes(m.bundle));
    let pct = 0;
    const em = this.d.mods?.emotions ?? DEFAULT_EMOTION_MODS ?? {};
    if (emotion) for (const m of em[emotion] ?? []) if (hit(m)) pct += m.pct;
    const tr = this.d.mods?.traits ?? DEFAULT_TRAIT_MODS ?? {};
    for (const t of p.traits) for (const m of tr[t] ?? []) if (hit(m)) pct += m.pct;
    return pct;
  }

  /**
   * 1분 경험치. 올라간 레벨이 있으면 돌려줌.
   * @param extraPct 밖에서 주는 %보정 (스승, 도제 +50%, 가문 보상 등) — 감정/특성과 합산 후 상한
   * @param outerMult 상한 밖 배수 (멀티태스킹 0.7 등)
   */
  gain(p: Person, id: string, minutes: number, emotion: string | null, extraPct = 0, outerMult = 1, xpMult = 1): number | null {
    if (!this.d.skills[id]) return null;
    const cap = this.d.mods?.cap ?? [-50, 100];
    const pct = Math.max(cap[0], Math.min(cap[1], this.modPct(p, id, emotion) + extraPct));
    const xp = this.d.xpBase.value / this.lifespanMult * (1 + pct / 100) * outerMult * xpMult * minutes;
    let lvl = p.skills[id] ?? 0;
    if (lvl >= this.d.maxLevel) return null;
    let x = (p.skillXp[id] ?? 0) + xp;
    let up: number | null = null;
    while (lvl < this.d.maxLevel && x >= this.xpToNext(lvl)) {
      x -= this.xpToNext(lvl);
      lvl++;
      up = lvl;
    }
    p.skills[id] = lvl;
    p.skillXp[id] = lvl >= this.d.maxLevel ? 0 : x;
    return up;
  }

  /** 레벨 효과 (그 레벨까지 누적): 품질 단계, 속도 배수, 성공률 */
  effects(p: Person, id: string): { quality: number; speed: number; success: number; masterwork: boolean } {
    const lv = p.skills[id] ?? 0;
    const out = { quality: 0, speed: 1, success: 0, masterwork: false };
    const levels = this.d.skills[id]?.levels ?? {};
    for (const [k, e] of Object.entries(levels)) {
      if (Number(k) > lv) continue;
      if (e.quality) out.quality += e.quality;
      if (e.speed) out.speed *= e.speed;
      if (e.success) out.success += e.success;
      if (e.masterwork) out.masterwork = true;
    }
    return out;
  }
}
