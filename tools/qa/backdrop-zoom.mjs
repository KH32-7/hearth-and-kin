// 흐림 켬/끔 확대 비교 캡처: 판 하나를 골라 좌우로 (artifacts/qa/blur/zoom_<cls>.png)
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5188/?town=ashford&new=0');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
// 흐림이 잘 보이게 복잡한 배경(집·길) 위로 카메라, 시간 멈춤
await page.evaluate(() => { const g = window.__game; g.setSpeed?.(0); g.setZoom?.(2); g.centerOn?.(96 * 32, 60 * 32); });
await page.waitForTimeout(2500);
for (const sel of ['.topbar.g', '.notice.g', '.quick.g']) {
  const r = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }, sel);
  if (!r) continue;
  const clip = { x: Math.max(0, r[0] - 10), y: Math.max(0, r[1] - 10), width: Math.min(r[2] + 20, 1600 - Math.max(0, r[0] - 10)), height: Math.min(r[3] + 20, 900 - Math.max(0, r[1] - 10)) };
  const on = await page.screenshot({ clip });
  await page.evaluate((s) => { const e = document.querySelector(s); e.style.backdropFilter = 'none'; }, sel);
  await page.waitForTimeout(150);
  const off = await page.screenshot({ clip });
  await page.evaluate((s) => { const e = document.querySelector(s); e.style.backdropFilter = ''; }, sel);
  // 좌우로 붙여 3배 확대
  const html = `<body style="margin:0;background:#000;display:flex;gap:12px"><img src="data:image/png;base64,${on.toString('base64')}" style="image-rendering:pixelated;width:${clip.width * 3}px"><img src="data:image/png;base64,${off.toString('base64')}" style="image-rendering:pixelated;width:${clip.width * 3}px"></body>`;
  const p2 = await browser.newPage({ viewport: { width: Math.round(clip.width * 6 + 12), height: Math.round(clip.height * 3) } });
  await p2.setContent(html);
  await p2.waitForTimeout(200);
  await p2.screenshot({ path: `artifacts/qa/blur/zoom_${sel.replace(/\W+/g, '_')}.png` });
  await p2.close();
}
await browser.close();
console.log('ok');
