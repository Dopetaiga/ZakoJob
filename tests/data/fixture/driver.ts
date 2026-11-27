/**
 * IndexedDB 适配器验证台驱动。
 *
 * 每个测试通过 URL 参数隔离：
 * - `db=<名称>`：独立的数据库，避免用例互相残留；
 * - `faultImport=1`：在导入写事务提交前注入一次失败，模拟事务中止；
 * - `entry=1`：改用公开入口 openJobBoard() 创建适配器，验证默认选择 IndexedDB。
 */

import { openJobBoard } from '../../../src/data/index.ts';
import {
  createIndexedDbJobBoard,
  type IndexedDbStoreOptions,
} from '../../../src/data/indexeddb/store.ts';
import type { JobCommand, PreferencesPatch } from '../../../src/data/index.ts';

const params = new URLSearchParams(document.location.search);
const databaseName = params.get('db') ?? undefined;

const options: IndexedDbStoreOptions = { databaseName: databaseName ?? undefined };
if (params.get('faultImport') === '1') {
  options.hooks = {
    onImportWrite() {
      throw new Error('模拟导入写入中途失败');
    },
  };
}

const storePromise =
  params.get('entry') === '1' ? openJobBoard() : createIndexedDbJobBoard(options);

const api = {
  mode: async () => (await storePromise).mode,
  list: async () => (await storePromise).listJobs(),
  get: async (jobId: string) => (await storePromise).getJob(jobId),
  command: async (command: JobCommand) => (await storePromise).submitJobCommand(command),
  prefs: async () => (await storePromise).getPreferences(),
  savePrefs: async (patch: PreferencesPatch) => (await storePromise).savePreferences(patch),
  export: async () => (await storePromise).exportSnapshot(),
  import: async (parsed: unknown) => (await storePromise).importBackup(parsed),
};

declare global {
  interface Window {
    __board: typeof api;
  }
}

window.__board = api;

export {};
