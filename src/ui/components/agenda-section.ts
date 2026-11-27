import { deriveUpcomingAgenda } from '../format';
import { createIcon } from '../icons';
import type { AgendaItem, BoardHandle, JobCardData } from '../types';

export interface AgendaSectionOptions {
  jobs: readonly JobCardData[];
  onSelectJob?: (jobId: string) => void;
}

export function createAgendaSection(
  initialOptions: AgendaSectionOptions,
): BoardHandle<AgendaSectionOptions> {
  const root = document.createElement('section');
  root.className = 'zj-ui-scope zj-agenda-section';
  root.setAttribute('aria-label', '近期安排');

  let current = initialOptions;

  const renderItem = (item: AgendaItem): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'zj-agenda-row';
    if (item.kind === 'interview') {
      row.classList.add('is-interview');
    } else {
      row.classList.add('is-deadline');
    }
    row.dataset.jobId = item.jobId;
    row.dataset.stepId = item.stepId;

    const badgeIcon = createIcon(
      item.kind === 'interview' ? 'file-text' : 'external-link',
      'zj-icon zj-agenda-icon',
    );
    // Use crisp clock/hourglass indicator style dot + semantic color
    const dot = document.createElement('span');
    dot.className = 'zj-agenda-dot';
    dot.setAttribute('aria-hidden', 'true');

    const info = document.createElement('div');
    info.className = 'zj-agenda-info';

    const titleEl = current.onSelectJob
      ? document.createElement('button')
      : document.createElement('span');
    if (titleEl instanceof HTMLButtonElement) {
      titleEl.type = 'button';
      titleEl.className = 'zj-agenda-title-btn';
      titleEl.addEventListener('click', () => current.onSelectJob?.(item.jobId));
    } else {
      titleEl.className = 'zj-agenda-title';
    }
    titleEl.textContent = item.title;

    const sub = document.createElement('span');
    sub.className = 'zj-agenda-sub';
    sub.textContent = item.subtitle;

    info.append(titleEl, sub);

    const timeEl = document.createElement(
      item.kind === 'interview' ? 'strong' : 'span',
    );
    timeEl.className = 'zj-agenda-time';
    timeEl.textContent = item.timeText;

    void badgeIcon;
    row.append(dot, info, timeEl);
    return row;
  };

  const render = (): void => {
    root.innerHTML = '';
    const items = deriveUpcomingAgenda(current.jobs);

    const head = document.createElement('div');
    head.className = 'zj-section-heading';
    const h2 = document.createElement('h2');
    h2.textContent = '近期安排';
    const count = document.createElement('span');
    count.className = 'zj-section-count';
    count.textContent = items.length > 0 ? `${items.length} 项待跟进` : '暂无安排';
    head.append(h2, count);

    const panel = document.createElement('div');
    panel.className = 'zj-agenda-panel';

    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'zj-agenda-empty';
      empty.textContent =
        '当前没有未结束岗位的待面试安排、未完成笔试或 Offer 答复期限。';
      panel.append(empty);
    } else {
      for (const item of items) {
        panel.append(renderItem(item));
      }
    }

    root.append(head, panel);
  };

  render();

  return {
    element: root,
    update(next) {
      current = next;
      render();
    },
    destroy() {
      root.remove();
    },
  };
}
