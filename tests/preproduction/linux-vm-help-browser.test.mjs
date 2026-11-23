import { describe, it, expect, jest } from '@jest/globals';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { ENDPOINTS } from '../../scripts/linux-vm-browser-contract.mjs';
import { HELP_CASE_IDS } from '../../scripts/linux-vm-help-contract.mjs';
import {
  helpBrowserTasks,
  summarizeHelpBrowser,
  finishHelpBrowserIfUnreported,
} from '../../scripts/linux-vm-help-browser.mjs';

const id = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = 'a'.repeat(64);
const candidate = {
  runnerVersion: 'imp-03-quickjs.13',
  capsuleImageId:
    'sha256:1f12d0fb7fb18f6e2668669b3b5da37be47fcc71120f7579dbe32155ad5846b0',
  runnerSourceDigest:
    '4782224f79163235b3f554b140b2ca40750b51b42dc61695964f7fca3f788fa3',
  kitManifestSha256: hash,
  guestSha256: hash,
  apiSourceDigest: hash,
  brokerSha256: hash,
};
function fixture(outputDir = resolve('.local/offline-help-fixture-only')) {
  const m = {
    schemaVersion: 1,
    profile: 'PHYSICAL_HELP_TEST',
    campaignId: id(1),
    candidate,
    webSourceDigest: hash,
    endpoints: ENDPOINTS,
    controlKey: hash,
    outputDir,
    statePath: '/private/state.json',
    brokerSocket: '/private/broker.sock',
    artifactRoot: '/home/alunza/laboratorio/source/workspace',
    controlDir: '/home/alunza/laboratorio/help/control',
    faultPath: '/home/alunza/laboratorio/help/fault.json',
    scopesPath: '/home/alunza/laboratorio/help/scopes.json',
    providerObservationsPath: '/home/alunza/laboratorio/help/provider.jsonl',
  };
  const snapshot = (qemuStarted) => ({
    candidate,
    webSourceDigest: hash,
    totals: { qemuStarted, active: 0, uncertain: 0 },
    ledger: { pending: 0 },
    records: [{ state: 'CLOSED', cleanupVerified: true }],
  });
  const attempts = HELP_CASE_IDS.flatMap((scope, index) =>
    [0, 1].map((retry) => ({
      scope,
      pass: true,
      attemptId: id(10 + index * 2 + retry),
      executionId: id(20 + index * 2 + retry),
      requestId: id(30 + index * 2 + retry),
      diagnosis: retry ? 'SUCCESS' : 'FAILED_TEST',
      observationSha256: hash,
      technicalResultSha256: hash,
    })),
  );
  const helps = [
    ['H01', 'SUPPORTED', 'FEEDBACK', null],
    ['H02', 'NO_EVIDENCE', 'HINT', 1],
    ['H03', 'PROVIDER_UNAVAILABLE', 'HINT', 1],
    ['H03', 'SUPPORTED', 'HINT', 1],
  ].map(([scope, status, kind, hintLevel], i) => ({
    scope,
    pass: true,
    attemptId: attempts.find((row) => row.scope === scope).attemptId,
    requestId: id(40 + i),
    feedbackId: id(50 + i),
    status,
    kind,
    hintLevel,
    sourceCount: status === 'SUPPORTED' ? 1 : 0,
    viewedCount: status === 'SUPPORTED' ? 1 : 0,
    technicalResultSha256: hash,
    sourceRefs:
      status === 'SUPPORTED'
        ? [
            {
              source_id: id(70 + i),
              source_version_id: id(80 + i),
              chunk_id: id(90 + i),
              locator: 'Líneas 1–2',
            },
          ]
        : [],
    providerCalls: (status === 'SUPPORTED'
      ? ['EMBEDDING', 'GENERATION', 'REVIEW']
      : status === 'NO_EVIDENCE'
        ? ['EMBEDDING']
        : ['EMBEDDING', 'GENERATION']
    ).map((phase) => ({
      provider: 'TEST',
      phase,
      state:
        status === 'PROVIDER_UNAVAILABLE' && phase === 'GENERATION'
          ? 'DISPATCHED'
          : 'COMPLETED',
    })),
  }));
  return {
    m,
    initial: snapshot(60),
    finished: { pass: true, final: snapshot(66), scopesClosed: 3 },
    cases: HELP_CASE_IDS.map((id) => ({ id, pass: true })),
    attempts,
    helps,
    retries: HELP_CASE_IDS.map((scope) => ({
      scope,
      pass: true,
      firstAttemptId: attempts.find((row) => row.scope === scope).attemptId,
      retryAttemptId: attempts.find(
        (row) => row.scope === scope && row.diagnosis === 'SUCCESS',
      ).attemptId,
    })),
    cypress: {
      totalTests: 3,
      totalPassed: 3,
      totalFailed: 0,
      totalPending: 0,
      totalSkipped: 0,
    },
  };
}
async function temporary(body) {
  const base = resolve(await mkdtemp(join(tmpdir(), 'alunza-help-browser-')));
  const within = relative(resolve(tmpdir()), base);
  if (!within || within.startsWith('..') || isAbsolute(within))
    throw new Error('TEMP_PATH_UNSAFE');
  try {
    return await body(join(base, 'evidence'));
  } finally {
    await rm(base, { recursive: true });
  }
}
describe('physical help evidence gate without services or network', () => {
  it('attempts finish when Cypress produces no summary and keeps missing evidence a failure', async () =>
    temporary(async (outputDir) => {
      const f = fixture(outputDir),
        request = jest.fn(async () => {
          throw new Error('PRIVATE_TOKEN');
        });
      expect(await finishHelpBrowserIfUnreported(f.m, { request })).toEqual({
        profile: f.m.profile,
        campaignId: f.m.campaignId,
        pass: false,
        code: 'CYPRESS_WITHOUT_SUMMARY',
        finishConfirmed: false,
      });
      expect(request).toHaveBeenCalledWith(f.m, 'finish');
      const harness = await helpBrowserTasks(f.m, {
        request: async (_m, action) =>
          action === 'inspect' ? f.initial : f.finished,
      });
      await harness.finish(f.cypress);
      expect(await finishHelpBrowserIfUnreported(f.m, { request })).toBeNull();
      expect(request).toHaveBeenCalledTimes(1);
    }));
  it('accepts exactly three cases, six new VMs and four correctly classified helps without claiming Azure or latency percentiles', () => {
    const summary = summarizeHelpBrowser(fixture());
    expect(summary).toMatchObject({
      pass: true,
      provider: 'TEST',
      azureValidated: false,
      latencyPercentileClaimed: false,
      failures: [],
    });
    expect(summary.attempts).toHaveLength(6);
    expect(summary.helps).toHaveLength(4);
  });
  it('keeps failed, absent, duplicate and skipped cases as failed campaigns', () => {
    for (const change of [
      (f) => {
        f.cases[0].pass = false;
      },
      (f) => {
        f.cases.pop();
      },
      (f) => {
        f.cases[2].id = 'H01';
      },
      (f) => {
        f.cypress.totalSkipped = 1;
        f.cypress.totalPassed = 2;
      },
    ]) {
      const f = fixture();
      change(f);
      expect(summarizeHelpBrowser(f).pass).toBe(false);
    }
  });
  it('rejects missing persistence proof, duplicate attempt/execution IDs and a retry that overwrites the first attempt', () => {
    for (const change of [
      (f) => {
        f.attempts.pop();
      },
      (f) => {
        f.attempts[1].attemptId = f.attempts[0].attemptId;
      },
      (f) => {
        f.attempts[1].executionId = f.attempts[0].executionId;
      },
      (f) => {
        f.attempts[0].observationSha256 = null;
      },
      (f) => {
        f.retries[0].retryAttemptId = f.retries[0].firstAttemptId;
      },
    ]) {
      const f = fixture();
      change(f);
      expect(summarizeHelpBrowser(f).pass).toBe(false);
    }
  });
  it('requires supported sources and one ACK, never an ACK or fabricated source during degradation', () => {
    for (const [index, field, value] of [
      [0, 'sourceCount', 0],
      [0, 'viewedCount', 2],
      [1, 'sourceCount', 1],
      [2, 'viewedCount', 1],
    ]) {
      const f = fixture();
      f.helps[index][field] = value;
      expect(summarizeHelpBrowser(f).pass).toBe(false);
    }
  });
  it('rejects a changed technical diagnosis, an unrelated attempt, consumed hint level and reused recovery request', () => {
    for (const change of [
      (f) => {
        f.helps[0].technicalResultSha256 = 'b'.repeat(64);
      },
      (f) => {
        f.helps[0].attemptId = f.attempts[1].attemptId;
      },
      (f) => {
        f.helps[3].hintLevel = 2;
      },
      (f) => {
        f.helps[3].requestId = f.helps[2].requestId;
      },
      (f) => {
        f.helps[3].kind = 'FEEDBACK';
      },
      (f) => {
        f.helps[0].sourceRefs = [];
      },
      (f) => {
        f.helps[0].providerCalls[0].provider = 'AZURE_OPENAI';
      },
      (f) => {
        f.helps[2].providerCalls[1].state = 'COMPLETED';
      },
    ]) {
      const f = fixture();
      change(f);
      expect(summarizeHelpBrowser(f).pass).toBe(false);
    }
  });
  it('rejects changed source pins, missing or uncertain retirement, extra VMs and pending leases', () => {
    for (const change of [
      (f) => {
        f.finished.final.candidate = undefined;
      },
      (f) => {
        f.finished.final.webSourceDigest = 'b'.repeat(64);
      },
      (f) => {
        f.finished = undefined;
      },
      (f) => {
        f.finished.final.totals.uncertain = 1;
      },
      (f) => {
        f.finished.final.records[0].cleanupVerified = false;
      },
      (f) => {
        f.finished.final.totals.qemuStarted++;
      },
      (f) => {
        f.finished.final.ledger.pending = 1;
      },
      (f) => {
        f.finished.scopesClosed = 2;
      },
    ]) {
      const f = fixture();
      change(f);
      expect(summarizeHelpBrowser(f).pass).toBe(false);
    }
  });
  it('projects public evidence, excludes raw request/session/hidden data and finishes once after failed Cypress', async () =>
    temporary(async (outputDir) => {
      const f = fixture(outputDir);
      const request = jest.fn(async (_m, action, input) => {
        if (action === 'inspect') return f.initial;
        if (action === 'finish') return f.finished;
        if (action === 'verify-attempt')
          return {
            ...f.attempts.find((row) => row.attemptId === input.attemptId),
            token: 'PRIVATE_TOKEN',
            body: 'HIDDEN_BODY',
          };
        if (action === 'verify-help')
          return f.helps.find((row) => row.requestId === input.requestId);
        if (action === 'verify-retry')
          return f.retries.find((row) => row.scope === input.scope);
        throw new Error('unplanned operation');
      });
      const harness = await helpBrowserTasks(f.m, { request });
      for (const row of f.attempts)
        await harness.tasks['physicalHelp:verifyAttempt']({
          ...row,
          payload: { private: 'PRIVATE_PAYLOAD' },
        });
      for (const row of f.helps)
        await harness.tasks['physicalHelp:verifyHelp'](row);
      for (const row of f.retries)
        await harness.tasks['physicalHelp:verifyRetry'](row);
      for (const row of f.cases) await harness.tasks['physicalHelp:case'](row);
      const summary = await harness.finish({
        ...f.cypress,
        totalPassed: 2,
        totalFailed: 1,
      });
      expect(summary.pass).toBe(false);
      expect(await harness.finish(f.cypress)).toBe(summary);
      expect(
        request.mock.calls.filter((call) => call[1] === 'finish'),
      ).toHaveLength(1);
      const text = (
        await Promise.all(
          (await readdir(outputDir)).map((file) =>
            readFile(join(outputDir, file), 'utf8'),
          ),
        )
      ).join('\n');
      for (const forbidden of [
        'PRIVATE_',
        'HIDDEN_',
        'controlKey',
        'access_token',
        'refresh_token',
      ])
        expect(text).not.toContain(forbidden);
      expect(
        JSON.parse(await readFile(join(outputDir, 'summary.json'), 'utf8'))
          .failures,
      ).toContain('CYPRESS_INCOMPLETE');
    }));
  it('preserves a sanitized failure and a failed summary when control or retirement verification fails', async () =>
    temporary(async (outputDir) => {
      const f = fixture(outputDir);
      const request = jest.fn(async (_m, action) => {
        if (action === 'inspect') return f.initial;
        throw new Error('PRIVATE_TOKEN');
      });
      const harness = await helpBrowserTasks(f.m, { request });
      await expect(
        harness.tasks['physicalHelp:verifyAttempt']({ scope: 'H01' }),
      ).rejects.toThrow('HELP_BROWSER_CONTROL_PROOF_FAILED');
      const summary = await harness.finish({
        totalTests: 3,
        totalPassed: 0,
        totalFailed: 1,
        totalPending: 0,
        totalSkipped: 2,
      });
      expect(summary.pass).toBe(false);
      expect(summary.final).toBeNull();
      const failures = await readFile(
        join(outputDir, 'failures.jsonl'),
        'utf8',
      );
      expect(failures).toContain('CONTROL_PROOF_FAILED');
      expect(failures).toContain('CONTROL_FINISH_FAILED');
      expect(failures).not.toContain('PRIVATE_TOKEN');
      expect(
        JSON.parse(await readFile(join(outputDir, 'summary.json'), 'utf8'))
          .pass,
      ).toBe(false);
    }));
  it('rejects duplicate case claims and refuses to overwrite an evidence directory', async () =>
    temporary(async (outputDir) => {
      const f = fixture(outputDir),
        request = async () => f.initial;
      const harness = await helpBrowserTasks(f.m, { request });
      await harness.tasks['physicalHelp:case']({ id: 'H01', pass: false });
      await expect(
        harness.tasks['physicalHelp:case']({ id: 'H01', pass: true }),
      ).rejects.toThrow('CASE_REJECTED');
      await expect(helpBrowserTasks(f.m, { request })).rejects.toThrow();
      expect(await readFile(join(outputDir, 'cases.jsonl'), 'utf8')).toBe(
        '{"id":"H01","pass":false}\n',
      );
    }));
});
