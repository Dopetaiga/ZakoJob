/** 真实浏览器（Playwright msedge + Vite preview）正式页面与 IndexedDB 端到端联调测试。 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from '@playwright/test';
import { build, preview, type PreviewServer } from 'vite';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
let outDir: string;

let server: PreviewServer;
let browser: Browser;
let baseUrl = '';

async function createIsolatedPage(
  viewport = { width: 1280, height: 860 },
): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page; errors: string[] }> {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { context, page, errors };
}

describe('正式页面 + IndexedDB 真实浏览器集成验收', () => {
  before(async () => {
    outDir = await fs.mkdtemp(path.join(tmpdir(), 'zako-workspace-test-'));
    await build({
      root: ROOT_DIR,
      logLevel: 'silent',
      build: { outDir },
    });
    server = await preview({
      root: ROOT_DIR,
      build: { outDir },
      preview: { port: 0, host: '127.0.0.1' },
    });
    baseUrl = server.resolvedUrls!.local[0]!;
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  });

  after(async () => {
    await browser?.close();
    server?.httpServer?.close();
    if (outDir) await fs.rm(outDir, { recursive: true, force: true });
  });

  it('完整用户流程：空板起步、建档加星补资料、二面时间与已面视觉、改旧/撤回、结果与恢复、分端布局、备份导入导出', async () => {
    const { context, page, errors } = await createIsolatedPage();
    try {
      // 1. 正式 / 初始无样例零记录 + MiSans 加载确认
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: '还没有记录岗位' }).waitFor();
      assert.equal(await page.locator('.zj-jobs-section .zj-section-count').textContent(), '0 份申请');
      assert.equal(await page.locator('.zj-desktop-card').count(), 0);
      const fontReady = await page.evaluate(async () => {
        await document.fonts.ready;
        return document.fonts.check('600 16px "MiSans VF"');
      });
      assert.equal(fontReady, true, 'MiSans VF 应在正式页面成功加载');

      // 2. 只贴链接建档 → 加星 → 补充资料（保留原链接）
      await page.getByRole('button', { name: '添加岗位' }).first().click();
      const jobDialog = page.locator('dialog[open]');
      await jobDialog.getByLabel('招聘链接（http / https）').fill('https://jobs.example.com/p/42');
      await jobDialog.getByRole('button', { name: '添加' }).click();

      const card = page.locator('.zj-desktop-card').first();
      await card.waitFor();
      assert.ok((await card.textContent())?.includes('jobs.example.com/p/42'));
      assert.ok((await card.textContent())?.includes('尚未登记进展'));

      await card.getByRole('button', { name: /星标/ }).click();
      assert.equal(
        await card.getByRole('button', { name: /取消星标/ }).getAttribute('aria-pressed'),
        'true',
      );

      await card.getByRole('button', { name: /补资料/ }).click();
      await jobDialog.getByLabel('公司').fill('青禾科技');
      await jobDialog.getByLabel('职位').fill('后端开发实习生');
      await jobDialog.getByLabel('地点（可选）').fill('北京');
      await jobDialog.getByLabel('薪资（可选）').fill('300 元/天');
      await jobDialog.getByRole('button', { name: '保存' }).click();

      await page.getByRole('heading', { name: '青禾科技' }).waitFor();
      assert.ok((await card.textContent())?.includes('后端开发实习生'));
      assert.ok((await card.textContent())?.includes('北京 · 300 元/天'));
      assert.equal(
        await card.locator('a[href="https://jobs.example.com/p/42"]').count(),
        1,
        '补充资料后原链接仍须可打开',
      );

      // 3. 经「其他进展」手选二面含时间 → 刷新验证持久化 → 直达「二面已面」与降字重视觉
      await card.getByRole('button', { name: /更多操作/ }).click();
      await page.getByRole('button', { name: '登记其他进展' }).click();
      const stepDialog = page.locator('dialog[open]');
      await stepDialog.getByLabel('环节类型').selectOption('interview');
      await stepDialog.getByLabel('面试轮次').selectOption('二面');
      await stepDialog.getByLabel('日期（可选）').fill('2026-11-27');
      await stepDialog.getByLabel('时间（可选）').fill('15:00');
      await stepDialog.getByRole('button', { name: '登记' }).click();

      const pendingTime = card.locator('strong.zj-step-time');
      await pendingTime.waitFor();
      assert.ok((await pendingTime.textContent())?.includes('11月27日 周五 15:00'));
      const pendingWeight = await pendingTime.evaluate((el) =>
        Number(getComputedStyle(el).fontWeight),
      );
      assert.ok(pendingWeight >= 600, `待面试时间应加粗，实际 fontWeight=${pendingWeight}`);

      // 近期安排出现
      const agenda = page.locator('.zj-agenda-section');
      assert.ok((await agenda.textContent())?.includes('青禾科技 · 二面'));

      // 刷新页面从 IndexedDB 读回
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: '青禾科技' }).waitFor();
      assert.ok((await page.locator('.zj-agenda-section').textContent())?.includes('青禾科技 · 二面'));

      // 标记二面已面：保留原时间并降低字重，移出近期安排（状态直达按钮）
      await card.getByRole('button', { name: '二面已面' }).click();
      const pastTime = card.locator('span.zj-step-time.is-past');
      await pastTime.waitFor();
      assert.ok((await pastTime.textContent())?.includes('11月27日 周五 15:00'));
      const pastWeight = await pastTime.evaluate((el) =>
        Number(getComputedStyle(el).fontWeight),
      );
      assert.ok(pastWeight < pendingWeight, `已面时间应降低字重，${pastWeight} < ${pendingWeight}`);
      assert.ok((await agenda.textContent())?.includes('暂无安排'));

      // 4. 经「其他进展」追加书面 Offer（仅填日期，不补 00:00）→ 改旧节点二面 → 撤回末步 Offer
      await card.getByRole('button', { name: /更多操作/ }).click();
      await page.getByRole('button', { name: '登记其他进展' }).click();
      await stepDialog.getByLabel('环节类型').selectOption('written_offer');
      await stepDialog.getByLabel('日期（可选）').fill('2026-12-05');
      await stepDialog.getByRole('button', { name: '登记' }).click();

      await card.locator('.zj-step.is-offer').waitFor();
      const offerText = await card.locator('.zj-step.is-offer').textContent();
      assert.ok(offerText?.includes('答复截至 12月5日 周六'));
      assert.ok(!offerText?.includes('00:00'), '仅日期不得补出 00:00');
      assert.ok((await agenda.textContent())?.includes('答复截至'));

      // 编辑早期节点「二面」：必须明示节点并保留后续 Offer
      await card.getByRole('button', { name: /编辑二面/ }).click();
      assert.ok(
        (await stepDialog.locator('.zj-step-context-banner').textContent())?.includes('二面 · 已面'),
      );
      await stepDialog.getByLabel('日期（可选）').fill('2026-11-28');
      await stepDialog.getByLabel('时间（可选）').fill('');
      await stepDialog.getByRole('button', { name: '保存修改' }).click();
      await card.getByText('11月28日 周六').waitFor();
      assert.ok((await card.textContent())?.includes('书面 Offer'));

      // 5. 经「更多」菜单的申请结果组登记已拒（移出近期安排）→ 卡面「更正结果」改为已挂 → 直达恢复跟进（近期安排恢复）
      await card.getByRole('button', { name: /更多操作/ }).click();
      await page.getByRole('button', { name: '已拒，我主动拒绝' }).click();
      await card.locator('.zj-result-badge', { hasText: '已拒' }).waitFor();
      await agenda.getByText('暂无安排').waitFor();

      await card.getByRole('button', { name: '更正结果' }).click();
      await page.getByRole('button', { name: '已挂，招聘方结束' }).click();
      await card.locator('.zj-result-badge', { hasText: '已挂' }).waitFor();

      await card.getByRole('button', { name: '恢复跟进' }).click();
      await card.locator('.zj-result-badge').waitFor({ state: 'detached' });
      await agenda.getByText('12月5日 周六').waitFor();

      // 撤回末步书面 Offer，回到二面（末节点编辑面板内撤回）
      await card.getByRole('button', { name: /编辑书面 Offer/ }).click();
      await page.getByRole('button', { name: /撤回末步/ }).click();
      await card.locator('.zj-step.is-offer').waitFor({ state: 'detached' });

      // 6. 分端布局偏好：共用保持「岗位进展在先」，手机专属改为「近期安排在先」
      await page.getByRole('button', { name: '设置' }).click();
      const settingsDialog = page.locator('dialog[open]');
      await settingsDialog.getByRole('button', { name: '手机专属' }).click();
      await settingsDialog.getByRole('button', { name: '岗位进展下移' }).click();
      await settingsDialog.getByRole('button', { name: '恢复沿用共用布局' }).waitFor();
      await settingsDialog.getByRole('button', { name: '完成' }).click();

      // 桌面端仍保持岗位进展在先且无横向溢出
      const desktopOrder = await page
        .locator('.zj-app-modules > section')
        .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      assert.deepEqual(desktopOrder, ['岗位进展', '近期安排']);
      const desktopOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      assert.equal(desktopOverflow, false, '桌面视口不得出现横向溢出');

      // 切至手机视口：应用手机专属顺序 + 验证 A/B 双候选交互切换 + 验证更新菜单可编辑已有进展岗位的资料
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('.zj-mobile-card').first().waitFor();
      const mobileOrder = await page
        .locator('.zj-app-modules > section')
        .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      assert.deepEqual(mobileOrder, ['近期安排', '岗位进展']);

      // 回归验证：手机端已有进展的岗位仍可通过「更多」菜单进入编辑岗位资料
      const mobileCard = page.locator('.zj-mobile-card').first();
      await mobileCard.waitFor();
      await mobileCard.getByRole('button', { name: /更多操作/ }).click();
      // 手机正式页面用底部面板承载更多菜单，菜单项在背幕内
      await page.locator('.zj-menu-sheet-backdrop').getByRole('button', { name: '编辑岗位资料' }).click();
      await jobDialog.waitFor();
      assert.equal(
        await jobDialog.getByLabel('公司').inputValue(),
        '青禾科技',
        '手机菜单应能打开当前岗位的编辑岗位资料弹窗',
      );
      await jobDialog.getByRole('button', { name: '取消' }).click();

      await mobileCard.locator('.zj-timeline-wrap').waitFor();
      const mobileOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      assert.equal(mobileOverflow, false, '手机视口不得出现横向溢出');

      // 7. 导出 JSON → 非空看板拒绝导入 → 新空板恢复完整数据与分端布局
      await page.setViewportSize({ width: 1280, height: 860 });
      await page.getByRole('button', { name: '设置' }).click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        settingsDialog.getByRole('button', { name: '导出备份' }).click(),
      ]);
      const backupPath = await download.path();
      assert.ok(backupPath);
      const backupRaw = await fs.readFile(backupPath, 'utf8');
      const parsed = JSON.parse(backupRaw);
      assert.equal(parsed.applications.length, 1);

      // 非空板拒绝导入
      const fileChooserPromise = page.waitForEvent('filechooser');
      await settingsDialog.getByRole('button', { name: '从文件导入' }).click();
      const chooser1 = await fileChooserPromise;
      await chooser1.setFiles(backupPath);
      await settingsDialog.getByRole('alert').waitFor();
      assert.ok((await settingsDialog.getByRole('alert').textContent())?.includes('已有'));
      await settingsDialog.getByRole('button', { name: '完成' }).click();

      // 新空板上下文恢复备份
      const fresh = await createIsolatedPage({ width: 390, height: 844 });
      try {
        await fresh.page.goto(baseUrl, { waitUntil: 'networkidle' });
        await fresh.page.getByRole('heading', { name: '还没有记录岗位' }).waitFor();
        await fresh.page.getByRole('button', { name: '设置' }).click();
        const freshSettings = fresh.page.locator('dialog[open]');
        const fc2 = fresh.page.waitForEvent('filechooser');
        await freshSettings.getByRole('button', { name: '从文件导入' }).click();
        await (await fc2).setFiles(backupPath);
        await freshSettings.locator('.zj-settings-note').waitFor();
        await freshSettings.getByRole('button', { name: '完成' }).click();

        await fresh.page.getByRole('heading', { name: '青禾科技' }).waitFor();
        const restoredOrder = await fresh.page
          .locator('.zj-app-modules > section')
          .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
        assert.deepEqual(restoredOrder, ['近期安排', '岗位进展'], '恢复后应保留手机专属顺序');
        assert.equal(fresh.errors.length, 0);
      } finally {
        await fresh.context.close();
      }

      assert.equal(errors.length, 0);
    } finally {
      await context.close();
    }
  });

  it('双标签并发过时请求冲突检测，以及已打开页面断网后本地写入与重读', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    const errors: string[] = [];
    tabA.on('pageerror', (e) => errors.push(e.message));
    tabB.on('pageerror', (e) => errors.push(e.message));

    try {
      // Tab A 建档并登记二面
      await tabA.goto(baseUrl, { waitUntil: 'networkidle' });
      await tabA.getByRole('button', { name: '添加岗位' }).first().click();
      const dA = tabA.locator('dialog[open]');
      await dA.getByLabel('公司').fill('栖原软件');
      await dA.getByLabel('职位').fill('平台工程师');
      await dA.getByRole('button', { name: '添加' }).click();

      const cardA = tabA.locator('.zj-desktop-card').first();
      await cardA.getByRole('button', { name: /更多操作/ }).click();
      await tabA.getByRole('button', { name: '登记其他进展' }).click();
      await tabA.locator('dialog[open]').getByLabel('面试轮次').selectOption('二面');
      await tabA.locator('dialog[open]').getByRole('button', { name: '登记' }).click();
      await cardA.locator('.zj-step-title', { hasText: '二面' }).waitFor();

      // Tab B 同步打开同一看板，此时看到版本 2（二面）
      await tabB.goto(baseUrl, { waitUntil: 'networkidle' });
      const cardB = tabB.locator('.zj-desktop-card').first();
      await cardB.locator('.zj-step-title', { hasText: '二面' }).waitFor();

      // Tab A 再新增三面（版本升为 3）
      await cardA.getByRole('button', { name: /更多操作/ }).click();
      await tabA.getByRole('button', { name: '登记其他进展' }).click();
      await tabA.locator('dialog[open]').getByLabel('面试轮次').selectOption('三面');
      await tabA.locator('dialog[open]').getByRole('button', { name: '登记' }).click();
      await cardA.locator('.zj-step-title', { hasText: '三面' }).waitFor();

      // Tab B 仍以旧版本经末节点编辑面板请求撤回二面 → 必须提示冲突且保留三面
      await cardB.getByRole('button', { name: /编辑二面/ }).click();
      await tabB.getByRole('button', { name: /撤回末步/ }).click();
      const bannerB = tabB.locator('.zj-feedback-banner[data-tone="conflict"]');
      await bannerB.waitFor();

      // 冲突时末节点编辑面板按设计保持打开（原生 dialog），先经 .zj-dialog 的「取消」关闭再操作横幅
      await tabB.locator('dialog[open].zj-dialog').getByRole('button', { name: '取消' }).click();
      // 点击「刷新查看」：重读到二面与三面，同时冲突提示保留直到关闭
      await bannerB.getByRole('button', { name: '刷新查看' }).click();
      await cardB.locator('.zj-step-title', { hasText: '三面' }).waitFor();
      assert.equal(await bannerB.isVisible(), true, '主动刷新后应保留未关闭的冲突提示');
      await bannerB.getByRole('button', { name: '关闭提示' }).click();
      assert.equal(await bannerB.isVisible(), false);

      // 已打开页面断网（离线）本地写入并重读
      await context.setOffline(true);
      await tabA.getByRole('button', { name: '添加岗位' }).first().click();
      const offlineDialog = tabA.locator('dialog[open]');
      await offlineDialog.getByLabel('招聘链接（http / https）').fill('https://offline.example.com/job/9');
      await offlineDialog.getByRole('button', { name: '添加' }).click();
      await tabA.getByText('offline.example.com/job/9').waitFor();

      await context.setOffline(false);
      await tabA.reload({ waitUntil: 'networkidle' });
      await tabA.getByText('offline.example.com/job/9').waitFor();
      assert.equal(errors.length, 0);
    } finally {
      await context.close();
    }
  });

  it('补齐实测：公司＋职位建档、双岗位加星还原排序、笔试派生/完成、一面直达OC撤回保留星标、改早期一面仍显二面、恢复共用与隐藏模块', async () => {
    const { context, page, errors } = await createIsolatedPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: '还没有记录岗位' }).waitFor();

      // 1. 用公司＋职位直接建档（不填链接）并录入第二份岗位
      await page.getByRole('button', { name: '添加岗位' }).first().click();
      const jobDialog = page.locator('dialog[open]');
      await jobDialog.getByLabel('公司').fill('星河数科');
      await jobDialog.getByLabel('职位').fill('全栈工程师');
      await jobDialog.getByRole('button', { name: '添加' }).click();

      const starRiverCard = page.locator('.zj-desktop-card[aria-label="星河数科"]');
      await starRiverCard.waitFor();
      assert.ok((await starRiverCard.textContent())?.includes('全栈工程师'));
      assert.equal(await starRiverCard.locator('a').count(), 0, '无链接建档不应生成外链');

      await page.getByRole('button', { name: '添加岗位' }).first().click();
      await jobDialog.getByLabel('公司').fill('极光云');
      await jobDialog.getByLabel('职位').fill('前端工程师');
      await jobDialog.getByRole('button', { name: '添加' }).click();

      const auroraCard = page.locator('.zj-desktop-card[aria-label="极光云"]');
      await auroraCard.waitFor();

      // 2. 两份岗位加星再取消，验证普通组顺序
      const unstarredOrder = await page
        .locator('.zj-desktop-card')
        .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      assert.equal(unstarredOrder.length, 2);
      const [firstName, secondName] = unstarredOrder as [string, string];
      const firstCard = page.locator(`.zj-desktop-card[aria-label="${firstName}"]`);
      const secondCard = page.locator(`.zj-desktop-card[aria-label="${secondName}"]`);

      await secondCard.locator('button[data-action="toggle-star"][aria-pressed="false"]').click();
      await secondCard.locator('button[data-action="toggle-star"][aria-pressed="true"]').waitFor();
      assert.deepEqual(
        await page
          .locator('.zj-desktop-card')
          .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
        [secondName, firstName],
        '第二份岗位加星后应置顶到第一位',
      );

      await firstCard.locator('button[data-action="toggle-star"][aria-pressed="false"]').click();
      await firstCard.locator('button[data-action="toggle-star"][aria-pressed="true"]').waitFor();
      assert.equal(
        await firstCard.locator('button[data-action="toggle-star"]').getAttribute('aria-pressed'),
        'true',
      );
      assert.equal(
        await secondCard.locator('button[data-action="toggle-star"]').getAttribute('aria-pressed'),
        'true',
      );

      await secondCard.locator('button[data-action="toggle-star"][aria-pressed="true"]').click();
      await secondCard.locator('button[data-action="toggle-star"][aria-pressed="false"]').waitFor();
      assert.deepEqual(
        await page
          .locator('.zj-desktop-card')
          .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
        [firstName, secondName],
        '取消其中一份星标后应回落到普通组',
      );

      await firstCard.locator('button[data-action="toggle-star"][aria-pressed="true"]').click();
      await firstCard.locator('button[data-action="toggle-star"][aria-pressed="false"]').waitFor();
      assert.deepEqual(
        await page
          .locator('.zj-desktop-card')
          .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
        unstarredOrder,
        '两份岗位均取消星标后应恢复普通组顺序',
      );

      // 3. 笔试截止派生到近期安排、标记完成后消失
      await starRiverCard.getByRole('button', { name: /更多操作/ }).click();
      await page.getByRole('button', { name: '登记其他进展' }).click();
      const stepDialog = page.locator('dialog[open]');
      await stepDialog.getByLabel('环节类型').selectOption('assessment');
      await stepDialog.getByLabel('日期（可选）').fill('2026-12-02');
      await stepDialog.getByLabel('时间（可选）').fill('19:30');
      await stepDialog.getByRole('button', { name: '登记' }).click();

      const agenda = page.locator('.zj-agenda-section');
      await agenda.getByText('星河数科 · 笔试 / 测评').waitFor();
      const agendaText = (await agenda.textContent()) ?? '';
      assert.ok(agendaText.includes('笔试截止'));
      assert.ok(agendaText.includes('12月2日 周三 19:30'));

      await starRiverCard.getByRole('button', { name: '笔试已完成' }).click();
      await starRiverCard.locator('.zj-step-title', { hasText: '已完成' }).waitFor();
      await agenda.getByText('暂无安排').waitFor();

      // 4. 极光云加星后：一面 → 直接登记 OC → 连续撤回到空仍保留岗位星标
      await auroraCard.locator('button[data-action="toggle-star"][aria-pressed="false"]').click();
      await auroraCard.locator('button[data-action="toggle-star"][aria-pressed="true"]').waitFor();
      assert.equal(
        await auroraCard.locator('button[data-action="toggle-star"]').getAttribute('aria-pressed'),
        'true',
      );

      await auroraCard.getByRole('button', { name: /更多操作/ }).click();
      await page.getByRole('button', { name: '登记其他进展' }).click();
      await stepDialog.getByLabel('环节类型').selectOption('interview');
      await stepDialog.getByLabel('面试轮次').selectOption('一面');
      await stepDialog.getByRole('button', { name: '登记' }).click();
      await auroraCard.locator('.zj-step-title', { hasText: '一面' }).waitFor();

      await auroraCard.getByRole('button', { name: /更多操作/ }).click();
      await page.getByRole('button', { name: '登记其他进展' }).click();
      await stepDialog.getByLabel('环节类型').selectOption('oc');
      await stepDialog.getByRole('button', { name: '登记' }).click();
      await auroraCard.locator('.zj-step.is-offer').waitFor();
      assert.ok((await auroraCard.textContent())?.includes('OC'));

      // 撤回 OC（经末节点操作面板）
      await auroraCard.getByRole('button', { name: /操作OC/ }).click();
      await page.getByRole('button', { name: /撤回末步/ }).click();
      await auroraCard.locator('.zj-step.is-offer').waitFor({ state: 'detached' });
      await auroraCard.locator('.zj-step-title', { hasText: '一面' }).waitFor();

      // 撤回唯一的一面回到空流程，岗位与星标必须保留
      await auroraCard.getByRole('button', { name: /编辑一面/ }).click();
      await page.getByRole('button', { name: /撤回末步/ }).click();
      await auroraCard.getByText('尚未登记进展').waitFor();
      assert.equal(
        await auroraCard.getByRole('button', { name: /取消星标/ }).getAttribute('aria-pressed'),
        'true',
        '撤回到空流程后仍应保留岗位星标',
      );

      // 5. 修改早期一面后仍显示最新的二面
      await auroraCard.getByRole('button', { name: /更多操作/ }).click();
      await page.getByRole('button', { name: '登记其他进展' }).click();
      await stepDialog.getByLabel('环节类型').selectOption('interview');
      await stepDialog.getByLabel('面试轮次').selectOption('一面');
      await stepDialog.getByLabel('日期（可选）').fill('2026-11-28');
      await stepDialog.getByRole('button', { name: '登记' }).click();

      await auroraCard.getByRole('button', { name: /更多操作/ }).click();
      await page.getByRole('button', { name: '登记其他进展' }).click();
      await stepDialog.getByLabel('环节类型').selectOption('interview');
      await stepDialog.getByLabel('面试轮次').selectOption('二面');
      await stepDialog.getByLabel('日期（可选）').fill('2026-11-30');
      await stepDialog.getByLabel('时间（可选）').fill('14:00');
      await stepDialog.getByRole('button', { name: '登记' }).click();
      await auroraCard.locator('.zj-step-title', { hasText: '二面' }).waitFor();

      await auroraCard.getByRole('button', { name: /编辑一面/ }).click();
      await stepDialog.getByLabel('面试状态').selectOption('completed');
      await stepDialog.getByLabel('日期（可选）').fill('2026-11-29');
      await stepDialog.getByRole('button', { name: '保存修改' }).click();

      await auroraCard.getByText('11月29日 周日').waitFor();
      const auroraSteps = await auroraCard
        .locator('.zj-step-title')
        .evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''));
      assert.equal(auroraSteps[auroraSteps.length - 1]?.startsWith('二面'), true);

      await page.setViewportSize({ width: 390, height: 844 });
      const mobileAurora = page.locator('.zj-mobile-card', { hasText: '极光云' });
      await mobileAurora.waitFor();
      assert.ok(
        (await mobileAurora.locator('.zj-step[data-current]').first().textContent())?.includes('二面'),
        '手机默认视口在修改早期一面后仍应展示最新的二面',
      );
      await page.setViewportSize({ width: 1280, height: 860 });

      // 6. 端布局覆盖后再恢复沿用共用布局
      await page.getByRole('button', { name: '设置' }).click();
      const settingsDialog = page.locator('dialog[open]');
      await settingsDialog.getByRole('button', { name: '手机专属' }).click();
      await settingsDialog.getByRole('button', { name: '岗位进展下移' }).click();
      await settingsDialog.getByRole('button', { name: '恢复沿用共用布局' }).waitFor();
      await settingsDialog.getByRole('button', { name: '完成' }).click();

      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('.zj-mobile-card').first().waitFor();
      assert.deepEqual(
        await page
          .locator('.zj-app-modules > section')
          .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
        ['近期安排', '岗位进展'],
      );

      await page.getByRole('button', { name: '设置' }).click();
      await settingsDialog.getByRole('button', { name: /手机专属/ }).click();
      const resetLayoutBtn = settingsDialog.getByRole('button', { name: '恢复沿用共用布局' });
      await resetLayoutBtn.click();
      await resetLayoutBtn.waitFor({ state: 'detached' });
      await settingsDialog.getByText('已恢复沿用共用布局').waitFor();
      await settingsDialog.getByRole('button', { name: '完成' }).click();

      assert.deepEqual(
        await page
          .locator('.zj-app-modules > section')
          .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
        ['岗位进展', '近期安排'],
        '恢复沿用共用布局后手机端应回到共用顺序',
      );
      await page.reload({ waitUntil: 'networkidle' });
      assert.deepEqual(
        await page
          .locator('.zj-app-modules > section')
          .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
        ['岗位进展', '近期安排'],
      );

      // 7. 隐藏模块并验证刷新持久化
      await page.setViewportSize({ width: 1280, height: 860 });
      await page.getByRole('button', { name: '设置' }).click();
      await settingsDialog.locator('[data-module-id="schedule"] input[type="checkbox"]').uncheck();
      await page.locator('section[aria-label="近期安排"]').waitFor({ state: 'detached' });
      await settingsDialog.getByRole('button', { name: '完成' }).click();

      assert.equal(await page.locator('section[aria-label="近期安排"]').count(), 0);
      await page.locator('section[aria-label="岗位进展"]').waitFor();

      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(
        await page.locator('section[aria-label="近期安排"]').count(),
        0,
        '隐藏的近期安排模块在刷新后应保持隐藏',
      );
      await page.locator('section[aria-label="岗位进展"]').waitFor();
      assert.equal(errors.length, 0);
    } finally {
      await context.close();
    }
  });
});
