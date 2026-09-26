/**
 * 정책 방향 헤드리스 (GDD 29-4 "정책 방향 목표 (M9, 28일 비교, 다른 조건 동일)"):
 * 같은 시드로 정책 하나만 다른 두 Simulation (애쉬포드) 을 28일 돌려 지표를 비교하고 95% 구간으로 통과 판정.
 *   npx tsx tools/sim-policy.ts --days 28 --seeds 50 [--pair tax|market|hunting|watch|plague|festival] [--out artifacts/policy/headless.json]
 * - 짝 비교: 시드마다 차이 d = B − A. 평균은 t 구간, 비율(역병 발병률)은 윌슨 구간. 상대 변화 구간 = 차이 구간 ÷ A 평균.
 *   통과 = 구간 전체가 목표 쪽 (예: "−10 이상 하락" 이면 구간 위끝 ≤ −10)
 * - 리드가 sim.ts 에 연결할 것을 가정: sim.policy (LordPolicy), sim.justice (Justice), sim.plague (PlagueLite),
 *   sim.house (HouseLink: fief.treasury, house.honor.morale), sim.econ (정책 훅이 goodPrice/세율/장인 수입에 걸림). 없으면 안내하고 종료
 * 측정: 민심(끝 값, Honor.morale), 영주 금고(끝 값, fief.treasury.money), 가문 평균 순수입(영주 가문 제외, 가계부 수입 − 지출, 대출·상환 제외),
 *   장인 순수입, 공산품 물가(cloth iron tools horseshoes 가격 평균, 날마다), 고기 가격, 범죄 발생(Justice.stats.committed 합), 밀렵,
 *   역병 발병률(2일째 유행을 심음), 장터 거래량(PlagueLite.stats.marketByDay 합)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { simRaw } from './data-node';
import { validateSimData } from '../src/sim/data/simData';
import { Simulation } from '../src/sim/sim';
import type { Economy } from '../src/sim/econ/economy';
import type { LordPolicy, PolicyId } from '../src/sim/society/policy';
import type { Justice } from '../src/sim/society/justice';
import type { PlagueLite } from '../src/sim/society/plagueLite';

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const DAYS = Number(arg('days', '28'));
const SEEDS = Number(arg('seeds', '50'));
const ONLY = arg('pair', '');
const OUT = arg('out', 'artifacts/policy/headless.json');
const MANUFACTURED = ['cloth', 'iron', 'tools', 'horseshoes'];

/** 이 도구가 쓰는 Simulation 의 좁은 모양 (리드 연결 전에는 policy/justice/plague 가 없음) */
interface PolicySim {
  readonly persons: readonly { household: number }[];
  readonly econ: Economy | null;
  policy?: Pick<LordPolicy, 'set' | 'level' | 'stats' | 'aiEnabled'> | null;
  justice?: Pick<Justice, 'stats'> | null;
  plague?: Pick<PlagueLite, 'seed' | 'stats'> | null;
  house?: { fief: { treasury: { money: number }; lordHousehold(): number | null } | null; house: { honor: { morale: number } } } | null;
  /** 리드가 societyLink 아래에 둘 수도 있음 (sim.society.policy …) */
  society?: { policy?: PolicySim['policy']; justice?: PolicySim['justice']; plague?: PolicySim['plague'] } | null;
  tick(): void;
}

/** sim.policy 또는 sim.society.policy (둘 중 연결된 쪽) */
function mods(s: PolicySim): { policy: PolicySim['policy']; justice: PolicySim['justice']; plague: PolicySim['plague'] } {
  return { policy: s.policy ?? s.society?.policy ?? null, justice: s.justice ?? s.society?.justice ?? null, plague: s.plague ?? s.society?.plague ?? null };
}

interface Metrics {
  morale: number;
  treasury: number;
  familyNet: number;
  artisanNet: number;
  manufacturedPrice: number;
  meatPrice: number;
  crimes: number;
  poaching: number;
  plagueInfected: number;
  plaguePop: number;
  market: number;
}

