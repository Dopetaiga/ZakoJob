/** listScheduleEvents 投影测试（view-job-schedule 1.1）。 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { JobCardData, JobStep } from '../../src/ui/types.ts';
import { listScheduleEvents } from '../../src/ui/schedule-events.ts';

function makeJob(overrides: Partial<JobCardData> = {}): JobCardData {
  return {
    id: 'job-1',
    version: 1,
    company: '青禾科技',
    position: '前端工程师',
    starred: false,
    result: null,
    steps: [],
    ...overrides,
  };
}

describe('跨岗位日程事件投影', () => {
  it('面试节点按实际轮次投影，待面试计入有效安排，已面仍可见但不再有效', () => {
    const jobs = [
      makeJob({
        steps: [
          { kind: 'applied', id: 'n-applied' },
          {
            kind: 'interview',
            id: 'n-interview-1',
            roundLabel: '一面',
            status: 'completed',
            scheduledAt: { precision: 'date', date: '2026-11-20' },
          },
          {
            kind: 'interview',
            id: 'n-interview-2',
            roundLabel: '二面',
            status: 'pending',
            scheduledAt: { precision: 'datetime', date: '2026-12-01', time: '15:00' },
          },
        ],
      }),
    ];

    const events = listScheduleEvents(jobs);
    assert.equal(events.length, 2);

    assert.deepEqual(
      {
        jobId: events[0]!.jobId,
        stepId: events[0]!.stepId,
        label: events[0]!.label,
        date: events[0]!.date,
        time: events[0]!.time,
        active: events[0]!.active,
        status: events[0]!.status,
      },
      {
        jobId: 'job-1',
        stepId: 'n-interview-1',
        label: '一面',
        date: '2026-11-20',
        time: undefined,
        active: false,
        status: '已面',
      },
    );

    assert.deepEqual(
      {
        stepId: events[1]!.stepId,
        label: events[1]!.label,
        date: events[1]!.date,
        time: events[1]!.time,
        active: events[1]!.active,
        status: events[1]!.status,
      },
      {
        stepId: 'n-interview-2',
        label: '二面',
        date: '2026-12-01',
        time: '15:00',
        active: true,
        status: '待面试',
      },
    );
  });

  it('笔试截止与书面 Offer 答复期限保留过期条目，状态明确', () => {
    const jobs = [
      makeJob({
        steps: [
          {
            kind: 'assessment',
            id: 'n-assessment',
            completed: false,
            deadline: { precision: 'date', date: '2026-11-01' },
          },
          {
            kind: 'written_offer',
            id: 'n-offer',
            deadline: { precision: 'datetime', date: '2026-11-05', time: '18:00' },
          },
        ],
      }),
    ];

    const events = listScheduleEvents(jobs);
    assert.equal(events.length, 2);
    assert.equal(events[0]!.label, '笔试 / 测评');
    assert.equal(events[0]!.date, '2026-11-01');
    assert.equal(events[0]!.time, undefined);
    assert.equal(events[0]!.active, true, '未完成的笔试截止即使已过期也计入有效安排');
    assert.equal(events[0]!.status, '待完成');
    assert.equal(events[1]!.label, '书面 Offer');
    assert.equal(events[1]!.date, '2026-11-05');
    assert.equal(events[1]!.time, '18:00');
    assert.equal(events[1]!.status, '答复期限');
  });

  it('已完成的笔试与已结束申请的安排 active 为 false，仍投影供定位', () => {
    const jobs = [
      makeJob({
        id: 'job-done',
        result: 'rejected',
        steps: [
          {
            kind: 'interview',
            id: 'n-past',
            roundLabel: '二面',
            status: 'pending',
            scheduledAt: { precision: 'date', date: '2026-12-10' },
          },
          {
            kind: 'assessment',
            id: 'n-assessment-done',
            completed: true,
            deadline: { precision: 'date', date: '2026-12-11' },
          },
          {
            kind: 'written_offer',
            id: 'n-offer-past',
            deadline: { precision: 'date', date: '2026-12-12' },
          },
        ],
      }),
    ];

    const events = listScheduleEvents(jobs);
    assert.equal(events.length, 3, '已结束申请的节点仍投影，供视图定位回原岗位');
    for (const event of events) {
      assert.equal(event.active, false, '已结束申请的安排不再有效');
      assert.equal(event.jobId, 'job-done');
    }
    assert.equal(events.find((e) => e.stepId === 'n-past')!.status, '待面试');
    assert.equal(events.find((e) => e.stepId === 'n-assessment-done')!.status, '已完成');
    assert.equal(events.find((e) => e.stepId === 'n-offer-past')!.status, '答复期限');
  });

  it('排除待定与无日期节点，已投递与 OC 节点不投影', () => {
    const jobs = [
      makeJob({
        steps: [
          { kind: 'applied', id: 'n-applied' } as JobStep,
          { kind: 'oc', id: 'n-oc' } as JobStep,
          {
            kind: 'interview',
            id: 'n-undated',
            roundLabel: '三面',
            status: 'pending',
          },
          {
            kind: 'interview',
            id: 'n-pending-date',
            roundLabel: '四面',
            status: 'pending',
            scheduledAt: { precision: 'date', date: '' },
          },
          {
            kind: 'written_offer',
            id: 'n-offer-undated',
          },
        ],
      }),
    ];

    const events = listScheduleEvents(jobs);
    assert.deepEqual(events, [], '无明确日期的节点不进入两张视图，留在岗位卡内');
  });

  it('跨岗位投影保留岗位顺序与节点顺序，来源信息可定位', () => {
    const jobs = [
      makeJob({
        id: 'job-a',
        company: '青禾科技',
        position: '前端工程师',
        steps: [
          {
            kind: 'interview',
            id: 'n-a',
            roundLabel: '二面',
            status: 'pending',
            scheduledAt: { precision: 'date', date: '2026-12-02' },
          },
        ],
      }),
      makeJob({
        id: 'job-b',
        company: '极光云',
        position: '平台工程师',
        steps: [
          {
            kind: 'assessment',
            id: 'n-b',
            completed: false,
            deadline: { precision: 'date', date: '2026-12-02' },
          },
        ],
      }),
    ];

    const events = listScheduleEvents(jobs);
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map((e) => `${e.jobId}:${e.stepId}`),
      ['job-a:n-a', 'job-b:n-b'],
      '投影保持输入顺序，日历与时间线视图按日期自行组织',
    );
    assert.equal(events[0]!.company, '青禾科技');
    assert.equal(events[0]!.position, '前端工程师');
    assert.equal(events[1]!.company, '极光云');
  });

  it('同岗同日的多个节点分别投影，可区分并分别定位', () => {
    const jobs = [
      makeJob({
        steps: [
          {
            kind: 'assessment',
            id: 'n-same-1',
            completed: false,
            deadline: { precision: 'date', date: '2026-12-05' },
          },
          {
            kind: 'interview',
            id: 'n-same-2',
            roundLabel: '一面',
            status: 'pending',
            scheduledAt: { precision: 'datetime', date: '2026-12-05', time: '10:00' },
          },
        ],
      }),
    ];

    const events = listScheduleEvents(jobs);
    assert.equal(events.length, 2);
    assert.ok(events.every((e) => e.date === '2026-12-05'));
    assert.deepEqual(
      events.map((e) => e.stepId),
      ['n-same-1', 'n-same-2'],
    );
    assert.equal(events[0]!.label, '笔试 / 测评');
    assert.equal(events[1]!.label, '一面');
  });
});
