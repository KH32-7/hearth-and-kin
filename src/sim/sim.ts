/**
 * 시뮬레이션 본체 (M1: 한 사람의 하루). 렌더러/DOM 없이 돌아감 (BRIEF 0장 1).
 * 한 번의 tick() = 게임 1분.
 */
import { Rng } from './core/rng';
import type { NeedId, ObjectInstance, QueueItem } from './core/types';
import { NEED_IDS } from './core/types';
import type { SimData } from './data/simData';
import { chooseAutonomous, needSolvable, repairAds, urgency, type Candidate } from './action/autonomy';
import type { SocialDef } from './data/schema';
import { EMOTION_IDS } from './inner/emotion';
import {
  applyInteractionEffects,
  applyStepEffects,
  checkRequires,
  resolveStep,
  stepStillValid,
  targetConditionsHold,
  type Availability,
} from './action/interactions';
import { PathFinder } from './action/path';
import { Builder, type BuildOp, type BuildResult } from './build/builder';
import { evaluateRooms, roomMoodlet, type RoomInfo } from './build/rooms';
import { Fire } from './build/fire';
import { Town, type PeopleMember } from './town/town';
import { LifeJudge } from './town/lifeJudge';
import { Lifecycle, lifecycleSchema } from './family/lifecycle';
import { Childcare, type ChildcareData } from './family/childcare';
import { PregnancySystem, parsePregnancy, type LaborOption } from './family/pregnancy';
import { DeathRules, parseDeathRules, type SetDeathRulesIntent } from './health/deathRules';
import { express, geneticsFrom, inherit, randomGenome, type GeneticsData } from './family/genetics';
import { namesFrom, pickName, type NamesData } from './family/names';
import { memberRuntime, validateFamily, type FamilySpec } from './family/creation';
import { Cards } from './story/cards';
import { HouseLink } from './houseLink';
import { Rumors } from './town/rumors';
import type { LifeStage } from './people/person';
import { NEED_INDEX, Person } from './people/person';
import { World } from './world/world';
import { Inner } from './inner/inner';
import { Relations, firstImpression } from './social/relations';
import { DEFAULT_RELATIONS, checkSocialRequires, interestsOf, isRomantic, rank, relationRules, socialChance } from './social/rules';
import type { RelationsData } from './data/schema';
import { Economy, type Account, type EstateId } from './econ/economy';
import { Skills } from './people/skills';
import { Farming } from './farm/farming';
import { ATTITUDE, COMMUTE_MINUTES, dayPerformance, isWorkday, wageOf, type Attitude } from './people/careers';
import type { ItemDef } from './data/simData';

export const GOTO_ID = '__goto';
const NO_TAGS: readonly string[] = [];
/** 사람 메뉴에서 아예 빼는 이유 (지금 상황이 아니라 관계/신분/나이 조건) */
const HIDE_REASONS = new Set(['reason.target_infant', 'reason.stage', 'reason.not_mother', 'reason.not_lactating', 'reason.not_in_cradle', 'reason.potty_trained', 'reason.skill_done', 'reason.no_homework', 'reason.no_birthday', 'reason.not_adult', 'reason.family', 'reason.already_met', 'reason.estate', 'reason.estate_above', 'reason.estate_below', 'reason.household', 'reason.not_household', 'reason.trait', 'reason.virtue', 'reason.sin', 'reason.relation', 'reason.relation_not']);
const DX4 = [1, -1, 0, 0];
/** 마을 NPC 의 돈 조건 (추상 살림): 늘 충분함 */
const NPC_MONEY = (): number => 1e12;
const DY4 = [0, 0, 1, -1];

export interface Notice {
  /** 알림 순번 (단조 증가) */
  seq?: number;
  minute: number;
  personId: number;
  kind: string;
  args?: Record<string, string | number>;
}

/**
 * 상태를 바꾸는 플레이어/도구 입력. 모두 입력 로그에 {틱, 의도}로 남음 → 같은 시드 + 같은 로그 = 같은 결과 (BRIEF 0장 5)
 */
export type SimIntent =
  | { kind: 'queue'; personId: number; interactionId: string; targetUid: number }
  | { kind: 'goto'; personId: number; x: number; y: number }
  | { kind: 'cancel'; personId: number; queueItemId: number }
  | { kind: 'setNeed'; personId: number; need: NeedId; value: number }
  | { kind: 'setObjectState'; uid: number; state: Record<string, number | boolean> }
  | { kind: 'setTime'; minuteOfDay: number }
  | { kind: 'setAutonomy'; enabled: boolean }
  | { kind: 'spawn'; name: string; appearance: Record<string, unknown>; x?: number; y?: number; traits?: string[]; estate?: string; sex?: 'male' | 'female'; stage?: 'child' | 'teen' | 'adult' | 'elder' }
  | { kind: 'choose'; personId: number; option: string }
  | { kind: 'buyReward'; personId: number; reward: string }
  | { kind: 'lockWish'; personId: number; wish: string; locked: boolean }
  | { kind: 'setTraits'; personId: number; traits: string[] }
  | { kind: 'setStress'; personId: number; value: number }
  | { kind: 'addMoodlet'; personId: number; moodlet: string }
  | { kind: 'invite'; personId: number; neighborId: string }
  | { kind: 'sendHome'; personId: number }
  | { kind: 'setRelation'; a: number; b: number; friendship?: number; romance?: number; respect?: number; flags?: string[]; met?: boolean }
  | { kind: 'setCareer'; personId: number; careerId: string | null }
  | { kind: 'setAttitude'; personId: number; attitude: Attitude }
  | { kind: 'careerChoice'; personId: number; option: string }
  | { kind: 'setShop'; open: boolean; priceMult?: number }
  | { kind: 'setStock'; item: string; n: number }
  | { kind: 'marketBuy'; personId: number; item: string; n: number }
  | { kind: 'marketSell'; personId: number; item: string; n: number }
  | { kind: 'build'; op: BuildOp }
  | { kind: 'buildUndo' }
  | { kind: 'buildRedo' }
  | { kind: 'buildMode'; on: boolean }
  /** 돈 받기 (빈 부지 시작 건축 자금 23-1, 사건 보상): 십일조 없음 */
  | { kind: 'grant'; amount: number; reason: string }
  /** 설정: 공사 시간 (23-3, 기본 꺼짐) */
  | { kind: 'setConstruction'; on: boolean }
  /** 화면 범위 (M6 세밀도: 칸, 1층 판 좌표). 카메라가 움직일 때 게임이 보냄 → 입력 로그 (재생 결정론) */
  | { kind: 'setView'; x0: number; y0: number; x1: number; y1: number }
  /** 세밀도 강제 (13-6 회귀 테스트, 도구용) */
  | { kind: 'forceLod'; lod: 'full' | 'simple' | 'summary' | null }
  /** 이사 (18-5): 마을의 빈 집 부지를 사서 옮김. 살던 집은 되팔기 비율로 팔림 */
  | { kind: 'moveHouse'; lot: string }
  /** 생애와 가족 (M7): 교육 경로(15-5), 도제(15-6), 입양·대부모(15-7), 유모(15-3), 생일 미루기·노화 끄기·수명 설정(10-2), 아기 안기/내려놓기 */
  | { kind: 'setEducation'; personId: number; path: string }
  | { kind: 'apprentice'; personId: number; careerId: string }
  | { kind: 'adopt'; personId: number; stage: string }
  | { kind: 'setGodparent'; childId: number; godparentId: number }
  | { kind: 'hireWetNurse'; babyId: number; payerId: number }
  | { kind: 'delayBirthday'; personId: number }
  | { kind: 'setAgingOff'; personId?: number; household?: number; off: boolean }
  | { kind: 'setLifespan'; preset: string }
  | { kind: 'putDownBaby'; babyId: number }
  /** 사건 카드 선택 (24-1): 대기 중인 카드 순번, 선택지 번호 */
  | { kind: 'cardChoice'; seq: number; option: number }
  /** 가문과 신분 (M8, houseLink.ts intent): applyPreset, payEmancipation, knight, designateHeirloom, writeWill, setMotto, setHeraldry, hireServant … */
  | { kind: 'house'; op: string; args?: Record<string, unknown> }
  /** 캐릭터 만들기 (10-1): 만들기 사양으로 조작 가문을 새로 꾸림 (검증 실패면 거부). 기존 조작 가문 식구는 떠남 */
  | { kind: 'createFamily'; spec: FamilySpec }
  /** 진통 선택 (15-2): 산파 부르기 / 가족이 받기 / 혼자 */
  | { kind: 'laborChoice'; personId: number; option: LaborOption }
  /** 사망 설정 행렬 (20-7): 프리셋 또는 칸 */
  | ({ kind: 'setDeathRules' } & SetDeathRulesIntent)
  /** 직접 조작 (WASD) 방향: 누른 방향이 바뀔 때만. dx = dy = 0 이면 멈춤 (조작 끝) */
  | { kind: 'steer'; personId: number; dx: number; dy: number }
  /** 직접 조작 위치: 워커가 틱 직전에 그동안 움직인 위치를 남김 (재생 결정론) */
  | { kind: 'directPos'; personId: number; x: number; y: number; facing: 'up' | 'down' | 'left' | 'right' };

export interface LoggedIntent {
  tick: number;
  intent: SimIntent;
}

export interface MenuEntry {
  interactionId: string;
  nameKey: string;
  icon: string;
  available: boolean;
  reasonKey?: string;
  reasonArgs?: Record<string, string | number>;
  /** 사회 상호작용: 분류, 지금 성공 확률(%) */
  category?: string;
  chance?: number;
  /** 원형 메뉴 분류 항목: 안에 든 상호작용 수 */
  count?: number;
  /** 제작 레시피 분류 (요리/제빵/양조 …) */
  group?: string;
}

export interface SimStats {
  ticks: number;
  /** 욕구별: 해결 가능한데 0인 채 연속 방치된 최장 분 */
  maxNeglect: Record<NeedId, number>;
  neglectStreak: Record<NeedId, number>;
  stuckEvents: number;
  unsticks: number;
  clipViolations: number;
  pathFails: number;
  collapses: number;
  accidents: number;
  /** 사회 상호작용 성공/실패 (M3 분포 확인) */
  socialOk: number;
  socialFail: number;
  visits: number;
  /** 헛돎: 3분 넘게 걸리는 단계를 시작하고 2분 안에 끝낸 횟수 (깨자마자 다시 눕기, 시작 즉시 중단 반복 감지) */
  shortEnds: number;
  shortEndsBy: Record<string, number>;
  completed: Record<string, number>;
  aborted: Record<string, number>;
  /** 행동별 분 (특성 대표 지표용, M2) */
  minutesByInteraction: Record<string, number>;
}

function emptyNeedRecord(): Record<NeedId, number> {
  return { hunger: 0, energy: 0, hygiene: 0, bladder: 0, fun: 0, social: 0, warmth: 0, comfort: 0 };
}

export class Simulation {
  readonly world: World;
  readonly rng: Rng;
  readonly persons: Person[] = [];
  readonly notices: Notice[] = [];
  readonly stats: SimStats;
  private readonly path: PathFinder;
  private nextQueueId = 1;
  private readonly candBuf: Candidate[] = [];
  /** 이번 틱에 죽은 사람 (굶주림 등): 틱 끝에 처리 */
  private pendingDeaths: { p: Person; cause: string }[] = [];
  /** 진단 도구용: 용변 실수 기록 (null 이면 안 모음) */
  accidentLog: { minute: number; id: number; action: string; phase: string; x: number; y: number; solvable: number }[] | null = null;
  /** 디버그/테스트: 자율 끔 */
  autonomyEnabled = true;
  /** 입력 로그 (재생용) */
  readonly inputLog: LoggedIntent[] = [];
  /** 내면 엔진 (M2). 내면 데이터가 없으면 null */
  readonly inner: Inner | null;
  private readonly seed: number;
  private nextPersonId = 1;
  /** 관계 3축 (M3, GDD 14-1) */
  readonly rel: Relations;
  readonly relData: RelationsData;
  /** 가게 (17-3): 조작 가문이 연 가게. 가격 배수(길드 권장 ±20%), 평판 0~100 */
  readonly shop = { open: false, priceMult: 1, reputation: 30, sales: 0 };
  /** 초대한 이웃: 도착 분 */
  readonly pendingVisits: { neighborId: string; at: number; host: number }[] = [];
  /** 부지 밖에 있는 이웃 (한 번 왔다 간 사람). 다시 오면 같은 인물(같은 id, 관계 유지) */
  readonly away = new Map<string, Person>();
  /** 마을 경제 (M4). economy.json 이 없으면 null */
  readonly econ: Economy | null;
  /** 스킬 (M4). skills.json 이 없으면 null */
  readonly skills: Skills | null;
  /** 농사 (M4). crops.json 이 없으면 null */
  readonly farm: Farming | null;
  private readonly skillBuf: string[] = [];
  /** 조작 가문 시작 형편 (16-2 프리셋): 계정을 열 때 */
  wealth: 'poor' | 'normal' | 'rich' = 'normal';
  /** 건축/구매 모드 (M5). build.json 이 없으면 null */
  readonly builder: Builder | null;
  buildMode = false;
  /** 화재 (23-5). build.json 이 없으면 null */
  readonly fire: Fire | null;
  /** 마을 (M6). 마을 데이터가 없으면 null (한 부지 모드) */
  readonly town: Town | null;
  /** 마을 소식 (18-3): 날, 종류, 인자 */
  readonly news: { day: number; kind: string; args: Record<string, string | number> }[] = [];
  private judgeHostRef!: import('./town/lifeJudge').JudgeHost;
  /** 생애 단계와 생일 (M7, 10-2), 아기·유아·아동 돌봄과 교육 (15-3~15-8). 데이터가 없으면 null */
  readonly lifecycle: Lifecycle | null;
  readonly childcare: Childcare | null;
  /** 유전 (10-3) 과 이름 풀 (10-4). 데이터가 없으면 null */
  readonly genetics: GeneticsData | null;
  readonly names: NamesData | null;
  /** 설정 (M7): 수명 배수, 노화를 끈 가구 */
  readonly settings = { lifespan: 1, agingOffHouseholds: new Set<number>() };
  /** 생애 판정기, 소문 (M6 마을) */
  readonly judge: LifeJudge | null;
  readonly rumors: Rumors | null;
  /** 죽거나 떠난 사람 (연대기, 통계) */
  readonly gone: { id: number; name: string; cause: string; day: number; household: number }[] = [];
  private namePool: { male: string[]; female: string[] } = { male: [], female: [] };
  /** 이번 틱에 끈 불 (행동이 다 끝난 뒤 치움) */
  private putOut: number[] = [];
  private roomsCache: RoomInfo[] = [];
  private roomsAt = -1;
  private roomsVersion = -1;

  constructor(readonly data: SimData, seed: number) {
    this.rng = new Rng(seed);
    this.seed = seed;
    this.world = new World(data);
    this.path = new PathFinder(this.world.grid);
    this.inner = data.inner && data.stress ? new Inner(this, data.inner, data.stress) : null;
    this.relData = data.relations ?? DEFAULT_RELATIONS;
    // 경제는 따로 시드 (경제를 켜도 인물 행동 난수 흐름이 흔들리지 않게)
    this.econ = data.economy ? new Economy(data.economy, new Rng((seed * 31 + 7) >>> 0)) : null;
    this.skills = data.skills ? new Skills(data.skills) : null;
    this.farm = data.crops ? new Farming(data.crops) : null;
    if (this.farm) for (const o of this.world.objects) if (this.isFarmObj(o)) this.farm.initState(o, (this.world.def(o.defId).tags ?? []).includes('orchard') ? 'apples' : undefined);
    if (this.econ) this.world.money = () => this.econ!.account(1)?.money ?? 0;
    this.rel = new Relations(relationRules(this.relData));
    this.builder = data.build
      ? new Builder({
          world: this.world,
          data,
          persons: this.persons,
          econ: this.econ,
          account: () => this.econ?.account(1) ?? null,
          estate: () => this.persons.find((q) => q.household === 1)?.estate ?? 'freeman',
          abortUsing: (uid) => this.abortUsing(uid),
          unstickAll: () => this.unstickAll(),
          onConstruction: (_p, ok) => {
            const host = this.persons.find((q) => q.household === 1);
            if (host) this.notice(host, ok ? 'construction_done' : 'construction_failed');
          },
        })
      : null;
    if (this.builder && data.build?.construction.defaultOn) this.builder.construction = true;
    this.town = data.town
      ? new Town({
          world: this.world, data, persons: this.persons, rng: this.rng,
          addTownPerson: (m, hh, estate, x, y) => this.addTownPerson(m, hh, estate, x, y),
          relate: (a, b, kind, f, r) => this.relateTown(a, b, kind, f, r),
          findPath: (p, from, to) => {
            this.path.who = this.walker(p);
            const r = this.path.find(from, to, false);
            this.path.who = null;
            return r;
          },
          goTo: (p, cell) => {
            if (p.action?.item.autonomous) this.abortAction(p, 'schedule');
            p.queue = p.queue.filter((q) => !q.autonomous);
            this.queueInteraction(p.id, GOTO_ID, cell, true);
          },
          abortAll: (p) => {
            if (p.action) this.abortAction(p, 'lod');
            p.queue = [];
            this.world.release(p.id);
            p.engagedWith = 0;
            p.chatWith = 0;
            p.pose = 'stand';
            p.sleeping = false;
          },
          walkSpeed: () => this.data.balance.movement.walkTilesPerMinute,
          rideMult: (p, remaining, next) => this.rideMult(p, remaining, next),
          engagedWithControlled: (p) => this.engagedWithControlled(p),
        }, data.town.def, data.town.schedules)
      : null;
    if (this.town && data.town?.people) this.town.populate(data.town.people);
    // 마을: 건축은 조작 가문 부지 안에서만
    if (this.town && this.builder) {
      const pl = this.town.playerLot();
      this.builder.area = pl ? [...pl.rect] : [0, 0, -1, -1];
    }
    this.genetics = geneticsFrom(data.family);
    this.names = namesFrom(data.family);
    this.lifecycle = data.family.lifecycle && data.story ? new Lifecycle(this.lifecycleHost(new Rng((seed * 613 + 29) >>> 0)), lifecycleSchema.parse(data.family.lifecycle)) : null;
    this.childcare = data.family.childcare ? new Childcare(this.childcareHost(new Rng((seed * 887 + 13) >>> 0)), data.family.childcare as ChildcareData) : null;
    // 생애 판정기: 마을에서는 전부, 한 부지 모드(M7)에서도 나이·사망·임신은 (혼인·이주는 마을만)
    this.judgeHostRef = this.judgeHost();
    this.judge = data.story && (this.town || this.lifecycle) ? new LifeJudge(this.judgeHostRef, data.story) : null;
    const dr = parseDeathRules(data.family.deathRules);
    if (dr) this.deathRules = new DeathRules(dr);
    if (data.family.events) this.cards = new Cards(this.cardsHost(new Rng((seed * 1223 + 57) >>> 0)), data.family.events);
    const pd = parsePregnancy(data.family.pregnancy);
    if (pd && this.judge) {
      this.pregnancy = new PregnancySystem(this.pregnancyHost(new Rng((seed * 409 + 97) >>> 0)), pd);
      (this.judgeHostRef as { pregnancy?: PregnancySystem }).pregnancy = this.pregnancy;
    }
    // 조작 가문 아기·유아는 실제로 집에 있음 (M7): 아기는 요람/엄마 품, 유아는 엄마 곁
    for (const p of this.persons) if (p.infant && (p.household === 1 || !this.town)) this.showInfant(p);
    this.rumors = this.town && data.story ? new Rumors(new Rng((seed * 977 + 3) >>> 0), data.story.rumor, this.town, this.rumorHost()) : null;
    if (this.rumors) this.registerRumorGates();
    // 가문과 신분 (M8): 가문 레지스트리·명성·신분 두 층·사치 금지법·영지·상속·가보·하인
    this.house = HouseLink.create(this);
    for (const h of data.town?.people?.households ?? []) for (const m of h.members) this.namePool[m.sex].push(m.name);
    this.fire = data.build
      ? new Fire({
          world: this.world,
          data,
          persons: this.persons,
          notice: (p, kind, args) => this.notice(p, kind, args),
          moodlet: (p, id) => this.addEngineMoodlet(p, id),
          rush: (p, uid) => this.rushToFire(p, uid),
          callNeighbor: () => this.callNeighborForFire(),
          callHome: (p) => this.callHomeForFire(p),
          abortUsingHook: (uid) => this.abortUsing(uid),
          heirloomFire: (uid) => !!this.house?.house.heirlooms.onFire(uid),
        }, seed)
      : null;
    this.stats = {
      ticks: 0, maxNeglect: emptyNeedRecord(), neglectStreak: emptyNeedRecord(),
      stuckEvents: 0, unsticks: 0, clipViolations: 0, pathFails: 0, collapses: 0, accidents: 0, shortEnds: 0, shortEndsBy: {},
      completed: {}, aborted: {}, minutesByInteraction: {}, socialOk: 0, socialFail: 0, visits: 0,
    };
  }

  addPerson(
    name: string,
    x = this.data.lot.spawn.x + 0.5,
    y = this.data.lot.spawn.y + 0.5,
    opts: {
      traits?: string[]; estate?: string; sex?: 'male' | 'female'; stage?: Person['stage'];
      household?: number; virtue?: string | null; sin?: string | null; topics?: string[]; innerSeed?: number;
    } = {},
  ): Person {
    const p = new Person(this.nextPersonId++, name, x, y);
    for (const n of NEED_IDS) p.setNeed(n, this.data.needs.needs[n].start);
    if (opts.estate) p.estate = opts.estate;
    if (opts.sex) p.sex = opts.sex;
    if (opts.stage) p.stage = opts.stage;
    if (opts.household) p.household = opts.household;
    if (opts.topics) p.topics = [...opts.topics];
    // 경제: 조작 가문 가정 계정 (첫 인물의 신분으로)
    if (this.econ && p.household < 100 && !this.econ.account(p.household)) this.econ.openAccount(p.household, p.estate as EstateId, this.wealth);
    // 한 가구는 서로 아는 사이 (첫인상 없음)
    for (const q of this.persons) if (q.household === p.household) this.rel.ensure(p.id, q.id).met = true;
    this.persons.push(p);
    // 내면: 인물마다 따로 시드 (시뮬레이션 진행과 무관하게 같은 인물은 같은 성격)
    if (this.inner) {
      this.inner.initPerson(p, new Rng(opts.innerSeed ?? (this.seed * 7919 + p.id * 104729) >>> 0), opts.traits);
      if (opts.virtue !== undefined) p.virtue = opts.virtue;
      if (opts.sin !== undefined) p.sin = opts.sin;
      this.inner.invalidate(p);
      this.inner.refreshWishes(p);
    }
    return p;
  }

  /** 인물 빼기 (방문객이 돌아감). 예약/붙잡힘/대기열 정리 */
  removePerson(p: Person): void {
    if (p.action) this.abortAction(p, 'left');
    this.world.release(p.id);
    for (const q of this.persons) {
      if (q.engagedWith === p.id) q.engagedWith = 0;
      if (q.chatWith === p.id) q.chatWith = 0;
      if (q.action && this.data.social[q.action.item.interactionId] && q.action.item.targetUid === p.id) this.abortAction(q, 'target_left');
      q.queue = q.queue.filter((it) => !(this.data.social[it.interactionId] && it.targetUid === p.id));
    }
    const i = this.persons.indexOf(p);
    if (i >= 0) this.persons.splice(i, 1);
    this.inner?.forget(p);
    p.queue = [];
    (p as { awayDay?: number }).awayDay = this.world.day();
    p.engagedWith = 0;
    p.chatWith = 0;
    if (p.visitor) {
      this.away.set(p.visitor.neighborId, p);
      p.visitor = null;
    }
  }

  /** 부지 안 또는 부지 밖(왔다 간 이웃) 인물 */
  personAny(id: number): Person | undefined {
    const p = this.persons.find((q) => q.id === id);
    if (p) return p;
    for (const q of this.away.values()) if (q.id === id) return q;
    return undefined;
  }

  interests(p: Person): string[] {
    return interestsOf(p, (this.relData as { traitTopics?: Record<string, string[]> }).traitTopics ?? {});
  }

  person(id: number): Person {
    const p = this.persons.find((x) => x.id === id);
    if (!p) throw new Error(`인물 없음 ${id}`);
    return p;
  }

  /** 가족 전원이 자는 중이면 자동 가속 (GDD 13-8, 27-7) */
  shouldAutoAccelerate(): boolean {
    return this.persons.length > 0 && this.persons.every((p) => p.sleeping || p.hidden);
  }

  // ------------------------------------------------------------------ 명령

  /** 모든 상태 변경 입력의 단일 창구: 로그를 남기고 적용 */
  apply(intent: SimIntent): unknown {
    this.inputLog.push({ tick: this.stats.ticks, intent: structuredCloneSafe(intent) });
    switch (intent.kind) {
      case 'queue':
        return this.queueInteraction(intent.personId, intent.interactionId, intent.targetUid);
      case 'goto':
        return this.queueGoto(intent.personId, intent.x, intent.y);
      case 'steer':
        return this.steer(intent.personId, intent.dx, intent.dy);
      case 'directPos':
        return this.directPos(intent.personId, intent.x, intent.y, intent.facing);
      case 'setEducation': {
        const c = this.persons.find((q) => q.id === intent.personId);
        if (!c || !this.childcare) return { ok: false };
        const head = this.persons.find((q) => q.household === c.household && (q.lifeStage === 'young' || q.lifeStage === 'adult' || q.lifeStage === 'elder')) ?? null;
        return this.childcare.setEducation(c, intent.path, head);
      }
      case 'apprentice': {
        const c = this.persons.find((q) => q.id === intent.personId);
        return c && this.childcare ? this.childcare.apprentice(c, intent.careerId, this.settings.lifespan) : { ok: false };
      }
      case 'adopt': {
        const par = this.persons.find((q) => q.id === intent.personId);
        if (!par || !this.childcare) return { ok: false };
        const r = this.childcare.adopt(par, intent.stage);
        return { ok: r.ok, reason: r.reason, childId: r.child?.id };
      }
      case 'setGodparent': {
        const c = this.persons.find((q) => q.id === intent.childId);
        const g2 = this.persons.find((q) => q.id === intent.godparentId);
        return { ok: !!(c && g2 && this.childcare?.setGodparent(c, g2)) };
      }
      case 'hireWetNurse': {
        const b = this.persons.find((q) => q.id === intent.babyId);
        const pay = this.persons.find((q) => q.id === intent.payerId);
        return { ok: !!(b && pay && this.childcare?.hireWetNurse(b, pay)) };
      }
      case 'delayBirthday': {
        const c = this.persons.find((q) => q.id === intent.personId);
        return { ok: !!(c && this.lifecycle?.delay(c)) };
      }
      case 'setAgingOff': {
        if (intent.household !== undefined) {
          if (intent.off) this.settings.agingOffHouseholds.add(intent.household);
          else this.settings.agingOffHouseholds.delete(intent.household);
        }
        const c = intent.personId !== undefined ? this.persons.find((q) => q.id === intent.personId) : undefined;
        if (c) c.agingOff = intent.off;
        return { ok: true };
      }
      case 'setLifespan': {
        const v = this.lifecycle?.d.lifespan.presets[intent.preset];
        if (!v) return { ok: false };
        this.settings.lifespan = v;
        return { ok: true };
      }
      case 'laborChoice': {
        const m = this.persons.find((q) => q.id === intent.personId);
        return { ok: !!(m && this.pregnancy?.chooseLabor(m, intent.option)) };
      }
      case 'setDeathRules': {
        if (!this.deathRules) return { ok: false };
        const { kind: _k, ...rest } = intent;
        void _k;
        this.deathRules.apply(rest as SetDeathRulesIntent);
        return { ok: true };
      }
      case 'house': {
        const r = this.house?.intent(intent.op, intent.args ?? {});
        return r ?? { ok: false, reason: 'no_house' };
      }
      case 'cardChoice': {
        const r = this.cards?.choose(intent.seq, intent.option);
        return r ? { ok: true, result: r } : { ok: false };
      }
      case 'createFamily':
        return this.createFamily(intent.spec);
      case 'putDownBaby': {
        const b = this.persons.find((q) => q.id === intent.babyId);
        if (b) this.childcare?.putDown(b);
        return { ok: !!b };
      }
      case 'cancel':
        this.cancelQueueItem(intent.personId, intent.queueItemId);
        return true;
      case 'setNeed':
        this.person(intent.personId).setNeed(intent.need, intent.value);
        return true;
      case 'setObjectState': {
        const o = this.world.byUid.get(intent.uid);
        if (o) Object.assign(o.state, intent.state);
        this.world.updateRoomTemps(true);
        return !!o;
      }
      case 'setTime': {
        const w = this.world;
        const dayLen = this.data.balance.time.dayMinutes;
        const before = w.minute;
        w.minute = Math.floor(w.minute / dayLen) * dayLen + intent.minuteOfDay;
        this.shiftTime(w.minute - before);
        w.updateRoomTemps(true);
        return { minute: w.minute };
      }
      case 'setAutonomy':
        this.autonomyEnabled = intent.enabled;
        return true;
      case 'spawn': {
        const p = this.addPerson(intent.name, intent.x, intent.y, { traits: intent.traits, estate: intent.estate, sex: intent.sex, stage: intent.stage });
        p.appearance = intent.appearance;
        return { id: p.id };
      }
      case 'choose':
        return this.inner?.choose(this.person(intent.personId), intent.option) ?? false;
      case 'buyReward':
        return this.inner?.buyReward(this.person(intent.personId), intent.reward) ?? false;
      case 'lockWish': {
        const w = this.person(intent.personId).wishes.find((x) => x.id === intent.wish);
        if (w) w.locked = intent.locked;
        return !!w;
      }
      case 'setTraits': {
        const p = this.person(intent.personId);
        p.traits = [...intent.traits];
        this.inner?.invalidate(p);
        return true;
      }
      case 'setStress':
        if (this.inner) {
          const p = this.person(intent.personId);
          p.stress = 0;
          this.inner.addStress(p, intent.value);
        }
        return true;
      case 'addMoodlet':
        return this.inner?.addMoodlet(this.person(intent.personId), intent.moodlet) ?? false;
      case 'invite':
        return this.invite(intent.personId, intent.neighborId);
      case 'sendHome': {
        const p = this.persons.find((q) => q.id === intent.personId);
        if (!p?.visitor) return false;
        this.startLeaving(p);
        return true;
      }
      case 'setCareer':
        return this.setCareer(this.person(intent.personId), intent.careerId);
      case 'setAttitude': {
        const p = this.person(intent.personId);
        if (p.career) p.career.attitude = intent.attitude;
        return !!p.career;
      }
      case 'careerChoice':
        return this.careerChoice(this.person(intent.personId), intent.option);
      case 'marketBuy': {
        // 장터에서 사기 (장부 가격, 돈만큼). 전략 봇/장터 창 (17-8)
        const p = this.person(intent.personId);
        const a = this.account(p);
        const def = this.item(intent.item);
        if (!this.econ || !a || !def) return 0;
        const got = this.econ.buy(a, def, intent.n, def.food ? 'food' : 'goods');
        this.world.stock[intent.item] = (this.world.stock[intent.item] ?? 0) + got;
        if (got) this.setQuality(intent.item, got, 1);
        return got;
      }
      case 'marketSell': {
        const p = this.person(intent.personId);
        const a = this.account(p);
        const def = this.item(intent.item);
        const n = Math.min(intent.n, this.world.stock[intent.item] ?? 0);
        if (!this.econ || !a || !def || n <= 0) return 0;
        this.world.stock[intent.item] -= n;
        return this.econ.sell(a, def, n, 'sale');
      }
      case 'setStock':
        this.world.stock[intent.item] = Math.max(0, intent.n);
        return true;
      case 'build': {
        if (!this.builder) {
          const r: BuildResult = { ok: false, reason: 'disabled', cost: 0, warnings: [] };
          return r;
        }
        return this.builder.apply(intent.op);
      }
      case 'buildUndo':
        return this.builder?.undo() ?? null;
      case 'buildRedo':
        return this.builder?.redo() ?? null;
      case 'grant': {
        const a = this.econ?.account(1);
        if (!a || !this.econ) return false;
        this.econ.earn(a, Math.max(0, Math.round(intent.amount)), intent.reason, false);
        return true;
      }
      case 'setView':
        if (this.town) this.town.view = { x0: intent.x0, y0: intent.y0, x1: intent.x1, y1: intent.y1 };
        return true;
      case 'moveHouse':
        return this.moveHouse(intent.lot);
      case 'forceLod':
        if (this.town) {
          this.town.forceLod = intent.lod;
          this.town.updateLod(this.world.minute);
        }
        return true;
      case 'setConstruction':
        if (this.builder) this.builder.construction = intent.on;
        return true;
      case 'buildMode':
        this.buildMode = intent.on;
        if (!intent.on) this.builder?.clearHistory();
        return true;
      case 'setShop':
        this.shop.open = intent.open;
        if (intent.priceMult !== undefined) this.shop.priceMult = Math.max(0.8, Math.min(1.2, intent.priceMult));
        return { ...this.shop };
      case 'setRelation': {
        const r = this.rel.ensure(intent.a, intent.b);
        if (intent.friendship !== undefined) r.friendship = intent.friendship;
        if (intent.romance !== undefined) r.romance = intent.romance;
        if (intent.respect !== undefined) {
          r.respectAB = intent.respect;
          r.respectBA = intent.respect;
        }
        if (intent.met !== undefined) r.met = intent.met;
        for (const f of intent.flags ?? []) r.flags.add(f);
        return true;
      }
    }
  }

