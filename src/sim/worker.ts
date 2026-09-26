/// <reference lib="webworker" />
/**
 * 시뮬레이션 워커. 실제 시간에 맞춰 틱을 돌리고 스냅샷을 보냄.
 * 속도: 0 일시정지 / 1·2·3배 = 분당 1·3·10 게임분/초 (balance.time.speeds). 가족 전원 수면이면 자동 가속.
 */
import { validateSimData, type SimData } from './data/simData';
import type { EconSnap, FromWorker, RelationSnap, Snapshot, ToWorker } from './protocol';
import { Simulation } from './sim';
import { EMOTION_IDS } from './inner/emotion';

declare const self: DedicatedWorkerGlobalScope;

let sim: Simulation | null = null;
let data: SimData | null = null;
let speed = 1;
let paused = false;
let acc = 0;
let last = performance.now();
const SNAP_MS = 33;
let lastSnap = 0;
let pendingSnap = false;
/** 품목 가격표는 하루 한 번만 다시 계산해 보냄 (100품목) */
let priceDay = -1;
let priceCache: Record<string, number> = {};
let seedValue = 1;
/** 마지막으로 보낸 부지 판과 방 목록 시각 */
let sentLotVersion = -1;
let sentRoomsAt = -1;
let personsInit: { name: string; appearance: Record<string, unknown>; estate?: string; sex?: string; stage?: string }[] = [];
/** 시작 가족 관계 (start.json relations): 만든 뒤 의도로 적용 → 입력 로그에 남아 재생과 같음 */
let relationsInit: { a: number; b: number; friendship?: number; romance?: number; respect?: number; flags?: string[] }[] = [];

function post(msg: FromWorker): void {
  self.postMessage(msg);
}

function minutesPerSecond(): number {
  if (!sim || !data) return 0;
  if (paused || speed === 0) return 0;
  if (sim.shouldAutoAccelerate()) return data.balance.time.autoAccelMinutesPerSecond;
  return data.balance.time.speeds[String(speed)] ?? 1;
}

function build(seed: number): void {
  if (!data) return;
  sim = new Simulation(data, seed);
  sentLotVersion = -1;
  sentRoomsAt = -1;
  // 마을 모드(M6)는 people.json 이 조작 가문까지 채움
  if (!sim.town) {
    for (const p of personsInit) {
      const person = sim.addPerson(p.name, undefined, undefined, { estate: p.estate, sex: p.sex as never, stage: p.stage as never });
      person.appearance = p.appearance;
    }
    for (const r of relationsInit) sim.apply({ kind: 'setRelation', met: true, ...r });
  }
}

/** 지난 스냅샷 이후 지나간 좌표를 넘기고, 다음 구간은 현재 위치에서 시작 */
function takeTrail(trail: number[], x: number, y: number): number[] {
  const out = trail.length ? trail.slice() : [x, y];
  trail.length = 0;
  trail.push(x, y);
  return out;
}

