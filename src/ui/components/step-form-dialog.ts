import { newId } from '../../domain/index.ts';
import {
  buildDeadlineFromInputs,
  deadlineToStepTime,
  formatStepInlineText,
  formatStepTitle,
  getJobDisplayName,
  getLatestStep,
  inferNextInterviewRound,
  isEditableStepKind,
  splitStepTimeForInput,
} from '../format.ts';
import { createIcon } from '../icons.ts';
import type { AddStepInput, JobCardData, JobStep } from '../types.ts';

export interface StepWithdrawPayload {
  jobId: string;
  expectedVersion: number;
  nodeId: string;
}

export interface CreateStepFormDialogOptions {
  onRemoveLatestStep?: (
    payload: StepWithdrawPayload,
  ) => Promise<boolean> | boolean;
}

export type StepFormSubmitPayload =
  | {
      mode: 'create';
      jobId: string;
      expectedVersion: number;
      /** Stable client-generated nodeId bound at openCreate for idempotent retries */
      nodeId: string;
      step: AddStepInput;
    }
  | {
      mode: 'edit';
      /** Bound from job and targetStep when openEdit was opened */
      jobId: string;
      expectedVersion: number;
      nodeId: string;
      step: AddStepInput;
    };

export interface StepFormDialogHandle {
  dialog: HTMLDialogElement;
  openCreate: (job: JobCardData, trigger?: HTMLElement | null) => void;
  openEdit: (
    job: JobCardData,
    targetStep: JobStep,
    trigger?: HTMLElement | null,
  ) => void;
  setSubmitting: (submitting: boolean) => void;
  showError: (message: string) => void;
  close: () => void;
  destroy: () => void;
}

const PRESET_ROUNDS = ['一面', '二面', '三面', '四面', '五面', '终面'];

