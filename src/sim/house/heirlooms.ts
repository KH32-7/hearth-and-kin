/**
 * 가보 (GDD 16-5): 대를 잇는 물건. 가문마다 최대 10개. 이력(만든 이·쓴 이·사건 = 기억 연결)을 쌓음.
 * - 쓰면 "선조의 기억" 무드렛 + 관련 스킬 경험치 보너스 (손상이면 절반). 팔면 가족 전원 슬픔 + 명성 하락. 지정 해제 −20
 * - 가보 사건 표 7행: 화재/고장 → 손상(수리 가능) / 도난·압류·몰수 → 잃어버린 가보 목록 + 되찾기 카드 /
 *   지참금 → 상대 가문 가보(이력 유지) / 상속 장자·지명 → 계승자 전부 / 상속 균분 → 지정자, 없으면 새 가장 /
 *   분가 → 가장 허락, 가문 가보로 남음 / 되팔기 경매 → 판매 규칙, 이력은 산 쪽 가문으로
 * - 물건은 월드 물건(uid) 또는 가구 살림(item id). 실제 월드 조작(없애기·되돌리기·옮기기)은 host
 * 렌더러/DOM 없음. 무작위는 host.rng 만
 */
import type { Person } from '../people/person';
import type { Clans, ClansData, HouseHost } from './clans';
import { durDays } from './clans';
import type { Honor } from './honor';

export type HeirloomRef = { kind: 'object'; uid: number } | { kind: 'item'; itemId: string; household: number; seq: number };

export type HistoryKind =
  | 'made'
  | 'designated'
  | 'used'
  | 'damaged'
  | 'repaired'
  | 'lost'
  | 'recovered'
  | 'dowry'
  | 'inherited'
  | 'split'
  | 'sold'
  | 'bought'
  | 'undesignated';

export interface HistoryEntry {
  day: number;
  kind: HistoryKind;
  /** 관련 인물 (만든 이, 쓴 이, 받은 이 …) */
  personId: number;
  personName: string;
  /** 그때 가진 가문 */
  clanId: number;
  /** 상대 가문 (지참금, 경매) */
  otherClanId: number;
  /** 손상 종류 (scorched/cracked), 잃은 까닭 (stolen/seized/confiscated) */
  note: string | null;
}

export type LostReason = 'stolen' | 'seized' | 'confiscated';

export interface Heirloom {
  id: number;
  clanId: number;
  ref: HeirloomRef;
  defId: string;
  /** 붙인 이름 (없으면 물건 이름) */
  customName: string | null;
  /** held = 가보 칸, lost = 잃어버린 가보 목록, released = 가보가 아님 (지정 해제·판매 후, 이력은 남음) */
  status: 'held' | 'lost' | 'released';
  lostReason: LostReason | null;
  lostDay: number;
  damaged: string | null;
  /** 지금 가진 가정 */
  household: number;
  /** 균분상속 때 받을 사람 (가장이 지정, 0 없음) */
  heir: number;
  makerId: number;
  users: number[];
  /** 처음 가보가 된 가문 (다른 가문에서 왔으면 "○○ 가문에서 온") */
  originClanId: number;
  history: HistoryEntry[];
}

export interface HeirloomHost extends HouseHost {
  /** 가보 물건의 정의 id (월드 물건 defId 또는 item id). 없어진 물건이면 null */
  defIdOf(ref: HeirloomRef): string | null;
  /** 값 (동화): 판매·압류 순서 */
  valueOf(ref: HeirloomRef): number;
  /** 물건을 월드/살림에서 뺌 (잃음, 판매, 지참금으로 떠남) */
  detach(ref: HeirloomRef): void;
  /** 물건을 이 가정으로 되돌림/옮김 (되찾음, 상속, 분가, 지참금 받음). 새 참조 */
  attach(h: Heirloom, household: number): HeirloomRef | null;
  /** 월드 물건 손상 표시 (o.state.damaged) */
  setDamaged(ref: HeirloomRef, damaged: boolean): void;
  addMoney(household: number, amount: number, reason: string): void;
}

export class Heirlooms {
  readonly list: Heirloom[] = [];
  private seq = 0;
  /** 사람별 가보 사용 기록 (날) — 이력 'used' 는 사람마다 처음 한 번 */
  private usedDay = new Map<string, number>();

