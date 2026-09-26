/**
 * M9 소문 네트워크 (GDD 14-6): 장소 접촉 전파, 주인공 가문 규칙, 자기 소문 전해 듣기, 효과, 대응 (해명·따지기·공개 참회), 덮기/잊힘
 */
import { describe, expect, it } from 'vitest';
import { loadSimData } from '../../tools/data-node';
import { Simulation } from '../../src/sim/sim';
import type { Person } from '../../src/sim/people/person';

const data = loadSimData({ town: 'ashford' });
const town = (seed = 1) => new Simulation(data, seed);
const adults = (sim: Simulation, f: (p: Person) => boolean = () => true) => sim.persons.filter((p) => (p.lifeStage === 'adult' || p.lifeStage === 'young') && !p.infant && f(p));
/** 며칠 사이 혼인으로 가구를 옮기지 않을 사람 (이미 기혼) */
const settled = (sim: Simulation, f: (p: Person) => boolean = () => true) => adults(sim, (p) => !!p.spouse && f(p));

describe('M9 소문 네트워크', () => {
  it('주인공 가문 식구만 아는 나쁜 소문은 퍼지지 않음 (가문이 스스로 퍼뜨리지 않음)', () => {
    const sim = town(3);
    sim.apply({ kind: 'forceLod', lod: 'summary' });
    const subj = settled(sim, (p) => p.household !== 1)[0];
    const fam = sim.persons.filter((q) => q.household === subj.household);
    const r = sim.rumors!.add('affair', [subj], { a: subj.name }, sim.world.day(), 1, fam);
    for (let i = 0; i < 3 * 1440; i++) sim.tick();
    expect([...r.knownBy].every((id) => fam.some((q) => q.id === id))).toBe(true);
  });

  it('좋은 소문은 가문도 자랑하며 퍼뜨림', () => {
    const sim = town(3);
    sim.apply({ kind: 'forceLod', lod: 'summary' });
    const subj = adults(sim, (p) => p.household !== 1)[0];
    const fam = sim.persons.filter((q) => q.household === subj.household);
    const r = sim.rumors!.add('masterpiece', [subj], { a: subj.name }, sim.world.day(), 1, fam);
    for (let i = 0; i < 4 * 1440; i++) sim.tick();
    expect(r.knownBy.size).toBeGreaterThan(fam.length);
  });

  it('들은 사람은 대상에 대한 존중이 내려가고, 퍼짐 문턱을 넘으면 가문 명성이 깎임', () => {
    const sim = town(2);
    sim.apply({ kind: 'forceLod', lod: 'summary' });
    const subj = settled(sim, (p) => p.household !== 1)[0];
    const wit = adults(sim, (p) => p.household !== subj.household && p.household !== 1).slice(0, 3);
    const fame0 = sim.fame.get(subj.household) ?? 0;
    const r = sim.rumors!.add('theft', [subj], { a: subj.name }, sim.world.day(), 1.5, [subj, ...wit]);
    for (let i = 0; i < 8 * 1440; i++) sim.tick();
    const heard = [...r.knownBy].map((id) => sim.persons.find((q) => q.id === id)).filter((q): q is Person => !!q && q.household !== subj.household);
    expect(heard.length).toBeGreaterThan(10);
    heard.splice(0, heard.length, ...heard.filter((q) => !wit.includes(q)));
    const avg = heard.reduce((a, q) => a + sim.rel.respect(q.id, subj.id), 0) / heard.length;
    expect(avg).toBeLessThan(0);
    expect(r.reached).toBeGreaterThanOrEqual(1);
    expect(sim.fame.get(r.household) ?? 0).toBeLessThan(fame0);
  }, 30000);

  it('자기 가문 소문은 누군가 전해 줘야 앎 (aware), 전해 들으면 알림', () => {
    const sim = town(4);
    sim.apply({ kind: 'forceLod', lod: 'summary' });
    const subj = adults(sim, (p) => p.household === 1)[0];
    const wit = adults(sim, (p) => p.household !== 1).slice(0, 4);
    const r = sim.rumors!.add('drunkard', [subj], { a: subj.name }, sim.world.day(), 1.5, [subj, ...wit]);
    expect(r.aware.size).toBe(0);
    expect(sim.rumors!.knownToHousehold(1)).toEqual([]);
    for (let i = 0; i < 10 * 1440 && !r.aware.size; i++) sim.tick();
    expect(r.aware.size).toBeGreaterThan(0);
    expect(sim.rumors!.knownToHousehold(1)).toContain(r);
  }, 30000);

  it('해명: 거짓 소문이 더 잘 먹히고, 성공하면 들은 사람이 믿지 않게 되며 존중이 돌아옴', () => {
    const sim = town(5);
    const subj = adults(sim, (p) => p.household !== 1)[0];
    const listener = adults(sim, (p) => p.household !== subj.household)[0];
    const R = sim.rumors!;
    const rTrue = R.add('theft', [subj], { a: subj.name }, 0, 1, [listener]);
    const rFalse = R.add('slander', [subj], { a: subj.name }, 0, 1, [listener], { truth: false });
    let okT = 0;
    let okF = 0;
    for (let i = 0; i < 400; i++) {
      rTrue.knownBy.add(listener.id);
      rFalse.knownBy.add(listener.id);
      if (R.explain(rTrue, listener, 0.5)) okT++;
      if (R.explain(rFalse, listener, 0.5)) okF++;
    }
    expect(okF).toBeGreaterThan(okT * 1.5);
    // 새 사람이 들었다가 해명을 들음: 존중이 떨어졌다가 돌아옴
    const other = adults(sim, (p) => p.household !== subj.household && p !== listener)[0];
    (R as unknown as { hear(r: unknown, p: Person): void }).hear(rFalse, other);
    const before = sim.rel.respect(other.id, subj.id);
    expect(before).toBeLessThan(0);
    const listener2 = other;
    let done = false;
    for (let i = 0; i < 50 && !done; i++) done = R.explain(rFalse, listener2, 1);
    expect(done).toBe(true);
    expect(rFalse.knownBy.has(listener2.id)).toBe(false);
    expect(sim.rel.respect(listener2.id, subj.id)).toBeGreaterThan(before);
  });

  it('대응 조건: 해명은 소문을 아는 상대에게만, 따지기는 소문 낸 사람에게만, 참회는 나쁜 소문이 셀 때만', () => {
    const sim = town(6);
    const me = adults(sim, (p) => p.household === 1)[0];
    const liar = adults(sim, (p) => p.household !== 1)[0];
    const other = adults(sim, (p) => p.household !== 1 && p.household !== liar.household)[0];
    const r = sim.rumors!.add('slander', [me], { a: me.name }, 0, 1, [liar], { truth: false, origin: liar.id });
    expect(sim.gateOk('explain_rumor', me, liar)).toBe(false); // 아직 우리 식구가 모름
    expect(sim.gateOk('public_penance', me, null)).toBe(false);
    r.aware.add(me.id);
    expect(sim.gateOk('explain_rumor', me, liar)).toBe(true);
    expect(sim.gateOk('explain_rumor', me, other)).toBe(false);
    expect(sim.gateOk('confront_rumor', me, liar)).toBe(true);
    expect(sim.gateOk('confront_rumor', me, other)).toBe(false);
    expect(sim.gateOk('public_penance', me, null)).toBe(true);
    // 공개 참회: 나쁜 소문이 크게 약해짐
    const s0 = r.strength;
    sim.rumors!.penance(me.household);
    expect(r.strength).toBeCloseTo(s0 * 0.3);
    expect(sim.gateOk('public_penance', me, null)).toBe(false);
  });

  it('더 큰 소문이 덮으면 옛 소문이 약해지고, 세기가 바닥이면 잊힘', () => {
    const sim = town(7);
    const subj = adults(sim, (p) => p.household !== 1)[0];
    const R = sim.rumors!;
    const small = R.add('drunkard', [subj], { a: subj.name }, 0, 1, [subj]);
    const s0 = small.strength;
    R.add('affair', [subj], { a: subj.name }, 0, 1, [subj]);
    expect(small.strength).toBeLessThan(s0);
    for (let d = 1; d < 40; d++) R.daily(d);
    expect(R.list.includes(small)).toBe(false);
  });

  it('험담 대화는 실제로 소문을 옮김 (전체 LOD 추가 전파)', () => {
    const sim = town(8);
    const [a, b] = adults(sim, (p) => p.household !== 1).filter((p, i, arr) => arr.findIndex((q) => q.household === p.household) === i);
    const subj = adults(sim, (p) => p.household !== a.household && p.household !== b.household)[0];
    const R = sim.rumors!;
    let moved = 0;
    for (let i = 0; i < 100; i++) {
      const r = R.add('theft', [subj], { a: subj.name }, 0, 1, [a]);
      R.talk(a, b, true);
      if (r.knownBy.has(b.id)) moved++;
    }
    expect(moved).toBeGreaterThan(40);
  });

  it('같은 시드 + 같은 입력 = 같은 해시 (소문 상태 포함)', () => {
    const h = () => {
      const sim = town(9);
      const subj = adults(sim, (p) => p.household !== 1)[0];
      const wit = adults(sim, (p) => p.household !== subj.household)[0];
      sim.rumors!.add('scandal', [subj], { a: subj.name }, 0, 1, [wit]);
      for (let i = 0; i < 2 * 1440; i++) sim.tick();
      return sim.worldHash();
    };
    expect(h()).toBe(h());
  });
});
