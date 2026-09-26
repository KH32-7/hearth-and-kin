/**
 * 명예와 평판 (GDD 16-4): 평판 4종 변화 {fame, church, karma, morale} + 개인 명예.
 * - 가문 명성 0~1000 (가문 단위, 감쇠 없음), 단계 6. 단계가 오르면 fame_proud, 불명예로 떨어지면 dishonored_shame
 * - 개인 명예 −500~500: 사건이 특정 인물 행동에서 나오면 그 명성 변화가 같은 부호로 쌓임. 특성/보상 배수
 *   (기사도 = 감소 절반, 교활함 = 들키면(exposed) 감소 2배, 정의로움 = 선행(deed) 개인 명예 +50%)
 * - 교회 평판 −100~100: 0 쪽으로 하루 0.5 (lifespan 속도 = 수명 배수로 나눔). 업보 −100~100 감쇠 없음
 * - 민심 0~100 (마을): 50 쪽으로 하루 1. M9 영주·마을 정책이 읽음
 * 사건 카드 결과(24-1 스키마)의 평판 필드는 apply 로. 렌더러/DOM 없음
 */
import type { Person } from '../people/person';
import type { Clans, ClansData, FameTier, HouseHost } from './clans';
import { durDays, hasTraitOrReward, TIERS } from './clans';

/** 사건 결과 스키마 (24-1, 16-4): 평판 4종 + 개인 명예 직접 변화 */
export interface RepDelta {
  fame?: number;
  church?: number;
  karma?: number;
  morale?: number;
  honor?: number;
}

export interface RepResult {
  /** 실제로 가문 명성에 더해진 양 */
  fame: number;
  /** 개인 명예에 더해진 양 */
  honor: number;
  church: number;
  karma: number;
  morale: number;
  tierFrom: FameTier | null;
  tierTo: FameTier | null;
}

export class Honor {
  /** 마을 민심 (0~100) */
  morale: number;

  constructor(private host: HouseHost, private clans: Clans, readonly d: ClansData) {
    this.morale = d.morale.start;
  }

  // ---------------------------------------------------------------- 배수

  /** 개인 명예·가문 명성 배수 (12장 특성, 보상 특성). delta 부호와 사건 태그로 */
  multipliers(p: Person | null, delta: number, tags: readonly string[]): { honor: number; fame: number } {
    let h = 1;
    let f = 1;
    if (!p || !delta) return { honor: h, fame: f };
    for (const m of this.d.honor.modifiers) {
      if (!hasTraitOrReward(p, m.id, m.kind)) continue;
      if (m.tags && !m.tags.some((t) => tags.includes(t))) continue;
      if (delta < 0) {
        if (m.lossMult !== undefined) h *= m.lossMult;
        if (m.fameLossMult !== undefined) f *= m.fameLossMult;
      } else if (m.gainMult !== undefined) h *= m.gainMult;
    }
    return { honor: h, fame: f };
  }

  // ---------------------------------------------------------------- 적용

  /**
   * 평판 변화 적용. actor = 이 사건을 일으킨 인물 (없으면 가문 전체의 일 → 개인 명예 없음).
   * clanId 를 안 주면 actor 의 가문. d.honor 는 개인 명예에 직접 더함 (카드의 honor 필드)
   */
  apply(actor: Person | null, clanId: number | null, d: RepDelta, reason: string, tags: readonly string[] = []): RepResult {
    const cid = clanId ?? (actor ? this.clans.clanOf(actor)?.id ?? 0 : 0);
    const res: RepResult = { fame: 0, honor: 0, church: 0, karma: 0, morale: 0, tierFrom: null, tierTo: null };
    if (d.fame) {
      const mult = this.multipliers(actor, d.fame, tags);
      let fd = d.fame * mult.fame;
      if (fd < 0 && cid) fd *= this.clans.rewardEffects(cid).fameLossMult;
      fd = Math.round(fd);
      if (cid) {
        const before = this.clans.fame(cid);
        res.fame = this.clans.addFameRaw(cid, fd);
        this.afterFame(cid, before, reason);
        res.tierFrom = this.clans.tierOf(before);
        res.tierTo = this.clans.tier(cid);
      }
      if (actor) res.honor += this.addHonor(actor, Math.round(d.fame * mult.honor));
    }
    if (d.honor && actor) res.honor += this.addHonor(actor, d.honor);
    if (d.church && actor) {
      let c = d.church;
      if (c > 0 && cid) c *= this.clans.rewardEffects(cid).churchGainMult;
      res.church = this.addChurch(actor, c);
    }
    if (d.karma && actor) res.karma = this.addKarma(actor, d.karma);
    if (d.morale) res.morale = this.addMorale(d.morale);
    return res;
  }

  /** 인물 기준 (카드 엔진 CardsHost.reputation 대신): 그 사람 가문, 그 사람이 행위자 */
  applyFor(p: Person, d: RepDelta, reason: string, tags: readonly string[] = []): RepResult {
    return this.apply(p, null, d, reason, tags);
  }