  constructor(private host: HeirloomHost, private clans: Clans, private honor: Honor | null, readonly d: ClansData) {}

  private get H() {
    return this.d.heirlooms;
  }

  // ---------------------------------------------------------------- 조회

  get(id: number): Heirloom | null {
    return this.list.find((h) => h.id === id) ?? null;
  }

  held(clanId: number): Heirloom[] {
    return this.list.filter((h) => h.clanId === clanId && h.status === 'held');
  }

  lost(clanId: number): Heirloom[] {
    return this.list.filter((h) => h.clanId === clanId && h.status === 'lost');
  }

  private sameRef(a: HeirloomRef, b: HeirloomRef): boolean {
    if (a.kind === 'object' && b.kind === 'object') return a.uid === b.uid;
    if (a.kind === 'item' && b.kind === 'item') return a.seq === b.seq && a.itemId === b.itemId;
    return false;
  }

  byRef(ref: HeirloomRef): Heirloom | null {
    return this.list.find((h) => this.sameRef(h.ref, ref)) ?? null;
  }

  /** 이 월드 물건이 가보인가 (화재: 타 없어지지 않고 손상, 23-5) */
  isHeirloomObject(uid: number): Heirloom | null {
    return this.list.find((h) => h.status === 'held' && h.ref.kind === 'object' && h.ref.uid === uid) ?? null;
  }

  skillOf(h: Heirloom): string | null {
    return this.H.skills[h.defId] ?? null;
  }

  materialOf(h: Heirloom): string {
    return this.H.materials[h.defId] ?? this.H.defaultMaterial;
  }

  repairSkill(h: Heirloom): string {
    return this.H.repairSkills[this.materialOf(h)] ?? 'carpentry';
  }

  /** "○○ 가문에서 온" 표시용: 처음 가문이 지금 가문과 다르면 그 가문 */
  fromClan(h: Heirloom): number {
    return h.originClanId !== h.clanId ? h.originClanId : 0;
  }

  private entry(h: Heirloom, kind: HistoryKind, p: Person | null, other = 0, note: string | null = null): void {
    h.history.push({ day: this.host.day(), kind, personId: p?.id ?? 0, personName: p?.name ?? '', clanId: h.clanId, otherClanId: other, note });
  }

  private family(clanId: number): Person[] {
    return this.clans.members(clanId).filter((p) => p.lifeStage !== 'baby');
  }

  private itemSeq = 0;
  /** 살림 물건 참조 만들기 (같은 item id 가 여럿이어도 구별) */
  itemRef(itemId: string, household: number): HeirloomRef {
    return { kind: 'item', itemId, household, seq: ++this.itemSeq };
  }

  // ---------------------------------------------------------------- 지정·해제·이름

  /**
   * 가보로 지정 (최대 10). 이미 이력이 있는 물건(경매로 산 것, 해제했던 것)은 이력을 이어 씀.
   * maker = 만든 이 (알면)
   */
  designate(clanId: number, ref: HeirloomRef, by: Person | null, household: number, maker: Person | null = null): { ok: boolean; reason?: string; heirloom?: Heirloom } {
    if (!this.clans.clan(clanId)) return { ok: false, reason: 'no_clan' };
    if (this.held(clanId).length >= this.H.max) return { ok: false, reason: 'full' };
    const defId = this.host.defIdOf(ref);
    if (!defId) return { ok: false, reason: 'no_object' };
    let h = this.byRef(ref);
    if (h && h.status !== 'released') return { ok: false, reason: 'already' };
    if (!h) {
      h = {
        id: ++this.seq,
        clanId,
        ref,
        defId,
        customName: null,
        status: 'held',
        lostReason: null,
        lostDay: -1,
        damaged: null,
        household,
        heir: 0,
        makerId: maker?.id ?? 0,
        users: [],
        originClanId: clanId,
        history: [],
      };
      this.list.push(h);
      if (maker) this.entry(h, 'made', maker);
    } else {
      h.clanId = clanId;
      h.household = household;
      h.status = 'held';
    }
    this.entry(h, 'designated', by);
    if (by) this.host.memory(by, 'heirloom_designated', this.H.designateMemoryImportance, 1, 0);
    return { ok: true, heirloom: h };
  }

  rename(id: number, name: string | null): boolean {
    const h = this.get(id);
    if (!h) return false;
    h.customName = name?.trim() || null;
    return true;
  }

