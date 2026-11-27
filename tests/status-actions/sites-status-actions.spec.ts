/**
 * present-job-board 5.3 · 正式工作台状态推进（Sites 腿：真实 Sites 构建 + Miniflare 隔离 D1 + 本地反代）。
 *
 * 覆盖：同一套状态表交互在私有站点存储上确认保存（「站点已确认」）、
 * 保存失败及重读（D1 实际提交后丢响应 → 「未确认是否保存，请刷新查看」、
 * 不自动重试、刷新/重读可见恰好一次提交）、真实 Worker 过时撤回冲突拒绝。
 *
 * 运行：npx tsx --test tests/status-actions/sites-status-actions.spec.ts
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  desktopCard,
  pressAndSettle,
  runStatusJourney,
  shot,
  stepIds,
  stepTitle,
  stepTitles,
  withdrawLastStep,
} from './flows';
import { startSitesBoard, type SitesBoard } from './harness-sites';

let board: SitesBoard;

before(async () => {
  board = await startSitesBoard();
});

after(async () => {
  await board?.close();
});

beforeEach(async () => {
  await board?.resetD1();
});

describe('5.3 正式工作台状态推进（Sites 腿）', () => {
  it('状态表逐行推进全程经 D1 确认保存，节点 ID 重读稳定', async () => {
    const { context, page, errors } = await board.newPage();
    try {
      // 顶栏「私有站点」标签已随轻卡片移除；适配器类型以 D1 实际落盘与命令计数佐证
      assert.equal(await page.locator('.zj-app-adapter-tag').count(), 0);
      assert.equal(await board.commandRequestCount(), 0);
      await runStatusJourney(page, '溯源数据');
      assert.equal(await board.countJobsInD1(), 1, '全程只应有这一份岗位');
      assert.equal(errors.length, 0);
    } catch (err) {
      await shot(page, 'sites-journey-failure');
      throw err;
    } finally {
      await context.close();
    }
  });

  it('失败状态：提交后丢响应提示未确认且不自动重试，刷新读回恰好一次提交；过时撤回被真实 Worker 拒绝', async () => {
    const { context, page, errors } = await board.newPage();
    try {
      // 1. 建档提交进 D1 后丢响应：未确认提示、弹窗保留、不盲目乐观
      board.dropNextCommandResponse();
      await page.getByRole('button', { name: '添加岗位' }).first().click();
      const jobDialog = page.locator('dialog[open]');
      await jobDialog.getByLabel('公司').fill('溯源数据');
      await jobDialog.getByLabel('职位').fill('Go 开发');
      await jobDialog.getByRole('button', { name: '添加' }).click();

      const dialogAlert = jobDialog.getByRole('alert');
      await dialogAlert.waitFor({ timeout: 8_000 });
      assert.equal(await dialogAlert.textContent(), '未确认是否保存，请刷新查看');
      const unknownBanner = page.locator('.zj-feedback-banner[data-tone="unknown"]');
      await unknownBanner.waitFor({ timeout: 8_000 });
      assert.equal(await page.locator('.zj-desktop-card').count(), 0);

      await page.waitForTimeout(400);
      assert.equal(board.commandRequestCount(), 1, '丢响应后不得自动重发 create-job');
      assert.equal(await board.countJobsInD1(), 1, 'D1 必须已在丢包前实际提交');

      await jobDialog.getByRole('button', { name: '取消' }).click();
      await unknownBanner.getByRole('button', { name: '刷新查看' }).click();
      const card = desktopCard(page, '溯源数据');
      await card.waitFor({ timeout: 8_000 });
      assert.equal(board.commandRequestCount(), 1);

      // 2. 状态按钮提交遇丢响应：同样未确认，整页刷新读回恰好一次
      board.dropNextCommandResponse();
      await pressAndSettle(page, card.getByRole('button', { name: /^已投递$/ }), {
        tone: 'unknown',
      });
      await page.waitForTimeout(300);
      assert.equal(board.commandRequestCount(), 2, '状态按钮丢响应后不得自动重发');
      await page.reload({ waitUntil: 'networkidle' });
      await stepTitle(desktopCard(page, '溯源数据'), '已投递').waitFor({ timeout: 8_000 });
      assert.equal(await board.countJobsInD1(), 1);

      // 3. 正常状态按钮操作恢复「站点已确认」
      const cardAfter = desktopCard(page, '溯源数据');
      const savedBanner = await pressAndSettle(
        page,
        cardAfter.getByRole('button', { name: /^收到面试$/ }),
      );
      assert.ok((await savedBanner.textContent())?.includes('站点已确认'));
      assert.equal(board.commandRequestCount(), 3);
      assert.equal(await board.countJobsInD1(), 1);

      // 本轮待面试 → 一面已面，之后才有「收到下轮面试」入口
      await pressAndSettle(page, cardAfter.getByRole('button', { name: /^标记一面已面$/ }));
      assert.equal(board.commandRequestCount(), 4);

      // 4. 过时撤回：另一端已新增二面，本端用旧版本撤回 → 真实 Worker 拒绝
      const tabB = await context.newPage();
      const errorsB: string[] = [];
      tabB.on('pageerror', (e) => errorsB.push(e.message));
      await tabB.goto(board.baseUrl, { waitUntil: 'networkidle' });
      const cardB = desktopCard(tabB, '溯源数据');
      await stepTitle(cardB, '一面').waitFor({ timeout: 8_000 });

      await pressAndSettle(page, cardAfter.getByRole('button', { name: /^收到下轮面试$/ }));
      await stepTitle(cardAfter, '二面').waitFor({ timeout: 8_000 });

      const requestsBeforeConflict = board.commandRequestCount();
      await withdrawLastStep(tabB, cardB, { tone: 'conflict' });
      const conflictBanner = tabB.locator('.zj-feedback-banner[data-tone="conflict"]');
      await conflictBanner.waitFor({ timeout: 8_000 });
      // 明确拒绝后对话框按设计保持打开并显示失败，先关闭再操作横幅
      await tabB
        .locator('dialog[open].zj-dialog')
        .getByRole('button', { name: '取消' })
        .click();
      assert.ok(
        (await conflictBanner.textContent())?.includes('进展已变更'),
        '真实 Worker 应明确拒绝过时撤回',
      );
      assert.equal(
        board.commandRequestCount(),
        requestsBeforeConflict + 1,
        '被真实 Worker 拒绝后不得自动重试',
      );
      await conflictBanner.getByRole('button', { name: '刷新查看' }).click();
      await stepTitle(cardB, '二面').waitFor({ timeout: 8_000 });
      assert.deepEqual(
        await stepTitles(cardB),
        ['已投递', '一面 · 已面', '二面 · 待面试'],
        '冲突后重读应可见对端新增的二面，且撤回未自动执行（一面仍在）',
      );

      // 末节点 ID 在冲突重读后保持稳定（已投递、一面、二面共 3 个节点）
      const idsAfterConflict = await stepIds(cardB);
      assert.equal(idsAfterConflict.length, 3);
      assert.equal(errors.length, 0);
      assert.equal(errorsB.length, 0);
    } catch (err) {
      await shot(page, 'sites-failure-failure');
      throw err;
    } finally {
      await context.close();
    }
  });
});
