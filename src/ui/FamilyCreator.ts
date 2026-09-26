/**
 * 가문 만들기 (GDD 10-1 캐릭터 만들기 = 가문 만들기, 16-1 가문명 · 문장 · 가훈 · 상속법, 27-1).
 *
 * 흐름: 가문 선택 화면에서 고른 프리셋(신분 × 형편)의 가족 구성을 무작위 인물로 채운 초안 → 여기서 꾸밈.
 * 시작할 때 NewGame 이 applyPreset(돈 · 집 · 직업 · 영지) → createFamily(이 사양) 순서로 sim 에 보냄.
 *
 * 배치 (1600×900, 27-6 배율 규칙은 styles.css):
 *  - 왼쪽 판: 문장 · 가문명 · 신분 · 형편 · 상속법 · 가훈
 *  - 가운데: 미리보기 (게임과 같은 LPC 합성, 원본 1px = 4px), 돌려 보기, 움직임, 가족 머리 줄
 *  - 오른쪽 판: 고른 식구 편집 (기본 · 외모 · 옷 · 성격), 부위별 무작위
 * 글자는 이름 · 수치 · 항목 이름만. 버튼 뜻은 툴팁 (27-3). 무작위는 UI 쪽 난수, sim 에 넘기는 사양은 값 그대로 (결정론)
 */
import geneticsRaw from '../data/genetics.json';
import namesRaw from '../data/names.json';
import clanNamesRaw from '../data/clan_names.json';
import clansRaw from '../data/clans.json';
import traitsRaw from '../data/traits.json';
import presetsRaw from '../data/start_presets.json';
import { has, t } from '../i18n';
import { Rng } from '../sim/core/rng';
import { parseGenetics, inherit, type Genome } from '../sim/family/genetics';
import { parseClanNames, parseNames, pickClanName, pickName } from '../sim/family/names';
import {
  allowedDyeColors, exportFamily, importFamily, memberAppearance, randomizePart, randomMember, resembleFamily, validateFamily,
  exportPerson, importPerson,
  type CreationIssue, type FamilySpec, type MemberSpec, type RandomPart, type RelSpec,
} from '../sim/family/creation';
import { parsePresets, presetMembers, resolvePreset, type Wealth } from '../sim/house/presets';
import type { LifeStage } from '../sim/people/person';
import { OUTFIT_KINDS, type OutfitKind } from '../sim/people/outfits';
import { LPC_PACK } from '../render/lpc/compose';
import type { CharacterSpec } from '../render/lpc/types';
import type { CoatOfArmsSpec } from '../render/heraldry';
import { heraldryCanvas, HeraldryEditor, randomHeraldry } from './HeraldryEditor';
import { drawFrame, headCanvas, previewSheet, type ImageLoader, type PreviewSheet } from './charPreview';
import { iconEl, tabUrl } from './skin';

export const G = parseGenetics(geneticsRaw);
export const NAMES = parseNames(namesRaw);
const CLAN_NAMES = parseClanNames(clanNamesRaw);
export const PRESETS = parsePresets(presetsRaw)!;
export const ESTATES = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'] as const;
export type Estate = (typeof ESTATES)[number];
export const WEALTHS: Wealth[] = ['poor', 'normal', 'rich'];
const STAGES: LifeStage[] = ['baby', 'toddler', 'child', 'teen', 'young', 'adult', 'elder'];
const CLANS = clansRaw as unknown as {
  motto: { maxLength: number; maxTags: number; tags: Record<string, string[]> };
  inheritance: { laws: string[]; defaultLaw: string; estateLaw: Record<string, string> };
};
const TRAITS = traitsRaw as unknown as { slots: Record<string, number>; conflicts: [string, string][]; traits: Record<string, { category: string; icon: string }> };
const PERSONALITY = Object.entries(TRAITS.traits).filter(([, v]) => ['emotional', 'lifestyle', 'social'].includes(v.category)).map(([k]) => k);
const PAL = LPC_PACK.palettes as unknown as Record<string, { colors: Record<string, string[]> }>;

export type Role = 'head' | 'spouse' | 'child' | 'nephew' | 'parent' | 'sibling' | 'sibling_spouse' | 'grandparent' | 'grandchild' | 'cousin' | 'servant';
const ROLES: Role[] = ['spouse', 'child', 'nephew', 'parent', 'sibling', 'sibling_spouse', 'grandparent', 'grandchild', 'cousin', 'servant'];

export interface MemberDraft {
  m: MemberSpec;
  role: Role;
}
export interface FamilyDraft {
  preset: string;
  estate: Estate;
  wealth: Wealth;
  clan: string;
  motto: string;
  mottoTags: string[];
  law: string;
  heraldry: CoatOfArmsSpec;
  members: MemberDraft[];
}

export function coarse(stage: LifeStage): 'child' | 'teen' | 'adult' | 'elder' {
  return stage === 'baby' || stage === 'toddler' || stage === 'child' ? 'child' : stage === 'teen' ? 'teen' : stage === 'elder' ? 'elder' : 'adult';
}

export function fixedLaw(estate: string): string | null {
  return CLANS.inheritance.estateLaw[estate] ?? null;
}

let keySeq = 100;

