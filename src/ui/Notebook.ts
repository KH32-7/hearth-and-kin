/**
 * 인물 수첩 (Tab, GDD 27-8 · 27-11). Kenmi Cute Fantasy Book_UI 한 권.
 * 위쪽 탭 = 큰 분류 (인물 · 가문 · 생업 · 기록, 귀족은 + 영지), 오른쪽 책갈피 = 분류 안의 쪽, 오른쪽 위 X = 닫기.
 * 책 원본 1px = 화면 S px (정수, 기본 4). 안쪽 부품은 모두 그 격자에 맞춤:
 *   왼쪽 쪽 내용 x 14~98, 오른쪽 126~210, 위아래 12~114 (원본 좌표)
 * 표지·탭 색은 가정 대표 신분 (27-11). 쪽 내용은 기존 패널(내면·관계·일·가계부)을 책 모양으로 싣고,
 * 아직 시뮬레이션 자료가 없는 쪽은 아이콘 빈 상태로 둠 (자료가 들어오면 그대로 채워짐).
 */
import type { PersonSnap, RelationSnap, Snapshot } from '../sim/protocol';
import { t } from '../i18n';
import { heraldryCanvas } from './HeraldryEditor';
import { bookUrl, iconEl, pieceImg, pieceUrl, stitchCard, tabUrl } from './skin';
import type { InnerPanel } from './InnerPanel';
import type { RelationsPanel } from './RelationsPanel';
import type { WorkPanel } from './WorkPanel';
import type { LedgerPanel } from './LedgerPanel';
import { RelationsPanel as RelationsPanelClass } from './RelationsPanel';
import { formatMoney } from './Hud';

type TabId = 'person' | 'house' | 'work' | 'record' | 'domain';
interface PageDef {
  id: string;
  icon: string;
  /** 이 쪽이 보이는 조건 (없으면 늘) */
  when?: (p: PersonSnap, s: Snapshot) => boolean;
}

export interface NotebookHooks {
  portrait(id: number, kind: 'head' | 'bust'): HTMLCanvasElement | null;
  selectPerson(id: number): void;
  focusPerson(id: number): void;
  emotionColor(e: string): string;
  /** 대사창 기록 (27-13) */
  dialogLog(): Array<{ minute: number; who: string; text: string; act?: string }>;
  /** 의도 보내기 (해방금 내기, 편지 읽기 …) */
  intent?(i: Record<string, unknown>): Promise<unknown>;
}

/** 금액 표시 (파딩 → 은화·동화) */
function money(f: number): string {
  const d = Math.floor(f / 4);
  const sil = Math.floor(d / 12);
  return sil ? t('money.sd', { s: sil, d: d % 12 }) : t('money.d', { d });
}

