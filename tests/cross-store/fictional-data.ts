/**
 * persist-job-data 4.2 的虚构岗位数据集与往返核验。
 *
 * 三份虚构岗位同时覆盖：客户端生成的稳定岗位/节点 ID、首条即二面、
 * 仅日期与精确时刻两种期限精度、已拒（本人拒绝）结果、星标，
 * 以及手机/桌面独立的开始页布局偏好。数据构建与核验只经由
 * JobBoardStore 公开契约，不触碰任何适配器内部。
 */

import {
  type BackupFile,
  type BoardPreferences,
  type JobBoardStore,
} from '../../src/data/index.ts';
import type { FlowNode, Job } from '../../src/domain/index.ts';
import {
  assertDeepEqual,
  assertEqual,
  assertTrue,
} from './store-assert.ts';

/** 虚构数据集使用的稳定标识（唯一、可读、跨适配器往返后必须原样保留）。 */
export const FICTIONAL = {
  qinghe: {
    jobId: 'qa-fic-job-qinghe',
    applied: 'qa-fic-node-qh-applied',
    first: 'qa-fic-node-qh-first',
    second: 'qa-fic-node-qh-second',
  },
  shiguang: {
    jobId: 'qa-fic-job-shiguang',
    oc: 'qa-fic-node-sg-oc',
    offer: 'qa-fic-node-sg-offer',
  },
  northstar: {
    jobId: 'qa-fic-job-northstar',
    assessment: 'qa-fic-node-ns-assessment',
    interview: 'qa-fic-node-ns-interview',
  },
  sessionJobId: 'qa-fic-job-newsession',
} as const;

/** 手机覆盖布局：近期安排在前。 */
export const MOBILE_LAYOUT = {
  modules: [
    { id: 'schedule', visible: true },
    { id: 'jobs', visible: true },
  ],
} as const;

/** 桌面覆盖布局：岗位进展在前且隐藏近期安排（与共用布局可区分）。 */
export const DESKTOP_LAYOUT = {
  modules: [
    { id: 'jobs', visible: true },
    { id: 'schedule', visible: false },
  ],
} as const;

/** 期望的完整偏好（写入虚构数据集后的目标状态）。 */
export function expectedDatasetPreferences(): BoardPreferences {
  return {
    shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
    mobile: { overridden: true, layout: MOBILE_LAYOUT },
    desktop: { overridden: true, layout: DESKTOP_LAYOUT },
  };
}

