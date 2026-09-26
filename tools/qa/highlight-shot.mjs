// 하이라이트 외곽선·발광 확대 캡처: 마우스를 물건 그림 위에 올려 4배로 (artifacts/qa/highlight/)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('artifacts/qa/highlight', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:5188/?town=ashford&new=0');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.evaluate(() => { const g = window.__game; g.setSpeed?.(0); g.setZoom?.(3); });
await page.waitForTimeout(1500);
const t = await page.evaluate(() => {
  const hk = window.__hk, W = hk.world, r = hk.renderer;
  for (const want of ['barrel_water', 'chest_strongbox', 'hearth', 'bed_double']) for (const [uid, n] of W.objs) {
    if (n.defId !== want || !n.node?.mesh?.visible) continue;
    const ref = n.node.ref;
    const left = n.node.left - ref.anchorX, top = n.node.bottom - ref.anchorY;
    const c = r.worldToScreen(left + ref.w / 2, top + ref.h * 0.6);
    if (c.x > 80 && c.y > 80 && c.x < 1520 && c.y < 820) return { uid, defId: n.defId, x: c.x, y: c.y, w: ref.w * 3, h: ref.h * 3 };
  }
  return null;
});
console.log(JSON.stringify(t));
await page.mouse.move(t.x, t.y);
await page.waitForTimeout(400);
const clip = { x: t.x - t.w / 2 - 30, y: t.y - t.h * 0.6 - 30, width: t.w + 60, height: t.h + 60 };
const buf = await page.screenshot({ clip });
const p2 = await browser.newPage({ viewport: { width: Math.round(clip.width * 3), height: Math.round(clip.height * 3) } });
await p2.setContent(`<body style="margin:0"><img src="data:image/png;base64,${buf.toString('base64')}" style="image-rendering:pixelated;width:${clip.width * 3}px"></body>`);
await p2.screenshot({ path: `artifacts/qa/highlight/${t.defId}.png` });
console.log('hl', await page.evaluate(() => window.__hk.world.hl?.uid ?? null));
await browser.close();
