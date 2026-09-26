// 여러 집 실내(스타듀식 화면) 캡처: node tools/qa/shot-rooms.mjs <out-dir> <외관 번호,...> [층 0|1]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [dir, list, level = '0'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:5188/?town=ashford');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120000 });
await page.evaluate(async () => { const g = window.__game; await g.setTime(600); await g.pause(true); g.hideUI(true); });
for (const k of list.split(',').map(Number)) {
  await page.evaluate(([k, lv]) => { const hk = window.__hk; hk.switchView(k); setTimeout(() => hk.setViewLevel(lv), 300); }, [k, Number(level)]);
  await page.waitForTimeout(1600);
  const info = await page.evaluate((k) => { const hk = window.__hk; const s = hk.world.lot.shells[k]; return s ? `${s.id}@${s.x},${s.y}` : '?'; }, k);
  await page.screenshot({ path: `${dir}/room-${k}-L${level}.png` });
  console.log(k, info);
}
console.log(errs);
await browser.close();
