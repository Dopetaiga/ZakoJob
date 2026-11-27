/**
 * 岗位命令的验证与路由。
 *
 * 适配器在事务内或服务端拿到当前岗位后，用 dispatchJobCommand 把
 * 可序列化命令映射回同一套领域动作。命令先经 validateJobCommand
 * 结构校验（防御不可信 JSON），再按版本条件与领域规则执行。
 */

import {
  createJob,
  logAppliedStep,
  logAssessmentStep,
  logInterviewStep,
  logOcStep,
  logOfferStep,
  recordOutcome,
  removeLatestStep,
  setJobStar,
  clearOutcome,
  updateAssessmentStep,
  updateInterviewStep,
  updateJobProfile,
  updateOfferStep,
  validateDeadline,
  type Deadline,
  type Job,
  type JobActionFailure,
  type JobActionResult,
} from '../domain/index.ts';
import type {
  JobCommand,
  LogStepPayload,
  UpdateStepPayload,
} from './contract.ts';

function invalid(message: string): JobActionResult {
  return { ok: false, failure: { reason: 'invalidInput', message } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 校验期望版本：必须是正整数。 */
function checkExpectedVersion(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return '期望版本必须是正整数。';
  }
  return null;
}

/** 校验非空字符串标识。 */
function checkId(value: unknown, label: string): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return `${label}必须是非空字符串。`;
  }
  return null;
}

/** 校验期限结构；期限可选，提供时必须是合法的日期或带时刻的期限。 */
function checkOptionalDeadline(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    return `${label}必须是期限对象。`;
  }
  const precision = value.precision;
  if (precision !== 'date' && precision !== 'datetime') {
    return `${label} 的 precision 只能是 date 或 datetime。`;
  }
  if (typeof value.date !== 'string') {
    return `${label} 的日期必须是字符串。`;
  }
  const date = value.date;
  if (precision === 'date') {
    const message = validateDeadline({ precision: 'date', date });
    return message ? `${label}：${message}` : null;
  }
  if (typeof value.time !== 'string') {
    return `${label} 的时刻必须是字符串。`;
  }
  const message = validateDeadline({ precision: 'datetime', date, time: value.time });
  return message ? `${label}：${message}` : null;
}

/** 校验补丁键的「不变 / 清除」语义：缺省即不变，null 即清除，否则按期限校验。 */
function checkDeadlinePatch(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return checkOptionalDeadline(value, label);
}

function checkLogStepPayload(step: unknown): string | null {
  if (!isPlainObject(step)) {
    return '环节负载必须是对象。';
  }
  switch (step.kind) {
    case 'applied':
    case 'oc':
      return null;
    case 'assessment': {
      const issue = checkOptionalDeadline(step.deadline, '测评期限');
      if (issue) return issue;
      return null;
    }
    case 'interview': {
      if (typeof step.round !== 'string' || !step.round.trim()) {
        return '面试轮次名称不能为空。';
      }
      const issue = checkOptionalDeadline(step.scheduledAt, '面试安排');
      if (issue) return issue;
      return null;
    }
    case 'offer': {
      const issue = checkOptionalDeadline(step.replyDeadline, '答复期限');
      if (issue) return issue;
      return null;
    }
    default:
      return `未知的环节种类「${String(step.kind)}」。`;
  }
}

/** 环节补丁的校验：completed 布尔、round 非空字符串、状态与期限补丁。 */
function checkStepPatch(targetKind: unknown, patch: unknown): string | null {
  if (!isPlainObject(patch)) {
    return '环节补丁必须是对象。';
  }
  if (targetKind === 'assessment') {
    if (patch.completed !== undefined && typeof patch.completed !== 'boolean') {
      return 'completed 必须是布尔值。';
    }
    return checkDeadlinePatch(patch.deadline, '测评期限');
  }
  if (targetKind === 'interview') {
    if (patch.round !== undefined && (typeof patch.round !== 'string' || !patch.round.trim())) {
      return '面试轮次名称不能为空。';
    }
    if (
      patch.status !== undefined &&
      patch.status !== 'pending' &&
      patch.status !== 'done'
    ) {
      return '面试状态只能是 pending 或 done。';
    }
    return checkDeadlinePatch(patch.scheduledAt, '面试安排');
  }
  if (targetKind === 'offer') {
    return checkDeadlinePatch(patch.replyDeadline, '答复期限');
  }
  return `未知的更正目标环节「${String(targetKind)}」。`;
}