  /** 지정 해제: 가문 명성 −20 (조상을 저버림), 해제한 사람 죄책감 */
  undesignate(id: number, by: Person | null): boolean {
    const h = this.get(id);
    if (!h || h.status !== 'held') return false;
    h.status = 'released';
    this.entry(h, 'undesignated', by);
    this.honor?.apply(by, h.clanId, { fame: this.H.undesignateFame }, 'heirloom_undesignated');
    if (by) this.host.moodlet(by, this.H.undesignateMoodlet);
    return true;
  }

  /** 균분상속 때 받을 사람 지정 (가장) */
  assignHeir(id: number, heir: Person | null): boolean {
    const h = this.get(id);
    if (!h || h.status !== 'held') return false;
    h.heir = heir?.id ?? 0;
    return true;
  }

  // ---------------------------------------------------------------- 쓰기

  /**
   * 가보를 씀 (그 물건 상호작용이 끝남): 선조의 기억 무드렛, 처음 쓰는 사람이면 이력·기억.
   * 돌려주는 값 = 관련 스킬 경험치 배수 (skills.ts 가 곱함, 관련 없는 스킬이면 1)
   */
  use(id: number, p: Person, skill: string | null = null): number {
    const h = this.get(id);
    if (!h || h.status !== 'held') return 1;
    this.host.moodlet(p, this.H.useMoodlet);
    const k = `${h.id}:${p.id}`;
    if (!h.users.includes(p.id)) {
      h.users.push(p.id);
      this.entry(h, 'used', p);
      this.host.memory(p, 'heirloom_used', this.H.useMemoryImportance, 1, h.makerId);
    }
    this.usedDay.set(k, this.host.day());
    return skill ? this.xpMult(h, skill) : 1;
  }

  /** 가보 월드 물건 uid 로 쓰기 (상호작용 훅) */
  useObject(uid: number, p: Person, skill: string | null = null): number {
    const h = this.isHeirloomObject(uid);
    return h ? this.use(h.id, p, skill) : 1;
  }

  /** 관련 스킬 경험치 배수 (손상이면 보너스 절반) */
  xpMult(h: Heirloom, skill: string): number {
    if (h.status !== 'held' || this.skillOf(h) !== skill) return 1;
    return 1 + this.H.useXpBonus * (h.damaged ? this.H.damagedEffectMult : 1);
  }

  /** 무드렛 세기 배수 (손상이면 절반): 무드렛 시스템이 세기를 바꿀 수 있으면 씀 */
  effectMult(h: Heirloom): number {
    return h.damaged ? this.H.damagedEffectMult : 1;
  }

  // ---------------------------------------------------------------- 표 1행: 화재, 고장 → 손상

  /** 손상 (파괴되지 않음): 그을린/금 간 가보. 이력, 가족 무드렛 */
  damage(id: number, cause: 'fire' | 'wear' | 'card', by: Person | null = null): boolean {
    const h = this.get(id);
    if (!h || h.status !== 'held') return false;
    const kind = this.H.damageKinds[cause];
    h.damaged = kind;
    this.host.setDamaged(h.ref, true);
    this.entry(h, 'damaged', by, 0, kind);
    for (const p of this.family(h.clanId)) this.host.moodlet(p, this.H.damagedMoodlet);
    this.host.chronicle('heirloom_damaged', this.family(h.clanId).slice(0, 1), { heirloom: h.id });
    return true;
  }

  /** 화재가 가보 물건에 닿음 (fire.ts burnObject): 가보면 손상하고 true (물건을 지우지 말 것) */
  onFire(uid: number): boolean {
    const h = this.isHeirloomObject(uid);
    if (!h) return false;
    if (!h.damaged) this.damage(h.id, 'fire');
    return true;
  }

  /** 내구도 고장 (23-4): 가보면 손상 (금 간 가보) */
  onBroken(uid: number): boolean {
    const h = this.isHeirloomObject(uid);
    if (!h) return false;
    if (!h.damaged) this.damage(h.id, 'wear');
    return true;
  }

