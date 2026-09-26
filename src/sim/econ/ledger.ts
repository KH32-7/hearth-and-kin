/**
 * 경제 공용 식 (GDD 17-4, 17-8). 게임(src/sim)과 tools/econ-model 이 같은 함수를 씀 → 모델과 헤드리스가 어긋나지 않게
 * 돈은 전부 파딩 정수 (1동화 = 4파딩, 1은화 = 12동화, 1금화 = 20은화)
 */

export interface LedgerParams {
  elasticity: { food: number; other: number };
  clamp: [number, number];
  targetSeasons: number;
}

/** 가격 배수 = clamp((목표재고 ÷ Q)^ε, lo, hi). Q 가 0 이면 상한 */
export function priceMult(qStar: number, q: number, eps: number, lo: number, hi: number): number {
  if (q <= 0) return hi;
  const m = Math.pow(qStar / q, eps);
  return m < lo ? lo : m > hi ? hi : m;
}

/** 목표 재고 목표재고 = 인구 × 1인 하루 소비 × 계절 일수 × targetSeasons */
export function targetStock(population: number, perCapita: number, seasonDays: number, targetSeasons: number): number {
  return population * perCapita * seasonDays * targetSeasons;
}

/** 품목 가격(파딩 정수). 묶음이 있으면 묶음 전체에 배수를 곱한 뒤 한 단위 값 (17-4) */
export function unitPrice(base: number, mult: number, bundle?: { n: number; price: number }): number {
  if (bundle) return Math.max(1, Math.round(bundle.price * mult)) / bundle.n;
  return Math.max(1, Math.round(base * mult));
}

/** 비율로 떼는 돈 (십일조, 세금): 파딩 미만 잔액을 carry 에 누적해 이월 (반올림 오차 누적 없음) */
export function takeShare(amount: number, rate: number, carry: { v: number }): number {
  const exact = amount * rate + carry.v;
  const whole = Math.floor(exact);
  carry.v = exact - whole;
  return whole;
}

export interface Coins {
  pounds: number;
  shillings: number;
  pence: number;
  farthings: number;
  negative: boolean;
}

export const FARTHINGS_PER_PENNY = 4;
export const PENCE_PER_SHILLING = 12;
export const SHILLINGS_PER_POUND = 20;

/** 파딩 → 금화/은화/동화/파딩 */
export function toCoins(f: number): Coins {
  const negative = f < 0;
  let r = Math.abs(Math.round(f));
  const farthings = r % FARTHINGS_PER_PENNY;
  r = (r - farthings) / FARTHINGS_PER_PENNY;
  const pence = r % PENCE_PER_SHILLING;
  r = (r - pence) / PENCE_PER_SHILLING;
  const shillings = r % SHILLINGS_PER_POUND;
  const pounds = (r - shillings) / SHILLINGS_PER_POUND;
  return { pounds, shillings, pence, farthings, negative };
}

export const pence = (p: number): number => p * FARTHINGS_PER_PENNY;
