// 장면 캡처: node tools/qa/shot.mjs out.png w h "<준비 js (await 가능)>" [대기ms]
import { chromium } from '@playwright/test';
const [out, w = '1280', h = '720', pre = '', wait = '2500'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://127.0.0.1:5188/');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 30000 });
if (pre) console.log('pre:', JSON.stringify(await page.evaluate(`(async () => { const g = window.__game; ${pre} })()`)) ?? '');
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
const errs = await page.evaluate(() => window.__game.errors());
console.log(JSON.stringify({ errors: [...errs, ...logs] }));
await browser.close();
