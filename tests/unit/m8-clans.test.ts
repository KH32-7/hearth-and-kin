/**
 * M8 가문 (GDD 16-1, 16-4, 16-6, 16-7): 가문 레지스트리·명성 단계·개인 명예와 특성 배수·평판 4종·교회 평판/민심 감쇠·
 * 가문 보상·가훈·문장·가장·가문명·가계도·가문 간 관계(원수 자율, 동맹 효과)·하인
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clansFrom, heraldryCatalog, TIERS } from '../../src/sim/house/clans';
import { loadSimData } from '../../tools/data-node';
import { family, fakeWorld } from './m8-house-fake';

describe('M8 가문 데이터', () => {
  it('clans.json 이 SimData.family.houses 로 실려 검증됨: 명성 단계 6, 주요 가문 10~15, 관계 5단', () => {
    const data = loadSimData({});
    const d = clansFrom(data.family);
    expect(d).not.toBeNull();
    expect(d!.fame.tiers.map((t) => t.id)).toEqual([...TIERS]);
    expect(d!.relations.major.length).toBeGreaterThanOrEqual(10);
    expect(d!.relations.major.length).toBeLessThanOrEqual(15);
    expect(d!.relations.levels.map((l) => l.id)).toEqual(['ally', 'friendly', 'neutral', 'rival', 'enemy']);
    // 문장 요소 id 가 heraldry.json 에 있음
    const cat = heraldryCatalog(data.family.heraldry)!;
    for (const m of d!.relations.major) {
      if (!m.heraldry) continue;
      expect(cat.shields).toContain(m.heraldry.shield);
      expect(cat.divisions.map((x) => x.id)).toContain(m.heraldry.division);
      if (m.heraldry.charge) expect(cat.charges).toContain(m.heraldry.charge);
    }
    // 가훈 문장·보상 이름·단계 이름이 i18n 에 있음
    const ko = JSON.parse(readFileSync('src/i18n/ko/clans_m8.json', 'utf8')) as Record<string, string>;
    for (const m of d!.relations.major) if (m.motto) expect(ko[m.motto], m.motto).toBeTruthy();
    for (const r of d!.rewards.list) expect(ko[`clan.reward.${r.id}`], r.id).toBeTruthy();
    for (const t of TIERS) expect(ko[`fame.tier.${t}`]).toBeTruthy();
    for (const tag of Object.keys(d!.motto.tags)) expect(ko[`clan.motto.tag.${tag}`]).toBeTruthy();
    // 가훈 소원·무드렛 id 가 실제로 있음
    const wishes = new Set([...JSON.parse(readFileSync('src/data/wishes.json', 'utf8')).wishes, ...JSON.parse(readFileSync('src/data/wishes_m7.json', 'utf8')).wishes].map((w: { id: string }) => w.id));
    for (const list of Object.values(d!.motto.tags)) for (const w of list) expect(wishes.has(w), w).toBe(true);
    const moods = JSON.parse(readFileSync('src/data/moodlets_m7.json', 'utf8')).moodlets as Record<string, unknown>;
    for (const id of [d!.fame.tierUpMoodlet, d!.fame.dishonoredMoodlet, d!.heirlooms.useMoodlet, d!.heirlooms.sellMoodlet, d!.heirlooms.lostMoodlet, d!.heirlooms.recoveredMoodlet, d!.heirlooms.damagedMoodlet, d!.heirlooms.undesignateMoodlet, d!.servants.wellServedMoodlet, d!.servants.theftMoodlet, d!.inheritance.moodlets.newHead, d!.inheritance.moodlets.received, d!.inheritance.moodlets.slighted, d!.relations.allyMoodlet, d!.relations.enemyMoodlet, d!.motto.inspiredMoodlet, d!.names.gotNameMoodlet]) {
      expect(moods[id], id).toBeTruthy();
    }
    // 카드 id 가 사건 카드 데이터에 있음
    const cards = new Set((data.family.events as { cards: { id: string }[] }).cards.map((c) => c.id));
    for (const id of [...d!.heirlooms.recovery.stolen, ...d!.heirlooms.recovery.seized, ...d!.heirlooms.recovery.confiscated, d!.inheritance.dispute.card, d!.servants.caughtCard, d!.servants.stolenCard, d!.servants.romanceCard]) expect(cards.has(id), id).toBe(true);
  });
});

describe('M8 가문 명성과 단계 (16-4)', () => {
  it('경계: 불명예 0~99 / 수상함 100~249 / 평범 250~499 / 존경 500~699 / 명망 700~899 / 전설 900~1000, 0~1000 으로 묶임', () => {
    const { house } = fakeWorld();
    const c = house.clans;
    const cases: [number, string][] = [[0, 'dishonored'], [99, 'dishonored'], [100, 'suspect'], [249, 'suspect'], [250, 'ordinary'], [499, 'ordinary'], [500, 'respected'], [699, 'respected'], [700, 'renowned'], [899, 'renowned'], [900, 'legendary'], [1000, 'legendary']];
    for (const [f, t] of cases) expect(c.tierOf(f), String(f)).toBe(t);
    const w = fakeWorld();
    const { clan } = family(w, 1, []);
    w.house.clans.setFame(clan.id, 5000);
    expect(w.house.clans.fame(clan.id)).toBe(1000);
    w.house.honor.apply(null, clan.id, { fame: -3000 }, 'crime');
    expect(w.house.clans.fame(clan.id)).toBe(0);
  });

  it('마을 가문 등록: 주요 가문 명성·문장·관계, 형편별 시작 명성, 농노는 가문명 없음, 교회는 가문 아님', () => {
    const w = fakeWorld();
    const people = JSON.parse(readFileSync('src/data/town/people.json', 'utf8')) as { households: { id: string; nameKey: string; estate: string; wealth: string; player?: boolean }[] };
    let hh = 100;
    const list = people.households.map((h) => {
      const id = h.player ? 1 : hh++;
      w.host.estate.set(id, h.estate);
      w.host.addPerson(h.id, id, { lifeStage: 'adult' });
      return { household: id, key: h.id, nameKey: h.nameKey, estate: h.estate, wealth: h.wealth };
    });
    w.house.clans.fromTown(list);
    const C = w.house.clans;
    const ash = C.byKey('h_ashford')!;
    expect(ash.fame).toBe(720);
    expect(C.tier(ash.id)).toBe('renowned');
    expect(ash.heraldry?.charge).toBe('tower');
    expect(ash.law).toBe('primogeniture');
    expect(C.relationLevel(ash.id, C.byKey('h_montbray')!.id)).toBe('ally');
    expect(C.relationLevel(C.byKey('h_millbrook')!.id, C.byKey('h_tolbert')!.id)).toBe('enemy');
    expect(C.byKey('h_osric')!.name).toBeNull();
    expect(C.byKey('h_parish')).toBeNull();
    expect(C.byKey('h_monastery')).toBeNull();
    expect(C.byKey('h_selwyn')!.fame).toBe(200); // poor
    expect(C.byKey('h_fletcher')!.fame).toBe(480);
    expect(C.fameOfHousehold(C.byKey('h_croft')!.households[0])).toBe(200);
    const osric = w.host.persons.find((p) => p.name === 'h_osric')!;
    expect(C.flags(osric).has('no_family_name')).toBe(true);
    const ashP = w.host.persons.find((p) => p.name === 'h_ashford')!;
    expect(C.flags(ashP).has('has_ally')).toBe(true);
    expect(C.flags(ashP).has('head_of_house')).toBe(true);
  });

  it('Simulation.fame 대체: 가구 기준 명성 변화 → 같은 가문의 모든 가정이 같은 명성', () => {
    const w = fakeWorld();
    const { clan } = family(w, 1, []);
    w.house.clans.onHouseholdSplit(1, 7);
    w.host.addPerson('분가', 7);
    w.house.honor.addFameHousehold(7, 25, 'feast');
    expect(w.house.clans.fameOfHousehold(1)).toBe(325);
    expect(w.house.clans.fameOfHousehold(7)).toBe(325);
    expect(clan.households).toEqual([1, 7]);
    expect(w.house.clans.fameOfHousehold(999)).toBe(300);
  });

  it('단계가 오르면 가족 fame_proud, 불명예로 떨어지면 dishonored_shame + 알림', () => {
    const w = fakeWorld();
    const { dad, mom, clan } = family(w, 1, [{ name: '아들' }]);
    w.house.clans.setFame(clan.id, 495);
    w.house.honor.apply(dad, null, { fame: 10 }, 'masterpiece');
    expect(w.house.clans.tier(clan.id)).toBe('respected');
    expect(w.host.moodletsOf(mom)).toContain('fame_proud');
    expect(w.host.log.notices.some((n) => n.kind === 'fame_tier')).toBe(true);
    w.house.clans.setFame(clan.id, 105);
    w.house.honor.apply(dad, null, { fame: -10 }, 'crime');
    expect(w.house.clans.tier(clan.id)).toBe('dishonored');
    expect(w.host.moodletsOf(mom)).toContain('dishonored_shame');
  });
});

describe('M8 개인 명예와 평판 4종 (16-4)', () => {
  it('사건이 인물 행동에서 나오면 명성 변화가 개인 명예에 같은 부호로 쌓임 (가문 전체 일이면 없음), −500~500', () => {
    const w = fakeWorld();
    const { dad, mom, clan } = family(w, 1, []);
    w.house.honor.apply(dad, null, { fame: 30 }, 'tourney_placed');
    expect(dad.honor).toBe(30);
    expect(w.house.clans.fame(clan.id)).toBe(330);
    w.house.honor.apply(dad, null, { fame: -45 }, 'crime');
    expect(dad.honor).toBe(-15);
    w.house.honor.apply(null, clan.id, { fame: 20 }, 'feast');
    expect(mom.honor).toBe(0);
    expect(dad.honor).toBe(-15);
    for (let i = 0; i < 20; i++) w.house.honor.apply(dad, null, { fame: -60 }, 'crime');
    expect(dad.honor).toBe(-500);
  });

  it('특성 배수: 기사도(보상) = 개인 명예·가문 명성 감소 절반, 교활함 = 들키면 2배, 정의로움 = 선행 개인 명예 +50%', () => {
    const w = fakeWorld();
    const { dad, mom, clan } = family(w, 1, []);
    dad.counters.set('reward:chivalry', 1);
    w.house.honor.apply(dad, null, { fame: -40 }, 'duel_refused');
    expect(dad.honor).toBe(-20);
    expect(w.house.clans.fame(clan.id)).toBe(280);
    w.house.honor.apply(dad, null, { fame: 40 }, 'feast');
    expect(dad.honor).toBe(20);
    mom.traits.push('cunning');
    w.house.honor.apply(mom, null, { fame: -10 }, 'bad_rumor');
    expect(mom.honor).toBe(-10);
    w.house.honor.event('lie_exposed', mom);
    expect(mom.honor).toBe(-40);
    const w2 = fakeWorld();
    const f2 = family(w2, 1, []);
    f2.dad.traits.push('just');
    w2.house.honor.event('public_good_deed', f2.dad);
    expect(f2.dad.honor).toBe(15);
    expect(w2.house.clans.fame(f2.clan.id)).toBe(310);
  });

  it('카드 결과 스키마 {fame, church, karma, morale}: 불륜 발각 = 명성 −40, 교회 −15, 업보 −10', () => {
    const w = fakeWorld();
    const { dad, clan } = family(w, 1, []);
    const r = w.house.honor.event('affair_exposed', dad)!;
    expect(r.fame).toBe(-40);
    expect(dad.churchRep).toBe(-15);
    expect(dad.karma).toBe(-10);
    expect(w.house.clans.fame(clan.id)).toBe(260);
    w.house.honor.applyFor(dad, { morale: -20, karma: 5, church: 3 }, 'card');
    expect(w.house.honor.morale).toBe(30);
    expect(dad.karma).toBe(-5);
    expect(dad.churchRep).toBe(-12);
    const ev = w.house.honor.events();
    for (const id of ['feast', 'donation', 'church_building', 'masterpiece', 'tourney_placed', 'good_marriage', 'public_good_deed', 'good_rumor']) expect(ev.raise).toContain(id);
    for (const id of ['affair_exposed', 'bastard_known', 'debt_default', 'crime', 'public_shame', 'duel_refused', 'sumptuary_violation', 'bad_rumor', 'shabby_living', 'treasury_misuse']) expect(ev.lower).toContain(id);
  });

  it('교회 평판은 0 쪽으로 하루 0.5 (수명 배수 2 이면 0.25), 민심은 50 쪽으로 하루 1', () => {
    const w = fakeWorld();
    const { dad, mom } = family(w, 1, []);
    dad.churchRep = 10;
    mom.churchRep = -10;
    w.house.honor.morale = 60;
    w.house.honor.daily();
    expect(dad.churchRep).toBe(9.5);
    expect(mom.churchRep).toBe(-9.5);
    expect(w.house.honor.morale).toBe(59);
    w.host.lifespanN = 2;
    w.house.honor.daily();
    expect(dad.churchRep).toBe(9.25);
    dad.churchRep = 0.2;
    w.house.honor.daily();
    expect(dad.churchRep).toBe(0);
    w.house.honor.morale = 49.5;
    w.house.honor.daily();
    expect(w.house.honor.morale).toBe(50);
  });

  it('개인 명예 칭호, 원수 명예 절반 (인생 목표 복수)', () => {
    const w = fakeWorld();
    const { dad } = family(w, 1, []);
    dad.honor = 350;
    expect(w.house.honor.title(dad)).toBe('honor.title.honored');
    dad.honor = 0;
    expect(w.house.honor.title(dad)).toBeNull();
    dad.honor = -400;
    expect(w.house.honor.title(dad)).toBe('honor.title.disgraced');
    dad.honor = 300;
    expect(w.house.honor.halveHonor(dad)).toBe(true);
    expect(dad.honor).toBe(150);
  });
});

describe('M8 가문 보상·가훈·문장·가장·가문명 (16-1)', () => {
  it('가문 보상: "대장장이 명가" = 존경 이상 + 대장일 5 → 가족 전원 공예 분류 경험치 ×1.1', () => {
    const w = fakeWorld();
    const { dad, mom, clan } = family(w, 1, []);
    dad.skills.smithing = 5;
    expect(w.house.clans.activeRewards(clan.id)).not.toContain('smith_house');
    expect(w.house.clans.skillXpMult(mom, 'carpentry')).toBe(1);
    w.house.clans.setFame(clan.id, 520);
    expect(w.house.clans.activeRewards(clan.id)).toContain('smith_house');
    expect(w.house.clans.skillXpMult(mom, 'carpentry')).toBeCloseTo(1.1);
    expect(w.house.clans.skillXpMult(mom, 'smithing')).toBeCloseTo(1.1);
    expect(w.house.clans.skillXpMult(mom, 'music')).toBe(1);
    expect(w.house.clans.loanRateMult(1)).toBeCloseTo(0.9);
    w.house.clans.setFame(clan.id, 50);
    expect(w.house.clans.activeRewards(clan.id)).toEqual(['shunned']);
    expect(w.house.clans.loanRateMult(1)).toBeCloseTo(1.5);
  });

  it('가훈: 20자, 태그 2개까지. 태그의 소원이 가족에게 가끔 생기고 이루면 motto_inspired', () => {
    const w = fakeWorld();
    const { dad, clan } = family(w, 1, [{ name: '아기', stage: 'baby' }]);
    const C = w.house.clans;
    expect(C.setMotto(clan.id, '가'.repeat(21), ['faith']).ok).toBe(false);
    expect(C.setMotto(clan.id, '믿음', ['faith', 'labor', 'family']).reason).toBe('too_many_tags');
    expect(C.setMotto(clan.id, '믿음', ['nope']).reason).toBe('unknown_tag');
    expect(C.setMotto(clan.id, '기도하고 일하라', ['faith', 'labor']).ok).toBe(true);
    expect(C.flags(dad).has('has_motto')).toBe(true);
    let n = 0;
    for (let d = 0; d < 60; d++) n += C.dailyMotto();
    expect(n).toBeGreaterThan(5);
    const pool = new Set([...C.d.motto.tags.faith, ...C.d.motto.tags.labor]);
    for (const x of w.host.log.wishes) expect(pool.has(x.id)).toBe(true);
    // 아기에게는 소원이 가지 않음
    const baby = w.host.persons.find((p) => p.name === '아기')!;
    expect(w.host.log.wishes.some((x) => x.p === baby.id)).toBe(false);
    const got = w.host.log.wishes.find((x) => x.p === dad.id)!;
    expect(C.onWishDone(dad, got.id)).toBe(true);
    expect(w.host.moodletsOf(dad)).toContain('motto_inspired');
    expect(C.onWishDone(dad, 'wish_nap')).toBe(false);
  });

  it('문장: heraldry.json 에 없는 요소는 거절, 금속 위 금속은 경고만', () => {
    const w = fakeWorld();
    const { clan } = family(w, 1, []);
    const cat = heraldryCatalog(JSON.parse(readFileSync('src/data/heraldry.json', 'utf8')))!;
    expect(w.house.clans.setHeraldry(clan.id, { shield: 'heater', division: 'plain', tinctures: ['azure', 'azure'], charge: 'dragon', chargeTincture: 'or' }, cat).ok).toBe(false);
    const r = w.house.clans.setHeraldry(clan.id, { shield: 'heater', division: 'plain', tinctures: ['argent', 'argent'], charge: 'lion', chargeTincture: 'or' }, cat);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual(['metal_on_metal']);
    expect(clan.heraldry?.charge).toBe('lion');
    expect(w.house.clans.setHeraldry(clan.id, { shield: 'heater', division: 'plain', tinctures: ['azure', 'azure'], charge: 'lion', chargeTincture: 'or' }, cat).warnings).toEqual([]);
  });

  it('가장은 살아 있는 가문 사람만 (죽은 사람·유령·하인·다른 가문 불가)', () => {
    const w = fakeWorld();
    const { dad, mom, children, clan } = family(w, 1, [{ name: '아들' }]);
    expect(clan.headId).toBe(dad.id);
    const other = w.host.addPerson('남', 2);
    expect(w.house.clans.setHead(clan.id, other)).toBe(false);
    w.host.kill(mom);
    expect(w.house.clans.setHead(clan.id, mom)).toBe(false);
    children[0].status = 'ghost';
    expect(w.house.clans.setHead(clan.id, children[0])).toBe(false);
    w.host.estate.set(1, 'merchant');
    const s = w.house.servants.hire(1, 'maid')!.servant!;
    const maid = w.host.persons.find((p) => p.id === s.personId)!;
    expect(w.house.clans.setHead(clan.id, maid)).toBe(false);
    expect(w.house.clans.members(clan.id)).not.toContain(maid);
    children[0].status = 'available';
    expect(w.house.clans.setHead(clan.id, children[0])).toBe(true);
  });

  it('농노 → 가문명 얻기: 가족 got_family_name, 연대기, no_family_name 플래그가 사라짐', () => {
    const w = fakeWorld();
    const { dad, mom, clan } = family(w, 1, [], 'serf', 'house.h_osric');
    expect(clan.name).toBeNull();
    expect(w.house.clans.flags(dad).has('no_family_name')).toBe(true);
    expect(w.house.clans.grantFamilyName(clan.id, '밀러')).toBe(true);
    expect(clan.name).toBe('밀러');
    expect(w.host.moodletsOf(mom)).toContain('got_family_name');
    expect(w.host.log.chronicle.some((c) => c.trigger === 'family_name')).toBe(true);
    expect(w.house.clans.flags(dad).has('no_family_name')).toBe(false);
  });

  it('상속법: 귀족·기사는 영지 법(장자)으로 고정, 그 밖은 선택', () => {
    const w = fakeWorld();
    const f = family(w, 1, []);
    expect(w.house.clans.setLaw(f.clan.id, 'equal').ok).toBe(true);
    expect(f.clan.law).toBe('equal');
    const w2 = fakeWorld();
    const n = family(w2, 1, [], 'noble', 'house.h_ashford');
    expect(n.clan.law).toBe('primogeniture');
    expect(w2.house.clans.setLaw(n.clan.id, 'equal').reason).toBe('estate_law');
  });

  it('가계도 5대: 초점에서 위로 4대 조상, 그 자손, 배우자, 죽은 사람(생몰·사인·명예 기록), 더 윗대는 펼쳐 보기', () => {
    const w = fakeWorld();
    const { host, house } = w;
    host.estate.set(1, 'freeman');
    // 6대 직계: g0 → g5
    const chain = [];
    let parent = 0;
    for (let g = 0; g < 6; g++) {
      const p = host.addPerson(`g${g}`, 1, { sex: 'male', lifeStage: 'adult', father: parent });
      const wife = host.addPerson(`w${g}`, 1, { sex: 'female', spouse: p.id });
      p.spouse = wife.id;
      chain.push(p);
      parent = p.id;
    }
    const clan = house.clans.register({ households: [1], name: '헤이우드' });
    host.addPerson('고모', 1, { sex: 'female', father: chain[2].id });
    for (const p of host.persons) house.clans.onBirth(p);
    host.dayN = 40;
    for (const g of [0, 1, 2]) {
      chain[g].honor = 77;
      house.inheritance.onDeath(chain[g], 'old_age');
      host.kill(chain[g]);
    }
    const tree = house.clans.familyTree(chain[5].id);
    const gens = new Set(tree.map((n) => n.generation));
    expect(gens.size).toBe(5);
    const top = tree.filter((n) => n.generation === 0);
    expect(top.map((n) => n.name)).toContain('g1');
    expect(top.find((n) => n.name === 'g1')!.hasOlder).toBe(true);
    expect(top.find((n) => n.name === 'g1')!.alive).toBe(false);
    expect(top.find((n) => n.name === 'g1')!.cause).toBe('old_age');
    expect(top.find((n) => n.name === 'g1')!.deathDay).toBe(40);
    expect(top.find((n) => n.name === 'g1')!.honor).toBe(77);
    expect(tree.some((n) => n.name === 'w1')).toBe(true);
    expect(tree.some((n) => n.name === '고모' && n.generation === 2)).toBe(true);
    expect(tree.some((n) => n.name === 'g0')).toBe(false);
    expect(clan.id).toBeGreaterThan(0);
  });
});

describe('M8 가문 간 관계 (16-6)', () => {
  function two() {
    const w = fakeWorld(7);
    const a = family(w, 1, [{ name: '아들' }]);
    const b = family(w, 2, [{ name: '딸', sex: 'female' }], 'freeman', 'house.h_millbrook');
    return { w, a, b };
  }

  it('혼인 → 동맹 (양가 기쁨 무드렛, 연대기), 원한·추문 → 원수 (분노 무드렛)', () => {
    const { w, a, b } = two();
    const C = w.house.clans;
    expect(C.relationLevel(a.clan.id, b.clan.id)).toBe('neutral');
    C.onMarriage(a.children[0], b.children[0]);
    expect(C.relationLevel(a.clan.id, b.clan.id)).toBe('ally');
    expect(w.host.moodletsOf(b.dad)).toContain('clan_alliance_joy');
    expect(w.host.log.chronicle.some((c) => c.trigger === 'clan_alliance')).toBe(true);
    expect(C.flags(a.dad).has('has_ally')).toBe(true);
    for (let i = 0; i < 6; i++) C.onGrudge(a.dad, b.dad);
    expect(C.relationLevel(a.clan.id, b.clan.id)).toBe('enemy');
    expect(w.host.moodletsOf(a.mom)).toContain('clan_enemy_anger');
    expect(C.flags(a.dad).has('has_feud')).toBe(true);
    C.setRelationLevel(a.clan.id, b.clan.id, 'neutral');
    C.onScandal(a.dad, b.mom);
    C.onScandal(a.dad, b.mom);
    expect(C.relationLevel(a.clan.id, b.clan.id)).toBe('rival');
  });

  it('원수 자율: 험담(소문)·거래 거부·혼사 방해·고발이 일어나고 조회 함수에 반영', () => {
    const { w, a, b } = two();
    const C = w.house.clans;
    C.setRelationLevel(a.clan.id, b.clan.id, 'enemy');
    const kinds = new Set<string>();
    for (let d = 0; d < 400; d++) {
      w.host.dayN = 100 + d;
      for (const x of C.enemyDaily()) kinds.add(x.kind);
    }
    expect([...kinds].sort()).toEqual(['accuse', 'block_match', 'gossip', 'refuse_trade']);
    expect(w.host.log.rumors.some((r) => r.kind === 'slander')).toBe(true);
    expect(w.host.log.accused.length).toBeGreaterThan(0);
    // 지금 막 일어난 거래 거부
    C.setRelationLevel(a.clan.id, b.clan.id, 'enemy');
    let banned = false;
    for (let d = 0; d < 200 && !banned; d++) {
      w.host.dayN = 1000 + d;
      banned = C.enemyDaily().some((x) => x.kind === 'refuse_trade') && C.refusesTrade(1, 2);
    }
    expect(banned).toBe(true);
    expect(C.matchModifier(1, 2)).toBeLessThan(0);
  });

  it('동맹 효과: 혼사 우대, 빚 보증, 잔치 참석, 어려울 때 도움 (돈이 옴)', () => {
    const { w, a, b } = two();
    const C = w.house.clans;
    C.setRelationLevel(a.clan.id, b.clan.id, 'ally');
    expect(C.matchModifier(1, 2)).toBeGreaterThan(0);
    w.host.moneyOf.set(2, 900);
    expect(C.guarantor(a.clan.id, 400)).toBe(b.clan.id);
    expect(C.guarantor(a.clan.id, 800)).toBe(0); // 보증 한도 0.5S = 500
    expect(C.feastGuests(a.clan.id).map((p) => p.id)).toContain(b.dad.id);
    let got = 0;
    for (let d = 0; d < 60; d++) {
      w.host.dayN = 200 + d;
      got += C.allyHelpDaily((cid) => cid === a.clan.id).length;
    }
    expect(got).toBeGreaterThan(0);
    expect(w.host.moneyOf.get(1)).toBe(got * 50);
    expect(w.host.log.notices.some((n) => n.kind === 'clan_ally_help')).toBe(true);
  });
});

describe('M8 하인 (16-7)', () => {
  it('상인 이상만 고용, 역할 6, 가정 인원 상한 12 에 포함, 가문 사람 아님', () => {
    const w = fakeWorld();
    const f = family(w, 1, [{ name: '아들' }]);
    expect(w.house.servants.canHire(1).reason).toBe('estate');
    w.host.estate.set(1, 'merchant');
    for (const r of ['maid', 'cook', 'nurse', 'groom', 'steward', 'guard'] as const) expect(w.house.servants.hire(1, r).ok, r).toBe(true);
    expect(w.host.persons.filter((p) => p.household === 1).length).toBe(9);
    for (let i = 0; i < 3; i++) expect(w.house.servants.hire(1, 'maid').ok).toBe(true);
    expect(w.house.servants.hire(1, 'maid').reason).toBe('household_full');
    expect(w.house.clans.members(f.clan.id).length).toBe(3);
    expect(w.house.servants.flags(f.dad).has('has_servant')).toBe(true);
  });

  it('담당 일 자율 배수, 유모·마부 담당, 하인 제복 = 주인 신분 (사치 금지법 예외 입력)', () => {
    const w = fakeWorld();
    family(w, 1, [], 'knight', 'house.h_montbray');
    const S = w.house.servants;
    const hired = (['maid', 'nurse', 'groom'] as const).map((r) => S.hire(1, r).servant!.personId);
    const [maid, nurse, groom] = hired.map((id) => w.host.persons.find((p) => p.id === id)!);
    expect(S.autonomyMult(maid, ['clean'])).toBe(3);
    expect(S.autonomyMult(maid, ['cook'])).toBe(1);
    expect(S.caresForBabies(nurse)).toBe(true);
    expect(S.caresForHorses(groom)).toBe(true);
    expect(S.caresForBabies(maid)).toBe(false);
    expect(S.livery(maid)).toEqual({ masterEstate: 'knight' });
  });

  it('주급(7일): 주면 충성 +, 못 주면 충성 −; 충성 높은 하인은 가족에게 well_served', () => {
    const w = fakeWorld();
    const f = family(w, 1, []);
    w.host.estate.set(1, 'merchant');
    const s = w.house.servants.hire(1, 'cook').servant!;
    w.host.moneyOf.set(1, 100);
    w.host.setFriend(w.host.persons.find((p) => p.id === s.personId)!, f.dad, 20);
    w.host.setFriend(w.host.persons.find((p) => p.id === s.personId)!, f.mom, 20);
    w.host.dayN += 7;
    const ev = w.house.servants.daily();
    expect(ev.find((e) => e.kind === 'paid')).toMatchObject({ amount: 21 });
    expect(w.host.moneyOf.get(1)).toBe(79);
    expect(w.host.moodletsOf(f.mom)).toContain('well_served');
    w.host.moneyOf.set(1, 0);
    const before = s.loyalty;
    w.host.dayN += 7;
    expect(w.house.servants.daily().some((e) => e.kind === 'unpaid')).toBe(true);
    expect(s.loyalty).toBeLessThan(before - 10);
    expect(s.unpaidWeeks).toBe(1);
  });

  it('충성이 낮으면 도둑질·소문 유출, 아주 낮으면 그만둠', () => {
    const w = fakeWorld(3);
    const f = family(w, 1, []);
    w.host.estate.set(1, 'merchant');
    w.host.moneyOf.set(1, 5000);
    const s = w.house.servants.hire(1, 'maid').servant!;
    const maid = w.host.persons.find((p) => p.id === s.personId)!;
    w.host.setFriend(maid, f.dad, -40);
    w.host.setFriend(maid, f.mom, -40);
    const kinds = new Set<string>();
    for (let d = 0; d < 300 && w.house.servants.get(maid); d++) {
      s.loyalty = 15;
      w.host.dayN++;
      for (const e of w.house.servants.daily()) kinds.add(e.kind);
    }
    expect(kinds.has('theft')).toBe(true);
    expect(kinds.has('leak')).toBe(true);
    expect(w.host.log.cards.some((c) => c.card === 'servant_caught_stealing' && c.other === maid.id)).toBe(true);
    s.loyalty = 5;
    w.host.dayN++;
    expect(w.house.servants.daily().some((e) => e.kind === 'quit')).toBe(true);
    expect(w.house.servants.get(maid)).toBeNull();
  });

  it('하인과 주인 가족의 로맨스 = 추문 카드 + 명성 하락 (한 쌍에 한 번)', () => {
    const w = fakeWorld();
    const f = family(w, 1, [{ name: '아들' }]);
    w.host.estate.set(1, 'merchant');
    const s = w.house.servants.hire(1, 'maid').servant!;
    const maid = w.host.persons.find((p) => p.id === s.personId)!;
    expect(w.house.servants.checkRomance(maid, f.children[0], 20)).toBe(false);
    expect(w.house.servants.checkRomance(maid, f.children[0], 55)).toBe(true);
    expect(w.host.log.cards.at(-1)).toMatchObject({ card: 'servant_romance_scandal', p: f.children[0].id, other: maid.id });
    expect(w.house.clans.fame(f.clan.id)).toBe(285);
    expect(f.children[0].honor).toBe(-15);
    expect(w.house.servants.checkRomance(maid, f.children[0], 80)).toBe(false);
    expect(w.house.servants.flags(f.children[0]).has('servant_romance')).toBe(true);
  });
});
