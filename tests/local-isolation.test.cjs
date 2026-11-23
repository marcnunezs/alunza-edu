const { readFileSync } = require('node:fs');
const { createECDH } = require('node:crypto');
const { resolve, join } = require('node:path');
const { assertLaboratoryTestState } = require('./laboratory-test-state.cjs');
const cypress = require('../cypress.config.cjs');

const root = resolve(__dirname, '..');
const read = (file) => readFileSync(join(root, file), 'utf8');
let context, assertLocalDatabase, testContext, buildTestConfig;
let assertRuntimeTarget, assertLocalTarget, developmentTarget, testTarget;
let normalizeSigningKeys;

beforeAll(async () => {
  // These imports expose configuration only: no lifecycle or database method runs.
  ({ context, assertLocalDatabase } = await import('../scripts/local.mjs'));
  ({ testContext, buildTestConfig } =
    await import('../scripts/test-environment.mjs'));
  ({ assertRuntimeTarget, assertLocalTarget, developmentTarget, testTarget } =
    await import('../scripts/local-target.mjs'));
  ({ normalizeSigningKeys } =
    await import('../scripts/local-signing-keys.mjs'));
});

function syntheticSigningKey() {
  // Public deterministic test material, never a runtime or Auth signing key.
  const scalar = Buffer.alloc(31, 1);
  const pair = createECDH('prime256v1');
  pair.setPrivateKey(scalar);
  const publicPoint = pair.getPublicKey();
  return {
    alg: 'ES256',
    kty: 'EC',
    crv: 'P-256',
    kid: 'synthetic-laboratory-regression-only',
    use: 'sig',
    d: scalar.toString('base64url'),
    x: publicPoint.subarray(1, 33).toString('base64url'),
    y: publicPoint.subarray(33).toString('base64url'),
  };
}

test('firma ES256 de 31 bytes se normaliza a 32 conservando identidad, público y valor privado', () => {
  const original = Object.freeze(syntheticSigningKey());
  const normalized = normalizeSigningKeys([original]);
  const expectedScalar = Buffer.concat([Buffer.from([0]), Buffer.alloc(31, 1)]);
  expect(Buffer.from(original.d, 'base64url')).toHaveLength(31);
  expect(normalized).toEqual([
    { ...original, d: expectedScalar.toString('base64url') },
  ]);
  expect(Buffer.from(normalized[0].d, 'base64url')).toEqual(expectedScalar);
  expect(normalized[0].kid).toBe(original.kid);
  expect(normalized[0].x).toBe(original.x);
  expect(normalized[0].y).toBe(original.y);
  expect(normalizeSigningKeys(normalized)).toEqual(normalized);
});

test('firma ES256 canónica de 32 bytes se conserva sin cambios', () => {
  const canonical = {
    ...syntheticSigningKey(),
    d: Buffer.concat([Buffer.from([0]), Buffer.alloc(31, 1)]).toString(
      'base64url',
    ),
  };
  expect(normalizeSigningKeys([canonical])).toEqual([canonical]);
});

test.each([
  ['escalar de 33 bytes', { d: Buffer.alloc(33, 1).toString('base64url') }],
  ['base64url mal formado', { d: 'not+base64=' }],
  ['escalar cero', { d: Buffer.alloc(32).toString('base64url') }],
  ['coordenada X ajena', { x: Buffer.alloc(32).toString('base64url') }],
  ['coordenada Y ajena', { y: Buffer.alloc(32).toString('base64url') }],
  ['curva diferente', { crv: 'P-384' }],
])(
  'firma ES256 rechaza %s sin normalizar una clave inválida',
  (_description, override) => {
    expect(() =>
      normalizeSigningKeys([{ ...syntheticSigningKey(), ...override }]),
    ).toThrow(
      'El archivo local de firma necesita una clave ES256 P-256 válida.',
    );
  },
);

