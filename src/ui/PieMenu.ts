/**
 * 원형 메뉴 (심즈 파이 메뉴). 물건 클릭 위치에 항목을 둥글게 배치.
 * 할 수 없는 항목은 흐리게 + 이유를 함께 보여 줌 (GDD 13: 이유 없는 회색 금지).
 * 한 바퀴에 최대 8개. 넘으면 "더 보기" 로 다음 쪽 (사회 상호작용 80+ 대비)
 * 항목 너비를 실제로 재서 둘레에 겹치지 않게 반지름을 정함
 */
import type { MenuEntry } from '../sim/sim';
import { t } from '../i18n';
import { iconEl } from './skin';

const PER_PAGE = 8;
const MORE = '__more';

export class PieMenu {
  readonly root: HTMLElement;
  private onPick: ((e: MenuEntry) => void) | null = null;
  open = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'pie';
    this.root.dataset.testid = 'pie-menu';
    parent.appendChild(this.root);
    this.root.addEventListener('pointerdown', (ev) => {
      if (ev.target === this.root) this.close();
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.open) this.close();
    });
  }

  show(x: number, y: number, title: string, entries: MenuEntry[], onPick: (e: MenuEntry) => void, page = 0): void {
    this.onPick = onPick;
    this.root.textContent = '';
    const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
    const pageEntries = entries.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
    if (pages > 1) pageEntries.push({ interactionId: MORE, nameKey: 'ui.more', icon: 'goto', available: true, reasonArgs: { a: page + 1, b: pages } });

    const center = document.createElement('div');
    center.className = 'pie-center panel-cream';
    center.textContent = title;
    this.root.appendChild(center);

    // 1) 항목을 먼저 만들어 너비를 잼
    const buttons = pageEntries.map((e, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pie-item panel-brown';
      b.dataset.interaction = e.interactionId;
      if (e.category) b.dataset.category = e.category;
      b.disabled = !e.available;
      b.appendChild(iconEl(e.icon, 2));
      const label = document.createElement('span');
      label.className = 'pie-label';
      label.textContent = e.interactionId === MORE ? `${t('ui.more')} ${page + 1}/${pages}` : t(e.nameKey);
      b.appendChild(label);
      if (e.available && e.chance !== undefined) {
        const c = document.createElement('span');
        c.className = 'pie-chance';
        c.textContent = t('social.chance', { n: e.chance });
        c.dataset.level = e.chance >= 70 ? 'high' : e.chance >= 40 ? 'mid' : 'low';
        b.appendChild(c);
      }
      if (e.count !== undefined) {
        const c = document.createElement('span');
        c.className = 'pie-count';
        c.textContent = String(e.count);
        b.appendChild(c);
      }
      // 분류 항목(count 있음)은 이유 대신 개수만. 그 밖의 할 수 없는 항목은 이유를 같이
      if (!e.available && e.count === undefined) {
        const r = document.createElement('span');
        r.className = 'pie-reason';
        r.textContent = t(e.reasonKey ?? 'reason.unknown', e.reasonArgs);
        b.appendChild(r);
        b.title = r.textContent;
      }
      b.style.setProperty('--delay', `${i * 18}ms`);
      b.style.visibility = 'hidden';
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!e.available) return;
        if (e.interactionId === MORE) {
          this.show(x, y, title, entries, onPick, (page + 1) % pages);
          return;
        }
        this.close();
        this.onPick?.(e);
      });
      this.root.appendChild(b);
      return b;
    });
    this.root.classList.add('open');
    this.open = true;

    // 2) 반지름: 이웃 항목 상자(와 가운데 제목)가 겹치지 않을 때까지 키움 (타원, 세로 0.8)
    const widths = buttons.map((b) => (b.offsetWidth || 160) + 8);
    const heights = buttons.map((b) => (b.offsetHeight || 40) + 6);
    const n = buttons.length;
    const maxH = Math.max(40, ...heights);
    const cw = (center.offsetWidth || 80) + 8;
    const ch = (center.offsetHeight || 30) + 8;
    const ang = (i: number) => -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
    const hit = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) =>
      Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
    let radius = 70;
    for (; radius < 600; radius += 6) {
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        const xi = Math.cos(ang(i)) * radius;
        const yi = Math.sin(ang(i)) * radius * 0.8;
        if (hit(xi, yi, widths[i], heights[i], 0, 0, cw, ch)) ok = false;
        for (let j = i + 1; j < n && ok; j++) {
          if (hit(xi, yi, widths[i], heights[i], Math.cos(ang(j)) * radius, Math.sin(ang(j)) * radius * 0.8, widths[j], heights[j])) ok = false;
        }
      }
      if (ok) break;
    }
    const maxW = Math.max(...widths);
    const mx = radius + maxW / 2 + 12;
    const my = radius * 0.8 + maxH / 2 + 12;
    const cx = Math.min(Math.max(x, mx), window.innerWidth - mx);
    const cy = Math.min(Math.max(y, my), window.innerHeight - my);
    center.style.left = `${cx}px`;
    center.style.top = `${cy}px`;
    buttons.forEach((b, i) => {
      const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
      b.style.left = `${Math.round(cx + Math.cos(a) * radius)}px`;
      b.style.top = `${Math.round(cy + Math.sin(a) * radius * 0.8)}px`;
      b.style.visibility = '';
    });
  }

  close(): void {
    this.root.classList.remove('open');
    this.root.textContent = '';
    this.open = false;
  }
}
