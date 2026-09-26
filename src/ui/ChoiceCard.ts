/**
 * 선택 카드 (GDD 11-4 무너짐, M14 사건 카드의 첫 형태): 가운데에 뜨는 양피지 카드, 선택지 버튼.
 * 선택하지 않으면 sim 이 한 시간 뒤 스스로 고름.
 */
import { t } from '../i18n';
import { iconEl } from './skin';

export interface ChoiceOption {
  id: string;
  nameKey: string;
  descKey: string;
  icon: string;
}

export class ChoiceCard {
  readonly root: HTMLElement;
  private showing = '';
  private onPick: ((id: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'choice-wrap';
    this.root.dataset.testid = 'choice-card';
    parent.appendChild(this.root);
  }

  show(key: string, title: string, body: string, options: ChoiceOption[], onPick: (id: string) => void): void {
    if (this.showing === key) return;
    this.showing = key;
    this.onPick = onPick;
    this.root.textContent = '';
    const card = document.createElement('div');
    card.className = 'choice-card panel-cream';
    const h = document.createElement('div');
    h.className = 'choice-title';
    h.textContent = title;
    const b = document.createElement('div');
    b.className = 'choice-body';
    b.textContent = body;
    card.append(h, b);
    const opts = document.createElement('div');
    opts.className = 'choice-options';
    for (const o of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-option panel-brown';
      btn.dataset.option = o.id;
      btn.appendChild(iconEl(o.icon, 2));
      const tx = document.createElement('span');
      tx.className = 'choice-text';
      const n = document.createElement('b');
      n.textContent = t(o.nameKey);
      const d = document.createElement('small');
      d.textContent = t(o.descKey);
      tx.append(n, d);
      btn.appendChild(tx);
      btn.addEventListener('click', () => {
        this.hide();
        this.onPick?.(o.id);
      });
      opts.appendChild(btn);
    }
    card.appendChild(opts);
    const foot = document.createElement('div');
    foot.className = 'choice-foot';
    foot.textContent = t('breakdown.auto');
    card.appendChild(foot);
    this.root.appendChild(card);
    this.root.classList.add('open');
  }

  hide(): void {
    this.showing = '';
    this.root.classList.remove('open');
    this.root.textContent = '';
  }

  get open(): boolean {
    return this.showing !== '';
  }
}
