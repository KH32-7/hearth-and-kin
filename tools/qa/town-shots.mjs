// M6 마을 검수 캡처: 시작 화면(미니맵), 멀리 본 마을(장소 이름표), 장터 아침, 말 탄 사람, 포고 두루마리
//   node tools/qa/town-shots.mjs   (개발 서버 127.0.0.1:5188)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'artifacts/qa/m6/game';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:5188/?town=ashford');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.waitForTimeout(2500);
const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('찍음', name);
};
await shot('01-start');

// 멀리 본 마을: 줌 1, 장터 광장 가운데
await page.evaluate(() => {
  const g = window.__game;
  g.setZoom(1);
  g.centerOn(110 * 32, 60 * 32);
});
await shot('02-town-zoom1');

// 장터 아침 10시: 사람이 모임
await page.evaluate(async () => {
  const g = window.__game;
  await g.setTime(9 * 60 + 40);
  g.setSpeed(3);
});
await page.waitForTimeout(9000);
await page.evaluate(() => {
  const g = window.__game;
  g.setSpeed(0);
  g.setZoom(2);
  g.centerOn(110 * 32, 55 * 32);
});
await shot('03-market-morning');

// 말 탄 사람: 전원 전체 세밀도로 올려 찾음
const rider = await page.evaluate(async () => {
  const hk = window.__hk;
  await hk.client.intent({ kind: 'forceLod', lod: 'full' });
  hk.setSpeed(2);
  for (let i = 0; i < 160; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const f = hk.client.snap.persons.find((p) => p.riding !== undefined);
    if (f) {
      hk.setSpeed(0);
      await new Promise((r) => setTimeout(r, 300));
      const d = hk.chars.drawnPosition(f.id);
      hk.renderer.setZoom(3);
      hk.renderer.centerOn(d.x, d.y - 30);
      return f.name;
    }
  }
  return null;
});
console.log('말 탄 사람', rider);
if (rider) await shot('04-rider');

// 포고: 며칠 건너뛰어 소식이 쌓이면 두루마리가 펼쳐짐
await page.evaluate(async () => {
  const hk = window.__hk;
  await hk.client.intent({ kind: 'forceLod', lod: null });
  await window.__game.fastForwardDays(2);
  hk.setSpeed(1);
  window.__game.setZoom(2);
  window.__game.centerOn(110 * 32, 57 * 32);
});
await page.waitForTimeout(4200);
await shot('05-crier');
await page.click('[data-testid="town-news-btn"]');
await shot('06-news-list');
const errs = await page.evaluate(() => [...window.__game.errors(), ...window.__game.failedAssets()]);
console.log(errs.length ? errs : '오류 없음');
await browser.close();
