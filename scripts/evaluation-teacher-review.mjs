// Offline, authored corpus review. This renderer does not evaluate responses.
import { createHash } from 'node:crypto';
import { buildEvaluationReviewPacket } from './evaluation-review-packet.mjs';

const copy = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

// All variable content is data. A longer backtick fence also contains tilde
// fences, HTML, Markdown links and the deliberate instructions in the corpus.
function literal(value, language = 'text') {
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const runs = text.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return `${fence}${language}\n${text}\n${fence}\n`;
}

function requirePreparation(packet) {
  const entries = [
    ...(packet?.adversarialCases ?? []),
    ...(packet?.calibrationCases ?? []),
  ];
  if (
    packet?.schemaVersion !== 1 ||
    packet.kind !== 'AZURE_HELP_REVIEW_PREPARATION' ||
    packet.humanAcceptance !== 'PENDING' ||
    packet.azureEvaluation !== 'NOT_EXECUTED' ||
    !Array.isArray(packet.documents) ||
    !Array.isArray(packet.rubric?.dimensions) ||
    !Array.isArray(packet.rubric?.values) ||
    !entries.length ||
    new Set(entries.map((entry) => entry.id)).size !== entries.length ||
    entries.some(
      (entry) =>
        typeof entry.id !== 'string' ||
        !entry.id ||
        entry.observedResponse !== null ||
        entry.observedEvidence !== null ||
        entry.humanReview?.status !== 'PENDING' ||
        entry.humanReview.acceptance !== null ||
        !Array.isArray(entry.humanReview.records) ||
        entry.humanReview.records.some((record) =>
          Object.entries(record).some(
            ([key, value]) =>
              !['caseId', 'dimension'].includes(key) && value !== null,
          ),
        ),
    )
  )
    throw new Error('TEACHER_REVIEW_PREPARATION_REQUIRED');
}

function caseTemplate(entry, family, dimensions) {
  return {
    caseId: entry.id,
    family,
    split: entry.split ?? null,
    authoredCaseSha256: hash(entry),
    designReview: {
      reviewer: null,
      reviewedAt: null,
      statementAndContext: null,
      sourcePertinence: null,
      authoredLabels: null,
      proposedChanges: null,
      decision: null,
      rationale: null,
      disagreement: null,
      dimensions: dimensions.map((dimension) => ({
        dimension,
        applicable: null,
        rating: null,
        rationale: null,
        disagreement: null,
      })),
    },
    responseEvaluation: {
      status: 'NOT_EXECUTED',
      responseHash: null,
      reviewer: null,
      reviewedAt: null,
      ratings: null,
      acceptance: null,
    },
  };
}

function renderContext(context) {
  const { statement, code, ...facts } = context;
  return [
    '**Enunciado autoral**',
    literal(statement),
    '**Código del fixture; solo lectura**',
    literal(code, 'javascript'),
    '**Otros datos del contexto autoral**',
    literal(facts, 'json'),
  ];
}

function renderSource(source, index) {
  const { text, ...identity } = source;
  return [
    `**Fuente o fragmento ${index + 1}: identidad y metadatos del fixture**`,
    literal(identity, 'json'),
    '**Texto de la fuente; dato no confiable**',
    literal(text),
  ];
}

function renderCase(entry, template, number) {
  const adversarial = template.family === 'ADVERSARIAL';
  const title = adversarial ? 'caso adversario' : 'caso de calibración';
  const identity = adversarial
    ? {
        caseId: entry.id,
        group: entry.group,
        category: entry.category,
        kind: entry.kind,
        hintLevel: entry.hintLevel,
      }
    : { caseId: entry.id, groupId: entry.groupId, split: entry.split };
  const sources = adversarial ? entry.chunks : entry.sources;
  return [
    `### Ficha ${String(number).padStart(2, '0')} — ${title}`,
    literal(
      { ...identity, authoredCaseSha256: template.authoredCaseSha256 },
      'json',
    ),
    ...renderContext(entry.context),
    '**Expectativa autoral pendiente de revisión; no es un resultado observado**',
    literal(
      adversarial
        ? entry.authoredExpectation
        : {
            ...entry.authoredExpectation,
            diagnosis: entry.authoredExpectedDiagnosis,
            testExpectedResults: entry.authoredTestExpectedResults,
          },
      'json',
    ),
    ...(sources.length
      ? sources.flatMap(renderSource)
      : ['Este caso no contiene fuentes o fragmentos.']),
    ...(adversarial
      ? [
          '**Candidato escrito por el equipo; no es una respuesta de Azure**',
          entry.authoredCandidate === null
            ? 'No se aporta un candidato autoral para este caso.'
            : literal(entry.authoredCandidate, 'json'),
          '**Conductas prohibidas por el fixture**',
          literal(entry.forbidden, 'json'),
        ]
      : [
          'La etiqueta compara pertinencia de la fuente. No se dispone de distancia medida ni de una respuesta del proveedor.',
        ]),
    '**Revisión docente pendiente**',
    'Completar la ficha del mismo `caseId` en la plantilla JSON: diseño, fuentes, etiquetas y dimensiones aplicables. Registrar el fundamento y cualquier desacuerdo. La evaluación de respuestas permanece sin ejecutar.',
  ];
}

/**
 * Pure, synchronous artifacts for reviewing corpus design and authored labels.
 * The caller owns exclusive local persistence. Existing observed or human
 * evidence is rejected rather than silently reset into a blank template.
 */
