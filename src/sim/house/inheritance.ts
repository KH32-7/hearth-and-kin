/**
 * 상속 (GDD 16-5): 상속법 3 (장자 / 균분 / 지명 유언장), 계승 순위 설정 (사생아·성직자·출가한 딸 뒤로, 남자 우선),
 * 가장 사망 → 장례 → 유언 공개(차단 장면 훅) → 재산 나눔 → 새 가장 → 가보 계승 → 조작 인물 선택 훅 → 상속 분쟁 판정.
 * - 유언장 쓰기: 읽기 스킬 또는 사제(수수료). 유언은 사망 시점에 확정 (유령의 "남겨진 비밀"은 분쟁 카드로만, 20-6)
 * - 상속 분쟁: 형제 우정 나쁨 + 재산 차 큼 + 가문 애정(clanAffection, 15-6) 낮음 → inheritance_dispute 카드 (소송·원한·가문 분열)
 * 렌더러/DOM 없음. 무작위는 host.rng 만
 */
import type { Person } from '../people/person';
import type { Clans, ClansData, HouseHost, InheritanceLaw, LawOptions } from './clans';
import { durDays, olderFirst, stageAtLeast } from './clans';
import type { Heirlooms } from './heirlooms';

export interface InheritanceHost extends HouseHost {
  /** 집값 (동화, 집이 가문 소유가 아니면 0: 농노 오두막·사제관) */
  houseValue(household: number): number;
  transferMoney(fromHousehold: number, toHousehold: number, amount: number, reason: string): boolean;
  spend(household: number, amount: number, reason: string): boolean;
  /** 유언장을 받아 적어 줄 사제가 있는가 (교구 사제 생존·마을에 있음) */
  priestAvailable(p: Person): boolean;
  /** 장례 (M11 20장). 없으면 건너뜀 */
  funeral?(deceased: Person): void;
  /** 유언 공개 연출 (차단 장면, 27-7) */
  scene?(kind: string, args: Record<string, string | number>, subjects: Person[]): void;
  /** 조작 가문의 가장이 죽음 → 플레이어가 조작 인물을 고름 (후보 = 가문 사람) */
  chooseControlled?(clanId: number, candidates: Person[]): void;
  /** 분가 (장자상속의 "나머지는 분가", 의절): 이 사람들을 새 가구로. 새 가구 번호, 못 하면 −1 */
  splitHousehold?(persons: Person[], reason: string): number;
}

export interface Will {
  testator: number;
  day: number;
  /** 가장 계승자 (집·재산 대부분) */
  heir: number;
  /** 가보 받을 사람 (0 = 계승자) */
  heirloomsTo: number;
  /** 돈 몫 (인물 id → 비율 0~1, 계승자는 나머지) */
  shares: Record<number, number>;
  via: 'self' | 'priest';
}

export interface Share {
  personId: number;
  money: number;
  house: boolean;
  /** 돈 + 집값 */
  value: number;
}

export interface Settlement {
  clanId: number;
  deceased: number;
  household: number;
  law: InheritanceLaw;
  /** 법이 지명이지만 유언장이 없어서 대체 법을 씀 */
  fallback: boolean;
  heir: number;
  newHead: number;
  heirloomsTo: number;
  total: number;
  houseValue: number;
  shares: Share[];
  /** 분가해야 하는 사람 (장자상속: 같은 집에 사는 첫째 아닌 성인 자녀) */
  splits: number[];
}

export interface Dispute {
  heir: number;
  other: number;
  friendship: number;
  gap: number;
  affection: number;
}

export interface InheritanceReport extends Settlement {
  heirlooms: { heirloom: number; to: number }[];
  disputes: Dispute[];
  newHouseholds: number[];
}

export class Inheritance {
  readonly wills = new Map<number, Will>();
  /** 가문 → 최근 상속 끝나는 날 (recent_inheritance), 인물 → 분쟁 플래그 끝나는 날 (sibling_rivalry) */
  private recent = new Map<number, number>();
  private rivalry = new Map<number, number>();
  /** 마지막 상속 (가문 → 보고, 유령의 비밀 → 분쟁 카드 다시) */
  readonly last = new Map<number, InheritanceReport>();

  constructor(private host: InheritanceHost, private clans: Clans, private heirlooms: Heirlooms | null, readonly d: ClansData) {}

  private get I() {
    return this.d.inheritance;
  }

  // ---------------------------------------------------------------- 유언장

