import { expect, test } from '@playwright/test';
import { expectNoGameErrors, game, openBookPage, openGame } from './helpers';

/**
 * UI 개편 (GDD 27장): 하루 모드 HUD 배치, 자주 쓰는 창 팝업, 인물 수첩(Tab), 우상단 창 버튼, 대사창.
 * 세 해상도에서 HUD 묶음끼리 겹치지 않음. 조작 안내 글(설명문)을 화면에 두지 않음 (27-3).
 */
test('HUD 묶음이 제자리에 있고 서로 겹치지 않음', async ({ page }, info) => {
  const errors = await openGame(page);
  for (const sel of ['.clock', '.topbar', '.me', '.family', '.speed', '.quick']) await expect(page.locator(sel)).toBeVisible();
  const boxes = await page.evaluate(() => ['.clock', '.topbar', '.me-bust', '.me-line', '.family', '.speed', '.quick'].map((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { s, x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
  }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = a.x0 < b.x1 - 1 && b.x0 < a.x1 - 1 && a.y0 < b.y1 - 1 && b.y0 < a.y1 - 1;
      expect(overlap, `${a.s} ↔ ${b.s}`).toBe(false);
    }
  }
  // 좌상단 · 좌하단 · 우측 끝에 붙어 있음
  const vw = page.viewportSize()!;
  const clock = boxes.find((b) => b.s === '.clock')!;
  expect(clock.x0).toBeLessThan(40);
  expect(clock.y0).toBeLessThan(40);
  const quick = boxes.find((b) => b.s === '.quick')!;
  expect(vw.width - quick.x1).toBeLessThan(40);
  expect(vw.height - quick.y1).toBeLessThan(40);
  await page.screenshot({ path: `artifacts/qa/ui/hud-${info.project.name}.png` });
  // 모든 UI 그림이 선명하게 (27-3): 배경·9-slice 테두리·img·canvas 가 있는 요소는 pixelated
  const blurry = await page.evaluate(() => {
    const bad: string[] = [];
    for (const e of document.querySelectorAll<HTMLElement>('#app *')) {
      const cs = getComputedStyle(e);
      const hasImg = e instanceof HTMLImageElement || e instanceof HTMLCanvasElement || cs.backgroundImage.includes('url(') || cs.borderImageSource.includes('url(');
      if (hasImg && e.id !== 'game-canvas' && cs.imageRendering !== 'pixelated') bad.push(`${e.tagName}.${e.className}`);
    }
    return bad.slice(0, 10);
  });
  expect(blurry).toEqual([]);
  // 설명문 금지 (27-3): 예전 도움말 줄이 없음
  await expect(page.locator('.help')).toHaveCount(0);
  await expectNoGameErrors(page, errors);
});

test('자주 쓰는 창: 누르면 뜨고 다시 누르면 닫힘', async ({ page }) => {
  test.skip(test.info().project.name === 'laptop-125', '두 해상도로 충분');
  const errors = await openGame(page);
  for (const k of ['needs', 'emo', 'rel', 'wish']) {
    await page.locator(`.qk-btn[data-pop="${k}"]`).click();
    await expect(page.locator(`.hud-pop.open[data-pop="${k}"]`)).toBeVisible();
    if (k === 'needs') await expect(page.locator('.hud-pop .need')).toHaveCount(8);
  }
  await page.locator('.qk-btn[data-pop="wish"]').click();
  await expect(page.locator('.hud-pop.open')).toHaveCount(0);
  // 메뉴: 톱니 → 펼침, UI 숨기기
  await page.locator('.win-btn[data-win="menu"]').click();
  await expect(page.locator('.hud-menu.open')).toBeVisible();
  await page.locator('.menu-row[data-menu="hideUi"]').click();
  await expect(page.locator('.hud')).toBeHidden();
  await page.keyboard.press('h');
  await expect(page.locator('.hud')).toBeVisible();
  await expectNoGameErrors(page, errors);
});

test('인물 수첩: 모든 탭과 책갈피가 열림', async ({ page }, info) => {
  test.skip(info.project.name === 'laptop-125', '두 해상도로 충분');
  const errors = await openGame(page);
  await page.keyboard.press('Tab');
  await expect(page.locator('.nb-wrap.open')).toBeVisible();
  const tabs = await page.locator('.nb-tab').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tab!));
  expect(tabs).toEqual(expect.arrayContaining(['person', 'house', 'work', 'record']));
  for (const tab of tabs) {
    await page.locator(`.nb-tab[data-tab="${tab}"]`).click();
    const pages = await page.locator('.nb-mark').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.page!));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.length).toBeLessThanOrEqual(5);
    for (const pg of pages) {
      await page.locator(`.nb-mark[data-page="${pg}"]`).click();
      await expect(page.locator(`.nb[data-page="${pg}"]`)).toBeVisible();
      await expect(page.locator('.nb-mark.on')).toHaveAttribute('data-page', pg);
    }
  }
  await openBookPage(page, 'person', 'persona');
  await page.locator('.nb').screenshot({ path: `artifacts/qa/ui/book-persona-${info.project.name}.png` });
  // 책 격자: 표지는 원본(224x133)의 정수 배
  const size = await page.locator('.nb-cover').evaluate((e) => [(e as HTMLImageElement).clientWidth, (e as HTMLImageElement).clientHeight]);
  expect(size[0] % 224).toBe(0);
  expect(size[1] % 133).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.nb-wrap.open')).toHaveCount(0);
  // 우상단 창 버튼: 연대기 → 수첩 기록 쪽
  await page.locator('.win-btn[data-win="chronicle"]').click();
  await expect(page.locator('.nb[data-page="chronicle"]')).toBeVisible();
  await expectNoGameErrors(page, errors);
});

