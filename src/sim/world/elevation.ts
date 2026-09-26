/**
 * 지형 높이 → 못 지나가는 칸 (docs/07). 렌더러(절벽 3칸 그림)와 같은 규칙:
 * - 높은 칸의 남쪽 아래 1~3칸 = 절벽면 (모퉁이 대각선 포함)
 * - 높은 칸의 좌우 옆 = 옆면, 높은 칸 바로 위(북쪽) 낮은 칸 = 윗단 가장자리
 * - 비탈(ramps) 칸은 지나감 → 높이 사이를 잇는 길
 * 게임 로직은 칸 단위만 (그림 크기를 모름)
 */
export function cliffBlocked(w: number, h: number, elev: number[], ramps: { x: number; y: number; w: number }[] = []): Uint8Array {
  const out = new Uint8Array(w * h);
  const e = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? elev[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] ?? 0 : elev[y * w + x] ?? 0);
  const inRamp = (x: number, y: number) => ramps.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const me = e(x, y);
      let block = false;
      for (let dy = 1; dy <= 3 && !block; dy++) for (let dx = -1; dx <= 1 && !block; dx++) if (e(x + dx, y - dy) > me) block = true;
      if (!block && (e(x - 1, y) > me || e(x + 1, y) > me || e(x, y + 1) > me || e(x - 1, y + 1) > me || e(x + 1, y + 1) > me)) block = true;
      if (block && !inRamp(x, y)) out[y * w + x] = 1;
    }
  }
  return out;
}
