import { getJobDisplayName, getLatestStep, getResultLabel, sortJobsByStar } from '../format.ts';
import { createIcon } from '../icons.ts';
import { listScheduleEvents, type ScheduleEvent } from '../schedule-events.ts';
import type { JobCardData } from '../types.ts';

export interface ScheduleViewState {
  today: string;
  calendarMonth: string;
  selectedDate: string;
  timelineWindowStart: string;
  timelineSpanDays: number;
}

const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日'] as const;
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
const DEFAULT_TIMELINE_SPAN_DAYS = 21;
const DEFAULT_TIMELINE_PAST_OFFSET = 7;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateKey(dateKey: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(dateKey: string, deltaDays: number): string {
  const d = parseDateKey(dateKey);
  d.setDate(d.getDate() + deltaDays);
  return formatLocalDateKey(d);
}

function shiftMonth(monthKey: string, deltaMonths: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  const year = match ? Number(match[1]) : new Date().getFullYear();
  const month = match ? Number(match[2]) - 1 : new Date().getMonth();
  const d = new Date(year, month + deltaMonths, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function formatMonthHeading(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  return `${Number(match[1])}年${Number(match[2])}月`;
}

function formatDayHeading(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  const d = parseDateKey(dateKey);
  const weekday = WEEKDAY_NAMES[d.getDay()] ?? '';
  return `${Number(match[2])}月${Number(match[3])}日 ${weekday}`.trim();
}

function formatShortDate(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  return `${Number(match[2])}/${Number(match[3])}`;
}

function sortEventsForDay(events: readonly ScheduleEvent[]): ScheduleEvent[] {
  return [...events].sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time && !b.time) return -1;
    if (!a.time && b.time) return 1;
    return 0;
  });
}

function getEventKindTone(event: ScheduleEvent): 'interview' | 'deadline' | 'offer' {
  if (event.label === '书面 Offer' || event.status === '答复期限') return 'offer';
  if (event.label.includes('笔试') || event.status === '待完成' || event.status === '已完成') {
    return 'deadline';
  }
  return 'interview';
}

function formatCalendarEventSummary(event: ScheduleEvent): string {
  const kindText =
    event.status === '待完成'
      ? '笔试截止'
      : event.status === '答复期限'
        ? 'Offer 答复期限'
        : event.status;
  return `${event.label} · ${kindText}`;
}

export function createScheduleViewState(today: Date = new Date()): ScheduleViewState {
  const todayKey = formatLocalDateKey(today);
  return {
    today: todayKey,
    calendarMonth: todayKey.slice(0, 7),
    selectedDate: todayKey,
    timelineWindowStart: addDays(todayKey, -DEFAULT_TIMELINE_PAST_OFFSET),
    timelineSpanDays: DEFAULT_TIMELINE_SPAN_DAYS,
  };
}

/**
 * Renders interactive monthly Calendar view reading active scheduled/deadline events from jobs.
 * Supports previous/next month, jumping to today, inspecting full day agenda, and locating source cards/nodes.
 */
