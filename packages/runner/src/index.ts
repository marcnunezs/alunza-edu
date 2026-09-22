import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { imageIdentity, runCapsule } from '../../../infra/runner/capsule.mjs';

export const RUNNER_VERSION = 'imp-00-06.1';
export const LIMITS = Object.freeze({
  memoryBytes: 134217728,
  runtimeMs: 3000,
  outputBytes: 65536,
  returnBytes: 65536,
  codeBytes: 65536,
});
const json = z.json();
export const executionSchema = z
  .object({
    executionId: z.uuid(),
    requestId: z.string().min(1).max(100),
    exerciseVersionId: z.string().min(1).max(100),
    testsVersion: z.string().min(1).max(100),
    mode: z.enum(['RUN', 'SUBMIT']),
    entrypoint: z.literal('solve'),
    code: z
      .string()
      .refine(
        (value) => Buffer.byteLength(value) <= LIMITS.codeBytes,
        'Code exceeds byte limit',
      ),
    tests: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            visibility: z.enum(['visible', 'hidden']),
            args: z
              .array(json)
              .refine(
                (value) => Buffer.byteLength(JSON.stringify(value)) <= 65536,
              ),
            expected: json,
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.tests.map((item) => item.id)).size === value.tests.length,
    'Duplicate test ID',
  );
export type ExecutionInput = z.infer<typeof executionSchema>;
export type Diagnosis =
  | 'SUCCESS'
  | 'SYNTAX_ERROR'
  | 'RUNTIME_ERROR'
  | 'FAILED_TEST'
  | 'TIMEOUT'
  | 'UNKNOWN';
export type TerminationReason =
  | 'COMPLETED'
  | 'STUDENT_SYNTAX'
  | 'STUDENT_EXCEPTION'
  | 'ASSERTION_FAILED'
  | 'EXECUTION_DEADLINE'
  | 'MEMORY_LIMIT'
  | 'OUTPUT_LIMIT'
  | 'RETURN_LIMIT'
  | 'PROTOCOL_INVALID'
  | 'RUNNER_FAILURE'
  | 'PROVIDER_FAILURE'
  | 'CAPABILITY_GAP'
  | 'CANCELLED';
export type CapsuleInput = {
  code: string;
  args: unknown[];
  budgetMs: number;
  outputRemaining: number;
};
export type CapsuleResult = Awaited<ReturnType<typeof runCapsule>>;
export interface CapsuleAdapter {
  readonly provider: 'docker' | 'vercel';
  execute(input: CapsuleInput, signal?: AbortSignal): Promise<CapsuleResult>;
  close(): Promise<void>;
}
export class DockerAdapter implements CapsuleAdapter {
  readonly provider = 'docker' as const;
  private image?: string;
  async execute(input: CapsuleInput, signal?: AbortSignal) {
    this.image ??= await imageIdentity();
    return runCapsule(input, { image: this.image, signal });
  }
  async close() {
    /* Every capsule is removed in runCapsule finally. */
  }
}
const packetSchema = z
  .object({
    status: z.enum([
      'capability-gap',
      'syntax',
      'failure',
      'exited',
      'timeout',
      'output',
      'return-limit',
    ]),
    runtimeMs: z.number().finite().nonnegative(),
    outputBytes: z.number().int().min(0).max(65536),
    stdout: z.string().max(87384),
    stderr: z.string().max(87384),
    returnData: z.string().max(87384).optional(),
    outputTruncated: z.boolean(),
    exitCode: z.number().int().nullable().optional(),
    signal: z.string().nullable().optional(),
    cgroup: z.record(z.string(), z.string().max(2000)),
  })
  .strict();
const returnSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value'), value: json }).strict(),
  z.object({ kind: z.literal('exception') }).strict(),
  z
    .object({
      kind: z.literal('invalid'),
      reason: z.enum(['RETURN_LIMIT', 'CAPABILITY_GAP']),
    })
    .strict(),
]);
type CaseResult = {
  id: string;
  passed: boolean;
  stdout: string;
  stderr: string;
};
export type ExecutionResult = {
  executionId: string;
  runnerVersion: string;
  diagnosisCode: Diagnosis;
  terminationReason: TerminationReason;
  infrastructureStatus: 'OK' | 'FAILED';
  allRequiredPassed: boolean;
  visibleTestResults: CaseResult[];
  privateTestResults: CaseResult[];
  hiddenRequiredCount: number;
  outputTruncated: boolean;
  outputBytes: number;
  runtimeMs: number;
  lifecycleMs: number;
  evidence: {
    provider: string;
    image: string | null;
    cleanupVerified: boolean;
    cgroups: Record<string, string>[];
    invocationAuthenticity: 'NOT_PROVEN';
    bridgeUid: 0;
    bridgeCapabilities: string[];
    studentUid: 10001;
    studentCapabilities: 'ZERO_REQUIRED';
    bridgeCountsAgainstMemory: true;
    oomObserved: boolean;
    hostDeadlineObserved: boolean;
    hostProgramWallMs: number;
  };
};
export function publicResult(result: ExecutionResult) {
  return {
    executionId: result.executionId,
    runnerVersion: result.runnerVersion,
    diagnosisCode: result.diagnosisCode,
    terminationReason: result.terminationReason,
    allRequiredPassed: result.allRequiredPassed,
    visibleTestResults: result.visibleTestResults.map(
      ({ id, passed, stdout, stderr }) => ({ id, passed, stdout, stderr }),
    ),
    hiddenChecksPassed:
      result.hiddenRequiredCount > 0 &&
      result.privateTestResults.length === result.hiddenRequiredCount &&
      result.privateTestResults.every((item) => item.passed),
    outputTruncated: result.outputTruncated,
    runtimeMs: result.runtimeMs,
    lifecycleMs: result.lifecycleMs,
  };
}
export async function execute(
  raw: unknown,
  adapter: CapsuleAdapter,
  signal?: AbortSignal,
): Promise<ExecutionResult> {
  const input = executionSchema.parse(raw);
  const started = performance.now();
  const tests = input.tests.filter(
    (item) => input.mode === 'SUBMIT' || item.visibility === 'visible',
  );
  if (tests.length === 0) throw new Error('RUN requires a visible test');
  const result: ExecutionResult = {
    executionId: input.executionId,
    runnerVersion: RUNNER_VERSION,
    diagnosisCode: 'UNKNOWN',
    terminationReason: 'RUNNER_FAILURE',
    infrastructureStatus: 'OK',
    allRequiredPassed: false,
    visibleTestResults: [],
    privateTestResults: [],
    hiddenRequiredCount: tests.filter((item) => item.visibility === 'hidden')
      .length,
    outputTruncated: false,
    outputBytes: 0,
    runtimeMs: 0,
    lifecycleMs: 0,
    evidence: {
      provider: adapter.provider,
      image: null,
      cleanupVerified: true,
      cgroups: [],
      invocationAuthenticity: 'NOT_PROVEN',
      bridgeUid: 0,
      bridgeCapabilities: ['CAP_SETUID', 'CAP_SETGID', 'CAP_SETPCAP'],
      studentUid: 10001,
      studentCapabilities: 'ZERO_REQUIRED',
      bridgeCountsAgainstMemory: true,
      oomObserved: false,
      hostDeadlineObserved: false,
      hostProgramWallMs: 0,
    },
  };
  let complete = true;
  const stop = (diagnosis: Diagnosis, reason: TerminationReason) => {
    result.diagnosisCode = diagnosis;
    result.terminationReason = reason;
    complete = false;
  };
  try {
    for (const item of tests) {
      if (signal?.aborted) {
        stop('UNKNOWN', 'CANCELLED');
        break;
      }
      if (result.runtimeMs >= LIMITS.runtimeMs) {
        stop('TIMEOUT', 'EXECUTION_DEADLINE');
        break;
      }
      const response = await adapter.execute(
        {
          code: input.code,
          args: item.args,
          budgetMs: LIMITS.runtimeMs - result.runtimeMs,
          outputRemaining: LIMITS.outputBytes - result.outputBytes,
        },
        signal,
      );
      result.evidence.image = response.image;
      result.evidence.cleanupVerified &&= response.cleanupVerified;
      result.evidence.oomObserved ||= response.oomKilled;
      result.evidence.hostDeadlineObserved ||= response.timedOut;
      if (
        !Number.isFinite(response.programWallMs) ||
        response.programWallMs < 0
      ) {
        stop('UNKNOWN', 'PROTOCOL_INVALID');
        break;
      }
      result.runtimeMs += response.programWallMs;
      result.evidence.hostProgramWallMs += response.programWallMs;
      if (response.cancelled) {
        stop('UNKNOWN', 'CANCELLED');
        break;
      }
      if (response.oomKilled) {
        stop('UNKNOWN', 'MEMORY_LIMIT');
        break;
      }
      if (response.timedOut) {
        result.runtimeMs = Math.max(result.runtimeMs, LIMITS.runtimeMs);
        stop('TIMEOUT', 'EXECUTION_DEADLINE');
        break;
      }
      const parsed = packetSchema.safeParse(response.packet);
      if (
        !parsed.success ||
        response.exitCode !== 0 ||
        !response.cleanupVerified
      ) {
        stop('UNKNOWN', 'PROTOCOL_INVALID');
        break;
      }
      const packet = parsed.data;
      result.runtimeMs += Math.max(
        0,
        packet.runtimeMs - response.programWallMs,
      );
      result.outputBytes += packet.outputBytes;
      result.outputTruncated ||= packet.outputTruncated;
      result.evidence.cgroups.push(packet.cgroup);
      if (/^oom_kill [1-9]\d*$/m.test(packet.cgroup['memory.events'] ?? '')) {
        stop('UNKNOWN', 'MEMORY_LIMIT');
        break;
      }
      if (packet.status === 'syntax') {
        stop('SYNTAX_ERROR', 'STUDENT_SYNTAX');
        break;
      }
      if (packet.status === 'capability-gap') {
        stop('UNKNOWN', 'CAPABILITY_GAP');
        break;
      }
      if (packet.status === 'timeout' || result.runtimeMs >= LIMITS.runtimeMs) {
        stop('TIMEOUT', 'EXECUTION_DEADLINE');
        break;
      }
      if (packet.status === 'output') {
        stop('UNKNOWN', 'OUTPUT_LIMIT');
        break;
      }
      if (packet.status === 'return-limit') {
        stop('UNKNOWN', 'RETURN_LIMIT');
        break;
      }
      if (packet.status !== 'exited') {
        stop('UNKNOWN', 'RUNNER_FAILURE');
        break;
      }
      let returned: z.infer<typeof returnSchema>;
      try {
        const data = Buffer.from(packet.returnData ?? '', 'base64');
        if (data.length > LIMITS.returnBytes) throw new Error('Return limit');
        returned = returnSchema.parse(JSON.parse(data.toString('utf8')));
      } catch {
        stop('UNKNOWN', 'PROTOCOL_INVALID');
        break;
      }
      if (returned.kind === 'invalid') {
        stop('UNKNOWN', returned.reason);
        break;
      }
      if (returned.kind === 'exception') {
        stop('RUNTIME_ERROR', 'STUDENT_EXCEPTION');
        break;
      }
      if (packet.exitCode !== 0) {
        stop('UNKNOWN', 'PROTOCOL_INVALID');
        break;
      }
      const value: CaseResult = {
        id: item.id,
        passed: isDeepStrictEqual(returned.value, item.expected),
        stdout: Buffer.from(packet.stdout, 'base64').toString('utf8'),
        stderr: Buffer.from(packet.stderr, 'base64').toString('utf8'),
      };
      (item.visibility === 'visible'
        ? result.visibleTestResults
        : result.privateTestResults
      ).push(value);
    }
    if (complete) {
      result.allRequiredPassed =
        [...result.visibleTestResults, ...result.privateTestResults].length ===
          tests.length &&
        [...result.visibleTestResults, ...result.privateTestResults].every(
          (item) => item.passed,
        );
      result.diagnosisCode = result.allRequiredPassed
        ? 'SUCCESS'
        : 'FAILED_TEST';
      result.terminationReason = result.allRequiredPassed
        ? 'COMPLETED'
        : 'ASSERTION_FAILED';
    }
  } catch {
    stop(
      'UNKNOWN',
      signal?.aborted
        ? 'CANCELLED'
        : adapter.provider === 'vercel'
          ? 'PROVIDER_FAILURE'
          : 'RUNNER_FAILURE',
    );
    result.infrastructureStatus = 'FAILED';
    result.evidence.cleanupVerified = false;
  } finally {
    try {
      await adapter.close();
    } catch {
      stop('UNKNOWN', 'PROVIDER_FAILURE');
      result.infrastructureStatus = 'FAILED';
      result.evidence.cleanupVerified = false;
      result.allRequiredPassed = false;
    }
    result.lifecycleMs = performance.now() - started;
  }
  if (!complete) result.allRequiredPassed = false;
  return result;
}
export { VercelAdapter, SandboxRequestBudget } from './vercel.js';
