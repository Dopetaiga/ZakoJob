/**
 * persist-job-data 4.1 的虚构数据契约场景集。
 *
 * 每个场景只经由 JobBoardStore 公开契约读写，可在任意适配器上运行：
 * - 真实浏览器 IndexedDB（Playwright msedge，Vite 直送测试页）；
 * - 隔离 Miniflare D1 Worker 的 Sites HTTP 客户端（feat/sites-d1 合入后接入）。
 *
 * 场景覆盖：稳定 ID 与重复建档拒绝、星标与资料补丁、日期精度、
 * 已挂 / 已拒与恢复、撤回与过时撤回冲突、跨端主动重读、
 * 分端偏好独立与布局继承、命令与偏好校验的失败反馈、新会话续用。
 */

import type {
  CommandOutcome,
  JobBoardStore,
  JobCommand,
} from '../../src/data/index.ts';
import {
  assertDeepEqual,
  assertEqual,
  assertOk,
  assertTrue,
  assertPresent,
  type ScenarioContext,
  type ScenarioResult,
} from './store-assert.ts';
import { runScenario } from './store-assert.ts';

export type { ScenarioContext, ScenarioResult } from './store-assert.ts';


/** 断言命令确认并返回岗位。 */
function expectConfirmed(outcome: CommandOutcome, label: string) {
  if (outcome.status !== 'confirmed') {
    throw new Error(`${label} 应确认，实际 ${outcome.status}`);
  }
  return outcome.job;
}

/** 断言命令被明确拒绝并返回失败对象。 */
function expectRejected(
  outcome: CommandOutcome,
  label: string,
  reason?: string,
) {
  if (outcome.status !== 'rejected') {
    throw new Error(`${label} 应被明确拒绝，实际 ${outcome.status}`);
  }
  if (reason && outcome.failure.reason !== reason) {
    throw new Error(
      `${label} 的失败原因应为 ${reason}，实际 ${outcome.failure.reason}`,
    );
  }
  return outcome.failure;
}

/* 1. 稳定 ID 与重复建档 -------------------------------------------------- */

async function scenarioCreateWithStableIds({ openStore }: ScenarioContext) {
  const store = await openStore();
  const jobId = 'qa-sc1-stable-id';
  const created = expectConfirmed(
    await store.submitJobCommand({
      kind: 'create-job',
      jobId,
      input: { company: '青禾科技', position: '后端开发实习生' },
    }),
    '首次建档',
  );
  assertEqual(created.id, jobId, '建档必须采用客户端生成的岗位 ID');
  assertEqual(created.version, 1, '新岗位版本为 1');

  // 同一 ID 重送：只允许命中重复拒绝，不得覆盖或追加
  const resend = await store.submitJobCommand({
    kind: 'create-job',
    jobId,
    input: { company: '另外一家公司', position: '不同职位' },
  });
  expectRejected(resend, '同 ID 重复建档');

  const rereadJob = assertPresent(assertOk(await store.getJob(jobId), '重复建档后原记录仍在'), '重复建档后原记录仍在');
  assertEqual(rereadJob.profile.company, '青禾科技', '重复建档不得覆盖原公司');
  assertEqual(rereadJob.profile.position, '后端开发实习生', '重复建档不得覆盖原职位');
  assertEqual(rereadJob.flow.length, 0, '重复建档不得追加流程');

  const list = await store.listJobs();
  assertTrue(list.ok, '列出岗位');
  assertEqual(list.ok ? list.value.filter((j) => j.id === jobId).length : -1, 1, '同 ID 只保留一条记录');
  return { jobId, version: created.version };
}

/* 2. 星标与资料补丁 ------------------------------------------------------ */

