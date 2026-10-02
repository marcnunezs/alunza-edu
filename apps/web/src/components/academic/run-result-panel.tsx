'use client';

import { useEffect, useRef, useState } from 'react';
import {
  runExecutionInputSchema,
  runExecutionResponseSchema,
  type RunExecution,
  type RunExecutionInput,
  type RunTechnicalResult,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { ApiError, apiRequest, asApiError } from '@/lib/api';

const diagnoses: Record<RunTechnicalResult['diagnosisCode'], string> = {
  SUCCESS: 'Todas las pruebas visibles fueron superadas.',
  SYNTAX_ERROR: 'Revisa la sintaxis de tu código.',
  RUNTIME_ERROR: 'El programa produjo un error durante la ejecución.',
  FAILED_TEST: 'El resultado no coincide con alguna prueba visible.',
  TIMEOUT: 'El programa superó los 3 segundos disponibles.',
  UNKNOWN: 'No se pudo obtener un diagnóstico concluyente.',
};
const reasons: Partial<
  Record<RunTechnicalResult['terminationReason'], string>
> = {
  MEMORY_LIMIT: 'El programa alcanzó el límite de memoria.',
  OUTPUT_LIMIT: 'El programa alcanzó el límite de salida.',
  RETURN_LIMIT: 'El valor devuelto supera el tamaño permitido.',
  CANCELLED: 'La ejecución se interrumpió antes de terminar.',
};
type Operation = { key: string; input: RunExecutionInput };
type Result = { execution: RunExecution; code: string };

export function RunPracticePanel({
  activityId,
  assignmentId,
  exerciseVersionId,
  code,
  canRun,
  verified,
  reload,
}: {
  activityId: string;
  assignmentId: string;
  exerciseVersionId: string;
  code: string;
  canRun: boolean;
  verified: boolean;
  reload: () => unknown;
}) {
  const { session } = useSession();
  const [pending, setPending] = useState(false);
  const [recovery, setRecovery] = useState<Operation | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [retryBlocked, setRetryBlocked] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!retryBlocked) return;
    const timer = window.setTimeout(
      () => setRetryBlocked(false),
      Math.min(error?.retryAfter ?? 1, 3600) * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [error, retryBlocked]);

  async function execute(previous?: Operation) {
    if (
      active.current ||
      !session?.access_token ||
      !verified ||
      retryBlocked ||
      (!previous && (!canRun || recovery))
    )
      return;
    const parsed = runExecutionInputSchema.safeParse({
      code,
      exerciseVersionId,
    });
    if (!previous && !parsed.success) {
      setError(
        new ApiError(
          422,
          'INVALID_CODE',
          'Escribe código válido de hasta 65.536 bytes UTF-8 antes de ejecutar.',
        ),
      );
      return;
    }
    const operation = previous ?? {
      key: crypto.randomUUID(),
      input: parsed.data!,
    };
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await apiRequest(
        `/api/v1/activities/${encodeURIComponent(activityId)}/exercises/${encodeURIComponent(assignmentId)}/executions`,
        runExecutionResponseSchema,
        {
          method: 'POST',
          accessToken: session.access_token,
          idempotencyKey: operation.key,
          body: operation.input,
          timeoutMs: 45_000,
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      if (
        response.body.data.exerciseVersionId !==
        operation.input.exerciseVersionId
      )
        throw new ApiError(
          502,
          'INVALID_RESPONSE',
          'No se pudo verificar la versión del resultado. Recupera la misma ejecución.',
          undefined,
          [],
          true,
        );
      setResult({ execution: response.body.data, code: operation.input.code });
      setRecovery(null);
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      const failure = asApiError(cause);
      setError(failure);
      setRecovery(
        failure.status >= 500 || failure.code === 'REQUEST_IN_PROGRESS'
          ? operation
          : null,
      );
      setRetryBlocked(!!failure.retryAfter);
      if (
        [401, 403, 404].includes(failure.status) ||
        ['ACTIVITY_CLOSED', 'VERSION_CONFLICT'].includes(failure.code)
      )
        void reload();
    } finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setPending(false);
      }
    }
  }

  const technical = verified ? result?.execution.technicalResult : undefined;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Button
          data-cy="run-code"
          disabled={
            !canRun || !session || pending || !!recovery || retryBlocked
          }
          onClick={() => void execute()}
        >
          Ejecutar
        </Button>
        {recovery ? (
          <Button
            data-cy="recover-run"
            variant="outline"
            disabled={!verified || !session || pending || retryBlocked}
            onClick={() => void execute(recovery)}
          >
            Recuperar resultado
          </Button>
        ) : null}
      </div>
      <p
        role="status"
        aria-live="polite"
        data-cy="run-status"
        className="text-sm"
      >
        {pending
          ? recovery
            ? 'Recuperando el resultado de la misma ejecución.'
            : canRun
              ? 'Ejecutando las pruebas visibles. Puedes seguir editando tu código.'
              : 'La ejecución ya iniciada sigue en curso. Conservamos tu borrador.'
          : recovery
            ? 'El resultado aún no está confirmado. Recupera esta ejecución antes de iniciar otra; se usará el código enviado originalmente.'
            : technical
              ? `Resultado de práctica disponible: ${diagnoses[technical.diagnosisCode]}`
              : 'Ejecutar prueba tu código con los casos visibles. No envía un intento ni actualiza tu progreso.'}
      </p>
      {error ? <RequestError error={error} /> : null}
      {verified && result && technical ? (
        <section
          aria-labelledby="practice-result-heading"
          data-cy="practice-result"
          className="space-y-3 rounded-lg border p-4"
        >
          <h2 id="practice-result-heading" className="text-xl font-semibold">
            Resultado de práctica
          </h2>
          {result.code !== code ? (
            <p role="status" data-cy="stale-run">
              Este resultado corresponde a una versión anterior de tu código.
            </p>
          ) : null}
          <p data-cy="run-diagnosis">
            {technical.diagnosisCode}: {diagnoses[technical.diagnosisCode]}
          </p>
          {technical.infrastructureStatus === 'FAILED' ? (
            <p>
              El servicio de ejecución no pudo completar la práctica. Este fallo
              no evalúa tu solución; puedes volver a ejecutar cuando esté
              disponible.
            </p>
          ) : reasons[technical.terminationReason] ? (
            <p>{reasons[technical.terminationReason]}</p>
          ) : null}
          <p>
            Pruebas visibles superadas: {technical.visiblePassed}/
            {technical.visibleTotal}. Pruebas ejecutadas:{' '}
            {technical.visibleTestResults.length}/{technical.visibleTotal}.
          </p>
          <p className="text-sm">
            Tiempo del programa: {Math.round(technical.runtimeMs)} ms.
          </p>
          {technical.outputTruncated ? (
            <p>La salida se limitó a 64 KiB y puede estar incompleta.</p>
          ) : null}
          <ul className="space-y-3">
            {technical.visibleTestResults.map((test) => (
              <li
                key={test.id}
                data-cy="run-visible-test"
                className="space-y-2 rounded border p-3"
              >
                <h3 className="font-semibold">
                  {test.id}: {test.passed ? 'Superada' : 'No superada'}
                </h3>
                {test.stdout ? (
                  <div>
                    <p>Salida de consola</p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-sm">
                      {test.stdout}
                    </pre>
                  </div>
                ) : null}
                {test.stderr ? (
                  <div>
                    <p>Errores de consola</p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-sm">
                      {test.stderr}
                    </pre>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Resultado temporal de esta vista. No es un intento enviado ni
            acredita que el ejercicio esté completado.
          </p>
        </section>
      ) : null}
    </div>
  );
}
