/**
 * 扎口Job · view-job-schedule 十场景虚构样例数据集（与真实存储完全隔离）。
 *
 * 固定样例基准日期为 2026-11-27（周五），对应 view-job-schedule/design.md 列出之十种场景。
 * 全部分配虚构公司与职位名称，不含任何私人数据。
 */
import {
  createJob,
  orderJobList,
  recordOutcome,
  setJobStar,
  updateAssessmentStep,
  updateInterviewStep,
  type Deadline,
  type Job,
  type JobActionResult,
  type OutcomeStatus,
  type TimeZoneName,
} from '../../domain/index.ts';
import { dispatchCreateJobCommand, dispatchJobCommand } from '../../data/commands.ts';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  defaultBoardPreferences,
  type BoardPreferences,
  type CommandOutcome,
  type JobBoardStore,
  type LogStepPayload,
} from '../../data/contract.ts';

export const SCHEDULE_DEMO_TODAY = '2026-11-27';

export function createDemoTodayDate(): Date {
  return new Date(2026, 10, 27, 12, 0, 0);
}

const TZ: TimeZoneName = 'Asia/Shanghai';

export type ScheduleScenarioId =
  | 'dense-month'
  | 'sparse'
  | 'same-day-multi'
  | 'same-job-same-day'
  | 'overdue'
  | 'cross-month-offer'
  | 'date-only'
  | 'undated'
  | 'ended-restore'
  | 'empty';

export interface ScheduleScenarioDef {
  readonly id: ScheduleScenarioId;
  readonly label: string;
  readonly createJobs: () => Job[];
}

function dt(date: string, time: string): Deadline {
  return { precision: 'datetime', date, time, timeZone: TZ };
}

function dOnly(date: string): Deadline {
  // 只含日期的期限不带时区字段：日期精度保持 date，无时刻可言。
  return { precision: 'date', date };
}

interface SpecStepApplied {
  readonly kind: 'applied';
}

interface SpecStepAssessment {
  readonly kind: 'assessment';
  readonly deadline?: Deadline;
  readonly completed?: boolean;
}

interface SpecStepInterview {
  readonly kind: 'interview';
  readonly round: string;
  readonly status?: 'pending' | 'done';
  readonly scheduledAt?: Deadline;
}

interface SpecStepOc {
  readonly kind: 'oc';
}

interface SpecStepOffer {
  readonly kind: 'offer';
  readonly replyDeadline?: Deadline;
}

type SpecStep =
  | SpecStepApplied
  | SpecStepAssessment
  | SpecStepInterview
  | SpecStepOc
  | SpecStepOffer;

interface JobFixtureSpec {
  readonly id: string;
  readonly company: string;
  readonly position: string;
  readonly location?: string;
  readonly salary?: string;
  readonly postingUrl?: string;
  readonly jobDescription?: string;
  readonly starred?: boolean;
  readonly outcome?: OutcomeStatus | null;
  readonly steps: readonly SpecStep[];
}

function mustOk(res: JobActionResult, ctx: string): Job {
  if (!res.ok) {
    // 失败分支按 reason 给出可读信息：versionConflict/lastNodeMismatch 等
    // 结构化原因没有 message，样例初始化阶段不应触发，直接落上下文说明。
    const detail =
      'message' in res.failure ? res.failure.message : `领域拒绝：${res.failure.reason}`;
    throw new Error(`样例初始化失败 (${ctx}): ${detail}`);
  }
  return res.job;
}

function buildDomainJob(spec: JobFixtureSpec): Job {
  let seq = 0;
  const nextNodeId = () => `${spec.id}-n${++seq}`;
  let job = mustOk(
    createJob(
      {
        company: spec.company,
        position: spec.position,
        location: spec.location,
        salary: spec.salary,
        postingUrl: spec.postingUrl,
        jobDescription: spec.jobDescription,
      },
      { generateId: () => spec.id },
    ),
    spec.id,
  );

  if (spec.starred) {
    job = mustOk(setJobStar(job, job.version, true), `${spec.id}:star`);
  }

  for (const step of spec.steps) {
    // 登记环节统一经数据层分发函数执行（与真实存储同一条命令路径）。
    const payload: LogStepPayload = step;
    job = mustOk(
      dispatchJobCommand(job, {
        kind: 'log-step',
        jobId: spec.id,
        expectedVersion: job.version,
        nodeId: nextNodeId(),
        step: payload,
      }),
      `${spec.id}:${step.kind}`,
    );
    if (step.kind === 'assessment') {
      if (step.completed) {
        const lastId = job.flow[job.flow.length - 1]!.id;
        job = mustOk(
          updateAssessmentStep(job, job.version, lastId, { completed: true }),
          `${spec.id}:assessment-done`,
        );
      }
    } else if (step.kind === 'interview') {
      if (step.status === 'done') {
        const lastId = job.flow[job.flow.length - 1]!.id;
        job = mustOk(
          updateInterviewStep(job, job.version, lastId, { status: 'done' }),
          `${spec.id}:interview-done`,
        );
      }
    }
  }

  if (spec.outcome) {
    job = mustOk(
      recordOutcome(job, job.version, spec.outcome),
      `${spec.id}:outcome`,
    );
  }

  return job;
}

