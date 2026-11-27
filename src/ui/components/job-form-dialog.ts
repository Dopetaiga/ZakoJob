import { newId, type CreateJobInput } from '../../domain/index.ts';
import {
  formatJdForDisplay,
  formatUrlDisplay,
  getJobDisplayName,
  sanitizeHttpUrl,
} from '../format.ts';
import { createIcon } from '../icons.ts';
import type { JobCardData, JobDetailsDraft } from '../types.ts';

export type JobFormSubmitPayload =
  | {
      mode: 'create';
      /** Stable client-generated jobId bound at openCreate so retries stay idempotent */
      jobId: string;
      input: CreateJobInput;
    }
  | {
      mode: 'edit';
      /** Bound from the job snapshot when openEdit was opened */
      jobId: string;
      expectedVersion: number;
      draft: JobDetailsDraft;
    };

export interface JobFormDialogHandle {
  dialog: HTMLDialogElement;
  openCreate: (trigger?: HTMLElement | null) => void;
  openEdit: (job: JobCardData, trigger?: HTMLElement | null) => void;
  setSubmitting: (submitting: boolean) => void;
  showError: (message: string) => void;
  close: () => void;
  destroy: () => void;
}

export function createJobFormDialog(
  onSubmit: (payload: JobFormSubmitPayload) => Promise<boolean> | boolean,
): JobFormDialogHandle {
  const dialog = document.createElement('dialog');
  dialog.className = 'zj-dialog zj-dialog-form';
  dialog.setAttribute('aria-label', '岗位资料表单');

  const form = document.createElement('form');
  form.noValidate = true;

  const heading = document.createElement('div');
  heading.className = 'zj-dialog-heading';
  const titleEl = document.createElement('h2');
  titleEl.textContent = '添加岗位';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'zj-icon-btn';
  closeBtn.setAttribute('aria-label', '关闭表单');
  closeBtn.append(createIcon('x'));
  heading.append(titleEl, closeBtn);

  const hint = document.createElement('p');
  hint.className = 'zj-dialog-hint';
  hint.textContent =
    '可只粘贴招聘链接先收藏，或填写公司与职位名建档；也可一并填写地点、薪资与 JD。';

  const makeField = (
    labelText: string,
    inputEl: HTMLInputElement | HTMLTextAreaElement,
  ): HTMLLabelElement => {
    const label = document.createElement('label');
    label.className = 'zj-form-field';
    const span = document.createElement('span');
    span.textContent = labelText;
    label.append(span, inputEl);
    return label;
  };

  const urlInput = document.createElement('input');
  urlInput.className = 'zj-form-input';
  urlInput.name = 'url';
  urlInput.type = 'url';
  urlInput.placeholder = 'https://...';
  urlInput.autocomplete = 'off';

  const companyInput = document.createElement('input');
  companyInput.className = 'zj-form-input';
  companyInput.name = 'company';
  companyInput.type = 'text';
  companyInput.autocomplete = 'off';

  const positionInput = document.createElement('input');
  positionInput.className = 'zj-form-input';
  positionInput.name = 'position';
  positionInput.type = 'text';
  positionInput.autocomplete = 'off';

  const locationInput = document.createElement('input');
  locationInput.className = 'zj-form-input';
  locationInput.name = 'location';
  locationInput.type = 'text';
  locationInput.autocomplete = 'off';

  const salaryInput = document.createElement('input');
  salaryInput.className = 'zj-form-input';
  salaryInput.name = 'salary';
  salaryInput.type = 'text';
  salaryInput.placeholder = '例如：300 元/天 或 25k×15';
  salaryInput.autocomplete = 'off';

  const jdInput = document.createElement('textarea');
  jdInput.className = 'zj-form-textarea';
  jdInput.name = 'jd';
  jdInput.rows = 5;
  jdInput.placeholder = '可选：粘贴岗位要求摘要（纯文本）';

  const locationField = makeField('地点（可选）', locationInput);
  const salaryField = makeField('薪资（可选）', salaryInput);
  const jdField = makeField('岗位描述 JD（可选）', jdInput);

  const errorEl = document.createElement('p');
  errorEl.className = 'zj-form-error';
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'zj-dialog-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'zj-btn';
  cancelBtn.textContent = '取消';
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'zj-btn zj-btn-primary';
  submitBtn.textContent = '保存';
  actions.append(cancelBtn, submitBtn);

  form.append(
    heading,
    hint,
    makeField('招聘链接（http / https）', urlInput),
    makeField('公司', companyInput),
    makeField('职位', positionInput),
    locationField,
    salaryField,
    jdField,
    errorEl,
    actions,
  );
  dialog.append(form);

  let mode: 'create' | 'edit' = 'create';
  let boundJobId = '';
  let boundExpectedVersion = 1;
  let lastTrigger: HTMLElement | null = null;
  let submitting = false;

  const syncModeFields = (): void => {
    const isEdit = mode === 'edit';
    hint.hidden = isEdit;
    locationField.hidden = false;
    salaryField.hidden = false;
    jdField.hidden = false;
  };

  const setSubmitting = (busy: boolean): void => {
    submitting = busy;
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? '保存中…' : mode === 'create' ? '添加' : '保存';
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

  const onBackdrop = (e: MouseEvent): void => {
    if (e.target === dialog && !submitting) close();
  };

  const onCancel = (e: Event): void => {
    e.preventDefault();
    if (!submitting) close();
  };

  const handleSubmit = async (e: SubmitEvent): Promise<void> => {
    e.preventDefault();
    if (submitting) return;
    showError('');

    const rawUrl = urlInput.value.trim();
    let normalizedUrl: string | undefined;
    if (rawUrl) {
      const safe = sanitizeHttpUrl(rawUrl);
      if (!safe) {
        showError('招聘链接仅允许 http:// 或 https:// 开头的有效网址。');
        urlInput.focus();
        return;
      }
      normalizedUrl = safe;
    }

    const company = companyInput.value.trim();
    const position = positionInput.value.trim();
    const location = locationInput.value.trim();
    const salary = salaryInput.value.trim();
    const jobDescription = jdInput.value.trim() ? jdInput.value : '';

    if (!normalizedUrl && !(company && position)) {
      showError('请填写有效的招聘链接，或同时填写公司和职位名。');
      return;
    }

    setSubmitting(true);
    try {
      const payload: JobFormSubmitPayload =
        mode === 'create'
          ? {
              mode: 'create',
              jobId: boundJobId,
              input: {
                ...(normalizedUrl ? { postingUrl: normalizedUrl } : {}),
                ...(company ? { company } : {}),
                ...(position ? { position } : {}),
                ...(location ? { location } : {}),
                ...(salary ? { salary } : {}),
                ...(jobDescription ? { jobDescription } : {}),
              },
            }
          : {
              mode: 'edit',
              jobId: boundJobId,
              expectedVersion: boundExpectedVersion,
              draft: {
                url: normalizedUrl ?? '',
                company,
                position,
                location,
                salary,
                jd: jobDescription,
              },
            };
      const ok = await onSubmit(payload);
      if (ok) {
        close();
      } else {
        setSubmitting(false);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存时出现异常，请重试。');
      setSubmitting(false);
    }
  };

  closeBtn.addEventListener('click', () => !submitting && close());
  cancelBtn.addEventListener('click', () => !submitting && close());
  dialog.addEventListener('click', onBackdrop);
  dialog.addEventListener('cancel', onCancel);
  form.addEventListener('submit', (e) => {
    void handleSubmit(e);
  });

  return {
    dialog,
    openCreate(trigger) {
      mode = 'create';
      boundJobId = newId('job');
      boundExpectedVersion = 1;
      lastTrigger = trigger ?? null;
      form.reset();
      hint.hidden = false;
      titleEl.textContent = '添加岗位';
      syncModeFields();
      showError('');
      setSubmitting(false);
      if (!dialog.open) dialog.showModal();
      urlInput.focus({ preventScroll: true });
    },
    openEdit(job, trigger) {
      mode = 'edit';
      boundJobId = job.id;
      boundExpectedVersion = job.version;
      lastTrigger = trigger ?? null;
      form.reset();
      hint.hidden = true;
      titleEl.textContent = `编辑资料 · ${getJobDisplayName(job)}`;
      syncModeFields();
      urlInput.value = job.url ?? '';
      companyInput.value = job.company;
      positionInput.value = job.position;
      locationInput.value = job.location ?? '';
      salaryInput.value = job.salary ?? '';
      jdInput.value = job.jd ?? '';
      showError('');
      setSubmitting(false);
      if (!dialog.open) dialog.showModal();
      companyInput.focus({ preventScroll: true });
    },
    setSubmitting,
    showError,
    close,
    destroy() {
      dialog.removeEventListener('click', onBackdrop);
      dialog.removeEventListener('cancel', onCancel);
      dialog.remove();
    },
  };
}

export interface JobDetailDialogHandle {
  dialog: HTMLDialogElement;
  open: (job: JobCardData, trigger?: HTMLElement | null) => void;
  close: () => void;
  destroy: () => void;
}

export function createJobDetailDialog(): JobDetailDialogHandle {
  const dialog = document.createElement('dialog');
  dialog.className = 'zj-dialog zj-dialog-detail';
  dialog.setAttribute('aria-label', '岗位完整资料');

  const heading = document.createElement('div');
  heading.className = 'zj-dialog-heading';
  const titleEl = document.createElement('h2');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'zj-icon-btn';
  closeBtn.setAttribute('aria-label', '关闭详情');
  closeBtn.append(createIcon('x'));
  heading.append(titleEl, closeBtn);

  const body = document.createElement('div');
  body.className = 'zj-detail-body';

  const actions = document.createElement('div');
  actions.className = 'zj-dialog-actions';
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'zj-btn zj-btn-primary';
  doneBtn.textContent = '关闭';
  actions.append(doneBtn);

  dialog.append(heading, body, actions);

  let lastTrigger: HTMLElement | null = null;
  const close = (): void => {
    if (dialog.open) dialog.close();
    lastTrigger?.focus({ preventScroll: true });
    lastTrigger = null;
  };

  const makeDetailRow = (label: string, valueEl: HTMLElement): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'zj-detail-row';
    const dt = document.createElement('div');
    dt.className = 'zj-detail-label';
    dt.textContent = label;
    row.append(dt, valueEl);
    return row;
  };

  closeBtn.addEventListener('click', close);
  doneBtn.addEventListener('click', close);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });

  return {
    dialog,
    open(job, trigger) {
      lastTrigger = trigger ?? null;
      titleEl.textContent = getJobDisplayName(job);
      body.innerHTML = '';

      const metaGrid = document.createElement('div');
      metaGrid.className = 'zj-detail-meta-grid';

      if (job.company.trim()) {
        const p = document.createElement('div');
        p.className = 'zj-detail-value';
        p.textContent = job.company.trim();
        metaGrid.append(makeDetailRow('公司', p));
      }
      if (job.position.trim()) {
        const p = document.createElement('div');
        p.className = 'zj-detail-value';
        p.textContent = job.position.trim();
        metaGrid.append(makeDetailRow('职位', p));
      }
      const safeUrl = sanitizeHttpUrl(job.url);
      if (safeUrl) {
        const a = document.createElement('a');
        a.className = 'zj-inline-link';
        a.href = safeUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.append(
          document.createTextNode(formatUrlDisplay(safeUrl)),
          createIcon('arrow-up-right'),
        );
        metaGrid.append(makeDetailRow('招聘链接', a));
      }
      if (job.location?.trim()) {
        const p = document.createElement('div');
        p.className = 'zj-detail-value';
        p.textContent = job.location.trim();
        metaGrid.append(makeDetailRow('地点', p));
      }
      if (job.salary?.trim()) {
        const p = document.createElement('div');
        p.className = 'zj-detail-value';
        p.textContent = job.salary.trim();
        metaGrid.append(makeDetailRow('薪资', p));
      }
      if (metaGrid.children.length > 0) {
        body.append(metaGrid);
      }

      if (job.jd?.trim()) {
        const pre = document.createElement('div');
        pre.className = 'zj-detail-jd';
        pre.textContent = formatJdForDisplay(job.jd.trim());
        const jdRow = makeDetailRow('岗位描述 JD', pre);
        jdRow.classList.add('is-jd');
        body.append(jdRow);
      }

      if (!dialog.open) dialog.showModal();
      closeBtn.focus({ preventScroll: true });
    },
    close,
    destroy() {
      dialog.remove();
    },
  };
}
