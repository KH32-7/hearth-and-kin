/**
 * M9 구애와 혼인 (GDD 14-4): 가짜 Host 로 순수 테스트. 연애혼 전 과정, 부모 거절 → 도피, 중매 후보·협상,
 * 지참금 기준(S/4, ×1.5, 부족 시 빚·가보), 데릴사위 성 변경, 인원 상한 분가, 근친(촌수), 16세 미만,
 * 불륜 발각 → 배신 수치, 사생아, 혼인 무효, 애도 기간 재혼 소문, NPC 점수, 결정론, 콘텐츠 연결
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/core/rng';
import { Person, type LifeStage } from '../../src/sim/people/person';
import { Relations } from '../../src/sim/social/relations';
import { DEFAULT_RELATIONS, relationRules } from '../../src/sim/social/rules';
import { Courtship, kinDegree, parseCourtship, type CourtshipHost, type MarriagePlanLike } from '../../src/sim/society/courtship';
import { dialogueTextProblems } from '../../src/ui/dialogue/pickLine';

const raw = JSON.parse(readFileSync('src/data/courtship.json', 'utf8'));
const data = parseCourtship(raw);
const ko: Record<string, string> = Object.assign({}, ...readdirSync('src/i18n/ko').filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`src/i18n/ko/${f}`, 'utf8'))));

/** 다음 next() 값을 정할 수 있는 난수 (없으면 시드 Rng) */
class ScriptRng extends Rng {
  queue: number[] = [];
  fixed: number | null = null;
  next(): number {
    if (this.queue.length) return this.queue.shift()!;
    if (this.fixed !== null) return this.fixed;
    return super.next();
  }
}

const S: Record<string, number> = { serf: 144, freeman: 288, artisan: 864, merchant: 1920, clergy: 384, knight: 2160, noble: 7680 };
const AGE: Record<LifeStage, number> = { baby: 0, toddler: 2, child: 8, teen: 15, young: 20, adult: 32, elder: 62 };

interface Log {
  moodlets: { p: number; id: string }[];
  notices: { p: number; kind: string; args?: Record<string, string | number> }[];
  news: string[];
  chronicle: string[];
  rumors: { subjects: number[]; kind: string }[];
  cards: { p: number; card: string; other: number }[];
  fame: { hh: number; delta: number; reason: string }[];
  memories: { p: number; kind: string }[];
  splits: { ids: number[]; reason: string; hh: number }[];
  moves: { p: number; hh: number }[];
  surname: number[];
  estatesMarry: { stay: number; incoming: number; ux: boolean }[];
  borrow: number[];
  heirloom: number[];
  letters: { from: number; to: number; kind: string }[];
}