function buildJobs(specs: readonly JobFixtureSpec[]): Job[] {
  return orderJobList(specs.map(buildDomainJob));
}

function createSparseJobs(): Job[] {
  return buildJobs([
    {
      id: 'sparse-yunzhou',
      company: '云舟智算',
      position: '后端研发工程师',
      location: '杭州',
      starred: true,
      steps: [
        { kind: 'applied' },
        { kind: 'assessment', deadline: dOnly('2026-11-25'), completed: true },
        { kind: 'interview', round: '一面', status: 'pending', scheduledAt: dt('2026-11-30', '14:00') },
      ],
    },
    {
      id: 'sparse-xingchen',
      company: '星尘数据',
      position: '数据平台工程师',
      location: '上海',
      steps: [
        { kind: 'applied' },
        { kind: 'interview', round: '一面', status: 'pending', scheduledAt: dt('2026-12-02', '10:30') },
      ],
    },
    {
      id: 'sparse-qinghe',
      company: '青禾科技',
      position: '基础架构实习生',
      location: '北京',
      steps: [{ kind: 'applied' }],
    },
  ]);
}

function createSameDayMultiJobs(): Job[] {
  return buildJobs([
    {
      id: 'sdm-xinghe',
      company: '星河科技',
      position: 'Go 服务开发工程师',
      location: '北京',
      starred: true,
      steps: [
        { kind: 'applied' },
        { kind: 'interview', round: '一面', status: 'pending', scheduledAt: dt('2026-11-27', '10:00') },
      ],
    },
    {
      id: 'sdm-yuanhang',
      company: '远航数据',
      position: '实时计算研发',
      location: '上海',
      steps: [
        { kind: 'interview', round: '二面', status: 'pending', scheduledAt: dt('2026-11-27', '14:30') },
      ],
    },
    {
      id: 'sdm-chenxi',
      company: '晨曦网络',
      position: '全栈研发工程师',
      location: '深圳',
      steps: [
        { kind: 'assessment', deadline: dt('2026-11-27', '20:00') },
      ],
    },
    {
      id: 'sdm-jiguang',
      company: '极光互动',
      position: '系统研发工程师',
      location: '广州',
      steps: [
        { kind: 'oc' },
        { kind: 'offer', replyDeadline: dOnly('2026-11-27') },
      ],
    },
    {
      id: 'sdm-haoyue',
      company: '皓月软件',
      position: '云原生工程师',
      location: '杭州',
      steps: [
        { kind: 'interview', round: '一面', status: 'pending', scheduledAt: dt('2026-11-28', '15:00') },
      ],
    },
  ]);
}

function createSameJobSameDayJobs(): Job[] {
  return buildJobs([
    {
      id: 'sjsd-qiming',
      company: '启明星云',
      position: '分布式存储工程师',
      location: '北京',
      starred: true,
      steps: [
        { kind: 'applied' },
        { kind: 'assessment', deadline: dt('2026-11-27', '11:00'), completed: true },
        { kind: 'interview', round: '一面', status: 'pending', scheduledAt: dt('2026-11-27', '16:00') },
      ],
    },
    {
      id: 'sjsd-tianshu',
      company: '天枢网络',
      position: '前端架构工程师',
      location: '上海',
      steps: [
        { kind: 'interview', round: '一面', status: 'done', scheduledAt: dt('2026-11-27', '09:30') },
        { kind: 'interview', round: '二面', status: 'pending', scheduledAt: dt('2026-11-27', '19:00') },
      ],
    },
    {
      id: 'sjsd-feifan',
      company: '非凡算法',
      position: '推理引擎工程师',
      location: '深圳',
      steps: [
        { kind: 'interview', round: '一面', status: 'pending', scheduledAt: dt('2026-11-29', '14:00') },
      ],
    },
  ]);
}

