/**
 * 하인과 가솔 (GDD 16-7): 상인 이상 고용, 역할 6 (하녀·요리사·유모·마부·집사·경비), 가정 인원 상한(15-8, 12)에 포함.
 * - 담당 일 자율: 역할의 상호작용 태그에 자율 점수 배수 (청소·요리·아기 돌보기·말 돌보기·장부·경비)
 * - 주급 (1주 = 7일): 못 주면 충성 하락. 대우(주인 가족과의 우정)가 충성으로 천천히 번짐
 * - 충성이 낮으면 도둑질(가보 포함, 16-5 → 잃어버린 가보 + 되찾기 카드), 소문 유출. 아주 낮으면 그만둠
 * - 하인과 주인 가족의 로맨스 = 추문 카드
 * - 하인 제복: 주인 신분 −1 등급까지 사치 금지법 예외 (E 의 sumptuary.ts 가 livery() 를 읽음)
 * 렌더러/DOM 없음. 무작위는 host.rng 만
 */
import type { Person } from '../people/person';
import type { Clans, ClansData, HouseHost, ServantRole } from './clans';
import { durDays, SERVANT_ROLES } from './clans';
import type { Heirlooms } from './heirlooms';
import type { Honor } from './honor';

export interface ServantHost extends HouseHost {
  /** 가정 인원 (하인·도제·유모 포함) */
  householdSize(household: number): number;
  /** 하인 NPC 만들기 (17-2 NPC 역할 직업, 이 가구에 삶). 못 만들면 null */
  createServant(role: ServantRole, household: number): Person | null;
  /** 하인을 내보냄 (가구에서 빼고 마을 NPC 로 돌리거나 떠남) */
  removeServant(p: Person, reason: string): void;
  spend(household: number, amount: number, reason: string): boolean;
}

export interface Servant {
  personId: number;
  household: number;
  role: ServantRole;
  loyalty: number;
  hiredDay: number;
  lastPaidDay: number;
  unpaidWeeks: number;
  /** 이미 도둑질이 들킨 적 있음 */
  caught: boolean;
}

export type ServantEvent =
  | { kind: 'paid'; servant: number; amount: number }
  | { kind: 'unpaid'; servant: number }
  | { kind: 'theft'; servant: number; heirloom: number; money: number; caught: boolean }
  | { kind: 'leak'; servant: number; rumor: string }
  | { kind: 'quit'; servant: number };

export class Servants {
  readonly list: Servant[] = [];

  constructor(private host: ServantHost, private clans: Clans, private heirlooms: Heirlooms | null, private honor: Honor | null, readonly d: ClansData) {
    // 하인은 가정 식구지만 가문 사람이 아님
    const prev = clans.memberFilter;
    clans.memberFilter = (p) => prev(p) && !this.isServant(p);
  }

  private get S() {
    return this.d.servants;
  }

  get(p: Person | number): Servant | null {
    const id = typeof p === 'number' ? p : p.id;
    return this.list.find((s) => s.personId === id) ?? null;
  }

  isServant(p: Person): boolean {
    return this.list.some((s) => s.personId === p.id);
  }

  of(household: number): Servant[] {
    return this.list.filter((s) => s.household === household);
  }

  private person(s: Servant): Person | null {
    return this.host.persons.find((q) => q.id === s.personId) ?? null;
  }

  /** 고용 가능: 가정 대표 신분이 상인 이상, 인원 상한 안 */
  canHire(household: number): { ok: boolean; reason?: string } {
    if (!this.S.hireEstates.includes(this.host.householdEstate(household))) return { ok: false, reason: 'estate' };
    if (this.host.householdSize(household) + 1 > this.S.householdCap) return { ok: false, reason: 'household_full' };
    return { ok: true };
  }

  /** 하인 고용 (의도 hireServant). existing 이 있으면 그 사람을 들임 (NPC 전직), 아니면 host 가 새로 만듦 */
  hire(household: number, role: ServantRole, existing: Person | null = null): { ok: boolean; reason?: string; servant?: Servant } {
    if (!SERVANT_ROLES.includes(role)) return { ok: false, reason: 'role' };
    const can = this.canHire(household);
    if (!can.ok) return can;
    const p = existing ?? this.host.createServant(role, household);
    if (!p) return { ok: false, reason: 'no_person' };
    if (existing && !this.S.minStages.includes(existing.lifeStage)) return { ok: false, reason: 'too_young' };
    if (this.isServant(p)) return { ok: false, reason: 'already' };
    const day = this.host.day();
    const s: Servant = { personId: p.id, household, role, loyalty: this.S.loyalty.start, hiredDay: day, lastPaidDay: day, unpaidWeeks: 0, caught: false };
    this.list.push(s);
    return { ok: true, servant: s };
  }

