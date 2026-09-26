// 이동 클릭 표시 캡처: 빈 땅을 두 번 눌러 표시가 하나만 뜨는지, 3배 확대
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:5188/?town=ashford&new=0');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.evaluate(() => { const g = window.__game; g.setZoom?.(2); });
await page.waitForTimeout(1500);
// 빈 칸: 사람·물건이 없는 곳을 찾아 누름
const pts = await page.evaluate(() => {
  const hk = window.__hk, out = [];
  for (let y = 300; y < 700 && out.length < 2; y += 40) for (let x = 500; x < 1100 && out.length < 2; x += 40) {
    const w = hk.renderer.screenToWorld(x, y);
    if (hk.chars.pick(w.x, w.y) === null && hk.world.pick(w.x, w.y) === null) out.push([x, y]);
  }
  return out;
});
await page.mouse.click(pts[0][0], pts[0][1]);
await page.waitForTimeout(80);
await page.mouse.click(pts[1][0], pts[1][1]);
await page.waitForTimeout(160);
const n = await page.evaluate(() => document.querySelectorAll('.click-fx.on').length);
const b = await page.evaluate(() => { const r = document.querySelector('.click-fx').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
const clip = { x: b[0] - 40, y: b[1] - 30, width: b[2] + 80, height: b[3] + 60 };
const buf = await page.screenshot({ clip });
const p2 = await browser.newPage({ viewport: { width: Math.round(clip.width * 3), height: Math.round(clip.height * 3) } });
await p2.setContent(`<body style="margin:0"><img src="data:image/png;base64,${buf.toString('base64')}" style="image-rendering:pixelated;width:${clip.width * 3}px"></body>`);
await p2.screenshot({ path: 'artifacts/qa/clickfx/click.png' });
console.log('표시 수', n, '위치', pts[1], '상자', b.map(Math.round));
await browser.close();
