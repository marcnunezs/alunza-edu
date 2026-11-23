import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import type { ExecutionResult } from '@alunza/runner';
import { localVmContextSchema } from './local-vm-config';
import type { PracticeExecutionInput } from './execution.port';
import type { SubmissionExecutionInput } from './submission-execution.port';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const duration = z.number().finite().nonnegative().max(60000);
export const vmResourceIdentitySchema = z.strictObject({
  executionId: z.uuid(),
  creationId: z.uuid(),
  resourceId: z.uuid().nullable(),
  context: localVmContextSchema,
});
export const vmCleanupProofSchema = z.strictObject({
  kind: z.enum(['NOT_STARTED', 'RETIRED']),
  executionId: z.uuid(),
  creationId: z.uuid(),
  resourceId: z.uuid().nullable(),
  hostId: z.uuid(),
  brokerGeneration: z.uuid(),
  qemuAbsent: z.literal(true),
  overlaysAbsent: z.literal(true),
  observedAt: z.iso.datetime({ offset: true }),
});
export const vmResourceSchema = vmResourceIdentitySchema.extend({
  creationState: z.enum(['PREPARED', 'UNKNOWN', 'CONFIRMED']),
  cleanupState: z.enum(['PENDING', 'VERIFIED']),
  cleanupProof: vmCleanupProofSchema.nullable(),
  inputSha256: hash.nullable(),
});
export type VmResource = z.infer<typeof vmResourceSchema>;
export type VmResourceIdentity = z.infer<typeof vmResourceIdentitySchema>;
export type VmCleanupProof = z.infer<typeof vmCleanupProofSchema>;
const evidenceSchema = z.strictObject({
  bootId: z.uuid(),
  executionId: z.uuid(),
  creationId: z.uuid(),
  hostId: z.uuid(),
  brokerGeneration: z.uuid(),
  kitManifestSha256: hash,
  image: z.string(),
  runnerVersion: z.string(),
  qemu: z.strictObject({
    vcpus: z.literal(1),
    memoryBytes: z.literal(2147483648),
    network: z.literal(false),
  }),
  envelope: z.strictObject({
    cpuCount: z.literal(1),
    memoryMax: z.literal('2147483648'),
    swapMax: z.literal('0'),
    cpuMax: z.string().regex(/^[1-9]\d*\s+[1-9]\d*$/),
    selfGroup: z
      .string()
      .max(1000)
      .startsWith('0::/alunzasingleexecutor.slice/'),
    cgroupVersion: z.literal('2'),
    cgroupDriver: z.literal('systemd'),
  }),
  capsulesClean: z.boolean(),
  qemuReaped: z.boolean(),
  overlaysAbsent: z.boolean(),
});
const leaf = {
  'memory.max': '134217728',
  'memory.swap.max': '0',
  'pids.max': '32',
  'cpu.max': '100000 100000',
};
const same = (left: unknown, right: unknown) => {
  if (!isDeepStrictEqual(left, right))
    throw new Error('Local VM correlation mismatch');
};

export function validateCleanup(value: unknown, resource: VmResourceIdentity) {
  const parsed = z
    .strictObject({
      cleanupVerified: z.literal(true),
      resource: vmResourceIdentitySchema,
      proof: vmCleanupProofSchema,
    })
    .parse(value);
  same(parsed.resource.executionId, resource.executionId);
  same(parsed.resource.creationId, resource.creationId);
  same(parsed.resource.context, resource.context);
  if (resource.resourceId !== null)
    same(parsed.resource.resourceId, resource.resourceId);
  const proof = parsed.proof;
  same(
    [
      proof.executionId,
      proof.creationId,
      proof.resourceId,
      proof.hostId,
      proof.brokerGeneration,
    ],
    [
      resource.executionId,
      resource.creationId,
      parsed.resource.resourceId,
      resource.context.hostId,
      resource.context.brokerGeneration,
    ],
  );
  if (proof.kind === 'RETIRED' && !proof.resourceId)
    throw new Error('Local VM retirement identity absent');
  return parsed;
}

