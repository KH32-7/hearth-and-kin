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

    // 2) 가운데에서 항목 안쪽 가장자리까지 거리를 늘 비슷하게: 항목을 원의 오른쪽·왼쪽에 위에서 아래로 쌓고
    //    가운데 쪽 가장자리를 타원 위에 둠 (이름이 길면 바깥으로만 늘어남 → 몇 개든 원 크기가 거의 같음)
    const widths = buttons.map((b) => (b.offsetWidth || 160) + 8);
    const heights = buttons.map((b) => (b.offsetHeight || 40) + 6);
    const n = buttons.length;
    const cw = (center.offsetWidth || 80) + 8;
    const ch = (center.offsetHeight || 30) + 8;
    const R = Math.max(64, cw / 2 + 18);
    const right = Math.ceil(n / 2);
    const pos: [number, number][] = new Array(n);
    for (const [side, from, to] of [[1, 0, right], [-1, right, n]] as const) {
      const idx: number[] = [];
      for (let i = from; i < to; i++) idx.push(i);
      const gap = 4;
      const H = idx.reduce((a, i) => a + heights[i], 0) + gap * Math.max(0, idx.length - 1);
      let y = -H / 2;
      const ry = Math.max(R * 0.8, H / 2 + 8);
      for (const i of idx) {
        const yc = y + heights[i] / 2;
        // 타원 위 안쪽 가장자리 (위아래 끝으로 갈수록 가운데로 조금 들어옴, 가운데 제목과는 안 겹침)
        const inner = Math.max(cw / 2 + 12, R * Math.sqrt(Math.max(0, 1 - (yc / ry) ** 2)));
        pos[i] = [side * (inner + widths[i] / 2), yc];
        y += heights[i] + gap;
      }
    }
    // 항목이 하나면 오른쪽, 둘이면 좌우 한 개씩 (위 반복이 처리)
    // 화면 밖으로 나가지 않게 가운데를 옮김 (실제 상자 범위로)
    let minX = -cw / 2, maxX = cw / 2, minY = -ch / 2, maxY = ch / 2;
    pos.forEach(([bx, by], i) => {
      minX = Math.min(minX, bx - widths[i] / 2);
      maxX = Math.max(maxX, bx + widths[i] / 2);
      minY = Math.min(minY, by - heights[i] / 2);
      maxY = Math.max(maxY, by + heights[i] / 2);
    });
    const cx = Math.min(Math.max(x, -minX + 12), window.innerWidth - maxX - 12);
    const cy = Math.min(Math.max(y, -minY + 12), window.innerHeight - maxY - 12);
    center.style.left = `${cx}px`;
    center.style.top = `${cy}px`;
    buttons.forEach((b, i) => {
      b.style.left = `${Math.round(cx + pos[i][0])}px`;
      b.style.top = `${Math.round(cy + pos[i][1])}px`;
      b.style.visibility = '';
    });
  }

  close(): void {
    this.root.classList.remove('open');
    this.root.textContent = '';
    this.open = false;
  }
}
