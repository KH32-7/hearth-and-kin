/**
 * 아기/유아 스프라이트 (lpc.json infant, tools/lpc/gen-infant.ts): 팩 항목, 시트 크기, 프레임 수, 합성 계획, 색 교체.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import packJson from '../../src/data/artpacks/lpc.json';
import outfitsJson from '../../src/data/outfits.json';
import { planInfant, infantFrameRect, infantLookFromSpec, type InfantLook } from '../../src/render/lpc/infant';
import { randomSpecWith } from '../../src/render/lpc/plan';
import type { LpcPack, OutfitsData } from '../../src/render/lpc/types';
import { readPng } from '../../tools/lpc/png';
import { renderPlan } from '../../tools/lpc/compose-node';

const pack = packJson as unknown as LpcPack;
const outfits = outfitsJson as unknown as OutfitsData;
const inf = pack.infant!;
const look: InfantLook = { skin: 'bronze', eyes: 'green', hairStyle: 'relm_short', hairColor: 'blonde', main: 'blue', accent: 'tan', garment: 'gown' };

describe('infant artpack', () => {
  it('has baby and toddler sections with the required frames/directions', () => {
    expect(inf).toBeTruthy();
    const b = inf.baby.anims;
    for (const a of ['cradle', 'cradle_cry', 'floor', 'floor_cry'] as const) {
      expect(b[a].frames).toBeGreaterThanOrEqual(2);
      expect(b[a].dirs).toEqual(['down']);
    }
    expect(b.held.dirs).toHaveLength(4);
    expect(b.held_cry.dirs).toHaveLength(4);
    const t = inf.toddler.anims;
    expect(t.crawl.frames).toBeGreaterThanOrEqual(4);
    expect(t.walk.frames).toBeGreaterThanOrEqual(6);
    expect(t.fall.frames).toBeGreaterThanOrEqual(3);
    expect(t.sit.frames).toBeGreaterThanOrEqual(1);
    expect(t.sit.frames).toBeLessThanOrEqual(2);
    for (const a of ['idle', 'walk', 'crawl', 'sit', 'fall'] as const) expect(t[a].dirs).toHaveLength(4);
    expect(Object.keys(inf.toddler.garments).sort()).toEqual(['gown', 'smock', 'tunic']);
    // 모든 아동 머리 모양에 유아 시트가 있음
    for (const sex of ['male', 'female'] as const) for (const st of outfits.hair.styles[sex].child) expect(inf.toddler.hair[`hair_${st}`]).toBeTruthy();
  });

  it('layer sheets exist with the declared size and animations fit inside', () => {
    for (const [part, layers] of [
      ['baby', inf.baby.layers],
      ['toddler', [...inf.toddler.layers, ...Object.values(inf.toddler.garments), ...Object.values(inf.toddler.hair)]],
    ] as const) {
      const p = part === 'baby' ? inf.baby : inf.toddler;
      for (const l of layers) {
        const path = `${pack.roots.gen}${l.path}`;
        expect(existsSync(path), path).toBe(true);
        const img = readPng(path);
        expect(img.width).toBe(p.cols * inf.frameW);
        expect(img.height).toBe(p.rows * inf.frameH);
      }
      for (const a of Object.values(p.anims)) {
        expect(a.col + a.frames).toBeLessThanOrEqual(p.cols);
        expect(a.row + a.dirs.length).toBeLessThanOrEqual(p.rows);
      }
    }
  });

  it('plans recolour skin, hair, eyes and cloth like other LPC layers', () => {
    const plan = planInfant('toddler', look, pack);
    expect(plan.notes).toEqual([]);
    const skin = pack.palettes.body.colors.bronze;
    const body = plan.sources.find((s) => s.path.endsWith('toddler/body.png'))!;
    expect(body.recolor!.to).toEqual(expect.arrayContaining(skin.slice(1)));
    const hair = plan.sources.find((s) => s.path.includes('hair_relm_short'))!;
    expect(hair.recolor!.to).toEqual(expect.arrayContaining(pack.palettes.hair.colors.blonde.slice(2)));
    expect(plan.sources.some((s) => s.path.endsWith('toddler/gown.png'))).toBe(true);
    const baby = planInfant('baby', look, pack);
    expect(baby.sources.map((s) => s.path.split('/').pop())).toEqual(['mat.png', 'body.png', 'swaddle.png', 'hair.png', 'tears.png']);
  });

  it('looks follow the person spec (estate garment, deterministic)', () => {
    let s = 1;
    const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const spec = randomSpecWith(outfits, rng, { sex: 'female', stage: 'child', estate: 'noble' });
    const a = infantLookFromSpec(spec, outfits, pack);
    const b = infantLookFromSpec(spec, outfits, pack);
    expect(a).toEqual(b);
    expect(a.garment).toBe('gown');
    expect(a.skin).toBe(spec.skin);
    expect(outfits.dyes.noble.main).toContain(a.main);
  });

  it('every frame of the composed sheets has pixels', () => {
    for (const kind of ['baby', 'toddler'] as const) {
      const plan = planInfant(kind, look, pack);
      const img = renderPlan(plan);
      for (const [name, a] of Object.entries(plan.anims)) {
        for (const d of a.dirs) {
          for (let f = 0; f < a.frames; f++) {
            const r = infantFrameRect(plan, name, d, f)!;
            let n = 0;
            for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (img.data[((r.y + y) * img.width + r.x + x) * 4 + 3] > 0) n++;
            expect(n, `${kind}.${name}.${d}#${f}`).toBeGreaterThan(40);
          }
        }
      }
    }
  });
});
