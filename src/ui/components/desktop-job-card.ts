import {
  createJobTimeline,
  type TimelineScrollState,
} from './job-timeline.ts';
import {
  formatUrlDisplay,
  getJobDisplayName,
  getResultLabel,
  hasMetadata,
  isLinkOnlyJob,
  sanitizeHttpUrl,
  sortJobsByStar,
} from '../format.ts';
import { createIcon } from '../icons';
import type { BoardHandle, JobBoardCallbacks, JobCardData } from '../types';
import { createEmptyBoardState } from './empty-state';
import { createCardActionsGroup, createMoreMenu } from './progress-menu';

export interface DesktopJobCardOptions {
  job: JobCardData;
  callbacks?: JobBoardCallbacks;
  activeMenuJobId?: string | null;
  onOpenMenu?: (job: JobCardData, trigger: HTMLButtonElement) => void;
  timelineScrollStates?: Map<string, TimelineScrollState>;
  registerTimelineCleanup?: (cleanup: () => void) => void;
}

export function createDesktopJobCard(options: DesktopJobCardOptions): HTMLElement {
  const {
    job,
    callbacks,
    activeMenuJobId = null,
    onOpenMenu,
    timelineScrollStates,
    registerTimelineCleanup,
  } = options;

  const displayName = getJobDisplayName(job);
  const linkOnly = isLinkOnlyJob(job);
  const card = document.createElement('article');
  card.className = 'zj-desktop-card';
  if (linkOnly && job.steps.length === 0) {
    card.classList.add('is-link-empty');
  }
  if (job.result !== null) {
    card.classList.add('is-ended');
  }
  card.dataset.jobId = job.id;
  card.setAttribute('aria-label', displayName);

  // 1. 岗位识别列
  const identity = document.createElement('div');
  identity.className = 'zj-desktop-identity';

  const companyLine = document.createElement('div');
  companyLine.className = 'zj-company-line';

  const safeUrl = sanitizeHttpUrl(job.url);

  if (linkOnly && job.url) {
    if (safeUrl) {
      const link = document.createElement('a');
      link.className = 'zj-link-primary';
      link.href = safeUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.append(
        createIcon('link'),
        document.createTextNode(formatUrlDisplay(safeUrl)),
        createIcon('arrow-up-right'),
      );
      companyLine.append(link);
    } else {
      const textOnly = document.createElement('span');
      textOnly.className = 'zj-link-primary';
      textOnly.append(
        createIcon('link'),
        document.createTextNode(formatUrlDisplay(job.url)),
      );
      companyLine.append(textOnly);
    }
  } else {
    const h2 = document.createElement('h2');
    h2.className = 'zj-company-name';
    h2.textContent = job.company.trim() || '公司待补充';
    companyLine.append(h2);
  }

  const starBtn = document.createElement('button');
  starBtn.type = 'button';
  starBtn.className = `zj-star-btn${job.starred ? ' is-starred' : ''}`;
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
  companyLine.append(starBtn);

  if (job.result) {
    const resultBadge = document.createElement('span');
    resultBadge.className = `zj-result-badge${job.result === 'declined' ? ' is-declined' : ''}`;
    resultBadge.textContent = getResultLabel(job.result);
    companyLine.append(resultBadge);
  }

  const needsSupplementHighlight = !job.company.trim() || !job.position.trim();
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
    companyLine.append(editBtn);
  }

  identity.append(companyLine);

  if (!linkOnly) {
    const role = document.createElement('p');
    role.className = 'zj-role-desktop';
    role.textContent = job.position.trim() || '职位待补充';
    identity.append(role);
  }

  if (!linkOnly && (job.url?.trim() || hasMetadata(job))) {
    const metaLine = document.createElement('div');
    metaLine.className = 'zj-meta-line';
    const metaTextParts: string[] = [];
    if (job.location?.trim()) metaTextParts.push(job.location.trim());
    if (job.salary?.trim()) metaTextParts.push(job.salary.trim());
    if (metaTextParts.length > 0) {
      const span = document.createElement('span');
      span.textContent = metaTextParts.join(' · ');
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
      detailBtn.dataset.action = 'inspect-details';
      detailBtn.textContent = '查看 JD';
      detailBtn.addEventListener('click', () => callbacks.onInspectDetails?.(job));
      metaLine.append(detailBtn);
    }
    identity.append(metaLine);
  }

  // 2. 横向进展列
  let middleEl: HTMLElement;
  if (job.steps.length === 0) {
    const emptySteps = document.createElement('div');
    emptySteps.className = 'zj-collection-empty';
    emptySteps.textContent = '尚未登记进展';
    middleEl = emptySteps;
  } else {
    middleEl = createJobTimeline(job, callbacks, {
      scrollStates: timelineScrollStates,
      registerCleanup: registerTimelineCleanup,
    });
  }

  // 3. 操作列（主动作 + 预测下阶段 + 稳定「更多」入口）
  const actions = createCardActionsGroup({
    job,
    callbacks,
    isMoreMenuOpen: activeMenuJobId === job.id,
    onOpenMoreMenu: onOpenMenu,
    className: 'zj-desktop-actions',
  });

  card.append(identity, middleEl, actions);
  return card;
}

