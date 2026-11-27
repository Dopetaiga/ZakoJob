/**
 * 岗位业务动作：以岗位动作作为调用边界。
 *
 * 每个动作接收一份岗位记录和调用方看到的版本（expectedVersion），
 * 核对版本后生成一份新记录返回，绝不就地修改入参。
 * 数据库客户端、HTTP 请求与各端 SDK 由调用方或适配器负责；
 * 保存方以读取时的版本为条件原子提交，提交前记录已变化即返回 versionConflict。
 */

import { newId, type IdFactory } from './ids.ts';
import { validateDeadline } from './deadline.ts';
import type {
  ApplicationOutcome,
  AssessmentNode,
  Deadline,
  FlowNode,
  FlowNodeId,
  InterviewNode,
  InterviewStatus,
  Job,
  JobActionFailure,
  JobActionResult,
  JobProfile,
  JobProfilePatch,
  OfferNode,
  OutcomeStatus,
} from './types.ts';

/** 调用方可注入确定性的 ID 工厂，默认实现不依赖任何平台 API。 */
export interface JobActionOptions {
  generateId?: IdFactory;
}

/** 建档输入：只给招聘链接，或同时给公司与职位。 */
export type CreateJobInput = JobProfile;

export interface LogAssessmentStepInput {
  deadline?: Deadline;
}

export interface LogInterviewStepInput {
  /** 用户指定的轮次名称，如「一面」「二面」。 */
  round: string;
  scheduledAt?: Deadline;
}

export interface LogOfferStepInput {
  replyDeadline?: Deadline;
}

/** 期限补丁：`undefined` 表示不变，`null` 表示清除。 */
export interface AssessmentStepPatch {
  deadline?: Deadline | null;
  completed?: boolean;
}

/** 面试补丁：轮次名称、状态与安排时间可分别更正，未提供的字段不变。 */
export interface InterviewStepPatch {
  round?: string;
  status?: InterviewStatus;
  scheduledAt?: Deadline | null;
}

/** 书面 Offer 补丁：登记时留空的答复期限可事后补填或清除。 */
export interface OfferStepPatch {
  replyDeadline?: Deadline | null;
}

function fail(failure: JobActionFailure): JobActionResult {
  return { ok: false, failure };
}

function versionConflict(): JobActionResult {
  return fail({ reason: 'versionConflict' });
}

/** 返回一份浅拷贝；嵌套对象（期限、结果）总是整体替换，因此浅拷贝足够。 */
function cloneJob(job: Job): Job {
  return {
    id: job.id,
    profile: { ...job.profile },
    starred: job.starred,
    flow: job.flow.map((node) => ({ ...node })),
    outcome: job.outcome ? { ...job.outcome } : null,
    version: job.version,
  };
}

function checkVersion(job: Job, expectedVersion: number): JobActionResult | null {
  return job.version === expectedVersion ? null : versionConflict();
}

function nextId(options: JobActionOptions | undefined, prefix: string): string {
  return options?.generateId ? options.generateId() : newId(prefix);
}

function findNode(
  job: Job,
  nodeId: FlowNodeId,
): { node: FlowNode; index: number } | null {
  const index = job.flow.findIndex((node) => node.id === nodeId);
  return index === -1 ? null : { node: job.flow[index]!, index };
}