  /** 수리 (목공/대장일/바느질): 스킬이 모자라면 실패 */
  repair(id: number, by: Person | null, skipSkill = false): { ok: boolean; reason?: string } {
    const h = this.get(id);
    if (!h || !h.damaged) return { ok: false, reason: 'not_damaged' };
    const sk = this.repairSkill(h);
    if (by && !skipSkill && this.host.skillLevel(by, sk) < this.H.repairLevel) return { ok: false, reason: 'skill_low' };
    h.damaged = null;
    this.host.setDamaged(h.ref, false);
    this.entry(h, 'repaired', by, 0, sk);
    return { ok: true };
  }

  // ---------------------------------------------------------------- 표 2행: 도난·압류·몰수 → 잃어버린 가보

  /** 잃음: 가보 칸에서 빠지고 잃어버린 목록으로, 되찾기 카드가 연결됨 */
  lose(id: number, reason: LostReason, by: Person | null = null): boolean {
    const h = this.get(id);
    if (!h || h.status !== 'held') return false;
    this.host.detach(h.ref);
    h.status = 'lost';
    h.lostReason = reason;
    h.lostDay = this.host.day();
    this.entry(h, 'lost', by, 0, reason);
    const fam = this.family(h.clanId);
    for (const p of fam) this.host.moodlet(p, this.H.lostMoodlet);
    if (fam[0]) this.host.rumor(fam[0], this.H.lostRumor, false, 0.4);
    this.host.chronicle('heirloom_lost', fam.slice(0, 1), { heirloom: h.id, reason });
    return true;
  }

  /** 압류 (파산 17-6, 16-3): 그 가정 가보 중 값진 것부터 seizeCount 개 */
  onSeizure(household: number): Heirloom[] {
    const hs = this.list.filter((h) => h.status === 'held' && h.household === household).sort((a, b) => this.host.valueOf(b.ref) - this.host.valueOf(a.ref) || a.id - b.id);
    const out = hs.slice(0, this.H.seizeCount);
    for (const h of out) this.lose(h.id, 'seized');
    return out;
  }

  /** 중죄 몰수 (재산 몰수 = 가정 전체): 그 가정 가보 전부 */
  onConfiscation(household: number): Heirloom[] {
    const hs = this.list.filter((h) => h.status === 'held' && h.household === household);
    for (const h of hs) this.lose(h.id, 'confiscated');
    return hs;
  }

  /** 되찾음 (되찾기 카드 결과). 가보 칸이 가득 차면 가보가 아닌 물건으로 돌아옴 (이력은 남음) */
  recover(id: number, by: Person | null = null): boolean {
    const h = this.get(id);
    if (!h || h.status !== 'lost') return false;
    const head = this.clans.head(h.clanId);
    const hh = this.clans.clan(h.clanId)?.households.includes(h.household) ? h.household : head?.household ?? this.clans.clan(h.clanId)?.households[0] ?? h.household;
    const ref = this.host.attach(h, hh);
    if (ref) h.ref = ref;
    h.household = hh;
    h.lostReason = null;
    h.status = this.held(h.clanId).length >= this.H.max ? 'released' : 'held';
    this.entry(h, 'recovered', by);
    for (const p of this.family(h.clanId)) this.host.moodlet(p, this.H.recoveredMoodlet);
    this.host.chronicle('heirloom_recovered', this.family(h.clanId).slice(0, 1), { heirloom: h.id });
    return true;
  }

  /** 하루: 잃어버린 가보마다 되찾기 카드 (장물 발견, 경매, 도둑 추적) */
  daily(): { heirloom: number; card: string }[] {
    const R = this.H.recovery;
    const out: { heirloom: number; card: string }[] = [];
    const day = this.host.day();
    const first = durDays(R.firstAfter, this.host.lifespan());
    const byClan = new Set<number>();
    for (const h of this.list) {
      if (h.status !== 'lost' || !h.lostReason || byClan.has(h.clanId)) continue;
      if (day - h.lostDay < first) continue;
      if (this.host.rng.next() >= R.chancePerDay) continue;
      const cards = R[h.lostReason];
      if (!cards.length) continue;
      const card = cards[this.host.rng.int(cards.length)];
      const who = this.clans.head(h.clanId) ?? this.clans.members(h.clanId).find((p) => p.lifeStage === 'adult' || p.lifeStage === 'young');
      if (!who) continue;
      byClan.add(h.clanId);
      this.host.offerCard(who, card, { heirloom: h.id });
      out.push({ heirloom: h.id, card });
    }
    return out;
  }

