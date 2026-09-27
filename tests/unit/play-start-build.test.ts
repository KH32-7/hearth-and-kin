/**
 * 플레이 개선 (2026-09-27): 새 게임 집 사기(applyPreset lot), 건축 고르기(색 바꾸기 · 벽 칠하기 · 되돌리기),
 * 소원 길잡이(wishHint), 밤잠(아침까지), 밤 자동 가속(조작 가족만)
 */
import { describe, expect, it } from 'vitest';
import { loadSimData } from '../../tools/data-node';
import { Simulation } from '../../src/sim/sim';
import type { PresetResult } from '../../src/sim/house/presets';

const data = loadSimData({ town: 'ashford' });
const town = (seed = 1) => new Simulation(data, seed);
const money = (sim: Simulation) => sim.econ?.account(1)?.money ?? 0;
const preset = (sim: Simulation, id: string, lot: string | null) =>
  (sim.apply({ kind: 'house', op: 'applyPreset', args: { preset: id, lot } }) as { ok: boolean; result: PresetResult }).result;

describe('새 게임 집 사기', () => {
  it('고른 빈 집에 들어가고 집 예산 − 집값만큼 돈이 바뀜 (결정론)', () => {
    const a = town();
    const base = town();
    const r0 = preset(base, 'freeman_normal', null);
    const r = preset(a, 'freeman_normal', 'lot_29');
    expect(r.house.lot).toBe('lot_29');
    expect(a.town!.playerLot()?.id).toBe('lot_29');
    const lot = a.town!.lot('lot_29')!;
    expect(r.house.price).toBe(lot.price);
    // 기본 배정(집 값 없이)보다 예산 − 집값만큼 차이
    expect(money(a) - money(base)).toBe(a.house!.houseBudget('farmhouse') - lot.price);
    expect(r0.house.lot ?? null).toBeNull();
    // 같은 입력 = 같은 결과
    const b = town();
    preset(b, 'freeman_normal', 'lot_29');
    for (let i = 0; i < 60; i++) {
      a.tick();
      b.tick();
    }
    expect(a.worldHash()).toBe(b.worldHash());
  });

  it('돈이 모자라는 집 · 길 없는 집 · 영주 땅 농노의 큰 집은 고르지 못함 (기본 배정으로)', () => {
    const sim = town();
    expect(sim.house!.startLotOk('freeman_poor', 'lot_51')).toBe(false);
    expect(sim.house!.startLotOk('freeman_normal', 'lot_22')).toBe(false);
    expect(sim.house!.startLotOk('serf_normal', 'lot_07')).toBe(false);
    const r = preset(sim, 'freeman_poor', 'lot_51');
    expect(r.house.lot ?? null).toBeNull();
    expect(money(sim)).toBeGreaterThanOrEqual(0);
  });

  it('시작 직업은 첫날 쉼 (알림 없이, 결근 감점 없음)', () => {
    const sim = town();
    preset(sim, 'freeman_normal', 'lot_29');
    const head = sim.persons.find((p) => p.household === 1 && p.career)!;
    expect(head.career!.lastDay).toBe(sim.world.day());
    for (let i = 0; i < 1440; i++) sim.tick();
    expect(head.career!.perf).toBeGreaterThanOrEqual(0);
  });
});

describe('건축 고르기', () => {
  const setup = () => {
    const sim = town();
    const b = sim.builder!;
    b.area = [0, 0, sim.world.grid.w - 1, sim.world.grid.h - 1];
    sim.apply({ kind: 'grant', amount: 100000, reason: 'test' });
    return { sim, b };
  };

  it('색 바꾸기: 값 받고, 첫 색(기본)은 같은 것으로 봄, 되돌리기로 원래 색', () => {
    const { sim, b } = setup();
    const o = sim.world.objects.find((q) => (sim.data.objects[q.defId]?.variants?.length ?? 0) > 1 && !q.variant)!;
    const vs = sim.data.objects[o.defId].variants!;
    expect(b.apply({ op: 'recolor', uid: o.uid, variant: vs[0] }).reason).toBe('same');
    const r = b.apply({ op: 'recolor', uid: o.uid, variant: vs[1] });
    expect(r.ok).toBe(true);
    expect(r.cost).toBeGreaterThanOrEqual(0);
    expect(o.variant).toBe(vs[1]);
    expect(b.undo()?.ok).toBe(true);
    expect(o.variant).toBeUndefined();
  });

  it('벽 칠하기: 곧게 이어진 같은 벽만, 되돌리기로 원래 재질', () => {
    const { sim, b } = setup();
    const lot = sim.world.lot;
    const t = sim.town!.lot('lot_29')!.rect;
    let at: [number, number] | null = null;
    for (let y = t[1]; y <= t[3] && !at; y++) for (let x = t[0]; x <= t[2] && !at; x++) if (lot.walls[y * lot.w + x] && !lot.walls[y * lot.w + x]!.startsWith('fence')) at = [x, y];
    expect(at).not.toBeNull();
    const [x, y] = at!;
    const before = lot.walls[y * lot.w + x];
    const run = b.wallRun(x, y);
    const all = b.wallRun(x, y, true);
    expect(run.length).toBeGreaterThan(1);
    expect(all.length).toBeGreaterThanOrEqual(run.length);
    const style = Object.keys(sim.data.build!.walls).find((s) => s !== before && !sim.data.build!.walls[s].estate)!;
    const r = b.apply({ op: 'paintWall', x, y, style });
    expect(r.ok).toBe(true);
    expect(r.cells).toBe(run.length);
    for (const i of run) expect(lot.walls[i]).toBe(style);
    expect(b.undo()?.ok).toBe(true);
    for (const i of run) expect(lot.walls[i]).toBe(before);
  });
});

describe('길잡이 · 잠 · 가속', () => {
  it('소원 길잡이: 스튜 소원이면 화덕을, 상태는 바꾸지 않음', () => {
    const sim = town();
    const me = sim.persons.find((p) => p.household === 1)!;
    const h0 = sim.worldHash();
    const r = sim.wishHint(me.id, 'wish_cook_stew');
    expect(r.interactionIds).toContain('hearth.cook_stew');
    expect(r.uids.length).toBeGreaterThan(0);
    expect(sim.world.byUid.get(r.uids[0])?.defId).toBe('hearth');
    expect(sim.worldHash()).toBe(h0);
  });

  it('밤잠은 아침까지 이어 자고, 가족이 모두 자면 가속 (마을 NPC 는 안 봄)', () => {
    const sim = town();
    const fam = sim.persons.filter((p) => p.household === 1);
    let night = 0;
    let slept = 0;
    let accel = 0;
    for (let m = 0; m < 3 * 1440; m++) {
      sim.tick();
      const h = sim.world.hour();
      if (h >= 23 || h < 5) {
        night++;
        if (fam.every((p) => p.sleeping)) slept++;
        if (sim.shouldAutoAccelerate()) accel++;
      }
    }
    expect(slept / night).toBeGreaterThan(0.5);
    expect(accel).toBe(slept);
  });
});
