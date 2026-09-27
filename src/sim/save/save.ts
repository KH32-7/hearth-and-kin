/**
 * sim 저장/불러오기 (GDD 27-5, BRIEF 1장 "저장은 틱 경계에서만"). 워커는 틱 사이에만 메시지를 처리하므로
 * 여기 부르는 때가 곧 틱 경계
 */
import { resetAutonomyCaches } from '../action/autonomy';
import { PathFinder } from '../action/path';
import { Builder } from '../build/builder';
import { Fire } from '../build/fire';
import { Rng } from '../core/rng';
import { Economy } from '../econ/economy';
import { Childcare } from '../family/childcare';
import { Lifecycle } from '../family/lifecycle';
import { PregnancySystem } from '../family/pregnancy';
import { Farming } from '../farm/farming';
import { DeathRules } from '../health/deathRules';
import { Clans } from '../house/clans';
import { Estates } from '../house/estates';
import { FiefSystem } from '../house/fief';
import { Heirlooms } from '../house/heirlooms';
import { Honor } from '../house/honor';
import { Inheritance } from '../house/inheritance';
import { Servants } from '../house/servants';
import { Sumptuary } from '../house/sumptuary';
import { HouseLink } from '../houseLink';
import { Inner } from '../inner/inner';
import { Person } from '../people/person';
import { Skills } from '../people/skills';
import { Simulation } from '../sim';
import { Relations } from '../social/relations';
import { Courtship } from '../society/courtship';
import { Feuds } from '../society/feud';
import { Justice } from '../society/justice';
import { Letters } from '../society/letters';
import { PlagueLite } from '../society/plagueLite';
import { LordPolicy } from '../society/policy';
import { SocietyLink } from '../societyLink';
import { Cards } from '../story/cards';
import { LifeJudge } from '../town/lifeJudge';
import { Rumors } from '../town/rumors';
import { Town } from '../town/town';
import { Grid } from '../world/grid';
import { World } from '../world/world';
import { decodeInto, encodeGraph, type ClassTable, type Transient } from './graph';

/** 저장 형식 판. 올릴 때 MIGRATIONS 에 이전 판 → 이 판 변환을 넣음 */
export const SAVE_VERSION = 1;

/**
 * sim 의 모든 클래스를 고정 키로 (배포 빌드는 클래스 이름을 압축해 바꿈 → 이름에 기대면 배포마다 옛 저장본을 못 읽음).
 * 키는 바꾸지 말 것. 새 클래스는 여기 추가 (tests/unit/save.test.ts 가 src/sim 의 export class 를 모두 찾아 확인)
 */
export const SAVE_CLASSES: ClassTable = {
  Simulation, Person, Rng, World, Grid, PathFinder, Builder, Fire, Economy, Skills, Farming, Inner, Relations,
  Childcare, Lifecycle, PregnancySystem, DeathRules, Town, LifeJudge, Rumors, Cards,
  HouseLink, Clans, Estates, FiefSystem, Heirlooms, Honor, Inheritance, Servants, Sumptuary,
  SocietyLink, Courtship, Feuds, Justice, Letters, PlagueLite, LordPolicy,
};
const TABLE = SAVE_CLASSES;
/** 길찾기 작업 버퍼 (마을에서 12MB): 매 탐색마다 세대 번호로 새로 씀 */
const TRANSIENT: Transient = { Simulation: ['path', 'bfsQueue'] };

export interface SimSave {
  v: number;
  seed: number;
  graph: string;
}

/** 판 n → n+1 (저장본 전체를 받아 고침). 지금은 1판뿐 */
const MIGRATIONS: Record<number, (s: SimSave) => SimSave> = {};

export function saveSim(sim: Simulation, seed: number): SimSave {
  return { v: SAVE_VERSION, seed, graph: encodeGraph(sim, sim.data, TABLE, TRANSIENT) };
}

/** fresh: 같은 데이터·저장본 seed 로 막 만든 sim. 그 위에 덮어씀 */
export function loadSimInto(fresh: Simulation, save: SimSave): void {
  let s = save;
  while (s.v < SAVE_VERSION) {
    const m = MIGRATIONS[s.v];
    if (!m) throw new Error(`save: ${s.v}판 저장본을 옮길 방법이 없음`);
    s = m(s);
  }
  if (s.v > SAVE_VERSION) throw new Error(`save: 더 새 판(${s.v}) 저장본`);
  decodeInto(s.graph, fresh, fresh.data, TABLE, TRANSIENT);
  resetAutonomyCaches();
}
