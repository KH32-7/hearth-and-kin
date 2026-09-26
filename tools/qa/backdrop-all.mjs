// 반투명 창 전부 흐림 확인: 각 창을 열고 (1) backdrop-filter 값 (2) 흐림을 막는 조상 (3) 3배 확대 켬/끔 캡처
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:5188/?town=ashford&new=0');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.evaluate(() => window.__game.setSpeed?.(0));
await page.waitForTimeout(1500);
const scan = async (tag) => page.evaluate((tag) => {
  const out = [];
  for (const e of document.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    const bg = cs.backgroundColor;
    const m = bg.match(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/);
    const r = e.getBoundingClientRect();
    if (!m || +m[4] < 0.25 || +m[4] > 0.95 || r.width < 60 || r.height < 30 || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    if (r.width > 1500 && r.height > 850) continue; // 화면 전체 어둡게 (창 아님)
    const roots = [];
    for (let a = e.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      const why = [s.filter !== 'none' && 'filter', +s.opacity < 1 && 'opacity', s.maskImage && s.maskImage !== 'none' && 'mask', s.clipPath !== 'none' && 'clip-path', s.backdropFilter && s.backdropFilter !== 'none' && 'backdrop', s.mixBlendMode !== 'normal' && 'blend', /filter|opacity/.test(s.willChange) && 'will-change'].filter(Boolean);
      if (why.length) roots.push(`${String(a.className).slice(0, 24)}:${why.join('+')}`);
    }
    out.push(`${tag} | ${String(e.className).slice(0, 36)} | ${cs.backdropFilter} | ${bg} | ${Math.round(r.width)}x${Math.round(r.height)}${roots.length ? ' | 막는 조상: ' + roots.join(', ') : ''}`);
  }
  return out;
}, tag);
const lines = [];
lines.push(...await scan('기본'));
// 욕구 팝업
await (await page.$('.quick.g > *'))?.click();
await page.waitForTimeout(500);
lines.push(...await scan('팝업'));
await (await page.$('.quick.g > *'))?.click();
// 마을 지도
await page.keyboard.press('m');
await page.waitForTimeout(600);
lines.push(...await scan('지도'));
await page.keyboard.press('m');
await page.keyboard.press('Escape');
// 원형 메뉴: 가운데 사람/물건 클릭
await page.evaluate(() => { const s = window.__game.getState(); const p = s.persons.find((q) => q.household !== 1) ?? s.persons[0]; window.__game.centerOn?.(p.x * 32, p.y * 32 - 16); });
await page.waitForTimeout(600);
await page.mouse.click(800, 440);
await page.waitForTimeout(600);
lines.push(...await scan('원형메뉴'));
await page.keyboard.press('Escape');
// 대사창: 한마디
await page.evaluate(() => { const hk = window.__hk; hk.dialog?.oneliner?.({ minute: 0, ids: [], name: '시험', color: '#fff', head: null, text: '흐림 확인용 한마디입니다.' }); });
await page.waitForTimeout(500);
lines.push(...await scan('대사창'));
// 건축
await page.keyboard.press('b');
await page.waitForTimeout(800);
lines.push(...await scan('건축'));
console.log([...new Set(lines)].join('\n'));
await browser.close();
