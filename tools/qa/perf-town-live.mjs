// M6 측정: 실제 마을 모드(?town=ashford) 프레임 — 배속 3에서 화면을 옮겨 가며 (세밀도 전환이 일어나게)
//   node tools/qa/perf-town-live.mjs [zoom=2]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const zoom = Number(process.argv[2] ?? 2);
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const t0 = Date.now();
await page.goto('http://127.0.0.1:5188/?town=ashford');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 180_000 });
const loadMs = Date.now() - t0;
const out = await page.evaluate(async (z) => {
  const g = window.__game;
  const hk = window.__hk;
  g.setZoom(z);
  await g.setTime(9 * 60 + 50);
  g.setSpeed(3);
  g.resetFrameStats();
  // 12초 동안 장소를 돌며 화면 이동 (사람이 간이 → 전체로 승급)
  const spots = [[110, 55], [163, 52], [86, 50], [60, 100], [30, 75], [115, 20]];
  const lods = [];
  for (let i = 0; i < 12; i++) {
    const [x, y] = spots[i % spots.length];
    g.centerOn(x * 32, y * 32);
    await new Promise((r) => setTimeout(r, 1000));
    lods.push(hk.client.snap.town.lod.full);
  }
  const f = g.frameStats();
  const info = g.renderInfo();
  const stats = (await g.getStats()).stats ?? {};
  const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1;
  return { frame: f, info, memMB: mem, fullByStep: lods, tickMs: stats.msPerTick ?? null, lodLog: hk.client.snap.town.lod };
}, zoom);
mkdirSync('artifacts/perf', { recursive: true });
await page.screenshot({ path: `artifacts/perf/town-live-z${zoom}.png` });
const res = { zoom, loadMs, ...out };
writeFileSync(`artifacts/perf/town-live-z${zoom}.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
await browser.close();
