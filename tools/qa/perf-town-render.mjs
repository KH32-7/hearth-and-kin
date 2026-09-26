// M6 측정 (S5): 큰 부지(200×150 마을) 렌더 비용 — 불러오기 시간, 프레임 간격, 그리기 호출, 메모리
//   node tools/qa/perf-town-render.mjs [lot=perf_town] [zoom=1]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const lot = process.argv[2] ?? 'perf_town';
const zoom = Number(process.argv[3] ?? 1);
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:5188/?lot=${lot}`);
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 180_000 });
const loadMs = Date.now() - t0;
const out = await page.evaluate(async (z) => {
  const g = window.__game;
  g.setZoom(z);
  g.centerOn(100 * 32, 75 * 32);
  g.resetFrameStats();
  await new Promise((r) => setTimeout(r, 3000));
  const f = g.frameStats();
  const info = g.renderInfo();
  const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1;
  return { frame: f, info, memMB: mem };
}, zoom);
mkdirSync('artifacts/perf', { recursive: true });
await page.screenshot({ path: `artifacts/perf/town-${lot}-z${zoom}.png` });
const res = { lot, zoom, loadMs, ...out };
writeFileSync(`artifacts/perf/town-${lot}-z${zoom}.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
await browser.close();