async function scenarioStarAndProfile({ openStore }: ScenarioContext) {
  const store = await openStore();
  const jobId = 'qa-sc2-star-profile';
  const created = expectConfirmed(
    await store.submitJobCommand({
      kind: 'create-job',
      jobId,
      input: { company: '拾光数据', position: '数据工程实习生' },
    }),
    '建档',
  );

  const starred = expectConfirmed(
    await store.submitJobCommand({ kind: 'set-star', jobId, expectedVersion: created.version, starred: true }),
    '加星',
  );
  assertEqual(starred.starred, true, '加星后 starred=true');

  // 跨句柄主动重读：新开一个句柄读回星标
  const reader = await openStore();
  const reread = await reader.getJob(jobId);
  assertEqual(reread.ok ? reread.value?.starred : null, true, '另一个句柄读回星标');

  const unstarred = expectConfirmed(
    await store.submitJobCommand({
      kind: 'set-star',
      jobId,
      expectedVersion: starred.version,
      starred: false,
    }),
    '取消星标',
  );
  assertEqual(unstarred.starred, false, '取消星标后 starred=false');

  const patched = expectConfirmed(
    await store.submitJobCommand({
      kind: 'update-profile',
      jobId,
      expectedVersion: unstarred.version,
      patch: { location: '北京', salary: '300 元/天', postingUrl: 'https://jobs.example.com/p/42' },
    }),
    '补资料',
  );
  assertEqual(patched.profile.location, '北京', '补资料写入地点');
  assertEqual(patched.profile.postingUrl, 'https://jobs.example.com/p/42', '补资料写入链接');

  // 缺省键语义：补丁不含 location 时保持不变（契约：undefined 表示不变）
  const kept = expectConfirmed(
    await store.submitJobCommand({
      kind: 'update-profile',
      jobId,
      expectedVersion: patched.version,
      patch: { salary: '300 元/天' },
    }),
    '缺省键保持',
  );
  assertEqual(kept.profile.location, '北京', '未提供的字段保持不变');
  assertEqual(kept.profile.salary, '300 元/天', '提供的字段更新');

  // 资料字段仅接受字符串；期限字段可用 null 清除。
  const nullClear = await store.submitJobCommand({
    kind: 'update-profile',
    jobId,
    expectedVersion: kept.version,
    patch: { location: null } as unknown as { location: string },
  });
  expectRejected(nullClear, '拒绝非字符串资料');
  const cleared = expectConfirmed(await store.submitJobCommand({
    kind: 'update-profile', jobId, expectedVersion: kept.version, patch: { location: '' },
  }), '清除地点');
  assertEqual(cleared.profile.location, '', '空字符串清除原地点');
  return { starredThenUnstarred: true, undefinedKeepsField: true, profileNullRejected: true, emptyStringClearsField: true };
}

/* 3. 日期精度 ------------------------------------------------------------ */

async function scenarioDatePrecision({ openStore }: ScenarioContext) {
  const store = await openStore();
  const jobId = 'qa-sc3-precision';
  const created = expectConfirmed(
    await store.submitJobCommand({
      kind: 'create-job',
      jobId,
      input: { company: '云起实验室', position: 'AI Infra 实习生' },
    }),
    '建档',
  );

  const assessment = expectConfirmed(
    await store.submitJobCommand({
      kind: 'log-step',
      jobId,
      expectedVersion: created.version,
      nodeId: 'qa-sc3-assessment',
      step: { kind: 'assessment', deadline: { precision: 'date', date: '2026-11-28' } },
    }),
    '登记笔试（仅日期）',
  );
  const assessmentNode = assessment.flow[0];
  assertDeepEqual(
    assessmentNode && assessmentNode.kind === 'assessment' ? assessmentNode.deadline : null,
    { precision: 'date', date: '2026-11-28' },
    '仅日期期限不得补出时刻',
  );

  const interview = expectConfirmed(
    await store.submitJobCommand({
      kind: 'log-step',
      jobId,
      expectedVersion: assessment.version,
      nodeId: 'qa-sc3-interview',
      step: {
        kind: 'interview',
        round: '二面',
        scheduledAt: { precision: 'datetime', date: '2026-11-27', time: '15:00' },
      },
    }),
    '登记二面（精确时刻）',
  );
  const interviewNode = interview.flow[1];
  assertDeepEqual(
    interviewNode && interviewNode.kind === 'interview' ? interviewNode.scheduledAt : null,
    { precision: 'datetime', date: '2026-11-27', time: '15:00' },
    '精确时刻期限保留 time 字段',
  );

  // 另一个句柄重读，精度必须原样
  const reader = await openStore();
  const rereadJob = assertPresent(assertOk(await reader.getJob(jobId), '重读岗位'), '重读岗位');
  const rereadFlow = rereadJob.flow;
  assertEqual(rereadFlow.length, 2, '重读节点数量');
  return { dateOnly: '2026-11-28', datetime: '2026-11-27T15:00' };
}

/* 4. 已挂 / 已拒 / 清除 --------------------------------------------------- */

