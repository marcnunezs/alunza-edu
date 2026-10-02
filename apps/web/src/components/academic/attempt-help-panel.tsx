'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  helpFeedbackResponseSchema,
  helpHistoryResponseSchema,
  helpReferenceResponseSchema,
  helpRequestResponseSchema,
  type Attempt,
  type HelpFeedback,
  type HelpRequestInput,
  type HelpReference,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import { Button } from '@/components/ui/button';
import { RequestError } from '@/components/request-error';
import { Pagination } from '@/components/identity-forms';
import {
  apiDownloadSource,
  apiRequest,
  asApiError,
  type ApiError,
} from '@/lib/api';
import { useApiResource } from '@/lib/use-api-resource';
import { LoadState, instantLabel } from './shared';

const statusLabels = {
  SUPPORTED: 'Ayuda con fuente',
  NO_EVIDENCE: 'Sin fuente suficiente',
  PROVIDER_UNAVAILABLE: 'Ayuda temporalmente no disponible',
} as const;

type HelpIntention = { key: string; input: HelpRequestInput };
const HelpIntentions = createContext<Map<string, HelpIntention> | null>(null);

function SessionHelpScope({ children }: { children: ReactNode }) {
  const [intentions] = useState(() => new Map<string, HelpIntention>());
  useEffect(() => () => intentions.clear(), [intentions]);
  return (
    <HelpIntentions.Provider value={intentions}>
      {children}
    </HelpIntentions.Provider>
  );
}

// This scope stays mounted while the editor revalidates access. It retains only
// operation identity, never help content, references or presentation tokens.
export function AttemptHelpScope({ children }: { children: ReactNode }) {
  const { session, sessionGeneration } = useSession();
  return (
    <SessionHelpScope key={`${sessionGeneration}:${session?.user.id ?? ''}`}>
      {children}
    </SessionHelpScope>
  );
}

// An uncertain POST keeps its exact intention, including across token renewal.
// The enclosing account/attempt key discards it when the identity changes.
export function useHelpSubmission(attemptId: string) {
  const { session, revision } = useSession();
  const intentions = useContext(HelpIntentions);
  const operation = useRef<{
    key: string;
    input: HelpRequestInput;
    controller: AbortController;
  } | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const [state, setState] = useState<{
    revision: number;
    pending: boolean;
    unconfirmed: boolean;
    error: ApiError | null;
  }>({
    revision,
    pending: false,
    unconfirmed: intentions?.has(attemptId) ?? false,
    error: null,
  });
  useEffect(() => () => operation.current?.controller.abort(), [revision]);
  const pending = state.revision === revision && state.pending;
  async function run(input?: HelpRequestInput) {
    if (!session || (inFlight.current && !inFlight.current.signal.aborted))
      return null;
    const previous = operation.current ?? intentions?.get(attemptId);
    if (!previous && !input) return null;
    const request = {
      key: previous?.key ?? crypto.randomUUID(),
      input: previous?.input ?? input!,
      controller: new AbortController(),
    };
    operation.current = request;
    intentions?.set(attemptId, { key: request.key, input: request.input });
    inFlight.current = request.controller;
    setState({ revision, pending: true, unconfirmed: true, error: null });
    try {
      const response = await apiRequest(
        `/api/v1/attempts/${attemptId}/feedback-requests`,
        helpRequestResponseSchema,
        {
          method: 'POST',
          body: request.input,
          idempotencyKey: request.key,
          accessToken: session.access_token,
          signal: request.controller.signal,
        },
      );
      if (request.controller.signal.aborted) return null;
      operation.current = null;
      if (intentions?.get(attemptId)?.key === request.key)
        intentions.delete(attemptId);
      setState({ revision, pending: false, unconfirmed: false, error: null });
      return response.body.data;
    } catch (cause) {
      if (request.controller.signal.aborted) return null;
      const error = asApiError(cause);
      const definitive =
        error.status < 500 &&
        !error.retryable &&
        error.code !== 'REQUEST_IN_PROGRESS';
      if (definitive) {
        operation.current = null;
        if (intentions?.get(attemptId)?.key === request.key)
          intentions.delete(attemptId);
      }
      setState({ revision, pending: false, unconfirmed: !definitive, error });
      return null;
    } finally {
      if (inFlight.current === request.controller) inFlight.current = null;
    }
  }
  return {
    run,
    pending,
    unresolved: state.unconfirmed && !pending,
    error: state.revision === revision ? state.error : null,
  };
}

