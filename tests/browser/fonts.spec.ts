// 1.1 字体验收：MiSans VF 实际渲染（中文/拉丁/数字）、400/600/650 字重、
// 「设置 → 关于」署名、手动回退对照与阻断字体回退后的可读性。
import { test, expect, type Page } from '@playwright/test';
import { startDemoServer, type DemoServer } from './vite-demo-server';
import {
  addFontProbe,
  getPlatformFonts,
  removeFontProbes,
  expectNoHorizontalOverflow,
} from './page-helpers';

let server: DemoServer;
let page: Page;

test.beforeAll(async ({ browser }) => {
  server = await startDemoServer();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});

test.afterAll(async () => {
  await page.close();
  await server.close();
});

const PROBE_TEXT = '青禾科技 Offer Backend 0123456789 周五 15:00';

interface WeightProbe {
  weight: number;
  width: number;
  families: string[];
}

async function collectWeightProbes(): Promise<WeightProbe[]> {
  const probes: WeightProbe[] = [];
  for (const weight of [400, 600, 650]) {
    const selector = `[data-weight-probe="${weight}"]`;
    await page.evaluate<void, [string, number, string]>(
      ([sel, w, text]) => {
        const scope = document.querySelector('.zj-ui-scope');
        if (!scope) throw new Error('找不到 .zj-ui-scope');
        let el = scope.querySelector<HTMLElement>(sel);
        if (!el) {
          el = document.createElement('span');
          el.dataset.weightProbe = String(w);
          // 脱离 flex 流并置于屏外，使宽度等于文本实际宽度；字形仍会渲染供 CDP 读取
          el.style.cssText =
            'position:fixed;left:-9999px;top:0;white-space:nowrap;';
          scope.append(el);
        }
        el.style.fontWeight = String(w);
        el.textContent = text;
      },
      [selector, weight, PROBE_TEXT],
    );
    const width = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`测宽目标不存在：${sel}`);
      return el.getBoundingClientRect().width;
    }, selector);
    const fonts = await getPlatformFonts(page, selector);
    probes.push({ weight, width, families: fonts.families });
  }
  return probes;
}

