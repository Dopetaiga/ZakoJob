/** 由岗位记录直接推导的信息：最新进展、跟进状态与列表排序。 */

import type { FlowNode, Job } from './types.ts';

/** 最新进展取自最后登记的流程节点；仅收藏时为 null。 */
export function getLatestFlowNode(job: Job): FlowNode | null {
  return job.flow.at(-1) ?? null;
}

/** 是否仍在跟进：结果为空即跟进中，登记「已挂 / 已拒」后结束，清除结果后恢复。 */
export function isFollowingUp(job: Job): boolean {
  return job.outcome === null;
}

/** 星标岗位优先展示；同组沿用调用方传入的顺序（稳定排序），不产生新的比较规则。 */
export function orderJobList(jobs: readonly Job[]): Job[] {
  const starred: Job[] = [];
  const normal: Job[] = [];
  for (const job of jobs) {
    (job.starred ? starred : normal).push(job);
  }
  return [...starred, ...normal];
}
