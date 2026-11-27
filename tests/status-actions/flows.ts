/**
 * present-job-board 5.3 共享交互流程（轻卡片 eb44edb + 日程 58ad2d4 基线）：
 * 依据 design.md 状态表与 job-board-workspace spec 编写，供 IndexedDB 与 Sites
 * 两条适配器腿共用（同一套公开交互，不重复适配器）。
 *
 * 实际 DOM 约定（依 eb44edb 实现）：
 * - 卡面主动作区 .zj-card-quick-actions：动作名取设计表与轻卡片调整：
 *   「已投递」「收到笔试」「收到面试」「标记笔试已完成」「标记{轮次}已面」
 *   「收到下轮面试」「收到 OC」「收到书面 Offer」「添加答复期限」「恢复跟进」。
 * - 稳定「更多」入口 .zj-more-btn：桌面为挂在看板根部的 .zj-menu.zj-menu-popover，
 *   手机默认卡内 inline（.zj-menu），sheet 模式为 .zj-menu-sheet-backdrop；
 *   菜单含「进展与节点／岗位资料／申请结果」三组，申请结果独立分组。
 * - 「登记其他进展」与节点编辑共用 .zj-dialog（移动端 CSS 贴底），
 *   创建模式含「环节类型」「面试轮次」下拉，提交按钮「登记」／「保存修改」。
 * - 「撤回末步」在末节点编辑对话框内（仅末节点开放）。
 * - 标题旁仅辨识信息不足（缺公司或职位）的卡才有「补资料」高亮入口。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';

const EVIDENCE_DIR = path.join(process.cwd(), 'test-results', 'status-actions');
const WAIT = 8_000;

export async function shot(page: Page | null, name: string): Promise<void> {
  if (!page) return;
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page
    .screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: true })
    .catch(() => {});
}

/** 卡片定位：桌面卡 aria-label 为公司名，手机卡用文本过滤。 */
export function desktopCard(page: Page, company: string): Locator {
  return page.locator(`.zj-desktop-card[aria-label="${company}"]`);
}

export function mobileCard(page: Page, company: string): Locator {
  return page.locator('.zj-mobile-card', { hasText: company });
}

/** 打开中的选择面板：桌面/卡内「更多」菜单（.zj-menu）、原生对话框、手机底部面板背幕。 */
export function activePanel(page: Page): Locator {
  return page.locator('dialog[open], .zj-menu, .zj-menu-sheet-backdrop').first();
}

/** 时间线步骤标题定位（避免 card.getByText 命中按钮等元素触发严格模式）。 */
export function stepTitle(card: Locator, text: string): Locator {
  return card.locator('.zj-step-title', { hasText: text }).first();
}

const CONFIRM_RE = /^(登记|保存修改|保存|确认|确定)$/;

/** 点击后统一收尾：动作直接保存或打开填写面板确认，等待成功反馈。 */
export async function pressAndSettle(
  page: Page,
  button: Locator,
  options: { tone?: string } = {},
): Promise<Locator> {
  await button.first().click({ timeout: WAIT });
  const panel = activePanel(page);
  try {
    await panel.waitFor({ state: 'visible', timeout: 1_500 });
    const confirm = panel.getByRole('button', { name: CONFIRM_RE }).first();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click();
    }
  } catch {
    // 无面板：按钮直接保存
  }
  const banner = page.locator(
    `.zj-feedback-banner[data-tone="${options.tone ?? 'saved'}"]`,
  );
  await banner.waitFor({ timeout: WAIT });
  return banner;
}

/** 断言卡面上按设计表应出现的状态按钮（可访问名整词匹配）。 */
export async function expectStatusButtons(
  card: Locator,
  names: string[],
  label: string,
): Promise<void> {
  for (const name of names) {
    await card
      .getByRole('button', { name: new RegExp(`^${name}$`) })
      .first()
      .waitFor({ timeout: WAIT });
  }
}

export async function expectNoStatusButtons(
  card: Locator,
  names: string[],
  label: string,
): Promise<void> {
  for (const name of names) {
    assert.equal(
      await card.getByRole('button', { name: new RegExp(`^${name}$`) }).count(),
      0,
      `${label} 不应出现「${name}」按钮`,
    );
  }
}

