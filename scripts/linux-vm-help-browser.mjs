// Attach-only physical TEST help profile. No service starts on import.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalHash } from '../tests/integration/linux-vm-api.mjs';
import { UUID, HASH } from './linux-vm-browser-contract.mjs';
import {
  HELP_CASE_IDS,
  loadHelpManifest,
  validateHelpManifest,
  control,
  requireValue as check,
} from './linux-vm-help-contract.mjs';

const expected = {
  H01: [['SUPPORTED', 'FEEDBACK', null]],
  H02: [['NO_EVIDENCE', 'HINT', 1]],
  H03: [
    ['PROVIDER_UNAVAILABLE', 'HINT', 1],
    ['SUPPORTED', 'HINT', 1],
  ],
};
const same = (a, b) =>
  a !== undefined && b !== undefined && canonicalHash(a) === canonicalHash(b);
const unique = (rows, field) =>
  new Set(rows.map((row) => row[field])).size === rows.length;
function retired(snapshot) {
  return (
    snapshot?.totals?.active === 0 &&
    snapshot?.totals?.uncertain === 0 &&
    snapshot?.ledger?.pending === 0 &&
    Array.isArray(snapshot?.records) &&
    snapshot.records.every(
      (row) => row.state === 'CLOSED' && row.cleanupVerified === true,
    )
  );
}
function classifiedProviderCalls(row) {
  const phases =
    row.status === 'SUPPORTED'
      ? ['EMBEDDING', 'GENERATION', 'REVIEW']
      : row.status === 'NO_EVIDENCE'
        ? ['EMBEDDING']
        : ['EMBEDDING', 'GENERATION'];
  return (
    Array.isArray(row.providerCalls) &&
    row.providerCalls.length === phases.length &&
    phases.every(
      (phase) =>
        row.providerCalls.filter(
          (call) =>
            call.phase === phase &&
            call.provider === 'TEST' &&
            call.state ===
              (row.status === 'PROVIDER_UNAVAILABLE' && phase === 'GENERATION'
                ? 'DISPATCHED'
                : 'COMPLETED'),
        ).length === 1,
    )
  );
}
export function summarizeHelpBrowser({
  m,
  initial,
  finished,
  cases,
  attempts,
  helps,
  retries,
  cypress,
}) {
  const failures = [];
  const gate = (value, code) => {
    if (!value) failures.push(code);
  };
  const final = finished?.final;
  gate(
    initial &&
      final &&
      same(initial.candidate, m.candidate) &&
      same(final.candidate, m.candidate) &&
      initial.webSourceDigest === m.webSourceDigest &&
      final.webSourceDigest === m.webSourceDigest,
    'CANDIDATE_CHANGED',
  );
  gate(
    retired(initial) &&
      retired(final) &&
      finished?.pass === true &&
      finished.scopesClosed === 3,
    'RETIREMENT_UNVERIFIED',
  );
  gate(
    Number.isSafeInteger(initial?.totals?.qemuStarted) &&
      Number.isSafeInteger(final?.totals?.qemuStarted) &&
      final.totals.qemuStarted - initial.totals.qemuStarted === 6,
    'SIX_VMS_REQUIRED',
  );
  gate(
    cases.length === 3 &&
      HELP_CASE_IDS.every(
        (id) =>
          cases.filter((row) => row.id === id && row.pass === true).length ===
          1,
      ),
    'CASES_INCOMPLETE',
  );
  gate(
    attempts.length === 6 &&
      unique(attempts, 'attemptId') &&
      unique(attempts, 'executionId') &&
      attempts.every(
        (row) =>
          row.pass === true &&
          UUID.test(row.attemptId) &&
          UUID.test(row.executionId) &&
          UUID.test(row.requestId) &&
          HASH.test(row.observationSha256) &&
          HASH.test(row.technicalResultSha256),
      ),
    'ATTEMPT_PROOFS_INVALID',
  );
  gate(
    helps.length === 4 &&
      unique(helps, 'requestId') &&
      unique(helps, 'feedbackId'),
    'HELP_PROOFS_INCOMPLETE',
  );
  gate(retries.length === 3, 'RETRY_PROOFS_INCOMPLETE');
  for (const scope of HELP_CASE_IDS) {
    const saved = attempts.filter((row) => row.scope === scope);
    gate(
      saved.length === 2 &&
        saved[0]?.diagnosis === 'FAILED_TEST' &&
        saved[1]?.diagnosis === 'SUCCESS',
      `ATTEMPT_SEQUENCE_${scope}`,
    );
    const support = helps.filter((row) => row.scope === scope);
    gate(
      support.length === expected[scope].length &&
        support.every((row, index) => {
          const [status, kind, hintLevel] = expected[scope][index];
          return (
            row.pass === true &&
            row.attemptId === saved[0]?.attemptId &&
            UUID.test(row.requestId) &&
            UUID.test(row.feedbackId) &&
            row.status === status &&
            row.kind === kind &&
            row.hintLevel === hintLevel &&
            classifiedProviderCalls(row) &&
            Array.isArray(row.sourceRefs) &&
            row.sourceRefs.length === row.sourceCount &&
            row.sourceRefs.every(
              (ref) =>
                UUID.test(ref.source_id) &&
                UUID.test(ref.source_version_id) &&
                UUID.test(ref.chunk_id) &&
                typeof ref.locator === 'string' &&
                ref.locator.length > 0,
            ) &&
            row.technicalResultSha256 === saved[0]?.technicalResultSha256 &&
            (status === 'SUPPORTED'
              ? Number.isInteger(row.sourceCount) &&
                row.sourceCount > 0 &&
                row.viewedCount === 1
              : row.sourceCount === 0 && row.viewedCount === 0)
          );
        }),
      `HELP_SEQUENCE_${scope}`,
    );
    const retry = retries.filter((row) => row.scope === scope);
    gate(
      retry.length === 1 &&
        retry[0]?.pass === true &&
        retry[0].firstAttemptId === saved[0]?.attemptId &&
        retry[0].retryAttemptId === saved[1]?.attemptId &&
        retry[0].firstAttemptId !== retry[0].retryAttemptId,
      `RETRY_SEQUENCE_${scope}`,
    );
  }
  gate(
    cypress?.totalTests === 3 &&
      cypress.totalPassed === 3 &&
      cypress.totalFailed === 0 &&
      cypress.totalPending === 0 &&
      cypress.totalSkipped === 0,
    'CYPRESS_INCOMPLETE',
  );
  return {
    schemaVersion: 1,
    profile: 'PHYSICAL_HELP_TEST',
    campaignId: m.campaignId,
    candidate: m.candidate,
    webSourceDigest: m.webSourceDigest,
    provider: 'TEST',
    azureValidated: false,
    latencyPercentileClaimed: false,
    pass: failures.length === 0,
    failures,
    cases,
    attempts,
    helps,
    retries,
    initial,
    final: final ?? null,
    scopesClosed: finished?.scopesClosed ?? 0,
    cypress: cypress ?? null,
  };
}

