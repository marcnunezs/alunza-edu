import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import {
  assertDurable,
  canonicalHash,
  summarizeLinuxVmSamples,
  validateCandidate,
  validateHttpPayload,
  validateInspection,
  validateLinuxVmActors,
  validateObservation,
} from '../integration/linux-vm-api.mjs';
import { planLinuxVmFixture } from '../integration/linux-vm-fixture.mjs';
import { validateBrokerSnapshot } from '../integration/linux-vm-observer.mjs';

const id = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = 'a'.repeat(64);
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
function actors() {
  const byActor = new Map();
  for (const [index, row] of planLinuxVmFixture(id(1)).entries()) {
    const fixture = {
      activityId: id(10 + index),
      assignmentId: id(20 + index),
      exerciseVersionId: id(30 + index),
      testsVersion: hash,
      visibleTestIds: row.tests
        .filter((t) => t.visibility === 'visible')
        .map((t) => t.id),
      hiddenTestIds: row.tests
        .filter((t) => t.visibility === 'hidden')
        .map((t) => t.id),
      successCode: row.successCode,
      incorrectCode: row.incorrectCode,
      hiddenProbeCode: row.hiddenProbeCode,
      hiddenMarkers: row.mode === 'SUBMIT' ? [row.marker] : [],
    };
    for (const student of row.classroom.studentIds) {
      if (!byActor.has(student))
        byActor.set(student, {
          id: student,
          organizationId: row.classroom.organizationId,
          classId: row.classroom.id,
          token: 'offline.fixture.not-a-real-token',
          fixtures: {},
        });
      byActor.get(student).fixtures[row.mode] = fixture;
    }
  }
  return [...byActor.values()];
}
function payload(actor = actors()[0]) {
  const f = actor.fixtures.SUBMIT;
  return {
    requestId: id(90),
    data: {
      executionId: id(91),
      attemptId: id(92),
      activityId: f.activityId,
      assignmentId: f.assignmentId,
      exerciseVersionId: f.exerciseVersionId,
      testsVersion: f.testsVersion,
      attemptNumber: 1,
      previousAttemptId: null,
      admittedAt: '2026-11-17T12:00:00Z',
      submittedAt: '2026-11-17T12:00:04Z',
      code: f.successCode,
      technicalResult: {
        runnerVersion: 'imp-03-quickjs.13',
        diagnosisCode: 'SUCCESS',
        terminationReason: 'COMPLETED',
        infrastructureStatus: 'OK',
        visibleTestResults: f.visibleTestIds.map((test) => ({
          id: test,
          passed: true,
          stdout: '',
          stderr: '',
        })),
        visiblePassed: 2,
        visibleTotal: 2,
        hiddenChecksPassed: true,
        allRequiredPassed: true,
        outputTruncated: false,
        outputBytes: 0,
        runtimeMs: 710,
        lifecycleMs: 4000,
      },
    },
  };
}
function observation(actor, data) {
  return {
    executionId: data.executionId,
    attemptId: data.attemptId,
    completed: true,
    resultDurable: true,
    attemptCount: 1,
    technicalResultSha256: canonicalHash(data.technicalResult),
    codeSha256: createHash('sha256').update(data.code).digest('hex'),
    testsVersion: actor.fixtures.SUBMIT.testsVersion,
    visibleTestCount: 2,
    hiddenTestCount: 6,
    privateTestCount: 6,
    vmCreations: [
      {
        creationId: id(93),
        bootId: id(94),
        executionId: data.executionId,
        kitManifestSha256: hash,
        guestSha256: hash,
        runnerVersion: candidate.runnerVersion,
        capsuleImageId: candidate.capsuleImageId,
        cleanupVerified: true,
        receiptSha256: hash,
      },
    ],
  };
}

