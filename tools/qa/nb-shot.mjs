// 수첩 캡처 (탭별 첫 쪽)
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://127.0.0.1:5188/?town=ashford&new=0');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.waitForTimeout(1500);
await page.keyboard.press('Tab');
await page.waitForTimeout(600);
for (const tab of ['person', 'house', 'work', 'record']) {
  const b = await page.$(`.nb-tab[data-tab="${tab}"]`);
  if (b) { await b.click(); await page.waitForTimeout(500); }
  await page.screenshot({ path: `artifacts/qa/play/nb_${tab}.png` });
}
console.log('errors', JSON.stringify(errs.slice(0, 5)));
await browser.close();
