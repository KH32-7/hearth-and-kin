/**
 * 농사 (GDD 31장): 밭 구획/텃밭/과수 물건 하나 = 상호작용 한 세트 (칸 단위 작업 없음, 매일 물 주기 없음).
 * 물건 상태 (숫자): tilled 0/1, crop 작물 번호+1 (0 없음), prog 성장 0~1, stage 0~4, weeds 0/1, care −0.2~0.2,
 *   fert 지력 0~100, scare 허수아비, fertN 이번 작물 거름 횟수, ripeDay 익은 날, loss 재해 손실 0~1,
 *   glean 이삭줍기 가능 날까지, lastKind 직전 작물 분류 번호(윤작), drought 가뭄 남은 날, protect 물 대기로 막는 날까지
 * 성장은 계절 진행률 (필요 성장 계절 × 계절 일수, 겨울 0.2배). 수확량 = 중 구획 기준 × 구획 크기 × 계절 일수/7 × 지력 × 관리 × 스킬 × (1 − 손실)
 * 수치는 crops.json (작업자 B). 렌더러/DOM 없음
 */
import type { ObjectInstance } from '../core/types';
import type { Rng } from '../core/rng';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type CropsData = any;

export const FARM_TASKS = ['till', 'sow', 'weed', 'water', 'fertilize', 'scarecrow', 'harvest', 'glean'] as const;
export type FarmTask = (typeof FARM_TASKS)[number];
export const KINDS = ['grain', 'legume', 'vegetable', 'herb', 'medicinal', 'fiber', 'orchard', 'special'];

export interface FarmHost {
  day(): number;
  season(): string;
  seasonDays(): number;
  rng: Rng;
  notice(kind: string, args?: Record<string, string | number>): void;
}

export class Farming {
  readonly cropIds: string[];

  constructor(readonly d: CropsData) {
    this.cropIds = Object.keys(d.crops).filter((k) => !k.startsWith('$'));
  }

  crop(o: ObjectInstance): { id: string; def: any } | null {
    const i = Number(o.state.crop ?? 0) - 1;
    if (i < 0) return null;
    const id = this.cropIds[i];
    return id ? { id, def: this.d.crops[id] } : null;
  }

  /** 구획 크기: 텃밭(garden 태그) / 밭 중 / 과수 */
  sizeOf(tags: readonly string[]): { work: number; yield: number } {
    const ps = this.d.plotSizes;
    if (tags.includes('garden')) return ps.garden;
    return tags.includes('large') ? ps.large : tags.includes('small') ? ps.small : ps.medium;
  }

  initState(o: ObjectInstance, orchardCrop?: string): void {
    if (o.state.fert === undefined) o.state.fert = this.d.fertility.start;
    // 부지에 처음부터 있는 과수는 다 자란 나무 (기본 사과)
    if (orchardCrop && o.state.crop === undefined && this.cropIds.includes(orchardCrop)) o.state.crop = this.cropIds.indexOf(orchardCrop) + 1;
    for (const k of ['tilled', 'crop', 'prog', 'stage', 'weeds', 'care', 'scare', 'fertN', 'ripeDay', 'loss', 'glean', 'lastKind', 'drought', 'protect', 'dryLoss', 'matureDay']) if (o.state[k] === undefined) o.state[k] = 0;
  }

  /** 하루에 자라는 양 (겨울 0.2배) */
  dailyGrowth(def: any, season: string, seasonDays: number): number {
    const need = def.growSeasons.value * seasonDays;
    const mult = season === 'winter' ? this.d.growth.winterMult : 1;
    return mult / Math.max(1, need);
  }

  /** 지금 심으면 익는 계절 (sowRule: 수확 계절 안에 익어야 심을 수 있음) */
  ripenSeason(def: any, day: number, seasons: string[], seasonDays: number): string | null {
    let prog = 0;
    for (let d = day; d < day + seasonDays * 8; d++) {
      const s = seasons[Math.floor(d / seasonDays) % 4];
      prog += this.dailyGrowth(def, s, seasonDays);
      if (prog >= 1) return s;
    }
    return null;
  }