function createOverdueJobs(): Job[] {
  return buildJobs([
    {
      id: 'od-moshi',
      company: '墨石智能',
      position: '大模型工程开发',
      location: '北京',
      starred: true,
      steps: [
        { kind: 'applied' },
        { kind: 'assessment', deadline: dt('2026-11-24', '23:59') },
      ],
    },
    {
      id: 'od-guangnian',
      company: '光年软件',
      position: '基础平台工程师',
      location: '上海',
      steps: [
        { kind: 'oc' },
        { kind: 'offer', replyDeadline: dt('2026-11-25', '18:00') },
      ],
    },
    {
      id: 'od-nanfeng',
      company: '南风科技',
      position: '支付系统后端',
      location: '杭州',
      steps: [
        { kind: 'interview', round: '二面', status: 'pending', scheduledAt: dt('2026-11-26', '15:00') },
      ],
    },
    {
      id: 'od-beichen',
      company: '北辰芯片',
      position: '工具链开发工程师',
      location: '苏州',
      steps: [
        { kind: 'applied' },
        { kind: 'assessment', deadline: dOnly('2026-11-23'), completed: true },
        { kind: 'interview', round: '一面', status: 'pending', scheduledAt: dt('2026-11-28', '10:30') },
      ],
    },
  ]);
}

function createCrossMonthOfferJobs(): Job[] {
  return buildJobs([
    {
      id: 'cm-shiguang',
      company: '拾光数据',
      position: '数据工程实习生',
      location: '北京',
      salary: '400/天',
      starred: true,
      steps: [
        { kind: 'interview', round: '二面', status: 'done', scheduledAt: dt('2026-11-24', '14:00') },
        { kind: 'oc' },
        { kind: 'offer', replyDeadline: dOnly('2026-12-03') },
      ],
    },
    {
      id: 'cm-lanjing',
      company: '蓝鲸云计算',
      position: '容器调度研发工程师',
      location: '杭州',
      steps: [
        { kind: 'interview', round: '二面', status: 'done', scheduledAt: dt('2026-11-26', '16:00') },
        { kind: 'interview', round: '终面', status: 'pending', scheduledAt: dt('2026-12-08', '18:00') },
      ],
    },
    {
      id: 'cm-jiguang-sec',
      company: '极光安全',
      position: '安全研究工程师',
      location: '深圳',
      steps: [
        { kind: 'oc' },
        { kind: 'offer', replyDeadline: dt('2026-12-10', '17:30') },
      ],
    },
  ]);
}

function createDateOnlyJobs(): Job[] {
  return buildJobs([
    {
      id: 'do-northstar',
      company: 'Northstar Systems',
      position: 'Platform Software Engineer (New Grad)',
      location: '上海',
      starred: true,
      steps: [
        { kind: 'oc' },
        { kind: 'offer', replyDeadline: dOnly('2026-11-29') },
      ],
    },
    {
      id: 'do-shenlan',
      company: '深蓝半导体',
      position: '编译器工程师',
      location: '成都',
      steps: [
        { kind: 'applied' },
        { kind: 'assessment', deadline: dOnly('2026-11-28') },
      ],
    },
    {
      id: 'do-yunfan',
      company: '云帆科技',
      position: '服务端开发工程师',
      location: '北京',
      steps: [
        { kind: 'interview', round: '一面', status: 'pending', scheduledAt: dt('2026-11-28', '15:30') },
      ],
    },
  ]);
}

function createUndatedJobs(): Job[] {
  return buildJobs([
    {
      id: 'ud-changfeng',
      company: '长风大模型',
      position: 'AI Infra 研发工程师',
      location: '北京',
      starred: true,
      steps: [
        { kind: 'applied' },
        { kind: 'interview', round: '一面', status: 'pending' },
      ],
    },
    {
      id: 'ud-chenghai',
      company: '澄海游戏',
      position: '客户端引擎工程师',
      location: '上海',
      steps: [
        { kind: 'applied' },
        { kind: 'assessment' },
      ],
    },
    {
      id: 'ud-weiguang',
      company: '微光软件',
      position: '全栈产品工程师',
      location: '杭州',
      steps: [
        { kind: 'interview', round: '一面', status: 'pending', scheduledAt: dt('2026-11-28', '10:00') },
      ],
    },
  ]);
}

