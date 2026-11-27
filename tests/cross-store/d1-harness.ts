/**
 * D1/Sites 腿的隔离运行环境。
 *
 * 用 esbuild 把 worker/test-entry.ts（测试专用入口）打包为单文件 ESM，
 * Miniflare 以独立 SQLite 实例承载 D1 绑定；身份头由测试替身注入
 * （生产环境由站点平台注入）。Sites HTTP 客户端（src/sites/client.ts）
 * 经注入 fetch 指向该实例，得到实现 JobBoardStore 契约的第二个适配器。
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { Miniflare } from 'miniflare';
import { createSitesJobBoard } from '../../src/sites/client.ts';
import type { JobBoardStore } from '../../src/data/index.ts';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OWNER_USER_ID = 'qa-cross-store-owner';

export interface D1WorkerHandle {
  /** 以所有者身份创建 Sites HTTP 客户端（每个客户端是独立句柄）。 */
  createOwnerStore(options?: { faultDropResponse?: boolean }): Promise<JobBoardStore>;
  /** 以其他身份创建客户端：数据路径应被明确拒绝。 */
  createForeignStore(): Promise<JobBoardStore>;
  close: () => Promise<void>;
}

/** 打包测试 worker 并启动隔离 Miniflare 实例。 */
export async function startD1Worker(): Promise<D1WorkerHandle> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zk-cross-store-'));
  const bundlePath = path.join(workDir, 'worker.mjs');
  await esbuild.build({
    entryPoints: [path.join(ROOT_DIR, 'worker', 'test-entry.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile: bundlePath,
    logLevel: 'silent',
  });

  const mf = new Miniflare({
    modules: true,
    // 直接注入打包产物内容：Windows 下 workerd 对临时目录的 scriptPath
    // 模块解析会报「can't use .. to break out of starting directory」。
    script: await fs.readFile(bundlePath, 'utf8'),
    compatibilityDate: '2026-07-30',
    bindings: { OWNER_USER_ID },
    d1Databases: ['DB'],
  });

  const dispatch = mf.dispatchFetch.bind(mf);

  function ownerFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    // 生产由站点平台注入可信身份头；测试替身在此等价注入
    const headers = new Headers(init?.headers);
    headers.set('oai-authenticated-user-id', OWNER_USER_ID);
    return dispatch(input as string, { ...init, headers } as never) as unknown as Promise<Response>;
  }

  function foreignFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set('oai-authenticated-user-id', 'somebody-else');
    return dispatch(input as string, { ...init, headers } as never) as unknown as Promise<Response>;
  }

  return {
    async createOwnerStore(options = {}) {
      let doFetch: typeof fetch = ownerFetch;
      if (options.faultDropResponse) {
        // 测试标记：命令已提交但掐断响应（worker/test-entry.ts 提供的故障模拟）
        doFetch = (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set('x-zk-test-fault-drop-response', '1');
          return ownerFetch(input, { ...init, headers });
        };
      }
      return createSitesJobBoard({
        apiBaseUrl: 'http://d1-instance.test/',
        fetch: doFetch,
      });
    },

    async createForeignStore() {
      return createSitesJobBoard({
        apiBaseUrl: 'http://d1-instance.test/',
        fetch: foreignFetch,
      });
    },

    async close() {
      await mf.dispose();
      await fs.rm(workDir, { recursive: true, force: true });
    },
  };
}