  /** 유언장을 쓸 수 있는가: 청년 이상, 읽기 스킬 (문해력) 또는 사제 + 수수료 */
  canWriteWill(p: Person): { ok: boolean; via?: 'self' | 'priest'; reason?: string } {
    if (!stageAtLeast(p, 'young')) return { ok: false, reason: 'too_young' };
    if (this.host.skillLevel(p, 'reading') >= this.I.will.readingLevel) return { ok: true, via: 'self' };
    if (!this.host.priestAvailable(p)) return { ok: false, reason: 'illiterate' };
    if (this.host.money(p.household) < this.I.will.priestFee) return { ok: false, reason: 'no_money' };
    return { ok: true, via: 'priest' };
  }

  /** 유언장 쓰기 (상호작용 "유언장 쓰기", 의도 writeWill). 다시 쓰면 덮어씀 */
  writeWill(p: Person, spec: { heir: number; heirloomsTo?: number; shares?: Record<number, number> }): { ok: boolean; reason?: string; will?: Will } {
    const can = this.canWriteWill(p);
    if (!can.ok) return { ok: false, reason: can.reason };
    const alive = (id: number) => this.host.persons.some((q) => q.id === id);
    if (!spec.heir || !alive(spec.heir) || spec.heir === p.id) return { ok: false, reason: 'bad_heir' };
    if (spec.heirloomsTo && !alive(spec.heirloomsTo)) return { ok: false, reason: 'bad_heir' };
    const shares: Record<number, number> = {};
    let sum = 0;
    for (const [k, v] of Object.entries(spec.shares ?? {})) {
      const id = Number(k);
      if (!alive(id) || id === p.id || !(v > 0)) return { ok: false, reason: 'bad_share' };
      shares[id] = v;
      sum += v;
    }
    if (sum > 1 + 1e-9) return { ok: false, reason: 'shares_over' };
    if (can.via === 'priest' && !this.host.spend(p.household, this.I.will.priestFee, 'will_priest')) return { ok: false, reason: 'no_money' };
    const will: Will = { testator: p.id, day: this.host.day(), heir: spec.heir, heirloomsTo: spec.heirloomsTo ?? 0, shares, via: can.via! };
    this.wills.set(p.id, will);
    this.host.memory(p, 'will_written', 3, 0, spec.heir);
    if (this.I.will.writtenMoodlet) this.host.moodlet(p, this.I.will.writtenMoodlet);
    this.host.chronicle('will_written', [p]);
    return { ok: true, will };
  }

  // ---------------------------------------------------------------- 계승 순위

  private isMarriedOutDaughter(p: Person, clanId: number): boolean {
    if (p.sex !== 'female') return false;
    const cur = this.clans.clanOf(p)?.id ?? 0;
    return cur !== clanId && (p.spouse !== 0 || this.clans.birthClanOf(p) === clanId);
  }

  /** 뒤로 밀리는 까닭 (설정): bastard / clergy / married_daughter, 아니면 null */
  demotion(p: Person, clanId: number, opts: LawOptions): string | null {
    if (opts.bastardsLast && this.clans.bastards.has(p.id)) return 'bastard';
    if (opts.clergyLast && p.estate === 'clergy') return 'clergy';
    if (opts.marriedDaughtersLast && this.isMarriedOutDaughter(p, clanId)) return 'married_daughter';
    return null;
  }

  /** 자녀 계승 순위: 나이순(첫째 먼저, 설정에 따라 남자 먼저), 뒤로 밀리는 자녀는 끝에 (그 안에서도 나이순) */
  successionOrder(clanId: number, deceased: Person): Person[] {
    const c = this.clans.clan(clanId);
    const opts = c?.lawOpts ?? this.I.defaults;
    const kids = this.host.persons.filter((q) => q.id !== deceased.id && (q.mother === deceased.id || q.father === deceased.id) && q.status !== 'ghost');
    const sort = (a: Person, b: Person): number => {
      if (opts.malePreference && a.sex !== b.sex) return a.sex === 'male' ? -1 : 1;
      return olderFirst(a, b);
    };
    const first = kids.filter((q) => !this.demotion(q, clanId, opts)).sort(sort);
    const last = kids.filter((q) => !!this.demotion(q, clanId, opts)).sort(sort);
    return [...first, ...last];
  }

  private canHead(p: Person, clanId: number): boolean {
    return this.clans.clanOf(p)?.id === clanId && stageAtLeast(p, this.I.minHeadStage) && p.status !== 'ghost';
  }

