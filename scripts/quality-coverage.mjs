import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import e2e from './e2e-inventory.cjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const digest = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{7,40}$/;
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const list = (value) => (Array.isArray(value) ? value : []);
const onlyKeys = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));
const groups = {
  scenario: 108,
  nonFunctional: 29,
  organizational: 6,
  security: 14,
  vertical: 6,
};
const environments = ['LOCAL', 'LAB TEST', 'REMOTE', 'HUMAN'];
const providers = ['DOCKER', 'TEST', 'AZURE', 'VERCEL', 'NONE', 'MIXED'];
const levels = ['unit', 'http', 'sql', 'e2e', 'manual', 'tool'];
const outcomes = ['passed', 'failed', 'blocked', 'not-run', 'mixed'];
const gapKinds = [
  'defect',
  'missing-test',
  'historical-evidence',
  'missing-evidence',
  'remote-integration',
  'human-decision',
  'acceptance-blocker',
];
const catalogPaths = {
  scenario: 'specs/03-flujos-y-criterios-de-aceptacion.md',
  nonFunctional: 'specs/10-calidad-y-pruebas.md',
  organizational: 'specs/10-calidad-y-pruebas.md',
  security: 'specs/09-seguridad-y-privacidad.md',
  vertical: 'specs/10-calidad-y-pruebas.md',
};

/** Exact source catalogs, not counts inferred from the audit being validated. */
export function parseQualityCatalog(files) {
  const patterns = {
    scenario: /^\|\s*(ALZ-HU-\d{3}-E[1-4])\s*\|/gm,
    nonFunctional: /^\|\s*(RNF-[A-Z]+-\d{2})\s*\|/gm,
    organizational: /^\|\s*(ORG-\d{3})\s*\|/gm,
    security: /^\|\s*(SEC-\d{2})\s*\|/gm,
    vertical: /^\*\*(E2E-\d{2}),/gm,
  };
  const catalogs = Object.fromEntries(
    Object.entries(patterns).map(([kind, pattern]) => [
      kind,
      [...files[catalogPaths[kind]].matchAll(pattern)].map((match) => match[1]),
    ]),
  );
  const traceability = [
    ...files['specs/02-requisitos-funcionales.md'].matchAll(
      /^\|\s*(ALZ-RF-(\d{3}))\s*\|\s*(ALZ-HU-\d{3})\s*\|\s*(ALZ-CU-\d{3})\s*\|\s*(ALZ-PT-\d{3})\s*\|/gm,
    ),
  ].map((match) => ({
    rf: match[1],
    number: match[2],
    hu: match[3],
    cu: match[4],
    pt: match[5],
  }));
  return { catalogs, traceability };
}

// Only authored text and explicitly referenced JSON/Markdown evidence are read.
function safePath(path) {
  return (
    text(path) &&
    !isAbsolute(path) &&
    !path.includes('\\') &&
    !path.split('/').some((part) => part === '..' || part === '.' || !part) &&
    (/^(apps|packages|scripts|tests|supabase|fixtures|infra|specs|docs|\.github)\/.+\.(?:[cm]?[jt]sx?|json|md|sql|ya?ml|bicep|toml)$/.test(
      path,
    ) ||
      /^\.local\/(?:reports|evidence)\/.+\.(?:json|md)$/.test(path) ||
      ['README.md', '.env.example', 'package.json'].includes(path)) &&
    !/signing_keys\.json$|(?:^|\/)node_modules\//.test(path)
  );
}

export function createCoverageReader(directory) {
  const cache = new Map();
  return async (path) => {
    if (!safePath(path)) throw new Error('UNSAFE_REFERENCE');
    if (!cache.has(path))
      cache.set(
        path,
        (async () => {
          try {
            const [base, target] = await Promise.all([
              realpath(directory),
              realpath(resolve(directory, path)),
            ]);
            const inside = relative(base, target);
            if (
              isAbsolute(inside) ||
              inside === '..' ||
              inside.startsWith('../') ||
              inside.startsWith('..\\')
            )
              throw new Error('UNSAFE_REFERENCE');
            return await readFile(target, 'utf8');
          } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
          }
        })(),
      );
    return cache.get(path);
  };
}

