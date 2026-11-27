/**
 * IndexedDB 本地存储适配器。
 *
 * 开源静态版默认使用本适配器：无需账号与业务后端，
 * 在同一浏览器配置、同一站点来源持久保存岗位与偏好，断网时仍可写。
 *
 * 事务规则：
 * - 岗位命令在一个 `readwrite` 事务内核对版本、应用领域动作并更新记录，
 *   以事务完成为成功；事务中止返回失败，读回值仍是先前已提交的数据。
 * - 偏好按补丁只写提供的范围，保留其他范围。
 * - 导出用同一个跨对象存储的只读事务读取全部岗位与偏好，得到一致快照。
 * - 导入在一次读写事务内完成空板断言、岗位插入与偏好替换；任一步失败整体回滚。
 */

import type { Job, JobId } from '../../domain/index.ts';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  defaultBoardPreferences,
  type BackupIssue,
  type BackupFile,
  type BoardPreferences,
  type CommandOutcome,
  type ExportOutcome,
  type ImportOutcome,
  type JobBoardStore,
  type JobCommand,
  type PreferencesOutcome,
  type PreferencesPatch,
  type ReadResult,
  type StorageReadFailure,
} from '../contract.ts';
import { decodeBackup } from '../backup.ts';
import { validatePreferencesPatch } from '../preferences.ts';
import {
  commandValidationFailure,
  dispatchCreateJobCommand,
  dispatchJobCommand,
  validateJobCommand,
} from '../commands.ts';

/** 缺省数据库名：独立于旧原型数据，应用回退时保留已写数据。 */
export const BOARD_DATABASE_NAME = 'zakoujob-board';
const DATABASE_VERSION = 1;
const JOBS_STORE = 'jobs';
const PREFERENCES_STORE = 'preferences';
const PREFERENCES_KEY = 'board';

/** 适配器选项：测试可注入独立的数据库工厂与库名（专属浏览器 fixture 亦复用）。 */
export interface IndexedDbStoreOptions {
  indexedDB?: IDBFactory;
  databaseName?: string;
  /**
   * 仅测试使用：在导入写事务内、提交前注入一次失败，
   * 用于验证「写入中途失败时目标保持导入前的状态」。
   */
  hooks?: { onImportWrite?: () => void };
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败。'));
  });
}

