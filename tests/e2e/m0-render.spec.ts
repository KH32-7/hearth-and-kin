import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { blurStats, canvasPng, expectNoGameErrors, game, openGame } from './helpers';

// BRIEF M0 통과 조건: 3개 해상도 흐림 0, y-sort 오류 0, 합성 인물 10명 무작위 스크린샷, 콘솔 에러 0
mkdirSync('artifacts/qa/m0', { recursive: true });

test.describe('M0 렌더 기반', () => {
  test('흐림 0 (캔버스 픽셀 검사) + 콘솔 에러 0', async ({ page }, info) => {
    const errors = await openGame(page);
    // 낮 12시: 광원 번짐 꺼짐. UI 숨김. 멈춘 채 여러 줌에서 검사
    await game(page, 'await g.setTime(12*60); await g.pause(true); g.hideUI(true); return true;');
    const results = [];
    for (const zoom of [1, 2, 3]) {
      await game(page, `g.setZoom(${zoom}); return true;`);
      await page.waitForTimeout(300);
      const k = await game<number>(page, 'return g.renderInfo().deviceZoom;');
      const png = await canvasPng(page);
      const st = blurStats(png, k);
      results.push({ zoom, ...st });
      expect(st.nonUniform, `zoom ${zoom} k ${k}: 불균일 블록 ${st.nonUniform}/${st.blocks}`).toBe(0);
    }
    writeFileSync(`artifacts/qa/m0/blur-${info.project.name}.json`, JSON.stringify(results, null, 2));
    await game(page, 'g.setZoom(2); g.hideUI(false); return true;');
    await page.screenshot({ path: `artifacts/qa/m0/screen-${info.project.name}.png` });
    await expectNoGameErrors(page, errors);
  });

  test('y-sort 오류 0 (사람이 가구 앞뒤를 지나는 동안)', async ({ page }, info) => {
    const errors = await openGame(page);
    await game(page, 'g.setSpeed(3); return true;');
    let pairs = 0;
    const bad: unknown[] = [];
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(400);
      const a = await game<{ pairs: number; errors: unknown[] }>(page, 'return g.sortAudit();');
      pairs += a.pairs;
      bad.push(...a.errors);
    }
    writeFileSync(`artifacts/qa/m0/ysort-${info.project.name}.json`, JSON.stringify({ pairs, errors: bad }, null, 2));
    expect(bad).toEqual([]);
    expect(pairs).toBeGreaterThan(0);
    await expectNoGameErrors(page, errors);
  });

  test('합성 인물 10명 무작위 스크린샷', async ({ page }, info) => {
    test.skip(info.project.name !== 'fhd-1920', '한 해상도에서만');
    const errors = await openGame(page);
    await game(page, `
      await g.setAutonomy(false); await g.pause(true);
      const spots = [[3,12],[5,12],[7,12],[9,12],[11,12],[13,12],[15,12],[17,12],[18,9],[18,6]];
      const estates = ['serf','freeman','artisan','merchant','clergy','knight','noble','serf','noble','clergy'];
      for (let i = 0; i < 10; i++) await g.spawnPerson({ name: 'p' + (i+1), x: spots[i][0] + 0.5, y: spots[i][1] + 0.5, appearance: { estate: estates[i] } });
      g.setZoom(2); g.centerOn(10*32, 10*32); g.hideUI(true);
      return true;`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'artifacts/qa/m0/ten-people.png' });
    const n = await game<number>(page, 'return g.getState().persons.length;');
    expect(n).toBe(12);
    await expectNoGameErrors(page, errors);
  });
});