  // ---------------------------------------------------------------- 표 3행: 지참금 → 상대 가문 가보

  /** 지참금 대신 가보 (14-4): 상대 가문 가보가 되고 이전 이력 유지 */
  dowry(id: number, toClanId: number, toHousehold: number, by: Person | null = null): boolean {
    const h = this.get(id);
    if (!h || h.status !== 'held' || h.clanId === toClanId || !this.clans.clan(toClanId)) return false;
    const from = h.clanId;
    this.entry(h, 'dowry', by, toClanId);
    this.host.detach(h.ref);
    const ref = this.host.attach(h, toHousehold);
    if (ref) h.ref = ref;
    h.clanId = toClanId;
    h.household = toHousehold;
    h.heir = 0;
    h.status = this.held(toClanId).length >= this.H.max ? 'released' : 'held';
    h.history[h.history.length - 1].otherClanId = from;
    h.history[h.history.length - 1].clanId = toClanId;
    return true;
  }

  // ---------------------------------------------------------------- 표 4·5행: 상속

  /**
   * 가장이 죽음 → 가보 계승 (inheritance.ts 가 부름).
   * 장자·지명: 계승자(heir)가 전부. 균분: 가보는 나누지 않고 가장이 지정한 사람(h.heir), 없으면 새 가장
   */
  inherit(clanId: number, law: 'primogeniture' | 'equal' | 'will', heir: Person | null, newHead: Person | null): { heirloom: number; to: number }[] {
    const out: { heirloom: number; to: number }[] = [];
    for (const h of this.held(clanId)) {
      let to: Person | null;
      if (law === 'equal') {
        const named = h.heir ? this.host.persons.find((p) => p.id === h.heir) ?? null : null;
        to = named && this.clans.clanOf(named)?.id === clanId ? named : newHead;
      } else to = heir ?? newHead;
      if (!to) continue;
      h.heir = 0;
      if (to.household !== h.household) {
        const ref = this.host.attach(h, to.household);
        if (ref) h.ref = ref;
        h.household = to.household;
      }
      this.entry(h, 'inherited', to);
      out.push({ heirloom: h.id, to: to.id });
    }
    return out;
  }

  // ---------------------------------------------------------------- 표 6행: 분가

  /**
   * 분가하는 가정이 가보를 가져감: 가장의 허락 (가장 본인이거나, 가장이 조작 가문이 아니면 우정 판정).
   * approved 를 주면 그 결정(조작 가문의 선택)을 씀. 가져간 가보는 같은 가문 가보로 남음
   */
  takeOnSplit(id: number, requester: Person, newHousehold: number, approved?: boolean): { ok: boolean; reason?: string } {
    const h = this.get(id);
    if (!h || h.status !== 'held') return { ok: false, reason: 'not_held' };
    const clanId = this.clans.clanOfHousehold(newHousehold)?.id ?? this.clans.clanOf(requester)?.id;
    if (clanId !== h.clanId) return { ok: false, reason: 'other_clan' };
    const head = this.clans.head(h.clanId);
    let ok = approved;
    if (ok === undefined) ok = !head || head.id === requester.id || this.host.friendship(head, requester) >= this.H.splitApproveFriendship;
    if (!ok) return { ok: false, reason: 'refused' };
    const ref = this.host.attach(h, newHousehold);
    if (ref) h.ref = ref;
    h.household = newHousehold;
    this.entry(h, 'split', requester);
    return { ok: true };
  }

  // ---------------------------------------------------------------- 표 7행: 판매, 되팔기 경매

