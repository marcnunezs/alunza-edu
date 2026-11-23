import { describe, expect, test, jest } from '@jest/globals';
import {
  azureProcessInvocation,
  prepareApiInterruption,
} from '../../scripts/sandbox-aca-control.mjs';

const target = {
  subscriptionId: '10000000-0000-4000-8000-000000000001',
  resourceGroup: 'alunza-preproduction',
  appName: 'alunza-api',
  revision: 'alunza-api--unit',
  replica: 'alunza-api--unit-old',
  container: 'api',
};
const candidate = { commit: 'a'.repeat(40) };
const revisionId = `/subscriptions/${target.subscriptionId}/resourceGroups/${target.resourceGroup}/providers/Microsoft.App/containerApps/${target.appName}/revisions/${target.revision}`;
function revision() {
  return {
    id: revisionId,
    name: target.revision,
    properties: {
      template: {
        containers: [
          {
            name: 'api',
            env: [
              { name: 'ENVIRONMENT', value: 'preproduction' },
              { name: 'RELEASE_ID', value: candidate.commit },
            ],
          },
        ],
      },
    },
  };
}
function replica(name = target.replica, restartCount = 1, ready = true) {
  return {
    id: `${revisionId}/replicas/${name}`,
    name,
    properties: {
      runningState: 'Running',
      containers: [
        {
          name: 'api',
          restartCount,
          runningState: 'Running',
          ready,
          started: true,
          execEndpoint: 'PRIVATE_NOT_REPORTED',
        },
      ],
    },
  };
}
function commandDouble(
  observations = [[replica()]],
  selectedRevision = revision(),
) {
  let index = 0;
  let clock = Date.parse('2026-11-04T00:00:00Z');
  const run = jest.fn(async (args) => {
    if (args[1] === 'revision')
      return { code: 0, stdout: JSON.stringify(selectedRevision) };
    if (args[1] === 'exec')
      return { code: 1, stdout: 'DO_NOT_REPORT_RAW_COMMAND_OUTPUT' };
    return {
      code: 0,
      stdout: JSON.stringify(
        observations[Math.min(index++, observations.length - 1)],
      ),
    };
  });
  return {
    run,
    now: () => clock,
    wait: async (milliseconds) => {
      clock += milliseconds;
    },
  };
}

