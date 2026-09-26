/**
 * 첫 하루 튜토리얼 (GDD 27-4). 사용자가 요청해서 넣는 유일한 안내 글 (27-3 예외):
 * - 알림과 같은 둥근 반투명 카드 하나, 시계 아래. 한 번에 한 단계
 * - 조작은 키캡/마우스 아이콘 + 짧은 한 줄. 해낸 행동을 게임 상태에서 감지해 다음 단계로
 * - 건너뛰기 가능, 끝냈는지는 localStorage 에 (막혀 있으면 매번 처음부터), 메뉴 › 설정에서 다시 보기
 * 게임에 실제로 있는 조작만 씀 (HearthGame.bindInput, DirectControl, BuildController.key 에서 확인)
 */
import socialData from '../data/social.json';
import type { Snapshot } from '../sim/protocol';
import { t } from '../i18n';
import { iconEl, pieceImg } from './skin';

export interface TutorialProbe {
  selectedId(): number;
  snap(): Snapshot | null;
  pieOpen(): boolean;
  popup(): string | null;
  bookOpen(): boolean;
  buildMode(): string | undefined;
  dialogOpen(): boolean;
}

interface Step {
  id: string;
  icons: string[];
  /** 단계가 시작될 때 기준값 */
  begin?(): void;
  done(): boolean;
  /** 지금은 할 수 없는 단계 (혼자 사는 가족의 식구 바꾸기 …): 건너뜀 */
  skip?(): boolean;
}

const STORE = 'hk.tutorial.v1';
const SOCIAL = new Set(Object.keys((socialData as { interactions: Record<string, unknown> }).interactions));

export function tutorialDone(): boolean {
  try {
    return localStorage.getItem(STORE) === 'done';
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(STORE, 'done');
  } catch {
    /* 저장이 막힌 브라우저: 다음에도 보임 */
  }
}

export class Tutorial {
  readonly root: HTMLElement;
  private steps: Step[];
  private i = -1;
  private timer = 0;
  private advancing = false;
  private keys = new Map<string, number>();

  constructor(parent: HTMLElement, private p: TutorialProbe) {
    this.root = document.createElement('div');
    this.root.className = 'tut g';
    this.root.hidden = true;
    parent.appendChild(this.root);
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys.set(e.key.toLowerCase(), performance.now());
    }, true);

    let startSel = 0;
    let startSpeed = 1;
    let startSocial = '';
    const me = () => this.p.snap()?.persons.find((q) => q.id === this.p.selectedId());
    const socialSig = () => {
      const m = me();
      return m?.lastSocial ? `${m.lastSocial.minute}:${m.lastSocial.target}` : '';
    };
    const recent = (k: string, ms = 1500) => performance.now() - (this.keys.get(k) ?? -1e9) < ms;
    this.steps = [
      {
        id: 'select', icons: ['mouse.left', 'key.space'], begin: () => (startSel = this.p.selectedId()), done: () => this.p.selectedId() !== startSel,
        skip: () => (this.p.snap()?.persons.filter((q) => q.household === 1 && !q.visitor).length ?? 0) < 2,
      },
      { id: 'usable', icons: ['key.shift'], begin: () => this.keys.delete('shift'), done: () => recent('shift', 60_000) },
      { id: 'pie', icons: ['mouse.left'], done: () => this.p.pieOpen() },
      { id: 'needs', icons: ['cute.bolt'], done: () => this.p.popup() === 'needs' },
      { id: 'wish', icons: ['cute.trophy'], done: () => this.p.popup() === 'wish' },
      { id: 'speed', icons: ['key.2', 'key.3'], begin: () => (startSpeed = this.p.snap()?.speed ?? 1), done: () => (this.p.snap()?.speed ?? 0) > Math.max(1, startSpeed) },
      { id: 'move', icons: ['key.w', 'key.a', 'key.s', 'key.d'], begin: () => ['w', 'a', 's', 'd'].forEach((k) => this.keys.delete(k)), done: () => ['w', 'a', 's', 'd'].some((k) => recent(k, 60_000)) },
      { id: 'interact', icons: ['key.e'], begin: () => this.keys.delete('e'), done: () => this.p.pieOpen() && recent('e') },
      {
        id: 'talk', icons: ['mouse.left', 'cute.talk'], begin: () => (startSocial = socialSig()),
        done: () => {
          const m = me();
          if (!m) return false;
          if (this.p.dialogOpen() || socialSig() !== startSocial) return true;
          return !!(m.action && SOCIAL.has(m.action.interactionId)) || m.queue.some((q) => !q.autonomous && SOCIAL.has(q.interactionId));
        },
      },
      { id: 'book', icons: ['key.tab'], done: () => this.p.bookOpen() },
      { id: 'build', icons: ['key.b'], done: () => this.p.buildMode() === 'build' || this.p.buildMode() === 'buy' },
      { id: 'done', icons: ['cute.check'], done: () => false },
    ];
  }

  get active(): boolean {
    return this.i >= 0;
  }

  get stepId(): string | null {
    return this.i >= 0 ? this.steps[this.i].id : null;
  }

  start(): void {
    this.stop();
    this.go(0);
    this.timer = window.setInterval(() => this.tick(), 150);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = 0;
    this.i = -1;
    this.root.hidden = true;
  }

  skip(): void {
    remember();
    this.stop();
  }

  private go(i: number): void {
    while (i < this.steps.length - 1 && this.steps[i].skip?.()) i++;
    this.i = i;
    this.advancing = false;
    const s = this.steps[i];
    s.begin?.();
    const R = this.root;
    R.hidden = false;
    R.dataset.step = s.id;
    R.classList.remove('ok');
    R.textContent = '';
    const row = document.createElement('div');
    row.className = 'tut-row';
    const keys = document.createElement('span');
    keys.className = 'tut-keys';
    for (const k of s.icons) keys.appendChild(k.startsWith('key.') || k.startsWith('mouse.') ? pieceImg(k, 2) : iconEl(k, 2));
    row.appendChild(keys);
    const txt = document.createElement('span');
    txt.className = 'tut-text s';
    txt.textContent = t(`tut.${s.id}`);
    row.appendChild(txt);
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'ng-mini tut-skip';
    skip.title = t('tut.skip');
    skip.appendChild(iconEl('cute.x', 1));
    skip.addEventListener('click', () => this.skip());
    row.appendChild(skip);
    R.appendChild(row);
    const pips = document.createElement('div');
    pips.className = 'tut-pips';
    const n = this.steps.length - 1;
    for (let k = 0; k < n; k++) {
      const pip = document.createElement('i');
      if (k < i) pip.className = 'on';
      if (k === i) pip.className = 'cur';
      pips.appendChild(pip);
    }
    R.appendChild(pips);
    R.classList.remove('in');
    void R.offsetWidth;
    R.classList.add('in');
    if (s.id === 'done') {
      remember();
      window.setTimeout(() => {
        if (this.stepId === 'done') this.stop();
      }, 5000);
    }
  }

  private tick(): void {
    if (this.i < 0 || this.advancing) return;
    const s = this.steps[this.i];
    if (!s.done()) return;
    this.advancing = true;
    this.root.classList.add('ok');
    const chk = iconEl('cute.check', 2, 'tut-check');
    this.root.querySelector('.tut-keys')?.replaceChildren(chk);
    window.setTimeout(() => {
      if (this.i >= 0 && this.i < this.steps.length - 1) this.go(this.i + 1);
    }, 700);
  }
}
