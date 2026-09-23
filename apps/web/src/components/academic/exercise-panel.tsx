'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import {
  academicArchiveSchema,
  academicExecutionLimits,
  conceptListResponseSchema,
  exerciseListResponseSchema,
  exerciseResponseSchema,
  exerciseVersionListResponseSchema,
  exerciseVersionResponseSchema,
  exerciseVersionInputSchema,
  type Exercise,
  type ExerciseVersion,
} from '@alunza/contracts';
import {
  Field,
  FormDialog,
  OperationError,
  SelectField,
  useOperation,
} from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import { useApiResource } from '@/lib/use-api-resource';
import { useSession } from '@/components/session-provider';
import {
  LoadState,
  RecordForm,
  Section,
  TextAreaField,
  etagFor,
  difficultyLabels,
  usePagedResource,
} from './shared';

type TestForm = {
  key: string;
  id: string;
  visibility: 'visible' | 'hidden';
  args: string;
  expected: string;
};

function ExerciseFormBody({
  orgId,
  exercise,
  version,
  done,
  onBusy,
}: {
  orgId: string;
  exercise?: Exercise;
  version?: ExerciseVersion;
  done: () => unknown;
  onBusy: (busy: boolean) => void;
}) {
  const operation = useOperation();
  useEffect(() => {
    onBusy(operation.pending || operation.unresolved);
  }, [onBusy, operation.pending, operation.unresolved]);
  const concepts = usePagedResource(
    `/api/v1/organizations/${orgId}/concepts?state=ACTIVE`,
    conceptListResponseSchema,
  );
  const [selectedConcepts, setSelectedConcepts] = useState<string[]>(
    version?.conceptVersionIds ?? [],
  );
  const [testCases, setTestCases] = useState<TestForm[]>(
    version?.tests.map((test, i) => ({
      key: `initial-${i}`,
      id: test.id,
      visibility: test.visibility,
      args: JSON.stringify(test.args),
      expected: JSON.stringify(test.expected),
    })) ?? [
      {
        key: 'initial',
        id: 'caso-1',
        visibility: 'visible',
        args: '[]',
        expected: 'null',
      },
    ],
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.unresolved) {
      const retry = exercise
        ? operation.run(
            `/api/v1/exercises/${exercise.id}/versions`,
            exerciseVersionResponseSchema,
            { method: 'POST' },
          )
        : operation.run(
            `/api/v1/organizations/${orgId}/exercises`,
            exerciseResponseSchema,
            { method: 'POST' },
          );
      void retry.then((result) => {
        if (result) void done();
      });
      return;
    }
    const form = new FormData(event.currentTarget);
    let tests: {
      id: string;
      visibility: 'visible' | 'hidden';
      args: unknown;
      expected: unknown;
    }[];
    try {
      tests = testCases.map((test) => ({
        id: test.id,
        visibility: test.visibility,
        args: JSON.parse(test.args) as unknown,
        expected: JSON.parse(test.expected) as unknown,
      }));
    } catch {
      setJsonError(
        'Revisa los argumentos y resultados esperados: deben usar JSON válido. Los argumentos son una lista, por ejemplo [2, 3].',
      );
      return;
    }
    setJsonError(null);
    const body = operation.validate(exerciseVersionInputSchema, {
      title: form.get('title'),
      statement: form.get('statement'),
      starterCode: form.get('starterCode'),
      language: 'javascript',
      entrypoint: 'solve',
      difficulty: form.get('difficulty'),
      conceptVersionIds: selectedConcepts,
      tests,
      executionLimits: academicExecutionLimits,
    });
    if (!body) return;
    const request = exercise
      ? operation.run(
          `/api/v1/exercises/${exercise.id}/versions`,
          exerciseVersionResponseSchema,
          { method: 'POST', body, etag: etagFor(exercise.revision) },
        )
      : operation.run(
          `/api/v1/organizations/${orgId}/exercises`,
          exerciseResponseSchema,
          { method: 'POST', body },
        );
    void request.then((result) => {
      if (result) void done();
    });
  }
  function updateTest(index: number, change: Partial<TestForm>) {
    setTestCases((items) =>
      items.map((item, i) => (i === index ? { ...item, ...change } : item)),
    );
  }
  return (
    <form onSubmit={save} className="space-y-5">
      <OperationError
        error={operation.error}
        unresolved={operation.unresolved}
      />
      {operation.error?.fields.some((field) =>
        field.field.startsWith('conceptVersionIds'),
      ) ? (
        <p role="alert" className="text-sm text-destructive">
          Selecciona al menos un concepto activo sin repetirlo.
        </p>
      ) : null}
      {operation.error?.fields.some((field) =>
        field.field.startsWith('tests'),
      ) ? (
        <p role="alert" className="text-sm text-destructive">
          Revisa las pruebas: debe haber una visible, identificadores únicos,
          argumentos como lista JSON y resultados coherentes para las mismas
          entradas.
        </p>
      ) : null}
      {jsonError ? (
        <p role="alert" className="text-destructive">
          {jsonError}
        </p>
      ) : null}
      <fieldset
        className="space-y-5"
        disabled={operation.pending || operation.unresolved}
      >
        <Field
          label="Título del ejercicio"
          name="title"
          required
          maxLength={160}
          defaultValue={version?.title ?? ''}
          error={operation.error}
        />
        <TextAreaField
          label="Enunciado"
          name="statement"
          required
          rows={5}
          maxLength={32768}
          defaultValue={version?.statement ?? ''}
          error={operation.error}
        />
        <TextAreaField
          label="Plantilla JavaScript"
          name="starterCode"
          rows={7}
          className="font-mono"
          maxLength={65536}
          defaultValue={
            version?.starterCode ??
            'module.exports.solve = function solve() {\n  // Escribe tu solución\n};'
          }
          error={operation.error}
        />
        <p className="text-sm text-muted-foreground">
          Exporta la función de entrada como module.exports.solve. El editor
          permite salir con Tab.
        </p>
        <SelectField
          label="Dificultad"
          name="difficulty"
          defaultValue={version?.difficulty ?? 'BEGINNER'}
          error={operation.error}
        >
          {Object.entries(difficultyLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <fieldset className="space-y-3">
          <legend className="mb-2 font-semibold">
            Conceptos (al menos uno)
          </legend>
          <p className="text-sm">
            {selectedConcepts.length} referencias seleccionadas. Al editar se
            conservan las versiones anteriores; limpia la selección para
            sustituirlas.
          </p>
          <LoadState state={concepts.state} reload={concepts.reload} />
          {concepts.state.status === 'ready' ? (
            <>
              {concepts.state.result.body.data.length === 0 ? (
                <p>
                  Solicita al administrador un concepto activo antes de guardar.
                </p>
              ) : null}
              {concepts.state.result.body.data.map((concept) => (
                <label
                  key={concept.id}
                  className="flex min-h-11 items-center gap-3"
                >
                  <input
                    type="checkbox"
                    name="conceptVersionIds"
                    value={concept.currentVersionId}
                    checked={selectedConcepts.includes(
                      concept.currentVersionId,
                    )}
                    onChange={(event) =>
                      setSelectedConcepts((items) =>
                        event.target.checked
                          ? [...items, concept.currentVersionId]
                          : items.filter(
                              (id) => id !== concept.currentVersionId,
                            ),
                      )
                    }
                  />
                  {concept.name}
                </label>
              ))}
              {concepts.pagination(concepts.state.result.body.page)}
            </>
          ) : null}
          {selectedConcepts.length ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSelectedConcepts([])}
            >
              Limpiar selección de conceptos
            </Button>
          ) : null}
        </fieldset>
        <fieldset className="space-y-4">
          <legend className="mb-2 font-semibold">Pruebas deterministas</legend>
          <p className="text-sm">
            Configura entre 1 y 8 pruebas, con al menos una visible. Los
            resultados se compararán como valores JSON.
          </p>
          {testCases.map((test, index) => (
            <div
              key={test.key}
              data-cy="test-definition"
              className="space-y-3 rounded-lg border p-3"
            >
              <h3 className="font-semibold">Prueba {index + 1}</h3>
              <Field
                label={`Identificador de prueba ${index + 1}`}
                name={`tests.${index}.id`}
                required
                maxLength={100}
                value={test.id}
                onChange={(event) =>
                  updateTest(index, { id: event.target.value })
                }
                error={operation.error}
              />
              <SelectField
                label={`Visibilidad de prueba ${index + 1}`}
                name={`tests.${index}.visibility`}
                value={test.visibility}
                onChange={(event) =>
                  updateTest(index, {
                    visibility: event.target.value as TestForm['visibility'],
                  })
                }
              >
                <option value="visible">Visible al estudiante</option>
                <option value="hidden">Oculta al estudiante</option>
              </SelectField>
              <TextAreaField
                label={`Argumentos de prueba ${index + 1} (lista JSON)`}
                name={`tests.${index}.args`}
                required
                value={test.args}
                onChange={(event) =>
                  updateTest(index, { args: event.target.value })
                }
                error={operation.error}
              />
              <TextAreaField
                label={`Resultado esperado de prueba ${index + 1} (JSON)`}
                name={`tests.${index}.expected`}
                required
                value={test.expected}
                onChange={(event) =>
                  updateTest(index, { expected: event.target.value })
                }
                error={operation.error}
              />
              <Button
                type="button"
                variant="ghost"
                disabled={testCases.length === 1}
                onClick={() =>
                  setTestCases((items) => items.filter((_, i) => i !== index))
                }
              >
                Quitar prueba {index + 1}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={testCases.length >= 8}
            onClick={() =>
              setTestCases((items) => [
                ...items,
                {
                  key: crypto.randomUUID(),
                  id: `caso-${items.length + 1}`,
                  visibility: 'visible',
                  args: '[]',
                  expected: 'null',
                },
              ])
            }
          >
            Agregar prueba
          </Button>
        </fieldset>
        <p className="rounded-lg bg-secondary p-3 text-sm">
          Límites de ejecución: 128 MiB de memoria, 3 segundos totales y 64 KiB
          de salida. El ejercicio se guarda en tu banco privado.
        </p>
      </fieldset>
      <Button type="submit" disabled={operation.pending}>
        {operation.pending
          ? 'Guardando…'
          : operation.unresolved
            ? 'Comprobar solicitud'
            : exercise
              ? 'Guardar nueva versión'
              : 'Guardar ejercicio'}
      </Button>
    </form>
  );
}

function ExerciseDialog({
  orgId,
  exercise,
  version,
  done,
}: {
  orgId: string;
  exercise?: Exercise;
  version?: ExerciseVersion;
  done: () => unknown;
}) {
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  return (
    <FormDialog
      title={exercise ? 'Crear nueva versión' : 'Crear ejercicio'}
      description="Define el contenido completo. Una nueva versión conserva las publicaciones anteriores."
      trigger={
        <Button>{exercise ? 'Crear nueva versión' : 'Crear ejercicio'}</Button>
      }
      open={open}
      onOpenChange={setOpen}
      locked={locked}
    >
      <ExerciseFormBody
        orgId={orgId}
        exercise={exercise}
        version={version}
        onBusy={setLocked}
        done={() => {
          setOpen(false);
          void done();
        }}
      />
    </FormDialog>
  );
}

export function ExerciseLibrary({
  orgId,
  canCreate,
}: {
  orgId: string;
  canCreate: boolean;
}) {
  const resource = usePagedResource(
    `/api/v1/organizations/${orgId}/exercises`,
    exerciseListResponseSchema,
  );
  return (
    <Section
      title="Banco de ejercicios"
      action={
        canCreate ? (
          <ExerciseDialog orgId={orgId} done={resource.reload} />
        ) : null
      }
    >
      <LoadState state={resource.state} reload={resource.reload} />
      {resource.state.status === 'ready' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {resource.state.result.body.data.length === 0 ? (
              <p>No hay ejercicios disponibles en tu ámbito.</p>
            ) : null}
            {resource.state.result.body.data.map((exercise) => (
              <article
                key={exercise.id}
                data-cy="exercise-card"
                className="space-y-3 rounded-lg border p-4"
              >
                <h3 className="font-semibold">{exercise.title}</h3>
                <p className="text-sm">
                  {difficultyLabels[exercise.difficulty]} ·{' '}
                  {exercise.state === 'ACTIVE' ? 'Activo' : 'Archivado'} ·{' '}
                  {exercise.visibility === 'PRIVATE'
                    ? 'Privado'
                    : 'Organización'}
                </p>
                <Button asChild variant="outline">
                  <Link href={`/ejercicios/${exercise.id}`}>
                    Consultar ejercicio
                  </Link>
                </Button>
              </article>
            ))}
          </div>
          {resource.pagination(resource.state.result.body.page)}
        </>
      ) : null}
    </Section>
  );
}

export function ExercisePanel({ exerciseId }: { exerciseId: string }) {
  const resource = useApiResource(
    `/api/v1/exercises/${encodeURIComponent(exerciseId)}`,
    exerciseResponseSchema,
  );
  const versions = usePagedResource(
    `/api/v1/exercises/${encodeURIComponent(exerciseId)}/versions`,
    exerciseVersionListResponseSchema,
  );
  const { identity } = useSession();
  if (resource.state.status !== 'ready')
    return <LoadState state={resource.state} reload={resource.reload} />;
  const exercise = resource.state.result.body.data;
  const membership =
    identity.status === 'ready'
      ? identity.data.memberships.find(
          (item) => item.organizationId === exercise.organizationId,
        )
      : undefined;
  const current =
    versions.state.status === 'ready'
      ? versions.state.result.body.data.find(
          (item) => item.id === exercise.currentVersionId,
        )
      : undefined;
  const canEdit =
    identity.status === 'ready' &&
    exercise.ownerId === identity.data.id &&
    membership?.role === 'TEACHER' &&
    exercise.state === 'ACTIVE';
  return (
    <div className="space-y-6">
      <Link
        className="underline"
        href={`/academia?org=${exercise.organizationId}`}
      >
        Volver al banco
      </Link>
      <h1 className="text-3xl font-semibold">{exercise.title}</h1>
      <div className="flex flex-wrap gap-3">
        {canEdit && current ? (
          <ExerciseDialog
            orgId={exercise.organizationId}
            exercise={exercise}
            version={current}
            done={() => {
              void resource.reload();
              void versions.reload();
            }}
          />
        ) : null}
        {membership?.role === 'ADMIN' && exercise.state === 'ACTIVE' ? (
          <RecordForm
            title="Archivar ejercicio"
            description="Impedirá nuevas asignaciones. Las actividades publicadas mantienen su contenido y disponibilidad."
            path={`/api/v1/exercises/${exercise.id}/archive`}
            inputSchema={academicArchiveSchema}
            responseSchema={exerciseResponseSchema}
            etag={etagFor(exercise.revision)}
            onDone={resource.reload}
            read={(form) => ({ reason: form.get('reason') })}
          >
            {(error) => (
              <Field
                label="Motivo"
                name="reason"
                required
                maxLength={500}
                error={error}
              />
            )}
          </RecordForm>
        ) : null}
      </div>
      <LoadState state={versions.state} reload={versions.reload} />
      {versions.state.status === 'ready' ? (
        <>
          <div className="space-y-4">
            {versions.state.result.body.data.map((version) => (
              <details
                key={version.id}
                className="rounded-xl border bg-card p-5"
                open={version.id === exercise.currentVersionId}
              >
                <summary className="cursor-pointer font-semibold">
                  Versión {version.version} · {version.title}
                  {version.id === exercise.currentVersionId ? ' · Actual' : ''}
                </summary>
                <div className="mt-5 space-y-4">
                  <p className="whitespace-pre-wrap">{version.statement}</p>
                  <pre className="overflow-x-auto rounded-lg bg-secondary p-4 text-sm">
                    {version.starterCode}
                  </pre>
                  <h2 className="font-semibold">Pruebas configuradas</h2>
                  {version.tests.map((test) => (
                    <div
                      key={test.id}
                      className="space-y-1 rounded-lg border p-3"
                    >
                      <p>
                        {test.id} ·{' '}
                        {test.visibility === 'visible' ? 'Visible' : 'Oculta'}
                      </p>
                      <pre className="overflow-x-auto text-sm">
                        Argumentos: {JSON.stringify(test.args)}
                        {'\n'}Esperado: {JSON.stringify(test.expected)}
                      </pre>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
          {versions.pagination(versions.state.result.body.page)}
        </>
      ) : null}
    </div>
  );
}
