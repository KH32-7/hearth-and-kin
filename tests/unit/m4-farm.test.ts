/**
 * M4 농사 (31장): 갈기 → 제철 씨 뿌리기 → 계절 따라 5단계 성장 → 김매기 → 수확 → 방앗간 → 빵, 지력/삼포제, 파종 계절 규칙
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/sim';
import { loadSimData } from '../../tools/data-node';

const D = loadSimData();
const hasField = !!D.crops && !!D.objects.field_plot;

function farm(seed = 1) {
  const s = new Simulation(D, seed);
  s.addPerson('에드릭', undefined, undefined, { estate: 'freeman' });
  s.addPerson('마르타', undefined, undefined, { estate: 'freeman' });
  return s;
}
function field(s: Simulation) {
  return s.world.objects.find((o) => o.defId === 'field_plot')!;
}
/** 명령 하나를 끝낼 때까지 */
function doTask(s: Simulation, id: string, uid: number, max = 900): void {
  const before = s.stats.completed[id] ?? 0;
  const p = s.persons[1];
  // 쓰러져 있거나 자는 중이면 깰 때까지
  for (let i = 0; i < 720 && p.collapse; i++) s.tick();
  expect(s.apply({ kind: 'queue', personId: 2, interactionId: id, targetUid: uid })).toMatchObject({ ok: true });
  for (let i = 0; i < max; i++) {
    s.tick();
    if ((s.stats.completed[id] ?? 0) > before) return;
  }
}
function days(s: Simulation, n: number): void {
  for (let i = 0; i < n * 1440; i++) s.tick();
}

describe.skipIf(!hasField)('농사 사슬 (31-2, 17-5)', () => {
  it('봄에는 밀을 못 심고(가을 파종), 가을에 갈고 심으면 겨울을 나고 여름에 익어 수확 → 방앗간 → 빵', () => {
    const s = farm();
    const f = field(s);
    s.world.stock.wheat = 40;
    s.econ!.account(1)!.money += 2000; // 가을 세금을 돈으로 내게 (현물 납부로 밀이 나가지 않게)
    // 봄: 밀 파종 메뉴 없음 (계절 규칙 31-3)
    doTask(s, 'farm.till', f.uid);
    expect(f.state.tilled).toBe(1);
    expect(s.menuFor(2, f.uid).some((e) => e.interactionId === 'farm.sow.wheat')).toBe(false);
    // 가을로 (봄 7 + 여름 7 = 14일)
    days(s, 14 - s.world.day());
    expect(s.world.season).toBe('autumn');
    doTask(s, 'farm.sow.wheat', f.uid);
    expect(f.state.crop).toBeGreaterThan(0);
    const stages = new Set<number>();
    const wheat0 = s.world.stock.wheat ?? 0;
    // 이 밭의 수확 (다른 텃밭을 자율로 먼저 거둘 수 있음): 다 익었던 작물이 비면 거둔 것
    let ripe = false;
    let done = 0;
    const harvested = () => {
      if (Number(f.state.stage) === 4) ripe = true;
      if (ripe && !Number(f.state.crop)) done = 1;
      return done;
    };
    for (let d = 0; d < 30 && !harvested(); d++) {
      for (let i = 0; i < 1440 && !harvested(); i++) {
        s.tick();
        stages.add(Number(f.state.stage));
        // 익으면 (자율이 먼저 거두지 않았으면) 명령으로 거둠
        if (Number(f.state.stage) === 4 && !s.persons[1].queue.some((q) => q.interactionId === 'farm.harvest')) s.apply({ kind: 'queue', personId: 2, interactionId: 'farm.harvest', targetUid: f.uid });
      }
      if (Number(f.state.weeds) && !harvested()) doTask(s, 'farm.weed', f.uid);
    }
    expect(harvested()).toBeGreaterThan(0);
    expect(s.world.season).toBe('summer');
    expect(stages.size).toBeGreaterThanOrEqual(5);
    const got = (s.world.stock.wheat ?? 0) - wheat0;
    expect(got).toBeGreaterThan(60);
    expect(f.state.crop).toBe(0);
    // 방앗간 (부지 출구 래빗홀) → 밀가루
    const exit = s.world.objects.find((o) => o.defId === 'lot_exit')!;
    const flour0 = s.world.stock.flour ?? 0;
    doTask(s, 'recipe.mill_wheat', exit.uid);
    expect((s.world.stock.flour ?? 0) - flour0).toBeGreaterThan(0);
    // 빵 굽기 (화덕): 효모/물/장작이 있어야
    s.world.stock.yeast = 2;
    s.world.stock.water = 4;
    s.world.stock.firewood = 4;
    const oven = s.world.objects.find((o) => o.defId === 'oven');
    if (oven) {
      const bread0 = s.world.stock.bread ?? 0;
      doTask(s, 'recipe.bake_bread', oven.uid);
      expect((s.world.stock.bread ?? 0) - bread0).toBeGreaterThanOrEqual(4);
    }
  }, 30000);

  it('지력: 같은 곡물을 연달아 심으면 더 떨어지고, 콩은 회복 (삼포제 31-4)', () => {
    const s = farm(2);
    const f = field(s);
    const fert0 = Number(f.state.fert);
    s.farm!.sow(f, 'barley');
    f.state.stage = 4;
    s.farm!.harvest(f, ['field'], 0, 7, 10);
    const after1 = Number(f.state.fert);
    s.farm!.sow(f, 'oats');
    f.state.stage = 4;
    s.farm!.harvest(f, ['field'], 0, 7, 20);
    const after2 = Number(f.state.fert);
    expect(fert0 - after1).toBeGreaterThan(0);
    expect(after1 - after2).toBeGreaterThan(fert0 - after1);
    s.farm!.sow(f, 'beans');
    f.state.stage = 4;
    s.farm!.harvest(f, ['field'], 0, 7, 30);
    expect(Number(f.state.fert)).toBeGreaterThan(after2);
  });

  it('허수아비는 까마귀 피해 확률을 줄임, 수확량은 지력/관리/손실을 따름', () => {
    const s = farm(3);
    const f = field(s);
    s.farm!.sow(f, 'wheat');
    f.state.stage = 4;
    const good = s.farm!.harvest({ ...f, state: { ...f.state, fert: 100, care: 0.2 } }, ['field'], 5, 7, 1)!.n;
    const bad = s.farm!.harvest({ ...f, state: { ...f.state, fert: 20, care: -0.2, loss: 0.3, crop: f.state.crop, stage: 4 } }, ['field'], 0, 7, 1)!.n;
    expect(good).toBeGreaterThan(bad * 1.8);
  });
});

