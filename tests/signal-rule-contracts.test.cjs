/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const c = require('@alunza/contracts');
const input = (type = 'INACTIVITY', parameters = { inactivityDays: 7 }) => ({
  type,
  schemaVersion: 1,
  algorithmVersion: 'DEC005_V1',
  parameters,
});
test.each([
  input(),
  input('REPEATED_ERROR', {
    repeatedErrorAttempts: 3,
    repeatedErrorWindowDays: 14,
  }),
  input('STAGNATION', { stagnationAttempts: 3 }),
])(
  'regla conserva exclusivamente el schema y la semántica aprobados: $type',
  (value) => {
    expect(c.signalRuleCreateSchema.parse(value)).toEqual(value);
  },
);
test.each([
  undefined,
  null,
  0,
  -1,
  1.5,
  '7',
  true,
  Infinity,
  NaN,
  2_147_483_648,
  Number.MAX_SAFE_INTEGER,
])('días rechazan valores ausentes o no representables: %s', (days) => {
  expect(
    c.signalRuleCreateSchema.safeParse(
      input('INACTIVITY', { inactivityDays: days }),
    ).success,
  ).toBe(false);
  expect(
    c.signalRuleCreateSchema.safeParse(
      input('REPEATED_ERROR', {
        repeatedErrorAttempts: 3,
        repeatedErrorWindowDays: days,
      }),
    ).success,
  ).toBe(false);
});
test.each([undefined, null, 0, 1, -1, 2.1, '3', Infinity, 2_147_483_648])(
  'conteos necesitan al menos dos enteros representables: %s',
  (count) => {
    expect(
      c.signalRuleCreateSchema.safeParse(
        input('STAGNATION', { stagnationAttempts: count }),
      ).success,
    ).toBe(false);
    expect(
      c.signalRuleCreateSchema.safeParse(
        input('REPEATED_ERROR', {
          repeatedErrorAttempts: count,
          repeatedErrorWindowDays: 14,
        }),
      ).success,
    ).toBe(false);
  },
);
test('límites técnicos int4 aceptan enteros positivos y no agregan límites pedagógicos', () => {
  for (const days of [1, 104_250, 2_147_483_647])
    expect(
      c.signalRuleCreateSchema.parse(
        input('INACTIVITY', { inactivityDays: days }),
      ).parameters.inactivityDays,
    ).toBe(days);
  for (const count of [2, 4, 2_147_483_647])
    expect(
      c.signalRuleCreateSchema.parse(
        input('STAGNATION', { stagnationAttempts: count }),
      ).parameters.stagnationAttempts,
    ).toBe(count);
});
test('entrada estricta rechaza otros tipos, algoritmos, autoría, fechas y fórmulas', () => {
  for (const patch of [
    { type: 'RESOLVED' },
    { schemaVersion: 2 },
    { algorithmVersion: 'CUSTOM' },
    { organizationId: randomUUID() },
    { createdBy: randomUUID() },
    { version: 2 },
    { effectiveAt: '2026-10-01T00:00:00Z' },
    { script: 'return true;' },
    { parameters: { inactivityDays: 7, score: 1 } },
    { parameters: { stagnationAttempts: 3 } },
  ])
    expect(
      c.signalRuleCreateSchema.safeParse({ ...input(), ...patch }).success,
    ).toBe(false);
});
test('activar exige expectedCurrentVersionId incluso en la primera activación y rechaza programación', () => {
  expect(
    c.signalRuleActivateSchema.parse({ expectedCurrentVersionId: null }),
  ).toEqual({ expectedCurrentVersionId: null });
  expect(
    c.signalRuleActivateSchema.parse({
      expectedCurrentVersionId: randomUUID(),
    }),
  ).toHaveProperty('expectedCurrentVersionId');
  for (const value of [
    {},
    { expectedCurrentVersionId: 1 },
    { expectedCurrentVersionId: null, effectiveAt: '2026-10-06T00:00:00Z' },
  ])
    expect(c.signalRuleActivateSchema.safeParse(value).success).toBe(false);
});
const version = (patch = {}) => ({
  ...input(),
  id: randomUUID(),
  organizationId: randomUUID(),
  version: 1,
  createdBy: randomUUID(),
  createdAt: '2026-10-05T12:00:00.123456Z',
  activatedBy: null,
  validFrom: null,
  validTo: null,
  state: 'DRAFT',
  ...patch,
});
test('versiones conservan precisión de microsegundos y vigencias [desde,hasta) coherentes', () => {
  const author = randomUUID();
  expect(c.signalRuleVersionSchema.parse(version())).toHaveProperty(
    'state',
    'DRAFT',
  );
  expect(
    c.signalRuleVersionSchema.parse(
      version({
        state: 'ACTIVE',
        activatedBy: author,
        validFrom: '2026-10-05T12:00:00.123456Z',
      }),
    ).validFrom,
  ).toBe('2026-10-05T12:00:00.123456Z');
  expect(
    c.signalRuleVersionSchema.parse(
      version({
        state: 'RETIRED',
        activatedBy: author,
        validFrom: '2026-10-05T12:00:00.123456Z',
        validTo: '2026-10-05T12:00:00.123457Z',
      }),
    ).state,
  ).toBe('RETIRED');
  for (const patch of [
    { validFrom: '2026-10-05T12:00:00Z' },
    { state: 'ACTIVE' },
    { state: 'REVIEWED' },
    {
      state: 'ACTIVE',
      activatedBy: author,
      validFrom: '2026-10-05T12:00:00.123455Z',
    },
    {
      state: 'RETIRED',
      activatedBy: author,
      validFrom: '2026-10-05T12:00:00.123456Z',
      validTo: '2026-10-05T12:00:00.123456Z',
    },
    { createdAt: '2026-10-05T12:00:00.1234567Z' },
    { createdAt: '2026-10-05T12:00:00' },
    { studentId: randomUUID() },
  ])
    expect(c.signalRuleVersionSchema.safeParse(version(patch)).success).toBe(
      false,
    );
});
test('consulta de gobierno valida tipo, cursor y paginación con respuesta de configuración vacía', () => {
  expect(c.signalRuleListQuerySchema.parse({})).toEqual({ limit: 50 });
  expect(
    c.signalRuleListQuerySchema.parse({ type: 'INACTIVITY', limit: '2' }),
  ).toEqual({ type: 'INACTIVITY', limit: 2 });
  for (const value of [
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { type: 'REVIEWED' },
    { cursor: 'foreign' },
    { studentId: randomUUID() },
  ])
    expect(c.signalRuleListQuerySchema.safeParse(value).success).toBe(false);
  expect(
    c.signalRuleVersionListResponseSchema.parse({
      data: [],
      page: { nextCursor: null, hasMore: false },
      requestId: randomUUID(),
    }).data,
  ).toEqual([]);
  expect(
    c.signalRuleVersionListSchema.safeParse({
      data: [],
      page: { nextCursor: randomUUID(), hasMore: true },
    }).success,
  ).toBe(false);
});

