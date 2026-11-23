import { z } from 'zod';
import * as c from '@alunza/contracts';

export function addExerciseBankOpenApi(specification, operation) {
  const routes = [
    [
      '/api/v1/organizations/{orgId}/exercise-bank',
      'listExerciseBank',
      'ExerciseBankList',
      c.exerciseBankListResponseSchema,
      c.exerciseBankQuerySchema,
      'orgId',
    ],
    [
      '/api/v1/exercises/{id}/governance',
      'getExerciseGovernance',
      'ExerciseBankDetail',
      c.exerciseBankDetailResponseSchema,
      z.strictObject({}),
      'id',
    ],
    [
      '/api/v1/exercises/{id}/governance/versions',
      'listExerciseGovernanceVersions',
      'ExerciseBankVersions',
      c.exerciseBankVersionsResponseSchema,
      c.exerciseBankVersionsQuerySchema,
      'id',
    ],
    [
      '/api/v1/exercises/{id}/governance/uses',
      'listExerciseGovernanceUses',
      'ExerciseBankUses',
      c.exerciseBankUsesResponseSchema,
      c.exerciseBankUsesQuerySchema,
      'id',
    ],
  ];
  for (const [path, operationId, name, schema, query, parameter] of routes) {
    specification.components.schemas[name] = z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io: 'input',
    });
    const properties = z.toJSONSchema(query, {
      target: 'openapi-3.0',
      io: 'input',
    }).properties;
    const base = operation(operationId, name, { ids: [parameter] });
    specification.paths[path] = {
      get: {
        ...base,
        description:
          'IMP-06.01. ADMIN vigente del ámbito, incluida lectura histórica de organizaciones archivadas. Solo metadatos operativos, sin correo, contenido del ejercicio, pruebas o evidencia estudiantil. Conteos completos del filtro antes de paginar. observedAt corresponde a esta consulta; no es un snapshot entre páginas. Cursor ligado a actor, ámbito, recurso, filtros y orden. Lista/usos por UUID ascendente; versiones por número descendente. Cada asignación es un uso, incluso si una actividad usa varias versiones.',
        parameters: [
          ...base.parameters,
          ...Object.entries(properties).map(([name, schema]) => ({
            name,
            in: 'query',
            required: false,
            schema,
          })),
        ],
      },
    };
  }
  specification.components.schemas.ExerciseBankGovernanceInput = z.toJSONSchema(
    c.exerciseBankGovernanceInputSchema,
    { target: 'openapi-3.0', io: 'input' },
  );
  // The runtime refinement rejects an empty partial policy object.
  specification.components.schemas.ExerciseBankGovernanceInput.minProperties = 1;
  const governancePath =
    specification.paths['/api/v1/exercises/{id}/governance'];
  governancePath.patch = {
    ...operation('updateExerciseGovernance', 'ExerciseBankDetail', {
      ids: ['id'],
      input: 'ExerciseBankGovernanceInput',
      idempotent: true,
      versioned: true,
    }),
    description:
      'IMP-06.02. ADMIN ACTIVE de organización activa. Al menos un campo ownerId/visibility; destino ACTIVE ADMIN o TEACHER del mismo ámbito. PRIVATE/ORGANIZATION únicamente. Reautoriza antes de replay; clave de 24 h con tombstone, mismo payload y revisión. Cambio efectivo y auditoría atómicos; no-op conserva revisión. No modifica usos, versiones ni evidencia pedagógica.',
  };
  for (const method of ['get', 'patch']) {
    governancePath[method].responses[200].headers.ETag = {
      description: 'Revisión del ejercicio para If-Match.',
      schema: { type: 'string', example: '"1"' },
    };
  }
  specification.paths['/api/v1/exercises/{id}/governance/content'] = {
    get: {
      ...operation('getExerciseGovernanceContent', 'ExerciseVersion', {
        ids: ['id'],
      }),
      description:
        'IMP-06.02. Definición vigente para ADMIN activo del ámbito, también en lectura histórica. Incluye pruebas de autoría, sin intentos ni datos estudiantiles. Las lecturas de metadatos no cambian su proyección. Consultar detalle/ETag antes de versionar; un cambio concurrente se rechaza al guardar.',
    },
  };
  specification.paths['/api/v1/exercises/{id}/versions'].post.description =
    'Nueva versión inmutable por ADMIN del ámbito o TEACHER propietario. Organización y ejercicio activos; If-Match e Idempotency-Key obligatorios. Conserva versiones y pruebas fijadas por actividades e intentos anteriores.';
}
