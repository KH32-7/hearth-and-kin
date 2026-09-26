/**
 * 게임 본체: 데이터 로드 → 워커 시작 → 세계/인물 그리기 → HUD/입력 → 테스트 훅.
 * sim은 워커 안에서만 돌고, 여기서는 의도(intent)만 보냄 (BRIEF 1장).
 */
import needs from '../data/needs.json';
import balance from '../data/balance.json';
import interactionsBase from '../data/interactions.json';
import objectsBase from '../data/objects.json';
import cottageTmj from '../data/lots/cottage.tmj?raw';
import emptyLot from '../data/lots/empty.json';
import { lotFromTiled, type TiledMap } from '../sim/world/tiled';
import { LEVELS, normalizeLot } from '../sim/world/lot';
import { mergeObjectDefs, type BuildData } from '../sim/data/simData';
import epicPack from '../data/artpacks/epic.json';
import lighting from '../data/lighting.json';
import start from '../data/start.json';
import emotionsData from '../data/emotions.json';
import traitsData from '../data/traits.json';
import virtuesData from '../data/virtues.json';
import stressData from '../data/stress.json';
import socialData from '../data/social.json';
import grading from '../data/grading.json';
import { applyGrade, PaletteIndex, type Grade } from '../render/color';
import type { MenuEntry } from '../sim/sim';
import type { PersonSnap, Snapshot } from '../sim/protocol';
import type { LotDef, ObjectDef } from '../sim/core/types';
import { Rng } from '../sim/core/rng';
import { Assets } from '../render/Assets';
import { GameRenderer } from '../render/GameRenderer';
import { globalLight } from '../render/SpriteMaterial';
import { setSun } from '../render/Shadows';
import { Particles } from '../render/Particles';
import { WorldView, type CutawayMode } from '../render/WorldView';
import { DirectControl } from './DirectControl';
import { CharacterView, type SheetLike } from '../render/CharacterView';
import type { WorldPack } from '../render/artpack';
import { composeCharacter, randomSpec } from '../render/lpc/compose';
import type { CharacterSpec } from '../render/lpc/types';
import { Hud, formatMoney, iconFor, registerInteractionMeta } from '../ui/Hud';
import { InnerPanel } from '../ui/InnerPanel';
import { RelationsPanel } from '../ui/RelationsPanel';
import { WorkPanel, type CareerInfo } from '../ui/WorkPanel';
import { LedgerPanel } from '../ui/LedgerPanel';
import { ThoughtBubbles } from '../ui/ThoughtBubbles';
import { ChoiceCard } from '../ui/ChoiceCard';
import { Bubbles, type BubbleRules } from '../render/Bubbles';
import fx from '../data/fx.json';
import uiAtlas from '../data/ui/atlas.json';
import { PieMenu } from '../ui/PieMenu';
import { loadSkin } from '../ui/skin';
import { missing as missingI18n, t } from '../i18n';
import { SimClient } from './SimClient';
import { BuildController } from './BuildController';
import { TownPanel } from '../ui/TownPanel';
import { Notebook } from '../ui/Notebook';
import { DialogBox } from '../ui/DialogBox';
import dialogueData from '../data/dialogue.json';
import { pickLine, pickOneliner, relationTier, type DialogueData } from '../ui/dialogue/pickLine';

type LightKey = { minute: number; rgb: number[]; darkness: number };

const OUTFIT_FALLBACK: Record<string, CharacterSpec['outfit']> = {
  everyday: 'everyday', work: 'work', formal: 'formal', sleep: 'sleep', winter: 'winter', bath: 'bath',
};

export class HearthGame {
  readonly assets = new Assets();
  readonly renderer: GameRenderer;
  readonly client = new SimClient();
  world!: WorldView;
  chars!: CharacterView;
  bubbles!: Bubbles;
  hud!: Hud;
  pie!: PieMenu;
  thoughts!: ThoughtBubbles;
  ledger!: LedgerPanel;
  private careerTexts: Record<string, { events?: Array<{ id: string; textKey: string; options: Array<{ id: string; textKey: string }> }>; nameKey: string }> = {};
  choice!: ChoiceCard;
  /** 인물 수첩 (Tab, GDD 27-8) */
  notebook!: Notebook;
  /** 대사창 (27-13) */
  dialog!: DialogBox;
  /** 건축/구매 모드 (M5). build.json 이 없으면 null */
  build: BuildController | null = null;
  private marker: HTMLElement;
  /** 부지: Tiled 지도(.tmj)에서 읽음 (BRIEF 1장 지도 형식). ?lot=empty 는 빈 부지 (M5 건축) */
  private lot: LotDef = normalizeLot(pickLot());
  /** 물건 정의: objects.json + build.json + catalog.json (sim 과 같은 합치기) */
  private defs = mergeObjectDefs(objects as unknown as Record<string, ObjectDef>, (opt('build') as BuildData | undefined) ?? null, opt('catalog')).objects;
  /** 지붕 보기: auto = 멀리 보고 인물이 밖에 있을 때, on/off 강제 */
  roofMode: 'auto' | 'on' | 'off' = 'auto';
  /** 마지막으로 받은 방 목록 (스냅샷은 바뀔 때만 실음) */
  private lastRooms: import('../sim/build/rooms').RoomInfo[] = [];
  /** 조작 인물이 있던 층 (층이 바뀌면 보기 층이 따라감) */
  private lastPersonLevel = 0;
  private pack = epicPack as unknown as WorldPack;
  selectedId = 1;
  private specs = new Map<number, CharacterSpec>();
  private sheetCache = new Map<string, SheetLike | 'loading' | 'failed'>();
  private frameTimes: number[] = [];
  /** 프레임 안에서 실제로 쓴 시간(ms): 갱신 + 그리기 명령 제출 (rAF 간격과 별도) */
  private workTimes: number[] = [];
  private lastFrame = performance.now();
  private pausedForShot = false;
  private uiHidden = false;
  private followSelected = false;
  /** 마을 모드 (M6, ?town=ashford): 지도 정의, 사람, 일과표 */
  town: TownBundle | null = null;
  /** 낙엽/먼지/반딧불 (docs/07) */
  private particles = new Particles();
  townUi: TownPanel | null = null;
  /** 마지막으로 보낸 화면 범위 (칸) — 세밀도 판정용, 4칸 이상 움직였을 때만 다시 보냄 */
  private sentView = { x0: -99, y0: -99, x1: -99, y1: -99, at: 0 };
  readonly errors: string[] = [];
  ready = false;

  constructor(private app: HTMLElement, canvas: HTMLCanvasElement) {
    this.renderer = new GameRenderer(canvas);
    this.marker = document.createElement('div');
    this.marker.className = 'marker';
    this.marker.style.display = 'none';
    app.appendChild(this.marker);
    window.addEventListener('error', (e) => this.errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => this.errors.push(String(e.reason)));
  }

