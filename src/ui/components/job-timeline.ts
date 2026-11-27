import {
  formatStepInlineText,
  formatStepTitle,
  getJobDisplayName,
  getLatestStep,
  getStepTimeDisplay,
  getStepVisualTone,
  isEditableStepKind,
} from '../format.ts';
import { createIcon } from '../icons.ts';
import type { JobBoardCallbacks, JobCardData } from '../types.ts';

export interface TimelineScrollState {
  offsetFromEndPx: number;
  knownStepCount: number;
}

export interface JobTimelineOptions {
  scrollStates?: Map<string, TimelineScrollState>;
  registerCleanup?: (cleanup: () => void) => void;
}

export function createJobTimeline(
  job: JobCardData,
  callbacks?: JobBoardCallbacks,
  options: JobTimelineOptions = {},
): HTMLElement {
  const { scrollStates, registerCleanup } = options;
  const displayName = getJobDisplayName(job);
  const latestStep = getLatestStep(job);

  const shell = document.createElement('div');
  shell.className = 'zj-timeline-shell';

  const wrap = document.createElement('div');
  wrap.className = 'zj-timeline-wrap';
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', `${displayName}进展时间线`);

  const ol = document.createElement('ol');
  ol.className = 'zj-timeline';
  ol.setAttribute('aria-label', `${displayName}已登记的进展`);

  for (const step of job.steps) {
    const li = document.createElement('li');
    li.className = 'zj-step';
    li.dataset.stepId = step.id;
    const tone = getStepVisualTone(step);
    if (tone === 'pending') li.classList.add('is-pending');
    if (tone === 'offer') li.classList.add('is-offer');
    if (latestStep && step.id === latestStep.id) {
      li.dataset.current = 'true';
    }

    const dot = document.createElement('span');
    dot.className = 'zj-step-dot';
    li.append(dot);

    const parts = formatStepTitle(step);
    const titleEl = document.createElement('span');
    titleEl.className = 'zj-step-title';
    titleEl.textContent = parts.primary;
    if (parts.substatus) {
      const sub = document.createElement('span');
      sub.className = 'zj-step-sub';
      sub.textContent = ` · ${parts.substatus}`;
      titleEl.append(sub);
    }

    const timeDisplay = getStepTimeDisplay(step);
    let timeEl: HTMLElement | null = null;
    if (timeDisplay) {
      timeEl = document.createElement(
        timeDisplay.kind === 'pending' ? 'strong' : 'span',
      );
      timeEl.className = 'zj-step-time';
      if (timeDisplay.kind === 'past') timeEl.classList.add('is-past');
      if (timeDisplay.kind === 'deadline') timeEl.classList.add('is-deadline');
      timeEl.textContent = timeDisplay.text;
    }

    const editable = isEditableStepKind(step.kind);
    const isLatest = Boolean(latestStep && step.id === latestStep.id);
    const canInteract =
      Boolean(callbacks?.onRequestEditStep) &&
      (editable || (isLatest && Boolean(callbacks?.onRemoveLatestStep)));

    if (canInteract) {
      const stepBtn = document.createElement('button');
      stepBtn.type = 'button';
      stepBtn.className = 'zj-step-btn';
      stepBtn.dataset.action = 'edit-step';
      stepBtn.dataset.stepId = step.id;
      stepBtn.setAttribute(
        'aria-label',
        `${editable ? '编辑' : '操作'}${formatStepInlineText(step)}`,
      );
      stepBtn.append(titleEl);
      if (timeEl) stepBtn.append(timeEl);
      stepBtn.addEventListener('click', () => {
        callbacks?.onRequestEditStep?.(job, step);
      });
      li.append(stepBtn);
    } else {
      li.append(titleEl);
      if (timeEl) li.append(timeEl);
    }

    ol.append(li);
  }

  wrap.append(ol);

  const nav = document.createElement('div');
  nav.className = 'zj-timeline-nav';
  nav.hidden = true;

  const earlierBtn = document.createElement('button');
  earlierBtn.type = 'button';
  earlierBtn.className = 'zj-timeline-nav-btn is-earlier';
  earlierBtn.dataset.action = 'timeline-earlier';
  earlierBtn.setAttribute('aria-label', `查看${displayName}较早进展`);
  earlierBtn.append(createIcon('chevron-left'), document.createTextNode('查看较早进展'));
  earlierBtn.hidden = true;

  const latestBtn = document.createElement('button');
  latestBtn.type = 'button';
  latestBtn.className = 'zj-timeline-nav-btn is-latest';
  latestBtn.dataset.action = 'timeline-latest';
  latestBtn.setAttribute('aria-label', `回到${displayName}最新进展`);
  latestBtn.append(document.createTextNode('回到最新'), createIcon('chevron-right'));
  latestBtn.hidden = true;

  nav.append(earlierBtn, latestBtn);
  shell.append(wrap, nav);

  const prevState = scrollStates?.get(job.id);
  const stepCount = job.steps.length;
  let desiredOffsetFromEnd = 0;
  if (prevState) {
    desiredOffsetFromEnd =
      stepCount > prevState.knownStepCount ? 0 : Math.max(0, prevState.offsetFromEndPx);
  }
  scrollStates?.set(job.id, {
    offsetFromEndPx: desiredOffsetFromEnd,
    knownStepCount: stepCount,
  });

  const prefersReducedMotion = (): boolean =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const isRtlScroller = (): boolean =>
    typeof getComputedStyle === 'function' &&
    getComputedStyle(wrap).direction === 'rtl';

  const getMaxScroll = (): number => {
    const sw = typeof wrap.scrollWidth === 'number' ? wrap.scrollWidth : 0;
    const cw = typeof wrap.clientWidth === 'number' ? wrap.clientWidth : 0;
    return Math.max(0, sw - cw);
  };

  const getDistanceFromRight = (): number => {
    const maxScroll = getMaxScroll();
    if (maxScroll <= 1) return 0;
    const sl = typeof wrap.scrollLeft === 'number' ? wrap.scrollLeft : 0;
    if (isRtlScroller()) {
      if (sl <= 0) return Math.min(maxScroll, Math.max(0, -sl));
      return Math.min(maxScroll, Math.max(0, maxScroll - sl));
    }
    return Math.min(maxScroll, Math.max(0, maxScroll - sl));
  };

  const applyDistanceFromRight = (offsetFromEndPx: number, smooth: boolean): void => {
    const maxScroll = getMaxScroll();
    const clamped = Math.max(0, Math.min(maxScroll, offsetFromEndPx));
    const targetLeft = isRtlScroller() ? -clamped : maxScroll - clamped;
    if (smooth && !prefersReducedMotion() && typeof wrap.scrollTo === 'function') {
      wrap.scrollTo({ left: targetLeft, behavior: 'smooth' });
    } else {
      wrap.scrollLeft = targetLeft;
    }
  };

  let restoredOnce = false;
  let lastClientWidth = 0;
  let lastScrollWidth = 0;
  let programmaticUntil = 0;

  const updateNavControls = (overrideDist?: number): void => {
    const maxScroll = getMaxScroll();
    if (maxScroll <= 2) {
      nav.hidden = true;
      earlierBtn.hidden = true;
      latestBtn.hidden = true;
      return;
    }
    const dist =
      overrideDist !== undefined
        ? Math.max(0, Math.min(maxScroll, overrideDist))
        : getDistanceFromRight();
    const showEarlier = dist < maxScroll - 2;
    const showLatest = dist > 2;
    earlierBtn.hidden = !showEarlier;
    latestBtn.hidden = !showLatest;
    nav.hidden = !showEarlier && !showLatest;
  };

  const syncAfterLayout = (): void => {
    const cw = typeof wrap.clientWidth === 'number' ? wrap.clientWidth : 0;
    const sw = typeof wrap.scrollWidth === 'number' ? wrap.scrollWidth : 0;
    if (cw <= 0) return;
    const maxScroll = Math.max(0, sw - cw);
    const savedOffset = scrollStates?.get(job.id)?.offsetFromEndPx ?? desiredOffsetFromEnd;
    const clamped = Math.min(maxScroll, Math.max(0, savedOffset));

    if (!restoredOnce || cw !== lastClientWidth || sw !== lastScrollWidth) {
      restoredOnce = true;
      lastClientWidth = cw;
      lastScrollWidth = sw;
      programmaticUntil = Date.now() + 80;
      applyDistanceFromRight(clamped, false);
      scrollStates?.set(job.id, {
        offsetFromEndPx: clamped,
        knownStepCount: stepCount,
      });
      updateNavControls(clamped);
    } else {
      updateNavControls();
    }
  };

  wrap.addEventListener(
    'scroll',
    () => {
      const dist = getDistanceFromRight();
      updateNavControls(dist);
      if (restoredOnce && Date.now() >= programmaticUntil) {
        scrollStates?.set(job.id, {
          offsetFromEndPx: dist,
          knownStepCount: stepCount,
        });
      }
    },
    { passive: true },
  );

  earlierBtn.addEventListener('click', () => {
    const maxScroll = getMaxScroll();
    if (maxScroll <= 0) return;
    const current = getDistanceFromRight();
    const delta = Math.max(140, Math.round((wrap.clientWidth || 240) * 0.7));
    const nextOffset = Math.min(maxScroll, current + delta);
    programmaticUntil = Date.now() + 450;
    scrollStates?.set(job.id, {
      offsetFromEndPx: nextOffset,
      knownStepCount: stepCount,
    });
    applyDistanceFromRight(nextOffset, true);
    updateNavControls(nextOffset);
    if (earlierBtn.hidden && !latestBtn.hidden) {
      latestBtn.focus({ preventScroll: true });
    }
  });

  latestBtn.addEventListener('click', () => {
    programmaticUntil = Date.now() + 450;
    scrollStates?.set(job.id, {
      offsetFromEndPx: 0,
      knownStepCount: stepCount,
    });
    applyDistanceFromRight(0, true);
    updateNavControls(0);
    if (latestBtn.hidden && !earlierBtn.hidden) {
      earlierBtn.focus({ preventScroll: true });
    }
  });

  let rafId = 0;
  if (typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      syncAfterLayout();
    });
  }

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      syncAfterLayout();
    });
    resizeObserver.observe(wrap);
    resizeObserver.observe(ol);
  }

  registerCleanup?.(() => {
    if (rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    resizeObserver?.disconnect();
    resizeObserver = null;
  });

  return shell;
}