const estateOf = (p: PersonSnap | null, s: Snapshot | null): string => s?.econ?.estate ?? p?.inner?.estate ?? 'freeman';
const LEFT = { x: 14, w: 84 };
const RIGHT = { x: 126, w: 84 };
const TOP = 12;
const BOTTOM = 114;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export class Notebook {
  readonly root: HTMLElement;
  private book: HTMLElement;
  private cover: HTMLImageElement;
  private tabsEl: HTMLElement;
  private marksEl: HTMLElement;
  private left: HTMLElement;
  private right: HTMLElement;
  private S = 4;
  private tab: TabId = 'person';
  private page: Record<TabId, string> = { person: 'emo', house: 'family', work: 'career', record: 'chronicle', domain: 'policy' };
  private sig = '';
  private p: PersonSnap | null = null;
  private s: Snapshot | null = null;
  private seenPages = new Set<string>();
  open = false;

  inner: InnerPanel | null = null;
  relations: RelationsPanel | null = null;
  work: WorkPanel | null = null;
  ledger: LedgerPanel | null = null;

  private readonly TABS: Record<TabId, { icon: string; pages: PageDef[] }> = {
    person: {
      icon: 'cute.heart',
      pages: [
        { id: 'emo', icon: 'cute.heart' }, { id: 'skills', icon: 'cute.star' }, { id: 'persona', icon: 'cute.talk' },
        { id: 'wishes', icon: 'cute.trophy' },
      ],
    },
    house: {
      icon: 'cute.crown',
      pages: [
        { id: 'family', icon: 'cute.crown' }, { id: 'tree', icon: 'cute.shield' }, { id: 'relations', icon: 'cute.heart_blue' },
        { id: 'fame', icon: 'cute.star_blue', when: (p, s) => estateOf(p, s) !== 'serf' },
        { id: 'freedom', icon: 'cute.star_blue', when: (p, s) => estateOf(p, s) === 'serf' || !!s.house?.rise.length },
        { id: 'match', icon: 'cute.heart', when: (_p, s) => s.persons.some((q) => q.household === 1 && ['teen', 'young', 'adult'].includes(q.inner?.stage_life ?? '') && !s.relations.some((r) => (r.a === q.id || r.b === q.id) && (r.flags ?? []).includes('spouse'))) },
      ],
    },
    work: {
      icon: 'cute.coins',
      pages: [
        { id: 'career', icon: 'cute.wrench', when: (p, s) => estateOf(p, s) !== 'clergy' },
        { id: 'clergy', icon: 'rv.church', when: (p) => p.inner?.estate === 'clergy' },
        { id: 'guild', icon: 'cute.trophy', when: (p, s) => estateOf(p, s) === 'artisan' },
        { id: 'trade', icon: 'rv.cart', when: (p, s) => estateOf(p, s) === 'merchant' },
        { id: 'service', icon: 'rv.helm', when: (p, s) => estateOf(p, s) === 'knight' },
        { id: 'servants', icon: 'cute.bag', when: (p, s) => ['merchant', 'knight', 'noble'].includes(estateOf(p, s)) },
        { id: 'farm', icon: 'item.flour' },
        { id: 'ledger', icon: 'cute.coins' },
      ],
    },
    record: {
      icon: 'cute.book_red',
      pages: [
        { id: 'chronicle', icon: 'cute.book_red' }, { id: 'dialog', icon: 'cute.talk' }, { id: 'rumors', icon: 'cute.exclaim' },
        { id: 'letters', icon: 'cute.letter' },
        { id: 'journey', icon: 'rv.cart', when: (_p, s) => s.persons.some((q) => q.household === _p.household && q.hidden && !!q.action?.interactionId.startsWith('work.')) },
      ],
    },
    domain: {
      icon: 'rv.castle',
      // 민심·금고·범죄·정책 6개를 한 쪽에 (예전 5쪽은 거의 같은 내용)
      pages: [{ id: 'policy', icon: 'rv.castle' }],
    },
  };

  constructor(parent: HTMLElement, private hooks: NotebookHooks) {
    this.root = el('div', 'nb-wrap', parent);
    this.root.dataset.testid = 'notebook';
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.book = el('div', 'nb', this.root);
    this.tabsEl = el('div', 'nb-tabs', this.book);
    this.marksEl = el('div', 'nb-marks', this.book);
    this.cover = el('img', 'nb-cover px', this.book);
    this.cover.draggable = false;
    this.left = el('div', 'nb-page nb-left', this.book);
    this.right = el('div', 'nb-page nb-right', this.book);
    const x = el('button', 'nb-close', this.book);
    x.type = 'button';
    x.setAttribute('aria-label', t('hud2.close'));
    x.appendChild(iconEl('cute.x', 2));
    x.addEventListener('click', () => this.close());
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  private layout(): void {
    // 정수 배율: 화면에 들어가는 가장 큰 값 (3~5)
    const w = window.innerWidth;
    const h = window.innerHeight;
    const S = Math.max(2, Math.min(5, Math.floor(Math.min((w - 120) / 260, (h - 120) / 160))));
    this.S = S;
    this.book.style.setProperty('--S', String(S));
    this.book.style.width = `${224 * S}px`;
    this.book.style.height = `${133 * S}px`;
    this.cover.style.width = `${224 * S}px`;
    this.cover.style.height = `${133 * S}px`;
    for (const [e, a] of [[this.left, LEFT], [this.right, RIGHT]] as const) {
      e.style.left = `${a.x * S}px`;
      e.style.top = `${TOP * S}px`;
      e.style.width = `${a.w * S}px`;
      e.style.height = `${(BOTTOM - TOP) * S}px`;
    }
    this.sig = '';
    if (this.open) this.render();
  }

  toggle(page?: string): void {
    if (this.open && (!page || this.pageId() === page)) this.close();
    else this.show(page);
  }

  show(page?: string): void {
    if (page) this.goto(page);
    this.open = true;
    this.root.classList.add('open');
    this.book.classList.remove('flap');
    void this.book.offsetWidth;
    this.book.classList.add('flap');
    this.sig = '';
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('open');
    if (this.ledger?.root.classList.contains('in-book')) this.ledger.hide();
  }

  /** 쪽 이름으로 바로 가기 (우상단 창 버튼 · 예전 탭 이름 호환) */
  goto(page: string): void {
    const alias: Record<string, string> = { mood: 'emo', needs: 'emo', persona: 'persona', wishes: 'wishes', relations: 'relations', work: 'career', ledger: 'ledger', chronicle: 'chronicle', letters: 'letters', skills: 'skills' };
    const id = alias[page] ?? page;
    for (const [tab, def] of Object.entries(this.TABS) as [TabId, { pages: PageDef[] }][]) {
      if (def.pages.some((pg) => pg.id === id)) {
        this.tab = tab;
        this.page[tab] = id;
        this.sig = '';
        return;
      }
    }
  }

  pageId(): string {
    return this.page[this.tab];
  }

  update(p: PersonSnap | null, s: Snapshot): void {
    this.p = p;
    this.s = s;
    if (this.open) this.render();
  }

  private visiblePages(tab: TabId): PageDef[] {
    const p = this.p;
    const s = this.s;
    if (!p || !s) return this.TABS[tab].pages.filter((pg) => !pg.when);
    return this.TABS[tab].pages.filter((pg) => !pg.when || pg.when(p, s)).slice(0, 6);
  }

  private render(): void {
    const p = this.p;
    const s = this.s;
    if (!p || !s) return;
    const estate = estateOf(p, s);
    const tabs: TabId[] = ['person', 'house', 'work', 'record'];
    if (estate === 'noble') tabs.push('domain');
    if (!tabs.includes(this.tab)) this.tab = 'person';
    const pages = this.visiblePages(this.tab);
    if (!pages.some((pg) => pg.id === this.page[this.tab])) this.page[this.tab] = pages[0]?.id ?? '';
    const pageSig = this.pageSig(p, s);
    const sig = `${this.S}|${estate}|${this.tab}|${pages.map((x) => x.id).join()}|${this.page[this.tab]}|${p.id}|${pageSig}`;
    if (sig === this.sig) return;
    const chrome = sig.split('|').slice(0, 5).join('|') !== this.sig.split('|').slice(0, 5).join('|');
    this.sig = sig;
    const S = this.S;
    this.book.dataset.estate = estate;
    this.cover.src = bookUrl(estate);
    if (chrome) {
      // 위쪽 탭: 왼쪽 쪽 내용 선에서 시작, 책 뒤로 3px
      this.tabsEl.textContent = '';
      this.tabsEl.style.left = `${LEFT.x * S}px`;
      this.tabsEl.style.bottom = `${(133 - 3) * S}px`;
      for (const tb of tabs) {
        const on = tb === this.tab;
        const b = el('button', `nb-tab ${on ? 'on' : ''}`, this.tabsEl);
        b.type = 'button';
        b.dataset.tab = tb;
        const img = el('img', 'px', b);
        img.src = tabUrl(estate, on);
        img.width = 20 * S;
        img.height = (on ? 21 : 18) * S;
        b.appendChild(iconEl(this.TABS[tb].icon, 2, 'nb-tab-ic'));
        el('span', 'nb-tab-lb', b, t(`nb.tab.${tb}`));
        b.setAttribute('aria-label', t(`nb.tab.${tb}`));
        b.title = t(`nb.tab.${tb}`);
        b.addEventListener('click', () => {
          this.tab = tb;
          this.sig = '';
          this.render();
        });
      }
      // 책갈피: 첫 칸 위 = 내용 위, 간격 2px
      this.marksEl.textContent = '';
      this.marksEl.style.left = `${225 * S}px`;
      this.marksEl.style.top = `${TOP * S}px`;
      pages.forEach((pg, i) => {
        const on = pg.id === this.page[this.tab];
        const b = el('button', `nb-mark ${on ? 'on' : ''}`, this.marksEl);
        b.type = 'button';
        b.dataset.page = pg.id;
        const img = el('img', 'px', b);
        img.src = pieceUrl(`book.mark${i % 7}${on ? '_on' : ''}`);
        img.width = (on ? 28 : 22) * S;
        img.height = 18 * S;
        b.style.width = `${(on ? 28 : 22) * S}px`;
        b.style.height = `${18 * S}px`;
        b.style.marginBottom = `${2 * S}px`;
        const ic = iconEl(pg.icon, 2, 'nb-mark-ic');
        ic.style.left = `${(on ? 9 : 6.5) * S}px`;
        ic.style.top = `${4 * S}px`;
        b.appendChild(ic);
        const lb = el('span', 'nb-mark-lb', b, t(`nb.short.${pg.id}`));
        lb.style.left = `${(on ? 9 : 6.5) * S + 24}px`;
        lb.style.top = `${13 * S}px`;
        const key = `${this.tab}.${pg.id}`;
        if (!this.seenPages.has(key)) b.classList.add('new');
        b.title = t(`nb.page.${pg.id}`);
        b.addEventListener('click', () => {
          this.page[this.tab] = pg.id;
          this.sig = '';
          this.render();
        });
      });
      this.book.classList.remove('turn');
      void this.book.offsetWidth;
      this.book.classList.add('turn');
    }
    this.seenPages.add(`${this.tab}.${this.page[this.tab]}`);
    if (this.ledger?.root.classList.contains('in-book') && this.page[this.tab] !== 'ledger') this.ledger.hide();
    this.left.textContent = '';
    this.right.textContent = '';
    this.left.className = 'nb-page nb-left';
    this.right.className = 'nb-page nb-right';
    this.book.dataset.page = this.page[this.tab];
    this.renderPage(this.page[this.tab], p, s);
    this.stitchRows();
  }

  /**
   * 줄 카드(.nb-row)의 바느질 테두리: 목업 .st 처럼 카드 크기 그대로 원본 해상도에서 찍어 S배로 (늘려서 무늬가 깨지지 않게).
   * 크기는 배치가 끝난 뒤에야 알 수 있어 다음 프레임에 붙임
   */
  private stitchRows(): void {
    requestAnimationFrame(() => {
      const S = this.S;
      this.book.querySelectorAll<HTMLElement>('.nb-row').forEach((r) => {
        const w = r.offsetWidth;
        const h = r.offsetHeight;
        if (!w || !h) return;
        const uw = Math.max(8, Math.round(w / S));
        const uh = Math.max(8, Math.ceil(h / S - 0.01));
        if (uh * S !== h) r.style.minHeight = `${uh * S}px`;
        const key = `${uw}x${uh}${r.classList.contains('on') ? '+' : ''}`;
        if (r.dataset.st === key) return;
        r.dataset.st = key;
        r.style.backgroundImage = `url(${stitchCard(uw, uh, r.classList.contains('on'))})`;
      });
    });
  }

  /** 쪽 내용이 바뀌었는지 (시간 흐를 때 다시 그리는 빈도 줄이기) */
  private pageSig(p: PersonSnap, s: Snapshot): string {
    const pg = this.page[this.tab];
    const inner = p.inner;
    if (pg === 'emo') return JSON.stringify([Object.values(p.needs).map((v) => Math.round(v / 5)), inner?.moodlets.map((m) => [m.id, m.strength]), inner?.emotion, inner?.stage]);
    if (pg === 'skills' || pg === 'career') return JSON.stringify([p.skills, p.career, s.econ?.shop]);
    if (pg === 'persona' || pg === 'memories') return JSON.stringify([inner?.traits, inner?.virtue, inner?.sin, Math.round(inner?.stress ?? 0), inner?.memories]);
    if (pg === 'wishes') return JSON.stringify([inner?.wishes, inner?.happiness, inner?.aspiration]);
    if (pg === 'family' || pg === 'tree') return s.persons.filter((q) => q.household === p.household).map((q) => `${q.id}${q.name}${q.inner?.emotion}${q.hidden}`).join();
    if (pg === 'relations') return JSON.stringify(s.relations.filter((r) => r.a === p.id || r.b === p.id).map((r) => [r.a, r.b, Math.round(r.friendship), Math.round(r.romance), r.name])) + s.pendingVisits.join();
    if (pg === 'ledger') return JSON.stringify([s.econ?.money, s.econ?.book.length, s.stock]);
    if (pg === 'chronicle') return String(s.town?.news.length ?? 0);
    if (pg === 'dialog') return String(this.hooks.dialogLog().length);
    if (pg === 'farm') return s.objects.filter((o) => /plot|field|garden/.test(o.defId)).map((o) => `${o.uid}${JSON.stringify(o.state)}`).join();
    return '';
  }

  // ------------------------------------------------------------------ 부품 (원본 격자 단위 → S배)

  private ribbon(parent: HTMLElement, text: string): HTMLElement {
    const S = this.S;
    const r = el('div', 'nb-ribbon', parent);
    r.style.width = `${64 * S}px`;
    r.style.height = `${20 * S}px`;
    r.appendChild(pieceImg('ribbon.flat', S));
    el('b', 'nb-ribbon-t', r, text);
    return r;
  }

  private cells(parent: HTMLElement, items: Array<{ icon?: string; canvas?: HTMLCanvasElement | null; label: string; on?: boolean; dim?: boolean; glow?: string; cls?: string; data?: Record<string, string>; onClick?: () => void; title?: string }>, cols = 4, total = 8, size = 20, gap = 1): HTMLElement {
    const S = this.S;
    // 목업 slots: 기본 20px 칸 · 1px 간격 (원본), 특성은 24px · 2px
    const grid = el('div', 'nb-cells', parent);
    grid.style.gridTemplateColumns = `repeat(${cols}, ${size * S}px)`;
    grid.style.gap = `${gap * S}px`;
    const n = Math.max(total, items.length);
    for (let i = 0; i < n; i++) {
      const it = items[i];
      const c = el(it?.onClick ? 'button' : 'div', `nb-cell ${it?.on ? 'on' : ''} ${!it ? 'empty' : ''} ${it?.dim ? 'dim' : ''} ${it?.cls ?? ''}`, grid) as HTMLElement;
      if (c instanceof HTMLButtonElement) c.type = 'button';
      c.style.width = `${size * S}px`;
      c.style.height = `${size * S}px`;
      c.style.backgroundImage = `url(${stitchCard(size, size, !!it?.on)})`;
      if (!it) continue;
      for (const [k, v] of Object.entries(it.data ?? {})) c.dataset[k] = v;
      if (it.title) c.title = it.title;
      if (it.glow) {
        const g = el('i', 'nb-glow', c);
        g.style.setProperty('--glow', it.glow);
      }
      if (it.canvas) {
        it.canvas.className = 'nb-cell-img';
        c.appendChild(it.canvas);
      } else if (it.icon) c.appendChild(iconEl(it.icon, 2));
      el('span', 'nb-cell-t', c, it.label);
      if (it.onClick) c.addEventListener('click', it.onClick);
    }
    return grid;
  }

  private rows(parent: HTMLElement, items: Array<{ icon?: string; canvas?: HTMLCanvasElement | null; title: string; sub?: string; right?: string; dim?: boolean; cls?: string; tip?: string; data?: Record<string, string> }>): HTMLElement {
    const S = this.S;
    const list = el('div', 'nb-rows', parent);
    for (const it of items) {
      const r = el('div', `nb-row ${it.dim ? 'dim' : ''} ${it.cls ?? ''}`, list);
      for (const [k, v] of Object.entries(it.data ?? {})) r.dataset[k] = v;
      r.style.minHeight = `${18 * S}px`;
      if (it.tip) r.title = it.tip;
      if (it.canvas) {
        it.canvas.className = 'nb-row-img';
        r.appendChild(it.canvas);
      } else if (it.icon) r.appendChild(iconEl(it.icon, 2));
      const b = el('div', 'nb-row-b', r);
      el('b', '', b, it.title);
      if (it.sub) el('small', '', b, it.sub);
      if (it.right) el('span', 'nb-row-r', r, it.right);
    }
    return list;
  }

  private paper(parent: HTMLElement): HTMLElement {
    return el('div', 'nb-paper', parent);
  }

  private empty(parent: HTMLElement, icon: string): void {
    const e = el('div', 'nb-empty', parent);
    e.appendChild(iconEl(icon, 4));
  }

  private bar(parent: HTMLElement, v: number, color: 'green' | 'blue' | 'red' = 'green'): HTMLElement {
    const b = el('div', 'cbar nb-bar', parent);
    const f = el('div', 'cbar-fill', b);
    f.style.width = `${Math.max(0, Math.min(100, v))}%`;
    f.dataset.c = color;
    return b;
  }

  private head(parent: HTMLElement, p: PersonSnap, sub: string): void {
    const h = el('div', 'nb-head', parent);
    const pic = el('div', 'nb-head-pic', h);
    const emo = p.inner && p.inner.stage >= 1 ? p.inner.emotion : 'neutral';
    pic.style.setProperty('--glow', this.hooks.emotionColor(emo));
    const cv = this.hooks.portrait(p.id, 'head');
    if (cv) pic.appendChild(cv);
    const b = el('div', '', h);
    el('b', 'nb-head-name', b, p.name);
    el('div', 'nb-sub', b, sub);
  }

  // ------------------------------------------------------------------ 쪽

  private renderPage(id: string, p: PersonSnap, s: Snapshot): void {
    const L = this.left;
    const R = this.right;
    const inner = p.inner;
    const estate = estateOf(p, s);
    const emoKey = (q: PersonSnap) => {
      const e = q.inner && q.inner.stage >= 1 ? q.inner.emotion : 'neutral';
      return e === 'neutral' ? 'emotion.neutral' : `emotion.${e}.${['basic', 'strong', 'extreme'][(q.inner?.stage ?? 1) - 1]}`;
    };
    const family = s.persons.filter((q) => q.household === p.household && !q.visitor);
    switch (id) {
      case 'emo': {
        const ms = [...(inner?.moodlets ?? [])].sort((a, b) => b.strength - a.strength);
        const neg = (e: string) => ['sad', 'angry', 'tense', 'ashamed'].includes(e);
        const sum = ms.reduce((a, m) => a + (neg(m.emotion) ? -m.strength : m.strength), 0);
        this.head(L, p, `${t(emoKey(p))} · ${t('nb.moodSum', { n: `${sum >= 0 ? '+' : '−'}${Math.abs(sum)}` })}`);
        const needs = el('div', 'nb-needs', L);
        for (const n of ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social', 'warmth', 'comfort']) {
          const r = el('div', 'nb-need', needs);
          r.dataset.need = n;
          r.appendChild(iconEl(`need.${n}`, 2));
          el('span', '', r, t(`need.${n}`));
          const v = p.needs[n] ?? 0;
          this.bar(r, v, v < 30 ? 'red' : 'green');
        }
        this.ribbon(R, t('nb.page.moodlets'));
        // 무드렛: 목록 줄 카드 (아이콘 · 이름 · 남은 시간 · 값), 목업과 같은 모양
        const box = el('div', 'nb-scroll inner-view', R);
        const defs = this.inner?.defs;
        if (!ms.length) this.empty(box, 'emo.neutral');
        const list = this.rows(box, ms.map((m) => {
          const keys = defs?.moodletKeys(m.id);
          const left = m.remainingMin < 0 ? '' : m.remainingMin >= 60 ? t('panel.remaining.h', { n: Math.round(m.remainingMin / 60) }) : t('panel.remaining.m', { n: Math.max(1, Math.round(m.remainingMin)) });
          return { icon: defs?.moodletIcon(m.id) ?? `emo.${m.emotion}`, title: keys ? t(keys.name) : m.id, sub: left, right: `${neg(m.emotion) ? '−' : '+'}${m.strength}`, cls: `moodlet ${neg(m.emotion) ? 'neg' : 'pos'}`, data: { moodlet: m.id } };
        }));
        list.querySelectorAll<HTMLElement>('.nb-row').forEach((r, i) => {
          const keys = defs?.moodletKeys(ms[i].id);
          if (keys) r.title = t(keys.desc);
        });
        break;
      }
      case 'skills': {
        const sk = p.skills ?? {};
        const defs = this.work?.skills ?? {};
        const ids = Object.keys(sk).filter((k) => defs[k]).sort((a, b) => sk[b][0] - sk[a][0] || sk[b][1] - sk[a][1]);
        const sel = this.book.dataset.skill && ids.includes(this.book.dataset.skill) ? this.book.dataset.skill : ids[0];
        this.cells(L, ids.slice(0, 8).map((k) => ({
          icon: defs[k].icon, label: `${t(defs[k].nameKey)} ${sk[k][0]}`, on: k === sel, data: { skill: k },
          onClick: () => {
            this.book.dataset.skill = k;
            this.sig = '';
            this.render();
          },
        })), 4, 8);
        if (sel) {
          const pp = this.paper(L);
          const tl = el('div', 'nb-line', pp);
          tl.appendChild(iconEl(defs[sel].icon, 2));
          el('b', 'nb-grow', tl, t(defs[sel].nameKey));
          el('b', '', tl, `${sk[sel][0]} / 10`);
          this.bar(pp, sk[sel][1] * 100, 'green');
          if (t(`${defs[sel].nameKey}.desc`) !== `${defs[sel].nameKey}.desc`) el('p', '', pp, t(`${defs[sel].nameKey}.desc`));
        } else this.empty(L, 'cute.star');
        this.ribbon(R, t('nb.page.skills'));
        const BUNDLE_ICON: Record<string, string> = { household: 'cute.coins', craft: 'cute.wrench', learning: 'cute.book_blue', art: 'cute.star', body: 'cute.bolt', faith: 'rv.church' };
        const cats = new Map<string, string[]>();
        for (const k of ids) cats.set(defs[k].category, [...(cats.get(defs[k].category) ?? []), k]);
        this.rows(R, [...cats].map(([c, ks]) => ({
          icon: BUNDLE_ICON[c] ?? 'cute.star', title: t(`skill.bundle.${c}`),
          sub: ks.slice(0, 4).map((k) => t(defs[k].nameKey)).join(' · ') + (ks.length > 4 ? ' …' : ''),
          right: (ks.reduce((a, k) => a + sk[k][0], 0) / ks.length).toFixed(1),
        })));
        break;
      }
      case 'persona': {
        const traits = inner?.traits ?? [];
        const selT = traits.includes(this.book.dataset.trait ?? '') ? this.book.dataset.trait! : traits[0];
        this.ribbon(L, t('nb.page.traits'));
        const tv = el('div', 'inner-view', L);
        this.cells(tv, traits.map((tr) => ({
          icon: this.inner?.defs.traitIcon(tr) ?? 'emo.neutral', label: t(`trait.${tr}`), title: t(`trait.${tr}.desc`), on: tr === selT, cls: 'chip', data: { trait: tr },
          onClick: () => {
            this.book.dataset.trait = tr;
            this.sig = '';
            this.render();
          },
        })), 3, 3, 24, 2);
        const pp = this.paper(L);
        if (selT) {
          el('b', 'nb-title', pp, t(`trait.${selT}`));
          el('p', '', pp, t(`trait.${selT}.desc`));
        }
        const stress = Math.round(inner?.stress ?? 0);
        const sl = el('div', 'nb-line nb-push', pp);
        sl.appendChild(iconEl('cute.bolt', 2));
        el('b', 'nb-grow', sl, t('panel.stress'));
        el('b', '', sl, String(stress));
        this.bar(pp, stress, stress >= 70 ? 'red' : 'blue');
        this.ribbon(R, t('nb.page.virtues'));
        const rv = el('div', 'inner-view', R);
        const none = t('panel.none');
        const likes = (inner?.likes ?? []).map((k) => t(`like.${k}`)).join(' · ') || none;
        const dislikes = (inner?.dislikes ?? []).map((k) => t(`like.${k}`)).join(' · ') || none;
        this.rows(rv, [
          { icon: 'cute.star_blue', title: `${t('panel.virtue')} · ${inner?.virtue ? t(`virtue.${inner.virtue}`) : none}`, sub: inner?.virtue ? t(`virtue.${inner.virtue}.desc`) : undefined, tip: inner?.virtue ? t(`virtue.${inner.virtue}.desc`) : undefined, dim: !inner?.virtue },
          { icon: 'cute.bolt', title: `${t('panel.sin')} · ${inner?.sin ? t(`sin.${inner.sin}`) : none}`, sub: inner?.sin ? t(`sin.${inner.sin}.desc`) : undefined, tip: inner?.sin ? t(`sin.${inner.sin}.desc`) : undefined, dim: !inner?.sin },
          { icon: 'cute.heart', title: t('panel.likes'), sub: likes, tip: likes },
          { icon: 'cute.no', title: t('panel.dislikes'), sub: dislikes, tip: dislikes },
        ]);
        break;
      }
      case 'wishes': {
        // 왼쪽: 생애 소원 종이 (단계 막대 + 단계 목록), 오른쪽: 지금 소원 줄 (고정 깃발) · 걱정 · 행복 점수, 보상 성격은 버튼으로 바꿔 보기
        const asp = inner?.aspiration;
        const a = asp ? this.inner?.defs.aspiration(asp.id) : null;
        this.ribbon(L, t('nb.page.aspiration'));
        const lv = el('div', 'inner-view nb-fill', L);
        if (asp && a) {
          const pp = this.paper(lv);
          const n = a.stages.length;
          const hd = el('div', 'nb-line', pp);
          hd.appendChild(iconEl('cute.trophy', 2));
          const nm = el('div', 'nb-grow', hd);
          el('b', 'nb-title', nm, t(a.nameKey));
          el('div', 'nb-sub', nm, `${t('panel.stage', { n: Math.min(n, asp.stage) })} / ${t('panel.stage', { n })}`);
          this.bar(pp, (asp.stage / Math.max(1, n)) * 100, 'blue');
          const steps = el('div', 'nb-steps', pp);
          a.stages.forEach((st, i) => {
            const d = el('div', `nb-step ${i < asp.stage ? 'done' : i === asp.stage ? 'now' : ''}`, steps);
            el('span', 'nb-check', d, i < asp.stage ? '✓' : '□');
            d.append(st.textKey ? t(st.textKey) : t('panel.stage', { n: i + 1 }));
          });
        } else this.empty(lv, 'cute.trophy');
        const showRewards = this.book.dataset.rewards === '1';
        this.ribbon(R, showRewards ? t('panel.rewards') : t('nb.page.wishnow'));
        const rv = el('div', 'nb-scroll inner-view', R);
        const hp = Math.round(inner?.happiness ?? 0);
        if (!showRewards) {
          const ws = inner?.wishes ?? [];
          const wl = ws.filter((w) => w.kind === 'wish');
          const fl = ws.filter((w) => w.kind === 'fear');
          if (!ws.length) this.empty(rv, 'cute.trophy');
          const list = this.rows(rv, [...wl, ...fl].map((w) => {
            const d = this.inner?.defs.wishDef(w.id);
            const pts = (d as { points?: number } | null)?.points;
            return { icon: d?.icon ?? (w.kind === 'wish' ? 'emo.excited' : 'emo.tense'), title: d ? t(d.textKey) : w.id, sub: w.kind === 'fear' ? t('panel.fears.title') : pts ? t('panel.happiness', { n: pts }) : undefined, cls: w.kind === 'fear' ? 'fear' : 'wish', data: { wish: w.id } };
          }));
          list.querySelectorAll<HTMLElement>('.nb-row.wish').forEach((r) => {
            const w = wl.find((x) => x.id === r.dataset.wish);
            if (!w) return;
            const lock = el('button', `lock ${w.locked ? 'on' : ''}`, r);
            lock.type = 'button';
            lock.appendChild(pieceImg('book.mark0', 1));
            lock.title = w.locked ? t('panel.unlock') : t('panel.lock');
            lock.addEventListener('click', () => this.inner?.lockWish(p.id, w.id, !w.locked));
          });
        } else {
          const rw = (this.inner?.defs.rewards() ?? []).filter((x) => x.kind !== 'aspiration').slice(0, 20);
          const list = this.rows(rv, rw.map((r) => ({ icon: r.icon, title: t(r.nameKey), sub: t(r.descKey), tip: t(r.descKey), right: String(r.cost), dim: hp < r.cost, data: { reward: r.id } })));
          list.querySelectorAll<HTMLElement>('.nb-row').forEach((r) => {
            const id = r.dataset.reward ?? '';
            const cost = rw.find((x) => x.id === id)?.cost ?? 0;
            const b = this.button(r, t('panel.buy'), () => this.inner?.buyReward(p.id, id), true);
            b.disabled = hp < cost;
          });
        }
        const ft = el('div', 'nb-foot', R);
        const hpEl = el('span', 'nb-hp', ft);
        hpEl.appendChild(iconEl('cute.star', 2));
        el('b', '', hpEl, hp.toLocaleString('ko-KR'));
        this.button(ft, showRewards ? t('nb.page.wishnow') : t('panel.rewards'), () => {
          this.book.dataset.rewards = showRewards ? '' : '1';
          this.sig = '';
          this.render();
        });
        break;
      }
      case 'memories': {
        this.ribbon(L, t('nb.page.memories'));
        const pp = this.paper(L);
        const l = el('div', 'nb-line', pp);
        l.appendChild(iconEl('cute.letter_q', 2));
        el('b', 'nb-grow', l, t('panel.memories', { n: inner?.memories ?? 0 }));
        this.empty(R, 'cute.letter_q');
        break;
      }
      case 'family': {
        const sel = Number(this.book.dataset.member ?? p.id);
        const cur = family.find((q) => q.id === sel) ?? p;
        this.cells(L, family.slice(0, 8).map((q) => ({
          canvas: this.hooks.portrait(q.id, 'head'), label: q.name, on: q.id === cur.id, dim: q.hidden,
          glow: this.hooks.emotionColor(q.inner && q.inner.stage >= 1 ? q.inner.emotion : 'neutral'), data: { member: String(q.id) },
          onClick: () => {
            this.book.dataset.member = String(q.id);
            this.sig = '';
            this.render();
          },
        })), 4, 4);
        const pp = this.paper(L);
        el('b', 'nb-title', pp, t('nb.family.house', { estate: t(`estate.${estate}`) }));
        el('p', '', pp, t('nb.family.count', { n: family.length }));
        this.head(R, cur, `${t(`stage.${cur.inner?.stage_life ?? 'adult'}`)} · ${t(emoKey(cur))}`);
        const rel = s.relations.filter((r) => (r.a === cur.id || r.b === cur.id) && family.some((q) => q.id === (r.a === cur.id ? r.b : r.a)));
        this.rows(R, rel.map((r) => {
          const oid = r.a === cur.id ? r.b : r.a;
          const q = family.find((x) => x.id === oid)!;
          return { canvas: this.hooks.portrait(oid, 'head'), title: `${q.name}`, sub: t(`rel.${r.name}`), right: `${Math.round(r.friendship)}` };
        }));
        const btns = el('div', 'nb-btns', R);
        this.button(btns, t('nb.btn.control'), () => this.hooks.selectPerson(cur.id));
        this.button(btns, t('nb.btn.follow'), () => {
          this.close();
          this.hooks.focusPerson(cur.id);
        });
        break;
      }
      case 'tree': {
        const nodes = s.house?.tree ?? [];
        if (nodes.length) {
          const box = el('div', 'nb-tree', L);
          const gens = [...new Set(nodes.map((n) => n.generation))].sort((a, b) => a - b);
          const side = [box, el('div', 'nb-tree', R)];
          gens.forEach((g, i) => {
            const row = el('div', 'nb-tree-row', side[i < 3 ? 0 : 1]);
            const list = nodes.filter((n) => n.generation === g);
            this.cells(row, list.slice(0, 4).map((n) => ({
              canvas: n.alive ? this.hooks.portrait(n.id, 'head') : null, icon: n.alive ? undefined : 'cute.shield',
              label: n.name, dim: !n.alive, title: n.alive ? n.name : `${n.name} · ${t(`death.cause.${n.cause ?? 'old_age'}`)}`,
            })), Math.min(4, list.length), list.length);
          });
          if (gens.length <= 3) {
            this.ribbon(R, family[0]?.name ?? '');
            this.empty(R, 'cute.shield');
          }
          break;
        }
        const kids = family.filter((q) => ['baby', 'toddler', 'child', 'teen'].includes(q.inner?.stage_life ?? ''));
        const elders = family.filter((q) => q.inner?.stage_life === 'elder');
        const adults = family.filter((q) => !kids.includes(q) && !elders.includes(q));
        const tree = el('div', 'nb-tree', L);
        for (const gen of [elders, adults, kids]) {
          if (!gen.length) continue;
          const row = el('div', 'nb-tree-row', tree);
          this.cells(row, gen.slice(0, 4).map((q) => ({ canvas: this.hooks.portrait(q.id, 'head'), label: q.name })), Math.min(4, gen.length), gen.length);
        }
        const nav = el('div', 'nb-nav', L);
        nav.append(iconEl('cute.up_green', 2), iconEl('cute.down_green', 2));
        this.ribbon(R, family[0]?.name ?? '');
        this.empty(R, 'cute.shield');
        break;
      }
      case 'relations': {
        // 왼쪽: 사람 칸 + 거르개, 오른쪽: 고른 사람 (머리 · 우정/로맨스 막대 · 존중) + 마을 이웃 초대
        const here = new Map(s.persons.map((q) => [q.id, q]));
        const away = new Map(s.away.map((a) => [a.id, a]));
        const other = (r: RelationSnap) => (r.a === p.id ? r.b : r.a);
        const isFam = (r: RelationSnap) => here.get(other(r))?.household === p.household;
        const nameOf = (id: number) => here.get(id)?.name ?? away.get(id)?.name ?? s.town?.people.find((x) => x.id === id)?.name ?? '?';
        const filter = this.book.dataset.relf || 'all';
        let mine = s.relations.filter((r) => r.a === p.id || r.b === p.id);
        if (filter === 'family') mine = mine.filter(isFam);
        else if (filter === 'friend') mine = mine.filter((r) => !isFam(r) && r.friendship >= 30);
        else if (filter === 'neighbor') mine = mine.filter((r) => !isFam(r) && r.friendship > -30 && r.friendship < 30);
        else if (filter === 'enemy') mine = mine.filter((r) => r.friendship <= -30);
        mine.sort((a, b) => Number(isFam(b)) - Number(isFam(a)) || b.friendship + b.romance - (a.friendship + a.romance));
        const selId = mine.some((r) => String(other(r)) === this.book.dataset.rel) ? Number(this.book.dataset.rel) : mine[0] ? other(mine[0]) : -1;
        const box = el('div', 'nb-scroll nb-cellbox', L);
        box.style.maxHeight = `${41 * this.S}px`;
        const glow = (r: RelationSnap) => (r.romance > 30 ? '#f080a8' : r.friendship < -30 ? '#f05a46' : RelationsPanelClass.color(r.name));
        this.cells(box, mine.map((r) => {
          const id = other(r);
          return {
            canvas: this.hooks.portrait(id, 'head'), label: nameOf(id), on: id === selId, cls: 'rel-row', glow: glow(r), data: { other: String(id) },
            onClick: () => {
              this.book.dataset.rel = String(id);
              this.sig = '';
              this.render();
            },
          };
        }), 4, 8);
        box.querySelectorAll<HTMLElement>('.rel-row').forEach((c) => c.addEventListener('dblclick', () => this.hooks.focusPerson(Number(c.dataset.other))));
        const chips = el('div', 'nb-chips', L);
        for (const k of ['all', 'family', 'friend', 'neighbor', 'enemy']) {
          const c = el('button', `nb-chip ${k === filter ? 'on' : ''}`, chips, t(`hud2.rel.${k}`));
          c.type = 'button';
          c.addEventListener('click', () => {
            this.book.dataset.relf = k;
            this.sig = '';
            this.render();
          });
        }
        const r = mine.find((x) => other(x) === selId);
        if (r) {
          const q = here.get(selId);
          const h = el('div', 'nb-head', R);
          const pic = el('div', 'nb-head-pic', h);
          pic.style.setProperty('--glow', glow(r));
          const cv = this.hooks.portrait(selId, 'head');
          if (cv) pic.appendChild(cv);
          const hb = el('div', '', h);
          el('b', 'nb-head-name', hb, nameOf(selId));
          el('div', 'nb-sub', hb, [t(`rel.${r.name}`), q?.inner?.estate ? t(`estate.${q.inner.estate}`) : ''].filter(Boolean).join(' · '));
          const kv = el('div', 'nb-kv', R);
          const line = (icon: string, v: number, color: 'green' | 'blue' | 'red', tip: string) => {
            const l = el('div', 'nb-line', kv);
            l.title = tip;
            l.appendChild(iconEl(icon, 2));
            const bw = el('div', 'nb-grow', l);
            this.bar(bw, Math.abs(v), color);
            el('b', 'nb-num', l, fmtSigned(v));
          };
          line('cute.talk', r.friendship, r.friendship < 0 ? 'red' : 'green', t('rel.axis.friendship'));
          if (r.romance > 0.5 || ['lover', 'engaged', 'spouse'].includes(r.name)) line('cute.heart', r.romance, 'blue', t('rel.axis.romance'));
          const mineR = r.a === p.id ? r.respectAB : r.respectBA;
          const theirs = r.a === p.id ? r.respectBA : r.respectAB;
          this.rows(R, [{
            icon: 'ui.crest', title: `${t('rel.axis.respect')} ${fmtSigned(mineR)}`,
            sub: [`${t('rel.axis.respect_them')} ${fmtSigned(theirs)}`, r.memories > 0 ? t('ui.relations.memories', { n: r.memories }) : ''].filter(Boolean).join(' · '),
            dim: theirs < 0,
          }]);
        } else this.empty(R, 'cute.talk');
        // 마을 이웃 초대: 관계 패널의 이웃 목록을 그대로 옮겨 씀 (초대 · 돌려보내기 동작 유지)
        this.relations?.invalidate();
        const tmp = document.createElement('div');
        this.relations?.render(tmp, p, s);
        const nb = tmp.querySelector('.rel-neighbors');
        if (nb) {
          el('div', 'nb-subhead', R, t('ui.relations.neighbors'));
          el('div', 'nb-scroll nb-neighbors', R).appendChild(nb);
        }
        break;
      }
      case 'fame': {
        // 왼쪽: 문장 · 가문 이름 · 가훈 · 줄, 오른쪽: 명성 리본 + 막대 + 가보 줄 (목업)
        const H = s.house;
        const cl = H?.clan;
        const top = el('div', 'nb-center', L);
        let arms = false;
        if (cl?.heraldry) {
          try {
            const cv = heraldryCanvas(cl.heraldry as never, 3);
            cv.className = 'nb-arms';
            top.appendChild(cv);
            arms = true;
          } catch {
            /* 문장 사양이 옛 형식이면 건너뜀 */
          }
        }
        if (!arms) top.appendChild(iconEl('cute.shield', 6));
        el('b', 'nb-clan', top, cl?.name ? t(cl.name) : t('nb.page.fame'));
        if (cl?.motto) el('div', 'nb-sub nb-motto', top, `"${cl.motto.startsWith('clan.motto.') ? t(cl.motto) : cl.motto}"`);
        this.rows(L, [
          { icon: 'cute.crown', title: t(`estate.${estate}`), sub: cl ? t(`inherit.${cl.law === 'will' ? 'designated' : cl.law}`) : undefined },
          ...(s.econ?.shop ? [{ icon: 'cute.coins', title: t('nb.fame.shop'), right: String(Math.round(s.econ.shop.reputation)) }] : []),
        ]);
        this.ribbon(R, t('nb.fame.ribbon', { n: Math.round(cl?.fame ?? 0) }));
        const fb = el('div', 'nb-kv', R);
        this.bar(fb, Math.min(100, (cl?.fame ?? 0) / 10), 'blue');
        const tl = el('div', 'nb-line', fb);
        el('b', 'nb-grow', tl, t(`fame.tier.${cl?.tier ?? 'ordinary'}`));
        el('div', 'nb-subhead', R, t('nb.page.heirlooms'));
        const hl = H?.heirlooms ?? [];
        if (!hl.length && !(H?.lostHeirlooms.length)) this.empty(R, 'cute.trophy');
        else this.rows(el('div', 'nb-scroll', R), [
          ...hl.map((h) => ({ icon: 'cute.trophy', title: h.name ?? t(`object.${h.defId}`), sub: h.damaged ? t(`heirloom.state.${h.damaged}`) : undefined })),
          ...(H?.lostHeirlooms ?? []).map(() => ({ icon: 'cute.no', title: t('heirloom.lost.stolen'), dim: true })),
        ]);
        break;
      }
      case 'match': {
        // 혼처 찾기 (14-4 중매혼): 왼쪽 = 혼인할 나이의 독신 식구, 오른쪽 = 후보 (받기 / 거절)
        const singles = family.filter((q) => ['teen', 'young', 'adult'].includes(q.inner?.stage_life ?? '') && !s.relations.some((r) => (r.a === q.id || r.b === q.id) && (r.flags ?? []).includes('spouse')));
        const cur = singles.find((q) => String(q.id) === this.book.dataset.seeker) ?? singles[0];
        this.cells(L, singles.slice(0, 8).map((q) => ({
          canvas: this.hooks.portrait(q.id, 'head'), label: q.name, on: q.id === cur?.id, data: { seeker: String(q.id) },
          onClick: () => {
            this.book.dataset.seeker = String(q.id);
            this.sig = '';
            this.render();
          },
        })), 4, 4);
        const btns = el('div', 'nb-btns', L);
        if (cur) this.button(btns, t('nb.btn.find_match'), () => void this.hooks.intent?.({ kind: 'society', op: 'findMatch', args: { household: 1, personId: cur.id } }));
        this.ribbon(R, cur?.name ?? t('nb.page.match'));
        const cand = (s.house?.matches ?? []).filter((m) => !cur || m.seeker === cur.id);
        if (!cand.length) {
          this.empty(R, 'cute.heart');
          break;
        }
        this.rows(R, cand.slice(0, 5).map((m) => ({
          canvas: this.hooks.portrait(m.personId, 'head'),
          title: `${m.name} · ${m.age}`,
          sub: `${t(`estate.${m.estate}`)} · ${t(`fame.tier.${m.fame >= 800 ? 'legendary' : m.fame >= 600 ? 'renowned' : m.fame >= 400 ? 'respected' : m.fame >= 200 ? 'ordinary' : 'suspect'}`)}`,
          right: `${m.wePay ? '−' : '+'}${money(m.dowry)}`,
          cls: m.incoming ? 'incoming' : '',
          data: { match: String(m.matchId) },
        })));
        R.querySelectorAll<HTMLElement>('.nb-row').forEach((r) => {
          const id = Number(r.dataset.match);
          const row = el('div', 'nb-row-act', r);
          this.button(row, t('nb.btn.accept'), () => void this.hooks.intent?.({ kind: 'society', op: 'acceptProposal', args: { matchId: id } }), true);
          this.button(row, t('nb.btn.refuse'), () => void this.hooks.intent?.({ kind: 'society', op: 'refuseMatch', args: { matchId: id } }), true);
        });
        break;
      }
      case 'freedom': {
        const em = s.house?.emancipation;
        const rise = s.house?.rise ?? [];
        const riseRows = (parent: HTMLElement) => {
          if (!rise.length) {
            this.empty(parent, 'cute.star_blue');
            return;
          }
          const list = this.rows(el('div', 'nb-scroll', parent), rise.map((r) => ({
            icon: r.ok ? 'cute.star_blue' : 'cute.no', title: t(`nb.rise.${r.op}`),
            sub: [r.cost ? money(r.cost) : '', r.reason ? t(r.reason) : ''].filter(Boolean).join(' · ') || undefined,
            dim: !r.ok, cls: 'act', data: { op: r.op },
          })));
          list.querySelectorAll<HTMLElement>('.nb-row').forEach((row, i) => {
            const r = rise[i];
            row.title = `${t(`nb.rise.${r.op}`)}${r.cost ? ` · ${money(r.cost)}` : ''}${r.reason ? ` · ${t(r.reason)}` : ''}`;
            const b = this.button(row, t(`nb.rise.${r.op}`), () => void this.hooks.intent?.({ kind: 'house', op: r.op, args: { personId: r.personId, craft: 'blacksmith', quality: 3 } }), true);
            b.disabled = !r.ok;
          });
        };
        if (em || estate === 'serf') {
          // 농노: 왼쪽 해방금 종이, 오른쪽 신분 오르기 (해방금 내기 포함)
          this.ribbon(L, t('nb.page.freedom'));
          const pp = this.paper(L);
          const l = el('div', 'nb-line', pp);
          l.appendChild(iconEl('cute.coins', 2));
          el('b', 'nb-grow', l, em ? money(Math.max(0, em.money)) : '-');
          el('b', '', l, em ? money(em.fee) : '-');
          this.bar(pp, em ? Math.max(0, Math.min(100, (em.money / Math.max(1, em.fee)) * 100)) : 0, 'green');
          this.ribbon(R, t('nb.page.rise'));
          riseRows(R);
        } else {
          // 농노가 아니면 해방금은 없음: 왼쪽 신분 오르기, 오른쪽 지금 신분 · 명성
          this.ribbon(L, t('nb.page.rise'));
          riseRows(L);
          const cl = s.house?.clan;
          this.ribbon(R, t(`estate.${estate}`));
          const pp = this.paper(R);
          const l = el('div', 'nb-line', pp);
          l.appendChild(iconEl('cute.crown', 2));
          el('b', 'nb-grow', l, t(`fame.tier.${cl?.tier ?? 'ordinary'}`));
          el('b', '', l, String(Math.round(cl?.fame ?? 0)));
          this.bar(pp, Math.min(100, (cl?.fame ?? 0) / 10), 'blue');
        }
        break;
      }
      case 'servants': {
        const sv = s.house?.servants ?? [];
        this.ribbon(L, t('nb.page.servants'));
        if (!sv.length) this.empty(L, 'cute.bag');
        else this.rows(L, sv.map((x) => {
          const q = s.persons.find((pp) => pp.id === x.id);
          return { canvas: this.hooks.portrait(x.id, 'head'), title: q?.name ?? '', sub: t(`servant.role.${x.role}`), right: String(Math.round(x.loyalty)) };
        }));
        this.ribbon(R, t('nb.page.hire'));
        const cells = el('div', 'nb-btns multi', R);
        for (const role of ['maid', 'cook', 'nurse', 'groom', 'steward', 'guard']) {
          const b = this.button(cells, t(`servant.role.${role}`), () => void this.hooks.intent?.({ kind: 'house', op: 'hireServant', args: { role } }));
          b.title = t(`servant.role.${role}`);
        }
        break;
      }
      case 'career': {
        // 일이 있으면: 머리 + 등급 줄 + 성과 막대 | 오늘 일 줄 + 가게 + 태도 버튼. 없으면: 구할 수 있는 일 줄 | 솜씨 칸 (목업)
        const W = this.work;
        const c = p.career;
        const def = c ? W?.careerDef(c.id) : undefined;
        if (W && c && def) {
          const job = el('div', 'work-job nb-fill', L);
          const hd = el('div', 'nb-head work-title', job);
          el('div', 'nb-head-pic', hd).appendChild(iconEl(def.icon, 4));
          const hb = el('div', '', hd);
          el('b', 'nb-head-name', hb, t(def.nameKey));
          el('div', 'nb-sub', hb, `${t(def.ranks[c.rank]?.nameKey ?? '')} · ${c.rank + 1} / ${def.ranks.length}`);
          const wage = (rk: { wage?: number; share?: number }) => (rk.wage !== undefined ? t('ui.work.wage', { m: formatMoney(rk.wage) }) : t('ui.work.share', { n: Math.round((rk.share ?? 1) * 100) }));
          this.rows(el('div', 'nb-scroll', job), def.ranks.map((rk, i) => ({
            icon: i <= c.rank ? 'cute.star_blue' : 'cute.trophy', title: t(rk.nameKey), sub: i > c.rank ? wage(rk) : undefined,
            right: i < c.rank ? '✓' : i === c.rank ? '●' : '', dim: i < c.rank,
          })));
          const frac = Math.max(-1, Math.min(1, c.perf / def.promoteAt));
          const pl = el('div', 'nb-line nb-perf', job);
          pl.title = t('ui.work.perf');
          pl.appendChild(iconEl('cute.star', 2));
          this.bar(el('div', 'nb-grow', pl), Math.abs(frac) * 100, frac < 0 ? 'red' : 'green');
          el('b', 'nb-num', pl, `${Math.round(c.perf)}/${def.promoteAt}`);
          const qb = el('div', 'nb-btns', job);
          const quit = this.button(qb, t('ui.work.quit'), () => W.setCareer(p.id, null));
          quit.classList.add('rel-btn', 'work-quit');
          this.ribbon(R, t('nb.work.today'));
          this.rows(el('div', 'nb-scroll', R), [
            { icon: 'cute.moon', title: t('ui.work.hours', { a: def.hours[0], b: def.hours[1] }), sub: t(`ui.work.type.${def.type}`) },
            ...c.orders.map((o) => ({ icon: W.icon(o.item), title: `${t(`item.${o.item}`)} ×${o.qty}`, sub: t('ui.work.orders'), right: o.done ? '✓' : formatMoney(o.pay), dim: o.done })),
            { icon: 'cute.coins', title: wage(def.ranks[c.rank] ?? {}) },
          ]);
          const shop = s.econ?.shop;
          if (shop && (def.type === 'onsite' || shop.open || s.house?.estate === 'merchant')) {
            el('div', 'nb-subhead', R, `${t('ui.shop.title')} · ${t('ui.shop.stats', { rep: Math.round(shop.reputation), n: shop.sales })}`);
            const sb = el('div', 'nb-btns multi', R);
            const tog = this.button(sb, t(shop.open ? 'ui.shop.close' : 'ui.shop.open'), () => W.setShop(!shop.open, shop.priceMult), true);
            tog.dataset.shop = shop.open ? 'close' : 'open';
            for (const [k, v] of [['cheap', 0.85], ['fair', 1], ['dear', 1.15]] as const) {
              const b = this.button(sb, t(`ui.shop.${k}`), () => W.setShop(shop.open, v), true);
              b.classList.add('rel-btn');
              b.classList.toggle('on', Math.abs(shop.priceMult - v) < 0.01);
            }
          }
          const ab = el('div', 'nb-btns', R);
          for (const a of ['hard', 'normal', 'slack']) {
            const b = this.button(ab, t(`ui.work.att.${a}`), () => W.setAttitude(p.id, a));
            b.classList.add('rel-btn');
            b.dataset.attitude = a;
            b.classList.toggle('on', c.attitude === a);
          }
        } else {
          this.ribbon(L, t('ui.work.job'));
          const box = el('div', 'nb-scroll work-list', L);
          const open = W?.openCareers(estate) ?? [];
          if (!W || p.inner?.stage_life === 'child' || p.inner?.stage_life === 'teen' || !open.length) this.empty(box, 'cute.wrench');
          else {
            this.rows(box, open.map(([id, d]) => ({ icon: d.icon, title: t(d.nameKey), sub: d.ranks[0]?.wage !== undefined ? formatMoney(d.ranks[0].wage) : t(`ui.work.type.${d.type}`), cls: 'work-row', data: { job: id } })));
            box.querySelectorAll<HTMLElement>('.work-row').forEach((r) => {
              const id = r.dataset.job ?? '';
              const b = this.button(r, t('ui.work.join'), () => W.setCareer(p.id, id), true);
              b.classList.add('rel-btn');
              b.dataset.career = id;
            });
          }
          const sk = p.skills ?? {};
          const defs = W?.skills ?? {};
          const ids = Object.keys(sk).filter((k) => defs[k]).sort((a, b) => sk[b][0] - sk[a][0] || sk[b][1] - sk[a][1]);
          this.ribbon(R, t('ui.work.skills'));
          if (!ids.length) this.empty(R, 'cute.star');
          else this.cells(R, ids.slice(0, 8).map((k) => ({ icon: defs[k].icon, label: `${t(defs[k].nameKey)} ${sk[k][0]}`, data: { skill: k } })), 4, 8);
        }
        break;
      }
      case 'ledger': {
        if (this.ledger) {
          this.ledger.dockInto(L);
          this.ledger.show(s);
        }
        this.ribbon(R, t('nb.page.stock'));
        const stock = Object.entries(s.stock).filter(([, v]) => v > 0);
        this.cells(R, stock.slice(0, 12).map(([k, v]) => ({ icon: `item.${k}`, label: `${t(`item.${k}`)} ${v}` })), 4, 8);
        break;
      }
      case 'farm': {
        const plots = s.objects.filter((o) => /plot|field|garden/.test(o.defId));
        this.cells(L, plots.slice(0, 8).map((o) => ({ icon: 'item.flour', label: t(`object.${o.defId}`) })), 4, 8);
        this.ribbon(R, t('nb.page.farm'));
        if (!plots.length) this.empty(R, 'item.flour');
        break;
      }
      case 'chronicle': {
        const news = s.town?.news ?? [];
        const half = Math.ceil(Math.min(news.length, 12) / 2);
        const recent = news.slice(-12);
        for (const [box, list] of [[L, recent.slice(0, half)], [R, recent.slice(half)]] as const) {
          const pp = el('div', 'nb-text', box);
          if (!list.length) this.empty(box, 'cute.book_red');
          for (const n of list) {
            const r = el('p', '', pp);
            el('b', '', r, `${t('hud.day', { d: n.day + 1 })} `);
            r.append(t(`news.${n.kind}`, n.args as Record<string, string | number>));
          }
        }
        break;
      }
      case 'dialog': {
        const log = this.hooks.dialogLog().slice(-12);
        const half = Math.ceil(log.length / 2);
        for (const [box, list] of [[L, log.slice(0, half)], [R, log.slice(half)]] as const) {
          const pp = el('div', 'nb-text', box);
          if (!list.length) this.empty(box, 'cute.talk');
          for (const d of list) {
            const r = el('p', '', pp);
            if (d.act) el('i', 'nb-act', r, d.act);
            el('b', '', r, `${d.who} `);
            r.append(d.text);
          }
        }
        break;
      }
      case 'rumors': {
        const list = s.house?.rumors ?? [];
        this.ribbon(L, t('nb.page.rumors'));
        if (!list.length) {
          this.empty(L, 'cute.exclaim');
          this.empty(R, 'cute.exclaim');
          break;
        }
        const pop = Math.max(1, s.town?.population ?? 100);
        const half = Math.ceil(list.length / 2);
        for (const [box, part] of [[L, list.slice(0, half)], [R, list.slice(half)]] as const) {
          const pp = el('div', 'nb-text', box);
          for (const r of part) {
            const row = el('div', 'nb-line', pp);
            row.appendChild(iconEl(r.good ? 'cute.star' : 'cute.exclaim', 2));
            el('b', 'nb-grow', row, t(`rumor.kind.${r.kind}.name`));
            el('small', '', row, `${Math.round((r.known / pop) * 100)}%`);
            el('p', 'nb-quote', pp, t(`rumor.kind.${r.kind}`, r.args));
          }
        }
        break;
      }
      case 'letters': {
        const list = (s.house?.letters ?? []).slice().reverse();
        this.ribbon(L, t('nb.page.letters'));
        if (!list.length) {
          this.empty(L, 'cute.letter');
          this.empty(R, 'cute.letter');
          break;
        }
        const cur = list.find((x) => String(x.id) === this.book.dataset.letter) ?? list[0];
        this.rows(L, list.slice(0, 7).map((x) => ({ icon: x.read ? 'cute.letter' : 'cute.letter_q', title: x.fromName, sub: t(`letter.kind.${x.kind}`), right: t('hud.day', { d: x.sentDay + 1 }), cls: x.id === cur.id ? 'on' : '', data: { letter: String(x.id) } })));
        L.querySelectorAll<HTMLElement>('.nb-row').forEach((r) => r.addEventListener('click', () => {
          this.book.dataset.letter = r.dataset.letter ?? '';
          this.sig = '';
          this.render();
        }));
        this.ribbon(R, cur.fromName);
        const pr = el('div', 'nb-text nb-letter', R);
        void this.hooks.intent?.({ kind: 'society', op: 'readLetter', args: { personId: cur.to, letterId: cur.id } }).then((res) => {
          const r = (res as { result?: { parts?: string[]; vars?: Record<string, string> } } | undefined)?.result;
          pr.textContent = '';
          for (const k of r?.parts ?? []) el('p', '', pr, t(k, r?.vars ?? {}));
        });
        break;
      }
      case 'people':
      case 'justice':
      case 'tax':
      case 'policy':
      case 'treasury': {
        // 영지 (18-4): 민심, 치안·재판, 세금, 정책(영주면 바꿀 수 있음), 금고
        const D = s.house?.domain;
        const LEVELS: Record<string, string[]> = { tax: ['low', 'normal', 'high'], market: ['free', 'guild'], hunting: ['ban', 'license', 'free'], watch: ['lax', 'normal', 'strict'], plague: ['none', 'quarantine', 'lockdown'], festival: ['none', 'normal', 'grand'] };
        const pol = id === 'policy' ? Object.keys(LEVELS) : id === 'tax' ? ['tax', 'market'] : id === 'justice' ? ['watch', 'hunting'] : id === 'people' ? ['festival', 'plague'] : [];
        this.ribbon(L, t(`nb.page.${id}`));
        const pp = this.paper(L);
        const line = (icon: string, label: string, value: string) => {
          const l = el('div', 'nb-line', pp);
          l.appendChild(iconEl(icon, 2));
          el('b', 'nb-grow', l, label);
          el('b', '', l, value);
        };
        if (!D) {
          this.empty(L, 'rv.castle');
          this.empty(R, 'rv.castle');
          break;
        }
        line('cute.heart', t('policy.morale'), String(D.morale));
        this.bar(pp, D.morale, D.morale < 30 ? 'red' : 'green');
        line('cute.crown', t('policy.treasury'), money(D.treasury));
        if (id === 'justice') line('cute.shield', t('nb.domain.crimes7'), String(D.crimes7));
        if (id === 'people') line('cute.exclaim', t('nb.domain.riots'), String(D.riots));
        this.ribbon(R, t('nb.page.policy'));
        const rp = this.paper(R);
        for (const k of pol) {
          const l = el('div', 'nb-line', rp);
          el('b', 'nb-grow', l, t(`policy.${k}`));
          if (D.lord) {
            for (const v of LEVELS[k]) {
              const b = this.button(l, t(`policy.${k}.${v}`), () => void this.hooks.intent?.({ kind: 'society', op: 'setPolicy', args: { policy: k, value: v } }));
              if (D.levels[k] === v) b.classList.add('on');
            }
          } else el('b', '', l, t(`policy.${k}.${D.levels[k] ?? 'normal'}`));
        }
        if (!D.lord) {
          const btns = el('div', 'nb-btns', R);
          this.button(btns, t('nb.btn.petition'), () => void this.hooks.intent?.({ kind: 'society', op: 'petitionLord', args: { personId: p.id } }));
        }
        break;
      }
      case 'journey':
      case 'clergy':
      case 'guild':
      case 'trade':
      case 'service': {
        const def = Object.values(this.TABS).flatMap((x) => x.pages).find((x) => x.id === id);
        this.ribbon(L, t(`nb.page.${id}`));
        this.empty(L, def?.icon ?? 'cute.book_red');
        this.empty(R, def?.icon ?? 'cute.book_red');
        break;
      }
    }
  }

  private button(parent: HTMLElement, text: string, onClick: () => void, small = false): HTMLButtonElement {
    const S = this.S;
    const b = el('button', `nb-btn ${small ? 'sm' : ''}`, parent);
    b.type = 'button';
    // 목업 btn: 96×48 (원본 24×12). 줄 안 버튼은 80×40
    b.style.width = `${(small ? 20 : 24) * S}px`;
    b.style.height = `${(small ? 10 : 12) * S}px`;
    el('span', '', b, text);
    b.addEventListener('click', () => {
      b.classList.remove('press');
      void b.offsetWidth;
      b.classList.add('press');
      onClick();
    });
    return b;
  }
}

function fmtSigned(v: number): string {
  const n = Math.round(v);
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
}
