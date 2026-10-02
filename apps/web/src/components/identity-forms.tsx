'use client';

import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { Dialog } from 'radix-ui';
import type { z } from 'zod';
import { apiRequest, ApiError, asApiError, type ApiOptions } from '@/lib/api';
import { useSession } from '@/components/session-provider';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const roleLabels = {
  ADMIN: 'Administrador',
  TEACHER: 'Profesor',
  STUDENT: 'Estudiante',
} as const;
export const stateLabels = {
  INVITED: 'Invitado',
  ACTIVE: 'Activo',
  DISABLED: 'Deshabilitado',
} as const;

export function useOperation() {
  const { session, revision, refreshIdentity } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const current = useRef<{
    controller: AbortController;
    key: string;
    body: unknown;
    path: string;
    etag?: string;
  } | null>(null);
  const alive = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      current.current?.controller.abort();
    };
  }, [revision]);
  async function run<T>(
    path: string,
    schema: z.ZodType<T>,
    options: Omit<ApiOptions, 'signal'> = {},
  ) {
    if (inFlight.current) return null;
    inFlight.current = true;
    const previous = current.current;
    const request =
      unresolved && previous
        ? { ...previous, controller: new AbortController() }
        : {
            controller: new AbortController(),
            key: crypto.randomUUID(),
            body: options.body,
            path,
            etag: options.etag,
          };
    current.current = request;
    setPending(true);
    setError(null);
    try {
      const response = await apiRequest(request.path, schema, {
        ...options,
        body: request.body,
        etag: request.etag,
        idempotencyKey: request.key,
        accessToken: options.accessToken ?? session?.access_token,
        signal: request.controller.signal,
      });
      if (!alive.current || request.controller.signal.aborted) return null;
      setUnresolved(false);
      current.current = null;
      return response;
    } catch (cause) {
      if (!alive.current || request.controller.signal.aborted) return null;
      const failure = asApiError(cause);
      setError(failure);
      // The upload service confirms this terminal reservation failure explicitly.
      // Other 5xx responses may still hide a committed operation, even when the
      // generic server exception carries retryable=false.
      const terminalUpload =
        failure.code === 'STORAGE_UNAVAILABLE' && !failure.retryable;
      const retry =
        failure.retryable ||
        failure.code === 'REQUEST_IN_PROGRESS' ||
        (failure.status >= 500 && !terminalUpload);
      setUnresolved(retry);
      if (!retry) current.current = null;
      if (failure.status === 401 || failure.status === 403)
        void refreshIdentity();
      return null;
    } finally {
      inFlight.current = false;
      if (alive.current) setPending(false);
    }
  }
  function validate<T>(schema: z.ZodType<T>, input: unknown): T | null {
    const parsed = schema.safeParse(input);
    if (parsed.success) {
      setError(null);
      return parsed.data;
    }
    setError(
      new ApiError(
        422,
        'VALIDATION_FAILED',
        'Revisa los campos indicados.',
        undefined,
        parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: 'Revisa el valor de este campo.',
        })),
      ),
    );
    return null;
  }
  return {
    pending,
    error,
    unresolved,
    run,
    validate,
    clear: () => {
      if (!unresolved) setError(null);
    },
  };
}

export function Field({
  label,
  error,
  ...props
}: ComponentProps<typeof Input> & { label: string; error?: ApiError | null }) {
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
      <Input
        {...props}
        id={id}
        aria-invalid={!!fieldError}
        aria-describedby={fieldError ? `${id}-error` : undefined}
      />
      {fieldError ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {fieldError}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  error,
  children,
  ...props
}: ComponentProps<'select'> & { label: string; error?: ApiError | null }) {
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
      <select
        {...props}
        id={id}
        aria-invalid={!!fieldError}
        aria-describedby={fieldError ? `${id}-error` : undefined}
        className="min-h-12 w-full rounded-md border border-input bg-card px-3 py-2 text-sm disabled:opacity-50"
      >
        {children}
      </select>
      {fieldError ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {fieldError}
        </p>
      ) : null}
    </div>
  );
}

export function RoleOptions() {
  return (
    <>
      {Object.entries(roleLabels).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </>
  );
}

export function OperationError({
  error,
  unresolved,
}: {
  error: ApiError | null;
  unresolved?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) container.current?.focus();
  }, [error]);
  if (!error) return null;
  return (
    <div
      ref={container}
      tabIndex={-1}
      className="space-y-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <RequestError error={error} />
      {unresolved ? (
        <p className="text-sm">
          Conservamos la solicitud pendiente. Reintentar comprobará el mismo
          resultado.
        </p>
      ) : null}
    </div>
  );
}

export function FormDialog({
  title,
  description,
  trigger,
  children,
  open,
  onOpenChange,
  locked = false,
}: {
  title: string;
  description: string;
  trigger: React.ReactNode;
  children: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locked?: boolean;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!locked) onOpenChange(next);
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/30" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 shadow-xl"
          onEscapeKeyDown={(event) => {
            if (locked) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (locked) event.preventDefault();
          }}
        >
          <Dialog.Title className="pr-10 text-xl font-semibold">
            {title}
          </Dialog.Title>
          <Dialog.Description className="mt-2 mb-6 text-sm leading-relaxed text-muted-foreground">
            {description}
          </Dialog.Description>
          {children}
          <Dialog.Close asChild>
            <Button
              variant="ghost"
              disabled={locked}
              className="absolute top-3 right-3 px-3"
              aria-label="Cerrar diálogo"
            >
              ×
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Santiago',
  }).format(new Date(value));
}

export function Pagination({
  hasMore,
  cursor,
  onNext,
  onFirst,
}: {
  hasMore: boolean;
  cursor: string | null;
  onNext: () => void;
  onFirst: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {cursor ? (
        <Button variant="outline" onClick={onFirst}>
          Primera página
        </Button>
      ) : null}
      {hasMore ? (
        <Button variant="outline" onClick={onNext}>
          Siguiente página
        </Button>
      ) : null}
    </div>
  );
}
