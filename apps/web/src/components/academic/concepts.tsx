'use client';

import {
  academicArchiveSchema,
  conceptCreateSchema,
  conceptUpdateSchema,
  conceptResponseSchema,
  conceptListResponseSchema,
  type Concept,
} from '@alunza/contracts';
import { Field, SelectField } from '@/components/identity-forms';
import {
  LoadState,
  RecordForm,
  Section,
  TextAreaField,
  etagFor,
  usePagedResource,
} from './shared';

function ConceptForm({
  orgId,
  concept,
  concepts,
  done,
}: {
  orgId: string;
  concept?: Concept;
  concepts: Concept[];
  done: () => unknown;
}) {
  return (
    <RecordForm
      title={concept ? 'Editar concepto' : 'Crear concepto'}
      description="Los cambios crean una versión y conservan las referencias de actividades publicadas."
      path={
        concept
          ? `/api/v1/concepts/${concept.id}`
          : `/api/v1/organizations/${orgId}/concepts`
      }
      method={concept ? 'PATCH' : 'POST'}
      inputSchema={concept ? conceptUpdateSchema : conceptCreateSchema}
      responseSchema={conceptResponseSchema}
      etag={concept ? etagFor(concept.revision) : undefined}
      onDone={done}
      read={(form) => ({
        name: form.get('name'),
        description: form.get('description'),
        parentId: String(form.get('parentId') ?? '') || null,
      })}
    >
      {(error) => (
        <>
          <Field
            label="Nombre del concepto"
            name="name"
            required
            maxLength={160}
            defaultValue={concept?.name}
            error={error}
          />
          <TextAreaField
            label="Descripción del concepto"
            name="description"
            maxLength={4000}
            defaultValue={concept?.description ?? ''}
            error={error}
          />
          <SelectField
            label="Concepto padre"
            name="parentId"
            defaultValue={concept?.parentId ?? ''}
            error={error}
          >
            <option value="">Sin concepto padre</option>
            {concept?.parentId &&
            !concepts.some(
              (item) => item.id === concept.parentId && item.state === 'ACTIVE',
            ) ? (
              <option value={concept.parentId}>Conservar padre actual</option>
            ) : null}
            {concepts
              .filter(
                (item) => item.id !== concept?.id && item.state === 'ACTIVE',
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </SelectField>
        </>
      )}
    </RecordForm>
  );
}

export function Concepts({ orgId }: { orgId: string }) {
  const resource = usePagedResource(
    `/api/v1/organizations/${orgId}/concepts`,
    conceptListResponseSchema,
  );
  const concepts =
    resource.state.status === 'ready' ? resource.state.result.body.data : [];
  return (
    <Section
      title="Conceptos"
      action={
        <ConceptForm orgId={orgId} concepts={concepts} done={resource.reload} />
      }
    >
      <LoadState state={resource.state} reload={resource.reload} />
      {resource.state.status === 'ready' ? (
        <>
          <div className="space-y-4">
            {concepts.length === 0 ? (
              <p>No hay conceptos en esta organización.</p>
            ) : null}
            {concepts.map((concept) => (
              <article
                key={concept.id}
                data-cy="concept-card"
                className="space-y-3 rounded-lg border p-4"
              >
                <h3 className="font-semibold">{concept.name}</h3>
                <p className="whitespace-pre-wrap text-sm">
                  {concept.description}
                </p>
                <p className="text-sm">
                  {concept.state === 'ACTIVE' ? 'Activo' : 'Archivado'} ·
                  Versión {concept.revision} · {concept.references} referencias
                </p>
                {concept.parentId ? (
                  <p className="text-sm">
                    Padre:{' '}
                    {concepts.find((item) => item.id === concept.parentId)
                      ?.name ?? 'Consultar jerarquía del concepto'}
                  </p>
                ) : null}
                {concept.state === 'ACTIVE' ? (
                  <div className="flex flex-wrap gap-2">
                    <ConceptForm
                      orgId={orgId}
                      concept={concept}
                      concepts={concepts}
                      done={resource.reload}
                    />
                    <RecordForm
                      title="Archivar concepto"
                      description="No estará disponible para nuevas referencias. Las versiones ya publicadas conservarán el concepto y su historia."
                      path={`/api/v1/concepts/${concept.id}/archive`}
                      inputSchema={academicArchiveSchema}
                      responseSchema={conceptResponseSchema}
                      etag={etagFor(concept.revision)}
                      read={(form) => ({ reason: form.get('reason') })}
                      onDone={resource.reload}
                    >
                      {(error) => (
                        <Field
                          name="reason"
                          label="Motivo del archivo"
                          required
                          maxLength={500}
                          error={error}
                        />
                      )}
                    </RecordForm>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          {resource.pagination(resource.state.result.body.page)}
        </>
      ) : null}
    </Section>
  );
}
