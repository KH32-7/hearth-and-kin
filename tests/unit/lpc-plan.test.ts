import { describe, it, expect } from 'vitest';
import packJson from '../../src/data/artpacks/lpc.json';
import outfitsJson from '../../src/data/outfits.json';
import { planCharacter, randomSpecWith, resolveLayers, bodyTypeFor } from '../../src/render/lpc/plan';
import type { AnimName, CharacterSpec, LpcPack, OutfitsData, Plan } from '../../src/render/lpc/types';

const pack = packJson as unknown as LpcPack;
const outfits = outfitsJson as unknown as OutfitsData;

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const base: CharacterSpec = {
  sex: 'male', stage: 'adult', pregnant: 0, skin: 'light', hair: { style: 'plain', color: 'chestnut' },
  estate: 'serf', outfit: 'everyday', layers: { $seed: '42', $main: 'brown', $accent: 'gray', $trim: 'tan', $eyes: 'brown' },
};

/** ops whose destination lies in the cell (col, row) */
function cellOps(plan: Plan, col: number, row: number) {
  return plan.ops.filter((o) => Math.floor(o.dx / pack.frameW) === col && Math.floor(o.dy / pack.frameH) === row);
}

describe('LPC standard layout', () => {
  const names: AnimName[] = ['idle', 'walk', 'sit', 'emote', 'slash', 'thrust', 'shoot', 'spellcast', 'hurt', 'sleep', 'eat', 'carry', 'work'];

  it('defines every contract animation with non-overlapping rows inside the sheet', () => {
    const used = new Set<number>();
    for (const n of names) {
      const a = pack.anims[n];
      expect(a, n).toBeDefined();
      expect(a.frames).toBeLessThanOrEqual(pack.cols);
      for (let d = 0; d < a.dirs.length; d++) {
        const r = a.row + d;
        expect(used.has(r), `${n} row ${r}`).toBe(false);
        used.add(r);
        expect(r).toBeLessThan(pack.rows);
      }
    }
    expect(pack.frameW).toBe(64);
    expect(pack.dirs).toEqual(['up', 'left', 'down', 'right']);
  });

  it('has the expected frame counts', () => {
    expect(pack.anims.idle.frames).toBe(2);
    expect(pack.anims.walk.frames).toBe(8);
    expect(pack.anims.sit.frames).toBe(3);
    expect(pack.anims.hurt.frames).toBe(6);
    expect(pack.anims.sleep.frames).toBeGreaterThanOrEqual(1);
    expect(pack.anims.sleep.frames).toBeLessThanOrEqual(2);
    expect(pack.anims.eat.frames).toBe(3);
    expect(pack.anims.hurt.dirs).toEqual(['down']);
    expect(pack.anims.sleep.dirs).toEqual(['down']);
    expect(pack.anims.sit.poses?.chair).toBe(2);
  });
});

