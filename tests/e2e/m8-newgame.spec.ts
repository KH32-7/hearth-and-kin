/**
 * 새 게임 흐름 (GDD 27-1 타이틀 · 새 게임 · 가문 선택/만들기, 16-1 문장, 27-4 튜토리얼). 실제 클릭으로:
 * 흐름 (심즈식, 2026-09-27): 설정 → 가문(신분 · 형편) → 구성원(한 사람부터, 식구 더하기) → 집 고르기(마을 지도에서 사기) → 시작
 * 1) 7 신분을 골라 시작 → 조작 인물 신분이 맞고, 소유 신분은 고른 집에 들어가 집값을 냄, 오류 0 (메뉴 › 타이틀로 돌아가 다음 신분)
 * 2) 문장 편집기로 문장을 바꾸고 시작 → sim setHeraldry 성공 + 입력 로그에 같은 문장
 * 3) 가문 만들기에서 이름을 고치고 시작 → 조작 가족 이름에 반영
 * 4) 튜토리얼 첫 단계가 뜨고, 그 조작(Space 로 식구 바꾸기)을 하면 다음 단계. 건너뛰기 · 메뉴 › 설정에서 다시 보기
 */
import { expect, test, type Page } from '@playwright/test';
import { game } from './helpers';

async function openNewGame(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?new=1');
  await expect(page.locator('.ng[data-page="title"]')).toBeVisible();
  await page.waitForFunction(() => (window as any).__game?.ready?.(), null, { timeout: 90_000 });
  await expect(page.locator('.ng.wait')).toHaveCount(0);
  return errors;
}

const ngPage = (page: Page) => page.evaluate(() => (window as any).__newGame.page() as string);

async function toFamily(page: Page): Promise<void> {
  await page.locator('[data-act="new"]').click();
  await expect(page.locator('.ng[data-page="setup"]')).toBeVisible();
  await page.locator('[data-act="next"]').click();
  await expect(page.locator('.ng[data-page="family"]')).toBeVisible();
}

/** 가문 화면 → 구성원 화면 */
async function toCreate(page: Page): Promise<void> {
  await page.locator('[data-act="next"]').click();
  await expect(page.locator('.ng[data-page="create"]')).toBeVisible();
}

/** 구성원 화면 → 집 고르기 → 시작 (lotIndex: 살 수 있는 집 목록에서 몇 번째) */
async function buyAndStart(page: Page, lotIndex = 0): Promise<string | null> {
  await page.locator('.fc-start').click();
  await expect(page.locator('.ng[data-page="house"]')).toBeVisible();
  const rows = page.locator('.ng-house-row[data-lot]:not(.poor)');
  let lot: string | null = null;
  if (await rows.count()) {
    const row = rows.nth(Math.min(lotIndex, (await rows.count()) - 1));
    await row.click();
    lot = await row.getAttribute('data-lot');
    await expect(row).toHaveClass(/on/);
  }
  await page.locator('[data-act="start"]').click();
  return lot;
}

async function waitStarted(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__newGame.page() === 'closed', null, { timeout: 60_000 });
}

async function expectClean(page: Page, errors: string[]): Promise<void> {
  const errs = await game<string[]>(page, 'return g.errors();');
  const i18n = await game<string[]>(page, 'return g.missingI18n();');
  const failed = await game<string[]>(page, 'return g.failedAssets();');
  expect({ console: errors, game: errs, i18n, failed }).toEqual({ console: [], game: [], i18n: [], failed: [] });
}

type P = { id: number; name: string; household: number; inner: { estate: string } | null };

test('7 신분: 가문 선택 화면에서 골라 시작하면 조작 가족 신분이 맞음', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await openNewGame(page);
  for (const estate of ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble']) {
    await toFamily(page);
    await page.locator(`[data-act="estate-${estate}"]`).click();
    await expect(page.locator(`.ng-estate.on[data-estate="${estate}"]`)).toBeVisible();
    await page.locator('[data-act="wealth-normal"]').click();
    await toCreate(page);
    // 한 사람부터 시작
    await expect(page.locator('.fc-member:not(.add)')).toHaveCount(1);
    const lot = await buyAndStart(page, 1);
    await waitStarted(page);
    const st = await game<{ selectedId: number; persons: P[] }>(page, 'return g.getState();');
    const me = st.persons.find((p) => p.id === st.selectedId)!;
    expect(me.household, estate).toBe(1);
    expect(me.inner?.estate, estate).toBe(estate);
    const log = await page.evaluate(() => (window as any).__newGame.log().at(-1));
    expect(log.preset).toBe(`${estate}_normal`);
    const pr = log.results.find((r: { intent: string }) => r.intent === 'applyPreset').result;
    expect(pr.ok).toBe(true);
    // 부지를 고르는 신분(사제관·수도원 빼고)은 고른 집에 들어감
    if (estate !== 'clergy') {
      expect(lot, estate).not.toBeNull();
      expect(pr.result.house.lot, estate).toBe(lot);
      const town = await page.evaluate(() => (window as any).__hk.client.snap.town.playerLot);
      expect(town, estate).toBe(lot);
    }
    // 메뉴 › 타이틀로 (HUD 메뉴 팝업)
    await page.locator('[data-win="menu"]').click();
    await page.locator('.menu-row[data-menu="title"]').click();
    await expect(page.locator('.ng[data-page="title"]')).toBeVisible();
  }
  await expectClean(page, errors);
});

