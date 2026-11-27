import { createIcon } from '../icons';

export type FeedbackTone = 'idle' | 'saving' | 'saved' | 'failed' | 'unknown' | 'conflict';

export interface FeedbackState {
  tone: FeedbackTone;
  message: string;
  /** Whether a refresh check action should be shown (e.g. unknown or conflict) */
  allowRefresh?: boolean;
  /** Whether this alert persists across a successful read refresh until solved or dismissed */
  sticky?: boolean;
}

export interface FeedbackBannerHandle {
  element: HTMLElement;
  setState: (state: FeedbackState) => void;
  getState: () => FeedbackState;
  onRefreshAcknowledge: (refreshSummary?: string) => void;
  clear: () => void;
  destroy: () => void;
}

export function createFeedbackBanner(options: {
  onRefresh?: () => void;
}): FeedbackBannerHandle {
  const root = document.createElement('div');
  root.className = 'zj-feedback-banner';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.hidden = true;

  const textWrap = document.createElement('div');
  textWrap.className = 'zj-feedback-text';

  const messageEl = document.createElement('span');
  const noteEl = document.createElement('span');
  noteEl.className = 'zj-feedback-note';
  noteEl.hidden = true;
  textWrap.append(messageEl, noteEl);

  const actions = document.createElement('div');
  actions.className = 'zj-feedback-actions';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'zj-feedback-action-btn';
  refreshBtn.dataset.action = 'refresh-from-banner';
  refreshBtn.append(createIcon('rotate-ccw'), document.createTextNode('刷新查看'));
  refreshBtn.addEventListener('click', () => options.onRefresh?.());

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'zj-icon-btn zj-feedback-dismiss';
  dismissBtn.setAttribute('aria-label', '关闭提示');
  dismissBtn.append(createIcon('x'));

  actions.append(refreshBtn, dismissBtn);
  root.append(textWrap, actions);

  let state: FeedbackState = { tone: 'idle', message: '' };
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (autoHideTimer !== null) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  };

  const render = (): void => {
    if (state.tone === 'idle' || !state.message) {
      root.hidden = true;
      root.dataset.tone = 'idle';
      return;
    }
    root.hidden = false;
    root.dataset.tone = state.tone;
    root.setAttribute(
      'role',
      state.tone === 'failed' || state.tone === 'unknown' || state.tone === 'conflict'
        ? 'alert'
        : 'status',
    );
    messageEl.textContent = state.message;
    refreshBtn.hidden = !state.allowRefresh || !options.onRefresh;
    dismissBtn.hidden = state.tone === 'saving';
  };

  const setState = (next: FeedbackState): void => {
    clearTimer();
    noteEl.hidden = true;
    noteEl.textContent = '';
    state = next;
    render();
    if (next.tone === 'saved' && !next.sticky) {
      autoHideTimer = setTimeout(() => {
        if (state.tone === 'saved') {
          state = { tone: 'idle', message: '' };
          render();
        }
      }, 3200);
    }
  };

  dismissBtn.addEventListener('click', () => {
    clearTimer();
    noteEl.hidden = true;
    state = { tone: 'idle', message: '' };
    render();
  });

  return {
    element: root,
    setState,
    getState: () => state,
    onRefreshAcknowledge(refreshSummary?: string) {
      // Preserve unresolved failed/unknown/conflict alert across an active refresh!
      if (
        state.sticky ||
        state.tone === 'failed' ||
        state.tone === 'unknown' ||
        state.tone === 'conflict'
      ) {
        noteEl.textContent =
          refreshSummary ?? '（已重读最新数据，请核对上方提示与当前记录）';
        noteEl.hidden = false;
        render();
      }
    },
    clear() {
      clearTimer();
      noteEl.hidden = true;
      state = { tone: 'idle', message: '' };
      render();
    },
    destroy() {
      clearTimer();
      root.remove();
    },
  };
}