  async start(): Promise<void> {
    const loading = this.showLoading();
    for (const [id, ia] of Object.entries((interactions as { interactions: Record<string, { nameKey: string; icon: string }> }).interactions)) {
      registerInteractionMeta(id, ia.nameKey, ia.icon);
    }
    // M4 합성 상호작용: 레시피(recipe.<id>), 출근(work.<직업>)
    for (const [id, r] of Object.entries(((opt('recipes') as { recipes?: Record<string, { nameKey: string; icon: string }> } | undefined)?.recipes) ?? {})) {
      if (!id.startsWith('$')) registerInteractionMeta(`recipe.${id}`, r.nameKey, r.icon);
    }
    for (const [id, c] of Object.entries(((opt('careers') as { careers?: Record<string, { icon: string }> } | undefined)?.careers) ?? {})) {
      if (!id.startsWith('$')) registerInteractionMeta(`work.${id}`, (c as { type?: string }).type === 'journey' ? 'ia.journey' : 'ia.go_work', c.icon);
      for (const sv of ((c as { services?: { pool: Array<{ id: string; nameKey: string }> } }).services?.pool ?? [])) registerInteractionMeta(`service.${id}.${sv.id}`, sv.nameKey, c.icon);
    }
    for (const [id, ia] of Object.entries((socialData as { interactions: Record<string, { nameKey: string; icon: string }> }).interactions)) {
      registerInteractionMeta(id, ia.nameKey, ia.icon);
    }
    await loadSkin(this.assets).catch((e) => this.errors.push(String(e)));

    const other = await loadOtherLot();
    if (other) this.lot = normalizeLot(other);
    this.town = await loadTown();
    if (this.town) this.lot = normalizeLot(JSON.parse(JSON.stringify(this.town.def.lot)) as LotDef);
    this.world = new WorldView(this.pack, this.assets, this.lot, this.defs);
    this.world.glowRadii = (lighting as { glowRadius: Record<string, number> }).glowRadius;
    this.world.cropIds = Object.keys(((opt('crops') as { crops?: Record<string, unknown> } | undefined)?.crops) ?? {}).filter((k) => !k.startsWith('$'));
    await this.world.load();
    this.renderer.scene.add(this.world.group);
    this.renderer.scene.add(this.particles.points, this.particles.glow);
    this.chars = new CharacterView(this.world, (p) => this.sheetFor(p));
    Object.assign(this.chars, { seatInset: fx.character.seatInset, seatCarryDrop: fx.character.seatCarryDrop });
    this.renderer.scene.add(this.chars.group);
    // 말 시트 (18-5, LPC Horses): 마을에서 말 탄 사람
    if (this.town) {
      const colors = ['brown', 'black', 'gray', 'golden', 'white'];
      this.chars.horseTextures = await Promise.all(colors.map((c) => this.assets.texture(`assets/generated/lpc/animals/horse-${c}.png`)));
    }
    const socialDefs = (socialData as { interactions: Record<string, { icon: string; category?: string }> }).interactions;
    this.bubbles = new Bubbles(uiAtlas as never, (fx as { bubbles: BubbleRules }).bubbles, iconFor, (id) => {
      const d = socialDefs[id];
      return d ? { icon: d.icon, category: d.category ?? 'friendly' } : null;
    });
    await this.bubbles.load(this.assets);
    {
      const itemsDef = ((opt('items') as { items?: Record<string, { icon: string }> } | undefined)?.items) ?? {};
      const skillsDef = ((opt('skills') as { skills?: Record<string, { icon: string }> } | undefined)?.skills) ?? {};
      this.bubbles.itemIcon = (id) => itemsDef[id]?.icon ?? `item.${id}`;
      this.bubbles.skillIcon = (id) => skillsDef[id]?.icon ?? 'emo.inspired';
    }
    this.renderer.scene.add(this.bubbles.group);
    const T = this.pack.tilePx;
    this.renderer.setWorldSize(this.lot.w * T, this.lot.h * T, this.world.bounds);
    // 시작 화면: 집(벽이 있는 영역) 가운데, 마을이면 조작 가문 시작 부지
    const startLot = this.town?.def.lots.find((l) => l.start);
    if (startLot) this.renderer.centerOn(((startLot.rect[0] + startLot.rect[2] + 1) / 2) * T, ((startLot.rect[1] + startLot.rect[3] + 1) / 2) * T);
    else this.renderer.centerOn(...this.houseCenter());

    this.hud = new Hud(this.app, {
      selectPerson: (id) => this.select(id, true),
      setSpeed: (s) => this.setSpeed(s),
      cancel: (pid, qid) => this.client.send({ type: 'cancel', personId: pid, queueItemId: qid }),
      focusPerson: (id) => this.focus(id),
      emotionColor: (e) => emotionColor(e),
      portrait: (id, kind) => (kind === 'bust' ? this.bust(id) : this.portrait(id)),
      openWindow: (w) => this.openWindow(w),
      toggleBook: (page) => this.notebook.toggle(page),
      lockWish: (personId, wish, locked) => void this.client.intent({ kind: 'lockWish', personId, wish, locked }),
      menu: (a) => this.menuAction(a),
    });
    this.hud.inner = new InnerPanel(innerDefs(), {
      lockWish: (personId, wish, locked) => void this.client.intent({ kind: 'lockWish', personId, wish, locked }),
      buyReward: (personId, reward) => void this.client.intent({ kind: 'buyReward', personId, reward }),
    });
    this.hud.relations = new RelationsPanel(neighborsList(), {
      invite: (personId, neighborId) => void this.client.intent({ kind: 'invite', personId, neighborId }),
      sendHome: (visitorId) => void this.client.intent({ kind: 'sendHome', personId: visitorId }),
      portrait: (id) => this.portrait(id),
      focusPerson: (id) => this.focus(id),
    });
    const careersDef = ((opt('careers') as { careers?: Record<string, CareerInfo> } | undefined)?.careers) ?? {};
    const skillsDef = ((opt('skills') as { skills?: Record<string, { nameKey: string; icon: string; category: string }> } | undefined)?.skills) ?? {};
    const itemsDef = ((opt('items') as { items?: Record<string, { icon: string }> } | undefined)?.items) ?? {};
    this.hud.work = new WorkPanel(
      Object.fromEntries(Object.entries(careersDef).filter(([k]) => !k.startsWith('$'))), skillsDef, (id) => itemsDef[id]?.icon ?? `item.${id}`,
      {
        setCareer: (personId, careerId) => void this.client.intent({ kind: 'setCareer', personId, careerId }),
        setAttitude: (personId, attitude) => void this.client.intent({ kind: 'setAttitude', personId, attitude }),
        setShop: (open, priceMult) => void this.client.intent({ kind: 'setShop', open, priceMult }),
      },
    );
    this.ledger = new LedgerPanel(this.app);
    if (this.town) {
      const T2 = this.pack.tilePx;
      this.townUi = new TownPanel(this.app, this.lot, this.town.def.places, this.town.def.zones, {
        lookAt: (x, y) => {
          this.followSelected = false;
          this.renderer.centerOn(x * T2, y * T2);
        },
        viewTiles: () => {
          const v = this.renderer.viewRect();
          return { x0: v.x0 / T2, y0: v.y0 / T2, x1: v.x1 / T2, y1: v.y1 / T2 };
        },
        tileToScreen: (x, y) => this.renderer.worldToScreen(x * T2, y * T2),
        zoom: () => this.renderer.zoom,
        focusPerson: (id) => this.focus(id),
        moveHouse: async (lot) => (await this.client.intent({ kind: 'moveHouse', lot })) as { ok: boolean; reason?: string },
        money: (n) => formatMoney(n),
      }, this.town.def.lots);
    }
    this.hud.onMoney = () => this.openWindow('ledger');
    this.notebook = new Notebook(this.app, {
      portrait: (id, kind) => (kind === 'bust' ? this.bust(id) : this.portrait(id)),
      selectPerson: (id) => this.select(id, true),
      focusPerson: (id) => this.focus(id),
      emotionColor: (e) => emotionColor(e),
      dialogLog: () => this.dialog.log,
    });
    Object.assign(this.notebook, { inner: this.hud.inner, relations: this.hud.relations, work: this.hud.work, ledger: this.ledger });
    this.dialog = new DialogBox(this.app);
    this.dialog.onOpen = (ids) => this.frameDialog(ids);
    this.dialogLines = (a, b, ok, ia, s, seed) => {
      const data = dialogueData as unknown as DialogueData;
      const rel = s.relations.find((r) => (r.a === a.id && r.b === b.id) || (r.a === b.id && r.b === a.id));
      const picked = pickLine(data, {
        ia, ok,
        speaker: { traits: a.inner?.traits ?? [], estate: a.inner?.estate ?? 'freeman', emotion: a.inner?.emotion, stage: coarseStage(a.inner?.stage_life) },
        listener: { traits: b.inner?.traits ?? [], estate: b.inner?.estate ?? 'freeman' },
        tier: relationTier(rel, a.household === b.household, rel?.name === 'spouse'),
        topic: a.topic,
      }, seed);
      if (!picked) return null;
      const args = { a: a.name, b: b.name };
      const fill = (k?: string) => (k ? t(k, args) : undefined);
      return { act: fill(picked.act), say: fill(picked.say)!, reply: fill(picked.reply), category: data.interactions[ia]?.category ?? 'friendly' };
    };
    if (this.townUi) this.townUi.root.classList.add('closed');
    {
      const it = ((opt('items') as { items?: Record<string, { food?: { hunger: number } }> } | undefined)?.items) ?? {};
      // 한 끼 = 허기 70 (스튜 한 그릇). 스튜거리 1 = 두 끼(한 솥 넷이 둘에서 나옴)
      this.ledger.meals = (stock) => Object.entries(stock).reduce((a, [k, v]) => a + v * ((it[k]?.food?.hunger ?? (k === 'ingredients' ? 140 : 0)) / 70), 0);
    }
    this.careerTexts = careersDef;
    this.thoughts = new ThoughtBubbles(this.app);
    this.pie = new PieMenu(this.app);
    this.choice = new ChoiceCard(this.app);
    const buildData = opt('build') as BuildData | undefined;
    if (buildData) {
      this.build = new BuildController({
        world: this.world, renderer: this.renderer, client: this.client, defs: this.defs, build: buildData, app: this.app,
        setViewLevel: (l) => this.setViewLevel(l), stepViewLevel: (d) => this.stepViewLevel(d),
        setCutaway: (m) => this.setCutaway(m), setRoofMode: (m) => this.setRoofMode(m), setSpeed: (s) => this.setSpeed(s),
      });
      this.build.panel.setMode('live');
      // 모드 버튼(생활/구매/건축)은 HUD 우상단 아이콘 띠에 (GDD 27-2)
      this.hud.modeSlot.appendChild(this.build.panel.modeBar);
      this.build.panel.setViewState({ cutaway: this.world.cutaway, level: this.world.viewLevel, roof: this.roofMode });
    }

    // 가구원 외형: 시작 시드로 결정 (Math.random 금지)
    const rng = new Rng(start.seed);
    const persons = this.town ? [] : start.members.map((m, i) => {
      const spec = randomSpec(() => rng.next(), { sex: m.sex as CharacterSpec['sex'], stage: m.stage as CharacterSpec['stage'], estate: start.estate as CharacterSpec['estate'] });
      this.specs.set(i + 1, spec);
      return { name: m.name, appearance: spec as unknown as Record<string, unknown>, estate: start.estate, sex: m.sex, stage: m.stage };
    });
    // 첫 스냅샷 전에 모든 가구원의 평상복 시트를 합성해 둠 (빈 화면 없이 시작)
    await Promise.all([...this.specs.keys()].map((id) => this.ensureSheet(id, 'everyday')));

    const first = this.client.nextSnapshot();
    this.client.send({
      type: 'init',
      data: {
        needs, balance, interactions, objects, lot: this.lot, social: socialData, inner: innerRaw(), relations: opt('relations'), neighbors: opt('neighbors'), economy: opt('economy'), items: opt('items'), skills: opt('skills'), recipes: opt('recipes'), careers: opt('careers'), crops: opt('crops'), build: opt('build'), catalog: opt('catalog'),
        ...(this.town ? { town: this.town.def, people: this.town.people, schedules: this.town.schedules, story: opt('story') } : { story: opt('story') }),
      },
      seed: start.seed,
      persons,
      relations: start.relations ?? [],
    });
    const snap = await first;
    // 빈 부지에서 시작: 작은 집 값만큼 건축 자금 (23-1 빈 부지 구입 + 집 짓기). 의도로 → 입력 로그
    const fund = (opt('build') as BuildData | undefined)?.emptyLotFund ?? 0;
    if (fund > 0 && !this.lot.walls.some(Boolean)) await this.client.intent({ kind: 'grant', amount: fund, reason: 'lot_fund' });
    this.onSnapshot(snap);
    this.client.onSnapshot((s) => this.onSnapshot(s));
    this.bindInput();
    this.installHooks();
    this.ready = true;
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 500);
    if (this.assets.failed.length) this.errors.push(t('load.failed', { n: this.assets.failed.length }));
    requestAnimationFrame(() => this.frame());
  }

  /** 화면 범위 → sim 세밀도 (13-6). 칸 단위, 4칸 이상 바뀌고 0.5초 지났을 때만 (입력 로그가 불지 않게) */
  private sendView(vr: { x0: number; y0: number; x1: number; y1: number }, now: number): void {
    const T = this.pack.tilePx;
    const v = { x0: Math.floor(vr.x0 / T), y0: Math.floor(vr.y0 / T), x1: Math.ceil(vr.x1 / T), y1: Math.ceil(vr.y1 / T) };
    const d = Math.max(Math.abs(v.x0 - this.sentView.x0), Math.abs(v.y0 - this.sentView.y0), Math.abs(v.x1 - this.sentView.x1), Math.abs(v.y1 - this.sentView.y1));
    if (d < 4 || now - this.sentView.at < 500) return;
    this.sentView = { ...v, at: now };
    void this.client.intent({ kind: 'setView', ...v });
  }

  private houseCenter(): [number, number] {
    const T = this.pack.tilePx;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    this.lot.walls.forEach((w, i) => {
      if (!w) return;
      const x = i % this.lot.w;
      const y = Math.floor(i / this.lot.w);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    });
    if (!Number.isFinite(x0)) return [(this.lot.w * T) / 2, (this.lot.h * T) / 2];
    return [((x0 + x1) / 2) * T, ((y0 + y1) / 2) * T];
  }

  private showLoading(): HTMLElement {
    const l = document.createElement('div');
    l.className = 'loading';
    l.innerHTML = `<div class="loading-box"><div class="loading-title"></div><div class="loading-sub"></div></div>`;
    l.querySelector('.loading-title')!.textContent = t('load.title');
    l.querySelector('.loading-sub')!.textContent = t('load.loading');
    this.app.appendChild(l);
    return l;
  }

  // ------------------------------------------------------------------ 인물 시트

  private sheetKey(id: number, outfit: string, expr = ''): string {
    return `${id}:${outfit}:${expr}`;
  }

  /** 감정 → 얼굴 표정 (emotions.json expr, 단계별) */
  private exprFor(p: PersonSnap): string {
    const inner = p.inner;
    if (!inner || inner.stage < 1 || p.sleeping) return '';
    // 1배 확대에서는 얼굴이 몇 픽셀이라 표정이 안 보임 → 표정 시트를 만들지 않음 (합성 비용 절약)
    if (this.renderer.zoom < 2) return '';
    // 화면 밖 사람도 표정 시트 생략
    const d = this.chars.drawnPosition(p.id);
    if (d) {
      const sp = this.renderer.worldToScreen(d.x, d.y);
      if (sp.x < -64 || sp.y < -64 || sp.x > window.innerWidth + 64 || sp.y > window.innerHeight + 128) return '';
    }
    const e = (emotionsData.emotions as Record<string, { expr?: string[] }>)[inner.emotion];
    return e?.expr?.[Math.min(2, inner.stage - 1)] ?? '';
  }

  /** 합성 대기열: 한 번에 하나씩 (40명 표정이 한꺼번에 바뀌어도 프레임이 끊기지 않게). 평상복 기본 시트 먼저 */
  private composeQueue: Array<{ id: number; outfit: string; expr: string; resolve: () => void }> = [];
  private composing = false;

  private ensureSheet(id: number, outfit: string, expr = ''): Promise<void> {
    const key = this.sheetKey(id, outfit, expr);
    if (this.sheetCache.has(key)) return Promise.resolve();
    if (!this.specs.get(id)) return Promise.resolve();
    this.sheetCache.set(key, 'loading');
    return new Promise((resolve) => {
      const job = { id, outfit, expr, resolve };
      // 기본(표정 없는) 시트는 앞으로, 표정 시트는 뒤로
      if (!expr) this.composeQueue.unshift(job);
      else this.composeQueue.push(job);
      void this.pumpCompose();
    });
  }

  private async pumpCompose(): Promise<void> {
    if (this.composing) return;
    this.composing = true;
    while (this.composeQueue.length) {
      const job = this.composeQueue.shift()!;
      await this.composeSheet(job.id, job.outfit, job.expr);
      job.resolve();
      // 다음 합성은 몇 프레임 뒤에 (합성 하나가 수십 ms 라 연달아 하면 프레임이 끊김)
      for (let f = 0; f < 3; f++) await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    this.composing = false;
  }

  private async composeSheet(id: number, outfit: string, expr: string): Promise<void> {
    const key = this.sheetKey(id, outfit, expr);
    const base = this.specs.get(id);
    if (!base) return;
    try {
      const spec: CharacterSpec = { ...base, outfit: OUTFIT_FALLBACK[outfit] ?? 'everyday', layers: { ...(base.layers ?? {}), ...(expr ? { $expr: expr } : {}) } };
      const sheet = await composeCharacter(spec, (path) => this.assets.image(path));
      this.gradeSheet(sheet.image);
      this.sheetCache.set(key, sheet as unknown as SheetLike);
    } catch (e) {
      this.sheetCache.set(key, 'failed');
      this.errors.push(`compose ${key}: ${String(e)}`);
    }
  }

  /** 화풍 맞춤 색 보정 (src/data/grading.json, tools/check-palette.ts 와 같은 함수) */
  private gradeSheet(img: HTMLCanvasElement | OffscreenCanvas): void {
    const g = (grading as unknown as { character: Grade }).character;
    const neutral = g.saturation === 1 && g.value === 1 && g.contrast === 1 && g.tint.every((v) => v === 1) && g.paletteSnap === 0;
    if (neutral) return;
    const ctx = img.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, img.width, img.height);
    if (g.paletteSnap > 0 && !this.worldPalette) this.worldPalette = new PaletteIndex(this.world.paletteColors());
    applyGrade(data.data, g, this.worldPalette ?? undefined);
    ctx.putImageData(data, 0, 0);
  }

  private worldPalette: PaletteIndex | null = null;

  private sheetFor(p: PersonSnap): SheetLike | null {
    if (!this.specs.has(p.id) && p.appearance && 'town' in p.appearance) {
      // 마을 사람 (M6): people.json 시드로 외형 (같은 사람은 늘 같은 얼굴)
      const a = p.appearance as { seed: number; sex: CharacterSpec['sex']; stage: CharacterSpec['stage']; estate: CharacterSpec['estate'] };
      const rng = new Rng((Number(a.seed) >>> 0) || p.id);
      this.specs.set(p.id, randomSpec(() => rng.next(), { sex: a.sex, stage: a.stage, estate: a.estate }));
    } else if (!this.specs.has(p.id) && p.appearance && 'neighbor' in p.appearance) {
      // 방문한 이웃: 이웃 시드로 외형 (같은 이웃은 늘 같은 얼굴)
      const nb = neighborsList().find((n) => n.id === p.appearance.neighbor);
      const rng = new Rng(Number(p.appearance.seed) * 7919 + 31);
      this.specs.set(p.id, randomSpec(() => rng.next(), { sex: (nb?.sex ?? 'male') as CharacterSpec['sex'], stage: (nb?.stage ?? 'adult') as CharacterSpec['stage'], estate: (nb?.estate ?? 'freeman') as CharacterSpec['estate'] }));
    } else if (!this.specs.has(p.id) && p.appearance && 'sex' in p.appearance) this.specs.set(p.id, p.appearance as unknown as CharacterSpec);
    // 표정 시트 → 같은 옷 기본 얼굴 → 평상복 (합성이 끝날 때까지 이전 것을 씀)
    const expr = this.exprFor(p);
    if (expr) {
      const withExpr = this.sheetCache.get(this.sheetKey(p.id, p.outfit, expr));
      if (withExpr && typeof withExpr !== 'string') return withExpr;
      if (!withExpr) void this.ensureSheet(p.id, p.outfit, expr);
    }
    const want = this.sheetCache.get(this.sheetKey(p.id, p.outfit));
    if (want && typeof want !== 'string') return want;
    if (!want) void this.ensureSheet(p.id, p.outfit);
    const base = this.sheetCache.get(this.sheetKey(p.id, 'everyday'));
    if (base && typeof base !== 'string') return base;
    if (!base) void this.ensureSheet(p.id, 'everyday');
    return null;
  }

  // ------------------------------------------------------------------ 스냅샷과 프레임

  private onSnapshot(s: Snapshot): void {
    if (s.rooms) this.lastRooms = s.rooms;
    // 건축으로 부지가 바뀜: 벽/바닥/지붕을 다시 그림
    if (s.lot) {
      this.lot = s.lot;
      this.world.setLot(s.lot);
    }
    // 조작 인물이 계단으로 층을 옮기면 보기 층이 따라감 (건축 모드에서는 그대로)
    const me = s.persons.find((p) => p.id === this.selectedId);
    if (me && !me.hidden) {
      const lv = this.world.levelOfRow(me.y);
      if (lv !== this.lastPersonLevel) {
        this.lastPersonLevel = lv;
        if (!s.build?.mode) this.setViewLevel(lv);
      }
    }
    // 지금 누가 그 물건에서 일하는 중 (작업대 active 애니메이션: 대장간 불, 물레 …)
    const busy = new Set<number>();
    for (const p of s.persons) if (p.action && p.action.phase === 'perform' && p.action.stepObj >= 0) busy.add(p.action.stepObj);
    this.world.syncObjects(s.objects, busy);
    this.world.syncDoors(s.persons.filter((p) => !p.hidden));
    this.chars.sync(s.persons, s.tick, s.tickMs, performance.now());
    if (!s.persons.some((p) => p.id === this.selectedId) && s.persons.length) this.selectedId = s.persons[0].id;
    this.chars.selectedId = this.selectedId;
    this.hud.setMode((this.build?.mode ?? 'live') as 'live' | 'buy' | 'build');
    this.hud.update(s, this.selectedId);
    this.ledger?.update(s);
    this.notebook.update(me ?? null, s);
    this.updateDialog(s);
    this.updateOneliners(s);
    document.documentElement.classList.toggle('night', this.darkness > 0.45);
    this.thoughts.ingest(s.notices, performance.now());
    this.updateChoice(s);
    this.build?.update(s);
    if (s.econ) this.build?.panel.setMoney(formatMoney(s.econ.money));
    this.townUi?.update(s);
  }

  private frame(): void {
    const now = performance.now();
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 600) this.frameTimes.shift();
    const s = this.client.snap;
    if (s) {
      // 스냅샷 사이 시간도 부드럽게 (조명)
      const frac = s.speed > 0 && !this.pausedForShot ? Math.min(1, (now - this.client.snapAt) / s.tickMs) : 0;
      this.applyLighting(s.minuteOfDay + frac);
    }
    this.direct.update(now);
    this.world.pulseHighlight(now);
    this.chars.update(now);
    if (s) this.bubbles.update(s.persons, (id) => this.chars.headAnchor(id), now);
    this.world.roofTarget = this.roofWanted();
    this.world.updateRoof(dt);
    // 외관: 우리 가족(보이는 사람)이 든 건물은 걷힘, 지붕 끔/건축 모드면 모두 걷힘
    if (this.world.shells.count) {
      // 바깥 화면에서는 외관이 늘 닫혀 있음. 실내 화면(스타듀식)에서만 그 집 외관을 걷음
      const open = new Set<number>();
      if (this.interior >= 0) open.add(this.interior);
      this.world.shells.update(dt, open, !!s?.build?.mode, this.darkness, now);
      // 닫힌 집의 실내(벽·가구·2층)는 숨기고, 여는 집만 띄움
      this.world.setRevealed(this.world.shells.revealedSet());
      this.updateInterior(dt, s);
    }
    // 바닥 청크 (M6): 화면 근처만 만들고 먼 것은 버림
    const vr = this.renderer.viewRect();
    this.world.updateChunks(vr.x0, vr.y0, vr.x1, vr.y1);
    if (this.town) this.sendView(vr, now);
    this.townUi?.frame(now);
    this.particles.update(now, vr, this.renderer.deviceZoom, this.darkness);
    this.build?.frame(now);
    this.world.animate(now, this.darkness);
    if (this.followSelected) {
      const pos = this.chars.drawnPosition(this.selectedId);
      if (pos) this.renderer.centerOn(pos.x, pos.y - 16);
    }
    this.renderer.render();
    this.updateMarker();
    this.thoughts.update(
      now,
      (id) => {
        const h = this.chars.headAnchor(id);
        return h ? this.renderer.worldToScreen(h.x, h.y - 30) : null;
      },
      (id) => !!this.client.snap?.persons.find((p) => p.id === id)?.hidden || this.uiHidden,
    );
    this.workTimes.push(performance.now() - now);
    if (this.workTimes.length > 600) this.workTimes.shift();
    requestAnimationFrame(() => this.frame());
  }

  private darkness = 0;
  private applyLighting(minute: number): void {
    const keys = (lighting as { keys: LightKey[] }).keys;
    let a = keys[0];
    let b = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (minute >= keys[i].minute && minute <= keys[i + 1].minute) {
        a = keys[i];
        b = keys[i + 1];
        break;
      }
    }
    const f = b.minute > a.minute ? (minute - a.minute) / (b.minute - a.minute) : 0;
    globalLight.uAmbient.value.setRGB(
      a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f,
      a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f,
      a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f,
    );
    this.darkness = a.darkness + (b.darkness - a.darkness) * f;
    this.renderer.fx.setTime(((minute % 1440) + 1440) % 1440, this.darkness);
    setSun(((minute % 1440) + 1440) % 1440, this.darkness);
  }

  private updateMarker(): void {
    const pos = this.chars.drawnPosition(this.selectedId);
    const snap = this.client.snap?.persons.find((p) => p.id === this.selectedId);
    if (!pos || !snap || snap.hidden || this.uiHidden) {
      this.marker.style.display = 'none';
      return;
    }
    // 머리 위 풍선이 떠 있으면 그 위로 (겹치지 않게)
    const top = this.bubbles.topOf(this.selectedId);
    const head = top !== null ? top - 4 : snap.sleeping ? pos.y - 24 : pos.y - 58;
    const sp = this.renderer.worldToScreen(pos.x, head);
    this.marker.style.display = '';
    this.marker.style.left = `${Math.round(sp.x)}px`;
    this.marker.style.top = `${Math.round(sp.y)}px`;
  }

  // ------------------------------------------------------------------ 조작

  select(id: number, center: boolean): void {
    this.selectedId = id;
    this.chars.selectedId = id;
    if (this.client.snap) this.hud.update(this.client.snap, id);
    if (center) this.focus(id);
  }

  focus(id: number): void {
    const pos = this.chars.drawnPosition(id);
    if (pos) this.renderer.centerOn(pos.x, pos.y - 16);
  }

  /** 초상 (정면 서기 첫 프레임의 머리와 어깨, 32x32). 시트가 아직 없으면 null */
  private portraits = new Map<number, HTMLCanvasElement>();
  portrait(id: number): HTMLCanvasElement | null {
    const hit = this.portraits.get(id);
    if (hit) return copyCanvas(hit);
    const sheet = this.sheetCache.get(this.sheetKey(id, 'everyday'));
    if (!sheet || typeof sheet === 'string') {
      if (!sheet) void this.ensureSheet(id, 'everyday');
      return null;
    }
    const idle = sheet.anims.idle ?? Object.values(sheet.anims)[0];
    const row = idle.row + Math.max(0, idle.dirs.indexOf('down'));
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(sheet.image as CanvasImageSource, (sheet.frameW - 32) / 2, row * sheet.frameH + 6, 32, 32, 0, 0, 32, 32);
    this.portraits.set(id, c);
    return copyCanvas(c);
  }

  /** 상반신 초상 (조작 인물 · 대사창): 정면 서기 첫 프레임 머리~가슴 36x36. 시트가 아직 없으면 null */
  private busts = new Map<number, HTMLCanvasElement>();
  bust(id: number): HTMLCanvasElement | null {
    const hit = this.busts.get(id);
    if (hit) return copyCanvas(hit);
    const sheet = this.sheetCache.get(this.sheetKey(id, 'everyday'));
    if (!sheet || typeof sheet === 'string') {
      if (!sheet) void this.ensureSheet(id, 'everyday');
      return null;
    }
    const idle = sheet.anims.idle ?? Object.values(sheet.anims)[0];
    const row = idle.row + Math.max(0, idle.dirs.indexOf('down'));
    const c = document.createElement('canvas');
    c.width = 36;
    c.height = 36;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(sheet.image as CanvasImageSource, (sheet.frameW - 36) / 2, row * sheet.frameH + 8, 36, 36, 0, 0, 36, 36);
    this.busts.set(id, c);
    return copyCanvas(c);
  }

  /** 우상단 창 버튼 (27-2): 지도는 따로 뜨고, 연대기 · 가계부 · 편지는 수첩의 그 쪽 */
  openWindow(w: 'map' | 'chronicle' | 'ledger' | 'letters' | 'menu'): void {
    if (w === 'map') {
      if (!this.townUi) return;
      const closed = this.townUi.root.classList.toggle('closed');
      this.hud.topbar.querySelector('[data-win="map"]')?.classList.toggle('on', !closed);
      return;
    }
    if (w === 'ledger' && !this.notebook.open) {
      // 돈을 누르면 따로 뜨는 가계부 (빠른 확인), 수첩에서는 생업 › 가계부 쪽
      this.ledger.toggle(this.client.snap);
      return;
    }
    this.notebook.toggle(w);
  }

  private menuAction(a: 'save' | 'load' | 'settings' | 'gallery' | 'help' | 'hideUi' | 'title'): void {
    if (a === 'hideUi') this.setUiHidden(true);
  }

  setUiHidden(hide: boolean): void {
    this.uiHidden = hide;
    this.app.classList.toggle('hide-ui', hide);
  }

  /** 대사창이 열리면 두 사람이 창 위쪽에 오게 카메라를 옮김 (27-13) */
  /** 이번 대사창이 카메라를 옮겨도 되는가 (플레이어가 시킨 대화만) */
  private dialogFrames = false;
  private frameDialog(ids: number[]): void {
    if (!this.dialogFrames) return;
    const pts = ids.map((id) => this.chars.drawnPosition(id)).filter((p): p is { x: number; y: number } => !!p);
    if (!pts.length) return;
    const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    this.followSelected = false;
    this.renderer.centerOn(mx, my + 110 / Math.max(1, this.renderer.zoom));
  }

  private seenDialog = new Set<string>();
  /** 조작 인물이 한 사회 상호작용이 끝나면 대사창 (27-13) */
  /** 플레이어가 직접 시킨 사회 상호작용 (대기열에서 autonomous=false) — "사람:상호작용:상대" */
  private playerSocial = new Set<string>();
  private updateDialog(s: Snapshot): void {
    if (!this.dialogLines) return;
    for (const p of s.persons) {
      for (const it of p.queue) if (!it.autonomous && it.interactionId.startsWith('social.')) this.playerSocial.add(`${p.id}:${it.interactionId}:${it.targetUid}`);
    }
    if (this.playerSocial.size > 200) this.playerSocial = new Set([...this.playerSocial].slice(-100));
    for (const p of s.persons) {
      const ls = p.lastSocial;
      if (!ls) continue;
      const key = `${ls.minute}:${p.id}:${ls.ia}:${ls.target}`;
      if (this.seenDialog.has(key)) continue;
      this.seenDialog.add(key);
      if (this.seenDialog.size > 400) this.seenDialog = new Set([...this.seenDialog].slice(-200));
      if (s.minute - ls.minute > 30) continue;
      if (p.id !== this.selectedId && ls.target !== this.selectedId) continue;
      const q = s.persons.find((x) => x.id === ls.target);
      if (!q) continue;
      // 대사창은 플레이어가 시킨 대화, 또는 자율이라도 로맨스 · 짓궂음 · 특별한 대화만 (잡담마다 뜨지 않게, 27-13)
      const mine = this.playerSocial.delete(`${p.id}:${ls.ia}:${ls.target}`);
      const lines = this.dialogLines(p, q, ls.ok, ls.ia, s, ls.minute * 31 + p.id * 7 + q.id);
      if (!lines) continue;
      if (!mine && !['romance', 'mean', 'special'].includes(lines.category)) continue;
      this.dialogFrames = mine;
      const colorOf = (x: PersonSnap) => emotionColor(x.inner && x.inner.stage >= 1 ? x.inner.emotion : 'neutral');
      this.dialog.talk({
        minute: ls.minute, ids: [p.id, q.id], ok: ls.ok, category: lines.category,
        speaker: { name: p.name, color: colorOf(p), bust: this.bust(p.id) },
        listener: { name: q.name, color: colorOf(q), bust: this.bust(q.id) },
        act: lines.act, say: lines.say, reply: lines.reply,
      });
    }
  }

  /** 한마디 (27-13): 식구 욕구가 위급해질 때, 잠에서 깰 때 … 같은 사람은 게임 3시간에 한 번까지 */
  private lastOneliner = new Map<number, number>();
  private prevNeedLow = new Map<string, boolean>();
  private prevSleeping = new Map<number, boolean>();
  private updateOneliners(s: Snapshot): void {
    const me = s.persons.find((p) => p.id === this.selectedId);
    if (!me) return;
    const data = dialogueData as unknown as DialogueData;
    for (const p of s.persons) {
      if (p.household !== me.household || p.visitor || p.hidden) continue;
      let situation: string | null = null;
      for (const n of ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social', 'warmth', 'comfort']) {
        const low = (p.needs[n] ?? 100) < 15;
        const k = `${p.id}:${n}`;
        if (low && this.prevNeedLow.get(k) === false) situation = `need.${n}`;
        this.prevNeedLow.set(k, low);
      }
      const wasSleeping = this.prevSleeping.get(p.id);
      if (wasSleeping && !p.sleeping) situation = 'wake';
      this.prevSleeping.set(p.id, p.sleeping);
      if (p.lastWork && s.minute - p.lastWork.minute < 2 && p.lastWork.wage > 0) situation = 'got_paid';
      if (!situation) continue;
      if (s.minute - (this.lastOneliner.get(p.id) ?? -1e9) < 180) continue;
      const picked = pickOneliner(data, situation, { traits: p.inner?.traits ?? [], estate: p.inner?.estate ?? 'freeman', emotion: p.inner?.emotion, stage: coarseStage(p.inner?.stage_life) }, s.minute * 13 + p.id);
      if (!picked) continue;
      this.lastOneliner.set(p.id, s.minute);
      const args = { a: p.name, b: me.name };
      this.dialog.oneliner({
        minute: s.minute, ids: [p.id], name: p.name, color: emotionColor(p.inner && p.inner.stage >= 1 ? p.inner.emotion : 'neutral'),
        head: this.portrait(p.id), act: t(picked.act, args), text: t(picked.say, args),
      });
      break;
    }
  }

  /** 대사 고르기 (규칙 기반 문장 풀, src/ui/dialogue). 아직 연결 전이면 null */
  private dialogLines: ((a: PersonSnap, b: PersonSnap, ok: boolean, ia: string, s: Snapshot, seed: number) => { act?: string; say: string; reply?: string; category: string } | null) | null = null;

  cycle(dir: number): void {
    const me = this.client.snap?.persons.find((p) => p.id === this.selectedId);
    const persons = (this.client.snap?.persons ?? []).filter((p) => p.household === (me?.household ?? 1));
    if (!persons.length) return;
    const i = persons.findIndex((p) => p.id === this.selectedId);
    const next = persons[(i + dir + persons.length) % persons.length];
    this.select(next.id, true);
  }

  setSpeed(s: number): void {
    this.client.send({ type: 'setSpeed', speed: s });
  }

  setCutaway(mode: CutawayMode): void {
    this.world.setCutaway(mode);
    this.build?.panel.setViewState({ cutaway: mode, level: this.world.viewLevel, roof: this.roofMode });
  }

  /** 보는 층 (23-2 층 전환 버튼): 0 1층, 1 2층, 2 3층, -1 지하 */
  setViewLevel(level: number): void {
    this.world.setViewLevel(level);
    this.build?.panel.setViewState({ cutaway: this.world.cutaway, level: this.world.viewLevel, roof: this.roofMode });
  }

  stepViewLevel(dir: number): void {
    const order = [-1, 0, 1, 2];
    const i = order.indexOf(this.world.viewLevel);
    const next = order[Math.max(0, Math.min(order.length - 1, i + dir))];
    this.setViewLevel(next);
  }

  setRoofMode(mode: 'auto' | 'on' | 'off'): void {
    this.roofMode = mode;
    this.build?.panel.setViewState({ cutaway: this.world.cutaway, level: this.world.viewLevel, roof: mode });
  }

  /** 지붕 목표 (23-2 시점 처리): 멀리서 보고 조작 인물이 집 밖이면 보이고, 가까이 보거나 인물이 들어가면 투명 */
  // ------------------------------------------------------------------ 실내 화면 (스타듀식, V)

  /** 보고 있는 집 (외관 번호), -1 바깥 */
  interior = -1;
  /** 실내로 데려간 가족 (그 사람이 집을 나가면 바깥 화면으로). -1 = 직접 연 집 (검사/카메라) */
  private interiorOwner = -1;
  private interiorLevel = 0;
  private interiorK = 0;
  private fadeEl: HTMLDivElement | null = null;
  private outsideCam: { x: number; y: number; zoom: number } | null = null;

  /** V: 선택한 가족이 집 안/문 앞이면 그 집 실내로, 실내면 바깥으로 (검은 화면 전환) */
  toggleInterior(): void {
    const me = this.client.snap?.persons.find((p) => p.id === this.selectedId);
    if (this.interior >= 0) return this.switchView(-1);
    if (!me) return;
    const k = this.world.shells.nearDoor(Math.floor(me.x), Math.floor(me.y) % this.lotRows());
    if (k >= 0) {
      this.interiorOwner = me.id;
      this.switchView(k);
    }
  }

  /**
   * 실내 보기 방식 (사용자 비교용, ?inside=a|b, I 키로 바꿈)
   *  a = 제자리 지붕 들어 올리기 (Grass Land 2.0 오두막): 화면 전환 없이 그 집 외관이 들리며 사라지고 발자국 크기 그대로의 실내가 드러남
   *  b = 스타듀식 화면 전환 (검은 화면 → 그 집 실내만, 바깥은 어둠)
   */
  // 사용자 선택 (2026-09-26): A 가 기본, ?inside=b 로 B
  insideMode: 'a' | 'b' = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('inside') === 'b') ? 'b' : 'a';
  toggleInsideMode(): void {
    const k = this.interior;
    if (k >= 0) this.switchView(-1);
    this.insideMode = this.insideMode === 'a' ? 'b' : 'a';
    console.info('실내 보기 방식', this.insideMode);
  }

  private switchView(k: number): void {
    this.world.shells.mode = this.insideMode === 'a' ? 'lift' : 'fade';
    if (this.insideMode === 'a') return this.liftView(k);
    if (!this.fadeEl) {
      this.fadeEl = document.createElement('div');
      this.fadeEl.className = 'view-fade';
      this.app.appendChild(this.fadeEl);
    }
    const f = this.fadeEl;
    f.classList.add('on');
    setTimeout(() => {
      const T = this.pack.tilePx;
      if (k >= 0) {
        if (this.interior < 0) this.outsideCam = { x: this.renderer.camX, y: this.renderer.camY, zoom: this.renderer.zoom };
        this.interior = k;
        const r = this.world.shells.footRect(k)!;
        this.followSelected = false;
        this.renderer.setZoom(Math.max(3, this.renderer.zoom));
        // 벽 윗면까지 보이게 사각형 가운데 조금 위
        // 데려간 가족이 있는 층부터 (없으면 1층)
        const owner = this.client.snap?.persons.find((p) => p.id === this.interiorOwner);
        this.setViewLevel(owner ? Math.max(0, this.world.levelOfRow(owner.y)) : 0);
        this.interiorLevel = this.world.viewLevel;
        const yo = this.world.yOff(LEVELS.indexOf(this.world.viewLevel));
        this.renderer.centerOn(((r[0] + r[2] + 1) / 2) * T, ((r[1] + r[3] + 1) / 2) * T - 24 - yo);
        this.setCutaway('cut');
        this.world.setInteriorRect(r);
      } else {
        this.interior = -1;
        this.interiorOwner = -1;
        this.world.setInteriorRect(null);
        this.setViewLevel(0);
        if (this.outsideCam) {
          this.renderer.setZoom(this.outsideCam.zoom);
          this.renderer.centerOn(this.outsideCam.x, this.outsideCam.y);
        }
      }
      setTimeout(() => f.classList.remove('on'), 60);
    }, 260);
  }

  /** A: 화면 전환 없이 제자리. 카메라만 그 집으로 부드럽게 (줌 2 이상), 바깥은 조금만 어둡게 */
  private liftView(k: number): void {
    const T = this.pack.tilePx;
    if (k >= 0) {
      if (this.interior < 0) this.outsideCam = { x: this.renderer.camX, y: this.renderer.camY, zoom: this.renderer.zoom };
      this.interior = k;
      const r = this.world.shells.footRect(k)!;
      this.followSelected = false;
      if (this.renderer.zoom < 2) this.renderer.setZoom(2);
      const owner = this.client.snap?.persons.find((p) => p.id === this.interiorOwner);
      this.setViewLevel(owner ? Math.max(0, this.world.levelOfRow(owner.y)) : 0);
      this.interiorLevel = this.world.viewLevel;
      const yo = this.world.yOff(LEVELS.indexOf(this.world.viewLevel));
      this.camGlide = { x: ((r[0] + r[2] + 1) / 2) * T, y: ((r[1] + r[3] + 1) / 2) * T - 24 - yo };
      this.setCutaway('cut');
      // 마을은 그대로 보이게 (2층을 보면 아래층은 흐리게)
      this.world.setInteriorRect(r, false);
    } else {
      this.interior = -1;
      this.interiorOwner = -1;
      this.world.setInteriorRect(null);
      this.setViewLevel(0);
    }
  }
  private camGlide: { x: number; y: number } | null = null;
  private roomPx: { k: number; lv: number; rect: [number, number, number, number] | null } | null = null;

  private updateInterior(dt: number, s: Snapshot | null | undefined): void {
    if (this.camGlide) {
      const g = this.camGlide, k = Math.min(1, dt / 180);
      const x = this.renderer.camX + (g.x - this.renderer.camX) * k, y = this.renderer.camY + (g.y - this.renderer.camY) * k;
      this.renderer.centerOn(x, y);
      if (Math.abs(g.x - x) < 1 && Math.abs(g.y - y) < 1) this.camGlide = null;
    }
    // A 는 바깥을 조금만 어둡게 (마을이 그대로 보임), B 는 거의 검게
    // A 에서 2층을 보면 아래 마을은 가림 (다른 집 2층이 지붕 위로 비치지 않게): 그 층만 + 바깥 어둠
    const upA = this.insideMode === 'a' && this.interior >= 0 && this.world.viewLevel > 0;
    if (this.insideMode === 'a' && this.interior >= 0 && this.world.soloLevel !== upA) this.world.setInteriorRect(this.world.shells.footRect(this.interior), upA);
    const target = this.interior >= 0 ? (this.insideMode === 'a' && !upA ? 0.45 : 1) : 0;
    this.interiorK += (target - this.interiorK) * Math.min(1, dt / 120);
    const u = this.renderer.fx.mat.uniforms;
    u.uRoomK.value = this.interiorK;
    const T = this.pack.tilePx;
    if (this.interior >= 0) {
      const r = this.world.shells.footRect(this.interior)!;
      const me = s?.persons.find((p) => p.id === this.interiorOwner);
      // 가족이 계단을 오르내리면 그 층으로 (PageUp/PageDown 으로 직접 바꿔도 됨)
      if (me && !me.hidden) {
        const lv = Math.max(0, this.world.levelOfRow(me.y));
        if (lv !== this.interiorLevel) this.setViewLevel(lv);
      }
      const yo = this.world.yOff(LEVELS.indexOf(this.world.viewLevel));
      if (this.interiorLevel !== this.world.viewLevel) {
        this.interiorLevel = this.world.viewLevel;
        this.renderer.centerOn(((r[0] + r[2] + 1) / 2) * T, ((r[1] + r[3] + 1) / 2) * T - 24 - yo);
      }
      // 벽 높이(80px)만큼 위로, 옆벽 두께 포함, 층 높이만큼 올림
      // 가리개 = 그 방 벽 그림의 실제 테두리 (없으면 칸 사각형 + 벽 높이)
      if (!this.roomPx || this.roomPx.k !== this.interior || this.roomPx.lv !== this.world.viewLevel) this.roomPx = { k: this.interior, lv: this.world.viewLevel, rect: this.world.roomPixelRect(r, this.world.viewLevel) };
      const px = this.roomPx.rect;
      if (px) (u.uRoom.value as import('three').Vector4).set(px[0], px[1], px[2], px[3]);
      else (u.uRoom.value as import('three').Vector4).set(r[0] * T - 2, r[1] * T - 88 - yo, (r[2] + 1) * T + 2, (r[3] + 1) * T - yo);
      // 가족이 집을 나가면 바깥 화면으로
      if (me && !me.hidden && this.world.shells.nearDoor(Math.floor(me.x), Math.floor(me.y) % this.lotRows()) !== this.interior) this.switchView(-1);
    } else if (this.interiorK < 0.02) (u.uRoom.value as import('three').Vector4).set(0, 0, -1, -1);
    this.particles.points.visible = this.particles.glow.visible = this.interior < 0;
  }

  /** 1층 판 한 장의 행 수 + 틈 줄 (여러 층 좌표를 1층 판 칸으로) */
  private lotRows(): number {
    return this.world.lotH + 1;
  }

  private roofWanted(): number {
    if (this.roofMode === 'on') return 1;
    if (this.roofMode === 'off' || this.client.snap?.build?.mode) return 0;
    const me = this.client.snap?.persons.find((p) => p.id === this.selectedId);
    const g = this.world.lotGrid;
    const inside = !!me && !me.hidden && !!g && g.roomOf(Math.floor(me.x), Math.floor(me.y)) >= 0;
    return this.renderer.zoom <= 1 && !inside ? 1 : 0;
  }

  private async openMenuAt(clientX: number, clientY: number, uid: number): Promise<void> {
    const entries = await this.client.menu(this.selectedId, uid);
    const obj = this.client.snap?.objects.find((o) => o.uid === uid);
    const title = obj ? t(this.defs[obj.defId]?.nameKey ?? `object.${obj.defId}`) : '';
    if (!entries.length) return;
    const act = (e: MenuEntry) => void this.client.queue(this.selectedId, e.interactionId, uid);
    // 제작 레시피가 많은 작업대(화로 20종 …): 분류(요리/보존/제빵 …) → 항목 두 단계
    const grouped = entries.filter((e) => e.group);
    if (entries.length > 8 && grouped.length > 4) {
      const plain = entries.filter((e) => !e.group);
      const groups = [...new Set(grouped.map((e) => e.group!))];
      const cats: MenuEntry[] = groups.map((g) => {
        const list = grouped.filter((e) => e.group === g);
        return { interactionId: `__grp:${g}`, nameKey: `recipe.group.${g}`, icon: list[0].icon, available: list.some((e) => e.available), count: list.filter((e) => e.available).length };
      });
      const showGroup = (g: string) => {
        const list = grouped.filter((e) => e.group === g).sort((a, b) => Number(b.available) - Number(a.available));
        const back: MenuEntry = { interactionId: '__back', nameKey: 'ui.back', icon: 'goto', available: true };
        this.pie.show(clientX, clientY, `${title} · ${t(`recipe.group.${g}`)}`, [back, ...list], (e) => (e.interactionId === '__back' ? showRoot() : act(e)));
      };
      const showRoot = () => this.pie.show(clientX, clientY, title, [...plain, ...cats], (e) => (e.interactionId.startsWith('__grp:') ? showGroup(e.interactionId.slice(6)) : act(e)));
      showRoot();
      return;
    }
    this.pie.show(clientX, clientY, title, entries, act);
  }

  private async openPersonMenu(clientX: number, clientY: number, targetId: number): Promise<void> {
    const entries = await this.client.menuPerson(this.selectedId, targetId);
    const target = this.client.snap?.persons.find((p) => p.id === targetId);
    if (!entries.length || !target) return;
    // 80종이 넘으므로 심즈처럼 분류 → 항목 두 단계 (GDD 14-3 분류)
    const order = ['basic', 'friendly', 'romance', 'mean', 'status', 'trade', 'special'];
    const catIcon: Record<string, string> = { basic: 'social', friendly: 'emo.happy', romance: 'topic.love', mean: 'emo.angry', status: 'ui.crest', trade: 'ui.coin', special: 'emo.inspired' };
    const groups = new Map<string, MenuEntry[]>();
    for (const e of entries) {
      const c = e.category ?? 'friendly';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push(e);
    }
    const cats: MenuEntry[] = order.filter((c) => groups.has(c)).map((c) => {
      const list = groups.get(c)!;
      return { interactionId: `__cat:${c}`, nameKey: `social.cat.${c}`, icon: catIcon[c], available: list.some((e) => e.available), reasonKey: 'reason.target_busy', count: list.filter((e) => e.available).length, category: c };
    });
    const showCat = (c: string) => {
      const list = groups.get(c)!;
      // 할 수 있는 것 먼저, 확률 높은 순
      list.sort((a, b) => Number(b.available) - Number(a.available) || (b.chance ?? 0) - (a.chance ?? 0));
      const back: MenuEntry = { interactionId: '__back', nameKey: 'ui.back', icon: 'goto', available: true };
      this.pie.show(clientX, clientY, `${target.name} · ${t(`social.cat.${c}`)}`, [back, ...list], (e: MenuEntry) => {
        if (e.interactionId === '__back') showRoot();
        else void this.client.queue(this.selectedId, e.interactionId, targetId);
      });
    };
    const showRoot = () => this.pie.show(clientX, clientY, target.name, cats, (e: MenuEntry) => showCat(e.interactionId.slice(6)));
    if (cats.length === 1) showCat(cats[0].interactionId.slice(6));
    else showRoot();
  }

  /** 무너짐 선택 카드: 가구원 중 선택 대기인 사람이 있으면 그 사람으로 화면을 옮기고 카드 */
  private updateChoice(s: Snapshot): void {
    const p = s.persons.find((q) => q.inner?.pendingChoice === 'breakdown');
    if (!p) {
      // 일터 사건 카드 (24-1): 식구 중 선택 대기
      const w = s.persons.find((q) => q.careerEvent && q.household === 1);
      const ev = w ? this.careerTexts[w.careerEvent!.careerId]?.events?.find((e) => e.id === w.careerEvent!.eventId) : undefined;
      if (w && ev) {
        if (this.choice.open) return;
        this.choice.show(`career:${w.id}:${ev.id}`, `${w.name} · ${t(this.careerTexts[w.careerEvent!.careerId].nameKey)}`, t(ev.textKey),
          ev.options.map((o) => ({ id: o.id, nameKey: o.textKey, descKey: '', icon: 'ui.crest' })),
          (option) => void this.client.intent({ kind: 'careerChoice', personId: w.id, option }), { portrait: this.bust(w.id), speaker: w.name });
        return;
      }
      if (this.choice.open) this.choice.hide();
      return;
    }
    if (this.choice.open) return;
    this.select(p.id, true);
    const opts = Object.entries((stressData as { options: Record<string, { nameKey: string; descKey: string; icon: string }> }).options)
      .map(([id, o]) => ({ id, nameKey: o.nameKey, descKey: o.descKey, icon: o.icon }));
    this.choice.show(`breakdown:${p.id}`, t('breakdown.title', { name: p.name }), t('breakdown.body'), opts, (option) => {
      void this.client.intent({ kind: 'choose', personId: p.id, option });
    }, { portrait: this.bust(p.id) });
  }

  private bindInput(): void {
    const canvas = this.renderer.canvas;
    let drag: { x: number; y: number; moved: boolean; button: number } | null = null;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // 건축/구매 모드: 왼쪽 버튼은 도구, 오른쪽/가운데 끌기는 화면 이동
    const buildTool = (e: PointerEvent) => !!this.build?.active && e.button === 0;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
      if (buildTool(e)) {
        const w = this.renderer.screenToWorld(e.clientX, e.clientY);
        this.build!.pointerDown(w.x, w.y, e.shiftKey);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.build?.active) {
        this.world.setHighlight(null);
        const w = this.renderer.screenToWorld(e.clientX, e.clientY);
        this.build.pointerMove(w.x, w.y);
        if (drag && drag.button === 0) return;
      }
      if (!drag) {
        this.updateHover(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      this.followSelected = false;
      this.renderer.pan(dx, dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = drag;
      drag = null;
      if (d && this.build?.active && d.button === 0) {
        const w = this.renderer.screenToWorld(e.clientX, e.clientY);
        this.build.pointerUp(w.x, w.y, e.shiftKey);
        return;
      }
      if (d && this.build?.active && d.button === 2 && !d.moved) {
        // 오른쪽 클릭: 들고 있는 물건 내려놓기 취소
        this.build.key(new KeyboardEvent('keydown', { key: 'Escape' }));
        return;
      }
      if (!d || d.moved || d.button !== 0) return;
      this.click(e.clientX, e.clientY);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.renderer.screenToWorld(e.clientX, e.clientY);
      this.renderer.setZoom(this.renderer.zoom + (e.deltaY < 0 ? 1 : -1));
      const after = this.renderer.screenToWorld(e.clientX, e.clientY);
      this.renderer.centerOn(this.renderer.camX + before.x - after.x, this.renderer.camY + before.y - after.y);
    }, { passive: false });
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (this.build?.key(e)) {
        e.preventDefault();
        return;
      }
      if (this.direct.keyDown(e)) {
        e.preventDefault();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        this.notebook.toggle();
        return;
      }
      if (e.key === 'Escape' && (this.notebook.open || this.dialog.open || this.hud.currentPopup)) {
        this.notebook.close();
        this.hud.setPopup(null);
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        this.cycle(e.shiftKey ? -1 : 1);
      } else if (e.key === 'h' || e.key === 'H') this.setUiHidden(!this.uiHidden);
      else if (e.key === 'm' || e.key === 'M') this.openWindow('map');
      else if (e.key === '0') this.setSpeed(0);
      else if (e.key === 'p' || e.key === 'P') this.setSpeed(this.client.snap?.speed === 0 ? Math.max(1, this.pendingSpeedBeforePause) : 0);
      else if (e.key === '1' || e.key === '2' || e.key === '3') this.setSpeed(Number(e.key));
      else if (e.key === 'Escape') this.pie.close();
      else if (e.key === 'v' || e.key === 'V') this.toggleInterior();
      else if (e.key === 'i' || e.key === 'I') this.toggleInsideMode();
      else if (e.key === 'f' || e.key === 'F') this.followSelected = !this.followSelected;
      else if (e.key === 'PageUp') this.stepViewLevel(1);
      else if (e.key === 'PageDown') this.stepViewLevel(-1);
      else if (e.key === 'r' || e.key === 'R') this.setRoofMode(this.roofMode === 'auto' ? 'on' : this.roofMode === 'on' ? 'off' : 'auto');
      else if (e.key === 'c' || e.key === 'C') {
        const order: CutawayMode[] = ['cut', 'down', 'up'];
        this.setCutaway(order[(order.indexOf(this.world.cutaway) + 1) % order.length]);
      } else {
        const step = 48;
        const pan: Record<string, [number, number]> = {
          ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
        };
        const v = pan[e.key];
        if (v) {
          this.followSelected = false;
          this.renderer.pan(v[0], v[1]);
        }
      }
    });
    window.addEventListener('keyup', (e) => this.direct.keyUp(e));
    window.addEventListener('blur', () => this.direct.reset());
    canvas.addEventListener('pointerleave', () => this.world.setHighlight(null));
    this.client.onSnapshot((s) => {
      if (s.speed > 0) this.pendingSpeedBeforePause = s.speed;
    });
  }

  // ------------------------------------------------------------------ 직접 조작 (WASD 이동, E 상호작용)

  private readonly direct = new DirectControl({
    selectedId: () => (this.client.snap?.persons.some((p) => p.id === this.selectedId) ? this.selectedId : null),
    blocked: () => !!this.build?.active || this.notebook.open || this.dialog.open || this.pie.open || this.choice.open,
    steer: (personId, dx, dy) => void this.client.intent({ kind: 'steer', personId, dx, dy }),
    interactNearest: () => this.interactNearest(),
    follow: () => {
      this.followSelected = true;
    },
  });

  /** 상호작용이 있는 물건 종류 (수리만 있는 장식은 뺌): 외곽선과 E 대상 */
  private interactableKinds: Set<string> | null = null;
  private isInteractable(defId: string): boolean {
    if (!this.interactableKinds) {
      this.interactableKinds = new Set();
      for (const [id, ia] of Object.entries(interactions.interactions as Record<string, { objects?: string[]; autonomous?: boolean }>)) {
        if (id === 'obj.repair') continue;
        for (const o of ia.objects ?? []) this.interactableKinds.add(o);
      }
    }
    const kind = (this.defs[defId] as { kind?: string } | undefined)?.kind ?? defId;
    return this.interactableKinds.has(defId) || this.interactableKinds.has(kind);
  }

  /** E: 조작 인물 가까이(2.5칸 안, 같은 층) 상호작용 물건 중 바라보는 쪽·가까운 것의 원형 메뉴. 물건이 없으면 가까운 사람 */
  private interactNearest(): void {
    const s = this.client.snap;
    const me = s?.persons.find((p) => p.id === this.selectedId);
    if (!s || !me) return;
    const H1 = this.lotRows();
    const slab = Math.floor(me.y / H1);
    const fx = me.facing === 'left' ? -1 : me.facing === 'right' ? 1 : 0;
    const fy = me.facing === 'up' ? -1 : me.facing === 'down' ? 1 : 0;
    let best: { uid: number; score: number } | null = null;
    for (const o of s.objects) {
      if (Math.floor(o.y / H1) !== slab || !this.isInteractable(o.defId)) continue;
      const fp = this.defs[o.defId]?.footprint ?? { w: 1, h: 1 };
      const nx = Math.max(o.x, Math.min(o.x + fp.w, me.x));
      const ny = Math.max(o.y, Math.min(o.y + fp.h, me.y));
      const d = Math.hypot(nx - me.x, ny - me.y);
      if (d > 2.5) continue;
      // 바라보는 쪽이면 가깝게 침
      const ahead = (nx - me.x) * fx + (ny - me.y) * fy;
      const score = d - (ahead > 0 ? 0.8 : 0);
      if (!best || score < best.score) best = { uid: o.uid, score };
    }
    const r = this.renderer.canvas.getBoundingClientRect();
    if (best) {
      const rect = this.world.objectRect(best.uid);
      if (rect) {
        const T = this.world.tile;
        const sp = this.renderer.worldToScreen((rect.x + rect.w / 2) * T, (rect.y + rect.h / 2) * T);
        void this.openMenuAt(sp.x + r.left, sp.y + r.top, best.uid);
        return;
      }
    }
    const other = s.persons
      .filter((p) => p.id !== me.id && Math.floor(p.y / H1) === slab && Math.hypot(p.x - me.x, p.y - me.y) <= 2.5)
      .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
    if (other) {
      const pos = this.chars.drawnPosition(other.id);
      if (pos) {
        const sp = this.renderer.worldToScreen(pos.x, pos.y - 30);
        void this.openPersonMenu(sp.x + r.left, sp.y + r.top, other.id);
      }
    }
  }

  private pendingSpeedBeforePause = 1;

  private updateHover(cx: number, cy: number): void {
    const w = this.renderer.screenToWorld(cx, cy);
    const person = this.chars.pick(w.x, w.y);
    const uid = person === null ? this.world.pick(w.x, w.y) : null;
    const obj = uid !== null ? this.client.snap?.objects.find((o) => o.uid === uid) : undefined;
    // 상호작용할 수 있는 물건에 마우스를 올리면 외곽선
    this.world.setHighlight(obj && this.isInteractable(obj.defId) ? obj.uid : null);
    this.renderer.canvas.style.cursor = person !== null || uid !== null ? 'pointer' : 'default';
  }

  private click(cx: number, cy: number): void {
    if (this.pie.open) {
      this.pie.close();
      return;
    }
    const w = this.renderer.screenToWorld(cx, cy);
    const pid = this.chars.pick(w.x, w.y);
    // 심즈처럼: 다른 사람을 누르면 사회 원형 메뉴. 조작 중인 사람을 누르면 그 아래 물건/길 끝을 누른 것으로 (전환은 초상화/Space)
    if (pid !== null && pid !== this.selectedId) {
      void this.openPersonMenu(cx, cy, pid);
      return;
    }
    const uid = this.world.pick(w.x, w.y);
    if (uid !== null) {
      void this.openMenuAt(cx, cy, uid);
      return;
    }
    const cell = this.world.screenToCell(w.x, w.y);
    if (!cell) return;
    const tx = cell.x;
    const ty = cell.y;
    // 부지 출구(길 끝) 칸을 누르면 "외출" 메뉴: 장보기, 방앗간, 채집, 일하러 가기 …
    const exit = this.client.snap?.objects.find((o) => o.defId === 'lot_exit' && Math.abs(o.x - tx) <= 1 && Math.abs(o.y - ty) <= 1);
    if (exit) {
      void this.openMenuAt(cx, cy, exit.uid);
      return;
    }
    void this.client.goto(this.selectedId, tx, ty);
  }

  /** 부지 출구 화면 위치 (테스트 훅) */
  exitScreenPos(): { x: number; y: number; uid: number } | null {
    const o = this.client.snap?.objects.find((q) => q.defId === 'lot_exit');
    if (!o) return null;
    const pr = this.world.project(o.x + 0.5, o.y + 0.5);
    const sp = this.renderer.worldToScreen(pr.x, pr.y);
    return { x: sp.x, y: sp.y, uid: o.uid };
  }

  // ------------------------------------------------------------------ 테스트 훅 (BRIEF 3장)

  private installHooks(): void {
    const c = this.client;
    const req = <T>(build: (reqId: number) => Parameters<SimClient['send']>[0]) => c.request<T>(build);
    let spawnCount = 0;
    const game = {
      ready: () => this.ready,
      setSeed: (seed: number) => req((reqId) => ({ type: 'reseed', seed, reqId })),
      setSpeed: (s: number) => this.setSpeed(s),
      setDate: (minuteOfDay: number) => req((reqId) => ({ type: 'setTime', minuteOfDay, reqId })),
      setTime: (minuteOfDay: number) => req((reqId) => ({ type: 'setTime', minuteOfDay, reqId })),
      fastForward: (minutes: number) => req((reqId) => ({ type: 'fastForward', minutes, reqId })),
      fastForwardDays: (n: number) => req((reqId) => ({ type: 'fastForward', minutes: n * 1440, reqId })),
      pause: (paused: boolean) => req((reqId) => ({ type: 'pause', paused, reqId })),
      spawnPerson: async (spec: { name: string; appearance?: Partial<CharacterSpec>; x?: number; y?: number }) => {
        // 호출마다 다른 외형 (같은 틱에 여러 명을 만들어도 똑같지 않게)
        const rng = new Rng((c.snap?.tick ?? 0) * 7919 + ++spawnCount * 104729 + 17);
        const full = { ...randomSpec(() => rng.next(), {}), ...(spec.appearance ?? {}) } as CharacterSpec;
        const r = await req<{ id: number }>((reqId) => ({ type: 'spawn', name: spec.name, appearance: full as unknown as Record<string, unknown>, x: spec.x, y: spec.y, reqId }));
        this.specs.set(r.id, full);
        await this.ensureSheet(r.id, 'everyday');
        return r;
      },
      setNeed: (personId: number, need: string, value: number) => req((reqId) => ({ type: 'setNeed', personId, need, value, reqId })),
      setObjectState: (uid: number, state: Record<string, number | boolean>) => req((reqId) => ({ type: 'setObjectState', uid, state, reqId })),
      setAutonomy: (enabled: boolean) => req((reqId) => ({ type: 'setAutonomy', enabled, reqId })),
      queue: (personId: number, interactionId: string, targetUid: number) => c.queue(personId, interactionId, targetUid),
      select: (id: number) => this.select(id, true),
      getState: () => this.getState(),
      intent: (intent: Record<string, unknown>) => c.intent(intent),
      thoughtTexts: () => this.thoughts.texts(),
      setTab: (tab: string) => this.hud.setTab(tab as never),
      personMenuPos: (id: number) => {
        const p = this.chars.drawnPosition(id);
        return p ? this.renderer.worldToScreen(p.x, p.y - 30) : null;
      },
      getStats: () => req((reqId) => ({ type: 'stats', reqId })),
      getWorldHash: async () => (await req<{ hash: string }>((reqId) => ({ type: 'stats', reqId }))).hash,
      captureState: (label: string) => ({ label, ...this.getState() }),
      hideUI: (hide = true) => this.setUiHidden(hide),
      openBook: (page?: string) => this.notebook.show(page),
      closeBook: () => this.notebook.close(),
      setPopup: (k: string | null) => this.hud.setPopup(k as never),
      setZoom: (z: number) => this.renderer.setZoom(z),
      centerOn: (x: number, y: number) => this.renderer.centerOn(x, y),
      setCutaway: (m: CutawayMode) => this.setCutaway(m),
      /** E2E: 물건/사람의 화면 좌표 (실제 마우스 클릭용) */
      objectScreenPos: (defId: string) => this.objectScreenPos(defId),
      exitScreenPos: () => this.exitScreenPos(),
      // M5 건축: 칸 가운데 화면 좌표 (보는 층 높이 반영, 브라우저 client 좌표), 보기 층, 건축 상태
      cellScreenPos: (x: number, y: number) => {
        const p = this.world.project(x + 0.5, y + 0.5);
        const sp = this.renderer.worldToScreen(p.x, p.y);
        const r = this.renderer.canvas.getBoundingClientRect();
        return { x: sp.x + r.left, y: sp.y + r.top };
      },
      setViewLevel: (l: number) => this.setViewLevel(l),
      setRoofMode: (m: 'auto' | 'on' | 'off') => this.setRoofMode(m),
      buildState: () => ({
        mode: this.build?.mode, level: this.world.viewLevel, roofAlpha: this.world.roofAlpha,
        warnings: this.client.snap?.build?.warnings ?? [], pending: this.client.snap?.build?.pending ?? [],
        rooms: this.lastRooms, walls: this.lot.walls.filter(Boolean).length, money: this.client.snap?.econ?.money ?? 0,
      }),
      personScreenPos: (id: number) => {
        const p = this.chars.drawnPosition(id);
        return p ? this.renderer.worldToScreen(p.x, p.y - 24) : null;
      },
      frameStats: () => this.frameStats(),
      stress: (persons: number, objects: number) => this.stress(persons, objects),
      resetFrameStats: () => {
        this.frameTimes.length = 0;
        this.workTimes.length = 0;
      },
      renderInfo: () => ({
        deviceZoom: this.renderer.deviceZoom, zoom: this.renderer.zoom, dpr: window.devicePixelRatio,
        calls: this.renderer.renderer.info.render.calls, triangles: this.renderer.renderer.info.render.triangles,
      }),
      sortSamples: () => this.chars.sortSamples(),
      sortAudit: () => this.sortAudit(),
      errors: () => [...this.errors, ...c.errors],
      missingI18n: () => [...missingI18n],
      failedAssets: () => [...this.assets.failed],
    };
    const w = window as unknown as Record<string, unknown>;
    w.__game = game;
    // 개발 빌드에서만: 내부 객체 (디버깅)
    if (import.meta.env.DEV) w.__hk = this;
    w.__THREE_GAME_TEST_HOOKS__ = {
      seed: (n: number) => game.setSeed(n),
      setPausedForScreenshot: async (paused: boolean) => {
        this.pausedForShot = paused;
        await game.pause(paused);
      },
      setState: async (name: string) => this.setNamedState(name),
    };
    w.__THREE_GAME_DIAGNOSTICS__ = {
      get renderer() {
        return null;
      },
      frame: () => this.frameStats(),
      info: () => this.renderer.renderer.info,
    };
  }

  /** 캡처용 이름 붙은 상태 (inspect-threejs-canvas --state) */
  private async setNamedState(name: string): Promise<{ state: string }> {
    const hearth = this.client.snap?.objects.find((o) => o.defId === 'hearth');
    switch (name) {
      case 'active-play':
      case 'morning':
        await this.client.request((reqId) => ({ type: 'setTime', minuteOfDay: 8 * 60, reqId }));
        break;
      case 'evening':
        await this.client.request((reqId) => ({ type: 'setTime', minuteOfDay: 20 * 60, reqId }));
        if (hearth) await this.client.request((reqId) => ({ type: 'setObjectState', uid: hearth.uid, state: { lit: true, fuelMin: 300 }, reqId }));
        break;
      case 'night':
        await this.client.request((reqId) => ({ type: 'setTime', minuteOfDay: 23 * 60, reqId }));
        if (hearth) await this.client.request((reqId) => ({ type: 'setObjectState', uid: hearth.uid, state: { lit: true, fuelMin: 300 }, reqId }));
        break;
      case 'pie-menu': {
        const pos = this.objectScreenPos('hearth');
        if (pos && hearth) await this.openMenuAt(pos.x, pos.y, hearth.uid);
        break;
      }
      default:
        throw new Error(`unknown state ${name}`);
    }
    await this.client.nextSnapshot().catch(() => undefined);
    return { state: name };
  }

  /** E2E 용: 물건 그림 중 사람에 가리지 않고 화면 안에 있는 점 (발자국 가운데에 가까운 순) */
  private objectScreenPos(defId: string): { x: number; y: number; uid: number } | null {
    const o = this.client.snap?.objects.find((q) => q.defId === defId);
    if (!o) return null;
    const rect = this.world.objectRect(o.uid);
    if (!rect) return null;
    const T = this.world.tile;
    const cx = (rect.x + rect.w / 2) * T;
    const cy = (rect.y + rect.h / 2) * T;
    const cands: { x: number; y: number; d: number }[] = [];
    for (let dy = -T * 3; dy <= T; dy += 4) {
      for (let dx = -rect.w * T; dx <= rect.w * T; dx += 4) cands.push({ x: cx + dx, y: cy + dy, d: Math.abs(dx) + Math.abs(dy) });
    }
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands) {
      if (this.world.pick(c.x, c.y) !== o.uid || this.chars.pick(c.x, c.y) !== null) continue;
      const sp = this.renderer.worldToScreen(c.x, c.y);
      if (sp.x < 8 || sp.y < 8 || sp.x > window.innerWidth - 8 || sp.y > window.innerHeight - 8) continue;
      const el = document.elementFromPoint(sp.x, sp.y);
      if (el !== this.renderer.canvas) continue;
      return { x: sp.x, y: sp.y, uid: o.uid };
    }
    return null;
  }

  /**
   * y정렬 감사 (BRIEF M0 y-sort 오류 0): 사람과 물건 사각형이 겹칠 때 발이 더 아래(앞)인 쪽이 나중에 그려져야 함.
   * 제외: 바닥에 깔린 물건/벽걸이, 사람이 앉거나 누운 그 물건(의도된 규칙), 발 차이 2px 미만
   */
  sortAudit(): { pairs: number; errors: { person: number; uid: number; personFoot: number; objFoot: number }[] } {
    const people = this.chars.sortItems();
    const objs = this.world.sortItems();
    let pairs = 0;
    const errors: { person: number; uid: number; personFoot: number; objFoot: number }[] = [];
    for (const p of people) {
      for (const o of objs) {
        if (o.flat || o.uid === p.onObj) continue;
        if (p.right <= o.left || p.left >= o.right || p.bottom <= o.top || p.top >= o.bottom) continue;
        if (Math.abs(p.foot - o.foot) < 2) continue;
        pairs++;
        const personFront = p.foot > o.foot;
        if (personFront !== p.order > o.order) errors.push({ person: p.id, uid: o.uid, personFoot: p.foot, objFoot: o.foot });
      }
    }
    return { pairs, errors };
  }

  private frameStats(): { p50: number; p95: number; p99: number; n: number; work: { p50: number; p95: number; p99: number } } {
    const pct = (arr: number[]) => {
      const a = [...arr].sort((x, y) => x - y);
      const q = (p: number) => +(a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0).toFixed(3);
      return { p50: q(0.5), p95: q(0.95), p99: q(0.99) };
    };
    return { ...pct(this.frameTimes), n: this.frameTimes.length, work: pct(this.workTimes) };
  }

  /** 성능 측정용 부하: 사람 n명(sim), 장식 물건 m개(그림만, 부지 밖 풀밭) */
  async stress(persons: number, objects: number): Promise<void> {
    const T = this.pack.tilePx;
    const spots: [number, number][] = [];
    for (let y = 0; y < this.lot.h; y++) for (let x = 0; x < this.lot.w; x++) {
      const i = y * this.lot.w + x;
      if (!this.lot.walls[i] && !this.lot.floor[i]) spots.push([x, y]);
    }
    const rng = new Rng(4242);
    for (let i = 0; i < persons; i++) {
      const [x, y] = spots[rng.int(spots.length)];
      const spec = randomSpec(() => rng.next(), {});
      const r = await this.client.request<{ id: number }>((reqId) => ({ type: 'spawn', name: `s${i}`, appearance: spec as unknown as Record<string, unknown>, x: x + 0.5, y: y + 0.5, reqId }));
      this.specs.set(r.id, spec);
      await this.ensureSheet(r.id, 'everyday');
    }
    this.world.addDecor(objects, 777);
    void T;
  }

  private getState(): Record<string, unknown> {
    const s = this.client.snap;
    return {
      tick: s?.tick,
      minute: s?.minute,
      minuteOfDay: s?.minuteOfDay,
      day: s?.day,
      speed: s?.speed,
      selectedId: this.selectedId,
      stock: s?.stock,
      persons: s?.persons.map((p) => ({
        id: p.id, name: p.name, x: p.x, y: p.y, drawn: this.chars.drawnPosition(p.id),
        pose: p.pose, anim: p.anim, facing: p.facing, carry: p.carry, sleeping: p.sleeping, hidden: p.hidden,
        needs: p.needs, action: p.action, queue: p.queue, collapsed: p.collapsed, feltC: p.feltC, inner: p.inner, talkingWith: p.talkingWith,
        household: p.household, visitor: p.visitor, topic: p.topic, chatWith: p.chatWith, lastSocial: p.lastSocial,
        career: p.career, skills: p.skills, lastWork: p.lastWork, careerEvent: p.careerEvent,
      })),
      relations: s?.relations,
      econ: s?.econ,
      pendingVisits: s?.pendingVisits,
      away: s?.away,
      notices: s?.notices,
      objects: s?.objects,
      camera: { x: this.renderer.camX, y: this.renderer.camY, zoom: this.renderer.zoom },
      pieOpen: this.pie.open,
    };
  }
}