/** Validate the entire privileged reply before any public or durable projection. */
export async function validateVmExecution(
  value: unknown,
  input: PracticeExecutionInput | SubmissionExecutionInput,
  resource: VmResourceIdentity,
) {
  const runner = await import('@alunza/runner');
  const caseSchema = z.strictObject({
    id: z.string().min(1).max(100),
    passed: z.boolean(),
    stdout: z.string().max(65536),
    stderr: z.string().max(65536),
  });
  const resultSchema = z.strictObject({
    executionId: z.uuid(),
    runnerVersion: z.literal('imp-03-quickjs.13'),
    diagnosisCode: z.enum([
      'SUCCESS',
      'SYNTAX_ERROR',
      'RUNTIME_ERROR',
      'FAILED_TEST',
      'TIMEOUT',
      'UNKNOWN',
    ]),
    terminationReason: z.enum([
      'COMPLETED',
      'STUDENT_SYNTAX',
      'STUDENT_EXCEPTION',
      'ASSERTION_FAILED',
      'EXECUTION_DEADLINE',
      'MEMORY_LIMIT',
      'OUTPUT_LIMIT',
      'RETURN_LIMIT',
      'PROTOCOL_INVALID',
      'RUNNER_FAILURE',
      'PROVIDER_FAILURE',
      'CAPABILITY_GAP',
      'CANCELLED',
    ]),
    infrastructureStatus: z.enum(['OK', 'FAILED']),
    allRequiredPassed: z.boolean(),
    visibleTestResults: z.array(caseSchema).max(8),
    privateTestResults: z.array(caseSchema).max(8),
    hiddenRequiredCount: z.number().int().min(0).max(8),
    outputTruncated: z.boolean(),
    outputBytes: z.number().int().min(0).max(65536),
    runtimeMs: duration,
    lifecycleMs: duration,
    evidence: z.strictObject({
      provider: z.literal('docker'),
      image: z.string().nullable(),
      cleanupVerified: z.boolean(),
      cgroups: z
        .array(z.record(z.string().max(100), z.string().max(2000)))
        .max(8),
      invocationAuthenticity: z.literal('QUICKJS_SYNC_CALL'),
      engine: z.literal('quickjs-wasm-release-sync@0.32.0'),
      bridgeUid: z.literal(0),
      bridgeCapabilities: z
        .array(z.enum(['CAP_KILL', 'CAP_SETUID', 'CAP_SETGID', 'CAP_SETPCAP']))
        .length(4),
      studentUid: z.literal(10001),
      studentCapabilities: z.literal('ZERO_REQUIRED'),
      bridgeCountsAgainstMemory: z.literal(true),
      oomObserved: z.boolean(),
      hostDeadlineObserved: z.boolean(),
      hostProgramWallMs: duration,
      timings: z
        .array(
          z.strictObject({
            hostStartAttachMs: duration,
            containerWallMs: duration.nullable(),
            supervisorProcessMs: duration.nullable(),
            budgetMs: z.number().finite().nonnegative().max(3000),
            watchdog: runner.watchdogObservationSchema.nullable(),
            caseCost: runner.caseCostObservationSchema.nullable(),
          }),
        )
        .max(8),
    }),
  });
  const parsed = z
    .strictObject({
      result: resultSchema,
      resource: vmResourceIdentitySchema,
      cleanupVerified: z.boolean(),
      vmEvidence: evidenceSchema,
    })
    .parse(value);
  same(parsed.resource, resource);
  const vm = parsed.vmEvidence,
    result = parsed.result;
  const [quota, period] = vm.envelope.cpuMax.split(/\s+/).map(Number);
  if (
    quota === undefined ||
    period === undefined ||
    !Number.isSafeInteger(quota) ||
    !Number.isSafeInteger(period) ||
    quota > period
  )
    throw new Error('Local VM ancestor CPU limit invalid');
  same(
    [
      vm.executionId,
      vm.creationId,
      vm.bootId,
      vm.hostId,
      vm.brokerGeneration,
      vm.kitManifestSha256,
      vm.image,
      vm.runnerVersion,
    ],
    [
      resource.executionId,
      resource.creationId,
      resource.resourceId,
      resource.context.hostId,
      resource.context.brokerGeneration,
      resource.context.kitManifestSha256,
      resource.context.image,
      resource.context.runnerVersion,
    ],
  );
  same(
    [result.executionId, result.runnerVersion],
    [input.executionId, resource.context.runnerVersion],
  );
  if (result.evidence.image !== null)
    same(result.evidence.image, resource.context.image);
  same(result.evidence.cleanupVerified, vm.capsulesClean);
  same(
    parsed.cleanupVerified,
    vm.capsulesClean && vm.qemuReaped && vm.overlaysAbsent,
  );
  if (new Set(result.evidence.bridgeCapabilities).size !== 4)
    throw new Error('Local VM capability evidence invalid');
  for (const group of result.evidence.cgroups)
    for (const [key, expected] of Object.entries(leaf))
      same(group[key], expected);
  const expectedHidden = input.tests.filter(
    (test) => test.visibility === 'hidden',
  );
  same(result.hiddenRequiredCount, expectedHidden.length);
  const cases = [...result.visibleTestResults, ...result.privateTestResults];
  if (
    result.evidence.timings.length > input.tests.length ||
    result.evidence.cgroups.length > result.evidence.timings.length ||
    cases.length !== result.evidence.cgroups.length
  )
    throw new Error('Local VM evidence cardinality invalid');
  if (
    new Set(cases.map((test) => test.id)).size !== cases.length ||
    cases.length > input.tests.length
  )
    throw new Error('Local VM case identities invalid');
  for (const [values, visibility] of [
    [result.visibleTestResults, 'visible'],
    [result.privateTestResults, 'hidden'],
  ] as const)
    if (
      !values.every(
        (test, index) =>
          input.tests.filter((expected) => expected.visibility === visibility)[
            index
          ]?.id === test.id,
      )
    )
      throw new Error('Local VM case scope invalid');
  // Raw capture remains <=64KiB; UTF-8 display may include replacement bytes.
  if (
    cases.reduce(
      (sum, test) =>
        sum + Buffer.byteLength(test.stdout) + Buffer.byteLength(test.stderr),
      0,
    ) >
    result.outputBytes + 6 * cases.length
  )
    throw new Error('Local VM output accounting invalid');
  let elapsed = 0;
  for (const [index, timing] of result.evidence.timings.entries()) {
    same(timing.budgetMs, 3000 - elapsed);
    if (
      index < result.evidence.cgroups.length &&
      timing.supervisorProcessMs !== null
    )
      elapsed += timing.supervisorProcessMs;
    if (timing.watchdog) {
      same(
        [
          timing.watchdog.version,
          timing.watchdog.budgetMs,
          timing.watchdog.closeObservedMs,
        ],
        [2, timing.budgetMs, timing.supervisorProcessMs],
      );
    }
    if (timing.caseCost)
      same(timing.caseCost.closeObservedMs, timing.supervisorProcessMs);
  }
  if (!(
    result.evidence.hostDeadlineObserved && result.diagnosisCode === 'TIMEOUT'
  ))
    same(result.runtimeMs, elapsed);
  const complete = ['SUCCESS', 'FAILED_TEST'].includes(result.diagnosisCode);
  if (complete) {
    same(result.evidence.image, resource.context.image);
    same(cases.length, input.tests.length);
    same(result.evidence.timings.length, input.tests.length);
    same(result.evidence.cgroups.length, input.tests.length);
    if (
      result.runtimeMs >= 3000 ||
      result.outputTruncated ||
      !result.evidence.cleanupVerified ||
      result.infrastructureStatus !== 'OK' ||
      result.evidence.timings.some(
        (timing) =>
          timing.supervisorProcessMs === null ||
          !timing.watchdog ||
          timing.watchdog.launchSkipped ||
          timing.supervisorProcessMs >= timing.watchdog.stopDeadlineMs!,
      )
    )
      throw new Error('Local VM completion evidence invalid');
  }
  same(
    result.allRequiredPassed,
    complete && cases.every((test) => test.passed),
  );
  same(result.diagnosisCode === 'SUCCESS', result.allRequiredPassed);
  const causes = {
    SUCCESS: 'COMPLETED',
    FAILED_TEST: 'ASSERTION_FAILED',
    SYNTAX_ERROR: 'STUDENT_SYNTAX',
    RUNTIME_ERROR: 'STUDENT_EXCEPTION',
    TIMEOUT: 'EXECUTION_DEADLINE',
  } as const;
  if (result.diagnosisCode !== 'UNKNOWN')
    same(result.terminationReason, causes[result.diagnosisCode]);
  else if (
    Object.values(causes).includes(
      result.terminationReason as (typeof causes)[keyof typeof causes],
    )
  )
    throw new Error('Local VM terminal cause inconsistent');
  if (result.diagnosisCode === 'SUCCESS')
    same(result.terminationReason, 'COMPLETED');
  if (result.diagnosisCode === 'FAILED_TEST')
    same(result.terminationReason, 'ASSERTION_FAILED');
  return { ...parsed, result: result as ExecutionResult };
}
