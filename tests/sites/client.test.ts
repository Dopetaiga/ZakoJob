/**
 * Sites HTTP 客户端聚焦回归。
 *
 * 用注入 fetch 的替身复现修复前的三类缺陷并验证修复后映射：
 * 1. `confirmed` 却缺少岗位记录 → 必须按未确认（此前判为成功）；
 * 2. 偏好结构异常 → 必须如实报告，不得伪造缺省布局；
 * 3. 鉴权 / OWNER_NOT_CONFIGURED 明确拒绝 → 未保存，保留服务端详情
 *    （此前一律判为「未确认是否保存」）。
 * 另覆盖读写边界：岗位列表/单条记录结构校验复用备份解码、
 * 通用 5xx 与响应丢失仍按未确认、发送前断网按未保存。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSitesJobBoard } from '../../src/sites/client.ts';
import type { JobCommand } from '../../src/data/contract.ts';

/** 造一份可提交的合法岗位记录（通过服务端确认响应回送）。 */
function validJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job-1',
    profile: { company: '青禾科技', position: '前端工程师' },
    starred: false,
    flow: [],
    outcome: null,
    version: 2,
    ...overrides,
  };
}

/** fetch 替身：按序返回响应或抛错。 */
function fetchStub(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response> | never,
): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const stub = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url instanceof Request ? url.url : url));
    return Promise.resolve(handler(String(url), init));
  }) as typeof fetch;
  return { fetch: stub as typeof fetch, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CREATE_COMMAND: JobCommand = {
  kind: 'create-job',
  jobId: 'job-1',
  input: { postingUrl: 'https://jobs.example.com/qr-1' },
};

const OFFLINE = { isOffline: () => false };

it('错误的响应记录与列表类型不能覆盖当前看板', async () => {
  for (const value of ['unavailable', { jobs: null }]) {
    const { fetch } = fetchStub(() => jsonResponse(value));
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    assert.equal((await store.listJobs()).ok, false);
  }
  const { fetch } = fetchStub(() => jsonResponse({ status: 'confirmed', job: validJob({ id: 'other-job' }) }));
  const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
  assert.equal((await store.submitJobCommand(CREATE_COMMAND)).status, 'unconfirmed');
});

describe('命令结果映射', () => {
  it('confirmed 却缺少岗位记录 → 未确认（复现修复前判成功）', async () => {
    const { fetch } = fetchStub(() => jsonResponse({ status: 'confirmed' }));
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.submitJobCommand(CREATE_COMMAND);
    assert.equal(outcome.status, 'unconfirmed');
  });

  it('confirmed 携带结构非法的岗位记录 → 未确认', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({ status: 'confirmed', job: validJob({ version: 0 }) }),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.submitJobCommand(CREATE_COMMAND);
    assert.equal(outcome.status, 'unconfirmed');
  });

  it('confirmed 携带合法岗位记录 → 确认并回传校验后的记录', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({ status: 'confirmed', job: validJob() }),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.submitJobCommand(CREATE_COMMAND);
    assert.equal(outcome.status, 'confirmed');
    assert.ok(outcome.status === 'confirmed' && outcome.job.id === 'job-1');
  });

  it('业务拒绝（200 + rejected）→ 拒绝并保留失败详情', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({
        status: 'rejected',
        failure: { reason: 'versionConflict', message: '该岗位已被另一端更新。' },
      }),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.submitJobCommand({
      kind: 'set-star', jobId: 'job-1', expectedVersion: 1, starred: true,
    });
    assert.equal(outcome.status, 'rejected');
    assert.ok(outcome.status === 'rejected' && outcome.failure.reason === 'versionConflict');
    assert.equal(
      outcome.status === 'rejected' && 'message' in outcome.failure && outcome.failure.message,
      '该岗位已被另一端更新。',
    );
  });

  it('403 NOT_OWNER → 未保存（复现修复前判未确认），保留服务端详情', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({ error: '当前身份不是本实例所有者。', code: 'NOT_OWNER' }, 403),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.submitJobCommand(CREATE_COMMAND);
    assert.equal(outcome.status, 'rejected');
    assert.ok(
      outcome.status === 'rejected' &&
      'message' in outcome.failure &&
      outcome.failure.message?.includes('当前身份不是本实例所有者'),
    );
  });

  it('401 NO_IDENTITY → 未保存', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({ error: '缺少站点可信身份。', code: 'NO_IDENTITY' }, 401),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.submitJobCommand(CREATE_COMMAND);
    assert.equal(outcome.status, 'rejected');
  });

  it('503 OWNER_NOT_CONFIGURED → 未保存（鉴权配置拒绝，非「未确认」）', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse(
        { error: '实例未配置所有者，数据接口已停用。', code: 'OWNER_NOT_CONFIGURED' },
        503,
      ),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.submitJobCommand(CREATE_COMMAND);
    assert.equal(outcome.status, 'rejected');
    assert.ok(
      outcome.status === 'rejected' &&
      'message' in outcome.failure &&
      outcome.failure.message?.includes('实例未配置所有者'),
    );
  });

  it('通用 500 → 未确认（可能已提交，不当拒绝）', async () => {
    const { fetch } = fetchStub(() => jsonResponse({ error: 'x', code: 'INTERNAL_ERROR' }, 500));
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.submitJobCommand(CREATE_COMMAND);
    assert.equal(outcome.status, 'unconfirmed');
  });

  it('请求已发出但连接失败 → 未确认', async () => {
    const { fetch } = fetchStub(() => {
      throw new Error('simulated connection lost');
    });
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.submitJobCommand(CREATE_COMMAND);
    assert.equal(outcome.status, 'unconfirmed');
  });

  it('发送前已断网 → 未保存，不发请求', async () => {
    const { fetch, calls } = fetchStub(() => jsonResponse({ status: 'confirmed', job: validJob() }));
    const store = await createSitesJobBoard({
      apiBaseUrl: '', fetch, isOffline: () => true,
    });
    const outcome = await store.submitJobCommand(CREATE_COMMAND);
    assert.equal(outcome.status, 'rejected');
    assert.equal(calls.length, 0);
  });
});

