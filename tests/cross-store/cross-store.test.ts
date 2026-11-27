/**
 * persist-job-data 4.1 / 4.2 + present-job-board 4.3 跨适配器集成验收。
 *
 * 腿 1：真实 Edge 浏览器 + 真实 IndexedDB，经 Vite 程序 API 起专属随机端口测试台，
 *   公开 JobBoardStore 契约场景全部在页面内执行。
 * 腿 2：隔离 Miniflare D1 Worker（worker/test-entry.ts 测试专用入口）+
 *   Sites HTTP 客户端（src/sites/client.ts），同一组场景在 Node 内执行。
 * 往返：IndexedDB 导出 → 空 D1 实例 → 另一空 IndexedDB，核对稳定 ID 与完整节点。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { startDemoServer, type DemoServer } from '../browser/vite-demo-server.ts';
import { verifyBackupShape, verifyEndedNonEmptyTarget, type RestoreVerification } from './fictional-data.ts';
import type { BackupFile } from '../../src/data/index.ts';
import { startD1Worker, type D1WorkerHandle } from './d1-harness.ts';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
/** 含时间戳的运行证据：gitignored 的根 test-results/cross-store，不入库。 */
const EVIDENCE_DIR = path.join(ROOT_DIR, 'test-results', 'cross-store');
const RUN_ID = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DATA_DB = `zakoujob-cross-${RUN_ID}-data`;
const SCENARIO_DB = `zakoujob-cross-${RUN_ID}-scenarios`;
const RESTORED_DB = `zakoujob-cross-${RUN_ID}-restored`;

let server: DemoServer;
let browser: Browser;
let harnessUrl = '';
/** 由「新会话续用」用例写入的导出备份，供往返用例复用（用例顺序执行）。 */
let idbBackup: unknown;

/** Sites/D1 腿的前置检测：全部就绪才可运行。 */
function detectD1Harness(): { ok: boolean; reason: string } {
  const missing: string[] = [];
  if (!existsSync(path.join(ROOT_DIR, 'src', 'sites', 'client.ts'))) {
    missing.push('src/sites/client.ts（Sites HTTP 客户端）');
  }
  if (!existsSync(path.join(ROOT_DIR, 'worker', 'test-entry.ts'))) {
    missing.push('worker/test-entry.ts（worker 测试专用入口）');
  }
  if (missing.length > 0) {
    return { ok: false, reason: `feat/sites-d1 尚未合入：缺少 ${missing.join('、')}` };
  }
  return { ok: true, reason: '' };
}

interface HarnessCall {
  ok: true;
  value: unknown;
}
interface HarnessFailure {
  ok: false;
  error: string;
}

