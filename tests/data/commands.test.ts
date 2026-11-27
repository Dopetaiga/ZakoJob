/** 数据契约用例：命令验证、领域路由与版本条件传递（persist-job-data 1.1）。 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  commandValidationFailure,
  dispatchCreateJobCommand,
  dispatchJobCommand,
  validateJobCommand,
  type JobCommand,
} from '../../src/data/index.ts';
import type { InterviewNode, Job } from '../../src/domain/index.ts';

describe('命令结构校验', () => {
  it('拒绝不可信 JSON：非对象、未知命令种类与错误字段类型', () => {
    assert.ok(validateJobCommand(null) !== null);
    assert.ok(validateJobCommand('create-job') !== null);
    assert.ok(validateJobCommand([]) !== null);
    const unknown = validateJobCommand({ kind: 'delete-everything' });
    assert.ok(unknown !== null);
    assert.match(unknown, /未知的命令种类/);

    assert.ok(validateJobCommand({ kind: 'set-star', jobId: 'j1', expectedVersion: 1, starred: 'yes' }) !== null);
    assert.ok(validateJobCommand({ kind: 'set-star', jobId: '', expectedVersion: 1, starred: true }) !== null);
    assert.ok(validateJobCommand({ kind: 'set-star', jobId: 'j1', expectedVersion: 0, starred: true }) !== null);
    assert.ok(validateJobCommand({ kind: 'log-step', jobId: 'j1', expectedVersion: 1, nodeId: 'n1', step: { kind: 'pizza' } }) !== null);
    assert.ok(validateJobCommand({ kind: 'log-step', jobId: 'j1', expectedVersion: 1, nodeId: 'n1', step: { kind: 'interview', round: '' } }) !== null);
    assert.ok(validateJobCommand({ kind: 'record-outcome', jobId: 'j1', expectedVersion: 1, status: 'won' }) !== null);
  });

  it('接受合法命令', () => {
    const command: JobCommand = {
      kind: 'log-step',
      jobId: 'j1',
      expectedVersion: 2,
      nodeId: 'n9',
      step: { kind: 'interview', round: '二面', scheduledAt: { precision: 'date', date: '2026-12-04' } },
    };
    assert.equal(validateJobCommand(command), null);
    assert.equal(
      validateJobCommand({
        kind: 'update-step',
        jobId: 'j1',
        expectedVersion: 2,
        nodeId: 'n1',
        payload: { targetKind: 'interview', patch: { status: 'done' } },
      }),
      null,
    );
  });
});

describe('命令路由到领域动作', () => {
  it('建档命令采用命令提供的稳定岗位 ID', () => {
    const result = dispatchCreateJobCommand({
      kind: 'create-job',
      jobId: 'job-fixed-1',
      input: { postingUrl: 'https://jobs.example.com/qr-9001' },
    });
    assert.ok(result.ok);
    assert.equal(result.job.id, 'job-fixed-1');
    assert.equal(result.job.version, 1);
    assert.deepEqual(result.job.flow, []);
  });

  it('登记环节命令按命令的 nodeId 追加并核对期望版本', () => {
    const created = dispatchCreateJobCommand({
      kind: 'create-job',
      jobId: 'job-fixed-2',
      input: { company: '青禾科技', position: '前端工程师' },
    });
    assert.ok(created.ok);

    const step = dispatchJobCommand(created.job, {
      kind: 'log-step',
      jobId: 'job-fixed-2',
      expectedVersion: 1,
      nodeId: 'node-second',
      step: { kind: 'interview', round: '二面' },
    });
    assert.ok(step.ok);
    const latest = step.job.flow.at(-1) as InterviewNode;
    assert.equal(latest.id, 'node-second');
    assert.equal(latest.round, '二面');
    assert.equal(step.job.version, 2);

    // 过时期望版本：领域层版本冲突完整传递。
    const stale = dispatchJobCommand(step.job, {
      kind: 'log-step',
      jobId: 'job-fixed-2',
      expectedVersion: 1,
      nodeId: 'node-second-b',
      step: { kind: 'applied' },
    });
    assert.ok(!stale.ok);
    assert.equal(stale.failure.reason, 'versionConflict');
  });

  it('更正与撤回命令按节点 ID 与末节点条件执行', () => {
    const build = (): Job => {
      const created = dispatchCreateJobCommand({
        kind: 'create-job',
        jobId: 'job-fixed-3',
        input: { postingUrl: 'https://jobs.example.com/qr-9002' },
      });
      assert.ok(created.ok);
      const applied = dispatchJobCommand(created.job, {
        kind: 'log-step', jobId: 'job-fixed-3', expectedVersion: 1, nodeId: 'n-applied', step: { kind: 'applied' },
      });
      assert.ok(applied.ok);
      const interview = dispatchJobCommand(applied.job, {
        kind: 'log-step', jobId: 'job-fixed-3', expectedVersion: 2, nodeId: 'n-interview', step: { kind: 'interview', round: '一面' },
      });
      assert.ok(interview.ok);
      return interview.job;
    };

    const job = build();
    const marked = dispatchJobCommand(job, {
      kind: 'update-step',
      jobId: 'job-fixed-3',
      expectedVersion: 3,
      nodeId: 'n-interview',
      payload: { targetKind: 'interview', patch: { status: 'done' } },
    });
    assert.ok(marked.ok);
    assert.equal((marked.job.flow[1] as InterviewNode).status, 'done');

    // 末节点不匹配时拒绝撤回，记录保持不变。
    const wrongTarget = dispatchJobCommand(marked.job, {
      kind: 'remove-latest-step',
      jobId: 'job-fixed-3',
      expectedVersion: 4,
      expectedLastNodeId: 'n-applied',
    });
    assert.ok(!wrongTarget.ok);
    assert.equal(wrongTarget.failure.reason, 'lastNodeMismatch');

    const removed = dispatchJobCommand(marked.job, {
      kind: 'remove-latest-step',
      jobId: 'job-fixed-3',
      expectedVersion: 4,
      expectedLastNodeId: 'n-interview',
    });
    assert.ok(removed.ok);
    assert.equal(removed.job.flow.length, 1);
  });

  it('结果命令与清除命令传递状态与版本', () => {
    const created = dispatchCreateJobCommand({
      kind: 'create-job',
      jobId: 'job-fixed-4',
      input: { company: '青禾科技', position: '前端工程师' },
    });
    assert.ok(created.ok);
    const closed = dispatchJobCommand(created.job, {
      kind: 'record-outcome',
      jobId: 'job-fixed-4',
      expectedVersion: 1,
      status: 'declinedByUser',
    });
    assert.ok(closed.ok);
    assert.deepEqual(closed.job.outcome, { status: 'declinedByUser' });

    const cleared = dispatchJobCommand(closed.job, {
      kind: 'clear-outcome',
      jobId: 'job-fixed-4',
      expectedVersion: 2,
    });
    assert.ok(cleared.ok);
    assert.equal(cleared.job.outcome, null);
  });

  it('命令校验失败构造 invalidInput', () => {
    const failure = commandValidationFailure('测试问题');
    assert.equal(failure.reason, 'invalidInput');
    assert.match(failure.message, /测试问题/);
  });
});
