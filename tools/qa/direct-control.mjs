// 직접 조작 검사: WASD 즉시 반응(0.15초 안에 움직임), 1초 이동 거리, 대기열 비어 있음, 벽에서 멈춤, E 메뉴, 물건 외곽선.
//   node tools/qa/direct-control.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://127.0.0.1:5188/?town=ashford');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
const me = () => page.evaluate(() => { const hk = window.__hk; const p = hk.client.snap.persons.find((q) => q.id === hk.selectedId); const n = hk.chars.nodes.get(p.id); return { id: p.id, x: p.x, y: p.y, fx: n?.fx, fy: n?.fy, queue: p.queue.length, action: p.action?.interactionId ?? null }; });
await page.evaluate(async () => { const g = window.__game; await g.setTime(9 * 60); g.setZoom(3); g.setSpeed(1); });
await page.waitForTimeout(1500);
const a = await me();
await page.evaluate(({ fx, fy }) => window.__game.centerOn(fx, fy), a);
const out = {};
for (const [key, name] of [['d', '오른쪽'], ['s', '아래'], ['a', '왼쪽'], ['w', '위']]) {
  const p0 = await me();
  await page.keyboard.down(key);
  await page.waitForTimeout(150);
  const p1 = await me();
  await page.waitForTimeout(850);
  const p2 = await me();
  await page.keyboard.up(key);
  await page.waitForTimeout(200);
  const p3 = await me();
  out[name] = { '0.15초 화면 이동(px)': +Math.hypot(p1.fx - p0.fx, p1.fy - p0.fy).toFixed(1), '1초 칸': +Math.hypot(p2.x - p0.x, p2.y - p0.y).toFixed(2), '뗀 뒤 추가 이동 칸': +Math.hypot(p3.x - p2.x, p3.y - p2.y).toFixed(2), 대기열: p2.queue, 행동: p2.action };
}
console.log(JSON.stringify(out, null, 1));
await page.screenshot({ path: 'artifacts/qa/direct/after-walk.png' });
await page.evaluate(() => window.__game.setSpeed(0));
await page.keyboard.press('e');
await page.waitForTimeout(500);
const pie = await page.evaluate(() => { const el = document.querySelector('.pie.open'); return el ? el.textContent?.slice(0, 60) : null; });
console.log('E 메뉴', pie);
await page.screenshot({ path: 'artifacts/qa/direct/e-menu.png' });
await page.keyboard.press('Escape');
console.log('오류', errs.slice(0, 5));
await browser.close();