describe('ACA restart observation with pure command doubles only', () => {
  test.each(['appName', 'resourceGroup', 'revision', 'replica'])(
    '%s cannot introduce a shell command',
    async (field) => {
      const deps = commandDouble();
      await expect(
        prepareApiInterruption(
          { ...target, [field]: 'safe & injected' },
          undefined,
          candidate,
          deps,
        ),
      ).rejects.toThrow('ACA_TARGET_INVALID');
      expect(deps.run).not.toHaveBeenCalled();
    },
  );
  test('Windows argv allows only validated identifiers and the one fixed command', () => {
    const call = azureProcessInvocation(
      ['containerapp', 'exec', '--command', 'node -e process.kill(1,9)'],
      'win32',
    );
    expect(call.command).toBe('cmd.exe');
    expect(call.args).toEqual([
      '/d',
      '/s',
      '/c',
      'az "containerapp" "exec" "--command" "node -e process.kill(1,9)"',
    ]);
    for (const unsafe of ['%PATH%', 'abc"', 'a&b', 'a\nb', '$(secret)', 'a|b'])
      expect(() => azureProcessInvocation([unsafe], 'win32')).toThrow(
        'ACA_COMMAND_ARGUMENT_INVALID',
      );
  });
  test.each(['environment', 'release', 'revision-id', 'revision-name'])(
    'refuses %s mismatch before interruption',
    async (mismatch) => {
      const value = revision();
      if (mismatch === 'environment')
        value.properties.template.containers[0].env[0].value = 'production';
      if (mismatch === 'release')
        value.properties.template.containers[0].env[1].value = 'b'.repeat(40);
      if (mismatch === 'revision-id') value.id += '-foreign';
      if (mismatch === 'revision-name') value.name = 'foreign';
      const deps = commandDouble([[replica()]], value);
      await expect(
        prepareApiInterruption(target, undefined, candidate, deps),
      ).rejects.toThrow();
      expect(deps.run.mock.calls.some(([args]) => args[1] === 'exec')).toBe(
        false,
      );
    },
  );
  test.each([
    { values: [] },
    { values: [replica(), replica('alunza-api--unit-second')] },
    { values: [replica(target.replica, 1, false)] },
  ])('requires one currently ready API replica', async ({ values }) => {
    await expect(
      prepareApiInterruption(
        target,
        undefined,
        candidate,
        commandDouble([values]),
      ),
    ).rejects.toThrow();
  });
  test('preparation does not interrupt; restart verification requires dispatch', async () => {
    const deps = commandDouble();
    const control = await prepareApiInterruption(
      target,
      undefined,
      candidate,
      deps,
    );
    expect(deps.run.mock.calls.some(([args]) => args[1] === 'exec')).toBe(
      false,
    );
    await expect(control.verifyRestart()).rejects.toThrow(
      'ACA_INTERRUPTION_NOT_DISPATCHED',
    );
  });
  test('same replica requires an observed higher restart counter and ready container', async () => {
    const deps = commandDouble([
      [replica()],
      [replica(target.replica, 2, false)],
      [replica(target.replica, 2)],
    ]);
    const control = await prepareApiInterruption(
      target,
      undefined,
      candidate,
      deps,
    );
    await Promise.all([control.interrupt(), control.interrupt()]);
    const evidence = await control.verifyRestart();
    expect(evidence.restarted).toBe(true);
    expect(evidence.method).toBe('CONTAINER_RESTART_COUNT_INCREASED');
    expect(evidence.restartCount).toBe(2);
    expect(evidence.durationMs).toBe(2000);
    expect(
      deps.run.mock.calls.filter(([args]) => args[1] === 'exec'),
    ).toHaveLength(1);
    expect(JSON.stringify(evidence)).not.toContain('PRIVATE');
    expect(JSON.stringify(evidence)).not.toContain('RAW_COMMAND');
  });
  test('new ready replica in the same revision proves replacement without inferring from a runner diagnosis', async () => {
    const deps = commandDouble([
      [replica()],
      [],
      [replica('alunza-api--unit-replaced', 0)],
    ]);
    const control = await prepareApiInterruption(
      target,
      undefined,
      candidate,
      deps,
    );
    await control.interrupt();
    expect(await control.verifyRestart()).toMatchObject({
      restarted: true,
      method: 'REPLICA_REPLACED',
      previousRestartCount: 1,
      restartCount: 0,
    });
  });
  test('unchanged state fails after a bounded observation window', async () => {
    const deps = commandDouble();
    const control = await prepareApiInterruption(
      target,
      undefined,
      candidate,
      deps,
    );
    await control.interrupt();
    await expect(control.verifyRestart()).rejects.toThrow(
      'ACA_RESTART_NOT_OBSERVED',
    );
    expect(deps.run.mock.calls.length).toBeLessThanOrEqual(34);
  });
  test('a replacement outside the approved revision cannot prove restart', async () => {
    const outside = replica('alunza-api--other-replica');
    outside.id = outside.id.replace(
      `/revisions/${target.revision}/`,
      '/revisions/other/',
    );
    const control = await prepareApiInterruption(
      target,
      undefined,
      candidate,
      commandDouble([[replica()], [outside]]),
    );
    await control.interrupt();
    await expect(control.verifyRestart()).rejects.toThrow(
      'ACA_REPLICA_SCOPE_INVALID',
    );
  });
  test('cancellation stops further reads and does not leak CLI errors', async () => {
    const abort = new AbortController();
    const deps = commandDouble();
    const control = await prepareApiInterruption(
      target,
      abort.signal,
      candidate,
      deps,
    );
    abort.abort(new Error('LOCAL_TEST_ABORT'));
    expect(() => control.interrupt()).toThrow('LOCAL_TEST_ABORT');
    expect(deps.run).toHaveBeenCalledTimes(2);
  });
  test('oversized command responses fail before parsing or mutation', async () => {
    const run = jest.fn(async () => ({ code: 0, stdout: 'x'.repeat(262145) }));
    await expect(
      prepareApiInterruption(target, undefined, candidate, { run }),
    ).rejects.toThrow('ACA_OBSERVATION_UNAVAILABLE');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
