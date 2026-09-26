// 상태 추적: node tools/qa/probe.mjs [초] [속도]
import { chromium } from '@playwright/test';
const [secs = '20', speed = '3'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://127.0.0.1:5188/');
await page.waitForFunction(() => window.__game?.ready?.());
await page.evaluate((s) => window.__game.setSpeed(+s), speed);
for (let i = 0; i < +secs; i += 2) {
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => window.__game.getState());
  console.log(st.minuteOfDay, st.persons.map((p) => `${p.name}(${p.x.toFixed(1)},${p.y.toFixed(1)}) ${p.pose}/${p.anim} ${p.action ? p.action.interactionId + ':' + p.action.phase : '-'}`).join(' | '));
}
const stats = await page.evaluate(() => window.__game.getStats());
console.log(JSON.stringify({ stuck: stats.stats.stuckEvents, unsticks: stats.stats.unsticks, clip: stats.stats.clipViolations, pathFails: stats.stats.pathFails, completed: stats.stats.completed, aborted: stats.stats.aborted }));
console.log(logs.join('\n'));
await browser.close();
