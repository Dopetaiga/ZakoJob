/**
 * 回归：相邻两个面试（均带完整 月/日 + 星期 + 时分 的精确时刻）在同一横向时间线上的渲染。
 *
 * 缺陷背景：.zj-step 是固定列宽（max(96px, 9vw)），而 .zj-step-title/.zj-step-time
 * 均为 white-space: nowrap。完整时间文本（如「11月27日 周五 15:00」）远宽于列宽，
 * 文本实际绘制边界会越出本列、压到相邻步骤的文本上；在窄屏上，末尾（当前）节点的
 * 溢出文本会被 .zj-timeline-wrap（overflow-x:auto; direction:rtl）在起始侧永久裁掉，
 * 无法通过滑动回看完整当前节点。
 *
 * 断言只针对文本的实际绘制边界（Range.getClientRects）：
 *  A. 相邻步骤的同排文本绘制边界不相交（不是页面/父容器溢出断言）；
 *  B. 初始（最新起点）与滑回之后，当前节点的时间文本完整落在时间线可视区域内；
 *  C. 窄屏滑到最早再滑回，当前节点时间完整可见；
 *  D. 两个面试节点的时间文本都是完整「M月D日 周X HH:mm」（未被降低精度）。
 *
 * 基线（未修复）预期失败；产品修复由 Gemini 负责，本套用例只锁定行为。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { startRegressionServer, type RegressionServer } from './vite-server';
import { probeTimelines, type CardPaint, type PaintedText } from './timeline-probe';

let server: RegressionServer;
let dbCounter = 0;

const EVIDENCE_DIR = path.join(process.cwd(), 'test-results', 'regression-timeline');

test.beforeAll(async () => {
  server = await startRegressionServer();
});

test.afterAll(async () => {
  await server.close();
});

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 与 src/ui/format.ts 的渲染规则一致，但在 Node 侧独立计算（月/日不补零，跨年补「YYYY年」）。 */
function fullDateTimeText(daysOffset: number, hhmm: string): string {
  const now = new Date();
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + daysOffset,
  );
  const yearPrefix =
    target.getFullYear() !== now.getFullYear()
      ? `${target.getFullYear()}年`
      : '';
  return `${yearPrefix}${target.getMonth() + 1}月${target.getDate()}日 ${WEEKDAYS[target.getDay()]} ${hhmm}`;
}

interface BoardSpec {
  device: 'desktop' | 'mobile';
  width: number;
  height: number;
}

const DESKTOP_SPECS: BoardSpec[] = [
  { device: 'desktop', width: 1280, height: 800 },
  { device: 'desktop', width: 1024, height: 768 },
];
const MOBILE_SPECS: BoardSpec[] = [
  { device: 'mobile', width: 320, height: 700 },
  { device: 'mobile', width: 390, height: 844 },
  { device: 'mobile', width: 430, height: 932 },
];

// 一面 4 天前 10:30（已面），二面 5 天后 15:00（待面试，当前节点）。
const INTERVIEW_1_OFFSET = -4;
const INTERVIEW_1_TIME = '10:30';
const INTERVIEW_2_OFFSET = 5;
const INTERVIEW_2_TIME = '15:00';

const EXPECTED_TIME_1 = fullDateTimeText(INTERVIEW_1_OFFSET, INTERVIEW_1_TIME);
const EXPECTED_TIME_2 = fullDateTimeText(INTERVIEW_2_OFFSET, INTERVIEW_2_TIME);

async function openBoard(page: Page, spec: BoardSpec): Promise<CardPaint> {
  dbCounter += 1;
  const dbName = `qa-adjacent-${Date.now()}-${dbCounter}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  const url = new URL('tests/regression-timeline/harness.html', server.baseUrl);
  url.searchParams.set('db', dbName);
  url.searchParams.set('device', spec.device);
  url.searchParams.set('d1', isoOffset(INTERVIEW_1_OFFSET));
  url.searchParams.set('t1', INTERVIEW_1_TIME);
  url.searchParams.set('d2', isoOffset(INTERVIEW_2_OFFSET));
  url.searchParams.set('t2', INTERVIEW_2_TIME);
  url.searchParams.set('tz', tz);

  await page.setViewportSize({ width: spec.width, height: spec.height });
  await page.goto(url.toString());
  await expect(
    page.locator('[data-job-id] .zj-timeline-wrap'),
  ).toHaveCount(1);
  // 字体就绪后再测量绘制边界，避免回退字体的度量差。
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);

  const probe = await probeTimelines(page);
  expect(probe.cards).toHaveLength(1);
  await writeEvidence(spec, 'initial', probe);
  return probe.cards[0];
}

function isoOffset(daysOffset: number): string {
  const now = new Date();
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + daysOffset,
  );
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${target.getFullYear()}-${m}-${d}`;
}

async function writeEvidence(
  spec: BoardSpec,
  stage: string,
  payload: unknown,
): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const file = path.join(
    EVIDENCE_DIR,
    `probe-${spec.device}-${spec.width}-${stage}.json`,
  );
  await writeFile(file, JSON.stringify(payload, null, 2));
}

