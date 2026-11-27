/**
 * feedbackBanner 脱离文档流零位移与可用性浏览器回归：
 * 基于 Sites/D1 真实前端验证桌面（1440px）与手机（390px）在
 * saving（保存中）-> saved（保存成功）-> idle（自动消失）-> failed（发送前失败）-> unknown（丢响应）-> conflict（版本冲突与刷新重读）
 * 全周期中不推移卡片与操作按钮位置，且提示可读、卡片与提示按钮均不被遮挡且可点击。
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Page } from '@playwright/test';
import { startSitesBoard, type SitesBoard } from './harness-sites.ts';

const WAIT = 8000;

interface MeasuredPos {
  firstCardY: number;
  secondCardY: number;
  secondActionY: number;
  secondMoreY: number;
  navY: number;
  calendarY: number | null;
}

async function measureBoardPositions(
  page: Page,
  cardSelector: string,
): Promise<MeasuredPos> {
  return page.evaluate((sel) => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(sel));
    const nav = document.querySelector<HTMLElement>('.zj-view-nav');
    if (cards.length < 2 || !nav) {
      throw new Error(`测量元素不足: cards=${cards.length}, nav=${Boolean(nav)}`);
    }
    const first = cards[0]!;
    const second = cards[1]!;
    const secondAction = second.querySelector<HTMLElement>('.zj-card-action-btn');
    const secondMore = second.querySelector<HTMLElement>('[data-action="open-more-menu"]');
    if (!secondAction || !secondMore) {
      throw new Error(`未找到第二张卡片操作按钮: action=${Boolean(secondAction)}, more=${Boolean(secondMore)}`);
    }
    const cal = document.querySelector<HTMLElement>('.zj-workspace-calendar .zj-calendar-view');
    return {
      firstCardY: Math.round(first.getBoundingClientRect().top),
      secondCardY: Math.round(second.getBoundingClientRect().top),
      secondActionY: Math.round(secondAction.getBoundingClientRect().top),
      secondMoreY: Math.round(secondMore.getBoundingClientRect().top),
      navY: Math.round(nav.getBoundingClientRect().top),
      calendarY: cal ? Math.round(cal.getBoundingClientRect().top) : null,
    };
  }, cardSelector);
}

function assertUnshifted(
  label: string,
  stateName: string,
  baseline: MeasuredPos,
  current: MeasuredPos,
): void {
  assert.equal(current.firstCardY, baseline.firstCardY, `${label} [${stateName}] 首张卡片 top 不得发生位移`);
  assert.equal(current.secondCardY, baseline.secondCardY, `${label} [${stateName}] 下方卡片 top 不得发生位移`);
  assert.equal(current.secondActionY, baseline.secondActionY, `${label} [${stateName}] 下方卡片主按钮 top 不得发生位移`);
  assert.equal(current.secondMoreY, baseline.secondMoreY, `${label} [${stateName}] 下方卡片更多按钮 top 不得发生位移`);
  assert.equal(current.navY, baseline.navY, `${label} [${stateName}] 导航栏 top 不得发生位移`);
  assert.equal(current.calendarY, baseline.calendarY, `${label} [${stateName}] 日历侧栏 top 不得发生位移`);
}

async function assertBannerReadableAndClickable(
  page: Page,
  label: string,
  stateName: string,
  expectedText: string,
  viewport: { width: number; height: number },
  cardSelector: string,
): Promise<void> {
  const banner = page.locator('.zj-feedback-banner');
  await banner.waitFor({ state: 'visible', timeout: WAIT });
  const text = (await banner.textContent()) ?? '';
  assert.ok(text.includes(expectedText), `${label} [${stateName}] 提示文案应包含「${expectedText}」，实测「${text}」`);

  const info = await banner.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      x: rect.left,
      y: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      bg: style.backgroundColor,
      opacity: style.opacity,
    };
  });
  assert.ok(info.width > 120 && info.height >= 36, `${label} [${stateName}] 提示尺寸异常`);
  assert.ok(info.x >= 0 && info.right <= viewport.width, `${label} [${stateName}] 提示超出视口左右边界`);
  assert.ok(info.y >= 0 && info.bottom <= viewport.height, `${label} [${stateName}] 提示超出视口上下边界`);
  assert.equal(info.opacity, '1');
  assert.notEqual(info.bg, 'rgba(0, 0, 0, 0)', `${label} [${stateName}] 提示背景必须不透明以保证可读`);

  const unobstructed = await page.evaluate((sel) => {
    const secondCard = document.querySelectorAll(sel)[1];
    const targets: Array<{ name: string; el: Element | null }> = [
      { name: 'top-settings', el: document.querySelector('[data-action="open-settings"]') },
      { name: 'section-add-job', el: document.querySelector('.zj-jobs-section .zj-section-heading [data-action="add-job"]') },
      { name: 'nav-tab', el: document.querySelector('.zj-view-nav [data-page="timeline"]') },
      { name: 'second-card-action', el: secondCard?.querySelector('.zj-card-action-btn') ?? null },
      { name: 'second-card-more', el: secondCard?.querySelector('[data-action="open-more-menu"]') ?? null },
    ];
    const refreshBtn = document.querySelector<HTMLElement>('.zj-feedback-banner [data-action="refresh-from-banner"]');
    if (refreshBtn && !refreshBtn.hidden) {
      targets.push({ name: 'banner-refresh', el: refreshBtn });
    }
    const dismissBtn = document.querySelector<HTMLElement>('.zj-feedback-banner .zj-feedback-dismiss');
    if (dismissBtn && !dismissBtn.hidden) {
      targets.push({ name: 'banner-dismiss', el: dismissBtn });
    }
    return targets.map(({ name, el }) => {
      if (!el) return { name, ok: false, reason: 'missing' };
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return { name, ok: Boolean(hit && (el === hit || el.contains(hit))) };
    });
  }, cardSelector);

  for (const item of unobstructed) {
    assert.equal(item.ok, true, `${label} [${stateName}] 控件 ${item.name} 被遮挡不可点`);
  }
}

async function addJobAndLogPendingInterview(page: Page, company: string): Promise<void> {
  await page.locator('.zj-jobs-section .zj-section-heading [data-action="add-job"]').click();
  const form = page.locator('dialog[open].zj-dialog-form');
  await form.waitFor({ timeout: WAIT });
  await form.getByLabel('公司').fill(company);
  await form.getByLabel('职位').fill('研发工程师');
  await form.getByRole('button', { name: '添加' }).click();
  await page.locator('.zj-feedback-banner[data-tone="saved"]').waitFor({ timeout: WAIT });

  const card = page.locator('[data-job-id]', { hasText: company }).first();
  await card.locator('[data-action="open-more-menu"]').click();
  const menu = page.locator('.zj-menu').first();
  await menu.waitFor({ timeout: WAIT });
  await menu.locator('[data-action="other-progress"]').click();
  const stepDialog = page.locator('dialog[open].zj-dialog');
  await stepDialog.waitFor({ timeout: WAIT });
  await stepDialog.getByLabel('环节类型').selectOption('interview');
  await stepDialog.getByLabel('面试轮次').selectOption({ label: '一面' });
  await stepDialog.getByRole('button', { name: '登记' }).click();
  await page.locator('.zj-feedback-banner[data-tone="saved"]').waitFor({ timeout: WAIT });
}

describe('feedbackBanner 脱离文档流零位移回归', () => {
  let sitesBoard: SitesBoard;
  before(async () => {
    sitesBoard = await startSitesBoard();
  });
  after(async () => {
    await sitesBoard?.close();
  });

  for (const preset of [
    { label: '桌面 1440px', width: 1440, height: 900, cardSel: '.zj-desktop-card' },
    { label: '手机 390px', width: 390, height: 844, cardSel: '.zj-mobile-card' },
  ] as const) {
    it(`${preset.label}：保存中、成功与消失、失败/未知、冲突全周期不推移卡片且操作可达`, async () => {
      await sitesBoard.resetD1();
      const { context, page, errors } = await sitesBoard.newPage({
        width: preset.width,
        height: preset.height,
      });

      try {
        await addJobAndLogPendingInterview(page, '稳态一号');
        await addJobAndLogPendingInterview(page, '稳态二号');
        await page.locator('.zj-feedback-banner').waitFor({ state: 'hidden', timeout: WAIT });

        const cardSel = preset.cardSel;
        const firstCard = page.locator(cardSel, { hasText: '稳态一号' });
        const baseline = await measureBoardPositions(page, cardSel);

        // 1. 保存中（星标首个岗位保持顺序与卡高不变，延迟响应稳态测 saving）-> 成功 -> 自动消失
        let releaseSlowCommand: (() => void) | null = null;
        let slowHandled = false;
        const slowHandler = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
          if (!slowHandled) {
            slowHandled = true;
            await new Promise<void>((resolve) => {
              releaseSlowCommand = resolve;
            });
          }
          await route.continue();
        };
        await page.route('**/api/board/commands', slowHandler);

        await firstCard.locator('[data-action="toggle-star"]').click();
        await page.locator('.zj-feedback-banner[data-tone="saving"]').waitFor({ state: 'visible', timeout: WAIT });
        await assertBannerReadableAndClickable(
          page,
          preset.label,
          'saving',
          '正在保存',
          { width: preset.width, height: preset.height },
          cardSel,
        );
        assertUnshifted(preset.label, 'saving', baseline, await measureBoardPositions(page, cardSel));

        releaseSlowCommand!();
        await page.locator('.zj-feedback-banner[data-tone="saved"]').waitFor({ state: 'visible', timeout: WAIT });
        await page.unroute('**/api/board/commands', slowHandler);
        await assertBannerReadableAndClickable(
          page,
          preset.label,
          'saved',
          '站点已确认',
          { width: preset.width, height: preset.height },
          cardSel,
        );
        assertUnshifted(preset.label, 'saved', baseline, await measureBoardPositions(page, cardSel));

        await page.locator('.zj-feedback-banner').waitFor({ state: 'hidden', timeout: WAIT });
        assertUnshifted(preset.label, 'idle-after-saved', baseline, await measureBoardPositions(page, cardSel));

        // 2. 发送前断网失败（failed）与关闭提示均不推移卡片
        await context.setOffline(true);
        await firstCard.locator('[data-action="toggle-star"]').click();
        await page.locator('.zj-feedback-banner[data-tone="failed"]').waitFor({ state: 'visible', timeout: WAIT });
        await assertBannerReadableAndClickable(
          page,
          preset.label,
          'failed',
          '网络不可用',
          { width: preset.width, height: preset.height },
          cardSel,
        );
        assertUnshifted(preset.label, 'failed', baseline, await measureBoardPositions(page, cardSel));
        await context.setOffline(false);

        await page.locator('.zj-feedback-dismiss').click();
        await page.locator('.zj-feedback-banner').waitFor({ state: 'hidden', timeout: WAIT });
        assertUnshifted(preset.label, 'dismissed-failed', baseline, await measureBoardPositions(page, cardSel));

        // 3. 请求丢响应（unknown）-> 刷新查看 -> 关闭提示：全程零位移
        sitesBoard.dropNextCommandResponse();
        await firstCard.locator('[data-action="toggle-star"]').click();
        await page.locator('.zj-feedback-banner[data-tone="unknown"]').waitFor({ state: 'visible', timeout: WAIT });
        await assertBannerReadableAndClickable(
          page,
          preset.label,
          'unknown',
          '未确认是否保存',
          { width: preset.width, height: preset.height },
          cardSel,
        );
        assertUnshifted(preset.label, 'unknown', baseline, await measureBoardPositions(page, cardSel));

        await page.locator('.zj-feedback-banner [data-action="refresh-from-banner"]').click();
        await page.locator('.zj-feedback-note', { hasText: '已重读' }).waitFor({ state: 'visible', timeout: WAIT });
        assertUnshifted(preset.label, 'unknown-refreshed', baseline, await measureBoardPositions(page, cardSel));

        await page.locator('.zj-feedback-dismiss').click();
        await page.locator('.zj-feedback-banner').waitFor({ state: 'hidden', timeout: WAIT });
        assertUnshifted(preset.label, 'unknown-dismissed', baseline, await measureBoardPositions(page, cardSel));

        // 4. 并发版本冲突（conflict）：双标签错开版本后提交 -> 冲突条可读、零位移、刷新重读同步
        const tabB = await context.newPage();
        await tabB.setViewportSize({ width: preset.width, height: preset.height });
        await tabB.goto(sitesBoard.baseUrl, { waitUntil: 'networkidle' });
        await tabB.locator(cardSel, { hasText: '稳态二号' }).locator('[data-action="open-more-menu"]').click();
        const menuB = tabB.locator('.zj-menu').first();
        await menuB.waitFor({ timeout: WAIT });
        await menuB.locator('[data-action="other-progress"]').click();
        const dlgB = tabB.locator('dialog[open].zj-dialog');
        await dlgB.waitFor({ timeout: WAIT });
        await dlgB.getByLabel('环节类型').selectOption('oc');
        await dlgB.getByRole('button', { name: '登记' }).click();
        await tabB.locator('.zj-feedback-banner[data-tone="saved"]').waitFor({ timeout: WAIT });
        await tabB.close();

        await page.locator(cardSel, { hasText: '稳态二号' }).locator('[data-action="toggle-star"]').click();
        await page.locator('.zj-feedback-banner[data-tone="conflict"]').waitFor({ state: 'visible', timeout: WAIT });
        await assertBannerReadableAndClickable(
          page,
          preset.label,
          'conflict',
          '进展已变更',
          { width: preset.width, height: preset.height },
          cardSel,
        );
        assertUnshifted(preset.label, 'conflict', baseline, await measureBoardPositions(page, cardSel));

        await page.locator('.zj-feedback-banner [data-action="refresh-from-banner"]').click();
        await page.locator(cardSel, { hasText: '稳态二号' }).locator('.zj-step', { hasText: 'OC' }).waitFor({ timeout: WAIT });
        assertUnshifted(preset.label, 'conflict-refreshed', baseline, await measureBoardPositions(page, cardSel));

        await page.locator('.zj-feedback-dismiss').click();
        await page.locator('.zj-feedback-banner').waitFor({ state: 'hidden', timeout: WAIT });
        assertUnshifted(preset.label, 'conflict-dismissed', baseline, await measureBoardPositions(page, cardSel));

        assert.equal(errors.length, 0);
      } finally {
        await context.close();
      }
    });
  }
});