export async function helpBrowserTasks(m, { request = control } = {}) {
  validateHelpManifest(m);
  const cases = [],
    attempts = [],
    helps = [],
    retries = [];
  await mkdir(m.outputDir, { recursive: false, mode: 0o700 });
  const record = (name, row) =>
    appendFile(join(m.outputDir, name + '.jsonl'), JSON.stringify(row) + '\n', {
      mode: 0o600,
    });
  const initial = await request(m, 'inspect');
  check(
    same(initial.candidate, m.candidate) &&
      initial.webSourceDigest === m.webSourceDigest &&
      retired(initial),
    'HELP_BROWSER_INITIAL_IDENTITY',
  );
  await writeFile(
    join(m.outputDir, 'protocol.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        profile: m.profile,
        campaignId: m.campaignId,
        candidate: m.candidate,
        webSourceDigest: m.webSourceDigest,
        provider: 'TEST',
        azureValidated: false,
        plannedCases: HELP_CASE_IDS,
        plannedSubmissions: 6,
        plannedHelpRequests: 4,
        maximumVms: 1,
        concurrency: 1,
        latencyPercentileClaimed: false,
        transport: 'SSH_LOOPBACK_FORWARD_LAN',
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  const proofTask = (action, list, file, project) => async (input) => {
    try {
      const proof = await request(m, action, input);
      check(proof?.pass === true, 'HELP_BROWSER_PROOF_REJECTED');
      const row = { scope: input.scope, ...project(proof, input) };
      list.push(row);
      await record(file, row);
      return proof;
    } catch {
      await record('failures', {
        scope: input?.scope ?? null,
        action,
        code: 'CONTROL_PROOF_FAILED',
      });
      throw new Error('HELP_BROWSER_CONTROL_PROOF_FAILED');
    }
  };
  const tasks = {
    'physicalHelp:prepare': (input) => request(m, 'prepare', input),
    'physicalHelp:login': (input) => request(m, 'login', input),
    'physicalHelp:fault': (input) => request(m, 'fault', input),
    'physicalHelp:close': (input) => request(m, 'close', input),
    'physicalHelp:verifyAttempt': proofTask(
      'verify-attempt',
      attempts,
      'attempts',
      (proof) => ({
        pass: proof.pass,
        attemptId: proof.attemptId,
        executionId: proof.executionId,
        requestId: proof.requestId,
        diagnosis: proof.diagnosis,
        observationSha256: proof.observationSha256,
        technicalResultSha256: proof.technicalResultSha256,
      }),
    ),
    'physicalHelp:verifyHelp': proofTask(
      'verify-help',
      helps,
      'helps',
      (proof, input) => ({
        pass: proof.pass,
        attemptId: input.attemptId,
        requestId: proof.requestId,
        feedbackId: proof.feedbackId,
        status: proof.status,
        kind: proof.kind,
        hintLevel: proof.hintLevel,
        sourceCount: proof.sourceCount,
        viewedCount: proof.viewedCount,
        technicalResultSha256: proof.technicalResultSha256,
        sourceRefs: proof.sourceRefs?.map(
          ({ source_id, source_version_id, chunk_id, locator }) => ({
            source_id,
            source_version_id,
            chunk_id,
            locator,
          }),
        ),
        providerCalls: proof.providerCalls?.map(
          ({ provider, phase, state }) => ({ provider, phase, state }),
        ),
      }),
    ),
    'physicalHelp:verifyRetry': proofTask(
      'verify-retry',
      retries,
      'retries',
      (proof) => ({
        pass: proof.pass,
        firstAttemptId: proof.firstAttemptId,
        retryAttemptId: proof.retryAttemptId,
      }),
    ),
    'physicalHelp:case': async (row) => {
      check(
        HELP_CASE_IDS.includes(row?.id) &&
          typeof row.pass === 'boolean' &&
          !cases.some((item) => item.id === row.id),
        'HELP_BROWSER_CASE_REJECTED',
      );
      cases.push({ id: row.id, pass: row.pass });
      await record('cases', cases.at(-1));
      return null;
    },
  };
  let finishPromise;
  return {
    tasks,
    finish(testResult) {
      finishPromise ??= (async () => {
        let finished;
        try {
          finished = await request(m, 'finish');
        } catch {
          await record('failures', {
            action: 'finish',
            code: 'CONTROL_FINISH_FAILED',
          });
        }
        const summary = summarizeHelpBrowser({
          m,
          initial,
          finished,
          cases,
          attempts,
          helps,
          retries,
          cypress: testResult
            ? {
                totalTests: testResult.totalTests,
                totalPassed: testResult.totalPassed,
                totalFailed: testResult.totalFailed,
                totalPending: testResult.totalPending,
                totalSkipped: testResult.totalSkipped,
              }
            : null,
        });
        await writeFile(
          join(m.outputDir, 'summary.json'),
          JSON.stringify(summary, null, 2) + '\n',
          { flag: 'wx', mode: 0o600 },
        );
        return summary;
      })();
      return finishPromise;
    },
  };
}

export async function finishHelpBrowserIfUnreported(
  m,
  { request = control } = {},
) {
  try {
    await readFile(join(m.outputDir, 'summary.json'), 'utf8');
    return null;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  let finishConfirmed = false;
  try {
    finishConfirmed = (await request(m, 'finish'))?.pass === true;
  } catch {
    /* The controller's shutdown owns partial fixture retirement. */
  }
  return {
    profile: m.profile,
    campaignId: m.campaignId,
    pass: false,
    code: 'CYPRESS_WITHOUT_SUMMARY',
    finishConfirmed,
  };
}
export async function runHelpBrowser(manifestPath) {
  const m = await loadHelpManifest(manifestPath);
  process.env.ALUNZA_PHYSICAL_HELP_MANIFEST = resolve(manifestPath);
  let result;
  try {
    const cypress = (await import('cypress')).default;
    result = await cypress.run({
      configFile: resolve('tests/e2e/physical-help/cypress.config.cjs'),
      browser: 'chrome',
      headless: true,
      record: false,
    });
  } finally {
    const unreported = await finishHelpBrowserIfUnreported(m);
    if (unreported) console.error(JSON.stringify(unreported));
  }
  check(
    !('failures' in result) &&
      result.totalTests === 3 &&
      result.totalPassed === 3 &&
      result.totalFailed === 0,
    'HELP_BROWSER_CAMPAIGN_FAILED',
  );
  const summary = JSON.parse(
    await readFile(join(m.outputDir, 'summary.json'), 'utf8'),
  );
  check(summary.pass === true, 'HELP_BROWSER_SUMMARY_FAILED');
  console.log(
    JSON.stringify({
      profile: m.profile,
      pass: true,
      tests: 3,
      attempts: 6,
      helps: 4,
      provider: 'TEST',
      outputDir: m.outputDir,
    }),
  );
  return summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--manifest') {
    console.error('HELP_BROWSER_MANIFEST_REQUIRED');
    process.exitCode = 1;
  } else
    runHelpBrowser(args[1]).catch(() => {
      console.error('HELP_BROWSER_CAMPAIGN_FAILED');
      process.exitCode = 1;
    });
}
