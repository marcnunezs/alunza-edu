import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  submitTechnicalResultSchema,
  type SubmitTechnicalResult,
} from '@alunza/contracts';
import {
  evaluateRepeatedError,
  repeatedErrorInputSchema,
  type RepeatedErrorInput,
} from './repeated-error';

const id = (n: number) =>
  `30000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const at = '2026-10-12T12:00:00.000000Z';
const lower = '2026-09-28T12:00:00.000000Z';
const scope = {
  organizationId: id(1),
  classId: id(2),
  studentId: id(3),
  activityId: id(4),
  assignmentId: id(5),
};
type Diagnosis = SubmitTechnicalResult['diagnosisCode'];
const errors = [
  'SYNTAX_ERROR',
  'RUNTIME_ERROR',
  'FAILED_TEST',
  'TIMEOUT',
] as const;

// Fixtures establish valid technical facts independently of the evaluator.
// Partial diagnostics deliberately do not establish complete visible counts.
function technical(
  diagnosis: Diagnosis = 'FAILED_TEST',
  partial = false,
  infrastructureStatus: 'OK' | 'FAILED' = 'OK',
): SubmitTechnicalResult {
  const success = diagnosis === 'SUCCESS';
  const allTests = ['visible-1', 'visible-2', 'visible-3'].map(
    (testId, index) => ({
      id: testId,
      passed: success || index === 0,
      stdout: '',
      stderr: '',
    }),
  );
  const visibleTestResults = partial
    ? diagnosis === 'SYNTAX_ERROR' || diagnosis === 'UNKNOWN'
      ? []
      : allTests.slice(0, 1)
    : allTests;
  const reasons: Record<Diagnosis, SubmitTechnicalResult['terminationReason']> =
    {
      SUCCESS: 'COMPLETED',
      SYNTAX_ERROR: 'STUDENT_SYNTAX',
      RUNTIME_ERROR: 'STUDENT_EXCEPTION',
      FAILED_TEST: 'ASSERTION_FAILED',
      TIMEOUT: 'EXECUTION_DEADLINE',
      UNKNOWN:
        infrastructureStatus === 'FAILED'
          ? 'RUNNER_FAILURE'
          : 'PROTOCOL_INVALID',
    };
  return {
    runnerVersion: 'runner.v1',
    diagnosisCode: diagnosis,
    terminationReason: reasons[diagnosis],
    infrastructureStatus,
    visibleTestResults,
    visiblePassed: visibleTestResults.filter((test) => test.passed).length,
    visibleTotal: 3,
    hiddenChecksPassed: success ? true : null,
    allRequiredPassed: success,
    outputTruncated: false,
    outputBytes: 0,
    runtimeMs: 1,
    lifecycleMs: 2,
  };
}
function attempt(
  n: number,
  diagnosis: Diagnosis = 'FAILED_TEST',
): RepeatedErrorInput['submissions'][number] {
  return {
    ...scope,
    id: id(10 + n),
    mode: 'SUBMIT',
    confirmed: true,
    submittedAt: `2026-10-${n.toString().padStart(2, '0')}T12:00:00.000000Z`,
    eventSequence: `${n}`,
    exerciseVersionId: id(6),
    profile: {
      testsVersion: 'a'.repeat(64),
      visibleTestIds: ['visible-1', 'visible-2', 'visible-3'],
      runnerVersion: 'runner.v1',
      resultSchemaVersion: 'submission.v1',
      limits: { memoryBytes: 134217728, runtimeMs: 3000, outputBytes: 65536 },
    },
    technicalResult: technical(diagnosis),
  };
}
function setup(
  diagnoses: Diagnosis[] = ['FAILED_TEST', 'FAILED_TEST', 'FAILED_TEST'],
): RepeatedErrorInput {
  return {
    evaluationTime: at,
    rule: {
      id: id(7),
      organizationId: scope.organizationId,
      type: 'REPEATED_ERROR',
      version: 1,
      schemaVersion: 1,
      algorithmVersion: 'DEC005_V1',
      parameters: { repeatedErrorAttempts: 3, repeatedErrorWindowDays: 14 },
      state: 'ACTIVE',
      createdBy: id(8),
      createdAt: '2026-09-01T00:00:00Z',
      activatedBy: id(8),
      validFrom: '2026-09-02T00:00:00Z',
      validTo: null,
    },
    activity: {
      ...scope,
      state: 'PUBLISHED',
      scopeEnabled: true,
      studentActive: true,
      enrollmentActive: true,
      enrolledAt: '2026-09-20T00:00:00Z',
      publishedAt: '2026-09-20T00:00:00Z',
      opensAt: null,
      closesAt: null,
      closedAt: null,
    },
    snapshot: {
      revision: 'synthetic-repeated-error-1',
      digest: 'a'.repeat(64),
      observedThrough: at,
      selectionComplete: true,
    },
    submissions: diagnoses.map((diagnosis, index) =>
      attempt(index + 1, diagnosis),
    ),
  };
}
function rule(input: RepeatedErrorInput) {
  if (input.rule?.type !== 'REPEATED_ERROR') throw new Error('fixture');
  return input.rule;
}
function chosen(input: RepeatedErrorInput, index = 2) {
  const value = input.submissions[index];
  if (!value) throw new Error('fixture');
  return value;
}
function profile(input: RepeatedErrorInput, index = 2) {
  const value = chosen(input, index).profile;
  if (!value) throw new Error('fixture');
  return value;
}

describe('DEC-005: error repetido puro con ventana anclada al corte', () => {
  it.each(errors)(
    'mismo diagnóstico canónico %s produce firma gruesa',
    (diagnosis) => {
      const input = setup([diagnosis, diagnosis, diagnosis]);
      const actual = evaluateRepeatedError(input);
      expect(actual).toMatchObject({
        type: 'REPEATED_ERROR',
        outcome: 'MATCH',
        reason: 'REPEATED_DIAGNOSIS',
        selectedAttemptIds: [id(11), id(12), id(13)],
        signature: { version: 'DEC005_V1_DIAGNOSIS', diagnosisCode: diagnosis },
        window: {
          days: 14,
          fromMicroseconds: '1790596800000000',
          toMicroseconds: '1791806400000000',
          fromInclusive: true,
          toInclusive: true,
        },
      });
      expect(
        actual.evidence?.submissions.map((value) => value.diagnosisCode),
      ).toEqual([diagnosis, diagnosis, diagnosis]);
    },
  );

  it.each([
    ['2026-09-28T11:59:59.999999Z', 'NO_MATCH'],
    [lower, 'MATCH'],
    ['2026-09-28T12:00:00.000001Z', 'MATCH'],
  ])('extremo inferior inclusivo a un microsegundo: %s', (firstAt, outcome) => {
    const input = setup();
    chosen(input, 0).submittedAt = firstAt;
    chosen(input).submittedAt = at;
    const actual = evaluateRepeatedError(input);
    expect(actual.outcome).toBe(outcome);
    expect(actual.selectedAttemptIds).toEqual([id(11), id(12), id(13)]);
    if (outcome === 'NO_MATCH') {
      expect(actual.reason).toBe('WINDOW_EXPIRED');
      expect(actual.signature).toBeNull();
    }
  });

  it('tripleta compacta antigua no cumple aunque su span sea inferior a 14 días', () => {
    const input = setup();
    input.submissions.forEach((value, index) => {
      value.submittedAt = `2026-09-${(21 + index).toString()}T12:00:00Z`;
    });
    expect(evaluateRepeatedError(input)).toMatchObject({
      outcome: 'NO_MATCH',
      reason: 'WINDOW_EXPIRED',
      selectedAttemptIds: [id(11), id(12), id(13)],
      signature: null,
    });
  });

  it('avanzar T un microsegundo vence la ventana con los mismos IDs', () => {
    const input = setup();
    chosen(input, 0).submittedAt = lower;
    chosen(input).submittedAt = at;
    const first = evaluateRepeatedError(input);
    input.evaluationTime = '2026-10-12T12:00:00.000001Z';
    input.snapshot.observedThrough = input.evaluationTime;
    const expired = evaluateRepeatedError(input);
    expect(first.outcome).toBe('MATCH');
    expect(expired.reason).toBe('WINDOW_EXPIRED');
    expect(expired.selectedAttemptIds).toEqual(first.selectedAttemptIds);
    expect(expired.window?.fromMicroseconds).toBe('1790596800000001');
    expect(first.window?.fromMicroseconds).toBe('1790596800000000');
  });

  it.each([
    ['2026-10-12T11:59:59.999999Z', 'MATCH'],
    [at, 'MATCH'],
    ['2026-10-12T12:00:00.000001Z', 'NOT_VERIFIABLE'],
  ])('extremo superior: un envío en %s', (submittedAt, outcome) => {
    const input = setup();
    chosen(input).submittedAt = submittedAt;
    const actual = evaluateRepeatedError(input);
    expect(actual.outcome).toBe(outcome);
    if (outcome === 'NOT_VERIFIABLE')
      expect(actual.reason).toBe('INSUFFICIENT_SUBMISSIONS');
  });

  it.each(['SUCCESS', 'UNKNOWN'] as const)(
    '%s canónico confirmado ocupa posición e interrumpe',
    (diagnosis) => {
      const input = setup(['FAILED_TEST', diagnosis, 'FAILED_TEST']);
      const actual = evaluateRepeatedError(input);
      expect(actual).toMatchObject({
        outcome: 'NO_MATCH',
        reason: 'DIAGNOSIS_INTERRUPTED',
        selectedAttemptIds: [id(11), id(12), id(13)],
        signature: null,
      });
    },
  );

  it.each(['OK', 'FAILED'] as const)(
    'UNKNOWN canónico parcial con infraestructura %s interrumpe sin contar cobertura',
    (infrastructureStatus) => {
      const input = setup();
      const result = technical('UNKNOWN', true, infrastructureStatus);
      expect(submitTechnicalResultSchema.safeParse(result).success).toBe(true);
      chosen(input, 1).technicalResult = result;
      expect(evaluateRepeatedError(input)).toMatchObject({
        outcome: 'NO_MATCH',
        reason: 'DIAGNOSIS_INTERRUPTED',
        selectedAttemptIds: [id(11), id(12), id(13)],
        signature: null,
      });
    },
  );

  it('diagnósticos elegibles diferentes no afirman mismo error', () => {
    const actual = evaluateRepeatedError(
      setup(['FAILED_TEST', 'RUNTIME_ERROR', 'FAILED_TEST']),
    );
    expect(actual).toMatchObject({
      outcome: 'NO_MATCH',
      reason: 'DIAGNOSIS_DIFFERS',
      signature: null,
    });
  });

  it.each(['SUCCESS', 'UNKNOWN'] as const)(
    '%s canónico interrumpe aunque haya incompatibilidad entre suites',
    (diagnosis) => {
      const input = setup(['FAILED_TEST', diagnosis, 'FAILED_TEST']);
      profile(input, 1).testsVersion = 'b'.repeat(64);
      chosen(input, 1).exerciseVersionId = id(99);
      chosen(input, 1).technicalResult =
        diagnosis === 'UNKNOWN'
          ? technical('UNKNOWN', true, 'FAILED')
          : technical('SUCCESS');
      expect(evaluateRepeatedError(input)).toMatchObject({
        outcome: 'NO_MATCH',
        reason: 'DIAGNOSIS_INTERRUPTED',
        selectedAttemptIds: [id(11), id(12), id(13)],
        signature: null,
      });
    },
  );

  it.each(['SUCCESS', 'UNKNOWN'] as const)(
    'último %s ocupa posición y no permite rescatar la terna anterior',
    (diagnosis) => {
      const input = setup([
        'FAILED_TEST',
        'FAILED_TEST',
        'FAILED_TEST',
        diagnosis,
      ]);
      expect(evaluateRepeatedError(input)).toMatchObject({
        outcome: 'NO_MATCH',
        reason: 'DIAGNOSIS_INTERRUPTED',
        selectedAttemptIds: [id(12), id(13), id(14)],
        signature: null,
      });
    },
  );

  it('UNKNOWN con metadato individual contradictorio no prueba interrupción', () => {
    const input = setup(['FAILED_TEST', 'UNKNOWN', 'FAILED_TEST']);
    const result = technical('UNKNOWN', true);
    result.runnerVersion = 'runner.v2';
    expect(submitTechnicalResultSchema.safeParse(result).success).toBe(true);
    chosen(input, 1).technicalResult = result;
    expect(evaluateRepeatedError(input)).toMatchObject({
      outcome: 'NOT_VERIFIABLE',
      reason: 'RESULT_NOT_VERIFIABLE',
      selectedAttemptIds: [id(11), id(12), id(13)],
      signature: null,
    });
  });

  it.each(errors)(
    'diagnóstico confiable %s parcial puede repetirse sin suite visible completa',
    (diagnosis) => {
      const input = setup([diagnosis, diagnosis, diagnosis]);
      input.submissions.forEach((value) => {
        const result = technical(diagnosis, true);
        expect(submitTechnicalResultSchema.safeParse(result).success).toBe(
          true,
        );
        expect(result.visibleTestResults.length).toBeLessThan(
          result.visibleTotal,
        );
        value.technicalResult = result;
      });
      expect(evaluateRepeatedError(input).outcome).toBe('MATCH');
    },
  );

  it.each(errors)(
    'infraestructura FAILED no puede etiquetarse %s',
    (diagnosis) => {
      const input = setup();
      const result = technical(diagnosis, true, 'FAILED');
      expect(submitTechnicalResultSchema.safeParse(result).success).toBe(false);
      chosen(input).technicalResult = result;
      expect(evaluateRepeatedError(input)).toMatchObject({
        outcome: 'NOT_VERIFIABLE',
        reason: 'RESULT_NOT_VERIFIABLE',
        selectedAttemptIds: [id(11), id(12), id(13)],
        signature: null,
      });
    },
  );

  it.each([
    'null',
    'missing-diagnosis',
    'incoherent-count',
    'duplicate-test',
    'fake-success',
  ])(
    'último resultado %s permanece seleccionado y no rescata una tripleta anterior',
    (variant) => {
      const input = setup([
        'FAILED_TEST',
        'FAILED_TEST',
        'FAILED_TEST',
        'FAILED_TEST',
      ]);
      const result = technical();
      if (variant === 'incoherent-count') result.visiblePassed = 2;
      if (variant === 'duplicate-test')
        result.visibleTestResults[1]!.id = 'visible-1';
      if (variant === 'fake-success') result.diagnosisCode = 'SUCCESS';
      chosen(input, 3).technicalResult =
        variant === 'null'
          ? null
          : variant === 'missing-diagnosis'
            ? { runnerVersion: 'runner.v1' }
            : result;
      expect(evaluateRepeatedError(input)).toMatchObject({
        outcome: 'NOT_VERIFIABLE',
        reason: 'RESULT_NOT_VERIFIABLE',
        selectedAttemptIds: [id(12), id(13), id(14)],
        signature: null,
      });
    },
  );

  it.each([
    'version',
    'suite',
    'runner',
    'memory-limit',
    'runtime-limit',
    'output-limit',
    'schema',
    'visible-set',
    'missing-profile',
    'missing-version',
  ])('últimos N antes de comparabilidad: último %s no se omite', (variant) => {
    const input = setup([
      'FAILED_TEST',
      'FAILED_TEST',
      'FAILED_TEST',
      'FAILED_TEST',
    ]);
    const value = chosen(input, 3);
    const current = profile(input, 3);
    if (variant === 'version') value.exerciseVersionId = id(99);
    if (variant === 'suite') current.testsVersion = 'b'.repeat(64);
    if (variant === 'runner') {
      current.runnerVersion = 'runner.v2';
      const result = technical();
      result.runnerVersion = 'runner.v2';
      value.technicalResult = result;
    }
    if (variant === 'memory-limit') current.limits.memoryBytes += 1;
    if (variant === 'runtime-limit') current.limits.runtimeMs += 1;
    if (variant === 'output-limit') current.limits.outputBytes += 1;
    if (variant === 'schema') current.resultSchemaVersion = 'submission.v2';
    if (variant === 'visible-set') {
      current.visibleTestIds[0] = 'other-visible';
      const result = technical();
      result.visibleTestResults[0]!.id = 'other-visible';
      value.technicalResult = result;
    }
    if (variant === 'missing-profile') value.profile = null;
    if (variant === 'missing-version') value.exerciseVersionId = null;
    expect(evaluateRepeatedError(input)).toMatchObject({
      outcome: 'NOT_VERIFIABLE',
      reason: 'NOT_COMPARABLE',
      selectedAttemptIds: [id(12), id(13), id(14)],
      signature: null,
    });
  });

  it.each(['unknown-schema', 'duplicate-set'])(
    'metadatos comunes %s no acreditan comparabilidad',
    (variant) => {
      const input = setup();
      input.submissions.forEach((value) => {
        if (!value.profile) throw new Error('fixture');
        if (variant === 'unknown-schema')
          value.profile.resultSchemaVersion = 'submission.v2';
        else value.profile.visibleTestIds[0] = 'visible-2';
      });
      expect(evaluateRepeatedError(input).reason).toBe('NOT_COMPARABLE');
    },
  );

  it.each([
    'foreign-visible-id',
    'different-visible-total',
    'different-result-runner',
  ])('resultado canónico %s no coincide con el perfil confiable', (variant) => {
    const input = setup();
    const result = technical('TIMEOUT', true);
    if (variant === 'foreign-visible-id')
      result.visibleTestResults[0]!.id = 'foreign-test';
    if (variant === 'different-visible-total') result.visibleTotal = 4;
    if (variant === 'different-result-runner')
      result.runnerVersion = 'runner.v2';
    chosen(input).technicalResult = result;
    expect(submitTechnicalResultSchema.safeParse(result).success).toBe(true);
    expect(evaluateRepeatedError(input).reason).toBe('RESULT_NOT_VERIFIABLE');
  });

  it('IDs visibles son conjunto; orden del perfil y resultados no cambia la firma', () => {
    const input = setup();
    profile(input).visibleTestIds.reverse();
    const result = technical();
    result.visibleTestResults.reverse();
    chosen(input).technicalResult = result;
    const actual = evaluateRepeatedError(input);
    expect(actual.outcome).toBe('MATCH');
    expect(actual.evidence?.visibleTestIds).toEqual([
      'visible-1',
      'visible-2',
      'visible-3',
    ]);
  });

  it.each([
    'RUN',
    'unconfirmed',
    'future',
    'organizationId',
    'classId',
    'studentId',
    'activityId',
    'assignmentId',
  ])('%s no ocupa posición del carril', (variant) => {
    const input = setup();
    const other = attempt(4, 'SUCCESS');
    if (variant === 'RUN') other.mode = 'RUN';
    if (variant === 'unconfirmed') {
      other.confirmed = false;
      other.submittedAt = null;
      other.eventSequence = null;
    }
    if (variant === 'future') other.submittedAt = '2026-10-12T12:00:00.000001Z';
    if (
      [
        'organizationId',
        'classId',
        'studentId',
        'activityId',
        'assignmentId',
      ].includes(variant)
    )
      other[variant as keyof typeof scope] = id(99);
    input.submissions.push(other);
    expect(evaluateRepeatedError(input)).toMatchObject({
      outcome: 'MATCH',
      selectedAttemptIds: [id(11), id(12), id(13)],
    });
  });

  it('ordena microsegundos antes de la secuencia y esta antes del UUID/array', () => {
    const input = setup();
    chosen(input, 0).submittedAt = '2026-10-12T11:59:59.999999Z';
    chosen(input, 0).eventSequence = '9223372036854775807';
    chosen(input, 1).submittedAt = at;
    chosen(input, 1).eventSequence = '9007199254740993';
    chosen(input).submittedAt = at;
    chosen(input).eventSequence = '9007199254740994';
    input.submissions.reverse();
    expect(evaluateRepeatedError(input).selectedAttemptIds).toEqual([
      id(11),
      id(12),
      id(13),
    ]);
  });

  it.each([
    'different-payload',
    'same-sequence-other-id',
    'missing-sequence',
    'missing-time',
  ])('confirmación incoherente: %s', (variant) => {
    const input = setup();
    const value = structuredClone(chosen(input));
    if (variant === 'different-payload')
      value.technicalResult = technical('TIMEOUT');
    if (variant === 'same-sequence-other-id') value.id = id(99);
    if (variant === 'missing-sequence') value.eventSequence = null;
    if (variant === 'missing-time') value.submittedAt = null;
    input.submissions.push(value);
    expect(evaluateRepeatedError(input).reason).toBe('EVIDENCE_INCOHERENT');
  });

  it('replay idéntico es determinista, no duplica posiciones ni muta entradas', () => {
    const input = setup();
    input.submissions.push(structuredClone(chosen(input)));
    const before = structuredClone(input);
    const first = evaluateRepeatedError(input);
    input.submissions.reverse();
    expect(evaluateRepeatedError(input)).toEqual(first);
    input.submissions.reverse();
    expect(input).toEqual(before);
    expect(first.selectedAttemptIds).toEqual([id(11), id(12), id(13)]);
    expect(first).not.toHaveProperty('state');
    expect(first).not.toHaveProperty('signalId');
  });

  it.each(['scopeEnabled', 'studentActive', 'enrollmentActive'] as const)(
    '%s false impide evaluar trabajo actual',
    (flag) => {
      const input = setup();
      input.activity[flag] = false;
      expect(evaluateRepeatedError(input).outcome).toBe('NOT_EVALUABLE');
    },
  );
  it.each(['DRAFT', 'CLOSED'] as const)(
    'actividad %s no abre señal',
    (state) => {
      const input = setup();
      input.activity.state = state;
      expect(evaluateRepeatedError(input).outcome).toBe('NOT_EVALUABLE');
    },
  );
  it.each(['closesAt', 'closedAt'] as const)(
    '%s es cierre exclusivo',
    (field) => {
      const input = setup();
      input.activity[field] = at;
      input.evaluationTime = '2026-10-12T11:59:59.999999Z';
      expect(evaluateRepeatedError(input).outcome).toBe('MATCH');
      input.evaluationTime = at;
      expect(evaluateRepeatedError(input).outcome).toBe('NOT_EVALUABLE');
      input.evaluationTime = '2026-10-12T12:00:00.000001Z';
      expect(evaluateRepeatedError(input).outcome).toBe('NOT_EVALUABLE');
    },
  );
  it.each(['enrolledAt', 'publishedAt', 'opensAt'] as const)(
    '%s tiene comienzo inclusivo y futuro no evaluable',
    (field) => {
      const input = setup();
      input.activity[field] = at;
      expect(evaluateRepeatedError(input).outcome).toBe('MATCH');
      input.activity[field] = '2026-10-12T12:00:00.000001Z';
      expect(evaluateRepeatedError(input).reason).toBe('START_NOT_REACHED');
    },
  );

  it.each(['partial-page', 'cutoff-not-covered'])(
    'snapshot %s no demuestra los últimos N',
    (variant) => {
      const input = setup();
      if (variant === 'partial-page') input.snapshot.selectionComplete = false;
      else input.snapshot.observedThrough = '2026-10-12T11:59:59.999999Z';
      expect(evaluateRepeatedError(input).reason).toBe('SNAPSHOT_INCOMPLETE');
    },
  );
  it('commit tardío cambia revisión/cálculo para el mismo T y conserva la salida previa', () => {
    const input = setup();
    const first = evaluateRepeatedError(input);
    input.snapshot.revision = 'synthetic-repeated-error-2';
    input.snapshot.digest = 'b'.repeat(64);
    const late = attempt(4, 'SUCCESS');
    late.submittedAt = at;
    input.submissions.push(late);
    const second = evaluateRepeatedError(input);
    expect(first.outcome).toBe('MATCH');
    expect(second.reason).toBe('DIAGNOSIS_INTERRUPTED');
    expect(second.snapshot).not.toEqual(first.snapshot);
    expect(first.selectedAttemptIds).toEqual([id(11), id(12), id(13)]);
    expect(second.selectedAttemptIds).toEqual([id(12), id(13), id(14)]);
  });

  it('regla aplicable [A,B), retirada histórica, DRAFT y organización ajena', () => {
    const input = setup();
    rule(input).validFrom = at;
    input.evaluationTime = '2026-10-12T11:59:59.999999Z';
    expect(evaluateRepeatedError(input).reason).toBe('NO_APPLICABLE_RULE');
    input.evaluationTime = at;
    expect(evaluateRepeatedError(input).outcome).toBe('MATCH');
    rule(input).state = 'RETIRED';
    rule(input).validTo = '2026-10-12T12:00:00.000001Z';
    expect(evaluateRepeatedError(input).outcome).toBe('MATCH');
    input.evaluationTime = '2026-10-12T12:00:00.000001Z';
    input.snapshot.observedThrough = input.evaluationTime;
    expect(evaluateRepeatedError(input).reason).toBe('NO_APPLICABLE_RULE');
    Object.assign(rule(input), {
      state: 'DRAFT',
      validFrom: null,
      validTo: null,
      activatedBy: null,
    });
    expect(evaluateRepeatedError(input).reason).toBe('NO_APPLICABLE_RULE');
    input.rule = null;
    expect(evaluateRepeatedError(input).reason).toBe('NO_APPLICABLE_RULE');
    const other = setup();
    rule(other).organizationId = id(99);
    expect(evaluateRepeatedError(other).reason).toBe('NO_APPLICABLE_RULE');
  });

  it('N=2 y N=4 distinguen un diagnóstico distinto fuera/dentro de la selección', () => {
    const input = setup([
      'RUNTIME_ERROR',
      'FAILED_TEST',
      'FAILED_TEST',
      'FAILED_TEST',
    ]);
    rule(input).parameters.repeatedErrorAttempts = 2;
    const two = evaluateRepeatedError(input);
    expect(two.outcome).toBe('MATCH');
    expect(two.selectedAttemptIds).toEqual([id(13), id(14)]);
    rule(input).parameters.repeatedErrorAttempts = 4;
    const four = evaluateRepeatedError(input);
    expect(four.reason).toBe('DIAGNOSIS_DIFFERS');
    expect(four.selectedAttemptIds).toEqual([id(11), id(12), id(13), id(14)]);
    chosen(input, 0).technicalResult = technical();
    expect(evaluateRepeatedError(input).outcome).toBe('MATCH');
  });
  it('menos de N e int4 máximo no inventan evidencia ni reservan N entradas', () => {
    const input = setup(['FAILED_TEST', 'FAILED_TEST']);
    expect(evaluateRepeatedError(input).reason).toBe(
      'INSUFFICIENT_SUBMISSIONS',
    );
    rule(input).parameters.repeatedErrorAttempts = 2_147_483_647;
    expect(evaluateRepeatedError(input).reason).toBe(
      'INSUFFICIENT_SUBMISSIONS',
    );
  });
  it('ventana configurada usa días UTC y aritmética bigint hasta int4', () => {
    const input = setup();
    rule(input).parameters.repeatedErrorWindowDays = 1;
    expect(evaluateRepeatedError(input).reason).toBe('WINDOW_EXPIRED');
    rule(input).parameters.repeatedErrorWindowDays = 2_147_483_647;
    const actual = evaluateRepeatedError(input);
    expect(actual.outcome).toBe('MATCH');
    expect(actual.window?.fromMicroseconds).toBe('-185540795294400000000');
    expect(actual.window?.toMicroseconds).toBe('1791806400000000');
  });

  it('offsets equivalentes preservan microsegundos y no consultan reloj real', () => {
    const input = setup();
    input.evaluationTime = '2026-10-12T09:00:00.000001-03:00';
    input.snapshot.observedThrough = input.evaluationTime;
    chosen(input, 0).submittedAt = '2026-09-28T14:00:00.000001+02:00';
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('real clock');
    });
    try {
      const actual = evaluateRepeatedError(input);
      expect(actual.outcome).toBe('MATCH');
      expect(actual.evaluationTime).toBe('2026-10-12T12:00:00.000001Z');
      expect(actual.evidence?.submissions[0]?.submittedAt).toBe(
        '2026-09-28T12:00:00.000001Z',
      );
      expect(clock).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
  it.each([
    '2026-10-12T12:00:00',
    '2026-10-12T12:00:00.0000001Z',
    '2026-02-30T12:00:00Z',
  ])('fecha inválida se rechaza sin redondear: %s', (value) => {
    const input = setup();
    chosen(input).submittedAt = value;
    expect(() => evaluateRepeatedError(input)).toThrow();
  });
  it.each(['0', '-1', '1.5', '01', '9223372036854775808'])(
    'secuencia inválida %s no se coacciona',
    (value) => {
      const input = setup();
      chosen(input).eventSequence = value;
      expect(() => evaluateRepeatedError(input)).toThrow();
    },
  );
  it.each(['repeatedErrorAttempts', 'repeatedErrorWindowDays'] as const)(
    'parámetro %s inválido no cambia el contrato .03',
    (field) => {
      for (const value of [0, -1, 1.5, 2_147_483_648]) {
        const input = setup();
        rule(input).parameters[field] = value;
        expect(() => evaluateRepeatedError(input)).toThrow();
      }
      if (field === 'repeatedErrorAttempts') {
        const input = setup();
        rule(input).parameters[field] = 1;
        expect(() => evaluateRepeatedError(input)).toThrow();
      }
    },
  );
  it('rechaza extras y otro tipo de regla; expone schema estricto propio', () => {
    expect(repeatedErrorInputSchema.safeParse(setup()).success).toBe(true);
    expect(() =>
      evaluateRepeatedError({ ...setup(), clientTime: at }),
    ).toThrow();
    const input = setup();
    Object.assign(rule(input), {
      type: 'STAGNATION',
      parameters: { stagnationAttempts: 3 },
    });
    expect(() => evaluateRepeatedError(input)).toThrow();
  });

  it('evidencia/cause no expone consola, código ni detalle oculto y no cambia firma por texto', () => {
    const input = setup();
    const first = evaluateRepeatedError(input);
    const result = technical();
    result.visibleTestResults[0]!.stdout = 'private-console-marker';
    result.visibleTestResults[0]!.stderr = 'private-error-marker';
    result.outputBytes = 100;
    result.hiddenChecksPassed = false;
    chosen(input).technicalResult = result;
    const second = evaluateRepeatedError(input);
    expect(second.signature).toEqual(first.signature);
    expect(second.evidence).toEqual(first.evidence);
    for (const forbidden of [
      'stdout',
      'stderr',
      'hiddenChecksPassed',
      'private-console-marker',
      'private-error-marker',
    ])
      expect(JSON.stringify(second)).not.toContain(forbidden);
    expect(second.evidence).not.toHaveProperty('code');
    expect(second.cause).toContain('FAILED_TEST');
  });

  type LegacyFixture = {
    id: string;
    input: {
      evaluationTime: string;
      attempts: {
        submittedAt: string;
        diagnosisCode: Diagnosis;
        technicalResult?: SubmitTechnicalResult;
      }[];
    };
    expected: { verifiable: boolean; createSignal: boolean };
  };
  const legacy = (
    JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../../fixtures/progress/signals-proposed.json',
        ),
        'utf8',
      ),
    ) as LegacyFixture[]
  ).filter((fixture) =>
    ['SIG-05', 'SIG-06', 'SIG-07', 'SIG-08'].includes(fixture.id),
  );
  it.each(legacy)(
    '$id conserva expected con proyección canónica sintética',
    ({ input: fixture, expected }) => {
      const input = setup();
      input.evaluationTime = fixture.evaluationTime;
      input.snapshot.observedThrough = fixture.evaluationTime;
      input.activity.enrolledAt = '2026-09-01T00:00:00Z';
      input.activity.publishedAt = '2026-09-01T00:00:00Z';
      input.submissions = fixture.attempts.map((source, index) => {
        const value = attempt(index + 1, source.diagnosisCode);
        value.submittedAt = source.submittedAt;
        value.technicalResult =
          source.technicalResult ?? technical(source.diagnosisCode);
        expect(
          submitTechnicalResultSchema.safeParse(value.technicalResult).success,
        ).toBe(true);
        return value;
      });
      const actual = evaluateRepeatedError(input);
      expect(actual.outcome === 'MATCH').toBe(expected.createSignal);
      expect(['MATCH', 'NO_MATCH'].includes(actual.outcome)).toBe(
        expected.verifiable,
      );
    },
  );
});
