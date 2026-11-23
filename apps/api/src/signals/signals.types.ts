import type { SignalRuleVersion } from '@alunza/contracts';
import type { InactivityInput, evaluateInactivity } from './inactivity';
import type {
  RepeatedErrorInput,
  evaluateRepeatedError,
} from './repeated-error';
import type { evaluateStagnation } from './stagnation';

export type SignalType = 'INACTIVITY' | 'REPEATED_ERROR' | 'STAGNATION';
export interface SignalLane {
  laneId: string;
  type: SignalType;
  organizationId: string;
  classId: string;
  studentId: string;
  activityId: string;
  assignmentId: string | null;
}
export interface SignalLease extends SignalLane {
  leaseToken: string;
  leaseUntil: string;
}
export interface SignalBoundary {
  kind:
    | 'START'
    | 'SUBMISSION'
    | 'EVENT'
    | 'RULE_ACTIVATED'
    | 'AVAILABILITY'
    | 'COVERAGE'
    | 'REVIEW'
    | 'INACTIVITY_DUE'
    | 'REPETITION_EXPIRES'
    | 'RECONCILE'
    | 'CURRENT';
  at: string;
  reference: string;
  sequence?: string;
}
export type SignalEvaluationOutput =
  | ReturnType<typeof evaluateInactivity>
  | ReturnType<typeof evaluateRepeatedError>
  | ReturnType<typeof evaluateStagnation>;

export interface SignalContinuation {
  revision: string;
  targetThrough: string;
  afterBoundary: SignalBoundary;
  lastMeaning: string | null;
  pendingDeadlineMicros: string | null;
}

/** Private acquisition envelope. Canonical results are used in memory only. */
export interface SignalSnapshot {
  schemaVersion: 1;
  lane: SignalLane;
  snapshot: {
    id: string;
    revision: string;
    digest: string;
    observedThrough: string;
    capturedAt: string;
  };
  bootstrapAt: string;
  checkpoint: {
    throughTime: string | null;
    throughSubmissionSequence: string | null;
    pendingReconciliationBreak: boolean;
    boundaryKey: string | null;
    continuation: SignalContinuation | null;
  };
  activity: InactivityInput['activity'] & { assignmentId?: string };
  rules: SignalRuleVersion[];
  coverage: InactivityInput['coverage'];
  coverageHistory: { at: string; coverage: InactivityInput['coverage'] }[];
  events: InactivityInput['events'];
  submissions: RepeatedErrorInput['submissions'];
  availabilityChanges: {
    id: string;
    sequence: string;
    occurredAt: string;
    component: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }[];
  reviews: {
    id: string;
    reviewedAt: string;
    episodeId: string;
    baseWitnessKeys: string[];
  }[];
  processedWitnessKeys: string[];
  priorEvaluations: {
    identityKey: string;
    publicationAllowed: boolean;
    boundary: SignalBoundary;
    result: SignalEvaluationOutput;
  }[];
  knownSemanticKeys: string[];
}
export interface SignalPersistableEvaluation {
  identityKey: string;
  witnessKey: string | null;
  semanticKey: string;
  boundary: SignalBoundary;
  result: SignalEvaluationOutput;
  publicationAllowed: boolean;
}
export interface SignalCheckpoint {
  throughTime: string;
  throughSubmissionSequence: string | null;
  boundaryKey: string | null;
  nextDeadlineMicros: string | null;
  hasMore: boolean;
  continuation: SignalContinuation | null;
}
export interface SignalEvaluationBatch {
  evaluations: SignalPersistableEvaluation[];
  checkpoint: SignalCheckpoint;
}
export interface SignalFinalization {
  status: 'COMMITTED' | 'STALE' | 'LEASE_LOST' | 'REPLAY';
  evaluations: number;
  signals: number;
}

export interface SignalEpisode {
  id: string;
  laneId: string;
  ruleVersionId: string;
  state: 'ACTIVE' | 'REVIEWED';
  cause: string;
  evidence: Record<string, unknown>;
  qualifiedAt: string;
  calculatedAt: string;
  previousEpisodeId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}
export interface SignalEpisodeEvidence extends SignalEpisode {
  scope: SignalLane;
  evaluations: {
    id: string;
    evaluationTime: string;
    calculatedAt: string;
    boundary: SignalBoundary;
    result: SignalEvaluationOutput;
  }[];
}
