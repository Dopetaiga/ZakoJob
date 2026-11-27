/** 任务 2.3：书面 Offer 与可选答复期限。 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createJob,
  getLatestFlowNode,
  logOcStep,
  logOfferStep,
  updateOfferStep,
  type FlowNode,
  type OfferNode,
} from '../../src/domain/index.ts';

function offerOf(node: FlowNode | null | undefined): OfferNode {
  assert.ok(node && node.kind === 'offer');
  return node;
}

describe('书面 Offer 与答复期限（2.3）', () => {
  it('直接登记书面 Offer，期限留空', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-4001' });
    assert.ok(created.ok);
    const step = logOfferStep(created.job, created.job.version);
    assert.ok(step.ok);

    const offer = offerOf(getLatestFlowNode(step.job));
    assert.equal(offer.replyDeadline, undefined);
    assert.equal(step.job.flow.length, 1);
    assert.equal(step.job.outcome, null);
  });

  it('事后在同一 Offer 上只填日期，记录保留日期精度', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-4002' });
    assert.ok(created.ok);
    const step = logOfferStep(created.job, created.job.version);
    assert.ok(step.ok);
    const offerNode = offerOf(step.job.flow[0]);

    const filled = updateOfferStep(step.job, step.job.version, offerNode.id, {
      replyDeadline: { precision: 'date', date: '2026-12-10' },
    });
    assert.ok(filled.ok);

    const offer = offerOf(filled.job.flow[0]);
    assert.equal(offer.id, offerNode.id);
    assert.ok(offer.replyDeadline);
    assert.equal(offer.replyDeadline.precision, 'date');
    assert.equal(offer.replyDeadline.date, '2026-12-10');
    assert.equal('time' in offer.replyDeadline, false);
  });

  it('有 OC 再登记书面 Offer，期限精确到时刻并归属 Offer', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-4003' });
    assert.ok(created.ok);
    const oc = logOcStep(created.job, created.job.version);
    assert.ok(oc.ok);
    const offer = logOfferStep(oc.job, oc.job.version, {
      replyDeadline: {
        precision: 'datetime',
        date: '2026-12-03',
        time: '18:00',
        timeZone: 'Asia/Shanghai',
      },
    });
    assert.ok(offer.ok);

    assert.equal(offer.job.flow.length, 2);
    assert.equal(offer.job.flow[0]!.kind, 'oc');

    const offerNode = offerOf(getLatestFlowNode(offer.job));
    assert.deepEqual(offerNode.replyDeadline, {
      precision: 'datetime',
      date: '2026-12-03',
      time: '18:00',
      timeZone: 'Asia/Shanghai',
    });
  });

  it('期限格式不合法时拒绝，记录保持不变', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-4004' });
    assert.ok(created.ok);

    const badDate = logOfferStep(created.job, created.job.version, {
      replyDeadline: { precision: 'date', date: '2026/12/10' },
    });
    assert.ok(!badDate.ok);
    assert.equal(badDate.failure.reason, 'invalidInput');

    const badTime = logOfferStep(created.job, created.job.version, {
      replyDeadline: { precision: 'datetime', date: '2026-12-10', time: '6:00' },
    });
    assert.ok(!badTime.ok);
    assert.equal(badTime.failure.reason, 'invalidInput');

    // 动作失败不改动入参记录：流程仍为空，版本未推进。
    assert.deepEqual(created.job.flow, []);
    assert.equal(created.job.version, 1);
  });

  it('答复期限已过也不推断申请结果', () => {
    const created = createJob({ postingUrl: 'https://jobs.example.com/qr-4005' });
    assert.ok(created.ok);
    const step = logOfferStep(created.job, created.job.version, {
      replyDeadline: { precision: 'datetime', date: '2026-01-01', time: '18:00' },
    });
    assert.ok(step.ok);

    // 领域不随时间自动改写记录：结果仍为空，须由用户登记。
    assert.equal(step.job.outcome, null);
    assert.equal(step.job.flow.length, 1);
    const offer = offerOf(step.job.flow[0]);
    assert.deepEqual(offer.replyDeadline, {
      precision: 'datetime',
      date: '2026-01-01',
      time: '18:00',
    });
  });
});
