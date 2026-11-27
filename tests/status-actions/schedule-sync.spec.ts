/**
 * view-job-schedule 跨适配器正式集成验收（IndexedDB 腿 + Sites/D1 腿，真实 Edge 浏览器）：
 *
 * 覆盖：
 * - 宽桌面（1440px）岗位列表 + 月历并排，全宽跨岗位时间线页，手机（390px）三页切换与返回滚动位置；
 * - 同日多岗溢出、只含日期精度与待定排除、同岗同日分层、今天标记与横向滑动（岗位名随轴固定）；
 * - 改期即时移动、标记已面（从日历移出/时间线留痕）、撤回末步消失、结束申请/恢复跟进同步；
 * - 并发冲突后点击刷新重读，月历与时间线同步到服务端/对端最新日程状态。
 *
 * 运行：npx tsx --test tests/status-actions/schedule-sync.spec.ts
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Locator, Page } from '@playwright/test';
import { startIdbBoard, type IdbBoard } from './harness-idb';
import { startSitesBoard, type SitesBoard } from './harness-sites';

const WAIT = 8_000;

interface BoardRunner {
  baseUrl: string;
  newPage(viewport?: { width: number; height: number }): Promise<{
    context: Awaited<ReturnType<IdbBoard['newPage']>>['context'];
    page: Page;
    errors: string[];
  }>;
}

function localDateKeyOffset(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function desktopCard(page: Page, company: string): Locator {
  return page.locator(`.zj-desktop-card[aria-label="${company}"]`);
}

function mobileCard(page: Page, company: string): Locator {
  return page.locator('.zj-mobile-card', { hasText: company });
}

async function waitSaved(page: Page): Promise<void> {
  await page.locator('.zj-feedback-banner[data-tone="saved"]').waitFor({ timeout: WAIT });
}

async function addJob(
  page: Page,
  fields: { company: string; position: string },
): Promise<void> {
  await page.getByRole('button', { name: '添加岗位' }).first().click();
  const dialog = page.locator('dialog[open].zj-dialog-form');
  await dialog.waitFor({ timeout: WAIT });
  await dialog.getByLabel('公司').fill(fields.company);
  await dialog.getByLabel('职位').fill(fields.position);
  await dialog.getByRole('button', { name: '添加' }).click();
  await waitSaved(page);
}

async function openMoreMenu(card: Locator, page: Page): Promise<Locator> {
  await card.locator('[data-action="open-more-menu"]').click({ timeout: WAIT });
  const menu = page.locator('.zj-menu').first();
  await menu.waitFor({ timeout: WAIT });
  return menu;
}

async function logStepViaMore(
  page: Page,
  card: Locator,
  options: {
    kind: 'interview' | 'assessment' | 'written_offer';
    round?: string;
    date?: string;
    time?: string;
  },
): Promise<void> {
  const menu = await openMoreMenu(card, page);
  await menu.locator('[data-action="other-progress"]').click();
  const dialog = page.locator('dialog[open].zj-dialog');
  await dialog.waitFor({ timeout: WAIT });
  await dialog.getByLabel('环节类型').selectOption(options.kind);
  if (options.round) {
    await dialog.getByLabel('面试轮次').selectOption({ label: options.round });
  }
  if (options.date !== undefined) {
    await dialog.getByLabel('日期（可选）').fill(options.date);
  }
  if (options.time !== undefined) {
    await dialog.getByLabel('时间（可选）').fill(options.time);
  }
  await dialog.getByRole('button', { name: '登记' }).click();
  await waitSaved(page);
}

async function runScheduleSyncSuite(board: BoardRunner, label: string): Promise<void> {
  const day1 = localDateKeyOffset(1);
  const day2 = localDateKeyOffset(2);
  const day3 = localDateKeyOffset(3);

  // 1. 桌面宽屏（1440px）：岗位+月历并排、同日溢出、日期精度与待定排除、改期/标记已面/撤回/结束恢复同步、时间线全宽对比
  {
    const { context, page, errors } = await board.newPage({ width: 1440, height: 900 });
    try {
      await page.getByRole('heading', { name: '还没有记录岗位' }).waitFor({ timeout: WAIT });

      // 宽屏并排校验
      await addJob(page, { company: '青禾科技', position: '后端开发' });
      const gridBox = await page.locator('.zj-workspace-grid.is-desktop-board').boundingBox();
      const calBox = await page.locator('.zj-workspace-calendar').boundingBox();
      const cardA = desktopCard(page, '青禾科技');
      const cardBox = await cardA.boundingBox();
      assert.ok(gridBox && calBox && cardBox, `${label} 宽桌面应并排展示岗位卡与月历`);
      assert.ok(
        calBox.x > cardBox.x + cardBox.width - 5,
        `${label} 1440px 月历应位于岗位卡右侧`,
      );

      // 岗位 A：同日两项（一面 day1 10:30 + 笔试 day1 20:00）
      await logStepViaMore(page, cardA, {
        kind: 'interview',
        round: '一面',
        date: day1,
        time: '10:30',
      });
      await logStepViaMore(page, cardA, {
        kind: 'assessment',
        date: day1,
        time: '20:00',
      });

      // 岗位 B：笔试截止 day1 23:59
      await addJob(page, { company: '云起实验室', position: 'AI Infra' });
      const cardB = desktopCard(page, '云起实验室');
      await logStepViaMore(page, cardB, {
        kind: 'assessment',
        date: day1,
        time: '23:59',
      });

      // 岗位 C：书面 Offer 仅含日期 day1（无具体时刻）
      await addJob(page, { company: '拾光数据', position: '数据工程' });
      const cardC = desktopCard(page, '拾光数据');
      await logStepViaMore(page, cardC, {
        kind: 'written_offer',
        date: day1,
      });

      // 岗位 D：无日期（时间待定）面试 -> 不入日历/时间线
      await addJob(page, { company: '待定科技', position: '测试开发' });
      const cardD = desktopCard(page, '待定科技');
      await logStepViaMore(page, cardD, {
        kind: 'interview',
        round: '一面',
      });

      // 切换到 day1（若 day1 落入下月则先切换月份后再选）
      const day1Month = day1.slice(0, 7);
      const todayMonth = localDateKeyOffset(0).slice(0, 7);
      const calendar = page.locator('.zj-calendar-view');
      if (day1Month !== todayMonth) {
        await calendar.locator('[data-action="calendar-next-month"]').click();
      }
      const day1Cell = calendar.locator(`.zj-cal-cell[data-date="${day1}"]`);
      const overflowBadgeText = await day1Cell
        .locator('.zj-cal-more, .zj-cal-dot-count')
        .first()
        .textContent();
      assert.ok(
        overflowBadgeText && overflowBadgeText.includes('+'),
        `${label} 同日 4 项应显示溢出计数，实际: ${overflowBadgeText}`,
      );
      await day1Cell.click();

      // 验证同日 4 项事件在选日清单完整读出、仅日期 Offer 不补 00:00、待定科技不在清单
      const agendaItems = calendar.locator('.zj-cal-agenda-list [data-action="locate-schedule-event"]');
      assert.equal(await agendaItems.count(), 4, `${label} day1 应包含 4 项有效安排`);
      const agendaText = await calendar.locator('.zj-cal-agenda').textContent();
      assert.ok(agendaText?.includes('青禾科技'));
      assert.ok(agendaText?.includes('云起实验室'));
      assert.ok(agendaText?.includes('拾光数据'));
      assert.ok(!agendaText?.includes('待定科技'), `${label} 待定节点不应进入日历`);
      assert.ok(!agendaText?.includes('00:00'), `${label} 仅日期 Offer 不得自动补 00:00`);

      // 月历切换回今天再切回 day1
      await calendar.locator('[data-action="calendar-today"]').click();
      if (day1Month !== todayMonth) {
        await calendar.locator('[data-action="calendar-next-month"]').click();
      }
      await calendar.locator(`.zj-cal-cell[data-date="${day1}"]`).click();

      // 从日历定位回青禾科技「一面」节点并改期至 day2 15:00
      await calendar
        .locator('.zj-schedule-event-btn', { hasText: '青禾科技' })
        .filter({ hasText: '一面' })
        .click();
      await cardA.locator('[data-step-id].is-located').waitFor({ timeout: WAIT });
      await cardA.locator('.zj-step', { hasText: '一面' }).locator('button.zj-step-btn').click();
      const stepDialog = page.locator('dialog[open].zj-dialog');
      await stepDialog.waitFor({ timeout: WAIT });
      await stepDialog.getByLabel('日期（可选）').fill(day2);
      await stepDialog.getByLabel('时间（可选）').fill('15:00');
      await stepDialog.getByRole('button', { name: '保存修改' }).click();
      await waitSaved(page);

      // 无需刷新：day1 剩 3 项，day2 出现青禾一面 15:00
      assert.equal(
        await calendar.locator('.zj-cal-agenda-list [data-action="locate-schedule-event"]').count(),
        3,
      );
      const day2Month = day2.slice(0, 7);
      if (day2Month !== day1Month) {
        await calendar.locator('[data-action="calendar-next-month"]').click();
      }
      await calendar.locator(`.zj-cal-cell[data-date="${day2}"]`).click();
      const day2Text = await calendar.locator('.zj-cal-agenda').textContent();
      assert.ok(day2Text?.includes('青禾科技') && day2Text?.includes('15:00'));

      // 标记一面已面：点击青禾科技卡面前先去全宽时间线验证，或先标记笔试完成再切时间线
      // 先在更多菜单里点「编辑一面」将状态标为已面（因为青禾科技末步是笔试，一面为早期面试）
      await cardA.locator('.zj-step', { hasText: '一面' }).locator('button.zj-step-btn').click();
      await stepDialog.waitFor({ timeout: WAIT });
      await stepDialog.getByLabel('面试状态').selectOption('completed');
      await stepDialog.getByRole('button', { name: '保存修改' }).click();
      await waitSaved(page);

      // 标为已面后从有效日历 day2 移出
      assert.equal(
        await calendar.locator('.zj-cal-agenda-list [data-action="locate-schedule-event"]').count(),
        0,
        `${label} 已面节点应从有效日历移出`,
      );

      // 切至桌面「时间线」整行页：已面的一面仍在时间线留痕（is-settled），且今天列有标记
      await page.locator('.zj-view-nav [data-action="switch-view"][data-page="timeline"]').click();
      const timelineView = page.locator('.zj-schedule-timeline-view');
      await timelineView.waitFor({ timeout: WAIT });
      assert.ok(
        (await timelineView.locator('.zj-st-day-head.is-today .zj-st-today-badge').textContent()) === '今天',
      );
      const qingheRow = timelineView.locator(`.zj-st-row[data-job-id]`, { hasText: '青禾科技' });
      assert.ok(
        (await qingheRow.locator('.zj-st-node.is-settled', { hasText: '一面 15:00' }).count()) === 1,
        `${label} 时间线应保留已面节点`,
      );

      // 点击时间线节点跳回岗位卡并高亮，随后撤回末步（笔试）同步从两视图消失
      await qingheRow.locator('.zj-st-node', { hasText: '笔试 / 测评' }).click();
      await cardA.locator('[data-step-id].is-located').waitFor({ timeout: WAIT });
      await cardA.locator('.zj-step').last().locator('button.zj-step-btn').click();
      await stepDialog.waitFor({ timeout: WAIT });
      await stepDialog.locator('[data-action="withdraw-step"]').click();
      await waitSaved(page);

      // 验证时间线里青禾只剩一面、笔试已撤回
      await page.locator('.zj-view-nav [data-action="switch-view"][data-page="timeline"]').click();
      assert.equal(
        await timelineView.locator('.zj-st-row', { hasText: '青禾科技' }).locator('.zj-st-node', { hasText: '笔试' }).count(),
        0,
      );

      // 返回岗位：结束「云起实验室」申请后从日历移出、恢复跟进后回到日历
      await page.locator('.zj-view-nav [data-action="switch-view"][data-page="board"]').click();
      const menuB = await openMoreMenu(cardB, page);
      await menuB.locator('[data-action="set-result-rejected"]').click();
      await waitSaved(page);

      if (day1Month !== todayMonth) {
        await calendar.locator('[data-action="calendar-next-month"]').click();
      }
      await calendar.locator(`.zj-cal-cell[data-date="${day1}"]`).click();
      assert.equal(
        await calendar.locator('.zj-cal-agenda-list .zj-schedule-event-btn', { hasText: '云起实验室' }).count(),
        0,
        `${label} 结束申请后应从有效日历移出`,
      );

      await cardB.locator('[data-action="clear-result"]').click();
      await waitSaved(page);
      assert.equal(
        await calendar.locator('.zj-cal-agenda-list .zj-schedule-event-btn', { hasText: '云起实验室' }).count(),
        1,
        `${label} 恢复跟进后应重新回到日历`,
      );

      assert.equal(errors.length, 0);
    } finally {
      await context.close();
    }
  }

  // 2. 双标签并发版本冲突后重读：日历与时间线同步到最新版本
  {
    const { context, page, errors } = await board.newPage({ width: 1280, height: 860 });
    const tabB = await context.newPage();
    await tabB.setViewportSize({ width: 1280, height: 860 });
    const errorsB: string[] = [];
    tabB.on('pageerror', (e) => errorsB.push(e.message));

    try {
      await addJob(page, { company: '并发科技', position: '内核研发' });
      const cardA = desktopCard(page, '并发科技');
      await logStepViaMore(page, cardA, {
        kind: 'interview',
        round: '一面',
        date: day1,
        time: '09:30',
      });

      await tabB.goto(board.baseUrl, { waitUntil: 'networkidle' });
      const cardB = desktopCard(tabB, '并发科技');
      await cardB.waitFor({ timeout: WAIT });

      // Tab A 先将一面改期到 day3 16:00
      await cardA.locator('.zj-step', { hasText: '一面' }).locator('button.zj-step-btn').click();
      const dialogA = page.locator('dialog[open].zj-dialog');
      await dialogA.waitFor({ timeout: WAIT });
      await dialogA.getByLabel('日期（可选）').fill(day3);
      await dialogA.getByLabel('时间（可选）').fill('16:00');
      await dialogA.getByRole('button', { name: '保存修改' }).click();
      await waitSaved(page);

      // Tab B 持旧版本提交「标记一面已面」-> 触发版本冲突
      await cardB.getByRole('button', { name: '标记一面已面' }).click();
      const conflictBanner = tabB.locator('.zj-feedback-banner[data-tone="conflict"]');
      await conflictBanner.waitFor({ timeout: WAIT });

      // 点击「刷新查看」重读：Tab B 卡片、月历与时间线均同步为 day3 16:00
      await conflictBanner.getByRole('button', { name: '刷新查看' }).click();
      await cardB.locator('.zj-step', { hasText: '待面试' }).waitFor({ timeout: WAIT });

      const calB = tabB.locator('.zj-calendar-view');
      const day3Month = day3.slice(0, 7);
      const todayMonth = localDateKeyOffset(0).slice(0, 7);
      if (day3Month !== todayMonth) {
        await calB.locator('[data-action="calendar-next-month"]').click();
      }
      await calB.locator(`.zj-cal-cell[data-date="${day3}"]`).click();
      const calBText = await calB.locator('.zj-cal-agenda').textContent();
      assert.ok(
        calBText?.includes('并发科技') && calBText?.includes('16:00'),
        `${label} 冲突重读后月历应同步为 day3 16:00`,
      );

      await tabB.locator('.zj-view-nav [data-action="switch-view"][data-page="timeline"]').click();
      const tlBText = await tabB.locator('.zj-schedule-timeline-view .zj-st-row', { hasText: '并发科技' }).textContent();
      assert.ok(tlBText?.includes('16:00'), `${label} 冲突重读后时间线应同步为 16:00`);

      assert.equal(errors.length, 0);
      assert.equal(errorsB.length, 0);
    } finally {
      await context.close();
    }
  }

  // 3. 手机端（390px）：三页切换、返回岗位恢复滚动位置、时间线轴内横滑无整页横向溢出
  {
    const { context, page, errors } = await board.newPage({ width: 390, height: 844 });
    try {
      for (const name of ['甲公司', '乙公司', '丙公司', '丁公司', '戊公司']) {
        await addJob(page, { company: name, position: '工程师' });
      }
      const lastCard = mobileCard(page, '戊公司');
      await logStepViaMore(page, lastCard, {
        kind: 'interview',
        round: '一面',
        date: day2,
        time: '14:00',
      });

      // 向下滚动岗位列表后进入「日历」，再返回「岗位」检查滚动位置恢复
      await page.evaluate(() => window.scrollTo(0, 260));
      const beforeScrollY = await page.evaluate(() => window.scrollY);
      assert.ok(beforeScrollY > 100, `${label} 手机列表应可向下滚动`);

      const navTabs = page.locator('.zj-view-nav [data-action="switch-view"]');
      assert.equal(await navTabs.count(), 3, `${label} 手机应提供三页导航`);
      await page.locator('.zj-view-nav [data-page="calendar"]').click();
      await page.locator('.zj-calendar-view').waitFor({ timeout: WAIT });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );

      await page.locator('[data-action="back-to-board"]').click();
      await page.waitForTimeout(100);
      const restoredScrollY = await page.evaluate(() => window.scrollY);
      assert.ok(
        Math.abs(restoredScrollY - beforeScrollY) <= 10,
        `${label} 返回岗位应恢复原滚动位置 (${beforeScrollY} -> ${restoredScrollY})`,
      );

      // 进入「时间线」检查页面无横向溢出，轴内部可横滑
      await page.locator('.zj-view-nav [data-page="timeline"]').click();
      await page.locator('.zj-schedule-timeline-view').waitFor({ timeout: WAIT });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
        `${label} 手机时间线页不得造成整页横向溢出`,
      );

      assert.equal(errors.length, 0);
    } finally {
      await context.close();
    }
  }

  // 4. 中宽桌面（1024px，768–1199px）：设备偏好仍按桌面、无底部堆积日历、使用独立日历导航，
  //    且在 1440px <-> 1024px <-> 390px 两断点动态切换时仍可直接访问日历
  {
    const { context, page, errors } = await board.newPage({ width: 1024, height: 800 });
    try {
      await addJob(page, { company: '中宽科技', position: '全栈工程师' });
      const card = desktopCard(page, '中宽科技');
      await logStepViaMore(page, card, {
        kind: 'interview',
        round: '一面',
        date: day1,
        time: '10:00',
      });

      const shell = page.locator('.zj-app-shell');
      assert.equal(await shell.getAttribute('data-device'), 'desktop', `${label} 1024px 仍应按桌面设备偏好处理`);
      assert.equal(
        await desktopCard(page, '中宽科技').count(),
        1,
        `${label} 1024px 应沿用桌面卡片`,
      );
      assert.equal(
        await page.locator('.zj-workspace-calendar').count(),
        0,
        `${label} 1024px (<1200px) 不得将日历排在岗位列表下方`,
      );

      const tabs1024 = await page
        .locator('.zj-view-nav [data-action="switch-view"]')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.page));
      assert.deepEqual(tabs1024, ['board', 'calendar', 'timeline'], `${label} 1024px 应展示三页导航`);

      await page.locator('.zj-view-nav [data-page="calendar"]').click();
      await page.locator('.zj-calendar-view').waitFor({ timeout: WAIT });
      const cal1024 = page.locator('.zj-calendar-view');
      const day1Month = day1.slice(0, 7);
      const todayMonth = localDateKeyOffset(0).slice(0, 7);
      if (day1Month !== todayMonth) {
        await cal1024.locator('[data-action="calendar-next-month"]').click();
      }
      await cal1024.locator(`.zj-cal-cell[data-date="${day1}"]`).click();
      assert.ok(
        (await cal1024.locator('.zj-cal-agenda').textContent())?.includes('中宽科技'),
        `${label} 1024px 独立日历页应可查看并选定中宽科技日程`,
      );

      // 1024px（位于独立日历页）-> 动态切到 1440px（>=1200px）：自动回到带右栏并排日历的桌面看板
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator('.zj-workspace-calendar .zj-calendar-view').waitFor({ timeout: WAIT });
      assert.equal(await shell.getAttribute('data-device'), 'desktop');
      const tabs1440 = await page
        .locator('.zj-view-nav [data-action="switch-view"]')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.page));
      assert.deepEqual(tabs1440, ['board', 'timeline'], `${label} >=1200px 应恢复两页导航并右栏并排日历`);

      // 1440px -> 动态缩回 1024px（<1200px 断点）：右栏消失，立即恢复独立日历入口且仍按桌面渲染
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.locator('.zj-view-nav [data-page="calendar"]').waitFor({ timeout: WAIT });
      assert.equal(await page.locator('.zj-workspace-calendar').count(), 0);
      assert.equal(await shell.getAttribute('data-device'), 'desktop');
      assert.equal(await desktopCard(page, '中宽科技').count(), 1);
      await page.locator('.zj-view-nav [data-page="calendar"]').click();
      await page.locator('.zj-calendar-view').waitFor({ timeout: WAIT });

      // 1024px（位于日历页）-> 动态缩到 390px（<768px 断点）：保持可看日历，设备切换为 mobile
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(
        () => document.querySelector('.zj-app-shell')?.getAttribute('data-device') === 'mobile',
        { timeout: WAIT },
      );
      await page.locator('.zj-calendar-view').waitFor({ timeout: WAIT });

      // 390px -> 升回 1024px：设备恢复 desktop，日历仍可访问且返回岗位仍为桌面卡
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.waitForFunction(
        () => document.querySelector('.zj-app-shell')?.getAttribute('data-device') === 'desktop',
        { timeout: WAIT },
      );
      await page.locator('.zj-calendar-view').waitFor({ timeout: WAIT });
      await page.locator('[data-action="back-to-board"]').click();
      await desktopCard(page, '中宽科技').waitFor({ timeout: WAIT });

      assert.equal(errors.length, 0);
    } finally {
      await context.close();
    }
  }
}

describe('view-job-schedule 跨适配器实时同步集成验收', () => {
  describe('IndexedDB 适配器', () => {
    let idbBoard: IdbBoard;
    before(async () => {
      idbBoard = await startIdbBoard();
    });
    after(async () => {
      await idbBoard?.close();
    });

    it('改期、已面、撤回、结束/恢复、冲突重读与手机三页往返全程一致', async () => {
      await runScheduleSyncSuite(idbBoard, 'IndexedDB');
    });
  });

  describe('Sites / D1 适配器', () => {
    let sitesBoard: SitesBoard;
    before(async () => {
      sitesBoard = await startSitesBoard();
    });
    after(async () => {
      await sitesBoard?.close();
    });
    beforeEach(async () => {
      await sitesBoard?.resetD1();
    });

    it('真实 Worker + D1 同步改期、已面、撤回、结束/恢复、冲突重读与手机三页往返', async () => {
      await runScheduleSyncSuite(sitesBoard, 'Sites/D1');
    });
  });
});
