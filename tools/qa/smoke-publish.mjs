// 배포 전 점검: 새 게임 타이틀, 게임(바로 들어가기), 수첩 명성 쪽 문장, 콘솔 오류·번역 누락
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://127.0.0.1:5188/?new=1');
await page.waitForTimeout(8000);
await page.screenshot({ path: 'artifacts/qa/smoke/title.png' });
const title = await page.evaluate(() => !!document.querySelector('.ng'));
await page.goto('http://127.0.0.1:5188/?town=ashford&new=0');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: 'artifacts/qa/smoke/game.png' });
await page.keyboard.press('Tab');
await page.waitForTimeout(700);
const fame = await page.$('[data-page="fame"]');
if (fame) { await fame.click(); await page.waitForTimeout(700); }
const arms = await page.evaluate(() => !!document.querySelector('.her-cv, canvas.nb-arms, .nb canvas'));
await page.screenshot({ path: 'artifacts/qa/smoke/notebook_fame.png' });
const missing = await page.evaluate(() => [...(window.__i18nMissing?.() ?? [])].slice(0, 20));
console.log(JSON.stringify({ title, arms, errors: errs.slice(0, 10), missing }));
await browser.close();
