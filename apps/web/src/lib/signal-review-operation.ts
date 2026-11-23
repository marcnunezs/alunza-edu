import { z } from 'zod';
import type { DashboardSignal, SignalReview } from '@alunza/contracts';

export function signalReviewRequest(signalId: string) {
  return {
    path: `/api/v1/signals/${z.uuid().parse(signalId)}/review`,
    method: 'PUT' as const,
    body: {},
  };
}

export function signalReviewFromCurrent(
  signal: DashboardSignal,
  classId: string,
): SignalReview | null {
  if (signal.state !== 'REVIEWED' || !signal.reviewedBy || !signal.reviewedAt)
    return null;
  return {
    signalId: signal.id,
    classId,
    studentId: signal.studentId,
    state: 'REVIEWED',
    reviewedBy: signal.reviewedBy,
    reviewedByName: signal.reviewedByName,
    reviewedAt: signal.reviewedAt,
  };
}

export function signalReviewDenied(error: { status: number }) {
  return [401, 403, 404].includes(error.status);
}

export function presentSignalFilters<
  T extends { asOf?: string; cursor?: string },
>(filters: T) {
  const { asOf: _asOf, cursor: _cursor, ...rest } = filters;
  return rest;
}
