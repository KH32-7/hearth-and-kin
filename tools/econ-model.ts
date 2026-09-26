/**
 * 경제 모델 (GDD 17-10): M4 코드 전에 표 계산 수준으로 먼저 맞춤.
 *   npx tsx tools/econ-model.ts [--days 56] [--seeds 50] [--out artifacts/econ/model.json]
 * 1) 마을 장부 가격 곡선 (곡물/채소, 가을 추수 직후 → 겨울 끝, 29-1 목표 1.5~2.5배)
 * 2) 신분별 하루 수지 (17-4 목표 대비), 3) 농가 한 해 식량 자급률 (29-1 90~120%, 흉년 60~80%)
 * 4) 시작 프리셋 21개(7 신분 × 3 형편)의 첫 세대 몰락 확률 (몬테카를로, 29-1)
 * 결과는 BALANCE.md 에 기록. 헤드리스(M4 게임 경제)와 20% 넘게 어긋나면 이 모델부터 고침
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Rng } from '../src/sim/core/rng';
import { priceMult, targetStock } from '../src/sim/econ/ledger';

type Estate = 'serf' | 'freeman' | 'artisan' | 'merchant' | 'clergy' | 'knight' | 'noble';
const ESTATES: Estate[] = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'];

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const DAYS = Number(arg('days', '56'));
const SEEDS = Number(arg('seeds', '50'));
const OUT = arg('out', 'artifacts/econ/model.json');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const E: any = JSON.parse(readFileSync('src/data/economy.json', 'utf8'));
const SD: number = E.calendar.seasonDays;
const SEASONS: string[] = E.calendar.seasons;
const YEAR = SD * 4;
const goods = Object.fromEntries(Object.entries(E.goods).filter(([k]) => !k.startsWith('$'))) as Record<string, { base: number; food: boolean; perCapita: number; spoil?: { value: number; scale: string } }>;
const P = (pennies: number): number => pennies * 4;

function adultEq(es: Estate): number {
  const m = E.estates[es].members;
  return m.adults + m.children * E.household.childShare;
}

/** 부패: 하루에 남는 비율 (기간 d 일이면 1 - 1/d) */
function keepRate(g: string): number {
  const sp = goods[g].spoil;
  if (!sp) return 1;
  const days = sp.scale === 'season' ? sp.value * (SD / 7) : sp.value;
  return Math.max(0, 1 - 1 / days);
}

// ---------------------------------------------------------------- 1) 장부 가격 곡선

interface PriceRun {
  mult: Record<string, number[]>;
  q: Record<string, number[]>;
  imports: Record<string, number>;
}

function farmHouseholds(): Array<{ es: Estate; n: number; plots: number }> {
  const out = [];
  for (const es of ESTATES) {
    const plots = E.estates[es].incomes.plots ?? 0;
    if (plots > 0) out.push({ es, n: E.ledger.households[es], plots });
  }
  return out;
}

