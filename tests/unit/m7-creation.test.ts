/**
 * M7 가문 만들기 (GDD 10-1): 검사, 무작위, 닮게, 걸음/목소리, 옷 염료(16-2), 내보내기/불러오기, 복장 자동 전환 표.
 */
import { describe, expect, it } from 'vitest';
import geneticsRaw from '../../src/data/genetics.json';
import namesRaw from '../../src/data/names.json';
import koGenetics from '../../src/i18n/ko/genetics.json';
import { Rng } from '../../src/sim/core/rng';
import { hairColorOf, parseGenetics } from '../../src/sim/family/genetics';
import { parseNames } from '../../src/sim/family/names';
import {
  allowedDyeColors, dyeOfColor, exportFamily, exportPerson, gaitParams, importFamily, importPerson, kinDegree,
  memberAppearance, memberRuntime, RANDOM_PARTS, randomDyes, randomizePart, randomMember, resembleFamily, validateFamily, voiceParams,
  type FamilySpec, type IssueCode, type MemberSpec, type RelSpec,
} from '../../src/sim/family/creation';
import type { LifeStage } from '../../src/sim/people/person';
import { outfitFor, rudeAtFuneral, OUTFIT_KINDS, type OutfitActivity } from '../../src/sim/people/outfits';

const G = parseGenetics(geneticsRaw);
const N = parseNames(namesRaw);
const ko = koGenetics as Record<string, string>;

function member(key: string, sex: 'male' | 'female', stage: LifeStage, over: Partial<MemberSpec> = {}, seed = 1): MemberSpec {
  const m = randomMember(G, N, new Rng(seed * 101 + [...key].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7)), { key, estate: over.estate ?? 'freeman', sex, stage, servant: over.servant });
  return { ...m, ...over };
}

function family(members: MemberSpec[], relations: RelSpec[], estate = 'freeman', clan: string | null = '스미스'): FamilySpec {
  return { v: 1, clan, estate, members, relations };
}

const codes = (spec: FamilySpec): IssueCode[] => validateFamily(G, spec).map((i) => i.code);

/** 3대 가족: 할머니 - 아버지 + 어머니 - 아들 딸 + 하인 */
function basicFamily(): FamilySpec {
  return family(
    [
      member('grandma', 'female', 'elder'),
      member('dad', 'male', 'adult'),
      member('mom', 'female', 'young'),
      member('son', 'male', 'child'),
      member('daughter', 'female', 'toddler'),
      member('maid', 'female', 'teen', { servant: true, estate: 'serf' }),
    ],
    [
      { a: 'grandma', b: 'dad', kind: 'parent' },
      { a: 'dad', b: 'mom', kind: 'spouse' },
      { a: 'dad', b: 'son', kind: 'parent' },
      { a: 'mom', b: 'son', kind: 'parent' },
      { a: 'dad', b: 'daughter', kind: 'parent' },
      { a: 'mom', b: 'daughter', kind: 'parent' },
      { a: 'son', b: 'daughter', kind: 'sibling' },
      { a: 'grandma', b: 'son', kind: 'grandparent' },
    ],
  );
}