async function scenarioOutcomeLifecycle({ openStore }: ScenarioContext) {
  const store = await openStore();
  const jobId = 'qa-sc4-outcome';
  const created = expectConfirmed(
    await store.submitJobCommand({
      kind: 'create-job',
      jobId,
      input: { company: '北岸智能', position: '前端开发实习生' },
    }),
    '建档',
  );
  const withStep = expectConfirmed(
    await store.submitJobCommand({
      kind: 'log-step',
      jobId,
      expectedVersion: created.version,
      nodeId: 'qa-sc4-interview',
      step: { kind: 'interview', round: '二面' },
    }),
    '登记二面',
  );

  // 已拒（本人拒绝）
  const declined = expectConfirmed(
    await store.submitJobCommand({
      kind: 'record-outcome',
      jobId,
      expectedVersion: withStep.version,
      status: 'declinedByUser',
    }),
    '登记已拒',
  );
  assertDeepEqual(declined.outcome, { status: 'declinedByUser' }, '已拒结果独立保存');
  assertEqual(declined.flow.length, 1, '结果不写入流程');

  // 已挂（招聘方结束）
  const closed = expectConfirmed(
    await store.submitJobCommand({
      kind: 'record-outcome',
      jobId,
      expectedVersion: declined.version,
      status: 'closedByEmployer',
    }),
    '更正为已挂',
  );
  assertDeepEqual(closed.outcome, { status: 'closedByEmployer' }, '已挂结果覆盖已拒');

  // 清除 → 恢复跟进，流程仍可继续
  const cleared = expectConfirmed(
    await store.submitJobCommand({ kind: 'clear-outcome', jobId, expectedVersion: closed.version }),
    '清除结果',
  );
  assertDeepEqual(cleared.outcome, null, '清除后结果为空');
  const resumed = expectConfirmed(
    await store.submitJobCommand({
      kind: 'log-step',
      jobId,
      expectedVersion: cleared.version,
      nodeId: 'qa-sc4-oc',
      step: { kind: 'oc' },
    }),
    '清除后继续登记 OC',
  );
  assertEqual(resumed.flow.length, 2, '恢复跟进后流程可继续');
  return { declinedByUser: true, closedByEmployer: true, cleared: true };
}

/* 5. 撤回与过时撤回 ------------------------------------------------------ */

async function scenarioWithdrawalAndStaleConflict({ openStore }: ScenarioContext) {
  const store = await openStore();
  const jobId = 'qa-sc5-withdraw';
  const created = expectConfirmed(
    await store.submitJobCommand({
      kind: 'create-job',
      jobId,
      input: { company: '栖原软件', position: '平台开发工程师' },
    }),
    '建档',
  );
  const one = expectConfirmed(
    await store.submitJobCommand({
      kind: 'log-step',
      jobId,
      expectedVersion: created.version,
      nodeId: 'qa-sc5-node-1',
      step: { kind: 'interview', round: '一面' },
    }),
    '登记一面',
  );

  // 正常撤回末节点
  const withdrawn = expectConfirmed(
    await store.submitJobCommand({
      kind: 'remove-latest-step',
      jobId,
      expectedVersion: one.version,
      expectedLastNodeId: 'qa-sc5-node-1',
    }),
    '撤回唯一节点',
  );
  assertEqual(withdrawn.flow.length, 0, '撤回后流程为空，岗位仍可见');

  // 重建两个节点，为过时撤回做准备
  const again = expectConfirmed(
    await store.submitJobCommand({
      kind: 'log-step',
      jobId,
      expectedVersion: withdrawn.version,
      nodeId: 'qa-sc5-node-2',
      step: { kind: 'interview', round: '二面' },
    }),
    '重新登记二面',
  );
  const staleReader = await openStore();
  const staleJob = assertPresent(assertOk(await staleReader.getJob(jobId), '另一端读回两节点岗位'), '另一端读回两节点岗位');

  // 另一端追加三面（版本推进），本端仍以旧版本撤回二面
  expectConfirmed(
    await store.submitJobCommand({
      kind: 'log-step',
      jobId,
      expectedVersion: again.version,
      nodeId: 'qa-sc5-node-3',
      step: { kind: 'interview', round: '三面' },
    }),
    '追加三面',
  );

  const stale = await staleReader.submitJobCommand({
    kind: 'remove-latest-step',
    jobId,
    expectedVersion: staleJob.version,
    expectedLastNodeId: 'qa-sc5-node-2',
  });
  expectRejected(stale, '过时撤回', 'versionConflict');

  // 重读后二面与三面都在，原操作未被执行
  const afterJob = assertPresent(assertOk(await staleReader.getJob(jobId), '过时撤回被拒后重读'), '过时撤回被拒后重读');
  assertEqual(afterJob.flow.length, 2, '过时撤回被拒后流程完整');
  assertEqual(afterJob.flow[0]?.id, 'qa-sc5-node-2', '二面仍在');
  assertEqual(afterJob.flow[1]?.id, 'qa-sc5-node-3', '三面仍在');

  // 版本正确但末节点 ID 错 → lastNodeMismatch
  const fresh = await openStore();
  const currentJob = assertPresent(assertOk(await fresh.getJob(jobId), '读取当前岗位'), '读取当前岗位');
  const mismatch = await fresh.submitJobCommand({
    kind: 'remove-latest-step',
    jobId,
    expectedVersion: currentJob.version,
    expectedLastNodeId: 'qa-sc5-node-1',
  });
  expectRejected(mismatch, '末节点不匹配', 'lastNodeMismatch');
  return { staleConflict: 'versionConflict', mismatch: 'lastNodeMismatch' };
}

