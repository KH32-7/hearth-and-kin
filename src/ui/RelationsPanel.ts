/**
 * 관계 탭 (GDD 14-1): 고른 사람이 아는 사람들 — 초상, 관계 이름, 우정/로맨스/존중 막대.
 * 아래에 마을 이웃 목록과 초대 단추 (초대 → 길 끝에서 걸어 들어옴).
 * 글자는 DOM (캔버스에 한글을 그리지 않음), 막대는 Raven 막대 틀 9-slice
 */
import type { PersonSnap, RelationSnap, Snapshot } from '../sim/protocol';
import { t } from '../i18n';
import { iconEl } from './skin';

export interface NeighborInfo {
  id: string;
  name: string;
  estate: string;
  sex: string;
  stage: string;
}

export interface RelationsHandlers {
  invite(personId: number, neighborId: string): void;
  sendHome(visitorId: number): void;
  portrait(id: number): HTMLCanvasElement | null;
  focusPerson(id: number): void;
}

const REL_COLOR: Record<string, string> = {
  stranger: '#8a8478', acquaintance: '#b9a88a', friend: '#6fae5c', best_friend: '#3f9a4a', rival: '#c7803d', enemy: '#b8433b',
  lover: '#d66a8f', engaged: '#d6508a', spouse: '#c9407a', ex_spouse: '#8d6f7f',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class RelationsPanel {
  private sig = '';

  constructor(private neighbors: NeighborInfo[], private h: RelationsHandlers) {}

  invalidate(): void {
    this.sig = '';
  }

  /** 관계 이름 색 (수첩 칸 빛) */
  static color(name: string): string {
    return REL_COLOR[name] ?? '#888';
  }

  portrait(id: number): HTMLCanvasElement | null {
    return this.h.portrait(id);
  }

  focusPerson(id: number): void {
    this.h.focusPerson(id);
  }

  render(root: HTMLElement, p: PersonSnap, s: Snapshot): void {
    const mine = s.relations.filter((r) => r.a === p.id || r.b === p.id);
    const here = new Map(s.persons.map((q) => [q.id, q]));
    const awayById = new Map(s.away.map((a) => [a.id, a]));
    const visiting = new Map(s.persons.filter((q) => q.visitor).map((q) => [q.visitor!.neighborId, q]));
    const sig = [
      p.id,
      mine.map((r) => `${r.a}.${r.b}.${Math.round(r.friendship)}.${Math.round(r.romance)}.${Math.round(r.respectAB)}.${Math.round(r.respectBA)}.${r.name}`).join(','),
      [...visiting.keys()].join(','), s.pendingVisits.join(','), s.away.length,
    ].join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    root.textContent = '';
    root.classList.add('rel-view');

    const other = (r: RelationSnap) => (r.a === p.id ? r.b : r.a);
    const family = mine.filter((r) => here.get(other(r))?.household === p.household);
    const known = mine.filter((r) => here.get(other(r))?.household !== p.household);
    // 우정 큰 순
    known.sort((x, y) => y.friendship - x.friendship);

    const section = (key: string) => el('div', 'rel-head', root).textContent = t(key);
    if (family.length) {
      section('ui.relations.family');
      for (const r of family) this.row(root, p, r, here.get(other(r))?.name ?? '', other(r));
    }
    section('ui.relations.known');
    if (!known.length) el('div', 'rel-empty', root).textContent = t('ui.relations.none');
    for (const r of known) {
      const id = other(r);
      const q = here.get(id);
      const name = q?.name ?? awayById.get(id)?.name ?? '?';
      const row = this.row(root, p, r, name, id);
      if (q?.visitor) el('span', 'rel-tag', row.querySelector('.rel-name')!).textContent = t('ui.visitor');
    }

    // 마을 이웃: 초대
    section('ui.relations.neighbors');
    const list = el('div', 'rel-neighbors', root);
    for (const nb of this.neighbors) {
      const item = el('div', 'rel-nb', list);
      el('span', 'rel-nb-name', item).textContent = nb.name;
      el('span', 'rel-nb-estate', item).textContent = t(`estate.${nb.estate}`);
      const v = visiting.get(nb.id);
      const b = el('button', 'rel-btn panel-brown', item);
      b.type = 'button';
      b.dataset.neighbor = nb.id;
      if (v) {
        b.textContent = t('ui.relations.send_home');
        b.dataset.action = 'send-home';
        b.addEventListener('click', () => this.h.sendHome(v.id));
      } else if (s.pendingVisits.includes(nb.id)) {
        b.textContent = t('ui.relations.invited');
        b.disabled = true;
      } else {
        b.textContent = t('ui.relations.invite');
        b.dataset.action = 'invite';
        b.addEventListener('click', () => this.h.invite(p.id, nb.id));
      }
    }
  }

  private row(root: HTMLElement, p: PersonSnap, r: RelationSnap, name: string, otherId: number): HTMLElement {
    const row = el('div', 'rel-row', root);
    row.dataset.other = String(otherId);
    const pf = el('div', 'rel-portrait', row);
    const cv = this.h.portrait(otherId);
    if (cv) pf.appendChild(cv);
    pf.addEventListener('dblclick', () => this.h.focusPerson(otherId));
    const body = el('div', 'rel-body', row);
    const top = el('div', 'rel-name', body);
    el('span', '', top).textContent = name;
    const chip = el('span', 'rel-chip', top);
    chip.textContent = t(`rel.${r.name}`);
    chip.style.setProperty('--rc', REL_COLOR[r.name] ?? '#888');
    if (r.memories > 0) chip.title = t('ui.relations.memories', { n: r.memories });

    // 우정: 가운데 0, 왼쪽 음수(붉음) / 오른쪽 양수(초록)
    this.bar(body, 'rel.axis.friendship', r.friendship, true, r.friendship >= 0 ? '#6fae5c' : '#b8433b', 'need.social');
    if (r.romance > 0.5 || ['lover', 'engaged', 'spouse'].includes(r.name)) this.bar(body, 'rel.axis.romance', r.romance, false, '#d66a8f', 'topic.love');
    // 존중: 내가 상대를 / 상대가 나를
    const mineR = r.a === p.id ? r.respectAB : r.respectBA;
    const theirs = r.a === p.id ? r.respectBA : r.respectAB;
    const rr = el('div', 'rel-respect', body);
    rr.appendChild(iconEl('ui.crest', 1));
    const a = el('span', 'rel-resp', rr);
    a.textContent = `${t('rel.axis.respect')} ${fmt(mineR)}`;
    const b = el('span', 'rel-resp', rr);
    b.textContent = `${t('rel.axis.respect_them')} ${fmt(theirs)}`;
    b.classList.toggle('neg', theirs < 0);
    return row;
  }

  private bar(parent: HTMLElement, key: string, v: number, centered: boolean, color: string, icon: string): void {
    const row = el('div', 'rel-bar-row', parent);
    row.title = `${t(key)} ${Math.round(v)}`;
    row.appendChild(iconEl(icon, 1));
    const bar = el('div', 'rel-bar bar', row);
    const fill = el('div', 'rel-fill', bar);
    fill.style.background = color;
    if (centered) {
      const w = Math.min(50, Math.abs(v) / 2);
      fill.style.left = v >= 0 ? '50%' : `${50 - w}%`;
      fill.style.width = `${w}%`;
      el('div', 'rel-zero', bar);
    } else {
      fill.style.left = '0';
      fill.style.width = `${Math.min(100, v)}%`;
    }
    el('span', 'rel-num', row).textContent = fmt(v);
  }
}

function fmt(v: number): string {
  const n = Math.round(v);
  return n > 0 ? `+${n}` : String(n);
}
