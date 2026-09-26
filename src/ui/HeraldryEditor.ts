/**
 * 문장 편집기 (GDD 16-1, 27-1 가문 만들기). 방패 모양 + 나눔(두 색) + 문양(한 색).
 * 그림은 src/render/heraldry.ts 픽셀 합성(정수 배율)을 캔버스에 그대로 올림. 이름·규칙은 툴팁.
 * 금속 위 금속 · 색 위 색은 막지 않고 경고만 (sim setHeraldry 와 같은 규칙).
 */
import { t } from '../i18n';
import { composeCoatOfArmsPixels, HERALDRY, tinctureWarnings, type CoatOfArmsSpec } from '../render/heraldry';
import { iconEl } from './skin';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** 문장 캔버스 (32px × 정수 배율) */
export function heraldryCanvas(spec: CoatOfArmsSpec, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const px = composeCoatOfArmsPixels(spec, scale);
  c.width = px.width;
  c.height = px.height;
  const g = c.getContext('2d')!;
  const img = g.createImageData(px.width, px.height);
  img.data.set(px.data);
  g.putImageData(img, 0, 0);
  c.className = 'px her-cv';
  return c;
}

export function randomHeraldry(rnd: () => number): CoatOfArmsSpec {
  const pick = <T>(a: readonly T[]): T => a[Math.min(a.length - 1, Math.floor(rnd() * a.length))];
  const metals = HERALDRY.tinctures.filter((x) => x.kind === 'metal').map((x) => x.id);
  const colours = HERALDRY.tinctures.filter((x) => x.kind === 'colour').map((x) => x.id);
  // 문장학 규칙을 지키는 무작위: 바탕 하나는 금속, 하나는 색, 문양은 바탕과 다른 부류
  const fieldMetal = rnd() < 0.5;
  const a = fieldMetal ? pick(metals) : pick(colours);
  const b = fieldMetal ? pick(colours) : pick(metals);
  const division = pick(HERALDRY.divisions).id;
  const second = HERALDRY.divisions.find((d) => d.id === division)?.second;
  return {
    shield: pick(HERALDRY.shields).id,
    division,
    tinctures: [a, b],
    charge: pick(HERALDRY.charges).id,
    chargeTincture: second ? pick([...metals, ...colours].filter((x) => x !== a && x !== b)) : fieldMetal ? pick(colours) : pick(metals),
  };
}

export class HeraldryEditor {
  readonly root: HTMLElement;
  private spec: CoatOfArmsSpec;
  private done: ((spec: CoatOfArmsSpec | null) => void) | null = null;
  private body: HTMLElement;

  constructor(parent: HTMLElement, private rnd: () => number) {
    this.root = el('div', 'her-wrap', parent);
    this.root.dataset.open = '0';
    this.body = el('div', 'her g', this.root);
    this.spec = randomHeraldry(rnd);
  }

  get open(): boolean {
    return this.root.dataset.open === '1';
  }

  show(spec: CoatOfArmsSpec, done: (spec: CoatOfArmsSpec | null) => void): void {
    this.spec = { ...spec, tinctures: [...spec.tinctures] as [string, string] };
    this.done = done;
    this.root.dataset.open = '1';
    this.render();
  }

  close(ok: boolean): void {
    if (!this.open) return;
    this.root.dataset.open = '0';
    const d = this.done;
    this.done = null;
    d?.(ok ? this.spec : null);
  }

  private set(p: Partial<CoatOfArmsSpec>): void {
    this.spec = { ...this.spec, ...p };
    this.render();
  }

