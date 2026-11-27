import {
  createJobTimeline,
  type TimelineScrollState,
} from './job-timeline.ts';
import {
  formatStepInlineText,
  formatStepTitle,
  formatUrlDisplay,
  getJobDisplayName,
  getLatestStep,
  getResultLabel,
  getStepTimeDisplay,
  getStepVisualTone,
  hasMetadata,
  isEditableStepKind,
  isLinkOnlyJob,
  sanitizeHttpUrl,
  sortJobsByStar,
} from '../format.ts';
import { createIcon } from '../icons';
import type {
  BoardHandle,
  JobBoardCallbacks,
  JobCardData,
  JobStep,
  MobileHistoryMode,
  MobileMenuContainer,
} from '../types';
import { createEmptyBoardState } from './empty-state';
import { createCardActionsGroup, createMoreMenu } from './progress-menu';

export interface MobileJobBoardOptions {
  mode: MobileHistoryMode;
  jobs?: readonly JobCardData[];
  callbacks?: JobBoardCallbacks;
  menuContainer?: MobileMenuContainer;
  emptyTitle?: string;
  emptyDescription?: string;
}

export interface MobileJobBoardHandle extends BoardHandle<MobileJobBoardOptions> {
  getViewingStepIndex: (jobId: string) => number | null;
  setViewingStepIndex: (jobId: string, index: number) => void;
  closeMenu: () => void;
}

function createStepBoxElement(
  step: JobStep,
  job: JobCardData,
  callbacks?: JobBoardCallbacks,
  allowStepEdit = false,
): HTMLElement {
  const tone = getStepVisualTone(step);
  const box = document.createElement('div');
  box.className = 'zj-mobile-stage-box';
  if (tone === 'pending') box.classList.add('is-pending');
  if (tone === 'offer') box.classList.add('is-offer');
  box.dataset.stepId = step.id;

  const labelRow = document.createElement('div');
  labelRow.className = 'zj-mobile-stage-label';

  const dot = document.createElement('span');
  dot.className = 'zj-mobile-dot';
  const textSpan = document.createElement('span');
  textSpan.textContent = formatStepInlineText(step);
  labelRow.append(dot, textSpan);

  if (job.result) {
    const resultSpan = document.createElement('span');
    resultSpan.className = `zj-mobile-result${job.result === 'declined' ? ' is-declined' : ''}`;
    resultSpan.append(
      createIcon(job.result === 'rejected' ? 'circle-x' : 'minus'),
      document.createTextNode(getResultLabel(job.result)),
    );
    labelRow.append(resultSpan);
  }

  box.append(labelRow);

  const timeDisplay = getStepTimeDisplay(step);
  if (timeDisplay) {
    const timeEl = document.createElement(
      timeDisplay.kind === 'pending' ? 'strong' : 'span',
    );
    timeEl.className = 'zj-mobile-time';
    if (timeDisplay.kind === 'past') timeEl.classList.add('is-past');
    if (timeDisplay.kind === 'deadline') timeEl.classList.add('is-deadline');
    timeEl.textContent = timeDisplay.text;
    box.append(timeEl);
  }

  if (allowStepEdit && callbacks?.onRequestEditStep && isEditableStepKind(step.kind)) {
    const stepParts = formatStepTitle(step);
    const foot = document.createElement('div');
    foot.className = 'zj-mobile-slide-foot';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'zj-slide-edit-btn';
    editBtn.dataset.action = 'edit-step';
    editBtn.dataset.stepId = step.id;
    editBtn.textContent = `编辑${stepParts.primary}`;
    editBtn.addEventListener('click', () => {
      callbacks.onRequestEditStep?.(job, step);
    });
    foot.append(editBtn);
    box.append(foot);
  }

  return box;
}

