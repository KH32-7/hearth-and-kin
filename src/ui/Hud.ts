/**
 * 하루 모드 HUD (DOM, GDD 27-2 · 27-3 · 27-9). 캔버스에 한글을 그리지 않음 (BRIEF 7장).
 * 배치는 심즈 4:
 * - 좌상단: 낮밤 시계 원판 + 시각 · 날짜 · 기온 · 기도 시각
 * - 우상단: 아이콘 띠 (생활/구매/건축 | 지도 · 연대기 · 가계부 · 편지 · 메뉴), 그 아래 알림
 * - 왼쪽 가장자리: 행동 대기열 (아래가 지금)
 * - 좌하단 (심즈식): 세로 감정 글씨 + 세기 막대, 상반신 + 감정색 빛, 머리 위 소망 생각 풍선 3개,
 *   가슴께 무드렛 칸 한 줄 (4개 + 펼침 탭, 마우스를 올리면 설명 카드), 맨 아랫줄 이름 · 돈 · 명성 · 집 + 가족 머리
 * - 하단 가운데: 속도
 * - 우하단: 자주 쓰는 창 (욕구 · 감정 · 관계 · 소원 · 수첩) → 반투명 팝업
 * 판은 둥근 반투명 하나(.g). 조작 안내 글은 두지 않음 (27-3). 반응은 게임필 원칙: 누르면 눌리고, 바뀌면 톡.
 */
import type { Notice } from '../sim/sim';
import type { PersonSnap, RelationSnap, Snapshot } from '../sim/protocol';
import { has, t } from '../i18n';
import { iconEl, pieceImg, setIcon } from './skin';
import type { InnerDefs, InnerPanel } from './InnerPanel';
import type { RelationsPanel } from './RelationsPanel';
import type { WorkPanel } from './WorkPanel';
import economy from '../data/economy.json';

const CAL = (economy as { calendar: { seasonDays: number; seasons: string[]; startYear?: number } }).calendar;

export type HudPopup = 'needs' | 'emo' | 'rel' | 'wish' | 'menu' | null;
export type HudWindow = 'map' | 'chronicle' | 'ledger' | 'letters' | 'menu';

export interface HudHandlers {
  selectPerson(id: number): void;
  setSpeed(speed: number): void;
  cancel(personId: number, queueItemId: number): void;
  focusPerson(id: number): void;
  /** 초상 우클릭: 카메라가 그 사람을 따라감 (심즈) */
  followPerson?(id: number): void;
  emotionColor?(emotion: string): string;
  /** 머리(가족 줄, 관계)·상반신(조작 인물) 초상 캔버스. 시트가 아직 없으면 null */
  portrait?(id: number, kind: 'head' | 'bust'): HTMLCanvasElement | null;
  /** 우상단 창 버튼 */
  openWindow?(w: HudWindow): void;
  /** 수첩 (Tab) */
  toggleBook?(page?: string): void;
  lockWish?(personId: number, wish: string, locked: boolean): void;
  /** 소원 길잡이: 이룰 수 있는 물건·사람을 비추고 카메라를 옮김. 찾지 못하면 false */
  wishHint?(personId: number, wish: string): Promise<boolean>;
  menu?(action: 'save' | 'load' | 'settings' | 'gallery' | 'help' | 'hideUi' | 'title'): void;
}

const NEEDS = ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social', 'warmth', 'comfort'] as const;
/** 글자 알림 대신 머리 위 연출로 보여 주는 알림 */
const SILENT = new Set(['thought', 'social_result']);
/** 위험 알림: 배경이 살짝 붉고 흔들림 (27-2) */
const DANGER = new Set(['fire_started', 'fire_home', 'collapse', 'plague', 'starving', 'muster', 'object_burned', 'heirloom_damaged']);
const LOW = 30;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** 톡: 클래스를 뺐다 다시 넣어 애니메이션 재생 (게임필: 바뀌면 반응) */
function pop(e: HTMLElement, cls = 'pop'): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}

/** Cute 막대: 빈 틀 위에 채움 */
function cbar(parent: HTMLElement, cls = ''): { root: HTMLElement; fill: HTMLElement; set(v: number, color?: 'green' | 'blue' | 'red'): void } {
  const root = el('div', `cbar ${cls}`, parent);
  const fill = el('div', 'cbar-fill', root);
  return {
    root,
    fill,
    set(v, color) {
      const c = color ?? (v < LOW ? 'red' : 'green');
      fill.style.width = `${Math.max(0, Math.min(100, v))}%`;
      if (fill.dataset.c !== c) fill.dataset.c = c;
    },
  };
}

/** 기도 시각 (교회 종, 21장). 분 → 이름 키 */
function canonicalHour(min: number): string {
  const h = min / 60;
  if (h < 3) return 'matins';
  if (h < 6) return 'lauds';
  if (h < 9) return 'prime';
  if (h < 12) return 'terce';
  if (h < 15) return 'sext';
  if (h < 18) return 'none';
  if (h < 21) return 'vespers';
  return 'compline';
}

export class Hud {
  readonly root: HTMLElement;
  // 시계
  private hand: HTMLElement;
  private clockTime: HTMLElement;
  private clockDay: HTMLElement;
  private clockTemp: HTMLElement;
  private clockBell: HTMLElement;
  private clockPaused: HTMLElement;
  // 우상단
  readonly topbar: HTMLElement;
  readonly modeSlot: HTMLElement;
  private winBtns = new Map<string, HTMLElement>();
  private noticeEl: HTMLElement;
  private menuEl: HTMLElement;
  // 왼쪽
  private queueEl: HTMLElement;
  private queueLabel: HTMLElement;
  private meEmo: HTMLElement;
  private meEmoBar: HTMLElement;
  private meMls: HTMLElement;
  private mlsSig = '';
  private mlsOpen = false;
  private meBust: HTMLElement;
  private meGlow: HTMLElement;
  private meWants: HTMLElement;
  private meName: HTMLElement;
  private moneyEl: HTMLElement;
  private moneyVal: HTMLElement;
  private fameEl: HTMLElement;
  private familyEl: HTMLElement;
  private tip: HTMLElement;
  // 아래
  private speedBtns: HTMLButtonElement[] = [];
  private accelEl: HTMLElement;
  private quickBtns = new Map<string, HTMLElement>();
  private needDot: HTMLElement;
  private popEl: HTMLElement;
  private popBody: HTMLElement;
  private popSb: HTMLElement;
  private needRows = new Map<string, ReturnType<typeof cbar>>();

