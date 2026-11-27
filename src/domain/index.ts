/**
 * 扎口Job 岗位追踪领域的唯一公开入口。
 *
 * 数据与前端提案只从这里导入类型与业务动作，
 * 领域内部文件组织不在公开契约之内。
 */

export {
  createJob,
  updateJobProfile,
  setJobStar,
  logAppliedStep,
  logAssessmentStep,
  logInterviewStep,
  logOcStep,
  logOfferStep,
  updateAssessmentStep,
  updateInterviewStep,
  updateOfferStep,
  removeLatestStep,
  recordOutcome,
  clearOutcome,
} from './actions.ts';
export type {
  JobActionOptions,
  CreateJobInput,
  LogAssessmentStepInput,
  LogInterviewStepInput,
  LogOfferStepInput,
  AssessmentStepPatch,
  InterviewStepPatch,
  OfferStepPatch,
} from './actions.ts';

export { getLatestFlowNode, isFollowingUp, orderJobList } from './derive.ts';
export { newId, type IdFactory } from './ids.ts';
export { validateDeadline } from './deadline.ts';

export type {
  ApplicationOutcome,
  AppliedNode,
  AssessmentNode,
  CalendarDate,
  ClockTime,
  Deadline,
  FlowNode,
  FlowNodeKind,
  FlowNodeId,
  InterviewNode,
  InterviewStatus,
  Job,
  JobActionFailure,
  JobActionResult,
  JobId,
  JobProfile,
  JobProfilePatch,
  OcNode,
  OfferNode,
  OutcomeStatus,
  TimeZoneName,
} from './types.ts';
