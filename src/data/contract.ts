/**
 * 扎口Job 数据层公共契约。
 *
 * 本文件只含类型与常量，不含实现，供三种调用方共同引用：
 * - 前端提案：通过 {@link JobBoardStore} 读写岗位、偏好与备份；
 * - IndexedDB 适配器（src/data/indexeddb/）：实现本接口；
 * - Sites HTTP 客户端（src/sites/client.ts，另一会话实现）：实现本接口。
 *
 * 所有跨越适配器边界的对象都必须可 JSON 序列化：
 * 领域记录、命令与失败原样保存或传输，不携带函数。
 *
 * # 语义约定
 *
 * - 版本条件：岗位命令携带调用方读取时的 `expectedVersion`，
 *   提交时若当前版本不同则返回 `versionConflict`，调用方重读后由用户再选动作。
 * - 重送安全：建档命令由客户端生成 `jobId`，登记环节命令由客户端生成 `nodeId`；
 *   同一命令按同一期望版本重送只会命中版本冲突或重复标识，不会追加第二条。
 * - 补丁语义：`undefined`（或 JSON 中缺省的键）表示不变。清除分两类：
 *   期限类补丁（AssessmentStepPatch/InterviewStepPatch/OfferStepPatch）的
 *   `null` 表示清除该期限；资料补丁（JobProfilePatch）不支持 `null`，
 *   清除资料字段用空字符串（表单编辑提交空字段即为 `''`）。
 * - 三态结果：`confirmed` 才算保存成功；`rejected` 是明确失败；
 *   `unconfirmed` 表示请求已发出但失去响应，调用方应提示「未确认是否保存，请刷新查看」，
 *   并在用户刷新或重读后依据真实状态继续；绝不离线缓存假象或自动补传。
 *
 * # Sites HTTP 客户端必须导出的成员（src/sites/client.ts）
 *
 * - `createSitesJobBoard(options: SitesJobBoardOptions): Promise<JobBoardStore>`
 *   工厂：建立指向站点 API 的客户端并返回实现本契约的适配器。
 * - `SitesJobBoardOptions`：`{ apiBaseUrl: string; fetch?: typeof fetch }`；
 *   `apiBaseUrl` 为空字符串表示同源站点 API；`fetch` 可注入测试替身。
 * - 客户端内部必须：所有数据路径（岗位、偏好、备份）先经站点可信身份校验；
 *   将 {@link JobCommand} 发往按岗位的条件更新 API；
 *   把「发送前断网」「服务端明确拒绝」映射为 `rejected`，
 *   把「请求已发出但响应丢失」映射为 `unconfirmed`；
 *   导入时按 {@link ImportOutcome} 报告目标非空与校验失败；
 *   导出对应一次一致快照请求。
 */

import type {
  AssessmentStepPatch,
  CreateJobInput,
  Deadline,
  InterviewStepPatch,
  Job,
  JobActionFailure,
  JobId,
  FlowNodeId,
  JobProfilePatch,
  OfferStepPatch,
  OutcomeStatus,
} from '../domain/index.ts';

/* ------------------------------------------------------------------ */
/* 开始页布局偏好                                                       */
/* ------------------------------------------------------------------ */

/** 开始页模块标识。显示名称与样式由前端定义；备份只保存标识、顺序与可见性。 */
export type BoardModuleId = 'jobs' | 'schedule';

/** 已知模块标识集合。校验偏好与备份时使用，模块集合变化时随备份版本一起演进。 */
export const BOARD_MODULE_IDS = ['jobs', 'schedule'] as const;

/** 一个模块在开始页中的位置：数组顺序即显示顺序。要求列出全部已知模块。 */
export interface BoardModulePlacement {
  id: BoardModuleId;
  visible: boolean;
}

/** 一份布局：模块的显示顺序与可见性。 */
export interface BoardLayout {
  modules: readonly BoardModulePlacement[];
}

/** 分端布局覆盖：保留「沿用共用布局」与「已单独设置」的区别。 */
export type DeviceLayoutOverride =
  | { overridden: false }
  | { overridden: true; layout: BoardLayout };

/** 完整偏好：共用布局加上可选的手机、桌面覆盖。 */
export interface BoardPreferences {
  shared: BoardLayout;
  mobile: DeviceLayoutOverride;
  desktop: DeviceLayoutOverride;
}

