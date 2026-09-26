// 블라인드 비교용 장면 캡처 (hideUI, 같은 줌): node tools/qa/critique-shots.mjs <라운드>
// 장면: plaza(광장/거리), farm(농가·밭·울타리), house(집 외관 단품), shore(물가·교외), interior(오두막 실내)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const round = process.argv[2] ?? '1';
const OUT = `artifacts/qa/critique/r${round}`;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:5188/?town=ashford');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120000 });
const shot = async (name, x, y, z, minute, clip) => {
  await page.evaluate(async ([x, y, z, m]) => {
    const g = window.__game;
    await g.setTime(m);
    await g.pause(true);
    g.hideUI(true);
    g.setZoom(z);
    g.centerOn(x * 32, y * 32);
    g.captureState?.('critique');
  }, [x, y, z, minute]);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/${name}.png`, ...(clip ? { clip } : {}) });
  console.log(name);
};
// 세로 구도 레퍼런스(00, 380×679)에 맞춰 가운데를 세로로 자름
const tall = { x: 548, y: 0, width: 504, height: 900 };
await shot('plaza', 60, 64, 2, 700, tall);
await shot('farm', 32, 9, 2, 700);
const house = await page.evaluate(() => { const hk = window.__hk; const sh = hk.world.lot.shells.filter((q) => /^s(1|2|3|5|7|26|29|32)$/.test(q.id)); const p = sh[Math.floor(sh.length / 2)]; return [p.x + 5, p.y + 3]; });
await shot('house', house[0], house[1], 2, 700);
await shot('shore', 104, 56, 2, 700);
// 실내: 우리 가족을 골라 E (스타듀식 실내 화면)
await page.evaluate(async () => { const g = window.__game; await g.setTime(420); await g.pause(true); g.hideUI(true); const p = g.getState().persons.find((q) => q.household === 1); g.select(p.id); });
await page.waitForTimeout(600);
await page.keyboard.press('e');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/interior.png` });
console.log('interior');
await browser.close();