/** 프리셋 가족 구성 → 무작위 인물 초안 (아이는 부모 유전자로) */
export function draftFromPreset(presetId: string, rng: Rng): FamilyDraft {
  const r = resolvePreset(PRESETS, presetId);
  if (!r) throw new Error(`unknown preset ${presetId}`);
  const specs = presetMembers(r, rng);
  const taken: string[] = [];
  const members: MemberDraft[] = specs.map((sp, i) => {
    const m = randomMember(G, NAMES, rng, { key: `m${i}`, estate: sp.estate, sex: sp.sex, stage: sp.stage, householdEstate: r.estate, takenNames: taken });
    m.age = sp.displayAge;
    taken.push(m.name);
    const role: Role = sp.role === 'child' && r.assets.family === 'clergy' ? 'nephew' : sp.role;
    return { m, role };
  });
  // 아이는 부모 유전자 (가족이 닮게), 부모와 나이 차 16 이상
  const head = members.find((x) => x.role === 'head');
  const spouse = members.find((x) => x.role === 'spouse');
  const sib = members.find((x) => x.role === 'sibling');
  const sibSp = members.find((x) => x.role === 'sibling_spouse');
  for (const d of members) {
    const [a, b] = d.role === 'child' ? [head, spouse] : d.role === 'nephew' ? [sib, sibSp] : [undefined, undefined];
    if (!a || !b) continue;
    const mother = a.m.sex === 'female' ? a : b;
    const father = mother === a ? b : a;
    d.m.genome = inherit(G, mother.m.genome, father.m.genome, rng);
    d.m.age = Math.min(d.m.age ?? 6, Math.min(a.m.age ?? 30, b.m.age ?? 30) - 16);
    d.m.age = Math.max(G.creation.stageAges[d.m.stage][0], d.m.age);
  }
  return {
    preset: presetId,
    estate: r.estate as Estate,
    wealth: r.wealth,
    clan: pickClanName(CLAN_NAMES, rng, r.estate) ?? '',
    motto: '',
    mottoTags: [],
    law: fixedLaw(r.estate) ?? CLANS.inheritance.defaultLaw,
    heraldry: randomHeraldry(() => rng.next()),
    members,
  };
}

/** 초안 → sim 사양 (관계는 가장 기준 역할에서 만듦) */
export function draftToSpec(d: FamilyDraft): FamilySpec {
  const rel: RelSpec[] = [];
  const by = (r: Role) => d.members.filter((x) => x.role === r);
  const head = by('head')[0] ?? d.members.find((x) => x.role !== 'servant');
  const spouse = by('spouse')[0];
  const sibs = by('sibling');
  const sibSps = by('sibling_spouse');
  const parents = by('parent');
  const H = head?.m.key;
  if (H) {
    if (spouse) rel.push({ a: H, b: spouse.m.key, kind: 'spouse' });
    for (const c of by('child')) {
      rel.push({ a: H, b: c.m.key, kind: 'parent' });
      if (spouse) rel.push({ a: spouse.m.key, b: c.m.key, kind: 'parent' });
    }
    for (const p of parents) rel.push({ a: p.m.key, b: H, kind: 'parent' });
    // 부모 둘이 남녀면 부부
    const pm = parents.find((p) => p.m.sex === 'male');
    const pf = parents.find((p) => p.m.sex === 'female');
    if (pm && pf) rel.push({ a: pm.m.key, b: pf.m.key, kind: 'spouse' });
    for (const s of sibs) {
      rel.push({ a: H, b: s.m.key, kind: 'sibling' });
      for (const p of parents) rel.push({ a: p.m.key, b: s.m.key, kind: 'parent' });
    }
    sibSps.forEach((x, i) => {
      const s = sibs[i] ?? sibs[0];
      if (s) rel.push({ a: s.m.key, b: x.m.key, kind: 'spouse' });
    });
    for (const n of by('nephew')) {
      const s = sibs[0];
      const sp = sibSps[0];
      if (s) rel.push({ a: s.m.key, b: n.m.key, kind: 'parent' });
      if (sp) rel.push({ a: sp.m.key, b: n.m.key, kind: 'parent' });
    }
    for (const g of by('grandparent')) rel.push({ a: g.m.key, b: H, kind: 'grandparent' });
    for (const g of by('grandchild')) {
      rel.push({ a: H, b: g.m.key, kind: 'grandparent' });
      if (spouse) rel.push({ a: spouse.m.key, b: g.m.key, kind: 'grandparent' });
    }
    for (const c of by('cousin')) rel.push({ a: H, b: c.m.key, kind: 'cousin' });
  }
  const members = d.members.map((x) => ({ ...x.m, servant: x.role === 'servant' }));
  return { v: 1, clan: d.estate === 'serf' ? null : d.clan.trim() || null, estate: d.estate, members, relations: rel };
}

