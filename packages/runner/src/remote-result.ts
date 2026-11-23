import { z } from 'zod';

const elapsed = z.number().finite().nonnegative();
// Private bridge observations, never student-supplied timestamps. These are
// event-notification times, not proof of the last QuickJS instruction.
export const watchdogObservationSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    clock: z.literal('PERFORMANCE_NOW'),
    origin: z.literal('BRIDGE_INPUT_PARSED'),
    budgetMs: elapsed.max(3000),
    deadlineMs: elapsed.max(3000),
    retirementReserveMs: elapsed.max(50).optional(),
    stopDeadlineMs: elapsed.max(3000).optional(),
    launchSkipped: z.boolean().optional(),
    launchRequestedMs: elapsed,
    spawnObservedMs: elapsed.nullable(),
    timerArmedMs: elapsed,
    timerDelayMs: elapsed.max(3000),
    watchdogFiredMs: elapsed.nullable(),
    watchdogLatenessMs: elapsed.nullable(),
    killAttempts: z.number().int().nonnegative(),
    firstKillAttemptMs: elapsed.nullable(),
    lastKillAttemptMs: elapsed.nullable(),
    killCallSuccesses: z.number().int().nonnegative(),
    firstKillCallSucceededMs: elapsed.nullable(),
    lastKillCallSucceededMs: elapsed.nullable(),
    exitObservedMs: elapsed.nullable(),
    closeObservedMs: elapsed,
    lastGuestInstructionObservedMs: z.null(),
  })
  .strict()
  .superRefine((value, context) => {
    const reject = () =>
      context.addIssue({
        code: 'custom',
        message: 'Inconsistent private watchdog observation',
      });
    const stopDeadline =
      value.version === 2 ? value.stopDeadlineMs : value.deadlineMs;
    if (value.version === 2) {
      if (
        value.retirementReserveMs !== Math.min(50, value.budgetMs) ||
        value.stopDeadlineMs !==
          value.budgetMs - Math.min(50, value.budgetMs) ||
        typeof value.launchSkipped !== 'boolean'
      )
        reject();
      if (
        value.launchSkipped &&
        (value.spawnObservedMs !== null ||
          value.exitObservedMs !== null ||
          value.killAttempts !== 0 ||
          value.watchdogFiredMs === null ||
          value.timerArmedMs < (stopDeadline ?? Infinity))
      )
        reject();
    } else if (
      value.retirementReserveMs !== undefined ||
      value.stopDeadlineMs !== undefined ||
      value.launchSkipped !== undefined
    )
      reject();
    if (
      value.deadlineMs !== value.budgetMs ||
      value.timerArmedMs < value.launchRequestedMs ||
      value.timerDelayMs !==
        Math.max(0, (stopDeadline ?? NaN) - value.timerArmedMs) ||
      value.killCallSuccesses > value.killAttempts ||
      (value.watchdogFiredMs !== null &&
        value.watchdogFiredMs < value.timerArmedMs) ||
      (value.firstKillCallSucceededMs !== null &&
        value.firstKillAttemptMs !== null &&
        value.firstKillCallSucceededMs < value.firstKillAttemptMs) ||
      (value.killCallSuccesses === value.killAttempts &&
        value.lastKillCallSucceededMs !== null &&
        value.lastKillAttemptMs !== null &&
        value.lastKillCallSucceededMs < value.lastKillAttemptMs) ||
      (value.watchdogFiredMs === null) !==
        (value.watchdogLatenessMs === null) ||
      (value.watchdogFiredMs !== null &&
        value.watchdogLatenessMs !==
          Math.max(0, value.watchdogFiredMs - (stopDeadline ?? NaN)))
    )
      reject();
    for (const [count, first, last] of [
      [value.killAttempts, value.firstKillAttemptMs, value.lastKillAttemptMs],
      [
        value.killCallSuccesses,
        value.firstKillCallSucceededMs,
        value.lastKillCallSucceededMs,
      ],
    ] as const) {
      if (
        count === 0
          ? first !== null || last !== null
          : first === null || last === null || last < first
      )
        reject();
    }
    for (const time of [
      value.launchRequestedMs,
      value.spawnObservedMs,
      value.timerArmedMs,
      value.watchdogFiredMs,
      value.firstKillAttemptMs,
      value.lastKillAttemptMs,
      value.firstKillCallSucceededMs,
      value.lastKillCallSucceededMs,
      value.exitObservedMs,
    ]) {
      if (
        time !== null &&
        (time > value.closeObservedMs || time < value.launchRequestedMs)
      )
        reject();
    }
  });
export type WatchdogObservation = z.infer<typeof watchdogObservationSchema>;

