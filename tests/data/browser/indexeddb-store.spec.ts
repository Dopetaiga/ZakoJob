/**
 * IndexedDB 适配器浏览器验收（persist-job-data 2.1–2.3）。
 *
 * 运行方式：npx playwright test --config tests/data/browser/playwright.config.ts
 * 依赖本机 Edge（channel msedge）与 vite 开发服务器（配置内自动拉起）。
 *
 * 覆盖：
 * - 2.1 首次为空、真实业务动作建档加星登记二面、刷新可读回、
 *   手机偏好单独设置后桌面仍沿用共用布局；
 * - 2.2 两个标签页过时撤回被拒绝；注入故障使导入事务中止后原记录保留；
 * - 2.3 快照导出（空板含偏好）、偏好-only 恢复成功、
 *   已有岗位拒绝导入、导入中途出错整体回滚。
 */

import { expect, test, type Page } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';

let server: ViteDevServer;
test.beforeAll(async () => {
  const { createServer } = await import('vite');
  server = await createServer({
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  });
  await server.listen();
});
test.afterAll(async () => { await server?.close(); });

const fixturePath = '/tests/data/fixture/idb-fixture.html';

function fixtureUrl(options: { db: string; faultImport?: boolean; entry?: boolean }): string {
  const params = new URLSearchParams({ db: options.db });
  if (options.faultImport) params.set('faultImport', '1');
  if (options.entry) params.set('entry', '1');
  return new URL(`${fixturePath}?${params}`, server.resolvedUrls!.local[0]).href;
}

/** 等待验证台就绪并返回驱动句柄。 */
async function openFixture(page: Page, options: { db: string; faultImport?: boolean; entry?: boolean }) {
  await page.goto(fixtureUrl(options));
  await page.waitForFunction(() => Boolean((window as never as { __board?: unknown }).__board));
  return page.evaluateHandle(() => (window as never as { __board: BoardApi }).__board);
}

/** 驱动暴露的 API 形状（结果均为可 JSON 序列化的契约结果）。 */
interface BoardApi {
  mode(): Promise<{ mode: 'indexeddb' | 'sites' }>;
  list(): Promise<{ ok: boolean; value?: readonly unknown[] }>;
  get(jobId: string): Promise<{ ok: boolean; value?: unknown }>;
  command(command: unknown): Promise<Record<string, unknown>>;
  prefs(): Promise<{ ok: boolean; value?: Record<string, unknown> }>;
  savePrefs(patch: unknown): Promise<Record<string, unknown>>;
  export(): Promise<{ ok: boolean; backup?: Record<string, unknown> }>;
  import(parsed: unknown): Promise<Record<string, unknown>>;
}

/** 在页面上下文里调用驱动方法（跨 realm 序列化参数与结果）。 */
async function call<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(async ([method, args]) => {
    const board = (window as never as { __board: BoardApi }).__board;
    return (board[method as keyof BoardApi] as (...a: unknown[]) => Promise<T>)(...args);
  }, [method, args]);
}