export function createMobileJobBoard(
  initialOptions: MobileJobBoardOptions,
): MobileJobBoardHandle {
  const root = document.createElement('div');
  root.className = 'zj-ui-scope zj-mobile-board';

  let currentOptions: MobileJobBoardOptions = { ...initialOptions };
  const expandedIds = new Set<string>();
  const swipeIndexByJobId = new Map<string, number>();
  const knownStepCountByJobId = new Map<string, number>();
  const timelineScrollStates = new Map<string, TimelineScrollState>();
  const timelineCleanups: Array<() => void> = [];
  const trackLastWidth = new WeakMap<HTMLElement, number>();
  let openMenuJobId: string | null = null;
  let sheetBackdropEl: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const clearTimelineCleanups = (): void => {
    while (timelineCleanups.length > 0) {
      timelineCleanups.pop()?.();
    }
  };

  const prefersReducedMotion = (): boolean =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const closeSheet = (): void => {
    if (sheetBackdropEl) {
      sheetBackdropEl.remove();
      sheetBackdropEl = null;
    }
  };

  const closeMenu = (restoreFocusForJobId?: string): void => {
    if (openMenuJobId === null && !sheetBackdropEl) return;
    const prevJobId = openMenuJobId;
    openMenuJobId = null;
    closeSheet();
    render();
    const targetJobId = restoreFocusForJobId ?? prevJobId;
    if (targetJobId) {
      root
        .querySelector<HTMLButtonElement>(
          `[data-job-id="${CSS.escape(targetJobId)}"] [data-action="open-more-menu"]`,
        )
        ?.focus({ preventScroll: true });
    }
  };

  const syncSwipeDefaults = (jobs: readonly JobCardData[]): void => {
    for (const job of jobs) {
      const len = job.steps.length;
      if (len === 0) {
        swipeIndexByJobId.delete(job.id);
        knownStepCountByJobId.set(job.id, 0);
        continue;
      }
      const prevLen = knownStepCountByJobId.get(job.id);
      if (prevLen === undefined || len > prevLen) {
        // Initial mount or new step appended -> focus latest step
        swipeIndexByJobId.set(job.id, len - 1);
      } else {
        const cur = swipeIndexByJobId.get(job.id) ?? len - 1;
        swipeIndexByJobId.set(job.id, Math.max(0, Math.min(len - 1, cur)));
      }
      knownStepCountByJobId.set(job.id, len);
    }
  };

  const updateTrackIndicators = (
    track: HTMLElement,
    job: JobCardData,
    cardEl: HTMLElement,
  ): void => {
    if (!track.clientWidth || job.steps.length === 0) return;
    const idx = Math.max(
      0,
      Math.min(
        job.steps.length - 1,
        Math.round(track.scrollLeft / track.clientWidth),
      ),
    );
    swipeIndexByJobId.set(job.id, idx);

    const posEl = cardEl.querySelector<HTMLElement>('[data-swipe-position]');
    if (posEl) posEl.textContent = `${idx + 1} / ${job.steps.length}`;

    const prevBtn = cardEl.querySelector<HTMLButtonElement>(
      '[data-action="swipe-prev"]',
    );
    if (prevBtn) prevBtn.disabled = idx === 0;

    const nextBtn = cardEl.querySelector<HTMLButtonElement>(
      '[data-action="swipe-next"]',
    );
    if (nextBtn) nextBtn.disabled = idx === job.steps.length - 1;

    const latestBtn = cardEl.querySelector<HTMLButtonElement>(
      '[data-action="swipe-latest"]',
    );
    if (latestBtn) latestBtn.hidden = idx === job.steps.length - 1;
  };

  const scrollTrackTo = (
    track: HTMLElement,
    index: number,
    instant: boolean,
  ): void => {
    if (!track.clientWidth) return;
    const left = index * track.clientWidth;
    if (instant || prefersReducedMotion()) {
      track.scrollLeft = left;
    } else {
      track.scrollTo({ left, behavior: 'smooth' });
    }
  };

  const renderCard = (job: JobCardData): HTMLElement => {
    const mode = currentOptions.mode;
    const callbacks = currentOptions.callbacks;
    const displayName = getJobDisplayName(job);
    const linkOnly = isLinkOnlyJob(job);
    const steps = job.steps;
    const latestStep = getLatestStep(job);
    const isExpanded = expandedIds.has(job.id);
    const isMenuOpen = openMenuJobId === job.id;

    const card = document.createElement('article');
    card.className = 'zj-mobile-card';
    if (job.result !== null) card.classList.add('is-ended');
    card.dataset.jobId = job.id;
    card.setAttribute('aria-label', displayName);

    // Header
    const header = document.createElement('div');
    header.className = 'zj-mobile-header';

    const heading = document.createElement('div');
    heading.className = 'zj-mobile-heading';

    const safeUrl = sanitizeHttpUrl(job.url);

    const appendTitleActions = (line: HTMLElement): void => {
      if (job.result) {
        const resultBadge = document.createElement('span');
        resultBadge.className = `zj-result-badge${job.result === 'declined' ? ' is-declined' : ''}`;
        resultBadge.textContent = getResultLabel(job.result);
        line.append(resultBadge);
      }
      const needsSupplementHighlight =
        !job.company.trim() || !job.position.trim();
      if (callbacks?.onRequestEditDetails && needsSupplementHighlight) {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'zj-title-edit-btn is-supplement-highlight';
        editBtn.dataset.action = 'edit-details';
        editBtn.setAttribute('aria-label', `补资料 · ${displayName}`);
        editBtn.textContent = '补资料';
        editBtn.addEventListener('click', () => {
          callbacks.onRequestEditDetails?.(job);
        });
        line.append(editBtn);
      }
    };

    if (linkOnly && job.url) {
      const linkRow = document.createElement('div');
      linkRow.className = 'zj-company-line';
      if (safeUrl) {
        const anchor = document.createElement('a');
        anchor.className = 'zj-link-primary';
        anchor.href = safeUrl;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.append(
          createIcon('link'),
          document.createTextNode(formatUrlDisplay(safeUrl)),
          createIcon('external-link'),
        );
        linkRow.append(anchor);
      } else {
        const span = document.createElement('span');
        span.className = 'zj-link-primary';
        span.append(
          createIcon('link'),
          document.createTextNode(formatUrlDisplay(job.url)),
        );
        linkRow.append(span);
      }
      appendTitleActions(linkRow);
      heading.append(linkRow);
    } else {
      const companyRow = document.createElement('div');
      companyRow.className = 'zj-company-line';
      const companyEl = document.createElement('h2');
      companyEl.className = 'zj-mobile-company';
      companyEl.textContent = job.company.trim() || '公司待补充';
      companyRow.append(companyEl);
      appendTitleActions(companyRow);

      const roleEl = document.createElement('p');
      roleEl.className = 'zj-mobile-role';
      roleEl.textContent = job.position.trim() || '职位待补充';
      heading.append(companyRow, roleEl);

      if (safeUrl || hasMetadata(job)) {
        const metaLine = document.createElement('div');
        metaLine.className = 'zj-meta-line';
        const parts: string[] = [];
        if (job.location?.trim()) parts.push(job.location.trim());
        if (job.salary?.trim()) parts.push(job.salary.trim());
        if (parts.length > 0) {
          const span = document.createElement('span');
          span.textContent = parts.join(' · ');
          metaLine.append(span);
        }
        if (safeUrl) {
          const originLink = document.createElement('a');
          originLink.className = 'zj-inline-link';
          originLink.href = safeUrl;
          originLink.target = '_blank';
          originLink.rel = 'noopener noreferrer';
          originLink.append(
            document.createTextNode(formatUrlDisplay(safeUrl)),
            createIcon('arrow-up-right'),
          );
          metaLine.append(originLink);
        }
        if (job.jd?.trim() && callbacks?.onInspectDetails) {
          const detailBtn = document.createElement('button');
          detailBtn.type = 'button';
          detailBtn.className = 'zj-text-btn';
          detailBtn.textContent = '查看 JD';
          detailBtn.addEventListener('click', () => callbacks.onInspectDetails?.(job));
          metaLine.append(detailBtn);
        }
        heading.append(metaLine);
      }
    }

    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = `zj-mobile-star${job.starred ? ' is-starred' : ''}`;
    starBtn.dataset.action = 'toggle-star';
    starBtn.setAttribute('aria-pressed', String(job.starred));
    starBtn.setAttribute(
      'aria-label',
      `${job.starred ? '取消星标' : '星标'}${displayName}`,
    );
    starBtn.append(createIcon('star'));
    starBtn.addEventListener('click', () => {
      callbacks?.onToggleStar?.(job, !job.starred);
    });

    header.append(heading, starBtn);
    card.append(header);

    // Progress body + footer left control
    let footLeftEl: HTMLElement | null = null;

    if (!latestStep) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'zj-mobile-empty-steps';
      emptyBox.textContent = '尚未登记进展';
      card.append(emptyBox);
    } else if (mode === 'timeline') {
      card.append(
        createJobTimeline(job, callbacks, {
          scrollStates: timelineScrollStates,
          registerCleanup: (fn) => timelineCleanups.push(fn),
        }),
      );
    } else if (mode === 'swipe' && steps.length > 1) {
      const activeIdx = Math.max(
        0,
        Math.min(
          steps.length - 1,
          swipeIndexByJobId.get(job.id) ?? steps.length - 1,
        ),
      );
      swipeIndexByJobId.set(job.id, activeIdx);

      const track = document.createElement('div');
      track.className = 'zj-swipe-track';
      track.dataset.swipeTrack = job.id;
      track.setAttribute(
        'aria-label',
        `${displayName}已登记的 ${steps.length} 个环节`,
      );

      for (const step of steps) {
        const slide = document.createElement('div');
        slide.className = 'zj-swipe-slide';
        slide.append(createStepBoxElement(step, job, callbacks, true));
        track.append(slide);
      }

      const contextRow = document.createElement('div');
      contextRow.className = 'zj-swipe-context';
      const currentLabel = document.createElement('span');
      currentLabel.textContent = `当前：${formatStepInlineText(latestStep)}`;

      const returnLatestBtn = document.createElement('button');
      returnLatestBtn.type = 'button';
      returnLatestBtn.className = 'zj-return-latest';
      returnLatestBtn.dataset.action = 'swipe-latest';
      returnLatestBtn.textContent = '回到最新';
      returnLatestBtn.hidden = activeIdx === steps.length - 1;
      returnLatestBtn.addEventListener('click', () => {
        const target = steps.length - 1;
        swipeIndexByJobId.set(job.id, target);
        scrollTrackTo(track, target, false);
      });

      contextRow.append(currentLabel, returnLatestBtn);
      card.append(track, contextRow);

      // Footer left: stepper + position indicator
      const swipeMeta = document.createElement('div');
      swipeMeta.className = 'zj-swipe-meta';

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'zj-stepper-btn';
      prevBtn.dataset.action = 'swipe-prev';
      prevBtn.setAttribute('aria-label', '上一个历史环节');
      prevBtn.disabled = activeIdx === 0;
      prevBtn.append(createIcon('chevron-left'));
      prevBtn.addEventListener('click', () => {
        const cur = swipeIndexByJobId.get(job.id) ?? steps.length - 1;
        const target = Math.max(0, cur - 1);
        swipeIndexByJobId.set(job.id, target);
        scrollTrackTo(track, target, false);
      });

      const posSpan = document.createElement('span');
      posSpan.dataset.swipePosition = '';
      posSpan.textContent = `${activeIdx + 1} / ${steps.length}`;

      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'zj-stepper-btn';
      nextBtn.dataset.action = 'swipe-next';
      nextBtn.setAttribute('aria-label', '下一个历史环节');
      nextBtn.disabled = activeIdx === steps.length - 1;
      nextBtn.append(createIcon('chevron-right'));
      nextBtn.addEventListener('click', () => {
        const cur = swipeIndexByJobId.get(job.id) ?? steps.length - 1;
        const target = Math.min(steps.length - 1, cur + 1);
        swipeIndexByJobId.set(job.id, target);
        scrollTrackTo(track, target, false);
      });

      swipeMeta.append(prevBtn, posSpan, nextBtn);
      footLeftEl = swipeMeta;
    } else {
      // Expand mode (or single-step card in either mode)
      card.append(createStepBoxElement(latestStep, job, callbacks, false));

      if (steps.length > 1) {
        const histBtn = document.createElement('button');
        histBtn.type = 'button';
        histBtn.className = 'zj-history-toggle';
        histBtn.dataset.action = 'toggle-history';
        histBtn.setAttribute('aria-expanded', String(isExpanded));
        histBtn.append(
          document.createTextNode(`${steps.length} 个环节`),
          createIcon(isExpanded ? 'chevron-up' : 'chevron-down'),
        );
        histBtn.addEventListener('click', () => {
          if (expandedIds.has(job.id)) expandedIds.delete(job.id);
          else expandedIds.add(job.id);
          render();
          root
            .querySelector<HTMLButtonElement>(
              `[data-job-id="${CSS.escape(job.id)}"] [data-action="toggle-history"]`,
            )
            ?.focus({ preventScroll: true });
        });
        footLeftEl = histBtn;
      } else if (callbacks?.onRequestEditDetails && (!job.company.trim() || !job.position.trim())) {
        footLeftEl = null;
      }
    }

    // Footer: contextual quick actions + 其他进展 + 结束申请 (outcome sheet on mobile)
    const toggleMoreMenu = (): void => {
      if (openMenuJobId === job.id) {
        closeMenu(job.id);
      } else {
        openMenuJobId = job.id;
        render();
      }
    };

    const actionGroup = createCardActionsGroup({
      job,
      callbacks,
      isMoreMenuOpen: isMenuOpen,
      onOpenMoreMenu: toggleMoreMenu,
      className: 'zj-mobile-actions',
    });

    const foot = document.createElement('div');
    foot.className = 'zj-mobile-foot';
    if (footLeftEl) {
      foot.append(footLeftEl);
    }
    foot.append(actionGroup);
    card.append(foot);

    // Expanded history list (expand mode)
    if (mode === 'expand' && isExpanded && steps.length > 1) {
      const ol = document.createElement('ol');
      ol.className = 'zj-mobile-history';
      ol.setAttribute('aria-label', `${displayName}历史进展`);

      for (const step of steps) {
        const li = document.createElement('li');
        li.dataset.stepId = step.id;
        const tone = getStepVisualTone(step);
        if (latestStep && step.id === latestStep.id) {
          li.classList.add('is-current');
        }
        if (tone === 'offer') {
          li.classList.add('is-offer');
        }

        const dot = document.createElement('span');
        dot.className = 'zj-mobile-dot';
        const label = document.createElement('span');
        label.textContent = formatStepInlineText(step);
        li.append(dot, label);

        const meta = document.createElement('span');
        meta.className = 'zj-history-step-meta';

        const timeDisplay = getStepTimeDisplay(step);
        if (timeDisplay) {
          const timeSpan = document.createElement('span');
          timeSpan.className = 'zj-history-time';
          timeSpan.textContent = timeDisplay.text;
          meta.append(timeSpan);
        }

        if (callbacks?.onRequestEditStep && isEditableStepKind(step.kind)) {
          const stepParts = formatStepTitle(step);
          const editBtn = document.createElement('button');
          editBtn.type = 'button';
          editBtn.className = 'zj-history-edit-btn';
          editBtn.dataset.action = 'edit-step';
          editBtn.dataset.stepId = step.id;
          editBtn.textContent = `编辑${stepParts.primary}`;
          editBtn.addEventListener('click', () => {
            callbacks.onRequestEditStep?.(job, step);
          });
          meta.append(editBtn);
        }

        li.append(meta);
        ol.append(li);
      }

      card.append(ol);
    }

    // Inline "更多" menu
    if (isMenuOpen && (currentOptions.menuContainer ?? 'inline') === 'inline') {
      const menu = createMoreMenu({
        job,
        callbacks,
        variant: 'inline',
        onClose: () => closeMenu(job.id),
      });
      card.append(menu);
    }

    return card;
  };

  const render = (): void => {
    resizeObserver?.disconnect();
    clearTimelineCleanups();
    closeSheet();
    root.innerHTML = '';

    const jobs = currentOptions.jobs ?? [];
    syncSwipeDefaults(jobs);

    if (jobs.length === 0) {
      root.append(
        createEmptyBoardState({
          title: currentOptions.emptyTitle,
          description: currentOptions.emptyDescription,
          onAddJob: currentOptions.callbacks?.onRequestAddJob,
        }),
      );
      return;
    }

    const sorted = sortJobsByStar(jobs);
    const list = document.createElement('div');
    list.className = 'zj-mobile-list';

    for (const job of sorted) {
      list.append(renderCard(job));
    }
    root.append(list);

    // Optional bottom sheet container when menuContainer === 'sheet'
    if (openMenuJobId && currentOptions.menuContainer === 'sheet') {
      const targetJob = sorted.find((j) => j.id === openMenuJobId);
      if (targetJob) {
        const backdrop = document.createElement('div');
        backdrop.className = 'zj-menu-sheet-backdrop';
        backdrop.addEventListener('click', (e) => {
          if (e.target === backdrop) closeMenu(targetJob.id);
        });
        const menu = createMoreMenu({
          job: targetJob,
          callbacks: currentOptions.callbacks,
          variant: 'sheet',
          onClose: () => closeMenu(targetJob.id),
        });
        backdrop.append(menu);
        sheetBackdropEl = backdrop;
        root.append(backdrop);
      }
    }

    // Initialize swipe tracks to latest (or preserved viewing index)
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const track = entry.target as HTMLElement;
          const width = track.clientWidth;
          if (!width) continue;
          const prevWidth = trackLastWidth.get(track);
          if (prevWidth === width) continue;
          trackLastWidth.set(track, width);
          const jobId = track.dataset.swipeTrack;
          if (!jobId) continue;
          const job = sorted.find((j) => j.id === jobId);
          if (!job) continue;
          const targetIdx =
            swipeIndexByJobId.get(jobId) ?? Math.max(0, job.steps.length - 1);
          scrollTrackTo(track, targetIdx, true);
        }
      });
    }

    root.querySelectorAll<HTMLElement>('.zj-swipe-track').forEach((track) => {
      const jobId = track.dataset.swipeTrack;
      if (!jobId) return;
      const job = sorted.find((j) => j.id === jobId);
      const cardEl = track.closest<HTMLElement>('.zj-mobile-card');
      if (!job || !cardEl) return;

      const targetIdx =
        swipeIndexByJobId.get(jobId) ?? Math.max(0, job.steps.length - 1);
      if (track.clientWidth > 0) {
        trackLastWidth.set(track, track.clientWidth);
        scrollTrackTo(track, targetIdx, true);
      }

      track.addEventListener(
        'scroll',
        () => {
          updateTrackIndicators(track, job, cardEl);
        },
        { passive: true },
      );

      resizeObserver?.observe(track);
    });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && openMenuJobId) {
      event.stopPropagation();
      closeMenu(openMenuJobId);
    }
  };
  root.addEventListener('keydown', onKeyDown);

  render();

  return {
    element: root,
    update(nextOptions: MobileJobBoardOptions) {
      currentOptions = { ...nextOptions };
      render();
    },
    getViewingStepIndex(jobId: string): number | null {
      return swipeIndexByJobId.get(jobId) ?? null;
    },
    setViewingStepIndex(jobId: string, index: number) {
      const job = (currentOptions.jobs ?? []).find((j) => j.id === jobId);
      if (!job || job.steps.length === 0) return;
      const clamped = Math.max(0, Math.min(job.steps.length - 1, index));
      swipeIndexByJobId.set(jobId, clamped);
      const cardEl = root.querySelector<HTMLElement>(
        `[data-job-id="${CSS.escape(jobId)}"]`,
      );
      const track = cardEl?.querySelector<HTMLElement>('.zj-swipe-track');
      if (track && cardEl) {
        scrollTrackTo(track, clamped, true);
        updateTrackIndicators(track, job, cardEl);
      }
    },
    closeMenu: () => closeMenu(),
    destroy() {
      resizeObserver?.disconnect();
      clearTimelineCleanups();
      closeSheet();
      root.removeEventListener('keydown', onKeyDown);
      root.remove();
    },
  };
}
