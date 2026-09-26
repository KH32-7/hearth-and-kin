// 연속 캡처: node tools/qa/series.mjs 접두사 w h "<준비 js>" 장수 간격ms "<매 장 전 js(선택)>"
import { chromium } from '@playwright/test';
const [prefix, w = '1280', h = '720', pre = '', n = '4', gap = '1500', each = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://127.0.0.1:5188/');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 30000 });
if (pre) console.log('pre', JSON.stringify(await page.evaluate(`(async () => { const g = window.__game; ${pre} })()`)));
for (let i = 0; i < +n; i++) {
  if (each) await page.evaluate(`(async () => { const g = window.__game; ${each} })()`);
  await page.waitForTimeout(+gap);
  await page.screenshot({ path: `${prefix}-${i}.png` });
  const th = await page.evaluate(() => window.__game.thoughtTexts());
  console.log(i, JSON.stringify(th));
}
console.log(JSON.stringify({ errors: [...errs, ...(await page.evaluate(() => window.__game.errors()))], missing: await page.evaluate(() => window.__game.missingI18n()) }));
await browser.close();