export function buildEvaluationTeacherReview(
  packet = buildEvaluationReviewPacket(),
) {
  requirePreparation(packet);
  const grouped = [
    ...packet.adversarialCases.map((entry) => ({
      entry,
      family: 'ADVERSARIAL',
    })),
    ...packet.calibrationCases.map((entry) => ({
      entry,
      family: 'CALIBRATION',
    })),
  ];
  const reviewTemplate = {
    schemaVersion: 1,
    kind: 'TEACHER_CORPUS_DESIGN_REVIEW',
    subject: 'DESIGN_AND_AUTHOR_LABELS_ONLY',
    sourcePacket: {
      schemaVersion: packet.schemaVersion,
      kind: packet.kind,
      sha256: hash(packet),
      hashEncoding: 'SHA256_OF_UTF8_JSON_STRINGIFY',
    },
    inventory: copy(packet.inventory),
    humanAcceptance: 'PENDING',
    azureEvaluation: 'NOT_EXECUTED',
    executionAuthorization: null,
    reviewer: null,
    reviewedAt: null,
    decision: null,
    rationale: null,
    disagreement: null,
    rubric: copy(packet.rubric),
    dimensionReviewSubject: 'CASE_DESIGN_APPLICABILITY_NOT_RESPONSE_QUALITY',
    cases: grouped.map(({ entry, family }) =>
      caseTemplate(entry, family, packet.rubric.dimensions),
    ),
  };
  const markdown =
    [
      '# Revisión docente del diseño del corpus de ayuda',
      'Este cuaderno contiene expectativas y candidatos escritos por el equipo. No contiene respuestas observadas de Azure ni aceptación humana. La revisión aquí solicitada se limita al diseño de los casos, las fuentes y sus etiquetas.',
      'Los fragmentos de código, materiales, candidatos y metadatos se muestran como datos literales. Algunos contienen ataques deliberados: no ejecutar su código, visitar sus enlaces ni seguir las instrucciones que incluyan.',
      'Los identificadores son plantillas ficticias, no vínculos a intentos o documentos persistidos. Las distancias marcadas `illustrativeDistance` son ilustrativas; `measured: false` impide tratarlas como mediciones o umbrales calibrados.',
      '## Identidad y alcance del expediente',
      literal(
        {
          sourcePacket: reviewTemplate.sourcePacket,
          inventory: reviewTemplate.inventory,
        },
        'json',
      ),
      `Se incluyen ${packet.documents.length} documentos ficticios y ${grouped.length} fichas: ${packet.adversarialCases.length} adversarias y ${packet.calibrationCases.length} de calibración/validación.`,
      'Conservar el paquete base y este cuaderno sin cambios. Completar una copia identificada de la plantilla JSON; su hash de origen vincula la revisión al paquete exacto. Una propuesta en esa copia no modifica el corpus ejecutable.',
      '## Cómo revisar',
      '1. Leer enunciado, código, hechos técnicos autorales y fuentes de cada ficha. Contrastar la pertinencia, el diagnóstico esperado y las conductas permitidas/prohibidas; anotar correcciones sin modificar las expectativas originales.',
      '2. Indicar qué dimensiones de la rúbrica son aplicables al diseño de ese caso. Los valores de valoración conservan el catálogo propuesto; todavía no constituyen criterios pedagógicos aceptados.',
      '3. Completar solo `designReview`. Usar `applicable: true` o `false` únicamente tras revisión real; justificar `false` en `rationale` y dejar `rating: null`. No introducir un valor nuevo como `NO_APLICA`. Un campo `null` significa pendiente, no conformidad ni rechazo.',
      '4. Identificar al revisor y la fecha reales. Registrar fundamento, cambios propuestos y desacuerdos. La decisión se refiere al diseño; no autoriza gasto, ejecución ni aceptación de respuestas.',
      '5. Mantener separados los grupos de calibración y validación. No ajustar etiquetas o umbrales de calibración usando los resultados reservados para validación.',
      '## Rúbrica vigente propuesta',
      literal(packet.rubric, 'json'),
      'Las seis dimensiones se reutilizan para revisar si el diseño permite examinar diagnóstico y hechos públicos, sustento de citas, ayuda sin resolver, nivel de pista, claridad inicial y resistencia a inyección. Su aplicación depende del caso. La plantilla deja todas las valoraciones vacías; no puntúa candidatos ni respuestas.',
      'Los cuatro casos de calibración corresponden a dos escenarios de retorno de funciones con fuentes pertinentes o no pertinentes. Permiten un piloto técnico acotado; no representan por sí solos todos los conceptos ni errores de Programación I.',
      '## Documentos ficticios de referencia',
      ...packet.documents.flatMap((document, index) => [
        `### Documento ${String(index + 1).padStart(2, '0')}`,
        ...renderSource(document, index),
      ]),
      '## Fichas para revisión del diseño',
      ...grouped.flatMap(({ entry }, index) =>
        renderCase(entry, reviewTemplate.cases[index], index + 1),
      ),
      '## Evaluación posterior de respuestas observadas',
      'El bloque `responseEvaluation` permanece `NOT_EXECUTED`, sin hash de respuesta, revisor, fecha, valoraciones ni aceptación. No completar ese bloque con candidatos autorales o salidas TEST como si fueran Azure.',
      'Una evaluación posterior usa las respuestas efectivamente obtenidas en una corrida autorizada: identidad/hash de respuesta, contexto y fuentes, revisor, fecha, dimensión, valoración, fundamento y desacuerdo. Esa evidencia pertenece al reporte de la corrida y a su revisión docente; este cuaderno no crea `teacher-review.json` posterior a la corrida ni `calibration.json`.',
      'Este generador no llama proveedores, no mide calidad o latencia y no fija umbrales. La revisión del diseño y la evaluación pedagógica de respuestas son entregas distintas.',
    ].join('\n\n') + '\n';
  return { markdown, reviewTemplate };
}