function runLedger(yearMults: number[]): PriceRun {
  const L = E.ledger;
  const F = E.farming;
  const pop = L.population;
  const tracked = ['grain', 'vegetables'];
  const Q: Record<string, number> = {};
  const Qs: Record<string, number> = {};
  for (const g of tracked) {
    Qs[g] = targetStock(pop, goods[g].perCapita, SD, L.targetSeasons);
    // 시작(봄 1일): 지난 추수 뒤 절반 정도 남음
    Q[g] = Qs[g] * (g === 'grain' ? 1.0 : 0.3);
  }
  const mult: Record<string, number[]> = { grain: [], vegetables: [] };
  const qs: Record<string, number[]> = { grain: [], vegetables: [] };
  const imports: Record<string, number> = { grain: 0, vegetables: 0 };
  // 농가 자기 곳간 (곡물). 시작은 1년치의 절반
  const farms = farmHouseholds().map((f) => ({ ...f, grain: adultEq(f.es) * E.diet[f.es].grain * YEAR * 0.5 }));
  let granary = 0;
  for (let d = 0; d < DAYS; d++) {
    const season = SEASONS[Math.floor(d / SD) % 4];
    const inSeason = d % SD;
    const year = Math.floor(d / YEAR);
    const ym = yearMults[year % yearMults.length];
    // 추수
    if (season === F.harvestSeason.grain && inSeason === F.harvestDay.grain) {
      let total = 0;
      for (const f of farms) {
        const per = f.plots * F.plotYearYield.grain * (SD / 7) * ym * (1 - F.seedShare);
        total += per * f.n;
        const keep = adultEq(f.es) * E.diet[f.es].grain * YEAR * 1.05; // 다음 추수까지 + 조금
        const toGranary = per * L.lordGranaryShare.grain;
        const net = per - toGranary;
        const fh = f.grain + net;
        const sell = Math.max(0, fh - keep);
        f.grain = fh - sell;
        // 잉여의 일부만 마을 장부로, 나머지는 외지 상인에게 (현금 수입)
        Q.grain += sell * F.villageSaleShare * f.n;
        granary += toGranary * f.n;
      }
      void total;
    }
    const vegHarvest = (F.harvestSeason.vegetables as string[]).includes(season) && inSeason === F.harvestDay.vegetables;
    if (vegHarvest) for (const f of farms) Q.vegetables += f.plots * F.plotYearYield.vegetables * (SD / 7) * ym * 0.5 * 0.7 * f.n; // 30% 는 자가 소비
    if ((F.garden.seasons as string[]).includes(season)) for (const f of farms) Q.vegetables += F.garden.vegetablesPerDay * 0.5 * f.n; // 텃밭 잉여 절반 판매
    // 영주 곳간: 곡물 값이 오르면 풀림
    const lastMult = mult.grain.length ? mult.grain[mult.grain.length - 1] : 1;
    if (lastMult >= L.lordGranaryShare.releaseAtMult && granary > 0) {
      const r = Math.min(granary, L.lordGranaryShare.releasePerCapita * pop);
      granary -= r;
      Q.grain += r;
    }
    // 소비: 비농가는 전부 장부에서, 농가는 자기 곳간 먼저
    for (const g of tracked) {
      let demand = 0;
      for (const es of ESTATES) {
        const n = L.households[es];
        const need = adultEq(es) * (E.diet[es][g] ?? 0) * n;
        const farm = farms.find((f) => f.es === es);
        if (farm && g === 'grain') {
          const perH = adultEq(es) * E.diet[es].grain;
          const own = Math.min(farm.grain, perH);
          farm.grain -= own;
          demand += (perH - own) * n;
        } else if (farm && g === 'vegetables') {
          // 텃밭 계절엔 자급, 아니면 절반은 저장 채소/절임으로
          demand += (F.garden.seasons as string[]).includes(season) ? need * 0.2 : need * 0.6;
        } else demand += need;
      }
      Q[g] = Math.max(0, Q[g] - demand);
      Q[g] *= keepRate(g);
      let m = priceMult(Qs[g], Q[g], L.elasticity.food, L.clamp[0], L.clamp[1]);
      // 외부 교역 안전판
      const cap = L.tradeCapPerDay.food * pop;
      if (m >= L.importAt) {
        Q[g] += cap;
        imports[g] += cap;
      } else if (m <= L.exportAt) Q[g] = Math.max(0, Q[g] - cap);
      m = priceMult(Qs[g], Q[g], L.elasticity.food, L.clamp[0], L.clamp[1]);
      mult[g].push(m);
      qs[g].push(Q[g]);
    }
  }
  return { mult, q: qs, imports };
}

// ---------------------------------------------------------------- 2) 신분별 수지

function avg(a: number[]): number {
  return a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
}

