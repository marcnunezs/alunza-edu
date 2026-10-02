'use client';

import { useState } from 'react';
import {
  attemptListResponseSchema,
  attemptResponseSchema,
  type Attempt,
  type AttemptSummary,
  type SubmitTechnicalResult,
} from '@alunza/contracts';
import { Button } from '@/components/ui/button';
import { FormDialog, Pagination } from '@/components/identity-forms';
import { useApiResource } from '@/lib/use-api-resource';
import { compareAttempts } from '@/lib/attempt-state';
import { LoadState } from './shared';
import { AttemptHelpPanel } from './attempt-help-panel';

const diagnoses: Record<SubmitTechnicalResult['diagnosisCode'], string> = {
  SUCCESS: 'Todas las pruebas requeridas fueron superadas.',
  SYNTAX_ERROR: 'Revisa la sintaxis de tu código.',
  RUNTIME_ERROR: 'El programa produjo un error durante la ejecución.',
  FAILED_TEST: 'Alguna prueba requerida no fue superada.',
  TIMEOUT: 'El programa superó los 3 segundos disponibles.',
  UNKNOWN: 'No se pudo obtener un diagnóstico concluyente.',
};
const reasons: Partial<
  Record<SubmitTechnicalResult['terminationReason'], string>
> = {
  MEMORY_LIMIT: 'El programa alcanzó el límite de memoria.',
  OUTPUT_LIMIT: 'El programa alcanzó el límite de salida.',
  RETURN_LIMIT: 'El valor devuelto supera el tamaño permitido.',
  CANCELLED: 'La ejecución se interrumpió antes de terminar.',
};

