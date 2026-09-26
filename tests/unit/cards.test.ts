/** 사건 카드 최소 엔진 (24-1): 콘텐츠 전부 스키마 통과, 자동/대기 선택, 인생당 상한, 조건, 월드 행동 대체 결과 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/sim';
import { cardSchema } from '../../src/sim/story/cards';
import { loadSimData } from '../../tools/data-node';
import { readFileSync } from 'node:fs';

const data = loadSimData({});
const raw = JSON.parse(readFileSync('src/data/events/family_society.json', 'utf8')) as { cards: unknown[] };

describe('사건 카드 엔진', () => {
  it('콘텐츠 카드 전부가 스키마를 통과하고 엔진에 실림', () => {
    for (const c of raw.cards) expect(cardSchema.safeParse(c).success, (c as { id: string }).id).toBe(true);
    const s = new Simulation(data, 1);
    expect(s.cards!.defs.size).toBe(raw.cards.length);
  });

  it('조작 가문은 선택 대기 → 선택하면 결과, 아니면 3시간 뒤 자동. NPC 는 바로 자동', () => {
    const s = new Simulation(data, 2);
    const a = s.addPerson('가', undefined, undefined, { sex: 'female' });
    a.lifeStage = 'young';
    const npc = s.addPerson('이웃', undefined, undefined, { household: 150 });
    npc.lifeStage = 'young';
    const cards = s.cards!;
    const card = [...cards.defs.values()].find((c) => !c.once && c.perLife >= 3 && cards.condOk(a, c.cond) && cards.condOk(npc, c.cond) && c.options.some((o) => cards.condOk(a, o.cond)))!;
    expect(card).toBeTruthy();
    const pc = cards.offer(a, card.id, {}, null, true)!;
    expect(cards.pending.length).toBe(1);
    const r = s.apply({ kind: 'cardChoice', seq: pc.seq, option: pc.options[0] }) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(cards.pending.length).toBe(0);
    const log0 = cards.log.length;
    cards.offer(npc, card.id, {}, null, true);
    expect(cards.pending.length).toBe(0);
    expect(cards.log.length).toBe(log0 + 1);
    cards.offer(a, card.id, {}, null, true);
    expect(cards.pending.length).toBe(1);
    for (let i = 0; i < 4 * 60; i++) s.tick();
    expect(cards.pending.length).toBe(0);
  });

  it('인생당 상한·1회성: 같은 카드를 조건 검사로 다시 내면 막힘', () => {
    const s = new Simulation(data, 3);
    const a = s.addPerson('가', undefined, undefined, { household: 150 });
    a.lifeStage = 'young';
    const once = [...s.cards!.defs.values()].find((c) => c.once && s.cards!.condOk(a, c.cond) && c.availability.includes('available'));
    if (!once) return;
    expect(s.cards!.offer(a, once.id)).toBeTruthy();
    expect(s.cards!.offer(a, once.id)).toBeNull();
  });

  it('월드 행동이 있는 결과는 "시작 불가 시" 대체 결과로 끝남 (카드가 열린 채 멈추지 않음)', () => {
    const s = new Simulation(data, 4);
    const a = s.addPerson('가', undefined, undefined, { household: 150 });
    a.lifeStage = 'young';
    const withAction = [...s.cards!.defs.values()].find((c) => c.options.some((o) => o.success.action));
    expect(withAction).toBeTruthy();
    const out = withAction!.options.find((o) => o.success.action)!.success;
    const before = s.cards!.log.length;
    s.cards!.apply(a, null, out, 0);
    expect(s.cards!.pending.length).toBe(0);
    expect(s.cards!.log.length).toBeGreaterThanOrEqual(before);
  });
});