function budget(es: Estate, priceAvg: Record<string, number>, yearMult = 1) {
  const x = E.estates[es];
  const inc = x.incomes;
  const I = E.income;
  const parts: Record<string, number> = {};
  if (inc.wage) parts.wage = inc.wage.workers * inc.wage.daily * (inc.wage.daysPerWeek / 7);
  if (inc.plots) {
    // 밭 산출을 현물 수입으로 (장부 평균가로 환산, 동화)
    const g = inc.plots * E.farming.plotYearYield.grain * yearMult * (1 - E.farming.seedShare) / YEAR;
    const v = inc.plots * E.farming.plotYearYield.vegetables * yearMult / YEAR + E.farming.garden.vegetablesPerDay * 0.75;
    // 자가 소비분과 외지 판매분 모두 기준가 (마을 장부 판매분은 적어서 무시)
    parts.plots = (g * goods.grain.base + v * goods.vegetables.base) / 4;
  }
  if (inc.homecraft) parts.homecraft = inc.homecraft;
  if (inc.shop) parts.shop = inc.shop.salesPerDay * (1 - inc.shop.materialShare);
  if (inc.trade) {
    const t = inc.trade;
    const r = I.trade.baseReturn + t.skillReckoning * I.trade.perReckoning + t.skillStory * I.trade.perStory + t.rankBonus;
    const expected = t.capital * r * (1 - I.trade.lossChance) - t.capital * I.trade.lossChance * (I.trade.lossRange[0] + I.trade.lossRange[1]) / 2 * 0.5;
    parts.trade = (expected - I.trade.costPerDay * t.tripDays) / (t.tripDays + t.prepDays);
  }
  if (inc.stipend) parts.stipend = inc.stipend;
  if (inc.sacraments) parts.sacraments = inc.sacraments;
  if (inc.tenants) parts.tenants = inc.tenants * I.tenantPerDay;
  if (inc.manors) parts.manors = inc.manors * I.manorPerDay;
  if (inc.prizes) parts.prizes = inc.prizes;
  if (inc.fees) parts.fees = inc.fees;
  const gross = Object.values(parts).reduce((a, b) => a + b, 0);
  // 지출
  const ae = adultEq(es);
  let food = 0;
  // 농가는 제 밭에서 먹으므로 기준가, 나머지는 장부 평균가로 사 먹음
  const farm = (inc.plots ?? 0) > 0;
  for (const [g, q] of Object.entries(E.diet[es] as Record<string, number>)) food += ae * q * goods[g].base * (farm ? 1 : (priceAvg[g] ?? 1));
  food /= 4;
  const fuel = x.fuelBundles * goods.firewood.base / 4;
  const upkeep = x.upkeep;
  const tithe = x.tithed === false ? 0 : gross * E.tax.tithe;
  const wealth = gross * (E.tax.wealthDays[es] ?? 0);
  const tax = x.taxed ? (wealth * E.tax.rates[E.tax.default] * (YEAR / 28)) / YEAR : 0;
  const guild = es === 'artisan' ? E.tax.guildDuesPerDay : 0;
  const spend = food + fuel + upkeep + tithe + tax + guild;
  return { parts, gross, food, fuel, upkeep, tithe, tax, guild, spend, net: gross - spend };
}

// ---------------------------------------------------------------- 3) 농가 자급률

function farmCoverage(es: Estate, yearMult: number) {
  const x = E.estates[es];
  const plots = x.incomes.plots;
  const F = E.farming;
  const grain = plots * F.plotYearYield.grain * yearMult * (1 - F.seedShare) * (1 - E.ledger.lordGranaryShare.grain);
  const veg = plots * F.plotYearYield.vegetables * yearMult + F.garden.vegetablesPerDay * SD * 3;
  const value = grain * goods.grain.base + veg * goods.vegetables.base; // 파딩
  const ae = adultEq(es);
  let foodNeed = 0;
  for (const [g, q] of Object.entries(E.diet[es] as Record<string, number>)) foodNeed += ae * q * goods[g].base * YEAR;
  const b = budget(es, { grain: 1, vegetables: 1 }, yearMult);
  const taxNeed = (b.tax + b.tithe) * 4 * YEAR;
  return { value, need: foodNeed + taxNeed, ratio: value / (foodNeed + taxNeed) };
}

// ---------------------------------------------------------------- 4) 첫 세대 몰락 확률

