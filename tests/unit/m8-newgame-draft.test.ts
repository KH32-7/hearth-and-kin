/**
 * 가문 만들기 초안 (src/ui/FamilyCreator.ts): 21 프리셋 초안이 sim 검사(validateFamily)를 통과하고,
 * 역할 → 관계(부부 · 부모 · 형제 · 조카)가 맞게 만들어짐. 같은 시드 = 같은 사양 (sim 에 넘기는 값은 결정적)
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/core/rng';
import { validateFamily } from '../../src/sim/family/creation';
import { draftFromPreset, draftToSpec, G, PRESETS } from '../../src/ui/FamilyCreator';
import { wantsNewGame } from '../../src/ui/newGameMode';

describe('새 게임 · 가문 만들기 초안', () => {
  it('21 프리셋 초안이 모두 검사 통과', () => {
    for (const p of PRESETS.presets) {
      const d = draftFromPreset(p.id, new Rng(7));
      const issues = validateFamily(G, draftToSpec(d));
      expect(issues, p.id).toEqual([]);
      expect(d.members.filter((x) => x.role === 'head')).toHaveLength(1);
      expect(draftToSpec(d).clan === null, p.id).toBe(p.estate === 'serf');
    }
  });

  it('성직자 가족: 아이는 형제 부부의 자녀(조카), 가장은 혼인하지 않음', () => {
    const d = draftFromPreset('clergy_normal', new Rng(3));
    const spec = draftToSpec(d);
    const head = d.members.find((x) => x.role === 'head')!.m.key;
    const nephew = d.members.find((x) => x.role === 'nephew')!.m.key;
    expect(spec.relations.some((r) => r.kind === 'spouse' && (r.a === head || r.b === head))).toBe(false);
    expect(spec.relations.filter((r) => r.kind === 'parent' && r.b === nephew)).toHaveLength(2);
  });

  it('같은 시드면 같은 사양', () => {
    const a = draftToSpec(draftFromPreset('artisan_rich', new Rng(11)));
    const b = draftToSpec(draftFromPreset('artisan_rich', new Rng(11)));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('새 게임 흐름은 명시 인자가 없거나 ?new=1 일 때만', () => {
    expect(wantsNewGame('')).toBe(true);
    expect(wantsNewGame('?new=1&town=ashford')).toBe(true);
    expect(wantsNewGame('?new=0')).toBe(false);
    expect(wantsNewGame('?town=ashford')).toBe(false);
    expect(wantsNewGame('?lot=empty')).toBe(false);
    expect(wantsNewGame('?preset=serf_normal')).toBe(false);
  });
});