async function callHarness(page: Page, method: string, ...args: unknown[]): Promise<unknown> {
  const result = (await page.evaluate(async ({ method, args }) => {
    const api = (window as unknown as Record<string, Record<string, CallableFunction>>).__zjCrossStore;
    if (!api) return { ok: false, error: '测试台未就绪' };
    try {
      return { ok: true, value: await api[method](...args) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, { method, args })) as HarnessCall | HarnessFailure;
  assert.equal(result.ok, true, `测试台调用 ${method} 失败：${result.ok ? '' : result.error}`);
  return (result as HarnessCall).value;
}

async function openHarnessPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(harnessUrl, { waitUntil: 'networkidle' });
  await page.getByText('跨存储测试台就绪').waitFor();
  (page as Page & { __pageErrors?: string[] }).__pageErrors = errors;
  return page;
}

before(async () => {
  assert.equal(detectD1Harness().ok, true, 'D1/Sites 前置应已合入');
  server = await startDemoServer();
  harnessUrl = new URL('tests/cross-store/indexeddb-harness.html', server.baseUrl).toString();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

describe('persist-job-data 4.1/4.2 · 跨适配器契约场景（真实浏览器 IndexedDB）', () => {
  it('同一组契约场景全部通过（稳定 ID、星标、日期精度、已挂/已拒、过时撤回、跨端重读、分端偏好、失败反馈）', async () => {
    const context = await browser.newContext();
    const page = await openHarnessPage(context);
    try {
      const suite = (await callHarness(page, 'runScenarios', SCENARIO_DB)) as {
        results: Array<{ name: string; ok: boolean; error?: string; ms: number; evidence?: unknown }>;
        allOk: boolean;
      };
      const failed = suite.results.filter((r) => !r.ok);
      assert.deepEqual(
        failed.map((r) => `${r.name}: ${r.error}`),
        [],
        `存在失败场景：${suite.results.map((r) => `${r.name}=${r.ok ? 'ok' : 'FAIL'}`).join(', ')}`,
      );
      assert.equal(suite.allOk, true);
      assert.equal(suite.results.length, 8);
      await fs.mkdir(EVIDENCE_DIR, { recursive: true });
      await fs.writeFile(
        path.join(EVIDENCE_DIR, `scenarios-idb-${RUN_ID}.json`),
        JSON.stringify({ runId: RUN_ID, database: SCENARIO_DB, suite }, null, 2),
      );
      assert.equal(
        (page as Page & { __pageErrors?: string[] }).__pageErrors?.length ?? 0,
        0,
        '页面不得出现未捕获异常',
      );
    } finally {
      await context.close();
    }
  });

  it('4.1 新会话续用：同一浏览器配置新开标签页读回上一会话数据并继续提交', async () => {
    const preparer = await browser.newContext();
    const preparePage = await openHarnessPage(preparer);
    try {
      // 写入虚构数据集（同时生成供往返使用的数据）与新会话标记岗位
      const prepared = (await callHarness(preparePage, 'prepareAndExport', DATA_DB)) as {
        backup: unknown;
        sourceJobs: unknown[];
        backupEvidence: Record<string, unknown>;
      };
      idbBackup = prepared.backup;
      assert.equal((prepared.sourceJobs as unknown[]).length, 3, '虚构数据集应有 3 份岗位');
      assert.equal(
        (prepared.backupEvidence as { jobIds?: string[] }).jobIds?.length,
        3,
        '导出备份应含 3 个唯一岗位 ID',
      );

      // 新会话 = 同一浏览器配置下新开的标签页（Playwright 新 context 是隔离存储，
      // 无法代表「同一站点来源的下一个会话」）
      const freshPage = await openHarnessPage(preparer);
      try {
        const session = (await callHarness(freshPage, 'verifySession', DATA_DB)) as {
          versionAfter: number;
        };
        // 标记岗位建档 v1 + 加星 v2，新会话登记环节后 v3
        assert.equal(session.versionAfter, 3, '新会话登记环节后版本应为 3');
      } finally {
        await freshPage.close();
      }

      // 保存备份证据供往返用例与人工核对
      await fs.mkdir(EVIDENCE_DIR, { recursive: true });
      await fs.writeFile(
        path.join(EVIDENCE_DIR, `roundtrip-backup-${RUN_ID}.json`),
        JSON.stringify(prepared.backup, null, 2),
      );
      await fs.writeFile(
        path.join(EVIDENCE_DIR, `backup-evidence-${RUN_ID}.json`),
        JSON.stringify(prepared.backupEvidence, null, 2),
      );
    } finally {
      await preparer.close();
    }
  });

  it('4.2 往返（IndexedDB → 另一空 IndexedDB）：恢复后清结果、撤末步、非空拒绝且原数据不变', async () => {
    assert.ok(idbBackup, '往返用例依赖「新会话续用」用例导出的备份');
    const backupJson = JSON.stringify(idbBackup);

    // 全新上下文 + 全新数据库 = 另一块空看板
    const targetContext = await browser.newContext();
    const targetPage = await openHarnessPage(targetContext);
    try {
      const verification = (await callHarness(
        targetPage,
        'importAndVerify',
        RESTORED_DB,
        backupJson,
      )) as RestoreVerification;
      assert.equal(verification.jobCount, 3, '恢复后应有 3 份岗位');
      assert.equal(verification.clearedOutcome, true, '恢复后应能清除已拒结果');
      assert.equal(verification.withdrewLastStep, true, '恢复后应能撤回末节点');
      assert.deepEqual(
        (verification.flowAfterWithdraw as Array<{ id: string }>).map((n) => n.id),
        ['qa-fic-node-sg-oc'],
        '撤回末节点后拾光只剩 OC',
      );
      assert.equal(verification.nonEmptyImportRejected, true, '非空目标导入必须被拒绝');
      assert.equal(verification.nonEmptyImportUnchanged, true, '拒绝导入不得改变原数据');

      await fs.mkdir(EVIDENCE_DIR, { recursive: true });
      await fs.writeFile(
        path.join(EVIDENCE_DIR, `restore-verification-idb-${RUN_ID}.json`),
        JSON.stringify(verification, null, 2),
      );
    } finally {
      await targetContext.close();
    }
  });
});

describe('persist-job-data 4.1/4.2 · 隔离 D1 Worker + Sites HTTP 客户端', () => {
  it('同一组契约场景在 D1/Sites HTTP 客户端上全部通过', async () => {
    const worker = await startD1Worker();
    try {
      const { runStoreScenarios } = await import('./scenarios.ts');
      const suite = await runStoreScenarios({
        openStore: () => worker.createOwnerStore(),
      });
      const failed = suite.results.filter((r) => !r.ok);
      assert.deepEqual(
        failed.map((r) => `${r.name}: ${r.error}`),
        [],
        `存在失败场景：${suite.results.map((r) => `${r.name}=${r.ok ? 'ok' : 'FAIL'}`).join(', ')}`,
      );
      await fs.mkdir(EVIDENCE_DIR, { recursive: true });
      await fs.writeFile(
        path.join(EVIDENCE_DIR, `scenarios-d1-${RUN_ID}.json`),
        JSON.stringify({ runId: RUN_ID, suite }, null, 2),
      );
    } finally {
      await worker.close();
    }
  });

  it('present-job-board 4.3（Sites）：提交后失联提示未确认、重读可见已提交、重送不重复、其他身份被拒', async () => {
    const worker = await startD1Worker();
    try {
      // 故障通道：命令已提交但响应被掐断
      const flaky = await worker.createOwnerStore({ faultDropResponse: true });
      const outcome = await flaky.submitJobCommand({
        kind: 'create-job',
        jobId: 'qa-d1-unconfirmed',
        input: { company: '失联测试公司', position: '可靠性工程师' },
      });
      assert.equal(outcome.status, 'unconfirmed', '响应丢失必须按未确认处理');

      // 重送同一命令（正常通道）：命中重复拒绝，不得追加
      const normal = await worker.createOwnerStore();
      const resend = await normal.submitJobCommand({
        kind: 'create-job',
        jobId: 'qa-d1-unconfirmed',
        input: { company: '失联测试公司', position: '可靠性工程师' },
      });
      assert.equal(resend.status, 'rejected', '同 ID 重送应被拒绝');

      // 主动重读：命令实际已提交，恰好一条
      const jobs = await normal.listJobs();
      assert.ok(jobs.ok, '重读岗位列表');
      const matches = jobs.ok ? jobs.value.filter((j) => j.id === 'qa-d1-unconfirmed') : [];
      assert.equal(matches.length, 1, '失联的提交恰好落库一次');
      assert.equal(matches[0]?.profile.company, '失联测试公司', '落库内容正确');

      // 站主校验先于写入，403 是明确拒绝。
      const foreign = await worker.createForeignStore();
      const foreignRead = await foreign.listJobs();
      assert.equal(foreignRead.ok, false, '非所有者读取必须失败');
      const foreignWrite = await foreign.submitJobCommand({
        kind: 'set-star',
        jobId: 'qa-d1-unconfirmed',
        expectedVersion: 1,
        starred: true,
      });
      assert.equal(foreignWrite.status, 'rejected', '其他身份的写入应被明确拒绝');
    } finally {
      await worker.close();
    }
  });

  it('4.2 三方往返：IndexedDB 导出 → 空 D1 实例 → 另一空 IndexedDB', async () => {
    assert.ok(idbBackup, '往返用例依赖「新会话续用」用例导出的备份');
    const backup = idbBackup as BackupFile;

    const worker = await startD1Worker();
    try {
      // 中间腿：空 D1 实例恢复备份，逐条核对后导出
      const d1Store = await worker.createOwnerStore();
      const before = await d1Store.listJobs();
      assert.ok(before.ok && before.value.length === 0, 'D1 实例初始为空');

      const imported = await d1Store.importBackup(JSON.parse(JSON.stringify(backup)));
      assert.equal(imported.status, 'confirmed', 'D1 空实例导入应确认');

      const d1Jobs = await d1Store.listJobs();
      assert.ok(d1Jobs.ok, 'D1 读取恢复结果');
      assert.deepEqual(
        d1Jobs.ok ? d1Jobs.value : null,
        backup.applications,
        'D1 恢复后的岗位与备份逐条一致（稳定 ID、节点、期限、结果）',
      );
      const d1Prefs = await d1Store.getPreferences();
      assert.ok(d1Prefs.ok, 'D1 读取恢复后的偏好');
      assert.deepEqual(
        d1Prefs.ok ? d1Prefs.value : null,
        backup.preferences,
        'D1 恢复后的偏好与备份一致（分端布局）',
      );

      // 非空 D1 实例拒绝重复导入
      const reimport = await d1Store.importBackup(JSON.parse(JSON.stringify(backup)));
      assert.equal(reimport.status, 'rejected', '非空 D1 实例重复导入应拒绝');
      assert.ok(
        reimport.status === 'rejected' && 'reason' in reimport && reimport.reason === 'targetNotEmpty',
        '非空拒绝原因应为 targetNotEmpty',
      );

      // 从 D1 导出一致快照：稳定 ID 与完整节点必须穿越 Sites 存储
      const d1Export = await d1Store.exportSnapshot();
      assert.ok(d1Export.ok, 'D1 导出快照');
      const d1Backup = d1Export.ok ? d1Export.backup : null;
      assert.ok(d1Backup !== null, 'D1 导出备份结构');
      const evidence = verifyBackupShape(d1Backup, d1Jobs.ok ? d1Jobs.value : undefined);

      // 末腿：另一空 IndexedDB 恢复 D1 导出的备份并完成收尾核验
      const targetContext = await browser.newContext();
      const targetPage = await openHarnessPage(targetContext);
      try {
        const verification = (await callHarness(
          targetPage,
          'importAndVerify',
          `${RESTORED_DB}-via-d1`,
          JSON.stringify(d1Backup),
        )) as RestoreVerification;
        assert.equal(verification.jobCount, 3, '末腿恢复后应有 3 份岗位');
        assert.equal(verification.clearedOutcome, true, '末腿恢复后应能清除已拒结果');
        assert.equal(verification.withdrewLastStep, true, '末腿恢复后应能撤回末节点');
        assert.equal(verification.nonEmptyImportRejected, true, '末腿非空导入必须被拒绝');

        await fs.mkdir(EVIDENCE_DIR, { recursive: true });
        await fs.writeFile(
          path.join(EVIDENCE_DIR, `roundtrip-via-d1-${RUN_ID}.json`),
          JSON.stringify({
            runId: RUN_ID,
            d1BackupEvidence: evidence,
            restoreVerification: verification,
          }, null, 2),
        );
      } finally {
        await targetContext.close();
      }
    } finally {
      await worker.close();
    }
  });

  it('4.2 已结束非空目标：只含已挂岗位的 D1 实例拒绝导入且原数据不变', async () => {
    assert.ok(idbBackup, '依赖「新会话续用」用例导出的备份');
    const backup = idbBackup as BackupFile;
    const worker = await startD1Worker();
    try {
      const store = await worker.createOwnerStore();
      await verifyEndedNonEmptyTarget(store, backup);
    } finally {
      await worker.close();
    }
  });

  it('4.2 已结束非空目标（IndexedDB 腿）：只含已挂岗位的看板拒绝导入且原数据不变', async () => {
    assert.ok(idbBackup, '依赖「新会话续用」用例导出的备份');
    const targetContext = await browser.newContext();
    const targetPage = await openHarnessPage(targetContext);
    try {
      await callHarness(targetPage, 'endedNonEmptyTarget', `${RESTORED_DB}-ended`, JSON.stringify(idbBackup));
    } finally {
      await targetContext.close();
    }
  });
});
