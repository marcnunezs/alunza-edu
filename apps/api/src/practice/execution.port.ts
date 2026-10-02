import type { RunTechnicalResult } from '@alunza/contracts';

export interface VisibleTest {
  id: string;
  visibility: 'visible';
  args: unknown[];
  expected: unknown;
}
export interface PracticeExecutionInput {
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
  abstract inspect(): Promise<{ available: boolean; runnerVersion: string }>;
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
