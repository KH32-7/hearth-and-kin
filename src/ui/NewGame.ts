/**
 * 타이틀 · 새 게임 · 가문 선택 (GDD 27-1, 16-2, 27-11). 가문 만들기는 FamilyCreator, 문장은 HeraldryEditor.
 *
 * 게임(HearthGame)은 뒤에서 그대로 불러오고(타이틀 배경 = 마을 전경), 이 화면이 그 위를 덮음.
 * 시작하면 sim 의도: setLifespan → setDeathRules → house.applyPreset (꾸몄으면 family·roles 를 같이: 그 식구에게 프리셋 자산)
 * → setClanName · setHeraldry · setMotto · setInheritanceLaw.
 * 판은 HUD 와 같은 둥근 반투명(.g), 버튼은 Cute 동그란 버튼, 글자는 이름 · 수치 · 내용만 (설명은 툴팁).
 * 화면이 떠 있는 동안 게임 단축키는 막음 (캡처 단계에서 멈춤).
 */
import economy from '../data/economy.json';
import lifecycle from '../data/lifecycle.json';
import deathRules from '../data/death_rules.json';
import estatesData from '../data/estates.json';
import credits from '../../assets/CREDITS.json';
import type { HearthGame } from '../game/HearthGame';
import type { Snapshot } from '../sim/protocol';
import { Rng } from '../sim/core/rng';
import presetsRaw from '../data/start_presets.json';
import { presetCash, resolvePreset } from '../sim/house/presets';
import { t } from '../i18n';
import { formatMoney } from './Hud';
import { bookUrl, iconEl } from './skin';
import { heraldryCanvas } from './HeraldryEditor';
import { draftFromPreset, draftToSpec, ESTATES, estateTab, FamilyCreator, PRESETS, WEALTHS, type Estate, type FamilyDraft } from './FamilyCreator';
import { Tutorial, tutorialDone } from './Tutorial';

type Page = 'title' | 'setup' | 'family' | 'create' | 'house' | 'credits' | 'settings' | 'starting' | 'closed';
type Step = 'rules' | 'family' | 'create' | 'house';

const LIFESPANS = Object.keys((lifecycle as { lifespan: { presets: Record<string, number> } }).lifespan.presets);
const LIFESPAN_MULT = (lifecycle as { lifespan: { presets: Record<string, number> } }).lifespan.presets;
const DEATHS = Object.keys((deathRules as { presets: Record<string, unknown> }).presets);
/** 시작 집 예산 (start_presets.json houseBudget) */
const HOUSE_BUDGET = (presetsRaw as unknown as { houseBudget?: Record<string, number> }).houseBudget ?? {};
/** 집 부지를 고르지 않는 집 (교회 사제관, 수도원 방) */
const NO_LOT = new Set(['rectory', 'monastery_cell']);
const ECON = economy as unknown as { presets: { savingsDays: number }; estates: Record<string, { target: { net: number } }> };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

function btn(parent: HTMLElement, cls: string, tip: string, act: string, icon?: string, text?: string): HTMLButtonElement {
  const b = el('button', cls, parent);
  b.type = 'button';
  if (tip) b.title = tip;
  b.dataset.act = act;
  if (icon) b.appendChild(iconEl(icon, cls.includes('ng-mini') ? 1 : 2));
  if (text !== undefined) el('span', '', b, text);
  return b;
}

export interface StartLog {
  preset: string;
  custom: boolean;
  results: Array<{ intent: string; result: unknown }>;
  headId: number;
}

export class NewGameFlow {
  readonly root: HTMLElement;
  private stage: HTMLElement;
  private page: Page = 'closed';
  private rng = new Rng((Date.now() ^ 0x5bd1e995) >>> 0);
  private lifespan = (lifecycle as { lifespan: { default: string } }).lifespan.default;
  private death = (deathRules as { defaultPreset: string }).defaultPreset;
  private estate: Estate = 'freeman';
  private wealth: 'poor' | 'normal' | 'rich' = 'normal';
  private creator: FamilyCreator | null = null;
  private draft: FamilyDraft | null = null;
  /** 게임 중에 연 설정/타이틀 (이미 한 번 시작함) */
  private started = false;
  tutorial: Tutorial | null = null;
  readonly log: StartLog[] = [];

