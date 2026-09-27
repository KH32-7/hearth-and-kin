/**
 * 자율 행동 (GDD 13-4 유틸리티 AI).
 * 점수 = Σ 긴급도(욕구) × 광고값(욕구)/100 ÷ (1 + 거리/기준) × 반복 벌점 → 상위 K개 중 점수 비례 무작위
 * 데이터는 불러올 때 컴파일된 것(compiled.ts)을 씀 → 틱 안에서 Object.entries/새 배열 없음
 */
import type { NeedId, ObjectInstance } from '../core/types';
import { NEED_IDS } from '../core/types';
import type { Rng } from '../core/rng';
import type { CompiledIA } from '../data/compiled';
import type { SimData } from '../data/simData';
import type { Person } from '../people/person';
import type { World } from '../world/world';
import { checkRequires, matchQuery, requiresOk, resolveStep } from './interactions';

export interface Candidate {
  interactionId: string;
  /** 물건 대상 (사람 대상 사회 상호작용이면 null) */
  target: ObjectInstance | null;
  /** 물건 uid 또는 사람 id (사회 상호작용) */
  targetUid: number;
  score: number;
}

export function urgency(data: SimData, need: NeedId, value: number): number {
  const c = data.needs.needs[need].curve;
  const v = Math.max(0, Math.min(100, value));
  return c.weight * Math.pow((100 - v) / 100, c.exponent);
}

function supportActive(world: World, c: CompiledIA): boolean {
  for (const p of c.supportWhen) if (!p(world)) return false;
  return true;
}

/**
 * 고장 난 물건 고치기 (23-4): 그 물건의 다른 상호작용이 채우는 욕구를 대신 광고 (고장 난 변소 = 방광, 침대 = 기력).
 * 물건 종류별로 한 번 계산해 둠
 */
const repairServes = new WeakMap<object, Map<string, Float64Array>>();
export function repairAds(data: SimData, defId: string): Float64Array {
  let m = repairServes.get(data.compiled);
  if (!m) repairServes.set(data.compiled, (m = new Map()));
  let a = m.get(defId);
  if (!a) {
    a = new Float64Array(8);
    for (const c of data.compiled.byDef.get(defId) ?? []) {
      if (c.id === 'obj.repair') continue;
      for (let i = 0; i < 8; i++) a[i] = Math.max(a[i], c.ads[i], c.supportAds[i], ...c.steps.map((st) => (st.needs[i] > 0 ? 40 : 0)));
    }
    for (let i = 0; i < 8; i++) a[i] *= REPAIR_AD_SHARE;
    m.set(defId, a);
  }
  return a;
}
/** 고치기가 물려받는 광고 비율 (직접 쓰는 것보다 조금 낮게) */
const REPAIR_AD_SHARE = 0.8;
let repairData: SimData | null = null;

/** 이 상호작용이 지금 대상에 대해 광고하는 욕구 i 의 값 */
export function adFor(c: CompiledIA, target: ObjectInstance, i: number, support: boolean): number {
  if (c.id === 'obj.repair' && target.state.broken && repairData) {
    const r = repairAds(repairData, target.defId)[i];
    if (r > 0) return r;
  }
  let v = c.ads[i];
  if (support) v += c.supportAds[i];
  const ia = c.def;
  const need = NEED_IDS[i];
  if (ia.adBonusWhen && matchQuery(target, { min: ia.adBonusWhen.targetMin })) v += (ia.adBonusWhen.ads as Record<string, number>)[need] ?? 0;
  if (ia.adPenaltyWhen && matchQuery(target, { min: ia.adPenaltyWhen.targetMin })) v *= ia.adPenaltyWhen.factor;
  return v;
}

/** 테스트/디버그용: 욕구별 광고값 객체 */
export function adsFor(data: SimData, world: World, interactionId: string, target: ObjectInstance): Partial<Record<NeedId, number>> {
  const c = data.compiled.byId.get(interactionId)!;
  const support = supportActive(world, c);
  const out: Partial<Record<NeedId, number>> = {};
  for (let i = 0; i < 8; i++) {
    const v = adFor(c, target, i, support);
    if (v) out[NEED_IDS[i]] = v;
  }
  return out;
}

