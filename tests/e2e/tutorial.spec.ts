/**
 * 첫 하루 튜토리얼 (GDD 27-4). 새 게임 → 실제 조작으로 첫 몇 단계:
 * 1) 시작 직후 멈춘 채 기상 카드(▼) → 누르면 1배속, 원형 메뉴 단계
 * 2) 플레이어 할 일을 넣으면 대기열 단계 → 여러 개 넣고 대기열 아이콘을 눌러 취소 → 욕구 단계 → 욕구 창 버튼
 * 3) 첫 자정이 지나면 하루 정산(멈춤, 번 돈·쓴 돈·기분·내일 할 일) → ▼ 로 신분별 첫 과제
 * 4) 튜토리얼 진행 상태 state() 는 저장 파일에 넣을 모양 (v2)
 */
import { expect, test, type Page } from '@playwright/test';
import { game } from './helpers';

async function newGame(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?new=1');
  await page.evaluate(() => {
    localStorage.removeItem('hk.tutorial.v2');
    localStorage.removeItem('hk.tutorial.v2.seen');
  });
  await expect(page.locator('.ng[data-page="title"]')).toBeVisible();
  await page.waitForFunction(() => (window as any).__game?.ready?.(), null, { timeout: 90_000 });
  await expect(page.locator('.ng.wait')).toHaveCount(0);
  await page.locator('[data-act="new"]').click();
  await page.locator('[data-act="next"]').click();
  await expect(page.locator('.ng[data-page="family"]')).toBeVisible();
  await page.locator('[data-act="next"]').click();
  await expect(page.locator('.ng[data-page="create"]')).toBeVisible();
  await page.locator('.fc-start').click();
  await expect(page.locator('.ng[data-page="house"]')).toBeVisible();
  const rows = page.locator('.ng-house-row[data-lot]:not(.poor)');
  if (await rows.count()) await rows.first().click();
  await page.locator('[data-act="start"]').click();
  await page.waitForFunction(() => (window as any).__newGame.page() === 'closed', null, { timeout: 60_000 });
  return errors;
}

const speed = (page: Page) => game<number>(page, 'return g.getState().speed;');

/** 우리 집 물건 중 지금 조작 인물이 할 수 있는 상호작용 (원형 메뉴와 같은 목록) */
async function homeActions(page: Page, n: number): Promise<Array<{ uid: number; ia: string }>> {
  return page.evaluate(async (want) => {
    const hk = (window as any).__hk;
    const s = hk.client.snap;
    const r = hk.homeRect();
    const me = hk.selectedId;
    const out: Array<{ uid: number; ia: string }> = [];
    const objs = s.objects.filter((o: any) => !r || (o.x >= r[0] && o.x <= r[2] && o.y >= r[1] && o.y <= r[3]));
    for (const o of objs) {
      const entries = await hk.client.menu(me, o.uid);
      for (const e of entries) {
        if (!e.available || e.interactionId.startsWith('farm.') || e.interactionId.includes('run_away')) continue;
        out.push({ uid: o.uid, ia: e.interactionId });
        if (out.length >= want) return out;
      }
    }
    return out;
  }, n);
}

