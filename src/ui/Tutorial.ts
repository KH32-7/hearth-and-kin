/**
 * 첫 하루 튜토리얼 (GDD 27-4). 사용자가 요청해서 넣는 유일한 안내 글 (27-3 예외):
 * - 알림과 같은 둥근 반투명 카드 하나(.g), 시계 아래. 한 번에 한 단계, 한 줄 + 키캡/마우스 아이콘 + 까딱이는 ▼
 * - 흐름: 기상 → 원형 메뉴 → 대기열 → 욕구 → (불 피우기) → 먹을 것 만들기 → 먹기 → 이웃과 대화 → 잠 → 하루 정산 → 신분별 첫 과제
 * - 조작 키(Space, Shift, WASD, E, 1·2·3, Tab, B)는 따로 묻지 않고 그 단계에 필요한 순간 옆에 키캡으로
 * - 완료는 스냅샷에서 감지 (판정은 tutorialFlow.ts 순수 함수). 새 게임 직후엔 멈춘 채 가장 → 집을 비추고 ▼ 로 시작
 * - 처음 마주칠 때 한 번: 건축/구매, 사건 카드, 임신, 재판, 우리 소문, 편지 (본 것은 localStorage)
 * - 건너뛰기 가능, 끝냈는지는 localStorage (막혀 있으면 매번 처음부터), 메뉴 › 설정에서 다시 보기
 * - state()/restore(): 저장 파일에 넣을 진행 상태
 */
import type { Snapshot } from '../sim/protocol';
import { t } from '../i18n';
import { formatMoney } from './Hud';
import { hasIcon, iconEl, pieceImg } from './skin';
import {
  ActTracker, beginGoal, beginOnce, beginStep, daySummary, family, FIRST_DAY, goalDone, goalOf, grownUps, homeObjects, kindOf, onceHits, parseState, pickCook, pickGoal, skipStep, stepDone,
  type CookPlan, type Env, type Goal, type GoalBase, type HomeRect, type OnceBase, type OnceId, type StepBase, type StepId, type TutorialState, type UiView,
} from './tutorialFlow';

export interface TutorialProbe {
  selectedId(): number;
  snap(): Snapshot | null;
  pieOpen(): boolean;
  popup(): string | null;
  bookOpen(): boolean;
  buildMode(): string | undefined;
  dialogOpen(): boolean;
  /** 장면 카드(사건·재판)가 떠 있나: 떠 있으면 튜토리얼 카드를 잠시 숨김 */
  choiceOpen(): boolean;
  cancels(): number;
  setSpeed(s: number): void;
  focusPerson(id: number): void;
  glideTo(x: number, y: number): void;
  homeRect(): [number, number, number, number] | null;
  objectDef(defId: string): { kind?: string; tags?: string[]; price?: number } | undefined;
}

const STORE = 'hk.tutorial.v2';
const SEEN = 'hk.tutorial.v2.seen';

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* 저장이 막힌 브라우저: 다음에도 보임 */
  }
}

export function tutorialDone(): boolean {
  return load(STORE) === 'done';
}

