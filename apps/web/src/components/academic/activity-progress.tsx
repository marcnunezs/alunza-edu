'use client';

import { activityProgressResponseSchema } from '@alunza/contracts';
import { useApiResource } from '@/lib/use-api-resource';
import { progressPercentage } from '@/lib/progress-view';
import { LoadState, instantLabel } from './shared';

export function ActivityProgress({
  activityId,
  timezone = 'America/Santiago',
}: {
  activityId: string;
  timezone?: string;
}) {
  const resource = useApiResource(
    `/api/v1/activities/${encodeURIComponent(activityId)}/progress`,
    activityProgressResponseSchema,
  );
  const progress =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  return (
    <div
      data-cy="activity-progress"
      className="space-y-2 text-sm"
      aria-live="polite"
    >
      <LoadState state={resource.state} reload={resource.reload} />
      {progress ? (
        <>
          <p className="font-semibold">
            Ejercicios requeridos completados: {progress.completed}/
            {progress.required} · {progressPercentage(progress.ratio)}
          </p>
          <p>
            {progress.evidenceState === 'NO_REQUIRED_EXERCISES'
              ? 'Sin ejercicios requeridos.'
              : progress.evidenceState === 'NO_ATTEMPTS'
                ? 'Sin intentos.'
                : 'Un ejercicio se completa al superar todas sus pruebas requeridas en un intento confirmado. Un fallo posterior no borra ese éxito.'}
          </p>
          <p className="text-muted-foreground">
            Progreso acumulado al{' '}
            <time dateTime={progress.asOf}>
              {instantLabel(progress.asOf, timezone)}
            </time>{' '}
            ({timezone}).
          </p>
        </>
      ) : null}
    </div>
  );
}
