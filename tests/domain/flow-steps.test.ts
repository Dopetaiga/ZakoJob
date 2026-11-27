/** 任务 2.1：按用户登记的次序追加环节。 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createJob,
  getLatestFlowNode,
  logAppliedStep,
  logInterviewStep,
  logOcStep,
  updateInterviewStep,
  type FlowNode,
  type InterviewNode,
} from '../../src/domain/index.ts';
import { createTestIdFactory } from './helpers.ts';

function interviewOf(node: FlowNode | null | undefined): InterviewNode {
  assert.ok(node && node.kind === 'interview');
  return node;
}

describe('追加已投递、笔试、面试、OC 和书面 Offer（2.1）', () => {
  it('空流程直接记二面，轮次仍显示为二面', () => {
    const created = createJob({ company: '青禾科技', position: '前端工程师' });
    assert.ok(created.ok);

    const step = logInterviewStep(created.job, created.job.version, {
      round: '二面',
    });
    assert.ok(step.ok);
    assert.equal(step.job.flow.length, 1);

    const latest = interviewOf(getLatestFlowNode(step.job));
    assert.equal(latest.round, '二面');
    assert.equal(latest.status, 'pending');
    assert.equal(latest.scheduledAt, undefined);
  });

  it('投递后跳过笔试直接约一面', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-2001' });
    assert.ok(created.ok);
    const applied = logAppliedStep(created.job, created.job.version);
    assert.ok(applied.ok);
    const interview = logInterviewStep(applied.job, applied.job.version, {
      round: '一面',
    });
    assert.ok(interview.ok);

    assert.equal(interview.job.flow.length, 2);
    assert.equal(interview.job.flow[0]!.kind, 'applied');
    const latest = interviewOf(getLatestFlowNode(interview.job));
    assert.equal(latest.round, '一面');
  });

  it('轮次名称为空时拒绝登记', () => {
    const created = createJob({ company: '青禾科技', position: '前端工程师' });
    assert.ok(created.ok);
    const step = logInterviewStep(created.job, created.job.version, { round: '   ' });
    assert.ok(!step.ok);
    assert.equal(step.failure.reason, 'invalidInput');
  });

  it('两份「一面 · 已面」申请分别添加二面或直达 OC', () => {
    const buildAppliedFirstRound = () => {
      const created = createJob({ postingUrl: 'https://jobs.example.com/qr-2002' });
      assert.ok(created.ok);
      const applied = logAppliedStep(created.job, created.job.version, {
        generateId: createTestIdFactory('a'),
      });
      assert.ok(applied.ok);
      const first = logInterviewStep(applied.job, applied.job.version, {
        round: '一面',
      });
      assert.ok(first.ok);
      const done = updateInterviewStep(
        first.job,
        first.job.version,
        first.job.flow[1]!.id,
        { status: 'done' },
      );
      assert.ok(done.ok);
      return done.job;
    };

    const left = buildAppliedFirstRound();
    const right = buildAppliedFirstRound();

    const second = logInterviewStep(left, left.version, { round: '二面' });
    assert.ok(second.ok);
    const oc = logOcStep(right, right.version);
    assert.ok(oc.ok);

    const leftLatest = interviewOf(getLatestFlowNode(second.job));
    assert.equal(leftLatest.round, '二面');
    assert.equal(second.job.flow.length, 3);

    const rightLatest = getLatestFlowNode(oc.job);
    assert.ok(rightLatest);
    assert.equal(rightLatest.kind, 'oc');
    assert.equal(oc.job.flow.length, 3);

    const leftFirstRound = interviewOf(second.job.flow[1]);
    assert.equal(leftFirstRound.round, '一面');
    assert.equal(leftFirstRound.status, 'done');
    const rightFirstRound = interviewOf(oc.job.flow[1]);
    assert.equal(rightFirstRound.round, '一面');
    assert.equal(rightFirstRound.status, 'done');
  });

  it('每次登记只增加选中的节点并推进版本', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-2003' });
    assert.ok(created.ok);
    const applied = logAppliedStep(created.job, created.job.version);
    assert.ok(applied.ok);
    const oc = logOcStep(applied.job, applied.job.version);
    assert.ok(oc.ok);

    assert.equal(oc.job.flow.length, 2);
    assert.equal(oc.job.flow[0]!.kind, 'applied');
    assert.equal(oc.job.flow[1]!.kind, 'oc');
    assert.equal(oc.job.version, created.job.version + 2);
  });
});
