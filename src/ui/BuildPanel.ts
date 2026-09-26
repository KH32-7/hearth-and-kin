/**
 * 건축/구매 모드 UI (GDD 23-2, 23-4). DOM 만 (캔버스에 한글을 그리지 않음).
 * 배치 (GDD 27-10):
 * - 모드 (생활 / 구매 / 건축): HUD 우상단 아이콘 띠에 붙음
 * - 위 가운데 도구 띠: 되돌리기 · 다시 | 층 ▼▲ | 벽 올림/잘라내기/내림 | 지붕
 * - 아래 반투명 판: 왼쪽 분류(구매) 또는 도구(건축) | 가운데 물건/재질 칸 + 가진 돈 · 이번 공사 | 오른쪽 고른 것 설명
 * - 신분 제한은 흐리게 + 금지 아이콘. 조작 안내 글 없이 아이콘 (27-3)
 */
import { t } from '../i18n';
import { iconEl } from './skin';
import { formatMoney } from './Hud';

export type GameMode = 'live' | 'buy' | 'build';
export type BuildTool = 'wall' | 'room' | 'erase' | 'floor' | 'terrain' | 'door' | 'window' | 'fence' | 'roof' | 'stairs' | 'cellar' | 'name' | 'hand';

/** 도구별 재질 종류 (build.json 표 이름) */
export const TOOL_PARTS: Partial<Record<BuildTool, 'walls' | 'fences' | 'floors' | 'terrain' | 'doors' | 'windows' | 'roofs' | 'stairs'>> = {
  wall: 'walls', room: 'walls', fence: 'fences', floor: 'floors', terrain: 'terrain', door: 'doors', window: 'windows', roof: 'roofs', stairs: 'stairs',
};

export const BUILD_TOOLS: BuildTool[] = ['wall', 'room', 'erase', 'door', 'window', 'floor', 'terrain', 'fence', 'stairs', 'roof', 'cellar', 'name', 'hand'];
export const BUY_CATEGORIES = ['bedroom', 'kitchen', 'dining', 'living', 'hygiene', 'work', 'decor', 'light', 'kids', 'animal', 'outdoor', 'religion', 'crafted'] as const;

export interface PartEntry {
  id: string;
  nameKey: string;
  price: number;
  /** 신분이 모자라 못 씀 */
  locked: boolean;
  estate?: string | null;
}

export interface CatalogItem {
  id: string;
  nameKey: string;
  category: string;
  price: number;
  locked: boolean;
  estate?: string | null;
  roomScore: number;
  variants: string[];
  /** 손수 만든 것: 저장고 품목과 개수 (값 없음) */
  crafted?: { item: string; n: number };
}

/** 이미 놓인 물건 · 벽을 고름 (심즈식: 고르면 오른쪽 판에 옮기기 · 돌리기 · 색 · 팔기) */
export interface PlacedSel {
  kind: 'object' | 'wall';
  /** 물건 정의 id 또는 벽 재질 id */
  id: string;
  nameKey: string;
  variant?: string | null;
  variants?: string[];
  /** 팔면 받는 값 (벽은 이 줄을 허물 때) */
  sell: number;
  /** 색 바꾸기 값 */
  recolor?: number;
  /** 벽 재질 목록 (벽 칠하기) */
  styles?: PartEntry[];
  /** 벽 칸 수 */
  cells?: number;
}
export interface PlacedActs {
  move?(): void;
  rotate?(): void;
  sell(): void;
  recolor?(variant: string | null): void;
  paint?(style: string, all: boolean): void;
}