export function AttemptResult({ attempt }: { attempt: Attempt }) {
  const result = attempt.technicalResult;
  return (
    <section
      data-cy="attempt-result"
      className="space-y-3 rounded-lg border p-4"
    >
      <h3 className="text-lg font-semibold">
        Intento #{attempt.attemptNumber} guardado
      </h3>
      <p data-cy="attempt-id" className="break-all text-sm">
        Identificador: {attempt.attemptId}
      </p>
      <p className="text-sm">
        Admitido:{' '}
        <time dateTime={attempt.admittedAt}>
          {new Date(attempt.admittedAt).toLocaleString('es-CL')}
        </time>
        .<br />
        Guardado:{' '}
        <time dateTime={attempt.submittedAt}>
          {new Date(attempt.submittedAt).toLocaleString('es-CL')}
        </time>
        .
      </p>
      <p data-cy="attempt-diagnosis">
        {result.diagnosisCode}: {diagnoses[result.diagnosisCode]}
      </p>
      {result.infrastructureStatus === 'FAILED' ? (
        <p>
          El servicio no pudo completar la evaluación. El intento se guardó sin
          acreditar completitud; este fallo no evalúa tu solución.
        </p>
      ) : reasons[result.terminationReason] ? (
        <p>{reasons[result.terminationReason]}</p>
      ) : null}
      <p>
        Pruebas visibles superadas: {result.visiblePassed}/{result.visibleTotal}
        . Pruebas visibles ejecutadas: {result.visibleTestResults.length}/
        {result.visibleTotal}.
      </p>
      <p>
        Comprobaciones ocultas:{' '}
        {result.hiddenChecksPassed === null
          ? 'sin conclusión'
          : result.hiddenChecksPassed
            ? 'superadas'
            : 'no superadas'}
        . No se muestran sus datos.
      </p>
      <p>
        {result.allRequiredPassed
          ? 'Este intento completa el ejercicio.'
          : 'Este intento no acredita que el ejercicio esté completado.'}
      </p>
      <p className="text-sm">
        Tiempo del programa: {Math.round(result.runtimeMs)} ms.
      </p>
      {result.outputTruncated ? (
        <p>La salida alcanzó el límite y puede estar incompleta.</p>
      ) : null}
      <ul className="space-y-2">
        {result.visibleTestResults.map((test) => (
          <li
            key={test.id}
            className="rounded border p-3"
            data-cy="attempt-visible-test"
          >
            <p>
              {test.id}: {test.passed ? 'Superada' : 'No superada'}
            </p>
            {test.stdout ? (
              <>
                <p>Salida de consola</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-sm">
                  {test.stdout}
                </pre>
              </>
            ) : null}
            {test.stderr ? (
              <>
                <p>Errores de consola</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-sm">
                  {test.stderr}
                </pre>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer underline">
          Código enviado y versiones
        </summary>
        <p className="break-all text-sm">
          Versión del ejercicio: {attempt.exerciseVersionId}
        </p>
        <p className="break-all text-sm">
          Versión de pruebas: {attempt.testsVersion}
        </p>
        <pre
          data-cy="attempt-source"
          className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-secondary p-3 text-sm"
        >
          {attempt.code}
        </pre>
      </details>
    </section>
  );
}

function AttemptDetail({
  attemptId,
  code,
  canEdit,
  onCopy,
}: {
  attemptId: string;
  code: string;
  canEdit: boolean;
  onCopy: (attempt: Attempt) => void;
}) {
  const detail = useApiResource(
    `/api/v1/attempts/${encodeURIComponent(attemptId)}`,
    attemptResponseSchema,
  );
  const [copyOpen, setCopyOpen] = useState(false);
  const attempt =
    detail.state.status === 'ready' ? detail.state.result.body.data : null;
  return (
    <div className="space-y-3" data-cy="attempt-detail">
      <LoadState state={detail.state} reload={detail.reload} />
      {attempt ? (
        <>
          <AttemptResult attempt={attempt} />
          <AttemptHelpPanel attempt={attempt} />
          <FormDialog
            title="Copiar intento al editor"
            description={
              code !== attempt.code
                ? 'Esta copia reemplazará el borrador visible. El intento original se conservará intacto; enviar la copia requerirá otra confirmación.'
                : 'El intento original se conservará intacto. Podrás editar la copia y confirmar un nuevo envío.'
            }
            trigger={
              <Button
                data-cy="copy-attempt"
                variant="outline"
                disabled={!canEdit}
              >
                Copiar al editor para reintentar
              </Button>
            }
            open={copyOpen && canEdit}
            onOpenChange={(value) => setCopyOpen(value && canEdit)}
          >
            <div className="flex flex-wrap gap-3">
              <Button
                data-cy="confirm-copy"
                disabled={!canEdit}
                onClick={() => {
                  if (canEdit) {
                    onCopy(attempt);
                    setCopyOpen(false);
                  }
                }}
              >
                Confirmar copia
              </Button>
              <Button variant="ghost" onClick={() => setCopyOpen(false)}>
                Cancelar
              </Button>
            </div>
          </FormDialog>
        </>
      ) : null}
    </div>
  );
}

function AttemptComparison({ selected }: { selected: AttemptSummary[] }) {
  if (selected.length !== 2)
    return (
      <p className="text-sm">
        Selecciona dos intentos para comparar sus pruebas visibles.
      </p>
    );
  const comparison = compareAttempts(selected[0]!, selected[1]!);
  if (!comparison.comparable)
    return (
      <p data-cy="attempt-comparison" role="status">
        Estos intentos utilizan versiones diferentes y no son comparables.
      </p>
    );
  return (
    <div
      data-cy="attempt-comparison"
      className="space-y-2 rounded border p-3"
      role="status"
    >
      <p>Comparación de pruebas visibles, en orden de intento:</p>
      <p>
        Intento #{comparison.earlier.attemptNumber}:{' '}
        {comparison.earlier.technicalResult.visiblePassed}/
        {comparison.earlier.technicalResult.visibleTotal}. Intento #
        {comparison.later.attemptNumber}:{' '}
        {comparison.later.technicalResult.visiblePassed}/
        {comparison.later.technicalResult.visibleTotal}.
      </p>
      <p>
        Diferencia: {comparison.difference > 0 ? '+' : ''}
        {comparison.difference} pruebas visibles superadas. Este conteo no es
        una nota.
      </p>
      <p className="break-all text-sm">
        Misma versión de pruebas: {comparison.earlier.testsVersion}
      </p>
    </div>
  );
}

export function AttemptHistory({
  activityId,
  assignmentId,
  code,
  canEdit,
  onCopy,
}: {
  activityId: string;
  assignmentId: string;
  code: string;
  canEdit: boolean;
  onCopy: (attempt: Attempt) => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<AttemptSummary[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const resource = useApiResource(
    `/api/v1/activities/${encodeURIComponent(activityId)}/exercises/${encodeURIComponent(assignmentId)}/attempts?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    attemptListResponseSchema,
  );
  return (
    <section
      data-cy="attempt-history"
      className="space-y-4 rounded-xl border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Historial de intentos</h2>
        <Button
          variant="ghost"
          onClick={() => {
            setSelected([]);
            setDetailId(null);
            void resource.reload();
          }}
        >
          Actualizar historial
        </Button>
      </div>
      <LoadState state={resource.state} reload={resource.reload} />
      {resource.state.status === 'ready' ? (
        <>
          {resource.state.result.body.data.length === 0 ? (
            <p>Sin intentos guardados para este ejercicio.</p>
          ) : (
            <ol className="space-y-3">
              {resource.state.result.body.data.map((attempt) => (
                <li
                  data-cy="attempt-history-row"
                  key={attempt.attemptId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
                >
                  <div>
                    <p>
                      Intento #{attempt.attemptNumber} ·{' '}
                      {attempt.technicalResult.diagnosisCode}
                    </p>
                    <p className="text-sm">
                      {new Date(attempt.submittedAt).toLocaleString('es-CL')} ·
                      Visibles: {attempt.technicalResult.visiblePassed}/
                      {attempt.technicalResult.visibleTotal}
                    </p>
                  </div>
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      data-cy="compare-attempt"
                      checked={selected.some(
                        (item) => item.attemptId === attempt.attemptId,
                      )}
                      disabled={
                        selected.length === 2 &&
                        !selected.some(
                          (item) => item.attemptId === attempt.attemptId,
                        )
                      }
                      onChange={(event) =>
                        setSelected((previous) =>
                          event.target.checked
                            ? [...previous, attempt].slice(0, 2)
                            : previous.filter(
                                (item) => item.attemptId !== attempt.attemptId,
                              ),
                        )
                      }
                    />
                    Comparar intento #{attempt.attemptNumber}
                  </label>
                  <Button
                    variant="outline"
                    data-cy="show-attempt"
                    onClick={() => setDetailId(attempt.attemptId)}
                  >
                    Ver intento #{attempt.attemptNumber}
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <Pagination
            cursor={cursor}
            hasMore={resource.state.result.body.page.hasMore}
            onFirst={() => setCursor(null)}
            onNext={() =>
              setCursor(
                resource.state.status === 'ready'
                  ? resource.state.result.body.page.nextCursor
                  : null,
              )
            }
          />
          <AttemptComparison selected={selected} />
        </>
      ) : null}
      {detailId ? (
        <AttemptDetail
          key={detailId}
          attemptId={detailId}
          code={code}
          canEdit={canEdit}
          onCopy={onCopy}
        />
      ) : null}
    </section>
  );
}
