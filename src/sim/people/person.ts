/**
 * 인물 상태 (M1 범위: 위치, 욕구, 대기열, 현재 행동). 감정/특성 등은 M2 이후 필드로 확장.
 */
import type { Facing, NeedId, PersonStatus, Pose, QueueItem } from '../core/types';
import { NEED_IDS } from '../core/types';
import type { Stage } from '../inner/emotion';

/** 붙어 있는 무드렛 (GDD 11-2) */
export interface ActiveMoodlet {
  id: string;
  emotion: number;
  /** 현재 세기 (fade 로 줄어듦) */
  strength: number;
  baseStrength: number;
  needSource: boolean;
  source: string;
  group: string | null;
  addedAt: number;
  /** 사라지는 분 (Infinity = while 조건/영구) */
  expiresAt: number;
  whileCond: string | null;
  seq: number;
}

export interface Memory {
  kind: string;
  minute: number;
  /** +1 좋은 기억 / -1 나쁜 기억 */
  valence: number;
  importance: number;
  withPerson: number;
  objectUid: number;
}

export interface ActiveWish {
  id: string;
  kind: 'wish' | 'fear';
  since: number;
  expiresAt: number;
  locked: boolean;
}

export const NEED_INDEX: Record<NeedId, number> = {
  hunger: 0, energy: 1, hygiene: 2, bladder: 3, fun: 4, social: 5, warmth: 6, comfort: 7,
};

export type ActionPhase = 'route' | 'walk' | 'perform' | 'wait';

export interface ActionRuntime {
  item: QueueItem;
  stepIndex: number;
  phase: ActionPhase;
  /** 이번 단계 대상 물건 uid, 슬롯 id */
  stepObj: number;
  slotId: string;
  /** 슬롯 칸 인덱스 */
  goal: number;
  path: number[];
  pathPos: number;
  remaining: number;
  elapsed: number;
  /** 이 행동이 시작된 이후 진행이 있었던 마지막 분 */
  lastProgress: number;
  repaths: number;
  /** 사회 상호작용 대화 주제 (14-3) */
  topic?: string;
  /** 자리가 비기를 기다린 분 (화로 앞에 누가 있으면 줄 서서 기다림) */
  waited?: number;
}

import type { CareerState } from './careers';

export interface CollapseState {
  kind: 'floor_sleep';
  remaining: number;
}

/** 생애 7단계 (29-2) */
export type LifeStage = 'baby' | 'toddler' | 'child' | 'teen' | 'young' | 'adult' | 'elder';
/** 시뮬레이션 세밀도 (13-6) */
export type Lod = 'full' | 'simple' | 'summary';

export class Person {
  readonly id: number;
  name: string;
  x: number;
  y: number;
  facing: Facing = 'down';
  pose: Pose = 'stand';
  anim = 'idle';
  outfit = 'everyday';
  carry: string | null = null;
  hidden = false;
  underBlanket = false;
  sleeping = false;
  status: PersonStatus = 'available';
  readonly needs = new Float64Array(8);
  queue: QueueItem[] = [];
  action: ActionRuntime | null = null;
  collapse: CollapseState | null = null;
  autonomy: 'off' | 'low' | 'normal' | 'high' = 'normal';
  /** 최근 자율로 고른 물건 uid (반복 벌점) */
  recentObjects: number[] = [];
  /** 물건 uid → 길찾기 실패 횟수, 제외 만료 분 */
  pathFails = new Map<number, number>();
  excludedUntil = new Map<number, number>();
  /** 이번 틱에 지나간 좌표 (렌더러 보간용): x0,y0,x1,y1,... */
  trail: number[] = [];
  idleUntil = 0;
  hungerZeroMinutes = 0;
  weakened = false;
  stage: 'child' | 'teen' | 'adult' | 'elder' = 'adult';
  /** 욕구별 "지금 해결 가능한가" 캐시 (계산한 분, 값). 급한 욕구 중단/잠 깨기/봇 지표가 같이 씀 */
  readonly solvableAt = new Float64Array(8).fill(-1e9);
  readonly solvableVal = new Uint8Array(8);
  /** 외형 사양 (렌더러용, sim은 해석하지 않음) */
  appearance: Record<string, unknown> = {};

  // ---------------------------------------------------------------- 내면 (M2, GDD 11~12)
  estate = 'freeman';
  sex: 'male' | 'female' = 'male';
  traits: string[] = [];
  virtue: string | null = null;
  sin: string | null = null;
  likes: string[] = [];
  dislikes: string[] = [];
  moodlets: ActiveMoodlet[] = [];
  /** 감정 칸 (inner/emotion.ts EMOTION_IDS), 단계, 합 */
  emotion = 10;
  emotionStage: Stage = 0;
  emotionSum = 0;
  emotionSince = 0;
  moodDirty = true;
  stress = 0;
  karma = 0;
  happiness = 0;
  memories: Memory[] = [];
  wishes: ActiveWish[] = [];
  aspiration: { id: string; stage: number } | null = null;
  /** 소원/인생 목표 카운터: "tag:read", "done:lute.play", "event:married" … */
  counters = new Map<string, number>();
  /** 욕구 무드렛 단계 캐시 (0 없음, 1 높음, 2 낮음, 3 위급) */
  readonly needLevel = new Uint8Array(8);
  /** 지표 (헤드리스 특성 검증 29-1): 태그별 분, 감정별 분, 밤 바깥 분 */
  tagMinutes: Record<string, number> = {};
  readonly emotionMinutes = new Float64Array(11);
  /** 감정별 (욕구 출처 제외) 무드렛 세기 × 분 — 특성 대표 지표 (쾌활함: 행복 무드렛이 오래 감) */
  readonly moodletEmotionMinutes = new Float64Array(11);
  outdoorNightMinutes = 0;
  /** 속마음: 문장 키 → 마지막으로 말한 날, 마지막 말한 분 */
  thoughtDay = new Map<string, number>();
  lastThoughtAt = -1e9;
  /** 사회 상호작용 중 상대 (상대 쪽에서 붙잡혀 있는 경우) */
  engagedWith = 0;

