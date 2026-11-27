/**
 * 私有 Sites 的 HTTP 数据适配器。
 *
 * 实现 src/data/contract.ts 的 JobBoardStore：把岗位命令发往站点 API，
 * 由服务端在可信端按同一套共享校验与领域动作执行，并按版本条件提交。
 * 三态结果映射（与 worker/routes.ts 的真实返回结构对应）：
 * - 服务端确认（2xx 且确认结构有效）→ confirmed；
 * - 发送前已确定断网、鉴权或实例配置拒绝（401/403、OWNER_NOT_CONFIGURED）、
 *   请求体不合法（400 INVALID_BODY）、目标非空（409）→ rejected/failed
 *   （未保存，保留服务端错误详情，不自动补传）；
 * - 请求已发出但失去响应、通用 5xx 或成功响应缺少有效确认结构 → unconfirmed
 *   （提示「未确认是否保存，请刷新查看」）。
 *
 * 「未保存」只有在能证明请求未被处理时才可判定：发送前预检断网，或
 * 服务端在处理前就明确拒绝（鉴权、配置、请求体解析、目标非空）。
 * 一旦请求进入业务处理（命令已受理），网络拒绝、响应体丢失或
 * 确认结构异常都只能按 unconfirmed 处理——请求可能已经提交。
 *
 * 岗位记录的响应校验复用备份解码（decodeBackup），不复制领域模型。
 */

import {
  decodeBackup,
  encodeBackup,
} from '../data/backup.ts';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  defaultBoardPreferences,
  type BoardPreferences,
  type CommandOutcome,
  type ExportOutcome,
  type ImportOutcome,
  type JobBoardStore,
  type JobCommand,
  type PreferencesOutcome,
  type PreferencesPatch,
  type ReadResult,
  type StorageReadFailure,
} from '../data/contract.ts';
import { validatePreferences } from '../data/preferences.ts';
import type { Job, JobId } from '../domain/index.ts';

