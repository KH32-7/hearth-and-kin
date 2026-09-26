import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { expectNoGameErrors, game, openGame } from './helpers';

mkdirSync('artifacts/qa/m3', { recursive: true });

type Rel = { a: number; b: number; friendship: number; romance: number; name: string };
type P = { id: number; household: number; visitor: { neighborId: string } | null; x: number; y: number; action: { interactionId: string; phase: string } | null; topic: string | null; drawn: { x: number; y: number } };

// M3 통과 조건 (화면): 관계 탭에서 실제 클릭으로 초대 → 이웃이 길 끝에서 걸어 들어옴 → 사람을 눌러 분류 원형 메뉴 → 대화 → 관계 상승
test('M3 사람들: 초대 → 대화 → 관계 상승', async ({ page }, info) => {
  test.skip(info.project.name === 'laptop-125', '두 해상도로 충분');
  test.setTimeout(180_000);
  const errors = await openGame(page);
  await game(page, 'g.setZoom(3); return true;');

  // 1) 관계 탭: 식구(배우자) + 마을 이웃 목록
  await page.locator('.tab[data-tab="relations"]').click();
  await expect(page.locator('.rel-row').first()).toBeVisible();
  await expect(page.locator('.rel-nb')).toHaveCount(12);
  await page.waitForTimeout(300);
  await page.locator('.hud-bl').screenshot({ path: `artifacts/qa/m3/relations-${info.project.name}.png` });

  // 2) 초대 (실제 클릭)
  const first = page.locator('.rel-btn[data-action="invite"]').first();
  const nbId = await first.getAttribute('data-neighbor');
  await first.click();
  await expect.poll(() => game<string[]>(page, 'return g.getState().pendingVisits;')).toContain(nbId);

  // 3) 이웃이 부지 출구에서 걸어 들어옴
  // 도착을 놓치지 않게 중간 속도 + 짧은 간격으로 지켜보다가 나타나면 멈춤
  await game(page, 'g.setSpeed(2); return true;');
  await expect.poll(() => game<number>(page, 'const n = g.getState().persons.filter((p) => p.visitor).length; if (n) g.setSpeed(0); return n;'), { timeout: 90_000, intervals: [50] }).toBe(1);
  const visitor = (await game<P[]>(page, 'return g.getState().persons;')).find((p) => p.visitor)!;
  // 들어오는 모습 (그림이 준비될 때까지 기다린 뒤, 잠깐 멈추고 찍음)
  await expect.poll(() => game<boolean>(page, `return !!g.getState().persons.find((q) => q.id === ${visitor.id})?.drawn;`), { timeout: 20_000 }).toBe(true);
  await game(page, `g.setSpeed(1); return true;`);
  await page.waitForTimeout(2500);
  await game(page, `g.setSpeed(0); const p = g.getState().persons.find((q) => q.id === ${visitor.id}); g.centerOn(p.drawn.x, p.drawn.y - 40); return true;`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `artifacts/qa/m3/visitor-arrives-${info.project.name}.png` });

  await game(page, 'g.setSpeed(3); return true;');
  // 4) 손님이 인사하러 오면 만난 사이가 됨 (첫인상)
  await expect.poll(() => game<boolean>(page, `return (g.getState().relations ?? []).some((r) => (r.a === ${visitor.id} || r.b === ${visitor.id}));`), { timeout: 60_000 }).toBe(true);

  // 5) 플레이어가 손님을 눌러 대화: 분류 → 항목 (성공할 때까지 최대 4번)
  const rel = async () => (await game<Rel[]>(page, 'return g.getState().relations;')).find((r) => (r.a === 1 && r.b === visitor.id) || (r.b === 1 && r.a === visitor.id));
  let before = (await rel())?.friendship ?? 0;
  let rose = false;
  for (let attempt = 0; attempt < 4 && !rose; attempt++) {
    // 상대가 다른 대화 중이 아닐 때 (자율로 하던 일은 플레이어 명령이 끊음)
    await expect.poll(() => game<boolean>(page, `const s = g.getState(); const v = s.persons.find((p) => p.id === ${visitor.id}); return !!v && !v.talkingWith && !(v.action && v.action.interactionId.startsWith('social.'));`), { timeout: 30_000 }).toBe(true);
    await game(page, `g.select(1); g.setSpeed(0); const p = g.getState().persons.find((q) => q.id === ${visitor.id}); g.centerOn(p.drawn.x, p.drawn.y - 24); return true;`);
    await page.waitForTimeout(300);
    const pos = await game<{ x: number; y: number }>(page, `return g.personMenuPos(${visitor.id});`);
    await page.mouse.click(pos.x, pos.y);
    await expect(page.locator('.pie-item[data-interaction^="__cat:"]').first()).toBeVisible();
    if (attempt === 0) {
      await page.waitForTimeout(350);
      await page.screenshot({ path: `artifacts/qa/m3/pie-categories-${info.project.name}.png` });
    }
    // 처음 만난 사이면 기본(인사), 아는 사이면 친근. 할 수 있는 항목이 있는 쪽
    const cat = (await page.locator('.pie-item[data-interaction="__cat:friendly"]').isEnabled()) ? 'friendly' : 'basic';
    await page.locator(`.pie-item[data-interaction="__cat:${cat}"]`).click();
    // 성공 확률이 가장 높은 항목 (메뉴는 할 수 있는 것 먼저, 확률 순)
    const item = page.locator(`.pie-item[data-category="${cat}"]:not([disabled])`).first();
    await expect(item).toBeVisible();
    if (attempt === 0) {
      await page.waitForTimeout(350);
      await page.screenshot({ path: `artifacts/qa/m3/pie-friendly-${info.project.name}.png` });
    }
    console.log('CLICK', await item.getAttribute('data-interaction'), cat);
    await item.click();
    console.log('AFTER', JSON.stringify(await game(page, 'const s = g.getState(); return { q: s.persons[0].queue, a: s.persons[0].action, n: s.notices.filter((n) => n.kind === "cannot").slice(-3) };')));
    await game(page, 'g.setSpeed(1); return true;');
    // 대화 중 주제 말풍선 캡처
    const dump = async () => console.log('DUMP', JSON.stringify(await game(page, 'const s = g.getState(); return { persons: s.persons.map((p) => ({ id: p.id, x: p.x, y: p.y, a: p.action, q: p.queue, tw: p.talkingWith, v: p.visitor, sl: p.sleeping, h: p.hidden })), notices: (s.notices ?? []).filter((n) => n.kind === "cannot" || n.kind === "social_result").slice(-6) };')));
    const seenBefore = await game<string>(page, 'const l = g.getState().persons.find((p) => p.id === 1).lastSocial; return l ? `${l.minute}:${l.ia}` : "";');
    // 말을 주고받기 시작하거나(수행) 이미 끝나 결과가 나왔을 때까지
    await expect.poll(() => game<string>(page, "const p = g.getState().persons.find((q) => q.id === 1); const a = p.action; const l = p.lastSocial; if (a && a.interactionId.startsWith('social.') && a.phase === 'perform') return 'perform'; return l && `${l.minute}:${l.ia}` !== " + JSON.stringify(seenBefore) + " ? 'done' : 'wait';"), { timeout: 30_000, intervals: [50] }).not.toBe('wait').catch(async (e) => {
      await dump();
      throw e;
    });
    const talking = await game<boolean>(page, "const a = g.getState().persons.find((q) => q.id === 1).action; return !!a && a.interactionId.startsWith('social.') && a.phase === 'perform';");
    if (attempt === 0 && talking) {
      // 멈춘 채로 말 주고받기 연출 (연출 시계는 실시간이라 멈춰도 움직임): 0.7초 간격 3장
      await game(page, 'g.setSpeed(0); return true;');
      const me = await game<P>(page, 'return g.getState().persons.find((p) => p.id === 1);');
      await game(page, `g.centerOn(${me.drawn.x}, ${me.drawn.y} - 16); return true;`);
      for (let k = 0; k < 3; k++) {
        await page.waitForTimeout(700);
        await page.screenshot({ path: `artifacts/qa/m3/conversation-${k}-${info.project.name}.png` });
      }
    }
    await game(page, 'g.setSpeed(3); return true;');
    await expect.poll(() => game<unknown>(page, 'return g.getState().persons.find((p) => p.id === 1).action;'), { timeout: 60_000 }).toBeNull();
    const after = (await rel())?.friendship ?? 0;
    rose = after > before;
    before = after;
  }
  expect(rose).toBe(true);

  // 6) 관계 탭에 손님이 "아는 사람" 으로 보임
  await game(page, 'g.setSpeed(0); return true;');
  await expect(page.locator(`.rel-row[data-other="${visitor.id}"]`)).toBeVisible();
  await page.locator('.hud-bl').screenshot({ path: `artifacts/qa/m3/relations-after-${info.project.name}.png` });
  await expectNoGameErrors(page, errors);
});
