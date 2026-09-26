// 빠른 확인용: 페이지를 열어 콘솔 오류와 스크린샷을 남김. node tools/qa/snap.mjs [out.png] [w] [h] [waitMs] [js]
import { chromium } from '@playwright/test';
const [out = 'artifacts/qa/snap.png', w = '1280', h = '720', wait = '6000', js = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://127.0.0.1:5188/');
await page.waitForTimeout(+wait);
if (js) console.log('js:', String(JSON.stringify(await page.evaluate(js))).slice(0, 3000));
const st = await page.evaluate(() => {
  const g = window.__game;
  if (!g) return { hasGame: false };
  return { ready: g.ready(), errors: g.errors(), failed: g.failedAssets(), missingI18n: g.missingI18n(), persons: g.getState().persons?.map((p) => [p.name, +p.x.toFixed(2), +p.y.toFixed(2), p.anim, p.action?.interactionId ?? null]) };
});
await page.screenshot({ path: out });
console.log(JSON.stringify(st, null, 1));
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
