/**
 * 내면 엔진 (M2, GDD 11~12): 무드렛, 감정, 스트레스, 특성 효과, 덕/죄, 호불호, 기억, 소원/걱정,
 * 인생 목표, 행복 포인트, 속마음. Simulation 이 매 틱/행동 완료 때 부름. 렌더러/DOM 없음.
 */
import type { Rng } from '../core/rng';
import { NEED_IDS } from '../core/types';
import type { InnerData, MoodletDef, NeedCond, Reach, Thought, TraitFx, WishDef } from '../data/innerData';
import { COUNTED_ELSEWHERE, compileTraitFx, companionId, computeReach, likeReach, normalizeEvent, reachSourcesOf, wishReachable } from '../data/innerData';
import type { SimData } from '../data/simData';
import type { ActiveMoodlet, Person } from '../people/person';
import type { World } from '../world/world';
import { computeEmotion, EMOTION_IDS, EMOTION_INDEX, NEUTRAL, POSITIVE, type EmotionId, type EmotionResult } from './emotion';

export interface StressData {
  stages: { heavy: number; limit: number; breakdown: number };
  limitBreakdownChancePerHour: number;
  decayPerHour: number;
  autoAfter: { value: number };
  options: Record<string, {
    nameKey: string; descKey: string; icon: string; moodlet: string; stressDelta: number;
    gainTrait?: { trait: string; chance: number }; weightTraits?: Record<string, number>; queue?: string; roomDirt?: number; virtueBreak?: string;
  }>;
  acquiredTraits: Record<string, { nameKey: string; descKey: string; icon: string; effects: Record<string, unknown> }>;
}

export interface InnerHost {
  readonly world: World;
  readonly rng: Rng;
  readonly persons: Person[];
  readonly data: SimData;
  notice(p: Person, kind: string, args?: Record<string, string | number>): void;
  queueInteraction(personId: number, interactionId: string, targetUid: number, autonomous?: boolean): { ok: boolean };
}

const NEED_LOW = 30;
const NEED_CRIT = 10;
const NEED_HIGH = 80;
const THOUGHT_GAP = 25;
const IDLE_CHATTER_PER_HOUR = 0.15;
const WISH_SLOTS = 3;
const FEAR_SLOTS = 2;
/** mid 가 id 자신이거나 id 의 동반 무드렛(id~감정)인가 (문자열 조립 없이) */
function isSelfOrCompanion(mid: string, id: string): boolean {
  if (mid === id) return true;
  return mid.length > id.length && mid.charCodeAt(id.length) === 126 && mid.startsWith(id);
}

const WISH_REFRESH = 360;
const MEMORY_MAX = 200;
/** 인물 카운터에 두는 내부 상태 (저장에 같이 실림) */
const K_EXTREME_LAST = 'sys:extreme_risk_at';
const K_HAPPY_ACC = 'sys:happiness_acc';
const K_SEASON_DAY = 'sys:season_like_day';

/** 소원/걱정 정의 + 정규화한 사건 이름 */
interface WishC {
  def: WishDef;
  fulfill: string | null;
  realize: string | null;
  resolve: string | null;
}

/** 무작위 성격 칸에 들어가지 않는 특성 종류 */
const NON_PERSONALITY = new Set(['temperament', 'congenital', 'elder', 'acquired', 'reward']);

export class Inner {
  private fxCache = new Map<number, TraitFx>();
  /** 스트레스 해소 태그 (덕 keep + 죄 follow): 인물별, 덕/죄가 바뀌면 다시 만듦 */
  private reliefCache = new Map<number, { virtue: string | null; sin: string | null; tags: Set<string> }>();
  /** 가족 누군가가 최근 말한 속마음 (문장 키 → 분): 둘이 같은 말을 동시에 하지 않게 */
  private recentSaid = new Map<string, number>();
  private seq = 1;
  private emo: EmotionResult = { emotion: NEUTRAL, stage: 0, sum: 0 };
  /** 지금 데이터로 생길 수 있는 사건/무드렛 (M2~M3) */
  readonly reach: Reach;
  /** 뽑을 수 있는 소원/걱정 (도달 불가 항목은 데이터에 남기고 뽑지 않음) */
  readonly wishPool: { wish: WishDef[]; fear: WishDef[] };
  private wishById = new Map<string, WishC>();
  /** 호불호 뽑기: 항목 id 와 가중치 (지금 걸리는 항목 우선) */
  private likeIds: string[];
  private likeWeights: Float64Array;
  /** 극단 감정 위험 판정 (11-3). 새 게임 설정으로 끌 수 있음 */
  extremeRiskEnabled: boolean;
  // thought() 후보 재사용 버퍼
  private candT: Thought[] = [];
  private candW: number[] = [];

  constructor(
    private host: InnerHost,
    readonly d: InnerData,
    readonly stress: StressData,
  ) {
    const data = host.data;
    this.reach = computeReach(d, reachSourcesOf({ interactions: data.interactions, social: data.social, balance: data.balance, relations: data.relations, stress }));
    this.wishPool = { wish: [], fear: [] };
    for (const w of d.wishes) {
      this.wishById.set(w.id, {
        def: w,
        fulfill: w.fulfill ? normalizeEvent(w.fulfill.event) : null,
        realize: w.realize ? normalizeEvent(w.realize.event) : null,
        resolve: w.resolve ? normalizeEvent(w.resolve.event) : null,
      });
      if (wishReachable(this.reach, w)) this.wishPool[w.kind].push(w);
    }
    this.likeIds = [...d.likeIndex.items.keys()];
    const pw = d.likePickWeights;
    this.likeWeights = Float64Array.from(this.likeIds, (id) => {
      const r = likeReach(this.reach, d, id);
      return r === 'active' ? pw.active : r === 'future' ? pw.future : 0;
    });
    this.extremeRiskEnabled = d.extremeRisk.enabled;
  }

  /** 인물이 빠질 때 (방문객이 돌아감): 인물별 캐시 정리. id 는 재사용되지 않음 */
  forget(p: Person): void {
    this.fxCache.delete(p.id);
    this.reliefCache.delete(p.id);
  }