function snapshot(): Snapshot {
  const s = sim!;
  const mps = minutesPerSecond();
  return {
    tick: s.stats.ticks,
    minute: s.world.minute,
    day: s.world.day(),
    minuteOfDay: s.world.minuteOfDay(),
    season: s.world.season,
    outsideC: s.world.outsideC,
    roomTemps: s.world.roomTemps.slice(),
    stock: { ...s.world.stock },
    speed: paused ? 0 : speed,
    autoAccel: s.shouldAutoAccelerate(),
    tickMs: mps > 0 ? 1000 / mps : 1000,
    // 마을(M6): 전체 세밀도 인물만 그림 (간이/요약/아기는 화면 밖)
    // 조작 가문 아기·유아(M7)는 실제로 집에 있어 그림. 마을 NPC 아기는 요약 세밀도로 엄마 곁(숨김)
    persons: s.persons.filter((p) => p.lod === 'full' && (!p.infant || !p.hidden)).map((p) => ({
      id: p.id, name: p.name, x: p.x, y: p.y, trail: takeTrail(p.trail, p.x, p.y),
      ...(p.riding && p.action?.phase === 'walk' ? { riding: p.horse } : {}),
      facing: p.facing, pose: p.pose, anim: p.anim, outfit: p.outfit, carry: p.carry,
      ...(p.direct ? { direct: true } : {}),
      lifeStage: p.lifeStage,
      ...(p.knocking ? { knocking: p.knocking.cell } : {}),
      ...(p.pregnancy && s.pregnancy ? { bellyStage: s.pregnancy.bellyStage(p) } : {}),
      ...(p.gait !== 'proud' && s.genetics ? { gaitAnim: s.genetics.gaits[p.gait]?.anim ?? 1 } : {}),
      ...(p.lifeStage === 'baby'
        ? { infant: { place: p.babyPlace?.kind ?? 'floor', heldBy: p.babyPlace?.kind === 'held' ? p.babyPlace.by : -1, crying: p.crying } }
        : {}),
      hidden: p.hidden, underBlanket: p.underBlanket, sleeping: p.sleeping,
      needs: p.needsObject(),
      queue: p.queue.map((q) => ({ ...q })),
      action: s.actionOf(p),
      feltC: s.feltTemp(p),
      collapsed: !!p.collapse,
      appearance: p.appearance,
      talkingWith: p.engagedWith || (p.action && s.data.social[p.action.item.interactionId] && p.action.phase === 'perform' ? p.action.item.targetUid : 0),
      topic: p.action?.topic ?? (p.engagedWith ? s.persons.find((q) => q.id === p.engagedWith)?.action?.topic : undefined) ?? null,
      chatWith: p.chatWith,
      household: p.household,
      visitor: p.visitor ? { neighborId: p.visitor.neighborId, leaving: p.visitor.leaving } : null,
      lastSocial: p.lastSocial,
      career: p.career ? { id: p.career.id, rank: p.career.rank, perf: Math.round(p.career.perf), attitude: p.career.attitude, orders: p.career.orders.map((o) => ({ ...o })) } : null,
      careerEvent: p.careerEvent ? { careerId: p.careerEvent.careerId, eventId: p.careerEvent.eventId } : null,
      skills: p.household === 1 && s.skills ? skillSnap(s, p) : null,
      lastWork: p.lastWork,
      lastCraft: p.lastCraft,
      lastSkillUp: p.lastSkillUp,
      lastHarvest: p.lastHarvest,
      inner: s.inner
        ? {
            emotion: EMOTION_IDS[p.emotion], stage: p.emotionStage, estate: p.estate, stage_life: p.stage,
            traits: p.traits, virtue: p.virtue, sin: p.sin, likes: p.likes, dislikes: p.dislikes,
            stress: p.stress, karma: p.karma, happiness: p.happiness,
            moodlets: p.moodlets.filter((m) => !m.id.includes('~')).map((m) => ({
              id: m.id, emotion: EMOTION_IDS[m.emotion], strength: m.strength,
              remainingMin: Number.isFinite(m.expiresAt) ? m.expiresAt - s.world.minute : -1,
            })),
            wishes: p.wishes.map((w) => ({ id: w.id, kind: w.kind, locked: w.locked })),
            aspiration: p.aspiration ? { ...p.aspiration } : null,
            pendingChoice: p.pendingChoice?.id ?? null,
            memories: p.memories.length,
          }
        : null,
    })),
    objects: s.world.objects.map((o) => {
      const snap: import('./protocol').ObjectSnap = { uid: o.uid, defId: o.defId, x: o.x, y: o.y, state: { ...o.state } };
      if (o.rot) snap.rot = o.rot;
      if (o.variant) snap.variant = o.variant;
      return snap;
    }),
    ...lotPart(s),
    town: s.town ? townPart(s) : null,
    notices: s.notices.slice(-20),
    relations: relationsSnap(s),
    pendingVisits: s.pendingVisits.map((v) => v.neighborId),
    econ: econSnap(s),
    house: houseSnap(s),
    away: [...s.away.entries()].map(([nb, p]) => ({ id: p.id, name: p.name, neighborId: nb, estate: p.estate })),
  };
}

