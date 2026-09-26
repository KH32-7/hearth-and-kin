// 미리 만든 집 검수 캡처 (23-6): 등급마다 한 채씩 바깥(지붕) / 1층 잘라내기 / 2층
//   node tools/qa/house-shots.mjs [id,id,...]
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const houses = JSON.parse(readFileSync('src/data/houses.json', 'utf8')).houses;
const want = process.argv[2] ? process.argv[2].split(',') : [...new Set(houses.map((h) => h.tier))].map((t) => houses.find((h) => h.tier === t).id);
mkdirSync('artifacts/qa/m5/houses', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (const id of want) {
  const h = houses.find((x) => x.id === id);
  await page.goto(`http://127.0.0.1:5188/?lot=house:${id}`);
  await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 90_000 });
  const zoom = h.w > 30 ? 1 : 2;
  await page.evaluate(async ([w, hh, z]) => {
    const g = window.__game;
    await g.setTime(11 * 60);
    await g.pause(true);
    g.hideUI(true);
    g.setZoom(z);
    g.centerOn((w / 2) * 32, (hh / 2 - 2) * 32);
    g.setRoofMode('on');
  }, [h.w, h.h, zoom]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `artifacts/qa/m5/houses/${id}-roof.png` });
  await page.evaluate(() => { const g = window.__game; g.setRoofMode('off'); g.setCutaway('cut'); g.setViewLevel(0); });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `artifacts/qa/m5/houses/${id}-ground.png` });
  if (h.floors > 1) {
    await page.evaluate(() => window.__game.setViewLevel(1));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `artifacts/qa/m5/houses/${id}-upper.png` });
  }
  const errs = await page.evaluate(() => [...window.__game.errors(), ...window.__game.failedAssets()]);
  console.log(id, errs.length ? errs : 'ok');
}
await browser.close();
