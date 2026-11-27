import { createIcon } from '../icons.ts';

export type SchedulePageId = 'board' | 'calendar' | 'timeline';

export interface ScheduleNavigationState {
  activePage: SchedulePageId;
  savedBoardScrollY: number;
}

export function createScheduleNavigationState(): ScheduleNavigationState {
  return {
    activePage: 'board',
    savedBoardScrollY: 0,
  };
}

export function normalizePageForDevice(
  page: SchedulePageId,
  device: 'mobile' | 'desktop',
  inlineCalendar: boolean = device === 'desktop',
): SchedulePageId {
  if (inlineCalendar && page === 'calendar') {
    return 'board';
  }
  return page;
}

export function captureBoardScrollY(state: ScheduleNavigationState): void {
  if (typeof window !== 'undefined' && typeof window.scrollY === 'number') {
    state.savedBoardScrollY = Math.max(0, window.scrollY);
  }
}

export function restoreBoardScrollY(state: ScheduleNavigationState): void {
  if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') {
    return;
  }
  const top = state.savedBoardScrollY;
  const apply = () => {
    window.scrollTo({ top, behavior: 'auto' });
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => apply());
  } else {
    apply();
  }
}

export interface ScheduleNavBarOptions {
  device: 'mobile' | 'desktop';
  /** Whether calendar renders side-by-side next to the board (wide desktop >= 1200px). */
  inlineCalendar?: boolean;
  activePage: SchedulePageId;
  onSelectPage: (page: SchedulePageId) => void;
}

export function createScheduleNavBar(
  initialOptions: ScheduleNavBarOptions,
): {
  element: HTMLElement;
  update: (next: ScheduleNavBarOptions) => void;
} {
  const nav = document.createElement('nav');
  nav.className = 'zj-view-nav';
  nav.setAttribute('aria-label', '视图切换');

  let current = initialOptions;

  const render = (): void => {
    nav.innerHTML = '';
    const hasInlineCalendar =
      current.inlineCalendar ?? current.device === 'desktop';
    const pages: ReadonlyArray<{ id: SchedulePageId; label: string }> =
      hasInlineCalendar
        ? [
            { id: 'board', label: '岗位' },
            { id: 'timeline', label: '时间线' },
          ]
        : [
            { id: 'board', label: '岗位' },
            { id: 'calendar', label: '日历' },
            { id: 'timeline', label: '时间线' },
          ];

    for (const item of pages) {
      const active = current.activePage === item.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `zj-view-tab${active ? ' is-active' : ''}`;
      btn.dataset.action = 'switch-view';
      btn.dataset.page = item.id;
      btn.setAttribute('aria-current', active ? 'page' : 'false');
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        current.onSelectPage(item.id);
      });
      nav.append(btn);
    }
  };

  render();

  return {
    element: nav,
    update(next) {
      current = next;
      render();
    },
  };
}

export function createSchedulePageHeader(onBackToBoard: () => void): HTMLElement {
  const head = document.createElement('div');
  head.className = 'zj-schedule-page-head';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'zj-text-btn zj-back-to-board-btn';
  backBtn.dataset.action = 'back-to-board';
  backBtn.append(createIcon('chevron-left'), document.createTextNode('返回岗位'));
  backBtn.addEventListener('click', onBackToBoard);

  head.append(backBtn);
  return head;
}

export interface LocateTimerRef {
  timer: ReturnType<typeof setTimeout> | null;
}

export function clearLocatedHighlight(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('.is-located').forEach((el) => {
    el.classList.remove('is-located');
    delete el.dataset.located;
  });
}

/**
 * Scrolls to and transiently highlights the source job card and step node
 * when returning from Calendar or cross-job Timeline views.
 */
export function locateJobAndStep(
  container: HTMLElement,
  jobId: string,
  stepId: string,
  timerRef: LocateTimerRef,
): boolean {
  if (timerRef.timer !== null) {
    clearTimeout(timerRef.timer);
    timerRef.timer = null;
  }
  clearLocatedHighlight(container);

  const cardEl = container.querySelector<HTMLElement>(
    `[data-job-id="${CSS.escape(jobId)}"]`,
  );
  if (!cardEl) return false;

  cardEl.classList.add('is-located');
  cardEl.dataset.located = 'true';
  if (typeof cardEl.scrollIntoView === 'function') {
    cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const stepEl = cardEl.querySelector<HTMLElement>(
    `[data-step-id="${CSS.escape(stepId)}"]`,
  );
  if (stepEl) {
    stepEl.classList.add('is-located');
    stepEl.dataset.located = 'true';
    if (typeof stepEl.scrollIntoView === 'function') {
      stepEl.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
    const stepBtn = stepEl.querySelector<HTMLButtonElement>('[data-action="edit-step"]');
    stepBtn?.focus({ preventScroll: true });
  }

  timerRef.timer = setTimeout(() => {
    clearLocatedHighlight(container);
    timerRef.timer = null;
  }, 2000);

  return true;
}
