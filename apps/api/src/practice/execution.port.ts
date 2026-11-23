import type { RunTechnicalResult } from '@alunza/contracts';
import { z } from 'zod';
import { localVmContextSchema } from './local-vm-config';

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
const dockerContextBase = {
  provider: z.literal('docker'),
  image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  runnerVersion: z.string().min(1).max(100),
};
const dockerRuntimeIdentity = {
  engineId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:_.-]{0,199}$/),
  runtimeName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/),
  runtimeVersion: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/),
  runtimeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  strategy: z.enum(['cold', 'prepared-pair-v1']),
};
export const configuredDockerExecutionContextSchema = z.strictObject({
  ...dockerContextBase,
  ...dockerRuntimeIdentity,
});
export type ConfiguredDockerExecutionContext = z.infer<
  typeof configuredDockerExecutionContextSchema
>;

/** Internal capability evidence, pinned at admission; legacy Docker stays readable. */
export const executionContextSchema = z.discriminatedUnion('provider', [
  z
    .object({
      ...dockerContextBase,
      engineId: dockerRuntimeIdentity.engineId.optional(),
      runtimeName: dockerRuntimeIdentity.runtimeName.optional(),
      runtimeVersion: dockerRuntimeIdentity.runtimeVersion.optional(),
      runtimeSha256: dockerRuntimeIdentity.runtimeSha256.optional(),
      strategy: dockerRuntimeIdentity.strategy.optional(),
    })
    .strict()
    .refine((value) => {
      const configured = [
        value.engineId,
        value.runtimeName,
        value.runtimeVersion,
        value.runtimeSha256,
        value.strategy,
      ];
      return (
        configured.every((field) => field === undefined) ||
        configured.every((field) => field !== undefined)
      );
    }, 'Docker runtime identity must be complete'),
  z
    .object({
      provider: z.literal('vercel'),
      image: z.string().regex(/^[a-zA-Z0-9./_-]+@sha256:[a-f0-9]{64}$/),
      runnerVersion: z.string().min(1).max(100),
      teamId: z.string().regex(/^team_[A-Za-z0-9]+$/),
      projectId: z.string().regex(/^prj_[A-Za-z0-9]+$/),
      region: z.string().regex(/^[a-z]{3}[1-9]$/),
      campaignId: z.uuid(),
      expiresAt: z.iso.datetime({ offset: true }),
      maxCreations: z.number().int().min(1).max(10000),
      maxRequests: z.number().int().min(10).max(1000000),
    })
    .strict()
    .refine((value) => value.maxRequests > value.maxCreations * 8),
  localVmContextSchema,
]);
export type ExecutionContext = z.infer<typeof executionContextSchema>;
export interface ExecutionAuthority {
  leaseToken: string;
  normalDeadlineMs: number;
  cleanupDeadlineMs: number;
}
export interface ExecutionRequestClosure {
  /** Terminal persistence and the final authorization both succeeded. */
  committed: boolean;
  cleanupVerified: boolean;
  /** true means HTTP finish; false means the connection closed prematurely. */
  responseClosed?: Promise<boolean>;
}
export interface RunnerInspection {
  available: boolean;
  runnerVersion: string;
  context?: ExecutionContext;
  /** Private snapshot only; the durable admission enforces capacity atomically. */
  capacity?: 'READY' | 'BUSY' | 'UNCERTAIN';
}
export abstract class ExecutionPort {
  abstract inspect(): Promise<RunnerInspection>;
  abstract execute(
    input: PracticeExecutionInput,
    context?: ExecutionContext,
    authority?: ExecutionAuthority,
  ): Promise<{
    technicalResult: RunTechnicalResult;
    cleanupVerified: boolean;
  }>;
  abstract cleanup(
    executionId: string,
    timeoutMs?: number,
    context?: ExecutionContext,
  ): Promise<boolean>;
  abstract sweepExpired(): Promise<{
    cleanupVerified: boolean;
    removed: number;
  }>;
  requestClosed(
    _executionId: string,
    _context: ExecutionContext,
    _closure: ExecutionRequestClosure,
  ): void {
    // Providers without a prepared reserve have no post-response work.
  }
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
