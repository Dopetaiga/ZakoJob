/**
 * IndexedDB 腿测试台：vite build + preview 提供正式静态版页面，
 * 每个用例用独立浏览器上下文获得独立的真实 IndexedDB。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { build, preview, type PreviewServer } from 'vite';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');

export interface IdbBoard {
  baseUrl: string;
  newPage(
    viewport?: { width: number; height: number },
  ): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page; errors: string[] }>;
  close(): Promise<void>;
}

export async function startIdbBoard(): Promise<IdbBoard> {
  const outDir = await fs.mkdtemp(path.join(tmpdir(), 'zako-status-actions-idb-'));
  await build({
    root: ROOT_DIR,
    logLevel: 'silent',
    build: { outDir },
  });
  const server: PreviewServer = await preview({
    root: ROOT_DIR,
    build: { outDir },
    preview: { port: 0, host: '127.0.0.1' },
  });
  const baseUrl = server.resolvedUrls!.local[0]!;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  return {
    baseUrl,
    async newPage(viewport = { width: 1280, height: 860 }) {
      const context = await browser.newContext({ viewport, acceptDownloads: true });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      return { context, page, errors };
    },
    async close() {
      await browser?.close();
      server?.httpServer?.close();
      await fs.rm(outDir, { recursive: true, force: true });
    },
  };
}

/** 简单断言透出（复用 node:assert/strict，此处仅为语义导入）。 */
export { assert };