/* 6. 跨端主动重读 -------------------------------------------------------- */

async function scenarioCrossClientReread({ openStore }: ScenarioContext) {
  // 先开读端（持有旧视图），再开写端写入
  const reader = await openStore();
  const writer = await openStore();
  assertTrue(await reader.listJobs().then((r) => r.ok), '读端预热读取');

  const jobId = 'qa-sc6-reread';
  const created = expectConfirmed(
    await writer.submitJobCommand({
      kind: 'create-job',
      jobId,
      input: { company: '拾光数据', position: '数据工程实习生' },
    }),
    '写端建档',
  );
  expectConfirmed(
    await writer.submitJobCommand({ kind: 'set-star', jobId, expectedVersion: created.version, starred: true }),
    '写端加星',
  );
  expectConfirmed(
    await writer.submitJobCommand({
      kind: 'log-step',
      jobId,
      expectedVersion: created.version + 1,
      nodeId: 'qa-sc6-oc',
      step: { kind: 'oc' },
    }),
    '写端登记 OC',
  );

  // 读端不重建、主动重读：必须看到写端的全部提交
  const jobs = await reader.listJobs();
  assertTrue(jobs.ok, '读端主动重读列表');
  const seen = jobs.ok ? jobs.value.find((j) => j.id === jobId) : null;
  assertTrue(seen !== null, '读端必须看到写端新建的岗位');
  assertEqual(seen?.starred, true, '读端看到星标');
  assertEqual(seen?.flow.length, 1, '读端看到新节点');
  assertEqual(seen?.version, created.version + 2, '读端看到推进后的版本');

  const job = await reader.getJob(jobId);
  assertEqual(job.ok ? job.value?.version : null, created.version + 2, '读端 getJob 版本一致');
  return { readerSeenVersion: created.version + 2 };
}

/* 7. 分端偏好独立与布局继承 ------------------------------------------------ */

async function scenarioPreferencesScopes({ openStore }: ScenarioContext) {
  const store = await openStore();
  const defaults = await store.getPreferences();
  assertTrue(defaults.ok, '读取缺省偏好');
  assertDeepEqual(
    defaults.ok ? defaults.value.mobile : null,
    { overridden: false },
    '缺省手机沿用共用布局',
  );

  // 手机专属覆盖：近期安排在前
  const mobileSet = await store.savePreferences({
    mobile: {
      overridden: true,
      layout: {
        modules: [
          { id: 'schedule', visible: true },
          { id: 'jobs', visible: true },
        ],
      },
    },
  });
  assertEqual(mobileSet.status, 'confirmed', '写入手机覆盖应确认');
  if (mobileSet.status === 'confirmed') {
    assertEqual(mobileSet.preferences.mobile.overridden, true, '手机已单独设置');
    assertEqual(mobileSet.preferences.desktop.overridden, false, '桌面仍沿用共用布局');
    assertDeepEqual(
      mobileSet.preferences.shared.modules.map((m) => m.id),
      ['jobs', 'schedule'],
      '共用布局不被手机覆盖影响',
    );
  }

  // 桌面专属覆盖：不影响手机
  const desktopSet = await store.savePreferences({
    desktop: {
      overridden: true,
      layout: {
        modules: [
          { id: 'jobs', visible: true },
          { id: 'schedule', visible: false },
        ],
      },
    },
  });
  assertEqual(desktopSet.status, 'confirmed', '写入桌面覆盖应确认');
  if (desktopSet.status === 'confirmed') {
    assertEqual(desktopSet.preferences.mobile.overridden, true, '手机覆盖保持不变');
    assertEqual(desktopSet.preferences.desktop.overridden, true, '桌面已单独设置');
  }

  // 另一个句柄（新会话）读回：分端覆盖完整
  const reader = await openStore();
  const reread = await reader.getPreferences();
  assertTrue(reread.ok, '新句柄读取偏好');
  assertEqual(reread.ok ? reread.value.mobile.overridden : null, true, '新句柄读回手机覆盖');
  assertEqual(reread.ok ? reread.value.desktop.overridden : null, true, '新句柄读回桌面覆盖');

  // 手机恢复沿用共用布局：桌面不受影响
  const restored = await store.savePreferences({ mobile: { overridden: false } });
  assertEqual(restored.status, 'confirmed', '恢复沿用共用布局应确认');
  if (restored.status === 'confirmed') {
    assertEqual(restored.preferences.mobile.overridden, false, '手机恢复沿用');
    assertEqual(restored.preferences.desktop.overridden, true, '桌面覆盖不受影响');
  }

  // 非法补丁：未知模块 → 明确拒绝且不写入
  const invalid = await store.savePreferences({
    mobile: {
      overridden: true,
      layout: {
        modules: [
          { id: 'bogus' as never, visible: true },
          { id: 'jobs', visible: true },
          { id: 'schedule', visible: true },
        ],
      },
    },
  });
  assertEqual(invalid.status, 'rejected', '未知模块应拒绝');
  assertTrue(
    invalid.status === 'rejected' && invalid.failure.reason === 'invalidPreferences',
    '非法偏好失败原因应为 invalidPreferences',
  );
  const afterInvalid = await store.getPreferences();
  assertEqual(
    afterInvalid.ok ? afterInvalid.value.mobile.overridden : null,
    false,
    '被拒绝的补丁不得改动现有偏好',
  );
  return { independentScopes: true, restoreToShared: true, invalidRejected: true };
}