  canSow(cropId: string, o: ObjectInstance, tags: readonly string[], day: number, seasons: string[], seasonDays: number, estate: string): string | null {
    const def = this.d.crops[cropId];
    if (!def) return 'reason.unknown';
    if (def.perennial) return 'reason.unknown';
    const garden = tags.includes('garden');
    if (garden && !def.garden) return 'reason.not_garden';
    if (!garden && !def.field) return 'reason.not_field';
    if (def.estates && !def.estates.includes(estate)) return 'reason.estate';
    const season = seasons[Math.floor(day / seasonDays) % 4];
    if (!(def.sow as string[]).includes(season)) return 'reason.sow_season';
    const rs = this.ripenSeason(def, day, seasons, seasonDays);
    if (!rs || !(def.harvestSeasons as string[]).includes(rs)) return 'reason.sow_season';
    void o;
    return null;
  }

  /** 마법 설정 (33장): off rare common. 기본 rare */
  magic = 'rare';
  /** 올해 작황 배수 (Economy.yearMult: 흉년 0.65 / 풍년 1.25). 조작 가문 밭에도 (31-5) */
  yearMult = 1;

  sow(o: ObjectInstance, cropId: string): void {
    o.state.drought = 0;
    o.state.protect = 0;
    o.state.dryLoss = 0;
    o.state.crop = this.cropIds.indexOf(cropId) + 1;
    o.state.prog = 0;
    o.state.stage = 0;
    o.state.weeds = 0;
    o.state.care = 0;
    o.state.scare = 0;
    o.state.fertN = 0;
    o.state.ripeDay = 0;
    o.state.loss = 0;
    o.state.glean = 0;
  }

  /** 하루 경계: 성장, 잡초, 관리도, 익은 뒤 손실, 재해 (31-4, 31-5) */
  daily(o: ObjectInstance, h: FarmHost, orchard: boolean): void {
    const g = this.d.growth;
    const day = h.day();
    const season = h.season();
    const SD = h.seasonDays();
    const c = this.crop(o);
    if (orchard) return this.orchardDaily(o, h);
    // 가뭄 남은 날은 작물이 있든 없든 줄어듦 (다 거둔 밭에 가뭄이 남지 않게)
    const dry = Number(o.state.drought) > 0;
    if (dry) o.state.drought = Number(o.state.drought) - 1;
    if (!c) {
      // 휴경: 계절 첫날 지력 회복
      if (day % SD === 0 && !Number(o.state.tilled)) o.state.fert = Math.min(this.d.fertility.max, Number(o.state.fert) + this.d.fertility.fallowPerSeason);
      if (Number(o.state.glean) && day > Number(o.state.glean)) o.state.glean = 0;
      return;
    }
    const stage0 = Number(o.state.stage);
    if (stage0 < 4) {
      o.state.prog = Math.min(1, Number(o.state.prog) + this.dailyGrowth(c.def, season, SD));
      const st = Number(o.state.prog) >= 1 ? 4 : Math.min(3, Math.floor(Number(o.state.prog) * 4));
      o.state.stage = st;
      if (st === 4 && stage0 < 4) {
        o.state.ripeDay = day;
        h.notice('crop_ripe', { crop: c.def.nameKey });
      }
    } else if (day - Number(o.state.ripeDay) > g.ripeHold.value) {
      o.state.loss = Math.min(1, Number(o.state.loss) + g.overripeLossPerDay);
    }
    // 잡초
    if (!Number(o.state.weeds) && Number(o.state.stage) < 4 && h.rng.next() < g.weeds.chancePerDay.value) o.state.weeds = 1;
    if (Number(o.state.weeds)) o.state.care = Math.max(g.weeds.careMin, Number(o.state.care) + g.weeds.carePerDay);
    // 재해
    for (const dz of c.def.disasters ?? []) {
      const z = this.d.disasters[dz];
      if (!z || dz === 'drought' || dz === 'hail') continue;
      if (z.seasons && !z.seasons.includes(season)) continue;
      if (z.stages && !(z.stages as number[]).includes(Number(o.state.stage))) continue;
      // 홍수는 강가 구획만 (31-5)
      if (dz === 'flood' && !(o as { tags?: string[] }).tags?.includes('riverside') && !o.state.riverside) continue;
      let ch = dayChance(z);
      if (z.preventedBy?.task === 'scarecrow' && Number(o.state.scare)) ch *= z.preventedBy.chanceMult;
      // 김매기로 관리한 밭(잡초 없음, 관리도 +)은 들쥐/병충해/곰팡이가 덜함
      if (z.mitigatedBy?.task === 'weed' && !Number(o.state.weeds) && Number(o.state.care) > 0) ch *= z.mitigatedBy.chanceMult;
      if (z.magicSetting) ch *= (z.magicSetting[this.magic] ?? 1) / Math.max(1, z.magicSetting.rare ?? 1);
      if (h.rng.next() < ch) {
        const loss = z.loss ? z.loss[0] + h.rng.next() * (z.loss[1] - z.loss[0]) : 0.1;
        o.state.loss = Math.min(1, Number(o.state.loss) + loss);
        h.notice('crop_disaster', { crop: c.def.nameKey, what: z.nameKey, pct: Math.round(loss * 100) });
      }
    }
    // 가뭄 (마을 사건: villageDaily 가 drought 를 켬). 물 대기로 막은 날이 아니면 손실 (한 번 가뭄에 lossMax 까지)
    if (dry && day > Number(o.state.protect)) {
      const z = this.d.disasters.drought;
      o.state.dryLoss = Math.min(z?.lossMax ?? 0.4, Number(o.state.dryLoss ?? 0) + (z?.lossPerDay ?? 0.06));
      o.state.loss = Math.min(1, Number(o.state.loss) + (z?.lossPerDay ?? 0.06) * (Number(o.state.dryLoss) < (z?.lossMax ?? 0.4) ? 1 : 0));
    }
  }

