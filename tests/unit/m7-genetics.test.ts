/**
 * M7 유전 (GDD 10-3), 이름 (10-4). BRIEF M7 통과 조건 "3대 유전 격세 재현 테스트" 포함.
 */
import { describe, expect, it } from 'vitest';
import geneticsRaw from '../../src/data/genetics.json';
import outfitsJson from '../../src/data/outfits.json';
import lpcPack from '../../src/data/artpacks/lpc.json';
import traitsJson from '../../src/data/traits.json';
import namesRaw from '../../src/data/names.json';
import clanRaw from '../../src/data/clan_names.json';
import koGenetics from '../../src/i18n/ko/genetics.json';
import { Rng } from '../../src/sim/core/rng';
import {
  carriesHidden, express, eyeColorOf, familyFace, geneticsFrom, hairColorOf, inherit, parseGenetics, randomGenome,
  type Genome,
} from '../../src/sim/family/genetics';
import {
  bynamePatterns, formatName, giveByname, nameParts, parseClanNames, parseNames, pickClanName, pickName,
} from '../../src/sim/family/names';

const G = parseGenetics(geneticsRaw);
const ko = koGenetics as Record<string, string>;

function genome(over: Partial<Genome> = {}): Genome {
  return {
    v: 1, skin: 5, hair: ['chestnut', 'chestnut'], eyes: ['brown', 'brown'], eyeShape: 'round', brows: 'straight',
    build: 'average', height: 'average', congenital: [], seed: 12345, origin: null, mutated: [], ...over,
  };
}

describe('genetics.json 과 렌더러/특성 데이터가 맞음', () => {
  const outfits = outfitsJson as unknown as {
    skins: string[]; eyes: string[];
    hair: { colors: string[]; elderColors: string[]; styles: Record<string, Record<string, string[]>>; beards: string[] };
  };
  const pack = lpcPack as unknown as { layers: Record<string, unknown>; palettes: Record<string, { colors: Record<string, unknown> }> };

  it('피부 12단계 = LPC 피부 팔레트, 머리 자연색 10 + 백발/회색, 눈색 4', () => {
    expect(G.skin.steps).toHaveLength(12);
    expect(G.skin.steps).toEqual(outfits.skins);
    for (const s of G.skin.steps) expect(pack.palettes.body.colors[s]).toBeDefined();
    expect(G.hair.natural).toHaveLength(10);
    expect([...G.hair.natural].sort()).toEqual([...outfits.hair.colors].sort());
    expect(G.hair.elder).toEqual(['gray', 'white']);
    for (const c of G.hair.elder) expect(outfits.hair.elderColors).toContain(c);
    expect(G.eyes.dominance).toEqual(['brown', 'green', 'blue', 'gray']);
    for (const c of G.eyes.colors) expect(pack.palettes.eye.colors[c]).toBeDefined();
  });

  it('머리 모양/수염/머리 레이어/옷 색이 렌더러에 있음', () => {
    for (const sex of ['male', 'female'] as const) {
      for (const st of ['child', 'teen', 'adult', 'elder'] as const) {
        expect(G.art.hairStyles[sex][st]).toEqual(outfits.hair.styles[sex][st]);
      }
    }
    for (const b of G.art.beards) expect(outfits.hair.beards).toContain(b);
    for (const byStage of Object.values(G.art.heads)) for (const id of Object.values(byStage)) expect(pack.layers[id]).toBeDefined();
    for (const d of G.dyes.list) for (const c of d.colors) expect(pack.palettes.cloth.colors[c], c).toBeDefined();
  });

  it('선천 특성 목록 = traits.json congenital 9종', () => {
    const t = (traitsJson as unknown as { traits: Record<string, { category: string }> }).traits;
    const congenital = Object.entries(t).filter(([, x]) => x.category === 'congenital').map(([id]) => id).sort();
    expect(congenital).toHaveLength(9);
    expect([...G.congenital.ids].sort()).toEqual(congenital);
    expect(G.congenital.inherit).toBe(0.25);
    expect(G.mutation).toBe(0.1);
  });

  it('한국어 이름이 모두 있음 (피부, 머리, 눈, 눈 모양, 눈썹, 체형, 키, 걸음, 목소리, 염료)', () => {
    const keys = [
      ...G.skin.steps.map((s) => `genetics.skin.${s}`),
      ...[...G.hair.natural, ...G.hair.elder].map((s) => `genetics.hair.${s}`),
      ...G.eyes.colors.map((s) => `genetics.eyes.${s}`),
      ...G.parts.eyeShape.map((s) => `genetics.eyeShape.${s}`),
      ...G.parts.brows.map((s) => `genetics.brows.${s}`),
      ...G.parts.build.map((s) => `genetics.build.${s}`),
      ...G.parts.height.map((s) => `genetics.height.${s}`),
      ...G.marks.ids.map((s) => `genetics.mark.${s}`),
      ...Object.keys(G.gaits).map((s) => `genetics.gait.${s}`),
      ...Object.keys(G.voice.pitch).map((s) => `genetics.voice.pitch.${s}`),
      ...Object.keys(G.voice.mumble).map((s) => `genetics.voice.mumble.${s}`),
      ...G.dyes.list.map((d) => `genetics.dye.${d.id}`),
      ...G.dyes.list.flatMap((d) => d.colors).map((c) => `genetics.color.${c}`),
      ...G.creation.outfitKinds.map((k) => `genetics.outfit.${k}`),
    ];
    for (const k of keys) expect(ko[k], k).toBeTruthy();
    expect(Object.keys(G.gaits)).toHaveLength(4);
    expect(Object.keys(G.voice.pitch)).toHaveLength(3);
    expect(Object.keys(G.voice.mumble)).toHaveLength(3);
    expect(G.parts.build).toHaveLength(4);
    expect(G.parts.height).toHaveLength(3);
  });

  it('SimData.family 에서 읽고, 없으면 꺼짐', () => {
    expect(geneticsFrom({ genetics: geneticsRaw })).not.toBeNull();
    expect(geneticsFrom({})).toBeNull();
    expect(() => parseGenetics({ ...geneticsRaw, mutation: 2 })).toThrow();
  });
});

