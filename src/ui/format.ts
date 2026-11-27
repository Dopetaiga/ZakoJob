import {
  BOARD_MODULE_IDS,
  type BoardLayout,
  type BoardModuleId,
  type BoardModulePlacement,
  type BoardPreferences,
} from '../data/contract.ts';
import { validateDeadline, type Deadline } from '../domain/index.ts';
import type {
  AgendaItem,
  ApplicationResult,
  ContextualQuickAction,
  JobCardData,
  JobStep,
  StepTimeValue,
} from './types.ts';

/**
 * Validates and normalizes an external job link. Only http: and https: URLs are permitted.
 */
export function sanitizeHttpUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Sorts starred jobs ahead of unstarred jobs while preserving existing order within each group.
 */
export function sortJobsByStar(jobs: readonly JobCardData[]): JobCardData[] {
  const starred: JobCardData[] = [];
  const normal: JobCardData[] = [];
  for (const job of jobs) {
    if (job.starred) {
      starred.push(job);
    } else {
      normal.push(job);
    }
  }
  return [...starred, ...normal];
}

export function formatUrlDisplay(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    const query = parsed.search || '';
    return `${parsed.host}${path}${query}`;
  } catch {
    return trimmed.replace(/^https?:\/\//i, '');
  }
}

export function isLinkOnlyJob(job: JobCardData): boolean {
  return !job.company.trim() && !job.position.trim() && Boolean(job.url?.trim());
}

export function getJobDisplayName(job: JobCardData): string {
  const company = job.company.trim();
  if (company) return company;
  const position = job.position.trim();
  if (position) return position;
  const url = job.url?.trim();
  if (url) return formatUrlDisplay(url);
  return '未命名岗位';
}

export function getLatestStep(job: JobCardData): JobStep | null {
  if (job.steps.length === 0) return null;
  return job.steps[job.steps.length - 1] ?? null;
}

export function isEditableStepKind(kind: JobStep['kind']): boolean {
  return kind === 'assessment' || kind === 'interview' || kind === 'written_offer';
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function getLocalTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function formatCalendarDateText(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return dateStr;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const localDate = new Date(year, month - 1, day);
  const nowYear = new Date().getFullYear();
  const weekday = WEEKDAY_NAMES[localDate.getDay()] ?? '';
  const dateText =
    year !== nowYear ? `${year}年${month}月${day}日` : `${month}月${day}日`;
  return weekday ? `${dateText} ${weekday}` : dateText;
}

/**
 * Formats a StepTimeValue while preserving exact calendar date and datetime precision.
 */
export function formatTimeValue(time?: StepTimeValue): string {
  if (!time) return '';
  if (time.label?.trim()) return time.label.trim();
  const dateText = formatCalendarDateText(time.date);
  if (time.precision === 'date') {
    return dateText;
  }
  const clock = time.time?.trim() ?? '';
  if (!clock) return dateText;
  const localTz = getLocalTimeZone();
  const tzSuffix =
    time.timeZone && localTz && time.timeZone !== localTz
      ? ` (${time.timeZone})`
      : '';
  return `${dateText} ${clock}${tzSuffix}`.trim();
}

export function parseTimeSortKey(time: StepTimeValue): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(time.date.trim());
  if (!match) return Number.MAX_SAFE_INTEGER;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (time.precision === 'date' || !time.time) {
    return new Date(year, month - 1, day, 23, 59, 59).getTime();
  }
  const clockMatch = /^(\d{2}):(\d{2})$/.exec(time.time.trim());
  if (!clockMatch) return new Date(year, month - 1, day, 23, 59, 59).getTime();
  return new Date(
    year,
    month - 1,
    day,
    Number(clockMatch[1]),
    Number(clockMatch[2]),
    0,
  ).getTime();
}

export function splitStepTimeForInput(time?: StepTimeValue): {
  date: string;
  clock: string;
} {
  if (!time) return { date: '', clock: '' };
  return {
    date: time.date ?? '',
    clock: time.precision === 'datetime' ? time.time ?? '' : '',
  };
}

/**
 * Builds a domain-validated Deadline/StepTimeValue from form date + optional clock inputs,
 * preserving calendar date and local timezone without shifting date-only values to UTC midnight.
 */
export function buildDeadlineFromInputs(
  dateInput: string,
  clockInput: string,
): { ok: true; value?: Deadline } | { ok: false; error: string } {
  const date = dateInput.trim();
  const clock = clockInput.trim();
  if (!date && !clock) {
    return { ok: true, value: undefined };
  }
  if (!date && clock) {
    return { ok: false, error: '填写具体时刻时请同时选择日期。' };
  }
  const candidate: Deadline = clock
    ? {
        precision: 'datetime',
        date,
        time: clock,
        ...(getLocalTimeZone() ? { timeZone: getLocalTimeZone() } : {}),
      }
    : { precision: 'date', date };

  const validationError = validateDeadline(candidate);
  if (validationError) {
    return { ok: false, error: validationError };
  }
  return { ok: true, value: candidate };
}

