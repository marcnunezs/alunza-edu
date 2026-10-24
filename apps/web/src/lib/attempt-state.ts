import { z } from 'zod';
import {
  submitAttemptInputSchema,
  type AttemptSummary,
  type SubmitAttemptInput,
} from '@alunza/contracts';
import { draftKey, type DraftScope } from './academic-local';

export type PendingAttempt = {
  key: string;
  input: SubmitAttemptInput;
  createdAt: number;
};
const pendingSchema = z.strictObject({
  key: z.uuid(),
  input: submitAttemptInputSchema,
  createdAt: z.number().int().nonnegative(),
  scope: z.strictObject({
    accountId: z.string().min(1),
    organizationId: z.string().min(1),
    classId: z.string().min(1),
    assignmentId: z.string().min(1),
    versionId: z.string().min(1),
  }),
});

// Session-only recovery records share the draft prefix and its logout cleanup.
export function pendingAttemptsKey(scope: DraftScope) {
  return `${draftKey(scope)}:pending:`;
}
export function readPendingAttempts(
  storage: Storage,
  scope: DraftScope,
): { operations: PendingAttempt[]; unavailable: boolean } {
  try {
    const operations: PendingAttempt[] = [];
    let unavailable = false;
    const prefix = pendingAttemptsKey(scope);
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      let parsed;
      try {
        parsed = pendingSchema.safeParse(
          JSON.parse(storage.getItem(key) ?? 'null'),
        );
      } catch {
        parsed = null;
      }
      if (
        !parsed?.success ||
        `${prefix}${parsed.data.key}` !== key ||
        parsed.data.input.exerciseVersionId !== scope.versionId
      )
        unavailable = true;
      else if (pendingAttemptsKey(parsed.data.scope) !== prefix)
        unavailable = true;
      else
        operations.push({
          key: parsed.data.key,
          input: parsed.data.input,
          createdAt: parsed.data.createdAt,
        });
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
    for (const operation of operations)
      storage.setItem(
        `${pendingAttemptsKey(scope)}${operation.key}`,
        JSON.stringify({ ...operation, scope }),
      );
    for (const key of removedKeys)
      storage.removeItem(`${pendingAttemptsKey(scope)}${key}`);
    return true;
  } catch {
    return false;
  }
}

// A closed exercise no longer provides its template or class/version projection.
// Recover only records already captured for this account and route; the POST
// still performs current server authorization before returning any result.
export function pendingScopesForAssignment(
  storage: Storage,
  accountId: string,
  organizationId: string,
  assignmentId: string,
): DraftScope[] {
  const scopes = new Map<string, DraftScope>();
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.includes(':pending:')) continue;
    let parsed;
    try {
      parsed = pendingSchema.safeParse(
        JSON.parse(storage.getItem(key) ?? 'null'),
      );
    } catch {
      continue;
    }
    if (!parsed.success) continue;
    const { scope, input, key: operationKey } = parsed.data;
    if (
      scope.accountId !== accountId ||
      scope.organizationId !== organizationId ||
      scope.assignmentId !== assignmentId ||
      scope.versionId !== input.exerciseVersionId ||
      key !== `${pendingAttemptsKey(scope)}${operationKey}`
    )
      continue;
    scopes.set(pendingAttemptsKey(scope), scope);
  }
  return [...scopes.values()];
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
