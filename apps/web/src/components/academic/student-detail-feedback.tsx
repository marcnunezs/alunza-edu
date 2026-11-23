'use client';

import { useEffect, useRef, useState } from 'react';
import {
  studentDetailFeedbackHistoryResponseSchema,
  studentDetailFeedbackResponseSchema,
  studentDetailReferenceResponseSchema,
  type HelpReference,
} from '@alunza/contracts';
import { Pagination } from '@/components/identity-forms';
import { useSession } from '@/components/session-provider';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { apiDownloadSource, asApiError, type ApiError } from '@/lib/api';
import { dashboardQuery } from '@/lib/dashboard-view';
import { FeedbackContent, helpStatusLabels } from './feedback-content';
import { LoadState, instantLabel } from './shared';
import {
  useStudentDetailResource,
  type StudentDetailScope,
} from './student-detail-shared';

function ReferenceDownload({
  scope,
  feedbackId,
  reference,
}: {
  scope: StudentDetailScope;
  feedbackId: string;
  reference: HelpReference;
}) {
  const { session, revision } = useSession();
  const controller = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => () => controller.current?.abort(), [revision]);
  async function download() {
    if (controller.current && !controller.current.signal.aborted) return;
    const active = new AbortController();
    controller.current = active;
    setPending(true);
    setError(null);
    try {
      const blob = await apiDownloadSource(
        `${scope.base}/feedback/${feedbackId}/sources/${reference.chunkId}/content?${dashboardQuery({ asOf: scope.asOf })}`,
        { accessToken: session?.access_token, signal: active.signal },
      );
      if (active.signal.aborted) return;
      const url = URL.createObjectURL(blob);
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
      if (!active.signal.aborted) {
        const failure = asApiError(cause);
        setError(failure);
        if ([401, 403, 404].includes(failure.status)) scope.onDenied(failure);
      }
    } finally {
      if (!active.signal.aborted) setPending(false);
      if (controller.current === active) controller.current = null;
    }
  }
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        data-cy="student-detail-download-source"
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

function Reference({
  scope,
  feedbackId,
  chunkId,
}: {
  scope: StudentDetailScope;
  feedbackId: string;
  chunkId: string;
}) {
  const resource = useStudentDetailResource(
    `${scope.base}/feedback/${feedbackId}/sources/${chunkId}?${dashboardQuery({ asOf: scope.asOf })}`,
    studentDetailReferenceResponseSchema,
    scope.onDenied,
  );
  const reference =
    resource.state.status === 'ready'
      ? resource.state.result.body.data.reference
      : null;
  return (
    <section
      className="space-y-3 rounded border p-3"
      data-cy="student-detail-reference"
    >
      <LoadState state={resource.state} reload={resource.reload} />
      {reference ? (
        <>
          <h5 className="font-semibold">
            {reference.title} · versión {reference.version}
          </h5>
          <p>{reference.locator}</p>
          <p className="whitespace-pre-wrap break-words">{reference.text}</p>
          <ReferenceDownload
            scope={scope}
            feedbackId={feedbackId}
            reference={reference}
          />
        </>
      ) : null}
    </section>
  );
}

function FeedbackDetail({
  scope,
  feedbackId,
}: {
  scope: StudentDetailScope;
  feedbackId: string;
}) {
  const resource = useStudentDetailResource(
    `${scope.base}/feedback/${feedbackId}?${dashboardQuery({ asOf: scope.asOf })}`,
    studentDetailFeedbackResponseSchema,
    scope.onDenied,
  );
  const feedback =
    resource.state.status === 'ready'
      ? resource.state.result.body.data.feedback
      : null;
  return (
    <div className="space-y-4" data-cy="student-detail-feedback-content">
      <LoadState state={resource.state} reload={resource.reload} />
      {feedback ? (
        feedback.available && feedback.help ? (
          <article className="space-y-4 rounded border p-4">
            <FeedbackContent
              kind={feedback.kind}
              hintLevel={feedback.hintLevel}
              help={feedback.help}
              showHintPolicy={false}
            />
            <p className="text-sm">
              Entregada al estudiante:{' '}
              {instantLabel(feedback.deliveredAt, scope.timezone)} (
              {scope.timezone}).
            </p>
            {feedback.help.source_refs.length ? (
              <section
                className="space-y-3"
                aria-label="Referencias de la ayuda entregada"
              >
                <h4 className="font-semibold">Fuentes de esta ayuda</h4>
                {feedback.help.source_refs.map((reference) => (
                  <Reference
                    key={reference.chunk_id}
                    scope={scope}
                    feedbackId={feedback.id}
                    chunkId={reference.chunk_id}
                  />
                ))}
              </section>
            ) : null}
          </article>
        ) : (
          <p role="status">
            Esta ayuda entregada ya no está disponible con los permisos y
            fuentes actuales. El resultado técnico del intento se conserva.
          </p>
        )
      ) : null}
    </div>
  );
}

export function StudentDetailFeedback({
  scope,
  attemptId,
}: {
  scope: StudentDetailScope;
  attemptId: string;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const resource = useStudentDetailResource(
    `${scope.base}/attempts/${attemptId}/feedback?${dashboardQuery({ asOf: scope.asOf, cursor, limit: 20 })}`,
    studentDetailFeedbackHistoryResponseSchema,
    scope.onDenied,
  );
  const history =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  return (
    <section
      className="space-y-4"
      data-cy="student-detail-feedback"
      aria-labelledby="student-detail-feedback-title"
    >
      <h3 id="student-detail-feedback-title" className="text-lg font-semibold">
        Explicación y pistas entregadas
      </h3>
      <p className="text-sm">
        Se muestra únicamente ayuda entregada al estudiante hasta el corte. Esta
        consulta docente no solicita ayuda ni registra una lectura del
        estudiante.
      </p>
      <LoadState state={resource.state} reload={resource.reload} />
      {history ? (
        <>
          {history.items.length ? (
            <ul className="space-y-3">
              {history.items.map((feedback) => (
                <li
                  key={feedback.id}
                  data-feedback-id={feedback.id}
                  data-cy="student-detail-feedback-row"
                  className="space-y-3 rounded border p-3"
                >
                  <p className="font-semibold">
                    {feedback.kind === 'HINT'
                      ? `Pista ${feedback.hintLevel} de 3`
                      : 'Explicación del intento'}
                  </p>
                  <p>{helpStatusLabels[feedback.status]}</p>
                  <p className="text-sm">
                    Entregada:{' '}
                    {instantLabel(feedback.deliveredAt, scope.timezone)} (
                    {scope.timezone}).
                  </p>
                  {feedback.available ? (
                    <Button
                      variant="outline"
                      data-cy="student-detail-open-feedback"
                      aria-expanded={selected === feedback.id}
                      onClick={() => setSelected(feedback.id)}
                    >
                      Ver ayuda entregada
                    </Button>
                  ) : (
                    <p>
                      Ayuda entregada no disponible con las fuentes y permisos
                      actuales.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>Sin ayuda entregada para este intento hasta el corte.</p>
          )}
          <Pagination
            cursor={cursor}
            hasMore={history.page.hasMore}
            onFirst={() => {
              setCursor(null);
              setSelected(null);
            }}
            onNext={() => {
              setCursor(history.page.nextCursor);
              setSelected(null);
            }}
          />
        </>
      ) : null}
      {selected ? (
        <FeedbackDetail key={selected} scope={scope} feedbackId={selected} />
      ) : null}
    </section>
  );
}
