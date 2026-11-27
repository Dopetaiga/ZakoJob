import type {
  CommandOutcome,
  ImportOutcome,
  JobBoardStore,
  LogStepPayload,
  StorageReadFailure,
  UpdateStepPayload,
} from '../data/contract.ts';
import type { FlowNode, Job, JobActionFailure } from '../domain/index.ts';
import { deadlineToStepTime, stepTimeToDeadline } from './format.ts';
import type { AddStepInput, JobCardData, JobStep } from './types.ts';

export function domainNodeToCardStep(node: FlowNode): JobStep {
  switch (node.kind) {
    case 'applied':
      return { id: node.id, kind: 'applied' };
    case 'assessment':
      return {
        id: node.id,
        kind: 'assessment',
        completed: node.completed,
        deadline: deadlineToStepTime(node.deadline),
      };
    case 'interview':
      return {
        id: node.id,
        kind: 'interview',
        roundLabel: node.round,
        status: node.status === 'done' ? 'completed' : 'pending',
        scheduledAt: deadlineToStepTime(node.scheduledAt),
      };
    case 'oc':
      return { id: node.id, kind: 'oc' };
    case 'offer':
      return {
        id: node.id,
        kind: 'written_offer',
        deadline: deadlineToStepTime(node.replyDeadline),
      };
  }
}

export function domainJobToCardData(job: Job): JobCardData {
  return {
    id: job.id,
    version: job.version,
    company: job.profile.company ?? '',
    position: job.profile.position ?? '',
    url: job.profile.postingUrl,
    location: job.profile.location,
    salary: job.profile.salary,
    jd: job.profile.jobDescription,
    starred: job.starred,
    result:
      job.outcome === null
        ? null
        : job.outcome.status === 'closedByEmployer'
          ? 'rejected'
          : 'declined',
    steps: job.flow.map(domainNodeToCardStep),
  };
}

export function addStepInputToLogPayload(input: AddStepInput): LogStepPayload {
  switch (input.kind) {
    case 'applied':
      return { kind: 'applied' };
    case 'assessment':
      return {
        kind: 'assessment',
        ...(input.deadline ? { deadline: stepTimeToDeadline(input.deadline) } : {}),
      };
    case 'interview':
      return {
        kind: 'interview',
        round: input.roundLabel,
        ...(input.scheduledAt
          ? { scheduledAt: stepTimeToDeadline(input.scheduledAt) }
          : {}),
      };
    case 'oc':
      return { kind: 'oc' };
    case 'written_offer':
      return {
        kind: 'offer',
        ...(input.deadline
          ? { replyDeadline: stepTimeToDeadline(input.deadline) }
          : {}),
      };
  }
}

export function addStepInputToUpdatePayload(
  input: AddStepInput,
): UpdateStepPayload | null {
  switch (input.kind) {
    case 'assessment':
      return {
        targetKind: 'assessment',
        patch: {
          completed: input.completed,
          deadline: input.deadline ? stepTimeToDeadline(input.deadline) ?? null : null,
        },
      };
    case 'interview':
      return {
        targetKind: 'interview',
        patch: {
          round: input.roundLabel,
          status: input.status === 'completed' ? 'done' : 'pending',
          scheduledAt: input.scheduledAt
            ? stepTimeToDeadline(input.scheduledAt) ?? null
            : null,
        },
      };
    case 'written_offer':
      return {
        targetKind: 'offer',
        patch: {
          replyDeadline: input.deadline
            ? stepTimeToDeadline(input.deadline) ?? null
            : null,
        },
      };
    default:
      return null;
  }
}

export function isConflictFailure(failure: JobActionFailure): boolean {
  return (
    failure.reason === 'versionConflict' ||
    failure.reason === 'lastNodeMismatch' ||
    failure.reason === 'nodeNotFound' ||
    failure.reason === 'nodeKindMismatch'
  );
}

export function formatActionFailureMessage(failure: JobActionFailure): string {
  switch (failure.reason) {
    case 'invalidInput':
      return failure.message;
    case 'versionConflict':
      return '进展已变更，请刷新后重新选择操作。';
    case 'lastNodeMismatch':
      return '末节点已变更，请刷新后核对最新进展再决定是否撤回。';
    case 'nodeNotFound':
    case 'nodeKindMismatch':
      return '目标环节已变更，请刷新后重新查看。';
  }
}

export function formatReadFailureMessage(failure: StorageReadFailure): string {
  if (failure.reason === 'unknown') {
    return failure.message?.trim() || '读取请求未收到回应，请点击刷新重试。';
  }
  return failure.message;
}

export function formatStoreModeLabel(mode: JobBoardStore['mode']): string {
  return mode === 'sites' ? '私有站点' : '本地存储';
}

export function formatImportOutcomeMessage(outcome: ImportOutcome): string {
  switch (outcome.status) {
    case 'confirmed':
      return '备份已恢复。';
    case 'rejected':
      if (outcome.reason === 'targetNotEmpty') {
        return outcome.message;
      }
      if (outcome.issues.length === 0) {
        return '备份文件校验未通过。';
      }
      return `备份校验失败（${outcome.issues[0]!.path || 'root'}）：${outcome.issues[0]!.message}`;
    case 'failed':
      return outcome.message;
    case 'unconfirmed':
      return '未确认是否导入，请刷新查看';
  }
}

export function formatCommandSaveSuccess(
  mode: JobBoardStore['mode'],
  actionLabel: string,
): string {
  return `${actionLabel}（${mode === 'sites' ? '站点已确认' : '本地已保存'}）`;
}

export type CommandFeedbackKind = 'confirmed' | 'conflict' | 'rejected' | 'unconfirmed';

export function classifyCommandOutcome(outcome: CommandOutcome): CommandFeedbackKind {
  if (outcome.status === 'confirmed') return 'confirmed';
  if (outcome.status === 'unconfirmed') return 'unconfirmed';
  if (outcome.status === 'failed') return 'rejected';
  return isConflictFailure(outcome.failure) ? 'conflict' : 'rejected';
}
