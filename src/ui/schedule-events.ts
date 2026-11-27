/**
 * 跨岗位日程事件投影（view-job-schedule 1.1）。
 *
 * 日历与跨岗位时间线两张视图共用同一份投影：从已读取的岗位卡
 * 生成带业务日期的安排清单，不引入新的领域模型或存储。
 * 日期始终表示卡片上的安排或期限，保留原精度：
 * 只投影有明确日期（date）的节点，时间待定或无日期的节点不投影；
 * 期限类节点即使已过期也保留，由 active 与状态说明其有效性。
 */

import type { JobCardData, JobStep, StepTimeValue } from './types.ts';

export interface ScheduleEvent {
  /** 来源岗位 ID，用于从视图定位回岗位卡。 */
  jobId: string;
  /** 来源节点 ID，改期后原条目随之移动，撤回后消失。 */
  stepId: string;
  company: string;
  position: string;
  /** 节点业务名称：面试为实际轮次（如「二面」），另有「笔试 / 测评」「书面 Offer」。 */
  label: string;
  /** 业务日期 YYYY-MM-DD，来自安排或期限，保留只含日期的精度。 */
  date: string;
  /** 具体时刻 HH:mm；只填日期时缺省，不自动补零点。 */
  time?: string;
  /** 是否计入有效安排：沿用近期安排规则，已结束申请与已完成节点为 false。 */
  active: boolean;
  /** 节点状态的明确说明：待面试／已面／待完成／已完成／答复期限。 */
  status: string;
}

interface DatedNode {
  stepId: string;
  label: string;
  status: string;
  /** 已完成或已面：不再计入有效安排。 */
  settled: boolean;
  time: StepTimeValue;
}

/** 有效性沿用近期安排规则：跟进中的岗位才计入有效安排。 */
function isJobActive(job: JobCardData): boolean {
  return job.result === null;
}

/** 抽取节点上有明确日期的时间值；待定或无日期返回 null。 */
function getDatedTime(time: StepTimeValue | undefined): StepTimeValue | null {
  if (!time || typeof time.date !== 'string' || !time.date.trim()) {
    return null;
  }
  return time;
}

function collectDatedNode(step: JobStep): DatedNode | null {
  switch (step.kind) {
    case 'interview': {
      const time = getDatedTime(step.scheduledAt);
      if (!time) {
        return null;
      }
      const pending = step.status === 'pending';
      return {
        stepId: step.id,
        label: step.roundLabel.trim() || '面试',
        status: pending ? '待面试' : '已面',
        settled: !pending,
        time,
      };
    }
    case 'assessment': {
      const time = getDatedTime(step.deadline);
      if (!time) {
        return null;
      }
      return {
        stepId: step.id,
        label: '笔试 / 测评',
        status: step.completed ? '已完成' : '待完成',
        settled: step.completed,
        time,
      };
    }
    case 'written_offer': {
      const time = getDatedTime(step.deadline);
      if (!time) {
        return null;
      }
      return {
        stepId: step.id,
        label: '书面 Offer',
        status: '答复期限',
        settled: false,
        time,
      };
    }
    default:
      // 已投递与 OC 节点没有业务日期，只保留流程位置。
      return null;
  }
}

/**
 * 把已读取的岗位卡投影为跨岗位日程事件。
 * 输出保持输入的岗位顺序与节点顺序，日历和时间线视图据此再按日期组织。
 * 期限类节点（笔试截止、答复期限）即使过期也保留，active 与 status 表明其状态；
 * 已结束申请的所有安排 active 均为 false，仍可从视图定位回原岗位。
 */
export function listScheduleEvents(
  jobs: readonly JobCardData[],
): ScheduleEvent[] {
  const events: ScheduleEvent[] = [];

  for (const job of jobs) {
    const jobActive = isJobActive(job);
    for (const step of job.steps) {
      const dated = collectDatedNode(step);
      if (!dated) {
        continue;
      }
      events.push({
        jobId: job.id,
        stepId: dated.stepId,
        company: job.company,
        position: job.position,
        label: dated.label,
        date: dated.time.date,
        ...(dated.time.time ? { time: dated.time.time } : {}),
        active: jobActive && !dated.settled,
        status: dated.status,
      });
    }
  }

  return events;
}
