/**
 * "첫 하루" 튜토리얼 판정 (GDD 27-4). DOM 없이 스냅샷만 읽는 순수 함수 → 유닛 테스트 대상.
 * 흐름: 기상 → 원형 메뉴 → 대기열 → 욕구 → (부엌 놓기) → (불 피우기) → 먹을 것 만들기 → 먹기 → 이웃과 대화 → 잠 → 하루 정산 → 신분별 첫 과제
 * 각 단계 완료는 실제 게임 상태(스냅샷 + 화면 상태)에서 감지. 집에 해당 물건이 없으면 건너뛰거나 대체
 * (요리할 곳이 없으면 구매 모드에서 화로 놓기, 살 돈도 없으면 요리를 건너뛰고 있는 음식 먹기).
 */
import interactionsData from '../data/interactions.json';
import townInteractions from '../data/interactions_town.json';
import socialData from '../data/social.json';
import recipesData from '../data/recipes.json';
import careersData from '../data/careers.json';
import buildData from '../data/build.json';
import type { ObjectSnap, PersonSnap, Snapshot } from '../sim/protocol';

export const FIRST_DAY = ['wake', 'pie', 'queue', 'needs', 'kitchen', 'fire', 'cook', 'eat', 'talk', 'sleep', 'summary', 'goal', 'done'] as const;
export type StepId = (typeof FIRST_DAY)[number];

/** 처음 마주칠 때 한 번 (27-4 둘째 줄, M9까지 있는 시스템) */
export const ONCE = ['build', 'card', 'pregnancy', 'trial', 'rumor', 'letter'] as const;
export type OnceId = (typeof ONCE)[number];

export type GoalKind = 'till' | 'farm' | 'order' | 'shop' | 'mass' | 'attend' | 'drill' | 'petition' | 'plead' | 'daywork' | 'work';
export const GOAL_KINDS: GoalKind[] = ['till', 'farm', 'order', 'shop', 'mass', 'attend', 'drill', 'petition', 'plead', 'daywork', 'work'];

/** 화면 쪽 상태 (게임 객체에서 읽어 넘김) */
export interface UiView {
  selectedId: number;
  pieOpen: boolean;
  popup: string | null;
  bookOpen: boolean;
  buildMode: string | undefined;
  dialogOpen: boolean;
  /** 대기열 아이콘을 눌러 취소한 횟수 (누적) */
  cancels: number;
}

/** 집 물건 판정용 (물건 정의의 종류·태그) */
export type DefOf = (defId: string) => { kind?: string; tags?: string[]; price?: number } | undefined;
/** 우리 집 부지 [x0, y0, x1, y1] (칸, 끝 포함). null = 부지 전체 */
export type HomeRect = [number, number, number, number] | null;

type IaDef = { objects?: string[]; tags?: string[]; requires?: Record<string, unknown> };
const IAS: Record<string, IaDef> = {
  ...(interactionsData as { interactions: Record<string, IaDef> }).interactions,
  ...(townInteractions as { interactions: Record<string, IaDef> }).interactions,
};
type Recipe = { station: string; group?: string; inputs: Record<string, number>; outputs: Record<string, number>; level: number; skill: string; nameKey: string; fuel?: Record<string, number>; wait?: unknown };
const RECIPES: Record<string, Recipe> = Object.fromEntries(Object.entries((recipesData as unknown as { recipes: Record<string, Recipe> }).recipes).filter(([k]) => !k.startsWith('$')));
const CAREERS = (careersData as unknown as { careers: Record<string, { type?: string; orders?: unknown }> }).careers;
export const SOCIAL = new Set(Object.keys((socialData as { interactions: Record<string, unknown> }).interactions));

/** 먹을 것 만들기로 치는 상호작용 (요리·빵 굽기 태그, 요리/굽기 레시피) */
export function isCook(ia: string): boolean {
  if (ia.startsWith('recipe.')) {
    const r = RECIPES[ia.slice(7)];
    return !!r && (r.group === 'cooking' || r.group === 'baking') && Object.keys(r.outputs).length > 0 && r.station !== 'mill';
  }
  const tags = IAS[ia]?.tags ?? [];
  return tags.includes('cook') || tags.includes('bake');
}

