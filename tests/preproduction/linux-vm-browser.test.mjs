import { describe, it, expect, jest } from '@jest/globals';
import {
  validateManifest,
  validateAction,
  publicContext,
  browserPlan,
  capacityPlan,
  summarizeBrowser,
  validateBrowserRow,
  ENDPOINTS,
} from '../../scripts/linux-vm-browser-contract.mjs';
import {
  assessCapacityWave,
  capacityHttpOffer,
  verifyCapacityOffer,
  controlledCapacityBatch,
} from '../../scripts/linux-vm-capacity.mjs';
import {
  actorForVerification,
  drainControlShutdown,
  retireControlScopes,
} from '../../scripts/linux-vm-browser-control.mjs';
import { resolve } from 'node:path';
const id = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  hash = 'a'.repeat(64);
const candidate = {
  runnerVersion: 'imp-03-quickjs.13',
  capsuleImageId:
    'sha256:1f12d0fb7fb18f6e2668669b3b5da37be47fcc71120f7579dbe32155ad5846b0',
  runnerSourceDigest:
    '4782224f79163235b3f554b140b2ca40750b51b42dc61695964f7fca3f788fa3',
  kitManifestSha256: hash,
  guestSha256: hash,
  apiSourceDigest: hash,
  brokerSha256: hash,
};
const manifest = () => ({
  schemaVersion: 1,
  campaignId: id(1),
  candidate,
  webSourceDigest: hash,
  endpoints: ENDPOINTS,
  controlKey: hash,
  outputDir: resolve('.local/offline-fixture-only'),
  statePath: '/private/state.json',
  brokerSocket: '/private/broker.sock',
});
function rows() {
  return browserPlan().map((p, i) => ({
    id: p.id,
    profile: 'normal',
    mode: p.mode,
    actorId: id(p.actorIndex + 1),
    requestId: id(100 + i),
    executionId: id(200 + i),
    attemptId: p.mode === 'SUBMIT' ? id(300 + i) : null,
    durationMs: 4000,
    pass: true,
    failureCodes: [],
    observationSha256: hash,
  }));
}
const cases = () =>
  Array.from({ length: 8 }, (_, i) => ({ id: `F0${i + 1}`, pass: true }));
function wave() {
  return {
    plan: capacityPlan()[3],
    rows: Array.from({ length: 4 }, (_, i) => ({
      actorId: id(i + 1),
      key: id(10 + i),
      api: i % 2 ? ENDPOINTS.apiReplica : ENDPOINTS.api,
      status: i === 0 ? 201 : 503,
      errorCode: i === 0 ? null : 'RUNNER_BUSY',
      retryAfter: i === 0 ? null : 1,
      zeroState: i !== 0,
      durable: i === 0,
      durationMs: i === 0 ? 7000 : 40,
      complete: true,
    })),
    before: {
      totals: { qemuStarted: 9 },
      records: [],
      ledger: { total: 9, pending: 0 },
    },
    after: {
      totals: { qemuStarted: 10, active: 0, uncertain: 0 },
      records: [{ state: 'CLOSED', cleanupVerified: true }],
      ledger: { total: 10, pending: 0 },
    },
    release: { released: true, automatic: false, ddlCleaned: true },
  };
}
const assess = (w) =>
  assessCapacityWave(w.plan, w.rows, w.before, w.after, w.release);
