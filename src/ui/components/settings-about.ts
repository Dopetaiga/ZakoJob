import type {
  BoardLayout,
  BoardModuleId,
  BoardPreferences,
  PreferenceScope,
  PreferencesPatch,
} from '../../data/contract.ts';
import { normalizeBoardLayout, resolveEffectiveLayout } from '../format.ts';
import { createIcon } from '../icons.ts';

export interface AboutMiSansOptions {
  openByDefault?: boolean;
}

/**
 * Creates the "关于" attribution block required by DESIGN.md ("设置 → 关于" MiSans notice).
 */
export function createAboutMiSansBlock(
  options: AboutMiSansOptions = {},
): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'zj-about-block';
  details.open = options.openByDefault ?? true;

  const summary = document.createElement('summary');
  const title = document.createElement('span');
  title.textContent = '关于 · 字体署名';
  summary.append(title, createIcon('chevron-down'));

  const notice = document.createElement('p');
  notice.textContent =
    '本应用使用 MiSans（MiSans VF 5.0.0）字体，字体版权归小米所有。若本地资源未就绪，将自动回退至系统无衬线字体。';

  const links = document.createElement('div');
  links.className = 'zj-about-links';

  const faqLink = document.createElement('a');
  faqLink.href = 'https://hyperos.mi.com/font/faq';
  faqLink.target = '_blank';
  faqLink.rel = 'noopener noreferrer';
  faqLink.textContent = 'MiSans 官方使用说明';

  const pkgLink = document.createElement('a');
  pkgLink.href = 'https://github.com/dsrkafuu/misans';
  pkgLink.target = '_blank';
  pkgLink.rel = 'noopener noreferrer';
  pkgLink.textContent = 'misans@5.0.0';

  links.append(faqLink, pkgLink);
  details.append(summary, notice, links);
  return details;
}

export interface InstallGuideOptions {
  canPromptInstall?: () => boolean;
  onPromptInstall?: () => Promise<unknown> | void;
}

export function createInstallGuideBlock(
  options: InstallGuideOptions = {},
): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'zj-about-block zj-install-guide';
  details.open = false;

  const summary = document.createElement('summary');
  const title = document.createElement('span');
  title.textContent = '安装到主屏幕';
  summary.append(title, createIcon('chevron-down'));

  const intro = document.createElement('p');
  intro.textContent =
    '已配置应用清单与桌面/移动图标。添加到主屏幕后，可由系统图标直接进入同一看板，继续使用当前浏览器的本地数据或你的私有站点身份。';

  const list = document.createElement('ul');
  list.className = 'zj-install-steps';

  const iosLi = document.createElement('li');
  iosLi.textContent =
    'iOS Safari：点击底部分享按钮，选择「添加到主屏幕」，确认名称「扎口Job」后点击添加。';

  const androidLi = document.createElement('li');
  androidLi.textContent =
    'Android Chrome / Edge：打开浏览器右上角菜单，选择「添加到主屏幕」或「安装应用」。';

  const desktopLi = document.createElement('li');
  desktopLi.textContent =
    '桌面浏览器：点击地址栏右侧安装图标，可将工作台固定为独立应用窗口。';

  list.append(iosLi, androidLi, desktopLi);
  details.append(summary, intro, list);

  if (options.onPromptInstall) {
    const installBtn = document.createElement('button');
    installBtn.type = 'button';
    installBtn.className = 'zj-btn zj-install-btn';
    installBtn.textContent = '立即安装到主屏幕';
    installBtn.hidden = !(options.canPromptInstall?.() ?? false);
    installBtn.addEventListener('click', () => {
      void options.onPromptInstall?.();
    });
    details.append(installBtn);
  }

  return details;
}

export interface LayoutPreferencesPanelOptions {
  preferences: BoardPreferences;
  activeDevice: 'mobile' | 'desktop';
  onSavePreferencesPatch: (patch: PreferencesPatch) => Promise<void> | void;
}

