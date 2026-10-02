import { z } from 'zod';
import {
  submitAttemptInputSchema,
  type AttemptSummary,
  type SubmitAttemptInput,
} from '@alunza/contracts';
import type { DraftScope } from './exercise-draft';

export type PendingAttempt = {
  key: string;
  input: SubmitAttemptInput;
  createdAt: number;
};
export const PENDING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const pendingOperationSchema = z.strictObject({
  key: z.uuid(),
  input: submitAttemptInputSchema,
  createdAt: z.number().int().nonnegative(),
});
const legacyPendingSchema = z.array(pendingOperationSchema).max(2);

export function pendingAttemptsKey(scope: DraftScope) {
  return (
    'alunza.pending-attempts.v1:' +
    [
      scope.userId,
      scope.organizationId,
      scope.classId,
      scope.assignmentId,
      scope.exerciseVersionId,
    ]
      .map(encodeURIComponent)
      .join(':')
  );
}

function operationStorageKey(scope: DraftScope, key: string) {
  return `${pendingAttemptsKey(scope)}:${key}`;
}

// The earlier browser format stored one array per scope. Preserve every entry
// before removing that array; all subsequent writes affect individual keys.
function migratePendingAttempts(storage: Storage, scope: DraftScope): boolean {
  const legacyKey = pendingAttemptsKey(scope);
  const raw = storage.getItem(legacyKey);
  if (!raw) return false;
  let parsed;
  try {
    parsed = legacyPendingSchema.safeParse(JSON.parse(raw));
  } catch {
    storage.removeItem(legacyKey);
    return true;
  }
  if (
    !parsed.success ||
    parsed.data.some(
      (item) => item.input.exerciseVersionId !== scope.exerciseVersionId,
    ) ||
    new Set(parsed.data.map((item) => item.key)).size !== parsed.data.length
  ) {
    storage.removeItem(legacyKey);
    return true;
  }
  for (const item of parsed.data) {
    const key = operationStorageKey(scope, item.key);
    if (storage.getItem(key) === null)
      storage.setItem(key, JSON.stringify(item));
  }
  storage.removeItem(legacyKey);
  return false;
}

// Access is checked by the editor before reading. Local storage is never proof
// of admission: recovery always submits the original operation to the API.
export function readPendingAttempts(
  storage: Storage,
  scope: DraftScope,
  now = Date.now(),
): {
  operations: PendingAttempt[];
  unavailable: boolean;
} {
  try {
    let unavailable = migratePendingAttempts(storage, scope);
    const prefix = `${pendingAttemptsKey(scope)}:`;
    const keys: string[] = [];
    // Snapshot keys before expiration removes any entries and shifts indexes.
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    const operations: PendingAttempt[] = [];
    for (const key of keys) {
      let parsed;
      try {
        parsed = pendingOperationSchema.safeParse(
          JSON.parse(storage.getItem(key) ?? 'null'),
        );
      } catch {
        parsed = null;
      }
      if (
        !parsed?.success ||
        operationStorageKey(scope, parsed.data.key) !== key ||
        parsed.data.input.exerciseVersionId !== scope.exerciseVersionId ||
        parsed.data.createdAt > now ||
        now - parsed.data.createdAt >= PENDING_RETENTION_MS
      ) {
        storage.removeItem(key);
        unavailable = true;
      } else operations.push(parsed.data);
    }
    operations.sort(
      (a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key),
    );
    return { operations, unavailable };
  } catch {
    return { operations: [], unavailable: true };
  }
}

export function savePendingAttempts(
  storage: Storage,
  scope: DraftScope,
  operations: PendingAttempt[],
  removedKeys: string[] = [],
) {
  try {
    migratePendingAttempts(storage, scope);
    for (const operation of operations)
      storage.setItem(
        operationStorageKey(scope, operation.key),
        JSON.stringify(operation),
      );
    for (const key of removedKeys)
      storage.removeItem(operationStorageKey(scope, key));
    return true;
  } catch {
    return false;
  }
}

export function compareAttempts(first: AttemptSummary, second: AttemptSummary) {
  if (
    first.attemptId === second.attemptId ||
    first.assignmentId !== second.assignmentId ||
    first.exerciseVersionId !== second.exerciseVersionId ||
    first.testsVersion !== second.testsVersion
  )
    return { comparable: false as const };
  const [earlier, later] =
    first.attemptNumber < second.attemptNumber
      ? [first, second]
      : [second, first];
  return {
    comparable: true as const,
    earlier,
    later,
    difference:
      later.technicalResult.visiblePassed -
      earlier.technicalResult.visiblePassed,
  };
}