export function createCalendarView(
  jobs: readonly JobCardData[],
  state: ScheduleViewState,
  onSelect: (jobId: string, stepId: string) => void,
): HTMLElement {
  const root = document.createElement('section');
  root.className = 'zj-calendar-view';
  root.setAttribute('aria-label', '岗位月历');

  const activeEvents = listScheduleEvents(jobs).filter((ev) => ev.active);
  const eventsByDate = new Map<string, ScheduleEvent[]>();
  for (const ev of activeEvents) {
    const list = eventsByDate.get(ev.date) ?? [];
    list.push(ev);
    eventsByDate.set(ev.date, list);
  }

  const jobNameById = new Map<string, string>();
  for (const job of jobs) {
    jobNameById.set(job.id, getJobDisplayName(job));
  }

  const render = (): void => {
    root.innerHTML = '';

    // Header
    const head = document.createElement('div');
    head.className = 'zj-cal-head';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'zj-cal-title-group';
    const title = document.createElement('h2');
    title.className = 'zj-cal-title';
    title.textContent = formatMonthHeading(state.calendarMonth);
    const activeCount = document.createElement('span');
    activeCount.className = 'zj-cal-subtitle';
    activeCount.textContent = `${activeEvents.length} 项待跟进`;
    titleGroup.append(title, activeCount);

    const controls = document.createElement('div');
    controls.className = 'zj-cal-controls';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'zj-schedule-nav-btn';
    prevBtn.dataset.action = 'calendar-prev-month';
    prevBtn.setAttribute('aria-label', '上个月');
    prevBtn.append(createIcon('chevron-left'), document.createTextNode('上月'));
    prevBtn.addEventListener('click', () => {
      state.calendarMonth = shiftMonth(state.calendarMonth, -1);
      if (!state.selectedDate.startsWith(state.calendarMonth)) {
        state.selectedDate = `${state.calendarMonth}-01`;
      }
      render();
    });

    const todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'zj-schedule-nav-btn';
    todayBtn.dataset.action = 'calendar-today';
    todayBtn.textContent = '今天';
    todayBtn.addEventListener('click', () => {
      state.calendarMonth = state.today.slice(0, 7);
      state.selectedDate = state.today;
      render();
    });

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'zj-schedule-nav-btn';
    nextBtn.dataset.action = 'calendar-next-month';
    nextBtn.setAttribute('aria-label', '下个月');
    nextBtn.append(document.createTextNode('下月'), createIcon('chevron-right'));
    nextBtn.addEventListener('click', () => {
      state.calendarMonth = shiftMonth(state.calendarMonth, 1);
      if (!state.selectedDate.startsWith(state.calendarMonth)) {
        state.selectedDate = `${state.calendarMonth}-01`;
      }
      render();
    });

    controls.append(prevBtn, todayBtn, nextBtn);
    head.append(titleGroup, controls);
    root.append(head);

    // Weekday headers (Mon..Sun)
    const weekdaysRow = document.createElement('div');
    weekdaysRow.className = 'zj-cal-weekdays';
    for (const label of WEEKDAY_HEADERS) {
      const span = document.createElement('span');
      span.textContent = label;
      weekdaysRow.append(span);
    }
    root.append(weekdaysRow);

    // Calendar days grid
    const match = /^(\d{4})-(\d{2})$/.exec(state.calendarMonth);
    const year = match ? Number(match[1]) : new Date().getFullYear();
    const monthIndex = match ? Number(match[2]) - 1 : new Date().getMonth();
    const firstOfMonth = new Date(year, monthIndex, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
    const gridStart = addDays(`${state.calendarMonth}-01`, -startOffset);

    const grid = document.createElement('div');
    grid.className = 'zj-cal-grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', `${formatMonthHeading(state.calendarMonth)}安排`);

    for (let i = 0; i < totalCells; i += 1) {
      const dateKey = addDays(gridStart, i);
      const dayEvents = sortEventsForDay(eventsByDate.get(dateKey) ?? []);
      const isOutside = !dateKey.startsWith(state.calendarMonth);
      const isToday = dateKey === state.today;
      const isSelected = dateKey === state.selectedDate;

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'zj-cal-cell';
      if (isOutside) cell.classList.add('is-outside');
      if (isToday) cell.classList.add('is-today');
      if (isSelected) cell.classList.add('is-selected');
      cell.dataset.date = dateKey;
      cell.setAttribute('aria-pressed', String(isSelected));
      cell.setAttribute(
        'aria-label',
        dayEvents.length > 0
          ? `${dateKey}，${dayEvents.length} 项安排`
          : `${dateKey}，无安排`,
      );
      cell.addEventListener('click', () => {
        state.selectedDate = dateKey;
        if (!dateKey.startsWith(state.calendarMonth)) {
          state.calendarMonth = dateKey.slice(0, 7);
        }
        render();
      });

      const top = document.createElement('div');
      top.className = 'zj-cal-cell-top';
      const dayNum = document.createElement('span');
      dayNum.className = 'zj-cal-day-num';
      dayNum.textContent = String(Number(dateKey.slice(8, 10)));
      top.append(dayNum);
      cell.append(top);

      if (dayEvents.length > 0) {
        const chipList = document.createElement('div');
        chipList.className = 'zj-cal-cell-events';
        const visibleLimit = 2;
        for (const ev of dayEvents.slice(0, visibleLimit)) {
          const chip = document.createElement('span');
          const tone = getEventKindTone(ev);
          chip.className = `zj-cal-chip is-${tone}`;
          const name = jobNameById.get(ev.jobId) || ev.company || ev.position || '岗位';
          chip.textContent = `${name} · ${ev.label}`;
          chipList.append(chip);
        }
        if (dayEvents.length > visibleLimit) {
          const more = document.createElement('span');
          more.className = 'zj-cal-more';
          more.textContent = `+${dayEvents.length - visibleLimit} 项`;
          chipList.append(more);
        }
        cell.append(chipList);

        const dots = document.createElement('div');
        dots.className = 'zj-cal-cell-dots';
        for (const ev of dayEvents.slice(0, 3)) {
          const dot = document.createElement('span');
          dot.className = `zj-cal-dot is-${getEventKindTone(ev)}`;
          dots.append(dot);
        }
        if (dayEvents.length > 3) {
          const cnt = document.createElement('span');
          cnt.className = 'zj-cal-dot-count';
          cnt.textContent = `+${dayEvents.length - 3}`;
          dots.append(cnt);
        }
        cell.append(dots);
      }

      grid.append(cell);
    }

    root.append(grid);

    // Selected-day full agenda list
    const agenda = document.createElement('section');
    agenda.className = 'zj-cal-agenda';
    agenda.setAttribute('aria-label', `${state.selectedDate} 安排清单`);

    const selectedEvents = sortEventsForDay(eventsByDate.get(state.selectedDate) ?? []);
    const agendaHead = document.createElement('div');
    agendaHead.className = 'zj-cal-agenda-head';
    const agendaTitle = document.createElement('h3');
    agendaTitle.className = 'zj-cal-agenda-title';
    agendaTitle.textContent = `${formatDayHeading(state.selectedDate)}${
      state.selectedDate === state.today ? '（今天）' : ''
    }`;
    const agendaCount = document.createElement('span');
    agendaCount.className = 'zj-cal-agenda-count';
    agendaCount.textContent = `${selectedEvents.length} 项安排`;
    agendaHead.append(agendaTitle, agendaCount);
    agenda.append(agendaHead);

    if (selectedEvents.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'zj-cal-agenda-empty';
      empty.textContent = '当日暂无待跟进的面试或截止安排。';
      agenda.append(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'zj-cal-agenda-list';
      for (const ev of selectedEvents) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `zj-schedule-event-btn is-${getEventKindTone(ev)}`;
        btn.dataset.action = 'locate-schedule-event';
        btn.dataset.jobId = ev.jobId;
        btn.dataset.stepId = ev.stepId;

        const main = document.createElement('div');
        main.className = 'zj-schedule-event-main';
        const companyEl = document.createElement('span');
        companyEl.className = 'zj-schedule-event-company';
        const displayName = jobNameById.get(ev.jobId) || ev.company || ev.position || '未命名岗位';
        companyEl.textContent = ev.position && ev.company ? `${ev.company} · ${ev.position}` : displayName;
        const kindEl = document.createElement('span');
        kindEl.className = 'zj-schedule-event-kind';
        kindEl.textContent = formatCalendarEventSummary(ev);
        main.append(companyEl, kindEl);

        const timeEl = document.createElement('span');
        timeEl.className = 'zj-schedule-event-time';
        timeEl.textContent = ev.time ? ev.time : '';

        btn.append(main, timeEl);
        btn.addEventListener('click', () => {
          onSelect(ev.jobId, ev.stepId);
        });
        list.append(btn);
      }
      agenda.append(list);
    }

    root.append(agenda);
  };

  render();
  return root;
}

