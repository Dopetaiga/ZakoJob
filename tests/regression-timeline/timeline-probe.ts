// 相邻双面试时间文本渲染探针：
// 用 Range.getClientRects 取每个步骤标题/时间的「实际绘制边界」，
// 对照相邻步骤的同排文本与 .zj-timeline-wrap 的可视裁剪边界。
// 明确不使用页面/父容器溢出断言——只看文本像素边界本身。
import type { Page } from '@playwright/test';

export interface PaintedRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PaintedText {
  text: string;
  tag: string;
  className: string;
  rect: PaintedRect;
}

export interface StepPaint {
  stepId: string | undefined;
  current: boolean;
  liRect: PaintedRect;
  title: PaintedText | null;
  time: PaintedText | null;
}

export interface WrapPaint {
  rect: PaintedRect;
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  direction: string;
}

export interface CardPaint {
  jobId: string | undefined;
  wrap: WrapPaint;
  steps: StepPaint[];
}

export interface TimelineProbe {
  cards: CardPaint[];
  /** journey 模式：滑到最早一端后的状态。 */
  atEarliest?: CardPaint[];
  /** journey 模式：滑回最新（滚动原点）后的状态。 */
  backToLatest?: CardPaint[];
}

interface ProbeOptions {
  /** 是否执行「滑到最早 → 滑回最新」的往返（窄屏回看路径）。 */
  journey?: boolean;
}

export async function probeTimelines(
  page: Page,
  options: ProbeOptions = {},
): Promise<TimelineProbe> {
  return page.evaluate(async ({ journey }) => {
    // 以下辅助函数都定义在回调内部：page.evaluate 只序列化本函数体。
    const toRect = (r: DOMRect): PaintedRect => ({
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
    });

    const raf = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );

    const paintElement = (el: Element | null): PaintedText | null => {
      if (!el) return null;
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = Array.from(range.getClientRects()).filter(
        (r) => r.width > 0 || r.height > 0,
      );
      if (rects.length === 0) return null;
      return {
        text: (el.textContent ?? '').trim(),
        tag: el.tagName,
        className: el.className,
        rect: {
          left: Math.min(...rects.map((r) => r.left)),
          right: Math.max(...rects.map((r) => r.right)),
          top: Math.min(...rects.map((r) => r.top)),
          bottom: Math.max(...rects.map((r) => r.bottom)),
        },
      };
    };

    const measureWrap = (wrap: HTMLElement): CardPaint => {
      const card = wrap.closest('[data-job-id]');
      const steps: StepPaint[] = Array.from(
        wrap.querySelectorAll('.zj-step'),
      ).map((li) => ({
        stepId: (li as HTMLElement).dataset.stepId,
        current: (li as HTMLElement).dataset.current === 'true',
        liRect: toRect(li.getBoundingClientRect()),
        title: paintElement(li.querySelector('.zj-step-title')),
        time: paintElement(li.querySelector('.zj-step-time')),
      }));
      return {
        jobId: card instanceof HTMLElement ? card.dataset.jobId : undefined,
        wrap: {
          rect: toRect(wrap.getBoundingClientRect()),
          scrollLeft: wrap.scrollLeft,
          scrollWidth: wrap.scrollWidth,
          clientWidth: wrap.clientWidth,
          direction: getComputedStyle(wrap).direction,
        },
        steps,
      };
    };

    const collect = (): CardPaint[] =>
      Array.from(document.querySelectorAll('.zj-timeline-wrap')).map(
        (el) => measureWrap(el as HTMLElement),
      );

    const initial = collect();

    if (!journey) {
      return { cards: initial };
    }

    // 窄屏回看路径：先把时间线滑到最早一端，再滑回最新（rtl 滚动原点为 0）。
    const atEarliest: CardPaint[] = [];
    for (const wrap of document.querySelectorAll<HTMLElement>(
      '.zj-timeline-wrap',
    )) {
      wrap.scrollLeft = -(wrap.scrollWidth - wrap.clientWidth);
    }
    await raf();
    atEarliest.push(...collect());

    for (const wrap of document.querySelectorAll<HTMLElement>(
      '.zj-timeline-wrap',
    )) {
      wrap.scrollLeft = 0;
    }
    await raf();
    const backToLatest = collect();

    return { cards: initial, atEarliest, backToLatest };
  }, options);
}