test.describe('IndexedDB 适配器（2.1）', () => {
  test('默认入口选择 IndexedDB，首次为空，建档加星登记二面后刷新可读回', async ({ page }) => {
    const db = 'zako-a21';
    await openFixture(page, { db, entry: true });

    expect(await call<string>(page, 'mode')).toBe('indexeddb');

    const empty = await call<{ ok: boolean; value: unknown[] }>(page, 'list');
    expect(empty.ok).toBe(true);
    expect(empty.value).toEqual([]);

    // 建档（稳定 ID 由调用方生成）
    const created = await call<Record<string, unknown>>(page, 'command', {
      kind: 'create-job',
      jobId: 'job-a21-1',
      input: { postingUrl: 'https://jobs.example.com/qr-a21' },
    });
    expect(created.status).toBe('confirmed');

    // 加星
    const starred = await call<Record<string, unknown>>(page, 'command', {
      kind: 'set-star',
      jobId: 'job-a21-1',
      expectedVersion: 1,
      starred: true,
    });
    expect(starred.status).toBe('confirmed');

    // 登记二面（带时刻安排）
    const step = await call<Record<string, unknown>>(page, 'command', {
      kind: 'log-step',
      jobId: 'job-a21-1',
      expectedVersion: 2,
      nodeId: 'node-a21-second',
      step: { kind: 'interview', round: '二面', scheduledAt: { precision: 'datetime', date: '2026-12-02', time: '15:30' } },
    });
    expect(step.status).toBe('confirmed');

    // 刷新后读回：同一岗位、星标与二面时刻（新会话继续使用）
    await page.reload();
    await page.waitForFunction(() => Boolean((window as never as { __board?: unknown }).__board));
    const after = await call<{ ok: boolean; value: Record<string, unknown>[] }>(page, 'list');
    expect(after.ok).toBe(true);
    expect(after.value).toHaveLength(1);
    const job = after.value[0]!;
    expect(job.id).toBe('job-a21-1');
    expect(job.starred).toBe(true);
    expect(job.version).toBe(3);
    const flow = job.flow as Array<Record<string, unknown>>;
    expect(flow).toHaveLength(1);
    expect(flow[0]!.kind).toBe('interview');
    expect(flow[0]!.round).toBe('二面');
    expect(flow[0]!.scheduledAt).toEqual({ precision: 'datetime', date: '2026-12-02', time: '15:30' });
  });

  test('手机偏好单独设置后，桌面仍沿用共用布局', async ({ page }) => {
    const db = 'zako-a21-prefs';
    await openFixture(page, { db });

    // 只调整手机布局（含隐藏模块的覆盖）
    const saved = await call<Record<string, unknown>>(page, 'savePrefs', {
      mobile: {
        overridden: true,
        layout: { modules: [{ id: 'schedule', visible: true }, { id: 'jobs', visible: false }] },
      },
    });
    expect(saved.status).toBe('confirmed');

    // 手机读到单独顺序，共用布局未变
    const prefs = await call<{ ok: boolean; value: Record<string, unknown> }>(page, 'prefs');
    expect(prefs.ok).toBe(true);
    expect((prefs.value!.mobile as Record<string, unknown>).overridden).toBe(true);
    expect((prefs.value!.shared as Record<string, unknown>).modules).toEqual([
      { id: 'jobs', visible: true },
      { id: 'schedule', visible: true },
    ]);
    expect((prefs.value!.desktop as Record<string, unknown>).overridden).toBe(false);

    // 刷新后手机覆盖仍在；桌面语义上继续读 shared（未被 mobile patch 覆盖）
    await page.reload();
    await page.waitForFunction(() => Boolean((window as never as { __board?: unknown }).__board));
    const after = await call<{ ok: boolean; value: Record<string, unknown> }>(page, 'prefs');
    expect((after.value!.mobile as Record<string, unknown>).overridden).toBe(true);
    expect((after.value!.desktop as Record<string, unknown>).overridden).toBe(false);
  });
});

