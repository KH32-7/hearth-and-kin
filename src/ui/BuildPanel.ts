/**
 * 건축/구매 모드 UI (GDD 23-2, 23-4). DOM 만 (캔버스에 한글을 그리지 않음).
 * - 위 가운데: 모드 (생활 / 구매 / 건축)
 * - 오른쪽 가운데: 보기 도구 (층 ▲▼, 벽 올림/잘라내기/내림, 지붕 자동/보기/숨김)
 * - 아래 가운데 (건축): 도구 줄 + 재질 고르기 (썸네일, 이름, 칸당 값)
 * - 아래 가운데 (구매): 분류 탭 + 물건 목록 (썸네일, 값, 신분 자물쇠, 색/재질 변형)
 * - 실행 취소/다시, 쓴 돈, 길 막힘 경고 개수, 짧은 안내 줄
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
  tool: BuildTool = 'wall';
  private part = new Map<BuildTool, string>();
  private category: string = 'bedroom';
  private selectedObject: string | null = null;
  private infoTimer = 0;

  constructor(parent: HTMLElement, private h: BuildPanelHandlers) {
    this.root = el('div', 'build-ui', parent);
    this.root.dataset.mode = 'live';
    // 모드
    const modes = el('div', 'mode-bar panel-dark', this.root);
    modes.dataset.testid = 'mode-bar';
    for (const m of ['live', 'buy', 'build'] as GameMode[]) {
      const b = el('button', 'mode-btn', modes);
      b.type = 'button';
      b.dataset.mode = m;
      b.appendChild(iconEl(m === 'live' ? 'ui.crest' : m === 'buy' ? 'ui.coin' : 'raven:a4477', 2));
      el('span', '', b).textContent = t(`build.mode.${m}`);
      b.addEventListener('click', () => this.h.setMode(m));
      this.modeBtns.set(m, b);
    }
    // 보기 도구
    const view = el('div', 'view-bar panel-dark', this.root);
    view.dataset.testid = 'view-bar';
    const up = el('button', 'view-btn', view);
    up.type = 'button';
    up.textContent = '▲';
    up.title = t('build.view.levelUp');
    up.addEventListener('click', () => this.h.stepLevel(1));
    this.levelEl = el('div', 'level-label', view);
    const down = el('button', 'view-btn', view);
    down.type = 'button';
    down.textContent = '▼';
    down.title = t('build.view.levelDown');
    down.addEventListener('click', () => this.h.stepLevel(-1));
    el('div', 'view-sep', view);
    for (const c of ['up', 'cut', 'down'] as const) {
      const b = el('button', 'view-btn cut-btn', view);
      b.type = 'button';
      b.dataset.cut = c;
      b.title = t(`build.view.wall.${c}`);
      b.innerHTML = `<i class="wall-glyph wall-${c}"></i>`;
      b.addEventListener('click', () => this.h.setCutaway(c));
      this.cutBtns.set(c, b);
    }
    el('div', 'view-sep', view);
    this.roofBtn = el('button', 'view-btn roof-btn', view);
    this.roofBtn.type = 'button';
    this.roofBtn.innerHTML = '<i class="roof-glyph"></i>';
    this.roofBtn.addEventListener('click', () => this.h.setRoofMode(this.roofMode === 'auto' ? 'on' : this.roofMode === 'on' ? 'off' : 'auto'));

    // 건축 도구
    const dock = el('div', 'build-dock', this.root);
    this.picker = el('div', 'part-picker panel-brown', dock);
    this.picker.dataset.testid = 'part-picker';
    this.buyPanel = el('div', 'buy-panel panel-brown', dock);
    this.buyPanel.dataset.testid = 'buy-panel';
    const tabs = el('div', 'buy-tabs', this.buyPanel);
    for (const c of BUY_CATEGORIES) {
      const b = el('button', 'buy-tab', tabs);
      b.type = 'button';
      b.dataset.cat = c;
      b.textContent = t(`catalog.cat.${c}`);
      b.addEventListener('click', () => this.setCategory(c));
      this.catTabs.set(c, b);
    }
    this.buyGrid = el('div', 'buy-grid', this.buyPanel);
    this.toolBar = el('div', 'tool-bar panel-dark', dock);
    this.toolBar.dataset.testid = 'tool-bar';
    for (const tool of BUILD_TOOLS) {
      const b = el('button', 'tool-btn', this.toolBar);
      b.type = 'button';
      b.dataset.tool = tool;
      const th = this.h.thumb('tool', tool);
      if (th) b.appendChild(th);
      el('span', '', b).textContent = t(`build.tool.${tool}`);
      b.addEventListener('click', () => this.h.setTool(tool));
      this.toolBtns.set(tool, b);
    }
    const hist = el('div', 'hist', dock);
    this.undoBtn = el('button', 'hist-btn', hist);
    this.undoBtn.type = 'button';
    this.undoBtn.textContent = '↶';
    this.undoBtn.title = t('build.undo');
    this.undoBtn.addEventListener('click', () => this.h.undo());
    this.redoBtn = el('button', 'hist-btn', hist);
    this.redoBtn.type = 'button';
    this.redoBtn.textContent = '↷';
    this.redoBtn.title = t('build.redo');
    this.redoBtn.addEventListener('click', () => this.h.redo());
    const cons = el('label', 'cons', hist);
    cons.title = t('build.construction.title');
    this.consBox = el('input', '', cons);
    this.consBox.type = 'checkbox';
    this.consBox.addEventListener('change', () => this.h.setConstruction(this.consBox.checked));
    el('span', '', cons).textContent = t('build.construction');
    this.costEl = el('div', 'cost', hist);
    this.warnEl = el('div', 'warn', hist);
    this.warnEl.dataset.testid = 'build-warnings';
    this.info = el('div', 'build-info', this.root);
    this.info.dataset.testid = 'build-info';
  }

  setMode(m: GameMode): void {
    this.mode = m;
    this.root.dataset.mode = m;
    for (const [k, b] of this.modeBtns) b.classList.toggle('on', k === m);
    if (m === 'build') this.renderPicker();
    if (m === 'buy') this.renderBuy();
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
    this.picker.classList.toggle('empty', !kind);
    if (!kind) {
      el('div', 'picker-hint', this.picker).textContent = t(`build.hint.${tool}`);
      return;
    }
    const cur = this.partOf(tool);
    for (const p of this.h.parts(tool)) {
      const b = el('button', 'part', this.picker);
      b.type = 'button';
      b.dataset.part = p.id;
      b.classList.toggle('on', p.id === cur);
      b.classList.toggle('locked', p.locked);
      const th = this.h.thumb(kind, p.id);
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
    for (const it of items) {
      const card = el('div', 'buy-item', this.buyGrid);
      card.dataset.object = it.id;
      card.classList.toggle('locked', it.locked);
      card.classList.toggle('on', it.id === this.selectedObject);
      const th = this.h.thumb('object', it.id);
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
      if (it.variants.length) {
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
    this.costEl.textContent = state.spent ? t('build.spent', { money: formatPrice(Math.abs(state.spent)) }) : '';
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
