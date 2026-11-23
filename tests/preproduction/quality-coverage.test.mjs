import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createCoverageReader,
  parseQualityCatalog,
  validateQualityCoverage,
} from '../../scripts/quality-coverage.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sourceDigest = 'a'.repeat(64);
const specPaths = [
  'specs/02-requisitos-funcionales.md',
  'specs/03-flujos-y-criterios-de-aceptacion.md',
  'specs/10-calidad-y-pruebas.md',
  'specs/09-seguridad-y-privacidad.md',
];
let files, catalog;
beforeAll(async () => {
  files = Object.fromEntries(
    await Promise.all(
      specPaths.map(async (path) => [path, await readFile(path, 'utf8')]),
    ),
  );
  catalog = parseQualityCatalog(files);
});

function input() {
  const paths = {
    scenario: specPaths[1],
    nonFunctional: specPaths[2],
    organizational: specPaths[2],
    security: specPaths[3],
    vertical: specPaths[2],
  };
  const evidencePath = '.local/reports/imp-07/synthetic.json';
  const report = JSON.stringify({
    status: 'passed',
    sourceDigestBefore: sourceDigest,
    sourceDigestAfter: sourceDigest,
    environment: 'LAB TEST',
    provider: 'TEST',
  });
  const contents = {
    ...files,
    [evidencePath]: report,
    'tests/example.test.mjs': "test('KNOWN', () => {});",
  };
  const evidence = {
    id: 'EV-TEST',
    path: evidencePath,
    selector: 'passed',
    result: 'passed',
    environment: 'LAB TEST',
    provider: 'TEST',
    candidate: { commit: null, sourceDigest },
    recordedAt: '2026-11-03',
    provenance: 'report',
    claim: 'baseline',
    limitation: 'Synthetic validator fixture; never product evidence.',
    sha256: sha256(report),
  };
  const matrix = {
    schemaVersion: 1,
    baseline: {
      commit: 'b'.repeat(40),
      sourceDigest,
      sourceFiles: 694,
      auditedOn: '2026-11-03',
      timeZone: 'America/Santiago',
    },
    humanAcceptance: 'not-recorded',
    evidence: [evidence],
    entries: Object.entries(catalog.catalogs).flatMap(([kind, ids]) =>
      ids.map((id) => ({
        id,
        kind,
        requirementIds:
          kind === 'scenario'
            ? [id.replace('HU', 'RF').replace(/-E\d$/, '')]
            : [],
        source: { path: paths[kind], selector: id },
        expected: 'Declared independent expectation.',
        implementation: { status: 'not-assessed', refs: [] },
        coverage: 'partial',
        checks: [
          {
            path: 'tests/example.test.mjs',
            selector: 'KNOWN',
            level: 'unit',
            environment: 'LAB TEST',
            provider: 'TEST',
            verifies: 'One declared branch.',
          },
        ],
        evidenceRefs: ['EV-TEST'],
        gaps: [
          {
            kind: 'missing-test',
            priority: 'medium',
            description: 'Missing rejection branch.',
            action: 'Add rejection assertion.',
            increment: 'IMP-07.03',
            case: {
              actor: 'Student A',
              preconditions: 'Class B is unauthorized.',
              action: 'Request B.',
              expected: 'Denied without data.',
              level: 'http',
            },
          },
        ],
      })),
    ),
  };
  return {
    matrix,
    options: {
      catalog,
      readText: async (path) => contents[path] ?? null,
      currentCandidate: { sourceDigest: 'c'.repeat(64) },
    },
    contents,
  };
}
const run = ({ matrix, options }) => validateQualityCoverage(matrix, options);
const codes = (result) => result.errors.map((error) => error.code);