test('건축/구매 모드: 인물 묶음은 숨고 아래 판 3단', async ({ page }, info) => {
  test.skip(info.project.name === 'laptop-125', '두 해상도로 충분');
  const errors = await openGame(page);
  await page.locator('.mode-btn[data-mode="buy"]').click();
  await expect(page.locator('.me')).toBeHidden();
  await expect(page.locator('.speed')).toBeHidden();
  for (const sel of ['.dock-left', '.dock-mid', '.dock-detail']) await expect(page.locator(sel)).toBeVisible();
  await expect(page.locator('.buy-item').first()).toBeVisible();
  await page.screenshot({ path: `artifacts/qa/ui/buy-${info.project.name}.png` });
  await page.locator('.mode-btn[data-mode="live"]').click();
  await expect(page.locator('.me')).toBeVisible();
  await expectNoGameErrors(page, errors);
});

test('대사창: 조작 인물의 대화가 끝나면 지문 + 대사가 뜸', async ({ page }, info) => {
  test.skip(info.project.name !== 'fhd-1920', '한 해상도로 충분');
  const errors = await openGame(page);
  const ids = await game<number[]>(page, 'return g.getState().persons.filter((p) => p.household === 1).map((p) => p.id);');
  test.skip(ids.length < 2, '식구가 둘 이상 필요');
  await game(page, `g.setAutonomy(false); await g.queue(${ids[0]}, 'social.chat', ${ids[1]}); g.setSpeed(3); return true;`);
  await expect(page.locator('.dlg-wrap.open')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.dlg-text')).not.toHaveText('');
  const text = await page.locator('.dlg-text').textContent();
  expect(text ?? '').not.toMatch(/dlg\./);
  await page.screenshot({ path: `artifacts/qa/ui/dialog-${info.project.name}.png` });
  // 넘기면 닫힘
  for (let i = 0; i < 6 && (await page.locator('.dlg-wrap.open').count()); i++) await page.locator('.dlg').click();
  await expect(page.locator('.dlg-wrap.open')).toHaveCount(0);
  await expectNoGameErrors(page, errors);
});