describe('planCharacter', () => {
  const plan = planCharacter(base, pack, outfits);

  it('draws every frame of walk and idle in all 4 directions', () => {
    for (const n of ['walk', 'idle'] as AnimName[]) {
      const a = plan.anims[n];
      expect(a.dirs).toEqual(['up', 'left', 'down', 'right']);
      for (let d = 0; d < 4; d++)
        for (let f = 0; f < a.frames; f++) expect(cellOps(plan, f, a.row + d).length, `${n} d${d} f${f}`).toBeGreaterThan(0);
    }
  });

  it('keeps ops integer-aligned and inside the sheet (no scaling)', () => {
    expect(plan.width).toBe(pack.cols * pack.frameW);
    expect(plan.height).toBe(pack.rows * pack.frameH);
    for (const o of plan.ops) {
      for (const v of [o.sx, o.sy, o.w, o.h, o.dx, o.dy]) expect(Number.isInteger(v)).toBe(true);
      expect(o.dx + o.w).toBeLessThanOrEqual(plan.width);
      expect(o.dy + o.h).toBeLessThanOrEqual(plan.height);
      expect(o.w).toBeLessThanOrEqual(pack.frameW);
      // an op never crosses a frame boundary
      expect(Math.floor(o.dx / 64)).toBe(Math.floor((o.dx + o.w - 1) / 64));
      expect(Math.floor(o.sx / 64)).toBe(Math.floor((o.sx + o.w - 1) / 64));
    }
  });

  it('draws layers in z order: body < clothes < head < hair', () => {
    const ops = cellOps(plan, 0, pack.anims.walk.row + 2);
    const idx = (frag: string) => ops.findIndex((o) => plan.sources[o.s].path.includes(frag));
    const body = idx('body/bodies/male/');
    const head = idx('head/heads/human/');
    const hair = idx('/hair/');
    const torso = idx('torso/');
    expect(body).toBeGreaterThanOrEqual(0);
    expect(head).toBeGreaterThan(body);
    if (torso >= 0) {
      expect(torso).toBeGreaterThan(body);
      expect(torso).toBeLessThan(head);
    }
    if (hair >= 0) expect(hair).toBeGreaterThan(head);
  });

  it('is deterministic', () => {
    expect(planCharacter(base, pack, outfits)).toEqual(plan);
    const a = randomSpecWith(outfits, mulberry32(9));
    const b = randomSpecWith(outfits, mulberry32(9));
    expect(a).toEqual(b);
  });

  it('crops sleep frames to head + shoulders', () => {
    const row = plan.anims.sleep.row;
    const ops = plan.ops.filter((o) => Math.floor(o.dy / 64) === row);
    expect(ops.length).toBeGreaterThan(0);
    for (const o of ops) expect(o.dy % 64 + o.h).toBeLessThanOrEqual(plan.sleepCropY);
  });

  it('lists credits with authors and licenses', () => {
    expect(plan.credits.length).toBeGreaterThan(0);
    for (const c of plan.credits) {
      expect(c.authors.length).toBeGreaterThan(0);
      expect(c.licenses.length).toBeGreaterThan(0);
    }
  });
});

describe('body types and fallbacks', () => {
  it('maps stages to LPC body types', () => {
    expect(bodyTypeFor({ sex: 'female', stage: 'child' })).toBe('child');
    expect(bodyTypeFor({ sex: 'male', stage: 'teen' })).toBe('teen');
    expect(bodyTypeFor({ sex: 'female', stage: 'adult', pregnant: 2 })).toBe('pregnant');
    expect(bodyTypeFor({ sex: 'male', stage: 'elder' })).toBe('male');
  });

  it('dresses children in child garments and records missing child animations', () => {
    const plan = planCharacter({ ...base, stage: 'child' }, pack, outfits);
    expect(plan.bodyType).toBe('child');
    expect(plan.layers.some((l) => l.id.startsWith('child_'))).toBe(true);
    expect(plan.fallbacks.some((f) => f.startsWith('thrust'))).toBe(true);
    for (let d = 0; d < 4; d++) expect(cellOps(plan, 0, plan.anims.walk.row + d).length).toBeGreaterThan(0);
  });

  it('gives elders an elderly head and wrinkles', () => {
    const r = resolveLayers({ ...base, stage: 'elder' }, pack, outfits);
    expect(r.layers.find((l) => l.slot === 'head')?.id).toContain('elderly');
    expect(r.layers.some((l) => l.id === 'head_wrinkles')).toBe(true);
  });

  it('uses the pregnant body and records the female-body fallback for sitting', () => {
    const plan = planCharacter({ ...base, sex: 'female', pregnant: 2, hair: { style: 'long', color: 'blonde' } }, pack, outfits);
    expect(plan.bodyType).toBe('pregnant');
    expect(plan.sources.some((s) => s.path.includes('body/bodies/pregnant/'))).toBe(true);
  });

  it('produces a sheet with walk frames for every estate, sex and stage', () => {
    const rng = mulberry32(1234);
    for (const estate of ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'] as const)
      for (const sex of ['male', 'female'] as const)
        for (const stage of ['child', 'teen', 'adult', 'elder'] as const) {
          const spec = randomSpecWith(outfits, rng, { estate, sex, stage });
          const plan = planCharacter(spec, pack, outfits);
          expect(plan.fallbacks.filter((f) => f.startsWith('unknown')), `${estate}/${sex}/${stage}`).toEqual([]);
          expect(cellOps(plan, 0, plan.anims.walk.row + 2).length).toBeGreaterThan(2);
        }
  });
});
