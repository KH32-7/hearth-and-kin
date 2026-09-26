/**
 * 마을 경제 (GDD 17-4 ~ 17-9). 하루 한 번(자정) 정산.
 * - 장부: 품목별 마을 재고 Q, 목표 재고, 가격 배수 (17-8). 외부 교역 안전판, 영주 곳간
 * - 가정 계정: 돈(파딩 정수) + 저장고(조작 가문은 world.stock). NPC 가정은 요약 LOD (13-6): 수입/소비를 식으로 정산
 * - 십일조(파딩 미만 이월), 가을 세금, 길드 회비, 빚 이자와 상환, 구휼 (17-6, 17-9)
 * 수치는 economy.json. tools/econ-model 과 같은 식 (ledger.ts)
 * 렌더러/DOM 없음 (워커)
 */
import type { Rng } from '../core/rng';
import { priceMult, takeShare, targetStock, unitPrice } from './ledger';

/** 장부가 실제로 움직이는 품목 (생산이 모형화됨). 나머지는 정상 상태 */
const DYNAMIC = new Set(['grain', 'vegetables']);

export type EstateId = 'serf' | 'freeman' | 'artisan' | 'merchant' | 'clergy' | 'knight' | 'noble';
export const ESTATE_IDS: EstateId[] = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'];

/* eslint-disable @typescript-eslint/no-explicit-any */
export type EconomyData = any;

export interface GoodState {
  q: number;
  qStar: number;
  mult: number;
  /** 전날 배수 (장터 가격표 등락 화살표) */
  prev: number;
}

export interface Loan {
  id: number;
  principal: number;
  /** 누적 이자 (파딩, 소수 포함) */
  interest: number;
  rate: number;
  due: number;
  lender: string;
}

/** 하루 가계 기록 (가계부 17-6) */
export interface DayBook {
  day: number;
  income: Record<string, number>;
  expense: Record<string, number>;
  money: number;
}

export interface Account {
  household: number;
  estate: EstateId;
  money: number;
  titheCarry: { v: number };
  loans: Loan[];
  /** 오늘 들어오고 나간 돈 (분류별, 파딩) */
  today: DayBook;
  book: DayBook[];
  /** 구휼 받은 연속 일수 */
  reliefDays: number;
  /** 오늘 번 수입 (십일조 대상) */
  titheBase: number;
  /** 대출 한도를 넘는 빚이 이어진 날 (파산 유예) */
  overLimitDays?: number;
  /** 구휼 받은 누적 횟수 */
  reliefCount?: number;
}

export interface NpcHousehold {
  id: number;
  estate: EstateId;
  adults: number;
  children: number;
  plots: number;
  grain: number;
  acct: Account;
}

export class Economy {
  readonly goods: Record<string, GoodState> = {};
  readonly accounts = new Map<number, Account>();
  readonly npcs: NpcHousehold[] = [];
  granary = 0;
  private nextLoan = 1;
  private yearMult = 1;
  /** 올해 작황 배수 (조작 가문 밭 수확에도 곱함, 31-5) */
  get yearMultNow(): number {
    return this.yearMult;
  }
  /** 오늘 외지에서 들여오거나 내보낸 양 (보고용) */
  readonly trade: Record<string, number> = {};
  /** 파산 가정 수 (누적) */
  bankrupt = 0;
  /**
   * 영주 정책과 역병 (M9, society/policy.ts · plagueLite.ts): 세율, 품목 가격 배수(고기·공산품), 장인 수입,
   * 장터 거래량(역병 격리), 외부 교역 차단. 없으면 기본 규칙
   */
  policy: {
    taxRate(rates: Record<string, number>): number;
    priceMult(good: string): number;
    artisanIncomeMult(): number;
    tradeBlocked(): boolean;
  } | null = null;
  plagueTrade: (() => { mult: number; blocked: boolean }) | null = null;