/** 在空看板上用公开契约写入全部虚构岗位与偏好，返回写入后的岗位快照。 */
export async function prepareFictionalDataset(store: JobBoardStore): Promise<readonly Job[]> {
  const submit = store.submitJobCommand.bind(store);

  // 青禾科技：已投递 → 一面已面（精确时刻）→ 二面待面试（精确时刻），星标
  const qh = FICTIONAL.qinghe;
  assertConfirmed(
    await submit({
      kind: 'create-job',
      jobId: qh.jobId,
      input: { company: '青禾科技', position: '后端开发实习生', postingUrl: 'https://jobs.example.com/p/42' },
    }),
    '建档 青禾科技',
  );
  assertConfirmed(
    await submit({
      kind: 'log-step', jobId: qh.jobId, expectedVersion: 1, nodeId: qh.applied, step: { kind: 'applied' },
    }),
    '青禾 登记已投递',
  );
  assertConfirmed(
    await submit({
      kind: 'log-step', jobId: qh.jobId, expectedVersion: 2, nodeId: qh.first,
      step: { kind: 'interview', round: '一面', scheduledAt: { precision: 'datetime', date: '2026-11-24', time: '14:00' } },
    }),
    '青禾 登记一面',
  );
  const second = await submit({
    kind: 'log-step', jobId: qh.jobId, expectedVersion: 3, nodeId: qh.second,
    step: { kind: 'interview', round: '二面', scheduledAt: { precision: 'datetime', date: '2026-11-27', time: '15:00' } },
  });
  assertConfirmed(second, '青禾 登记二面（待面试）');
  assertConfirmed(
    await submit({ kind: 'set-star', jobId: qh.jobId, expectedVersion: 4, starred: true }),
    '青禾 加星',
  );
  // 二面标为已面之外保持待面试；一面改为已面
  assertConfirmed(
    await submit({
      kind: 'update-step', jobId: qh.jobId, expectedVersion: 5, nodeId: qh.first,
      payload: { targetKind: 'interview', patch: { status: 'done' } },
    }),
    '青禾 一面标已面',
  );

  // 拾光数据：OC → 书面 Offer（仅日期答复期限），结果「已拒」（本人拒绝）
  const sg = FICTIONAL.shiguang;
  assertConfirmed(
    await submit({
      kind: 'create-job', jobId: sg.jobId,
      input: { company: '拾光数据', position: '数据工程实习生', salary: '300 元/天' },
    }),
    '建档 拾光数据',
  );
  assertConfirmed(
    await submit({ kind: 'log-step', jobId: sg.jobId, expectedVersion: 1, nodeId: sg.oc, step: { kind: 'oc' } }),
    '拾光 登记 OC',
  );
  assertConfirmed(
    await submit({
      kind: 'log-step', jobId: sg.jobId, expectedVersion: 2, nodeId: sg.offer,
      step: { kind: 'offer', replyDeadline: { precision: 'date', date: '2026-12-05' } },
    }),
    '拾光 登记书面 Offer（仅日期）',
  );
  assertConfirmed(
    await submit({ kind: 'record-outcome', jobId: sg.jobId, expectedVersion: 3, status: 'declinedByUser' }),
    '拾光 登记已拒',
  );

  // Northstar：笔试截止（仅日期、已完成）→ 三面（无时间）
  const ns = FICTIONAL.northstar;
  assertConfirmed(
    await submit({
      kind: 'create-job', jobId: ns.jobId,
      input: { company: 'Northstar Systems', position: 'Platform Software Engineer (New Grad)' },
    }),
    '建档 Northstar',
  );
  assertConfirmed(
    await submit({
      kind: 'log-step', jobId: ns.jobId, expectedVersion: 1, nodeId: ns.assessment,
      step: { kind: 'assessment', deadline: { precision: 'date', date: '2026-11-20' } },
    }),
    'Northstar 登记笔试',
  );
  assertConfirmed(
    await submit({
      kind: 'update-step', jobId: ns.jobId, expectedVersion: 2, nodeId: ns.assessment,
      payload: { targetKind: 'assessment', patch: { completed: true } },
    }),
    'Northstar 笔试标完成',
  );
  assertConfirmed(
    await submit({
      kind: 'log-step', jobId: ns.jobId, expectedVersion: 3, nodeId: ns.interview,
      step: { kind: 'interview', round: '三面' },
    }),
    'Northstar 登记三面',
  );

  // 偏好：共用保持默认顺序，手机与桌面分别覆盖
  const prefs = await store.savePreferences({
    mobile: { overridden: true, layout: MOBILE_LAYOUT },
    desktop: { overridden: true, layout: DESKTOP_LAYOUT },
  });
  assertEqual(prefs.status, 'confirmed', '写入分端偏好应确认');
  assertDeepEqual(prefs.status === 'confirmed' ? prefs.preferences : null, expectedDatasetPreferences(), '写入后的偏好');

  const jobs = await store.listJobs();
  assertTrue(jobs.ok, '读取虚构数据集岗位');
  assertEqual(jobs.ok ? jobs.value.length : -1, 3, '虚构数据集应有 3 份岗位');
  return jobs.ok ? jobs.value : [];
}

