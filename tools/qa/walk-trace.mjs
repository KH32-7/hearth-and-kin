// 걷는 사람 한 명의 프레임별 화면 이동량 (px) 3초: 고르게 걷는지
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:5188/?town=ashford&new=0');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.waitForTimeout(3000);
const r = await page.evaluate(async () => {
  const hk = window.__hk;
  const tr = new Map();
  const t0 = performance.now();
  await new Promise((done) => { const f = () => { for (const [id, n] of hk.chars.nodes) { const a = tr.get(id) ?? []; a.push([Math.round(performance.now() - t0), n.fx, n.fy, !!n.pred]); tr.set(id, a); } if (performance.now() - t0 < 4000) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
  let best = null, bestMoves = 0;
  for (const [id, a] of tr) { let m = 0; for (let i = 1; i < a.length; i++) if (Math.hypot(a[i][1] - a[i - 1][1], a[i][2] - a[i - 1][2]) > 0.2) m++; if (m > bestMoves) { bestMoves = m; best = id; } }
  const a = tr.get(best);
  const out = [];
  for (let i = 1; i < a.length; i++) out.push(`${a[i][0]}:${Math.hypot(a[i][1] - a[i - 1][1], a[i][2] - a[i - 1][2]).toFixed(1)}${a[i][3] ? 'p' : ''}`);
  return { id: best, frames: a.length, seq: out.slice(0, 120).join(' ') };
});
console.log(r.id, r.frames);
console.log(r.seq);
await browser.close();
