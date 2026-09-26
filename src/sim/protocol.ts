/**
 * 워커 ↔ 메인 스레드 메시지 형식 (BRIEF 1장: 의도만 워커로, 스냅샷만 메인으로)
 */
import type { MenuEntry, Notice } from './sim';

export interface PersonSnap {
  /** 남의 집 문을 두드리는 중 (문 칸) — 문을 열어 그리지 않음 */
  knocking?: number;
  id: number;
  name: string;
  /** 임신 배 레이어 (15-1): 1 중기, 2 후기 */
  bellyStage?: number;
  /** 걸음걸이 걷기 애니 재생 배수 (10-1, 기본 1) */
  gaitAnim?: number;
  /** 직접 조작(WASD) 중: 렌더러가 스냅샷 간격으로 바로 따라감 */
  direct?: boolean;
  /** 말을 타고 있으면 털색 (0~4), 아니면 없음 (18-5) */
  riding?: number;
  /** 생애 단계 (아기/유아는 전용 스프라이트, src/render/CharacterView.ts) */
  lifeStage?: 'baby' | 'toddler' | 'child' | 'teen' | 'young' | 'adult' | 'elder';
  /** 아기(0~1세): 요람/품 안/바닥, 안은 사람 id (품 안일 때), 울음 */
  infant?: { place: 'cradle' | 'held' | 'floor'; heldBy: number; crying: boolean };
  x: number;
  y: number;
  /** 이번 틱에 지나간 좌표 x0,y0,x1,y1,... (렌더러 보간) */
  trail: number[];
  facing: string;
  pose: string;
  anim: string;
  outfit: string;
  carry: string | null;
  hidden: boolean;
  underBlanket: boolean;
  sleeping: boolean;
  needs: Record<string, number>;
  queue: { id: number; interactionId: string; targetUid: number; autonomous: boolean }[];
  action: { interactionId: string; targetUid: number; stepObj: number; phase: string; remaining: number } | null;
  feltC: number;
  collapsed: boolean;
  appearance: Record<string, unknown>;
  /** 사회 상호작용 상대 (말을 걸고 있거나 걸린 경우) */
  talkingWith: number;
  /** 대화 주제 (14-3 주제 말풍선) */
  topic: string | null;
  /** 먹거나 쉬면서 옆 사람과 이야기 (멀티태스킹) */
  chatWith: number;
  /** 가구 번호 (가족 1), 방문객 */
  household: number;
  visitor: { neighborId: string; leaving: boolean } | null;
  lastSocial: { minute: number; ok: boolean; target: number; ia: string } | null;
  inner: InnerSnap | null;
  /** M4: 직업, 스킬 (식구만), 연출용 마지막 사건 */
  career: { id: string; rank: number; perf: number; attitude: string; orders: { item: string; qty: number; pay: number; done: boolean }[] } | null;
  careerEvent: { careerId: string; eventId: string } | null;
  skills: Record<string, [number, number]> | null;
  lastWork: { minute: number; wage: number } | null;
  lastCraft: { minute: number; recipe: string; quality: number } | null;
  lastSkillUp: { minute: number; skill: string; level: number } | null;
  lastHarvest: { minute: number; item: string; n: number } | null;
}

export interface EconSnap {
  money: number;
  debt: number;
  loans: { principal: number; interest: number; due: number; lender: string }[];
  prices: Record<string, { mult: number; prev: number }>;
  itemPrices: Record<string, number>;
  book: { day: number; income: Record<string, number>; expense: Record<string, number>; money: number }[];
  today: { income: Record<string, number>; expense: Record<string, number> };
  estate: string;
  targetNet: number;
  shop: { open: boolean; priceMult: number; reputation: number; sales: number };
}

/** 관계 (만난 사이만). a < b, respectAB = a 가 b 를 보는 존중 */
export interface RelationSnap {
  a: number;
  b: number;
  friendship: number;
  romance: number;
  respectAB: number;
  respectBA: number;
  name: string;
  flags: string[];
  memories: number;
}

