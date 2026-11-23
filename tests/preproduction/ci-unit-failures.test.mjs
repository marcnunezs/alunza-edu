import { expect, test } from '@jest/globals';
import { summarizeUnitFailures } from '../../scripts/ci-unit-failures.mjs';

const apiTest = 'apps/api/src/submissions/submission.service.spec.ts';
const runnerTest = 'packages/runner/src/docker-engine.test.cjs';
const preproductionTest = 'tests/preproduction/report.test.mjs';
const trackedFiles = [apiTest, runnerTest, preproductionTest];

test('failure summaries contain only canonical tracked paths and omit private diagnostics', () => {
  const output = [
    `FAIL ${apiTest}`,
    '  ● private-hidden-test-title',
    '    Expected: private-hidden-answer',
    '    Received: private-student-code',
    '    at private-host-path:42:7',
    '    Authorization: Bearer private-token',
    `PASS ${runnerTest}`,
    'Test Suites: 1 failed, 1 passed, 2 total',
    'Tests: 1 failed, 7 passed, 8 total',
  ].join('\n');

  const result = summarizeUnitFailures(output, trackedFiles);

  expect(result).toEqual({ failedTestFiles: [apiTest] });
  expect(Object.keys(result)).toEqual(['failedTestFiles']);
  expect(JSON.stringify(result)).not.toContain('private-');
});

test('ANSI, whitespace, CRLF and Windows separators preserve canonical Git paths', () => {
  const output = [
    `\t\x1b[41m\x1b[37m FAIL \x1b[0m ${runnerTest.replaceAll('/', '\\')} (125 ms)\t`,
    ` \x1b[31mFAIL\x1b[0m ${apiTest} (1.25 s) `,
    `FAIL ${preproductionTest}`,
  ].join('\r\n');

  expect(summarizeUnitFailures(output, trackedFiles)).toEqual({
    failedTestFiles: [runnerTest, apiTest, preproductionTest],
  });
});

test.each(['', ' (2 s)', ' (0.75 s)', ' (250 ms)', ' (0.5 ms)'])(
  'the standard Jest duration suffix %p is accepted',
  (suffix) => {
    expect(
      summarizeUnitFailures(`FAIL ${apiTest}${suffix}`, trackedFiles),
    ).toEqual({ failedTestFiles: [apiTest] });
  },
);

test.each([
  ' private-token',
  ' (2 s) private-token',
  ' (private-token s)',
  ' (2 seconds)',
  ' (2)',
  ' (2 s) (3 s)',
  ': private-token',
  ' -> private-token',
  '\t{"token":"private-token"}',
])('an arbitrary suffix %p cannot become a failure entry', (suffix) => {
  expect(
    summarizeUnitFailures(`FAIL ${apiTest}${suffix}`, trackedFiles),
  ).toEqual({
    failedTestFiles: [],
  });
});

test('only a complete FAIL prefix introduces a failure file', () => {
  const output = [
    `PASS ${apiTest}`,
    `FAILED ${apiTest}`,
    `FAILURE ${apiTest}`,
    `fail ${apiTest}`,
    `prefix FAIL ${apiTest}`,
    `Error: FAIL ${apiTest}`,
    `{"message":"FAIL ${apiTest}"}`,
    `● private-test-title FAIL ${apiTest}`,
    `FAIL${apiTest}`,
  ].join('\n');

  expect(summarizeUnitFailures(output, trackedFiles)).toEqual({
    failedTestFiles: [],
  });
});

test('duplicates resolve before the cap and preserve the first appearance order', () => {
  const output = [
    `FAIL src/docker-engine.test.cjs`,
    `FAIL ${preproductionTest}`,
    `FAIL ${runnerTest}`,
    `FAIL ${apiTest}`,
    `FAIL ${apiTest.replaceAll('/', '\\')} (10 ms)`,
    `FAIL ../../${preproductionTest}`,
  ].join('\n');

  expect(summarizeUnitFailures(output, trackedFiles)).toEqual({
    failedTestFiles: [runnerTest, preproductionTest, apiTest],
  });
});

