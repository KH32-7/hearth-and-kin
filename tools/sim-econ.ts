/**
 * M4 헤드리스 경제 (BRIEF M4 통과 조건): 달력 2년(56일, 기본 설정)을 전체 시뮬레이션으로 돌림.
 *   npx tsx tools/sim-econ.ts [--days 56] [--seeds 5] [--out artifacts/econ/headless.json]
 * - 겨울 끝 곡물 가격 = 가을 추수 직후의 1.5~2.5배 (장부)
 * - 신분별 28일 가계 순수입이 17-4 목표(일 순수입 × 28)의 ±30% (NPC 가정 요약 정산)
 * - 조작 가문(자유민 부부, 전략 봇: 남편 영주 밭 품팔이, 아내 집안 제작/밭)의 28일 순수입
 * - tools/econ-model 결과(artifacts/econ/model.json)와 20% 이내 (가격 배수, 신분별 순수입)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadSimData } from './data-node';
import { Simulation } from '../src/sim/sim';

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const DAYS = Number(arg('days', '56'));
const SEEDS = Number(arg('seeds', '5'));
const OUT = arg('out', 'artifacts/econ/headless.json');
const data = loadSimData();
const E = data.economy as { calendar: { seasonDays: number }; estates: Record<string, { target: { net: number } }> };
const SD = E.calendar.seasonDays;
const YEAR = SD * 4;
const START_REL = (JSON.parse(readFileSync('src/data/start.json', 'utf8')) as { relations?: { a: number; b: number }[] }).relations ?? [];

interface SeedResult {
  grain: number[];
  npcNet28: Record<string, number[]>;
  playerNet28: number[];
  playerMoney: number;
  stuck: number;
  collapses: number;
  maxNeglect: number;
  bankrupt: number;
  playerBankrupt: number;
  harvests: number;
  wages: number;
}

function strategy(sim: Simulation): void {
  // 전략 봇 (29-4 자유민: 밭 → 품팔이 → 저축): 남편은 영주 밭 품팔이, 아내는 집에서
  const careers = data.careers ?? {};
  const job = Object.keys(careers).find((k) => careers[k].type === 'rabbithole' && careers[k].estates.includes('freeman'));
  if (job) sim.apply({ kind: 'setCareer', personId: 1, careerId: job });
}

/** 하루 한 번 (아침): 밭 일을 명령 (갈기 → 제철 작물 심기 → 김매기/허수아비 → 수확), 식량이 모자라면 장보기 */
function dailyOrders(sim: Simulation): void {
  const wife = sim.persons.find((p) => p.id === 2);
  if (!wife || wife.action?.item.autonomous === false) return;
  for (const o of sim.world.objects) {
    if (!sim.isFarmObj(o)) continue;
    const menu = sim.menuFor(wife.id, o.uid).filter((e) => e.available);
    const pick = menu.find((e) => e.interactionId === 'farm.harvest') ?? menu.find((e) => e.interactionId === 'farm.till')
      ?? menu.find((e) => e.interactionId.startsWith('farm.sow.')) ?? menu.find((e) => e.interactionId === 'farm.weed') ?? menu.find((e) => e.interactionId === 'farm.water')
      ?? menu.find((e) => e.interactionId === 'farm.scarecrow');
    if (pick) sim.apply({ kind: 'queue', personId: wife.id, interactionId: pick.interactionId, targetUid: o.uid });
  }
  // 씨앗: 제철 작물 씨앗이 없으면 장터에서 (밀/보리/순무/양배추). 입력 로그에 남는 의도로
  for (const seed of ['wheat', 'barley', 'turnip', 'cabbage']) {
    if ((sim.world.stock[seed] ?? 0) < 10 && sim.item(seed)) sim.apply({ kind: 'marketBuy', personId: 2, item: seed, n: 10 });
  }
  // 곡물이 넉넉하면 (씨앗 30 남기고) 절반을 장터에 팖
  for (const g of ['wheat', 'barley']) {
    const have = sim.world.stock[g] ?? 0;
    if (have > 60) sim.apply({ kind: 'marketSell', personId: 2, item: g, n: Math.floor((have - 30) / 2) });
  }
}

function run(seed: number): SeedResult {
  const sim = new Simulation(data, seed);
  sim.addPerson('에드릭', undefined, undefined, { estate: 'freeman', sex: 'male' });
  sim.addPerson('마르타', undefined, undefined, { estate: 'freeman', sex: 'female' });
  for (const r of START_REL) sim.apply({ kind: 'setRelation', met: true, ...r });
  strategy(sim);
  const grain: number[] = [];
  const e = sim.econ!;
  const total = DAYS * 1440;
  for (let t = 0; t < total; t++) {
    sim.tick();
    const m = sim.world.minuteOfDay();
    if (m === 6 * 60) dailyOrders(sim);
    if (m === 0) grain.push(e.goods.grain.mult);
  }
  // 신분별 NPC 가정 28일 순수입 (동화): book 은 28일치
  const npcNet28: Record<string, number[]> = {};
  for (const h of e.npcs) {
    const a = h.acct;
    let net = 0;
    for (const d of a.book) {
      for (const [k, v] of Object.entries(d.income)) if (k !== 'loan') net += v;
      for (const [k, v] of Object.entries(d.expense)) if (k !== 'repay') net -= v;
    }
    (npcNet28[h.estate] ??= []).push(net / 4);
  }
  const pa = e.account(1)!;
  let pnet = 0;
  for (const d of pa.book) {
    for (const [k, v] of Object.entries(d.income)) if (k !== 'loan') pnet += v;
    for (const [k, v] of Object.entries(d.expense)) if (k !== 'repay') pnet -= v;
  }
  const wages = pa.book.reduce((s, d) => s + (d.income.wage ?? 0), 0) / 4;
  return {
    grain, npcNet28, playerNet28: [pnet / 4], playerMoney: pa.money, stuck: sim.stats.stuckEvents, collapses: sim.stats.collapses,
    maxNeglect: Math.max(...Object.values(sim.stats.maxNeglect)), bankrupt: e.bankrupt, playerBankrupt: sim.notices.filter((n) => n.kind === 'bankrupt').length, harvests: sim.stats.completed['farm.harvest'] ?? 0, wages,
  };
}