/** 선택 콘텐츠 파일(작업 중인 데이터)은 있으면 넣음 */
/** M6: 공공 장소 물건/상호작용 추가 파일 (있으면 합침) */
const townExtra = import.meta.glob<{ default: unknown }>(['../data/objects_town.json', '../data/interactions_town.json'], { eager: true });
const objects = { ...(objectsBase as object), ...((townExtra['../data/objects_town.json']?.default as object | undefined) ?? {}) };
const interactions = {
  interactions: {
    ...(interactionsBase as { interactions: object }).interactions,
    ...(((townExtra['../data/interactions_town.json']?.default as { interactions?: object } | undefined)?.interactions) ?? {}),
  },
};

const optional = import.meta.glob<{ default: unknown }>(
  ['../data/moodlets.json', '../data/moodlets_m3.json', '../data/moodlets_m5.json', '../data/thoughts.json', '../data/wishes.json', '../data/aspirations.json', '../data/rewards.json', '../data/likes.json', '../data/relations.json', '../data/neighbors.json', '../data/economy.json', '../data/items.json', '../data/skills.json', '../data/recipes.json', '../data/careers.json', '../data/crops.json', '../data/build.json', '../data/catalog.json', '../data/story.json'],
  { eager: true },
);
function opt(name: string): unknown {
  return optional[`../data/${name}.json`]?.default;
}