  /**
   * 시각을 옮김 (setTime 으로 시간을 되돌리거나 건너뛸 때). 내면 시각값을 같은 만큼 옮겨
   * 무드렛/소원 수명, 속마음 간격, 무너짐 자동 선택, 극단 감정 판정이 어긋나지 않게 함
   */
  shiftTime(p: Person, delta: number): void {
    if (!delta) return;
    p.lastThoughtAt += delta;
    p.emotionSince += delta;
    for (const m of p.moodlets) {
      m.addedAt += delta;
      if (Number.isFinite(m.expiresAt)) m.expiresAt += delta;
    }
    for (const w of p.wishes) {
      w.since += delta;
      w.expiresAt += delta;
    }
    if (p.pendingChoice) p.pendingChoice.since += delta;
    const ex = p.counters.get(K_EXTREME_LAST);
    if (ex !== undefined) p.counters.set(K_EXTREME_LAST, ex + delta);
    // 최근 말한 문장 표는 모두에게 공유: 시각이 어긋나면 비움 (중복 방지용 보조 표)
    this.recentSaid.clear();
  }

  // ---------------------------------------------------------------- 인물 초기화

  /** 특성 3칸(충돌 없이), 덕 1/죄 1(없음 가능), 호불호, 인생 목표, 소원 */
  initPerson(p: Person, rng: Rng, fixedTraits?: string[]): void {
    const slots = this.d.traits.traits;
    if (fixedTraits) p.traits = [...fixedTraits];
    else {
      const n = this.d.traits.slots[p.stage] ?? 3;
      // 성격 특성만 무작위 (기질·선천·노년은 생애/유전 규칙이 붙임, traits.json $categories)
      const ids = Object.keys(slots).filter((k) => !NON_PERSONALITY.has(slots[k].category));
      const picked: string[] = [];
      for (let guard = 0; picked.length < n && guard < 200; guard++) {
        const t = ids[rng.int(ids.length)];
        if (picked.includes(t) || this.conflicts(t, picked)) continue;
        picked.push(t);
      }
      p.traits = picked;
    }
    const v = this.d.virtues;
    const vIds = Object.keys(v.virtues);
    const sIds = Object.keys(v.sins);
    p.virtue = rng.next() < v.noneChance ? null : vIds[rng.int(vIds.length)];
    const sinCands = sIds.filter((s) => v.sins[s].virtue !== p.virtue);
    p.sin = rng.next() < v.noneChance ? null : sinCands[rng.int(sinCands.length)];
    if (p.traits.includes('flirt') && p.virtue === 'chastity') p.virtue = null;
    // 호불호 (12-3): 지금 걸리는 항목 우선 (가중치 likes.json pickWeights), 염료만 있는 항목은 옷 색(M8) 전까지 뽑지 않음
    const wts = Float64Array.from(this.likeWeights);
    const pick = (k: number) => {
      const out: string[] = [];
      while (out.length < k) {
        const i = rng.weighted(wts);
        if (i < 0) break;
        wts[i] = 0;
        out.push(this.likeIds[i]);
      }
      return out;
    };
    const pp = this.d.likePerPerson;
    p.likes = pick(pp.likes.min + rng.int(pp.likes.max - pp.likes.min + 1));
    p.dislikes = pick(pp.dislikes.min + rng.int(pp.dislikes.max - pp.dislikes.min + 1));
    // 인생 목표 (12-4): 아동은 아동 목표, 청소년부터 성인 목표, 귀족은 성인 + 귀족 목표 (16장)
    const group = p.stage === 'child' ? 'child' : 'adult';
    const asp = Object.entries(this.d.aspirations).filter(([, a]) => {
      const g = a.group ?? 'adult';
      return g === group || (g === 'noble' && group === 'adult' && p.estate === 'noble');
    });
    p.aspiration = asp.length ? { id: asp[rng.int(asp.length)][0], stage: 0 } : null;
    this.fxCache.delete(p.id);
    this.reliefCache.delete(p.id);
    p.moodDirty = true;
  }

  /** 인생 목표 다시 고르기 (청소년·청년이 될 때 아동 목표 → 성인 목표, 12-4) */
  newAspiration(p: Person, rng: Rng): void {
    const group = p.stage === 'child' ? 'child' : 'adult';
    if (p.aspiration && (this.d.aspirations[p.aspiration.id]?.group ?? 'adult') === group) return;
    const asp = Object.entries(this.d.aspirations).filter(([, a]) => {
      const g = a.group ?? 'adult';
      return g === group || (g === 'noble' && group === 'adult' && p.estate === 'noble');
    });
    p.aspiration = asp.length ? { id: asp[rng.int(asp.length)][0], stage: 0 } : null;
  }

  conflicts(t: string, have: string[]): boolean {
    for (const [a, b] of this.d.traits.conflicts) {
      if ((a === t && have.includes(b)) || (b === t && have.includes(a))) return true;
    }
    return false;
  }

  fx(p: Person): TraitFx {
    let f = this.fxCache.get(p.id);
    if (!f) {
      const effects = p.traits.map((t) => this.d.traits.traits[t]?.effects ?? this.stress.acquiredTraits[t]?.effects ?? {});
      for (const r of p.counters.keys()) if (r.startsWith('reward:') && this.d.rewards[r.slice(7)]?.effects) effects.push(this.d.rewards[r.slice(7)].effects as never);
      f = compileTraitFx(effects as never);
      this.fxCache.set(p.id, f);
    }
    return f;
  }

  invalidate(p: Person): void {
    this.fxCache.delete(p.id);
  }

  // ---------------------------------------------------------------- 무드렛

  moodletExists(id: string): boolean {
    return this.d.moodlets.has(id);
  }

