/**
 * schedule-demo.html 跨入口与十场景实测回归：
 * 验证静态版（IndexedDB 产物）与 Sites 构建（D1 产物）均包含独立可访问的 schedule-demo.html、
 * demo.html 可发现入口、10 场景 URL 直达与固定今日 2026-11-27、隔离存储不污染真实数据、
 * 真实岗位卡来源改动实时同步日历与时间线，以及 320/390/1024/1440/1920 五档宽度布局契约。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Page } from '@playwright/test';
import { startIdbBoard, type IdbBoard } from './harness-idb.ts';
import { startSitesBoard, type SitesBoard } from './harness-sites.ts';

const WAIT = 8000;
const SCREENSHOT_DIR = process.env.ZJ_DEMO_SCREENSHOT_DIR || '';

const TEN_SCENES: ReadonlyArray<{
  id: string;
  label: string;
  minJobs: number;
}> = [
  { id: 'dense-month', label: '十余岗位密集月', minJobs: 13 },
  { id: 'sparse', label: '稀疏周', minJobs: 3 },
  { id: 'same-day-multi', label: '多岗位同日', minJobs: 5 },
  { id: 'same-job-same-day', label: '同岗同日', minJobs: 3 },
  { id: 'overdue', label: '逾期', minJobs: 4 },
  { id: 'cross-month-offer', label: '跨月 Offer', minJobs: 3 },
  { id: 'date-only', label: '只含日期', minJobs: 3 },
  { id: 'undated', label: '待定轮次', minJobs: 3 },
  { id: 'ended-restore', label: '结束与恢复', minJobs: 4 },
  { id: 'empty', label: '空看板', minJobs: 0 },
];

async function captureShot(page: Page, name: string): Promise<void> {
  if (!SCREENSHOT_DIR) return;
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: false,
  });
}

async function assertNoHorizontalPageOverflow(page: Page, ctx: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  assert.ok(
    scrollWidth <= innerWidth,
    `${ctx} 不得出现整页横向溢出 (scrollWidth=${scrollWidth}, innerWidth=${innerWidth})`,
  );
}

describe('schedule-demo 独立入口与十场景实测', () => {
  describe('静态构建入口与五档宽度布局', () => {
    let idbBoard: IdbBoard;
    before(async () => {
      idbBoard = await startIdbBoard();
    });
    after(async () => {
      await idbBoard?.close();
    });

    it('demo.html 可发现并打开 schedule-demo.html，十场景链接直达、来源修改联动、样例隔离', async () => {
      const { context, page, errors } = await idbBoard.newPage({ width: 1440, height: 900 });
      try {
        // 1. 先进入真实 index.html 写入一条私人测试记录，确认 schedule-demo 与其完全隔离
        await page.locator('.zj-jobs-section .zj-section-heading [data-action="add-job"]').click();
        const form = page.locator('dialog[open].zj-dialog-form');
        await form.waitFor({ timeout: WAIT });
        await form.getByLabel('公司').fill('真实本地隔离校验公司');
        await form.getByLabel('职位').fill('测试岗位');
        await form.getByRole('button', { name: '添加' }).click();
        await page.locator('.zj-desktop-card', { hasText: '真实本地隔离校验公司' }).waitFor({ timeout: WAIT });

        // 2. 从 demo.html 发现 schedule-demo.html 入口并跳转
        await page.goto(new URL('demo.html', idbBoard.baseUrl).toString(), { waitUntil: 'networkidle' });
        const discoveryLink = page.locator('a[href="./schedule-demo.html"]');
        assert.equal(await discoveryLink.count(), 1, 'demo.html 应提供可发现的 schedule-demo.html 入口');
        await discoveryLink.click();
        await page.locator('[data-demo-today="2026-11-27"]').waitFor({ timeout: WAIT });

        // 确认隔离：不得出现真实看板中的公司
        assert.equal(
          await page.locator('.zj-desktop-card', { hasText: '真实本地隔离校验公司' }).count(),
          0,
          'schedule-demo 不得混入真实看板本地记录',
        );

        // 3. 逐一验证 10 场景均可通过 ?scene= 链接直达并固定今天 2026-11-27
        for (const scene of TEN_SCENES) {
          const url = new URL(`schedule-demo.html?scene=${scene.id}`, idbBoard.baseUrl).toString();
          await page.goto(url, { waitUntil: 'networkidle' });
          await page.locator(`[data-scene="${scene.id}"].is-active`).waitFor({ timeout: WAIT });
          const count = await page.locator('.zj-desktop-card').count();
          assert.equal(count, scene.minJobs, `场景 ${scene.id} 岗位数量应为 ${scene.minJobs}`);
          if (scene.minJobs > 0) {
            await page.locator('.zj-workspace-calendar .zj-cal-cell.is-today[data-date="2026-11-27"]').waitFor({
              timeout: WAIT,
            });
          }
        }

        // 4. 检验「只含日期」不出现 00:00，「逾期」保留未完成笔试、Offer 且排除已完成笔试
        await page.goto(new URL('schedule-demo.html?scene=date-only', idbBoard.baseUrl).toString(), {
          waitUntil: 'networkidle',
        });
        await page.locator('.zj-cal-cell[data-date="2026-11-29"]').click();
        const agendaText = (await page.locator('.zj-cal-agenda').textContent()) ?? '';
        assert.ok(agendaText.includes('Northstar Systems'));
        assert.equal(agendaText.includes('00:00'), false, '只含日期的 Offer 不得拼接 00:00');

        await page.goto(new URL('schedule-demo.html?scene=overdue', idbBoard.baseUrl).toString(), {
          waitUntil: 'networkidle',
        });
        await page.locator('.zj-cal-cell[data-date="2026-11-24"]').click();
        assert.ok((await page.locator('.zj-cal-agenda').textContent())?.includes('墨石智能'));
        await page.locator('.zj-cal-cell[data-date="2026-11-23"]').click();
        assert.equal((await page.locator('.zj-cal-agenda').textContent())?.includes('北辰芯片'), false);

        // 5. 检验「结束与恢复」真实卡面操作同步日历与时间线
        await page.goto(new URL('schedule-demo.html?scene=ended-restore', idbBoard.baseUrl).toString(), {
          waitUntil: 'networkidle',
        });
        await page.locator('.zj-cal-cell[data-date="2026-11-29"]').click();
        assert.equal((await page.locator('.zj-cal-agenda').textContent())?.includes('白鹭智驾'), false);

        const endedCard = page.locator('.zj-desktop-card', { hasText: '白鹭智驾' });
        await endedCard.locator('[data-action="clear-result"]').click();
        await page.locator('.zj-cal-cell[data-date="2026-11-29"]').click();
        await page.locator('.zj-cal-agenda', { hasText: '白鹭智驾' }).waitFor({ timeout: WAIT });

        await page.locator('.zj-view-nav [data-page="timeline"]').click();
        const row = page.locator('.zj-schedule-timeline-view .zj-st-row', { hasText: '白鹭智驾' });
        assert.equal(await row.locator('.zj-st-node.is-ended').count(), 0);

        // 6. 检验同岗同日来源修改：在「同岗同日」将天枢网络二面改期至 2026-11-28，日历与时间线同步
        await page.goto(new URL('schedule-demo.html?scene=same-job-same-day', idbBoard.baseUrl).toString(), {
          waitUntil: 'networkidle',
        });
        const sjsdCard = page.locator('.zj-desktop-card', { hasText: '天枢网络' });
        await sjsdCard.locator('[data-step-id] [data-action="edit-step"]', { hasText: '二面' }).click();
        const stepDialog = page.locator('dialog[open].zj-dialog');
        await stepDialog.waitFor({ timeout: WAIT });
        await stepDialog.getByLabel('日期（可选）').fill('2026-11-28');
        await stepDialog.getByLabel('时间（可选）').fill('15:30');
        await stepDialog.getByRole('button', { name: '保存' }).click();

        await page.locator('.zj-cal-cell[data-date="2026-11-28"]').click();
        const rescheduledAgenda = (await page.locator('.zj-cal-agenda').textContent()) ?? '';
        assert.ok(rescheduledAgenda.includes('天枢网络') && rescheduledAgenda.includes('15:30'));

        // 7. 切回首页真看板，确认真实 IndexedDB 未被任何 demo 样例污染
        await page.goto(idbBoard.baseUrl, { waitUntil: 'networkidle' });
        assert.equal(await page.locator('.zj-desktop-card', { hasText: '真实本地隔离校验公司' }).count(), 1);
        assert.equal(await page.locator('.zj-desktop-card', { hasText: '白鹭智驾' }).count(), 0);

        assert.equal(errors.length, 0);
      } finally {
        await context.close();
      }
    });

    it('320/390/1024/1440/1920 五档宽度布局无溢出且可找最近截止、同日安排与来源定位', async () => {
      for (const width of [320, 390, 1024, 1440, 1920] as const) {
        const height = width >= 1024 ? 900 : 844;
        const { context, page, errors } = await idbBoard.newPage({ width, height });
        try {
          await page.goto(new URL('schedule-demo.html?scene=dense-month', idbBoard.baseUrl).toString(), {
            waitUntil: 'networkidle',
          });
          await page.locator('[data-scene="dense-month"].is-active').waitFor({ timeout: WAIT });
          assert.equal(await page.locator('.zj-app-topbar [data-action="add-job"]').count(), 0);
          const sectionAdd = page.locator('.zj-jobs-section .zj-section-heading [data-action="add-job"]');
          assert.equal(await sectionAdd.count(), 1);
          const headingMetrics = await page.evaluate(() => {
            const head = document.querySelector<HTMLElement>('.zj-jobs-section .zj-section-heading');
            const title = head?.querySelector<HTMLElement>('.zj-section-title-group');
            const btn = head?.querySelector<HTMLElement>('[data-action="add-job"]');
            if (!head || !title || !btn) return null;
            const tr = title.getBoundingClientRect();
            const br = btn.getBoundingClientRect();
            return {
              titleMid: tr.top + tr.height / 2,
              btnMid: br.top + br.height / 2,
              sameRow: Math.abs(tr.top + tr.height / 2 - (br.top + br.height / 2)) < 24,
              btnHeight: br.height,
            };
          });
          assert.ok(headingMetrics && headingMetrics.sameRow, `${width}px 标题与添加岗位应在同一行垂直居中`);
          if (width < 768) {
            assert.ok(headingMetrics.btnHeight >= 44, `${width}px 添加岗位触控高度应 >= 44px`);
          }
          await assertNoHorizontalPageOverflow(page, `${width}px 看板页`);

          if (width >= 1200) {
            // 宽桌面：双栏并排看板+日历、全宽时间线
            await page.locator('.zj-workspace-calendar .zj-calendar-view').waitFor({ timeout: WAIT });
            if (width === 1440) {
              await captureShot(page, 'schedule-demo-desktop-1440-board');
            }
            await page.locator('.zj-workspace-calendar .zj-cal-cell[data-date="2026-11-27"]').click();
            await page.locator('.zj-cal-agenda-list .zj-schedule-event-btn', { hasText: '青禾科技' }).click();
            await page.locator('.zj-desktop-card[data-located="true"]', { hasText: '青禾科技' }).waitFor({
              timeout: WAIT,
            });
            await page.locator('.zj-view-nav [data-page="timeline"]').click();
            await page.locator('.zj-schedule-timeline-view').waitFor({ timeout: WAIT });
            await assertNoHorizontalPageOverflow(page, `${width}px 时间线页`);
            if (width === 1440) {
              await captureShot(page, 'schedule-demo-desktop-1440-timeline');
            }
          } else {
            // 1024px 与手机 390/320px：三页导航、独立日历页与时间线页
            assert.equal(await page.locator('.zj-workspace-calendar').count(), 0);
            if (width === 1024) {
              await captureShot(page, 'schedule-demo-desktop-1024-board');
            } else if (width === 390) {
              await captureShot(page, 'schedule-demo-mobile-390-board');
            }

            await page.locator('.zj-view-nav [data-page="calendar"]').click();
            await page.locator('.zj-calendar-view').waitFor({ timeout: WAIT });
            assert.equal(await page.locator('.zj-app-topbar [data-action="add-job"]').count(), 0);
            await assertNoHorizontalPageOverflow(page, `${width}px 日历页`);
            if (width === 390) {
              await captureShot(page, 'schedule-demo-mobile-390-calendar');
            } else if (width === 320) {
              await captureShot(page, 'schedule-demo-mobile-320-calendar');
            } else if (width === 1024) {
              await captureShot(page, 'schedule-demo-desktop-1024-calendar');
            }

            await page.locator('.zj-cal-cell[data-date="2026-11-27"]').click();
            await page.locator('.zj-cal-agenda-list .zj-schedule-event-btn', { hasText: '青禾科技' }).click();
            const cardSel = width >= 768 ? '.zj-desktop-card' : '.zj-mobile-card';
            await page.locator(`${cardSel}[data-located="true"]`, { hasText: '青禾科技' }).waitFor({
              timeout: WAIT,
            });

            await page.locator('.zj-view-nav [data-page="timeline"]').click();
            await page.locator('.zj-schedule-timeline-view').waitFor({ timeout: WAIT });
            await assertNoHorizontalPageOverflow(page, `${width}px 时间线页`);
            if (width === 390) {
              await captureShot(page, 'schedule-demo-mobile-390-timeline');
            }
          }

          assert.equal(errors.length, 0);
        } finally {
          await context.close();
        }
      }
    });
  });

  describe('Sites 构建产物入口验证', () => {
    let sitesBoard: SitesBoard;
    before(async () => {
      sitesBoard = await startSitesBoard();
    });
    after(async () => {
      await sitesBoard?.close();
    });

    it('Sites 构建包包含 schedule-demo.html，全场景交互不请求写站点 API', async () => {
      const { context, page, errors } = await sitesBoard.newPage({ width: 1440, height: 900 });
      try {
        await page.goto(new URL('schedule-demo.html?scene=cross-month-offer', sitesBoard.baseUrl).toString(), {
          waitUntil: 'networkidle',
        });
        await page.locator('[data-scene="cross-month-offer"].is-active').waitFor({ timeout: WAIT });
        await page.locator('.zj-workspace-calendar [data-action="calendar-next-month"]').click();
        await page.locator('.zj-cal-cell[data-date="2026-12-03"]').click();
        const text = (await page.locator('.zj-cal-agenda').textContent()) ?? '';
        assert.ok(text.includes('拾光数据'), 'Sites 构建包下 12 月跨月 Offer 应可切月并点选');

        assert.equal(sitesBoard.commandRequestCount(), 0, 'schedule-demo 不得向站点 API 写入命令');
        assert.equal(await sitesBoard.countJobsInD1(), 0, 'Sites D1 数据库应完全隔离为空');
        assert.equal(errors.length, 0);
      } finally {
        await context.close();
      }
    });
  });
});