/** 내면 (M2): 감정, 무드렛, 스트레스, 성격, 소원, 목표 */
export interface InnerSnap {
  emotion: string;
  stage: number;
  estate: string;
  stage_life: string;
  traits: string[];
  virtue: string | null;
  sin: string | null;
  likes: string[];
  dislikes: string[];
  stress: number;
  karma: number;
  happiness: number;
  moodlets: { id: string; emotion: string; strength: number; remainingMin: number }[];
  wishes: { id: string; kind: 'wish' | 'fear'; locked: boolean }[];
  aspiration: { id: string; stage: number } | null;
  pendingChoice: string | null;
  memories: number;
}

export interface ObjectSnap {
  uid: number;
  defId: string;
  x: number;
  y: number;
  state: Record<string, number | boolean>;
  rot?: number;
  variant?: string;
}

/** 건축 모드 상태 (M5) */
export interface BuildSnap {
  mode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  warnings: import('./build/builder').BuildWarning[];
  /** 공사 시간 옵션: 공사 예정 (편집, 진척 0~1) */
  construction: boolean;
  pending: { id: number; op: import('./build/builder').BuildOp; progress: number }[];
}

export interface Snapshot {
  tick: number;
  minute: number;
  day: number;
  minuteOfDay: number;
  season: string;
  outsideC: number;
  roomTemps: number[];
  stock: Record<string, number>;
  speed: number;
  autoAccel: boolean;
  persons: PersonSnap[];
  objects: ObjectSnap[];
  notices: Notice[];
  relations: RelationSnap[];
  /** 초대했지만 아직 안 온 이웃 id */
  pendingVisits: string[];
  /** 경제 (M4): 조작 가정 돈/빚/가계부, 장부 가격 배수 */
  econ: EconSnap | null;
  /** 한 번 왔다 간 이웃 (관계 패널 이름용) */
  away: { id: number; name: string; neighborId: string; estate: string }[];
  /** 이번 스냅샷까지 흐른 틱 수와 한 틱의 실제 길이(ms) */
  tickMs: number;
  /** 부지 모양 판 (건축할 때마다 +1). 바뀐 스냅샷에만 lot 이 실림 */
  lotVersion: number;
  lot?: import('./core/types').LotDef;
  /** 방 목록 (부지가 바뀌었거나 한 시간마다) */
  rooms?: import('./build/rooms').RoomInfo[];
  build: BuildSnap | null;
  /** 마을 (M6): 인구, 세밀도, 소식, 모든 인물의 대략 위치 (미니맵) */
  town?: {
    population: number;
    lod: { full: number; simple: number; summary: number };
    news: { day: number; kind: string; args: Record<string, string | number> }[];
    people: { id: number; name: string; household: number; lod: string; x: number; y: number; stage: string }[];
    /** 빈 집 부지 (이사), 조작 가문 부지 */
    freeLots: string[];
    playerLot: string | null;
  } | null;
  /** 가문·사회 (M8·M9): 조작 가문의 가문·명성·가훈·문장·신분·해방금·영지·하인·가보·가계도, 전해 들은 우리 소문, 편지함, 혼담 */
  house?: HouseSnap | null;
  hash?: string;
}

