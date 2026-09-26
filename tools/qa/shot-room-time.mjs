// 실내 (A/B) 시간대별: node tools/qa/shot-room-time.mjs <out.png> <외관 번호> <a|b> <분> [층]
import { chromium } from 'playwright';
const [out, k, mode, minute, level = '0'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:5188/?town=ashford&inside=${mode}`);
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120000 });
await page.evaluate(async ([k, m, lv]) => {
  const g = window.__game; await g.setTime(m); await g.pause(true); g.hideUI(true); g.setZoom(2);
  const hk = window.__hk; hk.switchView(k); if (lv) setTimeout(() => hk.setViewLevel(lv), 400);
}, [Number(k), Number(minute), Number(level)]);
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
console.log(out, errs);
await browser.close();