  private popup: HudPopup = null;
  private popSig = '';
  private queueSig = '';
  private familySig = '';
  private bustFor = -1;
  private wantsSig = '';
  private seenSeq = -1;
  private seenNotice = -1;
  private last: PersonSnap | null = null;
  private lastSnap: Snapshot | null = null;
  private hoverId = -1;
  private handDeg = 0;

  inner: InnerPanel | null = null;
  relations: RelationsPanel | null = null;
  work: WorkPanel | null = null;
  /** 돈 칸을 누르면 (가계부) */
  onMoney: (() => void) | null = null;

  constructor(parent: HTMLElement, private h: HudHandlers) {
    this.root = el('div', 'hud', parent);
    this.root.id = 'hud';
    el('div', 'hud-shade tl', this.root);
    el('div', 'hud-shade bl', this.root);

    // ---------------- 좌상단 시계
    const clock = el('div', 'clock', this.root);
    clock.dataset.testid = 'clock';
    const dial = el('div', 'clock-dial', clock);
    dial.appendChild(pieceImg('clock.dial', 4, 'dial-img'));
    this.hand = pieceImg('clock.hand', 4, 'dial-hand');
    dial.appendChild(this.hand);
    const txt = el('div', 'clock-text', clock);
    this.clockTime = el('div', 'clock-time fl', txt);
    this.clockDay = el('div', 'clock-day fl s', txt);
    const row = el('div', 'clock-row fl s', txt);
    this.clockTemp = el('span', '', row);
    this.clockBell = el('span', '', row);
    this.clockPaused = el('div', 'clock-paused', txt);
    this.clockPaused.appendChild(pieceImg('cbtn.pause', 2));

    // ---------------- 우상단 아이콘 띠
    this.topbar = el('div', 'topbar g', this.root);
    this.modeSlot = el('div', 'mode-slot', this.topbar);
    el('div', 'tb-sep', this.topbar);
    const wins: Array<[HudWindow, string]> = [['map', 'rv.map'], ['chronicle', 'cute.book_red'], ['ledger', 'cute.coins'], ['letters', 'cute.letter_new'], ['menu', 'cute.gear']];
    for (const [w, icon] of wins) {
      const b = this.iconBtn(this.topbar, icon, t(`hud2.win.${w}`), 'win-btn');
      b.dataset.win = w;
      b.addEventListener('click', () => {
        if (w === 'menu') this.setPopup(this.popup === 'menu' ? null : 'menu');
        else this.h.openWindow?.(w);
      });
      this.winBtns.set(w, b);
    }
    this.menuEl = el('div', 'hud-menu g', this.root);
    const menu: Array<[Parameters<NonNullable<HudHandlers['menu']>>[0], string, string[]]> = [
      ['save', 'cute.save', ['key.ctrl', 'key.s']], ['load', 'cute.book_blue', []], ['settings', 'cute.gear', []],
      ['gallery', 'cute.star', []], ['help', 'cute.question', ['key.f1']], ['hideUi', 'cute.no', ['key.h']], ['title', 'cute.left', []],
    ];
    for (const [a, icon, keys] of menu) {
      const b = el('button', 'menu-row s', this.menuEl);
      b.type = 'button';
      b.dataset.menu = a;
      b.appendChild(iconEl(icon, 2));
      el('span', 'menu-name', b, t(`hud2.menu.${a}`));
      const k = el('span', 'menu-keys', b);
      for (const kk of keys) k.appendChild(pieceImg(kk, 2));
      b.addEventListener('click', () => {
        this.setPopup(null);
        this.h.menu?.(a);
      });
    }

    this.noticeEl = el('div', 'notices', this.root);

    // ---------------- 왼쪽: 대기열
    this.queueEl = el('div', 'queue g', this.root);
    this.queueEl.dataset.testid = 'queue';
    this.queueLabel = el('div', 'queue-label fl s', this.root);

    // ---------------- 좌하단: 나
    const me = el('div', 'me', this.root);
    const bustWrap = el('div', 'me-bust', me);
    this.meGlow = el('div', 'me-glow', bustWrap);
    this.meBust = el('div', 'me-img', bustWrap);
    bustWrap.addEventListener('dblclick', () => this.last && this.h.focusPerson(this.last.id));
    bustWrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.last) this.h.followPerson?.(this.last.id);
    });
    // 세로 감정 글씨는 빛 위 (왼쪽 끝에 세기 막대: 기본 1/3 · 강함 2/3 · 극도 가득 · 무난 빔)
    const emoCol = el('div', 'me-emo-col', me);
    this.meEmoBar = el('i', '', el('div', 'me-emo-bar', emoCol));
    this.meEmo = el('div', 'me-emo fl', emoCol);
    this.meWants = el('div', 'me-wants', me);
    this.meMls = el('div', 'mls', me);
    const line = el('div', 'me-line', me);
    this.meName = el('span', 'me-name fl', line);
    this.moneyEl = el('button', 'money fl s', line);
    (this.moneyEl as HTMLButtonElement).type = 'button';
    this.moneyEl.dataset.testid = 'money';
    this.moneyEl.appendChild(iconEl('cute.coin', 1));
    this.moneyVal = el('span', 'money-n', this.moneyEl);
    this.moneyEl.style.display = 'none';
    this.moneyEl.addEventListener('click', () => this.onMoney?.());
    // 가문 명성 (목업: 돈 옆 왕관 + 수)
    this.fameEl = el('span', 'fame fl s', line);
    this.fameEl.appendChild(iconEl('cute.crown', 1));
    el('span', 'fame-n', this.fameEl);
    this.fameEl.style.display = 'none';

    this.familyEl = el('div', 'family', this.root);
    this.tip = el('div', 'fam-tip g s', this.root);

    // ---------------- 하단 가운데: 속도
    const sp = el('div', 'speed', this.root);
    this.accelEl = el('div', 'speed-accel', sp);
    this.accelEl.appendChild(iconEl('cute.bolt', 1));
    const btns = el('div', 'speed-btns', sp);
    for (let s = 0; s <= 3; s++) {
      const b = el('button', 'speed-btn rbtn', btns);
      b.type = 'button';
      b.dataset.speed = String(s);
      b.title = t(`hud.speed.${s}`);
      b.setAttribute('aria-label', t(`hud.speed.${s}`));
      if (s === 0) b.dataset.kind = 'pause';
      else if (s === 1) b.dataset.kind = 'play';
      else el('span', 'ff', b).append(...Array.from({ length: s }, () => el('i', 'tri')));
      b.addEventListener('click', () => this.h.setSpeed(s));
      this.speedBtns.push(b);
    }

    // ---------------- 우하단: 자주 쓰는 창
    const quick = el('div', 'quick g', this.root);
    const qk: Array<[string, string]> = [['needs', 'cute.bolt'], ['emo', 'cute.heart'], ['rel', 'cute.talk'], ['wish', 'cute.trophy'], ['book', 'cute.book_blue']];
    for (const [k, icon] of qk) {
      const b = this.iconBtn(quick, icon, t(`hud2.quick.${k}`), 'qk-btn');
      b.dataset.pop = k;
      b.addEventListener('click', () => {
        if (k === 'book') {
          this.setPopup(null);
          this.h.toggleBook?.();
        } else this.setPopup(this.popup === k ? null : (k as HudPopup));
      });
      this.quickBtns.set(k, b);
    }
    this.needDot = el('i', 'warn-dot', this.quickBtns.get('needs')!);
    this.popEl = el('div', 'hud-pop g', this.root);
    this.popEl.dataset.testid = 'hud-pop';
    this.popBody = el('div', 'pop-body', this.popEl);
    this.popSb = el('div', 'sb', this.popEl);
    el('i', '', this.popSb);
    this.popBody.addEventListener('wheel', (e) => {
      const sc = this.popBody.querySelector<HTMLElement>('.scroll');
      if (!sc) return;
      sc.scrollTop += e.deltaY;
      this.syncScroll();
      e.preventDefault();
    }, { passive: false });
    this.setPopup(null);
  }

  private iconBtn(parent: HTMLElement, icon: string, label: string, cls: string): HTMLButtonElement {
    const b = el('button', `ib ${cls}`, parent);
    b.type = 'button';
    b.appendChild(iconEl(icon, 2));
    el('span', 'ib-label s', b, label);
    b.setAttribute('aria-label', label);
    return b;
  }

  // ------------------------------------------------------------------ 갱신

  update(s: Snapshot, selectedId: number): void {
    this.lastSnap = s;
    const p = s.persons.find((q) => q.id === selectedId) ?? s.persons[0];
    this.updateFamily(s.persons.filter((q) => q.household === (p?.household ?? 1) && !q.visitor), p?.id ?? -1);
    if (p) {
      this.last = p;
      this.updateMe(p);
      this.updateQueue(p);
      this.needDot.classList.toggle('on', NEEDS.some((n) => (p.needs[n] ?? 100) < LOW));
      this.clockTemp.textContent = t('hud2.temp', { t: Math.round(s.outsideC) });
      this.clockTemp.title = t('hud.felt', { t: Math.round(p.feltC) });
    }
    this.updateClock(s);
    for (const b of this.speedBtns) {
      const on = Number(b.dataset.speed) === s.speed;
      if (b.classList.contains('on') !== on) {
        b.classList.toggle('on', on);
        if (on) pop(b, 'press');
      }
    }
    this.accelEl.classList.toggle('show', s.autoAccel && s.speed > 0);
    if (s.econ) {
      this.moneyEl.style.display = '';
      const txt = formatMoney(s.econ.money);
      if (this.moneyVal.textContent !== txt) {
        const prev = Number(this.moneyEl.dataset.v ?? s.econ.money);
        this.moneyEl.classList.remove('up', 'down');
        void this.moneyEl.offsetWidth;
        if (s.econ.money !== prev) this.moneyEl.classList.add(s.econ.money > prev ? 'up' : 'down');
        this.moneyEl.dataset.v = String(s.econ.money);
        this.moneyVal.textContent = txt;
        this.moneyEl.title = t('hud.money.title', { debt: formatMoney(s.econ.debt) });
      }
    }
    const fame = s.house?.clan ? String(Math.round(s.house.clan.fame)) : '';
    const fn = this.fameEl.lastElementChild as HTMLElement;
    if (fn.textContent !== fame) {
      fn.textContent = fame;
      this.fameEl.style.display = fame ? '' : 'none';
      this.fameEl.title = s.house?.clan ? t(`fame.tier.${s.house.clan.tier}`) : '';
    }
    this.updateNotices(s.notices, s.persons);
    if (this.popup && p) this.renderPopup(p, s);
  }

  private updateClock(s: Snapshot): void {
    const h = Math.floor(s.minuteOfDay / 60);
    const m = s.minuteOfDay % 60;
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const txt = t(`hud2.clock.${ampm}`, { h: h12, m: String(m).padStart(2, '0') });
    if (this.clockTime.textContent !== txt) this.clockTime.textContent = txt;
    // 봄 3일 · 수요일 · 에르덴력 1287년 (한 주 = 7일, 한 해 = 계절 4개)
    const yearDays = CAL.seasonDays * CAL.seasons.length;
    const day = t('hud2.date', { season: t(`hud.season.${s.season}`), d: (s.day % CAL.seasonDays) + 1, wd: t(`hud2.wd.${s.day % 7}`), y: (CAL.startYear ?? 1) + Math.floor(s.day / yearDays) });
    if (this.clockDay.textContent !== day) this.clockDay.textContent = day;
    const bell = t(`hud2.bell.${canonicalHour(s.minuteOfDay)}`);
    if (this.clockBell.textContent !== bell) {
      if (this.clockBell.textContent) pop(this.clockBell, 'ring');
      this.clockBell.textContent = bell;
    }
    // 바늘: 하루 한 바퀴 (시계 방향). 바늘 그림은 오른쪽 끝 꼭지가 축이고 왼쪽을 가리킴:
    // 자정 = 왼쪽(밤, 달), 6시 = 위, 정오 = 오른쪽(낮, 해), 18시 = 아래
    // 자정을 넘을 때 거꾸로 한 바퀴 돌지 않게 누적 각도
    const want = s.minuteOfDay / 4;
    const cur = this.handDeg % 360;
    let d = want - ((cur + 360) % 360);
    if (d < -180) d += 360;
    if (d > 180) d -= 360;
    this.handDeg += d;
    this.hand.style.transform = `rotate(${this.handDeg}deg)`;
    this.clockPaused.classList.toggle('show', s.speed === 0 || !!s.build?.mode);
  }

  private updateMe(p: PersonSnap): void {
    const inner = p.inner;
    const emo = inner && inner.stage >= 1 ? inner.emotion : 'neutral';
    const key = emo === 'neutral' ? 'emotion.neutral' : `emotion.${emo}.${['basic', 'strong', 'extreme'][(inner?.stage ?? 1) - 1]}`;
    const color = this.h.emotionColor?.(emo) ?? '#9be08f';
    if (this.meEmo.dataset.key !== key) {
      this.meEmo.dataset.key = key;
      this.meEmo.textContent = t(key);
      const light = mix(color, '#ffffff', 0.45);
      this.meEmo.style.color = light;
      this.meEmoBar.style.background = light;
      this.meEmoBar.style.height = `${[0, 34, 67, 100][emo === 'neutral' ? 0 : Math.max(0, Math.min(3, inner?.stage ?? 0))]}%`;
      this.meGlow.style.setProperty('--glow', color);
      this.meGlow.classList.toggle('neutral', emo === 'neutral');
      pop(this.meEmo);
      pop(this.meGlow, 'pulse');
    }
    this.updateMoodlets(p, emo);
    if (this.meName.textContent !== p.name) this.meName.textContent = p.name;
    if (this.bustFor !== p.id || !this.meBust.firstChild) {
      const cv = this.h.portrait?.(p.id, 'bust');
      if (cv) {
        this.meBust.textContent = '';
        this.meBust.appendChild(cv);
        this.bustFor = p.id;
        pop(this.meBust, 'swap');
      }
    }
    // 머리 위 생각 풍선: 지금 원하는 것 (소원 앞 셋, 머리 가운데에 맞춤)
    const wants = (inner?.wishes ?? []).filter((w) => w.kind === 'wish').slice(0, 3);
    const sig = `${p.id}|` + wants.map((w) => w.id).join(',');
    if (sig !== this.wantsSig) {
      this.wantsSig = sig;
      this.meWants.textContent = '';
      const defs = this.innerDefs();
      wants.forEach((w, k) => {
        const b = el('div', `want w${k}`, this.meWants);
        b.dataset.wish = w.id;
        el('i', `wt ${['l', 'c', 'r'][k]}`, b);
        el('div', 'wb', b).appendChild(iconEl(defs?.wishDef(w.id)?.icon ?? 'emo.excited', 2));
        b.title = defs?.wishDef(w.id) ? t(defs.wishDef(w.id)!.textKey) : '';
        // 누르면 소원 창 + 이룰 수 있는 곳으로 바로 (한 번에)
        b.addEventListener('click', () => {
          this.setPopup('wish');
          pop(b, 'press');
          void this.h.wishHint?.(p.id, w.id);
        });
        pop(b);
      });
    }
  }

  /**
   * 무드렛 칸 (심즈식): 칸 배경 = 무드렛 감정 색, 주 감정 무드렛 먼저 · 그 안에서 센 순서. 4개까지, 넘치면 끝에 ▸ 남은 개수 탭 (◂ 로 접힘).
   * 칸에 마우스를 올리면 위로 설명 카드: 감정 + 세기, 무드렛 이름, 원인(하늘색), 설명, 남은 시간
   */
  private updateMoodlets(p: PersonSnap, emo: string): void {
    const list = [...(p.inner?.moodlets ?? [])].sort((a, b) => Number(b.emotion === emo) - Number(a.emotion === emo) || b.strength - a.strength);
    const sig = `${p.id}|${emo}|${this.mlsOpen}|${list.map((m) => `${m.id}:${m.emotion}:${m.strength}:${Math.round(m.remainingMin / 10)}`).join(',')}`;
    if (sig === this.mlsSig) return;
    this.mlsSig = sig;
    const box = this.meMls;
    box.textContent = '';
    box.classList.toggle('open', this.mlsOpen);
    const defs = this.innerDefs();
    const neg = (e: string) => ['sad', 'angry', 'tense', 'ashamed'].includes(e);
    list.forEach((m, i) => {
      const c = this.h.emotionColor?.(m.emotion) ?? '#9be08f';
      const cell = el('div', `ml${i >= 4 ? ' more' : ''}`, box);
      cell.dataset.moodlet = m.id;
      const tile = el('div', 'ml-t', cell);
      tile.style.setProperty('--c', c);
      tile.appendChild(iconEl(defs?.moodletIcon(m.id) ?? `emo.${m.emotion}`, 2));
      const tip = el('div', 'ml-tip g s', cell);
      const hd = el('b', 'ml-tip-h', tip, `${t(m.emotion === 'neutral' ? 'emotion.neutral' : `emotion.${m.emotion}.basic`)} ${neg(m.emotion) ? '−' : '+'}${m.strength}`);
      hd.style.color = mix(c, '#ffffff', 0.45);
      const keys = defs?.moodletKeys(m.id);
      const nameKey = keys?.name ?? `moodlet.${m.id}`;
      if (has(nameKey)) el('b', 'ml-tip-n', tip, t(nameKey));
      if (has(`moodlet.${m.id}.cause`)) el('div', 'ml-tip-c', tip, t(`moodlet.${m.id}.cause`, { name: p.name }));
      const descKey = has(`moodlet.${m.id}.desc`) ? `moodlet.${m.id}.desc` : keys?.desc;
      if (descKey && has(descKey)) el('div', 'ml-tip-d', tip, t(descKey, { name: p.name }));
      if (m.remainingMin >= 0) el('b', 'ml-tip-t', tip, m.remainingMin >= 60 ? t('panel.remaining.h', { n: Math.round(m.remainingMin / 60) }) : t('panel.remaining.m', { n: Math.max(1, Math.round(m.remainingMin)) }));
    });
    const extra = list.length - 4;
    if (extra > 0) {
      const x = el('button', 'ml-x s', box);
      x.type = 'button';
      x.appendChild(iconEl(this.mlsOpen ? 'cute.left' : 'cute.right', 1));
      if (!this.mlsOpen) el('b', '', x, String(extra));
      x.addEventListener('click', () => {
        this.mlsOpen = !this.mlsOpen;
        this.mlsSig = '';
        if (this.last) this.updateMoodlets(this.last, emo);
      });
    }
  }

  private innerDefs(): InnerDefs | null {
    return this.inner?.defs ?? null;
  }

  private updateFamily(persons: PersonSnap[], sel: number): void {
    const sig = persons.map((p) => `${p.id}:${p.name}:${this.h.portrait?.(p.id, 'head') ? 1 : 0}`).join('|') + `#${sel}`;
    if (sig !== this.familySig) {
      this.familySig = sig;
      this.familyEl.textContent = '';
      this.familyEl.appendChild(iconEl('rv.home', 2, 'fam-home'));
      for (const p of persons) {
        const b = el('button', 'member', this.familyEl);
        b.type = 'button';
        b.dataset.personId = String(p.id);
        b.classList.toggle('on', p.id === sel);
        el('i', 'member-glow', b);
        const cv = this.h.portrait?.(p.id, 'head');
        if (cv) {
          cv.className = 'member-img';
          b.appendChild(cv);
        } else el('i', 'member-ph', b); // 그림 합성 전 (1초 안쪽): 글자 대신 빈 자리
        el('i', 'member-warn', b).appendChild(iconEl('cute.exclaim', 1));
        b.addEventListener('click', () => {
          pop(b, 'press');
          this.h.selectPerson(p.id);
        });
        b.addEventListener('dblclick', () => this.h.focusPerson(p.id));
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.h.followPerson?.(p.id);
        });
        b.addEventListener('pointerenter', () => this.showTip(p.id, b));
        b.addEventListener('pointerleave', () => this.hideTip());
      }
    }
    for (const p of persons) {
      const b = this.familyEl.querySelector<HTMLElement>(`[data-person-id="${p.id}"]`);
      if (!b) continue;
      const emo = p.inner && p.inner.stage >= 1 ? p.inner.emotion : 'neutral';
      if (b.dataset.emo !== emo) {
        b.dataset.emo = emo;
        b.style.setProperty('--emo', this.h.emotionColor?.(emo) ?? '#888');
      }
      b.classList.toggle('warn', NEEDS.some((n) => (p.needs[n] ?? 100) < LOW / 2) || p.collapsed);
      b.classList.toggle('away', p.hidden);
      b.classList.toggle('on', p.id === sel);
    }
    if (this.hoverId >= 0) {
      const b = this.familyEl.querySelector<HTMLElement>(`[data-person-id="${this.hoverId}"]`);
      if (b) this.showTip(this.hoverId, b);
    }
  }

  private showTip(id: number, anchor: HTMLElement): void {
    const p = this.lastSnap?.persons.find((q) => q.id === id);
    if (!p) return;
    this.hoverId = id;
    const emo = p.inner && p.inner.stage >= 1 ? p.inner.emotion : 'neutral';
    const emoKey = emo === 'neutral' ? 'emotion.neutral' : `emotion.${emo}.${['basic', 'strong', 'extreme'][(p.inner?.stage ?? 1) - 1]}`;
    const low = NEEDS.map((n) => [n, p.needs[n] ?? 100] as const).sort((a, b) => a[1] - b[1])[0];
    const doing = p.sleeping ? t('hud.sleeping') : p.action ? t(iaNameKey(p.action.interactionId)) : t('hud.idle');
    this.tip.textContent = '';
    const head = el('div', 'tip-head', this.tip);
    el('b', '', head, p.name);
    el('span', '', head, ` · ${t(emoKey)}`);
    el('div', '', this.tip, doing);
    if (low && low[1] < 60) {
      const r = el('div', `tip-need ${low[1] < LOW ? 'low' : ''}`, this.tip);
      r.appendChild(iconEl(`need.${low[0]}`, 1));
      el('span', '', r, `${t(`need.${low[0]}`)} ${Math.round(low[1])}%`);
    }
    const r = anchor.getBoundingClientRect();
    const pr = this.root.getBoundingClientRect();
    this.tip.style.left = `${Math.round(r.left - pr.left)}px`;
    this.tip.style.top = `${Math.round(r.top - pr.top - 8)}px`;
    this.tip.classList.add('show');
  }

  private hideTip(): void {
    this.hoverId = -1;
    this.tip.classList.remove('show');
  }

  private updateQueue(p: PersonSnap): void {
    let status: string;
    if (p.collapsed) status = t('hud.collapsed');
    else if (p.sleeping) status = t('hud.sleeping');
    else if (p.action) {
      status = t(iaNameKey(p.action.interactionId));
      if (p.action.remaining > 0 && p.action.phase === 'perform') status += ` · ${t('hud2.queue.left', { m: Math.max(1, Math.round(p.action.remaining)) })}`;
    } else status = t('hud.idle');
    if (this.queueLabel.textContent !== status) this.queueLabel.textContent = status;
    const list = p.queue;
    const sig = `${p.id}|${p.action ? 1 : 0}|` + list.map((i) => `${i.id}:${i.interactionId}:${i.autonomous}:${i.targetUid}`).join(',');
    if (sig === this.queueSig) return;
    const prevIds = new Set(this.queueSig.split('|')[2]?.split(',').map((x) => x.split(':')[0]) ?? []);
    this.queueSig = sig;
    this.queueEl.textContent = '';
    // 위에서 아래로: 나중 일 … 지금 일 (맨 아래). 넘치면 +n
    const MAX = 3;
    const shown = list.slice(0, MAX);
    const extra = list.length - shown.length;
    if (extra > 0) el('div', 'q-more fl s', this.queueEl, `+${extra}`);
    [...shown].reverse().forEach((it) => {
      const idx = list.indexOf(it);
      const b = el('button', 'q-item', this.queueEl);
      b.type = 'button';
      b.dataset.queueId = String(it.id);
      b.dataset.interaction = it.interactionId;
      b.title = t(iaNameKey(it.interactionId));
      // 사회 상호작용은 targetUid 가 상대 인물 id
      const person = it.interactionId.startsWith('social.') ? this.lastSnap?.persons.find((q) => q.id === it.targetUid) : undefined;
      const face = person && person.id !== p.id ? this.h.portrait?.(person.id, 'head') : null;
      if (face) {
        face.className = 'q-face';
        b.appendChild(face);
        b.appendChild(iconEl(iconFor(it.interactionId), 1, 'q-sub'));
      } else b.appendChild(iconEl(iconFor(it.interactionId), 2));
      if (it.autonomous) b.classList.add('auto');
      if (idx === 0 && p.action) {
        b.classList.add('current');
        const bar = el('i', 'q-prog', b);
        bar.style.setProperty('--k', String(p.action.remaining > 0 ? 0.5 : 1));
      }
      if (!prevIds.has(String(it.id))) pop(b, 'enter');
      b.addEventListener('click', () => {
        b.classList.add('leave');
        this.h.cancel(p.id, it.id);
      });
    });
    if (!list.length) this.queueEl.classList.add('empty');
    else this.queueEl.classList.remove('empty');
  }

  private updateNotices(notices: Notice[], persons: PersonSnap[]): void {
    for (const n of notices) {
      const seq = n.seq ?? n.minute;
      if (seq <= this.seenSeq) continue;
      this.seenSeq = seq;
      if (SILENT.has(n.kind)) continue;
      if (n.minute < this.seenNotice) continue;
      this.seenNotice = n.minute;
      const who = persons.find((p) => p.id === n.personId)?.name ?? '';
      const args: Record<string, string | number> = { name: who, ...(n.args ?? {}) };
      for (const [k, v] of Object.entries(args)) if (typeof v === 'string' && k !== 'name' && has(v)) args[k] = t(v, n.args);
      const div = el('div', 'notice g', this.noticeEl);
      div.dataset.kind = n.kind;
      const danger = DANGER.has(n.kind);
      if (danger) div.classList.add('danger');
      div.appendChild(iconEl(danger ? 'need.warmth' : n.kind.includes('letter') ? 'cute.letter' : 'cute.exclaim', 2));
      const body = el('div', 'notice-body s', div);
      const title = has(`notice.${n.kind}.title`) ? t(`notice.${n.kind}.title`) : '';
      if (title) el('b', 'notice-title', body, title);
      el('div', 'notice-text', body, t(`notice.${n.kind}`, args));
      div.addEventListener('click', () => div.classList.add('fade'));
      setTimeout(() => div.classList.add('old'), 5000);
      setTimeout(() => div.classList.add('fade'), danger ? 11000 : 7000);
      setTimeout(() => div.remove(), danger ? 12000 : 8000);
      while (this.noticeEl.childElementCount > 4) this.noticeEl.firstElementChild?.remove();
    }
  }

  // ------------------------------------------------------------------ 팝업 (27-9)

  setPopup(k: HudPopup): void {
    this.popup = k;
    this.popSig = '';
    for (const [key, b] of this.quickBtns) b.classList.toggle('on', key === k);
    this.winBtns.get('menu')?.classList.toggle('on', k === 'menu');
    this.menuEl.classList.toggle('open', k === 'menu');
    const open = !!k && k !== 'menu';
    this.popEl.classList.toggle('open', open);
    this.popEl.dataset.pop = k ?? '';
    if (open) pop(this.popEl, 'opening');
    if (open && this.last && this.lastSnap) this.renderPopup(this.last, this.lastSnap);
  }

  get currentPopup(): HudPopup {
    return this.popup;
  }

  /** 예전 탭 이름 호환 (테스트 훅 setTab) */
  setTab(tab: string): void {
    const map: Record<string, HudPopup> = { needs: 'needs', mood: 'emo', relations: 'rel', wishes: 'wish' };
    if (tab in map) this.setPopup(map[tab]);
    else this.h.toggleBook?.(tab);
  }

  private renderPopup(p: PersonSnap, s: Snapshot): void {
    const k = this.popup;
    if (!k || k === 'menu') return;
    const inner = p.inner;
    const sig = `${k}|${p.id}|${k === 'needs' ? '' : JSON.stringify(inner?.moodlets.map((m) => [m.id, m.strength, Math.round(m.remainingMin / 30)]))}|${inner?.emotion}${inner?.stage}|${k === 'rel' ? s.relations.filter((r) => r.a === p.id || r.b === p.id).map((r) => `${r.a}${r.b}${Math.round(r.friendship)}${Math.round(r.romance)}${r.name}`).join() : ''}|${k === 'wish' ? JSON.stringify(inner?.wishes) + inner?.happiness + JSON.stringify(inner?.aspiration) : ''}`;
    if (k === 'needs') {
      if (this.popSig !== sig) {
        this.popSig = sig;
        this.buildNeeds(p);
      }
      for (const n of NEEDS) this.needRows.get(n)?.set(p.needs[n] ?? 0);
      return;
    }
    if (sig === this.popSig) return;
    this.popSig = sig;
    const keepScroll = this.popBody.querySelector<HTMLElement>('.scroll')?.scrollTop ?? 0;
    this.popBody.textContent = '';
    if (k === 'emo') this.buildEmo(p);
    else if (k === 'rel') this.buildRel(p, s);
    else if (k === 'wish') this.buildWish(p);
    const sc = this.popBody.querySelector<HTMLElement>('.scroll');
    if (sc) sc.scrollTop = keepScroll;
    this.syncScroll();
  }

  private syncScroll(): void {
    const sc = this.popBody.querySelector<HTMLElement>('.scroll');
    const thumb = this.popSb.firstElementChild as HTMLElement;
    if (!sc || sc.scrollHeight <= sc.clientHeight + 1) {
      this.popSb.classList.remove('show');
      return;
    }
    const pr = this.popEl.getBoundingClientRect();
    const r = sc.getBoundingClientRect();
    this.popSb.style.top = `${Math.round(r.top - pr.top)}px`;
    this.popSb.style.height = `${Math.round(r.height)}px`;
    const k = sc.clientHeight / sc.scrollHeight;
    thumb.style.height = `${Math.max(12, k * 100)}%`;
    thumb.style.top = `${(sc.scrollTop / sc.scrollHeight) * 100}%`;
    this.popSb.classList.add('show');
  }

  private buildNeeds(p: PersonSnap): void {
    this.popBody.textContent = '';
    this.needRows.clear();
    const head = el('div', 'pop-head', this.popBody);
    el('b', 'pop-title s', head, t('hud2.pop.needs', { name: p.name }));
    // 제목 줄 오른쪽: 무드렛 합 (하트 + 값)
    const sum = (p.inner?.moodlets ?? []).reduce((acc, m) => acc + (['sad', 'angry', 'tense', 'ashamed'].includes(m.emotion) ? -m.strength : m.strength), 0);
    const mood = el('span', `pop-mood s ${sum < 0 ? 'neg' : ''}`, head);
    mood.append(iconEl('cute.heart', 1), document.createTextNode(`${sum >= 0 ? '+' : '−'}${Math.abs(sum)}`));
    const grid = el('div', 'needs', this.popBody);
    for (const n of NEEDS) {
      const row = el('div', 'need s', grid);
      row.dataset.need = n;
      row.appendChild(iconEl(`need.${n}`, 2));
      el('span', 'need-label', row, t(`need.${n}`));
      const b = cbar(row);
      b.set(p.needs[n] ?? 0);
      this.needRows.set(n, b);
    }
  }

  private buildEmo(p: PersonSnap): void {
    const inner = p.inner;
    const defs = this.innerDefs();
    const emo = inner && inner.stage >= 1 ? inner.emotion : 'neutral';
    const color = this.h.emotionColor?.(emo) ?? '#9be08f';
    const head = el('div', 'emo-head', this.popBody);
    const ic = el('div', 'emo-icon', head);
    ic.style.setProperty('--glow', color);
    ic.appendChild(iconEl(`emo.${emo}`, 3));
    const name = el('b', 'emo-name fl', head, t(emo === 'neutral' ? 'emotion.neutral' : `emotion.${emo}.${['basic', 'strong', 'extreme'][(inner?.stage ?? 1) - 1]}`));
    name.style.color = mix(color, '#ffffff', 0.45);
    const steps = el('div', 'emo-steps', this.popBody);
    for (let i = 1; i <= 3; i++) {
      const d = el('i', i <= (inner?.stage ?? 0) ? 'on' : '', steps);
      d.style.setProperty('--c', color);
    }
    const list = el('div', 'scroll moodlets', this.popBody);
    list.addEventListener('scroll', () => this.syncScroll());
    const ms = [...(inner?.moodlets ?? [])].sort((a, b) => b.strength - a.strength);
    if (!ms.length) el('div', 'pop-empty', list).appendChild(iconEl('emo.neutral', 2));
    for (const m of ms) {
      const keys = defs?.moodletKeys(m.id);
      const row = el('div', 'moodlet row-g s', list);
      row.dataset.moodlet = m.id;
      row.appendChild(iconEl(defs?.moodletIcon(m.id) ?? `emo.${m.emotion}`, 2));
      el('b', 'moodlet-name', row, keys ? t(keys.name) : m.id);
      if (m.remainingMin >= 0) el('span', 'moodlet-time', row, m.remainingMin >= 60 ? t('panel.remaining.h', { n: Math.round(m.remainingMin / 60) }) : t('panel.remaining.m', { n: Math.max(1, Math.round(m.remainingMin)) }));
      const neg = ['sad', 'angry', 'tense', 'ashamed'].includes(m.emotion);
      const v = el('b', `moodlet-v ${neg ? 'neg' : 'pos'}`, row, `${neg ? '−' : '+'}${m.strength}`);
      v.title = keys ? t(keys.desc) : '';
      if (keys) row.title = t(keys.desc);
    }
  }

  private buildRel(p: PersonSnap, s: Snapshot): void {
    const filters = ['all', 'family', 'friend', 'neighbor', 'enemy'] as const;
    const cur = (this.popEl.dataset.filter as (typeof filters)[number]) || 'all';
    const chips = el('div', 'chips', this.popBody);
    for (const f of filters) {
      const c = el('button', `chip s ${f === cur ? 'on' : ''}`, chips, t(`hud2.rel.${f}`));
      c.type = 'button';
      c.addEventListener('click', () => {
        this.popEl.dataset.filter = f;
        this.popSig = '';
        if (this.last && this.lastSnap) this.renderPopup(this.last, this.lastSnap);
      });
    }
    const here = new Map(s.persons.map((q) => [q.id, q]));
    const away = new Map(s.away.map((a) => [a.id, a]));
    const other = (r: RelationSnap) => (r.a === p.id ? r.b : r.a);
    let mine = s.relations.filter((r) => r.a === p.id || r.b === p.id);
    const isFamily = (r: RelationSnap) => here.get(other(r))?.household === p.household;
    if (cur === 'family') mine = mine.filter(isFamily);
    else if (cur === 'friend') mine = mine.filter((r) => !isFamily(r) && r.friendship >= 30);
    else if (cur === 'neighbor') mine = mine.filter((r) => !isFamily(r) && r.friendship > -30 && r.friendship < 30);
    else if (cur === 'enemy') mine = mine.filter((r) => r.friendship <= -30);
    mine.sort((a, b) => Number(isFamily(b)) - Number(isFamily(a)) || b.friendship + b.romance - (a.friendship + a.romance));
    const list = el('div', 'scroll rels', this.popBody);
    list.addEventListener('scroll', () => this.syncScroll());
    if (!mine.length) el('div', 'pop-empty', list).appendChild(iconEl('cute.talk', 2));
    for (const r of mine) {
      const id = other(r);
      const q = here.get(id);
      const row = el('div', 'rel-row row-g s', list);
      row.dataset.other = String(id);
      const face = el('div', 'rel-face', row);
      face.style.setProperty('--glow', r.romance > 30 ? '#f080a8' : r.friendship < -30 ? '#f05a46' : '#6ec86e');
      const cv = this.h.portrait?.(id, 'head');
      if (cv) face.appendChild(cv);
      face.addEventListener('dblclick', () => this.h.focusPerson(id));
      const nm = el('div', 'rel-nm', row);
      el('b', '', nm, q?.name ?? away.get(id)?.name ?? s.town?.people.find((x) => x.id === id)?.name ?? '?');
      el('div', 'rel-kind', nm, t(`rel.${r.name}`));
      const bars = el('div', 'rel-bars', row);
      const fr = el('div', 'rel-bar', bars);
      fr.appendChild(iconEl('cute.talk', 1));
      cbar(fr).set(Math.abs(r.friendship), r.friendship < 0 ? 'red' : 'green');
      if (r.romance > 0.5 || ['lover', 'engaged', 'spouse'].includes(r.name)) {
        const ro = el('div', 'rel-bar', bars);
        ro.appendChild(iconEl('cute.heart', 1));
        cbar(ro).set(r.romance, 'blue');
      }
    }
    const foot = el('div', 'pop-foot', this.popBody);
    const more = el('button', 'ib-mini', foot);
    more.type = 'button';
    more.appendChild(iconEl('cute.book_blue', 2));
    more.addEventListener('click', () => {
      this.setPopup(null);
      this.h.toggleBook?.('relations');
    });
  }

  private buildWish(p: PersonSnap): void {
    const inner = p.inner;
    const defs = this.innerDefs();
    if (inner?.aspiration) {
      const a = defs?.aspiration(inner.aspiration.id);
      const head = el('div', 'asp', this.popBody);
      head.appendChild(iconEl('cute.trophy', 2));
      const body = el('div', 'asp-body', head);
      const tl = el('div', 'asp-title s', body);
      el('b', '', tl, a ? t(a.nameKey) : inner.aspiration.id);
      const n = a?.stages.length ?? 4;
      el('span', 'asp-n', tl, `${Math.min(n, inner.aspiration.stage)}/${n}`);
      cbar(body).set((inner.aspiration.stage / Math.max(1, n)) * 100, 'blue');
      const nx = a?.stages[inner.aspiration.stage];
      if (nx?.textKey) {
        const r = el('div', 'asp-next s', this.popBody);
        r.appendChild(iconEl('cute.right', 1));
        el('span', '', r, t(nx.textKey));
      }
    }
    const list = el('div', 'scroll wishes', this.popBody);
    list.addEventListener('scroll', () => this.syncScroll());
    const wishes = (inner?.wishes ?? []).filter((w) => w.kind === 'wish');
    if (!wishes.length) el('div', 'pop-empty', list).appendChild(iconEl('cute.trophy', 2));
    for (const w of wishes) {
      const d = defs?.wishDef(w.id);
      const row = el('div', 'wish row-g s', list);
      row.dataset.wish = w.id;
      row.appendChild(iconEl(d?.icon ?? 'emo.excited', 2));
      el('b', 'wish-text', row, d ? t(d.textKey) : w.id);
      // 이루면 받는 행복 점수 (목업: 별 + 수)
      const pts = (d as { points?: number } | null)?.points;
      if (pts) {
        const ps = el('span', 'wish-pts', row);
        ps.append(iconEl('cute.star', 1), document.createTextNode(String(pts)));
      }
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.lock')) return;
        pop(row, 'press');
        void this.h.wishHint?.(p.id, w.id);
      });
      const lock = el('button', `lock ${w.locked ? 'on' : ''}`, row);
      lock.type = 'button';
      lock.appendChild(pieceImg('book.mark0', 1));
      lock.title = w.locked ? t('panel.unlock') : t('panel.lock');
      lock.addEventListener('click', () => {
        pop(lock, 'press');
        this.h.lockWish?.(p.id, w.id, !w.locked);
      });
    }
    const foot = el('div', 'pop-foot s', this.popBody);
    const hp = el('span', 'hp', foot);
    hp.appendChild(iconEl('cute.star', 2));
    el('b', '', hp, Math.round(inner?.happiness ?? 0).toLocaleString('ko-KR'));
  }

  setHidden(hidden: boolean): void {
    this.root.style.display = hidden ? 'none' : '';
  }

  /** 건축/구매 중에는 인물 묶음·속도·자주 쓰는 창을 숨김 (27-10) */
  setMode(m: 'live' | 'buy' | 'build'): void {
    this.root.dataset.mode = m;
    if (m !== 'live') this.setPopup(null);
  }
}

