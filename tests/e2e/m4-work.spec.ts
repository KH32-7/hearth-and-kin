import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { expectNoGameErrors, game, openGame, openBookPage } from './helpers';

mkdirSync('artifacts/qa/m4', { recursive: true });

type Obj = { uid: number; defId: string; x: number; y: number; state: Record<string, number | boolean> };

async function focusObj(page: Page, defId: string, dy = 0): Promise<void> {
  await game(page, `const o = g.getState().objects.find((o) => o.defId === '${defId}'); g.centerOn((o.x + 1.5) * 32, (o.y + 1) * 32 + ${dy}); return true;`);
  await page.waitForTimeout(250);
}
async function clickObj(page: Page, defId: string): Promise<void> {
  const pos = await game<{ x: number; y: number } | null>(page, `return g.objectScreenPos('${defId}');`);
  expect(pos, `${defId} 화면 위치`).not.toBeNull();
  await page.mouse.click(pos!.x, pos!.y);
  await expect(page.getByTestId('pie-menu').locator('.pie-item').first()).toBeVisible();
}
/** 원형 메뉴에서 항목 고르기 (분류 단계가 있으면 분류부터, 더 보기 쪽 넘김) */
async function pick(page: Page, interactionId: string, group?: string): Promise<void> {
  if (group && (await page.locator(`.pie-item[data-interaction="__grp:${group}"]`).count())) await page.locator(`.pie-item[data-interaction="__grp:${group}"]`).click();
  for (let i = 0; i < 4; i++) {
    const item = page.locator(`.pie-item[data-interaction="${interactionId}"]`);
    if (await item.count()) {
      await expect(item).toBeEnabled();
      await item.click();
      return;
    }
    await page.locator('.pie-item[data-interaction="__more"]').click();
  }
  throw new Error(`메뉴에 없음: ${interactionId}`);
}
const field = (page: Page) => game<Obj>(page, "return g.getState().objects.find((o) => o.defId === 'field_plot');");
const done = (page: Page, id: string) => game<number>(page, `return (await g.getStats()).stats.completed['${id}'] ?? 0;`);

// M4 통과 조건 E2E: 밭 갈기 → 파종 → 김매기 → 수확 → 방앗간 → 빵 (실제 클릭)
test('M4 농사: 밭 갈기 → 밀 파종 → 김매기 → 수확 → 방앗간 → 빵', async ({ page }, info) => {
  test.skip(info.project.name !== 'fhd-1920', '한 해상도로 충분 (긴 시뮬레이션)');
  test.setTimeout(300_000);
  const errors = await openGame(page);
  await game(page, "g.setZoom(3); g.select(2); await g.intent({kind:'setStock', item:'wheat', n: 40}); return true;");
  // 1) 갈기
  await focusObj(page, 'field_plot');
  await page.screenshot({ path: 'artifacts/qa/m4/farm-0-untilled.png' });
  await clickObj(page, 'field_plot');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/qa/m4/farm-pie.png' });
  await pick(page, 'farm.till');
  await game(page, 'g.setSpeed(3); return true;');
  await expect.poll(async () => Number((await field(page)).state.tilled), { timeout: 90_000 }).toBe(1);
  await game(page, 'g.setSpeed(0); return true;');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/qa/m4/farm-1-tilled.png' });
  // 2) 가을까지 (밀은 가을 파종)
  await game(page, 'await g.fastForwardDays(14 - g.getState().day); return true;');
  await focusObj(page, 'field_plot');
  await clickObj(page, 'field_plot');
  await pick(page, 'farm.sow.wheat', 'sow');
  await game(page, 'g.setSpeed(3); return true;');
  await expect.poll(async () => Number((await field(page)).state.crop), { timeout: 90_000 }).toBeGreaterThan(0);
  // 3) 자라는 단계마다 한 장씩 (잡초가 나면 김매기)
  const shot = new Set<number>();
  for (let d = 0; d < 30; d++) {
    await game(page, 'g.setSpeed(0); await g.fastForward(1440); return true;');
    const f = await field(page);
    const st = Number(f.state.stage);
    if (!Number(f.state.crop)) break;
    if (!shot.has(st)) {
      shot.add(st);
      await focusObj(page, 'field_plot');
      await page.screenshot({ path: `artifacts/qa/m4/farm-stage-${st}.png` });
    }
    if (Number(f.state.weeds)) {
      await clickObj(page, 'field_plot');
      await pick(page, 'farm.weed');
      await game(page, 'g.setSpeed(3); return true;');
      await expect.poll(async () => Number((await field(page)).state.weeds), { timeout: 60_000 }).toBe(0);
    }
    if (st === 4) break;
  }
  // 4) 수확 (자율이 먼저 거뒀을 수도 있음)
  if ((await done(page, 'farm.harvest')) === 0) {
    await focusObj(page, 'field_plot');
    await clickObj(page, 'field_plot');
    await pick(page, 'farm.harvest');
    await game(page, 'g.setSpeed(3); return true;');
    await expect.poll(() => done(page, 'farm.harvest'), { timeout: 120_000 }).toBeGreaterThan(0);
  }
  await game(page, 'g.setSpeed(0); return true;');
  // 5) 방앗간: 길 끝을 눌러 외출 메뉴 → 밀 빻기
  const exit = await game<{ x: number; y: number }>(page, 'const e = g.getState().objects.find((o) => o.defId === "lot_exit"); g.centerOn((e.x + 0.5) * 32, (e.y - 2) * 32); return true;');
  void exit;
  await page.waitForTimeout(250);
  const ep = await game<{ x: number; y: number }>(page, 'return g.exitScreenPos();');
  await page.mouse.click(ep.x, ep.y);
  await expect(page.getByTestId('pie-menu').locator('.pie-item').first()).toBeVisible();
  await page.screenshot({ path: 'artifacts/qa/m4/exit-pie.png' });
  await pick(page, 'recipe.mill_wheat', 'baking');
  await game(page, 'g.setSpeed(3); return true;');
  await expect.poll(() => done(page, 'recipe.mill_wheat'), { timeout: 120_000 }).toBeGreaterThan(0);
  // 6) 화덕에서 빵
  await game(page, "g.setSpeed(0); await g.intent({kind:'setStock', item:'yeast', n: 2}); await g.intent({kind:'setStock', item:'water', n: 4}); await g.intent({kind:'setStock', item:'firewood', n: 6}); return true;");
  await focusObj(page, 'oven');
  await clickObj(page, 'oven');
  await pick(page, 'recipe.bake_bread');
  await game(page, 'g.setSpeed(2); return true;');
  await expect.poll(() => game<boolean>(page, "const s = g.getState(); return s.persons[1].action?.interactionId === 'recipe.bake_bread' && s.persons[1].action.phase === 'perform';"), { timeout: 60_000 }).toBe(true);
  await game(page, 'g.setSpeed(0); return true;');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'artifacts/qa/m4/oven-baking.png' });
  await game(page, 'g.setSpeed(3); return true;');
  await expect.poll(() => done(page, 'recipe.bake_bread'), { timeout: 120_000 }).toBeGreaterThan(0);
  await expectNoGameErrors(page, errors);
});

