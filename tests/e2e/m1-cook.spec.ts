import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { expectNoGameErrors, game, openGame } from './helpers';

mkdirSync('artifacts/qa/m1', { recursive: true });

// BRIEF M1 E2E: 실제 마우스 클릭으로 "화로 불 피우기 → 스튜 끓이기 → 식탁에서 먹기"
test('실제 클릭: 화로 불 피우기 → 스튜 끓이기 → 식탁에서 먹기', async ({ page }, info) => {
  test.skip(info.project.name === 'laptop-125', '입력 경로는 두 해상도로 충분');
  const errors = await openGame(page);
  await game(page, `
    await g.setAutonomy(false);
    g.select(1);
    await g.setNeed(1, 'hunger', 20);
    for (const n of ['energy','bladder','hygiene','comfort','fun','social','warmth']) await g.setNeed(1, n, 95);
    g.setZoom(2);
    return true;`);

  const focus = async (defId: string) => {
    await game(page, `const o = g.getState().objects.find(o => o.defId === '${defId}'); g.centerOn((o.x+1.5)*32, (o.y+1)*32); return true;`);
    await page.waitForTimeout(250);
  };
  const clickObject = async (defId: string) => {
    const pos = await game<{ x: number; y: number } | null>(page, `return g.objectScreenPos('${defId}');`);
    expect(pos, `${defId} 화면 위치`).not.toBeNull();
    await page.mouse.click(pos!.x, pos!.y);
    await expect(page.getByTestId('pie-menu').locator('.pie-item').first()).toBeVisible();
  };
  const pick = async (interactionId: string) => {
    const item = page.locator(`.pie-item[data-interaction="${interactionId}"]`);
    await expect(item).toBeEnabled();
    await item.click();
  };
  const idle = () => expect.poll(() => game<unknown>(page, 'return g.getState().persons[0].action;'), { timeout: 60_000 }).toBeNull();

  // 1) 불 피우기. 스튜는 아직 불이 없어 회색 + 이유가 보여야 함
  await focus('hearth');
  await clickObject('hearth');
  await expect(page.locator('.pie-item[data-interaction="hearth.cook_stew"]')).toBeDisabled();
  await expect(page.locator('.pie-item[data-interaction="hearth.cook_stew"] .pie-reason')).toHaveText(/불/);
  await pick('hearth.light_fire');
  await expect(page.getByTestId('queue').locator('[data-interaction="hearth.light_fire"]')).toBeVisible();
  await game(page, 'g.setSpeed(3); return true;');
  await expect.poll(() => game<boolean>(page, `return g.getState().objects.find(o => o.defId === 'hearth').state.lit;`), { timeout: 60_000 }).toBe(true);
  await idle();

  // 2) 스튜 끓이기
  await game(page, 'g.setSpeed(1); return true;');
  await focus('hearth');
  await clickObject('hearth');
  await pick('hearth.cook_stew');
  await game(page, 'g.setSpeed(3); return true;');
  await expect.poll(() => game<number>(page, `return g.getState().objects.find(o => o.defId === 'hearth').state.servings;`), { timeout: 90_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: `artifacts/qa/m1/cook-${info.project.name}.png` });
  await idle();

  // 3) 식탁에서 먹기
  await game(page, 'g.setSpeed(1); return true;');
  await focus('dining_table');
  const hungerBefore = await game<number>(page, 'return g.getState().persons[0].needs.hunger;');
  await clickObject('dining_table');
  await pick('table.eat_stew');
  await game(page, 'g.setSpeed(3); return true;');
  await expect.poll(() => game<string>(page, 'return g.getState().persons[0].anim;'), { timeout: 60_000 }).toBe('eat');
  await game(page, 'g.setSpeed(1); return true;');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `artifacts/qa/m1/eat-${info.project.name}.png` });
  await game(page, 'g.setSpeed(3); return true;');
  await expect.poll(() => game<number>(page, 'return g.getState().persons[0].needs.hunger;'), { timeout: 60_000 }).toBeGreaterThan(hungerBefore + 30);
  await expectNoGameErrors(page, errors);
});
