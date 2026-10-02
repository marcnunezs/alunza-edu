import type { SubmitTechnicalResult } from '@alunza/contracts';
import { failedRun } from './execution.port';

export interface SubmissionTest {
  id: string;
  visibility: 'visible' | 'hidden';
  args: unknown[];
  expected: unknown;
}
export interface SubmissionExecutionInput {
  executionId: string;
  requestId: string;
  exerciseVersionId: string;
  testsVersion: string;
  mode: 'SUBMIT';
  entrypoint: 'solve';
  code: string;
  tests: SubmissionTest[];
}
export interface CanonicalSubmissionResult {
  technicalResult: SubmitTechnicalResult;
  // Private evidence is persisted internally and never attached to an HTTP DTO.
  privateTestResults: Array<{ id: string; passed: boolean }>;
}
export abstract class SubmissionExecutionPort {
  abstract execute(
    input: SubmissionExecutionInput,
  ): Promise<CanonicalSubmissionResult & { cleanupVerified: boolean }>;
}
export function failedSubmission(
  runnerVersion: string,
  visibleTotal: number,
  lifecycleMs = 0,
): CanonicalSubmissionResult {
  return {
    technicalResult: {
      ...failedRun(runnerVersion, visibleTotal, lifecycleMs),
      hiddenChecksPassed: null,
      allRequiredPassed: false,
    },
    privateTestResults: [],
  };
}
