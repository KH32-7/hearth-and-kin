import { defineConfig } from '@playwright/test';

// 브라우저: 윈도우 기본 Edge(Chromium) 사용 → Playwright 전용 브라우저를 따로 내려받지 않음
const channel = process.env.PW_CHANNEL || 'msedge';

export default defineConfig({
  testDir: './tests/e2e',
  // WebGL 컨텍스트 경합으로 게임 시간이 흔들리지 않게 한 번에 하나씩
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: 'artifacts/playwright',
  use: {
    baseURL: 'http://127.0.0.1:5188',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    channel,
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5188',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  // BRIEF M0: 3개 해상도 (배율 1.25 노트북 포함: 장치 픽셀 정수 배율 보정 검증)
  projects: [
    { name: 'hd-1280', use: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } },
    { name: 'fhd-1920', use: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 } },
    { name: 'laptop-125', use: { viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25 } },
  ],
});
