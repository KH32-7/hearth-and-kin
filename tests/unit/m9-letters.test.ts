/**
 * M9 편지 (GDD 14-7): 가짜 Host 로 순수 테스트. 하루 뒤 도착, 문맹 대필·대독 비용, 말투(register), 문장 틀 조합,
 * 효과(무드렛·관계·훅), 먼 친척 답장, NPC 는 받자마자 읽음, 결정론
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/core/rng';
import { Person } from '../../src/sim/people/person';
import { Letters, parseLetterRules, parseLetterTemplates, type Letter, type LettersHost } from '../../src/sim/society/letters';

const rules = parseLetterRules(JSON.parse(readFileSync('src/data/courtship.json', 'utf8')));
const tpl = parseLetterTemplates(JSON.parse(readFileSync('src/data/letters.json', 'utf8')));
const ko: Record<string, string> = Object.assign({}, ...readdirSync('src/i18n/ko').filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`src/i18n/ko/${f}`, 'utf8'))));

function world(seed = 5) {
  let pid = 0;
  const persons: Person[] = [];
  const money = new Map<number, number>();
  const log = {
    moodlets: [] as { p: number; id: string }[],
    notices: [] as { p: number; kind: string }[],
    rel: [] as { a: number; b: number; friendship?: number; romance?: number }[],
    match: [] as { letter: Letter; reader: number }[],
    petition: [] as number[],
    threat: [] as number[],
    events: [] as string[],
  };
  const opt = { scribe: true };
  const host: LettersHost & { dayN: number } = {
    persons,
    rng: new Rng(seed),
    dayN: 3,
    day: () => host.dayN,
    lifespan: () => 1,
    skillLevel: (p, sk) => p.skills[sk] ?? 0,
    money: (hh) => money.get(hh) ?? 0,
    spend: (hh, n) => {
      const m = money.get(hh) ?? 0;
      if (m < n) return false;
      money.set(hh, m - n);
      return true;
    },
    moodlet: (p, id) => void log.moodlets.push({ p: p.id, id }),
    notice: (p, kind) => void log.notices.push({ p: p.id, kind }),
    relation: (a, b, d) => void log.rel.push({ a: a.id, b: b.id, ...d }),
    houseName: (hh) => `가문${hh}`,
    controlled: (hh) => hh === 1,
    scribeAvailable: () => opt.scribe,
    event: (_p, id) => void log.events.push(id),
    onMatchLetter: (L, _w, r) => void log.match.push({ letter: L, reader: r.id }),
    petition: (_w, r) => void log.petition.push(r.id),
    onThreat: (_w, r) => void log.threat.push(r.id),
  };
  const add = (name: string, hh: number, estate = 'freeman', reading = 0): Person => {
    const p = new Person(++pid, name, 0, 0);
    p.household = hh;
    p.lifeStage = 'adult';
    p.estate = estate;
    if (reading) p.skills.reading = reading;
    persons.push(p);
    return p;
  };
  const letters = new Letters(host, rules, tpl);
  return { host, persons, money, log, opt, add, letters };
}

describe('M9 편지 (14-7)', () => {
  it('글을 알면 전령 삯만 내고, 편지는 하루 뒤 도착해 편지함에 들어감. 읽으면 효과', () => {
    const w = world();
    const a = w.add('글 아는 사람', 1, 'freeman', 2);
    const b = w.add('친척', 1, 'freeman', 1);
    const far = w.add('이웃', 2, 'freeman', 1);
    w.money.set(1, 10);
    const r = w.letters.send(a.id, far.id, 'kin_greeting');
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(rules.messengerFee);
    expect(w.money.get(1)).toBe(10 - rules.messengerFee);
    // 오늘은 도착하지 않음
    w.letters.daily();
    expect(w.letters.inbox(far.id)).toHaveLength(0);
    w.host.dayN++;
    w.letters.daily();
    expect(w.letters.inbox(far.id)).toHaveLength(1);
    // NPC 는 받자마자 읽음: 효과
    expect(w.letters.inbox(far.id)[0].read).toBe(true);
    expect(w.log.moodlets).toContainEqual({ p: far.id, id: 'letter_joy' });
    expect(w.log.rel).toContainEqual({ a: far.id, b: a.id, friendship: 3 });
    // 조작 가문이 받는 편지: 알림 + 안 읽음 → 읽기
    w.money.set(2, 10);
    const r2 = w.letters.send(far.id, b.id, 'love');
    expect(r2.ok).toBe(true);
    w.host.dayN++;
    w.letters.daily();
    expect(w.log.notices).toContainEqual({ p: b.id, kind: 'letter_arrived' });
    expect(w.letters.unread(b.id)).toBe(1);
    expect(w.letters.gates().has_unread_letter(b, null)).toBe(true);
    const rd = w.letters.read(b.id, r2.letterId!);
    expect(rd.ok).toBe(true);
    expect(rd.cost).toBe(0);
    expect(w.log.moodlets).toContainEqual({ p: b.id, id: 'love_letter_flutter' });
    expect(w.log.rel).toContainEqual({ a: b.id, b: far.id, friendship: 1, romance: 4 });
    expect(w.letters.unread(b.id)).toBe(0);
    expect(w.log.events).toContain('letter');
    // 다른 사람 편지는 못 읽음
    expect(w.letters.read(a.id, r2.letterId!).reason).toBe('reason.letter.not_recipient');
  });

  it('문맹: 대필 삯 + 전령 삯, 돈이 없거나 서기가 없으면 못 보냄. 읽을 때 대독 삯', () => {
    const w = world();
    const a = w.add('문맹', 1);
    const b = w.add('받는 이', 1);
    const n = w.add('이웃', 2, 'freeman', 1);
    w.money.set(1, 2);
    expect(w.letters.literate(a)).toBe(false);
    expect(w.letters.sendCost(a)).toBe(rules.scribeFee + rules.messengerFee);
    expect(w.letters.send(a.id, n.id, 'invitation').reason).toBe('reason.letter.money');
    w.money.set(1, 50);
    w.opt.scribe = false;
    expect(w.letters.send(a.id, n.id, 'invitation').reason).toBe('reason.letter.no_scribe');
    w.opt.scribe = true;
    const r = w.letters.send(a.id, n.id, 'invitation');
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(rules.scribeFee + rules.messengerFee);
    expect(w.money.get(1)).toBe(50 - rules.scribeFee - rules.messengerFee);
    expect(w.letters.state.letters[0].scribe).toBe(true);
    // 대독
    w.money.set(2, 10);
    const r2 = w.letters.send(n.id, b.id, 'kin_greeting');
    w.host.dayN++;
    w.letters.daily();
    const before = w.money.get(1)!;
    const rd = w.letters.read(b.id, r2.letterId!);
    expect(rd.ok).toBe(true);
    expect(rd.cost).toBe(rules.readerFee);
    expect(w.money.get(1)).toBe(before - rules.readerFee);
    // 두 번째 읽을 때는 삯 없음
    expect(w.letters.read(b.id, r2.letterId!).cost).toBe(0);
    // 아이는 못 씀
    const kid = w.add('아이', 1, 'freeman', 3);
    kid.lifeStage = 'child';
    expect(w.letters.send(kid.id, n.id, 'kin_greeting').reason).toBe('reason.letter.too_young');
    expect(w.letters.send(a.id, n.id, 'nonsense').reason).toBe('reason.letter.unknown_kind');
  });

  it('말투와 문장 틀: 낮은 쪽이 높은 쪽에게 up, 없는 register 는 가까운 것, 열기 + 본문 1~2 + 맺음, 키가 모두 있음', () => {
    const w = world();
    const L = w.letters;
    expect(L.register('kin_greeting', 'serf', 'noble')).toBe('up');
    expect(L.register('kin_greeting', 'noble', 'serf')).toBe('down');
    expect(L.register('kin_greeting', 'freeman', 'freeman')).toBe('equal');
    expect(L.register('love', 'noble', 'serf')).toBe('equal');
    expect(L.register('petition', 'noble', 'serf')).toBe('up');
    expect(L.register('threat', 'serf', 'noble')).toBe('any');
    for (const kind of Object.keys(tpl.kinds)) {
      for (const reg of Object.keys(tpl.kinds[kind].registers)) {
        for (let i = 0; i < 5; i++) {
          const parts = L.compose(kind, reg);
          expect(parts.length).toBeGreaterThanOrEqual(3);
          expect(parts.length).toBeLessThanOrEqual(4);
          expect(new Set(parts).size).toBe(parts.length);
          for (const k of parts) expect(ko[k], k).toBeTruthy();
        }
      }
      expect(ko[tpl.kinds[kind].nameKey]).toBeTruthy();
    }
    const a = w.add('농노', 1, 'serf', 1);
    const n = w.add('귀족', 2, 'noble', 1);
    w.money.set(1, 9);
    const r = L.send(a.id, n.id, 'petition', { about: a.id });
    const letter = L.state.letters.find((x) => x.id === r.letterId)!;
    expect(letter.register).toBe('up');
    expect(letter.vars).toEqual({ reader: '귀족', writer: '농노', house: '가문1', name: '농노' });
  });

  it('효과 훅: 중매 편지 → 구애 모듈, 청원서 → 청원, 협박장 → 공포', () => {
    const w = world();
    const a = w.add('가장', 2, 'freeman', 1);
    const b = w.add('다른 가장', 3, 'freeman', 1);
    for (const kind of ['matchmaking', 'petition', 'threat']) w.letters.sendFree(a, b, kind, a);
    w.host.dayN++;
    w.letters.daily();
    expect(w.log.match).toHaveLength(1);
    expect(w.log.match[0].letter.about).toBe(a.id);
    expect(w.log.petition).toEqual([b.id]);
    expect(w.log.threat).toEqual([b.id]);
    expect(w.log.moodlets).toContainEqual({ p: b.id, id: 'threat_letter_fear' });
  });

  it('먼 친척: 떠난 식구에게 편지를 보내면 며칠 뒤 답장이 옴 (flags kin_far_away, can_read)', () => {
    const w = world();
    const a = w.add('글 아는 사람', 1, 'freeman', 1);
    w.money.set(1, 10);
    w.letters.addFarKin(1, '먼 곳의 삼촌');
    expect(w.letters.flags(a)).toEqual(['can_read', 'kin_far_away']);
    expect(w.letters.gates().can_write_letter(a, null)).toBe(true);
    const r = w.letters.onInteraction(a, 'table.write_letter');
    expect(r?.ok).toBe(true);
    let got = -1;
    for (let d = 1; d <= 6 && got < 0; d++) {
      w.host.dayN++;
      w.letters.daily();
      if (w.letters.inbox(a.id).length) got = d;
    }
    expect(got).toBeGreaterThanOrEqual(1 + rules.farReplyDays[0]);
    expect(got).toBeLessThanOrEqual(1 + rules.farReplyDays[1]);
    const L = w.letters.inbox(a.id)[0];
    expect(L.fromName).toBe('먼 곳의 삼촌');
    expect(w.letters.onInteraction(a, 'table.read_letters')?.ok).toBe(true);
    expect(w.log.moodlets).toContainEqual({ p: a.id, id: 'letter_joy' });
  });

  it('결정론: 같은 시드 같은 편지', () => {
    const run = () => {
      const w = world(9);
      const ps = [w.add('가', 1, 'serf', 1), w.add('나', 2, 'knight', 1), w.add('다', 3, 'merchant'), w.add('라', 4, 'noble', 2)];
      for (const p of ps) w.money.set(p.household, 100);
      for (let d = 0; d < 6; d++) {
        for (const p of ps) for (const q of ps) if (p !== q) w.letters.send(p.id, q.id, ['kin_greeting', 'invitation', 'love', 'threat'][(p.id + q.id + d) % 4]);
        w.host.dayN++;
        w.letters.daily();
      }
      const parts: (string | number)[] = [];
      w.letters.hashParts(parts);
      return parts.join('|');
    };
    expect(run()).toBe(run());
  });
});
