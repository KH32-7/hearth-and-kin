/**
 * 복장 자동 전환 (GDD 10-1 표). 순수 함수: 상황 → 복장 6벌 중 하나.
 *
 * | 상황 | 복장 |
 * | 기상, 일상 | 평상복 |
 * | 직업 활동, 가내 작업 | 작업복 |
 * | 교회, 혼례, 장례, 축제, 성 방문 | 예복 |
 * | 잠 | 잠옷 |
 * | 기온 5도 이하 외출 | 겨울옷 |
 * | 목욕, 강에서 수영 | 속옷 |
 *
 * 우선순위: 옷장에서 직접 갈아입음 > 잠 > 목욕/수영 > 예복 자리 > 추운 날 바깥 > 작업 > 평상
 * 장례에 예복이 아닌 평상복(또는 작업복/잠옷/속옷)으로 가면 "무례함" 소문 (rudeAtFuneral)
 */

export type OutfitKind = 'everyday' | 'work' | 'formal' | 'sleep' | 'winter' | 'bath';
export const OUTFIT_KINDS: readonly OutfitKind[] = ['everyday', 'work', 'formal', 'sleep', 'winter', 'bath'];

export type OutfitActivity =
  | 'wake'
  | 'daily'
  | 'career'
  | 'housework'
  | 'church'
  | 'wedding'
  | 'funeral'
  | 'festival'
  | 'castle'
  | 'sleep'
  | 'bath'
  | 'swim';

/** 예복을 입는 자리 */
export const FORMAL_ACTIVITIES: ReadonlySet<OutfitActivity> = new Set(['church', 'wedding', 'funeral', 'festival', 'castle']);

export interface OutfitCtx {
  activity: OutfitActivity;
  /** 바깥에 있음 (또는 나감) */
  outdoors?: boolean;
  /** 체감 기온 (섭씨) */
  feltTemp?: number;
  /** 옷장/궤짝 "갈아입기"로 직접 고른 옷 (상황이 바뀌면 호출하는 쪽이 지움) */
  manual?: OutfitKind | null;
}

export interface OutfitRules {
  /** 체감 기온이 이 값 이하면 바깥에서 겨울옷 (genetics.json outfits.winterAtOrBelow) */
  winterAtOrBelow: number;
}

export function outfitFor(ctx: OutfitCtx, rules: OutfitRules): OutfitKind {
  if (ctx.manual) return ctx.manual;
  switch (ctx.activity) {
    case 'sleep':
      return 'sleep';
    case 'bath':
    case 'swim':
      return 'bath';
    default:
      break;
  }
  if (FORMAL_ACTIVITIES.has(ctx.activity)) return 'formal';
  if (ctx.outdoors && ctx.feltTemp !== undefined && ctx.feltTemp <= rules.winterAtOrBelow) return 'winter';
  if (ctx.activity === 'career' || ctx.activity === 'housework') return 'work';
  return 'everyday';
}

/** 장례 자리에서 이 옷이면 "무례함" 소문을 내야 함 (예복과 겨울옷은 괜찮음) */
export function rudeAtFuneral(activity: OutfitActivity, worn: OutfitKind): boolean {
  return activity === 'funeral' && worn !== 'formal' && worn !== 'winter';
}