  /** 새 가장: 계승자 → 순위의 다음 성인 → 배우자 → 가문의 가장 나이 많은 성인 → 누구든 */
  pickHead(clanId: number, deceased: Person, heir: Person | null, order: Person[]): Person | null {
    if (heir && this.canHead(heir, clanId)) return heir;
    for (const q of order) if (this.canHead(q, clanId)) return q;
    const sp = deceased.spouse ? this.host.persons.find((q) => q.id === deceased.spouse) : undefined;
    if (sp && this.canHead(sp, clanId)) return sp;
    const mem = this.clans.members(clanId).filter((q) => q.id !== deceased.id).sort(olderFirst);
    return mem.find((q) => this.canHead(q, clanId)) ?? (heir && this.clans.clanOf(heir)?.id === clanId ? heir : null) ?? mem[0] ?? null;
  }

  // ---------------------------------------------------------------- 재산 나눔 (순수 계산)

  settle(clanId: number, deceased: Person, law?: InheritanceLaw): Settlement {
    const c = this.clans.clan(clanId);
    let useLaw: InheritanceLaw = law ?? c?.law ?? this.I.defaultLaw;
    const hh = deceased.household;
    const M = Math.max(0, Math.floor(this.host.money(hh)));
    const H = Math.max(0, Math.floor(this.host.houseValue(hh)));
    const order = this.successionOrder(clanId, deceased);
    const will = this.wills.get(deceased.id);
    const byId = (id: number) => this.host.persons.find((q) => q.id === id) ?? null;
    let fallback = false;
    if (useLaw === 'will' && (!will || !byId(will.heir))) {
      useLaw = this.I.will.fallback;
      fallback = true;
    }
    const shares: Share[] = [];
    const push = (p: Person, money: number, house: boolean) => shares.push({ personId: p.id, money: Math.max(0, Math.floor(money)), house, value: Math.max(0, Math.floor(money)) + (house ? H : 0) });
    let heir: Person | null = null;
    const splits: number[] = [];
    if (useLaw === 'will' && will) {
      heir = byId(will.heir);
      let given = 0;
      const others: [Person, number][] = [];
      for (const [k, v] of Object.entries(will.shares)) {
        const q = byId(Number(k));
        if (!q || q.id === heir!.id) continue;
        others.push([q, v]);
      }
      for (const [q, v] of others) {
        const m = Math.floor(M * v);
        given += m;
        push(q, m, false);
      }
      shares.unshift({ personId: heir!.id, money: M - given, house: true, value: M - given + H });
      // 유언장에 없는 자녀는 0 (분쟁 판정에 들어감)
      for (const q of order) if (!shares.some((s) => s.personId === q.id)) push(q, 0, false);
    } else if (!order.length) {
      // 자녀가 없음: 재산은 가정에 그대로 (새 가장)
    } else if (useLaw === 'primogeniture') {
      heir = order[0];
      const rest = order.slice(1);
      let each = Math.floor(M * this.I.othersShare);
      if (each * rest.length > M * this.I.othersCap) each = Math.floor((M * this.I.othersCap) / rest.length);
      push(heir, M - each * rest.length, true);
      for (const q of rest) push(q, each, false);
      if (this.I.splitAdultsOnPrimogeniture) {
        for (const q of rest) if (q.household === hh && this.I.adultStages.includes(q.lifeStage) && this.clans.clanOf(q)?.id === clanId) splits.push(q.id);
      }
    } else {
      // 균분: 돈 + 집을 n 몫으로. 집은 한 명(첫째), 나머지는 돈
      heir = order[0];
      const n = order.length;
      const per = (M + H) / n;
      const heirMoney = Math.max(0, per - H);
      const need = heirMoney + per * (n - 1);
      const f = need > M && need > 0 ? M / need : 1;
      push(heir, heirMoney * f, true);
      for (const q of order.slice(1)) push(q, per * f, false);
    }
    const newHead = this.pickHead(clanId, deceased, heir, order);
    if (!heir) {
      // 자녀가 없으면 새 가장이 집과 돈을 그대로
      if (newHead) shares.push({ personId: newHead.id, money: M, house: true, value: M + H });
    }
    let heirloomsTo = heir?.id ?? newHead?.id ?? 0;
    if (useLaw === 'will' && will?.heirloomsTo && byId(will.heirloomsTo)) heirloomsTo = will.heirloomsTo;
    return {
      clanId,
      deceased: deceased.id,
      household: hh,
      law: useLaw,
      fallback,
      heir: heir?.id ?? 0,
      newHead: newHead?.id ?? 0,
      heirloomsTo,
      total: M + H,
      houseValue: H,
      shares,
      splits,
    };
  }