function validateProfile(profile: JobProfile): JobActionResult | null {
  if (!profile.postingUrl && !(profile.company && profile.position)) {
    return fail({ reason: 'invalidInput', message: '请填写招聘链接，或同时填写公司与职位。' });
  }
  if (!profile.postingUrl) return null;
  try {
    const url = new URL(profile.postingUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') return null;
  } catch {
    // Parsing fails for relative paths and incomplete addresses.
  }
  return fail({ reason: 'invalidInput', message: '请填写完整的 HTTP 或 HTTPS 招聘链接。' });
}

/** 建档：接受招聘链接，或同时给出公司与职位；流程为空、结果为空、版本为 1。 */
export function createJob(
  input: CreateJobInput,
  options?: JobActionOptions,
): JobActionResult {
  const profile: JobProfile = {};
  for (const key of Object.keys(input) as (keyof JobProfile)[]) {
    const value = input[key];
    if (value?.trim()) profile[key] = key === 'jobDescription' ? value : value.trim();
  }
  const invalid = validateProfile(profile);
  if (invalid) return invalid;

  return {
    ok: true,
    job: {
      id: nextId(options, 'job'),
      profile,
      starred: false,
      flow: [],
      outcome: null,
      version: 1,
    },
  };
}

/** 补填或更正资料：只改本动作负责的字段，沿用原 ID、流程、星标与结果。 */
export function updateJobProfile(
  job: Job,
  expectedVersion: number,
  patch: JobProfilePatch,
): JobActionResult {
  const versionFailure = checkVersion(job, expectedVersion);
  if (versionFailure) {
    return versionFailure;
  }

  const next = cloneJob(job);
  const keys = Object.keys(patch) as (keyof JobProfile)[];
  for (const key of keys) {
    const value = patch[key];
    if (value === undefined) {
      continue;
    }
    next.profile[key] = key === 'jobDescription' ? value : value.trim();
  }
  const invalid = validateProfile(next.profile);
  if (invalid) return invalid;
  next.version = job.version + 1;
  return { ok: true, job: next };
}

/** 设置或取消星标；关注程度与流程、申请结果分别维护。 */
export function setJobStar(
  job: Job,
  expectedVersion: number,
  starred: boolean,
): JobActionResult {
  const versionFailure = checkVersion(job, expectedVersion);
  if (versionFailure) {
    return versionFailure;
  }

  const next = cloneJob(job);
  next.starred = starred;
  next.version = job.version + 1;
  return { ok: true, job: next };
}

function appendStep(
  job: Job,
  expectedVersion: number,
  node: FlowNode,
): JobActionResult {
  const versionFailure = checkVersion(job, expectedVersion);
  if (versionFailure) {
    return versionFailure;
  }
  if (!node.id.trim() || job.flow.some((step) => step.id === node.id)) {
    return fail({ reason: 'invalidInput', message: '新增环节需要独立的节点标识。' });
  }

  const next = cloneJob(job);
  next.flow = [...next.flow, node];
  next.version = job.version + 1;
  return { ok: true, job: next };
}

function validateDeadlineInput(deadline: Deadline | undefined): JobActionFailure | null {
  if (!deadline) {
    return null;
  }
  const message = validateDeadline(deadline);
  return message ? { reason: 'invalidInput', message } : null;
}

/** 登记已投递。每次只增加选中的节点。 */
export function logAppliedStep(
  job: Job,
  expectedVersion: number,
  options?: JobActionOptions,
): JobActionResult {
  return appendStep(job, expectedVersion, {
    kind: 'applied',
    id: nextId(options, 'node'),
  });
}

/** 登记笔试 / 测评，可选截止期限；到期不自动推进。 */
export function logAssessmentStep(
  job: Job,
  expectedVersion: number,
  input: LogAssessmentStepInput = {},
  options?: JobActionOptions,
): JobActionResult {
  const invalid = validateDeadlineInput(input.deadline);
  if (invalid) {
    return fail(invalid);
  }

  return appendStep(job, expectedVersion, {
    kind: 'assessment',
    id: nextId(options, 'node'),
    completed: false,
    ...(input.deadline ? { deadline: input.deadline } : {}),
  });
}

/** 登记指定面试轮次；允许空流程直接记二面，轮次名称独立于节点位置。 */
export function logInterviewStep(
  job: Job,
  expectedVersion: number,
  input: LogInterviewStepInput,
  options?: JobActionOptions,
): JobActionResult {
  const round = input.round.trim();
  if (!round) {
    return fail({ reason: 'invalidInput', message: '面试轮次名称不能为空。' });
  }
  const invalid = validateDeadlineInput(input.scheduledAt);
  if (invalid) {
    return fail(invalid);
  }

  return appendStep(job, expectedVersion, {
    kind: 'interview',
    id: nextId(options, 'node'),
    round,
    status: 'pending',
    ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
  });
}

/** 登记 OC；与书面 Offer 分别记录。 */
export function logOcStep(
  job: Job,
  expectedVersion: number,
  options?: JobActionOptions,
): JobActionResult {
  return appendStep(job, expectedVersion, {
    kind: 'oc',
    id: nextId(options, 'node'),
  });
}

/** 登记书面 Offer；答复期限可选，允许留空后补填。 */
export function logOfferStep(
  job: Job,
  expectedVersion: number,
  input: LogOfferStepInput = {},
  options?: JobActionOptions,
): JobActionResult {
  const invalid = validateDeadlineInput(input.replyDeadline);
  if (invalid) {
    return fail(invalid);
  }

  return appendStep(job, expectedVersion, {
    kind: 'offer',
    id: nextId(options, 'node'),
    ...(input.replyDeadline ? { replyDeadline: input.replyDeadline } : {}),
  });
}

function applyStepPatch<TNode extends FlowNode>(
  job: Job,
  expectedVersion: number,
  nodeId: FlowNodeId,
  expectedKind: TNode['kind'],
  apply: (node: TNode) => TNode,
): JobActionResult {
  const versionFailure = checkVersion(job, expectedVersion);
  if (versionFailure) {
    return versionFailure;
  }

  const found = findNode(job, nodeId);
  if (!found) {
    return fail({ reason: 'nodeNotFound', nodeId });
  }
  if (found.node.kind !== expectedKind) {
    return fail({
      reason: 'nodeKindMismatch',
      nodeId,
      expectedKind,
      actualKind: found.node.kind,
    });
  }

  const next = cloneJob(job);
  const index = found.index;
  const updated = apply(found.node as TNode);
  next.flow = [
    ...next.flow.slice(0, index),
    updated,
    ...next.flow.slice(index + 1),
  ];
  next.version = job.version + 1;
  return { ok: true, job: next };
}

/** 更正测评：标记完成或补改期限，更新原节点，流程长度不变。 */
export function updateAssessmentStep(
  job: Job,
  expectedVersion: number,
  nodeId: FlowNodeId,
  patch: AssessmentStepPatch,
): JobActionResult {
  const invalid = validateDeadlineInput(
    patch.deadline && patch.deadline !== null ? patch.deadline : undefined,
  );
  if (invalid) {
    return fail(invalid);
  }

  return applyStepPatch<AssessmentNode>(
    job,
    expectedVersion,
    nodeId,
    'assessment',
    (node) => {
      const next: AssessmentNode = { ...node };
      if (patch.completed !== undefined) {
        next.completed = patch.completed;
      }
      if (patch.deadline === null) {
        delete next.deadline;
      } else if (patch.deadline !== undefined) {
        next.deadline = patch.deadline;
      }
      return next;
    },
  );
}

/** 更正面试：轮次名称、状态与安排时间按节点 ID 更正，保留节点顺序。 */
export function updateInterviewStep(
  job: Job,
  expectedVersion: number,
  nodeId: FlowNodeId,
  patch: InterviewStepPatch,
): JobActionResult {
  if (patch.round !== undefined && !patch.round.trim()) {
    return fail({ reason: 'invalidInput', message: '面试轮次名称不能为空。' });
  }
  const invalid = validateDeadlineInput(
    patch.scheduledAt && patch.scheduledAt !== null ? patch.scheduledAt : undefined,
  );
  if (invalid) {
    return fail(invalid);
  }

  return applyStepPatch<InterviewNode>(
    job,
    expectedVersion,
    nodeId,
    'interview',
    (node) => {
      const next: InterviewNode = { ...node };
      if (patch.round !== undefined) {
        next.round = patch.round.trim();
      }
      if (patch.status !== undefined) {
        next.status = patch.status;
      }
      if (patch.scheduledAt === null) {
        delete next.scheduledAt;
      } else if (patch.scheduledAt !== undefined) {
        next.scheduledAt = patch.scheduledAt;
      }
      return next;
    },
  );
}

/** 更正书面 Offer 的答复期限：补填日期、补时刻或清除。 */
export function updateOfferStep(
  job: Job,
  expectedVersion: number,
  nodeId: FlowNodeId,
  patch: OfferStepPatch,
): JobActionResult {
  const invalid = validateDeadlineInput(
    patch.replyDeadline && patch.replyDeadline !== null ? patch.replyDeadline : undefined,
  );
  if (invalid) {
    return fail(invalid);
  }

  return applyStepPatch<OfferNode>(
    job,
    expectedVersion,
    nodeId,
    'offer',
    (node) => {
      const next: OfferNode = { ...node };
      if (patch.replyDeadline === null) {
        delete next.replyDeadline;
      } else if (patch.replyDeadline !== undefined) {
        next.replyDeadline = patch.replyDeadline;
      }
      return next;
    },
  );
}

/**
 * 撤回末步：核对用户指定的节点仍是当前末节点，只移除这一个节点。
 * 针对中间节点、空流程或过时末节点的请求返回无法撤回并保留当前记录；
 * 禁止把旧操作自动改为删除新末节点。
 */
export function removeLatestStep(
  job: Job,
  expectedVersion: number,
  expectedLastNodeId: FlowNodeId,
): JobActionResult {
  const versionFailure = checkVersion(job, expectedVersion);
  if (versionFailure) {
    return versionFailure;
  }

  const last = job.flow.at(-1) ?? null;
  if (!last || last.id !== expectedLastNodeId) {
    return fail({
      reason: 'lastNodeMismatch',
      currentLastNodeId: last?.id ?? null,
    });
  }

  const next = cloneJob(job);
  next.flow = next.flow.slice(0, -1);
  next.version = job.version + 1;
  return { ok: true, job: next };
}

/** 登记「已挂 / 已拒」；结果独立保存，只影响结果及其派生的跟进状态。 */
export function recordOutcome(
  job: Job,
  expectedVersion: number,
  status: OutcomeStatus,
): JobActionResult {
  const versionFailure = checkVersion(job, expectedVersion);
  if (versionFailure) {
    return versionFailure;
  }

  const next = cloneJob(job);
  const outcome: ApplicationOutcome = { status };
  next.outcome = outcome;
  next.version = job.version + 1;
  return { ok: true, job: next };
}

/** 清除结果：恢复跟进，原流程、资料与星标保留。 */
export function clearOutcome(
  job: Job,
  expectedVersion: number,
): JobActionResult {
  const versionFailure = checkVersion(job, expectedVersion);
  if (versionFailure) {
    return versionFailure;
  }

  const next = cloneJob(job);
  next.outcome = null;
  next.version = job.version + 1;
  return { ok: true, job: next };
}
