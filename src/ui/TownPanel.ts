/**
 * 마을 UI (M6, GDD 18): 미니맵(지형/집/장소 + 사람 점 + 화면 범위, 누르면 그리로), 포고 소식(두루마리가 펼쳐지는 알림 + 목록),
 * 멀리 볼 때 장소 이름표. 글자는 전부 DOM (캔버스에 글자 없음), 미니맵 그림은 작은 캔버스 두 장
 */
import type { LotDef } from '../sim/core/types';
import type { Snapshot } from '../sim/protocol';
import { t } from '../i18n';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export interface TownPlace {
  id: string;
  kind: string;
  nameKey: string;
  rect: [number, number, number, number];
  anchor: [number, number];
}
export interface TownZone {
  id: string;
  kind: string;
  rect: [number, number, number, number];
  nameKey?: string;
}

/** 지형 색 (미니맵): 게임 타일의 평균색에 가깝게 */
const GROUND: Record<string, string> = {
  grass: '#5d9a3b', dirt: '#8d6b45', water: '#3c8ed0', bridge: '#a0703f', road_stone: '#9c948a', field_soil: '#6d4b2c',
  sand: '#d6c38a', forest_floor: '#3e6a2f', gravel: '#a39d8e', mud: '#6a5238',
};

export interface TownUiHooks {
  /** 미니맵을 누른 칸으로 화면 이동 */
  lookAt(x: number, y: number): void;
  /** 지금 화면 범위 (칸) */
  viewTiles(): { x0: number; y0: number; x1: number; y1: number };
  /** 세계 칸 → 화면 CSS 좌표 */
  tileToScreen(x: number, y: number): { x: number; y: number };
  zoom(): number;
  /** 사람 id 로 가서 고르기 */
  focusPerson(id: number): void;
}

export class TownPanel {
  readonly root: HTMLElement;
  private base: HTMLCanvasElement;
  private over: HTMLCanvasElement;
  private scale: number;
  private newsList: HTMLElement;
  private newsBtn: HTMLButtonElement;
  private popWrap: HTMLElement;
  private labels: { el: HTMLElement; x: number; y: number; zone: boolean }[] = [];
  private labelLayer: HTMLElement;
  private seenNews = -1;
  private newsOpen = false;
  private pops: { el: HTMLElement; until: number }[] = [];
  private popQueue: { day: number; kind: string; args: Record<string, string | number> }[] = [];
  private lastPopAt = 0;
  private popTitle: HTMLElement;
  private lastPeople: NonNullable<Snapshot['town']>['people'] = [];

  constructor(
    parent: HTMLElement,
    private lot: LotDef,
    places: TownPlace[],
    zones: TownZone[],
    private hooks: TownUiHooks,
  ) {
    const W = lot.w;
    const H = lot.h;
    this.scale = Math.max(1, Math.min(1.4, 260 / W));
    this.root = el('div', 'town-map panel-brown', parent);
    this.root.dataset.testid = 'town-map';
    const head = el('div', 'town-map-head', this.root);
    const title = el('div', 'town-map-title', head);
    title.textContent = t('town.name.ashford');
    this.popTitle = el('div', 'town-map-pop', head);
    this.newsBtn = el('button', 'town-news-btn', head);
    this.newsBtn.dataset.testid = 'town-news-btn';
    this.newsBtn.textContent = t('town.news');
    this.newsBtn.onclick = () => this.toggleNews();
    const box = el('div', 'town-map-box', this.root);
    box.style.width = `${Math.round(W * this.scale)}px`;
    box.style.height = `${Math.round(H * this.scale)}px`;
    this.base = el('canvas', 'town-map-base', box);
    this.over = el('canvas', 'town-map-over', box);
    for (const c of [this.base, this.over]) {
      c.width = W * 2;
      c.height = H * 2;
    }
    this.drawBase(places, zones);
    // 누르거나 끌면 그 칸으로
    let drag = false;
    const go = (e: PointerEvent) => {
      const r = this.over.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      const y = ((e.clientY - r.top) / r.height) * H;
      this.hooks.lookAt(x, y);
    };
    this.over.addEventListener('pointerdown', (e) => {
      drag = true;
      this.over.setPointerCapture(e.pointerId);
      go(e);
      e.stopPropagation();
    });
    this.over.addEventListener('pointermove', (e) => drag && go(e));
    this.over.addEventListener('pointerup', () => (drag = false));
    this.over.addEventListener('wheel', (e) => e.stopPropagation());
    // 소식 목록 (접힘)
    this.newsList = el('div', 'town-news panel-cream', parent);
    this.newsList.dataset.testid = 'town-news';
    this.newsList.style.display = 'none';
    // 포고 두루마리 (새 소식이 오면 펼쳐졌다가 말림)
    this.popWrap = el('div', 'crier-wrap', parent);
    // 장소 이름표 (멀리 볼 때)
    this.labelLayer = el('div', 'place-labels', parent);
    for (const p of places) {
      const e = el('div', 'place-label', this.labelLayer);
      e.textContent = t(p.nameKey);
      this.labels.push({ el: e, x: p.anchor[0] + 0.5, y: (p.rect[1] + p.rect[3]) / 2, zone: false });
    }
    for (const z of zones) {
      if (!z.nameKey) continue;
      const e = el('div', 'place-label zone', this.labelLayer);
      e.textContent = t(z.nameKey);
      this.labels.push({ el: e, x: (z.rect[0] + z.rect[2] + 1) / 2, y: (z.rect[1] + z.rect[3] + 1) / 2, zone: true });
    }
  }

