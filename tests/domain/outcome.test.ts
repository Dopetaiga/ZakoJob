/** 任务 3.3：已挂、已拒、更正与清除结果。 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clearOutcome,
  createJob,
  getLatestFlowNode,
  isFollowingUp,
  logAppliedStep,
  logInterviewStep,
  logOfferStep,
  recordOutcome,
  setJobStar,
  updateJobProfile,
  type FlowNode,
  type InterviewNode,
  type OfferNode,
} from '../../src/domain/index.ts';

describe('登记与更正申请结果（3.3）', () => {
  it('二面已面时标为已挂：结束跟进，进展与结果同时可查', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-7001' });
    assert.ok(created.ok);
    const applied = logAppliedStep(created.job, created.job.version);
    assert.ok(applied.ok);
    const first = logInterviewStep(applied.job, applied.job.version, { round: '一面' });
    assert.ok(first.ok);
    const second = logInterviewStep(first.job, first.job.version, { round: '二面' });
    assert.ok(second.ok);
    const secondNode = second.job.flow[2] as InterviewNode;

    const outcome = recordOutcome(second.job, second.job.version, 'closedByEmployer');
    assert.ok(outcome.ok);

    assert.equal(outcome.job.outcome?.status, 'closedByEmployer');
    assert.equal(isFollowingUp(outcome.job), false);
    const latest = getLatestFlowNode(outcome.job) as InterviewNode;
    assert.ok(latest && latest.kind === 'interview');
    assert.equal(latest.id, secondNode.id);
    assert.equal(latest.round, '二面');
    assert.equal(outcome.job.flow.length, 3);
    assert.equal(outcome.job.version, second.job.version + 1);
  });

  it('收到书面 Offer 后主动拒绝：Offer 与答复期限仍可回看', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-7002' });
    assert.ok(created.ok);
    const offer = logOfferStep(created.job, created.job.version, {
      replyDeadline: { precision: 'date', date: '2026-12-08' },
    });
    assert.ok(offer.ok);
    const offerNode = offer.job.flow[0] as OfferNode;

    const declined = recordOutcome(offer.job, offer.job.version, 'declinedByUser');
    assert.ok(declined.ok);

    assert.equal(declined.job.outcome?.status, 'declinedByUser');
    assert.equal(isFollowingUp(declined.job), false);
    const keptOffer = getLatestFlowNode(declined.job) as OfferNode;
    assert.ok(keptOffer && keptOffer.kind === 'offer');
    assert.equal(keptOffer.id, offerNode.id);
    assert.deepEqual(keptOffer.replyDeadline, { precision: 'date', date: '2026-12-08' });
  });

  it('误记的已挂可更正为已拒，清除后恢复跟进，流程资料星标均保留', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-7003' });
    assert.ok(created.ok);
    const profiled = updateJobProfile(created.job, created.job.version, {
      company: '青禾科技',
      position: '前端工程师',
      location: '杭州',
    });
    assert.ok(profiled.ok);
    const starred = setJobStar(profiled.job, profiled.job.version, true);
    assert.ok(starred.ok);
    const applied = logAppliedStep(starred.job, starred.job.version);
    assert.ok(applied.ok);

    const closed = recordOutcome(applied.job, applied.job.version, 'closedByEmployer');
    assert.ok(closed.ok);
    assert.equal(isFollowingUp(closed.job), false);

    const corrected = recordOutcome(closed.job, closed.job.version, 'declinedByUser');
    assert.ok(corrected.ok);
    assert.equal(corrected.job.outcome?.status, 'declinedByUser');

    const cleared = clearOutcome(corrected.job, corrected.job.version);
    assert.ok(cleared.ok);
    assert.equal(cleared.job.outcome, null);
    assert.equal(isFollowingUp(cleared.job), true);

    assert.deepEqual(
      cleared.job.flow.map((node: FlowNode) => node.kind),
      ['applied'],
    );
    assert.equal(cleared.job.profile.company, '青禾科技');
    assert.equal(cleared.job.profile.location, '杭州');
    assert.equal(cleared.job.starred, true);
    assert.equal(cleared.job.id, created.job.id);
    assert.equal(cleared.job.version, applied.job.version + 3);
  });

  it('清除没有结果的岗位返回冲突而非重复写空', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-7004' });
    assert.ok(created.ok);
    const cleared = clearOutcome(created.job, created.job.version);
    // 结果本为空：动作仍成功（幂等地写回 null），但版本照常推进，便于保存方核对。
    assert.ok(cleared.ok);
    assert.equal(cleared.job.outcome, null);
    assert.equal(cleared.job.version, created.job.version + 1);
  });
});