export function createStepFormDialog(
  onSubmit: (payload: StepFormSubmitPayload) => Promise<boolean> | boolean,
  dialogOptions?: CreateStepFormDialogOptions,
): StepFormDialogHandle {
  const dialog = document.createElement('dialog');
  dialog.className = 'zj-dialog';
  dialog.setAttribute('aria-label', '进展环节表单');

  const form = document.createElement('form');
  form.noValidate = true;

  const heading = document.createElement('div');
  heading.className = 'zj-dialog-heading';
  const titleEl = document.createElement('h2');
  titleEl.textContent = '登记下一步';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'zj-icon-btn';
  closeBtn.setAttribute('aria-label', '关闭弹窗');
  closeBtn.append(createIcon('x'));
  heading.append(titleEl, closeBtn);

  const contextBanner = document.createElement('div');
  contextBanner.className = 'zj-step-context-banner';
  contextBanner.hidden = true;

  const makeField = (
    labelText: string,
    control: HTMLElement,
  ): HTMLLabelElement => {
    const label = document.createElement('label');
    label.className = 'zj-form-field';
    const span = document.createElement('span');
    span.textContent = labelText;
    label.append(span, control);
    return label;
  };

  const kindSelect = document.createElement('select');
  kindSelect.className = 'zj-form-select';
  kindSelect.name = 'kind';
  for (const [val, label] of [
    ['interview', '面试'],
    ['applied', '已投递'],
    ['assessment', '笔试 / 测评'],
    ['oc', 'OC（口头录用）'],
    ['written_offer', '书面 Offer'],
  ] as const) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    kindSelect.append(opt);
  }
  const kindField = makeField('环节类型', kindSelect);

  const roundSelect = document.createElement('select');
  roundSelect.className = 'zj-form-select';
  roundSelect.name = 'roundPreset';
  for (const r of PRESET_ROUNDS) {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    roundSelect.append(opt);
  }
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = '自定义轮次名称…';
  roundSelect.append(customOpt);
  const roundField = makeField('面试轮次', roundSelect);

  const customRoundInput = document.createElement('input');
  customRoundInput.className = 'zj-form-input';
  customRoundInput.type = 'text';
  customRoundInput.placeholder = '例如：HR 面 / 交叉面';
  customRoundInput.autocomplete = 'off';
  const customRoundField = makeField('自定义轮次', customRoundInput);

  const interviewStatusSelect = document.createElement('select');
  interviewStatusSelect.className = 'zj-form-select';
  interviewStatusSelect.name = 'interviewStatus';
  for (const [val, label] of [
    ['pending', '待面试'],
    ['completed', '已面'],
  ] as const) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    interviewStatusSelect.append(opt);
  }
  const interviewStatusField = makeField('面试状态', interviewStatusSelect);

  const assessmentStatusSelect = document.createElement('select');
  assessmentStatusSelect.className = 'zj-form-select';
  for (const [val, label] of [
    ['false', '待完成'],
    ['true', '已完成'],
  ] as const) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    assessmentStatusSelect.append(opt);
  }
  const assessmentStatusField = makeField('完成状态', assessmentStatusSelect);

  const dateInput = document.createElement('input');
  dateInput.className = 'zj-form-input';
  dateInput.type = 'date';
  dateInput.name = 'date';

  const clockInput = document.createElement('input');
  clockInput.className = 'zj-form-input';
  clockInput.type = 'time';
  clockInput.name = 'clock';

  const timeGroup = document.createElement('div');
  timeGroup.className = 'zj-time-inputs';
  const dateField = makeField('日期（可选）', dateInput);
  const clockField = makeField('时间（可选）', clockInput);
  timeGroup.append(dateField, clockField);

  const timeClearRow = document.createElement('div');
  timeClearRow.className = 'zj-time-helper-row';
  const clearTimeBtn = document.createElement('button');
  clearTimeBtn.type = 'button';
  clearTimeBtn.className = 'zj-text-btn';
  clearTimeBtn.textContent = '清空时间';
  clearTimeBtn.addEventListener('click', () => {
    dateInput.value = '';
    clockInput.value = '';
  });
  timeClearRow.append(clearTimeBtn);

  const errorEl = document.createElement('p');
  errorEl.className = 'zj-form-error';
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'zj-dialog-actions';
  const withdrawBtn = document.createElement('button');
  withdrawBtn.type = 'button';
  withdrawBtn.className = 'zj-btn zj-btn-danger-ghost zj-dialog-withdraw-btn';
  withdrawBtn.dataset.action = 'withdraw-step';
  withdrawBtn.textContent = '撤回末步';
  withdrawBtn.hidden = true;
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'zj-btn';
  cancelBtn.textContent = '取消';
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'zj-btn zj-btn-primary';
  submitBtn.textContent = '登记';
  actions.append(withdrawBtn, cancelBtn, submitBtn);

  form.append(
    heading,
    contextBanner,
    kindField,
    roundField,
    customRoundField,
    interviewStatusField,
    assessmentStatusField,
    timeGroup,
    timeClearRow,
    errorEl,
    actions,
  );
  dialog.append(form);

  let mode: 'create' | 'edit' = 'create';
  let boundJobId = '';
  let boundExpectedVersion = 1;
  let boundNodeId = '';
  let boundIsLatest = false;
  let boundEditable = true;
  let boundStepPrimary = '';
  let lastTrigger: HTMLElement | null = null;
  let submitting = false;

  const syncVisibility = (): void => {
    const kind = kindSelect.value;
    const isInterview = kind === 'interview';
    const isAssessment = kind === 'assessment';
    const editableForm = mode === 'create' || boundEditable;
    const hasTime =
      editableForm &&
      (kind === 'interview' || kind === 'assessment' || kind === 'written_offer');

    kindField.hidden = mode === 'edit';
    roundField.hidden = !editableForm || !isInterview;
    customRoundField.hidden =
      !editableForm || !isInterview || roundSelect.value !== '__custom__';
    // Creation uses single atomic log-step (always starts pending / incomplete);
    // status correction is an explicit edit/update-step operation.
    interviewStatusField.hidden = mode !== 'edit' || !boundEditable || !isInterview;
    assessmentStatusField.hidden = mode !== 'edit' || !boundEditable || !isAssessment;
    timeGroup.hidden = !hasTime;
    timeClearRow.hidden = !hasTime;
    submitBtn.hidden = !editableForm;
    withdrawBtn.hidden =
      mode !== 'edit' || !boundIsLatest || !dialogOptions?.onRemoveLatestStep;
    cancelBtn.textContent = editableForm ? '取消' : '关闭';
  };

  const setSubmitting = (
    busy: boolean,
    activeAction: 'submit' | 'withdraw' = 'submit',
  ): void => {
    submitting = busy;
    submitBtn.disabled = busy;
    withdrawBtn.disabled = busy;
    submitBtn.textContent =
      busy && activeAction === 'submit'
        ? '保存中…'
        : mode === 'create'
          ? '登记'
          : '保存修改';
    withdrawBtn.textContent =
      busy && activeAction === 'withdraw'
        ? '撤回中…'
        : boundStepPrimary
          ? `撤回末步（${boundStepPrimary}）`
          : '撤回末步';
  };

  const showError = (msg: string): void => {
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
  };

  const close = (): void => {
    if (dialog.open) dialog.close();
    setSubmitting(false);
    lastTrigger?.focus({ preventScroll: true });
    lastTrigger = null;
  };

  kindSelect.addEventListener('change', syncVisibility);
  roundSelect.addEventListener('change', syncVisibility);
  closeBtn.addEventListener('click', () => !submitting && close());
  cancelBtn.addEventListener('click', () => !submitting && close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && !submitting) close();
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (!submitting) close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting || !boundJobId) return;
    showError('');

    const kind = kindSelect.value as AddStepInput['kind'];
    let timeVal;
    if (kind === 'interview' || kind === 'assessment' || kind === 'written_offer') {
      const parsedTime = buildDeadlineFromInputs(dateInput.value, clockInput.value);
      if (!parsedTime.ok) {
        showError(parsedTime.error);
        return;
      }
      timeVal = deadlineToStepTime(parsedTime.value);
    }

    let step: AddStepInput;
    if (kind === 'applied') {
      step = { kind: 'applied' };
    } else if (kind === 'oc') {
      step = { kind: 'oc' };
    } else if (kind === 'written_offer') {
      step = { kind: 'written_offer', deadline: timeVal };
    } else if (kind === 'assessment') {
      step = {
        kind: 'assessment',
        completed: mode === 'edit' ? assessmentStatusSelect.value === 'true' : false,
        deadline: timeVal,
      };
    } else {
      const roundLabel =
        roundSelect.value === '__custom__'
          ? customRoundInput.value.trim()
          : roundSelect.value;
      if (!roundLabel) {
        showError('请填写面试轮次名称。');
        customRoundInput.focus();
        return;
      }
      step = {
        kind: 'interview',
        roundLabel,
        status:
          mode === 'edit'
            ? (interviewStatusSelect.value as 'pending' | 'completed')
            : 'pending',
        scheduledAt: timeVal,
      };
    }

    setSubmitting(true);
    try {
      const ok = await onSubmit({
        mode,
        jobId: boundJobId,
        expectedVersion: boundExpectedVersion,
        nodeId: boundNodeId,
        step,
      });
      if (ok) close();
      else setSubmitting(false);
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败，请重试。');
      setSubmitting(false);
    }
  });

  withdrawBtn.addEventListener('click', async () => {
    if (submitting || !boundJobId || !boundIsLatest || !dialogOptions?.onRemoveLatestStep) {
      return;
    }
    showError('');
    setSubmitting(true, 'withdraw');
    try {
      const ok = await dialogOptions.onRemoveLatestStep({
        jobId: boundJobId,
        expectedVersion: boundExpectedVersion,
        nodeId: boundNodeId,
      });
      if (ok) close();
      else setSubmitting(false);
    } catch (err) {
      showError(err instanceof Error ? err.message : '撤回失败，请重试。');
      setSubmitting(false);
    }
  });

  return {
    dialog,
    openCreate(job, trigger) {
      mode = 'create';
      boundJobId = job.id;
      boundExpectedVersion = job.version;
      boundNodeId = newId('node');
      boundIsLatest = false;
      boundEditable = true;
      boundStepPrimary = '';
      lastTrigger = trigger ?? null;
      form.reset();
      kindSelect.value = 'interview';
      const defaultRound = inferNextInterviewRound(job.steps);
      if (PRESET_ROUNDS.includes(defaultRound)) {
        roundSelect.value = defaultRound;
      } else {
        roundSelect.value = '__custom__';
        customRoundInput.value = defaultRound;
      }
      interviewStatusSelect.value = 'pending';
      titleEl.textContent = `其他进展 · ${getJobDisplayName(job)}`;
      contextBanner.hidden = true;
      showError('');
      syncVisibility();
      setSubmitting(false);
      if (!dialog.open) dialog.showModal();
      kindSelect.focus({ preventScroll: true });
    },
    openEdit(job, targetStep, trigger) {
      mode = 'edit';
      boundJobId = job.id;
      boundExpectedVersion = job.version;
      boundNodeId = targetStep.id;
      const latest = getLatestStep(job);
      boundIsLatest = Boolean(latest && latest.id === targetStep.id);
      boundEditable = isEditableStepKind(targetStep.kind);
      boundStepPrimary = formatStepTitle(targetStep).primary;
      lastTrigger = trigger ?? null;
      form.reset();
      kindSelect.value = targetStep.kind;
      withdrawBtn.textContent = `撤回末步（${boundStepPrimary}）`;
      titleEl.textContent = boundEditable
        ? `更正环节 · ${getJobDisplayName(job)}`
        : `末节点操作 · ${getJobDisplayName(job)}`;
      contextBanner.textContent = boundEditable
        ? `正在编辑节点：${formatStepInlineText(targetStep)}（仅更新此节点，不影响其他轮次）`
        : `当前末节点：${formatStepInlineText(targetStep)}（仅可撤回此末步，不改动已有其他节点）`;
      contextBanner.hidden = false;

      if (targetStep.kind === 'interview') {
        if (PRESET_ROUNDS.includes(targetStep.roundLabel)) {
          roundSelect.value = targetStep.roundLabel;
        } else {
          roundSelect.value = '__custom__';
          customRoundInput.value = targetStep.roundLabel;
        }
        interviewStatusSelect.value = targetStep.status;
        const parts = splitStepTimeForInput(targetStep.scheduledAt);
        dateInput.value = parts.date;
        clockInput.value = parts.clock;
      } else if (targetStep.kind === 'assessment') {
        assessmentStatusSelect.value = String(targetStep.completed);
        const parts = splitStepTimeForInput(targetStep.deadline);
        dateInput.value = parts.date;
        clockInput.value = parts.clock;
      } else if (targetStep.kind === 'written_offer') {
        const parts = splitStepTimeForInput(targetStep.deadline);
        dateInput.value = parts.date;
        clockInput.value = parts.clock;
      }

      showError('');
      syncVisibility();
      setSubmitting(false);
      if (!dialog.open) dialog.showModal();
      closeBtn.focus({ preventScroll: true });
    },
    setSubmitting,
    showError,
    close,
    destroy() {
      dialog.remove();
    },
  };
}