type Check = { name: string; metric: keyof Metrics; kind: 'abs' | 'rel' | 'zeroB' | 'prop'; dir: 'down' | 'up'; target: number };
interface Pair {
  id: string;
  policy: PolicyId;
  a: string;
  b: string;
  seedPlague?: boolean;
  checks: Check[];
}

const PAIRS: Pair[] = [
  {
    id: 'tax', policy: 'tax', a: 'normal', b: 'high',
    checks: [
      { name: '민심 −10 이상', metric: 'morale', kind: 'abs', dir: 'down', target: -10 },
      { name: '가문 평균 순수입 −8% 이상', metric: 'familyNet', kind: 'rel', dir: 'down', target: -0.08 },
      { name: '영주 금고 +30% 이상', metric: 'treasury', kind: 'rel', dir: 'up', target: 0.3 },
    ],
  },
  {
    id: 'market', policy: 'market', a: 'free', b: 'guild',
    checks: [
      { name: '장인 순수입 +10% 이상', metric: 'artisanNet', kind: 'rel', dir: 'up', target: 0.1 },
      { name: '공산품 물가 +5% 이상', metric: 'manufacturedPrice', kind: 'rel', dir: 'up', target: 0.05 },
    ],
  },
  {
    id: 'hunting', policy: 'hunting', a: 'ban', b: 'free',
    checks: [
      { name: '고기 가격 −10% 이상', metric: 'meatPrice', kind: 'rel', dir: 'down', target: -0.1 },
      { name: '밀렵 범죄 0', metric: 'poaching', kind: 'zeroB', dir: 'down', target: 0 },
    ],
  },
  {
    id: 'watch', policy: 'watch', a: 'normal', b: 'strict',
    checks: [
      { name: '범죄 발생 −30% 이상', metric: 'crimes', kind: 'rel', dir: 'down', target: -0.3 },
      { name: '민심 −5 이상', metric: 'morale', kind: 'abs', dir: 'down', target: -5 },
    ],
  },
  {
    id: 'plague', policy: 'plague', a: 'none', b: 'quarantine', seedPlague: true,
    checks: [
      { name: '역병 발병률 −25% 이상', metric: 'plagueInfected', kind: 'prop', dir: 'down', target: -0.25 },
      { name: '장터 거래량 −15% 이상', metric: 'market', kind: 'rel', dir: 'down', target: -0.15 },
    ],
  },
  {
    id: 'festival', policy: 'festival', a: 'normal', b: 'grand',
    checks: [
      { name: '민심 +5 이상', metric: 'morale', kind: 'abs', dir: 'up', target: 5 },
      { name: '영주 금고 감소', metric: 'treasury', kind: 'abs', dir: 'down', target: 0 },
    ],
  },
];

// ------------------------------------------------------------------ 통계

function tCrit(df: number): number {
  const z = 1.959964;
  const d = Math.max(1, df);
  return z + (z ** 3 + z) / (4 * d) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * d * d);
}

/** 평균과 95% t 구간 */
function tInterval(xs: number[]): { mean: number; lo: number; hi: number } {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, lo: mean, hi: mean };
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1));
  const h = tCrit(n - 1) * (sd / Math.sqrt(n));
  return { mean, lo: mean - h, hi: mean + h };
}

