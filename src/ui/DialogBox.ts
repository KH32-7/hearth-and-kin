/**
 * 대사창 (GDD 27-13). 픽셀 몸짓으로 다 못 보여 주는 동작과 말을 화면 아래 가운데 창에 지문 + 대사로.
 * - 한마디: 작은 창, 4초, 시간 흐름 (식구가 뛰어와 알림, 투정 …)
 * - 대화: 조작 인물이 하는 사회 상호작용. 두 사람 상반신, 최대 2왕복. ▼(클릭/Enter)로 넘김, 끝나면 사라짐
 * - 장면(선택지)은 ChoiceCard (양피지 판)
 * 판은 HUD 와 같은 반투명 + 밝은 외곽선, 세계는 살짝 어둡게 (장면보다 옅게).
 * 문장은 표시 전용: 게임 판정에 쓰지 않음 (25-1). 창에 나온 대화는 수첩 › 기록 › 대화에 남음.
 */
import { t } from '../i18n';
import { iconEl } from './skin';

export type DialogSetting = 'off' | 'scene' | 'talk' | 'all';

export interface DialogLine {
  /** 지문 (이미 한국어로 채운 문장) */
  act?: string;
  who: string;
  text: string;
  color?: string;
}

interface Page {
  lines: DialogLine[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export class DialogBox {
  readonly root: HTMLElement;
  private box: HTMLElement;
  private pages: Page[] = [];
  private idx = 0;
  private timer = 0;
  private kind: 'talk' | 'one' | null = null;
  readonly log: Array<{ minute: number; who: string; text: string; act?: string }> = [];
  setting: DialogSetting = 'talk';
  /** 대사창이 열리면 두 사람이 창 위로 오게 카메라를 옮김 */
  onOpen: ((ids: number[]) => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'dlg-wrap', parent);
    this.root.dataset.testid = 'dialog';
    el('div', 'dlg-shade', this.root);
    this.box = el('div', 'dlg g', this.root);
    this.box.addEventListener('click', () => this.next());
    window.addEventListener('keydown', (e) => {
      if (!this.kind) return;
      if (e.key === 'Enter') {
        this.next();
        e.preventDefault();
      } else if (e.key === 'Escape') this.close();
    });
  }

  get open(): boolean {
    return this.kind !== null;
  }

  /** 대화 (두 사람). speaker 가 먼저 말하고 listener 가 받음 */
  talk(o: {
    minute: number; ids: number[]; ok: boolean; category: string;
    speaker: { name: string; color: string; bust: HTMLCanvasElement | null };
    listener: { name: string; color: string; bust: HTMLCanvasElement | null };
    act?: string; say: string; reply?: string;
  }): void {
    if (this.setting === 'off' || this.setting === 'scene') return;
    const pages: Page[] = [{ lines: [{ act: o.act, who: o.speaker.name, text: o.say, color: o.speaker.color }] }];
    if (o.reply) pages.push({ lines: [{ who: o.listener.name, text: o.reply, color: o.listener.color }] });
    this.kind = 'talk';
    this.pages = pages;
    this.idx = 0;
    this.box.className = 'dlg g talk';
    this.box.textContent = '';
    const left = el('div', 'dlg-bust l', this.box);
    left.style.setProperty('--glow', o.speaker.color);
    if (o.speaker.bust) left.appendChild(o.speaker.bust);
    const right = el('div', 'dlg-bust r', this.box);
    right.style.setProperty('--glow', o.listener.color);
    if (o.listener.bust) right.appendChild(o.listener.bust);
    el('div', 'dlg-body', this.box);
    const foot = el('div', 'dlg-foot', this.box);
    const res = el('span', 'dlg-result', foot);
    const good = o.ok && o.category !== 'mean';
    res.append(iconEl(good ? (o.category === 'romance' ? 'cute.heart' : 'cute.star') : 'cute.bolt', 1), iconEl(good ? 'cute.up_green' : 'cute.down', 1));
    el('i', 'dlg-next', this.box);
    for (const pg of pages) for (const l of pg.lines) this.log.push({ minute: o.minute, who: l.who, text: l.text, act: l.act });
    while (this.log.length > 200) this.log.shift();
    this.show();
    this.onOpen?.(o.ids);
  }

  /** 한마디 (식구 한 사람) */
  oneliner(o: { minute: number; ids: number[]; name: string; color: string; head: HTMLCanvasElement | null; act?: string; text: string }): void {
    if (this.setting !== 'all' && this.setting !== 'talk') return;
    if (this.kind === 'talk') return; // 대화를 끊지 않음
    this.kind = 'one';
    this.pages = [{ lines: [{ act: o.act, who: o.name, text: o.text, color: o.color }] }];
    this.idx = 0;
    this.box.className = 'dlg g one';
    this.box.textContent = '';
    const face = el('div', 'dlg-head', this.box);
    face.style.setProperty('--glow', o.color);
    if (o.head) face.appendChild(o.head);
    el('div', 'dlg-body', this.box);
    // 남은 시간 막대: 바탕 줄은 그대로, 안쪽 금색만 줄어듦 (목업)
    el('b', '', el('i', 'dlg-time', this.box));
    this.log.push({ minute: o.minute, who: o.name, text: o.text, act: o.act });
    this.show();
  }

  private show(): void {
    this.root.classList.add('open');
    this.root.dataset.kind = this.kind ?? '';
    this.box.classList.remove('in');
    void this.box.offsetWidth;
    this.box.classList.add('in');
    this.renderPage();
  }

  private renderPage(): void {
    const body = this.box.querySelector<HTMLElement>('.dlg-body');
    if (!body) return;
    const pg = this.pages[this.idx];
    // 바로 전 대사 한 줄은 흐리게 남김
    const prev = this.idx > 0 ? this.pages[this.idx - 1].lines.at(-1) : null;
    body.textContent = '';
    if (prev) {
      const pr = el('div', 'dlg-prev s', body);
      el('b', '', pr, `${prev.who} `);
      pr.append(prev.text);
    }
    for (const l of pg.lines) {
      if (l.act) el('div', 'dlg-act s', body, l.act);
      const nm = el('b', 'dlg-name s', body, l.who);
      nm.style.color = l.color ?? '';
      const tx = el('div', 'dlg-text s', body);
      this.type(tx, l.text);
    }
    this.box.querySelector('.dlg-bust.l')?.classList.toggle('speaking', this.idx === 0);
    this.box.querySelector('.dlg-bust.r')?.classList.toggle('speaking', this.idx > 0);
    this.box.classList.toggle('last', this.idx >= this.pages.length - 1);
    clearTimeout(this.timer);
    const ms = this.kind === 'one' ? 4000 : 6500;
    const bar = this.box.querySelector<HTMLElement>('.dlg-time b');
    if (bar) {
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = `dlgTime ${ms}ms linear forwards`;
    }
    this.timer = window.setTimeout(() => this.next(), ms);
  }

  /** 글자가 한 자씩 (게임필: 말하는 느낌). 누르면 바로 다 나옴 */
  private typing = 0;
  private type(target: HTMLElement, text: string): void {
    const chars = [...text];
    let i = 0;
    target.textContent = '';
    target.dataset.full = text;
    clearInterval(this.typing);
    this.typing = window.setInterval(() => {
      i += 2;
      target.textContent = chars.slice(0, i).join('');
      if (i >= chars.length) clearInterval(this.typing);
    }, 30);
  }

  next(): void {
    if (!this.kind) return;
    // 글이 다 안 나왔으면 먼저 다 보여 줌
    const tx = this.box.querySelector<HTMLElement>('.dlg-text');
    if (tx && tx.dataset.full && tx.textContent !== tx.dataset.full) {
      clearInterval(this.typing);
      tx.textContent = tx.dataset.full;
      return;
    }
    if (this.idx < this.pages.length - 1) {
      this.idx++;
      this.renderPage();
      return;
    }
    this.close();
  }

  close(): void {
    clearTimeout(this.timer);
    clearInterval(this.typing);
    if (!this.kind) return;
    this.kind = null;
    this.box.classList.add('out');
    this.root.classList.remove('open');
    setTimeout(() => {
      if (!this.kind) this.box.textContent = '';
      this.box.classList.remove('out');
    }, 180);
    this.onClose?.();
  }

  /** 이름 표 (i18n 이 없으면 빈 문자열) */
  static fill(key: string | undefined, args: Record<string, string>): string | undefined {
    if (!key) return undefined;
    const s = t(key, args);
    return s === key ? undefined : s;
  }
}
