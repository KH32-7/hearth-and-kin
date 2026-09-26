// A 방식(지붕 들어 올리기) 연속 캡처: node tools/qa/shot-lift.mjs <out-dir> <외관 번호> [층]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [dir, k, level = '0'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:5188/?town=ashford&inside=a');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120000 });
await page.evaluate(async (k) => {
  const g = window.__game; await g.setTime(600); await g.pause(true); g.hideUI(true); g.setZoom(2);
  const r = window.__hk.world.shells.footRect(k); g.centerOn(((r[0] + r[2] + 1) / 2) * 32, ((r[1] + r[3] + 1) / 2) * 32 - 24);
}, Number(k));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${dir}/lift-${k}-0.png` });
await page.evaluate(([k, lv]) => { const hk = window.__hk; hk.switchView(k); if (lv) setTimeout(() => hk.setViewLevel(lv), 50); }, [Number(k), Number(level)]);
for (const [i, ms] of [[1, 200], [2, 200], [3, 250], [4, 900]]) {
  await page.waitForTimeout(ms);
  await page.screenshot({ path: `${dir}/lift-${k}-${i}.png` });
}
console.log(errs);
await browser.close();