  // ---------------------------------------------------------------- 분쟁 판정

  /** 형제 우정 나쁨 + 재산 차 큼 + 가문 애정 낮음. chance 로 굴림 (기본 1 = 조건이면 반드시) */
  disputes(s: Settlement): Dispute[] {
    const D = this.I.dispute;
    const byId = (id: number) => this.host.persons.find((q) => q.id === id) ?? null;
    const top = [...s.shares].sort((a, b) => b.value - a.value)[0];
    const heir = top ? byId(top.personId) : null;
    if (!heir || s.total <= 0) return [];
    const out: Dispute[] = [];
    for (const sh of s.shares) {
      if (sh.personId === heir.id) continue;
      const o = byId(sh.personId);
      if (!o || !this.I.adultStages.includes(o.lifeStage)) continue;
      const fr = Math.min(this.host.friendship(heir, o), this.host.friendship(o, heir));
      const gap = (top.value - sh.value) / s.total;
      if (fr >= D.friendshipBelow || gap <= D.shareGapAbove || o.clanAffection >= D.affectionBelow) continue;
      if (this.host.rng.next() >= D.chance) continue;
      out.push({ heir: heir.id, other: o.id, friendship: fr, gap, affection: o.clanAffection });
    }
    return out;
  }

  // ---------------------------------------------------------------- 사망 흐름

  /**
   * 누군가 죽음 (Simulation.killPerson 에서 목록에서 빼기 전에). 가계도 기록.
   * 가장이면: 장례 → 유언 공개 → 재산 나눔 → 새 가장 → 가보 계승 → 조작 인물 선택 → 분쟁. 보고 (가장이 아니면 null)
   */
  onDeath(p: Person, cause: string): InheritanceReport | null {
    const clan = this.clans.clanOf(p);
    this.clans.recordDeath(p, cause);
    if (this.heirlooms) for (const h of this.heirlooms.list) if (h.heir === p.id) h.heir = 0;
    if (!clan || clan.headId !== p.id) return null;
    return this.headDied(clan.id, p);
  }

  headDied(clanId: number, deceased: Person): InheritanceReport {
    const H = this.host;
    H.funeral?.(deceased);
    const s = this.settle(clanId, deceased);
    const byId = (id: number) => H.persons.find((q) => q.id === id && q.id !== deceased.id) ?? null;
    const heir = byId(s.heir);
    const newHead = byId(s.newHead);
    const kin = H.persons.filter((q) => q.id !== deceased.id && (this.clans.clanOf(q)?.id === clanId || s.shares.some((x) => x.personId === q.id)));
    H.scene?.('will_reading', { law: `clan.law.${s.law}`, heir: heir?.name ?? '', deceased: deceased.name }, kin);
    // 분가 (장자상속의 나머지 성인 자녀)
    const newHouseholds: number[] = [];
    const moved = new Map<number, number>();
    if (s.splits.length && H.splitHousehold) {
      for (const id of s.splits) {
        const q = byId(id);
        if (!q) continue;
        const sp = q.spouse ? byId(q.spouse) : null;
        const group = [q, ...(sp && sp.household === q.household ? [sp] : []), ...H.persons.filter((k) => (k.mother === q.id || k.father === q.id) && k.household === q.household)];
        const nh = H.splitHousehold(group, 'inheritance');
        if (nh >= 0) {
          this.clans.onHouseholdSplit(s.household, nh);
          newHouseholds.push(nh);
          moved.set(q.id, nh);
        }
      }
    }
    // 돈 옮기기: 다른 가정에 사는 상속인에게
    for (const sh of s.shares) {
      const q = byId(sh.personId);
      if (!q || sh.money <= 0) continue;
      const to = moved.get(q.id) ?? q.household;
      if (to !== s.household) H.transferMoney(s.household, to, sh.money, 'inheritance');
    }
    // 새 가장
    this.clans.setHead(clanId, newHead);
    if (newHead) {
      H.moodlet(newHead, this.I.moodlets.newHead);
      H.memory(newHead, 'became_head', 4, 1, deceased.id);
    }
    // 받은 몫이 공평한 몫 이상이면 받음, 아니면 서운함
    const fair = s.shares.length ? s.total / s.shares.length : 0;
    for (const sh of s.shares) {
      const q = byId(sh.personId);
      if (!q || q.lifeStage === 'baby' || q.lifeStage === 'toddler') continue;
      H.moodlet(q, sh.value >= fair * 0.999 ? this.I.moodlets.received : this.I.moodlets.slighted);
    }
    // 가보 (16-5 표 4·5행)
    const hl = this.heirlooms ? this.heirlooms.inherit(clanId, s.law, byId(s.heirloomsTo), newHead) : [];
    H.chronicle('head_passed', [deceased, ...(newHead ? [newHead] : [])], { law: `clan.law.${s.law}` });
    if (newHead) H.news('new_head', { a: newHead.name, b: deceased.name }, [newHead]);
    const day = H.day();
    this.recent.set(clanId, day + durDays(this.I.recentDays, H.lifespan()));
    // 조작 가문: 플레이어가 조작 인물을 고름
    const members = this.clans.members(clanId);
    if (members.some((q) => H.controlled(q.household))) H.chooseControlled?.(clanId, members);
    // 분쟁
    const disputes = this.disputes(s);
    const until = day + durDays(this.I.dispute.flagDays, H.lifespan());
    for (const dp of disputes) {
      const a = byId(dp.heir);
      const b = byId(dp.other);
      if (!a || !b) continue;
      this.rivalry.set(a.id, until);
      this.rivalry.set(b.id, until);
      H.offerCard(a, this.I.dispute.card, { other: b.name }, b);
    }
    const report: InheritanceReport = { ...s, heirlooms: hl, disputes, newHouseholds };
    this.last.set(clanId, report);
    return report;
  }