  /** 가구 기준 명성 (Simulation.addFame 대신). actor 가 있으면 개인 명예도 */
  addFameHousehold(household: number, delta: number, reason: string, actor: Person | null = null, tags: readonly string[] = []): RepResult {
    return this.apply(actor, this.clans.clanIdOfHousehold(household) || null, { fame: delta }, reason, tags);
  }

  /** 데이터에 적힌 명예 사건 (clans.json events) */
  event(id: string, actor: Person | null, clanId: number | null = null, scale = 1): RepResult | null {
    const e = this.d.events[id];
    if (!e || typeof e === 'string') return null;
    const s = (v: number | undefined) => (v === undefined ? undefined : v * scale);
    return this.apply(actor, clanId, { fame: s(e.fame), church: s(e.church), karma: s(e.karma), morale: s(e.morale) }, id, e.tags ?? []);
  }

  /** 명예를 올리는 사건 / 깎는 사건 목록 (16-4) */
  events(): { raise: string[]; lower: string[] } {
    const raise: string[] = [];
    const lower: string[] = [];
    for (const [id, e] of Object.entries(this.d.events)) {
      if (typeof e === 'string') continue;
      if ((e.fame ?? 0) > 0) raise.push(id);
      else if ((e.fame ?? 0) < 0) lower.push(id);
    }
    return { raise, lower };
  }

  addHonor(p: Person, delta: number): number {
    const before = p.honor;
    p.honor = Math.max(this.d.honor.min, Math.min(this.d.honor.max, p.honor + delta));
    return p.honor - before;
  }

  addChurch(p: Person, delta: number): number {
    const before = p.churchRep;
    p.churchRep = Math.max(this.d.church.min, Math.min(this.d.church.max, p.churchRep + delta));
    return p.churchRep - before;
  }

  addKarma(p: Person, delta: number): number {
    const before = p.karma;
    p.karma = Math.max(this.d.karma.min, Math.min(this.d.karma.max, p.karma + delta));
    return p.karma - before;
  }

  addMorale(delta: number): number {
    const before = this.morale;
    this.morale = Math.max(this.d.morale.min, Math.min(this.d.morale.max, this.morale + delta));
    return this.morale - before;
  }

  /** 단계가 바뀌면 가족 무드렛과 알림 */
  private afterFame(clanId: number, before: number, reason: string): void {
    const after = this.clans.fame(clanId);
    const t0 = this.clans.tierOf(before);
    const t1 = this.clans.tierOf(after);
    const mem = this.clans.members(clanId);
    const lead = mem.find((p) => this.host.controlled(p.household));
    if (lead && after !== before) this.host.notice(lead, after > before ? 'fame_up' : 'fame_down', { n: Math.abs(after - before), reason: `fame.reason.${reason}` });
    if (t0 === t1) return;
    const up = TIERS.indexOf(t1) > TIERS.indexOf(t0);
    const mood = up ? this.d.fame.tierUpMoodlet : t1 === 'dishonored' ? this.d.fame.dishonoredMoodlet : null;
    if (mood) for (const p of mem) if (p.lifeStage !== 'baby' && p.lifeStage !== 'toddler') this.host.moodlet(p, mood);
    if (lead) this.host.notice(lead, 'fame_tier', { tier: `fame.tier.${t1}` });
    this.host.chronicle(up ? 'fame_rise' : 'fame_fall', mem.slice(0, 1), { tier: `fame.tier.${t1}` });
  }

  // ---------------------------------------------------------------- 하루

  /** 자정: 교회 평판 0 쪽 감쇠 (수명 속도), 민심 50 쪽 */
  daily(): void {
    const L = this.host.lifespan();
    const cd = this.d.church.decayPerDay;
    const step = cd.scale === 'lifespan' ? cd.value / L : durDays(cd, L);
    for (const p of this.host.persons) {
      if (p.churchRep > 0) p.churchRep = Math.max(0, p.churchRep - step);
      else if (p.churchRep < 0) p.churchRep = Math.min(0, p.churchRep + step);
    }
    const M = this.d.morale;
    const ms = M.perDay.scale === 'lifespan' ? M.perDay.value / L : durDays(M.perDay, L);
    if (this.morale > M.toward) this.morale = Math.max(M.toward, this.morale - ms);
    else if (this.morale < M.toward) this.morale = Math.min(M.toward, this.morale + ms);
  }

  // ---------------------------------------------------------------- 읽기

  /** 개인 명예 칭호 (i18n 키, 없으면 null) */
  title(p: Person): string | null {
    const ts = [...this.d.honor.titles].sort((a, b) => b.min - a.min);
    for (const t of ts) if (p.honor >= t.min) return t.key;
    return ts[ts.length - 1]?.key ?? null;
  }

  /** 가문 표시용 교회 평판 (가문 사람 평균) */
  clanChurch(clanId: number): number {
    const m = this.clans.members(clanId);
    return m.length ? m.reduce((a, p) => a + p.churchRep, 0) / m.length : 0;
  }

  /** 원수의 개인 명예를 절반으로 (인생 목표 "복수" 2단계, 12장): 반으로 깎고 true */
  halveHonor(p: Person): boolean {
    if (p.honor <= 0) return false;
    p.honor = Math.floor(p.honor / 2);
    return true;
  }
}
