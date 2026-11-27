/**
 * v1 备份的编码与整包校验。
 *
 * 备份文件来自用户或另一台设备，属于不可信输入：
 * 解码时逐字段验证结构、重复标识、合法状态与可解析的日期，
 * 全部通过才返回可信的 BackupFile；任何问题都不触碰目标存储。
 * 两种运行模式共用本格式，编解码保留日期或具体时刻两种精度。
 */

import { validateDeadline } from '../domain/index.ts';
import type {
  AppliedNode,
  AssessmentNode,
  Deadline,
  FlowNode,
  InterviewNode,
  Job,
  OcNode,
  OfferNode,
} from '../domain/index.ts';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupFile,
  type BackupIssue,
  type BoardPreferences,
} from './contract.ts';
import { validatePreferences } from './preferences.ts';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 由领域记录构造备份文件。只复制可序列化的业务字段，
 * 不包含访问身份、数据库绑定或凭据。
 */
export function encodeBackup(
  applications: readonly Job[],
  preferences: BoardPreferences,
): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    applications: applications.map((job) => ({
      id: job.id,
      profile: { ...job.profile },
      starred: job.starred,
      flow: job.flow.map((node) => ({ ...node })),
      outcome: job.outcome ? { ...job.outcome } : null,
      version: job.version,
    })),
    preferences,
  };
}

/** 期限校验：结构 + 可解析的真实日历日期与时刻。 */
function checkDeadline(
  value: unknown,
  path: string,
  issues: BackupIssue[],
): Deadline | null {
  if (!isPlainObject(value)) {
    issues.push({ path, message: '期限必须是对象。' });
    return null;
  }
  const precision = value.precision;
  if (precision !== 'date' && precision !== 'datetime') {
    issues.push({
      path: `${path}.precision`,
      message: `precision 只能是 date 或 datetime，收到「${String(precision)}」。`,
    });
    return null;
  }
  if (typeof value.date !== 'string') {
    issues.push({ path: `${path}.date`, message: '日期必须是字符串。' });
    return null;
  }
  const date = value.date;
  if (precision === 'date') {
    const message = validateDeadline({ precision: 'date', date });
    if (message) {
      issues.push({ path, message });
      return null;
    }
    return { precision: 'date', date };
  }
  if (typeof value.time !== 'string') {
    issues.push({ path: `${path}.time`, message: '时刻必须是字符串。' });
    return null;
  }
  const time = value.time;
  const message = validateDeadline({ precision: 'datetime', date, time });
  if (message) {
    issues.push({ path, message });
    return null;
  }
  if (value.timeZone !== undefined) {
    if (typeof value.timeZone !== 'string' || !value.timeZone.trim()) {
      issues.push({ path: `${path}.timeZone`, message: '时区必须是 IANA 时区名称字符串。' });
      return null;
    }
    return { precision: 'datetime', date, time, timeZone: value.timeZone };
  }
  return { precision: 'datetime', date, time };
}

/** 校验流程节点：种类、各字段与节点内唯一标识。 */
function checkFlowNode(
  value: unknown,
  path: string,
  seenNodeIds: Set<string>,
  issues: BackupIssue[],
): FlowNode | null {
  if (!isPlainObject(value)) {
    issues.push({ path, message: '流程节点必须是对象。' });
    return null;
  }
  const kind = value.kind;
  const id = value.id;
  if (typeof id !== 'string' || !id.trim()) {
    issues.push({ path: `${path}.id`, message: '节点 ID 必须是非空字符串。' });
    return null;
  }
  if (seenNodeIds.has(id)) {
    issues.push({ path: `${path}.id`, message: `节点 ID「${id}」在该岗位内重复。` });
    return null;
  }
  seenNodeIds.add(id);
  switch (kind) {
    case 'applied': {
      const node: AppliedNode = { kind: 'applied', id };
      return node;
    }
    case 'assessment': {
      if (typeof value.completed !== 'boolean') {
        issues.push({ path: `${path}.completed`, message: 'completed 必须是布尔值。' });
        return null;
      }
      const node: AssessmentNode = { kind: 'assessment', id, completed: value.completed };
      if (value.deadline !== undefined && value.deadline !== null) {
        const deadline = checkDeadline(value.deadline, `${path}.deadline`, issues);
        if (!deadline) {
          return null;
        }
        node.deadline = deadline;
      }
      return node;
    }
    case 'interview': {
      if (typeof value.round !== 'string' || !value.round.trim()) {
        issues.push({ path: `${path}.round`, message: '面试轮次名称不能为空。' });
        return null;
      }
      if (value.status !== 'pending' && value.status !== 'done') {
        issues.push({
          path: `${path}.status`,
          message: `面试状态只能是 pending 或 done，收到「${String(value.status)}」。`,
        });
        return null;
      }
      const node: InterviewNode = {
        kind: 'interview',
        id,
        round: value.round,
        status: value.status,
      };
      if (value.scheduledAt !== undefined && value.scheduledAt !== null) {
        const scheduledAt = checkDeadline(value.scheduledAt, `${path}.scheduledAt`, issues);
        if (!scheduledAt) {
          return null;
        }
        node.scheduledAt = scheduledAt;
      }
      return node;
    }
    case 'oc': {
      const node: OcNode = { kind: 'oc', id };
      return node;
    }
    case 'offer': {
      const node: OfferNode = { kind: 'offer', id };
      if (value.replyDeadline !== undefined && value.replyDeadline !== null) {
        const replyDeadline = checkDeadline(value.replyDeadline, `${path}.replyDeadline`, issues);
        if (!replyDeadline) {
          return null;
        }
        node.replyDeadline = replyDeadline;
      }
      return node;
    }
    default:
      issues.push({ path: `${path}.kind`, message: `未知的环节种类「${String(kind)}」。` });
      return null;
  }
}