function createEndedRestoreJobs(): Job[] {
  return buildJobs([
    {
      id: 'er-bailu',
      company: '白鹭智驾',
      position: '感知融合工程师',
      location: '上海',
      starred: true,
      outcome: 'declinedByUser',
      steps: [
        { kind: 'interview', round: '一面', status: 'pending', scheduledAt: dt('2026-11-29', '11:00') },
      ],
    },
    {
      id: 'er-qiyuan',
      company: '栖原软件',
      position: '平台开发工程师',
      location: '杭州',
      outcome: 'closedByEmployer',
      steps: [
        { kind: 'interview', round: '二面', status: 'done', scheduledAt: dt('2026-11-25', '14:00') },
      ],
    },
    {
      id: 'er-duomi',
      company: '多米互联',
      position: '前端开发工程师',
      location: '深圳',
      outcome: 'closedByEmployer',
      steps: [
        { kind: 'oc' },
        { kind: 'offer', replyDeadline: dOnly('2026-12-04') },
      ],
    },
    {
      id: 'er-fengxing',
      company: '风行科技',
      position: '检索系统工程师',
      location: '北京',
      steps: [
        { kind: 'interview', round: '二面', status: 'pending', scheduledAt: dt('2026-11-28', '16:00') },
      ],
    },
  ]);
}

function createDenseMonthJobs(): Job[] {
  return buildJobs([
    {
      id: 'dm-1-qinghe',
      company: '青禾科技',
      position: '后端开发实习生',
      location: '北京',
      salary: '380/天',
      starred: true,
      steps: [
        { kind: 'applied' },
        { kind: 'interview', round: '一面', status: 'done', scheduledAt: dt('2026-11-21', '14:00') },
        { kind: 'interview', round: '二面', status: 'pending', scheduledAt: dt('2026-11-27', '15:00') },
      ],
    },
    {
      id: 'dm-2-qiming',
      company: '启明星云',
      position: '分布式存储工程师',
      location: '北京',
      starred: true,
      steps: [
        { kind: 'assessment', deadline: dt('2026-11-27', '10:30'), completed: true },
        { kind: 'interview', round: '一面', status: 'pending', scheduledAt: dt('2026-11-27', '17:00') },
      ],
    },
    {
      id: 'dm-3-yuanhang',
      company: '远航数据',
      position: '实时计算研发',
      location: '上海',
      steps: [
        { kind: 'interview', round: '二面', status: 'pending', scheduledAt: dt('2026-11-27', '11:00') },
      ],
    },
    {
      id: 'dm-4-chenxi',
      company: '晨曦网络',
      position: '前端工程化研发',
      location: '深圳',
      steps: [
        { kind: 'assessment', deadline: dt('2026-11-27', '20:00') },
      ],
    },
    {
      id: 'dm-5-shiguang',
      company: '拾光数据',
      position: '数据工程实习生',
      location: '北京',
      salary: '420/天',
      steps: [
        { kind: 'interview', round: '终面', status: 'done', scheduledAt: dt('2026-11-23', '16:00') },
        { kind: 'oc' },
        { kind: 'offer', replyDeadline: dOnly('2026-12-03') },
      ],
    },
    {
      id: 'dm-6-moshi',
      company: '墨石智能',
      position: '推理框架研发',
      location: '上海',
      steps: [
        { kind: 'applied' },
        { kind: 'assessment', deadline: dt('2026-11-24', '23:59') },
      ],
    },
    {
      id: 'dm-7-northstar',
      company: 'Northstar Systems',
      position: 'Platform Software Engineer',
      location: '上海',
      steps: [
        { kind: 'oc' },
        { kind: 'offer', replyDeadline: dOnly('2026-11-29') },
      ],
    },
    {
      id: 'dm-8-lanjing',
      company: '蓝鲸云计算',
      position: '容器调度研发工程师',
      location: '杭州',
      steps: [
        { kind: 'interview', round: '一面', status: 'done', scheduledAt: dt('2026-11-19', '15:00') },
        { kind: 'interview', round: '终面', status: 'pending', scheduledAt: dt('2026-12-06', '14:30') },
      ],
    },
    {
      id: 'dm-9-shenlan',
      company: '深蓝半导体',
      position: '编译器工程师',
      location: '成都',
      steps: [
        { kind: 'assessment', deadline: dOnly('2026-11-28') },
      ],
    },
    {
      id: 'dm-10-changfeng',
      company: '长风大模型',
      position: 'AI Infra 研发',
      location: '北京',
      steps: [
        { kind: 'applied' },
        { kind: 'interview', round: '一面', status: 'pending' },
      ],
    },
    {
      id: 'dm-11-bailu',
      company: '白鹭智驾',
      position: '高精定位算法',
      location: '苏州',
      outcome: 'declinedByUser',
      steps: [
        { kind: 'interview', round: '一面', status: 'pending', scheduledAt: dt('2026-11-30', '10:00') },
      ],
    },
    {
      id: 'dm-12-yunfan',
      company: '云帆科技',
      position: '云数据库内核开发',
      location: '杭州',
      steps: [
        { kind: 'interview', round: '二面', status: 'pending', scheduledAt: dt('2026-12-01', '16:30') },
      ],
    },
    {
      id: 'dm-13-qiyuan',
      company: '栖原软件',
      position: '平台开发工程师',
      location: '杭州',
      outcome: 'closedByEmployer',
      steps: [
        { kind: 'interview', round: '一面', status: 'done', scheduledAt: dt('2026-11-22', '10:00') },
      ],
    },
  ]);
}