export function stepTimeToDeadline(time?: StepTimeValue): Deadline | undefined {
  if (!time) return undefined;
  if (time.precision === 'date') {
    return { precision: 'date', date: time.date };
  }
  return {
    precision: 'datetime',
    date: time.date,
    time: time.time ?? '00:00',
    ...(time.timeZone ? { timeZone: time.timeZone } : {}),
  };
}

export function deadlineToStepTime(deadline?: Deadline): StepTimeValue | undefined {
  if (!deadline) return undefined;
  if (deadline.precision === 'date') {
    return { precision: 'date', date: deadline.date };
  }
  return {
    precision: 'datetime',
    date: deadline.date,
    time: deadline.time,
    ...(deadline.timeZone ? { timeZone: deadline.timeZone } : {}),
  };
}

export interface StepTitleParts {
  primary: string;
  substatus?: string;
}

export function formatStepTitle(step: JobStep): StepTitleParts {
  switch (step.kind) {
    case 'applied':
      return { primary: '已投递' };
    case 'assessment':
      return {
        primary: step.label?.trim() || '笔试 / 测评',
        substatus: step.completed ? '已完成' : '待完成',
      };
    case 'interview':
      return {
        primary: step.roundLabel.trim() || '面试',
        substatus: step.status === 'pending' ? '待面试' : '已面',
      };
    case 'oc':
      return { primary: 'OC' };
    case 'written_offer':
      return { primary: '书面 Offer' };
  }
}

export function formatStepInlineText(step: JobStep): string {
  const parts = formatStepTitle(step);
  return parts.substatus ? `${parts.primary} · ${parts.substatus}` : parts.primary;
}

export type StepVisualTone = 'pending' | 'offer' | 'neutral';

export function getStepVisualTone(step: JobStep): StepVisualTone {
  if (step.kind === 'interview' && step.status === 'pending') {
    return 'pending';
  }
  if (step.kind === 'oc' || step.kind === 'written_offer') {
    return 'offer';
  }
  return 'neutral';
}

export interface StepTimeDisplay {
  text: string;
  kind: 'pending' | 'past' | 'deadline';
}

export function getStepTimeDisplay(step: JobStep): StepTimeDisplay | null {
  if (step.kind === 'interview' && step.scheduledAt) {
    const text = formatTimeValue(step.scheduledAt);
    if (!text) return null;
    return {
      text,
      kind: step.status === 'pending' ? 'pending' : 'past',
    };
  }
  if (step.kind === 'assessment' && step.deadline) {
    const formatted = formatTimeValue(step.deadline);
    if (!formatted) return null;
    return {
      text: `笔试截止 ${formatted}`,
      kind: step.completed ? 'past' : 'deadline',
    };
  }
  if (step.kind === 'written_offer' && step.deadline) {
    const formatted = formatTimeValue(step.deadline);
    if (!formatted) return null;
    return {
      text: `答复截至 ${formatted}`,
      kind: 'deadline',
    };
  }
  return null;
}

export function getResultLabel(result: ApplicationResult): string {
  return result === 'rejected' ? '已挂' : '已拒';
}

export function getCompleteActionLabel(step: JobStep | null): string | null {
  if (!step) return null;
  if (step.kind === 'interview' && step.status === 'pending') {
    return `标记${step.roundLabel.trim() || '面试'}已面`;
  }
  if (step.kind === 'assessment' && !step.completed) {
    return '标记笔试已完成';
  }
  return null;
}

const INTERVIEW_ROUND_SEQUENCE = ['一面', '二面', '三面', '四面', '五面', '终面'] as const;

/**
 * Infers an editable default round label from existing interview steps
 * (starting from 一面, advancing past the highest logged round).
 */
export function inferNextInterviewRound(steps: readonly JobStep[]): string {
  let interviewCount = 0;
  let highestIndex = -1;
  for (const step of steps) {
    if (step.kind !== 'interview') continue;
    interviewCount += 1;
    const idx = INTERVIEW_ROUND_SEQUENCE.indexOf(
      step.roundLabel.trim() as (typeof INTERVIEW_ROUND_SEQUENCE)[number],
    );
    if (idx > highestIndex) {
      highestIndex = idx;
    }
  }
  if (interviewCount === 0) return '一面';
  const nextIndex = Math.max(highestIndex + 1, interviewCount);
  if (nextIndex < INTERVIEW_ROUND_SEQUENCE.length) {
    return INTERVIEW_ROUND_SEQUENCE[nextIndex]!;
  }
  return '加面';
}

