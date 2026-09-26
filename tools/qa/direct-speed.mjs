// 직접 조작 배속 검사: 1·2·3배속에서 0.5초 동안 아래/위로 간 칸. node tools/qa/direct-speed.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:5188/?town=ashford');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.evaluate(async () => { const g = window.__game; await g.setTime(9 * 60); });
// 장터 광장(열린 판석)으로 걸어가서 잼
const id = await page.evaluate(() => window.__hk.selectedId);
await page.evaluate(async (pid) => { const hk = window.__hk; await hk.client.goto(pid, 60, 66); await window.__game.fastForward(240); }, id);
const me = () => page.evaluate(() => { const hk = window.__hk; const p = hk.client.snap.persons.find((q) => q.id === hk.selectedId); return [p.x, p.y]; });
for (const sp of [1, 2, 3]) {
  await page.evaluate((v) => window.__game.setSpeed(v), sp);
  await page.waitForTimeout(300);
  let best = 0;
  for (const key of ['s', 'w', 'a', 'd']) {
    const a = await me();
    await page.keyboard.down(key);
    await page.waitForTimeout(500);
    const b = await me();
    await page.keyboard.up(key);
    best = Math.max(best, Math.hypot(b[0] - a[0], b[1] - a[1]));
    await page.waitForTimeout(150);
  }
  console.log(`${sp}배속: 0.5초에 최대 ${best.toFixed(2)}칸 (벽이 없으면 기대 ${[2, 6, 20][sp - 1]}칸)`);
}
await browser.close();