export const SCHEDULE_SCENARIOS: readonly ScheduleScenarioDef[] = [
  { id: 'dense-month', label: '十余岗位密集月', createJobs: createDenseMonthJobs },
  { id: 'sparse', label: '稀疏周', createJobs: createSparseJobs },
  { id: 'same-day-multi', label: '多岗位同日', createJobs: createSameDayMultiJobs },
  { id: 'same-job-same-day', label: '同岗同日', createJobs: createSameJobSameDayJobs },
  { id: 'overdue', label: '逾期', createJobs: createOverdueJobs },
  { id: 'cross-month-offer', label: '跨月 Offer', createJobs: createCrossMonthOfferJobs },
  { id: 'date-only', label: '只含日期', createJobs: createDateOnlyJobs },
  { id: 'undated', label: '待定轮次', createJobs: createUndatedJobs },
  { id: 'ended-restore', label: '结束与恢复', createJobs: createEndedRestoreJobs },
  { id: 'empty', label: '空看板', createJobs: () => [] },
];

export const DEFAULT_SCHEDULE_SCENARIO_ID: ScheduleScenarioId = 'dense-month';

export function resolveScheduleScenario(rawId: string | null | undefined): ScheduleScenarioDef {
  const found = SCHEDULE_SCENARIOS.find((s) => s.id === rawId);
  return found ?? SCHEDULE_SCENARIOS[0]!;
}

/**
 * 完全隔离的内存存储适配器：支持真实岗位卡与弹窗的所有领域命令，不读写 IndexedDB、localStorage 或服务端 API。
 */
export function createIsolatedDemoStore(initialJobs: Job[]): JobBoardStore {
  let jobs: Job[] = orderJobList([...initialJobs]);
  let prefs: BoardPreferences = defaultBoardPreferences();

  return {
    // 演示存储与 IndexedDB 行为一致（本地写完即确认），不使用 Sites 网络模式。
    mode: 'indexeddb',
    async listJobs() {
      return { ok: true, value: orderJobList(jobs) };
    },
    async getJob(jobId) {
      return { ok: true, value: jobs.find((j) => j.id === jobId) ?? null };
    },
    async submitJobCommand(cmd): Promise<CommandOutcome> {
      // 命令执行统一复用数据层的分发函数，避免在演示台复制领域动作路由。
      const res: JobActionResult =
        cmd.kind === 'create-job'
          ? dispatchCreateJobCommand(cmd)
          : (() => {
              const existing = jobs.find((j) => j.id === cmd.jobId);
              if (!existing) {
                return {
                  ok: false as const,
                  failure: {
                    reason: 'invalidInput' as const,
                    message: '岗位不存在',
                  },
                };
              }
              return dispatchJobCommand(existing, cmd);
            })();

      if (!res.ok) return { status: 'rejected', failure: res.failure };
      jobs = orderJobList(jobs.map((j) => (j.id === res.job.id ? res.job : j)));
      return { status: 'confirmed', job: res.job };
    },
    async getPreferences() {
      return { ok: true, value: prefs };
    },
    async savePreferences(patch) {
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
          applications: orderJobList(jobs),
          preferences: prefs,
        },
      };
    },
    async importBackup() {
      return {
        status: 'rejected',
        reason: 'targetNotEmpty',
        message: '演示样例不支持导入覆盖。',
      };
    },
  };
}