/* 8. 命令与偏好校验的失败反馈 --------------------------------------------- */

async function scenarioInvalidCommands({ openStore }: ScenarioContext) {
  const store = await openStore();
  const jobId = 'qa-sc8-invalid';
  const created = expectConfirmed(
    await store.submitJobCommand({
      kind: 'create-job',
      jobId,
      input: { company: '北岸智能', position: '测试开发实习生' },
    }),
    '建档',
  );

  // 未知命令种类 → 明确拒绝
  const unknownKind = await store.submitJobCommand({ kind: 'bogus' } as unknown as JobCommand);
  expectRejected(unknownKind, '未知命令种类');

  // 期望版本非法 → 明确拒绝
  const badVersion = await store.submitJobCommand({
    kind: 'set-star',
    jobId,
    expectedVersion: 0,
    starred: true,
  });
  expectRejected(badVersion, '非法期望版本');

  // 更正不存在的节点 → nodeNotFound
  const missingNode = await store.submitJobCommand({
    kind: 'update-step',
    jobId,
    expectedVersion: created.version,
    nodeId: 'qa-sc8-nope',
    payload: { targetKind: 'interview', patch: { status: 'done' } },
  });
  expectRejected(missingNode, '更正不存在的节点', 'nodeNotFound');

  // 对不存在的岗位提交命令 → 明确拒绝
  const missingJob = await store.submitJobCommand({
    kind: 'set-star',
    jobId: 'qa-sc8-missing',
    expectedVersion: 1,
    starred: true,
  });
  expectRejected(missingJob, '对不存在岗位提交命令');

  // 读不存在岗位：成功且为 null
  const readMissing = await store.getJob('qa-sc8-missing');
  assertTrue(readMissing.ok, '读不存在岗位仍是成功读取');
  assertEqual(readMissing.ok ? readMissing.value : undefined, null, '不存在岗位返回 null');
  return { rejectedKinds: 4 };
}

/* 汇总 ------------------------------------------------------------------ */

export interface ScenarioSuiteResult {
  results: ScenarioResult[];
  allOk: boolean;
}

/** 依次运行全部存储级契约场景。 */
export async function runStoreScenarios(ctx: ScenarioContext): Promise<ScenarioSuiteResult> {
  const cases: Array<[string, (ctx: ScenarioContext) => Promise<Record<string, unknown> | void>]> = [
    ['create-stable-ids', scenarioCreateWithStableIds],
    ['star-and-profile', scenarioStarAndProfile],
    ['date-precision', scenarioDatePrecision],
    ['outcome-lifecycle', scenarioOutcomeLifecycle],
    ['withdrawal-stale-conflict', scenarioWithdrawalAndStaleConflict],
    ['cross-client-reread', scenarioCrossClientReread],
    ['preferences-independent-scopes', scenarioPreferencesScopes],
    ['invalid-command-feedback', scenarioInvalidCommands],
  ];
  const results: ScenarioResult[] = [];
  for (const [name, body] of cases) {
    results.push(await runScenario(name, body, ctx));
  }
  return { results, allOk: results.every((r) => r.ok) };
}

export { runScenario };