/** 먹기로 치는 상호작용 (eat_good / eat_plain 태그 = sim 식사 판정과 같음) */
export function isEat(ia: string): boolean {
  const tags = IAS[ia]?.tags ?? [];
  if (tags.includes('eat_good') || tags.includes('eat_plain')) return true;
  return /(^|\.)(eat|snack)/.test(ia) && !ia.startsWith('recipe.');
}

// ------------------------------------------------------------------ 집 물건

export function inHome(o: { x: number; y: number }, home: HomeRect): boolean {
  if (!home) return true;
  return o.x >= home[0] && o.x <= home[2] && o.y >= home[1] && o.y <= home[3];
}

export function kindOf(defId: string, defOf: DefOf): string {
  return defOf(defId)?.kind ?? defId;
}

function hasTag(o: ObjectSnap, tag: string, defOf: DefOf): boolean {
  return kindOf(o.defId, defOf) === tag || o.defId === tag || (defOf(o.defId)?.tags ?? []).includes(tag);
}

export function homeObjects(s: Snapshot, home: HomeRect): ObjectSnap[] {
  return s.objects.filter((o) => inHome(o, home));
}

/** 식구 (조작 가문, 방문객 제외) */
export function family(s: Snapshot): PersonSnap[] {
  return s.persons.filter((p) => p.household === 1 && !p.visitor);
}

export function grownUps(s: Snapshot): PersonSnap[] {
  return family(s).filter((p) => p.lifeStage !== 'baby' && p.lifeStage !== 'toddler');
}

// ------------------------------------------------------------------ 먹을 것 만들기 (그 집에서 실제로 되는 요리)

export interface CookPlan {
  /** 상호작용 id */
  ia: string;
  /** 요리 이름 키 (i18n) */
  nameKey: string;
  /** 문구 종류: bread 빵 굽기, stew 화로 스튜, dish 그 밖의 요리 */
  kind: 'bread' | 'stew' | 'dish';
  /** 화로에 불부터 피워야 함 */
  needFire: boolean;
}

function haveStock(stock: Record<string, number>, need: Record<string, number>): boolean {
  return Object.entries(need).every(([k, n]) => (stock[k] ?? 0) >= n);
}

/**
 * 이 집에서 지금 되는 먹을 것 만들기 하나. 빵 굽기(오븐) → 조리대 빵 → 화로 스튜 → 화로 레시피(죽, 포타주 …) 순.
 * 되는 게 없으면 null (단계를 건너뜀)
 */
export function pickCook(s: Snapshot, home: HomeRect, defOf: DefOf, skillOf: (skill: string) => number = () => 0): CookPlan | null {
  const objs = homeObjects(s, home);
  const stock = s.stock ?? {};
  const hearths = objs.filter((o) => hasTag(o, 'hearth', defOf));
  const lit = hearths.some((o) => !!o.state.lit);
  const canFire = lit || (hearths.length > 0 && (stock.firewood ?? 0) >= 1);
  const has = (tag: string) => objs.some((o) => hasTag(o, tag, defOf));
  const bread = RECIPES.bake_bread;
  if (bread && has(bread.station) && haveStock(stock, { ...bread.inputs, ...(bread.fuel ?? {}) }) && bread.level <= skillOf(bread.skill)) {
    return { ia: 'recipe.bake_bread', nameKey: bread.nameKey, kind: 'bread', needFire: false };
  }
  if (has('prep_counter') && (stock.flour ?? 0) >= 2 && canFire) {
    return { ia: 'counter.bake_bread', nameKey: 'item.bread', kind: 'bread', needFire: !lit };
  }
  const stewHearth = hearths.find((o) => !Number(o.state.servings ?? 0));
  if (stewHearth && (stock.ingredients ?? 0) >= 2 && canFire) {
    return { ia: 'hearth.cook_stew', nameKey: 'item.stew', kind: 'stew', needFire: !lit };
  }
  for (const [rid, r] of Object.entries(RECIPES)) {
    if (r.group !== 'cooking' || r.wait || r.level > skillOf(r.skill) || !Object.keys(r.outputs).length) continue;
    if (!has(r.station) || !haveStock(stock, { ...r.inputs, ...(r.fuel ?? {}) })) continue;
    return { ia: `recipe.${rid}`, nameKey: `item.${Object.keys(r.outputs)[0]}`, kind: 'dish', needFire: false };
  }
  return null;
}

