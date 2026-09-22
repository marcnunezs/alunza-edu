let parseProvisioningArguments;
const userId = '71111111-1111-4111-8111-111111111111';
const grantId = '72222222-2222-4222-8222-222222222222';
const expiry = '2026-09-12T00:00:00.000Z';
const base = () => [
  'grant',
  '--user',
  userId,
  '--by',
  'Equipo técnico',
  '--reason',
  'Aprovisionamiento autorizado para fixture',
  '--expires-at',
  expiry,
];
function replacing(key, value) {
  const args = base();
  args[args.indexOf(key) + 1] = value;
  return args;
}

beforeAll(async () => {
  // Importing the pure argument parser never invokes runProvisioning or opens DB.
  ({ parseProvisioningArguments } =
    await import('../scripts/provisioning.mjs'));
});
beforeEach(() => {
  jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2026-09-11T00:00:00.000Z'));
});
afterEach(() => jest.restoreAllMocks());

test('permiso técnico exige destinatario, actor, motivo y vencimiento explícitos', () => {
  expect(
    parseProvisioningArguments([...base(), '--id', grantId, '--test']),
  ).toEqual({
    command: 'grant',
    test: true,
    user: userId,
    by: 'Equipo técnico',
    reason: 'Aprovisionamiento autorizado para fixture',
    'expires-at': expiry,
    id: grantId,
  });
});

test.each([
  [
    'UUID de destinatario inválido',
    () => replacing('--user', 'someone@example.test'),
  ],
  ['UUID de permiso inválido', () => [...base(), '--id', 'not-a-uuid']],
  [
    'vencimiento pasado',
    () => replacing('--expires-at', '2026-09-10T23:59:59.999Z'),
  ],
  [
    'vencimiento igual al presente',
    () => replacing('--expires-at', '2026-09-11T00:00:00.000Z'),
  ],
  [
    'fecha sin UTC explícito',
    () => replacing('--expires-at', '2026-09-12T00:00:00'),
  ],
  ['fecha mal formada', () => replacing('--expires-at', 'not-a-dateZ')],
  [
    'fecha imposible',
    () => replacing('--expires-at', '2027-02-30T00:00:00.000Z'),
  ],
  ['fecha sin hora', () => replacing('--expires-at', '2026-09-12Z')],
  ['motivo vacío', () => replacing('--reason', '   ')],
  ['motivo demasiado largo', () => replacing('--reason', 'a'.repeat(501))],
  ['actor vacío', () => replacing('--by', '   ')],
  ['actor demasiado largo', () => replacing('--by', 'a'.repeat(121))],
  ['parámetro desconocido', () => [...base(), '--remote', 'production']],
  ['parámetro repetido', () => [...base(), '--user', userId]],
  ['selección de test repetida', () => [...base(), '--test', '--test']],
  ['opción sin valor', () => [...base(), '--id']],
  ['motivo omitido', () => base().filter((_, i) => i !== 5 && i !== 6)],
  ['operación no admitida', () => ['grant-all', '--user', userId]],
])('rechaza %s antes de cualquier acceso a BD', (_label, args) => {
  expect(() => parseProvisioningArguments(args())).toThrow();
});

test('revocación técnica conserva destinatario por ID y exige motivo y actor', () => {
  expect(
    parseProvisioningArguments([
      'revoke',
      '--grant',
      grantId,
      '--by',
      'Operador',
      '--reason',
      'Retirado',
    ]),
  ).toEqual({
    command: 'revoke',
    test: false,
    grant: grantId,
    by: 'Operador',
    reason: 'Retirado',
  });
  expect(() =>
    parseProvisioningArguments(['revoke', '--grant', grantId]),
  ).toThrow();
  expect(() =>
    parseProvisioningArguments([
      'revoke',
      '--grant',
      'not-a-uuid',
      '--by',
      'Operador',
      '--reason',
      'Retirado',
    ]),
  ).toThrow();
});

test('consulta y ayuda no habilitan opciones de escritura', () => {
  expect(parseProvisioningArguments(['list', '--user', userId])).toEqual({
    command: 'list',
    test: false,
    user: userId,
  });
  expect(() =>
    parseProvisioningArguments([
      'list',
      '--user',
      userId,
      '--reason',
      'No aplica',
    ]),
  ).toThrow();
  expect(parseProvisioningArguments(['--help'])).toEqual({ command: 'help' });
  expect(parseProvisioningArguments([])).toEqual({ command: 'help' });
});
