/**
 * 가계부 (GDD 17-6): 28일 수입/지출 막대, 분류별 합계, 빚과 상환일, 장터 가격표(전날 대비 등락).
 * 돈 칸을 누르면 열림. DOM 막대 (캔버스에 글자 없음)
 */
import type { Snapshot } from '../sim/protocol';
import { t } from '../i18n';
import { iconEl } from './skin';
import { formatMoney } from './Hud';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

const GOOD_ICON: Record<string, string> = {
  grain: 'raven:a3323', vegetables: 'raven:a2085', dairy: 'raven:a2241', meat: 'raven:a2145', ale: 'item.ale', bread: 'item.bread', flour: 'item.flour',
  preserves: 'item.preserves', firewood: 'item.firewood', cloth: 'raven:a339', iron: 'raven:a506', tools: 'axe', horseshoes: 'raven:a324',
};

export class LedgerPanel {
  readonly root: HTMLElement;
  open = false;
  private sig = '';

  /** 저장고 예측: 먹을거리 끼니 수 (HearthGame 이 품목 정의로 채움) */
  meals: (stock: Record<string, number>) => number = () => 0;

  constructor(readonly home: HTMLElement) {
    this.root = el('div', 'ledger panel-cream', home);
    this.root.dataset.testid = 'ledger';
    this.root.style.display = 'none';
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.hide();
    });
  }

  toggle(s: Snapshot | null): void {
    if (this.open) this.hide();
    else if (s) this.show(s);
  }

  show(s: Snapshot): void {
    if (!this.root.isConnected) this.dock();
    this.open = true;
    this.root.style.display = '';
    this.sig = '';
    this.update(s);
  }

  hide(): void {
    this.open = false;
    this.root.style.display = 'none';
    this.dock();
  }

  /** 수첩 › 생업 › 가계부 쪽에 실음 (27-8) */
  dockInto(page: HTMLElement): void {
    if (this.root.parentElement !== page) page.appendChild(this.root);
    this.root.classList.add('in-book');
    this.sig = '';
  }

  /** 제자리 (따로 뜨는 가계부) */
  dock(): void {
    if (this.root.parentElement !== this.home) this.home.appendChild(this.root);
    this.root.classList.remove('in-book');
    this.sig = '';
  }

  update(s: Snapshot): void {
    if (!this.open || !s.econ) return;
    const e = s.econ;
    const sig = JSON.stringify([e.money, e.debt, e.book.length, e.book[e.book.length - 1]?.day, Object.values(e.prices).map((v) => v.mult), s.stock]);
    if (sig === this.sig) return;
    this.sig = sig;
    const r = this.root;
    r.textContent = '';
    const head = el('div', 'ledger-head', r);
    el('div', 'ledger-title', head).textContent = t('ui.ledger.title');
    const close = el('button', 'rel-btn panel-brown', head);
    close.type = 'button';
    close.textContent = t('ui.close');
    close.addEventListener('click', () => this.hide());

    const sum = el('div', 'ledger-sum', r);
    const money = el('div', 'ledger-money', sum);
    money.appendChild(iconEl('ui.coin', 2));
    el('span', '', money).textContent = formatMoney(e.money);
    if (e.debt > 0) el('div', 'ledger-debt', sum).textContent = t('ui.ledger.debt', { m: formatMoney(e.debt) });
    // 저장고 예측 (17-6): 식구 수 × 하루 두 끼 기준 며칠 버티나, 겨울 전 장작 비축 기준(17-5)
    const members = s.persons.filter((p) => p.household === 1).length || 1;
    const foodDays = this.meals(s.stock) / (members * 2);
    const fc = el('div', 'ledger-forecast', r);
    fc.textContent = foodDays < 1 ? t("ui.ledger.food_out") : t("ui.ledger.food_days", { n: Math.floor(foodDays) });
    fc.classList.toggle("warn", foodDays < 3);
    if (s.season === 'autumn' || s.season === 'winter') {
      const wood = s.stock.firewood ?? 0;
      const w2 = el('div', 'ledger-forecast', r);
      w2.textContent = t('ui.ledger.wood', { n: wood, need: 17 });
      w2.classList.toggle('warn', wood < 17);
    }
    // 28일 수입/지출 막대
    const days = [...e.book, { day: -1, income: e.today.income, expense: e.today.expense, money: e.money }];
    const inc = (d: { income: Record<string, number> }) => Object.entries(d.income).filter(([k]) => k !== 'loan' && k !== 'relief').reduce((a, [, v]) => a + v, 0);
    const exp = (d: { expense: Record<string, number> }) => Object.values(d.expense).reduce((a, v) => a + v, 0);
    const max = Math.max(1, ...days.map((d) => Math.max(inc(d), exp(d))));
    el('div', 'rel-head', r).textContent = t('ui.ledger.days', { n: e.book.length });
    const chart = el('div', 'ledger-chart', r);
    for (const d of days) {
      const col = el('div', 'ledger-col', chart);
      col.title = `${d.day >= 0 ? t('hud.day', { d: d.day + 1 }) : t('ui.ledger.today')}: +${formatMoney(inc(d))} / −${formatMoney(exp(d))}`;
      const up = el('div', 'ledger-up', col);
      up.style.height = `${Math.round((inc(d) / max) * 40)}px`;
      const dn = el('div', 'ledger-dn', col);
      dn.style.height = `${Math.round((exp(d) / max) * 40)}px`;
    }
    // 분류별 합계
    const tot = (k: 'income' | 'expense') => {
      const m: Record<string, number> = {};
      for (const d of days) for (const [c, v] of Object.entries(d[k])) m[c] = (m[c] ?? 0) + v;
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };
    const cols = el('div', 'ledger-cols', r);
    for (const k of ['income', 'expense'] as const) {
      const box = el('div', 'ledger-box', cols);
      el('div', 'rel-head', box).textContent = t(`ui.ledger.${k}`);
      const list = tot(k);
      if (!list.length) el('div', 'rel-empty', box).textContent = '—';
      for (const [c, v] of list) {
        const row = el('div', 'ledger-row', box);
        el('span', '', row).textContent = t(`ledger.${k}.${c}`);
        el('span', `ledger-v ${k}`, row).textContent = formatMoney(v);
      }
    }
    // 빚
    if (e.loans.length) {
      el('div', 'rel-head', r).textContent = t('ui.ledger.loans');
      for (const l of e.loans) el('div', 'ledger-row', r).textContent = t('ui.ledger.loan', { m: formatMoney(l.principal + l.interest), d: l.due + 1 });
    }
    // 장터 가격표 (17-4 "전날 대비 등락 화살표")
    el('div', 'rel-head', r).textContent = t('ui.ledger.prices');
    const pb = el('div', 'ledger-prices', r);
    for (const [g, v] of Object.entries(e.prices)) {
      const row = el('div', 'ledger-price', pb);
      row.appendChild(iconEl(GOOD_ICON[g] ?? 'ui.coin', 1));
      el('span', 'ledger-pname', row).textContent = t(`good.${g}`);
      const ch = v.mult - v.prev;
      const arrow = el('span', `ledger-arrow ${ch > 0.005 ? 'up' : ch < -0.005 ? 'down' : ''}`, row);
      arrow.textContent = ch > 0.005 ? '▲' : ch < -0.005 ? '▼' : '–';
      el('span', 'ledger-mult', row).textContent = `×${v.mult.toFixed(2)}`;
    }
  }
}