const t0 = Date.now();
const results: SeedResult[] = [];
for (let s = 1; s <= SEEDS; s++) {
  results.push(run(s));
  process.stdout.write(`시드 ${s}/${SEEDS} (${((Date.now() - t0) / 1000).toFixed(0)}초)\n`);
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const at = (d: number) => mean(results.map((r) => r.grain[Math.min(r.grain.length - 1, d)]));
const curve = [];
for (let y = 0; y < Math.ceil(DAYS / YEAR); y++) {
  const a = at(y * YEAR + SD * 2);
  const w = at(y * YEAR + SD * 4 - 1);
  curve.push({ year: y + 1, autumn: +a.toFixed(3), winterEnd: +w.toFixed(3), ratio: +(w / a).toFixed(3) });
}
const estates = Object.keys(E.estates).filter((k) => !k.startsWith('$'));
const budgets = estates.map((es) => {
  const nets = results.flatMap((r) => r.npcNet28[es] ?? []);
  const target = E.estates[es].target.net * 28;
  const v = mean(nets);
  return { estate: es, net28: +v.toFixed(1), target28: target, err: +((v - target) / target).toFixed(3), n: nets.length };
});
const model = existsSync('artifacts/econ/model.json') ? JSON.parse(readFileSync('artifacts/econ/model.json', 'utf8')) : null;
const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
for (const c of curve) checks.push({ name: `겨울 끝/가을 곡물 (${c.year}년)`, ok: c.ratio >= 1.5 && c.ratio <= 2.5, detail: `${c.autumn} → ${c.winterEnd} = ${c.ratio}배` });
for (const b of budgets) if (b.n) checks.push({ name: `${b.estate} 28일 순수입`, ok: Math.abs(b.err) <= 0.3, detail: `${b.net28}동화 (목표 ${b.target28}, ${(b.err * 100).toFixed(0)}%)` });
if (model) {
  for (const c of curve) {
    const mc = model.curve.find((x: { year: number }) => x.year === c.year);
    if (mc) checks.push({ name: `모델 대비 곡물 배율 (${c.year}년)`, ok: Math.abs(c.ratio - mc.ratio) / mc.ratio <= 0.2, detail: `헤드리스 ${c.ratio} / 모델 ${mc.ratio}` });
  }
  for (const b of budgets) {
    const mb = model.budgets.find((x: { estate: string }) => x.estate === b.estate);
    if (mb && b.n) checks.push({ name: `모델 대비 ${b.estate} 순수입`, ok: Math.abs(b.net28 / 28 - mb.net) / mb.net <= 0.2, detail: `헤드리스 ${(b.net28 / 28).toFixed(2)} / 모델 ${mb.net}` });
  }
}
const player = { net28: +mean(results.map((r) => r.playerNet28[0])).toFixed(1), target28: E.estates.freeman.target.net * 28, money: mean(results.map((r) => r.playerMoney)), wages28: mean(results.map((r) => r.wages)), harvests: mean(results.map((r) => r.harvests)) };
const health = { stuck: results.reduce((s, r) => s + r.stuck, 0), collapses: results.reduce((s, r) => s + r.collapses, 0), maxNeglect: Math.max(...results.map((r) => r.maxNeglect)), bankrupt: results.reduce((s, r) => s + r.playerBankrupt, 0) };
checks.push({ name: '조작 가문 stuck', ok: health.stuck === 0, detail: String(health.stuck) });
checks.push({ name: '조작 가문 쓰러짐 (시드당)', ok: health.collapses / SEEDS <= 1, detail: `${(health.collapses / SEEDS).toFixed(1)}` });
checks.push({ name: '조작 가문 파산', ok: health.bankrupt === 0, detail: String(health.bankrupt) });
checks.push({ name: '조작 가문 28일 순수입 ≥ 0', ok: player.net28 >= 0, detail: `${player.net28}동화 (자유민 목표 ${player.target28}, 전략 봇 고도화는 M8 프리셋에서)` });
const pass = checks.every((c) => c.ok);
mkdirSync('artifacts/econ', { recursive: true });
writeFileSync(OUT, JSON.stringify({ days: DAYS, seeds: SEEDS, curve, budgets, player, health, checks, pass, grainDaily: results[0].grain.map((v) => +v.toFixed(3)) }, null, 1));
console.log('곡물:', curve.map((c) => `${c.year}년 ${c.autumn}→${c.winterEnd} (${c.ratio}배)`).join(' / '));
console.log('신분별 28일:', budgets.map((b) => `${b.estate} ${b.net28}/${b.target28}`).join(', '));
console.log('조작 가문:', JSON.stringify(player), JSON.stringify(health));
const bad = checks.filter((c) => !c.ok);
console.log(pass ? '\n헤드리스 경제: 통과' : `\n헤드리스 경제: 실패 ${bad.length}건\n` + bad.map((c) => `  ✗ ${c.name}: ${c.detail}`).join('\n'));
console.log(`${((Date.now() - t0) / 1000).toFixed(0)}초`);
process.exit(pass ? 0 : 1);