test('첫 하루: 멈춘 채 기상 → 원형 메뉴 → 대기열 → 욕구, 첫 자정에 하루 정산 → 첫 과제', async ({ page }) => {
  const errors = await newGame(page);
  const card = page.locator('.tut:not(.tut-once)');
  // 1) 카메라가 가장 → 집을 비춘 뒤 기상 카드, 그동안 멈춤
  await expect(card).toHaveAttribute('data-step', 'wake', { timeout: 15_000 });
  await expect(card).toBeVisible();
  await expect(card.locator('.tut-next')).toBeVisible();
  expect(await speed(page)).toBe(0);
  await page.screenshot({ path: 'artifacts/qa/newgame/tutorial_wake.png' });
  await card.click();
  await expect(card).toHaveAttribute('data-step', 'pie', { timeout: 5000 });
  await expect.poll(() => speed(page)).toBe(1);
  // 원형 메뉴 단계는 쓸 수 있는 물건(Shift) · 가까운 물건(E) 키캡을 곁들임
  await expect(card.locator('.tut-tips img')).toHaveCount(2);
  await page.screenshot({ path: 'artifacts/qa/newgame/tutorial_pie.png' });

  // 2) 할 일 하나 → 대기열 단계
  const acts = await homeActions(page, 3);
  expect(acts.length).toBeGreaterThanOrEqual(2);
  const me = await game<number>(page, 'return g.getState().selectedId;');
  await game(page, `await g.setSpeed(0); await g.queue(${me}, ${JSON.stringify(acts[0].ia)}, ${acts[0].uid});`);
  await expect(card).toHaveAttribute('data-step', 'queue', { timeout: 5000 });
  // 여러 개 넣고 대기열 아이콘을 눌러 하나 뺌
  for (const a of acts.slice(1)) await game(page, `await g.queue(${me}, ${JSON.stringify(a.ia)}, ${a.uid});`);
  await expect.poll(() => page.locator('.q-item:not(.auto)').count()).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(400);
  await page.locator('.q-item:not(.auto)').last().click();
  await expect(card).toHaveAttribute('data-step', 'needs', { timeout: 5000 });
  // 욕구 창 버튼
  await page.locator('[data-pop="needs"]').first().click();
  await expect(card).not.toHaveAttribute('data-step', 'needs', { timeout: 5000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'artifacts/qa/newgame/tutorial_after_needs.png' });
  const next = await card.getAttribute('data-step');
  expect(['kitchen', 'fire', 'cook', 'eat', 'talk', 'sleep']).toContain(next);

  // 처음 마주칠 때 한 번: 건축 모드 첫 진입 카드 (다시 들어가면 안 뜸)
  await page.keyboard.press('b');
  const once = page.locator('.tut-once');
  await expect(once).toHaveAttribute('data-once', 'build', { timeout: 5000 });
  await expect(once).toBeVisible();
  await page.screenshot({ path: 'artifacts/qa/newgame/tutorial_once_build.png' });
  await once.click();
  await expect(once).toBeHidden();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).__hk.build?.mode)).toBe('live');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hk.tutorial.v2.seen') ?? '[]'))).toContain('build');

  // 저장용 상태
  const st = await page.evaluate(() => (window as any).__tutorial.state());
  expect(st).toMatchObject({ v: 2, step: next });
  expect(st.done).toEqual(expect.arrayContaining(['pie', 'queue', 'needs']));

  // 3) 첫 자정을 넘기면 하루 정산 (멈춤) → ▼ → 신분별 첫 과제
  await game(page, 'await g.setSpeed(1); await g.setTime(23 * 60 + 58);');
  await expect(card).toHaveAttribute('data-step', 'summary', { timeout: 20_000 });
  await expect(card).toHaveClass(/sum/, { timeout: 20_000 });
  await expect.poll(() => speed(page)).toBe(0);
  await expect(card.locator('.tut-goal')).toBeVisible();
  await page.screenshot({ path: 'artifacts/qa/newgame/tutorial_summary.png' });
  const goal = await card.locator('.tut-goal').getAttribute('data-goal');
  expect(['till', 'farm', 'order', 'shop', 'mass', 'attend', 'drill', 'petition', 'plead', 'daywork', 'work']).toContain(goal);
  await card.click();
  await expect(card).toHaveAttribute('data-step', 'goal', { timeout: 5000 });
  await expect.poll(() => speed(page)).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/qa/newgame/tutorial_goal.png' });

  // 건너뛰기 → 기억됨 (v2 키)
  await card.locator('.tut-skip').click();
  await expect(card).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('hk.tutorial.v2'))).toBe('done');
  // 튜토리얼 문구 키 (건축 화면의 다른 빠진 키는 이 테스트 대상 아님)
  const i18n = (await game<string[]>(page, 'return g.missingI18n();')).filter((k) => k.startsWith('tut.'));
  expect({ errors, i18n }).toEqual({ errors: [], i18n: [] });
});

test('신분별 첫 과제와 요리: 7 신분 모두 그 집에서 실제로 되는 것', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await newGame(page);
  const want: Record<string, string[]> = {
    serf: ['till', 'farm'], freeman: ['daywork'], artisan: ['order'], merchant: ['shop'], clergy: ['mass', 'attend'], knight: ['drill'], noble: ['petition', 'plead'],
  };
  const seen: Record<string, unknown> = {};
  for (const estate of Object.keys(want)) {
    // 신분마다 새로 불러옴 (타이틀로 돌아가 다시 시작하면 이전 게임 상태가 남을 수 있음)
    await page.goto('/?new=1');
    await expect(page.locator('.ng[data-page="title"]')).toBeVisible();
    await page.waitForFunction(() => (window as any).__game?.ready?.(), null, { timeout: 90_000 });
    await expect(page.locator('.ng.wait')).toHaveCount(0);
    await page.locator('[data-act="new"]').click();
    await page.locator('[data-act="next"]').click();
    await page.locator(`[data-act="estate-${estate}"]`).click();
    await page.locator('[data-act="wealth-normal"]').click();
    await page.locator('[data-act="next"]').click();
    await page.locator('.fc-start').click();
    const rows = page.locator('.ng-house-row[data-lot]:not(.poor)');
    if (await rows.count()) await rows.first().click();
    await page.locator('[data-act="start"]').click();
    await page.waitForFunction(() => (window as any).__newGame.page() === 'closed', null, { timeout: 60_000 });
    const plan = await page.evaluate(() => {
      const s = (window as any).__hk.client.snap;
      return { ...(window as any).__tutorial.plan(), estate: s.house?.estate, careers: s.persons.filter((p: any) => p.household === 1).map((p: any) => p.career?.id ?? null) };
    });
    seen[estate] = plan;
    expect(want[estate], `${estate}: ${JSON.stringify(plan)}`).toContain(plan.goal);
  }
  console.log(JSON.stringify(seen));
  const i18n = await game<string[]>(page, 'return g.missingI18n();');
  expect({ errors, i18n }).toEqual({ errors: [], i18n: [] });
});
