// 边界样本（长公司名、长职位、6 轮节点）在手机与桌面宽度下的溢出与最新起点检查。
// 不属于 1.1/1.2/3.1 验收主线，作为宽度回归的补充证据。
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

function board(page: Page, mode: 'expand' | 'swipe'): Locator {
  return page.locator('#demo-app .zj-mobile-board').nth(mode === 'expand' ? 0 : 1);
}

test('正式手机时间线随宽度显示节点，从最新回看到最早，更新仍指向末节点', async ({ page }) => {
  await page.goto(server.demoUrl);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 820 });
    await page.evaluate(async () => {
      const mobileModule = '/src/ui/components/mobile-job-card.ts';
      const samplesModule = '/src/ui/demo/sample-jobs.ts';
      const { createMobileJobBoard } = await import(mobileModule);
      const { createEdgeCaseJobs } = await import(samplesModule);
      document.body.replaceChildren(createMobileJobBoard({
        mode: 'timeline', menuContainer: 'sheet', jobs: createEdgeCaseJobs(),
      }).element);
    });
    const card = page.locator('[data-job-id="edge-long"]').first();
    const rail = card.locator('.zj-timeline-wrap');
    const visibility = () => rail.evaluate(el => {
      const box = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll('.zj-step')).map(step => {
        const r = step.getBoundingClientRect();
        return r.left >= box.left - 1 && r.right <= box.right + 1;
      });
    });
    const initial = await visibility();
    expect(initial.at(-1)).toBe(true);
    expect(initial.filter(Boolean).length).toBeGreaterThan(1);
    await rail.evaluate(el => { el.scrollLeft = -el.scrollWidth; });
    expect((await visibility())[0]).toBe(true);
    const latest = await rail.locator('[data-current]').getAttribute('data-step-id');
    // 新卡面：状态推进动作常驻卡脚，目标节点由 data-target-step-id 表达
    await expect(
      card.locator(`button[data-action="complete-interview"][data-target-step-id="${latest}"]`),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

for (const width of [320, 390, 430]) {
  test(`边界长文本 @ ${width}px：手机双候选无溢出且多轮轨道停在最新`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 720 : 880 });
    await page.goto(server.demoUrl);
    await page.locator('[data-preset="edge"]').click();
    await page.locator(`[data-mobile-width="${width}"]`).click();
    await expect(page.locator('[data-preset="edge"]')).toHaveClass(/is-active/);

    await expectNoHorizontalOverflow(page);
    // 多轮节点（6 环节）初始停在最新：终面待面试
    const card = board(page, 'swipe').locator('[data-job-id="edge-long"]');
    await expect(card.locator('[data-swipe-position]')).toHaveText('6 / 6');
    await expect(card.locator('.zj-swipe-context span')).toHaveText(
      '当前：终面 · 待面试',
    );
    // 长公司名卡片存在且未把页面撑破
    await expect(
      board(page, 'expand').locator('[data-job-id="edge-long"] .zj-mobile-company'),
    ).toContainText('中科智云');
    await expectNoHorizontalOverflow(page);
  });
}

test('边界长文本 @ 1024px：桌面卡无溢出、时间线从最新滑到最早', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(server.demoUrl);
  await page.locator('[data-preset="edge"]').click();
  await page.locator('[data-desktop-width="1024"]').click();

  await expectNoHorizontalOverflow(page);
  const stage = page.locator('.zj-demo-desktop-stage');
  const overflow = await stage.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const rail = stage.locator('[data-job-id="edge-long"] .zj-timeline-wrap');
  await expect(rail.locator('.zj-step')).toHaveCount(6);
  const overlaps = (el: Element) => {
    const bounds = el.getBoundingClientRect();
    return Array.from(el.querySelectorAll('.zj-step')).map(step => {
      const r = step.getBoundingClientRect();
      return r.left >= bounds.left - 1 && r.right <= bounds.right + 1;
    });
  };
  expect((await rail.evaluate(overlaps)).at(-1)).toBe(true);
  await rail.evaluate(el => { el.scrollLeft = -el.scrollWidth; });
  expect((await rail.evaluate(overlaps))[0]).toBe(true);
  await expectNoHorizontalOverflow(page);
});
