/**
 * 인물 수첩 (Tab, GDD 27-8 · 27-11). Kenmi Cute Fantasy Book_UI 한 권.
 * 위쪽 탭 = 큰 분류 (인물 · 가문 · 생업 · 기록, 귀족은 + 영지), 오른쪽 책갈피 = 분류 안의 쪽, 오른쪽 위 X = 닫기.
 * 책 원본 1px = 화면 S px (정수, 기본 4). 안쪽 부품은 모두 그 격자에 맞춤:
 *   왼쪽 쪽 내용 x 14~98, 오른쪽 126~210, 위아래 12~114 (원본 좌표)
 * 표지·탭 색은 가정 대표 신분 (27-11). 쪽 내용은 기존 패널(내면·관계·일·가계부)을 책 모양으로 싣고,
 * 아직 시뮬레이션 자료가 없는 쪽은 아이콘 빈 상태로 둠 (자료가 들어오면 그대로 채워짐).
 */
import type { PersonSnap, Snapshot } from '../sim/protocol';
import { t } from '../i18n';
import { composeCoatOfArms } from '../render/heraldry';
import { bookUrl, iconEl, pieceImg, pieceUrl, stitchCard, tabUrl } from './skin';
import type { InnerPanel } from './InnerPanel';
import type { RelationsPanel } from './RelationsPanel';
import type { WorkPanel } from './WorkPanel';
import type { LedgerPanel } from './LedgerPanel';

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
  private page: Record<TabId, string> = { person: 'emo', house: 'family', work: 'career', record: 'chronicle', domain: 'people' };
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
        { id: 'wishes', icon: 'cute.trophy' }, { id: 'memories', icon: 'cute.letter_q' },
      ],
    },
    house: {
      icon: 'cute.crown',
      pages: [
        { id: 'family', icon: 'cute.crown' }, { id: 'tree', icon: 'cute.shield' }, { id: 'relations', icon: 'cute.heart_blue' },
        { id: 'fame', icon: 'cute.star_blue', when: (p, s) => estateOf(p, s) !== 'serf' },
        { id: 'freedom', icon: 'cute.star_blue', when: (p, s) => estateOf(p, s) === 'serf' || !!s.house?.rise.length },
        { id: 'servants', icon: 'cute.bag', when: (p, s) => ['merchant', 'knight', 'noble'].includes(estateOf(p, s)) },
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
      pages: [{ id: 'people', icon: 'cute.heart' }, { id: 'justice', icon: 'cute.shield' }, { id: 'tax', icon: 'cute.coins' }, { id: 'policy', icon: 'cute.letter' }, { id: 'treasury', icon: 'cute.crown' }],
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
        b.appendChild(iconEl(this.TABS[tb].icon, on ? 3 : 2, 'nb-tab-ic'));
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
      this.marksEl.style.left = `${220 * S}px`;
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
        b.appendChild(ic);
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

  private cells(parent: HTMLElement, items: Array<{ icon?: string; canvas?: HTMLCanvasElement | null; label: string; on?: boolean; dim?: boolean; glow?: string; data?: Record<string, string>; onClick?: () => void; title?: string }>, cols = 4, total = 8): HTMLElement {
    const S = this.S;
    const size = 20; // 원본 20px 칸
    const gap = 1;
    const grid = el('div', 'nb-cells', parent);
    grid.style.gridTemplateColumns = `repeat(${cols}, ${size * S}px)`;
    grid.style.gap = `${gap * S}px`;
    const n = Math.max(total, items.length);
    for (let i = 0; i < n; i++) {
      const it = items[i];
      const c = el(it?.onClick ? 'button' : 'div', `nb-cell ${it?.on ? 'on' : ''} ${!it ? 'empty' : ''} ${it?.dim ? 'dim' : ''}`, grid) as HTMLElement;
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

  private rows(parent: HTMLElement, items: Array<{ icon?: string; canvas?: HTMLCanvasElement | null; title: string; sub?: string; right?: string; dim?: boolean; cls?: string; data?: Record<string, string> }>): HTMLElement {
    const S = this.S;
    const list = el('div', 'nb-rows', parent);
    for (const it of items) {
      const r = el('div', `nb-row ${it.dim ? 'dim' : ''} ${it.cls ?? ''}`, list);
      for (const [k, v] of Object.entries(it.data ?? {})) r.dataset[k] = v;
      r.style.minHeight = `${18 * S}px`;
      r.style.borderImageWidth = `${6 * S * 0.75}px`;
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
        const cats = new Map<string, number[]>();
        for (const k of ids) {
          const c = defs[k].category;
          cats.set(c, [...(cats.get(c) ?? []), sk[k][0]]);
        }
        this.rows(R, [...cats].map(([c, lv]) => ({ icon: c === 'labor' ? 'cute.wrench' : c === 'scholarly' ? 'cute.book_blue' : 'cute.star', title: t(`skill.bundle.${c}`), right: (lv.reduce((a, b) => a + b, 0) / lv.length).toFixed(1) })));
        break;
      }
      case 'persona': {
        this.ribbon(L, t('nb.page.traits'));
        this.cells(L, (inner?.traits ?? []).map((tr) => ({ icon: this.inner?.defs.traitIcon(tr) ?? 'emo.neutral', label: t(`trait.${tr}`), title: t(`trait.${tr}.desc`), data: { trait: tr } })), 3, 3);
        const box = el('div', 'nb-scroll inner-view', R);
        this.inner?.invalidate();
        this.inner?.render(box, 'persona', p);
        break;
      }
      case 'wishes': {
        const box = el('div', 'nb-scroll inner-view', L);
        this.inner?.invalidate();
        this.inner?.render(box, 'wishes', p);
        this.ribbon(R, t('nb.page.aspiration'));
        const a = inner?.aspiration ? this.inner?.defs.aspiration(inner.aspiration.id) : null;
        if (inner?.aspiration && a) {
          this.rows(R, a.stages.map((st, i) => ({ icon: i < inner.aspiration!.stage ? 'cute.up_green' : i === inner.aspiration!.stage ? 'cute.right' : 'cute.star', title: st.textKey ? t(st.textKey) : t('panel.stage', { n: i + 1 }), dim: i < inner.aspiration!.stage })));
        } else this.empty(R, 'cute.trophy');
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
        const box = el('div', 'nb-scroll', L);
        this.relations?.invalidate();
        this.relations?.render(box, p, s);
        // 오른쪽: 이웃 칸만 따로 보이게 옮김
        const nb = box.querySelector('.rel-neighbors');
        const head = nb?.previousElementSibling;
        if (nb) {
          this.ribbon(R, t('ui.relations.neighbors'));
          const rb = el('div', 'nb-scroll', R);
          if (head) head.remove();
          rb.appendChild(nb);
        }
        break;
      }
      case 'fame': {
        const H = s.house;
        const cl = H?.clan;
        this.ribbon(L, cl?.name ? t(cl.name) : t('nb.page.fame'));
        if (cl?.heraldry) {
          try {
            const cv = composeCoatOfArms(cl.heraldry as never, 3) as HTMLCanvasElement;
            cv.className = 'nb-arms';
            L.appendChild(cv);
          } catch {
            /* 문장 사양이 옛 형식이면 건너뜀 */
          }
        }
        const pp = this.paper(L);
        const l1 = el('div', 'nb-line', pp);
        l1.appendChild(iconEl('cute.star', 2));
        el('b', 'nb-grow', l1, t(`fame.tier.${cl?.tier ?? 'ordinary'}`));
        el('b', '', l1, String(Math.round(cl?.fame ?? 0)));
        this.bar(pp, Math.min(1, (cl?.fame ?? 0) / 1000), 'blue');
        if (cl?.motto) el('p', 'nb-motto', pp, cl.motto.startsWith('clan.motto.') ? t(cl.motto) : cl.motto);
        const l2 = el('div', 'nb-line', pp);
        l2.appendChild(iconEl('cute.crown', 2));
        el('b', 'nb-grow', l2, t(`estate.${estate}`));
        if (cl) el('small', '', l2, t(`inherit.${cl.law === 'will' ? 'designated' : cl.law}`));
        this.ribbon(R, t('nb.page.heirlooms'));
        const hl = H?.heirlooms ?? [];
        if (!hl.length && !(H?.lostHeirlooms.length)) this.empty(R, 'cute.trophy');
        else this.rows(R, [
          ...hl.map((h) => ({ icon: 'cute.trophy', title: h.name ?? t(`object.${h.defId}`), sub: h.damaged ? t(`heirloom.state.${h.damaged}`) : undefined })),
          ...(H?.lostHeirlooms ?? []).map(() => ({ icon: 'cute.no', title: t('heirloom.lost.stolen'), dim: true })),
        ]);
        if (s.econ?.shop) {
          const l3 = el('div', 'nb-line', pp);
          l3.appendChild(iconEl('cute.coins', 2));
          el('b', 'nb-grow', l3, t('nb.fame.shop'));
          el('b', '', l3, String(Math.round(s.econ.shop.reputation)));
        }
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
          this.button(row, t('nb.btn.accept'), () => void this.hooks.intent?.({ kind: 'society', op: 'acceptProposal', args: { matchId: id } }));
          this.button(row, t('nb.btn.refuse'), () => void this.hooks.intent?.({ kind: 'society', op: 'refuseMatch', args: { matchId: id } }));
        });
        break;
      }
      case 'freedom': {
        const em = s.house?.emancipation;
        this.ribbon(L, t('nb.page.freedom'));
        const pp = this.paper(L);
        const l = el('div', 'nb-line', pp);
        l.appendChild(iconEl('cute.coins', 2));
        el('b', 'nb-grow', l, em ? money(Math.max(0, em.money)) : '-');
        el('b', '', l, em ? money(em.fee) : '-');
        this.bar(pp, em ? Math.max(0, Math.min(1, em.money / Math.max(1, em.fee))) : 0, 'green');
        // 신분 오르기 (16-3): 할 수 있는 길마다 버튼 (못 하면 흐리게, 이유는 툴팁)
        this.ribbon(R, t('nb.page.rise'));
        const rows = el('div', 'nb-btns nb-wrap', R);
        for (const r of s.house?.rise ?? []) {
          const b = this.button(rows, t(`nb.rise.${r.op}`), () => void this.hooks.intent?.({ kind: 'house', op: r.op, args: { personId: r.personId, craft: 'blacksmith', quality: 3 } }));
          b.disabled = !r.ok;
          b.title = `${t(`nb.rise.${r.op}`)}${r.cost ? ` · ${money(r.cost)}` : ''}${r.reason ? ` · ${t(r.reason)}` : ''}`;
        }
        if (!(s.house?.rise.length)) this.empty(R, 'cute.star_blue');
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
        const cells = el('div', 'nb-btns nb-wrap', R);
        for (const role of ['maid', 'cook', 'nurse', 'groom', 'steward', 'guard']) {
          const b = this.button(cells, t(`servant.role.${role}`), () => void this.hooks.intent?.({ kind: 'house', op: 'hireServant', args: { role } }));
          b.title = t(`servant.role.${role}`);
        }
        break;
      }
      case 'career': {
        const box = el('div', 'nb-scroll', L);
        this.work?.invalidate();
        this.work?.render(box, p, s);
        // 솜씨 격자는 오른쪽 쪽으로
        const skHead = [...box.querySelectorAll('.rel-head')].find((h) => h.textContent === t('ui.work.skills'));
        const grid = box.querySelector('.skill-grid');
        this.ribbon(R, t('ui.work.skills'));
        const rb = el('div', 'nb-scroll', R);
        if (grid) {
          skHead?.remove();
          box.querySelector('.rel-empty')?.remove();
          rb.appendChild(grid);
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
        this.bar(pp, D.morale / 100, D.morale < 30 ? 'red' : 'green');
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

  private button(parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
    const S = this.S;
    const b = el('button', 'nb-btn', parent);
    b.type = 'button';
    b.style.width = `${32 * S * 0.75}px`;
    b.style.height = `${16 * S * 0.75}px`;
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