/** 불러온 사양 → 초안 역할 (가장 = 첫 비하인, 관계에서 역할 추정) */
function draftFromSpec(spec: FamilySpec, base: FamilyDraft): FamilyDraft {
  const head = spec.members.find((m) => !m.servant) ?? spec.members[0];
  const roleOf = (m: MemberSpec): Role => {
    if (m.servant) return 'servant';
    if (m === head) return 'head';
    const H = head.key;
    for (const r of spec.relations) {
      if (r.kind === 'spouse' && ((r.a === H && r.b === m.key) || (r.b === H && r.a === m.key))) return 'spouse';
      if (r.kind === 'parent' && r.a === H && r.b === m.key) return 'child';
      if (r.kind === 'parent' && r.b === H && r.a === m.key) return 'parent';
      if (r.kind === 'sibling' && (r.a === m.key || r.b === m.key)) return 'sibling';
      if (r.kind === 'grandparent' && r.b === H && r.a === m.key) return 'grandparent';
      if (r.kind === 'grandparent' && r.a === H && r.b === m.key) return 'grandchild';
      if (r.kind === 'cousin' && (r.a === m.key || r.b === m.key)) return 'cousin';
    }
    return spec.relations.some((r) => r.kind === 'spouse' && (r.a === m.key || r.b === m.key)) ? 'sibling_spouse' : 'child';
  };
  const estate = (ESTATES as readonly string[]).includes(spec.estate) ? (spec.estate as Estate) : base.estate;
  return { ...base, estate, preset: `${estate}_${base.wealth}`, clan: spec.clan ?? '', members: spec.members.map((m) => ({ m: { ...m }, role: roleOf(m) })) };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

function btn(parent: HTMLElement, cls: string, tip: string, act: string, icon?: string, text?: string): HTMLButtonElement {
  const b = el('button', cls, parent);
  b.type = 'button';
  if (tip) b.title = tip;
  b.dataset.act = act;
  if (icon) b.appendChild(iconEl(icon, cls.includes('ng-mini') ? 1 : 2));
  if (text !== undefined) el('span', '', b, text);
  return b;
}

/** 신분 표시: 수첩 위쪽 탭 (신분 색, 27-11) + 신분 아이콘 */
const ESTATE_ICON: Record<string, string> = { serf: 'axe', freeman: 'plant', artisan: 'cute.wrench', merchant: 'cute.coins', clergy: 'rv.church', knight: 'cute.sword', noble: 'cute.crown' };
export function estateTab(e: string, on: boolean, cls: string): HTMLElement {
  const w = el('span', `estate-tab ${cls}`);
  const img = el('img', 'px', w);
  img.src = tabUrl(e, on);
  img.alt = '';
  const ic = iconEl(ESTATE_ICON[e] ?? 'ui.crest', 1, 'estate-tab-ic');
  w.appendChild(ic);
  w.classList.toggle('on', on);
  return w;
}

const swatchHex = (pal: string, name: string, i: number) => PAL[pal]?.colors[name]?.[i] ?? '#888';

type Tab = 'basic' | 'look' | 'clothes' | 'traits';
type Anim = 'idle' | 'walk' | 'sit' | 'emote';
const DIRS = ['down', 'left', 'up', 'right'];

export interface CreatorHandlers {
  back(): void;
  start(d: FamilyDraft): void;
}

export class FamilyCreator {
  readonly root: HTMLElement;
  draft!: FamilyDraft;
  sel = 0;
  private tab: Tab = 'basic';
  private outfit: OutfitKind = 'everyday';
  private anim: Anim = 'walk';
  private dir = 0;
  private left: HTMLElement;
  private center: HTMLElement;
  private right: HTMLElement;
  private foot: HTMLElement;
  private stageCv: HTMLCanvasElement;
  private nameEl: HTMLElement;
  private famRow: HTMLElement;
  private sheet: PreviewSheet | null = null;
  private sheetVer = 0;
  private heads = new Map<string, HTMLCanvasElement>();
  private raf = 0;
  private heraldry: HeraldryEditor;
  private fileIn: HTMLInputElement;
  private importMode: 'family' | 'person' = 'family';

  constructor(parent: HTMLElement, private load: ImageLoader, private rng: Rng, private h: CreatorHandlers) {
    this.root = el('div', 'fc');
    parent.appendChild(this.root);
    this.left = el('div', 'fc-clan g', this.root);
    this.center = el('div', 'fc-center', this.root);
    const stage = el('div', 'fc-stage', this.center);
    el('i', 'fc-floor', stage);
    this.stageCv = el('canvas', 'fc-cv px', stage);
    this.stageCv.width = 256;
    this.stageCv.height = 256;
    const rot = (d: number, icon: string, cls: string) => {
      const b = btn(stage, `ng-rbtn fc-rot ${cls}`, t('ng.act.rotate'), `rotate-${cls}`, icon);
      b.addEventListener('click', () => {
        this.dir = (this.dir + d + 4) % 4;
      });
    };
    rot(1, 'cute.left', 'l');
    rot(-1, 'cute.right', 'r');
    const anims = el('div', 'fc-anims', this.center);
    for (const [a, icon] of [['idle', 'cute.cursor'], ['walk', 'goto'], ['sit', 'comfort'], ['emote', 'cute.heart']] as Array<[Anim, string]>) {
      const b = btn(anims, 'ng-ib', t('ng.act.anim'), `anim-${a}`, icon);
      b.dataset.anim = a;
      b.addEventListener('click', () => {
        this.anim = a;
        anims.querySelectorAll('.ng-ib').forEach((x) => x.classList.toggle('on', x === b));
      });
      b.classList.toggle('on', a === this.anim);
    }
    this.nameEl = el('div', 'fc-name fl', this.center);
    this.famRow = el('div', 'fc-fam', this.center);
    this.right = el('div', 'fc-edit g', this.root);
    this.foot = el('div', 'fc-foot', this.root);
    this.heraldry = new HeraldryEditor(this.root, () => this.rng.next());
    this.fileIn = el('input', 'fc-file', this.root);
    this.fileIn.type = 'file';
    this.fileIn.accept = '.json,application/json';
    this.fileIn.addEventListener('change', () => void this.onFile());
    this.buildFoot();
  }

  // ------------------------------------------------------------------ 열기

  open(d: FamilyDraft): void {
    this.draft = d;
    this.sel = 0;
    this.tab = 'basic';
    this.outfit = 'everyday';
    this.heads.clear();
    this.renderAll();
    cancelAnimationFrame(this.raf);
    const loop = (now: number) => {
      this.drawStage(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  close(): void {
    cancelAnimationFrame(this.raf);
    this.heraldry.close(false);
  }

  get editingHeraldry(): boolean {
    return this.heraldry.open;
  }

  closeHeraldry(): void {
    this.heraldry.close(false);
  }

  get cur(): MemberDraft {
    return this.draft.members[Math.min(this.sel, this.draft.members.length - 1)];
  }

  private renderAll(): void {
    this.renderClan();
    this.renderEdit();
    this.renderFamily();
    this.refreshPreview();
    this.renderIssues();
  }

  private changed(member = true): void {
    if (member) {
      this.renderEdit();
      this.refreshPreview();
    }
    this.renderFamily();
    this.renderIssues();
  }

  // ------------------------------------------------------------------ 왼쪽: 가문

  private renderClan(): void {
    const d = this.draft;
    const L = this.left;
    L.textContent = '';
    const top = el('div', 'fc-crest-row', L);
    const crest = btn(top, 'fc-crest', t('ng.clan.heraldry'), 'heraldry');
    crest.appendChild(heraldryCanvas(d.heraldry, 3));
    crest.addEventListener('click', () => {
      this.heraldry.show(d.heraldry, (spec) => {
        if (spec) d.heraldry = spec;
        this.renderClan();
      });
    });
    const nameBox = el('label', 'fc-field', top);
    el('b', 'fc-lab s', nameBox, t('ng.clan.name'));
    const inp = el('input', 'ng-input', nameBox);
    inp.dataset.field = 'clan';
    inp.maxLength = 20;
    inp.value = d.estate === 'serf' ? '' : d.clan;
    inp.disabled = d.estate === 'serf';
    if (inp.disabled) nameBox.title = t('ng.clan.name.serf');
    inp.addEventListener('input', () => {
      d.clan = inp.value;
      this.renderIssues();
    });
    const rr = btn(nameBox, 'ng-mini fc-rr', t('ng.act.random_part', { part: t('ng.clan.name') }), 'clan-random', 'cute.reroll');
    rr.disabled = d.estate === 'serf';
    rr.addEventListener('click', () => {
      d.clan = pickClanName(CLAN_NAMES, this.rng, d.estate, [d.clan]) ?? '';
      inp.value = d.clan;
      this.renderIssues();
    });

    // 신분 (책 탭 색 = 신분 색, 27-11)
    const er = this.row(L, t('ng.clan.estate'));
    const tabs = el('div', 'fc-estates', er);
    for (const e of ESTATES) {
      const b = btn(tabs, 'fc-estate', t(`estate.${e}.desc`), `estate-${e}`);
      b.dataset.estate = e;
      b.classList.toggle('on', e === d.estate);
      b.appendChild(estateTab(e, e === d.estate, 'fc-estate-tab'));
      el('span', 's', b, t(`estate.${e}`));
      b.addEventListener('click', () => this.setEstate(e));
    }
    const wr = this.row(L, t('ng.clan.wealth'));
    for (const w of WEALTHS) {
      const b = this.chip(wr, t(`ng.wealth.${w}`), w === d.wealth, `wealth-${w}`);
      b.title = t(`preset.${d.estate}_${w}`);
      b.addEventListener('click', () => {
        d.wealth = w;
        d.preset = `${d.estate}_${w}`;
        this.renderClan();
      });
    }
    const lr = this.row(L, t('ng.clan.law'));
    const fixed = fixedLaw(d.estate);
    for (const law of CLANS.inheritance.laws) {
      const b = this.chip(lr, t(`clan.law.${law}`), law === d.law, `law-${law}`);
      b.title = fixed ? t('ng.clan.law.fixed') : t(`clan.law.${law}.desc`);
      b.disabled = !!fixed && law !== fixed;
      b.addEventListener('click', () => {
        d.law = law;
        this.renderClan();
      });
    }
    const mr = el('div', 'fc-row col', L);
    el('b', 'fc-lab s', mr, t('ng.clan.motto'));
    const mi = el('input', 'ng-input wide', mr);
    mi.dataset.field = 'motto';
    mi.maxLength = CLANS.motto.maxLength;
    mi.value = d.motto;
    mi.addEventListener('input', () => {
      d.motto = mi.value;
    });
    const tg = el('div', 'fc-tags', mr);
    tg.title = t('ng.clan.motto.tags');
    for (const tag of Object.keys(CLANS.motto.tags)) {
      const on = d.mottoTags.includes(tag);
      const b = this.chip(tg, t(`clan.motto.tag.${tag}`), on, `tag-${tag}`);
      b.disabled = !on && d.mottoTags.length >= CLANS.motto.maxTags;
      b.addEventListener('click', () => {
        d.mottoTags = on ? d.mottoTags.filter((x) => x !== tag) : [...d.mottoTags, tag];
        this.renderClan();
      });
    }
  }

  private setEstate(e: Estate): void {
    const d = this.draft;
    if (e === d.estate) return;
    d.estate = e;
    d.preset = `${e}_${d.wealth}`;
    const fx = fixedLaw(e);
    if (fx) d.law = fx;
    for (const x of d.members) {
      if (x.role === 'servant') continue;
      x.m.estate = e === 'clergy' ? (x.role === 'head' ? 'clergy' : 'freeman') : e;
      this.fixDyes(x.m);
    }
    if (e !== 'serf' && !d.clan) d.clan = pickClanName(CLAN_NAMES, this.rng, e) ?? '';
    this.renderClan();
    this.changed();
  }

  /** 신분이 바뀌어 못 입게 된 옷 색은 허용 색으로 */
  private fixDyes(m: MemberSpec): void {
    const ok = this.allowed(m);
    for (const k of OUTFIT_KINDS) {
      const o = m.outfits[k];
      for (const ch of ['main', 'accent', 'trim'] as const) if (!ok.includes(o[ch])) o[ch] = ok[Math.min(ok.length - 1, this.rng.int(ok.length))];
    }
  }

  private allowed(m: MemberSpec): string[] {
    const rank = (e: string) => G.dyes.rank[e] ?? 0;
    const role = this.draft.members.find((x) => x.m === m)?.role;
    const r = role === 'servant' ? Math.max(rank(m.estate), rank(this.draft.estate) - 1) : rank(m.estate);
    return allowedDyeColors(G, m.estate, r);
  }

  // ------------------------------------------------------------------ 가운데: 미리보기 + 가족 줄

  private appearanceOf(m: MemberSpec): CharacterSpec {
    return memberAppearance(G, m, this.outfit) as unknown as CharacterSpec;
  }

  private refreshPreview(): void {
    const m = this.cur.m;
    const ver = ++this.sheetVer;
    void previewSheet(this.appearanceOf(m), m.stage, this.load).then((s) => {
      if (ver === this.sheetVer) this.sheet = s;
    }).catch(() => undefined);
    const age = m.age !== undefined ? ` · ${t('ng.age', { n: m.age })}` : '';
    this.nameEl.textContent = `${m.name} · ${t(`ng.role.${this.cur.role}`)}${age}`;
  }

  private drawStage(now: number): void {
    const g = this.stageCv.getContext('2d')!;
    g.clearRect(0, 0, 256, 256);
    const s = this.sheet;
    if (!s) return;
    let anim: string = this.anim;
    let frame = 0;
    const dir = DIRS[this.dir];
    if (s.infant === 'baby') anim = this.anim === 'walk' ? 'floor' : this.anim === 'sit' ? 'cradle' : this.anim === 'emote' ? 'floor_cry' : 'floor';
    else if (s.infant === 'toddler') anim = this.anim === 'emote' ? 'crawl' : this.anim;
    const a = s.anims[anim] ?? s.anims.idle;
    if (!a) return;
    if (anim === 'sit' && !s.infant) frame = 2;
    else frame = Math.floor((now / 1000) * Math.max(1, a.fps || 2));
    drawFrame(g, s, anim, dir, frame, 0, 0, 4);
  }

  private renderFamily(): void {
    const F = this.famRow;
    F.textContent = '';
    this.draft.members.forEach((x, i) => {
      const b = btn(F, 'fc-member', `${x.m.name} · ${t(`ng.role.${x.role}`)}`, `member-${i}`);
      b.dataset.index = String(i);
      b.classList.toggle('on', i === this.sel);
      el('i', 'fc-member-glow', b);
      const hc = this.heads.get(x.m.key);
      if (hc) b.appendChild(hc);
      else el('span', 'fc-member-name fl s', b, x.m.name.slice(0, 2));
      b.addEventListener('click', () => {
        this.sel = i;
        this.renderEdit();
        this.refreshPreview();
        this.renderFamily();
      });
      const sig = JSON.stringify(this.appearanceOf(x.m)) + x.m.stage;
      if (b.dataset.sig !== sig) {
        b.dataset.sig = sig;
        void previewSheet(memberAppearance(G, x.m, 'everyday') as unknown as CharacterSpec, x.m.stage, this.load).then((s) => {
          const c = headCanvas(s);
          c.className = 'fc-member-img px';
          const old = this.heads.get(x.m.key);
          this.heads.set(x.m.key, c);
          const cur = F.querySelector<HTMLElement>(`[data-index="${i}"]`);
          if (cur) {
            cur.querySelector('.fc-member-name')?.remove();
            if (old && old.parentElement === cur) old.replaceWith(c);
            else cur.appendChild(c);
          }
        }).catch(() => undefined);
      }
    });
    const family = this.draft.members.filter((x) => x.role !== 'servant').length;
    const add = btn(F, 'fc-member add', t('ng.act.add'), 'member-add', 'cute.plus');
    add.disabled = family >= G.creation.maxMembers || this.draft.members.length >= G.creation.maxHousehold;
    add.addEventListener('click', () => this.addMember());
  }

  private addMember(): void {
    const d = this.draft;
    const head = d.members.find((x) => x.role === 'head');
    const spouse = d.members.find((x) => x.role === 'spouse');
    const m = randomMember(G, NAMES, this.rng, {
      key: `m${keySeq++}`, estate: d.estate === 'clergy' ? 'freeman' : d.estate, stage: 'child', householdEstate: d.estate,
      takenNames: d.members.map((x) => x.m.name),
    });
    if (head && spouse) {
      const mother = head.m.sex === 'female' ? head : spouse;
      const father = mother === head ? spouse : head;
      m.genome = inherit(G, mother.m.genome, father.m.genome, this.rng);
    } else m.genome = resembleFamily(G, d.members.map((x) => x.m.genome), this.rng);
    d.members.push({ m, role: head && d.estate !== 'clergy' ? 'child' : 'sibling' });
    this.sel = d.members.length - 1;
    this.changed();
  }

  // ------------------------------------------------------------------ 오른쪽: 식구 편집

  private renderEdit(): void {
    const R = this.right;
    const scroll = R.querySelector('.ng-scroll')?.scrollTop ?? 0;
    R.textContent = '';
    const head = el('div', 'fc-edit-head', R);
    const tabs = el('div', 'fc-tabs', head);
    for (const tb of ['basic', 'look', 'clothes', 'traits'] as Tab[]) {
      const b = this.chip(tabs, t(`ng.tab.${tb}`), tb === this.tab, `tab-${tb}`);
      b.classList.add('tab');
      b.addEventListener('click', () => {
        this.tab = tb;
        this.renderEdit();
      });
    }
    const acts = el('div', 'fc-acts', head);
    const x = this.cur;
    btn(acts, 'ng-ib sm', t('ng.act.random_member'), 'member-random', 'cute.reroll').addEventListener('click', () => this.randomizeMember());
    btn(acts, 'ng-ib sm', t('ng.act.resemble'), 'member-resemble', 'cute.heart').addEventListener('click', () => {
      const others = this.draft.members.filter((o) => o !== x && o.role !== 'servant').map((o) => o.m.genome);
      x.m.genome = resembleFamily(G, others, this.rng);
      this.changed();
    });
    btn(acts, 'ng-ib sm', t('ng.act.export_person'), 'person-export', 'cute.save').addEventListener('click', () => this.download(`${x.m.name || 'person'}.json`, exportPerson(x.m)));
    btn(acts, 'ng-ib sm', t('ng.act.import_person'), 'person-import', 'cute.book_blue').addEventListener('click', () => {
      this.importMode = 'person';
      this.fileIn.click();
    });
    const del = btn(acts, 'ng-ib sm', t('ng.act.remove'), 'member-remove', 'cute.trash');
    del.disabled = x.role === 'head';
    del.addEventListener('click', () => {
      this.draft.members.splice(this.sel, 1);
      this.sel = Math.max(0, this.sel - 1);
      this.changed();
    });

    const body = el('div', 'fc-body ng-scroll', R);
    if (this.tab === 'basic') this.editBasic(body);
    else if (this.tab === 'look') this.editLook(body);
    else if (this.tab === 'clothes') this.editClothes(body);
    else this.editTraits(body);
    body.scrollTop = scroll;
  }

  private row(parent: HTMLElement, label: string, part?: RandomPart): HTMLElement {
    const r = el('div', 'fc-row', parent);
    el('b', 'fc-lab s', r, label);
    const box = el('div', 'fc-ctl', r);
    if (part) {
      const b = btn(r, 'ng-mini fc-rr', t('ng.act.random_part', { part: label }), `rr-${part}`, 'cute.reroll');
      b.addEventListener('click', () => this.rand(part));
    }
    return box;
  }

  private chip(parent: HTMLElement, text: string, on: boolean, act: string): HTMLButtonElement {
    const b = btn(parent, 'ng-chip s', '', act, undefined, text);
    b.classList.toggle('on', on);
    return b;
  }

  private rand(part: RandomPart): void {
    const x = this.cur;
    x.m = randomizePart(G, x.m, part, this.rng, { names: NAMES, householdEstate: this.draft.estate, takenNames: this.draft.members.filter((o) => o !== x).map((o) => o.m.name) });
    if (part === 'dyes') this.fixDyes(x.m);
    this.changed();
  }

  private randomizeMember(): void {
    const x = this.cur;
    const m = randomMember(G, NAMES, this.rng, {
      key: x.m.key, estate: x.m.estate, sex: x.m.sex, stage: x.m.stage, servant: x.role === 'servant', householdEstate: this.draft.estate,
      takenNames: this.draft.members.filter((o) => o !== x).map((o) => o.m.name),
    });
    m.age = x.m.age;
    m.traits = x.m.traits;
    x.m = m;
    this.fixDyes(x.m);
    this.changed();
  }

  private stageChanged(m: MemberSpec): void {
    const styles = G.art.hairStyles[m.sex][coarse(m.stage)];
    if (m.look.hairStyle && !styles.includes(m.look.hairStyle)) delete m.look.hairStyle;
    if (m.sex === 'female' || coarse(m.stage) === 'child' || coarse(m.stage) === 'teen') delete m.look.beard;
    if (m.stage !== 'elder') delete m.look.elderHair;
    const slots = this.traitSlots(m);
    if (m.traits.length > slots) m.traits = m.traits.slice(0, slots);
  }

  private editBasic(B: HTMLElement): void {
    const x = this.cur;
    const m = x.m;
    const nr = this.row(B, t('ng.field.name'), 'name');
    const ni = el('input', 'ng-input wide', nr);
    ni.dataset.field = 'name';
    ni.maxLength = 20;
    ni.value = m.name;
    ni.addEventListener('input', () => {
      m.name = ni.value;
      this.nameEl.textContent = `${m.name} · ${t(`ng.role.${x.role}`)}`;
      // 가족 줄은 다시 만들지 않음 (입력칸이 포커스를 잃는 순간 다른 식구를 누른 클릭이 사라지지 않게)
      const fb = this.famRow.querySelector<HTMLElement>(`[data-index="${this.sel}"]`);
      if (fb) fb.title = `${m.name} · ${t(`ng.role.${x.role}`)}`;
      this.renderIssues();
    });
    const sr = this.row(B, t('ng.field.sex'));
    for (const s of ['male', 'female'] as const) {
      this.chip(sr, t(`ng.sex.${s}`), m.sex === s, `sex-${s}`).addEventListener('click', () => {
        m.sex = s;
        this.stageChanged(m);
        this.changed();
      });
    }
    const st = this.row(B, t('ng.field.stage'));
    for (const s of STAGES) {
      this.chip(st, t(`stage.${s}`), m.stage === s, `stage-${s}`).addEventListener('click', () => {
        m.stage = s;
        const [lo, hi] = G.creation.stageAges[s];
        m.age = Math.round((lo + hi) / 2);
        this.stageChanged(m);
        this.changed();
      });
    }
    const ar = this.row(B, t('ng.field.age'));
    const [lo, hi] = G.creation.stageAges[m.stage];
    const age = m.age ?? Math.round((lo + hi) / 2);
    this.stepper(ar, t('ng.age', { n: age }), 'age', (dd) => {
      m.age = Math.max(lo, Math.min(hi, age + dd));
      this.changed();
    });
    if (x.role !== 'head') {
      const rr = this.row(B, t('ng.field.role'));
      rr.classList.add('wrap');
      for (const r of ROLES) {
        if (r === 'nephew' && !this.draft.members.some((o) => o.role === 'sibling')) continue;
        this.chip(rr, t(`ng.role.${r}`), x.role === r, `role-${r}`).addEventListener('click', () => {
          x.role = r;
          m.servant = r === 'servant';
          this.fixDyes(m);
          this.changed();
        });
      }
    }
    const er = this.row(B, t('ng.field.estate'));
    er.classList.add('wrap');
    for (const e of ESTATES) {
      this.chip(er, t(`estate.${e}`), m.estate === e, `mestate-${e}`).addEventListener('click', () => {
        m.estate = e;
        this.fixDyes(m);
        this.changed();
      });
    }
    const gr = this.row(B, t('ng.field.gait'), 'gait');
    for (const gt of Object.keys(G.gaits)) {
      this.chip(gr, t(`genetics.gait.${gt}`), m.gait === gt, `gait-${gt}`).addEventListener('click', () => {
        m.gait = gt;
        this.changed();
      });
    }
    const pr = this.row(B, t('ng.field.pitch'), 'voice');
    for (const p of Object.keys(G.voice.pitch)) {
      this.chip(pr, t(`genetics.voice.pitch.${p}`), m.voice.pitch === p, `pitch-${p}`).addEventListener('click', () => {
        m.voice = { ...m.voice, pitch: p };
        this.changed();
      });
    }
    const mr = this.row(B, t('ng.field.mumble'));
    for (const p of Object.keys(G.voice.mumble)) {
      this.chip(mr, t(`genetics.voice.mumble.${p}`), m.voice.mumble === p, `mumble-${p}`).addEventListener('click', () => {
        m.voice = { ...m.voice, mumble: p };
        this.changed();
      });
    }
  }

  private stepper(parent: HTMLElement, text: string, act: string, step: (d: number) => void): void {
    const w = el('div', 'ng-stepper', parent);
    btn(w, 'ng-mini', '', `${act}-prev`, 'cute.left').addEventListener('click', () => step(-1));
    el('b', 'ng-stepper-v s', w, text);
    btn(w, 'ng-mini', '', `${act}-next`, 'cute.right').addEventListener('click', () => step(1));
  }

  private swatches(parent: HTMLElement, items: string[], cur: string | undefined, color: (id: string) => string, tip: (id: string) => string, act: string, pick: (id: string) => void): void {
    parent.classList.add('wrap');
    for (const id of items) {
      const b = el('button', 'ng-swatch', parent);
      b.type = 'button';
      b.dataset.act = `${act}-${id}`;
      b.style.setProperty('--c', color(id));
      b.classList.toggle('on', id === cur);
      b.title = tip(id);
      b.addEventListener('click', () => pick(id));
    }
  }

  private editLook(B: HTMLElement): void {
    const m = this.cur.m;
    const gn = m.genome;
    const setG = (p: Partial<Genome>) => {
      this.cur.m = { ...m, genome: { ...gn, ...p, origin: null } };
      this.changed();
    };
    this.swatches(this.row(B, t('creation.part.skin'), 'skin'), G.skin.steps.map((_, i) => String(i)), String(gn.skin),
      (i) => swatchHex('body', G.skin.steps[Number(i)], 3), (i) => t(`genetics.skin.${G.skin.steps[Number(i)]}`), 'skin', (i) => setG({ skin: Number(i) }));
    const hairNow = gn.hair[0] === gn.hair[1] ? gn.hair[0] : undefined;
    this.swatches(this.row(B, t('ng.field.hairColor'), 'hairColor'), G.hair.natural, hairNow,
      (c) => swatchHex('hair', c, 4), (c) => t(`genetics.hair.${c}`), 'hair', (c) => setG({ hair: [c, c] }));
    if (m.stage === 'elder') {
      const er = this.row(B, t('ng.field.elderHair'));
      this.chip(er, t('ng.hair.auto'), !m.look.elderHair, 'elderhair-auto').addEventListener('click', () => {
        delete m.look.elderHair;
        this.changed();
      });
      for (const c of G.hair.elder) {
        this.chip(er, t(`genetics.hair.${c}`), m.look.elderHair === c, `elderhair-${c}`).addEventListener('click', () => {
          m.look = { ...m.look, elderHair: c };
          this.changed();
        });
      }
    }
    const styles = G.art.hairStyles[m.sex][coarse(m.stage)];
    const si = m.look.hairStyle ? styles.indexOf(m.look.hairStyle) : -1;
    this.stepper(this.row(B, t('ng.field.hairStyle'), 'hairStyle'), si < 0 ? t('ng.hair.auto') : `${si + 1}/${styles.length}`, 'hairstyle', (dd) => {
      const n = styles.length;
      m.look = { ...m.look, hairStyle: styles[(((si < 0 ? (dd > 0 ? -1 : 0) : si) + dd) % n + n) % n] };
      this.changed();
    });
    const eyeNow = gn.eyes[0] === gn.eyes[1] ? gn.eyes[0] : undefined;
    this.swatches(this.row(B, t('creation.part.eyeColor'), 'eyeColor'), G.eyes.colors, eyeNow,
      (c) => swatchHex('eye', c, 1), (c) => t(`genetics.eyes.${c}`), 'eyes', (c) => setG({ eyes: [c, c] }));
    for (const part of ['eyeShape', 'brows', 'build', 'height'] as const) {
      const r = this.row(B, t(`creation.part.${part}`), part);
      for (const v of G.parts[part]) {
        this.chip(r, t(`genetics.${part}.${v}`), gn[part] === v, `${part}-${v}`).addEventListener('click', () => setG({ [part]: v } as Partial<Genome>));
      }
    }
    if (m.sex === 'male' && (coarse(m.stage) === 'adult' || coarse(m.stage) === 'elder')) {
      const list = ['none', ...G.art.beards];
      const bi = m.look.beard ? list.indexOf(m.look.beard) : -1;
      this.stepper(this.row(B, t('ng.field.beard'), 'beard'), bi < 0 ? t('ng.hair.auto') : bi === 0 ? t('ng.beard.none') : `${bi}/${list.length - 1}`, 'beard', (dd) => {
        const n = list.length;
        m.look = { ...m.look, beard: list[(((bi < 0 ? 0 : bi) + dd) % n + n) % n] };
        this.changed();
      });
    }
    const mk = this.row(B, t('creation.part.marks'), 'marks');
    for (const id of G.marks.ids) {
      const on = (m.look.marks ?? []).includes(id);
      this.chip(mk, t(`genetics.mark.${id}`), on, `mark-${id}`).addEventListener('click', () => {
        const cur = m.look.marks ?? [];
        m.look = { ...m.look, marks: on ? cur.filter((x) => x !== id) : [...cur, id] };
        this.changed();
      });
    }
  }

  private editClothes(B: HTMLElement): void {
    const m = this.cur.m;
    const or = this.row(B, t('ng.field.outfit'), 'dyes');
    or.classList.add('wrap');
    for (const k of OUTFIT_KINDS) {
      this.chip(or, t(`genetics.outfit.${k}`), this.outfit === k, `outfit-${k}`).addEventListener('click', () => {
        this.outfit = k;
        this.changed();
      });
    }
    const ok = this.allowed(m);
    const dyeTip = (c: string) => t(`genetics.color.${c}`);
    for (const ch of ['main', 'accent', 'trim'] as const) {
      this.swatches(this.row(B, t(`ng.field.${ch}`)), ok, m.outfits[this.outfit][ch], (c) => swatchHex('cloth', c, 4), dyeTip, `dye-${ch}`, (c) => {
        m.outfits = { ...m.outfits, [this.outfit]: { ...m.outfits[this.outfit], [ch]: c } };
        this.changed();
      });
    }
  }

  private traitSlots(m: MemberSpec): number {
    if (m.stage === 'baby' || m.stage === 'toddler') return 0;
    return TRAITS.slots[coarse(m.stage)] ?? 3;
  }

  private editTraits(B: HTMLElement): void {
    const m = this.cur.m;
    const max = this.traitSlots(m);
    const head = el('div', 'fc-trait-head s', B);
    head.dataset.slots = `${m.traits.length}/${max}`;
    if (!max) {
      head.title = t('ng.traits.infant');
      head.appendChild(iconEl('cute.no', 2));
      return;
    }
    for (let i = 0; i < max; i++) el('i', `fc-slot ${i < m.traits.length ? 'on' : ''}`, head);
    const grid = el('div', 'fc-traits', B);
    const conflicts = (a: string) => TRAITS.conflicts.filter(([x, y]) => x === a || y === a).map(([x, y]) => (x === a ? y : x));
    for (const id of PERSONALITY) {
      const on = m.traits.includes(id);
      const blocked = !on && (m.traits.length >= max || conflicts(id).some((c) => m.traits.includes(c)));
      const b = btn(grid, 'fc-trait s', has(`trait.${id}.desc`) ? t(`trait.${id}.desc`) : t(`trait.${id}`), `trait-${id}`, TRAITS.traits[id].icon, t(`trait.${id}`));
      b.classList.toggle('on', on);
      b.disabled = blocked;
      b.addEventListener('click', () => {
        m.traits = on ? m.traits.filter((x) => x !== id) : [...m.traits, id];
        this.changed();
      });
    }
  }

  // ------------------------------------------------------------------ 아래 줄: 뒤로 · 검사 · 가족 무작위 · 파일 · 시작

  private buildFoot(): void {
    const F = this.foot;
    btn(F, 'ng-rbtn fc-back', t('ng.back'), 'back', 'cute.left').addEventListener('click', () => this.h.back());
    el('div', 'fc-issues', F);
    const tools = el('div', 'fc-tools g', F);
    btn(tools, 'ng-ib', t('ng.act.random_family'), 'family-random', 'cute.reroll').addEventListener('click', () => {
      const d = this.draft;
      const fresh = draftFromPreset(d.preset, this.rng);
      d.members = fresh.members;
      this.sel = 0;
      this.heads.clear();
      this.changed();
    });
    btn(tools, 'ng-ib', t('ng.act.export'), 'family-export', 'cute.save').addEventListener('click', () => {
      this.download(`${this.draft.clan || 'family'}.json`, exportFamily(draftToSpec(this.draft)));
    });
    btn(tools, 'ng-ib', t('ng.act.import'), 'family-import', 'cute.book_blue').addEventListener('click', () => {
      this.importMode = 'family';
      this.fileIn.click();
    });
    const go = btn(F, 'ng-rbtn big go fc-start', t('ng.start'), 'start', 'cute.right');
    go.addEventListener('click', () => {
      if (this.issues().length) return;
      this.h.start(this.draft);
    });
  }

  issues(): CreationIssue[] {
    return validateFamily(G, draftToSpec(this.draft)).filter((i) => (i as { severity?: string }).severity !== 'warning');
  }

  private renderIssues(): void {
    const box = this.foot.querySelector<HTMLElement>('.fc-issues')!;
    box.textContent = '';
    const list = this.issues();
    const names = new Map(this.draft.members.map((x) => [x.m.key, x.m.name]));
    const seen = new Set<string>();
    for (const i of list) {
      if (seen.has(i.code)) continue;
      seen.add(i.code);
      const row = el('div', 'fc-issue g s', box);
      row.dataset.code = i.code;
      row.appendChild(iconEl('cute.exclaim', 2));
      const who = i.members.map((k) => names.get(k)).filter(Boolean).join(', ');
      el('span', '', row, who ? `${who} · ${t(`creation.err.${i.code}`)}` : t(`creation.err.${i.code}`));
      if (i.detail) row.title = i.detail;
      if (seen.size >= 3) break;
    }
    const go = this.foot.querySelector<HTMLButtonElement>('.fc-start');
    if (go) go.disabled = list.length > 0;
  }

  // ------------------------------------------------------------------ 파일

  private download(name: string, text: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name.replace(/[\\/:*?"<>|]/g, '_');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async onFile(): Promise<void> {
    const f = this.fileIn.files?.[0];
    this.fileIn.value = '';
    if (!f) return;
    this.importText(await f.text(), this.importMode);
  }

  /** 불러오기 (E2E 도 이 길로): 실패하면 문구를 아래 줄에 */
  importText(text: string, mode: 'family' | 'person'): boolean {
    const box = this.foot.querySelector<HTMLElement>('.fc-issues')!;
    if (mode === 'family') {
      const r = importFamily(G, text);
      if (!r.ok) {
        box.textContent = '';
        const row = el('div', 'fc-issue g s', box);
        row.appendChild(iconEl('cute.exclaim', 2));
        el('span', '', row, t(`creation.import.${r.error}`));
        return false;
      }
      this.draft = draftFromSpec(r.value, this.draft);
      this.sel = 0;
      this.heads.clear();
      this.renderAll();
      return true;
    }
    const r = importPerson(G, text);
    if (!r.ok) {
      box.textContent = '';
      const row = el('div', 'fc-issue g s', box);
      row.appendChild(iconEl('cute.exclaim', 2));
      el('span', '', row, t(`creation.import.${r.error}`));
      return false;
    }
    const x = this.cur;
    x.m = { ...r.value, key: x.m.key };
    this.fixDyes(x.m);
    this.changed();
    return true;
  }

  /** 이름 뽑기 (가족 안 겹치지 않게) — 외부(테스트)용 */
  pickName(sex: 'male' | 'female'): string {
    return pickName(NAMES, this.rng, this.draft.estate, sex, this.draft.members.map((x) => x.m.name));
  }
}