/** Same authored-source inventory as signals-candidate, without snapshots or writes. */
export async function readCoverageCandidate(directory = root) {
  const git = async (args) =>
    (
      await execute('git', args, {
        cwd: directory,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      })
    ).stdout;
  const [head, names] = await Promise.all([
    git(['rev-parse', 'HEAD']),
    git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
  ]);
  const files = [...new Set(names.split('\0').filter(Boolean))]
    .filter(
      (name) =>
        /^(apps|packages|scripts|tests|supabase|fixtures|infra|\.github)\//.test(
          name,
        ) ||
        [
          'package.json',
          'package-lock.json',
          'tsconfig.base.json',
          'eslint.config.mjs',
          'cypress.config.cjs',
          '.env.example',
          '.prettierrc.json',
        ].includes(name),
    )
    .filter(
      (name) =>
        !['apps/web/next-env.d.ts', 'packages/contracts/openapi.json'].includes(
          name,
        ),
    )
    .sort();
  const inventory = [];
  for (const path of files) {
    try {
      inventory.push({
        path,
        digest: sha256(await readFile(resolve(directory, path))),
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      inventory.push({ path, deleted: true });
    }
  }
  return {
    commit: head.trim(),
    sourceDigest: sha256(JSON.stringify(inventory)),
    sourceFiles: inventory.length,
  };
}

/** Validates traceability, never acceptance or the semantic sufficiency of assertions. */
export async function validateQualityCoverage(
  matrix,
  { catalog, readText, currentCandidate, e2eInventory = e2e.inventory },
) {
  const errors = [],
    warnings = [];
  const fail = (code, id) => errors.push({ code, id });
  const ref = async (reference, id, optional = false) => {
    if (!reference || !safePath(reference.path) || !text(reference.selector)) {
      fail('REFERENCE_INVALID', id);
      return null;
    }
    let content;
    try {
      content = await readText(reference.path);
    } catch {
      fail('REFERENCE_UNREADABLE', id);
      return null;
    }
    if (content === null) {
      if (optional) warnings.push({ code: 'EVIDENCE_UNAVAILABLE', id });
      else fail('REFERENCE_MISSING', id);
      return null;
    }
    if (!content.includes(reference.selector)) fail('SELECTOR_MISSING', id);
    return content;
  };
  if (
    !onlyKeys(matrix, [
      'schemaVersion',
      'baseline',
      'humanAcceptance',
      'entries',
      'evidence',
    ]) ||
    !Array.isArray(matrix?.entries) ||
    !Array.isArray(matrix?.evidence) ||
    matrix?.schemaVersion !== 1 ||
    matrix.humanAcceptance !== 'not-recorded' ||
    !commit.test(matrix?.baseline?.commit ?? '') ||
    !digest.test(matrix?.baseline?.sourceDigest ?? '') ||
    !Number.isSafeInteger(matrix?.baseline?.sourceFiles) ||
    matrix.baseline.sourceFiles < 1 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(matrix?.baseline?.auditedOn ?? '') ||
    matrix?.baseline?.timeZone !== 'America/Santiago'
  )
    fail('MATRIX_METADATA_INVALID', 'matrix');
  const baseline = matrix?.baseline ?? {};
  for (const [kind, count] of Object.entries(groups)) {
    const ids = list(catalog?.catalogs?.[kind]);
    if (ids.length !== count || new Set(ids).size !== count)
      fail('SOURCE_CATALOG_INVALID', kind);
  }
  const relations = list(catalog?.traceability);
  if (
    relations.length !== 27 ||
    new Set(relations.map((item) => item.rf)).size !== 27 ||
    relations.some(
      (r) =>
        r.rf !== `ALZ-RF-${r.number}` ||
        r.hu !== `ALZ-HU-${r.number}` ||
        r.cu !== `ALZ-CU-${r.number}` ||
        r.pt !== `ALZ-PT-${r.number}`,
    )
  )
    fail('TRACEABILITY_INVALID', 'catalog');
  const rfIds = new Set(relations.map((r) => r.rf));
  const evidenceById = new Map(),
    evidenceStates = {};
  for (const evidence of list(matrix?.evidence)) {
    const id = evidence?.id;
    if (!text(id) || evidenceById.has(id)) {
      fail('EVIDENCE_ID_INVALID', 'evidence');
      continue;
    }
    evidenceById.set(id, evidence);
    if (
      !onlyKeys(evidence, [
        'id',
        'path',
        'selector',
        'result',
        'environment',
        'provider',
        'candidate',
        'recordedAt',
        'provenance',
        'claim',
        'limitation',
        'sha256',
      ]) ||
      !outcomes.includes(evidence.result) ||
      !environments.includes(evidence.environment) ||
      !providers.includes(evidence.provider) ||
      !['record', 'report'].includes(evidence.provenance) ||
      !['historical', 'baseline', 'unverified'].includes(evidence.claim) ||
      !text(evidence.limitation) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(evidence.recordedAt ?? '') ||
      !digest.test(evidence.sha256 ?? '') ||
      !evidence.candidate ||
      (evidence.candidate.commit !== null &&
        !commit.test(evidence.candidate.commit ?? '')) ||
      (evidence.candidate.sourceDigest !== null &&
        !digest.test(evidence.candidate.sourceDigest ?? ''))
    )
      fail('EVIDENCE_METADATA_INVALID', id);
    if (
      ['AZURE', 'VERCEL'].includes(evidence.provider) &&
      evidence.environment !== 'REMOTE'
    )
      fail('PROVIDER_ENVIRONMENT_MISMATCH', id);
    if (evidence.environment === 'HUMAN' && evidence.result === 'passed')
      fail('HUMAN_ACCEPTANCE_NOT_RECORDED', id);
    if (
      evidence.environment === 'REMOTE' &&
      evidence.result === 'passed' &&
      evidence.provenance !== 'report'
    )
      fail('REMOTE_RESULT_REQUIRES_PROVIDER_REPORT', id);
    if (
      evidence.claim === 'baseline' &&
      (evidence.candidate?.sourceDigest !== baseline.sourceDigest ||
        evidence.provenance !== 'report')
    )
      fail('BASELINE_CLAIM_UNSUPPORTED', id);
    const content = await ref(
      evidence,
      id,
      evidence.path?.startsWith('.local/'),
    );
    evidenceStates[id] = content === null ? 'unavailable' : evidence.claim;
    if (content === null) continue;
    if (sha256(content) !== evidence.sha256) fail('EVIDENCE_HASH_MISMATCH', id);
    if (evidence.provenance === 'report') {
      let report;
      try {
        report = JSON.parse(content);
      } catch {
        fail('REPORT_INVALID', id);
        continue;
      }
      const hashes =
        report.sourceDigestBefore !== undefined
          ? [report.sourceDigestBefore, report.sourceDigestAfter]
          : [report.sourceDigest];
      const expectedDigest =
        evidence.claim === 'baseline'
          ? baseline.sourceDigest
          : evidence.candidate?.sourceDigest;
      if (expectedDigest && hashes.some((hash) => hash !== expectedDigest))
        fail('REPORT_CANDIDATE_MISMATCH', id);
      if (
        (report.environment !== undefined || evidence.claim === 'baseline') &&
        report.environment !== evidence.environment
      )
        fail('REPORT_ENVIRONMENT_MISMATCH', id);
      const observedProvider = String(
        report.provider ?? report.adapter ?? '',
      ).toUpperCase();
      if (
        (observedProvider && observedProvider !== evidence.provider) ||
        (evidence.environment === 'REMOTE' &&
          evidence.result === 'passed' &&
          (!['AZURE', 'VERCEL'].includes(evidence.provider) ||
            observedProvider !== evidence.provider))
      )
        fail('REPORT_PROVIDER_MISMATCH', id);
      const functionalOnly =
        report.increment === 'IMP-06.07' &&
        report.status === 'blocked' &&
        report.functionalStatus === 'passed' &&
        report.acceptanceStatus === 'blocked';
      if (
        evidence.result === 'passed' &&
        Array.isArray(report.cases) &&
        (!report.cases.length ||
          new Set(report.cases.map((item) => item?.id)).size !==
            report.cases.length ||
          report.cases.some(
            (item) => !text(item?.id) || item.status !== 'passed',
          ))
      )
        fail('REPORT_CASES_NOT_PASSED', id);
      if (
        evidence.result === 'passed' &&
        report.status !== 'passed' &&
        !functionalOnly
      )
        fail('REPORT_RESULT_MISMATCH', id);
    }
  }
  const entries = list(matrix?.entries),
    seen = new Set();
  const summary = Object.fromEntries(
    Object.keys(groups).map((kind) => [
      kind,
      { total: 0, complete: 0, partial: 0, absent: 0 },
    ]),
  );
  for (const row of entries) {
    const id = row?.id;
    if (
      !text(id) ||
      seen.has(id) ||
      !catalog?.catalogs?.[row?.kind]?.includes(id)
    ) {
      fail('ENTRY_ID_INVALID', text(id) ? id : 'entry');
      continue;
    }
    seen.add(id);
    summary[row.kind].total++;
    if (!['complete', 'partial', 'absent'].includes(row.coverage))
      fail('COVERAGE_INVALID', id);
    else summary[row.kind][row.coverage]++;
    if (
      !onlyKeys(row, [
        'id',
        'kind',
        'requirementIds',
        'source',
        'expected',
        'implementation',
        'coverage',
        'checks',
        'evidenceRefs',
        'gaps',
      ]) ||
      !text(row.expected) ||
      !Array.isArray(row.requirementIds) ||
      new Set(row.requirementIds).size !== row.requirementIds.length ||
      row.requirementIds.some((rf) => !rfIds.has(rf))
    )
      fail('ENTRY_METADATA_INVALID', id);
    if (
      row.kind === 'scenario' &&
      JSON.stringify(row.requirementIds) !==
        JSON.stringify([id.replace('HU', 'RF').replace(/-E\d$/, '')])
    )
      fail('SCENARIO_RELATION_INVALID', id);
    if (
      row.source?.path !== catalogPaths[row.kind] ||
      !row.source?.selector?.includes(id)
    )
      fail('NORMATIVE_REFERENCE_INVALID', id);
    await ref(row.source, id);
    if (
      !['implemented', 'partial', 'absent', 'not-assessed'].includes(
        row.implementation?.status,
      ) ||
      !Array.isArray(row.implementation?.refs)
    )
      fail('IMPLEMENTATION_INVALID', id);
    if (
      ['implemented', 'partial'].includes(row.implementation?.status) &&
      !row.implementation.refs.length
    )
      fail('IMPLEMENTATION_REFERENCE_MISSING', id);
    for (const reference of list(row.implementation?.refs))
      await ref(reference, id);
    if (
      !Array.isArray(row.checks) ||
      !Array.isArray(row.evidenceRefs) ||
      !Array.isArray(row.gaps)
    )
      fail('ENTRY_ARRAY_INVALID', id);
    if (row.coverage === 'complete' && !list(row.checks).length)
      fail('COMPLETE_WITHOUT_CHECKS', id);
    if (['partial', 'absent'].includes(row.coverage) && !list(row.gaps).length)
      fail('GAP_REQUIRED', id);
    for (const check of list(row.checks)) {
      if (
        !levels.includes(check.level) ||
        !environments.includes(check.environment) ||
        !providers.includes(check.provider) ||
        !text(check.verifies)
      )
        fail('CHECK_METADATA_INVALID', id);
      if (
        ['AZURE', 'VERCEL'].includes(check.provider) &&
        check.environment !== 'REMOTE'
      )
        fail('PROVIDER_ENVIRONMENT_MISMATCH', id);
      await ref(check, id);
      if (check.level === 'e2e') {
        const suite = e2eInventory.find((item) => item.spec === check.path);
        const literalIds =
          suite?.cases.filter((caseId) => check.selector.includes(caseId)) ??
          [];
        const caseIds = check.caseIds ?? literalIds;
        if (
          !suite ||
          !Array.isArray(caseIds) ||
          !caseIds.length ||
          new Set(caseIds).size !== caseIds.length ||
          caseIds.some((caseId) => !suite.cases.includes(caseId))
        )
          fail('E2E_CASE_UNKNOWN', id);
        else if (
          literalIds.length &&
          (literalIds.length !== caseIds.length ||
            literalIds.some((caseId) => !caseIds.includes(caseId)))
        )
          fail('E2E_SELECTOR_CASE_MISMATCH', id);
      }
    }
    for (const evidenceId of list(row.evidenceRefs))
      if (!evidenceById.has(evidenceId)) fail('EVIDENCE_REFERENCE_UNKNOWN', id);
    if (!list(row.evidenceRefs).length && !list(row.gaps).length)
      fail('EVIDENCE_OR_GAP_REQUIRED', id);
    for (const gap of list(row.gaps)) {
      if (
        !gapKinds.includes(gap.kind) ||
        !['critical', 'high', 'medium', 'low'].includes(gap.priority) ||
        !text(gap.description) ||
        !text(gap.action) ||
        !/^IMP-\d{2}(?:\.\d{2})?$/.test(gap.increment ?? '')
      )
        fail('GAP_INVALID', id);
      if (
        gap.kind === 'missing-test' &&
        (!gap.case ||
          ['actor', 'preconditions', 'action', 'expected'].some(
            (field) => !text(gap.case[field]),
          ) ||
          !levels.includes(gap.case.level))
      )
        fail('MISSING_TEST_UNSPECIFIED', id);
    }
  }
  for (const ids of Object.values(catalog?.catalogs ?? {}))
    for (const id of ids) if (!seen.has(id)) fail('ENTRY_MISSING', id);
  const requirements = relations.map(({ rf, hu, cu, pt }) => ({
    rf,
    hu,
    cu,
    pt,
    scenarios: entries
      .filter(
        (row) => row.kind === 'scenario' && row.requirementIds?.includes(rf),
      )
      .map(({ id, coverage }) => ({ id, coverage })),
  }));
  return {
    schemaVersion: 1,
    auditStatus: errors.length ? 'invalid' : 'consistent',
    exitCode: errors.length ? 1 : 0,
    acceptanceStatus: 'not-assessed',
    humanAcceptance: 'not-recorded',
    baseline,
    currentCandidate: currentCandidate ?? null,
    baselineMatchesCurrent:
      currentCandidate?.sourceDigest === baseline.sourceDigest,
    groups: summary,
    requirements,
    evidenceStates,
    gaps: entries.reduce((sum, row) => sum + list(row?.gaps).length, 0),
    errors,
    warnings,
  };
}

export async function inspectQualityCoverage(directory = root) {
  const readText = createCoverageReader(directory);
  const paths = [
    ...new Set([
      ...Object.values(catalogPaths),
      'specs/02-requisitos-funcionales.md',
    ]),
  ];
  const files = Object.fromEntries(
    await Promise.all(paths.map(async (path) => [path, await readText(path)])),
  );
  const matrix = JSON.parse(
    await readText('docs/work/IMP-07-coverage-matrix.json'),
  );
  return validateQualityCoverage(matrix, {
    catalog: parseQualityCatalog(files),
    readText,
    currentCandidate: await readCoverageCandidate(directory),
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 2) throw new Error('ARGUMENTS_UNSUPPORTED');
    const result = await inspectQualityCoverage();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.exitCode;
  } catch {
    console.error(
      JSON.stringify({
        auditStatus: 'invalid',
        acceptanceStatus: 'not-assessed',
        errors: [{ code: 'COVERAGE_INSPECTION_FAILED' }],
      }),
    );
    process.exitCode = 1;
  }
}
