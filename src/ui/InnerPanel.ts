/**
 * 내면 패널 (GDD 11~12, 27): 기분(무드렛) / 성격(특성, 덕·죄, 호불호, 마음의 짐) / 소원(소원·걱정·인생 목표·행복 포인트·보상 성격).
 * 숫자 대신 아이콘, 세기 점, 막대로 보여 줌. 설명은 마우스를 올리면 뜸.
 */
import type { InnerSnap, PersonSnap } from '../sim/protocol';
import { t } from '../i18n';
import { iconEl } from './skin';

export interface InnerDefs {
  moodletIcon(id: string): string | null;
  moodletKeys(id: string): { name: string; desc: string } | null;
  traitIcon(id: string): string;
  wishDef(id: string): { textKey: string; icon?: string } | null;
  aspiration(id: string): { nameKey: string; stages: { textKey?: string }[] } | null;
  rewards(): Array<{ id: string; nameKey: string; descKey: string; icon: string; cost: number; kind?: string }>;
  emotionColor(id: string): string;
}

export interface InnerHandlers {
  lockWish(personId: number, wish: string, locked: boolean): void;
  buyReward(personId: number, reward: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

function remaining(min: number): string {
  if (min < 0) return t('panel.remaining.while');
  if (min >= 60) return t('panel.remaining.h', { n: Math.round(min / 60) });
  return t('panel.remaining.m', { n: Math.max(1, Math.round(min)) });
}

export class InnerPanel {
  private sig = '';

  constructor(readonly defs: InnerDefs, private h: InnerHandlers) {}

  /** tab: mood | persona | wishes */
  render(root: HTMLElement, tab: string, p: PersonSnap): void {
    const inner = p.inner;
    if (!inner) {
      root.textContent = '';
      return;
    }
    // 바뀐 게 없으면 다시 그리지 않음 (남은 시간은 10분 단위로만)
    const sig = `${tab}|${p.id}|${JSON.stringify(inner.moodlets.map((m) => [m.id, m.strength, Math.round(m.remainingMin / 10)]))}|${inner.stress.toFixed(0)}|${JSON.stringify(inner.wishes)}|${inner.happiness}|${JSON.stringify(inner.aspiration)}|${inner.traits.join()}`;
    if (sig === this.sig) return;
    this.sig = sig;
    root.textContent = '';
    if (tab === 'mood') this.mood(root, inner);
    else if (tab === 'persona') this.persona(root, inner);
    else if (tab === 'wishes') this.wishes(root, p.id, inner);
  }

  invalidate(): void {
    this.sig = '';
  }

  /** 수첩 › 인물 › 소원 쪽 (책 부품으로 그림)에서 쓰는 동작 */
  lockWish(personId: number, wish: string, locked: boolean): void {
    this.h.lockWish(personId, wish, locked);
  }

  buyReward(personId: number, reward: string): void {
    this.h.buyReward(personId, reward);
  }

  private mood(root: HTMLElement, s: InnerSnap): void {
    const list = el('div', 'moodlets', root);
    const sorted = [...s.moodlets].sort((a, b) => b.strength - a.strength);
    if (!sorted.length) el('div', 'empty', list, t('panel.none'));
    for (const m of sorted) {
      const keys = this.defs.moodletKeys(m.id);
      const row = el('div', 'moodlet', list);
      row.dataset.moodlet = m.id;
      row.style.setProperty('--emo', this.defs.emotionColor(m.emotion));
      row.appendChild(iconEl(this.defs.moodletIcon(m.id) ?? `emo.${m.emotion}`, 2));
      const txt = el('div', 'moodlet-text', row);
      el('div', 'moodlet-name', txt, keys ? t(keys.name) : m.id);
      el('div', 'moodlet-time', txt, remaining(m.remainingMin));
      const dots = el('div', 'dots', row);
      for (let i = 0; i < 3; i++) el('i', i < m.strength ? 'on' : '', dots);
      if (keys) row.title = t(keys.desc);
    }
  }

  private persona(root: HTMLElement, s: InnerSnap): void {
    const traits = el('div', 'chips', root);
    for (const tr of s.traits) {
      const c = el('div', 'chip', traits);
      c.dataset.trait = tr;
      c.appendChild(iconEl(this.defs.traitIcon(tr), 2));
      el('span', '', c, t(`trait.${tr}`));
      c.title = t(`trait.${tr}.desc`);
    }
    const vs = el('div', 'vs', root);
    const v = el('div', 'chip virtue', vs);
    el('span', 'label', v, t('panel.virtue'));
    el('span', '', v, s.virtue ? t(`virtue.${s.virtue}`) : t('panel.none'));
    if (s.virtue) v.title = t(`virtue.${s.virtue}.desc`);
    const sn = el('div', 'chip sin', vs);
    el('span', 'label', sn, t('panel.sin'));
    el('span', '', sn, s.sin ? t(`sin.${s.sin}`) : t('panel.none'));
    if (s.sin) sn.title = t(`sin.${s.sin}.desc`);
    const likes = el('div', 'likes', root);
    const row = (label: string, items: string[], cls: string) => {
      const r = el('div', `like-row ${cls}`, likes);
      el('span', 'label', r, label);
      el('span', '', r, items.map((k) => t(`like.${k}`)).join(' · ') || t('panel.none'));
    };
    row(t('panel.likes'), s.likes, 'good');
    row(t('panel.dislikes'), s.dislikes, 'bad');
    const st = el('div', 'stress', root);
    el('span', 'label', st, t('panel.stress'));
    const bar = el('div', 'bar', st);
    const fill = el('div', 'bar-fill', bar);
    fill.style.width = `${Math.round(s.stress)}%`;
    fill.dataset.level = s.stress >= 70 ? 'crit' : s.stress >= 40 ? 'low' : 'good';
    el('div', 'memories', root, t('panel.memories', { n: s.memories }));
  }

  private wishes(root: HTMLElement, personId: number, s: InnerSnap): void {
    const hp = el('div', 'happiness', root);
    hp.appendChild(iconEl('ui.coin', 2));
    el('span', '', hp, t('panel.happiness', { n: Math.round(s.happiness) }));
    const block = (title: string, kind: 'wish' | 'fear') => {
      const b = el('div', `wish-block ${kind}`, root);
      el('div', 'panel-title', b, title);
      const items = s.wishes.filter((w) => w.kind === kind);
      if (!items.length) el('div', 'empty', b, t('panel.none'));
      for (const w of items) {
        const d = this.defs.wishDef(w.id);
        const r = el('div', 'wish', b);
        r.dataset.wish = w.id;
        r.appendChild(iconEl(d?.icon ?? (kind === 'wish' ? 'emo.excited' : 'emo.tense'), 2));
        el('span', 'wish-text', r, d ? t(d.textKey) : w.id);
        if (kind === 'wish') {
          const lock = el('button', `lock ${w.locked ? 'on' : ''}`, r, w.locked ? '●' : '○');
          lock.type = 'button';
          lock.title = w.locked ? t('panel.unlock') : t('panel.lock');
          lock.addEventListener('click', () => this.h.lockWish(personId, w.id, !w.locked));
        }
      }
    };
    block(t('panel.wishes.title'), 'wish');
    block(t('panel.fears.title'), 'fear');
    if (s.aspiration) {
      const a = this.defs.aspiration(s.aspiration.id);
      const b = el('div', 'aspiration', root);
      el('div', 'panel-title', b, `${t('panel.aspiration')} · ${a ? t(a.nameKey) : s.aspiration.id}`);
      const steps = el('div', 'steps', b);
      (a?.stages ?? []).forEach((st, i) => {
        const step = el('div', `step ${i < s.aspiration!.stage ? 'done' : i === s.aspiration!.stage ? 'now' : ''}`, steps);
        step.textContent = st.textKey ? t(st.textKey) : t('panel.stage', { n: i + 1 });
      });
    }
    const shop = el('details', 'rewards', root);
    el('summary', '', shop, t('panel.rewards'));
    for (const r of this.defs.rewards().filter((x) => x.kind !== 'aspiration').slice(0, 20)) {
      const row = el('div', 'reward', shop);
      row.appendChild(iconEl(r.icon, 2));
      const tx = el('span', 'reward-name', row, t(r.nameKey));
      tx.title = t(r.descKey);
      const btn = el('button', 'buy', row, `${r.cost}`);
      btn.type = 'button';
      btn.disabled = s.happiness < r.cost;
      btn.title = t('panel.buy');
      btn.addEventListener('click', () => this.h.buyReward(personId, r.id));
    }
  }
}