  /** 마을 우박 (village): 날마다 한 번 굴려서 맞으면 익어 가는 밭 전부 */
  villageHail(fields: ObjectInstance[], h: FarmHost): void {
    const z = this.d.disasters.hail;
    if (!z || (z.seasons && !z.seasons.includes(h.season()))) return;
    if (h.rng.next() >= dayChance(z)) return;
    let hit = false;
    for (const o of fields) {
      if (!this.crop(o) || (z.stages && !(z.stages as number[]).includes(Number(o.state.stage)))) continue;
      const loss = z.loss[0] + h.rng.next() * (z.loss[1] - z.loss[0]);
      o.state.loss = Math.min(1, Number(o.state.loss) + loss);
      hit = true;
    }
    if (hit) h.notice('crop_disaster', { crop: 'crop.all', what: z.nameKey, pct: 0 });
  }

  /** 마을 단위 사건 (가뭄): 날마다 한 번, 밭 전부에 */
  villageDaily(fields: ObjectInstance[], h: FarmHost): void {
    const z = this.d.disasters.drought;
    if (!z) return;
    if (!z.seasons.includes(h.season())) return;
    // 진행 중 판정은 작물 있는 밭만
    if (fields.some((o) => this.crop(o) && Number(o.state.drought) > 0)) return;
    if (h.rng.next() < z.chance.value) {
      let any = false;
      for (const o of fields) if (this.crop(o)) {
        o.state.drought = z.duration.value;
        o.state.dryLoss = 0;
        any = true;
      }
      if (any) h.notice('drought', {});
    }
  }

  /** 묘목 심기 (17-4 장터 묘목): 다 자랄 때까지 열매 없음 */
  plant(o: ObjectInstance, cropId: string, day: number, seasonDays: number): void {
    const def = this.d.crops[cropId];
    this.sow(o, cropId);
    o.state.matureDay = day + Math.round((def.perennial?.matureSeasons?.value ?? 4) * seasonDays);
  }

