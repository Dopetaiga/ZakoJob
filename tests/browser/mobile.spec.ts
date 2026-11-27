// 3.1 手机双历史候选验收：320/390/430 下点击展开与左右滑动均可操作，
// 最新起点、回看一面后更新仍指向二面、手工选择后返回最新。
// 每个用例前重新加载 demo 页，保证从基线数据与最新起点出发。
import { test, expect, type Locator, type Page } from '@playwright/test';
import { startDemoServer, type DemoServer } from './vite-demo-server';
import { expectNoHorizontalOverflow } from './page-helpers';

let server: DemoServer;

test.beforeAll(async () => {
  server = await startDemoServer();
});

test.afterAll(async () => {
  await server.close();
});

const MOBILE_WIDTHS = [320, 390, 430];

test('两种历史候选可分别对照卡内菜单和底部面板', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(server.demoUrl);
  for (const menuContainer of ['sheet', 'inline']) {
    await page.getByRole('combobox', { name: '更多菜单', exact: true }).selectOption(menuContainer);
    for (const mode of ['expand', 'swipe'] as const) {
      await qcard(page, mode, 'qinghe').locator('button[data-action="open-more-menu"]').click();
      const menu = page.getByRole('dialog', { name: '青禾科技更多操作' });
      await expect(menu).toHaveClass(new RegExp('zj-menu-' + menuContainer));
      await expect(menu).toHaveAttribute('data-job-id', 'qinghe');
      // 申请结果在「更多」菜单内单独分组
      await expect(menu.locator('.zj-menu-group-label', { hasText: '申请结果' })).toBeVisible();
      await menu.getByRole('button', { name: '关闭更多菜单' }).click();
      await expect(menu).toHaveCount(0);
    }
  }
});

/** demo 页内两个候选看板：第 0 个是点击展开（expand），第 1 个是左右滑动（swipe）。 */
function board(page: Page, mode: 'expand' | 'swipe'): Locator {
  return page.locator('#demo-app .zj-mobile-board').nth(mode === 'expand' ? 0 : 1);
}

/** 卡片定位（用 article 排除同样携带 data-job-id 的「更新进展」按钮）。 */
function qcard(page: Page, mode: 'expand' | 'swipe', jobId: string): Locator {
  return board(page, mode).locator(`article[data-job-id="${jobId}"]`);
}

