import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

/** 浏览器验证配置：使用本机 Edge（channel msedge），由 vite 开发服务器承载 fixture。 */

export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  outputDir: fileURLToPath(new URL('../../../test-results/indexeddb/', import.meta.url)),
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  use: {
    channel: 'msedge',
    headless: true,
  },
});