  private orchardDaily(o: ObjectInstance, h: FarmHost): void {
    const c = this.crop(o);
    if (!c) return;
    const season = h.season();
    const day = h.day();
    const SD = h.seasonDays();
    // 어린 나무: 자라는 동안 잎만
    if (day < Number(o.state.matureDay ?? 0)) {
      o.state.stage = 0;
      return;
    }
    // 봄 첫날 새 열매 주기 (지난해 안 거둔 열매는 떨어짐)
    if (season === (c.def.perennial?.cycleStart ?? 'spring') && day % SD === 0) {
      o.state.prog = 0;
      o.state.stage = 0;
      o.state.ripeDay = 0;
      o.state.loss = 0;
    }
    // 재해 (까마귀/병충해/우박/고블린) 와 익은 뒤 손실
    if (Number(o.state.stage) >= 1) for (const dz of c.def.disasters ?? []) {
      const z = this.d.disasters[dz];
      if (!z || z.village || (z.seasons && !z.seasons.includes(season))) continue;
      if (h.rng.next() < dayChance(z)) o.state.loss = Math.min(1, Number(o.state.loss) + (z.loss ? z.loss[0] : 0.05));
    }
    if (Number(o.state.stage) === 4 && day - Number(o.state.ripeDay) > this.d.growth.ripeHold.value) o.state.loss = Math.min(1, Number(o.state.loss) + this.d.growth.overripeLossPerDay);
    if (Number(o.state.stage) < 4) {
      o.state.prog = Math.min(1, Number(o.state.prog) + this.dailyGrowth(c.def, season, SD));
      const st = Number(o.state.prog) >= 1 && (c.def.harvestSeasons as string[]).includes(season) ? 4 : Math.min(3, Math.floor(Number(o.state.prog) * 4));
      if (st === 4 && Number(o.state.stage) < 4) {
        o.state.ripeDay = day;
        h.notice('crop_ripe', { crop: c.def.nameKey });
      }
      o.state.stage = st;
    }
  }

  /** 수확량과 지력 변화. 거둔 뒤 상태 정리 */
  harvest(o: ObjectInstance, tags: readonly string[], skillLevel: number, seasonDays: number, day: number): { item: string; n: number; straw: number } | null {
    const c = this.crop(o);
    if (!c || Number(o.state.stage) < 4) return null;
    const def = c.def;
    const fertMult = curve(this.d.fertility.yieldCurve, Number(o.state.fert));
    const care = Math.max(this.d.care.min, Math.min(this.d.care.max, 1 + Number(o.state.care)));
    const skill = this.d.skill.yieldBase + this.d.skill.yieldPerLevel * skillLevel;
    const size = tags.includes('orchard') ? { yield: 1 } : this.sizeOf(tags);
    const n = Math.max(0, Math.round(def.yield.perMediumPlot * size.yield * (seasonDays / 7) * fertMult * care * skill * this.yearMult * (1 - Number(o.state.loss))));
    const straw = def.kind === 'grain' ? Math.round(n * 0.3) : 0;
    if (tags.includes('orchard')) {
      // 거둔 나무는 이듬해 봄까지 쉼 (prog 1 로 두어 올해 다시 익지 않게)
      o.state.ripeDay = 0;
      o.state.prog = 1;
      o.state.stage = 3;
      o.state.loss = 0;
      return { item: def.yield.item, n, straw: 0 };
    }
    // 지력 (31-4 삼포제): 같은 분류를 연달아 심으면 추가 감소, 콩은 회복
    const kind = KINDS.indexOf(def.kind) + 1;
    let cost = def.fertilityCost;
    if (kind === Number(o.state.lastKind) && cost > 0) cost += this.d.fertility.repeatPenalty;
    o.state.fert = Math.max(this.d.fertility.min, Math.min(this.d.fertility.max, Number(o.state.fert) - cost));
    o.state.lastKind = kind;
    o.state.crop = 0;
    o.state.tilled = 0;
    o.state.prog = 0;
    o.state.stage = 0;
    o.state.weeds = 0;
    o.state.scare = 0;
    o.state.loss = 0;
    o.state.glean = def.kind === 'grain' || def.kind === 'legume' ? day + 2 : 0;
    o.state.drought = 0;
    o.state.protect = 0;
    return { item: def.yield.item, n, straw };
  }
}

/**
 * 재해 하루 확률: per = day 그대로, 날씨 날(wet_day/storm_day/heavy_rain_day)은 그 날씨가 올 확률을 곱함 (날씨 M10 전 평균값),
 * per_life 는 한 인생(104일) 기대 횟수 → 하루 확률
 */
const WEATHER_ODDS: Record<string, number> = { day: 1, wet_day: 0.2, storm_day: 0.05, heavy_rain_day: 0.07 };
function dayChance(z: any): number {
  const v = z.chance?.value ?? 0;
  if (z.chance?.scale === 'per_life') return v / 104;
  return v * (WEATHER_ODDS[z.chance?.per ?? 'day'] ?? 1);
}

function curve(pts: [number, number][], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return pts[pts.length - 1][1];
}