/** 요리할 곳 (화로 · 오븐) */
export function hasKitchen(s: Snapshot, home: HomeRect, defOf: DefOf): boolean {
  return homeObjects(s, home).some((o) => hasTag(o, 'hearth', defOf) || hasTag(o, 'oven', defOf));
}

/** 구매 모드 화로 값 (build.json basePrices) */
export const HEARTH_PRICE = (buildData as unknown as { basePrices?: Record<string, number> }).basePrices?.hearth ?? 240;

/** 먹을 것이 있나 (만들 게 없어도 이미 있는 음식) */
export function foodAvailable(s: Snapshot, home: HomeRect, defOf: DefOf): boolean {
  const st = s.stock ?? {};
  if ((st.bread ?? 0) > 0 || (st.ingredients ?? 0) > 0) return true;
  return homeObjects(s, home).some((o) => hasTag(o, 'hearth', defOf) && Number(o.state.servings ?? 0) > 0);
}

// ------------------------------------------------------------------ 행동 추적 (시작 → 끝을 스냅샷에서)

/** 식구마다 지금 하는 상호작용을 따라가며, 실제로 수행 단계까지 간 것과 끝난 것을 모음 */
export class ActTracker {
  private cur = new Map<number, { ia: string; performed: boolean }>();
  performed = new Set<string>();
  finished = new Set<string>();

  reset(): void {
    this.performed.clear();
    this.finished.clear();
  }

  update(s: Snapshot): void {
    const seen = new Set<number>();
    for (const p of family(s)) {
      seen.add(p.id);
      const a = p.action;
      const prev = this.cur.get(p.id);
      if (prev && (!a || a.interactionId !== prev.ia)) {
        if (prev.performed) this.finished.add(prev.ia);
        this.cur.delete(p.id);
      }
      if (!a) continue;
      const c = this.cur.get(p.id) ?? { ia: a.interactionId, performed: false };
      if (a.phase === 'perform') {
        c.performed = true;
        this.performed.add(a.interactionId);
      }
      this.cur.set(p.id, c);
    }
    for (const [id, c] of [...this.cur]) {
      if (seen.has(id)) continue;
      if (c.performed) this.finished.add(c.ia);
      this.cur.delete(id);
    }
  }

  didFinish(test: (ia: string) => boolean): boolean {
    for (const ia of this.finished) if (test(ia)) return true;
    return false;
  }

  didPerform(test: (ia: string) => boolean): boolean {
    for (const ia of this.performed) if (test(ia)) return true;
    return false;
  }
}

// ------------------------------------------------------------------ 단계 기준값과 판정

/** 단계가 시작될 때 잡는 기준값 */
export interface StepBase {
  queueMax: number;
  cancels: number;
  social: string;
  /** 대기열 단계: 한 번에 본 플레이어 할 일 수 최대 */
  maxQueue: number;
  confirmed: boolean;
}

function playerQueueMax(s: Snapshot): number {
  let m = 0;
  for (const p of family(s)) for (const q of p.queue) if (!q.autonomous) m = Math.max(m, q.id);
  return m;
}

/** 식구가 다른 집 사람과 마지막으로 나눈 사회 상호작용들 (바뀌면 대화함) */
function socialSig(s: Snapshot): string {
  const fam = new Set(family(s).map((p) => p.id));
  return family(s)
    .filter((p) => p.lastSocial && !fam.has(p.lastSocial.target))
    .map((p) => `${p.id}:${p.lastSocial!.minute}:${p.lastSocial!.target}`)
    .join('|');
}

export function beginStep(s: Snapshot, ui: UiView): StepBase {
  return { queueMax: playerQueueMax(s), cancels: ui.cancels, social: socialSig(s), maxQueue: 0, confirmed: false };
}

export interface Env {
  home: HomeRect;
  defOf: DefOf;
  cook: CookPlan | null;
}

