// 通用页面操作与 CDP 平台字体探测辅助（仅服务本验收）。
import type { CDPSession, Locator, Page } from '@playwright/test';

export interface PlatformFontsResult {
  families: string[];
  glyphCount: number;
}

/** 通过 CDP CSS.getPlatformFontsForNode 读取节点实际渲染的字体。 */
export async function getPlatformFonts(
  page: Page,
  selector: string,
): Promise<PlatformFontsResult> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument', { depth: -1 });
    if (!root) throw new Error('CDP DOM.getDocument returned no root');
    const { nodeId } = await session.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector,
    });
    if (!nodeId) throw new Error(`CDP 找不到节点：${selector}`);
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', {
      nodeId,
    });
    return {
      families: fonts.map((f) => f.familyName),
      glyphCount: fonts.reduce((sum, f) => sum + f.glyphCount, 0),
    };
  } finally {
    await session.detach().catch(() => {});
  }
}

/** 在 .zj-ui-scope 内注入等宽探测节点（继承 MiSans 栈），返回选择器。 */
export async function addFontProbe(
  page: Page,
  kind: 'zh' | 'latin' | 'digits',
  text: string,
): Promise<string> {
  const selector = `[data-font-probe="${kind}"]`;
  await page.evaluate(
    ([sel, content]) => {
      const scope = document.querySelector('.zj-ui-scope');
      if (!scope) throw new Error('找不到 .zj-ui-scope');
      let probe = scope.querySelector<HTMLElement>(sel);
      if (!probe) {
        probe = document.createElement('span');
        const key = (sel.match(/"([^"]+)"/) ?? [])[1] ?? 'probe';
        probe.dataset.fontProbe = key;
        probe.style.whiteSpace = 'nowrap';
        scope.append(probe);
      }
      probe.textContent = content;
    },
    [selector, text],
  );
  return selector;
}

export function removeFontProbes(page: Page): Promise<void> {
  return page.evaluate(() => {
    document
      .querySelectorAll('[data-font-probe]')
      .forEach((el) => el.remove());
  });
}

/** 读取某张卡（含桌面/手机）上指定动作按钮。 */
export function cardButton(scope: Locator, jobId: string, action: string): Locator {
  return scope
    .locator(`[data-job-id="${jobId}"] [data-action="${action}"]`)
    .first();
}

/** 页面与关键容器都不发生横向溢出。 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  if (scrollWidth > clientWidth) {
    throw new Error(`页面横向溢出：scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`);
  }
}

export async function measureTextWidth(
  page: Page,
  selector: string,
): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`测宽目标不存在：${sel}`);
    return el.getBoundingClientRect().width;
  }, selector);
}