function world(seed = 7) {
  let pid = 0;
  let nextHh = 900;
  const persons: Person[] = [];
  const rel = new Relations(relationRules(DEFAULT_RELATIONS));
  const rng = new ScriptRng(seed);
  const money = new Map<number, number>();
  const estate = new Map<number, string>();
  const ages = new Map<number, number>();
  const fameOf = new Map<number, number>();
  const log: Log = { moodlets: [], notices: [], news: [], chronicle: [], rumors: [], cards: [], fame: [], memories: [], splits: [], moves: [], surname: [], estatesMarry: [], borrow: [], heirloom: [], letters: [] };
  const opt = { cap: 12, controlledCap: 8, priest: true, heirloomValue: 0, borrowOk: true, estatesMarry: false };
  const host: CourtshipHost & { dayN: number; lifespanN: number } = {
    persons,
    rng,
    rel,
    dayN: 10,
    lifespanN: 1,
    day: () => host.dayN,
    lifespan: () => host.lifespanN,
    age: (p) => ages.get(p.id) ?? AGE[p.lifeStage] + p.ageDays * 0.5,
    controlled: (hh) => hh === 1,
    headOf: (hh) => persons.filter((q) => q.household === hh && !q.infant).sort((a, b) => (ages.get(b.id) ?? AGE[b.lifeStage]) - (ages.get(a.id) ?? AGE[a.lifeStage]) || a.id - b.id)[0],
    householdEstate: (hh) => estate.get(hh) ?? 'freeman',
    householdCap: (hh) => (hh === 1 ? opt.controlledCap : opt.cap),
    parentsOf: (id) => {
      const p = persons.find((q) => q.id === id) ?? graveyard.get(id);
      return p ? [p.mother, p.father] : null;
    },
    money: (hh) => money.get(hh) ?? 0,
    spend: (hh, n) => {
      const m = money.get(hh) ?? 0;
      if (m < n) return false;
      money.set(hh, m - n);
      return true;
    },
    addMoney: (hh, n) => void money.set(hh, (money.get(hh) ?? 0) + n),
    savingsS: (e) => S[e] ?? 288,
    fame: (hh, delta, reason) => void log.fame.push({ hh, delta, reason }),
    fameOf: (hh) => fameOf.get(hh) ?? 300,
    church: (p, d) => void (p.churchRep = Math.max(-100, Math.min(100, p.churchRep + d))),
    moodlet: (p, id) => void log.moodlets.push({ p: p.id, id }),
    memory: (p, kind) => void log.memories.push({ p: p.id, kind }),
    notice: (p, kind, args) => void log.notices.push({ p: p.id, kind, args }),
    news: (kind) => void log.news.push(kind),
    chronicle: (t) => void log.chronicle.push(t),
    rumor: (subjects, kind) => void log.rumors.push({ subjects: subjects.map((s) => s.id), kind }),
    offerCard: (p, card, _vars, other) => void log.cards.push({ p: p.id, card, other: other?.id ?? 0 }),
    moveTo: (p, hh) => {
      p.household = hh;
      log.moves.push({ p: p.id, hh });
    },
    splitHousehold: (ps, reason) => {
      const hh = nextHh++;
      for (const p of ps) p.household = hh;
      log.splits.push({ ids: ps.map((p) => p.id), reason, hh });
      return hh;
    },
    changeSurname: (p) => void log.surname.push(p.id),
    heirloomDowry: (from) => {
      log.heirloom.push(from);
      return opt.heirloomValue;
    },
    borrow: (hh, n) => {
      log.borrow.push(hh);
      if (!opt.borrowOk) return false;
      money.set(hh, (money.get(hh) ?? 0) + n);
      return true;
    },
    priestAvailable: () => opt.priest,
    letter: (from, to, kind) => void log.letters.push({ from: from.id, to: to.id, kind }),
  };
  const graveyard = new Map<number, Person>();
  const add = (name: string, hh: number, o: Partial<Pick<Person, 'sex' | 'lifeStage' | 'mother' | 'father' | 'estate' | 'traits' | 'churchRep'>> & { age?: number } = {}): Person => {
    const p = new Person(++pid, name, 0, 0);
    p.household = hh;
    p.sex = o.sex ?? 'male';
    p.lifeStage = o.lifeStage ?? 'young';
    p.mother = o.mother ?? 0;
    p.father = o.father ?? 0;
    p.estate = o.estate ?? estate.get(hh) ?? 'freeman';
    p.traits = o.traits ?? [];
    p.churchRep = o.churchRep ?? 0;
    if (o.age !== undefined) ages.set(p.id, o.age);
    persons.push(p);
    return p;
  };
  const marry = (a: Person, b: Person) => {
    a.spouse = b.id;
    b.spouse = a.id;
    a.marriedDay = b.marriedDay = host.dayN;
    const r = rel.ensure(a.id, b.id);
    r.met = true;
    r.flags.add('spouse');
    r.friendship = 50;
    r.romance = 50;
  };
  const kill = (p: Person) => {
    persons.splice(persons.indexOf(p), 1);
    graveyard.set(p.id, p);
  };
  /** 가장(elder) + 배우자 + 자녀 */
  const family = (hh: number, est = 'freeman', kids: { name: string; sex: 'male' | 'female'; age?: number; lifeStage?: LifeStage }[] = [], traits: string[] = []) => {
    estate.set(hh, est);
    const dad = add(`아버지${hh}`, hh, { sex: 'male', lifeStage: 'elder', traits });
    const mom = add(`어머니${hh}`, hh, { sex: 'female', lifeStage: 'elder' });
    marry(dad, mom);
    const children = kids.map((k) => add(k.name, hh, { sex: k.sex, lifeStage: k.lifeStage ?? 'young', mother: mom.id, father: dad.id, age: k.age }));
    return { dad, mom, children };
  };
  const court = () => {
    const c = new Courtship(host, data);
    if (opt.estatesMarry)
      host.estatesMarry = (stay, incoming, o): MarriagePlanLike => {
        log.estatesMarry.push({ stay: stay.id, incoming: incoming.id, ux: !!o.uxorilocal });
        return { ok: true };
      };
    return c;
  };
  const lovers = (a: Person, b: Person, romance = 60) => {
    const r = rel.ensure(a.id, b.id);
    r.met = true;
    r.flags.add('lover');
    r.romance = romance;
    r.friendship = 40;
  };
  return { host, rng, rel, persons, money, estate, ages, fameOf, log, opt, add, marry, kill, family, court, lovers };
}

