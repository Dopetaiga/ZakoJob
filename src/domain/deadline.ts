/** 期限的格式校验。日期被补成午夜会改变「当日答复」的含义，因此按用户输入分别保存。 */

import type { Deadline } from './types.ts';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 校验期限格式；通过时返回 null，否则返回可直接展示的问题说明。 */
export function validateDeadline(deadline: Deadline): string | null {
  if (!DATE_PATTERN.test(deadline.date)) {
    return `日期格式应为 YYYY-MM-DD，收到「${deadline.date}」`;
  }
  const day = new Date(`${deadline.date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== deadline.date) {
    return '请输入有效的日历日期。';
  }
  if (deadline.precision === 'datetime' && !TIME_PATTERN.test(deadline.time)) {
    return `时刻格式应为 24 小时制 HH:mm，收到「${deadline.time}」`;
  }
  return null;
}