const houseLots = import.meta.glob<{ default: unknown }>('../data/lots/houses/*.json', { eager: true });
const otherLots = import.meta.glob<{ default: unknown }>('../data/lots/*.json');

/** 그 밖의 부지 파일 (?lot=perf_town → src/data/lots/perf_town.json): 필요할 때만 불러옴 */
async function loadOtherLot(): Promise<LotDef | null> {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lot') : null;
  if (!q || q.includes(':') || q === 'empty') return null;
  const load = otherLots[`../data/lots/${q}.json`];
  if (!load) return null;
  const m = (await load()) as { default: unknown };
  return JSON.parse(JSON.stringify(m.default)) as LotDef;
}

/** 마을 모드 (M6): ?town=ashford → src/data/town/ashford.json + people.json + schedules.json */
export interface TownBundle {
  def: { id: string; lot: unknown; places: Array<{ id: string; kind: string; nameKey: string; rect: [number, number, number, number]; anchor: [number, number] }>; lots: Array<{ id: string; kind: string; size: string; rect: [number, number, number, number]; start?: boolean; house: string | null; price: number }>; zones: Array<{ id: string; kind: string; rect: [number, number, number, number]; nameKey?: string }> };
  people: unknown;
  schedules: unknown;
}
const townFiles = import.meta.glob<{ default: unknown }>(['../data/town/*.json', '../data/schedules.json']);
async function loadTown(): Promise<TownBundle | null> {
  // 주소에 ?town= 이 없으면 빌드 기본값 (Pages 배포판은 VITE_DEFAULT_TOWN=ashford). ?town=none 이면 오두막
  const q = (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('town') : null) ?? import.meta.env.VITE_DEFAULT_TOWN ?? null;
  if (!q || q === 'none') return null;
  const get = async (p: string) => {
    const f = townFiles[p];
    return f ? ((await f()) as { default: unknown }).default : undefined;
  };
  const def = await get(`../data/town/${q}.json`);
  if (!def) return null;
  return { def: def as TownBundle['def'], people: await get('../data/town/people.json'), schedules: await get('../data/schedules.json') };
}