function survival(es: Estate, wealth: 'poor' | 'normal' | 'rich', seeds: number) {
  const x = E.estates[es];
  const S = x.target.net * E.presets.savingsDays;
  const start = P(S * E.presets.wealth[wealth]);
  const sh = E.shocks;
  const b = budget(es, { grain: 1, vegetables: 1 });
  const debtLimit = P(x.target.net * E.loans.limitDays + x.target.gross * x.assetsDays * E.loans.collateralShare);
  let survived = 0;
  let reliefDays = 0;
  for (let s = 0; s < seeds; s++) {
    const rng = new Rng(9000 + s * 131 + ESTATES.indexOf(es) * 7 + (wealth === 'poor' ? 1 : wealth === 'rich' ? 2 : 0));
    let money = start;
    let over = 0;
    let broke = false;
    let sick = 0;
    let yearMult = 1;
    for (let d = 0; d < E.presets.savingsDays; d++) {
      if (d % YEAR === 0) {
        const r = rng.next();
        yearMult = r < E.farming.yearChance.bad ? E.farming.yieldMult.bad : r > 1 - E.farming.yearChance.good ? E.farming.yieldMult.good : 1;
      }
      if (sick <= 0 && rng.next() < sh.illnessPerDay) sick = Math.round(rng.range(sh.illnessDays[0], sh.illnessDays[1]));
      const work = sick > 0 ? 0.3 : 1;
      if (sick > 0) sick--;
      const noise = 1 + (rng.next() * 2 - 1) * sh.incomeNoise;
      const plotsPart = b.parts.plots ?? 0;
      // 무작위 봇: 전략 봇 순수입의 일부만 모음 (관리 소홀, 17-10 첫 세대 몰락 추정)
      const slack = (b.gross - b.spend) * (1 - (sh.botNetShare[es] ?? sh.randomBotNetShare));
      const gross = (b.gross - plotsPart) * work * noise + plotsPart * yearMult;
      let day = gross - b.spend - slack;
      // 큰 불운 (화재, 소송, 전쟁 징발, 투자 실패): 한 인생 기대 횟수, 비용은 S 배수
      if (rng.next() < sh.catastrophePerLife / E.presets.savingsDays) day -= S * rng.range(sh.catastropheCost[0], sh.catastropheCost[1]);
      // 빚 이자
      if (money < 0) day -= (-money / 4) * E.loans.dailyInterest.plain;
      money += P(day);
      // 구휼: 돈이 하루 생활비보다 적으면 교회 빵 (식비만큼 덜 씀)
      if (money < P(b.spend)) {
        reliefDays++;
        money += P(b.food * 0.6);
      }
      if (money < -debtLimit) {
        over++;
        if (over > E.loans.graceDays) {
          broke = true;
          break;
        }
      } else over = 0;
    }
    if (!broke) survived++;
  }
  return { rate: survived / seeds, reliefPerLife: reliefDays / seeds };
}

// ---------------------------------------------------------------- 실행

const years = Math.ceil(DAYS / YEAR);
const normal = runLedger(Array(years).fill(1));
const bad = runLedger([E.farming.yieldMult.bad, 1]);
const priceAvg: Record<string, number> = { grain: avg(normal.mult.grain), vegetables: avg(normal.mult.vegetables) };

const at = (arr: number[], d: number) => arr[Math.min(arr.length - 1, d)];
const autumnStart = (y: number) => y * YEAR + SD * 2; // 가을 1일
const winterEnd = (y: number) => y * YEAR + SD * 4 - 1; // 겨울 마지막 날
const curve = [];
for (let y = 0; y < years; y++) {
  const a = at(normal.mult.grain, autumnStart(y));
  const w = at(normal.mult.grain, winterEnd(y));
  curve.push({ year: y + 1, autumn: +a.toFixed(3), winterEnd: +w.toFixed(3), ratio: +(w / a).toFixed(3) });
}

const budgets = ESTATES.map((es) => {
  const b = budget(es, priceAvg);
  const t = E.estates[es].target;
  return {
    estate: es, gross: +b.gross.toFixed(2), spend: +b.spend.toFixed(2), net: +b.net.toFixed(2), targetNet: t.net,
    netErr: +((b.net - t.net) / t.net).toFixed(3), grossErr: +((b.gross - t.gross) / t.gross).toFixed(3), spendErr: +((b.spend - t.spend) / t.spend).toFixed(3),
    parts: Object.fromEntries(Object.entries(b.parts).map(([k, v]) => [k, +v.toFixed(2)])),
    costs: { food: +b.food.toFixed(2), fuel: +b.fuel.toFixed(2), upkeep: b.upkeep, tithe: +b.tithe.toFixed(2), tax: +b.tax.toFixed(2), guild: b.guild },
  };
});

