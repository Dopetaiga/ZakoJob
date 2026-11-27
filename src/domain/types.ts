/**
 * 扎口Job 岗位追踪领域类型。
 *
 * 所有类型都是纯数据，不依赖浏览器、Node 或任何存储适配器，
 * 可被任意持久化方案原样序列化与回读。
 */

/** 岗位记录的稳定标识，建档时生成，补资料、改职位均沿用。 */
export type JobId = string;

/** 流程节点的稳定标识，用于更正与撤回时定位节点。 */
export type FlowNodeId = string;

/** 用户输入的日期，格式 YYYY-MM-DD。 */
export type CalendarDate = string;

/** 用户输入的时刻，24 小时制 HH:mm。 */
export type ClockTime = string;

/** IANA 时区名称，仅在期限精确到时刻时可选提供。 */
export type TimeZoneName = string;

/**
 * 期限统一表达「只含日期」与「精确到时刻」两种精度。
 * 只有日期时保留原日期精度，由展示端负责格式化；到期不自动推进流程或推断结果。
 */
export type Deadline =
  | { precision: 'date'; date: CalendarDate }
  | {
      precision: 'datetime';
      date: CalendarDate;
      time: ClockTime;
      timeZone?: TimeZoneName;
    };

/** 岗位资料六项：公司、职位、招聘链接、地点、薪资与纯文本 JD。 */
export interface JobProfile {
  company?: string;
  position?: string;
  postingUrl?: string;
  location?: string;
  /** 首版按用户输入的文本保存，可保留「300 元/天」等表述。 */
  salary?: string;
  jobDescription?: string;
}

/** 补填或更正资料时传入的字段集合，未提供的字段保持不变。 */
export type JobProfilePatch = Partial<JobProfile>;

/** 流程环节种类，按用户实际登记次序追加。 */
export type FlowNodeKind = 'applied' | 'assessment' | 'interview' | 'oc' | 'offer';

/** 已投递。 */
export interface AppliedNode {
  kind: 'applied';
  id: FlowNodeId;
}

/** 笔试 / 测评：保存完成状态及可选截止期限，用户手动标记完成。 */
export interface AssessmentNode {
  kind: 'assessment';
  id: FlowNodeId;
  completed: boolean;
  deadline?: Deadline;
}

/** 面试状态：待面试、已面。改期只更新安排时间，不改变状态。 */
export type InterviewStatus = 'pending' | 'done';

/** 面试：轮次名称由用户指定，独立于节点在流程中的位置，允许首条就是「二面」。 */
export interface InterviewNode {
  kind: 'interview';
  id: FlowNodeId;
  round: string;
  status: InterviewStatus;
  /** 可选安排时间，支持只含日期或精确到时刻。 */
  scheduledAt?: Deadline;
}

/** OC（口头 Offer）。 */
export interface OcNode {
  kind: 'oc';
  id: FlowNodeId;
}

/** 书面 Offer：保存收到 Offer 的事实和可选答复期限。 */
export interface OfferNode {
  kind: 'offer';
  id: FlowNodeId;
  replyDeadline?: Deadline;
}

/** 有序流程节点，末项即最新进展；空数组表示仅收藏、尚未登记环节。 */
export type FlowNode =
  | AppliedNode
  | AssessmentNode
  | InterviewNode
  | OcNode
  | OfferNode;

/**
 * 申请结果独立于流程保存：「已挂」为招聘方结束，「已拒」为本人拒绝。
 * 清除结果即可恢复跟进；若把结果放入流程，拒绝 Offer 后就须向前查找真正的最后进展。
 */
export type ApplicationOutcome =
  | { status: 'closedByEmployer' }
  | { status: 'declinedByUser' };

/** 登记或更正结果时使用的状态取值。 */
export type OutcomeStatus = ApplicationOutcome['status'];

/** 一份岗位申请：稳定标识、资料、有序流程、星标和可空结果。 */
export interface Job {
  id: JobId;
  profile: JobProfile;
  starred: boolean;
  flow: FlowNode[];
  outcome: ApplicationOutcome | null;
  /**
   * 乐观锁版本：每次成功更新加一。
   * 保存方以读取时的版本为条件原子提交，版本已变化则返回冲突。
   */
  version: number;
}

/** 业务动作的可区分失败，调用方据此提示用户，而不是静默失败。 */
export type JobActionFailure =
  | { reason: 'invalidInput'; message: string }
  | { reason: 'versionConflict' }
  | {
      reason: 'lastNodeMismatch';
      /** 当前实际的末节点 ID；流程为空时为 null。 */
      currentLastNodeId: FlowNodeId | null;
    }
  | { reason: 'nodeNotFound'; nodeId: FlowNodeId }
  | {
      reason: 'nodeKindMismatch';
      nodeId: FlowNodeId;
      expectedKind: FlowNodeKind;
      actualKind: FlowNodeKind;
    };

/** 业务动作结果：返回更新后的单条记录，或可区分的业务失败。 */
export type JobActionResult =
  | { ok: true; job: Job }
  | { ok: false; failure: JobActionFailure };