  constructor(readonly d: EconomyData, private rng: Rng) {
    const L = d.ledger;
    const SD = d.calendar.seasonDays;
    for (const [g, def] of Object.entries(d.goods as Record<string, { perCapita: number }>)) {
      if (g.startsWith('$')) continue;
      const qStar = targetStock(L.population, def.perCapita, SD, L.targetSeasons);
      this.goods[g] = { q: qStar * (g === 'grain' ? 1.0 : g === 'vegetables' ? 0.3 : 1.0), qStar, mult: 1, prev: 1 };
    }
    // NPC 가정 (요약 LOD). 조작 가문은 따로 openAccount
    let id = 1000;
    for (const es of ESTATE_IDS) {
      const n = L.households[es] ?? 0;
      const x = d.estates[es];
      for (let i = 0; i < n; i++) {
        const acct = this.newAccount(id, es);
        acct.money = Math.round(this.S(es) * d.presets.wealth.normal * 4);
        const plots = x.incomes.plots ?? 0;
        const ae = x.members.adults + x.members.children * d.household.childShare;
        this.npcs.push({ id, estate: es, adults: x.members.adults, children: x.members.children, plots, grain: plots > 0 ? ae * d.diet[es].grain * SD * 4 * 0.5 : 0, acct });
        this.accounts.set(id, acct);
        id++;
      }
    }
    this.updatePrices();
  }

  /** 이 가정의 오늘 가을 세금 (파딩). 세금일이 아니면 0 */
  taxDue(a: Account, day: number): number {
    const d = this.d;
    const SD = d.calendar.seasonDays;
    const season = d.calendar.seasons[Math.floor(day / SD) % 4];
    if (season !== d.tax.season || day % SD !== 0 || !d.estates[a.estate].taxed) return 0;
    const x = d.estates[a.estate];
    return Math.round(x.target.gross * (d.tax.wealthDays[a.estate] ?? 0) * 4 * (this.policy ? this.policy.taxRate(d.tax.rates) : d.tax.rates[d.tax.default]) * ((SD * 4) / 28));
  }

  /** 한 인생 저축 목표 S (동화) = 일 순수입 목표 × savingsDays */
  S(es: EstateId): number {
    return this.d.estates[es].target.net * this.d.presets.savingsDays;
  }

  private newAccount(household: number, estate: EstateId): Account {
    return { household, estate, money: 0, titheCarry: { v: 0 }, loans: [], today: { day: 0, income: {}, expense: {}, money: 0 }, book: [], reliefDays: 0, titheBase: 0 };
  }

  /** 조작 가문 가정 계정 (시작 자금: 신분 S × 형편 배수) */
  openAccount(household: number, estate: EstateId, wealth: 'poor' | 'normal' | 'rich' = 'normal'): Account {
    const a = this.newAccount(household, estate);
    const start = Math.round(this.S(estate) * this.d.presets.wealth[wealth] * 4);
    if (start >= 0) a.money = start;
    else this.borrow(a, -start, 'moneylender', 28);
    this.accounts.set(household, a);
    return a;
  }

  account(household: number): Account | undefined {
    return this.accounts.get(household);
  }

  // ---------------------------------------------------------------- 가격

  /** 장부 품목 한 단위 가격 (파딩, 묶음은 단위값). 17-8 */
  goodPrice(good: string): number {
    const g = this.d.goods[good];
    if (!g) return 0;
    return unitPrice(g.base * (this.policy?.priceMult(good) ?? 1), this.goods[good]?.mult ?? 1, g.bundle);
  }

  /** 저장고 품목 가격: 품목 기준가 × 연결된 장부 품목의 배수 (items.json ledger) */
  itemPrice(item: { base: number; ledger?: string | null; bundle?: { n: number; price: number } }): number {
    const m = item.ledger ? (this.goods[item.ledger]?.mult ?? 1) : 1;
    const pm = this.policy && item.ledger ? this.policy.priceMult(item.ledger) : 1;
    return unitPrice(item.base * pm, m, item.bundle);
  }

  private updatePrices(): void {
    const L = this.d.ledger;
    for (const [g, st] of Object.entries(this.goods)) {
      st.prev = st.mult;
      if (!DYNAMIC.has(g)) {
        // 정상 상태 품목: 조작 가정이 사고판 만큼만 잠깐 흔들렸다가 목표 재고로 돌아감 (하루 20%)
        st.q += (st.qStar - st.q) * 0.2;
      }
      const eps = this.d.goods[g].food ? L.elasticity.food : L.elasticity.other;
      // 장부 소비가 없는 품목(빵/밀가루/철 …, perCapita 0)은 목표 재고가 없어 기준가 그대로
      st.mult = st.qStar > 0 ? priceMult(st.qStar, st.q, eps, L.clamp[0], L.clamp[1]) : 1;
    }
  }

