import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { build, preview, type PreviewServer } from 'vite';

const BYTEDANCE_SEED_JD = [
  '团队介绍：产品研发和工程架构-Seed 团队深耕大',
  '模型技术在场景中的创新应用，负责多款AI产品的工',
  '程研发——包括豆包、飞书、豆包工作、豆包爱学、',
  'Gauth、猫箱等创新产品，覆盖消费级与企业级多个',
  '场景。我们致力于将大模型能力从“生成内容”推进',
  '到“完成工作”，让AI服务用户日常与企业协作。你',
  '将面对多模态交互、工具调用可靠性、企业级数据安',
  '全等真实工程挑战，与团队一起推动AI生产力落',
  '地。',
  '日常实习：面向全体在校生，为符合岗位要求的同学',
  '提供为期3个月及以上的项目实践机会。',
  '1、负责协助Seed产品研发技术运营团队做AI工具开',
  '发，进行提效建设；',
  '2、调研前沿AI理论，实施经验，推进AI能力在技术支',
  '持团队有效落地；',
  '3、参与AI和其他团队工具的开发和维护工作；',
  '4、协助团队其他成员，共同做好技术支持工作，处',
  '理技术问题；',
  '5、配合商业化团队，为内外部客户提供专业的技术',
  '解决方案；',
  '6、从数据层面总结提炼用户问题中的信息，与产品',
  '研发团队协同合作，持续优化产品能力。',
  '职位要求',
  '1、本科及以上学历在读，计算机及相关专业优先；',
].join('\n');

const ENGLISH_WRAPPED_JD = [
  'About the Role',
  'We are building low-latency distributed',
  'systems for real-time inference at global',
  'scale with strong reliability across every',
  'production cluster and cloud region.',
  '',
  'Requirements',
  '- Experience with TypeScript, Node.js, and',
  'browser performance profiling in production.',
].join('\n');

const PLAIN_SHORT_JD = [
  '负责核心后台服务设计与开发。',
  '参与高并发链路性能优化。',
  '1. 熟悉 Go 或 Java 后端开发',
  '2. 熟悉 MySQL、Redis 常见调优',
].join('\n');

interface JdMeasurement {
  dialogWidth: number;
  jdBoxWidth: number;
  innerWidth: number;
  maxLineWidth: number;
  lineWidths: number[];
  renderedText: string;
  docOverflow: number;
  dialogOverflow: number;
}

async function measureJdLayout(page: Page): Promise<JdMeasurement> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const dialog = document.querySelector<HTMLDialogElement>(
      'dialog[open].zj-dialog-detail',
    );
    if (!dialog) throw new Error('Detail dialog is not open');
    const jd = dialog.querySelector<HTMLElement>('.zj-detail-jd');
    if (!jd) throw new Error('.zj-detail-jd not found');

    const style = getComputedStyle(jd);
    const jdRect = jd.getBoundingClientRect();
    const innerWidth =
      jdRect.width -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight);

    const walker = document.createTreeWalker(jd, NodeFilter.SHOW_TEXT);
    const rawRects: Array<{ top: number; left: number; right: number }> = [];
    let current = walker.nextNode();
    while (current) {
      const range = document.createRange();
      range.selectNodeContents(current);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0.5 && rect.height > 0.5) {
          rawRects.push({ top: rect.top, left: rect.left, right: rect.right });
        }
      }
      current = walker.nextNode();
    }

    rawRects.sort((a, b) => a.top - b.top || a.left - b.left);
    const mergedLines: Array<{ top: number; left: number; right: number }> = [];
    for (const r of rawRects) {
      const prev = mergedLines.at(-1);
      if (prev && Math.abs(prev.top - r.top) < 4) {
        prev.left = Math.min(prev.left, r.left);
        prev.right = Math.max(prev.right, r.right);
      } else {
        mergedLines.push({ ...r });
      }
    }

    const lineWidths = mergedLines.map((l) => l.right - l.left);
    const maxLineWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;

    return {
      dialogWidth: dialog.getBoundingClientRect().width,
      jdBoxWidth: jdRect.width,
      innerWidth,
      maxLineWidth,
      lineWidths,
      renderedText: jd.textContent ?? '',
      docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
    };
  });
}