/** 가문·사회 요약 (M8·M9): 수첩 가문/기록/영지 쪽 */
let treeCache: { day: number; head: number; tree: import('./protocol').HouseSnap['tree'] } | null = null;
function houseSnap(s: Simulation): import('./protocol').HouseSnap | null {
  const L = s.house;
  if (!L) return null;
  const sum = L.summary(1) as { clan: import('./protocol').HouseSnap['clan']; estate: string; fief: import('./protocol').HouseSnap['fief']; treasury: number; servants: import('./protocol').HouseSnap['servants']; heirlooms: import('./protocol').HouseSnap['heirlooms']; lostHeirlooms: number[] };
  const est = L.estates;
  const acct = s.econ?.account(1);
  const head = L.headOf(1);
  const day = s.world.day();
  if (!treeCache || treeCache.day !== day || treeCache.head !== (head?.id ?? 0)) {
    const nodes = head ? L.house.clans.familyTree(head.id) : [];
    treeCache = { day, head: head?.id ?? 0, tree: nodes.map((n) => ({ id: n.id, name: n.name, sex: n.sex, generation: n.generation, alive: n.alive, estate: n.estate, title: n.title, cause: n.cause, spouse: n.spouse, mother: n.mother, father: n.father, bastard: n.bastard })) };
  }
  const C = s.society?.courtship;
  return {
    ...sum,
    emancipation: sum.estate === 'serf' ? { fee: est.emancipationFee(), money: acct?.money ?? 0 } : null,
    morale: L.house.honor.morale,
    lordFavor: s.lordFavor.get(1) ?? 0,
    tree: treeCache.tree,
    rumors: (s.rumors?.knownToHousehold(1) ?? []).slice(-12).map((r) => ({ id: r.id, kind: r.kind, args: r.args, known: r.knownBy.size, good: r.good, strength: Math.round(r.strength * 100) / 100 })),
    letters: (s.society?.letters?.householdInbox(1) ?? []).slice(-16).map((l) => ({ id: l.id, kind: l.kind, fromName: l.fromName, to: l.to, read: !!(l as { read?: boolean }).read, sentDay: l.sentDay })),
    matches: (() => {
      if (!C) return [];
      const list = C.offers(1);
      return list.slice(0, 12).map((m) => {
        const o = C.state.offers.find((x) => x.id === m.matchId);
        return { matchId: m.matchId, seeker: o?.personId ?? 0, personId: m.personId, name: m.name, sex: m.sex, estate: m.estate, age: Math.round(m.age), dowry: m.dowry, wePay: m.wePay, fame: m.fame, traits: m.traits.slice(0, 2), clan: m.clan, incoming: !!o?.incoming };
      });
    })(),
    rise: (() => {
      if (!head) return [];
      const E = L.estates;
      const RELEVANT = new Set(['reason.estate.money', 'reason.estate.capital', 'reason.estate.days', 'reason.estate.skill', 'reason.estate.fame_tier', 'reason.estate.lord_favor', 'reason.estate.no_feat', 'reason.estate.guild_stage', 'reason.estate.quality', 'reason.estate.stage', 'reason.estate.lord_permission', 'reason.estate.not_squire']);
      const st = E.guildStage(head);
      const list: [string, import('./house/estates').CheckResult][] = [
        ['payEmancipation', E.canPayEmancipation(1)],
        ['startApprenticeship', E.canApprentice(head)],
        ...(st === 'journeyman' ? [['submitMasterpiece', { ok: true }] as [string, import('./house/estates').CheckResult]] : []),
        ['joinGuild', E.canJoinGuild(head)],
        ['becomeMerchant', E.canBecomeMerchant(head)],
        ['knight', E.canKnight(head)],
        ['buyTitle', E.canBuyTitle(1)],
        ['takeVows', E.canTakeVows(head)],
      ];
      return list.filter(([, c]) => c.ok || RELEVANT.has(c.reason ?? '')).map(([op, c]) => ({ op, ok: c.ok, reason: c.reason, cost: c.cost, personId: head.id }));
    })(),
    cards: (s.cards?.pending ?? []).filter((c) => s.persons.some((q) => q.id === c.personId && q.household === 1)).slice(0, 3).map((c) => {
      const def = s.cards!.defs.get(c.cardId)!;
      return { seq: c.seq, cardId: c.cardId, titleKey: def.titleKey, bodyKey: (def as { bodyKey?: string }).bodyKey ?? '', personId: c.personId, otherId: c.otherId, vars: c.vars, options: c.options.map((n) => ({ n, textKey: def.options[n].textKey })) };
    }),
    domain: (() => {
      const P = s.society?.policy;
      if (!P) return null;
      const lh = L.fief?.lordHousehold();
      return { levels: { ...P.state.levels }, morale: Math.round(L.house.honor.morale), treasury: L.fief?.treasury.money ?? 0, riots: P.stats.riots, crimes7: Math.round((s.society?.justice?.crimesPerDay() ?? 0) * 7), lord: lh === 1, plague: !!s.society?.plague?.active };
    })(),
    trial: (() => {
      const J = s.society?.justice;
      const t = J?.state.trials.find((x) => !x.verdict && s.persons.some((q) => q.id === x.accused && q.household === 1)) ?? J?.state.trials.slice().reverse().find((x) => x.verdict && x.controlled && s.world.minute - x.stageAt < 120);
      if (!t) return null;
      return { id: t.id, crime: t.crime, accused: t.accused, accuser: t.accuser, judge: t.judge, stage: t.stage, witnesses: t.witnesses.map((w) => ({ ...w })), lines: t.lines.slice(-8), verdict: t.verdict ? { guilty: t.verdict.guilty, punish: t.verdict.punish, amount: t.verdict.amount, days: t.verdict.days } : null };
    })(),
    betrothed: (C?.state.betrothals ?? []).filter((b) => s.persons.some((q) => q.household === 1 && (q.id === b.a || q.id === b.b))).map((b) => ({ a: b.a, b: b.b, weddingDay: b.weddingDay, path: b.path })),
  };
}