/** 新会话场景：写入一条可由后续全新句柄核验的岗位。 */
export async function createSessionMarkerJob(store: JobBoardStore): Promise<void> {
  const created = await store.submitJobCommand({
    kind: 'create-job',
    jobId: FICTIONAL.sessionJobId,
    input: { company: '栖原软件', position: '平台开发工程师' },
  });
  assertConfirmed(created, '新会话标记岗位建档');
  const starred = await store.submitJobCommand({
    kind: 'set-star',
    jobId: FICTIONAL.sessionJobId,
    expectedVersion: 1,
    starred: true,
  });
  assertConfirmed(starred, '新会话标记岗位加星');
}

/** 新会话场景：在全新句柄上读回标记岗位并继续提交命令。 */
export async function verifySessionContinues(store: JobBoardStore): Promise<Record<string, unknown>> {
  const read = await store.getJob(FICTIONAL.sessionJobId);
  assertTrue(read.ok, '新会话读取标记岗位');
  const job = read.ok ? read.value : null;
  assertTrue(job !== null, '新会话应能读到上一会话写入的岗位');
  assertEqual(job?.profile.company, '栖原软件', '新会话读回的公司');
  assertEqual(job?.starred, true, '新会话读回的星标');

  const updated = await store.submitJobCommand({
    kind: 'log-step',
    jobId: FICTIONAL.sessionJobId,
    expectedVersion: job?.version ?? 0,
    nodeId: 'qa-fic-node-newsession-first',
    step: { kind: 'interview', round: '一面', scheduledAt: { precision: 'datetime', date: '2026-12-01', time: '10:00' } },
  });
  assertConfirmed(updated, '新会话继续提交命令');
  return { versionAfter: updated.status === 'confirmed' ? updated.job.version : null };
}

function assertConfirmed(
  outcome: { status: string; job?: Job },
  label: string,
): asserts outcome is { status: 'confirmed'; job: Job } {
  assertEqual(outcome.status, 'confirmed', `${label} 应确认`);
}

/** 在岗位列表中取出指定岗位（不存在即抛错，提供类型收窄）。 */
function requireJob(jobs: readonly Job[], jobId: string, label: string): Job {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) throw new Error(label);
  return job;
}

/** 取出指定位置的指定种类节点（不存在或种类不符即抛错）。 */
function requireNode<K extends FlowNode['kind']>(
  job: Job,
  index: number,
  kind: K,
  label: string,
): Extract<FlowNode, { kind: K }> {
  const node = job.flow[index];
  if (!node || node.kind !== kind) {
    throw new Error(`${label}：期望第 ${index + 1} 个节点为 ${kind}，实际 ${node?.kind ?? '缺失'}`);
  }
  return node as Extract<FlowNode, { kind: K }>;
}

/* ------------------------------------------------------------------ */
/* 导出备份结构核验                                                      */
/* ------------------------------------------------------------------ */