function openDatabase(options: IndexedDbStoreOptions): Promise<IDBDatabase> {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) {
    return Promise.reject(new Error('当前环境不支持 IndexedDB。'));
  }
  return new Promise((resolve, reject) => {
    const request = factory.open(options.databaseName ?? BOARD_DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(JOBS_STORE)) {
        database.createObjectStore(JOBS_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(PREFERENCES_STORE)) {
        database.createObjectStore(PREFERENCES_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库。'));
  });
}

/** 打开失败或环境不支持时返回的读取失败。 */
function unavailable(message: string): StorageReadFailure {
  return { reason: 'unavailable', message };
}

function readFailureFrom(error: unknown): StorageReadFailure {
  const message = error instanceof Error ? error.message : String(error);
  return unavailable(message);
}

/**
 * 创建 IndexedDB 适配器。返回的 store 实现统一契约；
 * 首次打开仅建立对象存储结构，岗位与偏好均为空。
 */
export async function createIndexedDbJobBoard(
  options: IndexedDbStoreOptions = {},
): Promise<JobBoardStore> {
  const database = await openDatabase(options);

  const readJobs = async (store: IDBObjectStore): Promise<readonly Job[]> => {
    const rows = await promisifyRequest(store.getAll() as IDBRequest<Job[]>);
    return rows;
  };

  async function runTransaction<T>(
    stores: readonly string[],
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const tx = database.transaction([...stores], mode);
    const finished = new Promise<DOMException | null>((resolve) => {
      tx.oncomplete = () => resolve(null);
      tx.onabort = () => resolve(tx.error ?? new DOMException('IndexedDB 事务已中止。', 'AbortError'));
    });
    try {
      const result = await body(tx);
      const error = await finished;
      if (error) throw error;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // The browser may already have aborted the transaction.
      }
      await finished;
      throw error;
    }
  }

  const store = {
    mode: 'indexeddb' as const,

    async listJobs(): Promise<ReadResult<readonly Job[]>> {
      try {
        const jobs = await runTransaction([JOBS_STORE], 'readonly', (tx) => readJobs(tx.objectStore(JOBS_STORE)));
        return { ok: true, value: jobs };
      } catch (error) {
        return { ok: false, failure: readFailureFrom(error) };
      }
    },

    async getJob(jobId: JobId): Promise<ReadResult<Job | null>> {
      try {
        const job = await runTransaction([JOBS_STORE], 'readonly', async (tx) => {
          const found = await promisifyRequest(
            tx.objectStore(JOBS_STORE).get(jobId) as IDBRequest<Job | undefined>,
          );
          return found ?? null;
        });
        return { ok: true, value: job };
      } catch (error) {
        return { ok: false, failure: readFailureFrom(error) };
      }
    },

    async submitJobCommand(command: JobCommand): Promise<CommandOutcome> {
      const validationMessage = validateJobCommand(command);
      if (validationMessage) {
        return { status: 'rejected', failure: commandValidationFailure(validationMessage) };
      }
      try {
        if (command.kind === 'create-job') {
          return await runTransaction<CommandOutcome>([JOBS_STORE], 'readwrite', async (tx) => {
            const jobs = tx.objectStore(JOBS_STORE);
            const existing = await promisifyRequest(
              jobs.get(command.jobId) as IDBRequest<Job | undefined>,
            );
            if (existing) {
              return { status: 'rejected', failure: { reason: 'versionConflict' } };
            }
            const created = dispatchCreateJobCommand(command);
            if (!created.ok) {
              return { status: 'rejected', failure: created.failure };
            }
            // 稳定 ID 插入且禁止覆盖同 ID 记录。
            await promisifyRequest(jobs.add(created.job));
            return { status: 'confirmed', job: created.job };
          });
        }

        return await runTransaction<CommandOutcome>([JOBS_STORE], 'readwrite', async (tx) => {
          const jobs = tx.objectStore(JOBS_STORE);
          const current = await promisifyRequest(
            jobs.get(command.jobId) as IDBRequest<Job | undefined>,
          );
          if (!current) {
            return {
              status: 'rejected',
              failure: {
                reason: 'invalidInput',
                message: `岗位「${command.jobId}」不存在，可能已被删除或属于另一浏览器。`,
              },
            };
          }
          const applied = dispatchJobCommand(current, command);
          if (!applied.ok) {
            return { status: 'rejected', failure: applied.failure };
          }
          await promisifyRequest(jobs.put(applied.job));
          return { status: 'confirmed', job: applied.job };
        });
      } catch (error) {
        return { status: 'failed', message: readFailureMessage(error) };
      }
    },

    async getPreferences(): Promise<ReadResult<BoardPreferences>> {
      try {
        const stored = await runTransaction([PREFERENCES_STORE], 'readonly', async (tx) => {
          return await promisifyRequest(
            tx.objectStore(PREFERENCES_STORE).get(PREFERENCES_KEY) as IDBRequest<
              BoardPreferences | undefined
            >,
          );
        });
        if (!stored) {
          return { ok: true, value: defaultBoardPreferences() };
        }
        return { ok: true, value: stored };
      } catch (error) {
        return { ok: false, failure: readFailureFrom(error) };
      }
    },

    async savePreferences(patch: PreferencesPatch): Promise<PreferencesOutcome> {
      const parsed = validatePreferencesPatch(patch);
      if (!parsed.ok) {
        return {
          status: 'rejected',
          failure: {
            reason: 'invalidPreferences',
            message: parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('；'),
          },
        };
      }
      try {
        return await runTransaction<PreferencesOutcome>([PREFERENCES_STORE], 'readwrite', async (tx) => {
          const preferencesStore = tx.objectStore(PREFERENCES_STORE);
          const current = await promisifyRequest(
            preferencesStore.get(PREFERENCES_KEY) as IDBRequest<BoardPreferences | undefined>,
          );
          const base = current ?? defaultBoardPreferences();
          // 只写补丁提供的范围，其他范围保持不变。
          const next: BoardPreferences = {
            shared: parsed.patch.shared ?? base.shared,
            mobile: parsed.patch.mobile ?? base.mobile,
            desktop: parsed.patch.desktop ?? base.desktop,
          };
          await promisifyRequest(preferencesStore.put(next, PREFERENCES_KEY));
          return { status: 'confirmed', preferences: next };
        });
      } catch (error) {
        return { status: 'failed', message: readFailureMessage(error) };
      }
    },

    async exportSnapshot(): Promise<ExportOutcome> {
      try {
        // 同一只读事务跨两个对象存储：岗位与偏好来自同一时点。
        const snapshot = await runTransaction([JOBS_STORE, PREFERENCES_STORE], 'readonly', async (tx) => {
          const jobs = await readJobs(tx.objectStore(JOBS_STORE));
          const preferences = await promisifyRequest(
            tx.objectStore(PREFERENCES_STORE).get(PREFERENCES_KEY) as IDBRequest<
              BoardPreferences | undefined
            >,
          );
          return { jobs, preferences };
        });
        return {
          ok: true,
          backup: {
            format: BACKUP_FORMAT,
            version: BACKUP_VERSION,
            applications: snapshot.jobs,
            preferences: snapshot.preferences ?? defaultBoardPreferences(),
          },
        };
      } catch (error) {
        return { ok: false, failure: readFailureFrom(error) };
      }
    },

    async importBackup(parsed: unknown): Promise<ImportOutcome> {
      // 第一步：整包校验，目标尚未写入。
      const decoded: ReturnType<typeof decodeBackup> = decodeBackup(parsed);
      if (!decoded.ok) {
        return { status: 'rejected', reason: 'invalidBackup', issues: decoded.issues };
      }
      const backup: BackupFile = decoded.backup;
      // 第二步：一次读写事务内完成空板断言、岗位插入与偏好替换。
      try {
        return await runTransaction<ImportOutcome>([JOBS_STORE, PREFERENCES_STORE], 'readwrite', async (tx) => {
          const jobs = tx.objectStore(JOBS_STORE);
          const count = await promisifyRequest(jobs.count());
          if (count > 0) {
            return {
              status: 'rejected',
              reason: 'targetNotEmpty',
              message: `目标看板已有 ${count} 份岗位（含已结束），仅可恢复到空看板。`,
            };
          }
          const preferencesStore = tx.objectStore(PREFERENCES_STORE);
          await promisifyRequest(preferencesStore.put(backup.preferences, PREFERENCES_KEY));
          for (const job of backup.applications) {
            await promisifyRequest(jobs.add(job));
          }
          if (options.hooks?.onImportWrite) {
            options.hooks.onImportWrite();
          }
          return { status: 'confirmed' };
        });
      } catch (error) {
        return { status: 'failed', message: readFailureMessage(error) };
      }
    },
  } satisfies JobBoardStore;
  return store;
}

function readFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 供类型检查引用的工具类型：备份校验问题列表。 */
export type { BackupIssue };
