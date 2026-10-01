'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  studentExerciseResponseSchema,
  type StudentExercise,
} from '@alunza/contracts';
import {
  AcademicScope,
  TextAreaField,
  LoadError,
  academicBase,
  difficultyLabels,
} from '@/components/academic-shared';
import { useSession } from '@/components/session-provider';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useApiResource } from '@/lib/use-api-resource';
import { apiRequest, asApiError, ApiError } from '@/lib/api';
import { readDraft, writeDraft, type DraftScope } from '@/lib/academic-local';

function SolutionEditor({ exercise }: { exercise: StudentExercise }) {
  const { identity, session, draftStorageAvailable } = useSession();
  const accountId = identity.status === 'ready' ? identity.data.id : '';
  const token = session?.access_token;
  const scope: DraftScope = useMemo(
    () => ({
      accountId,
      organizationId: exercise.organizationId,
      classId: exercise.classId,
      assignmentId: exercise.activityExerciseId,
      versionId: exercise.exerciseVersionId,
    }),
    [accountId, exercise],
  );
  const [draft, setDraft] = useState(() => {
    if (!draftStorageAvailable)
      return {
        code: exercise.starterCode,
        message:
          'No recuperamos el borrador porque no se confirmó su eliminación anterior. Cierra esta pestaña para retirar los borradores locales.',
        failed: true,
      };
    try {
      const loaded = readDraft(
        window.sessionStorage,
        scope,
        exercise.starterCode,
      );
      return {
        code: loaded.code,
        message: loaded.failed
          ? 'No pudimos recuperar el borrador local. Conservamos la plantilla original.'
          : loaded.recovered
            ? 'Borrador recuperado de esta pestaña.'
            : 'Plantilla lista. Tu borrador se conservará en esta pestaña.',
        failed: loaded.failed,
      };
    } catch {
      return {
        code: exercise.starterCode,
        message:
          'No pudimos recuperar el borrador local. Conservamos la plantilla original.',
        failed: true,
      };
    }
  });
  const [accessError, setAccessError] = useState<ApiError | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const current = useRef<AbortController | null>(null);
  const recheck = useCallback(async () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setChecking(true);
    try {
      await apiRequest(
        `/api/v1/activities/${exercise.activityId}/exercises/${exercise.activityExerciseId}`,
        studentExerciseResponseSchema,
        { accessToken: token, signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setAccessError(null);
        setBlocked(false);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        const failure = asApiError(cause);
        setAccessError(failure);
        // A later outage must not undo an already confirmed denial/closure.
        if ([401, 403, 404, 409].includes(failure.status)) setBlocked(true);
      }
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  }, [exercise.activityId, exercise.activityExerciseId, token]);
  useEffect(() => {
    const checkVisible = () => {
      if (document.visibilityState === 'visible') void recheck();
    };
    const timer = window.setInterval(checkVisible, 30_000);
    window.addEventListener('focus', checkVisible);
    document.addEventListener('visibilitychange', checkVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', checkVisible);
      document.removeEventListener('visibilitychange', checkVisible);
      current.current?.abort();
    };
  }, [recheck]);
  function change(code: string) {
    let saved = false;
    try {
      if (draftStorageAvailable)
        saved = writeDraft(window.sessionStorage, scope, code);
    } catch {
      /* Keep the code even when the browser blocks storage access. */
    }
    setDraft({
      code,
      failed: !saved,
      message: saved
        ? 'Borrador guardado en esta pestaña.'
        : 'No se pudo guardar el borrador local. Tu texto sigue en el editor; cópialo antes de salir o recargar.',
    });
  }
  return (
    <div className="space-y-6">
      <Link
        href={`${academicBase(exercise.organizationId)}/actividades/${exercise.activityId}`}
        className="text-sm underline"
      >
        Volver a la actividad
      </Link>
      <h1 className="text-3xl font-semibold">{exercise.title}</h1>
      <p className="text-sm">
        JavaScript · {difficultyLabels[exercise.difficulty]} · Función solve
      </p>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Enunciado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {exercise.statement}
              </p>
              <div>
                <h2 className="text-sm font-semibold">Conceptos</h2>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {exercise.concepts.map((concept) => (
                    <li
                      key={concept.versionId}
                      className="rounded-md bg-secondary px-3 py-2 text-sm"
                    >
                      {concept.name}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-sm text-muted-foreground">
                Límites: {exercise.executionLimits.timeoutMs} ms ·{' '}
                {exercise.executionLimits.memoryBytes} bytes de memoria ·{' '}
                {exercise.executionLimits.outputBytes} bytes de salida.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Pruebas visibles</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-5">
                {exercise.tests.map((test, index) => (
                  <li key={test.id} className="space-y-2">
                    <h3 className="text-sm font-semibold">Caso {index + 1}</h3>
                    <p className="text-sm">Argumentos:</p>
                    <pre className="overflow-x-auto rounded-md bg-secondary p-3 text-sm">
                      <code>{JSON.stringify(test.args, null, 2)}</code>
                    </pre>
                    <p className="text-sm">Resultado esperado:</p>
                    <pre className="overflow-x-auto rounded-md bg-secondary p-3 text-sm">
                      <code>{JSON.stringify(test.expected, null, 2)}</code>
                    </pre>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Preparar solución</CardTitle>
            <p id="editor-help" className="text-sm text-muted-foreground">
              Escribe tu solución en JavaScript. Tab sale del editor y permite
              continuar con el teclado. El borrador permanece al recargar esta
              pestaña y se elimina al cerrar sesión.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {accessError && <RequestError error={accessError} />}
            {blocked && (
              <p role="status" className="text-sm">
                La resolución ya no está disponible. Conservamos tu texto para
                que puedas copiarlo.
              </p>
            )}
            <TextAreaField
              label="Código JavaScript de tu solución"
              name="code"
              data-cy="solution-code"
              value={draft.code}
              onChange={(event) => change(event.target.value)}
              readOnly={blocked}
              rows={20}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="min-h-96 resize-y font-mono leading-relaxed"
              aria-describedby="editor-help draft-status"
            />
            <p
              id="draft-status"
              role={draft.failed ? 'alert' : 'status'}
              className={`text-sm ${draft.failed ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {draft.message}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={checking}
              onClick={() => void recheck()}
            >
              {checking ? 'Comprobando…' : 'Comprobar disponibilidad'}
            </Button>
            <p className="text-sm text-muted-foreground">
              Puedes preparar tu solución. La ejecución y el envío de intentos
              se incorporarán en una entrega posterior.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AuthorizedSolution({
  orgId,
  activityId,
  assignmentId,
}: {
  orgId: string;
  activityId: string;
  assignmentId: string;
}) {
  const { state, reload } = useApiResource(
    `/api/v1/activities/${activityId}/exercises/${assignmentId}`,
    studentExerciseResponseSchema,
  );
  if (state.status === 'loading')
    return <p role="status">Cargando ejercicio autorizado…</p>;
  if (state.status === 'error')
    return <LoadError error={state.error} reload={reload} />;
  const exercise = state.result.body.data;
  if (exercise.organizationId !== orgId)
    return (
      <RequestError
        error={
          new ApiError(
            404,
            'RESOURCE_NOT_FOUND',
            'El recurso no está disponible o no tienes acceso.',
          )
        }
      />
    );
  return (
    <SolutionEditor
      key={`${exercise.activityExerciseId}:${exercise.exerciseVersionId}`}
      exercise={exercise}
    />
  );
}

export function SolutionPanel({
  orgId,
  activityId,
  assignmentId,
}: {
  orgId: string;
  activityId: string;
  assignmentId: string;
}) {
  return (
    <AcademicScope orgId={orgId} roles={['STUDENT']}>
      {() => (
        <AuthorizedSolution
          orgId={orgId}
          activityId={activityId}
          assignmentId={assignmentId}
        />
      )}
    </AcademicScope>
  );
}
