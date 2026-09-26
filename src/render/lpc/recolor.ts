/**
 * Palette swap shared by the browser compositor and the Node tools (pure, operates on RGBA bytes).
 * Same rule as the LPC generator's CPU path: a pixel matches a source colour when each RGB channel is
 * within +-1; alpha is kept.
 */

export function parseHex(list: string[]): number[] {
  return list.map((h) => parseInt(h.replace('#', '').slice(0, 6), 16));
}

export function recolorPixels(data: Uint8Array | Uint8ClampedArray, from: number[], to: number[]): void {
  const exact = new Map<number, number>();
  for (let i = 0; i < from.length; i++) if (!exact.has(from[i])) exact.set(from[i], to[i]);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = (r << 16) | (g << 8) | b;
    let t = exact.get(key);
    if (t === undefined) {
      for (let k = 0; k < from.length; k++) {
        const f = from[k];
        if (Math.abs(((f >> 16) & 255) - r) <= 1 && Math.abs(((f >> 8) & 255) - g) <= 1 && Math.abs((f & 255) - b) <= 1) {
          t = to[k];
          break;
        }
      }
      if (t === undefined) continue;
    }
    data[i] = (t >> 16) & 255;
    data[i + 1] = (t >> 8) & 255;
    data[i + 2] = t & 255;
  }
}