function seenOnce(): Set<string> {
  try {
    const a = JSON.parse(load(SEEN) ?? '[]');
    return new Set(Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** 단계마다 보여 줄 조작 아이콘 (주) 과 곁들인 키캡 (필요한 순간의 조작) */
interface Look {
  icons: string[];
  tips?: string[];
  /** ▼ 로 넘기는 단계 */
  confirm?: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const keyIcon = (k: string, scale = 2) => (k.startsWith('key.') || k.startsWith('mouse.') ? pieceImg(k, scale) : iconEl(hasIcon(k) ? k : 'cute.star', scale));

export class Tutorial {
  readonly root: HTMLElement;
  /** 처음 마주칠 때 한 번 카드 */
  readonly once: HTMLElement;
  private timer = 0;
  private i = -1;
  private advancing = false;
  private base: StepBase | null = null;
  private acts = new ActTracker();
  private cook: CookPlan | null = null;
  private goal: Goal | null = null;
  private goalBase: GoalBase | null = null;
  private startDay = 0;
  private done: StepId[] = [];
  private lastToday: { income: Record<string, number>; expense: Record<string, number> } | null = null;
  private resumeSpeed = 1;
  /** 정산을 띄우며 멈췄나 */
  private sumPaused = false;
  private watching = false;
  private onceBase: OnceBase | null = null;
  private onceQueue: OnceId[] = [];
  private onceShown: OnceId | null = null;
  private onceTimer = 0;
  private introTimer = 0;
  /** 첫 화면 카메라 이동이 끝나 카드가 보여도 되는가 */
  private introReady = true;

  constructor(parent: HTMLElement, private p: TutorialProbe) {
    const stack = el('div', 'tut-stack', parent);
    this.root = el('div', 'tut g', stack);
    this.root.hidden = true;
    this.root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.tut-skip')) return;
      this.confirm();
    });
    this.once = el('div', 'tut tut-once g', stack);
    this.once.hidden = true;
    this.once.addEventListener('click', () => this.closeOnce());
    // E2E · 저장 확인용
    (window as unknown as Record<string, unknown>).__tutorial = {
      state: () => this.state(),
      step: () => this.stepId,
      /** 지금 이 집에서 고를 요리와 첫 과제 (QA) */
      plan: () => {
        const s = this.p.snap();
        const me = s?.persons.find((q) => q.id === this.p.selectedId());
        const defOf = (d: string) => this.p.objectDef(d);
        return s ? { cook: pickCook(s, this.home(), defOf, (k) => me?.skills?.[k]?.[0] ?? 0), goal: pickGoal(s, this.home(), defOf).kind } : null;
      },
    };
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || this.p.dialogOpen() || this.p.choiceOpen()) return;
      if (this.i >= 0 && this.look(this.stepId!).confirm && !this.root.hidden) {
        this.confirm();
        e.preventDefault();
      }
    });
  }

  get active(): boolean {
    return this.i >= 0;
  }

  get stepId(): StepId | null {
    return this.i >= 0 ? FIRST_DAY[this.i] : null;
  }

  // ------------------------------------------------------------------ 시작 · 멈춤

  /** 처음 마주칠 때 카드 감시 (튜토리얼을 끝냈거나 건너뛰어도 계속) */
  watch(): void {
    this.watching = true;
    const s = this.p.snap();
    this.onceBase = s ? beginOnce(s) : null;
    this.ensureTimer();
  }

  /** 새 게임 직후: 멈춘 채 가장 → 집을 비추고 첫 카드. ▼ 로 1배속 */
  start(intro = true): void {
    this.stopFlow();
    const s = this.p.snap();
    this.startDay = s?.day ?? 0;
    this.done = [];
    this.goal = null;
    this.goalBase = null;
    this.lastToday = null;
    this.acts = new ActTracker();
    this.watching = true;
    if (!this.onceBase && s) this.onceBase = beginOnce(s);
    if (intro) this.intro();
    this.go(0);
    this.ensureTimer();
  }

  /** 모두 멈춤 (타이틀로) */
  stop(): void {
    this.stopFlow();
    this.watching = false;
    clearInterval(this.timer);
    this.timer = 0;
    this.closeOnce(false);
  }

  /** 건너뛰기: 첫 하루 흐름만 끝냄 (처음 마주치는 카드는 계속) */
  skip(): void {
    save(STORE, 'done');
    const paused = (this.stepId === 'wake' || this.stepId === 'summary') && this.p.snap()?.speed === 0;
    this.stopFlow();
    if (paused) this.p.setSpeed(this.resumeSpeed || 1);
  }

  private stopFlow(): void {
    clearTimeout(this.introTimer);
    this.introReady = true;
    this.i = -1;
    this.base = null;
    this.root.hidden = true;
  }

  private ensureTimer(): void {
    if (!this.timer) this.timer = window.setInterval(() => this.tick(), 150);
  }

  /** 가장 → 집 (짧게). 그동안 카드는 숨김 */
  private intro(): void {
    const s = this.p.snap();
    if (!s) return;
    const head = s.persons.find((q) => q.id === this.p.selectedId()) ?? family(s)[0];
    const home = this.home();
    this.introReady = false;
    if (head) this.p.focusPerson(head.id);
    this.introTimer = window.setTimeout(() => {
      if (home) this.p.glideTo((home[0] + home[2] + 1) / 2, (home[1] + home[3] + 1) / 2);
      this.introTimer = window.setTimeout(() => {
        this.introReady = true;
        if (this.stepId) this.render();
      }, home ? 1100 : 0);
    }, 1200);
  }

  /** 우리 집 부지. 마을인데 부지가 없으면 (사제관 …) 가장 둘레 */
  private home(): HomeRect {
    const r = this.p.homeRect();
    if (r) return r;
    const s = this.p.snap();
    if (!s?.town) return null;
    const head = family(s).find((q) => q.id === this.p.selectedId()) ?? family(s)[0];
    if (!head) return null;
    const x = Math.round(head.x);
    const y = Math.round(head.y);
    return [x - 7, y - 7, x + 7, y + 7];
  }

  // ------------------------------------------------------------------ 저장

  state(): unknown {
    const st: TutorialState = { v: 2, step: this.stepId, startDay: this.startDay, goal: this.goal?.kind ?? null, done: [...this.done] };
    return st;
  }

  /** 저장 파일에서 되살림. 진행 중이던 단계가 없으면(끝냈거나 없음) 처음 마주치는 카드 감시만 */
  restore(x: unknown): void {
    const st = parseState(x);
    this.stopFlow();
    if (!st) {
      this.watch();
      return;
    }
    this.startDay = st.startDay;
    this.done = st.done;
    this.goal = st.goal ? goalOf(st.goal) : null;
    this.goalBase = null;
    this.acts = new ActTracker();
    this.watching = true;
    const s = this.p.snap();
    if (s) this.onceBase = beginOnce(s);
    if (st.step) this.go(FIRST_DAY.indexOf(st.step), false);
    this.ensureTimer();
  }

  // ------------------------------------------------------------------ 단계

  private ui(): UiView {
    return {
      selectedId: this.p.selectedId(), pieOpen: this.p.pieOpen(), popup: this.p.popup(), bookOpen: this.p.bookOpen(),
      buildMode: this.p.buildMode(), dialogOpen: this.p.dialogOpen(), cancels: this.p.cancels(),
    };
  }

  private env(): Env {
    return { home: this.home(), defOf: (d) => this.p.objectDef(d), cook: this.cook };
  }

  private look(id: StepId): Look {
    const s = this.p.snap();
    const many = s ? grownUps(s).length >= 2 : false;
    const noBed = s ? !homeObjects(s, this.home()).some((o) => /bed/.test(kindOf(o.defId, (d) => this.p.objectDef(d)))) : false;
    switch (id) {
      case 'wake': return { icons: ['cute.star'], confirm: true };
      case 'pie': return { icons: ['mouse.left'], tips: ['key.shift', 'key.e'] };
      case 'queue': return { icons: ['mouse.left', 'ui.cancel'] };
      case 'needs': return { icons: ['cute.bolt'], tips: many ? ['key.space'] : [] };
      case 'kitchen': return { icons: ['key.b', 'fire'], tips: ['mouse.left'] };
      case 'fire': return { icons: ['mouse.left', 'fire'], tips: ['key.w', 'key.a', 'key.s', 'key.d', 'key.e'] };
      case 'cook': return { icons: ['mouse.left', this.cook?.kind === 'bread' ? 'bread' : 'stew'], tips: ['key.w', 'key.a', 'key.s', 'key.d', 'key.e'] };
      case 'eat': return { icons: ['mouse.left', 'need.hunger'], tips: many ? ['key.space'] : [] };
      case 'talk': return { icons: ['mouse.left', 'cute.talk'] };
      case 'sleep': return { icons: ['mouse.left', 'sleep'], tips: noBed ? ['key.2', 'key.3', 'key.b'] : ['key.2', 'key.3'] };
      case 'summary': return { icons: ['cute.moon'], tips: ['key.3'], confirm: true };
      case 'goal': return { icons: this.goal ? [...this.goal.keys, this.goal.icon] : ['cute.trophy'] };
      case 'done': return { icons: ['cute.check'], tips: ['key.tab', 'key.b'] };
    }
  }

  private text(id: StepId): string {
    const s = this.p.snap();
    if (id === 'wake') {
      const head = s?.persons.find((q) => q.id === this.p.selectedId()) ?? (s ? family(s)[0] : undefined);
      return t('tut.wake', { name: head?.name ?? '' });
    }
    if (id === 'cook' && this.cook) return t(`tut.cook.${this.cook.kind}`, { dish: this.cook.nameKey });
    if (id === 'goal' && this.goal) return t(this.goal.key);
    return t(`tut.${id}`);
  }

  private go(i: number, fresh = true): void {
    const s = this.p.snap();
    if (!s) return;
    // 먹을 것 만들기: 그 집에서 지금 되는 요리를 불 피우기/요리 단계에 들어갈 때 다시 고름
    if (i <= FIRST_DAY.indexOf('cook') || (!this.cook && !fresh)) {
      const me = s.persons.find((q) => q.id === this.p.selectedId());
      this.cook = pickCook(s, this.home(), (d) => this.p.objectDef(d), (k) => me?.skills?.[k]?.[0] ?? 0);
    }
    // 밤이 지나 첫 자정을 넘겼으면 첫 하루 단계는 정산으로
    const sumIdx = FIRST_DAY.indexOf('summary');
    if (i < sumIdx && s.day > this.startDay) i = sumIdx;
    while (i < FIRST_DAY.length - 1 && skipStep(FIRST_DAY[i], s, this.env())) i++;
    this.i = i;
    this.advancing = false;
    this.sumPaused = false;
    this.base = beginStep(s, this.ui());
    this.acts.reset();
    const id = FIRST_DAY[i];
    if (id === 'goal') {
      this.goal ??= pickGoal(s, this.home(), (d) => this.p.objectDef(d));
      this.goalBase = beginGoal(s, this.home(), (d) => this.p.objectDef(d));
    }
    if (id === 'done') {
      save(STORE, 'done');
      window.setTimeout(() => {
        if (this.stepId === 'done') this.stopFlow();
      }, 6000);
    }
    this.render();
  }

  /** ▼ (카드 클릭 · Enter) */
  private confirm(): void {
    const id = this.stepId;
    if (!id || !this.base || !this.look(id).confirm || this.advancing) return;
    if (id === 'summary' && !this.summaryReady()) return;
    this.base.confirmed = true;
    if (id === 'wake' || id === 'summary') this.p.setSpeed(this.resumeSpeed || 1);
    this.tick();
  }

  private summaryReady(): boolean {
    return (this.p.snap()?.day ?? 0) > this.startDay;
  }

  // ------------------------------------------------------------------ 그리기

  private render(): void {
    const id = this.stepId;
    const R = this.root;
    if (!id || !this.introReady) {
      R.hidden = true;
      return;
    }
    R.hidden = false;
    R.dataset.step = id;
    R.classList.remove('ok', 'sum', 'wait');
    R.textContent = '';
    const lk = this.look(id);
    if (id === 'summary' && this.summaryReady()) {
      this.renderSummary();
    } else {
      if (id === 'summary') R.classList.add('wait');
      const row = el('div', 'tut-row', R);
      const keys = el('span', 'tut-keys', row);
      for (const k of lk.icons) keys.appendChild(keyIcon(k));
      el('span', 'tut-text s', row, id === 'summary' ? t('tut.night') : this.text(id));
      this.skipBtn(row);
      if (lk.tips?.length) {
        const tips = el('div', 'tut-tips', R);
        for (const k of lk.tips) tips.appendChild(keyIcon(k, 1));
      }
    }
    if (lk.confirm && (id !== 'summary' || this.summaryReady())) el('i', 'tut-next', R);
    R.classList.toggle('confirm', !!lk.confirm);
    const pips = el('div', 'tut-pips', R);
    const shown = FIRST_DAY.filter((x) => x !== 'done');
    shown.forEach((_x, k) => {
      const pip = el('i', '', pips);
      if (k < this.i) pip.className = 'on';
      if (k === this.i) pip.className = 'cur';
    });
    R.classList.remove('in');
    void R.offsetWidth;
    R.classList.add('in');
  }

  private skipBtn(row: HTMLElement): void {
    const skip = el('button', 'ng-mini tut-skip', row);
    skip.type = 'button';
    skip.title = t('tut.skip');
    skip.appendChild(iconEl('cute.x', 1));
    skip.addEventListener('click', () => this.skip());
  }

  /** 하루 정산: 번 돈 · 쓴 돈, 식구 기분, 이룬 것, 내일 할 일 */
  private renderSummary(): void {
    const s = this.p.snap();
    if (!s) return;
    const R = this.root;
    R.classList.add('sum');
    this.goal ??= pickGoal(s, this.home(), (d) => this.p.objectDef(d));
    const d = daySummary(s, this.startDay, this.lastToday, this.done.length);
    const head = el('div', 'tut-row', R);
    head.appendChild(iconEl('cute.moon', 2));
    el('b', 'tut-text s', head, t('tut.summary', { day: this.startDay + 1 }));
    this.skipBtn(head);
    const money = el('div', 'tut-sum-row', R);
    const cell = (icon: string, text: string, cls = '') => {
      const c = el('span', `tut-sum-cell ${cls}`.trim(), money);
      c.appendChild(iconEl(icon, 2));
      el('b', 's', c, text);
      return c;
    };
    cell('cute.coins', `+${formatMoney(d.income)}`, 'good').title = t('tut.sum.income');
    cell('rv.pouch', `−${formatMoney(d.expense)}`, 'bad').title = t('tut.sum.expense');
    cell('cute.trophy', String(d.achieved)).title = t('tut.sum.done');
    const moods = el('div', 'tut-sum-row moods', R);
    for (const m of d.moods) {
      const c = el('span', 'tut-sum-cell', moods);
      c.appendChild(iconEl(hasIcon(`emo.${m.emotion}`) ? `emo.${m.emotion}` : 'emo.neutral', 2));
      el('span', 's', c, m.name);
    }
    if (this.goal) {
      el('div', 'tut-sum-label s', R, t('tut.tomorrow'));
      const g = el('div', 'tut-row tut-goal', R);
      const keys = el('span', 'tut-keys', g);
      keys.appendChild(keyIcon(this.goal.icon));
      el('span', 'tut-text s', g, t(this.goal.key));
      g.dataset.goal = this.goal.kind;
    }
  }

  // ------------------------------------------------------------------ 처음 마주치는 것

  private checkOnce(s: Snapshot): void {
    if (!this.onceBase) this.onceBase = beginOnce(s);
    const seen = seenOnce();
    for (const id of onceHits(s, this.ui(), this.onceBase)) {
      if (seen.has(id) || this.onceQueue.includes(id) || this.onceShown === id) continue;
      this.onceQueue.push(id);
    }
    if (!this.onceShown && this.onceQueue.length) this.showOnce(this.onceQueue.shift()!);
  }

  private showOnce(id: OnceId): void {
    this.onceShown = id;
    const seen = seenOnce();
    seen.add(id);
    save(SEEN, JSON.stringify([...seen]));
    const O = this.once;
    O.textContent = '';
    O.hidden = false;
    O.dataset.once = id;
    const icons: Record<OnceId, string[]> = {
      build: ['mouse.left', 'mouse.right', 'key.esc'],
      card: ['cute.question'],
      pregnancy: ['cute.heart'],
      trial: ['ui.crest'],
      rumor: ['cute.talk'],
      letter: ['cute.letter_new'],
    };
    const row = el('div', 'tut-row', O);
    const keys = el('span', 'tut-keys', row);
    for (const k of icons[id]) keys.appendChild(keyIcon(k));
    el('span', 'tut-text s', row, t(`tut.once.${id}`));
    el('i', 'tut-next', O);
    O.classList.remove('in');
    void O.offsetWidth;
    O.classList.add('in');
    clearTimeout(this.onceTimer);
    this.onceTimer = window.setTimeout(() => this.closeOnce(), 9000);
  }

  private closeOnce(next = true): void {
    clearTimeout(this.onceTimer);
    this.onceShown = null;
    this.once.hidden = true;
    if (!next) this.onceQueue = [];
  }

  // ------------------------------------------------------------------ 매 틱

  private tick(): void {
    const s = this.p.snap();
    if (!s) return;
    if (this.watching) this.checkOnce(s);
    // 장면 카드가 떠 있으면 튜토리얼 카드는 잠시 숨김
    const hide = this.p.choiceOpen();
    this.root.classList.toggle('behind', hide);
    this.once.classList.toggle('behind', hide && this.onceShown !== 'card' && this.onceShown !== 'trial');
    if (this.i < 0 || this.advancing || !this.base) return;
    const id = FIRST_DAY[this.i];
    this.acts.update(s);
    if (s.day === this.startDay && s.econ) this.lastToday = { income: { ...s.econ.today.income }, expense: { ...s.econ.today.expense } };
    // 첫 자정: 아직 첫 하루 단계면 정산으로
    const sumIdx = FIRST_DAY.indexOf('summary');
    if (this.i < sumIdx && s.day > this.startDay) {
      this.go(sumIdx);
      return;
    }
    if (id === 'summary') {
      const ready = this.summaryReady();
      if (ready && !this.sumPaused) {
        // 정산을 띄우는 동안 멈춤
        this.sumPaused = true;
        this.resumeSpeed = s.speed > 0 ? s.speed : this.resumeSpeed || 1;
        if (s.speed > 0) this.p.setSpeed(0);
        this.render();
        return;
      }
      if (!ready && !this.root.classList.contains('wait') && this.introReady) this.render();
    }
    let ok: boolean;
    if (id === 'goal') ok = !!this.goal && !!this.goalBase && goalDone(this.goal, s, this.goalBase, this.acts, this.home(), (d) => this.p.objectDef(d));
    else if (id === 'done') ok = false;
    else ok = stepDone(id, s, this.ui(), this.base, this.acts, this.env(), this.startDay);
    if (!ok) return;
    this.advancing = true;
    if (!this.done.includes(id) && id !== 'wake' && id !== 'summary') this.done.push(id);
    this.root.classList.add('ok');
    this.root.querySelector('.tut-keys')?.replaceChildren(iconEl('cute.check', 2, 'tut-check'));
    const next = this.i + 1;
    const quick = id === 'wake' || id === 'summary';
    window.setTimeout(() => {
      if (this.i >= 0 && this.i < FIRST_DAY.length - 1) this.go(next);
    }, quick ? 150 : 700);
  }
}

