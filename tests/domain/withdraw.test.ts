/** 任务 3.1：按指定节点撤回末步。 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createJob,
  logAppliedStep,
  logInterviewStep,
  removeLatestStep,
  setJobStar,
  updateJobProfile,
  type InterviewNode,
} from '../../src/domain/index.ts';

describe('逐步撤回末节点（3.1）', () => {
  const buildThreeSteps = () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-5001' });
    assert.ok(created.ok);
    const applied = logAppliedStep(created.job, created.job.version);
    assert.ok(applied.ok);
    const first = logInterviewStep(applied.job, applied.job.version, { round: '一面' });
    assert.ok(first.ok);
    const second = logInterviewStep(first.job, first.job.version, { round: '二面' });
    assert.ok(second.ok);
    const appliedNode = second.job.flow[0]!;
    const firstNode = second.job.flow[1] as InterviewNode;
    const secondNode = second.job.flow[2] as InterviewNode;
    return { job: second.job, appliedNode, firstNode, secondNode };
  };

  it('拒绝撤回中间节点，三个节点仍在', () => {
    const { job, firstNode } = buildThreeSteps();

    const rejected = removeLatestStep(job, job.version, firstNode.id);
    assert.ok(!rejected.ok);
    assert.equal(rejected.failure.reason, 'lastNodeMismatch');
    assert.equal(job.flow.length, 3);
  });

  it('逐次撤回两个末节点，最后剩下已投递', () => {
    const { job, firstNode, secondNode } = buildThreeSteps();

    const removeSecond = removeLatestStep(job, job.version, secondNode.id);
    assert.ok(removeSecond.ok);
    assert.equal(removeSecond.job.flow.length, 2);
    assert.equal(removeSecond.job.flow.at(-1)!.id, firstNode.id);

    const removeFirst = removeLatestStep(
      removeSecond.job,
      removeSecond.job.version,
      firstNode.id,
    );
    assert.ok(removeFirst.ok);
    assert.equal(removeFirst.job.flow.length, 1);
    assert.equal(removeFirst.job.flow[0]!.kind, 'applied');
    assert.equal(removeFirst.job.id, job.id);
  });

  it('撤回星标岗位上唯一的一轮面试后，岗位资料和星标保留', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-5002' });
    assert.ok(created.ok);
    const profiled = updateJobProfile(created.job, created.job.version, {
      company: '青禾科技',
      position: '前端工程师',
    });
    assert.ok(profiled.ok);
    const starred = setJobStar(profiled.job, profiled.job.version, true);
    assert.ok(starred.ok);
    const interview = logInterviewStep(starred.job, starred.job.version, { round: '一面' });
    assert.ok(interview.ok);
    const interviewNode = interview.job.flow[0] as InterviewNode;

    const withdrawn = removeLatestStep(
      interview.job,
      interview.job.version,
      interviewNode.id,
    );
    assert.ok(withdrawn.ok);
    assert.deepEqual(withdrawn.job.flow, []);
    assert.equal(withdrawn.job.starred, true);
    assert.equal(withdrawn.job.profile.company, '青禾科技');
    assert.equal(withdrawn.job.profile.position, '前端工程师');
    assert.equal(withdrawn.job.id, interview.job.id);
    assert.equal(withdrawn.job.outcome, null);
  });

  it('空流程上的重复撤回请求不会继续删除', () => {
    const { job, secondNode } = buildThreeSteps();

    const once = removeLatestStep(job, job.version, secondNode.id);
    assert.ok(once.ok);
    assert.equal(once.job.flow.length, 2);
    const removedNode = secondNode;

    // 拿着已撤掉的节点 ID 再提交一次：已无该末节点。
    const again = removeLatestStep(once.job, once.job.version, removedNode.id);
    assert.ok(!again.ok);
    assert.equal(again.failure.reason, 'lastNodeMismatch');
    assert.equal(once.job.flow.length, 2);

    // 从一开始就是空流程的岗位同样无法撤回。
    const empty = createJob({ postingUrl: 'https://jobs.example.com/qr-5003' });
    assert.ok(empty.ok);
    const fromEmpty = removeLatestStep(empty.job, empty.job.version, removedNode.id);
    assert.ok(!fromEmpty.ok);
    assert.equal(fromEmpty.failure.reason, 'lastNodeMismatch');
    assert.equal(empty.job.flow.length, 0);
  });

  it('版本过时的撤回请求直接返回冲突', () => {
    const { job, secondNode } = buildThreeSteps();

    const stale = removeLatestStep(job, job.version - 1, secondNode.id);
    assert.ok(!stale.ok);
    assert.equal(stale.failure.reason, 'versionConflict');
    assert.equal(job.flow.length, 3);
  });
});
