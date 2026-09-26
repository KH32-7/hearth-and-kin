/**
 * 일 탭 (GDD 17-1, 17-2): 지금 직업(등급, 일당, 성과 막대, 출근 태도, 오늘 주문), 없으면 구할 수 있는 일 목록.
 * 아래에 솜씨(스킬) 레벨과 다음 레벨까지 막대. 글자는 DOM
 */
import type { PersonSnap, Snapshot } from '../sim/protocol';
import { t } from '../i18n';
import { iconEl } from './skin';
import { formatMoney } from './Hud';

export interface CareerInfo {
  nameKey: string;
  icon: string;
  type: string;
  estates: string[];
  hours: [number, number];
  ranks: Array<{ nameKey: string; wage?: number; share?: number }>;
  promoteAt: number;
  npc_role?: boolean;
  literacy?: boolean;
}

export interface WorkHandlers {
  setCareer(personId: number, careerId: string | null): void;
  setAttitude(personId: number, attitude: string): void;
  setShop(open: boolean, priceMult: number): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class WorkPanel {
  private sig = '';

  constructor(
    private careers: Record<string, CareerInfo>,
    readonly skills: Record<string, { nameKey: string; icon: string; category: string }>,
    private itemIcon: (id: string) => string,
    private h: WorkHandlers,
  ) {}

  invalidate(): void {
    this.sig = '';
  }

  // 수첩 › 생업 › 직업 쪽이 책 부품으로 다시 그릴 때 쓰는 자료 · 동작 (동작은 위 render 와 같음)
  careerDef(id: string): CareerInfo | undefined {
    return this.careers[id];
  }

  /** 이 신분이 구할 수 있는 일 */
  openCareers(estate: string): Array<[string, CareerInfo]> {
    return Object.entries(this.careers).filter(([, d]) => !d.npc_role && d.estates.includes(estate));
  }

  icon(item: string): string {
    return this.itemIcon(item);
  }

  setCareer(personId: number, careerId: string | null): void {
    this.h.setCareer(personId, careerId);
  }

  setAttitude(personId: number, attitude: string): void {
    this.h.setAttitude(personId, attitude);
  }

  setShop(open: boolean, priceMult: number): void {
    this.h.setShop(open, priceMult);
  }

  render(root: HTMLElement, p: PersonSnap, _s: Snapshot): void {
    const sig = JSON.stringify([p.id, p.career, p.skills, p.inner?.estate, p.inner?.stage_life, _s.econ?.shop]);
    if (sig === this.sig) return;
    this.sig = sig;
    root.textContent = '';
    root.classList.add('work-view');
    const estate = p.inner?.estate ?? 'freeman';

    el('div', 'rel-head', root).textContent = t('ui.work.job');
    const c = p.career;
    if (c && this.careers[c.id]) {
      const def = this.careers[c.id];
      const box = el('div', 'work-job', root);
      const top = el('div', 'work-title', box);
      top.appendChild(iconEl(def.icon, 2));
      const name = el('div', 'work-name', top);
      el('div', '', name).textContent = t(def.nameKey);
      el('div', 'work-rank', name).textContent = `${t(def.ranks[c.rank]?.nameKey ?? '')} · ${t('ui.work.hours', { a: def.hours[0], b: def.hours[1] })}`;
      const pay = def.ranks[c.rank]?.wage;
      el('div', 'work-pay', box).textContent = pay !== undefined ? t('ui.work.wage', { m: formatMoney(pay) }) : t('ui.work.share', { n: Math.round((def.ranks[c.rank]?.share ?? 1) * 100) });
      // 성과 막대 (0 ~ 승급 기준, 음수는 붉게)
      const pr = el('div', 'rel-bar-row', box);
      pr.title = t('ui.work.perf');
      pr.appendChild(iconEl('emo.focused', 1));
      const bar = el('div', 'rel-bar bar', pr);
      const fill = el('div', 'rel-fill', bar);
      const frac = Math.max(-1, Math.min(1, c.perf / def.promoteAt));
      fill.style.left = frac >= 0 ? '0' : `${(1 + frac) * 100}%`;
      fill.style.width = `${Math.abs(frac) * 100}%`;
      fill.style.background = frac >= 0 ? '#e0b64a' : '#b8433b';
      el('span', 'rel-num', pr).textContent = `${Math.round(c.perf)}/${def.promoteAt}`;
      // 출근 태도
      const att = el('div', 'work-att', box);
      for (const a of ['hard', 'normal', 'slack']) {
        const b = el('button', 'rel-btn panel-brown', att);
        b.type = 'button';
        b.dataset.attitude = a;
        b.textContent = t(`ui.work.att.${a}`);
        b.classList.toggle('on', c.attitude === a);
        b.addEventListener('click', () => this.h.setAttitude(p.id, a));
      }
      // 현장형: 오늘 주문
      if (c.orders.length) {
        el('div', 'work-sub', box).textContent = t('ui.work.orders');
        const ol = el('div', 'work-orders', box);
        for (const o of c.orders) {
          const row = el('div', 'work-order', ol);
          row.classList.toggle('done', o.done);
          row.appendChild(iconEl(this.itemIcon(o.item), 1));
          el('span', '', row).textContent = `${t(`item.${o.item}`)} ×${o.qty}`;
          el('span', 'work-order-pay', row).textContent = o.done ? '✓' : formatMoney(o.pay);
        }
      }
      const quit = el('button', 'rel-btn panel-brown work-quit', box);
      quit.type = 'button';
      quit.textContent = t('ui.work.quit');
      quit.addEventListener('click', () => this.h.setCareer(p.id, null));
    } else {
      const list = el('div', 'work-list', root);
      const open = Object.entries(this.careers).filter(([, d]) => !d.npc_role && d.estates.includes(estate));
      if (p.inner?.stage_life === 'child' || p.inner?.stage_life === 'teen' || !open.length) el('div', 'rel-empty', list).textContent = t('ui.work.none');
      else for (const [id, d] of open) {
        const row = el('div', 'work-row', list);
        row.appendChild(iconEl(d.icon, 1));
        el('span', 'work-row-name', row).textContent = t(d.nameKey);
        const w = d.ranks[0]?.wage;
        el('span', 'work-row-pay', row).textContent = w !== undefined ? formatMoney(w) : t(`ui.work.type.${d.type}`);
        const b = el('button', 'rel-btn panel-brown', row);
        b.type = 'button';
        b.dataset.career = id;
        b.textContent = t('ui.work.join');
        b.addEventListener('click', () => this.h.setCareer(p.id, id));
      }
    }

    // 가게 (17-3): 제작하는 사람이 있는 집만
    const shop = _s.econ?.shop;
    if (shop && (p.career && this.careers[p.career.id]?.type === 'onsite' || shop.open)) {
      el('div', 'rel-head', root).textContent = t('ui.shop.title');
      const box = el('div', 'work-job', root);
      const row = el('div', 'work-att', box);
      const tog = el('button', 'rel-btn panel-brown', row);
      tog.type = 'button';
      tog.dataset.shop = shop.open ? 'close' : 'open';
      tog.textContent = t(shop.open ? 'ui.shop.close' : 'ui.shop.open');
      tog.addEventListener('click', () => this.h.setShop(!shop.open, shop.priceMult));
      for (const [k, v] of [['cheap', 0.85], ['fair', 1], ['dear', 1.15]] as const) {
        const b = el('button', 'rel-btn panel-brown', row);
        b.type = 'button';
        b.textContent = t(`ui.shop.${k}`);
        b.classList.toggle('on', Math.abs(shop.priceMult - v) < 0.01);
        b.addEventListener('click', () => this.h.setShop(shop.open, v));
      }
      el('div', 'work-rank', box).textContent = t('ui.shop.stats', { rep: Math.round(shop.reputation), n: shop.sales });
    }
    // 솜씨
    el('div', 'rel-head', root).textContent = t('ui.work.skills');
    const sk = p.skills ?? {};
    const ids = Object.keys(sk).sort((a, b) => sk[b][0] - sk[a][0] || sk[b][1] - sk[a][1]);
    if (!ids.length) el('div', 'rel-empty', root).textContent = t('ui.work.noSkills');
    const grid = el('div', 'skill-grid', root);
    for (const id of ids) {
      const def = this.skills[id];
      if (!def) continue;
      const row = el('div', 'skill-row', grid);
      row.dataset.skill = id;
      row.appendChild(iconEl(def.icon, 1));
      el('span', 'skill-name', row).textContent = t(def.nameKey);
      const lv = el('span', 'skill-lv', row);
      lv.textContent = String(sk[id][0]);
      const bar = el('div', 'skill-bar', row);
      el('div', 'skill-fill', bar).style.width = `${Math.round(sk[id][1] * 100)}%`;
    }
  }
}
