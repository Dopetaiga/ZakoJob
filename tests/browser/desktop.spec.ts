// 1.2 桌面横向进展卡验收：四份设计基底样本、宽屏/1024/中间窗口密度、加粗时间、零数据。
import { test, expect, type Page } from '@playwright/test';
import { startDemoServer, type DemoServer } from './vite-demo-server';
import { expectNoHorizontalOverflow } from './page-helpers';

let server: DemoServer;

test.beforeAll(async () => {
  server = await startDemoServer();
});

test.afterAll(async () => {
  await server.close();
});

async function openDemo(page: Page): Promise<void> {
  await page.goto(server.demoUrl);
  await expect(page.locator('#demo-app .zj-desktop-card')).toHaveCount(4);
}

test.describe('1.2 桌面工作台', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDemo(page);
  });

  test('宽屏 1440：四份样本按星标排序、横向节点与时间字重', async ({ page }) => {
    // 四份设计基底样本齐全
    const cardIds = await page.locator('#demo-app .zj-desktop-card').evaluateAll(
      (cards) => cards.map((c) => (c as HTMLElement).dataset.jobId),
    );
    expect(cardIds).toEqual(['qinghe', 'qiyuan', 'shiguang', 'link-42']);

    // 星标岗位排最前，星标按钮为按下状态
    const firstStar = page
      .locator('[data-job-id="qinghe"] [data-action="toggle-star"]')
      .first();
    await expect(firstStar).toHaveAttribute('aria-pressed', 'true');

    // 青禾横向时间线：已投递 → 一面已面 → 二面待面试，不预留三面/Offer
    const stepTitles = await page
      .locator('[data-job-id="qinghe"] .zj-step-title')
      .allTextContents();
    expect(stepTitles).toEqual(['已投递', '一面 · 已面', '二面 · 待面试']);

    // 二面待面试：时间整体加粗（strong + 650 强调字重）。设计仅要求加粗，
    // 实测 .zj-step-time 覆盖为正文色 #242424（与浅色基底一致）。
    const pendingTime = page.locator(
      '[data-job-id="qinghe"] [data-step-id="qinghe-s3"] .zj-step-time',
    );
    await expect(pendingTime).toHaveText('周五 15:00');
    expect(await pendingTime.evaluate((el) => el.tagName)).toBe('STRONG');
    await expect(pendingTime).toHaveCSS('font-weight', '650');
    await expect(pendingTime).toHaveCSS('color', 'rgb(36, 36, 36)');

    // 一面已面：时间降低字重回看（span、400、中性灰）
    const pastTime = page.locator(
      '[data-job-id="qinghe"] [data-step-id="qinghe-s2"] .zj-step-time',
    );
    await expect(pastTime).toHaveText('周二 14:00');
    expect(await pastTime.evaluate((el) => el.tagName)).toBe('SPAN');
    await expect(pastTime).toHaveCSS('font-weight', '400');
    await expect(pastTime).toHaveCSS('color', 'rgb(107, 107, 107)');

    // 仅链接样本可识别且可打开（限定桌面卡，链接同样出现在两个手机候选中）
    const linkCard = page.locator(
      '.zj-desktop-card[data-job-id="link-42"] .zj-link-primary',
    );
    await expect(linkCard).toHaveAttribute('href', 'https://jobs.example.com/p/42');
    await expect(linkCard).toContainText('jobs.example.com/p/42');

    await expectNoHorizontalOverflow(page);
    const stage = page.locator('.zj-demo-desktop-stage');
    const overflow = await stage.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('1024px：样本完整、密度可用、无溢出', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.locator('[data-desktop-width="1024"]').click();
    await expect(page.locator('[data-desktop-width="1024"]')).toHaveClass(/is-active/);

    const stage = page.locator('.zj-demo-desktop-stage');
    const stageWidth = await stage.evaluate((el) => el.getBoundingClientRect().width);
    expect(stageWidth).toBeLessThanOrEqual(1024);

    await expect(page.locator('#demo-app .zj-desktop-card')).toHaveCount(4);
    // 关键节点与操作入口在 1024 下仍可读、可点
    await expect(
      page.locator('[data-job-id="qinghe"] [data-step-id="qinghe-s3"] .zj-step-time'),
    ).toHaveText('周五 15:00');
    const updateBtn = page
      .locator('[data-job-id="qinghe"] [data-action="complete-interview"]')
      .first();
    await expect(updateBtn).toBeVisible();
    const box = await updateBtn.boundingBox();
    expect(box?.height).toBeGreaterThan(0);

    await expectNoHorizontalOverflow(page);
    const overflow = await stage.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('中间窗口 820px：容器断点收紧后无溢出、节点仍可读', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.locator('[data-desktop-width="820"]').click();
    await expect(page.locator('#demo-app .zj-desktop-card')).toHaveCount(4);
    const stepTitles = await page
      .locator('[data-job-id="qinghe"] .zj-step-title')
      .allTextContents();
    expect(stepTitles).toEqual(['已投递', '一面 · 已面', '二面 · 待面试']);
    await expectNoHorizontalOverflow(page);
    const stage = page.locator('.zj-demo-desktop-stage');
    const overflow = await stage.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('新看板零条记录：空态渲染并可回到样本', async ({ page }) => {
    await page.locator('[data-preset="empty"]').click();
    await expect(page.locator('[data-preset="empty"]')).toHaveClass(/is-active/);

    await expect(page.locator('#demo-app .zj-desktop-card')).toHaveCount(0);
    await expect(page.locator('#demo-app .zj-empty-board')).toHaveCount(3); // 桌面 + 两个手机候选
    const emptyTitle = page.locator('.zj-desktop-board .zj-empty-board-title');
    await expect(emptyTitle).toHaveText('还没有记录岗位');
    const addBtn = page.locator('.zj-desktop-board [data-action="add-job"]');
    await expect(addBtn).toContainText('添加岗位');
    // 桌面空态的添加入口能打开添加弹窗
    await addBtn.click();
    await expect(page.locator('dialog.zj-dialog[data-info-form], dialog.zj-dialog form[data-info-form]').first()).toBeVisible();
    await page.keyboard.press('Escape');

    // 「重置」按钮恢复的是当前选中数据集；返回基线需直接点基线 chip
    await page.locator('[data-preset="baseline"]').click();
    await expect(page.locator('#demo-app .zj-desktop-card')).toHaveCount(4);
  });

  test('桌面更新动作：当前环节指向二面', async ({ page }) => {
    // 新卡面把「标记二面已面」直接放在卡上（状态推进动作），目标节点由 data-target-step-id 表达
    const completeBtn = page
      .locator('[data-job-id="qinghe"] [data-action="complete-interview"]')
      .first();
    await expect(completeBtn).toBeVisible();
    await expect(completeBtn).toHaveAttribute('data-target-step-id', 'qinghe-s3');
    await expect(completeBtn).toContainText('二面已面');

    await completeBtn.click();
    await expect(page.locator('.zj-demo-log')).toContainText(
      'onCompleteCurrentStep -> jobId=qinghe, targetStepId=qinghe-s3',
    );
    await expect(
      page.locator('[data-job-id="qinghe"] [data-step-id="qinghe-s3"] .zj-step-title'),
    ).toHaveText('二面 · 已面');
    await expect(
      page.locator('[data-job-id="qinghe"] [data-step-id="qinghe-s3"] .zj-step-time'),
    ).toHaveText('周五 15:00');
    await expect(
      page.locator('[data-job-id="qinghe"] [data-step-id="qinghe-s3"] .zj-step-time'),
    ).toHaveCSS('font-weight', '400');
  });
});