/** 校验一份岗位记录：标识唯一、资料合法、流程有序、结果合法。 */
function checkJob(value: unknown, path: string, seenJobIds: Set<string>, issues: BackupIssue[]): Job | null {
  if (!isPlainObject(value)) {
    issues.push({ path, message: '岗位必须是对象。' });
    return null;
  }
  const id = value.id;
  if (typeof id !== 'string' || !id.trim()) {
    issues.push({ path: `${path}.id`, message: '岗位 ID 必须是非空字符串。' });
    return null;
  }
  if (seenJobIds.has(id)) {
    issues.push({ path: `${path}.id`, message: `岗位 ID「${id}」在备份中重复。` });
    return null;
  }
  seenJobIds.add(id);
  const markInvalid = (field: string, message: string) => {
    issues.push({ path: `${path}.${field}`, message });
  };

  // 资料：可序列化的六项文本字段。
  const profileValue = value.profile;
  if (!isPlainObject(profileValue)) {
    markInvalid('profile', '资料必须是对象。');
    return null;
  }
  const profile: Job['profile'] = {};
  for (const key of ['company', 'position', 'postingUrl', 'location', 'salary', 'jobDescription']) {
    const fieldValue = profileValue[key];
    if (fieldValue === undefined) {
      continue;
    }
    if (fieldValue === null) {
      continue;
    }
    if (typeof fieldValue !== 'string') {
      markInvalid(`profile.${key}`, '资料字段必须是字符串。');
      return null;
    }
    profile[key as keyof Job['profile']] = fieldValue;
  }
  if (!profile.postingUrl && !(profile.company?.trim() && profile.position?.trim())) {
    markInvalid('profile', '岗位须有招聘链接，或同时有公司与职位。');
    return null;
  }
  if (profile.postingUrl) {
    try {
      const url = new URL(profile.postingUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('protocol');
      }
    } catch {
      markInvalid('profile.postingUrl', '招聘链接必须是可打开的 HTTP 或 HTTPS 地址。');
      return null;
    }
  }

  // 版本与星标。
  if (typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 1) {
    markInvalid('version', '版本必须是正整数。');
    return null;
  }
  if (typeof value.starred !== 'boolean') {
    markInvalid('starred', 'starred 必须是布尔值。');
    return null;
  }

  // 有序流程：节点 ID 在岗位内唯一，按原有顺序还原。
  if (!Array.isArray(value.flow)) {
    markInvalid('flow', '流程必须是数组。');
    return null;
  }
  const seenNodeIds = new Set<string>();
  const flow: FlowNode[] = [];
  for (const [index, nodeValue] of value.flow.entries()) {
    const node = checkFlowNode(nodeValue, `${path}.flow[${index}]`, seenNodeIds, issues);
    if (!node) {
      return null;
    }
    flow.push(node);
  }

  // 结果：空或合法状态。
  let outcome: Job['outcome'] = null;
  if (value.outcome !== undefined && value.outcome !== null) {
    if (!isPlainObject(value.outcome)) {
      markInvalid('outcome', '申请结果必须是对象。');
      return null;
    }
    if (
      value.outcome.status !== 'closedByEmployer' &&
      value.outcome.status !== 'declinedByUser'
    ) {
      markInvalid(
        'outcome.status',
        `结果只能是 closedByEmployer 或 declinedByUser，收到「${String(value.outcome.status)}」。`,
      );
      return null;
    }
    outcome = { status: value.outcome.status };
  }

  return { id, profile, starred: value.starred, flow, outcome, version: value.version };
}

/**
 * 整包校验并解析一份已解析的备份 JSON（来自 JSON.parse 或存储读取）。
 * 全部岗位与偏好合法时返回可信 BackupFile；否则返回可定位到
 * 问题记录或字段的问题列表，目标尚未写入。
 */
export function decodeBackup(parsed: unknown): import('./contract.ts').BackupDecodeResult {
  if (!isPlainObject(parsed)) {
    return { ok: false, issues: [{ path: '', message: '备份必须是 JSON 对象。' }] };
  }
  const issues: BackupIssue[] = [];
  if (parsed.format !== BACKUP_FORMAT) {
    issues.push({
      path: 'format',
      message: `格式标识应为「${BACKUP_FORMAT}」，收到「${String(parsed.format)}」。`,
    });
  }
  if (parsed.version !== BACKUP_VERSION) {
    issues.push({
      path: 'version',
      message: `备份版本 ${String(parsed.version)} 不受支持，本版本可读取 ${BACKUP_VERSION}。`,
    });
  }
  if (!Array.isArray(parsed.applications)) {
    issues.push({ path: 'applications', message: 'applications 必须是岗位数组。' });
  }
  let preferences: BoardPreferences | null = null;
  const preferenceResult = validatePreferences(parsed.preferences);
  if (preferenceResult.ok) {
    preferences = preferenceResult.preferences;
  } else {
    for (const issue of preferenceResult.issues) {
      issues.push(issue);
    }
  }

  const applications: Job[] = [];
  if (Array.isArray(parsed.applications)) {
    const seenJobIds = new Set<string>();
    for (const [index, jobValue] of parsed.applications.entries()) {
      const job = checkJob(jobValue, `applications[${index}]`, seenJobIds, issues);
      if (job) {
        applications.push(job);
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      applications,
      preferences: preferences!,
    },
  };
}
