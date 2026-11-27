/** 正式工作台 UI、双手机历史交互与 JobBoardStore 联调契约测试。 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  defaultBoardPreferences,
  type BoardPreferences,
  type CommandOutcome,
  type JobBoardStore,
  type JobCommand,
} from '../../src/data/contract.ts';
import {
  clearOutcome,
  createJob,
  logAppliedStep,
  logAssessmentStep,
  logInterviewStep,
  logOcStep,
  logOfferStep,
  recordOutcome,
  removeLatestStep,
  setJobStar,
  updateAssessmentStep,
  updateInterviewStep,
  updateJobProfile,
  updateOfferStep,
  type Job,
} from '../../src/domain/index.ts';
import { createDesktopJobBoard } from '../../src/ui/components/desktop-job-card.ts';
import { createMobileJobBoard } from '../../src/ui/components/mobile-job-card.ts';
import { createSettingsDialog } from '../../src/ui/components/settings-about.ts';
import { createStepFormDialog } from '../../src/ui/components/step-form-dialog.ts';
import { createDesignBaselineJobs } from '../../src/ui/demo/sample-jobs.ts';
import {
  buildDeadlineFromInputs,
  deriveUpcomingAgenda,
  formatJdForDisplay,
  formatTimeValue,
  formatUrlDisplay,
  getCompleteActionLabel,
  getContextualJobActions,
  getLatestStep,
  resolveEffectiveLayout,
  sanitizeHttpUrl,
  sortJobsByStar,
} from '../../src/ui/format.ts';
import type { JobCardData } from '../../src/ui/types.ts';
import { createJobBoardApp } from '../../src/ui/workspace/app.ts';
import {
  createScheduleNavBar,
  locateJobAndStep,
  normalizePageForDevice,
} from '../../src/ui/workspace/schedule-navigation.ts';

class MockClassList {
  private set = new Set<string>();
  constructor(private owner: MockElement) {}
  add(...names: string[]) {
    for (const n of names) if (n) this.set.add(n);
    this.sync();
  }
  remove(...names: string[]) {
    for (const n of names) this.set.delete(n);
    this.sync();
  }
  toggle(name: string, force?: boolean) {
    if (force === undefined) {
      if (this.set.has(name)) this.set.delete(name);
      else this.set.add(name);
    } else if (force) this.set.add(name);
    else this.set.delete(name);
    this.sync();
  }
  contains(name: string) {
    return this.set.has(name);
  }
  setFromString(str: string) {
    this.set = new Set(str.split(/\s+/).filter(Boolean));
  }
  private sync() {
    this.owner.attrs.set('class', [...this.set].join(' '));
  }
}

class MockNode {
  parentNode: MockElement | null = null;
  nodeType = 1;
}

class MockTextNode extends MockNode {
  override nodeType = 3;
  constructor(public textContent: string) {
    super();
  }
}

class MockElement extends MockNode {
  tagName: string;
  attrs = new Map<string, string>();
  dataset: Record<string, string> = {};
  classList: MockClassList;
  children: MockElement[] = [];
  childNodes: MockNode[] = [];
  style: Record<string, string> = {};
  listeners = new Map<string, Array<(e: unknown) => void>>();
  hidden = false;
  disabled = false;
  open = false;
  checked = false;
  value = '';
  name = '';
  type = '';
  rows = 2;
  placeholder = '';
  autocomplete = '';
  noValidate = false;
  accept = '';
  clientWidth = 360;
  scrollLeft = 0;
  offsetWidth = 250;
  offsetHeight = 240;

  constructor(tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList(this);
  }
  get className() {
    return this.attrs.get('class') ?? '';
  }
  set className(val: string) {
    this.classList.setFromString(val);
    this.attrs.set('class', val);
  }
  private _text = '';
  get textContent(): string {
    if (this.childNodes.length === 0) return this._text;
    return this.childNodes
      .map((n) =>
        n instanceof MockTextNode ? n.textContent : (n as MockElement).textContent,
      )
      .join('');
  }
  set textContent(val: string) {
    this._text = val;
    this.children = [];
    this.childNodes = val ? [new MockTextNode(val)] : [];
  }
  set innerHTML(val: string) {
    if (val === '') {
      this._text = '';
      this.children = [];
      this.childNodes = [];
    }
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
    if (name === 'class') this.classList.setFromString(value);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  append(...nodes: Array<MockNode | string>) {
    for (const node of nodes) {
      const n = typeof node === 'string' ? new MockTextNode(node) : node;
      n.parentNode = this;
      this.childNodes.push(n);
      if (n instanceof MockElement) this.children.push(n);
    }
  }
  appendChild(node: MockNode) {
    this.append(node);
    return node;
  }
  replaceChildren(...nodes: Array<MockNode | string>) {
    this.children = [];
    this.childNodes = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode.childNodes = this.parentNode.childNodes.filter(
        (c) => c !== this,
      );
      this.parentNode = null;
    }
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    const arr = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      arr.filter((f) => f !== fn),
    );
  }
  dispatch(type: string, extra: Record<string, unknown> = {}) {
    const ev = {
      target: this,
      currentTarget: this,
      stopPropagation() {},
      preventDefault() {},
      ...extra,
    };
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  click() {
    this.dispatch('click');
  }
  focus() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  reset() {
    for (const el of this.querySelectorAll<MockElement>('input, textarea, select')) {
      if (el.tagName === 'SELECT') el.value = el.children[0]?.value ?? '';
      else el.value = '';
    }
  }
  scrollIntoView() {}
  scrollTo(opts: { left: number }) {
    this.scrollLeft = opts.left;
    this.dispatch('scroll');
  }
  getBoundingClientRect() {
    return { top: 100, bottom: 136, left: 600, right: 700, width: 100, height: 36 };
  }
  get isConnected() {
    return true;
  }
  private matchesSimple(sel: string): boolean {
    const attrMatches = [...sel.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const stripped = sel.replace(/\[[^\]]+\]/g, '');
    const dotIdx = stripped.indexOf('.');
    const tagPart = dotIdx === -1 ? stripped : stripped.slice(0, dotIdx);
    const classParts =
      dotIdx === -1 ? [] : stripped.slice(dotIdx + 1).split('.').filter(Boolean);
    if (tagPart && this.tagName !== tagPart.toUpperCase()) return false;
    for (const cls of classParts) if (!this.classList.contains(cls)) return false;
    for (const [, key, val] of attrMatches) {
      if (key!.startsWith('data-')) {
        const camel = key!
          .slice(5)
          .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        const actual = this.dataset[camel];
        if (val === undefined ? actual === undefined : actual !== val) return false;
      } else {
        const actual =
          this.attrs.get(key!) ?? (key === 'name' ? this.name : undefined);
        if (val === undefined ? actual === undefined : actual !== val) return false;
      }
    }
    return true;
  }
  private matchesSelector(sel: string): boolean {
    const parts = sel.trim().split(/\s+/);
    if (parts.length === 1) return this.matchesSimple(parts[0]!);
    const last = parts[parts.length - 1]!;
    if (!this.matchesSimple(last)) return false;
    let cur = this.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (cur && !cur.matchesSimple(parts[i]!)) cur = cur.parentNode;
      if (!cur) return false;
      cur = cur.parentNode;
    }
    return true;
  }
  querySelectorAll<T = MockElement>(sel: string): T[] {
    const out: T[] = [];
    const walk = (el: MockElement) => {
      for (const child of el.children) {
        if (child.matchesSelector(sel)) out.push(child as unknown as T);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector<T = MockElement>(sel: string): T | null {
    return this.querySelectorAll<T>(sel)[0] ?? null;
  }
  closest<T = MockElement>(sel: string): T | null {
    let cur: MockElement | null = this;
    while (cur) {
      if (cur.matchesSelector(sel)) return cur as unknown as T;
      cur = cur.parentNode;
    }
    return null;
  }
}

function installDomGlobals(): void {
  const doc = new MockElement('document') as unknown as Record<string, unknown>;
  doc.createElement = (tag: string) => new MockElement(tag);
  doc.createElementNS = (_ns: string, tag: string) => new MockElement(tag);
  doc.createTextNode = (text: string) => new MockTextNode(text);
  doc.body = new MockElement('body');

  Object.assign(globalThis, {
    document: doc,
    HTMLButtonElement: MockElement,
    window: {
      innerWidth: 1280,
      innerHeight: 800,
      addEventListener() {},
      removeEventListener() {},
      matchMedia: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }),
    },
    CSS: { escape: (s: string) => s },
  });
}

function createMemoryDomainStore(): {
  store: JobBoardStore;
  commands: JobCommand[];
  prefPatches: unknown[];
  setForceUnconfirmedOnce: () => void;
  injectExternalStep: (jobId: string, round: string) => void;
} {
  let jobs: Job[] = [];
  let prefs: BoardPreferences = defaultBoardPreferences();
  const commands: JobCommand[] = [];
  const prefPatches: unknown[] = [];
  let forceUnconfirmed = false;

  const store: JobBoardStore = {
    mode: 'sites',
    async listJobs() {
      return { ok: true, value: jobs };
    },
    async getJob(jobId) {
      return { ok: true, value: jobs.find((j) => j.id === jobId) ?? null };
    },
    async submitJobCommand(cmd): Promise<CommandOutcome> {
      commands.push(cmd);
      if (forceUnconfirmed) {
        forceUnconfirmed = false;
        return { status: 'unconfirmed' };
      }
      if (cmd.kind === 'create-job') {
        const res = createJob(cmd.input, { generateId: () => cmd.jobId });
        if (!res.ok) return { status: 'rejected', failure: res.failure };
        jobs = [...jobs, res.job];
        return { status: 'confirmed', job: res.job };
      }
      const existing = jobs.find((j) => j.id === cmd.jobId);
      if (!existing) {
        return {
          status: 'rejected',
          failure: { reason: 'invalidInput', message: '岗位不存在' },
        };
      }
      let res;
      switch (cmd.kind) {
        case 'update-profile':
          res = updateJobProfile(existing, cmd.expectedVersion, cmd.patch);
          break;
        case 'set-star':
          res = setJobStar(existing, cmd.expectedVersion, cmd.starred);
          break;
        case 'log-step': {
          const opt = { generateId: () => cmd.nodeId };
          if (cmd.step.kind === 'applied')
            res = logAppliedStep(existing, cmd.expectedVersion, opt);
          else if (cmd.step.kind === 'assessment')
            res = logAssessmentStep(
              existing,
              cmd.expectedVersion,
              { deadline: cmd.step.deadline },
              opt,
            );
          else if (cmd.step.kind === 'interview')
            res = logInterviewStep(
              existing,
              cmd.expectedVersion,
              { round: cmd.step.round, scheduledAt: cmd.step.scheduledAt },
              opt,
            );
          else if (cmd.step.kind === 'oc')
            res = logOcStep(existing, cmd.expectedVersion, opt);
          else
            res = logOfferStep(
              existing,
              cmd.expectedVersion,
              { replyDeadline: cmd.step.replyDeadline },
              opt,
            );
          break;
        }
        case 'update-step':
          if (cmd.payload.targetKind === 'assessment')
            res = updateAssessmentStep(
              existing,
              cmd.expectedVersion,
              cmd.nodeId,
              cmd.payload.patch,
            );
          else if (cmd.payload.targetKind === 'interview')
            res = updateInterviewStep(
              existing,
              cmd.expectedVersion,
              cmd.nodeId,
              cmd.payload.patch,
            );
          else
            res = updateOfferStep(
              existing,
              cmd.expectedVersion,
              cmd.nodeId,
              cmd.payload.patch,
            );
          break;
        case 'remove-latest-step':
          res = removeLatestStep(
            existing,
            cmd.expectedVersion,
            cmd.expectedLastNodeId,
          );
          break;
        case 'record-outcome':
          res = recordOutcome(existing, cmd.expectedVersion, cmd.status);
          break;
        case 'clear-outcome':
          res = clearOutcome(existing, cmd.expectedVersion);
          break;
      }
      if (!res.ok) return { status: 'rejected', failure: res.failure };
      jobs = jobs.map((j) => (j.id === res.job.id ? res.job : j));
      return { status: 'confirmed', job: res.job };
    },
    async getPreferences() {
      return { ok: true, value: prefs };
    },
    async savePreferences(patch) {
      prefPatches.push(patch);
      prefs = {
        shared: patch.shared ?? prefs.shared,
        mobile: patch.mobile ?? prefs.mobile,
        desktop: patch.desktop ?? prefs.desktop,
      };
      return { status: 'confirmed', preferences: prefs };
    },
    async exportSnapshot() {
      return {
        ok: true,
        backup: {
          format: BACKUP_FORMAT,
          version: BACKUP_VERSION,
          applications: jobs,
          preferences: prefs,
        },
      };
    },
    async importBackup() {
      if (jobs.length > 0) {
        return {
          status: 'rejected',
          reason: 'targetNotEmpty',
          message: '目标已有岗位，拒绝导入',
        };
      }
      return { status: 'confirmed' };
    },
  };

  return {
    store,
    commands,
    prefPatches,
    setForceUnconfirmedOnce: () => {
      forceUnconfirmed = true;
    },
    injectExternalStep: (jobId, round) => {
      const target = jobs.find((j) => j.id === jobId)!;
      const res = logInterviewStep(target, target.version, { round });
      assert.equal(res.ok, true);
      if (res.ok) jobs = jobs.map((j) => (j.id === jobId ? res.job : j));
    },
  };
}

describe('前端格式、安全校验与期限精度', () => {
  it('仅允许 http/https 外链并保留日期或时刻精度', () => {
    assert.equal(
      sanitizeHttpUrl('https://jobs.example.com/p/42'),
      'https://jobs.example.com/p/42',
    );
    assert.equal(sanitizeHttpUrl('javascript:alert(1)'), null);
    assert.equal(sanitizeHttpUrl('data:text/html,hi'), null);
    assert.equal(formatUrlDisplay('https://jobs.example.com/p/42'), 'jobs.example.com/p/42');

    const dateOnly = buildDeadlineFromInputs('2026-12-05', '');
    assert.equal(dateOnly.ok, true);
    if (dateOnly.ok) {
      assert.deepEqual(dateOnly.value, { precision: 'date', date: '2026-12-05' });
      assert.equal(formatTimeValue(dateOnly.value), '12月5日 周六');
    }

    const dt = buildDeadlineFromInputs('2026-11-27', '15:00');
    assert.equal(dt.ok, true);
    if (dt.ok) {
      assert.equal(dt.value?.precision, 'datetime');
      assert.equal(dt.value?.date, '2026-11-27');
      assert.equal(dt.value?.time, '15:00');
    }

    assert.equal(buildDeadlineFromInputs('', '15:00').ok, false);
  });

  it('近期安排随结果排除与恢复，布局覆盖互不干扰', () => {
    const sample: JobCardData[] = [
      {
        id: 'j1',
        version: 1,
        company: '青禾科技',
        position: '后端',
        starred: true,
        result: null,
        steps: [
          {
            id: 's1',
            kind: 'interview',
            roundLabel: '二面',
            status: 'pending',
            scheduledAt: { precision: 'datetime', date: '2026-11-27', time: '15:00' },
          },
        ],
      },
      {
        id: 'j2',
        version: 1,
        company: '拾光数据',
        position: '数仓',
        starred: false,
        result: 'declined',
        steps: [
          {
            id: 's2',
            kind: 'written_offer',
            deadline: { precision: 'date', date: '2026-12-05' },
          },
        ],
      },
    ];
    assert.equal(deriveUpcomingAgenda(sample).length, 1);
    assert.equal(
      deriveUpcomingAgenda([sample[0]!, { ...sample[1]!, result: null }]).length,
      2,
    );

    const prefs: BoardPreferences = {
      shared: {
        modules: [
          { id: 'jobs', visible: true },
          { id: 'schedule', visible: true },
        ],
      },
      mobile: {
        overridden: true,
        layout: {
          modules: [
            { id: 'schedule', visible: true },
            { id: 'jobs', visible: true },
          ],
        },
      },
      desktop: { overridden: false },
    };
    assert.equal(resolveEffectiveLayout(prefs, 'mobile').isOverride, true);
    assert.equal(resolveEffectiveLayout(prefs, 'mobile').layout.modules[0]!.id, 'schedule');
    assert.equal(resolveEffectiveLayout(prefs, 'desktop').isOverride, false);
    assert.equal(resolveEffectiveLayout(prefs, 'desktop').layout.modules[0]!.id, 'jobs');
  });
});

describe('桌面卡与手机双候选交互（1.1、1.2、3.1）', () => {
  it('空板展示添加岗位，手机回看一面时更新动作仍指向二面', () => {
    installDomGlobals();
    const baseline = createDesignBaselineJobs();
    const sorted = sortJobsByStar([...baseline].reverse());
    assert.equal(sorted[0]!.id, 'qinghe');
    assert.equal(getCompleteActionLabel(getLatestStep(baseline[0]!)), '标记二面已面');

    const completedCalls: Array<{ jobId: string; stepId: string }> = [];
    const desktopEmpty = createDesktopJobBoard({
      jobs: [],
      callbacks: { onRequestAddJob() {} },
    });
    assert.ok((desktopEmpty.element as unknown as MockElement).querySelector('.zj-empty-board'));

    const swipeBoard = createMobileJobBoard({
      mode: 'swipe',
      jobs: baseline,
      callbacks: {
        onCompleteCurrentStep(job, step) {
          completedCalls.push({ jobId: job.id, stepId: step.id });
        },
      },
    });
    assert.equal(swipeBoard.getViewingStepIndex('qinghe'), 2);
    swipeBoard.setViewingStepIndex('qinghe', 1);
    assert.equal(swipeBoard.getViewingStepIndex('qinghe'), 1);

    const swipeEl = swipeBoard.element as unknown as MockElement;
    const card = swipeEl.querySelector('[data-job-id="qinghe"]')!;
    const completeBtn = card.querySelector('[data-action="complete-interview"]')!;
    assert.equal(completeBtn.dataset.targetStepId, 'qinghe-s3');
    completeBtn.click();
    assert.deepEqual(completedCalls, [{ jobId: 'qinghe', stepId: 'qinghe-s3' }]);

    const settings = createSettingsDialog();
    assert.ok((settings.dialog as unknown as MockElement).textContent.includes('MiSans'));
  });
});

describe('正式工作台接入真实 JobBoardStore（1.3–4.4）', () => {
  it('建档重送复用 jobId，表单绑定打开时版本，刷新保留冲突提示，偏好分范围提交', async () => {
    installDomGlobals();
    const mem = createMemoryDomainStore();
    const container = new MockElement('div') as unknown as HTMLElement;
    const app = createJobBoardApp({
      container,
      store: mem.store,
      forceDevice: 'mobile',
    });
    await new Promise((r) => setTimeout(r, 20));
    const root = container as unknown as MockElement;

    assert.equal(app.getJobs().length, 0);
    assert.ok(root.querySelector('.zj-empty-board'));
    assert.equal(root.querySelector('.zj-app-topbar [data-action="add-job"]'), null);
    assert.equal(root.querySelector('.zj-app-topbar [data-action="top-add-job"]'), null);
    const headingAddBtn = root.querySelector('.zj-jobs-section .zj-section-heading [data-action="add-job"]');
    assert.ok(headingAddBtn);
    assert.ok(headingAddBtn.textContent.includes('添加岗位'));

    // 1) 从「岗位进展」标题行右侧打开建档弹窗并提交；unconfirmed 后重送复用同 jobId
    headingAddBtn.click();
    const jobForm = root.querySelector('dialog')!.querySelector('form')!;
    jobForm.querySelector<MockElement>('[name="url"]')!.value =
      'https://jobs.example.com/p/42';
    jobForm.querySelector<MockElement>('[name="location"]')!.value = '上海';
    jobForm.querySelector<MockElement>('[name="salary"]')!.value = '300 元/天';
    jobForm.querySelector<MockElement>('[name="jd"]')!.value = '熟悉 TypeScript';
    mem.setForceUnconfirmedOnce();
    jobForm.dispatch('submit');
    await new Promise((r) => setTimeout(r, 20));

    const banner = root.querySelector('.zj-feedback-banner')!;
    assert.equal(banner.dataset.tone, 'unknown');
    assert.ok(banner.textContent.includes('未确认是否保存，请刷新查看'));
    const firstCmd = mem.commands[0]!;
    assert.equal(firstCmd.kind, 'create-job');

    jobForm.dispatch('submit');
    await new Promise((r) => setTimeout(r, 20));
    const secondCmd = mem.commands[1]!;
    assert.equal(secondCmd.kind, 'create-job');
    assert.equal(secondCmd.jobId, firstCmd.jobId);
    assert.equal(mem.commands.length, 2, 'Create must submit a single atomic create-job without follow-up update-profile');
    assert.equal(app.getJobs().length, 1);
    assert.equal(app.getJobs()[0]!.location, '上海');
    assert.equal(app.getJobs()[0]!.salary, '300 元/天');
    assert.equal(app.getJobs()[0]!.jd, '熟悉 TypeScript');

    // 2) 打开编辑资料绑定 expectedVersion=1，外部写入升级到 2 后提交必须带 1 并触发冲突
    root.querySelector('[data-action="edit-details"]')!.click();
    mem.injectExternalStep(firstCmd.jobId, '二面');
    jobForm.querySelector<MockElement>('[name="company"]')!.value = '青禾科技';
    jobForm.querySelector<MockElement>('[name="position"]')!.value = '后端实习生';
    jobForm.dispatch('submit');
    await new Promise((r) => setTimeout(r, 20));

    const updateCmd = mem.commands.at(-1)!;
    assert.equal(updateCmd.kind, 'update-profile');
    if (updateCmd.kind === 'update-profile') {
      assert.equal(updateCmd.expectedVersion, 1);
    }
    assert.equal(banner.dataset.tone, 'conflict');

    // 3) 主动刷新重读版本 2 数据，同时保留未解决的冲突提示
    banner.querySelector('[data-action="refresh-from-banner"]')!.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(app.getJobs()[0]!.version, 2);
    assert.equal(app.getJobs()[0]!.steps.length, 1);
    assert.equal(banner.hidden, false);
    assert.equal(banner.dataset.tone, 'conflict');

    // 4) 偏好修改手机覆盖时只写 { mobile } 范围
    root.querySelector('[data-action="open-settings"]')!.click();
    root.querySelector('[data-scope="mobile"]')!.click();
    root.querySelector('.zj-module-row[data-module-id="jobs"] button')!.click();
    await new Promise((r) => setTimeout(r, 20));
    const patch = mem.prefPatches.at(-1) as Record<string, unknown>;
    assert.deepEqual(Object.keys(patch), ['mobile']);

    // 5) 隐藏「岗位进展」模块时无添加入口，重新显示后恢复于标题行右侧
    const jobsToggle = root.querySelector<MockElement>('.zj-module-row[data-module-id="jobs"] input')!;
    jobsToggle.checked = false;
    jobsToggle.dispatch('change');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.querySelector('[data-action="add-job"]'), null);
    jobsToggle.checked = true;
    jobsToggle.dispatch('change');
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(root.querySelector('.zj-jobs-section .zj-section-heading [data-action="add-job"]'));
  });
});

describe('JD 只读排版解折与结构保留', () => {
  const bytedanceSeedJd = [
    '团队介绍：产品研发和工程架构-Seed 团队深耕大',
    '模型技术在场景中的创新应用，负责多款AI产品的工',
    '程研发——包括豆包、飞书、豆包工作、豆包爱学、',
    'Gauth、猫箱等创新产品，覆盖消费级与企业级多个',
    '场景。我们致力于将大模型能力从“生成内容”推进',
    '到“完成工作”，让AI服务用户日常与企业协作。你',
    '将面对多模态交互、工具调用可靠性、企业级数据安',
    '全等真实工程挑战，与团队一起推动AI生产力落',
    '地。',
    '日常实习：面向全体在校生，为符合岗位要求的同学',
    '提供为期3个月及以上的项目实践机会。',
    '1、负责协助Seed产品研发技术运营团队做AI工具开',
    '发，进行提效建设；',
    '2、调研前沿AI理论，实施经验，推进AI能力在技术支',
    '持团队有效落地；',
    '3、参与AI和其他团队工具的开发和维护工作；',
    '4、协助团队其他成员，共同做好技术支持工作，处',
    '理技术问题；',
    '5、配合商业化团队，为内外部客户提供专业的技术',
    '解决方案；',
    '6、从数据层面总结提炼用户问题中的信息，与产品',
    '研发团队协同合作，持续优化产品能力。',
    '职位要求',
    '1、本科及以上学历在读，计算机及相关专业优先；',
  ].join('\n');

  it('解折窄栏复制的中文 JD 硬换行，同时保留带前缀段落、标题与编号列表边界', () => {
    const formatted = formatJdForDisplay(bytedanceSeedJd);
    assert.deepEqual(formatted.split('\n'), [
      '团队介绍：产品研发和工程架构-Seed 团队深耕大模型技术在场景中的创新应用，负责多款AI产品的工程研发——包括豆包、飞书、豆包工作、豆包爱学、Gauth、猫箱等创新产品，覆盖消费级与企业级多个场景。我们致力于将大模型能力从“生成内容”推进到“完成工作”，让AI服务用户日常与企业协作。你将面对多模态交互、工具调用可靠性、企业级数据安全等真实工程挑战，与团队一起推动AI生产力落地。',
      '日常实习：面向全体在校生，为符合岗位要求的同学提供为期3个月及以上的项目实践机会。',
      '1、负责协助Seed产品研发技术运营团队做AI工具开发，进行提效建设；',
      '2、调研前沿AI理论，实施经验，推进AI能力在技术支持团队有效落地；',
      '3、参与AI和其他团队工具的开发和维护工作；',
      '4、协助团队其他成员，共同做好技术支持工作，处理技术问题；',
      '5、配合商业化团队，为内外部客户提供专业的技术解决方案；',
      '6、从数据层面总结提炼用户问题中的信息，与产品研发团队协同合作，持续优化产品能力。',
      '职位要求',
      '1、本科及以上学历在读，计算机及相关专业优先；',
    ]);
  });

  it('保留英文硬换行词间空格、列表与显式空行分隔', () => {
    const englishJd = [
      'About the Role',
      'We are building low-latency distributed',
      'systems for real-time inference at global',
      'scale with strong reliability.',
      '',
      'Requirements',
      '- Experience with TypeScript, Node.js, and',
      'browser performance profiling.',
      '- Familiarity with SQLite and web storage',
      'APIs.',
    ].join('\n');

    assert.deepEqual(formatJdForDisplay(englishJd).split('\n'), [
      'About the Role',
      'We are building low-latency distributed systems for real-time inference at global scale with strong reliability.',
      '',
      'Requirements',
      '- Experience with TypeScript, Node.js, and browser performance profiling.',
      '- Familiarity with SQLite and web storage APIs.',
    ]);
  });

  it('不破坏普通短行手写或未硬换行的 JD 原有分行', () => {
    const plainShortJd = [
      '负责核心后台服务设计与开发。',
      '参与高并发链路性能优化。',
      '1. 熟悉 Go 或 Java 后端开发',
      '2. 熟悉 MySQL、Redis 常见调优',
      '3. 具备良好的团队协作与沟通能力',
    ].join('\n');

    assert.equal(formatJdForDisplay(plainShortJd), plainShortJd);

    const equalWidthBullets = [
      '• 负责广告检索与排序引擎核心模块开发；',
      '• 参与离线训练特征与在线推理链路优化；',
      '• 持续提升大规模分布式系统稳定性与吞吐。',
    ].join('\n');
    assert.equal(formatJdForDisplay(equalWidthBullets), equalWidthBullets);

    const unequalMediumLines = [
      '负责核心推荐算法工程落地与服务高可用治理',
      '熟悉分布式缓存、消息队列与微服务监控体系建设以及线下离线评估流水线开发工作',
    ].join('\n');
    assert.equal(formatJdForDisplay(unequalMediumLines), unequalMediumLines);
  });
});

describe('轻卡片动作、更多菜单分组、表单与导航定位契约', () => {
  it('生成明确动作与预测下阶段，清理常驻提示并仅在低辨识岗位突出补资料', () => {
    installDomGlobals();
    const baseline = createDesignBaselineJobs();
    const qinghe = baseline[0]!;
    const linkOnly = baseline[3]!;

    assert.deepEqual(
      getContextualJobActions(qinghe).map((a) => a.label),
      ['标记二面已面'],
    );

    const afterInterviewJob: JobCardData = {
      ...qinghe,
      steps: [
        ...qinghe.steps.slice(0, 2),
        { ...qinghe.steps[2]!, kind: 'interview', roundLabel: '二面', status: 'completed' },
      ],
    };
    assert.deepEqual(
      getContextualJobActions(afterInterviewJob).map((a) => ({ label: a.label, primary: a.primary })),
      [
        { label: '收到下轮面试', primary: true },
        { label: '收到 OC', primary: false },
      ],
    );

    const pendingAssess: JobCardData = {
      id: 'a1',
      version: 1,
      company: '星辰',
      position: '前端',
      starred: false,
      result: null,
      steps: [{ id: 's1', kind: 'assessment', completed: false }],
    };
    assert.deepEqual(
      getContextualJobActions(pendingAssess).map((a) => a.label),
      ['标记笔试已完成'],
    );

    const offerNoDeadline: JobCardData = {
      id: 'o1',
      version: 1,
      company: '拾光数据',
      position: '数据工程',
      starred: false,
      result: null,
      steps: [{ id: 'os1', kind: 'written_offer' }],
    };
    assert.deepEqual(
      getContextualJobActions(offerNoDeadline).map((a) => ({ kind: a.kind, label: a.label })),
      [{ kind: 'edit-step', label: '添加答复期限' }],
    );

    const board = createDesktopJobBoard({
      jobs: [qinghe, linkOnly, offerNoDeadline],
      callbacks: {
        onRequestEditDetails() {},
        onRequestAddStep() {},
        onRequestEditStep() {},
        onRemoveLatestStep() {},
        onSetResult() {},
      },
    });
    const el = board.element as unknown as MockElement;
    const qingheCard = el.querySelector('[data-job-id="qinghe"]')!;
    const linkCard = el.querySelector('[data-job-id="link-42"]')!;
    const offerCard = el.querySelector('[data-job-id="o1"]')!;

    assert.equal(qingheCard.querySelector('[data-action="edit-details"]'), null);
    assert.ok(linkCard.querySelector('[data-action="edit-details"].is-supplement-highlight'));
    assert.equal(offerCard.querySelector('.zj-action-hint'), null);
    assert.ok(offerCard.querySelector('[data-action="add-offer-deadline"]'));

    const moreBtn = qingheCard.querySelector('[data-action="open-more-menu"]')!;
    moreBtn.click();
    const menu = el.querySelector('.zj-menu-popover')!;
    assert.ok(menu);
    assert.ok(menu.textContent.includes('进展与节点'));
    assert.ok(menu.textContent.includes('岗位资料'));
    assert.ok(menu.textContent.includes('申请结果'));
    assert.ok(menu.querySelector('[data-action="other-progress"]'));
    assert.ok(menu.querySelector('[data-action="edit-current-step"]'));
    assert.ok(menu.querySelector('[data-action="remove-latest-step"]'));
    assert.ok(menu.querySelector('[data-action="menu-edit-details"]'));
    assert.ok(menu.querySelector('[data-action="set-result-rejected"]'));
    assert.ok(menu.querySelector('[data-action="set-result-declined"]'));
  });

  it('日期时间表单保持简洁对齐标签，工作台移除私有站点角标且导航定位来源节点', async () => {
    installDomGlobals();
    const stepDialog = createStepFormDialog(() => true);
    const dialogEl = stepDialog.dialog as unknown as MockElement;
    assert.ok(dialogEl.textContent.includes('日期（可选）'));
    assert.ok(dialogEl.textContent.includes('时间（可选）'));
    assert.equal(dialogEl.textContent.includes('具体时刻（留空则只保留日期）'), false);

    assert.equal(normalizePageForDevice('calendar', 'desktop'), 'board');
    assert.equal(normalizePageForDevice('calendar', 'desktop', false), 'calendar');
    assert.equal(normalizePageForDevice('calendar', 'mobile'), 'calendar');

    const desktopNav = createScheduleNavBar({
      device: 'desktop',
      activePage: 'board',
      onSelectPage() {},
    });
    const desktopTabs = (desktopNav.element as unknown as MockElement).querySelectorAll('[data-action="switch-view"]');
    assert.deepEqual(
      desktopTabs.map((b) => b.dataset.page),
      ['board', 'timeline'],
    );

    const mediumDesktopNav = createScheduleNavBar({
      device: 'desktop',
      inlineCalendar: false,
      activePage: 'calendar',
      onSelectPage() {},
    });
    const mediumDesktopTabs = (mediumDesktopNav.element as unknown as MockElement).querySelectorAll('[data-action="switch-view"]');
    assert.deepEqual(
      mediumDesktopTabs.map((b) => b.dataset.page),
      ['board', 'calendar', 'timeline'],
    );

    const mobileNav = createScheduleNavBar({
      device: 'mobile',
      activePage: 'calendar',
      onSelectPage() {},
    });
    const mobileTabs = (mobileNav.element as unknown as MockElement).querySelectorAll('[data-action="switch-view"]');
    assert.deepEqual(
      mobileTabs.map((b) => b.dataset.page),
      ['board', 'calendar', 'timeline'],
    );

    const baseline = createDesignBaselineJobs();
    const desktop = createDesktopJobBoard({ jobs: baseline });
    const timerRef = { timer: null as ReturnType<typeof setTimeout> | null };
    const found = locateJobAndStep(desktop.element, 'qinghe', 'qinghe-s3', timerRef);
    assert.equal(found, true);
    const desktopEl = desktop.element as unknown as MockElement;
    assert.equal(desktopEl.querySelector('[data-job-id="qinghe"]')?.dataset.located, 'true');
    assert.equal(desktopEl.querySelector('[data-step-id="qinghe-s3"]')?.dataset.located, 'true');
    if (timerRef.timer) clearTimeout(timerRef.timer);

    const mem = createMemoryDomainStore();
    const container = new MockElement('div') as unknown as HTMLElement;
    const app = createJobBoardApp({ container, store: mem.store, forceDevice: 'mobile' });
    await new Promise((r) => setTimeout(r, 20));
    const root = container as unknown as MockElement;
    assert.equal(root.querySelector('.zj-app-adapter-tag'), null);
    assert.equal(root.querySelector('.zj-app-topbar [data-action="add-job"]'), null);
    assert.ok(root.querySelector('.zj-jobs-section .zj-section-heading [data-action="add-job"]'));
    assert.equal(app.getActivePage(), 'board');
    app.setActivePage('calendar');
    assert.equal(app.getActivePage(), 'calendar');
    assert.equal(root.querySelector('[data-action="add-job"]'), null);
    app.setActivePage('timeline');
    assert.equal(app.getActivePage(), 'timeline');
    assert.equal(root.querySelector('[data-action="add-job"]'), null);
    app.destroy();
  });
});