  constructor(private app: HTMLElement, private game: HearthGame) {
    this.root = el('div', 'ng', app);
    this.stage = el('div', 'ng-stage', this.root);
    // 게임을 다 불러올 때까지는 뒤(로딩 화면)를 가림, 다 되면 마을 전경이 배경
    this.root.classList.add('wait');
    void this.gameReady().then(() => this.root.classList.remove('wait'));
    // 화면이 떠 있으면 게임 단축키를 막음 (입력칸 글자는 그대로 들어감). Esc = 뒤로
    window.addEventListener('keydown', (e) => {
      if (this.page === 'closed') return;
      e.stopPropagation();
      if (e.key === 'Tab') e.preventDefault();
      if (e.key === 'Escape') this.escape();
    }, true);
    window.addEventListener('keyup', (e) => {
      if (this.page !== 'closed') e.stopPropagation();
    }, true);
    const w = window as unknown as Record<string, unknown>;
    w.__newGame = {
      page: () => this.page,
      log: () => this.log,
      draft: () => this.draft,
      spec: () => (this.draft ? draftToSpec(this.draft) : null),
      creator: () => this.creator,
      tutorialStep: () => this.tutorial?.stepId ?? null,
      inputLog: () => this.game.client.request((reqId) => ({ type: 'inputLog', reqId })),
    };
  }

  // ------------------------------------------------------------------ 공통

  private async gameReady(): Promise<void> {
    while (!this.game.ready) await new Promise((r) => setTimeout(r, 100));
  }

  private show(page: Page): void {
    if (this.page === 'create' && page !== 'create' && page !== 'house') this.creator?.close();
    if (this.page === 'house' && page !== 'house') this.leaveHouse();
    this.page = page;
    this.root.dataset.page = page;
    this.root.hidden = page === 'closed';
    this.app.classList.toggle('ng-open', page !== 'closed');
    this.stage.textContent = '';
    if (this.creator && page === 'create') this.stage.appendChild(this.creator.root);
  }

  private escape(): void {
    if (this.page === 'create' && this.creator?.editingHeraldry) return this.creator.closeHeraldry();
    if (this.page === 'setup' || this.page === 'credits') return this.showTitle();
    if (this.page === 'settings') return this.closeSettings();
    if (this.page === 'family') return this.showSetup();
    if (this.page === 'create') return this.showFamily();
    if (this.page === 'house') return void this.openCreator();
  }

  private steps(current: Step): void {
    const bar = el('div', 'ng-steps g', this.stage);
    const list: Array<[Step, string]> = [['rules', 'rv.map'], ['family', 'ui.crest'], ['create', 'cute.heart'], ['house', 'rv.house']];
    const idx = list.findIndex(([k]) => k === current);
    list.forEach(([k, icon], i) => {
      if (i) el('i', 'ng-steps-sep', bar);
      const s = el('div', `ng-ib step ${i === idx ? 'on' : ''} ${i < idx ? 'past' : ''}`.trim(), bar);
      s.dataset.step = k;
      s.appendChild(iconEl(icon, 2));
      el('span', 's', s, t(`ng.step.${k === 'rules' ? 'rules' : k}`));
    });
  }

  private corner(side: 'l' | 'r', icon: string, tip: string, act: string, fn: () => void, extra = ''): HTMLButtonElement {
    const b = btn(this.stage, `ng-rbtn ng-corner ${side} ${extra}`.trim(), tip, act, icon);
    b.addEventListener('click', fn);
    return b;
  }

  private chipRow(parent: HTMLElement, label: string, icon: string, items: string[], cur: string, text: (id: string) => string, tip: (id: string) => string, act: string, pick: (id: string) => void): void {
    const r = el('div', 'ng-row', parent);
    const lab = el('div', 'ng-row-lab s', r);
    lab.appendChild(iconEl(icon, 2));
    el('b', '', lab, label);
    const box = el('div', 'ng-row-ctl', r);
    for (const id of items) {
      const b = btn(box, 'ng-chip s', tip(id), `${act}-${id}`, undefined, text(id));
      b.classList.toggle('on', id === cur);
      b.addEventListener('click', () => pick(id));
    }
  }

  // ------------------------------------------------------------------ 타이틀

