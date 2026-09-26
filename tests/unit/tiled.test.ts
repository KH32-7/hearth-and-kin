import { describe, expect, it } from 'vitest';
import lot from '../fixtures/lot.json';
import { lotFromTiled, lotToTiled } from '../../src/sim/world/tiled';
import type { LotDef } from '../../src/sim/core/types';

describe('Tiled 로더', () => {
  it('부지 → .tmj → 부지 왕복이 같음', () => {
    const src = lot as unknown as LotDef;
    const map = lotToTiled(src, 32);
    const back = lotFromTiled(JSON.parse(JSON.stringify(map)));
    expect(back.w).toBe(src.w);
    expect(back.h).toBe(src.h);
    expect(back.ground).toEqual(src.ground);
    expect(back.floor).toEqual(src.floor);
    expect(back.walls).toEqual(src.walls);
    expect(back.objects).toEqual(src.objects.map((o) => (o.rot ? o : { id: o.id, x: o.x, y: o.y })));
    expect(back.openings).toEqual(src.openings);
    expect(back.spawn).toEqual(src.spawn);
  });

  it('뒤집기 비트가 붙은 gid도 읽고, id 없는 gid는 거부', () => {
    const map = lotToTiled(lot as unknown as LotDef, 32);
    const ground = map.layers.find((l) => l.name === 'ground')!;
    const first = ground.data![0];
    ground.data![0] = first | 0x80000000;
    expect(lotFromTiled(map).ground[0]).toBe((lot as unknown as LotDef).ground[0]);
    ground.data![0] = 999;
    expect(() => lotFromTiled(map)).toThrow();
  });
});