test('all source obligations are inventoried independently of the submitted matrix', () => {
  expect(
    Object.fromEntries(
      Object.entries(catalog.catalogs).map(([kind, ids]) => [kind, ids.length]),
    ),
  ).toEqual({
    scenario: 108,
    nonFunctional: 29,
    organizational: 6,
    security: 14,
    vertical: 6,
  });
  expect(catalog.traceability).toHaveLength(27);
});
test('an honest audit with gaps passes without accepting the product or transferring baseline evidence', async () => {
  const result = await run(input());
  expect(result).toMatchObject({
    auditStatus: 'consistent',
    exitCode: 0,
    acceptanceStatus: 'not-assessed',
    humanAcceptance: 'not-recorded',
    baselineMatchesCurrent: false,
    gaps: 163,
    errors: [],
  });
  expect(result.requirements).toHaveLength(27);
  expect(result.requirements.every((row) => row.scenarios.length === 4)).toBe(
    true,
  );
});
test.each(['missing', 'duplicate', 'unknown', 'relation'])(
  'rejects %s catalog mappings even if totals look plausible',
  async (mutation) => {
    const value = input();
    if (mutation === 'missing') value.matrix.entries.pop();
    if (mutation === 'duplicate')
      value.matrix.entries[1] = JSON.parse(
        JSON.stringify(value.matrix.entries[0]),
      );
    if (mutation === 'unknown') value.matrix.entries[0].id = 'ALZ-HU-999-E1';
    if (mutation === 'relation')
      value.matrix.entries[0].requirementIds = ['ALZ-RF-027'];
    expect((await run(value)).exitCode).toBe(1);
  },
);
test.each(['missing-path', 'selector', 'traversal', 'etl', 'e2e'])(
  'rejects %s references without running their targets',
  async (mutation) => {
    const value = input(),
      check = value.matrix.entries[0].checks[0];
    if (mutation === 'missing-path') check.path = 'tests/absent.test.mjs';
    if (mutation === 'selector') check.selector = 'NOT_PRESENT';
    if (mutation === 'traversal') check.path = '../secret.json';
    if (mutation === 'etl') check.path = '.local/evidence/capture.etl';
    if (mutation === 'e2e') check.level = 'e2e';
    expect((await run(value)).exitCode).toBe(1);
  },
);
test('rejects partial coverage without next action and missing tests without executable case specification', async () => {
  const value = input();
  value.matrix.entries[0].gaps = [];
  delete value.matrix.entries[1].gaps[0].case;
  value.matrix.entries[2].gaps[0].action = '';
  expect(codes(await run(value))).toEqual(
    expect.arrayContaining([
      'GAP_REQUIRED',
      'MISSING_TEST_UNSPECIFIED',
      'GAP_INVALID',
    ]),
  );
});
test('old evidence cannot be promoted merely by editing its candidate metadata', async () => {
  const value = input();
  value.matrix.evidence[0].candidate.sourceDigest = 'd'.repeat(64);
  expect(codes(await run(value))).toContain('BASELINE_CLAIM_UNSUPPORTED');
  value.matrix.evidence[0].candidate.sourceDigest = sourceDigest;
  value.contents[value.matrix.evidence[0].path] = value.contents[
    value.matrix.evidence[0].path
  ].replaceAll(sourceDigest, 'd'.repeat(64));
  value.matrix.evidence[0].sha256 = sha256(
    value.contents[value.matrix.evidence[0].path],
  );
  expect(codes(await run(value))).toContain('REPORT_CANDIDATE_MISMATCH');
});
test('changed bytes or a failed report cannot substantiate recorded baseline success', async () => {
  const value = input();
  value.contents[value.matrix.evidence[0].path] = value.contents[
    value.matrix.evidence[0].path
  ].replace('passed', 'failed');
  expect(codes(await run(value))).toContain('EVIDENCE_HASH_MISMATCH');
  value.matrix.evidence[0].sha256 = sha256(
    value.contents[value.matrix.evidence[0].path],
  );
  expect(codes(await run(value))).toContain('REPORT_RESULT_MISMATCH');
});
test('a passed report heading cannot conceal a failed case', async () => {
  const value = input(),
    evidence = value.matrix.evidence[0];
  const report = JSON.parse(value.contents[evidence.path]);
  report.cases = [{ id: 'CASE-01', status: 'failed' }];
  value.contents[evidence.path] = JSON.stringify(report);
  evidence.sha256 = sha256(value.contents[evidence.path]);
  expect(codes(await run(value))).toContain('REPORT_CASES_NOT_PASSED');
});
test('TEST and Docker do not substantiate Azure, Sandbox or human acceptance', async () => {
  for (const provider of ['AZURE', 'VERCEL']) {
    const value = input();
    value.matrix.evidence[0].provider = provider;
    expect(codes(await run(value))).toContain('PROVIDER_ENVIRONMENT_MISMATCH');
    value.matrix.evidence[0].environment = 'REMOTE';
    expect(codes(await run(value))).toContain('REPORT_PROVIDER_MISMATCH');
  }
  const human = input();
  human.matrix.evidence[0].environment = 'HUMAN';
  expect(codes(await run(human))).toContain('HUMAN_ACCEPTANCE_NOT_RECORDED');
});
test.each(['historical-remote', 'failed-with-functional-pass'])(
  'a %s report never supports an approval',
  async (mode) => {
    const value = input(),
      evidence = value.matrix.evidence[0];
    evidence.selector = 'status';
    const report = JSON.parse(value.contents[evidence.path]);
    report.status = 'failed';
    if (mode === 'historical-remote') {
      evidence.claim = 'historical';
      evidence.environment = report.environment = 'REMOTE';
      evidence.provider = report.provider = 'AZURE';
    } else {
      report.functionalStatus = 'passed';
    }
    value.contents[evidence.path] = JSON.stringify(report);
    evidence.sha256 = sha256(value.contents[evidence.path]);
    expect(codes(await run(value))).toContain('REPORT_RESULT_MISMATCH');
  },
);
test('absent private artifacts remain unavailable rather than passing or blocking a complete audit', async () => {
  const value = input();
  delete value.contents[value.matrix.evidence[0].path];
  const result = await run(value);
  expect(result).toMatchObject({
    exitCode: 0,
    evidenceStates: { 'EV-TEST': 'unavailable' },
    warnings: [{ code: 'EVIDENCE_UNAVAILABLE', id: 'EV-TEST' }],
  });
});
test('explicit local provider and Cypress IDs cannot contradict their backing evidence', async () => {
  const value = input();
  value.matrix.evidence[0].provider = 'DOCKER';
  expect(codes(await run(value))).toContain('REPORT_PROVIDER_MISMATCH');
  value.matrix.evidence[0].provider = 'TEST';
  value.options.e2eInventory = [
    { spec: 'tests/example.test.mjs', cases: ['CASE-01', 'CASE-02'] },
  ];
  value.contents['tests/example.test.mjs'] =
    "test('CASE-01', () => {}); test('CASE-02', () => {}); KNOWN";
  value.matrix.entries[0].checks[0] = {
    ...value.matrix.entries[0].checks[0],
    level: 'e2e',
    selector: 'CASE-01',
    caseIds: ['CASE-02'],
  };
  expect(codes(await run(value))).toContain('E2E_SELECTOR_CASE_MISMATCH');
});
test('only the explicit blocked .07 aggregate can substantiate functional success without integral acceptance', async () => {
  const value = input(),
    evidence = value.matrix.evidence[0];
  const report = JSON.parse(value.contents[evidence.path]);
  Object.assign(report, {
    increment: 'IMP-06.07',
    status: 'blocked',
    functionalStatus: 'passed',
    acceptanceStatus: 'blocked',
  });
  value.contents[evidence.path] = JSON.stringify(report);
  evidence.sha256 = sha256(value.contents[evidence.path]);
  expect(await run(value)).toMatchObject({
    exitCode: 0,
    acceptanceStatus: 'not-assessed',
  });
});
test('undocumented approval fields and unknown evidence references are rejected', async () => {
  const value = input();
  value.matrix.entries[0].accepted = true;
  value.matrix.entries[1].evidenceRefs = ['EV-MISSING'];
  expect(codes(await run(value))).toEqual(
    expect.arrayContaining([
      'ENTRY_METADATA_INVALID',
      'EVIDENCE_REFERENCE_UNKNOWN',
    ]),
  );
});
test('the real matrix stays valid without local evidence or services', async () => {
  const matrix = JSON.parse(
    await readFile('docs/work/IMP-07-coverage-matrix.json', 'utf8'),
  );
  const readText = createCoverageReader(process.cwd());
  const result = await validateQualityCoverage(matrix, {
    catalog,
    readText: (path) => (path.startsWith('.local/') ? null : readText(path)),
  });
  expect(result.errors).toEqual([]);
  expect(result.exitCode).toBe(0);
});
