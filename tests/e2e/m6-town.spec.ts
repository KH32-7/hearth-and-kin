import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { expectNoGameErrors, game, openGame } from './helpers';

/**
 * BRIEF M6: 마을 지도(?town=ashford)를 열어 미니맵으로 이동, 화면 범위가 sim 세밀도로 전달됨,
 * 새 소식이 오면 포고 두루마리가 펼쳐지고 목록에 쌓임, 말 탄 사람이 그려짐, 한국어 키 누락 0
 */
mkdirSync('artifacts/qa/m6', { recursive: true });
test.setTimeout(240_000);

test('M6 마을: 미니맵 이동, 세밀도, 포고, 말', async ({ page }) => {
  const errors = await openGame(page, '/?town=ashford');
  // 지도는 우상단 지도 버튼으로 엶 (GDD 27-2)
  await page.locator('.win-btn[data-win="map"]').click();
  await expect(page.getByTestId('town-map')).toBeVisible();
  const pop = await game<number>(page, 'return window.__hk.client.snap.town.population;');
  expect(pop).toBeGreaterThan(100);

  // 미니맵 누르기 → 카메라가 그 칸으로 (장터 광장 쪽)
  const box = await page.locator('.town-map-over').boundingBox();
  expect(box).not.toBeNull();
  const before = await game<{ x: number }>(page, 'return g.getState().camera;');
  await page.mouse.click(box!.x + box!.width * (110 / 200), box!.y + box!.height * (55 / 150));
  await page.waitForTimeout(400);
  const after = await game<{ x: number; y: number }>(page, 'return g.getState().camera;');
  expect(Math.abs(after.x - 110 * 32)).toBeLessThan(64);
  expect(after.x).not.toBe(before.x);

  // 화면 범위 → sim: 장터 근처 사람이 전체 세밀도가 됨
  await page.waitForTimeout(2500);
  const lod = await game<{ full: number }>(page, 'return window.__hk.client.snap.town.lod;');
  expect(lod.full).toBeGreaterThanOrEqual(2);

  // 말: 전원 전체로 올려 말 탄 사람이 나올 때까지
  const rider = await game<string | null>(page, `
    const hk = window.__hk;
    await hk.client.intent({ kind: 'forceLod', lod: 'full' });
    hk.setSpeed(2);
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const f = hk.client.snap.persons.find((p) => p.riding !== undefined);
      if (f) { hk.setSpeed(0); await new Promise((r) => setTimeout(r, 300)); const d = hk.chars.drawnPosition(f.id); hk.renderer.setZoom(3); hk.renderer.centerOn(d.x, d.y - 30); return f.name; }
    }
    return null;`);
  expect(rider).not.toBeNull();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'artifacts/qa/m6/e2e-rider.png' });

  // 포고: 며칠 건너뛰면 새 소식 → 두루마리가 펼쳐지고 소식 목록에 쌓임
  await game(page, `
    const hk = window.__hk;
    await hk.client.intent({ kind: 'forceLod', lod: null });
    await g.fastForwardDays(2);
    hk.setSpeed(1);
    g.setZoom(2);`);
  await expect(page.getByTestId('crier').first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'artifacts/qa/m6/e2e-crier.png' });
  await page.getByTestId('town-news-btn').click({ force: true });
  await expect(page.getByTestId('town-news')).toBeVisible();
  const rows = await page.locator('.town-news-row').count();
  expect(rows).toBeGreaterThan(0);
  // 소식 문구에 치환 안 된 {…} 나 키가 남지 않음
  const texts = await page.locator('.town-news-text').allTextContents();
  for (const tx of texts) {
    expect(tx).not.toMatch(/\{[a-z]+\}|news\.|house\.|place\./);
  }
  // 이사: 집 구하기 → 가장 싼 빈 땅 → 이사 → 조작 가문 부지가 바뀜
  await page.getByTestId('town-move-btn').click({ force: true });
  await expect(page.getByTestId('town-move')).toBeVisible();
  const before2 = await game<string>(page, 'return window.__hk.client.snap.town.playerLot;');
  const first = page.locator('.town-move-row').first();
  await first.hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/qa/m6/e2e-move-list.png' });
  await first.locator('.town-move-buy').click();
  await expect.poll(() => game<string>(page, 'return window.__hk.client.snap.town.playerLot;'), { timeout: 10_000 }).not.toBe(before2);
  await expectNoGameErrors(page, errors);
});
