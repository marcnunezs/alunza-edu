const { defineConfig } = require('cypress');
const { resolve, relative, isAbsolute } = require('node:path');
const { writeFileSync } = require('node:fs');
module.exports = defineConfig({
  video: false,
  screenshotOnRunFailure: false,
  numTestsKeptInMemory: 0,
  retries: 0,
  viewportWidth: 1280,
  viewportHeight: 900,
  defaultCommandTimeout: 15000,
  requestTimeout: 15000,
  responseTimeout: 45000,
  reporter: 'dot',
  fixturesFolder: false,
  screenshotsFolder: '.local/reports/imp-03-07/browser-disabled-screenshots',
  downloadsFolder: '.local/reports/imp-03-07/browser-disabled-downloads',
  e2e: {
    specPattern: 'tests/remote-sandbox/browser-vertical.cy.ts',
    supportFile: false,
    testIsolation: true,
    async setupNodeEvents(on, config) {
      const {
        readBrowserFixture,
        browserObservationSchema,
        browserCaseIds,
        planBrowserStage,
      } = await import('../../scripts/sandbox-browser-campaign.mjs');
      let stage;
      try {
        stage = JSON.parse(process.env.ALUNZA_SANDBOX_BROWSER_STAGE);
      } catch {
        throw new Error('BROWSER_CAMPAIGN_REQUIRED');
      }
      const plan = planBrowserStage(stage);
      const runId = process.env.ALUNZA_SANDBOX_BROWSER_RUN_ID;
      const reportPath = resolve(
        process.env.ALUNZA_SANDBOX_BROWSER_REPORT ?? '',
      );
      const relativePath = relative(
        resolve('.local/reports/imp-03-07'),
        reportPath,
      );
      if (
        plan.blockers.length ||
        !/^[a-f0-9-]{36}$/.test(runId ?? '') ||
        relativePath.startsWith('..') ||
        isAbsolute(relativePath) ||
        !relativePath.endsWith(`browser-${runId}.json`)
      )
        throw new Error('BROWSER_CAMPAIGN_REQUIRED');
      const deadline = Number(process.env.ALUNZA_SANDBOX_BROWSER_DEADLINE);
      if (!Number.isFinite(deadline) || deadline <= Date.now())
        throw new Error('BROWSER_CAMPAIGN_EXPIRED');
      const approvedReleaseId =
        process.env.ALUNZA_SANDBOX_BROWSER_APPROVED_RELEASE_ID;
      if (!/^[a-f0-9]{40}$/.test(approvedReleaseId ?? ''))
        throw new Error('BROWSER_APPROVED_RELEASE_REQUIRED');
      config.baseUrl = stage.config.webOrigin;
      config.env = {
        remoteSandboxFixture: await readBrowserFixture(stage),
        browserDeadline: deadline,
        clientRequestBudget: plan.clientRequests,
        approvedReleaseId,
      };
      const observations = [];
      on('task', {
        'remoteSandbox:record'(value) {
          const parsed = browserObservationSchema.safeParse(value);
          if (
            !parsed.success ||
            observations.some((item) => item.id === parsed.data.id) ||
            Date.now() >= deadline
          )
            throw new Error('INVALID_BROWSER_OBSERVATION');
          observations.push(parsed.data);
          return null;
        },
      });
      on('after:run', (result) => {
        const complete =
          result &&
          Array.isArray(result.runs) &&
          result.runs.length === 1 &&
          result.runs[0].spec?.relative?.replaceAll('\\', '/') ===
            'tests/remote-sandbox/browser-vertical.cy.ts' &&
          result.totalTests === 1 &&
          result.totalPassed === 1 &&
          !result.totalFailed &&
          !result.totalPending &&
          !result.totalSkipped &&
          observations.length === 7 &&
          browserCaseIds
            .slice(0, -1)
            .every((id) => observations.some((value) => value.id === id));
        const report = {
          schemaVersion: 1,
          runId,
          status: complete ? 'PASS' : 'FAIL',
          total: result?.totalTests ?? 0,
          passed: result?.totalPassed ?? 0,
          failed: result?.totalFailed ?? 0,
          pending: result?.totalPending ?? 0,
          skipped: result?.totalSkipped ?? 0,
          observations,
          browser: /^[a-z]+$/i.test(result?.browserName ?? '')
            ? result.browserName
            : 'unknown',
          browserVersion: /^[0-9.]+$/.test(result?.browserVersion ?? '')
            ? result.browserVersion
            : 'unknown',
        };
        writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', {
          flag: 'wx',
          mode: 0o600,
        });
      });
      return config;
    },
  },
});
