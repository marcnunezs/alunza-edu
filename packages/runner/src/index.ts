import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import {
  capsulePacketSchema as packetSchema,
  type WatchdogObservation,
  type CaseCostObservation,
} from './remote-result.js';
import {
  imageIdentity,
  runCapsule,
  inspectConfiguredDocker,
} from '../../../infra/runner/capsule.mjs';
import type {
  DockerRuntimeConfig,
  DockerRuntimeIdentity,
  PreparedDockerContext,
} from './docker-prepared.js';
import type { TimingObserver } from '../../../infra/runner/capsule.mjs';
import {
  measureTiming,
  observeDuration,
} from '../../../infra/runner/timing.mjs';
export type {
  TimingEvent,
  TimingObserver,
} from '../../../infra/runner/capsule.mjs';
export type {
  DockerRuntimeConfig,
  DockerRuntimeIdentity,
  PreparedDockerContext,
  DockerPreparedSlot,
  DockerPreparedPair,
  DockerCleanupEvidence,
  DockerPreparedResourcePort,
  DockerExecutionAuthority,
  DockerPreparedPoolContract,
} from './docker-prepared.js';
export { DockerPreparedPool } from './docker-prepared.js';

export const RUNNER_VERSION = 'imp-03-quickjs.13';
export async function inspectDockerRunner(
  config: DockerRuntimeConfig,
  signal?: AbortSignal,
): Promise<{ available: boolean; context: PreparedDockerContext | null }> {
  const result = await inspectConfiguredDocker(config, signal);
  return result.available && result.image && result.runtime
    ? {
        available: true,
        context: Object.freeze({
          provider: 'docker',
          image: result.image,
          runnerVersion: RUNNER_VERSION,
          ...result.runtime,
        }),
      }
    : { available: false, context: null };
}
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
  executionId: string;
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
  private readonly admittedImage?: string;
  private readonly observeTiming?: TimingObserver;
  private readonly runtime?: DockerRuntimeIdentity;
  private readonly beforeSend?: () => Promise<void>;
  private readonly deadlineMs?: number;
  private kernelBoundary?: string;
  constructor(
    options: {
      image?: string;
      observeTiming?: TimingObserver;
      runtime?: DockerRuntimeIdentity;
      beforeSend?: () => Promise<void>;
      deadlineMs?: number;
      expectedBoundary?: string;
    } = {},
  ) {
    if (
      options.image !== undefined &&
      !/^sha256:[a-f0-9]{64}$/.test(options.image)
    )
      throw new Error('Runner requires immutable local image ID');
    // The API may pin the immutable image already inspected during this
    // admission. This instance belongs to one execution; no cross-request TTL.
    this.admittedImage = options.image;
    this.observeTiming = options.observeTiming;
    this.runtime = options.runtime;
    this.beforeSend = options.beforeSend;
    this.deadlineMs = options.deadlineMs;
    this.kernelBoundary = options.expectedBoundary;
  }
  async execute(input: CapsuleInput, signal?: AbortSignal) {
    this.image ??= await measureTiming(
      this.observeTiming,
      'imageResolve',
      async () => this.admittedImage ?? imageIdentity(undefined, signal),
    );
    const response = await runCapsule(input, {
      image: this.image,
      signal,
      observeTiming: this.observeTiming,
      runtime: this.runtime,
      beforeSend: this.beforeSend,
      deadlineMs: this.deadlineMs,
      expectedBoundary: this.kernelBoundary,
    });
    // One adapter belongs to one attempt. Bind every cold case to the same
    // observed executor envelope, including fallback after a prepared pair.
    this.kernelBoundary ??= response.kernelBoundary;
    if (this.observeTiming) {
      observeDuration(
        this.observeTiming,
        'hostStartAttach',
        response.programWallMs,
      );
      if (response.containerWallMs !== null)
        observeDuration(
          this.observeTiming,
          'containerWall',
          response.containerWallMs,
        );
      const parsed = packetSchema.safeParse(response.packet);
      if (parsed.success)
        observeDuration(
          this.observeTiming,
          'supervisor',
          parsed.data.runtimeMs,
        );
    }
    return response;
  }
  async close() {
    /* Every capsule is removed in runCapsule finally. */
  }
}
const returnSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('value'),
      value: json,
      invocation: z.literal('QUICKJS_SYNC_CALL'),
    })
    .strict(),
  z.object({ kind: z.literal('syntax') }).strict(),
  z.object({ kind: z.literal('exception') }).strict(),
  z
    .object({
      kind: z.literal('invalid'),
      reason: z.enum([
        'RETURN_LIMIT',
        'CAPABILITY_GAP',
        'OUTPUT_LIMIT',
        'EXECUTION_DEADLINE',
        'RUNNER_FAILURE',
      ]),
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
    invocationAuthenticity: 'QUICKJS_SYNC_CALL';
    engine: 'quickjs-wasm-release-sync@0.32.0';
    bridgeUid: 0;
    bridgeCapabilities: string[];
    studentUid: 10001;
    studentCapabilities: 'ZERO_REQUIRED';
    bridgeCountsAgainstMemory: true;
    oomObserved: boolean;
    hostDeadlineObserved: boolean;
    hostProgramWallMs: number;
    timings: {
      hostStartAttachMs: number;
      containerWallMs: number | null;
      supervisorProcessMs: number | null;
      budgetMs: number;
      watchdog: WatchdogObservation | null;
      caseCost: CaseCostObservation | null;
    }[];
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
  signal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
    : AbortSignal.timeout(30000);
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
      invocationAuthenticity: 'QUICKJS_SYNC_CALL',
      engine: 'quickjs-wasm-release-sync@0.32.0',
      bridgeUid: 0,
      bridgeCapabilities: [
        'CAP_KILL',
        'CAP_SETUID',
        'CAP_SETGID',
        'CAP_SETPCAP',
      ],
      studentUid: 10001,
      studentCapabilities: 'ZERO_REQUIRED',
      bridgeCountsAgainstMemory: true,
      oomObserved: false,
      hostDeadlineObserved: false,
      hostProgramWallMs: 0,
      timings: [],
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
          executionId: input.executionId,
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
      const parsed = packetSchema.safeParse(response.packet);
      result.evidence.timings.push({
        hostStartAttachMs: response.programWallMs,
        containerWallMs: response.containerWallMs ?? null,
        supervisorProcessMs: parsed.success ? parsed.data.runtimeMs : null,
        budgetMs: LIMITS.runtimeMs - result.runtimeMs,
        watchdog: parsed.success ? (parsed.data.watchdog ?? null) : null,
        caseCost: parsed.success ? (parsed.data.caseCost ?? null) : null,
      });
      if (
        !Number.isFinite(response.programWallMs) ||
        response.programWallMs < 0
      ) {
        stop('UNKNOWN', 'PROTOCOL_INVALID');
        break;
      }
      result.evidence.hostProgramWallMs += response.programWallMs;
      if (response.cancelled) {
        stop('UNKNOWN', 'CANCELLED');
        break;
      }
      if (response.timedOut && !response.oomKilled) {
        result.runtimeMs = Math.max(result.runtimeMs, LIMITS.runtimeMs);
        stop('TIMEOUT', 'EXECUTION_DEADLINE');
        break;
      }
      if (
        !parsed.success ||
        response.exitCode !== 0 ||
        !response.cleanupVerified
      ) {
        // OOM can kill the bridge before a complete, verified packet exists.
        // Preserve that cause without inventing its time, output or cgroups.
        stop(
          'UNKNOWN',
          response.oomKilled ? 'MEMORY_LIMIT' : 'PROTOCOL_INVALID',
        );
        break;
      }
      const packet = parsed.data;
      if (
        packet.cgroup['memory.max'] !== String(LIMITS.memoryBytes) ||
        packet.cgroup['memory.swap.max'] !== '0' ||
        packet.cgroup['pids.max'] !== '32' ||
        packet.cgroup['cpu.max'] !== '100000 100000'
      ) {
        stop('UNKNOWN', response.oomKilled ? 'MEMORY_LIMIT' : 'CAPABILITY_GAP');
        break;
      }
      const stdoutBytes = Buffer.from(packet.stdout, 'base64');
      const stderrBytes = Buffer.from(packet.stderr, 'base64');
      if (
        stdoutBytes.toString('base64') !== packet.stdout ||
        stderrBytes.toString('base64') !== packet.stderr ||
        stdoutBytes.length + stderrBytes.length !== packet.outputBytes ||
        result.outputBytes + packet.outputBytes > LIMITS.outputBytes
      ) {
        stop(
          'UNKNOWN',
          response.oomKilled ? 'MEMORY_LIMIT' : 'PROTOCOL_INVALID',
        );
        break;
      }
      // A surviving bridge may report a complete packet despite Engine OOMKilled.
      // Account verified evidence exactly once before selecting the terminal cause.
      result.runtimeMs += packet.runtimeMs;
      result.outputBytes += packet.outputBytes;
      result.outputTruncated ||= packet.outputTruncated;
      result.evidence.cgroups.push(packet.cgroup);
      // Keep bounded console output even if this case throws or reaches a limit.
      // write() omits an incomplete trailing UTF-8 sequence instead of expanding
      // it into a replacement character beyond the captured byte budget.
      const value: CaseResult = {
        id: item.id,
        passed: false,
        stdout: new StringDecoder('utf8').write(stdoutBytes),
        stderr: new StringDecoder('utf8').write(stderrBytes),
      };
      (item.visibility === 'visible'
        ? result.visibleTestResults
        : result.privateTestResults
      ).push(value);
      if (
        response.oomKilled ||
        /^oom_kill [1-9]\d*$/m.test(packet.cgroup['memory.events'] ?? '')
      ) {
        result.evidence.oomObserved = true;
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
        if (returned.reason === 'OUTPUT_LIMIT') result.outputTruncated = true;
        stop(
          returned.reason === 'EXECUTION_DEADLINE' ? 'TIMEOUT' : 'UNKNOWN',
          returned.reason,
        );
        break;
      }
      if (returned.kind === 'syntax') {
        stop('SYNTAX_ERROR', 'STUDENT_SYNTAX');
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
      value.passed = isDeepStrictEqual(returned.value, item.expected);
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
export {
  VercelAdapter,
  SandboxRequestBudget,
  recoverVercelSandbox,
} from './vercel.js';
export type {
  VercelOptions,
  VercelRecoveryOptions,
  VercelEvidence,
  RemoteDriverCommandEvidence,
  SandboxCorrelation,
  SandboxResource,
  SandboxNaturalTimeoutObservation,
} from './vercel.js';
export {
  getDockerEngineId,
  getDockerAvailability,
  cleanupDockerExecution,
  sweepExpiredDockerExecutions,
} from '../../../infra/runner/capsule.mjs';
export const runExecution = execute;
export {
  watchdogObservationSchema,
  caseCostObservationSchema,
} from './remote-result.js';