export interface BuildPanelHandlers {
  setMode(m: GameMode): void;
  setTool(tool: BuildTool): void;
  pickPart(tool: BuildTool, id: string): void;
  pickObject(defId: string, variant?: string): void;
  undo(): void;
  redo(): void;
  setConstruction(on: boolean): void;
  stepLevel(dir: number): void;
  setCutaway(mode: 'up' | 'cut' | 'down'): void;
  setRoofMode(mode: 'auto' | 'on' | 'off'): void;
  /** 썸네일 (아트 팩에서 그림) */
  thumb(kind: string, id: string, variant?: string): HTMLCanvasElement | null;
  parts(tool: BuildTool): PartEntry[];
  catalog(): CatalogItem[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

/** 썸네일의 투명한 가장자리를 잘라냄 (48px 판 가운데 작게 그려진 물건도 칸을 채우게, 목업 크기) */
function trim(c: HTMLCanvasElement): HTMLCanvasElement {
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return c;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width;
  let y0 = c.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (!d[(y * c.width + x) * 4 + 3]) continue;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  if (x1 < x0 || (x0 === 0 && y0 === 0 && x1 === c.width - 1 && y1 === c.height - 1)) return c;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.className = c.className;
  const og = out.getContext('2d')!;
  og.imageSmoothingEnabled = false;
  og.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** 썸네일을 칸에 들어가는 가장 큰 정수 배율로 (픽셀이 고르게, 27-3) */
function fit<T extends HTMLElement | null>(c0: T, maxW: number, maxH: number): T {
  if (!(c0 instanceof HTMLCanvasElement) || !c0.width || !c0.height) return c0;
  const c = trim(c0) as unknown as T & HTMLCanvasElement;
  const k = Math.max(1, Math.min(Math.floor(maxW / c.width), Math.floor(maxH / c.height)));
  c.style.width = `${c.width * k}px`;
  c.style.height = `${c.height * k}px`;
  c.style.maxWidth = 'none';
  c.style.maxHeight = 'none';
  return c;
}

export function formatPrice(f: number): string {
  return f ? formatMoney(f) : t('money.free');
}

export class BuildPanel {
  readonly root: HTMLElement;
  private modeBtns = new Map<GameMode, HTMLButtonElement>();
  private toolBar: HTMLElement;
  private toolBtns = new Map<BuildTool, HTMLButtonElement>();
  private picker: HTMLElement;
  private buyPanel: HTMLElement;
  private catTabs = new Map<string, HTMLButtonElement>();
  private buyGrid: HTMLElement;
  private info: HTMLElement;
  private costEl: HTMLElement;
  private consBox!: HTMLInputElement;
  private warnEl: HTMLElement;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private levelEl: HTMLElement;
  private cutBtns = new Map<string, HTMLButtonElement>();
  private roofBtn: HTMLButtonElement;
  private roofMode: 'auto' | 'on' | 'off' = 'auto';
  mode: GameMode = 'live';
  tool: BuildTool = 'hand';
  private part = new Map<BuildTool, string>();
  private category: string = 'bedroom';
  private selectedObject: string | null = null;
  private infoTimer = 0;
  /** 모드 버튼 줄 (HUD 로 옮겨 붙임) */
  modeBar!: HTMLElement;
  private detail!: HTMLElement;
  private titleEl!: HTMLElement;
  private moneyEl!: HTMLElement;
  private consEl!: HTMLElement;
  private subBtns = new Map<GameMode, HTMLElement>();

  constructor(parent: HTMLElement, private h: BuildPanelHandlers) {
    this.root = el('div', 'build-ui', parent);
    this.root.dataset.mode = 'live';
    // 모드
    // 모드 버튼은 HUD 우상단 아이콘 띠로 옮겨 붙음 (HearthGame, GDD 27-2)
    const modes = el('div', 'mode-bar', this.root);
    modes.dataset.testid = 'mode-bar';
    // 구매는 건축 안의 [물건] 탭 (사용자 결정 2026-09-26). 모드 버튼은 생활 | 건축 둘
    for (const m of ['live', 'build'] as GameMode[]) {
      const b = el('button', 'mode-btn', modes);
      b.type = 'button';
      b.dataset.mode = m;
      b.appendChild(iconEl(m === 'live' ? 'rv.house' : 'cute.wrench', 2));
      el('span', 'ib-label', b).textContent = t(`build.mode.${m}`);
      // 건축을 누르면 물건 탭부터 (이미 건축 중이면 그대로)
      b.addEventListener('click', () => this.h.setMode(m === 'build' ? (this.mode === 'live' ? 'buy' : this.mode) : m));
      this.modeBtns.set(m, b);
      this.modeBar = modes;
    }
    // 위 가운데 도구 띠 (27-10): 되돌리기 · 다시 | 층 | 벽 3단 | 지붕. 글 없이 아이콘
    const view = el('div', 'view-bar', this.root);
    view.dataset.testid = 'view-bar';
    this.undoBtn = el('button', 'view-btn hist-btn', view);
    this.undoBtn.type = 'button';
    this.undoBtn.appendChild(iconEl('cute.left', 2));
    this.undoBtn.title = t('build.undo');
    this.undoBtn.addEventListener('click', () => this.h.undo());
    this.redoBtn = el('button', 'view-btn hist-btn', view);
    this.redoBtn.type = 'button';
    this.redoBtn.appendChild(iconEl('cute.right', 2));
    this.redoBtn.title = t('build.redo');
    this.redoBtn.addEventListener('click', () => this.h.redo());
    el('div', 'view-sep', view);
    const down = el('button', 'view-btn', view);
    down.type = 'button';
    down.appendChild(iconEl('cute.down', 2));
    down.title = t('build.view.levelDown');
    down.addEventListener('click', () => this.h.stepLevel(-1));
    this.levelEl = el('div', 'level-label', view);
    const up = el('button', 'view-btn', view);
    up.type = 'button';
    up.appendChild(iconEl('cute.up', 2));
    up.title = t('build.view.levelUp');
    up.addEventListener('click', () => this.h.stepLevel(1));
    el('div', 'view-sep', view);
    for (const c of ['up', 'cut', 'down'] as const) {
      const b = el('button', 'view-btn cut-btn', view);
      b.type = 'button';
      b.dataset.cut = c;
      b.title = t(`build.view.wall.${c}`);
      // 목업: 벽 그림을 아래에서 잘라 높이 셋 (올림 · 잘라내기 · 내림). 그림이 없으면 예전 글리프
      const wall = this.h.thumb('tool', 'wall');
      if (wall) {
        const pic = el('span', `cut-pic cut-${c}`, b);
        pic.appendChild(wall);
      } else b.innerHTML = `<i class="wall-glyph wall-${c}"></i>`;
      b.addEventListener('click', () => this.h.setCutaway(c));
      this.cutBtns.set(c, b);
    }
    this.roofBtn = el('button', 'view-btn roof-btn', view);
    this.roofBtn.type = 'button';
    const roof = this.h.thumb('tool', 'roof');
    if (roof) el('span', 'roof-pic', this.roofBtn).appendChild(roof);
    else this.roofBtn.innerHTML = '<i class="roof-glyph"></i>';
    this.roofBtn.addEventListener('click', () => this.h.setRoofMode(this.roofMode === 'auto' ? 'on' : this.roofMode === 'on' ? 'off' : 'auto'));

    // 아래 판: 왼쪽 분류/도구 | 가운데 칸 | 오른쪽 설명
    const dock = el('div', 'build-dock', this.root);
    const left = el('div', 'dock-left', dock);
    const mid = el('div', 'dock-mid', dock);
    this.detail = el('div', 'dock-detail', dock);
    const head = el('div', 'dock-head', mid);
    this.titleEl = el('b', 'dock-title', head);
    const money = el('div', 'dock-money', head);
    this.moneyEl = el('span', 'dock-cash', money);
    this.costEl = el('span', 'cost', money);
    this.warnEl = el('span', 'warn', money);
    this.warnEl.dataset.testid = 'build-warnings';
    this.picker = el('div', 'part-picker', mid);
    this.picker.dataset.testid = 'part-picker';
    this.buyPanel = el('div', 'buy-panel', left);
    this.buyPanel.dataset.testid = 'buy-panel';
    // 왼쪽 위 [물건] [짓기] 탭 (물건이 앞) + 찾기
    const subs = el('div', 'sub-tabs', left);
    left.insertBefore(subs, this.buyPanel);
    for (const [sub, m, icon] of [['obj', 'buy', 'cute.bag'], ['make', 'build', 'cute.wrench']] as const) {
      const b = el('button', 'sub-tab chip', subs);
      b.type = 'button';
      b.dataset.sub = sub;
      b.appendChild(iconEl(icon, 2));
      el('span', '', b).textContent = t(`build.sub.${sub}`);
      b.addEventListener('click', () => this.h.setMode(m));
      this.subBtns.set(m, b);
    }
    const search = el('span', 'chip search', subs);
    search.appendChild(iconEl('ui.search', 2));
    const tabs = el('div', 'buy-tabs', this.buyPanel);
    for (const c of BUY_CATEGORIES) {
      const b = el('button', 'buy-tab', tabs);
      b.type = 'button';
      b.dataset.cat = c;
      const first = this.h.catalog().find((i) => i.category === c);
      const th = fit(first ? this.h.thumb('object', first.id) : null, 40, 36);
      const pic = el('span', 'cat-pic', b);
      if (th) pic.appendChild(th);
      el('span', 'cat-name', b).textContent = t(`catalog.cat.${c}.short`);
      b.addEventListener('click', () => this.setCategory(c));
      this.catTabs.set(c, b);
    }
    this.buyGrid = el('div', 'buy-grid', mid);
    this.toolBar = el('div', 'tool-bar', left);
    this.toolBar.dataset.testid = 'tool-bar';
    for (const tool of BUILD_TOOLS) {
      const b = el('button', 'tool-btn', this.toolBar);
      b.type = 'button';
      b.dataset.tool = tool;
      const th = this.h.thumb('tool', tool);
      if (th) b.appendChild(th);
      el('span', '', b).textContent = t(`build.tool.${tool}`);
      b.title = t(`build.hint.${tool}`);
      b.addEventListener('click', () => this.h.setTool(tool));
      this.toolBtns.set(tool, b);
    }
    const cons = el('label', 'cons', this.detail);
    cons.title = t('build.construction.title');
    this.consBox = el('input', '', cons);
    this.consBox.type = 'checkbox';
    this.consBox.addEventListener('change', () => this.h.setConstruction(this.consBox.checked));
    el('i', 'toggle', cons);
    // 아이콘(스패너·달)만으로는 뜻을 몰라 글자로 (사용자 요청 2026-09-27)
    el('span', 'cons-lb', cons).textContent = t('build.construction');
    this.consEl = cons;
    this.info = el('div', 'build-info', this.root);
    this.info.dataset.testid = 'build-info';
  }

  setMode(m: GameMode): void {
    this.mode = m;
    this.root.dataset.mode = m;
    // 물건/짓기 둘 다 건축 버튼이 켜짐
    for (const [k, b] of this.modeBtns) b.classList.toggle('on', k === (m === 'buy' ? 'build' : m));
    for (const [k, b] of this.subBtns) b.classList.toggle('on', k === m);
    if (m === 'build') this.renderPicker();
    if (m === 'buy') this.renderBuy();
    this.consEl.style.display = m === 'build' ? '' : 'none';
  }

  setMoney(text: string): void {
    if (this.moneyEl.textContent === text) return;
    this.moneyEl.textContent = '';
    this.moneyEl.append(iconEl('cute.coin', 1), document.createTextNode(text));
  }

  /** 오른쪽 설명 (고른 물건/재질) */
  private showDetail(o: { kind: string; id: string; nameKey: string; price: string; estate?: string | null; locked: boolean; roomScore?: number; variants?: string[]; size?: { w: number; h: number } }): void {
    const d = this.detail;
    for (const c of [...d.children]) if (c !== this.consEl) c.remove();
    const top = el('div', 'det-top', d);
    const pic = el('div', 'det-pic', top);
    const th = fit(this.h.thumb(o.kind, o.id), 84, 100);
    if (th) pic.appendChild(th);
    const tx = el('div', 'det-tx', top);
    el('b', 'det-name', tx).textContent = t(o.nameKey);
    el('div', 'det-price', tx).textContent = o.price;
    if (o.size) {
      const sz = el('div', 'det-size', tx);
      for (let i = 0; i < o.size.w * o.size.h && i < 6; i++) el('i', '', sz);
      sz.style.gridTemplateColumns = `repeat(${o.size.w}, 12px)`;
    }
    const line = el('div', 'det-line', d);
    if (o.estate) {
      const e = el('span', `det-estate ${o.locked ? 'no' : ''}`, line);
      e.append(iconEl(o.locked ? 'cute.no' : 'cute.crown', 1), document.createTextNode(t(`estate.${o.estate}`)));
    }
    if (o.roomScore) {
      const r = el('span', 'det-score', line);
      r.append(iconEl('cute.star_blue', 1), document.createTextNode(`+${o.roomScore}`));
    }
    if (o.variants?.length) {
      const vs = el('div', 'variants det-var', d);
      for (const v of o.variants.slice(0, 8)) {
        const b = el('button', 'variant', vs);
        b.type = 'button';
        b.dataset.variant = v;
        b.title = t(`variant.${v}`);
        b.style.setProperty('--v', VARIANT_COLORS[v] ?? '#888');
        b.addEventListener('click', () => this.h.pickObject(o.id, v));
      }
    }
    d.insertBefore(this.consEl, null);
  }

  /** 놓인 물건 · 벽을 골랐을 때 오른쪽 판 (null = 원래대로) */
  showPlaced(s: PlacedSel | null, a?: PlacedActs): void {
    const d = this.detail;
    for (const c of [...d.children]) if (c !== this.consEl) c.remove();
    d.classList.toggle('placed', !!s);
    if (!s || !a) {
      if (this.mode === 'build') this.renderPicker();
      else if (this.selectedObject) this.renderBuy();
      return;
    }
    const top = el('div', 'det-top', d);
    const pic = el('div', 'det-pic', top);
    const th = fit(this.h.thumb(s.kind === 'wall' ? 'walls' : 'object', s.id, s.variant ?? undefined), 84, 100);
    if (th) pic.appendChild(th);
    const tx = el('div', 'det-tx', top);
    el('b', 'det-name', tx).textContent = t(s.nameKey);
    const pr = el('div', 'det-price sel-sell', tx);
    pr.append(iconEl('cute.coin', 1), document.createTextNode(`+${formatPrice(s.sell)}`));
    if (s.cells) {
      const n = el('div', 'det-price', tx);
      n.textContent = `${s.cells}`;
      n.prepend(iconEl('rv.map', 1));
    }
    if (s.kind === 'object' && s.variants?.length && a.recolor) {
      const vs = el('div', 'variants det-var sel-var', d);
      for (const v of s.variants.slice(0, 8)) {
        const b = el('button', `variant ${v === s.variant ? 'on' : ''}`.trim(), vs);
        b.type = 'button';
        b.dataset.variant = v;
        b.title = `${t(`variant.${v}`)} · ${formatPrice(s.recolor ?? 0)}`;
        b.style.setProperty('--v', VARIANT_COLORS[v] ?? '#888');
        b.addEventListener('click', () => a.recolor!(v));
      }
    }
    if (s.kind === 'wall' && s.styles?.length && a.paint) {
      const ws = el('div', 'sel-walls', d);
      for (const p of s.styles) {
        const b = el('button', `sel-wall ${p.id === s.id ? 'on' : ''} ${p.locked ? 'locked' : ''}`.trim(), ws);
        b.type = 'button';
        b.dataset.style = p.id;
        b.disabled = p.locked;
        b.title = `${t(p.nameKey)} · ${formatPrice(p.price * (s.cells ?? 1))}`;
        const w = fit(this.h.thumb('walls', p.id), 22, 30);
        if (w) b.appendChild(w);
        // Shift 를 누르고 고르면 붙어 있는 같은 벽 전부
        b.addEventListener('click', (e) => a.paint!(p.id, e.shiftKey));
      }
    }
    const acts = el('div', 'sel-acts', d);
    const act = (icon: string, key: string, fn: (() => void) | undefined) => {
      if (!fn) return;
      const b = el('button', 'sel-act', acts);
      b.type = 'button';
      b.dataset.act = key;
      b.appendChild(iconEl(icon, 2));
      el('span', '', b).textContent = t(`build.sel.${key}`);
      b.addEventListener('click', fn);
    };
    act('cute.cursor', 'move', a.move);
    act('cute.reroll', 'rotate', a.rotate);
    act('cute.coin', s.kind === 'wall' ? 'erase' : 'sell', a.sell);
    d.insertBefore(this.consEl, null);
  }

  setTool(tool: BuildTool): void {
    this.tool = tool;
    for (const [k, b] of this.toolBtns) b.classList.toggle('on', k === tool);
    this.renderPicker();
  }

  /** 도구의 현재 재질 (없으면 목록 첫 번째 중 쓸 수 있는 것) */
  partOf(tool: BuildTool): string | null {
    const cur = this.part.get(tool);
    if (cur) return cur;
    const list = this.h.parts(tool);
    const first = list.find((p) => !p.locked) ?? list[0];
    if (first) this.part.set(tool, first.id);
    return first?.id ?? null;
  }

  selectPart(tool: BuildTool, id: string): void {
    this.part.set(tool, id);
    this.renderPicker();
  }

  private renderPicker(): void {
    const tool = this.tool;
    this.picker.innerHTML = '';
    const kind = TOOL_PARTS[tool];
    this.titleEl.textContent = t(`build.tool.${tool}`);
    this.picker.classList.toggle('empty', !kind);
    if (!kind) {
      // 재질이 없는 도구: 글 대신 도구 그림만 (27-3)
      const th = this.h.thumb('tool', tool);
      if (th) el('div', 'picker-hint', this.picker).appendChild(fit(th, 64, 64));
      return;
    }
    const cur = this.partOf(tool);
    const list = this.h.parts(tool);
    const curP = list.find((p) => p.id === cur);
    if (curP) this.showDetail({ kind, id: curP.id, nameKey: curP.nameKey, price: curP.price ? formatPrice(curP.price) : t('money.free'), estate: curP.estate, locked: curP.locked });
    const cnt = el('span', 'dock-n', this.titleEl);
    cnt.textContent = ` ${list.length}`;
    for (const p of list) {
      const b = el('button', 'part', this.picker);
      b.type = 'button';
      b.dataset.part = p.id;
      b.classList.toggle('on', p.id === cur);
      b.classList.toggle('locked', p.locked);
      const th = fit(this.h.thumb(kind, p.id), 88, 64);
      if (th) b.appendChild(th);
      el('span', 'part-name', b).textContent = t(p.nameKey);
      el('span', 'part-price', b).textContent = p.price ? formatPrice(p.price) : t('money.free');
      if (p.locked) {
        b.title = t('build.err.estate');
        el('i', 'lock', b);
      }
      b.addEventListener('click', () => {
        if (p.locked) {
          this.flash(t('build.err.estate'), true);
          return;
        }
        this.part.set(tool, p.id);
        this.h.pickPart(tool, p.id);
        this.renderPicker();
      });
    }
  }

  setCategory(c: string): void {
    this.category = c;
    this.renderBuy();
  }

  private renderBuy(): void {
    for (const [k, b] of this.catTabs) b.classList.toggle('on', k === this.category);
    this.buyGrid.innerHTML = '';
    const items = this.h.catalog().filter((i) => i.category === this.category).sort((a, b) => a.price - b.price);
    this.titleEl.textContent = t(`catalog.cat.${this.category}`);
    el('span', 'dock-n', this.titleEl).textContent = ` ${items.length}`;
    const sel = items.find((i) => i.id === this.selectedObject) ?? items.find((i) => !i.locked);
    if (sel) this.showDetail({ kind: 'object', id: sel.id, nameKey: sel.nameKey, price: sel.crafted ? t('build.crafted.count', { n: sel.crafted.n }) : formatPrice(sel.price), estate: sel.estate, locked: sel.locked, roomScore: sel.roomScore, variants: sel.variants });
    for (const it of items) {
      const card = el('div', 'buy-item', this.buyGrid);
      card.dataset.object = it.id;
      card.classList.toggle('locked', it.locked);
      card.classList.toggle('on', it.id === this.selectedObject);
      const th = fit(this.h.thumb('object', it.id), 88, 64);
      if (th) card.appendChild(th);
      el('span', 'part-name', card).textContent = t(it.nameKey);
      el('span', 'part-price', card).textContent = it.crafted ? t('build.crafted.count', { n: it.crafted.n }) : formatPrice(it.price);
      if (it.locked) el('i', 'lock', card);
      card.title = `${t(it.nameKey)} · ${formatPrice(it.price)}${it.roomScore ? ` · ${t('build.roomScore', { n: it.roomScore })}` : ''}`;
      card.addEventListener('click', () => {
        if (it.locked) {
          this.flash(t('build.err.estate'), true);
          return;
        }
        this.selectedObject = it.id;
        this.h.pickObject(it.id);
        this.renderBuy();
      });
      // 색 변형 견본은 오른쪽 설명 칸에서 고름 (27-10)
      if (it.variants.length && this.mode !== 'buy') {
        const vs = el('div', 'variants', card);
        for (const v of it.variants.slice(0, 8)) {
          const d = el('button', 'variant', vs);
          d.type = 'button';
          d.dataset.variant = v;
          d.title = t(`variant.${v}`);
          d.style.setProperty('--v', VARIANT_COLORS[v] ?? '#888');
          d.addEventListener('click', (e) => {
            e.stopPropagation();
            if (it.locked) return;
            this.selectedObject = it.id;
            this.h.pickObject(it.id, v);
            this.renderBuy();
          });
        }
      }
    }
  }

  clearObject(): void {
    this.selectedObject = null;
    if (this.mode === 'buy') this.renderBuy();
  }

  setViewState(v: { cutaway: string; level: number; roof: 'auto' | 'on' | 'off' }): void {
    this.levelEl.textContent = t(`build.level.${v.level}`);
    for (const [k, b] of this.cutBtns) b.classList.toggle('on', k === v.cutaway);
    this.roofMode = v.roof;
    this.roofBtn.dataset.roof = v.roof;
    this.roofBtn.title = t(`build.view.roof.${v.roof}`);
  }

  update(state: { canUndo: boolean; canRedo: boolean; warnings: number; spent: number; construction?: boolean }): void {
    if (state.construction !== undefined) this.consBox.checked = state.construction;
    this.undoBtn.disabled = !state.canUndo;
    this.redoBtn.disabled = !state.canRedo;
    this.warnEl.textContent = state.warnings ? t('build.warnings', { n: state.warnings }) : '';
    this.warnEl.classList.toggle('show', state.warnings > 0);
    const cost = state.spent ? formatPrice(Math.abs(state.spent)) : '';
    if (this.costEl.dataset.v !== cost) {
      this.costEl.dataset.v = cost;
      this.costEl.textContent = '';
      if (cost) this.costEl.append(iconEl('cute.wrench', 1), document.createTextNode(`−${cost}`));
    }
  }

  /** 짧은 안내 (오류는 붉게) */
  flash(text: string, error = false): void {
    this.info.textContent = text;
    this.info.classList.toggle('error', error);
    this.info.classList.add('show');
    clearTimeout(this.infoTimer);
    this.infoTimer = window.setTimeout(() => this.info.classList.remove('show'), 2600);
  }

  /** 커서 옆 값 표시 */
  hint(text: string | null): void {
    if (!text) {
      this.info.classList.remove('show');
      return;
    }
    this.info.textContent = text;
    this.info.classList.remove('error');
    this.info.classList.add('show');
  }
}

/** 변형 이름 → 견본 색 (catalog 2-1: 나무 4톤, 천 8색) */
const VARIANT_COLORS: Record<string, string> = {
  oak: '#a0693f', walnut: '#6e4a42', pine: '#dcae78', ebony: '#3b2630',
  red: '#b8322a', blue: '#3f5f9a', green: '#4f7f3a', yellow: '#d6b13e', purple: '#6e4a8a', brown: '#7a5132', grey: '#8a8580', white: '#ece4d4',
};