/** 核对导出备份：信封、唯一稳定 ID、完整节点与期限精度、结果与偏好。 */
export function verifyBackupShape(backup: BackupFile, sourceJobs?: readonly Job[]): Record<string, unknown> {
  assertEqual(backup.format, 'zakoujob-backup', '备份格式标识');
  assertEqual(backup.version, 1, '备份版本号');
  assertEqual(backup.applications.length, 3, '备份岗位数量');

  const jobIds = backup.applications.map((j) => j.id);
  assertEqual(new Set(jobIds).size, jobIds.length, '岗位 ID 必须唯一');
  for (const expected of [FICTIONAL.qinghe.jobId, FICTIONAL.shiguang.jobId, FICTIONAL.northstar.jobId]) {
    assertTrue(jobIds.includes(expected), `备份应包含岗位 ${expected}`);
  }

  const nodeIds = backup.applications.flatMap((j) => j.flow.map((n) => n.id));
  assertEqual(new Set(nodeIds).size, nodeIds.length, '节点 ID 必须全局唯一');

  // 青禾：三个节点完整，二面待面试且精确到时刻
  const qinghe = requireJob(backup.applications, FICTIONAL.qinghe.jobId, '备份缺少青禾科技');
  assertEqual(qinghe.flow.length, 3, '青禾节点数量');
  assertEqual(qinghe.flow[0]?.kind, 'applied', '青禾首节点');
  const second = requireNode(qinghe, 2, 'interview', '青禾末节点');
  assertEqual(second.round, '二面', '青禾末节点轮次');
  assertEqual(second.status, 'pending', '青禾二面待面试');
  assertDeepEqual(second.scheduledAt, { precision: 'datetime', date: '2026-11-27', time: '15:00' }, '青禾二面时刻精度');
  assertEqual(qinghe.starred, true, '青禾星标');

  // 拾光：OC + Offer（仅日期）+ 已拒
  const shiguang = requireJob(backup.applications, FICTIONAL.shiguang.jobId, '备份缺少拾光数据');
  const offer = requireNode(shiguang, 1, 'offer', '拾光末节点');
  assertDeepEqual(offer.replyDeadline, { precision: 'date', date: '2026-12-05' }, '拾光答复期限仅日期（不得补 00:00）');
  assertDeepEqual(shiguang.outcome, { status: 'declinedByUser' }, '拾光已拒结果');

  // Northstar：笔试仅日期期限 + 完成状态
  const northstar = requireJob(backup.applications, FICTIONAL.northstar.jobId, '备份缺少 Northstar');
  const assessment = requireNode(northstar, 0, 'assessment', 'Northstar 首节点');
  assertDeepEqual(assessment.deadline, { precision: 'date', date: '2026-11-20' }, '笔试期限仅日期');
  assertEqual(assessment.completed, true, '笔试已完成');

  // 偏好：分端覆盖完整保留
  assertDeepEqual(backup.preferences, expectedDatasetPreferences(), '备份中的分端偏好');

  // 与源存储快照逐条一致（可选）
  if (sourceJobs) {
    assertDeepEqual(backup.applications, sourceJobs, '备份岗位与源存储逐条一致');
  }

  return { jobIds, nodeIds, format: backup.format, version: backup.version };
}

/* ------------------------------------------------------------------ */
/* 恢复后的核验                                                          */
/* ------------------------------------------------------------------ */

export interface RestoreVerification {
  jobCount: number;
  preferencesMatch: boolean;
  clearedOutcome: boolean;
  withdrewLastStep: boolean;
  flowAfterWithdraw: unknown;
  nonEmptyImportRejected: boolean;
  nonEmptyImportUnchanged: boolean;
}

/**
 * 在空目标存储上恢复备份并完成 persist 4.2 的收尾核验：
 * 逐条对齐源数据 → 清除已拒结果 → 撤回末节点 → 非空目标拒绝导入且原数据不变。
 */