  // ---------------------------------------------------------------- 돈 흐름

  /** 수입 (십일조 대상). 분류: wage shop sale trade harvest rent gift … */
  earn(a: Account, amount: number, kind: string, tithed = true): void {
    if (amount <= 0) return;
    a.money += amount;
    a.today.income[kind] = (a.today.income[kind] ?? 0) + amount;
    if (tithed) a.titheBase += amount;
  }

  /** 지출. 돈이 모자라도 빼고(음수 = 외상) 하루 끝 정산에서 빚으로 돌림 */
  spend(a: Account, amount: number, kind: string): void {
    if (amount <= 0) return;
    a.money -= amount;
    a.today.expense[kind] = (a.today.expense[kind] ?? 0) + amount;
  }

  /** 장부에서 사기: 가격 × n 을 내고 장부 재고가 줄어듦. 돈이 모자라면 살 수 있는 만큼만. 산 개수를 돌려줌 */
  /** credit = 외상으로 더 쓸 수 있는 돈 (파딩, 17-6: 자정 정산에서 빚이 됨) */
  buy(a: Account, item: { base: number; ledger?: string | null; bundle?: { n: number; price: number }; ration?: number | null }, n: number, kind = 'food', credit = 0): number {
    const p = this.itemPrice(item);
    const afford = Math.max(0, Math.floor((a.money + credit) / Math.max(1, p)));
    const k = Math.min(n, afford);
    if (k <= 0) return 0;
    this.spend(a, Math.round(p * k), kind);
    if (item.ledger && this.goods[item.ledger]) this.goods[item.ledger].q = Math.max(0, this.goods[item.ledger].q - k * (item.ration ?? 1));
    return k;
  }

  /** 장부에 팔기: 가격 × n 을 받고 장부 재고가 늘어남 */
  sell(a: Account, item: { base: number; ledger?: string | null; bundle?: { n: number; price: number }; ration?: number | null }, n: number, kind = 'sale'): number {
    if (n <= 0) return 0;
    const p = this.itemPrice(item);
    this.earn(a, Math.round(p * n), kind);
    if (item.ledger && this.goods[item.ledger]) this.goods[item.ledger].q += n * (item.ration ?? 1);
    return Math.round(p * n);
  }

  borrow(a: Account, amount: number, lender: string, termDays: number, day = 0, honor = 'plain'): Loan {
    const rate = this.d.loans.dailyInterest[honor] ?? this.d.loans.dailyInterest.plain;
    const loan: Loan = { id: this.nextLoan++, principal: amount, interest: 0, rate: lender === 'kin' ? 0 : rate, due: day + termDays, lender };
    a.loans.push(loan);
    a.money += amount;
    a.today.income.loan = (a.today.income.loan ?? 0) + amount;
    return loan;
  }

  debt(a: Account): number {
    let s = 0;
    for (const l of a.loans) s += l.principal + Math.floor(l.interest);
    return s;
  }

  /** 대출 한도 (17-6): 담보 × 50% + 일 순수입 목표 × 20일 (파딩) */
  loanLimit(a: Account): number {
    const x = this.d.estates[a.estate];
    return Math.round((x.target.gross * x.assetsDays * this.d.loans.collateralShare + x.target.net * this.d.loans.limitDays) * 4);
  }

  // ---------------------------------------------------------------- 하루 정산 (자정)

