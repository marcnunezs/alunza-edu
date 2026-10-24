'use client';

import Link from 'next/link';
import { attemptedActivitiesResponseSchema } from '@alunza/contracts';
import { useApiResource } from '@/lib/use-api-resource';
import { academicBase, activityLabels } from '@/components/academic-shared';
import { LoadState } from '@/components/practice-load-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function AttemptedActivities({
  orgId,
  classId,
}: {
  orgId: string;
  classId: string;
}) {
  const { state, reload } = useApiResource(
    `/api/v1/classes/${classId}/attempted-activities`,
    attemptedActivitiesResponseSchema,
  );
  return (
    <Card data-cy="attempted-activities">
      <CardHeader>
        <CardTitle>Historial de mis actividades</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">
          Consulta tus intentos guardados, también después del cierre. El
          historial no vuelve a habilitar la resolución.
        </p>
        <LoadState state={state} reload={reload} />
        {state.status === 'ready' &&
          (state.result.body.data.length ? (
            <ul className="space-y-5">
              {state.result.body.data.map((activity) => (
                <li key={activity.activityId} className="space-y-2">
                  <h3 className="font-semibold">
                    {activity.title} · {activityLabels[activity.activityState]}
                  </h3>
                  <ul className="space-y-2">
                    {activity.exercises.map((exercise) => (
                      <li key={exercise.assignmentId}>
                        <Link
                          className="text-sm underline underline-offset-4"
                          href={`${academicBase(orgId)}/actividades/${activity.activityId}/ejercicios/${exercise.assignmentId}`}
                        >
                          Ver intentos: {exercise.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p>Sin intentos guardados en esta clase.</p>
          ))}
        <Button variant="outline" onClick={() => void reload()}>
          Actualizar historial de actividades
        </Button>
      </CardContent>
    </Card>
  );
}