/** 시작 부지: ?lot=empty 면 빈 부지 (M5 건축 E2E), 아니면 오두막 Tiled 지도 */
function pickLot(): LotDef {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lot') : null;
  if (q === 'empty') return JSON.parse(JSON.stringify(emptyLot)) as LotDef;
  // 미리 만든 집 (23-6): ?lot=house:manor_1
  if (q?.startsWith('house:')) {
    const hit = houseLots[`../data/lots/houses/${q.slice(6)}.json`];
    if (hit) return JSON.parse(JSON.stringify(hit.default)) as LotDef;
  }
  return lotFromTiled(JSON.parse(cottageTmj) as TiledMap);
}
/** 무드렛 파일 여러 개 합치기 (moodlets.json + 마일스톤별 추가 파일) */
function mergedMoodlets(): unknown {
  const out: Record<string, unknown> = {};
  for (const n of ['moodlets', 'moodlets_m3', 'moodlets_m5']) Object.assign(out, (opt(n) as { moodlets?: Record<string, unknown> } | undefined)?.moodlets ?? {});
  return { moodlets: out };
}
export function neighborsList(): Array<{ id: string; name: string; sex: string; stage: string; estate: string; traits: string[]; seed: number }> {
  return ((opt('neighbors') as { neighbors?: [] } | undefined)?.neighbors) ?? [];
}
function innerRaw() {
  return {
    emotions: emotionsData, traits: traitsData, virtues: virtuesData, stress: stressData,
    moodlets: mergedMoodlets(), thoughts: opt('thoughts'), wishes: opt('wishes'), aspirations: opt('aspirations'), rewards: opt('rewards'), likes: opt('likes'),
  };
}

