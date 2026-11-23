import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { submitTechnicalResultSchema } from '@alunza/contracts';
import { evaluateStagnation, type StagnationInput } from './stagnation';

const id = (n: number) =>
  `20000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const at = '2026-10-12T12:00:00.000000Z';
const scope = {
  organizationId: id(1),
  classId: id(2),
  studentId: id(3),
  activityId: id(4),
  assignmentId: id(5),
};
function technical(passed: number, success = false) {
  return {
    runnerVersion: 'runner.v1',
    diagnosisCode: success ? 'SUCCESS' : 'FAILED_TEST',
    terminationReason: success ? 'COMPLETED' : 'ASSERTION_FAILED',
    infrastructureStatus: 'OK',
    visibleTestResults: ['visible-1', 'visible-2', 'visible-3'].map(
      (id, index) => ({
        id,
        passed: index < passed,
        stdout: '',
        stderr: '',
      }),
    ),
    visiblePassed: passed,
    visibleTotal: 3,
    hiddenChecksPassed: success ? true : false,
    allRequiredPassed: success,
    outputTruncated: false,
    outputBytes: 0,
    runtimeMs: 1,
    lifecycleMs: 2,
  };
}
function attempt(
  n: number,
  passed: number,
): StagnationInput['submissions'][number] {
  return {
    ...scope,
    id: id(10 + n),
    mode: 'SUBMIT',
    confirmed: true,
    submittedAt: `2026-10-0${n}T12:00:00.000000Z`,
    eventSequence: `${n}`,
    exerciseVersionId: id(6),
    profile: {
      testsVersion: 'a'.repeat(64),
      visibleTestIds: ['visible-1', 'visible-2', 'visible-3'],
      runnerVersion: 'runner.v1',
      resultSchemaVersion: 'submission.v1',
      limits: { memoryBytes: 134217728, runtimeMs: 3000, outputBytes: 65536 },
    },
    technicalResult: technical(passed),
  };
}
function setup(counts = [1, 1, 1]): StagnationInput {
  return {
    evaluationTime: at,
    rule: {
      id: id(7),
      organizationId: scope.organizationId,
      type: 'STAGNATION',
      version: 1,
      schemaVersion: 1,
      algorithmVersion: 'DEC005_V1',
      parameters: { stagnationAttempts: 3 },
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
      revision: 'synthetic-stagnation-1',
      digest: 'a'.repeat(64),
      observedThrough: at,
      selectionComplete: true,
    },
    submissions: counts.map((count, index) => attempt(index + 1, count)),
  };
}
function rule(input: StagnationInput) {
  if (input.rule?.type !== 'STAGNATION') throw new Error('fixture');
  return input.rule;
}
function chosen(input: StagnationInput, index = 2) {
  const value = input.submissions[index];
  if (!value) throw new Error('fixture');
  return value;
}
function profile(input: StagnationInput, index = 2) {
  const value = chosen(input, index).profile;
  if (!value) throw new Error('fixture');
  return value;
}

describe('DEC-005: estancamiento puro sin ventana adicional', () => {
  it.each<[number[], 'MATCH' | 'NO_MATCH']>([
    [[1, 1, 1], 'MATCH'],
    [[2, 1, 1], 'MATCH'],
    [[0, 0, 0], 'MATCH'],
    [[1, 2, 2], 'NO_MATCH'],
    [[2, 1, 2], 'NO_MATCH'],
  ])('comparaciones adyacentes %j', (counts, outcome) => {
    const actual = evaluateStagnation(setup(counts));
    expect(actual.outcome).toBe(outcome);
    expect(
      actual.evidence?.submissions.map((value) => value.visiblePassed),
    ).toEqual(counts);
  });

  it('envíos separados por más de 14 días siguen siendo comparables', () => {
    const input = setup();
    chosen(input, 0).submittedAt = '2026-09-21T12:00:00Z';
    chosen(input, 1).submittedAt = '2026-09-25T12:00:00Z';
    chosen(input).submittedAt = at;
    expect(evaluateStagnation(input).outcome).toBe('MATCH');
  });

  it('último allRequiredPassed canónico suprime aunque visibles sean constantes', () => {
    const input = setup([3, 3, 3]);
    chosen(input).technicalResult = technical(3, true);
    expect(evaluateStagnation(input).reason).toBe('LAST_REQUIRED_PASSED');
  });

  it('visibles 3,3,3 sin cumplir requeridos pueden estancarse, sin revelar ocultas', () => {
    const actual = evaluateStagnation(setup([3, 3, 3]));
    expect(actual.outcome).toBe('MATCH');
    expect(actual.evidence).not.toHaveProperty('hiddenChecksPassed');
    expect(JSON.stringify(actual)).not.toContain('stdout');
    expect(JSON.stringify(actual)).not.toContain('hiddenChecksPassed');
  });

  it('éxito previo no elimina una tripleta posterior ni cambia progreso', () => {
    const input = setup();
    const old = attempt(4, 3);
    old.id = id(100);
    old.eventSequence = '4';
    old.submittedAt = '2026-09-25T00:00:00Z';
    old.technicalResult = technical(3, true);
    input.submissions.unshift(old);
    const before = structuredClone(input);
    const actual = evaluateStagnation(input);
    expect(actual.outcome).toBe('MATCH');
    expect(actual.selectedAttemptIds).toEqual([id(11), id(12), id(13)]);
    expect(input).toEqual(before);
  });

  it.each([
    'UNKNOWN',
    'partial',
    'null-result',
    'infrastructure-failed',
    'incoherent-count',
    'duplicate-test',
    'zero-total',
  ])(
    'último %s ocupa posición y no se salta para rescatar terna anterior',
    (variant) => {
      const input = setup([1, 1, 1, 1]);
      const value = chosen(input, 3);
      const result = technical(1);
      if (variant === 'UNKNOWN') result.diagnosisCode = 'UNKNOWN';
      if (variant === 'partial')
        result.visibleTestResults = result.visibleTestResults.slice(0, 1);
      if (variant === 'infrastructure-failed') {
        result.diagnosisCode = 'UNKNOWN';
        result.infrastructureStatus = 'FAILED';
        Object.assign(result, { hiddenChecksPassed: null });
      }
      if (variant === 'incoherent-count') result.visiblePassed = 2;
      if (variant === 'duplicate-test')
        result.visibleTestResults[1]!.id = 'visible-1';
      if (variant === 'zero-total') result.visibleTotal = 0;
      value.technicalResult = variant === 'null-result' ? null : result;
      const actual = evaluateStagnation(input);
      expect(actual.outcome).toBe('NOT_VERIFIABLE');
      expect(actual.selectedAttemptIds).toEqual([id(12), id(13), id(14)]);
    },
  );

  it.each([
    'version',
    'suite',
    'runner',
    'limits',
    'schema',
    'visible-set',
    'missing-profile',
  ])('selecciona antes de compatibilidad: último %s', (variant) => {
    const input = setup([1, 1, 1, 1]);
    const value = chosen(input, 3);
    const current = profile(input, 3);
    if (variant === 'version') value.exerciseVersionId = id(99);
    if (variant === 'suite') current.testsVersion = 'b'.repeat(64);
    if (variant === 'runner') current.runnerVersion = 'runner.v2';
    if (variant === 'limits') current.limits.runtimeMs = 3001;
    if (variant === 'schema') current.resultSchemaVersion = 'submission.v2';
    if (variant === 'visible-set')
      current.visibleTestIds[0] = 'different-visible';
    if (variant === 'missing-profile') value.profile = null;
    const actual = evaluateStagnation(input);
    expect(actual.reason).toBe('NOT_COMPARABLE');
    expect(actual.selectedAttemptIds).toEqual([id(12), id(13), id(14)]);
  });

  it('mismo perfil desconocido en los tres tampoco acredita comparabilidad', () => {
    const input = setup();
    input.submissions.forEach((value) => {
      value.profile!.resultSchemaVersion = 'submission.v2';
    });
    expect(evaluateStagnation(input).reason).toBe('NOT_COMPARABLE');
  });

  it('set esperado duplicado o distinto del resultado completo no verifica', () => {
    const input = setup();
    input.submissions.forEach((value) => {
      value.profile!.visibleTestIds[0] = 'visible-2';
    });
    expect(evaluateStagnation(input).outcome).toBe('NOT_VERIFIABLE');
    input.submissions.forEach((value) => {
      value.profile!.visibleTestIds[0] = 'visible-other';
    });
    expect(evaluateStagnation(input).reason).toBe('RESULT_NOT_VERIFIABLE');
  });

  it('orden de IDs visibles y resultados no cambia la comparabilidad', () => {
    const input = setup();
    profile(input).visibleTestIds.reverse();
    const current = technical(1);
    current.visibleTestResults.reverse();
    chosen(input).technicalResult = current;
    expect(evaluateStagnation(input).outcome).toBe('MATCH');
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
  ])('%s no ocupa posición en el carril', (variant) => {
    const input = setup();
    const other = attempt(4, 2);
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
    expect(evaluateStagnation(input).selectedAttemptIds).toEqual([
      id(11),
      id(12),
      id(13),
    ]);
  });

  it('corte exactamente T incluye, T+1µs excluye y T-1µs ordena exactamente', () => {
    const input = setup();
    chosen(input, 0).submittedAt = '2026-10-12T11:59:59.999999Z';
    chosen(input, 1).submittedAt = at;
    chosen(input).submittedAt = '2026-10-12T12:00:00.000001Z';
    expect(evaluateStagnation(input).reason).toBe('INSUFFICIENT_SUBMISSIONS');
    chosen(input).submittedAt = at;
    expect(evaluateStagnation(input).selectedAttemptIds).toEqual([
      id(11),
      id(12),
      id(13),
    ]);
  });

  it('desempata por secuencia bigint, no UUID/HTTP/orden del array', () => {
    const input = setup([2, 1, 1]);
    input.submissions.forEach((value, index) => {
      value.submittedAt = at;
      value.eventSequence = `${9_007_199_254_740_993n + BigInt(index)}`;
    });
    input.submissions.reverse();
    const actual = evaluateStagnation(input);
    expect(actual.outcome).toBe('MATCH');
    expect(actual.selectedAttemptIds).toEqual([id(11), id(12), id(13)]);
    expect(actual.evidence?.submissions[0]?.eventSequence).toBe(
      '9007199254740993',
    );
  });

  it.each([
    'different-payload',
    'same-sequence-other-id',
    'missing-sequence',
    'missing-time',
  ])('evidencia de confirmación contradictoria: %s', (variant) => {
    const input = setup();
    const value = structuredClone(chosen(input));
    if (variant === 'different-payload') value.technicalResult = technical(2);
    if (variant === 'same-sequence-other-id') value.id = id(99);
    if (variant === 'missing-sequence') value.eventSequence = null;
    if (variant === 'missing-time') value.submittedAt = null;
    input.submissions.push(value);
    expect(evaluateStagnation(input).reason).toBe('EVIDENCE_INCOHERENT');
  });

  it('replay idéntico y orden permutado son deterministas e inmutables', () => {
    const input = setup();
    input.submissions.push(structuredClone(chosen(input)));
    const before = structuredClone(input);
    const first = evaluateStagnation(input);
    expect(first.outcome).toBe('MATCH');
    expect(input).toEqual(before);
    input.submissions.reverse();
    expect(evaluateStagnation(input)).toEqual(first);
    expect(first.selectedAttemptIds).toHaveLength(3);
    expect(first).not.toHaveProperty('state');
    expect(first).not.toHaveProperty('signalId');
  });

  it.each(['scopeEnabled', 'studentActive', 'enrollmentActive'] as const)(
    '%s deshabilitado no evalúa',
    (flag) => {
      const input = setup();
      input.activity[flag] = false;
      expect(evaluateStagnation(input).outcome).toBe('NOT_EVALUABLE');
    },
  );
  it.each(['DRAFT', 'CLOSED'] as const)(
    'actividad %s no abre señal',
    (state) => {
      const input = setup();
      input.activity.state = state;
      expect(evaluateStagnation(input).outcome).toBe('NOT_EVALUABLE');
    },
  );
  it.each(['closesAt', 'closedAt'] as const)(
    '%s con cierre exclusivo',
    (field) => {
      const input = setup();
      input.activity[field] = at;
      input.evaluationTime = '2026-10-12T11:59:59.999999Z';
      expect(evaluateStagnation(input).outcome).toBe('MATCH');
      input.evaluationTime = at;
      expect(evaluateStagnation(input).outcome).toBe('NOT_EVALUABLE');
    },
  );
  it('inicio inclusivo y apertura futura', () => {
    const input = setup();
    input.activity.opensAt = at;
    expect(evaluateStagnation(input).outcome).toBe('MATCH');
    input.activity.opensAt = '2026-10-12T12:00:00.000001Z';
    expect(evaluateStagnation(input).reason).toBe('START_NOT_REACHED');
  });

  it.each(['partial-page', 'cutoff-not-covered'])(
    'snapshot %s no permite seleccionar',
    (variant) => {
      const input = setup();
      if (variant === 'partial-page') input.snapshot.selectionComplete = false;
      else input.snapshot.observedThrough = '2026-10-12T11:59:59.999999Z';
      expect(evaluateStagnation(input).reason).toBe('SNAPSHOT_INCOMPLETE');
    },
  );
  it('commit tardío cambia revisión y cálculo, no altera la base anterior', () => {
    const input = setup();
    const first = evaluateStagnation(input);
    input.snapshot.revision = 'synthetic-stagnation-2';
    input.snapshot.digest = 'b'.repeat(64);
    const late = attempt(4, 2);
    late.submittedAt = at;
    input.submissions.push(late);
    const second = evaluateStagnation(input);
    expect(first.outcome).toBe('MATCH');
    expect(second.outcome).toBe('NO_MATCH');
    expect(first.snapshot).not.toEqual(second.snapshot);
  });

  it('regla explícita aplicable [A,B), retirada histórica, DRAFT y ámbito ajeno', () => {
    const input = setup();
    rule(input).validFrom = at;
    input.evaluationTime = '2026-10-12T11:59:59.999999Z';
    expect(evaluateStagnation(input).reason).toBe('NO_APPLICABLE_RULE');
    input.evaluationTime = at;
    expect(evaluateStagnation(input).outcome).toBe('MATCH');
    rule(input).state = 'RETIRED';
    rule(input).validTo = '2026-10-12T12:00:00.000001Z';
    expect(evaluateStagnation(input).outcome).toBe('MATCH');
    input.evaluationTime = '2026-10-12T12:00:00.000001Z';
    input.snapshot.observedThrough = input.evaluationTime;
    expect(evaluateStagnation(input).reason).toBe('NO_APPLICABLE_RULE');
    Object.assign(rule(input), {
      state: 'DRAFT',
      validFrom: null,
      validTo: null,
      activatedBy: null,
    });
    expect(evaluateStagnation(input).reason).toBe('NO_APPLICABLE_RULE');
    input.rule = null;
    expect(evaluateStagnation(input).reason).toBe('NO_APPLICABLE_RULE');
    const other = setup();
    rule(other).organizationId = id(99);
    expect(evaluateStagnation(other).reason).toBe('NO_APPLICABLE_RULE');
  });

  it.each([2, 4])('N=%i respeta últimos N y pares adyacentes', (count) => {
    const input = setup([2, 2, 1, 1]);
    rule(input).parameters.stagnationAttempts = count;
    const actual = evaluateStagnation(input);
    expect(actual.outcome).toBe('MATCH');
    expect(actual.selectedAttemptIds).toHaveLength(count);
  });
  it('menos de N e int4 máximo no reservan una terna artificial', () => {
    const input = setup([1, 1]);
    expect(evaluateStagnation(input).reason).toBe('INSUFFICIENT_SUBMISSIONS');
    rule(input).parameters.stagnationAttempts = 2_147_483_647;
    expect(evaluateStagnation(input).reason).toBe('INSUFFICIENT_SUBMISSIONS');
  });

  it('N=2 y N=4 distinguen una mejora fuera/dentro de la selección', () => {
    const input = setup([1, 2, 1, 1]);
    rule(input).parameters.stagnationAttempts = 2;
    const two = evaluateStagnation(input);
    expect(two.outcome).toBe('MATCH');
    expect(two.selectedAttemptIds).toEqual([id(13), id(14)]);
    rule(input).parameters.stagnationAttempts = 4;
    const four = evaluateStagnation(input);
    expect(four.reason).toBe('VISIBLE_PROGRESS_INCREASED');
    expect(four.selectedAttemptIds).toEqual([id(11), id(12), id(13), id(14)]);
  });
  it('offsets preservan microsegundos y no consultan reloj', () => {
    const input = setup();
    chosen(input).submittedAt = '2026-10-12T09:00:00.000000-03:00';
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('real clock');
    });
    expect(
      evaluateStagnation(input).evidence?.submissions.at(-1)?.submittedAt,
    ).toBe(at);
    expect(clock).not.toHaveBeenCalled();
    clock.mockRestore();
  });
  it.each([
    '2026-10-12T12:00:00',
    '2026-10-12T12:00:00.0000001Z',
    '2026-02-30T12:00:00Z',
  ])('fecha inválida rechazada: %s', (value) => {
    const input = setup();
    chosen(input).submittedAt = value;
    expect(() => evaluateStagnation(input)).toThrow();
  });
  it('rechaza coerciones de secuencia, extras, count1 y otra regla', () => {
    const input = setup();
    chosen(input).eventSequence = '9223372036854775808';
    expect(() => evaluateStagnation(input)).toThrow();
    expect(() =>
      evaluateStagnation({ ...setup(), repeatedErrorWindowDays: 14 }),
    ).toThrow();
    const invalid = setup();
    rule(invalid).parameters.stagnationAttempts = 1;
    expect(() => evaluateStagnation(invalid)).toThrow();
    Object.assign(rule(invalid), {
      type: 'INACTIVITY',
      parameters: { inactivityDays: 7 },
    });
    expect(() => evaluateStagnation(invalid)).toThrow();
  });

  type Legacy = {
    id: string;
    input: {
      evaluationTime: string;
      attempts: {
        testsVersion: string;
        visiblePassed: number;
        complete: boolean;
        submittedAt: string;
        eventSequence: string;
        profile: NonNullable<StagnationInput['submissions'][number]['profile']>;
        technicalResult: unknown;
      }[];
    };
    expected: { createSignal: boolean; verifiable: boolean };
  };
  const legacy = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../../fixtures/progress/signals-proposed.json'),
      'utf8',
    ),
  ) as Legacy[];
  it.each(
    legacy.filter((fixture) =>
      ['SIG-09', 'SIG-10', 'SIG-11', 'SIG-12'].includes(fixture.id),
    ),
  )(
    '$id mantiene expected con resultados y metadata canónicos sintéticos',
    ({ input: fixture, expected }) => {
      const input = setup();
      input.evaluationTime = fixture.evaluationTime;
      input.snapshot.observedThrough = fixture.evaluationTime;
      input.activity.enrolledAt = '2026-09-01T00:00:00Z';
      input.activity.publishedAt = '2026-09-01T00:00:00Z';
      input.submissions.forEach((value, index) => {
        const source = fixture.attempts[index];
        if (!source) throw new Error('fixture');
        value.profile = source.profile;
        value.technicalResult = source.technicalResult;
        value.submittedAt = source.submittedAt;
        value.eventSequence = source.eventSequence;
      });
      const actual = evaluateStagnation(input);
      expect(actual.outcome === 'MATCH').toBe(expected.createSignal);
      expect(actual.outcome !== 'NOT_VERIFIABLE').toBe(expected.verifiable);
    },
  );
  it('SIG-07 normaliza SUCCESS central sin cambiar el expected de interrupción', () => {
    const fixture = legacy.find((value) => value.id === 'SIG-07');
    if (!fixture) throw new Error('fixture');
    const central = fixture.input.attempts[1];
    if (!central) throw new Error('fixture');
    expect(central.visiblePassed).toBe(3);
    expect(central.complete).toBe(true);
    expect(
      submitTechnicalResultSchema.parse(central.technicalResult)
        .allRequiredPassed,
    ).toBe(true);
    expect(fixture.expected).toEqual({ verifiable: true, createSignal: false });
  });
});
