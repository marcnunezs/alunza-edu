'use client';

import { useState, type FormEvent } from 'react';
import {
  conceptListResponseSchema,
  exerciseBankQuerySchema,
} from '@alunza/contracts';
import { Field, SelectField } from '@/components/identity-forms';
import { difficultyLabels } from '@/components/academic/shared';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import {
  bankQuery,
  exerciseStateLabels,
  visibilityLabels,
  useBankResource,
  type AccessDenied,
} from './bank-shared';

export type BankFilters = {
  search?: string;
  state?: 'ACTIVE' | 'ARCHIVED';
  difficulty?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  conceptId?: string;
  visibility?: 'PRIVATE' | 'ORGANIZATION';
};

function ConceptFilter({
  orgId,
  selected,
  onChange,
  onDenied,
}: {
  orgId: string;
  selected: { id: string; name: string } | null;
  onChange: (value: { id: string; name: string } | null) => void;
  onDenied: AccessDenied;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const resource = useBankResource(
    `/api/v1/organizations/${orgId}/concepts?${bankQuery({ limit: 20, cursor })}`,
    conceptListResponseSchema,
    onDenied,
  );
  const result =
    resource.state.status === 'ready' ? resource.state.result.body : null;
  return (
    <div className="space-y-3" data-cy="exercise-bank-concepts">
      <SelectField
        label="Concepto"
        name="conceptId"
        value={selected?.id ?? ''}
        onChange={(event) => {
          const found = result?.data.find(
            (item) => item.id === event.target.value,
          );
          onChange(found ? { id: found.id, name: found.name } : null);
        }}
      >
        <option value="">Todos los conceptos</option>
        {selected && !result?.data.some((item) => item.id === selected.id) ? (
          <option value={selected.id}>{selected.name}</option>
        ) : null}
        {result?.data.map((concept) => (
          <option key={concept.id} value={concept.id}>
            {concept.name}
            {concept.state === 'ARCHIVED' ? ' · Archivado' : ''}
          </option>
        ))}
      </SelectField>
      {resource.state.status === 'loading' ? (
        <p role="status">Cargando conceptos…</p>
      ) : null}
      {resource.state.status === 'error' ? (
        <div className="space-y-3">
          <RequestError error={resource.state.error} />
          <Button
            type="button"
            variant="outline"
            onClick={() => void resource.reload()}
          >
            Reintentar conceptos
          </Button>
        </div>
      ) : null}
      {result ? (
        <>
          {result.data.length === 0 ? (
            <p className="text-sm">No hay conceptos en esta página.</p>
          ) : null}
          <nav
            aria-label="Páginas de conceptos"
            className="flex flex-wrap gap-3"
          >
            {cursor ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setCursor(null)}
              >
                Primeros conceptos
              </Button>
            ) : null}
            {result.page.hasMore ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setCursor(result.page.nextCursor)}
              >
                Más conceptos
              </Button>
            ) : null}
          </nav>
        </>
      ) : null}
    </div>
  );
}

export function BankFilterForm({
  orgId,
  onApply,
  onDenied,
}: {
  orgId: string;
  onApply: (filters: BankFilters) => void;
  onDenied: AccessDenied;
}) {
  const [generation, setGeneration] = useState(0);
  const [concept, setConcept] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [error, setError] = useState<ApiError | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(
      ['search', 'state', 'difficulty', 'conceptId', 'visibility'].map(
        (name) => [name, String(form.get(name) ?? '').trim() || undefined],
      ),
    );
    const parsed = exerciseBankQuerySchema.safeParse(values);
    if (!parsed.success) {
      setError(
        new ApiError(
          422,
          'VALIDATION_FAILED',
          'Revisa los filtros de la consulta.',
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
    onApply(parsed.data);
  }
  return (
    <form
      key={generation}
      onSubmit={submit}
      className="space-y-4 rounded-xl border bg-card p-5"
      data-cy="exercise-bank-filters"
      aria-label="Filtros del banco"
    >
      {error ? <RequestError error={error} /> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Buscar ejercicios"
          name="search"
          type="search"
          maxLength={160}
          error={error}
        />
        <SelectField label="Estado" name="state" defaultValue="" error={error}>
          <option value="">Todos los estados</option>
          {Object.entries(exerciseStateLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Dificultad"
          name="difficulty"
          defaultValue=""
          error={error}
        >
          <option value="">Todas las dificultades</option>
          {Object.entries(difficultyLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <ConceptFilter
          orgId={orgId}
          selected={concept}
          onChange={setConcept}
          onDenied={onDenied}
        />
        <SelectField
          label="Visibilidad"
          name="visibility"
          defaultValue=""
          error={error}
        >
          <option value="">Todas las visibilidades</option>
          {Object.entries(visibilityLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit">Aplicar filtros</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setGeneration((value) => value + 1);
            setConcept(null);
            setError(null);
            onApply({});
          }}
        >
          Limpiar filtros
        </Button>
      </div>
    </form>
  );
}
