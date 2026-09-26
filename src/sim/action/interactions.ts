/**
 * 상호작용 조건 검사, 단계 대상/슬롯 결정, 효과 적용 (GDD 13-1).
 * 조건/효과 키: targetState, targetMin, targetMax, stock, exists / targetSet, targetAdd, stock, atAdd, atSet
 */
import type { ObjectInstance, SlotDef } from '../core/types';
import type { InteractionDef, ObjectQuery, StepDef } from '../data/schema';
import type { World } from '../world/world';

export interface Availability {
  ok: boolean;
  reasonKey?: string;
  reasonArgs?: Record<string, string | number>;
}

const OK: Availability = { ok: true };

export function matchQuery(obj: ObjectInstance, q: Pick<ObjectQuery, 'min' | 'max' | 'state'>): boolean {
  if (q.state) for (const k in q.state) if ((obj.state[k] ?? false) !== q.state[k]) return false;
  if (q.min) for (const k in q.min) if (Number(obj.state[k] ?? 0) < q.min[k]) return false;
  if (q.max) for (const k in q.max) if (Number(obj.state[k] ?? 0) > q.max[k]) return false;
  return true;
}

const findBuf: ObjectInstance[] = [];

export function findObject(world: World, q: ObjectQuery, nearX: number, nearY: number): ObjectInstance | null {
  let best: ObjectInstance | null = null;
  let bestD = Infinity;
  // 마을(M6): 가까운 물건만 (작은 부지는 전부)
  for (const o of world.objectsNear(nearX, nearY, 32, findBuf)) {
    if ((o.defId !== q.object && world.kindOf(o.defId) !== q.object) || !matchQuery(o, q)) continue;
    const d = Math.abs(world.centerX(o) - nearX) + Math.abs(world.centerY(o) - nearY);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

/** 자율 후보용 빠른 판정: checkRequires 와 같은 조건, 이유 문자열/객체를 만들지 않음 (M6 마을 핫패스) */
export function requiresOk(world: World, ia: InteractionDef, target: ObjectInstance): boolean {
  const r = ia.requires;
  if (r.targetState) for (const k in r.targetState) if ((target.state[k] ?? false) !== r.targetState[k]) return false;
  if (r.targetMin) for (const k in r.targetMin) if (Number(target.state[k] ?? 0) < r.targetMin[k]) return false;
  if (r.targetMax) for (const k in r.targetMax) if (Number(target.state[k] ?? 0) > r.targetMax[k]) return false;
  if (r.money !== undefined && (world.money?.(!!ia.effects?.buy) ?? Infinity) < r.money) return false;
  if (r.stock) for (const k in r.stock) if ((world.stock[k] ?? 0) < r.stock[k]) return false;
  if (ia.hours) {
    const h = world.hour();
    if (!(h >= ia.hours[0] && h < ia.hours[1])) return false;
  }
  if (r.exists && !findObject(world, r.exists, world.centerX(target), world.centerY(target))) return false;
  return true;
}

export function checkRequires(world: World, ia: InteractionDef, target: ObjectInstance): Availability {
  const r = ia.requires;
  if (r.targetState) {
    for (const k in r.targetState) {
      const v = r.targetState[k];
      if ((target.state[k] ?? false) !== v) return { ok: false, reasonKey: `reason.state.${k}.${v}` };
    }
  }
  if (r.targetMin) {
    for (const k in r.targetMin) {
      const v = r.targetMin[k];
      if (Number(target.state[k] ?? 0) < v) return { ok: false, reasonKey: `reason.min.${k}`, reasonArgs: { n: v } };
    }
  }
  if (r.targetMax) {
    for (const k in r.targetMax) {
      const v = r.targetMax[k];
      if (Number(target.state[k] ?? 0) > v) return { ok: false, reasonKey: `reason.max.${k}`, reasonArgs: { n: v } };
    }
  }
  if (r.money !== undefined && (world.money?.(!!ia.effects?.buy) ?? Infinity) < r.money) return { ok: false, reasonKey: 'reason.money', reasonArgs: { n: r.money } };
  if (r.stock) {
    for (const k in r.stock) {
      const v = r.stock[k];
      if ((world.stock[k] ?? 0) < v) return { ok: false, reasonKey: 'reason.stock', reasonArgs: { item: k, n: v } };
    }
  }
  if (r.exists) {
    if (!findObject(world, r.exists, world.centerX(target), world.centerY(target))) return { ok: false, reasonKey: `reason.exists.${r.exists.object}` };
  }
  if (ia.hours) {
    const h = world.hour();
    const [a, b] = ia.hours;
    if (!(h >= a && h < b)) return { ok: false, reasonKey: 'reason.hours', reasonArgs: { from: a, to: b } };
  }
  return OK;
}

export function slotFree(world: World, obj: ObjectInstance, slot: SlotDef, personId: number): boolean {
  if (world.isReserved(obj.uid, slot.id, personId)) return false;
  const g = world.grid;
  const x = obj.x + slot.dx;
  const y = obj.y + slot.dy;
  if (!g.inBounds(x, y)) return false;
  const i = g.idx(x, y);
  if (g.wall[i] && !g.door[i]) return false;
  const occ = g.objAt[i];
  // 슬롯 칸이 다른 물건에 막혀 있으면 못 씀 (자기 발자국 안 앉기/눕기 슬롯은 허용)
  if (occ !== 0 && occ !== obj.uid + 1) return false;
  if (occ === obj.uid + 1 && slot.pose === 'stand') return false;
  return true;
}

function pickSlot(world: World, obj: ObjectInstance, want: StepDef['slot'], personId: number): SlotDef | null {
  const slots = world.slots(obj);
  if (typeof want === 'string') {
    const s = slots.find((x) => x.id === want);
    if (s && slotFree(world, obj, s, personId)) return s;
    if (s) return null;
  }
  if (want && typeof want === 'object') {
    for (const s of slots) if (s.pose === want.pose && slotFree(world, obj, s, personId)) return s;
    return null;
  }
  for (const s of slots) if (s.pose === 'stand' && slotFree(world, obj, s, personId)) return s;
  for (const s of slots) if (slotFree(world, obj, s, personId)) return s;
  return null;
}

const seatBuf: ObjectInstance[] = [];

/** 탁자 발자국에 맞닿은 앉기 슬롯 */
function seatAdjacentTo(world: World, table: ObjectInstance, personId: number, fromX: number, fromY: number) {
  const tf = world.footprint(table);
  let best: { obj: ObjectInstance; slot: SlotDef } | null = null;
  let bestD = Infinity;
  for (const o of world.objectsNear(table.x, table.y, 8, seatBuf)) {
    if (o === table) continue;
    for (const s of world.slots(o)) {
      if (s.pose !== 'sit') continue;
      const sx = o.x + s.dx;
      const sy = o.y + s.dy;
      const adj =
        (sx >= table.x - 1 && sx <= table.x + tf.w && sy >= table.y && sy < table.y + tf.h) ||
        (sy >= table.y - 1 && sy <= table.y + tf.h && sx >= table.x && sx < table.x + tf.w);
      if (!adj || !slotFree(world, o, s, personId)) continue;
      const d = Math.abs(sx - fromX) + Math.abs(sy - fromY);
      if (d < bestD) {
        bestD = d;
        best = { obj: o, slot: s };
      }
    }
  }
  return best;
}

/** 대상 가까이 앉을 자리: "seat" 태그 물건(의자, 걸상, 긴 의자)만. 요강/욕조/뒷간 좌석에 앉아 책을 읽지 않게 */
function seatNearest(world: World, target: ObjectInstance, personId: number) {
  const cx = world.centerX(target);
  const cy = world.centerY(target);
  let best: { obj: ObjectInstance; slot: SlotDef } | null = null;
  let bestD = Infinity;
  for (const o of world.objectsNear(target.x, target.y, 12, seatBuf)) {
    if (!world.def(o.defId).tags.includes('seat')) continue;
    for (const s of world.slots(o)) {
      if (s.pose !== 'sit' || !slotFree(world, o, s, personId)) continue;
      const d = Math.abs(o.x + s.dx - cx) + Math.abs(o.y + s.dy - cy);
      if (d < bestD) {
        bestD = d;
        best = { obj: o, slot: s };
      }
    }
  }
  if (best) return best;
  // 앉을 곳이 없으면 대상 앞에 서서 함
  const slot = pickSlot(world, target, undefined, personId);
  return slot ? { obj: target, slot } : null;
}

export interface ResolvedStep {
  obj: ObjectInstance;
  slot: SlotDef;
}

export function resolveStep(
  world: World,
  personId: number,
  px: number,
  py: number,
  step: StepDef,
  target: ObjectInstance,
): ResolvedStep | null {
  const at = step.at;
  if (at === 'target') {
    const slot = pickSlot(world, target, step.slot, personId);
    return slot ? { obj: target, slot } : null;
  }
  if ('seatAt' in at) return seatAdjacentTo(world, target, personId, px, py);
  if ('seatNear' in at) return seatNearest(world, target, personId);
  // 조건에 맞는 같은 종류 물건 중 가까운 것부터 슬롯이 빈 것 (정렬 배열 없이 가장 가까운 것을 고름)
  const cx = world.centerX(target);
  const cy = world.centerY(target);
  let best: ResolvedStep | null = null;
  let bestD = Infinity;
  for (const o of world.objects) {
    if ((o.defId !== at.object && world.kindOf(o.defId) !== at.object) || !matchQuery(o, at)) continue;
    if (world.stepAllow && o !== target && !world.stepAllow(personId, o)) continue;
    const d = Math.abs(world.centerX(o) - cx) + Math.abs(world.centerY(o) - cy);
    if (d >= bestD) continue;
    const slot = pickSlot(world, o, step.slot, personId);
    if (!slot) continue;
    bestD = d;
    best = { obj: o, slot };
  }
  return best;
}

export function applyInteractionEffects(world: World, ia: InteractionDef, target: ObjectInstance): void {
  const e = ia.effects;
  if (!e) return;
  if (e.targetState) for (const [k, v] of Object.entries(e.targetState)) target.state[k] = v;
  if (e.targetSet) for (const [k, v] of Object.entries(e.targetSet)) target.state[k] = v;
  if (e.targetAdd) for (const [k, v] of Object.entries(e.targetAdd)) target.state[k] = Number(target.state[k] ?? 0) + v;
  if (e.stock) for (const [k, v] of Object.entries(e.stock)) world.stock[k] = Math.max(0, (world.stock[k] ?? 0) + v);
}

export function applyStepEffects(step: StepDef, obj: ObjectInstance): void {
  const e = step.effects;
  if (!e) return;
  if (e.atAdd) for (const [k, v] of Object.entries(e.atAdd)) obj.state[k] = Math.max(0, Number(obj.state[k] ?? 0) + v);
  if (e.atSet) for (const [k, v] of Object.entries(e.atSet)) obj.state[k] = v;
}

/** 단계 시작 전에 다시 확인 (다른 사람이 스튜를 다 먹었을 수 있음) */
export function stepStillValid(step: StepDef, obj: ObjectInstance): boolean {
  if (typeof step.at === 'object' && 'object' in step.at) return matchQuery(obj, step.at);
  return true;
}

/**
 * 수행 중 다시 확인하는 대상 상태 조건 (불이 꺼지면 불 쬐기 중단 등).
 * 재고(stock)와 exists 는 이 행동이 소비하는 입력이라 확인하지 않음
 */
export function targetConditionsHold(ia: InteractionDef, target: ObjectInstance): boolean {
  const r = ia.requires;
  if (r.targetState) for (const k in r.targetState) if ((target.state[k] ?? false) !== r.targetState[k]) return false;
  if (r.targetMin) for (const k in r.targetMin) if (Number(target.state[k] ?? 0) < r.targetMin[k]) return false;
  if (r.targetMax) for (const k in r.targetMax) if (Number(target.state[k] ?? 0) > r.targetMax[k]) return false;
  return true;
}
