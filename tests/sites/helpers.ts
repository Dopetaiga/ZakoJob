/**
 * Sites/D1 隔离测试公共设施。
 *
 * 每个用例文件通过 Miniflare 4（cf:false，禁用不需要的 Workers API 模拟）
 * 启动互相隔离的实例：独立 D1 持久化目录、独立 OWNER_USER_ID。
 * 每个进程使用独立临时目录构建与持久化，避免多进程写同一路径；
 * 所有请求经 mf.ready 的 URL 用真实 fetch 发送。
 * 隔离测试专用 worker（worker/test-entry.ts）在实例内部应用迁移与故障模拟，
 * 生产入口不携带这些行为。
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { Miniflare } from 'miniflare';
import type { JobBoardStore } from '../../src/data/contract.ts';

export const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 独立临时目录：每个测试进程一套，位于仓库内已被 gitignore 的
 * test-results/sites（与 workerd 启动目录同盘，避免 kj/filesystem
 * 无法用 ".." 跨出起始目录），父目录递归创建，进程退出时清理。
 */
const scratch = path.join(testRoot, 'test-results', 'sites');
mkdirSync(scratch, { recursive: true });
export const tmpDir = mkdtempSync(path.join(scratch, 'run-'));

process.on('exit', () => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // 进程退出时清理尽力而为。
  }
});

let bundlePromise: Promise<string> | null = null;

/** 用 vite 的 SSR 构建把 worker/test-entry.ts 打包成单文件 worker。 */
export function buildTestWorker(): Promise<string> {
  bundlePromise ??= (async () => {
    await build({
      root: testRoot,
      logLevel: 'warn',
      build: {
        ssr: path.join(testRoot, 'worker/test-entry.ts'),
        outDir: tmpDir,
        emptyOutDir: false,
        rollupOptions: { output: { entryFileNames: 'test-worker.mjs' } },
      },
    });
    return path.join(tmpDir, 'test-worker.mjs');
  })();
  return bundlePromise;
}

export interface BoardInstance {
  mf: Miniflare;
  /** 实例就绪后的基址（mf.ready 的 URL）。 */
  baseUrl: string;
  ownerId: string;
  close(): Promise<void>;
}

/** 启动一个隔离实例：独立 D1 目录与所有者，实例内部执行迁移。 */
export async function createBoardInstance(options: {
  name: string;
  ownerId: string;
}): Promise<BoardInstance> {
  const scriptPath = await buildTestWorker();
  const mf = new Miniflare({
    scriptPath,
    modules: true,
    compatibilityDate: '2026-05-15',
    cf: false,
    d1Databases: { DB: `board-${options.name}` },
    d1Persist: path.join(tmpDir, 'd1', options.name),
    bindings: { OWNER_USER_ID: options.ownerId },
  });
  const ready = await mf.ready;
  return {
    mf,
    baseUrl: ready.href.replace(/\/$/, ''),
    ownerId: options.ownerId,
    close: () => mf.dispose(),
  };
}

/**
 * 平台身份注入：真实 Sites 会在请求到达 worker 前注入可信身份头；
 * 测试通过包装 fetch 模拟这一层。
 */
export function fetchAs(
  baseUrl: string,
  ownerId: string | null,
): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' && input.startsWith('/')
      ? `${baseUrl}${input}`
      : input;
    const headers = new Headers(init?.headers);
    if (ownerId !== null) {
      headers.set('oai-authenticated-user-id', ownerId);
    }
    return fetch(url, { ...init, headers });
  };
}

/** 用与生产等价的路径创建站点客户端；身份注入由 fetchAs 提供。 */
export async function createClient(
  instance: BoardInstance,
  ownerId: string | null,
): Promise<JobBoardStore> {
  const { createSitesJobBoard } = await import('../../src/sites/client.ts');
  return createSitesJobBoard({
    apiBaseUrl: instance.baseUrl,
    fetch: fetchAs(instance.baseUrl, ownerId),
  });
}

/** 便捷命令构造：登记一条新岗位。 */
export function createJobCommand(jobId: string, input: { postingUrl?: string; company?: string; position?: string }) {
  return { kind: 'create-job', jobId, input } as const;
}

export function logStepCommand(
  jobId: string,
  expectedVersion: number,
  nodeId: string,
  step: Record<string, unknown>,
) {
  return { kind: 'log-step', jobId, expectedVersion, nodeId, step } as const;
}
