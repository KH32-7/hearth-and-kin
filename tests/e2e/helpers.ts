import { expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

export async function openGame(page: Page, url = '/'): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__game?.ready?.(), null, { timeout: 60_000 });
  return errors;
}

export const game = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(async () => { const g = window.__game; ${fn} })()`) as Promise<T>;

/**
 * 흐림 검사: 세계 1px 이 장치 k×k 블록으로 그려졌다면 모든 블록 안 색이 같아야 함.
 * 격자 원점은 모르므로 k² 가지 어긋남 중 가장 잘 맞는 것을 고르고, 거기서 불균일 블록 수를 셈.
 */
export function blurStats(png: PNG, k: number): { k: number; blocks: number; nonUniform: number; offset: [number, number] } {
  let best = { blocks: 0, nonUniform: Infinity, offset: [0, 0] as [number, number] };
  for (let oy = 0; oy < k; oy++) {
    for (let ox = 0; ox < k; ox++) {
      let blocks = 0;
      let bad = 0;
      for (let by = oy; by + k <= png.height; by += k) {
        for (let bx = ox; bx + k <= png.width; bx += k) {
          blocks++;
          const i0 = (by * png.width + bx) * 4;
          let same = true;
          for (let y = 0; y < k && same; y++) {
            for (let x = 0; x < k; x++) {
              const i = ((by + y) * png.width + bx + x) * 4;
              if (png.data[i] !== png.data[i0] || png.data[i + 1] !== png.data[i0 + 1] || png.data[i + 2] !== png.data[i0 + 2]) {
                same = false;
                break;
              }
            }
          }
          if (!same) bad++;
        }
      }
      if (bad < best.nonUniform) best = { blocks, nonUniform: bad, offset: [ox, oy] };
    }
  }
  return { k, ...best };
}

export async function canvasPng(page: Page): Promise<PNG> {
  const buf = await page.locator('#game-canvas').screenshot({ scale: 'device' });
  return PNG.sync.read(buf);
}

export async function expectNoGameErrors(page: Page, consoleErrors: string[]): Promise<void> {
  const errs = await game<string[]>(page, 'return g.errors();');
  const failed = await game<string[]>(page, 'return g.failedAssets();');
  const i18n = await game<string[]>(page, 'return g.missingI18n();');
  expect({ console: consoleErrors, game: errs, failed, i18n }).toEqual({ console: [], game: [], failed: [], i18n: [] });
}
