// 원형 메뉴 펼침 캡처: 사람 메뉴 2개 + 물건 메뉴 2개, 가운데–항목 안쪽 거리 측정
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:5188/?town=ashford&new=0');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.evaluate(() => { const g = window.__game; g.setSpeed?.(0); g.setZoom?.(2); });
await page.waitForTimeout(1500);
const spots = await page.evaluate(() => {
  const hk = window.__hk, r = hk.renderer, out = [];
  for (const [id, n] of hk.chars.nodes) { if (!n.mesh.visible) continue; const c = r.worldToScreen(n.fx, n.fy - 24); if (c.x > 200 && c.y > 200 && c.x < 1400 && c.y < 700 && id !== hk.selectedId) out.push(['p', c.x, c.y]); if (out.length >= 2) break; }
  for (const [uid, n] of hk.world.objs) { if (!/table|hearth|bed|chest/.test(n.defId) || !n.node.mesh.visible) continue; const ref = n.node.ref; const c = r.worldToScreen(n.node.left - ref.anchorX + ref.w / 2, n.node.bottom - ref.anchorY + ref.h * 0.6); if (c.x > 200 && c.y > 200 && c.x < 1400 && c.y < 700) out.push(['o', c.x, c.y]); if (out.length >= 4) break; }
  return out;
});
let k = 0;
for (const [kind, x, y] of spots) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(700);
  const d = await page.evaluate(() => {
    const c = document.querySelector('.pie-center');
    if (!c) return null;
    const cb = c.getBoundingClientRect();
    const cx = cb.x + cb.width / 2, cy = cb.y + cb.height / 2;
    return [...document.querySelectorAll('.pie-item')].map((e) => { const b = e.getBoundingClientRect(); const nx = Math.max(b.left - cx, cx - b.right, 0), ny = Math.max(b.top - cy, cy - b.bottom, 0); return Math.round(Math.hypot(nx, ny / 0.8)); });
  });
  console.log(kind, JSON.stringify(d));
  if (d) await page.screenshot({ path: `artifacts/qa/pie/pie_${k++}_${kind}.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
await browser.close();
