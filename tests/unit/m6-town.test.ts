/**
 * M6 마을 (GDD 18, 13-6): 애쉬포드 지도와 사람 채우기, 일과표, 세밀도 전환 연속성, 생애 판정기 결정성, 소문,
 * 말 타기, 물건 사용 권한(사는 장소/빈 집/조작 가문 범위), NPC 추상 창고, 리뷰 회귀
 */
import { describe, expect, it } from 'vitest';
import { loadSimData } from '../../tools/data-node';
import { Simulation } from '../../src/sim/sim';
import type { Person } from '../../src/sim/people/person';
import { josa } from '../../src/i18n';

const data = loadSimData({ town: 'ashford' });
const town = (seed = 1) => new Simulation(data, seed);
const canUse = (sim: Simulation, p: Person, uid: number) => (sim as unknown as { canUse(p: Person, o: unknown): boolean }).canUse(p, sim.world.byUid.get(uid));

describe('M6 마을', () => {
  it('애쉬포드: 122명, 가구마다 부지 또는 사는 장소, 조작 가문은 시작 부지, 모든 사람이 출구에서 닿는 칸에 있음', () => {
    const sim = town();
    const t = sim.town!;
    expect(sim.persons.length).toBe(122);
    expect(t.playerLot()?.start).toBe(true);
    const reach = sim.world.reachFromExits();
    const g = sim.world.grid;
    for (const p of sim.persons) {
      if (p.infant) continue;
      expect(p.homeLot !== null || t.householdResidence.has(p.household), p.name).toBe(true);
      expect(reach[g.idx(p.cellX(), p.cellY())], `${p.name} @${p.cellX()},${p.cellY()}`).toBe(1);
    }
    // 방 전체에 못 들어가는 집 없음 (검사 경고 0)
    expect(sim.builder!.checkPaths().filter((w) => w.kind !== 'person')).toEqual([]);
  });

  it('실내 (비주얼 개편): 모든 주거 부지 집에 침대, 2층집은 계단이 2층과 이어지고 2층에 침대, 현관 안쪽 칸은 비어 있음', () => {
    const sim = town();
    const g = sim.world.grid;
    const lot = sim.world.lot;
    const stride = lot.h + 1;
    const inRect = (o: { x: number; y: number }, r: number[], dy = 0) => o.x >= r[0] && o.x <= r[2] && o.y >= r[1] + dy && o.y <= r[3] + dy;
    let two = 0;
    for (const l of sim.town!.lots.filter((q) => q.kind === 'residential')) {
      const objs = sim.world.objects.filter((o) => inRect(o, l.rect) || inRect(o, l.rect, stride));
      const beds = objs.filter((o) => sim.data.objects[o.defId]?.tags.includes('bed'));
      expect(beds.length, l.id).toBeGreaterThan(0);
      const st = objs.find((o) => o.defId === 'stairs_wood');
      if (st) {
        two++;
        expect(g.portal[g.idx(st.x, st.y)], `${l.id} 계단`).toBeGreaterThanOrEqual(0);
        expect(beds.some((b) => b.y >= stride), `${l.id} 2층 침대`).toBe(true);
      }
      // 현관 (앞벽 문) 바로 안쪽 칸은 걸을 수 있음
      const [ex, ey] = l.entrance;
      expect(g.walkable(g.idx(ex, ey - 2)), `${l.id} 현관 안`).toBe(true);
    }
    expect(two).toBeGreaterThan(5);
  });

  it('일과표: 쉬는 날(weekdayFull)에는 일을 안 하고, 성향 변형은 일 시간을 덮지 않음', () => {
    const sim = town();
    const t = sim.town!;
    const hand = sim.persons.find((p) => p.schedule === 'field_hand' && p.lifeStage !== 'elder')!;
    expect(hand).toBeTruthy();
    // 0일 = 월요일, 6일 = 일요일 (careers.json days 0 = mon)
    const mon10 = t.blockAt(hand, 10 * 60);
    expect(mon10.do).toBe('work');
    const sun10 = t.blockAt(hand, 6 * 1440 + 10 * 60);
    expect(sun10.do).not.toBe('work');
    // 모든 사람: 월요일 일 블록이면 결과도 일 (변형이 덮지 않음)
    for (const p of sim.persons) {
      const tpl = (t as unknown as { templateOf(p: Person): { blocks: { from: number; to: number; do?: string }[] } | null }).templateOf(p);
      const w = tpl?.blocks.find((b) => b.do === 'work' && b.from < b.to);
      if (!w) continue;
      expect(t.blockAt(p, w.from * 60 + 30).do).toBe('work');
    }
  });

  it('세밀도 전환: 승급 순간 위치가 1타일 이상 튀지 않고, 전 인물 전체/요약 강제에서 생애 통계 차이가 작음', () => {
    const sim = town(3);
    sim.apply({ kind: 'setView', x0: 0, y0: 60, x1: 50, y1: 95 });
    const last = new Map<number, { x: number; y: number; lod: string }>();
    let promotions = 0;
    let worst = 0;
    for (let i = 0; i < 18 * 60; i++) {
      // 화면을 천천히 옮김 (사람이 화면 안팎을 드나듦)
      if (i % 30 === 0) {
        const x0 = (i / 30) * 3;
        sim.apply({ kind: 'setView', x0, y0: 40, x1: x0 + 50, y1: 95 });
      }
      sim.tick();
      for (const p of sim.persons) {
        const prev = last.get(p.id);
        if (prev && prev.lod !== 'full' && p.lod === 'full') {
          promotions++;
          const d = Math.hypot(p.x - prev.x, (p.y % 151) - (prev.y % 151));
          // 한 틱 동안 걸을 수 있는 거리(말 2.5배) + 1타일
          worst = Math.max(worst, d - 2.5 * data.balance.movement.walkTilesPerMinute);
        }
        last.set(p.id, { x: p.x, y: p.y, lod: p.lod });
      }
    }
    expect(promotions).toBeGreaterThan(5);
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('생애 판정기: 같은 시드는 같은 결과 (요약 강제 10일)', () => {
    const run = () => {
      const sim = town(7);
      sim.apply({ kind: 'forceLod', lod: 'summary' });
      for (let i = 0; i < 10 * 1440; i++) sim.tick();
      return JSON.stringify({ s: sim.judge!.stats, n: sim.persons.map((p) => p.name + p.lifeStage + p.spouse) });
    };
    expect(run()).toBe(run());
  });

  it('소문: 큰 추문은 며칠 안에 여러 사람이 앎', () => {
    const sim = town(2);
    sim.apply({ kind: 'forceLod', lod: 'summary' });
    const subj = sim.persons.find((p) => p.household !== 1 && p.lifeStage === 'adult')!;
    const r = sim.rumors!.add('scandal', [subj], { a: subj.name }, sim.world.day(), 1.6, [subj]);
    for (let i = 0; i < 5 * 1440; i++) sim.tick();
    expect(r.knownBy.size).toBeGreaterThan(20);
  });

  it('말 타기: 말 가진 어른은 집 밖 먼 길에서 걷기의 2.5배, 가까우면 걸음', () => {
    const sim = town();
    const rider = sim.persons.find((p) => p.horse >= 0 && p.lifeStage === 'adult' && sim.world.grid.room[sim.world.grid.idx(p.cellX(), p.cellY())] < 0);
    const any = rider ?? sim.persons.find((p) => p.horse >= 0 && p.lifeStage === 'adult')!;
    expect(any).toBeTruthy();
    // 집 밖 칸에 세워 봄
    any.x = 110.5;
    any.y = 70.5;
    const mult = (sim as unknown as { rideMult(p: Person, r: number, n: number): number }).rideMult.bind(sim);
    expect(mult(any, 40, -1)).toBe(2.5);
    expect(any.riding).toBe(true);
    expect(mult(any, 2, -1)).toBe(1);
    const walker = sim.persons.find((p) => p.horse < 0 && p.lifeStage === 'adult')!;
    walker.x = 110.5;
    walker.y = 70.5;
    expect(mult(walker, 40, -1)).toBe(1);
  });

  it('물건 사용: 남의 사는 장소 침대, 빈 집 물건은 못 씀. 조작 가문은 밤에 집 밖 물건을 고르지 않음', () => {
    const sim = town();
    const t = sim.town!;
    const me = sim.persons.find((p) => p.household === 1)!;
    const castleBed = sim.world.objects.find((o) => o.defId.startsWith('bed') && t.placeOf(o.x, o.y)?.id === 'castle');
    if (castleBed) expect(canUse(sim, me, castleBed.uid)).toBe(false);
    const empty = t.lots.find((l) => l.house && !t.lotHousehold.has(l.id));
    if (empty) {
      const o = sim.world.objects.find((q) => t.lotOf(q.x, q.y)?.id === empty.id && q.defId !== 'window_opening');
      if (o) expect(canUse(sim, me, o.uid)).toBe(false);
    }
    const well = sim.world.objects.find((o) => t.placeOf(o.x, o.y)?.id === 'well_square' && o.defId.startsWith('well'))!;
    // 낮에는 장터 노점(볼일)은 멀어도 가능
    const stall = sim.world.objects.find((o) => o.defId === 'market_stall_food')!;
    expect(canUse(sim, me, stall.uid)).toBe(true);
    // 밤: 집 밖 물건은 볼일이어도 거부
    for (let i = 0; i < 16 * 60; i++) sim.tick();
    expect(sim.world.hour()).toBeGreaterThanOrEqual(22);
    expect(canUse(sim, me, well.uid)).toBe(false);
    // 자기 집 물건은 늘 가능
    const mine = sim.world.objects.find((o) => t.ownerOf(o.x, o.y) === 1)!;
    expect(canUse(sim, me, mine.uid)).toBe(true);
  });

  it('NPC 는 조작 가문 저장고를 쓰지 않음 (추상 창고)', () => {
    const sim = town(4);
    sim.apply({ kind: 'forceLod', lod: 'full' });
    for (const p of sim.persons) if (p.household === 1) p.hidden = true;
    const before = JSON.stringify(sim.world.stock);
    // 조작 가문이 숨어 있으면(행동 없음) 저장고는 NPC 활동으로 바뀌지 않아야 함
    const own = sim.persons.filter((p) => p.household === 1);
    for (const p of own) sim.persons.splice(sim.persons.indexOf(p), 1);
    for (let i = 0; i < 6 * 60; i++) sim.tick();
    expect(JSON.stringify(sim.world.stock)).toBe(before);
  });

  it('리뷰 회귀: 끊긴 가구는 부지를 돌려놓고, 새 가구 번호는 다시 쓰지 않음', () => {
    const sim = town(5);
    const t = sim.town!;
    const hh = sim.persons.find((p) => p.household !== 1 && t.lotHousehold.size && [...t.lotHousehold.values()].includes(p.household))!.household;
    const lot = [...t.lotHousehold].find(([, h]) => h === hh)![0];
    const kill = (sim as unknown as { killPerson(p: Person, c: string): void }).killPerson.bind(sim);
    for (const p of sim.persons.filter((q) => q.household === hh)) kill(p, 'illness');
    expect(t.lotHousehold.has(lot)).toBe(false);
    const nh = (sim as unknown as { newHouseholdId(): number }).newHouseholdId.bind(sim);
    const a = nh();
    const b = nh();
    expect(b).toBe(a + 1);
    expect(a).toBeGreaterThan(Math.max(...sim.persons.map((p) => p.household)));
  });

  it('이사와 건축 범위: 내 부지 밖은 못 고치고, 빈 땅을 사면 집값을 내고 옛집을 판 값을 받으며 건축 범위가 옮겨감', () => {
    const sim = town(6);
    const t = sim.town!;
    const old = t.playerLot()!;
    // 남의 땅(장터)에 벽 → 거부, 내 부지 안 → 허용
    const out = sim.apply({ kind: 'build', op: { op: 'wall', x0: 100, y0: 50, x1: 104, y1: 50, style: 'wall_timber' } }) as { ok: boolean; reason?: string };
    expect(out).toMatchObject({ ok: false, reason: 'outside_lot' });
    const inside = sim.apply({ kind: 'build', op: { op: 'wall', x0: old.rect[0] + 1, y0: old.rect[1] + 1, x1: old.rect[0] + 3, y1: old.rect[1] + 1, style: 'wall_timber' } }) as { ok: boolean; reason?: string };
    expect(inside.reason).not.toBe('outside_lot');
    const a = sim.econ!.account(1)!;
    const money0 = a.money;
    const target = t.lots.find((l) => !t.lotHousehold.has(l.id) && l.kind === 'empty')!;
    const r = sim.apply({ kind: 'moveHouse', lot: target.id }) as { ok: boolean; price: number; refund: number };
    expect(r.ok).toBe(true);
    expect(a.money).toBe(money0 + r.refund - target.price);
    expect(t.playerLot()?.id).toBe(target.id);
    expect(t.lotHousehold.has(old.id)).toBe(false);
    for (const p of sim.persons.filter((q) => q.household === 1)) expect(p.homeLot).toBe(target.id);
    // 이제 옛집은 남의 땅
    const again = sim.apply({ kind: 'build', op: { op: 'wall', x0: old.rect[0] + 1, y0: old.rect[1] + 2, x1: old.rect[0] + 3, y1: old.rect[1] + 2, style: 'wall_timber' } }) as { ok: boolean; reason?: string };
    expect(again.reason).toBe('outside_lot');
    // 누가 사는 집은 못 삼
    const taken = [...t.lotHousehold].find(([, h]) => h !== 1)![0];
    expect((sim.apply({ kind: 'moveHouse', lot: taken }) as { ok: boolean }).ok).toBe(false);
  });

  it('조사: 받침에 따라 이/가, 을/를, 은/는, 으로/로', () => {
    expect(josa('베르타이(가) 왔다')).toBe('베르타가 왔다');
    expect(josa('에드릭이(가) 왔다')).toBe('에드릭이 왔다');
    expect(josa('물을(를) 샀다')).toBe('물을 샀다');
    expect(josa('소은(는) 운다')).toBe('소는 운다');
    expect(josa('말은(는) 달린다')).toBe('말은 달린다');
    expect(josa('칼으로(로) 벴다')).toBe('칼로 벴다');
    expect(josa('집으로(로) 갔다')).toBe('집으로 갔다');
    expect(josa('에드윈와(과) 로즈')).toBe('에드윈과 로즈');
    expect(josa('마르타와(과) 에드릭')).toBe('마르타와 에드릭');
  });
});