  addMoodlet(p: Person, id: string, opts: { strengthAdd?: number; withPerson?: number; objectUid?: number } = {}): boolean {
    const def = this.d.moodlets.get(id);
    if (!def) {
      this.d.missingMoodlets.add(id);
      return false;
    }
    const w = this.host.world;
    const fx = this.fx(p);
    let strength = Math.max(1, Math.min(3, def.strength + fx.strengthByEmotion[def.emotion] + (opts.strengthAdd ?? 0)));
    const dur = def.durationMin * fx.durationByEmotion[def.emotion];
    const expiresAt = def.permanent || def.whileCond ? Infinity : w.minute + Math.max(1, Math.round(dur));
    // 같은 그룹은 교체 (배부름/배고픔). 자기 자신과 자기 동반 무드렛은 남김 (아래에서 갱신)
    if (def.group) {
      for (let i = p.moodlets.length - 1; i >= 0; i--) {
        const mid = p.moodlets[i].id;
        if (p.moodlets[i].group === def.group && !isSelfOrCompanion(mid, id)) p.moodlets.splice(i, 1);
      }
    }
    const cur = p.moodlets.find((m) => m.id === id);
    if (cur) {
      if (def.stack === 'stack') strength = Math.min(def.max, cur.strength + strength);
      else if (def.stack === 'replace') strength = Math.max(strength, 1);
      else strength = Math.max(cur.strength, strength);
      cur.strength = strength;
      cur.baseStrength = strength;
      cur.expiresAt = expiresAt;
      cur.addedAt = w.minute;
      this.attachCompanions(p, def, cur, fx);
      // 본 무드렛이 동반 무드렛보다 최근 → 욕구 출처 상한(11-1)을 본 감정이 먼저 차지
      cur.seq = this.seq++;
    } else {
      const m: ActiveMoodlet = {
        id, emotion: def.emotion, strength, baseStrength: strength, needSource: def.needSource, source: def.source, group: def.group,
        addedAt: w.minute, expiresAt, whileCond: def.whileCond, seq: 0,
      };
      p.moodlets.push(m);
      this.attachCompanions(p, def, m, fx);
      m.seq = this.seq++;
      if (strength >= 2 && !def.needSource) this.thought(p, `moodlet:${id}`);
      // 기억: 세기 2 이상 사건/사회/건강 무드렛
      if (strength >= 2 && (def.source === 'event' || def.source === 'social' || def.source === 'health' || def.source === 'faith' || def.source === 'memory')) {
        this.remember(p, id, POSITIVE[def.emotion] ? 1 : -1, strength, opts.withPerson ?? 0, opts.objectUid ?? -1);
      }
    }
    p.moodDirty = true;
    this.event(p, `moodlet:${id}`);
    return true;
  }

  /**
   * 두 번째 감정은 같은 수명/그룹의 동반 무드렛으로 (감정 계산에만 쓰임, id = 원래id~감정).
   * 없으면 만들고 있으면 세기/수명/순서를 본 무드렛에 맞춰 갱신. 특성의 감정별 세기 보정도 적용
   */
  private attachCompanions(p: Person, def: MoodletDef, m: ActiveMoodlet, fx: TraitFx): void {
    for (const e of def.extra) {
      const cid = companionId(def.id, e.emotion);
      const s = Math.max(1, Math.min(3, e.strength + fx.strengthByEmotion[e.emotion]));
      const c = p.moodlets.find((x) => x.id === cid);
      if (c) {
        c.strength = s;
        c.baseStrength = s;
        c.expiresAt = m.expiresAt;
        c.addedAt = m.addedAt;
        c.seq = this.seq++;
      } else p.moodlets.push({ ...m, id: cid, emotion: e.emotion, strength: s, baseStrength: s, seq: this.seq++ });
    }
  }

  removeMoodlet(p: Person, id: string): void {
    for (let i = p.moodlets.length - 1; i >= 0; i--) {
      const mid = p.moodlets[i].id;
      if (mid === id || mid.startsWith(`${id}~`)) {
        p.moodlets.splice(i, 1);
        p.moodDirty = true;
      }
    }
  }

  private recall(p: Person): void {
    const rng = this.host.rng;
    if (rng.next() > 0.06) return;
    const w = this.host.world;
    let best = -1;
    let bestW = 0;
    p.memories.forEach((m, i) => {
      if (m.importance < 2) return;
      let wt = m.importance;
      const o = m.objectUid >= 0 ? w.byUid.get(m.objectUid) : undefined;
      if (o && Math.abs(w.centerX(o) - p.x) + Math.abs(w.centerY(o) - p.y) <= 3) wt *= 4;
      const q = m.withPerson ? this.host.persons.find((x) => x.id === m.withPerson) : undefined;
      if (q && Math.hypot(q.x - p.x, q.y - p.y) <= 3) wt *= 3;
      const r = wt * rng.next();
      if (r > bestW) {
        bestW = r;
        best = i;
      }
    });
    if (best < 0) return;
    const m = p.memories[best];
    this.addMoodlet(p, m.valence > 0 ? 'fond_memory' : 'painful_memory');
    this.thought(p, 'memory');
  }

  private remember(p: Person, kind: string, valence: number, importance: number, withPerson: number, objectUid: number): void {
    p.memories.push({ kind, minute: this.host.world.minute, valence, importance, withPerson, objectUid });
    if (p.memories.length > MEMORY_MAX) {
      // 중요도 낮고 오래된 것부터 흐려짐
      let worst = 0;
      for (let i = 1; i < p.memories.length; i++) {
        const a = p.memories[i];
        const b = p.memories[worst];
        if (a.importance < b.importance || (a.importance === b.importance && a.minute < b.minute)) worst = i;
      }
      p.memories.splice(worst, 1);
    }
  }

  // ---------------------------------------------------------------- 조건 (while)

