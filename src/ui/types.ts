import type {
  BoardLayout,
  BoardModuleId,
  BoardPreferences,
  PreferenceScope,
} from '../data/contract.ts';
import type { Deadline } from '../domain/index.ts';

export type { BoardLayout, BoardModuleId, BoardPreferences, PreferenceScope, Deadline };

export type ApplicationResult = 'rejected' | 'declined';

export interface StepTimeValue {
  precision: 'date' | 'datetime';
  date: string;
  time?: string;
  timeZone?: string;
  /** Optional display override used only by demo samples (e.g. '周五 15:00') */
  label?: string;
}

export type JobStep =
  | {
      id: string;
      kind: 'applied';
      note?: string;
    }
  | {
      id: string;
      kind: 'assessment';
      completed: boolean;
      deadline?: StepTimeValue;
      label?: string;
    }
  | {
      id: string;
      kind: 'interview';
      roundLabel: string;
      status: 'pending' | 'completed';
      scheduledAt?: StepTimeValue;
    }
  | {
      id: string;
      kind: 'oc';
    }
  | {
      id: string;
      kind: 'written_offer';
      deadline?: StepTimeValue;
    };

export interface JobCardData {
  id: string;
  version: number;
  company: string;
  position: string;
  url?: string;
  location?: string;
  salary?: string;
  jd?: string;
  starred: boolean;
  result: ApplicationResult | null;
  steps: readonly JobStep[];
}

export interface JobDetailsDraft {
  url?: string;
  company: string;
  position: string;
  location?: string;
  salary?: string;
  jd?: string;
}

export type AddStepInput =
  | { kind: 'applied' }
  | {
      kind: 'assessment';
      completed: boolean;
      deadline?: StepTimeValue;
    }
  | {
      kind: 'interview';
      roundLabel: string;
      status: 'pending' | 'completed';
      scheduledAt?: StepTimeValue;
    }
  | { kind: 'oc' }
  | { kind: 'written_offer'; deadline?: StepTimeValue };

export type ContextualQuickAction =
  | {
      kind: 'complete-current';
      actionId: 'complete-assessment' | 'complete-interview';
      label: string;
      targetStep: JobStep;
      primary: boolean;
    }
  | {
      kind: 'edit-step';
      actionId: 'add-offer-deadline';
      label: string;
      targetStep: JobStep;
      primary: boolean;
    }
  | {
      kind: 'append-step';
      actionId: 'applied' | 'assessment' | 'interview' | 'oc' | 'written_offer';
      label: string;
      input: AddStepInput;
      primary: boolean;
    }
  | {
      kind: 'correct-result';
      actionId: 'correct-result';
      label: string;
      primary: boolean;
    }
  | {
      kind: 'clear-result';
      actionId: 'clear-result';
      label: string;
      primary: boolean;
    };

export interface JobBoardCallbacks {
  onToggleStar?: (job: JobCardData, nextStarred: boolean) => void;
  onRequestAddJob?: () => void;
  onRequestEditDetails?: (job: JobCardData) => void;
  onCompleteCurrentStep?: (job: JobCardData, currentStep: JobStep) => void;
  onRequestAddStep?: (job: JobCardData) => void;
  onSubmitNewStep?: (job: JobCardData, input: AddStepInput) => void;
  onRequestEditStep?: (job: JobCardData, targetStep: JobStep) => void;
  onRemoveLatestStep?: (
    job: JobCardData,
    latestStep: JobStep,
  ) => Promise<boolean> | boolean | void;
  onSetResult?: (job: JobCardData, result: ApplicationResult | null) => void;
  onInspectDetails?: (job: JobCardData) => void;
}

export type MobileHistoryMode = 'expand' | 'swipe' | 'timeline';
export type MobileMenuContainer = 'inline' | 'sheet';

export type AgendaItemKind = 'interview' | 'assessment_deadline' | 'offer_deadline';

export interface AgendaItem {
  jobId: string;
  stepId: string;
  kind: AgendaItemKind;
  jobName: string;
  title: string;
  subtitle: string;
  time: StepTimeValue;
  timeText: string;
  sortKey: number;
}

export interface EmptyStateOptions {
  title?: string;
  description?: string;
  ctaLabel?: string;
  onAddJob?: () => void;
}

export interface BoardHandle<TOptions> {
  element: HTMLElement;
  update: (nextOptions: TOptions) => void;
  destroy: () => void;
}
