// 마우스 하이라이트 위치 검사: 상호작용 물건마다 그림 한가운데에 실제 마우스를 올려 하이라이트되는지, 어긋남(px) 측정
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const DSF = Number(process.argv[2] ?? 1);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: DSF });
await page.goto('http://127.0.0.1:5188/?town=ashford&new=0');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.evaluate(() => { const g = window.__game; g.setSpeed?.(0); g.setZoom?.(2); });
await page.waitForTimeout(1500);
const targets = await page.evaluate((process_flip) => {
  const hk = window.__hk;
  const W = hk.world;
  const r = hk.renderer;
  const out = [];
  for (const [uid, n] of W.objs) {
    if (!n.node?.mesh?.visible) continue;
    if (process_flip && !(n.node.mesh.scale.x < 0)) continue;
    const ref = n.node.ref;
    const left = n.node.left - ref.anchorX, top = n.node.bottom - ref.anchorY;
    const c = r.worldToScreen(left + ref.w / 2, top + ref.h / 2);
    const rect = r.canvas.getBoundingClientRect();
    const sx = c.x + rect.left, sy = c.y + rect.top;
    if (sx < 100 || sy < 120 || sx > 1500 || sy > 780) continue;
    out.push({ uid, defId: n.defId, sx, sy, w: ref.w, h: ref.h });
  }
  return out.slice(0, 25);
}, process.argv[3] === 'flip');
const res = [];
for (const t of targets) {
  await page.mouse.move(t.sx, t.sy);
  await page.waitForTimeout(60);
  const hl = await page.evaluate(() => window.__hk.world.hl?.uid ?? null);
  // 어긋남 찾기: 좌우로 몇 px 움직여야 잡히는지
  let shift = null;
  if (hl !== t.uid) {
    for (const dx of [4, -4, 8, -8, 12, -12, 16, -16, 24, -24, 32, -32]) {
      await page.mouse.move(t.sx + dx, t.sy);
      await page.waitForTimeout(40);
      const h2 = await page.evaluate(() => window.__hk.world.hl?.uid ?? null);
      if (h2 === t.uid) { shift = dx; break; }
    }
  }
  res.push(`${t.defId} ${hl === t.uid ? 'OK' : `놓침 (잡히는 이동 ${shift})`}`);
}
const dims = await page.evaluate(() => { const c = window.__hk.renderer.canvas; const b = c.getBoundingClientRect(); return { css: [b.width, b.height], buf: [c.width, c.height], dpr: window.devicePixelRatio, rp: window.__hk.renderer.renderer.getPixelRatio() }; });
console.log(JSON.stringify(dims));
console.log(res.join('\n'));
await browser.close();