/** 마을 요약 (M6): 인구, 세밀도, 소식, 가문 이름 */
function townPart(s: Simulation): NonNullable<Snapshot['town']> {
  const counts = { full: 0, simple: 0, summary: 0 };
  for (const p of s.persons) counts[p.lod]++;
  return {
    population: s.persons.length,
    lod: counts,
    news: s.news.slice(-12),
    people: s.persons.filter((p) => !p.infant).map((p) => ({ id: p.id, name: p.name, household: p.household, lod: p.lod, x: Math.round(p.x), y: Math.round(p.y), stage: p.lifeStage })),
    freeLots: s.town!.lots.filter((l) => !s.town!.lotHousehold.has(l.id)).map((l) => l.id),
    playerLot: s.town!.playerLot()?.id ?? null,
  };
}

/** 부지/방/건축 상태: 부지는 바뀌었을 때만 싣고, 방 목록은 부지가 바뀌거나 한 시간마다 */
function lotPart(s: Simulation): Pick<Snapshot, 'lotVersion' | 'lot' | 'rooms' | 'build'> {
  const w = s.world;
  const out: Pick<Snapshot, 'lotVersion' | 'lot' | 'rooms' | 'build'> = { lotVersion: w.lotVersion, build: null };
  const changed = sentLotVersion !== w.lotVersion;
  if (changed) {
    out.lot = JSON.parse(JSON.stringify(w.lot));
    // 지금 물건 (구매/팔기 반영): 렌더러 계단/지붕 계산과 저장용
    out.lot!.objects = w.objects
      .filter((o) => !['window_opening', 'lot_exit', 'house_fire', 'construction_site'].includes(o.defId))
      .map((o) => ({ id: o.defId, x: o.x, y: o.y, ...(o.rot ? { rot: o.rot } : {}), ...(o.variant ? { variant: o.variant } : {}) }));
    sentLotVersion = w.lotVersion;
  }
  const hour = Math.floor(w.minute / 60);
  if (changed || hour !== sentRoomsAt) {
    out.rooms = s.rooms();
    sentRoomsAt = hour;
  }
  if (s.builder) {
    out.build = {
      mode: s.buildMode, canUndo: s.builder.canUndo, canRedo: s.builder.canRedo, warnings: s.builder.lastWarnings,
      construction: s.builder.construction, pending: s.builder.pending.map((p) => ({ id: p.id, op: p.op, progress: +(p.done / p.work).toFixed(3) })),
    };
  }
  return out;
}

/** 스킬: 레벨과 다음 레벨까지 비율 (레벨 0 이고 경험치 0 인 것은 뺌) */
function skillSnap(s: Simulation, p: import('./people/person').Person): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const id of Object.keys(s.data.skills!.skills)) {
    const lv = p.skills[id] ?? 0;
    const xp = p.skillXp[id] ?? 0;
    if (!lv && !xp) continue;
    out[id] = [lv, +(xp / s.skills!.xpToNext(lv)).toFixed(3)];
  }
  return out;
}

function econSnap(s: Simulation): EconSnap | null {
  const e = s.econ;
  const a = e?.account(1);
  if (!e || !a) return null;
  const prices: EconSnap['prices'] = {};
  for (const [g, st] of Object.entries(e.goods)) prices[g] = { mult: +st.mult.toFixed(3), prev: +st.prev.toFixed(3) };
  if (priceDay !== s.world.day()) {
    priceDay = s.world.day();
    priceCache = {};
    for (const [k, def] of Object.entries(s.data.items)) priceCache[k] = e.itemPrice(def);
  }
  const itemPrices = priceCache;
  return {
    money: a.money, debt: e.debt(a), loans: a.loans.map((l) => ({ principal: l.principal, interest: Math.floor(l.interest), due: l.due, lender: l.lender })),
    prices, itemPrices, book: a.book.slice(-28), today: { income: { ...a.today.income }, expense: { ...a.today.expense } },
    shop: { ...s.shop },
    estate: a.estate, targetNet: (s.data.economy as { estates: Record<string, { target: { net: number } }> }).estates[a.estate]?.target.net ?? 0,
  };
}

