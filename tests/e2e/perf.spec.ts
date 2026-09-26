import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expectNoGameErrors, game, openGame } from './helpers';

// BRIEF 4장: 1920×1080, 화면 안 인물 40명 + 물건 300개에서 p95 16.7ms 이하
// (날씨 효과는 M10 에서 이 테스트에 추가)
test('성능 예산: 40명 + 물건 300개', async ({ page }, info) => {
  test.skip(info.project.name !== 'fhd-1920', '1920×1080 에서만');
  const errors = await openGame(page);
  await game(page, 'await g.stress(38, 300); g.setZoom(1); g.setSpeed(3); return true;');
  await page.waitForTimeout(2000);
  await game(page, 'g.resetFrameStats(); return true;');
  await page.waitForTimeout(6000);
  const st = await game<{ p50: number; p95: number; p99: number; n: number; work: { p95: number } }>(page, 'return g.frameStats();');
  const info2 = await game<{ calls: number; triangles: number }>(page, 'return g.renderInfo();');
  const persons = await game<number>(page, 'return g.getState().persons.length;');
  mkdirSync('artifacts/perf', { recursive: true });
  writeFileSync('artifacts/perf/frame-1920.json', JSON.stringify({ persons, objects: 300 + 30, ...st, ...info2 }, null, 2));
  await page.screenshot({ path: 'artifacts/perf/stress-1920.png' });
  expect(persons).toBe(40);
  // 한 프레임에서 쓴 시간(갱신 + 그리기 제출) p95
  expect(st.work.p95).toBeLessThanOrEqual(16.7);
  // rAF 간격 p95: 60Hz 주사율 흔들림(±0.5ms)을 감안
  expect(st.p95).toBeLessThanOrEqual(17.5);
  await expectNoGameErrors(page, errors);
});
