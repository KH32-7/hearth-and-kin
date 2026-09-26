// 우리 가족을 따라가 한 장: node tools/qa/shot-family.mjs <out.png> [분] [zoom]
import { chromium } from 'playwright';
const [out, minute = '480', z = '2'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:5188/?town=ashford');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120000 });
await page.evaluate(async ([m, z]) => { const g = window.__game; await g.setTime(Number(m)); g.setSpeed(1); g.hideUI(true); g.setZoom(Number(z)); }, [minute, z]);
await page.waitForTimeout(3000);
await page.evaluate(() => { const g = window.__game; g.setSpeed(0); const p = g.getState().persons.find((q) => q.household === 1); g.centerOn(p.drawn.x, p.drawn.y - 20); });
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
console.log(out);
await browser.close();
