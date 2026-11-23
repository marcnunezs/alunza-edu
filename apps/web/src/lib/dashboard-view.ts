import type {
  Dashboard,
  DashboardEvidenceQuery,
  DashboardSignal,
  DashboardSignalQuery,
  SubmitTechnicalResult,
} from '@alunza/contracts';

export const dashboardDiagnosisLabels: Record<
  SubmitTechnicalResult['diagnosisCode'],
  string
> = {
  SUCCESS: 'Todas las pruebas requeridas superadas',
  SYNTAX_ERROR: 'Error de sintaxis',
  RUNTIME_ERROR: 'Error durante la ejecución',
  FAILED_TEST: 'Prueba requerida no superada',
  TIMEOUT: 'Tiempo de ejecución agotado',
  UNKNOWN: 'Diagnóstico no concluyente',
};

export const dashboardSignalLabels = {
  INACTIVITY: 'Inactividad',
  REPEATED_ERROR: 'Error repetido',
  STAGNATION: 'Estancamiento',
} as const;

export const dashboardSignalStateLabels = {
  ACTIVE: 'Pendiente de revisión',
  REVIEWED: 'Revisada',
} as const;

type CutScope = Pick<Dashboard, 'asOf' | 'filters'>;

// A period narrows observed events, never an accumulated achievement or episode.
export function dashboardEvidenceScope(
  scope: CutScope,
  kind: DashboardEvidenceQuery['kind'],
): DashboardEvidenceQuery {
  return {
    kind,
    asOf: scope.asOf,
    ...(scope.filters.activityId
      ? { activityId: scope.filters.activityId }
      : {}),
    ...(scope.filters.conceptId ? { conceptId: scope.filters.conceptId } : {}),
    ...(kind !== 'COMPLETION' && scope.filters.from
      ? { from: scope.filters.from }
      : {}),
  };
}

export function dashboardSignalScope(
  scope: CutScope,
  filters: DashboardSignalQuery,
): DashboardSignalQuery {
  return {
    asOf: scope.asOf,
    ...(scope.filters.activityId
      ? { activityId: scope.filters.activityId }
      : {}),
    ...(scope.filters.conceptId ? { conceptId: scope.filters.conceptId } : {}),
    state: filters.state,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
    ...(filters.limit ? { limit: filters.limit } : {}),
  };
}

export function signalPresentation(
  signal: Pick<
    DashboardSignal,
    'state' | 'stoppedAt' | 'verification' | 'currentMember'
  >,
) {
  return {
    reviewState: signal.state,
    reviewLabel: dashboardSignalStateLabels[signal.state],
    historical: signal.stoppedAt !== null,
    verifiable: signal.verification === 'VERIFIABLE',
    currentMember: signal.currentMember,
  };
}

export function signalProcessingPresentation(
  value: Dashboard['signals']['processing'],
) {
  return {
    status: value.status,
    unfinished: value.status !== 'UP_TO_DATE',
    missingRules: value.unconfiguredTypes.length > 0,
    message: {
      UP_TO_DATE:
        'La evaluación de señales está actualizada para el corte consultado.',
      PENDING:
        'Hay señales pendientes de actualizar. La lista conserva los episodios ya registrados y no permite concluir que no haya nuevas señales.',
      FAILED:
        'No se pudo completar la evaluación de señales. Los episodios registrados se conservan; la ausencia de nuevas señales no es concluyente.',
      NOT_EVALUATED:
        'Todavía no hay una evaluación disponible para este ámbito y corte. Esto no equivale a que ninguna regla se cumpla.',
    }[value.status],
  };
}

export function dashboardQuery(
  filters: Record<string, string | number | undefined | null>,
): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '')
      query.set(name, String(value));
  }
  return query.toString();
}

export type SignalNarrativePart =
  { kind: 'text'; value: string } | { kind: 'instant'; value: string };

// Preserve the canonical cause verbatim; only identify UTC instants for display.
export function signalNarrativeParts(text: string): SignalNarrativePart[] {
  const parts: SignalNarrativePart[] = [];
  const instants =
    /(?<![\w+-])\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z(?![\w+-])/g;
  let cursor = 0;
  for (const match of text.matchAll(instants)) {
    const instant = match[0];
    const parsed = new Date(instant);
    // Date alone normalizes impossible dates such as 30 February.
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 19) !== instant.slice(0, 19)
    )
      continue;
    if (match.index > cursor)
      parts.push({ kind: 'text', value: text.slice(cursor, match.index) });
    parts.push({ kind: 'instant', value: instant });
    cursor = match.index + instant.length;
  }
  if (cursor < text.length || parts.length === 0)
    parts.push({ kind: 'text', value: text.slice(cursor) });
  return parts;
}