  whileHolds(p: Person, cond: string): boolean {
    const w = this.host.world;
    const g = w.grid;
    const room = g.roomOf(p.cellX(), p.cellY());
    const h = w.hour();
    const i = cond.indexOf(':');
    if (i > 0) {
      const kind = cond.slice(0, i);
      const need = cond.slice(i + 1);
      const v = p.needs[NEED_IDS.indexOf(need as never)];
      if (kind === 'need_low') return v < NEED_LOW && v >= NEED_CRIT;
      if (kind === 'need_crit') return v < NEED_CRIT;
      if (kind === 'need_high') return v >= NEED_HIGH;
      return false;
    }
    switch (cond) {
      case 'near_lit_hearth_sitting':
        return p.pose === 'sit' && w.nearLitHearth(p.x, p.y, 2);
      case 'room_dirty':
        return room >= 0 && (this.host.world.roomDirt[room] ?? 0) >= w.data.balance.roomDirt.dirtyAt;
      case 'room_smoky':
        // 굴뚝 없는/막힌 화로 곁 (Simulation.updateSmoke 가 분을 셈)
        return p.smokeMinutes > 0;
      case 'raining':
        return false;
      case 'single':
        return !this.host.persons.some((q) => q !== p && q.counters.get(`spouse:${p.id}`));
      case 'crowded': {
        let n = 0;
        for (const q of this.host.persons) if (q !== p && !q.hidden && g.roomOf(q.cellX(), q.cellY()) === room) n++;
        return room >= 0 && n >= 3;
      }
      case 'dark_night':
        return h >= 21 || h < 5;
      case 'outdoor':
        return room < 0 && !p.hidden;
      case 'dark_night_outdoor':
        return (h >= 21 || h < 5) && room < 0 && !p.hidden;
      case 'indoor_cozy':
        return room >= 0 && (this.host.world.roomDirt[room] ?? 0) < 30;
      case 'stress_40':
        return p.stress >= this.stress.stages.heavy && p.stress < this.stress.stages.limit;
      case 'stress_70':
        return p.stress >= this.stress.stages.limit;
      case 'family_near':
        for (const q of this.host.persons) if (q !== p && !q.hidden && room >= 0 && g.roomOf(q.cellX(), q.cellY()) === room) return true;
        return false;
      case 'alone_long':
        return false;
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------- 매 틱

  tick(p: Person): void {
    const w = this.host.world;
    const minute = w.minute;
    // 만료, 약해짐, while 풀림
    for (let i = p.moodlets.length - 1; i >= 0; i--) {
      const m = p.moodlets[i];
      if (m.expiresAt <= minute) {
        p.moodlets.splice(i, 1);
        p.moodDirty = true;
        continue;
      }
      // 약해짐: fade 표는 기본 세기 기준 → 줄어든 양만큼 빼서 특성 세기 보정(+1 등)을 유지. 동반 무드렛도 본 정의의 fade 를 따름
      const def = this.d.moodlets.get(m.id) ?? this.d.companions.get(m.id)?.parent;
      if (def && def.fade.length) {
        const age = minute - m.addedAt;
        let drop = 0;
        for (const [after, str] of def.fade) if (age >= after) drop = def.strength - str;
        const s = drop > 0 ? Math.max(1, m.baseStrength - drop) : m.baseStrength;
        if (s !== m.strength) {
          m.strength = s;
          p.moodDirty = true;
        }
      }
    }
    // 욕구 무드렛 (11-1 표): 단계가 바뀔 때만
    for (let n = 0; n < 8; n++) {
      const v = p.needs[n];
      const hasHigh = NEED_IDS[n] !== 'bladder';
      const lvl = v < NEED_CRIT ? 3 : v < NEED_LOW ? 2 : hasHigh && v >= NEED_HIGH ? 1 : 0;
      if (lvl === p.needLevel[n]) continue;
      const prev = p.needLevel[n];
      p.needLevel[n] = lvl;
      const need = NEED_IDS[n];
      for (let i = p.moodlets.length - 1; i >= 0; i--) if (p.moodlets[i].group === `need_${need}`) p.moodlets.splice(i, 1);
      p.moodDirty = true;
      if (lvl === 0) continue;
      const suffix = lvl === 3 ? 'crit' : lvl === 2 ? 'low' : 'high';
      this.addMoodlet(p, `need_${need}_${suffix}`);
      // 속마음: 낮아질 때만 (올라갈 때는 high 도달 시)
      if (lvl === 3) this.thought(p, `need_crit:${need}`, true);
      else if (lvl === 2 && prev < 2) this.thought(p, `need_low:${need}`);
      else if (lvl === 1) {
        this.thought(p, `need_high:${need}`);
        this.event(p, `need_high:${need}`);
      }
    }
    // 10분마다: while 조건
    if (minute % 10 === p.id % 10) this.checkWhile(p);
    // 스트레스: 자연 감소, 한계에서 무너짐 확률
    const st = this.stress;
    p.stress = Math.max(0, p.stress - st.decayPerHour / 60);
    if (p.stress >= st.stages.limit && !p.pendingChoice && this.host.rng.next() < st.limitBreakdownChancePerHour / 60) this.breakdown(p);
    if (p.pendingChoice && minute - p.pendingChoice.since >= st.autoAfter.value) this.autoChoose(p);
    // 특성 기분 (우울한 기질의 까닭 없는 울적함 등)
    const fx = this.fx(p);
    for (const im of fx.idleMoodlets) if (this.host.rng.next() < im.chancePerHour / 60) this.addMoodlet(p, im.moodlet);
    // 특성 잡담 속마음
    if (!p.sleeping && !p.hidden && this.host.rng.next() < IDLE_CHATTER_PER_HOUR / 60) this.thought(p, 'idle');
    // 감정 다시 계산
    if (p.moodDirty || minute % this.d.recomputeMinutes === 0) this.recompute(p);
    // 극단 감정 위험 (11-3): 부정 감정 극단이 설정 시간 넘게 이어지면 판정 (이어지면 같은 간격마다 다시)
    const er = this.d.extremeRisk;
    if (this.extremeRiskEnabled && p.emotionStage === 3 && er.emotions[p.emotion]) {
      const from = Math.max(p.emotionSince, p.counters.get(K_EXTREME_LAST) ?? -1e9);
      if (minute - from >= er.minutes) this.extremeRisk(p);
    }
    // 행복 포인트 (12-5): 행복/환희 상태가 이어지는 동안
    const hp = this.d.happinessPoints;
    if (hp.emotions[p.emotion]) {
      const rate = hp.perHourByStage[p.emotionStage];
      if (rate > 0) {
        const acc = (p.counters.get(K_HAPPY_ACC) ?? 0) + rate / 60;
        const n = Math.floor(acc);
        if (n > 0) p.happiness += n;
        p.counters.set(K_HAPPY_ACC, acc - n);
      }
    }
    // 지표
    p.emotionMinutes[p.emotion]++;
    // 지표: 시간 제한이 있는 무드렛만 (지속 배수 특성의 효과가 드러나는 대상. 조건형/영구 무드렛 제외)
    for (const m of p.moodlets) if (!m.needSource && Number.isFinite(m.expiresAt)) p.moodletEmotionMinutes[m.emotion] += m.strength;
    if (this.whileHolds(p, 'dark_night_outdoor')) p.outdoorNightMinutes++;
    // 소원 교체/만료
    if (minute % WISH_REFRESH === (p.id * 37) % WISH_REFRESH) this.refreshWishes(p);
    // 하루가 바뀌면: 하루 태그 무드렛 (활동적: 운동을 안 했으면 짜증)
    if (minute % w.data.balance.time.dayMinutes === 0) {
      for (const dt of fx.dailyTagMoodlets) if (!p.lastDayTags.has(dt.tag)) this.addMoodlet(p, dt.moodlet);
      p.lastDayTags.clear();
      p.todayCount.clear();
    }
    // 방 더러움: 사람이 머물면 조금씩
    const room = w.grid.roomOf(p.cellX(), p.cellY());
    if (room >= 0 && !p.sleeping && !p.hidden) w.roomDirt[room] = Math.min(100, (w.roomDirt[room] ?? 0) + w.data.balance.roomDirt.perPersonMinute);
  }

  private checkWhile(p: Person): void {
    for (let i = p.moodlets.length - 1; i >= 0; i--) {
      const m = p.moodlets[i];
      if (m.whileCond && !m.needSource && !this.whileHolds(p, m.whileCond)) {
        p.moodlets.splice(i, 1);
        p.moodDirty = true;
      }
    }
    const fx = this.fx(p);
    for (const r of fx.moodletOnWhile) if (!p.moodlets.some((m) => m.id === r.moodlet) && this.whileHolds(p, r.while)) this.addMoodlet(p, r.moodlet);
    // 환경 무드렛
    if (!p.moodlets.some((m) => m.id === 'cozy_hearth') && this.whileHolds(p, 'near_lit_hearth_sitting')) this.addMoodlet(p, 'cozy_hearth');
    // 기억 떠올리기 (11-6): 관련 물건/사람이 가까우면 확률이 커짐
    if (p.memories.length && !p.sleeping && !p.hidden) this.recall(p);
    // 좋아하는/싫어하는 계절 (12-3): 그 계절에 바깥에 나가면 하루 한 번
    if (!p.sleeping && !p.hidden) this.seasonLike(p);
    if (this.whileHolds(p, 'stress_40')) {
      if (!p.moodlets.some((m) => m.id === 'stress_heavy')) this.addMoodlet(p, 'stress_heavy');
    }
    if (this.whileHolds(p, 'stress_70')) {
      if (!p.moodlets.some((m) => m.id === 'stress_limit')) {
        this.addMoodlet(p, 'stress_limit');
        this.thought(p, 'stress:70', true);
      }
    }
  }

  private seasonLike(p: Person): void {
    const w = this.host.world;
    const items = this.d.likeIndex.bySeason.get(w.season);
    if (!items) return;
    let liked = false;
    let disliked = false;
    for (const x of items) {
      if (p.likes.includes(x)) liked = true;
      else if (p.dislikes.includes(x)) disliked = true;
    }
    if (!liked && !disliked) return;
    const day = w.day();
    if (p.counters.get(K_SEASON_DAY) === day || !this.whileHolds(p, 'outdoor')) return;
    p.counters.set(K_SEASON_DAY, day);
    const e = this.d.likeEffects;
    const special = liked ? e.seasonLikedMoodlet : e.seasonDislikedMoodlet;
    this.addMoodlet(p, special && this.d.moodlets.has(special) ? special : liked ? e.likedMoodlet : e.dislikedMoodlet);
  }

  /** 극단 감정 위험 판정: 알림 + 스트레스(→ 11-4 무너짐 경로) + 사건 (노년 심장 발작 20-2 등은 M7 이 event:extreme_risk_<감정> 에 연결) */
  private extremeRisk(p: Person): void {
    const w = this.host.world;
    p.counters.set(K_EXTREME_LAST, w.minute);
    const emo = EMOTION_IDS[p.emotion];
    const nameKey = (this.d.emotions.emotions[emo] as { nameKeys?: string[] } | undefined)?.nameKeys?.[2] ?? `emotion.${emo}.extreme`;
    this.host.notice(p, 'extreme_risk', { emotion: nameKey });
    if (this.d.extremeRisk.stress) this.addStress(p, this.d.extremeRisk.stress);
    this.event(p, 'event:extreme_risk');
    this.event(p, `event:extreme_risk_${emo}`);
  }

  recompute(p: Person): void {
    const prev = p.emotion;
    const prevStage = p.emotionStage;
    computeEmotion(p.moodlets, this.d.emotionCfg, this.emo);
    p.emotion = this.emo.emotion;
    p.emotionStage = this.emo.stage;
    p.emotionSum = this.emo.sum;
    p.moodDirty = false;
    if (p.emotion !== prev || p.emotionStage !== prevStage) {
      p.emotionSince = this.host.world.minute;
      if (p.emotion !== prev && p.emotionStage >= 1) this.thought(p, `emotion:${EMOTION_IDS[p.emotion]}`);
      if (p.emotionStage >= 2) this.event(p, `emotion:${EMOTION_IDS[p.emotion]}`);
    }
  }

  // ---------------------------------------------------------------- 스트레스

  addStress(p: Person, delta: number): void {
    const before = p.stress;
    p.stress = Math.max(0, Math.min(100, p.stress + delta));
    if (before < this.stress.stages.heavy && p.stress >= this.stress.stages.heavy) this.thought(p, 'stress:40');
    if (p.stress >= this.stress.stages.breakdown && !p.pendingChoice) this.breakdown(p);
  }

  private breakdown(p: Person): void {
    p.pendingChoice = { id: 'breakdown', since: this.host.world.minute };
    this.thought(p, 'breakdown', true);
    this.host.notice(p, 'breakdown');
  }

  /** 무너짐 선택 적용 (플레이어 또는 자동) */
  choose(p: Person, optionId: string): boolean {
    if (!p.pendingChoice) return false;
    const o = this.stress.options[optionId];
    if (!o) return false;
    p.pendingChoice = null;
    p.stress = Math.max(0, p.stress + o.stressDelta);
    this.removeMoodlet(p, 'stress_limit');
    this.removeMoodlet(p, 'stress_heavy');
    this.addMoodlet(p, o.moodlet);
    if (o.gainTrait && this.host.rng.next() < o.gainTrait.chance && !p.traits.includes(o.gainTrait.trait)) {
      const t = o.gainTrait.trait;
      if (!this.conflicts(t, p.traits)) {
        p.traits.push(t);
        this.invalidate(p);
        this.host.notice(p, 'gained_trait', { trait: `trait.${t}` });
      }
    }
    if (o.roomDirt) {
      const room = this.host.world.grid.roomOf(p.cellX(), p.cellY());
      if (room >= 0) this.host.world.roomDirt[room] = Math.min(100, (this.host.world.roomDirt[room] ?? 0) + o.roomDirt);
    }
    if (o.queue) {
      const exit = this.host.world.objects.find((x) => x.defId === 'lot_exit');
      if (exit) this.host.queueInteraction(p.id, o.queue, exit.uid, true);
    }
    this.host.notice(p, 'breakdown_done', { option: o.nameKey });
    return true;
  }

  private autoChoose(p: Person): void {
    const ids = Object.keys(this.stress.options);
    const weights = ids.map((id) => {
      let w = 1;
      for (const [t, m] of Object.entries(this.stress.options[id].weightTraits ?? {})) if (p.traits.includes(t)) w *= m;
      return w;
    });
    const i = this.host.rng.weighted(weights);
    this.choose(p, ids[i >= 0 ? i : 0]);
  }

  // ---------------------------------------------------------------- 행동

  /** 지루함 설정 (balance.boredom) */
  get boredomPer(): number {
    return (this.host.data.balance as { boredom?: { perRepeat: number } }).boredom?.perRepeat ?? 0.4;
  }

  get boredomMoodletAt(): number {
    return (this.host.data.balance as { boredom?: { moodletAt: number } }).boredom?.moodletAt ?? 3;
  }

  /** 놀이(즐거움을 광고하는 행동)인가 */
  isPastime(interactionId: string): boolean {
    const c = this.host.data.compiled.byId.get(interactionId);
    if (c) return c.ads[4] > 0;
    return (this.host.data.social[interactionId]?.ads?.fun ?? 0) > 0;
  }

  /** 지루함 배수: 오늘 n 번 한 놀이는 1 / (1 + k·n) (광고값과 즐거움 회복에 같이 적용) */
  boredom(p: Person, interactionId: string): number {
    if (!this.isPastime(interactionId)) return 1;
    return 1 / (1 + this.boredomPer * (p.todayCount.get(interactionId) ?? 0));
  }

  /** 자율 광고값 배수: 특성 태그 선호 × (스트레스 40 이상이면 덕/죄 해소 행동) */
  adMult(p: Person, tags: readonly string[], interactionId?: string): number {
    const fx = this.fx(p);
    let m = interactionId ? this.boredom(p, interactionId) : 1;
    if (!tags.length) return m;
    for (const t of tags) m *= fx.adTag.get(t) ?? 1;
    // 밤에 바깥으로 나가는 행동 = night_out (겁쟁이는 피하고 용감함은 즐김)
    if (tags.includes('outdoor')) {
      const h = this.host.world.hour();
      if (h >= 21 || h < 5) m *= fx.adTag.get('night_out') ?? 1;
    }
    const v = this.d.virtues;
    if (p.stress >= v.reliefStressAt) {
      const relief = this.reliefTags(p);
      for (const t of tags) if (relief.has(t)) {
        m *= v.reliefAdMult;
        break;
      }
    }
    return m;
  }

  /** 스트레스 해소 태그 (덕을 지키는 행동 + 죄를 따르는 행동, 12-2). 인물별 캐시 */
  private reliefTags(p: Person): Set<string> {
    let c = this.reliefCache.get(p.id);
    if (!c || c.virtue !== p.virtue || c.sin !== p.sin) {
      const v = this.d.virtues;
      c = { virtue: p.virtue, sin: p.sin, tags: new Set([...(p.virtue ? v.virtues[p.virtue]?.keep ?? [] : []), ...(p.sin ? v.sins[p.sin]?.follow ?? [] : [])]) };
      this.reliefCache.set(p.id, c);
    }
    return c.tags;
  }

  /** 좋아하는(true)/싫어하는 목록에 이 행동이 걸리는가 (역색인, 문자열 조립 없음) */
  private likeHit(list: readonly string[], interactionId: string, tags: readonly string[]): boolean {
    if (!list.length) return false;
    const li = this.d.likeIndex;
    const a = li.byInteraction.get(interactionId);
    if (a) for (const x of a) if (list.includes(x)) return true;
    for (const t of tags) {
      const b = li.byTag.get(t);
      if (b) for (const x of b) if (list.includes(x)) return true;
    }
    return false;
  }

  /**
   * 즐거움 회복 배수 (12-3 "좋아하는 것을 하면 즐거움 회복 +50%", 수치 likes.json effects.funRecoveryMult).
   * Simulation.updateNeeds 가 행동 중 즐거움(fun) 회복량에 곱함
   */
  funMult(p: Person, interactionId: string, tags: readonly string[]): number {
    return this.likeHit(p.likes, interactionId, tags) ? this.d.likeEffects.funRecoveryMult : 1;
  }

  onActionStart(p: Person, interactionId: string): void {
    this.thought(p, `action_start:${interactionId}`);
  }

  /** 행동을 끝냈을 때: 카운터, 무드렛, 특성/덕/죄, 호불호, 소원, 인생 목표, 속마음 */
  onActionDone(p: Person, interactionId: string, tags: readonly string[], moodlets: ReadonlyArray<{ id: string; chance?: number }> | undefined, partnerId = 0): void {
    this.count(p, `done:${interactionId}`);
    const today = (p.todayCount.get(interactionId) ?? 0) + 1;
    p.todayCount.set(interactionId, today);
    if (today >= this.boredomMoodletAt && this.isPastime(interactionId)) this.addMoodlet(p, 'bored_repeat');
    for (const t of tags) {
      this.count(p, `tag:${t}`);
      p.lastDayTags.add(t);
    }
    for (const m of moodlets ?? []) if (m.chance === undefined || this.host.rng.next() < m.chance) this.addMoodlet(p, m.id, { withPerson: partnerId });
    const fx = this.fx(p);
    for (const r of fx.moodletOnTag) if (tags.includes(r.tag)) this.addMoodlet(p, r.moodlet);
    for (const t of tags) {
      const d = fx.stressOnTag.get(t);
      if (d) this.addStress(p, d);
    }
    // 덕과 죄 (12-2)
    const v = this.d.virtues;
    if (p.virtue) {
      const vd = v.virtues[p.virtue];
      if (tags.some((t) => vd.keep.includes(t))) {
        p.karma += vd.keepKarma;
        this.addStress(p, vd.keepStress);
      }
      if (tags.some((t) => vd.break.includes(t))) this.addStress(p, vd.breakStress);
    }
    if (p.sin) {
      const sd = v.sins[p.sin];
      if (tags.some((t) => sd.follow.includes(t))) {
        p.karma += sd.followKarma;
        this.addStress(p, sd.followStress);
      }
    }
    // 호불호 (12-3)
    if (this.likeHit(p.likes, interactionId, tags)) this.addMoodlet(p, this.d.likeEffects.likedMoodlet);
    else if (this.likeHit(p.dislikes, interactionId, tags)) this.addMoodlet(p, this.d.likeEffects.dislikedMoodlet);
    this.thought(p, `action_done:${interactionId}`);
    for (const t of tags) this.thought(p, `tag_done:${t}`);
    this.event(p, `done:${interactionId}`);
    for (const t of tags) this.event(p, `tag:${t}`);
  }

  /** 행동 수행 1분: 태그 지표 */
  onPerformMinute(p: Person, tags: readonly string[]): void {
    for (const t of tags) p.tagMinutes[t] = (p.tagMinutes[t] ?? 0) + 1;
  }

  count(p: Person, key: string, n = 1): void {
    p.counters.set(key, (p.counters.get(key) ?? 0) + n);
    this.checkAspiration(p);
  }

  // ---------------------------------------------------------------- 소원/걱정/인생 목표

  private wishOk(p: Person, w: WishDef): boolean {
    const c = w.when;
    if (!c) return true;
    if (c.traitsAny && !c.traitsAny.some((t) => p.traits.includes(t))) return false;
    if (c.estates && !c.estates.includes(p.estate)) return false;
    if (c.stages && !c.stages.includes(p.stage)) return false;
    if (c.emotionsAny && !c.emotionsAny.includes(EMOTION_IDS[p.emotion])) return false;
    const cx = c as { virtuesAny?: string[]; likesAny?: string[]; seasons?: string[]; aspirationsAny?: string[]; pregnant?: boolean; married?: boolean; hasBaby?: boolean; hasChild?: boolean; flags?: string[] };
    // M7 조건 (wishes_m7.json): 임신·기혼·아이·가문 상태 플래그 (아직 없는 체계의 플래그는 거짓 → 그 소원은 안 뜸)
    if (cx.pregnant !== undefined && !!p.pregnancy !== cx.pregnant) return false;
    if (cx.married !== undefined && !!p.spouse !== cx.married) return false;
    const fam = (this.host as unknown as { familyFlags?(p: Person): ReadonlySet<string> }).familyFlags?.(p);
    if (cx.hasBaby !== undefined && !!fam?.has('has_baby') !== cx.hasBaby) return false;
    if (cx.hasChild !== undefined && !!fam?.has('has_child') !== cx.hasChild) return false;
    if (cx.flags && !cx.flags.every((f) => fam?.has(f))) return false;
    if (cx.virtuesAny && !cx.virtuesAny.some((v) => v === p.virtue || v === p.sin)) return false;
    if (cx.likesAny && !cx.likesAny.some((l) => p.likes.includes(l) || p.likes.some((k) => k.endsWith(`.${l}`)))) return false;
    if (cx.seasons && !cx.seasons.includes(this.host.world.season)) return false;
    if (cx.aspirationsAny && !(p.aspiration && cx.aspirationsAny.includes(p.aspiration.id))) return false;
    const h = this.host.world.hour();
    if (c.minHour !== undefined && h < c.minHour) return false;
    if (c.maxHour !== undefined && h >= c.maxHour) return false;
    return true;
  }

  /** 특정 소원 주기 (가훈 소원 16-1 등). 이미 있거나, 없는 소원이거나, 아기·유아면 false */
  giveWish(p: Person, id: string): boolean {
    if (p.lifeStage === 'baby' || p.lifeStage === 'toddler' || p.wishes.some((w) => w.id === id)) return false;
    const w = this.wishPool.wish.find((x) => x.id === id) ?? this.wishPool.fear.find((x) => x.id === id);
    if (!w) return false;
    const now = this.host.world.minute;
    p.wishes.push({ id: w.id, kind: w.kind, since: now, expiresAt: now + (w.expire?.value ?? 720), locked: false });
    return true;
  }

  refreshWishes(p: Person): void {
    const now = this.host.world.minute;
    // 아기·유아는 소원/걱정이 없음 (말로 바라는 나이가 아님)
    if (p.lifeStage === 'baby' || p.lifeStage === 'toddler') {
      if (p.wishes.length) p.wishes = [];
      return;
    }
    p.wishes = p.wishes.filter((w) => w.locked || w.expiresAt > now);
    const have = new Set(p.wishes.map((w) => w.id));
    for (const kind of ['wish', 'fear'] as const) {
      const cap = kind === 'wish' ? WISH_SLOTS : FEAR_SLOTS;
      let n = p.wishes.filter((w) => w.kind === kind).length;
      if (n >= cap) continue;
      const pool = this.wishPool[kind].filter((w) => !have.has(w.id) && this.wishOk(p, w));
      while (n < cap && pool.length) {
        const i = this.host.rng.weighted(pool.map((w) => w.weight ?? 1));
        const w = pool.splice(i >= 0 ? i : 0, 1)[0];
        const life = w.expire?.value ?? 720;
        p.wishes.push({ id: w.id, kind, since: now, expiresAt: now + life, locked: false });
        have.add(w.id);
        n++;
        this.thought(p, kind === 'wish' ? 'wish_new' : 'fear_new');
      }
    }
  }

  /**
   * 사건: 카운터(인생 목표), 호불호, 소원 이룸, 걱정 현실화/해소.
   * 접두어 없는 이름은 event:<이름> (사회 결과 events 는 'event:' 를 떼고 들어옴).
   * done/tag/social/social_recv 는 부르는 쪽이 count 로 셈, moodlet 은 세지 않음. 나머지(event, social_ok, need_high, emotion, stock_low …)는 여기서 셈
   */
  event(p: Person, evIn: string): void {
    const ev = normalizeEvent(evIn);
    const c = ev.indexOf(':');
    if (!COUNTED_ELSEWHERE.has(ev.slice(0, c))) this.count(p, ev);
    const li = this.d.likeIndex.byEvent.get(ev);
    if (li) {
      if (li.some((x) => p.likes.includes(x))) this.addMoodlet(p, this.d.likeEffects.likedMoodlet);
      else if (li.some((x) => p.dislikes.includes(x))) this.addMoodlet(p, this.d.likeEffects.dislikedMoodlet);
    }
    if (!p.wishes.length) return;
    for (let i = p.wishes.length - 1; i >= 0; i--) {
      if (i >= p.wishes.length) continue;
      const aw = p.wishes[i];
      const wc = this.wishById.get(aw.id);
      if (!wc) continue;
      const def = wc.def;
      if (aw.kind === 'wish' && wc.fulfill === ev) {
        p.wishes.splice(i, 1);
        p.happiness += def.points ?? 20;
        this.addMoodlet(p, 'wish_fulfilled');
        this.thought(p, 'wish_done', true);
        this.host.notice(p, 'wish_done', { wish: def.textKey });
      } else if (aw.kind === 'fear' && wc.realize === ev) {
        p.wishes.splice(i, 1);
        this.addMoodlet(p, def.moodlet ?? 'fear_realized');
        this.thought(p, 'fear_real', true);
        this.host.notice(p, 'fear_real', { wish: def.textKey });
      } else if (aw.kind === 'fear' && wc.resolve === ev) {
        p.wishes.splice(i, 1);
        p.happiness += def.points ?? 10;
      }
    }
  }

  private checkAspiration(p: Person): void {
    const a = p.aspiration;
    if (!a) return;
    const def = this.d.aspirations[a.id];
    if (!def) return;
    while (a.stage < def.stages.length) {
      const st = def.stages[a.stage];
      if (!st.need.every((n) => this.needMet(p, n))) break;
      a.stage++;
      p.happiness += 100 * a.stage;
      this.host.notice(p, 'aspiration_stage', { aspiration: def.nameKey, stage: a.stage });
      if (a.stage >= def.stages.length) {
        // 완료: 성인/귀족은 보상 특성 (효과가 fx 에 들어가도록 캐시 무효화), 아동은 성인 특성 선택지 보너스 기록 (M7 성장 때 읽음)
        p.counters.set(`aspiration_done:${a.id}`, 1);
        if (def.rewardTrait) {
          p.counters.set(`reward:${def.rewardTrait}`, 1);
          this.invalidate(p);
        }
      }
    }
  }

  private needMet(p: Person, n: NeedCond): boolean {
    if ('any' in n) return n.any.some((x) => this.needMet(p, x));
    // 기간 조건 {value, scale}: 수명/계절 설정 배수는 M7(생애)에서 연결. 지금은 기본 설정(배수 1)
    const gte = typeof n.gte === 'number' ? n.gte : n.gte.value;
    return (p.counters.get(n.counter) ?? 0) >= gte;
  }

  /** 행복 포인트로 보상 특성 구매 (상점 보상만. 인생 목표 완료 보상은 살 수 없음) */
  buyReward(p: Person, id: string): boolean {
    const r = this.d.rewards[id];
    if (!r || r.kind !== 'shop' || !(r.cost > 0) || p.counters.get(`reward:${id}`) || p.happiness < r.cost) return false;
    p.happiness -= r.cost;
    p.counters.set(`reward:${id}`, 1);
    this.invalidate(p);
    return true;
  }

  // ---------------------------------------------------------------- 속마음 (11-5)

  /**
   * 트리거에 맞는 문장을 고름: 조건(신분/특성/감정/단계)을 많이 만족할수록 가중치, 오늘 한 말은 제외.
   * urgent 가 아니면 최근 THOUGHT_GAP 분 안에 말했으면 넘김
   */
  thought(p: Person, trigger: string, urgent = false): void {
    if (p.hidden || (p.sleeping && trigger !== 'wake')) return;
    const list = this.d.thoughts.get(trigger);
    if (!list || !list.length) return;
    const now = this.host.world.minute;
    if (!urgent && now - p.lastThoughtAt < THOUGHT_GAP) return;
    const day = this.host.world.day();
    const emo = EMOTION_IDS[p.emotion];
    let total = 0;
    const candT = this.candT;
    const candW = this.candW;
    let n = 0;
    for (const t of list) {
      if (p.thoughtDay.get(t.textKey) === day) continue;
      const said = this.recentSaid.get(t.textKey);
      if (said !== undefined && now - said < 60) continue;
      if (t.estates && !t.estates.includes(p.estate)) continue;
      if (t.traits && !t.traits.some((x) => p.traits.includes(x))) continue;
      if (t.emotions && !t.emotions.includes(emo)) continue;
      if (t.stages && !t.stages.includes(p.stage)) continue;
      // 어른이 아이 말투를 쓰지 않도록: stages 가 없는 문장은 아동에게 덜 줌
      let w = (t.weight ?? 1) * (1 + (t.estates ? 1 : 0) + (t.traits ? 2 : 0) + (t.emotions ? 1 : 0) + (t.stages ? 2 : 0));
      if (p.stage === 'child' && !t.stages) w *= 0.2;
      candT[n] = t;
      candW[n] = w;
      n++;
      total += w;
    }
    if (!n || total <= 0) return;
    let r = this.host.rng.next() * total;
    let pick = candT[0];
    for (let i = 0; i < n; i++) {
      r -= candW[i];
      if (r <= 0) {
        pick = candT[i];
        break;
      }
    }
    p.thoughtDay.set(pick.textKey, day);
    p.lastThoughtAt = now;
    this.recentSaid.set(pick.textKey, now);
    if (this.recentSaid.size > 300) for (const [k, m] of this.recentSaid) if (now - m > 60) this.recentSaid.delete(k);
    this.host.notice(p, 'thought', { key: pick.textKey, trigger });
  }

  walkMult(p: Person): number {
    return (this.d.emotions.emotions[EMOTION_IDS[p.emotion]] as { walkMult?: number } | undefined)?.walkMult ?? 1;
  }

  emotionIndex(id: EmotionId): number {
    return EMOTION_INDEX[id];
  }
}
