import { describe, expect, it } from '@jest/globals';
import {
  assertLocalApiUrl,
  auditLedgerOrdering,
  describeDurations,
  summarizeHttpProfile,
  validateLedgerObservation,
} from '../integration/docker-runtime-api.mjs';

describe('local Docker HTTP evidence, without services or network', () => {
  it.each([
    'https://api.alunza.invalid',
    'http://127.0.0.1:4000',
    'http://user:password@127.0.0.1:4300',
    'http://127.0.0.1:4300/?token=private',
    'http://127.0.0.1:4300/other',
  ])('rejects a non-LAB target: %s', (target) => {
    expect(() => assertLocalApiUrl(target)).toThrow();
  });

  it('uses nearest-rank observation 48/50 without modifying input', () => {
    const durations = Array.from({ length: 50 }, (_, index) => 50 - index);
    expect(describeDurations(durations)).toEqual({
      n: 50,
      p50Ms: 25.5,
      p95Ms: 48,
      maxMs: 50,
    });
    expect(durations[0]).toBe(50);
    expect(() => describeDurations([Number.NaN])).toThrow();
  });

  it('retains timeouts and the first sample; <5000 is strict', () => {
    const rows = Array.from({ length: 50 }, (_, index) => ({
      sequence: index + 1,
      durationMs: index < 47 ? 1000 : 5000,
      pass: true,
      status: 201,
      failureCodes: [],
      scheduledPauseMs: index % 2 ? 6000 : 0,
      clientQuotaWaitMs: 0,
    }));
    const boundary = summarizeHttpProfile(rows);
    expect(boundary.p95Ms).toBe(5000);
    expect(boundary.strictTargetMet).toBe(false);
    expect(boundary.scheduledImmediate).toBe(25);
    expect(boundary.scheduledSixSecondPause).toBe(25);
    rows[0] = {
      ...rows[0],
      durationMs: 45000,
      pass: false,
      status: null,
      failureCodes: ['HTTP_TIMEOUT'],
    };
    const failed = summarizeHttpProfile(rows);
    expect(failed.n).toBe(50);
    expect(failed.errors).toBe(1);
    expect(failed.maxMs).toBe(45000);
    expect(failed.firstRequest.durationMs).toBe(45000);
    expect(failed.successfulRequests.n).toBe(49);
    expect(failed.strictTargetMet).toBe(false);
  });

  const executionId = '10000000-0000-4000-8000-000000000001';
  const evidence = () => ({
    executions: [
      {
        executionId,
        pairId: '20000000-0000-4000-8000-000000000001',
        pairCreatedAt: '2026-11-15T12:00:00.000Z',
        pairReadyAt: '2026-11-15T12:00:02.000Z',
        pairAssignedAt: '2026-11-15T12:00:02.020Z',
        executionAdmittedAt: '2026-11-15T12:00:01.000Z',
        executionFinishedAt: '2026-11-15T12:00:04.000Z',
      },
    ],
  });

  it('derives readiness and overlapping preparation from durable dates', () => {
    const result = validateLedgerObservation(evidence(), [{ executionId }]);
    expect(result[0]).toMatchObject({
      preparationMs: 2000,
      admissionToAssignmentMs: 1020,
      assignedToFinishedMs: 1980,
      preparedBeforeAdmission: false,
    });
    expect(
      result[0].preparationMs +
        result[0].admissionToAssignmentMs +
        result[0].assignedToFinishedMs,
    ).toBe(5000);
    // The actual admission-to-finish interval is 3000ms. Preparation overlaps it.
  });

  it('rejects missing, duplicate, foreign or private observer fields', () => {
    expect(() =>
      validateLedgerObservation({ executions: [] }, [{ executionId }]),
    ).toThrow();
    const duplicate = evidence();
    duplicate.executions.push(duplicate.executions[0]);
    expect(() =>
      validateLedgerObservation(duplicate, [{ executionId }]),
    ).toThrow();
    expect(() => validateLedgerObservation(evidence(), [])).toThrow();
    const secret = evidence();
    secret.executions[0].code = 'private';
    expect(() =>
      validateLedgerObservation(secret, [{ executionId }]),
    ).toThrow();
    const reversed = evidence();
    reversed.executions[0].executionFinishedAt = '2026-11-15T11:00:00.000Z';
    expect(() =>
      validateLedgerObservation(reversed, [{ executionId }]),
    ).toThrow();
  });

  it('detects reuse and replenishment while the preceding service is active', () => {
    const first = evidence().executions[0];
    const second = {
      ...first,
      executionId: '10000000-0000-4000-8000-000000000002',
      pairId: '20000000-0000-4000-8000-000000000002',
      pairCreatedAt: '2026-11-15T12:00:03.000Z',
      pairReadyAt: '2026-11-15T12:00:05.000Z',
      pairAssignedAt: '2026-11-15T12:00:05.010Z',
      executionFinishedAt: '2026-11-15T12:00:07.000Z',
    };
    expect(auditLedgerOrdering([first, second])).toMatchObject({
      pass: false,
      overlaps: [{ reason: 'PREPARATION_BEFORE_FINISH' }],
    });
    second.pairCreatedAt = first.executionFinishedAt;
    expect(auditLedgerOrdering([first, second]).pass).toBe(true);
    expect(auditLedgerOrdering([first, first]).pairsUnique).toBe(false);
  });
});