  /** 입력 로그 재생: 새 시뮬레이션에 같은 틱마다 같은 의도를 적용하며 ticks 틱 진행 */
  static replay(data: SimData, seed: number, persons: Array<string | { name: string; estate?: string; sex?: string; stage?: string }>, log: LoggedIntent[], ticks: number): Simulation {
    const sim = new Simulation(data, seed);
    for (const n of persons) {
      if (typeof n === 'string') sim.addPerson(n);
      else sim.addPerson(n.name, undefined, undefined, { estate: n.estate, sex: n.sex as never, stage: n.stage as never });
    }
    let li = 0;
    for (let t = 0; t <= ticks; t++) {
      while (li < log.length && log[li].tick === sim.stats.ticks) sim.apply(log[li++].intent);
      if (t < ticks) sim.tick();
    }
    return sim;
  }

  /** 생애 단계·임신 조건 (15-4, 15-5, 15-1): 플레이어 명령과 자율에 같은 규칙 */
  stageAllows(p: Person, interactionId: string, tags: readonly string[]): boolean {
    if (p.lifeStage === 'baby') return false;
    const gate = (this.data.interactions[interactionId]?.requires as { gate?: string } | undefined)?.gate;
    if (gate && !this.gateOk(gate, p, null)) return false;
    if (this.childcare && !this.childcare.allowInteraction(p, interactionId, tags)) return false;
    if (this.pregnancy && !this.data.social[interactionId] && !this.pregnancy.interactionAllowed(p, interactionId, null)) return false;
    return true;
  }

  queueInteraction(personId: number, interactionId: string, targetUid: number, autonomous = false): { ok: boolean; reason?: string } {
    const p = this.person(personId);
    if (interactionId !== GOTO_ID && !this.data.interactions[interactionId] && !this.data.social[interactionId]) return { ok: false, reason: 'unknown' };
    if (!autonomous && p.queue.length >= this.data.balance.queue.maxLength) return { ok: false, reason: 'queue_full' };
    if (!autonomous && interactionId !== GOTO_ID && !this.data.social[interactionId] && !this.stageAllows(p, interactionId, this.data.interactions[interactionId]?.tags ?? [])) return { ok: false, reason: 'stage' };
    if (!autonomous) {
      // 플레이어 명령은 자율 행동을 밀어냄 (심즈와 같음). 남이 자율로 건 대화에 붙잡혀 있으면 풀려남
      this.releaseEngaged(p);
      if (p.action?.item.autonomous) this.abortAction(p, 'player_override');
      p.queue = p.queue.filter((q) => !q.autonomous);
      if (p.collapse) return { ok: false, reason: 'incapacitated' };
    }
    const item: QueueItem = { id: this.nextQueueId++, interactionId, targetUid, autonomous };
    p.queue.push(item);
    return { ok: true };
  }

  /** 땅 클릭: 그 칸으로 걸어가기 (targetUid 자리에 칸 인덱스를 넣음) */
  queueGoto(personId: number, x: number, y: number): { ok: boolean } {
    const g = this.world.grid;
    if (!g.inBounds(x, y) || !g.walkable(g.idx(x, y))) return { ok: false };
    return this.queueInteraction(personId, GOTO_ID, g.idx(x, y));
  }

  /**
   * 직접 조작 (WASD, 일반 2D 게임처럼): 방향을 누르는 동안 워커가 실제 시간에 맞춰 directStep 으로 움직임.
   * 시작할 때 하던 일과 대기열을 멈추고, 조작 중에는 자율/일과가 끼어들지 않음. 떼면(0,0) 그 자리에 서고
   * 잠시(steerHoldMinutes) 자율을 쉼. 대기열에는 아무것도 넣지 않음
   */
  steer(personId: number, dx: number, dy: number): { ok: boolean } {
    const p = this.persons.find((q) => q.id === personId);
    if (!p || p.collapse || p.status !== 'available' || p.lifeStage === 'baby') return { ok: false };
    const M = this.data.balance.movement as { steerHoldMinutes?: number };
    const dxs = Math.sign(dx);
    const dys = Math.sign(dy);
    if (!dxs && !dys) {
      if (p.direct) {
        p.direct = null;
        p.anim = 'idle';
        p.idleUntil = this.world.minute + (M.steerHoldMinutes ?? 20);
      }
      return { ok: true };
    }
    if (!p.direct) {
      this.releaseEngaged(p);
      if (p.action) this.abortAction(p, 'player_override');
      p.queue = [];
      this.world.release(p.id);
      p.pose = 'stand';
      p.sleeping = false;
      p.underBlanket = false;
      p.riding = false;
    }
    p.direct = { dx: dxs, dy: dys };
    p.facing = dxs > 0 ? 'right' : dxs < 0 ? 'left' : dys > 0 ? 'down' : 'up';
    return { ok: true };
  }

  /** 걸을 수 있는 칸인가 (직접 조작 충돌): 벽/가구/물/잠긴 문 */
  private directWalkable(p: Person, x: number, y: number): boolean {
    const g = this.world.grid;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (!g.inBounds(cx, cy)) return false;
    const i = g.idx(cx, cy);
    if (!g.walkable(i)) return false;
    const lk = g.lock[i];
    if (lk) {
      const who = this.walker(p);
      if (!who.family && (lk === 1 || !who.rankOk)) return false;
    }
    return true;
  }

  /**
   * 직접 조작 한 걸음 (워커가 매 프레임 부름, 입력 로그에는 틱 직전 directPos 로 남음): dist 칸만큼 누른 방향으로.
   * 막히면 축별로 미끄러짐 (벽을 따라 비껴감). 몸 반지름만큼 벽에서 떨어짐. 움직였으면 true
   */
  directStep(p: Person, dist: number): boolean {
    const d = p.direct;
    if (!d || (!d.dx && !d.dy) || dist <= 0) return false;
    const n = d.dx && d.dy ? Math.SQRT1_2 : 1;
    const R = 0.3;
    const x0 = p.x;
    const y0 = p.y;
    const ok = (x: number, y: number) =>
      this.directWalkable(p, x - R, y - R) && this.directWalkable(p, x + R, y - R) && this.directWalkable(p, x - R, y + R) && this.directWalkable(p, x + R, y + R);
    // 배속이 높아도 벽을 건너뛰지 않게 0.2칸씩 나눠 충돌 검사
    const steps = Math.max(1, Math.ceil(dist / 0.2));
    const vx = (d.dx * n * dist) / steps;
    const vy = (d.dy * n * dist) / steps;
    for (let k = 0; k < steps; k++) {
      const bx = p.x;
      const by = p.y;
      if (vx && ok(p.x + vx, p.y)) p.x += vx;
      if (vy && ok(p.x, p.y + vy)) p.y += vy;
      if (p.x === bx && p.y === by) break;
    }
    if (p.x === x0 && p.y === y0) {
      p.anim = 'idle';
      return false;
    }
    p.anim = 'walk';
    p.facing = d.dx > 0 ? 'right' : d.dx < 0 ? 'left' : d.dy > 0 ? 'down' : 'up';
    p.directMoved = true;
    return true;
  }

  /** 직접 조작 위치 적용 (입력 로그 재생): 걸을 수 있는 칸이면 그 자리로 */
  directPos(personId: number, x: number, y: number, facing: 'up' | 'down' | 'left' | 'right'): { ok: boolean } {
    const p = this.persons.find((q) => q.id === personId);
    if (!p || !this.directWalkable(p, x, y)) return { ok: false };
    if (p.trail.length === 0) p.trail.push(p.x, p.y);
    p.x = x;
    p.y = y;
    p.facing = facing;
    p.trail.push(x, y);
    p.directMoved = false;
    return { ok: true };
  }

  /** 다른 사람의 자율 대화에 붙잡혀 있으면 그 대화를 끝냄 (플레이어 명령/취소가 우선) */
  private releaseEngaged(p: Person): void {
    if (!p.engagedWith) return;
    const partner = this.persons.find((q) => q.id === p.engagedWith);
    if (partner?.action?.item.autonomous) this.abortAction(partner, 'player_override');
    p.engagedWith = 0;
  }

  cancelQueueItem(personId: number, queueItemId: number): void {
    const p = this.person(personId);
    this.releaseEngaged(p);
    if (p.action && p.action.item.id === queueItemId) {
      this.abortAction(p, 'cancelled');
      return;
    }
    p.queue = p.queue.filter((q) => q.id !== queueItemId);
  }

  menuFor(personId: number, targetUid: number): MenuEntry[] {
    const p = this.person(personId);
    const obj = this.world.byUid.get(targetUid);
    if (!obj) return [];
    const out: MenuEntry[] = [];
    for (const c of this.data.compiled.byDef.get(obj.defId) ?? []) {
      const ia = c.def;
      // 생애 단계(유아·아동은 할 수 있는 것만)와 임신 준비 상호작용 조건: 메뉴에서 뺌
      if (!this.stageAllows(p, c.id, ia.tags ?? [])) continue;
      let av: Availability = checkRequires(this.world, ia, obj);
      // 밭 작업: 지금 밭 상태에 맞지 않는 작업(가뭄 아닐 때 물 대기, 익기 전 수확 …)은 메뉴에서 뺌
      if (!av.ok && c.id.startsWith('farm.') && /^reason\.(min|max)\./.test(av.reasonKey ?? '')) continue;
      const fr = this.farmOk(p, c.id, obj);
      if (av.ok && fr) av = { ok: false, reasonKey: fr };
      if (fr === 'reason.sow_season' || fr === 'reason.not_garden' || fr === 'reason.not_field') continue;
      const rs = this.recipeSkillOk(p, c.id);
      if (!rs.ok) {
        // 스킬이 한참 모자란 레시피는 메뉴에서 뺌 (다음 레벨 것만 회색으로)
        if ((rs.need ?? 0) - (rs.have ?? 0) > 1) continue;
        av = { ok: false, reasonKey: 'reason.skill_low', reasonArgs: { skill: `skill.${rs.skill}`, n: rs.need ?? 0 } };
      }
      if (av.ok && !resolveStep(this.world, p.id, p.x, p.y, ia.steps[0], obj)) av = { ok: false, reasonKey: 'reason.no_slot' };
      const group = (ia as { group?: string }).group;
      out.push({ interactionId: c.id, nameKey: ia.nameKey, icon: ia.icon, available: av.ok, reasonKey: av.reasonKey, reasonArgs: av.reasonArgs, group });
    }
    return out;
  }

  // ------------------------------------------------------------------ 틱

  tick(): void {
    const w = this.world;
    w.minute++;
    this.stats.ticks++;
    const b = this.data.balance;
    if (w.minute % b.temperature.roomUpdateMinutes === 0) w.updateRoomTemps();
    if (this.data.build && w.minute % this.data.build.rooms.checkMinutes === 0) this.roomMoodlets();
    for (const o of w.objects) {
      if (o.state.lit && this.world.kindOf(o.defId) === 'hearth') {
        o.state.fuelMin = Number(o.state.fuelMin) - 1;
        if (Number(o.state.fuelMin) <= 0) {
          o.state.lit = false;
          o.state.fuelMin = 0;
        }
      }
    }
    if (w.minute % b.time.dayMinutes === 0) {
      this.newDay(w.day());
      const house = (a: number, c: number) => {
        const pa = this.personAny(a);
        const pc = this.personAny(c);
        return !!pa && !!pc && pa.household === pc.household;
      };
      this.rel.decayDaily(house, (id, t) => !!this.personAny(id)?.traits.includes(t));
    }
    this.updateVisits();
    const town = this.town;
    if (town && w.minute % (this.data.story?.lod.checkMinutes ?? 10) === 0) town.updateLod(w.minute);
    for (const p of [...this.persons]) {
      // 마을 세밀도 (13-6): 간이는 길 따라 걷기만, 요약은 10분마다 욕구만, 아기/유아는 엄마 곁 (M7)
      if (town && p.lod !== 'full') {
        if (p.lod === 'simple') town.simpleTick(p, w.minute);
        else town.summaryTick(p, w.minute);
        continue;
      }
      // 아기 (15-3): 스스로 움직이지 않음. 자리·욕구·울음·방치만 (유아는 아래 보통 흐름, 자율은 유아 행동만)
      if (p.lifeStage === 'baby') {
        if (this.childcare && !p.hidden) {
          if (p.trail.length === 0) p.trail.push(p.x, p.y);
          this.childcare.babyTick(p);
          if (p.trail[p.trail.length - 2] !== p.x || p.trail[p.trail.length - 1] !== p.y) p.trail.push(p.x, p.y);
        }
        continue;
      }
      if (p.infant && (p.hidden || !this.childcare)) continue;
      // 마을 NPC 는 자기 가문의 추상 창고로 살림 (조작 가문 저장고를 쓰거나 채우지 않음)
      const npc = !!town && p.household !== 1;
      const own = this.world.stock;
      const ownMoney = this.world.money;
      if (npc) {
        this.world.stock = this.npcPantry(p.household);
        // NPC 살림은 추상 (돈을 따로 세지 않음): 돈 조건은 조작 가문만 받음
        this.world.money = NPC_MONEY;
      }
      // trail은 스냅샷을 보낼 때 비움(takeTrail) → 한 스냅샷에 여러 틱이 들어도 이동 경로가 끊기지 않음
      if (p.trail.length === 0) p.trail.push(p.x, p.y);
      if (p.trail.length > 512) p.trail.splice(0, p.trail.length - 2);
      this.updateNeeds(p);
      if (p.lifeStage === 'toddler') this.childcare?.toddlerMinute(p);
      this.inner?.tick(p);
      this.updatePerson(p);
      if (this.inner) this.updateSmoke(p);
      if (p.trail[p.trail.length - 2] !== p.x || p.trail[p.trail.length - 1] !== p.y) p.trail.push(p.x, p.y);
      this.trackStats(p);
      if (npc) {
        this.world.stock = own;
        this.world.money = ownMoney;
      }
    }
    this.updateMultitask();
    if (this.pendingDeaths.length) {
      for (const d of this.pendingDeaths) if (this.persons.includes(d.p)) {
        this.judge?.recordDeath(d.p, d.cause);
        this.killPerson(d.p, d.cause);
      }
      this.pendingDeaths.length = 0;
    }
    this.fire?.tick();
    this.builder?.tickConstruction(w.minuteOfDay());
    if (this.rumors && w.minute % 60 === 0) this.rumors.hourly(this.persons, w.hour(), w.day());
    if (w.minute % 60 === 0) this.familyHourly(w.hour());
    if (this.putOut.length) {
      for (const uid of this.putOut) this.fire?.removeByUid(uid, true);
      this.putOut.length = 0;
    }
  }

  private noticeSeq = 0;
  /** 가문별 추상 창고와 마지막으로 채운 분 (18-2 요약 살림). 가문마다 따로 셈 (한 창고를 120명이 나눠 쓰면 금방 바닥나 굶음) */
  private npcStock = new Map<number, { stock: Record<string, number>; at: number }>();

  /** NPC 가문의 추상 창고: 정해진 간격마다 시작 재고로 다시 채움 (가계 재고를 실제로 셈하지 않음, 18-2 요약 살림) */
  private npcPantry(household: number): Record<string, number> {
    const every = this.data.story?.npcPantry?.refillMinutes ?? 60;
    let e = this.npcStock.get(household);
    if (!e) {
      e = { stock: { ...this.data.balance.startStock }, at: this.world.minute };
      this.npcStock.set(household, e);
    } else if (this.world.minute - e.at >= every) {
      const base = this.data.balance.startStock;
      for (const k in base) e.stock[k] = Math.max(e.stock[k] ?? 0, base[k]);
      e.at = this.world.minute;
    }
    return e.stock;
  }

  notice(p: Person, kind: string, args?: Record<string, string | number>): void {
    // 마을(M6): 조작 가문 밖 사람의 알림은 띄우지 않음 (마을 소식은 town_news 로 따로)
    if (this.town && p.household !== 1) return;
    this.notices.push({ seq: ++this.noticeSeq, minute: this.world.minute, personId: p.id, kind, args });
    if (this.notices.length > 200) this.notices.splice(0, this.notices.length - 200);
  }

  private currentCompiledStep(p: Person) {
    if (!p.action || p.action.item.interactionId === GOTO_ID) return null;
    return this.data.compiled.byId.get(p.action.item.interactionId)?.steps[p.action.stepIndex] ?? null;
  }

  /** 욕구 i 를 지금 해결할 수 있는가 (몇 분마다 다시 계산하는 캐시) */
  solvable(p: Person, i: number): boolean {
    const every = this.data.balance.autonomy.solvableRecheckMinutes;
    if (this.world.minute - p.solvableAt[i] >= every) {
      p.solvableAt[i] = this.world.minute;
      p.solvableVal[i] = needSolvable(this.data, this.world, p, i, (c, bg) => this.reachable(p, c, bg), this.town ? (o) => this.canUse(p, o) : undefined) ? 1 : 0;
    }
    return p.solvableVal[i] === 1;
  }


  private updateNeeds(p: Person): void {
    if (p.hidden && p.career && p.action?.item.interactionId === `work.${p.career.id}` && this.data.careers?.[p.career.id]?.type === 'journey') return;
    const nd = this.data.needs;
    const b = this.data.balance;
    const cstep = p.action?.phase === 'perform' ? this.currentCompiledStep(p) : null;
    // 래빗홀 근무/일감 중: 일터에서 먹고 볼일 보고 쉼 → 욕구 감소 배수 (13-9, careers.json rules.rabbitholeNeeds + 직업별)
    const rh = p.hidden && p.career && p.action && (p.action.item.interactionId === `work.${p.career.id}` || p.action.item.interactionId.startsWith('service.'))
      ? this.rabbitNeeds(p.career.id)
      // 학교·기숙·몰래 나감 (15-5, 15-6): 밖에서 먹고 볼일 보고 쉼 (래빗홀과 같게)
      : p.schoolAway ? this.awayNeeds()
      : null;
    const sleeping = p.sleeping;
    const sleepDecay = this.data.compiled.sleepDecay;
    for (let i = 0; i < 8; i++) {
      const id = NEED_IDS[i];
      if (id === 'warmth') continue;
      let rate = nd.needs[id].decayPerHour / 60;
      // 유아는 유아 감소율 (15-4), 노년은 기력이 빨리 닮 (10-2)
      if (p.lifeStage === 'toddler' && this.childcare) rate = (this.childcare.d.toddler.decayPerHour[id] ?? nd.needs[id].decayPerHour) / 60;
      else if (p.lifeStage === 'elder' && id === 'energy' && this.lifecycle) rate *= this.lifecycle.d.elder.energyDecayMult;
      if (sleeping) rate *= sleepDecay[i];
      if (p.pregnancy && this.pregnancy) rate *= this.pregnancy.needDecayMult(p, id);
      if (this.inner) rate *= this.inner.fx(p).needDecay[i];
      if (rh) rate *= rh[i];
      if (id === 'comfort' && p.pose !== 'stand') rate = 0;
      p.needs[i] -= rate;
    }
    // 온기 (11-1): 체감 기온
    const wm = nd.warmth;
    let felt = this.world.temperatureAt(p.x, p.y);
    if (this.world.nearLitHearth(p.x, p.y, wm.nearHearthTiles)) felt += wm.nearHearthBonusC;
    // 래빗홀(일터, 장터, 방앗간)은 지붕 아래: 바깥 추위를 그대로 받지 않음 (13-9)
    if (p.hidden && p.action && this.world.byUid.get(p.action.item.targetUid)?.defId === 'lot_exit') felt = Math.max(felt, wm.comfortableFeltC);
    const clothing = p.lifeStage === 'toddler' && this.childcare
      ? this.childcare.d.toddler.clothingWarmth
      : p.underBlanket
      ? wm.clothing.underBlanket
      : p.outfit === 'sleep'
        ? (wm.clothing.sleepNoBlanket ?? 1)
        : (wm.clothing[p.outfit] ?? 1);
    const wi = NEED_INDEX.warmth;
    if (felt < wm.comfortableFeltC) p.needs[wi] -= ((wm.comfortableFeltC - felt) * wm.decayPerDegreePerHour * clothing) / 60;
    else if (felt > wm.recoverAboveC) p.needs[wi] += ((felt - wm.recoverAboveC) * wm.recoverPerDegreePerHour) / 60;
    // 잠: 침대 품질별 에너지
    if (sleeping) {
      const bedDef = p.action ? this.world.byUid.get(p.action.stepObj)?.defId : undefined;
      const perHour = p.collapse ? b.sleep.bedEnergyPerHour.floor : (b.sleep.bedEnergyPerHour[bedDef ?? ''] ?? b.sleep.bedEnergyPerHour.floor);
      p.needs[NEED_INDEX.energy] += perHour / 60;
    }
    if (cstep?.hasNeeds) {
      // 즐거움 회복: 지루함(같은 놀이 반복) × 좋아하는 활동 +50% (12-3)
      const bored = this.inner && p.action ? this.inner.boredom(p, p.action.item.interactionId) * this.inner.funMult(p, p.action.item.interactionId, this.data.interactions[p.action.item.interactionId]?.tags ?? NO_TAGS) : 1;
      for (let i = 0; i < 8; i++) p.needs[i] += i === 4 && cstep.needs[i] > 0 ? cstep.needs[i] * bored : cstep.needs[i];
    }
    for (let i = 0; i < 8; i++) p.needs[i] = p.needs[i] < 0 ? 0 : p.needs[i] > 100 ? 100 : p.needs[i];
    // 난산 회복 중 기력 상한 (15-2)
    if (this.pregnancy) {
      const cap = this.pregnancy.energyCap(p);
      if (cap < 100 && p.needs[NEED_INDEX.energy] > cap) p.needs[NEED_INDEX.energy] = cap;
    }

    // 한계 상황 (11-1 욕구가 0이 되면)
    if (p.needs[NEED_INDEX.energy] <= 0 && !p.sleeping && !p.collapse) {
      this.abortAction(p, 'collapse');
      p.collapse = { kind: 'floor_sleep', remaining: nd.collapse.energyFloorSleepMinutes };
      p.pose = 'lie';
      p.anim = 'hurt';
      p.sleeping = true;
      p.status = 'incapacitated';
      this.stats.collapses++;
      this.notice(p, 'collapse_energy');
    }
    // 유아 기저귀 (15-4): 배변 훈련 전에는 실수가 아니라 기저귀가 젖음
    if (this.childcare?.diaper(p)) p.crying = true;
    if (p.needs[NEED_INDEX.bladder] <= 0) {
      p.needs[NEED_INDEX.bladder] = 100;
      p.needs[NEED_INDEX.hygiene] = b.collapse.bladderAccidentHygiene;
      this.stats.accidents++;
      if (this.accidentLog) this.accidentLog.push({ minute: this.world.minute, id: p.id, action: p.action?.item.interactionId ?? '-', phase: p.action?.phase ?? '', x: p.x, y: p.y, solvable: p.solvableVal[NEED_INDEX.bladder] });
      this.notice(p, 'accident_bladder');
      this.addEngineMoodlet(p, 'embarrassed');
    }
    if (p.needs[NEED_INDEX.hunger] <= 0) {
      p.hungerZeroMinutes++;
      if (p.hungerZeroMinutes >= nd.collapse.hungerZeroWeakenMinutes && !p.weakened) {
        p.weakened = true;
        this.notice(p, 'weakened');
      }
      // 사흘 내리 굶으면 죽음 (틱이 끝난 뒤 처리: 인물 목록을 도는 중에 빼지 않음)
      const young = p.lifeStage === 'baby' || p.lifeStage === 'toddler' || p.lifeStage === 'child';
      const die = young ? nd.collapse.hungerZeroDeathMinutesChild ?? nd.collapse.hungerZeroDeathMinutes : nd.collapse.hungerZeroDeathMinutes;
      if (die && p.hungerZeroMinutes >= die && !this.pendingDeaths.some((d) => d.p === p) && this.deathAllowed('starvation', p)) this.pendingDeaths.push({ p, cause: 'starvation' });
    } else p.hungerZeroMinutes = 0;
  }

  private updatePerson(p: Person): void {
    if (p.collapse) {
      p.collapse.remaining--;
      if (p.collapse.remaining <= 0) {
        if (p.collapse.kind === 'floor_sleep') this.addEngineMoodlet(p, 'slept_on_floor');
        p.collapse = null;
        p.sleeping = false;
        p.pose = 'stand';
        p.anim = 'idle';
        p.status = 'available';
      }
      return;
    }
    // 다른 사람의 사회 상호작용에 붙잡혀 있음 (마주 보고 들어 줌)
    if (p.engagedWith) {
      const partner = this.persons.find((q) => q.id === p.engagedWith);
      if (!partner || !partner.action || !this.data.social[partner.action.item.interactionId] || partner.action.item.targetUid !== p.id) {
        p.engagedWith = 0;
      } else {
        if (partner.action.phase === 'perform') this.facePerson(p, partner);
        p.anim = 'idle';
        return;
      }
    }
    // 직접 조작 중: 자율·일과·출근이 끼어들지 않음 (움직임은 워커가 directStep 으로)
    if (p.direct) return;
    // 학교·기숙·시동으로 집에 없음 (15-5 래빗홀), 떼쓰는 유아 (15-4)
    if (p.schoolAway) return;
    if (p.tantrumUntil > this.world.minute) {
      p.anim = 'fall';
      return;
    }
    if (this.careerDue(p) && (!p.pregnancy || !this.pregnancy || this.pregnancy.canWork(p))) this.goToWork(p);
    else if (!p.action && !p.queue.length && this.autonomyEnabled) this.onsiteWork(p);
    if (p.careerEvent && this.world.minute - p.careerEvent.since >= 120) {
      const ev = this.data.careers?.[p.careerEvent.careerId]?.events?.find((e) => e.id === p.careerEvent!.eventId);
      if (ev) this.careerChoice(p, ev.options[Math.floor(this.rng.next() * ev.options.length)].id);
      else p.careerEvent = null;
    }
    if (p.action) {
      this.progressAction(p);
      return;
    }
    if (p.queue.length) {
      this.startAction(p, p.queue[0]);
      // 제자리에서 바로 수행에 들어갔다면 이번 틱은 시작만 (욕구 효과는 이미 이번 틱 updateNeeds 가 지나감)
      if ((p.action as { phase: string } | null)?.phase === 'walk') this.progressAction(p);
      return;
    }
    if (!this.autonomyEnabled || p.autonomy === 'off') return;
    if (this.world.minute < p.idleUntil) return;
    // 돌아가는 손님은 스스로 다른 일을 고르지 않음 (updateVisits 가 작별/귀가를 넣음)
    if (p.visitor?.leaving) return;
    // 막 도착한 손님은 인사할 때까지 문간에서 기다림 (급한 욕구는 예외: 아래 급한 욕구 규칙)
    if (p.visitor && p.visitor.greetUntil > 0) {
      let urgent = false;
      for (const [i, v] of this.data.compiled.interrupt) if (p.needs[i] < v) urgent = true;
      if (!urgent) {
        p.anim = 'idle';
        return;
      }
    }
    const inner = this.inner;
    // 급한 욕구가 있고 풀 수 있으면 그것을 채우는 행동만 고름 (고르자마자 급한 욕구로 끊기는 헛돎 방지)
    // 가장 급한 욕구 하나 (기준 대비 가장 많이 모자란 것)
    let urgentNeed = -1;
    let worst = Infinity;
    for (const [i, v] of this.data.compiled.interrupt) {
      if (p.needs[i] < v && this.solvable(p, i) && p.needs[i] / v < worst) {
        worst = p.needs[i] / v;
        urgentNeed = i;
      }
    }
    // 스스로 챙기기 (심즈식): 급하기 전에 다음 행동으로 모자란 욕구부터 풂. 반경 안에 풀 곳이 없으면 집으로 돌아감
    if (urgentNeed < 0 && !p.visitor) {
      const care = this.careNeed(p);
      if (care.solvable >= 0) urgentNeed = care.solvable;
      else if (care.unsolved >= 0 && this.goHomeForNeed(p)) return;
    }
    // 방문객: 남의 집에서는 허용 목록의 물건 상호작용만 (잠/목욕/요리/집안일 안 함)
    const ex = p.visitor ? this.relData.visit.allowInteractions : null;
    // 깨우는 욕구(용변, 허기)가 급하고 풀 수 있으면 잠자리에 들지 않음 (눕자마자 깨는 헛돎 방지)
    let noSleep = false;
    for (const [i, v] of this.data.compiled.wakeIf) if (p.needs[i] < v + 3 && this.solvable(p, i)) noSleep = true;
    // 기력이 바닥이면 배고파도 잠 (허기로 못 자고 피로로 장보기를 끊는 교착 방지)
    if (p.needs[NEED_INDEX.energy] < 15) noSleep = false;
    const allow = urgentNeed >= 0 || ex || noSleep
      ? (ci: { id: string; serves: Uint8Array | number[]; def: { tags?: string[]; steps: { sleep?: boolean }[] } }) =>
          (urgentNeed < 0 || ci.serves[urgentNeed] === 1 || ((ci as { supportAds?: Float64Array }).supportAds?.[urgentNeed] ?? 0) > 0 || (ci as { id?: string }).id === 'obj.repair') &&
          !(ex && !ex.includes(ci.id)) &&
          !(noSleep && ci.def.steps[0]?.sleep)
      : undefined;
    // 생애 단계 (15-4, 15-5): 유아는 유아 행동만, 아동은 어른 전용 빼고
    const cc = this.childcare;
    const preg = this.pregnancy;
    const stageAllow = (cc && (p.lifeStage === 'toddler' || p.lifeStage === 'child')) || preg || this.gates.size
      ? (ci: { id: string; def: { tags?: string[]; requires?: unknown } }) => {
          if (cc && !cc.allowInteraction(p, ci.id, ci.def.tags ?? [])) return false;
          if (preg && !preg.interactionAllowed(p, ci.id, null)) return false;
          const g = (ci.def.requires as { gate?: string } | undefined)?.gate;
          return !g || this.gateOk(g, p, null);
        }
      : null;
    const allow2 = stageAllow || allow
      ? (ci: never) => (!stageAllow || stageAllow(ci)) && (!allow || (allow as (x: never) => boolean)(ci))
      : undefined;
    const dependent = p.lifeStage === 'toddler';
    // 마을 NPC: 일과 목적지에서 멀고 급한 욕구가 없으면 그쪽으로 걸어감 (18-2 일과표는 목표, 실제 행동은 자율)
    if (this.town && p.household !== 1 && urgentNeed < 0 && this.schedulePull(p)) return;
    const c = chooseAutonomous(
      this.data, this.world, p, this.rng, this.candBuf,
      inner ? (tags, id) => inner.adMult(p, tags, id) : undefined,
      urgentNeed >= 0 ? undefined : (buf, urg) => {
        if (!dependent) this.socialCandidates(p, buf, urg);
        this.careCandidates(p, buf);
      },
      allow2 as never,
      this.town || urgentNeed >= 0 ? (o) => (!this.town || this.canUse(p, o)) && (urgentNeed < 0 || !o.state.broken || repairAds(this.data, o.defId)[urgentNeed] > 0) : undefined,
    );
    if (!c && urgentNeed >= 0 && !ex) {
      // 풀 수 있다고 봤는데 실제 후보가 없음 (조건·자리·점수): 이 욕구는 잠시 못 푸는 것으로 두고
      // 집으로 가거나, 급한 욕구 거름 없이 다시 고름 (10분 멍하니 서 있지 않게)
      p.solvableAt[urgentNeed] = this.world.minute;
      p.solvableVal[urgentNeed] = 0;
      if (this.goHomeForNeed(p)) return;
      const c2 = chooseAutonomous(
        this.data, this.world, p, this.rng, this.candBuf,
        inner ? (tags, id) => inner.adMult(p, tags, id) : undefined,
        (buf, urg) => {
          if (!dependent) this.socialCandidates(p, buf, urg);
          this.careCandidates(p, buf);
        },
        stageAllow as never,
        this.town ? (o) => this.canUse(p, o) : undefined,
      );
      if (c2) {
        this.queueInteraction(p.id, c2.interactionId, c2.targetUid, true);
        this.startAction(p, p.queue[0]);
        if ((p.action as { phase: string } | null)?.phase === 'walk') this.progressAction(p);
        return;
      }
    }
    if (c) {
      this.queueInteraction(p.id, c.interactionId, c.targetUid, true);
      this.startAction(p, p.queue[0]);
      if ((p.action as { phase: string } | null)?.phase === 'walk') this.progressAction(p);
    } else {
      // 마을: 할 일이 없는데 집 부지 밖이면 집으로 (볼일 뒤 먼 곳에 멈춰 서지 않게)
      const t = this.town;
      if (t && p.household === 1 && p.homeLot && t.lotOf(p.x, p.y)?.id !== p.homeLot && (p.excludedUntil.get(-2) ?? -1) <= this.world.minute) {
        const goal = t.targetCell(p, 'home');
        if (goal !== this.world.grid.idx(p.cellX(), p.cellY())) {
          p.excludedUntil.set(-2, this.world.minute + 30);
          this.queueInteraction(p.id, GOTO_ID, goal, true);
          this.startAction(p, p.queue[0]);
          return;
        }
      }
      p.idleUntil = this.world.minute + this.data.balance.autonomy.idleWanderMinutes;
      p.anim = 'idle';
    }
  }

