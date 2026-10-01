import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  execute,
  DockerAdapter,
  VercelAdapter,
  SandboxRequestBudget,
  publicResult,
  LIMITS,
  RUNNER_VERSION,
} from '../packages/runner/dist/index.js';
import { runnerFixtures } from '../tests/runner/fixtures.mjs';
import {
  collectExpired,
  command,
  imageIdentity,
} from '../infra/runner/capsule.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
class PendingError extends Error {}
// Observe this fixed heap fixture without inferring cgroup OOM from exit/stderr.
class HeapObservationAdapter extends DockerAdapter {
  terminationObservation;
  async execute(input, signal) {
    const response = await super.execute(input, signal);
    const packet = response.packet;
    const match = packet?.cgroup?.['memory.events']?.match(/^oom_kill (\d+)$/m);
    const stderr =
      typeof packet?.stderr === 'string'
        ? Buffer.from(packet.stderr, 'base64').toString('utf8')
        : '';
    this.terminationObservation = {
      source: 'FIXED_JS_ARRAY_FIXTURE_PROCESS_AND_CGROUP_OBSERVATIONS',
      packetAvailable: packet !== null,
      capsuleExitCode: response.exitCode,
      studentExitCode: Number.isInteger(packet?.exitCode)
        ? packet.exitCode
        : null,
      studentSignal: ['SIGABRT', 'SIGKILL', 'SIGTERM', 'SIGSEGV'].includes(
        packet?.signal,
      )
        ? packet.signal
        : null,
      dockerOomKilled: response.oomKilled,
      oomKillEvents: match ? Number(match[1]) : null,
      v8HeapLimitMessageObserved:
        /FATAL ERROR:.*(?:heap out of memory|Reached heap limit|Ineffective mark-compacts)/i.test(
          stderr,
        ),
    };
    return response;
  }
}
let pendingProvider = 'docker';
let remoteRequests = 0;
function observation(kind, result) {
  if (!kind) return undefined;
  let data;
  try {
    data = JSON.parse(result.visibleTestResults[0]?.stdout ?? '');
  } catch {
    return { status: 'NO_OBSERVATION' };
  }
  if (kind === 'processes') {
    const numbers = [
      'attempted',
      'started',
      'eagain',
      'unexpectedErrors',
      'pidsMax',
      'pidsCurrent',
      'uid',
    ];
    if (
      !numbers.every(
        (key) =>
          Number.isInteger(data[key]) && data[key] >= 0 && data[key] <= 10001,
      ) ||
      typeof data.identitiesValid !== 'boolean'
    )
      return { status: 'INVALID_OBSERVATION' };
    return {
      ...Object.fromEntries(numbers.map((key) => [key, data[key]])),
      identitiesValid: data.identitiesValid,
      source: 'FIXED_FIXTURE_KERNEL_READBACK',
    };
  }
  const codes = [
    'ENETUNREACH',
    'EHOSTUNREACH',
    'EACCES',
    'EPERM',
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEOUT',
    'EAI_AGAIN',
    'PROBE_TIMEOUT',
    'UNEXPECTED_SUCCESS',
  ];
  if (
    !['dns', 'ipv6', 'udp'].every((key) => codes.includes(data[key])) ||
    typeof data.loopbackOnly !== 'boolean'
  )
    return { status: 'INVALID_OBSERVATION' };
  return {
    dns: data.dns,
    ipv6: data.ipv6,
    udp: data.udp,
    loopbackOnly: data.loopbackOnly,
    source: 'FIXED_FIXTURE_SYSCALL_RESULTS',
  };
}
async function probeReaper() {
  const image = await imageIdentity();
  const owned = `alunza-runner-${randomUUID()}`;
  const current = `alunza-runner-${randomUUID()}`;
  const foreign = `alunza-reaper-control-${randomUUID()}`;
  const created = [];
  let result;
  try {
    for (const [name, owner, expires] of [
      [owned, 'imp-00-06', Date.now() - 1000],
      [current, 'imp-00-06', Date.now() + 60000],
      [foreign, 'reaper-control', Date.now() - 1000],
    ]) {
      const response = await command([
        'run',
        '--detach',
        '--name',
        name,
        '--label',
        `org.alunza.runner=${owner}`,
        '--label',
        `org.alunza.expires=${expires}`,
        '--network=none',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true',
        '--user=10001:10001',
        '--memory=134217728',
        '--memory-swap=134217728',
        '--cpus=1',
        '--pids-limit=32',
        '--log-driver=none',
        '--entrypoint=/bin/sleep',
        image,
        '30',
      ]);
      if (response.code !== 0)
        throw new Error('Reaper fixture creation failed');
      created.push(name);
    }
    const before = await command([
      'inspect',
      owned,
      '--format',
      '{{.State.Running}}',
    ]);
    const removed = await collectExpired();
    const expired = await command(['inspect', owned]);
    const fresh = await command([
      'inspect',
      current,
      '--format',
      '{{.State.Running}}',
    ]);
    const unrelated = await command([
      'inspect',
      foreign,
      '--format',
      '{{.State.Running}}',
    ]);
    const pass =
      before.stdout.trim() === 'true' &&
      removed === 1 &&
      expired.code !== 0 &&
      fresh.stdout.trim() === 'true' &&
      unrelated.stdout.trim() === 'true';
    result = {
      id: 'expired-owned-orphan',
      status: pass ? 'PASS' : 'FAIL',
      removed,
      expiredWasRunning: before.stdout.trim() === 'true',
      expiredRemoved: expired.code !== 0,
      freshPreserved: fresh.stdout.trim() === 'true',
      unrelatedPreserved: unrelated.stdout.trim() === 'true',
    };
  } finally {
    for (const name of created) {
      const remaining = await command(['inspect', name]);
      if (
        remaining.code === 0 &&
        (await command(['rm', '--force', name])).code !== 0
      )
        result = {
          id: 'expired-owned-orphan',
          status: 'FAIL',
          cleanupFailed: true,
        };
    }
  }
  return result;
}
async function main() {
  const args = process.argv.slice(2);
  const provider = args.includes('--adapter')
    ? args[args.indexOf('--adapter') + 1]
    : 'docker';
  if (!['docker', 'vercel'].includes(provider))
    throw new PendingError('ADAPTER_CONFIGURATION_REQUIRED');
  pendingProvider = provider;
  const acceptanceOnly = args.includes('--acceptance-only');
  if (acceptanceOnly && provider !== 'docker')
    throw new PendingError('FOCAL_PROBE_IS_LOCAL_ONLY');
  let manifest,
    authorization,
    remoteOptions,
    deadline = Infinity;
  if (provider === 'vercel') {
    const { loadManifest, assertRemoteAuthorization } =
      await import('./preprod-manifest.mjs');
    const path = args[args.indexOf('--manifest') + 1];
    if (!args.includes('--manifest') || !path)
      throw new PendingError('APPROVED_MANIFEST_REQUIRED');
    try {
      manifest = await loadManifest(path);
      authorization = assertRemoteAuthorization(manifest, 'probe:sandbox');
    } catch {
      throw new PendingError('REMOTE_AUTHORIZATION_REQUIRED');
    }
    deadline = Math.min(
      Date.parse(manifest.remote.expiresAt),
      Date.now() + manifest.budget.maxDurationSeconds * 1000,
    );
    if (manifest.budget.maxHttpRequests < 10)
      throw new PendingError('CLEANUP_REQUEST_BUDGET_REQUIRED');
    if (manifest.budget.maxSandboxRuns !== 1)
      throw new PendingError('THIS_PROBE_REQUIRES_EXACTLY_ONE_SANDBOX');
    const requestBudget = new SandboxRequestBudget(
      manifest.budget.maxHttpRequests,
      deadline,
    );
    const { teamId, projectId, region } = manifest.targets.sandbox;
    remoteOptions = {
      authorized: true,
      expiresAtMs: deadline,
      token: process.env.VERCEL_TOKEN,
      teamId,
      projectId,
      region,
      image: process.env.RUNNER_SANDBOX_IMAGE,
      allowRequest(cleanup) {
        requestBudget.consume(cleanup);
        remoteRequests = requestBudget.requests;
      },
    };
    if (
      !process.env.VERCEL_TOKEN ||
      !process.env.RUNNER_SANDBOX_IMAGE ||
      !teamId ||
      !projectId ||
      !region
    )
      throw new PendingError('REMOTE_CONFIGURATION_REQUIRED');
    if (manifest.targets.sandbox.image !== process.env.RUNNER_SANDBOX_IMAGE)
      throw new PendingError('APPROVED_IMAGE_REQUIRED');
  } else {
    try {
      const checked = await command(['info', '--format', '{{json .}}']);
      if (checked.code !== 0) throw new Error('Docker unavailable');
      const info = JSON.parse(checked.stdout);
      if (
        info.OSType !== 'linux' ||
        info.CgroupVersion !== '2' ||
        !info.MemoryLimit ||
        !info.SwapLimit ||
        !info.PidsLimit
      )
        throw new Error('Docker controllers unavailable');
      await imageIdentity();
      await collectExpired();
    } catch {
      throw new PendingError('DOCKER_AND_PREPARED_IMAGE_REQUIRED');
    }
  }
  const report = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    provider,
    runnerVersion: RUNNER_VERSION,
    limits: LIMITS,
    remote: provider === 'vercel' ? 'AUTHORIZED_ATTEMPT' : 'NOT_RUN',
    acceptance: 'EXPERIMENTAL_ONLY',
    knownLimits: [
      'Return producer can forge data; invocation authenticity unproven',
      'Trusted bridge UID0 retains SETUID/SETGID/SETPCAP; student must have zero capabilities',
      'Bridge memory counts within128MiB',
      'Kernel transient memory overshoot and kill scheduling latency',
      'No full-flow p95 or business RF acceptance',
    ],
    cases: [],
  };
  const maxRuns =
    provider === 'vercel'
      ? manifest.budget.maxSandboxRuns
      : runnerFixtures.length;
  const selected = acceptanceOnly
    ? runnerFixtures.filter((item) =>
        ['bounded-processes', 'blocked-dns-ipv6-udp'].includes(item.id),
      )
    : runnerFixtures.slice(0, maxRuns);
  let failures = 0;
  const runFixture = async (fixture, adapter, signal) =>
    execute(
      {
        executionId: randomUUID(),
        requestId: 'imp-00-06-probe',
        exerciseVersionId: 'synthetic-v1',
        testsVersion: 'synthetic-v1',
        mode: fixture.mode ?? 'RUN',
        entrypoint: 'solve',
        code: fixture.code,
        tests: fixture.tests,
      },
      adapter,
      signal,
    );
  for (const fixture of selected) {
    if (Date.now() >= deadline) {
      failures++;
      break;
    }
    if (provider === 'vercel') {
      const { assertRemoteAuthorization } =
        await import('./preprod-manifest.mjs');
      authorization = assertRemoteAuthorization(manifest, 'probe:sandbox');
    }
    const adapter =
      provider === 'docker'
        ? fixture.observeTermination
          ? new HeapObservationAdapter()
          : new DockerAdapter()
        : new VercelAdapter(remoteOptions);
    const result = await runFixture(
      fixture,
      adapter,
      provider === 'vercel'
        ? AbortSignal.timeout(Math.max(1, deadline - Date.now()))
        : undefined,
    );
    const publicJson = JSON.stringify(publicResult(result));
    const correct =
      result.diagnosisCode === fixture.expected &&
      (!fixture.reason || fixture.reason === result.terminationReason) &&
      result.evidence.cleanupVerified &&
      (!fixture.observeTermination ||
        adapter.terminationObservation?.dockerOomKilled ||
        adapter.terminationObservation?.oomKillEvents > 0 ||
        (adapter.terminationObservation?.studentSignal === 'SIGABRT' &&
          adapter.terminationObservation?.v8HeapLimitMessageObserved)) &&
      (!fixture.privateSentinel ||
        !publicJson.includes(fixture.privateSentinel));
    if (!correct) failures++;
    const outcome = {
      id: fixture.id,
      status: correct ? (fixture.knownGap ? 'KNOWN_GAP' : 'PASS') : 'FAIL',
      diagnosis: result.diagnosisCode,
      reason: result.terminationReason,
      runtimeMs: Math.round(result.runtimeMs),
      lifecycleMs: Math.round(result.lifecycleMs),
      outputBytes: result.outputBytes,
      outputTruncated: result.outputTruncated,
      evidence: result.evidence,
      ...(fixture.observeTermination
        ? {
            terminationObservation: adapter.terminationObservation ?? {
              status: 'NOT_OBSERVED',
            },
          }
        : {}),
      ...(fixture.observation
        ? { observation: observation(fixture.observation, result) }
        : {}),
      ...(provider === 'vercel' ? { sandbox: adapter.evidence } : {}),
    };
    report.cases.push(outcome);
    console.log(
      JSON.stringify({
        stage: 'runner:probe',
        fixture: outcome.id,
        status: outcome.status,
        diagnosis: outcome.diagnosis,
        reason: outcome.reason,
      }),
    );
  }
  if (provider === 'docker') {
    const reaper = await probeReaper();
    report.cases.push(reaper);
    if (reaper.status !== 'PASS') failures++;
    if (!acceptanceOnly) {
      const controller = new AbortController();
      const pending = runFixture(
        runnerFixtures.find((item) => item.id === 'infinite-loop'),
        new DockerAdapter(),
        controller.signal,
      );
      const timer = setTimeout(() => controller.abort(), 1500);
      const cancelled = await pending;
      clearTimeout(timer);
      const pass = cancelled.terminationReason === 'CANCELLED';
      if (!pass) failures++;
      report.cases.push({
        id: 'cancellation',
        status: pass ? 'PASS' : 'FAIL',
        reason: cancelled.terminationReason,
      });
      const concurrent = await Promise.all([
        runFixture(runnerFixtures[0], new DockerAdapter()),
        runFixture(runnerFixtures[0], new DockerAdapter()),
      ]);
      const isolated = concurrent.every(
        (result) =>
          result.diagnosisCode === 'SUCCESS' && result.evidence.cleanupVerified,
      );
      if (!isolated) failures++;
      report.cases.push({
        id: 'concurrent-capsules',
        status: isolated ? 'PASS' : 'FAIL',
      });
    }
    const remaining = await command([
      'ps',
      '--all',
      '--quiet',
      '--filter',
      'label=org.alunza.runner=imp-00-06',
    ]);
    report.ownedContainersRemaining = remaining.stdout
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    if (remaining.code !== 0 || report.ownedContainersRemaining !== 0)
      failures++;
  }
  report.notRun = runnerFixtures
    .filter((item) => !report.cases.some((result) => result.id === item.id))
    .map((item) => item.id);
  report.remoteCalls = remoteRequests;
  report.failures = failures;
  report.authorizationChecked =
    provider === 'vercel' ? Boolean(authorization !== false) : false;
  const directory = resolve(root, '.local/reports/imp-00-06-08');
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(
      directory,
      `runner-${provider}${acceptanceOnly ? '-acceptance' : ''}.json`,
    ),
    JSON.stringify(report, null, 2) + '\n',
  );
  if (failures) process.exitCode = 1;
}
try {
  await main();
} catch (error) {
  const pending = error instanceof PendingError;
  const report = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    provider: pendingProvider,
    status: pending ? 'PENDING' : 'FAIL',
    reason: pending ? error.message : 'RUNNER_FAILURE',
    remoteCalls: remoteRequests,
    acceptance: 'NOT_ACCEPTED',
  };
  const directory = resolve(root, '.local/reports/imp-00-06-08');
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, `runner-${pendingProvider}.json`),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
  process.exitCode = pending ? 2 : 1;
}
