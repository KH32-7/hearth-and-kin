/**
 * 감정 계산 (GDD 11-3). 순수 함수: 무드렛 목록 → 현재 감정, 단계, 합.
 *  (1) 욕구 출처 무드렛은 모든 감정 합쳐 세기 needSourceCap 까지만 (최근 것부터)
 *  (2) 감정 종류별 합
 *  (3) 억제: 세기 3 이상 부정 무드렛이 있으면 긍정 감정 합 × 0.5, 긍정 감정 단계는 설정 단계(기본 강함)까지
 *  (4) 가장 큰 합 (동률이면 가장 최근에 추가된 감정) → 단계: 무난 / 기본 / 강함 / 극단
 */

export const EMOTION_IDS = ['happy', 'energized', 'focused', 'excited', 'inspired', 'pious', 'sad', 'angry', 'tense', 'ashamed', 'neutral'] as const;
export type EmotionId = (typeof EMOTION_IDS)[number];
export const EMOTION_INDEX: Record<EmotionId, number> = Object.fromEntries(EMOTION_IDS.map((e, i) => [e, i])) as Record<EmotionId, number>;
export const NEUTRAL = EMOTION_INDEX.neutral;
/** 긍정 감정 칸 (무난 제외) */
export const POSITIVE = new Uint8Array([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);

/** 0 무난, 1 기본, 2 강함, 3 극단 */
export type Stage = 0 | 1 | 2 | 3;

export interface EmotionConfig {
  basic: number;
  strong: number;
  extreme: number;
  needSourceCap: number;
  suppressNegativeStrength: number;
  suppressPositiveFactor: number;
  /** 억제 중 긍정 감정의 최대 단계 (emotions.json suppress.positiveMaxStage, 기본 2 = 강함) */
  suppressPositiveMaxStage?: number;
}

export interface MoodletLike {
  emotion: number;
  strength: number;
  needSource: boolean;
  /** 추가된 순서 (클수록 최근) */
  seq: number;
}

export interface EmotionResult {
  emotion: number;
  stage: Stage;
  sum: number;
}

const sums = new Float64Array(11);
const latest = new Float64Array(11);

export function stageOf(sum: number, c: EmotionConfig): Stage {
  if (sum >= c.extreme) return 3;
  if (sum >= c.strong) return 2;
  if (sum >= c.basic) return 1;
  return 0;
}

/** moodlets 는 수정하지 않음. 정렬용 임시 배열 없이 계산 (욕구 출처는 최근 것부터 상한까지) */
export function computeEmotion(moodlets: readonly MoodletLike[], c: EmotionConfig, out: EmotionResult = { emotion: NEUTRAL, stage: 0, sum: 0 }): EmotionResult {
  sums.fill(0);
  latest.fill(-1);
  // (1) 욕구 출처 상한: 최근 순으로 남은 한도만큼
  let needBudget = c.needSourceCap;
  let lastSeq = Infinity;
  for (;;) {
    let pick = -1;
    let pickSeq = -1;
    for (let i = 0; i < moodlets.length; i++) {
      const m = moodlets[i];
      if (!m.needSource || m.seq >= lastSeq) continue;
      if (m.seq > pickSeq) {
        pickSeq = m.seq;
        pick = i;
      }
    }
    if (pick < 0 || needBudget <= 0) break;
    const m = moodlets[pick];
    const take = Math.min(m.strength, needBudget);
    needBudget -= take;
    sums[m.emotion] += take;
    if (m.seq > latest[m.emotion]) latest[m.emotion] = m.seq;
    lastSeq = pickSeq;
  }
  // (2) 나머지 출처
  let suppress = false;
  for (const m of moodlets) {
    if (!POSITIVE[m.emotion] && m.emotion !== NEUTRAL && m.strength >= c.suppressNegativeStrength) suppress = true;
    if (m.needSource) continue;
    sums[m.emotion] += m.strength;
    if (m.seq > latest[m.emotion]) latest[m.emotion] = m.seq;
  }
  // (3) 억제
  if (suppress) for (let e = 0; e < 11; e++) if (POSITIVE[e]) sums[e] *= c.suppressPositiveFactor;
  // (4) 최대 (동률이면 최근)
  let best = NEUTRAL;
  let bestSum = 0;
  for (let e = 0; e < 11; e++) {
    if (e === NEUTRAL) continue;
    const s = sums[e];
    if (s > bestSum || (s === bestSum && s > 0 && latest[e] > latest[best])) {
      best = e;
      bestSum = s;
    }
  }
  let stage = stageOf(bestSum, c);
  if (stage === 0) best = NEUTRAL;
  const cap = (c.suppressPositiveMaxStage ?? 2) as Stage;
  if (suppress && POSITIVE[best] && stage > cap) stage = cap;
  out.emotion = best;
  out.stage = stage;
  out.sum = bestSum;
  return out;
}
