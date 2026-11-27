/** 任务 4.1：从公开业务入口走通完整旅程。 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clearOutcome,
  createJob,
  getLatestFlowNode,
  isFollowingUp,
  logAppliedStep,
  logAssessmentStep,
  logInterviewStep,
  logOfferStep,
  logOcStep,
  orderJobList,
  recordOutcome,
  removeLatestStep,
  setJobStar,
  updateAssessmentStep,
  updateInterviewStep,
  updateJobProfile,
  updateOfferStep,
  type FlowNode,
  type InterviewNode,
  type Job,
  type OfferNode,
} from '../../src/domain/index.ts';
import { createTestIdFactory } from './helpers.ts';

describe('完整旅程（4.1）', () => {
  it('只贴链接收藏 → 加星 → 补资料 → 投递 → 测评完成 → 面试改期标已面 → OC → 书面 Offer → 本人拒绝', () => {
    let current: Job;
    const created = createJob(
      { postingUrl: 'https://jobs.example.com/qr-8001' },
      { generateId: createTestIdFactory('job') },
    );
    assert.ok(created.ok);
    current = created.job;

    // 加星
    const starred = setJobStar(current, current.version, true);
    assert.ok(starred.ok);
    current = starred.job;

    // 补填六项资料
    const profiled = updateJobProfile(current, current.version, {
      company: '青禾科技',
      position: '前端工程师',
      postingUrl: 'https://jobs.example.com/qr-8001',
      location: '杭州',
      salary: '25k·14薪',
      jobDescription: '负责看板与数据可视化，纯文本 JD。',
    });
    assert.ok(profiled.ok);
    current = profiled.job;

    // 已投递
    const applied = logAppliedStep(current, current.version);
    assert.ok(applied.ok);
    current = applied.job;
    assert.equal(getLatestFlowNode(current)?.kind, 'applied');

    // 登记测评并手动完成
    const assessment = logAssessmentStep(current, current.version, {
      deadline: { precision: 'date', date: '2026-11-28' },
    });
    assert.ok(assessment.ok);
    current = assessment.job;
    const assessmentNode = current.flow[1]!;
    const assessmentDone = updateAssessmentStep(current, current.version, assessmentNode.id, {
      completed: true,
    });
    assert.ok(assessmentDone.ok);
    current = assessmentDone.job;

    // 登记一面并安排时间
    const firstRound = logInterviewStep(current, current.version, {
      round: '一面',
      scheduledAt: { precision: 'date', date: '2026-12-01' },
    });
    assert.ok(firstRound.ok);
    current = firstRound.job;
    const firstNode = current.flow[2] as InterviewNode;

    // 面试改期（改为具体时刻）并标为已面
    const rescheduled = updateInterviewStep(current, current.version, firstNode.id, {
      scheduledAt: { precision: 'datetime', date: '2026-12-02', time: '15:30' },
    });
    assert.ok(rescheduled.ok);
    current = rescheduled.job;
    const marked = updateInterviewStep(current, current.version, firstNode.id, {
      status: 'done',
    });
    assert.ok(marked.ok);
    current = marked.job;

    // OC
    const oc = logOcStep(current, current.version);
    assert.ok(oc.ok);
    current = oc.job;

    // 书面 Offer：先留空期限，之后补填只含日期的答复期限
    const offer = logOfferStep(current, current.version);
    assert.ok(offer.ok);
    current = offer.job;
    const offerNode = current.flow[4] as OfferNode;
    const deadlineSet = updateOfferStep(current, current.version, offerNode.id, {
      replyDeadline: { precision: 'date', date: '2026-12-10' },
    });
    assert.ok(deadlineSet.ok);
    current = deadlineSet.job;

    // 本人拒绝
    const declined = recordOutcome(current, current.version, 'declinedByUser');
    assert.ok(declined.ok);
    current = declined.job;

    // 当前进展与节点顺序
    const kinds = current.flow.map((node: FlowNode) => node.kind);
    assert.deepEqual(kinds, ['applied', 'assessment', 'interview', 'oc', 'offer']);
    assert.equal(getLatestFlowNode(current)?.kind, 'offer');

    const firstFinal = current.flow[2] as InterviewNode;
    assert.equal(firstFinal.round, '一面');
    assert.equal(firstFinal.status, 'done');
    assert.deepEqual(firstFinal.scheduledAt, {
      precision: 'datetime',
      date: '2026-12-02',
      time: '15:30',
    });

    const offerFinal = current.flow[4] as OfferNode;
    assert.ok(offerFinal.replyDeadline);
    assert.equal(offerFinal.replyDeadline.precision, 'date');
    assert.equal(offerFinal.replyDeadline.date, '2026-12-10');

    assert.equal(current.outcome?.status, 'declinedByUser');
    assert.equal(isFollowingUp(current), false);
    assert.equal(current.version, 13);

    // 补充验收：清除结果后恢复跟进；再撤回末步（书面 Offer）回到 OC。
    const cleared = clearOutcome(current, current.version);
    assert.ok(cleared.ok);
    assert.equal(isFollowingUp(cleared.job), true);

    const withdrawn = removeLatestStep(
      cleared.job,
      cleared.job.version,
      offerNode.id,
    );
    assert.ok(withdrawn.ok);
    assert.equal(getLatestFlowNode(withdrawn.job)?.kind, 'oc');
    assert.equal(withdrawn.job.flow.length, 4);
    assert.equal(withdrawn.job.starred, true);

    // 星标岗位仍优先展示
    const other = createJob({ company: '南屿信息', position: '产品经理' });
    assert.ok(other.ok);
    const list = orderJobList([other.job, withdrawn.job]);
    assert.equal(list[0]!.id, withdrawn.job.id);
  });
});