const workerCostPhases = [
  'entry',
  'importsReady',
  'identityChecked',
  'inputRead',
  'wasmReady',
  'runtimeReady',
  'contextReady',
  'trustedSetupReady',
  'studentCompiled',
  'moduleEvaluated',
  'solveReturned',
  'serialized',
  'disposed',
  'workerExit',
] as const;
// Private profiling only: two distinct clocks. Worker entry excludes no work
// from the unchanged bridge parse-to-close budget, and is not physical startup.
export const caseCostObservationSchema = z
  .object({
    version: z.literal(1),
    workerClock: z.literal('PERFORMANCE_NOW'),
    workerOrigin: z.literal('NODE_PERFORMANCE_TIME_ORIGIN'),
    bridgeOrigin: z.literal('BRIDGE_INPUT_PARSED'),
    status: z.enum(['COMPLETE', 'PARTIAL', 'MISSING', 'INVALID']),
    phases: z
      .array(
        z
          .object({ phase: z.enum(workerCostPhases), atMs: elapsed.max(60000) })
          .strict(),
      )
      .max(workerCostPhases.length),
    receivedFirstMs: elapsed.nullable(),
    receivedLastMs: elapsed.nullable(),
    launchRequestedMs: elapsed,
    closeObservedMs: elapsed,
  })
  .strict()
  .superRefine((value, context) => {
    const reject = () =>
      context.addIssue({
        code: 'custom',
        message: 'Inconsistent private case cost observation',
      });
    const last = value.phases.at(-1);
    if (
      value.closeObservedMs < value.launchRequestedMs ||
      (value.receivedFirstMs === null) !== (value.receivedLastMs === null) ||
      (value.receivedFirstMs !== null &&
        (value.receivedFirstMs < value.launchRequestedMs ||
          value.receivedLastMs! < value.receivedFirstMs ||
          value.receivedLastMs! > value.closeObservedMs)) ||
      (value.status === 'COMPLETE' && last?.phase !== 'workerExit') ||
      (value.status === 'PARTIAL' && (!last || last.phase === 'workerExit')) ||
      (['MISSING', 'INVALID'].includes(value.status) &&
        value.phases.length !== 0) ||
      (value.status === 'MISSING' && value.receivedFirstMs !== null) ||
      (value.phases.length > 0 &&
        (value.phases[0]?.phase !== 'entry' || value.receivedFirstMs === null))
    )
      reject();
    for (let index = 1; index < value.phases.length; index++) {
      const previous = value.phases[index - 1]!,
        current = value.phases[index]!;
      if (
        workerCostPhases.indexOf(current.phase) <=
          workerCostPhases.indexOf(previous.phase) ||
        current.atMs < previous.atMs
      )
        reject();
    }
  });
export type CaseCostObservation = z.infer<typeof caseCostObservationSchema>;

// Validate the complete trusted envelope, not only its nested student packet.
export const capsulePacketSchema = z
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
    watchdog: watchdogObservationSchema.optional(),
    caseCost: caseCostObservationSchema.optional(),
    cgroup: z.record(z.string(), z.string().max(2000)),
  })
  .strict()
  .refine(
    (packet) =>
      !packet.watchdog || packet.runtimeMs === packet.watchdog.closeObservedMs,
    'Watchdog close observation must match bridge runtime',
  )
  .refine(
    (packet) =>
      !packet.watchdog?.launchSkipped ||
      (packet.status === 'timeout' &&
        packet.outputBytes === 0 &&
        packet.stdout === '' &&
        packet.stderr === '' &&
        !packet.outputTruncated &&
        packet.returnData === undefined &&
        packet.exitCode === null &&
        packet.signal === null),
    'Skipped launch must retain timeout without student output',
  )
  .refine(
    (packet) =>
      packet.watchdog?.version !== 2 ||
      packet.status !== 'exited' ||
      packet.runtimeMs < packet.watchdog.stopDeadlineMs!,
    'Completion cannot cross the reserved retirement deadline',
  )
  .refine(
    (packet) =>
      !packet.caseCost ||
      (packet.runtimeMs === packet.caseCost.closeObservedMs &&
        (!packet.watchdog ||
          packet.watchdog.launchRequestedMs ===
            packet.caseCost.launchRequestedMs)),
    'Case cost must preserve the bridge clock',
  );

export const remoteCapsuleResultSchema = z
  .object({
    packet: capsulePacketSchema.nullable(),
    exitCode: z.number().int().nullable(),
    oomKilled: z.boolean(),
    timedOut: z.boolean(),
    cancelled: z.boolean(),
    cleanupVerified: z.boolean(),
    programWallMs: z.number().finite().nonnegative(),
    containerWallMs: z.number().finite().nonnegative().nullable(),
    lifecycleMs: z.number().finite().nonnegative(),
    image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
