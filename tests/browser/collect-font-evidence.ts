// 证据采集脚本：输出 1.1 字体验收的实测值（CDP 平台字型、字重宽度、回退行为）。
// 用法：npx tsx tests/browser/collect-font-evidence.ts
import { chromium } from '@playwright/test';
import { startDemoServer } from './vite-demo-server';
import { getPlatformFonts } from './page-helpers';

const server = await startDemoServer();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(server.demoUrl);
await page.waitForSelector('.zj-desktop-card');
await page.evaluate(() => document.fonts.ready);

const evidence: Record<string, unknown> = {};

// 中文 / 拉丁 / 数字实际字型
for (const [kind, text] of [
  ['zh', '青禾科技拾光数据后端开发实习生二面'],
  ['latin', 'BackendOfferExampleABCabc'],
  ['digits', '012345678915:00'],
] as const) {
  const selector = `[data-evidence-font="${kind}"]`;
  await page.evaluate(
    ([sel, content]) => {
      // 挂在字体核对条内（可见内联布局），避免屏外探针被 Chromium 跳过字形绘制
      const host = document.querySelector('.zj-demo-font-samples');
      const el = document.createElement('span');
      el.dataset.evidenceFont = sel.match(/"([^"]+)"/)?.[1] ?? 'x';
      el.style.cssText = 'white-space:nowrap;';
      el.textContent = content as string;
      host?.append(el);
    },
    [selector, text],
  );
  // 新插入文本需等待字形加载与绘制完成后，CDP 才能读到实际字型
  await page.waitForTimeout(400);
  evidence[`platformFonts.${kind}`] = await getPlatformFonts(page, selector);
}

// 400 / 600 / 650 同文本宽度（可变字重是否逐级生效）
evidence['weightWidths'] = await page.evaluate(() => {
  const out: Record<string, number> = {};
  for (const w of [400, 600, 650]) {
    const el = document.createElement('span');
    el.style.cssText = `position:fixed;left:-9999px;top:0;white-space:nowrap;font-weight:${w};`;
    el.textContent = '青禾科技 Offer 周五 15:00 0123456789';
    document.querySelector('.zj-ui-scope')?.append(el);
    out[String(w)] = Math.round(el.getBoundingClientRect().width * 100) / 100;
    el.remove();
  }
  return out;
});

// 表单控件实际字号
evidence['inputFontSize'] = await page.evaluate(() => {
  const input = document.querySelector<HTMLInputElement>('.zj-demo-sample-input');
  return input ? getComputedStyle(input).fontSize : null;
});
evidence['inputSizeToken'] = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--zj-input-size').trim(),
);

// 阻断字体请求后的实际字型
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const fresh = await context.newPage();
await fresh.route(/\.woff2?(\?|$)/i, (route) => route.abort());
await fresh.goto(server.demoUrl);
await fresh.waitForSelector('.zj-desktop-card');
evidence['blocked.fonts.check MiSans'] = await fresh.evaluate(() =>
  document.fonts.check('600 16px "MiSans VF"'),
);
evidence['blocked.platformFonts.company'] = await getPlatformFonts(
  fresh,
  '.zj-desktop-board .zj-company-name',
);
evidence['blocked.cardIds'] = await fresh
  .locator('.zj-desktop-card')
  .evaluateAll((cards) => cards.map((c) => (c as HTMLElement).dataset.jobId));
await context.close();

console.log(JSON.stringify(evidence, null, 2));
await browser.close();
await server.close();
