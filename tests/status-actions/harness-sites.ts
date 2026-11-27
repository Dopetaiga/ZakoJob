/**
 * Sites 腿测试台：真实 Sites 构建正式前端 + Miniflare 隔离 D1 Worker + 本地反代，
 * 可注入「提交后丢响应」故障并统计写命令数（复用 worker/test-entry.ts 测试专用入口）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { Miniflare } from 'miniflare';
import { build } from 'vite';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const OWNER_ID = 'status-actions-owner-001';

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

export interface SitesBoard {
  baseUrl: string;
  newPage(viewport?: { width: number; height: number }): Promise<{
    context: Awaited<ReturnType<Browser['newContext']>>;
    page: Page;
    errors: string[];
  }>;
  commandRequestCount(): number;
  /** 让下一次写命令在 D1 实际提交后丢响应（模拟未确认）。 */
  dropNextCommandResponse(): void;
  countJobsInD1(): Promise<number>;
  resetD1(): Promise<void>;
  close(): Promise<void>;
}

async function readIncomingBody(req: http.IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const buf = Buffer.concat(chunks);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export async function startSitesBoard(): Promise<SitesBoard> {
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'zako-status-actions-sites-'));
  const clientDir = path.join(tempDir, 'client');
  const workerDir = path.join(tempDir, 'server');

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

  const mf = new Miniflare({
    modules: true,
    modulesRoot: workerDir,
    scriptPath: path.join(workerDir, 'index.js'),
    compatibilityDate: '2025-05-01',
    d1Databases: { DB: 'zako-status-actions-db' },
    d1Persist: path.join(tempDir, 'd1'),
    bindings: { OWNER_USER_ID: OWNER_ID },
  });

  let commandCount = 0;
  let dropNext = false;

  const proxyServer = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (reqUrl.pathname.startsWith('/api/')) {
        const isCommandPost =
          req.method === 'POST' && reqUrl.pathname === '/api/board/commands';
        if (isCommandPost) commandCount += 1;

        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value === undefined) continue;
          if (Array.isArray(value)) {
            for (const item of value) headers.append(key, item);
          } else {
            headers.set(key, value);
          }
        }
        headers.set('oai-authenticated-user-id', OWNER_ID);
        if (isCommandPost && dropNext) {
          dropNext = false;
          headers.set('x-zk-test-fault-drop-response', '1');
        }

        const bodyBytes = await readIncomingBody(req);
        const workerUrl = `${proxyBaseUrl.replace(/\/$/, '')}${reqUrl.pathname}${reqUrl.search}`;
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
          // D1 实际提交后切断 HTTP 连接，模拟丢失响应
          res.destroy();
        }
        return;
      }

      const relPath =
        reqUrl.pathname === '/' ? 'index.html' : decodeURIComponent(reqUrl.pathname).replace(/^\/+/, '');
      const resolved = path.resolve(clientDir, relPath);
      if (!resolved.startsWith(clientDir + path.sep) && resolved !== path.join(clientDir, 'index.html')) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const stat = await fs.stat(resolved).catch(() => null);
      const filePath = stat?.isFile() ? resolved : path.join(clientDir, 'index.html');
      const content = await fs.readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
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
  const proxyBaseUrl = `http://127.0.0.1:${addr.port}/`;

  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  // 触发一次健康检查确保 D1 迁移在首个用例前已就绪（与既有 sites-workspace 一致）
  const healthRes = await mf.dispatchFetch(`${proxyBaseUrl}api/board/health`, {
    headers: { 'oai-authenticated-user-id': OWNER_ID },
  });
  assert.equal(healthRes.status, 204);

  return {
    baseUrl: proxyBaseUrl,
    async newPage(viewport = { width: 1280, height: 860 }) {
      const context = await browser.newContext({ viewport, acceptDownloads: true });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(proxyBaseUrl, { waitUntil: 'networkidle' });
      return { context, page, errors };
    },
    commandRequestCount: () => commandCount,
    dropNextCommandResponse: () => {
      dropNext = true;
    },
    async countJobsInD1() {
      const db = await mf.getD1Database('DB');
      const row = await db.prepare('SELECT COUNT(*) AS cnt FROM jobs').first<{ cnt: number }>();
      return Number(row?.cnt ?? 0);
    },
    async resetD1() {
      commandCount = 0;
      dropNext = false;
      const db = await mf.getD1Database('DB');
      await db.batch([
        db.prepare('DELETE FROM jobs'),
        db.prepare('DELETE FROM preferences'),
        db.prepare('DELETE FROM completed_imports'),
      ]);
    },
    async close() {
      await browser?.close();
      await new Promise<void>((resolve) => {
        proxyServer.close(() => resolve());
      });
      await mf.dispose();
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}
