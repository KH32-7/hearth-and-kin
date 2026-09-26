/** 시뮬레이션 공용 타입. 렌더러/DOM 의존 없음 */

export type NeedId = 'hunger' | 'energy' | 'hygiene' | 'bladder' | 'fun' | 'social' | 'warmth' | 'comfort';
export const NEED_IDS: readonly NeedId[] = ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social', 'warmth', 'comfort'];

export type Facing = 'up' | 'down' | 'left' | 'right';
export type Pose = 'stand' | 'sit' | 'lie';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface SlotDef {
  id: string;
  dx: number;
  dy: number;
  facing: Facing;
  pose: Pose;
}

export interface ObjectDef {
  nameKey: string;
  footprint: { w: number; h: number };
  blocks: boolean;
  wallMounted?: boolean;
  slots: SlotDef[];
  tags: string[];
  price?: number;
  roomScore?: number;
  light?: number;
  /** 기능 기반 물건 id (카탈로그 물건: 상호작용/상태 규칙은 기반을 따름) */
  kind?: string;
  /** 구매 모드 분류 (23-4) */
  category?: string;
  /** 품질 0 초라함 ~ 4 걸작 */
  quality?: number;
  /** 최소 신분 */
  estate?: string | null;
  /** 방 이름 추정 힌트 */
  roomType?: string;
  /** 쓰면 닳음 (23-4 내구도) */
  durable?: boolean;
  /** 가진 방향 */
  rotations?: number[];
  /** 탁자 위 소품 / 러그 밑 */
  surface?: boolean;
  underRug?: boolean;
  /** 색/재질 변형 이름 목록 */
  variants?: string[];
  /** 방향 없는 물건: 좌우 반전 허용 (rot 2 = 반전). 슬롯 없는 장식만 */
  flip?: boolean;
}

/** 문 잠금 (23-2): 가족만 / 모두 / 신분 이상 */
export type DoorLock = 'family' | 'all' | 'estate';

export interface LotOpening {
  x: number;
  y: number;
  kind: 'door' | 'window';
  /** 문/창 종류 (artpack doors/windows id). 없으면 벽 재질의 기본 문/창 */
  variant?: string;
  lock?: DoorLock;
}

export interface LotObject {
  id: string;
  x: number;
  y: number;
  rot?: number;
  /** 색/재질 변형 (catalog variants) */
  variant?: string;
}

/**
 * 부지. w × h 는 한 층 판의 크기. 배열은 슬랩을 쌓은 전체 격자 (world/lot.ts, 길이 w × rows).
 * 파일에는 한 층(w × h)만 적어도 되고 normalizeLot 이 펼침. y 는 전부 전체 행 좌표
 */
export interface LotDef {
  id: string;
  w: number;
  h: number;
  /** 전체 행 수 (normalizeLot 이후) */
  rows?: number;
  /** 슬랩 → 층 번호 (normalizeLot 이후 LEVELS) */
  levels?: number[];
  /** 땅: 지형 id (grass, dirt …) 또는 옛 타일 id. 1층 판만 */
  ground: (string | null)[];
  /** 바닥 재질 id (floor_wood …) 또는 옛 타일 id */
  floor: (string | null)[];
  /** 벽 재질 id (wall_timber …) / 울타리 id (fence_wood …) */
  walls: (string | null)[];
  openings: LotOpening[];
  objects: LotObject[];
  spawn: { x: number; y: number };
  /** 부지 출구 (길 끝). 래빗홀(장터 다녀오기 등)이 여기로 나감 */
  exits?: { x: number; y: number }[];
  /** 지붕 재질 (자동 지붕, 23-2) */
  roof?: { style: string };
  /** 방 이름 (방의 대표 칸 → 이름 키). 방 인식이 매번 번호를 다시 매기므로 칸으로 기억 */
  roomNames?: { x: number; y: number; name: string }[];
}

export type StateValue = number | boolean;

export interface ObjectInstance {
  uid: number;
  defId: string;
  x: number;
  y: number;
  state: Record<string, StateValue>;
  /** 시계 방향 90° 회전 횟수 (0~3). 발자국과 슬롯이 함께 돔 */
  rot?: number;
  /** 창문 같은 가상 물건의 슬롯 (정의 대신 인스턴스에 붙음) */
  slotsOverride?: SlotDef[];
  /** 색/재질 변형 */
  variant?: string;
}

export type PersonStatus = 'available' | 'rabbithole' | 'journey' | 'scene' | 'incapacitated' | 'ghost';

export interface QueueItem {
  id: number;
  interactionId: string;
  targetUid: number;
  /** 자율로 넣은 항목인지 (플레이어 명령이 끼어들면 취소됨) */
  autonomous: boolean;
}

export interface Intent {
  type: string;
  [key: string]: unknown;
}