  /** 내보내기 (의도 dismissServant, 도둑질 카드 "법정에 넘긴다") */
  dismiss(p: Person | number, reason = 'dismissed'): boolean {
    const s = this.get(p);
    if (!s) return false;
    this.list.splice(this.list.indexOf(s), 1);
    const q = this.person(s);
    if (q) this.host.removeServant(q, reason);
    return true;
  }

  /** 하인이 죽거나 사라짐 */
  forget(p: Person): void {
    const s = this.get(p);
    if (s) this.list.splice(this.list.indexOf(s), 1);
  }

  wagePerDay(role: ServantRole): number {
    return this.S.roles[role].wagePerDay;
  }

  /** 주급 한 번 (동화) */
  weeklyWage(role: ServantRole): number {
    return Math.round(this.wagePerDay(role) * durDays(this.S.payEvery, this.host.lifespan()));
  }

  // ---------------------------------------------------------------- 담당 일 (자율)

  duties(p: Person): string[] {
    const s = this.get(p);
    return s ? this.S.roles[s.role].duties : [];
  }

  /** 자율 점수 배수: 상호작용 태그가 담당 일이면 dutyAdMult (autonomy.ts 가 곱함) */
  autonomyMult(p: Person, tags: readonly string[]): number {
    const d = this.duties(p);
    return d.length && tags.some((t) => d.includes(t)) ? this.S.dutyAdMult : 1;
  }

  /** 아기 돌보기 담당 (유모: childcare 의 돌봄 후보에 넣음), 말 돌보기 담당 (마부) */
  caresForBabies(p: Person): boolean {
    const s = this.get(p);
    return !!s && !!this.S.roles[s.role].careBaby;
  }
  caresForHorses(p: Person): boolean {
    const s = this.get(p);
    return !!s && !!this.S.roles[s.role].careHorse;
  }

  /** 하인 제복 (16-2 사치 금지법 예외): 주인 가정 대표 신분. 제복 한도는 이 신분 −1 등급 (sumptuary.ts) */
  livery(p: Person): { masterEstate: string } | null {
    const s = this.get(p);
    return s ? { masterEstate: this.host.householdEstate(s.household) } : null;
  }

  // ---------------------------------------------------------------- 충성

  /** 대우 (사회 상호작용 결과 우정 변화, 꾸중·칭찬): 충성에 배수로 번짐 */
  treat(p: Person, friendshipDelta: number): void {
    const s = this.get(p);
    if (!s) return;
    s.loyalty = Math.max(0, Math.min(100, s.loyalty + friendshipDelta * this.S.loyalty.treatmentMult));
  }

  private masterBond(s: Servant, q: Person): number {
    const fam = this.clans.members(this.clans.clanIdOfHousehold(s.household)).filter((m) => m.household === s.household);
    if (!fam.length) return 0;
    return fam.reduce((a, m) => a + this.host.friendship(q, m), 0) / fam.length;
  }

  // ---------------------------------------------------------------- 하루

  /** 자정: 주급, 충성 번짐, 도둑질, 소문 유출, 그만둠, "대접받는 삶" 무드렛. 일어난 일 목록 */
  daily(): ServantEvent[] {
    const L = this.S.loyalty;
    const out: ServantEvent[] = [];
    const day = this.host.day();
    const every = durDays(this.S.payEvery, this.host.lifespan());
    const rng = this.host.rng;
    for (const s of [...this.list]) {
      const q = this.person(s);
      if (!q) {
        this.list.splice(this.list.indexOf(s), 1);
        continue;
      }
      // 주급
      if (day - s.lastPaidDay >= every) {
        s.lastPaidDay = day;
        const w = this.weeklyWage(s.role);
        if (this.host.spend(s.household, w, 'servant_wage')) {
          s.unpaidWeeks = 0;
          s.loyalty = Math.min(100, s.loyalty + L.paid);
          out.push({ kind: 'paid', servant: q.id, amount: w });
        } else {
          s.unpaidWeeks++;
          s.loyalty = Math.max(0, s.loyalty + L.unpaid);
          out.push({ kind: 'unpaid', servant: q.id });
        }
      }
      // 대우가 충성으로 번짐 (주인 가족과의 평균 우정 쪽)
      const bond = this.masterBond(s, q);
      const target = 50 + bond / 2;
      s.loyalty = Math.max(0, Math.min(100, s.loyalty + (target - s.loyalty) * L.towardFriendshipPerDay));
      // 그만둠
      if (s.loyalty < L.quitBelow) {
        out.push({ kind: 'quit', servant: q.id });
        this.dismiss(q, 'quit');
        continue;
      }
      // 도둑질
      if (s.loyalty < L.theftBelow && rng.next() < L.theftChancePerDay) out.push(this.steal(s, q));
      // 소문 유출
      if (s.loyalty < L.leakBelow && rng.next() < L.leakChancePerDay && L.leakRumors.length) {
        const fam = this.clans.members(this.clans.clanIdOfHousehold(s.household)).filter((m) => m.household === s.household);
        const subject = fam[rng.int(fam.length)];
        if (subject) {
          const kind = L.leakRumors[rng.int(L.leakRumors.length)];
          this.host.rumor(subject, kind, false, L.leakStrength);
          out.push({ kind: 'leak', servant: q.id, rumor: kind });
        }
      }
    }
    // 대접받는 삶: 충성 높은 하인이 있는 가정의 가족
    const served = new Set(this.list.filter((s) => s.loyalty >= this.S.wellServedLoyalty).map((s) => s.household));
    for (const hh of served) for (const m of this.clans.members(this.clans.clanIdOfHousehold(hh))) if (m.household === hh && m.lifeStage !== 'baby') this.host.moodlet(m, this.S.wellServedMoodlet);
    return out;
  }