  /**
   * 팔기: 가족 전원 슬픔 + 가문 명성 하락 (파는 사람 개인 명예도). buyerClanId 가 있으면(경매) 이력이 산 쪽 가문으로 이어짐:
   * 산 가문의 물건이 되고(가보는 아님, released) 그 가문이 지정하면 이력을 이어 씀
   */
  sell(id: number, seller: Person | null, price: number, buyerClanId = 0, buyerHousehold = -1): boolean {
    const h = this.get(id);
    if (!h || h.status !== 'held') return false;
    const from = h.clanId;
    const fam = this.family(from);
    for (const p of fam) this.host.moodlet(p, this.H.sellMoodlet);
    this.honor?.apply(seller, from, { fame: this.H.sellFame }, 'heirloom_sold');
    if (fam[0]) this.host.rumor(fam[0], this.H.sellRumor, false, 0.3);
    if (price > 0) this.host.addMoney(h.household, price, 'heirloom_sale');
    this.entry(h, 'sold', seller, buyerClanId, String(price));
    this.host.detach(h.ref);
    h.status = 'released';
    h.heir = 0;
    if (buyerClanId && this.clans.clan(buyerClanId)) {
      h.clanId = buyerClanId;
      if (buyerHousehold >= 0) {
        const ref = this.host.attach(h, buyerHousehold);
        if (ref) h.ref = ref;
        h.household = buyerHousehold;
      }
      const buyer = this.clans.head(buyerClanId);
      this.entry(h, 'bought', buyer, from, String(price));
    }
    this.host.chronicle('heirloom_sold', fam.slice(0, 1), { heirloom: h.id });
    return true;
  }

  /** 되팔기 경매 (23-4): 판매 규칙 그대로, 산 쪽 가문으로 이력이 이어짐 */
  auction(id: number, seller: Person | null, price: number, buyerClanId: number, buyerHousehold: number): boolean {
    return this.sell(id, seller, price, buyerClanId, buyerHousehold);
  }

  // ---------------------------------------------------------------- 카드 결과 (24-1 heirloom: damage/lose/recover)

  /**
   * 사건 카드 결과의 heirloom 필드 (story/cards.ts → CardsHost.heirloom 대신).
   * - damage: 손상 안 된 가보 하나 (무작위). 같은 결과에 flag heirloom_repaired 가 있으면 곧바로 수리 (장인에게 맡김/직접 고침 성공)
   * - lose: 가보 하나. cardId dowry_short 또는 flag heirloom_as_dowry 면 지참금 → other 의 가문으로. 그 밖에는 도난
   * - recover: 가장 오래 잃은 가보 (vars.heirloom 이 있으면 그것)
   */
  cardOutcome(p: Person, what: 'damage' | 'lose' | 'recover', ctx: { cardId?: string; flag?: string; other?: Person | null; heirloomId?: number } = {}): number {
    const clan = this.clans.clanOf(p);
    if (!clan) return 0;
    const rng = this.host.rng;
    if (what === 'damage') {
      const cands = this.held(clan.id).filter((h) => !h.damaged);
      const h = ctx.heirloomId ? this.get(ctx.heirloomId) : cands[rng.int(cands.length)] ?? null;
      if (!h) return 0;
      this.damage(h.id, 'card', p);
      if (ctx.flag === 'heirloom_repaired') this.repair(h.id, p, true);
      return h.id;
    }
    if (what === 'lose') {
      const cands = this.held(clan.id);
      const h = ctx.heirloomId ? this.get(ctx.heirloomId) : cands[rng.int(cands.length)] ?? null;
      if (!h) return 0;
      const toDowry = ctx.cardId === 'dowry_short' || ctx.flag === 'heirloom_as_dowry';
      const oc = ctx.other ? this.clans.clanOf(ctx.other) : null;
      if (toDowry && oc && ctx.other) this.dowry(h.id, oc.id, ctx.other.household, p);
      else if (toDowry) {
        // 상대 가문을 모르면 가보는 떠남 (가문 밖으로 판매와 같음, 슬픔은 카드가 줌)
        this.entry(h, 'dowry', p);
        this.host.detach(h.ref);
        h.status = 'released';
      } else this.lose(h.id, 'stolen', p);
      return h.id;
    }
    const lostList = this.lost(clan.id).sort((a, b) => a.lostDay - b.lostDay || a.id - b.id);
    const h = ctx.heirloomId ? this.get(ctx.heirloomId) : lostList[0] ?? null;
    if (!h) return 0;
    this.recover(h.id, p);
    return h.id;
  }

  // ---------------------------------------------------------------- 카드 플래그

  /** has_heirloom, lost_heirloom, heirloom_damaged */
  flags(p: Person): Set<string> {
    const out = new Set<string>();
    const c = this.clans.clanOf(p);
    if (!c) return out;
    const held = this.held(c.id);
    if (held.length) out.add('has_heirloom');
    if (held.some((h) => h.damaged)) out.add('heirloom_damaged');
    if (this.lost(c.id).length) out.add('lost_heirloom');
    return out;
  }
}