test('a package-relative src path resolves only when its tracked suffix is unique', () => {
  const apiShared = 'apps/api/src/shared.spec.ts';
  const runnerShared = 'packages/runner/src/shared.spec.ts';
  const output = [
    'FAIL src/shared.spec.ts',
    'FAIL src/docker-engine.test.cjs',
    `FAIL ${apiShared}`,
  ].join('\n');

  expect(
    summarizeUnitFailures(output, [...trackedFiles, apiShared, runnerShared]),
  ).toEqual({ failedTestFiles: [runnerTest, apiShared] });
});

test('an exact tracked path wins even when another tracked path shares its suffix', () => {
  const nested = `tests/fixtures/${apiTest}`;

  expect(summarizeUnitFailures(`FAIL ${apiTest}`, [nested, apiTest])).toEqual({
    failedTestFiles: [apiTest],
  });
});

test('leading package parent segments and dot prefixes resolve without host paths', () => {
  const output = [
    `FAIL ../../${preproductionTest}`,
    `FAIL ./${apiTest}`,
    'FAIL ./src/docker-engine.test.cjs',
  ].join('\n');

  expect(summarizeUnitFailures(output, trackedFiles)).toEqual({
    failedTestFiles: [preproductionTest, apiTest, runnerTest],
  });
});

test.each([
  `/${apiTest}`,
  `C:/${apiTest}`,
  `C:\\repo\\${apiTest.replaceAll('/', '\\')}`,
  `\\\\private-host\\share\\${apiTest.replaceAll('/', '\\')}`,
  `//private-host/share/${apiTest}`,
  `file:///private-host/${apiTest}`,
])('absolute or host-qualified candidate %p is rejected', (candidate) => {
  expect(summarizeUnitFailures(`FAIL ${candidate}`, trackedFiles)).toEqual({
    failedTestFiles: [],
  });
});

test.each([
  'apps/api/src/../submission.service.spec.ts',
  'apps/api/./src/submission.service.spec.ts',
  'src/../submission.service.spec.ts',
  'src/./submission.service.spec.ts',
  'tests/../../apps/api/src/submission.service.spec.ts',
  'apps\\api\\src\\..\\submission.service.spec.ts',
])(
  'internal traversal candidate %p remains invalid even if supplied as tracked',
  (candidate) => {
    expect(
      summarizeUnitFailures(`FAIL ${candidate}`, [...trackedFiles, candidate]),
    ).toEqual({ failedTestFiles: [] });
  },
);

test.each([
  'scripts/diagnostics.test.mjs',
  'docs/diagnostics.spec.ts',
  '.local/diagnostics.test.js',
  'applications/api/diagnostics.spec.ts',
  'packages-extra/diagnostics.test.cjs',
  'test/diagnostics.spec.ts',
])(
  'tracked candidate %p outside the allowed roots is excluded',
  (candidate) => {
    expect(summarizeUnitFailures(`FAIL ${candidate}`, [candidate])).toEqual({
      failedTestFiles: [],
    });
  },
);

test.each(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'])(
  'JavaScript and TypeScript test and spec files support the %s extension',
  (extension) => {
    const testFile = `packages/contracts/src/schema.test.${extension}`;
    const specFile = `apps/api/src/schema.spec.${extension}`;

    expect(
      summarizeUnitFailures(`FAIL ${testFile}\nFAIL ${specFile}`, [
        specFile,
        testFile,
      ]),
    ).toEqual({ failedTestFiles: [testFile, specFile] });
  },
);

test.each([
  'apps/api/src/schema.ts',
  'apps/api/src/schema.e2e.ts',
  'apps/api/src/schema.test.json',
  'apps/api/src/schema.spec.ts.map',
  'apps/api/src/schema.test.ts.exe',
  'apps/api/src/schema.spec.ts/child',
])('tracked non-test candidate %p cannot enter the summary', (candidate) => {
  expect(summarizeUnitFailures(`FAIL ${candidate}`, [candidate])).toEqual({
    failedTestFiles: [],
  });
});

test('valid-looking files absent from the tracked inventory are excluded', () => {
  const output = [
    'FAIL apps/api/src/untracked.spec.ts',
    'FAIL packages/runner/src/untracked.test.cjs',
    'FAIL tests/preproduction/untracked.test.mjs',
    `FAIL ${apiTest}`,
  ].join('\n');

  expect(summarizeUnitFailures(output, trackedFiles)).toEqual({
    failedTestFiles: [apiTest],
  });
  expect(summarizeUnitFailures(`FAIL ${apiTest}`, [])).toEqual({
    failedTestFiles: [],
  });
});