test.describe('IndexedDB 适配器（2.2）', () => {
  test('两个标签页：过时撤回被拒绝，重读后二面三面均在', async ({ page, context }) => {
    const db = 'zako-a22-conflict';
    await openFixture(page, { db });

    // 共同初始状态：已投递 + 二面
    await call<Record<string, unknown>>(page, 'command', {
      kind: 'create-job',
      jobId: 'job-a22',
      input: { company: '青禾科技', position: '前端工程师' },
    });
    await call<Record<string, unknown>>(page, 'command', {
      kind: 'log-step', jobId: 'job-a22', expectedVersion: 1, nodeId: 'n-applied', step: { kind: 'applied' },
    });
    const secondStep = await call<Record<string, unknown>>(page, 'command', {
      kind: 'log-step', jobId: 'job-a22', expectedVersion: 2, nodeId: 'n-second', step: { kind: 'interview', round: '二面' },
    });
    expect(secondStep.status).toBe('confirmed');

    // 标签页 A（本页）读到版本 3；标签页 B（第二页）读到同一岗位
    const pageB = await context.newPage();
    await openFixture(pageB, { db });

    // B 先成功追加三面 → 版本 4
    const thirdStep = await call<Record<string, unknown>>(pageB, 'command', {
      kind: 'log-step', jobId: 'job-a22', expectedVersion: 3, nodeId: 'n-third', step: { kind: 'interview', round: '三面' },
    });
    expect(thirdStep.status).toBe('confirmed');

    // A 仍按版本 3 请求撤回二面：先在领域检查前被版本条件拒绝
    const stale = await call<Record<string, unknown>>(page, 'command', {
      kind: 'remove-latest-step',
      jobId: 'job-a22',
      expectedVersion: 3,
      expectedLastNodeId: 'n-second',
    });
    expect(stale.status).toBe('rejected');
    expect((stale.failure as Record<string, unknown>).reason).toBe('versionConflict');

    // 两个标签页重读：二面和三面均在
    const fromA = await call<{ value: Record<string, unknown>[] }>(page, 'list');
    const fromB = await call<{ value: Record<string, unknown>[] }>(pageB, 'list');
    for (const listing of [fromA, fromB]) {
      const job = listing.value[0]!;
      expect(job.version).toBe(4);
      const flow = job.flow as Array<Record<string, unknown>>;
      expect(flow.map((node) => node.id)).toEqual(['n-applied', 'n-second', 'n-third']);
    }

    // 若用户重新选择：只能先撤回三面
    const retry = await call<Record<string, unknown>>(page, 'command', {
      kind: 'remove-latest-step',
      jobId: 'job-a22',
      expectedVersion: 4,
      expectedLastNodeId: 'n-third',
    });
    expect(retry.status).toBe('confirmed');
    await pageB.close();
  });

  test('导入写事务中止后，原岗位和偏好全部保留', async ({ page }) => {
    const db = 'zako-a22-abort';
    await openFixture(page, { db, faultImport: true });

    // 原有数据：偏好（空看板）。导入将替换偏好并插入岗位，
    // 写入中途注入故障 → 事务中止 → 偏好回滚、岗位不写入。
    await call<Record<string, unknown>>(page, 'savePrefs', {
      shared: { modules: [{ id: 'schedule', visible: true }, { id: 'jobs', visible: true }] },
    });

    // 合法备份（含岗位）导入：偏好先写入、岗位插入后注入故障 → 整体 failed
    const result = await call<Record<string, unknown>>(page, 'import', {
      format: 'zakoujob-backup',
      version: 1,
      applications: [
        {
          id: 'job-incoming',
          profile: { company: '备份公司', position: '备份职位' },
          starred: false,
          flow: [],
          outcome: null,
          version: 1,
        },
      ],
      preferences: {
        shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
        mobile: { overridden: false },
        desktop: { overridden: false },
      },
    });
    expect(result.status).toBe('failed');

    // 重新打开（新页面会话）核对原记录：目标保持导入前的状态
    await page.reload();
    await page.waitForFunction(() => Boolean((window as never as { __board?: unknown }).__board));
    const listing = await call<{ ok: boolean; value: Record<string, unknown>[] }>(page, 'list');
    expect(listing.value).toHaveLength(0);
    const prefs = await call<{ value: Record<string, unknown> }>(page, 'prefs');
    expect((prefs.value!.shared as Record<string, unknown>).modules).toEqual([
      { id: 'schedule', visible: true },
      { id: 'jobs', visible: true },
    ]);
  });
});

