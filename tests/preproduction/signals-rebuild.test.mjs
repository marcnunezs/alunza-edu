import { describe, expect, jest, test } from '@jest/globals';
import {
  assertSignalsRebuildTarget,
  parseSignalsRebuildArgs,
  signalsRebuildMain,
} from '../../scripts/signals-rebuild.mjs';

const scope = {
  organizationId: '70000000-0000-4000-8000-000000000001',
  classId: '70000000-0000-4000-8000-000000000002',
  studentId: '70000000-0000-4000-8000-000000000003',
  activityId: '70000000-0000-4000-8000-000000000004',
  asOf: '2026-10-25T12:00:00.123456Z',
};
const argumentsFor = (mode = 'plan', target = 'test') => [
  mode,
  '--target',
  target,
  '--organization',
  scope.organizationId,
  '--class',
  scope.classId,
  '--student',
  scope.studentId,
  '--activity',
  scope.activityId,
  '--as-of',
  scope.asOf,
];
const testState = {
  projectId: 'alunza-edu-laboratorio-test',
  authUrl: 'http://127.0.0.1:18421',
  migrationUrl: 'postgresql://fixture:private-fixture@127.0.0.1:18422/postgres',
};
const developmentState = {
  projectId: 'alunza-edu-laboratorio',
  authUrl: 'http://127.0.0.1:17421',
  migrationUrl: 'postgresql://fixture:private-fixture@127.0.0.1:17422/postgres',
};
const now = () => new Date('2026-10-25T12:01:00.000Z');

describe('local signal reconstruction command', () => {
  test.each(['plan', 'check', 'rebuild', 'report'])(
    '%s preserves exact scope and microseconds without adding a public action',
    (mode) => {
      expect(parseSignalsRebuildArgs(argumentsFor(mode))).toEqual({
        mode,
        target: 'test',
        scope,
      });
    },
  );

  test('plan neither loads credentials nor opens a database/application context', async () => {
    const loadState = jest.fn(() => {
      throw new Error('must not load state');
    });
    const execute = jest.fn(() => {
      throw new Error('must not execute');
    });
    const result = await signalsRebuildMain(argumentsFor(), {
      now,
      loadState,
      execute,
    });
    expect(result).toEqual({
      mode: 'plan',
      projectId: 'alunza-edu-laboratorio-test',
      scope,
      mutates: false,
      rebuilds: 'derived-projections-only',
      publishesSignals: false,
    });
    expect(loadState).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test.each(['check', 'rebuild', 'report'])(
    '%s validates the destination before dispatching one scoped operation',
    async (mode) => {
      const runtime = { ctx: { test: true }, state: testState };
      const loadState = jest.fn(async () => runtime);
      const expected = { status: 'verified', mode, count: 3 };
      const execute = jest.fn(async () => expected);
      await expect(
        signalsRebuildMain(argumentsFor(mode), { now, loadState, execute }),
      ).resolves.toBe(expected);
      expect(loadState).toHaveBeenCalledTimes(1);
      expect(loadState).toHaveBeenCalledWith('test');
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith(
        { mode, target: 'test', scope },
        runtime,
      );
    },
  );

  test.each([
    [],
    ['reset'],
    ['delete'],
    ['deploy'],
    argumentsFor().slice(0, -2),
    [...argumentsFor(), '--target', 'test'],
    [...argumentsFor(), '--force', 'true'],
    [...argumentsFor(), '--lane', scope.classId],
    argumentsFor('plan', 'production'),
    argumentsFor('plan', 'evaluation'),
    argumentsFor().map((value) => (value === scope.studentId ? 'all' : value)),
    argumentsFor().map((value) =>
      value === scope.asOf ? '2026-10-25T12:00:00' : value,
    ),
    argumentsFor().map((value) =>
      value === scope.asOf ? '2026-10-25T12:00:00.1234567Z' : value,
    ),
  ])(
    'invalid or widened command %j is rejected before reading state',
    async (...values) => {
      // Jest expands array rows; reconstruct exactly the argv under test.
      const argv = values;
      const loadState = jest.fn();
      const execute = jest.fn();
      await expect(
        signalsRebuildMain(argv, { now, loadState, execute }),
      ).rejects.toThrow();
      expect(loadState).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    },
  );

  test('future cutoff is refused before any state or provider access', async () => {
    const loadState = jest.fn();
    const execute = jest.fn();
    const argv = argumentsFor().map((value) =>
      value === scope.asOf ? '2026-10-25T12:02:00.000000Z' : value,
    );
    await expect(
      signalsRebuildMain(argv, { now, loadState, execute }),
    ).rejects.toThrow('futuro');
    expect(loadState).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test('a cutoff one microsecond after the local clock is still future', async () => {
    const loadState = jest.fn();
    const execute = jest.fn();
    const argv = argumentsFor().map((value) =>
      value === scope.asOf ? '2026-10-25T12:01:00.000001Z' : value,
    );
    await expect(
      signalsRebuildMain(argv, { now, loadState, execute }),
    ).rejects.toThrow('futuro');
    expect(loadState).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test('development and TEST are both allowed only with their own complete destination', () => {
    expect(assertSignalsRebuildTarget(testState, 'test').dbPort).toBe(18422);
    expect(
      assertSignalsRebuildTarget(developmentState, 'development').dbPort,
    ).toBe(17422);
    expect(() =>
      assertSignalsRebuildTarget(testState, 'development'),
    ).toThrow();
    expect(() =>
      assertSignalsRebuildTarget(developmentState, 'test'),
    ).toThrow();
  });

  test.each([
    { projectId: 'alunza-edu' },
    { authUrl: 'http://127.0.0.1:17421' },
    {
      migrationUrl:
        'postgresql://fixture:private-fixture@127.0.0.1:54322/postgres',
    },
    {
      migrationUrl:
        'postgresql://fixture:private-fixture@db.example.test:18422/postgres',
    },
    {
      migrationUrl:
        'postgresql://fixture:private-fixture@127.0.0.1.example.test:18422/postgres',
    },
    {
      migrationUrl:
        'postgresql://fixture:private-fixture@127.0.0.1:18422/other_database',
    },
    {
      migrationUrl:
        'postgresql://fixture:private-fixture@127.0.0.1:18422/postgres?host=remote',
    },
    {
      migrationUrl:
        'postgresql://fixture:private-fixture@127.0.0.1:18422/postgres#remote',
    },
    { migrationUrl: 'https://127.0.0.1:18422/postgres' },
    { migrationUrl: null },
  ])(
    'forged destination %j never reaches execution and does not expose its credential',
    async (changed) => {
      const loadState = jest.fn(async () => ({
        ctx: {},
        state: { ...testState, ...changed },
      }));
      const execute = jest.fn();
      let failure;
      try {
        await signalsRebuildMain(argumentsFor('rebuild'), {
          now,
          loadState,
          execute,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).not.toContain('private-fixture');
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
