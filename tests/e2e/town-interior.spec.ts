import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { expectNoGameErrors, game, openGame } from './helpers';

/**
 * 비주얼 개편 (docs/07) 실내 A 방식: 닫힌 집의 실내(벽·가구·2층)는 숨김, 연 집만 지붕이 들리며 실내가 드러남,
 * 2층집은 2층 보기, 닫으면 다시 숨김. B 방식(I 키)은 화면 전환
 */
mkdirSync('artifacts/qa/interior', { recursive: true });
test.setTimeout(240_000);

test('실내 A: 닫힌 집 실내 숨김, 연 집만 드러남, 2층', async ({ page }) => {
  const errors = await openGame(page, '/?town=ashford');
  // 2층집 하나 (계단이 있는 외관)
  const k = await game<number>(page, `
    const hk = window.__hk; const lot = hk.world.lot;
    for (let i = 0; i < hk.world.shells.count; i++) {
      const r = hk.world.shells.footRect(i);
      if (lot.objects.some((o) => o.id === 'stairs_wood' && o.x >= r[0] && o.x <= r[2] && o.y >= r[1] && o.y <= r[3])) return i;
    }
    return -1;`);
  expect(k).toBeGreaterThanOrEqual(0);
  // 닫혀 있으면 아무 집도 드러나지 않음
  expect(await game<number>(page, 'return window.__hk.world.shells.revealedSet().size;')).toBe(0);
  await game(page, `window.__hk.switchView(${k}); return 0;`);
  await page.waitForTimeout(1200);
  expect(await game<number[]>(page, 'return [...window.__hk.world.shells.revealedSet()];')).toEqual([k]);
  expect(await game<string>(page, 'return window.__hk.insideMode;')).toBe('a');
  await page.screenshot({ path: 'artifacts/qa/interior/a-open.png' });
  // 2층
  await page.keyboard.press('PageUp');
  await page.waitForTimeout(600);
  expect(await game<number>(page, 'return window.__hk.world.viewLevel;')).toBe(1);
  await page.screenshot({ path: 'artifacts/qa/interior/a-upstairs.png' });
  // 닫기
  await game(page, 'window.__hk.switchView(-1); return 0;');
  await page.waitForTimeout(1500);
  expect(await game<number>(page, 'return window.__hk.world.shells.revealedSet().size;')).toBe(0);
  expect(await game<number>(page, 'return window.__hk.world.viewLevel;')).toBe(0);
  await expectNoGameErrors(page, errors);
});
