'use client';

import { useId, useState, type ComponentProps, type ReactNode } from 'react';
import Link from 'next/link';
import type { z } from 'zod';
import type { Me, Role } from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import {
  FormDialog,
  OperationError,
  useOperation,
} from '@/components/identity-forms';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';

export const academicBase = (orgId: string) => `/academia/${orgId}`;
export const difficultyLabels = {
  BASIC: 'Básica',
  INTERMEDIATE: 'Intermedia',
  ADVANCED: 'Avanzada',
};
export const activityLabels = {
  DRAFT: 'Borrador',
  PUBLISHED: 'Publicada',
  CLOSED: 'Cerrada',
};
export type AcademicMembership = Me['memberships'][number];

export function AcademicScope({
  orgId,
  roles,
  children,
}: {
  orgId: string;
  roles?: Role[];
  children: (membership: AcademicMembership) => ReactNode;
}) {
  const { identity } = useSession();
  if (identity.status !== 'ready') return null;
  const membership = identity.data.memberships.find(
    (item) =>
      item.organizationId === orgId && (!roles || roles.includes(item.role)),
  );
  if (!membership)
    return (
      <RequestError
        error={
          new ApiError(
            404,
            'RESOURCE_NOT_FOUND',
            'El recurso no está disponible o no tienes acceso.',
          )
        }
      />
    );
  return (
    <div key={`${orgId}:${membership.role}`} className="space-y-6">
      <nav
        aria-label="Navegación académica"
        className="flex flex-wrap gap-x-5 gap-y-3 text-sm font-semibold"
      >
        <Link className="underline underline-offset-4" href="/inicio">
          Inicio
        </Link>
        <Link
          className="underline underline-offset-4"
          href={academicBase(orgId)}
        >
          Cursos y clases
        </Link>
        {membership.role === 'ADMIN' && (
          <Link
            className="underline underline-offset-4"
            href={`${academicBase(orgId)}/conceptos`}
          >
            Conceptos
          </Link>
        )}
        {membership.role !== 'STUDENT' && (
          <Link
            className="underline underline-offset-4"
            href={`${academicBase(orgId)}/ejercicios`}
          >
            Ejercicios
          </Link>
        )}
      </nav>
      <p className="text-sm text-muted-foreground">
        {membership.organizationName} ·{' '}
        {membership.role === 'ADMIN'
          ? 'Administración'
          : membership.role === 'TEACHER'
            ? 'Profesor'
            : 'Estudiante'}
      </p>
      {membership.accessMode === 'READ_ONLY' && (
        <p role="status" className="rounded-lg bg-secondary p-4">
          Organización archivada · Solo lectura.
        </p>
      )}
      {children(membership)}
    </div>
  );
}

export function TextAreaField({
  label,
  error,
  ...props
}: ComponentProps<'textarea'> & { label: string; error?: ApiError | null }) {
  const generated = useId();
  const id = props.id ?? generated;
  const fieldError = error?.fields.find(
    (field) => field.field === props.name,
  )?.message;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <textarea
        {...props}
        id={id}
        aria-invalid={!!fieldError}
        aria-describedby={
          fieldError ? `${id}-error` : props['aria-describedby']
        }
        className={`min-h-28 w-full rounded-md border border-input bg-card p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${props.className ?? ''}`}
      />
      {fieldError && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {fieldError}
        </p>
      )}
    </div>
  );
}

export function ConfirmAction<T>({
  label,
  description,
  path,
  schema,
  revision,
  onSaved,
  method = 'POST',
  body = {},
}: {
  label: string;
  description: string;
  path: string;
  schema: z.ZodType<T>;
  revision: number;
  onSaved: () => Promise<void> | void;
  method?: 'POST' | 'PATCH' | 'PUT';
  body?: unknown;
}) {
  const [open, setOpen] = useState(false);
  const operation = useOperation();
  return (
    <FormDialog
      title={label}
      description={description}
      trigger={<Button variant="outline">{label}</Button>}
      open={open}
      onOpenChange={setOpen}
      locked={operation.pending || operation.unresolved}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void operation
            .run(path, schema, { method, body, etag: `"${revision}"` })
            .then(async (result) => {
              if (result) {
                setOpen(false);
                await onSaved();
              }
            });
        }}
      >
        <OperationError
          error={operation.error}
          unresolved={operation.unresolved}
        />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={operation.pending}>
            {operation.pending
              ? 'Procesando…'
              : operation.unresolved
                ? 'Reintentar solicitud'
                : `Confirmar ${label.toLowerCase()}`}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={operation.pending || operation.unresolved}
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
          {operation.error?.status === 412 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                void onSaved();
              }}
            >
              Cargar versión actual
            </Button>
          )}
        </div>
      </form>
    </FormDialog>
  );
}

export function LoadError({
  error,
  reload,
}: {
  error: ApiError;
  reload: () => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <RequestError error={error} />
      <Button variant="outline" onClick={() => void reload()}>
        Reintentar consulta
      </Button>
    </div>
  );
}

export function RevisionConflict({
  error,
  reload,
}: {
  error: ApiError | null;
  reload: () => Promise<void> | void;
}) {
  return error?.status === 412 ? (
    <div className="space-y-2">
      <p className="text-sm">
        Tus campos se conservan. Consulta la versión actual antes de volver a
        editar.
      </p>
      <Button variant="outline" type="button" onClick={() => void reload()}>
        Cargar versión actual
      </Button>
    </div>
  ) : null;
}
