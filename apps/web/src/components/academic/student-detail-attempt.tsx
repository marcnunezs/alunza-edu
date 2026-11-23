'use client';

import { useEffect, useRef } from 'react';
import { studentDetailAttemptResponseSchema } from '@alunza/contracts';
import { Button } from '@/components/ui/button';
import { dashboardQuery } from '@/lib/dashboard-view';
import { AttemptResult } from './attempt-history';
import { LoadState } from './shared';
import { StudentDetailFeedback } from './student-detail-feedback';
import {
  useStudentDetailResource,
  type StudentDetailScope,
} from './student-detail-shared';

export function StudentDetailAttemptPanel({
  scope,
  attemptId,
  activation,
  onClose,
}: {
  scope: StudentDetailScope;
  attemptId: string;
  activation: number;
  onClose: () => void;
}) {
  const region = useRef<HTMLElement>(null);
  useEffect(() => {
    region.current?.focus();
  }, [attemptId, activation]);
  const resource = useStudentDetailResource(
    `${scope.base}/attempts/${attemptId}?${dashboardQuery({ asOf: scope.asOf })}`,
    studentDetailAttemptResponseSchema,
    scope.onDenied,
  );
  const value =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  return (
    <section
      ref={region}
      tabIndex={-1}
      className="space-y-5 rounded-xl border bg-card p-5 focus-visible:outline-2 focus-visible:outline-ring"
      data-cy="student-detail-attempt"
      aria-labelledby="student-detail-attempt-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="student-detail-attempt-title" className="text-xl font-semibold">
          Intento y evidencia persistida
        </h2>
        <Button variant="outline" onClick={onClose}>
          Cerrar intento
        </Button>
      </div>
      <LoadState state={resource.state} reload={resource.reload} />
      {value ? (
        <>
          <h3 className="text-lg font-semibold">{value.exercise.title}</h3>
          <p className="text-sm">
            {value.exercise.activityState === 'CLOSED'
              ? 'Actividad cerrada · Historia autorizada.'
              : 'Versión conservada de la actividad.'}
          </p>
          <details>
            <summary className="cursor-pointer underline">
              Enunciado, conceptos y pruebas visibles de esta versión
            </summary>
            <div className="mt-3 space-y-4">
              <p className="whitespace-pre-wrap break-words">
                {value.exercise.statement}
              </p>
              <ul>
                {value.exercise.concepts.map((concept) => (
                  <li key={concept.versionId}>{concept.name}</li>
                ))}
              </ul>
              <p className="text-xs break-all">
                Versión del ejercicio: {value.exercise.exerciseVersionId}
              </p>
              <h4 className="font-semibold">Pruebas visibles</h4>
              {value.exercise.tests.map((test) => (
                <div key={test.id} className="rounded border p-3">
                  <p>{test.id}</p>
                  <pre className="overflow-auto whitespace-pre-wrap break-all text-sm">
                    Argumentos: {JSON.stringify(test.args)}
                    {'\n'}Esperado: {JSON.stringify(test.expected)}
                  </pre>
                </div>
              ))}
            </div>
          </details>
          <AttemptResult
            attempt={value.attempt}
            timezone={scope.timezone}
            audience="teacher"
          />
          <StudentDetailFeedback scope={scope} attemptId={attemptId} />
        </>
      ) : null}
    </section>
  );
}