  showTitle(): void {
    this.tutorial?.stop();
    if (this.game.ready) this.game.setSpeed(0);
    else void this.gameReady().then(() => {
      if (this.page !== 'closed') this.game.setSpeed(0);
    });
    this.show('title');
    const logo = el('div', 'ng-logo', this.stage);
    el('div', 'ng-logo-t fl', logo, t('ng.title'));
    el('div', 'ng-logo-s fl s', logo, t('ng.title.sub'));
    const menu = el('div', 'ng-menu g', this.stage);
    const row = (act: string, icon: string, text: string, fn: (() => void) | null, tip = '') => {
      const b = btn(menu, 'menu-row s', tip, act, icon, text);
      b.classList.add('ng-menu-row');
      if (fn) b.addEventListener('click', fn);
      else b.disabled = true;
      return b;
    };
    row('new', 'cute.star', t('ng.menu.new'), () => this.showSetup());
    row('continue', 'cute.book_blue', t('ng.menu.continue'), this.started ? () => this.close() : null, this.started ? '' : t('ng.menu.no_save'));
    row('gallery', 'cute.trophy', t('ng.menu.gallery'), null, t('ng.menu.no_gallery'));
    row('settings', 'cute.gear', t('ng.menu.settings'), () => this.showSettings());
    row('credits', 'cute.book_red', t('ng.menu.credits'), () => this.showCredits());
  }

  // ------------------------------------------------------------------ 새 게임 설정 (마을, 수명, 죽음)

  showSetup(): void {
    this.show('setup');
    this.steps('rules');
    const panel = el('div', 'ng-panel g ng-setup', this.stage);
    const town = el('button', 'ng-town on', panel);
    town.type = 'button';
    town.dataset.act = 'town-ashford';
    town.title = t('ng.town.ashford.tip');
    town.appendChild(iconEl('rv.castle', 3));
    el('b', 'fl', town, t('ng.town.ashford'));
    this.rules(panel, false);
    this.corner('l', 'cute.left', t('ng.back'), 'back', () => this.showTitle());
    this.corner('r', 'cute.right', t('ng.next'), 'next', () => this.showFamily(), 'go');
  }

  private rules(panel: HTMLElement, live: boolean): void {
    const box = el('div', 'ng-rules', panel);
    const draw = () => {
      box.textContent = '';
      this.chipRow(box, t('ng.rule.lifespan'), 'ui.clock', LIFESPANS, this.lifespan, (id) => t(`ng.lifespan.${id}`), (id) => `${t('ng.lifespan.tip')} ×${LIFESPAN_MULT[id]}`, 'lifespan', (id) => {
        this.lifespan = id;
        if (live) void this.game.client.intent({ kind: 'setLifespan', preset: id });
        draw();
      });
      this.chipRow(box, t('ng.rule.death'), 'cute.shield', DEATHS, this.death, (id) => t(`death.preset.${id}`), (id) => t(`ng.death.${id}.tip`), 'death', (id) => {
        this.death = id;
        if (live) void this.game.client.intent({ kind: 'setDeathRules', preset: id });
        draw();
      });
    };
    draw();
  }

  // ------------------------------------------------------------------ 가문 선택 (7 신분 × 3 형편)

  private presetId(): string {
    return `${this.estate}_${this.wealth}`;
  }

  showFamily(): void {
    this.show('family');
    this.steps('family');
    const list = el('div', 'ng-estates g', this.stage);
    for (const e of ESTATES) {
      const b = btn(list, `ng-estate ${e === this.estate ? 'on' : ''}`.trim(), '', `estate-${e}`);
      b.dataset.estate = e;
      b.appendChild(estateTab(e, e === this.estate, 'ng-estate-tab'));
      const tx = el('span', 'ng-estate-t', b);
      el('b', 's', tx, t(`estate.${e}`));
      el('small', 's', tx, t(`estate.${e}.desc`));
      b.addEventListener('click', () => {
        this.estate = e;
        this.showFamily();
      });
    }
    const main = el('div', 'ng-fam-main', this.stage);
    // 신분 색 책 (27-11 표지 색): 왼쪽 쪽 = 이름 · 할 수 있는 일, 오른쪽 쪽 = 매인 것
    const book = el('div', 'ng-book', main);
    const cover = el('img', 'px ng-cover', book);
    cover.src = bookUrl(this.estate);
    cover.alt = '';
    const E = (estatesData as unknown as { estates: Record<string, { can?: string[]; limits?: string[] }> }).estates[this.estate];
    const pl = el('div', 'ng-page l', book);
    el('b', 'ng-page-t', pl, t(`estate.${this.estate}`));
    el('div', 'ng-page-d', pl, t(`estate.${this.estate}.desc`));
    for (const c of E?.can ?? []) {
      const l = el('div', 'ng-page-li', pl);
      l.appendChild(iconEl('cute.check', 1));
      el('span', '', l, t(`estate.can.${c}`));
    }
    const pr = el('div', 'ng-page r', book);
    for (const c of E?.limits ?? []) {
      const l = el('div', 'ng-page-li', pr);
      l.appendChild(iconEl('cute.minus_red', 1));
      el('span', '', l, t(`estate.limit.${c}`));
    }
    const cards = el('div', 'ng-wealths', main);
    for (const w of WEALTHS) this.wealthCard(cards, w);
    this.corner('l', 'cute.left', t('ng.back'), 'back', () => this.showSetup());
    // 심즈처럼: 형편(돈·명성·직업·재산)만 고르고, 식구는 다음 화면에서 한 사람부터 만듦, 집은 그다음 마을 지도에서 삼
    this.corner('r', 'cute.right', t('ng.next'), 'next', () => void this.openCreator(), 'go big');
  }

