'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  studentExerciseResponseSchema,
  type StudentExercise,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import { apiRequest, asApiError, type ApiError } from '@/lib/api';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/identity-forms';
import {
  discardDraft,
  readDraft,
  saveDraft,
  type DraftRead,
  type DraftScope,
} from '@/lib/exercise-draft';
import { difficultyLabels, LoadState, Section } from './shared';

type EditorResource = {
  key: string;
  data?: StudentExercise;
  error?: ApiError;
  pending: boolean;
  verified: boolean;
};

function useAuthorizedExercise(path: string) {
  const { session, revision } = useSession();
  const token = session?.access_token;
  const key = `${revision}:${session?.user.id ?? ''}:${path}`;
  const [state, setState] = useState<EditorResource>({
    key,
    pending: true,
    verified: false,
  });
  const active = useRef<AbortController | null>(null);
  const load = useCallback(() => {
    active.current?.abort();
    if (!token) return;
    const controller = new AbortController();
    active.current = controller;
    return apiRequest(path, studentExerciseResponseSchema, {
      accessToken: token,
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted)
          setState({
            key,
            data: response.body.data,
            pending: false,
            verified: true,
          });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const error = asApiError(cause);
        const denied = [401, 403, 404].includes(error.status);
        // Preserve an already authorized draft in memory during transport failure.
        // Authorization denial removes the content instead of trusting stale access.
        setState((previous) => ({
          key,
          data: !denied && previous.key === key ? previous.data : undefined,
          pending: false,
          verified: false,
          error,
        }));
      });
  }, [key, token, path]);
  const reload = useCallback(async () => {
    setState((previous) => ({
      key,
      data: previous.key === key ? previous.data : undefined,
      pending: true,
      verified: false,
    }));
    await load();
  }, [key, load]);
  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load]);
  const current: EditorResource =
    state.key === key ? state : { key, pending: true, verified: false };
  return { state: current, reload };
}

