/** 任务 2.2：笔试期限与手动完成，面试的待面试、已面、改期与轮次更正。 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createJob,
  getLatestFlowNode,
  logAppliedStep,
  logAssessmentStep,
  logInterviewStep,
  updateAssessmentStep,
  updateInterviewStep,
  type AssessmentNode,
  type FlowNode,
  type InterviewNode,
} from '../../src/domain/index.ts';

function assessmentOf(node: FlowNode | null | undefined): AssessmentNode {
  assert.ok(node && node.kind === 'assessment');
  return node;
}

function interviewOf(node: FlowNode | null | undefined): InterviewNode {
  assert.ok(node && node.kind === 'interview');
  return node;
}

describe('笔试 / 测评（2.2）', () => {
  it('截止时间已过仍未登记完成时，期限和未完成状态保留', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-3001' });
    assert.ok(created.ok);
    const step = logAssessmentStep(created.job, created.job.version, {
      deadline: { precision: 'date', date: '2026-11-01' },
    });
    assert.ok(step.ok);

    // 到期不自动推进：领域不改动记录，期限与未完成状态原样可查。
    const node = assessmentOf(step.job.flow[0]);
    assert.deepEqual(node.deadline, { precision: 'date', date: '2026-11-01' });
    assert.equal(node.completed, false);
    assert.equal(step.job.flow.length, 1);
    assert.equal(step.job.version, created.job.version + 1);
  });

  it('标记完成时更新原测评节点，流程长度不变', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-3002' });
    assert.ok(created.ok);
    const step = logAssessmentStep(created.job, created.job.version, {
      deadline: { precision: 'datetime', date: '2026-12-01', time: '23:59' },
    });
    assert.ok(step.ok);
    const nodeBefore = assessmentOf(step.job.flow[0]);

    const done = updateAssessmentStep(step.job, step.job.version, nodeBefore.id, {
      completed: true,
    });
    assert.ok(done.ok);

    const nodeAfter = assessmentOf(done.job.flow[0]);
    assert.equal(nodeAfter.id, nodeBefore.id);
    assert.equal(nodeAfter.completed, true);
    assert.deepEqual(nodeAfter.deadline, {
      precision: 'datetime',
      date: '2026-12-01',
      time: '23:59',
    });
    assert.equal(done.job.flow.length, 1);
    assert.equal(done.job.version, step.job.version + 1);
  });

  it('非测评节点不接受测评更正', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-3003' });
    assert.ok(created.ok);
    const applied = logAppliedStep(created.job, created.job.version);
    assert.ok(applied.ok);
    const appliedNode = applied.job.flow[0]!;

    const wrong = updateAssessmentStep(applied.job, applied.job.version, appliedNode.id, {
      completed: true,
    });
    assert.ok(!wrong.ok);
    assert.equal(wrong.failure.reason, 'nodeKindMismatch');

    const missing = updateAssessmentStep(applied.job, applied.job.version, 'node-x', {
      completed: true,
    });
    assert.ok(!missing.ok);
    assert.equal(missing.failure.reason, 'nodeNotFound');
  });
});

describe('面试状态与改期（2.2）', () => {
  const buildPendingSecond = () => {
    const created = createJob({ company: '青禾科技', position: '前端工程师' });
    assert.ok(created.ok);
    const step = logInterviewStep(created.job, created.job.version, {
      round: '二面',
      scheduledAt: { precision: 'date', date: '2026-12-02' },
    });
    assert.ok(step.ok);
    const node = interviewOf(step.job.flow[0]);
    return { job: step.job, node };
  };

  it('改期保留节点标识，随后标为已面', () => {
    const { job, node } = buildPendingSecond();

    const rescheduled = updateInterviewStep(job, job.version, node.id, {
      scheduledAt: { precision: 'date', date: '2026-12-04' },
    });
    assert.ok(rescheduled.ok);
    const rescheduledNode = interviewOf(rescheduled.job.flow[0]);
    assert.equal(rescheduledNode.id, node.id);
    assert.equal(rescheduledNode.status, 'pending');
    assert.deepEqual(rescheduledNode.scheduledAt, { precision: 'date', date: '2026-12-04' });

    const done = updateInterviewStep(
      rescheduled.job,
      rescheduled.job.version,
      node.id,
      { status: 'done' },
    );
    assert.ok(done.ok);

    assert.equal(done.job.flow.length, 1);
    const doneNode = interviewOf(done.job.flow[0]);
    assert.equal(doneNode.id, node.id);
    assert.equal(doneNode.round, '二面');
    assert.equal(doneNode.status, 'done');
    assert.deepEqual(doneNode.scheduledAt, { precision: 'date', date: '2026-12-04' });
    assert.equal(getLatestFlowNode(done.job)?.kind, 'interview');
  });

  it('可以清除安排时间但状态不变', () => {
    const { job, node } = buildPendingSecond();

    const cleared = updateInterviewStep(job, job.version, node.id, {
      scheduledAt: null,
    });
    assert.ok(cleared.ok);
    const clearedNode = interviewOf(cleared.job.flow[0]);
    assert.equal(clearedNode.scheduledAt, undefined);
    assert.equal(clearedNode.status, 'pending');
  });
});

describe('更正早期面试（2.2）', () => {
  const buildTwoRounds = () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-3004' });
    assert.ok(created.ok);
    const first = logInterviewStep(created.job, created.job.version, {
      round: '一面',
      scheduledAt: { precision: 'date', date: '2026-11-20' },
    });
    assert.ok(first.ok);
    const firstNode = interviewOf(first.job.flow[0]);
    const marked = updateInterviewStep(first.job, first.job.version, firstNode.id, {
      status: 'done',
    });
    assert.ok(marked.ok);
    const second = logInterviewStep(marked.job, marked.job.version, {
      round: '二面',
      scheduledAt: { precision: 'datetime', date: '2026-12-05', time: '14:00' },
    });
    assert.ok(second.ok);
    const secondNode = interviewOf(second.job.flow[1]);
    return { job: second.job, firstNode, secondNode };
  };

  it('后续二面存在时更正一面，顺序与二面内容原样保留', () => {
    const { job, firstNode, secondNode } = buildTwoRounds();

    const corrected = updateInterviewStep(job, job.version, firstNode.id, {
      scheduledAt: { precision: 'date', date: '2026-11-21' },
    });
    assert.ok(corrected.ok);

    assert.equal(corrected.job.flow.length, 2);
    const correctedFirst = interviewOf(corrected.job.flow[0]);
    assert.equal(correctedFirst.id, firstNode.id);
    assert.equal(correctedFirst.round, '一面');
    assert.equal(correctedFirst.status, 'done');
    assert.deepEqual(correctedFirst.scheduledAt, { precision: 'date', date: '2026-11-21' });

    const untouchedSecond = interviewOf(corrected.job.flow[1]);
    assert.equal(untouchedSecond.id, secondNode.id);
    assert.equal(untouchedSecond.round, '二面');
    assert.equal(untouchedSecond.status, 'pending');
    assert.deepEqual(untouchedSecond.scheduledAt, {
      precision: 'datetime',
      date: '2026-12-05',
      time: '14:00',
    });
    assert.equal(getLatestFlowNode(corrected.job)?.id, secondNode.id);
  });

  it('轮次名称更正同样保留节点顺序', () => {
    const { job, firstNode, secondNode } = buildTwoRounds();

    const renamed = updateInterviewStep(job, job.version, firstNode.id, {
      round: '技术一面',
    });
    assert.ok(renamed.ok);

    const renamedFirst = interviewOf(renamed.job.flow[0]);
    assert.equal(renamedFirst.round, '技术一面');
    assert.equal(renamedFirst.status, 'done');
    assert.equal(renamed.job.flow[1]!.id, secondNode.id);
    const renamedLatest = interviewOf(getLatestFlowNode(renamed.job));
    assert.equal(renamedLatest.round, '二面');
  });
});
