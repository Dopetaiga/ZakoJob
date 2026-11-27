/**
 * 相邻双面试时间文本回归测试台：
 * 用真实 IndexedDB 存储与正式 UI（createJobBoardApp）渲染一个岗位，
 * 其流程为 已投递 → 一面（已面，完整月/日+星期+时分）→ 二面（待面试，完整月/日+星期+时分）。
 *
 * 全部参数由测试进程经查询字符串注入，保证每次运行可重复：
 *   db     独立 IndexedDB 数据库名（每次用例唯一）
 *   device mobile | desktop（缺省跟随视口断点）
 *   d1/t1  一面日期（YYYY-MM-DD）与时刻（HH:mm）
 *   d2/t2  二面日期与时刻
 *   tz     时刻的时区标签（与本地一致时不产生后缀，走真实应用表单路径）
 */
import { createIndexedDbJobBoard } from '../../src/data/index.ts';
import { createJobBoardApp } from '../../src/ui/index.ts';
import type { CommandOutcome, JobBoardStore } from '../../src/data/contract.ts';
import type { Deadline } from '../../src/domain/index.ts';

const params = new URLSearchParams(location.search);

function requireParam(name: string): string {
  const value = params.get(name);
  if (!value) throw new Error(`缺少查询参数 ${name}`);
  return value;
}

function expectConfirmed(outcome: CommandOutcome, label: string) {
  if (outcome.status !== 'confirmed') {
    throw new Error(`${label} 未确认：${JSON.stringify(outcome)}`);
  }
  return outcome.job;
}

async function seedAdjacentInterviewJob(store: JobBoardStore): Promise<void> {
  const jobId = 'qa-adjacent-interviews';
  const deadline = (date: string, time: string): Deadline => ({
    precision: 'datetime',
    date,
    time,
    timeZone: requireParam('tz'),
  });

  let version = 1;
  expectConfirmed(
    await store.submitJobCommand({
      kind: 'create-job',
      jobId,
      input: { company: '临江智能', position: '前端开发工程师' },
    }),
    '建档',
  );

  expectConfirmed(
    await store.submitJobCommand({
      kind: 'log-step',
      jobId,
      expectedVersion: version++,
      nodeId: 'qa-node-applied',
      step: { kind: 'applied' },
    }),
    '登记已投递',
  );

  expectConfirmed(
    await store.submitJobCommand({
      kind: 'log-step',
      jobId,
      expectedVersion: version++,
      nodeId: 'qa-node-interview-1',
      step: { kind: 'interview', round: '一面', scheduledAt: deadline(requireParam('d1'), requireParam('t1')) },
    }),
    '登记一面（精确时刻）',
  );

  expectConfirmed(
    await store.submitJobCommand({
      kind: 'log-step',
      jobId,
      expectedVersion: version++,
      nodeId: 'qa-node-interview-2',
      step: { kind: 'interview', round: '二面', scheduledAt: deadline(requireParam('d2'), requireParam('t2')) },
    }),
    '登记二面（待面试，精确时刻）',
  );

  // 一面标为已面，二面保持待面试：构成「相邻两个面试、后一个为当前节点」。
  expectConfirmed(
    await store.submitJobCommand({
      kind: 'update-step',
      jobId,
      expectedVersion: version,
      nodeId: 'qa-node-interview-1',
      payload: { targetKind: 'interview', patch: { status: 'done' } },
    }),
    '一面标已面',
  );
}

const device = params.get('device');
const store = await createIndexedDbJobBoard({
  databaseName: requireParam('db'),
});
await seedAdjacentInterviewJob(store);

const root = document.getElementById('app')!;
createJobBoardApp({
  container: root,
  store,
  ...(device === 'mobile' || device === 'desktop' ? { forceDevice: device } : {}),
});

document.title = '相邻双面试回归测试台就绪';
