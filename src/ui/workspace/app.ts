import { newId } from '../../domain/index.ts';
import {
  defaultBoardPreferences,
  type BoardPreferences,
  type CommandOutcome,
  type JobBoardStore,
  type JobCommand,
  type PreferencesPatch,
} from '../../data/contract.ts';
import { createAgendaSection } from '../components/agenda-section.ts';
import { createDesktopJobBoard } from '../components/desktop-job-card.ts';
import { createFeedbackBanner } from '../components/feedback-banner.ts';
import {
  createJobDetailDialog,
  createJobFormDialog,
} from '../components/job-form-dialog.ts';
import { createMobileJobBoard } from '../components/mobile-job-card.ts';
import {
  createBackupPanel,
  createLayoutPreferencesPanel,
  createSettingsDialog,
} from '../components/settings-about.ts';
import {
  createCalendarView,
  createScheduleTimelineView,
  createScheduleViewState,
  type ScheduleViewState,
} from '../components/schedule-views.ts';
import { createStepFormDialog } from '../components/step-form-dialog.ts';
import {
  formatStepInlineText,
  getJobDisplayName,
  resolveEffectiveLayout,
} from '../format.ts';
import { createIcon } from '../icons.ts';
import {
  addStepInputToLogPayload,
  addStepInputToUpdatePayload,
  classifyCommandOutcome,
  domainJobToCardData,
  formatActionFailureMessage,
  formatCommandSaveSuccess,
  formatImportOutcomeMessage,
  formatReadFailureMessage,
} from '../store-bridge.ts';
import type {
  JobBoardCallbacks,
  JobCardData,
  MobileHistoryMode,
} from '../types.ts';
import {
  captureBoardScrollY,
  createScheduleNavBar,
  createScheduleNavigationState,
  createSchedulePageHeader,
  locateJobAndStep,
  normalizePageForDevice,
  restoreBoardScrollY,
  type LocateTimerRef,
  type SchedulePageId,
} from './schedule-navigation.ts';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface JobBoardAppOptions {
  container: HTMLElement;
  store: JobBoardStore;
  initialMobileHistoryMode?: MobileHistoryMode;
  /** Optional override for responsive device detection (useful in tests) */
  forceDevice?: 'mobile' | 'desktop';
  /** Optional fixed "today" date for calendar & timeline (used in isolated demos/tests) */
  scheduleToday?: Date;
}

export interface JobBoardAppHandle {
  refresh: () => Promise<void>;
  getJobs: () => readonly JobCardData[];
  getPreferences: () => BoardPreferences;
  getMobileHistoryMode: () => MobileHistoryMode;
  setMobileHistoryMode: (mode: MobileHistoryMode) => void;
  getActivePage: () => SchedulePageId;
  setActivePage: (page: SchedulePageId) => void;
  destroy: () => void;
}

function downloadJsonFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createJobBoardApp(
  options: JobBoardAppOptions,
): JobBoardAppHandle {
  const { container, store } = options;
  let jobs: JobCardData[] = [];
  let preferences: BoardPreferences = defaultBoardPreferences();
  let mobileHistoryMode: MobileHistoryMode =
    options.initialMobileHistoryMode ?? 'timeline';
  let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
  let loading = true;
  const scheduleState: ScheduleViewState = createScheduleViewState(
    options.scheduleToday,
  );
  const navState = createScheduleNavigationState();
  const locateTimerRef: LocateTimerRef = { timer: null };

  const mediaQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 767px)')
      : null;

  const wideMediaQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 1200px)')
      : null;

  const getActiveDevice = (): 'mobile' | 'desktop' => {
    if (options.forceDevice) return options.forceDevice;
    return mediaQuery?.matches ? 'mobile' : 'desktop';
  };

  const hasInlineCalendar = (activeDevice: 'mobile' | 'desktop'): boolean => {
    if (activeDevice !== 'desktop') return false;
    return wideMediaQuery ? wideMediaQuery.matches : true;
  };

  const shell = document.createElement('div');
  shell.className = 'zj-ui-scope zj-app-shell';

  // Topbar
  const topbar = document.createElement('header');
  topbar.className = 'zj-app-topbar';

  const brandWrap = document.createElement('div');
  brandWrap.className = 'zj-app-brand-wrap';
  const brand = document.createElement('span');
  brand.className = 'zj-app-brand';
  brand.textContent = '扎口Job';
  brandWrap.append(brand);

  const topActions = document.createElement('div');
  topActions.className = 'zj-app-top-actions';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'zj-icon-btn';
  refreshBtn.dataset.action = 'refresh-board';
  refreshBtn.setAttribute('aria-label', '刷新看板');
  refreshBtn.append(createIcon('rotate-ccw'));

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'zj-icon-btn';
  settingsBtn.dataset.action = 'open-settings';
  settingsBtn.setAttribute('aria-label', '设置');
  settingsBtn.append(createIcon('settings-2'));

  topActions.append(refreshBtn, settingsBtn);
  topbar.append(brandWrap, topActions);
  let boardAddJobBtn: HTMLButtonElement | null = null;

  const main = document.createElement('main');
  main.className = 'zj-app-main';

  const feedbackBanner = createFeedbackBanner({
    onRefresh: () => {
      void refresh();
    },
  });

  const modulesContainer = document.createElement('div');
  modulesContainer.className = 'zj-app-modules';

  const workspaceHost = document.createElement('div');
  workspaceHost.className = 'zj-app-workspace';

  const initialDevice = getActiveDevice();
  const navBar = createScheduleNavBar({
    device: initialDevice,
    inlineCalendar: hasInlineCalendar(initialDevice),
    activePage: navState.activePage,
    onSelectPage: (page) => switchPage(page),
  });

  main.append(navBar.element, feedbackBanner.element, workspaceHost);

  const detailDialog = createJobDetailDialog();

  const handleCommandOutcome = (
    outcome: CommandOutcome,
    successActionLabel: string,
  ): { ok: boolean; errorMessage?: string } => {
    const kind = classifyCommandOutcome(outcome);
    if (kind === 'confirmed' && outcome.status === 'confirmed') {
      const updatedCard = domainJobToCardData(outcome.job);
      const exists = jobs.some((j) => j.id === updatedCard.id);
      jobs = exists
        ? jobs.map((j) => (j.id === updatedCard.id ? updatedCard : j))
        : [...jobs, updatedCard];
      feedbackBanner.setState({
        tone: 'saved',
        message: formatCommandSaveSuccess(store.mode, successActionLabel),
      });
      renderModules();
      return { ok: true };
    }
    if (kind === 'unconfirmed') {
      const msg = '未确认是否保存，请刷新查看';
      feedbackBanner.setState({
        tone: 'unknown',
        message: msg,
        allowRefresh: true,
        sticky: true,
      });
      return { ok: false, errorMessage: msg };
    }
    if (outcome.status === 'rejected' || outcome.status === 'failed') {
      const msg = outcome.status === 'failed' ? outcome.message : formatActionFailureMessage(outcome.failure);
      if (kind === 'conflict') {
        feedbackBanner.setState({
          tone: 'conflict',
          message: msg,
          allowRefresh: true,
          sticky: true,
        });
      } else {
        feedbackBanner.setState({
          tone: 'failed',
          message: msg,
          allowRefresh: false,
          sticky: true,
        });
      }
      return { ok: false, errorMessage: msg };
    }
    return { ok: false, errorMessage: '保存失败，请重试。' };
  };

  const runJobCommand = async (
    command: JobCommand,
    successLabel: string,
  ): Promise<{ ok: boolean; errorMessage?: string }> => {
    feedbackBanner.setState({ tone: 'saving', message: '正在保存…' });
    try {
      const outcome = await store.submitJobCommand(command);
      return handleCommandOutcome(outcome, successLabel);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : '提交保存请求失败，请重试。';
      feedbackBanner.setState({
        tone: 'failed',
        message: msg,
        allowRefresh: true,
        sticky: true,
      });
      return { ok: false, errorMessage: msg };
    }
  };

  const jobFormDialog = createJobFormDialog(async (payload) => {
    const command: JobCommand =
      payload.mode === 'create'
        ? {
            kind: 'create-job',
            jobId: payload.jobId,
            input: payload.input,
          }
        : {
            kind: 'update-profile',
            jobId: payload.jobId,
            expectedVersion: payload.expectedVersion,
            patch: {
              postingUrl: payload.draft.url ?? '',
              company: payload.draft.company,
              position: payload.draft.position,
              location: payload.draft.location ?? '',
              salary: payload.draft.salary ?? '',
              jobDescription: payload.draft.jd ?? '',
            },
          };

    const result = await runJobCommand(
      command,
      payload.mode === 'create' ? '已添加岗位' : '已更新岗位资料',
    );
    if (!result.ok && result.errorMessage) {
      jobFormDialog.showError(result.errorMessage);
    }
    return result.ok;
  });

  const stepFormDialog = createStepFormDialog(async (payload) => {
    if (payload.mode === 'create') {
      const result = await runJobCommand(
        {
          kind: 'log-step',
          jobId: payload.jobId,
          expectedVersion: payload.expectedVersion,
          nodeId: payload.nodeId,
          step: addStepInputToLogPayload(payload.step),
        },
        '已登记新进展',
      );
      if (!result.ok && result.errorMessage) {
        stepFormDialog.showError(result.errorMessage);
      }
      return result.ok;
    }

    const updatePayload = addStepInputToUpdatePayload(payload.step);
    if (!updatePayload) {
      stepFormDialog.showError('该环节类型不支持编辑。');
      return false;
    }

    const result = await runJobCommand(
      {
        kind: 'update-step',
        jobId: payload.jobId,
        expectedVersion: payload.expectedVersion,
        nodeId: payload.nodeId,
        payload: updatePayload,
      },
      '已更正历史环节',
    );
    if (!result.ok && result.errorMessage) {
      stepFormDialog.showError(result.errorMessage);
    }
    return result.ok;
  },
  {
    async onRemoveLatestStep(payload) {
      const result = await runJobCommand(
        {
          kind: 'remove-latest-step',
          jobId: payload.jobId,
          expectedVersion: payload.expectedVersion,
          expectedLastNodeId: payload.nodeId,
        },
        '已撤回末步',
      );
      if (!result.ok && result.errorMessage) {
        stepFormDialog.showError(result.errorMessage);
      }
      return result.ok;
    },
  });

  const callbacks: JobBoardCallbacks = {
    onRequestAddJob() {
      const returnFocus = boardAddJobBtn?.isConnected ? boardAddJobBtn : settingsBtn;
      jobFormDialog.openCreate(returnFocus);
    },
    onRequestEditDetails(job) {
      jobFormDialog.openEdit(job);
    },
    onInspectDetails(job) {
      detailDialog.open(job);
    },
    onToggleStar(job, nextStarred) {
      void runJobCommand(
        {
          kind: 'set-star',
          jobId: job.id,
          expectedVersion: job.version,
          starred: nextStarred,
        },
        `${getJobDisplayName(job)}${nextStarred ? '已加星' : '已取消星标'}`,
      );
    },
    onCompleteCurrentStep(job, currentStep) {
      const payload =
        currentStep.kind === 'interview'
          ? ({ targetKind: 'interview', patch: { status: 'done' } } as const)
          : currentStep.kind === 'assessment'
            ? ({ targetKind: 'assessment', patch: { completed: true } } as const)
            : null;
      if (!payload) return;

      void runJobCommand(
        {
          kind: 'update-step',
          jobId: job.id,
          expectedVersion: job.version,
          nodeId: currentStep.id,
          payload,
        },
        `${getJobDisplayName(job)} · ${formatStepInlineText(currentStep)} 已完成`,
      );
    },
    onRequestAddStep(job) {
      stepFormDialog.openCreate(job);
    },
    onSubmitNewStep(job, input) {
      void runJobCommand(
        {
          kind: 'log-step',
          jobId: job.id,
          expectedVersion: job.version,
          nodeId: newId('node'),
          step: addStepInputToLogPayload(input),
        },
        `${getJobDisplayName(job)} · 已登记进展`,
      );
    },
    onRequestEditStep(job, targetStep) {
      stepFormDialog.openEdit(job, targetStep);
    },
    async onRemoveLatestStep(job, latestStep) {
      const result = await runJobCommand(
        {
          kind: 'remove-latest-step',
          jobId: job.id,
          expectedVersion: job.version,
          expectedLastNodeId: latestStep.id,
        },
        `${getJobDisplayName(job)} 已撤回末步`,
      );
      return result.ok;
    },
    onSetResult(job, result) {
      if (result === null) {
        void runJobCommand(
          {
            kind: 'clear-outcome',
            jobId: job.id,
            expectedVersion: job.version,
          },
          `${getJobDisplayName(job)} 已恢复跟进`,
        );
        return;
      }
      const status =
        result === 'rejected' ? 'closedByEmployer' : 'declinedByUser';
      void runJobCommand(
        {
          kind: 'record-outcome',
          jobId: job.id,
          expectedVersion: job.version,
          status,
        },
        `${getJobDisplayName(job)} · ${result === 'rejected' ? '已挂' : '已拒'}`,
      );
    },
  };

  const handleSavePreferencesPatch = async (
    patch: PreferencesPatch,
  ): Promise<void> => {
    feedbackBanner.setState({ tone: 'saving', message: '正在保存布局偏好…' });
    try {
      const outcome = await store.savePreferences(patch);
      if (outcome.status === 'confirmed') {
        preferences = outcome.preferences;
        feedbackBanner.setState({
          tone: 'saved',
          message: formatCommandSaveSuccess(store.mode, '开始页布局已更新'),
        });
        renderModules();
      } else if (outcome.status === 'unconfirmed') {
        feedbackBanner.setState({
          tone: 'unknown',
          message: '未确认是否保存，请刷新查看',
          allowRefresh: true,
          sticky: true,
        });
      } else if (outcome.status === 'rejected') {
        feedbackBanner.setState({
          tone: 'failed',
          message: outcome.failure.message,
          sticky: true,
        });
      } else {
        feedbackBanner.setState({
          tone: 'failed',
          message: outcome.message,
          sticky: true,
        });
      }
    } catch (err) {
      feedbackBanner.setState({
        tone: 'failed',
        message: err instanceof Error ? err.message : '保存布局偏好失败。',
        sticky: true,
      });
    }
  };

  const handleExportBackup = async (): Promise<{
    ok: boolean;
    message: string;
  }> => {
    try {
      const outcome = await store.exportSnapshot();
      if (!outcome.ok) {
        return {
          ok: false,
          message: formatReadFailureMessage(outcome.failure),
        };
      }
      const json = JSON.stringify(outcome.backup, null, 2);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJsonFile(`zakoujob-backup-${stamp}.json`, json);
      return {
        ok: true,
        message: `已导出 ${outcome.backup.applications.length} 份岗位与开始页布局。`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : '导出备份失败。',
      };
    }
  };

  const handleImportBackup = async (
    rawJson: string,
  ): Promise<{ ok: boolean; message: string }> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return { ok: false, message: '备份文件不是有效的 JSON 格式。' };
    }

    try {
      const outcome = await store.importBackup(parsed);
      const message = formatImportOutcomeMessage(outcome);
      if (outcome.status === 'confirmed') {
        await refresh();
        feedbackBanner.setState({
          tone: 'saved',
          message: formatCommandSaveSuccess(store.mode, '备份已恢复'),
        });
        return { ok: true, message };
      }
      if (outcome.status === 'unconfirmed') {
        feedbackBanner.setState({
          tone: 'unknown',
          message,
          allowRefresh: true,
          sticky: true,
        });
      }
      return { ok: false, message };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : '导入备份失败。',
      };
    }
  };

  const layoutPrefsPanel = createLayoutPreferencesPanel({
    preferences,
    activeDevice: getActiveDevice(),
    onSavePreferencesPatch: handleSavePreferencesPatch,
  });

  const backupPanel = createBackupPanel({
    jobCount: jobs.length,
    onExport: handleExportBackup,
    onImport: handleImportBackup,
  });

  const settingsDialog = createSettingsDialog({
    sections: [layoutPrefsPanel.element, backupPanel.element],
    installGuide: {
      canPromptInstall: () => deferredInstallPrompt !== null,
      async onPromptInstall() {
        if (!deferredInstallPrompt) return;
        await deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
      },
    },
    aboutOpenByDefault: false,
  });

  const switchPage = (nextPage: SchedulePageId, restoreScroll = true): void => {
    const device = getActiveDevice();
    const target = normalizePageForDevice(
      nextPage,
      device,
      hasInlineCalendar(device),
    );
    if (navState.activePage === target) return;
    if (navState.activePage === 'board') {
      captureBoardScrollY(navState);
    }
    navState.activePage = target;
    renderModules();
    if (target === 'board' && restoreScroll) {
      restoreBoardScrollY(navState);
    }
  };

  const handleScheduleSelect = (jobId: string, stepId: string): void => {
    const device = getActiveDevice();
    const needsSwitch = navState.activePage !== 'board';
    if (needsSwitch) {
      navState.activePage = normalizePageForDevice(
        'board',
        device,
        hasInlineCalendar(device),
      );
      renderModules();
    }

    const focusNow = () => {
      if (device === 'mobile' && mobileHistoryMode === 'swipe') {
        const job = jobs.find((j) => j.id === jobId);
        const stepIndex = job?.steps.findIndex((s) => s.id === stepId) ?? -1;
        if (stepIndex >= 0) {
          mobileBoard.setViewingStepIndex(jobId, stepIndex);
        }
      }
      locateJobAndStep(modulesContainer, jobId, stepId, locateTimerRef);
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => focusNow());
    } else {
      focusNow();
    }
  };

  const agendaSection = createAgendaSection({
    jobs,
    onSelectJob(jobId) {
      const card = modulesContainer.querySelector<HTMLElement>(
        `[data-job-id="${CSS.escape(jobId)}"]`,
      );
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
  });

  const desktopBoard = createDesktopJobBoard({ jobs, callbacks });
  const mobileBoard = createMobileJobBoard({
    mode: mobileHistoryMode,
    menuContainer: 'sheet',
    jobs,
    callbacks,
  });

  const renderBoardModules = (activeDevice: 'mobile' | 'desktop'): boolean => {
    modulesContainer.innerHTML = '';
    boardAddJobBtn = null;

    const { layout } = resolveEffectiveLayout(preferences, activeDevice);
    const visibleModules = layout.modules
      .filter((m) => m.visible)
      .map((m) => m.id);

    if (visibleModules.length === 0) {
      const hiddenNotice = document.createElement('div');
      hiddenNotice.className = 'zj-empty-board';
      const p = document.createElement('p');
      p.className = 'zj-empty-board-desc';
      p.textContent = '开始页模块当前已全部隐藏，可在设置中重新启用。';
      const openSettingsBtn = document.createElement('button');
      openSettingsBtn.type = 'button';
      openSettingsBtn.className = 'zj-btn zj-btn-primary';
      openSettingsBtn.textContent = '打开设置调整布局';
      openSettingsBtn.addEventListener('click', () =>
        settingsDialog.open(openSettingsBtn),
      );
      hiddenNotice.append(p, openSettingsBtn);
      modulesContainer.append(hiddenNotice);
      return false;
    }

    for (const moduleId of visibleModules) {
      if (moduleId === 'schedule') {
        agendaSection.update({
          jobs,
          onSelectJob(jobId) {
            const card = modulesContainer.querySelector<HTMLElement>(
              `[data-job-id="${CSS.escape(jobId)}"]`,
            );
            card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          },
        });
        modulesContainer.append(agendaSection.element);
      } else if (moduleId === 'jobs') {
        const jobsSection = document.createElement('section');
        jobsSection.className = 'zj-jobs-section';
        jobsSection.setAttribute('aria-label', '岗位进展');

        const head = document.createElement('div');
        head.className = 'zj-section-heading';
        const titleGroup = document.createElement('div');
        titleGroup.className = 'zj-section-title-group';
        const h1 = document.createElement('h1');
        h1.className = 'zj-section-main-title';
        h1.textContent = '岗位进展';
        const count = document.createElement('span');
        count.className = 'zj-section-count';
        count.textContent = `${jobs.length} 份申请`;
        titleGroup.append(h1, count);

        const sectionAddBtn = document.createElement('button');
        sectionAddBtn.type = 'button';
        sectionAddBtn.className = 'zj-btn zj-btn-primary zj-section-add-btn';
        sectionAddBtn.dataset.action = 'add-job';
        sectionAddBtn.append(createIcon('plus'), document.createTextNode('添加岗位'));
        sectionAddBtn.addEventListener('click', () =>
          jobFormDialog.openCreate(sectionAddBtn),
        );
        boardAddJobBtn = sectionAddBtn;

        head.append(titleGroup, sectionAddBtn);

        jobsSection.append(head);

        if (activeDevice === 'mobile') {
          mobileBoard.update({
            mode: mobileHistoryMode,
            menuContainer: 'sheet',
            jobs,
            callbacks,
          });
          jobsSection.append(mobileBoard.element);
        } else {
          desktopBoard.update({ jobs, callbacks });
          jobsSection.append(desktopBoard.element);
        }

        modulesContainer.append(jobsSection);
      }
    }
    return true;
  };

  const renderModules = (): void => {
    const activeDevice = getActiveDevice();
    const inlineCalendar = hasInlineCalendar(activeDevice);
    navState.activePage = normalizePageForDevice(
      navState.activePage,
      activeDevice,
      inlineCalendar,
    );
    shell.dataset.device = activeDevice;
    shell.dataset.view = navState.activePage;
    shell.dataset.inlineCalendar = inlineCalendar ? 'true' : 'false';

    navBar.update({
      device: activeDevice,
      inlineCalendar,
      activePage: navState.activePage,
      onSelectPage: (page) => switchPage(page),
    });

    layoutPrefsPanel.update({
      preferences,
      activeDevice,
      onSavePreferencesPatch: handleSavePreferencesPatch,
    });

    backupPanel.update({
      jobCount: jobs.length,
      onExport: handleExportBackup,
      onImport: handleImportBackup,
    });

    workspaceHost.innerHTML = '';

    if (loading) {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'zj-empty-board';
      loadingEl.textContent = '正在读取看板…';
      workspaceHost.append(loadingEl);
      return;
    }

    if (navState.activePage === 'timeline') {
      const page = document.createElement('section');
      page.className = 'zj-schedule-page is-timeline';
      page.setAttribute('aria-label', '跨岗位时间线');
      if (activeDevice === 'mobile') {
        page.append(createSchedulePageHeader(() => switchPage('board')));
      }
      const body = document.createElement('div');
      body.className = 'zj-schedule-page-body';
      body.append(createScheduleTimelineView(jobs, scheduleState, handleScheduleSelect));
      page.append(body);
      workspaceHost.append(page);
      return;
    }

    if (!inlineCalendar && navState.activePage === 'calendar') {
      const page = document.createElement('section');
      page.className = 'zj-schedule-page is-calendar';
      page.setAttribute('aria-label', '岗位月历');
      page.append(createSchedulePageHeader(() => switchPage('board')));
      const body = document.createElement('div');
      body.className = 'zj-schedule-page-body';
      body.append(createCalendarView(jobs, scheduleState, handleScheduleSelect));
      page.append(body);
      workspaceHost.append(page);
      return;
    }

    const hasVisibleModules = renderBoardModules(activeDevice);
    if (inlineCalendar && hasVisibleModules) {
      const grid = document.createElement('div');
      grid.className = 'zj-workspace-grid is-desktop-board';
      const primaryCol = document.createElement('div');
      primaryCol.className = 'zj-workspace-primary';
      primaryCol.append(modulesContainer);

      const calendarAside = document.createElement('aside');
      calendarAside.className = 'zj-workspace-calendar';
      calendarAside.setAttribute('aria-label', '岗位月历');
      calendarAside.append(createCalendarView(jobs, scheduleState, handleScheduleSelect));

      grid.append(primaryCol, calendarAside);
      workspaceHost.append(grid);
    } else {
      workspaceHost.append(modulesContainer);
    }
  };

  const refresh = async (): Promise<void> => {
    refreshBtn.disabled = true;
    try {
      const [jobsRes, prefsRes] = await Promise.all([
        store.listJobs(),
        store.getPreferences(),
      ]);
      loading = false;

      if (!jobsRes.ok) {
        feedbackBanner.setState({
          tone: 'failed',
          message: formatReadFailureMessage(jobsRes.failure),
          allowRefresh: true,
          sticky: true,
        });
      } else {
        jobs = jobsRes.value.map(domainJobToCardData);
        if (prefsRes.ok) {
          preferences = prefsRes.value;
        } else {
          feedbackBanner.setState({
            tone: 'failed',
            message: formatReadFailureMessage(prefsRes.failure),
            allowRefresh: true,
            sticky: true,
          });
        }
        // Preserve unresolved failed/unknown/conflict alert across active refresh!
        feedbackBanner.onRefreshAcknowledge('（已重读最新记录，请核对当前状态）');
      }
    } catch (err) {
      loading = false;
      feedbackBanner.setState({
        tone: 'failed',
        message: err instanceof Error ? err.message : '读取看板失败，请重试。',
        allowRefresh: true,
        sticky: true,
      });
    } finally {
      refreshBtn.disabled = false;
      renderModules();
    }
  };

  refreshBtn.addEventListener('click', () => {
    void refresh();
  });
  settingsBtn.addEventListener('click', () => settingsDialog.open(settingsBtn));

  const onMediaChange = (): void => renderModules();
  mediaQuery?.addEventListener('change', onMediaChange);
  wideMediaQuery?.addEventListener('change', onMediaChange);

  const onBeforeInstallPrompt = (e: Event): void => {
    e.preventDefault();
    deferredInstallPrompt = e as BeforeInstallPromptEvent;
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }

  shell.append(
    topbar,
    main,
    jobFormDialog.dialog,
    stepFormDialog.dialog,
    detailDialog.dialog,
    settingsDialog.dialog,
  );
  container.replaceChildren(shell);

  renderModules();
  void refresh();

  return {
    refresh,
    getJobs: () => jobs,
    getPreferences: () => preferences,
    getMobileHistoryMode: () => mobileHistoryMode,
    setMobileHistoryMode(mode) {
      mobileHistoryMode = mode;
      renderModules();
    },
    getActivePage: () => navState.activePage,
    setActivePage(page) {
      switchPage(page);
    },
    destroy() {
      if (locateTimerRef.timer !== null) {
        clearTimeout(locateTimerRef.timer);
        locateTimerRef.timer = null;
      }
      mediaQuery?.removeEventListener('change', onMediaChange);
      wideMediaQuery?.removeEventListener('change', onMediaChange);
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      }
      desktopBoard.destroy();
      mobileBoard.destroy();
      agendaSection.destroy();
      feedbackBanner.destroy();
      jobFormDialog.destroy();
      stepFormDialog.destroy();
      detailDialog.destroy();
      settingsDialog.destroy();
      shell.remove();
    },
  };
}