/** 만난 사이만 (관계 패널용) */
function relationsSnap(s: Simulation): RelationSnap[] {
  const out: RelationSnap[] = [];
  for (const r of s.rel.all()) {
    if (!r.met) continue;
    out.push({ a: r.a, b: r.b, friendship: r.friendship, romance: r.romance, respectAB: r.respectAB, respectBA: r.respectBA, name: s.rel.name(r.a, r.b), flags: [...r.flags], memories: r.sharedMemories });
  }
  return out;
}

/** 직접 조작 인물들을 dt(ms) 만큼 움직임. 움직였으면 true */
function moveDirect(dt: number): boolean {
  if (!sim || !data) return false;
  // 1배속에서 초당 directTilesPerSecond 칸, 배속이 오르면 배속의 제곱근만큼 (3배속 10분/초에서도 날아다니지 않게)
  const perSec = (data.balance.movement as { directTilesPerSecond?: number }).directTilesPerSecond ?? 6;
  const mps = minutesPerSecond();
  const dist = mps > 0 ? (perSec * Math.sqrt(mps) * dt) / 1000 : 0;
  let moved = false;
  for (const p of sim.persons) if (p.direct && sim.directStep(p, dist)) moved = true;
  return moved;
}

/** 틱 직전: 그동안 직접 조작으로 움직인 위치를 입력 로그에 남김 (같은 시드 + 같은 로그 = 같은 결과) */
function flushDirect(): void {
  if (!sim) return;
  for (const p of sim.persons) {
    if (!p.directMoved) continue;
    sim.apply({ kind: 'directPos', personId: p.id, x: p.x, y: p.y, facing: p.facing });
  }
}

