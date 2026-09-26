// 팝업 창(욕구·감정·관계·소원·메뉴) 흐림 켬/끔 확대 비교
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:5188/?town=ashford&new=0');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.evaluate(() => { const g = window.__game; g.setSpeed?.(0); g.setZoom?.(2); g.centerOn?.(96 * 32, 60 * 32); });
await page.waitForTimeout(2000);
const btns = await page.$$('.quick.g button, .quick.g .qb, .quick.g > *');
console.log('quick 버튼', btns.length);
const out = [];
for (let i = 0; i < Math.min(4, btns.length); i++) {
  await btns[i].click();
  await page.waitForTimeout(400);
  const pops = await page.evaluate(() => [...document.querySelectorAll('.g')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 120 && r.height > 80 && cs.display !== 'none' && cs.visibility !== 'hidden' && !e.classList.contains('topbar') && !e.classList.contains('quick'); }).map((e) => { const r = e.getBoundingClientRect(); e.dataset.popk = '1'; return { cls: String(e.className), bf: getComputedStyle(e).backdropFilter, r: [r.x, r.y, r.width, r.height] }; }));
  for (const p of pops) {
    const clip = { x: Math.max(0, p.r[0]), y: Math.max(0, p.r[1]), width: Math.min(p.r[2], 1600 - p.r[0]), height: Math.min(p.r[3], 900 - p.r[1]) };
    const on = await page.screenshot({ clip, path: `artifacts/qa/blur/pop${i}_on.png` });
    out.push(`${i} ${p.cls} ${p.bf} ${p.r.map(Math.round).join(',')}`);
  }
  await btns[i].click();
  await page.waitForTimeout(300);
}
console.log(out.join('\n'));
await browser.close();