/** 지금은 할 수 없는 단계: 건너뜀 */
export function skipStep(id: StepId, s: Snapshot, env: Env): boolean {
  switch (id) {
    case 'kitchen':
      // 요리할 곳이 없으면 화로를 사서 놓게 함 (살 돈이 없으면 건너뜀)
      return hasKitchen(s, env.home, env.defOf) || (s.econ?.money ?? 0) < (env.defOf('hearth')?.price ?? HEARTH_PRICE);
    case 'fire': {
      if (!env.cook?.needFire) return true;
      return homeObjects(s, env.home).some((o) => hasTag(o, 'hearth', env.defOf) && !!o.state.lit);
    }
    case 'cook':
      return !env.cook;
    case 'eat':
      return !env.cook && !foodAvailable(s, env.home, env.defOf);
    case 'talk':
      return !s.persons.some((p) => p.household !== 1 && !p.hidden);
    default:
      return false;
  }
}

/** 단계 완료 판정 (한 번 true 면 다음 단계로) */
export function stepDone(id: StepId, s: Snapshot, ui: UiView, base: StepBase, acts: ActTracker, env: Env, startDay: number): boolean {
  const me = s.persons.find((p) => p.id === ui.selectedId);
  switch (id) {
    case 'wake':
      return base.confirmed;
    case 'pie':
      return playerQueueMax(s) > base.queueMax;
    case 'queue': {
      const n = me ? me.queue.filter((q) => !q.autonomous).length : 0;
      base.maxQueue = Math.max(base.maxQueue, n);
      return base.maxQueue >= 2 && ui.cancels > base.cancels;
    }
    case 'needs':
      return ui.popup === 'needs';
    case 'kitchen':
      return hasKitchen(s, env.home, env.defOf);
    case 'fire':
      return homeObjects(s, env.home).some((o) => hasTag(o, 'hearth', env.defOf) && !!o.state.lit);
    case 'cook':
      return acts.didFinish(isCook);
    case 'eat':
      return acts.didPerform(isEat);
    case 'talk': {
      if (ui.dialogOpen) return true;
      if (socialSig(s) !== base.social) return true;
      return family(s).some((p) => {
        const other = (uid: number) => s.persons.some((q) => q.id === uid && q.household !== 1);
        if (p.action && SOCIAL.has(p.action.interactionId) && other(p.action.targetUid)) return true;
        return p.queue.some((q) => !q.autonomous && SOCIAL.has(q.interactionId) && other(q.targetUid));
      });
    }
    case 'sleep':
      return !!me?.sleeping || s.day > startDay;
    case 'summary':
      return base.confirmed;
    default:
      return false;
  }
}

// ------------------------------------------------------------------ 신분별 첫 과제 (둘째 날 목표)

export interface Goal {
  kind: GoalKind;
  /** 문구 키 (tut.goal.<kind>) */
  key: string;
  icon: string;
  /** 조작 키캡 (문구 옆) */
  keys: string[];
}

const GOAL_LOOK: Record<GoalKind, { icon: string; keys: string[] }> = {
  till: { icon: 'plant', keys: ['mouse.left'] },
  farm: { icon: 'plant', keys: ['mouse.left'] },
  order: { icon: 'fire', keys: ['key.tab'] },
  shop: { icon: 'rv.shop', keys: ['key.tab'] },
  mass: { icon: 'candle', keys: ['mouse.left'] },
  attend: { icon: 'rv.church', keys: ['mouse.left'] },
  drill: { icon: 'cute.swords', keys: ['mouse.left'] },
  petition: { icon: 'rv.castle', keys: ['key.tab'] },
  plead: { icon: 'rv.castle', keys: ['mouse.left'] },
  daywork: { icon: 'axe', keys: ['key.3'] },
  work: { icon: 'axe', keys: ['key.tab'] },
};

function goal(kind: GoalKind): Goal {
  return { kind, key: `tut.goal.${kind}`, ...GOAL_LOOK[kind] };
}

/** 이 집에 밭이 있나: tilled 0·crop 0 인 밭이 있으면 'till', 밭만 있으면 'farm' */
function fieldGoal(s: Snapshot, home: HomeRect, defOf: DefOf): GoalKind | null {
  const fields = homeObjects(s, home).filter((o) => (defOf(o.defId)?.tags ?? []).includes('field'));
  if (!fields.length) return null;
  return fields.some((o) => !Number(o.state.tilled ?? 0) && !Number(o.state.crop ?? 0)) ? 'till' : 'farm';
}