function ReferenceDownload({
  feedbackId,
  reference,
  onUnavailable,
}: {
  feedbackId: string;
  reference: HelpReference;
  onUnavailable: () => void;
}) {
  const { session, revision } = useSession();
  const active = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => () => active.current?.abort(), [revision]);
  async function download() {
    if (active.current && !active.current.signal.aborted) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    try {
      const content = await apiDownloadSource(
        `/api/v1/feedback/${feedbackId}/sources/${reference.chunkId}/content`,
        { accessToken: session?.access_token, signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(content);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = Array.from(reference.fileName, (character) =>
          character.charCodeAt(0) < 32 ||
          character.charCodeAt(0) === 127 ||
          character === '/' ||
          character === '\\'
            ? '_'
            : character,
        ).join('');
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        const failure = asApiError(cause);
        setError(failure);
        if ([401, 403, 404].includes(failure.status)) onUnavailable();
      }
    } finally {
      if (!controller.signal.aborted) setPending(false);
      if (active.current === controller) active.current = null;
    }
  }
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        data-cy="download-help-source"
        disabled={pending}
        onClick={() => void download()}
      >
        {pending
          ? 'Descargando…'
          : `Descargar documento · versión ${reference.version}`}
      </Button>
      {error ? <RequestError error={error} /> : null}
    </div>
  );
}

function SourceReference({
  feedbackId,
  chunkId,
  onUnavailable,
}: {
  feedbackId: string;
  chunkId: string;
  onUnavailable: () => void;
}) {
  const reference = useApiResource(
    `/api/v1/feedback/${feedbackId}/sources/${chunkId}`,
    helpReferenceResponseSchema,
  );
  const denied =
    reference.state.status === 'error' &&
    [401, 403, 404].includes(reference.state.error.status);
  useEffect(() => {
    if (denied) onUnavailable();
  }, [denied, onUnavailable]);
  return (
    <div className="space-y-3 rounded border p-3" data-cy="help-reference">
      <LoadState state={reference.state} reload={reference.reload} />
      {reference.state.status === 'ready' ? (
        <>
          <p className="font-semibold">
            {reference.state.result.body.data.title} · versión{' '}
            {reference.state.result.body.data.version}
          </p>
          <p data-cy="help-reference-locator">
            {reference.state.result.body.data.locator}
          </p>
          <p
            className="whitespace-pre-wrap break-words"
            data-cy="help-reference-text"
          >
            {reference.state.result.body.data.text}
          </p>
          <ReferenceDownload
            feedbackId={feedbackId}
            reference={reference.state.result.body.data}
            onUnavailable={onUnavailable}
          />
        </>
      ) : null}
    </div>
  );
}

