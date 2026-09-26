/**
 * HUD (DOM). 캔버스에 한글을 그리지 않음 (BRIEF 7장).
 * - 왼쪽 위: 가족 초상 줄 (Space / Shift+Space 로 전환)
 * - 왼쪽 위 아래: 대기열 (지금 하는 일 + 대기, 클릭으로 취소)
 * - 왼쪽 아래: 욕구 8
 * - 오른쪽 아래: 시계, 날짜/계절, 바깥/체감 온도, 속도 버튼
 * - 오른쪽 위: 살림(재고), 알림
 */
import type { Notice } from '../sim/sim';
import type { PersonSnap, Snapshot } from '../sim/protocol';
import { has, t } from '../i18n';
import { iconEl, setIcon } from './skin';
import type { InnerPanel } from './InnerPanel';
import type { RelationsPanel } from './RelationsPanel';
import type { WorkPanel } from './WorkPanel';

export interface HudHandlers {
  selectPerson(id: number): void;
  setSpeed(speed: number): void;
  cancel(personId: number, queueItemId: number): void;
  focusPerson(id: number): void;
  emotionColor?(emotion: string): string;
}

const NEEDS = ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social', 'warmth', 'comfort'] as const;
const STOCK = ['firewood', 'water', 'ingredients', 'flour', 'bread', 'ale', 'preserves', 'herbs', 'yarn'] as const;
const TABS = ['needs', 'mood', 'persona', 'wishes', 'relations', 'work'] as const;
/** 글자 알림 대신 머리 위 연출로 보여 주는 알림 */
const SILENT = new Set(['thought', 'social_result']);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class Hud {
  readonly root: HTMLElement;
  private family: HTMLElement;
  private queueEl: HTMLElement;
  private needsEl: HTMLElement;
  private needBars = new Map<string, { fill: HTMLElement; row: HTMLElement }>();
  private clockTime: HTMLElement;
  private clockDay: HTMLElement;
  private clockTemp: HTMLElement;
  private clockFelt: HTMLElement;
  private dial: HTMLElement;
  private speedBtns: HTMLButtonElement[] = [];
  private autoAccelEl: HTMLElement;
  private stockEl: HTMLElement;
  private stockVals = new Map<string, HTMLElement>();
  private noticeEl: HTMLElement;
  private moneyEl!: HTMLElement;
  private moneyVal!: HTMLElement;
  private seenNotice = -1;
  private personLabel: HTMLElement;
  private actionLabel: HTMLElement;
  private queueSig = '';
  private familySig = '';
  private emotionLabel!: HTMLElement;
  private tab: (typeof TABS)[number] = 'needs';
  private tabBtns = new Map<string, HTMLButtonElement>();
  private innerEl!: HTMLElement;
  private last: PersonSnap | null = null;
  inner: InnerPanel | null = null;
  relations: RelationsPanel | null = null;
  work: WorkPanel | null = null;
  /** 돈 칸을 누르면 (가계부) */
  onMoney: (() => void) | null = null;
  private lastSnap: Snapshot | null = null;
  private seenSeq = -1;

  constructor(parent: HTMLElement, private h: HudHandlers) {
    this.root = el('div', 'hud', parent);
    this.root.id = 'hud';

    // 가족 + 대기열
    const tl = el('div', 'hud-tl', this.root);
    this.family = el('div', 'family panel-dark', tl);
    const qwrap = el('div', 'queue-wrap panel-brown', tl);
    this.personLabel = el('div', 'person-name', qwrap);
    this.emotionLabel = el('div', 'emotion-label', qwrap);
    this.actionLabel = el('div', 'action-label', qwrap);
    this.queueEl = el('div', 'queue', qwrap);
    this.queueEl.dataset.testid = 'queue';

    // 욕구 / 기분 / 성격 / 소원 (탭)
    const bl = el('div', 'hud-bl panel-brown', this.root);
    const tabs = el('div', 'tabs', bl);
    for (const tb of TABS) {
      const b = el('button', 'tab', tabs);
      b.type = 'button';
      b.dataset.tab = tb;
      b.textContent = t(tb === 'relations' ? 'ui.tab.relations' : tb === 'work' ? 'ui.tab.work' : `panel.${tb}`);
      b.addEventListener('click', () => this.setTab(tb));
      this.tabBtns.set(tb, b);
    }
    this.needsEl = el('div', 'needs', bl);
    this.innerEl = el('div', 'inner-view', bl);
    this.setTab('needs');
    for (const n of NEEDS) {
      const row = el('div', 'need', this.needsEl);
      row.dataset.need = n;
      row.appendChild(iconEl(`need.${n}`, 2));
      el('span', 'need-label', row).textContent = t(`need.${n}`);
      const bar = el('div', 'bar', row);
      const fill = el('div', 'bar-fill', bar);
      this.needBars.set(n, { fill, row });
    }

    // 시계
    const br = el('div', 'hud-br panel-dark', this.root);
    br.dataset.testid = 'clock';
    this.dial = el('div', 'dial', br);
    const txt = el('div', 'clock-text', br);
    this.clockTime = el('div', 'clock-time', txt);
    this.clockDay = el('div', 'clock-day', txt);
    const temps = el('div', 'clock-temps', txt);
    this.clockTemp = el('span', '', temps);
    this.clockFelt = el('span', '', temps);
    const speeds = el('div', 'speeds', br);
    for (let s = 0; s <= 3; s++) {
      const b = el('button', 'speed-btn', speeds);
      b.type = 'button';
      b.dataset.speed = String(s);
      b.title = t(`hud.speed.${s}`);
      b.setAttribute('aria-label', t(`hud.speed.${s}`));
      b.innerHTML = s === 0 ? '<i class="glyph-pause"></i>' : '<i class="glyph-play"></i>'.repeat(s);
      b.addEventListener('click', () => this.h.setSpeed(s));
      this.speedBtns.push(b);
    }
    this.autoAccelEl = el('div', 'auto-accel', br);
    this.autoAccelEl.textContent = t('hud.autoAccel');

    // 살림
    const tr = el('div', 'hud-tr', this.root);
    this.stockEl = el('div', 'stock panel-brown', tr);
    // 돈 (M4): 금화/은화/동화 (내부 파딩)
    this.moneyEl = el('div', 'stock-item money', this.stockEl);
    this.moneyEl.dataset.testid = 'money';
    this.moneyEl.appendChild(iconEl('ui.coin', 2));
    this.moneyVal = el('span', 'stock-n money-n', this.moneyEl);
    this.moneyEl.style.display = 'none';
    this.moneyEl.style.cursor = 'pointer';
    this.moneyEl.addEventListener('click', () => this.onMoney?.());
    for (const k of STOCK) {
      const it = el('div', 'stock-item', this.stockEl);
      it.title = t(`item.${k}`);
      it.appendChild(iconEl(`item.${k}`, 2));
      this.stockVals.set(k, el('span', 'stock-n', it));
    }
    this.noticeEl = el('div', 'notices', tr);

    el('div', 'help', this.root).textContent = t('hud.help');
  }

  update(s: Snapshot, selectedId: number): void {
    this.lastSnap = s;
    const p = s.persons.find((q) => q.id === selectedId) ?? s.persons[0];
    // 초상 줄은 식구만 (손님은 사람을 눌러 사회 메뉴로)
    this.updateFamily(s.persons.filter((q) => q.household === (p?.household ?? 1)), p?.id ?? -1);
    if (p) {
      this.last = p;
      this.updateNeeds(p);
      this.renderTab(p, s);
      this.updateEmotion(p);
      this.updateQueue(p);
      this.clockFelt.textContent = t('hud.felt', { t: Math.round(p.feltC) });
    }
    const h = Math.floor(s.minuteOfDay / 60);
    const m = s.minuteOfDay % 60;
    this.clockTime.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    this.clockDay.textContent = `${t(`hud.season.${s.season}`)} · ${t('hud.day', { d: s.day + 1 })}`;
    this.clockTemp.textContent = t('hud.outside', { t: Math.round(s.outsideC) });
    // 낮밤 원판: 하루 한 바퀴 (정오가 위)
    // 바늘(위)이 지금 시각. 낮(노랑) 반원의 가운데가 정오가 되도록 돌림
    this.dial.style.setProperty('--turn', `${(720 - s.minuteOfDay) / 4 - 90}deg`);
    for (const b of this.speedBtns) b.classList.toggle('on', Number(b.dataset.speed) === s.speed);
    this.autoAccelEl.classList.toggle('show', s.autoAccel && s.speed > 0);
    for (const [k, v] of this.stockVals) v.textContent = String(s.stock[k] ?? 0);
    if (s.econ) {
      this.moneyEl.style.display = '';
      const txt = formatMoney(s.econ.money);
      if (this.moneyVal.textContent !== txt) {
        // 돈이 바뀌면 잠깐 반짝 (오르면 초록, 내리면 붉게)
        const prev = Number(this.moneyEl.dataset.v ?? s.econ.money);
        this.moneyEl.classList.remove('up', 'down');
        void this.moneyEl.offsetWidth;
        if (s.econ.money !== prev) this.moneyEl.classList.add(s.econ.money > prev ? 'up' : 'down');
        this.moneyEl.dataset.v = String(s.econ.money);
        this.moneyVal.textContent = txt;
        this.moneyEl.title = t('hud.money.title', { debt: formatMoney(s.econ.debt) });
      }
    }
    this.updateNotices(s.notices, s.persons);
  }

  setTab(tb: (typeof TABS)[number]): void {
    this.tab = tb;
    for (const [k, b] of this.tabBtns) b.classList.toggle('on', k === tb);
    this.needsEl.style.display = tb === 'needs' ? '' : 'none';
    this.innerEl.style.display = tb === 'needs' ? 'none' : '';
    this.inner?.invalidate();
    this.relations?.invalidate();
    this.work?.invalidate();
    this.innerEl.classList.remove('rel-view', 'work-view');
    this.innerEl.textContent = '';
    if (this.last && this.lastSnap) this.renderTab(this.last, this.lastSnap);
  }

  private renderTab(p: PersonSnap, s: Snapshot): void {
    if (this.tab === 'needs') return;
    if (this.tab === 'relations') this.relations?.render(this.innerEl, p, s);
    else if (this.tab === 'work') this.work?.render(this.innerEl, p, s);
    else this.inner?.render(this.innerEl, this.tab, p);
  }

  private updateFamily(persons: PersonSnap[], sel: number): void {
    const sig = persons.map((p) => `${p.id}:${p.name}`).join('|') + `#${sel}`;
    if (sig !== this.familySig) {
      this.familySig = sig;
      this.family.textContent = '';
      for (const p of persons) {
        const b = el('button', 'member', this.family);
        b.type = 'button';
        b.dataset.personId = String(p.id);
        b.classList.toggle('on', p.id === sel);
        const ic = iconEl('emo.neutral', 1, 'member-emo');
        b.appendChild(ic);
        el('span', 'member-name', b).textContent = p.name;
        b.addEventListener('click', () => this.h.selectPerson(p.id));
        b.addEventListener('dblclick', () => this.h.focusPerson(p.id));
      }
    }
    // 감정: 테두리 색 + 작은 아이콘 (GDD 11-3 초상화 테두리 색)
    for (const p of persons) {
      const b = this.family.querySelector<HTMLElement>(`[data-person-id="${p.id}"]`);
      if (!b || !p.inner) continue;
      const emo = p.inner.stage >= 1 ? p.inner.emotion : 'neutral';
      if (b.dataset.emo === emo) continue;
      b.dataset.emo = emo;
      b.style.setProperty('--emo', this.h.emotionColor?.(emo) ?? '#888');
      const ic = b.querySelector<HTMLElement>('.member-emo');
      if (ic) setIcon(ic, `emo.${emo}`, 1);
    }
  }

  private updateEmotion(p: PersonSnap): void {
    const inner = p.inner;
    if (!inner) {
      this.emotionLabel.textContent = '';
      return;
    }
    const emo = inner.stage >= 1 ? inner.emotion : 'neutral';
    const key = emo === 'neutral' ? 'emotion.neutral' : `emotion.${emo}.${['basic', 'strong', 'extreme'][inner.stage - 1]}`;
    const text = t(key);
    if (this.emotionLabel.dataset.key === key) return;
    this.emotionLabel.dataset.key = key;
    this.emotionLabel.textContent = '';
    this.emotionLabel.appendChild(iconEl(`emo.${emo}`, 2));
    const s = el('span', '', this.emotionLabel);
    s.textContent = text;
    this.emotionLabel.style.setProperty('--emo', this.h.emotionColor?.(emo) ?? '#888');
  }

  private updateNeeds(p: PersonSnap): void {
    for (const [n, { fill, row }] of this.needBars) {
      const v = Math.max(0, Math.min(100, p.needs[n] ?? 0));
      fill.style.width = `${v}%`;
      const level = v < 15 ? 'crit' : v < 35 ? 'low' : v < 65 ? 'mid' : 'good';
      if (fill.dataset.level !== level) fill.dataset.level = level;
      row.dataset.value = v.toFixed(0);
      row.title = `${t(`need.${n}`)} ${v.toFixed(0)}`;
    }
  }

  private updateQueue(p: PersonSnap): void {
    this.personLabel.textContent = p.name;
    let status: string;
    if (p.collapsed) status = t('hud.collapsed');
    else if (p.sleeping) status = t('hud.sleeping');
    else if (p.action) status = t(iaNameKey(p.action.interactionId));
    else status = t('hud.idle');
    this.actionLabel.textContent = status;
    // 지금 하는 일은 queue[0] 에 남아 있음 (sim 규칙)
    const list = p.queue;
    const sig = `${p.id}|${p.action ? 1 : 0}|` + list.map((i) => `${i.id}:${i.interactionId}:${i.autonomous}`).join(',');
    if (sig === this.queueSig) return;
    this.queueSig = sig;
    this.queueEl.textContent = '';
    list.forEach((it, idx) => {
      const b = el('button', 'q-item', this.queueEl);
      b.type = 'button';
      b.dataset.queueId = String(it.id);
      b.dataset.interaction = it.interactionId;
      b.title = `${t(iaNameKey(it.interactionId))} · ${t('hud.queue.cancel')}`;
      b.appendChild(iconEl(iconFor(it.interactionId), 2));
      if (it.autonomous) b.classList.add('auto');
      if (idx === 0 && p.action) b.classList.add('current');
      b.addEventListener('click', () => this.h.cancel(p.id, it.id));
    });
    if (!list.length) {
      const e = el('div', 'q-empty', this.queueEl);
      e.textContent = t('hud.queue.empty');
    }
  }

  private updateNotices(notices: Notice[], persons: PersonSnap[]): void {
    for (const n of notices) {
      // 순번(seq)으로 새 알림 판단 (같은 분에 둘 이상 나와도 놓치지 않게)
      const seq = n.seq ?? n.minute;
      if (seq <= this.seenSeq) continue;
      this.seenSeq = seq;
      if (SILENT.has(n.kind)) continue;
      if (n.minute < this.seenNotice) continue;
      this.seenNotice = n.minute;
      const who = persons.find((p) => p.id === n.personId)?.name ?? '';
      const args: Record<string, string | number> = { name: who, ...(n.args ?? {}) };
      for (const [k, v] of Object.entries(args)) if (typeof v === 'string' && k !== 'name' && has(v)) args[k] = t(v, n.args);
      const div = el('div', 'notice panel-cream', this.noticeEl);
      div.textContent = t(`notice.${n.kind}`, args);
      div.dataset.kind = n.kind;
      setTimeout(() => div.classList.add('fade'), 5000);
      setTimeout(() => div.remove(), 6000);
      while (this.noticeEl.childElementCount > 4) this.noticeEl.firstElementChild?.remove();
    }
  }

  setHidden(hidden: boolean): void {
    this.root.style.display = hidden ? 'none' : '';
  }
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
