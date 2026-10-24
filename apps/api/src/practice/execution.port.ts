import type { RunTechnicalResult } from '@alunza/contracts';

// Ephemeral server preparation, never part of an execution body or persistence.
export interface ExecutionPreparation {
  readonly provider: 'docker';
  readonly image: string;
}
export interface RunnerInspection {
  available: boolean;
  runnerVersion: string;
  preparation?: ExecutionPreparation;
}

export interface VisibleTest {
  id: string;
  visibility: 'visible';
  args: unknown[];
  expected: unknown;
}
export interface PracticeExecutionInput {
  limits: { memoryBytes: number; runtimeMs: number; outputBytes: number };
  executionId: string;
  requestId: string;
  exerciseVersionId: string;
  testsVersion: string;
  mode: 'RUN';
  entrypoint: 'solve';
  code: string;
  tests: VisibleTest[];
}
export abstract class ExecutionPort {
  abstract inspect(): Promise<RunnerInspection>;
  abstract execute(input: PracticeExecutionInput): Promise<{
    technicalResult: RunTechnicalResult;
    cleanupVerified: boolean;
  }>;
  abstract cleanup(executionId: string, timeoutMs?: number): Promise<boolean>;
  abstract sweepExpired(): Promise<{
    cleanupVerified: boolean;
    removed: number;
  }>;
}

export function failedRun(
  runnerVersion: string,
  visibleTotal: number,
  lifecycleMs = 0,
): RunTechnicalResult {
  return {
    runnerVersion,
    diagnosisCode: 'UNKNOWN',
    terminationReason: 'RUNNER_FAILURE',
    infrastructureStatus: 'FAILED',
    visibleTestResults: [],
    visiblePassed: 0,
    visibleTotal,
    outputTruncated: false,
    outputBytes: 0,
    runtimeMs: 0,
    lifecycleMs: Math.max(0, lifecycleMs),
  };
}