describe('physical attach harness, pure falsification without network or services', () => {
  it('attempts idle-only cleanup and closes pools after a held HTTP promise rejects, without hiding the failure', async () => {
    const order = [],
      record = jest.fn();
    await expect(
      drainControlShutdown({
        release: async () => {
          order.push('unlock');
        },
        waitHeld: async () => {
          order.push('http-rejected');
          throw new Error('private transport diagnostic');
        },
        cleanupBarrier: async () => {
          order.push('idle-check-and-ddl');
        },
        restore: async () => {
          order.push('restore');
        },
        closeScopes: async () => {
          order.push('fixtures');
        },
        closePools: async () => {
          order.push('pools');
        },
        record,
      }),
    ).rejects.toThrow('CONTROL_SHUTDOWN_INCOMPLETE');
    expect(order).toEqual([
      'unlock',
      'http-rejected',
      'idle-check-and-ddl',
      'restore',
      'fixtures',
      'pools',
    ]);
    expect(record).toHaveBeenCalledWith({
      event: 'CONTROL_SHUTDOWN',
      pass: false,
      failedSteps: ['waitHeld'],
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain(
      'private transport diagnostic',
    );
  });
  it('retires only open owned fixtures and preserves a failed close while attempting the others and pools', async () => {
    const failed = {
        closed: false,
        fixture: {
          campaignId: id(1),
          close: jest.fn(async () => {
            throw new Error('private SQL diagnostic');
          }),
        },
      },
      open = {
        closed: false,
        fixture: { campaignId: id(2), close: jest.fn() },
      },
      closed = {
        closed: true,
        fixture: { campaignId: id(3), close: jest.fn() },
      },
      scopes = new Map([
        ['CAPACITY', failed],
        ['NORMAL', open],
        ['F01', closed],
      ]),
      record = jest.fn(),
      closePools = jest.fn(),
      noop = async () => {};
    await expect(
      drainControlShutdown({
        release: noop,
        waitHeld: noop,
        cleanupBarrier: noop,
        restore: noop,
        closeScopes: () =>
          retireControlScopes({
            scopes,
            inspect: async () => wave().after,
            record,
          }),
        closePools,
        record,
      }),
    ).rejects.toThrow('CONTROL_SHUTDOWN_INCOMPLETE');
    expect(failed.fixture.close).toHaveBeenCalledTimes(1);
    expect(failed.closed).toBe(false);
    expect(open.fixture.close).toHaveBeenCalledTimes(1);
    expect(open.closed).toBe(true);
    expect(closed.fixture.close).not.toHaveBeenCalled();
    expect(closePools).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      event: 'SCOPE_CLOSE_FAILED',
      scope: 'CAPACITY',
      fixtureCampaignId: id(1),
      reason: 'CONTROL_SHUTDOWN',
    });
    expect(record).toHaveBeenLastCalledWith({
      event: 'CONTROL_SHUTDOWN',
      pass: false,
      failedSteps: ['closeScopes'],
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain(
      'private SQL diagnostic',
    );
  });
  it('refuses fixture retirement for active, uncertain, pending or unproved resources and still closes pools', async () => {
    for (const mutate of [
      (s) => {
        s.totals.active = 1;
      },
      (s) => {
        s.totals.uncertain = 1;
      },
      (s) => {
        s.ledger.pending = 1;
      },
      (s) => {
        s.records[0].cleanupVerified = false;
      },
    ]) {
      const snapshot = wave().after,
        close = jest.fn(),
        closePools = jest.fn(),
        record = jest.fn(),
        noop = async () => {};
      mutate(snapshot);
      await expect(
        drainControlShutdown({
          release: noop,
          waitHeld: noop,
          cleanupBarrier: noop,
          restore: noop,
          closeScopes: () =>
            retireControlScopes({
              scopes: new Map([
                [
                  'CAPACITY',
                  { closed: false, fixture: { campaignId: id(1), close } },
                ],
              ]),
              inspect: async () => snapshot,
              record,
            }),
          closePools,
          record,
        }),
      ).rejects.toThrow('CONTROL_SHUTDOWN_INCOMPLETE');
      expect(close).not.toHaveBeenCalled();
      expect(closePools).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenLastCalledWith({
        event: 'CONTROL_SHUTDOWN',
        pass: false,
        failedSteps: ['closeScopes'],
      });
    }
  });
  it('finishes HTTP before private checks and retains201/requestId when durable verification fails', async () => {
    const inspect = jest.fn(async () => {
      throw new Error('DURABLE_RESULT_MISMATCH');
    });
    const actor = {
      id: id(1),
      token: 'PRIVATE_TOKEN',
      fixtures: {
        RUN: {
          activityId: id(2),
          assignmentId: id(3),
          exerciseVersionId: id(4),
          successCode: 'PRIVATE_CODE',
        },
      },
    };
    const row = await capacityHttpOffer(
      {},
      'CAPACITY',
      actor,
      'RUN',
      id(5),
      ENDPOINTS.api,
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              requestId: id(6),
              data: { private: 'PRIVATE_PAYLOAD' },
            }),
            { status: 201 },
          ),
        controlImpl: inspect,
      },
    );
    expect(row).toMatchObject({
      status: 201,
      complete: true,
      requestId: id(6),
      durable: false,
      failureCode: null,
    });
    expect(inspect).not.toHaveBeenCalled();
    expect(JSON.stringify(row)).not.toContain('PRIVATE_');
    await verifyCapacityOffer(row);
    expect(row).toMatchObject({
      status: 201,
      complete: true,
      requestId: id(6),
      durable: false,
      failureCode: 'DURABLE_RESULT_MISMATCH',
    });
    expect(inspect).toHaveBeenCalledTimes(1);
  });
  it('retains actual unexpected HTTP error classification and does not invent a zero-state proof', async () => {
    const inspect = jest.fn();
    const actor = {
      id: id(1),
      token: 'private',
      fixtures: {
        RUN: {
          activityId: id(2),
          assignmentId: id(3),
          exerciseVersionId: id(4),
          successCode: 'fixture',
        },
      },
    };
    const row = await capacityHttpOffer(
      {},
      'CAPACITY',
      actor,
      'RUN',
      id(5),
      ENDPOINTS.api,
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              requestId: id(6),
              error: {
                code: 'REQUEST_IN_PROGRESS',
                message: 'Already running',
                fields: [],
                retryable: true,
              },
            }),
            { status: 409 },
          ),
        controlImpl: inspect,
      },
    );
    await verifyCapacityOffer(row);
    expect(row).toMatchObject({
      status: 409,
      complete: true,
      errorCode: 'REQUEST_IN_PROGRESS',
      failureCode: 'UNEXPECTED_HTTP_STATUS',
      zeroState: false,
    });
    expect(inspect).not.toHaveBeenCalled();
  });
  it('releases on the1200ms HTTP wait deadline, then preserves every late offer', async () => {
    jest.useFakeTimers();
    try {
      let finishFirst, finishOther;
      const first = new Promise((resolve) => {
        finishFirst = resolve;
      });
      const other = new Promise((resolve) => {
        finishOther = resolve;
      });
      const release = jest.fn(async () => ({
        released: true,
        automatic: false,
        ddlPending: true,
      }));
      const pending = controlledCapacityBatch({
        first,
        waitBarrier: async () => ({ waiting: true }),
        startOthers: () => [other],
        releaseBarrier: release,
      });
      await jest.advanceTimersByTimeAsync(1200);
      expect(release).toHaveBeenCalledTimes(1);
      finishFirst({ status: 201 });
      finishOther({ status: 503 });
      const done = await pending;
      expect(done.batch).toEqual([{ status: 201 }, { status: 503 }]);
      expect(done.released).toMatchObject({
        releaseReason: 'HTTP_WAIT_DEADLINE',
        automatic: false,
      });
      expect(done.gateFailed).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
  it('releases immediately when contender HTTP completes and still releases after a failed barrier observation', async () => {
    const release = jest.fn(async () => ({ released: true, automatic: false }));
    const done = await controlledCapacityBatch({
      first: Promise.resolve({ status: 201 }),
      waitBarrier: async () => {},
      startOthers: () => [Promise.resolve({ status: 503 })],
      releaseBarrier: release,
    });
    expect(done.released.releaseReason).toBe('OTHER_HTTP_COMPLETE');
    const failed = await controlledCapacityBatch({
      first: Promise.resolve({ status: 500 }),
      waitBarrier: async () => {
        throw new Error('missing');
      },
      startOthers: () => {
        throw new Error('must not launch');
      },
      releaseBarrier: release,
    });
    expect(failed.batch).toEqual([{ status: 500 }]);
    expect(failed.gateFailed).toBe(true);
    expect(release).toHaveBeenCalledTimes(2);
  });
  it('keeps the published vertical RUN2 hash distinct from its SUBMIT8 hidden suite', () => {
    const actor = {
      fixtures: {
        RUN: { exerciseVersionId: id(11) },
        SUBMIT: {
          exerciseVersionId: id(12),
          testsVersion: 'b'.repeat(64),
          runTestsVersion: hash,
          visibleTestIds: ['v1', 'v2'],
          hiddenTestIds: ['h1'],
          hiddenMarkers: ['secret'],
        },
      },
    };
    const selected = actorForVerification(actor, 'F01', 'RUN', id(12));
    expect(selected.fixtures.RUN.testsVersion).toBe(hash);
    expect(selected.fixtures.RUN.hiddenTestIds).toEqual([]);
    expect(actor.fixtures.SUBMIT.hiddenTestIds).toEqual(['h1']);
    expect(actorForVerification(actor, 'NORMAL', 'RUN', id(12))).toBe(actor);
    expect(() =>
      actorForVerification(
        {
          ...actor,
          fixtures: {
            ...actor.fixtures,
            SUBMIT: { ...actor.fixtures.SUBMIT, runTestsVersion: null },
          },
        },
        'F01',
        'RUN',
        id(12),
      ),
    ).toThrow();
  });
  it('accepts only explicit .13 pins and loopback endpoints, never public binding or swapped control/API replica', () => {
    expect(() => validateManifest(manifest())).not.toThrow();
    for (const endpoints of [
      { ...ENDPOINTS, control: 'http://0.0.0.0:4302' },
      { ...ENDPOINTS, apiReplica: ENDPOINTS.control },
      { ...ENDPOINTS, auth: 'https://project.supabase.co' },
    ])
      expect(() => validateManifest({ ...manifest(), endpoints })).toThrow(
        'LOOPBACK',
      );
    expect(() =>
      validateManifest({
        ...manifest(),
        candidate: { ...candidate, runnerVersion: 'imp-03-quickjs.12' },
      }),
    ).toThrow();
  });
  it('rejects SQL/shell actions and extra fields on otherwise permitted operations', () => {
    expect(() => validateAction('sql', { query: 'select 1' })).toThrow();
    expect(() =>
      validateAction('inspect', { command: 'docker stop' }),
    ).toThrow();
    expect(() =>
      validateAction('prepare', { scope: '../../another' }),
    ).toThrow();
    expect(() =>
      validateAction('barrier-arm', {
        scope: 'CAPACITY',
        actorId: id(1),
        mode: 'RUN',
        key: id(2),
        timeout: 60000,
      }),
    ).toThrow();
    expect(() =>
      validateAction('barrier-arm', {
        scope: 'CAPACITY',
        actorId: id(1),
        mode: 'RUN',
        key: id(2),
      }),
    ).not.toThrow();
    expect(() => validateAction('barrier-cleanup', {})).not.toThrow();
  });
  it('browser projection excludes actor credentials and hidden test identities/content', () => {
    const fixture = {
      activityId: id(10),
      assignmentId: id(11),
      exerciseVersionId: id(12),
      successCode: 'public fixture',
      incorrectCode: 'wrong fixture',
      visibleTestIds: ['visible'],
      hiddenTestIds: ['PRIVATE_SENTINEL'],
      hiddenMarkers: ['PRIVATE_MARKER'],
      hiddenProbeCode: 'SECRET_CODE',
    };
    const projected = publicContext(
      'F01',
      [
        {
          id: id(1),
          organizationId: id(2),
          classId: id(3),
          token: 'SECRET_TOKEN',
          password: 'SECRET_PASSWORD',
          fixtures: { RUN: fixture, SUBMIT: fixture },
        },
      ],
      { [id(3)]: id(4) },
    );
    const text = JSON.stringify(projected);
    for (const forbidden of [
      'SECRET_',
      'PRIVATE_',
      'hiddenTest',
      'token',
      'password',
    ])
      expect(text).not.toContain(forbidden);
    expect(projected.actors[0].fixtures.SUBMIT.visibleCount).toBe(1);
  });
  it('requires all 48 planned outcomes, preserves exactly5000 and slower/failing rows', () => {
    expect(summarizeBrowser(rows(), cases()).pass).toBe(true);
    expect(summarizeBrowser(rows().slice(1), cases()).pass).toBe(false);
    expect(summarizeBrowser(rows(), cases().slice(1)).pass).toBe(false);
    const changed = rows();
    changed[36].durationMs = 5000;
    changed[38].durationMs = 6000;
    expect(summarizeBrowser(changed, cases()).latency.RUN).toMatchObject({
      p95Ms: 5000,
      maxMs: 6000,
      strictTargetMet: false,
    });
    changed[0] = { ...changed[0], pass: false, failureCodes: ['HTTP_FAILED'] };
    expect(summarizeBrowser(changed, cases()).latency.RUN.failures).toBe(1);
  });
  it('refuses invented successful measurements, private extra fields and duplicate execution identities', () => {
    expect(() =>
      validateBrowserRow({ ...rows()[0], observationSha256: null }),
    ).toThrow();
    expect(() =>
      validateBrowserRow({ ...rows()[0], durationMs: NaN }),
    ).toThrow();
    expect(() =>
      validateBrowserRow({ ...rows()[0], body: { token: 'secret' } }),
    ).toThrow();
    const duplicate = rows();
    duplicate[1].executionId = duplicate[0].executionId;
    expect(() => summarizeBrowser(duplicate, cases())).toThrow('DUPLICATE');
    const oneActor = rows().map((row) => ({ ...row, actorId: id(1) }));
    expect(summarizeBrowser(oneActor, cases()).pass).toBe(false);
  });
  it('fixes capacity denominator at18 offers/6 waves and requires two API processes', () => {
    expect(capacityPlan()).toHaveLength(6);
    expect(capacityPlan().reduce((n, p) => n + p.width, 0)).toBe(18);
    expect(assess(wave()).pass).toBe(true);
    const changed = wave();
    changed.rows.forEach((r) => (r.api = ENDPOINTS.api));
    expect(assess(changed).failureCodes).toContain('TWO_API_REPLICAS');
  });
  it('does not pass a busy reply that leaves durable state or an unexpected extra VM', () => {
    const changed = wave();
    changed.rows[1].zeroState = false;
    expect(assess(changed).pass).toBe(false);
    const extra = wave();
    extra.after.totals.qemuStarted++;
    expect(assess(extra).failureCodes).toContain('EXTRA_RESOURCE');
    const extraLedger = wave();
    extraLedger.after.records.push({ state: 'CLOSED', cleanupVerified: true });
    expect(assess(extraLedger).pass).toBe(false);
  });
  it('fails capacity on ambiguous retirement, expired hold, incomplete HTTP and second admission', () => {
    const retired = wave();
    retired.after.records[0].cleanupVerified = false;
    expect(assess(retired).failureCodes).toContain('RETIREMENT');
    const expired = wave();
    expired.release.automatic = true;
    expect(assess(expired).failureCodes).toContain('BARRIER_EXPIRED');
    const retainedDdl = wave();
    retainedDdl.release.ddlCleaned = false;
    expect(assess(retainedDdl).failureCodes).toContain('BARRIER_DDL_RETAINED');
    const incomplete = wave();
    incomplete.rows[2].complete = false;
    expect(assess(incomplete).pass).toBe(false);
    const second = wave();
    second.rows[1] = { ...second.rows[1], status: 201, durable: true };
    expect(assess(second).pass).toBe(false);
  });
  it('accepts an explicitly unheld race only with the same resource and retirement gates', () => {
    const race = wave();
    race.plan = { ...race.plan, controlled: false };
    race.release = null;
    expect(assess(race).pass).toBe(true);
    race.after.ledger.pending = 1;
    expect(assess(race).failureCodes).toContain('RETIREMENT');
  });
});
