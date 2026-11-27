// 验收专用 Playwright 配置：Edge 渠道、独立产物目录，不影响仓库根配置。
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  testDir: here,
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/browser/acceptance-report.json' }],
  ],
  outputDir: 'test-results/browser-artifacts',
  use: {
    channel: 'msedge',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
