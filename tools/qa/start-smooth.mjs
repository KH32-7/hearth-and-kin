// 시작 직후 걷기 검사: 준비되자마자 10초 동안 화면 속 인물의 프레임당 이동량 (순간이동·속도 들쑥날쑥). node tools/qa/start-smooth.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:5188/?town=ashford&new=0');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
const res = await page.evaluate(async () => {
  const hk = window.__hk;
  const track = new Map();
  const t0 = performance.now();
  await new Promise((done) => {
    const step = () => {
      const snap = window.__game.getState();
      for (const [id, n] of hk.chars.nodes) {
        const a = track.get(id) ?? [];
        const p = snap?.persons.find((q) => q.id === id);
        a.push([performance.now() - t0, n.fx, n.fy, p ? p.x : -1, p ? p.y : -1, p?.lod ?? '', snap?.speed ?? 0]);
        track.set(id, a);
      }
      if (performance.now() - t0 < 10000) requestAnimationFrame(step); else done(null);
    };
    requestAnimationFrame(step);
  });
  const jumps = [];
  const speeds = [];
  for (const [id, a] of track) {
    for (let i = 1; i < a.length; i++) {
      const dt = (a[i][0] - a[i - 1][0]) / 1000;
      const d = Math.hypot(a[i][1] - a[i - 1][1], a[i][2] - a[i - 1][2]);
      if (d > 0.01 && dt > 0) speeds.push(d / dt);
      const sd = Math.hypot(a[i][3] - a[i - 1][3], a[i][4] - a[i - 1][4]);
      if (d > 24) jumps.push({ id, t: Math.round(a[i][0]), d: Math.round(d), sim: [a[i][3].toFixed(1), a[i][4].toFixed(1)], simJump: sd.toFixed(2), spd: a[i][6] });
    }
  }
  speeds.sort((x, y) => x - y);
  const simBig = [];
  for (const [id, a] of track) for (let i = 1; i < a.length; i++) { const sd = Math.hypot(a[i][3] - a[i - 1][3], a[i][4] - a[i - 1][4]); if (sd > 1.5 && a[i][3] >= 0 && a[i-1][3] >= 0) simBig.push([id, Math.round(a[i][0]), sd.toFixed(1), a[i-1][3].toFixed(1)+','+a[i-1][4].toFixed(1), a[i][3].toFixed(1)+','+a[i][4].toFixed(1)]); }
  const q = (f) => Math.round(speeds[Math.floor(f * (speeds.length - 1))] ?? 0);
  return { people: track.size, p10: q(0.1), p50: q(0.5), p90: q(0.9), p99: q(0.99), jumps: jumps.length, simBig: simBig.slice(0, 20), simBigN: simBig.length, first: jumps.slice(0, 12), speedNow: window.__game.getState()?.speed, auto: window.__game.getState()?.autoAccel };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