  // ---------------------------------------------------------------- 사람들 (M3, GDD 14)
  /** 가구 번호 (플레이어 가족 1, 이웃은 100 + 이웃 순번) */
  household = 1;
  /** 방문객: 이웃 id, 떠날 시각, 떠나는 중 */
  visitor: { neighborId: string; leaveAt: number; leaving: boolean; greetUntil: number; host: number; leftAt: number; saidBye: boolean; customer?: boolean } | null = null;
  /** 관심 주제 (특성에서 오는 것 외에 인물 데이터가 준 것) */
  topics: string[] = [];
  /** 스킬 레벨 (M4, GDD 17-1). 이야기(화술)는 사회 성공 판정에 씀 */
  skills: Record<string, number> = {};
  /** 스킬별 다음 레벨까지 모은 경험치 */
  skillXp: Record<string, number> = {};
  /** 직업 (M4). null = 무직 */
  career: CareerState | null = null;
  /** 마지막 수확 (렌더러 연출) */
  lastHarvest: { minute: number; item: string; n: number } | null = null;
  /** 마지막 제작 (렌더러: 품질 연출) */
  lastCraft: { minute: number; recipe: string; quality: number } | null = null;
  /** 마지막 퇴근 (렌더러: 돈 연출) */
  lastWork: { minute: number; wage: number } | null = null;
  /** 일터 사건 선택 대기 (24-1 래빗홀 중 카드) */
  careerEvent: { careerId: string; eventId: string; since: number } | null = null;
  /** 마지막 레벨업 (렌더러 연출용) */
  lastSkillUp: { minute: number; skill: string; level: number } | null = null;
  /** 불 켠 작은 방에 머문 분 (연기) */
  smokeMinutes = 0;
  /** 멀티태스킹 대화 상대 (먹거나 쉬면서 옆 사람과 이야기, 렌더러 말풍선용) */
  chatWith = 0;
  /** 마지막 사회 상호작용 결과 (렌더러 연출용): 분, 성공, 상대 */
  lastSocial: { minute: number; ok: boolean; target: number; ia: string } | null = null;
  /** 스트레스 한계 선택 대기 */
  pendingChoice: { id: string; since: number } | null = null;
  lastDayTags = new Set<string>();
  /** 오늘 끝낸 횟수 (상호작용 id → 횟수). 지루함 (11-1: 같은 활동 반복 → 회복량 감소, 하루 단위 회복) */
  todayCount = new Map<string, number>();

  // ---------------------------------------------------------------- 마을과 생애 (M6, GDD 13-6, 18-3)
  /** 생애 7단계 (29-2) 와 그 단계 안 경과 일수. stage 는 이 값을 넷으로 묶은 것 */
  lifeStage: LifeStage = 'adult';
  ageDays = 0;
  /** 세밀도 (13-6): 전체 / 간이 / 요약, 마지막으로 바뀐 분, 등급 조건이 풀린 분 */
  lod: Lod = 'full';
  lodSince = 0;
  lodCalmSince = -1;
  /** 마을 사람 데이터 id (people.json), 집 부지 id */
  townId: string | null = null;
  homeLot: string | null = null;
  role: string | null = null;
  /** 일과표 템플릿 id (people.json member.schedule), 고용주 가문 키 (workAt "employer") */
  schedule: string | null = null;
  employer: string | null = null;
  /** 간이 세밀도 이동: 일과 목적지 칸, 길 (칸 인덱스), 진행 */
  simpleGoal = -1;
  simplePath: number[] = [];
  simpleStep = 0;
  /** 지금 있는 공공 장소 (소문 전파) */
  place: string | null = null;
  /** 배우자, 약혼 상대 (person id, 0 없음), 약혼한 날 */
  spouse = 0;
  /** 처음 혼인한 날 (-1 미혼, 29-1 혼인률 통계) */
  marriedDay = -1;
  betrothed = 0;
  betrothedDay = -1;
  /** 임신: 시작한 날, 단계 (1 초기 2 중기 3 후기), 아이 아버지 */
  pregnancy: { since: number; stage: number; father: number } | null = null;
  /** 아이를 원함 (15-1): 원함 / 상관없음 / 원치 않음 */
  wantsKids: 'yes' | 'any' | 'no' = 'any';
  /** 부모 (가계도, M7 유전 입력) */
  mother = 0;
  father = 0;
  /** 아기/유아 (M7 전까지는 엄마 곁에 숨어 지냄) */
  infant = false;

  constructor(id: number, name: string, x: number, y: number) {
    this.id = id;
    this.name = name;
    this.x = x;
    this.y = y;
  }

  need(id: NeedId): number {
    return this.needs[NEED_INDEX[id]];
  }

  setNeed(id: NeedId, v: number): void {
    this.needs[NEED_INDEX[id]] = v < 0 ? 0 : v > 100 ? 100 : v;
  }

  addNeed(id: NeedId, dv: number): void {
    this.setNeed(id, this.needs[NEED_INDEX[id]] + dv);
  }

  cellX(): number {
    return Math.floor(this.x);
  }

  cellY(): number {
    return Math.floor(this.y);
  }

  needsObject(): Record<NeedId, number> {
    const o = {} as Record<NeedId, number>;
    NEED_IDS.forEach((n, i) => (o[n] = this.needs[i]));
    return o;
  }
}