describe('JD 只读详情实际渲染行宽与多端验证', () => {
  let outDir = '';
  let server: PreviewServer | undefined;
  let browser: Browser | undefined;
  let baseUrl = '';

  before(async () => {
    outDir = await fs.mkdtemp(path.join(tmpdir(), 'zako-job-jd-layout-'));
    await build({
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    });
    server = await preview({
      logLevel: 'silent',
      preview: { port: 0, host: '127.0.0.1' },
      build: { outDir },
    });
    const localUrl = server.resolvedUrls?.local[0];
    assert.ok(localUrl, 'Preview server did not expose a local URL');
    baseUrl = localUrl;
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  });

  after(async () => {
    await browser?.close();
    server?.httpServer?.close();
    if (outDir) await fs.rm(outDir, { recursive: true, force: true });
  });

  it('桌面端（1280px / 1024px）展示窄栏复制的中文 JD 时用满行宽，同时保留段落、编号与原存储文本', async () => {
    const context = await browser!.newContext({
      viewport: { width: 1280, height: 860 },
    });
    const page = await context.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '添加岗位' }).first().click();
      const formDialog = page.locator('dialog[open].zj-dialog-form');
      await formDialog.getByLabel('公司').fill('字节跳动');
      await formDialog
        .getByLabel('职位')
        .fill('技术支持实习生(AI工具开发方向) - Seed');
      await formDialog.getByLabel('地点（可选）').fill('上海');
      await formDialog.getByLabel('薪资（可选）').fill('500-550/天');
      await formDialog.getByLabel('岗位描述 JD（可选）').fill(BYTEDANCE_SEED_JD);
      await formDialog.getByRole('button', { name: '添加' }).click();

      const card = page.locator('.zj-desktop-card').first();
      await card.waitFor();
      await card.getByRole('button', { name: '查看 JD' }).click();

      const desktop1280 = await measureJdLayout(page);
      assert.ok(
        desktop1280.jdBoxWidth >= 580,
        `期望桌面端 JD 框宽 >= 580px，实际 ${desktop1280.jdBoxWidth}`,
      );
      assert.ok(
        desktop1280.maxLineWidth >= desktop1280.innerWidth * 0.85 &&
          desktop1280.maxLineWidth >= 500,
        `期望文字 Range 最大行宽用满容器 (>=85% / >=500px)，实际 ${desktop1280.maxLineWidth} / ${desktop1280.innerWidth}`,
      );
      const nearFullLines = desktop1280.lineWidths.filter(
        (w) => w >= desktop1280.innerWidth * 0.82,
      );
      assert.ok(
        nearFullLines.length >= 4,
        `期望多行自然填满桌面宽度，实际宽行仅 ${nearFullLines.length} 行: ${JSON.stringify(desktop1280.lineWidths)}`,
      );
      assert.ok(desktop1280.maxLineWidth <= desktop1280.innerWidth + 2);
      assert.ok(desktop1280.dialogOverflow <= 0);
      assert.ok(desktop1280.docOverflow <= 0);

      assert.ok(desktop1280.renderedText.includes('深耕大模型技术在场景中的创新应用'));
      assert.ok(desktop1280.renderedText.includes('做AI工具开发，进行提效建设；'));
      assert.ok(desktop1280.renderedText.includes('推进AI能力在技术支持团队有效落地；'));
      assert.ok(desktop1280.renderedText.includes('\n日常实习：面向全体在校生'));
      assert.ok(desktop1280.renderedText.includes('\n1、负责协助Seed产品研发'));
      assert.ok(desktop1280.renderedText.includes('\n职位要求\n1、本科及以上学历在读'));

      await page.setViewportSize({ width: 1024, height: 768 });
      const desktop1024 = await measureJdLayout(page);
      assert.ok(desktop1024.jdBoxWidth >= 560);
      assert.ok(desktop1024.maxLineWidth >= desktop1024.innerWidth * 0.85);
      assert.ok(desktop1024.dialogOverflow <= 0);
      assert.ok(desktop1024.docOverflow <= 0);

      await page.locator('dialog[open].zj-dialog-detail button[aria-label="关闭详情"]').click();
      // 已有公司与职位的岗位不再有标题旁编辑入口，经「更多」菜单打开编辑岗位资料
      await card.getByRole('button', { name: /更多操作/ }).click();
      await page.getByRole('button', { name: '编辑岗位资料' }).click();
      const editDialog = page.locator('dialog[open].zj-dialog-form');
      const rawStoredJd = await editDialog.getByLabel('岗位描述 JD（可选）').inputValue();
      assert.equal(rawStoredJd, BYTEDANCE_SEED_JD);
      console.log(
        `[jd-measure desktop] 1280: box=${desktop1280.jdBoxWidth.toFixed(1)} inner=${desktop1280.innerWidth.toFixed(1)} maxLine=${desktop1280.maxLineWidth.toFixed(1)} | 1024: box=${desktop1024.jdBoxWidth.toFixed(1)} inner=${desktop1024.innerWidth.toFixed(1)} maxLine=${desktop1024.maxLineWidth.toFixed(1)}`,
      );
    } finally {
      await context.close();
    }
  });

  it('移动端（390px / 320px）底部弹层展示长 JD 时贴合容器宽度且无横向溢出', async () => {
    const context = await browser!.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '添加岗位' }).first().click();
      const formDialog = page.locator('dialog[open].zj-dialog-form');
      await formDialog.getByLabel('公司').fill('字节跳动');
      await formDialog.getByLabel('职位').fill('技术支持实习生');
      await formDialog.getByLabel('岗位描述 JD（可选）').fill(BYTEDANCE_SEED_JD);
      await formDialog.getByRole('button', { name: '添加' }).click();

      const mobileCard = page.locator('.zj-mobile-card').first();
      await mobileCard.waitFor();
      await mobileCard.getByRole('button', { name: '查看 JD' }).click();

      const m390 = await measureJdLayout(page);
      assert.ok(m390.docOverflow <= 0, `390px 页面不应横向溢出: ${m390.docOverflow}`);
      assert.ok(m390.dialogOverflow <= 0, `390px 弹层不应横向溢出: ${m390.dialogOverflow}`);
      assert.ok(
        m390.maxLineWidth >= m390.innerWidth * 0.78 &&
          m390.maxLineWidth <= m390.innerWidth + 2,
        `390px Range 行宽应贴合容器 (${m390.innerWidth}): ${m390.maxLineWidth}`,
      );

      await page.setViewportSize({ width: 320, height: 720 });
      const m320 = await measureJdLayout(page);
      assert.ok(m320.docOverflow <= 0, `320px 页面不应横向溢出: ${m320.docOverflow}`);
      assert.ok(m320.dialogOverflow <= 0, `320px 弹层不应横向溢出: ${m320.dialogOverflow}`);
      assert.ok(
        m320.maxLineWidth >= m320.innerWidth * 0.72 &&
          m320.maxLineWidth <= m320.innerWidth + 2,
        `320px Range 行宽应贴合容器 (${m320.innerWidth}): ${m320.maxLineWidth}`,
      );
      console.log(
        `[jd-measure mobile] 390: box=${m390.jdBoxWidth.toFixed(1)} inner=${m390.innerWidth.toFixed(1)} maxLine=${m390.maxLineWidth.toFixed(1)} | 320: box=${m320.jdBoxWidth.toFixed(1)} inner=${m320.innerWidth.toFixed(1)} maxLine=${m320.maxLineWidth.toFixed(1)}`,
      );
    } finally {
      await context.close();
    }
  });

  it('英文硬换行保留词间空格与满宽折行，普通短行 JD 保持原有换行不变', async () => {
    const context = await browser!.newContext({
      viewport: { width: 1280, height: 860 },
    });
    const page = await context.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'networkidle' });

      await page.getByRole('button', { name: '添加岗位' }).first().click();
      const formDialog = page.locator('dialog[open].zj-dialog-form');
      await formDialog.getByLabel('公司').fill('CloudLab');
      await formDialog.getByLabel('职位').fill('Systems Engineer');
      await formDialog.getByLabel('岗位描述 JD（可选）').fill(ENGLISH_WRAPPED_JD);
      await formDialog.getByRole('button', { name: '添加' }).click();

      const cards = page.locator('.zj-desktop-card');
      await cards.first().waitFor();
      await cards.first().getByRole('button', { name: '查看 JD' }).click();
      const englishMeasure = await measureJdLayout(page);
      assert.ok(englishMeasure.renderedText.includes('low-latency distributed systems for real-time inference at global scale'));
      assert.ok(englishMeasure.renderedText.includes('TypeScript, Node.js, and browser performance profiling in production.'));
      assert.ok(englishMeasure.maxLineWidth >= englishMeasure.innerWidth * 0.8);
      await page.locator('dialog[open].zj-dialog-detail button[aria-label="关闭详情"]').click();

      await page.getByRole('button', { name: '添加岗位' }).first().click();
      await formDialog.getByLabel('公司').fill('平实科技');
      await formDialog.getByLabel('职位').fill('后端工程师');
      await formDialog.getByLabel('岗位描述 JD（可选）').fill(PLAIN_SHORT_JD);
      await formDialog.getByRole('button', { name: '添加' }).click();

      const plainCard = cards.filter({ hasText: '平实科技' });
      await plainCard.waitFor();
      await plainCard.getByRole('button', { name: '查看 JD' }).click();
      const plainMeasure = await measureJdLayout(page);
      assert.equal(plainMeasure.renderedText, PLAIN_SHORT_JD);
    } finally {
      await context.close();
    }
  });
});