// M4 통과 조건 E2E: 대장장이 주문 처리 하루
test('M4 대장장이: 일 구하기 → 주문 → 대장간에서 만들어 넘기기', async ({ page }, info) => {
  test.skip(info.project.name !== 'fhd-1920', '한 해상도로 충분');
  test.setTimeout(240_000);
  const errors = await openGame(page);
  await game(page, 'g.setZoom(3); g.select(1); return true;');
  await openBookPage(page, 'work', 'career');
  await page.locator('.rel-btn[data-career="blacksmith"]').click();
  await expect(page.locator('.work-job .work-title')).toBeVisible();
  // 다음 날 아침 6시 (출근일) 로
  await game(page, 'await g.fastForward(1440 - g.getState().minuteOfDay + 6 * 60); g.setSpeed(2); return true;');
  await expect.poll(() => game<number>(page, 'return g.getState().persons[0].career.orders.length;'), { timeout: 60_000 }).toBeGreaterThan(2);
  await page.waitForTimeout(300);
  await page.locator('.nb').screenshot({ path: 'artifacts/qa/m4/smith-orders.png' });
  // 대장간에서 일하는 모습 (불 애니메이션)
  await expect.poll(() => game<boolean>(page, "const a = g.getState().persons[0].action; return !!a && a.interactionId.startsWith('recipe.forge_') && a.phase === 'perform';"), { timeout: 90_000 }).toBe(true);
  await game(page, 'g.setSpeed(0); return true;');
  await focusObj(page, 'forge', -16);
  for (let k = 0; k < 2; k++) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `artifacts/qa/m4/smith-forge-${k}.png` });
  }
  await game(page, 'g.setSpeed(3); return true;');
  await expect.poll(() => game<number>(page, 'return g.getState().persons[0].career.orders.filter((o) => o.done).length;'), { timeout: 120_000 }).toBeGreaterThan(0);
  await game(page, 'g.setSpeed(0); return true;');
  await page.waitForTimeout(300);
  await page.locator('.nb').screenshot({ path: 'artifacts/qa/m4/smith-orders-done.png' });
  await expectNoGameErrors(page, errors);
});
