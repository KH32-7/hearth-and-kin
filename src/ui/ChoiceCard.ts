/**
 * 장면 카드 (GDD 27-13 "장면", 24장 사건 카드 · 11-4 무너짐): 차단 장면의 선택지.
 * 직접 찍은 양피지 판(panel.scene) + 휘어진 리본 제목 + 초상 바느질 칸 + 선택지 카드(card.choice).
 * 모든 조각 3배 정수 배율. 조작 안내 글 없이 오른쪽 위 일시정지 아이콘만 (27-3).
 * 선택하지 않으면 sim 이 한 시간 뒤 스스로 고름.
 */
import { t } from '../i18n';
import { iconEl, pieceImg, stitchCard } from './skin';

export interface ChoiceOption {
  id: string;
  nameKey: string;
  descKey: string;
  icon: string;
  /** 유리한 조건 아이콘 (예: 하트 ▲). 글 없이 */
  hint?: string[];
}

export interface SceneOpts {
  portrait?: HTMLCanvasElement | null;
  other?: HTMLCanvasElement | null;
  /** 지문 (동작 묘사) */
  act?: string;
  /** 말하는 사람 이름 */
  speaker?: string;
}

export class ChoiceCard {
  readonly root: HTMLElement;
  private showing = '';
  private onPick: ((id: string) => void) | null = null;
  private sel = 0;
  private opts: HTMLButtonElement[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'choice-wrap';
    this.root.dataset.testid = 'choice-card';
    parent.appendChild(this.root);
    window.addEventListener('keydown', (e) => {
      if (!this.open || !this.opts.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        this.select((this.sel + (e.key === 'ArrowDown' ? 1 : -1) + this.opts.length) % this.opts.length);
        e.preventDefault();
      } else if (e.key === 'Enter') {
        this.opts[this.sel]?.click();
        e.preventDefault();
      }
    });
  }

  show(key: string, title: string, body: string, options: ChoiceOption[], onPick: (id: string) => void, o: SceneOpts = {}): void {
    if (this.showing === key) return;
    this.showing = key;
    this.onPick = onPick;
    this.root.textContent = '';
    const card = document.createElement('div');
    card.className = 'choice-card scene';
    const rib = document.createElement('div');
    rib.className = 'scene-ribbon';
    rib.appendChild(pieceImg('ribbon.curve', 3));
    const h = document.createElement('b');
    h.className = 'choice-title';
    h.textContent = title;
    rib.appendChild(h);
    card.appendChild(rib);
    const pause = pieceImg('cbtn.pause', 2, 'scene-pause');
    pause.title = t('breakdown.auto');
    card.appendChild(pause);
    const frame = (cv: HTMLCanvasElement | null | undefined, side: 'l' | 'r') => {
      const f = document.createElement('div');
      f.className = `scene-face ${side}`;
      f.style.backgroundImage = `url(${stitchCard(40, 40)})`;
      if (cv) {
        cv.className = 'scene-face-img';
        f.appendChild(cv);
      }
      card.appendChild(f);
    };
    frame(o.portrait, 'l');
    if (o.other) frame(o.other, 'r');
    else card.classList.add('solo');
    const mid = document.createElement('div');
    mid.className = 'scene-mid';
    if (o.act) {
      const a = document.createElement('div');
      a.className = 'scene-act';
      a.textContent = o.act;
      mid.appendChild(a);
    }
    if (o.speaker) {
      const n = document.createElement('b');
      n.className = 'scene-name';
      n.textContent = o.speaker;
      mid.appendChild(n);
    }
    const b = document.createElement('div');
    b.className = 'choice-body';
    b.textContent = body;
    mid.appendChild(b);
    const opts = document.createElement('div');
    opts.className = 'choice-options';
    this.opts = [];
    options.forEach((op, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-option';
      btn.dataset.option = op.id;
      btn.appendChild(iconEl(op.icon, 2));
      const tx = document.createElement('span');
      tx.className = 'choice-text';
      const n = document.createElement('b');
      n.textContent = t(op.nameKey);
      tx.append(n);
      if (op.descKey) {
        const d = document.createElement('small');
        d.textContent = t(op.descKey);
        tx.append(d);
      }
      btn.appendChild(tx);
      if (op.hint?.length) {
        const hi = document.createElement('span');
        hi.className = 'choice-hint';
        for (const k of op.hint) hi.appendChild(iconEl(k, 2));
        btn.appendChild(hi);
      }
      btn.addEventListener('pointerenter', () => this.select(i));
      btn.addEventListener('click', () => {
        btn.classList.add('picked');
        setTimeout(() => {
          this.hide();
          this.onPick?.(op.id);
        }, 120);
      });
      opts.appendChild(btn);
      this.opts.push(btn);
    });
    mid.appendChild(opts);
    card.appendChild(mid);
    this.root.appendChild(card);
    this.root.classList.add('open');
    this.select(0);
  }

  private select(i: number): void {
    this.sel = i;
    this.opts.forEach((b, k) => b.classList.toggle('on', k === i));
  }

  hide(): void {
    this.showing = '';
    this.opts = [];
    this.root.classList.remove('open');
    this.root.textContent = '';
  }

  get open(): boolean {
    return this.showing !== '';
  }
}
