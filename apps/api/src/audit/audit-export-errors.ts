import { ApiError } from '../http/errors';

export function auditExportError(code: string): ApiError | undefined {
  if (code === 'AUDIT_EXPORT_LIMIT_EXCEEDED')
    return new ApiError(
      code,
      'La exportación supera 10.000 filas o 10 MiB. Acota los filtros.',
      422,
    );
  if (code === 'AUDIT_EXPORT_EXPIRED')
    return new ApiError(
      code,
      'La exportación venció. Solicita una nueva con los filtros actuales.',
      410,
    );
  if (code === 'AUDIT_EXPORT_FAILED' || code === 'AUDIT_EXPORT_INTERRUPTED')
    return new ApiError(
      code,
      'La generación no se completó. Puedes solicitar una nueva exportación.',
      503,
      false,
    );
  if (
    code === 'AUDIT_FILTER_INVALID' ||
    code === 'AUDIT_PERIOD_INVALID' ||
    code === 'INVALID_PROGRESS_CUTOFF'
  )
    return new ApiError(
      'VALIDATION_FAILED',
      'Revisa los filtros y el corte de la exportación.',
      422,
      false,
      [
        {
          field: code === 'INVALID_PROGRESS_CUTOFF' ? 'asOf' : 'filters',
          message:
            'Los filtros deben ser válidos y el corte no puede estar en el futuro.',
        },
      ],
    );
  return undefined;
}
