// 새 게임으로 실제 플레이: 시작 → 화덕 누르기 → 요리 → 가까운 마을 사람에게 말 걸기 → 2배속 1분. 단계마다 캡처, 알림·오류 기록
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://127.0.0.1:5188/?town=ashford&new=1');
await page.waitForFunction(() => window.__newGame?.page?.() === 'title', null, { timeout: 120_000 });
await page.waitForTimeout(1500);
await page.click('[data-act="new"]'); await page.click('[data-act="next"]'); await page.click('[data-act="next"]');
await page.waitForTimeout(600); await page.click('[data-act="member-add"]'); await page.waitForTimeout(300);
await page.click('.fc-start'); await page.waitForTimeout(600);
await page.click('[data-act="start"]');
await page.waitForFunction(() => window.__newGame.page() === 'closed', null, { timeout: 60000 });
await page.waitForTimeout(2500);
const shot = (n) => page.screenshot({ path: `artifacts/qa/play/s_${n}.png` });
await shot('1_start');
const notices = () => page.evaluate(() => [...document.querySelectorAll('.notice-text')].map((e) => e.textContent));
const log = [];
// 화덕 누르기
const objPos = (kind) => page.evaluate((k) => { const hk = window.__hk; const me = hk.client.snap.persons.find((p) => p.id === hk.selectedId); const H = hk.lotRows(); let best = null, bd = 1e9; for (const o of hk.client.snap.objects) { if (!o.defId.startsWith(k)) continue; const d = Math.hypot(o.x - me.x, (o.y % H) - (me.y % H)); if (d < bd) { bd = d; best = o; } } if (!best) return null; const n = hk.world.objs.get(best.uid); const r = n.node.ref; return { uid: best.uid, ...hk.renderer.worldToScreen(n.node.left - r.anchorX + r.w / 2, n.node.bottom - r.anchorY + r.h * 0.6) }; }, kind);
const h = await objPos('hearth');
if (h) {
  await page.mouse.click(h.x, h.y); await page.waitForTimeout(600);
  log.push({ pie: await page.evaluate(() => [...document.querySelectorAll('[data-interaction]')].map((b) => b.dataset.interaction + (b.disabled || b.classList.contains('off') ? '(x)' : ''))) });
  await shot('2_pie_hearth');
  const cook = await page.$('[data-interaction="hearth.light_fire"]:not([disabled])') ?? await page.$('[data-interaction="hearth.cook_stew"]:not([disabled])');
  if (cook) { await cook.click(); await page.waitForTimeout(3000); log.push({ afterCook: await page.evaluate(() => { const hk = window.__hk; const me = hk.client.snap.persons.find((p) => p.id === hk.selectedId); return { act: me.action?.interactionId, phase: me.action?.phase, q: me.queue.map((q) => q.interactionId) }; }) }); }
  else await page.keyboard.press('Escape');
}
// 가까운 마을 사람에게 말 걸기
const npc = await page.evaluate(() => { const hk = window.__hk; const me = hk.client.snap.persons.find((p) => p.id === hk.selectedId); let best = null, bd = 1e9; for (const p of hk.client.snap.persons) { if (p.household === 1 || p.hidden || p.lod !== 'full') continue; const d = Math.hypot(p.x - me.x, p.y - me.y); if (d < bd) { bd = d; best = p; } } return best && { id: best.id, name: best.name, d: bd }; });
log.push({ npc });
if (npc) {
  await page.evaluate((id) => window.__hk.focus(id), npc.id); await page.waitForTimeout(700);
  const sp = await page.evaluate((id) => { const hk = window.__hk; const p = hk.chars.drawnPosition(id); return hk.renderer.worldToScreen(p.x, p.y - 20); }, npc.id);
  await page.mouse.click(sp.x, sp.y); await page.waitForTimeout(700);
  log.push({ socialPie: await page.evaluate(() => [...document.querySelectorAll('[data-interaction]')].map((b) => b.dataset.interaction + (b.disabled || b.classList.contains('off') ? '(x)' : '')).slice(0, 12)) });
  await shot('3_pie_npc');
  const talk = await page.$('[data-interaction^="social."]:not([disabled]):not(.off)');
  if (talk) { await talk.click(); await page.waitForTimeout(6000); }
  log.push({ afterTalk: await page.evaluate(() => { const hk = window.__hk; const me = hk.client.snap.persons.find((p) => p.id === hk.selectedId); return { act: me.action?.interactionId, phase: me.action?.phase, dialog: hk.dialog.open }; }) });
  await shot('4_talk');
}
await page.evaluate(() => window.__game.setSpeed(2));
await page.waitForTimeout(60000);
await shot('5_after60s');
log.push({ notices: await notices() });
console.log(JSON.stringify({ log, errs }, null, 1));
await browser.close();
