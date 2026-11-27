import { createIcon } from '../icons';
import type { EmptyStateOptions } from '../types';

export function createEmptyBoardState(options: EmptyStateOptions = {}): HTMLElement {
  const section = document.createElement('section');
  section.className = 'zj-empty-board';
  section.setAttribute('aria-label', '空看板');

  const title = document.createElement('h2');
  title.className = 'zj-empty-board-title';
  title.textContent = options.title ?? '还没有记录岗位';

  const desc = document.createElement('p');
  desc.className = 'zj-empty-board-desc';
  desc.textContent =
    options.description ??
    '可以先粘贴一个招聘链接收藏，或直接从公司、职位与当前面试轮次开始记录。';

  section.append(title, desc);

  if (options.onAddJob) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'zj-btn zj-btn-primary';
    button.dataset.action = 'add-job';
    button.append(
      createIcon('plus'),
      document.createTextNode(options.ctaLabel ?? '添加岗位'),
    );
    button.addEventListener('click', () => {
      options.onAddJob?.();
    });
    section.append(button);
  }

  return section;
}
