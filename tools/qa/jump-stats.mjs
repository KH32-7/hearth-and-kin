// 속도별 모든 인물 프레임 이동량: 순간이동(한 프레임 6px 넘게) 수와 프레임 시간
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:5188/?town=ashford&new=0');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.waitForTimeout(Number(process.argv[2] ?? 2000));
const res = {};
for (const sp of [1, 2, 3]) {
  await page.evaluate((s) => window.__game.setSpeed(s), sp);
  await page.waitForTimeout(1500);
  res[sp] = await page.evaluate(async () => {
    const hk = window.__hk;
    const last = new Map();
    const jumps = [];
    const dts = [];
    let moves = 0;
    const t0 = performance.now();
    let prev = t0;
    await new Promise((done) => {
      const f = () => {
        const now = performance.now();
        dts.push(now - prev);
        prev = now;
        for (const [id, n] of hk.chars.nodes) {
          if (!n.root?.visible && n.root !== undefined) { last.delete(id); continue; }
          const l = last.get(id);
          if (l) {
            const d = Math.hypot(n.fx - l[0], n.fy - l[1]);
            if (d > 0.2) moves++;
            if (d > 6 && d < 400) jumps.push([id, Math.round(d), Math.round(now - t0)]);
          }
          last.set(id, [n.fx, n.fy]);
        }
        if (now - t0 < 5000) requestAnimationFrame(f); else done();
      };
      requestAnimationFrame(f);
    });
    dts.sort((a, b) => a - b);
    return { frames: dts.length, p50: +dts[dts.length >> 1].toFixed(1), p95: +dts[Math.floor(dts.length * 0.95)].toFixed(1), max: +dts[dts.length - 1].toFixed(1), moves, jumps: jumps.length, sample: jumps.slice(0, 8) };
  });
}
console.log(JSON.stringify({ res, errs }));
await browser.close();