/** 윌슨 95% 구간 */
function wilson(k: number, n: number): { p: number; lo: number; hi: number } {
  if (n <= 0) return { p: 0, lo: 0, hi: 0 };
  const z = 1.959964;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

// ------------------------------------------------------------------ 한 번 돌리기

const data = validateSimData(simRaw({ town: 'ashford' }) as never);

function need(s: PolicySim): string | null {
  const m = mods(s);
  if (!m.policy) return 'sim.policy 또는 sim.society.policy (LordPolicy)';
  if (!m.justice) return 'sim.justice 또는 sim.society.justice (Justice)';
  if (!m.plague) return 'sim.plague 또는 sim.society.plague (PlagueLite)';
  if (!s.house?.fief || !s.house.house) return 'sim.house (HouseLink: fief, house.honor)';
  if (!s.econ) return 'sim.econ (Economy)';
  return null;
}

function netOf(acct: { book: { income: Record<string, number>; expense: Record<string, number> }[] }): number {
  let n = 0;
  for (const b of acct.book) {
    for (const [k, v] of Object.entries(b.income)) if (k !== 'loan') n += v;
    for (const [k, v] of Object.entries(b.expense)) if (k !== 'repay') n -= v;
  }
  return n;
}

function runOne(seed: number, policy: PolicyId, value: string, seedPlague: boolean): Metrics {
  const sim = new Simulation(data, seed) as unknown as PolicySim;
  const missing = need(sim);
  if (missing) {
    console.error(`정책 헤드리스를 돌릴 수 없음: ${missing} 가 Simulation 에 연결되지 않았습니다 (리드의 sim.ts 통합 필요).`);
    process.exit(2);
  }
  const M = mods(sim);
  const P = M.policy!;
  P.aiEnabled = false;
  P.set(policy, value, 'setup');
  const E = sim.econ!;
  let manu = 0;
  let meat = 0;
  let samples = 0;
  const total = DAYS * 1440;
  for (let t = 0; t < total; t++) {
    if (seedPlague && t === 2 * 1440) M.plague!.seed();
    sim.tick();
    if (t % 1440 === 1439) {
      manu += MANUFACTURED.reduce((a, g) => a + E.goodPrice(g), 0) / MANUFACTURED.length;
      meat += E.goodPrice('meat');
      samples++;
    }
  }
  // 영주 가문 제외: 마을 영주 가구 + 경제 요약 NPC 가정(1000~) 중 귀족 (economy.json ledger.households.noble = 영주 1가구)
  const lordHh = sim.house!.fief!.lordHousehold();
  const fams = [...E.accounts.values()].filter((a) => a.household !== lordHh && !(a.household >= 1000 && a.estate === 'noble'));
  const arts = fams.filter((a) => a.estate === 'artisan');
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const J = M.justice!.stats;
  const o = M.plague!.stats.outbreaks[0];
  return {
    morale: sim.house!.house.honor.morale,
    treasury: sim.house!.fief!.treasury.money,
    familyNet: avg(fams.map(netOf)),
    artisanNet: avg(arts.map(netOf)),
    manufacturedPrice: manu / Math.max(1, samples),
    meatPrice: meat / Math.max(1, samples),
    crimes: Object.values(J.committed).reduce((a, b) => a + b, 0),
    poaching: J.committed.poaching ?? 0,
    plagueInfected: o?.infected ?? 0,
    plaguePop: o?.pop ?? sim.persons.length,
    market: M.plague!.stats.marketByDay.reduce((a, b) => a + b, 0),
  };
}

// ------------------------------------------------------------------ 판정

interface CheckResult {
  pair: string;
  name: string;
  ok: boolean;
  estimate: number;
  lo: number;
  hi: number;
  detail: string;
}

function judge(p: Pair, A: Metrics[], B: Metrics[]): CheckResult[] {
  const out: CheckResult[] = [];
  for (const c of p.checks) {
    const m = c.metric;
    if (c.kind === 'zeroB') {
      const sum = B.reduce((a, x) => a + x[m], 0);
      const aSum = A.reduce((a, x) => a + x[m], 0);
      out.push({ pair: p.id, name: c.name, ok: sum === 0, estimate: sum, lo: sum, hi: sum, detail: `${p.b}: ${sum}건 (${p.a}: ${aSum}건)` });
      continue;
    }
    if (c.kind === 'prop') {
      const ka = A.reduce((a, x) => a + x.plagueInfected, 0);
      const na = A.reduce((a, x) => a + x.plaguePop, 0);
      const kb = B.reduce((a, x) => a + x.plagueInfected, 0);
      const nb = B.reduce((a, x) => a + x.plaguePop, 0);
      const wa = wilson(ka, na);
      const wb = wilson(kb, nb);
      const est = wa.p > 0 ? wb.p / wa.p - 1 : 0;
      // 보수적 구간: 가장 나쁜 쪽끼리
      const hi = wa.lo > 0 ? wb.hi / wa.lo - 1 : Infinity;
      const lo = wa.hi > 0 ? wb.lo / wa.hi - 1 : -Infinity;
      out.push({ pair: p.id, name: c.name, ok: c.dir === 'down' ? hi <= c.target : lo >= c.target, estimate: est, lo, hi, detail: `${p.a} ${(wa.p * 100).toFixed(1)}% [${(wa.lo * 100).toFixed(1)}, ${(wa.hi * 100).toFixed(1)}] → ${p.b} ${(wb.p * 100).toFixed(1)}% [${(wb.lo * 100).toFixed(1)}, ${(wb.hi * 100).toFixed(1)}]` });
      continue;
    }
    const d = A.map((a, i) => B[i][m] - a[m]);
    const ci = tInterval(d);
    let est = ci.mean;
    let lo = ci.lo;
    let hi = ci.hi;
    const aMean = A.reduce((s, x) => s + x[m], 0) / A.length;
    if (c.kind === 'rel') {
      const base = Math.abs(aMean) || 1;
      est /= base;
      lo /= base;
      hi /= base;
    }
    const ok = c.dir === 'down' ? hi <= c.target && (c.target !== 0 || hi < 0) : lo >= c.target;
    const f = (v: number) => (c.kind === 'rel' ? `${(v * 100).toFixed(1)}%` : v.toFixed(2));
    out.push({ pair: p.id, name: c.name, ok, estimate: est, lo, hi, detail: `${f(est)} [${f(lo)}, ${f(hi)}] (${p.a} 평균 ${aMean.toFixed(2)})` });
  }
  return out;
}

// ------------------------------------------------------------------ 실행

const t0 = Date.now();
const pairs = PAIRS.filter((p) => !ONLY || p.id === ONLY);
if (!pairs.length) {
  console.error(`--pair 는 ${PAIRS.map((p) => p.id).join('|')} 중 하나`);
  process.exit(2);
}
const results: CheckResult[] = [];
const raw: Record<string, { a: Metrics[]; b: Metrics[] }> = {};
for (const p of pairs) {
  const A: Metrics[] = [];
  const B: Metrics[] = [];
  for (let s = 1; s <= SEEDS; s++) {
    A.push(runOne(s, p.policy, p.a, !!p.seedPlague));
    B.push(runOne(s, p.policy, p.b, !!p.seedPlague));
    process.stdout.write(`${p.id} 시드 ${s}/${SEEDS} (${((Date.now() - t0) / 1000).toFixed(0)}초)\n`);
  }
  raw[p.id] = { a: A, b: B };
  const r = judge(p, A, B);
  results.push(...r);
  for (const c of r) console.log(`${c.ok ? '통과' : '✗'} [${p.id} ${p.a}→${p.b}] ${c.name}: ${c.detail}`);
}
const pass = results.every((r) => r.ok);
mkdirSync('artifacts/policy', { recursive: true });
writeFileSync(OUT, JSON.stringify({ days: DAYS, seeds: SEEDS, town: 'ashford', pairs: pairs.map((p) => ({ id: p.id, policy: p.policy, a: p.a, b: p.b })), checks: results, raw, pass }, null, 1));
console.log(pass ? '정책 방향 헤드리스: 통과' : '정책 방향 헤드리스: 실패');
console.log(`${((Date.now() - t0) / 1000).toFixed(0)}초`);
process.exit(pass ? 0 : 1);
