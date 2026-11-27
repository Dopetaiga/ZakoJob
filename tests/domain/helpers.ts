/** 测试共用替身：确定性 ID 工厂与内存条件写入存储。 */

import type { Job } from '../../src/domain/index.ts';

/** 确定性 ID 工厂：按调用次序生成 `前缀-序号`，便于测试回读与断言。 */
export function createTestIdFactory(prefix: string): () => string {
  let sequence = 0;
  return () => `${prefix}-${(sequence += 1)}`;
}

function cloneJob(job: Job): Job {
  return {
    id: job.id,
    profile: { ...job.profile },
    starred: job.starred,
    flow: job.flow.map((node) => ({ ...node })),
    outcome: job.outcome ? { ...job.outcome } : null,
    version: job.version,
  };
}

export type SaveResult =
  | { ok: true; job: Job }
  | { ok: false; reason: 'versionConflict'; currentVersion: number };

/**
 * 内存测试替身：模拟「以读取时的版本为条件原子提交」的保存方。
 * 版本已变化时拒绝写入，用于验证并发交错下领域动作与保存方的契约。
 */
export class InMemoryJobStore {
  private readonly records = new Map<string, Job>();

  /** 无条件放入初始记录，模拟刚建档后的状态。 */
  put(job: Job): void {
    this.records.set(job.id, cloneJob(job));
  }

  read(id: string): Job | null {
    const record = this.records.get(id);
    return record ? cloneJob(record) : null;
  }

  /** 条件提交：存储中的版本等于 expectedVersion 才接受，否则返回冲突与当前版本。 */
  save(job: Job, expectedVersion: number): SaveResult {
    const current = this.records.get(job.id);
    if (!current || current.version !== expectedVersion) {
      return {
        ok: false,
        reason: 'versionConflict',
        currentVersion: current?.version ?? -1,
      };
    }
    this.records.set(job.id, cloneJob(job));
    return { ok: true, job: cloneJob(job) };
  }
}
