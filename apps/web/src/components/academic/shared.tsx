'use client';

import { useId, useState, type ComponentProps, type ReactNode } from 'react';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  FormDialog,
  OperationError,
  Pagination,
  useOperation,
} from '@/components/identity-forms';
import { RequestError } from '@/components/request-error';
import { useApiResource } from '@/lib/use-api-resource';
import type { ApiError } from '@/lib/api';

export const inputClass =
  'min-h-12 w-full rounded-md border border-input bg-card px-3 py-2 text-sm disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export const difficultyLabels = {
  BEGINNER: 'Inicial',
  INTERMEDIATE: 'Intermedia',
  ADVANCED: 'Avanzada',
} as const;

export function TextAreaField({
  label,
  error,
  ...props
}: ComponentProps<'textarea'> & { label: string; error?: ApiError | null }) {
  const generated = useId();
  const id = props.id ?? generated;
  const issue = error?.fields.find(
    (item) => item.field === props.name,
  )?.message;
  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      <textarea
        {...props}
        id={id}
        aria-invalid={!!issue}
        aria-describedby={issue ? `${id}-error` : props['aria-describedby']}
        className={`${inputClass} ${props.className ?? ''}`}
      />
      {issue ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {issue}
        </p>
      ) : null}
    </div>
  );
}

export function LoadState({
  state,
  reload,
}: {
  state: { status: 'loading' | 'ready' | 'error'; error?: ApiError };
  reload: () => unknown;
}) {
  if (state.status === 'loading')
    return <p role="status">Cargando contenido…</p>;
  if (state.status === 'error' && state.error)
    return (
      <div className="space-y-3">
        <RequestError error={state.error} />
        <Button variant="outline" onClick={() => void reload()}>
          Reintentar consulta
        </Button>
      </div>
    );
  return null;
}

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="space-y-5 rounded-xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function usePagedResource<T>(
  path: string,
  schema: z.ZodType<T>,
  enabled = true,
) {
  const [cursor, setCursor] = useState<string | null>(null);
  const resource = useApiResource(
    `${path}${path.includes('?') ? '&' : '?'}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    schema,
    enabled,
  );
  return {
    ...resource,
    pagination: (page: { hasMore: boolean; nextCursor: string | null }) => (
      <Pagination
        cursor={cursor}
        hasMore={page.hasMore}
        onFirst={() => setCursor(null)}
        onNext={() => setCursor(page.nextCursor)}
      />
    ),
  };
}

export function ConfirmAction<T>({
  label,
  description,
  path,
  schema,
  etag,
  body = {},
  method = 'POST',
  onDone,
  disabled = false,
}: {
  label: string;
  description: string;
  path: string;
  schema: z.ZodType<T>;
  etag?: string;
  body?: unknown;
  method?: 'POST' | 'PUT' | 'PATCH';
  onDone: () => unknown;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const operation = useOperation();
  return (
    <FormDialog
      title={label}
      description={description}
      trigger={
        <Button variant="outline" disabled={disabled}>
          {label}
        </Button>
      }
      open={open}
      onOpenChange={setOpen}
      locked={operation.pending || operation.unresolved}
    >
      <div className="space-y-4">
        <OperationError
          error={operation.error}
          unresolved={operation.unresolved}
        />
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={operation.pending}
            onClick={() => {
              void operation
                .run(path, schema, { method, body, etag })
                .then((result) => {
                  if (result) {
                    setOpen(false);
                    void onDone();
                  }
                });
            }}
          >
            {operation.pending ? 'Guardando…' : 'Confirmar'}
          </Button>
          <Button
            variant="ghost"
            disabled={operation.pending || operation.unresolved}
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}

export function instantLabel(
  value: string | null,
  timezone = 'America/Santiago',
) {
  if (!value) return 'Sin límite';
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}

export function etagFor(revision: number) {
  return `"${revision}"`;
}

export function RecordForm<I, O>({
  title,
  description,
  path,
  inputSchema,
  responseSchema,
  etag,
  method = 'POST',
  read,
  children,
  onDone,
}: {
  title: string;
  description: string;
  path: string;
  inputSchema: z.ZodType<I>;
  responseSchema: z.ZodType<O>;
  etag?: string;
  method?: 'POST' | 'PATCH' | 'PUT';
  read: (form: FormData) => unknown;
  children: (error: ApiError | null) => ReactNode;
  onDone: (result: O) => unknown;
}) {
  const [open, setOpen] = useState(false);
  const operation = useOperation();
  return (
    <FormDialog
      title={title}
      description={description}
      trigger={<Button variant="outline">{title}</Button>}
      open={open}
      onOpenChange={setOpen}
      locked={operation.pending || operation.unresolved}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          const body = operation.unresolved
            ? undefined
            : operation.validate(
                inputSchema,
                read(new FormData(event.currentTarget)),
              );
          if (!operation.unresolved && body === null) return;
          void operation
            .run(path, responseSchema, { method, body, etag })
            .then((response) => {
              if (response) {
                setOpen(false);
                void onDone(response.body);
              }
            });
        }}
      >
        <OperationError
          error={operation.error}
          unresolved={operation.unresolved}
        />
        <fieldset
          disabled={operation.pending || operation.unresolved}
          className="space-y-4"
        >
          {children(operation.error)}
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={operation.pending}>
            {operation.pending
              ? 'Guardando…'
              : operation.unresolved
                ? 'Comprobar solicitud'
                : 'Guardar'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={operation.pending || operation.unresolved}
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}

export function optionalDate(form: FormData, name: string) {
  return String(form.get(name) ?? '') || null;
}