const effective = () => ({
  organizationId: randomUUID(),
  observedAt: '2026-10-25T23:59:59.123456Z',
  rules: ['INACTIVITY', 'REPEATED_ERROR', 'STAGNATION'].map((type) => ({
    type,
    ruleVersion: null,
  })),
});

test('efectivas distinguen tres tipos sin configurar y una configuración parcial o completa', () => {
  const data = effective();
  expect(c.signalRuleEffectiveSchema.parse(data)).toEqual(data);
  for (const entry of data.rules) {
    entry.ruleVersion = version({
      ...input(
        entry.type,
        entry.type === 'INACTIVITY'
          ? { inactivityDays: 7 }
          : entry.type === 'REPEATED_ERROR'
            ? { repeatedErrorAttempts: 3, repeatedErrorWindowDays: 14 }
            : { stagnationAttempts: 3 },
      ),
      organizationId: data.organizationId,
      state: 'ACTIVE',
      activatedBy: randomUUID(),
      validFrom: '2026-10-05T12:00:00.123457Z',
    });
    expect(
      c.signalRuleEffectiveResponseSchema.parse({
        data,
        requestId: randomUUID(),
      }).data,
    ).toEqual(data);
  }
});

test.each([
  (data) => ({ ...data, rules: [] }),
  (data) => ({ ...data, rules: data.rules.slice(0, 2) }),
  (data) => ({ ...data, rules: [...data.rules, data.rules[0]] }),
  (data) => ({ ...data, rules: [data.rules[0], data.rules[0], data.rules[2]] }),
  (data) => ({ ...data, observedAt: '2026-10-25T23:59:59.1234567Z' }),
  (data) => ({ ...data, observedAt: '2026-10-25T23:59:59' }),
  (data) => ({ ...data, evidence: [] }),
  (data) => ({
    ...data,
    rules: [{ ...data.rules[0], score: 1 }, ...data.rules.slice(1)],
  }),
])(
  'efectivas rechazan cardinalidad, fechas y campos no públicos incoherentes %#',
  (patch) => {
    expect(
      c.signalRuleEffectiveSchema.safeParse(patch(effective())).success,
    ).toBe(false);
  },
);

test.each([
  { state: 'DRAFT', activatedBy: null, validFrom: null },
  { state: 'RETIRED', validTo: '2026-10-06T12:00:00Z' },
  { organizationId: randomUUID() },
  { type: 'STAGNATION', parameters: { stagnationAttempts: 3 } },
])('efectivas rechazan versión de otro ámbito, tipo o estado %#', (patch) => {
  const data = effective();
  data.rules[0].ruleVersion = version({
    organizationId: data.organizationId,
    state: 'ACTIVE',
    activatedBy: randomUUID(),
    validFrom: '2026-10-05T12:00:00.123457Z',
    ...patch,
  });
  expect(c.signalRuleEffectiveSchema.safeParse(data).success).toBe(false);
});
