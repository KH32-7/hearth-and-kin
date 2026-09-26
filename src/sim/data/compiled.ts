/**
 * 데이터를 불러올 때 한 번 "컴파일": 틱 안에서 Object.entries/문자열 파싱/새 배열을 만들지 않도록
 * (BRIEF 4장 핫패스 할당 금지). 조건식 오류도 여기서(불러올 때) 잡힘.
 */
import type { NeedId } from '../core/types';
import { NEED_IDS } from '../core/types';
import type { InteractionDef } from './schema';
import type { World } from '../world/world';

export type Pred = (w: World) => boolean;

export const NEED_IDX: Record<NeedId, number> = {
  hunger: 0, energy: 1, hygiene: 2, bladder: 3, fun: 4, social: 5, warmth: 6, comfort: 7,
};

/** 광고 조건식: noServings | roomDirty | stock:<품목>(>=|<=)<수>, "a|b" 는 OR. supportWhen 목록 전체는 AND */
export function compilePredicate(p: string): Pred {
  // "a|b|c" = 하나라도 참이면 (목록 전체는 AND)
  if (p.includes('|')) {
    const parts = p.split('|').map(compilePredicate);
    return (w) => parts.some((f) => f(w));
  }
  if (p === 'roomDirty') {
    return (w) => {
      const at = w.data.balance.roomDirt.dirtyAt;
      for (const d of w.roomDirt) if (d >= at) return true;
      return false;
    };
  }
  if (p === 'noServings') {
    return (w) => {
      for (const o of w.objects) if (w.kindOf(o.defId) === 'hearth' && Number(o.state.servings ?? 0) > 0) return false;
      return true;
    };
  }
  const m = /^stock:(\w+)(>=|<=)(-?\d+)$/.exec(p);
  if (m) {
    const item = m[1];
    const n = Number(m[3]);
    return m[2] === '>=' ? (w) => (w.stock[item] ?? 0) >= n : (w) => (w.stock[item] ?? 0) <= n;
  }
  throw new Error(`알 수 없는 광고 조건식: ${p}`);
}

export interface CompiledStep {
  /** 분당 욕구 변화 (8칸) */
  needs: Float64Array;
  hasNeeds: boolean;
}

export interface CompiledIA {
  id: string;
  def: InteractionDef;
  ads: Float64Array;
  supportAds: Float64Array;
  supportWhen: Pred[];
  /** 이 상호작용이 (직접이든 이어지는 단계에서든) 채우는 욕구 */
  serves: Uint8Array;
  steps: CompiledStep[];
}

export interface Compiled {
  list: CompiledIA[];
  byId: Map<string, CompiledIA>;
  byDef: Map<string, CompiledIA[]>;
  /** [욕구 칸, 임계값] */
  interrupt: Array<[number, number]>;
  wakeIf: Array<[number, number]>;
  sleepDecay: Float64Array;
}

function needArray(rec: Partial<Record<NeedId, number>> | undefined): Float64Array {
  const a = new Float64Array(8);
  if (rec) for (const n of NEED_IDS) a[NEED_IDX[n]] = rec[n] ?? 0;
  return a;
}

export function compile(
  interactions: Record<string, InteractionDef>,
  balance: { interrupt: Record<string, number>; sleep: { wakeIf: Record<string, number>; decayMultiplier: Record<string, number> } },
): Compiled {
  const list: CompiledIA[] = [];
  const byId = new Map<string, CompiledIA>();
  const byDef = new Map<string, CompiledIA[]>();
  for (const [id, def] of Object.entries(interactions)) {
    const ads = needArray(def.ads);
    const supportAds = needArray(def.supportAds);
    const steps = def.steps.map((s) => {
      const needs = needArray(s.needs);
      return { needs, hasNeeds: needs.some((v) => v !== 0) };
    });
    const serves = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      if (ads[i] > 0 || supportAds[i] > 0 || steps.some((s) => s.needs[i] > 0)) serves[i] = 1;
      if (def.adBonusWhen && (def.adBonusWhen.ads as Record<string, number>)[NEED_IDS[i]] > 0) serves[i] = 1;
    }
    const c: CompiledIA = { id, def, ads, supportAds, supportWhen: (def.supportWhen ?? []).map(compilePredicate), serves, steps };
    list.push(c);
    byId.set(id, c);
    for (const o of def.objects) {
      if (!byDef.has(o)) byDef.set(o, []);
      byDef.get(o)!.push(c);
    }
  }
  const pairs = (rec: Record<string, number>): Array<[number, number]> =>
    Object.entries(rec)
      .filter(([k]) => k in NEED_IDX)
      .map(([k, v]) => [NEED_IDX[k as NeedId], v]);
  const sleepDecay = new Float64Array(8).fill(1);
  for (const [k, v] of Object.entries(balance.sleep.decayMultiplier)) if (k in NEED_IDX) sleepDecay[NEED_IDX[k as NeedId]] = v;
  return { list, byId, byDef, interrupt: pairs(balance.interrupt), wakeIf: pairs(balance.sleep.wakeIf), sleepDecay };
}