describe('가족 사양 검사', () => {
  it('정상 3대 가족 + 하인은 통과', () => {
    expect(validateFamily(G, basicFamily())).toEqual([]);
  });

  it('조작 가능 9명은 거부, 8명 + 하인 4명은 통과, 하인 포함 13명은 거부', () => {
    const eight = Array.from({ length: 8 }, (_, i) => member(`p${i}`, i % 2 ? 'female' : 'male', 'young', {}, i));
    expect(codes(family(eight, []))).toEqual([]);
    const nine = [...eight, member('p8', 'male', 'young', {}, 9)];
    expect(codes(family(nine, []))).toContain('too_many_members');
    const servants = Array.from({ length: 4 }, (_, i) => member(`s${i}`, 'female', 'young', { servant: true }, 20 + i));
    expect(codes(family([...eight, ...servants], []))).toEqual([]);
    const oneMore = member('s4', 'male', 'young', { servant: true }, 30);
    const c = codes(family([...eight, ...servants, oneMore], []));
    expect(c).toContain('household_full');
    expect(c).not.toContain('too_many_members');
  });

  it('근친 배우자 거부 (4촌 이내), 5촌은 허용', () => {
    // 형제끼리
    const sib = family([member('a', 'male', 'young'), member('b', 'female', 'young')], [
      { a: 'a', b: 'b', kind: 'sibling' },
      { a: 'a', b: 'b', kind: 'spouse' },
    ]);
    expect(codes(sib)).toContain('spouse_kin');
    // 사촌끼리
    const cousin = family([member('a', 'male', 'young'), member('b', 'female', 'young')], [
      { a: 'a', b: 'b', kind: 'cousin' },
      { a: 'a', b: 'b', kind: 'spouse' },
    ]);
    expect(codes(cousin)).toContain('spouse_kin');
    // 부모 형제를 통한 사촌 (부모-형제-자식 = 1+2+1 = 4촌)
    const derived = family(
      [member('p1', 'male', 'adult'), member('p2', 'female', 'adult'), member('c1', 'male', 'young'), member('c2', 'female', 'young')],
      [
        { a: 'p1', b: 'p2', kind: 'sibling' },
        { a: 'p1', b: 'c1', kind: 'parent' },
        { a: 'p2', b: 'c2', kind: 'parent' },
        { a: 'c1', b: 'c2', kind: 'spouse' },
      ],
    );
    expect(kinDegree(derived, 'c1', 'c2')).toBe(4);
    expect(codes(derived)).toContain('spouse_kin');
    // 5촌 (사촌의 자식)
    const fifth = family(
      [member('a', 'male', 'adult'), member('b', 'female', 'adult'), member('bk', 'female', 'young')],
      [
        { a: 'a', b: 'b', kind: 'cousin' },
        { a: 'b', b: 'bk', kind: 'parent' },
        { a: 'a', b: 'bk', kind: 'spouse' },
      ],
    );
    expect(kinDegree(fifth, 'a', 'bk')).toBe(5);
    expect(codes(fifth)).not.toContain('spouse_kin');
    // 부모 쪽 배우자 관계는 혈연이 아님 (시어머니와 며느리 사이 0촌 아님)
    expect(kinDegree(basicFamily(), 'grandma', 'mom')).toBe(Infinity);
  });

  it('나이·관계 모순', () => {
    // 아이가 어른의 부모
    const inverted = family([member('kid', 'female', 'child'), member('man', 'male', 'adult')], [{ a: 'kid', b: 'man', kind: 'parent' }]);
    expect(codes(inverted)).toContain('parent_age');
    // 어머니와 자식 나이 차 45 넘음 (노년 90세 고정 vs 아기)
    const oldMom = family([member('m', 'female', 'elder', { age: 80 }), member('b', 'male', 'baby'), member('d', 'male', 'adult')], [{ a: 'm', b: 'b', kind: 'parent' }]);
    expect(codes(oldMom)).toContain('parent_age');
    // 조부모 나이 차
    const gp = family([member('g', 'female', 'adult', { age: 40 }), member('k', 'male', 'teen', { age: 15 })], [{ a: 'g', b: 'k', kind: 'grandparent' }]);
    expect(codes(gp)).toContain('grandparent_age');
    // 어머니가 둘
    const twoMoms = family([member('m1', 'female', 'adult'), member('m2', 'female', 'adult'), member('k', 'male', 'child')], [
      { a: 'm1', b: 'k', kind: 'parent' },
      { a: 'm2', b: 'k', kind: 'parent' },
    ]);
    expect(codes(twoMoms)).toContain('parents_conflict');
    // 배우자 둘
    const bigamy = family([member('h', 'male', 'adult'), member('w1', 'female', 'adult'), member('w2', 'female', 'adult')], [
      { a: 'h', b: 'w1', kind: 'spouse' },
      { a: 'h', b: 'w2', kind: 'spouse' },
    ]);
    expect(codes(bigamy)).toContain('spouse_twice');
    // 아이 배우자
    expect(codes(family([member('a', 'male', 'adult'), member('b', 'female', 'child')], [{ a: 'a', b: 'b', kind: 'spouse' }]))).toContain('spouse_too_young');
    // 나이가 단계 밖
    expect(codes(family([member('a', 'male', 'adult', { age: 20 })], []))).toContain('age_stage_mismatch');
    // 조상 순환 (나이가 같아도 잡음)
    const cyc = family([member('a', 'male', 'adult', { age: 40 }), member('b', 'male', 'adult', { age: 40 })], [
      { a: 'a', b: 'b', kind: 'parent' },
      { a: 'b', b: 'a', kind: 'parent' },
    ]);
    expect(codes(cyc)).toContain('ancestor_cycle');
    // 없는 사람, 자기 자신
    expect(codes(family([member('a', 'male', 'adult')], [{ a: 'a', b: 'zz', kind: 'sibling' }]))).toContain('unknown_member');
    expect(codes(family([member('a', 'male', 'adult')], [{ a: 'a', b: 'a', kind: 'sibling' }]))).toContain('self_relation');
    // 아이만 있는 가족, 빈 가족, 어린 하인
    expect(codes(family([member('a', 'male', 'child')], []))).toContain('no_adult');
    expect(codes(family([], []))).toEqual(['empty']);
    expect(codes(family([member('a', 'male', 'adult'), member('s', 'male', 'child', { servant: true })], []))).toContain('servant_too_young');
  });

  it('성직자 혼인 불가, 농노 가정은 가문명 없음 (16-2, 10-4)', () => {
    const priest = family([member('p', 'male', 'adult', { estate: 'clergy' }), member('w', 'female', 'adult')], [{ a: 'p', b: 'w', kind: 'spouse' }]);
    expect(codes(priest)).toContain('clergy_spouse');
    const serf = family([member('a', 'male', 'adult', { estate: 'serf' })], [], 'serf', '스미스');
    expect(codes(serf)).toContain('serf_has_clan');
    expect(codes(family([member('a', 'male', 'adult', { estate: 'serf' })], [], 'serf', null))).toEqual([]);
  });

  it('모든 이슈 코드에 한국어 문장이 있음', () => {
    const all: IssueCode[] = [
      'empty', 'too_many_members', 'household_full', 'no_adult', 'duplicate_key', 'unknown_member', 'self_relation', 'bad_value',
      'unknown_estate', 'dye_not_allowed', 'age_stage_mismatch', 'parents_conflict', 'ancestor_cycle', 'parent_age', 'grandparent_age',
      'spouse_twice', 'spouse_too_young', 'spouse_kin', 'clergy_spouse', 'servant_too_young', 'serf_has_clan',
    ];
    for (const c of all) expect(ko[`creation.err.${c}`], c).toBeTruthy();
    for (const p of RANDOM_PARTS) expect(ko[`creation.part.${p}`], p).toBeTruthy();
    for (const e of ['too_large', 'not_json', 'format', 'version_newer', 'schema', 'bad_value']) expect(ko[`creation.import.${e}`]).toBeTruthy();
  });
});

