// 직접 조작 검사: WASD 로 걷기, E 로 원형 메뉴, 물건 외곽선. node tools/qa/direct-control.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://127.0.0.1:5188/?town=ashford');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
const me = () => page.evaluate(() => { const g = window.__game; const s = g.getState(); const p = s.persons.find((q) => q.household === 1); return { id: p.id, x: p.x, y: p.y, drawn: p.drawn, action: p.action?.interactionId ?? null }; });
await page.evaluate(async () => { const g = window.__game; await g.setTime(9 * 60); g.setZoom(3); });
let p0 = await me();
await page.evaluate((id) => { const g = window.__game; g.select(id); g.setSpeed(2); }, p0.id);
await page.waitForTimeout(800);
p0 = await me();
await page.evaluate(({ x, y }) => window.__game.centerOn(x, y), p0.drawn);
// D 를 1.5초 누름 → 오른쪽으로
await page.keyboard.down('d');
await page.waitForTimeout(1500);
await page.keyboard.up('d');
await page.waitForTimeout(700);
const p1 = await me();
// S
await page.keyboard.down('s');
await page.waitForTimeout(1200);
await page.keyboard.up('s');
await page.waitForTimeout(700);
const p2 = await me();
console.log('시작', p0.x.toFixed(1), p0.y.toFixed(1), '→ D', p1.x.toFixed(1), p1.y.toFixed(1), '→ S', p2.x.toFixed(1), p2.y.toFixed(1), p2.action);
await page.evaluate(() => window.__game.setSpeed(0));
await page.evaluate(({ x, y }) => window.__game.centerOn(x, y), p2.drawn);
await page.waitForTimeout(600);
await page.screenshot({ path: 'artifacts/qa/direct/after-walk.png' });
// E: 가까운 물건 메뉴
await page.keyboard.press('e');
await page.waitForTimeout(600);
const pie = await page.evaluate(() => { const el = document.querySelector('.pie, .pie-menu, [class*="pie"]'); return el ? { cls: el.className, visible: getComputedStyle(el).display !== 'none', text: el.textContent?.slice(0, 80) } : null; });
console.log('E 메뉴', JSON.stringify(pie));
await page.screenshot({ path: 'artifacts/qa/direct/e-menu.png' });
await page.keyboard.press('Escape');
// 외곽선: 조작 인물 근처 상호작용 물건 위에 마우스
const target = await page.evaluate(() => {
  const hk = window.__hk; const s = hk.client.snap; const p = s.persons.find((q) => q.id === hk.selectedId);
  const cands = s.objects.filter((o) => Math.abs(o.x - p.x) < 8 && Math.abs(o.y - p.y) < 6 && hk.isInteractable(o.defId));
  for (const o of cands) {
    const r = hk.world.objectRect(o.uid); if (!r) continue;
    const T = hk.world.tile;
    for (let dy = 0; dy < r.h * T; dy += 3) for (let dx = 0; dx < r.w * T; dx += 3) {
      const wx = r.x * T + dx, wy = r.y * T + dy;
      if (hk.world.pick(wx, wy) === o.uid && hk.chars.pick(wx, wy) === null) { const sp = hk.renderer.worldToScreen(wx, wy); const cr = hk.renderer.canvas.getBoundingClientRect(); return { uid: o.uid, defId: o.defId, x: sp.x + cr.left, y: sp.y + cr.top, rect: r }; }
    }
  }
  return null;
});
console.log('외곽선 대상', JSON.stringify(target));
if (target) {
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(400);
  const hl = await page.evaluate(() => window.__hk.world.hl?.uid ?? null);
  console.log('외곽선 켜짐', hl === target.uid);
  await page.screenshot({ path: 'artifacts/qa/direct/hover.png', clip: { x: Math.max(0, target.x - 160), y: Math.max(0, target.y - 120), width: 320, height: 240 } });
}
console.log('오류', errs.slice(0, 5));
await browser.close();
