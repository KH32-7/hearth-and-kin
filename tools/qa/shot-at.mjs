// 원하는 칸 위치/줌/시각으로 한 장: node tools/qa/shot-at.mjs <url> <x칸> <y칸> <zoom> <분> <out.png> [hideUI=1]
import { chromium } from 'playwright';
const [url, x, y, z, minute, out, hide = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.evaluate(async ([x, y, z, m, hide]) => {
  const g = window.__game;
  await g.setTime(Number(m));
  await g.pause(true);
  g.hideUI(hide === '1');
  g.setZoom(Number(z));
  g.centerOn(Number(x) * 32, Number(y) * 32);
}, [x, y, z, minute, hide]);
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
console.log(out, errs.slice(0, 5));
await browser.close();