const coverage = (['serf', 'freeman'] as Estate[]).map((es) => ({
  estate: es, normal: +farmCoverage(es, 1).ratio.toFixed(3), bad: +farmCoverage(es, E.farming.yieldMult.bad).ratio.toFixed(3),
}));

const presets = ESTATES.flatMap((es) => (['poor', 'normal', 'rich'] as const).map((w) => {
  const r = survival(es, w, SEEDS);
  return { estate: es, wealth: w, survive: +r.rate.toFixed(3), reliefDaysPerLife: +r.reliefPerLife.toFixed(2) };
}));

// ---------------------------------------------------------------- 판정
const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
for (const c of curve) checks.push({ name: `겨울 끝/가을 곡물 가격 (${c.year}년)`, ok: c.ratio >= 1.5 && c.ratio <= 2.5, detail: `${c.autumn} → ${c.winterEnd} = ${c.ratio}배 (목표 1.5~2.5)` });
for (const b of budgets) checks.push({ name: `${b.estate} 일 순수입`, ok: Math.abs(b.netErr) <= 0.1, detail: `${b.net} (목표 ${b.targetNet}, 오차 ${(b.netErr * 100).toFixed(1)}%, 모델 허용 ±10%)` });
for (const c of coverage) {
  if (c.estate !== 'freeman') continue;
  checks.push({ name: '자유민 3구획 식량 자급률', ok: c.normal >= 0.9 && c.normal <= 1.2, detail: `${c.normal} (목표 0.9~1.2)` });
  checks.push({ name: '자유민 흉년 자급률', ok: c.bad >= 0.6 && c.bad <= 0.8, detail: `${c.bad} (목표 0.6~0.8)` });
}
for (const p of presets) {
  const lo = p.wealth === 'poor' ? 0.45 : p.wealth === 'rich' ? 0.85 : 0.7;
  const hi = p.estate === 'noble' && p.wealth === 'normal' ? 0.9 : 1.0;
  checks.push({ name: `${p.estate}/${p.wealth} 첫 세대 유지`, ok: p.survive >= lo && p.survive <= hi, detail: `${p.survive} (목표 ${lo}~${hi})` });
}

const pass = checks.every((c) => c.ok);
mkdirSync(OUT.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify({ days: DAYS, seeds: SEEDS, curve, badYear: { grainRatioY1: +(at(bad.mult.grain, winterEnd(0)) / at(bad.mult.grain, autumnStart(0))).toFixed(3) }, priceAvg, imports: normal.imports, budgets, coverage, presets, checks, pass, grainDaily: normal.mult.grain.map((v) => +v.toFixed(3)), vegDaily: normal.mult.vegetables.map((v) => +v.toFixed(3)) }, null, 1));

console.log('곡물 가격 곡선:', curve.map((c) => `${c.year}년 가을 ${c.autumn} → 겨울 끝 ${c.winterEnd} (${c.ratio}배)`).join(' / '));
console.log('곡물 배수 일별:', normal.mult.grain.map((v) => v.toFixed(2)).join(' '));
console.log('채소 배수 일별:', normal.mult.vegetables.map((v) => v.toFixed(2)).join(' '));
console.log('신분별 일 수지 (동화):');
for (const b of budgets) console.log(`  ${b.estate.padEnd(8)} 총 ${b.gross.toFixed(1).padStart(6)} 지출 ${b.spend.toFixed(1).padStart(6)} 순 ${b.net.toFixed(1).padStart(6)} / 목표 ${b.targetNet} (${(b.netErr * 100).toFixed(0)}%)  ${JSON.stringify(b.parts)} ${JSON.stringify(b.costs)}`);
console.log('농가 자급률:', JSON.stringify(coverage));
console.log('첫 세대 유지:', presets.map((p) => `${p.estate}/${p.wealth} ${p.survive}`).join(', '));
const bad2 = checks.filter((c) => !c.ok);
console.log(pass ? '\n경제 모델: 통과' : `\n경제 모델: 실패 ${bad2.length}건\n` + bad2.map((c) => `  ✗ ${c.name}: ${c.detail}`).join('\n'));
process.exit(pass ? 0 : 1);
