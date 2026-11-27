/**
 * 浏览器端测试台：在真实 Edge + 真实 IndexedDB 上运行共享契约场景。
 *
 * Node 侧（cross-store.test.ts）通过 window.__zjCrossStore 驱动：
 * 每个入口都在当前页面新开独立的存储句柄（独立 IndexedDB 连接），
 * 指向指定数据库，保证场景间的读写互不缓存。
 */

import { createIndexedDbJobBoard } from '../../src/data/indexeddb/store.ts';
import type { JobBoardStore } from '../../src/data/index.ts';
import type { Job } from '../../src/domain/index.ts';
import { runStoreScenarios, type ScenarioResult } from './scenarios.ts';
import {
  createSessionMarkerJob,
  importAndVerifyRestored,
  prepareFictionalDataset,
  verifyBackupShape,
  verifyEndedNonEmptyTarget,
  verifySessionContinues,
  type RestoreVerification,
} from './fictional-data.ts';

interface HarnessApi {
  /** 在指定数据库上运行全部存储级契约场景。 */
  runScenarios(databaseName: string): Promise<{ results: ScenarioResult[]; allOk: boolean }>;
  /** 写入虚构数据集 + 新会话标记岗位，导出一致快照并核对备份结构。 */
  prepareAndExport(
    databaseName: string,
  ): Promise<{ backup: unknown; sourceJobs: Job[]; backupEvidence: Record<string, unknown> }>;
  /** 在全新数据库上恢复备份并完成收尾核验（清结果、撤末步、非空拒绝）。 */
  importAndVerify(
    databaseName: string,
    backupJson: string,
  ): Promise<RestoreVerification>;
  /** 已结束非空目标：把一条已结束岗位写入指定数据库，再尝试导入备份。 */
  endedNonEmptyTarget(
    databaseName: string,
    backupJson: string,
  ): Promise<void>;
  /** 新会话续用：全新句柄读取并继续提交上一会话的岗位。 */
  verifySession(databaseName: string): Promise<Record<string, unknown>>;
}

async function openStore(databaseName: string): Promise<JobBoardStore> {
  return createIndexedDbJobBoard({ databaseName });
}

const api: HarnessApi = {
  async runScenarios(databaseName) {
    return runStoreScenarios({ openStore: () => openStore(databaseName) });
  },

  async prepareAndExport(databaseName) {
    const store = await openStore(databaseName);
    const sourceJobs = await prepareFictionalDataset(store);
    const exported = await store.exportSnapshot();
    if (!exported.ok) {
      throw new Error(`导出快照失败：${exported.failure.message}`);
    }
    const backupEvidence = verifyBackupShape(exported.backup, sourceJobs);
    // 新会话标记岗位在导出之后写入，不进入备份
    await createSessionMarkerJob(store);
    // 序列化往返：备份必须能以纯 JSON 离开浏览器（契约要求）
    return {
      backup: JSON.parse(JSON.stringify(exported.backup)),
      sourceJobs: JSON.parse(JSON.stringify(sourceJobs)),
      backupEvidence,
    };
  },

  async importAndVerify(databaseName, backupJson) {
    const store = await openStore(databaseName);
    return importAndVerifyRestored(store, JSON.parse(backupJson));
  },

  async endedNonEmptyTarget(databaseName, backupJson) {
    const store = await openStore(databaseName);
    return verifyEndedNonEmptyTarget(store, JSON.parse(backupJson));
  },

  async verifySession(databaseName) {
    const store = await openStore(databaseName);
    return verifySessionContinues(store);
  },
};

declare global {
  interface Window {
    __zjCrossStore: HarnessApi;
  }
}

window.__zjCrossStore = api;
document.getElementById('harness')!.textContent = '跨存储测试台就绪';