  private render(): void {
    const s = this.spec;
    this.body.textContent = '';
    const left = el('div', 'her-left', this.body);
    const big = el('div', 'her-big', left);
    big.appendChild(heraldryCanvas(s, 6));
    const warns = tinctureWarnings(s);
    const wl = el('div', 'her-warns', left);
    for (const w of warns) {
      const chip = el('div', 'her-warn s', wl);
      chip.dataset.warn = w.code;
      chip.appendChild(iconEl('cute.exclaim', 2));
      el('span', '', chip, t(`ng.her.warn.${w.code}`));
      chip.title = t(`heraldry.rule.${w.code}`);
    }

    const right = el('div', 'her-right ng-scroll', this.body);
    const row = (label: string, key: string) => {
      const r = el('div', 'her-row', right);
      r.dataset.row = key;
      el('b', 'her-label s', r, label);
      return el('div', 'her-opts', r);
    };
    // 방패
    const shields = row(t('ng.her.shield'), 'shield');
    for (const sh of HERALDRY.shields) {
      const b = this.opt(shields, heraldryCanvas({ ...s, shield: sh.id, charge: null }, 2), t(sh.nameKey), sh.id === s.shield);
      b.dataset.id = sh.id;
      b.addEventListener('click', () => this.set({ shield: sh.id }));
    }
    // 나눔
    const divs = row(t('ng.her.division'), 'division');
    for (const d of HERALDRY.divisions) {
      const b = this.opt(divs, heraldryCanvas({ ...s, division: d.id, charge: null }, 1), t(d.nameKey), d.id === s.division, 'sm');
      b.dataset.id = d.id;
      b.addEventListener('click', () => this.set({ division: d.id }));
    }
    const second = !!HERALDRY.divisions.find((d) => d.id === s.division)?.second;
    this.swatches(row(t('ng.her.tincture1'), 'tincture1'), s.tinctures[0], (id) => this.set({ tinctures: [id, s.tinctures[1]] }));
    if (second) this.swatches(row(t('ng.her.tincture2'), 'tincture2'), s.tinctures[1], (id) => this.set({ tinctures: [s.tinctures[0], id] }));
    // 문양
    const charges = row(t('ng.her.charge'), 'charge');
    const none = this.opt(charges, heraldryCanvas({ ...s, charge: null }, 1), t('ng.her.none'), !s.charge, 'sm');
    none.dataset.id = '';
    none.addEventListener('click', () => this.set({ charge: null }));
    for (const c of HERALDRY.charges) {
      const b = this.opt(charges, heraldryCanvas({ ...s, charge: c.id }, 1), t(c.nameKey), c.id === s.charge, 'sm');
      b.dataset.id = c.id;
      b.addEventListener('click', () => this.set({ charge: c.id }));
    }
    if (s.charge) this.swatches(row(t('ng.her.chargeTincture'), 'chargeTincture'), s.chargeTincture, (id) => this.set({ chargeTincture: id }));

    const foot = el('div', 'her-foot', this.body);
    const btn = (icon: string, tip: string, act: string, fn: () => void) => {
      const b = el('button', 'ng-rbtn', foot);
      b.type = 'button';
      b.title = tip;
      b.dataset.act = act;
      b.appendChild(iconEl(icon, 2));
      b.addEventListener('click', fn);
      return b;
    };
    btn('cute.reroll', t('ng.her.random'), 'her-random', () => {
      this.spec = randomHeraldry(this.rnd);
      this.render();
    });
    btn('cute.x', t('ng.her.cancel'), 'her-cancel', () => this.close(false));
    btn('cute.check', t('ng.her.ok'), 'her-ok', () => this.close(true)).classList.add('go');
  }

  private opt(parent: HTMLElement, cv: HTMLCanvasElement, tip: string, on: boolean, size = ''): HTMLButtonElement {
    const b = el('button', `her-opt ${size}`.trim(), parent);
    b.type = 'button';
    b.title = tip;
    b.classList.toggle('on', on);
    b.appendChild(cv);
    return b;
  }

  private swatches(parent: HTMLElement, cur: string, pick: (id: string) => void): void {
    for (const tc of HERALDRY.tinctures) {
      const b = el('button', 'ng-swatch', parent);
      b.type = 'button';
      b.dataset.id = tc.id;
      b.style.setProperty('--c', tc.ramp[1]);
      b.style.setProperty('--c2', tc.ramp[2]);
      b.classList.toggle('metal', tc.kind === 'metal');
      b.classList.toggle('on', tc.id === cur);
      b.title = `${t(tc.nameKey)} · ${t(tc.kind === 'metal' ? 'ng.her.metal' : 'ng.her.colour')}`;
      b.addEventListener('click', () => pick(tc.id));
    }
  }
}
