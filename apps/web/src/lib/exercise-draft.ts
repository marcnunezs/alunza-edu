export const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const DRAFT_PREFIX = 'alunza.exercise-draft.v1:';

export type DraftScope = {
  userId: string;
  organizationId: string;
  classId: string;
  assignmentId: string;
  exerciseVersionId: string;
};

export function draftKey(scope: DraftScope): string {
  return (
    DRAFT_PREFIX +
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

export type DraftRead =
  | { status: 'missing' | 'expired' | 'unavailable' }
  | { status: 'ready'; code: string; updatedAt: number };

// Call only after an authorized assignment response. Storage is not authorization.
export function readDraft(
  storage: Storage,
  scope: DraftScope,
  now = Date.now(),
): DraftRead {
  try {
    const key = draftKey(scope);
    const raw = storage.getItem(key);
    if (!raw) return { status: 'missing' };
    const data: unknown = JSON.parse(raw);
    if (
      typeof data !== 'object' ||
      data === null ||
      !('version' in data) ||
      data.version !== 1 ||
      !('code' in data) ||
      typeof data.code !== 'string' ||
      !('updatedAt' in data) ||
      typeof data.updatedAt !== 'number' ||
      !Number.isFinite(data.updatedAt) ||
      data.updatedAt > now
    ) {
      return { status: 'unavailable' };
    }
    if (now - data.updatedAt >= DRAFT_RETENTION_MS) {
      storage.removeItem(key);
      return { status: 'expired' };
    }
    return { status: 'ready', code: data.code, updatedAt: data.updatedAt };
  } catch {
    return { status: 'unavailable' };
  }
}

export function saveDraft(
  storage: Storage,
  scope: DraftScope,
  code: string,
  now = Date.now(),
): boolean {
  try {
    storage.setItem(
      draftKey(scope),
      JSON.stringify({ version: 1, code, updatedAt: now }),
    );
    return true;
  } catch {
    return false;
  }
}

export function discardDraft(storage: Storage, scope: DraftScope): boolean {
  try {
    storage.removeItem(draftKey(scope));
    return true;
  } catch {
    return false;
  }
}
