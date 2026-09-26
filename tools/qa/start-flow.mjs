// 새 게임 흐름 캡처: 타이틀 → 설정 → 가문(형편) → 구성원(한 사람) → 집 고르기 → 게임 시작 직후
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://127.0.0.1:5188/?town=ashford&new=1');
await page.waitForFunction(() => window.__newGame?.page?.() === 'title', null, { timeout: 120_000 });
await page.waitForTimeout(2500);
const shot = async (n) => { await page.waitForTimeout(900); await page.screenshot({ path: `artifacts/qa/start/${n}.png` }); console.log(n, await page.evaluate(() => window.__newGame.page())); };
await shot('1_title');
await page.click('[data-act="new"]');
await shot('2_setup');
await page.click('[data-act="next"]');
await shot('3_family');
await page.click('[data-act="next"]');
await shot('4_create');
await page.click('.fc-start');
await shot('5_house');
const lot = await page.evaluate(() => document.querySelector('.ng-house-row.on')?.dataset.lot);
const second = await page.$$('.ng-house-row:not(.poor)');
if (second[3]) { await second[3].click(); await shot('5b_house_pick'); }
await page.click('[data-act="start"]');
await page.waitForTimeout(4000);
await shot('6_start');
const st = await page.evaluate(() => ({ log: window.__newGame.log().at(-1)?.results.find((r) => r.intent === 'applyPreset')?.result?.result?.house, persons: window.__hk.client.snap.persons.filter((p) => p.household === 1).map((p) => p.name), money: window.__hk.client.snap.econ?.money }));
console.log(JSON.stringify({ lot, st, errs }));
await browser.close();