describe('유전 (10-3)', () => {
  it('같은 시드 = 같은 아이 (결정론)', () => {
    const m = randomGenome(G, new Rng(1));
    const f = randomGenome(G, new Rng(2));
    expect(inherit(G, m, f, new Rng(99))).toEqual(inherit(G, m, f, new Rng(99)));
    expect(randomGenome(G, new Rng(7))).toEqual(randomGenome(G, new Rng(7)));
  });

  it('피부 = 부모 두 값 사이 + ±1단계 (12단계 안)', () => {
    const seen = new Set<number>();
    for (let s = 1; s <= 600; s++) {
      const c = inherit(G, genome({ skin: 3 }), genome({ skin: 7 }), new Rng(s));
      expect(c.skin).toBeGreaterThanOrEqual(2);
      expect(c.skin).toBeLessThanOrEqual(8);
      seen.add(c.skin);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    for (let s = 1; s <= 200; s++) {
      const same = inherit(G, genome({ skin: 5 }), genome({ skin: 5 }), new Rng(s)).skin;
      expect(Math.abs(same - 5)).toBeLessThanOrEqual(1);
      const edge = inherit(G, genome({ skin: 0 }), genome({ skin: 0 }), new Rng(s)).skin;
      expect(edge).toBeGreaterThanOrEqual(0);
      expect(edge).toBeLessThanOrEqual(1);
      const top = inherit(G, genome({ skin: 11 }), genome({ skin: 11 }), new Rng(s)).skin;
      expect(top).toBeLessThanOrEqual(11);
    }
  });

  it('짙은 색 우성, 갈 > 초 > 파 > 회', () => {
    expect(hairColorOf(G, genome({ hair: ['blonde', 'black'] }))).toBe('black');
    expect(hairColorOf(G, genome({ hair: ['redhead', 'blonde'] }))).toBe('redhead');
    expect(eyeColorOf(G, genome({ eyes: ['blue', 'green'] }))).toBe('green');
    expect(eyeColorOf(G, genome({ eyes: ['gray', 'blue'] }))).toBe('blue');
    expect(eyeColorOf(G, genome({ eyes: ['gray', 'brown'] }))).toBe('brown');
    expect(eyeColorOf(G, genome({ eyes: ['gray', 'gray'] }))).toBe('gray');
  });

  it('3대 유전 격세 재현: 조부모의 금발·파란 눈이 부모 대에 숨었다가 손주에게 다시 나옴, 대립 유전자 기록이 설명함', () => {
    // 1대: 외할머니 금발/파란 눈, 외할아버지 검은 머리/갈색 눈. 친할머니 금발/파란 눈, 친할아버지 짙은 갈색/초록 눈
    const gmM = genome({ hair: ['blonde', 'blonde'], eyes: ['blue', 'blue'], seed: 1 });
    const gfM = genome({ hair: ['black', 'black'], eyes: ['brown', 'brown'], seed: 2 });
    const gmF = genome({ hair: ['blonde', 'blonde'], eyes: ['blue', 'blue'], seed: 3 });
    const gfF = genome({ hair: ['dark_brown', 'dark_brown'], eyes: ['green', 'green'], seed: 4 });
    // 2대: 어머니 = 외조부모의 딸, 아버지 = 친조부모의 아들
    const mother = inherit(G, gmM, gfM, new Rng(11));
    const father = inherit(G, gmF, gfF, new Rng(12));
    for (const p of [mother, father]) {
      expect(hairColorOf(G, p)).not.toBe('blonde');
      expect(eyeColorOf(G, p)).not.toBe('blue');
      expect(carriesHidden(G, p, 'hair', 'blonde')).toBe(true);
      expect(carriesHidden(G, p, 'eyes', 'blue')).toBe(true);
    }
    // 3대: 시드를 돌려 금발 + 파란 눈 손주를 찾음 (1/16)
    let found: { seed: number; child: Genome } | null = null;
    for (let s = 1; s <= 200 && !found; s++) {
      const child = inherit(G, mother, father, new Rng(s));
      if (hairColorOf(G, child) === 'blonde' && eyeColorOf(G, child) === 'blue') found = { seed: s, child };
    }
    expect(found, '200 시드 안에 격세유전 손주가 있음').not.toBeNull();
    const { child, seed } = found!;
    // 같은 시드로 다시 해도 같은 손주
    expect(inherit(G, mother, father, new Rng(seed))).toEqual(child);
    // 대립 유전자 기록: [어머니 쪽, 아버지 쪽], origin 은 부모의 몇 번째 유전자였는지
    expect(child.hair).toEqual(['blonde', 'blonde']);
    expect(child.eyes).toEqual(['blue', 'blue']);
    expect(child.origin).not.toBeNull();
    const o = child.origin!;
    expect(mother.hair[o.hair[0]]).toBe('blonde');
    expect(father.hair[o.hair[1]]).toBe('blonde');
    expect(mother.eyes[o.eyes[0]]).toBe('blue');
    expect(father.eyes[o.eyes[1]]).toBe('blue');
    // 그 부모 유전자는 다시 조부모에게서 온 것: 어머니의 금발은 외할머니(어머니의 어머니 = [0] 자리)에게서
    expect(o.hair[0]).toBe(0);
    expect(mother.origin!.hair[0]).toBeGreaterThanOrEqual(0);
    expect(gmM.hair[mother.origin!.hair[0]]).toBe('blonde');
    expect(o.hair[1]).toBe(0);
    expect(gmF.hair[father.origin!.hair[0]]).toBe('blonde');
    expect(gmM.eyes[mother.origin!.eyes[0]]).toBe('blue');
    expect(gmF.eyes[father.origin!.eyes[0]]).toBe('blue');
    // 표현형도 금발 + 파란 눈
    const look = express(G, child, 'female', 'young');
    expect(look.hair.color).toBe('blonde');
    expect(look.layers.$eyes).toBe('blue');
  });

  it('보인자 × 보인자 → 열성 표현 약 25% (멘델)', () => {
    const m = genome({ hair: ['chestnut', 'redhead'], eyes: ['brown', 'gray'] });
    const f = genome({ hair: ['redhead', 'black'], eyes: ['gray', 'green'] });
    const n = 4000;
    let red = 0;
    let gray = 0;
    for (let s = 1; s <= n; s++) {
      const c = inherit(G, m, f, new Rng(s * 7919));
      if (hairColorOf(G, c) === 'redhead') red++;
      if (eyeColorOf(G, c) === 'gray') gray++;
    }
    expect(red / n).toBeGreaterThan(0.22);
    expect(red / n).toBeLessThan(0.28);
    expect(gray / n).toBeGreaterThan(0.22);
    expect(gray / n).toBeLessThan(0.28);
  });

  it('선천 특성: 부모 한쪽에 있으면 약 25%, 없으면 0, 서로 반대 특성은 같이 안 가짐', () => {
    const n = 4000;
    let got = 0;
    let none = 0;
    for (let s = 1; s <= n; s++) {
      if (inherit(G, genome({ congenital: ['robust'] }), genome(), new Rng(s)).congenital.includes('robust')) got++;
      if (inherit(G, genome(), genome(), new Rng(s)).congenital.length) none++;
      const both = inherit(G, genome({ congenital: ['robust', 'comely'] }), genome({ congenital: ['frail', 'homely'] }), new Rng(s)).congenital;
      expect(both.includes('robust') && both.includes('frail')).toBe(false);
      expect(both.includes('comely') && both.includes('homely')).toBe(false);
    }
    expect(got / n).toBeGreaterThan(0.22);
    expect(got / n).toBeLessThan(0.28);
    expect(none).toBe(0);
  });

  it('눈 모양/눈썹/체형/키: 부모 중 하나 50:50, 10% 변이', () => {
    const m = genome({ eyeShape: 'round', brows: 'thin', build: 'thin', height: 'short' });
    const f = genome({ eyeShape: 'narrow', brows: 'thick', build: 'stocky', height: 'tall' });
    const n = 4000;
    let fromMother = 0;
    let mutated = 0;
    for (let s = 1; s <= n; s++) {
      const c = inherit(G, m, f, new Rng(s));
      if (c.mutated.includes('build')) mutated++;
      else {
        expect([m.build, f.build]).toContain(c.build);
        if (c.build === m.build) fromMother++;
      }
      if (!c.mutated.includes('eyeShape')) expect([m.eyeShape, f.eyeShape]).toContain(c.eyeShape);
    }
    expect(mutated / n).toBeGreaterThan(0.08);
    expect(mutated / n).toBeLessThan(0.12);
    expect(fromMother / (n - mutated)).toBeGreaterThan(0.46);
    expect(fromMother / (n - mutated)).toBeLessThan(0.54);
  });
});

describe('표현형 (express → 렌더러 appearance)', () => {
  it('CharacterSpec 키와 값 범위', () => {
    const outfits = outfitsJson as unknown as { skins: string[]; eyes: string[]; hair: { colors: string[]; elderColors: string[] } };
    for (let s = 1; s <= 50; s++) {
      const gn = randomGenome(G, new Rng(s));
      for (const stage of ['baby', 'toddler', 'child', 'teen', 'young', 'adult', 'elder'] as const) {
        for (const sex of ['male', 'female'] as const) {
          const a = express(G, gn, sex, stage, undefined, { estate: 'serf' });
          expect(['child', 'teen', 'adult', 'elder']).toContain(a.stage);
          expect(outfits.skins).toContain(a.skin);
          expect([...outfits.hair.colors, ...outfits.hair.elderColors]).toContain(a.hair.color);
          expect(G.art.hairStyles[sex][a.stage]).toContain(a.hair.style);
          expect(outfits.eyes).toContain(a.layers.$eyes);
          expect(a.estate).toBe('serf');
          expect(a.outfit).toBe('everyday');
          expect(a.layers.$seed).toMatch(/^\d+$/);
          if (sex === 'male' && (a.stage === 'child' || a.stage === 'teen')) expect(a.layers.$beard).toBe('none');
          if (sex === 'female') expect(a.layers.$beard).toBeUndefined();
        }
      }
    }
  });

  it('rng 없이는 같은 유전자 + 단계 = 같은 모습, 노년 흰머리는 대부분', () => {
    const gn = randomGenome(G, new Rng(3));
    expect(express(G, gn, 'male', 'adult')).toEqual(express(G, gn, 'male', 'adult'));
    let white = 0;
    for (let s = 1; s <= 500; s++) {
      const a = express(G, randomGenome(G, new Rng(s)), 'female', 'elder');
      if (G.hair.elder.includes(a.hair.color)) white++;
    }
    expect(white / 500).toBeGreaterThan(0.72);
    expect(white / 500).toBeLessThan(0.88);
  });

  it('체형은 성인 남성 머리 레이어로, 옷 색은 dyes 로', () => {
    const a = express(G, genome({ build: 'plump' }), 'male', 'adult', undefined, { dyes: { main: 'blue', accent: 'brown', trim: 'white' } });
    expect(a.layers.$head).toBe('heads_human_male_plump');
    expect(a.layers.$main).toBe('blue');
    expect(a.layers.$build).toBe('plump');
    expect(express(G, genome({ build: 'thin' }), 'male', 'adult').layers.$head).toBe('heads_human_male_gaunt');
    expect(express(G, genome({ build: 'thin' }), 'female', 'adult').layers.$head).toBeUndefined();
  });

  it('가문의 얼굴 = 가장 자주 나온 조합', () => {
    const a = genome({ hair: ['blonde', 'blonde'], eyes: ['blue', 'blue'] });
    const b = genome({ hair: ['black', 'black'] });
    const face = familyFace(G, [b, a, a, genome({ hair: ['blonde', 'redhead'], eyes: ['blue', 'gray'] }), b])!;
    // 동률(2:2)이면 먼저 나온 조합
    expect(face.hair).toBe('black');
    expect(face.count).toBe(2);
    const face2 = familyFace(G, [b, a, a, b, a])!;
    expect(face2.hair).toBe('blonde');
    expect(face2.eyes).toBe('blue');
    expect(face2.count).toBe(3);
    expect(face2.share).toBeCloseTo(0.6);
    expect(face2.sample).toBe(a);
    expect(familyFace(G, [])).toBeNull();
  });
});

describe('이름 (10-4)', () => {
  const N = parseNames(namesRaw);
  const C = parseClanNames(clanRaw);

  it('신분·성별 풀, 가족 안 겹치지 않음', () => {
    const pool = N.estates.serf.male;
    const taken = pool.slice(1);
    expect(pickName(N, new Rng(5), 'serf', 'male', taken)).toBe(pool[0]);
    const fam: string[] = [];
    const rng = new Rng(8);
    for (let i = 0; i < 30; i++) fam.push(pickName(N, rng, 'noble', i % 2 ? 'female' : 'male', fam));
    expect(new Set(fam).size).toBe(30);
    for (const n of fam) expect([...N.estates.noble.male, ...N.estates.noble.female]).toContain(n);
  });

  it('농노는 가문명 없이 "출신지의 이름", 자유민 이상은 "이름 가문명"', () => {
    expect(pickClanName(C, new Rng(1), 'serf')).toBeNull();
    const clan = pickClanName(C, new Rng(1), 'noble')!;
    expect(C.clans.find((c) => c.name === clan)!.estateHint).toBe('high');
    const serf = nameParts({ name: '톰', estate: 'serf', clan: null, origin: '애쉬포드' });
    expect(serf.key).toBe('name.serf');
    expect(formatName(ko[serf.key], serf.args)).toBe('애쉬포드의 톰');
    const free = nameParts({ name: '톰', estate: 'freeman', clan: '스미스' });
    expect(formatName(ko[free.key], free.args)).toBe('톰 스미스');
    expect(formatName(ko[nameParts({ name: '톰', estate: 'serf' }).key], { name: '톰' })).toBe('톰');
  });

  it('사건으로 별명이 붙음', () => {
    expect(giveByname(N, new Rng(1), 'career:smith', { name: '톰' })).toBe('대장장이 톰');
    expect(giveByname(N, new Rng(1), 'serf_origin', { name: '톰', place: '애쉬포드' })).toBe('애쉬포드의 톰');
    expect(giveByname(N, new Rng(1), 'serf_origin', { name: '톰' })).toBeNull();
    expect(giveByname(N, new Rng(1), 'no_such_event', { name: '톰' })).toBeNull();
    expect(bynamePatterns(N, 'trait:brave')).toEqual(['용감한 {name}']);
    const p = nameParts({ name: '톰', estate: 'freeman', clan: '스미스', byname: '대장장이 톰' });
    expect(formatName(ko[p.key], p.args)).toBe('대장장이 톰');
  });
});
