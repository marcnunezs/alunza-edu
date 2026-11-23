export type ActivityVisitScope = {
  actorId: string;
  sessionId: string;
  activityId: string;
};
export type ActivityVisit = {
  scope: string;
  path: string;
  key: string;
  attached: boolean;
  confirmed: boolean;
};
type VisitStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const ACTIVITY_VISIT_MARKER = 'alunzaActivityVisitV1';
const memory = new Map<string, ActivityVisit>();

export function activityVisitScopeKey(scope: ActivityVisitScope): string {
  return `${scope.actorId}:${scope.sessionId}:${scope.activityId}`;
}
export function activityVisitStorageKey(scope: ActivityVisitScope): string {
  return `alunza.activity-visit.v1:${activityVisitScopeKey(scope)}`;
}

function validVisit(value: unknown, scope: string): value is ActivityVisit {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ActivityVisit>;
  return (
    item.scope === scope &&
    typeof item.path === 'string' &&
    typeof item.key === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      item.key,
    ) &&
    typeof item.attached === 'boolean' &&
    typeof item.confirmed === 'boolean'
  );
}

function save(
  storage: VisitStorage | null,
  scope: ActivityVisitScope,
  visit: ActivityVisit,
) {
  memory.set(activityVisitScopeKey(scope), visit);
  try {
    storage?.setItem(activityVisitStorageKey(scope), JSON.stringify(visit));
  } catch {
    // History and memory preserve the key when browser storage is unavailable.
  }
}

function pending(storage: VisitStorage | null, scope: ActivityVisitScope) {
  const identity = activityVisitScopeKey(scope);
  const current = memory.get(identity);
  if (current) return current;
  try {
    const value: unknown = JSON.parse(
      storage?.getItem(activityVisitStorageKey(scope)) ?? 'null',
    );
    if (validVisit(value, identity)) return value;
  } catch {
    // A corrupt client record cannot authorize a server operation.
  }
  return null;
}

/** Called only by an explicit navigation gesture, never by a fetch or render. */
export function beginActivityVisit(
  storage: VisitStorage | null,
  scope: ActivityVisitScope,
  path: string,
  key: string,
): ActivityVisit {
  const visit = {
    scope: activityVisitScopeKey(scope),
    path,
    key,
    attached: false,
    confirmed: false,
  };
  save(storage, scope, visit);
  return visit;
}

/** The existing history entry wins over a remount, refresh or back navigation. */
export function resolveActivityVisit(
  storage: VisitStorage | null,
  scope: ActivityVisitScope,
  path: string,
  marker: unknown,
  createKey: () => string,
): ActivityVisit {
  const identity = activityVisitScopeKey(scope);
  const intent = pending(storage, scope);
  const visit =
    intent && !intent.attached && intent.path === path
      ? { ...intent, attached: true }
      : validVisit(marker, identity) && marker.path === path
        ? marker
        : {
            scope: identity,
            path,
            key: createKey(),
            attached: true,
            confirmed: false,
          };
  save(storage, scope, visit);
  return visit;
}

export function confirmActivityVisit(
  storage: VisitStorage | null,
  scope: ActivityVisitScope,
  visit: ActivityVisit,
): ActivityVisit {
  const confirmed = { ...visit, confirmed: true };
  if (pending(storage, scope)?.key === visit.key)
    save(storage, scope, confirmed);
  return confirmed;
}

/** Used only for browser deduplication; the API verifies the JWT independently. */
export function activityVisitSessionId(token: string): string | null {
  try {
    const payload: unknown = JSON.parse(
      atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')),
    );
    if (
      payload &&
      typeof payload === 'object' &&
      'session_id' in payload &&
      typeof payload.session_id === 'string'
    )
      return payload.session_id;
  } catch {
    // An invalid session must not create an anonymous visit.
  }
  return null;
}