  /**
   * @param day 방금 끝난 날 (0부터)
   * @param playerFood 조작 가정의 오늘 식량 부족분 계산기 (가정 id → 부족 ration). 조작 가정은 실제로 먹은 것이 이미 저장고에서 빠졌으므로 부족분만 (17-9)
   */
  endOfDay(day: number, hooks: { playerShortfall?: (a: Account) => number; notice?: (household: number, kind: string, args?: Record<string, string | number>) => void; /** 압류 (17-6): 빚(파딩)만큼 살림을 가져가고 가져간 값을 돌려줌 */ seize?: (a: Account, owe: number) => number } = {}): void {
    const d = this.d;
    const SD = d.calendar.seasonDays;
    const YEAR = SD * 4;
    const season = d.calendar.seasons[Math.floor(day / SD) % 4];
    const inSeason = day % SD;
    if (day % YEAR === 0) {
      const r = this.rng.next();
      const F = d.farming;
      this.yearMult = r < F.yearChance.bad ? F.yieldMult.bad : r > 1 - F.yearChance.good ? F.yieldMult.good : 1;
    }
    this.npcDay(day, season, inSeason);
    // 영주 곳간: 곡물 값이 오르면 풀림
    const LG = d.ledger.lordGranaryShare;
    if (this.goods.grain && this.goods.grain.mult >= LG.releaseAtMult && this.granary > 0) {
      const r = Math.min(this.granary, LG.releasePerCapita * d.ledger.population);
      this.granary -= r;
      this.goods.grain.q += r;
    }
    // 부패 (장부 재고도 상함). 생산이 모형화된 품목(곡물/채소)만 장부가 움직임. 나머지는 마을 안 생산·소비가 맞는 정상 상태(배수 1)로 봄 (가축 22장, 공방 17-3 이 연결되면 풀기)
    for (const [g, st] of Object.entries(this.goods)) {
      if (!DYNAMIC.has(g)) continue;
      const sp = d.goods[g].spoil;
      if (!sp) continue;
      const days = sp.scale === 'season' ? sp.value * (SD / 7) : sp.value;
      st.q *= Math.max(0, 1 - 1 / days);
    }
    // 외부 교역 안전판 (17-8)
    const L = d.ledger;
    for (const [g, st] of Object.entries(this.goods)) {
      if (!DYNAMIC.has(g)) continue;
      const food = d.goods[g].food;
      const cap = (food ? L.tradeCapPerDay.food : L.tradeCapPerDay.other) * L.population;
      this.trade[g] = 0;
      if (this.policy?.tradeBlocked() && this.plagueTrade?.().blocked) {
        // 도시 봉쇄 (18-4 역병 대응): 외부 교역 없음
      } else if (st.mult >= L.importAt) {
        st.q += cap;
        this.trade[g] = cap;
      } else if (st.mult <= L.exportAt) {
        const out = Math.min(st.q, cap);
        st.q -= out;
        this.trade[g] = -out;
      }
    }
    // 가정 정산: 십일조 → (조작 가정 부족분 구매) → 구휼 → 빚 이자 → 기록
    for (const a of this.accounts.values()) {
      const tithe = d.estates[a.estate].tithed === false ? 0 : takeShare(a.titheBase, d.tax.tithe, a.titheCarry);
      if (tithe > 0) this.spend(a, tithe, 'tithe');
      a.titheBase = 0;
      if (hooks.playerShortfall && a.household < 1000) {
        const short = hooks.playerShortfall(a);
        if (short > 0) {
          const bought = this.buy(a, { base: d.goods.grain.base, ledger: 'grain', ration: 1 }, Math.ceil(short), 'food');
          if (bought < short) this.relief(a, day, hooks.notice);
        } else a.reliefDays = 0;
      }
      // 세금: 가을 첫날 (17-6)
      if (season === d.tax.season && inSeason === 0 && d.estates[a.estate].taxed) {
        const x = d.estates[a.estate];
        const wealth = x.target.gross * (d.tax.wealthDays[a.estate] ?? 0) * 4;
        const tax = Math.round(wealth * (this.policy ? this.policy.taxRate(d.tax.rates) : d.tax.rates[d.tax.default]) * (YEAR / 28));
        this.spend(a, tax, 'tax');
        hooks.notice?.(a.household, 'tax_paid', { n: tax });
      }
      // 길드 회비: 계절 첫날
      if (a.estate === 'artisan' && inSeason === 0) this.spend(a, Math.round(d.tax.guildDuesPerDay * SD * 4), 'guild');
      // 빚: 이자, 외상 정리, 상환일
      for (const l of a.loans) l.interest += l.principal * l.rate;
      if (a.money < 0) {
        // 외상은 대출 한도까지 빌려 메움 (부분 대출). 한도를 넘는 빚이 유예 기간 넘게 이어지면 파산 (econ-model 과 같은 규칙)
        const room = Math.max(0, this.loanLimit(a) - this.debt(a));
        const take = Math.min(-a.money, room);
        if (take > 0) this.borrow(a, take, 'moneylender', d.loans.termDays[0], day);
      }
      if (a.money < 0) {
        a.overLimitDays = (a.overLimitDays ?? 0) + 1;
        if (a.overLimitDays > d.loans.graceDays) {
          this.bankrupt++;
          hooks.notice?.(a.household, 'bankrupt', { n: -a.money });
          a.loans = [];
          a.money = 0;
          a.overLimitDays = 0;
        }
      } else a.overLimitDays = 0;
      for (const l of [...a.loans]) {
        if (day < l.due) continue;
        const owe = l.principal + Math.floor(l.interest);
        if (a.money >= owe) {
          this.spend(a, owe, 'repay');
          a.loans.splice(a.loans.indexOf(l), 1);
          hooks.notice?.(a.household, 'loan_repaid', { n: owe });
          continue;
        }
        // 상환일이 지남 (17-6): 가진 돈만큼 먼저 갚음 (이자부터)
        if (a.money > 0) {
          const pay = a.money;
          this.spend(a, pay, 'repay');
          const fromInterest = Math.min(Math.floor(l.interest), pay);
          l.interest -= fromInterest;
          l.principal -= pay - fromInterest;
        }
        if (day >= l.due + d.loans.graceDays) {
          // 유예 끝: 압류 → 압류한 재산이 빚보다 작으면 파산 (16-3 하락)
          const left = l.principal + Math.floor(l.interest);
          const seized = Math.min(left, hooks.seize?.(a, left) ?? 0);
          a.loans.splice(a.loans.indexOf(l), 1);
          if (seized >= left) {
            hooks.notice?.(a.household, 'seized', { n: seized });
          } else {
            this.bankrupt++;
            hooks.notice?.(a.household, 'bankrupt', { n: left - seized });
            a.money = Math.min(a.money, 0);
          }
        }
      }
      a.today.day = day;
      a.today.money = a.money;
      a.book.push(a.today);
      if (a.book.length > 28) a.book.shift();
      a.today = { day: day + 1, income: {}, expense: {}, money: a.money };
    }
    this.updatePrices();
  }