/**
 * Shared state-to-action mapping used by both desktop and mobile cards.
 * Maps the job's independent outcome and latest recorded node to direct card buttons.
 */
export function getContextualJobActions(
  job: JobCardData,
): ContextualQuickAction[] {
  if (job.result !== null) {
    return [
      {
        kind: 'clear-result',
        actionId: 'clear-result',
        label: '恢复跟进',
        primary: true,
      },
      {
        kind: 'correct-result',
        actionId: 'correct-result',
        label: '更正结果',
        primary: false,
      },
    ];
  }

  const latestStep = getLatestStep(job);
  if (!latestStep) {
    return [
      {
        kind: 'append-step',
        actionId: 'applied',
        label: '已投递',
        input: { kind: 'applied' },
        primary: true,
      },
    ];
  }

  switch (latestStep.kind) {
    case 'applied':
      return [
        {
          kind: 'append-step',
          actionId: 'assessment',
          label: '收到笔试',
          input: { kind: 'assessment', completed: false },
          primary: false,
        },
        {
          kind: 'append-step',
          actionId: 'interview',
          label: '收到面试',
          input: {
            kind: 'interview',
            roundLabel: inferNextInterviewRound(job.steps),
            status: 'pending',
          },
          primary: true,
        },
      ];
    case 'assessment':
      if (!latestStep.completed) {
        return [
          {
            kind: 'complete-current',
            actionId: 'complete-assessment',
            label: '标记笔试已完成',
            targetStep: latestStep,
            primary: true,
          },
        ];
      }
      return [
        {
          kind: 'append-step',
          actionId: 'interview',
          label: '收到面试',
          input: {
            kind: 'interview',
            roundLabel: inferNextInterviewRound(job.steps),
            status: 'pending',
          },
          primary: true,
        },
      ];
    case 'interview':
      if (latestStep.status === 'pending') {
        const round = latestStep.roundLabel.trim() || '面试';
        return [
          {
            kind: 'complete-current',
            actionId: 'complete-interview',
            label: `标记${round}已面`,
            targetStep: latestStep,
            primary: true,
          },
        ];
      }
      return [
        {
          kind: 'append-step',
          actionId: 'interview',
          label: '收到下轮面试',
          input: {
            kind: 'interview',
            roundLabel: inferNextInterviewRound(job.steps),
            status: 'pending',
          },
          primary: true,
        },
        {
          kind: 'append-step',
          actionId: 'oc',
          label: '收到 OC',
          input: { kind: 'oc' },
          primary: false,
        },
      ];
    case 'oc':
      return [
        {
          kind: 'append-step',
          actionId: 'written_offer',
          label: '收到书面 Offer',
          input: { kind: 'written_offer' },
          primary: true,
        },
      ];
    case 'written_offer':
      return latestStep.deadline
        ? []
        : [
            {
              kind: 'edit-step',
              actionId: 'add-offer-deadline',
              label: '添加答复期限',
              targetStep: latestStep,
              primary: true,
            },
          ];
  }
}

export function hasMetadata(job: JobCardData): boolean {
  return Boolean(
    job.location?.trim() || job.salary?.trim() || job.jd?.trim(),
  );
}

/**
 * Derives upcoming interviews, incomplete assessment deadlines, and offer reply deadlines
 * solely from active (result === null) job records.
 */
export function deriveUpcomingAgenda(jobs: readonly JobCardData[]): AgendaItem[] {
  const items: AgendaItem[] = [];

  for (const job of jobs) {
    if (job.result !== null) continue;
    const jobName = getJobDisplayName(job);

    for (const step of job.steps) {
      if (
        step.kind === 'interview' &&
        step.status === 'pending' &&
        step.scheduledAt
      ) {
        const timeText = formatTimeValue(step.scheduledAt);
        if (!timeText) continue;
        items.push({
          jobId: job.id,
          stepId: step.id,
          kind: 'interview',
          jobName,
          title: `${jobName} · ${step.roundLabel.trim() || '面试'}`,
          subtitle: '待面试',
          time: step.scheduledAt,
          timeText,
          sortKey: parseTimeSortKey(step.scheduledAt),
        });
      } else if (
        step.kind === 'assessment' &&
        !step.completed &&
        step.deadline
      ) {
        const timeText = formatTimeValue(step.deadline);
        if (!timeText) continue;
        items.push({
          jobId: job.id,
          stepId: step.id,
          kind: 'assessment_deadline',
          jobName,
          title: `${jobName} · 笔试 / 测评`,
          subtitle: '笔试截止',
          time: step.deadline,
          timeText,
          sortKey: parseTimeSortKey(step.deadline),
        });
      } else if (step.kind === 'written_offer' && step.deadline) {
        const timeText = formatTimeValue(step.deadline);
        if (!timeText) continue;
        items.push({
          jobId: job.id,
          stepId: step.id,
          kind: 'offer_deadline',
          jobName,
          title: `${jobName} · 书面 Offer`,
          subtitle: '答复截至',
          time: step.deadline,
          timeText,
          sortKey: parseTimeSortKey(step.deadline),
        });
      }
    }
  }

  return items.sort((a, b) => a.sortKey - b.sortKey);
}

