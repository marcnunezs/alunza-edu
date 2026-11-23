'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentProps } from 'react';
import { activityOpenResponseSchema } from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import { Button } from '@/components/ui/button';
import { apiRequest, asApiError, type ApiError } from '@/lib/api';
import {
  ACTIVITY_VISIT_MARKER,
  activityVisitScopeKey,
  activityVisitSessionId,
  beginActivityVisit,
  confirmActivityVisit,
  resolveActivityVisit,
  type ActivityVisit,
  type ActivityVisitScope,
} from '@/lib/activity-visit';

const VISIT_EVENT = 'alunza:activity-navigation';
const inFlight = new Map<string, Promise<void>>();
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
function record(
  scope: ActivityVisitScope,
  visit: ActivityVisit,
  token: string,
) {
  const requestKey = `${visit.scope}:${visit.key}`;
  const existing = inFlight.get(requestKey);
  if (existing) return existing;
  const request = apiRequest(
    `/api/v1/activities/${scope.activityId}/open-events`,
    activityOpenResponseSchema,
    {
      accessToken: token,
      method: 'POST',
      body: {},
      idempotencyKey: visit.key,
    },
  ).then(
    () => {
      inFlight.delete(requestKey);
    },
    (error: unknown) => {
      inFlight.delete(requestKey);
      throw error;
    },
  );
  inFlight.set(requestKey, request);
  return request;
}

export function ActivityVisitLink({
  activityId,
  href,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href'> & {
  href: string;
  activityId: string;
}) {
  const { session } = useSession();
  return (
    <Link
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          (props.target && props.target !== '_self') ||
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        const sessionId = session
          ? activityVisitSessionId(session.access_token)
          : null;
        if (!sessionId || !session) return;
        beginActivityVisit(
          storage(),
          { actorId: session.user.id, sessionId, activityId },
          href,
          crypto.randomUUID(),
        );
        window.dispatchEvent(
          new CustomEvent(VISIT_EVENT, { detail: { path: href } }),
        );
      }}
    />
  );
}

export function ActivityVisitCapture({ activityId }: { activityId: string }) {
  const { session } = useSession();
  const path = usePathname();
  const token = session?.access_token;
  const actorId = session?.user.id;
  const sessionId = token ? activityVisitSessionId(token) : null;
  const identity =
    actorId && sessionId
      ? activityVisitScopeKey({ actorId, sessionId, activityId })
      : '';
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    identity: string;
    error: ApiError | null;
  }>({ identity: '', error: null });

  useEffect(() => {
    if (!token || !actorId || !sessionId) return;
    const scope = { actorId, sessionId, activityId };
    let disposed = false;
    function capture() {
      const visit = resolveActivityVisit(
        storage(),
        scope,
        path,
        window.history.state?.[ACTIVITY_VISIT_MARKER],
        () => crypto.randomUUID(),
      );
      // Preserve Next's router state. This marker survives a technical refresh.
      window.history.replaceState(
        { ...window.history.state, [ACTIVITY_VISIT_MARKER]: visit },
        '',
      );
      if (visit.confirmed) return;
      void record(scope, visit, token!)
        .then(() => {
          const confirmed = confirmActivityVisit(storage(), scope, visit);
          if (window.history.state?.[ACTIVITY_VISIT_MARKER]?.key === visit.key)
            window.history.replaceState(
              { ...window.history.state, [ACTIVITY_VISIT_MARKER]: confirmed },
              '',
            );
          if (!disposed) setState({ identity, error: null });
        })
        .catch((cause: unknown) => {
          if (!disposed) setState({ identity, error: asApiError(cause) });
        });
    }
    const navigate = (event: Event) => {
      if ((event as CustomEvent<{ path: string }>).detail.path === path)
        capture();
    };
    capture();
    window.addEventListener(VISIT_EVENT, navigate);
    return () => {
      disposed = true;
      window.removeEventListener(VISIT_EVENT, navigate);
    };
  }, [activityId, actorId, sessionId, token, path, identity, retry]);

  if (state.identity !== identity || !state.error) return null;
  return (
    <div
      className="space-y-2 text-sm"
      data-cy="activity-visit-error"
      role="status"
    >
      <p>No se pudo confirmar la apertura. Puedes continuar con la práctica.</p>
      <Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>
        Reintentar registro de apertura
      </Button>
    </div>
  );
}