describe('读取边界', () => {
  it('岗位列表含结构非法记录 → 读取失败（复用备份解码校验）', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({ jobs: [validJob(), validJob({ id: 'job-2', outcome: { status: 'hired' } })] }),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const result = await store.listJobs();
    assert.ok(!result.ok);
    assert.match(result.failure.message ?? "", /结构异常/);
  });

  it('岗位列表结构合法 → 原样返回', async () => {
    const { fetch } = fetchStub(() => jsonResponse({ jobs: [validJob()] }));
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const result = await store.listJobs();
    assert.ok(result.ok);
    assert.equal(result.value.length, 1);
    assert.equal(result.value[0]!.id, 'job-1');
  });

  it('单条岗位返回结构非法 → 读取失败', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({ job: validJob({ flow: [{ kind: 'applied', id: 'dup' }, { kind: 'applied', id: 'dup' }] }) }),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const result = await store.getJob('job-1');
    assert.ok(!result.ok);
    assert.match(result.failure.message ?? "", /结构异常/);
  });

  it('单条岗位不存在 → 成功返回 null', async () => {
    const { fetch } = fetchStub(() => jsonResponse({ job: null }));
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const result = await store.getJob('missing');
    assert.ok(result.ok);
    assert.equal(result.value, null);
  });
});

describe('偏好边界', () => {
  it('读取到结构异常的偏好 → 读取失败（复现修复前伪造缺省布局）', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({ preferences: { shared: 'jobs first', mobile: {}, desktop: {} } }),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const result = await store.getPreferences();
    assert.ok(!result.ok);
    assert.match(result.failure.message ?? "", /偏好结构异常/);
  });

  it('读取到合法偏好 → 原样返回', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({
        preferences: {
          shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
          mobile: { overridden: false },
          desktop: { overridden: false },
        },
      }),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const result = await store.getPreferences();
    assert.ok(result.ok);
    assert.equal(result.value.shared.modules[0]!.id, 'jobs');
  });

  it('保存确认却携带结构异常偏好 → 未确认（复现修复前回送缺省布局）', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({ status: 'confirmed', preferences: { modules: [] } }),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.savePreferences({
      shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
    });
    assert.equal(outcome.status, 'unconfirmed');
  });

  it('保存确认携带合法偏好 → 确认', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({
        status: 'confirmed',
        preferences: {
          shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
          mobile: { overridden: false },
          desktop: { overridden: false },
        },
      }),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.savePreferences({
      shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
    });
    assert.equal(outcome.status, 'confirmed');
  });

  it('保存被鉴权拒绝 → 失败并保留服务端详情', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({ error: '当前身份不是本实例所有者。', code: 'NOT_OWNER' }, 403),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.savePreferences({
      shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
    });
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.status === 'failed' ? outcome.message : '', /当前身份不是本实例所有者/);
  });
});

describe('导入与导出边界', () => {
  it('导入目标非空（409）→ 拒绝并保留服务端消息', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({ status: 'rejected', reason: 'targetNotEmpty', message: '目标看板已有 2 份岗位。' }, 409),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.importBackup({
      format: 'zakoujob-backup',
      version: 1,
      applications: [],
      preferences: {
        shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
        mobile: { overridden: false },
        desktop: { overridden: false },
      },
    });
    assert.equal(outcome.status, 'rejected');
    assert.ok(
      outcome.status === 'rejected' &&
      outcome.reason === 'targetNotEmpty' &&
      outcome.message.includes('已有 2 份岗位'),
    );
  });

  it('导入被鉴权拒绝 → 失败并保留详情', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({ error: '缺少站点可信身份。', code: 'NO_IDENTITY' }, 401),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.importBackup({
      format: 'zakoujob-backup',
      version: 1,
      applications: [],
      preferences: {
        shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
        mobile: { overridden: false },
        desktop: { overridden: false },
      },
    });
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.status === 'failed' ? outcome.message : '', /缺少站点可信身份/);
  });

  it('导入批次失败（error.kind=failed）→ 失败', async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse({ error: { kind: 'failed', message: '导入批次中途失败。' } }, 500),
    );
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const outcome = await store.importBackup({
      format: 'zakoujob-backup',
      version: 1,
      applications: [],
      preferences: {
        shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
        mobile: { overridden: false },
        desktop: { overridden: false },
      },
    });
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.status === 'failed' ? outcome.message : '', /批次中途失败/);
  });

  it('导出结构异常 → 读取失败', async () => {
    const { fetch } = fetchStub(() => jsonResponse({ format: 'other-format', version: 9 }));
    const store = await createSitesJobBoard({ apiBaseUrl: '', fetch, ...OFFLINE });
    const result = await store.exportSnapshot();
    assert.ok(!result.ok);
    assert.match(result.failure.message ?? "", /结构异常|无法导出/);
  });
});