export function normalizeBoardLayout(layout?: BoardLayout | null): BoardLayout {
  const seen = new Set<BoardModuleId>();
  const modules: BoardModulePlacement[] = [];
  for (const item of layout?.modules ?? []) {
    if ((item.id === 'jobs' || item.id === 'schedule') && !seen.has(item.id)) {
      seen.add(item.id);
      modules.push({ id: item.id, visible: Boolean(item.visible) });
    }
  }
  for (const id of BOARD_MODULE_IDS) {
    if (!seen.has(id)) {
      modules.push({ id, visible: true });
    }
  }
  return { modules };
}

export function resolveEffectiveLayout(
  prefs: BoardPreferences,
  device: 'mobile' | 'desktop',
): { layout: BoardLayout; isOverride: boolean } {
  const entry = device === 'mobile' ? prefs.mobile : prefs.desktop;
  if (entry.overridden) {
    return { layout: normalizeBoardLayout(entry.layout), isOverride: true };
  }
  return { layout: normalizeBoardLayout(prefs.shared), isOverride: false };
}

const JD_LIST_OR_LABEL_RE =
  /^(?:\d{1,2}(?:[、)）]|[.:：](?!\d))|[（(]\d{1,2}[)）]|[一二三四五六七八九十]+[、.．]|[-*]\s+|[•·▪▸●○■□◆◇►✓✔]|[\u4e00-\u9fffA-Za-z]{2,10}[：:])/;
const JD_TERMINAL_PUNCT_RE = /[。！？；.!?;]["”’')）】」』\]]*$/;

function getLineDisplayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += ch.charCodeAt(0) <= 0x7f ? 1 : 2;
  }
  return width;
}

function joinWrappedLine(acc: string, prevRaw: string, nextRaw: string): string {
  const left = acc.trimEnd();
  const right = nextRaw.trimStart();
  if (!left) return right;
  if (!right) return left;
  if (/[a-z]-$/.test(left) && /^[a-z]/.test(right)) return `${left}${right}`;
  const needsSpace =
    /[ \t]$/.test(prevRaw) ||
    /^[ \t]/.test(nextRaw) ||
    (/[A-Za-z0-9,.;:!?)]$/.test(left) && /^[A-Za-z0-9(]/.test(right));
  return `${left}${needsSpace ? ' ' : ''}${right}`;
}

/**
 * Unwraps groups of near-equal-width manual line breaks for read-only JD display
 * without altering stored text, preserving hard paragraphs, lists, labels, and ordinary text.
 */
export function formatJdForDisplay(rawText: string): string {
  const lines = rawText.replace(/\r\n?/g, '\n').split('\n');
  const widths: number[] = [];

  for (let i = 0; i < lines.length - 1; i += 1) {
    const prev = lines[i]!.trim();
    const next = lines[i + 1]!.trim();
    if (!prev || !next) continue;
    if (JD_TERMINAL_PUNCT_RE.test(prev) || JD_LIST_OR_LABEL_RE.test(next)) continue;
    const w = getLineDisplayWidth(prev);
    if (w >= 34) widths.push(w);
  }

  if (widths.length < 2) return lines.join('\n');
  const sorted = [...widths].sort((a, b) => a - b);
  const wrapCol = sorted[Math.floor((sorted.length - 1) * 0.75)]!;
  const clusterCount = widths.filter((w) => w >= wrapCol - 6 && w <= wrapCol + 4).length;
  if (clusterCount < 2) return lines.join('\n');

  const result: string[] = [];
  let prevRaw = '';

  for (const raw of lines) {
    const trimmed = raw.trim();
    const lastIdx = result.length - 1;
    const prevTrimmed = lastIdx >= 0 ? result[lastIdx]!.trim() : '';
    const prevRawWidth = getLineDisplayWidth(prevRaw.trim());

    if (
      lastIdx >= 0 &&
      trimmed &&
      prevTrimmed &&
      !JD_TERMINAL_PUNCT_RE.test(prevTrimmed) &&
      !JD_LIST_OR_LABEL_RE.test(trimmed) &&
      prevRawWidth >= Math.max(34, wrapCol - 6)
    ) {
      result[lastIdx] = joinWrappedLine(result[lastIdx]!, prevRaw, raw);
    } else {
      result.push(raw);
    }
    prevRaw = raw;
  }

  return result.join('\n');
}
