/**
 * 저장/불러오기 (GDD 27-5, BRIEF 6장 "저장/불러오기 해시 일치"): 그래프 부호화 경계 사례 + 마을 sim 왕복 결정론
 */
import { describe, expect, it } from 'vitest';
import { decodeInto, encodeGraph } from '../../src/sim/save/graph';
import { loadSimData } from '../../tools/data-node';
import { Simulation } from '../../src/sim/sim';
import { loadSimInto, saveSim, SAVE_CLASSES } from '../../src/sim/save/save';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

class Box {
  n = 0;
  host = { tick: () => this.n };
  inner: Box | null = null;
}

describe('저장 그래프', () => {
  it('Map(객체 키) · Set · 형식 배열 · NaN/Infinity/undefined · 순환 참조 · 데이터 참조를 되살림', () => {
    const data = { items: { bread: { price: 3 } }, list: [{ a: 1 }] };
    const shared = { v: 1 };
    const root: Record<string, unknown> = {
      m: new Map<unknown, unknown>([[shared, 'obj-key'], ['k', shared]]),
      s: new Set([1, 'x', shared]),
      f: new Float64Array([1.5, -2, Infinity]),
      u8: new Uint8Array([0, 255, 7]),
      nums: [NaN, Infinity, -Infinity, undefined],
      ref: data.items.bread,
      box: new Box(),
    };
    root.self = root;
    (root.box as Box).n = 5;
    const json = encodeGraph(root, data, { Box });
    const fresh: Record<string, unknown> = { box: new Box() };
    const keepHost = (fresh.box as Box).host;
    decodeInto(json, fresh, data, { Box });
    const m = fresh.m as Map<unknown, unknown>;
    const key = [...m.keys()][0] as { v: number };
    expect(m.get(key)).toBe('obj-key');
    expect(m.get('k')).toBe(key);
    expect([...(fresh.s as Set<unknown>)].includes(key)).toBe(true);
    expect(Array.from(fresh.f as Float64Array)).toEqual([1.5, -2, Infinity]);
    expect(Array.from(fresh.u8 as Uint8Array)).toEqual([0, 255, 7]);
    const nums = fresh.nums as unknown[];
    expect(Number.isNaN(nums[0])).toBe(true);
    expect(nums.slice(1, 3)).toEqual([Infinity, -Infinity]);
    expect(nums.length).toBe(4);
    expect(nums[3]).toBeUndefined();
    expect(fresh.ref).toBe(data.items.bread);
    expect(fresh.self).toBe(fresh);
    // 같은 자리 클래스 객체는 제자리로: 생성자 콜백(host)이 붙잡은 this 가 그대로 살아 있음
    expect((fresh.box as Box).host).toBe(keepHost);
    expect(keepHost.tick()).toBe(5);
  });

  it('속성 순서까지 되살림 (Object.keys 순회 순서도 결정론의 일부)', () => {
    const data = {};
    const saved = { b: 1, a: 2 };
    const fresh = { a: 0, b: 0 };
    decodeInto(encodeGraph(saved, data, {}), fresh, data, {});
    expect(Object.keys(fresh)).toEqual(['b', 'a']);
  });

  it('저장 뒤 코드에 새로 생긴 클래스 필드는 생성자 기본값으로 남음 (옛 저장본)', () => {
    class Old {
      b = 1;
      a = 2;
    }
    class New {
      a = 0;
      b = 0;
      added = 'default';
    }
    const data = {};
    const saved = new Old();
    saved.a = 7;
    const fresh = { x: new New() };
    decodeInto(encodeGraph({ x: saved }, data, { K: Old }), fresh, data, { K: New });
    expect(fresh.x).toMatchObject({ a: 7, b: 1, added: 'default' });
  });

  it('함수만 든 등록표(Map)는 새 객체 것을 그대로 둠', () => {
    const data = {};
    const f = () => 1;
    const fresh = { gates: new Map<string, unknown>([['g', f]]) };
    decodeInto(encodeGraph({ gates: new Map([['g', () => 2]]) }, data, {}), fresh, data, {});
    expect(fresh.gates.get('g')).toBe(f);
  });
});

describe('저장 클래스 표', () => {
  it('src/sim 의 모든 클래스가 고정 키로 등록됨 (배포 빌드의 이름 압축과 무관하게 되살림)', () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/^(?:export )?(?:default )?(?:abstract )?class (\w+)/gm)) found.push(m[1]);
      }
    };
    walk('src/sim');
    expect(found.filter((n) => !(n in SAVE_CLASSES))).toEqual([]);
  });
});

describe('마을 저장 왕복', () => {
  it('프리셋 가문 반나절 → 저장 → 불러온 쪽과 원본을 반나절 더 돌려도 그래프·해시가 같음', () => {
    const data = loadSimData({ town: 'ashford' });
    const a = new Simulation(data, 11);
    a.apply({ kind: 'house', op: 'applyPreset', args: { preset: 'artisan_normal' } } as never);
    for (let i = 0; i < 720; i++) a.tick();
    const s = saveSim(a, 11);
    const b = new Simulation(data, 11);
    loadSimInto(b, s);
    expect(saveSim(b, 11).graph).toBe(s.graph);
    expect(b.worldHash()).toBe(a.worldHash());
    for (let i = 0; i < 720; i++) {
      a.tick();
      b.tick();
    }
    expect(b.worldHash()).toBe(a.worldHash());
    expect(saveSim(b, 11).graph).toBe(saveSim(a, 11).graph);
    // 예산 (BRIEF 4장): 10MB 이하 (압축 전 기준으로도)
    expect(s.graph.length).toBeLessThan(10e6);
  }, 120_000);
});
