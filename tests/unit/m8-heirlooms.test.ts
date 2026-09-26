/**
 * M8 가보 (GDD 16-5): 지정(최대 10)·이력·쓰기 효과·판매·지정 해제, 그리고 가보 사건 표 7행 재현 (BRIEF M8 통과 조건):
 * 1 화재·내구도 고장 → 손상 / 2 도난·압류·몰수 → 잃어버린 가보 + 되찾기 카드 / 3 지참금 → 상대 가문 가보 /
 * 4 상속 장자·지명 → 계승자 전부 / 5 상속 균분 → 지정자, 없으면 새 가장 / 6 분가 → 가장 허락 / 7 되팔기 경매 → 판매 규칙, 이력은 산 쪽으로
 * + 사건 카드(family_society.json)의 heirloom 결과를 모두 몰아 봄
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Person } from '../../src/sim/people/person';
import { family, fakeWorld, type FakeWorld } from './m8-house-fake';

function withHeirloom(defId = 'anvil', seed = 1, kids: Parameters<typeof family>[2] = [{ name: '첫째' }, { name: '둘째' }]) {
  const w = fakeWorld(seed);
  const f = family(w, 1, kids);
  const uid = w.host.addObject(defId, 1);
  const r = w.house.heirlooms.designate(f.clan.id, { kind: 'object', uid }, f.dad, 1, f.dad);
  expect(r.ok).toBe(true);
  return { w, f, uid, h: r.heirloom! };
}

const kinds = (w: FakeWorld, id: number) => w.house.heirlooms.get(id)!.history.map((e) => e.kind);

describe('M8 가보 지정과 효과 (16-5)', () => {
  it('가보 지정은 최대 10개, 같은 물건 두 번 안 됨, 이력에 만든 이·지정', () => {
    const { w, f, uid, h } = withHeirloom();
    expect(kinds(w, h.id)).toEqual(['made', 'designated']);
    expect(h.history[0].personId).toBe(f.dad.id);
    expect(w.house.heirlooms.designate(f.clan.id, { kind: 'object', uid }, f.dad, 1).reason).toBe('already');
    for (let i = 0; i < 9; i++) expect(w.house.heirlooms.designate(f.clan.id, { kind: 'object', uid: w.host.addObject('candlestick', 1) }, f.dad, 1).ok).toBe(true);
    expect(w.house.heirlooms.held(f.clan.id).length).toBe(10);
    expect(w.house.heirlooms.designate(f.clan.id, { kind: 'object', uid: w.host.addObject('lute', 1) }, f.dad, 1).reason).toBe('full');
    // 살림 물건도 가보가 될 수 있음 (반지·칼 같은 것)
    w.house.heirlooms.undesignate(w.house.heirlooms.held(f.clan.id)[9].id, f.dad);
    const knife = w.house.heirlooms.designate(f.clan.id, w.house.heirlooms.itemRef('knife', 1), f.mom, 1);
    expect(knife.ok).toBe(true);
    expect(w.house.heirlooms.skillOf(knife.heirloom!)).toBe('cooking');
  });

  it('쓰면 선조의 기억 무드렛 + 관련 스킬 경험치 +20%, 처음 쓰는 사람은 이력·기억', () => {
    const { w, f, uid, h } = withHeirloom();
    const son = f.children[0];
    expect(w.house.heirlooms.useObject(uid, son, 'smithing')).toBeCloseTo(1.2);
    expect(w.house.heirlooms.useObject(uid, son, 'music')).toBe(1);
    expect(w.host.moodletsOf(son)).toContain('ancestors_memory');
    expect(kinds(w, h.id).filter((k) => k === 'used').length).toBe(1);
    expect(w.host.log.memories.some((m) => m.p === son.id && m.kind === 'heirloom_used')).toBe(true);
    expect(w.house.heirlooms.useObject(w.host.addObject('anvil', 1), son, 'smithing')).toBe(1);
  });

  it('팔면 가족 전원 슬픔 + 명성 −30 (파는 사람 명예도), 지정 해제는 명성 −20', () => {
    const { w, f, h } = withHeirloom();
    w.house.heirlooms.sell(h.id, f.dad, 150);
    expect(w.host.moodletsOf(f.mom)).toContain('heirloom_sold_grief');
    expect(w.host.moodletsOf(f.children[1])).toContain('heirloom_sold_grief');
    expect(w.house.clans.fame(f.clan.id)).toBe(270);
    expect(f.dad.honor).toBe(-30);
    expect(w.host.moneyOf.get(1)).toBe(150);
    expect(w.house.heirlooms.held(f.clan.id).length).toBe(0);
    const g = withHeirloom();
    expect(g.w.house.heirlooms.undesignate(g.h.id, g.f.dad)).toBe(true);
    expect(g.w.house.clans.fame(g.f.clan.id)).toBe(280);
    expect(g.w.host.moodletsOf(g.f.dad)).toContain('disowned_ancestors_guilt');
    expect(g.w.house.heirlooms.get(g.h.id)!.status).toBe('released');
  });
});

describe('M8 가보 사건 표 (16-5) 재현', () => {
  it('1행 화재: 파괴되지 않고 그을린 가보, 이력, 수리 전 효과 절반, 대장일로 수리', () => {
    const { w, f, uid, h } = withHeirloom();
    expect(w.house.heirlooms.onFire(uid)).toBe(true); // fire.ts: 가보면 물건을 지우지 않음
    expect(w.host.objects.has(uid)).toBe(true);
    expect(w.host.objects.get(uid)!.damaged).toBe(true);
    expect(h.damaged).toBe('scorched');
    expect(kinds(w, h.id)).toContain('damaged');
    expect(w.host.moodletsOf(f.mom)).toContain('heirloom_damaged');
    expect(w.house.heirlooms.useObject(uid, f.dad, 'smithing')).toBeCloseTo(1.1);
    expect(w.house.heirlooms.effectMult(h)).toBe(0.5);
    expect(w.house.heirlooms.onFire(w.host.addObject('chair', 1))).toBe(false); // 가보가 아닌 물건은 탐
    expect(w.house.heirlooms.repairSkill(h)).toBe('smithing');
    expect(w.house.heirlooms.repair(h.id, f.mom).reason).toBe('skill_low');
    f.mom.skills.smithing = 2;
    expect(w.house.heirlooms.repair(h.id, f.mom).ok).toBe(true);
    expect(h.damaged).toBeNull();
    expect(w.host.objects.get(uid)!.damaged).toBe(false);
    expect(w.house.heirlooms.useObject(uid, f.dad, 'smithing')).toBeCloseTo(1.2);
    expect(kinds(w, h.id)).toContain('repaired');
  });

  it('1행 내구도 고장: 금 간 가보, 나무 물건은 목공으로 수리', () => {
    const { w, f, uid, h } = withHeirloom('lute');
    expect(w.house.heirlooms.onBroken(uid)).toBe(true);
    expect(h.damaged).toBe('cracked');
    expect(w.house.heirlooms.repairSkill(h)).toBe('carpentry');
    f.dad.skills.carpentry = 3;
    expect(w.house.heirlooms.repair(h.id, f.dad).ok).toBe(true);
    const t = withHeirloom('tapestry');
    expect(t.w.house.heirlooms.repairSkill(t.h)).toBe('needlework');
  });

  it('2행 도난: 10칸에서 빠져 잃어버린 가보 목록으로, 슬픔, lost_heirloom 플래그, 되찾기 카드(도둑 추적·장물·소문)가 연결됨', () => {
    const { w, f, uid, h } = withHeirloom();
    expect(w.house.heirlooms.lose(h.id, 'stolen')).toBe(true);
    expect(w.host.objects.has(uid)).toBe(false);
    expect(w.house.heirlooms.held(f.clan.id).length).toBe(0);
    expect(w.house.heirlooms.lost(f.clan.id).map((x) => x.id)).toEqual([h.id]);
    expect(w.house.heirlooms.flags(f.dad).has('lost_heirloom')).toBe(true);
    expect(w.house.heirlooms.flags(f.dad).has('has_heirloom')).toBe(false);
    expect(w.host.moodletsOf(f.mom)).toContain('heirloom_lost_grief');
    expect(w.host.log.rumors.some((r) => r.kind === 'lost_heirloom')).toBe(true);
    // 빈 칸에 다른 물건을 지정할 수 있음 (최대 10에서 빠짐)
    for (let i = 0; i < 10; i++) expect(w.house.heirlooms.designate(f.clan.id, { kind: 'object', uid: w.host.addObject('candlestick', 1) }, f.dad, 1).ok).toBe(true);
    const offered = new Set<string>();
    for (let d = 0; d < 200; d++) {
      w.host.dayN++;
      for (const x of w.house.heirlooms.daily()) offered.add(x.card);
    }
    expect([...offered].sort()).toEqual(['heirloom_found_at_market', 'heirloom_thief_tracked', 'lost_heirloom_rumor']);
    expect(w.host.log.cards.every((c) => c.p === f.dad.id)).toBe(true);
    // 되찾음: 칸이 가득 차 있으면 가보가 아닌 물건으로 돌아옴 (이력은 남음)
    expect(w.house.heirlooms.recover(h.id, f.children[0])).toBe(true);
    expect(h.status).toBe('released');
    expect(kinds(w, h.id).slice(-2)).toEqual(['lost', 'recovered']);
    expect(w.host.moodletsOf(f.mom)).toContain('heirloom_recovered');
  });

  it('2행 도난 → 되찾음: 가보 칸으로 돌아오고 새 물건으로 집에 놓임', () => {
    const { w, f, uid, h } = withHeirloom();
    w.house.heirlooms.lose(h.id, 'stolen');
    expect(w.house.heirlooms.recover(h.id)).toBe(true);
    expect(h.status).toBe('held');
    expect(h.ref.kind === 'object' && h.ref.uid !== uid && w.host.objects.get(h.ref.uid)?.household === 1).toBe(true);
    expect(w.house.heirlooms.flags(f.dad).has('lost_heirloom')).toBe(false);
  });

  it('2행 하인 도둑질 (16-7): 충성 낮은 하인이 가보를 훔치면 잃어버린 가보 → 되찾기', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { w, f, h } = withHeirloom('anvil', seed);
      w.host.estate.set(1, 'merchant');
      const s = w.house.servants.hire(1, 'maid').servant!;
      const maid = w.host.persons.find((p) => p.id === s.personId)!;
      const ev = w.house.servants.steal(s, maid) as { heirloom?: number; caught?: boolean };
      if (!ev.heirloom) continue;
      expect(ev.heirloom).toBe(h.id);
      expect(h.status).toBe('lost');
      expect(h.lostReason).toBe('stolen');
      expect(h.history.at(-1)).toMatchObject({ kind: 'lost', personId: maid.id, note: 'stolen' });
      expect(w.host.log.cards.some((c) => c.card === (ev.caught ? 'servant_caught_stealing' : 'heirloom_stolen'))).toBe(true);
      expect(f.clan.id).toBeGreaterThan(0);
      return;
    }
    throw new Error('어느 시드에서도 가보 도둑질이 없음');
  });

  it('2행 압류(파산): 값진 가보부터 1개, 되찾기는 경매·장물 / 중죄 몰수: 그 가정 가보 전부, 되찾기는 경매', () => {
    const { w, f, h } = withHeirloom('anvil');
    const cheap = w.house.heirlooms.designate(f.clan.id, { kind: 'object', uid: w.host.addObject('candlestick', 1) }, f.dad, 1).heirloom!;
    const seized = w.house.heirlooms.onSeizure(1);
    expect(seized.map((x) => x.id)).toEqual([h.id]);
    expect(h.lostReason).toBe('seized');
    expect(cheap.status).toBe('held');
    const offered = new Set<string>();
    for (let d = 0; d < 300; d++) {
      w.host.dayN++;
      for (const x of w.house.heirlooms.daily()) offered.add(x.card);
    }
    expect([...offered].sort()).toEqual(['heirloom_auction', 'heirloom_found_at_market']);
    const all = w.house.heirlooms.onConfiscation(1);
    expect(all.map((x) => x.id)).toEqual([cheap.id]);
    expect(cheap.lostReason).toBe('confiscated');
    expect(w.house.heirlooms.held(f.clan.id).length).toBe(0);
  });

  it('3행 지참금: 상대 가문의 가보가 되고 이전 이력 유지 ("○○ 가문에서 온")', () => {
    const { w, f, h } = withHeirloom('lute');
    const other = family(w, 2, [{ name: '신랑' }], 'freeman', 'house.h_millbrook');
    const bride = f.children[0];
    w.house.heirlooms.useObject(h.ref.kind === 'object' ? h.ref.uid : 0, bride, null);
    expect(w.house.heirlooms.dowry(h.id, other.clan.id, 2, f.dad)).toBe(true);
    expect(h.clanId).toBe(other.clan.id);
    expect(h.household).toBe(2);
    expect(h.status).toBe('held');
    expect(w.house.heirlooms.held(f.clan.id)).toEqual([]);
    expect(w.house.heirlooms.held(other.clan.id).map((x) => x.id)).toEqual([h.id]);
    expect(kinds(w, h.id)).toEqual(['made', 'designated', 'used', 'dowry']);
    expect(h.history[0].personId).toBe(f.dad.id);
    expect(w.house.heirlooms.fromClan(h)).toBe(f.clan.id);
    expect(h.history.at(-1)).toMatchObject({ kind: 'dowry', clanId: other.clan.id, otherClanId: f.clan.id });
  });

  it('4행 상속 장자·지명: 가장 계승자가 가보 전부', () => {
    const { w, f, h } = withHeirloom('anvil', 1, [{ name: '첫째', ageDays: 9 }, { name: '둘째', ageDays: 3 }]);
    const h2 = w.house.heirlooms.designate(f.clan.id, { kind: 'object', uid: w.host.addObject('lute', 1) }, f.dad, 1).heirloom!;
    w.house.heirlooms.assignHeir(h2.id, f.children[1]); // 장자상속에서는 무시
    const r = w.house.inheritance.onDeath(f.dad, 'old_age')!;
    w.host.kill(f.dad);
    expect(r.law).toBe('primogeniture');
    expect(r.heirlooms).toEqual([{ heirloom: h.id, to: f.children[0].id }, { heirloom: h2.id, to: f.children[0].id }]);
    expect(h.history.at(-1)).toMatchObject({ kind: 'inherited', personId: f.children[0].id });
    // 지명: 유언장의 가보 받을 사람
    const x = withHeirloom('anvil', 2);
    x.w.house.clans.setLaw(x.f.clan.id, 'will');
    x.f.dad.skills.reading = 3;
    expect(x.w.house.inheritance.writeWill(x.f.dad, { heir: x.f.children[1].id, heirloomsTo: x.f.children[1].id }).ok).toBe(true);
    const r2 = x.w.house.inheritance.onDeath(x.f.dad, 'illness')!;
    expect(r2.heirlooms).toEqual([{ heirloom: x.h.id, to: x.f.children[1].id }]);
  });

  it('5행 상속 균분: 가보는 나누지 않고 가장이 지정한 사람, 지정이 없으면 새 가장', () => {
    const { w, f, h } = withHeirloom('anvil', 1, [{ name: '첫째', ageDays: 9 }, { name: '둘째', ageDays: 3 }, { name: '셋째', ageDays: 1 }]);
    w.house.clans.setLaw(f.clan.id, 'equal');
    const h2 = w.house.heirlooms.designate(f.clan.id, { kind: 'object', uid: w.host.addObject('lute', 1) }, f.dad, 1).heirloom!;
    expect(w.house.heirlooms.assignHeir(h2.id, f.children[2])).toBe(true);
    const r = w.house.inheritance.onDeath(f.dad, 'old_age')!;
    expect(r.newHead).toBe(f.children[0].id);
    expect(r.heirlooms).toContainEqual({ heirloom: h.id, to: f.children[0].id });
    expect(r.heirlooms).toContainEqual({ heirloom: h2.id, to: f.children[2].id });
    // 지정받은 사람이 먼저 죽으면 새 가장
    const y = withHeirloom('anvil', 3, [{ name: '첫째', ageDays: 9 }, { name: '둘째', ageDays: 3 }]);
    y.w.house.clans.setLaw(y.f.clan.id, 'equal');
    y.w.house.heirlooms.assignHeir(y.h.id, y.f.children[1]);
    y.w.house.inheritance.onDeath(y.f.children[1], 'accident');
    y.w.host.kill(y.f.children[1]);
    const r2 = y.w.house.inheritance.onDeath(y.f.dad, 'old_age')!;
    expect(r2.heirlooms).toEqual([{ heirloom: y.h.id, to: y.f.children[0].id }]);
  });

  it('6행 분가: 가져가려면 가장의 허락, 가져간 가보는 같은 가문 가보로 남음', () => {
    const { w, f, h } = withHeirloom();
    const son = f.children[1];
    son.household = 9;
    w.house.clans.onHouseholdSplit(1, 9);
    w.host.setFriend(f.dad, son, 5);
    expect(w.house.heirlooms.takeOnSplit(h.id, son, 9).reason).toBe('refused');
    expect(h.household).toBe(1);
    w.host.setFriend(f.dad, son, 60);
    expect(w.house.heirlooms.takeOnSplit(h.id, son, 9).ok).toBe(true);
    expect(h.household).toBe(9);
    expect(h.clanId).toBe(f.clan.id);
    expect(w.house.heirlooms.held(f.clan.id).map((x) => x.id)).toEqual([h.id]);
    expect(kinds(w, h.id).at(-1)).toBe('split');
    // 조작 가문 가장의 결정 (approved)
    const g = withHeirloom();
    g.f.children[0].household = 8;
    g.w.house.clans.onHouseholdSplit(1, 8);
    expect(g.w.house.heirlooms.takeOnSplit(g.h.id, g.f.children[0], 8, false).ok).toBe(false);
    expect(g.w.house.heirlooms.takeOnSplit(g.h.id, g.f.children[0], 8, true).ok).toBe(true);
    // 다른 가문 가정으로는 못 가져감
    const o = withHeirloom();
    o.w.host.estate.set(20, 'freeman');
    o.w.house.clans.register({ households: [20], name: '남' });
    expect(o.w.house.heirlooms.takeOnSplit(o.h.id, o.f.children[0], 20, true).reason).toBe('other_clan');
  });

  it('7행 되팔기 경매: 판매 규칙(슬픔·명성) 그대로, 이력은 산 쪽 가문으로 이어지고 그 가문이 지정하면 이어 씀', () => {
    const { w, f, h } = withHeirloom();
    const buyer = family(w, 3, [], 'merchant', 'house.h_fenwick');
    expect(w.house.heirlooms.auction(h.id, f.dad, 300, buyer.clan.id, 3)).toBe(true);
    expect(w.host.moodletsOf(f.mom)).toContain('heirloom_sold_grief');
    expect(w.house.clans.fame(f.clan.id)).toBe(270);
    expect(h.clanId).toBe(buyer.clan.id);
    expect(h.status).toBe('released');
    expect(kinds(w, h.id).slice(-2)).toEqual(['sold', 'bought']);
    const again = w.house.heirlooms.designate(buyer.clan.id, h.ref, buyer.dad, 3);
    expect(again.ok).toBe(true);
    expect(again.heirloom!.id).toBe(h.id);
    expect(kinds(w, h.id)).toEqual(['made', 'designated', 'sold', 'bought', 'designated']);
    expect(w.house.heirlooms.fromClan(h)).toBe(f.clan.id);
  });
});

describe('M8 가보 사건 카드 결과 (24-1 heirloom: damage/lose/recover)', () => {
  type Out = { heirloom?: 'damage' | 'lose' | 'recover'; flag?: string };
  const cards = (JSON.parse(readFileSync('src/data/events/family_society.json', 'utf8')) as { cards: { id: string; options: { success: Out; failure?: Out }[] }[] }).cards;

  it('family_society.json 의 heirloom 결과를 가진 모든 선택지를 적용하면 가보 상태가 맞게 바뀜', () => {
    let n = 0;
    for (const c of cards) {
      c.options.forEach((o, i) => {
        for (const out of [o.success, o.failure]) {
          if (!out?.heirloom) continue;
          n++;
          const { w, f, h } = withHeirloom('anvil', 1 + i);
          const other = family(w, 2, [{ name: '상대' }], 'freeman', 'house.h_millbrook');
          const p: Person = f.dad;
          if (out.heirloom === 'recover') w.house.heirlooms.lose(h.id, 'stolen');
          const id = w.house.heirlooms.cardOutcome(p, out.heirloom, { cardId: c.id, flag: out.flag, other: other.children[0] });
          expect(id, `${c.id} o${i}`).toBe(h.id);
          if (out.heirloom === 'damage') expect(h.damaged, `${c.id} o${i}`).toBe(out.flag === 'heirloom_repaired' ? null : 'scorched');
          if (out.heirloom === 'recover') expect(h.status, `${c.id} o${i}`).toBe('held');
          if (out.heirloom === 'lose' && (c.id === 'dowry_short' || out.flag === 'heirloom_as_dowry')) {
            expect(h.clanId, `${c.id} o${i}`).toBe(other.clan.id);
            expect(h.status).toBe('held');
          } else if (out.heirloom === 'lose') {
            expect(h.status, `${c.id} o${i}`).toBe('lost');
            expect(h.lostReason).toBe('stolen');
          }
        }
      });
    }
    expect(n).toBe(16);
  });

  it('가보가 없으면 카드 결과는 아무 일도 안 함', () => {
    const w = fakeWorld();
    const f = family(w, 1, []);
    expect(w.house.heirlooms.cardOutcome(f.dad, 'lose')).toBe(0);
    expect(w.house.heirlooms.cardOutcome(f.dad, 'recover')).toBe(0);
    expect(w.house.heirlooms.cardOutcome(f.dad, 'damage')).toBe(0);
  });
});
