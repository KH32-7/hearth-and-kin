/**
 * 속마음 말풍선 (GDD 11-5): 머리 위에 짧은 문장이 3~4초 떠 있음. 한글은 캔버스가 아니라 DOM (BRIEF 7장).
 * 풍선 바탕은 UI 아틀라스 bubble.thought (9-slice). 사람을 따라 움직이고, 한 사람에게 하나씩.
 */
import type { Notice } from '../sim/sim';
import { t } from '../i18n';

interface Live {
  el: HTMLElement;
  personId: number;
  until: number;
}

const SHOW_MS = 3600;
const FADE_MS = 400;

export class ThoughtBubbles {
  readonly root: HTMLElement;
  private live = new Map<number, Live>();
  private seen = new Set<string>();
  enabled = true;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'thoughts';
    parent.appendChild(this.root);
  }

  /** 스냅샷 알림 중 새 속마음을 띄움 */
  ingest(notices: Notice[], now: number): void {
    for (const n of notices) {
      if (n.kind !== 'thought' || !n.args?.key) continue;
      const k = `${n.minute}:${n.personId}:${n.args.key}`;
      if (this.seen.has(k)) continue;
      this.seen.add(k);
      if (this.seen.size > 400) this.seen = new Set([...this.seen].slice(-200));
      if (!this.enabled) continue;
      this.show(n.personId, t(String(n.args.key)), now);
    }
  }

  show(personId: number, text: string, now: number): void {
    let l = this.live.get(personId);
    if (!l) {
      const el = document.createElement('div');
      el.className = 'thought';
      el.dataset.personId = String(personId);
      this.root.appendChild(el);
      l = { el, personId, until: 0 };
      this.live.set(personId, l);
    }
    l.el.textContent = text;
    l.el.classList.remove('fade');
    // 다시 튀어나오는 연출
    l.el.classList.remove('pop');
    void l.el.offsetWidth;
    l.el.classList.add('pop');
    l.until = now + SHOW_MS;
  }

  /** 매 프레임: 머리 위 화면 좌표로 옮기고 시간이 지나면 흐려짐 */
  update(now: number, head: (id: number) => { x: number; y: number } | null, hidden: (id: number) => boolean): void {
    for (const [id, l] of this.live) {
      const h = head(id);
      if (!h || hidden(id) || now > l.until + FADE_MS) {
        l.el.remove();
        this.live.delete(id);
        continue;
      }
      if (now > l.until) l.el.classList.add('fade');
      l.el.style.left = `${Math.round(h.x)}px`;
      l.el.style.top = `${Math.round(h.y)}px`;
    }
  }

  texts(): Array<{ personId: number; text: string }> {
    return [...this.live.values()].map((l) => ({ personId: l.personId, text: l.el.textContent ?? '' }));
  }
}