test('문장 편집기로 바꾼 문장이 sim 가문에 들어감', async ({ page }) => {
  const errors = await openNewGame(page);
  await toFamily(page);
  await page.locator('[data-act="estate-noble"]').click();
  await toCreate(page);
  await expect(page.locator('.ng[data-page="create"]')).toBeVisible();
  await page.locator('[data-act="heraldry"]').click();
  await expect(page.locator('.her-wrap[data-open="1"]')).toBeVisible();
  const pick = (row: string, id: string) => page.locator(`.her-row[data-row="${row}"] [data-id="${id}"]`).click();
  await pick('shield', 'kite');
  await pick('division', 'per_pale');
  await pick('tincture1', 'azure');
  await pick('tincture2', 'or');
  await pick('charge', 'lion');
  await pick('chargeTincture', 'gules');
  // 금속 위 금속이 아니면 경고 없음
  await expect(page.locator('.her-warn')).toHaveCount(0);
  await page.locator('[data-act="her-ok"]').click();
  await expect(page.locator('.her-wrap[data-open="0"]')).toHaveCount(1);
  const want = { shield: 'kite', division: 'per_pale', tinctures: ['azure', 'or'], charge: 'lion', chargeTincture: 'gules' };
  expect(await page.evaluate(() => (window as any).__newGame.draft().heraldry)).toEqual(want);
  await buyAndStart(page);
  await waitStarted(page);
  const log = await page.evaluate(() => (window as any).__newGame.log().at(-1));
  const her = log.results.find((r: { intent: string }) => r.intent === 'setHeraldry');
  expect(her.result.ok).toBe(true);
  // sim 입력 로그에 같은 사양으로 들어감 (결정론 재생 경로)
  const input = await page.evaluate(() => (window as any).__newGame.inputLog());
  const entry = JSON.stringify(input.log);
  expect(entry).toContain('"op":"setHeraldry"');
  expect(entry).toContain('"shield":"kite"');
  expect(entry).toContain('"charge":"lion"');
  await expectClean(page, errors);
});

test('가문 만들기에서 고친 이름이 조작 가족에 반영됨', async ({ page }) => {
  const errors = await openNewGame(page);
  await toFamily(page);
  await page.locator('[data-act="estate-artisan"]').click();
  await toCreate(page);
  await expect(page.locator('.fc-member[data-index="0"]')).toBeVisible();
  await page.locator('[data-act="member-0"]').click();
  await page.locator('input[data-field="name"]').fill('에드릭');
  await page.locator('[data-act="tab-traits"]').click();
  await page.locator('[data-act="trait-kind"]').click();
  await expect(page.locator('.fc-trait.on[data-act="trait-kind"]')).toBeVisible();
  // 식구 더하기 (한 사람에서 시작 → 둘)
  const before = await page.locator('.fc-member:not(.add)').count();
  expect(before).toBe(1);
  await page.locator('[data-act="member-add"]').click();
  await expect(page.locator('.fc-member:not(.add)')).toHaveCount(before + 1);
  await page.locator('[data-act="member-1"]').click();
  await page.locator('input[data-field="name"]').fill('엘런');
  await expect(page.locator('.fc-issue')).toHaveCount(0);
  await buyAndStart(page);
  await waitStarted(page);
  const st = await game<{ persons: P[] }>(page, 'return g.getState();');
  const names = st.persons.filter((p) => p.household === 1).map((p) => p.name);
  expect(names).toEqual(expect.arrayContaining(['에드릭', '엘런']));
  expect(names.length).toBeGreaterThanOrEqual(before + 1);
  const me = await game<{ selectedId: number; persons: P[] }>(page, 'return g.getState();');
  expect(me.persons.find((p) => p.id === me.selectedId)?.name).toBe('에드릭');
  await expectClean(page, errors);
});

test('튜토리얼: 첫 단계가 뜨고 해낸 조작으로 넘어감, 건너뛰기와 다시 보기', async ({ page }) => {
  const errors = await openNewGame(page);
  await toFamily(page);
  await toCreate(page);
  await buyAndStart(page);
  await waitStarted(page);
  const card = page.locator('.tut');
  await expect(card).toBeVisible();
  // 혼자 사는 가족: 식구 바꾸기 단계는 건너뜀 → 쓸 수 있는 물건 보기(Shift)부터
  await expect(card).toHaveAttribute('data-step', 'usable');
  await page.keyboard.down('Shift');
  await page.keyboard.up('Shift');
  await expect(card).toHaveAttribute('data-step', 'pie', { timeout: 5000 });
  // 건너뛰기 → 기억됨
  await card.locator('.tut-skip').click();
  await expect(card).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('hk.tutorial.v1'))).toBe('done');
  // 메뉴 › 설정 › 튜토리얼 다시 보기
  await page.locator('[data-win="menu"]').click();
  await page.locator('.menu-row[data-menu="settings"]').click();
  await expect(page.locator('.ng[data-page="settings"]')).toBeVisible();
  await page.locator('[data-act="tutorial"]').click();
  expect(await ngPage(page)).toBe('closed');
  await expect(card).toHaveAttribute('data-step', 'usable');
  await expectClean(page, errors);
});