/**
 * 偏好写入补丁：只写提供的范围，其他范围保持不变，
 * 避免手机改布局覆盖桌面布局。恢复备份时整组替换由适配器内部完成。
 */
export interface PreferencesPatch {
  shared?: BoardLayout;
  mobile?: DeviceLayoutOverride;
  desktop?: DeviceLayoutOverride;
}

/** 偏好范围标识，校验偏好与备份中的范围取值时使用。 */
export const PREFERENCE_SCOPES = ['shared', 'mobile', 'desktop'] as const;

export type PreferenceScope = (typeof PREFERENCE_SCOPES)[number];

/** 缺省偏好：共用布局按模块默认顺序全显示，两端都沿用共用布局。 */
export function defaultBoardPreferences(): BoardPreferences {
  return {
    shared: {
      modules: BOARD_MODULE_IDS.map((id) => ({ id, visible: true })),
    },
    mobile: { overridden: false },
    desktop: { overridden: false },
  };
}

export type PreferencesOutcome =
  | { status: 'confirmed'; preferences: BoardPreferences }
  | { status: 'rejected'; failure: { reason: 'invalidPreferences'; message: string } }
  | { status: 'failed'; message: string }
  | { status: 'unconfirmed' };

/* ------------------------------------------------------------------ */
/* 岗位命令                                                            */
/* ------------------------------------------------------------------ */

/** 新增环节的负载，字段与领域动作入参一致；`nodeId` 由调用方生成并随命令携带。 */
export type LogStepPayload =
  | { kind: 'applied' }
  | { kind: 'assessment'; deadline?: Deadline }
  | { kind: 'interview'; round: string; scheduledAt?: Deadline }
  | { kind: 'oc' }
  | { kind: 'offer'; replyDeadline?: Deadline };

/** 更正环节的负载：目标环节种类决定路由到的领域动作。 */
export type UpdateStepPayload =
  | { targetKind: 'assessment'; patch: AssessmentStepPatch }
  | { targetKind: 'interview'; patch: InterviewStepPatch }
  | { targetKind: 'offer'; patch: OfferStepPatch };

/**
 * 岗位业务命令：领域动作的可序列化形式。
 * 适配器在事务或服务端内按命令调用同一套领域动作并按版本条件提交。
 */
export type JobCommand =
  | {
      kind: 'create-job';
      /** 客户端生成的稳定岗位 ID；重送沿用同一 ID，禁止覆盖同 ID 记录。 */
      jobId: JobId;
      input: CreateJobInput;
    }
  | {
      kind: 'update-profile';
      jobId: JobId;
      expectedVersion: number;
      patch: JobProfilePatch;
    }
  | {
      kind: 'set-star';
      jobId: JobId;
      expectedVersion: number;
      starred: boolean;
    }
  | {
      kind: 'log-step';
      jobId: JobId;
      expectedVersion: number;
      /** 客户端生成的稳定节点 ID；同一命令重送沿用同一 ID。 */
      nodeId: FlowNodeId;
      step: LogStepPayload;
    }
  | {
      kind: 'update-step';
      jobId: JobId;
      expectedVersion: number;
      nodeId: FlowNodeId;
      payload: UpdateStepPayload;
    }
  | {
      kind: 'remove-latest-step';
      jobId: JobId;
      expectedVersion: number;
      /** 调用方看到的末节点 ID；提交时由领域规则核对仍是末节点。 */
      expectedLastNodeId: FlowNodeId;
    }
  | {
      kind: 'record-outcome';
      jobId: JobId;
      expectedVersion: number;
      status: OutcomeStatus;
    }
  | {
      kind: 'clear-outcome';
      jobId: JobId;
      expectedVersion: number;
    };

/** 岗位命令的结果：确认、业务拒绝、存储级失败或结果未知。 */
export type CommandOutcome =
  | { status: 'confirmed'; job: Job }
  | { status: 'rejected'; failure: JobActionFailure }
  | {
      /** 本地事务中止、配额不足或服务端明确故障；读回值仍是先前已提交的数据。 */
      status: 'failed';
      message: string;
    }
  | { status: 'unconfirmed' };

/* ------------------------------------------------------------------ */
/* 读取与存储失败                                                       */
/* ------------------------------------------------------------------ */

export type StorageReadFailure =
  | { reason: 'unavailable'; message: string }
  /** 已发出读取请求但失去响应；调用方应提示刷新后重试。 */
  | { reason: 'unknown'; message?: string };

