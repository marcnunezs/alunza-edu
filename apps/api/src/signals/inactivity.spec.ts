import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateInactivity, type InactivityInput } from './inactivity';

const id = (n: number) =>
  `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const at = '2026-10-12T12:00:00.000000Z';
const before = '2026-10-05T12:00:00.000000Z';
const scope = {
  organizationId: id(1),
  classId: id(2),
  studentId: id(3),
  activityId: id(4),
};

function setup(): InactivityInput {
  return {
    evaluationTime: at,
    rule: {
      id: id(5),
      organizationId: scope.organizationId,
      type: 'INACTIVITY',
      version: 1,
      schemaVersion: 1,
      algorithmVersion: 'DEC005_V1',
      parameters: { inactivityDays: 7 },
      state: 'ACTIVE',
      createdBy: id(6),
      createdAt: '2026-09-01T00:00:00Z',
      activatedBy: id(6),
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
      revision: 'synthetic-snapshot-1',
      digest: 'a'.repeat(64),
      observedThrough: '2026-10-13T12:00:00Z',
    },
    coverage: {
      status: 'CONTINUOUS',
      epoch: 'synthetic-all-capturers-1',
      restartReason: null,
      sources: ['ACTIVITY_OPEN', 'RUN', 'ATTEMPT', 'HELP'].map((source) => ({
        source: source as 'ACTIVITY_OPEN' | 'RUN' | 'ATTEMPT' | 'HELP',
        since: '2026-09-20T00:00:00Z',
        through: '2026-10-13T12:00:00Z',
        referenceId: `synthetic-coverage-${source}`,
      })),
    },
    events: [
      {
        ...scope,
        id: id(7),
        source: 'ACTIVITY_OPEN',
        type: 'ACTIVITY_OPENED',
        schemaVersion: 1,
        occurredAt: before,
        eligible: true,
        infrastructureStatus: null,
      },
    ],
  };
}

function continuous(input: InactivityInput) {
  if (input.coverage.status !== 'CONTINUOUS') throw new Error('fixture');
  return input.coverage;
}
function rule(input: InactivityInput) {
  if (input.rule?.type !== 'INACTIVITY') throw new Error('fixture');
  return input.rule;
}
function firstEvent(input: InactivityInput) {
  const value = input.events[0];
  if (!value) throw new Error('fixture');
  return value;
}

describe('DEC-005: inactividad pura con corte explícito', () => {
  it.each([
    ['2026-10-12T11:59:59.999999Z', 'NO_MATCH', '604799999999'],
    [at, 'MATCH', '604800000000'],
    ['2026-10-12T12:00:00.000001Z', 'MATCH', '604800000001'],
  ])('frontera de siete días en %s', (cutoff, outcome, elapsed) => {
    const input = setup();
    input.evaluationTime = cutoff;
    const actual = evaluateInactivity(input);
    expect(actual.outcome).toBe(outcome);
    expect(actual.evidence?.elapsedMicroseconds).toBe(elapsed);
    expect(actual.evidence?.thresholdMicroseconds).toBe('604800000000');
  });

  it.each(['enrolledAt', 'publishedAt', 'opensAt'] as const)(
    'usa la base más reciente: %s',
    (field) => {
      const input = setup();
      input.events = [];
      input.activity[field] = '2026-10-10T12:00:00Z';
      const actual = evaluateInactivity(input);
      expect(actual.outcome).toBe('NO_MATCH');
      expect(actual.evidence?.baselineAt).toBe('2026-10-10T12:00:00.000000Z');
      expect(actual.evidence?.elapsedMicroseconds).toBe('172800000000');
    },
  );

  it('nunca actuó: usa base y cobertura, sin evento ficticio', () => {
    const input = setup();
    input.events = [];
    input.activity.enrolledAt = before;
    const actual = evaluateInactivity(input);
    expect(actual.outcome).toBe('MATCH');
    expect(actual.evidence?.lastAt).toBe(before);
    expect(actual.evidence?.referenceEvents).toEqual([]);
  });

  it.each(['scopeEnabled', 'studentActive', 'enrollmentActive'] as const)(
    '%s false impide evaluar trabajo actual',
    (flag) => {
      const input = setup();
      input.activity[flag] = false;
      expect(evaluateInactivity(input).outcome).toBe('NOT_EVALUABLE');
    },
  );

  it.each(['DRAFT', 'CLOSED'] as const)(
    'actividad %s no abre señales',
    (state) => {
      const input = setup();
      input.activity.state = state;
      expect(evaluateInactivity(input).outcome).toBe('NOT_EVALUABLE');
    },
  );

  it('apertura inclusiva y comienzo futuro', () => {
    const input = setup();
    input.activity.opensAt = at;
    expect(evaluateInactivity(input).outcome).toBe('NO_MATCH');
    input.activity.opensAt = '2026-10-12T12:00:00.000001Z';
    expect(evaluateInactivity(input).reason).toBe('START_NOT_REACHED');
  });

  it.each(['closesAt', 'closedAt'] as const)(
    'cierre exclusivo programado o efectivo: %s',
    (field) => {
      const input = setup();
      input.activity[field] = at;
      input.evaluationTime = '2026-10-12T11:59:59.999999Z';
      expect(evaluateInactivity(input).outcome).toBe('NO_MATCH');
      input.evaluationTime = at;
      expect(evaluateInactivity(input).outcome).toBe('NOT_EVALUABLE');
      input.evaluationTime = '2026-10-12T12:00:00.000001Z';
      expect(evaluateInactivity(input).outcome).toBe('NOT_EVALUABLE');
    },
  );

  it('no inventa cobertura anterior al capturador más reciente', () => {
    const input = setup();
    const help = continuous(input).sources.find(
      (value) => value.source === 'HELP',
    );
    if (!help) throw new Error('fixture');
    help.since = '2026-10-10T12:00:00Z';
    const actual = evaluateInactivity(input);
    expect(actual.outcome).toBe('NO_MATCH');
    expect(actual.evidence?.observableSince).toBe(
      '2026-10-10T12:00:00.000000Z',
    );
  });

  it('reinicia el tramo después de un hueco y conserva su motivo', () => {
    const input = setup();
    const coverage = continuous(input);
    coverage.epoch = 'synthetic-after-gap';
    coverage.restartReason =
      'Captura restablecida después de hueco documentado.';
    coverage.sources.forEach((value) => {
      value.since = '2026-10-05T12:00:00.000001Z';
    });
    expect(evaluateInactivity(input).outcome).toBe('NO_MATCH');
    input.evaluationTime = '2026-10-12T12:00:00.000001Z';
    const actual = evaluateInactivity(input);
    expect(actual.outcome).toBe('MATCH');
    expect(actual.evidence?.coverageEpoch).toBe(coverage.epoch);
    expect(actual.evidence?.restartReason).toBe(coverage.restartReason);
  });

  it('cobertura desconocida no significa ausencia', () => {
    const input = setup();
    input.coverage = {
      status: 'UNKNOWN',
      reason: 'No hay cobertura verificable.',
    };
    expect(evaluateInactivity(input)).toMatchObject({
      outcome: 'NOT_VERIFIABLE',
      reason: 'COVERAGE_UNKNOWN',
      evidence: null,
    });
  });

  it.each(['missing', 'duplicate', 'ended', 'inverted'])(
    'rechaza cobertura incompleta/incoherente: %s',
    (variant) => {
      const input = setup();
      const sources = continuous(input).sources;
      const first = sources[0];
      if (!first) throw new Error('fixture');
      if (variant === 'missing') sources.pop();
      if (variant === 'duplicate') sources[3] = { ...first };
      if (variant === 'ended') first.through = '2026-10-12T11:59:59.999999Z';
      if (variant === 'inverted') first.since = '2026-10-14T00:00:00Z';
      expect(evaluateInactivity(input).reason).toBe('COVERAGE_INCOMPLETE');
    },
  );

  it('captura operativa no sustituye lectura exhaustiva del snapshot', () => {
    const input = setup();
    input.snapshot.observedThrough = '2026-10-12T11:59:59.999999Z';
    expect(evaluateInactivity(input).reason).toBe('SNAPSHOT_INCOMPLETE');
  });

  it('cobertura y snapshot exactamente hasta T son suficientes', () => {
    const input = setup();
    input.snapshot.observedThrough = at;
    continuous(input).sources.forEach((value) => {
      value.through = at;
    });
    expect(evaluateInactivity(input).outcome).toBe('MATCH');
  });

  it.each([
    ['2026-10-12T11:59:59.999999Z', 'NO_MATCH', '1'],
    [at, 'NO_MATCH', '0'],
    ['2026-10-12T12:00:00.000001Z', 'MATCH', '604800000000'],
  ])(
    'evento antes/en/después del corte: %s',
    (occurredAt, outcome, elapsed) => {
      const input = setup();
      input.events.push({ ...firstEvent(input), id: id(8), occurredAt });
      const actual = evaluateInactivity(input);
      expect(actual.outcome).toBe(outcome);
      expect(actual.evidence?.elapsedMicroseconds).toBe(elapsed);
    },
  );

  it.each([
    ['RUN', 'EXECUTION_COMPLETED', 'OK'],
    ['ATTEMPT', 'EXECUTION_COMPLETED', 'OK'],
    ['ATTEMPT', 'ATTEMPT_SUBMITTED', 'FAILED'],
    ['HELP', 'HINT_DELIVERED', null],
    ['HELP', 'FEEDBACK_VIEWED', null],
  ] as const)(
    '%s/%s elegible reinicia el silencio',
    (source, type, infrastructureStatus) => {
      const input = setup();
      input.events.push({
        ...firstEvent(input),
        id: id(8),
        source,
        type,
        infrastructureStatus,
        occurredAt: '2026-10-11T12:00:00Z',
      });
      expect(evaluateInactivity(input).outcome).toBe('NO_MATCH');
    },
  );

  it.each([
    ['RUN', 'EXECUTION_COMPLETED', 'FAILED'],
    ['HELP', 'HELP_REQUESTED', null],
    ['HELP', 'HINT_DELIVERED', null],
    ['ACTIVITY_OPEN', 'ACTIVITY_OPENED', null],
  ] as const)(
    '%s/%s no elegible no reinicia el silencio',
    (source, type, infrastructureStatus) => {
      const input = setup();
      input.events.push({
        ...firstEvent(input),
        id: id(8),
        source,
        type,
        infrastructureStatus,
        eligible: false,
        occurredAt: '2026-10-11T12:00:00Z',
      });
      expect(evaluateInactivity(input).outcome).toBe('MATCH');
    },
  );

  it('CLASS_JOINED es referencia de clase, no actividad nueva', () => {
    const input = setup();
    input.events.push({
      ...firstEvent(input),
      id: id(8),
      source: 'CLASS_MEMBERSHIP',
      type: 'CLASS_JOINED',
      activityId: null,
      occurredAt: at,
    });
    expect(evaluateInactivity(input).outcome).toBe('MATCH');
  });

  it.each(['organizationId', 'classId', 'studentId', 'activityId'] as const)(
    'no incorpora evento de otro ámbito: %s',
    (field) => {
      const input = setup();
      input.events.push({
        ...firstEvent(input),
        id: id(8),
        [field]: id(99),
        occurredAt: at,
      });
      const actual = evaluateInactivity(input);
      expect(actual.outcome).toBe('MATCH');
      expect(actual.evidence?.referenceEvents).toEqual([
        { source: 'ACTIVITY_OPEN', id: id(7) },
      ]);
    },
  );

  it('deduplica replay idéntico; referencias empatadas son estables', () => {
    const input = setup();
    input.events.push({ ...firstEvent(input) });
    input.events.push({
      ...firstEvent(input),
      id: id(8),
      source: 'HELP',
      type: 'FEEDBACK_VIEWED',
    });
    const first = evaluateInactivity(input);
    input.events.reverse();
    continuous(input).sources.reverse();
    expect(evaluateInactivity(input)).toEqual(first);
    expect(first.evidence?.referenceEvents).toEqual([
      { source: 'ACTIVITY_OPEN', id: id(7) },
      { source: 'HELP', id: id(8) },
    ]);
  });

  it('el mismo UUID en dos fuentes conserva ambas referencias', () => {
    const input = setup();
    input.events.push({
      ...firstEvent(input),
      source: 'HELP',
      type: 'FEEDBACK_VIEWED',
    });
    expect(evaluateInactivity(input).evidence?.referenceEvents).toEqual([
      { source: 'ACTIVITY_OPEN', id: id(7) },
      { source: 'HELP', id: id(7) },
    ]);
  });

  it.each(['conflicting-duplicate', 'wrong-source', 'failed-eligible-run'])(
    'no afirma silencio ante evidencia incoherente: %s',
    (variant) => {
      const input = setup();
      const value = { ...firstEvent(input), occurredAt: at };
      if (variant === 'wrong-source') value.source = 'HELP';
      if (variant === 'failed-eligible-run') {
        value.id = id(8);
        value.source = 'RUN';
        value.type = 'EXECUTION_COMPLETED';
        value.infrastructureStatus = 'FAILED';
      }
      input.events.push(value);
      expect(evaluateInactivity(input).reason).toBe('EVIDENCE_INCOHERENT');
    },
  );

  it('regla ausente o de otra organización no aplica', () => {
    const input = setup();
    rule(input).organizationId = id(99);
    expect(evaluateInactivity(input).reason).toBe('NO_APPLICABLE_RULE');
    input.rule = null;
    expect(evaluateInactivity(input).reason).toBe('NO_APPLICABLE_RULE');
  });

  it('respeta [A,B) y reproduce versión retirada dentro de su vigencia', () => {
    const input = setup();
    rule(input).validFrom = at;
    input.evaluationTime = '2026-10-12T11:59:59.999999Z';
    expect(evaluateInactivity(input).reason).toBe('NO_APPLICABLE_RULE');
    input.evaluationTime = at;
    expect(evaluateInactivity(input).outcome).toBe('MATCH');
    rule(input).state = 'RETIRED';
    rule(input).validTo = '2026-10-12T12:00:00.000001Z';
    expect(evaluateInactivity(input).outcome).toBe('MATCH');
    input.evaluationTime = '2026-10-12T12:00:00.000001Z';
    expect(evaluateInactivity(input).reason).toBe('NO_APPLICABLE_RULE');
  });

  it('DRAFT no activa una regla', () => {
    const input = setup();
    Object.assign(rule(input), {
      state: 'DRAFT',
      activatedBy: null,
      validFrom: null,
    });
    expect(evaluateInactivity(input).reason).toBe('NO_APPLICABLE_RULE');
  });

  it('respeta días configurados y límite int4 sin overflow', () => {
    const input = setup();
    rule(input).parameters.inactivityDays = 1;
    expect(evaluateInactivity(input).evidence?.thresholdMicroseconds).toBe(
      '86400000000',
    );
    rule(input).parameters.inactivityDays = 2_147_483_647;
    const actual = evaluateInactivity(input);
    expect(actual.outcome).toBe('NO_MATCH');
    expect(actual.evidence?.thresholdMicroseconds).toBe(
      '185542587100800000000',
    );
  });

  it('offset equivalente conserva frontera submilisegundo UTC', () => {
    const input = setup();
    input.evaluationTime = '2026-10-12T09:00:00.000001-03:00';
    firstEvent(input).occurredAt = '2026-10-05T14:00:00.000001+02:00';
    const actual = evaluateInactivity(input);
    expect(actual.outcome).toBe('MATCH');
    expect(actual.evaluationTime).toBe('2026-10-12T12:00:00.000001Z');
    expect(actual.evidence?.elapsedMicroseconds).toBe('604800000000');
  });

  it.each([
    '2026-10-12T12:00:00',
    '2026-10-12T12:00:00.0000001Z',
    '2026-02-30T12:00:00Z',
  ])('rechaza fecha inválida sin redondeo: %s', (invalid) => {
    const input = setup();
    input.evaluationTime = invalid;
    expect(() => evaluateInactivity(input)).toThrow();
  });

  it('rechaza parámetros inválidos, extras y otro tipo de señal', () => {
    const input = setup();
    rule(input).parameters.inactivityDays = 0;
    expect(() => evaluateInactivity(input)).toThrow();
    expect(() => evaluateInactivity({ ...setup(), clientTime: at })).toThrow();
    const other = setup();
    Object.assign(rule(other), {
      type: 'STAGNATION',
      parameters: { stagnationAttempts: 3 },
    });
    expect(() => evaluateInactivity(other)).toThrow();
  });

  it('no consulta reloj ni muta entradas; identidad reproduce snapshot/regla/T', () => {
    const input = setup();
    const beforeInput = structuredClone(input);
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('real clock');
    });
    const first = evaluateInactivity(input);
    expect(evaluateInactivity(input)).toEqual(first);
    expect(input).toEqual(beforeInput);
    expect(clock).not.toHaveBeenCalled();
    expect(first).not.toHaveProperty('state');
    expect(first).not.toHaveProperty('signalId');
    expect(first.cause).toContain('días de 24 horas');
    clock.mockRestore();
  });

  it('nuevo snapshot con commit tardío puede cambiar cálculo para el mismo T', () => {
    const input = setup();
    const first = evaluateInactivity(input);
    input.snapshot.revision = 'synthetic-snapshot-2';
    input.snapshot.digest = 'b'.repeat(64);
    input.events.push({ ...firstEvent(input), id: id(8), occurredAt: at });
    const second = evaluateInactivity(input);
    expect(first.outcome).toBe('MATCH');
    expect(second.outcome).toBe('NO_MATCH');
    expect(first.snapshot).not.toEqual(second.snapshot);
    expect(first.evidence?.lastAt).toBe(before);
  });

  type LegacyFixture = {
    id: string;
    input: {
      evaluationTime: string;
      activity: {
        state: 'PUBLISHED' | 'CLOSED';
        enrolledAt: string;
        publishedAt: string;
        opensAt: string | null;
        closesAt: string | null;
        active: boolean;
      };
      coverage: InactivityInput['coverage'];
      lastEvent: { id: string; at: string } | null;
    };
    expected: { createSignal: boolean; baselineAt?: string };
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
  ).slice(0, 4);
  it.each(legacy)(
    '$id conserva esperado sobre fixture sintético con cobertura',
    ({ input: fixture, expected }) => {
      const input = setup();
      input.evaluationTime = fixture.evaluationTime;
      // Keep valid test scope IDs; the legacy fixture uses shorthand synthetic IDs.
      Object.assign(input.activity, {
        state: fixture.activity.state,
        enrolledAt: fixture.activity.enrolledAt,
        publishedAt: fixture.activity.publishedAt,
        opensAt: fixture.activity.opensAt,
        closesAt: fixture.activity.closesAt,
        studentActive: fixture.activity.active,
      });
      input.coverage = fixture.coverage;
      input.events = fixture.lastEvent
        ? [{ ...firstEvent(setup()), occurredAt: fixture.lastEvent.at }]
        : [];
      const actual = evaluateInactivity(input);
      expect(actual.outcome === 'MATCH').toBe(expected.createSignal);
      if (expected.baselineAt)
        expect(actual.evidence?.baselineAt).toBe(
          `${expected.baselineAt.replace(/Z$/, '')}.000000Z`,
        );
    },
  );
});
