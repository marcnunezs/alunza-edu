import type { ProgressCounters as Counters } from '@alunza/contracts';
import { progressEvidenceLabel, progressPercentage } from '@/lib/progress-view';

export function ProgressCounters({
  value,
}: {
  value: Pick<Counters, 'completed' | 'required' | 'ratio' | 'evidenceState'>;
}) {
  return (
    <div className="space-y-1">
      <p>
        Ejercicios requeridos completados:{' '}
        <strong>
          {value.completed}/{value.required}
        </strong>{' '}
        · {progressPercentage(value.ratio)}
      </p>
      <p className="text-sm text-muted-foreground">
        {progressEvidenceLabel(value.evidenceState)}
      </p>
    </div>
  );
}
