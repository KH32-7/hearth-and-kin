// 실내 화면(E) 캡처: node tools/qa/shot-interior.mjs <out.png> [분]
import { chromium } from 'playwright';
const [out, minute = '420'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:5188/?town=ashford');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120000 });
await page.evaluate(async (m) => { const g = window.__game; await g.setTime(Number(m)); await g.pause(true); g.hideUI(true); const p = g.getState().persons.find((q) => q.household === 1); g.select(p.id); }, minute);
await page.waitForTimeout(800);
await page.keyboard.press('e');
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
console.log(out, await page.evaluate(() => window.__hk.interior), errs);
await browser.close();
