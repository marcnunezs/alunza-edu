// Private observations made by the trusted bridge. Every timestamp is an offset
// from the bridge's performance.now() immediately after parsing capsule input.
// spawn/exit/close are notification times, not proof of a last guest instruction.
function createWatchdogObservation({ now, originMs, budgetMs }) {
  const budget = Math.max(0, Math.min(3000, budgetMs));
  // Trusted retirement policy inside the supplied remaining attempt budget.
  // This reserve is an engineering margin, not a hard-real-time guarantee.
  const retirementReserveMs = Math.min(50, budget);
  const state = {
    version: 2,
    clock: 'PERFORMANCE_NOW',
    origin: 'BRIDGE_INPUT_PARSED',
    budgetMs: budget,
    deadlineMs: budget,
    retirementReserveMs,
    stopDeadlineMs: budget - retirementReserveMs,
    launchSkipped: false,
    launchRequestedMs: null,
    spawnObservedMs: null,
    timerArmedMs: null,
    timerDelayMs: null,
    watchdogFiredMs: null,
    watchdogLatenessMs: null,
    killAttempts: 0,
    firstKillAttemptMs: null,
    lastKillAttemptMs: null,
    killCallSuccesses: 0,
    firstKillCallSucceededMs: null,
    lastKillCallSucceededMs: null,
    exitObservedMs: null,
    closeObservedMs: null,
    lastGuestInstructionObservedMs: null,
  };
  const elapsed = () => now() - originMs;
  const first = (key) => {
    if (state[key] === null) state[key] = elapsed();
    return state[key];
  };
  return {
    stopDue() {
      return elapsed() >= state.stopDeadlineMs;
    },
    skipLaunch() {
      state.launchSkipped = true;
    },
    launchRequested() {
      first('launchRequestedMs');
    },
    spawned() {
      first('spawnObservedMs');
    },
    arm() {
      // Charge setup and reserve retirement within the same cumulative budget.
      first('timerArmedMs');
      state.timerDelayMs = Math.max(
        0,
        state.stopDeadlineMs - state.timerArmedMs,
      );
      return state.timerDelayMs;
    },
    fired() {
      first('watchdogFiredMs');
      state.watchdogLatenessMs = Math.max(
        0,
        state.watchdogFiredMs - state.stopDeadlineMs,
      );
    },
    killAttempt() {
      const at = elapsed();
      state.killAttempts++;
      state.firstKillAttemptMs ??= at;
      state.lastKillAttemptMs = at;
    },
    killCallSucceeded() {
      // Successful process.kill(SIGKILL) return, not confirmation that every
      // descendant has exited. Cleanup must still verify the whole group.
      const at = elapsed();
      state.killCallSuccesses++;
      state.firstKillCallSucceededMs ??= at;
      state.lastKillCallSucceededMs = at;
    },
    exited() {
      first('exitObservedMs');
    },
    closed() {
      return first('closeObservedMs');
    },
    snapshot() {
      return { ...state };
    },
  };
}

// Fixed trusted-worker metadata only. These offsets use the worker's own Node
// performance origin; they must never be subtracted from the bridge's clock.
const workerCostPhases = Object.freeze([
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
]);
function createWorkerCostRecorder({ now, write }) {
  let last = -1,
    previous = 0,
    disabled = false;
  return {
    mark(phase) {
      if (disabled) return;
      try {
        const index = workerCostPhases.indexOf(phase),
          atMs = now();
        if (
          index <= last ||
          index < 0 ||
          (last < 0 && index !== 0) ||
          !Number.isFinite(atMs) ||
          atMs < previous ||
          atMs > 60000
        ) {
          disabled = true;
          return;
        }
        last = index;
        previous = atMs;
        // One small atomic pipe write per phase also survives a later SIGKILL.
        write(4, JSON.stringify({ phase, atMs }) + '\n');
      } catch {
        // Swallow only observer I/O/validation errors. Profiling work still
        // consumes the unchanged deadline and can affect timing or timeout.
        disabled = true;
      }
    },
    flush() {
      this.mark('workerExit');
    },
  };
}

function createCaseCostObservation({ now, originMs, launchRequestedMs }) {
  let buffer = '',
    bytes = 0,
    invalid = false,
    first = null,
    last = null;
  const phases = [];
  return {
    receive(chunk) {
      if (invalid) return;
      const received = now() - originMs;
      first ??= received;
      last = received;
      bytes += chunk.length;
      if (bytes > 4096) {
        invalid = true;
        buffer = '';
        return;
      }
      buffer += chunk.toString('utf8');
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const item = JSON.parse(line),
            index = workerCostPhases.indexOf(item.phase);
          const previous = phases.at(-1);
          if (
            Object.keys(item).sort().join(',') !== 'atMs,phase' ||
            index < 0 ||
            (previous
              ? index <= workerCostPhases.indexOf(previous.phase)
              : index !== 0) ||
            !Number.isFinite(item.atMs) ||
            item.atMs < (previous?.atMs ?? 0) ||
            item.atMs > 60000
          )
            throw new Error('Invalid private worker phase');
          phases.push({ phase: item.phase, atMs: item.atMs });
        } catch {
          invalid = true;
          buffer = '';
          break;
        }
      }
    },
    snapshot(closeObservedMs) {
      const rejected = invalid || buffer.length > 0;
      return {
        version: 1,
        workerClock: 'PERFORMANCE_NOW',
        workerOrigin: 'NODE_PERFORMANCE_TIME_ORIGIN',
        bridgeOrigin: 'BRIDGE_INPUT_PARSED',
        status: rejected
          ? 'INVALID'
          : phases.at(-1)?.phase === 'workerExit'
            ? 'COMPLETE'
            : phases.length
              ? 'PARTIAL'
              : 'MISSING',
        phases: rejected ? [] : phases.map((item) => ({ ...item })),
        receivedFirstMs: first,
        receivedLastMs: last,
        launchRequestedMs,
        closeObservedMs,
      };
    },
  };
}

module.exports = {
  createWatchdogObservation,
  workerCostPhases,
  createWorkerCostRecorder,
  createCaseCostObservation,
};