export async function importAndVerifyRestored(
  store: JobBoardStore,
  backup: BackupFile,
): Promise<RestoreVerification> {
  // 目标必须为空
  const before = await store.listJobs();
  assertTrue(before.ok, '恢复前读取目标看板');
  assertEqual(before.ok ? before.value.length : -1, 0, '恢复前目标看板应为空');

  // 恢复
  const imported = await store.importBackup(structuredCloneJson(backup));
  assertEqual(imported.status, 'confirmed', '向空看板导入备份应确认');

  // 逐条深度对齐（稳定 ID、节点顺序、期限精度、结果）
  const jobs = await store.listJobs();
  assertTrue(jobs.ok, '恢复后读取岗位');
  const restored = jobs.ok ? jobs.value : [];
  assertEqual(restored.length, backup.applications.length, '恢复后岗位数量');
  assertDeepEqual(restored, backup.applications, '恢复后的岗位与备份逐条一致');

  const prefs = await store.getPreferences();
  assertTrue(prefs.ok, '恢复后读取偏好');
  assertDeepEqual(prefs.ok ? prefs.value : null, backup.preferences, '恢复后的偏好与备份一致');

  // 清除「已拒」结果后可继续跟进
  const shiguang = restored.find((j) => j.id === FICTIONAL.shiguang.jobId);
  assertTrue(shiguang !== undefined, '恢复后应有拾光数据');
  const cleared = await store.submitJobCommand({
    kind: 'clear-outcome',
    jobId: FICTIONAL.shiguang.jobId,
    expectedVersion: shiguang?.version ?? 0,
  });
  assertEqual(cleared.status, 'confirmed', '清除已拒结果应确认');
  assertDeepEqual(cleared.status === 'confirmed' ? cleared.job.outcome : undefined, null, '清除后结果为空');

  // 撤回末节点（书面 Offer），流程回到 OC
  const withdrew = await store.submitJobCommand({
    kind: 'remove-latest-step',
    jobId: FICTIONAL.shiguang.jobId,
    expectedVersion: cleared.status === 'confirmed' ? cleared.job.version : 0,
    expectedLastNodeId: FICTIONAL.shiguang.offer,
  });
  assertEqual(withdrew.status, 'confirmed', '撤回末节点应确认');
  const flowAfter = withdrew.status === 'confirmed' ? withdrew.job.flow : null;
  assertEqual(flowAfter?.length, 1, '撤回后剩 1 个节点');
  assertEqual(flowAfter?.[0]?.id, FICTIONAL.shiguang.oc, '撤回后只剩 OC 节点');

  // 非空目标再次导入同一备份：拒绝且原数据不变
  const snapshotBeforeReject = await store.listJobs();
  const reimport = await store.importBackup(structuredCloneJson(backup));
  assertEqual(reimport.status, 'rejected', '向非空看板导入应拒绝');
  assertTrue(
    reimport.status === 'rejected' && 'reason' in reimport && reimport.reason === 'targetNotEmpty',
    `非空导入拒绝原因应为 targetNotEmpty，实际 ${reimport.status === 'rejected' ? reimport.reason : reimport.status}`,
  );
  const snapshotAfterReject = await store.listJobs();
  assertDeepEqual(
    snapshotAfterReject.ok ? snapshotAfterReject.value : null,
    snapshotBeforeReject.ok ? snapshotBeforeReject.value : null,
    '拒绝导入后原岗位数据必须不变',
  );
  const prefsAfterReject = await store.getPreferences();
  assertDeepEqual(prefsAfterReject.ok ? prefsAfterReject.value : null, backup.preferences, '拒绝导入后偏好不变');

  return {
    jobCount: restored.length,
    preferencesMatch: true,
    clearedOutcome: true,
    withdrewLastStep: true,
    flowAfterWithdraw: flowAfter,
    nonEmptyImportRejected: true,
    nonEmptyImportUnchanged: true,
  };
}

/** 两种适配器共跑同一条只含已挂岗位的导入场景。 */
export async function verifyEndedNonEmptyTarget(store: JobBoardStore, backup: BackupFile): Promise<void> {
  const jobId = 'qa-ended-target';
  const created = await store.submitJobCommand({
    kind: 'create-job', jobId, input: { company: '已结束样本公司', position: '实习生' },
  });
  assertConfirmed(created, '目标建档');
  const step = await store.submitJobCommand({
    kind: 'log-step', jobId, expectedVersion: created.job.version,
    nodeId: 'qa-ended-interview', step: { kind: 'interview', round: '二面' },
  });
  assertConfirmed(step, '登记二面');
  const closed = await store.submitJobCommand({
    kind: 'record-outcome', jobId, expectedVersion: step.job.version, status: 'closedByEmployer',
  });
  assertConfirmed(closed, '标记已挂');

  const before = await store.exportSnapshot();
  if (!before.ok) throw new Error(before.failure.message);
  assertDeepEqual(before.backup.applications, [closed.job], '目标看板只有一条已结束岗位');
  const attempt = await store.importBackup(backup);
  assertEqual(attempt.status === 'rejected' && attempt.reason, 'targetNotEmpty', '非空目标应拒绝导入');
  const after = await store.exportSnapshot();
  assertDeepEqual(after, before, '拒绝导入后岗位、流程、结果和分端偏好全部保留');
}

/** 结构化克隆的 JSON 兜底（浏览器与 Node 都可用）。 */
function structuredCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