export function createLayoutPreferencesPanel(
  initialOptions: LayoutPreferencesPanelOptions,
): { element: HTMLElement; update: (next: LayoutPreferencesPanelOptions) => void } {
  const root = document.createElement('section');
  root.className = 'zj-settings-section';
  root.setAttribute('aria-label', '开始页布局偏好');

  let current = initialOptions;
  let scope: PreferenceScope = 'shared';
  let statusText = '';

  const moduleTitle = (id: BoardModuleId): string =>
    id === 'schedule' ? '近期安排' : '岗位进展';

  const getEditingLayout = (): {
    layout: BoardLayout;
    isInherited: boolean;
  } => {
    if (scope === 'shared') {
      return {
        layout: normalizeBoardLayout(current.preferences.shared),
        isInherited: false,
      };
    }
    const resolved = resolveEffectiveLayout(current.preferences, scope);
    return {
      layout: resolved.layout,
      isInherited: !resolved.isOverride,
    };
  };

  const commitScopedLayout = async (nextLayout: BoardLayout | null): Promise<void> => {
    if (scope === 'shared') {
      if (!nextLayout) return;
      await current.onSavePreferencesPatch({ shared: nextLayout });
      return;
    }
    const override = nextLayout
      ? ({ overridden: true, layout: nextLayout } as const)
      : ({ overridden: false } as const);
    if (scope === 'mobile') {
      await current.onSavePreferencesPatch({ mobile: override });
    } else {
      await current.onSavePreferencesPatch({ desktop: override });
    }
  };

  const render = (): void => {
    root.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'zj-settings-section-head';
    const h3 = document.createElement('h3');
    h3.textContent = '开始页布局';
    const badge = document.createElement('span');
    badge.className = 'zj-settings-badge';
    badge.textContent = `当前端：${current.activeDevice === 'mobile' ? '手机' : '桌面'}`;
    head.append(h3, badge);

    const scopeTabs = document.createElement('div');
    scopeTabs.className = 'zj-scope-tabs';
    scopeTabs.setAttribute('role', 'group');
    scopeTabs.setAttribute('aria-label', '编辑范围');

    for (const [key, label] of [
      ['shared', '共用布局'],
      ['mobile', '手机专属'],
      ['desktop', '桌面专属'],
    ] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `zj-scope-tab${scope === key ? ' is-active' : ''}`;
      btn.dataset.scope = key;
      const hasOverride =
        key === 'mobile'
          ? current.preferences.mobile.overridden
          : key === 'desktop'
            ? current.preferences.desktop.overridden
            : false;
      btn.textContent = hasOverride ? `${label}（已覆盖）` : label;
      btn.addEventListener('click', () => {
        scope = key;
        statusText = '';
        render();
      });
      scopeTabs.append(btn);
    }

    const { layout, isInherited } = getEditingLayout();

    const desc = document.createElement('p');
    desc.className = 'zj-settings-desc';
    if (scope === 'shared') {
      desc.textContent = '默认应用于未单独设置的手机和桌面端。';
    } else if (isInherited) {
      desc.textContent = `当前${scope === 'mobile' ? '手机' : '桌面'}端沿用共用布局；修改后仅保存该端覆盖，不影响另一端。`;
    } else {
      desc.textContent = `当前${scope === 'mobile' ? '手机' : '桌面'}端已启用专属布局，不影响另一端。`;
    }

    const moduleList = document.createElement('div');
    moduleList.className = 'zj-module-list';

    layout.modules.forEach((mod, index) => {
      const row = document.createElement('div');
      row.className = 'zj-module-row';
      row.dataset.moduleId = mod.id;

      const label = document.createElement('label');
      label.className = 'zj-module-check';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = mod.visible;
      checkbox.addEventListener('change', () => {
        const nextModules = layout.modules.map((m) =>
          m.id === mod.id ? { ...m, visible: checkbox.checked } : m,
        );
        void commitScopedLayout({ modules: nextModules });
      });
      const text = document.createElement('span');
      text.textContent = moduleTitle(mod.id);
      label.append(checkbox, text);

      const moveBtn = document.createElement('button');
      moveBtn.type = 'button';
      moveBtn.className = 'zj-text-btn';
      moveBtn.textContent = index === 0 ? '下移' : '上移';
      moveBtn.setAttribute(
        'aria-label',
        `${moduleTitle(mod.id)}${index === 0 ? '下移' : '上移'}`,
      );
      moveBtn.addEventListener('click', () => {
        const other = layout.modules.find((m) => m.id !== mod.id);
        if (!other) return;
        const nextModules = index === 0 ? [other, mod] : [mod, other];
        void commitScopedLayout({ modules: nextModules });
      });

      row.append(label, moveBtn);
      moduleList.append(row);
    });

    root.append(head, scopeTabs, desc, moduleList);

    if (scope !== 'shared' && !isInherited) {
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'zj-btn zj-reset-layout-btn';
      resetBtn.dataset.action = 'reset-device-layout';
      resetBtn.textContent = '恢复沿用共用布局';
      resetBtn.addEventListener('click', () => {
        statusText = '已恢复沿用共用布局';
        void commitScopedLayout(null);
      });
      root.append(resetBtn);
    }

    if (statusText) {
      const note = document.createElement('p');
      note.className = 'zj-settings-note';
      note.textContent = statusText;
      root.append(note);
    }
  };

  render();

  return {
    element: root,
    update(next) {
      current = next;
      render();
    },
  };
}

export interface BackupPanelOptions {
  jobCount: number;
  onExport: () => Promise<{ ok: boolean; message: string }>;
  onImport: (rawJson: string) => Promise<{ ok: boolean; message: string }>;
}

