/**
 * API 路由与站点所有者身份守卫。
 *
 * 所有数据路径（岗位、偏好、备份，含健康检查）都在同一入口先核对
 * Sites 平台注入的可信身份头 `oai-authenticated-user-id` 是否等于
 * 本实例部署配置的 OWNER_USER_ID；缺失或不相符一律拒绝。
 * 客户端传入的站点 ID、邮箱或备份内容不能授予所有权。
 */

import { PreferenceValidationError, type BoardFaults } from './board.ts';
import {
  exportSnapshot,
  getJob,
  getPreferences,
  importBackup,
  listJobs,
  savePreferencesPatch,
  submitJobCommand,
} from './board.ts';
import type { BackupFile } from '../src/data/contract.ts';

const OWNER_HEADER = 'oai-authenticated-user-id';

export interface BoardRequestOptions {
  /** 本实例所有者；未配置时拒绝全部数据路径。 */
  ownerUserId: string | undefined;
  /** 测试专用故障注入；生产入口从不提供。 */
  faults?: BoardFaults;
}

const RESPONSE_HEADERS = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: RESPONSE_HEADERS });
}

/** 核对可信身份；返回拒绝响应或 null（放行）。 */
function guardOwner(request: Request, ownerUserId: string | undefined): Response | null {
  if (!ownerUserId) {
    return json({ error: '实例未配置所有者，数据接口已停用。', code: 'OWNER_NOT_CONFIGURED' }, 503);
  }
  const identity = request.headers.get(OWNER_HEADER);
  if (!identity) {
    return json({ error: '缺少站点可信身份。', code: 'NO_IDENTITY' }, 401);
  }
  if (identity !== ownerUserId) {
    return json({ error: '当前身份不是本实例所有者。', code: 'NOT_OWNER' }, 403);
  }
  return null;
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BodyError('提交内容不是有效的 JSON。');
  }
}

class BodyError extends Error {}

export type BoardRouteResult =
  | { handled: true; response: Response }
  | { handled: false; staticAsset: true };

/**
 * 处理一个请求：先身份守卫，再路由；非 API 路径交还调用方处理静态资产。
 */
export async function handleBoardRequest(
  request: Request,
  db: D1Database,
  options: BoardRequestOptions,
): Promise<BoardRouteResult> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) {
    return { handled: false, staticAsset: true };
  }
  if (request.method === 'GET' && url.pathname === '/api/session') {
    const userId = request.headers.get(OWNER_HEADER);
    return {
      handled: true,
      response: userId ? json({ userId }) : json({ error: '请先登录站点。', code: 'NO_IDENTITY' }, 401),
    };
  }

  const denied = guardOwner(request, options.ownerUserId);
  if (denied) {
    return { handled: true, response: denied };
  }
  const origin = request.headers.get('Origin');
  if (!['GET', 'HEAD'].includes(request.method) && origin && origin !== url.origin) {
    return { handled: true, response: json({ error: '请从当前站点保存。' }, 403) };
  }

  try {
    const response = await routeApi(request, url, db, options.faults);
    return { handled: true, response };
  } catch (error) {
    if (error instanceof BodyError) {
      return { handled: true, response: json({ error: error.message, code: 'INVALID_BODY' }, 400) };
    }
    return {
      handled: true,
      response: json({ error: '暂时无法完成操作，请稍后重试。', code: 'INTERNAL_ERROR' }, 500),
    };
  }
}

async function routeApi(
  request: Request,
  url: URL,
  db: D1Database,
  faults?: BoardFaults,
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  if ((method === 'GET' || method === 'HEAD') && path === '/api/board/health') {
    return new Response(null, { status: 204 });
  }

  if (path === '/api/board/jobs') {
    if (method === 'GET') {
      return json({ jobs: await listJobs(db) });
    }
  }

  if (path === '/api/board/commands' && method === 'POST') {
    const body = await readJsonBody(request);
    const outcome = await submitJobCommand(db, body as never);
    return json(outcome);
  }

  const jobMatch = path.match(/^\/api\/board\/jobs\/([^/]+)$/);
  if (jobMatch && method === 'GET') {
    const job = await getJob(db, decodeURIComponent(jobMatch[1]!));
    return json({ job });
  }

  if (path === '/api/board/preferences') {
    if (method === 'GET') {
      return json({ preferences: await getPreferences(db) });
    }
    if (method === 'PUT') {
      const body = await readJsonBody(request);
      try {
        const preferences = await savePreferencesPatch(db, body as never);
        return json({ status: 'confirmed', preferences });
      } catch (error) {
        if (error instanceof PreferenceValidationError) {
          return json(
            { status: 'rejected', failure: { reason: 'invalidPreferences', message: error.message } },
            400,
          );
        }
        throw error;
      }
    }
  }

  if (path === '/api/board/backup' && method === 'GET') {
    const backup = await exportSnapshot(db);
    return json(backup satisfies BackupFile);
  }

  if (path === '/api/board/backup/import' && method === 'POST') {
    const body = await readJsonBody(request);
    const result = await importBackup(db, body, faults);
    if (result.ok) {
      return json({ status: 'confirmed' });
    }
    if (result.reason === 'invalidBackup') {
      return json({ status: 'rejected', reason: 'invalidBackup', message: result.message }, 400);
    }
    if (result.reason === 'targetNotEmpty') {
      return json({ status: 'rejected', reason: 'targetNotEmpty', message: result.message }, 409);
    }
    return json({ error: { kind: 'failed', message: result.message } }, 500);
  }

  const knownPath =
    path === '/api/board/jobs' ||
    path === '/api/board/commands' ||
    path === '/api/board/preferences' ||
    path === '/api/board/backup' ||
    path === '/api/board/backup/import';
  if (knownPath) {
    return json({ error: '请求方法不受支持。', code: 'METHOD_NOT_ALLOWED' }, 405);
  }
  return json({ error: '接口不存在。', code: 'NOT_FOUND' }, 404);
}