test.describe('IndexedDB 适配器（2.3）', () => {
  test('空板含偏好可导出；仅有偏好的目标可恢复备份偏好', async ({ page }) => {
    const db = 'zako-a23-export';
    await openFixture(page, { db });

    // 只有偏好、没有岗位的看板导出
    await call<Record<string, unknown>>(page, 'savePrefs', {
      desktop: {
        overridden: true,
        layout: { modules: [{ id: 'schedule', visible: true }, { id: 'jobs', visible: true }] },
      },
    });
    const snapshot = await call<{ ok: boolean; backup?: Record<string, unknown> }>(page, 'export');
    expect(snapshot.ok).toBe(true);
    expect(snapshot.backup!.applications).toEqual([]);
    expect((snapshot.backup!.preferences as Record<string, unknown>).desktop).toEqual({
      overridden: true,
      layout: { modules: [{ id: 'schedule', visible: true }, { id: 'jobs', visible: true }] },
    });

    // 另一个空目标（只有手机覆盖）恢复该备份：布局一起恢复
    const target = await openFixture(page, { db: `${db}-target` });
    expect(target).toBeTruthy();
    await call<Record<string, unknown>>(page, 'savePrefs', {
      mobile: {
        overridden: true,
        layout: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
      },
    });
    const imported = await call<Record<string, unknown>>(page, 'import', snapshot.backup);
    expect(imported.status).toBe('confirmed');
    // 备份替换整组偏好：桌面覆盖来自备份，手机覆盖回到备份中的缺省「沿用共用」。
    const prefs = await call<{ value: Record<string, unknown> }>(page, 'prefs');
    expect((prefs.value!.desktop as Record<string, unknown>).overridden).toBe(true);
    expect((prefs.value!.mobile as Record<string, unknown>).overridden).toBe(false);
  });

  test('已有岗位（含已结束）时导入被拒绝，原数据保留', async ({ page }) => {
    const db = 'zako-a23-nonempty';
    await openFixture(page, { db });

    // 一份已拒岗位
    await call<Record<string, unknown>>(page, 'command', {
      kind: 'create-job',
      jobId: 'job-declined',
      input: { company: '青禾科技', position: '前端工程师' },
    });
    await call<Record<string, unknown>>(page, 'command', {
      kind: 'record-outcome',
      jobId: 'job-declined',
      expectedVersion: 1,
      status: 'declinedByUser',
    });
    await call<Record<string, unknown>>(page, 'savePrefs', {
      shared: { modules: [{ id: 'schedule', visible: true }, { id: 'jobs', visible: true }] },
    });

    const refused = await call<Record<string, unknown>>(page, 'import', {
      format: 'zakoujob-backup',
      version: 1,
      applications: [],
      preferences: {
        shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
        mobile: { overridden: false },
        desktop: { overridden: false },
      },
    });
    expect(refused.status).toBe('rejected');
    expect(refused.reason).toBe('targetNotEmpty');

    // 原申请和偏好均可读回
    const listing = await call<{ value: Record<string, unknown>[] }>(page, 'list');
    expect(listing.value).toHaveLength(1);
    expect(listing.value[0]!.outcome).toEqual({ status: 'declinedByUser' });
    const prefs = await call<{ value: Record<string, unknown> }>(page, 'prefs');
    expect((prefs.value!.shared as Record<string, unknown>).modules).toEqual([
      { id: 'schedule', visible: true },
      { id: 'jobs', visible: true },
    ]);
  });

  test('校验期另一客户端并发新建则导入被拒；无效备份逐条报告且目标不写', async ({ page, context }) => {
    const db = 'zako-a23-race';
    await openFixture(page, { db });

    const pageB = await context.newPage();
    await openFixture(pageB, { db });

    // A 校验（读到的目标为空）；B 在 A 提交前成功新建一份岗位
    const created = await call<Record<string, unknown>>(pageB, 'command', {
      kind: 'create-job',
      jobId: 'job-racer',
      input: { postingUrl: 'https://jobs.example.com/qr-race' },
    });
    expect(created.status).toBe('confirmed');

    const imported = await call<Record<string, unknown>>(page, 'import', {
      format: 'zakoujob-backup',
      version: 1,
      applications: [],
      preferences: {
        shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
        mobile: { overridden: false },
        desktop: { overridden: false },
      },
    });
    expect(imported.status).toBe('rejected');
    expect(imported.reason).toBe('targetNotEmpty');

    // 备份内容未写入；并发新建的岗位保留
    const listing = await call<{ value: Record<string, unknown>[] }>(page, 'list');
    expect(listing.value).toHaveLength(1);
    expect(listing.value[0]!.id).toBe('job-racer');
    await pageB.close();

    // 有效记录之后出现坏数据：报告定位，目标仍为空（本页用新库）。
    // 第一条坏岗位含重复节点 ID；第二条坏岗位含非法结果状态。
    const validation = await call<Record<string, unknown>>(page, 'import', {
      format: 'zakoujob-backup',
      version: 1,
      applications: [
        {
          id: 'job-good',
          profile: { company: '甲公司', position: 'A' },
          starred: false,
          flow: [],
          outcome: null,
          version: 1,
        },
        {
          id: 'job-bad-flow',
          profile: { company: '乙公司', position: 'B' },
          starred: false,
          flow: [{ kind: 'applied', id: 'dup' }, { kind: 'applied', id: 'dup' }],
          outcome: null,
          version: 1,
        },
        {
          id: 'job-bad-outcome',
          profile: { company: '丙公司', position: 'C' },
          starred: false,
          flow: [],
          outcome: { status: 'hired' },
          version: 1,
        },
      ],
      preferences: {
        shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
        mobile: { overridden: false },
        desktop: { overridden: false },
      },
    });
    expect(validation.status).toBe('rejected');
    expect(validation.reason).toBe('invalidBackup');
    const issues = validation.issues as Array<{ path: string; message: string }>;
    expect(issues.some((issue) => issue.path === 'applications[1].flow[1].id')).toBe(true);
    expect(issues.some((issue) => issue.path === 'applications[2].outcome.status')).toBe(true);
  });
});