  /**
   * 도둑질 (16-7): heirloomShare 확률로 그 가정의 가보(잃어버린 가보 목록으로), 아니면 돈 (S × moneyStealS).
   * caughtChance 로 들킴 → servant_caught_stealing 카드 (other = 하인). 못 들키면 가보는 heirloom_stolen 카드
   */
  steal(s: Servant, q: Person): Extract<ServantEvent, { kind: 'theft' }> {
    const L = this.S.loyalty;
    const rng = this.host.rng;
    const clanId = this.clans.clanIdOfHousehold(s.household);
    const hs = this.heirlooms ? this.heirlooms.held(clanId).filter((h) => h.household === s.household) : [];
    let heirloom = 0;
    let money = 0;
    if (hs.length && rng.next() < L.heirloomShare) {
      const h = hs[rng.int(hs.length)];
      if (this.heirlooms!.lose(h.id, 'stolen', q)) heirloom = h.id;
    }
    if (!heirloom) {
      money = Math.max(1, Math.round(this.host.savingsS(s.household) * L.moneyStealS));
      money = Math.min(money, Math.max(0, Math.floor(this.host.money(s.household))));
      if (money > 0) this.host.spend(s.household, money, 'servant_theft');
    }
    const caught = rng.next() < L.caughtChance;
    const head = this.clans.head(clanId) ?? this.clans.members(clanId).find((m) => m.household === s.household && m.lifeStage !== 'baby') ?? null;
    if (head) {
      if (caught) {
        s.caught = true;
        this.host.moodlet(head, this.S.theftMoodlet);
        this.host.rumor(q, this.S.theftRumor, false, 0.5);
        this.host.offerCard(head, this.S.caughtCard, { other: q.name }, q);
      } else if (heirloom) this.host.offerCard(head, this.S.stolenCard, {}, null);
    }
    return { kind: 'theft', servant: q.id, heirloom, money, caught };
  }

  // ---------------------------------------------------------------- 추문

  /**
   * 하인과 주인 가족의 로맨스 (관계 로맨스가 romanceAbove 를 넘을 때 리드가 부름): 추문 카드 + 명성 하락.
   * 한 쌍에 한 번. 추문이면 true
   */
  private scandals = new Set<string>();
  checkRomance(a: Person, b: Person, romance: number): boolean {
    if (romance < this.S.romanceAbove) return false;
    const sa = this.get(a);
    const sb = this.get(b);
    const servant = sa ? a : sb ? b : null;
    if (!servant) return false;
    const master = servant === a ? b : a;
    const s = this.get(servant)!;
    if (master.household !== s.household || this.isServant(master)) return false;
    const k = `${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`;
    if (this.scandals.has(k)) return false;
    this.scandals.add(k);
    this.honor?.apply(master, null, { fame: this.S.romanceFame }, 'servant_romance', ['scandal']);
    this.host.offerCard(master, this.S.romanceCard, { other: servant.name }, servant);
    return true;
  }

  // ---------------------------------------------------------------- 카드 플래그

  /** has_servant (그 가정에 하인이 있음), servant_romance (추문이 난 쌍의 주인 쪽) */
  flags(p: Person): Set<string> {
    const out = new Set<string>();
    if (this.of(p.household).length && !this.isServant(p)) out.add('has_servant');
    for (const k of this.scandals) if (k.split(':').map(Number).includes(p.id)) out.add(this.S.romanceFlag);
    return out;
  }
}