export interface HouseSnap {
  clan: { id: number; name: string | null; fame: number; tier: string; motto: string | null; heraldry: unknown; law: string; head: number } | null;
  estate: string;
  /** 농노 해방금 (파딩): 필요, 가진 돈 */
  emancipation: { fee: number; money: number } | null;
  fief: { manors: number; tenants: number; lord: boolean; policy: boolean } | null;
  treasury: number;
  morale: number;
  lordFavor: number;
  servants: { id: number; role: string; loyalty: number }[];
  heirlooms: { id: number; defId: string; name: string | null; status: string; damaged: string | null }[];
  lostHeirlooms: number[];
  /** 가계도 (하루에 한 번 갱신): 세대 0 = 가장 위 */
  tree: { id: number; name: string; sex: string; generation: number; alive: boolean; estate: string; title: string | null; cause: string | null; spouse: number; mother: number; father: number; bastard: boolean }[];
  rumors: { id: number; kind: string; args: Record<string, string | number>; known: number; good: boolean; strength: number }[];
  letters: { id: number; kind: string; fromName: string; to: number; read: boolean; sentDay: number }[];
  betrothed: { a: number; b: number; weddingDay: number; path: string }[];
  /** 영지 (18-4): 정책 단계, 민심, 금고, 폭동, 최근 7일 범죄, 조작 가문이 영주인가 */
  domain: { levels: Record<string, string>; morale: number; treasury: number; riots: number; crimes7: number; lord: boolean; plague: boolean } | null;
  /** 혼처 (14-4 중매혼): 찾는 사람별 후보 (지참금 파딩, 우리가 내는가) */
  matches: { matchId: number; seeker: number; personId: number; name: string; sex: string; estate: string; age: number; dowry: number; wePay: boolean; fame: number; traits: string[]; clan: number; incoming: boolean }[];
  /** 신분 오르기 (16-3): 가장이 지금 할 수 있는 길 (op = house 의도 이름, 못 하면 이유 키) */
  rise: { op: string; ok: boolean; reason?: string; cost?: number; personId: number }[];
  /** 조작 가문에게 온 사건 카드 (24-1: 고르기 대기) */
  cards: { seq: number; cardId: string; titleKey: string; bodyKey: string; personId: number; otherId: number; vars: Record<string, string | number>; options: { n: number; textKey: string }[] }[];
  /** 조작 가문이 걸린 재판 (27-7 차단 장면) */
  trial: { id: number; crime: string; accused: number; accuser: number; judge: number; stage: string; witnesses: { id: number; side: string; persuaded: boolean }[]; lines: { key: string; args: Record<string, string | number> }[]; verdict: { guilty: boolean; punish: string | null; amount: number; days: number } | null } | null;
}

export type ToWorker =
  | { type: 'init'; data: unknown; seed: number; persons: { name: string; appearance: Record<string, unknown>; estate?: string; sex?: string; stage?: string }[]; relations?: { a: number; b: number; friendship?: number; romance?: number; respect?: number; flags?: string[] }[] }
  | { type: 'setSpeed'; speed: number }
  | { type: 'queue'; personId: number; interactionId: string; targetUid: number; reqId: number }
  | { type: 'goto'; personId: number; x: number; y: number; reqId: number }
  | { type: 'cancel'; personId: number; queueItemId: number }
  | { type: 'menu'; personId: number; targetUid: number; reqId: number }
  | { type: 'pause'; paused: boolean; reqId: number }
  | { type: 'fastForward'; minutes: number; reqId: number }
  | { type: 'setNeed'; personId: number; need: string; value: number; reqId: number }
  | { type: 'setTime'; minuteOfDay: number; reqId: number }
  | { type: 'setObjectState'; uid: number; state: Record<string, number | boolean>; reqId: number }
  | { type: 'setAutonomy'; enabled: boolean; reqId: number }
  | { type: 'reseed'; seed: number; reqId: number }
  | { type: 'stats'; reqId: number }
  | { type: 'spawn'; name: string; appearance: Record<string, unknown>; x?: number; y?: number; reqId: number }
  | { type: 'inputLog'; reqId: number }
  | { type: 'intent'; intent: Record<string, unknown>; reqId: number }
  | { type: 'menuPerson'; personId: number; targetPersonId: number; reqId: number }
  | { type: 'wishHint'; personId: number; wishId: string; reqId: number }
  /** 건축 미리보기: 물건을 놓을 수 있는가 (입력 로그에 남지 않는 조회) */
  | { type: 'buildQuery'; defId: string; x: number; y: number; rot: number; except?: number; reqId: number };

export type FromWorker =
  | { type: 'snapshot'; snap: Snapshot }
  /** 틱 사이 걷는 사람의 예측 위치 (초당 30번, 그리기 전용): ids[i] 의 자리 = xy[2i], xy[2i+1] (칸 좌표) */
  | { type: 'motion'; tick: number; at: number; ids: number[]; xy: number[] }
  | { type: 'reply'; reqId: number; result: unknown }
  | { type: 'menu'; reqId: number; entries: MenuEntry[] }
  | { type: 'error'; message: string };
