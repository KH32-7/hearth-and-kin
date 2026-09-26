// 소원 길잡이: 소원 창에서 소원 줄을 누르면 이룰 물건이 비치고 카메라가 옮겨 가는지
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:5188/?town=ashford&new=0');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.evaluate(() => { window.__game.setSpeed?.(0); window.__game.setZoom?.(2); window.__hk.hud.setPopup('wish'); });
await page.waitForTimeout(800);
const rows = await page.$$eval('.hud-pop .wishes .wish', (es) => es.map((e) => e.dataset.wish));
const out = [];
for (let i = 0; i < rows.length; i++) {
  const cam0 = await page.evaluate(() => [window.__hk.renderer.camX, window.__hk.renderer.camY]);
  await page.click(`.hud-pop .wishes .wish[data-wish="${rows[i]}"] .wish-text`);
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => ({ lit: window.__hk.world.many.length, cam: [window.__hk.renderer.camX, window.__hk.renderer.camY] }));
  out.push({ wish: rows[i], lit: r.lit, moved: Math.hypot(r.cam[0] - cam0[0], r.cam[1] - cam0[1]) | 0 });
  if (i === 0) await page.screenshot({ path: 'artifacts/qa/play/wish_hint.png' });
}
console.log(JSON.stringify({ out, errs }));
await browser.close();