function PresentedFeedback({
  feedback,
  onViewed,
  onUnavailable,
}: {
  feedback: HelpFeedback;
  onViewed: () => unknown;
  onUnavailable: () => void;
}) {
  const { session, revision } = useSession();
  const accessToken = session?.access_token;
  const active = useRef<AbortController | null>(null);
  const attempted = useRef<string | null>(null);
  const [ack, setAck] = useState<'pending' | 'saved' | 'error'>(
    feedback.viewedAt ? 'saved' : 'pending',
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [denied, setDenied] = useState(false);
  const token = feedback.presentationToken;
  const acknowledge = useCallback(async () => {
    if (
      !token ||
      !accessToken ||
      (active.current && !active.current.signal.aborted)
    )
      return;
    const controller = new AbortController();
    active.current = controller;
    setAck('pending');
    setError(null);
    try {
      const response = await apiRequest(
        `/api/v1/feedback/${feedback.id}/viewed`,
        helpFeedbackResponseSchema,
        {
          method: 'POST',
          body: { presentationToken: token },
          accessToken,
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      if (!response.body.data.available) {
        setDenied(true);
        void onViewed();
        return;
      }
      setAck('saved');
      void onViewed();
    } catch (cause) {
      if (!controller.signal.aborted) {
        const failure = asApiError(cause);
        setAck('error');
        setError(failure);
        if ([401, 403, 404].includes(failure.status)) setDenied(true);
      }
    } finally {
      if (active.current === controller) active.current = null;
    }
  }, [accessToken, feedback.id, onViewed, token]);
  useEffect(() => {
    // This component exists only after the student explicitly opens the detail.
    // The effect runs after the validated content is committed to the page.
    function present() {
      const key = `${revision}:${token}`;
      if (
        document.visibilityState === 'visible' &&
        token &&
        !feedback.viewedAt &&
        attempted.current !== key
      ) {
        attempted.current = key;
        void acknowledge();
      }
    }
    present();
    document.addEventListener('visibilitychange', present);
    return () => {
      document.removeEventListener('visibilitychange', present);
      if (active.current && !active.current.signal.aborted) {
        active.current.abort();
        // Effect replay must retry an interrupted acknowledgement with the
        // same server token, including React's development StrictMode cycle.
        attempted.current = null;
      }
    };
  }, [acknowledge, feedback.viewedAt, revision, token]);
  if (denied)
    return (
      <p role="status">
        Esta ayuda ya no está disponible con los permisos actuales.
      </p>
    );
  return (
    <article className="space-y-4 rounded-lg border p-4" data-cy="help-detail">
      <h4 className="font-semibold">
        {feedback.kind === 'FEEDBACK'
          ? 'Explicación del intento'
          : `Pista ${feedback.hintLevel} de 3`}
      </h4>
      <p data-cy="help-status" data-status={feedback.help.status}>
        {statusLabels[feedback.help.status]}
      </p>
      <p className="whitespace-pre-wrap break-words" data-cy="help-explanation">
        {feedback.help.explanation}
      </p>
      {feedback.help.hint ? (
        <p className="whitespace-pre-wrap break-words" data-cy="help-hint">
          {feedback.help.hint}
        </p>
      ) : null}
      {feedback.help.status !== 'SUPPORTED' ? (
        <p>
          El diagnóstico técnico del intento se conserva. Esta respuesta no
          consume un nivel de pista.
        </p>
      ) : null}
      {token ? (
        <div role="status" className="space-y-2">
          <p>
            {ack === 'saved'
              ? 'Lectura registrada.'
              : ack === 'pending'
                ? 'Registrando la lectura…'
                : 'No se pudo confirmar la lectura. Comprueba la misma respuesta antes de pedir otra pista.'}
          </p>
          {error ? <RequestError error={error} /> : null}
          {ack === 'error' ? (
            <Button variant="outline" onClick={() => void acknowledge()}>
              Confirmar lectura
            </Button>
          ) : null}
        </div>
      ) : null}
      {feedback.help.source_refs.length ? (
        <section className="space-y-3" aria-label="Referencias de la ayuda">
          <h5 className="font-semibold">Fuentes de esta ayuda</h5>
          {feedback.help.source_refs.map((reference) => (
            <SourceReference
              key={reference.chunk_id}
              feedbackId={feedback.id}
              chunkId={reference.chunk_id}
              onUnavailable={onUnavailable}
            />
          ))}
        </section>
      ) : null}
    </article>
  );
}

function FeedbackDetail({
  id,
  attemptId,
  onViewed,
  onUnavailable,
}: {
  id: string;
  attemptId: string;
  onViewed: () => unknown;
  onUnavailable: () => void;
}) {
  const resource = useApiResource(
    `/api/v1/feedback/${id}`,
    helpFeedbackResponseSchema,
  );
  const feedback =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  return (
    <div className="space-y-3">
      <LoadState state={resource.state} reload={resource.reload} />
      {feedback && feedback.attemptId === attemptId && feedback.available ? (
        <PresentedFeedback
          key={feedback.id}
          feedback={feedback}
          onViewed={onViewed}
          onUnavailable={onUnavailable}
        />
      ) : feedback ? (
        <p role="status">
          Esta ayuda ya no está disponible con los permisos actuales.
        </p>
      ) : null}
    </div>
  );
}

function HelpPanel({ attempt }: { attempt: Attempt }) {
  const { session, revision } = useSession();
  const accessToken = session?.access_token;
  const [cursor, setCursor] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
    id: string;
    revision: number;
    activation: string;
  } | null>(null);
  const history = useApiResource(
    `/api/v1/attempts/${attempt.attemptId}/feedback?limit=20${cursor ? `&cursor=${cursor}` : ''}`,
    helpHistoryResponseSchema,
  );
  const operation = useHelpSubmission(attempt.attemptId);
  const [pollStopped, setPollStopped] = useState(false);
  const [pollError, setPollError] = useState<ApiError | null>(null);
  const lifecycle = useRef({ revision, mounted: false });
  useEffect(() => {
    lifecycle.current = { revision, mounted: true };
    return () => {
      lifecycle.current.mounted = false;
    };
  }, [revision]);
  const data =
    history.state.status === 'ready' ? history.state.result.body.data : null;
  const requestId = data?.capabilities.pendingRequest?.id;
  const refresh = history.refresh;
  useEffect(() => {
    if (!requestId || !accessToken) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checks = 0;
    async function poll() {
      try {
        const result = await apiRequest(
          `/api/v1/feedback-requests/${requestId}`,
          helpRequestResponseSchema,
          {
            accessToken,
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        if (
          result.body.data.state !== 'QUEUED' &&
          result.body.data.state !== 'RUNNING'
        ) {
          await refresh();
          return;
        }
        checks++;
        if (checks < 30) timer = setTimeout(() => void poll(), 1000);
        else setPollStopped(true);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setPollError(asApiError(cause));
          setPollStopped(true);
        }
      }
    }
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [requestId, accessToken, refresh, revision]);
  async function requestHelp(input?: HelpRequestInput) {
    await operation.run(input);
    if (!lifecycle.current.mounted || lifecycle.current.revision !== revision)
      return;
    setPollStopped(false);
    setPollError(null);
    await refresh();
  }
  const onViewed = useCallback(() => refresh(), [refresh]);
  const reloadHistory = history.reload;
  const onUnavailable = useCallback(() => {
    setSelection(null);
    void reloadHistory();
  }, [reloadHistory]);
  const selected = selection?.revision === revision ? selection : null;
  function openFeedback(id: string) {
    setSelection({ id, revision, activation: crypto.randomUUID() });
  }
  const caps = data?.capabilities;
  const busy =
    operation.pending || operation.unresolved || !!caps?.pendingRequest;
  const hintUnavailable =
    attempt.technicalResult.diagnosisCode === 'SUCCESS' ||
    attempt.technicalResult.infrastructureStatus === 'FAILED';
  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-4"
      data-cy="attempt-help"
    >
      <h3 className="text-lg font-semibold">
        Ayuda para el intento #{attempt.attemptNumber}
      </h3>
      <p className="text-sm">
        La ayuda usa el código de este intento guardado. Los cambios del
        borrador no modifican esta evidencia.
      </p>
      <LoadState state={history.state} reload={history.reload} />
      {operation.error ? <RequestError error={operation.error} /> : null}
      {operation.unresolved ? (
        <div className="space-y-2">
          <p>
            La solicitud no está confirmada en esta vista. Recupérala con la
            misma clave antes de pedir otra ayuda.
          </p>
          <Button
            data-cy="recover-help"
            variant="outline"
            onClick={() => void requestHelp()}
          >
            Recuperar solicitud de ayuda
          </Button>
        </div>
      ) : null}
      {caps ? (
        <>
          {caps.reason === 'CLASS_ARCHIVED' ? (
            <p>
              La clase está archivada. El historial conserva el registro de las
              ayudas, pero su contenido y las nuevas solicitudes ya no están
              disponibles.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              data-cy="request-feedback"
              disabled={busy || !caps.canExplain}
              onClick={() => void requestHelp({ kind: 'FEEDBACK' })}
            >
              Pedir explicación
            </Button>
            <Button
              data-cy="request-hint"
              disabled={busy || !caps.canHint || !caps.nextHintLevel}
              onClick={() =>
                void requestHelp({
                  kind: 'HINT',
                  hintLevel: caps.nextHintLevel!,
                })
              }
            >
              {caps.nextHintLevel
                ? `Pedir pista ${caps.nextHintLevel} de 3`
                : 'Pistas no disponibles'}
            </Button>
          </div>
          {hintUnavailable ? (
            <p>
              Este intento permite consultar una explicación, pero no consume
              pistas progresivas.
            </p>
          ) : caps.reason === 'HINT_LEVELS_EXHAUSTED' ? (
            <p>
              Ya se entregaron los tres niveles de pista de este intento.
              Conserva estas ayudas y prepara un nuevo intento cuando la
              actividad lo permita.
            </p>
          ) : null}
          {caps.pendingRequest ? (
            <p role="status" data-cy="help-pending">
              {caps.pendingRequest.state === 'QUEUED'
                ? 'La ayuda está en espera.'
                : 'Preparando la ayuda.'}{' '}
              Tu intento permanece guardado.
            </p>
          ) : null}
          {operation.pending ? (
            <p role="status">Registrando la solicitud de ayuda…</p>
          ) : null}
          {caps.preparedFeedbackId ? (
            <Button
              variant="outline"
              data-cy="open-prepared-help"
              onClick={() => openFeedback(caps.preparedFeedbackId!)}
            >
              Abrir ayuda preparada
            </Button>
          ) : null}
          {pollStopped ? (
            <p role="status">
              El seguimiento automático terminó. Consulta el estado para
              recuperar el resultado; el trabajo registrado permanece en el
              servidor.
            </p>
          ) : null}
          {pollError ? <RequestError error={pollError} /> : null}
          <Button
            variant="ghost"
            data-cy="refresh-help"
            onClick={() => {
              setPollStopped(false);
              setPollError(null);
              void history.reload();
            }}
          >
            Consultar estado e historial de ayudas
          </Button>
          <div className="space-y-2">
            <h4 className="font-semibold">Historial de ayudas</h4>
            {data!.items.length ? (
              <ol className="space-y-2">
                {data!.items.map((item) => (
                  <li
                    key={item.id}
                    className="space-y-2 rounded border p-3"
                    data-cy="help-history-row"
                  >
                    <p>
                      {item.kind === 'FEEDBACK'
                        ? 'Explicación'
                        : `Pista ${item.hintLevel}`}{' '}
                      · {statusLabels[item.status]} ·{' '}
                      {instantLabel(item.createdAt)}
                    </p>
                    <p>
                      {!item.available
                        ? 'Contenido no disponible con los permisos actuales.'
                        : item.viewedAt
                          ? 'Consultada'
                          : item.status !== 'SUPPORTED'
                            ? 'Esta respuesta no consume un nivel de pista.'
                            : 'Pendiente de abrir'}
                    </p>
                    <Button
                      variant="outline"
                      data-cy="show-help"
                      disabled={!item.available}
                      onClick={() => openFeedback(item.id)}
                    >
                      {item.kind === 'FEEDBACK'
                        ? 'Mostrar explicación'
                        : `Mostrar pista ${item.hintLevel}`}
                    </Button>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No hay ayudas guardadas para este intento.</p>
            )}
            <Pagination
              cursor={cursor}
              hasMore={data!.nextCursor !== null}
              onFirst={() => setCursor(null)}
              onNext={() => setCursor(data!.nextCursor)}
            />
          </div>
        </>
      ) : null}
      {selected &&
      data &&
      !data.items.some((item) => item.id === selected.id && !item.available) ? (
        <FeedbackDetail
          key={`${revision}:${selected.id}:${selected.activation}`}
          id={selected.id}
          attemptId={attempt.attemptId}
          onViewed={onViewed}
          onUnavailable={onUnavailable}
        />
      ) : null}
    </section>
  );
}

export function AttemptHelpPanel({ attempt }: { attempt: Attempt }) {
  const { session, sessionGeneration } = useSession();
  if (!session) return null;
  return (
    <HelpPanel
      key={`${sessionGeneration}:${session.user.id}:${attempt.attemptId}`}
      attempt={attempt}
    />
  );
}
