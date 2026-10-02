import { cpus, totalmem, freemem, loadavg } from 'node:os';

// Cumulative CPU counters allow comparison between observations. Windows does
// not implement load averages: its zeroes must not imply an idle host.
export function hostSnapshot() {
  const processors = cpus();
  return {
    observedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    logicalCpus: processors.length,
    memoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    loadAverage: process.platform === 'win32' ? null : loadavg(),
    loadAverageSupported: process.platform !== 'win32',
    cpuTimeMs: processors.reduce(
      (result, processor) => ({
        idle: result.idle + processor.times.idle,
        total:
          result.total +
          Object.values(processor.times).reduce((sum, value) => sum + value, 0),
      }),
      { idle: 0, total: 0 },
    ),
  };
}

export function startupPhaseTimings(output) {
  const phases = new Set([
    'IMPORTS_START',
    'IMPORTS_COMPLETE',
    'CONFIG_START',
    'CONFIG_COMPLETE',
    'STORAGE_PROXY_START',
    'STORAGE_PROXY_COMPLETE',
    'CREATE_APP_START',
    'APP_INIT_START',
    'APP_INIT_COMPLETE',
    'CREATE_APP_COMPLETE',
    'LISTEN_START',
    'LISTEN_COMPLETE',
    'STARTUP_FAILED',
  ]);
  return output.split(/\r?\n/).flatMap((line) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return [];
    }
    if (
      value?.event !== 'TEST_API_STARTUP' ||
      !['MATERIALS', 'EVALUATION'].includes(value.entrypoint) ||
      !phases.has(value.phase) ||
      !Number.isFinite(value.elapsedMs) ||
      value.elapsedMs < 0 ||
      !Number.isFinite(value.phaseMs) ||
      value.phaseMs < 0
    )
      return [];
    return [
      {
        entrypoint: value.entrypoint,
        phase: value.phase,
        elapsedMs: value.elapsedMs,
        phaseMs: value.phaseMs,
      },
    ];
  });
}