  private wealthCard(parent: HTMLElement, w: 'poor' | 'normal' | 'rich'): void {
    const id = `${this.estate}_${w}`;
    const r = resolvePreset(PRESETS, id)!;
    const b = btn(parent, `ng-wcard g ${w === this.wealth ? 'on' : ''}`.trim(), '', `wealth-${w}`);
    b.dataset.preset = id;
    b.addEventListener('click', () => {
      this.wealth = w;
      this.showFamily();
    });
    const head = el('div', 'ng-wcard-h', b);
    el('b', 'fl', head, t(`preset.${id}`));
    const coins = el('span', 'ng-wcard-coins', head);
    for (let i = 0; i < WEALTHS.indexOf(w) + 1; i++) coins.appendChild(iconEl('cute.coin', 1));
    const line = (icon: string, text: string, cls = '') => {
      const l = el('div', `ng-line s ${cls}`.trim(), b);
      l.appendChild(iconEl(icon, 2));
      el('span', '', l, text);
      return l;
    };
    const S = (ECON.estates[r.estate]?.target.net ?? 0) * ECON.presets.savingsDays;
    const cash = presetCash(S, r.cashS, LIFESPAN_MULT[this.lifespan] ?? 1);
    if (cash >= 0) line('cute.coins', formatMoney(cash));
    else line('cute.coins', t('ng.debt', { money: formatMoney(-cash) }), 'bad');
    line('cute.crown', String(r.fame));
    const A = r.assets;
    if (A.house.tenure === 'owned') line('rv.house', t('ng.house.budget', { money: formatMoney(HOUSE_BUDGET[A.house.kind] ?? 0) }));
    else line('rv.house', `${t(`ng.house.${A.house.kind}`)} · ${t(`ng.tenure.${A.house.tenure}`)}`);
    const careers = Object.values(A.careers ?? {}).map((c) => t(`career.${c}`));
    if (careers.length) line('cute.wrench', careers.join(' · '));
    const extras: string[] = [];
    if (A.plots) extras.push(t('ng.asset.plots', { n: A.plots }));
    for (const [k, n] of Object.entries(A.animals ?? {})) if (n > 0) extras.push(t(`ng.animal.${k}`, { n }));
    for (const [k, n] of Object.entries(A.items ?? {})) if (n > 0) extras.push(t(`ng.item.${k}`));
    if (A.tools) extras.push(t('ng.asset.tools'));
    if (A.guild) extras.push(t('ng.asset.guild'));
    if (A.apprentice) extras.push(t('ng.asset.apprentice', { n: A.apprentice }));
    if (A.squire) extras.push(t('ng.asset.squire', { n: A.squire }));
    for (const s of A.servants ?? []) extras.push(t(`servant.role.${s}`));
    if (A.capital) extras.push(t('ng.asset.capital', { money: formatMoney(Math.round(((ECON.estates[A.capital.of]?.target.net ?? 0) * ECON.presets.savingsDays) * A.capital.mult * (LIFESPAN_MULT[this.lifespan] ?? 1)) * 4) }));
    if (A.fief) extras.push(t('ng.asset.fief', { manors: A.fief.manors, tenants: A.fief.tenants }) + (A.fief.lord ? ` · ${t('ng.asset.lord')}` : ''));
    if (extras.length) line('cute.bag', extras.join(' · '), 'wrap');
  }

