/**
 * M5 건축과 구매 (GDD 23): 빈 부지에 방 → 2층 → 계단 → 가구 → 입주, 실행 취소, 길 막힘 경고, 신분 제한, 지하 저장고, 굴뚝, 내구도
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadSimData } from '../../tools/data-node';
import { Simulation } from '../../src/sim/sim';
import type { BuildOp, BuildResult } from '../../src/sim/build/builder';
import { rowOf } from '../../src/sim/world/lot';

const data = loadSimData({ lot: 'src/data/lots/empty.json' });
const H = data.lot.h;
/** (층, 판 안 y) → 전체 행 */
const R = (level: number, y: number) => rowOf(level, y, H);

function fresh(estate = 'freeman', money = 20000): Simulation {
  const sim = new Simulation(data, 5);
  sim.addPerson('에드릭', undefined, undefined, { estate, sex: 'male' });
  const a = sim.econ?.account(1);
  if (a) a.money = money;
  return sim;
}

function b(sim: Simulation, op: BuildOp): BuildResult {
  return sim.apply({ kind: 'build', op }) as BuildResult;
}

/** 1층 6×5 방 (벽 포함 x 4..10, y 2..7) + 나무 마루 + 문 + 창 */
function house(sim: Simulation): void {
  expect(b(sim, { op: 'room', x0: 4, y0: R(0, 2), x1: 10, y1: R(0, 7), style: 'wall_timber', floor: 'floor_wood' }).ok).toBe(true);
  expect(b(sim, { op: 'opening', x: 7, y: R(0, 7), kind: 'door', variant: 'door_plank' }).ok).toBe(true);
  expect(b(sim, { op: 'opening', x: 5, y: R(0, 7), kind: 'window', variant: 'win_shutter' }).ok).toBe(true);
}