const urgBuf = new Float64Array(8);
const nearBuf: ObjectInstance[] = [];

/**
 * 볼일 물건 (장터 노점처럼 'duty' 태그 + 조건부 광고가 있는 상호작용): 자율 반경 밖이어도 후보 (M6 마을, 18-2).
 * 물건 목록이 바뀔 때만 다시 셈
 */
let errandCache: { world: World | null; version: number; list: ObjectInstance[] } = { world: null, version: -1, list: [] };
/** 불러오기 뒤: 같은 World 객체에 저장본을 덮어써 버전 번호가 같아도 목록이 달라짐 */
export function resetAutonomyCaches(): void {
  errandCache = { world: null, version: -1, list: [] };
}
function errandObjects(data: SimData, world: World): ObjectInstance[] {
  if (errandCache.world === world && errandCache.version === world.objectsVersion) return errandCache.list;
  const list: ObjectInstance[] = [];
  for (const o of world.objects) {
    const cs = data.compiled.byDef.get(o.defId);
    if (cs?.some((c) => (c.def.tags ?? []).includes('duty') && c.supportWhen.length > 0 && c.def.autonomous !== false)) list.push(o);
  }
  errandCache = { world, version: world.objectsVersion, list };
  return list;
}

/** 자율 후보 물건: 반경 안 + (넓은 지도면) 반경 밖 볼일 물건 */
const candBuf: ObjectInstance[] = [];
function candidateObjects(data: SimData, world: World, person: Person, radius: number): ObjectInstance[] {
  const near = world.objectsNear(person.x, person.y, radius, nearBuf);
  if (world.objects.length < 400) return near;
  candBuf.length = 0;
  for (const o of near) candBuf.push(o);
  const r2 = radius * radius;
  for (const o of errandObjects(data, world)) {
    const dx = o.x - person.x;
    const dy = (o.y % (world.lot.h + 1)) - (person.y % (world.lot.h + 1));
    if (dx * dx + dy * dy > r2) candBuf.push(o);
  }
  return candBuf;
}

/** 모든 (상호작용, 대상) 후보의 점수. 사용할 수 없는 것은 제외 */
export function scoreCandidates(
  data: SimData,
  world: World,
  person: Person,
  out: Candidate[],
  adMult?: (tags: readonly string[], interactionId: string) => number,
  allow?: (c: CompiledIA) => boolean,
  allowTarget?: (o: ObjectInstance) => boolean,
): void {
  out.length = 0;
  repairData = data;
  const b = data.balance.autonomy;
  for (let i = 0; i < 8; i++) urgBuf[i] = urgency(data, NEED_IDS[i], person.needs[i]);
  const hour = world.hour();
  // 마을(M6): 주변 물건만 (자율 반경). 작은 부지는 전부
  for (const target of candidateObjects(data, world, person, b.searchRadiusTiles ?? 32)) {
    const until = person.excludedUntil.get(target.uid);
    if (until !== undefined && until > world.minute) continue;
    const list = data.compiled.byDef.get(target.defId);
    if (!list) continue;
    if (allowTarget && !allowTarget(target)) continue;
    for (const c of list) {
      const ia = c.def;
      if (ia.autonomous === false) continue;
      if (allow && !allow(c)) continue;
      if (!requiresOk(world, ia, target)) continue;
      const support = c.supportWhen.length === 0 || supportActive(world, c);
      let s = 0;
      const below = data.compiled.adBelow;
      for (let i = 0; i < 8; i++) {
        if (person.needs[i] >= below[i]) continue;
        const a = adFor(c, target, i, support);
        if (a) s += (urgBuf[i] * a) / 100;
      }
      if (s <= 0) continue;
      // 특성 선호, 스트레스 해소 (M2): 태그별 배수
      if (adMult) s *= adMult(ia.tags ?? [], c.id);
      if (ia.hoursWeight) for (const [a, bnd, m] of ia.hoursWeight) if (hour >= a && hour < bnd) s *= m;
      // 첫 단계 자리를 잡을 수 있어야 후보
      const first = resolveStep(world, person.id, person.x, person.y, ia.steps[0], target);
      if (!first) continue;
      s /= 1 + slabDistance(world, world.centerX(first.obj), world.centerY(first.obj), person.x, person.y) / b.distanceRefTiles;
      let repeats = 0;
      for (const u of person.recentObjects) if (u === target.uid) repeats++;
      if (repeats >= b.repeatWindow) s *= b.repeatPenalty;
      if (s < b.minScore) continue;
      out.push({ interactionId: c.id, target, targetUid: target.uid, score: s });
    }
  }
}

