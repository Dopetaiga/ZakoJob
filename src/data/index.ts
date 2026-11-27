/**
 * 数据层唯一公开入口。
 *
 * 前端从 `openJobBoard()` 获得实现统一契约的存储适配器：
 * 开源静态构建（缺省模式）选择 IndexedDB 本地存储；
 * Sites 构建（`--mode sites`）选择同源站点 API 的 HTTP 适配器。
 * 选择在启动入口完成，云端依赖被隔离在对应模块内，
 * 静态产物不发起任何业务 API 请求。
 *
 * 契约与可复用核心也在本入口导出，供 Sites/D1 会话与前端共同引用。
 */

import type { JobBoardStore } from './contract.ts';

export type {
  BackupDecodeResult,
  BackupFile,
  BackupIssue,
  BoardLayout,
  BoardModuleId,
  BoardModulePlacement,
  BoardPreferences,
  CommandOutcome,
  DeviceLayoutOverride,
  ExportOutcome,
  ImportOutcome,
  JobBoardStore,
  JobCommand,
  LogStepPayload,
  PreferenceScope,
  PreferencesOutcome,
  PreferencesPatch,
  ReadResult,
  StorageReadFailure,
  SitesJobBoardOptions,
  UpdateStepPayload,
} from './contract.ts';
export {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BOARD_MODULE_IDS,
  PREFERENCE_SCOPES,
  defaultBoardPreferences,
} from './contract.ts';

export type { IndexedDbStoreOptions } from './indexeddb/store.ts';
export { BOARD_DATABASE_NAME, createIndexedDbJobBoard } from './indexeddb/store.ts';

export {
  commandValidationFailure,
  dispatchCreateJobCommand,
  dispatchJobCommand,
  validateJobCommand,
} from './commands.ts';

export { decodeBackup, encodeBackup } from './backup.ts';
export type {
  PreferencesPatchParseResult,
  PreferencesParseResult,
} from './preferences.ts';
export { validatePreferences, validatePreferencesPatch } from './preferences.ts';

/** 打开当前构建对应的看板存储；页面只在启动时调用一次。 */
export async function openJobBoard(): Promise<JobBoardStore> {
  if (import.meta.env.MODE === 'sites') {
    const { createSitesJobBoard } = await import('../sites/client.ts');
    return createSitesJobBoard({ apiBaseUrl: '' });
  }
  // 开源静态构建：默认本地 IndexedDB，无需业务后端。
  const { createIndexedDbJobBoard } = await import('./indexeddb/store.ts');
  return createIndexedDbJobBoard();
}