describe('옷 염료 (16-2 사치 금지법 염료 칸)', () => {
  it('신분 등급까지 누적, 귀족만 진홍/자주', () => {
    const serf = allowedDyeColors(G, 'serf');
    expect(serf.map((c) => dyeOfColor(G, c)).every((d) => d === 'undyed' || d === 'brown' || d === 'gray')).toBe(true);
    const freeman = allowedDyeColors(G, 'freeman');
    expect(freeman).toContain('blue');
    expect(freeman).toContain('green');
    expect(freeman).not.toContain('red');
    expect(allowedDyeColors(G, 'artisan')).toContain('red');
    expect(allowedDyeColors(G, 'artisan')).not.toContain('navy');
    expect(allowedDyeColors(G, 'merchant')).toContain('navy');
    expect(allowedDyeColors(G, 'knight')).toContain('yellow');
    for (const e of ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight']) {
      expect(allowedDyeColors(G, e)).not.toContain('purple');
      expect(allowedDyeColors(G, e)).not.toContain('maroon');
    }
    expect(allowedDyeColors(G, 'noble')).toContain('purple');
    expect(allowedDyeColors(G, 'noble')).toContain('maroon');
    expect(allowedDyeColors(G, 'clergy')).toContain('black');
  });

  it('만들기에서 신분 밖 색은 거부, 무작위 옷 색은 항상 허용 안, 하인 제복은 주인 −1 등급까지', () => {
    for (let s = 1; s <= 30; s++) {
      for (const e of ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble']) {
        const m = randomMember(G, N, new Rng(s), { key: 'a', estate: e, stage: 'adult' });
        for (const k of OUTFIT_KINDS) for (const c of Object.values(m.outfits[k])) expect(allowedDyeColors(G, e)).toContain(c);
      }
    }
    const serf = member('a', 'male', 'adult', { estate: 'serf' });
    serf.outfits = { ...serf.outfits, formal: { main: 'purple', accent: 'brown', trim: 'gray' } };
    expect(codes(family([serf], [], 'serf', null))).toContain('dye_not_allowed');
    // 귀족 가정의 농노 하인: 기사 등급 색(노랑)까지 됨, 자주는 안 됨
    const lord = member('lord', 'male', 'adult', { estate: 'noble' });
    const servant = member('s', 'female', 'young', { estate: 'serf', servant: true });
    servant.outfits = randomDyes(new Rng(3), ['yellow']);
    expect(codes(family([lord, servant], [], 'noble', '보몽'))).toEqual([]);
    servant.outfits = randomDyes(new Rng(3), ['purple']);
    expect(codes(family([lord, servant], [], 'noble', '보몽'))).toContain('dye_not_allowed');
  });
});

