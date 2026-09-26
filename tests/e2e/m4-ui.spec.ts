import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { expectNoGameErrors, game, openGame } from './helpers';

mkdirSync('artifacts/qa/m4', { recursive: true });

// M4 화면: 돈 표시, 일 탭(일 구하기 → 출근 → 일당), 가계부 창
test('M4 살림: 돈 · 일 탭 · 출근과 일당 · 가계부', async ({ page }, info) => {
  test.skip(info.project.name === 'laptop-125', '두 해상도로 충분');
  test.setTimeout(180_000);
  const errors = await openGame(page);
  await game(page, 'g.setZoom(3); return true;');
  await expect(page.getByTestId('money')).toBeVisible();

  // 일 탭: 구할 수 있는 일 목록 → 실제 클릭으로 영주 밭 일꾼
  await page.locator('.tab[data-tab="work"]').click();
  await expect(page.locator('.work-row').first()).toBeVisible();
  await page.waitForTimeout(250);
  await page.locator('.hud-bl').screenshot({ path: `artifacts/qa/m4/work-list-${info.project.name}.png` });
  await page.locator('.rel-btn[data-career="field_hand"]').click();
  await expect(page.locator('.work-job .work-title')).toBeVisible();
  await page.locator('.rel-btn[data-attitude="hard"]').click();
  await expect(page.locator('.rel-btn[data-attitude="hard"].on')).toBeVisible();

  // 다음 출근 → 퇴근까지 빨리 돌리고 일당이 들어오는지
  await game(page, 'await g.fastForward(1440); return true;');
  await expect.poll(() => game<number>(page, "const e = g.getState().econ; return [...e.book, e.today].reduce((a, d) => a + (d.income.wage ?? 0), 0);"), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(await game<number>(page, 'return g.getState().persons[0].career.perf;')).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  await page.locator('.hud-bl').screenshot({ path: `artifacts/qa/m4/work-job-${info.project.name}.png` });

  // 가계부: 돈 칸을 눌러 열기
  await page.getByTestId('money').click();
  await expect(page.getByTestId('ledger')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `artifacts/qa/m4/ledger-${info.project.name}.png` });
  await expect(page.locator('.ledger-price')).toHaveCount(13);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ledger')).toBeHidden();
  await expectNoGameErrors(page, errors);
});