/**
 * Renders cross-job shared-date-axis timeline view:
 * - One row per job with dated steps (plus quick-jump chips for jobs without dates)
 * - Equidistant natural day columns with sticky job label column and "today" marker
 * - Shows both past/completed/ended and upcoming events with clear visual status differentiation
 */
export function createScheduleTimelineView(
  jobs: readonly JobCardData[],
  state: ScheduleViewState,
  onSelect: (jobId: string, stepId: string) => void,
): HTMLElement {
  const root = document.createElement('section');
  root.className = 'zj-schedule-timeline-view';
  root.setAttribute('aria-label', '跨岗位时间线');

  const allEvents = listScheduleEvents(jobs);
  const eventsByJobAndDate = new Map<string, Map<string, ScheduleEvent[]>>();
  for (const ev of allEvents) {
    let byDate = eventsByJobAndDate.get(ev.jobId);
    if (!byDate) {
      byDate = new Map();
      eventsByJobAndDate.set(ev.jobId, byDate);
    }
    const list = byDate.get(ev.date) ?? [];
    list.push(ev);
    byDate.set(ev.date, list);
  }

  const orderedJobs = sortJobsByStar(jobs);
  const datedJobs = orderedJobs.filter((j) => eventsByJobAndDate.has(j.id));
  const undatedJobs = orderedJobs.filter((j) => !eventsByJobAndDate.has(j.id));

  const render = (scrollTodayIntoView = false): void => {
    root.innerHTML = '';

    const spanDays = Math.max(7, state.timelineSpanDays || DEFAULT_TIMELINE_SPAN_DAYS);
    const days: string[] = [];
    for (let i = 0; i < spanDays; i += 1) {
      days.push(addDays(state.timelineWindowStart, i));
    }
    const rangeEnd = days[days.length - 1]!;

    // Header
    const head = document.createElement('div');
    head.className = 'zj-st-head';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'zj-st-title-group';
    const title = document.createElement('h2');
    title.className = 'zj-st-title';
    title.textContent = '跨岗位日程轴';
    const range = document.createElement('span');
    range.className = 'zj-st-range';
    range.textContent = `${state.timelineWindowStart} 至 ${rangeEnd}`;
    titleGroup.append(title, range);

    const controls = document.createElement('div');
    controls.className = 'zj-st-controls';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'zj-schedule-nav-btn';
    prevBtn.dataset.action = 'timeline-prev-range';
    prevBtn.append(createIcon('chevron-left'), document.createTextNode('较早'));
    prevBtn.addEventListener('click', () => {
      state.timelineWindowStart = addDays(state.timelineWindowStart, -7);
      render(false);
    });

    const todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'zj-schedule-nav-btn';
    todayBtn.dataset.action = 'timeline-today';
    todayBtn.textContent = '今天';
    todayBtn.addEventListener('click', () => {
      state.timelineWindowStart = addDays(state.today, -DEFAULT_TIMELINE_PAST_OFFSET);
      render(true);
    });

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'zj-schedule-nav-btn';
    nextBtn.dataset.action = 'timeline-next-range';
    nextBtn.append(document.createTextNode('较晚'), createIcon('chevron-right'));
    nextBtn.addEventListener('click', () => {
      state.timelineWindowStart = addDays(state.timelineWindowStart, 7);
      render(false);
    });

    controls.append(prevBtn, todayBtn, nextBtn);
    head.append(titleGroup, controls);
    root.append(head);

    if (datedJobs.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'zj-st-empty';
      empty.textContent =
        '当前还没有带具体日期的面试、笔试或 Offer 节点；可在岗位卡中为节点补充日期。';
      root.append(empty);
    } else {
      const scroller = document.createElement('div');
      scroller.className = 'zj-st-scroller';
      scroller.tabIndex = 0;
      scroller.setAttribute('role', 'region');
      scroller.setAttribute('aria-label', '跨岗位日期时间轴');

      const axis = document.createElement('div');
      axis.className = 'zj-st-axis';
      axis.style.setProperty('--zj-st-days', String(days.length));

      // Header row
      const headerRow = document.createElement('div');
      headerRow.className = 'zj-st-row zj-st-header-row';
      const labelHead = document.createElement('div');
      labelHead.className = 'zj-st-job-col';
      labelHead.textContent = '岗位';
      headerRow.append(labelHead);

      let todayHeadEl: HTMLElement | null = null;
      const dayHeadEls: HTMLElement[] = [];
      for (const day of days) {
        const dayHead = document.createElement('div');
        dayHead.className = 'zj-st-day-head';
        dayHead.dataset.date = day;
        if (day === state.today) {
          dayHead.classList.add('is-today');
          todayHeadEl = dayHead;
        }
        dayHeadEls.push(dayHead);
        const dateLabel = document.createElement('span');
        dateLabel.textContent = formatShortDate(day);
        const weekdayLabel = document.createElement('span');
        weekdayLabel.textContent = WEEKDAY_NAMES[parseDateKey(day).getDay()] ?? '';
        dayHead.append(dateLabel, weekdayLabel);
        if (day === state.today) {
          const badge = document.createElement('span');
          badge.className = 'zj-st-today-badge';
          badge.textContent = '今天';
          dayHead.append(badge);
        }
        headerRow.append(dayHead);
      }
      axis.append(headerRow);

      // Job rows
      for (const job of datedJobs) {
        const row = document.createElement('div');
        row.className = 'zj-st-row';
        row.dataset.jobId = job.id;

        const jobCol = document.createElement('div');
        jobCol.className = 'zj-st-job-col';
        const jobBtn = document.createElement('button');
        jobBtn.type = 'button';
        jobBtn.className = 'zj-st-job-btn';
        jobBtn.addEventListener('click', () => {
          const fallbackStepId = getLatestStep(job)?.id ?? '';
          onSelect(job.id, fallbackStepId);
        });
        const compEl = document.createElement('span');
        compEl.className = 'zj-st-job-company';
        compEl.textContent = getJobDisplayName(job);
        jobBtn.append(compEl);
        if (job.position.trim()) {
          const roleEl = document.createElement('span');
          roleEl.className = 'zj-st-job-role';
          roleEl.textContent = job.position.trim();
          jobBtn.append(roleEl);
        }
        if (job.result) {
          const resultTag = document.createElement('span');
          resultTag.className = `zj-st-job-result${job.result === 'declined' ? ' is-declined' : ''}`;
          resultTag.textContent = getResultLabel(job.result);
          jobBtn.append(resultTag);
        }
        jobCol.append(jobBtn);
        row.append(jobCol);

        const jobDateMap = eventsByJobAndDate.get(job.id)!;
        for (const day of days) {
          const cell = document.createElement('div');
          cell.className = 'zj-st-day-cell';
          cell.dataset.date = day;
          if (day === state.today) cell.classList.add('is-today');

          const dayEvents = sortEventsForDay(jobDateMap.get(day) ?? []);
          if (dayEvents.length > 0) {
            const stack = document.createElement('div');
            stack.className = 'zj-st-cell-stack';
            for (const ev of dayEvents) {
              const nodeBtn = document.createElement('button');
              nodeBtn.type = 'button';
              nodeBtn.className = 'zj-st-node';
              nodeBtn.dataset.action = 'locate-schedule-event';
              nodeBtn.dataset.jobId = ev.jobId;
              nodeBtn.dataset.stepId = ev.stepId;

              if (job.result !== null) {
                nodeBtn.classList.add('is-ended');
              } else if (!ev.active) {
                nodeBtn.classList.add('is-settled');
              } else {
                const tone = getEventKindTone(ev);
                if (tone === 'offer') nodeBtn.classList.add('is-offer');
                else if (tone === 'deadline') nodeBtn.classList.add('is-deadline');
                else nodeBtn.classList.add('is-pending');
              }

              const titleSpan = document.createElement('span');
              titleSpan.className = 'zj-st-node-title';
              titleSpan.textContent = ev.time ? `${ev.label} ${ev.time}` : ev.label;

              const metaSpan = document.createElement('span');
              metaSpan.className = 'zj-st-node-meta';
              metaSpan.textContent = job.result
                ? `${ev.status} · ${getResultLabel(job.result)}`
                : ev.status;

              nodeBtn.append(titleSpan, metaSpan);
              nodeBtn.addEventListener('click', () => {
                onSelect(ev.jobId, ev.stepId);
              });
              stack.append(nodeBtn);
            }
            cell.append(stack);
          }

          row.append(cell);
        }

        axis.append(row);
      }

      scroller.append(axis);
      root.append(scroller);

      if (scrollTodayIntoView && todayHeadEl) {
        const alignToday = () => {
          if (
            scroller.clientWidth > 0 &&
            todayHeadEl &&
            typeof scroller.getBoundingClientRect === 'function'
          ) {
            const scrollerRect = scroller.getBoundingClientRect();
            const stickyRect = labelHead.getBoundingClientRect();
            const colRect = todayHeadEl.getBoundingClientRect();
            if (colRect.width > 0) {
              const visibleAxisWidth = Math.max(0, scrollerRect.right - stickyRect.right);
              const colsBeforeToday = Math.max(
                0,
                Math.floor(Math.max(0, visibleAxisWidth - colRect.width) / 2 / colRect.width),
              );
              const todayIdx = dayHeadEls.indexOf(todayHeadEl);
              const anchorHead =
                dayHeadEls[Math.max(0, todayIdx - colsBeforeToday)] ?? todayHeadEl;
              const delta = anchorHead.getBoundingClientRect().left - stickyRect.right;
              scroller.scrollLeft = Math.max(0, Math.round(scroller.scrollLeft + delta));
              return;
            }
          }
          if (typeof todayHeadEl?.scrollIntoView === 'function') {
            todayHeadEl.scrollIntoView({
              behavior: 'auto',
              block: 'nearest',
              inline: 'center',
            });
          }
        };
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => alignToday());
        } else {
          alignToday();
        }
      }
    }

    if (undatedJobs.length > 0) {
      const undatedWrap = document.createElement('div');
      undatedWrap.className = 'zj-st-undated';
      const label = document.createElement('span');
      label.textContent = '暂无明确日期（回岗位卡查看）：';
      undatedWrap.append(label);
      for (const job of undatedJobs) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'zj-st-undated-chip';
        chip.dataset.action = 'locate-undated-job';
        chip.dataset.jobId = job.id;
        chip.textContent = getJobDisplayName(job);
        chip.addEventListener('click', () => {
          const latestId = getLatestStep(job)?.id ?? '';
          onSelect(job.id, latestId);
        });
        undatedWrap.append(chip);
      }
      root.append(undatedWrap);
    }
  };

  render(true);
  return root;
}