describe('무작위와 닮게', () => {
  it('부위별 무작위는 그 부위만 바꿈', () => {
    const base = member('a', 'male', 'adult');
    for (const part of RANDOM_PARTS) {
      let changed = base;
      for (let s = 1; s <= 20 && JSON.stringify(changed) === JSON.stringify(base); s++) changed = randomizePart(G, base, part, new Rng(s), { names: N });
      const diff = Object.keys(base).filter((k) => JSON.stringify((base as never)[k]) !== JSON.stringify((changed as never)[k]));
      const expected: Record<string, string> = {
        skin: 'genome', hairColor: 'genome', eyeColor: 'genome', eyeShape: 'genome', brows: 'genome', build: 'genome', height: 'genome',
        hairStyle: 'look', beard: 'look', marks: 'look', dyes: 'outfits', gait: 'gait', voice: 'voice', name: 'name',
      };
      expect(diff, part).toEqual([expected[part]]);
      if (expected[part] === 'genome') {
        const gd = Object.keys(base.genome).filter((k) => JSON.stringify((base.genome as never)[k]) !== JSON.stringify((changed.genome as never)[k]) && k !== 'origin');
        const field = { skin: 'skin', hairColor: 'hair', eyeColor: 'eyes' }[part as 'skin'] ?? part;
        expect(gd, part).toEqual([field]);
      }
    }
    // 원본은 그대로
    const copy = JSON.stringify(base);
    randomizePart(G, base, 'marks', new Rng(1));
    expect(JSON.stringify(base)).toBe(copy);
  });

  it('"이 가족 닮게"는 가족 유전자에서 대립 유전자를 받음', () => {
    const a = member('a', 'male', 'adult').genome;
    const b = member('b', 'female', 'adult').genome;
    a.hair = ['blonde', 'blonde'];
    b.hair = ['blonde', 'redhead'];
    for (let s = 1; s <= 100; s++) {
      const gn = resembleFamily(G, [a, b], new Rng(s));
      for (const al of gn.hair) expect(['blonde', 'redhead']).toContain(al);
      expect(gn.origin).not.toBeNull();
    }
    const solo = resembleFamily(G, [a], new Rng(4));
    expect(solo.hair[0]).toBe('blonde');
    expect(hairColorOf(G, { ...b, hair: ['blonde', 'blonde'] })).toBe('blonde');
  });

  it('걸음걸이 4종 → 걷기 속도/애니 속도 배수, 목소리 높낮이 3 × 웅얼거림 3', () => {
    expect(Object.keys(G.gaits).sort()).toEqual(['easy', 'proud', 'quick', 'sneak']);
    expect(gaitParams(G, 'quick').anim).toBeGreaterThan(gaitParams(G, 'easy').anim);
    expect(gaitParams(G, 'easy').walk).toBeLessThan(gaitParams(G, 'proud').walk);
    expect(gaitParams(G, 'nope')).toEqual({ walk: 1, anim: 1 });
    expect(voiceParams(G, { pitch: 'low', mumble: 'gruff' })).toEqual({ pitch: 0.85, sampleSet: 'mumble_gruff' });
    expect(voiceParams(G, { pitch: 'high', mumble: 'soft' }).pitch).toBeGreaterThan(1);
    const m = member('a', 'female', 'young', { gait: 'sneak' });
    const rt = memberRuntime(G, m);
    expect(rt.gait).toEqual(G.gaits.sneak);
    expect(rt.appearance.estate).toBe('freeman');
    expect(memberAppearance(G, m, 'formal').layers.$main).toBe(m.outfits.formal.main);
    expect(memberAppearance(G, m, 'formal').outfit).toBe('formal');
  });
});

