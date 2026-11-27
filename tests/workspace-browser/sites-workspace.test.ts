/**
 * 真实 Sites 构建正式工作台 + Miniflare 隔离 D1 + 本地反代真实 Worker 浏览器 UI 测试（4.3 实证）。
 *
 * 覆盖：
 * 1. 发送前断网：阻止发出写入请求、UI 明确提示失败且恢复联网与刷新后不自动重复提交；
 * 2. 真实 Worker 明确拒绝：并发版本冲突拒绝、非空看板导入拒绝（409），UI 准确反馈且不自动重试；
 * 3. D1 实际提交后响应丢失：Worker 真实落库 D1 后掐断回包，UI 提示「未确认是否保存，请刷新查看」、未自动重复，
 *    主动「刷新查看」或整页刷新后从 D1 读回已提交记录，D1 无重复记录且后续操作恢复「站点已确认」。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from '@playwright/test';
import { Miniflare } from 'miniflare';
import { build } from 'vite';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const FICTIONAL_LOCAL_OWNER_ID = 'fictional-local-owner-001';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

let tempDir: string;
let clientDir: string;
let workerDir: string;
let mf: Miniflare;
let proxyServer: http.Server;
let browser: Browser;
let baseUrl = '';

let commandRequestCount = 0;
let dropNextCommandResponse = false;

async function readIncomingBody(req: http.IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const buf = Buffer.concat(chunks);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function createIsolatedPage(
  viewport = { width: 1280, height: 860 },
): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page; errors: string[] }> {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { context, page, errors };
}

async function countJobsInD1(): Promise<number> {
  const db = await mf.getD1Database('DB');
  const row = await db.prepare('SELECT COUNT(*) AS cnt FROM jobs').first<{ cnt: number }>();
  return Number(row?.cnt ?? 0);
}

describe('Sites 构建正式工作台 + Miniflare D1 真实浏览器 UI 实证（4.3）', () => {
  before(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'zako-sites-browser-'));
    clientDir = path.join(tempDir, 'client');
    workerDir = path.join(tempDir, 'server');

    // 使用真实 Sites 构建正式前端与隔离测试 Worker（内含 D1 迁移与测试断包标记）
    await build({
      root: ROOT_DIR,
      mode: 'sites',
      logLevel: 'silent',
      build: { outDir: clientDir, emptyOutDir: true },
    });

    await build({
      root: ROOT_DIR,
      mode: 'sites',
      publicDir: false,
      logLevel: 'silent',
      build: {
        outDir: workerDir,
        emptyOutDir: true,
        ssr: path.join(ROOT_DIR, 'worker/test-entry.ts'),
        rollupOptions: { output: { entryFileNames: 'index.js' } },
      },
    });

    mf = new Miniflare({
      modules: true,
      modulesRoot: workerDir,
      scriptPath: path.join(workerDir, 'index.js'),
      compatibilityDate: '2025-05-01',
      d1Databases: { DB: 'zako-sites-browser-db' },
      d1Persist: path.join(tempDir, 'd1'),
      bindings: { OWNER_USER_ID: FICTIONAL_LOCAL_OWNER_ID },
    });

    proxyServer = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url ?? '/', baseUrl || 'http://127.0.0.1');
        if (reqUrl.pathname.startsWith('/api/')) {
          const isCommandPost = req.method === 'POST' && reqUrl.pathname === '/api/board/commands';
          if (isCommandPost) {
            commandRequestCount += 1;
          }

          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const item of value) headers.append(key, item);
            } else {
              headers.set(key, value);
            }
          }
          // 仅向本地 Miniflare Worker 注入虚构本地身份头
          headers.set('oai-authenticated-user-id', FICTIONAL_LOCAL_OWNER_ID);
          if (isCommandPost && dropNextCommandResponse) {
            dropNextCommandResponse = false;
            headers.set('x-zk-test-fault-drop-response', '1');
          }

          const bodyBytes = await readIncomingBody(req);
          const workerUrl = `${baseUrl.replace(/\/$/, '')}${reqUrl.pathname}${reqUrl.search}`;

          try {
            const workerRes = await mf.dispatchFetch(workerUrl, {
              method: req.method,
              headers: Object.fromEntries(headers.entries()),
              body: req.method === 'GET' || req.method === 'HEAD' ? undefined : bodyBytes,
            });
            const buf = Buffer.from(await workerRes.arrayBuffer());
            const outHeaders: Record<string, string> = { 'cache-control': 'no-store' };
            workerRes.headers.forEach((v, k) => {
              outHeaders[k] = v;
            });
            res.writeHead(workerRes.status, outHeaders);
            res.end(buf);
          } catch {
            // D1 实际提交后响应流中断，切断 HTTP 连接模拟丢失响应
            res.destroy();
          }
          return;
        }

        // 静态资源来自真实 vite build --mode sites 产物
        const relPath = reqUrl.pathname === '/' ? 'index.html' : decodeURIComponent(reqUrl.pathname).replace(/^\/+/, '');
        const resolved = path.resolve(clientDir, relPath);
        if (!resolved.startsWith(clientDir + path.sep) && resolved !== path.join(clientDir, 'index.html')) {
          res.writeHead(403).end('Forbidden');
          return;
        }
        const stat = await fs.stat(resolved).catch(() => null);
        const filePath = stat?.isFile() ? resolved : path.join(clientDir, 'index.html');
        const content = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(content);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500).end(err instanceof Error ? err.message : 'Proxy error');
        } else {
          res.destroy();
        }
      }
    });

    await new Promise<void>((resolve) => {
      proxyServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = proxyServer.address();
    assert.ok(addr && typeof addr === 'object');
    baseUrl = `http://127.0.0.1:${addr.port}/`;

    // 触发一次健康检查确保 D1 迁移在首个用例前已就绪
    const healthRes = await mf.dispatchFetch(`${baseUrl}api/board/health`, {
      headers: { 'oai-authenticated-user-id': FICTIONAL_LOCAL_OWNER_ID },
    });
    assert.equal(healthRes.status, 204);

    browser = await chromium.launch({ channel: 'msedge', headless: true });
  });

  beforeEach(async () => {
    commandRequestCount = 0;
    dropNextCommandResponse = false;
    const db = await mf.getD1Database('DB');
    await db.batch([
      db.prepare('DELETE FROM jobs'),
      db.prepare('DELETE FROM preferences'),
      db.prepare('DELETE FROM completed_imports'),
    ]);
  });

  after(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => {
      proxyServer?.close(() => resolve());
    });
    await mf?.dispose();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('发送前断网：阻止提交并提示未完成，恢复联网与刷新后未自动重复写入 D1', async () => {
    const { context, page, errors } = await createIsolatedPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      assert.equal(await page.locator('.zj-app-brand').textContent(), '扎口Job', '顶栏品牌一行，不再显示适配器标识');
      await page.getByRole('heading', { name: '还没有记录岗位' }).waitFor();
      assert.equal(commandRequestCount, 0);

      // 发送前断网
      await context.setOffline(true);
      await page.getByRole('button', { name: '添加岗位' }).first().click();
      const jobDialog = page.locator('dialog[open]');
      await jobDialog.getByLabel('公司').fill('离线未发科技');
      await jobDialog.getByLabel('职位').fill('服务端工程师');
      await jobDialog.getByRole('button', { name: '添加' }).click();

      // UI 必须明确提示失败/未保存，且因为发送前拦截不提供虚假的「刷新查看」误导或未产生写入
      const failedAlert = jobDialog.getByRole('alert');
      await failedAlert.waitFor();
      assert.equal(await failedAlert.textContent(), '网络不可用，本次保存未完成。');

      const failedBanner = page.locator('.zj-feedback-banner[data-tone="failed"]');
      await failedBanner.waitFor();
      assert.ok((await failedBanner.textContent())?.includes('网络不可用，本次保存未完成。'));
      assert.equal(commandRequestCount, 0, '发送前断网不得发出任何写请求');

      await jobDialog.getByRole('button', { name: '取消' }).click();
      await page.getByRole('heading', { name: '还没有记录岗位' }).waitFor();

      // 恢复联网并刷新：确认没有后台自动重发，D1 仍为空
      await context.setOffline(false);
      await page.waitForTimeout(300);
      assert.equal(commandRequestCount, 0, '恢复联网后不得自动补发之前失败的请求');

      await page.reload({ waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: '还没有记录岗位' }).waitFor();
      assert.equal(await countJobsInD1(), 0);
      assert.equal(errors.length, 0);
    } finally {
      await context.close();
    }
  });

  it('真实 Worker 明确拒绝：并发版本冲突与非空看板导入拒绝，提示明确且不自动重试', async () => {
    const tabA = await createIsolatedPage();
    const tabB = await createIsolatedPage();
    try {
      // Tab A 建档（version 1）
      await tabA.page.goto(baseUrl, { waitUntil: 'networkidle' });
      await tabA.page.getByRole('button', { name: '添加岗位' }).first().click();
      const dialogA = tabA.page.locator('dialog[open]');
      await dialogA.getByLabel('公司').fill('晴风智造');
      await dialogA.getByLabel('职位').fill('数据研发');
      await dialogA.getByRole('button', { name: '添加' }).click();
      await tabA.page.locator('.zj-feedback-banner[data-tone="saved"]').waitFor();
      assert.ok((await tabA.page.locator('.zj-feedback-banner').textContent())?.includes('站点已确认'));

      // Tab B 读到 version 1
      await tabB.page.goto(baseUrl, { waitUntil: 'networkidle' });
      const cardB = tabB.page.locator('.zj-desktop-card[aria-label="晴风智造"]');
      await cardB.waitFor();

      // Tab A 登记一面（D1 推进到 version 2）
      const cardA = tabA.page.locator('.zj-desktop-card[aria-label="晴风智造"]');
      await cardA.getByRole('button', { name: /更多操作/ }).click();
      await tabA.page.getByRole('button', { name: '登记其他进展' }).click();
      const stepDialogA = tabA.page.locator('dialog[open]');
      await stepDialogA.getByLabel('环节类型').selectOption('interview');
      await stepDialogA.getByLabel('面试轮次').selectOption('一面');
      await stepDialogA.getByRole('button', { name: '登记' }).click();
      await cardA.locator('.zj-step-title', { hasText: '一面' }).waitFor();

      const requestsBeforeConflict = commandRequestCount;

      // Tab B 用旧版本发起星标修改 → 真实 Worker 返回明确版本冲突拒绝
      await cardB.locator('button[data-action="toggle-star"][aria-pressed="false"]').click();
      const conflictBannerB = tabB.page.locator('.zj-feedback-banner[data-tone="conflict"]');
      await conflictBannerB.waitFor();
      assert.ok((await conflictBannerB.textContent())?.includes('进展已变更'));

      await tabB.page.waitForTimeout(300);
      assert.equal(commandRequestCount, requestsBeforeConflict + 1, '被真实 Worker 拒绝后不得自动重试');
      assert.equal(
        await cardB.locator('button[data-action="toggle-star"]').getAttribute('aria-pressed'),
        'false',
      );

      // 主动刷新查看：读回最新一面，并保留冲突提示直到关闭
      await conflictBannerB.getByRole('button', { name: '刷新查看' }).click();
      await cardB.locator('.zj-step-title', { hasText: '一面' }).waitFor();
      assert.equal(await conflictBannerB.isVisible(), true);
      await conflictBannerB.getByRole('button', { name: '关闭提示' }).click();
      assert.equal(await conflictBannerB.isVisible(), false);

      // 真实 Worker 非空看板导入明确拒绝（409 targetNotEmpty）
      await tabA.page.getByRole('button', { name: '设置' }).click();
      const settingsA = tabA.page.locator('dialog[open]');
      const [download] = await Promise.all([
        tabA.page.waitForEvent('download'),
        settingsA.getByRole('button', { name: '导出备份' }).click(),
      ]);
      const backupPath = await download.path();
      assert.ok(backupPath);

      const fcPromise = tabA.page.waitForEvent('filechooser');
      await settingsA.getByRole('button', { name: '从文件导入' }).click();
      await (await fcPromise).setFiles(backupPath);
      const importAlert = settingsA.getByRole('alert');
      await importAlert.waitFor();
      assert.ok((await importAlert.textContent())?.includes('已有'));
      await settingsA.getByRole('button', { name: '完成' }).click();

      assert.equal(await countJobsInD1(), 1);
      assert.equal(tabA.errors.length, 0);
      assert.equal(tabB.errors.length, 0);
    } finally {
      await tabA.context.close();
      await tabB.context.close();
    }
  });

  it('D1 实际提交后响应丢失：提示未确认、未自动重复、刷新读回已提交数据且后续操作恢复确认', async () => {
    const { context, page, errors } = await createIsolatedPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: '还没有记录岗位' }).waitFor();

      // 1. 建档命令提交进 D1 后丢弃响应
      dropNextCommandResponse = true;
      await page.getByRole('button', { name: '添加岗位' }).first().click();
      const jobDialog = page.locator('dialog[open]');
      await jobDialog.getByLabel('公司').fill('溯源数据');
      await jobDialog.getByLabel('职位').fill('Go 开发');
      await jobDialog.getByRole('button', { name: '添加' }).click();

      // UI 提示未确认，弹窗保留错误提示且界面不盲目乐观新增卡片
      const dialogAlert = jobDialog.getByRole('alert');
      await dialogAlert.waitFor();
      assert.equal(await dialogAlert.textContent(), '未确认是否保存，请刷新查看');

      const unknownBanner = page.locator('.zj-feedback-banner[data-tone="unknown"]');
      await unknownBanner.waitFor();
      assert.ok((await unknownBanner.textContent())?.includes('未确认是否保存，请刷新查看'));
      assert.equal(await page.locator('.zj-desktop-card').count(), 0);

      // 等待观察确认客户端不会自动重试，且 D1 实际已落库 1 条
      await page.waitForTimeout(400);
      assert.equal(commandRequestCount, 1, '提交后丢失响应不得自动重发 create-job');
      assert.equal(await countJobsInD1(), 1, 'D1 必须已在丢包前实际提交该岗位');

      // 关闭弹窗并点击横幅上的「刷新查看」：从 D1 读回唯一一条「溯源数据」
      await jobDialog.getByRole('button', { name: '取消' }).click();
      await unknownBanner.getByRole('button', { name: '刷新查看' }).click();
      const card = page.locator('.zj-desktop-card[aria-label="溯源数据"]');
      await card.waitFor();
      assert.ok((await card.textContent())?.includes('Go 开发'));
      assert.equal(await page.locator('.zj-desktop-card').count(), 1);
      assert.equal(commandRequestCount, 1);
      assert.equal(await unknownBanner.isVisible(), true);
      await unknownBanner.getByRole('button', { name: '关闭提示' }).click();

      // 2. 登记二面提交进 D1 后再次丢弃响应 → 整页刷新读回 → 正常标已面
      dropNextCommandResponse = true;
      await card.getByRole('button', { name: /更多操作/ }).click();
      await page.getByRole('button', { name: '登记其他进展' }).click();
      const stepDialog = page.locator('dialog[open]');
      await stepDialog.getByLabel('环节类型').selectOption('interview');
      await stepDialog.getByLabel('面试轮次').selectOption('二面');
      await stepDialog.getByLabel('日期（可选）').fill('2026-12-03');
      await stepDialog.getByLabel('时间（可选）').fill('15:00');
      await stepDialog.getByRole('button', { name: '登记' }).click();

      await stepDialog.getByRole('alert').waitFor();
      assert.equal(await stepDialog.getByRole('alert').textContent(), '未确认是否保存，请刷新查看');
      await unknownBanner.waitFor();
      await stepDialog.getByRole('button', { name: '取消' }).click();

      await page.waitForTimeout(300);
      assert.equal(commandRequestCount, 2, '登记进展响应丢失后不得自动重发');

      // 整页刷新：从 D1 读回已实际提交的二面与时间
      await page.reload({ waitUntil: 'networkidle' });
      await card.waitFor();
      await card.locator('.zj-step-title', { hasText: '二面' }).waitFor();
      assert.ok((await card.textContent())?.includes('12月3日 周四 15:00'));

      // 用新读回的版本经直达状态按钮标记二面已面，确认后续请求恢复「站点已确认」
      await card.getByRole('button', { name: '二面已面' }).click();
      const savedBanner = page.locator('.zj-feedback-banner[data-tone="saved"]');
      await savedBanner.waitFor();
      assert.ok((await savedBanner.textContent())?.includes('站点已确认'));
      assert.equal(commandRequestCount, 3);
      assert.equal(await countJobsInD1(), 1);
      assert.equal(errors.length, 0);
    } finally {
      await context.close();
    }
  });
});
