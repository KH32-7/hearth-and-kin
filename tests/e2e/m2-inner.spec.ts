import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expectNoGameErrors, game, openGame } from './helpers';

mkdirSync('artifacts/qa/m2', { recursive: true });

// M2 통과 조건 (화면): 속마음 말풍선, 내면 패널 3탭, 무너짐 카드를 실제 클릭으로 고름, 사람을 누르면 사회 메뉴
test('M2 내면: 말풍선 · 내면 패널 · 무너짐 카드 · 사회 메뉴', async ({ page }, info) => {
  test.skip(info.project.name === 'laptop-125', '두 해상도로 충분');
  const errors = await openGame(page);
  await game(page, "g.setZoom(3); await g.intent({kind:'addMoodlet', personId:1, moodlet:'fresh_bread'}); await g.intent({kind:'addMoodlet', personId:1, moodlet:'teased'}); return true;");

  // 1) 내면 패널 3탭이 채워짐
  for (const tab of ['mood', 'persona', 'wishes']) {
    await page.locator(`.tab[data-tab="${tab}"]`).click();
    await expect(page.locator('.inner-view')).toBeVisible();
    await page.waitForTimeout(250);
    await page.locator('.hud-bl').screenshot({ path: `artifacts/qa/m2/panel-${tab}-${info.project.name}.png` });
    if (tab === 'persona') await expect(page.locator('.inner-view .chip[data-trait]')).toHaveCount(3);
    if (tab === 'mood') await expect(page.locator('.inner-view .moodlet').first()).toBeVisible();
  }
  await page.locator('.tab[data-tab="needs"]').click();

  // 2) 속마음 말풍선: 두 사람이 이야기하게 하고 풍선이 뜰 때까지
  await game(page, "await g.intent({kind:'queue', personId:1, interactionId:'social.deep_talk', targetUid:2}); g.setSpeed(3); return true;");
  await expect.poll(() => page.locator('.thought').count(), { timeout: 60_000 }).toBeGreaterThan(0);
  await game(page, 'g.setSpeed(1); return true;');
  const th = page.locator('.thought').first();
  const box = (await th.boundingBox())!;
  expect(box.width).toBeGreaterThan(20);
  // 말풍선 확대 캡처 (체크리스트용)
  await page.screenshot({ path: `artifacts/qa/m2/thought-${info.project.name}.png`, clip: { x: Math.max(0, box.x - 40), y: Math.max(0, box.y - 20), width: Math.min(box.width + 80, 600), height: box.height + 120 } });

  // 3) 사람을 누르면 사회 원형 메뉴 (조작 중이 아닌 사람). 겹치지 않게 상대를 떨어뜨려 둠
  await game(page, "await g.setAutonomy(false); await g.intent({kind:'goto', personId:2, x:9, y:12}); await g.intent({kind:'goto', personId:1, x:3, y:12}); g.setSpeed(3); return true;");
  await expect.poll(() => game<number>(page, 'const p=g.getState().persons; return Math.hypot(p[0].x-p[1].x, p[0].y-p[1].y);'), { timeout: 30_000 }).toBeGreaterThan(4);
  await expect.poll(() => game<unknown>(page, 'return g.getState().persons[1].action;'), { timeout: 30_000 }).toBeNull();
  await game(page, 'g.setSpeed(0); const p=g.getState().persons[1].drawn; g.centerOn(p.x, p.y-24); return true;');
  await page.waitForTimeout(300);
  const p2 = await game<{ x: number; y: number }>(page, 'return g.personMenuPos(2);');
  await page.mouse.click(p2.x, p2.y);
  // M3 부터 사람 메뉴는 분류(기본/친근/…) → 항목 두 단계
  await expect(page.locator('.pie-item[data-interaction^="__cat:"]').first()).toBeVisible();
  await page.locator('.pie-item[data-interaction^="__cat:"]:not([disabled])').first().click();
  await expect(page.locator('.pie-item[data-interaction^="social."]').first()).toBeVisible();
  await page.screenshot({ path: `artifacts/qa/m2/social-menu-${info.project.name}.png` });
  await page.keyboard.press('Escape');
  await game(page, 'await g.setAutonomy(true); g.setSpeed(1); return true;');

  // 4) 무너짐 카드: 스트레스 100 → 카드 → 실제 클릭으로 고름 → 스트레스 50
  await game(page, "await g.intent({kind:'setStress', personId:1, value:100}); return true;");
  await expect(page.getByTestId('choice-card').locator('.choice-option')).toHaveCount(4);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `artifacts/qa/m2/breakdown-card-${info.project.name}.png` });
  await page.locator('.choice-option[data-option="pray_cry"]').click();
  await expect(page.getByTestId('choice-card').locator('.choice-option')).toHaveCount(0);
  await expect.poll(() => game<number>(page, 'return g.getState().persons[0].inner.stress;')).toBeLessThanOrEqual(50);

  // 말풍선/아이콘 검수 체크리스트 (자동 생성, 사람 눈 확인 칸 포함)
  const atlas = await game<Record<string, { w: number; h: number }>>(page, "const r = await fetch('/src/data/ui/atlas.json').then(r=>r.json()); return r.sprites;");
  const need = ['bubble.thought', 'bubble.speech', ...['happy', 'energized', 'focused', 'excited', 'inspired', 'pious', 'sad', 'angry', 'tense', 'ashamed', 'neutral'].map((e) => `emo.${e}`)];
  const rows = need.map((k) => `| ${k} | ${atlas[k] ? `${atlas[k].w}×${atlas[k].h}` : '없음'} | ${atlas[k] ? '통과' : '실패'} | [ ] |`);
  const png = PNG.sync.read(await th.screenshot().catch(() => page.screenshot()));
  writeFileSync('artifacts/qa/m2/bubble-checklist.md', [
    '# 말풍선/감정 아이콘 검수 체크리스트 (자동 생성: tests/e2e/m2-inner.spec.ts)',
    '',
    '프레임: 말풍선은 정지 9-slice(애니메이션 없음, 방향 없음). 감정 아이콘 11종은 1프레임. 팔레트는 원본 에셋 픽셀 그대로(build-ui-atlas.py 바이트 비교)',
    '',
    '| 키 | 크기 | 자동 | 눈 확인 |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    `게임 속 말풍선 캡처: artifacts/qa/m2/thought-*.png (${png.width}×${png.height})`,
    '눈 확인 항목: 테두리가 끊기지 않음 · 한글이 한 줄/두 줄로 자연스럽게 · 인물 머리를 가리지 않음 · 밤 화면에서도 읽힘',
  ].join('\n'));
  expect(need.every((k) => atlas[k])).toBe(true);
  await expectNoGameErrors(page, errors);
});
