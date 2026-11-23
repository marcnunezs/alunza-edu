import { z } from 'zod';
import * as c from '@alunza/contracts';

export function addHelpOpenApi(specification, operation) {
  for (const [name, schema] of Object.entries({
    HelpRequestInput: c.helpRequestInputSchema,
    HelpRequest: c.helpRequestResponseSchema,
    HelpFeedback: c.helpFeedbackResponseSchema,
    HelpHistory: c.helpHistoryResponseSchema,
    HelpReference: c.helpReferenceResponseSchema,
    HelpViewedInput: c.helpViewedInputSchema,
  }))
    specification.components.schemas[name] = z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io: 'input',
    });
  const add = (path, method, name, schema, options = {}) => {
    const ids = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    const result = operation(name, schema, { ids, ...options });
    specification.paths[`/api/v1${path}`] ??= {};
    specification.paths[`/api/v1${path}`][method] = result;
    return result;
  };
  const admission = add(
    '/attempts/{id}/feedback-requests',
    'post',
    'requestOwnHelp',
    'HelpRequest',
    {
      input: 'HelpRequestInput',
      idempotent: true,
      status: 202,
    },
  );
  admission.description =
    'Solo estudiante propietario ACTIVE e intento confirmado. CLOSED permite ayuda. FEEDBACK no consume niveles; HINT reserva el siguiente de tres niveles. 202 confirma trabajo durable, no feedback. Replay recupera el mismo trabajo; cuotas no cuentan replay. Nunca modifica diagnóstico ni progreso.';
  add('/feedback-requests/{id}', 'get', 'getOwnHelpRequest', 'HelpRequest');
  const history = add(
    '/attempts/{id}/feedback',
    'get',
    'listOwnFeedback',
    'HelpHistory',
    { list: true },
  );
  history.parameters = history.parameters
    .filter((parameter) => parameter.name !== 'search')
    .map((parameter) =>
      parameter.name === 'limit'
        ? {
            ...parameter,
            schema: { type: 'integer', minimum: 1, maximum: 20, default: 20 },
          }
        : parameter,
    );
  add('/feedback/{id}', 'get', 'getOwnFeedback', 'HelpFeedback').description =
    'Revalida todas las fuentes utilizadas. RAG mantiene exactamente cinco campos. Token de presentación únicamente para SUPPORTED; GET no registra entrega.';
  add(
    '/feedback/{id}/viewed',
    'post',
    'acknowledgeOwnFeedback',
    'HelpFeedback',
    { input: 'HelpViewedInput' },
  ).description =
    'ACK autenticado, idempotente por feedback y contenido servido; no concede niveles por fallbacks ni polling.';
  add(
    '/feedback/{id}/sources/{chunkId}',
    'get',
    'getOwnFeedbackReference',
    'HelpReference',
  );
  const content = add(
    '/feedback/{id}/sources/{chunkId}/content',
    'get',
    'downloadOwnFeedbackReference',
    'HelpReference',
  );
  content.responses[200].description =
    'Archivo de la versión citada, aunque haya reemplazo; requiere feedback propio y fuente actualmente autorizada. no-store, attachment, sin URL pública o firmada.';
  content.responses[200].content = Object.fromEntries(
    ['application/pdf', 'text/plain', 'text/markdown'].map((type) => [
      type,
      { schema: { type: 'string', format: 'binary' } },
    ]),
  );
}
