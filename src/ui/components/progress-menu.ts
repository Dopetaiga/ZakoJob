import {
  formatStepInlineText,
  formatStepTitle,
  getCompleteActionLabel,
  getContextualJobActions,
  getJobDisplayName,
  getLatestStep,
  isEditableStepKind,
} from '../format.ts';
import { createIcon } from '../icons';
import type { JobBoardCallbacks, JobCardData } from '../types';

export interface CardActionsGroupOptions {
  job: JobCardData;
  callbacks?: JobBoardCallbacks;
  isMoreMenuOpen?: boolean;
  onOpenMoreMenu?: (job: JobCardData, trigger: HTMLButtonElement) => void;
  /** Legacy alias kept for backwards compatibility */
  isOutcomeMenuOpen?: boolean;
  /** Legacy alias kept for backwards compatibility */
  onOpenOutcomeMenu?: (job: JobCardData, trigger: HTMLButtonElement) => void;
  className?: string;
}

/**
 * Shared contextual card action buttons rendered identically on desktop and mobile cards:
 * - primary & predicted next-stage buttons from getContextualJobActions()
 * - single stable "更多" trigger organizing other progress, profile details, node edit/withdraw, and outcome
 */
export function createCardActionsGroup(options: CardActionsGroupOptions): HTMLElement {
  const {
    job,
    callbacks,
    isMoreMenuOpen,
    onOpenMoreMenu,
    isOutcomeMenuOpen = false,
    onOpenOutcomeMenu,
    className = 'zj-card-actions',
  } = options;

  const menuOpen = isMoreMenuOpen ?? isOutcomeMenuOpen;
  const openMenu = onOpenMoreMenu ?? onOpenOutcomeMenu;
  const displayName = getJobDisplayName(job);

  const container = document.createElement('div');
  container.className = className;

  const primaryGroup = document.createElement('div');
  primaryGroup.className = 'zj-card-quick-actions';

  const actions = getContextualJobActions(job);

  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `zj-card-action-btn${action.primary ? ' is-primary' : ''}`;
    btn.dataset.jobId = job.id;

    if (action.kind === 'complete-current') {
      btn.dataset.action = action.actionId;
      btn.dataset.targetStepId = action.targetStep.id;
      btn.append(createIcon('check'), document.createTextNode(action.label));
      btn.addEventListener('click', () => {
        callbacks?.onCompleteCurrentStep?.(job, action.targetStep);
      });
    } else if (action.kind === 'edit-step') {
      btn.dataset.action = action.actionId;
      btn.dataset.targetStepId = action.targetStep.id;
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        callbacks?.onRequestEditStep?.(job, action.targetStep);
      });
    } else if (action.kind === 'append-step') {
      btn.dataset.action = `log-${action.actionId}`;
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        callbacks?.onSubmitNewStep?.(job, action.input);
      });
    } else if (action.kind === 'clear-result') {
      btn.dataset.action = 'clear-result';
      btn.append(createIcon('rotate-ccw'), document.createTextNode(action.label));
      btn.addEventListener('click', () => {
        callbacks?.onSetResult?.(job, null);
      });
    } else {
      btn.dataset.action = 'open-more-menu';
      btn.setAttribute('aria-expanded', String(menuOpen));
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        openMenu?.(job, btn);
      });
    }

    primaryGroup.append(btn);
  }

  if (primaryGroup.children.length > 0) {
    container.append(primaryGroup);
  }

  if (openMenu) {
    const secondary = document.createElement('div');
    secondary.className = 'zj-card-secondary-actions';

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'zj-text-btn zj-more-btn';
    moreBtn.dataset.action = 'open-more-menu';
    moreBtn.dataset.jobId = job.id;
    moreBtn.setAttribute('aria-expanded', String(menuOpen));
    moreBtn.setAttribute('aria-label', `更多操作 · ${displayName}`);
    moreBtn.append(document.createTextNode('更多'), createIcon('chevron-down'));
    moreBtn.addEventListener('click', () => {
      openMenu(job, moreBtn);
    });

    secondary.append(moreBtn);
    container.append(secondary);
  }

  return container;
}

export interface MoreMenuOptions {
  job: JobCardData;
  callbacks?: JobBoardCallbacks;
  variant: 'popover' | 'inline' | 'sheet';
  onClose: () => void;
}