/**
 * 신분별 첫 과제: 농노 = 밭 갈기, 장인 = 첫 주문, 상인 = 가게 열기, 사제 = 미사, 기사 = 훈련, 귀족 = 탄원(영지 정책), 자유민 = 품팔이.
 * 그 신분의 일/물건이 없으면 가장 가까운 것 (밭일 → 아무 일)
 */
export function pickGoal(s: Snapshot, home: HomeRect, defOf: DefOf): Goal {
  const estate = s.house?.estate ?? s.econ?.estate ?? 'freeman';
  const fam = grownUps(s);
  const career = (id: string) => fam.some((p) => p.career?.id === id);
  const onsiteOrders = fam.some((p) => p.career && CAREERS[p.career.id]?.type === 'onsite' && !!CAREERS[p.career.id]?.orders);
  const field = fieldGoal(s, home, defOf);
  switch (estate) {
    case 'serf':
      return goal(field ?? (career('field_hand') ? 'daywork' : 'work'));
    case 'freeman':
      return goal(career('field_hand') ? 'daywork' : field ?? 'work');
    case 'artisan':
      return goal(onsiteOrders ? 'order' : 'work');
    case 'merchant':
      return goal(s.econ ? 'shop' : 'work');
    case 'clergy':
      // 사제 일이 없으면 (글을 몰라 사제가 못 된 성직자 …) 교회 미사에 나감
      return goal(career('priest') ? 'mass' : 'attend');
    case 'knight':
      return goal(career('knight') ? 'drill' : 'work');
    case 'noble':
      // 영주 가문이면 탄원에 답함 (정책), 아니면 성에 가서 영주에게 탄원을 올림
      return goal(s.house?.domain?.lord ? 'petition' : 'plead');
    default:
      return goal(field ?? 'work');
  }
}

/** 과제 시작 때 기준값 */
export interface GoalBase {
  tilled: number;
  levels: string;
  lastWork: number;
  shopOpen: boolean;
  /** 주문을 끝낸 것을 한 번이라도 봤나 (주문은 하루 끝에 비워짐) */
  orderSeen: boolean;
}

function tilledCount(s: Snapshot, home: HomeRect, defOf: DefOf): number {
  return homeObjects(s, home).filter((o) => (defOf(o.defId)?.tags ?? []).includes('field') && Number(o.state.tilled ?? 0) > 0).length;
}

function lastWorkMax(s: Snapshot): number {
  return Math.max(-1, ...family(s).map((p) => p.lastWork?.minute ?? -1));
}

export function beginGoal(s: Snapshot, home: HomeRect, defOf: DefOf): GoalBase {
  return {
    tilled: tilledCount(s, home, defOf),
    levels: JSON.stringify(s.house?.domain?.levels ?? {}),
    lastWork: lastWorkMax(s),
    shopOpen: !!s.econ?.shop.open,
    orderSeen: false,
  };
}

/** 과제에 쓰는 실제 상호작용 (보고·테스트용) */
export const GOAL_IA: Record<GoalKind, string> = {
  till: 'farm.till',
  farm: 'farm.*',
  order: 'recipe.* (careers orders done)',
  shop: 'intent setShop',
  mass: 'service.priest.say_mass',
  attend: 'pew.attend_mass',
  drill: 'service.knight.drill',
  petition: 'society setPolicy',
  plead: 'throne.petition / social.petition_lord',
  daywork: 'work.field_hand',
  work: 'work.* / service.*',
};

export function goalDone(g: Goal, s: Snapshot, base: GoalBase, acts: ActTracker, home: HomeRect, defOf: DefOf): boolean {
  switch (g.kind) {
    case 'till':
      return acts.didFinish((ia) => ia === 'farm.till') || tilledCount(s, home, defOf) > base.tilled;
    case 'farm':
      return acts.didFinish((ia) => ia.startsWith('farm.'));
    case 'order':
      if (family(s).some((p) => p.career?.orders.some((o) => o.done))) base.orderSeen = true;
      return base.orderSeen;
    case 'shop':
      return !!s.econ?.shop.open && (!base.shopOpen || (s.econ?.shop.sales ?? 0) > 0);
    case 'mass':
      return acts.didFinish((ia) => ia === 'service.priest.say_mass');
    case 'attend':
      return acts.didPerform((ia) => ia === 'pew.attend_mass');
    case 'drill':
      return acts.didFinish((ia) => ia === 'service.knight.drill');
    case 'plead':
      return acts.didFinish((ia) => ia === 'throne.petition' || ia.startsWith('social.petition'));
    case 'petition':
      return JSON.stringify(s.house?.domain?.levels ?? {}) !== base.levels;
    case 'daywork':
      return acts.didFinish((ia) => ia === 'work.field_hand') || lastWorkMax(s) > base.lastWork;
    case 'work':
      return acts.didFinish((ia) => ia.startsWith('work.') || ia.startsWith('service.')) || lastWorkMax(s) > base.lastWork;
  }
}

