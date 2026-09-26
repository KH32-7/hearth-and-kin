// 반투명 판 뒤 흐림(backdrop-filter) 실제 적용 검사: 판마다 흐림 켬/끔 캡처를 비교 (차이 0 = 흐림이 안 먹음). node tools/qa/backdrop-check.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:5188/?town=ashford&new=0');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.waitForTimeout(2500);
const els = await page.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter;
    if (!bf || bf === 'none') continue;
    const r = e.getBoundingClientRect();
    if (r.width < 20 || r.height < 20 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    // 흐림을 막는 조상 (backdrop root: filter, opacity<1, mask, clip-path, backdrop-filter, mix-blend-mode, will-change)
    const roots = [];
    for (let a = e.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      const why = [s.filter !== 'none' && 'filter', +s.opacity < 1 && 'opacity', s.mask !== 'none' && s.maskImage !== 'none' && 'mask', s.clipPath !== 'none' && 'clip-path', (s.backdropFilter && s.backdropFilter !== 'none') && 'backdrop', s.mixBlendMode !== 'normal' && 'blend', /filter|opacity/.test(s.willChange) && 'will-change'].filter(Boolean);
      if (why.length) roots.push(`${a.className || a.tagName}:${why.join('+')}`);
    }
    e.dataset.bfId = String(out.length);
    out.push({ id: out.length, cls: String(e.className).slice(0, 40), bf, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], roots: roots.slice(0, 3) });
  }
  return out;
});
const res = [];
for (const e of els) {
  const [x, y, w, h] = e.rect;
  if (x < 0 || y < 0 || x + w > 1600 || y + h > 900) continue;
  const clip = { x, y, width: w, height: h };
  // 세계 움직임을 멈추고 비교
  await page.evaluate(() => window.__game.setSpeed?.(0));
  const a = await page.screenshot({ clip });
  await page.evaluate((id) => { const el = document.querySelector(`[data-bf-id="${id}"]`); el.style.backdropFilter = 'none'; el.style.webkitBackdropFilter = 'none'; }, e.id);
  await page.waitForTimeout(120);
  const b = await page.screenshot({ clip });
  await page.evaluate((id) => { const el = document.querySelector(`[data-bf-id="${id}"]`); el.style.backdropFilter = ''; el.style.webkitBackdropFilter = ''; }, e.id);
  // 선명도 = 이웃 픽셀 밝기 차이 평균 (흐림이 먹으면 켰을 때가 끈 때보다 뚜렷이 낮음)
  const sharp = async (buf) => page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let s = 0, n = 0;
    for (let y = 0; y < img.height; y++) for (let x = 1; x < img.width; x++) {
      const i = (y * img.width + x) * 4, j = i - 4;
      s += Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
      n++;
    }
    return s / n;
  }, buf.toString('base64'));
  const sa = await sharp(a);
  const sb = await sharp(b);
  res.push({ cls: e.cls, bf: e.bf, rect: e.rect, sharpOn: +sa.toFixed(2), sharpOff: +sb.toFixed(2), ratio: +(sa / sb).toFixed(2), blocked: e.roots });
}
for (const r of res) console.log(`${r.ratio < 0.92 ? '흐림 먹음' : '흐림 안 먹음?'} ${r.cls} ${r.bf} on=${r.sharpOn} off=${r.sharpOff} ratio=${r.ratio} ${r.blocked.join(' ')}`);
await page.screenshot({ path: 'artifacts/qa/blur/hud.png' });
await browser.close();
