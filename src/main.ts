import type { JobBoardStore } from './data/contract.ts';
import { openJobBoard } from './data/index.ts';
import { createJobBoardApp } from './ui/index.ts';

const root = document.getElementById('app');
if (root) {
  void openJobBoard()
    .then((store: JobBoardStore) => {
      createJobBoardApp({
        container: root,
        store,
      });
    })
    .catch((err: unknown) => {
      const notice = document.createElement('div');
      notice.className = 'zj-ui-scope zj-empty-board';
      const title = document.createElement('h2');
      title.className = 'zj-empty-board-title';
      title.textContent = '无法打开求职看板';
      const msg = document.createElement('p');
      msg.className = 'zj-empty-board-desc';
      msg.textContent =
        err instanceof Error ? err.message : '初始化存储适配器失败，请刷新重试。';
      notice.append(title, msg);
      root.replaceChildren(notice);
    });
}