describe('M9 구애와 혼인 (14-4)', () => {
  it('연애혼 전 과정: 청혼 → 양가 승낙 → 약혼(잔치 카드) → 제단 혼례 → 이사·지참금·명성·부부', () => {
    const w = world();
    const A = w.family(1, 'freeman', [{ name: '앨런', sex: 'male' }]).children[0];
    const fam2 = w.family(2, 'freeman', [{ name: '베스', sex: 'female' }], ['kind', 'romantic']);
    const B = fam2.children[0];
    w.money.set(2, 500);
    w.lovers(A, B);
    const c = w.court();
    // social.json 청혼 성공이 engaged 를 붙인 뒤 onSocial
    w.rel.get(A.id, B.id)!.flags.add('engaged');
    w.rng.queue = [0.01];
    c.onSocial(A, B, 'social.propose', true);
    const bt = c.betrothalOf(A)!;
    expect(bt).toBeTruthy();
    expect(bt.path).toBe('love');
    expect(A.betrothed).toBe(B.id);
    expect(w.rel.get(A.id, B.id)!.flags.has('engaged')).toBe(true);
    expect(w.rel.get(A.id, B.id)!.flags.has('lover')).toBe(false);
    expect(w.log.cards.some((x) => x.card === 'wedding_feast_budget')).toBe(true);
    expect(c.decidedToday(A)).toBe(true);
    expect(c.flags(A)).toContain('engaged');
    // 혼례 날: 제단 예식
    w.host.dayN = bt.weddingDay;
    expect(c.gates().wedding_today(A, null)).toBe(true);
    c.onInteraction(A, 'altar.wedding_rite');
    expect(A.spouse).toBe(B.id);
    expect(B.spouse).toBe(A.id);
    expect(B.household).toBe(1);
    expect(w.rel.get(A.id, B.id)!.flags.has('spouse')).toBe(true);
    expect(w.log.news).toContain('married');
    expect(w.log.chronicle).toContain('wedding');
    expect(w.log.fame.some((f) => f.reason === 'wedding' && f.delta > 0)).toBe(true);
    // 지참금: 신부 가정(자유민 S 288 × 1/4 = 72) → 신랑 가정
    expect(w.money.get(1)).toBe(72);
    expect(w.log.moodlets.some((m) => m.id === 'wedding_day' && m.p === A.id)).toBe(true);
    expect(w.log.moodlets.some((m) => m.id === 'wedding_guest_merry')).toBe(true);
    expect(c.state.stats.marriages).toBe(1);
  });

  it('부모가 거절하면 연인으로 되돌리고 도피 카드 → 사랑의 도피: 분가·혼인·명성 크게 하락·소문·연대기', () => {
    const w = world();
    const A = w.family(1, 'freeman', [{ name: '앨런', sex: 'male' }]).children[0];
    const B = w.family(2, 'knight', [{ name: '베스', sex: 'female' }], ['stubborn', 'ambitious']).children[0];
    w.lovers(A, B);
    const c = w.court();
    w.rel.get(A.id, B.id)!.flags.add('engaged');
    w.rng.queue = [0.99];
    c.onSocial(A, B, 'social.propose', true);
    expect(c.betrothalOf(A)).toBeUndefined();
    expect(w.rel.get(A.id, B.id)!.flags.has('lover')).toBe(true);
    expect(w.rel.get(A.id, B.id)!.flags.has('engaged')).toBe(false);
    expect(w.log.moodlets.filter((m) => m.id === 'parents_refused_match').length).toBe(2);
    expect(w.log.cards).toContainEqual({ p: A.id, card: 'elopement_offer', other: B.id });
    expect(c.flags(A)).toContain('match_refused');
    expect(w.log.letters.some((l) => l.kind === 'match_refusal')).toBe(true);
    // 신분 차이 큰 가장 + 완고·야심 → 승낙 확률 낮음
    const head = w.host.headOf(2)!;
    expect(c.consentChance(head, B, A)).toBeLessThan(0.2);
    // 도피
    const r = c.elope(A, B);
    expect(r.ok).toBe(true);
    expect(A.spouse).toBe(B.id);
    expect(A.household).toBe(B.household);
    expect(w.log.splits[0].reason).toBe('elopement');
    expect(w.log.fame.filter((f) => f.reason === 'elopement').map((f) => f.delta)).toEqual([-60, -60]);
    expect(w.log.rumors.some((x) => x.kind === 'elopement')).toBe(true);
    expect(w.log.chronicle).toContain('elopement');
    expect(A.churchRep).toBe(-5);
    expect(c.state.stats.elopements).toBe(1);
  });

  it('도피 카드 선택(0번)은 카드가 넣은 명성·소문을 다시 넣지 않고 혼인만', () => {
    const w = world();
    const A = w.family(1, 'freeman', [{ name: '앨런', sex: 'male' }]).children[0];
    const B = w.family(2, 'freeman', [{ name: '베스', sex: 'female' }]).children[0];
    w.lovers(A, B);
    const c = w.court();
    c.state.refusals.push({ a: A.id, b: B.id, day: 10 });
    c.onCard(A, 'elopement_offer', 0, true, B);
    expect(A.spouse).toBe(B.id);
    expect(w.log.fame.length).toBe(0);
    expect(w.log.rumors.length).toBe(0);
  });

  it('중매: 후보 목록 (독신·나이·근친 거름, 상한 5), 협상 성공 → 중매 약혼 + 어색함, 실패 → 거절, 같은 날 다시 못 함', () => {
    const w = world();
    const { children } = w.family(1, 'artisan', [{ name: '앨런', sex: 'male' }, { name: '누이', sex: 'female' }]);
    const A = children[0];
    for (let i = 0; i < 8; i++) w.family(10 + i, i % 2 ? 'freeman' : 'artisan', [{ name: `처녀${i}`, sex: 'female' }]);
    const married = w.family(30, 'artisan', [{ name: '유부녀', sex: 'female' }]).children[0];
    const other = w.add('남편', 30, { sex: 'male' });
    w.marry(married, other);
    w.family(31, 'artisan', [{ name: '어린이', sex: 'female', lifeStage: 'teen', age: 14 }]);
    const c = w.court();
    const r = c.findMatch(1, A.id);
    expect(r.ok).toBe(true);
    expect(r.candidates.length).toBe(5);
    expect(r.candidates.every((x) => x.sex === 'female' && x.household !== 1 && x.age >= 16)).toBe(true);
    expect(r.candidates.some((x) => x.name === '유부녀' || x.name === '어린이' || x.name === '누이')).toBe(false);
    // 신분이 같은 장인 집안이 앞에
    expect(r.candidates[0].estate).toBe('artisan');
    expect(r.candidates[0].traits.length).toBeLessThanOrEqual(2);
    expect(c.offers(1).length).toBe(5);
    const m1 = r.candidates[0];
    w.rng.queue = [0.99];
    expect(c.negotiate(m1.matchId, { dowry: m1.dowry }).reason).toBe('reason.court.refused');
    expect(c.negotiate(m1.matchId).reason).toBe('reason.court.wait');
    w.host.dayN++;
    w.rng.queue = [0.01];
    const ok = c.negotiate(m1.matchId, { dowry: m1.dowry, residence: 'groom' });
    expect(ok.ok).toBe(true);
    const bt = c.betrothalOf(A)!;
    expect(bt.path).toBe('arranged');
    expect(w.log.moodlets.filter((m) => m.id === 'arranged_match_uneasy').length).toBe(2);
    // 지참금을 더 내겠다고 하면 상대 가장이 받아들이기 쉬움
    const w2 = world();
    const A2 = w2.family(1, 'artisan', [{ name: '앨런', sex: 'male' }]).children[0];
    w2.family(10, 'artisan', [{ name: '처녀', sex: 'female' }]);
    const c2 = w2.court();
    const mid = c2.findMatch(1, A2.id).candidates[0].matchId;
    const off = c2.state.offers.find((x) => x.id === mid)!;
    expect(off).toBeTruthy();
    // 신부 쪽이 내는 지참금을 더 달라고 하면(우리가 받는 쪽) 어려워짐
    expect(c2.negotiateChance(off, { dowry: off.dowry * 2 })).toBeLessThan(c2.negotiateChance(off, { dowry: off.dowry }));
  });

  it('혼사 방해 중이면 후보 목록이 빔', () => {
    const w = world();
    const A = w.family(1, 'freeman', [{ name: '앨런', sex: 'male' }]).children[0];
    w.family(2, 'freeman', [{ name: '베스', sex: 'female' }]);
    w.host.matchBlocked = (hh) => hh === 1;
    const c = w.court();
    const r = c.findMatch(1, A.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('reason.court.match_blocked');
    expect(r.candidates).toEqual([]);
  });

  it('지참금 기준: 신부 가문 S × 1/4, 한 단계 위로 시집가면 상대 기준 × 1.5, estates.dowry 가 있으면 그것', () => {
    const w = world();
    const c = w.court();
    expect(c.dowryFor('freeman', 'freeman')).toBe(72);
    expect(c.dowryFor('freeman', 'artisan')).toBe(Math.round(864 * 0.25 * 1.5));
    expect(c.dowryFor('artisan', 'freeman')).toBe(216);
    w.host.dowry = () => 999;
    expect(c.dowryFor('freeman', 'noble')).toBe(999);
  });

  it('지참금이 모자라면: NPC 는 가보 → 빚, 조작 가문은 카드(빚/가보/포기), 못 채우면 명성 하락', () => {
    // NPC: 가보가 값을 채움
    {
      const w = world();
      const g = w.family(3, 'freeman', [{ name: '신랑', sex: 'male' }]).children[0];
      const b = w.family(4, 'freeman', [{ name: '신부', sex: 'female' }]).children[0];
      w.opt.heirloomValue = 100;
      const c = w.court();
      c.betroth(g, b, 'npc');
      w.host.dayN = c.betrothalOf(g)!.weddingDay;
      c.daily();
      expect(g.spouse).toBe(b.id);
      expect(w.log.heirloom).toEqual([4]);
      expect(w.log.borrow).toEqual([]);
      expect(w.log.moodlets.some((m) => m.id === 'dowry_settled')).toBe(true);
    }
    // NPC: 가보도 없으면 빚
    {
      const w = world();
      const g = w.family(3, 'freeman', [{ name: '신랑', sex: 'male' }]).children[0];
      const b = w.family(4, 'freeman', [{ name: '신부', sex: 'female' }]).children[0];
      const c = w.court();
      c.betroth(g, b, 'npc');
      w.host.dayN = c.betrothalOf(g)!.weddingDay;
      c.daily();
      expect(w.log.borrow).toEqual([4]);
      expect(w.money.get(3)).toBe(72);
      expect(c.state.stats.dowryDebt).toBe(1);
    }
    // 조작 가문 신부: 지참금 카드, 포기를 고르면 명성 하락 + 부담
    {
      const w = world();
      const g = w.family(3, 'freeman', [{ name: '신랑', sex: 'male' }]).children[0];
      const b = w.family(1, 'freeman', [{ name: '신부', sex: 'female' }]).children[0];
      const c = w.court();
      c.betroth(g, b, 'love', { residence: 'groom' });
      expect(w.log.cards.some((x) => x.card === 'dowry_short')).toBe(true);
      expect(c.flags(b)).toContain('dowry_due');
      c.onCard(w.host.headOf(1)!, 'dowry_short', 2, true, g);
      const bt = c.betrothalOf(b)!;
      bt.residenceSet = true;
      w.host.dayN = bt.weddingDay + 1;
      c.daily();
      expect(b.household).toBe(3);
      expect(w.log.fame.some((f) => f.reason === 'dowry_short' && f.delta === data.dowry.shortFame)).toBe(true);
      expect(w.log.moodlets.some((m) => m.id === 'dowry_burden')).toBe(true);
      expect(w.log.borrow).toEqual([]);
    }
  });

  it('데릴사위: 신부 집으로 들어가고 성을 바꿈 (estates.marry uxorilocal, 없으면 changeSurname)', () => {
    for (const withEstates of [false, true]) {
      const w = world();
      w.opt.estatesMarry = withEstates;
      const g = w.family(3, 'freeman', [{ name: '신랑', sex: 'male' }]).children[0];
      const b = w.family(4, 'artisan', [{ name: '신부', sex: 'female' }]).children[0];
      w.money.set(3, 1000);
      const c = w.court();
      expect(c.betroth(g, b, 'arranged', { residence: 'bride', surname: 'bride' }).ok).toBe(true);
      w.host.dayN = c.betrothalOf(g)!.weddingDay;
      c.daily();
      expect(g.household).toBe(4);
      if (withEstates) expect(w.log.estatesMarry).toEqual([{ stay: b.id, incoming: g.id, ux: true }]);
      else expect(w.log.surname).toEqual([g.id]);
      // 들어가는 신랑 쪽이 지참금을 냄 (자유민이 장인 집으로: 장인 기준 × 1.5)
      expect(w.money.get(4)).toBe(Math.round(864 * 0.25 * 1.5));
    }
  });

  it('들어가는 가정이 인원 상한이면 두 사람이 분가', () => {
    const w = world();
    const g = w.family(3, 'freeman', [{ name: '신랑', sex: 'male' }]).children[0];
    const b = w.family(4, 'freeman', [{ name: '신부', sex: 'female' }]).children[0];
    for (let i = 0; i < 9; i++) w.add(`식구${i}`, 3, { lifeStage: 'child' });
    expect(w.persons.filter((p) => p.household === 3).length).toBe(12);
    const c = w.court();
    c.betroth(g, b, 'npc');
    w.host.dayN = c.betrothalOf(g)!.weddingDay;
    c.daily();
    expect(w.log.splits).toHaveLength(1);
    expect(w.log.splits[0].ids.sort()).toEqual([g.id, b.id].sort());
    expect(w.log.splits[0].reason).toBe('marriage_cap');
    expect(g.household).toBe(b.household);
    expect(g.household).not.toBe(3);
    // 지참금은 새 가정으로
    expect(w.log.borrow).toEqual([4]);
    expect(w.money.get(g.household)).toBe(72);
  });

  it('근친 촌수 표: 부모 1, 형제 2, 조부모 2, 삼촌 3, 사촌 4 (혼인 금지), 5촌은 가능', () => {
    const w = world();
    const g1 = w.add('할아버지', 5, { sex: 'male', lifeStage: 'elder' });
    const g2 = w.add('할머니', 5, { sex: 'female', lifeStage: 'elder' });
    const p1 = w.add('큰아들', 5, { sex: 'male', lifeStage: 'adult', mother: g2.id, father: g1.id });
    const p2 = w.add('작은딸', 6, { sex: 'female', lifeStage: 'adult', mother: g2.id, father: g1.id });
    const c1 = w.add('손자', 5, { sex: 'male', father: p1.id });
    const c2 = w.add('손녀', 6, { sex: 'female', mother: p2.id });
    const c3 = w.add('손녀딸', 7, { sex: 'female', mother: c2.id, lifeStage: 'young' });
    const po = (id: number) => {
      const p = w.persons.find((q) => q.id === id);
      return p ? ([p.mother, p.father] as const) : null;
    };
    expect(kinDegree(c1.id, p1.id, po)).toBe(1);
    expect(kinDegree(p1.id, p2.id, po)).toBe(2);
    expect(kinDegree(c1.id, g1.id, po)).toBe(2);
    expect(kinDegree(c1.id, p2.id, po)).toBe(3);
    expect(kinDegree(c1.id, c2.id, po)).toBe(4);
    expect(kinDegree(c1.id, c3.id, po)).toBe(5);
    expect(kinDegree(c1.id, w.add('남', 9).id, po)).toBe(Infinity);
    const c = w.court();
    expect(c.canMarry(c1, c2).reason).toBe('reason.court.kin');
    expect(c.canMarry(c1, p2).reason).toBe('reason.court.kin');
    expect(c.canMarry(c1, c3).ok).toBe(true);
    // 죽은 조상도 가계도로 (parentsOf)
    w.kill(g1);
    w.kill(g2);
    expect(c.canMarry(c1, c2).reason).toBe('reason.court.kin');
  });

  it('16세 미만, 기혼, 성직자, 같은 성별(설정)은 혼인 불가', () => {
    const w = world();
    const a = w.add('소년', 2, { sex: 'male', lifeStage: 'teen', age: 15 });
    const b = w.add('소녀', 3, { sex: 'female', lifeStage: 'teen', age: 16 });
    const c = w.court();
    expect(c.canMarry(a, b).reason).toBe('reason.court.too_young');
    w.ages.set(a.id, 16);
    expect(c.canMarry(a, b).ok).toBe(true);
    const priest = w.add('사제', 4, { sex: 'male', estate: 'clergy' });
    expect(c.canMarry(priest, b).reason).toBe('reason.court.celibate');
    const d = w.add('다른 소녀', 5, { sex: 'female' });
    expect(c.canMarry(b, d).reason).toBe('reason.court.same_sex');
    const e = w.add('유부남', 6, { sex: 'male' });
    w.marry(e, w.add('아내', 6, { sex: 'female' }));
    expect(c.canMarry(e, b).reason).toBe('reason.court.married');
    expect(c.betroth(a, w.add('어린이', 7, { sex: 'female', lifeStage: 'child' }), 'npc').ok).toBe(false);
  });

  it('불륜: 기혼자의 고백 성공 → 불륜, 발각되면 배우자 배신 기억 (우정 −60, 로맨스 −50)·명예·교회 평판·소문', () => {
    const w = world();
    const H = w.add('남편', 5, { sex: 'male', lifeStage: 'adult' });
    const W = w.add('아내', 5, { sex: 'female', lifeStage: 'adult' });
    w.marry(H, W);
    const L = w.add('정부', 6, { sex: 'female', lifeStage: 'adult' });
    const c = w.court();
    c.onSocial(H, L, 'social.confess', true);
    expect(c.affairOf(H, L)).toBeTruthy();
    expect(c.flags(H)).toContain('affair');
    expect(w.log.moodlets.filter((m) => m.p === H.id).map((m) => m.id)).toEqual(['affair_thrill', 'affair_guilt']);
    const before = { f: w.rel.friendship(W.id, H.id), r: w.rel.romance(W.id, H.id) };
    // 로맨스 상호작용마다 발각 확률
    w.rng.queue = [0.001];
    c.onSocial(H, L, 'social.kiss', true);
    expect(c.affairOf(H, L)!.exposed).toBe(true);
    expect(w.rel.friendship(W.id, H.id)).toBe(before.f - 60);
    expect(w.rel.romance(W.id, H.id)).toBe(before.r - 50);
    expect(w.log.memories).toContainEqual({ p: W.id, kind: 'betrayed_by_spouse' });
    expect(w.log.moodlets).toContainEqual({ p: W.id, id: 'betrayed_by_spouse' });
    expect(w.log.fame).toContainEqual({ hh: 5, delta: -40, reason: 'affair' });
    expect(H.churchRep).toBe(-15);
    expect(w.log.rumors.some((x) => x.kind === 'affair' && x.subjects[0] === H.id)).toBe(true);
    expect(w.log.chronicle).toContain('affair_exposed');
  });

  it('조작 가문 기혼자의 불륜이 드러나면 카드 (affair_discovered), 소문을 배우자가 들어도 발각', () => {
    const w = world();
    const H = w.add('남편', 1, { sex: 'male', lifeStage: 'adult' });
    const W = w.add('아내', 1, { sex: 'female', lifeStage: 'adult' });
    w.marry(H, W);
    const L = w.add('정부', 6, { sex: 'female', lifeStage: 'adult' });
    const c = w.court();
    c.startAffair(H, L);
    c.onRumorHeard('affair', [H.id], W);
    expect(w.log.cards).toContainEqual({ p: H.id, card: 'affair_discovered', other: L.id });
    c.onCard(H, 'affair_discovered', 2, true, L);
    expect(c.affairOf(H, L)).toBeUndefined();
  });

  it('사생아 판정: 미혼모·남편 아닌 아버지·성직자 → 사생아, 남편의 아이·약혼자의 아이 → 적자', () => {
    const w = world();
    const m = w.add('어머니', 5, { sex: 'female', lifeStage: 'adult' });
    const h = w.add('남편', 5, { sex: 'male', lifeStage: 'adult' });
    const y = w.add('이웃', 6, { sex: 'male', lifeStage: 'adult' });
    const baby = w.add('아기', 5, { lifeStage: 'baby' });
    const c = w.court();
    expect(c.isBastard(baby, m, y)).toBe(true);
    expect(c.isBastard(baby, m, null)).toBe(true);
    c.betroth(m, y, 'npc');
    expect(c.isBastard(baby, m, y)).toBe(false);
    c.cancelBetrothal(c.betrothalOf(m)!, 'broken');
    w.marry(m, h);
    expect(c.isBastard(baby, m, h)).toBe(false);
    expect(c.isBastard(baby, m, y)).toBe(true);
    y.estate = 'clergy';
    expect(c.isBastard(baby, m, y)).toBe(true);
    const r = c.onBirth(baby, m, y);
    expect(r.bastard).toBe(true);
    expect(w.log.rumors.some((x) => x.kind === 'bastard')).toBe(true);
    expect(w.log.moodlets).toContainEqual({ p: m.id, id: 'bastard_whispers' });
  });

  it('혼인 무효 청원: 사유·교회 평판·돈이 있어야, 받아들여지면 들어온 사람이 원래 집으로', () => {
    const w = world();
    const g = w.family(3, 'freeman', [{ name: '신랑', sex: 'male' }]).children[0];
    const b = w.family(4, 'freeman', [{ name: '신부', sex: 'female' }]).children[0];
    w.money.set(4, 500);
    const c = w.court();
    c.betroth(g, b, 'npc');
    w.host.dayN = c.betrothalOf(g)!.weddingDay;
    c.daily();
    expect(b.household).toBe(3);
    expect(c.petitionAnnulment(b.id, 'childless').reason).toBe('reason.court.no_reason');
    w.host.dayN += 14;
    expect(c.annulReasons(b)).toContain('childless');
    expect(c.petitionAnnulment(b.id, 'childless').reason).toBe('reason.court.church_low');
    b.churchRep = 40;
    w.money.set(3, 0);
    expect(c.petitionAnnulment(b.id, 'childless').reason).toBe('reason.court.money');
    w.money.set(3, 1000);
    expect(c.gates().can_annul(b, null)).toBe(true);
    w.rng.queue = [0.01];
    expect(c.petitionAnnulment(b.id, 'childless').ok).toBe(true);
    expect(b.spouse).toBe(0);
    expect(g.spouse).toBe(0);
    expect(b.household).toBe(4);
    expect(w.rel.get(g.id, b.id)!.flags.has('ex_spouse')).toBe(true);
    expect(w.log.rumors.some((x) => x.kind === 'annulment')).toBe(true);
    expect(w.log.moodlets).toContainEqual({ p: b.id, id: 'annulment_relief' });
    expect(w.money.get(3)).toBe(1000 - Math.round(0.15 * 288));
  });

  it('별거: 한 명이 집을 나가고, 화해하면 돌아옴', () => {
    const w = world();
    const a = w.add('남편', 5, { sex: 'male', lifeStage: 'adult' });
    const b = w.add('아내', 5, { sex: 'female', lifeStage: 'adult' });
    w.marry(a, b);
    const c = w.court();
    expect(c.separate(b.id).ok).toBe(true);
    expect(b.household).not.toBe(5);
    expect(b.spouse).toBe(a.id);
    expect(c.separate(b.id).reason).toBe('reason.court.already_separated');
    expect(w.log.rumors.some((x) => x.kind === 'separation')).toBe(true);
    expect(c.gates().separated_spouse(a, b)).toBe(true);
    c.onSocial(a, b, 'social.ask_reconcile', true);
    expect(b.household).toBe(5);
    expect(c.separationOf(a)).toBeUndefined();
  });

  it('사별: 애도 기간 7일(lifespan) 안의 재혼은 소문 hasty_remarriage, 지나면 없음', () => {
    for (const [lifespan, gap, hasty] of [[1, 3, true], [1, 8, false], [2, 10, true], [2, 15, false]] as const) {
      const w = world();
      w.host.lifespanN = lifespan;
      const a = w.add('홀아비', 5, { sex: 'male', lifeStage: 'adult' });
      const dead = w.add('아내', 5, { sex: 'female', lifeStage: 'adult' });
      w.marry(a, dead);
      const n = w.family(6, 'freeman', [{ name: '새 신부', sex: 'female' }]).children[0];
      const c = w.court();
      c.onDeath(dead);
      w.kill(dead);
      expect(a.spouse).toBe(0);
      expect(w.log.moodlets).toContainEqual({ p: a.id, id: 'widowed_mourning' });
      expect(c.flags(a)).toContain('widowed_recent');
      w.host.dayN += gap - 2;
      c.daily();
      c.betroth(a, n, 'npc');
      w.host.dayN = c.betrothalOf(a)!.weddingDay;
      c.daily();
      expect(a.spouse).toBe(n.id);
      expect(w.log.rumors.some((x) => x.kind === 'hasty_remarriage')).toBe(hasty);
      expect(w.log.news).toContain('remarried');
    }
  });

  it('유령 질투 훅: 죽은 배우자가 유령이면 재혼 때 부름', () => {
    const w = world();
    const a = w.add('홀아비', 5, { sex: 'male', lifeStage: 'adult' });
    const dead = w.add('아내', 5, { sex: 'female', lifeStage: 'adult' });
    w.marry(a, dead);
    const n = w.family(6, 'freeman', [{ name: '새 신부', sex: 'female' }]).children[0];
    const calls: number[] = [];
    w.host.isGhost = (id) => id === dead.id;
    w.host.ghostJealousy = (g) => void calls.push(g);
    const c = w.court();
    c.onDeath(dead);
    w.kill(dead);
    c.betroth(a, n, 'npc');
    w.host.dayN = c.betrothalOf(a)!.weddingDay;
    c.daily();
    expect(calls).toEqual([dead.id]);
  });

  it('NPC 점수: 적합한 쌍은 0 이 아니고, 평균 크기는 기존 판정기 식과 같음', () => {
    const w = world(3);
    const R = new Rng(11);
    const estates = ['serf', 'freeman', 'freeman', 'artisan', 'merchant', 'knight'];
    for (let i = 0; i < 60; i++) {
      const hh = 100 + i;
      w.estate.set(hh, estates[R.int(estates.length)]);
      w.add(`사람${i}`, hh, { sex: i % 2 ? 'female' : 'male', lifeStage: R.next() < 0.5 ? 'young' : 'adult', age: 16 + R.int(20) });
    }
    const c = w.court();
    const M = JSON.parse(readFileSync('src/data/story.json', 'utf8')).marriage;
    let zeros = 0;
    let pairs = 0;
    let sumNew = 0;
    let sumOld = 0;
    const men = w.persons.filter((p) => p.sex === 'male');
    const women = w.persons.filter((p) => p.sex === 'female');
    for (const a of women)
      for (const b of men) {
        if (Math.abs(w.host.age(a) - w.host.age(b)) > M.ageGapYears) continue;
        const f = Math.round((R.next() - 0.3) * 60);
        const ro = R.int(40);
        const r = w.rel.ensure(a.id, b.id);
        r.friendship = f;
        r.romance = ro;
        pairs++;
        const s = c.npcMatchScore(a, b);
        if (s === 0) zeros++;
        sumNew += s * M.baseDaily;
        const rank = (e: string) => M.estateRank.indexOf(e);
        let pr = M.baseDaily;
        if (Math.abs(rank(a.estate) - rank(b.estate)) >= 2) pr *= M.estateGapPenalty;
        pr *= 1 + Math.max(-0.5, f * M.friendshipBonus);
        pr += ro * M.romanceBonus;
        sumOld += pr;
      }
    expect(pairs).toBeGreaterThan(300);
    expect(zeros).toBe(0);
    expect(sumNew / sumOld).toBeGreaterThan(0.95);
    expect(sumNew / sumOld).toBeLessThan(1.05);
    // 같은 가구·근친·기혼은 0
    const [a, b] = [women[0], men[0]];
    b.household = a.household;
    expect(c.npcMatchScore(a, b)).toBe(0);
    // 판정기 약혼 → 혼례 날 이 모듈이 처리, 오늘 명시적으로 정한 사람은 굴리지 않음
    const [x, y] = [women[1], men[1]];
    expect(c.arrangeNpcWedding(x, y).ok).toBe(true);
    expect(c.managed(x)).toBe(true);
    expect(c.arrangeNpcWedding(women[2], y).ok).toBe(false);
  });

  it('게이트: 축복 청하기, 혼처 의논, 불륜 제안, 위로', () => {
    const w = world();
    const A = w.family(1, 'freeman', [{ name: '앨런', sex: 'male' }]).children[0];
    const fam = w.family(2, 'freeman', [{ name: '베스', sex: 'female' }]);
    const c = w.court();
    const g = c.gates();
    const head2 = w.host.headOf(2)!;
    expect(g.ask_consent(A, head2)).toBe(false);
    w.lovers(A, fam.children[0]);
    expect(g.ask_consent(A, head2)).toBe(true);
    expect(g.match_talk(w.host.headOf(1)!, head2)).toBe(true);
    expect(g.affair_possible(A, fam.children[0])).toBe(false);
    expect(g.affair_possible(fam.dad, w.host.headOf(1)!)).toBe(false);
    // 축복을 받으면 승낙 확률이 오름
    const before = c.consentChance(head2, fam.children[0], A);
    c.onSocial(A, head2, 'social.ask_consent', true);
    expect(c.consentChance(head2, fam.children[0], A)).toBeCloseTo(Math.min(0.95, before + data.consent.blessing));
    expect(g.can_seek_match(w.host.headOf(1)!, null)).toBe(true);
  });

  it('결정론: 같은 시드 같은 결과 (해시)', () => {
    const run = () => {
      const w = world(42);
      const people: ReturnType<typeof w.family>[] = [];
      for (let i = 0; i < 12; i++) people.push(w.family(10 + i, i % 3 ? 'freeman' : 'artisan', [{ name: `아이${i}`, sex: i % 2 ? 'female' : 'male' }]));
      w.family(1, 'freeman', [{ name: '앨런', sex: 'male' }]);
      const c = w.court();
      for (let d = 0; d < 20; d++) {
        w.host.dayN++;
        const ws = people.map((f) => f.children[0]).filter((p) => p.sex === 'female' && !p.spouse && !p.betrothed);
        const ms = people.map((f) => f.children[0]).filter((p) => p.sex === 'male' && !p.spouse && !p.betrothed);
        for (const x of ws) for (const y of ms) if (w.rng.next() < 0.02 * c.npcMatchScore(x, y)) c.arrangeNpcWedding(x, y);
        c.daily();
      }
      const parts: (string | number)[] = [];
      c.hashParts(parts);
      return { parts: parts.join('|'), married: c.state.stats.marriages };
    };
    const a = run();
    const b = run();
    expect(a.parts).toBe(b.parts);
    expect(a.married).toBeGreaterThan(0);
  });

  it('콘텐츠: 무드렛·카드·문장 키가 모두 있고, 새 대사는 문장 규칙을 지킴', () => {
    const moods = { ...JSON.parse(readFileSync('src/data/moodlets.json', 'utf8')).moodlets, ...JSON.parse(readFileSync('src/data/moodlets_m7.json', 'utf8')).moodlets };
    for (const f of ['moodlets_m3.json', 'moodlets_m5.json']) Object.assign(moods, JSON.parse(readFileSync(`src/data/${f}`, 'utf8')).moodlets ?? {});
    const src = readFileSync('src/sim/society/courtship.ts', 'utf8');
    const used = new Set([...src.matchAll(/moodlet\([a-zA-Z.]+, '([a-z_]+)'\)/g)].map((m) => m[1]));
    for (const soc of Object.values(raw.social) as { success: { moodlets: string[]; targetMoodlets: string[] }; failure: { moodlets: string[]; targetMoodlets: string[] } }[])
      for (const o of [soc.success, soc.failure]) for (const id of [...o.moodlets, ...o.targetMoodlets]) used.add(id);
    const m9 = ['courted_flattered', 'proposal_rejected', 'parents_refused_match', 'eloped_thrill', 'arranged_match_uneasy', 'dowry_burden', 'dowry_settled', 'betrothal_nerves', 'wedding_guest_merry', 'affair_thrill', 'affair_guilt', 'betrayed_by_spouse', 'affair_exposed_shame', 'annulment_relief', 'separated_lonely', 'widowed_mourning', 'remarried_gossip', 'bastard_whispers'];
    for (const id of used) expect(moods[id], `무드렛 ${id}`).toBeTruthy();
    // 이 시스템 몫 M9 무드렛은 전부 연결 (편지 무드렛은 letters)
    for (const id of m9) expect(used.has(id), `연결 안 됨 ${id}`).toBe(true);
    const cards = new Set((JSON.parse(readFileSync('src/data/events/family_society.json', 'utf8')).cards as { id: string }[]).map((c) => c.id));
    for (const id of Object.keys(data.cards)) expect(cards.has(id), `카드 ${id}`).toBe(true);
    for (const m of src.matchAll(/offerCard\([^,]+, '([a-z_]+)'/g)) expect(cards.has(m[1]), `카드 ${m[1]}`).toBe(true);
    // 문장 키
    for (const [id, s] of Object.entries(raw.social) as [string, { nameKey: string; requires: { gate?: string } }][]) {
      expect(ko[s.nameKey], id).toBeTruthy();
      if (s.requires.gate) expect(ko[`reason.${s.requires.gate}`], s.requires.gate).toBeTruthy();
    }
    for (const [id, s] of Object.entries(raw.interactions) as [string, { nameKey: string; requires: { gate?: string } }][]) {
      expect(ko[s.nameKey], id).toBeTruthy();
      if (s.requires.gate) expect(ko[`reason.${s.requires.gate}`], s.requires.gate).toBeTruthy();
    }
    const c = world().court();
    for (const g of Object.keys(c.gates())) expect(ko[`reason.${g}`], g).toBeTruthy();
    for (const m of src.matchAll(/no\('([a-z_]+)'\)/g)) expect(ko[`reason.court.${m[1]}`], m[1]).toBeTruthy();
    for (const m of src.matchAll(/notice\([^,]+, '([a-z_]+)'/g)) expect(ko[`notice.${m[1]}`], m[1]).toBeTruthy();
    for (const m of src.matchAll(/news\('([a-z_]+)'/g)) expect(ko[`news.${m[1]}`], m[1]).toBeTruthy();
    for (const m of src.matchAll(/chronicle\('([a-z_]+)'/g)) expect(ko[`chronicle.${m[1]}`], m[1]).toBeTruthy();
    const kinds = JSON.parse(readFileSync('src/data/story.json', 'utf8')).rumor.kinds;
    for (const m of src.matchAll(/'(elopement|jilted|affair|bastard|annulment|separation|hasty_remarriage|generous_feast|love_match)'/g)) expect(kinds[m[1]], m[1]).toBeTruthy();
    // 대사창 문장 (dialogue.json 과 같은 규칙)
    let lines = 0;
    for (const [id, d] of Object.entries(raw.dialogue).filter(([k]) => !k.startsWith('$')) as [string, { ok: { act: string; say: string; reply?: string }[]; fail: { act: string; say: string; reply?: string }[] }][]) {
      expect(raw.social[id], id).toBeTruthy();
      for (const o of ['ok', 'fail'] as const) {
        expect(d[o].length).toBeGreaterThanOrEqual(3);
        for (const e of d[o]) {
          for (const [k, kind] of [[e.act, 'act'], [e.say, 'say'], [e.reply, 'say']] as const) {
            if (!k) continue;
            expect(ko[k], k).toBeTruthy();
            expect(dialogueTextProblems(ko[k], kind), `${k}: ${ko[k]}`).toEqual([]);
            lines++;
          }
        }
      }
    }
    expect(lines).toBeGreaterThanOrEqual(150);
  });
});