export function createBackupPanel(
  initialOptions: BackupPanelOptions,
): { element: HTMLElement; update: (next: BackupPanelOptions) => void } {
  const root = document.createElement('section');
  root.className = 'zj-settings-section';
  root.setAttribute('aria-label', '数据备份与恢复');

  let current = initialOptions;
  let busy = false;
  let feedbackText = '';
  let feedbackIsError = false;

  const render = (): void => {
    root.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'zj-settings-section-head';
    const h3 = document.createElement('h3');
    h3.textContent = '备份与恢复（JSON）';
    const count = document.createElement('span');
    count.className = 'zj-settings-badge';
    count.textContent = `当前 ${current.jobCount} 份岗位`;
    head.append(h3, count);

    const desc = document.createElement('p');
    desc.className = 'zj-settings-desc';
    desc.textContent =
      '导出包含全部岗位记录与开始页布局偏好。导入会一起恢复岗位和布局，且仅对当前岗位数为零的看板开放。';

    const btnRow = document.createElement('div');
    btnRow.className = 'zj-backup-actions';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'zj-btn';
    exportBtn.dataset.action = 'export-backup';
    exportBtn.disabled = busy;
    exportBtn.textContent = busy ? '处理中…' : '导出备份';
    exportBtn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      feedbackText = '';
      render();
      try {
        const res = await current.onExport();
        feedbackText = res.message;
        feedbackIsError = !res.ok;
      } finally {
        busy = false;
        render();
      }
    });

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.className = 'zj-sr-only';
    fileInput.setAttribute('aria-label', '选择备份 JSON 文件');

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'zj-btn';
    importBtn.dataset.action = 'import-backup';
    importBtn.disabled = busy;
    importBtn.textContent = '从文件导入';
    importBtn.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file || busy) return;
      busy = true;
      feedbackText = '';
      render();
      try {
        const text = await file.text();
        const res = await current.onImport(text);
        feedbackText = res.message;
        feedbackIsError = !res.ok;
      } catch (err) {
        feedbackText =
          err instanceof Error ? err.message : '读取备份文件失败。';
        feedbackIsError = true;
      } finally {
        busy = false;
        render();
      }
    });

    btnRow.append(exportBtn, importBtn, fileInput);
    root.append(head, desc, btnRow);

    if (feedbackText) {
      const msg = document.createElement('p');
      msg.className = feedbackIsError ? 'zj-form-error' : 'zj-settings-note';
      msg.setAttribute('role', feedbackIsError ? 'alert' : 'status');
      msg.textContent = feedbackText;
      root.append(msg);
    }
  };

  render();

  return {
    element: root,
    update(next) {
      current = next;
      render();
    },
  };
}

export interface SettingsDialogOptions {
  title?: string;
  extraContent?: HTMLElement;
  sections?: readonly HTMLElement[];
  installGuide?: InstallGuideOptions;
  aboutOpenByDefault?: boolean;
  onClose?: () => void;
}

export interface SettingsDialogHandle {
  dialog: HTMLDialogElement;
  open: (trigger?: HTMLElement | null) => void;
  close: () => void;
  destroy: () => void;
}

export function createSettingsDialog(
  options: SettingsDialogOptions = {},
): SettingsDialogHandle {
  const dialog = document.createElement('dialog');
  dialog.className = 'zj-dialog';
  dialog.setAttribute('aria-label', options.title ?? '设置');

  let lastTrigger: HTMLElement | null = null;

  const heading = document.createElement('div');
  heading.className = 'zj-dialog-heading';
  const h2 = document.createElement('h2');
  h2.textContent = options.title ?? '设置';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'zj-icon-btn';
  closeBtn.setAttribute('aria-label', '关闭设置');
  closeBtn.append(createIcon('x'));
  heading.append(h2, closeBtn);

  const body = document.createElement('div');
  if (options.extraContent) {
    body.append(options.extraContent);
  }
  if (options.sections) {
    for (const sec of options.sections) {
      body.append(sec);
    }
  }
  if (options.installGuide) {
    body.append(createInstallGuideBlock(options.installGuide));
  }
  body.append(
    createAboutMiSansBlock({ openByDefault: options.aboutOpenByDefault ?? true }),
  );

  const actions = document.createElement('div');
  actions.className = 'zj-dialog-actions';
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'zj-btn zj-btn-primary';
  doneBtn.textContent = '完成';
  actions.append(doneBtn);

  dialog.append(heading, body, actions);

  const close = (): void => {
    if (dialog.open) {
      dialog.close();
    }
    options.onClose?.();
    lastTrigger?.focus({ preventScroll: true });
    lastTrigger = null;
  };

  const onBackdropClick = (event: MouseEvent): void => {
    if (event.target === dialog) {
      close();
    }
  };

  const onCancel = (event: Event): void => {
    event.preventDefault();
    close();
  };

  closeBtn.addEventListener('click', close);
  doneBtn.addEventListener('click', close);
  dialog.addEventListener('click', onBackdropClick);
  dialog.addEventListener('cancel', onCancel);

  return {
    dialog,
    open(trigger?: HTMLElement | null) {
      lastTrigger = trigger ?? null;
      if (!dialog.open) {
        dialog.showModal();
      }
      closeBtn.focus({ preventScroll: true });
    },
    close,
    destroy() {
      closeBtn.removeEventListener('click', close);
      doneBtn.removeEventListener('click', close);
      dialog.removeEventListener('click', onBackdropClick);
      dialog.removeEventListener('cancel', onCancel);
      dialog.remove();
    },
  };
}
