// 메인 스레드 CPU 프로파일 (CDP Profiler): 40명 + 물건 300 부하에서 자기 시간(self) 상위 함수
//   node tools/qa/cpu-profile.mjs [초]
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const secs = Number(process.argv[2] ?? 4);
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://127.0.0.1:5188/');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 90_000 });
await page.evaluate(async () => { const g = window.__game; await g.stress(38, 300); g.setZoom(1); g.setSpeed(3); });
await page.waitForTimeout(2000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await page.waitForTimeout(secs * 1000);
const { profile } = await cdp.send('Profiler.stop');
mkdirSync('artifacts/perf', { recursive: true });
writeFileSync('artifacts/perf/main.cpuprofile', JSON.stringify(profile));
// self time per node
const dt = new Map();
const total = profile.timeDeltas.reduce((a, b) => a + b, 0);
profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
const byFn = new Map();
for (const n of profile.nodes) {
  const t = dt.get(n.id) ?? 0;
  const cf = n.callFrame;
  const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber}`;
  byFn.set(key, (byFn.get(key) ?? 0) + t);
}
const top = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log(`total ${(total / 1000).toFixed(0)}ms`);
for (const [k, v] of top) console.log(`${(v / 1000).toFixed(1).padStart(7)}ms ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
await browser.close();