for (const width of MOBILE_WIDTHS) {
  test.describe(`3.1 手机双候选 @ ${width}px`, () => {
    let page: Page;

    test.beforeAll(async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width, height: width === 320 ? 720 : 880 },
      });
      page = await context.newPage();
    });

    test.afterAll(async () => {
      await page.close();
    });

    test.beforeEach(async () => {
      await page.goto(server.demoUrl);
      await expect(page.locator('#demo-app .zj-mobile-card')).toHaveCount(8);
      await page.locator(`[data-mobile-width="${width}"]`).click();
      await expect(page.locator(`[data-mobile-width="${width}"]`)).toHaveClass(/is-active/);
    });

    test('两个候选均用同一组 4 份样本渲染且无横向溢出', async () => {
      await expect(board(page, 'expand').locator('.zj-mobile-card')).toHaveCount(4);
      await expect(board(page, 'swipe').locator('.zj-mobile-card')).toHaveCount(4);
      // 候选 A 列标题与候选 B 列标题同时在场
      await expect(page.locator('.zj-demo-col-title')).toHaveCount(2);
      await expectNoHorizontalOverflow(page);
      // 44px 触控目标（设计目标值）：卡面状态推进动作
      const updateBtn = qcard(page, 'swipe', 'qinghe').locator(
        '[data-action="complete-interview"]',
      );
      const box = await updateBtn.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    });

    test('滑动候选初始停在最新进展（3 / 3）', async () => {
      const card = qcard(page, 'swipe', 'qinghe');
      await expect(card).toHaveAttribute('aria-label', '青禾科技');
      await expect(card.locator('[data-swipe-position]')).toHaveText('3 / 3');
      // 最新位置：下一节点按钮禁用、回到最新隐藏、轨道滚到最后一张
      await expect(card.locator('[data-action="swipe-next"]')).toBeDisabled();
      await expect(card.locator('[data-action="swipe-latest"]')).toBeHidden();
      const track = card.locator('.zj-swipe-track');
      await expect
        .poll(() =>
          track.evaluate(
            (el) => el.scrollLeft - (el.scrollWidth - el.clientWidth),
          ),
        )
        .toBeLessThanOrEqual(1);
      // 当前节点提示为最新二面
      await expect(card.locator('.zj-swipe-context span')).toHaveText(
        '当前：二面 · 待面试',
      );
      // 待面试时间整体加粗（650 强调字重）
      const pendingTime = card.locator(
        '[data-step-id="qinghe-s3"] .zj-mobile-time',
      );
      await expect(pendingTime).toHaveText('周五 15:00');
      await expect(pendingTime).toHaveCSS('font-weight', '650');
    });

    test('展开候选初始显示最新进展（二面 · 待面试）', async () => {
      const card = qcard(page, 'expand', 'qinghe');
      await expect(
        card.locator('.zj-mobile-stage-box[data-step-id="qinghe-s3"]'),
      ).toBeVisible();
      await expect(
        card.locator('[data-step-id="qinghe-s3"] .zj-mobile-stage-label'),
      ).toContainText('二面 · 待面试');
      await expect(card.locator('[data-step-id="qinghe-s3"] .zj-mobile-time')).toHaveText(
        '周五 15:00',
      );
      await expect(card.locator('.zj-mobile-history')).toHaveCount(0);
    });

    test('滑动回看一面后，「更新进展」仍指向二面', async () => {
      const card = qcard(page, 'swipe', 'qinghe');
      // 手工回看：2 / 3（一面）
      await card.locator('[data-action="swipe-prev"]').click();
      await expect(card.locator('[data-swipe-position]')).toHaveText('2 / 3');
      await expect(card.locator('[data-action="swipe-latest"]')).toBeVisible();
      const slideStepId = await card
        .locator('.zj-swipe-track .zj-swipe-slide')
        .nth(1)
        .locator('.zj-mobile-stage-box[data-step-id]')
        .getAttribute('data-step-id');
      expect(slideStepId).toBe('qinghe-s2');

      // 新卡面：状态推进动作常驻卡脚，回看一面时目标节点仍是二面
      const completeBtn = card.locator(
        'button[data-action="complete-interview"]',
      );
      await expect(completeBtn).toHaveAttribute('data-target-step-id', 'qinghe-s3');
      await expect(completeBtn).toContainText('二面已面');

      // 提交「标记二面已面」：回调明确指向 qinghe-s3，而不是正在查看的一面
      await completeBtn.click();
      await expect(page.locator('.zj-demo-log')).toContainText(
        'onCompleteCurrentStep -> jobId=qinghe, targetStepId=qinghe-s3',
      );
      // 一面未被改动，仍是「一面 · 已面」
      await expect(
        card.locator('[data-step-id="qinghe-s2"] .zj-mobile-stage-label'),
      ).toContainText('一面 · 已面');
      // 最新进展提示变为二面已面，回看位置保留
      await expect(card.locator('.zj-swipe-context span')).toHaveText(
        '当前：二面 · 已面',
      );
      await expect(card.locator('[data-swipe-position]')).toHaveText('2 / 3');
    });

    test('手工选择后可「回到最新」，登记新进展后自动跳到最新', async () => {
      const card = qcard(page, 'swipe', 'qinghe');
      // 从最新回看到 2 / 3、1 / 3
      await card.locator('[data-action="swipe-prev"]').click();
      await expect(card.locator('[data-swipe-position]')).toHaveText('2 / 3');
      await card.locator('[data-action="swipe-prev"]').click();
      await expect(card.locator('[data-swipe-position]')).toHaveText('1 / 3');
      // 手工选择后返回最新
      await card.locator('[data-action="swipe-latest"]').click();
      await expect(card.locator('[data-swipe-position]')).toHaveText('3 / 3');
      await expect(card.locator('[data-action="swipe-latest"]')).toBeHidden();

      // 再次手工停在历史位置时登记新进展 → 视图跳到新末节点
      await card.locator('[data-action="swipe-prev"]').click();
      await expect(card.locator('[data-swipe-position]')).toHaveText('2 / 3');
      // 新卡面：经「更多」菜单的「登记其他进展」打开登记面板（默认 sheet 挂在卡外）
      await card.locator('button[data-action="open-more-menu"]').click();
      await page
        .getByRole('dialog', { name: '青禾科技更多操作' })
        .locator('[data-action="other-progress"]')
        .click();
      const dialog = page.locator('dialog.zj-dialog form[data-step-form]');
      await expect(dialog).toBeVisible();
      await dialog.locator('[name="kind"]').selectOption('oc');
      await dialog.locator('button[type="submit"]').click();
      await expect(page.locator('.zj-demo-log')).toContainText(
        '已登记新节点 -> jobId=qinghe',
      );
      await expect(card.locator('[data-swipe-position]')).toHaveText('4 / 4');
      await expect(card.locator('.zj-swipe-context span')).toHaveText('当前：OC');
    });

    test('展开候选：展开历史、编辑入口按节点区分、更新仍指向二面', async () => {
      const card = qcard(page, 'expand', 'qinghe');
      await card.locator('[data-action="toggle-history"]').click();
      const history = card.locator('.zj-mobile-history');
      await expect(history).toBeVisible();
      await expect(card.locator('[data-action="toggle-history"]')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      const items = history.locator('li');
      await expect(items).toHaveCount(3);
      // 已投递只有记录，两个面试环节可分别编辑。
      await expect(history.locator('[data-action="edit-step"]')).toHaveCount(2);
      await expect(
        history.locator('li[data-step-id="qinghe-s2"] [data-action="edit-step"]'),
      ).toHaveText('编辑一面');
      // 展开状态下推进动作仍指向最新二面
      const completeBtn = card.locator(
        'button[data-action="complete-interview"]',
      );
      await expect(completeBtn).toHaveAttribute('data-target-step-id', 'qinghe-s3');
      await completeBtn.click();
      await expect(page.locator('.zj-demo-log')).toContainText(
        'targetStepId=qinghe-s3',
      );
      // 更新后最新节点为二面已面，历史列表当前行高亮
      await expect(
        card.locator('.zj-mobile-history li[data-step-id="qinghe-s3"]'),
      ).toHaveClass(/is-current/);
      await expect(
        card.locator('[data-step-id="qinghe-s3"] .zj-mobile-stage-label'),
      ).toContainText('二面 · 已面');
      // 收起
      await card.locator('[data-action="toggle-history"]').click();
      await expect(card.locator('.zj-mobile-history')).toHaveCount(0);
    });
  });
}
