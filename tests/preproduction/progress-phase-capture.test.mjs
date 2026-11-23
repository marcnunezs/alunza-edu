import { shouldRecoverProgressCaptures } from '../e2e/progress-phase-capture.mjs';

function completedGate() {
  return {
    failed: true,
    hasContext: true,
    testTitle: 'IMP05-PHASE-08 · Progreso con 51 intentos',
    error: {
      name: 'AssertionError',
      actual: 3110.1,
      expected: 3000,
      message: 'expected 3110.1 to be below 3000',
    },
    measurement: {
      surface: 'progress',
      concurrency: 4,
      startedAt: null,
      firstNavigationValid: true,
      firstNavigationMs: 2466.2,
      samples: Array.from({ length: 50 }, () => ({
        durationMs: 3110.1,
        valid: true,
      })),
      p95GateMs: 3110.1,
    },
  };
}

test('only the completed PHASE-08 concurrent p95 failure permits post-measurement captures', () => {
  const input = completedGate();
  const before = globalThis.structuredClone(input);
  expect(shouldRecoverProgressCaptures(input)).toBe(true);
  expect(input).toEqual(before);
  input.measurement.p95GateMs = 3000;
  input.error.actual = 3000;
  input.error.message = 'expected 3000 to be below 3000';
  expect(shouldRecoverProgressCaptures(input)).toBe(true);
});

test.each(['absent', 'strings', 'actual absent', 'expected absent'])(
  'accepts matching serialized diff fields: %s',
  (shape) => {
    const input = completedGate();
    if (shape === 'strings') {
      input.error.actual = String(input.error.actual);
      input.error.expected = String(input.error.expected);
    } else {
      if (shape === 'absent' || shape === 'actual absent')
        delete input.error.actual;
      if (shape === 'absent' || shape === 'expected absent')
        delete input.error.expected;
    }
    expect(shouldRecoverProgressCaptures(input)).toBe(true);
  },
);

test.each([
  'prefix expected 3110.1 to be below 3000',
  'expected 3110.1 to be below 3000 suffix',
  'expected 3110.1 to be below 3000\n',
  'expected 3110.2 to be below 3000',
  'expected 3110.1 to be below 3001',
  'expected 3.1101e3 to be below 3000',
  'expected NaN to be below 3000',
  'expected Infinity to be below 3000',
])(
  'rejects a message that does not exactly establish this p95 gate: %p',
  (message) => {
    const input = completedGate();
    input.error.message = message;
    delete input.error.actual;
    delete input.error.expected;
    expect(shouldRecoverProgressCaptures(input)).toBe(false);
  },
);

test.each([
  ['actual', null],
  ['expected', null],
  ['actual', undefined],
  ['expected', undefined],
  ['actual', NaN],
  ['expected', Infinity],
  ['actual', true],
  ['expected', {}],
  ['actual', [3110.1]],
  ['actual', '3110.10'],
  ['expected', '3000.0'],
  ['actual', '03110.1'],
  ['expected', '+3000'],
  ['actual', ' 3110.1'],
  ['expected', '3e3'],
  ['actual', '3110.2'],
  ['expected', '3001'],
])('rejects incompatible serialized %s: %p', (key, value) => {
  const input = completedGate();
  input.error[key] = value;
  expect(shouldRecoverProgressCaptures(input)).toBe(false);
});

test.each([
  [
    'successful test',
    (value) => {
      value.failed = false;
    },
  ],
  [
    'missing context',
    (value) => {
      value.hasContext = false;
    },
  ],
  [
    'another test',
    (value) => {
      value.testTitle = 'IMP05-PHASE-07 · Tablero';
    },
  ],
  [
    'ambiguous test identifier',
    (value) => {
      value.testTitle = 'IMP05-PHASE-080 · Progreso';
    },
  ],
  [
    'another surface',
    (value) => {
      value.measurement.surface = 'dashboard';
    },
  ],
  [
    'serial profile',
    (value) => {
      value.measurement.concurrency = 1;
    },
  ],
  [
    'navigation still running',
    (value) => {
      value.measurement.startedAt = 1000;
    },
  ],
  [
    'first navigation invalid',
    (value) => {
      value.measurement.firstNavigationValid = false;
    },
  ],
  [
    'first navigation missing',
    (value) => {
      value.measurement.firstNavigationMs = null;
    },
  ],
  [
    'first navigation NaN',
    (value) => {
      value.measurement.firstNavigationMs = NaN;
    },
  ],
  [
    'incomplete samples',
    (value) => {
      value.measurement.samples.pop();
    },
  ],
  [
    'extra sample',
    (value) => {
      value.measurement.samples.push({ durationMs: 1, valid: true });
    },
  ],
  [
    'invalid sample',
    (value) => {
      value.measurement.samples[0].valid = false;
    },
  ],
  [
    'NaN sample',
    (value) => {
      value.measurement.samples[0].durationMs = NaN;
    },
  ],
  [
    'negative sample',
    (value) => {
      value.measurement.samples[0].durationMs = -1;
    },
  ],
  [
    'gate not reached',
    (value) => {
      delete value.measurement.p95GateMs;
    },
  ],
  [
    'passing gate',
    (value) => {
      value.measurement.p95GateMs = 2999;
    },
  ],
  [
    'NaN gate',
    (value) => {
      value.measurement.p95GateMs = NaN;
    },
  ],
  [
    'infinite gate',
    (value) => {
      value.measurement.p95GateMs = Infinity;
    },
  ],
  [
    'HTTP failure',
    (value) => {
      value.error = new Error('HTTP 503');
    },
  ],
  [
    'DOM assertion failure',
    (value) => {
      value.error = {
        name: 'AssertionError',
        actual: 49,
        expected: 50,
        message: 'expected rows to have length 50',
      };
    },
  ],
  [
    'wrong actual',
    (value) => {
      value.error.actual = 3001;
    },
  ],
  [
    'wrong expected',
    (value) => {
      value.error.expected = 4000;
    },
  ],
  [
    'wrong assertion text',
    (value) => {
      value.error.message = 'expected response to equal 3000';
    },
  ],
  [
    'wrong error type',
    (value) => {
      value.error.name = 'Error';
    },
  ],
])('does not recover captures for %s', (_name, mutate) => {
  const input = completedGate();
  mutate(input);
  expect(shouldRecoverProgressCaptures(input)).toBe(false);
});

test.each([undefined, null, {}, { measurement: null }, { error: null }])(
  'missing evidence never permits capture recovery: %p',
  (input) => {
    expect(shouldRecoverProgressCaptures(input)).toBe(false);
  },
);