  // ------------------------------------------------------------------ 가문 만들기

  private async openCreator(): Promise<void> {
    const id = this.presetId();
    if (!this.draft || (this.draft.preset !== id && this.page !== 'house')) this.draft = draftFromPreset(id, this.rng, true);
    if (!this.creator) {
      this.creator = new FamilyCreator(this.stage, (p) => this.game.assets.image(p), this.rng, {
        back: () => {
          if (this.creator) {
            this.estate = this.creator.draft.estate;
            this.wealth = this.creator.draft.wealth;
          }
          this.showFamily();
        },
        start: (d) => this.showHouse(d),
      });
    }
    await this.gameReady();
    this.show('create');
    this.steps('create');
    this.creator.open(this.draft);
  }

  // ------------------------------------------------------------------ 집 고르기 (심즈 · 인조이식: 마을 지도에서 집을 사서 들어감)

  private lot: string | null = null;
  private pickRect: [number, number, number, number] | null = null;
  private tags: HTMLElement | null = null;
  private tagRaf = 0;

  showHouse(d: FamilyDraft): void {
    this.draft = d;
    this.estate = d.estate;
    this.wealth = d.wealth;
    this.show('house');
    this.steps('house');
    const r = resolvePreset(PRESETS, d.preset)!;
    const kind = r.assets.house.kind;
    const tenure = r.assets.house.tenure;
    const info = this.game.startLots();
    this.corner('l', 'cute.left', t('ng.back'), 'back', () => void this.openCreator());
    const S = (ECON.estates[r.estate]?.target.net ?? 0) * ECON.presets.savingsDays;
    const cash = presetCash(S, r.cashS, LIFESPAN_MULT[this.lifespan] ?? 1);
    // 가진 돈: 시작 현금(몰락이면 빌린 돈) + 집 예산 (sim houseLink.startLotOk 와 같은 셈)
    const funds = Math.abs(cash) + (tenure === 'owned' ? HOUSE_BUDGET[kind] ?? 0 : 0);
    const go = this.corner('r', 'cute.right', t('ng.start'), 'start', () => void this.start(d, this.lot), 'go big');
    const panel = el('div', 'ng-panel g ng-house', this.stage);
    const head = el('div', 'ng-house-funds', panel);
    head.appendChild(iconEl('cute.coins', 2));
    el('b', 'fl', head, formatMoney(funds));
    if (cash < 0) el('span', 'bad s', head, t('ng.debt', { money: formatMoney(-cash) }));
    // 교회 집(사제관 · 수도원): 고를 부지가 없음
    if (!info || NO_LOT.has(kind)) {
      const row = el('div', 'ng-house-row on s', panel);
      row.appendChild(iconEl('rv.church', 2));
      el('b', '', row, `${t(`ng.house.${kind}`)} · ${t(`ng.tenure.${tenure}`)}`);
      this.lot = null;
      return;
    }
    const lots = info.lots.filter((l) => info.free.includes(l.id) && (tenure !== 'lord' || l.size === 'small'));
    const priceOf = (l: { price: number }) => (tenure === 'owned' ? l.price : 0);
    lots.sort((a, b) => priceOf(a) - priceOf(b) || a.id.localeCompare(b.id));
    // 지도 (칸당 2px 바탕 + 빈 집 네모)
    const mapBox = el('div', 'ng-house-map', panel);
    if (info.map) mapBox.appendChild(info.map);
    const over = el('canvas', 'ng-house-over', mapBox);
    over.width = info.w * 2;
    over.height = info.h * 2;
    mapBox.style.aspectRatio = `${info.w} / ${info.h}`;
    const list = el('div', 'ng-house-list ng-scroll', panel);
    const rows = new Map<string, HTMLElement>();
    const afford = (l: { price: number }) => priceOf(l) <= funds;
    const drawMap = () => {
      const c = over.getContext('2d')!;
      c.clearRect(0, 0, over.width, over.height);
      for (const l of lots) {
        const on = l.id === this.lot;
        const w = (l.rect[2] - l.rect[0] + 1) * 2;
        const h = (l.rect[3] - l.rect[1] + 1) * 2;
        c.fillStyle = on ? 'rgba(255,214,90,0.6)' : afford(l) ? 'rgba(140,230,120,0.4)' : 'rgba(200,90,70,0.3)';
        c.fillRect(l.rect[0] * 2, l.rect[1] * 2, w, h);
        c.strokeStyle = on ? '#ffd65a' : afford(l) ? 'rgba(170,245,150,0.95)' : 'rgba(220,110,90,0.8)';
        c.lineWidth = on ? 2 : 1;
        c.strokeRect(l.rect[0] * 2 + 0.5, l.rect[1] * 2 + 0.5, w - 1, h - 1);
      }
    };
    const select = (id: string, look = true) => {
      const l = lots.find((x) => x.id === id);
      if (!l) return;
      this.lot = id;
      for (const [k, e] of rows) e.classList.toggle('on', k === id);
      // 목록 안에서만 스크롤 (scrollIntoView 는 겹친 화면 전체를 밀어 판이 왼쪽으로 잘림)
      const row = rows.get(id);
      if (row) {
        if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
        else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
      }
      go.disabled = !afford(l);
      drawMap();
      if (look) this.game.lookAtTile((l.rect[0] + l.rect[2] + 1) / 2, (l.rect[1] + l.rect[3] + 1) / 2, 2, Math.max(0, (panel.getBoundingClientRect().right + window.innerWidth) / 2 - window.innerWidth / 2));
      // 집 안 들여다보기 (지붕을 걷어 가구 배치가 보이게)
      // 왼쪽 판 오른쪽 빈 곳 가운데로
      const off = Math.max(0, (panel.getBoundingClientRect().right + window.innerWidth) / 2 - window.innerWidth / 2);
      this.game.peekLot(l.rect, off);
      this.pickRect = l.rect;
    };
    for (const l of lots) {
      const row = btn(list, `ng-house-row s ${afford(l) ? '' : 'poor'}`.trim(), '', `lot-${l.id}`);
      row.dataset.lot = l.id;
      row.appendChild(iconEl('rv.house', 2));
      // 이름 = 크기 · 가까운 곳, 그 밑에 침대 수 · 넓이 (심즈 집 고르기의 침실 · 크기 표시)
      const col = el('div', 'ng-house-col', row);
      const cx = (l.rect[0] + l.rect[2] + 1) / 2;
      const cy = (l.rect[1] + l.rect[3] + 1) / 2;
      const near = info.places.reduce<{ p: (typeof info.places)[number] | null; d: number }>((b, p) => {
        const d = Math.hypot(p.anchor[0] - cx, p.anchor[1] - cy);
        return d < b.d ? { p, d } : b;
      }, { p: null, d: 1e9 }).p;
      el('b', '', col, near ? `${t(`town.lot.size.${l.size}`)} · ${t(near.nameKey)}` : t(`town.lot.size.${l.size}`));
      const meta = el('small', 'ng-house-meta', col);
      const objs = this.game.client.snap?.objects ?? [];
      const beds = objs.filter((o) => /^bed/.test(o.defId) && o.x >= l.rect[0] && o.x <= l.rect[2] && o.y >= l.rect[1] && o.y <= l.rect[3]).length;
      meta.appendChild(iconEl('sleep', 1));
      el('span', '', meta, String(beds));
      meta.appendChild(iconEl('rv.map', 1));
      el('span', '', meta, `${l.rect[2] - l.rect[0] + 1}×${l.rect[3] - l.rect[1] + 1}`);
      const p = el('span', 'ng-house-price', row);
      p.appendChild(iconEl('cute.coin', 1));
      el('span', '', p, tenure === 'owned' ? formatMoney(l.price) : t(`ng.tenure.${tenure}`));
      if (tenure === 'owned') {
        const left = el('small', afford(l) ? 'ng-house-left' : 'ng-house-left bad', row);
        if (afford(l)) {
          left.appendChild(iconEl('cute.right', 1));
          el('span', '', left, formatMoney(funds - l.price));
        } else left.appendChild(iconEl('cute.minus_red', 1));
      }
      row.addEventListener('click', () => select(l.id));
      rows.set(l.id, row);
    }
    over.addEventListener('pointerdown', (e) => {
      const b = over.getBoundingClientRect();
      const x = ((e.clientX - b.left) / b.width) * info.w;
      const y = ((e.clientY - b.top) / b.height) * info.h;
      const hit = lots.find((l) => x >= l.rect[0] && x <= l.rect[2] + 1 && y >= l.rect[1] && y <= l.rect[3] + 1);
      if (hit) select(hit.id);
      else this.game.lookAtTile(x, y, undefined, 300);
    });
    // 화면(실제 마을)에서도: 부지를 누르면 고름, 빈 집 위에 값 딱지
    this.game.lotPicker = (x, y) => {
      const hit = lots.find((l) => x >= l.rect[0] && x <= l.rect[2] && y >= l.rect[1] && y <= l.rect[3]);
      if (hit) select(hit.id, false);
    };
    this.tags = el('div', 'ng-house-tags', this.root);
    const tagEls = lots.map((l) => {
      const e = el('button', `ng-house-tag g s ${afford(l) ? '' : 'poor'}`.trim(), this.tags!);
      e.type = 'button';
      e.dataset.lot = l.id;
      e.appendChild(iconEl('cute.coin', 1));
      el('span', '', e, tenure === 'owned' ? formatMoney(l.price) : t(`ng.tenure.${tenure}`));
      e.addEventListener('click', () => select(l.id, false));
      return { l, e };
    });
    const panelRight = () => panel.getBoundingClientRect().right;
    // 고른 부지 테두리 (실제 마을 위)
    const box = el('div', 'ng-house-box', this.tags);
    const frame = () => {
      const minX = panelRight() + 20;
      if (this.pickRect) {
        // 벽 높이(80px = 2.5칸)만큼 위까지: 집 그림 전체를 감싸게
        const a = this.game.tileScreen(this.pickRect[0], this.pickRect[1] - 2.5);
        const b = this.game.tileScreen(this.pickRect[2] + 1, this.pickRect[3] + 1);
        box.style.display = '';
        box.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px)`;
        box.style.width = `${Math.round(b.x - a.x)}px`;
        box.style.height = `${Math.round(b.y - a.y)}px`;
      } else box.style.display = 'none';
      for (const { l, e } of tagEls) {
        const p = this.game.tileScreen((l.rect[0] + l.rect[2] + 1) / 2, l.rect[1] + 0.6);
        const off = p.x < minX || p.y < 90 || p.x > window.innerWidth - 20 || p.y > window.innerHeight - 20;
        e.style.display = off ? 'none' : '';
        e.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
        e.classList.toggle('on', l.id === this.lot);
      }
      this.tagRaf = requestAnimationFrame(frame);
    };
    frame();
    const first = (this.lot && lots.find((l) => l.id === this.lot && afford(l))) || lots.find(afford) || lots[0];
    if (first) select(first.id);
    else go.disabled = true;
  }

  private leaveHouse(): void {
    this.game.lotPicker = null;
    this.game.peekLot(null);
    this.pickRect = null;
    cancelAnimationFrame(this.tagRaf);
    this.tags?.remove();
    this.tags = null;
  }

  // ------------------------------------------------------------------ 시작

  private async start(draft: FamilyDraft | null, lot: string | null = null): Promise<void> {
    const preset = draft?.preset ?? this.presetId();
    this.show('starting');
    const box = el('div', 'ng-starting g s', this.stage);
    if (draft) box.appendChild(heraldryCanvas(draft.heraldry, 2));
    el('span', '', box, t('ng.starting'));
    await this.gameReady();
    const c = this.game.client;
    const log: StartLog = { preset, custom: !!draft, results: [], headId: 0 };
    const send = async (name: string, intent: Record<string, unknown>) => {
      const result = await c.intent(intent);
      log.results.push({ intent: name, result });
      return result as { ok?: boolean; ids?: number[]; result?: { ids: number[]; specs: Array<{ role: string }>; servants: string[] } };
    };
    await send('setLifespan', { kind: 'setLifespan', preset: this.lifespan });
    await send('setDeathRules', { kind: 'setDeathRules', preset: this.death });
    // 꾸민 가족이면 프리셋(돈·집·직업·도제·말·하인·영지)을 그 식구에게 바로 줌 (houseLink applyPreset family/roles)
    const spec = draft ? draftToSpec(draft) : null;
    const pr = await send('applyPreset', { kind: 'house', op: 'applyPreset', args: spec ? { preset, family: spec, roles: draft!.members.map((x) => x.role), lot } : { preset, lot } });
    const res = pr.result;
    const headId = res ? res.ids[Math.max(0, res.specs.findIndex((s) => s.role === 'head'))] ?? 0 : 0;
    if (draft) {
      // 가문명은 조용히 (게임 시작 때 "성을 얻음" 소식·무드렛 없이)
      if (draft.estate !== 'serf' && draft.clan.trim()) await send('setClanName', { kind: 'house', op: 'setClanName', args: { name: draft.clan.trim() } });
      await send('setHeraldry', { kind: 'house', op: 'setHeraldry', args: { spec: draft.heraldry } });
      if (draft.motto.trim()) await send('setMotto', { kind: 'house', op: 'setMotto', args: { text: draft.motto.trim(), tags: draft.mottoTags } });
      await send('setInheritanceLaw', { kind: 'house', op: 'setInheritanceLaw', args: { law: draft.law } });
    }
    log.headId = headId;
    this.log.push(log);
    // 의도 답보다 스냅샷이 먼저 옴 (worker: snapshot → reply). 멈춘 상태라 다음 스냅샷을 기다리지 않음
    const snap: Snapshot | null = c.snap;
    const me = snap?.persons.find((p) => p.id === headId) ?? snap?.persons.find((p) => p.household === 1);
    if (me) this.game.select(me.id, true);
    this.started = true;
    this.draft = null;
    this.close();
    this.game.setSpeed(1);
    if (!tutorialDone()) this.startTutorial();
  }

  close(): void {
    this.show('closed');
    if (this.started && this.game.ready && (this.game.client.snap?.speed ?? 1) === 0) this.game.setSpeed(1);
  }

  startTutorial(): void {
    if (!this.tutorial) {
      const g = this.game;
      this.tutorial = new Tutorial(this.app, {
        selectedId: () => g.selectedId,
        snap: () => g.client.snap,
        pieOpen: () => g.pie.open,
        popup: () => g.hud.currentPopup,
        bookOpen: () => g.notebook.open,
        buildMode: () => g.build?.mode,
        dialogOpen: () => g.dialog.open,
      });
    }
    this.tutorial.start();
  }

  // ------------------------------------------------------------------ 설정 (타이틀 · 게임 메뉴)

  private settingsFrom: Page = 'title';

  showSettings(): void {
    this.settingsFrom = this.page === 'closed' ? 'closed' : 'title';
    if (this.settingsFrom === 'closed' && this.game.ready) this.game.setSpeed(0);
    this.show('settings');
    const panel = el('div', 'ng-panel g ng-settings', this.stage);
    this.rules(panel, this.started);
    const tut = btn(panel, 'ng-pill s', '', 'tutorial', 'cute.question', t('ng.tutorial.replay'));
    tut.disabled = !this.started;
    tut.addEventListener('click', () => {
      this.close();
      this.startTutorial();
    });
    this.corner('l', 'cute.left', t('ng.close'), 'back', () => this.closeSettings());
  }

  private closeSettings(): void {
    if (this.settingsFrom === 'closed') this.close();
    else this.showTitle();
  }

  /** 게임 메뉴 (HUD 메뉴 팝업) */
  menu(a: string): void {
    if (a === 'title') this.showTitle();
    else if (a === 'settings') this.showSettings();
  }

  // ------------------------------------------------------------------ 크레딧

  showCredits(): void {
    this.show('credits');
    const panel = el('div', 'ng-panel g ng-credits ng-scroll', this.stage);
    const packs = new Map<string, { authors: Set<string>; licenses: Set<string> }>();
    for (const c of credits as Array<{ pack?: string; authors?: string[]; licenses?: string[] }>) {
      const k = c.pack ?? '';
      if (!k) continue;
      const p = packs.get(k) ?? { authors: new Set(), licenses: new Set() };
      for (const a of c.authors ?? []) p.authors.add(a);
      for (const l of c.licenses ?? []) p.licenses.add(l);
      packs.set(k, p);
    }
    const row = (name: string, who: string, lic: string) => {
      const r = el('div', 'ng-credit s', panel);
      el('b', '', r, name);
      el('span', '', r, who);
      if (lic) el('small', '', r, lic);
    };
    row(t('ng.credits.font'), 'NEXON Korea', '');
    for (const [k, p] of packs) row(k, [...p.authors].join(', '), [...p.licenses].join(', '));
    this.corner('l', 'cute.left', t('ng.back'), 'back', () => this.showTitle());
  }
}