describe('인물·가문 내보내기/불러오기', () => {
  it('가문 왕복 = 같음', () => {
    const spec = basicFamily();
    spec.members[1].look = { ...spec.members[1].look, hairStyle: 'page', beard: 'beards_trimmed' };
    spec.members[2].age = 25;
    const text = exportFamily(spec);
    const r = importFamily(G, text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual(spec);
    expect(r.issues).toEqual([]);
    expect(exportFamily(r.value)).toBe(text);
    expect(JSON.parse(text).v).toBe(1);
    expect(JSON.parse(text).format).toBe('hearth-kin/family');
  });

  it('인물 왕복 = 같음', () => {
    const m = member('solo', 'female', 'elder', { estate: 'noble' });
    const r = importPerson(G, exportPerson(m));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual(m);
      expect(r.issues).toEqual([]);
    }
  });

  it('망가진/악성 파일은 거부', () => {
    expect(importFamily(G, '{not json')).toMatchObject({ ok: false, error: 'not_json' });
    expect(importFamily(G, JSON.stringify({ format: 'other', v: 1 }))).toMatchObject({ ok: false, error: 'format' });
    expect(importFamily(G, JSON.stringify({ format: 'hearth-kin/family', v: 99, family: {} }))).toMatchObject({ ok: false, error: 'version_newer' });
    expect(importFamily(G, 'x'.repeat(300 * 1024))).toMatchObject({ ok: false, error: 'too_large' });
    expect(importPerson(G, exportFamily(basicFamily()))).toMatchObject({ ok: false, error: 'format' });
    // 추가 필드 (스크립트 같은 것)
    const spec = JSON.parse(exportFamily(basicFamily()));
    spec.family.members[0].onload = 'alert(1)';
    expect(importFamily(G, JSON.stringify(spec))).toMatchObject({ ok: false, error: 'schema' });
    // 게임에 없는 유전자 값
    const bad = JSON.parse(exportFamily(basicFamily()));
    bad.family.members[0].genome.hair = ['purple', 'black'];
    expect(importFamily(G, JSON.stringify(bad))).toMatchObject({ ok: false, error: 'bad_value' });
    // 형식은 맞지만 규칙 위반은 불러오되 이슈로
    const kin = basicFamily();
    kin.relations.push({ a: 'son', b: 'daughter', kind: 'spouse' });
    const r = importFamily(G, exportFamily(kin));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.issues.map((i) => i.code)).toContain('spouse_kin');
  });
});

describe('복장 자동 전환 (10-1 표)', () => {
  const rules = G.outfits;
  const row = (activity: OutfitActivity, extra: { outdoors?: boolean; feltTemp?: number } = {}) => outfitFor({ activity, ...extra }, rules);

  it('기상, 일상 → 평상복', () => {
    expect(row('wake')).toBe('everyday');
    expect(row('daily')).toBe('everyday');
    expect(row('daily', { outdoors: true, feltTemp: 15 })).toBe('everyday');
  });

  it('직업 활동, 가내 작업 → 작업복', () => {
    expect(row('career')).toBe('work');
    expect(row('housework')).toBe('work');
  });

  it('교회, 혼례, 장례, 축제, 성 방문 → 예복', () => {
    for (const a of ['church', 'wedding', 'funeral', 'festival', 'castle'] as const) {
      expect(row(a)).toBe('formal');
      expect(row(a, { outdoors: true, feltTemp: -5 })).toBe('formal');
    }
  });

  it('잠 → 잠옷', () => {
    expect(row('sleep')).toBe('sleep');
    expect(row('sleep', { outdoors: true, feltTemp: -10 })).toBe('sleep');
  });

  it('기온 5도 이하 외출 → 겨울옷', () => {
    expect(rules.winterAtOrBelow).toBe(5);
    expect(row('daily', { outdoors: true, feltTemp: 5 })).toBe('winter');
    expect(row('career', { outdoors: true, feltTemp: -3 })).toBe('winter');
    expect(row('daily', { outdoors: true, feltTemp: 5.5 })).toBe('everyday');
    expect(row('daily', { outdoors: false, feltTemp: 0 })).toBe('everyday');
  });

  it('목욕, 강에서 수영 → 속옷', () => {
    expect(row('bath')).toBe('bath');
    expect(row('swim', { outdoors: true, feltTemp: 20 })).toBe('bath');
  });

  it('옷장에서 직접 갈아입은 옷이 이김, 장례에 평상복이면 무례함', () => {
    expect(outfitFor({ activity: 'funeral', manual: 'everyday' }, rules)).toBe('everyday');
    expect(rudeAtFuneral('funeral', 'everyday')).toBe(true);
    expect(rudeAtFuneral('funeral', 'work')).toBe(true);
    expect(rudeAtFuneral('funeral', 'formal')).toBe(false);
    expect(rudeAtFuneral('funeral', 'winter')).toBe(false);
    expect(rudeAtFuneral('church', 'everyday')).toBe(false);
    expect(OUTFIT_KINDS).toEqual(G.creation.outfitKinds);
  });
});