// ------------------------------------------------------------------ 하루 정산

export interface DaySummary {
  income: number;
  expense: number;
  moods: { id: number; name: string; emotion: string }[];
  /** 해낸 첫 하루 단계 수 */
  achieved: number;
}

/** 새 게임 준비 때 오간 돈 (시작 자금 · 교역 자본 · 빚 · 집값)은 첫날 번 돈/쓴 돈에서 뺌 */
const SETUP = new Set(['start', 'trade_capital', 'loan', 'house']);
const sum = (r: Record<string, number> | undefined) => Object.entries(r ?? {}).reduce((a, [k, v]) => (SETUP.has(k) ? a : a + v), 0);

/** 그날 가계부 (econ.book 의 그날 줄, 없으면 자정 전에 잡아 둔 today) */
export function daySummary(s: Snapshot, day: number, lastToday: { income: Record<string, number>; expense: Record<string, number> } | null, achieved: number): DaySummary {
  const row = s.econ?.book.find((b) => b.day === day);
  const src = row ?? lastToday ?? s.econ?.today ?? null;
  return {
    income: Math.round(sum(src?.income)),
    expense: Math.round(sum(src?.expense)),
    moods: family(s).filter((p) => !p.hidden || p.sleeping).map((p) => ({ id: p.id, name: p.name, emotion: p.inner && p.inner.stage >= 1 ? p.inner.emotion : 'neutral' })),
    achieved,
  };
}

// ------------------------------------------------------------------ 처음 마주치는 것

export interface OnceBase {
  letters: number;
  rumors: number;
}

export function beginOnce(s: Snapshot): OnceBase {
  return { letters: Math.max(0, ...(s.house?.letters ?? []).map((l) => l.id)), rumors: Math.max(0, ...(s.house?.rumors ?? []).map((r) => r.id)) };
}

/** 지금 처음 보이는 것 (아직 안 본 것 중) */
export function onceHits(s: Snapshot, ui: UiView, base: OnceBase): OnceId[] {
  const out: OnceId[] = [];
  const H = s.house;
  if (ui.buildMode === 'build' || ui.buildMode === 'buy') out.push('build');
  if (H?.cards.length) out.push('card');
  if (family(s).some((p) => p.bellyStage !== undefined)) out.push('pregnancy');
  if (H?.trial && H.trial.stage !== 'done') out.push('trial');
  if (H?.rumors.some((r) => r.id > base.rumors)) out.push('rumor');
  if (H?.letters.some((l) => l.id > base.letters)) out.push('letter');
  return out;
}

// ------------------------------------------------------------------ 저장 (저장 파일에 넣을 튜토리얼 진행)

export interface TutorialState {
  v: 2;
  step: StepId | null;
  startDay: number;
  goal: GoalKind | null;
  done: StepId[];
}

export function parseState(x: unknown): TutorialState | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Partial<TutorialState>;
  if (o.v !== 2) return null;
  const step = o.step === null || (FIRST_DAY as readonly string[]).includes(o.step as string) ? (o.step as StepId | null) : null;
  return {
    v: 2,
    step,
    startDay: typeof o.startDay === 'number' ? o.startDay : 0,
    goal: GOAL_KINDS.includes(o.goal as GoalKind) ? (o.goal as GoalKind) : null,
    done: Array.isArray(o.done) ? o.done.filter((d): d is StepId => (FIRST_DAY as readonly string[]).includes(d)) : [],
  };
}

export function goalOf(kind: GoalKind): Goal {
  return goal(kind);
}