/**
 * Unified secondary "更多" menu with distinct groups:
 * 1. Progress & step management (other progress, edit current node, withdraw latest step)
 * 2. Job profile details (edit/supplement profile, inspect JD)
 * 3. Independent application outcome (已挂 / 已拒 / 恢复跟进)
 */
export function createMoreMenu(options: MoreMenuOptions): HTMLElement {
  const { job, callbacks, variant, onClose } = options;
  const displayName = getJobDisplayName(job);
  const latestStep = getLatestStep(job);
  const ended = job.result !== null;

  const menu = document.createElement('div');
  menu.className = `zj-menu zj-menu-${variant}`;
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', `${displayName}更多操作`);
  menu.dataset.jobId = job.id;
  if (latestStep) {
    menu.dataset.targetStepId = latestStep.id;
  }

  const head = document.createElement('div');
  head.className = 'zj-menu-head';

  const headText = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'zj-menu-title';
  title.textContent = displayName;
  headText.append(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'zj-menu-subtitle';
  if (ended) {
    subtitle.textContent = `当前结果：${job.result === 'rejected' ? '已挂' : '已拒'}（保留最后进展）`;
  } else if (latestStep) {
    subtitle.textContent = `当前环节：${formatStepInlineText(latestStep)}`;
  } else {
    subtitle.textContent = '尚未登记进展';
  }
  headText.append(subtitle);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'zj-menu-close';
  closeBtn.dataset.action = 'close-menu';
  closeBtn.setAttribute('aria-label', '关闭更多菜单');
  closeBtn.append(createIcon('x'));
  closeBtn.addEventListener('click', () => onClose());

  head.append(headText, closeBtn);
  menu.append(head);

  let hasAnyGroup = false;

  // Group 1: Progress & node actions
  const canAddOtherStep = !ended && Boolean(callbacks?.onRequestAddStep);
  const canEditLatestStep = Boolean(
    latestStep && callbacks?.onRequestEditStep && isEditableStepKind(latestStep.kind),
  );
  const canWithdrawLatest = Boolean(latestStep && callbacks?.onRemoveLatestStep);

  if (canAddOtherStep || canEditLatestStep || canWithdrawLatest) {
    hasAnyGroup = true;
    const progressLabel = document.createElement('div');
    progressLabel.className = 'zj-menu-group-label';
    progressLabel.textContent = '进展与节点';
    menu.append(progressLabel);

    if (canAddOtherStep) {
      const otherBtn = document.createElement('button');
      otherBtn.type = 'button';
      otherBtn.className = 'zj-menu-action';
      otherBtn.dataset.action = 'other-progress';
      otherBtn.append(
        createIcon('circle-plus'),
        document.createTextNode('登记其他进展'),
        createIcon('chevron-right', 'zj-icon zj-icon-trailing'),
      );
      otherBtn.addEventListener('click', () => {
        onClose();
        callbacks?.onRequestAddStep?.(job);
      });
      menu.append(otherBtn);
    }

    if (latestStep && canEditLatestStep) {
      const stepParts = formatStepTitle(latestStep);
      const editCurrentBtn = document.createElement('button');
      editCurrentBtn.type = 'button';
      editCurrentBtn.className = 'zj-menu-action';
      editCurrentBtn.dataset.action = 'edit-current-step';
      editCurrentBtn.dataset.targetStepId = latestStep.id;
      const editLabel =
        latestStep.kind === 'written_offer' && !latestStep.deadline
          ? '添加答复期限'
          : `编辑${stepParts.primary}`;
      editCurrentBtn.append(createIcon('pencil'), document.createTextNode(editLabel));
      editCurrentBtn.addEventListener('click', () => {
        onClose();
        callbacks?.onRequestEditStep?.(job, latestStep);
      });
      menu.append(editCurrentBtn);
    }

    if (latestStep && canWithdrawLatest) {
      const stepParts = formatStepTitle(latestStep);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'zj-menu-action';
      removeBtn.dataset.action = 'remove-latest-step';
      removeBtn.dataset.targetStepId = latestStep.id;
      removeBtn.append(
        createIcon('rotate-ccw'),
        document.createTextNode(`撤回末步（${stepParts.primary}）`),
      );
      removeBtn.addEventListener('click', () => {
        onClose();
        callbacks?.onRemoveLatestStep?.(job, latestStep);
      });
      menu.append(removeBtn);
    }
  }

  // Group 2: Job profile details
  const canEditDetails = Boolean(callbacks?.onRequestEditDetails);
  const canInspectJd = Boolean(job.jd?.trim() && callbacks?.onInspectDetails);

  if (canEditDetails || canInspectJd) {
    const infoLabel = document.createElement('div');
    infoLabel.className = `zj-menu-group-label${hasAnyGroup ? ' has-divider' : ''}`;
    infoLabel.textContent = '岗位资料';
    menu.append(infoLabel);
    hasAnyGroup = true;

    if (canEditDetails) {
      const needsSupplement = !job.company.trim() || !job.position.trim();
      const editInfoBtn = document.createElement('button');
      editInfoBtn.type = 'button';
      editInfoBtn.className = 'zj-menu-action';
      editInfoBtn.dataset.action = 'menu-edit-details';
      editInfoBtn.append(
        createIcon('file-text'),
        document.createTextNode(needsSupplement ? '补充岗位资料' : '编辑岗位资料'),
      );
      editInfoBtn.addEventListener('click', () => {
        onClose();
        callbacks?.onRequestEditDetails?.(job);
      });
      menu.append(editInfoBtn);
    }

    if (canInspectJd) {
      const jdBtn = document.createElement('button');
      jdBtn.type = 'button';
      jdBtn.className = 'zj-menu-action';
      jdBtn.dataset.action = 'menu-inspect-details';
      jdBtn.append(createIcon('file-text'), document.createTextNode('查看 JD'));
      jdBtn.addEventListener('click', () => {
        onClose();
        callbacks?.onInspectDetails?.(job);
      });
      menu.append(jdBtn);
    }
  }

  // Group 3: Independent application outcome
  if (callbacks?.onSetResult) {
    const resultLabel = document.createElement('div');
    resultLabel.className = `zj-menu-group-label${hasAnyGroup ? ' has-divider' : ''}`;
    resultLabel.textContent = '申请结果';
    menu.append(resultLabel);

    const rejectedBtn = document.createElement('button');
    rejectedBtn.type = 'button';
    rejectedBtn.className = `zj-menu-action is-danger${job.result === 'rejected' ? ' is-selected' : ''}`;
    rejectedBtn.dataset.action = 'set-result-rejected';
    rejectedBtn.setAttribute('aria-label', '已挂，招聘方结束');
    rejectedBtn.append(
      createIcon('circle-x'),
      document.createTextNode('已挂（招聘方结束）'),
    );
    rejectedBtn.addEventListener('click', () => {
      callbacks.onSetResult?.(job, 'rejected');
      onClose();
    });

    const declinedBtn = document.createElement('button');
    declinedBtn.type = 'button';
    declinedBtn.className = `zj-menu-action${job.result === 'declined' ? ' is-selected' : ''}`;
    declinedBtn.dataset.action = 'set-result-declined';
    declinedBtn.setAttribute('aria-label', '已拒，我主动拒绝');
    declinedBtn.append(
      createIcon('minus'),
      document.createTextNode('已拒（我主动拒绝）'),
    );
    declinedBtn.addEventListener('click', () => {
      callbacks.onSetResult?.(job, 'declined');
      onClose();
    });

    menu.append(rejectedBtn, declinedBtn);

    if (ended) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'zj-menu-action';
      clearBtn.dataset.action = 'clear-result';
      clearBtn.append(
        createIcon('rotate-ccw'),
        document.createTextNode('恢复跟进'),
      );
      clearBtn.addEventListener('click', () => {
        callbacks.onSetResult?.(job, null);
        onClose();
      });
      menu.append(clearBtn);
    }
  }

  return menu;
}