export interface SitesJobBoardOptions {
  /** 站点 API 基址；空字符串表示同源站点 API。 */
  apiBaseUrl: string;
  /** 可注入的 fetch 实现，默认使用全局 fetch；测试替身通过它模拟断网与响应丢失。 */
  fetch?: typeof fetch;
  /**
   * 发送前的离线预检，默认读取 `navigator.onLine`。
   * 返回 true 时确定断网，请求直接按未保存拒绝，不发出。
   */
  isOffline?: () => boolean;
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}${path}`;
}

const DEFAULT_OFFLINE_CHECK = () =>
  typeof navigator !== 'undefined' && navigator.onLine === false;

/** 服务端明确拒绝的身份与配置错误码（见 worker/routes.ts guardOwner）。 */
const DENIAL_CODES = new Set(['NO_IDENTITY', 'NOT_OWNER', 'OWNER_NOT_CONFIGURED']);

interface ErrorBody {
  error?: unknown;
  code?: unknown;
}

/** 解析拒绝响应的服务端错误详情，保留原文供界面展示。 */
function denialMessage(body: ErrorBody | null, fallback: string): string {
  const detail = body?.error;
  return typeof detail === 'string' && detail.trim() ? detail : fallback;
}

/** 判断非 2xx 响应是否属于「处理前明确拒绝」：鉴权、实例配置或请求体不合法。 */
function isDefiniteDenial(response: Response, body: ErrorBody | null): boolean {
  if (response.status === 401 || response.status === 403) {
    return true;
  }
  if (response.status === 400) {
    // worker 只在请求体不是 JSON 时返回 400（INVALID_BODY）：必然未处理。
    return body?.code === 'INVALID_BODY' || body?.code === undefined;
  }
  if (response.status === 503) {
    return body?.code === 'OWNER_NOT_CONFIGURED';
  }
  return false;
}

export function createSitesJobBoard(options: SitesJobBoardOptions): Promise<JobBoardStore> {
  const apiBaseUrl = options.apiBaseUrl;
  const doFetch = options.fetch ?? ((input: string | URL | Request, init?: RequestInit) => fetch(input, init));
  const isOffline = options.isOffline ?? DEFAULT_OFFLINE_CHECK;

  /** 发送前已知断网的标记错误：只在预检处抛出，调用方据此报告「未保存」。 */
  class OfflineBeforeSendError extends Error {}

  function requireOnline(): void {
    if (isOffline()) {
      throw new OfflineBeforeSendError();
    }
  }

  /** 请求发出前已知断网（仅预检抛出时成立）。 */
  function wasOfflineBeforeSend(error: unknown): boolean {
    return error instanceof OfflineBeforeSendError;
  }

  async function send(path: string, init: RequestInit): Promise<Response> {
    return doFetch(joinUrl(apiBaseUrl, path), init);
  }

  function sendFailedRead(): StorageReadFailure {
    return { reason: 'unavailable', message: '网络不可用，暂时无法读取。' };
  }

  function sendFailedMessage(): string {
    return '网络不可用，本次保存未完成。';
  }

  async function parseJson<T>(response: Response): Promise<T | null> {
    try {
      const value: unknown = await response.json();
      return isPlainObject(value) ? value as T : null;
    } catch {
      return null;
    }
  }

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * 用备份解码校验服务端返回的岗位记录（单条或数组），复用整包校验规则：
   * 结构、重复标识、合法状态与可解析日期全部通过才返回可信记录。
   */
  function validateServerJobs(value: unknown): readonly Job[] | null {
    if (!Array.isArray(value)) {
      return null;
    }
    const decoded = decodeBackup({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      applications: value,
      preferences: defaultBoardPreferences(),
    });
    return decoded.ok ? decoded.backup.applications : null;
  }

  const store: JobBoardStore = {
    mode: 'sites',

    async listJobs(): Promise<ReadResult<readonly Job[]>> {
      let response: Response;
      try {
        requireOnline();
        response = await send('/api/board/jobs', { method: 'GET', cache: 'no-store' });
      } catch (error) {
        return wasOfflineBeforeSend(error)
          ? { ok: false, failure: sendFailedRead() }
          : { ok: false, failure: { reason: 'unknown', message: '未收到读取结果，请刷新重试。' } };
      }
      const body = await parseJson<{ jobs?: unknown } & ErrorBody>(response);
      if (!response.ok) {
        const message = denialMessage(body, '站点暂时无法读取看板。');
        // 读取失败不区分已保存与否：明确拒绝保留详情，其余按暂时不可用。
        return { ok: false, failure: { reason: 'unavailable', message } };
      }
      if (!body || !('jobs' in body)) {
        return { ok: false, failure: { reason: 'unavailable', message: '站点返回的岗位列表结构异常。' } };
      }
      const jobs = validateServerJobs(body.jobs);
      if (!jobs) {
        return { ok: false, failure: { reason: 'unavailable', message: '站点返回的岗位记录结构异常。' } };
      }
      return { ok: true, value: jobs };
    },

    async getJob(jobId: JobId): Promise<ReadResult<Job | null>> {
      let response: Response;
      try {
        requireOnline();
        response = await send(`/api/board/jobs/${encodeURIComponent(jobId)}`, {
          method: 'GET',
          cache: 'no-store',
        });
      } catch (error) {
        return wasOfflineBeforeSend(error)
          ? { ok: false, failure: sendFailedRead() }
          : { ok: false, failure: { reason: 'unknown', message: '未收到读取结果，请刷新重试。' } };
      }
      const body = await parseJson<{ job?: unknown } & ErrorBody>(response);
      if (!response.ok) {
        return { ok: false, failure: { reason: 'unavailable', message: denialMessage(body, '站点暂时无法读取该岗位。') } };
      }
      if (!body || !('job' in body)) {
        return { ok: false, failure: { reason: 'unavailable', message: '站点返回的岗位记录结构异常。' } };
      }
      if (body.job === null) {
        return { ok: true, value: null };
      }
      const jobs = validateServerJobs([body.job]);
      if (!jobs || jobs[0]?.id !== jobId) {
        return { ok: false, failure: { reason: 'unavailable', message: '站点返回的岗位记录结构异常。' } };
      }
      return { ok: true, value: jobs[0]! };
    },

    async submitJobCommand(command: JobCommand): Promise<CommandOutcome> {
      // 发送前预检：确定断网才能报告「未保存」。
      try {
        requireOnline();
      } catch {
        return {
          status: 'rejected',
          failure: { reason: 'invalidInput', message: sendFailedMessage() },
        };
      }
      let response: Response;
      try {
        response = await send('/api/board/commands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command),
        });
      } catch {
        // 请求已发出：无法判断是否提交，不做事后探测。
        return { status: 'unconfirmed' };
      }
      const body = await parseJson<CommandOutcome & ErrorBody>(response);
      if (!response.ok) {
        // 处理前的明确拒绝（鉴权、配置、请求体不合法）必然未提交 → 未保存。
        if (isDefiniteDenial(response, body)) {
          return {
            status: 'rejected',
            failure: {
              reason: 'invalidInput',
              message: denialMessage(body, '站点拒绝了本次操作，请重新登录站点或联系实例所有者。'),
            },
          };
        }
        // 业务拒绝由服务端以 200 + rejected 表达；其余（通用 5xx 等）按未确认。
        return { status: 'unconfirmed' };
      }
      if (body?.status === 'rejected' && isPlainObject(body.failure) && typeof body.failure.reason === 'string') {
        return body;
      }
      if (
        body &&
        body.status === 'confirmed' &&
        isPlainObject(body.job)
      ) {
        // 确认结构还须携带通过校验的岗位记录；缺 job 或结构异常时不视作确认。
        const jobs = validateServerJobs([body.job]);
        if (jobs && jobs[0]?.id === command.jobId) {
          return { status: 'confirmed', job: jobs[0]! };
        }
      }
      // 成功状态但缺少有效确认结构：可能已提交，按未确认处理。
      return { status: 'unconfirmed' };
    },

    async getPreferences(): Promise<ReadResult<BoardPreferences>> {
      let response: Response;
      try {
        requireOnline();
        response = await send('/api/board/preferences', { method: 'GET', cache: 'no-store' });
      } catch (error) {
        return wasOfflineBeforeSend(error)
          ? { ok: false, failure: sendFailedRead() }
          : { ok: false, failure: { reason: 'unknown', message: '未收到读取结果，请刷新重试。' } };
      }
      const body = await parseJson<{ preferences?: unknown } & ErrorBody>(response);
      if (!response.ok) {
        return { ok: false, failure: { reason: 'unavailable', message: denialMessage(body, '站点暂时无法读取偏好。') } };
      }
      const validated = body ? validatePreferences(body.preferences) : null;
      if (validated?.ok) {
        return { ok: true, value: validated.preferences };
      }
      // 服务端应永远返回合法偏好；结构异常时如实报告，不伪造缺省布局。
      return { ok: false, failure: { reason: 'unavailable', message: '站点返回的偏好结构异常，请刷新重试。' } };
    },

    async savePreferences(patch: PreferencesPatch): Promise<PreferencesOutcome> {
      try {
        requireOnline();
      } catch {
        return { status: 'failed', message: sendFailedMessage() };
      }
      let response: Response;
      try {
        response = await send('/api/board/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
      } catch {
        return { status: 'unconfirmed' };
      }
      const body = await parseJson<Record<string, unknown> & ErrorBody>(response);
      if ((response.ok || response.status === 400) && body?.status === 'rejected') {
        const failure = isPlainObject(body.failure) ? body.failure : null;
        return {
          status: 'rejected',
          failure: {
            reason: 'invalidPreferences',
            message:
              failure && typeof failure.message === 'string' && failure.message.trim()
                ? failure.message
                : '偏好未通过服务端校验。',
          },
        };
      }
      if (isDefiniteDenial(response, body)) {
        return { status: 'failed', message: denialMessage(body, '站点拒绝了本次保存，请重新登录站点或联系实例所有者。') };
      }
      if (response.ok && body?.status === 'confirmed') {
        const validated = validatePreferences(
          (body as { preferences?: unknown }).preferences,
        );
        if (validated.ok) {
          return { status: 'confirmed', preferences: validated.preferences };
        }
        // 确认响应缺少合法偏好：写入可能已提交，按未确认处理。
        return { status: 'unconfirmed' };
      }
      return { status: 'unconfirmed' };
    },

    async exportSnapshot(): Promise<ExportOutcome> {
      let response: Response;
      try {
        requireOnline();
        response = await send('/api/board/backup', { method: 'GET', cache: 'no-store' });
      } catch (error) {
        return wasOfflineBeforeSend(error)
          ? { ok: false, failure: sendFailedRead() }
          : { ok: false, failure: { reason: 'unknown', message: '未收到导出结果，请刷新重试。' } };
      }
      const body = await parseJson<unknown>(response);
      if (!response.ok) {
        return { ok: false, failure: { reason: 'unavailable', message: '站点暂时无法导出备份。' } };
      }
      // 导出即一次一致快照请求；本地复用整包校验核对结构，不重排内容。
      const decoded = decodeBackup(body);
      if (!decoded.ok) {
        return { ok: false, failure: { reason: 'unavailable', message: '导出内容结构异常。' } };
      }
      return { ok: true, backup: encodeBackup(decoded.backup.applications, decoded.backup.preferences) };
    },

    async importBackup(parsed: unknown): Promise<ImportOutcome> {
      // 先在客户端整包校验，目标尚未触碰即可报告可定位的问题。
      const decoded = decodeBackup(parsed);
      if (!decoded.ok) {
        return { status: 'rejected', reason: 'invalidBackup', issues: decoded.issues };
      }
      try {
        requireOnline();
      } catch {
        return { status: 'failed', message: sendFailedMessage() };
      }
      let response: Response;
      try {
        response = await send('/api/board/backup/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed),
        });
      } catch {
        return { status: 'unconfirmed' };
      }
      const body = await parseJson<Record<string, unknown> & ErrorBody>(response);
      if (response.ok && body?.status === 'confirmed') {
        return { status: 'confirmed' };
      }
      if ((response.ok || response.status === 400) && body?.status === 'rejected' && body.reason === 'invalidBackup') {
        return {
          status: 'rejected',
          reason: 'invalidBackup',
          issues: [{ path: '', message: typeof body.message === 'string' ? body.message : '备份未通过服务端校验。' }],
        };
      }
      if ((response.ok || response.status === 409) && body?.status === 'rejected' && body.reason === 'targetNotEmpty') {
        return {
          status: 'rejected',
          reason: 'targetNotEmpty',
          message: typeof body.message === 'string' ? body.message : '目标看板已有岗位，导入被拒绝。',
        };
      }
      if (isDefiniteDenial(response, body)) {
        return { status: 'failed', message: denialMessage(body, '站点拒绝了本次导入，请重新登录站点或联系实例所有者。') };
      }
      if (body && isPlainObject(body.error) && body.error.kind === 'failed' && typeof body.error.message === 'string') {
        return { status: 'failed', message: String(body.error.message) };
      }
      return { status: 'unconfirmed' };
    },
  };

  return Promise.resolve(store);
}
