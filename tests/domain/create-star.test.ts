/** 任务 1.1–1.3：建档、补全资料与星标置顶。 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createJob,
  getLatestFlowNode,
  logInterviewStep,
  orderJobList,
  setJobStar,
  updateJobProfile,
} from '../../src/domain/index.ts';
import { createTestIdFactory } from './helpers.ts';

describe('建档与资料（1.1、1.2）', () => {
  it('从公开入口创建一份空流程、无结果的岗位（1.1）', () => {
    const result = createJob(
      { postingUrl: 'https://jobs.example.com/qr-1001' },
      { generateId: createTestIdFactory('job') },
    );

    assert.ok(result.ok);
    const job = result.job;
    assert.equal(job.id, 'job-1');
    assert.equal(job.profile.postingUrl, 'https://jobs.example.com/qr-1001');
    assert.deepEqual(job.flow, []);
    assert.equal(job.outcome, null);
    assert.equal(job.starred, false);
    assert.equal(job.version, 1);
    assert.equal(getLatestFlowNode(job), null);
  });

  it('用公司和职位建档时不要求链接（1.1）', () => {
    const result = createJob({ company: '青禾科技', position: '前端工程师' });

    assert.ok(result.ok);
    assert.equal(result.job.profile.company, '青禾科技');
    assert.equal(result.job.profile.position, '前端工程师');
    assert.equal(result.job.profile.postingUrl, undefined);
    assert.deepEqual(result.job.flow, []);
  });

  it('链接与公司职位都缺失时拒绝建档（1.1）', () => {
    const result = createJob({});
    assert.ok(!result.ok);
    assert.equal(result.failure.reason, 'invalidInput');
  });

  it('纯链接建档后补填六项资料仍是同一条记录（1.2）', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-1002' });
    assert.ok(created.ok);
    const before = created.job;

    const updated = updateJobProfile(before, before.version, {
      company: '青禾科技',
      position: '前端工程师',
      postingUrl: 'https://jobs.example.com/qr-1002',
      location: '杭州',
      salary: '300 元/天',
      jobDescription: '负责看板前端，纯文本 JD。',
    });

    assert.ok(updated.ok);
    assert.equal(updated.job.id, before.id);
    assert.equal(updated.job.profile.company, '青禾科技');
    assert.equal(updated.job.profile.position, '前端工程师');
    assert.equal(updated.job.profile.location, '杭州');
    assert.equal(updated.job.profile.salary, '300 元/天');
    assert.equal(updated.job.profile.jobDescription, '负责看板前端，纯文本 JD。');
    assert.equal(updated.job.version, before.version + 1);
    assert.deepEqual(updated.job.flow, before.flow);
    assert.equal(updated.job.outcome, null);
  });

  it('同一公司的两个岗位可以分别更新（1.2）', () => {
    const first = createJob({ company: '青禾科技', position: '前端工程师' });
    const second = createJob({ company: '青禾科技', position: '测试开发工程师' });
    assert.ok(first.ok && second.ok);
    assert.notEqual(first.job.id, second.job.id);

    const progressed = logInterviewStep(first.job, first.job.version, { round: '一面' });
    assert.ok(progressed.ok);

    const secondAfter = second.job;
    assert.equal(secondAfter.profile.position, '测试开发工程师');
    assert.deepEqual(secondAfter.flow, []);
    assert.equal(secondAfter.version, 1);
    assert.equal(progressed.job.id, first.job.id);
  });
});

describe('星标置顶（1.3）', () => {
  it('仅有链接的岗位也可置顶，取消后回到普通组', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-1003' });
    assert.ok(created.ok);
    const job = created.job;
    const other = createJob({ company: '南屿信息', position: '产品经理' });
    assert.ok(other.ok);

    const starred = setJobStar(job, job.version, true);
    assert.ok(starred.ok);

    const listWithStar = orderJobList([other.job, starred.job]);
    assert.equal(listWithStar[0]!.id, starred.job.id);

    const unstarred = setJobStar(starred.job, starred.job.version, false);
    assert.ok(unstarred.ok);
    assert.equal(unstarred.job.starred, false);
    assert.deepEqual(unstarred.job.flow, []);

    const listAfterUnstar = orderJobList([other.job, unstarred.job]);
    assert.equal(listAfterUnstar[0]!.id, other.job.id);
    assert.equal(listAfterUnstar[1]!.id, unstarred.job.id);
  });

  it('两次星标操作均保留原进展和结果', () => {
    const created = createJob({ company: '青禾科技', position: '前端工程师' });
    assert.ok(created.ok);
    const withStep = logInterviewStep(created.job, created.job.version, {
      round: '一面',
      scheduledAt: { precision: 'date', date: '2026-12-02' },
    });
    assert.ok(withStep.ok);

    const starred = setJobStar(withStep.job, withStep.job.version, true);
    assert.ok(starred.ok);
    const unstarred = setJobStar(starred.job, starred.job.version, false);
    assert.ok(unstarred.ok);

    const latest = getLatestFlowNode(unstarred.job);
    assert.ok(latest);
    assert.equal(latest.kind, 'interview');
    assert.equal(unstarred.job.flow.length, 1);
    assert.equal(unstarred.job.outcome, null);
  });

  it('星标优先展示，同组沿用调用方已有顺序', () => {
    const normal1 = createJob({ company: '甲公司', position: 'A' });
    const normal2 = createJob({ company: '乙公司', position: 'B' });
    const starred1 = createJob({ company: '丙公司', position: 'C' });
    const starred2 = createJob({ company: '丁公司', position: 'D' });
    assert.ok(normal1.ok && normal2.ok && starred1.ok && starred2.ok);

    const starred = [
      setJobStar(starred2.job, starred2.job.version, true),
      setJobStar(starred1.job, starred1.job.version, true),
    ];
    assert.ok(starred.every((step) => step.ok));

    const list = orderJobList([normal1.job, starred[1]!.job, normal2.job, starred[0]!.job]);
    assert.deepEqual(
      list.map((job) => job.id),
      [starred[1]!.job.id, starred[0]!.job.id, normal1.job.id, normal2.job.id],
    );
  });
});