  /** 구휼 (17-9): 교회 빵 → (친척/영주는 M9 관계/정책 연결 때) */
  relief(a: Account, day: number, notice?: (h: number, k: string, args?: Record<string, string | number>) => void): void {
    const R = this.d.relief;
    if (a.reliefDays >= R.church.maxDays) return;
    a.reliefDays++;
    a.reliefCount = (a.reliefCount ?? 0) + 1;
    notice?.(a.household, 'relief_church', { day });
  }

  // ---------------------------------------------------------------- NPC 가정 (요약 LOD)

  private npcDay(_day: number, season: string, inSeason: number): void {
    const d = this.d;
    const F = d.farming;
    const L = d.ledger;
    const SD = d.calendar.seasonDays;
    const YEAR = SD * 4;
    const sh = d.shocks;
    // 추수
    const grainHarvest = season === F.harvestSeason.grain && inSeason === F.harvestDay.grain;
    const vegHarvest = (F.harvestSeason.vegetables as string[]).includes(season) && inSeason === F.harvestDay.vegetables;
    const garden = (F.garden.seasons as string[]).includes(season);
    for (const h of this.npcs) {
      const x = d.estates[h.estate];
      const ae = h.adults + h.children * d.household.childShare;
      const a = h.acct;
      // 수입 (식은 econ-model budget 과 같음, 하루 잡음)
      const noise = 1 + (this.rng.next() * 2 - 1) * sh.incomeNoise * 0.5;
      const inc = x.incomes;
      let cash = 0;
      if (inc.wage) cash += inc.wage.workers * inc.wage.daily * (inc.wage.daysPerWeek / 7);
      if (inc.homecraft) cash += inc.homecraft;
      // 장터 규칙(길드 독점 → 장인 수입), 역병 격리·봉쇄(장터 거래량)
      const pt = this.plagueTrade?.() ?? { mult: 1, blocked: false };
      if (inc.shop) cash += inc.shop.salesPerDay * (1 - inc.shop.materialShare) * (h.estate === 'artisan' ? this.policy?.artisanIncomeMult() ?? 1 : 1) * pt.mult;
      if (inc.trade) {
        const t = inc.trade;
        const I = d.income.trade;
        const r = I.baseReturn + t.skillReckoning * I.perReckoning + t.skillStory * I.perStory + t.rankBonus;
        cash += ((t.capital * r * (1 - I.lossChance) - t.capital * I.lossChance * (I.lossRange[0] + I.lossRange[1]) / 4 - I.costPerDay * t.tripDays) / (t.tripDays + t.prepDays)) * pt.mult;
      }
      if (inc.stipend) cash += inc.stipend;
      if (inc.sacraments) cash += inc.sacraments;
      if (inc.tenants) cash += inc.tenants * d.income.tenantPerDay;
      if (inc.manors) cash += inc.manors * d.income.manorPerDay;
      if (inc.prizes) cash += inc.prizes;
      if (inc.fees) cash += inc.fees;
      this.earn(a, Math.round(cash * noise * 4), 'income');
      // 밭: 곡물 추수 (자가 소비 + 마을 장부 판매 + 외지 판매 현금), 채소
      if (h.plots > 0) {
        if (grainHarvest) {
          const per = h.plots * F.plotYearYield.grain * (SD / 7) * this.yearMult * (1 - F.seedShare);
          const toGranary = per * L.lordGranaryShare.grain;
          const net = per - toGranary;
          this.granary += toGranary;
          const keep = ae * d.diet[h.estate].grain * YEAR * 1.05;
          const fh = h.grain + net;
          const sell = Math.max(0, fh - keep);
          h.grain = fh - sell;
          const local = sell * F.villageSaleShare;
          this.goods.grain.q += local;
          this.earn(a, Math.round((sell - local) * d.goods.grain.base + local * this.goodPrice('grain')), 'harvest');
        }
        // 채소: 거둔 것 중 제 식구가 먹고 남는 것을 장부에 팔아 현금 (자급분은 소비에서 빠짐)
        let vegSold = 0;
        if (vegHarvest) vegSold += h.plots * F.plotYearYield.vegetables * (SD / 7) * this.yearMult * 0.5 * 0.7;
        if (garden) vegSold += F.garden.vegetablesPerDay * 0.5;
        if (vegSold > 0) {
          this.goods.vegetables.q += vegSold;
          this.earn(a, Math.round(vegSold * this.goodPrice('vegetables')), 'harvest');
        }
      }
      // 소비: 식단 (장부 품목). 농가는 곡물을 제 곳간에서
      for (const [g, q0] of Object.entries(d.diet[h.estate] as Record<string, number>)) {
        let need = ae * q0;
        if (g === 'grain' && h.plots > 0) {
          const own = Math.min(h.grain, need);
          h.grain -= own;
          need -= own;
        } else if (g === 'vegetables' && h.plots > 0) need *= garden ? 0.2 : 0.6;
        const st = this.goods[g];
        if (!st || need <= 0) continue;
        // 주요 품목(곡물/채소)만 장부 재고를 움직임. 나머지(유제품/고기/에일)는 늘 마을 안에서 생산·소비가 맞는 것으로 봄 (M? 가축 22장)
        if (g === 'grain' || g === 'vegetables') st.q = Math.max(0, st.q - need);
        this.spend(a, Math.round(need * this.goodPrice(g)), 'food');
      }
      this.spend(a, Math.round(x.fuelBundles * this.goodPrice('firewood')), 'fuel');
      this.spend(a, Math.round(x.upkeep * 4), 'upkeep');
    }
  }

  /** 결정론 해시용 */
  hashParts(out: (string | number)[]): void {
    for (const [g, st] of Object.entries(this.goods)) out.push(g, st.q.toFixed(3));
    out.push(this.granary.toFixed(3));
    out.push(this.yearMult, (this.rng as { state: number }).state);
    const ids = [...this.accounts.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const a = this.accounts.get(id)!;
      out.push(id, a.money, a.titheCarry.v.toFixed(6), a.reliefDays, a.overLimitDays ?? 0);
      for (const l of a.loans) out.push(l.principal, l.interest.toFixed(4), l.due);
    }
    for (const h of this.npcs) out.push(h.grain.toFixed(3));
  }
}