function AuthorizedEditor({
  exercise,
  userId,
  reload,
  verified,
}: {
  exercise: StudentExercise;
  userId: string;
  reload: () => unknown;
  verified: boolean;
}) {
  const scope: DraftScope = {
    userId,
    organizationId: exercise.organizationId,
    classId: exercise.classId,
    assignmentId: exercise.activityExerciseId,
    exerciseVersionId: exercise.exerciseVersionId,
  };
  const [initial] = useState<DraftRead>(() => {
    try {
      return readDraft(window.localStorage, scope);
    } catch {
      return { status: 'unavailable' };
    }
  });
  const [code, setCode] = useState(
    initial.status === 'ready' ? initial.code : exercise.starterCode,
  );
  const [draftStatus, setDraftStatus] = useState(
    initial.status === 'ready'
      ? 'Borrador recuperado de este navegador.'
      : initial.status === 'unavailable'
        ? 'No se pudo recuperar el borrador. Se mantiene la plantilla original.'
        : initial.status === 'expired'
          ? 'El borrador venció después de 30 días sin edición. Se muestra la plantilla.'
          : 'Plantilla lista. Tus cambios se conservarán solo en este navegador.',
  );
  const [discardOpen, setDiscardOpen] = useState(false);
  const [now, setNow] = useState(Date.parse(exercise.serverNow));
  const monotonic = useRef({
    server: Date.parse(exercise.serverNow),
    local: 0,
  });
  const editor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    monotonic.current = {
      server: Date.parse(exercise.serverNow),
      local: performance.now(),
    };
    const interval = window.setInterval(
      () =>
        setNow(
          monotonic.current.server +
            performance.now() -
            monotonic.current.local,
        ),
      250,
    );
    const focus = () => void reload();
    window.addEventListener('focus', focus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', focus);
    };
  }, [exercise.serverNow, reload]);
  useEffect(() => {
    const remaining = [exercise.opensAt, exercise.closesAt]
      .filter((value): value is string => !!value)
      .map((value) => Date.parse(value) - Date.parse(exercise.serverNow))
      .filter((delay) => delay > 0);
    if (!remaining.length) return;
    const timer = window.setTimeout(
      () => void reload(),
      Math.min(...remaining, 2_147_000_000),
    );
    return () => window.clearTimeout(timer);
  }, [exercise.opensAt, exercise.closesAt, exercise.serverNow, reload]);
  const inWindow =
    (!exercise.opensAt || now >= Date.parse(exercise.opensAt)) &&
    (!exercise.closesAt || now < Date.parse(exercise.closesAt));
  const canEdit =
    verified &&
    exercise.canEdit &&
    exercise.activityState === 'PUBLISHED' &&
    inWindow;
  return (
    <div className="space-y-6">
      <Link className="underline" href={`/actividades/${exercise.activityId}`}>
        Volver a la actividad
      </Link>
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">{exercise.title}</h1>
        <p>{difficultyLabels[exercise.difficulty]} · JavaScript</p>
        <p className="text-sm">
          Conceptos:{' '}
          {exercise.concepts.map((concept) => concept.name).join(', ')}
        </p>
      </header>
      {!canEdit ? (
        <p role="status" className="rounded-lg bg-secondary p-4">
          {verified
            ? 'Solo lectura: la actividad está cerrada, fuera de su ventana de edición o la clase está archivada. Puedes consultar el contenido y tu borrador conservado.'
            : 'Solo lectura mientras se comprueba el acceso. Conservamos tu código en esta vista; vuelve a comprobar la disponibilidad antes de seguir editando.'}
        </p>
      ) : null}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 space-y-5">
          <Section title="Enunciado">
            <p className="whitespace-pre-wrap break-words">
              {exercise.statement}
            </p>
          </Section>
          <Section title="Pruebas visibles">
            <ul className="space-y-3">
              {exercise.tests.map((test) => (
                <li
                  key={test.id}
                  data-cy="visible-test"
                  className="space-y-2 rounded-lg border p-3"
                >
                  <h3 className="font-semibold">{test.id}</h3>
                  <pre className="overflow-x-auto text-sm">
                    Argumentos: {JSON.stringify(test.args)}
                    {'\n'}Resultado esperado: {JSON.stringify(test.expected)}
                  </pre>
                </li>
              ))}
            </ul>
          </Section>
        </div>
        <section className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
          <h2 className="text-xl font-semibold">Tu solución</h2>
          <p id="editor-help" className="text-sm text-muted-foreground">
            Tab permite salir del editor. Borrador local por 30 días desde la
            última edición; se conserva al cerrar sesión. No se sincroniza entre
            dispositivos.
          </p>
          <label htmlFor="student-code" className="block text-sm font-semibold">
            Código JavaScript
          </label>
          <textarea
            ref={editor}
            id="student-code"
            data-cy="student-code"
            aria-describedby="editor-help draft-status"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            readOnly={!canEdit}
            rows={18}
            value={code}
            className="w-full resize-y rounded-lg border border-input bg-background p-4 font-mono text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onChange={(event) => {
              if (!canEdit) return;
              const eventNow =
                monotonic.current.server +
                performance.now() -
                monotonic.current.local;
              if (
                exercise.closesAt &&
                eventNow >= Date.parse(exercise.closesAt)
              )
                return;
              const value = event.target.value;
              setCode(value);
              try {
                setDraftStatus(
                  saveDraft(window.localStorage, scope, value)
                    ? 'Borrador guardado en este navegador.'
                    : 'No se pudo guardar el borrador local. Conserva una copia antes de salir.',
                );
              } catch {
                setDraftStatus(
                  'No se pudo guardar el borrador local. Conserva una copia antes de salir.',
                );
              }
            }}
          />
          <p id="draft-status" role="status" className="text-sm">
            {draftStatus}
          </p>
          <div className="flex flex-wrap gap-3">
            <FormDialog
              title="Descartar borrador"
              description="Se eliminará el borrador de esta cuenta y ejercicio en este navegador. La plantilla original volverá a mostrarse."
              trigger={<Button variant="outline">Descartar borrador</Button>}
              open={discardOpen}
              onOpenChange={setDiscardOpen}
            >
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => {
                    let removed = false;
                    try {
                      removed = discardDraft(window.localStorage, scope);
                    } catch {
                      /* Storage denied. */
                    }
                    if (removed) {
                      setCode(exercise.starterCode);
                      setDraftStatus(
                        'Borrador descartado. Se muestra la plantilla original.',
                      );
                    } else
                      setDraftStatus(
                        'No se pudo descartar el borrador local. Tu código sigue visible.',
                      );
                    setDiscardOpen(false);
                    editor.current?.focus();
                  }}
                >
                  Confirmar descarte
                </Button>
                <Button variant="ghost" onClick={() => setDiscardOpen(false)}>
                  Cancelar
                </Button>
              </div>
            </FormDialog>
            <Button variant="ghost" onClick={() => void reload()}>
              Actualizar disponibilidad
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Límites del ejercicio: 128 MiB de memoria, 3 segundos y 64 KiB de
            salida.
          </p>
        </section>
      </div>
    </div>
  );
}

export function EditorPanel({
  activityId,
  assignmentId,
}: {
  activityId: string;
  assignmentId: string;
}) {
  const { identity } = useSession();
  const resource = useAuthorizedExercise(
    `/api/v1/activities/${encodeURIComponent(activityId)}/exercises/${encodeURIComponent(assignmentId)}`,
  );
  if (!resource.state.data)
    return (
      <LoadState
        state={
          resource.state.error
            ? { status: 'error', error: resource.state.error }
            : { status: 'loading' }
        }
        reload={resource.reload}
      />
    );
  if (identity.status !== 'ready') return null;
  const exercise = resource.state.data;
  return (
    <div className="space-y-5">
      {resource.state.error ? (
        <RequestError error={resource.state.error} />
      ) : null}
      <AuthorizedEditor
        key={`${identity.data.id}:${exercise.organizationId}:${exercise.classId}:${exercise.activityExerciseId}:${exercise.exerciseVersionId}`}
        exercise={exercise}
        userId={identity.data.id}
        reload={resource.reload}
        verified={resource.state.verified}
      />
    </div>
  );
}
