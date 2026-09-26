/**
 * M8 사치 금지법 (GDD 16-2): 등급 표, 공공 장소 판정, 발견 확률, 벌금·명성·몰수, 예외 5종, 귀족 체면, "입으면 위험", 샌드박스 끄기.
 * BRIEF M8 통과 조건: "사치 금지법 판정 유닛"
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/core/rng';
import type { EstatePerson } from '../../src/sim/house/estates';
import {
  Sumptuary,
  detectChance,
  dyeFromLpc,
  fineFor,
  isShabby,
  itemTier,
  judge,
  parseSumptuary,
  riskyToWear,
  type SumptuaryHost,
  type WearContext,
  type WornItem,
} from '../../src/sim/house/sumptuary';
import { FAMILY_FILES } from '../../src/sim/data/familyFiles';

const D = parseSumptuary(JSON.parse(readFileSync('src/data/sumptuary.json', 'utf8')))!;

function ctx(o: Partial<WearContext> = {}): WearContext {
  return { estate: 'freeman', public: true, carnival: false, weddingToday: false, fall: null, day: 10, seasonDays: 7, rulesOff: false, ...o };
}
const cloth = (id: string, x: Partial<WornItem> = {}): WornItem => ({ category: 'cloth', id, ...x });
const dye = (id: string, x: Partial<WornItem> = {}): WornItem => ({ category: 'dye', id, ...x });
const weapon = (id: string, x: Partial<WornItem> = {}): WornItem => ({ category: 'weapon', id, ...x });
const armor = (id: string, x: Partial<WornItem> = {}): WornItem => ({ category: 'armor', id, ...x });

describe('M8 사치 금지법 등급 표 (16-2)', () => {
  it('데이터가 SimData.family.sumptuary 로 들어오고 스키마·참조 검사를 통과', () => {
    expect(FAMILY_FILES.sumptuary).toBe('sumptuary.json');
    expect(parseSumptuary(JSON.parse(readFileSync(`src/data/${FAMILY_FILES.sumptuary}`, 'utf8')))).toBeTruthy();
  });

  it('표 6단: 옷감·염료·무기·갑옷의 최소 신분', () => {
    const t = (c: WornItem) => D.tiers[itemTier(D, c.category, c.id)];
    expect(t(cloth('coarse_wool'))).toBe('serf');
    expect(t(cloth('fine_wool'))).toBe('freeman');
    expect(t(cloth('fine_linen'))).toBe('artisan');
    expect(t(cloth('fox_fur_trim'))).toBe('merchant');
    expect(t(cloth('silk'))).toBe('knight');
    expect(t(cloth('ermine'))).toBe('noble');
    expect(t(dye('blue'))).toBe('freeman');
    expect(t(dye('red'))).toBe('artisan');
    expect(t(dye('deep_blue'))).toBe('merchant');
    expect(t(dye('heraldic'))).toBe('knight');
    expect(t(dye('purple'))).toBe('noble');
    expect(t(weapon('spear'))).toBe('serf');
    expect(t(weapon('sword'))).toBe('freeman');
    expect(t(armor('leather'))).toBe('freeman');
    expect(t(armor('mail'))).toBe('merchant');
    expect(t(armor('plate'))).toBe('knight');
    // LPC 염료 → 등급 (렌더러 옷 사양 연결)
    expect(dyeFromLpc(D, 'purple')).toBe('purple');
    expect(dyeFromLpc(D, 'navy')).toBe('deep_blue');
    expect(dyeFromLpc(D, 'tan')).toBe('undyed');
  });
});

describe('M8 사치 금지법 판정', () => {
  it('신분보다 높은 등급을 공공 장소에서 입으면 위반, 격차 = 등급 차', () => {
    const j = judge(D, ctx({ estate: 'serf' }), [cloth('coarse_wool'), dye('red'), weapon('sword')]);
    expect(j.exempt).toBeNull();
    expect(j.violations.map((v) => [v.item.id, v.gap])).toEqual([
      ['red', 2],
      ['sword', 1],
    ]);
    expect(j.gap).toBe(2);
    expect(judge(D, ctx({ estate: 'noble' }), [cloth('ermine'), dye('purple'), armor('plate')]).gap).toBe(0);
    // 성직자는 상인 등급 (검은 법의)
    expect(judge(D, ctx({ estate: 'clergy' }), [dye('deep_blue')]).gap).toBe(0);
    expect(judge(D, ctx({ estate: 'clergy' }), [cloth('silk')]).gap).toBe(1);
  });

  it('소유는 합법: 집·자기 부지 안에서는 판정 없음', () => {
    const j = judge(D, ctx({ estate: 'serf', public: false }), [cloth('ermine')]);
    expect(j).toEqual({ exempt: 'private', violations: [], gap: 0 });
  });

  it('예외 1: 사육제 기간 전체', () => {
    expect(judge(D, ctx({ estate: 'serf', carnival: true }), [cloth('velvet'), dye('purple')])).toMatchObject({ exempt: 'carnival', gap: 0 });
  });

  it('예외 2: 혼례 당일 본인 예복은 한 등급 위까지 (두 등급은 위반, 혼례가 아닌 날은 위반)', () => {
    const gown = cloth('fine_linen', { wedding: true });
    expect(judge(D, ctx({ estate: 'freeman', weddingToday: true }), [gown]).gap).toBe(0);
    expect(judge(D, ctx({ estate: 'freeman', weddingToday: false }), [gown]).gap).toBe(1);
    expect(judge(D, ctx({ estate: 'freeman', weddingToday: true }), [cloth('fox_fur_trim', { wedding: true })]).gap).toBe(1);
    // 예복이 아닌 물건은 혼례 날에도 그대로
    expect(judge(D, ctx({ estate: 'freeman', weddingToday: true }), [dye('red')]).gap).toBe(1);
  });

  it('예외 3: 하인 제복은 주인 신분 −1 등급까지', () => {
    // 귀족 집 하인(농노): 기사 등급까지
    expect(judge(D, ctx({ estate: 'serf' }), [cloth('silk', { livery: 'noble' }), dye('heraldic', { livery: 'noble' })]).gap).toBe(0);
    expect(judge(D, ctx({ estate: 'serf' }), [cloth('velvet', { livery: 'noble' })]).gap).toBe(1);
    // 제복이 아닌 옷은 본인 신분
    expect(judge(D, ctx({ estate: 'serf' }), [cloth('silk')]).gap).toBe(4);
  });

  it('예외 4: 신분 하락 뒤 달력 1계절(season) 유예, 전 신분까지', () => {
    const fall = { day: 10, from: 'knight' };
    const items = [armor('plate'), cloth('silk')];
    expect(judge(D, ctx({ estate: 'merchant', fall, day: 12 }), items).gap).toBe(0);
    expect(judge(D, ctx({ estate: 'merchant', fall, day: 16 }), items).gap).toBe(0);
    expect(judge(D, ctx({ estate: 'merchant', fall, day: 17 }), items).gap).toBe(1);
    // 계절 14일이면 유예도 14일
    expect(judge(D, ctx({ estate: 'merchant', fall, day: 23, seasonDays: 14 }), items).gap).toBe(0);
    // 전 신분보다 높은 것은 유예 중에도 위반
    expect(judge(D, ctx({ estate: 'merchant', fall, day: 12 }), [cloth('ermine')]).gap).toBe(1);
  });

  it('예외 5: 직무 장비 (직업이 지급한 무기와 갑옷)', () => {
    expect(judge(D, ctx({ estate: 'freeman' }), [weapon('sword', { duty: true }), armor('mail', { duty: true })]).gap).toBe(0);
    expect(judge(D, ctx({ estate: 'freeman' }), [armor('mail')]).gap).toBe(2);
    // 직무여도 옷감·염료는 예외 아님
    expect(judge(D, ctx({ estate: 'freeman' }), [dye('heraldic', { duty: true })]).gap).toBe(3);
  });

  it('샌드박스 규칙 끄기: 아무도 판정하지 않음, 위험 표시도 없음', () => {
    expect(judge(D, ctx({ estate: 'serf', rulesOff: true }), [cloth('ermine')])).toMatchObject({ exempt: 'rules_off', gap: 0 });
    expect(riskyToWear(D, 'serf', cloth('ermine'), true)).toBe(0);
  });

  it('발견 확률 = 20% × 격차 × 명성 보정 (명망/전설 0.5, 불명예 1.5), 벌금 = 격차 × 2은화', () => {
    expect(detectChance(D, 1, 'ordinary')).toBeCloseTo(0.2);
    expect(detectChance(D, 2, 'ordinary')).toBeCloseTo(0.4);
    expect(detectChance(D, 2, 'renowned')).toBeCloseTo(0.2);
    expect(detectChance(D, 2, 'legendary')).toBeCloseTo(0.2);
    expect(detectChance(D, 2, 'dishonored')).toBeCloseTo(0.6);
    expect(detectChance(D, 0, 'dishonored')).toBe(0);
    expect(detectChance(D, 5, 'dishonored')).toBe(1);
    expect(fineFor(D, 1)).toBe(24 * 4);
    expect(fineFor(D, 3)).toBe(72 * 4);
  });

  it('선물·상속으로 받을 때 "입으면 위험" 표시', () => {
    expect(riskyToWear(D, 'serf', cloth('velvet'))).toBe(5);
    expect(riskyToWear(D, 'noble', cloth('velvet'))).toBe(0);
    expect(riskyToWear(D, 'freeman', armor('plate', { duty: true }))).toBe(0);
  });

  it('귀족 초라한 차림 = 체면 손상 (옷 최고 등급이 상인 미만)', () => {
    expect(isShabby(D, 'noble', [cloth('coarse_wool'), dye('brown')])).toBe(true);
    expect(isShabby(D, 'noble', [cloth('coarse_wool'), dye('purple')])).toBe(false);
    expect(isShabby(D, 'freeman', [cloth('coarse_wool')])).toBe(false);
  });
});

describe('M8 사치 금지법 실행 (게임 1시간)', () => {
  interface FP extends EstatePerson {
    name: string;
  }
  function world(o: { watched?: boolean; public?: boolean; tier?: string; rulesOff?: boolean; carnival?: boolean } = {}) {
    const serf: FP = { id: 1, name: '농노', estate: 'serf', household: 1, spouse: 0, mother: 0, father: 0, sex: 'male', lifeStage: 'young' };
    const noble: FP = { id: 2, name: '귀족', estate: 'noble', household: 2, spouse: 0, mother: 0, father: 0, sex: 'female', lifeStage: 'young' };
    const worn: Record<number, WornItem[]> = { 1: [cloth('velvet', { uid: 7 }), dye('red', { uid: 8 })], 2: [cloth('hemp'), dye('gray')] };
    const out = { fines: [] as number[], fame: [] as [number, number][], moodlets: [] as [number, string][], confiscated: [] as number[], notices: [] as string[], rumors: [] as string[] };
    let minute = 0;
    const host: SumptuaryHost<FP> = {
      rng: new Rng(11),
      day: () => 3,
      minute: () => minute,
      seasonDays: () => 7,
      lifespan: () => 1,
      rulesOff: () => !!o.rulesOff,
      isCarnival: () => !!o.carnival,
      candidates: () => [serf, noble],
      inPublic: () => o.public ?? true,
      worn: (p) => worn[p.id],
      weddingToday: () => false,
      lastFall: () => null,
      watched: (_p, roles) => (o.watched ?? true) && roles.includes('bailiff') && roles.includes('priest'),
      fameTier: () => o.tier ?? 'dishonored',
      fine: (_hh, n) => {
        out.fines.push(n);
      },
      fame: (hh, d) => {
        out.fame.push([hh, d]);
      },
      moodlet: (p, id) => {
        out.moodlets.push([p.id, id]);
      },
      confiscate: (_p, it) => {
        out.confiscated.push(it.uid ?? 0);
      },
      notice: (_p, k) => {
        out.notices.push(k);
      },
      rumor: (_p, k) => {
        out.rumors.push(k);
      },
    };
    return { host, out, serf, noble, tick: (m: number) => (minute += m) };
  }

  it('시야 안에서 걸리면 벌금 + 명성 하락 + 무드렛, 두 번째부터 몰수. 귀족 초라한 차림은 하루 한 번', () => {
    const w = world({ tier: 'dishonored' });
    const s = new Sumptuary(w.host, D);
    // 농노가 벨벳(귀족, 격차 5) → 발견 확률 1
    const c1 = s.hourly();
    expect(c1.length).toBe(1);
    expect(c1[0]).toMatchObject({ gap: 5, fine: 5 * 24 * 4, confiscated: [] });
    expect(w.out.fame).toContainEqual([1, 5 * D.penalty.famePerGap]);
    expect(w.out.moodlets).toContainEqual([1, 'sumptuary_fined']);
    expect(w.out.notices).toContain('sumptuary_fined');
    // 귀족 체면 손상
    expect(w.out.moodlets).toContainEqual([2, 'shabby_noble_shame']);
    expect(w.out.fame).toContainEqual([2, D.shabby.fame]);
    w.tick(60);
    const c2 = s.hourly();
    expect(c2[0].confiscated.map((x) => x.uid)).toEqual([7, 8]);
    expect(w.out.confiscated).toEqual([7, 8]);
    expect(w.out.notices).toContain('sumptuary_confiscated');
    // 체면 손상은 하루 한 번
    expect(w.out.moodlets.filter(([id, m]) => id === 2 && m === 'shabby_noble_shame').length).toBe(1);
    w.tick(1440);
    s.hourly();
    expect(w.out.moodlets.filter(([id, m]) => id === 2 && m === 'shabby_noble_shame').length).toBe(2);
  });

  it('집행관/사제 시야 밖, 집 안, 사육제, 샌드박스 끄기면 걸리지 않음', () => {
    for (const o of [{ watched: false }, { public: false }, { carnival: true }, { rulesOff: true }]) {
      const w = world({ ...o, tier: 'dishonored' });
      const s = new Sumptuary(w.host, D);
      expect(s.hourly()).toEqual([]);
      expect(w.out.fines).toEqual([]);
    }
  });

  it('명망 가문은 덜 걸림 (확률 절반): 같은 시드로 여러 시간 돌려 비교', () => {
    const count = (tier: string) => {
      let n = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const w = world({ tier });
        (w.host as { rng: Rng }).rng = new Rng(seed);
        // 격차 2 (농노가 적색 염료만)
        w.host.worn = (p) => (p.id === 1 ? [dye('red')] : [cloth('silk')]);
        const s = new Sumptuary(w.host, D);
        n += s.hourly().filter((c) => c.person.id === 1).length;
      }
      return n / 400;
    };
    const plain = count('ordinary');
    const renowned = count('renowned');
    expect(plain).toBeGreaterThan(0.3);
    expect(plain).toBeLessThan(0.5);
    expect(renowned).toBeGreaterThan(0.12);
    expect(renowned).toBeLessThan(0.28);
  });
});
