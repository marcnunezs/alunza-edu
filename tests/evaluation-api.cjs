/* eslint @typescript-eslint/no-require-imports: "off" */
// Exclusive TEST entrypoint; never packaged for deployment. Controlled outcomes
// are assigned externally by attempt UUID, not by instructions in student data.
const { testStartupObserver } = require('./test-startup-observer.cjs');
const startup = testStartupObserver('EVALUATION');
(async () => {
  startup.mark('IMPORTS_START');
  const { readFileSync } = require('node:fs');
  const { resolve } = require('node:path');
  const { randomUUID } = require('node:crypto');
  const { createApp, loadConfig } = require('../apps/api/dist/app.js');
  const { NestFactory } = require('@nestjs/core');
  const { materialTokenCount } = require('@alunza/ai');
  const { testHelpFactory } = require('./help-providers.cjs');
  const {
    testEvaluationVector,
  } = require('../fixtures/ai/adversarial/test-vectors.cjs');
  startup.mark('IMPORTS_COMPLETE');
  startup.mark('CONFIG_START');
  const config = loadConfig();
  if (
    config.environment !== 'test' ||
    !config.evaluation?.enabled ||
    new URL(config.databaseUrl).port !== '18422' ||
    config.jwtIssuer !== 'http://127.0.0.1:18421/auth/v1'
  )
    throw new Error('Evaluation oracle requires isolated TEST.');
  const controlsPath = process.env.ALUNZA_EVALUATION_CONTROLS;
  if (
    !controlsPath ||
    !resolve(controlsPath).startsWith(
      resolve('.local') + require('node:path').sep,
    )
  )
    throw new Error('TEST controls require a private local path.');
  startup.mark('CONFIG_COMPLETE');
  function controls() {
    return JSON.parse(readFileSync(controlsPath, 'utf8')).attempts;
  }
  const embeddings = {
    configuration: {
      id: 'materials-fixture-3d-v1',
      model: 'test-fixture-only',
      dimensions: 3,
    },
    async embed(texts, signal, observer) {
      signal.throwIfAborted();
      const usage = {
        inputTokens: texts.reduce(
          (sum, text) => sum + materialTokenCount(text),
          0,
        ),
        model: 'test-fixture-only',
        requestId: randomUUID(),
      };
      this.lastUsage = usage;
      await observer?.({
        phase: 'EMBEDDING',
        outcome: 'RESPONSE',
        settledAt: new Date().toISOString(),
        aborted: signal.aborted,
        model: usage.model,
        requestId: usage.requestId,
        usage: { inputTokens: usage.inputTokens },
        httpStatus: 200,
      });
      // A transparent synthetic retrieval fixture, never promoted as Azure data.
      return texts.map(testEvaluationVector);
    },
  };
  const base = testHelpFactory(embeddings, (id) => {
    const entry = id && controls()[id];
    return entry?.scenario ? { scenario: entry.scenario } : null;
  });
  function factory() {
    const ports = base();
    const verify = ports.verification.verify;
    ports.verification.verify = async (input, candidate, signal, observer) => {
      const entry = controls()[input.context.attemptId];
      if (!entry?.review) return verify(input, candidate, signal, observer);
      signal.throwIfAborted();
      const verification = {
        verdict: entry.review,
        reason: entry.reason,
        source_refs: entry.review === 'ACCEPT' ? candidate.source_refs : [],
      };
      const usage = {
        model: 'test-fixture-only',
        inputTokens: 130,
        outputTokens: 20,
        requestId: randomUUID(),
      };
      await observer?.({
        phase: 'REVIEW',
        outcome: 'RESPONSE',
        settledAt: new Date().toISOString(),
        aborted: false,
        model: usage.model,
        requestId: usage.requestId,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        },
        httpStatus: 200,
      });
      return { verification, usage };
    };
    return ports;
  }
  const app = await startup.createApp(NestFactory, () =>
    createApp(config, embeddings, factory),
  );
  startup.mark('LISTEN_START');
  await app.listen(config.port, config.host);
  startup.mark('LISTEN_COMPLETE');
})().catch(() => {
  startup.failed();
  console.error('EVALUATION_TEST_STARTUP_FAILED');
  process.exitCode = 1;
});
