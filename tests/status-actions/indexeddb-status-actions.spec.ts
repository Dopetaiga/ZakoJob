/**
 * present-job-board 5.3 · 正式工作台状态推进（IndexedDB 腿，真实 Edge + 真实 IndexedDB）。
 *
 * 覆盖：设计表各状态按钮、跳步（其他进展直接登记二面）、标题旁补资料、
 * 回看旧节点后推进最新节点、稳定节点 ID、更正与撤回、结束申请与恢复、
 * 保存失败（过时撤回冲突、离线本地提交）与重读；桌面 1280 与窄屏 320/390/430。
 *
 * 运行：npx tsx --test tests/status-actions/indexeddb-status-actions.spec.ts
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  desktopCard,
  editProfileFromTitle,
  expectStatusButtons,
  mobileCard,
  openOtherProgress,
  pressAndSettle,
  registerRoundViaOtherProgress,
  runStatusJourney,
  scrollTimelineToEarliest,
  shot,
  stepIds,
  stepTitle,
  stepTitles,
  withdrawLastStep,
} from './flows';
import { startIdbBoard, type IdbBoard } from './harness-idb';

let board: IdbBoard;

before(async () => {
  board = await startIdbBoard();
});

after(async () => {
  await board?.close();
});

describe('5.3 正式工作台状态推进（IndexedDB 腿）', () => {
  it('状态表逐行推进全程：收藏→已投递→笔试→面试→OC→Offer→结束→更正→清除恢复，含节点更正、回看后推进、撤回与重读节点稳定', async () => {
    const { context, page, errors } = await board.newPage();
    try {
      await runStatusJourney(page, '青禾科技');
      assert.equal(errors.length, 0);
    } catch (err) {
      await shot(page, 'idb-journey-failure');
      throw err;
    } finally {
      await context.close();
    }
  });

  it('跳步与资料补全：仅链接卡经「其他进展」直接登记二面，标题旁补资料不新增进展，进展面板只列进展动作', async () => {
    const { context, page, errors } = await board.newPage();
    try {
      await page.getByRole('button', { name: '添加岗位' }).first().click();
      const jobDialog = page.locator('dialog[open]');
      await jobDialog.getByLabel('招聘链接（http / https）').fill('https://jobs.example.com/p/42');
      await jobDialog.getByRole('button', { name: '添加' }).click();

      // 仅链接卡按域名+路径识别（display 名为 host+path），用包含匹配定位
      const card = page.locator('.zj-desktop-card[aria-label*="jobs.example.com"]');
      await card.waitFor();
      await card.getByRole('button', { name: /星标/ }).click();
      await card.getByRole('button', { name: /取消星标/ }).waitFor({ timeout: 8_000 });

      // 设计表：收藏，尚无节点 → 已投递；次要入口「其他进展」可用（收藏后直接登记二面）
      await expectStatusButtons(card, ['已投递'], '仅链接收藏卡');
      const panel = await openOtherProgress(page);
      assert.equal(
        await panel.getByLabel('公司').count(),
        0,
        '进展选择面板只列进展动作，不含资料字段',
      );
      await panel.getByRole('button', { name: /取消|关闭/ }).first().click();

      // 跳步：直接登记二面，二面成为唯一节点
      await registerRoundViaOtherProgress(page, '二面');
      assert.deepEqual(
        await stepTitles(card),
        ['二面 · 待面试'],
        '跳步后二面应是唯一节点',
      );
      assert.equal((await stepIds(card)).length, 1);

      // 标题旁补资料：资料编辑不新增进展，原链接仍可打开
      await editProfileFromTitle(page, card, async (profilePanel) => {
        await profilePanel.getByLabel('公司').fill('青禾科技');
        await profilePanel.getByLabel('职位').fill('后端开发实习生');
      });
      // 补资料后公司名生效，卡的识别名由链接变为公司名，需重新定位
      const renamedCard = desktopCard(page, '青禾科技');
      await renamedCard.waitFor({ timeout: 8_000 });
      assert.equal(await stepTitles(renamedCard).then((t) => t.length), 1, '补资料不得新增进展');
      assert.equal(
        await renamedCard.locator('a[href="https://jobs.example.com/p/42"]').count(),
        1,
        '补资料后原链接仍须可打开',
      );
      assert.equal(errors.length, 0);
    } catch (err) {
      await shot(page, 'idb-skip-failure');
      throw err;
    } finally {
      await context.close();
    }
  });

  for (const width of [320, 390, 430] as const) {
    it(`窄屏 ${width}px：状态按钮推进、底部面板、回看旧节点后推进仍指向最新二面`, async () => {
      const { context, page, errors } = await board.newPage({ width, height: 844 });
      try {
        // 快速搭出 一面已面 + 二面待面试
        await page.getByRole('button', { name: '添加岗位' }).first().click();
        const jobDialog = page.locator('dialog[open]');
        await jobDialog.getByLabel('公司').fill('回看科技');
        await jobDialog.getByLabel('职位').fill('测试工程师');
        await jobDialog.getByRole('button', { name: '添加' }).click();

        const card = mobileCard(page, '回看科技');
        await card.waitFor();
        await pressAndSettle(page, card.getByRole('button', { name: /^已投递$/ }));
        await pressAndSettle(page, card.getByRole('button', { name: /^收到面试$/ }));
        await pressAndSettle(page, card.getByRole('button', { name: /^标记一面已面$/ }));
        await pressAndSettle(page, card.getByRole('button', { name: /^收到下轮面试$/ }));
        await expectStatusButtons(card, ['标记二面已面'], `窄屏${width} 二面待面试`);

        // 手机需要选择或填写时使用贴底面板（原生 .zj-dialog 移动端样式）：
        // 面板真实底边贴视口底边、完整落在视口内，且控件可操作
        const sheet = await openOtherProgress(page);
        const dlgBox = await page.locator('dialog[open].zj-dialog').first().boundingBox();
        const vp = page.viewportSize();
        assert.ok(dlgBox, `窄屏${width} 其他进展应打开面板`);
        assert.ok(
          Math.abs(dlgBox.y + dlgBox.height - vp!.height) <= 2,
          `窄屏${width} 面板真实底边应贴视口底边（bottom=${dlgBox.y + dlgBox.height}, viewport=${vp!.height}）`,
        );
        assert.ok(dlgBox.y >= -1 && dlgBox.x >= -1, `窄屏${width} 面板不得越出视口顶部/左侧`);
        assert.ok(
          dlgBox.x + dlgBox.width <= vp!.width + 1,
          `窄屏${width} 面板不得越出视口右侧`,
        );
        await sheet.getByLabel('环节类型').selectOption('oc');
        await sheet.getByLabel('环节类型').selectOption('interview');
        await sheet.getByRole('button', { name: '取消' }).click();
        await page.locator('dialog[open].zj-dialog').first().waitFor({ state: 'detached', timeout: 8_000 });

        // 回看旧节点（滑到最早的一面）后，点「二面已面」仍指向最新二面
        // 内容溢出时滑到最早（回看旧节点）；列盒恰好放下时无需滑动
        const scrollable =
          (await card
            .locator('.zj-timeline-wrap')
            .first()
            .evaluate((el) => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth));
        if (scrollable) {
          const scrolled = await scrollTimelineToEarliest(card);
          assert.notEqual(scrolled, 0, `窄屏${width} 可滚动时间线应能滑到最早`);
        }
        await pressAndSettle(page, card.getByRole('button', { name: /^标记二面已面$/ }));
        assert.deepEqual(
          await stepTitles(card),
          ['已投递', '一面 · 已面', '二面 · 已面'],
          `窄屏${width} 回看后推进必须仍作用于最新二面`,
        );

        // 撤回只删末节点二面，一面保留
        await withdrawLastStep(page, card);
        assert.deepEqual(
          await stepTitles(card),
          ['已投递', '一面 · 已面'],
          `窄屏${width} 撤回只删除末节点`,
        );

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        assert.equal(overflow, false, `窄屏${width} 操作区不得造成横向溢出`);
        assert.equal(errors.length, 0);
      } catch (err) {
        await shot(page, `idb-narrow-${width}-failure`);
        throw err;
      } finally {
        await context.close();
      }
    });
  }

  it('失败状态：过时撤回冲突提示进展已变更且不自动执行，重读可见全部节点；离线本地提交成功并重读', async () => {
    const { context, pageA, errors } = await (async () => {
      const created = await board.newPage();
      return { context: created.context, pageA: created.page, errors: created.errors };
    })();
    try {
      // Tab A 建到二面
      await pageA.getByRole('button', { name: '添加岗位' }).first().click();
      const jobDialog = pageA.locator('dialog[open]');
      await jobDialog.getByLabel('公司').fill('冲突科技');
      await jobDialog.getByLabel('职位').fill('测试工程师');
      await jobDialog.getByRole('button', { name: '添加' }).click();
      const cardA = desktopCard(pageA, '冲突科技');
      await cardA.waitFor();
      await pressAndSettle(pageA, cardA.getByRole('button', { name: /^已投递$/ }));
      await pressAndSettle(pageA, cardA.getByRole('button', { name: /^收到面试$/ }));
      await pressAndSettle(pageA, cardA.getByRole('button', { name: /^标记一面已面$/ }));

      // Tab B 同一上下文读到相同看板（二面）
      const tabB = await context.newPage();
      const errorsB: string[] = [];
      tabB.on('pageerror', (e) => errorsB.push(e.message));
      await tabB.goto(board.baseUrl, { waitUntil: 'networkidle' });
      const cardB = desktopCard(tabB, '冲突科技');
      await stepTitle(cardB, '一面').waitFor({ timeout: 8_000 });

      // Tab A 新增二面（版本推进）
      await pressAndSettle(pageA, cardA.getByRole('button', { name: /^收到下轮面试$/ }));
      await stepTitle(cardA, '二面').waitFor({ timeout: 8_000 });

      // Tab B 用旧版本撤回 → 冲突提示，不自动执行
      await withdrawLastStep(tabB, cardB, { tone: 'conflict' });
      const bannerB = tabB.locator('.zj-feedback-banner[data-tone="conflict"]');
      await bannerB.waitFor({ timeout: 8_000 });
      // 明确拒绝后对话框按设计保持打开并显示失败，先关闭再操作横幅
      await tabB
        .locator('dialog[open].zj-dialog')
        .getByRole('button', { name: '取消' })
        .click();
      assert.ok(
        (await bannerB.textContent())?.includes('进展已变更'),
        '过时撤回应提示进展已变更',
      );
      await bannerB.getByRole('button', { name: '刷新查看' }).click();
      await stepTitle(cardB, '二面').waitFor({ timeout: 8_000 });
      assert.deepEqual(
        await stepTitles(cardB),
        ['已投递', '一面 · 已面', '二面 · 待面试'],
        '冲突后重读应可见对端新增的二面，且撤回未自动执行（一面仍在）',
      );
      await bannerB.getByRole('button', { name: '关闭提示' }).click();

      // 离线本地提交：本地事务完成后提示成功，重读仍在
      await context.setOffline(true);
      await pageA.getByRole('button', { name: '添加岗位' }).first().click();
      const offlineDialog = pageA.locator('dialog[open]');
      await offlineDialog.getByLabel('公司').fill('离线科技');
      await offlineDialog.getByLabel('职位').fill('测试工程师');
      await offlineDialog.getByRole('button', { name: '添加' }).click();
      const offlineCard = desktopCard(pageA, '离线科技');
      await offlineCard.waitFor({ timeout: 8_000 });
      await pressAndSettle(pageA, offlineCard.getByRole('button', { name: /^已投递$/ }));
      assert.ok(
        (await stepTitles(offlineCard)).includes('已投递'),
        '离线本地事务完成后节点应已登记',
      );

      await context.setOffline(false);
      await pageA.reload({ waitUntil: 'networkidle' });
      await stepTitle(desktopCard(pageA, '离线科技'), '已投递').waitFor({ timeout: 8_000 });
      assert.equal(errors.length, 0);
      assert.equal(errorsB.length, 0);
    } catch (err) {
      await shot(pageA, 'idb-failure-failure');
      throw err;
    } finally {
      await context.close();
    }
  });
});