// ---------------------------------------------------------------- 내면 표시용 정의 (데이터에서)

/** 생애 단계 → 대사 조건 단계 (child/teen/adult/elder) */
function coarseStage(st: string | undefined): string | undefined {
  if (!st) return undefined;
  if (st === 'baby' || st === 'toddler' || st === 'child') return 'child';
  if (st === 'teen') return 'teen';
  if (st === 'elder') return 'elder';
  return 'adult';
}

function emotionColor(e: string): string {
  return (emotionsData.emotions as Record<string, { color: string }>)[e]?.color ?? '#888';
}

function innerDefs() {
  const moodlets = ((opt('moodlets') as { moodlets?: Record<string, { nameKey: string; descKey: string; icon?: string; emotion: string }> } | undefined)?.moodlets) ?? {};
  const wishes = ((opt('wishes') as { wishes?: Array<{ id: string; textKey: string; icon?: string }> } | undefined)?.wishes) ?? [];
  const aspRaw = (opt('aspirations') as { aspirations?: unknown } | undefined)?.aspirations ?? {};
  const asp: Record<string, { nameKey: string; stages: { textKey?: string }[] }> = Array.isArray(aspRaw)
    ? Object.fromEntries((aspRaw as Array<{ id: string; nameKey: string; stages: { textKey?: string }[] }>).map((a) => [a.id, a]))
    : (aspRaw as Record<string, { nameKey: string; stages: { textKey?: string }[] }>);
  const rr = (opt('rewards') as { rewards?: unknown } | undefined)?.rewards ?? [];
  const rewards = (Array.isArray(rr) ? rr : Object.entries(rr as Record<string, object>).map(([id, v]) => ({ id, ...v }))) as Array<{ id: string; nameKey: string; descKey: string; icon: string; cost: number; kind?: string }>;
  const traits = traitsData.traits as Record<string, { icon: string }>;
  return {
    moodletIcon: (id: string) => {
      const m = moodlets[id];
      return m?.icon ?? (m ? `emo.${m.emotion}` : null);
    },
    moodletKeys: (id: string) => (moodlets[id] ? { name: moodlets[id].nameKey, desc: moodlets[id].descKey } : null),
    traitIcon: (id: string) => traits[id]?.icon ?? 'emo.neutral',
    wishDef: (id: string) => wishes.find((w) => w.id === id) ?? null,
    aspiration: (id: string) => asp[id] ?? null,
    rewards: () => rewards,
    emotionColor,
  };
}

function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}