describe.skipIf(!hasField)('M4 리뷰 회귀 (농사)', () => {
  it('5. 씨 뿌리기는 씨앗을, 거름 주기는 거름을 씀 (작물마다 거름 두 번까지)', () => {
    const s = farm(5);
    const f = field(s);
    days(s, 14 - s.world.day());
    f.state.tilled = 1;
    s.world.stock.wheat = 20;
    doTask(s, 'farm.sow.wheat', f.uid);
    expect(s.world.stock.wheat).toBeLessThan(20);
    s.world.stock.manure = 6;
    doTask(s, 'farm.fertilize', f.uid);
    expect(s.world.stock.manure).toBe(4);
    expect(s.menuFor(2, f.uid).some((e) => e.interactionId === 'farm.fertilize')).toBe(false);
  });

  it('6. 거둔 밭에 가뭄이 남지 않음', () => {
    const s = farm(6);
    const f = field(s);
    s.farm!.sow(f, 'barley');
    f.state.stage = 4;
    f.state.drought = 3;
    s.farm!.harvest(f, ['field'], 0, 7, 10);
    expect(f.state.drought).toBe(0);
  });

  it('7. 과수: 처음부터 있는 사과나무가 가을에 익고, 빈 과수 자리는 묘목을 심을 수 있음', () => {
    const s = farm(7);
    const tree = s.world.objects.find((o) => o.defId === 'orchard_tree');
    if (!tree) return;
    expect(Number(tree.state.crop)).toBeGreaterThan(0);
    let ripe = false;
    for (let d = 0; d < 21 && !ripe; d++) {
      days(s, 1);
      if (Number(tree.state.stage) === 4 || (s.stats.completed['farm.harvest'] ?? 0) > 0) ripe = true;
    }
    expect(ripe).toBe(true);
    tree.state.crop = 0;
    expect(s.menuFor(2, tree.uid).some((e) => e.interactionId.startsWith('farm.plant.'))).toBe(true);
  });
});