/**
 * 结构校验一条命令。通过时返回 null；否则返回可直接展示的问题说明。
 * 结构合法不代表业务成立：版本冲突、末节点不匹配等仍由领域动作裁决。
 */
function validateProfileFields(profile: Record<string, unknown>): string | null {
  const fields = ['company', 'position', 'postingUrl', 'location', 'salary', 'jobDescription'];
  for (const [key, value] of Object.entries(profile)) {
    if (!fields.includes(key)) return `未知的资料字段 ${key}。`;
    if (value !== undefined && typeof value !== 'string') return `资料字段 ${key} 必须是字符串。`;
  }
  return null;
}

export function validateJobCommand(command: unknown): string | null {
  if (!isPlainObject(command)) {
    return '命令必须是对象。';
  }
  const kind = command.kind;
  switch (kind) {
    case 'create-job': {
      const idIssue = checkId(command.jobId, '岗位 ID');
      if (idIssue) return idIssue;
      if (!isPlainObject(command.input)) {
        return '建档输入必须是对象。';
      }
      return validateProfileFields(command.input);
    }
    case 'update-profile': {
      const idIssue = checkId(command.jobId, '岗位 ID');
      if (idIssue) return idIssue;
      const versionIssue = checkExpectedVersion(command.expectedVersion);
      if (versionIssue) return versionIssue;
      if (!isPlainObject(command.patch)) {
        return '资料补丁必须是对象。';
      }
      return validateProfileFields(command.patch);
    }
    case 'set-star': {
      const idIssue = checkId(command.jobId, '岗位 ID');
      if (idIssue) return idIssue;
      const versionIssue = checkExpectedVersion(command.expectedVersion);
      if (versionIssue) return versionIssue;
      if (typeof command.starred !== 'boolean') {
        return 'starred 必须是布尔值。';
      }
      return null;
    }
    case 'log-step': {
      const idIssue = checkId(command.jobId, '岗位 ID');
      if (idIssue) return idIssue;
      const versionIssue = checkExpectedVersion(command.expectedVersion);
      if (versionIssue) return versionIssue;
      const nodeIssue = checkId(command.nodeId, '节点 ID');
      if (nodeIssue) return nodeIssue;
      return checkLogStepPayload(command.step);
    }
    case 'update-step': {
      const idIssue = checkId(command.jobId, '岗位 ID');
      if (idIssue) return idIssue;
      const versionIssue = checkExpectedVersion(command.expectedVersion);
      if (versionIssue) return versionIssue;
      const nodeIssue = checkId(command.nodeId, '节点 ID');
      if (nodeIssue) return nodeIssue;
      const target = (command.payload as Record<string, unknown> | undefined)?.targetKind;
      const patch = (command.payload as Record<string, unknown> | undefined)?.patch;
      if (!isPlainObject(command.payload)) {
        return '更正负载必须是对象。';
      }
      return checkStepPatch(target, patch);
    }
    case 'remove-latest-step': {
      const idIssue = checkId(command.jobId, '岗位 ID');
      if (idIssue) return idIssue;
      const versionIssue = checkExpectedVersion(command.expectedVersion);
      if (versionIssue) return versionIssue;
      return checkId(command.expectedLastNodeId, '末节点 ID');
    }
    case 'record-outcome': {
      const idIssue = checkId(command.jobId, '岗位 ID');
      if (idIssue) return idIssue;
      const versionIssue = checkExpectedVersion(command.expectedVersion);
      if (versionIssue) return versionIssue;
      if (command.status !== 'closedByEmployer' && command.status !== 'declinedByUser') {
        return '结果状态只能是 closedByEmployer 或 declinedByUser。';
      }
      return null;
    }
    case 'clear-outcome': {
      const idIssue = checkId(command.jobId, '岗位 ID');
      if (idIssue) return idIssue;
      return checkExpectedVersion(command.expectedVersion);
    }
    default:
      return `未知的命令种类「${String(kind)}」。`;
  }
}