export interface DesktopJobBoardOptions {
  jobs?: readonly JobCardData[];
  callbacks?: JobBoardCallbacks;
  emptyTitle?: string;
  emptyDescription?: string;
}

export interface DesktopJobBoardHandle extends BoardHandle<DesktopJobBoardOptions> {
  closeMenu: () => void;
  getOpenMenuJobId: () => string | null;
}

export function createDesktopJobBoard(
  initialOptions: DesktopJobBoardOptions = {},
): DesktopJobBoardHandle {
  const root = document.createElement('div');
  root.className = 'zj-ui-scope zj-desktop-board';

  let currentOptions: DesktopJobBoardOptions = { ...initialOptions };
  let openMenuJobId: string | null = null;
  let activeMenuEl: HTMLElement | null = null;
  let activeTriggerEl: HTMLButtonElement | null = null;
  const timelineScrollStates = new Map<string, TimelineScrollState>();
  const timelineCleanups: Array<() => void> = [];

  const clearTimelineCleanups = (): void => {
    while (timelineCleanups.length > 0) {
      timelineCleanups.pop()?.();
    }
  };

  const closeMenu = (restoreFocus = false): void => {
    if (activeMenuEl) {
      activeMenuEl.remove();
      activeMenuEl = null;
    }
    const prevTrigger = activeTriggerEl;
    activeTriggerEl = null;
    if (openMenuJobId !== null) {
      openMenuJobId = null;
      const btn = root.querySelector<HTMLButtonElement>(
        '[data-action="open-more-menu"][aria-expanded="true"]',
      );
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
    if (restoreFocus && prevTrigger && prevTrigger.isConnected) {
      prevTrigger.focus({ preventScroll: true });
    }
  };

  const positionPopover = (menu: HTMLElement, trigger: HTMLElement): void => {
    const margin = 12;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 260;
    const menuHeight = menu.offsetHeight || 280;

    let left = rect.right - menuWidth;
    if (left < margin) {
      left = Math.min(rect.left, window.innerWidth - menuWidth - margin);
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));

    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    let top = rect.bottom + 8;
    if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
      top = Math.max(margin, rect.top - menuHeight - 8);
    } else if (top + menuHeight > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - menuHeight - margin);
    }

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  };

  const openMenuForJob = (job: JobCardData, trigger: HTMLButtonElement): void => {
    if (openMenuJobId === job.id) {
      closeMenu(true);
      return;
    }
    closeMenu(false);
    openMenuJobId = job.id;
    activeTriggerEl = trigger;
    trigger.setAttribute('aria-expanded', 'true');

    const menu = createMoreMenu({
      job,
      callbacks: currentOptions.callbacks,
      variant: 'popover',
      onClose: () => closeMenu(true),
    });
    activeMenuEl = menu;
    root.append(menu);
    positionPopover(menu, trigger);
    menu.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  };

  const render = (): void => {
    closeMenu(false);
    clearTimelineCleanups();
    root.innerHTML = '';

    const jobs = currentOptions.jobs ?? [];
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

    const list = document.createElement('div');
    list.className = 'zj-desktop-list';

    const sorted = sortJobsByStar(jobs);
    for (const job of sorted) {
      const card = createDesktopJobCard({
        job,
        callbacks: currentOptions.callbacks,
        activeMenuJobId: openMenuJobId,
        onOpenMenu: openMenuForJob,
        timelineScrollStates,
        registerTimelineCleanup: (fn) => timelineCleanups.push(fn),
      });
      list.append(card);
    }

    root.append(list);
  };

  const onDocumentClick = (event: MouseEvent): void => {
    if (!activeMenuEl) return;
    const target = event.target as Node | null;
    if (!target) return;
    if (activeMenuEl.contains(target)) return;
    if (activeTriggerEl && activeTriggerEl.contains(target)) return;
    closeMenu(false);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && activeMenuEl) {
      event.stopPropagation();
      closeMenu(true);
    }
  };

  const onReposition = (): void => {
    if (activeMenuEl && activeTriggerEl && activeTriggerEl.isConnected) {
      positionPopover(activeMenuEl, activeTriggerEl);
    }
  };

  document.addEventListener('click', onDocumentClick);
  root.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onReposition);
  window.addEventListener('scroll', onReposition, true);

  render();

  return {
    element: root,
    update(nextOptions: DesktopJobBoardOptions) {
      currentOptions = { ...nextOptions };
      render();
    },
    closeMenu: () => closeMenu(false),
    getOpenMenuJobId: () => openMenuJobId,
    destroy() {
      closeMenu(false);
      clearTimelineCleanups();
      document.removeEventListener('click', onDocumentClick);
      root.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      root.remove();
    },
  };
}