/**
 * 여러 층 부지의 거리: 층 판을 접은 평면 거리 + 층을 오갈 때 계단 비용 (위층 사람이 아래층 화덕을 150칸 밖으로 보지 않게)
 */
export function slabDistance(world: World, ax: number, ay: number, bx: number, by: number): number {
  const H1 = world.lot.h + 1;
  const dx = ax - bx;
  const dy = (ay % H1) - (by % H1);
  const levels = Math.abs(Math.floor(ay / H1) - Math.floor(by / H1));
  return Math.sqrt(dx * dx + dy * dy) + levels * LEVEL_COST_TILES;
}
/** 층 하나 오르내리는 거리 값 (칸) */
const LEVEL_COST_TILES = 6;

const weightBuf: number[] = [];

export function chooseAutonomous(
  data: SimData,
  world: World,
  person: Person,
  rng: Rng,
  buf: Candidate[],
  adMult?: (tags: readonly string[], interactionId: string) => number,
  extra?: (buf: Candidate[], urg: Float64Array) => void,
  allow?: (c: CompiledIA) => boolean,
  allowTarget?: (o: ObjectInstance) => boolean,
): Candidate | null {
  scoreCandidates(data, world, person, buf, adMult, allow, allowTarget);
  extra?.(buf, urgBuf);
  if (!buf.length) return null;
  buf.sort((a, b) => b.score - a.score || a.targetUid - b.targetUid || (a.interactionId < b.interactionId ? -1 : 1));
  const k = Math.min(data.balance.autonomy.topK, buf.length);
  const top = buf[0].score;
  // 상위권만 (최고점의 35% 미만은 뺌) → 사람처럼 흔들리되 엉뚱하지 않게
  weightBuf.length = 0;
  for (let i = 0; i < k; i++) weightBuf.push(buf[i].score >= top * 0.35 ? buf[i].score : 0);
  const pick = rng.weighted(weightBuf);
  return pick >= 0 ? buf[pick] : buf[0];
}

/**
 * 이 욕구를 채우는 상호작용(광고값 또는 조건이 맞는 보조 광고값, 이어지는 단계 효과)이 지금 가능하고 길이 닿는가.
 * 봇 지표(해결 가능한 욕구 방치)와 급한 욕구 중단/잠 깨기 판단에 씀
 */
export function needSolvable(
  data: SimData,
  world: World,
  person: Person,
  needIdx: number,
  reachable: (cell: number, blockedGoal: boolean) => boolean,
  allowTarget?: (o: ObjectInstance) => boolean,
): boolean {
  for (const target of candidateObjects(data, world, person, data.balance.autonomy.searchRadiusTiles ?? 32)) {
    const list = data.compiled.byDef.get(target.defId);
    if (!list) continue;
    // 마을: 쓸 수 없는 물건(남의 집, 사는 사람 전용)은 해결 수단이 아님 (자율 선택과 같은 거름)
    if (allowTarget && !allowTarget(target)) continue;
    for (const c of list) {
      // 고장 난 물건 고치기는 그 물건이 채우는 욕구의 해결 수단 (23-4)
      const repair = c.id === 'obj.repair' && !!target.state.broken && repairAds(data, target.defId)[needIdx] > 0;
      if (!c.serves[needIdx] && !repair) continue;
      const direct = repair || c.ads[needIdx] > 0 || c.steps.some((s) => s.needs[needIdx] > 0) || (c.supportAds[needIdx] > 0 && supportActive(world, c));
      if (!direct) continue;
      if (!checkRequires(world, c.def, target).ok) continue;
      const r = resolveStep(world, person.id, person.x, person.y, c.def.steps[0], target);
      if (r && reachable(world.slotCell(r.obj, r.slot), r.slot.pose !== 'stand')) return true;
    }
  }
  return false;
}