  private drawBase(places: TownPlace[], zones: TownZone[]): void {
    const g = this.base.getContext('2d')!;
    const L = this.lot;
    const W = L.w;
    const H = L.h;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let c = GROUND[L.ground[i] ?? 'grass'] ?? GROUND.grass;
        if (L.floor[i]) c = '#b99a72';
        if (L.walls[i]) c = '#3f3128';
        g.fillStyle = c;
        g.fillRect(x * 2, y * 2, 2, 2);
      }
    }
    // 나무: 짙은 점
    for (const o of L.objects) {
      if (!o.id.startsWith('tree_') || o.y >= H) continue;
      g.fillStyle = 'rgba(28,58,26,0.85)';
      g.fillRect(o.x * 2 - 1, o.y * 2 - 2, 4, 4);
    }
    // 구역/장소 테두리
    g.lineWidth = 1;
    for (const z of zones) {
      g.strokeStyle = 'rgba(255,240,200,0.18)';
      g.strokeRect(z.rect[0] * 2 + 0.5, z.rect[1] * 2 + 0.5, (z.rect[2] - z.rect[0] + 1) * 2 - 1, (z.rect[3] - z.rect[1] + 1) * 2 - 1);
    }
    for (const p of places) {
      g.strokeStyle = 'rgba(255,214,120,0.55)';
      g.strokeRect(p.rect[0] * 2 + 0.5, p.rect[1] * 2 + 0.5, (p.rect[2] - p.rect[0] + 1) * 2 - 1, (p.rect[3] - p.rect[1] + 1) * 2 - 1);
    }
  }

  /** 스냅샷마다: 사람 점, 인구, 새 소식 */
  update(s: Snapshot): void {
    const town = s.town;
    if (!town) return;
    this.lastPeople = town.people;
    this.popTitle.textContent = t('town.population', { n: town.population });
    const news = town.news;
    const lastDay = news.length ? news[news.length - 1].day * 1000 + news.length : -1;
    if (this.seenNews < 0) this.seenNews = lastDay;
    else if (lastDay !== this.seenNews) {
      // 새로 온 것만 두루마리로 (한 번에 너무 많으면 마지막 셋)
      const prevCount = this.seenNews % 1000;
      const fresh = news.slice(Math.max(0, Math.min(prevCount, news.length) - (news.length >= 12 ? 1 : 0)));
      const add = lastDay > this.seenNews ? fresh.slice(-3) : news.slice(-1);
      this.popQueue.push(...add);
      this.seenNews = lastDay;
      this.newsBtn.classList.add('fresh');
    }
    if (this.newsOpen) this.renderNews(news);
  }

  private renderNews(news: NonNullable<Snapshot['town']>['news']): void {
    this.newsList.textContent = '';
    const h = el('div', 'panel-title', this.newsList);
    h.textContent = t('town.news.title');
    if (!news.length) {
      el('div', 'town-news-empty', this.newsList).textContent = t('town.news.none');
      return;
    }
    for (const n of [...news].reverse()) {
      const row = el('div', 'town-news-row', this.newsList);
      el('span', 'town-news-day', row).textContent = t('town.news.day', { d: n.day + 1 });
      el('span', 'town-news-text', row).textContent = t(`news.${n.kind}`, n.args);
    }
  }

  private toggleNews(): void {
    this.newsOpen = !this.newsOpen;
    this.newsList.style.display = this.newsOpen ? '' : 'none';
    this.newsBtn.classList.remove('fresh');
  }

  /** 프레임마다: 화면 범위 네모, 이름표 위치, 두루마리 */
  frame(now: number): void {
    const c = this.over.getContext('2d')!;
    c.clearRect(0, 0, this.over.width, this.over.height);
    const H = this.lot.h;
    // 사람 점 (조작 가문 금색 + 반짝임, 나머지 흰 점)
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    for (const p of this.lastPeople) {
      const y = p.y % (H + 1);
      if (p.household === 1) continue;
      c.fillStyle = p.lod === 'full' ? 'rgba(255,255,255,0.95)' : 'rgba(240,232,210,0.6)';
      c.fillRect(p.x * 2 - 1, y * 2 - 1, 2, 2);
    }
    for (const p of this.lastPeople) {
      if (p.household !== 1) continue;
      const y = p.y % (H + 1);
      c.fillStyle = `rgba(255,${200 + Math.round(40 * pulse)},60,1)`;
      c.fillRect(p.x * 2 - 2, y * 2 - 2, 4, 4);
      c.strokeStyle = `rgba(255,220,80,${0.6 * (1 - pulse)})`;
      c.beginPath();
      c.arc(p.x * 2, y * 2, 4 + 5 * pulse, 0, Math.PI * 2);
      c.stroke();
    }
    const v = this.hooks.viewTiles();
    c.strokeStyle = 'rgba(255,248,220,0.95)';
    c.lineWidth = 1.5;
    c.strokeRect(Math.max(0, v.x0 * 2) + 0.5, Math.max(0, v.y0 * 2) + 0.5, Math.min(this.over.width, v.x1 * 2) - Math.max(0, v.x0 * 2) - 1, Math.min(this.over.height, v.y1 * 2) - Math.max(0, v.y0 * 2) - 1);
    // 이름표: 멀리 볼수록 또렷 (가까이는 숨김)
    const z = this.hooks.zoom();
    const alpha = Math.max(0, Math.min(1, (1.6 - z) / 0.6));
    this.labelLayer.style.opacity = String(alpha);
    if (alpha > 0) {
      for (const l of this.labels) {
        const sp = this.hooks.tileToScreen(l.x, l.y);
        const off = sp.x < -200 || sp.y < -60 || sp.x > window.innerWidth + 200 || sp.y > window.innerHeight + 60;
        l.el.style.display = off ? 'none' : '';
        if (!off) l.el.style.transform = `translate(${Math.round(sp.x)}px, ${Math.round(sp.y)}px) translate(-50%, -50%)`;
      }
    }
    // 포고 두루마리: 3.6초에 하나씩, 6초 떠 있음
    if (this.popQueue.length && now - this.lastPopAt > 3600) {
      const n = this.popQueue.shift()!;
      this.lastPopAt = now;
      const e = el('div', 'crier', this.popWrap);
      e.dataset.testid = 'crier';
      const bell = el('div', 'crier-bell', e);
      bell.textContent = '';
      const body = el('div', 'crier-body', e);
      el('div', 'crier-head', body).textContent = t('town.crier', { d: n.day + 1 });
      el('div', 'crier-text', body).textContent = t(`news.${n.kind}`, n.args);
      this.pops.push({ el: e, until: now + 6000 });
      while (this.pops.length > 2) this.pops.shift()!.el.remove();
    }
    for (const p of [...this.pops]) {
      if (now > p.until && !p.el.classList.contains('closing')) {
        p.el.classList.add('closing');
        setTimeout(() => p.el.remove(), 600);
        this.pops.splice(this.pops.indexOf(p), 1);
      }
    }
  }

  setHidden(h: boolean): void {
    for (const e of [this.root, this.newsList, this.popWrap, this.labelLayer]) e.classList.toggle('town-hidden', h);
  }
}