export interface OutcomeMenuOptions {
  job: JobCardData;
  callbacks?: JobBoardCallbacks;
  variant: 'popover' | 'inline' | 'sheet';
  onClose: () => void;
}

export function createOutcomeMenu(options: OutcomeMenuOptions): HTMLElement {
  const { job, callbacks, variant, onClose } = options;
  const displayName = getJobDisplayName(job);
  const ended = job.result !== null;

  const menu = document.createElement('div');
  menu.className = `zj-menu zj-menu-${variant}`;
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', `${displayName}申请结果`);
  menu.dataset.jobId = job.id;

  const head = document.createElement('div');
  head.className = 'zj-menu-head';

  const headText = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'zj-menu-title';
  title.textContent = ended ? `更正 ${displayName} 的结果` : `结束 ${displayName} 的申请`;
  headText.append(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'zj-menu-subtitle';
  subtitle.textContent = ended
    ? `当前结果：${job.result === 'rejected' ? '已挂' : '已拒'}（保留最后进展）`
    : '标记结果不影响已登记的进展时间线';
  headText.append(subtitle);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'zj-menu-close';
  closeBtn.dataset.action = 'close-menu';
  closeBtn.setAttribute('aria-label', '关闭结果菜单');
  closeBtn.append(createIcon('x'));
  closeBtn.addEventListener('click', () => onClose());

  head.append(headText, closeBtn);
  menu.append(head);

  const rejectedBtn = document.createElement('button');
  rejectedBtn.type = 'button';
  rejectedBtn.className = `zj-menu-action is-danger${job.result === 'rejected' ? ' is-selected' : ''}`;
  rejectedBtn.dataset.action = 'set-result-rejected';
  rejectedBtn.setAttribute('aria-label', '已挂，招聘方结束');
  rejectedBtn.append(createIcon('circle-x'), document.createTextNode('已挂（招聘方结束）'));
  rejectedBtn.addEventListener('click', () => {
    callbacks?.onSetResult?.(job, 'rejected');
    onClose();
  });

  const declinedBtn = document.createElement('button');
  declinedBtn.type = 'button';
  declinedBtn.className = `zj-menu-action${job.result === 'declined' ? ' is-selected' : ''}`;
  declinedBtn.dataset.action = 'set-result-declined';
  declinedBtn.setAttribute('aria-label', '已拒，我主动拒绝');
  declinedBtn.append(createIcon('minus'), document.createTextNode('已拒（我主动拒绝）'));
  declinedBtn.addEventListener('click', () => {
    callbacks?.onSetResult?.(job, 'declined');
    onClose();
  });

  menu.append(rejectedBtn, declinedBtn);

  if (ended) {
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'zj-menu-action';
    clearBtn.dataset.action = 'clear-result';
    clearBtn.append(createIcon('rotate-ccw'), document.createTextNode('恢复跟进'));
    clearBtn.addEventListener('click', () => {
      callbacks?.onSetResult?.(job, null);
      onClose();
    });
    menu.append(clearBtn);
  }

  return menu;
}

export interface ProgressMenuOptions {
  job: JobCardData;
  callbacks?: JobBoardCallbacks;
  variant: 'popover' | 'inline' | 'sheet';
  onClose: () => void;
}

export function createProgressMenu(options: ProgressMenuOptions): HTMLElement {
  const { job, callbacks, variant, onClose } = options;
  const displayName = getJobDisplayName(job);
  const latestStep = getLatestStep(job);
  const ended = job.result !== null;

  const menu = document.createElement('div');
  menu.className = `zj-menu zj-menu-${variant}`;
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', `${displayName}更新进展`);
  menu.dataset.jobId = job.id;
  if (latestStep) {
    menu.dataset.targetStepId = latestStep.id;
  }

  const head = document.createElement('div');
  head.className = 'zj-menu-head';

  const headText = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'zj-menu-title';
  title.textContent = `更新 ${displayName} 的进展`;
  headText.append(title);

  if (latestStep) {
    const subtitle = document.createElement('div');
    subtitle.className = 'zj-menu-subtitle';
    subtitle.textContent = `当前环节：${formatStepInlineText(latestStep)}`;
    headText.append(subtitle);
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'zj-menu-close';
  closeBtn.dataset.action = 'close-menu';
  closeBtn.setAttribute('aria-label', '关闭更新菜单');
  closeBtn.append(createIcon('x'));
  closeBtn.addEventListener('click', () => onClose());

  head.append(headText, closeBtn);
  menu.append(head);

  const completeLabel = !ended ? getCompleteActionLabel(latestStep) : null;
  if (completeLabel && latestStep) {
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'zj-menu-action is-primary-action';
    doneBtn.dataset.action = 'complete-current';
    doneBtn.dataset.targetStepId = latestStep.id;
    doneBtn.append(createIcon('check'), document.createTextNode(completeLabel));
    doneBtn.addEventListener('click', () => {
      callbacks?.onCompleteCurrentStep?.(job, latestStep);
      onClose();
    });
    menu.append(doneBtn);
  }

  if (!ended) {
    const addLabel = document.createElement('div');
    addLabel.className = 'zj-menu-group-label';
    addLabel.textContent = '新增进展';
    menu.append(addLabel);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'zj-menu-action';
    addBtn.dataset.action = 'add-step';
    addBtn.append(createIcon('circle-plus'), document.createTextNode('登记下一步'));
    const trailing = createIcon('chevron-right', 'zj-icon zj-icon-trailing');
    addBtn.append(trailing);
    addBtn.addEventListener('click', () => {
      onClose();
      callbacks?.onRequestAddStep?.(job);
    });
    menu.append(addBtn);
  }

  if (latestStep && (callbacks?.onRequestEditStep || callbacks?.onRemoveLatestStep)) {
    const stepParts = formatStepTitle(latestStep);
    const manageLabel = document.createElement('div');
    manageLabel.className = 'zj-menu-group-label has-divider';
    manageLabel.textContent = '当前节点更正';
    menu.append(manageLabel);

    if (callbacks.onRequestEditStep && isEditableStepKind(latestStep.kind)) {
      const editCurrentBtn = document.createElement('button');
      editCurrentBtn.type = 'button';
      editCurrentBtn.className = 'zj-menu-action';
      editCurrentBtn.dataset.action = 'edit-current-step';
      editCurrentBtn.dataset.targetStepId = latestStep.id;
      editCurrentBtn.append(
        createIcon('pencil'),
        document.createTextNode(`编辑${stepParts.primary}`),
      );
      editCurrentBtn.addEventListener('click', () => {
        onClose();
        callbacks.onRequestEditStep?.(job, latestStep);
      });
      menu.append(editCurrentBtn);
    }

    if (callbacks.onRemoveLatestStep) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'zj-menu-action';
      removeBtn.dataset.action = 'remove-latest-step';
      removeBtn.dataset.targetStepId = latestStep.id;
      removeBtn.append(
        createIcon('rotate-ccw'),
        document.createTextNode(`撤回末步（${stepParts.primary}）`),
      );
      removeBtn.addEventListener('click', () => {
        onClose();
        callbacks.onRemoveLatestStep?.(job, latestStep);
      });
      menu.append(removeBtn);
    }
  }

  if (callbacks?.onRequestEditDetails) {
    const needsSupplement = !job.company.trim() || !job.position.trim();
    const editInfoBtn = document.createElement('button');
    editInfoBtn.type = 'button';
    editInfoBtn.className = 'zj-menu-action';
    editInfoBtn.dataset.action = 'menu-edit-details';
    editInfoBtn.append(
      createIcon('file-text'),
      document.createTextNode(needsSupplement ? '补充岗位资料' : '编辑岗位资料'),
    );
    editInfoBtn.addEventListener('click', () => {
      onClose();
      callbacks.onRequestEditDetails?.(job);
    });
    menu.append(editInfoBtn);
  }

  const resultLabel = document.createElement('div');
  resultLabel.className = 'zj-menu-group-label has-divider';
  resultLabel.textContent = '申请结果';
  menu.append(resultLabel);

  const rejectedBtn = document.createElement('button');
  rejectedBtn.type = 'button';
  rejectedBtn.className = 'zj-menu-action is-danger';
  rejectedBtn.dataset.action = 'set-result-rejected';
  rejectedBtn.setAttribute('aria-label', '已挂，招聘方结束');
  rejectedBtn.append(createIcon('circle-x'), document.createTextNode('已挂'));
  rejectedBtn.addEventListener('click', () => {
    callbacks?.onSetResult?.(job, 'rejected');
    onClose();
  });

  const declinedBtn = document.createElement('button');
  declinedBtn.type = 'button';
  declinedBtn.className = 'zj-menu-action';
  declinedBtn.dataset.action = 'set-result-declined';
  declinedBtn.setAttribute('aria-label', '已拒，我主动拒绝');
  declinedBtn.append(createIcon('minus'), document.createTextNode('已拒'));
  declinedBtn.addEventListener('click', () => {
    callbacks?.onSetResult?.(job, 'declined');
    onClose();
  });

  menu.append(rejectedBtn, declinedBtn);

  if (ended) {
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'zj-menu-action';
    clearBtn.dataset.action = 'clear-result';
    clearBtn.append(createIcon('rotate-ccw'), document.createTextNode('恢复跟进'));
    clearBtn.addEventListener('click', () => {
      callbacks?.onSetResult?.(job, null);
      onClose();
    });
    menu.append(clearBtn);
  }

  return menu;
}
