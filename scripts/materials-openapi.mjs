import { z } from 'zod';
import * as c from '@alunza/contracts';

export function addMaterialsOpenApi(specification, operation) {
  const schemas = {
    MaterialSource: c.materialSourceResponseSchema,
    MaterialSources: c.materialSourceListResponseSchema,
    MaterialVersions: c.materialVersionListResponseSchema,
    MaterialChunks: c.materialChunkListResponseSchema,
    MaterialOperation: c.materialOperationResponseSchema,
    MaterialJob: c.materialJobResponseSchema,
    MaterialScopes: c.materialScopeListResponseSchema,
    MaterialVisibility: c.materialVisibilityInputSchema,
    MaterialReindex: c.materialReindexInputSchema,
    MaterialArchive: c.materialArchiveInputSchema,
  };
  for (const [name, schema] of Object.entries(schemas))
    specification.components.schemas[name] = z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io: 'input',
    });
  const add = (path, method, name, schema, options = {}) => {
    const ids = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    specification.paths[`/api/v1${path}`] ??= {};
    const result = operation(name, schema, { ids, ...options });
    if (options.list)
      result.parameters = result.parameters.filter(
        (parameter) => parameter.name !== 'search',
      );
    specification.paths[`/api/v1${path}`][method] = result;
    return result;
  };
  add('/classes/{id}/sources', 'get', 'listMaterials', 'MaterialSources', {
    list: true,
  }).parameters.push({
    name: 'activityId',
    in: 'query',
    schema: { type: 'string', format: 'uuid' },
  });
  add(
    '/classes/{id}/source-scopes',
    'get',
    'listMaterialScopes',
    'MaterialScopes',
    { list: true },
  );
  add('/sources/{id}', 'get', 'getMaterial', 'MaterialSource');
  add(
    '/sources/{id}/versions',
    'get',
    'listMaterialVersions',
    'MaterialVersions',
    { list: true },
  );
  const chunks = add(
    '/sources/{id}/versions/{versionId}/chunks',
    'get',
    'listMaterialChunks',
    'MaterialChunks',
    { list: true },
  );
  chunks.parameters = chunks.parameters.map((parameter) =>
    parameter.name === 'cursor'
      ? { ...parameter, schema: { type: 'string', pattern: '^[0-9]+$' } }
      : parameter,
  );
  add('/sources/{id}/jobs/{jobId}', 'get', 'getMaterialJob', 'MaterialJob');
  add(
    '/sources/{id}/visibility',
    'patch',
    'setMaterialVisibility',
    'MaterialSource',
    { input: 'MaterialVisibility', versioned: true },
  );
  add('/sources/{id}/archive', 'post', 'archiveMaterial', 'MaterialSource', {
    input: 'MaterialArchive',
    versioned: true,
    idempotent: true,
  });
  add('/sources/{id}/reindex', 'post', 'reindexMaterial', 'MaterialOperation', {
    input: 'MaterialReindex',
    idempotent: true,
    versioned: true,
    status: 202,
  });
  for (const [path, name, initial] of [
    ['/classes/{id}/sources', 'uploadMaterial', true],
    ['/sources/{id}/versions', 'replaceMaterial', false],
  ]) {
    const result = add(path, 'post', name, 'MaterialOperation', {
      idempotent: true,
      versioned: !initial,
      status: 202,
    });
    result.description =
      'PDF textual/TXT/Markdown, de 1 a 10.000.000 bytes reales. 202 confirma archivo y trabajo durable, no disponibilidad. Misma clave/payload reconcilia sin duplicar; una operación vigente por fuente.';
    result.requestBody = {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: initial ? ['file', 'title'] : ['file'],
            properties: {
              file: { type: 'string', format: 'binary' },
              ...(initial
                ? {
                    title: { type: 'string', minLength: 1, maxLength: 160 },
                    activityId: { type: 'string', format: 'uuid' },
                  }
                : {}),
            },
          },
        },
      },
    };
  }
  const download = add(
    '/sources/{id}/versions/{versionId}/content',
    'get',
    'downloadMaterial',
    'MaterialSource',
  );
  download.responses[200].description =
    'Descarga privada autorizada; no-store, attachment y sin URL pública persistente.';
  download.responses[200].content = Object.fromEntries(
    ['application/pdf', 'text/plain', 'text/markdown'].map((type) => [
      type,
      { schema: { type: 'string', format: 'binary' } },
    ]),
  );
}
