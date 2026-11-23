'use client';

import { useState, type FormEvent } from 'react';
import { auditQuerySchema } from '@alunza/contracts';
import { Field } from '@/components/identity-forms';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { localDateTime } from '@/lib/academic-time';
import {
  auditSelectedInstant,
  auditTextFilters,
  type AuditFilters,
} from '@/lib/audit-view';

export function AuditFilterForm({
  filters,
  asOf,
  timezone,
  onApply,
  onClear,
  locked = false,
  onDraftChange,
}: {
  filters: AuditFilters;
  asOf?: string;
  timezone: string;
  onApply: (filters: AuditFilters) => void;
  onClear: () => void;
  locked?: boolean;
  onDraftChange?: () => void;
}) {
  const [error, setError] = useState<ApiError | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    const form = new FormData(event.currentTarget);
    const values: Record<string, string | undefined> = auditTextFilters({
      actorId: String(form.get('actorId') ?? ''),
      action: String(form.get('action') ?? ''),
      entityType: String(form.get('entityType') ?? ''),
      entityId: String(form.get('entityId') ?? ''),
    });
    for (const name of ['from', 'asOf'] as const) {
      try {
        values[name] = auditSelectedInstant(
          String(form.get(name) ?? ''),
          name === 'asOf' ? asOf : filters.from,
          timezone,
        );
      } catch (cause) {
        setError(
          new ApiError(
            422,
            'VALIDATION_FAILED',
            'Revisa las fechas de la consulta.',
            undefined,
            [
              {
                field: name,
                message:
                  cause instanceof Error
                    ? cause.message
                    : 'Revisa la fecha y hora.',
              },
            ],
          ),
        );
        return;
      }
    }
    // Changing another filter keeps the exact server cut, including microseconds.
    values.asOf ??= asOf;
    const parsed = auditQuerySchema.safeParse(values);
    if (!parsed.success) {
      setError(
        new ApiError(
          422,
          'VALIDATION_FAILED',
          'Revisa los filtros indicados.',
          undefined,
          parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        ),
      );
      return;
    }
    setError(null);
    const { cursor: _cursor, limit: _limit, ...next } = parsed.data;
    onApply(next);
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border bg-card p-5"
      data-cy="audit-filters"
      aria-label="Filtros de auditoría"
      aria-describedby="audit-filter-help"
      noValidate
      onChange={onDraftChange}
    >
      {error ? <RequestError error={error} /> : null}
      <p className="text-sm text-muted-foreground" id="audit-filter-help">
        Fechas en {timezone}. El inicio y el corte incluyen sus instantes
        exactos. Un corte vacío conserva la consulta actual; Actualizar
        auditoría obtiene un corte nuevo.
      </p>
      <fieldset disabled={locked} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Desde"
            name="from"
            type="datetime-local"
            defaultValue={localDateTime(filters.from ?? null, timezone)}
            error={error}
          />
          <Field
            label="Hasta (corte)"
            name="asOf"
            type="datetime-local"
            defaultValue={localDateTime(filters.asOf ?? null, timezone)}
            error={error}
          />
          <Field
            label="Identificador del actor"
            name="actorId"
            defaultValue={filters.actorId ?? ''}
            maxLength={36}
            error={error}
            autoComplete="off"
          />
          <Field
            label="Acción exacta"
            name="action"
            defaultValue={filters.action ?? ''}
            maxLength={100}
            error={error}
            autoComplete="off"
          />
          <Field
            label="Tipo de entidad exacto"
            name="entityType"
            defaultValue={filters.entityType ?? ''}
            maxLength={100}
            error={error}
            autoComplete="off"
          />
          <Field
            label="Identificador de entidad"
            name="entityId"
            defaultValue={filters.entityId ?? ''}
            maxLength={36}
            error={error}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit">Aplicar filtros</Button>
          <Button type="button" variant="outline" onClick={onClear}>
            Limpiar filtros
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
