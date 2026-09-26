/**
 * 시드 고정 난수 (mulberry32). 모든 게임 무작위는 여기를 거침 (BRIEF 0장 5).
 * 상태는 정수 하나라 저장/해시가 쉬움.
 */
export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** 가중치 배열에서 인덱스 하나 고름. 합이 0이면 -1 */
  weighted(weights: ArrayLike<number>, count = weights.length): number {
    let total = 0;
    for (let i = 0; i < count; i++) total += weights[i];
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < count; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return count - 1;
  }
}
