import '../styles/fonts';
import { createDesktopJobBoard } from '../components/desktop-job-card';
import { createJobDetailDialog } from '../components/job-form-dialog';
import { createMobileJobBoard } from '../components/mobile-job-card';
import { createSettingsDialog } from '../components/settings-about';
import {
  formatStepInlineText,
  getJobDisplayName,
  getLatestStep,
  sanitizeHttpUrl,
} from '../format';
import { createIcon } from '../icons';
import type {
  ApplicationResult,
  JobBoardCallbacks,
  JobCardData,
  JobStep,
  StepTimeValue,
} from '../types';
import { createDesignBaselineJobs, createEdgeCaseJobs } from './sample-jobs';

type DatasetPreset = 'baseline' | 'empty' | 'edge';
type DesktopWidthPreset = 'fluid' | '1024' | '820';
type MobileWidthPreset = '390' | '320' | '430';

let stepSeq = 100;
let jobSeq = 100;

function nextId(prefix: string): string {
  return `${prefix}-${++stepSeq}`;
}

export function mountDemoApp(container: HTMLElement): void {
  let activeDataset: DatasetPreset = 'baseline';
  let jobs: JobCardData[] = createDesignBaselineJobs();
  let desktopWidth: DesktopWidthPreset = 'fluid';
  let mobileWidth: MobileWidthPreset = '390';
  let menuContainer: 'inline' | 'sheet' = 'sheet';
  let fontFallback = false;
  let lastActionLog = '就绪：可验证轻卡片、横向时间线回看、卡面主动作与「更多」菜单。';

  const appRoot = document.createElement('div');
  appRoot.className = 'zj-ui-scope zj-demo-shell';

  // 演示控制条（仅用于 demo.html 验收对照，不属于正式产品控件）
  const toolbar = document.createElement('header');
  toolbar.className = 'zj-demo-toolbar';
  toolbar.innerHTML = `
    <div class="zj-demo-brand">
      <strong>扎口Job · UI 验证台</strong>
      <span class="zj-demo-tag">present-job-board 1.1 / 1.2 / 3.1</span>
    </div>
    <div class="zj-demo-controls">
      <div class="zj-demo-group" role="group" aria-label="数据集切换">
        <button type="button" class="zj-demo-chip is-active" data-preset="baseline">四份样本 (4)</button>
        <button type="button" class="zj-demo-chip" data-preset="empty">空看板 (0)</button>
        <button type="button" class="zj-demo-chip" data-preset="edge">边界长文本/多轮</button>
        <button type="button" class="zj-demo-chip" data-action="reset-dataset">重置</button>
      </div>
      <div class="zj-demo-group" role="group" aria-label="字体模式">
        <button type="button" class="zj-demo-chip is-active" data-font="misans">MiSans VF 5.0.0</button>
        <button type="button" class="zj-demo-chip" data-font="fallback">系统回退字体</button>
      </div>
      <div class="zj-demo-group">
        <a class="zj-demo-chip" href="./schedule-demo.html" data-link="schedule-demo">日程与时间线 10 场景 ↗</a>
        <button type="button" class="zj-demo-chip" data-action="open-settings">设置 → 关于</button>
        <button type="button" class="zj-demo-chip is-primary" data-action="add-job">+ 添加岗位</button>
      </div>
    </div>
  `;

  // 1.1 字体渲染核对条
  const fontPanel = document.createElement('section');
  fontPanel.className = 'zj-demo-font-check';
  fontPanel.setAttribute('aria-label', '1.1 字体与字重核对');
  fontPanel.innerHTML = `
    <div class="zj-demo-font-meta">
      <span class="zj-demo-label">1.1 MiSans VF 渲染核对</span>
      <span class="zj-demo-font-status" data-font-status>检测字体加载中…</span>
    </div>
    <div class="zj-demo-font-samples">
      <span style="font-weight: 400">400 常规 · 青禾科技 Backend 0123456789</span>
      <span style="font-weight: 600">600 半粗 · 拾光数据 Offer 18:00</span>
      <span style="font-weight: 650; font-variant-numeric: tabular-nums">650 强调 · 周五 15:00 / 2026-11-27</span>
      <input class="zj-form-input zj-demo-sample-input" type="text" value="16px 输入控件：https://jobs.example.com/p/42" aria-label="字体字号验证输入框" />
    </div>
  `;

  // 回调事件观察条（用于验证 3.1：回看一面时更新二面仍指向二面）
  const logBar = document.createElement('div');
  logBar.className = 'zj-demo-log';
  logBar.setAttribute('role', 'status');
  logBar.setAttribute('aria-live', 'polite');

  // 1.2 桌面工作台区块
  const desktopSection = document.createElement('section');
  desktopSection.className = 'zj-demo-section';
  desktopSection.setAttribute('aria-label', '1.2 桌面横向进展卡');
  const desktopHeader = document.createElement('div');
  desktopHeader.className = 'zj-demo-section-head';
  desktopHeader.innerHTML = `
    <div>
      <h2>1.2 桌面工作台（横向进展卡）</h2>
      <p>新看板初始为零条记录；本区展示四份设计基底样本与宽度切换对照。</p>
    </div>
    <div class="zj-demo-group" role="group" aria-label="桌面宽度">
      <button type="button" class="zj-demo-chip is-active" data-desktop-width="fluid">自适应宽屏</button>
      <button type="button" class="zj-demo-chip" data-desktop-width="1024">1024px</button>
      <button type="button" class="zj-demo-chip" data-desktop-width="820">820px 中间窗口</button>
    </div>
  `;
  const desktopStage = document.createElement('div');
  desktopStage.className = 'zj-demo-desktop-stage';

  // 3.1 手机双方案对照区块
  const mobileSection = document.createElement('section');
  mobileSection.id = 'mobile';
  mobileSection.className = 'zj-demo-section';
  mobileSection.setAttribute('aria-label', '3.1 手机双历史交互对照');
  const mobileHeader = document.createElement('div');
  mobileHeader.className = 'zj-demo-section-head';
  mobileHeader.innerHTML = `
    <div>
      <h2>3.1 手机双候选交互（同一组数据同步操作）</h2>
      <p>左：卡内点击展开（expand）；右：卡内左右滑动（swipe）。均从最新进展开始，回看一面时「更新进展」仍指向当前二面。</p>
    </div>
    <div class="zj-demo-group" role="group" aria-label="手机宽度">
      <button type="button" class="zj-demo-chip" data-mobile-width="320">320px</button>
      <button type="button" class="zj-demo-chip is-active" data-mobile-width="390">390px</button>
      <button type="button" class="zj-demo-chip" data-mobile-width="430">430px</button>
    </div>
    <label>更多菜单
      <select data-menu-container>
        <option value="inline">卡内展开</option>
        <option value="sheet" selected>底部面板</option>
      </select>
    </label>
  `;
  const mobileGrid = document.createElement('div');
  mobileGrid.className = 'zj-demo-mobile-grid';

  const expandColumn = document.createElement('div');
  expandColumn.className = 'zj-demo-phone-col';
  expandColumn.innerHTML = '<div class="zj-demo-col-title">候选 A · 卡内点击展开（expand）</div>';
  const expandFrame = document.createElement('div');
  expandFrame.className = 'zj-demo-phone-frame';
  expandFrame.dataset.width = '390';

  const swipeColumn = document.createElement('div');
  swipeColumn.className = 'zj-demo-phone-col';
  swipeColumn.innerHTML = '<div class="zj-demo-col-title">候选 B · 卡内左右滑动（swipe）</div>';
  const swipeFrame = document.createElement('div');
  swipeFrame.className = 'zj-demo-phone-frame';
  swipeFrame.dataset.width = '390';

  expandColumn.append(expandFrame);
  swipeColumn.append(swipeFrame);
  mobileGrid.append(expandColumn, swipeColumn);

  // 设置 → 关于 & 详情弹窗
  const settingsDialog = createSettingsDialog({ aboutOpenByDefault: true });
  const detailDialog = createJobDetailDialog();

  // 演示用表单弹窗（添加岗位 / 补充资料 / 登记下一步 / 编辑指定节点）
  const infoDialog = document.createElement('dialog');
  infoDialog.className = 'zj-dialog';
  infoDialog.innerHTML = `
    <form method="dialog" data-info-form>
      <div class="zj-dialog-heading">
        <h2 data-info-title>添加岗位</h2>
        <button type="button" class="zj-icon-btn" data-close-dialog aria-label="关闭"></button>
      </div>
      <label class="zj-form-field">招聘链接<input class="zj-form-input" name="url" type="url" placeholder="https://..." autocomplete="off"></label>
      <label class="zj-form-field">公司<input class="zj-form-input" name="company" type="text" autocomplete="off"></label>
      <label class="zj-form-field">职位<input class="zj-form-input" name="position" type="text" autocomplete="off"></label>
      <label class="zj-form-field">地点<input class="zj-form-input" name="location" type="text" autocomplete="off"></label>
      <label class="zj-form-field">薪资<input class="zj-form-input" name="salary" type="text" autocomplete="off"></label>
      <p class="zj-form-error" data-info-error hidden>请至少填写招聘链接，或填写公司和职位。</p>
      <div class="zj-dialog-actions">
        <button type="button" class="zj-btn" data-close-dialog>取消</button>
        <button type="submit" class="zj-btn zj-btn-primary">保存</button>
      </div>
    </form>
  `;
  infoDialog.querySelector('[data-close-dialog]')?.append(createIcon('x'));

  const stepDialog = document.createElement('dialog');
  stepDialog.className = 'zj-dialog';
  stepDialog.innerHTML = `
    <form method="dialog" data-step-form>
      <div class="zj-dialog-heading">
        <h2 data-step-title>登记下一步</h2>
        <button type="button" class="zj-icon-btn" data-close-dialog aria-label="关闭"></button>
      </div>
      <label class="zj-form-field" data-kind-wrap>环节类型
        <select class="zj-form-select" name="kind">
          <option value="interview">面试</option>
          <option value="applied">已投递</option>
          <option value="assessment">笔试 / 测评</option>
          <option value="oc">OC</option>
          <option value="written_offer">书面 Offer</option>
        </select>
      </label>
      <label class="zj-form-field" data-round-wrap>面试轮次
        <select class="zj-form-select" name="roundLabel">
          <option value="一面">一面</option>
          <option value="二面">二面</option>
          <option value="三面" selected>三面</option>
          <option value="四面">四面</option>
          <option value="终面">终面</option>
        </select>
      </label>
      <label class="zj-form-field" data-status-wrap>面试状态
        <select class="zj-form-select" name="interviewStatus">
          <option value="pending">待面试</option>
          <option value="completed">已面</option>
        </select>
      </label>
      <label class="zj-form-field" data-assess-wrap hidden>笔试状态
        <select class="zj-form-select" name="assessCompleted">
          <option value="false">待完成</option>
          <option value="true">已完成</option>
        </select>
      </label>
      <label class="zj-form-field" data-time-wrap>日期 / 时间（可选）
        <input class="zj-form-input" name="timeLabel" type="text" placeholder="例如：下周二 14:30 或 12月5日" autocomplete="off">
      </label>
      <div class="zj-dialog-actions">
        <button type="button" class="zj-btn" data-close-dialog>取消</button>
        <button type="submit" class="zj-btn zj-btn-primary">确认</button>
      </div>
    </form>
  `;
  stepDialog.querySelector('[data-close-dialog]')?.append(createIcon('x'));

  let editingJobId: string | null = null;
  let stepTargetJobId: string | null = null;
  let editingStepId: string | null = null;

  const setLog = (msg: string): void => {
    lastActionLog = msg;
    logBar.textContent = `最近回调：${msg}`;
  };

  const updateJob = (
    jobId: string,
    updater: (prev: JobCardData) => JobCardData,
  ): void => {
    jobs = jobs.map((item) => (item.id === jobId ? updater(item) : item));
    syncAllBoards();
  };

  const callbacks: JobBoardCallbacks = {
    onToggleStar(job, nextStarred) {
      updateJob(job.id, (prev) => ({ ...prev, starred: nextStarred }));
      setLog(
        `onToggleStar -> jobId=${job.id} (${getJobDisplayName(job)}), starred=${nextStarred}`,
      );
    },
    onRequestAddJob() {
      editingJobId = null;
      const form = infoDialog.querySelector<HTMLFormElement>('[data-info-form]')!;
      form.reset();
      infoDialog.querySelector<HTMLElement>('[data-info-title]')!.textContent =
        '添加岗位';
      infoDialog.querySelector<HTMLElement>('[data-info-error]')!.hidden = true;
      infoDialog.showModal();
    },
    onRequestEditDetails(job) {
      editingJobId = job.id;
      const form = infoDialog.querySelector<HTMLFormElement>('[data-info-form]')!;
      form.reset();
      (form.elements.namedItem('url') as HTMLInputElement).value = job.url ?? '';
      (form.elements.namedItem('company') as HTMLInputElement).value =
        job.company;
      (form.elements.namedItem('position') as HTMLInputElement).value =
        job.position;
      (form.elements.namedItem('location') as HTMLInputElement).value =
        job.location ?? '';
      (form.elements.namedItem('salary') as HTMLInputElement).value =
        job.salary ?? '';
      infoDialog.querySelector<HTMLElement>('[data-info-title]')!.textContent =
        `编辑资料 · ${getJobDisplayName(job)}`;
      infoDialog.querySelector<HTMLElement>('[data-info-error]')!.hidden = true;
      infoDialog.showModal();
    },
    onCompleteCurrentStep(job, currentStep) {
      updateJob(job.id, (prev) => ({
        ...prev,
        steps: prev.steps.map((s): JobStep => {
          if (s.id !== currentStep.id) return s;
          if (s.kind === 'interview') {
            return { ...s, status: 'completed' };
          }
          if (s.kind === 'assessment') {
            return { ...s, completed: true };
          }
          return s;
        }),
      }));
      setLog(
        `onCompleteCurrentStep -> jobId=${job.id}, targetStepId=${currentStep.id} (${formatStepInlineText(currentStep)})`,
      );
    },
    onRequestAddStep(job) {
      stepTargetJobId = job.id;
      editingStepId = null;
      const form = stepDialog.querySelector<HTMLFormElement>('[data-step-form]')!;
      form.reset();
      stepDialog.querySelector<HTMLElement>('[data-step-title]')!.textContent =
        `其他进展 · ${getJobDisplayName(job)}`;
      stepDialog.querySelector<HTMLElement>('[data-kind-wrap]')!.hidden = false;
      syncStepFormVisibility(form);
      stepDialog.showModal();
    },
    onSubmitNewStep(job, input) {
      let newStep: JobStep;
      const id = nextId('step');
      if (input.kind === 'applied') newStep = { id, kind: 'applied' };
      else if (input.kind === 'oc') newStep = { id, kind: 'oc' };
      else if (input.kind === 'written_offer')
        newStep = { id, kind: 'written_offer', deadline: input.deadline };
      else if (input.kind === 'assessment')
        newStep = {
          id,
          kind: 'assessment',
          completed: input.completed,
          deadline: input.deadline,
        };
      else
        newStep = {
          id,
          kind: 'interview',
          roundLabel: input.roundLabel,
          status: input.status,
          scheduledAt: input.scheduledAt,
        };
      updateJob(job.id, (prev) => ({
        ...prev,
        steps: [...prev.steps, newStep],
      }));
      setLog(
        `onSubmitNewStep -> jobId=${job.id}, stepId=${newStep.id} (${formatStepInlineText(newStep)})`,
      );
    },
    onRequestEditStep(job, targetStep) {
      stepTargetJobId = job.id;
      editingStepId = targetStep.id;
      const form = stepDialog.querySelector<HTMLFormElement>('[data-step-form]')!;
      form.reset();
      stepDialog.querySelector<HTMLElement>('[data-step-title]')!.textContent =
        `编辑 ${formatStepInlineText(targetStep)}`;
      (form.elements.namedItem('kind') as HTMLSelectElement).value =
        targetStep.kind;
      stepDialog.querySelector<HTMLElement>('[data-kind-wrap]')!.hidden = true;
      if (targetStep.kind === 'interview') {
        (form.elements.namedItem('roundLabel') as HTMLSelectElement).value =
          targetStep.roundLabel;
        (form.elements.namedItem('interviewStatus') as HTMLSelectElement).value =
          targetStep.status;
        (form.elements.namedItem('timeLabel') as HTMLInputElement).value =
          targetStep.scheduledAt?.label ?? targetStep.scheduledAt?.date ?? '';
      } else if (targetStep.kind === 'assessment') {
        (form.elements.namedItem('assessCompleted') as HTMLSelectElement).value =
          String(targetStep.completed);
        (form.elements.namedItem('timeLabel') as HTMLInputElement).value =
          targetStep.deadline?.label ?? targetStep.deadline?.date ?? '';
      } else if (targetStep.kind === 'written_offer') {
        (form.elements.namedItem('timeLabel') as HTMLInputElement).value =
          targetStep.deadline?.label ?? targetStep.deadline?.date ?? '';
      }
      syncStepFormVisibility(form);
      stepDialog.showModal();
      setLog(
        `onRequestEditStep -> jobId=${job.id}, targetStepId=${targetStep.id} (${formatStepInlineText(targetStep)})`,
      );
    },
    onRemoveLatestStep(job, latestStep) {
      const actualLatest = getLatestStep(job);
      if (!actualLatest || actualLatest.id !== latestStep.id) {
        setLog('撤回拒绝：目标节点已不是末节点');
        return;
      }
      updateJob(job.id, (prev) => ({
        ...prev,
        steps: prev.steps.slice(0, -1),
      }));
      setLog(
        `onRemoveLatestStep -> jobId=${job.id}, removedStepId=${latestStep.id} (${formatStepInlineText(latestStep)})`,
      );
    },
    onSetResult(job, result: ApplicationResult | null) {
      updateJob(job.id, (prev) => ({ ...prev, result }));
      setLog(
        `onSetResult -> jobId=${job.id} (${getJobDisplayName(job)}), result=${result ?? 'null (恢复跟进)'}`,
      );
    },
    onInspectDetails(job) {
      detailDialog.open(job);
      setLog(
        `onInspectDetails -> ${getJobDisplayName(job)} | JD: ${job.jd ?? '无'}`,
      );
    },
  };

  const desktopBoard = createDesktopJobBoard({ jobs, callbacks });
  const mobileExpandBoard = createMobileJobBoard({
    mode: 'expand',
    menuContainer,
    jobs,
    callbacks,
  });
  const mobileSwipeBoard = createMobileJobBoard({
    mode: 'swipe',
    menuContainer,
    jobs,
    callbacks,
  });

  function syncStepFormVisibility(form: HTMLFormElement): void {
    const kind = (form.elements.namedItem('kind') as HTMLSelectElement).value;
    stepDialog.querySelector<HTMLElement>('[data-round-wrap]')!.hidden =
      kind !== 'interview';
    stepDialog.querySelector<HTMLElement>('[data-status-wrap]')!.hidden =
      kind !== 'interview';
    stepDialog.querySelector<HTMLElement>('[data-assess-wrap]')!.hidden =
      kind !== 'assessment';
    stepDialog.querySelector<HTMLElement>('[data-time-wrap]')!.hidden =
      kind === 'applied' || kind === 'oc';
  }

  function syncAllBoards(): void {
    desktopBoard.update({ jobs, callbacks });
    mobileExpandBoard.update({ mode: 'expand', menuContainer, jobs, callbacks });
    mobileSwipeBoard.update({ mode: 'swipe', menuContainer, jobs, callbacks });
  }

  function syncFontStatus(): void {
    const statusEl = fontPanel.querySelector<HTMLElement>('[data-font-status]');
    if (!statusEl) return;
    if (fontFallback) {
      statusEl.textContent = '当前：已切换为系统回退字体栈（用于对照回退排版）';
      return;
    }
    const loaded =
      typeof document.fonts?.check === 'function'
        ? document.fonts.check('600 16px "MiSans VF"')
        : false;
    statusEl.textContent = loaded
      ? '当前：MiSans VF 已加载生效（支持 400 / 600 / 650 无级字重）'
      : '当前：MiSans VF 样式已注入（等待或使用系统回退）';
  }

  // 组装 DOM
  desktopStage.append(desktopBoard.element);
  desktopSection.append(desktopHeader, desktopStage);

  expandFrame.append(mobileExpandBoard.element);
  swipeFrame.append(mobileSwipeBoard.element);
  mobileSection.append(mobileHeader, mobileGrid);

  appRoot.append(
    toolbar,
    fontPanel,
    logBar,
    desktopSection,
    mobileSection,
    settingsDialog.dialog,
    detailDialog.dialog,
    infoDialog,
    stepDialog,
  );
  container.replaceChildren(appRoot);
  setLog(lastActionLog);

  if (document.fonts) {
    void document.fonts.ready.then(syncFontStatus);
    document.fonts.addEventListener('loadingdone', syncFontStatus);
  } else {
    syncFontStatus();
  }

  // 工具条交互
  toolbar.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest('button');
    if (!btn) return;
    const preset = btn.dataset.preset as DatasetPreset | undefined;
    if (preset) {
      activeDataset = preset;
      jobs =
        preset === 'baseline'
          ? createDesignBaselineJobs()
          : preset === 'edge'
            ? createEdgeCaseJobs()
            : [];
      toolbar
        .querySelectorAll<HTMLButtonElement>('[data-preset]')
        .forEach((b) => b.classList.toggle('is-active', b.dataset.preset === preset));
      syncAllBoards();
      setLog(`已切换数据集：${preset} (${jobs.length} 条)`);
      return;
    }
    const fontMode = btn.dataset.font;
    if (fontMode) {
      fontFallback = fontMode === 'fallback';
      appRoot.dataset.fontFallback = String(fontFallback);
      toolbar
        .querySelectorAll<HTMLButtonElement>('[data-font]')
        .forEach((b) => b.classList.toggle('is-active', b.dataset.font === fontMode));
      syncFontStatus();
      return;
    }
    if (btn.dataset.action === 'reset-dataset') {
      jobs =
        activeDataset === 'baseline'
          ? createDesignBaselineJobs()
          : activeDataset === 'edge'
            ? createEdgeCaseJobs()
            : [];
      syncAllBoards();
      setLog('已重置当前数据集');
    } else if (btn.dataset.action === 'open-settings') {
      settingsDialog.open(btn);
    } else if (btn.dataset.action === 'add-job') {
      callbacks.onRequestAddJob?.();
    }
  });

  desktopHeader.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-desktop-width]',
    );
    if (!btn) return;
    desktopWidth = btn.dataset.desktopWidth as DesktopWidthPreset;
    desktopHeader
      .querySelectorAll<HTMLButtonElement>('[data-desktop-width]')
      .forEach((b) =>
        b.classList.toggle('is-active', b.dataset.desktopWidth === desktopWidth),
      );
    desktopStage.dataset.width = desktopWidth;
  });

  const menuSelector = mobileHeader.querySelector<HTMLSelectElement>('[data-menu-container]')!;
  menuSelector.addEventListener('change', () => {
    menuContainer = menuSelector.value === 'sheet' ? 'sheet' : 'inline';
    syncAllBoards();
  });

  mobileHeader.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-mobile-width]',
    );
    if (!btn) return;
    mobileWidth = btn.dataset.mobileWidth as MobileWidthPreset;
    mobileHeader
      .querySelectorAll<HTMLButtonElement>('[data-mobile-width]')
      .forEach((b) =>
        b.classList.toggle('is-active', b.dataset.mobileWidth === mobileWidth),
      );
    expandFrame.dataset.width = mobileWidth;
    swipeFrame.dataset.width = mobileWidth;
  });

  // 弹窗表单提交
  infoDialog.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === infoDialog || target.closest('[data-close-dialog]')) {
      infoDialog.close();
    }
  });

  infoDialog
    .querySelector<HTMLFormElement>('[data-info-form]')
    ?.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.currentTarget as HTMLFormElement;
      const rawUrl = (form.elements.namedItem('url') as HTMLInputElement).value.trim();
      const url = rawUrl ? sanitizeHttpUrl(rawUrl) : null;
      const errEl = infoDialog.querySelector<HTMLElement>('[data-info-error]')!;
      if (rawUrl && !url) {
        errEl.textContent = '招聘链接仅允许 http:// 或 https:// 开头。';
        errEl.hidden = false;
        return;
      }
      const company = (
        form.elements.namedItem('company') as HTMLInputElement
      ).value.trim();
      const position = (
        form.elements.namedItem('position') as HTMLInputElement
      ).value.trim();
      const location = (
        form.elements.namedItem('location') as HTMLInputElement
      ).value.trim();
      const salary = (
        form.elements.namedItem('salary') as HTMLInputElement
      ).value.trim();

      if (!url && !(company && position)) {
        errEl.textContent = '请至少填写招聘链接，或填写公司和职位。';
        errEl.hidden = false;
        return;
      }

      if (editingJobId) {
        updateJob(editingJobId, (prev) => ({
          ...prev,
          url: url || undefined,
          company,
          position,
          location: location || undefined,
          salary: salary || undefined,
        }));
        setLog(`已更新资料 -> jobId=${editingJobId}`);
      } else {
        const newJob: JobCardData = {
          id: `demo-job-${++jobSeq}`,
          version: 1,
          company,
          position,
          url: url || undefined,
          location: location || undefined,
          salary: salary || undefined,
          starred: false,
          result: null,
          steps: [],
        };
        jobs = [...jobs, newJob];
        syncAllBoards();
        setLog(`已添加岗位 -> jobId=${newJob.id} (${getJobDisplayName(newJob)})`);
      }
      infoDialog.close();
    });

  stepDialog.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === stepDialog || target.closest('[data-close-dialog]')) {
      stepDialog.close();
    }
  });

  const stepForm = stepDialog.querySelector<HTMLFormElement>('[data-step-form]');
  stepForm
    ?.querySelector<HTMLSelectElement>('[name="kind"]')
    ?.addEventListener('change', () => syncStepFormVisibility(stepForm));

  stepForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!stepTargetJobId) return;
    const form = e.currentTarget as HTMLFormElement;
    const kind = (form.elements.namedItem('kind') as HTMLSelectElement)
      .value as JobStep['kind'];
    const timeText = (
      form.elements.namedItem('timeLabel') as HTMLInputElement
    ).value.trim();
    const timeValue: StepTimeValue | undefined = timeText
      ? {
          precision: /^\d{4}-\d{2}-\d{2}$/.test(timeText) ? 'date' : 'datetime',
          date: /^\d{4}-\d{2}-\d{2}$/.test(timeText) ? timeText : '2026-11-27',
          label: timeText,
        }
      : undefined;

    const buildStep = (id: string): JobStep => {
      switch (kind) {
        case 'applied':
          return { id, kind: 'applied' };
        case 'oc':
          return { id, kind: 'oc' };
        case 'written_offer':
          return { id, kind: 'written_offer', deadline: timeValue };
        case 'assessment':
          return {
            id,
            kind: 'assessment',
            completed:
              (form.elements.namedItem('assessCompleted') as HTMLSelectElement)
                .value === 'true',
            deadline: timeValue,
          };
        case 'interview':
          return {
            id,
            kind: 'interview',
            roundLabel: (
              form.elements.namedItem('roundLabel') as HTMLSelectElement
            ).value,
            status: (
              form.elements.namedItem('interviewStatus') as HTMLSelectElement
            ).value as 'pending' | 'completed',
            scheduledAt: timeValue,
          };
      }
    };

    if (editingStepId) {
      const targetId = editingStepId;
      updateJob(stepTargetJobId, (prev) => ({
        ...prev,
        steps: prev.steps.map((s) => (s.id === targetId ? buildStep(s.id) : s)),
      }));
      setLog(`已更正历史节点 -> jobId=${stepTargetJobId}, stepId=${targetId}`);
    } else {
      const newStep = buildStep(nextId('step'));
      updateJob(stepTargetJobId, (prev) => ({
        ...prev,
        steps: [...prev.steps, newStep],
      }));
      setLog(
        `已登记新节点 -> jobId=${stepTargetJobId}, stepId=${newStep.id} (${formatStepInlineText(newStep)})`,
      );
    }
    stepDialog.close();
  });
}

const mountEl = document.getElementById('demo-app');
if (mountEl) {
  mountDemoApp(mountEl);
}