let lastMotion = 0;
function loop(): void {
  const now = performance.now();
  const dt = Math.min(250, now - last);
  last = now;
  if (sim) {
    const mps = minutesPerSecond();
    acc += (dt / 1000) * mps;
    let ticked = 0;
    // 직접 조작 (WASD): 틱을 기다리지 않고 매 프레임 바로 움직임 (속도는 배속을 따름, 일시정지면 멈춤)
    if (!paused && speed > 0 && moveDirect(dt)) pendingSnap = true;
    try {
      while (acc >= 1 && ticked < 60) {
        flushDirect();
        sim.tick();
        acc -= 1;
        ticked++;
      }
    } catch (err) {
      // 틱에서 예외가 나도 루프가 조용히 죽지 않게: 알리고 멈춤
      paused = true;
      acc = 0;
      post({ type: 'error', message: `tick ${sim.stats.ticks}: ${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}` });
    }
    // 틱 사이: 걷는 사람의 예측 위치를 가볍게 초당 30번 (1배속에서 1초에 한 번 뛰던 걸음을 실시간으로)
    if (mps > 0 && now - lastMotion >= SNAP_MS) {
      lastMotion = now;
      const ids: number[] = [];
      const xy: number[] = [];
      const frac = Math.max(0, Math.min(1, acc));
      for (const p of sim.persons) {
        if (p.lod !== 'full') continue;
        const q = sim.predictWalk(p, frac);
        if (!q) continue;
        ids.push(p.id);
        xy.push(q[0], q[1]);
      }
      if (ids.length) post({ type: 'motion', tick: sim.stats.ticks, at: now, ids, xy });
    }
    // 스냅샷은 초당 30번까지 (사이 틱의 이동 경로는 trail 에 쌓여 렌더러가 보간). 메인 스레드 역직렬화/HUD 부담을 줄임
    if (ticked > 0) pendingSnap = true;
    if (pendingSnap && now - lastSnap >= SNAP_MS) {
      pendingSnap = false;
      lastSnap = now;
      post({ type: 'snapshot', snap: snapshot() });
    }
  }
  setTimeout(loop, 8);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    // 직접 조작으로 그동안 움직인 위치를 먼저 입력 로그에 (이 뒤에 오는 의도가 같은 위치를 보게: 재생 결정론)
    if (m.type !== 'init' && m.type !== 'menu' && m.type !== 'menuPerson' && m.type !== 'buildQuery' && m.type !== 'stats') flushDirect();
    switch (m.type) {
      case 'init':
        treeCache = null;
        data = validateSimData(m.data as Parameters<typeof validateSimData>[0]);
        personsInit = m.persons;
        relationsInit = (m as { relations?: typeof relationsInit }).relations ?? [];
        seedValue = m.seed;
        build(seedValue);
        post({ type: 'snapshot', snap: snapshot() });
        break;
      case 'setSpeed':
        speed = m.speed;
        post({ type: 'snapshot', snap: snapshot() });
        break;
      case 'queue':
        post({ type: 'reply', reqId: m.reqId, result: sim!.apply({ kind: 'queue', personId: m.personId, interactionId: m.interactionId, targetUid: m.targetUid }) });
        post({ type: 'snapshot', snap: snapshot() });
        break;
      case 'goto':
        post({ type: 'reply', reqId: m.reqId, result: sim!.apply({ kind: 'goto', personId: m.personId, x: m.x, y: m.y }) });
        break;
      case 'cancel':
        sim!.apply({ kind: 'cancel', personId: m.personId, queueItemId: m.queueItemId });
        post({ type: 'snapshot', snap: snapshot() });
        break;
      case 'menu':
        post({ type: 'menu', reqId: m.reqId, entries: sim!.menuFor(m.personId, m.targetUid) });
        break;
      case 'pause':
        paused = m.paused;
        acc = 0;
        post({ type: 'reply', reqId: m.reqId, result: { paused } });
        post({ type: 'snapshot', snap: snapshot() });
        break;
      case 'fastForward':
        for (let i = 0; i < m.minutes; i++) sim!.tick();
        post({ type: 'snapshot', snap: snapshot() });
        post({ type: 'reply', reqId: m.reqId, result: { minute: sim!.world.minute } });
        break;
      case 'setNeed':
        sim!.apply({ kind: 'setNeed', personId: m.personId, need: m.need as never, value: m.value });
        post({ type: 'snapshot', snap: snapshot() });
        post({ type: 'reply', reqId: m.reqId, result: true });
        break;
      case 'setTime': {
        const result = sim!.apply({ kind: 'setTime', minuteOfDay: m.minuteOfDay });
        post({ type: 'snapshot', snap: snapshot() });
        post({ type: 'reply', reqId: m.reqId, result });
        break;
      }
      case 'setObjectState': {
        const ok = sim!.apply({ kind: 'setObjectState', uid: m.uid, state: m.state });
        post({ type: 'snapshot', snap: snapshot() });
        post({ type: 'reply', reqId: m.reqId, result: ok });
        break;
      }
      case 'setAutonomy':
        sim!.apply({ kind: 'setAutonomy', enabled: m.enabled });
        post({ type: 'reply', reqId: m.reqId, result: true });
        break;
      case 'reseed':
        seedValue = m.seed;
        build(seedValue);
        post({ type: 'snapshot', snap: snapshot() });
        post({ type: 'reply', reqId: m.reqId, result: true });
        break;
      case 'spawn': {
        const result = sim!.apply({ kind: 'spawn', name: m.name, appearance: m.appearance, x: m.x, y: m.y });
        post({ type: 'snapshot', snap: snapshot() });
        post({ type: 'reply', reqId: m.reqId, result });
        break;
      }
      case 'intent': {
        const result = sim!.apply(m.intent as never);
        post({ type: 'snapshot', snap: snapshot() });
        post({ type: 'reply', reqId: m.reqId, result });
        break;
      }
      case 'buildQuery':
        post({ type: 'reply', reqId: m.reqId, result: sim!.builder ? sim!.builder.canPlace(m.defId, m.x, m.y, m.rot, m.except ?? -1) : 'disabled' });
        break;
      case 'menuPerson':
        post({ type: 'menu', reqId: m.reqId, entries: sim!.menuForPerson(m.personId, m.targetPersonId) });
        break;
      case 'wishHint':
        post({ type: 'reply', reqId: m.reqId, result: sim!.wishHint(m.personId, m.wishId) });
        break;
      case 'inputLog':
        post({ type: 'reply', reqId: m.reqId, result: { seed: seedValue, persons: personsInit.map((q) => ({ name: q.name, estate: q.estate, sex: q.sex, stage: q.stage })), log: sim!.inputLog, ticks: sim!.stats.ticks, hash: sim!.worldHash() } });
        break;
      case 'stats':
        post({ type: 'reply', reqId: m.reqId, result: { stats: sim!.stats, hash: sim!.worldHash(), minute: sim!.world.minute } });
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
};

loop();