  /**
   * 분쟁 카드 결과 (Cards.choose/resolve 뒤): "형제를 집안에서 내친다"(disownOption) → 의절, 따로 떨어진 가문과 원수.
   * 같은 가정에 살면 host.splitHousehold 로 분가. 새 가문 id (아니면 0)
   */
  onDisputeResolved(option: number, heir: Person, other: Person): number {
    if (option !== this.I.dispute.disownOption) return 0;
    const clan = this.clans.clanOf(heir);
    if (!clan || this.clans.clanOf(other)?.id !== clan.id) {
      // 이미 다른 가정·가문이면 관계만 원수로
      const oc = this.clans.clanOf(other);
      if (clan && oc && oc.id !== clan.id) this.clans.setRelationLevel(clan.id, oc.id, 'enemy', 'disowned');
      return 0;
    }
    let nh: number | null = null;
    if (other.household === heir.household) {
      const sp = other.spouse ? this.host.persons.find((q) => q.id === other.spouse) : undefined;
      const group = [other, ...(sp && sp.household === other.household ? [sp] : []), ...this.host.persons.filter((k) => (k.mother === other.id || k.father === other.id) && k.household === other.household)];
      nh = this.host.splitHousehold?.(group, 'disowned') ?? -1;
      if (nh < 0) return 0;
    }
    return this.clans.disown(clan.id, other, nh)?.id ?? 0;
  }

  /** 유령의 "남겨진 비밀" (20-6): 상속을 다시 판정하지 않고 마지막 상속의 분쟁 카드만 다시 */
  ghostSecret(clanId: number): boolean {
    const r = this.last.get(clanId);
    if (!r) return false;
    const heir = this.host.persons.find((q) => q.id === r.heir) ?? this.clans.head(clanId);
    const other = r.shares.map((s) => this.host.persons.find((q) => q.id === s.personId)).find((q) => q && q !== heir);
    if (!heir || !other) return false;
    this.host.offerCard(heir, this.I.dispute.card, { other: other.name }, other);
    return true;
  }

  // ---------------------------------------------------------------- 카드 플래그

  /** recent_inheritance (가문), sibling_rivalry (분쟁 당사자) */
  flags(p: Person): Set<string> {
    const out = new Set<string>();
    const day = this.host.day();
    const c = this.clans.clanOf(p);
    if (c && (this.recent.get(c.id) ?? -1) >= day) out.add('recent_inheritance');
    if ((this.rivalry.get(p.id) ?? -1) >= day) out.add('sibling_rivalry');
    if (this.wills.has(p.id)) out.add('will_written');
    return out;
  }
}