function tomlValue(source, section, key) {
  const lines = source.split(/\r?\n/);
  const start = section ? lines.indexOf(`[${section}]`) + 1 : 0;
  if (section && start === 0) throw new Error(`Missing section ${section}`);
  for (const line of lines.slice(start)) {
    if (/^\[/.test(line)) break;
    const match = line.match(new RegExp(`^${key}\\s*=\\s*(.+)$`));
    if (match) return JSON.parse(match[1]);
  }
  throw new Error(`Missing key ${section}.${key}`);
}

test('LAB DEV y TEST tienen proyectos, redes y puertos propios sin reutilizar el original', () => {
  const development = context(root);
  expect(development).toMatchObject({
    test: false,
    projectId: 'alunza-edu-laboratorio',
    networkName: 'alunza-laboratorio-local',
    apiPort: 4200,
    webPort: 3200,
    authPort: 17421,
    dbPort: 17422,
    shadowPort: 17420,
    studioPort: 17423,
    mailPort: 17424,
  });
  expect(testContext).toMatchObject({
    test: true,
    projectDir: join(root, '.local/lab-integration-workspace'),
    projectId: 'alunza-edu-laboratorio-test',
    networkName: 'alunza-laboratorio-test-local',
    apiPort: 4300,
    webPort: 3300,
    authPort: 18421,
    dbPort: 18422,
    shadowPort: 18420,
    studioPort: 18423,
    mailPort: 18424,
  });
  expect(testContext.projectDir).not.toBe(
    join(root, '.local/integration-workspace'),
  );
  expect(development.statePath).not.toBe(testContext.statePath);
});

test.each([15422, 16422])(
  'ni un expectedPort manipulado permite apuntar la guarda de migración al original %s',
  (originalPort) => {
    expect(() =>
      assertLocalDatabase(
        `postgresql://fixture:local@127.0.0.1:${originalPort}/postgres`,
        originalPort,
      ),
    ).toThrow();
  },
);

test.each([17422, 18422])(
  'la guarda acepta únicamente el destino LAB explícito %s',
  (port) => {
    expect(() =>
      assertLocalDatabase(
        `postgresql://fixture:local@127.0.0.1:${port}/postgres`,
        port,
      ),
    ).not.toThrow();
  },
);

const state = {
  projectId: 'alunza-edu-laboratorio-test',
  authUrl: 'http://127.0.0.1:18421',
  migrationUrl: 'postgresql://fixture:local@127.0.0.1:18422/postgres',
};

test('la guarda de fixtures acepta el destino completo LAB TEST sin abrir conexiones', () => {
  expect(() => assertLaboratoryTestState(state)).not.toThrow();
  expect(() => assertRuntimeTarget(state, testTarget)).not.toThrow();
});

test.each([
  ['proyecto original TEST', { projectId: 'alunza-edu-foundation-test' }],
  ['proyecto original DEV', { projectId: 'alunza-edu-foundation' }],
  ['proyecto LAB DEV', { projectId: 'alunza-edu-laboratorio' }],
  ['Auth original TEST', { authUrl: 'http://127.0.0.1:16421' }],
  ['Auth original DEV', { authUrl: 'http://127.0.0.1:15421' }],
  ['Auth LAB DEV', { authUrl: 'http://127.0.0.1:17421' }],
  ...[15422, 16422, 17422].map((port) => [
    `base ajena ${port}`,
    { migrationUrl: `postgresql://fixture:local@127.0.0.1:${port}/postgres` },
  ]),
  [
    'host remoto',
    { migrationUrl: 'postgresql://fixture:local@example.test:18422/postgres' },
  ],
  [
    'base diferente',
    { migrationUrl: 'postgresql://fixture:local@127.0.0.1:18422/other' },
  ],
  [
    'override de opciones',
    { migrationUrl: `${state.migrationUrl}?host=127.0.0.1&port=15422` },
  ],
  ['fragmento', { migrationUrl: `${state.migrationUrl}#copied` }],
])('los fixtures rechazan %s antes de conectar', (_description, override) => {
  expect(() => assertLaboratoryTestState({ ...state, ...override })).toThrow(
    'El fixture exige el destino completo de LAB TEST.',
  );
  expect(() =>
    assertRuntimeTarget({ ...state, ...override }, testTarget),
  ).toThrow();
});

test('las guardas operativas rechazan destinos fabricados y un contexto LAB con puertos del original', () => {
  expect(() => assertRuntimeTarget(state, { ...testTarget })).toThrow();
  expect(() =>
    assertLocalTarget({ ...context(root), authPort: 15421, dbPort: 15422 }),
  ).toThrow();
  expect(() => assertLocalTarget(context(root))).not.toThrow();
  expect(() =>
    assertRuntimeTarget(
      {
        projectId: 'alunza-edu-laboratorio',
        authUrl: 'http://127.0.0.1:17421',
        migrationUrl: 'postgresql://fixture:local@127.0.0.1:17422/postgres',
      },
      developmentTarget,
    ),
  ).not.toThrow();
});

test('Supabase DEV y sus callbacks Auth apuntan solo al laboratorio', () => {
  const source = read('supabase/config.toml');
  expect(tomlValue(source, '', 'project_id')).toBe('alunza-edu-laboratorio');
  for (const [section, key, expected] of [
    ['api', 'port', 17421],
    ['db', 'port', 17422],
    ['db', 'shadow_port', 17420],
    ['studio', 'port', 17423],
    ['inbucket', 'port', 17424],
    ['auth', 'jwt_issuer', 'http://127.0.0.1:17421/auth/v1'],
  ])
    expect(tomlValue(source, section, key)).toBe(expected);
  expect(new URL(tomlValue(source, 'auth', 'site_url')).port).toBe('3200');
  for (const redirect of tomlValue(
    source,
    'auth',
    'additional_redirect_urls',
  )) {
    const target = new URL(redirect);
    expect(['127.0.0.1', 'localhost']).toContain(target.hostname);
    expect(target.port).toBe('3200');
  }
});

test('la configuración TEST generada mantiene separados proyecto, puertos y callbacks de DEV', () => {
  const source = read('supabase/config.toml');
  const generated = buildTestConfig(source);
  expect(tomlValue(generated, '', 'project_id')).toBe(
    'alunza-edu-laboratorio-test',
  );
  for (const [section, key, expected] of [
    ['api', 'port', 18421],
    ['db', 'port', 18422],
    ['db', 'shadow_port', 18420],
    ['studio', 'port', 18423],
    ['inbucket', 'port', 18424],
    ['auth', 'jwt_issuer', 'http://127.0.0.1:18421/auth/v1'],
  ])
    expect(tomlValue(generated, section, key)).toBe(expected);
  expect(new URL(tomlValue(generated, 'auth', 'site_url')).port).toBe('3300');
  for (const redirect of tomlValue(
    generated,
    'auth',
    'additional_redirect_urls',
  ))
    expect(new URL(redirect).port).toBe('3300');
  expect(() =>
    buildTestConfig(
      source.replace(
        'project_id = "alunza-edu-laboratorio"',
        'project_id = "alunza-edu-foundation"',
      ),
    ),
  ).toThrow();
});

test('Compose LAB publica solo 4200/3200 en loopback y Cypress solo acepta web TEST 3300', () => {
  const compose = read('infra/compose.yaml');
  expect(compose).toMatch(/^name: alunza-edu-laboratorio-apps\s*$/m);
  expect(compose).toContain('image: alunza-edu-laboratorio-api:local');
  expect(compose).toContain('image: alunza-edu-laboratorio-web:local');
  const published = [
    ...compose.matchAll(/^\s+- ['"](127\.0\.0\.1:\d+:\d+)['"]\s*$/gm),
  ].map((match) => match[1]);
  expect(published.sort()).toEqual([
    '127.0.0.1:3200:3000',
    '127.0.0.1:4200:4000',
  ]);
  expect(compose).not.toContain('alunza-foundation');
  expect(compose).not.toMatch(
    /NEXT_PUBLIC_API_BASE_URL[^\r\n]+127\.0\.0\.1:4000/,
  );
  expect(compose).toContain('http://127.0.0.1:4200');
  expect(cypress.e2e.baseUrl).toBe('http://127.0.0.1:3300');
});