function mix(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
  const [r1, g1, b1] = ch(pa);
  const [r2, g2, b2] = ch(pb);
  const f = (x: number, y: number) => Math.round(x + (y - x) * k);
  return `rgb(${f(r1, r2)},${f(g1, g2)},${f(b1, b2)})`;
}

/** interactions.json 의 nameKey 를 몰라도 되게: id → 'ia.xxx' 는 main 이 채워 줌 */
const nameKeys = new Map<string, string>();
const icons = new Map<string, string>();
export function registerInteractionMeta(id: string, nameKey: string, icon: string): void {
  nameKeys.set(id, nameKey);
  icons.set(id, icon);
}
export function iaNameKey(id: string): string {
  return nameKeys.get(id) ?? (id === '__goto' ? 'ia.goto' : 'reason.unknown');
}
export function iconFor(id: string): string {
  return icons.get(id) ?? (id === '__goto' ? 'goto' : 'ui.clock');
}
export { setIcon };

/** 파딩 → "1금 4은 3동 ½" (0 인 단위는 뺌) */
export function formatMoney(f: number): string {
  const neg = f < 0;
  let r = Math.abs(Math.round(f));
  const far = r % 4;
  r = (r - far) / 4;
  const d = r % 12;
  r = (r - d) / 12;
  const sh = r % 20;
  const lb = (r - sh) / 20;
  const parts: string[] = [];
  if (lb) parts.push(t('money.pound', { n: lb }));
  if (sh) parts.push(t('money.shilling', { n: sh }));
  if (d || (!lb && !sh && !far)) parts.push(t('money.penny', { n: d }));
  if (far) parts.push(['', '¼', '½', '¾'][far]);
  return (neg ? '−' : '') + parts.join(' ');
}
