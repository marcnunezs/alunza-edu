// Attach only: the operator starts/stops the TEST stack and SSH forwards.
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalHash } from '../tests/integration/linux-vm-api.mjs';
import {
  loadManifest,
  control,
  browserPlan,
  summarizeBrowser,
  validateBrowserRow,
  CASE_IDS,
  requireValue as check,
} from './linux-vm-browser-contract.mjs';

export async function browserTasks(m) {
  const rows = [],
    cases = [],
    proofs = new Map();
  await mkdir(m.outputDir, { recursive: false, mode: 0o700 });
  const initial = await control(m, 'inspect');
  check(
    canonicalHash(initial.candidate) === canonicalHash(m.candidate) &&
      initial.webSourceDigest === m.webSourceDigest &&
      initial.totals.active === 0 &&
      initial.totals.uncertain === 0,
    'BROWSER_INITIAL_IDENTITY',
  );
  const protocol = {
    schemaVersion: 1,
    campaignId: m.campaignId,
    candidate: m.candidate,
    webSourceDigest: m.webSourceDigest,
    plannedCases: CASE_IDS,
    plannedNormal: browserPlan(),
    targetMs: 5000,
    maximumVms: 1,
    concurrency: 1,
    clock: 'AUT_PERFORMANCE_NOW_ACTIVATION_THROUGH_CORRELATED_RESULT_RENDERED',
    startupExcluded: true,
    hostPageCacheFlushed: false,
    transport: 'SSH_LOOPBACK_FORWARD_LAN',
    phaseContextExecuted: false,
  };
  await writeFile(
    join(m.outputDir, 'protocol.json'),
    JSON.stringify(protocol, null, 2) + '\n',
    { mode: 0o600 },
  );
  const tasks = {
    'physical:prepare': async (scope) => {
      if (scope === 'NORMAL')
        check(
          cases.length === 8 && cases.every((c) => c.pass),
          'FUNCTIONAL_GATE_FAILED',
        );
      return control(m, 'prepare', { scope });
    },
    'physical:login': (input) => control(m, 'login', input),
    'physical:membership': (input) => control(m, 'membership', input),
    'physical:snapshot': (scope) => control(m, 'snapshot', { scope }),
    'physical:verify': async (input) => {
      const proof = await control(m, 'verify', input);
      proofs.set(proof.executionId, {
        ...proof,
        actorId: input.actorId,
        mode: input.mode,
      });
      return proof;
    },
    'physical:absent': (input) => control(m, 'absent', input),
    'physical:holdStart': (input) => control(m, 'hold-start', input),
    'physical:holdFinish': () => control(m, 'hold-finish'),
    'physical:close': (scope) => control(m, 'close', { scope }),
    'physical:case': async (row) => {
      check(
        CASE_IDS.includes(row.id) &&
          typeof row.pass === 'boolean' &&
          !cases.some((c) => c.id === row.id),
        'CASE_RECEIPT',
      );
      cases.push({ id: row.id, pass: row.pass });
      await appendFile(
        join(m.outputDir, 'cases.jsonl'),
        JSON.stringify(cases.at(-1)) + '\n',
        { mode: 0o600 },
      );
      return null;
    },
    'physical:row': async (row) => {
      validateBrowserRow(row);
      check(!rows.some((r) => r.id === row.id), 'DUPLICATE_BROWSER_SAMPLE');
      if (row.pass) {
        const proof = proofs.get(row.executionId);
        check(
          proof &&
            proof.requestId === row.requestId &&
            proof.attemptId === row.attemptId &&
            proof.actorId === row.actorId &&
            proof.mode === row.mode &&
            proof.observationSha256 === row.observationSha256,
          'ROW_WITHOUT_DURABLE_PROOF',
        );
      }
      rows.push(row);
      await appendFile(
        join(m.outputDir, 'requests.jsonl'),
        JSON.stringify(row) + '\n',
        { mode: 0o600 },
      );
      return null;
    },
  };
  return {
    tasks,
    async finish(testResult) {
      const final = await control(m, 'inspect'),
        summary = summarizeBrowser(rows, cases);
      const retired =
        final.totals.active === 0 &&
        final.totals.uncertain === 0 &&
        final.ledger.pending === 0 &&
        final.records.every((r) => r.state === 'CLOSED' && r.cleanupVerified);
      if (retired && rows.length > 0)
        await control(m, 'close', { scope: 'NORMAL' });
      const result = {
        ...summary,
        campaignId: m.campaignId,
        candidate: m.candidate,
        webSourceDigest: m.webSourceDigest,
        initial,
        final,
        retirementVerified: retired,
        cypress: {
          totalTests: testResult.totalTests,
          failed: testResult.totalFailed,
          passed: testResult.totalPassed,
          pending: testResult.totalPending,
          skipped: testResult.totalSkipped,
        },
        pass:
          summary.pass &&
          retired &&
          testResult.totalTests === 48 &&
          testResult.totalPassed === 48 &&
          testResult.totalFailed === 0 &&
          testResult.totalPending === 0 &&
          testResult.totalSkipped === 0,
      };
      await writeFile(
        join(m.outputDir, 'summary.json'),
        JSON.stringify(result, null, 2) + '\n',
        { mode: 0o600 },
      );
      return result;
    },
  };
}
export async function runBrowser(manifestPath) {
  const m = await loadManifest(manifestPath),
    cypress = (await import('cypress')).default;
  process.env.ALUNZA_PHYSICAL_MANIFEST = resolve(manifestPath);
  const result = await cypress.run({
    configFile: resolve('tests/e2e/physical/cypress.config.cjs'),
    browser: 'chrome',
    headless: true,
    record: false,
  });
  // setupNodeEvents writes the authoritative summary; the Cypress exit is an
  // additional gate, never sufficient to accept omitted/missing measurements.
  check(
    !('failures' in result) &&
      result.totalTests === 48 &&
      result.totalPassed === 48 &&
      result.totalFailed === 0,
    'BROWSER_CAMPAIGN_FAILED',
  );
  const { readFile } = await import('node:fs/promises');
  const summary = JSON.parse(
    await readFile(join(m.outputDir, 'summary.json'), 'utf8'),
  );
  check(summary.pass === true, 'BROWSER_EVIDENCE_FAILED');
  console.log(
    JSON.stringify({
      status: 'passed',
      scope: summary.scope,
      latency: summary.latency,
    }),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    check(
      process.argv.length === 4 && process.argv[2] === '--manifest',
      'USAGE_MANIFEST',
    );
    await runBrowser(process.argv[3]);
  } catch {
    console.error(
      'PHYSICAL_BROWSER_FAILED: inspect private sanitized receipts.',
    );
    process.exitCode = 1;
  }
}