describe('physical API measurement contracts, without services or network', () => {
  it('keeps all 40 planned outcomes, includes failures and rejects exactly five seconds', () => {
    const rows = ['RUN', 'SUBMIT'].flatMap((mode) =>
      Array.from({ length: 20 }, (_, i) => ({
        profile: 'normal',
        mode,
        durationMs: i < 18 ? 4000 : 5000,
        pass: true,
      })),
    );
    expect(summarizeLinuxVmSamples(rows).RUN).toMatchObject({
      n: 20,
      p95Ms: 5000,
      strictTargetMet: false,
    });
    rows[0] = { ...rows[0], durationMs: 45000, pass: false };
    expect(summarizeLinuxVmSamples(rows).RUN).toMatchObject({
      failures: 1,
      maxMs: 45000,
      strictTargetMet: false,
    });
    expect(summarizeLinuxVmSamples(rows.slice(1)).RUN).toMatchObject({
      complete: false,
      p95Ms: null,
    });
  });
  it('prepares eight visible RUN and two-visible/six-hidden SUBMIT without changing canonical classes', () => {
    const plan = planLinuxVmFixture(id(1));
    expect(plan).toHaveLength(6);
    expect(new Set(plan.map((row) => row.classroom.id)).size).toBe(3);
    for (const row of plan) {
      expect(row.tests).toHaveLength(8);
      expect(row.tests.filter((t) => t.visibility === 'hidden')).toHaveLength(
        row.mode === 'RUN' ? 0 : 6,
      );
      expect(row.tests.every((t) => t.expected === t.args[0] + t.args[1])).toBe(
        true,
      );
      expect(
        row.tests
          .filter((t) => t.visibility === 'hidden')
          .every((t) => t.args[0] < 0),
      ).toBe(true);
    }
    expect(() => validateLinuxVmActors(actors())).not.toThrow();
    const oldFixture = actors();
    oldFixture[0].fixtures.RUN.visibleTestIds.pop();
    expect(() => validateLinuxVmActors(oldFixture)).toThrow('EIGHT_CASE');
  });
  it('refuses old image/source identities and privileged application roles', () => {
    expect(() => validateCandidate(candidate)).not.toThrow();
    expect(() =>
      validateCandidate({ ...candidate, runnerVersion: 'imp-03-quickjs.12' }),
    ).toThrow();
    expect(() =>
      validateCandidate({ ...candidate, capsuleImageId: `sha256:${hash}` }),
    ).toThrow();
    const observed = {
      provider: 'local-vm',
      candidate,
      applicationRole: {
        name: 'alunza_app',
        superuser: false,
        bypassRls: false,
      },
      vmCreationsTotal: 3,
      creationRecordsTotal: 3,
      activeVms: 0,
      cleanupUncertain: false,
    };
    expect(() => validateInspection(observed, candidate)).not.toThrow();
    expect(() =>
      validateInspection(
        {
          ...observed,
          applicationRole: { ...observed.applicationRole, bypassRls: true },
        },
        candidate,
      ),
    ).toThrow();
    expect(() =>
      validateInspection({ ...observed, activeVms: 1 }, candidate),
    ).toThrow();
  });
  it('validates public schema and hidden projection without exporting code or tokens', () => {
    const actor = actors()[0],
      fixture = actor.fixtures.SUBMIT,
      body = payload(actor);
    const options = {
      actor,
      fixture,
      mode: 'SUBMIT',
      code: fixture.successCode,
      status: 201,
    };
    expect(validateHttpPayload(body, options).failures).toEqual([]);
    body.data.technicalResult.visibleTestResults[0].stdout =
      fixture.hiddenMarkers[0];
    body.data.technicalResult.outputBytes = Buffer.byteLength(
      fixture.hiddenMarkers[0],
    );
    expect(validateHttpPayload(body, options).failures).toContain(
      'PRIVATE_DISCLOSURE',
    );
    const privateField = payload(actor);
    privateField.data.privateResults = [];
    expect(validateHttpPayload(privateField, options).failures).toContain(
      'PUBLIC_SCHEMA',
    );
  });
  it('does not treat success with a cumulative runtime over 3000 as a valid HTTP outcome', () => {
    const actor = actors()[0],
      body = payload(actor);
    body.data.technicalResult.runtimeMs = 3000.001;
    expect(
      validateHttpPayload(body, {
        actor,
        fixture: actor.fixtures.SUBMIT,
        mode: 'SUBMIT',
        code: body.data.code,
        status: 201,
      }).failures,
    ).toContain('TECHNICAL_RESULT');
  });
  it('canonical result hashes compare JSONB independently from property order', () => {
    expect(canonicalHash({ z: [{ b: 2, a: 1 }], a: true })).toBe(
      canonicalHash({ a: true, z: [{ a: 1, b: 2 }] }),
    );
    expect(canonicalHash({ pass: true })).not.toBe(
      canonicalHash({ pass: false }),
    );
  });
  it('rejects extra private observer fields and a duplicate or foreign VM', () => {
    const actor = actors()[0],
      value = observation(actor, payload(actor).data);
    expect(() => validateObservation(value, candidate)).not.toThrow();
    expect(() =>
      validateObservation({ ...value, token: actor.token }, candidate),
    ).toThrow('PRIVATE_OBSERVER_FIELD');
    expect(() =>
      validateObservation(
        { ...value, vmCreations: [value.vmCreations[0], value.vmCreations[0]] },
        candidate,
      ),
    ).toThrow();
    value.vmCreations[0].executionId = id(99);
    expect(() => validateObservation(value, candidate)).toThrow('VM_IDENTITY');
  });
  it('does not accept completed flags instead of durable matching code and result', () => {
    const actor = actors()[0],
      data = payload(actor).data,
      value = observation(actor, data);
    expect(() =>
      assertDurable(value, data, actor, 'SUBMIT', data.code, candidate),
    ).not.toThrow();
    value.codeSha256 = 'b'.repeat(64);
    expect(() =>
      assertDurable(value, data, actor, 'SUBMIT', data.code, candidate),
    ).toThrow('DURABLE_RESULT_MISMATCH');
    value.codeSha256 = createHash('sha256').update(data.code).digest('hex');
    value.technicalResultSha256 = 'b'.repeat(64);
    expect(() =>
      assertDurable(value, data, actor, 'SUBMIT', data.code, candidate),
    ).toThrow();
  });
  it('checks broker creation counters and refuses overlapping or duplicate VM identities', () => {
    const context = {
      provider: 'local-vm',
      image: candidate.capsuleImageId,
      runnerVersion: candidate.runnerVersion,
      kitManifestSha256: hash,
      guestSha256: hash,
      brokerVersion: 'local-vm-broker-v1',
      hostId: id(95),
      brokerGeneration: id(96),
    };
    const row = {
      executionId: id(91),
      creationId: id(93),
      resourceId: id(94),
      state: 'CLOSED',
      qemuStarted: true,
      cleanupVerified: true,
    };
    const value = {
      schemaVersion: 1,
      context,
      records: [row],
      totals: { qemuStarted: 1, active: 0, uncertain: 0 },
    };
    expect(() => validateBrokerSnapshot(value, candidate)).not.toThrow();
    expect(() =>
      validateBrokerSnapshot(
        { ...value, totals: { ...value.totals, qemuStarted: 0 } },
        candidate,
      ),
    ).toThrow('totals');
    expect(() =>
      validateBrokerSnapshot({ ...value, records: [row, row] }, candidate),
    ).toThrow('duplicate');
    expect(() =>
      validateBrokerSnapshot(
        { ...value, totals: { ...value.totals, active: 2 } },
        candidate,
      ),
    ).toThrow();
    expect(() =>
      validateBrokerSnapshot(
        { ...value, records: [{ ...row, cleanupVerified: false }] },
        candidate,
      ),
    ).toThrow('totals');
  });
});