export type ReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: StorageReadFailure };

/* ------------------------------------------------------------------ */
/* 备份与恢复                                                          */
/* ------------------------------------------------------------------ */

/** 备份信封的格式标识与版本号。 */
export const BACKUP_FORMAT = 'zakoujob-backup' as const;
export const BACKUP_VERSION = 1 as const;

/**
 * v1 备份文件。顶层 `applications`（岗位数组）与 `preferences`（布局偏好）；
 * 空数组是合法备份。每份岗位保留领域定义的全部业务字段、岗位与节点稳定 ID、
 * 节点顺序及原有时间精度。文件不包含访问身份、数据库绑定或凭据。
 */
export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  applications: readonly Job[];
  preferences: BoardPreferences;
}

/** 整包校验问题，`path` 定位到问题记录或字段，如 `applications[1].flow[2].id`。 */
export interface BackupIssue {
  path: string;
  message: string;
}

/** 导入前整包校验的结果：通过时返回可信的 {@link BackupFile}。 */
export type BackupDecodeResult =
  | { ok: true; backup: BackupFile }
  | { ok: false; issues: BackupIssue[] };

export type ImportOutcome =
  | { status: 'confirmed' }
  | { status: 'rejected'; reason: 'invalidBackup'; issues: BackupIssue[] }
  | { status: 'rejected'; reason: 'targetNotEmpty'; message: string }
  | { status: 'failed'; message: string }
  | { status: 'unconfirmed' };

export type ExportOutcome =
  | { ok: true; backup: BackupFile }
  | { ok: false; failure: StorageReadFailure };

/* ------------------------------------------------------------------ */
/* 统一存储接口                                                        */
/* ------------------------------------------------------------------ */

/**
 * 统一存储接口：页面通过相同的应用入口读取岗位、提交岗位命令、
 * 读写开始页偏好、导出及恢复看板；IndexedDB 与 Sites 两个适配器都实现它。
 *
 * 实现要求（两种适配器一致）：
 * - `submitJobCommand` 在一个事务或一次服务端条件更新内核对版本、应用领域动作并提交；
 *   IndexedDB 以事务完成为成功，Sites 以服务端确认为成功。
 * - `savePreferences` 只写提供的范围，保留其他范围。
 * - `exportSnapshot` 在一个一致快照中读取全部岗位与偏好。
 * - `importBackup` 接收未解析的外部 JSON 值，先整包校验再原子恢复：
 *   目标存在任何岗位（含已结束）即整体拒绝；提交前并发新增同样拒绝；
 *   任一写入失败时目标保持导入前的状态。
 */
export interface JobBoardStore {
  /** 适配器类别；调用方可据此展示「本地保存」或「站点保存」。 */
  readonly mode: 'indexeddb' | 'sites';

  /** 全部岗位（含已结束），按存储顺序返回；调用方自行应用星标排序。 */
  listJobs(): Promise<ReadResult<readonly Job[]>>;

  /** 按 ID 读取单条岗位；不存在时返回 null（仍算读取成功）。 */
  getJob(jobId: JobId): Promise<ReadResult<Job | null>>;

  /** 提交一条岗位命令，按版本条件执行并返回三态结果。 */
  submitJobCommand(command: JobCommand): Promise<CommandOutcome>;

  /** 读取完整偏好（共用与分端）。从未设置时返回缺省偏好而非失败。 */
  getPreferences(): Promise<ReadResult<BoardPreferences>>;

  /** 按补丁写入偏好：只写提供的范围，保留其他范围。 */
  savePreferences(patch: PreferencesPatch): Promise<PreferencesOutcome>;

  /** 导出一份一致快照（全部岗位 + 偏好）。 */
  exportSnapshot(): Promise<ExportOutcome>;

  /** 向空看板原子恢复一份备份；接收未解析的外部 JSON 值并整包校验。 */
  importBackup(parsed: unknown): Promise<ImportOutcome>;
}

/** Sites HTTP 客户端工厂入参（由 src/sites/client.ts 实现并导出）。 */
export interface SitesJobBoardOptions {
  /** 站点 API 基址；空字符串表示同源。集中一处，独立部署后端可复用请求契约。 */
  apiBaseUrl: string;
  /** 可注入的 fetch 实现，默认使用全局 fetch；测试替身通过它模拟断网与响应丢失。 */
  fetch?: typeof fetch;
}