describe('M5 건축', () => {
  it('방 도구: 벽으로 닫힌 바닥이 방으로 인식되고 돈이 나감, 지붕 칸이 생김', () => {
    const sim = fresh();
    const before = sim.econ!.account(1)!.money;
    house(sim);
    const rooms = sim.rooms();
    expect(rooms.length).toBe(1);
    expect(rooms[0].size).toBe(5 * 4);
    expect(rooms[0].windows).toBe(1);
    expect(sim.econ!.account(1)!.money).toBeLessThan(before);
    expect(sim.builder!.roofCellCount()).toBe(7 * 6);
  });

  it('2층: 받침 있는 칸에만 바닥, 위층 벽, 계단으로 오르내림', () => {
    const sim = fresh();
    house(sim);
    // 위층 바닥: 아래 방 전체 + 받침 없는 바깥 한 줄(무시됨)
    const f = b(sim, { op: 'floor', x0: 4, y0: R(1, 2), x1: 11, y1: R(1, 7), style: 'floor_wood' });
    expect(f.ok).toBe(true);
    expect(f.cells).toBe(7 * 6);
    expect(b(sim, { op: 'room', x0: 4, y0: R(1, 2), x1: 10, y1: R(1, 7), style: 'wall_timber' }).ok).toBe(true);
    // 받침 없는 곳의 위층 벽은 거절
    expect(b(sim, { op: 'wall', x0: 14, y0: R(1, 2), x1: 14, y1: R(1, 5), style: 'wall_timber' }).reason).toBe('unsupported');
    // 계단: 1층 방 안 (x 9, y 3..5), 맨 위 칸 (9,3) ↔ 위층 (9,2)? 위층 y 2 는 벽 → 방 안쪽 한 칸 아래로
    const st = b(sim, { op: 'buy', defId: 'stairs_wood', x: 9, y: R(0, 4), rot: 0 });
    expect(st.ok, st.reason).toBe(true);
    const g = sim.world.grid;
    expect(g.portal[g.idx(9, R(0, 4))]).toBe(g.idx(9, R(1, 3)));
    // 계단 위 구멍: 위층 바닥이 걷힘
    expect(sim.world.lot.floor[g.idx(9, R(1, 5))]).toBeNull();
    expect(sim.rooms().filter((r) => r.level === 1).length).toBe(1);
    // 사람이 2층으로 걸어 올라감
    sim.autonomyEnabled = false;
    const p = sim.persons[0];
    sim.apply({ kind: 'goto', personId: p.id, x: 6, y: R(1, 4) });
    for (let t = 0; t < 120 && (p.cellX() !== 6 || p.cellY() !== R(1, 4)); t++) sim.tick();
    expect([p.cellX(), p.cellY()]).toEqual([6, R(1, 4)]);
    expect(sim.world.grid.levelOf(g.idx(p.cellX(), p.cellY()))).toBe(1);
    // 다시 내려와 문 밖으로
    sim.apply({ kind: 'goto', personId: p.id, x: 7, y: R(0, 10) });
    for (let t = 0; t < 120 && (p.cellX() !== 7 || p.cellY() !== R(0, 10)); t++) sim.tick();
    expect([p.cellX(), p.cellY()]).toEqual([7, R(0, 10)]);
    expect(sim.stats.stuckEvents).toBe(0);
  });

  it('실행 취소/다시 하기: 벽과 돈이 되돌아옴', () => {
    const sim = fresh();
    const m0 = sim.econ!.account(1)!.money;
    const r = b(sim, { op: 'wall', x0: 2, y0: R(0, 2), x1: 8, y1: R(0, 2), style: 'wall_stone' });
    expect(r.ok).toBe(true);
    expect(r.cells).toBe(7);
    expect(sim.econ!.account(1)!.money).toBe(m0 - r.cost);
    sim.apply({ kind: 'buildUndo' });
    expect(sim.world.lot.walls.filter(Boolean).length).toBe(0);
    expect(sim.econ!.account(1)!.money).toBe(m0);
    sim.apply({ kind: 'buildRedo' });
    expect(sim.world.lot.walls.filter(Boolean).length).toBe(7);
  });

  it('구매/옮기기/팔기와 실행 취소 (uid 유지)', () => {
    const sim = fresh();
    house(sim);
    const r = b(sim, { op: 'buy', defId: 'bed_straw', x: 5, y: R(0, 3) });
    expect(r.ok, r.reason).toBe(true);
    const uid = r.uid!;
    expect(b(sim, { op: 'buy', defId: 'chair', x: 5, y: R(0, 3) }).reason).toBe('occupied');
    expect(b(sim, { op: 'move', uid, x: 6, y: R(0, 3) }).ok).toBe(true);
    const m = sim.econ!.account(1)!.money;
    const s = b(sim, { op: 'sell', uid });
    expect(s.ok).toBe(true);
    expect(s.cost).toBeLessThan(0);
    expect(sim.econ!.account(1)!.money).toBeGreaterThan(m);
    sim.apply({ kind: 'buildUndo' });
    expect(sim.world.byUid.get(uid)?.x).toBe(6);
  });

  it('길 막힘 경고: 문을 벽으로 막으면 문/물건/사람 경고', () => {
    const sim = fresh();
    house(sim);
    b(sim, { op: 'buy', defId: 'bed_straw', x: 5, y: R(0, 3) });
    expect(sim.builder!.lastWarnings.length).toBe(0);
    // 문 앞 바깥을 울타리로 두름 (문 칸은 벽이라 못 막음 → 문 밖 한 칸을 둘러쌈)
    b(sim, { op: 'wall', x0: 6, y0: R(0, 8), x1: 8, y1: R(0, 8), style: 'fence_wood' });
    b(sim, { op: 'wall', x0: 6, y0: R(0, 9), x1: 8, y1: R(0, 9), style: 'fence_wood' });
    const w = sim.builder!.lastWarnings;
    expect(w.some((x) => x.kind === 'object')).toBe(true);
    expect(w.some((x) => x.kind === 'door')).toBe(true);
  });

  it('신분 제한 (23-2): 자유민은 벽돌/유리창 불가, 상인은 가능', () => {
    const sim = fresh('freeman');
    house(sim);
    expect(b(sim, { op: 'wall', x0: 14, y0: R(0, 2), x1: 16, y1: R(0, 2), style: 'wall_brick' }).reason).toBe('estate');
    expect(b(sim, { op: 'opening', x: 9, y: R(0, 7), kind: 'window', variant: 'win_glass' }).reason).toBe('estate');
    const rich = fresh('merchant');
    house(rich);
    expect(b(rich, { op: 'opening', x: 9, y: R(0, 7), kind: 'window', variant: 'win_glass' }).ok).toBe(true);
  });

  it('돈이 모자라면 짓지 못함', () => {
    const sim = fresh('freeman', 30);
    const r = b(sim, { op: 'room', x0: 4, y0: R(0, 2), x1: 10, y1: R(0, 7), style: 'wall_stone', floor: 'floor_stone' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_money');
    expect(sim.world.lot.walls.filter(Boolean).length).toBe(0);
  });

  it('지하 저장고: 집 밑만 파고 들창으로 이어지면 저장고 (부패 절반)', () => {
    const sim = fresh();
    house(sim);
    expect(b(sim, { op: 'digCellar', x0: 12, y0: R(-1, 3), x1: 13, y1: R(-1, 4) }).reason).toBe('cellar_outside');
    expect(b(sim, { op: 'digCellar', x0: 5, y0: R(-1, 3), x1: 9, y1: R(-1, 6) }).ok).toBe(true);
    expect(sim.world.hasCellar()).toBe(false);
    const h = b(sim, { op: 'buy', defId: 'cellar_hatch', x: 8, y: R(0, 5) });
    expect(h.ok, h.reason).toBe(true);
    expect(sim.world.hasCellar()).toBe(true);
    expect(sim.builder!.lastWarnings.filter((w) => w.kind === 'hatch_no_cellar')).toEqual([]);
  });

  it('굴뚝: 북쪽 벽에 붙은 화로는 굴뚝이 있고, 한가운데 화로는 없음', () => {
    const sim = fresh();
    house(sim);
    const r = b(sim, { op: 'buy', defId: 'hearth', x: 5, y: R(0, 3) });
    expect(r.ok, r.reason).toBe(true);
    expect(sim.world.hasChimney(sim.world.byUid.get(r.uid!)!)).toBe(true);
    expect(b(sim, { op: 'buy', defId: 'hearth', x: 5, y: R(0, 5) }).reason).toBe('needs_wall_north');
  });

  it('입력 로그 재생: 같은 건축 의도 = 같은 부지', () => {
    const sim = fresh();
    house(sim);
    b(sim, { op: 'buy', defId: 'bed_straw', x: 5, y: R(0, 3) });
    for (let t = 0; t < 200; t++) sim.tick();
    const again = new Simulation(data, 5);
    again.addPerson('에드릭', undefined, undefined, { estate: 'freeman', sex: 'male' });
    again.econ!.account(1)!.money = 20000;
    for (const l of sim.inputLog) {
      while (again.stats.ticks < l.tick) again.tick();
      again.apply(l.intent);
    }
    while (again.stats.ticks < sim.stats.ticks) again.tick();
    expect(JSON.stringify(again.world.lot.walls)).toBe(JSON.stringify(sim.world.lot.walls));
    expect(again.world.objects.map((o) => `${o.defId}@${o.x},${o.y}`)).toEqual(sim.world.objects.map((o) => `${o.defId}@${o.x},${o.y}`));
  });
});

describe('M5 내구도와 화재', () => {
  it('내구도: 쓰면 닳아 고장 → 고장 난 의자는 못 앉고, 고치면 다시 씀', () => {
    const sim = fresh();
    house(sim);
    const r = b(sim, { op: 'buy', defId: 'chair', x: 6, y: R(0, 4) });
    const chair = sim.world.byUid.get(r.uid!)!;
    chair.state.wear = 100;
    chair.state.broken = true;
    const p = sim.persons[0];
    const menu = sim.menuFor(p.id, chair.uid);
    expect(menu.filter((e) => e.interactionId !== 'obj.repair').every((e) => !e.available)).toBe(true);
    const fix = menu.find((e) => e.interactionId === 'obj.repair');
    expect(fix?.available).toBe(true);
    sim.autonomyEnabled = false;
    sim.apply({ kind: 'queue', personId: p.id, interactionId: 'obj.repair', targetUid: chair.uid });
    for (let t = 0; t < 200 && chair.state.broken; t++) sim.tick();
    expect(Number(chair.state.wear)).toBe(0);
    expect(chair.state.broken).toBeFalsy();
  });

  it('화재: 불이 나면 가족이 달려가 끄고, 불 칸은 길을 막음', () => {
    const sim = fresh();
    house(sim);
    sim.apply({ kind: 'setStock', item: 'water', n: 10 });
    const g = sim.world.grid;
    const cell = g.idx(6, R(0, 4));
    const uid = sim.fire!.ignite(cell, 'test');
    expect(uid).toBeGreaterThan(0);
    expect(g.walkable(cell)).toBe(false);
    for (let t = 0; t < 240 && sim.fire!.active; t++) sim.tick();
    expect(sim.fire!.active).toBe(false);
    expect(sim.fire!.stats.extinguished).toBeGreaterThan(0);
    expect(sim.notices.some((n) => n.kind === 'fire_out')).toBe(true);
  });

  it('화재: 아무도 없으면 번지고 가구가 탐 (가족이 없을 때)', () => {
    const data2 = loadSimData({ lot: 'src/data/lots/empty.json' });
    const sim = new Simulation(data2, 9);
    sim.addPerson('주인', undefined, undefined, { estate: 'freeman' });
    sim.econ!.account(1)!.money = 99999;
    house(sim);
    b(sim, { op: 'buy', defId: 'bed_straw', x: 5, y: R(0, 3) });
    b(sim, { op: 'floor', x0: 5, y0: R(0, 3), x1: 9, y1: R(0, 6), style: 'floor_straw' });
    // 주인은 일하러 나간 셈 (숨김): 끄는 사람이 없음
    // 아무도 없는 집 (가족이 부지를 떠남)
    sim.removePerson(sim.persons[0]);
    sim.fire!.ignite(sim.world.grid.idx(6, R(0, 3)), 'test');
    for (let t = 0; t < 300; t++) sim.tick();
    expect(sim.fire!.stats.spread + sim.fire!.stats.burnedObjects).toBeGreaterThan(0);
  });
});

describe('M5 공사 시간 옵션 (23-3)', () => {
  it('켜면 벽이 공사 예정 → 목수가 일하는 시간에 지어짐, 가족이 거들면 품삯을 돌려받음', () => {
    const sim = fresh();
    sim.apply({ kind: 'setConstruction', on: true });
    const m0 = sim.econ!.account(1)!.money;
    const r = b(sim, { op: 'wall', x0: 2, y0: R(0, 2), x1: 8, y1: R(0, 2), style: 'wall_stone' });
    expect(r.ok).toBe(true);
    expect(r.pending).toBeGreaterThan(0);
    expect(sim.world.lot.walls.filter(Boolean).length).toBe(0);
    expect(sim.econ!.account(1)!.money).toBe(m0 - r.cost);
    // 가족이 한 시간 거듦
    const site = sim.world.objects.find((o) => o.defId === 'construction_site')!;
    sim.autonomyEnabled = false;
    sim.apply({ kind: 'queue', personId: 1, interactionId: 'construction.work', targetUid: site.uid });
    for (let t = 0; t < 80; t++) sim.tick();
    expect(sim.econ!.account(1)!.money).toBeGreaterThan(m0 - r.cost);
    // 며칠 안에 완성
    for (let t = 0; t < 1440 * 3 && sim.builder!.pending.length; t++) sim.tick();
    expect(sim.builder!.pending.length).toBe(0);
    expect(sim.world.lot.walls.filter(Boolean).length).toBe(7);
    expect(sim.notices.some((n) => n.kind === 'construction_done')).toBe(true);
  });
});

describe('M5 리뷰 회귀', () => {
  it('창가를 쓰는 중에 건축해도 멈추지 않음 (창문 uid 유지/사라지면 행동 중단)', () => {
    const sim = fresh();
    house(sim);
    const win = sim.world.objects.find((o) => o.defId === 'window_opening')!;
    const ia = Object.keys(sim.data.interactions).find((k) => sim.data.interactions[k].objects.includes('window_opening'))!;
    sim.autonomyEnabled = false;
    sim.apply({ kind: 'queue', personId: 1, interactionId: ia, targetUid: win.uid });
    for (let t = 0; t < 5; t++) sim.tick();
    b(sim, { op: 'wall', x0: 14, y0: R(0, 2), x1: 16, y1: R(0, 2), style: 'wall_stone' });
    expect(sim.world.byUid.get(win.uid)?.defId).toBe('window_opening');
    b(sim, { op: 'removeOpening', x: 5, y: R(0, 7) });
    expect(() => { for (let t = 0; t < 60; t++) sim.tick(); }).not.toThrow();
  });

  it('여러 칸 편집이 중간에 실패하면 아무것도 바뀌지 않음', () => {
    const sim = fresh();
    const m = sim.econ!.account(1)!.money;
    // 아래 변이 길 끝(11,15)에 걸림
    const r = b(sim, { op: 'room', x0: 8, y0: R(0, 10), x1: 14, y1: R(0, 15), style: 'wall_timber' });
    expect(r.ok).toBe(false);
    expect(sim.world.lot.walls.filter(Boolean).length).toBe(0);
    expect(sim.econ!.account(1)!.money).toBe(m);
  });

  it('아무도 없는 판자벽 집 불도 결국 꺼짐 (탄 칸은 다시 안 탐)', () => {
    const sim = fresh();
    b(sim, { op: 'room', x0: 4, y0: R(0, 2), x1: 10, y1: R(0, 7), style: 'wall_plank', floor: 'floor_straw' });
    sim.removePerson(sim.persons[0]);
    sim.fire!.ignite(sim.world.grid.idx(6, R(0, 4)), 'test');
    for (let t = 0; t < 1440 * 2 && sim.fire!.active; t++) sim.tick();
    expect(sim.fire!.active).toBe(false);
  });

  it('공사 예정 취소는 가족 품삯으로 받은 몫을 빼고 환불 (돈이 생기지 않음)', () => {
    const sim = fresh();
    sim.apply({ kind: 'setConstruction', on: true });
    const m0 = sim.econ!.account(1)!.money;
    b(sim, { op: 'wall', x0: 2, y0: R(0, 2), x1: 8, y1: R(0, 2), style: 'wall_stone' });
    const site = sim.world.objects.find((o) => o.defId === 'construction_site')!;
    sim.autonomyEnabled = false;
    sim.apply({ kind: 'queue', personId: 1, interactionId: 'construction.work', targetUid: site.uid });
    for (let t = 0; t < 70; t++) sim.tick();
    sim.apply({ kind: 'buildUndo' });
    expect(sim.econ!.account(1)!.money).toBeLessThanOrEqual(m0);
  });

  it('공사가 끝난 뒤 다른 편집을 되돌려도 지은 벽은 남음', () => {
    const sim = fresh();
    sim.apply({ kind: 'setConstruction', on: true });
    b(sim, { op: 'wall', x0: 2, y0: R(0, 2), x1: 6, y1: R(0, 2), style: 'wall_stone' });
    b(sim, { op: 'buy', defId: 'chair', x: 12, y: R(0, 5) });
    for (let t = 0; t < 1440 * 3 && sim.builder!.pending.length; t++) sim.tick();
    sim.apply({ kind: 'buildUndo' });
    expect(sim.world.lot.walls.filter(Boolean).length).toBe(5);
  });

  it('불/공사 자리 가상 물건은 팔거나 옮길 수 없음', () => {
    const sim = fresh();
    house(sim);
    const uid = sim.fire!.ignite(sim.world.grid.idx(6, R(0, 4)), 'test');
    expect(b(sim, { op: 'sell', uid }).reason).toBe('no_object');
    expect(b(sim, { op: 'move', uid, x: 6, y: R(0, 5) }).reason).toBe('no_object');
  });

  it('2층: 사람이 선 바닥은 못 걷고, 위층을 받치는 1층 바닥도 못 걷음', () => {
    const sim = fresh();
    house(sim);
    b(sim, { op: 'floor', x0: 4, y0: R(1, 2), x1: 10, y1: R(1, 7), style: 'floor_wood' });
    const p = sim.persons[0];
    p.x = 6.5;
    p.y = R(1, 4) + 0.5;
    expect(b(sim, { op: 'floor', x0: 5, y0: R(1, 3), x1: 9, y1: R(1, 6), style: null }).reason).toBe('occupied');
    expect(b(sim, { op: 'floor', x0: 6, y0: R(0, 5), x1: 6, y1: R(0, 5), style: null }).reason).toBe('supports_upper');
  });

  it('벽 없는 2층 발판, 부지 끝에 닿은 ㄷ자 벽은 방이 아님', () => {
    const sim = fresh();
    house(sim);
    b(sim, { op: 'floor', x0: 5, y0: R(1, 3), x1: 7, y1: R(1, 4), style: 'floor_wood' });
    expect(sim.rooms().filter((r) => r.level === 1).length).toBe(0);
    const sim2 = fresh();
    b(sim2, { op: 'wall', x0: 14, y0: R(0, 11), x1: 14, y1: R(0, 15), style: 'wall_stone' });
    b(sim2, { op: 'wall', x0: 18, y0: R(0, 11), x1: 18, y1: R(0, 15), style: 'wall_stone' });
    b(sim2, { op: 'wall', x0: 14, y0: R(0, 11), x1: 18, y1: R(0, 11), style: 'wall_stone' });
    b(sim2, { op: 'floor', x0: 15, y0: R(0, 12), x1: 17, y1: R(0, 15), style: 'floor_wood' });
    expect(sim2.rooms().length).toBe(0);
  });

  it('다시 하기: 산 물건은 같은 uid (뒤따르는 옮기기 다시 하기가 맞음)', () => {
    const sim = fresh();
    house(sim);
    const r = b(sim, { op: 'buy', defId: 'chair', x: 6, y: R(0, 4) });
    b(sim, { op: 'move', uid: r.uid!, x: 7, y: R(0, 4) });
    sim.apply({ kind: 'buildUndo' });
    sim.apply({ kind: 'buildUndo' });
    expect(sim.world.byUid.has(r.uid!)).toBe(false);
    sim.apply({ kind: 'buildRedo' });
    const again = sim.apply({ kind: 'buildRedo' }) as BuildResult;
    expect(again.ok).toBe(true);
    expect(sim.world.byUid.get(r.uid!)?.x).toBe(7);
  });

  it('계단참(위층 도착 칸)에는 벽/가구를 놓을 수 없음', () => {
    const sim = fresh();
    house(sim);
    b(sim, { op: 'floor', x0: 4, y0: R(1, 2), x1: 10, y1: R(1, 7), style: 'floor_wood' });
    b(sim, { op: 'buy', defId: 'stairs_wood', x: 9, y: R(0, 4), rot: 0 });
    expect(b(sim, { op: 'buy', defId: 'chair', x: 9, y: R(1, 3) }).reason).toBe('stairs');
    expect(b(sim, { op: 'wall', x0: 9, y0: R(1, 3), x1: 9, y1: R(1, 3), style: 'wall_timber' }).reason).toBe('stairs');
  });
});

describe('M5 미리 만든 집 (23-6)', () => {
  const houses = (JSON.parse(readFileSync('src/data/houses.json', 'utf8')) as { houses: { id: string; tier: number; estate: string; rooms: number; w: number; h: number }[] }).houses;
  it('등급 6단계 × 20채 이상, 부지 크기 4종 (23-1)', () => {
    expect(houses.length).toBeGreaterThanOrEqual(20);
    expect(new Set(houses.map((h) => h.tier)).size).toBe(6);
    const sizes = new Set(houses.map((h) => `${h.w}x${h.h}`));
    for (const s of ['12x10', '20x16', '28x22', '40x30']) expect(sizes.has(s), s).toBe(true);
  });
  it('모든 집: 방 수가 목록과 같고 길 막힘 경고 0, 입주 반나절 stuck 0', () => {
    for (const h of houses) {
      const d = loadSimData({ lot: `src/data/lots/houses/${h.id}.json` });
      const sim = new Simulation(d, 3);
      sim.addPerson('가', undefined, undefined, { estate: h.estate, sex: 'male' });
      sim.addPerson('나', undefined, undefined, { estate: h.estate, sex: 'female' });
      expect(sim.rooms().length, h.id).toBe(h.rooms);
      expect(sim.builder!.checkPaths(), h.id).toEqual([]);
      if (h.id.endsWith('_1')) {
        for (let t = 0; t < 720; t++) sim.tick();
        expect(sim.stats.stuckEvents, h.id).toBe(0);
      }
    }
  }, 120_000);
});

describe('M5 문 잠금, 손수 만든 가구, 반전', () => {
  it('식구만 잠근 문은 손님 길찾기가 못 지나감 (식구는 지나감)', () => {
    const sim = fresh();
    house(sim);
    b(sim, { op: 'lock', x: 7, y: R(0, 7), lock: 'family' });
    const g = sim.world.grid;
    const inside = g.idx(7, R(0, 5));
    const host = sim.persons[0];
    expect(sim.reachable(host, inside, false)).toBe(true);
    const guest = sim.addPerson('손님', 11.5, R(0, 13) + 0.5, { estate: 'freeman', household: 101 });
    expect(sim.reachable(guest, inside, false)).toBe(false);
    b(sim, { op: 'lock', x: 7, y: R(0, 7), lock: 'all' });
    expect(sim.reachable(guest, inside, false)).toBe(true);
  });

  it('목공으로 만든 걸상을 저장고에서 꺼내 놓음 (만든 사람/품질), 되돌리면 저장고로', () => {
    const sim = fresh();
    house(sim);
    sim.world.stock.stool = 1;
    sim.world.makers.stool = [1];
    const r = b(sim, { op: 'placeCrafted', item: 'stool', x: 6, y: R(0, 5) });
    expect(r.ok, r.reason).toBe(true);
    expect(r.cost).toBe(0);
    const o = sim.world.byUid.get(r.uid!)!;
    expect(o.defId).toBe('stool');
    expect(o.state.maker).toBe(1);
    expect(sim.world.stock.stool).toBe(0);
    expect(b(sim, { op: 'placeCrafted', item: 'stool', x: 7, y: R(0, 5) }).reason).toBe('no_stock');
    sim.apply({ kind: 'buildUndo' });
    expect(sim.world.stock.stool).toBe(1);
    expect(sim.world.makers.stool).toEqual([1]);
  });

  it('방향 없는 장식은 좌우 반전(rot 2)으로 놓을 수 있음', () => {
    const sim = fresh();
    const id = Object.keys(sim.data.objects).find((k) => sim.data.objects[k].flip && !sim.data.objects[k].wallMounted && sim.data.objects[k].footprint.w === 1 && sim.data.objects[k].footprint.h === 1 && !sim.data.objects[k].estate);
    expect(id).toBeTruthy();
    expect(b(sim, { op: 'buy', defId: id!, x: 3, y: R(0, 3), rot: 2 }).ok).toBe(true);
  });
});

describe('M5 E2E 회귀', () => {
  it('바닥을 먼저 깐 자리에 방 도구(같은 바닥)를 써도 벽이 세워짐', () => {
    const sim = fresh();
    house(sim);
    expect(b(sim, { op: 'floor', x0: 4, y0: R(1, 2), x1: 10, y1: R(1, 7), style: 'floor_wood' }).ok).toBe(true);
    const r = b(sim, { op: 'room', x0: 4, y0: R(1, 2), x1: 10, y1: R(1, 7), style: 'wall_timber', floor: 'floor_wood' });
    expect(r.ok, r.reason).toBe(true);
    expect(sim.rooms().filter((q) => q.level === 1).length).toBe(1);
  });
});