  /**
   * 스스로 챙기는 욕구 (balance.autonomy.selfCare): 기준 아래인 욕구 중 기준 대비 가장 모자란 것.
   * solvable = 지금 반경 안에서 풀 수 있는 가장 급한 욕구, unsolved = 풀 곳이 없는 욕구 (없으면 -1)
   */
  private careNeed(p: Person): { solvable: number; unsolved: number } {
    const care = this.data.compiled.selfCare;
    let best = -1;
    let bestR = Infinity;
    let miss = -1;
    let missR = Infinity;
    for (const [i, v] of care) {
      if (p.needs[i] >= v) continue;
      const r = p.needs[i] / v;
      if (this.solvable(p, i)) {
        if (r < bestR) {
          bestR = r;
          best = i;
        }
      } else if (r < missR) {
        missR = r;
        miss = i;
      }
    }
    return { solvable: best, unsolved: miss };
  }

  /** 마을: 모자란 욕구를 풀 곳이 가까이 없으면 집(부지 또는 사는 장소)으로 걸어감. 넣었으면 true */
  private goHomeForNeed(p: Person): boolean {
    const t = this.town;
    if (!t || p.infant) return false;
    if ((p.excludedUntil.get(-3) ?? -1) > this.world.minute) return false;
    if (t.insideHome(p)) return false;
    const goal = t.targetCell(p, 'home');
    if (goal < 0 || goal === this.world.grid.idx(p.cellX(), p.cellY())) return false;
    p.excludedUntil.set(-3, this.world.minute + (this.data.balance.autonomy.goHomeCooldownMinutes ?? 45));
    if (p.action?.item.autonomous) this.abortAction(p, 'self_care');
    p.queue = p.queue.filter((q) => !q.autonomous);
    this.queueInteraction(p.id, GOTO_ID, goal, true);
    if (!p.action && p.queue.length) {
      this.startAction(p, p.queue[0]);
      if ((p.action as { phase: string } | null)?.phase === 'walk') this.progressAction(p);
    }
    return true;
  }

  private startAction(p: Person, item: QueueItem): void {
    if (this.data.social[item.interactionId]) {
      this.startSocial(p, item);
      return;
    }
    if (item.interactionId === GOTO_ID) {
      p.action = {
        item, stepIndex: 0, phase: 'route', stepObj: -1, slotId: '', goal: item.targetUid,
        path: [], pathPos: 0, remaining: 0, elapsed: 0, lastProgress: this.world.minute, repaths: 0,
      };
      this.routeTo(p, item.targetUid, false);
      return;
    }
    const ia = this.data.interactions[item.interactionId];
    const target = this.world.byUid.get(item.targetUid);
    if (!target) {
      this.dropFront(p, item, 'no_target');
      return;
    }
    let av = checkRequires(this.world, ia, target);
    const fr = this.farmOk(p, item.interactionId, target);
    if (av.ok && fr) av = { ok: false, reasonKey: fr };
    const rs = this.recipeSkillOk(p, item.interactionId);
    if (av.ok && !rs.ok) av = { ok: false, reasonKey: 'reason.skill_low', reasonArgs: { skill: `skill.${rs.skill}`, n: rs.need ?? 0 } };
    if (!av.ok) {
      if (!item.autonomous) this.notice(p, 'cannot', { ...(av.reasonArgs ?? {}), reason: av.reasonKey ?? '', ia: ia.nameKey });
      this.dropFront(p, item, 'requires');
      return;
    }
    p.action = {
      item, stepIndex: 0, phase: 'route', stepObj: target.uid, slotId: '', goal: -1,
      path: [], pathPos: 0, remaining: 0, elapsed: 0, lastProgress: this.world.minute, repaths: 0,
    };
    if (!item.autonomous) p.recentObjects.length = 0;
    this.inner?.onActionStart(p, item.interactionId);
    this.beginStep(p);
  }

  private dropFront(p: Person, item: QueueItem, why: string): void {
    p.queue = p.queue.filter((q) => q.id !== item.id);
    this.stats.aborted[item.interactionId] = (this.stats.aborted[item.interactionId] ?? 0) + 1;
    if (why === 'path') this.stats.pathFails++;
  }

  private beginStep(p: Person): void {
    const a = p.action!;
    const ia = this.data.interactions[a.item.interactionId];
    const step = ia.steps[a.stepIndex];
    const target = this.world.byUid.get(a.item.targetUid);
    if (!target) {
      // 건축/화재로 대상이 사라짐 (리뷰 M5-1)
      this.finishAction(p, false, 'object_gone');
      return;
    }
    this.world.release(p.id);
    const r = resolveStep(this.world, p.id, p.x, p.y, step, target);
    if (!r || !stepStillValid(step, r.obj)) {
      // 자리를 다른 사람이 쓰고 있을 뿐이면 줄 서서 기다림 (플레이어 명령 20분, 자율 8분)
      const limit = a.item.autonomous ? this.data.balance.queue.waitAutonomousMinutes : this.data.balance.queue.waitMinutes;
      if (!r && (a.waited ?? 0) < limit && this.slotBusyOnly(p, step, target)) {
        a.phase = 'wait';
        a.lastProgress = this.world.minute;
        p.anim = 'idle';
        return;
      }
      if (!a.item.autonomous) this.notice(p, 'cannot', { reason: 'reason.no_slot', ia: ia.nameKey });
      this.finishAction(p, false, 'no_slot');
      return;
    }
    this.world.reserve(r.obj.uid, r.slot.id, p.id);
    a.stepObj = r.obj.uid;
    a.slotId = r.slot.id;
    p.carry = step.carry ?? null;
    const goal = this.world.slotCell(r.obj, r.slot);
    this.routeTo(p, goal, r.slot.pose !== 'stand');
  }

  private routeTo(p: Person, goal: number, allowBlockedGoal: boolean): void {
    const a = p.action!;
    const g = this.world.grid;
    a.goal = goal;
    // 앉아 있거나 누워 있다가 일어남
    if (p.pose !== 'stand') {
      p.pose = 'stand';
      p.sleeping = false;
      p.underBlanket = false;
      p.hidden = false;
    }
    let start = g.idx(p.cellX(), p.cellY());
    this.path.who = this.walker(p);
    let path = this.path.find(start, goal, allowBlockedGoal);
    if (!path && !g.walkable(start) && !this.hasExit(start)) {
      this.unstick(p);
      start = g.idx(p.cellX(), p.cellY());
      path = this.path.find(start, goal, allowBlockedGoal);
    }
    this.path.who = null;
    if (!path) {
      // 원래 대상(식탁, 책장)과 단계 물건(좌석, 화로) 모두 제외 → 자율이 같은 대상을 계속 고르지 않음
      // 사회 상호작용의 대상은 사람: 물건 uid 와 겹치지 않게 음수 키
      const uid = a.item.interactionId === GOTO_ID ? -1 : this.data.social[a.item.interactionId] ? -1000 - a.item.targetUid : a.item.targetUid;
      const fails = (p.pathFails.get(uid) ?? 0) + 1;
      p.pathFails.set(uid, fails);
      if (fails >= this.data.balance.movement.pathFailLimit) {
        const until = this.world.minute + this.data.balance.movement.pathFailExcludeMinutes;
        p.excludedUntil.set(uid, until);
        if (a.stepObj >= 0 && a.stepObj !== uid) p.excludedUntil.set(a.stepObj, until);
        p.pathFails.delete(uid);
      }
      this.notice(p, 'no_path');
      this.finishAction(p, false, 'path');
      return;
    }
    a.path = path;
    a.pathPos = 0;
    a.phase = path.length ? 'walk' : 'perform';
    if (a.phase === 'perform') this.arrive(p);
  }

