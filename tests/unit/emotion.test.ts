/**
 * M2 통과 조건: 감정 계산 유닛 (욕구 출처 상한, 억제 규칙, 기본/강함/극단 단계) — GDD 11-3
 */
import { describe, expect, it } from 'vitest';
import { computeEmotion, EMOTION_INDEX as E, type EmotionConfig, type MoodletLike } from '../../src/sim/inner/emotion';

const cfg: EmotionConfig = { basic: 2, strong: 3, extreme: 6, needSourceCap: 2, suppressNegativeStrength: 3, suppressPositiveFactor: 0.5 };
let seq = 0;
const m = (emotion: keyof typeof E, strength: number, needSource = false): MoodletLike => ({ emotion: E[emotion], strength, needSource, seq: seq++ });

describe('감정 계산 (11-3)', () => {
  it('무드렛이 없거나 합 2 미만이면 무난', () => {
    expect(computeEmotion([], cfg)).toMatchObject({ emotion: E.neutral, stage: 0 });
    expect(computeEmotion([m('happy', 1)], cfg)).toMatchObject({ emotion: E.neutral, stage: 0 });
  });

  it('단계: 2~2.9 기본, 3~5.9 강함, 6 이상 극단', () => {
    expect(computeEmotion([m('happy', 2)], cfg).stage).toBe(1);
    expect(computeEmotion([m('happy', 2), m('happy', 1)], cfg).stage).toBe(2);
    expect(computeEmotion([m('happy', 3), m('happy', 2)], cfg).stage).toBe(2);
    expect(computeEmotion([m('happy', 3), m('happy', 3)], cfg)).toMatchObject({ emotion: E.happy, stage: 3, sum: 6 });
  });

  it('욕구 출처 무드렛은 모든 감정 합쳐 세기 2까지만 (최근 것부터)', () => {
    // 배부름 1 + 정다움 1 + 훈훈함 1 + 개운함 1 (모두 욕구 출처) → 최근 둘(훈훈함 행복 1, 개운함 활기 1)만 반영 → 각 1 → 무난
    const r = computeEmotion([m('happy', 1, true), m('happy', 1, true), m('happy', 1, true), m('energized', 1, true)], cfg);
    expect(r).toMatchObject({ emotion: E.neutral, stage: 0 });
    // 같은 감정이면 상한 2까지 → 기본
    expect(computeEmotion([m('happy', 1, true), m('happy', 1, true), m('happy', 1, true)], cfg)).toMatchObject({ emotion: E.happy, stage: 1, sum: 2 });
    // 상한은 세기 단위로 잘림: 최근 세기 2 욕구 무드렛 + 오래된 세기 2 → 2 만
    expect(computeEmotion([m('sad', 2, true), m('sad', 2, true)], cfg).sum).toBe(2);
    // 잘 먹고 잘 자는 것만으로는 강함이 되지 않음
    const many = Array.from({ length: 8 }, () => m('happy', 1, true));
    expect(computeEmotion(many, cfg).stage).toBe(1);
  });

  it('억제: 세기 3 부정 무드렛이 있으면 긍정 합 절반, 긍정은 강함을 넘지 않음 (GDD 예시: 장례)', () => {
    // 장례의 슬픔 3 + 배부름/정다움(욕구 합 2) + 아늑한 방 1 + 갓 구운 빵 1 → 행복 4 → 억제로 2, 슬픔 3 → 우울함(강함)
    const r = computeEmotion([m('sad', 3), m('happy', 1, true), m('happy', 1, true), m('happy', 1), m('happy', 1)], cfg);
    expect(r).toMatchObject({ emotion: E.sad, stage: 2, sum: 3 });
    // 긍정이 커도 극단 못 감
    const big = computeEmotion([m('sad', 3), m('happy', 3), m('happy', 3), m('happy', 3), m('happy', 3), m('happy', 3)], cfg);
    expect(big.emotion).toBe(E.happy);
    expect(big.stage).toBe(2);
  });

  it('동률이면 가장 최근에 추가된 감정', () => {
    const a = m('angry', 2);
    const b = m('tense', 2);
    expect(computeEmotion([a, b], cfg).emotion).toBe(E.tense);
    expect(computeEmotion([b, { ...a, seq: seq++ }], cfg).emotion).toBe(E.angry);
  });

  it('억제 중 긍정 감정 최대 단계는 설정값 (emotions.json suppress.positiveMaxStage)', () => {
    const list = [m('sad', 3), m('happy', 3), m('happy', 3), m('happy', 3), m('happy', 3), m('happy', 3)];
    expect(computeEmotion(list, { ...cfg, suppressPositiveMaxStage: 1 })).toMatchObject({ emotion: E.happy, stage: 1 });
    expect(computeEmotion(list, { ...cfg, suppressPositiveMaxStage: 3 })).toMatchObject({ emotion: E.happy, stage: 3 });
  });

  it('욕구 출처 상한은 가장 최근 것부터: 굶주림 본 무드렛(슬픔 2)이 동반(긴장 1)보다 최근이면 울적함', () => {
    const tense = m('tense', 1, true);
    const sad = m('sad', 2, true);
    expect(computeEmotion([sad, tense], cfg)).toMatchObject({ emotion: E.sad, stage: 1, sum: 2 });
  });

  it('부정 감정은 극단까지 감', () => {
    expect(computeEmotion([m('angry', 3), m('angry', 3)], cfg)).toMatchObject({ emotion: E.angry, stage: 3 });
  });
});
