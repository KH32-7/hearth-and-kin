/**
 * 직업 (GDD 17-2, 17-7). 래빗홀형: 출근 시각에 일터(지금은 부지 출구)로 걸어가 사라지고, 퇴근 때 일당.
 * 현장형(대장장이 등)은 일터 물건에서 주문을 처리 (orders). 여정형(상인)은 여러 날 래빗홀.
 * 성과: 출근 태도(열심히/적당히/농땡이) + 감정 + 핵심 스킬 → 누적 → 승급 사건 / 경고 → 해고.
 * 수치는 careers.json (contracts-m4 4절). 없으면 직업 시스템 꺼짐
 */
import type { Person } from './person';

export interface CareerRank {
  nameKey: string;
  wage?: number;
}

export interface CareerEventOption {
  id: string;
  textKey: string;
  effects?: { performance?: number; money?: number; moodlets?: string[]; skillXp?: Record<string, number>; relationship?: number };
}

export interface CareerDef {
  nameKey: string;
  icon: string;
  type: 'rabbithole' | 'onsite' | 'journey';
  estates: string[];
  literacy?: boolean;
  skills: string[];
  workplace: string;
  hours: [number, number];
  days: number[];
  ranks: CareerRank[];
  promoteAt: number;
  dailyTask?: { skill: string; key: string };
  events?: Array<{ id: string; textKey: string; options: CareerEventOption[] }>;
  orders?: { perDay: [number, number]; pool: string[] };
  npc_role?: boolean;
}

export type Attitude = 'hard' | 'normal' | 'slack';

export interface CareerState {
  id: string;
  rank: number;
  /** 성과 누적 (승급 기준 promoteAt, 음수로 떨어지면 경고/해고) */
  perf: number;
  days: number;
  attitude: Attitude;
  /** 마지막으로 출근한 날 (하루 한 번) */
  lastDay: number;
  warned: boolean;
  /** 실제로 근무를 시작한 날 (결근 판정) */
  workedDay?: number;
  /** 여정형: 돌아올 분 */
  tripEnd?: number;
  /** 현장형: 오늘 주문 */
  orders: { item: string; qty: number; pay: number; done: boolean }[];
}

export const ATTITUDE = {
  hard: { perf: 1.6, xp: 1.25, stress: 8, drain: 1.25 },
  normal: { perf: 1.0, xp: 1.0, stress: 2, drain: 1.0 },
  slack: { perf: 0.25, xp: 0.6, stress: -6, drain: 0.8 },
} as const;

/** 출근 시각 몇 분 전에 집을 나서나 (부지 출구까지 걷는 시간 포함) */
export const COMMUTE_MINUTES = 20;

export function isWorkday(def: CareerDef, day: number): boolean {
  return def.days.includes(day % 7);
}


export function wageOf(def: CareerDef, st: CareerState): number {
  return def.ranks[Math.min(st.rank, def.ranks.length - 1)]?.wage ?? 0;
}

/** 하루 성과 증가: 태도 × (1 + 핵심 스킬 평균 × 0.1) × 감정 보정 */
export function dayPerformance(p: Person, def: CareerDef, st: CareerState, emotion: string | null): number {
  const att = ATTITUDE[st.attitude];
  let skill = 0;
  for (const s of def.skills) skill += p.skills[s] ?? 0;
  skill /= Math.max(1, def.skills.length);
  const emo = emotion === 'focused' || emotion === 'energized' ? 1.3 : emotion === 'sad' || emotion === 'angry' || emotion === 'tense' ? 0.7 : 1;
  return 10 * att.perf * (1 + skill * 0.1) * emo;
}
