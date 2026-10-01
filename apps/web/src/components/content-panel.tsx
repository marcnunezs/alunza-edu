'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  conceptInputSchema,
  conceptResponseSchema,
  conceptListResponseSchema,
  conceptVersionListResponseSchema,
  exerciseCreateSchema,
  exerciseVersionInputSchema,
  exerciseResponseSchema,
  exerciseListResponseSchema,
  exerciseArchiveResponseSchema,
  exerciseVersionListResponseSchema,
  type Concept,
  type Exercise,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import {
  Field,
  SelectField,
  FormDialog,
  OperationError,
  Pagination,
  useOperation,
  formatDate,
} from '@/components/identity-forms';
import {
  AcademicScope,
  TextAreaField,
  ConfirmAction,
  LoadError,
  RevisionConflict,
  academicBase,
  difficultyLabels,
} from '@/components/academic-shared';
import { useApiResource } from '@/lib/use-api-resource';
import { useApiCollection } from '@/lib/use-api-collection';
import { ApiError } from '@/lib/api';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

function ConceptForm({
  orgId,
  value,
  concepts,
  onSaved,
}: {
  orgId: string;
  value?: Concept;
  concepts: Concept[];
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const operation = useOperation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = operation.unresolved
      ? {}
      : operation.validate(conceptInputSchema, {
          name: form.get('name'),
          description: form.get('description'),
          parentId: form.get('parentId') || null,
        });
    if (!body) return;
    const result = await operation.run(
      value
        ? `/api/v1/concepts/${value.id}`
        : `/api/v1/organizations/${orgId}/concepts`,
      conceptResponseSchema,
      {
        method: value ? 'PATCH' : 'POST',
        body,
        ...(value ? { etag: `"${value.revision}"` } : {}),
      },
    );
    if (result) {
      setOpen(false);
      await onSaved();
    }
  }
  return (
    <FormDialog
      title={value ? 'Editar concepto' : 'Crear concepto'}
      description="Los cambios conservan las versiones usadas en ejercicios publicados."
      trigger={
        <Button variant={value ? 'outline' : 'default'}>
          {value ? 'Editar concepto' : 'Crear concepto'}
        </Button>
      }
      open={open}
      onOpenChange={setOpen}
      locked={operation.pending || operation.unresolved}
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <fieldset
          className="space-y-4"
          disabled={operation.pending || operation.unresolved}
        >
          <Field
            name="name"
            label="Nombre del concepto"
            required
            maxLength={160}
            defaultValue={value?.name}
            error={operation.error}
          />
          <TextAreaField
            name="description"
            label="Descripción del concepto"
            maxLength={10000}
            defaultValue={value?.description}
            error={operation.error}
          />
          <SelectField
            name="parentId"
            label="Concepto superior"
            defaultValue={value?.parentId ?? ''}
            error={operation.error}
          >
            <option value="">Sin concepto superior</option>
            {concepts
              .filter(
                (item) => item.state === 'ACTIVE' && item.id !== value?.id,
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </SelectField>
        </fieldset>
        <OperationError
          error={operation.error}
          unresolved={operation.unresolved}
        />
        <Button type="submit" disabled={operation.pending}>
          {operation.pending
            ? 'Guardando…'
            : operation.unresolved
              ? 'Reintentar solicitud'
              : 'Guardar concepto'}
        </Button>
        <RevisionConflict
          error={operation.error}
          reload={async () => {
            setOpen(false);
            await onSaved();
          }}
        />
      </form>
    </FormDialog>
  );
}

function ConceptHistory({ id }: { id: string }) {
  const { state, reload } = useApiCollection(
    `/api/v1/concepts/${id}/versions?limit=100`,
    conceptVersionListResponseSchema,
  );
  if (state.status === 'loading')
    return <p role="status">Consultando versiones…</p>;
  if (state.status === 'error')
    return <LoadError error={state.error} reload={reload} />;
  return (
    <ul className="space-y-3">
      {state.result.body.data.map((version) => (
        <li key={version.id} className="text-sm">
          <strong>
            Versión {version.version}: {version.name}
          </strong>
          <p>{version.description}</p>
          <p className="text-muted-foreground">
            {formatDate(version.createdAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Concepts({ orgId, readOnly }: { orgId: string; readOnly: boolean }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const list = useApiResource(
    `/api/v1/organizations/${orgId}/concepts?limit=20${cursor ? `&cursor=${cursor}` : ''}`,
    conceptListResponseSchema,
  );
  const choices = useApiCollection(
    `/api/v1/organizations/${orgId}/concepts?limit=100&state=ACTIVE`,
    conceptListResponseSchema,
  );
  async function reload() {
    await Promise.all([list.reload(), choices.reload()]);
  }
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Taxonomía de conceptos</h1>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle>Conceptos de la organización</CardTitle>
            {!readOnly && choices.state.status === 'ready' && (
              <ConceptForm
                orgId={orgId}
                concepts={choices.state.result.body.data}
                onSaved={reload}
              />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {list.state.status === 'loading' ? (
            <p role="status">Cargando conceptos…</p>
          ) : list.state.status === 'error' ? (
            <LoadError error={list.state.error} reload={reload} />
          ) : (
            <>
              {!list.state.result.body.data.length && (
                <p>No hay conceptos registrados.</p>
              )}
              <ul className="divide-y">
                {list.state.result.body.data.map((concept) => (
                  <li
                    key={concept.id}
                    data-cy="concept-row"
                    className="space-y-3 py-5 first:pt-0"
                  >
                    <h2 className="font-semibold">{concept.name}</h2>
                    <p className="whitespace-pre-wrap text-sm">
                      {concept.description}
                    </p>
                    <p className="text-sm">
                      Versión {concept.version} ·{' '}
                      {concept.state === 'ACTIVE' ? 'Activo' : 'Archivado'} ·{' '}
                      {concept.usesCount} referencias en ejercicios
                    </p>
                    <p className="text-sm">
                      Concepto superior:{' '}
                      {concept.parentId
                        ? choices.state.status === 'ready'
                          ? (choices.state.result.body.data.find(
                              (item) => item.id === concept.parentId,
                            )?.name ?? 'Concepto histórico')
                          : 'Consultando…'
                        : 'Ninguno'}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {!readOnly &&
                        concept.state === 'ACTIVE' &&
                        choices.state.status === 'ready' && (
                          <>
                            <ConceptForm
                              orgId={orgId}
                              value={concept}
                              concepts={choices.state.result.body.data}
                              onSaved={reload}
                            />
                            <ConfirmAction
                              label="Archivar concepto"
                              description={`Tiene ${concept.usesCount} referencias. El archivo conserva las versiones publicadas e impide nuevas publicaciones con este concepto, incluso en borradores existentes.`}
                              path={`/api/v1/concepts/${concept.id}/archive`}
                              schema={conceptResponseSchema}
                              revision={concept.revision}
                              onSaved={reload}
                            />
                          </>
                        )}
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setHistory(history === concept.id ? null : concept.id)
                        }
                      >
                        {history === concept.id
                          ? 'Ocultar versiones'
                          : 'Ver versiones'}
                      </Button>
                    </div>
                    {history === concept.id && (
                      <ConceptHistory key={concept.revision} id={concept.id} />
                    )}
                  </li>
                ))}
              </ul>
              <Pagination
                cursor={cursor}
                hasMore={list.state.result.body.page.hasMore}
                onFirst={() => setCursor(null)}
                onNext={() =>
                  setCursor(
                    list.state.status === 'ready'
                      ? list.state.result.body.page.nextCursor
                      : null,
                  )
                }
              />
            </>
          )}
          {choices.state.status === 'error' && (
            <LoadError error={choices.state.error} reload={choices.reload} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ConceptsPanel({ orgId }: { orgId: string }) {
  return (
    <AcademicScope orgId={orgId} roles={['ADMIN']}>
      {(membership) => (
        <Concepts
          orgId={orgId}
          readOnly={membership.accessMode === 'READ_ONLY'}
        />
      )}
    </AcademicScope>
  );
}

function Exercises({
  orgId,
  readOnly,
  admin,
}: {
  orgId: string;
  readOnly: boolean;
  admin: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const { state, reload } = useApiResource(
    `/api/v1/organizations/${orgId}/exercises?limit=20${cursor ? `&cursor=${cursor}` : ''}`,
    exerciseListResponseSchema,
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">Banco de ejercicios</h1>
        {!readOnly && !admin && (
          <Button asChild>
            <Link href={`${academicBase(orgId)}/ejercicios/nuevo`}>
              Crear ejercicio
            </Link>
          </Button>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Ejercicios disponibles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status === 'loading' ? (
            <p role="status">Cargando ejercicios…</p>
          ) : state.status === 'error' ? (
            <LoadError error={state.error} reload={reload} />
          ) : (
            <>
              {!state.result.body.data.length && (
                <p>No hay ejercicios disponibles.</p>
              )}
              <ul className="divide-y">
                {state.result.body.data.map((exercise) => (
                  <li
                    key={exercise.id}
                    data-cy="exercise-row"
                    className="flex flex-wrap items-center justify-between gap-4 py-5 first:pt-0"
                  >
                    <div>
                      <h2 className="font-semibold">{exercise.title}</h2>
                      <p className="mt-1 text-sm">
                        {difficultyLabels[exercise.difficulty]} · Versión{' '}
                        {exercise.version} ·{' '}
                        {exercise.state === 'ACTIVE' ? 'Activo' : 'Archivado'}
                      </p>
                    </div>
                    {admin ? (
                      !readOnly &&
                      exercise.state === 'ACTIVE' && (
                        <ConfirmAction
                          label="Archivar ejercicio"
                          description="Se conservarán las versiones de actividades publicadas. El archivo impedirá nuevas publicaciones con este ejercicio, incluidos los borradores existentes."
                          path={`/api/v1/exercises/${exercise.id}/archive`}
                          schema={exerciseArchiveResponseSchema}
                          revision={exercise.revision}
                          onSaved={reload}
                        />
                      )
                    ) : (
                      <Button asChild variant="outline">
                        <Link
                          href={`${academicBase(orgId)}/ejercicios/${exercise.id}`}
                        >
                          Abrir ejercicio
                        </Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <Pagination
                cursor={cursor}
                hasMore={state.result.body.page.hasMore}
                onFirst={() => setCursor(null)}
                onNext={() => setCursor(state.result.body.page.nextCursor)}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ExercisesPanel({ orgId }: { orgId: string }) {
  return (
    <AcademicScope orgId={orgId} roles={['ADMIN', 'TEACHER']}>
      {(membership) => (
        <Exercises
          orgId={orgId}
          admin={membership.role === 'ADMIN'}
          readOnly={membership.accessMode === 'READ_ONLY'}
        />
      )}
    </AcademicScope>
  );
}

type TestFields = {
  key: string;
  visibility: 'VISIBLE' | 'HIDDEN';
  args: string;
  expected: string;
};
function ExerciseForm({
  orgId,
  exercise,
  concepts,
  readOnly,
  onSaved,
}: {
  orgId: string;
  exercise?: Exercise;
  concepts: Concept[];
  readOnly: boolean;
  onSaved?: () => Promise<void>;
}) {
  const router = useRouter();
  const operation = useOperation();
  const current = exercise?.currentVersion;
  const [tests, setTests] = useState<TestFields[]>(
    current?.tests.map((test) => ({
      key: test.id,
      visibility: test.visibility,
      args: JSON.stringify(test.args),
      expected: JSON.stringify(test.expected),
    })) ?? [
      { key: 'initial', visibility: 'VISIBLE', args: '[1,2]', expected: '3' },
    ],
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const locked = readOnly || operation.pending || operation.unresolved;
  function changeTest(
    key: string,
    field: 'args' | 'expected' | 'visibility',
    value: string,
  ) {
    setTests((items) =>
      items.map((item) =>
        item.key === key ? ({ ...item, [field]: value } as TestFields) : item,
      ),
    );
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJsonError(null);
    const form = new FormData(event.currentTarget);
    let parsedTests: unknown;
    try {
      parsedTests = tests.map((test) => ({
        visibility: test.visibility,
        comparator: 'EXACT_DEEP',
        args: JSON.parse(test.args) as unknown,
        expected: JSON.parse(test.expected) as unknown,
      }));
    } catch {
      setJsonError(
        'Revisa el JSON de los argumentos y resultados esperados. Los argumentos deben ser una lista, por ejemplo [1, 2].',
      );
      return;
    }
    const input = {
      title: form.get('title'),
      statement: form.get('statement'),
      starterCode: form.get('starterCode'),
      difficulty: form.get('difficulty'),
      language: 'javascript',
      entrypoint: 'solve',
      conceptVersionIds: form.getAll('conceptVersionIds'),
      tests: parsedTests,
      executionLimits: {
        memoryBytes: Number(form.get('memoryBytes')),
        timeoutMs: Number(form.get('timeoutMs')),
        outputBytes: Number(form.get('outputBytes')),
      },
      ...(!exercise ? { visibility: form.get('visibility') } : {}),
    };
    const body = operation.unresolved
      ? {}
      : operation.validate(
          exercise ? exerciseVersionInputSchema : exerciseCreateSchema,
          input,
        );
    if (!body) return;
    const result = await operation.run(
      exercise
        ? `/api/v1/exercises/${exercise.id}/versions`
        : `/api/v1/organizations/${orgId}/exercises`,
      exerciseResponseSchema,
      {
        method: 'POST',
        body,
        ...(exercise ? { etag: `"${exercise.revision}"` } : {}),
      },
    );
    if (result) {
      if (onSaved) await onSaved();
      else
        router.push(`${academicBase(orgId)}/ejercicios/${result.body.data.id}`);
    }
  }
  return (
    <form
      className="space-y-6"
      onSubmit={(event) => void submit(event)}
      aria-label="Definición del ejercicio"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            {exercise
              ? `Definición · Versión ${exercise.version}`
              : 'Nuevo ejercicio JavaScript'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <fieldset disabled={locked} className="space-y-5">
            <Field
              label="Título del ejercicio"
              name="title"
              required
              maxLength={160}
              defaultValue={current?.title}
              error={operation.error}
            />
            <TextAreaField
              label="Enunciado"
              name="statement"
              required
              maxLength={10000}
              defaultValue={current?.statement}
              error={operation.error}
            />
            <TextAreaField
              label="Plantilla JavaScript"
              name="starterCode"
              maxLength={65536}
              rows={8}
              className="font-mono"
              defaultValue={
                current?.starterCode ??
                'function solve(a, b) {\n  // Escribe tu solución\n}\n'
              }
              spellCheck={false}
              error={operation.error}
            />
            <SelectField
              label="Dificultad"
              name="difficulty"
              defaultValue={current?.difficulty ?? 'BASIC'}
              error={operation.error}
            >
              {Object.entries(difficultyLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            {!exercise && (
              <SelectField
                label="Visibilidad del banco"
                name="visibility"
                defaultValue="PRIVATE"
              >
                <option value="PRIVATE">Privado del profesor</option>
                <option value="ORGANIZATION">
                  Profesores de la organización
                </option>
              </SelectField>
            )}
            {current && (
              <section
                className="space-y-2"
                aria-label="Conceptos de esta definición"
              >
                <h2 className="text-sm font-semibold">
                  Conceptos de esta definición
                </h2>
                <ul className="space-y-1 text-sm">
                  {current.concepts.map((concept) => (
                    <li key={concept.versionId}>
                      {concept.name} · Versión {concept.version}
                    </li>
                  ))}
                </ul>
                {!readOnly &&
                  current.concepts.some(
                    (reference) =>
                      !concepts.some(
                        (concept) =>
                          concept.currentVersionId === reference.versionId,
                      ),
                  ) && (
                    <p className="text-sm">
                      Hay conceptos de versiones anteriores o archivados. Para
                      guardar una nueva versión, selecciona los conceptos
                      vigentes que correspondan. La definición anterior se
                      conservará.
                    </p>
                  )}
              </section>
            )}
            {!readOnly && (
              <fieldset className="space-y-3">
                <legend className="mb-3 text-sm font-semibold">
                  {current
                    ? 'Conceptos para la nueva versión (al menos uno)'
                    : 'Conceptos (al menos uno)'}
                </legend>
                {!concepts.length && (
                  <p className="text-sm">
                    Solicita al administrador que cree conceptos activos.
                  </p>
                )}
                {concepts.map((concept) => (
                  <label
                    key={concept.id}
                    className="flex min-h-11 items-center gap-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="size-4"
                      name="conceptVersionIds"
                      value={concept.currentVersionId}
                      defaultChecked={current?.conceptVersionIds.includes(
                        concept.currentVersionId,
                      )}
                    />
                    {concept.name} · Versión {concept.version}
                  </label>
                ))}
              </fieldset>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                name="timeoutMs"
                label="Tiempo máximo (ms)"
                type="number"
                required
                min={1}
                max={3000}
                defaultValue={current?.executionLimits.timeoutMs ?? 3000}
                error={operation.error}
              />
              <Field
                name="memoryBytes"
                label="Memoria máxima (bytes)"
                type="number"
                required
                min={1}
                max={134217728}
                defaultValue={current?.executionLimits.memoryBytes ?? 134217728}
                error={operation.error}
              />
              <Field
                name="outputBytes"
                label="Salida máxima (bytes)"
                type="number"
                required
                min={1}
                max={65536}
                defaultValue={current?.executionLimits.outputBytes ?? 65536}
                error={operation.error}
              />
            </div>
          </fieldset>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Pruebas deterministas</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cada prueba llama a solve con una lista JSON de argumentos. El
            resultado se compara por igualdad estructural exacta. Las pruebas
            ocultas solo son visibles para docentes autorizados.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {tests.map((test, index) => (
            <fieldset
              key={test.key}
              disabled={locked}
              className="space-y-4 rounded-lg border p-4"
            >
              <legend className="px-2 text-sm font-semibold">
                Prueba {index + 1}
              </legend>
              <SelectField
                label={`Visibilidad de prueba ${index + 1}`}
                name={`tests.${index}.visibility`}
                value={test.visibility}
                onChange={(event) =>
                  changeTest(test.key, 'visibility', event.target.value)
                }
              >
                <option value="VISIBLE">Visible al estudiante</option>
                <option value="HIDDEN">Oculta</option>
              </SelectField>
              <TextAreaField
                label={`Argumentos JSON de prueba ${index + 1}`}
                name={`tests.${index}.args`}
                value={test.args}
                className="font-mono"
                onChange={(event) =>
                  changeTest(test.key, 'args', event.target.value)
                }
                error={operation.error}
              />
              <TextAreaField
                label={`Resultado JSON de prueba ${index + 1}`}
                name={`tests.${index}.expected`}
                value={test.expected}
                className="font-mono"
                onChange={(event) =>
                  changeTest(test.key, 'expected', event.target.value)
                }
                error={operation.error}
              />
              <Button
                type="button"
                variant="ghost"
                disabled={tests.length === 1}
                onClick={() =>
                  setTests((items) =>
                    items.filter((item) => item.key !== test.key),
                  )
                }
              >
                Quitar prueba {index + 1}
              </Button>
            </fieldset>
          ))}
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              disabled={locked || tests.length >= 8}
              onClick={() =>
                setTests((items) => [
                  ...items,
                  {
                    key: crypto.randomUUID(),
                    visibility: 'VISIBLE',
                    args: '[]',
                    expected: 'null',
                  },
                ])
              }
            >
              Agregar prueba
            </Button>
          )}
        </CardContent>
      </Card>
      {jsonError && (
        <p role="alert" className="text-destructive">
          {jsonError}
        </p>
      )}
      <OperationError
        error={operation.error}
        unresolved={operation.unresolved}
      />
      {!!operation.error?.fields.length && (
        <ul className="list-disc pl-5 text-sm text-destructive">
          {operation.error.fields.map((field) => (
            <li key={field.field}>
              {field.field}: {field.message}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <Button type="submit" disabled={operation.pending}>
          {operation.pending
            ? 'Guardando…'
            : operation.unresolved
              ? 'Reintentar solicitud'
              : exercise
                ? 'Guardar nueva versión'
                : 'Guardar ejercicio'}
        </Button>
      )}
      <RevisionConflict
        error={operation.error}
        reload={onSaved ?? (() => router.refresh())}
      />
    </form>
  );
}

function ExerciseHistory({ id }: { id: string }) {
  const { state, reload } = useApiCollection(
    `/api/v1/exercises/${id}/versions?limit=100`,
    exerciseVersionListResponseSchema,
  );
  if (state.status === 'loading')
    return <p role="status">Consultando versiones…</p>;
  if (state.status === 'error')
    return <LoadError error={state.error} reload={reload} />;
  return (
    <ul className="space-y-3">
      {state.result.body.data.map((version) => (
        <li key={version.id} className="text-sm">
          <details className="rounded-lg border p-4">
            <summary className="min-h-11 cursor-pointer font-semibold">
              Versión {version.version}: {version.title} ·{' '}
              {formatDate(version.createdAt)}
            </summary>
            <div className="mt-3 space-y-4">
              <p className="whitespace-pre-wrap">{version.statement}</p>
              <pre className="overflow-x-auto rounded-md bg-secondary p-3">
                <code>{version.starterCode}</code>
              </pre>
              <p>
                {difficultyLabels[version.difficulty]} ·{' '}
                {version.executionLimits.timeoutMs} ms ·{' '}
                {version.executionLimits.memoryBytes} bytes de memoria ·{' '}
                {version.executionLimits.outputBytes} bytes de salida
              </p>
              <ul className="space-y-1">
                {version.concepts.map((concept) => (
                  <li key={concept.versionId}>
                    {concept.name} · Versión {concept.version}
                  </li>
                ))}
              </ul>
              <ol className="space-y-3">
                {version.tests.map((test, index) => (
                  <li key={test.id}>
                    <p className="font-semibold">
                      Prueba {index + 1} ·{' '}
                      {test.visibility === 'VISIBLE' ? 'Visible' : 'Oculta'}
                    </p>
                    <pre className="mt-2 overflow-x-auto rounded-md bg-secondary p-3">
                      <code>{`Argumentos: ${JSON.stringify(test.args)}\nResultado esperado: ${JSON.stringify(test.expected)}`}</code>
                    </pre>
                  </li>
                ))}
              </ol>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function ExerciseDefinition({
  orgId,
  id,
  readOnly,
}: {
  orgId: string;
  id?: string;
  readOnly: boolean;
}) {
  const { identity } = useSession();
  const concepts = useApiCollection(
    `/api/v1/organizations/${orgId}/concepts?state=ACTIVE&limit=100`,
    conceptListResponseSchema,
  );
  if (concepts.state.status === 'loading')
    return <p role="status">Cargando conceptos…</p>;
  if (concepts.state.status === 'error')
    return <LoadError error={concepts.state.error} reload={concepts.reload} />;
  if (!id)
    return (
      <ExerciseForm
        orgId={orgId}
        concepts={concepts.state.result.body.data}
        readOnly={readOnly}
      />
    );
  return (
    <ExistingExercise
      orgId={orgId}
      id={id}
      accountId={identity.status === 'ready' ? identity.data.id : ''}
      concepts={concepts.state.result.body.data}
      readOnly={readOnly}
    />
  );
}

function ExistingExercise({
  orgId,
  id,
  accountId,
  concepts,
  readOnly,
}: {
  orgId: string;
  id: string;
  accountId: string;
  concepts: Concept[];
  readOnly: boolean;
}) {
  const { state, reload } = useApiResource(
    `/api/v1/exercises/${id}`,
    exerciseResponseSchema,
  );
  if (state.status === 'loading')
    return <p role="status">Cargando ejercicio…</p>;
  if (state.status === 'error')
    return <LoadError error={state.error} reload={reload} />;
  const exercise = state.result.body.data;
  if (exercise.organizationId !== orgId)
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
  const canEdit =
    !readOnly &&
    exercise.state === 'ACTIVE' &&
    exercise.ownerId === accountId &&
    exercise.organizationId === orgId;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">{exercise.title}</h1>
      <p className="text-sm">
        {exercise.state === 'ARCHIVED' ? 'Archivado' : 'Activo'} ·{' '}
        {exercise.visibility === 'PRIVATE' ? 'Privado' : 'Organización'}
        {exercise.ownerId !== accountId
          ? ' · Consulta de ejercicio compartido'
          : ''}
      </p>
      <ExerciseForm
        key={exercise.revision}
        orgId={orgId}
        exercise={exercise}
        concepts={concepts}
        readOnly={!canEdit}
        onSaved={reload}
      />
      <Card>
        <CardHeader>
          <CardTitle>Versiones conservadas</CardTitle>
        </CardHeader>
        <CardContent>
          <ExerciseHistory key={exercise.revision} id={id} />
        </CardContent>
      </Card>
    </div>
  );
}

export function ExerciseEditorPanel({
  orgId,
  id,
}: {
  orgId: string;
  id?: string;
}) {
  return (
    <AcademicScope orgId={orgId} roles={['TEACHER']}>
      {(membership) => (
        <ExerciseDefinition
          orgId={orgId}
          id={id}
          readOnly={membership.accessMode === 'READ_ONLY'}
        />
      )}
    </AcademicScope>
  );
}
