// 걷는 속도 고르기 검사: 1배속에서 화면 안 걷는 사람들의 프레임당 화면 이동량 분포 + D 이동. node tools/qa/walk-smooth.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://127.0.0.1:5188/?town=ashford');
await page.waitForFunction(() => window.__game?.ready?.(), null, { timeout: 120_000 });
await page.evaluate(async () => { const g = window.__game; await g.setTime(8 * 60); g.setZoom(2); g.centerOn(60 * 32, 64 * 32); g.setSpeed(1); });
await page.waitForTimeout(3000);
// 프레임마다 그려진 위치 기록 (5초)
const res = await page.evaluate(async () => {
  const hk = window.__hk;
  const track = new Map();
  const t0 = performance.now();
  await new Promise((done) => {
    const step = () => {
      for (const [id, n] of hk.chars.nodes) {
        const a = track.get(id) ?? [];
        a.push([performance.now(), n.fx, n.fy]);
        track.set(id, a);
      }
      if (performance.now() - t0 < 5000) requestAnimationFrame(step); else done(null);
    };
    requestAnimationFrame(step);
  });
  // 걷는 구간 (연속 이동) 속도: px/초
  const speeds = [];
  let jumps = 0;
  for (const a of track.values()) {
    for (let i = 1; i < a.length; i++) {
      const dt = (a[i][0] - a[i - 1][0]) / 1000;
      const d = Math.hypot(a[i][1] - a[i - 1][1], a[i][2] - a[i - 1][2]);
      if (d > 0.01 && dt > 0) speeds.push(d / dt);
      if (d > 40) jumps++;
    }
  }
  speeds.sort((x, y) => x - y);
  const q = (f) => speeds[Math.floor(f * (speeds.length - 1))] ?? 0;
  return { n: speeds.length, people: track.size, p10: q(0.1), p50: q(0.5), p90: q(0.9), max: q(1), jumps };
});
console.log('화면 이동 속도 px/초 (세계 px, 1타일 32px):', JSON.stringify(res));
// D: 조작 인물을 열린 풀밭으로 옮겨 오른쪽으로
const me = await page.evaluate(() => { const s = window.__game.getState(); return s.persons.find((q) => q.household === 1); });
await page.evaluate(async (id) => { const g = window.__game; g.select(id); g.setSpeed(2); }, me.id);
const before = await page.evaluate(() => { const s = window.__game.getState(); const p = s.persons.find((q) => q.id === window.__hk.selectedId); return [p.x, p.y]; });
await page.keyboard.down('a');
await page.waitForTimeout(1500);
await page.keyboard.up('a');
await page.waitForTimeout(500);
const mid = await page.evaluate(() => { const s = window.__game.getState(); const p = s.persons.find((q) => q.id === window.__hk.selectedId); return [p.x, p.y]; });
await page.keyboard.down('d');
await page.waitForTimeout(1500);
await page.keyboard.up('d');
await page.waitForTimeout(500);
const after = await page.evaluate(() => { const s = window.__game.getState(); const p = s.persons.find((q) => q.id === window.__hk.selectedId); return [p.x, p.y]; });
console.log('A 전', before.map((v) => v.toFixed(1)).join(','), 'A 후', mid.map((v) => v.toFixed(1)).join(','), 'D 후', after.map((v) => v.toFixed(1)).join(','));
console.log('오류', errs.slice(0, 5));
await browser.close();