/** A：相邻步骤同排文本的实际绘制边界必须不相交。 */
function assertNoAdjacentTextCollision(
  card: CardPaint,
  label: string,
): void {
  for (let i = 0; i < card.steps.length - 1; i += 1) {
    const a = card.steps[i];
    const b = card.steps[i + 1];
    for (const row of ['title', 'time'] as const) {
      const pa: PaintedText | null = a[row];
      const pb: PaintedText | null = b[row];
      if (!pa || !pb) continue;
      const verticalOverlap =
        Math.min(pa.rect.bottom, pb.rect.bottom) -
        Math.max(pa.rect.top, pb.rect.top);
      if (verticalOverlap <= 2) continue; // 不同排，无碰撞
      const gap = pb.rect.left - pa.rect.right;
      expect(
        gap,
        `${label} 第${i + 1}步「${pa.text}」与第${i + 2}步「${pb.text}」${row} 的绘制边界间距`,
      ).toBeGreaterThanOrEqual(0.5);
    }
  }
}

/** B：当前（最新）节点的时间与标题绘制边界必须完整落在时间线可视区域内。 */
function assertCurrentStepFullyVisible(
  card: CardPaint,
  label: string,
): void {
  const current = card.steps[card.steps.length - 1];
  expect(current.current, `${label} 末节点应为当前节点`).toBe(true);
  const wrap = card.wrap;
  for (const paint of [current.title, current.time]) {
    if (!paint) continue;
    expect(
      paint.rect.right,
      `${label} 当前节点「${paint.text}」右缘 vs 时间线可视右缘（direction=${wrap.direction}）`,
    ).toBeLessThanOrEqual(wrap.rect.right + 0.5);
    expect(
      paint.rect.left,
      `${label} 当前节点「${paint.text}」左缘 vs 时间线可视左缘`,
    ).toBeGreaterThanOrEqual(wrap.rect.left - 0.5);
  }
}

/** D：两个面试节点都渲染完整「M月D日 周X HH:mm」。 */
function assertFullDateTimeRendered(card: CardPaint, label: string): void {
  const steps = card.steps;
  const interview1 = steps.find((s) => s.stepId === 'qa-node-interview-1');
  const interview2 = steps.find((s) => s.stepId === 'qa-node-interview-2');
  expect(interview1, '应存在一面节点').toBeTruthy();
  expect(interview2, '应存在二面节点').toBeTruthy();
  expect(interview1?.time?.text, `${label} 一面时间文本`).toBe(EXPECTED_TIME_1);
  expect(interview2?.time?.text, `${label} 二面时间文本`).toBe(EXPECTED_TIME_2);
  // 已面时间降级为 span.is-past；待面试为 strong 强调（现有设计行为，顺带锁定）。
  expect(interview1?.time?.className).toContain('is-past');
  expect(interview2?.time?.tag).toBe('STRONG');
}

test.describe('相邻双面试完整时间文本回归', () => {
  for (const spec of [...DESKTOP_SPECS, ...MOBILE_SPECS]) {
    const label = `${spec.device} ${spec.width}px`;

    test(`${label}：相邻步骤文本绘制边界不相交且完整时间渲染`, async ({ page }) => {
      const card = await openBoard(page, spec);
      assertFullDateTimeRendered(card, label);
      assertNoAdjacentTextCollision(card, label);
    });

    test(`${label}：初始（最新起点）当前节点时间完整可见`, async ({ page }) => {
      const card = await openBoard(page, spec);
      assertCurrentStepFullyVisible(card, label);
    });
  }

  for (const spec of MOBILE_SPECS) {
    const label = `${spec.device} ${spec.width}px`;

    test(`${label}：滑到最早回看后滑回，当前节点时间完整可见`, async ({ page }) => {
      dbCounter += 1;
      const dbName = `qa-adjacent-${Date.now()}-${dbCounter}`;
      const url = new URL('tests/regression-timeline/harness.html', server.baseUrl);
      url.searchParams.set('db', dbName);
      url.searchParams.set('device', spec.device);
      url.searchParams.set('d1', isoOffset(INTERVIEW_1_OFFSET));
      url.searchParams.set('t1', INTERVIEW_1_TIME);
      url.searchParams.set('d2', isoOffset(INTERVIEW_2_OFFSET));
      url.searchParams.set('t2', INTERVIEW_2_TIME);
      url.searchParams.set(
        'tz',
        Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
      );

      await page.setViewportSize({ width: spec.width, height: spec.height });
      await page.goto(url.toString());
      await expect(page.locator('[data-job-id] .zj-timeline-wrap')).toHaveCount(1);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);

      const probe = await probeTimelines(page, { journey: true });
      await writeEvidence(spec, 'journey', probe);
      expect(probe.atEarliest).toBeTruthy();
      expect(probe.backToLatest).toBeTruthy();

      // 若内容溢出可视区（如 320px），滑动必须真实发生；
      // 若列盒恰好放得下（390/430px），无溢出可滑，但仍要求滑回后当前节点完整可见。
      const scrollable =
        probe.cards[0].wrap.scrollWidth > probe.cards[0].wrap.clientWidth;
      const back = probe.backToLatest![0];
      const atEarliest = probe.atEarliest![0];
      if (scrollable) {
        expect(
          atEarliest.wrap.scrollLeft,
          `${label} 滑到最早后 scrollLeft 应离开原点`,
        ).not.toBe(back.wrap.scrollLeft);
      }

      assertCurrentStepFullyVisible(back, `${label} 滑回后`);
      assertNoAdjacentTextCollision(back, `${label} 滑回后`);
    });
  }
});
