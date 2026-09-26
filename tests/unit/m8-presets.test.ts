/**
 * M8 시작 프리셋 7 신분 × 3 형편 = 21 (GDD 16-2, 17-4 시작 자금).
 * 21개 모두 적용 가능, 현금 = 그 신분 S 배수 (몰락은 빚, 상환 28일), 명성은 형편별, 필수 자산이 모두 있음, 기본 가족 구성
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/core/rng';
import { ESTATE_IDS, type EstateId } from '../../src/sim/house/estates';
import { applyPreset, parsePresets, presetCash, presetIds, resolvePreset, type PresetHost, type PresetPersonSpec } from '../../src/sim/house/presets';
import { FAMILY_FILES } from '../../src/sim/data/familyFiles';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const D = parsePresets(read(`src/data/${FAMILY_FILES.startPresets}`))!;
const econ = read('src/data/economy.json');
const careers = read('src/data/careers.json').careers as Record<string, { estates: string[] }>;
const ko: Record<string, string> = Object.assign({}, ...['estates_m8.json', 'town.json', 'hud2.json', 'ui.json'].map((f) => {
  try {
    return read(`src/i18n/ko/${f}`);
  } catch {
    return {};
  }
}));
const S = (e: EstateId): number => econ.estates[e].target.net * econ.presets.savingsDays;

interface Rec {
  estate?: EstateId;
  members: PresetPersonSpec[];
  grants: [number, string][];
  loans: [number, number, string][];
  fame?: number;
  house?: [string, string];
  careers: [number, string][];
  plots: number;
  animals: Record<string, number>;
  items: Record<string, number>;
  tools: string[];
  guild: [number, string][];
  apprentices: number;
  squires: number;
  servants: string[];
  fief: { manors: number; tenants: number; lord: boolean; policy: boolean } | null;
}

function fakeHost(seed = 1, lifespan = 1): { host: PresetHost; rec: Rec } {
  const rec: Rec = { members: [], grants: [], loans: [], careers: [], plots: 0, animals: {}, items: {}, tools: [], guild: [], apprentices: 0, squires: 0, servants: [], fief: null };
  const host: PresetHost = {
    rng: new Rng(seed),
    lifespan: () => lifespan,
    savings: S,
    createHousehold: (_e, members) => {
      rec.members = members;
      return { household: 1, ids: members.map((_, i) => 10 + i) };
    },
    setHouseholdEstate: (_hh, e) => {
      rec.estate = e;
    },
    grant: (_hh, n, r) => {
      rec.grants.push([n, r]);
    },
    borrow: (_hh, n, term, lender) => {
      rec.loans.push([n, term, lender]);
    },
    setFame: (_hh, v) => {
      rec.fame = v;
    },
    assignHouse: (_hh, kind, tenure) => {
      rec.house = [kind, tenure];
      return true;
    },
    setCareer: (id, c) => {
      const spec = rec.members[id - 10];
      if (!careers[c] || !careers[c].estates.includes(spec.estate)) return false;
      rec.careers.push([id, c]);
      return true;
    },
    addPlots: (_hh, n) => {
      rec.plots += n;
    },
    addAnimals: (_hh, k, n) => {
      rec.animals[k] = (rec.animals[k] ?? 0) + n;
    },
    addItems: (_hh, k, n) => {
      rec.items[k] = (rec.items[k] ?? 0) + n;
    },
    grantTools: (_hh, c) => {
      rec.tools.push(c);
    },
    grantGuild: (id, c) => {
      rec.guild.push([id, c]);
    },
    addApprentice: () => {
      rec.apprentices++;
    },
    addSquire: () => {
      rec.squires++;
    },
    hireServant: (_hh, role) => {
      rec.servants.push(role);
      return true;
    },
    grantFief: (_hh, f) => {
      rec.fief = f;
    },
  };
  return { host, rec };
}

describe('M8 시작 프리셋 21개 (16-2)', () => {
  it('7 신분 × 3 형편 = 21, 모두 이름이 있음', () => {
    const ids = presetIds(D);
    expect(ids.length).toBe(21);
    for (const e of ESTATE_IDS) for (const w of ['poor', 'normal', 'rich']) expect(D.presets.some((p) => p.estate === e && p.wealth === w)).toBe(true);
    for (const id of ids) expect(ko[`preset.${id}`], id).toBeTruthy();
  });

  for (const p of D.presets) {
    it(`${p.id}: 적용, 현금 = S 배수, 명성, 필수 자산, 가족`, () => {
      const { host, rec } = fakeHost();
      const r = applyPreset(host, D, p.id);
      expect(r.ok).toBe(true);
      expect(rec.estate).toBe(p.estate);
      // 현금 = S × 형편 배수 (lifespan), 몰락은 빚 28일
      const mult = D.wealth[p.wealth].cashS;
      const expected = Math.round(S(p.estate) * mult) * 4;
      if (p.wealth === 'poor') {
        expect(r.cash).toBe(0);
        expect(r.debt).toBe(-expected);
        expect(rec.loans).toEqual([[-expected, 28, 'moneylender']]);
        expect(rec.grants.filter(([, why]) => why === 'start')).toEqual([]);
      } else {
        expect(r.cash).toBe(expected);
        expect(rec.grants).toContainEqual([expected, 'start']);
        expect(rec.loans).toEqual([]);
      }
      // 명성: 몰락 200 / 보통 300 / 부유 400
      expect(rec.fame).toBe({ poor: 200, normal: 300, rich: 400 }[p.wealth]);
      // 가족: 청년 부부(가장 22세 안팎) + 아동 1~2, 성직자는 본인 + 형제 부부 + 아동 1
      const roles = rec.members.map((m) => m.role);
      const kids = roles.filter((x) => x === 'child').length;
      expect(kids).toBeGreaterThanOrEqual(1);
      expect(kids).toBeLessThanOrEqual(2);
      const head = rec.members.find((m) => m.role === 'head')!;
      expect(head.stage).toBe('young');
      expect(Math.abs(head.displayAge - 22)).toBeLessThanOrEqual(2);
      if (p.estate === 'clergy') {
        expect(roles).toEqual(['head', 'sibling', 'sibling_spouse', 'child']);
        expect(head.estate).toBe('clergy');
        const sib = rec.members.find((m) => m.role === 'sibling')!;
        const sw = rec.members.find((m) => m.role === 'sibling_spouse')!;
        expect(sib.sex).not.toBe(sw.sex);
        expect(sib.estate).not.toBe('clergy');
      } else {
        expect(roles.slice(0, 2)).toEqual(['head', 'spouse']);
        const sp = rec.members[1];
        expect(sp.sex).not.toBe(head.sex);
        expect(rec.members.every((m) => m.estate === p.estate)).toBe(true);
      }
      for (const m of rec.members.filter((x) => x.role === 'child')) {
        expect(m.stage).toBe('child');
        expect(m.displayAge).toBeGreaterThanOrEqual(4);
        expect(m.displayAge).toBeLessThanOrEqual(9);
      }
      // 직업: 정해진 것은 모두 들어감 (careers.json 신분 조건 통과)
      const want = Object.keys(resolvePreset(D, p.id)!.assets.careers ?? {}).length;
      expect(rec.careers.length).toBe(want);
      // 필수 자산 (16-2 표)
      const house = rec.house!;
      expect(ko[`house.kind.${house[0]}`], house[0]).toBeTruthy();
      switch (p.estate) {
        case 'serf':
          expect(house).toEqual(['hut', 'lord']);
          expect(rec.plots).toBe(2);
          expect(rec.animals.chicken).toBe(3);
          break;
        case 'freeman':
          expect(['hut', 'farmhouse']).toContain(house[0]);
          // 밭 구획 3 또는 품팔이
          expect(rec.plots === 3 || rec.careers.some(([, c]) => c === 'field_hand')).toBe(true);
          break;
        case 'artisan':
          expect(house).toEqual(['workshop_house', 'owned']);
          expect(rec.tools.length).toBe(1);
          expect(rec.guild.length).toBe(1);
          expect(rec.apprentices).toBe(1);
          break;
        case 'merchant':
          expect(house).toEqual(['merchant_house', 'owned']);
          expect(r.capital).toBe(720 * 4);
          expect(rec.grants).toContainEqual([720 * 4, 'trade_capital']);
          expect(rec.servants.length).toBeGreaterThanOrEqual(1);
          break;
        case 'clergy':
          expect(['rectory', 'monastery_cell']).toContain(house[0]);
          expect(house[1]).toBe('church');
          expect(rec.careers).toContainEqual([10, 'priest']);
          break;
        case 'knight':
          expect(house).toEqual(['manor', 'owned']);
          expect(rec.fief).toMatchObject({ manors: 2, tenants: 4, lord: false });
          expect(rec.animals.warhorse).toBe(1);
          expect(rec.items.armor_plate).toBe(1);
          expect(rec.squires).toBe(1);
          break;
        case 'noble':
          expect(house).toEqual(['castle_hall', 'owned']);
          expect(rec.fief).toEqual({ manors: 12, tenants: 12, lord: true, policy: true });
          expect(rec.servants.length).toBeGreaterThanOrEqual(4);
          break;
      }
    });
  }

  it('예시 금액 (16-2, 17-4): 몰락 귀족 빚 3,840동화, 부유한 농노 216동화, 보통 장인 259동화', () => {
    expect(presetCash(S('noble'), -0.5, 1)).toBe(-3840 * 4);
    expect(presetCash(S('serf'), 1.5, 1)).toBe(216 * 4);
    expect(presetCash(S('artisan'), 0.3, 1)).toBe(259 * 4);
  });

  it('수명 배수를 따름 (S 는 lifespan): 긴 수명이면 현금도 배', () => {
    const a = applyPreset(fakeHost(1, 1).host, D, 'merchant_normal');
    const b = applyPreset(fakeHost(1, 2).host, D, 'merchant_normal');
    expect(b.cash).toBe(Math.round(S('merchant') * 0.3 * 2) * 4);
    expect(b.cash).toBeCloseTo(a.cash * 2, -1);
    expect(b.capital).toBe(1440 * 4);
  });

  it('같은 시드면 같은 가족 (성별·아동 나이는 시드 RNG)', () => {
    const a = applyPreset(fakeHost(5).host, D, 'serf_normal').specs;
    const b = applyPreset(fakeHost(5).host, D, 'serf_normal').specs;
    expect(a).toEqual(b);
  });

  it('모르는 프리셋은 실패', () => {
    expect(applyPreset(fakeHost().host, D, 'pirate_rich').ok).toBe(false);
  });
});
