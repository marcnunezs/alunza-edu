import { createHash } from 'node:crypto';
import type { SignalBoundary, SignalEvaluationOutput } from './signals.types';
import { normalizeSignalInstant } from './signal-time';

/** Stable JSON, deliberately rejecting values JSON would silently discard. */
export function canonicalSignalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite signal evidence.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map(canonicalSignalJson).join(',')}]`;
  if (
    typeof value !== 'object' ||
    Object.prototype.toString.call(value) !== '[object Object]'
  )
    throw new Error('Signal evidence must contain JSON values only.');
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalSignalJson(record[key])}`)
    .join(',')}}`;
}

export function signalHash(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(`alunza.signals.1:${domain}\n`)
    .update(canonicalSignalJson(value))
    .digest('hex');
}

export function signalBoundaryKey(boundary: SignalBoundary): string {
  return signalHash('boundary', {
    kind: boundary.kind,
    at: normalizeSignalInstant(boundary.at),
    reference: boundary.reference,
    sequence: boundary.sequence ?? null,
  });
}

export function signalWitnessKey(
  result: SignalEvaluationOutput,
): string | null {
  if (result.outcome !== 'MATCH') return null;
  if (!result.ruleVersionId || !result.evidence)
    throw new Error('Qualified signal evidence is incomplete.');
  const witness =
    result.type === 'INACTIVITY'
      ? {
          lastAt: normalizeSignalInstant(result.evidence.lastAt),
          coverageEpoch: result.evidence.coverageEpoch,
        }
      : { attemptIds: [...result.selectedAttemptIds] };
  return signalHash('witness', {
    scope: result.scope,
    type: result.type,
    ruleVersionId: result.ruleVersionId,
    witness,
  });
}

export function signalEvaluationKey(
  result: SignalEvaluationOutput,
  boundary: SignalBoundary,
): string {
  return signalHash('evaluation', {
    scope: result.scope,
    type: result.type,
    ruleVersionId: result.ruleVersionId,
    algorithmVersion: result.algorithmVersion,
    snapshot: result.snapshot,
    evaluationTime: normalizeSignalInstant(result.evaluationTime),
    boundaryKey: signalBoundaryKey(boundary),
  });
}

/** Tick time/elapsed duration do not manufacture a new semantic observation. */
export function signalSemanticKey(result: SignalEvaluationOutput): string {
  let evidence: unknown = result.evidence;
  if (result.type === 'INACTIVITY' && result.evidence) {
    const { elapsedMicroseconds: _elapsed, ...stable } = result.evidence;
    evidence = stable;
  }
  return signalHash('meaning', {
    scope: result.scope,
    type: result.type,
    ruleVersionId: result.ruleVersionId,
    algorithmVersion: result.algorithmVersion,
    outcome: result.outcome,
    reason: result.reason,
    evidence,
    selectedAttemptIds:
      result.type === 'INACTIVITY' ? null : result.selectedAttemptIds,
  });
}