  private hasExit(cell: number): boolean {
    const g = this.world.grid;
    const x = cell % g.w;
    const y = Math.floor(cell / g.w);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX4[d];
      const ny = y + DY4[d];
      if (g.inBounds(nx, ny) && g.walkable(g.idx(nx, ny))) return true;
    }
    return false;
  }

  /** 예약을 무시하면 자리가 있는가 (= 누가 쓰는 중일 뿐, 기다리면 됨) */
  private slotBusyOnly(p: Person, step: Parameters<typeof resolveStep>[4], target: ObjectInstance): boolean {
    this.world.ignoreReservations = true;
    try {
      return !!resolveStep(this.world, p.id, p.x, p.y, step, target);
    } finally {
      this.world.ignoreReservations = false;
    }
  }

  private progressAction(p: Person): void {
    const a = p.action!;
    if (a.phase === 'wait') {
      a.waited = (a.waited ?? 0) + 1;
      a.lastProgress = this.world.minute;
      this.beginStep(p);
      return;
    }
    if (a.phase === 'perform' && this.data.social[a.item.interactionId]) {
      this.performSocial(p);
      return;
    }
    if (a.phase === 'walk') {
      // 감정이 걸음걸이에 드러남 (11-3: 기운 넘침은 빠르게, 슬픔은 느리게)
      let speed = this.data.balance.movement.walkTilesPerMinute;
      if (this.inner && p.emotionStage >= 1) speed *= this.inner.walkMult(p);
      speed *= this.rideMult(p, a.path.length - a.pathPos, a.path[a.pathPos] ?? -1);
      speed *= this.moveMult(p);
      this.walk(p, speed);
      if (p.lifeStage === 'toddler' && p.anim === 'walk' && this.childcare) p.anim = this.childcare.moveAnim(p);
      return;
    }
    if (a.phase === 'perform') this.perform(p);
  }

  private walk(p: Person, budget: number): void {
    const a = p.action!;
    const g = this.world.grid;
    const startX = p.x;
    const startY = p.y;
    while (budget > 0 && a.pathPos < a.path.length) {
      const cell = a.path[a.pathPos];
      const cx = (cell % g.w) + 0.5;
      const cy = Math.floor(cell / g.w) + 0.5;
      // 다음 칸이 그 사이 막혔는지 (다른 사람이 가구를 놓는 등)
      const last = a.pathPos === a.path.length - 1;
      // 목표 물건 자신의 칸(침대 발치)은 지나갈 수 있음 (path.ts 와 같은 규칙)
      const ownCell = g.objAt[cell] !== 0 && g.objAt[cell] === g.objAt[a.goal] && !g.wall[cell];
      if (!last && !g.walkable(cell) && !ownCell) {
        a.repaths++;
        if (a.repaths > 3) {
          this.finishAction(p, false, 'path');
          return;
        }
        this.routeTo(p, a.goal, true);
        return;
      }
      // 계단/들창으로 다른 층 칸에 오름: 한 칸 거리로 치고 바로 옮김 (렌더러가 계단 높이를 보간)
      if (g.slabOf(cell) !== g.slabOf(g.idx(p.cellX(), p.cellY()))) {
        p.x = cx;
        p.y = cy;
        budget -= 1;
        a.pathPos++;
        p.trail.push(p.x, p.y);
        continue;
      }
      const dx = cx - p.x;
      const dy = cy - p.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > Math.abs(dy)) p.facing = dx > 0 ? 'right' : 'left';
      else if (d > 0) p.facing = dy > 0 ? 'down' : 'up';
      if (d <= budget) {
        p.x = cx;
        p.y = cy;
        budget -= d;
        a.pathPos++;
        p.trail.push(p.x, p.y);
        // 관통: 목표 물건 자신(침대에 올라가는 칸)이 아닌 가구 칸을 지나감
        if (!last && g.objAt[cell] !== 0 && g.objAt[cell] !== g.objAt[a.goal]) this.stats.clipViolations++;
      } else {
        p.x += (dx / d) * budget;
        p.y += (dy / d) * budget;
        budget = 0;
      }
    }
    p.anim = 'walk';
    if (p.x !== startX || p.y !== startY) a.lastProgress = this.world.minute;
    if (a.pathPos >= a.path.length) this.arrive(p);
  }

  private arrive(p: Person): void {
    const a = p.action!;
    if (this.data.social[a.item.interactionId]) {
      this.arriveSocial(p);
      return;
    }
    if (a.item.interactionId === GOTO_ID) {
      this.finishAction(p, true, 'done');
      return;
    }
    const ia = this.data.interactions[a.item.interactionId];
    const step = ia.steps[a.stepIndex];
    const obj = this.world.byUid.get(a.stepObj);
    const slot = obj ? this.world.slots(obj).find((s) => s.id === a.slotId) : undefined;
    if (!obj || !slot) {
      this.finishAction(p, false, 'object_gone');
      return;
    }
    p.x = obj.x + slot.dx + 0.5;
    p.y = obj.y + slot.dy + 0.5;
    p.facing = slot.facing;
    p.pose = slot.pose;
    p.anim = step.anim;
    p.sleeping = !!step.sleep;
    p.underBlanket = !!step.blanket;
    p.hidden = !!step.hidden;
    // 숨는 단계 = 래빗홀 (장터, 일터 등 화면 밖 활동, GDD 13-8)
    if (step.hidden) p.status = 'rabbithole';
    if (step.outfit) p.outfit = step.outfit;
    a.phase = 'perform';
    a.remaining = step.minutes;
    if (p.career && a.item.interactionId === `work.${p.career.id}`) p.career.workedDay = this.world.day();
    const ft = (this.data.interactions[a.item.interactionId] as { farmTask?: string } | undefined)?.farmTask;
    if (ft && this.farm) {
      const tgt = this.world.byUid.get(a.item.targetUid);
      const tags = tgt ? this.world.def(tgt.defId).tags ?? [] : [];
      const sk = this.farm.d.skill;
      const speed = Math.max(sk.speedMin, 1 - sk.speedPerLevel * (p.skills.farming ?? 0));
      a.remaining = Math.max(10, Math.round(step.minutes * (tags.includes('orchard') ? 1 : this.farm.sizeOf(tags).work) * speed));
    }
    a.elapsed = 0;
    a.lastProgress = this.world.minute;
  }

  private perform(p: Person): void {
    const a = p.action!;
    const ia = this.data.interactions[a.item.interactionId];
    const step = ia.steps[a.stepIndex];
    a.remaining--;
    if (this.inner && ia.tags) this.inner.onPerformMinute(p, ia.tags);
    if (this.skills && a.item.interactionId.startsWith('work.') && p.career) {
      const def = this.data.careers?.[p.career.id];
      if (def) this.skillMinute(p, NO_TAGS, def.skills[0], Math.round((ATTITUDE[p.career.attitude].xp - 1) * 100), 1, def.skills);
    } else if (this.skills && a.item.interactionId.startsWith('recipe.')) {
      // 레시피 경험치는 레시피 스킬로만 (레시피 tags 는 특성 선호용: 제빵에도 cook 이 붙어 있음)
      const r = this.data.recipes[a.item.interactionId.slice(7)];
      if (r) this.skillMinute(p, NO_TAGS, r.skill, 0, r.xp);
    } else if (this.skills && ia.tags && !step.sleep) this.skillMinute(p, ia.tags, (ia as { skill?: string }).skill);
    a.elapsed++;
    a.lastProgress = this.world.minute;
    this.stats.minutesByInteraction[a.item.interactionId] = (this.stats.minutesByInteraction[a.item.interactionId] ?? 0) + 1;
    if (this.childcare) this.childMinute(p, ia as unknown as { teach?: Record<string, number>; homework?: number; steps?: { minutes: number }[] });
    let done = a.remaining <= 0;
    if (step.until && p.need(step.until.need) >= step.until.gte) done = true;
    // 근무: 퇴근 시각이 되면 끝 (늦게 왔으면 그만큼 짧게 일함). 여정은 정한 날 수가 차면
    if (p.career && a.item.interactionId === `work.${p.career.id}`) {
      const def = this.data.careers?.[p.career.id];
      if (def?.type === 'journey') done = this.world.minute >= (p.career.tripEnd ?? 0);
      else if (def && this.world.minuteOfDay() >= def.hours[1] * 60) done = true;
    }
    // 대상 상태가 바뀌어 더 할 수 없음 (불이 꺼지면 불 쬐기 끝)
    if (a.stepObj === a.item.targetUid) {
      const target = this.world.byUid.get(a.item.targetUid);
      if (target && !targetConditionsHold(ia, target)) {
        this.finishAction(p, a.elapsed > 1, 'invalid');
        return;
      }
    }
    const comp = this.data.compiled;
    if (step.sleep) {
      // 잠에서 깸: 그 욕구를 지금 풀 수 있을 때만 (못 풀면 1분 자고 깨기를 반복하게 됨)
      for (const [i, v] of comp.wakeIf) if (p.needs[i] < v && this.solvable(p, i)) done = true;
    } else if (a.item.autonomous) {
      // 급한 욕구로 중단 (13-4): 이 행동이 그 욕구를 채우는 길이면 끊지 않고, 풀 방법이 없어도 끊지 않음
      const c = comp.byId.get(a.item.interactionId)!;
      // 가장 급한 욕구 하나만 봄 (자율 선택과 같은 기준: 급한 욕구 둘이 번갈아 서로를 끊는 헛돎 방지)
      let ui = -1;
      let worst = Infinity;
      for (const [i, v] of comp.interrupt) {
        if (p.needs[i] < v && this.solvable(p, i) && p.needs[i] / v < worst) {
          worst = p.needs[i] / v;
          ui = i;
        }
      }
      if (ui >= 0) {
        // 그 욕구를 채우는 길(직접 또는 장보기처럼 채울 거리를 마련하는 보조 광고)이면 끊지 않음
        if (!c.serves[ui] && !(c.supportAds[ui] > 0)) {
          this.abortAction(p, 'urgent');
          return;
        }
      }
    }
    if (!done) return;
    const obj = this.world.byUid.get(a.stepObj);
    if (obj) {
      applyStepEffects(step, obj);
      // 청소: 그 물건이 있는 방의 더러움을 줄임
      if (step.effects?.roomClean) {
        const s0 = this.world.slots(obj)[0];
        const room = this.world.grid.roomOf(obj.x + (s0?.dx ?? 0), obj.y + (s0?.dy ?? 0));
        if (room >= 0) this.world.roomDirt[room] = Math.max(0, this.world.roomDirt[room] - step.effects.roomClean);
      }
    }
    if (a.stepIndex + 1 < ia.steps.length) {
      a.stepIndex++;
      p.sleeping = false;
      p.underBlanket = false;
      p.hidden = false;
      this.beginStep(p);
      return;
    }
    const target = this.world.byUid.get(a.item.targetUid);
    const before = this.inner ? { ...this.world.stock } : null;
    if (target) applyInteractionEffects(this.world, ia, target);
    if (ia.effects?.buy || ia.effects?.sell) this.trade(p, ia.effects.buy, ia.effects.sell);
    const iaId = a.item.interactionId;
    if (iaId.startsWith('work.')) this.workDone(p, a.elapsed, true);
    if (iaId.startsWith('recipe.')) this.recipeDone(p, iaId.slice(7), target ?? null);
    if (iaId.startsWith('service.')) this.serviceDone(p, iaId);
    if (iaId.startsWith('farm.') && target) this.farmDone(p, iaId, target);
    if (iaId === 'altar.public_penance') this.publicPenance(p);
    const wasSleep = !!step.sleep;
    const bed = this.world.byUid.get(a.stepObj)?.defId;
    this.finishAction(p, true, 'done');
    this.inner?.onActionDone(p, iaId, ia.tags ?? [], ia.moodlets);
    if (!this.inner) return;
    if (wasSleep) {
      if (p.needs[NEED_INDEX.energy] < this.relData.engine.sleptBadlyBelow) this.addEngineMoodlet(p, 'slept_badly');
      if (bed && this.relData.engine.floorBeds.includes(bed)) this.addEngineMoodlet(p, 'slept_on_floor');
    }
    if (ia.tags?.some((tg) => tg === 'eat_good' || tg === 'eat_plain') && !p.moodlets.some((m) => m.id === this.relData.familyMeal.moodlet)) {
      const family = this.persons.some((q) => q !== p && q.household === p.household && !q.hidden);
      if (family && this.rng.next() < this.relData.engine.ateAloneChance) this.addEngineMoodlet(p, 'ate_alone');
    }
    if (before) this.checkStockLow(p, before);
  }

  /** 엔진이 붙이는 무드렛 (데이터에 있을 때만) */
  // ------------------------------------------------------------------ 건축 (M5)

  /** 물건을 쓰거나 향해 가는 사람의 행동을 끊고 대기열에서도 뺌 (팔기/옮기기/불탐) */
  private abortUsing(uid: number): void {
    for (const q of this.persons) {
      const a = q.action;
      if (a && !this.data.social[a.item.interactionId] && (a.item.targetUid === uid || a.stepObj === uid)) this.abortAction(q, 'object_gone');
      q.queue = q.queue.filter((it) => this.data.social[it.interactionId] || it.targetUid !== uid);
    }
  }

  /** 건축 뒤 설 수 없게 된 칸(벽, 가구, 허공)에 선 사람을 가장 가까운 빈 칸으로 */
  private unstickAll(): void {
    const g = this.world.grid;
    for (const p of this.persons) {
      if (p.hidden) continue;
      const c = g.idx(p.cellX(), p.cellY());
      const own = !!p.action && p.pose !== 'stand' && p.action.stepObj >= 0 && g.objAt[c] === p.action.stepObj + 1;
      if (!g.walkable(c) && !own) {
        if (p.action) this.abortAction(p, 'build');
        this.moveToNearestWalkable(p, false);
      }
    }
  }

  // ------------------------------------------------------------------ 마을 (M6)

  /** people.json 한 사람 → 인물 (생애 7단계는 네 묶음으로도, 아기/유아는 M7 전까지 엄마 곁) */
  private addTownPerson(m: PeopleMember, household: number, estate: string, x: number, y: number): Person {
    const coarse = (s: LifeStage): Person['stage'] => (s === 'baby' || s === 'toddler' || s === 'child' ? 'child' : s === 'teen' ? 'teen' : s === 'elder' ? 'elder' : 'adult');
    const p = this.addPerson(m.name, x, y, { estate, sex: m.sex, stage: coarse(m.stage), household, traits: m.traits, virtue: m.virtue ?? null, sin: m.sin ?? null });
    p.lifeStage = m.stage;
    p.ageDays = m.ageDays;
    p.infant = m.stage === 'baby' || m.stage === 'toddler';
    let h = 2166136261;
    for (const ch of m.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    p.appearance = { town: m.id, seed: h, sex: m.sex, stage: coarse(m.stage), estate };
    // 조작 가문이 아니면 처음엔 요약 (첫 세밀도 판정에서 올라감)
    if (household !== 1) {
      p.lod = 'summary';
      p.lodSince = this.world.minute;
    }
    if (p.infant) p.hidden = true;
    return p;
  }

  // ------------------------------------------------------------------ 생애 판정기 창구 (18-3)

  private judgeHost(): import('./town/lifeJudge').JudgeHost {
    const sim = this;
    return {
      // 방문 중인 이웃(마을 밖 사람)은 판정기 대상이 아님
      get persons() {
        return sim.persons.filter((q) => !q.visitor);
      },
      rng: new Rng((this.seed * 131 + 71) >>> 0),
      rel: this.rel,
      town: this.town,
      day: () => this.world.day(),
      news: (kind, args, subjects) => this.townNews(kind, args, subjects),
      moodlet: (p, id) => this.addEngineMoodlet(p, id),
      kill: (p, cause) => this.killPerson(p, cause),
      birth: (m, f) => this.bornTo(m, f),
      moveTo: (p, hh, lot) => this.moveHousehold(p, hh, lot),
      newHousehold: () => this.newHouseholdId(),
      emptyLot: (size) => this.freeLot(size),
      immigrate: (n) => this.immigrate(n),
      emigrate: (hh) => {
        for (const p of this.persons.filter((q) => q.household === hh)) this.killPerson(p, 'moved_away');
        for (const [lot, h] of this.town!.lotHousehold) if (h === hh) this.town!.lotHousehold.delete(lot);
      },
      coarse: (p) => this.coarseStage(p),
      onMarried: (stay, incoming) => this.house?.onMarried(stay, incoming),
      deathAllowed: (p, cause) => this.deathAllowed(cause === 'cold_hunger' ? 'cold' : cause, p),
      agingOff: (p) => p.agingOff || this.settings.agingOffHouseholds.has(p.household),
      ...(this.lifecycle ? { ageDaily: (p: Person) => this.lifecycle!.dailyAge(p) } : {}),
      lifespan: () => this.settings.lifespan,
      elderHazardMult: (p) => {
        let m = 1;
        for (const t of p.traits) m *= (this.data.inner?.traits.traits[t]?.effects as { elderHazard?: number } | undefined)?.elderHazard ?? 1;
        return m;
      },
    };
  }

  private nextHousehold = 0;
  /** 새 가구 번호: 계속 늘기만 함 (끊긴 가구 번호를 다시 쓰지 않음 → 부지/가문 이름이 섞이지 않게) */
  private newHouseholdId(): number {
    if (!this.nextHousehold) this.nextHousehold = Math.max(100, ...this.persons.filter((q) => !q.visitor).map((q) => q.household)) + 1;
    return this.nextHousehold++;
  }

  /** 가구의 마지막 사람이 떠나면 부지/가문 이름/사는 장소를 비움 (빈 집이 됨) */
  private releaseHousehold(hh: number): void {
    const t = this.town;
    if (!t || hh === 1 || this.persons.some((q) => q.household === hh)) return;
    for (const [lot, h] of [...t.lotHousehold]) if (h === hh) t.lotHousehold.delete(lot);
    t.householdName.delete(hh);
    t.householdResidence.delete(hh);
  }

  /** 마을 소식 + 눈에 띄는 일은 소문으로 (당사자와 식구가 먼저 앎) */
  private townNews(kind: string, rawArgs: Record<string, string | number>, subjects: Person[]): void {
    const day = this.world.day();
    // 포고문 인자 (news.json): {house} 가문 이름 키, {place} 집에서 가까운 장소 이름 키
    const s0 = subjects[0];
    const args: Record<string, string | number> = { ...rawArgs };
    if (s0 && this.town) {
      args.house ??= this.town.householdName.get(s0.household) ?? 'house.newcomers';
      const lot = s0.homeLot ? this.town.lot(s0.homeLot) : null;
      const pl = lot ? this.town.nearestPlace((lot.rect[0] + lot.rect[2]) / 2, (lot.rect[1] + lot.rect[3]) / 2) : this.town.placeOf(s0.x, s0.y);
      args.place ??= pl?.nameKey ?? 'place.well_square';
    }
    this.news.push({ day, kind, args });
    const keep = this.data.story?.news.keep ?? 40;
    if (this.news.length > keep) this.news.splice(0, this.news.length - keep);
    const host = this.persons.find((q) => q.household === 1);
    if (host && subjects.some((s) => s.household !== 1)) this.notice(host, 'town_news', { kind: `news.${kind}`, ...args });
    if (this.rumors && ['engaged', 'married', 'birth', 'twins', 'death_old', 'death_ill', 'death_child', 'death_cold', 'death_accident', 'death_childbirth', 'stillbirth', 'miscarriage', 'moved_in', 'moved_out', 'new_house'].includes(kind)) {
      const knowers = this.persons.filter((q) => subjects.some((s) => s.household === q.household));
      this.rumors.add(kind, subjects, args, day, 1, knowers);
    }
  }

  /** 죽음/떠남: 행동을 끊고 목록에서 빼고, 식구에게 슬픔 (20장 장례는 M11) */
  private killPerson(p: Person, cause: string): void {
    // 임신 중 사망 (15-1 교차 표 1행): 기적의 출산 판정은 죽기 전에
    if (p.pregnancy && this.pregnancy && cause !== 'moved_away') this.pregnancy.onMotherDeath(p, cause);
    // 가족 사망 = 큰 충격 (임신 위험 판정)
    if (this.pregnancy && cause !== 'moved_away') for (const q of [...this.persons]) if (q !== p && q.pregnancy && q.household === p.household && this.persons.includes(q)) this.pregnancy.riskEvent(q, 'shock');
    if (p.action) this.abortAction(p, 'gone');
    this.world.release(p.id);
    for (const q of this.persons) {
      if (q.engagedWith === p.id) q.engagedWith = 0;
      if (q.chatWith === p.id) q.chatWith = 0;
      if (q.spouse === p.id) q.spouse = 0;
      if (q.betrothed === p.id) q.betrothed = 0;
      if (cause !== 'moved_away' && q !== p) {
        const r = this.rel.get(p.id, q.id);
        const kin = q.household === p.household || r?.flags.has('family') || r?.flags.has('spouse');
        if (kin) this.addEngineMoodlet(q, p.stage === 'child' ? 'child_death_grief' : 'funeral_grief');
      }
    }
    // 그 사람을 대상으로 한 남의 대기열/사회 행동도 정리
    for (const q of this.persons) {
      if (q === p) continue;
      q.queue = q.queue.filter((it) => !(this.data.social[it.interactionId] && it.targetUid === p.id));
      if (q.action && this.data.social[q.action.item.interactionId] && q.action.item.targetUid === p.id) this.abortAction(q, 'target_left');
    }
    // 안고 있던 아기는 내려놓고, 안겨 있던 아기면 안은 사람 손을 비움
    if (p.holding && this.childcare) {
      const b = this.persons.find((q) => q.id === p.holding);
      if (b) this.childcare.putDown(b);
    }
    if (p.babyPlace?.kind === 'held') {
      const holder = this.persons.find((q) => q.id === (p.babyPlace as { by: number }).by);
      if (holder && holder.holding === p.id) {
        holder.holding = 0;
        if (holder.carry === 'baby') holder.carry = null;
      }
    }
    // 가계도·상속·하인 (16장): 목록에서 빼기 전 (가장이면 장례·유언·새 가장·가보)
    this.house?.onDeath(p, cause);
    const i = this.persons.indexOf(p);
    if (i >= 0) this.persons.splice(i, 1);
    // 부모를 모두 잃은 아이는 대부모 → 친척 → 교회 (15-7)
    if (this.childcare && cause !== 'moved_away') this.childcare.onDeath(p, (id) => this.persons.find((q) => q.id === id), (q) => (this.lifecycle ? this.lifecycle.displayAge(q) : this.judge?.age(q) ?? 30) < 18);
    this.inner?.forget(p);
    this.rumors?.forget(p.id);
    this.releaseHousehold(p.household);
    if (p.townId) this.town?.personById.delete(p.townId);
    this.gone.push({ id: p.id, name: p.name, cause, day: this.world.day(), household: p.household });
    if (this.gone.length > 500) this.gone.shift();
    if (p.household === 1 && cause !== 'moved_away') this.notice(p, 'death', { name: p.name, cause: `death.cause.${cause}` });
  }

  /**
   * 출생 (15-2): 엄마 가구의 아기. 유전자(10-3: 부모에게서 물려받음) → 외형, 신분·성별 이름 풀(10-4),
   * 기질 1 (12-1), 조작 가문(또는 한 부지 모드)이면 실제로 요람/엄마 품에 (15-3), 마을 NPC 아기는 요약 세밀도로 엄마 곁
   */
  private bornTo(mother: Person, father: Person | null): Person | null {
    const sex: 'male' | 'female' = this.rng.next() < 0.5 ? 'male' : 'female';
    const brng = new Rng((this.seed * 2654435761 + this.world.minute * 97 + mother.id * 31 + ++this.birthSeq * 7919) >>> 0);
    const name = this.newName(sex, mother.estate, mother.household, brng);
    const baby = this.addPerson(name, mother.x, mother.y, { estate: mother.estate, sex, stage: 'child', household: mother.household });
    baby.lifeStage = 'baby';
    baby.ageDays = 0;
    baby.infant = true;
    baby.hidden = true;
    baby.mother = mother.id;
    baby.father = father?.id ?? 0;
    baby.homeLot = mother.homeLot;
    baby.lod = 'summary';
    baby.appearance = { town: `born_${baby.id}`, seed: (baby.id * 2654435761) >>> 0, sex, stage: 'child', estate: mother.estate };
    this.giveGenome(baby, mother, father, brng);
    // 걸음걸이 (10-1): 태어날 때 무작위 (유전하지 않음)
    if (this.genetics) {
      const gaits = Object.keys(this.genetics.gaits).filter((k) => !k.startsWith('$'));
      baby.gait = gaits[Math.floor(brng.next() * gaits.length)] ?? 'proud';
    }
    this.lifecycle?.newborn(baby);
    for (const q of this.persons) {
      if (q === baby || q.household !== baby.household) continue;
      const r = this.rel.ensure(baby.id, q.id);
      r.met = true;
      r.flags.add('family');
      r.friendship = this.data.story?.newborn?.familyFriendship ?? 30;
    }
    // 젖을 먹일 수 있는 기간 = 아기 단계 (15-3)
    if (this.lifecycle) mother.lactatingUntil = this.world.day() + Math.ceil(this.lifecycle.stageDays('baby')) + 1;
    if (this.childcare && (baby.household === 1 || !this.town)) this.showInfant(baby);
    this.childcare?.afterBirth(baby.household);
    this.house?.onBirth(baby, mother, father);
    return baby;
  }

  private birthSeq = 0;
  /** 신분·성별 이름 (10-4): 같은 가구에서 겹치지 않게. 이름 풀이 없으면 마을 이름 풀 */
  private newName(sex: 'male' | 'female', estate: string, household: number, rng: Rng): string {
    const taken = this.persons.filter((q) => q.household === household).map((q) => q.name);
    if (this.names) return pickName(this.names, rng, estate, sex, taken);
    const pool = this.namePool[sex];
    return pool.length ? pool[Math.floor(rng.next() * pool.length)] : `#${household}`;
  }

  /**
   * 유전자 (10-3): 부모가 있으면 물려받고, 없으면 무작위. 유전자가 없던 부모(마을 시작 인물)는 이때 무작위로 붙음.
   * 외형은 유전자에서 (렌더러가 그대로 합성). 선천 특성은 유전 결과를 특성에 반영
   */
  private giveGenome(p: Person, mother: Person | null, father: Person | null, rng: Rng): void {
    const g = this.genetics;
    if (!g) return;
    const own = (q: Person) => (q.genome ??= randomGenome(g, new Rng((this.seed * 7919 + q.id * 104729) >>> 0), { sex: q.sex } as never));
    p.genome = mother && father ? inherit(g, own(mother), own(father), rng) : mother ? inherit(g, own(mother), randomGenome(g, rng), rng) : randomGenome(g, rng);
    const congenital = new Set(Object.entries(this.data.inner?.traits.traits ?? {}).filter(([, t]) => t.category === 'congenital').map(([id]) => id));
    p.traits = [...p.traits.filter((t) => !congenital.has(t)), ...((p.genome as { congenital?: string[] }).congenital ?? []).filter((t) => congenital.has(t))];
    try {
      p.appearance = { ...express(g, p.genome, p.sex, p.lifeStage, undefined, { estate: p.estate }), genome: true };
    } catch {
      // 외형 표현 실패는 렌더러 기본값 (씨앗)으로
    }
  }

  /** 가구 옮기기 (혼인, 분가) */
  private moveHousehold(p: Person, household: number, lot: string | null): void {
    // 분가한 새 가구는 옮겨 가는 사람(남편 쪽)의 가문 이름을 이어받음
    if (this.town && !this.town.householdName.has(household)) {
      const old = this.town.householdName.get(p.household);
      if (old) this.town.householdName.set(household, old);
    }
    p.household = household;
    p.homeLot = lot;
    if (lot && this.town) this.town.lotHousehold.set(lot, household);
    for (const q of this.persons) if (q !== p && q.household === household) this.rel.ensure(p.id, q.id).met = true;
    // 아기/유아는 엄마를 따라감
    for (const c of this.persons) if (c.infant && c.mother === p.id) {
      c.household = household;
      c.homeLot = lot;
    }
  }

  /** 빈 부지 (집이 있고 아무도 안 사는 곳 먼저, 없으면 빈 땅) */
  private freeLot(size: string): string | null {
    const t = this.town;
    if (!t) return null;
    const used = new Set(t.lotHousehold.keys());
    const cand = t.lots.filter((l) => !used.has(l.id) && !t.sealed.has(l.id));
    return (cand.find((l) => l.house && l.size === size) ?? cand.find((l) => l.house) ?? cand[0])?.id ?? null;
  }

  /** 외지인 가족 이주 (18-3 안전판): 마을 끝 길에서 들어와 빈 집에 삶 */
  private immigrate(n: number): Person[] {
    const t = this.town;
    if (!t) return [];
    const lot = this.freeLot('small');
    const hh = this.newHouseholdId();
    const ex = this.world.exits[0];
    const out: Person[] = [];
    const estate = this.rng.next() < (this.data.story?.population.immigrantFreemanChance ?? 0.5) ? 'freeman' : 'serf';
    for (let k = 0; k < n; k++) {
      const sex: 'male' | 'female' = k === 0 ? 'male' : k === 1 ? 'female' : this.rng.next() < 0.5 ? 'male' : 'female';
      const pool = this.namePool[sex];
      const name = pool.length ? pool[Math.floor(this.rng.next() * pool.length)] : `#${hh}`;
      const stage: import('./people/person').LifeStage = k < 2 ? 'young' : 'child';
      const p = this.addTownPerson({ id: `im_${this.world.day()}_${k}_${hh}`, name, sex, stage, ageDays: Math.floor(this.rng.next() * 10) }, hh, estate, (ex?.x ?? 1) + 0.5, (ex?.y ?? 1) + 0.5);
      p.homeLot = lot;
      out.push(p);
    }
    if (lot) t.lotHousehold.set(lot, hh);
    if (out.length >= 2) {
      this.relateTown(out[0], out[1], 'spouse', 50, 50);
      for (let k = 2; k < out.length; k++) {
        this.relateTown(out[0], out[k], 'parent', 50, 0);
        this.relateTown(out[1], out[k], 'parent', 50, 0);
      }
    }
    return out;
  }

  /** 가족/인연 관계 (people.json relations/ties) */
  private relateTown(a: Person, b: Person, kind: string, friendship: number, romance: number): void {
    const r = this.rel.ensure(a.id, b.id);
    r.met = true;
    r.friendship = friendship;
    r.romance = romance;
    if (kind === 'spouse') {
      r.flags.add('spouse');
      a.spouse = b.id;
      b.spouse = a.id;
    } else if (kind === 'betrothed' || kind === 'engaged') {
      r.flags.add('engaged');
      a.betrothed = b.id;
      b.betrothed = a.id;
    } else if (kind === 'parent') {
      r.flags.add('family');
      if (a.sex === 'female') b.mother = a.id;
      else b.father = a.id;
    } else if (kind === 'sibling') r.flags.add('family');
    else if (kind !== 'tie') r.flags.add(kind);
  }

  /** 마을: 자기 집 부지 물건, 공공/바깥 물건, 손님이면 초대한 집 물건만 */
  private canUse(p: Person, o: ObjectInstance): boolean {
    const t = this.town!;
    // 마을에서는 지도 가장자리 출구로 장보러 나가지 않음 (장터 노점이 지도 안에 있음)
    if (o.defId === 'lot_exit') return false;
    const owner = t.ownerOf(o.x, o.y);
    if (owner < 0) return false;
    if (owner === p.household) return true;
    if (owner === 0) {
      // 장소 안의 침대/부엌/궤짝은 그곳에 사는 가문과 그곳 일꾼만 (성, 교회, 여관 부엌, 공방 거리 빵집 …)
      const pl = t.placeOf(o.x, o.y);
      if (pl) {
        const ro = this.data.story?.town?.residentOnly ?? [];
        const match = (k: string) => (k.endsWith('*') ? o.defId.startsWith(k.slice(0, -1)) : o.defId === k);
        // 공공 장소(여관·교회·길드 회관·목욕탕 …)의 요강 같은 물건은 누구나 (story.json town.publicPlaces)
        const pub = this.data.story?.town?.publicPlaces;
        const open = !!pub && Object.entries(pub).some(([k, kinds]) => match(k) && kinds.includes(pl.kind));
        const restricted = !open && ro.some(match);
        if (restricted && !t.residentsOf(pl.id).includes(p.household) && t.resolveAt(p, { from: 0, to: 24, at: 'work' }) !== pl.id) return false;
      }
      // 조작 가문 (자율): 밤에는 집 안만, 낮에는 집에서 가까운 공공장소 + 볼일(장보기)
      if (p.household === 1 && !p.visitor) {
        const T = this.data.story?.town;
        const h = this.world.hour();
        const errand = this.data.compiled.byDef.get(o.defId)?.some((c) => (c.def.tags ?? []).includes('duty') && c.supportWhen.length > 0);
        const [d0, d1] = T?.playerRoamHours ?? [7, 20];
        if (h < d0 || h >= d1) return false;
        if (errand) return true;
        const home = t.playerLot();
        if (home) {
          const cx = (home.rect[0] + home.rect[2]) / 2;
          const cy = (home.rect[1] + home.rect[3]) / 2;
          if (Math.hypot(o.x - cx, (o.y % (t.lots.length ? this.world.lot.h + 1 : 1)) - cy) > (T?.playerRoamTiles ?? 40)) return false;
        }
      }
      return true;
    }
    if (p.visitor && owner === 1) return true;
    return false;
  }

  /** 일과 목적지에서 멀면 그쪽으로 (한 번 넣으면 도착할 때까지). 넣었으면 true */
  private schedulePull(p: Person): boolean {
    const t = this.town!;
    const b = t.blockAt(p, this.world.minute);
    const at = t.resolveAt(p, b);
    const goal = t.targetCell(p, at);
    const g = this.world.grid;
    const gx = goal % g.w;
    const gy = Math.floor(goal / g.w);
    const cur = g.idx(p.cellX(), p.cellY());
    // 집 없는 사람(부지 배정 전)은 제자리가 집: 도착한 것으로
    const here = goal === cur || (at === 'home' ? !p.homeLot || t.lotOf(p.x, p.y)?.id === p.homeLot : t.placeOf(p.x, p.y)?.id === at || Math.abs(gx - p.x) + Math.abs(gy - p.y) < 6);
    if (here) return false;
    if ((p.excludedUntil.get(-1) ?? -1) > this.world.minute) return false;
    this.queueInteraction(p.id, GOTO_ID, goal, true);
    this.startAction(p, p.queue[0]);
    if ((p.action as { phase: string } | null)?.phase === 'walk') this.progressAction(p);
    return true;
  }

  /**
   * 말 타기 (18-5): 말이 있는 어른이 집 밖(방이 아닌 칸)에서 먼 길을 가면 말을 탐 → 걷기의 horseSpeedMult 배.
   * 방 안에 들어서거나 거의 다 오면 내림
   */
  private rideMult(p: Person, remaining: number, next: number): number {
    const tr = this.data.story?.travel;
    const order = ['baby', 'toddler', 'child', 'teen', 'young', 'adult', 'elder'];
    const can = !!tr && p.horse >= 0 && order.indexOf(p.lifeStage) >= order.indexOf(tr.horseMinStage) && !p.carry;
    const g = this.world.grid;
    const here = g.idx(p.cellX(), p.cellY());
    const outdoors = here >= 0 && g.room[here] < 0 && (next < 0 || g.room[next] < 0);
    if (can && outdoors && remaining >= (p.riding ? 3 : tr!.rideMinTiles)) p.riding = true;
    else p.riding = false;
    return p.riding ? tr!.horseSpeedMult : 1;
  }

  /**
   * 이사 (18-5, 23-1): 빈 집 부지를 사고 살던 집을 판 값으로 보탬. 식구는 새 집을 집으로 삼고 걸어서 감 (집으로 돌아가기),
   * 건축 범위가 새 부지로 바뀜. 결과 {ok, reason?, price, refund}
   */
  private moveHouse(lotId: string): { ok: boolean; reason?: string; price: number; refund: number } {
    const t = this.town;
    const lot = t?.lot(lotId);
    if (!t || !lot || t.lotHousehold.has(lotId)) return { ok: false, reason: 'taken', price: 0, refund: 0 };
    if (t.sealed.has(lotId)) return { ok: false, reason: 'no_road', price: 0, refund: 0 };
    const old = t.playerLot();
    const rate = this.data.story?.town?.sellBackRate ?? 0.8;
    const refund = old ? Math.round(old.price * rate) : 0;
    const a = this.econ?.account(1);
    if (a && this.econ) {
      if (a.money + refund < lot.price) return { ok: false, reason: 'no_money', price: lot.price, refund };
      if (refund) this.econ.earn(a, refund, 'house_sale', false);
      this.econ.spend(a, lot.price, 'house');
    }
    if (old) t.lotHousehold.delete(old.id);
    t.lotHousehold.set(lot.id, 1);
    for (const p of this.persons) if (p.household === 1) p.homeLot = lot.id;
    if (this.builder) this.builder.area = [...lot.rect];
    const host = this.persons.find((p) => p.household === 1);
    if (host) this.notice(host, 'moved_house', { price: lot.price, refund });
    return { ok: true, price: lot.price, refund };
  }

  /** 조작 가문과 어울리는 중 (세밀도 승급 조건) */
  private engagedWithControlled(p: Person): boolean {
    const partner = p.engagedWith || p.chatWith || (p.action && this.data.social[p.action.item.interactionId] ? p.action.item.targetUid : 0);
    if (partner && this.persons.find((q) => q.id === partner)?.household === 1) return true;
    for (const q of this.persons) {
      if (q.household !== 1) continue;
      if (q.engagedWith === p.id || q.chatWith === p.id) return true;
      if (q.action && this.data.social[q.action.item.interactionId] && q.action.item.targetUid === p.id) return true;
    }
    return false;
  }

  /** 불을 끄러 달려감: 하던 일을 끊고 끄기를 맨 앞에 (자는 사람도 깸) */
  private rushToFire(p: Person, uid: number): void {
    // 길이 없어 한동안 제외된 불이면 다시 달려가지 않음
    if ((p.excludedUntil.get(uid) ?? -1) > this.world.minute) return;
    if (p.action) this.abortAction(p, 'fire');
    p.sleeping = false;
    p.queue = p.queue.filter((q) => !q.autonomous);
    p.queue.unshift({ id: this.nextQueueId++, interactionId: 'fire.extinguish', targetUid: uid, autonomous: false });
  }

  /** 이웃이 연기를 보고 도우러 옴 (23-5): 부지에 없는 이웃 하나가 곧 도착 */
  private callNeighborForFire(): boolean {
    const host = this.persons.find((q) => q.household === 1);
    if (!host || !this.world.exits.length) return false;
    const free = this.data.neighbors.filter((n) => !this.persons.some((q) => q.visitor?.neighborId === n.id) && !this.pendingVisits.some((v) => v.neighborId === n.id));
    if (!free.length) return false;
    const nb = free[Math.floor(this.rng.next() * free.length)];
    this.pendingVisits.push({ neighborId: nb.id, at: this.world.minute + 5, host: host.id });
    this.notice(host, 'fire_neighbor', { name: nb.name });
    return true;
  }

  /** 일터/장터에 나간 가족에게 집에 불이 났다는 소식 → 일찍 돌아옴 (13-9 조기 귀가) */
  private callHomeForFire(p: Person): void {
    if (!p.hidden || !p.action) return;
    this.notice(p, 'fire_home');
    this.abortAction(p, 'fire_home');
    // 길 끝에서 다시 나타남 (래빗홀에서 돌아옴)
    p.hidden = false;
  }

  /** 방 목록 (점수, 이름). 부지가 바뀌거나 한 시간이 지나면 다시 계산 */
  rooms(): RoomInfo[] {
    const w = this.world;
    if (this.roomsVersion !== w.lotVersion || w.minute - this.roomsAt >= 60) {
      this.roomsCache = evaluateRooms(w, this.data);
      this.roomsVersion = w.lotVersion;
      this.roomsAt = w.minute;
    }
    return this.roomsCache;
  }

  /** 방 점수 무드렛 (11-2): 한 시간마다 집 안 사람에게 */
  private roomMoodlets(): void {
    if (!this.inner || !this.data.build) return;
    const rooms = this.rooms();
    for (const p of this.persons) {
      if (p.hidden || p.visitor) continue;
      const r = this.world.grid.roomOf(p.cellX(), p.cellY());
      if (r < 0 || !rooms[r]) continue;
      const m = roomMoodlet(this.data, rooms[r].score, p.estate);
      if (m) this.addEngineMoodlet(p, m);
    }
  }

  /** 내구도 (23-4): 쓸 때마다 닳고 100 이면 고장 */
  private wearObject(p: Person, uid: number, interactionId: string): void {
    const b = this.data.build;
    if (!b || this.data.social[interactionId] || interactionId === 'obj.repair') return;
    const o = this.world.byUid.get(uid);
    if (!o) return;
    const d = this.data.objects[o.defId];
    if (!d?.durable) return;
    const kind = this.world.kindOf(o.defId);
    // 고장 났지만 쓰는 물건: 삐걱거리는 침대 무드렛 (화로는 연기로)
    const mood = o.state.broken ? b.wear.brokenUsable[kind] : undefined;
    if (mood && mood !== 'smoky_room') this.addEngineMoodlet(p, mood);
    const q = d.quality ?? 1;
    // 좋은 물건일수록 덜 닳음
    const per = (b.wear.perUseByKind[kind] ?? b.wear.perUse) * (1.3 - q * 0.15);
    const after = Math.min(100, Number(o.state.wear ?? 0) + per);
    o.state.wear = Math.round(after * 10) / 10;
    if (after >= 100 && !o.state.broken) {
      o.state.broken = true;
      this.notice(p, 'object_broken', { object: d.nameKey });
    }
  }

  private addEngineMoodlet(p: Person, id: string): void {
    if (this.inner?.moodletExists(id)) this.inner.addMoodlet(p, id);
  }

  /** 재고가 기준 아래로 떨어지면 사건 (걱정 "빵이 떨어질까" 등) */
  private checkStockLow(_p: Person, before: Record<string, number>): void {
    const low = this.relData.engine.stockLow;
    for (const [k, v] of Object.entries(this.world.stock)) {
      const th = low[k] ?? low.default ?? 1;
      if ((before[k] ?? 0) > th && v <= th) {
        for (const q of this.persons) if (q.household === 1) this.inner!.event(q, `stock_low:${k}`);
      }
    }
  }

  /** 연기 찬 방 (작은 방에서 불 켠 화로 곁에 오래): 중세 오두막은 굴뚝이 시원찮음 */
  private updateSmoke(p: Person): void {
    const e = this.relData.engine;
    const room = this.world.grid.roomOf(p.cellX(), p.cellY());
    // 굴뚝 (23-2): 벽에 붙은 화로는 굴뚝이 저절로 생김. 굴뚝 없는 화로(한가운데 화덕)나 막힌 굴뚝(고장)이면 방 크기와 상관없이 연기.
    // 건축 데이터가 없는 옛 부지(M1~M4 테스트)는 예전 규칙: 작은 방 화롯가
    const hearth = room >= 0 && !p.hidden ? this.world.litHearthNear(p.x, p.y, 6) : null;
    const smoky = !!hearth && (this.data.build ? !this.world.hasChimney(hearth) || !!hearth.state.broken : (this.world.grid.roomSizes[room] ?? 0) <= e.smokeRoomMaxCells);
    if (!smoky) {
      p.smokeMinutes = 0;
      return;
    }
    if (++p.smokeMinutes === e.smokeMinutes) this.addEngineMoodlet(p, 'smoky_room');
  }

  private finishAction(p: Person, success: boolean, why: string): void {
    const a = p.action;
    if (!a) return;
    const id = a.item.interactionId;
    if (a.phase === 'perform' && id !== GOTO_ID && a.elapsed <= 2 && why !== 'cancelled' && why !== 'player_override') {
      const st = this.data.interactions[id]?.steps[a.stepIndex];
      const minutes = this.data.social[id]?.minutes ?? st?.minutes ?? 0;
      // 헛돎 = 시작 직후 중단, 또는 잠을 1~2분 만에 깸 (욕구가 차서 끝난 until 종료는 정상)
      if (minutes > 3 && (why !== 'done' || st?.sleep)) {
        this.stats.shortEnds++;
        this.stats.shortEndsBy[id] = (this.stats.shortEndsBy[id] ?? 0) + 1;
      }
    }
    if (success) {
      this.stats.completed[id] = (this.stats.completed[id] ?? 0) + 1;
      if (this.pregnancy && !this.data.social[id]) this.pregnancy.onInteractionDone(p, id, null);
      this.wearObject(p, a.item.targetUid, id);
      // 사 먹기 (여관 끼니, 노점 먹거리): 값(파딩)을 가계에서 냄. NPC 는 추상 살림이라 계정이 없으면 셈하지 않음
      const pay = (this.data.interactions[id] as { pay?: number } | undefined)?.pay;
      if (pay && this.econ) {
        const acct = this.account(p);
        if (acct) this.econ.spend(acct, pay, 'food');
      }
      if (id === 'construction.work' && this.builder && this.data.build) this.builder.addWork(a.item.targetUid, this.data.build.construction.familyWorkPerHour, true);
      if (id === 'fire.extinguish' && !this.putOut.includes(a.item.targetUid)) {
        // 물이 있으면 물통 하나를 씀 (없으면 흙)
        if ((this.world.stock.water ?? 0) > 0) this.world.stock.water--;
        this.putOut.push(a.item.targetUid);
      }
      // 사회 상호작용은 performSocial 이 -사람id 로 따로 넣음 (targetUid 는 사람 id 라 물건 uid 와 겹침)
      if (a.item.autonomous && !this.data.social[id]) {
        p.recentObjects.push(a.item.targetUid);
        if (p.recentObjects.length > 6) p.recentObjects.shift();
      }
    } else {
      this.stats.aborted[id] = (this.stats.aborted[id] ?? 0) + 1;
      if (why === 'path') this.stats.pathFails++;
    }
    this.world.release(p.id);
    // 안아서 달래기가 끝나면 아기를 내려놓음 (요람 또는 발치)
    if (p.holding && this.childcare && this.data.social[id]?.category === 'care') {
      const b = this.persons.find((q) => q.id === p.holding);
      if (b) this.childcare.putDown(b);
    }
    if (!success && id.startsWith('work.') && a.phase === 'perform') this.workDone(p, a.elapsed, false);
    // 사회 상호작용이 끝나면 붙잡혀 있던 상대를 놓아 줌
    if (this.data.social[id]) {
      const t = this.persons.find((q) => q.id === a.item.targetUid);
      if (t && t.engagedWith === p.id) t.engagedWith = 0;
    }
    p.queue = p.queue.filter((q) => q.id !== a.item.id);
    p.action = null;
    p.carry = null;
    p.sleeping = false;
    p.underBlanket = false;
    p.hidden = false;
    if (!p.collapse) p.status = 'available';
    if (p.outfit === 'sleep' || p.outfit === 'bath') p.outfit = 'everyday';
    // 앉거나 누웠던 자리에서 일어나 옆 칸으로 (예약이 풀렸는데 앉아 있으면 둘이 한 의자에 앉게 됨)
    if (p.pose !== 'stand' && !p.collapse) this.standUpBeside(p, a.stepObj);
    p.anim = 'idle';
  }

  /** 앉거나 누운 자리에서 일어나면: 그 물건의 빈 서기 슬롯 → 없으면 벽을 넘지 않는 가장 가까운 빈 칸 */
  private standUpBeside(p: Person, uid: number): void {
    p.pose = 'stand';
    const g = this.world.grid;
    const obj = this.world.byUid.get(uid);
    if (obj) {
      // 출구에서 닿는 칸 먼저 (가구 사이 틈으로 일어나 갇히지 않게), 없으면 걸을 수 있는 아무 칸
      const reach = this.world.reachFromExits();
      const cand = this.world.slots(obj).filter((s) => s.pose === 'stand');
      cand.sort((a, b) => {
        const ia = g.inBounds(obj.x + a.dx, obj.y + a.dy) ? reach[g.idx(obj.x + a.dx, obj.y + a.dy)] : 0;
        const ib = g.inBounds(obj.x + b.dx, obj.y + b.dy) ? reach[g.idx(obj.x + b.dx, obj.y + b.dy)] : 0;
        return ib - ia;
      });
      for (const s of cand) {
        const x = obj.x + s.dx;
        const y = obj.y + s.dy;
        if (g.inBounds(x, y) && g.walkable(g.idx(x, y)) && reach[g.idx(x, y)]) {
          p.x = x + 0.5;
          p.y = y + 0.5;
          return;
        }
      }
      // 닿는 설 자리가 없으면 가구에서 가장 가까운 닿는 칸으로 (틈에 갇히지 않게)
      if (this.moveToNearestWalkable(p, false, true)) return;
      for (const s of cand) {
        const x = obj.x + s.dx;
        const y = obj.y + s.dy;
        if (g.inBounds(x, y) && g.walkable(g.idx(x, y))) {
          p.x = x + 0.5;
          p.y = y + 0.5;
          return;
        }
      }
    }
    if (!g.walkable(g.idx(p.cellX(), p.cellY()))) this.moveToNearestWalkable(p, false);
  }

  private abortAction(p: Person, why: string): void {
    if (!p.action) return;
    this.finishAction(p, false, why);
  }

  private trackStats(p: Person): void {
    const s = this.stats;
    const b = this.data.balance;
    for (let i = 0; i < 8; i++) {
      const id = NEED_IDS[i];
      if (p.needs[i] <= 0.0001 && this.solvable(p, i)) {
        s.neglectStreak[id]++;
        if (s.neglectStreak[id] > s.maxNeglect[id]) s.maxNeglect[id] = s.neglectStreak[id];
      } else s.neglectStreak[id] = 0;
    }
    const a = p.action;
    if (a && this.world.minute - a.lastProgress >= b.movement.stuckMinutes) {
      s.stuckEvents++;
      this.notice(p, 'stuck');
      this.abortAction(p, 'stuck');
    }
  }

  reachable(p: Person, cell: number, blockedGoal: boolean): boolean {
    const g = this.world.grid;
    const start = g.idx(p.cellX(), p.cellY());
    if (start === cell) return true;
    this.path.who = this.walker(p);
    const ok = this.path.find(start, cell, blockedGoal) !== null;
    this.path.who = null;
    return ok;
  }

  /** 잠긴 문 판정용: 조작 가정 식구인지, 가장보다 신분이 같거나 높은지 */
  private walker(p: Person): { family: boolean; rankOk: boolean } {
    const head = this.persons.find((q) => q.household === 1);
    return { family: p.household === 1, rankOk: !head || rank(p) >= rank(head) };
  }

  /** 안전장치: 서 있는 칸에서 나갈 길이 전혀 없으면 가장 가까운 빈 칸으로 옮김 (13-5 절대 안 되는 것) */
  private unstick(p: Person): boolean {
    return this.moveToNearestWalkable(p, true);
  }

  private bfsQueue = new Int32Array(0);
  private bfsSeen = new Uint8Array(0);

  /** 벽을 넘지 않는 너비 우선 탐색(가구 칸은 통과)으로 가장 가까운 걸을 수 있는 칸 */
  private moveToNearestWalkable(p: Person, count: boolean, needReach = false): boolean {
    const g = this.world.grid;
    const reach = needReach ? this.world.reachFromExits() : null;
    const n = g.w * g.h;
    if (this.bfsQueue.length !== n) {
      this.bfsQueue = new Int32Array(n);
      this.bfsSeen = new Uint8Array(n);
    }
    this.bfsSeen.fill(0);
    const start = g.idx(p.cellX(), p.cellY());
    let head = 0;
    let tail = 0;
    this.bfsQueue[tail++] = start;
    this.bfsSeen[start] = 1;
    while (head < tail) {
      const cur = this.bfsQueue[head++];
      if (cur !== start && g.walkable(cur) && (!reach || reach[cur])) {
        p.x = (cur % g.w) + 0.5;
        p.y = Math.floor(cur / g.w) + 0.5;
        p.pose = 'stand';
        if (count) {
          this.stats.unsticks++;
          this.notice(p, 'unstuck');
        }
        return true;
      }
      const cx = cur % g.w;
      const cy = (cur - cx) / g.w;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX4[d];
        const ny = cy + DY4[d];
        if (!g.inBounds(nx, ny)) continue;
        const ni = g.idx(nx, ny);
        if (this.bfsSeen[ni] || (g.wall[ni] && !g.door[ni])) continue;
        this.bfsSeen[ni] = 1;
        this.bfsQueue[tail++] = ni;
      }
    }
    return false;
  }

  /** 시계를 되돌리거나 건너뛸 때(디버그/캡처) 사람의 시각 기준값도 같이 옮김 */
  shiftTime(delta: number): void {
    for (const p of this.persons) {
      p.idleUntil += delta;
      for (const [k, v] of p.excludedUntil) p.excludedUntil.set(k, v + delta);
      if (p.action) p.action.lastProgress += delta;
      p.solvableAt.fill(-1e9);
      this.inner?.shiftTime(p, delta);
      if (p.visitor) {
        p.visitor.leaveAt += delta;
        if (p.visitor.greetUntil > 0) p.visitor.greetUntil += delta;
        if (p.visitor.leftAt > 0) p.visitor.leftAt += delta;
      }
    }
    for (const v of this.pendingVisits) v.at += delta;
  }


  // ------------------------------------------------------------------ 사회 상호작용 (사람 대상, GDD 14)

  friendship(a: number, b: number): number {
    return this.rel.friendship(a, b);
  }

  /** 상대에게 이 사회 상호작용을 지금 걸 수 있는가 */
  socialAvailability(p: Person, t: Person, def: SocialDef, autonomous = false): Availability {
    if (this.pregnancy && !this.pregnancy.interactionAllowed(p, this.socialIdOf(def), t)) return { ok: false, reasonKey: 'reason.stage' };
    if (t === p || t.hidden || t.sleeping || t.collapse) return { ok: false, reasonKey: 'reason.target_busy' };
    if (t.engagedWith && t.engagedWith !== p.id) return { ok: false, reasonKey: 'reason.target_busy' };
    if (t.action && (!t.action.item.autonomous || this.data.social[t.action.item.interactionId])) return { ok: false, reasonKey: 'reason.target_busy' };
    // 자율로 거는 말은 상대가 한가하거나 쉬는 중일 때만 (하던 일을 끊는 것은 플레이어 명령만)
    if (autonomous && t.action) {
      // 자율로 거는 말은 상대가 놀이 중일 때만 끼어듦 (요리·목욕·일 같은 할 일은 끊지 않음)
      const c = this.data.compiled.byId.get(t.action.item.interactionId);
      if (!c || !(c.ads[4] > 0) || c.def.tags?.some((tg) => tg === 'labor' || tg === 'cook' || tg === 'duty')) return { ok: false, reasonKey: 'reason.target_busy' };
      for (let i = 0; i < 8; i++) if (c.serves[i] && t.needs[i] < 30) return { ok: false, reasonKey: 'reason.target_busy' };
      if (t.pose === 'lie') return { ok: false, reasonKey: 'reason.target_busy' };
    }
    if (t.visitor?.leaving) return { ok: false, reasonKey: 'reason.target_busy' };
    if (p.visitor?.leaving && def !== this.data.social['social.farewell']) return { ok: false, reasonKey: 'reason.target_busy' };
    // 기본 요구조건(나이·가족·관계)이 먼저: 메뉴 숨김 규칙이 이것을 봄. 그다음 이름 붙은 조건
    const base = checkSocialRequires(this.rel, p, t, def, this.world.stock);
    if (!base.ok) return base;
    const gate = (def.requires as { gate?: string }).gate;
    if (gate && !this.gateOk(gate, p, t)) return { ok: false, reasonKey: `reason.${gate}` };
    return base;
  }

  /**
   * 이름 붙은 조건 (requires.gate): 사회·물건 상호작용이 sim 상태(소문, 혼인, 원한, 재판 …)를 볼 때.
   * M9 모듈이 gates 에 등록. t 는 사회 상호작용 상대 (물건이면 null)
   */
  readonly gates = new Map<string, (p: Person, t: Person | null) => boolean>();
  gateOk(gate: string, p: Person, t: Person | null): boolean {
    const f = this.gates.get(gate);
    return f ? f(p, t) : false;
  }

  /** 소문 호스트 (14-6): 들은 사람의 존중/우정, 퍼짐 문턱의 가문 명예, 자기 가문 소문을 전해 들음 */
  private rumorHost(): import('./town/rumors').RumorHost {
    const H = () => this.data.story?.rumor.hear ?? { respect: 6, friendship: 2, fameStep: 8, churchBad: 2 };
    const subjectsOf = (r: import('./town/rumors').Rumor): Person[] => r.subjects.map((id) => this.persons.find((q) => q.id === id)).filter((q): q is Person => !!q);
    return {
      onHear: (r, listener, sign) => {
        if (!r.rep) return;
        const h = H();
        const k = r.rep * Math.min(1, r.strength) * (r.good ? 1 : -1) * sign;
        for (const s of subjectsOf(r)) {
          if (s === listener) continue;
          this.rel.addRespect(listener.id, s.id, Math.round(h.respect * k));
          const f = Math.round(h.friendship * k);
          if (f && this.rel.get(listener.id, s.id)?.met) this.rel.change(listener.id, s.id, { friendship: f }, this.world.day());
        }
      },
      onReach: (r) => {
        const h = H();
        this.addFame(r.household, Math.round(h.fameStep * r.rep * (r.good ? 1 : -1)), `rumor_${r.good ? 'good' : 'bad'}`);
        if (!r.good) for (const s of subjectsOf(r)) s.churchRep = Math.max(-100, s.churchRep - h.churchBad * r.rep);
      },
      onAware: (r, p) => {
        if (!r.rep) return;
        if (p.household === 1) this.notice(p, 'rumor_heard', { kind: `rumor.kind.${r.kind}`, n: r.knownBy.size, ...r.args });
        this.inner?.event(p, 'rumor_heard');
        if (this.inner && !p.hidden && p.lifeStage !== 'baby' && p.lifeStage !== 'toddler') this.inner.addMoodlet(p, r.good ? 'fame_proud' : 'heard_rumor_about_me', {});
      },
    };
  }

  /** 소문 대응 조건 (14-6) */
  private registerRumorGates(): void {
    const R = () => this.rumors;
    // 해명하기: 우리 가문의 나쁜 소문을 식구가 전해 들었고, 상대가 그 소문을 앎
    this.gates.set('explain_rumor', (p, t) => !!t && t.household !== p.household && !!R()?.list.some((r) => r.household === p.household && r.aware.size > 0 && !r.good && r.rep > 0 && r.knownBy.has(t.id)));
    // 소문 낸 사람 따지기: 상대가 우리 가문 소문을 처음 낸 사람
    this.gates.set('confront_rumor', (p, t) => !!t && !!R()?.list.some((r) => r.household === p.household && r.aware.size > 0 && r.origin === t.id));
    // 교회에서 공개 참회: 우리 가문의 나쁜 소문이 아직 셈
    this.gates.set('public_penance', (p) => !!R()?.list.some((r) => r.household === p.household && r.aware.size > 0 && !r.good && r.rep > 0 && r.strength > 0.5));
    // 험담 퍼뜨리기(거짓 소문): 싫어하는 사람이 있을 때
    this.gates.set('has_grudge_target', (p, t) => !!t && this.persons.some((q) => q !== p && q !== t && q.household !== p.household && (this.rel.get(p.id, q.id)?.friendship ?? 0) <= -20));
  }

  /** 소문 대응과 거짓 소문 (14-6): 사회 상호작용이 끝났을 때 */
  private rumorSocial(p: Person, t: Person, id: string, ok: boolean, tags: readonly string[]): void {
    const R = this.rumors;
    if (!R) return;
    const day = this.world.day();
    if (ok && id === 'social.spread_rumor') {
      // 교활/심술: 싫어하는 사람에 대한 거짓 소문
      let worst: Person | null = null;
      let wf = -20;
      for (const q of this.persons) {
        if (q === p || q === t || q.household === p.household || q.infant) continue;
        const f = this.rel.get(p.id, q.id)?.friendship ?? 0;
        if (f <= wf) {
          wf = f;
          worst = q;
        }
      }
      if (worst) {
        R.add('slander', [worst], { a: worst.name }, day, 1, [p, t], { truth: false, origin: p.id });
        if (!p.traits.includes('mean') && this.rng.next() < 0.5) this.inner?.addMoodlet(p, 'spread_lie_guilt', {});
      }
    } else if (ok && id === 'social.explain_rumor') {
      const r = R.strongestAbout(p.household, t);
      if (r && R.explain(r, t, 0.9)) this.notice(p, 'rumor_explained', { target: t.name, kind: `rumor.kind.${r.kind}` });
        this.inner?.addMoodlet(p, 'cleared_name_relief', {});
    } else if (ok && id === 'social.confront_rumormonger') {
      for (const r of [...R.list]) {
        if (r.household !== p.household || r.origin !== t.id) continue;
        R.confront(r);
        // 거짓 소문을 낸 게 드러나면 소문 낸 사람이 망신 (주변에는 소문으로)
        if (!r.truth) R.add('disgrace', [t], { a: t.name }, day, 0.7, [p, t], { origin: p.id });
      }
    } else if (ok && tags.includes('charity')) {
      const wit = this.persons.filter((q) => q !== p && q !== t && q.lod === 'full' && !q.infant && Math.hypot(q.x - p.x, q.y - p.y) < 8).slice(0, 3);
      if (wit.length && this.rng.next() < 0.5) R.add('charity', [p], { a: p.name }, day, 1, [t, ...wit]);
    }
    if (ok && p.lod === 'full' && t.lod === 'full') R.talk(p, t, tags.includes('gossip'));
  }

  /** 교회 공개 참회 (14-6): 가문의 나쁜 소문이 크게 약해지고 교회 평판이 오름 */
  private publicPenance(p: Person): void {
    const hit = this.rumors?.penance(p.household) ?? [];
    p.churchRep = Math.min(100, p.churchRep + 5);
    if (hit.length) this.addFame(p.household, 3, 'penance');
    this.inner?.addMoodlet(p, 'public_penance_relief', {});
    const wit = this.persons.filter((q) => q !== p && !q.infant && q.lod === 'full' && Math.hypot(q.x - p.x, q.y - p.y) < 10);
    if (this.rumors && wit.length) this.rumors.add('piety', [p], { a: p.name }, this.world.day(), 0.6, wit);
  }

  /** 사람을 눌렀을 때 원형 메뉴 */
  menuForPerson(personId: number, targetPersonId: number): MenuEntry[] {
    const p = this.person(personId);
    const t = this.persons.find((q) => q.id === targetPersonId);
    if (!t || t === p) return [];
    const out: MenuEntry[] = [];
    for (const [id, def] of Object.entries(this.data.social)) {
      const av = this.socialAvailability(p, t, def);
      // 조건이 영영 안 맞는 것(로맨스 대상 아님, 신분 조건 등)은 메뉴에서 뺌. 지금만 안 되는 것은 회색으로
      if (!av.ok && HIDE_REASONS.has(av.reasonKey ?? '')) continue;
      const chance = av.ok ? Math.round(socialChance(this.relData, this.rel, p, t, def, null, (x) => this.interests(x), this.atmosphere(p)).chance) : undefined;
      out.push({ interactionId: id, nameKey: def.nameKey, icon: def.icon, available: av.ok, reasonKey: av.reasonKey, reasonArgs: av.reasonArgs, category: def.category, chance });
    }
    return out;
  }

  private socialCandidates(p: Person, buf: Candidate[], urg: Float64Array): void {
    const b = this.data.balance.autonomy;
    const inner = this.inner;
    const now = this.world.minute;
    const list = this.socialAds();
    const R = (b as { socialRadiusTiles?: number }).socialRadiusTiles ?? 24;
    for (const t of this.persons) {
      if (t === p) continue;
      // 마을(M6): 멀리 있는 사람, 전체 세밀도가 아닌 사람은 자율 교류 후보가 아님
      if (Math.abs(t.x - p.x) > R || Math.abs(t.y - p.y) > R || t.lod !== 'full' || t.infant) continue;
      // 닿을 수 없어 제외해 둔 상대 (길찾기/자리 실패)
      if ((p.excludedUntil.get(-1000 - t.id) ?? 0) > now) continue;
      const dist = Math.hypot(t.x - p.x, t.y - p.y);
      this.socialPick.length = 0;
      this.socialPickW.length = 0;
      let best = 0;
      for (let li = 0; li < list.length; li++) {
        const [id, def] = list[li];
        let s = 0;
        for (let i = 0; i < 8; i++) {
          const n = NEED_IDS[i];
          let a = def.ads?.[n] ?? 0;
          if (def.adsWhenActorEmotion && p.emotionStage >= 1) a += def.adsWhenActorEmotion[EMOTION_IDS[p.emotion]]?.[n] ?? 0;
          if (a) s += (urg[i] * a) / 100;
        }
        if (s <= 0) continue;
        if (!this.socialAvailability(p, t, def, true).ok) continue;
        if (inner) s *= inner.adMult(p, def.tags, id);
        if (isRomantic(def) && this.isPartner(p.id, t.id)) s *= (this.relData as { partnerRomanceAdMult?: number }).partnerRomanceAdMult ?? 1;
        s /= 1 + dist / b.distanceRefTiles;
        let repeats = 0;
        for (const u of p.recentObjects) if (u === -t.id) repeats++;
        if (repeats >= b.repeatWindow) s *= b.repeatPenalty;
        if (s < b.minScore) continue;
        this.socialPick.push(li);
        this.socialPickW.push(s);
        if (s > best) best = s;
      }
      // 심즈처럼: 상대를 후보 하나로 (점수는 가장 높은 것), 무엇을 할지는 그 상대에게 가능한 것 중 가중 무작위.
      // 80종이 넘어 상위 몇 개만 고르면 늘 수다/농담만 하게 됨 → 다양성
      if (this.socialPick.length) {
        const k = this.rng.weighted(this.socialPickW);
        buf.push({ interactionId: list[this.socialPick[k < 0 ? 0 : k]][0], target: null, targetUid: t.id, score: best });
      }
    }
  }
  private readonly socialPick: number[] = [];
  private readonly socialPickW: number[] = [];

  private socialIds = new Map<SocialDef, string>();
  private socialIdOf(def: SocialDef): string {
    if (!this.socialIds.size) for (const [id, d] of Object.entries(this.data.social)) this.socialIds.set(d, id);
    return this.socialIds.get(def) ?? '';
  }

  isPartner(a: number, b: number): boolean {
    const f = this.rel.get(a, b)?.flags;
    return !!f && (f.has('spouse') || f.has('lover') || f.has('engaged'));
  }

  private socialAdList: [string, SocialDef][] | null = null;
  /** 자율 광고가 있는 사회 상호작용만 (불러올 때 한 번) */
  private socialAds(): [string, SocialDef][] {
    if (!this.socialAdList) {
      this.socialAdList = Object.entries(this.data.social).filter(([, d]) => (d.ads && Object.values(d.ads).some((v) => (v ?? 0) > 0)) || d.adsWhenActorEmotion);
    }
    return this.socialAdList;
  }

  private startSocial(p: Person, item: QueueItem): void {
    const def = this.data.social[item.interactionId];
    const t = this.persons.find((q) => q.id === item.targetUid);
    const av = t ? this.socialAvailability(p, t, def, item.autonomous) : { ok: false, reasonKey: 'reason.target_busy' };
    if (!t || !av.ok) {
      if (!item.autonomous) this.notice(p, 'cannot', { reason: av.reasonKey ?? 'reason.unknown', ia: def.nameKey });
      this.dropFront(p, item, 'requires');
      return;
    }
    p.action = {
      item, stepIndex: 0, phase: 'route', stepObj: -1, slotId: 'social', goal: -1,
      path: [], pathPos: 0, remaining: 0, elapsed: 0, lastProgress: this.world.minute, repaths: 0,
    };
    if (!item.autonomous) {
      p.recentObjects.length = 0;
      // 플레이어가 건 말: 상대는 하던 자율 행동을 멈추고 그 자리에서 기다림 (심즈처럼, 돌아다녀서 놓치지 않게)
      if (t.action?.item.autonomous && !t.sleeping) this.abortAction(t, 'social_wait');
      t.queue = t.queue.filter((q) => !q.autonomous);
      if (!t.engagedWith) t.engagedWith = p.id;
    }
    this.inner?.onActionStart(p, item.interactionId);
    this.routeToPerson(p, t);
  }

  /** 상대 옆 걸을 수 있는 칸 중 나와 가장 가까운 곳으로 */
  private routeToPerson(p: Person, t: Person): void {
    const g = this.world.grid;
    const tx = t.cellX();
    const ty = t.cellY();
    const d0 = Math.hypot(t.x - p.x, t.y - p.y);
    // 이미 옆(좌우/대각) 칸이면 그 자리에서. 같은 칸이거나 바로 위아래면 옆 칸으로 옮겨 마주 봄
    const sideBy = Math.abs(t.cellX() - p.cellX()) >= 1;
    if (d0 <= 1.6 && d0 >= 0.9 && sideBy && g.walkable(g.idx(p.cellX(), p.cellY()))) {
      this.arriveSocial(p);
      return;
    }
    let best = -1;
    let bestD = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = tx + dx;
        const y = ty + dy;
        if (!g.inBounds(x, y)) continue;
        const i = g.idx(x, y);
        if (!g.walkable(i)) continue;
        // 대각선 칸은 벽 모서리를 끼지 않을 때만 (말 거는 자리)
        if (dx && dy && (!g.walkable(g.idx(tx + dx, ty)) || !g.walkable(g.idx(tx, ty + dy)))) continue;
        let taken = false;
        for (const q of this.persons) if (q !== p && q !== t && q.cellX() === x && q.cellY() === y) taken = true;
        if (taken) continue;
        // 옆으로 나란히 마주 보는 자리를 먼저 (위아래로 서면 뒷사람이 앞사람 그림에 가려짐)
        const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) + (dx && dy ? 0.3 : 0) + (!dx ? 2.5 : 0);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best < 0) {
      // 말 걸 자리가 없음: 이 상대를 잠시 제외 (자율이 같은 실패를 반복하지 않게)
      p.excludedUntil.set(-1000 - t.id, this.world.minute + this.data.balance.movement.pathFailExcludeMinutes);
      if (!p.action!.item.autonomous) this.notice(p, 'cannot', { reason: 'reason.no_slot', ia: this.data.social[p.action!.item.interactionId]?.nameKey ?? '' });
      this.finishAction(p, false, 'no_slot');
      return;
    }
    this.routeTo(p, best, false);
  }

  private arriveSocial(p: Person): void {
    const a = p.action!;
    const def = this.data.social[a.item.interactionId];
    const t = this.persons.find((q) => q.id === a.item.targetUid);
    const av = t ? this.socialAvailability(p, t, def, a.item.autonomous) : { ok: false, reasonKey: 'reason.target_busy' };
    if (!t || !av.ok) {
      if (!a.item.autonomous) this.notice(p, 'cannot', { reason: av.reasonKey ?? 'reason.unknown', ia: def.nameKey });
      this.finishAction(p, false, 'target_left');
      return;
    }
    if (Math.hypot(t.x - p.x, t.y - p.y) > 1.6) {
      // 상대가 움직임: 다시 따라감 (몇 번까지만)
      a.repaths++;
      if (a.repaths > 3) {
        if (!a.item.autonomous) this.notice(p, 'cannot', { reason: 'reason.target_moved', ia: def.nameKey });
        this.finishAction(p, false, 'target_moved');
      } else this.routeToPerson(p, t);
      return;
    }
    // 상대가 하던 자율 행동은 멈추고 마주 봄
    if (t.action) this.abortAction(t, 'social');
    t.queue = t.queue.filter((q) => !q.autonomous);
    t.engagedWith = p.id;
    // 상대가 앉았다/누웠다 일어나며 자리를 옮겼으면 다시 다가감 (붙잡아 둔 채)
    if (Math.hypot(t.x - p.x, t.y - p.y) > 1.6 && a.repaths < 3) {
      a.repaths++;
      this.routeToPerson(p, t);
      return;
    }
    // 상대가 걸어오다 멈춰 같은 칸에 겹치거나 바로 위아래면: 상대를 붙잡아 둔 채 옆 칸으로 옮김 (몇 번까지만)
    const overlap = Math.hypot(t.x - p.x, t.y - p.y) < 0.9 || (Math.abs(t.x - p.x) < 0.5 && a.repaths < 2);
    if (overlap && a.repaths < 3) {
      a.repaths++;
      this.routeToPerson(p, t);
      return;
    }
    // 처음 만남: 첫인상 (14-2)
    this.meet(p, t);
    // 대화 주제 (14-3): 둘 다 관심 있는 주제가 있으면 그것, 없으면 상호작용 주제 중 하나
    if (def.topics.length) {
      const shared = def.topics.filter((tp) => this.interests(p).includes(tp) && this.interests(t).includes(tp));
      const pool = shared.length ? shared : def.topics;
      a.topic = pool[Math.floor(this.rng.next() * pool.length)];
    }
    this.facePerson(p, t);
    this.facePerson(t, p);
    p.anim = 'idle';
    t.anim = 'idle';
    a.phase = 'perform';
    a.remaining = def.minutes;
    a.elapsed = 0;
    a.lastProgress = this.world.minute;
  }

  private facePerson(p: Person, t: Person): void {
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    p.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }

  private performSocial(p: Person): void {
    const a = p.action!;
    const def = this.data.social[a.item.interactionId];
    const t = this.persons.find((q) => q.id === a.item.targetUid);
    const careDef = def.category === 'care';
    const babyTarget = !!t && Childcare.isDependent(t);
    if (!t || t.engagedWith !== p.id || t.hidden || (t.sleeping && !(careDef && babyTarget)) || t.collapse) {
      this.finishAction(p, false, 'target_left');
      return;
    }
    // 안아서 달래기 (15-3): 첫 분에 아기를 품에 안음, 끝나면 내려놓음 (finishAction)
    if (careDef && this.childcare && t.lifeStage === 'baby' && (def as { holds?: boolean }).holds && a.elapsed === 0) this.childcare.hold(t, p);
    if (careDef && this.childcare) this.childMinute(t, def as unknown as { teach?: Record<string, number>; homework?: number; minutes?: number });
    a.remaining--;
    a.elapsed++;
    a.lastProgress = this.world.minute;
    for (let i = 0; i < 8; i++) {
      const n = NEED_IDS[i];
      const v = def.needs?.[n];
      if (v) p.needs[i] = Math.max(0, Math.min(100, p.needs[i] + v));
      const tv = def.targetNeeds?.[n];
      if (tv) t.needs[i] = Math.max(0, Math.min(100, t.needs[i] + tv));
    }
    this.stats.minutesByInteraction[a.item.interactionId] = (this.stats.minutesByInteraction[a.item.interactionId] ?? 0) + 1;
    if (this.inner) {
      this.inner.onPerformMinute(p, def.tags);
      // 상대는 '걸린 대화'로 따로 셈 (내성적인 사람이 말을 걸려도 교류 지표가 오르지 않게, 놀림당한 쪽이 심술 지표를 얻지 않게)
      t.tagMinutes.social_recv = (t.tagMinutes.social_recv ?? 0) + 1;
    }
    if (a.remaining > 0) return;
    // 성공 판정 (14-3)
    const cp = socialChance(this.relData, this.rel, p, t, def, a.topic ?? null, (x) => this.interests(x), this.atmosphere(p));
    const ok = this.rng.next() * 100 < cp.chance;
    const out = ok ? def.success : def.failure;
    // 살림 소모 (선물, 빵 나눠 주기 …): 성공/실패 무관 (contracts-m3 1절)
    if (def.requires.stock) {
      const before = { ...this.world.stock };
      for (const [k, n] of Object.entries(def.requires.stock)) this.world.stock[k] = Math.max(0, (this.world.stock[k] ?? 0) - n);
      if (this.inner) this.checkStockLow(p, before);
    }
    if (ok) this.stats.socialOk++;
    else this.stats.socialFail++;
    const rude = def.estateRule === 'rude' || def.category === 'mean';
    const up = rank(p) < rank(t);
    let respect = out.respect;
    // 신분 규칙: 낮은 신분이 높은 신분에게 무례하면 성공해도 존중 대신 처벌 위험 (처벌 자체는 M9 사건), 높은 쪽의 모욕은 "오만함" 소문
    if (rude && up && ok) {
      respect = Math.min(0, respect);
      if (this.rng.next() < this.relData.success.rudePunishChance) {
        this.notice(p, 'punish_risk', { target: t.name, ia: def.nameKey });
        this.inner?.event(p, 'rude_to_superior');
      }
    } else if (rude && rank(p) > rank(t)) this.inner?.event(p, 'arrogance');
    const r = this.rel.change(p.id, t.id, { friendship: out.friendship + (cp.sharedTopic && ok ? 1 : 0), romance: out.romance }, this.world.day());
    if (respect) this.rel.addRespect(t.id, p.id, respect);
    for (const f of out.flagsAdd) r.flags.add(f);
    for (const f of out.flagsRemove) r.flags.delete(f);
    if (ok && def.minutes >= 15 && this.rng.next() < 0.35) r.sharedMemories++;
    p.lastSocial = { minute: this.world.minute, ok, target: t.id, ia: a.item.interactionId };
    if (ok && a.item.interactionId === 'social.propose_bed') {
      const w = p.sex === 'female' ? p : t;
      const e = this.coitus.get(w.id);
      this.coitus.set(w.id, e && e.day === this.world.day() ? { day: e.day, n: e.n + 1 } : { day: this.world.day(), n: 1 });
    }
    if (ok && this.pregnancy) this.pregnancy.onInteractionDone(p, a.item.interactionId, t);
    if (careDef && (def.requires as { targetBirthday?: boolean }).targetBirthday) t.celebratedBy.push(p.id);
    if (p.visitor?.customer && a.item.interactionId === 'social.haggle' && t.household === 1) this.shopSale(p, t, ok);
    this.notice(p, 'social_result', { ia: def.nameKey, id: a.item.interactionId, target: t.id, ok: ok ? 1 : 0, chance: Math.round(cp.chance), df: out.friendship, dr: out.romance });
    if (a.item.autonomous) {
      p.recentObjects.push(-t.id);
      if (p.recentObjects.length > 6) p.recentObjects.shift();
    }
    const id = a.item.interactionId;
    this.finishAction(p, true, 'done');
    const inner = this.inner;
    if (inner) {
      inner.onActionDone(p, id, def.tags, out.moodlets, t.id);
      for (const m of out.targetMoodlets) if (m.chance === undefined || this.rng.next() < m.chance) inner.addMoodlet(t, m.id, { withPerson: p.id });
      if (ok) {
        for (const rm of def.removeMoodlets) inner.removeMoodlet(p, rm);
        for (const rm of def.targetRemoveMoodlets) inner.removeMoodlet(t, rm);
      }
      inner.count(t, `social_recv:${id}`);
      inner.count(p, `social:${id}`);
      inner.event(p, `social:${id}`);
      if (ok) inner.event(p, `social_ok:${id}`);
      for (const e of out.events) inner.event(p, e.replace(/^event:/, ''));
      inner.thought(t, `action_done:${id}`);
    }
    this.rumorSocial(p, t, id, ok, def.tags);
  }

  /** 처음 만남: 첫인상 (14-2). 이미 만났으면 아무 일 없음 */
  meet(p: Person, t: Person): void {
    const r = this.rel.ensure(p.id, t.id);
    if (r.met) return;
    r.met = true;
    // 같은 가구는 이미 아는 사이 (첫인상 없음)
    if (p.household === t.household) return;
    const [a, b] = r.a === p.id ? [p, t] : [t, p];
    const fi = firstImpression(this.rel['rules'], {
      estateA: a.estate, estateB: b.estate, hygieneA: a.needs[NEED_INDEX.hygiene], hygieneB: b.needs[NEED_INDEX.hygiene],
      traitsA: a.traits, traitsB: b.traits, dressOkA: true, dressOkB: true, looksA: 0, looksB: 0, reputationA: 0, reputationB: 0,
    }, this.rng.next(), this.rng.next());
    r.friendship = fi.friendship;
    r.respectAB = fi.respectAB;
    r.respectBA = fi.respectBA;
    this.notice(p, 'first_meet', { target: t.id, other: t.name, f: Math.round(fi.friendship) });
  }

  /** 분위기 보정 (14-3): 불 켠 난로 곁 +3, 더러운 방 −3 */
  private atmosphere(p: Person): number {
    let m = 0;
    if (this.world.nearLitHearth(p.x, p.y, 4)) m += 3;
    const room = this.world.grid.roomOf(p.cellX(), p.cellY());
    if (room >= 0 && (this.world.roomDirt[room] ?? 0) >= this.data.balance.roomDirt.dirtyAt) m -= 3;
    return m;
  }

  // ------------------------------------------------------------------ 멀티태스킹, 가족 식사 (M3)

  private multitaskTag(p: Person): string | null {
    const a = p.action;
    if (!a || a.phase !== 'perform' || p.sleeping || p.hidden) return null;
    const c = this.data.compiled.byId.get(a.item.interactionId);
    const tags = c?.def.tags;
    if (!tags) return null;
    for (const tg of this.relData.multitask.tags) if (tags.includes(tg)) return tg;
    return null;
  }

  /** 먹거나 쉬면서 옆 사람과 이야기 (심즈 멀티태스킹): 교류 욕구 조금, 우정 조금. 가족이 함께 먹으면 가족 식사 무드렛 */
  private updateMultitask(): void {
    const mt = this.relData.multitask;
    const fm = this.relData.familyMeal;
    const active: Person[] = [];
    for (const p of this.persons) {
      if (this.multitaskTag(p)) active.push(p);
      else p.chatWith = 0;
    }
    for (const p of active) {
      let best: Person | null = null;
      let bestD = mt.radius;
      let family = 0;
      const eating = this.multitaskTag(p)!.startsWith('eat');
      const room = this.world.grid.roomOf(p.cellX(), p.cellY());
      for (const q of active) {
        if (q === p) continue;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d > mt.radius || this.world.grid.roomOf(q.cellX(), q.cellY()) !== room) continue;
        if (d < bestD || (d === bestD && best && q.id < best.id)) {
          best = q;
          bestD = d;
        }
        if (eating && q.household === p.household && d <= fm.radius && this.multitaskTag(q)!.startsWith('eat')) family++;
      }
      p.chatWith = best ? best.id : 0;
      if (!best) continue;
      this.meet(p, best);
      p.needs[NEED_INDEX.social] = Math.min(100, p.needs[NEED_INDEX.social] + mt.socialPerMinute);
      // 우정은 쌍마다 한 번만 (작은 id 쪽이 올림)
      if (p.id < best.id || best.chatWith !== p.id) {
        const r = this.rel.ensure(p.id, best.id);
        r.friendship = Math.min(100, r.friendship + mt.friendshipPerHour / 60);
      }
      if (this.inner) {
        p.tagMinutes.social = (p.tagMinutes.social ?? 0) + 1;
        if (this.rng.next() < mt.chatMoodletChancePerHour / 60 && this.inner.moodletExists('table_talk')) this.inner.addMoodlet(p, 'table_talk', { withPerson: best.id });
        if (eating && family + 1 >= fm.minPeople && !p.moodlets.some((m) => m.id === fm.moodlet)) this.inner.addMoodlet(p, fm.moodlet);
      }
    }
  }

  // ------------------------------------------------------------------ 가게 (M4, 17-3)

  /** 팔 수 있는 물건 (제작품 분류) */
  private shopStock(): string[] {
    const cats = ['goods', 'tool', 'baked', 'cloth', 'drink', 'preserved', 'prepared', 'metal'];
    return Object.entries(this.world.stock).filter(([k, v]) => v > 0 && cats.includes(this.item(k)?.category ?? '') && k !== 'firewood').map(([k]) => k);
  }

  /** 가게를 연 동안(9~17시) 손님: 한 시간에 평판에 따라 한 명쯤. 이웃 중 부지에 없는 사람이 손님으로 걸어 들어옴 */
  private shopCustomers(): void {
    const sh = this.shop;
    if (!sh.open || !this.econ) return;
    const h = this.world.hour();
    if (h < 9 || h >= 17) return;
    if (!this.shopStock().length) return;
    const keeper = this.persons.find((q) => q.household === 1 && !q.hidden && (q.stage === 'adult' || q.stage === 'elder'));
    if (!keeper) return;
    if (this.persons.some((q) => q.visitor?.customer)) return;
    const perHour = 0.25 + sh.reputation / 250 - (sh.priceMult - 1) * 1.5;
    if (this.rng.next() >= perHour / 60) return;
    const free = this.data.neighbors.filter((n) => !this.persons.some((q) => q.visitor?.neighborId === n.id) && !this.pendingVisits.some((v) => v.neighborId === n.id));
    if (!free.length) return;
    const nb = free[Math.floor(this.rng.next() * free.length)];
    this.arriveVisitor(nb.id, keeper.id);
    const v = this.persons.find((q) => q.visitor?.neighborId === nb.id);
    if (!v?.visitor) return;
    v.visitor.customer = true;
    v.visitor.greetUntil = 0;
    v.visitor.leaveAt = this.world.minute + 45;
    // 손님은 가게 주인과 곧장 흥정 (처음이면 인사 삼아 아는 사이가 됨)
    const r = this.rel.ensure(v.id, keeper.id);
    if (!r.met) this.meet(v, keeper);
    if (this.data.social['social.haggle']) this.queueInteraction(v.id, 'social.haggle', keeper.id, false);
    this.notice(keeper, 'customer', { name: nb.name });
  }

  /** 손님 흥정 끝: 성공(손님이 깎음) 0.85배, 실패 제값. 물건 하나 팖, 평판 */
  private shopSale(customer: Person, keeper: Person, ok: boolean): void {
    const e = this.econ;
    const acct = e?.account(keeper.household);
    const list = this.shopStock();
    if (!e || !acct || !list.length) return;
    const item = list[Math.floor(this.rng.next() * list.length)];
    const def = this.item(item)!;
    const q = this.world.quality[item] ?? 1;
    const price = Math.round(e.itemPrice(def) * this.shop.priceMult * (1 + 0.1 * (q - 1)) * (ok ? 0.85 : 1));
    this.world.stock[item] -= 1;
    e.earn(acct, price, 'shop');
    this.shop.sales++;
    // 평판: 품질이 좋고 값이 싸면 오름 (17-3 "품질, 가격, 응대")
    this.shop.reputation = Math.max(0, Math.min(100, this.shop.reputation + (q - 1) * 1.5 + (1 - this.shop.priceMult) * 10 + (ok ? 0.5 : -0.5)));
    this.notice(keeper, 'shop_sale', { item: `item.${item}`, m: price });
    keeper.lastWork = { minute: this.world.minute, wage: price };
    if (customer.visitor) customer.visitor.leaveAt = this.world.minute + 5;
  }

  // ------------------------------------------------------------------ 이웃 방문 (M3)

  /** 이웃 초대: 잠시 뒤 길 끝(부지 출구)에서 걸어 들어옴 */
  invite(hostId: number, neighborId: string): { ok: boolean; reason?: string; at?: number } {
    const nb = this.data.neighbors.find((n) => n.id === neighborId);
    if (!nb) return { ok: false, reason: 'unknown' };
    if (this.persons.some((q) => q.visitor?.neighborId === neighborId) || this.pendingVisits.some((v) => v.neighborId === neighborId)) return { ok: false, reason: 'already' };
    if (!this.world.exits.length) return { ok: false, reason: 'no_exit' };
    const [lo, hi] = this.relData.visit.arriveAfterMinutes;
    const at = this.world.minute + Math.round(lo + this.rng.next() * (hi - lo));
    this.pendingVisits.push({ neighborId, at, host: hostId });
    const host = this.persons.find((q) => q.id === hostId);
    if (host) this.notice(host, 'invited', { name: nb.name });
    return { ok: true, at };
  }

  private updateVisits(): void {
    const m = this.world.minute;
    this.shopCustomers();
    for (let i = this.pendingVisits.length - 1; i >= 0; i--) {
      const v = this.pendingVisits[i];
      if (m < v.at) continue;
      this.pendingVisits.splice(i, 1);
      this.arriveVisitor(v.neighborId, v.host);
    }
    for (const p of [...this.persons]) {
      const vi = p.visitor;
      if (!vi) continue;
      if (vi.leaving) {
        // 먼저 작별 인사(할 수 있으면), 그다음 길 끝까지 걸어가 사라짐. 길이 막혀 90분이 지나면 그냥 사라짐
        const ex = this.world.exits[0];
        // 출구 칸 1칸 안이면 떠남 (goto 가 같은 틱에 끝나도 놓치지 않게 거리만 봄)
        const atExit = !!ex && Math.abs(p.cellX() - ex.x) + Math.abs(p.cellY() - ex.y) <= 1 && vi.saidBye;
        if (atExit || m - vi.leftAt > 90) {
          this.notice(p, 'visitor_left', { name: p.name });
          this.removePerson(p);
        } else if (!p.action && !p.queue.length) {
          if (!vi.saidBye) {
            vi.saidBye = true;
            if (this.tryFarewell(p)) continue;
          }
          this.walkToExit(p);
        }
        continue;
      }
      if (vi.greetUntil > 0 && !p.action && !p.queue.length) {
        if (this.tryGreet(p) || m >= vi.greetUntil) vi.greetUntil = 0;
      }
      let low = false;
      for (const n of ['energy', 'bladder', 'hunger'] as const) if (p.needs[NEED_INDEX[n]] < this.relData.visit.leaveIfNeedBelow) low = true;
      if (m >= vi.leaveAt || low) this.startLeaving(p);
    }
  }

  private arriveVisitor(neighborId: string, hostId: number): void {
    const idx = this.data.neighbors.findIndex((n) => n.id === neighborId);
    const nb = this.data.neighbors[idx];
    const ex = this.world.exits[0];
    if (!nb || !ex) return;
    let p = this.away.get(neighborId);
    if (p) {
      // 다시 찾아옴: 같은 사람 (관계, 성격, 기억 그대로). 부지 밖에서 지낸 동안 욕구는 적당히 채워진 것으로
      this.away.delete(neighborId);
      p.x = ex.x + 0.5;
      p.y = ex.y + 0.5;
      p.trail.length = 0;
      p.action = null;
      p.pose = 'stand';
      p.sleeping = false;
      p.hidden = false;
      for (let i = 0; i < 8; i++) p.needs[i] = Math.max(p.needs[i], 70);
      if ((p as { awayDay?: number }).awayDay !== this.world.day()) {
        p.todayCount.clear();
        p.lastDayTags.clear();
      }
      this.persons.push(p);
    } else {
      p = this.addPerson(nb.name, ex.x + 0.5, ex.y + 0.5, {
        traits: nb.traits, estate: nb.estate, sex: nb.sex, stage: nb.stage, household: (this.town ? 900 : 100) + idx,
        virtue: nb.virtue ?? null, sin: nb.sin ?? null, topics: nb.topics, innerSeed: nb.seed,
      });
      p.appearance = { neighbor: nb.id, seed: nb.seed, sex: nb.sex };
    }
    const [lo, hi] = this.relData.visit.stayMinutes;
    // 도착하면 먼저 초대한 사람(바쁘면 다른 식구)에게 인사하러 감. 모두 바쁘면 30분까지 기다림 (updateVisits)
    p.visitor = { neighborId, leaveAt: this.world.minute + Math.round(lo + this.rng.next() * (hi - lo)), leaving: false, greetUntil: this.world.minute + 30, host: hostId, leftAt: 0, saidBye: false };
    this.stats.visits++;
    this.notice(p, 'visitor_arrived', { name: nb.name, host: hostId });
  }

  /** 방문객 인사: 초대한 사람 → 다른 식구 순서로, 지금 말을 걸 수 있는 사람에게 */
  private tryGreet(p: Person): boolean {
    const vi = p.visitor!;
    const greetId = this.data.social['social.greet'] ? 'social.greet' : 'social.chat';
    const def = this.data.social[greetId];
    if (!def) return true;
    const hosts = this.persons.filter((q) => q.household !== p.household && !q.visitor).sort((a, b) => Number(b.id === vi.host) - Number(a.id === vi.host));
    for (const h of hosts) {
      // 이미 아는 사이면 인사 대신 안부 (첫인사 건네기는 처음 만난 사이 전용)
      const id = this.rel.get(p.id, h.id)?.met ? (this.data.social['social.ask_after'] ? 'social.ask_after' : 'social.chat') : greetId;
      const d = this.data.social[id];
      // 손님이 문간에 왔다는 사건: 식구가 하던 자율 행동(집안일 포함)을 멈추고 맞음 (플레이어 명령과 같은 우선)
      if (d && this.socialAvailability(p, h, d, false).ok) {
        this.queueInteraction(p.id, id, h.id, false);
        return true;
      }
    }
    return false;
  }

  startLeaving(p: Person): void {
    if (!p.visitor || p.visitor.leaving) return;
    p.visitor.leaving = true;
    p.visitor.leftAt = this.world.minute;
    if (p.action) this.abortAction(p, 'leaving');
    p.queue = [];
    this.notice(p, 'visitor_leaving', { name: p.name });
  }

  /** 작별 인사: 가장 친한 식구 중 지금 말을 걸 수 있는 사람에게 */
  private tryFarewell(p: Person): boolean {
    const def = this.data.social['social.farewell'];
    if (!def) return false;
    const hosts = this.persons.filter((q) => q.household !== p.household && !q.visitor).sort((a, b) => this.rel.friendship(p.id, b.id) - this.rel.friendship(p.id, a.id));
    for (const h of hosts) {
      if (this.socialAvailability(p, h, def, false).ok) {
        this.queueInteraction(p.id, 'social.farewell', h.id, false);
        return true;
      }
    }
    return false;
  }

  private walkToExit(p: Person): void {
    const ex = this.world.exits[0];
    if (!ex) return;
    const g = this.world.grid;
    p.queue = [];
    const item: QueueItem = { id: this.nextQueueId++, interactionId: GOTO_ID, targetUid: g.idx(ex.x, ex.y), autonomous: false };
    p.queue.push(item);
    this.startAction(p, item);
  }

  // ------------------------------------------------------------------ 스킬 (M4)

  /** 스킬 활동 1분: 태그로 걸리는 스킬 + 상호작용이 지정한 스킬 (17-1) */
  skillMinute(p: Person, tags: readonly string[], skill?: string, extraPct = 0, xpMult = 1, more?: readonly string[]): void {
    const sk = this.skills!;
    const list = sk.skillsForTags(tags, this.skillBuf);
    if (skill && !list.includes(skill)) list.push(skill);
    if (more) for (const s of more) if (!list.includes(s)) list.push(s);
    if (!list.length) return;
    const emo = p.emotionStage >= 1 ? EMOTION_IDS[p.emotion] : null;
    // 여러 스킬에 걸리면 나눠 받음 (한 행동으로 스킬 여럿을 한꺼번에 올리지 않게)
    const share = 1 / list.length;
    for (const id of list) {
      const up = sk.gain(p, id, share, emo, extraPct, 1, xpMult * (this.house ? this.house.skillXpMult(p, id) : 1));
      if (up !== null) {
        this.notice(p, 'skill_up', { skill: `skill.${id}`, level: up });
        this.inner?.event(p, `skill:${id}:${up}`);
        p.lastSkillUp = { minute: this.world.minute, skill: id, level: up };
      }
    }
  }

  // ------------------------------------------------------------------ 농사 (M4, GDD 31)

  isFarmObj(o: ObjectInstance): boolean {
    const tags = this.world.def(o.defId).tags ?? [];
    return tags.includes('field') || tags.includes('orchard');
  }

  private cal(): { seasonDays: number; seasons: string[] } {
    return (this.data.economy as { calendar?: { seasonDays: number; seasons: string[] } } | null)?.calendar ?? { seasonDays: 7, seasons: ['spring', 'summer', 'autumn', 'winter'] };
  }

  /** 씨 뿌리기 계절/텃밭 여부 (요구조건 밖 규칙) */
  farmOk(p: Person, interactionId: string, obj: ObjectInstance): string | null {
    if (!this.farm || !interactionId.startsWith('farm.sow.')) return null;
    const c = this.cal();
    return this.farm.canSow(interactionId.slice(9), obj, this.world.def(obj.defId).tags ?? [], this.world.day(), c.seasons, c.seasonDays, p.estate);
  }

  private farmDone(p: Person, iaId: string, o: ObjectInstance): void {
    const f = this.farm;
    if (!f) return;
    const task = (this.data.interactions[iaId] as { farmTask?: string }).farmTask;
    const tags = this.world.def(o.defId).tags ?? [];
    const day = this.world.day();
    switch (task) {
      case 'till':
        o.state.tilled = 1;
        break;
      case 'sow': {
        if (iaId.startsWith('farm.plant.')) {
          const cid = iaId.slice(11);
          const price = Math.round((f.d.crops[cid]?.perennial?.saplingPrice ?? 24) * 4);
          const acct = this.account(p);
          if (this.econ && acct) this.econ.spend(acct, price, 'goods');
          f.plant(o, cid, day, this.cal().seasonDays);
          this.notice(p, 'sowed', { crop: f.d.crops[cid].nameKey });
          break;
        }
        const cid = iaId.slice(9);
        // 씨앗: 구획 크기만큼 (중 구획 = crops.json seed.perPlot 의 35%, 텃밭은 더 적게)
        const seed = f.d.crops[cid]?.seed;
        if (seed) {
          const need = Math.max(1, Math.round(seed.perPlot * 0.35 * f.sizeOf(tags).yield));
          this.world.stock[seed.item] = Math.max(0, (this.world.stock[seed.item] ?? 0) - need);
        }
        f.sow(o, cid);
        this.notice(p, 'sowed', { crop: f.d.crops[cid].nameKey });
        break;
      }
      case 'weed':
        o.state.weeds = 0;
        o.state.care = Math.min(0.2, Number(o.state.care) + 0.1);
        break;
      case 'water':
        o.state.protect = day + 2;
        break;
      case 'fertilize':
        this.world.stock.manure = Math.max(0, (this.world.stock.manure ?? 0) - 2);
        o.state.fert = Math.min(100, Number(o.state.fert) + 10);
        o.state.care = Math.min(0.2, Number(o.state.care) + 0.05);
        o.state.fertN = Number(o.state.fertN) + 1;
        break;
      case 'scarecrow':
        o.state.scare = 1;
        break;
      case 'harvest': {
        f.yearMult = this.econ ? this.econ.yearMultNow : 1;
        const r = f.harvest(o, tags, p.skills.farming ?? 0, this.cal().seasonDays, day);
        if (r) {
          this.world.stock[r.item] = (this.world.stock[r.item] ?? 0) + r.n;
          this.setQuality(r.item, r.n, 1);
          if (r.straw && this.item('straw')) this.world.stock.straw = (this.world.stock.straw ?? 0) + r.straw;
          this.notice(p, 'harvested', { item: `item.${r.item}`, n: r.n });
          p.lastHarvest = { minute: this.world.minute, item: r.item, n: r.n };
          this.inner?.event(p, 'harvest');
          if (r.n > 0) this.addEngineMoodlet(p, 'good_harvest');
        }
        break;
      }
      case 'glean': {
        const n = 3 + Math.floor(this.rng.next() * 4);
        this.world.stock.wheat = (this.world.stock.wheat ?? 0) + n;
        o.state.glean = 0;
        this.notice(p, 'harvested', { item: 'item.wheat', n });
        break;
      }
    }
  }

  /** 하루 경계: 밭 성장/잡초/재해, 마을 가뭄 */
  private farmDaily(day: number): void {
    const f = this.farm;
    if (!f) return;
    const c = this.cal();
    const host = this.persons.find((q) => q.household === 1);
    const h = {
      day: () => day, season: () => this.world.season, seasonDays: () => c.seasonDays, rng: this.rng,
      notice: (kind: string, args?: Record<string, string | number>) => {
        if (host) this.notice(host, kind, args);
      },
    };
    const fields = this.world.objects.filter((o) => this.isFarmObj(o));
    const plots = fields.filter((o) => !(this.world.def(o.defId).tags ?? []).includes('orchard'));
    f.villageDaily(plots, h);
    f.villageHail(fields, h);
    for (const o of fields) f.daily(o, h, (this.world.def(o.defId).tags ?? []).includes('orchard'));
  }

  // ------------------------------------------------------------------ 제작 (M4, GDD 17-5)

  recipeSkillOk(p: Person, interactionId: string): { ok: boolean; skill?: string; need?: number; have?: number } {
    if (!interactionId.startsWith('recipe.')) return { ok: true };
    const r = this.data.recipes[interactionId.slice(7)];
    if (!r || !this.skills) return { ok: true };
    const have = p.skills[r.skill] ?? 0;
    return have >= r.level ? { ok: true } : { ok: false, skill: r.skill, need: r.level, have };
  }

  /** 제작 결과 품질 0~4: 스킬 레벨 효과 + 감정 (영감/집중 +1) + 걸작 확률 (17-1) */
  private craftQuality(p: Person, skill: string): number {
    const sk = this.skills;
    const lv = p.skills[skill] ?? 0;
    // 기본 품질 1 + skills.json 레벨 효과 quality (17-1 "레벨 효과는 skills.json 별도 필드")
    let q = 1;
    if (sk) q = Math.min(3, q + sk.effects(p, skill).quality);
    const emo = p.emotionStage >= 1 ? EMOTION_IDS[p.emotion] : null;
    if ((emo === 'inspired' || emo === 'focused') && this.rng.next() < 0.5) q = Math.min(3, q + 1);
    if (lv >= 8 && (emo === 'inspired' || emo === 'focused') && this.rng.next() < 0.1) q = 4;
    return q;
  }

  private recipeDone(p: Person, rid: string, station: ObjectInstance | null): void {
    const r = this.data.recipes[rid];
    if (!r) return;
    const q = r.quality ? this.craftQuality(p, r.skill) : 1;
    if (r.wait && station) {
      // 양조/절임: 작업대에 담가 두고 며칠 뒤 산출 (하루 경계에서 꺼냄)
      const days = r.wait.scale === 'season' ? r.wait.value * (((this.data.economy as { calendar?: { seasonDays: number } } | null)?.calendar?.seasonDays ?? 7) / 7) : r.wait.value;
      station.state.brewing = Object.keys(this.data.recipes).indexOf(rid) + 1;
      station.state.readyDay = this.world.day() + Math.max(1, Math.round(days));
      station.state.quality = q;
      this.notice(p, 'recipe_waiting', { recipe: r.nameKey, days: Math.max(1, Math.round(days)) });
    } else {
      for (const [k, n] of Object.entries(r.outputs)) {
        this.setQuality(k, n, q);
        if (this.data.build?.craftedFurniture?.[k]) for (let i = 0; i < n; i++) (this.world.makers[k] ??= []).push(p.id);
      }
      this.notice(p, 'crafted', { recipe: r.nameKey, q });
      if (q >= 4) {
        this.notice(p, 'masterwork', { recipe: r.nameKey });
        this.addEngineMoodlet(p, 'masterwork');
        this.inner?.event(p, 'masterwork');
      }
    }
    p.lastCraft = { minute: this.world.minute, recipe: rid, quality: q };
    this.inner?.event(p, `craft:${rid}`);
    if (p.career) this.deliverOrders(p);
  }

  /** 품목 평균 품질 (판매 값, 음식 무드렛) — 새로 들어온 n 개의 품질을 섞음 */
  private setQuality(item: string, n: number, q: number): void {
    const w = this.world;
    const have = Math.max(0, (w.stock[item] ?? 0) - n);
    const old = w.quality[item] ?? 1;
    w.quality[item] = (old * have + q * n) / Math.max(1, have + n);
  }

  /** 하루 경계: 다 익은 양조/절임을 꺼냄 */
  private finishWaits(day: number): void {
    const ids = Object.keys(this.data.recipes);
    for (const o of this.world.objects) {
      const b = Number(o.state.brewing ?? 0);
      if (!b || Number(o.state.readyDay ?? 0) > day) continue;
      const rid = ids[b - 1];
      const r = this.data.recipes[rid];
      o.state.brewing = 0;
      o.state.readyDay = 0;
      if (!r) continue;
      for (const [k, n] of Object.entries(r.outputs)) {
        this.world.stock[k] = (this.world.stock[k] ?? 0) + n;
        this.setQuality(k, n, Number(o.state.quality ?? 1));
      }
      const host = this.persons.find((q) => q.household === 1);
      if (host) this.notice(host, 'recipe_ready', { recipe: r.nameKey });
    }
  }

  // ------------------------------------------------------------------ 현장형 직업 (대장장이 등, 17-2 "일 목록")

  /** 출근일 아침: 오늘 주문 3~6건 (careers.json orders) */
  private makeOrders(p: Person, day: number): void {
    const st = p.career!;
    const def = this.data.careers![st.id];
    const o = def.orders as unknown as { perDay: [number, number]; feeMult?: [number, number]; pool: Array<{ item: string; qty: [number, number]; weight: number; minRank?: number } | string> };
    // 주문이 없는 현장형(사제, 기사, 음유시인)도 오늘 근무일로 기록 → 하루 끝 일당/승급 정산
    (st as { orderDay?: number }).orderDay = day;
    st.orders = [];
    if (!o) return;
    // 솜씨가 닿는 주문만 (그 품목 레시피 레벨 ≤ 지금 레벨 + 1: 조금 벅찬 주문은 들어옴)
    const canMake = (item: string) => Object.values(this.data.recipes).some((r) => (r.outputs[item] ?? 0) > 0 && r.level <= (p.skills[r.skill] ?? 0) + 1);
    const pool = o.pool.map((x) => (typeof x === 'string' ? { item: x, qty: [1, 2] as [number, number], weight: 1 } : x)).filter((x) => (x.minRank ?? 0) <= st.rank && this.item(x.item) && canMake(x.item));
    if (!pool.length) return;
    const n = o.perDay[0] + Math.floor(this.rng.next() * (o.perDay[1] - o.perDay[0] + 1));
    const w = pool.map((x) => x.weight);
    for (let i = 0; i < n; i++) {
      const pick = pool[Math.max(0, this.rng.weighted(w))];
      const qty = pick.qty[0] + Math.floor(this.rng.next() * (pick.qty[1] - pick.qty[0] + 1));
      const fm = o.feeMult ?? [1.1, 1.4];
      const base = this.econ ? this.econ.itemPrice(this.item(pick.item)!) : this.item(pick.item)!.base;
      const pay = Math.round(base * qty * (fm[0] + this.rng.next() * (fm[1] - fm[0])));
      st.orders.push({ item: pick.item, qty, pay, done: false });
    }
    this.notice(p, 'orders_today', { n, job: def.nameKey });
  }

  /** 현장 근무 중이면: 다음 주문 품목을 만드는 레시피를 고름 (재료가 없으면 장부에서 사 옴) */
  private onsiteWork(p: Person): boolean {
    const st = p.career;
    if (!st || p.visitor) return false;
    const def = this.data.careers?.[st.id];
    if (!def || def.type !== 'onsite') return false;
    const day = this.world.day();
    const m = this.world.minuteOfDay();
    if (!isWorkday(def, day) || m < def.hours[0] * 60 || m >= def.hours[1] * 60) return false;
    if ((st as { orderDay?: number }).orderDay !== day) {
      this.makeOrders(p, day);
      st.lastDay = day;
    }
    this.deliverOrders(p);
    // 급한 욕구가 있으면 그것부터 (자율에 맡김)
    for (const [i, v] of this.data.compiled.interrupt) if (p.needs[i] < v + 10) return false;
    // 아직 못 끝낸 주문 중 지금 솜씨로 만들 수 있는 첫 주문
    let rid: string | undefined;
    for (const o of st.orders) {
      if (o.done || (this.world.stock[o.item] ?? 0) >= o.qty) continue;
      rid = Object.keys(this.data.recipes).find((k) => {
        const r = this.data.recipes[k];
        return (r.outputs[o.item] ?? 0) > 0 && !r.wait && this.data.interactions[`recipe.${k}`] && (p.skills[r.skill] ?? 0) >= r.level;
      });
      if (rid) break;
    }
    if (!st.orders.some((o) => !o.done)) return this.serviceWork(p, def, st, day);
    if (!rid) {
      // 발효/숙성 품목 주문 (에일, 맥주 …): 빈 통에 담가 둠. 다 익은 재고로 다음 주문을 넘김
      for (const o of st.orders) {
        if (o.done) continue;
        const wk = Object.keys(this.data.recipes).find((k) => {
          const r = this.data.recipes[k];
          return (r.outputs[o.item] ?? 0) > 0 && !!r.wait && (p.skills[r.skill] ?? 0) >= r.level && this.data.interactions[`recipe.${k}`];
        });
        if (!wk) continue;
        const ia = this.data.interactions[`recipe.${wk}`];
        const vat = this.world.objects.find((x) => ia.objects.includes(x.defId) && !Number(x.state.brewing ?? 0));
        if (!vat) continue;
        this.buyInputs(p, def, st, wk);
        if (!checkRequires(this.world, ia, vat).ok) continue;
        this.queueInteraction(p.id, `recipe.${wk}`, vat.uid, true);
        return true;
      }
      return false;
    }
    this.buyInputs(p, def, st, rid);
    const ia = this.data.interactions[`recipe.${rid}`];
    const station = this.world.objects.find((o) => ia.objects.includes(o.defId));
    if (!station || !checkRequires(this.world, ia, station).ok) return false;
    this.queueInteraction(p.id, `recipe.${rid}`, station.uid, true);
    return true;
  }

  /** 서비스 일감: 오늘 몫(perDay)만큼 부지 밖으로 나가 일하고 사례금 (17-2 현장형 "손님 응대") */
  private serviceWork(p: Person, def: import('./people/careers').CareerDef, st: import('./people/careers').CareerState, day: number): boolean {
    const svc = (def as { services?: { perDay: [number, number]; pool: Array<{ id: string }> } }).services;
    if (!svc?.pool.length) return false;
    const s2 = st as { svcDay?: number; svcLeft?: number };
    if (s2.svcDay !== day) {
      s2.svcDay = day;
      s2.svcLeft = svc.perDay[0] + Math.floor(this.rng.next() * (svc.perDay[1] - svc.perDay[0] + 1));
    }
    if (!s2.svcLeft) return false;
    const exit = this.world.objects.find((o) => o.defId === 'lot_exit');
    if (!exit) return false;
    const pick = svc.pool[Math.floor(this.rng.next() * svc.pool.length)];
    const id = `service.${st.id}.${pick.id}`;
    if (!this.data.interactions[id]) return false;
    s2.svcLeft--;
    this.queueInteraction(p.id, id, exit.uid, true);
    return true;
  }

  private serviceDone(p: Person, iaId: string): void {
    const [, cid, sid] = iaId.split('.');
    const def = this.data.careers?.[cid];
    const st = p.career;
    if (!def || !st || st.id !== cid) return;
    const sv = (def as { services?: { pool: Array<{ id: string; fee: [number, number] }> } }).services?.pool.find((x) => x.id === sid);
    if (!sv) return;
    const rank = def.ranks[st.rank] as { feeMult?: number };
    const fee = Math.round((sv.fee[0] + this.rng.next() * (sv.fee[1] - sv.fee[0])) * 4 * (rank.feeMult ?? 1));
    const acct = this.account(p);
    if (this.econ && acct && fee > 0) this.econ.earn(acct, fee, 'shop');
    st.perf += 3;
    p.lastWork = { minute: this.world.minute, wage: fee };
    this.inner?.event(p, `service:${sid}`);
  }

  /** 주문 재료/연료가 모자라면 사 옴. 도제/직인은 공방(장인)이 대 주므로 제 몫(share)만큼만 가계가 부담 (17-2) */
  private buyInputs(p: Person, def: import('./people/careers').CareerDef, st: import('./people/careers').CareerState, rid: string): void {
    const r = this.data.recipes[rid];
    const acct = this.account(p);
    const share = (def.ranks[st.rank] as { share?: number } | undefined)?.share ?? 1;
    for (const [k, n] of [...Object.entries(r.inputs), ...Object.entries(r.fuel ?? {})]) {
      const lack = n - (this.world.stock[k] ?? 0);
      const it = this.item(k);
      if (lack <= 0 || !it) continue;
      if (share >= 1 && this.econ && acct) {
        const got = this.econ.buy(acct, it, lack, 'materials');
        this.world.stock[k] = (this.world.stock[k] ?? 0) + got;
      } else {
        // 공방 재료: 몫 비율만큼만 가계 돈
        if (share > 0 && this.econ && acct) this.econ.spend(acct, Math.round(this.econ.itemPrice(it) * lack * share), 'materials');
        this.world.stock[k] = (this.world.stock[k] ?? 0) + lack;
      }
    }
  }

  /** 주문 품목이 재고에 다 있으면 넘기고 값을 받음 (도제는 몫 0, 직인 절반, 장인 전부 — careers ranks share) */
  private deliverOrders(p: Person): void {
    const st = p.career;
    if (!st) return;
    const def = this.data.careers?.[st.id];
    for (const o of st.orders) {
      if (o.done || (this.world.stock[o.item] ?? 0) < o.qty) continue;
      this.world.stock[o.item] -= o.qty;
      o.done = true;
      const share = (def?.ranks[st.rank] as { share?: number } | undefined)?.share ?? 1;
      const q = this.world.quality[o.item] ?? 1;
      const pay = Math.round(o.pay * share * (1 + 0.1 * (q - 1)));
      const acct = this.account(p);
      if (this.econ && acct && pay > 0) this.econ.earn(acct, pay, 'shop');
      st.perf += 4 * (1 + 0.2 * (q - 1));
      this.notice(p, 'order_done', { item: `item.${o.item}`, qty: o.qty, pay });
      p.lastWork = { minute: this.world.minute, wage: pay };
      this.inner?.event(p, 'order_done');
    }
  }

  /** 하루 끝: 못 끝낸 주문은 성과 감점 */
  private onsiteEndOfDay(day: number): void {
    for (const p of this.persons) {
      const st = p.career;
      const def = st ? this.data.careers?.[st.id] : undefined;
      if (!st || !def || def.type !== 'onsite' || (st as { orderDay?: number }).orderDay !== day) continue;
      const wage = def.ranks[st.rank]?.wage;
      const acct = this.account(p);
      if (wage && this.econ && acct) this.econ.earn(acct, wage, 'wage');
      const slowItem = (item: string) => Object.values(this.data.recipes).some((r) => (r.outputs[item] ?? 0) > 0 && !!r.wait);
      const left = st.orders.filter((o) => !o.done && !slowItem(o.item)).length;
      if (left) {
        st.perf -= left * 3;
        this.notice(p, 'orders_missed', { n: left });
      }
      st.days++;
      this.careerVerdict(p, def, st);
      st.orders = [];
    }
  }

  // ------------------------------------------------------------------ 직업 (M4, GDD 17-2)

  setCareer(p: Person, careerId: string | null): { ok: boolean; reason?: string } {
    if (p.career && p.action && (p.action.item.interactionId === `work.${p.career.id}` || p.action.item.interactionId.startsWith('service.'))) this.abortAction(p, 'career_change');
    p.queue = p.queue.filter((q) => !q.interactionId.startsWith('work.') && !q.interactionId.startsWith('service.'));
    if (!careerId) {
      if (p.career) this.notice(p, 'quit_job', { job: this.data.careers?.[p.career.id]?.nameKey ?? '' });
      p.career = null;
      return { ok: true };
    }
    const def = this.data.careers?.[careerId];
    if (!def || def.npc_role) return { ok: false, reason: 'unknown' };
    if (!def.estates.includes(p.estate)) return { ok: false, reason: 'estate' };
    if (def.literacy && (p.skills.reading ?? 0) < 1) return { ok: false, reason: 'literacy' };
    if (p.stage === 'child' || p.stage === 'teen') return { ok: false, reason: 'age' };
    // 장인 신분이 제 공방 직업을 얻으면 장인 등급부터 (17-2 장인 경로). 나머지는 맨 아래부터
    const startRank = def.type === 'onsite' && p.estate === 'artisan' ? Math.min(2, def.ranks.length - 1) : 0;
    p.career = { id: careerId, rank: startRank, perf: 0, days: 0, attitude: 'normal', lastDay: -1, warned: false, orders: [] };
    this.notice(p, 'new_job', { job: def.nameKey });
    this.inner?.event(p, `job:${careerId}`);
    return { ok: true };
  }

  /** 지금 출근할 시각인가 (래빗홀형, 오늘 아직 안 감) */
  private careerDue(p: Person): boolean {
    const st = p.career;
    if (!st || p.collapse || p.visitor) return false;
    const def = this.data.careers?.[st.id];
    if (!def || def.type === 'onsite') return false;
    const day = this.world.day();
    if (st.lastDay === day || !isWorkday(def, day)) return false;
    if (def.type === 'journey') {
      const prep = (def as { journey?: { prepDays?: { value: number } } }).journey?.prepDays?.value ?? 2;
      if (st.tripEnd && day < Math.floor(st.tripEnd / 1440) + prep) return false;
    }
    const m = this.world.minuteOfDay();
    const start = def.hours[0] * 60 - COMMUTE_MINUTES;
    // 늦어도 퇴근 2시간 전까지는 감 (늦은 만큼 일당이 줄고 성과 감점)
    if (m < start || m > def.hours[1] * 60 - 120) return false;
    if (p.action?.item.interactionId === `work.${st.id}`) return false;
    if (p.queue.some((q) => q.interactionId === `work.${st.id}`)) return false;
    return true;
  }

  /** 출근: 하던 자율 행동(잠 포함)을 멈추고 일터로 (심즈처럼 출근은 자동) */
  private goToWork(p: Person): void {
    const st = p.career!;
    const exit = this.world.objects.find((o) => o.defId === 'lot_exit');
    if (!exit) return;
    if (p.action && (p.action.item.autonomous || p.sleeping)) this.abortAction(p, 'work');
    this.releaseEngaged(p);
    p.queue = p.queue.filter((q) => !q.autonomous);
    const item: QueueItem = { id: this.nextQueueId++, interactionId: `work.${st.id}`, targetUid: exit.uid, autonomous: false };
    p.queue.unshift(item);
    st.lastDay = this.world.day();
    const def = this.data.careers![st.id];
    if (def.type === 'journey') {
      const jd = (def as { journey?: { days: [number, number] } }).journey?.days ?? [3, 5];
      const days = jd[0] + Math.floor(this.rng.next() * (jd[1] - jd[0] + 1));
      st.tripEnd = this.world.minute + days * 1440;
      this.notice(p, 'journey_start', { days });
      return;
    }
    this.notice(p, 'go_work', { job: def.nameKey });
  }

  /** 근무를 마침 (다 채웠거나 중간에 그만둠): 일당, 성과, 태도 스트레스, 승급/경고/해고, 일터 사건 */
  private workDone(p: Person, minutes: number, full: boolean): void {
    const st = p.career;
    if (!st) return;
    const def = this.data.careers?.[st.id];
    if (!def) return;
    if (def.type === 'journey') return this.journeyDone(p, def, st, minutes, full);
    const shift = Math.max(60, (def.hours[1] - def.hours[0]) * 60);
    const frac = Math.min(1, minutes / shift);
    const emo = p.emotionStage >= 1 ? EMOTION_IDS[p.emotion] : null;
    const perfToday = dayPerformance(p, def, st, emo) * frac - (full ? 0 : 5);
    st.perf += perfToday;
    st.days++;
    // 일당 = 등급 일당 × (1 + 성과 보정 −20% ~ +30%) × 근무 비율 (17-7)
    const pm = this.econ ? this.econ.d.income.performance : { min: -0.2, max: 0.3 };
    const perfMod = Math.max(pm.min, Math.min(pm.max, (perfToday - 10) / 40));
    const wage = Math.round(wageOf(def, st) * (1 + perfMod) * frac);
    const acct = this.account(p);
    if (this.econ && acct && wage > 0) this.econ.earn(acct, wage, 'wage');
    if (this.inner) this.inner.addStress(p, ATTITUDE[st.attitude].stress * frac);
    this.notice(p, 'work_done', { job: def.nameKey, wage, perf: Math.round(perfToday) });
    p.lastWork = { minute: this.world.minute, wage };
    this.inner?.event(p, `work_done:${st.id}`);
    // 승급 (17-2 "성과가 차면 승급 사건") / 경고 / 해고
    this.careerVerdict(p, def, st);
    if (!p.career) return;
    // 일터 사건 카드 (24-1): 근무 끝에 가끔
    if (full && def.events?.length && !p.careerEvent && this.rng.next() < 0.3) {
      const ev = def.events[Math.floor(this.rng.next() * def.events.length)];
      p.careerEvent = { careerId: st.id, eventId: ev.id, since: this.world.minute };
      this.notice(p, 'career_event', { job: def.nameKey });
    }
  }

  private rabbitCache = new Map<string, Float64Array>();
  /** 근무 중 욕구 감소 배수 (욕구 순서 NEED_IDS) */
  private awayCache: Float64Array | null = null;
  /** 집 밖 래빗홀(학교·기숙·외출) 욕구 배수: childcare.json awayNeeds */
  private awayNeeds(): Float64Array {
    if (!this.awayCache) {
      const r = (this.childcare?.d as { awayNeeds?: Record<string, number> } | undefined)?.awayNeeds ?? {};
      this.awayCache = new Float64Array(8);
      for (let i = 0; i < 8; i++) this.awayCache[i] = r[NEED_IDS[i]] ?? 0.5;
    }
    return this.awayCache;
  }

  private rabbitNeeds(careerId: string): Float64Array {
    let r = this.rabbitCache.get(careerId);
    if (!r) {
      const rules = this.data.careerRules?.rabbitholeNeeds ?? { hunger: 0.5, energy: 1, hygiene: 1, bladder: 0, fun: 0.5, social: 0.3, warmth: 0, comfort: 0.5 };
      const own = (this.data.careers?.[careerId] as { rabbitholeNeeds?: Record<string, number> } | undefined)?.rabbitholeNeeds ?? {};
      r = new Float64Array(8);
      for (let i = 0; i < 8; i++) r[i] = own[NEED_IDS[i]] ?? rules[NEED_IDS[i]] ?? 1;
      this.rabbitCache.set(careerId, r);
    }
    return r;
  }

  /** 교역 여정 결산 (17-7): 수익 = 투자액 × (기본 25% + 셈×2% + 이야기×1% + 등급) × 사건 배수 − 하루 비용, 12% 손실 사건 */
  private journeyDone(p: Person, def: import('./people/careers').CareerDef, st: import('./people/careers').CareerState, minutes: number, full: boolean): void {
    const e = this.econ;
    const acct = this.account(p);
    const days = Math.max(1, Math.round(minutes / 1440));
    for (let i = 0; i < 8; i++) p.needs[i] = Math.max(p.needs[i], 60);
    if (!e || !acct) return;
    const I = e.d.income.trade;
    const S = e.S(p.estate as EstateId) * 4;
    const invest = Math.max(0, Math.min(Math.round(acct.money * 0.8), Math.round(S * 0.4)));
    const rankBonus = (def.ranks[st.rank] as { rankBonus?: number }).rankBonus ?? 0;
    const r = I.baseReturn + (p.skills.reckoning ?? 0) * I.perReckoning + (p.skills.storytelling ?? 0) * I.perStory + rankBonus;
    let profit = invest * r * (I.eventMult[0] + this.rng.next() * (I.eventMult[1] - I.eventMult[0]));
    let lost = false;
    if (this.rng.next() < I.lossChance) {
      profit = -invest * (I.lossRange[0] + this.rng.next() * (I.lossRange[1] - I.lossRange[0]));
      lost = true;
    }
    profit -= I.costPerDay * 4 * days;
    if (!full) profit *= 0.5;
    profit = Math.round(profit);
    if (profit >= 0) e.earn(acct, profit, 'trade');
    else e.spend(acct, -profit, 'trade_loss');
    const pp = (def as { journey?: { perfPerTrip?: { profit: number; loss: number } } }).journey?.perfPerTrip ?? { profit: 6, loss: -4 };
    st.perf += profit >= 0 ? pp.profit * 10 / 6 : pp.loss * 10 / 6;
    st.days += days;
    p.lastWork = { minute: this.world.minute, wage: Math.max(0, profit) };
    this.notice(p, lost ? 'journey_loss' : 'journey_done', { m: Math.abs(profit), days });
    this.inner?.event(p, lost ? 'trade_loss' : 'trade_profit');
    if (st.perf >= def.promoteAt && st.rank < def.ranks.length - 1) {
      st.rank++;
      st.perf = 0;
      this.notice(p, 'promoted', { job: def.nameKey, rank: def.ranks[st.rank].nameKey });
      this.addEngineMoodlet(p, 'promoted');
    }
  }

  /** 일터 사건 선택지 고름 */
  careerChoice(p: Person, option: string): boolean {
    const ce = p.careerEvent;
    if (!ce) return false;
    const ev = this.data.careers?.[ce.careerId]?.events?.find((e) => e.id === ce.eventId);
    const opt = ev?.options.find((o) => o.id === option);
    if (!ev || !opt) return false;
    const e = opt.effects ?? {};
    if (p.career && p.career.id === ce.careerId && e.performance) p.career.perf += e.performance;
    const acct = this.account(p);
    if (e.money && this.econ && acct) {
      if (e.money > 0) this.econ.earn(acct, e.money, 'work_event');
      else this.econ.spend(acct, -e.money, 'work_event');
    }
    for (const m of e.moodlets ?? []) this.addEngineMoodlet(p, m);
    if (e.skillXp && this.skills) for (const [s, xp] of Object.entries(e.skillXp)) this.skills.gain(p, s, xp / 0.45, null);
    p.careerEvent = null;
    this.inner?.event(p, `career_event:${ev.id}:${opt.id}`);
    return true;
  }

  /** 승급 / 경고 / 해고 (래빗홀, 현장형 공통, 17-2) */
  private careerVerdict(p: Person, def: import('./people/careers').CareerDef, st: import('./people/careers').CareerState): void {
    if (st.perf >= def.promoteAt && st.rank < def.ranks.length - 1) {
      st.rank++;
      st.perf = 0;
      st.warned = false;
      this.notice(p, 'promoted', { job: def.nameKey, rank: def.ranks[st.rank].nameKey });
      this.addEngineMoodlet(p, 'promoted');
      this.inner?.event(p, 'promoted');
    } else if (st.perf <= -60) {
      this.notice(p, 'fired', { job: def.nameKey });
      this.addEngineMoodlet(p, 'fired');
      this.inner?.event(p, 'fired');
      p.career = null;
    } else if (st.perf <= -30 && !st.warned) {
      st.warned = true;
      this.notice(p, 'work_warning', { job: def.nameKey });
    }
  }

  /** 하루 끝: 출근일인데 안 간 사람 성과 감점, 선택 대기 오래되면 자동 선택 */
  private careerEndOfDay(day: number): void {
    for (const p of this.persons) {
      const st = p.career;
      if (!st) continue;
      const def = this.data.careers?.[st.id];
      if (!def || def.type !== 'rabbithole') continue;
      if (isWorkday(def, day) && st.workedDay !== day) {
        st.perf -= 15;
        this.notice(p, 'missed_work', { job: def.nameKey });
        this.careerVerdict(p, def, st);
      }
    }
  }

  // ------------------------------------------------------------------ 경제 (M4)

  item(id: string): ItemDef | undefined {
    return this.data.items[id];
  }

  account(p: Person): Account | undefined {
    return this.econ?.account(p.household);
  }

  /** 장터에서 사고팔기 (상호작용 효과 buy/sell). 파는 수 -1 = 가진 만큼 다 */
  private trade(p: Person, buy?: Record<string, number>, sell?: Record<string, number>): void {
    const e = this.econ;
    const a = this.account(p);
    if (!e || !a) {
      // 경제가 없는 부지(M1 테스트): 예전처럼 공짜로 채움
      if (buy) for (const [k, n] of Object.entries(buy)) this.world.stock[k] = (this.world.stock[k] ?? 0) + n;
      return;
    }
    let spent = 0;
    let got = 0;
    if (sell) {
      for (const [k, n0] of Object.entries(sell)) {
        const def = this.item(k);
        const have = this.world.stock[k] ?? 0;
        const n = Math.min(have, n0 < 0 ? have : n0);
        if (!def || n <= 0) continue;
        got += e.sell(a, def, n, 'sale');
        this.world.stock[k] = have - n;
      }
    }
    if (buy) {
      // 장보기 목록 = 채울 목표 재고 (모자라는 만큼만 삼)
      for (const [k, want] of Object.entries(buy)) {
        const def = this.item(k);
        const n = Math.max(0, want - (this.world.stock[k] ?? 0));
        if (!def || n <= 0) continue;
        const before = a.money;
        const k2 = e.buy(a, def, n, def.food || def.ledger === 'vegetables' || def.ledger === 'grain' ? 'food' : k === 'firewood' ? 'fuel' : 'goods');
        spent += before - a.money;
        if (k2 > 0) {
          this.world.stock[k] = (this.world.stock[k] ?? 0) + k2;
          this.setQuality(k, k2, 1);
        }
      }
    }
    if (spent || got) this.notice(p, 'market_trip', { spent, got });
  }

  /** 하루가 바뀜: 계절, 저장고 부패, 경제 정산 (17-9 자정 정산) */
  private newDay(day: number): void {
    this.fire?.newDay();
    for (const p of this.persons) p.today = day;
    // 아이 하루 끝 (15-5): 과제 정산·성적 무드렛·기숙 향수·수업료, 유모 일당 (못 내면 유모가 그만둠)
    const cc = this.childcare;
    if (cc && day > 0) {
      for (const p of [...this.persons]) {
        if (p.lifeStage === 'child') cc.dayEnd(p);
        if (p.wetNurse && p.lifeStage === 'baby') {
          const a = this.econ?.account(p.household);
          if (a && a.money >= cc.d.baby.wetNurse.pricePerDay) this.econ!.spend(a, cc.d.baby.wetNurse.pricePerDay, 'servants');
          else if (a) p.wetNurse = false;
        } else if (p.wetNurse) p.wetNurse = false;
      }
    }
    if (this.judge) {
      this.judge.daily();
      this.rumors?.daily(day, this.persons);
    }
    if (day > 0) this.house?.daily(day);
    const w = this.world;
    if (day > 0) {
      this.careerEndOfDay(day - 1);
      this.onsiteEndOfDay(day - 1);
    }
    // 계절부터 (밭/과수는 오늘의 계절로 자람)
    const cal = (this.data.economy as { calendar?: { seasonDays: number; seasons: string[] } } | null)?.calendar;
    if (cal) {
      const s = cal.seasons[Math.floor(day / cal.seasonDays) % cal.seasons.length] as typeof w.season;
      if (s !== w.season) {
        w.season = s;
        w.updateRoomTemps(true);
        for (const p of this.persons) if (p.household < 100) this.notice(p, 'season', { season: `hud.season.${s}` });
      }
    }
    this.finishWaits(day);
    this.farmDaily(day);
    this.spoilStorage(day);
    const e = this.econ;
    if (!e) return;
    const host = this.persons.find((q) => q.household === 1);
    // 현물 납부 (31-6): 세금일에 돈이 모자라면 곡물을 기준가로 쳐서 냄
    const acct1 = e.account(1);
    if (acct1 && host) {
      const due = e.taxDue(acct1, day - 1);
      let short = due - acct1.money;
      for (const g of ['wheat', 'rye', 'barley', 'oats', 'beans']) {
        if (short <= 0) break;
        const def = this.item(g);
        const have = w.stock[g] ?? 0;
        if (!def || have <= 0) continue;
        const n = Math.min(have, Math.ceil(short / Math.max(1, def.base)));
        w.stock[g] = have - n;
        e.earn(acct1, n * def.base, 'inkind', false);
        short -= n * def.base;
        this.notice(host, 'tax_inkind', { item: `item.${g}`, n });
      }
    }
    e.endOfDay(day - 1, {
      notice: (h, kind, args) => {
        if (kind === 'tax_paid') this.house?.onTaxPaid(Number(args?.n ?? 0));
        if (kind === 'bankrupt') this.house?.onBankrupt(h);
        const q = this.persons.find((x) => x.household === h);
        if (q) this.notice(q, kind, args);
      },
    });
    // 조작 가정 구휼 (17-9): 먹을 것이 식구 하루치도 없고 돈도 없으면 교회 빵
    const a = e.account(1);
    if (a && host) {
      const members = this.persons.filter((q) => q.household === 1).length;
      let food = 0;
      for (const [k, v] of Object.entries(w.stock)) if (this.item(k)?.food || k === 'bread' || k === 'preserves' || k === 'ingredients') food += v;
      const dayCost = members * 6;
      if (food < members && a.money < dayCost && a.reliefDays < (this.data.economy as { relief: { church: { maxDays: number } } }).relief.church.maxDays) {
        e.relief(a, day, undefined);
        w.stock.bread = (w.stock.bread ?? 0) + members;
        this.notice(host, 'relief_church', { n: members });
        this.inner?.event(host, 'relief_church');
      } else if (food < members && a.money < dayCost) {
        // 친척 도움 (17-9): 교회 구휼이 끝났으면 우정 30 이상인 친척 가정이 저축의 최대 10% 를 보탬 (관계에 따라 증여)
        this.kinRelief(1, members * 6 * 3);
      } else if (food >= members) a.reliefDays = 0;
    }
  }

  /** 저장고 부패 (17-5): 묶음을 재고에 맞추고, 기간이 지난 묶음은 버림 */
  private spoilStorage(day: number): void {
    const w = this.world;
    const SD = (this.data.economy as { calendar?: { seasonDays: number } } | null)?.calendar?.seasonDays ?? 7;
    const lost: string[] = [];
    // 지하 저장고가 있으면 부패 속도 절반 (23-2, 17-5)
    const cellar = w.hasCellar();
    for (const [k, v] of Object.entries(w.stock)) {
      const sp = this.item(k)?.spoil;
      let list = w.batches.get(k);
      if (!list) {
        list = [];
        w.batches.set(k, list);
      }
      // 재고와 맞춤: 늘었으면 오늘 들어온 묶음, 줄었으면 오래된 것부터 먹은 것으로
      let sum = 0;
      for (const b of list) sum += b.qty;
      if (v > sum) list.push({ qty: v - sum, day });
      else {
        let take = sum - v;
        while (take > 0 && list.length) {
          const t = Math.min(take, list[0].qty);
          list[0].qty -= t;
          take -= t;
          if (list[0].qty <= 0) list.shift();
        }
      }
      if (!sp) continue;
      const life = (sp.scale === 'season' ? sp.value * (SD / 7) : sp.value) * (cellar ? 2 : 1);
      let spoiled = 0;
      while (list.length && day - list[0].day >= life) spoiled += list.shift()!.qty;
      if (spoiled > 0) {
        w.stock[k] = Math.max(0, v - spoiled);
        lost.push(`${k}:${spoiled}`);
      }
    }
    const host = this.persons.find((q) => q.household === 1);
    if (host && lost.length) for (const l of lost) {
      const [item, n] = l.split(':');
      this.notice(host, 'spoiled', { item: `item.${item}`, n: Number(n) });
    }
  }

  // ------------------------------------------------------------------ 관찰

  /** 결정론 검사용 해시 (FNV-1a) */
  // ------------------------------------------------------------------ 생애와 가족 (M7, GDD 10, 15)

  /** 생애 7단계 → 네 묶음 단계, 아기/유아 표시, 조작 가문 유아가 걸어 다니게 (판정기·생애 모듈 공용) */
  coarseStage(p: Person): void {
    p.stage = p.lifeStage === 'baby' || p.lifeStage === 'toddler' || p.lifeStage === 'child' ? 'child' : p.lifeStage === 'teen' ? 'teen' : p.lifeStage === 'elder' ? 'elder' : 'adult';
    const wasInfant = p.infant;
    p.infant = p.lifeStage === 'baby' || p.lifeStage === 'toddler';
    if (!p.infant) p.crying = false;
    if (p.lifeStage !== 'baby' && p.babyPlace) {
      // 아기 → 유아: 요람/품에서 내려와 그 자리에서 기어다님
      this.childcare?.putDown(p);
      p.babyPlace = null;
      p.pose = 'stand';
      p.sleeping = false;
    }
    const shown = !!this.childcare && (p.household === 1 || !this.town);
    if (wasInfant && (!p.infant || shown)) {
      p.hidden = false;
      const mom = this.persons.find((q) => q.id === p.mother);
      if (mom && !shown) {
        p.x = mom.x;
        p.y = mom.y;
      }
    }
    if (p.appearance && 'stage' in p.appearance) p.appearance = { ...p.appearance, stage: p.stage };
    this.inner?.invalidate(p);
  }

  /** 조작 가문(또는 한 부지 모드) 아기·유아를 실제로 보이게: 전체 세밀도, 아기는 요람/품 */
  private showInfant(p: Person): void {
    if (!this.childcare) return;
    p.hidden = false;
    p.lod = 'full';
    if (p.lifeStage === 'baby' && !p.babyPlace) this.childcare.placeNewborn(p, this.persons.find((q) => q.id === p.mother) ?? null);
  }

  /** 걷기 속도 배수: 유아(기기/걸음마), 노년 (10-2) */
  private moveMult(p: Person): number {
    let m = this.childcare ? this.childcare.speedMult(p) : 1;
    if (this.genetics) m *= this.genetics.gaits[p.gait]?.walk ?? 1;
    if (p.lifeStage === 'elder' && this.lifecycle) m *= this.lifecycle.d.elder.walkMult;
    if (p.pregnancy && this.pregnancy) m *= this.pregnancy.moveMult(p);
    return m;
  }

  /** 상호작용 한 분: 유아/아동 기술 가르치기(teach), 과제 진척 (object·care 공용) */
  private childMinute(target: Person, def: { teach?: Record<string, number>; homework?: number; minutes?: number; steps?: { minutes: number }[] }): void {
    const cc = this.childcare!;
    if (def.teach) for (const [skill, per] of Object.entries(def.teach)) cc.teach(target, skill, per);
    if (def.homework && target.homework) {
      const total = def.minutes ?? def.steps?.reduce((a, st) => a + st.minutes, 0) ?? 40;
      cc.homeworkProgress(target, def.homework / Math.max(1, total));
    }
  }

  private careDefs: [string, { careAds?: Record<string, number> }][] | null = null;
  /** 돌봄 후보 (아기/유아의 욕구 긴급도가 점수) */
  private careCandidates(p: Person, buf: Candidate[]): void {
    const cc = this.childcare;
    if (!cc) return;
    this.careDefs ??= Object.entries(this.data.social).filter(([, d]) => d.category === 'care') as never;
    const ref = this.data.balance.autonomy.distanceRefTiles;
    cc.careCandidates(
      p,
      (interactionId, targetId, score) => {
        if (score >= this.data.balance.autonomy.minScore) buf.push({ interactionId, target: null, targetUid: targetId, score });
      },
      this.careDefs!,
      (a, t, id) => this.socialAvailability(a, t, this.data.social[id], true).ok,
      (n, v) => urgency(this.data, n, v),
      ref,
    );
  }

  /** 한 시간마다: 생일(아침), 유아 위험·떼, 학교 오가기·수업, 청소년 반항(밤) */
  private familyHourly(hour: number): void {
    const lc = this.lifecycle;
    const cc = this.childcare;
    if (lc && hour === lc.d.birthday.hour) lc.morning();
    this.cards?.hourly();
    this.house?.hourly();
    if (this.pregnancy) {
      this.pregnancy.tick();
      // 입덧 (15-1 초기): 아침에 깨면
      if (hour === 7) for (const q of [...this.persons]) if (q.pregnancy && !q.sleeping) this.pregnancy.onWake(q);
    }
    if (!cc) return;
    for (const p of [...this.persons]) {
      if (p.lod !== 'full' && p.household !== 1) {
        // 화면 밖 NPC 아이: 수업 경험치만 (학교는 일과표가 데려감)
        if (p.lifeStage === 'child' && p.education) cc.lessonHour(p);
        continue;
      }
      if (p.lifeStage === 'toddler' && !p.hidden) cc.toddlerHour(p);
      if (p.lifeStage === 'child') {
        const away = cc.awayForSchool(p);
        if (away && !p.schoolAway && p.status === 'available' && !p.direct) this.leaveForSchool(p);
        else if (!away && p.schoolAway) this.backFromSchool(p);
        cc.lessonHour(p);
      } else if (p.schoolAway && !p.sneakUntil) this.backFromSchool(p);
      if (hour === 22 && p.lifeStage === 'teen' && p.household === 1 && p.status === 'available') {
        const r = cc.rebellionCheck(p);
        if (r === 'sneak') this.sneakOut(p, 3 * 60);
        else if (r === 'runaway') this.sneakOut(p, this.durDays(cc.d.teen.rebellion.runawayDays as { value: number; scale?: string }) * 1440, true);
      }
      if (p.sneakUntil && this.world.minute >= p.sneakUntil) this.backFromSchool(p);
    }
  }

  /** 학교/기숙/시동으로 집을 비움 (15-5 래빗홀): 하던 일을 멈추고 숨음. 욕구는 학교에서 채움 */
  private leaveForSchool(p: Person): void {
    if (p.action) this.abortAction(p, 'school');
    p.queue = [];
    this.world.release(p.id);
    p.schoolAway = true;
    p.hidden = true;
    p.status = 'rabbithole';
    for (const n of ['hunger', 'energy', 'bladder', 'hygiene', 'social'] as NeedId[]) p.setNeed(n, Math.max(p.need(n), 60));
  }

  private backFromSchool(p: Person): void {
    p.schoolAway = false;
    p.sneakUntil = 0;
    p.hidden = false;
    p.status = 'available';
    for (const n of ['hunger', 'energy', 'bladder', 'hygiene', 'social', 'fun'] as NeedId[]) p.setNeed(n, Math.max(p.need(n), 55));
    const t = this.town;
    if (t && p.homeLot) {
      const goal = t.targetCell(p, 'home');
      const g = this.world.grid;
      p.x = (goal % g.w) + 0.5;
      p.y = Math.floor(goal / g.w) + 0.5;
    }
  }

  /** 기간 필드 → 일 (29-0 scale: lifespan 은 수명 배수, season 은 계절 길이, 그 밖 그대로) */
  durDays(d: { value: number; scale?: string }): number {
    if (d.scale === 'lifespan') return d.value * this.settings.lifespan;
    if (d.scale === 'season') return d.value * (((this.data.economy as { calendar?: { seasonDays: number } } | null)?.calendar?.seasonDays ?? 7) / 7);
    return d.value;
  }

  /** 청소년 반항 (15-6): 몰래 나감 / 가출. 부모는 걱정 */
  private sneakOut(p: Person, minutes: number, runaway = false): void {
    this.leaveForSchool(p);
    p.sneakUntil = this.world.minute + minutes;
    for (const q of this.persons) if (q.id === p.mother || q.id === p.father) this.addEngineMoodlet(q, runaway ? 'kin_on_trial_worry' : 'rebellious_mood');
    if (runaway) this.townNews('teen_runaway', { a: p.name }, [p]);
  }

  private lifecycleHost(rng: Rng): import('./family/lifecycle').LifecycleHost {
    const sim = this;
    const S = this.data.story!;
    const personality = Object.entries(this.data.inner?.traits.traits ?? {}).filter(([, t]) => !['temperament', 'congenital', 'elder', 'acquired', 'reward'].includes(t.category)).map(([id]) => id);
    return {
      get persons() {
        return sim.persons.filter((q) => !q.visitor);
      },
      rng,
      baseStageDays: (st) => S.stageDays[st] ?? 24,
      baseDisplayAge: (st) => (S.displayAge[st] ?? [30, 1]) as [number, number],
      lifespan: () => this.settings.lifespan,
      agingOffHousehold: (hh) => this.settings.agingOffHouseholds.has(hh),
      day: () => this.world.day(),
      moodlet: (p, id) => this.addEngineMoodlet(p, id),
      news: (kind, args, subjects) => this.townNews(kind, args, subjects),
      notice: (p, kind, args) => this.notice(p, kind, args),
      coarse: (p) => this.coarseStage(p),
      personalityTraits: () => personality,
      traitConflicts: (t, have) => this.inner?.conflicts(t, [...have]) ?? false,
      parentBond: (p) => this.parentBond(p),
      toddlerSkillAvg: (p) => this.childcare?.toddlerSkillAvg(p) ?? 2.5,
      retire: (p) => {
        this.setCareer(p, null);
      },
      onStageChanged: (p, from, to) => {
        this.judge?.onStage(p, from, to);
        const cc = this.childcare;
        if (cc && to === 'child' && !p.education) {
          const head = this.persons.find((q) => q.household === p.household && (q.lifeStage === 'young' || q.lifeStage === 'adult' || q.lifeStage === 'elder'));
          cc.defaultEducation(p, head?.estate ?? p.estate);
        }
        if (cc && to === 'young') cc.onAdulthood(p);
        if (to === 'teen' || to === 'young') {
          // 아동 목표 → 성인 목표 (12-4)
          this.inner?.newAspiration(p, new Rng((this.seed * 31 + p.id * 17 + this.world.day()) >>> 0));
        }
        if (to === 'child' || to === 'teen') p.education = to === 'teen' ? null : p.education;
      },
    };
  }

  private pregnancyHost(rng: Rng): import('./family/pregnancy').PregnancyHost {
    const sim = this;
    const age = (q: Person) => (this.lifecycle ? this.lifecycle.displayAge(q) : this.judge?.age(q) ?? 30);
    return {
      get persons() {
        return sim.persons.filter((q) => !q.visitor);
      },
      rng,
      day: () => this.world.day(),
      minute: () => this.world.minute,
      lifespan: () => this.settings.lifespan,
      age,
      season: () => this.world.season,
      traitEffects: (id) => this.data.inner?.traits.traits[id]?.effects as Record<string, unknown> | undefined,
      controlled: (q) => q.household === 1,
      chooses: (q) => q.household === 1 && !!this.town,
      coitusToday: (w) => {
        if (w.lod !== 'full') return null;
        // 수태 판정은 자정(날이 바뀐 뒤)에 돌아 "오늘"은 방금 끝난 어제
        const e = this.coitus.get(w.id);
        return e && e.day >= this.world.day() - 1 ? e.n : 0;
      },
      hasWish: (q, id) => q.wishes.some((x) => x.id === id),
      addWish: (q, id) => {
        if (q.wishes.some((x) => x.id === id)) return;
        q.wishes.push({ id, kind: 'wish', since: this.world.minute, expiresAt: this.world.minute + 1440, locked: false });
      },
      moodlet: (q, id) => this.addEngineMoodlet(q, id),
      memory: (q, kind, importance, valence) => {
        q.memories.push({ kind, minute: this.world.minute, valence, importance, withPerson: 0, objectUid: 0 });
      },
      news: (kind, args, subjects) => this.townNews(kind, args, subjects),
      notice: (q, kind, args) => this.notice(q, kind, args),
      chronicle: (trigger, subjects) => {
        this.chronicleLog.push({ day: this.world.day(), trigger, subjects: subjects.map((x) => x.id) });
        if (this.chronicleLog.length > 500) this.chronicleLog.shift();
      },
      trauma: (q, source) => {
        q.counters.set(`trauma:${source}`, (q.counters.get(`trauma:${source}`) ?? 0) + 1);
      },
      kill: (q, cause) => this.killPerson(q, cause),
      birth: (m, f) => this.bornTo(m, f),
      baptismDue: (b) => {
        b.baptismDue = true;
      },
      householdSize: (hh) => this.persons.filter((q) => q.household === hh && !q.visitor).length,
      householdCap: () => this.childcare?.d.household.cap ?? 12,
      money: (q) => this.econ?.account(q.household)?.money ?? 1e9,
      spend: (q, amount, reason) => {
        const a = this.econ?.account(q.household);
        if (!a) return true;
        if (a.money < amount) return false;
        this.econ!.spend(a, amount, reason);
        return true;
      },
      isOnJourney: (q) => q.status === 'journey' || (!!q.career && q.hidden && this.data.careers?.[q.career.id]?.type === 'journey'),
      isInScene: (q) => q.status === 'scene',
      interruptScene: (q) => {
        if (q.status === 'scene') q.status = 'available';
      },
      offerCard: (id, cardId, vars) => {
        const q = this.persons.find((x) => x.id === id);
        if (!q) return false;
        this.offerCard(q, cardId, vars);
        return q.household === 1;
      },
      letter: (to, kind, args) => {
        this.letterLog.push({ day: this.world.day(), to: to.id, kind, args });
        if (this.letterLog.length > 200) this.letterLog.shift();
        this.notice(to, 'letter', { kind: `letter.kind.${kind}`, ...args });
      },
      deathRules: () => this.deathRules ?? { preset: 'realistic', allows: () => true, subChance: () => 1, fallback: () => null, group: (st: LifeStage, a?: number) => ((a ?? 30) < 18 ? 'child' : st === 'elder' ? 'elder' : 'adult') },
      // 농노 부역일 (16-2 주 1일): 수요일. M8 영지 체계에서 영주별 날로
      isCorveeDay: (q) => q.estate === 'serf' && this.world.day() % 7 === 2,
      corveeExempt: (q, delta) => {
        this.lordFavor.set(q.household, (this.lordFavor.get(q.household) ?? 0) + delta);
      },
      isQuarantined: () => false,
      infectionRoll: () => {},
      midwife: () => {
        const healer = this.persons.find((q) => q.career?.id === 'healer' && q.status === 'available');
        const skill = healer && this.skills ? this.skills.level(healer, 'medicine') : 3;
        return { person: healer ?? null, skill: Math.max(3, skill), fee: 48 };
      },
      healerPresent: (q) => this.persons.some((x) => x !== q && x.career?.id === 'healer' && Math.abs(x.x - q.x) < 8 && Math.abs(x.y - q.y) < 8),
      record: () => {},
    };
  }

  /**
   * 친척 도움 (17-9): 이 가정 식구와 우정이 kin.minFriendship 이상인 친척(가족 관계 표시, 부모·자식·형제)이 사는 다른 가정 중
   * 가장 넉넉한 곳이 저축의 kin.maxShare 까지 보탬 (필요한 만큼만). 한 친척 가정은 7일에 한 번
   */
  private kinHelpAt = new Map<number, number>();
  private kinRelief(household: number, need: number): boolean {
    const e = this.econ;
    const K = (this.data.economy as { relief?: { kin?: { minFriendship: number; maxShare: number } } } | null)?.relief?.kin;
    if (!e || !K) return false;
    const me = e.account(household);
    if (!me) return false;
    const members = this.persons.filter((q) => q.household === household);
    const day = this.world.day();
    let best: { hh: number; money: number } | null = null;
    for (const q of this.persons) {
      if (q.household === household || q.visitor) continue;
      if ((this.kinHelpAt.get(q.household) ?? -99) > day - 7) continue;
      const kin = members.some((m) => {
        const related = m.mother === q.id || m.father === q.id || q.mother === m.id || q.father === m.id || (m.mother && m.mother === q.mother) || !!this.rel.get(m.id, q.id)?.flags.has('family');
        return related && this.rel.friendship(m.id, q.id) >= K.minFriendship;
      });
      if (!kin) continue;
      const acct = e.account(q.household);
      if (!acct || acct.money <= 0) continue;
      if (!best || acct.money > best.money) best = { hh: q.household, money: acct.money };
    }
    if (!best) return false;
    const give = Math.min(need, Math.floor(best.money * K.maxShare));
    if (give <= 0) return false;
    e.spend(e.account(best.hh)!, give, 'kin_help');
    e.earn(me, give, 'kin_help', false);
    this.kinHelpAt.set(best.hh, day);
    const host = members[0];
    if (host) this.notice(host, 'relief_kin', { n: give });
    return true;
  }

  /**
   * 소원·카드 조건용 가족 상태 플래그 (wishes_m7/events family_society): 이 사람 기준. 아직 없는 체계(M8 가보·하인, M9 재판)는 들어가지 않음
   */
  familyFlags(p: Person): ReadonlySet<string> {
    const f = new Set<string>();
    const kids = this.persons.filter((q) => q.mother === p.id || q.father === p.id);
    if (kids.some((k) => k.lifeStage === 'baby')) f.add('has_baby');
    if (kids.some((k) => k.lifeStage === 'toddler')) f.add('has_toddler');
    if (kids.length) f.add('has_child');
    if (kids.some((k) => k.lifeStage === 'child')) f.add('has_school_child');
    if (kids.some((k) => k.lifeStage === 'teen')) f.add('has_teen');
    if (kids.some((k) => k.lifeStage === 'young' && !k.spouse)) f.add('child_of_age');
    if (kids.some((k) => k.betrothed)) f.add('child_engaged');
    const sp = p.spouse ? this.persons.find((q) => q.id === p.spouse) : undefined;
    if (sp?.pregnancy) f.add('spouse_pregnant');
    if (p.betrothed) f.add('engaged');
    const day = this.world.day();
    if (this.persons.some((q) => q.household === p.household && q.lastBirthdayDay === day)) f.add('family_birthday_today');
    if (this.persons.some((q) => q.household === p.household && q.birthdayDay >= 0)) f.add('birthday_soon');
    if ((this.skills?.level(p, 'reading') ?? 0) >= 1) f.add('can_read');
    const head = this.persons.filter((q) => q.household === p.household && !q.infant).sort((a, b) => (b.lifeStage === 'elder' ? 0 : 1) - (a.lifeStage === 'elder' ? 0 : 1) || a.id - b.id)[0];
    if (head === p) f.add('head_of_house');
    if (p.estate === 'serf') f.add('no_family_name');
    return f;
  }

  private parentBond(p: Person): number {
    const ps = this.persons.filter((q) => q.id === p.mother || q.id === p.father);
    if (!ps.length) return 50;
    return ps.reduce((a, q) => a + Math.max(0, this.rel.friendship(p.id, q.id)), 0) / ps.length;
  }

  private childcareHost(rng: Rng): import('./family/childcare').ChildcareHost {
    const sim = this;
    return {
      get persons() {
        return sim.persons;
      },
      rng,
      minute: () => this.world.minute,
      hour: () => this.world.hour(),
      day: () => this.world.day(),
      weekday: () => this.world.day() % 7,
      slabRows: () => this.world.lot.h + 1,
      moodlet: (p, id) => this.addEngineMoodlet(p, id),
      memory: (p, kind, importance, valence, withPerson) => {
        p.memories.push({ kind, minute: this.world.minute, valence, importance, withPerson, objectUid: 0 });
        if (p.memories.length > 200) p.memories.sort((a, b) => b.importance - a.importance).length = 200;
      },
      notice: (p, kind, args) => this.notice(p, kind, args),
      news: (kind, args, subjects) => this.townNews(kind, args, subjects),
      kill: (p, cause) => {
        if (!this.pendingDeaths.some((d) => d.p === p)) this.pendingDeaths.push({ p, cause });
      },
      deathAllowed: (cause, p) => this.deathAllowed(cause, p),
      feltTemp: (p) => this.feltTemp(p),
      objectsNear: (p, r) => {
        const out: { uid: number; defId: string; x: number; y: number; lit: boolean }[] = [];
        const H1 = this.world.lot.h + 1;
        for (const o of this.world.objectsNear(p.x, p.y, r + 2, this.nearTmp)) {
          if (Math.floor(o.y / H1) !== Math.floor(p.y / H1)) continue;
          const def = this.world.def(o.defId);
          const kind = (def as { kind?: string }).kind ?? o.defId;
          const cx = o.x + def.footprint.w / 2;
          const cy = o.y + def.footprint.h / 2;
          if (Math.abs(cx - p.x) > r + def.footprint.w / 2 || Math.abs(cy - p.y) > r + def.footprint.h / 2) continue;
          out.push({ uid: o.uid, defId: kind, x: o.x, y: o.y, lit: !!o.state.lit });
        }
        return out;
      },
      freeCradle: (p) => this.freeCradle(p),
      cradleSpot: (uid) => {
        const o = this.world.byUid.get(uid);
        return o ? { x: o.x + 0.5, y: o.y + 0.5 } : null;
      },
      skillXp: (p, skill, minutes) => {
        if (!this.skills || !this.skills.d.skills[skill]) return;
        const up = this.skills.gain(p, skill, minutes, null, 0, 1, this.childcare?.xpMult(p) ?? 1);
        if (up !== null) this.notice(p, 'skill_up', { skill: `skill.${skill}`, level: up });
      },
      spend: (hh, amount, kind) => {
        const a = this.econ?.account(hh);
        if (!a) return true;
        if (a.money < amount) return false;
        this.econ!.spend(a, amount, kind);
        return true;
      },
      fame: (hh, delta, reason) => this.addFame(hh, delta, reason),
      church: (p, delta) => {
        p.churchRep = Math.max(-100, Math.min(100, p.churchRep + delta));
      },
      moveChild: (child, hh, reason) => {
        const lot = this.persons.find((q) => q.household === hh)?.homeLot ?? null;
        this.moveHousehold(child, hh, lot);
        if (child.infant && (hh === 1 || !this.town)) this.showInfant(child);
        else if (child.infant) {
          this.childcare?.putDown(child);
          child.babyPlace = null;
          child.hidden = true;
          child.lod = 'summary';
        }
        this.townNews(`child_moved_${reason}`, { a: child.name }, [child]);
      },
      churchHousehold: () => {
        const t = this.town;
        if (!t) return -1;
        for (const [hh, pl] of t.householdResidence) if (pl === 'monastery' || pl === 'church') return hh;
        return -1;
      },
      wake: (p, moodlet) => {
        if (p.action && p.sleeping) this.abortAction(p, 'woken');
        p.sleeping = false;
        this.addEngineMoodlet(p, moodlet);
      },
      setCareer: (p, id) => this.setCareer(p, id).ok,
      parentBond: (p) => this.parentBond(p),
      createChild: (stage, estate, hh) => this.createChild(stage as LifeStage, estate, hh),
      householdSize: (hh) => this.persons.filter((q) => q.household === hh && !q.visitor).length,
      offerCard: (p, cardId, vars) => this.offerCard(p, cardId, vars),
    };
  }
  private readonly nearTmp: ObjectInstance[] = [];

  /** 집 안의 빈 요람 (아기가 누워 있지 않은 것): 같은 가구 부지 (한 부지 모드는 어디든) */
  private freeCradle(p: Person): number {
    const cc = this.childcare;
    if (!cc) return -1;
    const kinds = cc.d.baby.cradleObjects;
    const used = new Set<number>();
    for (const q of this.persons) if (q.babyPlace?.kind === 'cradle') used.add(q.babyPlace.uid);
    const t = this.town;
    const lot = t && p.homeLot ? t.lots.find((l) => l.id === p.homeLot) : null;
    const H1 = this.world.lot.h + 1;
    let best = -1;
    let bestD = Infinity;
    for (const o of this.world.objects) {
      const kind = (this.world.def(o.defId) as { kind?: string }).kind ?? o.defId;
      if (!kinds.includes(kind) && !kinds.includes(o.defId)) continue;
      if (used.has(o.uid)) continue;
      if (t && lot) {
        const ly = o.y % H1;
        if (o.x < lot.rect[0] || o.x > lot.rect[2] || ly < lot.rect[1] || ly > lot.rect[3]) continue;
      } else if (t) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = o.uid;
      }
    }
    return best;
  }

  /** 사망 설정 행렬 (20-7) 조회: 모듈이 있으면 그것, 없으면 전부 켬 (현실적 기본) */
  deathAllowed(cause: string, p: Person): boolean {
    const dr = this.deathRules;
    if (!dr) return true;
    const c = cause === 'starvation' ? 'hunger' : cause === 'cold_hunger' ? 'cold' : cause;
    return dr.allows(c, this.ageGroup(p));
  }

  /** 사망 설정 나이 그룹: 아이(18세 전) / 어른 / 노인 */
  ageGroup(p: Person): 'child' | 'adult' | 'elder' {
    const age = this.lifecycle ? this.lifecycle.displayAge(p) : this.judge?.age(p) ?? 30;
    return age < 18 ? 'child' : p.lifeStage === 'elder' ? 'elder' : 'adult';
  }

  /** 사망 설정 행렬 (20-7, health/deathRules.ts). 데이터가 없으면 null (모든 칸 켬) */
  deathRules: DeathRules | null = null;
  /** 임신·출산 (15-1, 15-2, family/pregnancy.ts). 데이터가 없으면 판정기 기본 시스템 (story.json) */
  pregnancy: PregnancySystem | null = null;
  /** 오늘 동침 성공 (여자 id → 날, 횟수): 수태 판정 입력 (15-1) */
  private coitus = new Map<number, { day: number; n: number }>();
  /** 영주 호의 (가구, M8 영지 체계 전 누적), 연대기 삽화 기록 (M14 전), 편지 기록 (M9 전) */
  readonly lordFavor = new Map<number, number>();
  readonly chronicleLog: { day: number; trigger: string; subjects: number[] }[] = [];
  readonly letterLog: { day: number; to: number; kind: string; args: Record<string, string | number> }[] = [];

  /** 가문 명성 (16-4, M8 명예 체계 전에는 가구별 누적) */
  readonly fame = new Map<number, number>();
  private addFame(household: number, delta: number, reason: string, by: Person | null = null): void {
    if (this.house) {
      this.house.fame(household, delta, reason, by);
      return;
    }
    this.fame.set(household, (this.fame.get(household) ?? 0) + delta);
    const head = this.persons.find((q) => q.household === household);
    if (head && household === 1) this.notice(head, delta >= 0 ? 'fame_up' : 'fame_down', { n: Math.abs(delta), reason: `fame.reason.${reason}` });
  }

  /** 가문과 신분 연결 (M8, houseLink.ts) */
  house: HouseLink | null = null;
  /** 사건 카드 (24-1 최소 엔진, story/cards.ts): 카드 데이터가 없으면 알림 + 기록만 */
  cards: Cards | null = null;
  readonly cardLog: { day: number; personId: number; cardId: string; vars: Record<string, string | number> }[] = [];
  /** 가문(가구) 상태 플래그 (카드 결과 flag: has_feud, affair …) */
  readonly householdFlags = new Map<number, Set<string>>();
  offerCard(p: Person, cardId: string, vars: Record<string, string | number> = {}, other: Person | null = null): void {
    this.cardLog.push({ day: this.world.day(), personId: p.id, cardId, vars });
    if (this.cardLog.length > 200) this.cardLog.shift();
    if (this.cards?.defs.has(cardId)) {
      this.cards.offer(p, cardId, vars, other, true);
      return;
    }
    if (p.household === 1) this.notice(p, 'card', { card: cardId, ...vars });
  }

  private cardsHost(rng: Rng): import('./story/cards').CardsHost {
    const sim = this;
    const S = (q: Person): number => {
      const est = (this.data.economy as { estates?: Record<string, { target?: { net?: number } }> } | null)?.estates?.[q.estate];
      // 한 인생 저축 S = 일 순수입 × 48일 × 수명 배수 (17-4), 파딩
      return Math.round((est?.target?.net ?? 6 * 4) * 48 * this.settings.lifespan);
    };
    return {
      get persons() {
        return sim.persons;
      },
      rng,
      minute: () => this.world.minute,
      day: () => this.world.day(),
      season: () => this.world.season,
      controlled: (q) => q.household === 1,
      flags: (q) => {
        const f = new Set(this.familyFlags(q));
        for (const x of this.householdFlags.get(q.household) ?? []) f.add(x);
        if (this.house) for (const x of this.house.flags(q)) f.add(x);
        return f;
      },
      fame: (q) => (this.house ? this.house.fameOf(q.household) : 300 + (this.fame.get(q.household) ?? 0)),
      money: (q) => this.econ?.account(q.household)?.money ?? 0,
      savingsS: S,
      skillLevel: (q, sk) => this.skills?.level(q, sk) ?? 0,
      moodlet: (q, id) => this.addEngineMoodlet(q, id),
      addMoney: (q, amount, reason) => {
        const a = this.econ?.account(q.household);
        if (!a) return;
        if (amount >= 0) this.econ!.earn(a, amount, reason, false);
        else this.econ!.spend(a, -amount, reason);
      },
      reputation: (q, d, reason) => {
        if (this.house) {
          this.house.house.honor.applyFor(q, d, reason);
          if (d.fame && q.household === 1) this.notice(q, d.fame >= 0 ? 'fame_up' : 'fame_down', { n: Math.abs(d.fame), reason: `fame.reason.${reason}` });
          return;
        }
        if (d.fame) this.addFame(q.household, d.fame, reason);
        if (d.church) q.churchRep = Math.max(-100, Math.min(100, q.churchRep + d.church));
        if (d.karma) q.karma = Math.max(-100, Math.min(100, q.karma + d.karma));
        if (d.honor) q.honor = Math.max(-500, Math.min(500, q.honor + d.honor));
      },
      relation: (a, b, d) => {
        this.rel.change(a.id, b.id, { friendship: d.friendship ?? 0, romance: d.romance ?? 0 }, this.world.day());
        if (d.respect) this.rel.addRespect(b.id, a.id, d.respect);
      },
      memory: (q, kind, importance, valence, withPerson) => {
        q.memories.push({ kind, minute: this.world.minute, valence, importance, withPerson, objectUid: 0 });
      },
      rumor: (subject, kind, good, strength) => {
        if (!this.rumors) return;
        const fam = this.persons.filter((x) => x.household === subject.household);
        this.rumors.add(kind, [subject], { a: subject.name }, this.world.day(), strength, fam, { good });
      },
      chronicle: (trigger, subjects) => {
        this.chronicleLog.push({ day: this.world.day(), trigger, subjects: subjects.map((x) => x.id) });
      },
      heirloom: (q, what) => this.heirloomEvent(q, what),
      setFlag: (q, flag) => {
        const set = this.householdFlags.get(q.household) ?? new Set<string>();
        set.add(flag);
        this.householdFlags.set(q.household, set);
      },
      notice: (q, kind, args) => this.notice(q, kind, args),
    };
  }

  /** 가보 사건 훅 (16-5): M8 가보 모듈 연결 전에는 기록만 */
  heirloomEvent(p: Person, what: 'damage' | 'lose' | 'recover'): void {
    if (this.house && this.house.house.heirlooms.cardOutcome(p, what) > 0) return;
    this.chronicleLog.push({ day: this.world.day(), trigger: `heirloom_${what}`, subjects: [p.id] });
  }

  /**
   * 캐릭터 만들기 결과를 조작 가문으로 (10-1): 사양 검증(8명, 관계, 4촌 혼인, 나이) → 기존 조작 가문 식구를 내보내고
   * 사양대로 인물을 만듦 (유전자·외형·걸음·특성·생애 단계), 관계(부모·배우자·형제·조부모·사촌)는 관계와 가족 표시로.
   * 결과 {ok, issues, ids}
   */
  private createFamily(spec: FamilySpec): { ok: boolean; issues?: string[]; ids?: number[] } {
    const g = this.genetics;
    if (!g) return { ok: false, issues: ['no_genetics'] };
    const issues = validateFamily(g, spec).filter((i) => (i as { severity?: string }).severity !== 'warning');
    if (issues.length) return { ok: false, issues: issues.map((i) => i.code) };
    // 기존 조작 가문은 먼 곳으로 떠남 (마을에서 사라짐, 기록은 남음)
    for (const q of this.persons.filter((x) => x.household === 1)) this.killPerson(q, 'moved_away');
    const home = this.town?.playerLot();
    const spawnX = this.data.lot.spawn.x + 0.5;
    const spawnY = this.data.lot.spawn.y + 0.5;
    const byKey = new Map<string, Person>();
    const coarse = (st: LifeStage): Person['stage'] => (st === 'baby' || st === 'toddler' || st === 'child' ? 'child' : st === 'teen' ? 'teen' : st === 'elder' ? 'elder' : 'adult');
    for (const m of spec.members) {
      const cell = home ? this.town!.targetCell({ household: 1, homeLot: home.id } as Person, 'home') : -1;
      const gw = this.world.grid.w;
      const x = cell >= 0 ? (cell % gw) + 0.5 : spawnX;
      const y = cell >= 0 ? Math.floor(cell / gw) + 0.5 : spawnY;
      const rt = memberRuntime(g, m);
      const p = this.addPerson(m.name, x, y, { estate: m.estate, sex: m.sex, stage: coarse(m.stage), household: 1, traits: m.traits.length ? m.traits : undefined });
      p.lifeStage = m.stage;
      p.ageDays = 0;
      p.genome = m.genome;
      p.gait = m.gait;
      p.homeLot = home?.id ?? null;
      p.appearance = { ...rt.appearance, genome: true };
      const congenital = new Set(Object.entries(this.data.inner?.traits.traits ?? {}).filter(([, t]) => t.category === 'congenital').map(([id]) => id));
      p.traits = [...p.traits.filter((t) => !congenital.has(t)), ...rt.congenital.filter((t) => congenital.has(t))];
      this.coarseStage(p);
      if (p.infant) {
        this.lifecycle?.newborn(p);
        p.wishes = [];
        p.aspiration = null;
      }
      byKey.set(m.key, p);
    }
    for (const r of spec.relations) {
      const a = byKey.get(r.a);
      const b = byKey.get(r.b);
      if (!a || !b) continue;
      const rel = this.rel.ensure(a.id, b.id);
      rel.met = true;
      if (r.kind === 'spouse') {
        a.spouse = b.id;
        b.spouse = a.id;
        a.marriedDay = b.marriedDay = this.world.day();
        rel.flags.add('spouse');
        rel.friendship = Math.max(rel.friendship, 50);
        rel.romance = Math.max(rel.romance, 45);
      } else {
        rel.flags.add('family');
        rel.friendship = Math.max(rel.friendship, 40);
        if (r.kind === 'parent') {
          if (a.sex === 'female') b.mother = a.id;
          else b.father = a.id;
        }
      }
    }
    for (const a of byKey.values()) for (const b of byKey.values()) if (a.id < b.id) this.rel.ensure(a.id, b.id).met = true;
    for (const p of byKey.values()) if (p.infant) this.showInfant(p);
    this.econ?.account(1) ?? this.econ?.openAccount(1, spec.estate as never, this.wealth);
    return { ok: true, ids: [...byKey.values()].map((p) => p.id) };
  }

  /** 새 아이 (입양·이주): 단계·신분·가구, 유전자 무작위 */
  private createChild(stage: LifeStage, estate: string, household: number): Person | null {
    const rng = new Rng((this.seed * 104729 + this.world.minute * 31 + household * 7 + ++this.birthSeq * 131) >>> 0);
    const sex: 'male' | 'female' = rng.next() < 0.5 ? 'male' : 'female';
    const coarse: Person['stage'] = stage === 'teen' ? 'teen' : 'child';
    const host = this.persons.find((q) => q.household === household);
    const name = this.newName(sex, estate, household, rng);
    const p = this.addPerson(name, host?.x, host?.y, { estate, sex, stage: coarse, household });
    p.lifeStage = stage;
    p.ageDays = 0;
    p.homeLot = host?.homeLot ?? null;
    this.giveGenome(p, null, null, rng);
    this.coarseStage(p);
    // 아기·유아는 기질만 (12-1), 아동은 특성 1칸
    if (p.infant) {
      this.lifecycle?.newborn(p);
      p.wishes = [];
      p.aspiration = null;
      this.showInfant(p);
    }
    for (const q of this.persons) {
      if (q === p || q.household !== household) continue;
      const r = this.rel.ensure(p.id, q.id);
      r.met = true;
      r.flags.add('family');
    }
    return p;
  }

  worldHash(): string {
    const parts: (string | number)[] = [this.world.minute, this.rng.state];
    for (const p of this.persons) {
      parts.push(p.x.toFixed(4), p.y.toFixed(4), ...Array.from(p.needs, (v) => v.toFixed(4)), p.queue.length, p.action?.item.interactionId ?? '-');
      parts.push(p.pose, p.action?.phase ?? '-', p.action?.stepIndex ?? -1, p.action?.slotId ?? '-', p.status, p.carry ?? '-');
      parts.push(p.id, p.estate, p.stage, p.household, p.emotion, p.emotionStage, p.stress.toFixed(3), p.happiness.toFixed(3), p.traits.join(','));
      for (const m of p.moodlets) parts.push(m.id, m.strength);
      for (const wi of p.wishes) parts.push(wi.id);
    }
    for (const [uid, m] of this.world.reservations) for (const [slot, pid] of m) parts.push(`r${uid}:${slot}:${pid}`);
    for (const o of this.world.objects) parts.push(o.uid, JSON.stringify(o.state));
    for (const k of Object.keys(this.world.stock).sort()) parts.push(k, this.world.stock[k]);
    for (const p of this.persons) {
      parts.push(p.engagedWith, p.chatWith, p.action?.topic ?? '-', p.idleUntil, p.recentObjects.join(','));
      if (p.visitor) parts.push(p.visitor.neighborId, p.visitor.leaveAt, p.visitor.greetUntil, p.visitor.leaving ? 1 : 0, p.visitor.saidBye ? 1 : 0);
    }
    for (const v of this.pendingVisits) parts.push(`v${v.neighborId}:${v.at}:${v.host}`);
    for (const k of [...this.away.keys()].sort()) {
      const q = this.away.get(k)!;
      parts.push(`a${k}:${q.id}`, ...Array.from(q.needs, (v) => v.toFixed(3)), q.stress.toFixed(3));
    }
    parts.push(this.shop.open ? 1 : 0, this.shop.priceMult, this.shop.reputation.toFixed(3), this.shop.sales);
    for (const p of this.persons) {
      for (const k of Object.keys(p.skills).sort()) parts.push(k, p.skills[k], (p.skillXp[k] ?? 0).toFixed(3));
      if (p.career) parts.push(JSON.stringify(p.career));
      if (p.careerEvent) parts.push(p.careerEvent.eventId, p.careerEvent.since);
    }
    for (const k of Object.keys(this.world.quality).sort()) parts.push(k, this.world.quality[k].toFixed(4));
    for (const k of [...this.world.batches.keys()].sort()) for (const b of this.world.batches.get(k)!) parts.push(k, b.qty, b.day);
    // M7 생애와 가족: 단계·나이·생일·아기 자리·임신·학교·아이 기술·직접 조작
    for (const p of this.persons) {
      parts.push(p.lifeStage, p.ageDays, p.birthdayDay, p.birthdayDelayed, p.babyPlace ? `${p.babyPlace.kind}:${'uid' in p.babyPlace ? p.babyPlace.uid : 'by' in p.babyPlace ? p.babyPlace.by : 0}` : '-', p.holding);
      parts.push(p.pregnancy ? `${p.pregnancy.stage}:${p.pregnancy.since}` : '-', p.schoolAway ? 1 : 0, p.sneakUntil, p.crying ? 1 : 0, p.hungerZeroMinutes);
      for (const k of Object.keys(p.childSkills).sort()) parts.push(k, p.childSkills[k], (p.childSkillXp[k] ?? 0).toFixed(3));
      if (p.direct) parts.push(`d${p.direct.dx},${p.direct.dy}`);
    }
    this.rumors?.hashParts(parts);
    this.house?.hashParts(parts);
    this.rel.hashParts(parts);
    this.econ?.hashParts(parts);
    let h = 0x811c9dc5;
    const str = parts.join('|');
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  actionOf(p: Person): { interactionId: string; targetUid: number; stepObj: number; phase: string; remaining: number } | null {
    const a = p.action;
    if (!a) return null;
    return { interactionId: a.item.interactionId, targetUid: a.item.targetUid, stepObj: a.stepObj, phase: a.phase, remaining: a.remaining };
  }

  feltTemp(p: Person): number {
    let felt = this.world.temperatureAt(p.x, p.y);
    const wm = this.data.needs.warmth;
    if (this.world.nearLitHearth(p.x, p.y, wm.nearHearthTiles)) felt += wm.nearHearthBonusC;
    return felt;
  }

  objectById(uid: number): ObjectInstance | undefined {
    return this.world.byUid.get(uid);
  }
}

/** 의도 객체 복사 (로그가 호출자 객체 변경에 흔들리지 않게). 워커/Node 모두 structuredClone 있음 */
function structuredCloneSafe<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
}