/** 把登记环节负载路由到对应领域动作；节点 ID 由调用方生成的命令提供。 */
function dispatchLogStep(
  job: Job,
  command: Extract<JobCommand, { kind: 'log-step' }>,
): JobActionResult {
  const step = command.step as LogStepPayload;
  const options = { generateId: () => command.nodeId };
  switch (step.kind) {
    case 'applied':
      return logAppliedStep(job, command.expectedVersion, options);
    case 'assessment':
      return logAssessmentStep(
        job,
        command.expectedVersion,
        step.deadline ? { deadline: step.deadline } : {},
        options,
      );
    case 'interview':
      return logInterviewStep(
        job,
        command.expectedVersion,
        step.scheduledAt
          ? { round: step.round, scheduledAt: step.scheduledAt }
          : { round: step.round },
        options,
      );
    case 'oc':
      return logOcStep(job, command.expectedVersion, options);
    case 'offer':
      return logOfferStep(
        job,
        command.expectedVersion,
        step.replyDeadline ? { replyDeadline: step.replyDeadline } : {},
        options,
      );
  }
}

/** 把更正环节负载路由到对应领域动作。 */
function dispatchUpdateStep(
  job: Job,
  command: Extract<JobCommand, { kind: 'update-step' }>,
): JobActionResult {
  const payload = command.payload as UpdateStepPayload;
  switch (payload.targetKind) {
    case 'assessment':
      return updateAssessmentStep(job, command.expectedVersion, command.nodeId, payload.patch);
    case 'interview':
      return updateInterviewStep(job, command.expectedVersion, command.nodeId, payload.patch);
    case 'offer':
      return updateOfferStep(job, command.expectedVersion, command.nodeId, payload.patch);
  }
}

/**
 * 在当前岗位记录上执行一条已通过结构校验的命令。
 * 建档命令需另走 {@link dispatchCreateJobCommand}；对非建档命令在空流程岗位上
 * 调用会得到领域动作的正常失败（岗位不存在由适配器先行处理）。
 */
export function dispatchJobCommand(
  job: Job,
  command: JobCommand,
): JobActionResult {
  switch (command.kind) {
    case 'update-profile':
      return updateJobProfile(job, command.expectedVersion, command.patch);
    case 'set-star':
      return setJobStar(job, command.expectedVersion, command.starred);
    case 'log-step':
      return dispatchLogStep(job, command);
    case 'update-step':
      return dispatchUpdateStep(job, command);
    case 'remove-latest-step':
      return removeLatestStep(job, command.expectedVersion, command.expectedLastNodeId);
    case 'record-outcome':
      return recordOutcome(job, command.expectedVersion, command.status);
    case 'clear-outcome':
      return clearOutcome(job, command.expectedVersion);
    case 'create-job':
      return invalid('建档命令应通过 dispatchCreateJobCommand 执行。');
  }
}

/**
 * 执行建档命令：岗位 ID 由命令提供（客户端生成，重送沿用同一 ID），
 * 通过注入 ID 工厂让领域动作采用该 ID；重复 ID 由存储层的唯一键裁决。
 */
export function dispatchCreateJobCommand(
  command: Extract<JobCommand, { kind: 'create-job' }>,
): JobActionResult {
  const created = createJob(command.input, { generateId: () => command.jobId });
  if (!created.ok) {
    return created;
  }
  if (created.job.id !== command.jobId) {
    return invalid('领域动作未采用命令提供的岗位 ID。');
  }
  return created;
}

/** 适配器通用的「命令结构不合法」失败。 */
export function commandValidationFailure(message: string): JobActionFailure {
  return { reason: 'invalidInput', message: `命令未通过校验：${message}` };
}
