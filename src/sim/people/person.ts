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
  /** 말 (18-5): 가문이 말을 가짐 (털색 0~4), 지금 타고 있음 */
  horse = -1;
  riding = false;
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
  /** 아기 자리 (15-3): 요람 / 누군가의 품 / 바닥. 아기가 아니면 null */
  babyPlace: { kind: 'cradle'; uid: number } | { kind: 'held'; by: number } | { kind: 'floor' } | null = null;
  /** 안고 있는 아기 id (0 없음) */
  holding = 0;
  /** 울고 있음 (아기/유아), 유모, 방치 개입이 이미 일어남, 떼쓰는 중 (분) */
  crying = false;
  wetNurse = false;
  neglectHandled = false;
  tantrumUntil = 0;
  /** 유아 기술 5 / 아동 스킬 4 (15-4, 15-5): 레벨과 모은 경험치 */
  childSkills: Record<string, number> = {};
  childSkillXp: Record<string, number> = {};
  /** 교육 경로 id, 오늘 과제 (진척 0~1), 성적 평균(0~1)과 날 수, 마지막 성적 무드렛을 준 날 수 */
  education: string | null = null;
  homework: { day: number; progress: number } | null = null;
  gradeScore = 0;
  gradeDays = 0;
  gradeWeek = 0;
  /** 가문에 대한 애정 (15-6, 0~100): 청년이 될 때 정함. 상속 분쟁(16-5)이 읽음 */
  clanAffection = 50;
  /** 도제 계약 (15-6): 배우는 직업, 끝나는 날 */
  apprentice: { career: string; until: number } | null = null;
  /** 젖을 먹일 수 있는 마지막 날 (출산 뒤 아기 단계 동안, 15-3), 오늘 (sim 이 자정마다 모두에게 씀) */
  lactatingUntil = -1;
  today = 0;
  /** 학교·기숙·시동으로 집에 없음 (15-5), 몰래 나가서 돌아올 분 (15-6 반항) */
  schoolAway = false;
  sneakUntil = 0;
  /** 교회 평판 (16-4, -100~100, 0 쪽으로 하루 0.5 감쇠는 M8) */
  churchRep = 0;
  /** 유전자 (10-3, family/genetics.ts). 마을 시작 인물은 처음 자식을 낳을 때 무작위로 붙음 */
  genome: import('../family/genetics').Genome | null = null;
  /** 입양아, 대부모 (15-7) */
  adopted = false;
  godparent = 0;
  /** 이번 생일에 축하해 준 사람들 (같은 사람이 되풀이하지 않게, 생일마다 비움) */
  celebratedBy: number[] = [];
  /** 생애 (M7, 10-2): 생일 대기(단계 끝에 닿은 날, -1 없음), 미룬 날 수, 마지막 생일, 노화 끄기 */
  birthdayDay = -1;
  birthdayDelayed = 0;
  lastBirthdayDay = -1;
  agingOff = false;
  /** 직접 조작 (WASD) 중인 방향. null = 조작 안 함. 저장하지 않는 입력 상태 (입력 로그 steer 로 재생) */
  direct: { dx: number; dy: number } | null = null;
  /** 마지막으로 입력 로그에 위치를 남긴 뒤 직접 조작으로 움직였는가 */
  directMoved = false;
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
