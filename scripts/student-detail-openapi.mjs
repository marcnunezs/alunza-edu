import { z } from 'zod';
import * as c from '@alunza/contracts';

export function addStudentDetailOpenApi(specification, operation) {
  const base = '/api/v1/classes/{classId}/students/{studentId}';
  const routes = [
    [
      '/progress',
      'Progress',
      c.studentDetailProgressResponseSchema,
      c.studentDetailQuerySchema,
      [],
    ],
    [
      '/evidence',
      'Evidence',
      c.studentDetailEvidenceResponseSchema,
      c.studentDetailEvidenceQuerySchema,
      [],
    ],
    [
      '/attempts/{attemptId}',
      'Attempt',
      c.studentDetailAttemptResponseSchema,
      c.studentDetailItemQuerySchema,
      ['attemptId'],
    ],
    [
      '/attempts/{attemptId}/feedback',
      'FeedbackHistory',
      c.studentDetailFeedbackHistoryResponseSchema,
      c.studentDetailFeedbackQuerySchema,
      ['attemptId'],
    ],
    [
      '/feedback/{feedbackId}',
      'Feedback',
      c.studentDetailFeedbackResponseSchema,
      c.studentDetailItemQuerySchema,
      ['feedbackId'],
    ],
    [
      '/feedback/{feedbackId}/sources/{chunkId}',
      'Reference',
      c.studentDetailReferenceResponseSchema,
      c.studentDetailItemQuerySchema,
      ['feedbackId', 'chunkId'],
    ],
    [
      '/signals',
      'Signals',
      c.studentDetailSignalsResponseSchema,
      c.studentDetailSignalsQuerySchema,
      [],
    ],
    [
      '/signals/{signalId}',
      'Signal',
      c.studentDetailSignalResponseSchema,
      c.studentDetailItemQuerySchema,
      ['signalId'],
    ],
  ];
  for (const [suffix, name, schema, query, ids] of routes) {
    const component = `StudentDetail${name}`;
    const generated = z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io: 'input',
    });
    // Visible test arguments/results contain recursive JSON. Their standalone
    // references must resolve from the complete OpenAPI document.
    const definitions = generated.definitions ?? {};
    const rebase = (value) => {
      if (Array.isArray(value)) return value.map(rebase);
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            key === '$ref' &&
            typeof item === 'string' &&
            item.startsWith('#/definitions/')
              ? `#/components/schemas/${component}_${item.slice('#/definitions/'.length)}`
              : rebase(item),
          ]),
        );
      return value;
    };
    delete generated.definitions;
    specification.components.schemas[component] = rebase(generated);
    for (const [key, definition] of Object.entries(definitions))
      specification.components.schemas[`${component}_${key}`] =
        rebase(definition);
    const method = operation(`get${component}`, component, {
      ids: ['classId', 'studentId', ...ids],
    });
    specification.paths[base + suffix] = {
      get: {
        ...method,
        description:
          'IMP-06.03. Lectura del profesor vigente asignado a la clase y estudiante CURRENT_ACTIVE. ADMIN no tiene acceso pedagógico. No genera actividad estudiantil, ayuda ni revisión. Corte asOf compartido; from limita observaciones y conserva progreso acumulado. Ayudas exclusivamente con entrega FEEDBACK_VIEWED/HINT_DELIVERED hasta el corte, reautorizadas con permisos actuales; una ayuda no disponible omite texto y citas. No devuelve pruebas ocultas, tokens de presentación ni capacidades estudiantiles. Cursores ligados a actor, clase, estudiante, filtros y corte. No hay snapshot entre peticiones.',
        parameters: [
          ...method.parameters,
          ...Object.entries(
            z.toJSONSchema(query, { target: 'openapi-3.0', io: 'input' })
              .properties,
          ).map(([name, schema]) => ({
            name,
            in: 'query',
            required: false,
            schema,
          })),
        ],
      },
    };
  }
  const source =
    specification.paths[base + '/feedback/{feedbackId}/sources/{chunkId}'].get;
  specification.paths[
    base + '/feedback/{feedbackId}/sources/{chunkId}/content'
  ] = {
    get: {
      ...source,
      operationId: 'downloadStudentDetailReference',
      description:
        source.description +
        ' Descarga privada: verifica hash/tamaño y reautoriza después de Storage; Cache-Control no-store.',
      responses: {
        ...source.responses,
        200: {
          description: 'Documento original autorizado',
          content: {
            'application/octet-stream': {
              schema: { type: 'string', format: 'binary' },
            },
          },
        },
      },
    },
  };
}
