// Trusted integration for the finite physical-laboratory catalogue.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { performance } = require('node:perf_hooks');
const catalogue = require('./adversarial.cjs');

async function runAdversarial({
  runner,
  runtime,
  admission,
  remaining,
  cli,
  bundleRoot,
}) {
  const fixture = await catalogue.buildFixture(
    admission.fixture,
    admission.executionId,
  );
  const capsule = await import(
    pathToFileURL(`${bundleRoot}/infra/runner/capsule.mjs`).href
  );
  const observations = {
    imageId: admission.capsuleImageId,
    kernelBoundary: catalogue.BOUNDARY,
    capsules: [],
    dispatches: [],
    cleanupVerified: false,
  };
  const controls = (directory, names) =>
    Object.fromEntries(
      names.map((name) => [
        name,
        fs.readFileSync(`${directory}/${name}`, 'utf8').trim(),
      ]),
    );
  const options = {
    image: admission.capsuleImageId,
    runtime,
    expectedBoundary: catalogue.BOUNDARY,
    deadlineMs: admission.normalDeadlineEpochMs,
    beforeSend: async () => {
      remaining();
      const ids = cli('docker', [
        'ps',
        '-aq',
        '--no-trunc',
        '--filter',
        `label=org.alunza.execution=${admission.executionId}`,
      ]).split('\n');
      assert.equal(ids.length, 1);
      assert.match(ids[0], /^[a-f0-9]{64}$/);
      assert.ok(!observations.capsules.some((item) => item.id === ids[0]));
      const inspected = JSON.parse(cli('docker', ['inspect', ids[0]]))[0];
      assert.equal(inspected.Image, admission.capsuleImageId);
      assert.equal(
        inspected.Config.Labels['org.alunza.runner'],
        'alunza-edu-laboratorio',
      );
      assert.equal(inspected.HostConfig.Runtime, admission.runtime.runtimeName);
      assert.ok(
        Number.isSafeInteger(inspected.State.Pid) && inspected.State.Pid > 0,
      );
      const membership = fs
        .readFileSync(`/proc/${inspected.State.Pid}/cgroup`, 'utf8')
        .trim();
      assert.match(
        membership,
        /^0::\/alunzasingleexecutor\.slice\/[A-Za-z0-9_./-]+$/,
      );
      assert.ok(!membership.includes('..'));
      const leaf = `/sys/fs/cgroup${membership.slice(3)}`;
      observations.capsules.push({
        id: ids[0],
        leafBeforeInput: controls(leaf, [
          'memory.max',
          'memory.swap.max',
          'pids.max',
          'cpu.max',
        ]),
        boundaryBeforeInput: controls(catalogue.BOUNDARY, [
          'memory.max',
          'memory.swap.max',
          'cpu.max',
        ]),
      });
    },
  };
  const started = performance.now();
  let assessment;
  if (fixture.kind === 'runner') {
    const adapter = new runner.DockerAdapter(options);
    const original = adapter.execute.bind(adapter);
    adapter.execute = async (input, signal) => {
      observations.dispatches.push({
        budgetMs: input.budgetMs,
        outputRemaining: input.outputRemaining,
      });
      return original(input, signal);
    };
    const result = await runner.execute(
      fixture.input,
      adapter,
      AbortSignal.timeout(remaining()),
    );
    observations.cleanupVerified = result.evidence.cleanupVerified;
    observations.publicProjection = runner.publicResult(result);
    assessment = catalogue.assessRunner(
      admission.fixture,
      result,
      observations,
      admission.capsuleImageId,
    );
  } else {
    observations.dispatches.push({
      budgetMs: fixture.input.budgetMs,
      outputRemaining: fixture.input.outputRemaining,
    });
    const response = await capsule.runCapsule(fixture.input, {
      ...options,
      signal: AbortSignal.timeout(remaining()),
      probe: fixture.probe,
    });
    observations.cleanupVerified = response.cleanupVerified;
    assessment = catalogue.assessProbe(
      admission.fixture,
      response,
      observations,
      admission.capsuleImageId,
    );
  }
  // No source, expected values, private output or native raw response crosses serial.
  return {
    event: 'adversarial-result',
    admissions: 1,
    mode: admission.mode,
    caseCount: admission.caseCount,
    profile: admission.fixture,
    assessment,
    ok: assessment.pass,
    executeMs: performance.now() - started,
  };
}
module.exports = { runAdversarial };