export function stepTitles(card: Locator): Promise<string[]> {
  return card
    .locator('.zj-step-title')
    .evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''));
}

export function stepIds(card: Locator): Promise<(string | undefined)[]> {
  return card
    .locator('.zj-step')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.stepId));
}

/** 点时间线上的某个节点打开其编辑对话框（点哪个节点就编辑哪个）。 */
export async function openStepEditor(
  page: Page,
  card: Locator,
  stepText: string,
): Promise<Locator> {
  const li = card.locator('.zj-step', { hasText: stepText }).first();
  const btn = li.locator('button.zj-step-btn').first();
  if (await btn.count()) {
    await btn.click({ timeout: WAIT });
  } else {
    await li.click({ timeout: WAIT });
  }
  const panel = page.locator('dialog[open].zj-dialog').first();
  await panel.waitFor({ timeout: WAIT });
  return panel;
}

/** 稳定「更多」入口：桌面打开看板根部 popover，返回页面级 .zj-menu。 */
export async function openMoreMenu(page: Page, card: Locator): Promise<Locator> {
  await card
    .locator('[data-action="open-more-menu"]')
    .first()
    .click({ timeout: WAIT });
  const menu = page.locator('.zj-menu').first();
  await menu.waitFor({ timeout: WAIT });
  return menu;
}

