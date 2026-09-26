import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { expectNoGameErrors, game, openGame } from './helpers';

/**
 * BRIEF M5 통과 조건: 빈 부지에 2층 집 짓기 → 가구 배치 → 인물 입주 후 하루 봇 stuck 0. 길 막는 배치 경고.
 * 실제 UI 로: 모드/도구/재질 버튼을 누르고, 캔버스를 마우스로 끌고 누름. 스크린샷으로 방 3개 이상 2층 집 검수 (03 프롬프트 S4)
 */
mkdirSync('artifacts/qa/m5', { recursive: true });
const H = 16;
const R = (lv: number, y: number) => (lv < 0 ? 3 : lv) * (H + 1) + y;

async function cell(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return game(page, `return g.cellScreenPos(${x}, ${y});`);
}

async function drag(page: Page, a: [number, number], b: [number, number]): Promise<void> {
  const p = await cell(page, ...a);
  const q = await cell(page, ...b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
  await page.mouse.move(q.x, q.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function click(page: Page, x: number, y: number): Promise<void> {
  const p = await cell(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.waitForTimeout(80);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(150);
}

async function tool(page: Page, t: string, part?: string): Promise<void> {
  await page.locator(`.tool-btn[data-tool="${t}"]`).click();
  if (part) await page.locator(`.part[data-part="${part}"]`).click();
}

async function buy(page: Page, cat: string, id: string, x: number, y: number): Promise<void> {
  await page.locator(`.buy-tab[data-cat="${cat}"]`).click();
  await page.locator(`.buy-item[data-object="${id}"]`).first().click();
  await click(page, x, y);
  await page.keyboard.press('Escape');
}

async function level(page: Page, lv: number): Promise<void> {
  // 위층은 화면 위로 그려져 위 가운데 도구 띠에 가리지 않게 카메라도 그만큼 올림
  await game(page, `g.setViewLevel(${lv}); g.centerOn(12 * 32, 10 * 32 - ${Math.max(0, lv)} * 96); return true;`);
  await page.waitForTimeout(100);
}

test('M5 건축: 빈 부지 → 2층 집(방 4) → 가구 → 입주 하루 stuck 0, 길 막힘 경고', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors = await openGame(page, '/?lot=empty');
  await game(page, `await g.intent({ kind: 'grant', amount: 9000, reason: 'test' }); g.setZoom(1); g.centerOn(12 * 32, 10 * 32); return true;`);
  const shot = (name: string) => page.screenshot({ path: `artifacts/qa/m5/${name}-${info.project.name}.png` });

  // ---- 1층: 방 도구로 바깥 벽 + 가운데 벽, 문 2, 창 2
  await page.locator('.mode-btn[data-mode="build"]').click();
  await page.locator('.sub-tab[data-sub="make"]').click();
  await tool(page, 'floor', 'floor_wood');
  await tool(page, 'room', 'wall_timber');
  await drag(page, [4, R(0, 3)], [14, R(0, 9)]);
  await tool(page, 'wall', 'wall_timber');
  await drag(page, [9, R(0, 3)], [9, R(0, 9)]);
  await tool(page, 'door', 'door_plank');
  await click(page, 6, R(0, 9));
  await tool(page, 'door', 'door_ledged');
  await click(page, 9, R(0, 6));
  await tool(page, 'window', 'win_lattice');
  await click(page, 11, R(0, 9));
  await click(page, 11, R(0, 3));
  let st = await game<{ rooms: { level: number }[]; walls: number }>(page, 'return g.buildState();');
  expect(st.rooms.filter((r) => r.level === 0).length).toBe(2);
  await shot('01-ground');

  // ---- 2층: 바닥 → 방 → 가운데 벽 + 문 + 창
  await level(page, 1);
  await tool(page, 'floor', 'floor_wood_dark');
  await drag(page, [4, R(1, 3)], [14, R(1, 9)]);
  await tool(page, 'room', 'wall_timber_rose');
  await drag(page, [4, R(1, 3)], [14, R(1, 9)]);
  await tool(page, 'wall', 'wall_timber_rose');
  await drag(page, [9, R(1, 3)], [9, R(1, 9)]);
  await tool(page, 'door', 'door_plank');
  await click(page, 9, R(1, 6));
  await tool(page, 'window', 'win_shutter');
  await click(page, 6, R(1, 9));
  await click(page, 11, R(1, 9));
  // ---- 계단 (1층 오른쪽 방, 맨 위 칸 (13,5) ↔ 2층 (13,4))
  await level(page, 0);
  await tool(page, 'stairs', 'stairs_wood');
  await click(page, 13, R(0, 6));
  await page.keyboard.press('Escape');
  // ---- 지붕 재질
  await tool(page, 'roof', 'roof_shingle');
  st = await game(page, 'return g.buildState();');
  expect(st.rooms.filter((r) => r.level === 1).length).toBe(2);
  expect(st.rooms.length).toBeGreaterThanOrEqual(4);

  // ---- 가구 (구매 모드)
  await page.locator('.mode-btn[data-mode="build"]').click();
  await page.locator('.sub-tab[data-sub="obj"]').click();
  // 1층 왼쪽 방(부엌): 화로, 식탁 + 걸상, 의자. 문 앞(6,8)에서 오른쪽(7~8)으로 통로
  await buy(page, 'kitchen', 'hearth', 6, R(0, 4));
  await buy(page, 'dining', 'dining_table', 6, R(0, 7));
  await buy(page, 'dining', 'stool', 5, R(0, 8));
  await buy(page, 'dining', 'chair', 8, R(0, 5));
  // 1층 오른쪽 방: 찬장, 물통, 조리대 (계단 13,5..7). 슬롯은 모두 남쪽 칸
  await buy(page, 'kitchen', 'cupboard', 10, R(0, 4));
  await buy(page, 'kitchen', 'barrel_water', 12, R(0, 4));
  await buy(page, 'kitchen', 'prep_counter', 10, R(0, 7));
  await level(page, 1);
  await buy(page, 'bedroom', 'bed_double', 5, R(1, 4));
  await buy(page, 'hygiene', 'washbasin', 8, R(1, 4));
  // 2층 오른쪽 방: 계단참 (13,4) 과 문 동쪽 (10,6) 은 비움
  await buy(page, 'bedroom', 'bed_straw', 11, R(1, 7));
  await buy(page, 'hygiene', 'chamber_pot', 11, R(1, 4));
  await buy(page, 'light', 'candlestick', 10, R(1, 5));
  await level(page, 0);
  const objs = await game<{ defId: string }[]>(page, 'return g.getState().objects;');
  for (const id of ['hearth', 'dining_table', 'bed_double', 'bed_straw', 'stairs_wood', 'chamber_pot']) expect(objs.some((o) => o.defId === id), id).toBe(true);
  st = await game(page, 'return g.buildState();');
  expect((st as unknown as { warnings: unknown[] }).warnings).toEqual([]);

  // ---- 길 막는 배치 경고: 문 밖을 울타리로 두르면 경고, 되돌리면 사라짐
  await page.locator('.mode-btn[data-mode="build"]').click();
  await page.locator('.sub-tab[data-sub="make"]').click();
  await tool(page, 'fence', 'fence_wood');
  await drag(page, [5, R(0, 10)], [7, R(0, 10)]);
  await drag(page, [5, R(0, 11)], [7, R(0, 11)]);
  await expect(page.locator('[data-testid="build-warnings"]')).toContainText(/\d/);
  const warned = await game<{ warnings: { kind: string }[] }>(page, 'return g.buildState();');
  expect(warned.warnings.some((w) => w.kind === 'door' || w.kind === 'object')).toBe(true);
  await shot('02-warning');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  expect((await game<{ warnings: unknown[] }>(page, 'return g.buildState();')).warnings).toEqual([]);

  // ---- 스크린샷: 1층 잘라내기, 2층 (아래층 흐리게), 바깥 (지붕)
  await page.locator('.mode-btn[data-mode="live"]').click();
  await game(page, `g.setZoom(2); g.centerOn(9 * 32, 6 * 32); g.setCutaway('cut'); return true;`);
  await level(page, 0);
  await page.waitForTimeout(400);
  await shot('03-ground-cut');
  await level(page, 1);
  await page.waitForTimeout(400);
  await shot('04-upper');
  await game(page, `g.setRoofMode('on'); g.setZoom(1); g.centerOn(10 * 32, 4 * 32); return true;`);
  await page.waitForTimeout(900);
  await shot('05-exterior-roof');
  expect(await game<number>(page, 'return g.buildState().roofAlpha;')).toBeGreaterThan(0.9);
  await game(page, `g.setRoofMode('auto'); return true;`);

  // ---- 입주 후 하루: stuck 0 (자율만)
  await level(page, 0);
  await game(page, 'await g.fastForward(1440); return true;');
  const stats = await game<{ stuckEvents: number; completed: Record<string, number> }>(page, 'return (await g.getStats()).stats;');
  expect(stats.stuckEvents).toBe(0);
  // 2층 침대에서 잠 (계단을 오르내림)
  expect(stats.completed['bed.sleep'] ?? 0).toBeGreaterThan(0);
  await expectNoGameErrors(page, errors);
});