test('a Set inventory and tracked filenames containing ASCII spaces are supported', () => {
  const spaced = 'apps/api/src/tutor flow.spec.ts';
  const output = [
    'FAIL src/tutor flow.spec.ts (2 s)',
    `FAIL ${runnerTest}`,
    `FAIL ${spaced}`,
  ].join('\n');

  expect(
    summarizeUnitFailures(output, new Set([spaced, runnerTest, apiTest])),
  ).toEqual({ failedTestFiles: [spaced, runnerTest] });
});

test.each(['\0', '\t', '\x07', '\x7f'])(
  'a control character %p inside a tracked path remains forbidden',
  (control) => {
    const candidate = `apps/api/src/private${control}name.spec.ts`;

    expect(summarizeUnitFailures(`FAIL ${candidate}`, [candidate])).toEqual({
      failedTestFiles: [],
    });
  },
);

test('a build failure or a command timeout yields an empty test-file summary', () => {
  const output = [
    'error TS2307: Cannot find module private-module.',
    'npm error Lifecycle script build failed with error:',
    'Command timed out after 120000 ms',
    'private-code and private-environment',
  ].join('\n');

  expect(summarizeUnitFailures(output, trackedFiles)).toEqual({
    failedTestFiles: [],
  });
  expect(summarizeUnitFailures('', trackedFiles)).toEqual({
    failedTestFiles: [],
  });
});

test('summaries stop at sixteen distinct files without counting duplicates', () => {
  const files = Array.from(
    { length: 18 },
    (_, index) => `tests/unit/case-${index + 1}.test.mjs`,
  );
  const output = [
    ...Array(30).fill(`FAIL ${files[0]}`),
    ...files.slice(1).map((file) => `FAIL ${file}`),
  ].join('\n');

  expect(summarizeUnitFailures(output, files.toReversed())).toEqual({
    failedTestFiles: files.slice(0, 16),
  });
});

test('candidate length is inclusive at 512 characters and rejects longer paths', () => {
  const prefix = `apps/api/${'group/'.repeat(70)}`;
  const suffix = '.test.ts';
  const candidate = `${prefix}${'a'.repeat(512 - prefix.length - suffix.length)}${suffix}`;
  const oversized = `${prefix}${'b'.repeat(513 - prefix.length - suffix.length)}${suffix}`;

  expect(candidate).toHaveLength(512);
  expect(oversized).toHaveLength(513);
  expect(
    summarizeUnitFailures(`FAIL ${oversized}\nFAIL ${candidate}`, [
      oversized,
      candidate,
    ]),
  ).toEqual({ failedTestFiles: [candidate] });
});

test('raw line length is inclusive at 2048 characters before stripping ANSI', () => {
  const valid = `FAIL ${apiTest}`;
  const boundary = `${' '.repeat(2048 - valid.length)}${valid}`;
  const oversized = `${' '.repeat(2049 - valid.length)}${valid}`;
  const oversizedAnsi = `${'\x1b[0m'.repeat(520)}FAIL ${runnerTest}`;

  expect(summarizeUnitFailures(boundary, trackedFiles)).toEqual({
    failedTestFiles: [apiTest],
  });
  expect(
    summarizeUnitFailures(`${oversized}\n${oversizedAnsi}`, trackedFiles),
  ).toEqual({ failedTestFiles: [] });
  expect(
    summarizeUnitFailures(
      `${oversized}\nFAIL ${preproductionTest}`,
      trackedFiles,
    ),
  ).toEqual({ failedTestFiles: [preproductionTest] });
});

test('output is bounded at 8 MiB and oversized input returns only an empty summary', () => {
  const limit = 8 * 1024 * 1024;
  const valid = `FAIL ${apiTest}\n`;
  const boundary = `${valid}${'x'.repeat(limit - valid.length)}`;

  expect(summarizeUnitFailures(boundary, trackedFiles)).toEqual({
    failedTestFiles: [apiTest],
  });
  expect(summarizeUnitFailures(`${boundary}x`, trackedFiles)).toEqual({
    failedTestFiles: [],
  });
});
