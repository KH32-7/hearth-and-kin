/**
 * 바깥 기온과 방 기온 (GDD 11-1 온기와 실내 기온, 19-2 계절 기온)
 */
import type { Season } from '../core/types';
import type { Balance } from '../data/simData';

/** 바깥 기온: 가장 추운 시각(coldestHour)과 가장 따뜻한 시각 사이를 코사인으로 보간 */
export function outsideTemp(balance: Balance, season: Season, minuteOfDay: number): number {
  const t = balance.temperature;
  const s = t.seasons[season];
  const hour = minuteOfDay / 60;
  const cold = t.coldestHour;
  const warm = t.warmestHour;
  let phase: number;
  if (hour >= cold && hour <= warm) {
    phase = (hour - cold) / (warm - cold); // 0 → 1 올라감
    return s.nightC + (s.dayC - s.nightC) * (0.5 - 0.5 * Math.cos(Math.PI * phase));
  }
  const span = 24 - (warm - cold);
  const since = hour > warm ? hour - warm : hour + 24 - warm;
  phase = since / span; // 0 → 1 내려감
  return s.dayC - (s.dayC - s.nightC) * (0.5 - 0.5 * Math.cos(Math.PI * phase));
}

/** 방 목표 기온 = 바깥 + 단열 + 열원 - 환기 */
export function roomTargetTemp(
  balance: Balance,
  outside: number,
  wallStyles: string[],
  roomTiles: number,
  litHearths: number,
  openDoors: number,
): number {
  const t = balance.temperature;
  let insulation = 0;
  if (wallStyles.length) {
    for (const s of wallStyles) insulation += t.wallInsulationC[s] ?? t.wallInsulationC.default;
    insulation /= wallStyles.length;
  }
  const heat = litHearths * t.hearthHeatC * Math.min(1, t.hearthRefRoomTiles / Math.max(1, roomTiles));
  const vent = openDoors > 0 ? t.openDoorVentC : 0;
  return outside + insulation + heat + vent;
}
