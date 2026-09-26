// UI 개편 확인 캡처 (GDD 27장): node tools/qa/ui-shots.mjs <출력 폴더> [town]
// 하루 모드, 팝업 4종, 메뉴, 수첩 각 쪽, 건축/구매, 대사창을 차례로 찍음
import { chromium } from 'playwright';
import fs from 'node:fs';
const [out = 'artifacts/qa/ui', town = 'ashford'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:5188/${town ? `?town=${town}` : ''}`);
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 180000 });
await page.evaluate(async () => { const g = window.__game; await g.setTime(480); g.setSpeed(1); g.setZoom(2); });
await page.waitForTimeout(3000);
await page.evaluate(() => { const g = window.__game; g.setSpeed(0); const p = g.getState().persons.find((q) => q.household === 1); if (p) g.centerOn(p.drawn.x, p.drawn.y - 20); });
await page.waitForTimeout(1200);
const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: `${out}/${name}.png` }); console.log(name); };
await shot('live');
for (const k of ['needs', 'emo', 'rel', 'wish', 'menu']) {
  await page.evaluate((k) => window.__game.setPopup(k), k);
  await shot(`pop_${k}`);
}
await page.evaluate(() => window.__game.setPopup(null));
for (const pg of ['emo', 'skills', 'persona', 'wishes', 'family', 'relations', 'career', 'ledger', 'chronicle']) {
  await page.evaluate((pg) => window.__game.openBook(pg), pg);
  await shot(`book_${pg}`);
}
await page.evaluate(() => window.__game.closeBook());
for (const m of ['buy', 'build']) {
  await page.click(`.mode-btn[data-mode="${m}"]`);
  await shot(`mode_${m}`);
}
await page.click('.mode-btn[data-mode="live"]');
console.log('errors', JSON.stringify(errors.slice(0, 5)), JSON.stringify(await page.evaluate(() => window.__game.errors().slice(0, 5))));
console.log('missing i18n', JSON.stringify(await page.evaluate(() => window.__game.missingI18n().slice(0, 20))));
await browser.close();