test.describe('1.1 MiSans VF 字体渲染', () => {
  test.beforeEach(async () => {
    await page.goto(server.demoUrl);
    await expect(page.locator('#demo-app .zj-desktop-card')).toHaveCount(4);
  });

  test('MiSans 栈生效且中文、拉丁、数字实际由 MiSans 渲染', async () => {
    // 计算样式走 MiSans 栈
    const stack = await page
      .locator('.zj-desktop-board .zj-company-name')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(stack).toContain('"MiSans VF"');

    // CDP 实际渲染字体：中文、拉丁字母、数字分别探测
    const cases: Array<['zh' | 'latin' | 'digits', string]> = [
      ['zh', '青禾科技拾光数据面试二面'],
      ['latin', 'BackendOfferExampleABCabc'],
      ['digits', '01234567891500'],
    ];
    try {
      for (const [kind, text] of cases) {
        const selector = await addFontProbe(page, kind, text);
        const fonts = await getPlatformFonts(page, selector);
        expect(fonts.glyphCount, `${kind} 字形数量`).toBeGreaterThan(0);
        expect(
          fonts.families.some((f) => /MiSans/i.test(f)),
          `${kind} 实际字型应为 MiSans，实际：${fonts.families.join(', ')}`,
        ).toBe(true);
      }
    } finally {
      await removeFontProbes(page);
    }
  });

  test('400 / 600 / 650 字重逐级变化且均由 MiSans 渲染', async () => {
    await page.locator('.zj-demo-font-check').scrollIntoViewIfNeeded();
    // 核对条样本的声明字重
    const samples = page.locator('.zj-demo-font-samples > span');
    await expect(samples).toHaveCount(3);
    await expect(samples.nth(0)).toHaveCSS('font-weight', '400');
    await expect(samples.nth(1)).toHaveCSS('font-weight', '600');
    await expect(samples.nth(2)).toHaveCSS('font-weight', '650');
    // 可变字体已注册并支持 650
    await expect
      .poll(() => page.evaluate(() => document.fonts.check('650 16px "MiSans VF"')))
      .toBe(true);

    const probes = await collectWeightProbes();
    await removeFontProbes(page);
    for (const p of probes) {
      expect(
        p.families.some((f) => /MiSans/i.test(f)),
        `${p.weight} 实际字型：${p.families.join(', ')}`,
      ).toBe(true);
    }
    // 同一文本宽度应随字重递增（可变字重真实生效）
    const [w400, w600, w650] = probes.map((p) => p.width);
    expect(w600).toBeGreaterThan(w400);
    expect(w650).toBeGreaterThanOrEqual(w600);
    if (w650 === w600) {
      throw new Error(
        `650 与 600 渲染宽度一致（${w600}px），650 强调字重未产生实际区别`,
      );
    }
  });

  test('表单控件字号与「设置 → 关于」字体署名', async () => {
    const tokenSize = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--zj-input-size').trim(),
    );
    expect(tokenSize).toBe('16px');
    const input = page.locator('.zj-demo-sample-input');
    const actualSize = await input.evaluate((el) => getComputedStyle(el).fontSize);
    expect(actualSize).toBe(tokenSize);
    const inputFonts = await getPlatformFonts(page, '.zj-demo-sample-input');
    expect(inputFonts.families.some((f) => /MiSans/i.test(f))).toBe(true);

    await page.locator('[data-action="open-settings"]').click();
    const dialog = page.locator('dialog.zj-dialog[aria-label="设置"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('MiSans（MiSans VF 5.0.0）');
    await expect(dialog).toContainText('字体版权归小米所有');
    const pkgLink = dialog.locator('a[href*="dsrkafuu/misans"]');
    await expect(pkgLink).toHaveText('misans@5.0.0');
    await expect(
      dialog.locator('a[href="https://hyperos.mi.com/font/faq"]'),
    ).toHaveText('MiSans 官方使用说明');
    await dialog.locator('.zj-btn-primary').click();
    await expect(dialog).not.toBeVisible();
  });

  test('手动切换系统回退字体后仍可读、无溢出', async () => {
    await page.locator('[data-font="fallback"]').click();
    const scope = page.locator('#demo-app .zj-ui-scope').first();
    await expect(scope).toHaveAttribute('data-font-fallback', 'true');
    // appRoot 本身的计算样式确实切到系统回退栈
    const shellStack = await scope.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(shellStack).toContain('"Microsoft YaHei"');
    const cardStack = await page
      .locator('.zj-desktop-board .zj-company-name')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(cardStack).not.toContain('MiSans');
    const fonts = await getPlatformFonts(page, '.zj-desktop-board .zj-company-name');
    expect(fonts.families.length).toBeGreaterThan(0);
    expect(fonts.families.some((f) => /MiSans/i.test(f))).toBe(false);
    // 回退排版下所有文本仍渲染且无横向溢出
    await expect(page.locator('.zj-demo-font-samples')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    // 切回 MiSans
    await page.locator('[data-font="misans"]').click();
    await expect(scope).toHaveAttribute('data-font-fallback', 'false');
    const back = await getPlatformFonts(page, '.zj-desktop-board .zj-company-name');
    expect(back.families.some((f) => /MiSans/i.test(f))).toBe(true);
  });

  test('阻断字体请求：自动回退系统字体，布局与操作仍可用', async ({ browser }) => {
    // 全新上下文，排除先前用例的字体缓存影响
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const fresh = await context.newPage();
    await fresh.route(/\.woff2?(\?|$)/i, (route) => route.abort());
    await fresh.goto(server.demoUrl);
    await expect(fresh.locator('#demo-app .zj-desktop-card')).toHaveCount(4);
    await expect
      .poll(() => fresh.evaluate(() => document.fonts.check('600 16px "MiSans VF"')))
      .toBe(false);
    // 实际渲染字体为系统回退（Windows 上是 Microsoft YaHei）
    const fonts = await getPlatformFonts(fresh, '.zj-desktop-board .zj-company-name');
    expect(fonts.families.join(', ')).not.toMatch(/MiSans/i);
    expect(fonts.families.length).toBeGreaterThan(0);
    // 回退布局下四份样本仍完整、可读、无溢出
    const cardIds = await fresh.locator('#demo-app .zj-desktop-card').evaluateAll(
      (cards) => cards.map((c) => (c as HTMLElement).dataset.jobId),
    );
    expect(cardIds).toEqual(['qinghe', 'qiyuan', 'shiguang', 'link-42']);
    await expect(fresh.locator('.zj-demo-font-samples')).toBeVisible();
    await expectNoHorizontalOverflow(fresh);
    // 关键操作在回退布局下仍可完成：卡面状态推进动作
    const completeBtn = fresh
      .locator('[data-job-id="qinghe"] [data-action="complete-interview"]')
      .first();
    await expect(completeBtn).toBeVisible();
    await expect(completeBtn).toHaveAttribute('data-target-step-id', 'qinghe-s3');
    await expect(completeBtn).toContainText('二面已面');
    await context.close();
  });
});
