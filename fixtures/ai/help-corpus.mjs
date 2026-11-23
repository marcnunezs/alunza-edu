// Fictitious product examples. This corpus does not certify pedagogy or Azure.
export const helpContext = {
  attemptId: 'b0000000-0000-4000-8000-000000000001',
  exerciseVersionId: 'b0000000-0000-4000-8000-000000000002',
  statement: 'Escribe una función doble que devuelva el doble de su argumento.',
  concepts: ['funciones', 'retorno'],
  code: 'function doble(numero) { numero * 2; }',
  diagnosisCode: 'FAILED_TEST',
  infrastructureStatus: 'OK',
  visibleTests: [{ id: 'visible-1', passed: false }],
};
export const helpChunk = {
  source_id: 'b0000000-0000-4000-8000-000000000003',
  source_version_id: 'b0000000-0000-4000-8000-000000000004',
  chunk_id: 'b0000000-0000-4000-8000-000000000005',
  locator: 'líneas 1–2',
  text: 'Una función puede calcular un valor. La sentencia return devuelve el valor al llamador.',
  distance: 0.08,
};
const { text: _text, distance: _distance, ...ref } = helpChunk;
export const helpCandidates = {
  FEEDBACK: {
    diagnosis_code: 'FAILED_TEST',
    explanation:
      'El intento no superó todas las pruebas. Una función que calcula un valor también debe devolverlo para que el llamador lo reciba.',
    hint: '',
    source_refs: [ref],
    status: 'SUPPORTED',
  },
  1: {
    diagnosis_code: 'FAILED_TEST',
    explanation:
      'El intento no superó todas las pruebas. Calcular y devolver son operaciones distintas.',
    hint: 'Revisa el concepto de retorno de una función.',
    source_refs: [ref],
    status: 'SUPPORTED',
  },
  2: {
    diagnosis_code: 'FAILED_TEST',
    explanation: 'El llamador necesita recibir un valor de la función.',
    hint: '¿Qué sentencia hace que el valor calculado llegue al llamador?',
    source_refs: [ref],
    status: 'SUPPORTED',
  },
  3: {
    diagnosis_code: 'FAILED_TEST',
    explanation: 'La sentencia return comunica un valor al llamador.',
    hint: 'Identifica dónde se calcula el resultado y decide cómo devolver ese valor.',
    source_refs: [ref],
    status: 'SUPPORTED',
  },
};