async function closeMoreMenu(page: Page, menu: Locator): Promise<void> {
  const close = menu.locator('[data-action="close-menu"]');
  if (await close.isVisible().catch(() => false)) {
    await close.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await menu.waitFor({ state: 'detached', timeout: WAIT });
}

/** 次要入口「登记其他进展」：打开 .zj-dialog（创建模式，含环节类型/面试轮次）。 */
export async function openOtherProgress(page: Page): Promise<Locator> {
  const trigger = page.locator('[data-action="other-progress"]').first();
  if (await trigger.count()) {
    await trigger.click({ timeout: WAIT });
  } else {
    // 旧入口兜底：更多菜单内
    const more = page.locator('[data-action="open-more-menu"]').first();
    await more.click({ timeout: WAIT });
    const menu = page.locator('.zj-menu').first();
    await menu.waitFor({ timeout: WAIT });
    await menu.locator('[data-action="other-progress"]').click({ timeout: WAIT });
  }
  const panel = page.locator('dialog[open].zj-dialog').first();
  await panel.waitFor({ timeout: WAIT });
  return panel;
}

/** 经「登记其他进展」直接登记指定轮次（跳步，如收藏后直接登记二面）。 */
export async function registerRoundViaOtherProgress(
  page: Page,
  round: string,
): Promise<void> {
  const panel = await openOtherProgress(page);
  await panel.getByLabel('环节类型').selectOption('interview');
  await panel.getByLabel('面试轮次').selectOption({ label: round });
  await panel.getByRole('button', { name: '登记' }).click();
  await page
    .locator('.zj-feedback-banner[data-tone="saved"]')
    .waitFor({ timeout: WAIT });
}

/** 「更多 → 申请结果」分组：独立选择已挂（招聘方结束）或已拒（本人拒绝）。 */
export async function recordOutcome(
  page: Page,
  card: Locator,
  kind: '已挂' | '已拒',
): Promise<void> {
  const nameRe = kind === '已挂' ? /招聘方结束/ : /我主动拒绝/;
  const menu = await openMoreMenu(page, card);
  const groupLabel = menu.locator('.zj-menu-group-label', { hasText: '申请结果' });
  assert.equal(
    await groupLabel.count(),
    1,
    '「更多」菜单应有独立的「申请结果」分组',
  );
  await menu.getByRole('button', { name: nameRe }).click({ timeout: WAIT });
  await page
    .locator('.zj-feedback-banner[data-tone="saved"]')
    .waitFor({ timeout: WAIT });
}

/** 已挂/已拒之后清除结果（卡面「恢复跟进」按钮）。 */
export async function clearOutcome(page: Page, card: Locator): Promise<void> {
  await pressAndSettle(page, card.getByRole('button', { name: /^恢复跟进$/ }));
}

/** 撤回仅对末节点开放：点末节点打开对话框，用其中的「撤回末步」。 */
export async function withdrawLastStep(
  page: Page,
  card: Locator,
  options: { tone?: 'saved' | 'conflict' } = {},
): Promise<void> {
  const lastBtn = card.locator('.zj-step').last().locator('button.zj-step-btn').first();
  await lastBtn.click({ timeout: WAIT });
  const dialog = page.locator('dialog[open].zj-dialog').first();
  await dialog.waitFor({ timeout: WAIT });
  const withdraw = dialog.locator('button[data-action="withdraw-step"]');
  await withdraw.waitFor({ state: 'visible', timeout: WAIT });
  await withdraw.click();
  const tone = options.tone ?? 'saved';
  await page.locator(`.zj-feedback-banner[data-tone="${tone}"]`).waitFor({ timeout: WAIT });
}

/** 断言指定（非末）节点的编辑对话框不提供「撤回末步」。 */
export async function expectWithdrawHiddenFor(
  page: Page,
  card: Locator,
  stepText: string,
  label: string,
): Promise<void> {
  const dialog = await openStepEditor(page, card, stepText);
  assert.equal(
    await dialog.locator('button[data-action="withdraw-step"]').isVisible(),
    false,
    `${label} 非末节点不得提供撤回`,
  );
  await dialog.getByRole('button', { name: '取消' }).click();
  await dialog.waitFor({ state: 'detached', timeout: WAIT });
}

/** 标题旁「补资料」（仅辨识信息不足的卡）：编辑资料不得新增进展。 */
export async function editProfileFromTitle(
  page: Page,
  card: Locator,
  fill: (panel: Locator) => Promise<void>,
): Promise<void> {
  await card
    .getByRole('button', { name: /^补资料/ })
    .first()
    .click({ timeout: WAIT });
  const panel = page.locator('dialog[open].zj-dialog').first();
  await panel.waitFor({ timeout: WAIT });
  await fill(panel);
  await panel.getByRole('button', { name: CONFIRM_RE }).first().click();
  await page.locator('.zj-feedback-banner[data-tone="saved"]').waitFor({ timeout: WAIT });
}

/** 把横向时间线滑到最早一端（回看历史）。 */
export async function scrollTimelineToEarliest(card: Locator): Promise<number> {
  return card
    .locator('.zj-timeline-wrap')
    .first()
    .evaluate(async (wrap) => {
      const el = wrap as HTMLElement;
      el.scrollLeft = -(el.scrollWidth - el.clientWidth);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return el.scrollLeft;
    });
}

/** 时间线是否可横向滚动（内容溢出可视区）。 */
export async function isTimelineScrollable(card: Locator): Promise<boolean> {
  return card
    .locator('.zj-timeline-wrap')
    .first()
    .evaluate((el) => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth);
}

/**
 * 5.3 主旅程（桌面视口）：按设计表逐行推进全部状态。
 * 含节点更正（只更正该节点）、回看旧节点后推进最新节点、
 * 「更多 → 申请结果」结束申请、更正结果、清除恢复、逐个撤回与重读后节点稳定。
 */
export async function runStatusJourney(page: Page, company: string): Promise<void> {
  const label = `状态旅程(${company})`;
  await page.getByRole('button', { name: '添加岗位' }).first().click();
  const jobDialog = page.locator('dialog[open]');
  await jobDialog.getByLabel('公司').fill(company);
  await jobDialog.getByLabel('职位').fill('测试工程师');
  await jobDialog.getByRole('button', { name: '添加' }).click();

  const card = desktopCard(page, company);
  await card.waitFor();
  await card.getByRole('button', { name: /星标/ }).click();
  await card.getByRole('button', { name: /取消星标/ }).waitFor({ timeout: WAIT });

  // 设计表：收藏，尚无节点 → 已投递；有公司+职位的卡不得出现「补资料」高亮
  await expectStatusButtons(card, ['已投递'], `${label} 收藏无节点`);
  assert.equal(
    await card.getByRole('button', { name: /^补资料/ }).count(),
    0,
    `${label} 已有公司+职位的卡不应出现「补资料」`,
  );

  // 已投递 → 收到笔试、收到面试
  await pressAndSettle(page, card.getByRole('button', { name: /^已投递$/ }));
  await expectStatusButtons(card, ['收到笔试', '收到面试'], `${label} 已投递`);
  await expectNoStatusButtons(card, ['已投递'], label);

  // 笔试待完成 → 标记笔试已完成
  await pressAndSettle(page, card.getByRole('button', { name: /^收到笔试$/ }));
  await expectStatusButtons(card, ['标记笔试已完成'], `${label} 笔试待完成`);

  // 笔试已完成 → 收到面试
  await pressAndSettle(page, card.getByRole('button', { name: /^标记笔试已完成$/ }));
  await expectStatusButtons(card, ['收到面试'], `${label} 笔试已完成`);

  // 收到通知时尚未确定时间：点「收到面试」保存面试节点且时间留空
  const idsBeforeInterview = await stepIds(card);
  await pressAndSettle(page, card.getByRole('button', { name: /^收到面试$/ }));
  assert.deepEqual(
    await stepTitles(card),
    ['已投递', '笔试 / 测评 · 已完成', '一面 · 待面试'],
    `${label} 收到面试应保存一个待面试节点（轮次取可更正初值）`,
  );
  assert.equal(
    (await stepIds(card)).length,
    idsBeforeInterview.length + 1,
    `${label} 收到面试只新增一个节点`,
  );
  await expectStatusButtons(card, ['标记一面已面'], `${label} 本轮待面试（动作名明确）`);

  // 点该节点补录时间，只更正该节点，节点 ID 稳定
  const editor = await openStepEditor(page, card, '一面');
  assert.ok(
    (await editor.locator('.zj-step-context-banner').textContent())?.includes('一面'),
    `${label} 节点编辑面板应标明目标节点`,
  );
  await editor.getByLabel('日期（可选）').fill('2026-12-01');
  await editor.getByLabel('时间（可选）').fill('09:30');
  await editor.getByRole('button', { name: '保存修改' }).click();
  const pendingTime = card.locator('strong.zj-step-time');
  await pendingTime.waitFor({ timeout: WAIT });
  assert.ok(
    (await pendingTime.textContent())?.includes('12月1日 周二 09:30'),
    `${label} 补录的时间应整体加粗展示`,
  );
  const idsAfterEdit = await stepIds(card);
  assert.deepEqual(
    idsAfterEdit,
    [...idsBeforeInterview, idsAfterEdit[idsAfterEdit.length - 1]],
    `${label} 补录时间不得改变任何节点 ID`,
  );

  // 本轮已面 → 收到下轮面试、收到 OC（预测下阶段动作）
  await pressAndSettle(page, card.getByRole('button', { name: /^标记一面已面$/ }));
  await expectStatusButtons(
    card,
    ['收到下轮面试', '收到 OC'],
    `${label} 本轮已面`,
  );
  const pastTime = card.locator('span.zj-step-time.is-past');
  await pastTime.waitFor({ timeout: WAIT });
  assert.ok(
    (await pastTime.textContent())?.includes('12月1日 周二 09:30'),
    `${label} 已面后时间保留并降低字重`,
  );

  // 回看旧节点后再推进：把时间线滑到最早，再点「标记二面已面」仍指向最新二面
  await pressAndSettle(page, card.getByRole('button', { name: /^收到下轮面试$/ }));
  await expectStatusButtons(card, ['标记二面已面'], `${label} 二面待面试`);
  await scrollTimelineToEarliest(card);
  await pressAndSettle(page, card.getByRole('button', { name: /^标记二面已面$/ }));
  assert.deepEqual(
    await stepTitles(card),
    ['已投递', '笔试 / 测评 · 已完成', '一面 · 已面', '二面 · 已面'],
    `${label} 回看旧节点后推进必须仍作用于最新二面`,
  );

  // OC → 收到书面 Offer
  await pressAndSettle(page, card.getByRole('button', { name: /^收到 OC$/ }));
  await expectStatusButtons(card, ['收到书面 Offer'], `${label} OC`);

  // 书面 Offer → 「添加答复期限」动作 + 常驻提示小字已清理
  await pressAndSettle(page, card.getByRole('button', { name: /^收到书面 Offer$/ }));
  await expectStatusButtons(card, ['添加答复期限'], `${label} 书面 Offer 无期限`);
  assert.equal(
    (await card.getByText('点 Offer 节点可补答复期限').count()),
    0,
    '常驻解释型小字「点 Offer 节点可补答复期限」应删除',
  );
  await expectNoStatusButtons(
    card,
    ['已投递', '收到笔试', '收到面试', '标记笔试已完成', '收到下轮面试', '收到 OC', '收到书面 Offer'],
    `${label} 书面 Offer`,
  );
  const offerEditor = await openStepEditor(page, card, '书面 Offer');
  await offerEditor.getByLabel('日期（可选）').fill('2026-12-05');
  await offerEditor.getByRole('button', { name: '保存修改' }).click();
  await card.getByText('答复截至 12月5日 周六').first().waitFor({ timeout: WAIT });
  await page
    .locator('.zj-agenda-section')
    .getByText('答复截至')
    .waitFor({ timeout: WAIT });
  // 已设期限后「添加答复期限」动作消失
  await expectNoStatusButtons(card, ['添加答复期限'], `${label} 已设期限`);

  // 「更多 → 申请结果」：已挂 → 结果标签与最后进展同时显示
  await recordOutcome(page, card, '已挂');
  await card
    .locator('.zj-result-badge', { hasText: '已挂' })
    .waitFor({ timeout: WAIT });
  assert.ok(
    (await stepTitle(card, '书面 Offer').textContent())?.includes('书面 Offer'),
    `${label} 已挂后仍可读到最后进展`,
  );

  // 更正为已拒（卡面「更正结果」→ 更多菜单）
  await card
    .getByRole('button', { name: /^更正结果$/ })
    .first()
    .click({ timeout: WAIT });
  const correctMenu = page.locator('.zj-menu').first();
  await correctMenu.waitFor({ timeout: WAIT });
  await correctMenu.getByRole('button', { name: /我主动拒绝/ }).click({ timeout: WAIT });
  await card
    .locator('.zj-result-badge', { hasText: '已拒' })
    .waitFor({ timeout: WAIT });

  // 清除结果恢复跟进（卡面「恢复跟进」）；末节点为已设期限的书面 Offer，无新增事件按钮
  await clearOutcome(page, card);
  await card
    .locator('.zj-result-badge')
    .waitFor({ state: 'detached', timeout: WAIT });
  await expectNoStatusButtons(
    card,
    ['已投递', '收到笔试', '收到面试', '标记笔试已完成', '收到下轮面试', '收到 OC', '收到书面 Offer'],
    `${label} 恢复跟进后按末节点（已设期限 Offer）不提供事件按钮`,
  );

  // 撤回仅对末节点开放：末节点对话框有「撤回末步」，非末节点没有
  await withdrawLastStep(page, card);
  await stepTitle(card, 'OC').waitFor({ timeout: WAIT });
  await expectStatusButtons(card, ['收到书面 Offer'], `${label} 撤回 Offer 后`);

  await withdrawLastStep(page, card);
  // 撤回 OC 后末节点为一面已面：主动作=收到下轮面试＋收到 OC，Offer 走「更多」
  await expectStatusButtons(
    card,
    ['收到下轮面试', '收到 OC'],
    `${label} 撤回 OC 后`,
  );
  await expectNoStatusButtons(
    card,
    ['收到书面 Offer'],
    `${label} 撤回 OC 后 Offer 不再占卡面`,
  );

  // 非末节点（一面）不得提供撤回
  await expectWithdrawHiddenFor(page, card, '一面', label);

  // 「更多」菜单三组齐全（进展与节点／岗位资料／申请结果）
  const menu = await openMoreMenu(page, card);
  for (const groupName of ['进展与节点', '岗位资料', '申请结果']) {
    assert.equal(
      await menu.locator('.zj-menu-group-label', { hasText: groupName }).count(),
      1,
      `${label} 「更多」菜单应有「${groupName}」分组`,
    );
  }
  await closeMoreMenu(page, menu);

  // 重读：刷新后节点 ID 逐个稳定、资料与时间完整
  const idsBeforeReload = await stepIds(card);
  await page.reload({ waitUntil: 'networkidle' });
  await desktopCard(page, company).waitFor({ timeout: WAIT });
  assert.deepEqual(
    await stepIds(desktopCard(page, company)),
    idsBeforeReload,
    `${label} 重读后节点 ID 必须逐个稳定`,
  );
  assert.ok(
    (await desktopCard(page, company).textContent())?.includes('12月1日 周二 09:30'),
    `${label} 重读后一面补录时间仍在`,
  );
}
